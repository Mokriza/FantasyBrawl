import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { scenario } from '../../testing/scenario.js';
import { advanceToNextTurn, predictTurnOrder, readyHeroes } from '../atb.js';
import { applyAction, startBattle } from '../apply.js';
import { heroById } from '../query.js';
import { heroId } from '../../types.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

function threeSpeeds(a: number, b: number, c: number) {
  return scenario(content)
    .hero('fast', { cls: 'hunter', side: 'A', at: [0, 0], speed: a })
    .hero('mid', { cls: 'mage', side: 'A', at: [0, 2], speed: b })
    .hero('slow', { cls: 'warrior', side: 'B', at: [6, 0], speed: c })
    .build();
}

describe('the initiative bar', () => {
  it('the fastest hero acts first', () => {
    const { state } = startBattle(threeSpeeds(18, 12, 8), content);
    expect(state.activeHeroId).toBe('fast');
  });

  it('ticks only until somebody is ready, never past it', () => {
    const { state } = startBattle(threeSpeeds(10, 10, 10), content);
    // Ten ticks of ten points each is exactly the threshold.
    expect(state.tick).toBe(10);
    expect(readyHeroes(state, content)).toHaveLength(3);
  });

  it('ties break by speed, then side B, then hero id', () => {
    // Same bar, same speed: side B wins, and among equals the lower id does.
    const state = scenario(content)
      .hero('z_a', { cls: 'warrior', side: 'A', at: [0, 0], speed: 10, atb: 100 })
      .hero('m_b', { cls: 'warrior', side: 'B', at: [6, 0], speed: 10, atb: 100 })
      .hero('a_b', { cls: 'warrior', side: 'B', at: [6, 2], speed: 10, atb: 100 })
      .build();
    expect(readyHeroes(state, content).map((h) => h.id)).toEqual(['a_b', 'm_b', 'z_a']);
  });

  it('on a full tie the neutral guardian goes after both sides', () => {
    // [user decision] Side B, then side A, then the neutral side N. The guardian's id sorts
    // before the heroes' on purpose: heroes are listed by id, and the old side rule answered
    // 'later' both ways for A and N, so the id order used to decide.
    const withGuardian = (sides: readonly ('A' | 'B')[]) => {
      let build = scenario(content).hero('guardian', { cls: 'warrior', side: 'A', at: [3, 3], speed: 10, atb: 100 });
      for (const side of sides) {
        build = build.hero(`hero_${side}`, { cls: 'warrior', side, at: side === 'A' ? [0, 0] : [6, 0], speed: 10, atb: 100 });
      }
      const state = build.build();
      const guardian = state.heroes['guardian'];
      if (guardian === undefined) throw new Error('no guardian');
      // The scenario builder knows only sides A and B; the guardian is turned neutral here.
      return { ...state, heroes: { ...state.heroes, guardian: { ...guardian, side: 'N' as const } } };
    };
    const order = (sides: readonly ('A' | 'B')[]) => readyHeroes(withGuardian(sides), content).map((h) => h.id);
    expect(order(['A'])).toEqual(['hero_A', 'guardian']);
    expect(order(['B'])).toEqual(['hero_B', 'guardian']);
    expect(order(['A', 'B'])).toEqual(['hero_B', 'hero_A', 'guardian']);
  });

  it('a higher speed wins the tie before the side does', () => {
    const state = scenario(content)
      .hero('quick_a', { cls: 'hunter', side: 'A', at: [0, 0], speed: 18, atb: 100 })
      .hero('slow_b', { cls: 'warrior', side: 'B', at: [6, 0], speed: 8, atb: 100 })
      .build();
    expect(readyHeroes(state, content)[0]?.id).toBe('quick_a');
  });

  it('leftover bar carries over, so a fast hero banks a double turn', () => {
    const { state } = startBattle(threeSpeeds(60, 10, 10), content);
    expect(state.activeHeroId).toBe('fast');
    // 60 per tick: two ticks put the runner on 120, well past the threshold.
    const after = applyAction(state, { type: 'endTurn', heroId: heroId('fast') }, content).state;
    expect(heroById(after, heroId('fast')).atb).toBeGreaterThanOrEqual(0);
    expect(after.activeHeroId).toBe('fast');
  });

  it('the prediction matches what actually happens when nothing interferes', () => {
    const { state } = startBattle(threeSpeeds(18, 12, 8), content);
    const predicted = predictTurnOrder(state, content, 5);

    let current = state;
    const actual: string[] = [];
    for (let i = 0; i < 5 && current.activeHeroId !== null; i++) {
      actual.push(current.activeHeroId);
      current = applyAction(current, { type: 'endTurn', heroId: current.activeHeroId }, content).state;
    }
    expect(actual).toEqual(predicted);
  });

  it('the prediction does not touch the state it reads', () => {
    const { state } = startBattle(threeSpeeds(18, 12, 8), content);
    const snapshot = JSON.stringify(state);
    predictTurnOrder(state, content, 6);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('advancing never runs forever when everything is slowed to the floor', () => {
    const state = scenario(content)
      .hero('a', { cls: 'warrior', side: 'A', at: [0, 0], speed: 1 })
      .hero('b', { cls: 'warrior', side: 'B', at: [6, 0], speed: 1 })
      .build();
    const advanced = advanceToNextTurn(state, content);
    expect(advanced.heroId).not.toBeNull();
    expect(advanced.state.tick).toBe(100);
  });
});
