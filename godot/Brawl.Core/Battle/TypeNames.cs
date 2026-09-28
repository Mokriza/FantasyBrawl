namespace Brawl.Core;

/// <summary>The "type" of each action and event, for reading and writing them as JSON.</summary>
public static class ActionTypes
{
    public static readonly IReadOnlyDictionary<string, Type> ByName = new Dictionary<string, Type>
    {
        ["move"] = typeof(MoveAction),
        ["ability"] = typeof(AbilityAction),
        ["endTurn"] = typeof(EndTurnAction),
    };
}

public static class EventTypes
{
    public static readonly IReadOnlyDictionary<string, Type> ByName = new Dictionary<string, Type>
    {
        ["battleStarted"] = typeof(BattleStartedEvent),
        ["turnStarted"] = typeof(TurnStartedEvent),
        ["turnSkipped"] = typeof(TurnSkippedEvent),
        ["turnEnded"] = typeof(TurnEndedEvent),
        ["moved"] = typeof(MovedEvent),
        ["pushed"] = typeof(PushedEvent),
        ["opportunityAttack"] = typeof(OpportunityAttackEvent),
        ["abilityUsed"] = typeof(AbilityUsedEvent),
        ["damaged"] = typeof(DamagedEvent),
        ["barrierAbsorbed"] = typeof(BarrierAbsorbedEvent),
        ["healed"] = typeof(HealedEvent),
        ["statusApplied"] = typeof(StatusAppliedEvent),
        ["statusResisted"] = typeof(StatusResistedEvent),
        ["statusExpired"] = typeof(StatusExpiredEvent),
        ["statusCleansed"] = typeof(StatusCleansedEvent),
        ["atbChanged"] = typeof(AtbChangedEvent),
        ["died"] = typeof(DiedEvent),
        ["passiveTriggered"] = typeof(PassiveTriggeredEvent),
        ["teleported"] = typeof(TeleportedEvent),
        ["apChanged"] = typeof(ApChangedEvent),
        ["cooldownsChanged"] = typeof(CooldownsChangedEvent),
        ["terrainChanged"] = typeof(TerrainChangedEvent),
        ["summoned"] = typeof(SummonedEvent),
        ["abilityDelayed"] = typeof(AbilityDelayedEvent),
        ["matchEnded"] = typeof(MatchEndedEvent),
        ["itemGained"] = typeof(ItemGainedEvent),
    };
}
