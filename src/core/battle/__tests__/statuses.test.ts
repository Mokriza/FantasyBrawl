import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { at, scenario } from '../../testing/scenario.js';
import { applyAction } from '../apply.js';
import { cooldownLeft } from '../legal.js';
import { heroById, updateHero } from '../query.js';
import { addStatus, statusesOf, tickHeroAtTurnEnd } from '../statuses.js';
import { statsInBattle } from '../modifiers.js';
import type { BattleHero } from '../../types.js';
import { getAbility } from '../../content.js';
import { abilityId, heroId, statusId } from '../../types.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

const SLOW = statusId('slow');
const STUN = statusId('stun');

function lone(cls: string, abilities: string[] = []) {
  return scenario(content)
    .hero('h', { cls, side: 'A', at: [2, 3], abilities, speed: 12 })
    .hero('e', { cls: 'warrior', side: 'B', at: [4, 3], maxHp: 500 })
    .active('h', { ap: 4 })
    .build();
}

/** A hero's final stats, standing alone on an empty board. */
function finalOf(hero: BattleHero) {
  const state = lone(hero.classId);
  return statsInBattle({ ...state, heroes: { [hero.id]: hero } }, hero, content);
}

describe('stacking', () => {
  it('slow stacks up to three times, each with its own duration', () => {
    let hero = heroById(lone('mage'), heroId('h'));
    for (let i = 0; i < 5; i++) {
      hero = addStatus(hero, content, SLOW, 2, 2, 3, false).hero;
    }
    expect(statusesOf(hero, SLOW)).toHaveLength(3);
  });

  it('a flat debuff subtracts and a fractional buff multiplies', () => {
    const base = heroById(lone('mage'), heroId('h'));
    const slowed = addStatus(base, content, SLOW, 2, 4, 3, false).hero;
    expect(finalOf(slowed).speed).toBe(8);

    const blessed = addStatus(base, content, statusId('empower'), 3, 0.2, 1, false).hero;
    expect(finalOf(blessed).magic).toBeCloseTo(base.base.magic * 1.2);
  });

  it('speed never falls below the configured floor', () => {
    let hero = heroById(lone('mage'), heroId('h'));
    for (let i = 0; i < 3; i++) {
      hero = addStatus(hero, content, SLOW, 5, 99, 3, false).hero;
    }
    expect(finalOf(hero).speed).toBe(content.config.formulas.minSpeed);
  });

  it('barriers pool into one value and keep the longest duration', () => {
    let hero = heroById(lone('paladin'), heroId('h'));
    hero = addStatus(hero, content, statusId('barrier'), 2, 30, 1, false).hero;
    hero = addStatus(hero, content, statusId('barrier'), 5, 20, 1, false).hero;
    const pooled = statusesOf(hero, statusId('barrier'));
    expect(pooled).toHaveLength(1);
    expect(pooled[0]?.value).toBe(50);
    expect(pooled[0]?.turns).toBe(5);
  });
});

describe('the repeat-control rule', () => {
  it('hard control cannot land twice in a row', () => {
    const base = heroById(lone('warrior'), heroId('h'));
    const first = addStatus(base, content, STUN, 1, 0, 1, false);
    expect(first.events[0]?.type).toBe('statusApplied');

    // Close the turn so the stun this turn becomes "the previous turn".
    const afterTurn = tickHeroAtTurnEnd(first.hero).hero;
    const second = addStatus(afterTurn, content, STUN, 1, 0, 1, false);
    expect(second.events[0]?.type).toBe('statusResisted');
    expect(second.hero.statuses).toHaveLength(0);
  });

  it('a soft debuff is not covered by the rule', () => {
    const base = heroById(lone('warrior'), heroId('h'));
    const first = addStatus(base, content, SLOW, 1, 2, 3, false);
    const afterTurn = tickHeroAtTurnEnd(first.hero).hero;
    const second = addStatus(afterTurn, content, SLOW, 1, 2, 3, false);
    expect(second.events[0]?.type).toBe('statusApplied');
  });
});

describe('durations and cooldowns', () => {
  it('a debuff from an enemy lasts exactly its stated number of turns', () => {
    let hero = addStatus(heroById(lone('warrior'), heroId('h')), content, SLOW, 2, 2, 3, false).hero;
    hero = tickHeroAtTurnEnd(hero).hero;
    expect(statusesOf(hero, SLOW)[0]?.turns).toBe(1);
    hero = tickHeroAtTurnEnd(hero).hero;
    expect(statusesOf(hero, SLOW)).toHaveLength(0);
  });

  it('a self-buff does not lose a turn to the turn it was cast in', () => {
    // Applied on the carrier's own turn, so the first tick only clears the flag.
    let hero = addStatus(heroById(lone('warrior'), heroId('h')), content, SLOW, 2, 2, 3, true).hero;
    hero = tickHeroAtTurnEnd(hero).hero;
    expect(statusesOf(hero, SLOW)[0]?.turns).toBe(2);
    hero = tickHeroAtTurnEnd(hero).hero;
    expect(statusesOf(hero, SLOW)[0]?.turns).toBe(1);
  });

  it('a cooldown of N brings the ability back N turns later', () => {
    const state = scenario(content)
      .hero('h', { cls: 'warrior', side: 'A', at: [2, 3], abilities: ['warrior_cleave'] })
      .hero('e', { cls: 'warrior', side: 'B', at: [3, 3], maxHp: 500 })
      .active('h', { ap: 4 })
      .build();
    const cleave = getAbility(content, abilityId('warrior_cleave'));
    expect(cleave.cooldown).toBe(2);

    const used = applyAction(
      state,
      { type: 'ability', heroId: heroId('h'), abilityId: abilityId('warrior_cleave'), target: at(3, 3) },
      content,
    ).state;

    // Used on turn T with a cooldown of 2: the tick at the end of T counts, so the
    // ability skips T+1 and is ready again on T+2. See game-rules.md section 9.
    let hero = heroById(used, heroId('h'));
    expect(cooldownLeft(hero, cleave)).toBe(2);

    hero = tickHeroAtTurnEnd(hero).hero;
    expect(cooldownLeft(hero, cleave)).toBe(1);
    hero = tickHeroAtTurnEnd(hero).hero;
    expect(cooldownLeft(hero, cleave)).toBe(0);
  });

  it('a cooldown of 1 is ready again on the very next turn', () => {
    // No ability ships with cooldown 1 after the balance pass, so one is made here.
    const base = getAbility(content, abilityId('priest_minor_heal'));
    const content1 = { ...content, abilities: { ...content.abilities, priest_minor_heal: { ...base, cooldown: 1 } } };
    const state = scenario(content1)
      .hero('h', { cls: 'priest', side: 'A', at: [2, 3], abilities: ['priest_minor_heal'] })
      .hero('ally', { cls: 'warrior', side: 'A', at: [2, 4], hp: 50 })
      .hero('e', { cls: 'warrior', side: 'B', at: [5, 3] })
      .active('h', { ap: 4 })
      .build();
    const heal = getAbility(content1, abilityId('priest_minor_heal'));
    expect(heal.cooldown).toBe(1);

    const used = applyAction(
      state,
      { type: 'ability', heroId: heroId('h'), abilityId: abilityId('priest_minor_heal'), target: at(2, 4) },
      content1,
    ).state;

    const hero = tickHeroAtTurnEnd(heroById(used, heroId('h'))).hero;
    expect(cooldownLeft(hero, heal)).toBe(0);
  });

  it('a once-per-match ability never comes back', () => {
    const state = scenario(content)
      .hero('h', { cls: 'priest', side: 'A', at: [2, 3], abilities: ['priest_intervention'] })
      .hero('ally', { cls: 'warrior', side: 'A', at: [2, 4], hp: 10 })
      .hero('e', { cls: 'warrior', side: 'B', at: [5, 3] })
      .active('h', { ap: 4 })
      .build();

    const used = applyAction(
      state,
      {
        type: 'ability',
        heroId: heroId('h'),
        abilityId: abilityId('priest_intervention'),
        target: at(2, 4),
      },
      content,
    ).state;

    let hero = heroById(used, heroId('h'));
    for (let i = 0; i < 30; i++) hero = tickHeroAtTurnEnd(hero).hero;
    expect(cooldownLeft(hero, getAbility(content, abilityId('priest_intervention')))).toBeLessThan(0);
  });
});

describe('poison', () => {
  it('ticks at the start of the carrier turn and ignores defence', () => {
    let state = scenario(content)
      .hero('h', { cls: 'warrior', side: 'A', at: [2, 3], armor: 100, speed: 30 })
      .hero('e', { cls: 'warrior', side: 'B', at: [5, 3], speed: 1 })
      .active('h', { ap: 4 })
      .build();

    state = updateHero(state, heroId('h'), (hero) => {
      return addStatus(hero, content, statusId('dot'), 3, 10, 3, false).hero;
    });

    const before = heroById(state, heroId('h')).hp;
    // End the turn and come back around to the same hero.
    let next = applyAction(state, { type: 'endTurn', heroId: heroId('h') }, content).state;
    while (next.activeHeroId !== heroId('h') && next.outcome === null) {
      const active = next.activeHeroId;
      if (active === null) break;
      next = applyAction(next, { type: 'endTurn', heroId: active }, content).state;
    }
    expect(heroById(next, heroId('h')).hp).toBe(before - 10);
  });
});
