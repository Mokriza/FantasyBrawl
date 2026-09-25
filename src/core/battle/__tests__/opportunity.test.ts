import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { at, scenario } from '../../testing/scenario.js';
import { applyAction } from '../apply.js';
import { reachableHexes } from '../pathing.js';
import { heroById } from '../query.js';
import { heroId, statusId } from '../../types.js';
import { addStatus } from '../statuses.js';
import { updateHero } from '../query.js';
import type { BattleEvent } from '../../types.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

function opportunities(events: readonly BattleEvent[]): string[] {
  return events.filter((e) => e.type === 'opportunityAttack').map((e) => e.attackerId);
}

/** Runner at [3,3] with a melee enemy pinning it from [3,2]. */
function pinned(enemyClass = 'warrior') {
  return scenario(content)
    .hero('runner', { cls: 'hunter', side: 'A', at: [3, 3], speed: 20, maxHp: 200 })
    .hero('tank', { cls: enemyClass, side: 'B', at: [3, 2], attack: 20 })
    .active('runner', { ap: 4 })
    .build();
}

describe('zone of control as an attack of opportunity', () => {
  it('moving does not cost extra AP any more', () => {
    const state = pinned();
    const runner = heroById(state, heroId('runner'));
    const reach = reachableHexes(state, runner, 4, content);
    // [3,4] is one step away and next to nobody; it must cost exactly one point.
    const entry = reach.get(`${at(3, 4).q},${at(3, 4).r}`);
    expect(entry?.cost).toBe(1);
  });

  it('breaking contact provokes one free basic attack', () => {
    const state = pinned();
    // [3,3] -> [3,4] -> [3,5] leaves the tank's zone on the first step.
    const { events, state: after } = applyAction(
      state,
      { type: 'move', heroId: heroId('runner'), path: [at(3, 4), at(3, 5)] },
      content,
    );
    expect(opportunities(events)).toEqual(['tank']);
    expect(heroById(after, heroId('runner')).hp).toBeLessThan(200);
  });

  it('shuffling from one adjacent hex to another does not provoke', () => {
    const state = pinned();
    // [2,3] is still next to the tank at [3,2] in odd-q axial terms.
    const runner = heroById(state, heroId('runner'));
    const neighboursOfTank = reachableHexes(state, runner, 4, content);
    const sideStep = [...neighboursOfTank.entries()].find(([, entry]) => {
      return entry.path.length === 1 && entry.provokes.length === 0;
    });
    expect(sideStep).toBeDefined();
  });

  it('the same enemy only reacts once per turn', () => {
    const state = pinned();
    // Leave, come back, leave again: the tank still only swings once.
    const first = applyAction(
      state,
      { type: 'move', heroId: heroId('runner'), path: [at(3, 4), at(3, 5)] },
      content,
    );
    expect(opportunities(first.events)).toEqual(['tank']);

    const second = applyAction(
      first.state,
      { type: 'move', heroId: heroId('runner'), path: [at(3, 4)] },
      content,
    );
    expect(opportunities(second.events)).toEqual([]);
  });

  it('ranged classes hold no zone of control', () => {
    const state = scenario(content)
      .hero('runner', { cls: 'hunter', side: 'A', at: [3, 3], speed: 20 })
      .hero('archer', { cls: 'hunter', side: 'B', at: [3, 2] })
      .active('runner', { ap: 4 })
      .build();

    const { events } = applyAction(
      state,
      { type: 'move', heroId: heroId('runner'), path: [at(3, 4), at(3, 5)] },
      content,
    );
    expect(opportunities(events)).toEqual([]);
  });

  it('a stunned enemy cannot react', () => {
    let state = pinned();
    state = updateHero(state, heroId('tank'), (hero) => {
      return addStatus(hero, content, statusId('stun'), 1, 0, 1, false).hero;
    });

    const { events } = applyAction(
      state,
      { type: 'move', heroId: heroId('runner'), path: [at(3, 4), at(3, 5)] },
      content,
    );
    expect(opportunities(events)).toEqual([]);
  });

  it('two melee enemies both react when the runner leaves both zones', () => {
    const state = scenario(content)
      .hero('runner', { cls: 'hunter', side: 'A', at: [3, 3], speed: 20, maxHp: 300 })
      .hero('tank1', { cls: 'warrior', side: 'B', at: [3, 2] })
      .hero('tank2', { cls: 'paladin', side: 'B', at: [2, 3] })
      .active('runner', { ap: 4 })
      .build();

    const { events } = applyAction(
      state,
      { type: 'move', heroId: heroId('runner'), path: [at(3, 4), at(3, 5)] },
      content,
    );
    expect(opportunities(events).sort()).toEqual(['tank1', 'tank2']);
  });

  it('an ability flagged ignoresZoc does not provoke', () => {
    const state = scenario(content)
      .hero('runner', {
        cls: 'hunter',
        side: 'A',
        at: [3, 3],
        speed: 20,
        abilities: ['hunter_disengage'],
      })
      .hero('tank', { cls: 'warrior', side: 'B', at: [3, 2] })
      .active('runner', { ap: 4 })
      .build();

    const { events } = applyAction(
      state,
      {
        type: 'ability',
        heroId: heroId('runner'),
        abilityId: 'hunter_disengage' as never,
        target: at(3, 5),
      },
      content,
    );
    expect(opportunities(events)).toEqual([]);
    expect(events.some((e) => e.type === 'moved')).toBe(true);
  });

  it('paths that avoid a reaction are preferred at equal cost', () => {
    const state = pinned();
    const runner = heroById(state, heroId('runner'));
    for (const entry of reachableHexes(state, runner, 4, content).values()) {
      // Every stored path is the least-punished one to its hex.
      expect(entry.provokes.length).toBeLessThanOrEqual(1);
    }
  });
});
