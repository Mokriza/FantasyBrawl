using System.Text.Json;
using System.Text.Json.Serialization;

namespace Brawl.Core;

// The closed list of effect atoms, a port of the schemas in src/core/content.ts. Field
// names follow the JSON exactly (camelCase); an absent optional field is null.

public sealed record EffectCondition
{
    public string? TargetHas { get; init; }
    public double? TargetHpBelowPct { get; init; }
    public double? CasterHpBelowPct { get; init; }
    public bool? WasCrit { get; init; }
    public bool? Killed { get; init; }
    /// <summary>True: only on the caster's allies (the caster included); false: only on enemies.</summary>
    public bool? TargetIsAlly { get; init; }
    /// <summary>Nothing has hurt the caster since the end of its previous turn.</summary>
    public bool? CasterUndamagedSinceLastTurn { get; init; }
}

/// <summary>One atom of what an ability, a trigger or a trap does.</summary>
public abstract record Effect
{
    [JsonPropertyName("type")]
    public required string Type { get; init; }

    public EffectCondition? If { get; init; }
}

public sealed record DamageEffect : Effect
{
    public required DamageSchool School { get; init; }
    public required ScaleStat Scale { get; init; }
    public required double K { get; init; }
    public int? Hits { get; init; }
    public double? CritBonus { get; init; }
    public bool? NoCrit { get; init; }
    public bool? AlwaysCrit { get; init; }
    public double? ArmorPierce { get; init; }
    public BonusVsLowHp? BonusVsLowHp { get; init; }
    public double? PerHexBonus { get; init; }
}

public sealed record BonusVsLowHp(double BelowPct, double Mul);

public sealed record HealEffect : Effect
{
    public ScaleStat? Scale { get; init; }
    public double? K { get; init; }
    public double? MissingHpPct { get; init; }
    public bool? Full { get; init; }
    public int? Flat { get; init; }
    public double? PctMaxHp { get; init; }
}

public sealed record StatusEffect : Effect
{
    public required string Status { get; init; }
    public required int Turns { get; init; }
    public double? Value { get; init; }
    public int? Stacks { get; init; }
}

public sealed record BarrierEffect : Effect
{
    public required ScaleStat Scale { get; init; }
    public required double K { get; init; }
    public required int Turns { get; init; }
    public double? PctOfEvent { get; init; }
}

public sealed record MoveEffect : Effect
{
    public required MoveTo To { get; init; }
}

public sealed record PushEffect : Effect
{
    public required int Distance { get; init; }
    public required PushFrom From { get; init; }
}

public sealed record AtbEffect : Effect
{
    public required double Delta { get; init; }
}

public sealed record CleanseEffect : Effect
{
    public required CleanseWhat What { get; init; }
    public int? Count { get; init; }
}

/// <summary>"debuffs", "all", or a list of status ids.</summary>
[JsonConverter(typeof(CleanseWhatConverter))]
public sealed record CleanseWhat(string? Kind, IReadOnlyList<string>? Ids);

public sealed class CleanseWhatConverter : JsonConverter<CleanseWhat>
{
    public override CleanseWhat Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            string kind = reader.GetString()!;
            if (kind != "debuffs" && kind != "all") throw new JsonException($"cleanse: unknown what \"{kind}\"");
            return new CleanseWhat(kind, null);
        }
        var ids = JsonSerializer.Deserialize<List<string>>(ref reader, options) ?? throw new JsonException("cleanse: what");
        return new CleanseWhat(null, ids);
    }

    public override void Write(Utf8JsonWriter writer, CleanseWhat value, JsonSerializerOptions options)
    {
        if (value.Kind is not null) writer.WriteStringValue(value.Kind);
        else JsonSerializer.Serialize(writer, value.Ids, options);
    }
}

public sealed record LifestealEffect : Effect
{
    public required double Pct { get; init; }
}

public sealed record RelayEffect : Effect
{
    public required double Pct { get; init; }
    public required DamageSchool School { get; init; }
}

public sealed record EchoEffect : Effect
{
    public required double Mul { get; init; }
}

public sealed record TeleportEffect : Effect;

public sealed record ApEffect : Effect
{
    public required int Delta { get; init; }
    public Who? Who { get; init; }
}

public sealed record CooldownEffect : Effect
{
    public required CooldownMode Mode { get; init; }
    public Who? Who { get; init; }
}

public sealed record SelfDamageEffect : Effect
{
    public double? PctMaxHp { get; init; }
    public double? PctCurrentHp { get; init; }
}

public sealed record SpreadEffect : Effect
{
    public required string Status { get; init; }
    public required int Radius { get; init; }
}

public sealed record TerrainEffect : Effect
{
    public required TerrainId Terrain { get; init; }
    public required int Turns { get; init; }
    public IReadOnlyList<Effect>? OnEnter { get; init; }
}

public sealed record SummonEffect : Effect
{
    public required string Unit { get; init; }
    public required int Hp { get; init; }
    public required int Turns { get; init; }
    public required SummonAttack Attack { get; init; }
}

public sealed record SummonAttack(double K, ScaleStat Scale, DamageSchool School, int Radius);

public static class EffectTypes
{
    public static readonly IReadOnlyDictionary<string, Type> ByName = new Dictionary<string, Type>
    {
        ["damage"] = typeof(DamageEffect),
        ["heal"] = typeof(HealEffect),
        ["status"] = typeof(StatusEffect),
        ["barrier"] = typeof(BarrierEffect),
        ["move"] = typeof(MoveEffect),
        ["push"] = typeof(PushEffect),
        ["atb"] = typeof(AtbEffect),
        ["cleanse"] = typeof(CleanseEffect),
        ["lifesteal"] = typeof(LifestealEffect),
        ["relay"] = typeof(RelayEffect),
        ["echo"] = typeof(EchoEffect),
        ["teleport"] = typeof(TeleportEffect),
        ["ap"] = typeof(ApEffect),
        ["cooldown"] = typeof(CooldownEffect),
        ["selfDamage"] = typeof(SelfDamageEffect),
        ["spread"] = typeof(SpreadEffect),
        ["terrain"] = typeof(TerrainEffect),
        ["summon"] = typeof(SummonEffect),
    };
}
