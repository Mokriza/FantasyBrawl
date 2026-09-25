import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { Ability, ContentRegistry } from '../../content.js';
import { at, scenario } from '../../testing/scenario.js';
import { applyAction } from '../apply.js';
import { abilityLegality } from '../legal.js';
import { heroById } from '../query.js';
import { barrierAmount } from '../statuses.js';
import { abilityId, heroId } from '../../types.js';
import type { BattleEvent, BattleState } from '../../types.js';

let content: ContentRegistry;
let abilities: Ability[];

beforeAll(() => {
  content = loadContent();
  abilities = Object.values(content.abilities).filter((a) => a.basic !== true);
});

/**
 * A board with a caster, two adjacent enemies and two adjacent allies, all wounded so
 * that healing has somewhere to go and nothing is at full strength.
 */
function stage(casterClass: string, ability: string): BattleState {
  return scenario(content)
    .seed(42)
    .hero('c', {
      cls: casterClass,
      side: 'A',
      at: [3, 3],
      abilities: [ability],
      hp: 70,
      maxHp: 140,
      magic: 20,
      attack: 20,
    })
    .hero('e1', { cls: 'warrior', side: 'B', at: [3, 2], maxHp: 400, hp: 300, atb: 50 })
    .hero('e2', { cls: 'mage', side: 'B', at: [4, 2], maxHp: 400, hp: 300, atb: 50 })
    .hero('a1', { cls: 'priest', side: 'A', at: [2, 3], maxHp: 200, hp: 120 })
    .hero('a2', { cls: 'hunter', side: 'A', at: [2, 4], maxHp: 200, hp: 120 })
    .active('c', { ap: 4 })
    .build();
}

function aimFor(ability: Ability) {
  // A charge at an enemy already in contact has nowhere to move to, so those abilities
  // are aimed at the enemy two hexes out instead.
  const pullsCaster = ability.effects.some((e) => e.type === 'move' && e.to === 'adjacentToTarget');
  switch (ability.targets) {
    case 'self':
      return at(3, 3);
    case 'ally':
      return at(2, 3);
    case 'emptyHex':
      return at(3, 4);
    default:
      return pullsCaster ? at(4, 2) : at(3, 2);
  }
}

describe('every ability in the content', () => {
  it('every class a hero can be has abilities, and no ability belongs to a missing class', () => {
    const byClass = new Set(abilities.map((a) => a.class));
    const heroClasses = Object.values(content.classes)
      .filter((c) => c.summonOnly !== true)
      .map((c) => c.id)
      .sort();
    expect([...byClass].sort()).toEqual(heroClasses);
    expect(heroClasses).toContain('rogue');
  });

  it('runs a case for each ability', () => {
    expect(abilities.length).toBeGreaterThanOrEqual(30);
  });
});

describe.each(
  // vitest needs the list at collection time, so the content is loaded twice here.
  Object.values(loadContent().abilities).filter((a) => a.basic !== true),
)('$id', (ability) => {
  it('is legal on a fitting board and applies without throwing', () => {
    const state = stage(ability.class, ability.id);
    const caster = heroById(state, heroId('c'));
    const target = aimFor(ability);

    const legality = abilityLegality(state, caster, ability, target, content);
    expect(legality).toEqual({ ok: true });

    const result = applyAction(
      state,
      { type: 'ability', heroId: heroId('c'), abilityId: abilityId(ability.id), target },
      content,
    );

    expect(result.events.some((e) => e.type === 'abilityUsed')).toBe(true);
  });

  it('spends the stated action points and takes its cooldown', () => {
    const state = stage(ability.class, ability.id);
    const target = aimFor(ability);
    const result = applyAction(
      state,
      { type: 'ability', heroId: heroId('c'), abilityId: abilityId(ability.id), target },
      content,
    );

    // Spending the last point ends the turn on its own, which zeroes the points and
    // ticks the cooldown once. Both checks only hold while the turn is still running.
    const turnStillRunning = result.state.activeHeroId === heroId('c');
    const caster = heroById(result.state, heroId('c'));

    // An ability may hand points back to its own caster ("Скольжение").
    const refund = ability.effects.reduce(
      (sum, e) => sum + (e.type === 'ap' && e.who === 'caster' ? e.delta : 0),
      0,
    );
    if (turnStillRunning) {
      expect(4 - result.state.apLeft).toBe(ability.ap - refund);
    }

    if (ability.cooldown === 'once') {
      expect(caster.cooldowns[ability.id]).toBeLessThan(0);
    } else if (ability.cooldown > 0) {
      // Stored as N; the tick at the end of the turn counts, so the ability is ready
      // again N turns later.
      const expected = turnStillRunning ? ability.cooldown : ability.cooldown - 1;
      expect(caster.cooldowns[ability.id]).toBe(expected);
    }
  });

  it('produces the kind of event its effects promise', () => {
    const state = stage(ability.class, ability.id);
    const target = aimFor(ability);
    const { events } = applyAction(
      state,
      { type: 'ability', heroId: heroId('c'), abilityId: abilityId(ability.id), target },
      content,
    );

    const kinds = new Set<BattleEvent['type']>(events.map((e) => e.type));
    // A delayed ability promises only that it is on its way; its effects come later.
    if (ability.delay !== undefined) {
      expect(kinds.has('abilityDelayed')).toBe(true);
      return;
    }
    for (const effect of ability.effects) {
      // Conditional atoms may legitimately do nothing on this board.
      if (effect.if !== undefined) continue;
      switch (effect.type) {
        case 'damage':
          expect(kinds.has('damaged')).toBe(true);
          break;
        case 'heal':
          expect(kinds.has('healed')).toBe(true);
          break;
        case 'status':
        case 'barrier':
          expect(kinds.has('statusApplied') || kinds.has('statusResisted')).toBe(true);
          break;
        case 'move':
          expect(kinds.has('moved')).toBe(true);
          break;
        case 'push':
          expect(kinds.has('pushed')).toBe(true);
          break;
        case 'atb':
          expect(kinds.has('atbChanged')).toBe(true);
          break;
        case 'cleanse':
          // Nothing to strip on a clean target; the atom is still exercised.
          break;
      }
    }
  });

  it('leaves the state it was given untouched', () => {
    const state = stage(ability.class, ability.id);
    const frozen = JSON.stringify(state);
    applyAction(
      state,
      { type: 'ability', heroId: heroId('c'), abilityId: abilityId(ability.id), target: aimFor(ability) },
      content,
    );
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

describe('the paladin, a hybrid of tank, support and damage', () => {
  function cast(state: BattleState, id: string, target = at(3, 2)) {
    return applyAction(
      state,
      { type: 'ability', heroId: heroId('c'), abilityId: abilityId(id), target },
      content,
    );
  }

  function damagesEnemies(ability: Ability): boolean {
    return ability.effects.some((e) => e.type === 'damage');
  }

  it('splits its pool evenly: half deals damage, half protects and heals', () => {
    const pool = abilities.filter((a) => a.class === 'paladin');
    const offence = pool.filter(damagesEnemies);
    expect(pool).toHaveLength(10);
    expect(offence).toHaveLength(5);
  });

  it('draws its damage from Magic, the stat the class actually invests in', () => {
    for (const ability of abilities.filter((a) => a.class === 'paladin' && damagesEnemies(a))) {
      const magic = ability.effects.some((e) => e.type === 'damage' && e.scale === 'magic');
      expect(magic, ability.id).toBe(true);
    }
  });

  it('Heavens Hammer hits the target and every enemy next to it', () => {
    const { events } = cast(stage('paladin', 'paladin_heavens_hammer'), 'paladin_heavens_hammer');
    const hit = new Set(events.flatMap((e) => (e.type === 'damaged' ? [e.targetId] : [])));
    expect(hit).toEqual(new Set(['e1', 'e2']));
  });

  it('Holy Wrath hits and slows only the enemies adjacent to the paladin', () => {
    const { events } = cast(stage('paladin', 'paladin_holy_wrath'), 'paladin_holy_wrath', at(3, 3));
    const hit = events.flatMap((e) => (e.type === 'damaged' ? [e.targetId] : []));
    const slowed = events.flatMap((e) =>
      e.type === 'statusApplied' && e.status === 'slow' ? [e.targetId] : [],
    );
    expect(hit).toEqual(['e1']);
    expect(slowed).toEqual(['e1']);
  });

  it('Divine Bulwark shields the whole team, the paladin included', () => {
    const { state } = cast(stage('paladin', 'paladin_bulwark'), 'paladin_bulwark', at(3, 3));
    for (const id of ['c', 'a1', 'a2']) {
      expect(barrierAmount(heroById(state, heroId(id))), id).toBe(30);
    }
    expect(barrierAmount(heroById(state, heroId('e1')))).toBe(0);
  });

  it('Judgement weakens, which lets Retribution stun', () => {
    const base = stage('paladin', 'paladin_judgement');
    const withBoth = {
      ...base,
      heroes: {
        ...base.heroes,
        c: { ...heroById(base, heroId('c')), abilities: [abilityId('paladin_judgement'), abilityId('paladin_retribution')] },
      },
    };
    const first = cast(withBoth, 'paladin_judgement');
    const second = cast({ ...first.state, apLeft: 3 }, 'paladin_retribution');
    expect(
      second.events.some((e) => e.type === 'statusApplied' && e.status === 'stun' && e.targetId === 'e1'),
    ).toBe(true);
  });
});

describe('area abilities and their own caster', () => {
  it('an enemies-only area aimed next to the caster does not hit the caster', () => {
    // The three-hex fireball picks the two neighbours of the target nearest the caster,
    // and with the target adjacent one of them is the caster's own hex.
    const state = stage('mage', 'mage_fireball');
    const { events } = applyAction(
      state,
      { type: 'ability', heroId: heroId('c'), abilityId: abilityId('mage_fireball'), target: at(3, 2) },
      content,
    );
    const hit = events.flatMap((e) => (e.type === 'damaged' ? [e.targetId] : []));
    expect(hit).not.toContain('c');
    expect(hit).toContain('e1');
  });
});
