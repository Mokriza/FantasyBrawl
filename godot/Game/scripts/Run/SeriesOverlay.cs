using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The overlays between matches of a run and at its end, as src/ui/panels/SeriesOverlay.tsx.
/// Between matches: who won, the score, and what the coming level does to each of the
/// player's heroes, stat by stat, straight from statsAtLevel. At the end: the verdict and
/// every match of the series.
/// </summary>
public static class SeriesOverlay
{
    public static Control Build(RunSession session, Action toMenu, Action? newRun)
    {
        var dim = new ColorRect { Color = new Color(0, 0, 0, 0.6f) };
        dim.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        var center = new CenterContainer();
        center.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        dim.AddChild(center);
        var box = Ui.Column(10);
        box.CustomMinimumSize = new Vector2(560, 0);
        bool finished = session.Run.Phase == RunPhase.Finished;
        bool won = finished
            ? RunRules.RunWinner(session.Run, session.Content) == session.PlayerSide
            : session.Run.History.LastOrDefault()?.Winner == session.PlayerSide;
        center.AddChild(Ui.Panel(box, won ? Palette.HpGood : Palette.HpLow));

        if (finished) RunOver(box, session, won, toMenu, newRun);
        else MatchOver(box, session, won);
        return dim;
    }

    private static Label Centered(Label label)
    {
        label.HorizontalAlignment = HorizontalAlignment.Center;
        return label;
    }

    private static Control Score(RunSession session)
    {
        var row = Ui.Row(10);
        row.Alignment = BoxContainer.AlignmentMode.Center;
        row.AddChild(Ui.Text($"{session.Run.Wins.Of(session.PlayerSide)}", 40, Palette.Ours));
        row.AddChild(Ui.Dim(":", 40));
        row.AddChild(Ui.Text($"{session.Run.Wins.Of(session.EnemySide)}", 40, Palette.Theirs));
        return row;
    }

    private static void MatchOver(VBoxContainer box, RunSession session, bool won)
    {
        var run = session.Run;
        var last = run.History.LastOrDefault();
        box.AddChild(Centered(Ui.Dim(Texts.MatchTitle(last?.Match ?? run.Match), 14)));
        box.AddChild(Centered(Ui.Text(won ? Texts.MatchOver.Won : Texts.MatchOver.Lost, 30, won ? Palette.HpGood : Palette.HpLow)));
        if (last is not null) box.AddChild(Centered(Ui.Text($"{Texts.VictoryText(last.Reason, won)} · {Texts.RoundsText(last.Rounds)}", 15)));
        box.AddChild(Score(session));

        int level = RunRules.HeroLevel(run);
        box.AddChild(Ui.Text($"{Texts.MatchOver.LevelUp} {level + 1}", 16));
        foreach (var hero in DraftRules.TeamOf(run.Draft, session.PlayerSide))
        {
            var now = Levels.StatsAtLevel(hero, level, session.Content);
            var next = Levels.StatsAtLevel(hero, level + 1, session.Content);
            var row = Ui.Row(8);
            row.AddChild(new ClassBadge(session.Content.GetClass(hero.ClassId), 26));
            row.AddChild(Ui.Text(hero.Name, 14, Palette.Ours));
            var grown = HeroGenerator.StatNames.Where(s => next.Get(s) != now.Get(s))
                .Select(s => $"{Texts.StatName(s)} {Texts.StatValue(s, now.Get(s))} → {Texts.StatValue(s, next.Get(s))}");
            row.AddChild(Ui.Text(string.Join("   ", grown), 13, Palette.TextSoft, wrap: true));
            box.AddChild(row);
        }
        box.AddChild(Ui.Dim(Texts.MatchOver.Healed));

        var buttons = Ui.Row(10);
        buttons.Alignment = BoxContainer.AlignmentMode.Center;
        buttons.AddChild(Ui.Button(Texts.MatchOver.Next, session.NextMatch, primary: true));
        box.AddChild(buttons);
    }

    private static void RunOver(VBoxContainer box, RunSession session, bool won, Action toMenu, Action? newRun)
    {
        var run = session.Run;
        box.AddChild(Centered(Ui.Text(won ? Texts.RunOver.Won : Texts.RunOver.Lost, 30, won ? Palette.HpGood : Palette.HpLow)));
        box.AddChild(Score(session));
        box.AddChild(Ui.Text(Texts.RunOver.History, 16));
        foreach (var match in run.History)
        {
            bool ours = match.Winner == session.PlayerSide;
            box.AddChild(Ui.Text(
                $"{Texts.MatchTitle(match.Match)}: {(ours ? Texts.Victory : Texts.Defeat)} · {Texts.RoundsText(match.Rounds)}",
                14,
                ours ? Palette.HpGood : Palette.HpLow));
        }
        box.AddChild(Ui.Dim($"{Texts.Seed}: {run.Seed}"));

        var buttons = Ui.Row(10);
        buttons.Alignment = BoxContainer.AlignmentMode.Center;
        if (newRun is not null) buttons.AddChild(Ui.Button(Texts.NewRun, newRun, primary: true));
        buttons.AddChild(Ui.Button(Texts.ToMenu, toMenu));
        box.AddChild(buttons);
    }
}
