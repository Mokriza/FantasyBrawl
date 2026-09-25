/**
 * Arena modifiers: one rule set for a whole match, see docs/ai/game-rules.md,
 * "Модификаторы арены". Content gives the numbers; this is the one place that knows
 * what each kind means. The battle asks here instead of reading the ids itself.
 */

import type { ArenaModifierRules, ContentRegistry } from '../content.js';
import type { Arena, BattleState } from '../types.js';
import { axialToOffset, hexKey, offsetToAxial } from '../hex.js';
import type { Hex } from '../hex.js';
import { allHexes } from './terrain.js';

/** The rules of every modifier this battle runs with. */
function rulesOf(state: BattleState, content: ContentRegistry): ArenaModifierRules[] {
  return state.modifiers.flatMap((id) => {
    const modifier = content.arenaModifiers[id];
    return modifier === undefined ? [] : [modifier.rules];
  });
}

function find<K extends ArenaModifierRules['kind']>(
  state: BattleState,
  content: ContentRegistry,
  kind: K,
): Extract<ArenaModifierRules, { kind: K }> | undefined {
  return rulesOf(state, content).find((r): r is Extract<ArenaModifierRules, { kind: K }> => r.kind === kind);
}

/** "Шторм маны": extra turns every cooldown loses at the end of a turn. */
export function cooldownBonus(state: BattleState, content: ContentRegistry): number {
  return find(state, content, 'manaStorm')?.cooldownBonus ?? 0;
}

/** "Шторм маны": what damage over time is multiplied by. */
export function dotMultiplier(state: BattleState, content: ContentRegistry): number {
  return find(state, content, 'manaStorm')?.dotMultiplier ?? 1;
}

/** "Кровавая жатва": what every heal is multiplied by. */
export function healMultiplier(state: BattleState, content: ContentRegistry): number {
  return find(state, content, 'bloodHarvest')?.healMultiplier ?? 1;
}

/** "Кровавая жатва": initiative a killer gains. */
export function killAtb(state: BattleState, content: ContentRegistry): number {
  return find(state, content, 'bloodHarvest')?.killAtb ?? 0;
}

/** "Густой туман": how far anyone sees, or null when sight is only stopped by terrain. */
export function sightRange(state: BattleState, content: ContentRegistry): number | null {
  return find(state, content, 'fog')?.sightRange ?? null;
}

/** "Сужающаяся арена": damage for standing on a collapsed hex at the start of a turn. */
export function collapseDamage(state: BattleState, content: ContentRegistry): number {
  return find(state, content, 'shrink')?.ringDamage ?? 0;
}

/** How far a hex is from the edge: 0 for the outer ring, 1 for the next, and so on. */
export function ringOf(h: Hex, arena: Arena): number {
  const { col, row } = axialToOffset(h);
  return Math.min(col, row, arena.cols - 1 - col, arena.rows - 1 - row);
}

/**
 * "Сужающаяся арена": the hexes that should have collapsed by this round and have
 * not yet. Ring k goes once k + 1 whole stretches of everyRounds rounds are over; the
 * innermost ring never goes, so there is always somewhere to stand.
 */
export function hexesToCollapse(state: BattleState, content: ContentRegistry): Hex[] {
  const shrink = find(state, content, 'shrink');
  if (shrink === undefined) return [];
  const innermost = Math.floor((Math.min(state.arena.cols, state.arena.rows) - 1) / 2);
  const rings = Math.min(innermost, Math.floor((state.round - 1) / shrink.everyRounds));
  return allHexes(state.arena).filter(
    (h) => ringOf(h, state.arena) < rings && state.arena.terrain[hexKey(h)] !== 'collapse',
  );
}

/** The centre of the board: where "Точка силы" and "Древний страж" stand. */
export function centreHex(arena: Arena): Hex {
  return offsetToAxial(Math.floor(arena.cols / 2), Math.floor(arena.rows / 2));
}

/** "Точка силы": the damage share whoever stands on the centre adds, else 0. */
export function pointBonus(state: BattleState, at: Hex, content: ContentRegistry): number {
  const point = find(state, content, 'powerPoint');
  if (point === undefined) return 0;
  return hexKey(at) === hexKey(centreHex(state.arena)) ? point.damageBonus : 0;
}

/** "Точка силы": rounds of holding that win, or null without the modifier. */
export function holdToWin(state: BattleState, content: ContentRegistry): number | null {
  return find(state, content, 'powerPoint')?.holdRounds ?? null;
}
