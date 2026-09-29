using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The open snake draft, as src/ui/screens/DraftScreen.tsx: the pool in the middle, both
/// teams at the sides, whose pick it is and how long is left. A taken hero leaves the
/// pool for both sides at once. Rebuilt whenever the run changes.
/// </summary>
public partial class DraftScreen : Control
{
    private readonly RunSession session;
    private readonly Action toMenu;
    private readonly VBoxContainer root = Ui.Column(8);
    private readonly Label timer = Ui.Text("", 18, Palette.Active);
    private int shown = -1;

    public DraftScreen(RunSession session, Action toMenu)
    {
        this.session = session;
        this.toMenu = toMenu;
    }

    public override void _Ready()
    {
        SetAnchorsPreset(LayoutPreset.FullRect);
        var background = new ColorRect { Color = Palette.Background };
        background.SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(background);
        root.SetAnchorsPreset(LayoutPreset.FullRect);
        root.OffsetLeft = 8;
        root.OffsetTop = 6;
        root.OffsetRight = -8;
        root.OffsetBottom = -6;
        AddChild(root);
        timer.TooltipText = Texts.Draft.TimerHint;
        timer.MouseFilter = MouseFilterEnum.Pass;
    }

    public override void _Process(double delta)
    {
        if (session.Version != shown)
        {
            shown = session.Version;
            Rebuild();
        }
        double now = Time.GetTicksMsec();
        timer.Text = session.PickDeadline is { } deadline ? Texts.Draft.Timer(Math.Max(0, Math.Ceiling((deadline - now) / 1000))) : "";
        bool low = session.PickDeadline is { } d && d - now <= 10_000;
        timer.AddThemeColorOverride("font_color", low ? Palette.HpLow : Palette.Active);
    }

    private void Rebuild()
    {
        // The timer label lives on between rebuilds; take it out before the old banner goes.
        timer.GetParent()?.RemoveChild(timer);
        Ui.Clear(root);
        var run = session.Run;
        var you = session.PlayerSide;
        bool yours = session.IsPlayerTurn;
        int done = run.Draft.Picks.A.Count + run.Draft.Picks.B.Count;

        root.AddChild(RunBar.Build(session, toMenu));

        var banner = Ui.Row(14);
        banner.AddChild(Ui.Title(Texts.Draft.Title));
        banner.AddChild(Ui.Text(yours ? Texts.Draft.YourPick : Texts.Draft.EnemyPick, 15, yours ? Palette.Active : Palette.TextDim));
        banner.AddChild(timer);
        banner.AddChild(Ui.Dim(you == Side.A ? Texts.Draft.YouFirst : Texts.Draft.EnemyFirst));
        banner.AddChild(new Control { SizeFlagsHorizontal = SizeFlags.ExpandFill });
        banner.AddChild(Ui.OrderChips(run.Draft.Order, done, you, Texts.Draft.Order));
        root.AddChild(banner);

        var main = Ui.Row(10);
        main.SizeFlagsVertical = SizeFlags.ExpandFill;
        root.AddChild(main);

        main.AddChild(TeamColumn(you, Texts.Draft.You));

        var pool = new HFlowContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        pool.AddThemeConstantOverride("h_separation", 8);
        pool.AddThemeConstantOverride("v_separation", 8);
        foreach (var hero in DraftRules.AvailableHeroes(run.Draft))
        {
            string id = hero.Id;
            pool.AddChild(HeroCardView.Build(hero, session.Content, RunRules.HeroLevel(run), you, you, onPick: yours ? () => session.PickHero(id) : null));
        }
        var poolScroll = Ui.Scroll(pool);
        poolScroll.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        main.AddChild(poolScroll);

        main.AddChild(TeamColumn(session.EnemySide, Texts.Draft.Enemy));
    }

    private Control TeamColumn(Side side, string title)
    {
        var run = session.Run;
        var column = Ui.Column(6);
        column.AddChild(Ui.Text(title, 16, Palette.SideColor(side, session.PlayerSide)));
        var team = DraftRules.TeamOf(run.Draft, side);
        foreach (var hero in team)
            column.AddChild(HeroCardView.Build(hero, session.Content, RunRules.HeroLevel(run), side, session.PlayerSide, compact: true));
        int empty = run.Draft.Order.Count(s => s == side) - team.Count;
        for (int i = 0; i < empty; i++)
        {
            var slot = Ui.Dim(Texts.Draft.Empty);
            slot.HorizontalAlignment = HorizontalAlignment.Center;
            slot.CustomMinimumSize = new Vector2(220, 48);
            slot.VerticalAlignment = VerticalAlignment.Center;
            column.AddChild(Ui.Panel(slot));
        }
        return Ui.Scroll(column, 232);
    }
}
