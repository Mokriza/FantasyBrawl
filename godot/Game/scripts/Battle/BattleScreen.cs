using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The battle screen: the board in the middle, both teams at the sides, the active hero
/// and their abilities below, the log on the right, as in the web version. Panels are
/// rebuilt when what they show changes; the board redraws every frame.
///
/// In a run the top strip also shows the series, and the end of the match hands over to
/// the run: the series overlay comes up once core has the result.
/// </summary>
public partial class BattleScreen : Control
{
    private readonly BattleSession session;
    private readonly Action toMenu;
    private readonly Action? playAgain;
    private readonly RunSession? run;
    private readonly Label holdLabel = new();

    private readonly Label roundLabel = new();
    private readonly Label statusLabel = new();
    private readonly VBoxContainer ours = new();
    private readonly VBoxContainer theirs = new();
    private readonly RichTextLabel log = new();
    private readonly HBoxContainer abilityBar = new();
    private readonly Label activeLabel = new();
    private readonly Label hintLabel = new();
    private readonly Label queueLabel = new();
    private readonly Board3D board = new();
    private Control? overlay;
    private string shown = "";
    private int logShown;

    public BattleScreen(BattleSession session, Action toMenu, Action? playAgain, RunSession? run = null)
    {
        this.session = session;
        this.toMenu = toMenu;
        this.playAgain = playAgain;
        this.run = run;
    }

    public override void _Ready()
    {
        SetAnchorsPreset(LayoutPreset.FullRect);
        var background = new ColorRect { Color = Palette.Background };
        background.SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(background);

        var root = new VBoxContainer();
        root.SetAnchorsPreset(LayoutPreset.FullRect);
        root.AddThemeConstantOverride("separation", 6);
        root.OffsetLeft = 8;
        root.OffsetTop = 6;
        root.OffsetRight = -8;
        root.OffsetBottom = -6;
        AddChild(root);

        root.AddChild(TopBar());

        queueLabel.AddThemeColorOverride("font_color", Palette.TextSoft);
        queueLabel.AddThemeFontSizeOverride("font_size", 13);
        root.AddChild(queueLabel);

        var middle = new HBoxContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        middle.AddThemeConstantOverride("separation", 8);
        root.AddChild(middle);

        ours.CustomMinimumSize = new Vector2(230, 0);
        theirs.CustomMinimumSize = new Vector2(230, 0);
        middle.AddChild(Scrolled(ours));

        board.Bind(session);
        middle.AddChild(board);

        var right = new VBoxContainer { CustomMinimumSize = new Vector2(300, 0) };
        right.AddChild(theirs);
        var logPanel = new PanelContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        logPanel.AddThemeStyleboxOverride("panel", Palette.PanelStyle());
        log.ScrollFollowing = true;
        log.BbcodeEnabled = true;
        log.AddThemeFontSizeOverride("normal_font_size", 13);
        logPanel.AddChild(log);
        right.AddChild(logPanel);
        middle.AddChild(right);

        var bottom = new PanelContainer();
        bottom.AddThemeStyleboxOverride("panel", Palette.PanelStyle());
        var bottomRow = new HBoxContainer();
        bottomRow.AddThemeConstantOverride("separation", 8);
        activeLabel.CustomMinimumSize = new Vector2(220, 0);
        bottomRow.AddChild(activeLabel);
        abilityBar.AddThemeConstantOverride("separation", 6);
        bottomRow.AddChild(abilityBar);
        bottom.AddChild(bottomRow);
        root.AddChild(bottom);

        hintLabel.AddThemeColorOverride("font_color", Palette.TextDim);
        hintLabel.AddThemeFontSizeOverride("font_size", 12);
        root.AddChild(hintLabel);
    }

    private static ScrollContainer Scrolled(Control inner)
    {
        var scroll = new ScrollContainer { HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled };
        scroll.CustomMinimumSize = new Vector2(240, 0);
        scroll.AddChild(inner);
        return scroll;
    }

    private Control TopBar()
    {
        var bar = new HBoxContainer();
        bar.AddThemeConstantOverride("separation", run is null ? 14 : 10);
        var title = new Label { Text = Texts.AppTitle };
        title.AddThemeFontSizeOverride("font_size", 18);
        bar.AddChild(title);
        if (run is not null) RunBar.Fill(bar, run);
        holdLabel.AddThemeColorOverride("font_color", Palette.PowerPoint);
        holdLabel.TooltipText = Texts.HoldHint;
        holdLabel.MouseFilter = MouseFilterEnum.Pass;
        bar.AddChild(holdLabel);
        bar.AddChild(roundLabel);
        statusLabel.AddThemeColorOverride("font_color", Palette.Active);
        bar.AddChild(statusLabel);
        // In a run the seed that matters is the run's: it gives the same pool and the same arenas.
        bar.AddChild(new Label { Text = $"{Texts.Seed}: {run?.Seed ?? session.Seed}", Modulate = Palette.TextDim });
        bar.AddChild(new Control { SizeFlagsHorizontal = SizeFlags.ExpandFill });
        RunBar.AddSpeed(bar, () => session.Speed, value =>
        {
            // In a run the speed also paces the opponent's picks, so it is kept there.
            if (run is not null) run.Speed = value;
            else session.Speed = value;
        });
        var menu = new Button { Text = Texts.ToMenu };
        menu.Pressed += toMenu;
        bar.AddChild(menu);
        return bar;
    }

    public override void _Process(double delta)
    {
        session.Tick(Time.GetTicksMsec());
        string signature = $"{session.Log.Count}|{session.Busy}|{session.SelectedAbility}|{session.Battle.ActiveHeroId}|{session.Battle.ApLeft}|{session.Battle.Outcome}";
        if (signature != shown)
        {
            shown = signature;
            Refresh();
        }
        hintLabel.Text = Texts.Hint;
        if (run is not null && overlay is null && run.Run.Phase is RunPhase.MatchOver or RunPhase.Finished)
        {
            overlay = SeriesOverlay.Build(run, toMenu, playAgain);
            AddChild(overlay);
        }
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is not InputEventKey { Pressed: true, Echo: false } key) return;
        if (!session.CanAct || session.Active is not { } hero) return;
        var abilities = Legal.AbilitiesOf(hero, session.Content);
        switch (key.Keycode)
        {
            case Key.Escape:
                session.SelectedAbility = null;
                break;
            case Key.Space:
                session.Dispatch(new EndTurnAction { HeroId = hero.Id });
                break;
            case Key.Q when abilities.Count > 0:
                Select(abilities[0].Id);
                break;
            case >= Key.Key1 and <= Key.Key3:
            {
                int slot = (int)(key.Keycode - Key.Key0);
                if (slot < abilities.Count) Select(abilities[slot].Id);
                break;
            }
            default:
                return;
        }
        GetViewport().SetInputAsHandled();
    }

    private void Select(string abilityId)
    {
        session.SelectedAbility = session.SelectedAbility == abilityId ? null : abilityId;
        shown = "";
    }

    private void Refresh()
    {
        var battle = session.Battle;
        roundLabel.Text = $"{Texts.Round} {battle.Round}";
        holdLabel.Text = ArenaModifiers.HoldToWin(battle, session.Content) is { } need
            ? $"{Texts.Hold}: {(session.PlayerSide == Side.A ? battle.Hold.A : battle.Hold.B)} : {(session.PlayerSide == Side.A ? battle.Hold.B : battle.Hold.A)} / {need}"
            : "";
        statusLabel.Text = battle.Outcome is not null
            ? ""
            : session.Busy ? (session.IsPlayerTurn ? Texts.Playing : Texts.Thinking) : session.IsPlayerTurn ? Texts.YourTurn : Texts.Thinking;

        var queue = Atb.PredictTurnOrder(battle, session.Content, 7);
        queueLabel.Text = $"{Texts.Queue}: {string.Join("  ›  ", queue.Select(id => battle.Heroes.Get(id)?.Name ?? id))}";

        Fill(ours, battle.Heroes.Values.Where(h => h.Summon is null && h.Side == session.PlayerSide));
        Fill(theirs, battle.Heroes.Values.Where(h => h.Summon is null && h.Side != session.PlayerSide));

        for (; logShown < session.Log.Count; logShown++)
        {
            var e = session.Log[logShown];
            if (Texts.EventText(e, battle, session.Content) is not { } text) continue;
            string colour = e switch
            {
                TurnStartedEvent => "#f0c04a",
                DamagedEvent or OpportunityAttackEvent => "#ffb3a6",
                HealedEvent => "#7ff0ae",
                DiedEvent => "#ff7a6a",
                _ => "#c9cddb",
            };
            log.AppendText($"[color={colour}]{text}[/color]\n");
        }

        RefreshAbilities();

        if (run is null && battle.Outcome is not null && !session.Busy && overlay is null) ShowResult(battle.Outcome);
    }

    private void Fill(VBoxContainer column, IEnumerable<BattleHero> heroes)
    {
        foreach (var child in column.GetChildren()) child.QueueFree();
        foreach (var hero in heroes) column.AddChild(HeroCard(hero));
    }

    private Control HeroCard(BattleHero hero)
    {
        bool active = session.Battle.ActiveHeroId == hero.Id;
        var panel = new PanelContainer();
        panel.AddThemeStyleboxOverride("panel", Palette.PanelStyle(active ? Palette.Active : Palette.SideColor(hero.Side, session.PlayerSide).Darkened(0.35f)));
        var box = new VBoxContainer();
        panel.AddChild(box);

        var heroClass = session.Content.GetClass(hero.ClassId);
        var name = new Label { Text = hero.Name };
        name.AddThemeColorOverride("font_color", Palette.SideColor(hero.Side, session.PlayerSide));
        name.AddThemeFontSizeOverride("font_size", 15);
        box.AddChild(name);
        box.AddChild(new Label { Text = $"{heroClass.Name} · {Texts.RoleName(heroClass.Role)}", Modulate = Palette.TextDim });

        double hp = session.Display.Heroes.TryGetValue(hero.Id, out var shownHero) ? shownHero.Hp : hero.Hp;
        var bar = new ProgressBar { MaxValue = hero.Base.MaxHp, Value = hp, ShowPercentage = false, CustomMinimumSize = new Vector2(0, 14) };
        var fill = new StyleBoxFlat { BgColor = hp / hero.Base.MaxHp > 0.35 ? Palette.HpGood : Palette.HpLow };
        bar.AddThemeStyleboxOverride("fill", fill);
        box.AddChild(bar);
        box.AddChild(new Label { Text = $"{hp} / {hero.Base.MaxHp}", Modulate = Palette.TextSoft });

        if (hero.Statuses.Count > 0)
        {
            var statuses = new Label
            {
                Text = string.Join(", ", hero.Statuses.Select(s => $"{session.Content.GetStatus(s.Status).Name} {s.Turns}")),
                AutowrapMode = TextServer.AutowrapMode.WordSmart,
                Modulate = Palette.TextSoft,
            };
            statuses.AddThemeFontSizeOverride("font_size", 12);
            box.AddChild(statuses);
        }
        if (!hero.IsAlive) panel.Modulate = new Color(1, 1, 1, 0.45f);
        return panel;
    }

    private void RefreshAbilities()
    {
        foreach (var child in abilityBar.GetChildren()) child.QueueFree();
        var hero = session.Active;
        if (hero is null)
        {
            activeLabel.Text = "";
            return;
        }
        activeLabel.Text = $"{hero.Name}\n{session.Battle.ApLeft} {Texts.Ap}";
        bool mine = session.CanAct;
        var abilities = Legal.AbilitiesOf(hero, session.Content);
        for (int i = 0; i < abilities.Count; i++)
        {
            var ability = abilities[i];
            string key = i == 0 ? "Q" : $"{i}";
            double cost = Legal.AbilityApCost(hero, ability, session.Content);
            double cooldown = Legal.CooldownLeft(hero, ability);
            string cooldownText = ability.Cooldown.Once ? "раз за бой" : $"{Texts.Cooldown} {ability.Cooldown.Turns}";
            var button = new Button
            {
                Text = $"{key}. {ability.Name}\n{cost} {Texts.Ap} · {Texts.Range} {Legal.AbilityRange(session.Battle, hero, ability, session.Content)} · {cooldownText}",
                ToggleMode = true,
                ButtonPressed = session.SelectedAbility == ability.Id,
                CustomMinimumSize = new Vector2(170, 52),
            };
            var availability = Legal.AbilityAvailability(session.Battle, hero, ability, session.Content);
            bool noTarget = availability.Ok && Legal.TargetsFor(session.Battle, hero, ability, session.Content).Count == 0;
            button.Disabled = !mine || !availability.Ok || noTarget;
            button.TooltipText = Describe.DescribeAbility(ability, hero, session.Content, session.Battle)
                + (availability.Reason is { } reason ? $"\n\n{Texts.Reason(reason)}" + (cooldown > 0 ? $" ({cooldown})" : "") : "")
                + (noTarget ? "\n\nНекого задеть отсюда" : "");
            string id = ability.Id;
            button.Pressed += () => Select(id);
            abilityBar.AddChild(button);
        }
        var end = new Button { Text = $"{Texts.EndTurn}\n(Пробел)", Disabled = !mine, CustomMinimumSize = new Vector2(130, 52) };
        end.Pressed += () => session.Dispatch(new EndTurnAction { HeroId = hero.Id });
        abilityBar.AddChild(end);
    }

    private void ShowResult(BattleOutcome outcome)
    {
        bool won = outcome.Winner == session.PlayerSide;
        var dim = new ColorRect { Color = new Color(0, 0, 0, 0.55f) };
        dim.SetAnchorsPreset(LayoutPreset.FullRect);
        var center = new CenterContainer();
        center.SetAnchorsPreset(LayoutPreset.FullRect);
        dim.AddChild(center);
        var card = new PanelContainer();
        card.AddThemeStyleboxOverride("panel", Palette.PanelStyle(won ? Palette.HpGood : Palette.HpLow));
        var box = new VBoxContainer();
        box.AddThemeConstantOverride("separation", 10);
        card.AddChild(box);
        var title = new Label { Text = won ? Texts.Victory : Texts.Defeat, HorizontalAlignment = HorizontalAlignment.Center };
        title.AddThemeFontSizeOverride("font_size", 30);
        title.AddThemeColorOverride("font_color", won ? Palette.HpGood : Palette.HpLow);
        box.AddChild(title);
        box.AddChild(new Label { Text = Texts.VictoryText(outcome.Reason, won), HorizontalAlignment = HorizontalAlignment.Center });
        var buttons = new HBoxContainer { Alignment = BoxContainer.AlignmentMode.Center };
        var again = new Button { Text = Texts.PlayAgain };
        if (playAgain is not null) again.Pressed += playAgain;
        var menu = new Button { Text = Texts.ToMenu };
        menu.Pressed += toMenu;
        buttons.AddChild(again);
        buttons.AddChild(menu);
        box.AddChild(buttons);
        center.AddChild(card);
        overlay = dim;
        AddChild(dim);
    }
}
