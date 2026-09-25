import { beforeAll, describe, expect, it } from 'vitest';
import type { ContentRegistry, DamageEffect } from '../../content.js';
import { loadContent } from '../../../content/load.js';
import { scenario } from '../../testing/scenario.js';
import { computeDamage, computeHeal, FIXED_ROLLS, RANDOM_ROLLS } from '../formulas.js';
import { heroById, updateHero } from '../query.js';
import { BARRIER, addStatus } from '../statuses.js';
import { statsInBattle } from '../modifiers.js';
import { heroId, statusId } from '../../types.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

const physical = (k: number, extra: Partial<DamageEffect> = {}): DamageEffect =>
  ({ type: 'damage', school: 'physical', scale: 'attack', k, ...extra }) as DamageEffect;

function twoHeroes(options: {
  attack?: number;
  armor?: number;
  resist?: number;
  targetHp?: number;
}) {
  return scenario(content)
    .hero('att', { cls: 'warrior', side: 'A', at: [2, 3], attack: options.attack ?? 20 })
    .hero('def', {
      cls: 'warrior',
      side: 'B',
      at: [3, 3],
      armor: options.armor ?? 0,
      resist: options.resist ?? 0,
      hp: options.targetHp ?? 100,
    })
    .active('att')
    .build();
}

describe('damage formula', () => {
  it('with no defence and no roll, damage is k times the stat', () => {
    const state = twoHeroes({ attack: 20 });
    const result = computeDamage(
      state,
      heroById(state, heroId('att')),
      heroById(state, heroId('def')),
      physical(1.0),
      content,
      state.rng,
      FIXED_ROLLS,
    );
    expect(result.final).toBe(20);
    expect(result.crit).toBe(false);
  });

  /** What a defence stat leaves of a blow: 1 − def / (def + defenseConstant). */
  const kept = (def: number): number => 1 - def / (def + content.config.formulas.defenseConstant);

  it('defence follows def / (def + defenseConstant)', () => {
    const state = twoHeroes({ attack: 20, armor: 40 });
    const result = computeDamage(
      state,
      heroById(state, heroId('att')),
      heroById(state, heroId('def')),
      physical(1.0),
      content,
      state.rng,
      FIXED_ROLLS,
    );
    expect(result.final).toBe(Math.round(20 * kept(40)));
  });

  it('a barrier absorbs before defence, not after', () => {
    let state = twoHeroes({ attack: 20, armor: 40 });
    state = updateHero(state, heroId('def'), (hero) => {
      return addStatus(hero, content, BARRIER, 3, 10, 1, false).hero;
    });

    const result = computeDamage(
      state,
      heroById(state, heroId('att')),
      heroById(state, heroId('def')),
      physical(1.0),
      content,
      state.rng,
      FIXED_ROLLS,
    );

    // Barrier first: (20 − 10) × kept(40). Defence first would give 20 × kept(40) − 10,
    // a different number, so this pins the order.
    expect(result.absorbedByBarrier).toBe(10);
    expect(result.final).toBe(Math.round(10 * kept(40)));
    expect(result.final).not.toBe(Math.round(20 * kept(40) - 10));
  });

  it('pure damage ignores defence entirely', () => {
    const state = twoHeroes({ attack: 20, armor: 200 });
    const result = computeDamage(
      state,
      heroById(state, heroId('att')),
      heroById(state, heroId('def')),
      { type: 'damage', school: 'pure', scale: 'attack', k: 1.0 },
      content,
      state.rng,
      FIXED_ROLLS,
    );
    expect(result.final).toBe(20);
  });

  it('armorPierce shaves the defence stat', () => {
    const state = twoHeroes({ attack: 20, armor: 100 });
    const plain = computeDamage(
      state,
      heroById(state, heroId('att')),
      heroById(state, heroId('def')),
      physical(1.0),
      content,
      state.rng,
      FIXED_ROLLS,
    );
    const pierced = computeDamage(
      state,
      heroById(state, heroId('att')),
      heroById(state, heroId('def')),
      physical(1.0, { armorPierce: 0.5 }),
      content,
      state.rng,
      FIXED_ROLLS,
    );
    // Half of 100 armour pierced leaves 50 of it standing.
    expect(plain.final).toBe(Math.round(20 * kept(100)));
    expect(pierced.final).toBe(Math.round(20 * kept(50)));
  });

  it('never drops below the minimum when any damage got through', () => {
    const state = twoHeroes({ attack: 1, armor: 10000 });
    const result = computeDamage(
      state,
      heroById(state, heroId('att')),
      heroById(state, heroId('def')),
      physical(0.1),
      content,
      state.rng,
      FIXED_ROLLS,
    );
    expect(result.final).toBe(content.config.formulas.minDamage);
  });

  it('bonusVsLowHp only fires below the threshold', () => {
    const healthy = twoHeroes({ attack: 20, targetHp: 100 });
    const wounded = twoHeroes({ attack: 20, targetHp: 30 });
    const effect = physical(1.0, { bonusVsLowHp: { belowPct: 35, mul: 2 } });

    const a = computeDamage(
      healthy,
      heroById(healthy, heroId('att')),
      heroById(healthy, heroId('def')),
      effect,
      content,
      healthy.rng,
      FIXED_ROLLS,
    );
    const b = computeDamage(
      wounded,
      heroById(wounded, heroId('att')),
      heroById(wounded, heroId('def')),
      effect,
      content,
      wounded.rng,
      FIXED_ROLLS,
    );
    expect(a.final).toBe(20);
    expect(b.final).toBe(40);
  });

  it('the spread keeps rolled damage inside its configured band', () => {
    const state = twoHeroes({ attack: 20 });
    const [lo, hi] = content.config.formulas.spread;
    let rng = state.rng;
    for (let i = 0; i < 300; i++) {
      const result = computeDamage(
        state,
        heroById(state, heroId('att')),
        heroById(state, heroId('def')),
        physical(1.0, { noCrit: true }),
        content,
        rng,
        RANDOM_ROLLS,
      );
      rng = result.rng;
      expect(result.final).toBeGreaterThanOrEqual(Math.floor(20 * lo));
      expect(result.final).toBeLessThanOrEqual(Math.ceil(20 * hi));
    }
  });

  it('defence never goes negative, so stacked vulnerability cannot divide by zero', () => {
    let state = twoHeroes({ attack: 20, armor: 10 });
    state = updateHero(state, heroId('def'), (hero) => {
      // A flat debuff far larger than the stat it eats.
      const weakened = addStatus(hero, content, statusId('slow'), 3, 999, 1, false).hero;
      return weakened;
    });
    const stats = statsInBattle(state, heroById(state, heroId('def')), content);
    expect(stats.speed).toBeGreaterThanOrEqual(content.config.formulas.minSpeed);
  });
});

describe('healing', () => {
  it('never exceeds the missing health', () => {
    const state = twoHeroes({ targetHp: 95 });
    const result = computeHeal(
      state,
      heroById(state, heroId('att')),
      heroById(state, heroId('def')),
      { type: 'heal', scale: 'magic', k: 5 },
      content,
      state.rng,
      FIXED_ROLLS,
    );
    expect(result.amount).toBe(5);
  });

  it('a share of the missing health does not roll', () => {
    const state = twoHeroes({ targetHp: 40 });
    const result = computeHeal(
      state,
      heroById(state, heroId('att')),
      heroById(state, heroId('def')),
      { type: 'heal', missingHpPct: 30 },
      content,
      state.rng,
      RANDOM_ROLLS,
    );
    expect(result.amount).toBe(18);
    expect(result.rng).toEqual(state.rng);
  });
});
