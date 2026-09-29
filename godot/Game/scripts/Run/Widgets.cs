using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>Small builders the run screens share, so they read like the layout they make.</summary>
public static class Ui
{
    public static Label Text(string text, int size = 14, Color? colour = null, bool wrap = false)
    {
        var label = new Label { Text = text };
        if (size != 14) label.AddThemeFontSizeOverride("font_size", size);
        if (colour is { } c) label.AddThemeColorOverride("font_color", c);
        if (wrap)
        {
            label.AutowrapMode = TextServer.AutowrapMode.WordSmart;
            label.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
            label.CustomMinimumSize = new Vector2(40, 0);
        }
        return label;
    }

    public static Label Dim(string text, int size = 13, bool wrap = false) => Text(text, size, Palette.TextDim, wrap);

    public static Label Title(string text, int size = 20) => Text(text, size, Palette.Text);

    public static VBoxContainer Column(int separation = 6)
    {
        var box = new VBoxContainer();
        box.AddThemeConstantOverride("separation", separation);
        return box;
    }

    public static HBoxContainer Row(int separation = 8)
    {
        var box = new HBoxContainer();
        box.AddThemeConstantOverride("separation", separation);
        return box;
    }

    public static PanelContainer Panel(Control inner, Color? border = null)
    {
        var panel = new PanelContainer();
        panel.AddThemeStyleboxOverride("panel", Palette.PanelStyle(border));
        panel.AddChild(inner);
        return panel;
    }

    /// <summary>A panel that acts on a left click, the way the web cards do.</summary>
    public static void Clickable(Control panel, Action onClick)
    {
        panel.MouseFilter = Control.MouseFilterEnum.Stop;
        panel.MouseDefaultCursorShape = Control.CursorShape.PointingHand;
        panel.GuiInput += e =>
        {
            if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left })
            {
                panel.AcceptEvent();
                onClick();
            }
        };
    }

    public static ScrollContainer Scroll(Control inner, float minWidth = 0)
    {
        var scroll = new ScrollContainer
        {
            HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled,
            SizeFlagsVertical = Control.SizeFlags.ExpandFill,
            CustomMinimumSize = new Vector2(minWidth, 0),
        };
        inner.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        scroll.AddChild(inner);
        return scroll;
    }

    public static Button Button(string text, Action onPress, bool primary = false)
    {
        var button = new Button { Text = text };
        if (primary) button.AddThemeColorOverride("font_color", Palette.Active);
        button.Pressed += onPress;
        return button;
    }

    public static void Clear(Node node)
    {
        foreach (var child in node.GetChildren())
        {
            node.RemoveChild(child);
            child.QueueFree();
        }
    }

    /// <summary>The order of picks or placements as numbered chips: done, now, still to come.</summary>
    public static HBoxContainer OrderChips(IReadOnlyList<Side> order, int done, Side you, string tooltip)
    {
        var row = Row(3);
        row.TooltipText = tooltip;
        for (int i = 0; i < order.Count; i++)
        {
            var colour = order[i] == you ? Palette.Ours : Palette.Theirs;
            var chip = Text($"{i + 1}", 13, i < done ? colour.Darkened(0.5f) : colour);
            chip.HorizontalAlignment = HorizontalAlignment.Center;
            chip.CustomMinimumSize = new Vector2(24, 22);
            var panel = Panel(chip, i == done ? Palette.Active : colour.Darkened(0.4f));
            row.AddChild(panel);
        }
        return row;
    }
}

/// <summary>A class drawn as a coloured disc with its letter, as the board draws heroes.</summary>
public partial class ClassBadge : Control
{
    private readonly string classId;
    private readonly string letter;
    private readonly float size;

    public ClassBadge(HeroClass heroClass, float size = 32)
    {
        classId = heroClass.Id;
        letter = heroClass.Name[..1];
        this.size = size;
        CustomMinimumSize = new Vector2(size, size);
        MouseFilter = MouseFilterEnum.Ignore;
        TooltipText = heroClass.Name;
    }

    public override void _Draw()
    {
        var c = new Vector2(size / 2, size / 2);
        var ink = Palette.ClassColor(classId);
        DrawCircle(c, size / 2 - 1, new Color(ink, 0.35f));
        DrawArc(c, size / 2 - 1.5f, 0, Mathf.Tau, 32, ink, 2, true);
        int font = (int)(size * 0.5f);
        DrawString(ThemeDB.FallbackFont, new Vector2(0, c.Y + font * 0.36f), letter, HorizontalAlignment.Center, size, font, Palette.Text);
    }
}

/// <summary>
/// A hero of the run as a card, a port of src/ui/panels/DraftCard.tsx: nothing is hidden
/// at pick time, so the card shows class, race, every stat, the budget split, every
/// ability with its full text worked out for this hero, the passive and the artifact.
/// All numbers come from Brawl.Core.
/// </summary>
public static class HeroCardView
{
    public static PanelContainer Build(
        HeroTemplate hero,
        ContentRegistry content,
        int level,
        Side side,
        Side playerSide,
        bool compact = false,
        Action? onPick = null)
    {
        var heroClass = content.GetClass(hero.ClassId);
        // A one-hero battle, so the numbers include the hero's own passive, race and artifact.
        var preview = RunRules.PreviewBattle(hero, level, side, content);
        var asBattleHero = preview.Heroes[hero.Id];
        var stats = Modifiers.StatsInBattle(preview, asBattleHero, content);
        var race = content.Races.Get(hero.Race);
        var passive = hero.Passive is null ? null : content.Passives.Get(hero.Passive);
        var item = hero.Item is null ? null : content.Items.Get(hero.Item);
        bool hasUltimate = hero.Abilities.Any(id => content.GetAbility(id).Tier == 4);
        var sideColour = Palette.SideColor(side, playerSide);

        var box = Ui.Column(4);
        var panel = Ui.Panel(box, onPick is null ? sideColour.Darkened(0.45f) : sideColour);
        panel.CustomMinimumSize = new Vector2(compact ? 220 : 240, 0);

        var header = Ui.Row(8);
        header.AddChild(new ClassBadge(heroClass, compact ? 28 : 38));
        var title = Ui.Column(0);
        title.AddChild(Ui.Text(hero.Name, compact ? 14 : 16, sideColour));
        var subtitle = Ui.Dim($"{(race is null ? "" : $"{race.Name} · ")}{heroClass.Name} · {Texts.RoleName(heroClass.Role)}", 12, wrap: true);
        subtitle.TooltipText = race?.Description ?? "";
        subtitle.MouseFilter = Control.MouseFilterEnum.Pass;
        title.AddChild(subtitle);
        title.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        header.AddChild(title);
        box.AddChild(header);

        if (!compact && heroClass.TraitDescription is { } trait) box.AddChild(Ui.Dim(trait, 12, wrap: true));

        box.AddChild(StatGrid(hero, stats, heroClass, content));

        if (!compact) box.AddChild(BudgetBar(hero, content));

        foreach (string id in hero.Abilities)
        {
            var ability = content.GetAbility(id);
            box.AddChild(Ui.Text(ability.Name, 13, Palette.Text));
            if (compact) continue;
            box.AddChild(Ui.Dim(Texts.AbilityMeta(ability), 11));
            box.AddChild(Ui.Text(Describe.DescribeAbility(ability, asBattleHero, content, preview), 12, Palette.TextSoft, wrap: true));
        }

        // What the hero was drafted without, and when it gets to choose it.
        if (passive is null) box.AddChild(Ui.Dim(Texts.Draft.LockedPassive(content.Config.Run.PassiveAfterMatch), 11, wrap: true));
        if (!hasUltimate) box.AddChild(Ui.Dim(Texts.Draft.LockedUltimate(content.Config.Run.UltimateAfterMatch), 11, wrap: true));

        if (passive is not null) AddTrait(box, Texts.Passive, passive.Name, passive.Description, compact);
        if (item is not null) AddTrait(box, Texts.Item, item.Name, item.Description, compact);

        if (!compact)
        {
            var basic = content.GetAbility(Opportunity.BasicAttackOf(asBattleHero, content));
            var line = Ui.Dim($"{Texts.Draft.BasicAttack}: {basic.Name}, {Texts.RangeLong} {basic.Range}", 11, wrap: true);
            line.TooltipText = Describe.DescribeAbility(basic, asBattleHero, content, preview);
            line.MouseFilter = Control.MouseFilterEnum.Pass;
            box.AddChild(line);
        }

        if (onPick is not null)
        {
            box.AddChild(Ui.Button(Texts.Draft.Pick, onPick, primary: true));
            Ui.Clickable(panel, onPick);
        }
        return panel;
    }

    private static void AddTrait(VBoxContainer box, string kind, string name, string description, bool compact)
    {
        var line = Ui.Text($"{kind}: {name}", 12, Palette.Text, wrap: true);
        line.TooltipText = description;
        line.MouseFilter = Control.MouseFilterEnum.Pass;
        box.AddChild(line);
        if (!compact) box.AddChild(Ui.Text(description, 12, Palette.TextSoft, wrap: true));
    }

    /// <summary>Every stat with its value, and how far into its level-1 range the generator pushed it.</summary>
    private static GridContainer StatGrid(HeroTemplate hero, Stats stats, HeroClass heroClass, ContentRegistry content)
    {
        var grid = new GridContainer { Columns = 3 };
        grid.AddThemeConstantOverride("h_separation", 8);
        grid.AddThemeConstantOverride("v_separation", 1);
        double perRange = content.Config.Generation.PointsPerRange;
        foreach (var stat in HeroGenerator.StatNames)
        {
            bool primary = stat == heroClass.PrimaryStat;
            var name = Ui.Text(Texts.StatName(stat), 12, primary ? Palette.Active : Palette.TextDim);
            string help = $"{Texts.StatName(stat)}\n{Texts.StatHelp(stat, stats, content)}";
            name.TooltipText = help;
            name.MouseFilter = Control.MouseFilterEnum.Pass;
            grid.AddChild(name);
            var value = Ui.Text(Texts.StatValue(stat, stats.Get(stat)), 12, primary ? Palette.Active : Palette.Text);
            value.HorizontalAlignment = HorizontalAlignment.Right;
            value.CustomMinimumSize = new Vector2(38, 0);
            grid.AddChild(value);
            var meter = new ProgressBar
            {
                MaxValue = 1,
                Value = Math.Min(1, hero.StatPoints.Get(stat) / perRange),
                ShowPercentage = false,
                CustomMinimumSize = new Vector2(70, 6),
                SizeFlagsVertical = Control.SizeFlags.ShrinkCenter,
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
                MouseFilter = Control.MouseFilterEnum.Ignore,
            };
            meter.AddThemeStyleboxOverride("fill", new StyleBoxFlat { BgColor = primary ? Palette.Active : Palette.Range });
            meter.AddThemeStyleboxOverride("background", new StyleBoxFlat { BgColor = Palette.HexFill });
            grid.AddChild(meter);
        }
        return grid;
    }

    private static readonly Color[] BudgetColours =
        [Palette.Range, Palette.PowerPoint, Palette.Zone, Palette.HpGood, Palette.Death];

    /// <summary>How the point budget was spent, as one bar and a legend.</summary>
    private static VBoxContainer BudgetBar(HeroTemplate hero, ContentRegistry content)
    {
        double total = content.Config.Generation.Budget;
        var parts = new (string Label, double Value)[]
        {
            (Texts.Draft.BudgetAbilities, hero.Spend.Abilities),
            (Texts.Draft.BudgetPassive, hero.Spend.Passive),
            (Texts.Draft.BudgetUltimate, hero.Spend.Ultimate),
            (Texts.Draft.BudgetStats, hero.Spend.Stats),
            (Texts.Draft.BudgetItem, hero.Spend.Item),
        };
        var box = Ui.Column(2);
        box.TooltipText = $"{Texts.Draft.Budget} {total}: {string.Join(", ", parts.Select(p => $"{p.Label} {p.Value}"))}\n{Texts.Draft.BudgetReserveHint}";
        var bar = Ui.Row(0);
        bar.CustomMinimumSize = new Vector2(0, 6);
        bar.MouseFilter = Control.MouseFilterEnum.Ignore;
        for (int i = 0; i < parts.Length; i++)
        {
            if (parts[i].Value <= 0) continue;
            bar.AddChild(new ColorRect
            {
                Color = BudgetColours[i],
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
                SizeFlagsStretchRatio = (float)(parts[i].Value / total),
                CustomMinimumSize = new Vector2(1, 6),
                MouseFilter = Control.MouseFilterEnum.Ignore,
            });
        }
        box.AddChild(bar);
        var legend = new HFlowContainer();
        legend.AddThemeConstantOverride("h_separation", 8);
        for (int i = 0; i < parts.Length; i++)
            legend.AddChild(Ui.Text($"● {parts[i].Label} {parts[i].Value}", 10, BudgetColours[i]));
        box.AddChild(legend);
        return box;
    }
}

/// <summary>
/// Where the run stands, for the top strip of every run screen: the match, the score, the
/// level, and the arena modifier of this match or of the next one while it is announced.
/// </summary>
public static class RunBar
{
    public static void Fill(HBoxContainer bar, RunSession session)
    {
        var run = session.Run;
        bar.AddChild(Ui.Dim(Texts.MatchTitle(run.Match), 14));
        var score = Ui.Row(4);
        score.TooltipText = Texts.Score;
        score.AddChild(Ui.Text($"{run.Wins.Of(session.PlayerSide)}", 18, Palette.Ours));
        score.AddChild(Ui.Dim(":", 18));
        score.AddChild(Ui.Text($"{run.Wins.Of(session.EnemySide)}", 18, Palette.Theirs));
        bar.AddChild(score);
        bar.AddChild(Ui.Dim($"{Texts.Level} {RunRules.HeroLevel(run)}", 14));
        if (run.Modifier is { } id && run.Phase is not (RunPhase.MatchOver or RunPhase.Finished))
        {
            var modifier = session.Content.ArenaModifiers.Get(id);
            var chip = Ui.Panel(Ui.Text($"{Texts.Modifier}: {modifier?.Name ?? id}", 13, Palette.PowerPoint), Palette.PowerPoint.Darkened(0.4f));
            chip.TooltipText = modifier?.Description ?? "";
            bar.AddChild(chip);
        }
    }

    /// <summary>The whole strip for a run screen that is not the battle: title, run, seed, speed, way out.</summary>
    public static HBoxContainer Build(RunSession session, Action toMenu, Label? status = null)
    {
        var bar = Ui.Row(14);
        bar.AddChild(Ui.Title(Texts.AppTitle, 18));
        Fill(bar, session);
        if (status is not null) bar.AddChild(status);
        bar.AddChild(Ui.Dim($"{Texts.Seed}: {session.Seed}", 13));
        bar.AddChild(new Control { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill });
        AddSpeed(bar, () => session.Speed, value => session.Speed = value);
        bar.AddChild(Ui.Button(Texts.ToMenu, toMenu));
        return bar;
    }

    /// <summary>The ×1 ×2 ×4 instant buttons.</summary>
    public static void AddSpeed(HBoxContainer bar, Func<int> current, Action<int> set)
    {
        bar.AddChild(Ui.Dim(Texts.Speed, 13));
        var buttons = new List<Button>();
        foreach (int speed in new[] { 1, 2, 4, 0 })
        {
            var button = new Button { Text = speed == 0 ? Texts.Instant : $"×{speed}", ToggleMode = true, ButtonPressed = current() == speed };
            int chosen = speed;
            button.Pressed += () =>
            {
                set(chosen);
                foreach (var b in buttons) b.ButtonPressed = b == button;
            };
            buttons.Add(button);
            bar.AddChild(button);
        }
    }
}
