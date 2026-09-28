using System.Runtime.CompilerServices;

namespace Brawl.Core;

/// <summary>Something a hero carries that brings modifiers and triggers: a class, passive, race, perk or artifact.</summary>
public sealed record Trait(string Id, IReadOnlyList<Modifier> Modifiers, IReadOnlyList<Trigger> Triggers);

public readonly record struct ModifierSum(double Add, double Mul);

/// <summary>
/// Modifiers: the always-on part of traits. A port of battle/modifiers.ts. Nothing is
/// cached about the state: every question is answered from the state as it is.
/// </summary>
public static class Modifiers
{
    public const string MovesThisTurn = "movesThisTurn";
    public const string FreeStepsUsed = "freeStepsUsed";

    private static readonly IReadOnlySet<ModifierStat> BaseStats = new HashSet<ModifierStat>
    {
        ModifierStat.MaxHp, ModifierStat.Attack, ModifierStat.Magic, ModifierStat.Armor,
        ModifierStat.Resist, ModifierStat.Speed, ModifierStat.CritChance,
    };

    public static bool IsBaseStat(ModifierStat stat) => BaseStats.Contains(stat);

    // Traits built from content once per content object; they depend on nothing else.
    private static readonly ConditionalWeakTable<object, Trait> TraitCache = new();
    private static readonly ConditionalWeakTable<Trait, Dictionary<ModifierStat, List<Modifier>>> ByStatCache = new();

    private static Trait Cached(object key, Func<Trait> build) => TraitCache.GetValue(key, _ => build());

    private static Dictionary<ModifierStat, List<Modifier>> ModifiersByStat(Trait trait) =>
        ByStatCache.GetValue(trait, t =>
        {
            var byStat = new Dictionary<ModifierStat, List<Modifier>>();
            foreach (var modifier in t.Modifiers)
            {
                if (!byStat.TryGetValue(modifier.Stat, out var list)) byStat[modifier.Stat] = list = [];
                list.Add(modifier);
            }
            return byStat;
        });

    private static Trait ClassTrait(HeroClass heroClass) =>
        Cached(heroClass, () => new Trait($"class:{heroClass.Id}", heroClass.Modifiers ?? [], []));

    /// <summary>
    /// A race as a battle trait: only its battle quantities; its stat bonuses were baked
    /// into the hero when it was generated.
    /// </summary>
    private static Trait RaceTrait(Race race) =>
        Cached(race, () => new Trait(
            $"race:{race.Id}",
            race.Modifiers
                .Where(m => !IsBaseStat(m.Stat) && (m.Add is not null || m.Mul is not null))
                .Select(m => new Modifier { Stat = m.Stat, Add = m.Add ?? 0, Mul = m.Mul ?? 0 })
                .ToList(),
            []));

    private static Trait PassiveTrait(Passive p) => Cached(p, () => new Trait(p.Id, p.Modifiers, p.Triggers));
    private static Trait PerkTrait(Perk p) => Cached(p, () => new Trait(p.Id, p.Modifiers, p.Triggers));
    private static Trait ItemTrait(Item i) => Cached(i, () => new Trait(i.Id, i.Modifiers, i.Triggers));

    /// <summary>Every trait a hero carries, in a fixed order: class, passive, race, perks as taken, artifact.</summary>
    public static List<Trait> TraitsOf(BattleHero hero, ContentRegistry content)
    {
        var output = new List<Trait>();
        var heroClass = content.Classes.Get(hero.ClassId);
        if (heroClass?.Modifiers is { Count: > 0 }) output.Add(ClassTrait(heroClass));
        if (hero.Passive is not null && content.Passives.Get(hero.Passive) is { } passive) output.Add(PassiveTrait(passive));
        if (hero.Race is not null && content.Races.Get(hero.Race) is { } race) output.Add(RaceTrait(race));
        foreach (var pick in hero.Perks)
            if (content.Perks.Get(pick.PerkId) is { } perk) output.Add(PerkTrait(perk));
        if (hero.Item is not null && content.Items.Get(hero.Item) is { } item) output.Add(ItemTrait(item));
        return output;
    }

    private static readonly string[] Control = [Statuses.Stun, Statuses.Root, Statuses.Silence];

    private static double HpPct(BattleHero hero) => hero.Hp / hero.Base.MaxHp * 100;

    private static List<BattleHero> AdjacentLiving(BattleState state, BattleHero hero, bool sameSide) =>
        Query.LivingHeroes(state)
            .Where(h => h.Id != hero.Id && (h.Side == hero.Side) == sameSide && HexMath.Distance(h.Hex, hero.Hex) == 1)
            .ToList();

    private static bool InScope(BattleHero owner, BattleHero recipient, Modifier modifier) =>
        (modifier.Scope ?? ModifierScope.Self) switch
        {
            ModifierScope.Self => owner.Id == recipient.Id,
            ModifierScope.AllAllies => owner.Side == recipient.Side,
            ModifierScope.AdjacentAllies => owner.Id != recipient.Id && owner.Side == recipient.Side && HexMath.Distance(owner.Hex, recipient.Hex) == 1,
            ModifierScope.AdjacentEnemies => owner.Side != recipient.Side && HexMath.Distance(owner.Hex, recipient.Hex) == 1,
            _ => false,
        };

    private static bool ConditionHolds(
        BattleState state,
        BattleHero owner,
        BattleHero recipient,
        BattleHero? target,
        ModifierCondition? when,
        ContentRegistry content,
        int? abilityTier)
    {
        if (when is null) return true;

        if (when.AbilityTierAtLeast is not null && !(abilityTier is not null && abilityTier >= when.AbilityTierAtLeast)) return false;
        if (when.SelfHpAbovePct is not null && !(HpPct(owner) > when.SelfHpAbovePct)) return false;
        if (when.SelfHpBelowPct is not null && !(HpPct(owner) < when.SelfHpBelowPct)) return false;
        if (when.NoAdjacentAllies == true && AdjacentLiving(state, owner, true).Count > 0) return false;

        bool needsTarget = when.TargetHpBelowPct is not null || when.TargetHas is not null || when.TargetDistanceAbove is not null
            || when.TargetIsolated == true || when.TargetActedLast == true;
        if (!needsTarget) return true;
        if (target is null) return false;

        if (when.TargetHpBelowPct is not null && !(HpPct(target) < when.TargetHpBelowPct)) return false;
        if (when.TargetHas is not null)
        {
            string has = when.TargetHas;
            bool present = has switch
            {
                "debuff" => Statuses.HasAnyDebuff(target, content),
                "buff" => Statuses.HasAnyBuff(target, content),
                "control" => Control.Any(id => Statuses.HasStatus(target, id)),
                _ => Statuses.HasStatus(target, has),
            };
            if (!present) return false;
        }
        if (when.TargetDistanceAbove is not null && !(HexMath.Distance(recipient.Hex, target.Hex) > when.TargetDistanceAbove)) return false;
        if (when.TargetActedLast == true && state.LastActedHeroId != target.Id) return false;
        if (when.TargetIsolated == true && AdjacentLiving(state, target, true).Any(ally => ally.Summon is null)) return false;
        return true;
    }

    private static double PerCount(BattleState state, BattleHero owner, Modifier modifier, ContentRegistry content) =>
        modifier.Per switch
        {
            null => 1,
            ModifierPer.AdjacentEnemy => AdjacentLiving(state, owner, false).Count,
            ModifierPer.DebuffOnField => Query.LivingHeroes(state).Aggregate(0.0, (sum, hero) =>
                sum + hero.Statuses.Count(s => content.Statuses.Get(s.Status)?.Kind == StatusKind.Debuff)),
            _ => 1,
        };

    /// <summary>
    /// Every modifier of `stat` that reaches `hero`, summed. `target` is the other hero of
    /// a hit or a heal, for the conditions that look at it.
    /// </summary>
    public static ModifierSum Sum(
        BattleState state,
        BattleHero hero,
        ModifierStat stat,
        ContentRegistry content,
        BattleHero? target = null,
        int? abilityTier = null)
    {
        double add = 0;
        double mul = 0;
        // A modifier can come from any hero on the field, in the order of the heroes map.
        foreach (var owner in state.Heroes.Values)
        {
            if (owner.Id != hero.Id && !owner.IsAlive) continue;
            foreach (var trait in TraitsOf(owner, content))
            {
                if (!ModifiersByStat(trait).TryGetValue(stat, out var relevant)) continue;
                foreach (var modifier in relevant)
                {
                    if (!InScope(owner, hero, modifier)) continue;
                    if (!ConditionHolds(state, owner, hero, target, modifier.When, content, abilityTier)) continue;
                    double count = PerCount(state, owner, modifier, content);
                    add += (modifier.Add ?? 0) * count;
                    mul += (modifier.Mul ?? 0) * count;
                }
            }
        }
        // Statuses that move a battle quantity act on their carrier only.
        foreach (var instance in hero.Statuses)
        {
            var def = content.Statuses.Get(instance.Status);
            if (def?.BattleStat != stat) continue;
            double sign = def.BattleSign ?? (def.Kind == StatusKind.Debuff ? -1 : 1);
            if (def.ValueKind == ValueKind.Flat) add += sign * instance.Value;
            else if (def.ValueKind == ValueKind.Fraction) mul += sign * instance.Value;
        }
        return new ModifierSum(add, mul);
    }

    private static ModifierStat AsModifierStat(StatName stat) => stat switch
    {
        StatName.MaxHp => ModifierStat.MaxHp,
        StatName.Attack => ModifierStat.Attack,
        StatName.Magic => ModifierStat.Magic,
        StatName.Armor => ModifierStat.Armor,
        StatName.Resist => ModifierStat.Resist,
        StatName.Speed => ModifierStat.Speed,
        _ => ModifierStat.CritChance,
    };

    public static StatName AsStat(ScaleStat scale) => scale == ScaleStat.Attack ? StatName.Attack : StatName.Magic;

    /// <summary>
    /// One stat a hero actually fights with: base, then statuses, then modifiers, then
    /// the floors and caps. Health is not one of them: see statsInBattle in TypeScript.
    /// </summary>
    public static double StatInBattle(BattleState state, BattleHero hero, StatName stat, ContentRegistry content)
    {
        var layer = Statuses.Layer(hero, content);
        var mods = Sum(state, hero, AsModifierStat(stat), content);
        double raw = (hero.Base.Get(stat) + layer.Flat.GetValueOrDefault(stat, 0) + mods.Add)
            * layer.Mul.GetValueOrDefault(stat, 1) * (1 + mods.Mul);
        var limits = content.Config.Formulas;
        return stat switch
        {
            StatName.Armor or StatName.Resist => Math.Max(limits.MinDefense, raw),
            StatName.Speed => Math.Max(limits.MinSpeed, raw),
            StatName.CritChance => Math.Min(limits.CritChanceCap, Math.Max(0, raw)),
            StatName.Attack or StatName.Magic => Math.Max(0, raw),
            _ => throw new ArgumentOutOfRangeException(nameof(stat), "maxHp is not a battle stat"),
        };
    }

    public static Stats StatsInBattle(BattleState state, BattleHero hero, ContentRegistry content) => new(
        hero.Base.MaxHp,
        StatInBattle(state, hero, StatName.Attack, content),
        StatInBattle(state, hero, StatName.Magic, content),
        StatInBattle(state, hero, StatName.Armor, content),
        StatInBattle(state, hero, StatName.Resist, content),
        StatInBattle(state, hero, StatName.Speed, content),
        StatInBattle(state, hero, StatName.CritChance, content));

    /// <summary>1 + every damageDealt share of the attacker against this target.</summary>
    public static double DealtFactor(BattleState state, BattleHero attacker, BattleHero target, ContentRegistry content, int? abilityTier = null)
    {
        double high = Terrain.IsHigh(state.Arena, attacker.Hex) ? content.Config.Arena.High.Damage : 0;
        double point = ArenaModifiers.PointBonus(state, attacker.Hex, content);
        return Math.Max(0, 1 + Sum(state, attacker, ModifierStat.DamageDealt, content, target, abilityTier).Mul + high + point);
    }

    public static double TakenFactor(BattleState state, BattleHero target, BattleHero? attacker, ContentRegistry content) =>
        Math.Max(0, 1 + Sum(state, target, ModifierStat.DamageTaken, content, attacker).Mul);

    public static double HealFactor(BattleState state, BattleHero healer, BattleHero target, ContentRegistry content) =>
        Math.Max(0, 1 + Sum(state, healer, ModifierStat.HealDone, content, target).Mul);

    public static double CritMultiplier(BattleState state, BattleHero attacker, BattleHero target, ContentRegistry content) =>
        content.Config.Formulas.CritMult + Sum(state, attacker, ModifierStat.CritMult, content, target).Add;

    /// <summary>Extra range from modifiers, only for abilities that already hit further than one hex.</summary>
    public static double RangeBonus(BattleState state, BattleHero hero, int baseRange, ContentRegistry content)
    {
        if (baseRange <= 1) return 0;
        double high = Terrain.IsHigh(state.Arena, hero.Hex) ? content.Config.Arena.High.Range : 0;
        return Sum(state, hero, ModifierStat.Range, content).Add + high;
    }

    /// <summary>Free steps left this turn ("Ловкость", tank and melee classes).</summary>
    public static double FreeStepsLeft(BattleState state, BattleHero hero, ContentRegistry content)
    {
        double total = Math.Max(0, Math.Floor(Sum(state, hero, ModifierStat.FreeSteps, content).Add));
        return Math.Max(0, total - hero.Counter(FreeStepsUsed));
    }

    public static double StartAtbBonus(BattleState state, BattleHero hero, ContentRegistry content) =>
        Math.Max(0, Sum(state, hero, ModifierStat.StartAtb, content).Add);

    /// <summary>"Плащ теней": the first move of this turn draws no attack of opportunity.</summary>
    public static bool FreeDisengage(BattleState state, BattleHero hero, ContentRegistry content)
    {
        if (hero.Counter(MovesThisTurn) > 0) return false;
        return Sum(state, hero, ModifierStat.FreeDisengage, content).Add > 0;
    }

    /// <summary>How much the hero's ability zones grow ("Мантия архимага").</summary>
    public static int ZoneGrowth(BattleState state, BattleHero hero, ContentRegistry content) =>
        (int)Math.Max(0, Math.Floor(Sum(state, hero, ModifierStat.ZoneSize, content).Add));
}
