using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// A run against the AI on screen: the Godot counterpart of stepRun and the run commands
/// in src/ui/store.ts. Each frame Tick looks at the run phase and does whatever comes
/// next on its own: runs the pick timer, lets the opponent pick or place after a short
/// pause, builds the battle of the match and reports how it ended. Anything that waits
/// for the player simply returns.
///
/// Every rule is asked of Brawl.Core; the screens read the state from here and send the
/// player's choices through the commands at the bottom.
/// </summary>
public sealed class RunSession
{
    /// <summary>How long the opponent seems to think over a pick or a placement, at speed ×1.</summary>
    private const double OpponentPickMs = 900;

    public ContentRegistry Content { get; }
    public RunState Run { get; private set; }
    public Side PlayerSide => Run.PlayerSide;
    public Side EnemySide => RunRules.OtherSide(Run.PlayerSide);
    public double Seed { get; }
    public string Difficulty { get; }

    /// <summary>The AI plays the player's side too: for a demo, or a screenshot run.</summary>
    public bool AutoPlayer { get; init; }

    /// <summary>The battle of the current match, from the moment everyone is placed.</summary>
    public BattleSession? Battle { get; private set; }

    /// <summary>The battle of this very match exists: right after the last hero is placed it is still the previous one for a frame.</summary>
    public bool BattleIsCurrent => Battle is not null && battleOfMatch == Run.Match;

    /// <summary>When the player's pick runs out, in engine milliseconds; null when it is not their pick.</summary>
    public double? PickDeadline { get; private set; }

    /// <summary>Which of the player's heroes the next click on the board places.</summary>
    public string? PlacingHeroId { get; private set; }

    /// <summary>Goes up on every change, so a screen knows when to rebuild.</summary>
    public int Version { get; private set; }

    private int speed = 1;
    private readonly AiProfile opponent;
    private RngState aiRng;
    private double? aiDueAt;
    private int battleOfMatch;

    public RunSession(ContentRegistry content, double seed, string difficulty)
    {
        Content = content;
        Seed = seed;
        Difficulty = difficulty;
        opponent = BattleAi.ProfileByName(content, difficulty);
        Run = RunRules.CreateRun(seed, content);
        // The opponent's draft and placement choices draw from their own stream.
        aiRng = Rng.Create(JsMath.ToInt32(seed) ^ 0x51ed270b);
    }

    /// <summary>1, 2 or 4 times faster, or 0 for instant: the pauses here and the battle's playback.</summary>
    public int Speed
    {
        get => speed;
        set
        {
            speed = value;
            if (Battle is not null) Battle.Speed = value;
        }
    }

    public bool IsPlayerTurn => Run.Phase switch
    {
        RunPhase.Draft => DraftRules.DraftTurn(Run.Draft) == PlayerSide,
        RunPhase.Placement => Run.Placement is { } p && PlacementRules.PlacementTurn(p) == PlayerSide,
        _ => false,
    };

    private void Changed() => Version++;

    private double Delay => speed == 0 ? 0 : OpponentPickMs / speed;

    /// <summary>True once the opponent's pause is over; starts the pause on the first call.</summary>
    private bool Due(double now)
    {
        if (aiDueAt is null)
        {
            aiDueAt = now + Delay;
            return Delay == 0;
        }
        return now >= aiDueAt;
    }

    private void Apply(RunAction action)
    {
        Run = RunRules.ApplyRunAction(Run, action, Content);
        PickDeadline = null;
        aiDueAt = null;
        if (Run.Phase == RunPhase.Upgrade) OpponentUpgrade();
        Changed();
    }

    /// <summary>The heartbeat, called every frame with the current time in milliseconds.</summary>
    public void Tick(double now)
    {
        switch (Run.Phase)
        {
            case RunPhase.Draft:
            {
                if (DraftRules.DraftTurn(Run.Draft) is not { } turn) return;
                if (turn == PlayerSide && !AutoPlayer)
                {
                    // The timer is the interface's business; core only receives the pick.
                    if (PickDeadline is null)
                    {
                        PickDeadline = now + Content.Config.Draft.PickSeconds * 1000.0;
                        Changed();
                    }
                    else if (now >= PickDeadline) Apply(new RunAutoPick(turn));
                    return;
                }
                if (!Due(now)) return;
                var decision = RunAi.ChoosePick(Run.Draft, Content, aiRng);
                aiRng = decision.Rng;
                Apply(new RunPick(turn, decision.HeroId));
                return;
            }

            case RunPhase.Placement:
            {
                if (Run.Placement is not { } placement || PlacementRules.PlacementTurn(placement) is not { } turn) return;
                if (turn == PlayerSide && !AutoPlayer)
                {
                    if (PlacingHeroId is null || PlacementRules.IsPlaced(placement, PlacingHeroId))
                    {
                        PlacingHeroId = Run.Draft.Picks.Of(PlayerSide).FirstOrDefault(id => !PlacementRules.IsPlaced(placement, id));
                        Changed();
                    }
                    return;
                }
                if (!Due(now)) return;
                var decision = RunAi.ChoosePlacement(Run, Content, aiRng);
                aiRng = decision.Rng;
                Apply(new RunPlace(turn, decision.HeroId, decision.Hex));
                return;
            }

            case RunPhase.Battle:
            {
                if (Battle is null || battleOfMatch != Run.Match)
                {
                    Battle = new BattleSession(Content, RunRules.CreateRunBattle(Run, Content), opponent, PlayerSide)
                    {
                        AutoPlayer = AutoPlayer,
                        Speed = speed,
                    };
                    battleOfMatch = Run.Match;
                    PlacingHeroId = null;
                    Changed();
                    return;
                }
                // The battle screen plays the battle; the result goes back to core, which
                // decides whether the series is over.
                if (Battle.Battle.Outcome is { } outcome && !Battle.Busy)
                    Apply(new RunMatchEnded(outcome, Battle.Battle.Round) { Loot = Battle.Battle.Loot });
                return;
            }

            case RunPhase.MatchOver:
                if (AutoPlayer && Due(now)) Apply(new RunNextMatch());
                return;

            case RunPhase.Upgrade:
                if (AutoPlayer && Due(now))
                {
                    if (Run.Upgrade?.Swapped.Of(PlayerSide) is null && RunAi.ChooseSwap(Run, PlayerSide, Content) is { } swap)
                        Run = RunRules.ApplyRunAction(Run, new RunSwapHero(PlayerSide, swap.OutId, swap.InId), Content);
                    aiRng = AiRun.ChooseUpgrade(() => Run, PlayerSide, Content, aiRng, a => Run = RunRules.ApplyRunAction(Run, a, Content));
                    Apply(new RunReadyUpgrade(PlayerSide));
                }
                return;
        }
    }

    /// <summary>
    /// The opponent takes its swap, reward, unlocks and perks at once and says it is ready;
    /// the player's choices wait on the screen. Every step is skipped once done, so this
    /// can run after every change in the phase.
    /// </summary>
    private void OpponentUpgrade()
    {
        var side = EnemySide;
        if (Run.Upgrade is null || Run.Upgrade.Ready.Of(side) == true) return;
        // The swap goes first: the newcomer may be the one the reward fits best.
        if (Run.Upgrade.Swapped.Of(side) is null && RunAi.ChooseSwap(Run, side, Content) is { } swap)
            Run = RunRules.ApplyRunAction(Run, new RunSwapHero(side, swap.OutId, swap.InId), Content);
        aiRng = AiRun.ChooseUpgrade(() => Run, side, Content, aiRng, a => Run = RunRules.ApplyRunAction(Run, a, Content));
        Run = RunRules.ApplyRunAction(Run, new RunReadyUpgrade(side), Content);
    }

    /// <summary>
    /// Jumps ahead with the AI playing both sides in core, battles played out at once,
    /// until stop says so or the run is over: for screenshot runs that look at a later
    /// screen. The opponent then makes its upgrade choices as in a real phase.
    /// </summary>
    public void FastForward(Func<RunState, bool> stop)
    {
        for (int guard = 0; guard < 2000 && Run.Phase != RunPhase.Finished && !stop(Run); guard++)
        {
            switch (Run.Phase)
            {
                case RunPhase.Draft:
                {
                    var turn = DraftRules.DraftTurn(Run.Draft)!.Value;
                    var decision = RunAi.ChoosePick(Run.Draft, Content, aiRng);
                    aiRng = decision.Rng;
                    Run = RunRules.ApplyRunAction(Run, new RunPick(turn, decision.HeroId), Content);
                    break;
                }
                case RunPhase.Placement:
                {
                    var turn = PlacementRules.PlacementTurn(Run.Placement!)!.Value;
                    var decision = RunAi.ChoosePlacement(Run, Content, aiRng);
                    aiRng = decision.Rng;
                    Run = RunRules.ApplyRunAction(Run, new RunPlace(turn, decision.HeroId, decision.Hex), Content);
                    break;
                }
                case RunPhase.Battle:
                {
                    var final = AiMatch.PlayBattle(RunRules.CreateRunBattle(Run, Content), Content, opponent, opponent);
                    Battle = BattleSession.Played(Content, final, opponent, PlayerSide);
                    Battle.Speed = speed;
                    battleOfMatch = Run.Match;
                    Run = RunRules.ApplyRunAction(Run, new RunMatchEnded(final.Outcome!, final.Round) { Loot = final.Loot }, Content);
                    break;
                }
                case RunPhase.MatchOver:
                    Run = RunRules.ApplyRunAction(Run, new RunNextMatch(), Content);
                    break;
                case RunPhase.Upgrade:
                    foreach (var side in new[] { Side.A, Side.B })
                    {
                        if (RunAi.ChooseSwap(Run, side, Content) is { } swap)
                            Run = RunRules.ApplyRunAction(Run, new RunSwapHero(side, swap.OutId, swap.InId), Content);
                        aiRng = AiRun.ChooseUpgrade(() => Run, side, Content, aiRng, a => Run = RunRules.ApplyRunAction(Run, a, Content));
                    }
                    Run = RunRules.ApplyRunAction(Run, new RunReadyUpgrade(Side.A), Content);
                    Run = RunRules.ApplyRunAction(Run, new RunReadyUpgrade(Side.B), Content);
                    break;
            }
        }
        if (Run.Phase == RunPhase.Upgrade) OpponentUpgrade();
        PickDeadline = null;
        aiDueAt = null;
        Changed();
    }

    // --- the player's commands ----------------------------------------------------------

    /// <summary>A player's choice, refused quietly if core refuses it: the screens only offer legal ones.</summary>
    private bool TryApply(RunAction action)
    {
        try
        {
            Apply(action);
            return true;
        }
        catch (IllegalActionException error)
        {
            GD.PushWarning($"Refused {action.Type}: {error.Message}");
            return false;
        }
    }

    /// <summary>The player takes a hero from the pool. Ignored when it is not their pick.</summary>
    public void PickHero(string id)
    {
        if (Run.Phase != RunPhase.Draft || DraftRules.DraftTurn(Run.Draft) != PlayerSide) return;
        TryApply(new RunPick(PlayerSide, id));
    }

    public void ChoosePlacingHero(string id)
    {
        if (Run.Placement is not { } placement || PlacementRules.IsPlaced(placement, id)) return;
        if (!Run.Draft.Picks.Of(PlayerSide).Contains(id)) return;
        PlacingHeroId = id;
        Changed();
    }

    /// <summary>Puts the chosen hero on a hex. Core refuses anything outside the free start zone.</summary>
    public void PlaceAt(Hex hex)
    {
        if (Run.Phase != RunPhase.Placement || Run.Placement is not { } placement || PlacingHeroId is not { } id) return;
        if (PlacementRules.PlacementTurn(placement) != PlayerSide) return;
        if (!PlacementRules.LegalPlacementHexes(placement, PlayerSide, Content.Config).Contains(hex)) return;
        TryApply(new RunPlace(PlayerSide, id, hex));
    }

    public void NextMatch()
    {
        if (Run.Phase == RunPhase.MatchOver) TryApply(new RunNextMatch());
    }

    public void TakePerk(string heroId, string perkId, string? abilityId = null)
    {
        if (Run.Phase == RunPhase.Upgrade) TryApply(new RunChoosePerk(PlayerSide, heroId, perkId) { AbilityId = abilityId });
    }

    public void TakeUnlock(string heroId, string optionId)
    {
        if (Run.Phase == RunPhase.Upgrade) TryApply(new RunChooseUnlock(PlayerSide, heroId, optionId));
    }

    public void TakeReward(string itemId, string heroId)
    {
        if (Run.Phase == RunPhase.Upgrade) TryApply(new RunChooseReward(PlayerSide, itemId, heroId));
    }

    public void SwapHero(string outId, string inId)
    {
        if (Run.Phase == RunPhase.Upgrade) TryApply(new RunSwapHero(PlayerSide, outId, inId));
    }

    public void CancelSwap()
    {
        if (Run.Upgrade?.Swapped.Of(PlayerSide) is not null) TryApply(new RunCancelSwap(PlayerSide));
    }

    /// <summary>What the player still has to choose before the next match; empty when nothing.</summary>
    public List<string> Waiting() =>
        Run.Upgrade is null ? [] : UpgradeRules.WaitingFor(Run.Upgrade, Run.Draft, PlayerSide, Content);

    /// <summary>Done with the upgrade phase. The AI opponent is already ready, so this moves on.</summary>
    public void ReadyUpgrade()
    {
        if (Run.Phase == RunPhase.Upgrade && Waiting().Count == 0) TryApply(new RunReadyUpgrade(PlayerSide));
    }
}
