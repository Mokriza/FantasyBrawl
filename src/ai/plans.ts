/**
 * Plan generation. See docs/ai/ai-opponent.md.
 *
 * A plan is the whole turn: move, act, maybe move and act again, then end. Trying
 * every ordering of four action points explodes, so the shape of a plan is fixed and
 * the second round of moves is kept short.
 */

import type { Ability, Action, BattleState, ContentRegistry, Hex } from '../core/index.js';
import {
  abilitiesOf,
  abilityAvailability,
  abilityLegality,
  abilityRange,
  allHexes,
  applyAction,
  distance,
  heroById,
  hexKey,
  livingHeroes,
  reachableFor,
  resolveTargets,
} from '../core/index.js';

export type Plan = readonly Action[];

const EVAL: { readonly deterministic: true } = { deterministic: true };

/** Atoms about the ground: they need no hero in the shape to do their work. */
const GROUND_ATOMS: ReadonlySet<string> = new Set(['teleport', 'terrain', 'summon']);

/**
 * How many landing hexes of a ground ability to try from each end: the ones closest
 * to an enemy (a trap, a summon, a wall in the way) and the farthest (an escape).
 */
const GROUND_AIMS_PER_END = 3;

/**
 * Hexes worth aiming an ability at: the ones where its shape touches somebody. An
 * area ability aimed at empty ground is dropped, which is most of the pruning.
 */
function aimPoints(
  state: BattleState,
  heroIdValue: string,
  ability: Ability,
  content: ContentRegistry,
): Hex[] {
  const hero = heroById(state, heroIdValue as never);
  const reach = abilityRange(state, hero, ability, content);
  const out: Hex[] = [];
  const ground: Hex[] = [];
  const onGround = ability.effects.some((e) => GROUND_ATOMS.has(e.type));

  for (const candidate of allHexes(state.arena)) {
    if (distance(hero.hex, candidate) > reach) continue;
    if (!abilityLegality(state, hero, ability, candidate, content).ok) continue;
    // A relocation has no hero target, so it is judged by the landing hex instead.
    const relocates = ability.effects.some((e) => e.type === 'move');
    if (!relocates && resolveTargets(state, hero, candidate, ability).length === 0) {
      if (onGround) ground.push(candidate);
      continue;
    }
    out.push(candidate);
  }
  return [...out, ...groundAims(state, hero.side, ground)];
}

/** A few landing hexes out of many, picked by how far they are from the enemy. */
function groundAims(state: BattleState, side: string, candidates: readonly Hex[]): Hex[] {
  const enemies = livingHeroes(state).filter((h) => h.side !== side && h.summon === null);
  if (enemies.length === 0 || candidates.length === 0) return [];
  const ranked = candidates
    .map((hex) => ({ hex, d: Math.min(...enemies.map((e) => distance(e.hex, hex))) }))
    .sort((a, b) => a.d - b.d || (hexKey(a.hex) < hexKey(b.hex) ? -1 : 1));
  const picked = [
    ...ranked.slice(0, GROUND_AIMS_PER_END),
    ...ranked.slice(Math.max(GROUND_AIMS_PER_END, ranked.length - GROUND_AIMS_PER_END)),
  ];
  return picked.map((entry) => entry.hex);
}

function abilityActions(
  state: BattleState,
  heroIdValue: string,
  content: ContentRegistry,
  allowUltimates: boolean,
): Action[] {
  const hero = heroById(state, heroIdValue as never);
  const out: Action[] = [];

  for (const ability of abilitiesOf(hero, content)) {
    if (!allowUltimates && ability.tier === 4) continue;
    if (!abilityAvailability(state, hero, ability, content).ok) continue;
    for (const target of aimPoints(state, heroIdValue, ability, content)) {
      out.push({
        type: 'ability',
        heroId: hero.id,
        abilityId: ability.id as never,
        target,
      });
    }
  }
  return out;
}

function moveActions(
  state: BattleState,
  heroIdValue: string,
  content: ContentRegistry,
  maxSteps: number,
): Action[] {
  const hero = heroById(state, heroIdValue as never);
  const out: Action[] = [];
  for (const entry of reachableFor(state, hero, content).values()) {
    if (entry.path.length > maxSteps) continue;
    out.push({ type: 'move', heroId: hero.id, path: entry.path });
  }
  return out;
}

export interface GeneratedPlan {
  readonly actions: Plan;
  readonly state: BattleState;
}

/**
 * Every plan worth looking at, already played out on a copy with the dice frozen so
 * the AI cannot see the roll the real action will make.
 */
export function generatePlans(
  state: BattleState,
  content: ContentRegistry,
  allowUltimates: boolean,
): GeneratedPlan[] {
  const activeId = state.activeHeroId;
  if (activeId === null) return [];

  const limit = content.config.ai.maxPlans;
  const plans: GeneratedPlan[] = [];
  const seen = new Set<string>();

  const record = (actions: Action[], result: BattleState): void => {
    if (plans.length >= limit) return;
    // Two different routes to the same board are the same plan as far as scoring goes.
    const key = actions
      .map((a) =>
        a.type === 'move'
          ? `m${a.path.map(hexKey).join('>')}`
          : a.type === 'ability'
            ? `a${a.abilityId}@${hexKey(a.target)}`
            : 'e',
      )
      .join('|');
    if (seen.has(key)) return;
    seen.add(key);
    plans.push({ actions, state: result });
  };

  const stillActing = (s: BattleState): boolean => s.activeHeroId === activeId && s.outcome === null;

  // Level 0: do nothing at all.
  record([], state);

  const firstMoves: Array<{ actions: Action[]; state: BattleState }> = [{ actions: [], state }];
  for (const move of moveActions(state, activeId, content, 4)) {
    const moved = applyAction(state, move, content, EVAL);
    if (!stillActing(moved.state)) {
      record([move], moved.state);
      continue;
    }
    firstMoves.push({ actions: [move], state: moved.state });
    record([move], moved.state);
  }

  for (const branch of firstMoves) {
    if (plans.length >= limit) break;

    for (const act of abilityActions(branch.state, activeId, content, allowUltimates)) {
      if (plans.length >= limit) break;
      const acted = applyAction(branch.state, act, content, EVAL);
      const afterOne = [...branch.actions, act];
      record(afterOne, acted.state);
      if (!stillActing(acted.state)) continue;

      // Second action from the same spot, then one more short hop and act again.
      for (const second of abilityActions(acted.state, activeId, content, allowUltimates)) {
        if (plans.length >= limit) break;
        const twice = applyAction(acted.state, second, content, EVAL);
        record([...afterOne, second], twice.state);
      }

      for (const hop of moveActions(acted.state, activeId, content, 2)) {
        if (plans.length >= limit) break;
        const hopped = applyAction(acted.state, hop, content, EVAL);
        record([...afterOne, hop], hopped.state);
        if (!stillActing(hopped.state)) continue;
        for (const third of abilityActions(hopped.state, activeId, content, allowUltimates)) {
          if (plans.length >= limit) break;
          const finished = applyAction(hopped.state, third, content, EVAL);
          record([...afterOne, hop, third], finished.state);
        }
      }
    }
  }

  return plans;
}

/** True when neither side has anyone left to fight. */
export function battleIsDecided(state: BattleState): boolean {
  if (state.outcome !== null) return true;
  const sides = new Set(livingHeroes(state).map((h) => h.side));
  return sides.size < 2;
}
