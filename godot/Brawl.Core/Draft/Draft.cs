namespace Brawl.Core;

/// <summary>
/// The open snake draft, a port of src/core/draft/draft.ts. See docs/ai/game-rules.md
/// section 10. Side A picks first, the order comes from config (A B B A A B), and a taken
/// hero leaves the pool for both sides at once. The timer lives in the interface: when it
/// runs out, core just gets an ordinary pick.
/// </summary>
public static class DraftRules
{
    public static DraftState CreateDraft(IReadOnlyList<HeroTemplate> pool, ContentRegistry content) =>
        new() { Pool = pool, Order = content.Config.Draft.Order, Picks = new BySide<IReadOnlyList<string>>([], []) };

    /// <summary>Whose pick it is, or null once every pick has been made.</summary>
    public static Side? DraftTurn(DraftState draft)
    {
        int made = draft.Picks.A.Count + draft.Picks.B.Count;
        return made < draft.Order.Count ? draft.Order[made] : null;
    }

    public static bool IsTaken(DraftState draft, string id) => draft.Picks.A.Contains(id) || draft.Picks.B.Contains(id);

    /// <summary>Heroes still in the pool, in pool order.</summary>
    public static List<HeroTemplate> AvailableHeroes(DraftState draft) => draft.Pool.Where(hero => !IsTaken(draft, hero.Id)).ToList();

    /// <summary>The one list of what a side may pick right now. Empty when it is not their turn.</summary>
    public static List<string> LegalPicks(DraftState draft, Side side) =>
        DraftTurn(draft) != side ? [] : AvailableHeroes(draft).Select(hero => hero.Id).ToList();

    public static DraftState ApplyPick(DraftState draft, Side side, string id)
    {
        var turn = DraftTurn(draft) ?? throw new IllegalActionException($"pick {id}: the draft is over");
        if (turn != side) throw new IllegalActionException($"pick {id}: it is {turn}'s pick, not {side}'s");
        if (!draft.Pool.Any(hero => hero.Id == id)) throw new IllegalActionException($"pick {id}: no such hero in the pool");
        if (IsTaken(draft, id)) throw new IllegalActionException($"pick {id}: already taken");

        return draft with { Picks = draft.Picks.With(side, [.. draft.Picks.Of(side), id]) };
    }

    /// <summary>The heroes a side has drafted, in pick order.</summary>
    public static List<HeroTemplate> TeamOf(DraftState draft, Side side) =>
        draft.Picks.Of(side)
            .Select(id => draft.Pool.FirstOrDefault(h => h.Id == id) ?? throw new InvalidOperationException($"Picked hero {id} is missing from the pool"))
            .ToList();
}

/// <summary>
/// Which artifacts a hero may carry, a port of src/core/draft/items.ts. An artifact names
/// the roles and the classes it fits; absent lists mean everyone.
/// </summary>
public static class ItemRules
{
    public static bool ItemFits(Item item, string heroClassId, ContentRegistry content)
    {
        var heroClass = content.GetClass(heroClassId);
        if (item.Roles is not null && !item.Roles.Contains(heroClass.Role)) return false;
        if (item.Classes is not null && !item.Classes.Contains(heroClass.Id)) return false;
        return true;
    }

    /// <summary>Artifacts of a tier that fit a class, in a stable order.</summary>
    public static List<Item> ItemsFor(string heroClassId, ItemTier tier, ContentRegistry content) =>
        JsSort.Stable(
            content.Items.Values.Where(item => item.Tier == tier && ItemFits(item, heroClassId, content)),
            (a, b) => JsSort.Compare(a.Id, b.Id));
}
