namespace Brawl.Core;

/// <summary>
/// Seeded random numbers, a port of src/core/rng.ts (mulberry32). Pure: every call
/// takes a state and returns the value with the next state, so a battle replays bit for
/// bit from its seed. The arithmetic mirrors JavaScript's 32-bit integer operations
/// exactly, which is what makes a C# battle the same battle as a TypeScript one.
/// </summary>
public readonly record struct RngState(int S);

public static class Rng
{
    public static RngState Create(double seed) => new(JsMath.ToInt32(seed));

    /// <summary>Uniform in [0, 1).</summary>
    public static (double Value, RngState Next) NextFloat(RngState rng)
    {
        unchecked
        {
            int a = rng.S + 0x6d2b79f5;
            int t = (a ^ (int)((uint)a >> 15)) * (1 | a);
            t = (t + (t ^ (int)((uint)t >> 7)) * (61 | t)) ^ t;
            double value = (uint)(t ^ (int)((uint)t >> 14)) / 4294967296.0;
            return (value, new RngState(a));
        }
    }

    /// <summary>Uniform in [min, max).</summary>
    public static (double Value, RngState Next) NextFloatBetween(RngState rng, double min, double max)
    {
        var (v, next) = NextFloat(rng);
        return (min + v * (max - min), next);
    }

    /// <summary>Uniform integer in [min, maxInclusive].</summary>
    public static (int Value, RngState Next) NextInt(RngState rng, int min, int maxInclusive)
    {
        if (maxInclusive < min) throw new InvalidOperationException($"nextInt: empty range [{min}, {maxInclusive}]");
        var (v, next) = NextFloat(rng);
        int span = maxInclusive - min + 1;
        return (min + (int)Math.Floor(v * span), next);
    }

    /// <summary>True with probability p. p &lt;= 0 never fires, p &gt;= 1 always does.</summary>
    public static (bool Value, RngState Next) Chance(RngState rng, double p)
    {
        var (v, next) = NextFloat(rng);
        return (v < p, next);
    }

    public static (T Value, RngState Next) Pick<T>(RngState rng, IReadOnlyList<T> items)
    {
        if (items.Count == 0) throw new InvalidOperationException("pick: empty array");
        var (i, next) = NextInt(rng, 0, items.Count - 1);
        return (items[i], next);
    }

    /// <summary>Fisher-Yates on a copy; the input is never touched.</summary>
    public static (List<T> Value, RngState Next) Shuffle<T>(RngState rng, IReadOnlyList<T> items)
    {
        var output = items.ToList();
        var state = rng;
        for (int i = output.Count - 1; i > 0; i--)
        {
            var (j, next) = NextInt(state, 0, i);
            state = next;
            (output[i], output[j]) = (output[j], output[i]);
        }
        return (output, state);
    }
}
