using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The board during placement: the line-up placed so far on this match's arena. While it
/// is the player's turn, the free hexes of their zone are the targets and the enemy zone
/// is shown faintly; otherwise both zones are. Which hexes are free is core's answer.
/// </summary>
public sealed class PlacementBoard(RunSession session) : IBoardSource
{
    private int version = -1;
    private BattleState? preview;
    private Projection? display;

    public ContentRegistry Content => session.Content;

    public BattleState Battle
    {
        get
        {
            Refresh();
            return preview!;
        }
    }

    public Projection Display
    {
        get
        {
            Refresh();
            return display!;
        }
    }

    public Side PlayerSide => session.PlayerSide;

    public Hex? Hover { get; set; }

    private void Refresh()
    {
        if (version == session.Version && preview is not null) return;
        version = session.Version;
        preview = RunRules.PlacementPreview(session.Run, Content);
        display = Playback.ProjectionOf(preview);
    }

    public BoardMarks Marks()
    {
        var placement = session.Run.Placement;
        if (placement is null) return BoardMarks.None;
        var config = Content.Config;
        var enemyZone = PlacementRules.StartZone(config, session.EnemySide).Select(h => h.Key);
        if (!session.IsPlayerTurn || session.PlacingHeroId is null || session.AutoPlayer)
        {
            var both = PlacementRules.StartZone(config, PlayerSide).Select(h => h.Key).Concat(enemyZone).ToHashSet();
            return BoardMarks.None with { Reach = both };
        }
        var free = PlacementRules.LegalPlacementHexes(placement, PlayerSide, config).Select(h => h.Key).ToHashSet();
        bool illegal = Hover is { } hover && !free.Contains(hover.Key);
        return BoardMarks.None with { Reach = enemyZone.ToHashSet(), Targets = free, Illegal = illegal };
    }

    public void Click(Hex hex) => session.PlaceAt(hex);

    public void Cancel()
    {
    }
}

/// <summary>
/// Placement before a match, as src/ui/screens/PlacementScreen.tsx: the arena of this
/// match, both start zones, and the heroes put down so far. Sides take turns placing one
/// hero at a time.
/// </summary>
public partial class PlacementScreen : Control
{
    private readonly RunSession session;
    private readonly Action toMenu;
    private readonly VBoxContainer top = Ui.Column(8);
    private readonly VBoxContainer ours = Ui.Column(6);
    private readonly VBoxContainer theirs = Ui.Column(6);
    private readonly BoardView board = new();
    private int shown = -1;

    public PlacementScreen(RunSession session, Action toMenu)
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

        var root = Ui.Column(8);
        root.SetAnchorsPreset(LayoutPreset.FullRect);
        root.OffsetLeft = 8;
        root.OffsetTop = 6;
        root.OffsetRight = -8;
        root.OffsetBottom = -6;
        AddChild(root);
        root.AddChild(top);

        var main = Ui.Row(10);
        main.SizeFlagsVertical = SizeFlags.ExpandFill;
        root.AddChild(main);
        ours.CustomMinimumSize = new Vector2(250, 0);
        theirs.CustomMinimumSize = new Vector2(250, 0);
        main.AddChild(ours);
        board.Bind(new PlacementBoard(session));
        var holder = new CenterContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        holder.AddChild(board);
        main.AddChild(holder);
        main.AddChild(theirs);
    }

    public override void _Process(double delta)
    {
        if (session.Version == shown) return;
        shown = session.Version;
        Rebuild();
    }

    private void Rebuild()
    {
        var run = session.Run;
        var placement = run.Placement;
        var you = session.PlayerSide;
        bool yours = session.IsPlayerTurn && !session.AutoPlayer;

        Ui.Clear(top);
        top.AddChild(RunBar.Build(session, toMenu));
        var banner = Ui.Row(14);
        banner.AddChild(Ui.Title(Texts.Placement.Title));
        banner.AddChild(Ui.Text(yours ? Texts.Placement.YourTurn : Texts.Placement.EnemyTurn, 15, yours ? Palette.Active : Palette.TextDim));
        banner.AddChild(new Control { SizeFlagsHorizontal = SizeFlags.ExpandFill });
        if (placement is not null) banner.AddChild(Ui.OrderChips(placement.Order, placement.Placed.Count, you, Texts.Placement.Order));
        top.AddChild(banner);

        FillTeam(ours, you, Texts.Draft.You);
        FillTeam(theirs, session.EnemySide, Texts.Draft.Enemy);
    }

    private void FillTeam(VBoxContainer column, Side side, string title)
    {
        Ui.Clear(column);
        var run = session.Run;
        var placement = run.Placement;
        column.AddChild(Ui.Text(title, 16, Palette.SideColor(side, session.PlayerSide)));
        foreach (var hero in DraftRules.TeamOf(run.Draft, side))
        {
            bool placed = placement is not null && PlacementRules.IsPlaced(placement, hero.Id);
            bool mine = side == session.PlayerSide;
            bool selected = session.PlacingHeroId == hero.Id;
            bool canChoose = mine && !placed && session.IsPlayerTurn && !session.AutoPlayer;
            var heroClass = session.Content.GetClass(hero.ClassId);
            var race = session.Content.Races.Get(hero.Race);
            var stats = Levels.StatsAtLevel(hero, RunRules.HeroLevel(run), session.Content);

            var row = Ui.Row(8);
            row.AddChild(new ClassBadge(heroClass, 32));
            var text = Ui.Column(0);
            text.SizeFlagsHorizontal = SizeFlags.ExpandFill;
            text.AddChild(Ui.Text(hero.Name, 14, Palette.SideColor(side, session.PlayerSide)));
            var subtitle = Ui.Dim($"{(race is null ? "" : $"{race.Name} · ")}{heroClass.Name} · {Texts.RoleName(heroClass.Role)}", 12, wrap: true);
            subtitle.TooltipText = race?.Description ?? "";
            subtitle.MouseFilter = MouseFilterEnum.Pass;
            text.AddChild(subtitle);
            text.AddChild(Ui.Dim($"{Texts.StatName(StatName.MaxHp)} {stats.MaxHp} · {Texts.StatName(StatName.Speed)} {stats.Speed}", 12));
            row.AddChild(text);
            if (placed) row.AddChild(Ui.Dim(Texts.Placement.Placed, 12));

            var border = selected && !placed ? Palette.Active : placed ? Palette.PanelBorder : Palette.SideColor(side, session.PlayerSide).Darkened(0.45f);
            var panel = Ui.Panel(row, border);
            if (placed) panel.Modulate = new Color(1, 1, 1, 0.6f);
            string id = hero.Id;
            if (canChoose) Ui.Clickable(panel, () => session.ChoosePlacingHero(id));
            column.AddChild(panel);
        }
    }
}
