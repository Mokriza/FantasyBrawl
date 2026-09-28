using Brawl.Core;

namespace Brawl.Game;

/// <summary>
/// One battle on screen: the Godot counterpart of src/ui/store.ts for the quick battle.
///
/// The real state is updated the moment an action is applied, but the shown state lags:
/// events are played one at a time from a queue, and the projection of positions and
/// health follows them. Input waits while the queue drains. The opponent is the AI from
/// Brawl.Core; it thinks on a worker thread (the state is immutable, so that is safe)
/// and its actions go through the same queue as the player's.
///
/// There is no game logic here: what is allowed is asked of Brawl.Core.
/// </summary>
public sealed class BattleSession
{
    public ContentRegistry Content { get; }
    public BattleState Battle { get; private set; }
    public Projection Display { get; private set; }
    public List<BattleEvent> Log { get; } = [];
    public Side PlayerSide { get; }
    public double Seed { get; }
    /// <summary>1, 2 or 4 times faster, or 0 to play everything at once.</summary>
    public int Speed { get; set; } = 1;

    public string? SelectedAbility { get; set; }
    public Hex? Hover { get; set; }

    /// <summary>The AI plays the player's side too: for a demo, or a screenshot run.</summary>
    public bool AutoPlayer { get; init; }

    /// <summary>True while events are playing or the opponent is thinking or acting.</summary>
    public bool Busy { get; private set; }

    private readonly Queue<BattleEvent> queue = new();
    private double nextEventAt;
    private readonly AiProfile opponent;
    private RngState aiRng;
    private readonly Queue<BattleAction> aiPlan = new();
    private string? aiPlanFor;
    private Task<AiDecision>? thinking;
    private int aiRetries;

    public BattleSession(ContentRegistry content, BattleState initial, AiProfile opponent, Side playerSide)
    {
        Content = content;
        this.opponent = opponent;
        PlayerSide = playerSide;
        Seed = initial.Seed;
        aiRng = Rng.Create(JsMath.ToInt32(initial.Seed) ^ unchecked((int)0x9e3779b9));
        Display = Playback.ProjectionOf(initial);
        var started = BattleRules.StartBattle(initial, content);
        Battle = started.State;
        Enqueue(started.Events);
    }

    public bool IsPlayerTurn =>
        Battle.Outcome is null
        && Battle.ActiveHeroId is { } id
        && Battle.Heroes.Get(id)?.Side == PlayerSide;

    public bool CanAct => IsPlayerTurn && !Busy && !AutoPlayer;

    public BattleHero? Active => Query.ActiveHero(Battle);

    private void Enqueue(IEnumerable<BattleEvent> events)
    {
        foreach (var e in events) queue.Enqueue(e);
        Busy = true;
    }

    /// <summary>The player's action. Ignored while something is still playing.</summary>
    public bool Dispatch(BattleAction action)
    {
        if (!CanAct || !Legal.IsLegalAction(Battle, action, Content)) return false;
        SelectedAbility = null;
        Apply(action);
        return true;
    }

    private void Apply(BattleAction action)
    {
        var result = BattleRules.ApplyAction(Battle, action, Content);
        Battle = result.State;
        Enqueue(result.Events);
    }

    private double Pace => Speed == 0 ? 0 : 1.0 / Speed;

    /// <summary>The heartbeat, called every frame with the current time in milliseconds.</summary>
    public void Tick(double now)
    {
        Display = Playback.Prune(Display, now);

        // Play whatever is due. At the instant speed the whole queue goes at once.
        while (queue.Count > 0 && now >= nextEventAt)
        {
            var e = queue.Dequeue();
            Display = Playback.Advance(Display, e, Battle, Content, now, Pace);
            Log.Add(e);
            double ms = Speed == 0 ? 0 : Playback.EventMs(e) / Speed;
            // A wall of ice or a collapsing ring changes many hexes at once: they show together.
            if (e is TerrainChangedEvent && queue.TryPeek(out var next) && next is TerrainChangedEvent) ms = 0;
            nextEventAt = now + ms;
            if (ms > 0) return;
        }
        if (queue.Count > 0 || now < nextEventAt) return;

        if (Battle.Outcome is not null)
        {
            Busy = false;
            return;
        }
        if (StepAi()) return;
        Busy = false;
    }

    /// <summary>Plays the opponent one action at a time. True while it is busy.</summary>
    private bool StepAi()
    {
        string? active = Battle.ActiveHeroId;
        if (active is null || Battle.Outcome is not null || (Battle.Heroes.Get(active)?.Side == PlayerSide && !AutoPlayer)) return false;

        if (aiPlanFor != active || aiPlan.Count == 0)
        {
            if (thinking is null)
            {
                var state = Battle;
                var rng = aiRng;
                thinking = Task.Run(() => BattleAi.ChooseActions(state, Content, rng, opponent));
                Busy = true;
                return true;
            }
            if (!thinking.IsCompleted) return true;
            var decision = thinking.Result;
            thinking = null;
            aiRng = decision.Rng;
            aiPlan.Clear();
            foreach (var a in decision.Actions) aiPlan.Enqueue(a);
            aiPlanFor = active;
            aiRetries = 0;
        }

        if (aiPlan.Count == 0) return false;
        var next = aiPlan.Dequeue();
        // A trigger may have changed things since the plan was made.
        if (!Legal.IsLegalAction(Battle, next, Content))
        {
            aiPlan.Clear();
            aiPlanFor = null;
            if (++aiRetries > 4) Apply(new EndTurnAction { HeroId = active });
            return true;
        }
        Apply(next);
        return true;
    }
}
