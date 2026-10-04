using System.Text.Json;
using System.Text.Json.Serialization;
using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>How an ability looks and sounds: an entry of vfx.json's "styles". See src/ui/vfx.ts.</summary>
public sealed record AbilityStyle
{
    public required string Delivery { get; init; }
    public string? Weapon { get; init; }
    public string? Motion { get; init; }
    public string? Projectile { get; init; }
    public string? Impact { get; init; }
    public string? CastAnim { get; init; }
    public string? CastSound { get; init; }
    public string? ImpactSound { get; init; }
}

public sealed record SoundInfo(string Url, double Volume);

/// <summary>
/// The web game's assets/vfx.json, copied in at build time (Game.csproj) and read the
/// same way as src/ui/vfx.ts: every ability gets a style — its entry in "abilities", for
/// a basic attack the style of the attacker's class, or failing both one guessed from
/// the ability's own data. The pictures it names are 2D; the 3D board draws its own
/// effects under the same names (Effects3D).
/// </summary>
public static class Vfx
{
    private sealed record Animation(int Frames, double FrameMs);

    private sealed record Data(
        Dictionary<string, JsonElement> Animations,
        Dictionary<string, JsonElement> Sounds,
        Dictionary<string, JsonElement> Styles,
        Dictionary<string, JsonElement> BasicAttacks,
        Dictionary<string, JsonElement> Abilities);

    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    private static Data? data;

    private static Data Loaded
    {
        get
        {
            if (data is not null) return data;
            using var file = Godot.FileAccess.Open("res://content/vfx.json", Godot.FileAccess.ModeFlags.Read)
                ?? throw new InvalidOperationException($"Cannot open res://content/vfx.json: {Godot.FileAccess.GetOpenError()}");
            data = JsonSerializer.Deserialize<Data>(file.GetAsText(), Json) ?? throw new InvalidOperationException("vfx.json is empty");
            return data;
        }
    }

    private static T? Entry<T>(Dictionary<string, JsonElement> table, string key) where T : class =>
        !key.StartsWith('_') && table.TryGetValue(key, out var e) && e.ValueKind == JsonValueKind.Object ? e.Deserialize<T>(Json) : null;

    private static string? Name(Dictionary<string, JsonElement> table, string key) =>
        !key.StartsWith('_') && table.TryGetValue(key, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;

    private static readonly Dictionary<string, AbilityStyle?> Styles = [];

    private static AbilityStyle? Style(string name)
    {
        if (!Styles.TryGetValue(name, out var style)) Styles[name] = style = Entry<AbilityStyle>(Loaded.Styles, name);
        return style;
    }

    public static SoundInfo? Sound(string name) => Entry<SoundInfo>(Loaded.Sounds, name);

    public static IEnumerable<string> SoundNames => Loaded.Sounds.Keys.Where(k => !k.StartsWith('_'));

    /// <summary>How long an animation plays at speed x1; 0 for an unknown one.</summary>
    public static double AnimationMs(string name) =>
        Entry<Animation>(Loaded.Animations, name) is { } a ? a.Frames * a.FrameMs : 0;

    private static readonly AbilityStyle Plain = new() { Delivery = "cast" };

    private static AbilityStyle Guessed(Ability ability)
    {
        if (ability.Effects.OfType<DamageEffect>().FirstOrDefault() is { } damage)
        {
            if (damage.School == DamageSchool.Physical) return Style(ability.Range <= 1 ? "sword" : "bow") ?? Plain;
            return Style("arcaneBolt") ?? Plain;
        }
        if (ability.Effects.Any(e => e is HealEffect)) return Style("heal") ?? Plain;
        if (ability.Effects.Any(e => e is BarrierEffect)) return Style("shieldHoly") ?? Plain;
        return Style("buff") ?? Plain;
    }

    /// <summary>The style of an ability used by a hero of this class; a basic attack takes the class's weapon.</summary>
    public static AbilityStyle StyleOf(Ability ability, string? classId, bool isBasic)
    {
        string? byClass = isBasic && classId is not null ? Name(Loaded.BasicAttacks, classId) : null;
        string? name = byClass ?? Name(Loaded.Abilities, ability.Id);
        return (name is null ? null : Style(name)) ?? Guessed(ability);
    }

    /// <summary>The style of an ability as this hero uses it, or null when either is unknown.</summary>
    public static AbilityStyle? For(BattleState battle, ContentRegistry content, string abilityId, string heroId)
    {
        var ability = content.Abilities.Get(abilityId);
        var hero = battle.Heroes.Get(heroId);
        if (ability is null) return null;
        string? basic = hero is null ? null : content.Classes.Get(hero.ClassId)?.BaseAttack;
        return StyleOf(ability, hero?.ClassId, basic == abilityId);
    }

    /// <summary>The style of a hero's basic attack, for a blow struck at someone leaving.</summary>
    public static AbilityStyle? BasicFor(BattleState battle, ContentRegistry content, string heroId)
    {
        var hero = battle.Heroes.Get(heroId);
        string? basic = hero is null ? null : content.Classes.Get(hero.ClassId)?.BaseAttack;
        return basic is null ? null : For(battle, content, basic, heroId);
    }
}
