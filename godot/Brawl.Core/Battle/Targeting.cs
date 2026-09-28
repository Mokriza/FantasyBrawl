namespace Brawl.Core;

public readonly record struct ShapeHit(Hex Hex, double Mul);

public sealed record ResolvedTarget(BattleHero Hero, double Mul);

/// <summary>Line of sight and targeting shapes, a port of battle/targeting.ts.</summary>
public static class Targeting
{
    /// <summary>Only the hexes between the two ends are checked; heroes never block sight.</summary>
    public static bool HasLineOfSight(BattleState state, Hex from, Hex to, ContentRegistry content)
    {
        // "Густой туман": past this distance nobody sees.
        var fog = ArenaModifiers.SightRange(state, content);
        if (fog is not null && HexMath.Distance(from, to) > fog) return false;
        var line = HexMath.HexLine(from, to);
        for (int i = 1; i < line.Count - 1; i++)
            if (Terrain.BlocksLos(state.Arena, line[i])) return false;
        return true;
    }

    private static ShapeFilter DefaultFilter(Ability ability) => ability.Targets switch
    {
        AbilityTargets.Enemy => ShapeFilter.Enemies,
        AbilityTargets.Ally or AbilityTargets.Self => ShapeFilter.Allies,
        _ => ShapeFilter.All,
    };

    public static ShapeFilter FilterOf(Ability ability)
    {
        ShapeFilter? filter = ability.Shape switch
        {
            SingleShape s => s.Filter,
            TargetPlusAdjacentShape s => s.Filter,
            BlobShape s => s.Filter,
            AuraShape s => s.Filter,
            LineShape s => s.Filter,
            ConeShape s => s.Filter,
            ChainShape s => s.Filter,
            _ => null,
        };
        return filter ?? DefaultFilter(ability);
    }

    private static bool MatchesFilter(BattleHero caster, BattleHero other, ShapeFilter filter)
    {
        if (filter == ShapeFilter.All) return true;
        bool sameSide = other.Side == caster.Side;
        return filter == ShapeFilter.Allies ? sameSide : !sameSide;
    }

    private static Comparison<BattleHero> ByDistanceThenId(Hex origin) => (a, b) =>
    {
        int da = HexMath.Distance(origin, a.Hex);
        int db = HexMath.Distance(origin, b.Hex);
        if (da != db) return da - db;
        return JsSort.Compare(a.Id, b.Id);
    };

    /// <summary>blob 3: the target hex plus the two neighbours closest to the caster.</summary>
    private static List<Hex> BlobHexes(Hex caster, Hex target, int size)
    {
        if (size == 1) return [target];
        if (size == 7) return [target, .. HexMath.Neighbors(target)];
        var wings = JsSort.Stable(
                HexMath.Neighbors(target).Select((h, index) => (H: h, Index: index, D: HexMath.Distance(caster, h))),
                (a, b) => a.D != b.D ? a.D - b.D : a.Index - b.Index)
            .Take(2)
            .Select(e => e.H);
        return [target, .. wings];
    }

    /// <summary>The hex in front, towards the target, and the two hexes flanking it one step further out.</summary>
    private static List<Hex> ConeHexes(Hex caster, Hex target)
    {
        if (caster == target) return [];
        var step = HexMath.NearestDirection(caster, target);
        int index = HexMath.Directions.ToList().IndexOf(step);
        var front = caster + step;
        var left = HexMath.Directions[(index + 5) % 6];
        var right = HexMath.Directions[(index + 1) % 6];
        return [front, front + left, front + right];
    }

    /// <summary>A straight run away from the caster; the target only picks the direction. Rock stops it.</summary>
    private static List<Hex> LineHexes(BattleState state, Hex caster, Hex target, int length)
    {
        if (caster == target) return [];
        var step = HexMath.NearestDirection(caster, target);
        var output = new List<Hex>();
        var current = caster;
        for (int i = 0; i < length; i++)
        {
            current += step;
            if (!Terrain.InBounds(current, state.Arena) || Terrain.BlocksMovement(state.Arena, current)) break;
            output.Add(current);
        }
        return output;
    }

    /// <summary>Target, then the nearest untouched victim within jumpRange of the previous one.</summary>
    private static List<ShapeHit> ChainHits(
        BattleState state, BattleHero caster, Hex target, int jumps, double falloff, int jumpRange, ShapeFilter filter, Func<BattleHero, bool> hidden)
    {
        var first = Query.HeroAt(state, target);
        if (first is null) return [];
        var hits = new List<ShapeHit> { new(target, 1) };
        var used = new HashSet<string> { first.Id };
        var from = first;
        for (int jump = 1; jump <= jumps; jump++)
        {
            var next = JsSort.Stable(
                    Query.LivingHeroes(state)
                        .Where(h => !used.Contains(h.Id) && MatchesFilter(caster, h, filter) && !hidden(h))
                        .Where(h => HexMath.Distance(from.Hex, h.Hex) <= jumpRange),
                    ByDistanceThenId(from.Hex))
                .FirstOrDefault();
            if (next is null) break;
            used.Add(next.Id);
            hits.Add(new ShapeHit(next.Hex, Math.Pow(1 - falloff, jump)));
            from = next;
        }
        return hits;
    }

    private static List<ShapeHit> ShapeHexes(BattleState state, BattleHero caster, Hex target, Shape shape, ShapeFilter filter, Func<BattleHero, bool> hidden)
    {
        static List<ShapeHit> Ones(IEnumerable<Hex> hexes) => hexes.Select(h => new ShapeHit(h, 1)).ToList();
        switch (shape)
        {
            case SingleShape:
                return [new ShapeHit(target, 1)];
            case TargetPlusAdjacentShape s:
            {
                var extra = JsSort.Stable(
                        HexMath.Neighbors(target)
                            .Select(h => Query.HeroAt(state, h))
                            .Where(h => h is not null && MatchesFilter(caster, h, filter))
                            .Select(h => h!),
                        ByDistanceThenId(target))
                    .Take(s.Count)
                    .Select(h => new ShapeHit(h.Hex, 1));
                return [new ShapeHit(target, 1), .. extra];
            }
            case BlobShape s:
                return Ones(BlobHexes(caster.Hex, target, s.Size));
            // Centred on the caster, never on the caster's own hex.
            case AuraShape s:
                return Ones(HexMath.HexesInRange(caster.Hex, s.Radius).Where(h => h != caster.Hex));
            case LineShape s:
                return Ones(LineHexes(state, caster.Hex, target, s.Length));
            case ConeShape:
                return Ones(ConeHexes(caster.Hex, target));
            case ChainShape s:
                return ChainHits(state, caster, target, s.Jumps, s.Falloff, s.JumpRange ?? 2, filter, hidden);
            case AllAlliesShape:
                return Ones(Query.AlliesOf(state, caster).Select(h => h.Hex));
            case AllEnemiesShape:
                return Ones(Query.EnemiesOf(state, caster).Select(h => h.Hex));
            default:
                throw new InvalidOperationException($"Unknown shape {shape.Type}");
        }
    }

    /// <summary>"Мантия архимага": a zone n steps bigger.</summary>
    private static Shape Grown(Shape shape, int n)
    {
        if (n <= 0) return shape;
        return shape switch
        {
            AuraShape s => s with { Radius = s.Radius + n },
            LineShape s => s with { Length = s.Length + n },
            ChainShape s => s with { Jumps = s.Jumps + n },
            BlobShape s => s.Size == 3 ? s with { Size = 7 } : s,
            _ => shape,
        };
    }

    /// <summary>Every hex an ability covers, deduplicated and clipped to the board.</summary>
    public static List<ShapeHit> ResolveShape(BattleState state, BattleHero caster, Hex target, Ability ability, ContentRegistry content)
    {
        var hits = ShapeHexes(
            state,
            caster,
            target,
            Grown(ability.Shape, Modifiers.ZoneGrowth(state, caster, content)),
            FilterOf(ability),
            h => Statuses.HiddenFrom(caster.Side, h, content));
        var seen = new HashSet<string>();
        var output = new List<ShapeHit>();
        foreach (var hit in hits)
        {
            if (seen.Contains(hit.Hex.Key) || !Terrain.InBounds(hit.Hex, state.Arena)) continue;
            seen.Add(hit.Hex.Key);
            output.Add(hit);
        }
        return output;
    }

    /// <summary>The heroes an ability actually lands on, after the shape filter.</summary>
    public static List<ResolvedTarget> ResolveTargets(BattleState state, BattleHero caster, Hex target, Ability ability, ContentRegistry content)
    {
        var filter = FilterOf(ability);
        var output = new List<ResolvedTarget>();
        foreach (var hit in ResolveShape(state, caster, target, ability, content))
        {
            var hero = Query.HeroAt(state, hit.Hex);
            if (hero is null) continue;
            // A self-targeted ability always reaches the caster, whatever the filter says.
            bool selfCast = ability.Targets == AbilityTargets.Self && hero.Id == caster.Id;
            if (!selfCast && !MatchesFilter(caster, hero, filter)) continue;
            output.Add(new ResolvedTarget(hero, hit.Mul));
        }
        return output;
    }
}
