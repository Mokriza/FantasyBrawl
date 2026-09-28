using System.Text.Json;
using System.Text.Json.Serialization;

namespace Brawl.Core;

// Abilities, statuses, classes, passives, races, perks, items and arena modifiers: a port
// of the schemas in src/core/content.ts. See docs/ai/content-schema.md.

// --- modifiers and triggers ----------------------------------------------------------

public sealed record ModifierCondition
{
    public double? TargetHpBelowPct { get; init; }
    /// <summary>A status id, or "debuff", "buff" or "control".</summary>
    public string? TargetHas { get; init; }
    public double? SelfHpAbovePct { get; init; }
    public double? SelfHpBelowPct { get; init; }
    public int? TargetDistanceAbove { get; init; }
    public bool? NoAdjacentAllies { get; init; }
    public bool? TargetIsolated { get; init; }
    public bool? TargetActedLast { get; init; }
    public int? AbilityTierAtLeast { get; init; }
}

public sealed record Modifier
{
    public required ModifierStat Stat { get; init; }
    public double? Add { get; init; }
    public double? Mul { get; init; }
    public ModifierScope? Scope { get; init; }
    public ModifierCondition? When { get; init; }
    public ModifierPer? Per { get; init; }
}

public sealed record Trigger
{
    public required TriggerEvent On { get; init; }
    public TriggerTarget? To { get; init; }
    public int? Radius { get; init; }
    public int? Every { get; init; }
    public bool? OncePerMatch { get; init; }
    public bool? Periodic { get; init; }
    public DamageSchool? School { get; init; }
    public required IReadOnlyList<Effect> Effects { get; init; }
}

public sealed record Passive
{
    public required string Id { get; init; }
    public required string Class { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required int Tier { get; init; }
    public IReadOnlyList<Modifier> Modifiers { get; init; } = [];
    public IReadOnlyList<Trigger> Triggers { get; init; } = [];
}

public sealed record RaceModifier
{
    public required ModifierStat Stat { get; init; }
    public double? Add { get; init; }
    public double? MulBase { get; init; }
    public double? Mul { get; init; }
}

public sealed record Race
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required IReadOnlyList<RaceModifier> Modifiers { get; init; }
}

public sealed record AbilityMod
{
    public int? Ap { get; init; }
    public int? Cooldown { get; init; }
    public int? Range { get; init; }
}

public sealed record Perk
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required PerkCategory Category { get; init; }
    public IReadOnlyList<Role>? Roles { get; init; }
    public IReadOnlyList<string>? Classes { get; init; }
    public bool? Unique { get; init; }
    public IReadOnlyList<Modifier> Modifiers { get; init; } = [];
    public IReadOnlyList<Trigger> Triggers { get; init; } = [];
    public AbilityMod? AbilityMod { get; init; }
}

public sealed record Item
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required ItemTier Tier { get; init; }
    public IReadOnlyList<Role>? Roles { get; init; }
    public IReadOnlyList<string>? Classes { get; init; }
    public int? Cost { get; init; }
    public IReadOnlyList<Modifier> Modifiers { get; init; } = [];
    public IReadOnlyList<Trigger> Triggers { get; init; } = [];
}

// --- arena modifiers -----------------------------------------------------------------

public abstract record ArenaRules
{
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }
}

public sealed record ShrinkRules : ArenaRules
{
    public required int EveryRounds { get; init; }
    public required int RingDamage { get; init; }
}

public sealed record ManaStormRules : ArenaRules
{
    public required int CooldownBonus { get; init; }
    public required double DotMultiplier { get; init; }
}

public sealed record BloodHarvestRules : ArenaRules
{
    public required double HealMultiplier { get; init; }
    public required int KillAtb { get; init; }
}

public sealed record FogRules : ArenaRules
{
    public required int SightRange { get; init; }
}

public sealed record PowerPointRules : ArenaRules
{
    public required double DamageBonus { get; init; }
    public required int HoldRounds { get; init; }
}

public sealed record GuardianRules : ArenaRules
{
    public required string ClassId { get; init; }
    public required int MaxHp { get; init; }
    public required double Attack { get; init; }
    public required double Armor { get; init; }
    public required double Resist { get; init; }
    public required double Speed { get; init; }
    public required double K { get; init; }
}

public sealed record ArenaModifier
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required ArenaRules Rules { get; init; }
}

public static class ArenaRuleTypes
{
    public static readonly IReadOnlyDictionary<string, Type> ByName = new Dictionary<string, Type>
    {
        ["shrink"] = typeof(ShrinkRules),
        ["manaStorm"] = typeof(ManaStormRules),
        ["bloodHarvest"] = typeof(BloodHarvestRules),
        ["fog"] = typeof(FogRules),
        ["powerPoint"] = typeof(PowerPointRules),
        ["guardian"] = typeof(GuardianRules),
    };
}

// --- targeting shapes ----------------------------------------------------------------

public abstract record Shape
{
    [JsonPropertyName("type")]
    public required string Type { get; init; }
}

public sealed record SingleShape : Shape
{
    public ShapeFilter? Filter { get; init; }
}

public sealed record TargetPlusAdjacentShape : Shape
{
    public required int Count { get; init; }
    public ShapeFilter? Filter { get; init; }
}

public sealed record BlobShape : Shape
{
    /// <summary>1, 3 or 7: the target alone, a triangle facing the caster, or the target and its ring.</summary>
    public required int Size { get; init; }
    public ShapeFilter? Filter { get; init; }
}

/// <summary>Centred on the caster, not on the target hex.</summary>
public sealed record AuraShape : Shape
{
    public required int Radius { get; init; }
    public ShapeFilter? Filter { get; init; }
}

public sealed record LineShape : Shape
{
    public required int Length { get; init; }
    public ShapeFilter? Filter { get; init; }
}

public sealed record ConeShape : Shape
{
    public ShapeFilter? Filter { get; init; }
}

public sealed record ChainShape : Shape
{
    public required int Jumps { get; init; }
    public required double Falloff { get; init; }
    public int? JumpRange { get; init; }
    public ShapeFilter? Filter { get; init; }
}

public sealed record AllAlliesShape : Shape;

public sealed record AllEnemiesShape : Shape;

public static class ShapeTypes
{
    public static readonly IReadOnlyDictionary<string, Type> ByName = new Dictionary<string, Type>
    {
        ["single"] = typeof(SingleShape),
        ["targetPlusAdjacent"] = typeof(TargetPlusAdjacentShape),
        ["blob"] = typeof(BlobShape),
        ["aura"] = typeof(AuraShape),
        ["line"] = typeof(LineShape),
        ["cone"] = typeof(ConeShape),
        ["chain"] = typeof(ChainShape),
        ["allAllies"] = typeof(AllAlliesShape),
        ["allEnemies"] = typeof(AllEnemiesShape),
    };
}

// --- abilities -----------------------------------------------------------------------

/// <summary>A cooldown in turns, or "once": once per match.</summary>
[JsonConverter(typeof(AbilityCooldownConverter))]
public readonly record struct AbilityCooldown(bool Once, int Turns)
{
    public static AbilityCooldown OfTurns(int turns) => new(false, turns);
}

public sealed class AbilityCooldownConverter : JsonConverter<AbilityCooldown>
{
    public override AbilityCooldown Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            return reader.GetString() == "once" ? new AbilityCooldown(true, 0) : throw new JsonException("cooldown: expected \"once\"");
        }
        return new AbilityCooldown(false, reader.GetInt32());
    }

    public override void Write(Utf8JsonWriter writer, AbilityCooldown value, JsonSerializerOptions options)
    {
        if (value.Once) writer.WriteStringValue("once");
        else writer.WriteNumberValue(value.Turns);
    }
}

public sealed record Ability
{
    public required string Id { get; init; }
    public required string Class { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required string Icon { get; init; }
    public required int Tier { get; init; }
    public required int Ap { get; init; }
    public required AbilityCooldown Cooldown { get; init; }
    public required int Range { get; init; }
    public required AbilityTargets Targets { get; init; }
    public required bool RequiresLos { get; init; }
    public required Shape Shape { get; init; }
    public required IReadOnlyList<Effect> Effects { get; init; }
    public bool? IgnoresZoc { get; init; }
    public bool? Basic { get; init; }
    public int? Delay { get; init; }
}

// --- statuses ------------------------------------------------------------------------

public sealed record AtbOnEnemyAction(int Radius, double Delta);

public sealed record StatusDef
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required StatusKind Kind { get; init; }
    public required bool HardControl { get; init; }
    public required int MaxStacks { get; init; }
    public required ValueKind ValueKind { get; init; }
    public StatName? Stat { get; init; }
    public IReadOnlyList<StatName>? Stats { get; init; }
    public ModifierStat? BattleStat { get; init; }
    public int? BattleSign { get; init; }
    public bool? ControlImmune { get; init; }
    public bool? IgnoresLos { get; init; }
    public bool? Untargetable { get; init; }
    public bool? Invulnerable { get; init; }
    public bool? DeathWard { get; init; }
    public bool? BreaksOnDamageDealt { get; init; }
    public bool? CritsWhileOn { get; init; }
    public double? ReflectPct { get; init; }
    public string? BlocksStatus { get; init; }
    public double? ReviveAtPct { get; init; }
    public int? ApOnKill { get; init; }
    public AtbOnEnemyAction? AtbOnEnemyAction { get; init; }
    public double? DrainPctMaxHp { get; init; }
}

// --- classes -------------------------------------------------------------------------

public sealed record StatGrowth(double Hp, double Primary, double Secondary);

public sealed record HeroClass
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required Role Role { get; init; }
    public required StatName PrimaryStat { get; init; }
    public required IReadOnlyList<StatName> SecondaryStats { get; init; }
    public required string BaseAttack { get; init; }
    public required StatGrowth StatGrowth { get; init; }
    public IReadOnlyList<Modifier>? Modifiers { get; init; }
    public string? TraitDescription { get; init; }
    public required string Portrait { get; init; }
    public required string Color { get; init; }
    public bool? SummonOnly { get; init; }
}

// --- teams (the hand-made quick battle rosters) --------------------------------------

public sealed record TeamStats(double MaxHp, double Attack, double Magic, double Armor, double Resist, double Speed, double CritChance);

public sealed record TeamPerk
{
    public required string PerkId { get; init; }
    public string? AbilityId { get; init; }
}

public sealed record TeamHero
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Class { get; init; }
    public required Side Side { get; init; }
    /// <summary>Offset coordinates, [col, row]; converted to axial when a battle is built.</summary>
    public required IReadOnlyList<int> At { get; init; }
    public required TeamStats Stats { get; init; }
    public required IReadOnlyList<string> Abilities { get; init; }
    public string? Passive { get; init; }
    public string? Race { get; init; }
    public IReadOnlyList<TeamPerk>? Perks { get; init; }
    public string? Item { get; init; }
}

public sealed record Teams
{
    public required IReadOnlyList<TeamHero> Heroes { get; init; }
}
