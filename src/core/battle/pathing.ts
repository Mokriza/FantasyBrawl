/**
 * Reachable hexes and shortest paths. See docs/ai/hex-grid.md.
 *
 * Step cost is 1, plus the pit surcharge for entering a pit. Zone of control no
 * longer adds AP (see opportunity.ts), but it does decide which paths hurt, so every
 * reachable hex also reports which enemies would react along the way.
 *
 * With 49 hexes a plain array beats a heap, so there is no heap here.
 */

import { blocksMovement, inBounds, isPit } from '../arena/terrain.js';
import type { ContentRegistry } from '../content.js';
import { DIRECTIONS, hexAdd, hexKey } from '../hex.js';
import type { Hex } from '../hex.js';
import type { BattleHero, BattleState, HeroId } from '../types.js';
import { isOccupied } from './query.js';
import { reactorsForStep } from './opportunity.js';
import { modifierSum } from './modifiers.js';

export interface Reachable {
  readonly cost: number;
  /** Steps from the hero's hex to this one, excluding the starting hex. */
  readonly path: readonly Hex[];
  /** Enemies that would take a free swing along this path, in firing order. */
  readonly provokes: readonly HeroId[];
}

interface Label extends Reachable {
  /** Direction indices taken, used only as the last tie-break. */
  readonly dirs: readonly number[];
}

/**
 * Cheapest first; then the path that gets hit least; then the shortest walk; then the
 * DIRECTIONS order. Fully deterministic, which the replay and the AI both rely on.
 */
function isBetter(candidate: Label, current: Label | undefined): boolean {
  if (current === undefined) return true;
  if (candidate.cost !== current.cost) return candidate.cost < current.cost;
  if (candidate.provokes.length !== current.provokes.length) {
    return candidate.provokes.length < current.provokes.length;
  }
  if (candidate.path.length !== current.path.length) return candidate.path.length < current.path.length;
  for (let i = 0; i < candidate.dirs.length; i++) {
    const a = candidate.dirs[i] ?? 0;
    const b = current.dirs[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

export function stepCost(state: BattleState, content: ContentRegistry, to: Hex, hero?: BattleHero): number {
  const base = content.config.battle.moveCost;
  const surcharge = isPit(state.arena, to) && (hero === undefined || !pitImmune(state, hero, content));
  return base + (surcharge ? content.config.arena.pit.extraApCost : 0);
}

/** "Босые ноги": a pit is ordinary ground to this hero. */
export function pitImmune(state: BattleState, hero: BattleHero, content: ContentRegistry): boolean {
  return modifierSum(state, hero, 'pitImmune', content).add > 0;
}

export function isPassable(state: BattleState, to: Hex): boolean {
  return inBounds(to, state.arena) && !blocksMovement(state.arena, to) && !isOccupied(state, to);
}

/**
 * Every hex the hero can afford to reach. The path carried by each entry is the one
 * the interface highlights and the one applyAction will re-check.
 *
 * The provoke set depends on the whole path, not just the last step, so this relaxes
 * labels until nothing improves rather than settling each hex once. On 49 hexes that
 * costs nothing and keeps the rule honest.
 */
export function reachableHexes(
  state: BattleState,
  hero: BattleHero,
  apBudget: number,
  content: ContentRegistry,
): Map<string, Reachable> {
  const labels = new Map<string, Label>();
  const start: Label = { cost: 0, path: [], provokes: [], dirs: [] };
  labels.set(hexKey(hero.hex), start);

  let changed = true;
  let guard = 0;
  while (changed && guard < state.arena.cols * state.arena.rows + 2) {
    changed = false;
    guard++;
    for (const [key, label] of [...labels]) {
      const from = label.path.length === 0 ? hero.hex : (label.path[label.path.length - 1] as Hex);
      if (hexKey(from) !== key) continue;

      for (let dir = 0; dir < DIRECTIONS.length; dir++) {
        const step = DIRECTIONS[dir];
        if (step === undefined) continue;
        const to = hexAdd(from, step);
        if (!isPassable(state, to)) continue;

        const cost = label.cost + stepCost(state, content, to, hero);
        if (cost > apBudget) continue;

        const already = [...hero.reactedThisTurn, ...label.provokes];
        const reacting = reactorsForStep(state, hero, from, to, already, content).map((e) => e.id);

        const candidate: Label = {
          cost,
          path: [...label.path, to],
          provokes: [...label.provokes, ...reacting],
          dirs: [...label.dirs, dir],
        };
        if (isBetter(candidate, labels.get(hexKey(to)))) {
          labels.set(hexKey(to), candidate);
          changed = true;
        }
      }
    }
  }

  labels.delete(hexKey(hero.hex));
  const out = new Map<string, Reachable>();
  for (const [key, label] of labels) {
    out.set(key, { cost: label.cost, path: label.path, provokes: label.provokes });
  }
  return out;
}

/** Cost of a path the caller already has, or null when the path is not walkable. */
export function pathCost(
  state: BattleState,
  content: ContentRegistry,
  from: Hex,
  path: readonly Hex[],
): number | null {
  let current = from;
  let total = 0;
  for (const to of path) {
    const adjacent = DIRECTIONS.some((d) => {
      const n = hexAdd(current, d);
      return n.q === to.q && n.r === to.r;
    });
    if (!adjacent || !isPassable(state, to)) return null;
    total += stepCost(state, content, to);
    current = to;
  }
  return total;
}
