using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The main menu and the switch between screens: a run against the AI (draft, placement,
/// the series and the upgrade phases) or a quick battle on the hand-made rosters. Online
/// play comes later (docs/ai/godot-port.md).
///
/// Arguments after `--` let a screen be looked at without a person at the keyboard:
/// `--screenshot=path.png [--frames=N]` saves the window after N frames and quits; `--run`
/// opens a run instead of a quick battle, `--menu` the menu; `--screen=draft|placement|
/// battle|series|upgrade|finished` with `--match=M`, `--picks=N`, `--placed=N` jumps the run
/// ahead to that screen, the AI playing both sides; `--expand` opens the swap candidates;
/// `--seed=N`, `--speed=N`; `--autoplay` lets the AI play the player's side too.
/// </summary>
public partial class Main : Control
{
    private Control? current;
    private string difficulty = "normal";
    private string seedText = "";

    private string? screenshotPath;
    private bool autoplay;
    private int screenshotFrames = 240;
    private int framesLeft = -1;
    private int? speedArg;
    private bool runArg;
    private bool menuArg;
    private bool expandArg;
    private string? screenArg;
    private int matchArg = 1;
    private int picksArg;
    private int placedArg;

    public override void _Ready()
    {
        foreach (string arg in OS.GetCmdlineUserArgs())
        {
            string Value(string name) => arg[name.Length..];
            if (arg.StartsWith("--screenshot=")) screenshotPath = Value("--screenshot=");
            if (arg.StartsWith("--frames=")) screenshotFrames = int.Parse(Value("--frames="));
            if (arg == "--autoplay") autoplay = true;
            if (arg == "--run") runArg = true;
            if (arg == "--menu") menuArg = true;
            if (arg == "--expand") expandArg = true;
            if (arg.StartsWith("--seed=")) seedText = Value("--seed=");
            if (arg.StartsWith("--speed=")) speedArg = int.Parse(Value("--speed="));
            if (arg.StartsWith("--screen=")) screenArg = Value("--screen=");
            if (arg.StartsWith("--match=")) matchArg = int.Parse(Value("--match="));
            if (arg.StartsWith("--picks=")) picksArg = int.Parse(Value("--picks="));
            if (arg.StartsWith("--placed=")) placedArg = int.Parse(Value("--placed="));
            if (arg.StartsWith("--click="))
            {
                var parts = Value("--click=").Split(':').Select(int.Parse).ToArray();
                clicks.Add((parts[0], new Vector2(parts[1], parts[2])));
            }
        }
        if (menuArg) ShowMenu();
        else if (runArg || screenArg is not null) StartRun();
        else if (screenshotPath is not null || autoplay) StartQuickBattle();
        else ShowMenu();
        if (screenshotPath is not null) framesLeft = screenshotFrames;
    }

    /// <summary>`--click=frame:x:y`: a left click at that point of the window on that frame, for checking a screen's buttons without a person.</summary>
    private readonly List<(int Frame, Vector2 At)> clicks = [];
    private int frame;

    private void Click(Vector2 at)
    {
        Input.ParseInputEvent(new InputEventMouseMotion { Position = at, GlobalPosition = at });
        Input.ParseInputEvent(new InputEventMouseButton { Position = at, GlobalPosition = at, ButtonIndex = MouseButton.Left, Pressed = true });
        Input.ParseInputEvent(new InputEventMouseButton { Position = at, GlobalPosition = at, ButtonIndex = MouseButton.Left, Pressed = false });
    }

    public override void _Process(double delta)
    {
        frame++;
        foreach (var (at, point) in clicks)
            if (at == frame) Click(point);
        if (framesLeft < 0) return;
        if (--framesLeft > 0) return;
        var image = GetViewport().GetTexture().GetImage();
        image.SavePng(screenshotPath!);
        GD.Print($"screenshot saved to {screenshotPath}");
        GetTree().Quit();
    }

    private void Show(Control screen)
    {
        current?.QueueFree();
        current = screen;
        AddChild(screen);
        screen.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
    }

    private void ShowMenu()
    {
        var content = GameContent.Registry;
        var screen = new Control();
        screen.SetAnchorsPreset(LayoutPreset.FullRect);
        var background = new ColorRect { Color = Palette.Background };
        background.SetAnchorsPreset(LayoutPreset.FullRect);
        screen.AddChild(background);

        var center = new CenterContainer();
        center.SetAnchorsPreset(LayoutPreset.FullRect);
        screen.AddChild(center);
        var card = new PanelContainer { CustomMinimumSize = new Vector2(440, 0) };
        card.AddThemeStyleboxOverride("panel", Palette.PanelStyle());
        center.AddChild(card);
        var box = new VBoxContainer();
        box.AddThemeConstantOverride("separation", 12);
        card.AddChild(box);

        var title = new Label { Text = Texts.AppTitle };
        title.AddThemeFontSizeOverride("font_size", 28);
        box.AddChild(title);
        box.AddChild(new Label { Text = "Godot · C# · ядро сверено с веб-версией", Modulate = Palette.TextDim });

        var run = new Button { Text = $"{Texts.NewRun}\n{Texts.NewRunHint}", CustomMinimumSize = new Vector2(0, 56) };
        run.Pressed += StartRun;
        box.AddChild(run);

        var quick = new Button { Text = $"{Texts.QuickBattle}\n{Texts.QuickBattleHint}", CustomMinimumSize = new Vector2(0, 56) };
        quick.Pressed += StartQuickBattle;
        box.AddChild(quick);

        var difficultyRow = new HBoxContainer();
        difficultyRow.AddChild(new Label { Text = Texts.Opponent, Modulate = Palette.TextDim });
        var picker = new OptionButton();
        foreach (var (id, name) in Texts.Difficulties)
        {
            if (!content.Config.Ai.Profiles.ContainsKey(id)) continue;
            picker.AddItem(name);
            picker.SetItemMetadata(picker.ItemCount - 1, id);
            if (id == difficulty) picker.Select(picker.ItemCount - 1);
        }
        picker.ItemSelected += index => difficulty = picker.GetItemMetadata((int)index).AsString();
        difficultyRow.AddChild(picker);
        box.AddChild(difficultyRow);

        var seedRow = new HBoxContainer();
        seedRow.AddChild(new Label { Text = Texts.Seed, Modulate = Palette.TextDim });
        var seedInput = new LineEdit { PlaceholderText = Texts.SeedRandom, Text = seedText, SizeFlagsHorizontal = SizeFlags.ExpandFill };
        seedInput.TextChanged += text => seedText = text;
        seedRow.AddChild(seedInput);
        box.AddChild(seedRow);

        var quit = new Button { Text = Texts.Quit };
        quit.Pressed += () => GetTree().Quit();
        box.AddChild(quit);

        Show(screen);
    }

    /// <summary>The seed typed in the menu, or a random one: the interface may reach for real randomness, the core is seeded from it.</summary>
    private double Seed() =>
        double.TryParse(seedText.Trim(), out double parsed) && parsed >= 0 ? Math.Floor(parsed) : GD.Randi() % 1_000_000;

    private void StartQuickBattle()
    {
        var content = GameContent.Registry;
        var initial = BattleSetup.CreateBattle(Seed(), GameContent.Teams, content);
        var session = new BattleSession(content, initial, BattleAi.ProfileByName(content, difficulty), content.Config.Battle.PlayerSide) { AutoPlayer = autoplay };
        session.Speed = speedArg ?? (screenshotPath is not null ? 4 : 1);
        Show(new BattleScreen(session, ShowMenu, StartQuickBattle));
    }

    /// <summary>A new run: a fresh pool, and a roll for who picks first.</summary>
    private void StartRun()
    {
        var content = GameContent.Registry;
        // A screenshot of a battle needs the battle to move, so the AI plays both sides there.
        var session = new RunSession(content, Seed(), difficulty) { AutoPlayer = autoplay || screenArg == "battle" };
        session.Speed = speedArg ?? (screenshotPath is not null ? 4 : 1);
        if (screenArg is not null) session.FastForward(StopAt(screenArg));
        Show(new RunScreen(session, ShowMenu, StartRun, expandArg));
    }

    /// <summary>Where a screenshot run stops jumping ahead.</summary>
    private Func<RunState, bool> StopAt(string screen) => screen switch
    {
        "draft" => r => r.Phase != RunPhase.Draft || r.Draft.Picks.A.Count + r.Draft.Picks.B.Count >= picksArg,
        "placement" => r => r.Match >= matchArg && r.Phase == RunPhase.Placement && r.Placement!.Placed.Count >= placedArg,
        "battle" => r => r.Match >= matchArg && r.Phase == RunPhase.Battle,
        "series" => r => r.Match >= matchArg && r.Phase == RunPhase.MatchOver,
        "upgrade" => r => r.Match >= matchArg && r.Phase == RunPhase.Upgrade,
        "finished" => _ => false,
        _ => _ => true,
    };
}
