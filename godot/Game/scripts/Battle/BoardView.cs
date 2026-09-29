using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>What the board paints over the hexes: hex keys to tint, and whether the hovered hex is refused.</summary>
public sealed record BoardMarks(
    HashSet<string> Reach,
    HashSet<string> Targets,
    HashSet<string> Zone,
    bool ZoneFriendly,
    HashSet<string> Reachable,
    HashSet<string> Path,
    bool Illegal)
{
    public static BoardMarks None => new([], [], [], false, [], [], false);
}

/// <summary>
/// What a board shows and what its clicks do: a battle being played, or a line-up being
/// placed before one. Every mark comes from Brawl.Core through the source.
/// </summary>
public interface IBoardSource
{
    ContentRegistry Content { get; }
    /// <summary>The state whose arena and heroes are drawn.</summary>
    BattleState Battle { get; }
    /// <summary>Where the heroes are shown and at what health, which trails the real state while events play.</summary>
    Projection Display { get; }
    Side PlayerSide { get; }
    Hex? Hover { get; set; }
    BoardMarks Marks();
    void Click(Hex hex);
    /// <summary>Right click: let go of whatever is chosen.</summary>
    void Cancel();
}

/// <summary>
/// The board, drawn with _Draw: the Godot counterpart of src/ui/board. It draws the
/// shown state, which trails the real one while events play, and passes clicks on hexes
/// to its source. Reachability, targets and zones all come from Brawl.Core.
/// </summary>
public partial class BoardView : Control
{
    public const float HexSize = 35;
    private static readonly float Sqrt3 = Mathf.Sqrt(3);

    private IBoardSource? source;
    private Vector2 offset;

    public void Bind(IBoardSource value)
    {
        source = value;
        var arena = value.Battle.Arena;
        float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
        foreach (var h in Terrain.AllHexes(arena))
        {
            var p = HexToPixel(h);
            minX = Mathf.Min(minX, p.X - HexSize);
            maxX = Mathf.Max(maxX, p.X + HexSize);
            minY = Mathf.Min(minY, p.Y - Sqrt3 / 2 * HexSize);
            maxY = Mathf.Max(maxY, p.Y + Sqrt3 / 2 * HexSize);
        }
        const float pad = 8;
        offset = new Vector2(-minX + pad, -minY + pad);
        CustomMinimumSize = new Vector2(maxX - minX + pad * 2, maxY - minY + pad * 2);
        MouseFilter = MouseFilterEnum.Stop;
    }

    // --- geometry ------------------------------------------------------------------------

    private static Vector2 HexToPixel(Hex h) => new(HexSize * 1.5f * h.Q, HexSize * Sqrt3 * (h.R + h.Q / 2f));

    private Vector2 Centre(Hex h) => HexToPixel(h) + offset;

    private Vector2[] Corners(Hex h, float inset = 0)
    {
        var c = Centre(h);
        var points = new Vector2[6];
        for (int i = 0; i < 6; i++)
        {
            float angle = Mathf.DegToRad(60 * i);
            points[i] = c + new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * (HexSize - inset);
        }
        return points;
    }

    private Hex? HexAt(Vector2 local)
    {
        if (source is null) return null;
        var p = local - offset;
        double q = 2.0 / 3 * p.X / HexSize;
        double r = (-1.0 / 3 * p.X + Math.Sqrt(3) / 3 * p.Y) / HexSize;
        double s = -q - r;
        double rq = Math.Round(q), rr = Math.Round(r), rs = Math.Round(s);
        double dq = Math.Abs(rq - q), dr = Math.Abs(rr - r), ds = Math.Abs(rs - s);
        if (dq > dr && dq > ds) rq = -rr - rs;
        else if (dr > ds) rr = -rq - rs;
        var hex = new Hex((int)rq, (int)rr);
        return Terrain.InBounds(hex, source.Battle.Arena) ? hex : null;
    }

    // --- input ---------------------------------------------------------------------------

    public override void _GuiInput(InputEvent @event)
    {
        if (source is null) return;
        if (@event is InputEventMouseMotion motion)
        {
            source.Hover = HexAt(motion.Position);
        }
        else if (@event is InputEventMouseButton { Pressed: true } click)
        {
            var hex = HexAt(click.Position);
            if (click.ButtonIndex == MouseButton.Right) source.Cancel();
            else if (click.ButtonIndex == MouseButton.Left && hex is not null) source.Click(hex.Value);
            AcceptEvent();
        }
    }

    public override void _Process(double delta) => QueueRedraw();

    // --- drawing -------------------------------------------------------------------------

    public override void _Draw()
    {
        if (source is null) return;
        var s = source;
        var battle = s.Battle;
        var arena = battle.Arena;
        double now = Time.GetTicksMsec();
        var hl = s.Marks();

        foreach (var hex in Terrain.AllHexes(arena))
        {
            string key = hex.Key;
            var fill = (hex.Q + hex.R) % 2 == 0 ? Palette.HexFill : Palette.HexFillAlt;
            if (hl.Reach.Contains(key)) fill = fill.Lerp(Palette.Reach, 0.35f);
            if (hl.Targets.Contains(key)) fill = fill.Lerp(Palette.Range, 0.5f);
            if (hl.Reachable.Contains(key)) fill = fill.Lerp(Palette.Reachable, 0.45f);
            if (hl.Zone.Contains(key)) fill = fill.Lerp(hl.ZoneFriendly ? Palette.ZoneAlly : Palette.Zone, 0.75f);
            if (hl.Path.Contains(key)) fill = fill.Lerp(Palette.Path, 0.7f);
            bool hovered = s.Hover == hex;
            if (hovered && hl.Illegal) fill = fill.Lerp(Palette.Illegal, 0.55f);

            var corners = Corners(hex);
            DrawColoredPolygon(corners, fill);
            DrawPolyline([.. corners, corners[0]], hovered ? Palette.HexHover : Palette.HexLine, hovered ? 3 : 1, true);
            if (Terrain.TerrainAt(arena, hex) is { } terrain) DrawTerrain(hex, terrain);
        }

        // "Точка силы": a golden ring round the centre hex.
        if (ArenaModifiers.HoldToWin(battle, s.Content) is not null)
        {
            var ring = Corners(ArenaModifiers.CentreHex(arena), 4);
            DrawPolyline([.. ring, ring[0]], Palette.PowerPoint, 4, true);
        }

        foreach (var (id, shown) in s.Display.Heroes) DrawHero(battle, id, shown, now);
        foreach (var effect in s.Display.Effects) DrawEffect(effect, now);
        foreach (var f in s.Display.Floats) DrawFloat(f, now);
    }

    private void DrawTerrain(Hex hex, TerrainId terrain)
    {
        var c = Centre(hex);
        switch (terrain)
        {
            case TerrainId.Rock:
                DrawColoredPolygon(Corners(hex, 9), Palette.Rock);
                break;
            case TerrainId.Column:
                DrawCircle(c, HexSize * 0.35f, Palette.Column);
                break;
            case TerrainId.Thicket:
                for (int i = 0; i < 3; i++)
                    DrawCircle(c + new Vector2(Mathf.Cos(i * 2.1f), Mathf.Sin(i * 2.1f)) * HexSize * 0.25f, HexSize * 0.3f, Palette.Thicket);
                break;
            case TerrainId.Pit:
                DrawColoredPolygon(Corners(hex, 12), Palette.Pit);
                break;
            case TerrainId.High:
                DrawPolyline([.. Corners(hex, 6), Corners(hex, 6)[0]], Palette.High, 3, true);
                break;
            case TerrainId.Collapse:
                DrawColoredPolygon(Corners(hex, 2), Palette.Collapse);
                break;
            case TerrainId.Ice:
                DrawColoredPolygon(Corners(hex, 8), Palette.Ice);
                break;
            case TerrainId.Smoke:
                DrawCircle(c, HexSize * 0.55f, Palette.Smoke);
                break;
            case TerrainId.Trap:
                DrawArc(c, HexSize * 0.35f, 0, Mathf.Tau, 24, Palette.Trap, 3, true);
                break;
        }
    }

    private Vector2 FigurePosition(DisplayHero shown, double now)
    {
        var to = Centre(shown.Hex);
        var at = to;
        if (shown.From is { } from && shown.WalkMs > 0)
        {
            float t = (float)Math.Clamp((now - shown.WalkAt) / shown.WalkMs, 0, 1);
            at = Centre(from).Lerp(to, t);
        }
        double hit = (now - shown.HitAt) / 260;
        if (hit >= 0 && hit < 1) at.X += (float)(Math.Sin(hit * Math.PI * 6) * 4 * (1 - hit));
        return at;
    }

    private void DrawHero(BattleState battle, string id, DisplayHero shown, double now)
    {
        var hero = battle.Heroes.Get(id);
        if (hero is null || shown.Hp <= 0) return;
        var c = FigurePosition(shown, now);
        var heroClass = source!.Content.GetClass(hero.ClassId);
        float radius = HexSize * (hero.Summon is null ? 0.58f : 0.45f);
        var ink = Palette.ClassColor(hero.ClassId);
        var side = Palette.SideColor(hero.Side, source.PlayerSide);

        DrawCircle(c, radius, new Color(ink, 0.35f));
        DrawArc(c, radius, 0, Mathf.Tau, 32, side, 5, true);
        DrawArc(c, radius - 4, 0, Mathf.Tau, 32, ink, 2, true);
        if (battle.ActiveHeroId == id) DrawArc(c, radius + 6, 0, Mathf.Tau, 32, Palette.Active, 3, true);

        var font = ThemeDB.FallbackFont;
        string letter = heroClass.Name[..1];
        DrawString(font, c + new Vector2(-radius, 7), letter, HorizontalAlignment.Center, radius * 2, 20, Palette.Text);

        float width = HexSize * 1.15f;
        float share = (float)Math.Max(0, shown.Hp / hero.Base.MaxHp);
        var bar = new Rect2(c.X - width / 2, c.Y + radius + 4, width, 6);
        DrawRect(bar, new Color(0, 0, 0, 0.75f));
        DrawRect(new Rect2(bar.Position, new Vector2(width * share, 6)), share > 0.35f ? Palette.HpGood : Palette.HpLow);
        DrawString(font, new Vector2(c.X - HexSize, c.Y + radius + 22), hero.Name, HorizontalAlignment.Center, HexSize * 2, 11, Palette.TextSoft);
    }

    private void DrawFloat(FloatingText f, double now)
    {
        double age = (now - f.BornAt) / Playback.FloatMs;
        if (age < 0 || age >= 1) return;
        var c = Centre(f.Hex);
        int size = f.Kind == FloatKind.Crit ? 24 : 18;
        var colour = Palette.FloatColor(f.Kind);
        colour.A = (float)(1 - age * age);
        var at = new Vector2(c.X - 60, c.Y - HexSize * 0.4f - (float)age * 26);
        DrawString(ThemeDB.FallbackFont, at, f.Text, HorizontalAlignment.Center, 120, size, colour);
    }

    private void DrawEffect(BoardEffect e, double now)
    {
        float t = (float)((now - e.BornAt) / e.Ms);
        if (t < 0 || t >= 1) return;
        var from = Centre(e.From);
        var to = Centre(e.Hex);
        var colour = Palette.EffectColor(e.Tone);
        float fade = 1 - t;
        switch (e.Kind)
        {
            case EffectKind.Bolt:
            {
                float head = t < 0.5f ? 2 * t * t : 1 - Mathf.Pow(-2 * t + 2, 2) / 2;
                var p = from.Lerp(to, head);
                DrawLine(from.Lerp(to, Mathf.Max(0, head - 0.25f)), p, new Color(colour, 0.55f), 4, true);
                DrawCircle(p, 11, new Color(colour, 0.3f));
                DrawCircle(p, 6, colour);
                break;
            }
            case EffectKind.Slash:
            {
                var dir = (to - from).Normalized();
                if (dir == Vector2.Zero) dir = Vector2.Right;
                var n = new Vector2(-dir.Y, dir.X);
                float r = HexSize * 0.75f;
                var start = to + n * r - dir * r * 0.35f;
                var end = to - n * r + dir * r * 0.35f;
                DrawLine(start, start.Lerp(end, Mathf.Min(1, t * 2.2f)), new Color(colour, Mathf.Min(1, fade * 1.6f)), 5 * fade + 1, true);
                break;
            }
            case EffectKind.Burst:
                DrawArc(to, HexSize * (0.3f + t * 0.9f), 0, Mathf.Tau, 32, new Color(colour, fade), 4 * fade + 1, true);
                break;
            case EffectKind.Hit:
            {
                var impact = Palette.ImpactColor(e.Tone);
                DrawCircle(to, HexSize * (e.Strong ? 0.8f : 0.6f), new Color(impact, 0.45f * fade));
                int sparks = e.Strong ? 8 : 5;
                for (int i = 0; i < sparks; i++)
                {
                    float angle = i / (float)sparks * Mathf.Tau + 0.4f;
                    var d = new Vector2(Mathf.Cos(angle), Mathf.Sin(angle));
                    float inner = HexSize * (0.25f + t * 0.5f);
                    DrawLine(to + d * inner, to + d * (inner + HexSize * (e.Strong ? 0.35f : 0.22f)), new Color(impact, fade), 2.5f, true);
                }
                break;
            }
            case EffectKind.Heal:
                DrawCircle(to, HexSize * 0.65f, new Color(colour, 0.22f * fade));
                for (int i = 0; i < 3; i++)
                {
                    var p = to + new Vector2((i - 1) * HexSize * 0.35f, HexSize * 0.2f - t * HexSize * (0.7f + i * 0.15f));
                    DrawLine(p - new Vector2(4, 0), p + new Vector2(4, 0), new Color(colour, fade), 2.5f);
                    DrawLine(p - new Vector2(0, 4), p + new Vector2(0, 4), new Color(colour, fade), 2.5f);
                }
                break;
            case EffectKind.Shield:
            {
                var ring = Corners(e.Hex, 5 + t * 4);
                DrawPolyline([.. ring, ring[0]], new Color(Palette.Shield, fade), 4 * fade + 1, true);
                break;
            }
            case EffectKind.Status:
                DrawArc(to, HexSize * (0.75f - t * 0.2f), 0, Mathf.Tau, 32, new Color(colour, fade * 0.9f), 3, true);
                break;
            case EffectKind.Death:
                DrawCircle(to, HexSize * (0.4f + t * 0.7f), new Color(Palette.Death, 0.35f * fade));
                break;
        }
    }
}
