namespace Brawl.Core;

/// <summary>Terrain properties, a port of arena/terrain.ts.</summary>
public static class Terrain
{
    private static (bool BlocksMovement, bool BlocksLos) Props(TerrainId terrain) => terrain switch
    {
        TerrainId.Rock => (true, true),
        // "Колонна": in the way of feet, not of arrows.
        TerrainId.Column => (true, false),
        TerrainId.Thicket => (false, true),
        TerrainId.Pit => (false, false),
        // "Возвышенность": ordinary ground to walk on; its bonus is in the modifiers.
        TerrainId.High => (false, false),
        // "Сужающаяся арена": the fallen edge.
        TerrainId.Collapse => (true, false),
        // "Стена льда": impassable, but you can see through it.
        TerrainId.Ice => (true, false),
        // "Дымовая завеса": walk through it, see nothing through it.
        TerrainId.Smoke => (false, true),
        // "Капкан": ordinary ground until an enemy steps in.
        TerrainId.Trap => (false, false),
        _ => throw new ArgumentOutOfRangeException(nameof(terrain)),
    };

    public static TerrainId? TerrainAt(Arena arena, Hex h) =>
        arena.Terrain.TryGetValue(h.Key, out var terrain) ? terrain : null;

    public static bool InBounds(Hex h, Arena arena)
    {
        var (col, row) = HexMath.AxialToOffset(h);
        return col >= 0 && col < arena.Cols && row >= 0 && row < arena.Rows;
    }

    public static bool BlocksMovement(Arena arena, Hex h) => TerrainAt(arena, h) is { } t && Props(t).BlocksMovement;

    /// <summary>Whether this hex stops a line of sight passing through it.</summary>
    public static bool BlocksLos(Arena arena, Hex h) => TerrainAt(arena, h) is { } t && Props(t).BlocksLos;

    public static bool IsPit(Arena arena, Hex h) => TerrainAt(arena, h) == TerrainId.Pit;

    public static bool IsHigh(Arena arena, Hex h) => TerrainAt(arena, h) == TerrainId.High;

    /// <summary>Every hex of the board, in a fixed column-major order.</summary>
    public static List<Hex> AllHexes(Arena arena)
    {
        var output = new List<Hex>();
        for (int col = 0; col < arena.Cols; col++)
            for (int row = 0; row < arena.Rows; row++)
                output.Add(HexMath.OffsetToAxial(col, row));
        return output;
    }

    public static Arena EmptyArena(Config config) =>
        new() { Cols = config.Arena.Cols, Rows = config.Arena.Rows, Terrain = OrderedMap<TerrainId>.Empty };
}

/// <summary>Arena modifiers: one rule set for a whole match. A port of arena/modifiers.ts.</summary>
public static class ArenaModifiers
{
    private static T? Find<T>(BattleState state, ContentRegistry content) where T : ArenaRules =>
        state.Modifiers.Select(id => content.ArenaModifiers.Get(id)?.Rules).OfType<T>().FirstOrDefault();

    /// <summary>"Шторм маны": extra turns every cooldown loses at the end of a turn.</summary>
    public static double CooldownBonus(BattleState state, ContentRegistry content) =>
        Find<ManaStormRules>(state, content)?.CooldownBonus ?? 0;

    /// <summary>"Шторм маны": what damage over time is multiplied by.</summary>
    public static double DotMultiplier(BattleState state, ContentRegistry content) =>
        Find<ManaStormRules>(state, content)?.DotMultiplier ?? 1;

    /// <summary>"Кровавая жатва": what every heal is multiplied by.</summary>
    public static double HealMultiplier(BattleState state, ContentRegistry content) =>
        Find<BloodHarvestRules>(state, content)?.HealMultiplier ?? 1;

    /// <summary>"Кровавая жатва": initiative a killer gains.</summary>
    public static double KillAtb(BattleState state, ContentRegistry content) =>
        Find<BloodHarvestRules>(state, content)?.KillAtb ?? 0;

    /// <summary>"Густой туман": how far anyone sees, or null.</summary>
    public static int? SightRange(BattleState state, ContentRegistry content) =>
        Find<FogRules>(state, content)?.SightRange;

    /// <summary>"Сужающаяся арена": damage for standing on a collapsed hex at the start of a turn.</summary>
    public static double CollapseDamage(BattleState state, ContentRegistry content) =>
        Find<ShrinkRules>(state, content)?.RingDamage ?? 0;

    /// <summary>How far a hex is from the edge: 0 for the outer ring.</summary>
    public static int RingOf(Hex h, Arena arena)
    {
        var (col, row) = HexMath.AxialToOffset(h);
        return Math.Min(Math.Min(col, row), Math.Min(arena.Cols - 1 - col, arena.Rows - 1 - row));
    }

    /// <summary>"Сужающаяся арена": the hexes that should have collapsed by this round and have not yet.</summary>
    public static List<Hex> HexesToCollapse(BattleState state, ContentRegistry content)
    {
        var shrink = Find<ShrinkRules>(state, content);
        if (shrink is null) return [];
        int innermost = (Math.Min(state.Arena.Cols, state.Arena.Rows) - 1) / 2;
        int rings = Math.Min(innermost, (int)Math.Floor((state.Round - 1) / (double)shrink.EveryRounds));
        return Terrain.AllHexes(state.Arena)
            .Where(h => RingOf(h, state.Arena) < rings && Terrain.TerrainAt(state.Arena, h) != TerrainId.Collapse)
            .ToList();
    }

    /// <summary>The centre of the board: where "Точка силы" and "Древний страж" stand.</summary>
    public static Hex CentreHex(Arena arena) => HexMath.OffsetToAxial(arena.Cols / 2, arena.Rows / 2);

    /// <summary>"Точка силы": the damage share whoever stands on the centre adds.</summary>
    public static double PointBonus(BattleState state, Hex at, ContentRegistry content)
    {
        var point = Find<PowerPointRules>(state, content);
        if (point is null) return 0;
        return at == CentreHex(state.Arena) ? point.DamageBonus : 0;
    }

    /// <summary>"Точка силы": rounds of holding that win, or null without the modifier.</summary>
    public static int? HoldToWin(BattleState state, ContentRegistry content) => Find<PowerPointRules>(state, content)?.HoldRounds;
}
