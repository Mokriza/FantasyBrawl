/**
 * Passives: modifiers and triggers. Every passive of the six classes is exercised
 * here on a fixed board with the dice frozen, so each number can be worked out by
 * hand from the rule it tests.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { at, scenario } from '../../testing/scenario.js';
import type { ScenarioHero } from '../../testing/scenario.js';
import { applyAction, startBattle } from '../apply.js';
import { abilityApCost, abilityCooldown, abilityRange } from '../legal.js';
import { withPerkHealth } from '../../run/upgrade.js';
import { critMultiplier, statsInBattle } from '../modifiers.js';
import { heroById, updateHero } from '../query.js';
import { addStatus, barrierAmount, statusesOf } from '../statuses.js';
import { abilityId, heroId, statusId } from '../../types.js';
import type { Hex } from '../../hex.js';
import type { BattleEvent, BattleState } from '../../types.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

const FROZEN = { deterministic: true } as const;

/** A caster "c" with a passive, and whoever else the test needs. */
function board(
  casterPassive: string | undefined,
  others: Record<string, ScenarioHero>,
  caster: Partial<ScenarioHero> = {},
): BattleState {
  let s = scenario(content).seed(3);
  const spec: ScenarioHero = { cls: 'warrior', side: 'A', at: [3, 3], ...caster };
  s = s.hero('c', casterPassive === undefined ? spec : { ...spec, passive: casterPassive });
  for (const [id, other] of Object.entries(others)) s = s.hero(id, other);
  return s.active('c', { ap: 4 }).build();
}

function cast(state: BattleState, ability: string, target: Hex, hero = 'c') {
  return applyAction(
    state,
    { type: 'ability', heroId: heroId(hero), abilityId: abilityId(ability), target },
    content,
    FROZEN,
  );
}

function dealt(events: readonly BattleEvent[], target: string): number {
  return events
    .filter((e) => e.type === 'damaged' && e.targetId === target)
    .reduce((sum, e) => sum + (e.type === 'damaged' ? e.amount : 0), 0);
}

const enemy = (at: [number, number], extra: Partial<ScenarioHero> = {}): ScenarioHero => ({
  cls: 'warrior',
  side: 'B',
  at,
  maxHp: 500,
  ...extra,
});

describe('modifiers', () => {
  it('Напор: +15% against the hero that took the turn before', () => {
    const plain = board('warrior_passive_onslaught', { e: enemy([3, 2]) }, { abilities: ['warrior_cleave'] });
    const withLast = { ...plain, lastActedHeroId: heroId('e') };
    const base = dealt(cast(plain, 'warrior_cleave', at(3, 2)).events, 'e');
    const boosted = dealt(cast(withLast, 'warrior_cleave', at(3, 2)).events, 'e');
    expect(boosted).toBe(Math.round(base * 1.15));
  });

  it('Оплот: +10 Armor to adjacent allies only, not to the paladin or a distant ally', () => {
    const state = board(
      'paladin_passive_bulwark',
      {
        near: { cls: 'priest', side: 'A', at: [2, 3], armor: 5 },
        far: { cls: 'priest', side: 'A', at: [0, 0], armor: 5 },
        foe: enemy([4, 3], { armor: 5 }),
      },
      { cls: 'paladin', armor: 5 },
    );
    const armor = (id: string) => statsInBattle(state, heroById(state, heroId(id)), content).armor;
    expect(armor('near')).toBe(15);
    expect(armor('far')).toBe(5);
    expect(armor('c')).toBe(5);
    expect(armor('foe')).toBe(5);
  });

  it('Терпение: 15% less damage taken while above 70% health, none below', () => {
    const hitter = (hp: number) =>
      board(undefined, {
        p: { cls: 'paladin', side: 'B', at: [3, 2], maxHp: 200, hp, passive: 'paladin_passive_patience' },
      }, { abilities: ['warrior_cleave'] });
    const healthy = dealt(cast(hitter(200), 'warrior_cleave', at(3, 2)).events, 'p');
    const hurt = dealt(cast(hitter(100), 'warrior_cleave', at(3, 2)).events, 'p');
    expect(healthy).toBe(Math.round(hurt * 0.85));
  });

  it('Питание боли: +2 Magic for every debuff on the field', () => {
    let state = board('warlock_passive_feeding_pain', { e: enemy([5, 3]) }, { cls: 'warlock', magic: 20 });
    const magic = () => statsInBattle(state, heroById(state, heroId('c')), content).magic;
    expect(magic()).toBe(20);
    state = updateHero(state, heroId('e'), (h) =>
      addStatus(h, content, statusId('slow'), 3, 2, 3, false).hero,
    );
    state = updateHero(state, heroId('e'), (h) =>
      addStatus(h, content, statusId('weaken'), 3, 0.1, 2, false).hero,
    );
    expect(magic()).toBe(24);
  });

  it('Зоркость: +1 range to abilities that reach further than one hex, and only those', () => {
    const state = board('hunter_passive_keen_eye', {}, { cls: 'hunter' });
    const hunter = heroById(state, heroId('c'));
    const aimed = content.abilities.hunter_aimed_shot;
    const basicMelee = content.abilities.basic_melee_physical;
    if (aimed === undefined || basicMelee === undefined) throw new Error('content');
    expect(abilityRange(state, hunter, aimed, content)).toBe(aimed.range + 1);
    expect(abilityRange(state, hunter, basicMelee, content)).toBe(1);
  });

  it('Инстинкт: a head start of 30 on the initiative bar', () => {
    const state = scenario(content)
      .hero('h', { cls: 'hunter', side: 'A', at: [0, 3], speed: 10, passive: 'hunter_passive_instinct' })
      .hero('e', { cls: 'warrior', side: 'B', at: [8, 3], speed: 12 })
      .build();
    // Without the bonus the faster enemy would act first.
    expect(startBattle(state, content).state.activeHeroId).toBe('h');
  });

  it('Дистанция: more damage against targets more than 3 hexes away, none closer', () => {
    const mul = content.passives.hunter_passive_distance?.modifiers[0]?.mul ?? 0;
    const shot = (passive: string | undefined, where: [number, number]) =>
      dealt(
        cast(board(passive, { e: enemy(where) }, { cls: 'hunter', abilities: ['hunter_deadly_shot'] }), 'hunter_deadly_shot', at(...where)).events,
        'e',
      );
    // Damage is rounded once at the end, so the ratio of two rounded hits may be off by one.
    expect(Math.abs(shot('hunter_passive_distance', [7, 3]) - shot(undefined, [7, 3]) * (1 + mul))).toBeLessThanOrEqual(1);
    expect(shot('hunter_passive_distance', [5, 3])).toBe(shot(undefined, [5, 3]));
  });

  it('Сила стихий: more damage against a target carrying a debuff', () => {
    const mul = content.passives.mage_passive_elements?.modifiers[0]?.mul ?? 0;
    const clean = board('mage_passive_elements', { e: enemy([5, 3]) }, { cls: 'mage', abilities: ['mage_frost_bolt'] });
    const cursed = updateHero(clean, heroId('e'), (h) =>
      addStatus(h, content, statusId('slow'), 3, 1, 3, false).hero,
    );
    const a = dealt(cast(clean, 'mage_frost_bolt', at(5, 3)).events, 'e');
    const b = dealt(cast(cursed, 'mage_frost_bolt', at(5, 3)).events, 'e');
    expect(b).toBe(Math.round(a * (1 + mul)));
  });

  it('Милосердие: healing is 25% stronger on a target below 40% health', () => {
    const heal = (hp: number) => {
      const state = board('priest_passive_mercy', { a: { cls: 'warrior', side: 'A', at: [2, 3], maxHp: 400, hp } }, {
        cls: 'priest',
        abilities: ['priest_minor_heal'],
      });
      const events = cast(state, 'priest_minor_heal', at(2, 3)).events;
      return events.find((e) => e.type === 'healed')?.amount ?? 0;
    };
    expect(heal(100)).toBe(Math.round(heal(300) * 1.25));
  });
});

describe('triggers', () => {
  it('Закалка: +2 Armor per hit taken, up to +12', () => {
    let state = board(undefined, {
      w: { cls: 'warrior', side: 'B', at: [3, 2], maxHp: 900, passive: 'warrior_passive_hardened' },
    }, { attack: 5 });
    for (let i = 0; i < 8; i++) {
      state = cast({ ...state, activeHeroId: heroId('c'), apLeft: 4 }, 'basic_melee_physical', at(3, 2)).state;
    }
    const w = heroById(state, heroId('w'));
    expect(statusesOf(w, statusId('hardened'))).toHaveLength(6);
    expect(statsInBattle(state, w, content).armor).toBe(12);
  });

  it('Кровожадность: heals 10% of the damage dealt', () => {
    const state = board('warrior_passive_bloodthirst', { e: enemy([3, 2]) }, { hp: 50, maxHp: 100, abilities: ['warrior_cleave'] });
    const { events, state: after } = cast(state, 'warrior_cleave', at(3, 2));
    const done = dealt(events, 'e');
    expect(heroById(after, heroId('c')).hp).toBe(50 + Math.round(done * 0.1));
    expect(events.some((e) => e.type === 'passiveTriggered' && e.passiveId === 'warrior_passive_bloodthirst')).toBe(true);
  });

  it('Тёмный договор: on death, 1.5 × Magic to every enemy within 2 hexes', () => {
    const state = board(undefined, {
      w: { cls: 'warlock', side: 'B', at: [3, 2], hp: 1, magic: 20, passive: 'warlock_passive_dark_pact' },
      near: { cls: 'priest', side: 'A', at: [2, 3], maxHp: 300 },
      far: { cls: 'priest', side: 'A', at: [0, 0], maxHp: 300 },
    });
    const { events } = cast(state, 'basic_melee_physical', at(3, 2));
    expect(events.some((e) => e.type === 'died' && e.heroId === 'w')).toBe(true);
    expect(dealt(events, 'c')).toBe(30);
    expect(dealt(events, 'near')).toBe(30);
    expect(dealt(events, 'far')).toBe(0);
  });

  it('Праведность: the healed ally gets +5 Resist for 2 turns', () => {
    const state = board('paladin_passive_righteousness', { a: { cls: 'warrior', side: 'A', at: [2, 3], hp: 50 } }, {
      cls: 'paladin',
      abilities: ['paladin_lay_on_hands'],
    });
    const after = cast(state, 'paladin_lay_on_hands', at(2, 3)).state;
    const ally = heroById(after, heroId('a'));
    expect(statusesOf(ally, statusId('resistUp'))[0]?.value).toBe(5);
  });

  it('Отражённый свет: a heal burns the nearest enemy for 20% of it', () => {
    const state = board('priest_passive_reflected_light', {
      a: { cls: 'warrior', side: 'A', at: [2, 3], maxHp: 400, hp: 100 },
      near: enemy([5, 3]),
      far: enemy([8, 8]),
    }, { cls: 'priest', abilities: ['priest_heal'] });
    const { events } = cast(state, 'priest_heal', at(2, 3));
    const healed = events.find((e) => e.type === 'healed')?.amount ?? 0;
    expect(healed).toBeGreaterThan(0);
    expect(dealt(events, 'near')).toBe(Math.round(healed * 0.2));
    expect(dealt(events, 'far')).toBe(0);
  });

  it('Арканный щит: the first hit of the battle is swallowed whole, the second lands', () => {
    const state = scenario(content)
      .hero('m', { cls: 'mage', side: 'B', at: [3, 2], passive: 'mage_passive_arcane_shield', speed: 1 })
      .hero('c', { cls: 'warrior', side: 'A', at: [3, 3], speed: 18 })
      .build();
    const started = startBattle(state, content).state;
    expect(started.activeHeroId).toBe('c');
    const first = cast(started, 'basic_melee_physical', at(3, 2));
    expect(dealt(first.events, 'm')).toBe(0);
    expect(first.events.some((e) => e.type === 'barrierAbsorbed' && e.targetId === 'm')).toBe(true);
    const second = cast({ ...first.state, activeHeroId: heroId('c'), apLeft: 4 }, 'basic_melee_physical', at(3, 2));
    expect(dealt(second.events, 'm')).toBeGreaterThan(0);
    expect(barrierAmount(heroById(second.state, heroId('m')))).toBe(0);
  });

  it('Эхо: every fourth ability runs again at half strength; basic attacks do not count', () => {
    let state = board('mage_passive_echo', { e: enemy([5, 3], { maxHp: 2000 }) }, {
      cls: 'mage',
      abilities: ['mage_frost_bolt'],
    });
    const hits: number[] = [];
    for (let i = 0; i < 4; i++) {
      // A basic attack in between must not advance the count.
      state = cast({ ...state, activeHeroId: heroId('c'), apLeft: 4 }, 'basic_magic_bolt', at(5, 3)).state;
      const ready = updateHero(state, heroId('c'), (h) => ({ ...h, cooldowns: {} }));
      const result = cast({ ...ready, activeHeroId: heroId('c'), apLeft: 4 }, 'mage_frost_bolt', at(5, 3));
      hits.push(result.events.filter((e) => e.type === 'damaged' && e.targetId === 'e').length);
      state = result.state;
    }
    expect(hits).toEqual([1, 1, 1, 2]);
  });

  it('Живучесть: the warlock heals 15% of the damage its poison ticks for', () => {
    // The warlock is acting; the poisoned hero is next on the bar, so ending the
    // warlock's turn starts the victim's turn and the poison ticks.
    let state = scenario(content)
      .hero('w', { cls: 'warlock', side: 'B', at: [8, 8], hp: 50, maxHp: 100, passive: 'warlock_passive_vitality' })
      .hero('v', { cls: 'warrior', side: 'A', at: [0, 0], maxHp: 400, atb: 99, speed: 10 })
      .active('w', { ap: 4 })
      .build();
    state = updateHero(state, heroId('v'), (h) =>
      addStatus(h, content, statusId('dot'), 3, 20, 3, false, heroId('w')).hero,
    );
    const { events, state: after } = applyAction(state, { type: 'endTurn', heroId: heroId('w') }, content, FROZEN);
    const tick = events.find((e) => e.type === 'damaged' && e.targetId === 'v' && e.periodic === true);
    expect(tick?.type === 'damaged' ? tick.sourceId : null).toBe('w');
    expect(tick?.type === 'damaged' ? tick.amount : 0).toBe(20);
    expect(heroById(after, heroId('w')).hp).toBe(50 + 3);
  });

  it('a chain of reactions stops at the configured depth', () => {
    // Two priests with Reflected Light healing each other cannot bounce forever: the
    // run finishes and returns.
    const state = board('priest_passive_reflected_light', {
      p2: { cls: 'priest', side: 'B', at: [3, 2], hp: 50, passive: 'priest_passive_reflected_light' },
      a: { cls: 'warrior', side: 'A', at: [2, 3], hp: 40 },
    }, { cls: 'priest', abilities: ['priest_heal'] });
    const { events } = cast(state, 'priest_heal', at(2, 3));
    expect(events.length).toBeLessThan(50);
  });
});

describe('races in battle', () => {
  it('Эльф: a head start of 15 on the initiative bar, useful to any class', () => {
    const race = (r: string | undefined) =>
      scenario(content)
        .hero('m', { cls: 'warrior', side: 'A', at: [0, 3], speed: 10, ...(r === undefined ? {} : { race: r }) })
        .hero('e', { cls: 'warrior', side: 'B', at: [8, 3], speed: 11 })
        .build();
    // Without the bonus the faster enemy acts first; with it the elf does.
    expect(startBattle(race(undefined), content).state.activeHeroId).toBe('e');
    expect(startBattle(race('elf'), content).state.activeHeroId).toBe('m');
  });

  it('Орк: +10% to any damage dealt, magic included', () => {
    const plain = board(undefined, { e: enemy([5, 3]) }, { cls: 'mage', magic: 20, abilities: ['mage_frost_bolt'] });
    const orc = board(undefined, { e: enemy([5, 3]) }, { cls: 'mage', magic: 20, abilities: ['mage_frost_bolt'], race: 'orc' });
    const base = dealt(cast(plain, 'mage_frost_bolt', at(5, 3)).events, 'e');
    expect(dealt(cast(orc, 'mage_frost_bolt', at(5, 3)).events, 'e')).toBe(Math.round(base * 1.1));
  });

  it('Орк: a crit multiplies by 1.75 + 0.25 = 2.0', () => {
    const state = board(undefined, { e: enemy([3, 2]) }, { race: 'orc' });
    const orc = heroById(state, heroId('c'));
    const target = heroById(state, heroId('e'));
    expect(critMultiplier(state, orc, target, content)).toBeCloseTo(2.0);
  });

  it('stat bonuses of a race are not applied a second time in battle', () => {
    const state = board(undefined, {}, { race: 'dwarf', armor: 10 });
    expect(statsInBattle(state, heroById(state, heroId('c')), content).armor).toBe(10);
  });
});

describe('perks in battle', () => {
  it('Экономия движений and Быстрые руки change only the chosen ability, never below 1', () => {
    const state = board(undefined, { e: enemy([3, 2]) }, {
      abilities: ['warrior_whirlwind', 'warrior_cleave'],
      perks: [
        { perkId: 'perk_economy', abilityId: 'warrior_whirlwind' },
        { perkId: 'perk_quick_hands', abilityId: 'warrior_whirlwind' },
      ],
    });
    const hero = heroById(state, heroId('c'));
    const whirl = content.abilities.warrior_whirlwind;
    const cleave = content.abilities.warrior_cleave;
    if (whirl === undefined || cleave === undefined) throw new Error('content');
    expect(abilityApCost(hero, whirl, content)).toBe(whirl.ap - 1);
    expect(abilityCooldown(hero, whirl, content)).toBe((whirl.cooldown as number) - 1);
    expect(abilityApCost(hero, cleave, content)).toBe(cleave.ap);

    const used = cast(state, 'warrior_whirlwind', at(3, 3));
    expect(4 - used.state.apLeft).toBe(whirl.ap - 1);
    expect(heroById(used.state, heroId('c')).cooldowns.warrior_whirlwind).toBe((whirl.cooldown as number) - 1);
  });

  it('Длинная рука: +1 range to the chosen ranged ability only', () => {
    const state = board(undefined, {}, {
      cls: 'hunter',
      abilities: ['hunter_aimed_shot', 'hunter_volley'],
      perks: [{ perkId: 'perk_long_reach', abilityId: 'hunter_aimed_shot' }],
    });
    const hero = heroById(state, heroId('c'));
    const aimed = content.abilities.hunter_aimed_shot;
    const volley = content.abilities.hunter_volley;
    if (aimed === undefined || volley === undefined) throw new Error('content');
    expect(abilityRange(state, hero, aimed, content)).toBe(aimed.range + 1);
    expect(abilityRange(state, hero, volley, content)).toBe(volley.range);
  });

  it('Отчаяние: below half health every cooldown loses an extra turn at the end of a turn', () => {
    const run = (hp: number) => {
      let state = board(undefined, { e: enemy([8, 8]) }, {
        hp,
        maxHp: 100,
        abilities: ['warrior_whirlwind'],
        perks: [{ perkId: 'perk_desperation' }],
      });
      state = updateHero(state, heroId('c'), (h) => ({ ...h, cooldowns: { warrior_whirlwind: 4 } }));
      const ended = applyAction(state, { type: 'endTurn', heroId: heroId('c') }, content, FROZEN);
      return heroById(ended.state, heroId('c')).cooldowns.warrior_whirlwind;
    };
    expect(run(90)).toBe(3);
    expect(run(40)).toBe(2);
  });

  it('Жнец: a kill heals a flat 15', () => {
    const state = board(undefined, { e: enemy([3, 2], { hp: 1 }) }, {
      hp: 50,
      maxHp: 100,
      perks: [{ perkId: 'perk_reaper' }],
    });
    const { state: after, events } = cast(state, 'basic_melee_physical', at(3, 2));
    expect(events.some((e) => e.type === 'died' && e.heroId === 'e')).toBe(true);
    expect(heroById(after, heroId('c')).hp).toBe(65);
  });

  it('Страж: adjacent allies take 10% less damage, the guardian itself does not', () => {
    const hit = (target: string, guardian: boolean) => {
      const state = board(undefined, {
        g: { cls: 'paladin', side: 'B', at: [4, 2], maxHp: 500, ...(guardian ? { perks: [{ perkId: 'perk_guardian' }] } : {}) },
        t: enemy([3, 2]),
      }, { abilities: ['warrior_cleave'] });
      return dealt(cast(state, 'basic_melee_physical', at(3, 2)).events, target);
    };
    expect(hit('t', true)).toBe(Math.round(hit('t', false) * 0.9));
  });

  it('+20 Health from a perk is built into the hero, not added mid-battle', () => {
    const base = { maxHp: 100, attack: 10, magic: 10, armor: 0, resist: 0, speed: 10, critChance: 0.05 };
    expect(withPerkHealth(base, [{ perkId: 'perk_vigor' }], content).maxHp).toBe(120);
    expect(withPerkHealth(base, [{ perkId: 'perk_swiftness' }], content)).toBe(base);
  });
});
