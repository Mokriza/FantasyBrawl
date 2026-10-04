namespace Brawl.Core;

/// <summary>
/// The single source of truth for what the active hero may do, a port of battle/legal.ts.
/// The interface and the AI both ask here.
/// </summary>
public static class Legal
{
    /// <summary>Spent once per match; stored negative so the end-of-turn tick leaves it alone.</summary>
    public const double OnceCooldown = -1;

    /// <summary>How far an ability reaches for this hero, after range modifiers, capped at maxRangeBonus.</summary>
    public static double AbilityRange(BattleState state, BattleHero hero, Ability ability, ContentRegistry content)
    {
        double perk = ability.Range > 1 ? AbilityModSum(hero, ability, content, m => m.Range) : 0;
        double bonus = Math.Min(content.Config.Battle.MaxRangeBonus, Modifiers.RangeBonus(state, hero, ability.Range, content) + perk);
        double range = ability.Range + bonus;
        // A penalty can shorten a ranged ability, never below the next hex.
        return ability.Range > 1 ? Math.Max(1, range) : range;
    }

    private static double AbilityModSum(BattleHero hero, Ability ability, ContentRegistry content, Func<AbilityMod, int?> field)
    {
        double total = 0;
        foreach (var pick in hero.Perks)
        {
            if (pick.AbilityId != ability.Id) continue;
            var mod = content.Perks.Get(pick.PerkId)?.AbilityMod;
            total += mod is null ? 0 : field(mod) ?? 0;
        }
        return total;
    }

    /// <summary>What an ability costs this hero after perks; never below 1.</summary>
    public static double AbilityApCost(BattleHero hero, Ability ability, ContentRegistry content)
    {
        if (ability.Ap == 0) return 0;
        return Math.Max(1, ability.Ap + AbilityModSum(hero, ability, content, m => m.Ap));
    }

    /// <summary>The cooldown this hero's copy of an ability starts after perks; never below 1.</summary>
    public static AbilityCooldown CooldownOf(BattleHero hero, Ability ability, ContentRegistry content)
    {
        if (ability.Cooldown.Once || ability.Cooldown.Turns == 0) return ability.Cooldown;
        return AbilityCooldown.OfTurns((int)Math.Max(1, ability.Cooldown.Turns + AbilityModSum(hero, ability, content, m => m.Cooldown)));
    }

    /// <summary>Action points a move may spend this turn: what is left plus the free steps left.</summary>
    public static double MoveBudget(BattleState state, BattleHero hero, ContentRegistry content) =>
        state.ApLeft + Modifiers.FreeStepsLeft(state, hero, content);

    public static double CooldownLeft(BattleHero hero, Ability ability) => hero.Cooldowns.Get(ability.Id);

    /// <summary>Everything about an ability that does not depend on where it is aimed.</summary>
    public static Legality AbilityAvailability(BattleState state, BattleHero hero, Ability ability, ContentRegistry content)
    {
        if (state.Outcome is not null) return Legality.Not(IllegalReason.BattleOver);
        if (state.ActiveHeroId != hero.Id) return Legality.Not(IllegalReason.NotActiveHero);
        if (hero.Hp <= 0) return Legality.Not(IllegalReason.HeroDead);
        if (state.ApLeft < AbilityApCost(hero, ability, content)) return Legality.Not(IllegalReason.NoAp);
        if (CooldownLeft(hero, ability) != 0) return Legality.Not(IllegalReason.OnCooldown);

        bool isBasic = ability.Id == Opportunity.BasicAttackOf(hero, content);
        if (!isBasic && Statuses.HasStatus(hero, Statuses.Silence)) return Legality.Not(IllegalReason.Silenced);

        // An ability that relocates the caster needs somewhere to land.
        if (Statuses.HasStatus(hero, Statuses.Root) && ability.Effects.Any(e => e is MoveEffect or TeleportEffect))
            return Legality.Not(IllegalReason.Rooted);
        return Legality.Ready;
    }

    private static bool TargetKindOk(BattleState state, BattleHero hero, Ability ability, Hex target, ContentRegistry content)
    {
        var occupant = Query.HeroAt(state, target);
        // Stealth: an enemy cannot be chosen by an enemy-targeted or single-target ability.
        bool choosesOccupant = ability.Targets == AbilityTargets.Enemy || ability.Shape is SingleShape;
        if (occupant is not null && choosesOccupant && Statuses.HiddenFrom(hero.Side, occupant, content)) return false;
        return ability.Targets switch
        {
            AbilityTargets.Self => target == hero.Hex,
            AbilityTargets.Enemy => occupant is not null && occupant.Side != hero.Side,
            AbilityTargets.Ally => occupant is not null && occupant.Side == hero.Side,
            AbilityTargets.EmptyHex => Pathing.IsPassable(state, target),
            _ => true,
        };
    }

    private static bool NeedsLos(BattleHero hero, Ability ability, ContentRegistry content) =>
        ability.RequiresLos
        && ability.Targets != AbilityTargets.Self
        && ability.Targets != AbilityTargets.Ally
        && !Statuses.HasFlag(hero, content, Statuses.IgnoresLos);

    /// <summary>Whether this ability may be aimed at this hex right now.</summary>
    public static Legality AbilityLegality(BattleState state, BattleHero hero, Ability ability, Hex target, ContentRegistry content)
    {
        var available = AbilityAvailability(state, hero, ability, content);
        if (!available.Ok) return available;

        if (!Terrain.InBounds(target, state.Arena)) return Legality.Not(IllegalReason.BadTarget);
        if (HexMath.Distance(hero.Hex, target) > AbilityRange(state, hero, ability, content)) return Legality.Not(IllegalReason.OutOfRange);
        if (!TargetKindOk(state, hero, ability, target, content)) return Legality.Not(IllegalReason.BadTarget);

        if (NeedsLos(hero, ability, content) && !Targeting.HasLineOfSight(state, hero.Hex, target, content))
            return Legality.Not(IllegalReason.NoLos);

        if (ability.Effects.OfType<MoveEffect>().FirstOrDefault() is { To: MoveTo.AdjacentToTarget })
        {
            var ctx = new EffectContext
            {
                State = state,
                CasterId = hero.Id,
                Ability = ability,
                TargetId = null,
                AimedAt = target,
                Mul = 1,
                Content = content,
                Mode = RollMode.Fixed,
                CasterIsActing = true,
                IgnoresZoc = ability.IgnoresZoc == true,
                LastDamage = 0,
                LastCrit = false,
                LastKilled = false,
            };
            if (Atoms.LandingHexNextTo(ctx, target) is null) return Legality.Not(IllegalReason.BlockedPath);
        }
        return Legality.Ready;
    }

    public static Legality MoveLegality(BattleState state, BattleHero hero, IReadOnlyList<Hex> path, ContentRegistry content)
    {
        if (state.Outcome is not null) return Legality.Not(IllegalReason.BattleOver);
        if (state.ActiveHeroId != hero.Id) return Legality.Not(IllegalReason.NotActiveHero);
        if (hero.Hp <= 0) return Legality.Not(IllegalReason.HeroDead);
        if (Statuses.HasStatus(hero, Statuses.Root)) return Legality.Not(IllegalReason.Rooted);
        if (path.Count == 0) return Legality.Not(IllegalReason.BadTarget);

        double budget = MoveBudget(state, hero, content);
        var reachable = Pathing.ReachableHexes(state, hero, budget, content).Get(path[^1].Key);
        if (reachable is null) return Legality.Not(IllegalReason.BlockedPath);
        if (reachable.Cost > budget) return Legality.Not(IllegalReason.NoAp);
        return Legality.Ready;
    }

    /// <summary>Every hex in the ability's range that it can see, whoever stands there.</summary>
    public static List<Hex> AbilityReach(BattleState state, BattleHero hero, Ability ability, ContentRegistry content)
    {
        if (!AbilityAvailability(state, hero, ability, content).Ok) return [];
        bool needsLos = NeedsLos(hero, ability, content);
        double reach = AbilityRange(state, hero, ability, content);
        return Terrain.AllHexes(state.Arena)
            .Where(h => HexMath.Distance(hero.Hex, h) <= reach && (!needsLos || Targeting.HasLineOfSight(state, hero.Hex, h, content)))
            .ToList();
    }

    /// <summary>Every hex this ability may actually be aimed at right now.</summary>
    public static List<Hex> TargetsFor(BattleState state, BattleHero hero, Ability ability, ContentRegistry content)
    {
        return TargetsInReach(state, hero, ability, content).ToList();
    }

    public static List<Ability> AbilitiesOf(BattleHero hero, ContentRegistry content)
    {
        var seen = new HashSet<string>();
        var output = new List<Ability>();
        foreach (string id in new[] { Opportunity.BasicAttackOf(hero, content) }.Concat(hero.Abilities))
        {
            if (!seen.Add(id)) continue;
            output.Add(content.GetAbility(id));
        }
        return output;
    }

    public static OrderedMap<Reachable> ReachableFor(BattleState state, BattleHero hero, ContentRegistry content)
    {
        if (Statuses.HasStatus(hero, Statuses.Root)) return OrderedMap<Reachable>.Empty;
        return Pathing.ReachableHexes(state, hero, MoveBudget(state, hero, content), content);
    }

    /// <summary>
    /// Every action the active hero may take. Movement is one entry per reachable hex,
    /// with the cheapest path.
    /// </summary>
    public static List<BattleAction> Actions(BattleState state, ContentRegistry content)
    {
        var hero = Query.ActiveHero(state);
        if (hero is null || state.Outcome is not null) return [];

        var output = new List<BattleAction> { new EndTurnAction { HeroId = hero.Id } };
        foreach (var entry in ReachableFor(state, hero, content).Values)
            output.Add(new MoveAction { HeroId = hero.Id, Path = entry.Path });

        foreach (var ability in AbilitiesOf(hero, content))
            foreach (var target in TargetsInReach(state, hero, ability, content))
                output.Add(new AbilityAction { HeroId = hero.Id, AbilityId = ability.Id, Target = target });
        return output;
    }

    /// <summary>
    /// The hexes this ability may be aimed at, in AllHexes order. Hexes past its range are
    /// skipped before the full check: they would fail it anyway, and the range itself
    /// (with every modifier on the field) is worked out once rather than per hex.
    /// </summary>
    private static IEnumerable<Hex> TargetsInReach(BattleState state, BattleHero hero, Ability ability, ContentRegistry content)
    {
        if (!AbilityAvailability(state, hero, ability, content).Ok) yield break;
        double reach = AbilityRange(state, hero, ability, content);
        foreach (var target in Terrain.AllHexes(state.Arena))
            if (HexMath.Distance(hero.Hex, target) <= reach && AbilityLegality(state, hero, ability, target, content).Ok)
                yield return target;
    }

    /// <summary>
    /// Whether the active hero can do anything besides ending the turn: the same answer as
    /// looking for such an entry in Actions, without building the whole list.
    /// </summary>
    public static bool HasActionBesidesEndTurn(BattleState state, ContentRegistry content)
    {
        var hero = Query.ActiveHero(state);
        if (hero is null || state.Outcome is not null) return false;
        if (ReachableFor(state, hero, content).Count > 0) return true;
        return AbilitiesOf(hero, content).Any(ability => TargetsInReach(state, hero, ability, content).Any());
    }

    /// <summary>Two actions are the same move: same kind, same hero, same target or path.</summary>
    public static bool SameAction(BattleAction a, BattleAction b)
    {
        if (a.Type != b.Type || a.HeroId != b.HeroId) return false;
        return (a, b) switch
        {
            (EndTurnAction, EndTurnAction) => true,
            (AbilityAction x, AbilityAction y) => x.AbilityId == y.AbilityId && x.Target == y.Target,
            (MoveAction x, MoveAction y) => x.Path.SequenceEqual(y.Path),
            _ => false,
        };
    }

    public static bool IsLegalAction(BattleState state, BattleAction action, ContentRegistry content) =>
        Actions(state, content).Any(a => SameAction(a, action));
}

/// <summary>End of match, a port of battle/victory.ts.</summary>
public static class Victory
{
    private static List<BattleHero> Fighters(BattleState state, Side side) =>
        Query.HeroesOfSide(state, side).Where(h => h.Summon is null).ToList();

    private static double HealthShare(BattleState state, Side side) =>
        Fighters(state, side).Aggregate(0.0, (sum, h) => sum + h.Hp / h.Base.MaxHp);

    /// <summary>
    /// The side that would win if the round limit ran out now: the larger sum of hp/maxHp,
    /// B on an exact tie. The AI reads it to tell whether waiting is on its side.
    /// </summary>
    public static Side RoundLimitLeader(BattleState state) =>
        HealthShare(state, Side.A) > HealthShare(state, Side.B) ? Side.A : Side.B;

    public static BattleOutcome? CheckOutcome(BattleState state, ContentRegistry content)
    {
        if (state.Outcome is not null) return state.Outcome;

        int aliveA = Fighters(state, Side.A).Count;
        int aliveB = Fighters(state, Side.B).Count;
        if (aliveA == 0 && aliveB == 0) return new BattleOutcome(Side.B, VictoryReason.Elimination);
        if (aliveA == 0) return new BattleOutcome(Side.B, VictoryReason.Elimination);
        if (aliveB == 0) return new BattleOutcome(Side.A, VictoryReason.Elimination);

        // "Точка силы": enough rounds held win outright.
        var need = ArenaModifiers.HoldToWin(state, content);
        if (need is not null)
        {
            if (state.Hold.A >= need) return new BattleOutcome(Side.A, VictoryReason.Hold);
            if (state.Hold.B >= need) return new BattleOutcome(Side.B, VictoryReason.Hold);
        }

        if (state.Round > content.Config.Battle.MaxRounds)
            return new BattleOutcome(RoundLimitLeader(state), VictoryReason.RoundLimit);
        return null;
    }
}
