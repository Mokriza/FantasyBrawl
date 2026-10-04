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
public sealed class BattleSession : IBoardSource
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

    /// <summary>A sound to play, by the name vfx.json or Sounds knows it; the screen turns it into noise.</summary>
    public Action<string>? OnSound { get; set; }

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
        : this(content, initial, opponent, playerSide, played: false)
    {
    }

    private BattleSession(ContentRegistry content, BattleState state, AiProfile opponent, Side playerSide, bool played)
    {
        Content = content;
        this.opponent = opponent;
        PlayerSide = playerSide;
        Seed = state.Seed;
        aiRng = Rng.Create(JsMath.ToInt32(state.Seed) ^ unchecked((int)0x9e3779b9));
        Display = Playback.ProjectionOf(state);
        if (played)
        {
            Battle = state;
            return;
        }
        var started = BattleRules.StartBattle(state, content);
        Battle = started.State;
        Enqueue(started.Events);
    }

    /// <summary>A battle already played to the end, shown as it finished: for jumping ahead in a screenshot run.</summary>
    public static BattleSession Played(ContentRegistry content, BattleState final, AiProfile opponent, Side playerSide) =>
        new(content, final, opponent, playerSide, played: true);

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

    private IReadOnlyList<BattleEvent> Apply(BattleAction action)
    {
        var result = BattleRules.ApplyAction(Battle, action, Content);
        Battle = result.State;
        Enqueue(result.Events);
        return result.Events;
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
            // At the instant speed a whole turn lands at once: silence rather than a wall of noise.
            if (Speed != 0 && Playback.SoundOf(e, Display.Casting, Battle, Content) is { } sound) OnSound?.Invoke(sound);
            if (Speed != 0 && e is TurnStartedEvent t && Battle.Heroes.Get(t.HeroId)?.Side == PlayerSide && !AutoPlayer) OnSound?.Invoke("turn");
            Display = Playback.Advance(Display, e, Battle, Content, now, Pace);
            Log.Add(e);
            double ms = Speed == 0 ? 0 : Playback.EventMs(e) / Speed;
            // A shot still in the air holds the next event back until it lands.
            ms = Math.Max(ms, Playback.InFlightMs(Display.Effects, now));
            // A wall of ice or a collapsing ring changes many hexes at once: they show together.
            if (e is TerrainChangedEvent && queue.TryPeek(out var next) && next is TerrainChangedEvent) ms = 0;
            nextEventAt = now + ms;
            if (ms > 0) return;
        }
        if (queue.Count > 0 || now < nextEventAt) return;

        if (Battle.Outcome is not null)
        {
            if (Busy && Speed != 0) OnSound?.Invoke(Battle.Outcome.Winner == PlayerSide ? "win" : "lose");
            Busy = false;
            return;
        }
        if (StepAi()) return;
        Busy = false;
    }

    // --- the board -----------------------------------------------------------------------

    /// <summary>What the board tints: where the active hero can walk, or the reach, targets and zone of the chosen ability.</summary>
    public BoardMarks Marks()
    {
        var none = BoardMarks.None;
        if (!CanAct || Active is not { } hero) return none;
        if (SelectedAbility is { } abilityId)
        {
            var ability = Content.GetAbility(abilityId);
            var reach = Legal.AbilityReach(Battle, hero, ability, Content).Select(h => h.Key).ToHashSet();
            var targets = Legal.TargetsFor(Battle, hero, ability, Content).Select(h => h.Key).ToHashSet();
            var zone = new HashSet<string>();
            bool illegal = false;
            if (Hover is { } hover)
            {
                if (targets.Contains(hover.Key))
                    foreach (var hit in Targeting.ResolveShape(Battle, hero, hover, ability, Content)) zone.Add(hit.Hex.Key);
                else illegal = true;
            }
            bool friendly = ability.Targets is AbilityTargets.Ally or AbilityTargets.Self;
            return none with { Reach = reach, Targets = targets, Zone = zone, ZoneFriendly = friendly, Illegal = illegal };
        }
        var reachable = Legal.ReachableFor(Battle, hero, Content);
        var path = new HashSet<string>();
        if (Hover is { } at && reachable.Get(at.Key) is { } route)
            foreach (var h in route.Path) path.Add(h.Key);
        return none with { Reachable = reachable.Keys.ToHashSet(), Path = path };
    }

    /// <summary>A click on a hex: the chosen ability on it, or a walk there.</summary>
    public void Click(Hex hex)
    {
        if (!CanAct || Active is not { } hero) return;
        if (SelectedAbility is { } abilityId)
        {
            var ability = Content.GetAbility(abilityId);
            if (Legal.AbilityLegality(Battle, hero, ability, hex, Content).Ok)
                Dispatch(new AbilityAction { HeroId = hero.Id, AbilityId = abilityId, Target = hex });
            return;
        }
        var reach = Legal.ReachableFor(Battle, hero, Content).Get(hex.Key);
        if (reach is not null) Dispatch(new MoveAction { HeroId = hero.Id, Path = reach.Path });
    }

    public void Cancel() => SelectedAbility = null;

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
        // Core closes a turn by itself once nothing but endTurn is left, so the plan's own
        // endTurn may never be reached. The rest of the plan belongs to the turn that just
        // closed: kept, it would end this hero's next turn before it did anything.
        if (Apply(next).Any(e => e is TurnEndedEvent))
        {
            aiPlan.Clear();
            aiPlanFor = null;
        }
        return true;
    }
}
