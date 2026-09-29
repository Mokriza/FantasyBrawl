using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The upgrade phase between matches, as src/ui/screens/UpgradeScreen.tsx: for every hero
/// of the player, what the new level gave, what it unlocks now (a passive after the first
/// match, a tier IV ability after the second) and the perks to take one from; the match
/// reward and the optional swap. The opponent's choices are shown too: nothing in this
/// game is hidden.
///
/// Offers, eligibility and the effect of a perk all come from core; this only lays them
/// out and passes the choice on. What is open on the screen (a perk asking which ability,
/// a reward asking which hero, the swap candidates) is the screen's own business.
/// </summary>
public partial class UpgradeScreen : Control
{
    private readonly RunSession session;
    private readonly Action toMenu;
    private readonly VBoxContainer top = Ui.Column(8);
    private readonly VBoxContainer list = Ui.Column(10);
    private readonly VBoxContainer enemy = Ui.Column(8);
    private ScrollContainer? scroll;
    private int shown = -1;

    /// <summary>"heroId/perkId" of an ability perk waiting for its ability.</summary>
    private string? askingPerk;
    /// <summary>The reward waiting for the hero who will carry it.</summary>
    private string? askingReward;
    private bool swapOpen;

    public UpgradeScreen(RunSession session, Action toMenu, bool swapOpen = false)
    {
        this.session = session;
        this.toMenu = toMenu;
        this.swapOpen = swapOpen;
    }

    private ContentRegistry Content => session.Content;

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

        var main = Ui.Row(12);
        main.SizeFlagsVertical = SizeFlags.ExpandFill;
        root.AddChild(main);
        scroll = Ui.Scroll(list);
        scroll.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        main.AddChild(scroll);
        main.AddChild(Ui.Scroll(enemy, 280));
    }

    public override void _Process(double delta)
    {
        if (session.Version == shown) return;
        shown = session.Version;
        Rebuild();
    }

    /// <summary>A local change of what is open: rebuilt at once, keeping the scroll where it was.</summary>
    private void Redraw() => shown = -1;

    private void Rebuild()
    {
        var run = session.Run;
        if (run.Upgrade is not { } upgrade) return;
        var you = session.PlayerSide;
        int scrolled = scroll?.ScrollVertical ?? 0;

        Ui.Clear(top);
        top.AddChild(RunBar.Build(session, toMenu));
        top.AddChild(Banner(run, upgrade));

        Ui.Clear(list);
        if (RewardBlock(upgrade) is { } reward) list.AddChild(reward);
        if (SwapBlock(upgrade) is { } swap) list.AddChild(swap);
        foreach (var hero in DraftRules.TeamOf(run.Draft, you)) HeroUpgrade(upgrade, hero);

        Ui.Clear(enemy);
        EnemyColumn(upgrade);

        if (scroll is not null) Callable.From(() => scroll.ScrollVertical = scrolled).CallDeferred();
    }

    private Control Banner(RunState run, UpgradeState upgrade)
    {
        var box = Ui.Column(4);
        var row = Ui.Row(14);
        row.AddChild(Ui.Title($"{Texts.Upgrade.Title} {Texts.Upgrade.BeforeMatch} {run.Match}"));
        row.AddChild(new Control { SizeFlagsHorizontal = SizeFlags.ExpandFill });
        var waiting = session.Waiting();
        var done = new Button { Text = Texts.Upgrade.ToPlacement, Disabled = waiting.Count > 0, CustomMinimumSize = new Vector2(180, 36) };
        done.AddThemeColorOverride("font_color", Palette.Active);
        if (waiting.Count > 0) done.TooltipText = Texts.Upgrade.Waiting;
        done.Pressed += session.ReadyUpgrade;
        row.AddChild(done);
        box.AddChild(row);
        box.AddChild(Ui.Dim(Texts.Upgrade.Hint, 12, wrap: true));
        if (UpgradeRules.TrailingSide(run.Wins, Content) == session.PlayerSide)
            box.AddChild(Ui.Text(Texts.Upgrade.CatchUp, 13, Palette.Active, wrap: true));
        if (run.Modifier is { } id && Content.ArenaModifiers.Get(id) is { } modifier)
            box.AddChild(Ui.Text($"{Texts.Upgrade.ModifierNext(run.Match)} {modifier.Name} — {modifier.Description}", 13, Palette.PowerPoint, wrap: true));
        return box;
    }

    // --- cards ---------------------------------------------------------------------------

    /// <summary>A choice as a card: category, name and text; a gold border once chosen.</summary>
    private static (PanelContainer Panel, VBoxContainer Box) Card(string category, string name, string text, bool chosen, Color? border = null)
    {
        var box = Ui.Column(3);
        box.AddChild(Ui.Dim(category, 11));
        box.AddChild(Ui.Text(name, 14, Palette.Text, wrap: true));
        box.AddChild(Ui.Text(text, 12, Palette.TextSoft, wrap: true));
        var panel = Ui.Panel(box, chosen ? Palette.Active : border);
        panel.CustomMinimumSize = new Vector2(250, 0);
        panel.SizeFlagsVertical = SizeFlags.Fill;
        return (panel, box);
    }

    private static HFlowContainer CardRow()
    {
        var row = new HFlowContainer();
        row.AddThemeConstantOverride("h_separation", 8);
        row.AddThemeConstantOverride("v_separation", 8);
        return row;
    }

    // --- the reward ----------------------------------------------------------------------

    /// <summary>A few artifacts, one of which goes to one hero. Clicking a card asks which hero.</summary>
    private Control? RewardBlock(UpgradeState upgrade)
    {
        var offered = upgrade.Rewards.Of(session.PlayerSide);
        if (offered.Count == 0) return null;
        var pick = upgrade.Rewarded.Of(session.PlayerSide);
        // The team that will play: a newcomer may take the reward, a leaving hero may not.
        var team = UpgradeRules.TeamAfterSwap(upgrade, session.Run.Draft, session.PlayerSide);

        var box = Ui.Column(6);
        box.AddChild(Ui.Text(Texts.Upgrade.RewardTitle, 16, Palette.Active));
        var row = CardRow();
        foreach (string id in offered)
        {
            if (Content.Items.Get(id) is not { } item) continue;
            bool chosen = pick?.ItemId == id;
            var border = item.Tier == ItemTier.Legendary ? Palette.PowerPoint.Darkened(0.2f) : Palette.Range.Darkened(0.3f);
            var (panel, card) = Card(Texts.Upgrade.ItemTier(item.Tier), item.Name, item.Description, chosen, border);
            if (chosen) card.AddChild(Ui.Dim($"{Texts.Upgrade.RewardFor} {team.FirstOrDefault(h => h.Id == pick!.HeroId)?.Name}", 12));
            if (askingReward == id)
            {
                card.AddChild(Ui.Dim(Texts.Upgrade.RewardWho, 12));
                foreach (var hero in team.Where(h => ItemRules.ItemFits(item, h.ClassId, Content)))
                {
                    string heroId = hero.Id;
                    string carried = hero.Item is null ? "" : $" ({Texts.Upgrade.Replaces} {Content.Items.Get(hero.Item)?.Name ?? hero.Item})";
                    card.AddChild(Ui.Button(hero.Name + carried, () =>
                    {
                        askingReward = null;
                        session.TakeReward(id, heroId);
                        Redraw();
                    }));
                }
            }
            else
            {
                Ui.Clickable(panel, () =>
                {
                    askingReward = id;
                    Redraw();
                });
            }
            row.AddChild(panel);
        }
        box.AddChild(row);
        return Ui.Panel(box);
    }

    // --- the swap ------------------------------------------------------------------------

    /// <summary>The optional swap: the candidates as full cards, each with the heroes it could replace. Folded by default.</summary>
    private Control? SwapBlock(UpgradeState upgrade)
    {
        var candidates = upgrade.Candidates.Of(session.PlayerSide);
        if (candidates.Count == 0) return null;
        var swap = upgrade.Swapped.Of(session.PlayerSide);
        var team = DraftRules.TeamOf(session.Run.Draft, session.PlayerSide);

        var box = Ui.Column(6);
        var header = Ui.Row(10);
        header.AddChild(Ui.Text(Texts.Upgrade.SwapTitle, 16, Palette.Active));
        header.AddChild(Ui.Button(swapOpen ? Texts.Upgrade.SwapHide : Texts.Upgrade.SwapShow, () =>
        {
            swapOpen = !swapOpen;
            Redraw();
        }));
        if (swap is not null) header.AddChild(Ui.Button(Texts.Upgrade.SwapCancel, session.CancelSwap));
        box.AddChild(header);
        if (!swapOpen) return Ui.Panel(box);

        box.AddChild(Ui.Dim(Texts.Upgrade.SwapHint, 12, wrap: true));
        var row = CardRow();
        foreach (var hero in candidates)
        {
            bool chosen = swap?.InId == hero.Id;
            var column = Ui.Column(6);
            column.AddChild(HeroCardView.Build(hero, Content, RunRules.HeroLevel(session.Run), session.PlayerSide, session.PlayerSide));
            column.AddChild(Ui.Dim(chosen ? Texts.Upgrade.SwapChosen : Texts.Upgrade.SwapInstead, 12));
            var buttons = new HFlowContainer();
            buttons.AddThemeConstantOverride("h_separation", 6);
            foreach (var mine in team)
            {
                string outId = mine.Id, inId = hero.Id;
                var button = new Button { Text = mine.Name, ToggleMode = true, ButtonPressed = chosen && swap?.OutId == mine.Id };
                button.Pressed += () => session.SwapHero(outId, inId);
                buttons.AddChild(button);
            }
            column.AddChild(buttons);
            row.AddChild(chosen ? Ui.Panel(column, Palette.Active) : column);
        }
        box.AddChild(row);
        return Ui.Panel(box);
    }

    // --- one hero ------------------------------------------------------------------------

    private Control HeroHeader(HeroTemplate hero, string subtitle, Color colour)
    {
        var header = Ui.Row(10);
        header.AddChild(new ClassBadge(Content.GetClass(hero.ClassId), 36));
        var title = Ui.Column(0);
        title.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        title.AddChild(Ui.Text(hero.Name, 16, colour));
        title.AddChild(Ui.Dim(subtitle, 12, wrap: true));
        header.AddChild(title);
        return header;
    }

    private string RaceAndClass(HeroTemplate hero)
    {
        var race = Content.Races.Get(hero.Race);
        return $"{(race is null ? "" : $"{race.Name} · ")}{Content.GetClass(hero.ClassId).Name}";
    }

    private string PerkNames(HeroTemplate hero) => string.Join(", ", hero.Perks.Select(p => Content.Perks.Get(p.PerkId)?.Name ?? p.PerkId));

    private void HeroUpgrade(UpgradeState upgrade, HeroTemplate hero)
    {
        var you = session.PlayerSide;
        var swap = upgrade.Swapped.Of(you);
        if (swap?.OutId == hero.Id)
        {
            var incoming = upgrade.Candidates.Of(you).FirstOrDefault(h => h.Id == swap.InId);
            var leaving = Ui.Panel(HeroHeader(hero, $"{Texts.Upgrade.Leaving} {incoming?.Name}", Palette.TextDim));
            leaving.Modulate = new Color(1, 1, 1, 0.6f);
            list.AddChild(leaving);
            if (incoming is not null) list.AddChild(Newcomer(incoming));
            return;
        }

        var box = Ui.Column(6);
        string owned = RaceAndClass(hero);
        if (hero.Item is not null) owned += $" · {Texts.Item}: {Content.Items.Get(hero.Item)?.Name ?? hero.Item}";
        if (hero.Perks.Count > 0) owned += $" · {Texts.Upgrade.Perks}: {PerkNames(hero)}";
        box.AddChild(HeroHeader(hero, owned, Palette.Ours));
        box.AddChild(LevelGain(hero));
        if (UnlockRow(upgrade, hero) is { } unlock) box.AddChild(unlock);

        box.AddChild(Ui.Text(Texts.Upgrade.PerkTitle, 14, Palette.Active));
        var offers = upgrade.Offers.Get(hero.Id) ?? [];
        var pick = upgrade.Chosen.Get(hero.Id);
        var row = CardRow();
        if (offers.Count == 0) row.AddChild(Ui.Dim(Texts.Upgrade.NoOffers));
        foreach (string id in offers)
        {
            if (Content.Perks.Get(id) is { } perk) row.AddChild(PerkCard(hero, perk, pick?.PerkId == id));
        }
        box.AddChild(row);
        if (pick?.AbilityId is { } abilityId)
            box.AddChild(Ui.Dim($"{Texts.Upgrade.Chosen}: {Content.Perks.Get(pick.PerkId)?.Name} → {Content.GetAbility(abilityId).Name}", 12));
        list.AddChild(Ui.Panel(box));
    }

    /// <summary>What the level this phase grants did to a hero, stat by stat.</summary>
    private Control LevelGain(HeroTemplate hero)
    {
        int level = RunRules.HeroLevel(session.Run);
        var before = Levels.StatsAtLevel(hero, level - 1, Content);
        var after = Levels.StatsAtLevel(hero, level, Content);
        var grown = HeroGenerator.StatNames.Where(s => after.Get(s) != before.Get(s))
            .Select(s => $"{Texts.StatName(s)} {Texts.StatValue(s, before.Get(s))} → {Texts.StatValue(s, after.Get(s))}");
        return Ui.Text(string.Join("    ", grown), 13, Palette.HpGood, wrap: true);
    }

    /// <summary>One perk on offer. An ability perk asks which ability; a pick can be changed until the phase ends.</summary>
    private Control PerkCard(HeroTemplate hero, Perk perk, bool chosen)
    {
        var (panel, card) = Card(Texts.Upgrade.Category(perk.Category), perk.Name, perk.Description, chosen);
        string key = $"{hero.Id}/{perk.Id}";
        string heroId = hero.Id, perkId = perk.Id;
        if (askingPerk == key)
        {
            card.AddChild(Ui.Dim(Texts.Upgrade.ChooseAbility, 12));
            foreach (string abilityId in UpgradeRules.PerkTargets(hero, perk, Content))
            {
                string target = abilityId;
                card.AddChild(Ui.Button(Content.GetAbility(abilityId).Name, () =>
                {
                    askingPerk = null;
                    session.TakePerk(heroId, perkId, target);
                    Redraw();
                }));
            }
            return panel;
        }
        Ui.Clickable(panel, () =>
        {
            if (perk.AbilityMod is null) session.TakePerk(heroId, perkId);
            else
            {
                askingPerk = key;
                Redraw();
            }
        });
        return panel;
    }

    /// <summary>The passive or tier IV ability this hero may take now, one card per option.</summary>
    private Control? UnlockRow(UpgradeState upgrade, HeroTemplate hero)
    {
        if (upgrade.Unlocks.Get(hero.Id) is not { } unlock) return null;
        string? taken = upgrade.Unlocked.Get(hero.Id);
        // Ability numbers are worked out on the hero as it will fight in the next match.
        var preview = RunRules.PreviewBattle(hero, RunRules.HeroLevel(session.Run), session.PlayerSide, Content);
        var asBattleHero = preview.Heroes[hero.Id];

        var box = Ui.Column(4);
        box.AddChild(Ui.Text(unlock.Kind == UnlockKind.Passive ? Texts.Upgrade.UnlockPassive : Texts.Upgrade.UnlockUltimate, 14, Palette.Active));
        var row = CardRow();
        foreach (string id in unlock.Options)
        {
            var passive = unlock.Kind == UnlockKind.Passive ? Content.Passives.Get(id) : null;
            var ability = unlock.Kind == UnlockKind.Ultimate ? Content.Abilities.Get(id) : null;
            string category = ability is null ? Texts.Passive : Texts.AbilityMeta(ability);
            string text = passive?.Description ?? (ability is null ? "" : Describe.DescribeAbility(ability, asBattleHero, Content, preview));
            var (panel, _) = Card(category, passive?.Name ?? ability?.Name ?? id, text, taken == id);
            string heroId = hero.Id, optionId = id;
            Ui.Clickable(panel, () => session.TakeUnlock(heroId, optionId));
            row.AddChild(panel);
        }
        box.AddChild(row);
        return box;
    }

    /// <summary>A newcomer from a swap: it arrived ready, so there is only something to look at.</summary>
    private Control Newcomer(HeroTemplate hero)
    {
        var box = Ui.Column(4);
        box.AddChild(HeroHeader(hero, $"{Texts.Upgrade.Newcomer} · {RaceAndClass(hero)}", Palette.Ours));
        box.AddChild(Ui.Dim(Texts.Upgrade.NewcomerHint, 12));
        string line = "";
        if (hero.Passive is not null) line += $"{Texts.Passive}: {Content.Passives.Get(hero.Passive)?.Name}. ";
        line += $"{Texts.Upgrade.Perks}: {PerkNames(hero)}. ";
        if (hero.Item is not null) line += $"{Texts.Item}: {Content.Items.Get(hero.Item)?.Name ?? hero.Item}";
        box.AddChild(Ui.Text(line, 13, Palette.TextSoft, wrap: true));
        return Ui.Panel(box, Palette.Active.Darkened(0.3f));
    }

    // --- the opponent --------------------------------------------------------------------

    private void EnemyColumn(UpgradeState upgrade)
    {
        var run = session.Run;
        var side = session.EnemySide;
        enemy.AddChild(Ui.Text(Texts.Upgrade.Enemy, 16, Palette.Theirs));
        if (UpgradeRules.TrailingSide(run.Wins, Content) == side) enemy.AddChild(Ui.Text(Texts.Upgrade.EnemyCatchUp, 12, Palette.Active, wrap: true));
        // The team that will play, so the reward can name a newcomer.
        var team = UpgradeRules.TeamAfterSwap(upgrade, run.Draft, side);
        var swap = upgrade.Swapped.Of(side);
        if (swap is not null)
            enemy.AddChild(Ui.Dim($"{Texts.Upgrade.EnemySwap}: {run.Draft.Pool.FirstOrDefault(h => h.Id == swap.OutId)?.Name} → {team.FirstOrDefault(h => h.Id == swap.InId)?.Name}", 12, wrap: true));
        if (upgrade.Rewarded.Of(side) is { } reward)
        {
            var line = Ui.Dim($"{Texts.Upgrade.RewardTitleShort}: {Content.Items.Get(reward.ItemId)?.Name} {Texts.Upgrade.RewardFor} {team.FirstOrDefault(h => h.Id == reward.HeroId)?.Name}", 12, wrap: true);
            line.TooltipText = Content.Items.Get(reward.ItemId)?.Description ?? "";
            line.MouseFilter = MouseFilterEnum.Pass;
            enemy.AddChild(line);
        }
        foreach (var hero in team)
        {
            var pick = upgrade.Chosen.Get(hero.Id);
            var perk = pick is null ? null : Content.Perks.Get(pick.PerkId);
            string? unlockId = upgrade.Unlocked.Get(hero.Id);
            string? unlocked = unlockId is null ? null : Content.Passives.Get(unlockId)?.Name ?? Content.Abilities.Get(unlockId)?.Name;
            var row = Ui.Row(8);
            row.AddChild(new ClassBadge(Content.GetClass(hero.ClassId), 26));
            var text = Ui.Column(0);
            text.SizeFlagsHorizontal = SizeFlags.ExpandFill;
            text.AddChild(Ui.Text(hero.Name, 14, Palette.Theirs));
            if (unlocked is not null) text.AddChild(Ui.Dim(unlocked, 12, wrap: true));
            text.AddChild(Ui.Dim(swap?.InId == hero.Id ? Texts.Upgrade.Newcomer : perk?.Name ?? "…", 12, wrap: true));
            row.AddChild(text);
            var panel = Ui.Panel(row);
            panel.TooltipText = perk?.Description ?? "";
            enemy.AddChild(panel);
        }
    }
}
