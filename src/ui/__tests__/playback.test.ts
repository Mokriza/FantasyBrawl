/**
 * The shown state is what the player actually reads, so it gets a test even though
 * interface tests are optional (docs/ai/testing-and-simulation.md). Everything here
 * is pure: no timers, no DOM.
 */

import { describe, expect, it } from 'vitest';
import type { BattleEvent } from '../../core/index.js';
import { heroId } from '../../core/index.js';
import { EFFECT_MS, advanceDisplay, inFlightMs, pruneEffects, pruneFloats, soundOf } from '../playback.js';
import type { Projection } from '../playback.js';
import type { AbilityStyle } from '../vfx.js';

const HERO = heroId('a');
const FOE = heroId('b');

function start(): Projection {
  return {
    heroes: {
      a: { hex: { q: 0, r: 0 }, hp: 100 },
      b: { hex: { q: 3, r: 0 }, hp: 80 },
    },
    floats: [],
    effects: [],
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

describe('flourishes and sounds', () => {
  const fx = {
    ...ctx,
    pace: 1,
    abilityLook: (id: string) =>
      id === 'bow' ? { melee: false, tone: 'physical' as const } : id === 'blade' ? { melee: true, tone: 'physical' as const } : undefined,
  };
  const run = (events: readonly BattleEvent[], context = fx): Projection =>
    events.reduce((acc, event) => advanceDisplay(acc, event, context), start());

  it('a shot from afar flies as a bolt from the shooter to the target, and the hit flashes', () => {
    const after = run([
      { type: 'abilityUsed', heroId: HERO, abilityId: 'bow' as never, target: { q: 3, r: 0 }, ap: 2 },
      { type: 'damaged', targetId: FOE, sourceId: HERO, amount: 12, crit: true, school: 'physical' },
    ]);
    expect(after.effects.map((e) => e.kind)).toEqual(['bolt', 'hit']);
    expect(after.effects[0]).toMatchObject({ from: { q: 0, r: 0 }, hex: { q: 3, r: 0 }, ms: EFFECT_MS.bolt });
    expect(after.effects[1]).toMatchObject({ strong: true, hex: { q: 3, r: 0 } });
    expect(after.heroes.b?.hitAt).toBe(1000);
  });

  it('a blade in reach sweeps instead of flying', () => {
    const after = run([{ type: 'abilityUsed', heroId: HERO, abilityId: 'blade' as never, target: { q: 1, r: 0 }, ap: 2 }]);
    expect(after.effects[0]?.kind).toBe('slash');
  });

  it('a step slides from the old hex, and faster playback shortens everything', () => {
    const after = run([{ type: 'moved', heroId: HERO, from: { q: 0, r: 0 }, to: { q: 1, r: 0 } }], { ...fx, pace: 0.5 });
    expect(after.heroes.a).toMatchObject({ hex: { q: 1, r: 0 }, from: { q: 0, r: 0 }, walkAt: 1000 });
    const hit = run([{ type: 'died', heroId: FOE }], { ...fx, pace: 0.5 });
    expect(hit.effects[0]?.ms).toBe(EFFECT_MS.death / 2);
  });

  it('at the instant speed there are no flourishes, and the state is the same', () => {
    const events: BattleEvent[] = [
      { type: 'abilityUsed', heroId: HERO, abilityId: 'bow' as never, target: { q: 3, r: 0 }, ap: 2 },
      { type: 'damaged', targetId: FOE, sourceId: HERO, amount: 12, crit: false, school: 'physical' },
    ];
    const instant = run(events, { ...fx, pace: 0 });
    expect(instant.effects).toEqual([]);
    expect(instant.heroes.b?.hp).toBe(run(events).heroes.b?.hp);
  });

  it('finished flourishes are dropped', () => {
    const after = run([{ type: 'died', heroId: FOE }]);
    expect(pruneEffects(after.effects, 1000 + EFFECT_MS.death - 1)).toHaveLength(1);
    expect(pruneEffects(after.effects, 1000 + EFFECT_MS.death)).toHaveLength(0);
  });

  it('each kind of blow has its sound', () => {
    const look = fx.abilityLook;
    expect(soundOf({ type: 'abilityUsed', heroId: HERO, abilityId: 'bow' as never, target: { q: 3, r: 0 }, ap: 2 }, look)).toBe('shoot');
    expect(soundOf({ type: 'abilityUsed', heroId: HERO, abilityId: 'blade' as never, target: { q: 1, r: 0 }, ap: 2 }, look)).toBe('swing');
    expect(soundOf({ type: 'damaged', targetId: FOE, sourceId: HERO, amount: 5, crit: false, school: 'magic' }, look)).toBe('hitMagic');
    expect(soundOf({ type: 'damaged', targetId: FOE, sourceId: HERO, amount: 5, crit: true, school: 'magic' }, look)).toBe('crit');
    expect(soundOf({ type: 'turnEnded', heroId: HERO }, look)).toBeNull();
  });
});

describe('styled abilities (assets/vfx.json)', () => {
  const THIRD = heroId('c');
  const lightning: AbilityStyle = { delivery: 'chain', impact: 'thunder', castSound: 'thunder', impactSound: 'thunder' };
  const fireball: AbilityStyle = { delivery: 'projectile', projectile: 'fireball', impact: 'explosion', castSound: 'fireball', impactSound: 'explosion' };
  const sword: AbilityStyle = { delivery: 'swing', weapon: 'sword', motion: 'slash', impact: 'cut', castSound: 'slash', impactSound: 'hitBlade' };
  const styles: Record<string, AbilityStyle> = { chain: lightning, fireball, blade: sword, meteor: fireball };
  const styled = {
    ...ctx,
    pace: 1,
    styleOf: (id: string) => styles[id],
    basicStyleOf: () => sword,
    isDelayed: (id: string) => id === 'meteor',
  };
  const three = (): Projection => ({ ...start(), heroes: { ...start().heroes, c: { hex: { q: 3, r: 1 }, hp: 60 } } });
  const run = (events: readonly BattleEvent[]): Projection =>
    events.reduce((acc, event) => advanceDisplay(acc, event, styled), three());
  const blow = (target: typeof FOE): BattleEvent => ({ type: 'damaged', targetId: target, sourceId: HERO, amount: 9, crit: false, school: 'magic' });

  it('a chain jumps from the caster to the first target, then from target to target', () => {
    const after = run([
      { type: 'abilityUsed', heroId: HERO, abilityId: 'chain' as never, target: { q: 3, r: 0 }, ap: 3 },
      blow(FOE),
      blow(THIRD),
    ]);
    const bolts = after.effects.filter((e) => e.kind === 'lightning');
    expect(bolts.map((e) => [e.from, e.hex])).toEqual([
      [{ q: 0, r: 0 }, { q: 3, r: 0 }],
      [{ q: 3, r: 0 }, { q: 3, r: 1 }],
    ]);
    // Every blow plays the chain's own impact.
    expect(after.effects.filter((e) => e.kind === 'anim').map((e) => e.anim)).toEqual(['thunder', 'thunder']);
  });

  it('a fireball flies to the target and explodes where each blow lands', () => {
    const after = run([
      { type: 'abilityUsed', heroId: HERO, abilityId: 'fireball' as never, target: { q: 3, r: 0 }, ap: 3 },
      blow(FOE),
      blow(THIRD),
    ]);
    expect(after.effects[0]).toMatchObject({ kind: 'projectile', sprite: 'fireball', from: { q: 0, r: 0 }, hex: { q: 3, r: 0 } });
    expect(after.effects.slice(1).map((e) => [e.anim, e.hex])).toEqual([
      ['explosion', { q: 3, r: 0 }],
      ['explosion', { q: 3, r: 1 }],
    ]);
  });

  it('the blow waits for a shot in flight, and nothing else', () => {
    const cast = advanceDisplay(three(), { type: 'abilityUsed', heroId: HERO, abilityId: 'fireball' as never, target: { q: 3, r: 0 }, ap: 3 }, styled);
    expect(inFlightMs(cast.effects, 1000)).toBe(EFFECT_MS.projectile);
    expect(inFlightMs(cast.effects, 1000 + EFFECT_MS.projectile)).toBe(0);
    // An explosion is not in flight: the next blow need not wait for it to fade.
    const landed = advanceDisplay(cast, blow(FOE), styled);
    expect(inFlightMs(landed.effects.slice(1), 1000)).toBe(0);
  });

  it('a blade is swung by the attacker towards the target', () => {
    const after = run([{ type: 'abilityUsed', heroId: HERO, abilityId: 'blade' as never, target: { q: 1, r: 0 }, ap: 2 }]);
    expect(after.effects[0]).toMatchObject({ kind: 'weapon', sprite: 'sword', motion: 'slash', from: { q: 0, r: 0 } });
  });

  it('a delayed ability is only prepared when used, and nothing is being cast after it', () => {
    const after = run([{ type: 'abilityUsed', heroId: HERO, abilityId: 'meteor' as never, target: { q: 3, r: 0 }, ap: 3 }]);
    expect(after.effects.map((e) => e.anim)).toEqual(['arcaneCircle']);
    expect(after.casting).toBeUndefined();
  });

  it('a new turn ends the cast, so the next blow is an ordinary hit', () => {
    const after = run([
      { type: 'abilityUsed', heroId: HERO, abilityId: 'fireball' as never, target: { q: 3, r: 0 }, ap: 3 },
      { type: 'turnEnded', heroId: HERO },
      blow(FOE),
    ]);
    expect(after.casting).toBeUndefined();
    expect(after.effects.at(-1)?.kind).toBe('hit');
  });

  it('the cast has its sound, and every blow the style\'s own', () => {
    const noLook = (): undefined => undefined;
    const context = { styleOf: styled.styleOf, basicStyleOf: styled.basicStyleOf };
    expect(soundOf({ type: 'abilityUsed', heroId: HERO, abilityId: 'fireball' as never, target: { q: 3, r: 0 }, ap: 3 }, noLook, context)).toBe('fireball');
    const casting = run([{ type: 'abilityUsed', heroId: HERO, abilityId: 'chain' as never, target: { q: 3, r: 0 }, ap: 3 }]).casting;
    expect(casting).toBeDefined();
    expect(soundOf(blow(FOE), noLook, { ...context, ...(casting === undefined ? {} : { casting }) })).toBe('thunder');
  });
});
