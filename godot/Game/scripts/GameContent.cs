using Brawl.Core;
using Godot;

namespace Brawl.Game;

/// <summary>
/// The content, read once from res://content: the same JSON as the web game, copied in
/// at build time (see Game.csproj).
/// </summary>
public static class GameContent
{
    private static ContentRegistry? registry;
    private static Teams? teams;

    public static ContentRegistry Registry => registry ??= ContentLoader.Load(Read);

    public static Teams Teams => teams ??= ContentLoader.LoadTeams(Read);

    private static string Read(string path)
    {
        using var file = FileAccess.Open($"res://content/{path}", FileAccess.ModeFlags.Read)
            ?? throw new ContentException($"Cannot open res://content/{path}: {FileAccess.GetOpenError()}");
        return file.GetAsText();
    }
}
