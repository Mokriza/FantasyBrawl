namespace Brawl.Core;

/// <summary>Turns the dice off for the AI, which must not peek at the real roll.</summary>
public readonly record struct RollMode(bool Deterministic)
{
    public static readonly RollMode Random = new(false);
    public static readonly RollMode Fixed = new(true);
}

/// <summary>
/// Damage and healing, a port of battle/formulas.ts. The order of operations and of the
/// rolls is fixed: spread first, then crit.
/// </summary>
public static class Formulas
{
    public sealed record DamageResult(double PreDefense, double AbsorbedByBarrier, double Final, bool Crit, RngState Rng);

    public readonly record struct Mitigated(double Absorbed, double Final);

    /// <summary>Math.floor(value + 0.5), exactly as the TypeScript core rounds here.</summary>
    public static double RoundHalfUp(double value) => Math.Floor(value + 0.5);

    private static double DefenseAgainst(BattleState state, BattleHero target, ContentRegistry content, DamageSchool school, double pierce)
    {
        if (school == DamageSchool.Pure) return 0;
        double raw = Modifiers.StatInBattle(state, target, school == DamageSchool.Physical ? StatName.Armor : StatName.Resist, content);
        return Math.Max(content.Config.Formulas.MinDefense, raw * (1 - pierce));
    }

    public static DamageResult ComputeDamage(
        BattleState state,
        BattleHero attacker,
        BattleHero target,
        DamageEffect effect,
        ContentRegistry content,
        RngState rng,
        RollMode mode,
        int? abilityTier = null)
    {
        var f = content.Config.Formulas;

        double baseValue = effect.K * Modifiers.StatInBattle(state, attacker, Modifiers.AsStat(effect.Scale), content)
            * Modifiers.DealtFactor(state, attacker, target, content, abilityTier);

        // "Смертельный выстрел": the further the target, the harder it hits.
        if (effect.PerHexBonus is not null) baseValue *= 1 + effect.PerHexBonus.Value * HexMath.Distance(attacker.Hex, target.Hex);

        if (effect.BonusVsLowHp is not null)
        {
            double pct = target.Hp / target.Base.MaxHp * 100;
            if (pct < effect.BonusVsLowHp.BelowPct) baseValue *= effect.BonusVsLowHp.Mul;
        }

        var dice = rng;
        double spread = 1;
        if (!mode.Deterministic)
        {
            var (rolled, afterSpread) = Rng.NextFloatBetween(dice, f.Spread[0], f.Spread[1]);
            spread = rolled;
            dice = afterSpread;
        }

        // Pure damage never crits. A forced crit is not a roll, so it holds with the dice frozen too.
        bool canCrit = effect.NoCrit != true && effect.School != DamageSchool.Pure;
        bool crit = canCrit && effect.AlwaysCrit == true;
        if (canCrit && !crit && !mode.Deterministic)
        {
            double critChance = Modifiers.StatInBattle(state, attacker, StatName.CritChance, content) + (effect.CritBonus ?? 0);
            var (rolled, afterCrit) = Rng.Chance(dice, critChance);
            crit = rolled;
            dice = afterCrit;
        }

        double preDefense = baseValue * spread * (crit ? Modifiers.CritMultiplier(state, attacker, target, content) : 1);

        double attackerPierce = Math.Min(1, Math.Max(0, Modifiers.Sum(state, attacker, ModifierStat.DefensePierce, content).Add));
        var mitigated = Mitigate(
            state,
            attacker,
            target,
            preDefense,
            effect.School,
            // The ability's own pierce and the attacker's stack multiplicatively.
            1 - (1 - (effect.ArmorPierce ?? 0)) * (1 - attackerPierce),
            content);
        return new DamageResult(preDefense, mitigated.Absorbed, mitigated.Final, crit, dice);
    }

    /// <summary>
    /// Everything that happens to rolled damage: the barrier, then defence, then the
    /// target's damageTaken modifiers, then rounding and the floor.
    /// </summary>
    public static Mitigated Mitigate(
        BattleState state,
        BattleHero? attacker,
        BattleHero target,
        double preDefense,
        DamageSchool school,
        double pierce,
        ContentRegistry content)
    {
        var f = content.Config.Formulas;
        double absorbed = Math.Min(Statuses.BarrierAmount(target), preDefense);
        double rest = preDefense - absorbed;

        double def = DefenseAgainst(state, target, content, school, pierce);
        double reduce = def / (def + f.DefenseConstant);
        double final = RoundHalfUp(rest * (1 - reduce) * Modifiers.TakenFactor(state, target, attacker, content));
        if (rest > 0) final = Math.Max(f.MinDamage, final);
        return new Mitigated(absorbed, final);
    }

    public readonly record struct HealResult(double Amount, RngState Rng);

    public static HealResult ComputeHeal(
        BattleState state,
        BattleHero healer,
        BattleHero target,
        HealEffect effect,
        ContentRegistry content,
        RngState rng,
        RollMode mode)
    {
        double missing = target.Base.MaxHp - target.Hp;
        double arena = ArenaModifiers.HealMultiplier(state, content);

        if (effect.Full == true) return new(RoundHalfUp(missing * arena), rng);
        if (effect.Flat is not null) return new(Math.Min(missing, RoundHalfUp(effect.Flat.Value * arena)), rng);
        if (effect.PctMaxHp is not null)
            return new(Math.Min(missing, RoundHalfUp(target.Base.MaxHp * effect.PctMaxHp.Value / 100 * arena)), rng);
        if (effect.MissingHpPct is not null)
            return new(Math.Min(missing, RoundHalfUp(missing * effect.MissingHpPct.Value / 100 * arena)), rng);

        var scale = effect.Scale ?? ScaleStat.Magic;
        double raw = (effect.K ?? 0) * Modifiers.StatInBattle(state, healer, Modifiers.AsStat(scale), content)
            * Modifiers.HealFactor(state, healer, target, content);

        var dice = rng;
        double spread = 1;
        if (!mode.Deterministic)
        {
            var f = content.Config.Formulas;
            var (rolled, next) = Rng.NextFloatBetween(dice, f.Spread[0], f.Spread[1]);
            spread = rolled;
            dice = next;
        }
        return new(Math.Min(missing, RoundHalfUp(raw * spread * arena)), dice);
    }

    /// <summary>Barrier hit points an ability grants. No roll.</summary>
    public static double ComputeBarrier(BattleState state, BattleHero caster, ContentRegistry content, ScaleStat scale, double k) =>
        RoundHalfUp(k * Modifiers.StatInBattle(state, caster, Modifiers.AsStat(scale), content));
}
