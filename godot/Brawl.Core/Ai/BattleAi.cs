namespace Brawl.Core;

/// <summary>A whole turn the AI picked, and its generator after picking.</summary>
public sealed record AiDecision(IReadOnlyList<BattleAction> Actions, RngState Rng);

/// <summary>A plan: the actions of a whole turn, played out on a copy with the dice frozen.</summary>
public sealed record GeneratedPlan(IReadOnlyList<BattleAction> Actions, BattleState State);

/// <summary>
/// The battle AI, a port of src/ai (index, plans, evaluate, threat, lookahead). It is an
/// ordinary player: it reads the state, asks legalActions, returns actions. Its
/// randomness comes from its own generator, never from the battle's.
/// </summary>
public static class BattleAi
{
    public static AiProfile ProfileByName(ContentRegistry content, string name) =>
        content.Config.Ai.Profiles.Get(name) ?? throw new ContentException($"Unknown AI profile: {name}");

    /// <summary>Picks a whole turn. The caller applies the actions one at a time and re-asks if one became illegal.</summary>
    public static AiDecision ChooseActions(BattleState state, ContentRegistry content, RngState rng, AiProfile profile)
    {
        string? activeId = state.ActiveHeroId;
        if (activeId is null || state.Outcome is not null) return new AiDecision([], rng);

        // A neutral monster plays its own turn inside core; there is nothing to choose.
        var side = state.Heroes.Get(activeId)?.Side ?? Side.B;
        if (side == Side.N) return new AiDecision([], rng);
        var plans = GeneratePlans(state, content, profile.AllowUltimates);

        var current = rng;
        var scored = new List<(GeneratedPlan Plan, double Score, double Factor)>();
        foreach (var plan in plans)
        {
            // Noise multiplies the score, so a weak profile makes reasonable-but-not-best moves.
            double factor = 1;
            if (profile.Noise > 0)
            {
                var (jitter, next) = Rng.NextFloatBetween(current, -profile.Noise, profile.Noise);
                current = next;
                factor = 1 + jitter;
            }
            scored.Add((plan, Evaluate(state, plan.State, side, content, profile) * factor, factor));
        }

        // The stronger profiles look further into the best few.
        if (profile.Lookahead > 0 && scored.Count > 1)
        {
            scored = JsSort.Stable(scored, (a, b) => Math.Sign(b.Score - a.Score));
            var deep = scored.Take(PlansToDeepen(profile.Lookahead, content)).ToList();
            for (int i = 0; i < deep.Count; i++)
            {
                var board = PlayOut(deep[i].Plan.State, activeId, profile.Lookahead, content, profile);
                deep[i] = (deep[i].Plan, Evaluate(state, board, side, content, profile) * deep[i].Factor, deep[i].Factor);
            }
            scored = deep;
        }

        IReadOnlyList<BattleAction> best = [];
        double bestScore = double.NegativeInfinity;
        foreach (var (plan, score, _) in scored)
        {
            if (score > bestScore)
            {
                bestScore = score;
                best = plan.Actions;
            }
        }
        return new AiDecision([.. best, new EndTurnAction { HeroId = activeId }], current);
    }

    // --- plans -----------------------------------------------------------------------

    private const int GroundAimsPerEnd = 3;

    private static bool IsGroundAtom(Effect e) => e is TeleportEffect or TerrainEffect or SummonEffect;

    /// <summary>Hexes worth aiming an ability at: where its shape touches somebody.</summary>
    private static List<Hex> AimPoints(BattleState state, string heroId, Ability ability, ContentRegistry content)
    {
        var hero = Query.HeroById(state, heroId);
        double reach = Legal.AbilityRange(state, hero, ability, content);
        var output = new List<Hex>();
        var ground = new List<Hex>();
        bool onGround = ability.Effects.Any(IsGroundAtom);
        bool relocates = ability.Effects.Any(e => e is MoveEffect);
        foreach (var candidate in Terrain.AllHexes(state.Arena))
        {
            if (HexMath.Distance(hero.Hex, candidate) > reach) continue;
            if (!Legal.AbilityLegality(state, hero, ability, candidate, content).Ok) continue;
            if (!relocates && Targeting.ResolveTargets(state, hero, candidate, ability, content).Count == 0)
            {
                if (onGround) ground.Add(candidate);
                continue;
            }
            output.Add(candidate);
        }
        return [.. output, .. GroundAims(state, hero.Side, ground)];
    }

    /// <summary>A few landing hexes out of many, picked by how far they are from the enemy.</summary>
    private static List<Hex> GroundAims(BattleState state, Side side, List<Hex> candidates)
    {
        var enemies = Query.LivingHeroes(state).Where(h => h.Side != side && h.Summon is null).ToList();
        if (enemies.Count == 0 || candidates.Count == 0) return [];
        var ranked = JsSort.Stable(
            candidates.Select(hex => (Hex: hex, D: enemies.Min(e => HexMath.Distance(e.Hex, hex)))),
            (a, b) => a.D != b.D ? a.D - b.D : JsSort.Less(a.Hex.Key, b.Hex.Key) ? -1 : 1);
        var picked = ranked.Take(GroundAimsPerEnd).Concat(ranked.Skip(Math.Max(GroundAimsPerEnd, ranked.Count - GroundAimsPerEnd)));
        return picked.Select(e => e.Hex).ToList();
    }

    private static List<BattleAction> AbilityActions(BattleState state, string heroId, ContentRegistry content, bool allowUltimates)
    {
        var hero = Query.HeroById(state, heroId);
        var output = new List<BattleAction>();
        foreach (var ability in Legal.AbilitiesOf(hero, content))
        {
            if (!allowUltimates && ability.Tier == 4) continue;
            if (!Legal.AbilityAvailability(state, hero, ability, content).Ok) continue;
            foreach (var target in AimPoints(state, heroId, ability, content))
                output.Add(new AbilityAction { HeroId = hero.Id, AbilityId = ability.Id, Target = target });
        }
        return output;
    }

    private static List<BattleAction> MoveActions(BattleState state, string heroId, ContentRegistry content, int maxSteps)
    {
        var hero = Query.HeroById(state, heroId);
        return Legal.ReachableFor(state, hero, content).Values
            .Where(entry => entry.Path.Count <= maxSteps)
            .Select(entry => (BattleAction)new MoveAction { HeroId = hero.Id, Path = entry.Path })
            .ToList();
    }

    private static string PlanKey(IEnumerable<BattleAction> actions) => string.Join("|", actions.Select(a => a switch
    {
        MoveAction m => "m" + string.Join(">", m.Path.Select(h => h.Key)),
        AbilityAction x => $"a{x.AbilityId}@{x.Target.Key}",
        _ => "e",
    }));

    /// <summary>Every plan worth looking at, already played out with the dice frozen.</summary>
    public static List<GeneratedPlan> GeneratePlans(BattleState state, ContentRegistry content, bool allowUltimates)
    {
        string? activeId = state.ActiveHeroId;
        if (activeId is null) return [];

        int limit = content.Config.Ai.MaxPlans;
        var plans = new List<GeneratedPlan>();
        var seen = new HashSet<string>();

        void Record(List<BattleAction> actions, BattleState result)
        {
            if (plans.Count >= limit) return;
            // Two different routes to the same board are the same plan as far as scoring goes.
            if (!seen.Add(PlanKey(actions))) return;
            plans.Add(new GeneratedPlan(actions, result));
        }

        bool StillActing(BattleState s) => s.ActiveHeroId == activeId && s.Outcome is null;
        BattleState Play(BattleState s, BattleAction a) => BattleRules.ApplyAction(s, a, content, deterministic: true).State;

        // Level 0: do nothing at all.
        Record([], state);

        var firstMoves = new List<(List<BattleAction> Actions, BattleState State)> { ([], state) };
        foreach (var move in MoveActions(state, activeId, content, 4))
        {
            var moved = Play(state, move);
            if (!StillActing(moved))
            {
                Record([move], moved);
                continue;
            }
            firstMoves.Add(([move], moved));
            Record([move], moved);
        }

        foreach (var branch in firstMoves)
        {
            if (plans.Count >= limit) break;
            foreach (var act in AbilityActions(branch.State, activeId, content, allowUltimates))
            {
                if (plans.Count >= limit) break;
                var acted = Play(branch.State, act);
                List<BattleAction> afterOne = [.. branch.Actions, act];
                Record(afterOne, acted);
                if (!StillActing(acted)) continue;

                // Second action from the same spot, then one more short hop and act again.
                foreach (var second in AbilityActions(acted, activeId, content, allowUltimates))
                {
                    if (plans.Count >= limit) break;
                    Record([.. afterOne, second], Play(acted, second));
                }

                foreach (var hop in MoveActions(acted, activeId, content, 2))
                {
                    if (plans.Count >= limit) break;
                    var hopped = Play(acted, hop);
                    Record([.. afterOne, hop], hopped);
                    if (!StillActing(hopped)) continue;
                    foreach (var third in AbilityActions(hopped, activeId, content, allowUltimates))
                    {
                        if (plans.Count >= limit) break;
                        Record([.. afterOne, hop, third], Play(hopped, third));
                    }
                }
            }
        }
        return plans;
    }

    // --- the utility function ----------------------------------------------------------

    private static double ReachPenalty(BattleState state, Side side, ContentRegistry content)
    {
        double total = 0;
        foreach (var hero in Query.LivingHeroes(state))
        {
            if (hero.Side != side) continue;
            var enemies = Query.LivingHeroes(state).Where(h => h.Side != side).ToList();
            if (enemies.Count == 0) continue;
            int nearest = enemies.Min(e => HexMath.Distance(hero.Hex, e.Hex));
            int reach = content.GetAbility(Opportunity.BasicAttackOf(hero, content)).Range;
            total += Math.Max(0, nearest - reach);
        }
        return total;
    }

    private static double UltimatesHeld(BattleState state, Side side, ContentRegistry content)
    {
        double count = 0;
        foreach (var hero in Query.LivingHeroes(state))
        {
            if (hero.Side != side) continue;
            foreach (var ability in Legal.AbilitiesOf(hero, content))
                if (ability.Tier == 4 && Legal.CooldownLeft(hero, ability) == 0) count++;
        }
        return count;
    }

    private static double SummonValue(BattleState state, Side side)
    {
        double total = 0;
        foreach (var unit in Query.LivingHeroes(state))
        {
            if (unit.Summon is null) continue;
            var attack = unit.Summon.Attack;
            double power = attack.Scale == ScaleStat.Magic ? unit.Base.Magic : unit.Base.Attack;
            double worth = power * attack.K * unit.Summon.TurnsLeft;
            total += unit.Side == side ? worth : -worth;
        }
        return total;
    }

    private static double TrapsNearEnemies(BattleState state, Side side, ContentRegistry content)
    {
        int reach = content.Config.Battle.ApPerTurn;
        double count = 0;
        foreach (var laid in state.TemporaryTerrain)
        {
            if (laid.Terrain != TerrainId.Trap) continue;
            var owner = state.Heroes.Get(laid.OwnerId);
            if (owner is null || owner.Side != side) continue;
            bool near = Query.LivingHeroes(state).Any(h => h.Side != side && h.Side != Side.N && h.Summon is null && HexMath.Distance(h.Hex, laid.Hex) <= reach);
            if (near) count++;
        }
        return count;
    }

    private static double OnCollapse(BattleState state, Side side) =>
        Query.LivingHeroes(state).Count(h => h.Side == side && h.Summon is null && Terrain.TerrainAt(state.Arena, h.Hex) == TerrainId.Collapse);

    private static double OnPowerPoint(BattleState state, Side side, ContentRegistry content)
    {
        if (ArenaModifiers.HoldToWin(state, content) is null) return 0;
        var centre = ArenaModifiers.CentreHex(state.Arena);
        var holder = Query.LivingHeroes(state).FirstOrDefault(h => h.Summon is null && h.Hex == centre);
        if (holder is null) return 0;
        return holder.Side == side ? 1 : -1;
    }

    private static double OnHighGround(BattleState state, Side side) =>
        Query.LivingHeroes(state).Count(h => h.Side == side && h.Summon is null && Terrain.IsHigh(state.Arena, h.Hex));

    /// <summary>Scores a finished state from one side's point of view, against the state the turn started in.</summary>
    public static double Evaluate(BattleState before, BattleState after, Side side, ContentRegistry content, AiProfile profile)
    {
        var w = content.Config.Ai.Weights;
        var hpBefore = Query.AllHeroes(before).ToDictionary(h => h.Id, h => h.Hp);
        var hpAfter = Query.AllHeroes(after).ToDictionary(h => h.Id, h => h.Hp);

        double damageDealt = 0, overkill = 0, kills = 0, hpLost = 0, healing = 0, focus = 0, neutralDamage = 0, guardianKills = 0;

        foreach (var hero in Query.AllHeroes(after))
        {
            double was = hpBefore.TryGetValue(hero.Id, out double b) ? b : hero.Hp;
            double now = hpAfter.TryGetValue(hero.Id, out double a) ? a : hero.Hp;
            double delta = was - now;

            if (hero.Side == side)
            {
                if (delta > 0) hpLost += delta;
                else healing += -delta;
                continue;
            }

            if (hero.Side == Side.N)
            {
                if (delta > 0) neutralDamage += Math.Min(delta, was);
                if (was > 0 && now <= 0) guardianKills++;
                continue;
            }

            if (delta > 0)
            {
                double useful = Math.Min(delta, was);
                damageDealt += useful;
                overkill += delta - useful;
                if (was / hero.Base.MaxHp < 0.6) focus += useful;
            }
            else if (delta < 0)
            {
                damageDealt += delta;
            }

            if (was > 0 && now <= 0 && hero.Summon is null) kills++;
        }

        double score =
            w.DamageDealt * damageDealt +
            w.Kill * kills +
            w.Overkill * overkill +
            w.HpLost * hpLost +
            w.Healing * healing +
            w.FocusBonus * focus +
            w.DistanceToTarget * ReachPenalty(after, side, content) +
            w.UltimateSaved * UltimatesHeld(after, side, content) +
            w.SummonDamage * SummonValue(after, side) +
            w.TrapNearEnemy * TrapsNearEnemies(after, side, content) +
            w.HighGround * OnHighGround(after, side) +
            w.OnCollapse * OnCollapse(after, side) +
            w.NeutralDamage * neutralDamage +
            w.GuardianKill * guardianKills +
            w.PowerPoint * OnPowerPoint(after, side, content);

        // Control is close to a kill: a hero that cannot act deals no damage either.
        foreach (var hero in Query.LivingHeroes(after))
        {
            if (hero.Side == side) continue;
            foreach (var status in hero.Statuses)
            {
                if (status.Status == "stun") score += w.StunTurn * status.Turns;
                else if (status.Status == "silence") score += w.SilenceTurn * status.Turns;
                else if (status.Status == "dot") score += w.DotDamage * status.Value * status.Turns;
                else if (content.Statuses.Get(status.Status)?.Kind == StatusKind.Debuff) score += w.DebuffTurn * status.Turns;
            }
        }

        if (profile.UseThreat) score += w.Threat * CautionLeft(before, after, side, content) * ThreatAgainst(after, side, content);
        return score;
    }

    /// <summary>
    /// How much the hit waiting in the enemy's reach still matters, from 1 down to 0.
    /// Keeping out of reach is how a standoff starts: whoever steps in first is hit first.
    /// Waiting pays only a side that the round limit would declare the winner, so for the
    /// other side the fear fades as the limit comes closer, and by its last round is gone.
    /// </summary>
    private static double CautionLeft(BattleState before, BattleState after, Side side, ContentRegistry content)
    {
        if (Victory.RoundLimitLeader(after) == side) return 1;
        double limit = content.Config.Battle.MaxRounds;
        return Math.Max(0, (limit - before.Round) / limit);
    }

    /// <summary>How much damage the other side could put on my heroes next turn; cheap on purpose.</summary>
    public static double ThreatAgainst(BattleState state, Side side, ContentRegistry content)
    {
        var mine = Query.LivingHeroes(state).Where(h => h.Side == side).ToList();
        var theirs = Query.LivingHeroes(state).Where(h => h.Side != side).ToList();
        double stride = content.Config.Battle.ApPerTurn;

        double total = 0;
        foreach (var victim in mine)
        {
            double worst = 0;
            foreach (var attacker in theirs)
            {
                int gap = HexMath.Distance(attacker.Hex, victim.Hex);
                foreach (var ability in Legal.AbilitiesOf(attacker, content))
                {
                    if (Legal.CooldownLeft(attacker, ability) != 0) continue;
                    double cost = Legal.AbilityApCost(attacker, ability, content);
                    if (cost > stride) continue;
                    double steps = stride - cost;
                    if (gap > Legal.AbilityRange(state, attacker, ability, content) + steps) continue;
                    foreach (var effect in ability.Effects.OfType<DamageEffect>())
                    {
                        var hit = Formulas.ComputeDamage(state, attacker, victim, effect, content, state.Rng, RollMode.Fixed, ability.Tier);
                        worst = Math.Max(worst, hit.Final * (effect.Hits ?? 1));
                    }
                }
            }
            total += worst;
        }
        return total;
    }

    // --- looking ahead -----------------------------------------------------------------

    /// <summary>The board once the hero who was acting has ended its turn, if it has not already.</summary>
    public static BattleState CloseTurn(BattleState state, string? actingId, ContentRegistry content)
    {
        if (actingId is null || state.Outcome is not null || state.ActiveHeroId != actingId) return state;
        var hero = state.Heroes.Get(actingId);
        if (hero is null) return state;
        return BattleRules.ApplyAction(state, new EndTurnAction { HeroId = hero.Id }, content, deterministic: true).State;
    }

    /// <summary>The board after whoever acts now plays the turn best for their own side, with no noise.</summary>
    public static BattleState BestReply(BattleState state, ContentRegistry content, AiProfile profile)
    {
        string? activeId = state.ActiveHeroId;
        if (activeId is null || state.Outcome is not null) return state;
        var side = state.Heroes.Get(activeId)?.Side;
        if (side is null || side == Side.N) return state;

        var calm = profile with { Noise = 0, Lookahead = 0 };
        BattleState? best = null;
        double bestScore = double.NegativeInfinity;
        foreach (var plan in GeneratePlans(state, content, profile.AllowUltimates))
        {
            double score = Evaluate(state, plan.State, side.Value, content, calm);
            if (score > bestScore)
            {
                bestScore = score;
                best = plan.State;
            }
        }
        return CloseTurn(best ?? state, activeId, content);
    }

    public static int PlansToDeepen(int depth, ContentRegistry content)
    {
        var top = content.Config.Ai.LookaheadTopPlans;
        int index = Math.Min(depth, top.Count) - 1;
        return index >= 0 && index < top.Count ? top[index] : 0;
    }

    public static BattleState PlayOut(BattleState plan, string actingId, int depth, ContentRegistry content, AiProfile profile)
    {
        var board = CloseTurn(plan, actingId, content);
        for (int ply = 0; ply < depth && board.Outcome is null; ply++) board = BestReply(board, content, profile);
        return board;
    }
}
