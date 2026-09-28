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
        var labels = OrderedMap<Label>.Empty.Set(hero.Hex.Key, new Label(0, [], [], []));

        bool changed = true;
        int guard = 0;
        while (changed && guard < state.Arena.Cols * state.Arena.Rows + 2)
        {
            changed = false;
            guard++;
            foreach (var (key, label) in labels.ToList())
            {
                var from = label.Path.Count == 0 ? hero.Hex : label.Path[^1];
                if (from.Key != key) continue;

                for (int dir = 0; dir < HexMath.Directions.Count; dir++)
                {
                    var to = from + HexMath.Directions[dir];
                    if (!IsPassable(state, to)) continue;

                    double cost = label.Cost + StepCost(state, content, to, hero);
                    if (cost > apBudget) continue;

                    var already = hero.ReactedThisTurn.Concat(label.Provokes).ToList();
                    var reacting = Opportunity.ReactorsForStep(state, hero, from, to, already, content).Select(e => e.Id);

                    var candidate = new Label(cost, [.. label.Path, to], [.. label.Provokes, .. reacting], [.. label.Dirs, dir]);
                    if (IsBetter(candidate, labels.Get(to.Key)))
                    {
                        labels = labels.Set(to.Key, candidate);
                        changed = true;
                    }
                }
            }
        }

        labels = labels.Remove(hero.Hex.Key);
        return OrderedMap<Reachable>.From(labels.Select(p => new KeyValuePair<string, Reachable>(p.Key, new Reachable(p.Value.Cost, p.Value.Path, p.Value.Provokes))));
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
