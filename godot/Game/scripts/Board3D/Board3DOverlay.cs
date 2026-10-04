using Godot;

namespace Brawl.Game;

/// <summary>
/// What the 3D board draws flat over the picture: a health bar and a name over each hero,
/// and the floating numbers. Flat, so they stay readable at any camera angle.
/// </summary>
public partial class Board3DOverlay : Control
{
    public Board3D? Board { get; set; }

    public override void _Draw()
    {
        if (Board?.Source is not { } source) return;
        var battle = source.Battle;
        var font = ThemeDB.FallbackFont;
        double now = Time.GetTicksMsec();
        var spots = Board.Spots().ToDictionary(s => s.Id, s => s.At);

        foreach (var (id, shown) in source.Display.Heroes)
        {
            if (shown.Hp <= 0 || !spots.TryGetValue(id, out var at)) continue;
            var hero = battle.Heroes.Get(id);
            if (hero is null) continue;
            float height = (Art3D.Hero(hero.ClassId)?.Height ?? 1.4f) * (hero.Summon is null ? 1 : 0.85f);
            if (Board.ScreenPoint(at + Vector3.Up * (height + 0.25f)) is not { } p || !GetRect().HasPoint(p + Position)) continue;

            const float width = 46;
            float share = (float)Math.Max(0, shown.Hp / hero.Base.MaxHp);
            var bar = new Rect2(p.X - width / 2, p.Y - 6, width, 6);
            DrawRect(bar.Grow(1), new Color(0, 0, 0, 0.8f));
            DrawRect(new Rect2(bar.Position, new Vector2(width * share, 6)), share > 0.35f ? Palette.HpGood : Palette.HpLow);
            DrawRect(new Rect2(bar.Position.X, bar.Position.Y - 3, width, 2), Palette.SideColor(hero.Side, source.PlayerSide));
            var name = new Vector2(p.X - 60, p.Y - 12);
            DrawString(font, name + new Vector2(1, 1), hero.Name, HorizontalAlignment.Center, 120, 12, new Color(0, 0, 0, 0.8f));
            DrawString(font, name, hero.Name, HorizontalAlignment.Center, 120, 12, Palette.TextSoft);
        }

        foreach (var f in source.Display.Floats)
        {
            double age = (now - f.BornAt) / Playback.FloatMs;
            if (age < 0 || age >= 1) continue;
            if (Board.ScreenPoint(Board.Top(f.Hex) + Vector3.Up * (1.9f + (float)age * 0.8f)) is not { } p) continue;
            int size = f.Kind == FloatKind.Crit ? 28 : 20;
            var colour = Palette.FloatColor(f.Kind);
            colour.A = (float)(1 - age * age);
            var at = new Vector2(p.X - 70, p.Y);
            DrawString(font, at + new Vector2(2, 2), f.Text, HorizontalAlignment.Center, 140, size, new Color(0, 0, 0, colour.A * 0.8f));
            DrawString(font, at, f.Text, HorizontalAlignment.Center, 140, size, colour);
        }
    }
}
