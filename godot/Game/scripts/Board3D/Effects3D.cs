using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The playback's flourishes in 3D. Each BoardEffect gets a node when it appears and loses
/// it when it fades. Effects named by vfx.json (an impact, a projectile) are drawn here under
/// the same names: an explosion is fire and sparks and a flash of light, thunder a bolt from
/// the sky, a fireball flies trailing embers. A hard blow shakes the camera.
/// </summary>
public partial class Effects3D : Node3D
{
    public Board3D? Board { get; set; }

    /// <summary>An effect on the board: its node, and what moves it as time runs from 0 to 1.</summary>
    private sealed class Live
    {
        public required Node3D Node;
        public Action<float>? Step;
    }

    private readonly Dictionary<BoardEffect, Live> live = new(ReferenceEqualityComparer.Instance);
    private readonly RandomNumberGenerator jitter = new();

    public void Show(IReadOnlyList<BoardEffect> effects, double now)
    {
        if (Board is null) return;
        var present = new HashSet<BoardEffect>(ReferenceEqualityComparer.Instance);
        foreach (var e in effects)
        {
            float t = (float)((now - e.BornAt) / e.Ms);
            if (t < 0 || t >= 1) continue;
            present.Add(e);
            if (!live.TryGetValue(e, out var item))
            {
                item = Create(e);
                live[e] = item;
                AddChild(item.Node);
                Begin(e);
            }
            item.Step?.Invoke(t);
        }
        foreach (var gone in live.Keys.Where(e => !present.Contains(e)).ToList())
        {
            live[gone].Node.QueueFree();
            live.Remove(gone);
        }
    }

    /// <summary>The moment an effect appears: the camera reacts to the heavy ones.</summary>
    private void Begin(BoardEffect e)
    {
        if (Board is null) return;
        switch (e.Kind)
        {
            case EffectKind.Hit:
                Board.Shake(e.Strong ? 0.28f : 0.06f);
                break;
            case EffectKind.Anim when e.Anim is "explosion":
                Board.Shake(e.Strong ? 0.4f : 0.25f);
                break;
            case EffectKind.Anim when e.Anim is "thunder":
            case EffectKind.Smite:
                Board.Shake(0.18f);
                break;
            case EffectKind.Anim when e.Strong:
                Board.Shake(0.22f);
                break;
            // Without a style the effect itself says who swung or cast.
            case EffectKind.Slash or EffectKind.Bolt:
                Board.FigureAt(e.From)?.Attack();
                break;
            case EffectKind.Burst:
                Board.FigureAt(e.From)?.Cast();
                break;
        }
    }

    // --- building blocks ---------------------------------------------------------------------

    private static StandardMaterial3D Glow(Color colour, float energy = 2.5f, bool billboard = false) => new()
    {
        ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        AlbedoColor = colour,
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        EmissionEnabled = true,
        Emission = colour,
        EmissionEnergyMultiplier = energy,
        CullMode = BaseMaterial3D.CullModeEnum.Disabled,
        BillboardMode = billboard ? BaseMaterial3D.BillboardModeEnum.Particles : BaseMaterial3D.BillboardModeEnum.Disabled,
        VertexColorUseAsAlbedo = true,
    };

    /// <summary>A soft round spot, white in the middle and clear at the edge: one spark or ember.</summary>
    private static readonly GradientTexture2D Spot = new()
    {
        Width = 32,
        Height = 32,
        Fill = GradientTexture2D.FillEnum.Radial,
        FillFrom = new Vector2(0.5f, 0.5f),
        FillTo = new Vector2(1f, 0.5f),
        Gradient = new Gradient { Offsets = [0, 0.35f, 1], Colors = [Colors.White, new Color(1, 1, 1, 0.7f), new Color(1, 1, 1, 0)] },
    };

    /// <summary>
    /// Particles take their colour from the colour ramp, so their material must not glow
    /// on its own (an emission colour would paint every spark white).
    /// </summary>
    private static readonly StandardMaterial3D Dot = new()
    {
        ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        BlendMode = BaseMaterial3D.BlendModeEnum.Add,
        VertexColorUseAsAlbedo = true,
        AlbedoTexture = Spot,
        BillboardMode = BaseMaterial3D.BillboardModeEnum.Particles,
        CullMode = BaseMaterial3D.CullModeEnum.Disabled,
    };

    private static readonly StandardMaterial3D Solid = new()
    {
        ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        VertexColorUseAsAlbedo = true,
        CullMode = BaseMaterial3D.CullModeEnum.Disabled,
    };

    private static MeshInstance3D Shape(Mesh mesh, Material material) =>
        new() { Mesh = mesh, MaterialOverride = material, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };

    private static SphereMesh Ball(float radius) => new() { Radius = radius, Height = radius * 2, RadialSegments = 14, Rings = 7 };

    /// <summary>A one-off spray of glowing bits: sparks, embers, shards, bubbles.</summary>
    private static CpuParticles3D Burst(Color from, Color to, int amount, float speed, float lifetime, float size,
        Vector3? direction = null, float spread = 180, float gravity = -4, Mesh? mesh = null, bool oneShot = true)
    {
        var particles = new CpuParticles3D
        {
            Amount = amount,
            Lifetime = Mathf.Max(0.05f, lifetime),
            OneShot = oneShot,
            Explosiveness = oneShot ? 0.95f : 0,
            Direction = direction ?? Vector3.Up,
            Spread = spread,
            InitialVelocityMin = speed * 0.5f,
            InitialVelocityMax = speed,
            Gravity = new Vector3(0, gravity, 0),
            ScaleAmountMin = size * 0.6f,
            ScaleAmountMax = size,
            Mesh = mesh ?? new QuadMesh { Size = new Vector2(0.22f, 0.22f) },
            MaterialOverride = mesh is null ? Dot : Solid,
            Emitting = true,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
        };
        var ramp = new Gradient();
        ramp.SetColor(0, from);
        ramp.SetColor(1, new Color(to, 0));
        particles.ColorRamp = ramp;
        var shrink = new Curve();
        shrink.AddPoint(new Vector2(0, 1));
        shrink.AddPoint(new Vector2(1, 0.2f));
        particles.ScaleAmountCurve = shrink;
        return particles;
    }

    private static OmniLight3D Flash(Color colour, float energy, float range) =>
        new() { LightColor = colour, LightEnergy = energy, OmniRange = range, ShadowEnabled = false };

    // --- what each effect is -------------------------------------------------------------------

    private Live Create(BoardEffect e)
    {
        var root = new Node3D();
        var item = new Live { Node = root };
        if (Board is null) return item;
        float seconds = (float)(e.Ms / 1000);
        var from = Board.Top(e.From) + Vector3.Up * 0.9f;
        var at = Board.Top(e.Hex);
        var chest = at + Vector3.Up * 0.8f;

        switch (e.Kind)
        {
            case EffectKind.Anim:
                Impact(root, item, e.Anim ?? "", at, chest, seconds, e.Strong);
                break;
            case EffectKind.Projectile:
                Projectile(root, item, e, e.Fall ? chest + new Vector3(-2.5f, 9, 0) : from, chest, seconds);
                break;
            case EffectKind.Lightning:
                Lightning(root, item, from, chest, new Color(0.65f, 0.82f, 1f));
                break;
            case EffectKind.Smite:
                Column(root, item, at, new Color(1f, 0.9f, 0.55f), 0.55f);
                root.AddChild(At(Burst(new Color(1f, 0.95f, 0.7f), new Color(1f, 0.8f, 0.3f), 30, 4, seconds, 1.2f), chest));
                break;
            case EffectKind.Beam:
                Beam(root, item, from, Board.Top(e.Hex) + Vector3.Up * 0.9f, new Color(0.75f, 0.45f, 1f));
                break;
            case EffectKind.Weapon:
                // The figure swings its own weapon (see Board3D.Cast); only a whoosh trail here.
                if (e.Motion is "slash" or "smash") Slashes(root, item, chest + Vector3.Down * 0.2f, Board.Top(e.Hex) - Board.Top(e.From), 1, new Color(1, 1, 1));
                break;
            default:
                Plain(root, item, e, from, chest, at, seconds);
                break;
        }
        return item;
    }

    /// <summary>Where a blow lands, by the animation name vfx.json gives it.</summary>
    private void Impact(Node3D root, Live item, string name, Vector3 at, Vector3 chest, float seconds, bool strong)
    {
        float big = strong ? 1.35f : 1;
        switch (name)
        {
            case "explosion":
            {
                var core = Shape(Ball(0.5f * big), Glow(new Color(1f, 0.55f, 0.15f), 4));
                core.Position = chest;
                root.AddChild(core);
                var light = Flash(new Color(1f, 0.6f, 0.25f), 4, 5);
                light.Position = chest + Vector3.Up * 0.5f;
                root.AddChild(light);
                var sparks = Burst(new Color(1f, 0.9f, 0.4f), new Color(1f, 0.3f, 0.05f), 60, 6 * big, seconds, 1.4f * big);
                sparks.Position = chest;
                root.AddChild(sparks);
                var smoke = Burst(new Color(0.35f, 0.3f, 0.28f, 0.8f), new Color(0.2f, 0.2f, 0.2f), 14, 1.5f, seconds, 3.5f, gravity: 1.5f);
                smoke.Position = chest;
                root.AddChild(smoke);
                item.Step = t =>
                {
                    core.Scale = Vector3.One * (0.6f + t * 2.4f);
                    ((StandardMaterial3D)core.MaterialOverride).AlbedoColor = new Color(1f, 0.55f + t * 0.3f, 0.15f, 1 - t);
                    light.LightEnergy = 4 * (1 - t);
                };
                break;
            }
            case "thunder":
                Lightning(root, item, chest + new Vector3(0.6f, 9, 0.4f), chest, new Color(0.7f, 0.85f, 1f));
                root.AddChild(At(Burst(new Color(0.85f, 0.95f, 1f), new Color(0.4f, 0.6f, 1f), 30, 5, seconds, 1f), chest));
                break;
            case "ice":
            {
                var shard = new CylinderMesh { TopRadius = 0, BottomRadius = 0.09f, Height = 0.45f, RadialSegments = 4, Rings = 1 };
                root.AddChild(At(Burst(new Color(0.85f, 0.97f, 1f), new Color(0.5f, 0.8f, 1f), 16, 4, seconds, 1.4f, mesh: shard, gravity: -8), chest));
                root.AddChild(At(Burst(new Color(0.9f, 1f, 1f), new Color(0.6f, 0.85f, 1f), 30, 2.5f, seconds, 0.9f), chest));
                var light = Flash(new Color(0.6f, 0.85f, 1f), 3, 4);
                light.Position = chest;
                root.AddChild(light);
                item.Step = t => light.LightEnergy = 3 * (1 - t);
                break;
            }
            case "poison":
                root.AddChild(At(Burst(new Color(0.55f, 1f, 0.35f), new Color(0.25f, 0.7f, 0.15f), 26, 1.6f, seconds, 1.6f, gravity: 2.5f, mesh: Ball(0.07f)), at + Vector3.Up * 0.3f));
                Ring(root, item, at, new Color(0.45f, 0.95f, 0.3f), 0.5f, 1.1f);
                break;
            case "holy":
                Column(root, item, at, new Color(1f, 0.92f, 0.6f), 0.4f * big);
                root.AddChild(At(Burst(new Color(1f, 0.97f, 0.75f), new Color(1f, 0.82f, 0.35f), 26, 3, seconds, 1f), chest));
                break;
            case "spark":
                root.AddChild(At(Burst(new Color(0.75f, 0.85f, 1f), new Color(0.45f, 0.4f, 1f), 36, 5 * big, seconds, 1.1f), chest));
                AddFlash(root, item, chest, new Color(0.5f, 0.55f, 1f), 3);
                break;
            case "shadow":
            {
                root.AddChild(At(Burst(new Color(0.55f, 0.25f, 0.85f, 0.9f), new Color(0.15f, 0.05f, 0.25f), 30, 1.8f, seconds, 3f, gravity: 2), at + Vector3.Up * 0.4f));
                var orb = Shape(Ball(0.45f), Glow(new Color(0.45f, 0.15f, 0.7f), 2));
                orb.Position = chest;
                root.AddChild(orb);
                item.Step = t =>
                {
                    orb.Scale = Vector3.One * (1.2f - t);
                    ((StandardMaterial3D)orb.MaterialOverride).AlbedoColor = new Color(0.45f, 0.15f, 0.7f, 0.7f * (1 - t));
                };
                break;
            }
            case "blood":
                root.AddChild(At(Burst(new Color(1f, 0.25f, 0.2f), new Color(0.5f, 0.02f, 0.02f), 28, 4, seconds, 1f, gravity: -9, mesh: Ball(0.05f)), chest));
                break;
            case "cut":
                Slashes(root, item, chest, Vector3.Right, 1, new Color(1, 1, 1));
                break;
            case "cutDouble":
                Slashes(root, item, chest, Vector3.Right, 2, new Color(1, 1, 1));
                break;
            case "cutX":
            case "claw":
                Slashes(root, item, chest, Vector3.Right, name == "claw" ? 3 : 2, name == "claw" ? new Color(1f, 0.85f, 0.6f) : new Color(1, 1, 1), cross: name == "cutX");
                break;
            case "wideSlash":
                Slashes(root, item, chest, Vector3.Right, 1, new Color(1, 1, 0.9f), wide: true);
                break;
            case "whirl":
                Ring(root, item, at + Vector3.Up * 0.6f, new Color(1, 1, 1, 0.8f), 0.5f, HexSpace.Radius * 2.2f, spin: true);
                break;
            case "heal":
                root.AddChild(At(Burst(new Color(0.6f, 1f, 0.7f), new Color(0.3f, 0.9f, 0.5f), 24, 1.8f, seconds, 1.1f, gravity: 2.5f), at + Vector3.Up * 0.3f));
                Ring(root, item, at, new Color(0.45f, 1f, 0.6f), 0.4f, 0.9f);
                break;
            case "buff":
                root.AddChild(At(Burst(new Color(1f, 0.92f, 0.5f), new Color(1f, 0.6f, 0.2f), 24, 2.2f, seconds, 1f, gravity: 3), at + Vector3.Up * 0.2f));
                Ring(root, item, at, new Color(1f, 0.85f, 0.4f), 0.4f, 0.95f);
                break;
            case "shieldHoly":
            case "shieldArcane":
            {
                var colour = name == "shieldHoly" ? new Color(1f, 0.88f, 0.45f) : new Color(0.5f, 0.75f, 1f);
                var bubble = Shape(Ball(0.85f), Glow(new Color(colour, 0.3f), 1.2f));
                bubble.Position = at + Vector3.Up * 0.8f;
                root.AddChild(bubble);
                item.Step = t =>
                {
                    bubble.Scale = Vector3.One * (0.6f + Mathf.Min(1, t * 3) * 0.5f);
                    ((StandardMaterial3D)bubble.MaterialOverride).AlbedoColor = new Color(colour, 0.35f * (1 - t * t));
                };
                break;
            }
            case "arcaneCircle":
            case "summon":
            {
                var colour = name == "summon" ? new Color(1f, 0.55f, 0.2f) : new Color(0.55f, 0.6f, 1f);
                Ring(root, item, at, colour, 0.9f, 0.9f, spin: true, hold: true);
                Ring(root, item, at, colour, 0.6f, 0.6f, spin: true, hold: true);
                root.AddChild(At(Burst(colour.Lightened(0.4f), colour, 20, 1.5f, seconds, 0.8f, gravity: 3), at));
                break;
            }
            case "smoke":
                root.AddChild(At(Burst(new Color(0.8f, 0.82f, 0.85f, 0.8f), new Color(0.6f, 0.62f, 0.66f), 18, 1.5f, seconds, 4f, gravity: 0.5f), chest));
                break;
            case "blink":
                root.AddChild(At(Burst(new Color(0.65f, 0.85f, 1f), new Color(0.35f, 0.45f, 1f), 30, 3, seconds, 1.2f, gravity: 1), chest));
                AddFlash(root, item, chest, new Color(0.5f, 0.7f, 1f), 3);
                break;
            default:
                AddFlash(root, item, chest, Colors.White, 2);
                break;
        }
    }

    private static Node3D At(Node3D node, Vector3 where)
    {
        node.Position = where;
        return node;
    }

    private static void AddFlash(Node3D root, Live item, Vector3 at, Color colour, float energy)
    {
        var light = Flash(colour, energy, 4);
        light.Position = at;
        root.AddChild(light);
        var previous = item.Step;
        item.Step = t =>
        {
            previous?.Invoke(t);
            light.LightEnergy = energy * (1 - t);
        };
    }

    /// <summary>A flat ring on the ground that widens and fades, or turns in place.</summary>
    private static void Ring(Node3D root, Live item, Vector3 at, Color colour, float from, float to, bool spin = false, bool hold = false)
    {
        var ring = Shape(HexSpace.Circle(1, 0.88f, 48), Glow(colour, 2.5f));
        ring.Position = at + Vector3.Up * 0.05f;
        root.AddChild(ring);
        var previous = item.Step;
        item.Step = t =>
        {
            previous?.Invoke(t);
            float r = Mathf.Lerp(from, to, hold ? Mathf.Min(1, t * 4) : t);
            ring.Scale = new Vector3(r, 1, r);
            if (spin) ring.RotationDegrees = new Vector3(0, t * 240, 0);
            ((StandardMaterial3D)ring.MaterialOverride).AlbedoColor = new Color(colour, colour.A * (hold ? 1 - t * t : 1 - t));
        };
    }

    /// <summary>A column of light from the sky onto a hex, narrowing as it fades.</summary>
    private static void Column(Node3D root, Live item, Vector3 at, Color colour, float width)
    {
        const float height = 9;
        var column = Shape(new CylinderMesh { TopRadius = width, BottomRadius = width, Height = height, RadialSegments = 20, Rings = 1 }, Glow(new Color(colour, 0.5f), 3));
        column.Position = at + Vector3.Up * (height / 2);
        root.AddChild(column);
        var light = Flash(colour, 3.5f, 5);
        light.Position = at + Vector3.Up;
        root.AddChild(light);
        Ring(root, item, at, colour, 0.4f, 1.1f);
        var previous = item.Step;
        item.Step = t =>
        {
            previous?.Invoke(t);
            float w = 1 - t * 0.7f;
            column.Scale = new Vector3(w, 1, w);
            ((StandardMaterial3D)column.MaterialOverride).AlbedoColor = new Color(colour, 0.55f * (1 - t));
            light.LightEnergy = 3.5f * (1 - t);
        };
    }

    /// <summary>White crescent cuts across the target, one after another.</summary>
    private static void Slashes(Node3D root, Live item, Vector3 at, Vector3 along, int count, Color colour, bool cross = false, bool wide = false)
    {
        var cuts = new List<MeshInstance3D>();
        float yaw = Mathf.Atan2(along.X, along.Z);
        for (int i = 0; i < count; i++)
        {
            var arc = Shape(Crescent(wide ? 1.3f : 0.75f), Glow(colour, 3));
            arc.Position = at;
            float tilt = cross ? (i == 0 ? 45 : -45) : 20 + i * 25;
            arc.Rotation = new Vector3(0, yaw, 0);
            arc.RotateObjectLocal(Vector3.Forward, Mathf.DegToRad(tilt));
            root.AddChild(arc);
            cuts.Add(arc);
        }
        var previous = item.Step;
        item.Step = t =>
        {
            previous?.Invoke(t);
            for (int i = 0; i < cuts.Count; i++)
            {
                float local = Mathf.Clamp(t * (1 + cuts.Count * 0.3f) - i * 0.3f, 0, 1);
                cuts[i].Visible = local > 0 && local < 1;
                cuts[i].Scale = Vector3.One * (0.7f + local * 0.5f);
                ((StandardMaterial3D)cuts[i].MaterialOverride).AlbedoColor = new Color(colour, 1 - local);
            }
        };
    }

    /// <summary>A thin curved blade of light, standing upright, centred on the origin.</summary>
    private static ArrayMesh Crescent(float radius)
    {
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        const int segments = 16;
        for (int i = 0; i < segments; i++)
        {
            float a0 = Mathf.Lerp(-1.1f, 1.1f, i / (float)segments), a1 = Mathf.Lerp(-1.1f, 1.1f, (i + 1) / (float)segments);
            // Thickest in the middle, a point at each end.
            float w0 = 0.12f * Mathf.Sin((i / (float)segments) * Mathf.Pi), w1 = 0.12f * Mathf.Sin(((i + 1) / (float)segments) * Mathf.Pi);
            var o0 = new Vector3(Mathf.Sin(a0) * radius, Mathf.Cos(a0) * radius - radius * 0.6f, 0);
            var o1 = new Vector3(Mathf.Sin(a1) * radius, Mathf.Cos(a1) * radius - radius * 0.6f, 0);
            var i0 = new Vector3(Mathf.Sin(a0) * (radius - w0), Mathf.Cos(a0) * (radius - w0) - radius * 0.6f, 0);
            var i1 = new Vector3(Mathf.Sin(a1) * (radius - w1), Mathf.Cos(a1) * (radius - w1) - radius * 0.6f, 0);
            st.AddVertex(o0); st.AddVertex(o1); st.AddVertex(i1);
            st.AddVertex(o0); st.AddVertex(i1); st.AddVertex(i0);
        }
        return st.Commit();
    }

    /// <summary>A jagged bolt between two points that flickers into a new shape every few frames.</summary>
    private void Lightning(Node3D root, Live item, Vector3 from, Vector3 to, Color colour)
    {
        var bolt = new MeshInstance3D { CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, MaterialOverride = Glow(colour, 5) };
        root.AddChild(bolt);
        var light = Flash(colour, 4, 6);
        light.Position = to;
        root.AddChild(light);
        int shape = -1;
        var previous = item.Step;
        item.Step = t =>
        {
            previous?.Invoke(t);
            int now = (int)(Time.GetTicksMsec() / 50);
            if (now != shape)
            {
                shape = now;
                bolt.Mesh = BoltMesh(from, to, 0.07f);
            }
            ((StandardMaterial3D)bolt.MaterialOverride).AlbedoColor = new Color(colour, 1 - t * t);
            light.LightEnergy = 4 * (1 - t) * (0.7f + 0.3f * jitter.Randf());
        };
    }

    /// <summary>A zig-zag ribbon facing up and sideways, so it reads from any camera angle.</summary>
    private ArrayMesh BoltMesh(Vector3 from, Vector3 to, float width)
    {
        var dir = to - from;
        float length = dir.Length();
        int segments = Mathf.Max(4, (int)(length / 0.55f));
        var side = dir.Cross(Vector3.Up).Normalized();
        if (side.LengthSquared() < 0.01f) side = Vector3.Right;
        var up = side.Cross(dir).Normalized();
        var points = new List<Vector3> { from };
        for (int i = 1; i < segments; i++)
        {
            float f = i / (float)segments;
            points.Add(from + dir * f + side * jitter.RandfRange(-0.35f, 0.35f) + up * jitter.RandfRange(-0.35f, 0.35f));
        }
        points.Add(to);
        var st = new SurfaceTool();
        st.Begin(Mesh.PrimitiveType.Triangles);
        foreach (var offset in new[] { side * width, up * width })
            for (int i = 0; i < points.Count - 1; i++)
            {
                Vector3 a = points[i], b = points[i + 1];
                st.AddVertex(a - offset); st.AddVertex(b - offset); st.AddVertex(b + offset);
                st.AddVertex(a - offset); st.AddVertex(b + offset); st.AddVertex(a + offset);
            }
        return st.Commit();
    }

    /// <summary>Life drawn off the target: motes running back to the caster along a wavering line.</summary>
    private static void Beam(Node3D root, Live item, Vector3 from, Vector3 to, Color colour)
    {
        var motes = new List<MeshInstance3D>();
        var material = Glow(colour, 3);
        for (int i = 0; i < 10; i++)
        {
            var mote = Shape(Ball(0.09f), material);
            root.AddChild(mote);
            motes.Add(mote);
        }
        item.Step = t =>
        {
            for (int i = 0; i < motes.Count; i++)
            {
                float f = (t * 1.6f + i / (float)motes.Count) % 1;
                var p = from.Lerp(to, f);
                p += Vector3.Up * Mathf.Sin(f * Mathf.Pi) * 0.6f + Vector3.Up * Mathf.Sin(f * 12 + t * 20) * 0.08f;
                motes[i].Position = p;
            }
            material.AlbedoColor = new Color(colour, 1 - t);
        };
    }

    /// <summary>Something thrown or cast flying to the target, by the sprite name vfx.json gives it.</summary>
    private void Projectile(Node3D root, Live item, BoardEffect e, Vector3 from, Vector3 to, float seconds)
    {
        string sprite = e.Sprite ?? "";
        Node3D body;
        CpuParticles3D? trail = null;
        bool turns = false;
        float arc = 0.12f;
        switch (sprite)
        {
            case "arrow":
            case "knife":
            {
                // The models lie along +y, tip up; turned so the tip leads where LookAt points.
                var model = Art3D.Spawn(Art3D.Projectile(sprite) ?? "") ?? Shape(new CylinderMesh { TopRadius = 0.02f, BottomRadius = 0.02f, Height = 0.6f }, Glow(Colors.White, 1));
                model.RotationDegrees = new Vector3(90, 0, 0);
                model.Scale = Vector3.One * (sprite == "arrow" ? 1.1f : 0.8f);
                body = new Node3D();
                body.AddChild(model);
                turns = true;
                arc = sprite == "arrow" ? 0.22f : 0.08f;
                break;
            }
            case "iceSpike":
                body = new Node3D();
                body.AddChild(new MeshInstance3D
                {
                    Mesh = new CylinderMesh { TopRadius = 0, BottomRadius = 0.12f, Height = 0.7f, RadialSegments = 5, Rings = 1 },
                    MaterialOverride = Glow(new Color(0.75f, 0.92f, 1f), 2),
                    RotationDegrees = new Vector3(90, 0, 0),
                    CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                });
                turns = true;
                trail = Burst(new Color(0.85f, 0.97f, 1f), new Color(0.5f, 0.8f, 1f), 30, 0.3f, 0.35f, 0.7f, oneShot: false, gravity: -1);
                break;
            default:
            {
                var (colour, size) = sprite switch
                {
                    "fireball" => (new Color(1f, 0.5f, 0.12f), 0.32f),
                    "meteor" => (new Color(1f, 0.42f, 0.1f), 0.75f),
                    "holyBall" => (new Color(1f, 0.88f, 0.45f), 0.27f),
                    "shadowBall" => (new Color(0.62f, 0.3f, 0.95f), 0.32f),
                    _ => (new Color(0.5f, 0.65f, 1f), 0.27f),
                };
                var ball = new Node3D();
                ball.AddChild(Shape(Ball(size), Glow(colour, 4)));
                ball.AddChild(Shape(Ball(size * 1.7f), Glow(new Color(colour, 0.3f), 2)));
                ball.AddChild(Flash(colour, sprite == "meteor" ? 6 : 3, sprite == "meteor" ? 7 : 4));
                body = ball;
                trail = Burst(colour.Lightened(0.3f), colour.Darkened(0.4f), sprite == "meteor" ? 80 : 40, 0.4f, 0.4f, sprite == "meteor" ? 3f : 1.3f, oneShot: false, gravity: 0.5f);
                arc = sprite == "meteor" ? 0 : 0.1f;
                break;
            }
        }
        root.AddChild(body);
        if (trail is not null)
        {
            // The trail is left behind in the world, not dragged along with the ball.
            trail.LocalCoords = false;
            root.AddChild(trail);
        }
        float height = from.DistanceTo(to) * arc;
        item.Step = t =>
        {
            // Falling speeds up; a throw eases out and in.
            float k = e.Fall ? t * t : (t < 0.5f ? 2 * t * t : 1 - Mathf.Pow(-2 * t + 2, 2) / 2);
            var p = from.Lerp(to, k) + Vector3.Up * Mathf.Sin(k * Mathf.Pi) * height;
            if (turns)
            {
                float k2 = Mathf.Min(1, k + 0.02f);
                var ahead = from.Lerp(to, k2) + Vector3.Up * Mathf.Sin(k2 * Mathf.Pi) * height;
                if ((ahead - p).LengthSquared() > 1e-6f) body.LookAt(ahead, Vector3.Up, useModelFront: true);
            }
            body.Position = p;
            if (trail is not null) trail.Position = p;
        };
        // LookAt needs the node in the tree; place it once before the first frame.
        body.Position = from;
    }

    /// <summary>The plain flourishes, for anything without a style.</summary>
    private static void Plain(Node3D root, Live item, BoardEffect e, Vector3 from, Vector3 chest, Vector3 at, float seconds)
    {
        var colour = Palette.EffectColor(e.Tone);
        switch (e.Kind)
        {
            case EffectKind.Bolt:
            {
                var ball = Shape(Ball(0.16f), Glow(colour, 3));
                root.AddChild(ball);
                float height = from.DistanceTo(chest) * 0.15f;
                item.Step = t =>
                {
                    float k = t < 0.5f ? 2 * t * t : 1 - Mathf.Pow(-2 * t + 2, 2) / 2;
                    ball.Position = from.Lerp(chest, k) + Vector3.Up * Mathf.Sin(k * Mathf.Pi) * height;
                };
                break;
            }
            case EffectKind.Slash:
                Slashes(root, item, chest, chest - from, 1, colour);
                break;
            case EffectKind.Hit:
            {
                var impact = Palette.ImpactColor(e.Tone);
                var flash = Shape(Ball(e.Strong ? 0.5f : 0.35f), Glow(impact, 3));
                flash.Position = chest;
                root.AddChild(flash);
                root.AddChild(At(Burst(impact.Lightened(0.4f), impact, e.Strong ? 30 : 16, e.Strong ? 5 : 3.5f, seconds, 1f), chest));
                item.Step = t =>
                {
                    flash.Scale = Vector3.One * (0.5f + t);
                    ((StandardMaterial3D)flash.MaterialOverride).AlbedoColor = new Color(impact, 0.7f * (1 - t));
                };
                break;
            }
            case EffectKind.Heal:
                root.AddChild(At(Burst(new Color(0.6f, 1f, 0.7f), new Color(0.3f, 0.9f, 0.5f), 20, 1.8f, seconds, 1f, gravity: 2.5f), at + Vector3.Up * 0.3f));
                break;
            case EffectKind.Shield:
            {
                var bubble = Shape(Ball(0.85f), Glow(new Color(Palette.Shield, 0.3f), 1.2f));
                bubble.Position = at + Vector3.Up * 0.8f;
                root.AddChild(bubble);
                item.Step = t => ((StandardMaterial3D)bubble.MaterialOverride).AlbedoColor = new Color(Palette.Shield, 0.35f * (1 - t));
                break;
            }
            case EffectKind.Status:
                Ring(root, item, at, colour, 0.8f, 0.6f);
                break;
            case EffectKind.Burst:
                Ring(root, item, at, colour, 0.3f, 1.2f);
                break;
            case EffectKind.Death:
                root.AddChild(At(Burst(new Color(0.6f, 0.62f, 0.68f, 0.9f), new Color(0.3f, 0.3f, 0.35f), 20, 1.4f, seconds, 3f, gravity: 1.2f), at + Vector3.Up * 0.4f));
                break;
        }
    }
}
