import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { Ability, ContentRegistry, DamageEffect } from '../../content.js';
import { hexKey } from '../../hex.js';
import { at, scenario } from '../../testing/scenario.js';
import { heroId } from '../../types.js';
import { computeDamage, FIXED_ROLLS } from '../formulas.js';
import { abilityRange } from '../legal.js';
import { reachableHexes } from '../pathing.js';
import { heroById } from '../query.js';
import { hasLineOfSight } from '../targeting.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

function ability(pred: (a: Ability) => boolean): Ability {
  const found = Object.values(content.abilities).find(pred);
  if (found === undefined) throw new Error('no such ability');
  return found;
}

function board(build?: (s: ReturnType<typeof scenario>) => void) {
  const s = scenario(content)
    .hero('h', { cls: 'mage', side: 'A', at: [3, 3], attack: 20, magic: 20 })
    .hero('foe', { cls: 'warrior', side: 'B', at: [4, 3], armor: 0, resist: 0, hp: 200 })
    .active('h', { ap: 4 });
  build?.(s);
  return s.build();
}

describe('the column', () => {
  it('cannot be walked through but can be seen through', () => {
    const state = board((s) => {
      s.obstacle('column', [3, 2]);
    });
    const reach = reachableHexes(state, heroById(state, heroId('h')), 4, content);
    expect(reach.has(hexKey(at(3, 2)))).toBe(false);
    expect(hasLineOfSight(state, at(3, 3), at(3, 1), content)).toBe(true);
  });
});

describe('high ground', () => {
  it('is ordinary ground to walk on', () => {
    const state = board((s) => {
      s.obstacle('high', [3, 2]);
    });
    const reach = reachableHexes(state, heroById(state, heroId('h')), 4, content);
    expect(reach.get(hexKey(at(3, 2)))?.cost).toBe(1);
    expect(hasLineOfSight(state, at(3, 3), at(3, 1), content)).toBe(true);
  });

  it('adds range to abilities that reach past the next hex, and none to melee ones', () => {
    const ranged = ability((a) => a.class === 'mage' && a.range > 1);
    const melee = ability((a) => a.range === 1);
    const flat = board();
    const high = board((s) => {
      s.obstacle('high', [3, 3]);
    });
    const bonus = content.config.arena.high.range;
    expect(abilityRange(high, heroById(high, heroId('h')), ranged, content)).toBe(
      abilityRange(flat, heroById(flat, heroId('h')), ranged, content) + bonus,
    );
    expect(abilityRange(high, heroById(high, heroId('h')), melee, content)).toBe(
      abilityRange(flat, heroById(flat, heroId('h')), melee, content),
    );
  });

  it('adds its share of damage to whoever stands on it, not to whoever is hit on it', () => {
    const hit = { type: 'damage', school: 'physical', scale: 'attack', k: 1 } as DamageEffect;
    const dealt = (state: ReturnType<typeof board>, from: string, to: string) =>
      computeDamage(state, heroById(state, heroId(from)), heroById(state, heroId(to)), hit, content, state.rng, FIXED_ROLLS)
        .preDefense;
    const flat = board();
    const attackerHigh = board((s) => {
      s.obstacle('high', [3, 3]);
    });
    const targetHigh = board((s) => {
      s.obstacle('high', [4, 3]);
    });
    const share = content.config.arena.high.damage;
    expect(dealt(attackerHigh, 'h', 'foe')).toBeCloseTo(dealt(flat, 'h', 'foe') * (1 + share), 6);
    expect(dealt(targetHigh, 'h', 'foe')).toBe(dealt(flat, 'h', 'foe'));
  });
});
