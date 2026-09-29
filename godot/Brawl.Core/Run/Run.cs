namespace Brawl.Core;

/// <summary>
/// A run: the draft, then a series of matches until one side has three wins. A port of
/// src/core/run/run.ts; see docs/ai/game-rules.md section 10.
///
/// Like a battle, a run is plain immutable data moved forward by ApplyRunAction, which
/// throws on anything illegal. The battle itself is not stored here: the run builds the
/// starting BattleState for each match and is told how it ended.
/// </summary>
public static class RunRules
{
    /// <summary>Salts that split one run seed into independent streams.</summary>
    private const int RunStream = 0x2545f491;
    private const int BattleStream = 0x68e31da4;

    public static RunState CreateRun(double seed, ContentRegistry content, Side? playerSide = null)
    {
        var rng = Rng.Create(JsMath.ToInt32(seed) ^ RunStream);

        // Who picks first is decided by a roll, as the design document asks.
        var (playerFirst, afterRoll) = Rng.Chance(rng, 0.5);
        var (pool, afterPool) = HeroGenerator.GeneratePool(content, afterRoll);

        return new RunState
        {
            Seed = seed,
            Rng = afterPool,
            Phase = RunPhase.Draft,
            PlayerSide = playerSide ?? (playerFirst ? Side.A : Side.B),
            Draft = DraftRules.CreateDraft(pool, content),
            Match = 1,
            Wins = new BySide<double>(0, 0),
            History = [],
            Placement = null,
            Upgrade = null,
            Modifier = null,
        };
    }

    /// <summary>
    /// The arena modifier for the match about to be prepared: one of those not yet played
    /// in this run, if the match is one of config.run.modifierMatches.
    /// </summary>
    private static (string? Modifier, RngState Rng) RollModifier(RunState run, int upcoming, ContentRegistry content)
    {
        if (!content.Config.Run.ModifierMatches.Contains(upcoming)) return (null, run.Rng);
        var played = run.History.Select(m => m.Modifier).ToHashSet();
        var all = JsSort.Stable(content.ArenaModifiers.Keys, JsSort.Compare);
        var fresh = all.Where(id => !played.Contains(id)).ToList();
        var pool = fresh.Count > 0 ? fresh : all;
        if (pool.Count == 0) return (null, run.Rng);
        return Rng.Pick(run.Rng, pool);
    }

    /// <summary>Every hero gains a level after every match, so the level is the match number.</summary>
    public static int HeroLevel(RunState run) => run.Match;

    public static Side OtherSide(Side side) => side == Side.A ? Side.B : Side.A;

    /// <summary>A fresh arena and an empty line-up for the next match.</summary>
    private static RunState ToPlacement(RunState run, ContentRegistry content)
    {
        var (arena, rng) = ArenaGenerator.Generate(run.Rng, content.Config);
        return run with { Rng = rng, Phase = RunPhase.Placement, Placement = PlacementRules.CreatePlacement(arena, content) };
    }

    private static void RequirePhase(RunState run, RunPhase phase, string what)
    {
        if (run.Phase != phase) throw new IllegalActionException($"{what}: the run is in phase {run.Phase}, not {phase}");
    }

    private static UpgradeState RequireUpgrade(RunState run) =>
        run.Upgrade ?? throw new InvalidOperationException("The run has no upgrade outside that phase");

    private static PlacementState RequirePlacement(RunState run) =>
        run.Placement ?? throw new InvalidOperationException("The run has no placement outside the draft");

    private static RunState PickHero(RunState run, Side side, string id, ContentRegistry content)
    {
        var draft = DraftRules.ApplyPick(run.Draft, side, id);
        var next = run with { Draft = draft };
        int picksLeft = draft.Order.Count - draft.Picks.A.Count - draft.Picks.B.Count;
        return picksLeft == 0 ? ToPlacement(next, content) : next;
    }

    public static RunState ApplyRunAction(RunState run, RunAction action, ContentRegistry content)
    {
        switch (action)
        {
            case RunPick pick:
                RequirePhase(run, RunPhase.Draft, "pick");
                return PickHero(run, pick.Side, pick.HeroId, content);

            case RunAutoPick auto:
            {
                RequirePhase(run, RunPhase.Draft, "autoPick");
                var left = DraftRules.AvailableHeroes(run.Draft);
                if (left.Count == 0) throw new IllegalActionException("autoPick: the pool is empty");
                var (hero, rng) = Rng.Pick(run.Rng, left);
                return PickHero(run with { Rng = rng }, auto.Side, hero.Id, content);
            }

            case RunPlace place:
            {
                RequirePhase(run, RunPhase.Placement, "place");
                var placement = PlacementRules.ApplyPlace(
                    RequirePlacement(run), run.Draft.Picks.Of(place.Side), place.Side, place.HeroId, place.Hex, content.Config);
                bool done = placement.Placed.Count == placement.Order.Count;
                return run with { Placement = placement, Phase = done ? RunPhase.Battle : RunPhase.Placement };
            }

            case RunMatchEnded ended:
            {
                RequirePhase(run, RunPhase.Battle, "matchEnded");
                var winner = ended.Outcome.Winner;
                var wins = run.Wins.With(winner, run.Wins.Of(winner) + 1);
                var history = run.History.Append(new MatchRecord(run.Match, winner, ended.Outcome.Reason, ended.Rounds, run.Modifier)).ToList();
                bool over = wins.Of(winner) >= content.Config.Run.WinsToFinish || history.Count >= content.Config.Run.MaxMatches;
                // Artifacts won in the match ("Древний страж") stay with their heroes.
                var loot = ended.Loot ?? [];
                var draft = loot.Count == 0
                    ? run.Draft
                    : run.Draft with
                    {
                        Pool = run.Draft.Pool.Select(hero =>
                        {
                            var won = loot.FirstOrDefault(l => l.HeroId == hero.Id);
                            return won is null ? hero : hero with { Item = won.ItemId };
                        }).ToList(),
                    };
                return run with { Draft = draft, Wins = wins, History = history, Phase = over ? RunPhase.Finished : RunPhase.MatchOver };
            }

            case RunNextMatch:
            {
                // A new level for everyone, then the perks that go with it.
                RequirePhase(run, RunPhase.MatchOver, "nextMatch");
                var (upgrade, afterUpgrade) = UpgradeRules.CreateUpgrade(run.Draft, content, run.Rng, run.Match, run.Wins);
                // Announced now, before the upgrade phase, so both sides can prepare for it.
                var (modifier, rng) = RollModifier(run with { Rng = afterUpgrade }, run.Match + 1, content);
                return run with { Rng = rng, Match = run.Match + 1, Phase = RunPhase.Upgrade, Upgrade = upgrade, Modifier = modifier };
            }

            case RunChoosePerk perk:
            {
                RequirePhase(run, RunPhase.Upgrade, "choosePerk");
                var upgrade = UpgradeRules.ApplyChoosePerk(
                    RequireUpgrade(run), run.Draft, perk.Side, perk.HeroId, perk.PerkId, perk.AbilityId, content);
                return run with { Upgrade = UpgradeRules.ClearReady(upgrade, perk.Side) };
            }

            case RunChooseUnlock unlock:
            {
                RequirePhase(run, RunPhase.Upgrade, "chooseUnlock");
                var upgrade = UpgradeRules.ApplyChooseUnlock(RequireUpgrade(run), run.Draft, unlock.Side, unlock.HeroId, unlock.OptionId);
                return run with { Upgrade = UpgradeRules.ClearReady(upgrade, unlock.Side) };
            }

            case RunChooseReward reward:
            {
                RequirePhase(run, RunPhase.Upgrade, "chooseReward");
                var upgrade = UpgradeRules.ApplyChooseReward(RequireUpgrade(run), run.Draft, reward.Side, reward.ItemId, reward.HeroId, content);
                return run with { Upgrade = UpgradeRules.ClearReady(upgrade, reward.Side) };
            }

            case RunSwapHero swap:
            {
                RequirePhase(run, RunPhase.Upgrade, "swapHero");
                var upgrade = UpgradeRules.ApplySwapHero(RequireUpgrade(run), run.Draft, swap.Side, swap.OutId, swap.InId);
                return run with { Upgrade = UpgradeRules.ClearReady(upgrade, swap.Side) };
            }

            case RunCancelSwap cancel:
            {
                RequirePhase(run, RunPhase.Upgrade, "cancelSwap");
                var upgrade = UpgradeRules.ApplyCancelSwap(RequireUpgrade(run), run.Draft, cancel.Side);
                return run with { Upgrade = UpgradeRules.ClearReady(upgrade, cancel.Side) };
            }

            case RunReadyUpgrade ready:
            {
                // Each side says when it is done; the phase moves on once both have.
                RequirePhase(run, RunPhase.Upgrade, "readyUpgrade");
                var upgrade = RequireUpgrade(run);
                var waiting = UpgradeRules.WaitingFor(upgrade, run.Draft, ready.Side, content);
                if (waiting.Count > 0)
                    throw new IllegalActionException($"readyUpgrade: {string.Join(", ", waiting)} of side {ready.Side} still to choose");
                var next = upgrade with { Ready = upgrade.Ready.With(ready.Side, true) };
                if (next.Ready.A != true || next.Ready.B != true) return run with { Upgrade = next };
                var draft = UpgradeRules.CommitUpgrade(next, run.Draft);
                return ToPlacement(run with { Draft = draft, Upgrade = null }, content);
            }

            case RunUnreadyUpgrade unready:
                RequirePhase(run, RunPhase.Upgrade, "unreadyUpgrade");
                return run with { Upgrade = UpgradeRules.ClearReady(RequireUpgrade(run), unready.Side) };

            default:
                throw new InvalidOperationException($"Unhandled run action: {action.Type}");
        }
    }

    /// <summary>The side that won the run, or null while it is still going.</summary>
    public static Side? RunWinner(RunState run, ContentRegistry content)
    {
        if (run.Phase != RunPhase.Finished) return null;
        double need = content.Config.Run.WinsToFinish;
        if (run.Wins.A >= need) return Side.A;
        if (run.Wins.B >= need) return Side.B;
        // The match limit ran out first.
        return run.Wins.A > run.Wins.B ? Side.A : Side.B;
    }

    /// <summary>Each match gets its own battle seed, derived from the run seed: `((seed ^ S) + match * 0x9e3779b1) >>> 0`.</summary>
    public static double BattleSeed(RunState run)
    {
        double sum = (JsMath.ToInt32(run.Seed) ^ BattleStream) + run.Match * 2654435761.0;
        return unchecked((uint)JsMath.ToInt32(sum));
    }

    private static TeamHero ToTeamHero(HeroTemplate hero, Side side, Hex at, int level, ContentRegistry content)
    {
        var (col, row) = HexMath.AxialToOffset(at);
        var s = UpgradeRules.WithPerkHealth(Levels.StatsAtLevel(hero, level, content), hero.Perks, content, hero.Item);
        return new TeamHero
        {
            Id = hero.Id,
            Name = hero.Name,
            Class = hero.ClassId,
            Side = side,
            At = [col, row],
            Stats = new TeamStats(s.MaxHp, s.Attack, s.Magic, s.Armor, s.Resist, s.Speed, s.CritChance),
            Abilities = hero.Abilities.ToList(),
            Passive = hero.Passive,
            Item = hero.Item,
            Race = hero.Race,
            Perks = hero.Perks.Select(p => new TeamPerk { PerkId = p.PerkId, AbilityId = p.AbilityId }).ToList(),
        };
    }

    /// <summary>A drafted hero at the current level, standing where it was placed.</summary>
    private static TeamHero PlacedTeamHero(HeroTemplate hero, Side side, RunState run, ContentRegistry content)
    {
        var spot = RequirePlacement(run).Placed.FirstOrDefault(p => p.HeroId == hero.Id)
            ?? throw new InvalidOperationException($"Hero {hero.Id} was never placed");
        return ToTeamHero(hero, side, spot.Hex, HeroLevel(run), content);
    }

    private static IReadOnlyList<string> ModifiersOf(RunState run) => run.Modifier is null ? [] : [run.Modifier];

    /// <summary>The starting state of the current match. Only valid once everyone is placed.</summary>
    public static BattleState CreateRunBattle(RunState run, ContentRegistry content)
    {
        RequirePhase(run, RunPhase.Battle, "createRunBattle");
        var heroes = new[] { Side.A, Side.B }
            .SelectMany(side => DraftRules.TeamOf(run.Draft, side).Select(hero => PlacedTeamHero(hero, side, run, content)))
            .ToList();
        return BattleSetup.CreateBattle(BattleSeed(run), new Teams { Heroes = heroes }, content, RequirePlacement(run).Arena, ModifiersOf(run));
    }

    /// <summary>A drafted or pooled hero as a BattleHero standing nowhere in particular, for its card.</summary>
    public static BattleHero PreviewHero(HeroTemplate hero, int level, Side side, ContentRegistry content) =>
        BattleSetup.ToBattleHero(ToTeamHero(hero, side, HexMath.OffsetToAxial(0, 0), level, content), content);

    /// <summary>The line-up placed so far as a battle nobody plays, so the board can draw it during placement.</summary>
    public static BattleState PlacementPreview(RunState run, ContentRegistry content)
    {
        var placement = RequirePlacement(run);
        var heroes = placement.Placed.Select(spot =>
        {
            var hero = run.Draft.Pool.FirstOrDefault(h => h.Id == spot.HeroId)
                ?? throw new InvalidOperationException($"Placed hero {spot.HeroId} is not in the pool");
            return PlacedTeamHero(hero, spot.Side, run, content);
        }).ToList();
        return BattleSetup.CreateBattle(BattleSeed(run), new Teams { Heroes = heroes }, content, placement.Arena, ModifiersOf(run));
    }

    /// <summary>
    /// A battle holding only this hero on an empty board, so ability texts and stats can be
    /// worked out outside a real match: modifiers need a battle to read.
    /// </summary>
    public static BattleState PreviewBattle(HeroTemplate hero, int level, Side side, ContentRegistry content)
    {
        var entry = PreviewHero(hero, level, side, content);
        var empty = BattleSetup.CreateBattle(0, new Teams { Heroes = [] }, content, Terrain.EmptyArena(content.Config));
        return empty with { Heroes = OrderedMap<BattleHero>.Empty.Set(entry.Id, entry) };
    }
}
