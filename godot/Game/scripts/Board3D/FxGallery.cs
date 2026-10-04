using Brawl.Core;

namespace Brawl.Game;

/// <summary>
/// Every effect the 3D board draws, side by side on an empty arena and replayed every
/// couple of seconds, each labelled with its vfx.json name: for looking at and tuning
/// them (`-- --fxgallery`). Not part of the game.
/// </summary>
public sealed class FxGallery : IBoardSource
{
    private static readonly string[] Impacts =
    [
        "explosion", "thunder", "ice", "poison", "holy", "spark", "shadow", "blood", "cut", "cutDouble", "cutX",
        "wideSlash", "claw", "whirl", "heal", "buff", "shieldHoly", "shieldArcane", "arcaneCircle", "summon", "smoke", "blink",
    ];

    private static readonly string[] Shots = ["fireball", "arcaneBall", "holyBall", "shadowBall", "iceSpike", "arrow", "knife", "meteor"];

    private const double Period = 1200;

    public ContentRegistry Content { get; }
    public BattleState Battle { get; }
    public Side PlayerSide => Side.A;
    public Hex? Hover { get; set; }
    private Projection shown = new(new Dictionary<string, DisplayHero>(), [], []);
    private double cycle = double.NegativeInfinity;

    public FxGallery(ContentRegistry content, BattleState battle)
    {
        Content = content;
        // An empty field: no terrain, nobody on it.
        Battle = battle with
        {
            Arena = battle.Arena with { Terrain = OrderedMap<TerrainId>.Empty },
            Heroes = OrderedMap<BattleHero>.Empty,
        };
    }

    public Projection Display
    {
        get
        {
            double now = Godot.Time.GetTicksMsec();
            if (now - cycle >= Period)
            {
                cycle = now;
                shown = Build(now);
            }
            return shown;
        }
    }

    private Projection Build(double now)
    {
        var hexes = Terrain.AllHexes(Battle.Arena).OrderBy(h => h.R + h.Q / 2.0).ThenBy(h => h.Q).ToList();
        var effects = new List<BoardEffect>();
        var floats = new List<FloatingText>();
        int slot = 0;
        Hex Next()
        {
            var h = hexes[slot * 2 % hexes.Count];
            slot++;
            return h;
        }
        foreach (string name in Impacts)
        {
            var at = Next();
            double ms = Vfx.AnimationMs(name);
            effects.Add(new BoardEffect(EffectKind.Anim, EffectTone.Utility, at, at, now, Math.Min(1100, (ms > 0 ? ms : 500) * 1.6), false) { Anim = name });
            floats.Add(new FloatingText(at, name, FloatKind.Status, now));
        }
        foreach (string name in Shots)
        {
            var at = Next();
            var from = at + new Hex(-3, 1);
            effects.Add(new BoardEffect(EffectKind.Projectile, EffectTone.Magic, from, at, now, 900, false) { Sprite = name, Fall = name == "meteor" });
            floats.Add(new FloatingText(at, name, FloatKind.Status, now));
        }
        var bolt = Next();
        effects.Add(new BoardEffect(EffectKind.Lightning, EffectTone.Magic, bolt + new Hex(-2, 0), bolt, now, 700, false));
        floats.Add(new FloatingText(bolt, "lightning", FloatKind.Status, now));
        var smite = Next();
        effects.Add(new BoardEffect(EffectKind.Smite, EffectTone.Magic, smite, smite, now, 1100, false));
        floats.Add(new FloatingText(smite, "smite", FloatKind.Status, now));
        var beam = Next();
        effects.Add(new BoardEffect(EffectKind.Beam, EffectTone.Magic, beam, beam + new Hex(-2, 1), now, 900, false));
        floats.Add(new FloatingText(beam, "beam", FloatKind.Status, now));
        return new Projection(new Dictionary<string, DisplayHero>(), floats, effects);
    }

    public BoardMarks Marks() => BoardMarks.None;
    public void Click(Hex hex) { }
    public void Cancel() { }
}
