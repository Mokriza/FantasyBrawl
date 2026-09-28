using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The main menu and the switch between screens. For now there is the quick battle on the
/// hand-made rosters against the AI; the run, the draft and online play come later
/// (docs/ai/godot-port.md).
///
/// Started with `-- --screenshot=path.png [--speed=0] [--frames=N]` it opens a quick
/// battle, waits, saves the window to the file and quits: a way to look at the screen
/// without a person at the keyboard.
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

    public override void _Ready()
    {
        foreach (string arg in OS.GetCmdlineUserArgs())
        {
            if (arg.StartsWith("--screenshot=")) screenshotPath = arg["--screenshot=".Length..];
            if (arg.StartsWith("--frames=")) screenshotFrames = int.Parse(arg["--frames=".Length..]);
            if (arg == "--autoplay") autoplay = true;
        }
        if (screenshotPath is not null || autoplay)
        {
            StartQuickBattle();
            if (screenshotPath is null) return;
            framesLeft = screenshotFrames;
            return;
        }
        ShowMenu();
    }

    public override void _Process(double delta)
    {
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

    private void StartQuickBattle()
    {
        var content = GameContent.Registry;
        // The interface may reach for real randomness; the core is seeded from it.
        double seed = double.TryParse(seedText.Trim(), out double parsed) && parsed >= 0 ? Math.Floor(parsed) : GD.Randi() % 1_000_000;
        var initial = BattleSetup.CreateBattle(seed, GameContent.Teams, content);
        var session = new BattleSession(content, initial, BattleAi.ProfileByName(content, difficulty), content.Config.Battle.PlayerSide) { AutoPlayer = autoplay };
        if (screenshotPath is not null) session.Speed = 4;
        Show(new BattleScreen(session, ShowMenu, StartQuickBattle));
    }
}
