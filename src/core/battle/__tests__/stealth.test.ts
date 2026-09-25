/**
 * "Невидимость": enemies cannot choose a hero in stealth as a target, by hand or by an
 * automatic choice; areas that merely cover the hero still land. A bug report from a
 * test run: the Rogue was singled out while invisible.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { GUARDIAN_ID, guardianHero } from '../../arena/guardian.js';
import { at, scenario } from '../../testing/scenario.js';
import { heroId, statusId } from '../../types.js';
import type { BattleState } from '../../types.js';
import { applyAction } from '../apply.js';
import { abilityLegality } from '../legal.js';
import { reactorsForStep } from '../opportunity.js';
import { heroById, updateHero } from '../query.js';
import { addStatus } from '../statuses.js';
import { resolveTargets } from '../targeting.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

function hide(state: BattleState, id: string): BattleState {
  return updateHero(state, heroId(id), (h) => addStatus(h, content, statusId('stealth'), 3, 0, 1, false).hero);
}

function ability(id: string) {
  const found = content.abilities[id];
  if (found === undefined) throw new Error(`no ability ${id}`);
  return found;
}

/** A caster of class cls for side A, the rogue 'r' of side B in stealth next to a visible 'v'. */
function board(cls: string, casterAt: [number, number] = [2, 4]): BattleState {
  const state = scenario(content)
    .hero('c', { cls, side: 'A', at: casterAt, maxHp: 200, attack: 30, magic: 30 })
    .hero('r', { cls: 'rogue', side: 'B', at: [4, 4], maxHp: 200 })
    .hero('v', { cls: 'warrior', side: 'B', at: [5, 4], maxHp: 200 })
    .active('c', { ap: 8 })
    .build();
  return hide(state, 'r');
}

const legal = (state: BattleState, id: string, target: [number, number]) =>
  abilityLegality(state, heroById(state, heroId('c')), ability(id), at(...target), content).ok;

describe('stealth: no enemy may single the hero out', () => {
  it('not with a chain: its first target is a choice', () => {
    const state = board('mage');
    expect(legal(state, 'mage_chain_lightning', [4, 4])).toBe(false);
    expect(legal(state, 'mage_chain_lightning', [5, 4])).toBe(true);
  });

  it('nor does a chain jump to it', () => {
    const state = board('mage', [6, 4]);
    const hit = resolveTargets(state, heroById(state, heroId('c')), at(5, 4), ability('mage_chain_lightning'), content);
    expect(hit.map((t) => t.hero.id)).not.toContain('r');
  });

  it('not with a strike that also catches the neighbours, though the splash still lands on it', () => {
    const state = board('warrior', [3, 4]);
    expect(legal(state, 'warrior_cleave', [4, 4])).toBe(false);
    const around = scenario(content)
      .hero('c', { cls: 'warrior', side: 'A', at: [4, 3], maxHp: 200 })
      .hero('r', { cls: 'rogue', side: 'B', at: [4, 4], maxHp: 200 })
      .hero('v', { cls: 'warrior', side: 'B', at: [5, 4], maxHp: 200 })
      .active('c', { ap: 8 })
      .build();
    const hidden = hide(around, 'r');
    const hit = resolveTargets(hidden, heroById(hidden, heroId('c')), at(5, 4), ability('warrior_cleave'), content);
    expect(hit.map((t) => t.hero.id)).toContain('r');
  });

  it('not with an area that has to be aimed at an enemy', () => {
    const state = board('paladin');
    expect(legal(state, 'paladin_heavens_hammer', [4, 4])).toBe(false);
  });

  it('an area aimed at the ground still covers it', () => {
    const state = board('mage');
    expect(legal(state, 'mage_fireball', [4, 4])).toBe(true);
  });

  it('it draws no attack of opportunity: nobody can pick it out to swing at', () => {
    const state = scenario(content)
      .hero('w', { cls: 'warrior', side: 'A', at: [3, 4], maxHp: 200 })
      .hero('r', { cls: 'rogue', side: 'B', at: [4, 4], maxHp: 200 })
      .active('r')
      .build();
    const hidden = hide(state, 'r');
    const rogue = heroById(hidden, heroId('r'));
    expect(reactorsForStep(hidden, rogue, at(4, 4), at(5, 4), [], content)).toEqual([]);
    expect(reactorsForStep(state, heroById(state, heroId('r')), at(4, 4), at(5, 4), [], content)).toHaveLength(1);
  });

  it('the guardian passes it over for a neighbour it can see', () => {
    const base = scenario(content)
      .hero('a', { cls: 'mage', side: 'A', at: [3, 4], maxHp: 200 })
      .hero('r', { cls: 'rogue', side: 'B', at: [5, 4], maxHp: 200, hp: 20 })
      .hero('v', { cls: 'warrior', side: 'B', at: [8, 8], maxHp: 200 })
      .modifier('mod_ancient_guardian')
      .active('a')
      .build();
    const rules = content.arenaModifiers.mod_ancient_guardian?.rules;
    if (rules?.kind !== 'guardian') throw new Error('setup');
    const withGuardian: BattleState = {
      ...base,
      heroes: { ...base.heroes, [GUARDIAN_ID]: { ...guardianHero(content, rules, at(4, 4)), atb: 100 } },
    };
    const state = hide(withGuardian, 'r');
    const after = applyAction(state, { type: 'endTurn', heroId: heroId('a') }, content).state;
    expect(heroById(after, heroId('r')).hp).toBe(20);
    expect(heroById(after, heroId('a')).hp).toBeLessThan(200);
  });

  it('its own side still sees it: an ally may heal it', () => {
    const state = scenario(content)
      .hero('p', { cls: 'priest', side: 'B', at: [3, 4], maxHp: 200 })
      .hero('r', { cls: 'rogue', side: 'B', at: [4, 4], maxHp: 200, hp: 50 })
      .hero('e', { cls: 'warrior', side: 'A', at: [8, 8], maxHp: 200 })
      .active('p', { ap: 8 })
      .build();
    const hidden = hide(state, 'r');
    expect(
      abilityLegality(hidden, heroById(hidden, heroId('p')), ability('priest_minor_heal'), at(4, 4), content).ok,
    ).toBe(true);
  });
});
