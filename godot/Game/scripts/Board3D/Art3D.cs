using System.Text.Json;
using System.Text.Json.Serialization;
using Godot;

namespace Brawl.Game;

/// <summary>A model and how big it stands on the board.</summary>
public sealed record ModelRef(string Model, float Scale = 1);

/// <summary>How one kind of terrain looks: its hex raised or sunk, and what stands on it.</summary>
public sealed record TerrainArt(float Lift, IReadOnlyList<ModelRef> Models);

/// <summary>How one class looks and moves. See assets/board3d.json.</summary>
public sealed record HeroArt(
    string Model,
    float Height,
    string Idle,
    string Attack,
    string Cast,
    IReadOnlyList<string>? Hide = null,
    string? Attach = null,
    string? Tint = null);

public sealed record TileArt(string Model, float Radius, float Turn, string? Tint = null);

public sealed record SceneryArt(int Rings, IReadOnlyList<string> Models, float EmptyShare, string? Tint = null);

public sealed record MoveNames(string Run, string Hit, string Death, string Cheer);

/// <summary>
/// The 3D board's art: assets/board3d.json read once, and the models it names loaded on
/// demand. Code holds no paths of its own, as on the web (docs/ai/ui-and-rendering.md).
/// </summary>
public static class Art3D
{
    private const string Root = "res://assets/kaykit/";

    private sealed record Manifest(
        TileArt Tile,
        SceneryArt Scenery,
        Dictionary<string, JsonElement> Terrain,
        Dictionary<string, JsonElement> Heroes,
        MoveNames Moves);

    private static Manifest? manifest;
    private static readonly Dictionary<string, PackedScene?> Scenes = [];

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static Manifest Data
    {
        get
        {
            if (manifest is not null) return manifest;
            using var file = FileAccess.Open("res://assets/board3d.json", FileAccess.ModeFlags.Read)
                ?? throw new InvalidOperationException($"Cannot open assets/board3d.json: {FileAccess.GetOpenError()}");
            manifest = JsonSerializer.Deserialize<Manifest>(file.GetAsText(), Json)
                ?? throw new InvalidOperationException("assets/board3d.json is empty");
            return manifest;
        }
    }

    public static TileArt Tile => Data.Tile;
    public static SceneryArt Scenery => Data.Scenery;
    public static MoveNames Moves => Data.Moves;

    public static TerrainArt? Terrain(string kind) =>
        Data.Terrain.TryGetValue(kind, out var e) ? e.Deserialize<TerrainArt>(Json) : null;

    public static HeroArt? Hero(string classId) =>
        Data.Heroes.TryGetValue(classId, out var e) ? e.Deserialize<HeroArt>(Json) : null;

    /// <summary>A fresh copy of a model, or null when the file is missing: the board then draws without it.</summary>
    public static Node3D? Spawn(string path)
    {
        if (!Scenes.TryGetValue(path, out var scene))
        {
            scene = ResourceLoader.Exists(Root + path) ? GD.Load<PackedScene>(Root + path) : null;
            if (scene is null) GD.PushWarning($"3D board: no model at {Root + path}");
            Scenes[path] = scene;
        }
        return scene?.Instantiate<Node3D>();
    }

    public static Color? ParseTint(string? tint) => tint is null ? null : Color.FromHtml(tint);

    private static readonly Dictionary<(Material, Color), Material> Tinted = [];

    /// <summary>
    /// Multiplies the colour of every mesh under a node. Copies of the same model share one
    /// tinted material, so a board of tiles stays a handful of materials, not hundreds.
    /// </summary>
    public static void Tint(Node root, Color tint)
    {
        foreach (var node in root.FindChildren("*", "MeshInstance3D", true, false))
        {
            if (node is not MeshInstance3D mesh || mesh.Mesh is null) continue;
            for (int i = 0; i < mesh.Mesh.GetSurfaceCount(); i++)
            {
                if (mesh.GetActiveMaterial(i) is not BaseMaterial3D original) continue;
                if (!Tinted.TryGetValue((original, tint), out var material))
                {
                    var copy = (BaseMaterial3D)original.Duplicate();
                    copy.AlbedoColor *= tint;
                    Tinted[(original, tint)] = material = copy;
                }
                mesh.SetSurfaceOverrideMaterial(i, material);
            }
        }
    }
}
