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
