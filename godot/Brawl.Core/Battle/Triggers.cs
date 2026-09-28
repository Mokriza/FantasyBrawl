namespace Brawl.Core;

public sealed record Reaction(BattleState State, IReadOnlyList<BattleEvent> Events);

/// <summary>Runs an ability once more, for the "echo" atom; handed in by the action runner.</summary>
public delegate Reaction Rerun(BattleState state, string heroId, string abilityId, Hex target, double mul, RollMode mode);

/// <summary>
/// Triggers: the reactive part of traits, a port of battle/triggers.ts. What a trigger's
/// effects produce is shown to the triggers again, down to config.battle.maxTriggerDepth.
/// </summary>
public static class Triggers
{
    private sealed record TriggerAbility(string Id, Hex Target);

    private sealed record Firing(
        BattleHero Owner,
        Trait Trait,
        int Index,
        Trigger Trigger,
        BattleHero? Other,
        double Amount,
        bool Crit,
        bool Killed,
        TriggerAbility? Ability);

    private sealed record Party(
        string OwnerId,
        TriggerEvent On,
        string? OtherId,
        double Amount = 0,
        bool Crit = false,
        bool Killed = false,
        bool Periodic = false,
        DamageSchool? School = null,
        TriggerAbility? Ability = null);

    private static string OccurrenceKey(Trait trait, int index) => $"trigger:{trait.Id}:{index}";

    private static string SpentKey(Trait trait, int index) => $"spent:{trait.Id}:{index}";

    private static List<(Trait Trait, int Index, Trigger Trigger)> Listening(BattleHero owner, TriggerEvent on, ContentRegistry content)
    {
        var output = new List<(Trait, int, Trigger)>();
        foreach (var trait in Modifiers.TraitsOf(owner, content))
            for (int index = 0; index < trait.Triggers.Count; index++)
                if (trait.Triggers[index].On == on) output.Add((trait, index, trait.Triggers[index]));
        return output;
    }

    /// <summary>Who an event concerns, and as what.</summary>
    private static List<Party> PartiesOf(BattleState state, BattleEvent @event, Dictionary<string, string> lastHitter)
    {
        switch (@event)
        {
            case BattleStartedEvent:
                return state.Heroes.Values.Select(hero => new Party(hero.Id, TriggerEvent.BattleStart, null)).ToList();
            case TurnStartedEvent e:
            {
                var output = new List<Party> { new(e.HeroId, TriggerEvent.TurnStart, null) };
                // Enemies standing next to whoever starts: "Оковы судьбы" and its kind.
                var starter = state.Heroes.Get(e.HeroId);
                if (starter is not null)
                {
                    foreach (var enemy in Query.LivingHeroes(state))
                    {
                        if (enemy.Side == starter.Side || HexMath.Distance(enemy.Hex, starter.Hex) != 1) continue;
                        output.Add(new Party(enemy.Id, TriggerEvent.AdjacentEnemyTurnStart, starter.Id));
                    }
                }
                return output;
            }
            case TurnEndedEvent e:
                return [new Party(e.HeroId, TriggerEvent.TurnEnd, null)];
            case DamagedEvent e:
            {
                if (e.Amount <= 0) return [];
                bool periodic = e.Periodic == true;
                var output = new List<Party>
                {
                    new(e.TargetId, TriggerEvent.Damaged, e.SourceId, e.Amount, e.Crit, Periodic: periodic, School: e.School),
                };
                if (e.SourceId is not null)
                {
                    output.Add(new Party(e.SourceId, TriggerEvent.DealtDamage, e.TargetId, e.Amount, e.Crit, Periodic: periodic, School: e.School));
                    if (e.Crit) output.Add(new Party(e.SourceId, TriggerEvent.Crit, e.TargetId, e.Amount, true));
                }
                return output;
            }
            case DiedEvent e:
            {
                var output = new List<Party> { new(e.HeroId, TriggerEvent.Died, null, Killed: true) };
                if (lastHitter.TryGetValue(e.HeroId, out string? killer) && killer != e.HeroId)
                    output.Add(new Party(killer, TriggerEvent.Kill, e.HeroId, Killed: true));
                return output;
            }
            case HealedEvent e:
                if (e.SourceId is null || e.Amount <= 0) return [];
                return [new Party(e.SourceId, TriggerEvent.HealedAlly, e.TargetId, e.Amount)];
            case AbilityUsedEvent e:
                return [new Party(e.HeroId, TriggerEvent.AbilityUsed, null, Ability: new TriggerAbility(e.AbilityId, e.Target))];
            default:
                return [];
        }
    }

    /// <summary>The heroes a firing's effects land on.</summary>
    private static List<BattleHero> TargetsOf(BattleState state, Firing firing, ContentRegistry content)
    {
        var owner = firing.Owner;
        var enemies = Query.LivingHeroes(state).Where(h => h.Side != owner.Side).ToList();
        // A passive picking an enemy by itself cannot pick one in stealth either.
        var visible = enemies.Where(h => !Statuses.HiddenFrom(owner.Side, h, content)).ToList();
        switch (firing.Trigger.To ?? TriggerTarget.Self)
        {
            case TriggerTarget.Self:
                return [Query.HeroById(state, owner.Id)];
            case TriggerTarget.Other:
            {
                if (firing.Other is null) return [];
                var other = Query.HeroById(state, firing.Other.Id);
                return other.IsAlive ? [other] : [];
            }
            case TriggerTarget.NearestEnemy:
                return JsSort.Stable(visible, (a, b) =>
                    {
                        int d = HexMath.Distance(owner.Hex, a.Hex) - HexMath.Distance(owner.Hex, b.Hex);
                        return d != 0 ? d : JsSort.Less(a.Id, b.Id) ? -1 : 1;
                    })
                    .Take(1)
                    .ToList();
            case TriggerTarget.EnemiesAround:
            {
                int radius = firing.Trigger.Radius ?? 1;
                return enemies.Where(h => HexMath.Distance(owner.Hex, h.Hex) <= radius).ToList();
            }
            default:
                return [];
        }
    }

    /// <summary>Books the "every N-th" and "once per match" limits and says whether this occurrence fires.</summary>
    private static (BattleState State, bool Go) Gate(BattleState state, Firing firing)
    {
        var trigger = firing.Trigger;
        if (trigger.Every is null && trigger.OncePerMatch != true) return (state, true);

        var counters = Query.HeroById(state, firing.Owner.Id).Counters;
        string spent = SpentKey(firing.Trait, firing.Index);
        if (trigger.OncePerMatch == true && counters.Get(spent) > 0) return (state, false);

        bool go = true;
        if (trigger.Every is not null)
        {
            string key = OccurrenceKey(firing.Trait, firing.Index);
            double seen = counters.Get(key) + 1;
            counters = counters.Set(key, seen);
            go = seen % trigger.Every.Value == 0;
        }
        if (go && trigger.OncePerMatch == true) counters = counters.Set(spent, 1);
        var finalCounters = counters;
        return (Query.UpdateHero(state, firing.Owner.Id, h => h with { Counters = finalCounters }), go);
    }

    private static Reaction RunFiring(BattleState state, Firing firing, ContentRegistry content, RollMode mode, Rerun rerun)
    {
        var current = state;
        var events = new List<BattleEvent>();

        // Echo is not about targets: it runs the triggering ability again as a whole.
        var echo = firing.Trigger.Effects.OfType<EchoEffect>().FirstOrDefault();
        if (echo is not null && firing.Ability is not null)
            return rerun(current, firing.Owner.Id, firing.Ability.Id, firing.Ability.Target, echo.Mul, mode);

        foreach (var target in TargetsOf(current, firing, content))
        {
            var ctx = new EffectContext
            {
                State = current,
                CasterId = firing.Owner.Id,
                Ability = null,
                TargetId = target.Id,
                AimedAt = target.Hex,
                Mul = 1,
                Content = content,
                Mode = mode,
                CasterIsActing = current.ActiveHeroId == firing.Owner.Id,
                // A passive's own movement never provokes: nobody chose to walk away.
                IgnoresZoc = true,
                LastDamage = firing.Amount,
                LastCrit = firing.Crit,
                LastKilled = firing.Killed,
            };
            foreach (var effect in firing.Trigger.Effects)
            {
                var outcome = Atoms.Apply(ctx, effect);
                current = outcome.State;
                events.AddRange(outcome.Events);
                ctx = ctx with
                {
                    State = current,
                    LastDamage = outcome.LastDamage ?? ctx.LastDamage,
                    LastCrit = outcome.LastCrit ?? ctx.LastCrit,
                    LastKilled = outcome.LastKilled ?? ctx.LastKilled,
                };
            }
        }
        return new Reaction(current, events);
    }

    /// <summary>
    /// Shows events to every trigger on the field and runs the ones that fire, then does the
    /// same for what they produced. Returns only the new events.
    /// </summary>
    public static Reaction ReactTo(BattleState state, IReadOnlyList<BattleEvent> events, ContentRegistry content, RollMode mode, Rerun rerun, int depth = 0)
    {
        if (depth >= content.Config.Battle.MaxTriggerDepth || events.Count == 0) return new Reaction(state, []);

        var current = state;
        var output = new List<BattleEvent>();
        var lastHitter = new Dictionary<string, string>();

        foreach (var @event in events)
        {
            if (@event is DamagedEvent { SourceId: not null } hit) lastHitter[hit.TargetId] = hit.SourceId;

            // "Древний страж": its killer takes a legendary artifact on the spot.
            if (@event is DiedEvent died && current.Heroes.Get(died.HeroId)?.Side == Side.N)
            {
                var looted = lastHitter.TryGetValue(died.HeroId, out string? killerId) ? Guardian.Loot(current, killerId, content) : null;
                if (looted is not null)
                {
                    current = looted.Value.State;
                    output.AddRange(looted.Value.Events);
                }
            }

            // "Кровавая жатва": a hero's death moves the killer up the bar. Summons do not count.
            double harvest = ArenaModifiers.KillAtb(current, content);
            if (@event is DiedEvent dead && harvest > 0)
            {
                var killer = lastHitter.TryGetValue(dead.HeroId, out string? id) ? current.Heroes.Get(id) : null;
                var victim = current.Heroes.Get(dead.HeroId);
                if (killer is not null && killer.Id != dead.HeroId && killer.IsAlive && killer.Summon is null && victim is not null && victim.Summon is null)
                {
                    double atb = killer.Atb + harvest;
                    current = Query.UpdateHero(current, killer.Id, h => h with { Atb = atb });
                    output.Add(new AtbChangedEvent(killer.Id, harvest, atb));
                }
            }

            foreach (var party in PartiesOf(current, @event, lastHitter))
            {
                var owner = current.Heroes.Get(party.OwnerId);
                if (owner is null) continue;
                // The dead only react to their own death.
                if (!owner.IsAlive && party.On != TriggerEvent.Died) continue;

                foreach (var (trait, index, trigger) in Listening(owner, party.On, content))
                {
                    if (trigger.Periodic is not null && trigger.Periodic != party.Periodic) continue;
                    if (trigger.School is not null && trigger.School != party.School) continue;

                    var firing = new Firing(
                        owner,
                        trait,
                        index,
                        trigger,
                        party.OtherId is null ? null : current.Heroes.Get(party.OtherId),
                        party.Amount,
                        party.Crit,
                        party.Killed,
                        party.Ability);
                    var passed = Gate(current, firing);
                    current = passed.State;
                    if (!passed.Go) continue;

                    var result = RunFiring(current, firing, content, mode, rerun);
                    current = result.State;
                    if (result.Events.Count == 0) continue;

                    output.Add(new PassiveTriggeredEvent(owner.Id, trait.Id));
                    output.AddRange(result.Events);

                    var chained = ReactTo(current, result.Events, content, mode, rerun, depth + 1);
                    current = chained.State;
                    output.AddRange(chained.Events);
                }
            }
        }
        return new Reaction(current, output);
    }
}
