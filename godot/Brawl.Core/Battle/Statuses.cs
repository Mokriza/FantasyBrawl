namespace Brawl.Core;

/// <summary>Statuses: queries, stacking and duration ticks. A port of battle/statuses.ts.</summary>
public static class Statuses
{
    public const string Stun = "stun";
    public const string Root = "root";
    public const string Silence = "silence";
    public const string Slow = "slow";
    public const string Dot = "dot";
    public const string Barrier = "barrier";
    /// <summary>Swallows the whole of the next hit, then is gone.</summary>
    public const string Ward = "ward";
    public const string Invulnerable = "invulnerable";
    public const string DeathWard = "deathWard";

    public static List<StatusInstance> StatusesOf(BattleHero hero, string id) => hero.Statuses.Where(s => s.Status == id).ToList();

    public static bool HasStatus(BattleHero hero, string id) => hero.Statuses.Any(s => s.Status == id);

    public static bool HasAnyDebuff(BattleHero hero, ContentRegistry content) =>
        hero.Statuses.Any(s => content.GetStatus(s.Status).Kind == StatusKind.Debuff);

    public static bool HasAnyBuff(BattleHero hero, ContentRegistry content) =>
        hero.Statuses.Any(s => content.GetStatus(s.Status).Kind == StatusKind.Buff);

    /// <summary>"Невидимость": hidden from the given side, so it cannot be chosen as a target.</summary>
    public static bool HiddenFrom(Side viewerSide, BattleHero hero, ContentRegistry content) =>
        hero.Side != viewerSide && HasFlag(hero, content, s => s.Untargetable == true);

    public static bool HasFlag(BattleHero hero, ContentRegistry content, Func<StatusDef, bool> flag) =>
        hero.Statuses.Any(s => flag(content.GetStatus(s.Status)));

    public static bool ControlImmune(StatusDef d) => d.ControlImmune == true;
    public static bool IgnoresLos(StatusDef d) => d.IgnoresLos == true;
    public static bool Untargetable(StatusDef d) => d.Untargetable == true;
    public static bool CritsWhileOn(StatusDef d) => d.CritsWhileOn == true;

    /// <summary>Hit points the barrier can still soak up; stacks are summed.</summary>
    public static double BarrierAmount(BattleHero hero) => StatusesOf(hero, Barrier).Aggregate(0.0, (sum, s) => sum + s.Value);

    public static double DotAmount(BattleHero hero) => StatusesOf(hero, Dot).Aggregate(0.0, (sum, s) => sum + s.Value);

    private static IReadOnlyList<StatName> StatsTouchedBy(StatusDef def)
    {
        if (def.Stats is not null) return def.Stats;
        if (def.Stat is not null) return [def.Stat.Value];
        return [];
    }

    /// <summary>What a hero's statuses do to its stats, before modifiers and before any clamp.</summary>
    public sealed record StatusLayer(IReadOnlyDictionary<StatName, double> Flat, IReadOnlyDictionary<StatName, double> Mul);

    public static StatusLayer Layer(BattleHero hero, ContentRegistry content)
    {
        var flat = new Dictionary<StatName, double>();
        var mul = new Dictionary<StatName, double>();
        foreach (var instance in hero.Statuses)
        {
            var def = content.GetStatus(instance.Status);
            if (def.ValueKind == ValueKind.None) continue;
            double sign = def.Kind == StatusKind.Debuff ? -1 : 1;
            foreach (var stat in StatsTouchedBy(def))
            {
                if (def.ValueKind == ValueKind.Flat) flat[stat] = flat.GetValueOrDefault(stat, 0) + sign * instance.Value;
                else mul[stat] = mul.GetValueOrDefault(stat, 1) * (1 + sign * instance.Value);
            }
        }
        return new StatusLayer(flat, mul);
    }

    public sealed record ApplyResult(BattleHero Hero, IReadOnlyList<BattleEvent> Events);

    /// <summary>
    /// Applies a status, honouring stack limits and the repeat-control rule. onOwnTurn:
    /// the carrier is the acting hero, so the status skips that turn's end tick.
    /// </summary>
    public static ApplyResult AddStatus(
        BattleHero hero,
        ContentRegistry content,
        string id,
        int turns,
        double value,
        int requestedStacks,
        bool onOwnTurn,
        string? sourceId = null)
    {
        var def = content.GetStatus(id);

        // Repeat-control rule: stun, root and silence cannot land on a hero that carried
        // the same status during its previous turn.
        if (def.HardControl && hero.CcInPreviousTurn.Contains(id))
            return new(hero, [new StatusResistedEvent(hero.Id, id)]);
        // "Неудержимость": no hard control lands.
        if (def.HardControl && HasFlag(hero, content, ControlImmune))
            return new(hero, [new StatusResistedEvent(hero.Id, id)]);
        // "Броня стража": a guard against this status takes the hit once and is spent.
        var guard = hero.Statuses.FirstOrDefault(s => content.Statuses.Get(s.Status)?.BlocksStatus == id);
        if (guard is not null)
        {
            return new(
                hero with { Statuses = hero.Statuses.Where(s => !ReferenceEquals(s, guard)).ToList() },
                [new StatusResistedEvent(hero.Id, id), new StatusExpiredEvent(hero.Id, guard.Status)]);
        }

        int maxStacks = Math.Min(def.MaxStacks, requestedStacks);
        var existing = StatusesOf(hero, id);
        var others = hero.Statuses.Where(s => s.Status != id).ToList();
        var fresh = new StatusInstance { Status = id, Turns = turns, Value = value, AppliedOnOwnTurn = onOwnTurn, SourceId = sourceId };

        List<StatusInstance> next;
        if (id == Barrier)
        {
            // Barriers merge into one pool and keep the longest duration.
            double pooled = existing.Aggregate(0.0, (sum, s) => sum + s.Value) + value;
            int longest = existing.Aggregate(turns, (max, s) => Math.Max(max, s.Turns));
            next = [.. others, new StatusInstance { Status = id, Turns = longest, Value = pooled, AppliedOnOwnTurn = onOwnTurn }];
        }
        else if (maxStacks <= 1)
        {
            next = [.. others, fresh];
        }
        else if (existing.Count < maxStacks)
        {
            next = [.. others, .. existing, fresh];
        }
        else
        {
            // At the cap the shortest-lived stack is refreshed rather than a new one added.
            var shortest = existing.Aggregate(existing[0], (min, s) => s.Turns < min.Turns ? s : min);
            next = [.. others, .. existing.Where(s => !ReferenceEquals(s, shortest)), fresh];
        }

        var ccSeen = def.HardControl && !hero.CcInCurrentTurn.Contains(id)
            ? [.. hero.CcInCurrentTurn, id]
            : hero.CcInCurrentTurn;

        return new(
            hero with { Statuses = next, CcInCurrentTurn = ccSeen },
            [new StatusAppliedEvent(hero.Id, id, turns, value)]);
    }

    public static ApplyResult RemoveStatuses(BattleHero hero, Func<StatusInstance, bool> predicate, int? limit = null)
    {
        var events = new List<BattleEvent>();
        var kept = new List<StatusInstance>();
        int removed = 0;
        foreach (var instance in hero.Statuses)
        {
            bool allowed = limit is null || removed < limit;
            if (allowed && predicate(instance))
            {
                removed++;
                events.Add(new StatusCleansedEvent(hero.Id, instance.Status));
            }
            else
            {
                kept.Add(instance);
            }
        }
        return new(hero with { Statuses = kept }, events);
    }

    /// <summary>Consumes barrier hit points.</summary>
    public static BattleHero SpendBarrier(BattleHero hero, double amount)
    {
        double left = amount;
        var next = new List<StatusInstance>();
        foreach (var instance in hero.Statuses)
        {
            if (instance.Status != Barrier || left <= 0)
            {
                next.Add(instance);
                continue;
            }
            double taken = Math.Min(instance.Value, left);
            left -= taken;
            double remaining = instance.Value - taken;
            if (remaining > 0) next.Add(instance with { Value = remaining });
        }
        return hero with { Statuses = next };
    }

    /// <summary>
    /// End-of-turn bookkeeping for the hero that just acted: cooldowns and durations down
    /// by one, expired statuses dropped, the hard control of this turn remembered.
    /// </summary>
    public static ApplyResult TickHeroAtTurnEnd(BattleHero hero, double extraCooldownTicks = 0)
    {
        var events = new List<BattleEvent>();

        var cooldowns = OrderedMap<double>.Empty;
        foreach (var (id, turns) in hero.Cooldowns)
        {
            // A negative cooldown never ticks: the ability is spent for the match.
            if (turns < 0)
            {
                cooldowns = cooldowns.Set(id, turns);
                continue;
            }
            double left = turns - 1 - Math.Max(0, extraCooldownTicks);
            if (left > 0) cooldowns = cooldowns.Set(id, left);
        }

        var statuses = new List<StatusInstance>();
        foreach (var instance in hero.Statuses)
        {
            if (instance.AppliedOnOwnTurn)
            {
                statuses.Add(instance with { AppliedOnOwnTurn = false });
                continue;
            }
            int turns = instance.Turns - 1;
            if (turns > 0) statuses.Add(instance with { Turns = turns });
            else events.Add(new StatusExpiredEvent(hero.Id, instance.Status));
        }

        return new(
            hero with
            {
                Cooldowns = cooldowns,
                Statuses = statuses,
                CcInPreviousTurn = hero.CcInCurrentTurn,
                CcInCurrentTurn = [],
                ReactedThisTurn = [],
            },
            events);
    }
}
