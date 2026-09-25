/**
 * The shown state is what the player actually reads, so it gets a test even though
 * interface tests are optional (docs/ai/testing-and-simulation.md). Everything here
 * is pure: no timers, no DOM.
 */

import { describe, expect, it } from 'vitest';
import type { BattleEvent } from '../../core/index.js';
import { heroId } from '../../core/index.js';
import { advanceDisplay, pruneFloats } from '../playback.js';
import type { Projection } from '../playback.js';

const HERO = heroId('a');
const FOE = heroId('b');

function start(): Projection {
  return {
    heroes: {
      a: { hex: { q: 0, r: 0 }, hp: 100 },
      b: { hex: { q: 3, r: 0 }, hp: 80 },
    },
    floats: [],
  };
}

let nextId = 0;
const ctx = {
  maxHpOf: (): number => 100,
  now: 1000,
  nextFloatId: (): number => nextId++,
};

function play(projection: Projection, events: readonly BattleEvent[]): Projection {
  return events.reduce((acc, event) => advanceDisplay(acc, event, ctx), projection);
}

describe('the shown state', () => {
  it('walks a hero one hex per moved event', () => {
    const after = play(start(), [
      { type: 'moved', heroId: HERO, from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
      { type: 'moved', heroId: HERO, from: { q: 1, r: 0 }, to: { q: 2, r: 0 } },
    ]);
    expect(after.heroes.a?.hex).toEqual({ q: 2, r: 0 });
  });

  it('drops health and raises a number when damage lands', () => {
    const after = play(start(), [
      { type: 'damaged', targetId: FOE, sourceId: HERO, amount: 24, crit: false, school: 'physical' },
    ]);
    expect(after.heroes.b?.hp).toBe(56);
    expect(after.floats).toHaveLength(1);
    expect(after.floats[0]?.text).toBe('−24');
    expect(after.floats[0]?.kind).toBe('damage');
    // The number appears over the hex the target is standing on.
    expect(after.floats[0]?.hex).toEqual({ q: 3, r: 0 });
  });

  it('marks a crit differently so it reads at a glance', () => {
    const after = play(start(), [
      { type: 'damaged', targetId: FOE, sourceId: HERO, amount: 40, crit: true, school: 'physical' },
    ]);
    expect(after.floats[0]?.kind).toBe('crit');
  });

  it('never takes health below zero', () => {
    const after = play(start(), [
      { type: 'damaged', targetId: FOE, sourceId: HERO, amount: 500, crit: false, school: 'magic' },
    ]);
    expect(after.heroes.b?.hp).toBe(0);
  });

  it('caps healing at the hero maximum', () => {
    const after = play(start(), [
      { type: 'healed', targetId: HERO, sourceId: HERO, amount: 50 },
    ]);
    expect(after.heroes.a?.hp).toBe(100);
    expect(after.floats[0]?.text).toBe('+50');
    expect(after.floats[0]?.kind).toBe('heal');
  });

  it('shows what a barrier soaked up', () => {
    const after = play(start(), [
      { type: 'barrierAbsorbed', targetId: FOE, amount: 18, left: 12 },
    ]);
    expect(after.floats[0]?.kind).toBe('block');
    expect(after.floats[0]?.text).toContain('18');
    // A barrier costs no health, only shield.
    expect(after.heroes.b?.hp).toBe(80);
  });

  it('says so when control is resisted, which is otherwise invisible', () => {
    const after = play(start(), [
      { type: 'statusResisted', targetId: FOE, status: 'stun' as never },
    ]);
    expect(after.floats[0]?.kind).toBe('status');
  });

  it('empties a hero on death', () => {
    const after = play(start(), [{ type: 'died', heroId: FOE }]);
    expect(after.heroes.b?.hp).toBe(0);
  });

  it('ignores events that change nothing on screen', () => {
    const before = start();
    const after = play(before, [
      { type: 'turnStarted', heroId: HERO, ap: 4 },
      { type: 'turnEnded', heroId: HERO },
      { type: 'atbChanged', heroId: HERO, delta: -20, atb: 30 },
    ]);
    expect(after).toEqual(before);
  });

  it('does not touch the projection it was given', () => {
    const before = start();
    const frozen = JSON.stringify(before);
    play(before, [
      { type: 'damaged', targetId: FOE, sourceId: HERO, amount: 10, crit: false, school: 'magic' },
      { type: 'moved', heroId: HERO, from: { q: 0, r: 0 }, to: { q: 1, r: 0 } },
    ]);
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('prunes numbers once they have faded', () => {
    const withFloats = play(start(), [
      { type: 'damaged', targetId: FOE, sourceId: HERO, amount: 10, crit: false, school: 'magic' },
    ]);
    expect(pruneFloats(withFloats.floats, 1500, 900)).toHaveLength(1);
    expect(pruneFloats(withFloats.floats, 2000, 900)).toHaveLength(0);
  });
});
