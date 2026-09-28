namespace Brawl.Core;

/// <summary>
/// The effect atoms and their dispatcher, a port of battle/effects/*.ts. Each atom is a
/// pure function from a context to a new state and events.
/// </summary>
public static class Atoms
{
    // --- the dispatcher ------------------------------------------------------------

    private static bool ConditionHolds(EffectContext ctx, EffectCondition? condition)
    {
        if (condition is null) return true;

        if (condition.TargetHas is not null)
        {
            if (ctx.TargetId is null) return false;
            var target = Query.HeroById(ctx.State, ctx.TargetId);
            string what = condition.TargetHas;
            bool present = what switch
            {
                "debuff" => Statuses.HasAnyDebuff(target, ctx.Content),
                "buff" => Statuses.HasAnyBuff(target, ctx.Content),
                _ => Statuses.HasStatus(target, what),
            };
            if (!present) return false;
        }

        if (condition.TargetHpBelowPct is not null)
        {
            if (ctx.TargetId is null) return false;
            var target = Query.HeroById(ctx.State, ctx.TargetId);
            if (target.Hp / target.Base.MaxHp * 100 >= condition.TargetHpBelowPct) return false;
        }

        if (condition.CasterHpBelowPct is not null)
        {
            var caster = Query.HeroById(ctx.State, ctx.CasterId);
            if (caster.Hp / caster.Base.MaxHp * 100 >= condition.CasterHpBelowPct) return false;
        }

        if (condition.TargetIsAlly is not null)
        {
            if (ctx.TargetId is null) return false;
            bool ally = Query.HeroById(ctx.State, ctx.TargetId).Side == Query.HeroById(ctx.State, ctx.CasterId).Side;
            if (ally != condition.TargetIsAlly) return false;
        }

        if (condition.CasterUndamagedSinceLastTurn is not null)
        {
            bool hurt = Query.HeroById(ctx.State, ctx.CasterId).Counter(Damage.HurtSinceTurn) > 0;
            if (hurt == condition.CasterUndamagedSinceLastTurn) return false;
        }

        if (condition.WasCrit is not null && ctx.LastCrit != condition.WasCrit) return false;
        if (condition.Killed is not null && ctx.LastKilled != condition.Killed) return false;
        return true;
    }

    /// <summary>Atoms that act on the caster; they still run after the target has died.</summary>
    public static bool ActsOnCaster(Effect effect) => effect switch
    {
        LifestealEffect or SelfDamageEffect => true,
        ApEffect ap => ap.Who == Who.Caster,
        CooldownEffect c => (c.Who ?? (c.Mode == CooldownMode.ResetThis ? Who.Caster : Who.Target)) == Who.Caster,
        _ => false,
    };

    public static EffectOutcome Apply(EffectContext ctx, Effect effect)
    {
        if (!ConditionHolds(ctx, effect.If)) return EffectOutcome.NoChange(ctx);
        return effect switch
        {
            DamageEffect e => ApplyDamage(ctx, e),
            HealEffect e => ApplyHeal(ctx, e),
            StatusEffect e => ApplyStatus(ctx, e),
            BarrierEffect e => ApplyBarrier(ctx, e),
            MoveEffect e => ApplyMove(ctx, e),
            PushEffect e => ApplyPush(ctx, e),
            AtbEffect e => ApplyAtb(ctx, e),
            CleanseEffect e => ApplyCleanse(ctx, e),
            LifestealEffect e => ApplyLifesteal(ctx, e),
            RelayEffect e => ApplyRelay(ctx, e),
            // Re-running an ability needs the action runner; triggers handle echo there.
            EchoEffect => EffectOutcome.NoChange(ctx),
            TeleportEffect => ApplyTeleport(ctx),
            ApEffect e => ApplyAp(ctx, e),
            CooldownEffect e => ApplyCooldown(ctx, e),
            SelfDamageEffect e => ApplySelfDamage(ctx, e),
            SpreadEffect e => ApplySpread(ctx, e),
            TerrainEffect e => ApplyTerrain(ctx, e),
            SummonEffect e => ApplySummon(ctx, e),
            _ => throw new InvalidOperationException($"Unknown effect {effect.Type}"),
        };
    }

    // --- damage --------------------------------------------------------------------

    private static (BattleState State, List<BattleEvent> Events) DropStatuses(BattleState state, string heroId, ContentRegistry content, Func<StatusDef, bool> test)
    {
        var hero = Query.HeroById(state, heroId);
        var gone = hero.Statuses.Where(s => content.Statuses.Get(s.Status) is { } def && test(def)).ToList();
        if (gone.Count == 0) return (state, []);
        return (
            Query.UpdateHero(state, heroId, h => h with { Statuses = h.Statuses.Where(s => !gone.Any(g => ReferenceEquals(g, s))).ToList() }),
            gone.Select(s => s.Status).Distinct().Select(status => (BattleEvent)new StatusExpiredEvent(heroId, status)).ToList());
    }

    private static double ReflectShare(BattleHero hero, ContentRegistry content) =>
        hero.Statuses.Aggregate(0.0, (best, s) => Math.Max(best, content.Statuses.Get(s.Status)?.ReflectPct ?? 0));

    private static double ApOnKill(BattleHero hero, ContentRegistry content) =>
        hero.Statuses.Aggregate(0.0, (best, s) => Math.Max(best, content.Statuses.Get(s.Status)?.ApOnKill ?? 0));

    private static (double Absorbed, double Final) ThroughBarrier(BattleHero hero, double whole)
    {
        double absorbed = Math.Min(Statuses.BarrierAmount(hero), whole);
        return (absorbed, whole - absorbed);
    }

    public static EffectOutcome ApplyDamage(EffectContext ctx, DamageEffect effect)
    {
        if (ctx.TargetId is null) return EffectOutcome.NoChange(ctx);

        var state = ctx.State;
        var events = new List<BattleEvent>();
        var rng = state.Rng;
        double total = 0;
        bool anyCrit = false;
        bool killed = false;

        int hits = effect.Hits ?? 1;
        for (int i = 0; i < hits; i++)
        {
            // The attacker may already be dead: "Тёмный договор" strikes from the grave.
            var target = Query.HeroById(state, ctx.TargetId);
            var attacker = Query.HeroById(state, ctx.CasterId);
            if (!target.IsAlive) break;

            // Out of stealth, the first hit is a sure crit ("Исчезновение").
            bool forced = effect.AlwaysCrit == true || Statuses.HasFlag(attacker, ctx.Content, Statuses.CritsWhileOn);
            var scaled = effect with { K = effect.K * ctx.Mul, AlwaysCrit = forced };
            var result = Formulas.ComputeDamage(state, attacker, target, scaled, ctx.Content, rng, ctx.Mode, ctx.Ability?.Tier);
            rng = result.Rng;
            state = state with { Rng = rng };

            // "Парирование": the first enemy hit is split, and the parry is spent on it.
            double absorbed = result.AbsorbedByBarrier;
            double final = result.Final;
            double reflected = 0;
            double share = attacker.Side != target.Side ? ReflectShare(target, ctx.Content) : 0;
            if (share > 0)
            {
                double whole = absorbed + final;
                reflected = JsMath.Round(whole * share);
                (absorbed, final) = ThroughBarrier(target, whole - reflected);
                var spent = DropStatuses(state, target.Id, ctx.Content, def => (def.ReflectPct ?? 0) > 0);
                state = spent.State;
                events.AddRange(spent.Events);
            }

            var applied = Damage.DamageHero(state, ctx.TargetId, absorbed, final, ctx.Content);
            state = applied.State;
            events.AddRange(applied.Events);
            events.Add(new DamagedEvent(ctx.TargetId, ctx.CasterId, applied.Dealt, result.Crit, effect.School));
            total += applied.Dealt;
            anyCrit = anyCrit || result.Crit;
            killed = killed || applied.Killed;

            // The parried share goes back as pure damage: no crit, no defence, barrier first.
            if (reflected > 0 && Query.HeroById(state, attacker.Id).IsAlive)
            {
                var split = ThroughBarrier(Query.HeroById(state, attacker.Id), reflected);
                var back = Damage.DamageHero(state, attacker.Id, split.Absorbed, split.Final, ctx.Content);
                state = back.State;
                events.AddRange(back.Events);
                events.Add(new DamagedEvent(attacker.Id, target.Id, back.Dealt, false, DamageSchool.Pure));
            }

            // "Поток": a kill on the attacker's own turn gives points back. Summons do not count.
            double bonus = ApOnKill(Query.HeroById(state, attacker.Id), ctx.Content);
            if (applied.Killed && target.Summon is null && bonus > 0 && state.ActiveHeroId == attacker.Id)
            {
                state = state with { ApLeft = state.ApLeft + bonus };
                events.Add(new ApChangedEvent(attacker.Id, bonus));
            }

            // Striking gives the attacker away: statuses that break on a hit go now.
            var broken = DropStatuses(state, attacker.Id, ctx.Content, def => def.BreaksOnDamageDealt == true);
            state = broken.State;
            events.AddRange(broken.Events);
        }

        // The damaged event reads better before the death it caused (a stable sort in TypeScript).
        var ordered = events.Where(e => e is not DiedEvent).Concat(events.Where(e => e is DiedEvent)).ToList();
        return new EffectOutcome(state, ordered) { LastDamage = total, LastCrit = anyCrit, LastKilled = killed };
    }

    // --- heal, status, barrier -----------------------------------------------------

    public static EffectOutcome ApplyHeal(EffectContext ctx, HealEffect effect)
    {
        if (ctx.TargetId is null) return EffectOutcome.NoChange(ctx);
        var target = Query.HeroById(ctx.State, ctx.TargetId);
        // A fallen hero cannot be healed.
        if (!target.IsAlive) return EffectOutcome.NoChange(ctx);
        var healer = Query.HeroById(ctx.State, ctx.CasterId);
        var scaled = effect.K is null ? effect : effect with { K = effect.K * ctx.Mul };
        var result = Formulas.ComputeHeal(ctx.State, healer, target, scaled, ctx.Content, ctx.State.Rng, ctx.Mode);
        var (state, healed) = Damage.HealHero(ctx.State with { Rng = result.Rng }, ctx.TargetId, result.Amount);
        if (healed == 0) return new EffectOutcome(state, []);
        return new EffectOutcome(state, [new HealedEvent(ctx.TargetId, ctx.CasterId, healed)]);
    }

    public static EffectOutcome ApplyStatus(EffectContext ctx, StatusEffect effect)
    {
        if (ctx.TargetId is null) return EffectOutcome.NoChange(ctx);
        var target = Query.HeroById(ctx.State, ctx.TargetId);
        if (!target.IsAlive) return EffectOutcome.NoChange(ctx);
        // A status that lands during its carrier's own turn skips that turn's end tick.
        bool onOwnTurn = ctx.State.ActiveHeroId == ctx.TargetId;
        var result = Statuses.AddStatus(target, ctx.Content, effect.Status, effect.Turns, effect.Value ?? 0, effect.Stacks ?? 1, onOwnTurn, ctx.CasterId);
        return new EffectOutcome(Query.UpdateHero(ctx.State, ctx.TargetId, _ => result.Hero), result.Events);
    }

    public static EffectOutcome ApplyBarrier(EffectContext ctx, BarrierEffect effect)
    {
        if (ctx.TargetId is null) return EffectOutcome.NoChange(ctx);
        var target = Query.HeroById(ctx.State, ctx.TargetId);
        if (!target.IsAlive) return EffectOutcome.NoChange(ctx);
        var caster = Query.HeroById(ctx.State, ctx.CasterId);
        // Inside a trigger lastDamage is the event: "Кубок целителя" shields a fifth of the heal.
        double amount = effect.PctOfEvent is not null
            ? JsMath.Round(ctx.LastDamage * effect.PctOfEvent.Value)
            : Formulas.ComputeBarrier(ctx.State, caster, ctx.Content, effect.Scale, effect.K * ctx.Mul);
        if (amount <= 0) return EffectOutcome.NoChange(ctx);
        bool onOwnTurn = ctx.State.ActiveHeroId == ctx.TargetId;
        var result = Statuses.AddStatus(target, ctx.Content, Statuses.Barrier, effect.Turns, amount, 1, onOwnTurn);
        return new EffectOutcome(Query.UpdateHero(ctx.State, ctx.TargetId, _ => result.Hero), result.Events);
    }

    // --- movement ------------------------------------------------------------------

    /// <summary>The free neighbour of `target` closest to the caster; ties by Directions.</summary>
    public static Hex? LandingHexNextTo(EffectContext ctx, Hex target)
    {
        var caster = Query.HeroById(ctx.State, ctx.CasterId);
        var options = HexMath.Directions
            .Select((d, index) => (Hex: target + d, Index: index))
            .Where(o => o.Hex == caster.Hex || Pathing.IsPassable(ctx.State, o.Hex));
        var sorted = JsSort.Stable(options, (a, b) =>
        {
            int da = HexMath.Distance(caster.Hex, a.Hex);
            int db = HexMath.Distance(caster.Hex, b.Hex);
            return da != db ? da - db : a.Index - b.Index;
        });
        return sorted.Count == 0 ? null : sorted[0].Hex;
    }

    private static (BattleState State, List<BattleEvent> Events) Pit(BattleState state, string heroId, string? sourceId, ContentRegistry content)
    {
        var hurt = Damage.DamageHero(state, heroId, 0, content.Config.Arena.Pit.Damage, content);
        return (hurt.State, [new DamagedEvent(heroId, sourceId, hurt.Dealt, false, DamageSchool.Pure), .. hurt.Events]);
    }

    public static EffectOutcome ApplyMove(EffectContext ctx, MoveEffect effect)
    {
        var caster = Query.HeroById(ctx.State, ctx.CasterId);
        if (!caster.IsAlive) return EffectOutcome.NoChange(ctx);
        Hex? destination = effect.To == MoveTo.Target ? ctx.AimedAt : LandingHexNextTo(ctx, ctx.AimedAt);
        if (destination is null || destination == caster.Hex) return EffectOutcome.NoChange(ctx);
        if (!Pathing.IsPassable(ctx.State, destination.Value)) return EffectOutcome.NoChange(ctx);
        var to = destination.Value;
        var from = caster.Hex;
        var provoked = ctx.IgnoresZoc ? [] : Opportunity.ReactorsForPath(ctx.State, caster, [to], caster.ReactedThisTurn, ctx.Content);
        var state = Query.UpdateHero(ctx.State, ctx.CasterId, hero => hero with { Hex = to });
        var events = new List<BattleEvent> { new MovedEvent(ctx.CasterId, from, to) };
        // Landing in a pit hurts, exactly as walking into one does.
        if (Terrain.IsPit(state.Arena, to))
        {
            var fell = Pit(state, ctx.CasterId, null, ctx.Content);
            state = fell.State;
            events.AddRange(fell.Events);
        }
        return new EffectOutcome(state, events) { Provoked = provoked };
    }

    public static EffectOutcome ApplyPush(EffectContext ctx, PushEffect effect)
    {
        if (ctx.TargetId is null) return EffectOutcome.NoChange(ctx);
        var target = Query.HeroById(ctx.State, ctx.TargetId);
        if (!target.IsAlive) return EffectOutcome.NoChange(ctx);
        // "Пояс силача": the bearer does not budge.
        if (Modifiers.Sum(ctx.State, target, ModifierStat.PushImmune, ctx.Content).Add > 0) return EffectOutcome.NoChange(ctx);
        var origin = effect.From == PushFrom.Caster ? Query.HeroById(ctx.State, ctx.CasterId).Hex : ctx.AimedAt;
        var step = HexMath.NearestDirection(origin, target.Hex);
        var current = target.Hex;
        for (int i = 0; i < effect.Distance; i++)
        {
            var next = current + step;
            if (!Pathing.IsPassable(ctx.State, next)) break;
            current = next;
        }
        if (current == target.Hex) return EffectOutcome.NoChange(ctx);
        var landed = current;
        var state = Query.UpdateHero(ctx.State, ctx.TargetId, hero => hero with { Hex = landed });
        var events = new List<BattleEvent> { new PushedEvent(ctx.TargetId, target.Hex, landed) };
        if (Terrain.IsPit(state.Arena, landed) && !Pathing.PitImmune(state, Query.HeroById(state, ctx.TargetId), ctx.Content))
        {
            var fell = Pit(state, ctx.TargetId, ctx.CasterId, ctx.Content);
            state = fell.State;
            events.AddRange(fell.Events);
        }
        return new EffectOutcome(state, events);
    }

    public static EffectOutcome ApplyTeleport(EffectContext ctx)
    {
        var caster = Query.HeroById(ctx.State, ctx.CasterId);
        var to = ctx.AimedAt;
        if (!caster.IsAlive || caster.Hex == to || !Pathing.IsPassable(ctx.State, to)) return EffectOutcome.NoChange(ctx);
        var state = Query.UpdateHero(ctx.State, ctx.CasterId, hero => hero with { Hex = to });
        var events = new List<BattleEvent> { new TeleportedEvent(ctx.CasterId, caster.Hex, to) };
        if (Terrain.IsPit(state.Arena, to))
        {
            var fell = Pit(state, ctx.CasterId, null, ctx.Content);
            state = fell.State;
            events.AddRange(fell.Events);
        }
        return new EffectOutcome(state, events);
    }

    // --- initiative, cleansing, lifesteal, relay -----------------------------------

    public static EffectOutcome ApplyAtb(EffectContext ctx, AtbEffect effect)
    {
        if (ctx.TargetId is null) return EffectOutcome.NoChange(ctx);
        var target = Query.HeroById(ctx.State, ctx.TargetId);
        if (!target.IsAlive) return EffectOutcome.NoChange(ctx);
        // "Дисциплина": no enemy moves this hero on the bar; allies still can.
        var caster = Query.HeroById(ctx.State, ctx.CasterId);
        if (caster.Side != target.Side && Modifiers.Sum(ctx.State, target, ModifierStat.EnemyAtbImmune, ctx.Content).Add > 0)
            return EffectOutcome.NoChange(ctx);
        double next = Math.Max(0, target.Atb + effect.Delta);
        double delta = next - target.Atb;
        if (delta == 0) return EffectOutcome.NoChange(ctx);
        return new EffectOutcome(
            Query.UpdateHero(ctx.State, ctx.TargetId, hero => hero with { Atb = next }),
            [new AtbChangedEvent(ctx.TargetId, delta, next)]);
    }

    public static EffectOutcome ApplyCleanse(EffectContext ctx, CleanseEffect effect)
    {
        if (ctx.TargetId is null) return EffectOutcome.NoChange(ctx);
        var target = Query.HeroById(ctx.State, ctx.TargetId);
        if (!target.IsAlive) return EffectOutcome.NoChange(ctx);
        bool ShouldRemove(string status)
        {
            if (effect.What.Ids is not null) return effect.What.Ids.Contains(status);
            if (effect.What.Kind == "all") return true;
            return ctx.Content.Statuses.Get(status)?.Kind == StatusKind.Debuff;
        }
        var result = Statuses.RemoveStatuses(target, instance => ShouldRemove(instance.Status), effect.Count);
        if (result.Events.Count == 0) return EffectOutcome.NoChange(ctx);
        return new EffectOutcome(Query.UpdateHero(ctx.State, ctx.TargetId, _ => result.Hero), result.Events);
    }

    public static EffectOutcome ApplyLifesteal(EffectContext ctx, LifestealEffect effect)
    {
        var caster = Query.HeroById(ctx.State, ctx.CasterId);
        if (!caster.IsAlive || ctx.LastDamage <= 0) return EffectOutcome.NoChange(ctx);
        // "Кровавая жатва" weakens it like any heal.
        double amount = Math.Floor(ctx.LastDamage * effect.Pct * ArenaModifiers.HealMultiplier(ctx.State, ctx.Content) + 0.5);
        var (state, healed) = Damage.HealHero(ctx.State, ctx.CasterId, amount);
        if (healed == 0) return new EffectOutcome(state, []);
        return new EffectOutcome(state, [new HealedEvent(ctx.CasterId, ctx.CasterId, healed)]);
    }

    public static EffectOutcome ApplyRelay(EffectContext ctx, RelayEffect effect)
    {
        if (ctx.TargetId is null || ctx.LastDamage <= 0) return EffectOutcome.NoChange(ctx);
        var target = Query.HeroById(ctx.State, ctx.TargetId);
        if (!target.IsAlive) return EffectOutcome.NoChange(ctx);
        var caster = Query.HeroById(ctx.State, ctx.CasterId);
        double raw = ctx.LastDamage * effect.Pct;
        var mitigated = Formulas.Mitigate(ctx.State, caster, target, raw, effect.School, 0, ctx.Content);
        var applied = Damage.DamageHero(ctx.State, ctx.TargetId, mitigated.Absorbed, mitigated.Final, ctx.Content);
        var events = new List<BattleEvent>();
        events.AddRange(applied.Events.Where(e => e is not DiedEvent));
        events.Add(new DamagedEvent(ctx.TargetId, ctx.CasterId, applied.Dealt, false, effect.School));
        events.AddRange(applied.Events.Where(e => e is DiedEvent));
        return new EffectOutcome(applied.State, events) { LastDamage = applied.Dealt, LastCrit = false, LastKilled = applied.Killed };
    }

    // --- action points, cooldowns, self-damage -------------------------------------

    public static EffectOutcome ApplyAp(EffectContext ctx, ApEffect effect)
    {
        string? id = (effect.Who ?? Who.Target) == Who.Caster ? ctx.CasterId : ctx.TargetId;
        if (id is null || effect.Delta == 0) return EffectOutcome.NoChange(ctx);
        var hero = Query.HeroById(ctx.State, id);
        if (!hero.IsAlive) return EffectOutcome.NoChange(ctx);
        if (ctx.State.ActiveHeroId == id)
        {
            double apLeft = Math.Max(0, ctx.State.ApLeft + effect.Delta);
            return new EffectOutcome(ctx.State with { ApLeft = apLeft }, [new ApChangedEvent(id, apLeft - ctx.State.ApLeft)]);
        }
        // A gain for someone else's next turn has no carrier yet; only losses wait.
        if (effect.Delta > 0) return EffectOutcome.NoChange(ctx);
        var result = Statuses.AddStatus(hero, ctx.Content, "apLoss", 1, -effect.Delta, 1, false, ctx.CasterId);
        return new EffectOutcome(Query.UpdateHero(ctx.State, id, _ => result.Hero), result.Events);
    }

    public static EffectOutcome ApplyCooldown(EffectContext ctx, CooldownEffect effect)
    {
        var who = effect.Who ?? (effect.Mode == CooldownMode.ResetThis ? Who.Caster : Who.Target);
        string? id = who == Who.Caster ? ctx.CasterId : ctx.TargetId;
        if (id is null) return EffectOutcome.NoChange(ctx);
        var hero = Query.HeroById(ctx.State, id);
        if (!hero.IsAlive) return EffectOutcome.NoChange(ctx);
        var cooldowns = OrderedMap<double>.Empty;
        foreach (var (ability, turns) in hero.Cooldowns)
        {
            if (turns < 0) cooldowns = cooldowns.Set(ability, turns);
            else if (effect.Mode == CooldownMode.Double) cooldowns = cooldowns.Set(ability, turns * 2);
            else if (effect.Mode == CooldownMode.ResetThis && ability != ctx.Ability?.Id) cooldowns = cooldowns.Set(ability, turns);
            else if (effect.Mode == CooldownMode.Reduce && turns > 1) cooldowns = cooldowns.Set(ability, turns - 1);
        }
        return new EffectOutcome(
            Query.UpdateHero(ctx.State, id, h => h with { Cooldowns = cooldowns }),
            [new CooldownsChangedEvent(id, effect.Mode)]);
    }

    public static EffectOutcome ApplySelfDamage(EffectContext ctx, SelfDamageEffect effect)
    {
        var caster = Query.HeroById(ctx.State, ctx.CasterId);
        if (!caster.IsAlive) return EffectOutcome.NoChange(ctx);
        double amount = JsMath.Round(caster.Base.MaxHp * (effect.PctMaxHp ?? 0) + caster.Hp * (effect.PctCurrentHp ?? 0));
        if (amount <= 0) return EffectOutcome.NoChange(ctx);
        var hurt = Damage.DamageHero(ctx.State, ctx.CasterId, 0, amount, ctx.Content);
        return new EffectOutcome(hurt.State, [new DamagedEvent(ctx.CasterId, null, hurt.Dealt, false, DamageSchool.Pure), .. hurt.Events]);
    }

    // --- spread, terrain, summon ---------------------------------------------------

    public static EffectOutcome ApplySpread(EffectContext ctx, SpreadEffect effect)
    {
        if (ctx.TargetId is null) return EffectOutcome.NoChange(ctx);
        var target = Query.HeroById(ctx.State, ctx.TargetId);
        var caster = Query.HeroById(ctx.State, ctx.CasterId);
        var stacks = Statuses.StatusesOf(target, effect.Status);
        if (!target.IsAlive || stacks.Count == 0) return EffectOutcome.NoChange(ctx);
        int maxStacks = ctx.Content.Statuses.Get(effect.Status)?.MaxStacks ?? 1;
        var state = ctx.State;
        var events = new List<BattleEvent>();
        var victims = Query.LivingHeroes(state).Where(h =>
            h.Side != caster.Side && h.Id != target.Id && h.Summon is null && HexMath.Distance(h.Hex, target.Hex) <= effect.Radius).ToList();
        foreach (var victim in victims)
        {
            foreach (var stack in stacks)
            {
                var result = Statuses.AddStatus(Query.HeroById(state, victim.Id), ctx.Content, effect.Status, stack.Turns, stack.Value, maxStacks, false, stack.SourceId);
                state = Query.UpdateHero(state, victim.Id, _ => result.Hero);
                events.AddRange(result.Events);
            }
        }
        return new EffectOutcome(state, events);
    }

    public static EffectOutcome ApplyTerrain(EffectContext ctx, TerrainEffect effect)
    {
        if (ctx.Ability is null) return EffectOutcome.NoChange(ctx);
        var caster = Query.HeroById(ctx.State, ctx.CasterId);
        var hexes = Targeting.ResolveShape(ctx.State, caster, ctx.AimedAt, ctx.Ability, ctx.Content)
            .Select(hit => hit.Hex)
            .Where(h => Terrain.InBounds(h, ctx.State.Arena) && Query.HeroAt(ctx.State, h) is null && Terrain.TerrainAt(ctx.State.Arena, h) is null)
            .ToList();
        if (hexes.Count == 0) return EffectOutcome.NoChange(ctx);
        var terrain = ctx.State.Arena.Terrain;
        var laid = new List<TemporaryTerrain>();
        var events = new List<BattleEvent>();
        foreach (var hex in hexes)
        {
            terrain = terrain.Set(hex.Key, effect.Terrain);
            laid.Add(new TemporaryTerrain
            {
                Hex = hex,
                Terrain = effect.Terrain,
                Previous = null,
                OwnerId = ctx.CasterId,
                Turns = effect.Turns,
                OnEnter = effect.OnEnter ?? [],
            });
            events.Add(new TerrainChangedEvent(hex, effect.Terrain));
        }
        return new EffectOutcome(
            ctx.State with
            {
                Arena = ctx.State.Arena with { Terrain = terrain },
                TemporaryTerrain = [.. ctx.State.TemporaryTerrain, .. laid],
            },
            events);
    }

    public static EffectOutcome ApplySummon(EffectContext ctx, SummonEffect effect)
    {
        var owner = Query.HeroById(ctx.State, ctx.CasterId);
        if (!owner.IsAlive || !Pathing.IsPassable(ctx.State, ctx.AimedAt)) return EffectOutcome.NoChange(ctx);
        var unitClass = ctx.Content.GetClass(effect.Unit);
        int count = ctx.State.Heroes.Values.Count(h => h.Summon?.OwnerId == owner.Id);
        string id = $"{owner.Id}_{effect.Unit}_{count + 1}";
        double power = Modifiers.StatInBattle(ctx.State, owner, Modifiers.AsStat(effect.Attack.Scale), ctx.Content);
        var unit = new BattleHero
        {
            Id = id,
            Name = unitClass.Name,
            Side = owner.Side,
            ClassId = unitClass.Id,
            Base = new Stats(
                effect.Hp,
                effect.Attack.Scale == ScaleStat.Attack ? power : 0,
                effect.Attack.Scale == ScaleStat.Magic ? power : 0,
                0, 0, 0, 0),
            Hp = effect.Hp,
            Hex = ctx.AimedAt,
            Atb = 0,
            Abilities = [],
            Cooldowns = OrderedMap<double>.Empty,
            Statuses = [],
            CcInPreviousTurn = [],
            CcInCurrentTurn = [],
            ReactedThisTurn = [],
            Passive = null,
            Race = null,
            Perks = [],
            Item = null,
            Counters = OrderedMap<double>.Empty,
            Summon = new SummonInfo(owner.Id, effect.Turns, effect.Attack),
        };
        return new EffectOutcome(
            ctx.State with { Heroes = ctx.State.Heroes.Set(id, unit) },
            [new SummonedEvent(id, owner.Id, ctx.AimedAt)]);
    }
}
