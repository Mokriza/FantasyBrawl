namespace Brawl.Core;

// src/content/config.json: every balance number. A port of configSchema in content.ts.

public sealed record OpportunityAttackConfig(bool Enabled, bool MeleeOnly, bool OncePerEnemyPerTurn);

public sealed record BattleConfig
{
    public required int ApPerTurn { get; init; }
    public required int MaxRounds { get; init; }
    public required int TicksPerRound { get; init; }
    public required double AtbThreshold { get; init; }
    public required int MoveCost { get; init; }
    public required int MaxRangeBonus { get; init; }
    public required Side PlayerSide { get; init; }
    public required int MaxTriggerDepth { get; init; }
    public required OpportunityAttackConfig OpportunityAttack { get; init; }
}

public sealed record FormulasConfig
{
    public required IReadOnlyList<double> Spread { get; init; }
    public required double CritMult { get; init; }
    public required double DefenseConstant { get; init; }
    public required int MinDamage { get; init; }
    public required double MinDefense { get; init; }
    public required double MinSpeed { get; init; }
    public required double CritChanceCap { get; init; }
}

public sealed record MinMax(int Min, int Max);

public sealed record TerrainWeights(double Rock, double Column, double Thicket, double Pit);

public sealed record HighGroundConfig(int MaxCount, int Range, double Damage);

public sealed record PitConfig(int Damage, int ExtraApCost);

public sealed record ArenaConfig
{
    public required int Cols { get; init; }
    public required int Rows { get; init; }
    public required IReadOnlyList<int> StartColumnsA { get; init; }
    public required IReadOnlyList<int> StartColumnsB { get; init; }
    public required MinMax Obstacles { get; init; }
    public required TerrainWeights Weights { get; init; }
    public required HighGroundConfig High { get; init; }
    public required int MaxGenerationAttempts { get; init; }
    public required PitConfig Pit { get; init; }
}

public sealed record Reserve(int Passive, int Ultimate);

public sealed record StatRanges
{
    public required IReadOnlyList<double> MaxHp { get; init; }
    public required IReadOnlyList<double> Attack { get; init; }
    public required IReadOnlyList<double> Magic { get; init; }
    public required IReadOnlyList<double> Armor { get; init; }
    public required IReadOnlyList<double> Resist { get; init; }
    public required IReadOnlyList<double> Speed { get; init; }
    public required IReadOnlyList<double> CritChance { get; init; }
}

public sealed record StatWeights(double Primary, double Secondary, double Other);

public sealed record GenerationConfig
{
    public required int Budget { get; init; }
    public required IReadOnlyList<double> AbilityTierCost { get; init; }
    public required IReadOnlyList<double> PassiveTierCost { get; init; }
    public required IReadOnlyList<int> AbilityBudget { get; init; }
    public required int MaxAbilityAttempts { get; init; }
    public required Reserve Reserve { get; init; }
    public required int StartingAbilities { get; init; }
    public required StatRanges StatRanges { get; init; }
    public required int PointsPerRange { get; init; }
    public required double PrimaryMinShare { get; init; }
    public required double OtherMaxShare { get; init; }
    public required StatWeights StatWeights { get; init; }
}

public sealed record DraftConfig
{
    public required int PoolSize { get; init; }
    public required int MaxSameClass { get; init; }
    public required IReadOnlyList<Side> Order { get; init; }
    public required int PickSeconds { get; init; }
    public required IReadOnlyList<Side> PlacementOrder { get; init; }
}

public sealed record CatchUp(int Deficit, int ExtraChoices);

public sealed record RunConfig
{
    public required int WinsToFinish { get; init; }
    public required int MaxMatches { get; init; }
    public required int PerkChoices { get; init; }
    public required int UnlockChoices { get; init; }
    public required int RewardChoices { get; init; }
    public required IReadOnlyList<RewardTier> RewardTiers { get; init; }
    public required int PassiveAfterMatch { get; init; }
    public required int UltimateAfterMatch { get; init; }
    public required IReadOnlyList<int> ModifierMatches { get; init; }
    public required int SwapChoices { get; init; }
    public required CatchUp CatchUp { get; init; }
}

public sealed record OnlineConfig
{
    public required double PlaceSeconds { get; init; }
    public required double UpgradeSeconds { get; init; }
    public required double TurnSeconds { get; init; }
    public required double ContinueSeconds { get; init; }
    public required double ReconnectSeconds { get; init; }
    public required int ChatMax { get; init; }
    public required int ChatKeep { get; init; }
    public required double ChatEverySeconds { get; init; }
    public required int MessagesPerSecond { get; init; }
    public required int MaxRooms { get; init; }
    public required double EmptyRoomMinutes { get; init; }
}

public sealed record AiWeights
{
    public required double DamageDealt { get; init; }
    public required double Kill { get; init; }
    public required double Overkill { get; init; }
    public required double HpLost { get; init; }
    public required double Healing { get; init; }
    public required double StunTurn { get; init; }
    public required double SilenceTurn { get; init; }
    public required double Threat { get; init; }
    public required double DistanceToTarget { get; init; }
    public required double UltimateSaved { get; init; }
    public required double FocusBonus { get; init; }
    public required double SummonDamage { get; init; }
    public required double TrapNearEnemy { get; init; }
    public required double HighGround { get; init; }
    public required double OnCollapse { get; init; }
    public required double PowerPoint { get; init; }
    public required double NeutralDamage { get; init; }
    public required double GuardianKill { get; init; }
    public required double DotDamage { get; init; }
    public required double DebuffTurn { get; init; }
}

public sealed record AiProfile(double Noise, bool UseThreat, bool AllowUltimates, int Lookahead);

public sealed record DraftAiConfig
{
    public required double StatWeight { get; init; }
    public required double AbilityWeight { get; init; }
    public required double MissingRoleBonus { get; init; }
    public required double DuplicateRolePenalty { get; init; }
    public required double Noise { get; init; }
    public required double SwapMargin { get; init; }
}

public sealed record AiConfig
{
    public required int MaxPlans { get; init; }
    public required IReadOnlyList<int> LookaheadTopPlans { get; init; }
    public required AiWeights Weights { get; init; }
    public required OrderedMap<AiProfile> Profiles { get; init; }
    public required DraftAiConfig Draft { get; init; }
}

public sealed record Config
{
    public required BattleConfig Battle { get; init; }
    public required FormulasConfig Formulas { get; init; }
    public required ArenaConfig Arena { get; init; }
    public required GenerationConfig Generation { get; init; }
    public required DraftConfig Draft { get; init; }
    public required RunConfig Run { get; init; }
    public required OnlineConfig Online { get; init; }
    public required AiConfig Ai { get; init; }
}
