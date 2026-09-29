namespace Brawl.Core;

/// <summary>
/// The upgrade phase between matches, a port of src/core/run/upgrade.ts. See
/// docs/ai/game-rules.md section 10.
///
/// Every hero is offered a few perks and takes one; a perk is offered only to the roles
/// and classes it names, never to a hero who already has it, and a unique perk never to a
/// hero whose teammate has it. A hero also unlocks what it was drafted without (a passive
/// after the first match, a tier IV ability after the second), each side takes one
/// artifact as the reward, and each side may swap one hero for one of a few candidates.
/// A side far enough behind sees more perks and rewards (config.run.catchUp).
/// </summary>
public static class UpgradeRules
{
    private static readonly Side[] Sides = [Side.A, Side.B];

    private static int ByIdOrder(string a, string b) => JsSort.Compare(a, b);

    /// <summary>`(a, b) => (a.id &lt; b.id ? -1 : 1)`: the ids are unique, so this is the id order.</summary>
    private static List<Perk> PerksById(ContentRegistry content) =>
        JsSort.Stable(content.Perks.Values, (a, b) => JsSort.Less(a.Id, b.Id) ? -1 : 1);

    private static HeroTemplate HeroOf(DraftState draft, string id) =>
        draft.Pool.FirstOrDefault(h => h.Id == id) ?? throw new InvalidOperationException($"No hero {id} in the pool");

    private static Side SideOf(DraftState draft, string id)
    {
        if (draft.Picks.A.Contains(id)) return Side.A;
        if (draft.Picks.B.Contains(id)) return Side.B;
        throw new InvalidOperationException($"Hero {id} was not drafted");
    }

    /// <summary>The abilities of a hero a perk can change; empty for a perk that changes none.</summary>
    public static List<string> PerkTargets(HeroTemplate hero, Perk perk, ContentRegistry content)
    {
        var mod = perk.AbilityMod;
        if (mod is null) return [];
        return hero.Abilities.Where(id =>
        {
            var ability = content.GetAbility(id);
            if (mod.Cooldown is not null && !(!ability.Cooldown.Once && ability.Cooldown.Turns >= 2)) return false;
            if (mod.Ap is not null && ability.Ap < 2) return false;
            if (mod.Range is not null && ability.Range <= 1) return false;
            return true;
        }).ToList();
    }

    /// <summary>Whether a perk may be offered to this hero at all.</summary>
    private static bool Eligible(Perk perk, HeroTemplate hero, IReadOnlyList<HeroTemplate> teammates, ContentRegistry content)
    {
        var heroClass = content.GetClass(hero.ClassId);
        if (perk.Roles is not null && !perk.Roles.Contains(heroClass.Role)) return false;
        if (perk.Classes is not null && !perk.Classes.Contains(hero.ClassId)) return false;
        if (hero.Perks.Any(p => p.PerkId == perk.Id)) return false;
        if (perk.Unique == true && teammates.Any(t => t.Perks.Any(p => p.PerkId == perk.Id))) return false;
        if (perk.AbilityMod is not null && PerkTargets(hero, perk, content).Count == 0) return false;
        return true;
    }

    private static List<string> ClassPassiveIds(ContentRegistry content, string classId) =>
        JsSort.Stable(content.Passives.Values.Where(p => p.Class == classId).Select(p => p.Id), ByIdOrder);

    private static List<string> ClassUltimateIds(ContentRegistry content, string classId) =>
        JsSort.Stable(
            content.Abilities.Values.Where(a => a.Class == classId && a.Tier == 4 && a.Basic != true).Select(a => a.Id),
            ByIdOrder);

    private static bool HasUltimate(HeroTemplate hero, ContentRegistry content) =>
        hero.Abilities.Any(id => content.GetAbility(id).Tier == 4);

    /// <summary>What a hero may unlock after this match, with its options still to be drawn.</summary>
    private static (UnlockKind Kind, List<string> Pool)? UnlockDue(HeroTemplate hero, int finishedMatch, ContentRegistry content)
    {
        var run = content.Config.Run;
        if (finishedMatch == run.PassiveAfterMatch && hero.Passive is null)
            return (UnlockKind.Passive, ClassPassiveIds(content, hero.ClassId));
        if (finishedMatch == run.UltimateAfterMatch && !HasUltimate(hero, content))
            return (UnlockKind.Ultimate, ClassUltimateIds(content, hero.ClassId));
        return null;
    }

    /// <summary>The side at least config.run.catchUp.deficit wins behind, or null.</summary>
    public static Side? TrailingSide(BySide<double> wins, ContentRegistry content)
    {
        double deficit = content.Config.Run.CatchUp.Deficit;
        if (wins.B - wins.A >= deficit) return Side.A;
        if (wins.A - wins.B >= deficit) return Side.B;
        return null;
    }

    /// <summary>How many more perks and rewards this side is shown than usual.</summary>
    private static int CatchUpBonus(Side side, BySide<double> wins, ContentRegistry content) =>
        TrailingSide(wins, content) == side ? content.Config.Run.CatchUp.ExtraChoices : 0;

    /// <summary>Offers for every drafted hero, side A first, each in pick order.</summary>
    public static (UpgradeState Upgrade, RngState Rng) CreateUpgrade(
        DraftState draft, ContentRegistry content, RngState rng, int finishedMatch, BySide<double> wins)
    {
        var perks = PerksById(content);
        var offers = OrderedMap<IReadOnlyList<string>>.Empty;
        var state = rng;

        foreach (var side in Sides)
        {
            var team = draft.Picks.Of(side).Select(id => HeroOf(draft, id)).ToList();
            int count = content.Config.Run.PerkChoices + CatchUpBonus(side, wins, content);
            foreach (var hero in team)
            {
                var teammates = team.Where(t => t.Id != hero.Id).ToList();
                var open = perks.Where(perk => Eligible(perk, hero, teammates, content)).ToList();
                var (shuffled, next) = Rng.Shuffle(state, open);
                state = next;
                offers = offers.Set(hero.Id, shuffled.Take(count).Select(p => p.Id).ToList());
            }
        }

        // Unlocks are drawn after every perk offer, so adding them did not shift the perks.
        var unlocks = OrderedMap<UnlockOffer>.Empty;
        foreach (var side in Sides)
        {
            foreach (var hero in draft.Picks.Of(side).Select(id => HeroOf(draft, id)))
            {
                var due = UnlockDue(hero, finishedMatch, content);
                if (due is null || due.Value.Pool.Count == 0) continue;
                var (shuffled, next) = Rng.Shuffle(state, due.Value.Pool);
                state = next;
                unlocks = unlocks.Set(hero.Id, new UnlockOffer(due.Value.Kind, shuffled.Take(content.Config.Run.UnlockChoices).ToList()));
            }
        }
        // Rewards come after both, and swap candidates last.
        var (rewards, afterRewards) = CreateRewards(draft, content, state, finishedMatch, wins);
        var (candidates, afterCandidates) = CreateCandidates(draft, content, afterRewards, finishedMatch);
        var upgrade = new UpgradeState
        {
            Offers = offers,
            Chosen = OrderedMap<PerkPick>.Empty,
            Unlocks = unlocks,
            Unlocked = OrderedMap<string>.Empty,
            Rewards = rewards,
            Rewarded = new BySide<RewardPick?>(null, null),
            Candidates = candidates,
            Swapped = new BySide<SwapPick?>(null, null),
            Ready = new BySide<bool?>(null, null),
        };
        return (upgrade, afterCandidates);
    }

    /// <summary>
    /// The heroes each side may swap one of its own for: first the heroes nobody drafted,
    /// dealt to the two sides in turn, then new ones from the generator. Every one of them
    /// comes ready at the team's level.
    /// </summary>
    private static (BySide<IReadOnlyList<HeroTemplate>> Candidates, RngState Rng) CreateCandidates(
        DraftState draft, ContentRegistry content, RngState rng, int finishedMatch)
    {
        int count = content.Config.Run.SwapChoices;
        var (undrafted, afterShuffle) = Rng.Shuffle(rng, DraftRules.AvailableHeroes(draft));
        var state = afterShuffle;

        var raw = new Dictionary<Side, List<HeroTemplate>> { [Side.A] = [], [Side.B] = [] };
        for (int i = 0; i < undrafted.Count; i++)
        {
            var side = i % 2 == 0 ? Side.A : Side.B;
            if (raw[side].Count < count) raw[side].Add(undrafted[i]);
        }

        // Names never repeat among the heroes of a run, the candidates included.
        var used = draft.Pool.Select(h => h.Name).ToHashSet();
        var (names, afterNames) = Rng.Shuffle(state, content.Names.Where(n => !used.Contains(n)).ToList());
        state = afterNames;
        int nameIndex = 0;
        foreach (var side in Sides)
        {
            for (int i = raw[side].Count; i < count; i++)
            {
                string name = nameIndex < names.Count ? names[nameIndex] : $"#{finishedMatch}{side}{i + 1}";
                nameIndex += 1;
                var (hero, next) = HeroGenerator.GenerateHero(content, state, $"s{finishedMatch}{side}{i + 1}", name);
                state = next;
                raw[side].Add(hero);
            }
        }

        var output = new Dictionary<Side, List<HeroTemplate>> { [Side.A] = [], [Side.B] = [] };
        foreach (var side in Sides)
        {
            foreach (var hero in raw[side])
            {
                var (ready, next) = ReadyHero(hero, finishedMatch, content, state);
                state = next;
                output[side].Add(ready);
            }
        }
        return (new BySide<IReadOnlyList<HeroTemplate>>(output[Side.A], output[Side.B]), state);
    }

    /// <summary>
    /// A candidate brought to the team's level: the passive and the tier IV ability its
    /// teammates have unlocked by now, and one perk per finished match, chosen at random
    /// from the run stream. Unique perks are left out.
    /// </summary>
    private static (HeroTemplate Hero, RngState Rng) ReadyHero(HeroTemplate hero, int finishedMatch, ContentRegistry content, RngState rng)
    {
        var run = content.Config.Run;
        var state = rng;
        var next = hero;

        if (finishedMatch >= run.PassiveAfterMatch && next.Passive is null)
        {
            var passives = ClassPassiveIds(content, next.ClassId);
            if (passives.Count > 0)
            {
                var (passive, after) = Rng.Pick(state, passives);
                state = after;
                next = next with { Passive = passive };
            }
        }
        if (finishedMatch >= run.UltimateAfterMatch && !HasUltimate(next, content))
        {
            var ultimates = ClassUltimateIds(content, next.ClassId);
            if (ultimates.Count > 0)
            {
                var (ultimate, after) = Rng.Pick(state, ultimates);
                state = after;
                next = next with { Abilities = [.. next.Abilities, ultimate] };
            }
        }

        var perks = PerksById(content);
        while (next.Perks.Count < finishedMatch)
        {
            var current = next;
            var open = perks.Where(perk => perk.Unique != true && Eligible(perk, current, [], content)).ToList();
            if (open.Count == 0) break;
            var (perk, afterPerk) = Rng.Pick(state, open);
            state = afterPerk;
            var choice = new PerkPick { PerkId = perk.Id };
            if (perk.AbilityMod is not null)
            {
                var (target, afterTarget) = Rng.Pick(state, PerkTargets(current, perk, content));
                state = afterTarget;
                choice = new PerkPick { PerkId = perk.Id, AbilityId = target };
            }
            next = next with { Perks = [.. next.Perks, choice] };
        }
        return (next, state);
    }

    /// <summary>A side's team as it will be after the phase: with the lined-up swap made.</summary>
    public static List<HeroTemplate> TeamAfterSwap(UpgradeState upgrade, DraftState draft, Side side)
    {
        var swap = upgrade.Swapped.Of(side);
        return draft.Picks.Of(side).Select(id =>
        {
            if (swap?.OutId == id)
            {
                return upgrade.Candidates.Of(side).FirstOrDefault(h => h.Id == swap.InId)
                    ?? throw new InvalidOperationException($"Swap candidate {swap.InId} is not on offer");
            }
            return HeroOf(draft, id);
        }).ToList();
    }

    /// <summary>Whether this hero is lined up to leave the team, and so chooses nothing more.</summary>
    private static bool Leaving(UpgradeState upgrade, Side side, string id) => upgrade.Swapped.Of(side)?.OutId == id;

    /// <summary>The swap takes back a reward given to a hero no longer in the team.</summary>
    private static UpgradeState KeepRewardValid(UpgradeState upgrade, DraftState draft, Side side)
    {
        var reward = upgrade.Rewarded.Of(side);
        if (reward is null) return upgrade;
        if (TeamAfterSwap(upgrade, draft, side).Any(h => h.Id == reward.HeroId)) return upgrade;
        return upgrade with { Rewarded = upgrade.Rewarded.With(side, null) };
    }

    public static UpgradeState ApplySwapHero(UpgradeState upgrade, DraftState draft, Side side, string outId, string inId)
    {
        string what = $"swapHero {outId} for {inId}";
        if (!draft.Picks.Of(side).Contains(outId)) throw new IllegalActionException($"{what}: not a hero of {side}");
        if (!upgrade.Candidates.Of(side).Any(h => h.Id == inId)) throw new IllegalActionException($"{what}: not a candidate of {side}");
        // One swap per phase: a new one replaces the old; nothing is final until both sides are ready.
        return KeepRewardValid(upgrade with { Swapped = upgrade.Swapped.With(side, new SwapPick(outId, inId)) }, draft, side);
    }

    public static UpgradeState ApplyCancelSwap(UpgradeState upgrade, DraftState draft, Side side)
    {
        if (upgrade.Swapped.Of(side) is null) throw new IllegalActionException($"cancelSwap: {side} has no swap");
        return KeepRewardValid(upgrade with { Swapped = upgrade.Swapped.With(side, null) }, draft, side);
    }

    /// <summary>
    /// The artifacts each side is offered: config.run.rewardChoices (more when catching up)
    /// of the tier this match gives, each fitting a different hero of the team where
    /// possible. A legendary never repeats in a run.
    /// </summary>
    private static (BySide<IReadOnlyList<string>> Rewards, RngState Rng) CreateRewards(
        DraftState draft, ContentRegistry content, RngState rng, int finishedMatch, BySide<double> wins)
    {
        var tiers = content.Config.Run.RewardTiers;
        if (finishedMatch - 1 < 0 || finishedMatch - 1 >= tiers.Count) return (new BySide<IReadOnlyList<string>>([], []), rng);
        var tier = tiers[finishedMatch - 1] == RewardTier.Rare ? ItemTier.Rare : ItemTier.Legendary;

        var carried = draft.Pool.Select(h => h.Item).ToHashSet();
        var taken = new HashSet<string>();
        var state = rng;
        var output = new Dictionary<Side, List<string>> { [Side.A] = [], [Side.B] = [] };
        foreach (var side in Sides)
        {
            var (team, afterTeam) = Rng.Shuffle(state, draft.Picks.Of(side).Select(id => HeroOf(draft, id)).ToList());
            state = afterTeam;
            var open = JsSort.Stable(
                content.Items.Values
                    .Where(item => item.Tier == tier)
                    .Where(item => item.Tier != ItemTier.Legendary || (!carried.Contains(item.Id) && !taken.Contains(item.Id))),
                (a, b) => JsSort.Less(a.Id, b.Id) ? -1 : 1);

            var (shuffled, afterItems) = Rng.Shuffle(state, open);
            state = afterItems;
            var picked = new List<string>();
            int count = content.Config.Run.RewardChoices + CatchUpBonus(side, wins, content);
            // One per hero first, in a random hero order; then anything that fits anyone.
            foreach (var hero in team)
            {
                if (picked.Count >= count) break;
                var item = shuffled.FirstOrDefault(i => !picked.Contains(i.Id) && ItemRules.ItemFits(i, hero.ClassId, content));
                if (item is not null) picked.Add(item.Id);
            }
            foreach (var item in shuffled)
            {
                if (picked.Count >= count) break;
                if (picked.Contains(item.Id)) continue;
                if (team.Any(hero => ItemRules.ItemFits(item, hero.ClassId, content))) picked.Add(item.Id);
            }
            foreach (string id in picked)
                if (content.Items.Get(id)?.Tier == ItemTier.Legendary) taken.Add(id);
            output[side] = picked;
        }
        return (new BySide<IReadOnlyList<string>>(output[Side.A], output[Side.B]), state);
    }

    public static UpgradeState ApplyChooseReward(
        UpgradeState upgrade, DraftState draft, Side side, string itemId, string heroId, ContentRegistry content)
    {
        string what = $"chooseReward {itemId} for {heroId}";
        if (!upgrade.Rewards.Of(side).Contains(itemId)) throw new IllegalActionException($"{what}: not among the rewards");
        // The team after the swap: a newcomer may take the reward, a leaving hero may not.
        var hero = TeamAfterSwap(upgrade, draft, side).FirstOrDefault(h => h.Id == heroId)
            ?? throw new IllegalActionException($"{what}: not a hero of {side} for the next match");
        var item = content.Items.Get(itemId);
        if (item is null || !ItemRules.ItemFits(item, hero.ClassId, content))
            throw new IllegalActionException($"{what}: the artifact does not fit this hero");
        // Choosing again replaces the earlier pick; nothing is final until both sides are ready.
        return upgrade with { Rewarded = upgrade.Rewarded.With(side, new RewardPick(itemId, heroId)) };
    }

    /// <summary>Whether a side still has its reward to take; a swap can leave nobody an offered artifact fits.</summary>
    public static bool AwaitingReward(UpgradeState upgrade, DraftState draft, Side side, ContentRegistry content)
    {
        if (upgrade.Rewarded.Of(side) is not null) return false;
        var team = TeamAfterSwap(upgrade, draft, side);
        return upgrade.Rewards.Of(side).Any(id =>
        {
            var item = content.Items.Get(id);
            return item is not null && team.Any(hero => ItemRules.ItemFits(item, hero.ClassId, content));
        });
    }

    public static UpgradeState ApplyChooseUnlock(UpgradeState upgrade, DraftState draft, Side side, string heroId, string optionId)
    {
        string what = $"chooseUnlock {optionId} for {heroId}";
        if (SideOf(draft, heroId) != side) throw new IllegalActionException($"{what}: not a hero of {side}");
        if (Leaving(upgrade, side, heroId)) throw new IllegalActionException($"{what}: the hero is being swapped out");
        if (!(upgrade.Unlocks.Get(heroId)?.Options ?? []).Contains(optionId))
            throw new IllegalActionException($"{what}: not among the options");
        return upgrade with { Unlocked = upgrade.Unlocked.Set(heroId, optionId) };
    }

    /// <summary>Heroes of a side with an unlock still to choose; a leaving hero chooses nothing.</summary>
    public static List<string> AwaitingUnlock(UpgradeState upgrade, DraftState draft, Side side) =>
        draft.Picks.Of(side)
            .Where(id => !Leaving(upgrade, side, id) && upgrade.Unlocks.ContainsKey(id) && !upgrade.Unlocked.ContainsKey(id))
            .ToList();

    public static UpgradeState ApplyChoosePerk(
        UpgradeState upgrade, DraftState draft, Side side, string heroId, string perkId, string? abilityId, ContentRegistry content)
    {
        string what = $"choosePerk {perkId} for {heroId}";
        if (SideOf(draft, heroId) != side) throw new IllegalActionException($"{what}: not a hero of {side}");
        if (Leaving(upgrade, side, heroId)) throw new IllegalActionException($"{what}: the hero is being swapped out");
        if (!(upgrade.Offers.Get(heroId) ?? []).Contains(perkId)) throw new IllegalActionException($"{what}: not among the offers");
        var perk = content.Perks.Get(perkId) ?? throw new IllegalActionException($"{what}: unknown perk");

        // Two teammates cannot take the same unique perk in one phase either.
        if (perk.Unique == true)
        {
            var mates = draft.Picks.Of(side).Where(id => id != heroId);
            if (mates.Any(id => upgrade.Chosen.Get(id)?.PerkId == perkId))
                throw new IllegalActionException($"{what}: a teammate already took this unique perk");
        }

        var pick = new PerkPick { PerkId = perkId };
        if (perk.AbilityMod is not null)
        {
            var targets = PerkTargets(HeroOf(draft, heroId), perk, content);
            if (abilityId is null || !targets.Contains(abilityId))
                throw new IllegalActionException($"{what}: needs one of {string.Join(", ", targets)}");
            pick = new PerkPick { PerkId = perkId, AbilityId = abilityId };
        }
        else if (abilityId is not null)
        {
            throw new IllegalActionException($"{what}: this perk does not change an ability");
        }

        return upgrade with { Chosen = upgrade.Chosen.Set(heroId, pick) };
    }

    /// <summary>Heroes of a side still to choose; a hero with no offers or a leaving one chooses nothing.</summary>
    public static List<string> AwaitingPerk(UpgradeState upgrade, DraftState draft, Side side) =>
        draft.Picks.Of(side)
            .Where(id => !Leaving(upgrade, side, id) && !upgrade.Chosen.ContainsKey(id) && (upgrade.Offers.Get(id) ?? []).Count > 0)
            .ToList();

    /// <summary>What a side still has to choose before it may say it is ready; empty when nothing.</summary>
    public static List<string> WaitingFor(UpgradeState upgrade, DraftState draft, Side side, ContentRegistry content)
    {
        var waiting = new List<string>();
        waiting.AddRange(AwaitingPerk(upgrade, draft, side));
        waiting.AddRange(AwaitingUnlock(upgrade, draft, side));
        if (AwaitingReward(upgrade, draft, side, content)) waiting.Add("the reward");
        return waiting;
    }

    /// <summary>A side changed a choice, so it is not ready any more.</summary>
    public static UpgradeState ClearReady(UpgradeState upgrade, Side side) =>
        upgrade.Ready.Of(side) is null ? upgrade : upgrade with { Ready = upgrade.Ready.With(side, null) };

    /// <summary>
    /// The chosen perks and unlocks written into the heroes, ready for the next match. A
    /// swap puts the candidate in the leaving hero's place in the pick order; the one who
    /// leaves is gone from the pool and so from the run.
    /// </summary>
    public static DraftState CommitUpgrade(UpgradeState upgrade, DraftState draft)
    {
        var pool = draft.Pool.ToList();
        var picks = new Dictionary<Side, List<string>> { [Side.A] = draft.Picks.A.ToList(), [Side.B] = draft.Picks.B.ToList() };
        foreach (var side in Sides)
        {
            var swap = upgrade.Swapped.Of(side);
            var incoming = swap is null ? null : upgrade.Candidates.Of(side).FirstOrDefault(h => h.Id == swap.InId);
            if (swap is null || incoming is null) continue;
            pool = [.. pool.Where(h => h.Id != swap.OutId && h.Id != swap.InId), incoming];
            picks[side] = picks[side].Select(id => id == swap.OutId ? swap.InId : id).ToList();
        }
        return draft with
        {
            Picks = new BySide<IReadOnlyList<string>>(picks[Side.A], picks[Side.B]),
            Pool = pool.Select(hero =>
            {
                var pick = upgrade.Chosen.Get(hero.Id);
                var next = pick is null ? hero : hero with { Perks = [.. hero.Perks, pick] };
                var unlock = upgrade.Unlocks.Get(hero.Id);
                string? option = upgrade.Unlocked.Get(hero.Id);
                if (unlock is not null && option is not null)
                {
                    next = unlock.Kind == UnlockKind.Passive
                        ? next with { Passive = option }
                        : next with { Abilities = [.. next.Abilities, option] };
                }
                // The reward replaces whatever artifact the hero carried.
                foreach (var side in Sides)
                {
                    var reward = upgrade.Rewarded.Of(side);
                    if (reward?.HeroId == hero.Id) next = next with { Item = reward.ItemId };
                }
                return next;
            }).ToList(),
        };
    }

    /// <summary>
    /// Health from perks and the artifact, added when the hero is built: a maximum that
    /// changed mid-battle would leave the current health meaningless.
    /// </summary>
    public static Stats WithPerkHealth(Stats stats, IReadOnlyList<PerkPick> perks, ContentRegistry content, string? item = null)
    {
        double add = 0;
        double mul = 0;
        var sources = perks.Select(pick => content.Perks.Get(pick.PerkId)?.Modifiers ?? []).ToList();
        sources.Add(item is null ? [] : content.Items.Get(item)?.Modifiers ?? []);
        foreach (var modifiers in sources)
        {
            foreach (var modifier in modifiers)
            {
                if (modifier.Stat != ModifierStat.MaxHp || modifier.When is not null || (modifier.Scope ?? ModifierScope.Self) != ModifierScope.Self) continue;
                add += modifier.Add ?? 0;
                mul += modifier.Mul ?? 0;
            }
        }
        if (add == 0 && mul == 0) return stats;
        return stats with { MaxHp = Math.Max(1, JsMath.Round((stats.MaxHp + add) * (1 + mul))) };
    }
}
