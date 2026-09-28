namespace Brawl.Core;

/// <summary>"Древний страж": a neutral monster in the centre. A port of arena/guardian.ts.</summary>
public static class Guardian
{
    public const string Id = "guardian";

    public static GuardianRules? Rules(BattleState state, ContentRegistry content) =>
        state.Modifiers.Select(id => content.ArenaModifiers.Get(id)?.Rules).OfType<GuardianRules>().FirstOrDefault();

    public static BattleHero Hero(ContentRegistry content, GuardianRules rules, Hex hex)
    {
        var guardianClass = content.GetClass(rules.ClassId);
        return new BattleHero
        {
            Id = Id,
            Name = guardianClass.Name,
            Side = Side.N,
            ClassId = guardianClass.Id,
            Base = new Stats(rules.MaxHp, rules.Attack, 0, rules.Armor, rules.Resist, rules.Speed, 0),
            Hp = rules.MaxHp,
            Hex = hex,
            Atb = 0,
            Abilities = [],
            Cooldowns = OrderedMap<double>.Empty,
            Statuses = [],
            CcInPreviousTurn = [],
            CcInCurrentTurn = [],
            ReactedThisTurn = [],
            Passive = null,
            Race = null,
            Perks = [],
            Item = null,
            Summon = null,
            Counters = OrderedMap<double>.Empty,
        };
    }

    /// <summary>The living unit it may strike with the least health, of either side; ties to the lower id.</summary>
    public static BattleHero? Target(BattleState state, BattleHero guardian, Func<BattleHero, bool> canStrike)
    {
        var around = state.Heroes.Values.Where(h => h.Id != guardian.Id && h.IsAlive && canStrike(h));
        return JsSort.Stable(around, (a, b) =>
        {
            double d = a.Hp - b.Hp;
            return d != 0 ? Math.Sign(d) : JsSort.Less(a.Id, b.Id) ? -1 : 1;
        }).FirstOrDefault();
    }

    /// <summary>
    /// The reward for killing the guardian: a legendary the killer's class may carry that
    /// no hero in this battle has, from the battle stream. A summon's kill goes to its owner.
    /// </summary>
    public static (BattleState State, List<BattleEvent> Events)? Loot(BattleState state, string killerId, ContentRegistry content)
    {
        var killer = state.Heroes.Get(killerId);
        if (killer is null) return null;
        string receiverId = killer.Summon is null ? killer.Id : killer.Summon.OwnerId;
        var receiver = state.Heroes.Get(receiverId);
        if (receiver is null || receiver.Side == Side.N || !receiver.IsAlive) return null;

        var carried = new HashSet<string?>(state.Heroes.Values.Select(h => h.Item));
        var options = JsSort.Stable(
            Items.For(receiver.ClassId, ItemTier.Legendary, content).Where(item => !carried.Contains(item.Id)),
            (a, b) => JsSort.Less(a.Id, b.Id) ? -1 : 1);
        if (options.Count == 0) return null;
        var (item, rng) = Rng.Pick(state.Rng, options);

        return (
            state with
            {
                Rng = rng,
                Heroes = state.Heroes.Set(receiver.Id, receiver with { Item = item.Id }),
                Loot = [.. state.Loot.Where(l => l.HeroId != receiver.Id), new LootPick(receiver.Id, item.Id)],
            },
            [new ItemGainedEvent(receiver.Id, item.Id)]);
    }
}

/// <summary>Which artifacts a hero may carry. A port of draft/items.ts.</summary>
public static class Items
{
    public static bool Fits(Item item, string heroClassId, ContentRegistry content)
    {
        var heroClass = content.GetClass(heroClassId);
        if (item.Roles is not null && !item.Roles.Contains(heroClass.Role)) return false;
        if (item.Classes is not null && !item.Classes.Contains(heroClass.Id)) return false;
        return true;
    }

    /// <summary>Artifacts of a tier that fit a class, in a stable order.</summary>
    public static List<Item> For(string heroClassId, ItemTier tier, ContentRegistry content) =>
        JsSort.Stable(
            content.Items.Values.Where(item => item.Tier == tier && Fits(item, heroClassId, content)),
            (a, b) => JsSort.Compare(a.Id, b.Id));
}
