using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The playback's flourishes in 3D. Each BoardEffect gets a node when it appears and
/// loses it when it fades; the moment one appears, the hero who made it swings or casts,
/// turns to the target, and a hard blow shakes the camera.
/// </summary>
public partial class Effects3D : Node3D
{
    public Board3D? Board { get; set; }

    private sealed class Live
    {
        public required BoardEffect Effect;
        public required Node3D Node;
        public required StandardMaterial3D Material;
    }

    private readonly Dictionary<BoardEffect, Live> live = new(ReferenceEqualityComparer.Instance);

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
            Update(item, t);
        }
        foreach (var gone in live.Keys.Where(e => !present.Contains(e)).ToList())
        {
            live[gone].Node.QueueFree();
            live.Remove(gone);
        }
    }

    /// <summary>The moment an effect appears: who made it moves, the camera reacts.</summary>
    private void Begin(BoardEffect e)
    {
        if (Board is null) return;
        var maker = Board.FigureAt(e.From);
        if (maker is not null && e.From != e.Hex)
        {
            var d = HexSpace.Centre(e.Hex) - HexSpace.Centre(e.From);
            maker.Facing = Mathf.Atan2(d.X, d.Z);
        }
        switch (e.Kind)
        {
            case EffectKind.Slash:
            case EffectKind.Bolt:
                maker?.Attack();
                break;
            case EffectKind.Burst:
                maker?.Cast();
                break;
            case EffectKind.Hit:
                Board.Shake(e.Strong ? 0.28f : 0.07f);
                break;
        }
    }

    private Live Create(BoardEffect e)
    {
        var colour = Palette.EffectColor(e.Tone);
        var material = HexSpace.Flat(colour, glow: true);
        material.EmissionEnergyMultiplier = 2.2f;
        Mesh mesh = e.Kind switch
        {
            EffectKind.Bolt => new SphereMesh { Radius = 0.16f, Height = 0.32f, RadialSegments = 12, Rings = 6 },
            EffectKind.Hit => new SphereMesh { Radius = e.Strong ? 0.55f : 0.4f, Height = e.Strong ? 1.1f : 0.8f, RadialSegments = 16, Rings = 8 },
            EffectKind.Heal => new CylinderMesh { TopRadius = 0.5f, BottomRadius = 0.6f, Height = 1.6f, RadialSegments = 16, Rings = 1 },
            EffectKind.Shield => new SphereMesh { Radius = 0.85f, Height = 1.7f, RadialSegments = 24, Rings = 12 },
            EffectKind.Death => new SphereMesh { Radius = 0.6f, Height = 1.2f, RadialSegments = 16, Rings = 8 },
            EffectKind.Slash => HexSpace.Circle(0.8f, 0.68f, 24),
            _ => HexSpace.Circle(0.75f, 0.62f),
        };
        if (e.Kind == EffectKind.Shield) material.AlbedoColor = new Color(Palette.Shield, 0.3f);
        if (e.Kind == EffectKind.Death) material.AlbedoColor = new Color(Palette.Death, 0.5f);
        if (e.Kind == EffectKind.Hit) material.AlbedoColor = new Color(Palette.ImpactColor(e.Tone), 0.6f);
        var node = new MeshInstance3D { Mesh = mesh, MaterialOverride = material, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        return new Live { Effect = e, Node = node, Material = material };
    }

    private void Update(Live item, float t)
    {
        if (Board is null) return;
        var e = item.Effect;
        var from = Board.Top(e.From) + Vector3.Up * 0.9f;
        var to = Board.Top(e.Hex) + Vector3.Up * 0.8f;
        float fade = 1 - t;
        var node = item.Node;
        var c = item.Material.AlbedoColor;
        switch (e.Kind)
        {
            case EffectKind.Bolt:
            {
                // A shot flies on an arc, higher the further it goes.
                float k = t < 0.5f ? 2 * t * t : 1 - Mathf.Pow(-2 * t + 2, 2) / 2;
                float arc = Mathf.Sin(k * Mathf.Pi) * from.DistanceTo(to) * 0.18f;
                node.Position = from.Lerp(to, k) + Vector3.Up * arc;
                break;
            }
            case EffectKind.Slash:
                node.Position = to;
                node.RotationDegrees = new Vector3(70, Mathf.RadToDeg(Mathf.Atan2(to.X - from.X, to.Z - from.Z)), 0);
                node.Scale = Vector3.One * (0.6f + t * 0.6f);
                item.Material.AlbedoColor = new Color(c, Mathf.Min(1, fade * 1.6f));
                break;
            case EffectKind.Hit:
                node.Position = to;
                node.Scale = Vector3.One * (0.4f + t * 0.9f);
                item.Material.AlbedoColor = new Color(c, 0.6f * fade);
                break;
            case EffectKind.Heal:
                node.Position = Board.Top(e.Hex) + Vector3.Up * (0.8f + t * 0.4f);
                item.Material.AlbedoColor = new Color(c, 0.35f * fade);
                break;
            case EffectKind.Shield:
                node.Position = Board.Top(e.Hex) + Vector3.Up * 0.75f;
                node.Scale = Vector3.One * (0.9f + t * 0.15f);
                item.Material.AlbedoColor = new Color(c, 0.3f * fade);
                break;
            case EffectKind.Death:
                node.Position = Board.Top(e.Hex) + Vector3.Up * (0.4f + t * 0.8f);
                node.Scale = Vector3.One * (0.6f + t);
                item.Material.AlbedoColor = new Color(c, 0.5f * fade);
                break;
            default:
                node.Position = Board.Top(e.Hex) + Vector3.Up * 0.05f;
                node.Scale = Vector3.One * (0.6f + t * 0.8f);
                item.Material.AlbedoColor = new Color(c, fade);
                break;
        }
    }
}
