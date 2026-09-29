using System.Text.Json.Serialization;

namespace Brawl.Core;

// The run: draft, placement, the series of matches and the upgrade phase between them. A
// port of the run half of src/core/types.ts; the JSON looks exactly like the TypeScript one.

/// <summary>
/// One value per team, as `Record&lt;Side, T&gt;` in TypeScript. With a nullable T it is also
/// `Partial&lt;Record&lt;Side, T&gt;&gt;`: a side without a value is left out of the JSON.
/// </summary>
public sealed record BySide<T>([property: JsonPropertyName("A")] T A, [property: JsonPropertyName("B")] T B)
{
    public T Of(Side side) => side switch
    {
        Side.A => A,
        Side.B => B,
        _ => throw new ArgumentOutOfRangeException(nameof(side), "a run has only sides A and B"),
    };

    public BySide<T> With(Side side, T value) => side switch
    {
        Side.A => this with { A = value },
        Side.B => this with { B = value },
        _ => throw new ArgumentOutOfRangeException(nameof(side), "a run has only sides A and B"),
    };
}

/// <summary>How the generator spent a hero's budget.</summary>
public sealed record BudgetSpend(double Abilities, double Passive, double Ultimate, double Item, double Stats);

/// <summary>
/// A hero as the generator made them: everything that survives between matches. The
/// numbers are level 1, race included; statsAtLevel gives them for a later match.
/// </summary>
public sealed record HeroTemplate
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string ClassId { get; init; }
    public required Stats Stats { get; init; }
    /// <summary>Budget points spent on each stat, before conversion into stat values.</summary>
    public required Stats StatPoints { get; init; }
    public required IReadOnlyList<string> Abilities { get; init; }
    /// <summary>Null until it is chosen in the upgrade phase after the first match.</summary>
    public string? Passive { get; init; }
    public required string Race { get; init; }
    /// <summary>The one artifact slot: a common one from generation, later a reward.</summary>
    public string? Item { get; init; }
    public required IReadOnlyList<PerkPick> Perks { get; init; }
    public required BudgetSpend Spend { get; init; }
}

public sealed record DraftState
{
    /// <summary>All generated heroes, taken or not. Who took whom lives in Picks.</summary>
    public required IReadOnlyList<HeroTemplate> Pool { get; init; }
    public required IReadOnlyList<Side> Order { get; init; }
    public required BySide<IReadOnlyList<string>> Picks { get; init; }
}

public sealed record PlacedHero(Side Side, string HeroId, Hex Hex);

public sealed record PlacementState
{
    public required Arena Arena { get; init; }
    public required IReadOnlyList<Side> Order { get; init; }
    public required IReadOnlyList<PlacedHero> Placed { get; init; }
}

public sealed record MatchRecord(int Match, Side Winner, VictoryReason Reason, int Rounds, string? Modifier);

[JsonConverter(typeof(CamelEnumConverter<UnlockKind>))]
public enum UnlockKind { Passive, Ultimate }

/// <summary>What a hero may unlock in this phase: passive ids or tier IV ability ids of its class.</summary>
public sealed record UnlockOffer(UnlockKind Kind, IReadOnlyList<string> Options);

/// <summary>The artifact a side took as its reward, and who carries it.</summary>
public sealed record RewardPick(string ItemId, string HeroId);

/// <summary>A swap a side has lined up: who leaves the team and which candidate takes the place.</summary>
public sealed record SwapPick(string OutId, string InId);

public sealed record UpgradeState
{
    /// <summary>heroId to the perk ids offered to that hero.</summary>
    public required OrderedMap<IReadOnlyList<string>> Offers { get; init; }
    /// <summary>heroId to the pick, once made.</summary>
    public required OrderedMap<PerkPick> Chosen { get; init; }
    /// <summary>heroId to what it may unlock in this phase; absent when nothing is due.</summary>
    public required OrderedMap<UnlockOffer> Unlocks { get; init; }
    /// <summary>heroId to the option taken, once made.</summary>
    public required OrderedMap<string> Unlocked { get; init; }
    /// <summary>The artifacts each side may take one of; empty when there is no reward this time.</summary>
    public required BySide<IReadOnlyList<string>> Rewards { get; init; }
    public required BySide<RewardPick?> Rewarded { get; init; }
    /// <summary>The heroes each side may swap one of its own for, ready at the team's level.</summary>
    public required BySide<IReadOnlyList<HeroTemplate>> Candidates { get; init; }
    public required BySide<SwapPick?> Swapped { get; init; }
    /// <summary>Sides that said they are done; the phase ends when both have.</summary>
    public required BySide<bool?> Ready { get; init; }
}

/// <summary>draft → placement → battle → matchOver → upgrade → placement → … → finished.</summary>
[JsonConverter(typeof(CamelEnumConverter<RunPhase>))]
public enum RunPhase { Draft, Placement, Battle, MatchOver, Upgrade, Finished }

public sealed record RunState
{
    public required double Seed { get; init; }
    /// <summary>The generation stream: pool, arenas, timer picks. Never shared with a battle.</summary>
    public required RngState Rng { get; init; }
    public required RunPhase Phase { get; init; }
    /// <summary>The side the local player drafts as; who gets A, the first pick, is rolled.</summary>
    public required Side PlayerSide { get; init; }
    public required DraftState Draft { get; init; }
    /// <summary>The current match, or the one about to start, counted from 1.</summary>
    public required int Match { get; init; }
    public required BySide<double> Wins { get; init; }
    public required IReadOnlyList<MatchRecord> History { get; init; }
    /// <summary>The arena and who stands where; null only during the draft.</summary>
    public PlacementState? Placement { get; init; }
    /// <summary>The offers of the current upgrade phase; null outside it.</summary>
    public UpgradeState? Upgrade { get; init; }
    /// <summary>The arena modifier of the current match, or of the next one during its upgrade phase.</summary>
    public string? Modifier { get; init; }
}

// --- actions -------------------------------------------------------------------------

public abstract record RunAction
{
    [JsonPropertyName("type")]
    public abstract string Type { get; }
}

public sealed record RunPick(Side Side, string HeroId) : RunAction { public override string Type => "pick"; }

/// <summary>The pick timer ran out: a random hero from the pool, from the run stream.</summary>
public sealed record RunAutoPick(Side Side) : RunAction { public override string Type => "autoPick"; }

public sealed record RunPlace(Side Side, string HeroId, Hex Hex) : RunAction { public override string Type => "place"; }

public sealed record RunMatchEnded(BattleOutcome Outcome, int Rounds) : RunAction
{
    public override string Type => "matchEnded";
    /// <summary>Artifacts heroes won during the match; they keep them.</summary>
    public IReadOnlyList<LootPick>? Loot { get; init; }
}

public sealed record RunNextMatch : RunAction { public override string Type => "nextMatch"; }

public sealed record RunChooseUnlock(Side Side, string HeroId, string OptionId) : RunAction { public override string Type => "chooseUnlock"; }

public sealed record RunChooseReward(Side Side, string ItemId, string HeroId) : RunAction { public override string Type => "chooseReward"; }

/// <summary>Swap one hero of the side for one of its candidates; a new swap replaces the old.</summary>
public sealed record RunSwapHero(Side Side, string OutId, string InId) : RunAction { public override string Type => "swapHero"; }

public sealed record RunCancelSwap(Side Side) : RunAction { public override string Type => "cancelSwap"; }

public sealed record RunChoosePerk(Side Side, string HeroId, string PerkId) : RunAction
{
    public override string Type => "choosePerk";
    /// <summary>For a perk that changes one ability: which one.</summary>
    public string? AbilityId { get; init; }
}

/// <summary>This side has chosen everything; when both have, on to placement.</summary>
public sealed record RunReadyUpgrade(Side Side) : RunAction { public override string Type => "readyUpgrade"; }

/// <summary>This side takes its ready back, to choose again.</summary>
public sealed record RunUnreadyUpgrade(Side Side) : RunAction { public override string Type => "unreadyUpgrade"; }

public static class RunActionTypes
{
    public static readonly IReadOnlyDictionary<string, Type> ByName = new Dictionary<string, Type>
    {
        ["pick"] = typeof(RunPick),
        ["autoPick"] = typeof(RunAutoPick),
        ["place"] = typeof(RunPlace),
        ["matchEnded"] = typeof(RunMatchEnded),
        ["nextMatch"] = typeof(RunNextMatch),
        ["chooseUnlock"] = typeof(RunChooseUnlock),
        ["chooseReward"] = typeof(RunChooseReward),
        ["swapHero"] = typeof(RunSwapHero),
        ["cancelSwap"] = typeof(RunCancelSwap),
        ["choosePerk"] = typeof(RunChoosePerk),
        ["readyUpgrade"] = typeof(RunReadyUpgrade),
        ["unreadyUpgrade"] = typeof(RunUnreadyUpgrade),
    };
}
