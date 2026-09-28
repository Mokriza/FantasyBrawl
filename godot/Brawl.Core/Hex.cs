namespace Brawl.Core;

/// <summary>
/// An axial hex coordinate, a port of src/core/hex.ts. Flat-top hexes; the odd-q offset
/// rectangle exists only to lay out and draw the board. See docs/ai/hex-grid.md.
/// </summary>
public readonly record struct Hex(int Q, int R)
{
    /// <summary>The key hexes use in maps, as in TypeScript: "q,r".</summary>
    [System.Text.Json.Serialization.JsonIgnore]
    public string Key => $"{Q},{R}";

    public static Hex operator +(Hex a, Hex b) => new(a.Q + b.Q, a.R + b.R);
    public static Hex operator -(Hex a, Hex b) => new(a.Q - b.Q, a.R - b.R);

    public override string ToString() => Key;
}

public static class HexMath
{
    /// <summary>
    /// Clockwise from north-east. The order is fixed: several tie-breaks resolve by
    /// direction index, so changing it changes the game.
    /// </summary>
    public static readonly IReadOnlyList<Hex> Directions =
    [
        new(1, -1),
        new(1, 0),
        new(0, 1),
        new(-1, 1),
        new(-1, 0),
        new(0, -1),
    ];

    public static string HexKey(Hex h) => h.Key;

    public static Hex ParseHexKey(string key)
    {
        var parts = key.Split(',');
        if (parts.Length != 2 || !int.TryParse(parts[0], out int q) || !int.TryParse(parts[1], out int r))
            throw new FormatException($"parseHexKey: malformed key \"{key}\"");
        return new Hex(q, r);
    }

    /// <summary>All six neighbours, without bounds checking, in Directions order.</summary>
    public static List<Hex> Neighbors(Hex h) => Directions.Select(d => h + d).ToList();

    public static int Distance(Hex a, Hex b)
    {
        int dq = a.Q - b.Q;
        int dr = a.R - b.R;
        int ds = -dq - dr;
        return (Math.Abs(dq) + Math.Abs(dr) + Math.Abs(ds)) / 2;
    }

    public static bool AreAdjacent(Hex a, Hex b) => Distance(a, b) == 1;

    /// <summary>Every hex within n of the centre, the centre included.</summary>
    public static List<Hex> HexesInRange(Hex center, int n)
    {
        var output = new List<Hex>();
        for (int dq = -n; dq <= n; dq++)
        {
            int lo = Math.Max(-n, -dq - n);
            int hi = Math.Min(n, -dq + n);
            for (int dr = lo; dr <= hi; dr++) output.Add(new Hex(center.Q + dq, center.R + dr));
        }
        return output;
    }

    /// <summary>Hexes at exactly radius; radius 0 is the centre alone.</summary>
    public static List<Hex> Ring(Hex center, int radius)
    {
        if (radius < 0) throw new ArgumentOutOfRangeException(nameof(radius), $"ring: negative radius {radius}");
        if (radius == 0) return [center];
        var output = new List<Hex>();
        // Start on the direction-4 spoke so the walk comes out clockwise from north-east.
        var start = Directions[4];
        var current = center + new Hex(start.Q * radius, start.R * radius);
        for (int i = 0; i < 6; i++)
        {
            var step = Directions[i];
            for (int j = 0; j < radius; j++)
            {
                output.Add(current);
                current += step;
            }
        }
        return output;
    }

    // --- odd-q offset conversion ---------------------------------------------------

    public static Hex OffsetToAxial(int col, int row) => new(col, row - (col - (col & 1)) / 2);

    public static (int Col, int Row) AxialToOffset(Hex h) => (h.Q, h.R + (h.Q - (h.Q & 1)) / 2);

    // --- lines ---------------------------------------------------------------------

    /// <summary>
    /// One epsilon for the whole project. Its sign decides which way a line that runs
    /// exactly along an edge falls. Change it and every line of sight changes with it.
    /// </summary>
    private const double EpsQ = 1e-6, EpsR = 2e-6, EpsS = -3e-6;

    private static Hex CubeRound(double q, double r, double s)
    {
        double rq = JsMath.Round(q);
        double rr = JsMath.Round(r);
        double rs = JsMath.Round(s);
        double dq = Math.Abs(rq - q);
        double dr = Math.Abs(rr - r);
        double ds = Math.Abs(rs - s);
        // Recompute whichever coordinate was rounded the furthest, so q + r + s stays 0.
        if (dq > dr && dq > ds) rq = -rr - rs;
        else if (dr > ds) rr = -rq - rs;
        return new Hex((int)rq, (int)rr);
    }

    private static double Lerp(double a, double b, double t) => a + (b - a) * t;

    /// <summary>Inclusive of both ends; the length is always Distance(a, b) + 1.</summary>
    public static List<Hex> HexLine(Hex a, Hex b)
    {
        int n = Distance(a, b);
        if (n == 0) return [a];
        double aq = a.Q + EpsQ, ar = a.R + EpsR, As = -a.Q - a.R + EpsS;
        double bq = b.Q + EpsQ, br = b.R + EpsR, bs = -b.Q - b.R + EpsS;
        var output = new List<Hex>();
        for (int i = 0; i <= n; i++)
        {
            double t = (double)i / n;
            output.Add(CubeRound(Lerp(aq, bq, t), Lerp(ar, br, t), Lerp(As, bs, t)));
        }
        return output;
    }

    /// <summary>
    /// The direction from `from` towards `to`, snapped to one of the six. Ties go to the
    /// lower Directions index so that shapes stay deterministic.
    /// </summary>
    public static Hex NearestDirection(Hex from, Hex to)
    {
        var v = to - from;
        double len = Math.Max(1, Distance(from, to));
        double nq = v.Q / len;
        double nr = v.R / len;
        var best = Directions[0];
        double bestScore = double.NegativeInfinity;
        foreach (var d in Directions)
        {
            // Dot product in cube space; the third coordinate keeps the metric isotropic.
            double score = d.Q * nq + d.R * nr + (-d.Q - d.R) * (-nq - nr);
            if (score > bestScore)
            {
                bestScore = score;
                best = d;
            }
        }
        return best;
    }
}
