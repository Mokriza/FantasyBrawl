namespace Brawl.Core;

public sealed record DraftDecision(string HeroId, RngState Rng);

public sealed record SwapDecision(string OutId, string InId);

public sealed record PlacementDecision(string HeroId, Hex Hex, RngState Rng);

public sealed record PerkDecision(string PerkId, string? AbilityId, RngState Rng);

public sealed record UnlockDecision(string OptionId, RngState Rng);

public sealed record RewardDecision(string ItemId, string HeroId, RngState Rng);

/// <summary>
/// The AI outside battle, a port of src/ai/draft.ts, placement.ts and perks.ts: the pick,
/// the swap, where to stand, and the perk, unlock and reward between matches. Greedy
/// scores with the draft noise on top. See docs/ai/ai-opponent.md.
/// </summary>
public static class RunAi
{
    // --- draft ---------------------------------------------------------------------------

    private static double StatWeight(StatName stat, HeroClass heroClass, StatWeights w) =>
        stat == heroClass.PrimaryStat ? w.Primary : heroClass.SecondaryStats.Contains(stat) ? w.Secondary : w.Other;

    /// <summary>Stat strength in budget points, a point in a stat the class cares about counting in full.</summary>
    private static double StatStrength(HeroTemplate hero, ContentRegistry content)
    {
        var heroClass = content.GetClass(hero.ClassId);
        var w = content.Config.Generation.StatWeights;
        double total = 0;
        foreach (var stat in HeroGenerator.StatNames) total += hero.StatPoints.Get(stat) * StatWeight(stat, heroClass, w);
        return total / (content.Config.Generation.Budget * w.Primary);
    }

    /// <summary>Ability strength: the budget price already says what an ability is worth.</summary>
    private static double AbilityStrength(HeroTemplate hero, ContentRegistry content)
    {
        double spent = 0;
        foreach (string id in hero.Abilities) spent += HeroGenerator.AbilityCost(content.GetAbility(id), content.Config);
        return spent / content.Config.Generation.Budget;
    }

    public static double ScoreHero(HeroTemplate hero, IReadOnlyList<HeroTemplate> team, ContentRegistry content)
    {
        var weights = content.Config.Ai.Draft;
        var role = content.GetClass(hero.ClassId).Role;
        int sameRole = team.Count(h => content.GetClass(h.ClassId).Role == role);

        double score = weights.StatWeight * StatStrength(hero, content) + weights.AbilityWeight * AbilityStrength(hero, content);
        // A role the team lacks is worth a bonus; a third hero of one role costs a penalty.
        if (sameRole == 0) score += weights.MissingRoleBonus;
        if (sameRole >= 2) score -= weights.DuplicateRolePenalty;
        return score;
    }

    public static DraftDecision ChoosePick(DraftState draft, ContentRegistry content, RngState rng)
    {
        var side = DraftRules.DraftTurn(draft) ?? throw new InvalidOperationException("choosePick: the draft is over");
        var team = DraftRules.TeamOf(draft, side);
        double noise = content.Config.Ai.Draft.Noise;
        var state = rng;
        string? best = null;
        double bestScore = double.NegativeInfinity;

        foreach (string id in DraftRules.LegalPicks(draft, side))
        {
            var hero = draft.Pool.FirstOrDefault(h => h.Id == id);
            if (hero is null) continue;
            double score = ScoreHero(hero, team, content);
            if (noise > 0)
            {
                var (jitter, next) = Rng.NextFloatBetween(state, -noise, noise);
                state = next;
                score *= 1 + jitter;
            }
            if (score > bestScore)
            {
                bestScore = score;
                best = id;
            }
        }

        return new DraftDecision(best ?? throw new InvalidOperationException("choosePick: nothing to pick"), state);
    }

    /// <summary>
    /// The swap between matches, by the same score as the draft: the weakest hero goes if
    /// the best candidate scores at least config.ai.draft.swapMargin better in its place.
    /// </summary>
    public static SwapDecision? ChooseSwap(RunState run, Side side, ContentRegistry content)
    {
        var candidates = run.Upgrade?.Candidates.Of(side) ?? [];
        var team = DraftRules.TeamOf(run.Draft, side);
        List<HeroTemplate> Others(HeroTemplate hero) => team.Where(h => h.Id != hero.Id).ToList();

        HeroTemplate? weakest = null;
        double weakestScore = double.PositiveInfinity;
        foreach (var hero in team)
        {
            double score = ScoreHero(hero, Others(hero), content);
            if (score < weakestScore)
            {
                weakestScore = score;
                weakest = hero;
            }
        }
        if (weakest is null) return null;

        var rest = Others(weakest);
        HeroTemplate? best = null;
        double bestScore = double.NegativeInfinity;
        foreach (var hero in candidates)
        {
            double score = ScoreHero(hero, rest, content);
            if (score > bestScore)
            {
                bestScore = score;
                best = hero;
            }
        }
        if (best is null || bestScore < weakestScore * (1 + content.Config.Ai.Draft.SwapMargin)) return null;
        return new SwapDecision(weakest.Id, best.Id);
    }

    // --- placement -----------------------------------------------------------------------

    private static int RoleOrder(Role role) => role switch
    {
        Role.Tank => 0,
        Role.Melee => 1,
        Role.Support => 2,
        Role.Ranged => 3,
        _ => throw new ArgumentOutOfRangeException(nameof(role)),
    };

    private const double PlacementNoise = 0.4;

    /// <summary>
    /// Front-liners take the column nearer the enemy, everyone else the back one, nobody
    /// wanders to the edge without a reason, and the back line does not bunch up.
    /// </summary>
    public static PlacementDecision ChoosePlacement(RunState run, ContentRegistry content, RngState rng)
    {
        var placement = run.Placement;
        var side = placement is null ? null : PlacementRules.PlacementTurn(placement);
        if (placement is null || side is null) throw new InvalidOperationException("choosePlacement: nothing to place");

        var config = content.Config;
        var waiting = DraftRules.TeamOf(run.Draft, side.Value).Where(hero => !PlacementRules.IsPlaced(placement, hero.Id)).ToList();
        Role RoleOf(string classId) => content.GetClass(classId).Role;
        var hero = JsSort.Stable(waiting, (a, b) => RoleOrder(RoleOf(a.ClassId)) - RoleOrder(RoleOf(b.ClassId))).FirstOrDefault()
            ?? throw new InvalidOperationException("choosePlacement: the whole team is placed");

        var columns = side == Side.A ? config.Arena.StartColumnsA : config.Arena.StartColumnsB;
        int frontCol = side == Side.A ? columns.Max() : columns.Min();
        int middleRow = config.Arena.Rows / 2;
        var role = RoleOf(hero.ClassId);
        bool front = role is Role.Tank or Role.Melee;
        var friends = placement.Placed.Where(p => p.Side == side).Select(p => p.Hex).ToList();

        var state = rng;
        Hex? best = null;
        double bestScore = double.NegativeInfinity;
        foreach (var hex in PlacementRules.LegalPlacementHexes(placement, side.Value, config))
        {
            var (col, row) = HexMath.AxialToOffset(hex);
            double score = (col == frontCol) == front ? 2 : 0;
            score -= Math.Abs(row - middleRow) * 0.5;
            // Stand a little apart from the rest of the team.
            if (!front) score -= friends.Count(f => HexMath.Distance(f, hex) <= 1);
            var (jitter, next) = Rng.NextFloatBetween(state, 0, PlacementNoise);
            state = next;
            score += jitter;
            if (score > bestScore)
            {
                bestScore = score;
                best = hex;
            }
        }

        return new PlacementDecision(hero.Id, best ?? throw new InvalidOperationException("choosePlacement: no free start hex"), state);
    }

    // --- perks, unlocks, rewards ---------------------------------------------------------

    /// <summary>How much one modifier is worth to a hero of this class, roughly 0..1.</summary>
    private static double ModifierWorth(Modifier modifier, HeroTemplate hero, ContentRegistry content)
    {
        var heroClass = content.GetClass(hero.ClassId);
        var w = content.Config.Generation.StatWeights;
        bool support = heroClass.Role == Role.Support;
        switch (modifier.Stat)
        {
            case ModifierStat.MaxHp:
                return 0.6;
            case ModifierStat.Attack or ModifierStat.Magic or ModifierStat.Armor or ModifierStat.Resist or ModifierStat.Speed or ModifierStat.CritChance:
                // The same relevance the generator spreads points with.
                return StatWeight((StatName)(int)modifier.Stat, heroClass, w) / w.Primary;
            case ModifierStat.DamageDealt:
                return support ? 0.3 : 0.8;
            case ModifierStat.HealDone:
                return support ? 1 : 0;
            case ModifierStat.DamageTaken:
                return heroClass.Role == Role.Tank ? 0.9 : 0.5;
            case ModifierStat.Range:
                return heroClass.Role == Role.Ranged || support ? 0.8 : 0.1;
            default:
                return 0.5;
        }
    }

    private static double ModifiersWorth(IReadOnlyList<Modifier> modifiers, HeroTemplate hero, ContentRegistry content)
    {
        double sum = 0;
        foreach (var m in modifiers) sum += ModifierWorth(m, hero, content);
        return sum;
    }

    private static double PerkWorth(Perk perk, HeroTemplate hero, ContentRegistry content) =>
        perk.AbilityMod is not null ? 0.7 : ModifiersWorth(perk.Modifiers, hero, content) + perk.Triggers.Count * 0.5;

    /// <summary>The ability to put an ability perk on: the highest tier, then the longest cooldown.</summary>
    private static string? BestTarget(HeroTemplate hero, Perk perk, ContentRegistry content)
    {
        static double Cd(AbilityCooldown c) => c.Once ? 99 : c.Turns;
        var ranked = JsSort.Stable(UpgradeRules.PerkTargets(hero, perk, content), (a, b) =>
        {
            var x = content.GetAbility(a);
            var y = content.GetAbility(b);
            double d = y.Tier - x.Tier;
            if (d == 0) d = Cd(y.Cooldown) - Cd(x.Cooldown);
            if (d != 0) return Math.Sign(d);
            return JsSort.Less(a, b) ? -1 : 1;
        });
        return ranked.FirstOrDefault();
    }

    public static PerkDecision ChoosePerk(RunState run, string heroId, ContentRegistry content, RngState rng)
    {
        var hero = run.Draft.Pool.FirstOrDefault(h => h.Id == heroId);
        var offers = run.Upgrade?.Offers.Get(heroId) ?? [];
        if (hero is null || offers.Count == 0) throw new InvalidOperationException($"choosePerk: nothing to choose for {heroId}");

        double noise = content.Config.Ai.Draft.Noise;
        var state = rng;
        Perk? best = null;
        double bestScore = double.NegativeInfinity;
        foreach (string id in offers)
        {
            var perk = content.Perks.Get(id);
            if (perk is null) continue;
            double score = PerkWorth(perk, hero, content);
            if (noise > 0)
            {
                var (jitter, next) = Rng.NextFloatBetween(state, -noise, noise);
                state = next;
                score *= 1 + jitter;
            }
            if (score > bestScore)
            {
                bestScore = score;
                best = perk;
            }
        }
        if (best is null) throw new InvalidOperationException($"choosePerk: no known perk offered to {heroId}");

        string? target = best.AbilityMod is null ? null : BestTarget(hero, best, content);
        return new PerkDecision(best.Id, target, state);
    }

    private static double PassiveWorth(Passive passive, HeroTemplate hero, ContentRegistry content) =>
        ModifiersWorth(passive.Modifiers, hero, content) + passive.Triggers.Count * 0.5;

    /// <summary>A tier IV ability is worth its damage and healing coefficients, weighted by the role.</summary>
    private static double UltimateWorth(Ability ability, HeroTemplate hero, ContentRegistry content)
    {
        bool support = content.GetClass(hero.ClassId).Role == Role.Support;
        double worth = 0;
        foreach (var effect in ability.Effects)
        {
            if (effect is DamageEffect damage) worth += damage.K * (damage.Hits ?? 1) * (support ? 0.6 : 1);
            else if (effect is HealEffect heal) worth += (heal.Full == true ? 2 : heal.K ?? 1) * (support ? 1 : 0.4);
            else worth += 0.4;
        }
        return worth;
    }

    public static UnlockDecision ChooseUnlock(RunState run, string heroId, ContentRegistry content, RngState rng)
    {
        var hero = run.Draft.Pool.FirstOrDefault(h => h.Id == heroId);
        var unlock = run.Upgrade?.Unlocks.Get(heroId);
        if (hero is null || unlock is null) throw new InvalidOperationException($"chooseUnlock: nothing to unlock for {heroId}");

        double noise = content.Config.Ai.Draft.Noise;
        var state = rng;
        string? best = null;
        double bestScore = double.NegativeInfinity;
        foreach (string id in unlock.Options)
        {
            var passive = unlock.Kind == UnlockKind.Passive ? content.Passives.Get(id) : null;
            var ability = unlock.Kind == UnlockKind.Ultimate ? content.Abilities.Get(id) : null;
            double score = passive is not null
                ? PassiveWorth(passive, hero, content)
                : ability is not null ? UltimateWorth(ability, hero, content) : double.NegativeInfinity;
            if (noise > 0)
            {
                var (jitter, next) = Rng.NextFloatBetween(state, -noise, noise);
                state = next;
                score *= 1 + jitter;
            }
            if (score > bestScore)
            {
                bestScore = score;
                best = id;
            }
        }
        return new UnlockDecision(best ?? throw new InvalidOperationException($"chooseUnlock: no known option for {heroId}"), state);
    }

    private static double ItemWorth(Item item, HeroTemplate hero, ContentRegistry content) =>
        ModifiersWorth(item.Modifiers, hero, content) + item.Triggers.Count * 0.5;

    /// <summary>
    /// The artifact and the hero it fits where it gains the most over what that hero already
    /// carries. The swap is decided first, so it counts.
    /// </summary>
    public static RewardDecision ChooseReward(RunState run, Side side, ContentRegistry content, RngState rng)
    {
        var offered = run.Upgrade?.Rewards.Of(side) ?? [];
        var team = run.Upgrade is null ? [] : UpgradeRules.TeamAfterSwap(run.Upgrade, run.Draft, side);

        double noise = content.Config.Ai.Draft.Noise;
        var state = rng;
        (string ItemId, string HeroId)? best = null;
        double bestScore = double.NegativeInfinity;
        foreach (string itemId in offered)
        {
            var item = content.Items.Get(itemId);
            if (item is null) continue;
            foreach (var hero in team)
            {
                if (!ItemRules.ItemFits(item, hero.ClassId, content)) continue;
                var current = hero.Item is null ? null : content.Items.Get(hero.Item);
                double score = ItemWorth(item, hero, content) - (current is null ? 0 : ItemWorth(current, hero, content));
                if (noise > 0)
                {
                    var (jitter, next) = Rng.NextFloatBetween(state, -noise, noise);
                    state = next;
                    score += Math.Abs(score) * jitter;
                }
                if (score > bestScore)
                {
                    bestScore = score;
                    best = (itemId, hero.Id);
                }
            }
        }
        if (best is null) throw new InvalidOperationException($"chooseReward: nothing {side} can carry");
        return new RewardDecision(best.Value.ItemId, best.Value.HeroId, state);
    }
}

/// <summary>
/// A whole run played headless, AI on both sides: a port of src/sim/series.ts playRun.
/// The parity tests use it to check the C# AI makes the same run as the TypeScript one.
/// </summary>
public static class AiRun
{
    public static RunState PlayRun(
        double seed,
        ContentRegistry content,
        AiProfile profileA,
        AiProfile profileB,
        Action<RunAction, RunState>? onRunAction = null)
    {
        var run = RunRules.CreateRun(seed, content);
        // The AI's own stream for draft and placement, apart from the run and the battles.
        var aiRng = Rng.Create(JsMath.ToInt32(seed) ^ 0x51ed270b);
        void Act(RunAction action)
        {
            run = RunRules.ApplyRunAction(run, action, content);
            onRunAction?.Invoke(action, run);
        }

        // A run is at most maxMatches matches long; the guard only catches a rules bug.
        for (int step = 0; step < 1000 && run.Phase != RunPhase.Finished; step++)
        {
            switch (run.Phase)
            {
                case RunPhase.Draft:
                {
                    var side = DraftRules.DraftTurn(run.Draft) ?? throw new InvalidOperationException("draft phase with no pick left");
                    var decision = RunAi.ChoosePick(run.Draft, content, aiRng);
                    aiRng = decision.Rng;
                    Act(new RunPick(side, decision.HeroId));
                    break;
                }
                case RunPhase.Placement:
                {
                    var decision = RunAi.ChoosePlacement(run, content, aiRng);
                    aiRng = decision.Rng;
                    var side = PlacementRules.PlacementTurn(run.Placement!) ?? throw new InvalidOperationException("placement phase with nobody to place");
                    Act(new RunPlace(side, decision.HeroId, decision.Hex));
                    break;
                }
                case RunPhase.Battle:
                {
                    var result = AiMatch.PlayBattle(RunRules.CreateRunBattle(run, content), content, profileA, profileB);
                    var outcome = result.Outcome ?? throw new InvalidOperationException($"match {run.Match} of run {seed} did not finish");
                    Act(new RunMatchEnded(outcome, result.Round) { Loot = result.Loot });
                    break;
                }
                case RunPhase.MatchOver:
                    Act(new RunNextMatch());
                    break;
                case RunPhase.Upgrade:
                    foreach (var side in new[] { Side.A, Side.B })
                    {
                        // The swap first: the newcomer may be the one the reward fits best.
                        var swap = RunAi.ChooseSwap(run, side, content);
                        if (swap is not null) Act(new RunSwapHero(side, swap.OutId, swap.InId));
                        aiRng = ChooseUpgrade(() => run, side, content, aiRng, Act);
                    }
                    Act(new RunReadyUpgrade(Side.A));
                    Act(new RunReadyUpgrade(Side.B));
                    break;
            }
        }
        return run;
    }

    /// <summary>
    /// The reward, the unlocks and the perks of one side, in that order, each applied
    /// through act; current gives the run as it is after the last one. Shared with the
    /// interface, where the AI opponent chooses the same way.
    /// </summary>
    public static RngState ChooseUpgrade(Func<RunState> current, Side side, ContentRegistry content, RngState aiRng, Action<RunAction> act)
    {
        var run = current();
        if (run.Upgrade is not null && UpgradeRules.AwaitingReward(run.Upgrade, run.Draft, side, content))
        {
            var decision = RunAi.ChooseReward(run, side, content, aiRng);
            aiRng = decision.Rng;
            act(new RunChooseReward(side, decision.ItemId, decision.HeroId));
        }
        run = current();
        foreach (string heroId in run.Upgrade is null ? [] : UpgradeRules.AwaitingUnlock(run.Upgrade, run.Draft, side))
        {
            var decision = RunAi.ChooseUnlock(current(), heroId, content, aiRng);
            aiRng = decision.Rng;
            act(new RunChooseUnlock(side, heroId, decision.OptionId));
        }
        run = current();
        foreach (string heroId in run.Upgrade is null ? [] : UpgradeRules.AwaitingPerk(run.Upgrade, run.Draft, side))
        {
            var decision = RunAi.ChoosePerk(current(), heroId, content, aiRng);
            aiRng = decision.Rng;
            act(new RunChoosePerk(side, heroId, decision.PerkId) { AbilityId = decision.AbilityId });
        }
        return aiRng;
    }
}
