using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The board in 3D: KayKit hex tiles and models (assets/board3d.json) under a camera that
/// turns round the arena and zooms. It shows the same source as the 2D board did, and
/// passes clicks on hexes back to it; every mark comes from Brawl.Core through the
/// source. Health bars, names and floating numbers are drawn flat on top (Board3DOverlay),
/// so they stay sharp and readable from any angle.
///
/// Mouse: left click — the same as on the 2D board; right drag — turn the camera; right
/// click without a drag — cancel; wheel — zoom.
/// </summary>
public partial class Board3D : Control
{
    private IBoardSource? source;
    private readonly SubViewportContainer frame = new() { Stretch = true, MouseFilter = MouseFilterEnum.Ignore };
    private readonly SubViewport viewport = new() { OwnWorld3D = true, Msaa3D = Viewport.Msaa.Msaa4X };
    private readonly Node3D world = new();
    private readonly Camera3D camera = new() { Fov = 40 };
    private readonly Node3D ground = new();
    private readonly Node3D marksLayer = new();
    private readonly Node3D figuresLayer = new();
    private readonly Effects3D effects = new();
    private readonly Board3DOverlay overlay = new();

    private Arena? builtArena;
    private readonly Dictionary<string, (MeshInstance3D Mesh, StandardMaterial3D Material)> marks = [];
    private readonly Dictionary<string, Figure3D> figures = [];
    private readonly Dictionary<string, double> seenHits = [];
    private readonly Dictionary<string, Vector3> lastSpot = [];
    private MeshInstance3D? hoverRing;
    private MeshInstance3D? powerRing;

    private Vector3 focus;
    /// <summary>The middle of the arena: the camera's home, which it leans away from towards the action.</summary>
    private Vector3 home;
    /// <summary>How far the camera leans from the middle of the arena towards what is happening, 0 to 1.</summary>
    private const float Lean = 0.35f;
    private float yaw;
    private float pitch = Mathf.DegToRad(44);
    private float distance = 24;
    private bool turning;
    private Vector2 turnFrom;
    private bool turned;

    /// <summary>The camera shakes for this long after a hard hit, see Shake.</summary>
    private double shakeUntil;
    private float shakeStrength;

    public IBoardSource? Source => source;

    public void Bind(IBoardSource value)
    {
        source = value;
        SizeFlagsHorizontal = SizeFlags.ExpandFill;
        SizeFlagsVertical = SizeFlags.ExpandFill;
        CustomMinimumSize = new Vector2(480, 380);
        MouseFilter = MouseFilterEnum.Stop;

        var centres = Terrain.AllHexes(value.Battle.Arena).Select(h => HexSpace.Centre(h)).ToList();
        focus = new Vector3(centres.Average(c => c.X), 0, centres.Average(c => c.Z));
        home = focus;
        // Far enough back that the whole arena is in view at the start; the wheel zooms in.
        float across = centres.Max(c => Mathf.Max(Mathf.Abs(c.X - focus.X), Mathf.Abs(c.Z - focus.Z))) + HexSpace.Radius;
        distance = across / Mathf.Tan(Mathf.DegToRad(camera.Fov / 2)) * 0.92f;
        // The player's side is the near side: A starts on the left (low q), B on the right.
        yaw = value.PlayerSide == Side.A ? -Mathf.Pi / 2 : Mathf.Pi / 2;
    }

    public override void _Ready()
    {
        frame.SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(frame);
        frame.AddChild(viewport);
        viewport.AddChild(world);
        overlay.SetAnchorsPreset(LayoutPreset.FullRect);
        overlay.MouseFilter = MouseFilterEnum.Ignore;
        overlay.Board = this;
        AddChild(overlay);

        world.AddChild(Environment());
        var sun = new DirectionalLight3D
        {
            RotationDegrees = new Vector3(-55, -35, 0),
            LightEnergy = 0.9f,
            ShadowEnabled = true,
            DirectionalShadowMaxDistance = 60,
        };
        world.AddChild(sun);
        world.AddChild(camera);
        world.AddChild(ground);
        world.AddChild(marksLayer);
        world.AddChild(figuresLayer);
        world.AddChild(effects);
        effects.Board = this;

        // Far below everything: what a collapsed hex opens onto.
        var abyss = new MeshInstance3D
        {
            Mesh = new PlaneMesh { Size = new Vector2(30, 30) },
            Position = new Vector3(focus.X, -8, focus.Z),
            MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color(0.02f, 0.02f, 0.03f), ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded },
        };
        world.AddChild(abyss);

        hoverRing = new MeshInstance3D { Mesh = HexSpace.Ring(HexSpace.Radius * 0.98f, HexSpace.Radius * 0.86f), Visible = false, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        hoverRing.MaterialOverride = HexSpace.Flat(Palette.HexHover, glow: true);
        marksLayer.AddChild(hoverRing);
    }

    private static WorldEnvironment Environment()
    {
        var sky = new Sky
        {
            SkyMaterial = new ProceduralSkyMaterial
            {
                SkyTopColor = new Color(0.32f, 0.5f, 0.78f),
                SkyHorizonColor = new Color(0.72f, 0.8f, 0.9f),
                GroundHorizonColor = new Color(0.2f, 0.3f, 0.18f),
                GroundBottomColor = new Color(0.2f, 0.3f, 0.18f),
            },
        };
        var env = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Sky,
            Sky = sky,
            AmbientLightSource = Godot.Environment.AmbientSource.Sky,
            AmbientLightEnergy = 0.45f,
            TonemapMode = Godot.Environment.ToneMapper.Filmic,
            SsaoEnabled = true,
            GlowEnabled = true,
            GlowIntensity = 0.35f,
        };
        return new WorldEnvironment { Environment = env };
    }

    // --- the arena -------------------------------------------------------------------------

    /// <summary>How far a hex's top sits above the ground: raised for Возвышенность, sunk for a pit.</summary>
    public float Lift(Hex h)
    {
        if (source is null) return 0;
        var t = Terrain.TerrainAt(source.Battle.Arena, h);
        return t is null ? 0 : Art3D.Terrain(TerrainName(t.Value))?.Lift ?? 0;
    }

    /// <summary>A point on top of a hex, where a hero stands.</summary>
    public Vector3 Top(Hex h) => HexSpace.Centre(h, Lift(h));

    private static string TerrainName(TerrainId t) => t switch
    {
        TerrainId.Rock => "rock",
        TerrainId.Column => "column",
        TerrainId.Thicket => "thicket",
        TerrainId.Pit => "pit",
        TerrainId.High => "high",
        TerrainId.Collapse => "collapse",
        TerrainId.Ice => "ice",
        TerrainId.Smoke => "smoke",
        TerrainId.Trap => "trap",
        _ => t.ToString().ToLowerInvariant(),
    };

    private void BuildArena(BattleState battle)
    {
        builtArena = battle.Arena;
        foreach (var child in ground.GetChildren()) child.QueueFree();
        foreach (var (_, m) in marks) m.Mesh.QueueFree();
        marks.Clear();

        var arena = battle.Arena;
        var inside = Terrain.AllHexes(arena);
        var keys = inside.Select(h => h.Key).ToHashSet();
        foreach (var hex in inside) BuildHex(battle, hex);

        // The land round the arena: plain tiles with trees and hills, deterministic per hex.
        var scenery = Art3D.Scenery;
        var around = new HashSet<string>();
        var ring = new List<Hex>(inside);
        for (int step = 0; step < scenery.Rings; step++)
        {
            var next = new List<Hex>();
            foreach (var h in ring)
                foreach (var d in HexMath.Directions)
                {
                    var n = h + d;
                    if (keys.Contains(n.Key) || !around.Add(n.Key)) continue;
                    next.Add(n);
                    var tile = Tile(n, 0);
                    if (tile is not null)
                    {
                        if (Art3D.ParseTint(scenery.Tint) is { } shade) Art3D.Tint(tile, shade);
                        ground.AddChild(tile);
                    }
                    int pick = HexSpace.Pick(n, 7);
                    if (pick % 1000 < scenery.EmptyShare * 1000 || scenery.Models.Count == 0) continue;
                    if (Art3D.Spawn(scenery.Models[pick % scenery.Models.Count]) is { } deco)
                    {
                        deco.Position = HexSpace.Centre(n);
                        deco.RotationDegrees = new Vector3(0, pick % 6 * 60, 0);
                        ground.AddChild(deco);
                    }
                }
            ring = next;
        }

        foreach (var hex in inside)
        {
            var material = HexSpace.Flat(new Color(0, 0, 0, 0));
            var mesh = new MeshInstance3D
            {
                Mesh = HexSpace.Plate(HexSpace.Radius * 0.94f),
                MaterialOverride = material,
                Position = HexSpace.Centre(hex, Lift(hex) + 0.025f),
                CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                Visible = false,
            };
            marksLayer.AddChild(mesh);
            marks[hex.Key] = (mesh, material);
        }

        powerRing?.QueueFree();
        powerRing = null;
        if (source is not null && ArenaModifiers.HoldToWin(battle, source.Content) is not null)
        {
            var centre = ArenaModifiers.CentreHex(arena);
            powerRing = new MeshInstance3D { Mesh = HexSpace.Ring(HexSpace.Radius * 0.95f, HexSpace.Radius * 0.8f), Position = HexSpace.Centre(centre, Lift(centre) + 0.04f), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
            powerRing.MaterialOverride = HexSpace.Flat(Palette.PowerPoint, glow: true);
            marksLayer.AddChild(powerRing);
        }
    }

    private Node3D? Tile(Hex hex, float lift)
    {
        var tile = Art3D.Spawn(Art3D.Tile.Model);
        if (tile is null) return null;
        tile.Position = HexSpace.Centre(hex, lift);
        tile.RotationDegrees = new Vector3(0, Art3D.Tile.Turn, 0);
        // A raised hex is a taller column: the tile model is one unit deep.
        if (lift > 0) tile.Scale = new Vector3(1, 1 + lift, 1);
        if (Art3D.ParseTint(Art3D.Tile.Tint) is { } tint) Art3D.Tint(tile, tint);
        return tile;
    }

    private void BuildHex(BattleState battle, Hex hex)
    {
        var terrain = Terrain.TerrainAt(battle.Arena, hex);
        var art = terrain is null ? null : Art3D.Terrain(TerrainName(terrain.Value));
        float lift = art?.Lift ?? 0;
        if (terrain != TerrainId.Collapse && Tile(hex, lift) is { } tile) ground.AddChild(tile);
        if (terrain is null) return;

        var top = HexSpace.Centre(hex, lift);
        if (art is { Models.Count: > 0 })
        {
            var choice = art.Models[HexSpace.Pick(hex) % art.Models.Count];
            if (Art3D.Spawn(choice.Model) is { } model)
            {
                model.Position = top;
                model.Scale = Vector3.One * choice.Scale;
                model.RotationDegrees = new Vector3(0, HexSpace.Pick(hex, 3) % 6 * 60, 0);
                ground.AddChild(model);
            }
        }

        switch (terrain.Value)
        {
            case TerrainId.Ice:
            {
                var block = new MeshInstance3D
                {
                    Mesh = new CylinderMesh { TopRadius = HexSpace.Radius * 0.72f, BottomRadius = HexSpace.Radius * 0.8f, Height = 1.1f, RadialSegments = 6, Rings = 1 },
                    Position = top + new Vector3(0, 0.55f, 0),
                    RotationDegrees = new Vector3(0, 30, 0),
                    MaterialOverride = new StandardMaterial3D
                    {
                        AlbedoColor = new Color(0.75f, 0.92f, 1f, 0.62f),
                        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
                        Roughness = 0.08f,
                        Metallic = 0.1f,
                        EmissionEnabled = true,
                        Emission = new Color(0.35f, 0.6f, 0.8f),
                        EmissionEnergyMultiplier = 0.25f,
                    },
                };
                ground.AddChild(block);
                break;
            }
            case TerrainId.Smoke:
            {
                var puff = new StandardMaterial3D
                {
                    AlbedoColor = new Color(0.75f, 0.77f, 0.8f, 0.55f),
                    Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
                    ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
                };
                for (int i = 0; i < 5; i++)
                {
                    float a = i * 1.26f + HexSpace.Pick(hex) % 7;
                    var ball = new MeshInstance3D
                    {
                        Mesh = new SphereMesh { Radius = 0.42f, Height = 0.7f, RadialSegments = 16, Rings = 8 },
                        Position = top + new Vector3(Mathf.Cos(a) * 0.4f, 0.4f + i % 2 * 0.3f, Mathf.Sin(a) * 0.4f),
                        MaterialOverride = puff,
                        CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                    };
                    ground.AddChild(ball);
                }
                break;
            }
            case TerrainId.Trap:
            {
                // The trap's owner shows as a ring in the owner's side colour.
                var owner = battle.TemporaryTerrain.FirstOrDefault(t => t.Hex == hex && t.Terrain == TerrainId.Trap)?.OwnerId;
                var side = owner is null ? null : battle.Heroes.Get(owner)?.Side;
                if (side is { } s && source is not null)
                {
                    var ring = new MeshInstance3D { Mesh = HexSpace.Circle(HexSpace.Radius * 0.62f, HexSpace.Radius * 0.52f), Position = top + new Vector3(0, 0.03f, 0), CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
                    ring.MaterialOverride = HexSpace.Flat(Palette.SideColor(s, source.PlayerSide), glow: true);
                    ground.AddChild(ring);
                }
                break;
            }
        }
    }

    // --- every frame -----------------------------------------------------------------------

    public override void _Process(double delta)
    {
        if (source is null) return;
        var battle = source.Battle;
        if (!ReferenceEquals(battle.Arena, builtArena)) BuildArena(battle);
        double now = Time.GetTicksMsec();

        LeanTowardsAction(battle, delta);
        PlaceCamera(now);
        PaintMarks();
        MoveFigures(battle, now);
        StartCasting();
        effects.Show(source.Display.Effects, now);
        overlay.QueueRedraw();
    }

    /// <summary>
    /// The camera drifts a little towards what is happening — the hero whose turn it is, or
    /// the middle of a cast between caster and target — so a move reads without hunting
    /// for it, while the whole arena stays in view.
    /// </summary>
    private void LeanTowardsAction(BattleState battle, double delta)
    {
        if (source is null) return;
        Vector3? action = null;
        if (source.Display.Casting is { } cast) action = (Top(cast.From) + Top(cast.Target)) / 2;
        else if (battle.ActiveHeroId is { } id && lastSpot.TryGetValue(id, out var spot)) action = spot;
        var goal = action is { } a ? home.Lerp(new Vector3(a.X, 0, a.Z), Lean) : home;
        focus = focus.Lerp(goal, 1 - Mathf.Exp(-2.5f * (float)delta));
    }

    private void PlaceCamera(double now)
    {
        var offset = new Vector3(Mathf.Sin(yaw) * Mathf.Cos(pitch), Mathf.Sin(pitch), Mathf.Cos(yaw) * Mathf.Cos(pitch)) * distance;
        var shake = Vector3.Zero;
        if (now < shakeUntil)
        {
            float left = (float)((shakeUntil - now) / 260);
            shake = new Vector3(Mathf.Sin((float)now * 0.09f), Mathf.Sin((float)now * 0.13f + 1), 0) * shakeStrength * left;
        }
        camera.Position = focus + offset + shake;
        camera.LookAt(focus + shake * 0.5f, Vector3.Up);
    }

    /// <summary>A short jolt of the camera: a hard blow, a crit, an explosion.</summary>
    public void Shake(float strength)
    {
        double now = Time.GetTicksMsec();
        shakeStrength = Mathf.Max(strength, now < shakeUntil ? shakeStrength : 0);
        shakeUntil = now + 260;
    }

    private void PaintMarks()
    {
        if (source is null) return;
        var hl = source.Marks();
        foreach (var (key, (mesh, material)) in marks)
        {
            Color? colour = null;
            if (hl.Reach.Contains(key)) colour = new Color(Palette.Range, 0.22f);
            if (hl.Targets.Contains(key)) colour = new Color(Palette.Range, 0.5f);
            if (hl.Reachable.Contains(key)) colour = new Color(1f, 1f, 1f, 0.16f);
            if (hl.Zone.Contains(key)) colour = new Color(hl.ZoneFriendly ? Palette.ZoneAlly : Palette.Zone, 0.55f);
            if (hl.Path.Contains(key)) colour = new Color(1f, 0.92f, 0.55f, 0.6f);
            if (source.Hover is { } h && h.Key == key && hl.Illegal) colour = new Color(Palette.Illegal, 0.6f);
            mesh.Visible = colour is not null;
            if (colour is { } c) material.AlbedoColor = c;
        }
        if (hoverRing is not null)
        {
            hoverRing.Visible = source.Hover is not null;
            if (source.Hover is { } hover) hoverRing.Position = HexSpace.Centre(hover, Lift(hover) + 0.04f);
        }
    }

    private void MoveFigures(BattleState battle, double now)
    {
        if (source is null) return;
        foreach (var (id, shown) in source.Display.Heroes)
        {
            var hero = battle.Heroes.Get(id);
            if (hero is null) continue;
            if (!figures.TryGetValue(id, out var figure))
            {
                if (shown.Hp <= 0) continue;
                var art = Art3D.Hero(hero.ClassId);
                if (art is null) continue;
                figure = new Figure3D(art, Palette.SideColor(hero.Side, source.PlayerSide), hero.Summon is not null);
                figure.Facing = hero.Side == Side.A ? Mathf.Pi / 2 : -Mathf.Pi / 2;
                figures[id] = figure;
                figuresLayer.AddChild(figure);
                if (hero.Summon is not null) figure.Scale = Vector3.One * 0.85f;
            }

            var spot = Top(shown.Hex);
            bool running = false;
            if (shown.From is { } from && shown.WalkMs > 0)
            {
                float t = (float)Math.Clamp((now - shown.WalkAt) / shown.WalkMs, 0, 1);
                if (t < 1)
                {
                    var start = Top(from);
                    spot = start.Lerp(spot, t);
                    var dir = Top(shown.Hex) - start;
                    if (dir.LengthSquared() > 0.001f) figure.Facing = Mathf.Atan2(dir.X, dir.Z);
                    running = true;
                }
            }
            figure.Position = spot + figure.Offset(now);
            figure.Visible = !figure.Gone(now);
            lastSpot[id] = spot;

            if (shown.HitAt > double.NegativeInfinity && (!seenHits.TryGetValue(id, out var seen) || seen != shown.HitAt))
            {
                seenHits[id] = shown.HitAt;
                if (shown.Hp > 0) figure.Flinch();
                // Pushed back away from whoever cast the blow, when that is known.
                if (source.Display.Casting is { } blow && blow.From != shown.Hex)
                    figure.Knock(HexSpace.Centre(shown.Hex) - HexSpace.Centre(blow.From));
            }
            if (shown.Hp <= 0 && !figure.Dead) figure.Die();
            figure.Pose(running, battle.ActiveHeroId == id, now);
        }
    }

    private Casting? casting;

    /// <summary>
    /// When an ability starts playing out, its user turns to the target and swings its
    /// weapon or casts, by the style's delivery.
    /// </summary>
    private void StartCasting()
    {
        var now = source?.Display.Casting;
        if (ReferenceEquals(now, casting)) return;
        bool fresh = now is not null && (casting is null || now.From != casting.From || now.Style != casting.Style || now.Target != casting.Target);
        casting = now;
        if (!fresh || now is null || FigureAt(now.From) is not { } maker) return;
        if (now.Target != now.From)
        {
            var d = HexSpace.Centre(now.Target) - HexSpace.Centre(now.From);
            maker.Facing = Mathf.Atan2(d.X, d.Z);
        }
        switch (now.Style.Delivery)
        {
            case "swing" or "shoot":
                maker.Attack();
                break;
            case "move":
                break;
            default:
                maker.Cast();
                break;
        }
    }

    /// <summary>The hero standing on a hex as shown now, if any: who swings or casts an effect.</summary>
    public Figure3D? FigureAt(Hex hex)
    {
        if (source is null) return null;
        foreach (var (id, shown) in source.Display.Heroes)
            if (shown.Hp > 0 && shown.Hex == hex && figures.TryGetValue(id, out var f)) return f;
        return null;
    }

    /// <summary>Where a hero's head is on screen, for the bars and names drawn flat on top.</summary>
    public Vector2? ScreenPoint(Vector3 world)
    {
        if (camera.IsPositionBehind(world)) return null;
        var p = camera.UnprojectPosition(world);
        var scale = Size / (Vector2)viewport.Size;
        return p * scale;
    }

    public IEnumerable<(string Id, Vector3 At)> Spots() => lastSpot.Select(kv => (kv.Key, kv.Value));

    // --- input -----------------------------------------------------------------------------

    private Hex? HexUnder(Vector2 local)
    {
        if (source is null || viewport.Size.X == 0) return null;
        var p = local * ((Vector2)viewport.Size / Size);
        var origin = camera.ProjectRayOrigin(p);
        var dir = camera.ProjectRayNormal(p);
        if (Mathf.Abs(dir.Y) < 1e-4f) return null;
        // Raised and sunk hexes are tried at their own height first, then the ground.
        foreach (float y in new[] { 0.45f, 0f, -0.55f })
        {
            float t = (y - origin.Y) / dir.Y;
            if (t < 0) continue;
            var hex = HexSpace.At(origin + dir * t);
            if (Terrain.InBounds(hex, source.Battle.Arena) && Mathf.IsEqualApprox(Mathf.Max(Lift(hex), -0.55f), y)) return hex;
        }
        float ground = -origin.Y / dir.Y;
        var flat = HexSpace.At(origin + dir * ground);
        return Terrain.InBounds(flat, source.Battle.Arena) ? flat : null;
    }

    public override void _GuiInput(InputEvent @event)
    {
        if (source is null) return;
        switch (@event)
        {
            case InputEventMouseMotion motion:
                if (turning)
                {
                    var d = motion.Position - turnFrom;
                    if (d.Length() > 4) turned = true;
                    if (turned)
                    {
                        yaw -= motion.Relative.X * 0.008f;
                        pitch = Mathf.Clamp(pitch + motion.Relative.Y * 0.005f, Mathf.DegToRad(28), Mathf.DegToRad(80));
                    }
                }
                source.Hover = HexUnder(motion.Position);
                break;
            case InputEventMouseButton { ButtonIndex: MouseButton.WheelUp, Pressed: true }:
                distance = Mathf.Clamp(distance - 1.5f, 8, 40);
                AcceptEvent();
                break;
            case InputEventMouseButton { ButtonIndex: MouseButton.WheelDown, Pressed: true }:
                distance = Mathf.Clamp(distance + 1.5f, 8, 40);
                AcceptEvent();
                break;
            case InputEventMouseButton { ButtonIndex: MouseButton.Right } right:
                if (right.Pressed)
                {
                    turning = true;
                    turned = false;
                    turnFrom = right.Position;
                }
                else
                {
                    if (!turned) source.Cancel();
                    turning = false;
                }
                AcceptEvent();
                break;
            case InputEventMouseButton { ButtonIndex: MouseButton.Left, Pressed: true } left:
                if (HexUnder(left.Position) is { } hex) source.Click(hex);
                AcceptEvent();
                break;
        }
    }
}
