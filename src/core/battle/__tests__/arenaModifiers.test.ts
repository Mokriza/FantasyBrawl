import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry, HealEffect } from '../../content.js';
import { terrainAt } from '../../arena/terrain.js';
import { at, scenario } from '../../testing/scenario.js';
import { heroId } from '../../types.js';
import { applyAction } from '../apply.js';
import { FIXED_ROLLS, computeHeal } from '../formulas.js';
import { basicAttackOf } from '../opportunity.js';
import { reachableHexes } from '../pathing.js';
import { heroById, updateHero } from '../query.js';
import { DOT, addStatus } from '../statuses.js';
import { hasLineOfSight } from '../targeting.js';
import { hexKey } from '../../hex.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

/** The rules of a modifier, whatever kind it is. */
function rules(id: string): Record<string, number | string> {
  const modifier = content.arenaModifiers[id];
  if (modifier === undefined) throw new Error(`no arena modifier ${id}`);
  return modifier.rules as unknown as Record<string, number | string>;
}

/** 'a' acts now, 'b' is next with a full bar, so ending a's turn starts b's at once. */
function duel(modifier: string | null, round = 1, build?: (s: ReturnType<typeof scenario>) => void) {
  const s = scenario(content)
    .hero('a', { cls: 'mage', side: 'A', at: [4, 4], maxHp: 200 })
    .hero('b', { cls: 'warrior', side: 'B', at: [0, 4], maxHp: 200, atb: 100 })
    .round(round)
    .active('a');
  if (modifier !== null) s.modifier(modifier);
  build?.(s);
  return s.build();
}

function endTurnOfA(state: ReturnType<typeof duel>) {
  return applyAction(state, { type: 'endTurn', heroId: heroId('a') }, content).state;
}

describe('Сужающаяся арена', () => {
  const id = 'mod_shrinking_arena';

  it('does nothing for the first rounds', () => {
    const every = Number(rules(id).everyRounds);
    const after = endTurnOfA(duel(id, every));
    expect(terrainAt(after.arena, at(0, 4))).toBeNull();
    expect(heroById(after, heroId('b')).hp).toBe(200);
  });

  it('then the outer ring collapses: impassable, and it hurts whoever still stands there', () => {
    const every = Number(rules(id).everyRounds);
    const after = endTurnOfA(duel(id, every + 1));
    for (const [col, row] of [[0, 0], [0, 4], [8, 8], [4, 0], [4, 8]] as const) {
      expect(terrainAt(after.arena, at(col, row))).toBe('collapse');
    }
    expect(terrainAt(after.arena, at(1, 4))).toBeNull();
    expect(heroById(after, heroId('b')).hp).toBe(200 - Number(rules(id).ringDamage));
    const reach = reachableHexes(after, heroById(after, heroId('b')), 4, content);
    expect(reach.has(hexKey(at(0, 3)))).toBe(false);
    expect(reach.has(hexKey(at(1, 4)))).toBe(true);
  });

  it('a later collapse takes the next ring in', () => {
    const every = Number(rules(id).everyRounds);
    const after = endTurnOfA(duel(id, 2 * every + 1));
    expect(terrainAt(after.arena, at(1, 4))).toBe('collapse');
    expect(terrainAt(after.arena, at(2, 4))).toBeNull();
  });
});

describe('Шторм маны', () => {
  const id = 'mod_mana_storm';

  it('cooldowns tick one turn faster', () => {
    const withCooldown = (modifier: string | null) =>
      duel(modifier, 1, (s) => s.hero('a', { cls: 'mage', side: 'A', at: [4, 4], maxHp: 200 }));
    const cool = (modifier: string | null) => {
      const state = withCooldown(modifier);
      const primed = updateHero(state, heroId('a'), (h) => ({ ...h, cooldowns: { some_ability: 4 } }));
      return heroById(endTurnOfA(primed), heroId('a')).cooldowns.some_ability ?? 0;
    };
    expect(cool(id)).toBe(cool(null) - Number(rules(id).cooldownBonus));
  });

  it('damage over time is doubled', () => {
    const poisoned = (modifier: string | null) => {
      const state = duel(modifier);
      const withDot = updateHero(state, heroId('b'), (h) => addStatus(h, content, DOT, 3, 6, 1, false, heroId('a')).hero);
      return 200 - heroById(endTurnOfA(withDot), heroId('b')).hp;
    };
    expect(poisoned(null)).toBe(6);
    expect(poisoned(id)).toBe(6 * Number(rules(id).dotMultiplier));
  });
});

describe('Кровавая жатва', () => {
  const id = 'mod_blood_harvest';

  it('healing is weaker', () => {
    const heal = { type: 'heal', scale: 'magic', k: 1 } as HealEffect;
    const healed = (modifier: string | null) => {
      const state = duel(modifier, 1, (s) => s.hero('b', { cls: 'warrior', side: 'B', at: [0, 4], maxHp: 200, hp: 50 }));
      const target = heroById(state, heroId('b'));
      return computeHeal(state, target, target, heal, content, state.rng, FIXED_ROLLS).amount;
    };
    expect(healed(id)).toBe(Math.round(healed(null) * Number(rules(id).healMultiplier)));
  });

  it('a kill gives the killer initiative', () => {
    const killed = (modifier: string | null) => {
      const state = duel(modifier, 1, (s) =>
        s.hero('b', { cls: 'warrior', side: 'B', at: [5, 4], maxHp: 200, hp: 1, atb: 100 }),
      );
      const a = heroById(state, heroId('a'));
      const after = applyAction(
        state,
        { type: 'ability', heroId: a.id, abilityId: basicAttackOf(a, content), target: at(5, 4) },
        content,
      ).state;
      expect(heroById(after, heroId('b')).hp).toBe(0);
      return heroById(after, heroId('a')).atb;
    };
    expect(killed(id)).toBe(killed(null) + Number(rules(id).killAtb));
  });
});

describe('Густой туман', () => {
  const id = 'mod_thick_fog';

  it('nobody sees further than the fog allows, whatever stands between', () => {
    const range = Number(rules(id).sightRange);
    const fog = duel(id);
    const clear = duel(null);
    expect(hasLineOfSight(clear, at(0, 4), at(range + 1, 4), content)).toBe(true);
    expect(hasLineOfSight(fog, at(0, 4), at(range + 1, 4), content)).toBe(false);
    expect(hasLineOfSight(fog, at(0, 4), at(range, 4), content)).toBe(true);
  });
});
