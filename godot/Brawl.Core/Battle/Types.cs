using System.Text.Json.Serialization;

namespace Brawl.Core;

// Battle state, actions and events: a port of src/core/types.ts. Flat, immutable data;
// the JSON of any of it looks exactly like the TypeScript one, which is how the parity
// tests compare them. Numbers the rules compute with are double, as in JavaScript.

public sealed record Stats(double MaxHp, double Attack, double Magic, double Armor, double Resist, double Speed, double CritChance)
{
    public double Get(StatName stat) => stat switch
    {
        StatName.MaxHp => MaxHp,
        StatName.Attack => Attack,
        StatName.Magic => Magic,
        StatName.Armor => Armor,
        StatName.Resist => Resist,
        StatName.Speed => Speed,
        StatName.CritChance => CritChance,
        _ => throw new ArgumentOutOfRangeException(nameof(stat)),
    };
}

/// <summary>Terrain an ability put down for a while, and what the hex was before.</summary>
public sealed record TemporaryTerrain
{
    public required Hex Hex { get; init; }
    public required TerrainId Terrain { get; init; }
    public TerrainId? Previous { get; init; }
    public required string OwnerId { get; init; }
    /// <summary>Turns of the owner left; ticks down at the end of each of the owner's turns.</summary>
    public required int Turns { get; init; }
    /// <summary>For a trap: what hits the enemy who steps in.</summary>
    public required IReadOnlyList<Effect> OnEnter { get; init; }
}

/// <summary>An ability cast now that lands later, such as "Метеор".</summary>
public sealed record PendingAbility(string CasterId, string AbilityId, Hex Target, int Turns);

public sealed record SummonInfo(string OwnerId, int TurnsLeft, SummonAttack Attack);

public sealed record Arena
{
    public required int Cols { get; init; }
    public required int Rows { get; init; }
    /// <summary>hexKey to terrain. A hex missing from the map is plain ground.</summary>
    public required OrderedMap<TerrainId> Terrain { get; init; }
}

/// <summary>
/// One status on a hero. A class, compared by reference where the TypeScript core
/// compares objects with === (removing one instance of two identical stacks).
/// </summary>
public sealed record StatusInstance
{
    public required string Status { get; init; }
    public required int Turns { get; init; }
    public required double Value { get; init; }
    public required bool AppliedOnOwnTurn { get; init; }
    public string? SourceId { get; init; }

    // Records compare by value; the rules need identity, so equality is by reference.
    public bool Equals(StatusInstance? other) => ReferenceEquals(this, other);

    public override int GetHashCode() => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(this);
}

public sealed record PerkPick
{
    public required string PerkId { get; init; }
    public string? AbilityId { get; init; }
}

public sealed record BattleHero
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required Side Side { get; init; }
    public required string ClassId { get; init; }
    /// <summary>Stats before statuses and modifiers.</summary>
    public required Stats Base { get; init; }
    public required double Hp { get; init; }
    public required Hex Hex { get; init; }
    public required double Atb { get; init; }
    public required IReadOnlyList<string> Abilities { get; init; }
    /// <summary>abilityId to turns left; missing or 0 means ready, negative means spent for the match.</summary>
    public required OrderedMap<double> Cooldowns { get; init; }
    public required IReadOnlyList<StatusInstance> Statuses { get; init; }
    public required IReadOnlyList<string> CcInPreviousTurn { get; init; }
    public required IReadOnlyList<string> CcInCurrentTurn { get; init; }
    public required IReadOnlyList<string> ReactedThisTurn { get; init; }
    public string? Passive { get; init; }
    public string? Race { get; init; }
    public required IReadOnlyList<PerkPick> Perks { get; init; }
    public string? Item { get; init; }
    public SummonInfo? Summon { get; init; }
    public required OrderedMap<double> Counters { get; init; }

    [JsonIgnore]
    public bool IsAlive => Hp > 0;

    public double Counter(string key) => Counters.TryGetValue(key, out double value) ? value : 0;
}

[JsonConverter(typeof(CamelEnumConverter<VictoryReason>))]
public enum VictoryReason { Elimination, RoundLimit, Hold }

public sealed record LootPick(string HeroId, string ItemId);

public sealed record BattleOutcome(Side Winner, VictoryReason Reason);

/// <summary>"Точка силы": rounds each side has held the centre, and the last round credited.</summary>
public sealed record HoldCount([property: JsonPropertyName("A")] double A, [property: JsonPropertyName("B")] double B, int Round);

public sealed record BattleState
{
    public required double Seed { get; init; }
    public required RngState Rng { get; init; }
    public required int Tick { get; init; }
    public required int Round { get; init; }
    public required Arena Arena { get; init; }
    public required OrderedMap<BattleHero> Heroes { get; init; }
    public string? ActiveHeroId { get; init; }
    public required double ApLeft { get; init; }
    public required IReadOnlyList<string> Modifiers { get; init; }
    public required HoldCount Hold { get; init; }
    public required IReadOnlyList<LootPick> Loot { get; init; }
    public BattleOutcome? Outcome { get; init; }
    public string? LastActedHeroId { get; init; }
    public required IReadOnlyList<TemporaryTerrain> TemporaryTerrain { get; init; }
    public required IReadOnlyList<PendingAbility> Pending { get; init; }
}

// --- actions -------------------------------------------------------------------------

public abstract record BattleAction
{
    [JsonPropertyName("type")]
    public abstract string Type { get; }

    public required string HeroId { get; init; }
}

public sealed record MoveAction : BattleAction
{
    public override string Type => "move";
    public required IReadOnlyList<Hex> Path { get; init; }
}

public sealed record AbilityAction : BattleAction
{
    public override string Type => "ability";
    public required string AbilityId { get; init; }
    public required Hex Target { get; init; }
}

public sealed record EndTurnAction : BattleAction
{
    public override string Type => "endTurn";
}

[JsonConverter(typeof(CamelEnumConverter<IllegalReason>))]
public enum IllegalReason
{
    NotActiveHero,
    HeroDead,
    NoAp,
    OnCooldown,
    Silenced,
    Rooted,
    Stunned,
    OutOfRange,
    NoLos,
    BadTarget,
    BlockedPath,
    BattleOver,
}

/// <summary>Ok, or why not.</summary>
public readonly record struct Legality(IllegalReason? Reason)
{
    public static readonly Legality Ready = new(null);
    public bool Ok => Reason is null;
    public static Legality Not(IllegalReason reason) => new(reason);
}

/// <summary>Thrown when core is asked to do something legalActions never offered: a caller bug.</summary>
public sealed class IllegalActionException(string message) : Exception(message);

// --- events --------------------------------------------------------------------------

public abstract record BattleEvent
{
    [JsonPropertyName("type")]
    public abstract string Type { get; }
}

public sealed record BattleStartedEvent(string FirstHeroId) : BattleEvent { public override string Type => "battleStarted"; }
public sealed record TurnStartedEvent(string HeroId, double Ap) : BattleEvent { public override string Type => "turnStarted"; }
public sealed record TurnSkippedEvent(string HeroId, string Cause) : BattleEvent { public override string Type => "turnSkipped"; }
public sealed record TurnEndedEvent(string HeroId) : BattleEvent { public override string Type => "turnEnded"; }
public sealed record MovedEvent(string HeroId, Hex From, Hex To) : BattleEvent { public override string Type => "moved"; }
public sealed record PushedEvent(string HeroId, Hex From, Hex To) : BattleEvent { public override string Type => "pushed"; }
public sealed record OpportunityAttackEvent(string AttackerId, string TargetId, Hex Leaving) : BattleEvent { public override string Type => "opportunityAttack"; }
public sealed record AbilityUsedEvent(string HeroId, string AbilityId, Hex Target, double Ap) : BattleEvent { public override string Type => "abilityUsed"; }

public sealed record DamagedEvent(string TargetId, string? SourceId, double Amount, bool Crit, DamageSchool School) : BattleEvent
{
    public override string Type => "damaged";
    /// <summary>Damage over time ticking at the start of a turn, rather than a hit.</summary>
    public bool? Periodic { get; init; }
}

public sealed record BarrierAbsorbedEvent(string TargetId, double Amount, double Left) : BattleEvent { public override string Type => "barrierAbsorbed"; }
public sealed record HealedEvent(string TargetId, string? SourceId, double Amount) : BattleEvent { public override string Type => "healed"; }
public sealed record StatusAppliedEvent(string TargetId, string Status, int Turns, double Value) : BattleEvent { public override string Type => "statusApplied"; }
public sealed record StatusResistedEvent(string TargetId, string Status) : BattleEvent { public override string Type => "statusResisted"; }
public sealed record StatusExpiredEvent(string TargetId, string Status) : BattleEvent { public override string Type => "statusExpired"; }
public sealed record StatusCleansedEvent(string TargetId, string Status) : BattleEvent { public override string Type => "statusCleansed"; }
public sealed record AtbChangedEvent(string HeroId, double Delta, double Atb) : BattleEvent { public override string Type => "atbChanged"; }
public sealed record DiedEvent(string HeroId) : BattleEvent { public override string Type => "died"; }
public sealed record PassiveTriggeredEvent(string HeroId, string PassiveId) : BattleEvent { public override string Type => "passiveTriggered"; }
public sealed record TeleportedEvent(string HeroId, Hex From, Hex To) : BattleEvent { public override string Type => "teleported"; }
public sealed record ApChangedEvent(string HeroId, double Delta) : BattleEvent { public override string Type => "apChanged"; }
public sealed record CooldownsChangedEvent(string HeroId, CooldownMode Mode) : BattleEvent { public override string Type => "cooldownsChanged"; }
public sealed record TerrainChangedEvent(Hex Hex, TerrainId? Terrain) : BattleEvent { public override string Type => "terrainChanged"; }
public sealed record SummonedEvent(string HeroId, string OwnerId, Hex Hex) : BattleEvent { public override string Type => "summoned"; }
public sealed record AbilityDelayedEvent(string HeroId, string AbilityId, Hex Target, int Turns) : BattleEvent { public override string Type => "abilityDelayed"; }
public sealed record MatchEndedEvent(Side Winner, VictoryReason Reason) : BattleEvent { public override string Type => "matchEnded"; }
public sealed record ItemGainedEvent(string HeroId, string ItemId) : BattleEvent { public override string Type => "itemGained"; }

public sealed record ApplyResult(BattleState State, IReadOnlyList<BattleEvent> Events);
