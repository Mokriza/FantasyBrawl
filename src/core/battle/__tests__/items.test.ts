/**
 * Artifacts in battle. An artifact is a trait like a passive, so most of them are
 * ordinary modifiers and triggers; these cases pin the ones that needed a mechanic of
 * their own, plus a couple of plain ones to show the slot works at all. Dice frozen.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import type { Hex } from '../../hex.js';
import { at, scenario } from '../../testing/scenario.js';
import type { ScenarioHero } from '../../testing/scenario.js';
import { applyAction, startBattle } from '../apply.js';
import { critMultiplier, statsInBattle } from '../modifiers.js';
import { reachableFor } from '../legal.js';
import { heroById, updateHero } from '../query.js';
import { addStatus, barrierAmount, statusesOf } from '../statuses.js';
import { abilityId, heroId, statusId } from '../../types.js';
import type { BattleEvent, BattleState } from '../../types.js';
import { hexKey } from '../../hex.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

const FROZEN = { deterministic: true } as const;

function board(hero: Partial<ScenarioHero>, others: Record<string, ScenarioHero>, ap = 8): BattleState {
  let s = scenario(content).seed(5).hero('h', { cls: 'warrior', side: 'A', at: [3, 3], attack: 20, magic: 20, ...hero });
  for (const [id, spec] of Object.entries(others)) s = s.hero(id, spec);
  return s.active('h', { ap }).build();
}

function act(state: BattleState, ability: string, target: Hex, hero = 'h') {
  return applyAction(state, { type: 'ability', heroId: heroId(hero), abilityId: abilityId(ability), target }, content, FROZEN);
}

function dealt(events: readonly BattleEvent[], target: string): number {
  return events.reduce((sum, e) => sum + (e.type === 'damaged' && e.targetId === target ? e.amount : 0), 0);
}

const foe = (where: [number, number], extra: Partial<ScenarioHero> = {}): ScenarioHero => ({
  cls: 'warrior',
  side: 'B',
  at: where,
  maxHp: 500,
  armor: 0,
  resist: 0,
  ...extra,
});

describe('plain artifacts', () => {
  it('Кольчуга: +10 Armor, in the stats everyone sees', () => {
    const state = board({ armor: 5, item: 'item_chainmail' }, { far: foe([8, 8]) });
    expect(statsInBattle(state, heroById(state, heroId('h')), content).armor).toBe(15);
  });

  it('Корона тирана: one more AP every turn', () => {
    let state = board({ item: 'item_tyrant_crown', speed: 10 }, { e: foe([8, 8], { speed: 1 }) });
    state = applyAction({ ...state, apLeft: 1 }, { type: 'endTurn', heroId: heroId('h') }, content, FROZEN).state;
    expect(state.activeHeroId).toBe('h');
    expect(state.apLeft).toBe(content.config.battle.apPerTurn + 1);
  });

  it('Молот титана: a crit hits ×2.5', () => {
    const state = board({ item: 'item_titan_hammer' }, { e: foe([3, 2]) });
    const target = heroById(state, heroId('e'));
    expect(critMultiplier(state, heroById(state, heroId('h')), target, content)).toBeCloseTo(2.5);
  });

  it('Знамя войны: allies +10% Attack while the bearer lives', () => {
    const state = board({ item: 'item_war_banner', cls: 'priest' }, { ally: { cls: 'warrior', side: 'A', at: [2, 3], attack: 20 }, far: foe([8, 8]) });
    expect(statsInBattle(state, heroById(state, heroId('ally')), content).attack).toBeCloseTo(22);
    const fallen = updateHero(state, heroId('h'), (h) => ({ ...h, hp: 0 }));
    expect(statsInBattle(fallen, heroById(fallen, heroId('ally')), content).attack).toBe(20);
  });
});

describe('artifacts with a mechanic of their own', () => {
  it('Гримуар бездны: +10% only on abilities of tier III and IV', () => {
    const low = (item?: string) =>
      dealt(act(board({ cls: 'mage', magic: 20, abilities: ['mage_frost_bolt'], ...(item ? { item } : {}) }, { e: foe([5, 3]) }), 'mage_frost_bolt', at(5, 3)).events, 'e');
    const high = (item?: string) =>
      dealt(act(board({ cls: 'mage', magic: 20, abilities: ['mage_chain_lightning'], ...(item ? { item } : {}) }, { e: foe([5, 3]) }), 'mage_chain_lightning', at(5, 3)).events, 'e');
    // The flat +5 Magic lifts both; only the tier III ability gets the extra 10%.
    const lowGain = low('item_abyss_grimoire') / low();
    const highGain = high('item_abyss_grimoire') / high();
    expect(highGain).toBeGreaterThan(lowGain * 1.05);
  });

  it('Броня стража: the first stun of the match does not land, the second does', () => {
    let state = board({ item: 'item_guardian_armor' }, { e: foe([8, 8]) });
    state = startBattle(state, content).state;
    const hero = heroById(state, heroId('h'));
    const first = addStatus(hero, content, statusId('stun'), 1, 0, 1, false);
    expect(first.events[0]?.type).toBe('statusResisted');
    expect(statusesOf(first.hero, statusId('stun'))).toHaveLength(0);
    const second = addStatus(first.hero, content, statusId('stun'), 1, 0, 1, false);
    expect(statusesOf(second.hero, statusId('stun'))).toHaveLength(1);
  });

  it('Плащ теней: the first move of a turn draws no swing, the next one does', () => {
    const state = board({ item: 'item_shadow_cloak', cls: 'rogue' }, { e: foe([3, 2]) });
    const away = reachableFor(state, heroById(state, heroId('h')), content).get(hexKey(at(3, 4)));
    expect(away?.provokes).toEqual([]);
    const moved = applyAction(state, { type: 'move', heroId: heroId('h'), path: [at(3, 4)] }, content, FROZEN);
    expect(moved.events.some((e) => e.type === 'opportunityAttack')).toBe(false);

    // Back next to the enemy and away again in the same turn: now it costs a swing.
    let again = applyAction(moved.state, { type: 'move', heroId: heroId('h'), path: [at(3, 3)] }, content, FROZEN).state;
    const leave = reachableFor(again, heroById(again, heroId('h')), content).get(hexKey(at(3, 4)));
    expect(leave?.provokes).toEqual(['e']);
    again = applyAction(again, { type: 'move', heroId: heroId('h'), path: [at(3, 4)] }, content, FROZEN).state;
    expect(heroById(again, heroId('h')).hp).toBeLessThan(heroById(moved.state, heroId('h')).hp);
  });

  it('Кубок целителя: healing gives the target a barrier of a fifth of what it healed', () => {
    const state = board({ cls: 'priest', magic: 20, item: 'item_healer_cup', abilities: ['priest_heal'] }, {
      a: { cls: 'warrior', side: 'A', at: [3, 4], hp: 20, maxHp: 300 },
      far: foe([8, 8]),
    });
    const { state: after, events } = act(state, 'priest_heal', at(3, 4));
    const healed = events.find((e) => e.type === 'healed' && e.targetId === 'a');
    const amount = healed?.type === 'healed' ? healed.amount : 0;
    expect(amount).toBeGreaterThan(0);
    expect(barrierAmount(heroById(after, heroId('a')))).toBe(Math.round(amount * 0.2));
  });

  it('Пояс силача: a push does not move the bearer', () => {
    const state = board({ cls: 'monk', abilities: ['monk_shove'] }, { e: foe([3, 2], { item: 'item_strongman_belt' }) });
    const { state: after } = act(state, 'monk_shove', at(3, 2));
    expect(heroById(after, heroId('e')).hex).toEqual(at(3, 2));
  });

  it('Шипастый нагрудник: 15% of a physical hit goes back, a magic one does not', () => {
    const phys = board({}, { e: foe([3, 2], { item: 'item_spiked_breastplate', armor: 0 }) });
    const hit = act(phys, 'basic_melee_physical', at(3, 2));
    const taken = dealt(hit.events, 'e');
    expect(dealt(hit.events, 'h')).toBeGreaterThan(0);
    expect(dealt(hit.events, 'h')).toBeLessThanOrEqual(Math.round(taken * 0.15));

    const magic = board({ cls: 'mage', abilities: ['mage_frost_bolt'] }, { e: foe([5, 3], { item: 'item_spiked_breastplate' }) });
    expect(dealt(act(magic, 'mage_frost_bolt', at(5, 3)).events, 'h')).toBe(0);
  });

  it('Кольцо концентрации: a kill takes one turn off every running cooldown', () => {
    let state = board({ item: 'item_focus_ring', attack: 60 }, { e: foe([3, 2], { hp: 5 }), far: foe([8, 8]) });
    state = updateHero(state, heroId('h'), (h) => ({ ...h, cooldowns: { warrior_cleave: 3, warrior_unstoppable: -1 } }));
    const after = act(state, 'basic_melee_physical', at(3, 2)).state;
    expect(heroById(after, heroId('h')).cooldowns).toEqual({ warrior_cleave: 2, warrior_unstoppable: -1 });
  });

  it('Сердце феникса: the killing blow leaves 40% health, once', () => {
    let state = board({ attack: 100 }, { e: foe([3, 2], { hp: 10, maxHp: 200, item: 'item_phoenix_heart' }) });
    state = startBattle({ ...state, activeHeroId: null }, content).state;
    state = { ...state, activeHeroId: heroId('h'), apLeft: 8 };
    const first = act(state, 'basic_melee_physical', at(3, 2)).state;
    expect(heroById(first, heroId('e')).hp).toBe(80);
    const second = act({ ...first, activeHeroId: heroId('h'), apLeft: 8 }, 'basic_melee_physical', at(3, 2)).state;
    expect(heroById(second, heroId('e')).hp).toBeLessThan(80);
  });

  it('Песочные часы: once a match, the bearer acts again right after its turn', () => {
    let state = board({ item: 'item_hourglass', speed: 10 }, { e: foe([8, 8], { speed: 18 }) });
    state = startBattle({ ...state, activeHeroId: null }, content).state;
    // Whoever went first, play until the bearer has ended one turn.
    for (let i = 0; i < 10 && state.lastActedHeroId !== 'h'; i++) {
      const active = state.activeHeroId;
      if (active === null) break;
      state = applyAction(state, { type: 'endTurn', heroId: active }, content, FROZEN).state;
    }
    expect(state.lastActedHeroId).toBe('h');
    expect(state.activeHeroId).toBe('h');
    // The second time round, no extra turn.
    state = applyAction(state, { type: 'endTurn', heroId: heroId('h') }, content, FROZEN).state;
    expect(state.activeHeroId).toBe('e');
  });

  it('Печать двойника: the first ability of the match goes off twice, the second once', () => {
    const state = board({ item: 'item_twin_seal', abilities: ['warrior_cleave'] }, { e: foe([3, 2]) });
    const first = act(state, 'warrior_cleave', at(3, 2));
    expect(first.events.filter((e) => e.type === 'damaged' && e.targetId === 'e')).toHaveLength(2);
    const cleared = updateHero({ ...first.state, activeHeroId: heroId('h'), apLeft: 8 }, heroId('h'), (h) => ({ ...h, cooldowns: {} }));
    const second = act(cleared, 'warrior_cleave', at(3, 2));
    expect(second.events.filter((e) => e.type === 'damaged' && e.targetId === 'e')).toHaveLength(1);
  });

  it('Клинок пустоты: 40% of the target Armor is ignored', () => {
    const plain = board({}, { e: foe([3, 2], { armor: 100 }) });
    const voided = board({ item: 'item_void_blade' }, { e: foe([3, 2], { armor: 100 }) });
    const c = content.config.formulas.defenseConstant;
    const k = content.abilities.basic_melee_physical?.effects[0];
    const base = 20 * (k?.type === 'damage' ? k.k : 1);
    expect(dealt(act(plain, 'basic_melee_physical', at(3, 2)).events, 'e')).toBe(Math.round(base * (1 - 100 / (100 + c))));
    expect(dealt(act(voided, 'basic_melee_physical', at(3, 2)).events, 'e')).toBe(Math.round(base * (1 - 60 / (60 + c))));
  });

  it('Мантия архимага: an aura reaches one hex further and a 3-hex zone becomes 7', () => {
    const aura = (item?: string) =>
      act(board({ abilities: ['warrior_whirlwind'], ...(item ? { item } : {}) }, { near: foe([3, 2]), two: foe([3, 1]) }), 'warrior_whirlwind', at(3, 3)).events;
    expect(dealt(aura(), 'two')).toBe(0);
    expect(dealt(aura('item_archmage_mantle'), 'two')).toBeGreaterThan(0);

    const ball = (item?: string) => {
      const state = board({ cls: 'mage', abilities: ['mage_fireball'], ...(item ? { item } : {}) }, {
        a: foe([6, 3]), b: foe([6, 4]), c: foe([7, 3]),
      });
      return ['a', 'b', 'c'].filter((id) => dealt(act(state, 'mage_fireball', at(6, 3)).events, id) > 0).length;
    };
    expect(ball('item_archmage_mantle')).toBeGreaterThan(ball());
  });

  it('Оковы судьбы: an enemy starting its turn next to the bearer loses 5 initiative', () => {
    let state = board({ item: 'item_fate_shackles', speed: 1 }, { e: foe([3, 2], { speed: 10, atb: 95 }) });
    state = { ...state, activeHeroId: null, apLeft: 0 };
    const events = startBattle(state, content).events;
    const shackled = events.find((e) => e.type === 'atbChanged' && e.heroId === 'e');
    expect(shackled?.type === 'atbChanged' ? shackled.delta : 0).toBe(-5);
  });

  it('Талисман жизни: 12% of maximum health back at the start of each turn', () => {
    let state = board({ item: 'item_life_talisman', speed: 10, hp: 50, maxHp: 200 }, { e: foe([8, 8], { speed: 1 }) });
    state = applyAction({ ...state, apLeft: 1 }, { type: 'endTurn', heroId: heroId('h') }, content, FROZEN).state;
    expect(state.activeHeroId).toBe('h');
    expect(heroById(state, heroId('h')).hp).toBe(74);
  });
});
