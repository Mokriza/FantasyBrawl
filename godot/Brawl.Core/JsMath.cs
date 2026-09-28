namespace Brawl.Core;

/// <summary>
/// JavaScript's number semantics where C# differs. The TypeScript core is the reference:
/// a C# battle must come out the same to the last hit point, so rounding and 32-bit
/// conversion follow the ECMAScript rules, not .NET's.
/// </summary>
public static class JsMath
{
    /// <summary>
    /// Math.round: halves go towards +∞ (2.5 → 3, −2.5 → −2). .NET's Math.Round rounds
    /// halves to even by default, which would change damage numbers.
    /// </summary>
    public static double Round(double x)
    {
        if (double.IsNaN(x) || double.IsInfinity(x)) return x;
        double floor = Math.Floor(x);
        return x - floor >= 0.5 ? floor + 1 : floor;
    }

    /// <summary>The ToInt32 conversion behind `x | 0`: truncate, then wrap modulo 2^32.</summary>
    public static int ToInt32(double x)
    {
        if (double.IsNaN(x) || double.IsInfinity(x)) return 0;
        double truncated = Math.Truncate(x);
        double wrapped = truncated % 4294967296.0;
        if (wrapped < 0) wrapped += 4294967296.0;
        return unchecked((int)(uint)wrapped);
    }
}
