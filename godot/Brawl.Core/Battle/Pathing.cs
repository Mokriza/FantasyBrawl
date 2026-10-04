namespace Brawl.Core;

/// <summary>A hex the hero can walk to: what it costs, the path, and who would swing along the way.</summary>
public sealed record Reachable(double Cost, IReadOnlyList<Hex> Path, IReadOnlyList<string> Provokes);

/// <summary>Reachable hexes and shortest paths, a port of battle/pathing.ts.</summary>
public static class Pathing
{
    private sealed record Label(double Cost, IReadOnlyList<Hex> Path, IReadOnlyList<string> Provokes, IReadOnlyList<int> Dirs);

    /// <summary>Cheapest first; then the path that gets hit least; then the shortest walk; then Directions order.</summary>
    private static bool IsBetter(Label candidate, Label? current)
    {
        if (current is null) return true;
        if (candidate.Cost != current.Cost) return candidate.Cost < current.Cost;
        if (candidate.Provokes.Count != current.Provokes.Count) return candidate.Provokes.Count < current.Provokes.Count;
        if (candidate.Path.Count != current.Path.Count) return candidate.Path.Count < current.Path.Count;
        for (int i = 0; i < candidate.Dirs.Count; i++)
        {
            int a = candidate.Dirs[i];
            int b = i < current.Dirs.Count ? current.Dirs[i] : 0;
            if (a != b) return a < b;
        }
        return false;
    }

    public static double StepCost(BattleState state, ContentRegistry content, Hex to, BattleHero? hero = null)
    {
        double baseCost = content.Config.Battle.MoveCost;
        bool surcharge = Terrain.IsPit(state.Arena, to) && (hero is null || !PitImmune(state, hero, content));
        return baseCost + (surcharge ? content.Config.Arena.Pit.ExtraApCost : 0);
    }

    /// <summary>"Босые ноги": a pit is ordinary ground to this hero.</summary>
    public static bool PitImmune(BattleState state, BattleHero hero, ContentRegistry content) =>
        Modifiers.Sum(state, hero, ModifierStat.PitImmune, content).Add > 0;

    public static bool IsPassable(BattleState state, Hex to) =>
        Terrain.InBounds(to, state.Arena) && !Terrain.BlocksMovement(state.Arena, to) && !Query.IsOccupied(state, to);

    /// <summary>
    /// Every hex the hero can afford to reach. The provoke set depends on the whole path,
    /// so labels are relaxed until nothing improves.
    /// </summary>
    public static OrderedMap<Reachable> ReachableHexes(BattleState state, BattleHero hero, double apBudget, ContentRegistry content)
    {
        // The labels behave exactly like the TypeScript record they port: a replaced key keeps
        // its place, a new one goes last, and each pass walks a snapshot in that order. Kept
        // in a local list with an index rather than an immutable map, which copied itself on
        // every new hex: the search runs thousands of times while the AI thinks.
        var keys = new List<string> { hero.Hex.Key };
        var values = new List<Label> { new(0, [], [], []) };
        var index = new Dictionary<string, int> { [hero.Hex.Key] = 0 };

        // Neither changes during the search: worked out once, not for every step.
        double baseCost = content.Config.Battle.MoveCost;
        double pitSurcharge = PitImmune(state, hero, content) ? 0 : content.Config.Arena.Pit.ExtraApCost;
        var potential = Opportunity.PotentialReactors(state, hero, content);

        bool changed = true;
        int guard = 0;
        while (changed && guard < state.Arena.Cols * state.Arena.Rows + 2)
        {
            changed = false;
            guard++;
            int count = keys.Count;
            var snapshotKeys = keys.ToArray();
            var snapshotValues = values.ToArray();
            for (int s = 0; s < count; s++)
            {
                var label = snapshotValues[s];
                var from = label.Path.Count == 0 ? hero.Hex : label.Path[^1];
                if (from.Key != snapshotKeys[s]) continue;

                for (int dir = 0; dir < HexMath.Directions.Count; dir++)
                {
                    var to = from + HexMath.Directions[dir];
                    if (!IsPassable(state, to)) continue;

                    double cost = label.Cost + baseCost + (Terrain.IsPit(state.Arena, to) ? pitSurcharge : 0);
                    if (cost > apBudget) continue;

                    var reacting = potential.Count == 0
                        ? []
                        : Opportunity.ReactingAmong(potential, from, to, hero.ReactedThisTurn.Concat(label.Provokes).ToList(), content).Select(e => e.Id);

                    var candidate = new Label(cost, [.. label.Path, to], [.. label.Provokes, .. reacting], [.. label.Dirs, dir]);
                    string toKey = to.Key;
                    bool known = index.TryGetValue(toKey, out int at);
                    if (IsBetter(candidate, known ? values[at] : null))
                    {
                        if (known) values[at] = candidate;
                        else
                        {
                            index[toKey] = keys.Count;
                            keys.Add(toKey);
                            values.Add(candidate);
                        }
                        changed = true;
                    }
                }
            }
        }

        var output = new List<KeyValuePair<string, Reachable>>(keys.Count);
        for (int i = 0; i < keys.Count; i++)
        {
            if (keys[i] == hero.Hex.Key) continue;
            var l = values[i];
            output.Add(new(keys[i], new Reachable(l.Cost, l.Path, l.Provokes)));
        }
        return OrderedMap<Reachable>.From(output);
    }

    /// <summary>Cost of a path the caller already has, or null when it is not walkable.</summary>
    public static double? PathCost(BattleState state, ContentRegistry content, Hex from, IReadOnlyList<Hex> path)
    {
        var current = from;
        double total = 0;
        foreach (var to in path)
        {
            bool adjacent = HexMath.Directions.Any(d => current + d == to);
            if (!adjacent || !IsPassable(state, to)) return null;
            total += StepCost(state, content, to);
            current = to;
        }
        return total;
    }
}
