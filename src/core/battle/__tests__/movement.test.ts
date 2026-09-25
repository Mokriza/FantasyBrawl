import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { at, scenario } from '../../testing/scenario.js';
import { applyAction } from '../apply.js';
import { reachableHexes } from '../pathing.js';
import { heroById } from '../query.js';
import { hasLineOfSight } from '../targeting.js';
import { hexKey } from '../../hex.js';
import { heroId } from '../../types.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

function walker(build?: (s: ReturnType<typeof scenario>) => void) {
  const s = scenario(content)
    .hero('h', { cls: 'mage', side: 'A', at: [3, 3], maxHp: 200 })
    .hero('far', { cls: 'mage', side: 'B', at: [6, 6] })
    .active('h', { ap: 4 });
  build?.(s);
  return s.build();
}

describe('movement', () => {
  it('a plain step costs one point', () => {
    const state = walker();
    const reach = reachableHexes(state, heroById(state, heroId('h')), 4, content);
    expect(reach.get(hexKey(at(3, 2)))?.cost).toBe(1);
  });

  it('rock cannot be walked through', () => {
    const state = walker((s) => {
      s.obstacle('rock', [3, 2]);
    });
    const reach = reachableHexes(state, heroById(state, heroId('h')), 4, content);
    expect(reach.has(hexKey(at(3, 2)))).toBe(false);
  });

  it('thicket is walkable', () => {
    const state = walker((s) => {
      s.obstacle('thicket', [3, 2]);
    });
    const reach = reachableHexes(state, heroById(state, heroId('h')), 4, content);
    expect(reach.get(hexKey(at(3, 2)))?.cost).toBe(1);
  });

  it('a pit costs an extra point and bites on entry', () => {
    const state = walker((s) => {
      s.obstacle('pit', [3, 2]);
    });
    const reach = reachableHexes(state, heroById(state, heroId('h')), 4, content);
    expect(reach.get(hexKey(at(3, 2)))?.cost).toBe(2);

    const before = heroById(state, heroId('h')).hp;
    const { state: after } = applyAction(
      state,
      { type: 'move', heroId: heroId('h'), path: [at(3, 2)] },
      content,
    );
    expect(heroById(after, heroId('h')).hp).toBe(before - content.config.arena.pit.damage);
  });

  it('another hero blocks the hex', () => {
    const state = scenario(content)
      .hero('h', { cls: 'mage', side: 'A', at: [3, 3] })
      .hero('blocker', { cls: 'mage', side: 'A', at: [3, 2] })
      .hero('far', { cls: 'mage', side: 'B', at: [6, 6] })
      .active('h', { ap: 4 })
      .build();
    const reach = reachableHexes(state, heroById(state, heroId('h')), 4, content);
    expect(reach.has(hexKey(at(3, 2)))).toBe(false);
  });

  it('spends exactly the points the path costs', () => {
    const state = walker();
    const { state: after } = applyAction(
      state,
      { type: 'move', heroId: heroId('h'), path: [at(3, 2), at(3, 1)] },
      content,
    );
    expect(after.apLeft).toBe(2);
  });

  it('a path that is not reachable is a caller bug, not a refusal', () => {
    const state = walker();
    expect(() =>
      applyAction(state, { type: 'move', heroId: heroId('h'), path: [at(0, 0)] }, content),
    ).toThrow();
  });

  it('applyAction leaves the state it was given untouched', () => {
    const state = walker();
    const frozen = JSON.stringify(state);
    applyAction(state, { type: 'move', heroId: heroId('h'), path: [at(3, 2)] }, content);
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

describe('line of sight', () => {
  it('rock blocks it', () => {
    const state = walker((s) => {
      s.obstacle('rock', [3, 2]);
    });
    expect(hasLineOfSight(state, at(3, 3), at(3, 1))).toBe(false);
  });

  it('thicket blocks it', () => {
    const state = walker((s) => {
      s.obstacle('thicket', [3, 2]);
    });
    expect(hasLineOfSight(state, at(3, 3), at(3, 1))).toBe(false);
  });

  it('a thicket the target stands in does not hide it', () => {
    const state = walker((s) => {
      s.obstacle('thicket', [3, 2]);
    });
    expect(hasLineOfSight(state, at(3, 3), at(3, 2))).toBe(true);
  });

  it('heroes never block sight', () => {
    const state = scenario(content)
      .hero('h', { cls: 'mage', side: 'A', at: [3, 3] })
      .hero('wall', { cls: 'warrior', side: 'A', at: [3, 2] })
      .hero('target', { cls: 'mage', side: 'B', at: [3, 1] })
      .active('h', { ap: 4 })
      .build();
    expect(hasLineOfSight(state, at(3, 3), at(3, 1))).toBe(true);
  });
});
