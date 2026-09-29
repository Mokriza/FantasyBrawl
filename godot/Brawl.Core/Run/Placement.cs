namespace Brawl.Core;

/// <summary>
/// Levels between matches, a port of src/core/run/levels.ts. Every hero gains a level
/// after every match: Health, the primary stat and the secondaries grow by the class's
/// percentages. Each level multiplies the previous one, and the value is rounded once from
/// the level-1 number, so rounding never drifts.
/// </summary>
public static class Levels
{
    public static double GrowthOf(StatName stat, HeroTemplate hero, ContentRegistry content)
    {
        var heroClass = content.GetClass(hero.ClassId);
        var growth = heroClass.StatGrowth;
        // Health grows by its own rate even for classes that list it as a secondary.
        if (stat == StatName.MaxHp) return growth.Hp;
        if (stat == heroClass.PrimaryStat) return growth.Primary;
        if (heroClass.SecondaryStats.Contains(stat)) return growth.Secondary;
        return 0;
    }

    public static Stats StatsAtLevel(HeroTemplate hero, int level, ContentRegistry content)
    {
        int steps = Math.Max(0, level - 1);
        if (steps == 0) return hero.Stats;

        var output = hero.Stats.ToArray();
        foreach (var stat in HeroGenerator.StatNames)
        {
            double raw = hero.Stats.Get(stat) * Math.Pow(1 + GrowthOf(stat, hero, content), steps);
            output[(int)stat] = HeroGenerator.RoundStat(stat, raw);
        }
        return Stats.FromArray(output);
    }
}

/// <summary>
/// Placing heroes before a match, a port of src/core/run/placement.ts. Sides take turns
/// placing one hero at a time, in the order from config; the side owed compensation
/// places last, so it sees the whole enemy line before its final choice.
/// </summary>
public static class PlacementRules
{
    public static PlacementState CreatePlacement(Arena arena, ContentRegistry content) =>
        new() { Arena = arena, Order = content.Config.Draft.PlacementOrder, Placed = [] };

    /// <summary>Every hex of a side's start columns, top to bottom, column by column.</summary>
    public static List<Hex> StartZone(Config config, Side side)
    {
        var columns = side == Side.A ? config.Arena.StartColumnsA : config.Arena.StartColumnsB;
        var output = new List<Hex>();
        foreach (int col in columns)
            for (int row = 0; row < config.Arena.Rows; row++) output.Add(HexMath.OffsetToAxial(col, row));
        return output;
    }

    public static Side? PlacementTurn(PlacementState placement) =>
        placement.Placed.Count < placement.Order.Count ? placement.Order[placement.Placed.Count] : null;

    public static bool IsPlaced(PlacementState placement, string id) => placement.Placed.Any(p => p.HeroId == id);

    /// <summary>Free start-zone hexes a side may put a hero on: nobody starts inside a rock or a pit.</summary>
    public static List<Hex> LegalPlacementHexes(PlacementState placement, Side side, Config config)
    {
        var taken = placement.Placed.Select(p => p.Hex).ToHashSet();
        return StartZone(config, side)
            .Where(h => !taken.Contains(h) && !Terrain.BlocksMovement(placement.Arena, h) && !Terrain.IsPit(placement.Arena, h))
            .ToList();
    }

    public static PlacementState ApplyPlace(
        PlacementState placement, IReadOnlyList<string> team, Side side, string id, Hex hex, Config config)
    {
        var turn = PlacementTurn(placement) ?? throw new IllegalActionException($"place {id}: everyone is placed");
        if (turn != side) throw new IllegalActionException($"place {id}: it is {turn}'s turn to place");
        if (!team.Contains(id)) throw new IllegalActionException($"place {id}: not a hero of side {side}");
        if (IsPlaced(placement, id)) throw new IllegalActionException($"place {id}: already placed");
        if (!LegalPlacementHexes(placement, side, config).Contains(hex))
            throw new IllegalActionException($"place {id}: hex {hex.Key} is not a free start hex of {side}");

        return placement with { Placed = [.. placement.Placed, new PlacedHero(side, id, hex)] };
    }
}
