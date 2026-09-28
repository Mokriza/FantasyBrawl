using Brawl.Core;

namespace Brawl.Game;

/// <summary>What the board shows for one hero, which trails the real state.</summary>
public sealed record DisplayHero(Hex Hex, double Hp)
{
    /// <summary>A step in progress: the figure slides from here to Hex.</summary>
    public Hex? From { get; init; }
    public double WalkAt { get; init; }
    public double WalkMs { get; init; }
    /// <summary>When the hero was last hit, so the figure can flinch.</summary>
    public double HitAt { get; init; } = double.NegativeInfinity;
}

public enum FloatKind { Damage, Crit, Heal, Block, Status }

/// <summary>A number or a word rising off a hex.</summary>
public sealed record FloatingText(Hex Hex, string Text, FloatKind Kind, double BornAt);

public enum EffectKind { Bolt, Slash, Burst, Hit, Heal, Shield, Status, Death }

public enum EffectTone { Physical, Magic, Pure, Heal, Utility }

/// <summary>A short flourish that only shows what an event already says happened.</summary>
public sealed record BoardEffect(EffectKind Kind, EffectTone Tone, Hex From, Hex Hex, double BornAt, double Ms, bool Strong);

public sealed record Projection(
    IReadOnlyDictionary<string, DisplayHero> Heroes,
    IReadOnlyList<FloatingText> Floats,
    IReadOnlyList<BoardEffect> Effects);

/// <summary>
/// Turning battle events into what the board shows: a port of src/ui/playback.ts. Pure;
/// the battle screen owns the clock. The interface animates events, not the difference
/// between two states.
/// </summary>
public static class Playback
{
    /// <summary>How long each event holds the screen at speed x1, as in src/ui/config.ts.</summary>
    public static double EventMs(BattleEvent e) => e switch
    {
        BattleStartedEvent => 260,
        TurnStartedEvent => 220,
        TurnSkippedEvent => 500,
        TurnEndedEvent => 40,
        MovedEvent => 130,
        PushedEvent => 180,
        OpportunityAttackEvent => 380,
        AbilityUsedEvent => 300,
        DamagedEvent => 420,
        BarrierAbsorbedEvent => 260,
        HealedEvent => 400,
        StatusAppliedEvent => 260,
        StatusResistedEvent => 420,
        StatusExpiredEvent => 160,
        StatusCleansedEvent => 220,
        AtbChangedEvent => 200,
        DiedEvent => 600,
        PassiveTriggeredEvent => 380,
        TeleportedEvent => 260,
        ApChangedEvent => 200,
        CooldownsChangedEvent => 240,
        TerrainChangedEvent => 200,
        SummonedEvent => 380,
        AbilityDelayedEvent => 360,
        MatchEndedEvent => 300,
        ItemGainedEvent => 700,
        _ => 200,
    };

    public const double FloatMs = 900;
    public const double StepMs = 130;

    public static double EffectMs(EffectKind kind) => kind switch
    {
        EffectKind.Bolt => 280,
        EffectKind.Slash => 300,
        EffectKind.Burst => 480,
        EffectKind.Hit => 380,
        EffectKind.Heal => 650,
        EffectKind.Shield => 480,
        EffectKind.Status => 460,
        _ => 750,
    };

    public static Projection ProjectionOf(BattleState battle) => new(
        battle.Heroes.Values.ToDictionary(h => h.Id, h => new DisplayHero(h.Hex, h.Hp)),
        [],
        []);

    /// <summary>How an ability looks: in reach of a blade or from afar, and its colour.</summary>
    public static (bool Melee, EffectTone Tone) Look(Ability ability)
    {
        var damage = ability.Effects.OfType<DamageEffect>().FirstOrDefault();
        var tone = damage is not null
            ? damage.School switch { DamageSchool.Physical => EffectTone.Physical, DamageSchool.Magic => EffectTone.Magic, _ => EffectTone.Pure }
            : ability.Effects.Any(e => e is HealEffect or BarrierEffect) ? EffectTone.Heal : EffectTone.Utility;
        return (ability.Range <= 1, tone);
    }

    private static EffectTone ToneOf(DamageSchool school) => school switch
    {
        DamageSchool.Physical => EffectTone.Physical,
        DamageSchool.Magic => EffectTone.Magic,
        _ => EffectTone.Pure,
    };

    /// <summary>Moves the shown state one event forward. pace: 1 at x1, 0.5 at x2; 0 plays no flourishes.</summary>
    public static Projection Advance(Projection p, BattleEvent e, BattleState battle, ContentRegistry content, double now, double pace)
    {
        var heroes = new Dictionary<string, DisplayHero>(p.Heroes);
        var floats = p.Floats.ToList();
        var effects = p.Effects.ToList();
        Hex HexOf(string id) => heroes.TryGetValue(id, out var h) ? h.Hex : new Hex(0, 0);
        void Float(string id, string text, FloatKind kind) => floats.Add(new FloatingText(HexOf(id), text, kind, now));
        void Fx(EffectKind kind, EffectTone tone, Hex from, Hex at, bool strong = false)
        {
            if (pace > 0) effects.Add(new BoardEffect(kind, tone, from, at, now, EffectMs(kind) * pace, strong));
        }

        switch (e)
        {
            case SummonedEvent s:
                heroes[s.HeroId] = new DisplayHero(s.Hex, battle.Heroes.Get(s.HeroId)?.Base.MaxHp ?? 1);
                break;
            case MovedEvent m when heroes.TryGetValue(m.HeroId, out var mover):
                heroes[m.HeroId] = pace > 0 ? mover with { Hex = m.To, From = mover.Hex, WalkAt = now, WalkMs = StepMs * pace } : mover with { Hex = m.To, From = null };
                break;
            case PushedEvent m when heroes.TryGetValue(m.HeroId, out var pushed):
                heroes[m.HeroId] = pace > 0 ? pushed with { Hex = m.To, From = pushed.Hex, WalkAt = now, WalkMs = StepMs * pace } : pushed with { Hex = m.To, From = null };
                break;
            case TeleportedEvent t when heroes.TryGetValue(t.HeroId, out var jumper):
                heroes[t.HeroId] = jumper with { Hex = t.To, From = null };
                Fx(EffectKind.Burst, EffectTone.Utility, t.From, t.From);
                Fx(EffectKind.Burst, EffectTone.Utility, t.To, t.To);
                break;
            case AbilityUsedEvent u:
            {
                var ability = content.Abilities.Get(u.AbilityId);
                if (ability is null) break;
                var (melee, tone) = Look(ability);
                var from = HexOf(u.HeroId);
                var kind = from == u.Target ? EffectKind.Burst : melee ? EffectKind.Slash : EffectKind.Bolt;
                Fx(kind, tone, from, u.Target);
                break;
            }
            case OpportunityAttackEvent o:
                Fx(EffectKind.Slash, EffectTone.Physical, HexOf(o.AttackerId), HexOf(o.TargetId));
                break;
            case DamagedEvent d when d.Amount > 0 && heroes.TryGetValue(d.TargetId, out var hurt):
                heroes[d.TargetId] = hurt with
                {
                    Hp = Math.Max(0, hurt.Hp - d.Amount),
                    HitAt = d.Periodic == true || pace <= 0 ? hurt.HitAt : now,
                };
                Float(d.TargetId, $"−{d.Amount}", d.Crit ? FloatKind.Crit : FloatKind.Damage);
                Fx(d.Periodic == true ? EffectKind.Status : EffectKind.Hit, ToneOf(d.School), hurt.Hex, hurt.Hex, d.Crit);
                break;
            case HealedEvent h when h.Amount > 0 && heroes.TryGetValue(h.TargetId, out var healed):
            {
                double max = battle.Heroes.Get(h.TargetId)?.Base.MaxHp ?? double.PositiveInfinity;
                heroes[h.TargetId] = healed with { Hp = Math.Min(max, healed.Hp + h.Amount) };
                Float(h.TargetId, $"+{h.Amount}", FloatKind.Heal);
                Fx(EffectKind.Heal, EffectTone.Heal, healed.Hex, healed.Hex);
                break;
            }
            case BarrierAbsorbedEvent b:
                Float(b.TargetId, $"щит {b.Amount}", FloatKind.Block);
                Fx(EffectKind.Shield, EffectTone.Heal, HexOf(b.TargetId), HexOf(b.TargetId));
                break;
            case StatusAppliedEvent s:
                Fx(EffectKind.Status, EffectTone.Utility, HexOf(s.TargetId), HexOf(s.TargetId));
                break;
            case StatusResistedEvent r:
                Float(r.TargetId, "сопротивление", FloatKind.Status);
                break;
            case PassiveTriggeredEvent t:
                Float(t.HeroId, Texts.TraitName(t.PassiveId, content), FloatKind.Status);
                break;
            case DiedEvent d when heroes.TryGetValue(d.HeroId, out var dead):
                heroes[d.HeroId] = dead with { Hp = 0 };
                Fx(EffectKind.Death, EffectTone.Pure, dead.Hex, dead.Hex);
                break;
        }
        return new Projection(heroes, floats, effects);
    }

    public static Projection Prune(Projection p, double now) => p with
    {
        Floats = p.Floats.Where(f => now - f.BornAt < FloatMs).ToList(),
        Effects = p.Effects.Where(e => now - e.BornAt < e.Ms).ToList(),
    };
}
