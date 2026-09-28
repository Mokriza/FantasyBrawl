namespace Brawl.Core;

/// <summary>
/// Arena generation, a port of arena/generate.ts: obstacles and elevations, the centre
/// and both start zones clear, every obstacle in one half twinned in the other, and no
/// hex cut off from the rest. See docs/ai/hex-grid.md.
/// </summary>
public static class ArenaGenerator
{
    private static List<Hex> ProtectedCentre(int cols, int rows)
    {
        int col = cols / 2;
        int row = rows / 2;
        return [HexMath.OffsetToAxial(col, row - 1), HexMath.OffsetToAxial(col, row), HexMath.OffsetToAxial(col, row + 1)];
    }

    private static List<Hex> StartZone(Config config)
    {
        var output = new List<Hex>();
        foreach (int col in config.Arena.StartColumnsA.Concat(config.Arena.StartColumnsB))
            for (int row = 0; row < config.Arena.Rows; row++)
                output.Add(HexMath.OffsetToAxial(col, row));
        return output;
    }

    /// <summary>Flood fill over passable hexes; true when every passable hex is reachable.</summary>
    public static bool IsConnected(Arena arena)
    {
        var passable = Terrain.AllHexes(arena).Where(h => !Terrain.BlocksMovement(arena, h)).ToList();
        if (passable.Count == 0) return false;
        var first = passable[0];
        var seen = new HashSet<string> { first.Key };
        var queue = new List<Hex> { first };
        while (queue.Count > 0)
        {
            var current = queue[^1];
            queue.RemoveAt(queue.Count - 1);
            foreach (var n in HexMath.Neighbors(current))
            {
                if (seen.Contains(n.Key)) continue;
                if (!Terrain.InBounds(n, arena) || Terrain.BlocksMovement(arena, n)) continue;
                seen.Add(n.Key);
                queue.Add(n);
            }
        }
        return seen.Count == passable.Count;
    }

    private static readonly TerrainId[] Obstacles = [TerrainId.Rock, TerrainId.Column, TerrainId.Thicket, TerrainId.Pit];

    private static double Weight(TerrainWeights w, TerrainId kind) => kind switch
    {
        TerrainId.Rock => w.Rock,
        TerrainId.Column => w.Column,
        TerrainId.Thicket => w.Thicket,
        _ => w.Pit,
    };

    private static (TerrainId, RngState) PickTerrain(RngState rng, Config config)
    {
        var w = config.Arena.Weights;
        double total = Obstacles.Sum(kind => Weight(w, kind));
        var (roll, next) = Rng.NextInt(rng, 1, (int)total);
        double left = roll;
        foreach (var kind in Obstacles)
        {
            left -= Weight(w, kind);
            if (left <= 0) return (kind, next);
        }
        return (TerrainId.Rock, next);
    }

    /// <summary>One attempt's layout, before the connectivity check. Null when it fell short.</summary>
    private static (OrderedMap<TerrainId>? Terrain, RngState Rng) LayOut(RngState rng, Config config, HashSet<string> forbidden)
    {
        int cols = config.Arena.Cols, rows = config.Arena.Rows;
        int mid = cols / 2;
        var terrain = OrderedMap<TerrainId>.Empty;
        bool Free(Hex h) => !forbidden.Contains(h.Key) && !terrain.ContainsKey(h.Key);

        // A free hex of this column; the row of the original is avoided while any other is
        // free, so a twin never lands as an exact mirror image by chance.
        (Hex? Hex, RngState Rng) TwinIn(int col, RngState state, int? avoidRow = null)
        {
            var open = new List<Hex>();
            for (int row = 0; row < rows; row++)
            {
                var h = HexMath.OffsetToAxial(col, row);
                if (Free(h)) open.Add(h);
            }
            var elsewhere = open.Where(h => HexMath.AxialToOffset(h).Row != avoidRow).ToList();
            var choices = elsewhere.Count > 0 ? elsewhere : open;
            if (choices.Count == 0) return (null, state);
            var (picked, next) = Rng.Pick(state, choices);
            return (picked, next);
        }

        var state = rng;
        var (target, afterCount) = Rng.NextInt(state, config.Arena.Obstacles.Min, config.Arena.Obstacles.Max);
        state = afterCount;

        var own = Terrain.AllHexes(Terrain.EmptyArena(config)).Where(h => HexMath.AxialToOffset(h).Col <= mid && Free(h)).ToList();
        var (shuffled, afterShuffle) = Rng.Shuffle(state, own);
        state = afterShuffle;

        int count = 0;
        foreach (var h in shuffled)
        {
            if (count >= target) break;
            if (!Free(h)) continue;
            int col = HexMath.AxialToOffset(h).Col;
            int size = col == mid ? 1 : 2;
            if (count + size > target) continue;
            var (kind, afterKind) = PickTerrain(state, config);
            state = afterKind;
            if (col == mid)
            {
                terrain = terrain.Set(h.Key, kind);
            }
            else
            {
                terrain = terrain.Set(h.Key, kind);
                var (twin, afterTwin) = TwinIn(cols - 1 - col, state, HexMath.AxialToOffset(h).Row);
                state = afterTwin;
                if (twin is null)
                {
                    terrain = terrain.Remove(h.Key);
                    continue;
                }
                terrain = terrain.Set(twin.Value.Key, kind);
            }
            count += size;
        }
        if (count < config.Arena.Obstacles.Min) return (null, state);

        // Elevations: none, one on the centre column, or a twinned pair.
        var (highs, afterHighs) = Rng.NextInt(state, 0, config.Arena.High.MaxCount);
        state = afterHighs;
        if (highs == 1)
        {
            var (spot, afterSpot) = TwinIn(mid, state);
            state = afterSpot;
            if (spot is not null) terrain = terrain.Set(spot.Value.Key, TerrainId.High);
        }
        else if (highs >= 2)
        {
            var left = Terrain.AllHexes(Terrain.EmptyArena(config)).Where(h => HexMath.AxialToOffset(h).Col < mid && Free(h)).ToList();
            if (left.Count > 0)
            {
                var (first, afterFirst) = Rng.Pick(state, left);
                state = afterFirst;
                terrain = terrain.Set(first.Key, TerrainId.High);
                var (twin, afterTwin) = TwinIn(cols - 1 - HexMath.AxialToOffset(first).Col, state, HexMath.AxialToOffset(first).Row);
                state = afterTwin;
                terrain = twin is null ? terrain.Remove(first.Key) : terrain.Set(twin.Value.Key, TerrainId.High);
            }
        }
        return (terrain, state);
    }

    public static (Arena Arena, RngState Rng) Generate(RngState rng, Config config)
    {
        var forbidden = new HashSet<string>(ProtectedCentre(config.Arena.Cols, config.Arena.Rows).Concat(StartZone(config)).Select(h => h.Key));
        var state = rng;
        for (int attempt = 0; attempt < config.Arena.MaxGenerationAttempts; attempt++)
        {
            var (terrain, next) = LayOut(state, config, forbidden);
            state = next;
            if (terrain is null) continue;
            var arena = new Arena { Cols = config.Arena.Cols, Rows = config.Arena.Rows, Terrain = terrain };
            if (IsConnected(arena)) return (arena, state);
        }
        // Every attempt cut the board in two. An empty arena is always playable.
        return (Terrain.EmptyArena(config), state);
    }
}
