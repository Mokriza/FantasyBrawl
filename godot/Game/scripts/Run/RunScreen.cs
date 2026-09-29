using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// A run on screen. Picks the screen from run.phase and nothing else, as
/// docs/ai/ui-and-rendering.md asks and src/ui/App.tsx does: draft, placement, the battle
/// (with the series overlay over it once the match is over) and the upgrade phase. The
/// session is ticked here every frame; the battle screen ticks the battle itself.
/// </summary>
public partial class RunScreen : Control
{
    private readonly RunSession session;
    private readonly Action toMenu;
    private readonly Action newRun;
    private readonly bool swapOpen;
    private Control? current;
    private string shownKey = "";

    public RunScreen(RunSession session, Action toMenu, Action newRun, bool swapOpen = false)
    {
        this.session = session;
        this.toMenu = toMenu;
        this.newRun = newRun;
        this.swapOpen = swapOpen;
    }

    public override void _Ready() => SetAnchorsPreset(LayoutPreset.FullRect);

    /// <summary>Which screen the run is on; a new key means a new screen.</summary>
    private string ScreenKey()
    {
        var run = session.Run;
        return run.Phase switch
        {
            RunPhase.Draft => "draft",
            RunPhase.Placement => $"placement {run.Match}",
            RunPhase.Upgrade => $"upgrade {run.Match}",
            // The battle, and the overlays over it once it is over, share one screen.
            _ => session.BattleIsCurrent ? $"battle {run.Match}" : "",
        };
    }

    public override void _Process(double delta)
    {
        session.Tick(Time.GetTicksMsec());
        string key = ScreenKey();
        if (key == shownKey || key == "") return;
        shownKey = key;

        current?.QueueFree();
        current = session.Run.Phase switch
        {
            RunPhase.Draft => new DraftScreen(session, toMenu),
            RunPhase.Placement => new PlacementScreen(session, toMenu),
            RunPhase.Upgrade => new UpgradeScreen(session, toMenu, swapOpen),
            _ => new BattleScreen(session.Battle!, toMenu, newRun, session),
        };
        AddChild(current);
        current.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
    }
}
