import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry, DamageEffect } from '../../content.js';
import { GUARDIAN_ID, guardianHero } from '../../arena/guardian.js';
import { at, scenario } from '../../testing/scenario.js';
import { heroId } from '../../types.js';
import type { BattleState } from '../../types.js';
import { applyAction } from '../apply.js';
import { FIXED_ROLLS, computeDamage } from '../formulas.js';
import { basicAttackOf } from '../opportunity.js';
import { heroById } from '../query.js';
import { createBattle } from '../state.js';
import { checkOutcome } from '../victory.js';
import { itemFits } from '../../draft/items.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

function rules(id: string): Record<string, number | string> {
  const modifier = content.arenaModifiers[id];
  if (modifier === undefined) throw new Error(`no arena modifier ${id}`);
  return modifier.rules as unknown as Record<string, number | string>;
}

const POINT = 'mod_power_point';
const GUARDIAN = 'mod_ancient_guardian';

describe('Точка силы', () => {
  /** 'a' on the centre acts, 'b' is next. */
  function onPoint(round = 1) {
    return scenario(content)
      .hero('a', { cls: 'mage', side: 'A', at: [4, 4], maxHp: 200 })
      .hero('b', { cls: 'warrior', side: 'B', at: [5, 4], maxHp: 200, atb: 100 })
      .modifier(POINT)
      .round(round)
      .active('a')
      .build();
  }

  it('whoever stands on the centre hits harder', () => {
    const hit = { type: 'damage', school: 'physical', scale: 'attack', k: 1 } as DamageEffect;
    const dealt = (state: BattleState, from: string, to: string) =>
      computeDamage(state, heroById(state, heroId(from)), heroById(state, heroId(to)), hit, content, state.rng, FIXED_ROLLS)
        .preDefense;
    const state = onPoint();
    const plain = { ...state, modifiers: [] };
    expect(dealt(state, 'a', 'b')).toBeCloseTo(dealt(plain, 'a', 'b') * (1 + Number(rules(POINT).damageBonus)), 6);
    expect(dealt(state, 'b', 'a')).toBe(dealt(plain, 'b', 'a'));
  });

  it('each new round credits the side standing on it', () => {
    // Round 2 begins with a's hero on the point: round 1 goes to A.
    const state = { ...onPoint(2), hold: { A: 0, B: 0, round: 1 } };
    const after = applyAction(state, { type: 'endTurn', heroId: heroId('a') }, content).state;
    expect(after.hold).toEqual({ A: 1, B: 0, round: 2 });
  });

  it('nobody on it, nothing credited', () => {
    const empty = scenario(content)
      .hero('a', { cls: 'mage', side: 'A', at: [3, 4], maxHp: 200 })
      .hero('b', { cls: 'warrior', side: 'B', at: [5, 4], maxHp: 200, atb: 100 })
      .modifier(POINT)
      .round(2)
      .active('a')
      .build();
    const state = { ...empty, hold: { A: 0, B: 0, round: 1 } };
    const after = applyAction(state, { type: 'endTurn', heroId: heroId('a') }, content).state;
    expect(after.hold).toEqual({ A: 0, B: 0, round: 2 });
  });

  it('enough rounds held in total win the match', () => {
    const need = Number(rules(POINT).holdRounds);
    const state = { ...onPoint(2), hold: { A: need - 1, B: need - 2, round: 1 } };
    const after = applyAction(state, { type: 'endTurn', heroId: heroId('a') }, content).state;
    expect(after.outcome).toEqual({ winner: 'A', reason: 'hold' });
  });
});

describe('Древний страж', () => {
  function withGuardian(build: (s: ReturnType<typeof scenario>) => void, hp?: number): BattleState {
    const s = scenario(content).modifier(GUARDIAN);
    build(s);
    const state = s.build();
    const guardian = guardianHero(content, rules(GUARDIAN) as never, at(4, 4));
    return {
      ...state,
      heroes: { ...state.heroes, [GUARDIAN_ID]: { ...guardian, hp: hp ?? guardian.hp, atb: 100 } },
    };
  }

  it('stands in the centre of a battle that has it, neutral, with its own health', () => {
    const state = createBattle({
      seed: 3,
      teams: { heroes: [] },
      content,
      modifiers: [GUARDIAN],
    });
    const guardian = state.heroes[GUARDIAN_ID];
    expect(guardian?.side).toBe('N');
    expect(guardian?.hex).toEqual(at(4, 4));
    expect(guardian?.hp).toBe(Number(rules(GUARDIAN).maxHp));
  });

  it('on its turn it strikes the weakest neighbour of either side and passes on by itself', () => {
    const state = withGuardian((s) =>
      s
        .hero('a', { cls: 'mage', side: 'A', at: [3, 4], maxHp: 200, hp: 150 })
        .hero('b', { cls: 'warrior', side: 'B', at: [5, 4], maxHp: 200, hp: 90 })
        .hero('far', { cls: 'warrior', side: 'B', at: [8, 8], maxHp: 200, hp: 10 })
        .active('a'),
    );
    const after = applyAction(state, { type: 'endTurn', heroId: heroId('a') }, content).state;
    expect(heroById(after, heroId('b')).hp).toBeLessThan(90);
    expect(heroById(after, heroId('a')).hp).toBe(150);
    expect(heroById(after, heroId('far')).hp).toBe(10);
    expect(after.activeHeroId).not.toBe(GUARDIAN_ID);
  });

  it('whoever kills it takes a legendary artifact at once, and the match goes on', () => {
    const state = withGuardian(
      (s) =>
        s
          .hero('a', { cls: 'warrior', side: 'A', at: [3, 4], maxHp: 200, attack: 30 })
          .hero('b', { cls: 'warrior', side: 'B', at: [8, 8], maxHp: 200 })
          .active('a'),
      1,
    );
    const a = heroById(state, heroId('a'));
    const after = applyAction(
      state,
      { type: 'ability', heroId: a.id, abilityId: basicAttackOf(a, content), target: at(4, 4) },
      content,
    ).state;
    const item = content.items[heroById(after, heroId('a')).item ?? ''];
    expect(item?.tier).toBe('legendary');
    expect(item !== undefined && itemFits(item, a.classId, content)).toBe(true);
    expect(after.loot).toEqual([{ heroId: 'a', itemId: item?.id }]);
    expect(after.outcome).toBeNull();
  });

  it('never counts for either side: a side whose heroes are gone loses, the guardian standing or not', () => {
    const state = withGuardian((s) =>
      s
        .hero('a', { cls: 'warrior', side: 'A', at: [3, 4], maxHp: 200 })
        .hero('b', { cls: 'warrior', side: 'B', at: [8, 8], maxHp: 200, hp: 0 })
        .active('a'),
    );
    expect(checkOutcome(state, content)).toEqual({ winner: 'A', reason: 'elimination' });
  });
});
