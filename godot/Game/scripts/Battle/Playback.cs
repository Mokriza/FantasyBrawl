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

/// <summary>
/// What an effect is. The first eight are the plain flourishes; Anim, Projectile and Weapon
/// are named by vfx.json (an impact, something flying, a weapon swung); Lightning, Smite
/// and Beam are a bolt between two hexes, a column of light and a draining line.
/// </summary>
public enum EffectKind { Bolt, Slash, Burst, Hit, Heal, Shield, Status, Death, Anim, Projectile, Weapon, Lightning, Smite, Beam }

public enum EffectTone { Physical, Magic, Pure, Heal, Utility }

/// <summary>A short flourish that only shows what an event already says happened.</summary>
public sealed record BoardEffect(EffectKind Kind, EffectTone Tone, Hex From, Hex Hex, double BornAt, double Ms, bool Strong)
{
    /// <summary>For an Anim: which animation of vfx.json.</summary>
    public string? Anim { get; init; }
    /// <summary>For a Projectile or a Weapon: which sprite of vfx.json.</summary>
    public string? Sprite { get; init; }
    /// <summary>For a Weapon: slash, stab, smash, punch or shoot.</summary>
    public string? Motion { get; init; }
    /// <summary>For a Projectile: it falls from the sky onto Hex rather than flying from From.</summary>
    public bool Fall { get; init; }
}

/// <summary>
/// The ability being played out, from its abilityUsed to the end of the turn: its style,
/// where it came from and where its last blow landed, so a chain jumps on from there.
/// </summary>
public sealed record Casting(AbilityStyle Style, Hex From, Hex Target, Hex Last);

public sealed record Projection(
    IReadOnlyDictionary<string, DisplayHero> Heroes,
    IReadOnlyList<FloatingText> Floats,
    IReadOnlyList<BoardEffect> Effects)
{
    public Casting? Casting { get; init; }
}

/// <summary>
/// Turning battle events into what the board shows: a port of src/ui/playback.ts. Pure;
/// the battle session owns the clock. The interface animates events, not the difference
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
        EffectKind.Anim => 500,
        EffectKind.Projectile => 420,
        EffectKind.Weapon => 280,
        EffectKind.Lightning => 340,
        EffectKind.Smite => 560,
        EffectKind.Beam => 460,
        _ => 750,
    };

    public static Projection ProjectionOf(BattleState battle) => new(
        battle.Heroes.Values.ToDictionary(h => h.Id, h => new DisplayHero(h.Hex, h.Hp)),
        [],
        []);

    /// <summary>How an ability looks without a style: in reach of a blade or from afar, and its colour.</summary>
    public static (bool Melee, EffectTone Tone) Look(Ability ability)
    {
        var damage = ability.Effects.OfType<DamageEffect>().FirstOrDefault();
        var tone = damage is not null
            ? ToneOf(damage.School)
            : ability.Effects.Any(e => e is HealEffect or BarrierEffect) ? EffectTone.Heal : EffectTone.Utility;
        return (ability.Range <= 1, tone);
    }

    private static EffectTone ToneOf(DamageSchool school) => school switch
    {
        DamageSchool.Physical => EffectTone.Physical,
        DamageSchool.Magic => EffectTone.Magic,
        _ => EffectTone.Pure,
    };

    /// <summary>An effect before it gets its time and length.</summary>
    private sealed record Made(EffectKind Kind, EffectTone Tone, Hex From, Hex Hex)
    {
        public bool Strong { get; init; }
        public double? Ms { get; init; }
        public string? Anim { get; init; }
        public string? Sprite { get; init; }
        public string? Motion { get; init; }
        public bool Fall { get; init; }
    }

    /// <summary>
    /// Moves the shown state one event forward. pace: 1 at x1, 0.5 at x2; 0 plays no
    /// flourishes. Styles come from vfx.json for the heroes in battle.
    /// </summary>
    public static Projection Advance(Projection p, BattleEvent e, BattleState battle, ContentRegistry content, double now, double pace)
    {
        var heroes = new Dictionary<string, DisplayHero>(p.Heroes);
        var floats = p.Floats.ToList();
        var effects = p.Effects.ToList();
        var casting = p.Casting;
        Hex HexOf(string id) => heroes.TryGetValue(id, out var h) ? h.Hex : new Hex(0, 0);
        void Float(string id, string text, FloatKind kind) => floats.Add(new FloatingText(HexOf(id), text, kind, now));
        void Add(Made? m)
        {
            if (m is null || pace <= 0) return;
            effects.Add(new BoardEffect(m.Kind, m.Tone, m.From, m.Hex, now, (m.Ms ?? EffectMs(m.Kind)) * pace, m.Strong)
            {
                Anim = m.Anim,
                Sprite = m.Sprite,
                Motion = m.Motion,
                Fall = m.Fall,
            });
        }
        Made? Anim(string? name, Hex at, bool strong = false)
        {
            if (name is null) return null;
            double ms = Vfx.AnimationMs(name);
            return new Made(EffectKind.Anim, EffectTone.Utility, at, at) { Anim = name, Strong = strong, Ms = ms > 0 ? ms : EffectMs(EffectKind.Anim) };
        }
        Projection Done() => new(heroes, floats, effects) { Casting = casting };

        switch (e)
        {
            case TurnStartedEvent or TurnEndedEvent:
                // A new turn: whatever was cast has landed.
                casting = null;
                break;

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
                if (casting?.Style.Delivery == "blink")
                {
                    Add(Anim(casting.Style.Impact, t.From));
                    Add(Anim(casting.Style.Impact, t.To));
                }
                else
                {
                    Add(new Made(EffectKind.Burst, EffectTone.Utility, t.From, t.From));
                    Add(new Made(EffectKind.Burst, EffectTone.Utility, t.To, t.To));
                }
                break;

            case AbilityUsedEvent u:
            {
                var ability = content.Abilities.Get(u.AbilityId);
                if (ability is null) break;
                var from = HexOf(u.HeroId);
                var to = u.Target;
                var style = Vfx.For(battle, content, u.AbilityId, u.HeroId);
                if (style is null)
                {
                    var (melee, tone) = Look(ability);
                    var kind = from == to ? EffectKind.Burst : melee ? EffectKind.Slash : EffectKind.Bolt;
                    Add(new Made(kind, tone, from, to));
                    break;
                }
                // A delayed ability ("Метеор") is only prepared now: a circle round the caster.
                if (u.Ap > 0 && ability.Delay is not null)
                {
                    casting = null;
                    Add(Anim("arcaneCircle", from));
                    break;
                }
                casting = new Casting(style, from, to, from);
                switch (style.Delivery)
                {
                    case "swing":
                        Add(new Made(EffectKind.Weapon, EffectTone.Physical, from, to) { Sprite = style.Weapon, Motion = style.Motion ?? "slash" });
                        break;
                    case "shoot":
                        Add(new Made(EffectKind.Weapon, EffectTone.Physical, from, to) { Sprite = style.Weapon, Motion = "shoot" });
                        if (style.Projectile is { } arrow) Add(new Made(EffectKind.Projectile, EffectTone.Physical, from, to) { Sprite = arrow });
                        break;
                    case "projectile":
                        if (style.Projectile is { } shot) Add(new Made(EffectKind.Projectile, EffectTone.Magic, from, to) { Sprite = shot });
                        break;
                    case "rain":
                        if (style.Projectile is { } falling) Add(new Made(EffectKind.Projectile, EffectTone.Magic, to, to) { Sprite = falling, Fall = true });
                        break;
                    case "smite":
                        Add(new Made(EffectKind.Smite, EffectTone.Magic, to, to));
                        break;
                    case "aura":
                        Add(Anim(style.CastAnim ?? style.Impact, from));
                        break;
                    case "cast":
                        Add(Anim(style.Impact, to));
                        break;
                    // blink, chain, drain, move: drawn by the events that follow.
                }
                break;
            }

            case OpportunityAttackEvent o:
            {
                var from = HexOf(o.AttackerId);
                var to = HexOf(o.TargetId);
                var style = Vfx.BasicFor(battle, content, o.AttackerId);
                if (style is null)
                {
                    Add(new Made(EffectKind.Slash, EffectTone.Physical, from, to));
                    break;
                }
                casting = new Casting(style, from, to, from);
                if (style.Delivery == "swing")
                    Add(new Made(EffectKind.Weapon, EffectTone.Physical, from, to) { Sprite = style.Weapon, Motion = style.Motion ?? "slash" });
                break;
            }

            case DamagedEvent d when d.Amount > 0 && heroes.TryGetValue(d.TargetId, out var hurt):
            {
                heroes[d.TargetId] = hurt with
                {
                    Hp = Math.Max(0, hurt.Hp - d.Amount),
                    HitAt = d.Periodic == true || pace <= 0 ? hurt.HitAt : now,
                };
                Float(d.TargetId, $"−{d.Amount}", d.Crit ? FloatKind.Crit : FloatKind.Damage);
                var at = hurt.Hex;
                if (casting is not null && d.Periodic != true)
                {
                    var style = casting.Style;
                    // Lightning jumps on from its last blow; arrows of a volley each fly from
                    // the shooter; a drain pulls back to the caster.
                    if (style.Delivery == "chain")
                    {
                        Add(style.Projectile is { } arrow
                            ? new Made(EffectKind.Projectile, EffectTone.Physical, casting.From, at) { Sprite = arrow }
                            : new Made(EffectKind.Lightning, EffectTone.Magic, casting.Last, at));
                    }
                    if (style.Delivery == "drain") Add(new Made(EffectKind.Beam, EffectTone.Magic, at, casting.From));
                    // A cast already played its picture on the target it was aimed at.
                    bool played = style.Delivery == "cast" && at == casting.Target;
                    if (!played) Add(Anim(style.Impact, at, d.Crit) ?? new Made(EffectKind.Hit, ToneOf(d.School), at, at) { Strong = d.Crit });
                    casting = casting with { Last = at };
                }
                else
                {
                    Add(new Made(d.Periodic == true ? EffectKind.Status : EffectKind.Hit, ToneOf(d.School), at, at) { Strong = d.Crit });
                }
                break;
            }

            case HealedEvent h when h.Amount > 0 && heroes.TryGetValue(h.TargetId, out var healed):
            {
                double max = battle.Heroes.Get(h.TargetId)?.Base.MaxHp ?? double.PositiveInfinity;
                heroes[h.TargetId] = healed with { Hp = Math.Min(max, healed.Hp + h.Amount) };
                Float(h.TargetId, $"+{h.Amount}", FloatKind.Heal);
                var at = healed.Hex;
                // Under a styled cast the glow plays where it lands, unless the cast already played it there.
                if (casting is null) Add(new Made(EffectKind.Heal, EffectTone.Heal, at, at));
                else if (!(casting.Style.Delivery == "cast" && at == casting.Target)) Add(Anim("heal", at));
                break;
            }

            case BarrierAbsorbedEvent b:
                Float(b.TargetId, $"щит {b.Amount}", FloatKind.Block);
                Add(new Made(EffectKind.Shield, EffectTone.Heal, HexOf(b.TargetId), HexOf(b.TargetId)));
                break;

            case StatusAppliedEvent s:
                Add(new Made(EffectKind.Status, EffectTone.Utility, HexOf(s.TargetId), HexOf(s.TargetId)));
                break;

            case StatusResistedEvent r:
                Float(r.TargetId, "сопротивление", FloatKind.Status);
                break;

            case PassiveTriggeredEvent t:
                Float(t.HeroId, Texts.TraitName(t.PassiveId, content), FloatKind.Status);
                break;

            case DiedEvent d when heroes.TryGetValue(d.HeroId, out var dead):
                heroes[d.HeroId] = dead with { Hp = 0 };
                Add(new Made(EffectKind.Death, EffectTone.Pure, dead.Hex, dead.Hex));
                break;
        }
        return Done();
    }

    /// <summary>The sound an event makes, if any: the style's own sounds, else a plain one. Port of soundOf.</summary>
    public static string? SoundOf(BattleEvent e, Casting? casting, BattleState battle, ContentRegistry content)
    {
        switch (e)
        {
            case AbilityUsedEvent u when Vfx.For(battle, content, u.AbilityId, u.HeroId) is { } style:
                return style.CastSound;
            case OpportunityAttackEvent o when Vfx.BasicFor(battle, content, o.AttackerId) is { } basic:
                return basic.CastSound;
        }
        if (casting is not null)
        {
            if (e is DamagedEvent { Amount: > 0 } hit && hit.Periodic != true && casting.Style.ImpactSound is { } impact) return impact;
            // The cast sound of a healing ability or a teleport already said it.
            if (e is HealedEvent or TeleportedEvent) return null;
        }
        return e switch
        {
            MovedEvent or PushedEvent => "step",
            TeleportedEvent => "spell",
            AbilityUsedEvent u when content.Abilities.Get(u.AbilityId) is { } a => Look(a) switch
            {
                (true, EffectTone.Physical) => "swing",
                (false, EffectTone.Physical) => "shoot",
                _ => "spell",
            },
            OpportunityAttackEvent => "swing",
            DamagedEvent { Amount: > 0 } d => d.Crit ? "crit" : d.School == DamageSchool.Physical ? "hit" : "hitMagic",
            HealedEvent { Amount: > 0 } => "heal",
            BarrierAbsorbedEvent => "block",
            StatusAppliedEvent or StatusResistedEvent => "status",
            DiedEvent => "death",
            _ => null,
        };
    }

    /// <summary>How long until every shot in flight has landed: the next event waits for it.</summary>
    public static double InFlightMs(IReadOnlyList<BoardEffect> effects, double now)
    {
        double longest = 0;
        foreach (var e in effects)
            if (e.Kind == EffectKind.Projectile) longest = Math.Max(longest, e.BornAt + e.Ms - now);
        return longest;
    }

    public static Projection Prune(Projection p, double now) => p with
    {
        Floats = p.Floats.Where(f => now - f.BornAt < FloatMs).ToList(),
        Effects = p.Effects.Where(e => now - e.BornAt < e.Ms).ToList(),
    };
}
