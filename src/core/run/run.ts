/**
 * A run: the draft, then a series of matches until one side has three wins.
 * See docs/ai/game-rules.md section 10.
 *
 * Like a battle, a run is plain immutable data moved forward by applyRunAction,
 * which throws on anything illegal. The battle itself is not stored here: the run
 * builds the starting BattleState for each match and is told how it ended.
 *
 * Between matches everyone is healed (a new battle starts from full health anyway),
 * gains a level and takes a perk in the upgrade phase, alongside the unlocks, the
 * reward and an optional hero swap.
 */

import { emptyArena, generateArena } from '../arena/generate.js';
import type { ContentRegistry, TeamHero } from '../content.js';
import { applyPick, availableHeroes, createDraft, teamOf } from '../draft/draft.js';
import { generatePool } from '../draft/generate.js';
import { axialToOffset } from '../hex.js';
import { chance, createRng, pick } from '../rng.js';
import type { RngState } from '../rng.js';
import { createBattle, toBattleHero } from '../battle/state.js';
import type {
  BattleHero,
  BattleState,
  HeroId,
  HeroTemplate,
  PlacementState,
  RunAction,
  RunState,
  Side,
  UpgradeState,
} from '../types.js';
import { IllegalActionError, assertNever } from '../types.js';
import { statsAtLevel } from './levels.js';
import { applyPlace, createPlacement } from './placement.js';
import {
  applyCancelSwap,
  applyChooseReward,
  applyChooseUnlock,
  applyChoosePerk,
  applySwapHero,
  awaitingPerk,
  awaitingReward,
  awaitingUnlock,
  commitUpgrade,
  createUpgrade,
  withPerkHealth,
} from './upgrade.js';

/** Salts that split one run seed into independent streams. */
const RUN_STREAM = 0x2545f491;
const BATTLE_STREAM = 0x68e31da4;

export interface CreateRunOptions {
  readonly seed: number;
  readonly content: ContentRegistry;
  /** Pin the local player's side in a test; otherwise it is rolled. */
  readonly playerSide?: Side;
}

export function createRun(options: CreateRunOptions): RunState {
  const { seed, content } = options;
  let rng: RngState = createRng(seed ^ RUN_STREAM);

  // Who picks first is decided by a roll, as the design document asks.
  const [playerFirst, afterRoll] = chance(rng, 0.5);
  rng = afterRoll;
  const [pool, afterPool] = generatePool(content, rng);
  rng = afterPool;

  return {
    seed,
    rng,
    phase: 'draft',
    playerSide: options.playerSide ?? (playerFirst ? 'A' : 'B'),
    draft: createDraft(pool, content),
    match: 1,
    wins: { A: 0, B: 0 },
    history: [],
    placement: null,
    upgrade: null,
    modifier: null,
  };
}

/**
 * The arena modifier for the match about to be prepared: one of those not yet played
 * in this run, from the run stream, if the match is one of config.run.modifierMatches.
 * [decision] No repeats within a run while there are others to choose from.
 */
function rollModifier(run: RunState, upcoming: number, content: ContentRegistry): [string | null, RngState] {
  if (!content.config.run.modifierMatches.includes(upcoming)) return [null, run.rng];
  const played = new Set(run.history.map((m) => m.modifier));
  const all = Object.keys(content.arenaModifiers).sort();
  const fresh = all.filter((id) => !played.has(id));
  const pool = fresh.length > 0 ? fresh : all;
  if (pool.length === 0) return [null, run.rng];
  return pick(run.rng, pool);
}

/** Every hero gains a level after every match, so the level is the match number. */
export function heroLevel(run: RunState): number {
  return run.match;
}

export function otherSide(side: Side): Side {
  return side === 'A' ? 'B' : 'A';
}

/** A fresh arena and an empty line-up for the next match. */
function toPlacement(run: RunState, content: ContentRegistry): RunState {
  const [arena, rng] = generateArena(run.rng, content.config);
  return { ...run, rng, phase: 'placement', placement: createPlacement(arena, content) };
}

function requirePhase(run: RunState, phase: RunState['phase'], what: string): void {
  if (run.phase !== phase) {
    throw new IllegalActionError(`${what}: the run is in phase ${run.phase}, not ${phase}`);
  }
}

function requireUpgrade(run: RunState): UpgradeState {
  if (run.upgrade === null) throw new Error('The run has no upgrade outside that phase');
  return run.upgrade;
}

function requirePlacement(run: RunState): PlacementState {
  if (run.placement === null) throw new Error('The run has no placement outside the draft');
  return run.placement;
}

function pickHero(run: RunState, side: Side, id: HeroId, content: ContentRegistry): RunState {
  const draft = applyPick(run.draft, side, id);
  const next = { ...run, draft };
  const picksLeft = draft.order.length - draft.picks.A.length - draft.picks.B.length;
  return picksLeft === 0 ? toPlacement(next, content) : next;
}

export function applyRunAction(
  run: RunState,
  action: RunAction,
  content: ContentRegistry,
): RunState {
  switch (action.type) {
    case 'pick':
      requirePhase(run, 'draft', 'pick');
      return pickHero(run, action.side, action.heroId, content);

    case 'autoPick': {
      requirePhase(run, 'draft', 'autoPick');
      const left = availableHeroes(run.draft);
      if (left.length === 0) throw new IllegalActionError('autoPick: the pool is empty');
      const [hero, rng] = pick(run.rng, left);
      return pickHero({ ...run, rng }, action.side, hero.id, content);
    }

    case 'place': {
      requirePhase(run, 'placement', 'place');
      const placement = applyPlace(
        requirePlacement(run),
        run.draft.picks[action.side],
        action.side,
        action.heroId,
        action.hex,
        content.config,
      );
      const done = placement.placed.length === placement.order.length;
      return { ...run, placement, phase: done ? 'battle' : 'placement' };
    }

    case 'matchEnded': {
      requirePhase(run, 'battle', 'matchEnded');
      const winner = action.outcome.winner;
      const wins = { ...run.wins, [winner]: run.wins[winner] + 1 };
      const history = [
        ...run.history,
        { match: run.match, winner, reason: action.outcome.reason, rounds: action.rounds, modifier: run.modifier },
      ];
      const over =
        wins[winner] >= content.config.run.winsToFinish ||
        history.length >= content.config.run.maxMatches;
      return { ...run, wins, history, phase: over ? 'finished' : 'matchOver' };
    }

    case 'nextMatch': {
      // A new level for everyone, then the perks that go with it.
      requirePhase(run, 'matchOver', 'nextMatch');
      const [upgrade, afterUpgrade] = createUpgrade(run.draft, content, run.rng, run.match, run.wins);
      // Announced now, before the upgrade phase, so both sides can prepare for it.
      const [modifier, rng] = rollModifier({ ...run, rng: afterUpgrade }, run.match + 1, content);
      return { ...run, rng, match: run.match + 1, phase: 'upgrade', upgrade, modifier };
    }

    case 'choosePerk': {
      requirePhase(run, 'upgrade', 'choosePerk');
      const upgrade = applyChoosePerk(
        requireUpgrade(run),
        run.draft,
        action.side,
        action.heroId,
        action.perkId,
        action.abilityId,
        content,
      );
      return { ...run, upgrade };
    }

    case 'chooseUnlock': {
      requirePhase(run, 'upgrade', 'chooseUnlock');
      const upgrade = applyChooseUnlock(requireUpgrade(run), run.draft, action.side, action.heroId, action.optionId);
      return { ...run, upgrade };
    }

    case 'chooseReward': {
      requirePhase(run, 'upgrade', 'chooseReward');
      const upgrade = applyChooseReward(requireUpgrade(run), run.draft, action.side, action.itemId, action.heroId, content);
      return { ...run, upgrade };
    }

    case 'swapHero': {
      requirePhase(run, 'upgrade', 'swapHero');
      const upgrade = applySwapHero(requireUpgrade(run), run.draft, action.side, action.outId, action.inId);
      return { ...run, upgrade };
    }

    case 'cancelSwap': {
      requirePhase(run, 'upgrade', 'cancelSwap');
      return { ...run, upgrade: applyCancelSwap(requireUpgrade(run), run.draft, action.side) };
    }

    case 'endUpgrade': {
      requirePhase(run, 'upgrade', 'endUpgrade');
      const upgrade = requireUpgrade(run);
      for (const side of ['A', 'B'] as const) {
        const waiting: string[] = [...awaitingPerk(upgrade, run.draft, side), ...awaitingUnlock(upgrade, run.draft, side)];
        if (awaitingReward(upgrade, run.draft, side, content)) waiting.push('the reward');
        if (waiting.length > 0) {
          throw new IllegalActionError(`endUpgrade: ${waiting.join(', ')} of side ${side} still to choose`);
        }
      }
      const draft = commitUpgrade(upgrade, run.draft);
      return toPlacement({ ...run, draft, upgrade: null }, content);
    }

    default:
      return assertNever(action);
  }
}

/** The side that won the run, or null while it is still going. */
export function runWinner(run: RunState, content: ContentRegistry): Side | null {
  if (run.phase !== 'finished') return null;
  const need = content.config.run.winsToFinish;
  if (run.wins.A >= need) return 'A';
  if (run.wins.B >= need) return 'B';
  // The match limit ran out first, which three wins make impossible without draws.
  return run.wins.A > run.wins.B ? 'A' : 'B';
}

/** Each match gets its own battle seed, derived from the run seed. */
export function battleSeed(run: RunState): number {
  return ((run.seed ^ BATTLE_STREAM) + run.match * 0x9e3779b1) >>> 0;
}

/** A drafted hero at the current level, in the shape the battle builder takes. */
function toTeamHero(
  hero: HeroTemplate,
  side: Side,
  run: RunState,
  content: ContentRegistry,
): TeamHero {
  const spot = requirePlacement(run).placed.find((p) => p.heroId === hero.id);
  if (spot === undefined) throw new Error(`Hero ${hero.id} was never placed`);
  const { col, row } = axialToOffset(spot.hex);
  return {
    id: hero.id,
    name: hero.name,
    class: hero.classId,
    side,
    at: [col, row],
    stats: withPerkHealth(statsAtLevel(hero, heroLevel(run), content), hero.perks, content, hero.item),
    abilities: [...hero.abilities],
    ...(hero.passive === null ? {} : { passive: hero.passive }),
    ...(hero.item === null ? {} : { item: hero.item }),
    race: hero.race,
    perks: hero.perks.map((p) => ({ ...p })),
  };
}

/** The starting state of the current match. Only valid once everyone is placed. */
export function createRunBattle(run: RunState, content: ContentRegistry): BattleState {
  requirePhase(run, 'battle', 'createRunBattle');
  const heroes = (['A', 'B'] as const).flatMap((side) =>
    teamOf(run.draft, side).map((hero) => toTeamHero(hero, side, run, content)),
  );
  return createBattle({
    seed: battleSeed(run),
    teams: { heroes },
    content,
    arena: requirePlacement(run).arena,
    modifiers: run.modifier === null ? [] : [run.modifier],
  });
}

/**
 * A drafted or pooled hero as a BattleHero standing nowhere in particular, so the
 * interface can show their card and fill in ability numbers outside a battle.
 */
export function previewHero(
  hero: HeroTemplate,
  level: number,
  side: Side,
  content: ContentRegistry,
): BattleHero {
  return toBattleHero(
    {
      id: hero.id,
      name: hero.name,
      class: hero.classId,
      side,
      at: [0, 0],
      stats: withPerkHealth(statsAtLevel(hero, level, content), hero.perks, content, hero.item),
      abilities: [...hero.abilities],
      ...(hero.passive === null ? {} : { passive: hero.passive }),
      ...(hero.item === null ? {} : { item: hero.item }),
      race: hero.race,
      perks: hero.perks.map((p) => ({ ...p })),
    },
    content,
  );
}

/**
 * The line-up placed so far as a battle state nobody plays, so the interface can draw
 * the arena and the heroes on it during placement with the ordinary board.
 */
export function placementPreview(run: RunState, content: ContentRegistry): BattleState {
  const placement = requirePlacement(run);
  const heroes = placement.placed.map((spot) => {
    const hero = run.draft.pool.find((h) => h.id === spot.heroId);
    if (hero === undefined) throw new Error(`Placed hero ${spot.heroId} is not in the pool`);
    return toTeamHero(hero, spot.side, run, content);
  });
  return createBattle({
    seed: battleSeed(run),
    teams: { heroes },
    content,
    arena: placement.arena,
    modifiers: run.modifier === null ? [] : [run.modifier],
  });
}

/**
 * A battle holding only this hero on an empty board, so ability texts and stats can
 * be worked out outside a real match: modifiers need a battle to read.
 */
export function previewBattle(
  hero: HeroTemplate,
  level: number,
  side: Side,
  content: ContentRegistry,
): BattleState {
  const entry = previewHero(hero, level, side, content);
  return {
    ...createBattle({ seed: 0, teams: { heroes: [] }, content, arena: emptyArena(content.config) }),
    heroes: { [entry.id]: entry },
  };
}
