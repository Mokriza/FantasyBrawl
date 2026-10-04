namespace Brawl.Core;

/// <summary>
/// applyAction: the only way a battle changes, a port of battle/apply.ts. It never
/// mutates the state it is given, and throws on an action legalActions would not offer.
/// </summary>
public static class BattleRules
{
    private sealed class Run(BattleState state)
    {
        public BattleState State = state;
        public readonly List<BattleEvent> Events = [];

        public void Take(Run other)
        {
            State = other.State;
            Events.AddRange(other.Events);
        }

        public void Take(Reaction reaction)
        {
            State = reaction.State;
            Events.AddRange(reaction.Events);
        }
    }

    private static RollMode ModeOf(bool deterministic) => deterministic ? RollMode.Fixed : RollMode.Random;

    // --- running an ability --------------------------------------------------------

    /// <summary>Atoms that act on the aimed hex rather than on a hero.</summary>
    private static bool IsGroundAtom(Effect effect) => effect is TeleportEffect or TerrainEffect or SummonEffect;

    private static Run RunAbilityEffects(
        BattleState state,
        BattleHero caster,
        Ability ability,
        Hex aimedAt,
        ContentRegistry content,
        RollMode mode,
        bool casterIsActing,
        double mulScale = 1)
    {
        var run = new Run(state);

        // Ground atoms run once per cast, before any per-target atom, on the aimed hex.
        foreach (var effect in ability.Effects)
        {
            if (!IsGroundAtom(effect)) continue;
            var ctx = new EffectContext
            {
                State = run.State,
                CasterId = caster.Id,
                Ability = ability,
                TargetId = null,
                AimedAt = aimedAt,
                Mul = mulScale,
                Content = content,
                Mode = mode,
                CasterIsActing = casterIsActing,
                IgnoresZoc = true,
                LastDamage = 0,
                LastCrit = false,
                LastKilled = false,
            };
            var outcome = Atoms.Apply(ctx, effect);
            run.State = outcome.State;
            run.Events.AddRange(outcome.Events);
            run.Take(React(run.State, outcome.Events, content, mode));
        }

        var targets = Targeting.ResolveTargets(run.State, Query.HeroById(run.State, caster.Id), aimedAt, ability, content);

        // A caster-relocating ability has no hero target of its own; run it once on nobody.
        bool movesCaster = ability.Effects.Any(e => e is MoveEffect);
        var slots = targets.Count > 0
            ? targets.Select(t => ((string?)t.Hero.Id, t.Mul)).ToList()
            : movesCaster ? [((string?)null, 1.0)] : [];

        foreach (var (slotHero, slotMul) in slots)
        {
            var ctx = new EffectContext
            {
                State = run.State,
                CasterId = caster.Id,
                Ability = ability,
                TargetId = slotHero,
                AimedAt = aimedAt,
                Mul = slotMul * mulScale,
                Content = content,
                Mode = mode,
                CasterIsActing = casterIsActing,
                IgnoresZoc = ability.IgnoresZoc == true,
                LastDamage = 0,
                LastCrit = false,
                LastKilled = false,
            };

            foreach (var effect in ability.Effects)
            {
                if (IsGroundAtom(effect)) continue;
                // Atoms aimed at a hero an earlier atom already killed are skipped.
                bool targetDead = ctx.TargetId is not null && !Query.HeroById(ctx.State, ctx.TargetId).IsAlive;
                if (targetDead && !Atoms.ActsOnCaster(effect)) continue;

                var outcome = Atoms.Apply(ctx, effect);
                run.State = outcome.State;
                run.Events.AddRange(outcome.Events);

                // Passives answer each atom as it lands.
                run.Take(React(run.State, outcome.Events, content, mode));

                if (outcome.Provoked is { Count: > 0 })
                    run.Take(ResolveOpportunityAttacks(run.State, caster.Id, outcome.Provoked, caster.Hex, content, mode));

                ctx = ctx with
                {
                    State = run.State,
                    LastDamage = outcome.LastDamage ?? ctx.LastDamage,
                    LastCrit = outcome.LastCrit ?? ctx.LastCrit,
                    LastKilled = outcome.LastKilled ?? ctx.LastKilled,
                };
            }
        }
        return run;
    }

    /// <summary>Shows new events to every trait on the field.</summary>
    private static Reaction React(BattleState state, IReadOnlyList<BattleEvent> events, ContentRegistry content, RollMode mode) =>
        Triggers.ReactTo(state, events, content, mode, RerunWith(content));

    /// <summary>The "echo" atom's way back into running an ability.</summary>
    private static Rerun RerunWith(ContentRegistry content) => (state, heroId, abilityId, target, mul, mode) =>
    {
        var hero = Query.HeroById(state, heroId);
        if (!hero.IsAlive) return new Reaction(state, []);
        var ability = content.GetAbility(abilityId);
        var run = RunAbilityEffects(state, hero, ability, target, content, mode, state.ActiveHeroId == heroId, mul);
        return new Reaction(run.State, run.Events);
    };

    /// <summary>A free basic attack from each reacting enemy, against the hero that broke away.</summary>
    private static Run ResolveOpportunityAttacks(BattleState state, string moverId, IReadOnlyList<string> attackers, Hex leaving, ContentRegistry content, RollMode mode)
    {
        var run = new Run(state);
        foreach (string attackerId in attackers)
        {
            var mover = Query.HeroById(run.State, moverId);
            if (!mover.IsAlive) break;
            var attacker = Query.HeroById(run.State, attackerId);
            if (!attacker.IsAlive) continue;

            run.Events.Add(new OpportunityAttackEvent(attackerId, moverId, leaving));
            var basic = content.GetAbility(Opportunity.BasicAttackOf(attacker, content));
            // The swing is free: no AP, no cooldown, on the hex the mover is leaving.
            run.Take(RunAbilityEffects(run.State, attacker, basic, mover.Hex, content, mode, false));
            run.State = Query.UpdateHero(run.State, moverId, hero => hero with { ReactedThisTurn = [.. hero.ReactedThisTurn, attackerId] });
        }
        return run;
    }

    // --- things that live across turns ---------------------------------------------

    private static EffectContext BareContext(BattleState state, string casterId, string targetId, ContentRegistry content, RollMode mode) => new()
    {
        State = state,
        CasterId = casterId,
        Ability = null,
        TargetId = targetId,
        AimedAt = Query.HeroById(state, targetId).Hex,
        Mul = 1,
        Content = content,
        Mode = mode,
        CasterIsActing = state.ActiveHeroId == casterId,
        IgnoresZoc = true,
        LastDamage = 0,
        LastCrit = false,
        LastKilled = false,
    };

    private static Run RunBare(EffectContext ctx, IReadOnlyList<Effect> effects, ContentRegistry content, RollMode mode)
    {
        var run = new Run(ctx.State);
        var current = ctx;
        foreach (var effect in effects)
        {
            if (current.TargetId is not null && !Query.HeroById(run.State, current.TargetId).IsAlive) break;
            var outcome = Atoms.Apply(current, effect);
            run.State = outcome.State;
            run.Events.AddRange(outcome.Events);
            run.Take(React(run.State, outcome.Events, content, mode));
            current = current with { State = run.State };
        }
        return run;
    }

    /// <summary>Abilities cast with a delay ("Метеор") land at the start of their caster's turn.</summary>
    private static Run LandPending(BattleState state, string heroId, ContentRegistry content, RollMode mode)
    {
        var run = new Run(state);
        var due = new List<PendingAbility>();
        var keep = new List<PendingAbility>();
        foreach (var pending in state.Pending)
        {
            if (pending.CasterId != heroId) keep.Add(pending);
            else if (pending.Turns <= 1) due.Add(pending);
            else keep.Add(pending with { Turns = pending.Turns - 1 });
        }
        run.State = run.State with { Pending = keep };
        foreach (var pending in due)
        {
            var caster = Query.HeroById(run.State, pending.CasterId);
            if (!caster.IsAlive) continue;
            var ability = content.GetAbility(pending.AbilityId);
            run.Events.Add(new AbilityUsedEvent(caster.Id, pending.AbilityId, pending.Target, 0));
            run.Take(RunAbilityEffects(run.State, caster, ability, pending.Target, content, mode, true));
        }
        return run;
    }

    /// <summary>Each living summon of this owner hits the nearest enemy within its reach.</summary>
    private static Run SummonsStrike(BattleState state, string ownerId, ContentRegistry content, RollMode mode)
    {
        var run = new Run(state);
        foreach (var unit in state.Heroes.Values)
        {
            if (unit.Summon is null || unit.Summon.OwnerId != ownerId) continue;
            var self = Query.HeroById(run.State, unit.Id);
            if (!self.IsAlive || self.Summon is null) continue;
            int reach = self.Summon.Attack.Radius;
            var target = JsSort.Stable(
                    Query.LivingHeroes(run.State).Where(h =>
                        h.Side != self.Side && HexMath.Distance(h.Hex, self.Hex) <= reach && !Statuses.HiddenFrom(self.Side, h, content)),
                    (a, b) =>
                    {
                        int d = HexMath.Distance(a.Hex, self.Hex) - HexMath.Distance(b.Hex, self.Hex);
                        return d != 0 ? d : JsSort.Less(a.Id, b.Id) ? -1 : 1;
                    })
                .FirstOrDefault();
            if (target is null) continue;
            var attack = self.Summon.Attack;
            var strike = new DamageEffect { Type = "damage", School = attack.School, Scale = attack.Scale, K = attack.K };
            run.Take(RunBare(BareContext(run.State, self.Id, target.Id, content, mode), [strike], content, mode));
        }
        return run;
    }

    /// <summary>"Древний страж" strikes one neighbour.</summary>
    private static Run GuardianStrikes(BattleState state, string id, ContentRegistry content, RollMode mode)
    {
        var run = new Run(state);
        var rules = Guardian.Rules(state, content);
        var self = Query.HeroById(state, id);
        var target = Guardian.Target(state, self, h => HexMath.Distance(h.Hex, self.Hex) == 1 && !Statuses.HiddenFrom(self.Side, h, content));
        if (rules is null || target is null) return run;
        var strike = new DamageEffect { Type = "damage", School = DamageSchool.Physical, Scale = ScaleStat.Attack, K = rules.K };
        run.Take(RunBare(BareContext(run.State, self.Id, target.Id, content, mode), [strike], content, mode));
        return run;
    }

    private static OrderedMap<TerrainId> RestoreTerrain(OrderedMap<TerrainId> terrain, TemporaryTerrain laid) =>
        laid.Previous is null ? terrain.Remove(laid.Hex.Key) : terrain.Set(laid.Hex.Key, laid.Previous.Value);

    /// <summary>
    /// The end of a turn ticks what its hero left behind: temporary terrain and summons.
    /// What belongs to a dead hero ticks on everyone's turns instead.
    /// </summary>
    private static Run TickLeftovers(BattleState state, string heroId)
    {
        var run = new Run(state);
        bool Ticks(string ownerId)
        {
            var owner = run.State.Heroes.Get(ownerId);
            return ownerId == heroId || owner is null || !owner.IsAlive;
        }

        var terrain = run.State.Arena.Terrain;
        var kept = new List<TemporaryTerrain>();
        foreach (var laid in run.State.TemporaryTerrain)
        {
            if (!Ticks(laid.OwnerId)) kept.Add(laid);
            else if (laid.Turns > 1) kept.Add(laid with { Turns = laid.Turns - 1 });
            else
            {
                terrain = RestoreTerrain(terrain, laid);
                run.Events.Add(new TerrainChangedEvent(laid.Hex, laid.Previous));
            }
        }
        run.State = run.State with { Arena = run.State.Arena with { Terrain = terrain }, TemporaryTerrain = kept };

        foreach (var unit in run.State.Heroes.Values)
        {
            if (unit.Summon is null || !unit.IsAlive || !Ticks(unit.Summon.OwnerId)) continue;
            int left = unit.Summon.TurnsLeft - 1;
            if (left > 0)
            {
                run.State = Query.UpdateHero(run.State, unit.Id, h => h with { Summon = h.Summon is null ? null : h.Summon with { TurnsLeft = left } });
            }
            else
            {
                run.State = Query.UpdateHero(run.State, unit.Id, h => h with { Hp = 0, Statuses = [] });
                run.Events.Add(new DiedEvent(unit.Id));
            }
        }
        return run;
    }

    /// <summary>A trap an enemy of this hero laid, sprung by walking in: its effects, then it is gone.</summary>
    private static Run SpringTrap(BattleState state, string heroId, Hex hex, ContentRegistry content, RollMode mode)
    {
        var run = new Run(state);
        var mover = Query.HeroById(state, heroId);
        var trap = state.TemporaryTerrain.FirstOrDefault(t =>
        {
            var owner = state.Heroes.Get(t.OwnerId);
            return t.Terrain == TerrainId.Trap && t.Hex == hex && owner is not null && owner.Side != mover.Side;
        });
        if (trap is null) return run;

        run.State = run.State with
        {
            Arena = run.State.Arena with { Terrain = RestoreTerrain(run.State.Arena.Terrain, trap) },
            TemporaryTerrain = run.State.TemporaryTerrain.Where(t => !ReferenceEquals(t, trap)).ToList(),
        };
        run.Events.Add(new TerrainChangedEvent(hex, trap.Previous));
        run.Take(RunBare(BareContext(run.State, trap.OwnerId, heroId, content, mode), trap.OnEnter, content, mode));
        return run;
    }

    // --- turn boundaries -----------------------------------------------------------

    private static (BattleState State, List<BattleEvent> Events) Hurt(BattleState state, string id, double amount, string? sourceId, ContentRegistry content)
    {
        var hurt = Damage.DamageHero(state, id, 0, amount, content);
        return (hurt.State, [new DamagedEvent(id, sourceId, hurt.Dealt, false, DamageSchool.Pure) { Periodic = true }, .. hurt.Events]);
    }

    /// <summary>Start of turn: announce, tick poison, check stun, then hand out action points.</summary>
    private static Run StartTurn(BattleState state, ContentRegistry content, RollMode mode)
    {
        string? id = state.ActiveHeroId;
        if (id is null) return new Run(state);

        var next = state;
        var rest = new List<BattleEvent>();

        // "Точка силы": a new round credits the side standing on the centre with the last one.
        if (ArenaModifiers.HoldToWin(next, content) is not null && next.Round > next.Hold.Round)
        {
            var centre = ArenaModifiers.CentreHex(next.Arena);
            var holder = Query.LivingHeroes(next).FirstOrDefault(h => h.Summon is null && h.Hex == centre);
            var hold = holder?.Side switch
            {
                Side.A => next.Hold with { A = next.Hold.A + 1, Round = next.Round },
                Side.B => next.Hold with { B = next.Hold.B + 1, Round = next.Round },
                _ => next.Hold with { Round = next.Round },
            };
            next = next with { Hold = hold };
        }

        // "Сужающаяся арена": a ring whose time has come falls before anyone acts.
        var fallen = ArenaModifiers.HexesToCollapse(next, content);
        if (fallen.Count > 0)
        {
            var keys = new HashSet<string>(fallen.Select(h => h.Key));
            var terrain = next.Arena.Terrain;
            foreach (string key in fallen.Select(h => h.Key).Distinct()) terrain = terrain.Set(key, TerrainId.Collapse);
            next = next with
            {
                Arena = next.Arena with { Terrain = terrain },
                TemporaryTerrain = next.TemporaryTerrain.Where(t => !keys.Contains(t.Hex.Key)).ToList(),
            };
            foreach (var hex in fallen) rest.Add(new TerrainChangedEvent(hex, TerrainId.Collapse));
        }

        // Statuses and perks that move apPerTurn, never below zero.
        double ap = Math.Max(0, content.Config.Battle.ApPerTurn + Modifiers.Sum(next, Query.HeroById(next, id), ModifierStat.ApPerTurn, content).Add);

        // Poison ticks once per source, so each stack is credited to whoever laid it.
        var bySource = OrderedMap<(string? SourceId, double Amount)>.Empty;
        foreach (var stack in Statuses.StatusesOf(Query.HeroById(next, id), Statuses.Dot))
        {
            string key = stack.SourceId ?? "";
            var entry = bySource.TryGetValue(key, out var found) ? found : (stack.SourceId, 0.0);
            bySource = bySource.Set(key, (entry.Item1, entry.Item2 + stack.Value));
        }
        double dotMul = ArenaModifiers.DotMultiplier(next, content);
        foreach (var (sourceId, amount) in bySource.Values)
        {
            if (!Query.HeroById(next, id).IsAlive) break;
            // "Шторм маны" doubles it.
            var (afterDot, dotEvents) = Hurt(next, id, JsMath.Round(amount * dotMul), sourceId, content);
            next = afterDot;
            rest.AddRange(dotEvents);
        }

        // "Пакт крови" and the like: a share of maximum health, every turn.
        double drain = Query.HeroById(next, id).Statuses.Aggregate(0.0, (sum, s) =>
        {
            double pct = content.Statuses.Get(s.Status)?.DrainPctMaxHp ?? 0;
            return sum + JsMath.Round(Query.HeroById(next, id).Base.MaxHp * pct);
        });
        if (drain > 0 && Query.HeroById(next, id).IsAlive)
        {
            var (afterDrain, drainEvents) = Hurt(next, id, drain, null, content);
            next = afterDrain;
            rest.AddRange(drainEvents);
        }

        // "Сужающаяся арена": standing on the fallen edge hurts, every turn.
        double ring = ArenaModifiers.CollapseDamage(next, content);
        if (ring > 0 && Query.HeroById(next, id).IsAlive && Terrain.TerrainAt(next.Arena, Query.HeroById(next, id).Hex) == TerrainId.Collapse)
        {
            var (afterRing, ringEvents) = Hurt(next, id, ring, null, content);
            next = afterRing;
            rest.AddRange(ringEvents);
        }

        var announced = new TurnStartedEvent(id, ap);
        var reacted = React(next, [announced, .. rest], content, mode);
        next = reacted.State;
        rest.AddRange(reacted.Events);

        // What was set in motion earlier lands now: a delayed ability, a summon's strike.
        if (Query.HeroById(next, id).IsAlive)
        {
            var landed = LandPending(next, id, content, mode);
            next = landed.State;
            rest.AddRange(landed.Events);
            var struck = SummonsStrike(next, id, content, mode);
            next = struck.State;
            rest.AddRange(struck.Events);
        }

        // "Древний страж" plays its own turn: one strike, then it passes.
        if (Query.HeroById(next, id).Side == Side.N)
        {
            if (Query.HeroById(next, id).IsAlive && !Statuses.HasStatus(Query.HeroById(next, id), Statuses.Stun))
            {
                var struck = GuardianStrikes(next, id, content, mode);
                next = struck.State;
                rest.AddRange(struck.Events);
            }
            ap = 0;
        }

        // Died to poison or to a passive: no action points, and the turn ends.
        if (!Query.HeroById(next, id).IsAlive) ap = 0;

        if (ap > 0 && Statuses.HasStatus(Query.HeroById(next, id), Statuses.Stun))
        {
            rest.Add(new TurnSkippedEvent(id, Statuses.Stun));
            ap = 0;
        }

        var run = new Run(next with { ApLeft = ap });
        run.Events.Add(new TurnStartedEvent(id, ap));
        run.Events.AddRange(rest);
        return run;
    }

    /// <summary>End of turn.</summary>
    private static Run FinishTurn(BattleState state, ContentRegistry content, RollMode mode)
    {
        var run = new Run(state);
        string? id = state.ActiveHeroId;
        if (id is null) return run;

        var ended = new TurnEndedEvent(id);
        run.Events.Add(ended);
        // "At the end of the turn" happens while the turn is still the hero's own.
        run.Take(React(run.State, [ended], content, mode));

        var ending = Query.HeroById(run.State, id);
        double recovery = Modifiers.Sum(run.State, ending, ModifierStat.CooldownRecovery, content).Add + ArenaModifiers.CooldownBonus(run.State, content);
        var ticked = Statuses.TickHeroAtTurnEnd(ending, recovery);
        run.State = Query.UpdateHero(run.State, id, _ => ticked.Hero);
        run.Events.AddRange(ticked.Events);

        double threshold = content.Config.Battle.AtbThreshold;
        run.State = Query.UpdateHero(run.State, id, hero => hero with
        {
            Atb = hero.Atb - threshold,
            Counters = hero.Counters.Set(Modifiers.MovesThisTurn, 0).Set(Modifiers.FreeStepsUsed, 0).Set(Damage.HurtSinceTurn, 0),
        });
        run.Take(TickLeftovers(run.State, id));
        run.State = run.State with { ApLeft = 0, ActiveHeroId = null, LastActedHeroId = id };
        return run;
    }

    /// <summary>Hands the turn to whoever is next and walks through turns that resolve on their own.</summary>
    private static Run BeginNextTurn(BattleState state, ContentRegistry content, RollMode mode)
    {
        var run = new Run(state);
        for (int guard = 0; guard < 64; guard++)
        {
            var outcome = Victory.CheckOutcome(run.State, content);
            if (outcome is not null)
            {
                run.State = run.State with { Outcome = outcome, ActiveHeroId = null };
                run.Events.Add(new MatchEndedEvent(outcome.Winner, outcome.Reason));
                return run;
            }

            var (advanced, heroId) = Atb.AdvanceToNextTurn(run.State, content);
            run.State = advanced;
            if (heroId is null) return run;

            run.Take(StartTurn(run.State, content, mode));

            // The start of a turn can decide the match by itself.
            var decided = Victory.CheckOutcome(run.State, content);
            if (decided is not null)
            {
                run.State = run.State with { Outcome = decided, ActiveHeroId = null, ApLeft = 0 };
                run.Events.Add(new MatchEndedEvent(decided.Winner, decided.Reason));
                return run;
            }

            if (run.State.ApLeft > 0) return run;

            // The hero could not act at all, so close its turn and look at the next one.
            run.Take(FinishTurn(run.State, content, mode));
        }
        return run;
    }

    /// <summary>Ends the turn when the points are gone or nothing but endTurn is left.</summary>
    private static Run AutoEndTurnIfDone(BattleState state, ContentRegistry content, RollMode mode)
    {
        var run = new Run(state);
        if (run.State.ActiveHeroId is null || run.State.Outcome is not null) return run;
        var hero = Query.HeroById(run.State, run.State.ActiveHeroId);
        bool hasSomethingToDo = hero.IsAlive && run.State.ApLeft > 0 && Legal.HasActionBesidesEndTurn(run.State, content);
        if (hasSomethingToDo) return run;
        run.Take(FinishTurn(run.State, content, mode));
        run.Take(BeginNextTurn(run.State, content, mode));
        return run;
    }

    // --- the entry point -----------------------------------------------------------

    public static ApplyResult ApplyAction(BattleState state, BattleAction action, ContentRegistry content, bool deterministic = false)
    {
        var mode = ModeOf(deterministic);
        var hero = Query.HeroById(state, action.HeroId);
        return action switch
        {
            MoveAction move => ApplyMove(state, move.Path, hero, content, mode),
            AbilityAction ability => ApplyAbility(state, ability.AbilityId, ability.Target, hero, content, mode),
            EndTurnAction => ApplyEndTurn(state, hero, content, mode),
            _ => throw new InvalidOperationException($"Unknown action {action.Type}"),
        };
    }

    private static ApplyResult ApplyMove(BattleState state, IReadOnlyList<Hex> path, BattleHero hero, ContentRegistry content, RollMode mode)
    {
        var legality = Legal.MoveLegality(state, hero, path, content);
        if (!legality.Ok) throw new IllegalActionException($"move by {hero.Id}: {legality.Reason}");

        var run = new Run(state);
        // Free steps: spent step by step, the rest kept for a later move this turn.
        double freeAtStart = Modifiers.FreeStepsLeft(state, hero, content);
        double discount = freeAtStart;
        // "Плащ теней": decided before the move counter goes up, for the whole walk.
        bool free = Modifiers.FreeDisengage(state, hero, content);
        run.State = Query.UpdateHero(run.State, hero.Id, h => h with { Counters = h.Counters.Set(Modifiers.MovesThisTurn, h.Counter(Modifiers.MovesThisTurn) + 1) });

        foreach (var to in path)
        {
            var mover = Query.HeroById(run.State, hero.Id);
            if (!mover.IsAlive) break;
            var from = mover.Hex;

            // The reaction fires while the mover is still on the hex it is leaving.
            var reactors = free ? [] : Opportunity.ReactorsForStep(run.State, mover, from, to, mover.ReactedThisTurn, content);
            if (reactors.Count > 0)
            {
                run.Take(ResolveOpportunityAttacks(run.State, hero.Id, reactors.Select(r => r.Id).ToList(), from, content, mode));
                if (!Query.HeroById(run.State, hero.Id).IsAlive) break;
            }

            double full = Pathing.StepCost(run.State, content, to, Query.HeroById(run.State, hero.Id));
            double waived = Math.Min(discount, full);
            discount -= waived;
            run.State = run.State with { ApLeft = run.State.ApLeft - (full - waived) };
            run.State = Query.UpdateHero(run.State, hero.Id, h => h with { Hex = to });
            run.Events.Add(new MovedEvent(hero.Id, from, to));

            var sprung = SpringTrap(run.State, hero.Id, to, content, mode);
            if (sprung.Events.Count > 0)
            {
                run.Take(sprung);
                // A trap roots or kills: either way the walk ends here.
                var after = Query.HeroById(run.State, hero.Id);
                if (!after.IsAlive || Statuses.HasStatus(after, Statuses.Root)) break;
            }

            if (Terrain.IsPit(run.State.Arena, to) && !Pathing.PitImmune(run.State, Query.HeroById(run.State, hero.Id), content))
            {
                var hurt = Damage.DamageHero(run.State, hero.Id, 0, content.Config.Arena.Pit.Damage, content);
                run.State = hurt.State;
                List<BattleEvent> fell = [new DamagedEvent(hero.Id, null, hurt.Dealt, false, DamageSchool.Pure), .. hurt.Events];
                run.Events.AddRange(fell);
                run.Take(React(run.State, fell, content, mode));
                if (!Query.HeroById(run.State, hero.Id).IsAlive) break;
            }
        }

        double spent = freeAtStart - discount;
        if (spent > 0)
            run.State = Query.UpdateHero(run.State, hero.Id, h => h with { Counters = h.Counters.Set(Modifiers.FreeStepsUsed, h.Counter(Modifiers.FreeStepsUsed) + spent) });

        AnswerEnemyAction(run, hero.Id, content);
        return Settle(run, content, mode);
    }

    private static ApplyResult ApplyAbility(BattleState state, string id, Hex target, BattleHero hero, ContentRegistry content, RollMode mode)
    {
        var ability = content.GetAbility(id);
        var legality = Legal.AbilityLegality(state, hero, ability, target, content);
        if (!legality.Ok) throw new IllegalActionException($"ability {ability.Id} by {hero.Id}: {legality.Reason}");

        var run = new Run(state);
        double ap = Legal.AbilityApCost(hero, ability, content);
        var cooldown = Legal.CooldownOf(hero, ability, content);
        run.State = run.State with { ApLeft = run.State.ApLeft - ap };

        // A cooldown of N comes back N turns later: stored as N and ticked at the end of every turn including this one.
        if (cooldown.Once)
            run.State = Query.UpdateHero(run.State, hero.Id, h => h with { Cooldowns = h.Cooldowns.Set(ability.Id, Legal.OnceCooldown) });
        else if (cooldown.Turns > 0)
            run.State = Query.UpdateHero(run.State, hero.Id, h => h with { Cooldowns = h.Cooldowns.Set(ability.Id, cooldown.Turns) });

        var used = new AbilityUsedEvent(hero.Id, id, target, ap);
        run.Events.Add(used);

        if (ability.Delay is not null)
        {
            // "Метеор": cast now, lands at the start of one of the caster's later turns.
            run.State = run.State with { Pending = [.. run.State.Pending, new PendingAbility(hero.Id, id, target, ability.Delay.Value)] };
            run.Events.Add(new AbilityDelayedEvent(hero.Id, id, target, ability.Delay.Value));
        }
        else
        {
            run.Take(RunAbilityEffects(run.State, Query.HeroById(run.State, hero.Id), ability, target, content, mode, true));
        }

        // "After an ability" passives answer once it has landed. A basic attack does not count.
        if (ability.Basic != true) run.Take(React(run.State, [used], content, mode));

        AnswerEnemyAction(run, hero.Id, content);
        return Settle(run, content, mode);
    }

    private static ApplyResult ApplyEndTurn(BattleState state, BattleHero hero, ContentRegistry content, RollMode mode)
    {
        if (state.ActiveHeroId != hero.Id) throw new IllegalActionException($"endTurn by {hero.Id}: not the active hero");
        if (state.Outcome is not null) throw new IllegalActionException("endTurn: the match is already over");
        var run = new Run(state);
        run.Take(FinishTurn(run.State, content, mode));
        run.Take(BeginNextTurn(run.State, content, mode));
        return new ApplyResult(run.State, run.Events);
    }

    /// <summary>"Состояние потока": after a move or an ability, enemies watching for it gain initiative.</summary>
    private static void AnswerEnemyAction(Run run, string actorId, ContentRegistry content)
    {
        var actor = run.State.Heroes.Get(actorId);
        if (actor is null) return;
        foreach (var watcher in Query.LivingHeroes(run.State))
        {
            if (watcher.Side == actor.Side) continue;
            double delta = 0;
            foreach (var instance in watcher.Statuses)
            {
                var watch = content.Statuses.Get(instance.Status)?.AtbOnEnemyAction;
                if (watch is not null && HexMath.Distance(actor.Hex, watcher.Hex) <= watch.Radius) delta = Math.Max(delta, watch.Delta);
            }
            if (delta == 0) continue;
            double atb = Math.Max(0, watcher.Atb + delta);
            run.State = Query.UpdateHero(run.State, watcher.Id, h => h with { Atb = atb });
            run.Events.Add(new AtbChangedEvent(watcher.Id, atb - watcher.Atb, atb));
        }
    }

    /// <summary>Closes an action: check the match, then end the turn if there is nothing left.</summary>
    private static ApplyResult Settle(Run run, ContentRegistry content, RollMode mode)
    {
        var outcome = Victory.CheckOutcome(run.State, content);
        if (outcome is not null)
        {
            return new ApplyResult(
                run.State with { Outcome = outcome, ActiveHeroId = null, ApLeft = 0 },
                [.. run.Events, new MatchEndedEvent(outcome.Winner, outcome.Reason)]);
        }
        var auto = AutoEndTurnIfDone(run.State, content, mode);
        return new ApplyResult(auto.State, [.. run.Events, .. auto.Events]);
    }

    // --- starting a match ----------------------------------------------------------

    /// <summary>Kicks the clock off and hands the first turn out.</summary>
    public static ApplyResult StartBattle(BattleState state, ContentRegistry content)
    {
        var mode = RollMode.Random;
        var prepared = state;
        foreach (var hero in Query.LivingHeroes(state))
        {
            double bonus = Modifiers.StartAtbBonus(state, hero, content);
            if (bonus > 0) prepared = Query.UpdateHero(prepared, hero.Id, h => h with { Atb = h.Atb + bonus });
        }

        var next = BeginNextTurn(prepared, content, mode);
        string? first = next.State.ActiveHeroId;
        if (first is null) return new ApplyResult(next.State, next.Events);

        var started = new BattleStartedEvent(first);
        var reacted = React(next.State, [started], content, mode);
        return new ApplyResult(reacted.State, [started, .. reacted.Events, .. next.Events]);
    }

    public static bool IsOver(BattleState state) => state.Outcome is not null || Query.LivingHeroes(state).Count == 0;
}
