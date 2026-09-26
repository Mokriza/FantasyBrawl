/**
 * The Monk's rules: the cone, parry, flow and the flow state, and the three passives.
 * The dice are frozen.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { DIRECTIONS, axialToOffset, distance, hexAdd, hexKey, nearestDirection } from '../../hex.js';
import type { Hex } from '../../hex.js';
import { at, scenario } from '../../testing/scenario.js';
import type { ScenarioHero } from '../../testing/scenario.js';
import { applyAction } from '../apply.js';
import { statsInBattle } from '../modifiers.js';
import { reachableFor } from '../legal.js';
import { heroById } from '../query.js';
import { statusesOf } from '../statuses.js';
import { abilityId, heroId, statusId } from '../../types.js';
import type { BattleEvent, BattleState } from '../../types.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

const FROZEN = { deterministic: true } as const;

function board(monk: Partial<ScenarioHero>, others: Record<string, ScenarioHero>, ap = 8): BattleState {
  let s = scenario(content).seed(5).hero('m', { cls: 'monk', side: 'A', at: [3, 3], attack: 20, ...monk });
  for (const [id, spec] of Object.entries(others)) s = s.hero(id, spec);
  return s.active('m', { ap }).build();
}

function act(state: BattleState, ability: string, target: Hex, hero = 'm') {
  return applyAction(
    state,
    { type: 'ability', heroId: heroId(hero), abilityId: abilityId(ability), target },
    content,
    FROZEN,
  );
}

function dealt(events: readonly BattleEvent[], target: string): number {
  return events.reduce((sum, e) => sum + (e.type === 'damaged' && e.targetId === target ? e.amount : 0), 0);
}

const foe = (where: [number, number], extra: Partial<ScenarioHero> = {}): ScenarioHero => ({
  cls: 'warrior',
  side: 'B',
  at: where,
  maxHp: 500,
  armor: 0,
  ...extra,
});

/** A foe on an axial hex rather than an offset one, for the cone geometry. */
function foeAt(hex: Hex): ScenarioHero {
  const { col, row } = axialToOffset(hex);
  return foe([col, row]);
}

describe('Вихрь ветра: the cone', () => {
  it('hits the hex in front and the two flanking it one step further, not the one straight behind', () => {
    const monkHex = at(4, 4);
    const aim = at(4, 2);
    const i = DIRECTIONS.findIndex((d) => {
      const n = nearestDirection(monkHex, aim);
      return d.q === n.q && d.r === n.r;
    });
    const d = DIRECTIONS[i] as Hex;
    const front = hexAdd(monkHex, d);
    const left = hexAdd(front, DIRECTIONS[(i + 5) % 6] as Hex);
    const right = hexAdd(front, DIRECTIONS[(i + 1) % 6] as Hex);
    const behind = hexAdd(front, d);
    expect(distance(monkHex, left)).toBe(2);
    expect(distance(monkHex, right)).toBe(2);

    let s = scenario(content).seed(5).hero('m', { cls: 'monk', side: 'A', at: [4, 4], attack: 20, abilities: ['monk_gale'] });
    s = s.hero('f', foeAt(front)).hero('l', foeAt(left)).hero('r', foeAt(right)).hero('b', foeAt(behind));
    const state = s.active('m', { ap: 8 }).build();
    const { events } = act(state, 'monk_gale', aim);
    for (const id of ['f', 'l', 'r']) expect(dealt(events, id)).toBeGreaterThan(0);
    expect(dealt(events, 'b')).toBe(0);
  });
});

describe('Скольжение', () => {
  it('moves without drawing a swing and gives the point back', () => {
    const state = board({ abilities: ['monk_glide'] }, { e: foe([3, 2]) }, 4);
    const { state: after, events } = act(state, 'monk_glide', at(3, 5));
    expect(heroById(after, heroId('m')).hex).toEqual(at(3, 5));
    expect(events.some((e) => e.type === 'opportunityAttack')).toBe(false);
    // 4 − 1 for the ability + 1 back.
    expect(after.apLeft).toBe(4);
  });
});

describe('Парирование', () => {
  it('the first enemy hit is split: 40% to the monk, 60% back to the attacker, then it is gone', () => {
    const plain = board({}, { e: foe([3, 2], { attack: 30 }) });
    const full = dealt(
      act({ ...plain, activeHeroId: heroId('e'), apLeft: 4 }, 'basic_melee_physical', at(3, 3), 'e').events,
      'm',
    );

    let state = board({ abilities: ['monk_parry'], maxHp: 500 }, { e: foe([3, 2], { attack: 30 }) });
    state = act(state, 'monk_parry', at(3, 3)).state;
    const enemyTurn = { ...state, activeHeroId: heroId('e'), apLeft: 4 };
    const first = act(enemyTurn, 'basic_melee_physical', at(3, 3), 'e');
    expect(dealt(first.events, 'm')).toBe(Math.round(full * 0.4));
    expect(dealt(first.events, 'e')).toBe(Math.round(full * 0.6));
    expect(statusesOf(heroById(first.state, heroId('m')), statusId('parry'))).toHaveLength(0);

    const second = act({ ...first.state, activeHeroId: heroId('e'), apLeft: 4 }, 'basic_melee_physical', at(3, 3), 'e');
    expect(dealt(second.events, 'm')).toBe(full);
  });
});

describe('Поток', () => {
  it('a kill on the monk\'s own turn gives back 2 AP', () => {
    let state = board({ abilities: ['monk_flow'], attack: 40 }, { e: foe([3, 2], { hp: 5 }), far: foe([8, 8]) });
    state = act(state, 'monk_flow', at(3, 3)).state;
    const before = state.apLeft;
    const after = act(state, 'basic_melee_physical', at(3, 2)).state;
    const basic = content.abilities.basic_melee_physical;
    if (basic === undefined) throw new Error('content');
    expect(heroById(after, heroId('e')).hp).toBe(0);
    expect(after.apLeft).toBe(before - basic.ap + 2);
  });
});

describe('Состояние потока', () => {
  it('+25 initiative after each action an enemy ends within 2 hexes, nothing from further away', () => {
    let state = board({ abilities: ['monk_flow_state'] }, { near: foe([3, 1]), far: foe([8, 8]) });
    state = act(state, 'monk_flow_state', at(3, 3)).state;
    const atb = heroById(state, heroId('m')).atb;

    const nearMove = applyAction(
      { ...state, activeHeroId: heroId('near'), apLeft: 4 },
      { type: 'move', heroId: heroId('near'), path: [at(3, 2)] },
      content,
      FROZEN,
    );
    expect(heroById(nearMove.state, heroId('m')).atb).toBe(atb + 25);

    const farMove = applyAction(
      { ...state, activeHeroId: heroId('far'), apLeft: 4 },
      { type: 'move', heroId: heroId('far'), path: [at(8, 7)] },
      content,
      FROZEN,
    );
    expect(heroById(farMove.state, heroId('m')).atb).toBe(atb);
  });
});

describe('Удар семи громов', () => {
  it('four hits, then a stun', () => {
    const state = board({ abilities: ['monk_seven_thunders'] }, { e: foe([3, 2]) });
    const { state: after, events } = act(state, 'monk_seven_thunders', at(3, 2));
    expect(events.filter((e) => e.type === 'damaged' && e.targetId === 'e')).toHaveLength(4);
    expect(statusesOf(heroById(after, heroId('e')), statusId('stun'))).toHaveLength(1);
  });
});

describe('passives of the Monk', () => {
  it('Босые ноги: a pit costs no extra point and does no harm', () => {
    let state = board({ passive: 'monk_passive_barefoot' }, { far: foe([8, 8]) }, 4);
    const pit = at(3, 4);
    state = { ...state, arena: { ...state.arena, terrain: { [hexKey(pit)]: 'pit' } } };
    const reach = reachableFor(state, heroById(state, heroId('m')), content).get(hexKey(pit));
    expect(reach?.cost).toBe(1);
    const moved = applyAction(state, { type: 'move', heroId: heroId('m'), path: [pit] }, content, FROZEN);
    expect(dealt(moved.events, 'm')).toBe(0);
    // One ordinary point, and the monk's class makes the first step of a turn free.
    expect(moved.state.apLeft).toBe(4);
  });

  it('Равновесие: +3 Speed for every enemy next to the monk', () => {
    const state = board({ passive: 'monk_passive_balance', speed: 10 }, { a: foe([3, 2]), b: foe([3, 4]), far: foe([8, 8]) });
    expect(statsInBattle(state, heroById(state, heroId('m')), content).speed).toBe(16);
  });

  it('Дисциплина: an enemy cannot move the monk on the bar, an ally still can', () => {
    const base = board({ passive: 'monk_passive_discipline' }, {
      e: foe([3, 2], { cls: 'monk', abilities: ['monk_pressure_point'] }),
      p: { cls: 'priest', side: 'A', at: [3, 5], abilities: ['priest_intervention'] },
    });
    const atb = heroById(base, heroId('m')).atb;
    const hit = act({ ...base, activeHeroId: heroId('e'), apLeft: 4 }, 'monk_pressure_point', at(3, 3), 'e');
    expect(heroById(hit.state, heroId('m')).atb).toBe(atb);
    const helped = act({ ...base, activeHeroId: heroId('p'), apLeft: 4 }, 'priest_intervention', at(3, 3), 'p');
    expect(heroById(helped.state, heroId('m')).atb).toBe(atb + 40);
  });
});
