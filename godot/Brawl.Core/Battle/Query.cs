namespace Brawl.Core;

/// <summary>
/// JavaScript's ordering where it matters: Array.prototype.sort is stable and strings
/// compare by UTF-16 code units. List.Sort in .NET is neither stable nor ordinal by
/// default, so every sort of the port goes through here.
/// </summary>
public static class JsSort
{
    /// <summary>
    /// `[...items].sort(compare)` as V8 runs it. With a consistent comparison any stable
    /// sort gives the same order; with an inconsistent one the order is whatever V8's
    /// algorithm makes of it. The turn order once had such a comparison (fixed since), and
    /// the exact copy stays as a safety net. Arrays shorter than 64 are sorted by V8 exactly
    /// as below: the first run is found (and reversed if it descends), the rest is placed by
    /// binary insertion. Longer arrays go through a plain stable sort.
    /// </summary>
    public static List<T> Stable<T>(IEnumerable<T> items, Comparison<T> compare)
    {
        var a = items.ToList();
        int n = a.Count;
        if (n < 2) return a;
        if (n >= 64)
        {
            return a.Select((item, index) => (item, index))
                .OrderBy(pair => pair, Comparer<(T Item, int Index)>.Create((x, y) =>
                {
                    int c = compare(x.Item, y.Item);
                    return c != 0 ? c : x.Index.CompareTo(y.Index);
                }))
                .Select(pair => pair.item)
                .ToList();
        }

        // CountAndMakeRun (third_party/v8/builtins/array-sort.tq).
        int runLength = 2;
        bool descending = compare(a[1], a[0]) < 0;
        var previous = a[1];
        for (int i = 2; i < n; i++)
        {
            int order = compare(a[i], previous);
            if (descending ? order >= 0 : order < 0) break;
            previous = a[i];
            runLength++;
        }
        if (descending) a.Reverse(0, runLength);

        // BinaryInsertionSort from the end of the run.
        for (int start = runLength; start < n; start++)
        {
            var pivot = a[start];
            int left = 0, right = start;
            while (left < right)
            {
                int mid = left + ((right - left) >> 1);
                if (compare(pivot, a[mid]) < 0) right = mid;
                else left = mid + 1;
            }
            for (int p = start; p > left; p--) a[p] = a[p - 1];
            a[left] = pivot;
        }
        return a;
    }

    /// <summary>`a &lt; b` on two strings in JavaScript.</summary>
    public static bool Less(string a, string b) => string.CompareOrdinal(a, b) < 0;

    public static int Compare(string a, string b) => Math.Sign(string.CompareOrdinal(a, b));
}

/// <summary>Small read-only questions about a battle state, a port of battle/query.ts. No rules live here.</summary>
public static class Query
{
    public static BattleHero HeroById(BattleState state, string id) =>
        state.Heroes.Get(id) ?? throw new InvalidOperationException($"Unknown hero: {id}");

    /// <summary>Heroes in a fixed order (ids sorted), so every tie-break stays deterministic.</summary>
    public static List<BattleHero> AllHeroes(BattleState state) =>
        state.Heroes.Keys.OrderBy(k => k, StringComparer.Ordinal).Select(k => state.Heroes[k]).ToList();

    public static List<BattleHero> LivingHeroes(BattleState state) => AllHeroes(state).Where(h => h.IsAlive).ToList();

    public static List<BattleHero> HeroesOfSide(BattleState state, Side side) =>
        LivingHeroes(state).Where(h => h.Side == side).ToList();

    public static List<BattleHero> EnemiesOf(BattleState state, BattleHero hero) =>
        LivingHeroes(state).Where(h => h.Side != hero.Side).ToList();

    public static List<BattleHero> AlliesOf(BattleState state, BattleHero hero, bool includeSelf = true) =>
        LivingHeroes(state).Where(h => h.Side == hero.Side && (includeSelf || h.Id != hero.Id)).ToList();

    /// <summary>Dead heroes leave the board, so they occupy nothing.</summary>
    public static BattleHero? HeroAt(BattleState state, Hex h) => LivingHeroes(state).FirstOrDefault(hero => hero.Hex == h);

    public static bool IsOccupied(BattleState state, Hex h) => HeroAt(state, h) is not null;

    public static BattleState UpdateHero(BattleState state, string id, Func<BattleHero, BattleHero> change)
    {
        var hero = HeroById(state, id);
        return state with { Heroes = state.Heroes.Set(id, change(hero)) };
    }

    public static BattleHero? ActiveHero(BattleState state) =>
        state.ActiveHeroId is null ? null : HeroById(state, state.ActiveHeroId);
}
