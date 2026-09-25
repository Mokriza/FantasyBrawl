/**
 * The Rogue's rules: stealth that breaks on the first hit and makes it a crit, the
 * guaranteed crit of "Убийство из тени", damage against a lone target, blindness.
 * The dice are frozen, so every crit seen here is a forced one.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import type { Hex } from '../../hex.js';
import { at, scenario } from '../../testing/scenario.js';
import type { ScenarioHero } from '../../testing/scenario.js';
import { applyAction } from '../apply.js';
import { abilityRange } from '../legal.js';
import { statsInBattle } from '../modifiers.js';
import { heroById } from '../query.js';
import { statusesOf } from '../statuses.js';
import { abilityId, heroId, statusId } from '../../types.js';
import type { BattleEvent, BattleState } from '../../types.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

const FROZEN = { deterministic: true } as const;

function board(rogue: Partial<ScenarioHero>, others: Record<string, ScenarioHero>, ap = 8): BattleState {
  let s = scenario(content).seed(5).hero('r', { cls: 'rogue', side: 'A', at: [3, 3], attack: 20, ...rogue });
  for (const [id, spec] of Object.entries(others)) s = s.hero(id, spec);
  return s.active('r', { ap }).build();
}

function act(state: BattleState, ability: string, target: Hex, hero = 'r') {
  return applyAction(
    state,
    { type: 'ability', heroId: heroId(hero), abilityId: abilityId(ability), target },
    content,
    FROZEN,
  );
}

function hits(events: readonly BattleEvent[], target: string): Array<{ amount: number; crit: boolean }> {
  return events.flatMap((e) =>
    e.type === 'damaged' && e.targetId === target ? [{ amount: e.amount, crit: e.crit }] : [],
  );
}

const foe = (where: [number, number], extra: Partial<ScenarioHero> = {}): ScenarioHero => ({
  cls: 'warrior',
  side: 'B',
  at: where,
  maxHp: 500,
  armor: 0,
  ...extra,
});

describe('Исчезновение', () => {
  it('the first hit from stealth is a crit, and the stealth is gone after it', () => {
    let state = board({ abilities: ['rogue_vanish', 'rogue_flurry'] }, { e: foe([3, 2]) });
    state = act(state, 'rogue_vanish', at(3, 3)).state;
    expect(statusesOf(heroById(state, heroId('r')), statusId('stealth'))).toHaveLength(1);

    const flurry = act(state, 'rogue_flurry', at(3, 2));
    // Three hits: only the first comes out of the shadows.
    expect(hits(flurry.events, 'e').map((h) => h.crit)).toEqual([true, false, false]);
    expect(statusesOf(heroById(flurry.state, heroId('r')), statusId('stealth'))).toHaveLength(0);
    expect(flurry.events.some((e) => e.type === 'statusExpired' && e.status === 'stealth')).toBe(true);
  });

  it('while unseen, the rogue cannot be picked as a single target', () => {
    let state = board({ abilities: ['rogue_vanish'] }, { e: foe([3, 2]) });
    state = act(state, 'rogue_vanish', at(3, 3)).state;
    const enemyTurn = { ...state, activeHeroId: heroId('e'), apLeft: 4 };
    expect(() => act(enemyTurn, 'basic_melee_physical', at(3, 3), 'e')).toThrow();
  });
});

describe('Убийство из тени', () => {
  it('is a sure crit when nothing has hurt the rogue since its last turn', () => {
    const state = board({ abilities: ['rogue_assassinate'] }, { e: foe([3, 2]) });
    const struck = hits(act(state, 'rogue_assassinate', at(3, 2)).events, 'e');
    expect(struck).toHaveLength(1);
    expect(struck[0]?.crit).toBe(true);
  });

  it('is an ordinary hit once the rogue has taken damage since then', () => {
    let state = board({ abilities: ['rogue_assassinate'] }, { e: foe([3, 2]) });
    // The enemy strikes between the rogue's turns.
    state = act({ ...state, activeHeroId: heroId('e'), apLeft: 4 }, 'basic_melee_physical', at(3, 3), 'e').state;
    state = { ...state, activeHeroId: heroId('r'), apLeft: 8 };
    const struck = hits(act(state, 'rogue_assassinate', at(3, 2)).events, 'e');
    expect(struck).toHaveLength(1);
    expect(struck[0]?.crit).toBe(false);
  });

  it('forgets old wounds: damage before the rogue ended its turn does not count', () => {
    let state = board({ abilities: ['rogue_assassinate'], speed: 18 }, { e: foe([3, 2], { speed: 1 }) });
    state = act({ ...state, activeHeroId: heroId('e'), apLeft: 4 }, 'basic_melee_physical', at(3, 3), 'e').state;
    // The rogue's own turn ends; nothing hits it before the next one.
    state = { ...state, activeHeroId: heroId('r'), apLeft: 1 };
    state = applyAction(state, { type: 'endTurn', heroId: heroId('r') }, content, FROZEN).state;
    state = { ...state, activeHeroId: heroId('r'), apLeft: 8 };
    expect(hits(act(state, 'rogue_assassinate', at(3, 2)).events, 'e')[0]?.crit).toBe(true);
  });
});

describe('Охота на одиночек', () => {
  it('+25% against a target with no ally beside it, nothing extra otherwise', () => {
    const plain = board({}, { e: foe([3, 2]) });
    const lonePrey = board({ passive: 'rogue_passive_lone_prey' }, { e: foe([3, 2]) });
    const guarded = board({ passive: 'rogue_passive_lone_prey' }, { e: foe([3, 2]), g: foe([3, 1]) });

    const base = hits(act(plain, 'basic_melee_physical', at(3, 2)).events, 'e')[0]?.amount ?? 0;
    expect(hits(act(lonePrey, 'basic_melee_physical', at(3, 2)).events, 'e')[0]?.amount).toBe(Math.round(base * 1.25));
    expect(hits(act(guarded, 'basic_melee_physical', at(3, 2)).events, 'e')[0]?.amount).toBe(base);
  });
});

describe('Ослепление', () => {
  it('halves the crit chance and takes 2 range, never below 1', () => {
    const state = board({ abilities: ['rogue_blind'] }, { e: foe([3, 1], { cls: 'hunter', critChance: 0.2 }) });
    const after = act(state, 'rogue_blind', at(3, 1)).state;
    const hunter = heroById(after, heroId('e'));
    expect(statsInBattle(after, hunter, content).critChance).toBeCloseTo(0.1);

    const aimed = content.abilities.hunter_aimed_shot;
    if (aimed === undefined) throw new Error('content');
    expect(abilityRange(after, hunter, aimed, content)).toBe(Math.max(1, aimed.range - 2));
    // A basic melee reach is untouched: range bonuses and penalties skip range 1.
    const melee = content.abilities.basic_melee_physical;
    if (melee === undefined) throw new Error('content');
    expect(abilityRange(after, hunter, melee, content)).toBe(1);
  });
});
