namespace Brawl.Core;

/// <summary>The initiative bar, a port of battle/atb.ts. Nothing here is random; every tie breaks the same way.</summary>
public static class Atb
{
    /// <summary>On a tied bar and speed: side B, then side A, then the neutral guardian (user decision).</summary>
    private static int SideOrder(Side side) => side switch { Side.B => 0, Side.A => 1, _ => 2 };

    /// <summary>atb desc, then final Speed desc, then side B → A → N, then the lower hero id.</summary>
    private static Comparison<BattleHero> TurnOrder(BattleState state, ContentRegistry content) => (a, b) =>
    {
        if (a.Atb != b.Atb) return Math.Sign(b.Atb - a.Atb);
        double sa = Modifiers.StatInBattle(state, a, StatName.Speed, content);
        double sb = Modifiers.StatInBattle(state, b, StatName.Speed, content);
        if (sa != sb) return Math.Sign(sb - sa);
        if (a.Side != b.Side) return SideOrder(a.Side) - SideOrder(b.Side);
        return JsSort.Less(a.Id, b.Id) ? -1 : 1;
    };

    /// <summary>Summons take no turns of their own, so they never enter the bar.</summary>
    private static List<BattleHero> OnTheBar(BattleState state) => Query.LivingHeroes(state).Where(h => h.Summon is null).ToList();

    public static List<BattleHero> ReadyHeroes(BattleState state, ContentRegistry content)
    {
        double threshold = content.Config.Battle.AtbThreshold;
        return JsSort.Stable(OnTheBar(state).Where(h => h.Atb >= threshold), TurnOrder(state, content));
    }

    private static BattleState TickOnce(BattleState state, ContentRegistry content)
    {
        var next = state;
        // Speeds are read from the state before the tick: a tick moves bars, not stats.
        foreach (var hero in OnTheBar(state))
        {
            double speed = Modifiers.StatInBattle(state, hero, StatName.Speed, content);
            next = Query.UpdateHero(next, hero.Id, h => h with { Atb = h.Atb + speed });
        }
        return next with { Tick = next.Tick + 1 };
    }

    /// <summary>
    /// Moves the clock until somebody is ready and makes them the active hero. If someone
    /// is already over the threshold no ticks happen, which banks a fast hero's double turn.
    /// </summary>
    public static (BattleState State, string? HeroId) AdvanceToNextTurn(BattleState state, ContentRegistry content)
    {
        if (OnTheBar(state).Count == 0) return (state with { ActiveHeroId = null }, null);

        var next = state;
        int guard = 0;
        while (ReadyHeroes(next, content).Count == 0)
        {
            next = TickOnce(next, content);
            if (++guard > 10000) throw new InvalidOperationException("ATB failed to advance: is minSpeed positive?");
        }

        var first = ReadyHeroes(next, content).FirstOrDefault();
        if (first is null) return (next with { ActiveHeroId = null }, null);

        int round = next.Tick / content.Config.Battle.TicksPerRound + 1;
        return (next with { ActiveHeroId = first.Id, Round = round }, first.Id);
    }

    /// <summary>Who is likely to act over the next `count` turns, for the queue panel: a dry run.</summary>
    public static List<string> PredictTurnOrder(BattleState state, ContentRegistry content, int count)
    {
        double threshold = content.Config.Battle.AtbThreshold;
        var simulated = state;
        var output = new List<string>();
        for (int i = 0; i < count; i++)
        {
            int guard = 0;
            while (ReadyHeroes(simulated, content).Count == 0)
            {
                simulated = TickOnce(simulated, content);
                if (++guard > 10000) return output;
            }
            var next = ReadyHeroes(simulated, content).FirstOrDefault();
            if (next is null) return output;
            output.Add(next.Id);
            simulated = Query.UpdateHero(simulated, next.Id, h => h with { Atb = h.Atb - threshold });
        }
        return output;
    }
}

/// <summary>Zone of control as an attack of opportunity. A port of battle/opportunity.ts.</summary>
public static class Opportunity
{
    public static string BasicAttackOf(BattleHero hero, ContentRegistry content) => content.GetClass(hero.ClassId).BaseAttack;

    /// <summary>A hero holds a zone of control only if it can actually punish the hex next to it.</summary>
    public static bool HoldsZoneOfControl(BattleHero hero, ContentRegistry content)
    {
        var options = content.Config.Battle.OpportunityAttack;
        if (!options.Enabled) return false;
        if (!options.MeleeOnly) return true;
        return content.GetAbility(BasicAttackOf(hero, content)).Range <= 1;
    }

    /// <summary>Which enemies react to `mover` stepping from `from` to `to`.</summary>
    public static List<BattleHero> ReactorsForStep(
        BattleState state, BattleHero mover, Hex from, Hex to, IReadOnlyList<string> already, ContentRegistry content)
    {
        if (!content.Config.Battle.OpportunityAttack.Enabled) return [];
        if (Modifiers.FreeDisengage(state, mover, content)) return [];
        // "Невидимость": nobody can pick the mover out to swing at.
        if (Statuses.HasFlag(mover, content, Statuses.Untargetable)) return [];
        bool oncePerTurn = content.Config.Battle.OpportunityAttack.OncePerEnemyPerTurn;

        return Query.EnemiesOf(state, mover).Where(enemy =>
        {
            if (oncePerTurn && already.Contains(enemy.Id)) return false;
            if (Statuses.HasStatus(enemy, Statuses.Stun)) return false;
            if (!HoldsZoneOfControl(enemy, content)) return false;
            // Was in contact and no longer is. Shuffling inside the zone does not provoke.
            return HexMath.Distance(enemy.Hex, from) == 1 && HexMath.Distance(enemy.Hex, to) > 1;
        }).ToList();
    }

    /// <summary>Every enemy that would react over a whole path, in the order they would fire.</summary>
    public static List<string> ReactorsForPath(
        BattleState state, BattleHero mover, IReadOnlyList<Hex> path, IReadOnlyList<string> already, ContentRegistry content)
    {
        var seen = already.ToList();
        var fired = new List<string>();
        var from = mover.Hex;
        foreach (var to in path)
        {
            foreach (var enemy in ReactorsForStep(state, mover, from, to, seen, content))
            {
                seen.Add(enemy.Id);
                fired.Add(enemy.Id);
            }
            from = to;
        }
        return fired;
    }
}
