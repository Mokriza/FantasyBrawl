namespace Brawl.Core;

/// <summary>Everything an effect atom needs. A port of battle/effects/context.ts.</summary>
public sealed record EffectContext
{
    public required BattleState State { get; init; }
    public required string CasterId { get; init; }
    /// <summary>The ability being run, or null inside a trigger.</summary>
    public Ability? Ability { get; init; }
    /// <summary>The hero this atom lands on; null when the shape hit an empty hex.</summary>
    public string? TargetId { get; init; }
    /// <summary>The hex the player aimed at, which push and move read for direction.</summary>
    public required Hex AimedAt { get; init; }
    /// <summary>Shape multiplier; only chain uses anything but 1.</summary>
    public required double Mul { get; init; }
    public required ContentRegistry Content { get; init; }
    public required RollMode Mode { get; init; }
    public required bool CasterIsActing { get; init; }
    public required bool IgnoresZoc { get; init; }
    /// <summary>Results of the previous atom, which the "if" conditions read.</summary>
    public required double LastDamage { get; init; }
    public required bool LastCrit { get; init; }
    public required bool LastKilled { get; init; }
}

public sealed record EffectOutcome(BattleState State, IReadOnlyList<BattleEvent> Events)
{
    public double? LastDamage { get; init; }
    public bool? LastCrit { get; init; }
    public bool? LastKilled { get; init; }
    /// <summary>Enemies the atom's movement gave a free swing to; the action runner resolves them.</summary>
    public IReadOnlyList<string>? Provoked { get; init; }

    public static EffectOutcome NoChange(EffectContext ctx) => new(ctx.State, []);
}

public static class Damage
{
    /// <summary>Counter key: the hero took damage since the end of its previous turn.</summary>
    public const string HurtSinceTurn = "hurtSinceTurn";

    public sealed record Result(BattleState State, List<BattleEvent> Events, bool Killed, double Dealt);

    /// <summary>Subtracts hit points and settles death immediately.</summary>
    public static Result DamageHero(BattleState state, string targetId, double absorbedByBarrier, double amount, ContentRegistry content)
    {
        var events = new List<BattleEvent>();
        var next = state;

        // Invulnerable: the hit does nothing at all, and nothing is spent.
        if (amount + absorbedByBarrier > 0 && Statuses.HasStatus(Query.HeroById(next, targetId), Statuses.Invulnerable))
        {
            events.Add(new BarrierAbsorbedEvent(targetId, JsMath.Round(amount + absorbedByBarrier), 0));
            return new(next, events, false, 0);
        }

        // A ward swallows the whole of the first hit, barrier and all, then is gone.
        if (amount + absorbedByBarrier > 0 && Statuses.HasStatus(Query.HeroById(next, targetId), Statuses.Ward))
        {
            next = Query.UpdateHero(next, targetId, hero => hero with { Statuses = hero.Statuses.Where(s => s.Status != Statuses.Ward).ToList() });
            events.Add(new BarrierAbsorbedEvent(targetId, JsMath.Round(amount + absorbedByBarrier), 0));
            return new(next, events, false, 0);
        }

        if (absorbedByBarrier > 0)
        {
            next = Query.UpdateHero(next, targetId, hero => Statuses.SpendBarrier(hero, absorbedByBarrier));
            double left = Query.HeroById(next, targetId).Statuses.Where(s => s.Status == Statuses.Barrier).Aggregate(0.0, (sum, s) => sum + s.Value);
            events.Add(new BarrierAbsorbedEvent(targetId, JsMath.Round(absorbedByBarrier), JsMath.Round(left)));
        }

        double before = Query.HeroById(next, targetId).Hp;
        double after = Math.Max(0, before - amount);
        double dealtAmount = amount;
        // "Оберег": the blow that would kill leaves 1 instead, once.
        if (after == 0 && before > 0 && Statuses.HasStatus(Query.HeroById(next, targetId), Statuses.DeathWard))
        {
            after = 1;
            next = Query.UpdateHero(next, targetId, hero => hero with { Statuses = hero.Statuses.Where(s => s.Status != Statuses.DeathWard).ToList() });
            events.Add(new StatusExpiredEvent(targetId, Statuses.DeathWard));
            dealtAmount = before - 1;
        }
        // "Сердце феникса": the blow that would kill leaves a share of health instead, once.
        if (after == 0 && before > 0)
        {
            var phoenix = Query.HeroById(next, targetId).Statuses.FirstOrDefault(s => (content.Statuses.Get(s.Status)?.ReviveAtPct ?? 0) > 0);
            double pct = phoenix is null ? 0 : content.Statuses.Get(phoenix.Status)?.ReviveAtPct ?? 0;
            if (phoenix is not null && pct > 0)
            {
                after = Math.Max(1, JsMath.Round(Query.HeroById(next, targetId).Base.MaxHp * pct));
                next = Query.UpdateHero(next, targetId, hero => hero with { Statuses = hero.Statuses.Where(s => !ReferenceEquals(s, phoenix)).ToList() });
                events.Add(new StatusExpiredEvent(targetId, phoenix.Status));
            }
        }
        double finalHp = after;
        next = Query.UpdateHero(next, targetId, hero => hero with
        {
            Hp = finalHp,
            Counters = dealtAmount > 0 ? hero.Counters.Set(HurtSinceTurn, 1) : hero.Counters,
        });

        bool killed = before > 0 && after == 0;
        if (killed)
        {
            // A dead hero drops every status and leaves the board; its ATB freezes where it is.
            next = Query.UpdateHero(next, targetId, hero => hero with { Statuses = [] });
            events.Add(new DiedEvent(targetId));
        }
        return new(next, events, killed, dealtAmount);
    }

    public static (BattleState State, double Healed) HealHero(BattleState state, string targetId, double amount)
    {
        var hero = Query.HeroById(state, targetId);
        double healed = Math.Max(0, Math.Min(amount, hero.Base.MaxHp - hero.Hp));
        if (healed == 0) return (state, 0);
        return (Query.UpdateHero(state, targetId, h => h with { Hp = h.Hp + healed }), healed);
    }
}
