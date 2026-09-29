namespace Brawl.Core;

/// <summary>
/// Generating heroes on the point budget, a port of src/core/draft/generate.ts. See
/// docs/ai/game-rules.md section 10.
///
/// Every hero is born on the same budget, so there is no strongest one in the pool, only
/// the most convenient for a plan: an expensive ability is paid for with stats. The
/// passive and the tier IV ability are chosen later, between matches; their price is held
/// back from the budget now, as is the artifact's, so every hero costs the same from the start.
/// </summary>
public static class HeroGenerator
{
    /// <summary>The seven stats in the order the generator walks them (STAT_NAMES).</summary>
    public static readonly IReadOnlyList<StatName> StatNames =
        [StatName.MaxHp, StatName.Attack, StatName.Magic, StatName.Armor, StatName.Resist, StatName.Speed, StatName.CritChance];

    private static int ById<T>(T a, T b, Func<T, string> id) => JsSort.Compare(id(a), id(b));

    public static double AbilityCost(Ability ability, Config config)
    {
        var costs = config.Generation.AbilityTierCost;
        if (ability.Tier < 1 || ability.Tier > costs.Count) throw new ContentException($"No tier cost for tier {ability.Tier}");
        return costs[ability.Tier - 1];
    }

    /// <summary>The actives a hero of this class may be dealt, in a stable order.</summary>
    public static List<Ability> ClassPool(ContentRegistry content, HeroClass heroClass) =>
        JsSort.Stable(content.Abilities.Values.Where(a => a.Class == heroClass.Id && a.Basic != true), (a, b) => ById(a, b, x => x.Id));

    /// <summary>
    /// Shuffle the pool and take greedily while the price fits; retry with a new shuffle if
    /// too few fit, and after the last attempt fall back to the cheapest ones. Tier IV is
    /// never dealt at the start.
    /// </summary>
    private static (List<Ability> Abilities, RngState Rng) PickAbilities(
        IReadOnlyList<Ability> classAbilities, double budget, Config config, RngState rng)
    {
        int count = config.Generation.StartingAbilities;
        var pool = classAbilities.Where(a => a.Tier != 4).ToList();
        var state = rng;
        for (int attempt = 0; attempt < config.Generation.MaxAbilityAttempts; attempt++)
        {
            var (shuffled, next) = Rng.Shuffle(state, pool);
            state = next;

            var taken = new List<Ability>();
            double spent = 0;
            foreach (var ability in shuffled)
            {
                if (taken.Count == count) break;
                double cost = AbilityCost(ability, config);
                if (spent + cost > budget) continue;
                taken.Add(ability);
                spent += cost;
            }
            if (taken.Count == count) return (taken, state);
        }

        var cheapest = JsSort.Stable(pool, (a, b) =>
        {
            double d = AbilityCost(a, config) - AbilityCost(b, config);
            return d != 0 ? Math.Sign(d) : ById(a, b, x => x.Id);
        }).Take(count).ToList();
        return (cheapest, state);
    }

    public static double PassiveCost(Passive passive, Config config)
    {
        var costs = config.Generation.PassiveTierCost;
        if (passive.Tier < 1 || passive.Tier > costs.Count) throw new ContentException($"No passive cost for tier {passive.Tier}");
        return costs[passive.Tier - 1];
    }

    /// <summary>The passives a hero of this class may carry, in a stable order.</summary>
    public static List<Passive> ClassPassives(ContentRegistry content, HeroClass heroClass) =>
        JsSort.Stable(content.Passives.Values.Where(p => p.Class == heroClass.Id), (a, b) => ById(a, b, x => x.Id));

    private static double StatWeight(StatName stat, HeroClass heroClass, Config config)
    {
        var w = config.Generation.StatWeights;
        if (stat == heroClass.PrimaryStat) return w.Primary;
        if (heroClass.SecondaryStats.Contains(stat)) return w.Secondary;
        return w.Other;
    }

    /// <summary>
    /// Spends the stat budget point by point. The primary stat gets its guaranteed share
    /// first; every further point lands on a random stat, weighted by how much the class
    /// cares about it. No stat goes past the top of its range, and no stat other than the
    /// primary takes more than its share of the budget.
    /// </summary>
    private static (double[] Points, RngState Rng) DistributeStats(HeroClass heroClass, double budget, Config config, RngState rng)
    {
        var g = config.Generation;
        double cap = g.PointsPerRange;
        double otherCap = Math.Min(cap, Math.Floor(g.OtherMaxShare * budget));
        var primary = heroClass.PrimaryStat;

        var points = new double[7];
        points[(int)primary] = Math.Min(cap, Math.Ceiling(g.PrimaryMinShare * budget));

        var state = rng;
        double left = budget - points[(int)primary];
        while (left > 0)
        {
            var open = StatNames.Where(s => points[(int)s] < (s == primary ? cap : otherCap)).ToList();
            // Every stat is full: the rest is simply not spent.
            if (open.Count == 0) break;

            var weights = open.Select(s => StatWeight(s, heroClass, config)).ToList();
            double total = 0;
            foreach (double w in weights) total += w;
            var (roll, next) = Rng.NextFloat(state);
            state = next;

            double target = roll * total;
            var chosen = open[^1];
            for (int i = 0; i < open.Count; i++)
            {
                target -= weights[i];
                if (target < 0)
                {
                    chosen = open[i];
                    break;
                }
            }
            points[(int)chosen] += 1;
            left -= 1;
        }
        return (points, state);
    }

    private static IReadOnlyList<double> RangeOf(StatName stat, Config config)
    {
        var r = config.Generation.StatRanges;
        return stat switch
        {
            StatName.MaxHp => r.MaxHp,
            StatName.Attack => r.Attack,
            StatName.Magic => r.Magic,
            StatName.Armor => r.Armor,
            StatName.Resist => r.Resist,
            StatName.Speed => r.Speed,
            StatName.CritChance => r.CritChance,
            _ => throw new ArgumentOutOfRangeException(nameof(stat)),
        };
    }

    /// <summary>Crit chance is a fraction kept to whole percents; everything else is whole.</summary>
    public static double RoundStat(StatName stat, double raw) =>
        stat == StatName.CritChance ? JsMath.Round(raw * 100) / 100 : JsMath.Round(raw);

    /// <summary>The value a stat reaches with this many points. The bottom of the range is free.</summary>
    public static double StatValue(StatName stat, double points, Config config)
    {
        var range = RangeOf(stat, config);
        double lo = range[0], hi = range[1];
        double raw = lo + (hi - lo) * points / config.Generation.PointsPerRange;
        return RoundStat(stat, raw);
    }

    private static Stats ToStats(double[] points, Config config) =>
        Stats.FromArray(StatNames.Select(s => StatValue(s, points[(int)s], config)).ToList());

    /// <summary>
    /// Section 10, step 7: the race goes on top of the generated stats. mulBase scales the
    /// number, add is added after; the result is rounded like any stat and kept sane.
    /// </summary>
    public static Stats ApplyRace(Stats stats, Race race, Config config)
    {
        var output = stats.ToArray();
        foreach (var modifier in race.Modifiers)
        {
            if (!Modifiers.IsBaseStat(modifier.Stat)) continue;
            var stat = (StatName)(int)modifier.Stat;
            double raw = output[(int)stat] * (1 + (modifier.MulBase ?? 0)) + (modifier.Add ?? 0);
            output[(int)stat] = RoundStat(stat, raw);
        }
        output[(int)StatName.MaxHp] = Math.Max(1, output[(int)StatName.MaxHp]);
        output[(int)StatName.Speed] = Math.Max(config.Formulas.MinSpeed, output[(int)StatName.Speed]);
        foreach (var stat in new[] { StatName.Attack, StatName.Magic, StatName.Armor, StatName.Resist, StatName.CritChance })
            output[(int)stat] = Math.Max(0, output[(int)stat]);
        return Stats.FromArray(output);
    }

    public static (HeroTemplate Hero, RngState Rng) GenerateHero(
        ContentRegistry content,
        RngState rng,
        string id,
        string name,
        IReadOnlyList<string>? allowedClasses = null)
    {
        var config = content.Config;
        var g = config.Generation;

        var classes = JsSort.Stable(
            content.Classes.Values.Where(c => c.SummonOnly != true).Where(c => allowedClasses is null || allowedClasses.Contains(c.Id)),
            (a, b) => ById(a, b, x => x.Id));
        if (classes.Count == 0) throw new ContentException("generateHero: no class is allowed");
        var (heroClass, afterClass) = Rng.Pick(rng, classes);
        var races = JsSort.Stable(content.Races.Values, (a, b) => ById(a, b, x => x.Id));
        if (races.Count == 0) throw new ContentException("races.json is empty");
        var (race, afterRace) = Rng.Pick(afterClass, races);

        var (abilityBudget, afterBudget) = Rng.NextInt(afterRace, g.AbilityBudget[0], g.AbilityBudget[1]);
        var (abilities, afterAbilities) = PickAbilities(ClassPool(content, heroClass), abilityBudget, config, afterBudget);
        double abilitySpend = 0;
        foreach (var ability in abilities) abilitySpend += AbilityCost(ability, config);

        // A common artifact that fits the class, paid for out of the budget like an ability.
        var commons = ItemRules.ItemsFor(heroClass.Id, ItemTier.Common, content);
        if (commons.Count == 0) throw new ContentException($"No common artifact fits {heroClass.Id}");
        var (item, afterItem) = Rng.Pick(afterAbilities, commons);
        double itemCost = item.Cost ?? 0;
        double held = g.Reserve.Passive + g.Reserve.Ultimate;
        double statBudget = Math.Max(0, g.Budget - abilitySpend - held - itemCost);

        var (statPoints, afterStats) = DistributeStats(heroClass, statBudget, config, afterItem);

        var hero = new HeroTemplate
        {
            Id = id,
            Name = name,
            ClassId = heroClass.Id,
            Stats = ApplyRace(ToStats(statPoints, config), race, config),
            StatPoints = Stats.FromArray(statPoints),
            Abilities = abilities.Select(a => a.Id).ToList(),
            Passive = null,
            Race = race.Id,
            Item = item.Id,
            Perks = [],
            Spend = new BudgetSpend(abilitySpend, g.Reserve.Passive, g.Reserve.Ultimate, itemCost, statBudget),
        };
        return (hero, afterStats);
    }

    /// <summary>
    /// The draft pool. Names never repeat inside one pool, and no class appears more than
    /// config.draft.maxSameClass times: each hero's class is drawn uniformly from the
    /// classes that still have room.
    /// </summary>
    public static (List<HeroTemplate> Pool, RngState Rng) GeneratePool(ContentRegistry content, RngState rng)
    {
        int size = content.Config.Draft.PoolSize;
        int maxSameClass = content.Config.Draft.MaxSameClass;
        if (content.Names.Count < size)
            throw new ContentException($"names.json has {content.Names.Count} names, the pool needs {size}");

        var (names, afterNames) = Rng.Shuffle(rng, content.Names);
        var state = afterNames;
        var pool = new List<HeroTemplate>();
        for (int i = 0; i < size; i++)
        {
            var open = content.Classes.Values
                .Where(c => c.SummonOnly != true)
                .Select(c => c.Id)
                .Where(id => pool.Count(h => h.ClassId == id) < maxSameClass)
                .ToList();
            string name = i < names.Count ? names[i] : $"#{i + 1}";
            var (hero, next) = GenerateHero(content, state, $"h{i + 1:00}", name, open);
            state = next;
            pool.Add(hero);
        }
        return (pool, state);
    }
}
