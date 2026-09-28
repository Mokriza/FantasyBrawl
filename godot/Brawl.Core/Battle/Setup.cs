namespace Brawl.Core;

/// <summary>Building the starting state of a match, a port of battle/state.ts.</summary>
public static class BattleSetup
{
    /// <summary>One roster entry as a hero on the field, at full health and an empty gauge.</summary>
    public static BattleHero ToBattleHero(TeamHero entry, ContentRegistry content)
    {
        var heroClass = content.GetClass(entry.Class);
        var s = entry.Stats;
        return new BattleHero
        {
            Id = entry.Id,
            Name = entry.Name,
            Side = entry.Side,
            ClassId = heroClass.Id,
            Base = new Stats(s.MaxHp, s.Attack, s.Magic, s.Armor, s.Resist, s.Speed, s.CritChance),
            Hp = s.MaxHp,
            Hex = HexMath.OffsetToAxial(entry.At[0], entry.At[1]),
            Atb = 0,
            Abilities = entry.Abilities,
            Cooldowns = OrderedMap<double>.Empty,
            Statuses = [],
            CcInPreviousTurn = [],
            CcInCurrentTurn = [],
            ReactedThisTurn = [],
            Passive = entry.Passive,
            Race = entry.Race,
            Summon = null,
            Item = entry.Item,
            Perks = (entry.Perks ?? []).Select(p => new PerkPick { PerkId = p.PerkId, AbilityId = p.AbilityId }).ToList(),
            Counters = OrderedMap<double>.Empty,
        };
    }

    /// <summary>A battle from rosters. The arena is generated from the seed unless one is given.</summary>
    public static BattleState CreateBattle(double seed, Teams teams, ContentRegistry content, Arena? arena = null, IReadOnlyList<string>? modifiers = null)
    {
        // Arena generation draws from its own stream, so the map never shifts the crits.
        var arenaRng = Rng.Create(JsMath.ToInt32(seed) ^ 0x5f3759df);
        var board = arena ?? ArenaGenerator.Generate(arenaRng, content.Config).Arena;

        var heroes = OrderedMap<BattleHero>.Empty;
        foreach (var entry in teams.Heroes)
        {
            if (heroes.ContainsKey(entry.Id)) throw new InvalidOperationException($"Duplicate hero id in teams: {entry.Id}");
            heroes = heroes.Set(entry.Id, ToBattleHero(entry, content));
        }

        // "Древний страж" starts in the centre, which the generator always leaves clear.
        var mods = modifiers ?? [];
        foreach (string id in mods)
            if (content.ArenaModifiers.Get(id)?.Rules is GuardianRules rules)
                heroes = heroes.Set(Guardian.Id, Guardian.Hero(content, rules, ArenaModifiers.CentreHex(board)));

        return new BattleState
        {
            Seed = seed,
            Rng = Rng.Create(seed),
            Tick = 0,
            Round = 1,
            Arena = board,
            Heroes = heroes,
            ActiveHeroId = null,
            ApLeft = 0,
            Modifiers = mods,
            Hold = new HoldCount(0, 0, 1),
            Loot = [],
            Outcome = null,
            LastActedHeroId = null,
            TemporaryTerrain = [],
            Pending = [],
        };
    }
}
