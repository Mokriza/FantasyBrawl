/**
 * Stage 3 mechanics: the statuses and atoms the full ability pools needed. Each case
 * sets up the smallest board that shows the rule, with the dice frozen.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { blocksLos, blocksMovement, terrainAt } from '../../arena/terrain.js';
import type { Hex } from '../../hex.js';
import { at, scenario } from '../../testing/scenario.js';
import type { ScenarioHero } from '../../testing/scenario.js';
import { applyAction, startBattle } from '../apply.js';
import { abilityLegality, abilityRange } from '../legal.js';
import { statsInBattle } from '../modifiers.js';
import { heroById, updateHero } from '../query.js';
import { addStatus, statusesOf } from '../statuses.js';
import { checkOutcome } from '../victory.js';
import { abilityId, heroId, statusId } from '../../types.js';
import type { BattleEvent, BattleState } from '../../types.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

const FROZEN = { deterministic: true } as const;

function board(caster: Partial<ScenarioHero>, others: Record<string, ScenarioHero>): BattleState {
  let s = scenario(content).seed(5).hero('c', { cls: 'warrior', side: 'A', at: [3, 3], ...caster });
  for (const [id, spec] of Object.entries(others)) s = s.hero(id, spec);
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

function endTurn(state: BattleState) {
  const active = state.activeHeroId;
  if (active === null) throw new Error('nobody is acting');
  return applyAction(state, { type: 'endTurn', heroId: active }, content, FROZEN);
}

function withStatus(state: BattleState, id: string, status: string, turns: number, value = 0, source?: string) {
  return updateHero(state, heroId(id), (h) =>
    addStatus(h, content, statusId(status), turns, value, 3, false, source === undefined ? undefined : heroId(source)).hero,
  );
}

function dealt(events: readonly BattleEvent[], target: string): number {
  return events.reduce((sum, e) => sum + (e.type === 'damaged' && e.targetId === target ? e.amount : 0), 0);
}

const foe = (at: [number, number], extra: Partial<ScenarioHero> = {}): ScenarioHero => ({
  cls: 'warrior',
  side: 'B',
  at,
  maxHp: 500,
  ...extra,
});

describe('statuses of stage 3', () => {
  it('Немота: only the basic attack is left', () => {
    const state = withStatus(board({ abilities: ['warrior_cleave'] }, { e: foe([3, 2]) }), 'c', 'silence', 2);
    const hero = heroById(state, heroId('c'));
    const cleave = content.abilities.warrior_cleave;
    const basic = content.abilities.basic_melee_physical;
    if (cleave === undefined || basic === undefined) throw new Error('content');
    expect(abilityLegality(state, hero, cleave, at(3, 2), content)).toEqual({ ok: false, reason: 'silenced' });
    expect(abilityLegality(state, hero, basic, at(3, 2), content).ok).toBe(true);
  });

  it('Невидимость: no single-target ability can pick the hero; an area still hits it', () => {
    const state = withStatus(
      board({ cls: 'mage', abilities: ['mage_frost_bolt', 'mage_fireball'] }, { e: foe([5, 3]) }),
      'e',
      'stealth',
      2,
    );
    const mage = heroById(state, heroId('c'));
    const bolt = content.abilities.mage_frost_bolt;
    const fireball = content.abilities.mage_fireball;
    if (bolt === undefined || fireball === undefined) throw new Error('content');
    expect(abilityLegality(state, mage, bolt, at(5, 3), content).ok).toBe(false);
    expect(abilityLegality(state, mage, fireball, at(5, 3), content).ok).toBe(true);
  });

  it('Неуязвимость: every hit does nothing', () => {
    const state = withStatus(board({}, { e: foe([3, 2]) }), 'e', 'invulnerable', 1);
    const { events, state: after } = cast(state, 'basic_melee_physical', at(3, 2));
    expect(dealt(events, 'e')).toBe(0);
    expect(heroById(after, heroId('e')).hp).toBe(500);
  });

  it('Метка охотника: 30% more damage taken', () => {
    const plain = board({}, { e: foe([3, 2]) });
    const marked = withStatus(plain, 'e', 'mark', 4, 0.3);
    const a = dealt(cast(plain, 'basic_melee_physical', at(3, 2)).events, 'e');
    const b = dealt(cast(marked, 'basic_melee_physical', at(3, 2)).events, 'e');
    expect(b).toBe(Math.round(a * 1.3));
  });

  it('Оберег: the killing blow leaves 1 health, once', () => {
    const state = withStatus(board({}, { e: foe([3, 2], { hp: 5 }) }), 'e', 'deathWard', 3);
    const first = cast(state, 'basic_melee_physical', at(3, 2));
    expect(heroById(first.state, heroId('e')).hp).toBe(1);
    expect(statusesOf(heroById(first.state, heroId('e')), statusId('deathWard'))).toHaveLength(0);
    const second = cast({ ...first.state, activeHeroId: heroId('c'), apLeft: 4 }, 'basic_melee_physical', at(3, 2));
    expect(heroById(second.state, heroId('e')).hp).toBe(0);
  });

  it('Неудержимость: control does not land, and every turn starts with one more AP', () => {
    let state = board({ abilities: ['warrior_unstoppable'], speed: 10 }, { e: foe([8, 8], { speed: 1 }) });
    state = cast(state, 'warrior_unstoppable', at(3, 3)).state;
    const stunned = addStatus(heroById(state, heroId('c')), content, statusId('stun'), 1, 0, 1, false);
    expect(stunned.events[0]?.type).toBe('statusResisted');
    // The warrior's next turn: 4 + 1.
    const next = endTurn({ ...state, activeHeroId: heroId('c') });
    const started = next.events.find((e) => e.type === 'turnStarted' && e.heroId === 'c');
    expect(started?.type === 'turnStarted' ? started.ap : 0).toBe(5);
  });

  it('Соколиный глаз: +2 range and no line of sight needed', () => {
    // The target stands at the shot's own range, behind a rock.
    let state = board({ cls: 'hunter', abilities: ['hunter_aimed_shot', 'hunter_eagle_eye'] }, { e: foe([6, 3]) });
    state = { ...state, arena: { ...state.arena, terrain: { ...state.arena.terrain, ...rockAt(5, 3) } } };
    const shot = content.abilities.hunter_aimed_shot;
    if (shot === undefined) throw new Error('content');
    const before = heroById(state, heroId('c'));
    expect(abilityLegality(state, before, shot, at(6, 3), content)).toEqual({ ok: false, reason: 'no_los' });
    state = cast(state, 'hunter_eagle_eye', at(3, 3)).state;
    const after = heroById(state, heroId('c'));
    expect(abilityRange(state, after, shot, content)).toBe(shot.range + 2);
    expect(abilityLegality(state, after, shot, at(6, 3), content).ok).toBe(true);
  });

  it('Пакт крови: +60% Magic, and 8% of maximum health gone at every turn start', () => {
    let state = board({ cls: 'warlock', magic: 20, maxHp: 100, speed: 10, abilities: ['warlock_blood_pact'] }, {
      e: foe([8, 8], { speed: 1 }),
    });
    state = cast(state, 'warlock_blood_pact', at(3, 3)).state;
    expect(statsInBattle(state, heroById(state, heroId('c')), content).magic).toBe(32);
    const next = endTurn({ ...state, activeHeroId: heroId('c') });
    expect(heroById(next.state, heroId('c')).hp).toBe(92);
  });

  it('Уязвимость: Armor and Resist down by the share', () => {
    const state = withStatus(board({}, { e: foe([3, 2], { armor: 40, resist: 20 }) }), 'e', 'vulnerable', 3, 0.3);
    const stats = statsInBattle(state, heroById(state, heroId('e')), content);
    expect(stats.armor).toBeCloseTo(28);
    expect(stats.resist).toBeCloseTo(14);
  });
});

function rockAt(col: number, row: number) {
  const hex = at(col, row);
  return { [`${hex.q},${hex.r}`]: 'rock' as const };
}

describe('atoms of stage 3', () => {
  it('ap: a hit that costs the target a point on its next turn', () => {
    let state = board({ abilities: ['warrior_stunning_blow'], speed: 1 }, { e: foe([3, 2], { speed: 18, atb: 99 }) });
    state = cast(state, 'warrior_stunning_blow', at(3, 2)).state;
    // The warrior still has 1 AP but nothing to spend it on, so the turn may have ended.
    const next = state.activeHeroId === 'c' ? endTurn(state) : { state, events: [] as BattleEvent[] };
    const all = [...next.events];
    const started = all.find((e) => e.type === 'turnStarted' && e.heroId === 'e');
    const ap = started?.type === 'turnStarted' ? started.ap : state.activeHeroId === 'e' ? state.apLeft : -1;
    expect(ap).toBe(3);
  });

  it('cooldown: Разрыв маны clears an ally and doubles an enemy', () => {
    let state = board({ cls: 'mage', abilities: ['mage_mana_rift'] }, {
      a: { cls: 'warrior', side: 'A', at: [3, 4] },
      e: foe([5, 3]),
    });
    state = updateHero(state, heroId('a'), (h) => ({ ...h, cooldowns: { warrior_cleave: 2 } }));
    state = updateHero(state, heroId('e'), (h) => ({ ...h, cooldowns: { warrior_cleave: 2 } }));
    const onAlly = cast(state, 'mage_mana_rift', at(3, 4)).state;
    expect(heroById(onAlly, heroId('a')).cooldowns).toEqual({});
    const onEnemy = cast(state, 'mage_mana_rift', at(5, 3)).state;
    expect(heroById(onEnemy, heroId('e')).cooldowns.warrior_cleave).toBe(4);
  });

  it('Разрыв души: a kill resets its cooldown and gives 2 AP', () => {
    // A second enemy keeps the battle going after the kill.
    const state = board({ cls: 'warlock', magic: 30, abilities: ['warlock_soul_rend'] }, {
      e: foe([5, 3], { hp: 5 }),
      far: foe([8, 8]),
    });
    const { state: after } = cast(state, 'warlock_soul_rend', at(5, 3));
    expect(heroById(after, heroId('c')).cooldowns.warlock_soul_rend).toBeUndefined();
    expect(after.apLeft).toBe(2);
  });

  it('teleport: Телепорт goes straight through an ice wall', () => {
    let state = board({ cls: 'mage', abilities: ['mage_blink'] }, { e: foe([8, 8]) });
    const ice = (col: number, row: number) => ({ [`${at(col, row).q},${at(col, row).r}`]: 'ice' as const });
    state = { ...state, arena: { ...state.arena, terrain: { ...ice(4, 2), ...ice(4, 3), ...ice(4, 4) } } };
    const { state: after, events } = cast(state, 'mage_blink', at(5, 3));
    expect(heroById(after, heroId('c')).hex).toEqual(at(5, 3));
    expect(events.some((e) => e.type === 'teleported')).toBe(true);
  });

  it('terrain: Стена льда blocks the way, not the view, and melts after 3 of the mage\'s turns', () => {
    let state = board({ cls: 'mage', abilities: ['mage_ice_wall'], speed: 10 }, { e: foe([8, 8], { speed: 1 }) });
    state = cast(state, 'mage_ice_wall', at(5, 3)).state;
    const ice = at(5, 3);
    expect(terrainAt(state.arena, ice)).toBe('ice');
    expect(blocksMovement(state.arena, ice)).toBe(true);
    expect(blocksLos(state.arena, ice)).toBe(false);
    for (let i = 0; i < 3; i++) {
      state = endTurn({ ...state, activeHeroId: heroId('c'), apLeft: 4 }).state;
    }
    expect(terrainAt(state.arena, ice)).toBeNull();
    expect(state.temporaryTerrain).toHaveLength(0);
  });

  it('Капкан: the enemy who walks in is hurt, rooted, stopped, and the trap is gone', () => {
    let state = board({ cls: 'hunter', attack: 20, abilities: ['hunter_trap'] }, { e: foe([6, 3]) });
    state = cast(state, 'hunter_trap', at(5, 3)).state;
    expect(terrainAt(state.arena, at(5, 3))).toBe('trap');
    const walker = { ...state, activeHeroId: heroId('e'), apLeft: 4 };
    const { state: after, events } = applyAction(
      walker,
      { type: 'move', heroId: heroId('e'), path: [at(5, 3), at(4, 3)] },
      content,
      FROZEN,
    );
    expect(heroById(after, heroId('e')).hex).toEqual(at(5, 3));
    expect(dealt(events, 'e')).toBe(16);
    expect(statusesOf(heroById(after, heroId('e')), statusId('root'))).toHaveLength(1);
    expect(terrainAt(after.arena, at(5, 3))).toBeNull();
  });

  it('summon: the imp stands, strikes at its owner\'s turn start, takes no turn, and leaves', () => {
    let state = board({ cls: 'warlock', magic: 20, abilities: ['warlock_imp'], speed: 10 }, {
      e: foe([5, 3], { speed: 1 }),
    });
    state = cast(state, 'warlock_imp', at(4, 3)).state;
    const imp = Object.values(state.heroes).find((h) => h.summon !== null);
    if (imp === undefined) throw new Error('no imp');
    expect(imp.hex).toEqual(at(4, 3));
    expect(imp.hp).toBe(40);

    // Only heroes are on the bar; the imp never acts.
    const next = endTurn({ ...state, activeHeroId: heroId('c') });
    expect(next.state.activeHeroId).not.toBe(imp.id);
    const strike = next.events.find((e) => e.type === 'damaged' && e.sourceId === imp.id);
    expect(strike?.type === 'damaged' ? strike.amount : 0).toBe(16);

    // A summon does not keep a side alive.
    const lonely = updateHero(state, heroId('c'), (h) => ({ ...h, hp: 0 }));
    expect(checkOutcome(lonely, content)?.winner).toBe('B');

    let later = state;
    for (let i = 0; i < 4; i++) later = endTurn({ ...later, activeHeroId: heroId('c'), apLeft: 4 }).state;
    expect(heroById(later, imp.id).hp).toBe(0);
  });

  it('spread: Чума copies every Порча stack to enemies within 2 of the target', () => {
    let state = board({ cls: 'warlock', abilities: ['warlock_plague'] }, {
      t: foe([5, 3]),
      near: foe([6, 3]),
      far: foe([8, 8]),
    });
    state = withStatus(state, 't', 'dot', 4, 10, 'c');
    state = withStatus(state, 't', 'dot', 3, 10, 'c');
    const after = cast(state, 'warlock_plague', at(5, 3)).state;
    expect(statusesOf(heroById(after, heroId('near')), statusId('dot'))).toHaveLength(2);
    expect(statusesOf(heroById(after, heroId('far')), statusId('dot'))).toHaveLength(0);
    expect(statusesOf(heroById(after, heroId('near')), statusId('dot'))[0]?.sourceId).toBe('c');
  });

  it('selfDamage: Жертва costs a fifth of the current health', () => {
    const state = board({ cls: 'warlock', hp: 100, maxHp: 200, abilities: ['warlock_sacrifice'] }, { e: foe([5, 3]) });
    expect(heroById(cast(state, 'warlock_sacrifice', at(5, 3)).state, heroId('c')).hp).toBe(80);
  });

  it('delay: Метеор lands at the start of the mage\'s next turn, not before', () => {
    let state = board({ cls: 'mage', magic: 20, abilities: ['mage_meteor'], speed: 10 }, { e: foe([5, 3], { speed: 1 }) });
    // Enough AP that the cast does not end the turn and roll straight into the next one.
    const cast1 = cast({ ...state, apLeft: 8 }, 'mage_meteor', at(5, 3));
    expect(dealt(cast1.events, 'e')).toBe(0);
    expect(cast1.state.pending).toHaveLength(1);
    state = cast1.state;
    const next = endTurn({ ...state, activeHeroId: heroId('c') });
    expect(dealt(next.events, 'e')).toBe(40);
    expect(next.state.pending).toHaveLength(0);
  });

  it('perHexBonus: Смертельный выстрел hits harder the further the target', () => {
    const at2 = board({ cls: 'hunter', attack: 20, abilities: ['hunter_deadly_shot'] }, { e: foe([5, 3]) });
    const at4 = board({ cls: 'hunter', attack: 20, abilities: ['hunter_deadly_shot'] }, { e: foe([7, 3]) });
    const shot = content.abilities.hunter_deadly_shot?.effects[0];
    if (shot?.type !== 'damage') throw new Error('content');
    const per = shot.perHexBonus ?? 0;
    expect(dealt(cast(at2, 'hunter_deadly_shot', at(5, 3)).events, 'e')).toBe(Math.round(20 * shot.k * (1 + 2 * per)));
    expect(dealt(cast(at4, 'hunter_deadly_shot', at(7, 3)).events, 'e')).toBe(Math.round(20 * shot.k * (1 + 4 * per)));
  });

  it('targetIsAlly: Кара небес burns enemies and heals allies in the same zone', () => {
    const state = board({ cls: 'priest', magic: 20, abilities: ['priest_holy_smite'] }, {
      e: foe([5, 3]),
      a: { cls: 'warrior', side: 'A', at: [4, 3], hp: 50, maxHp: 200 },
    });
    const { events } = cast(state, 'priest_holy_smite', at(5, 3));
    expect(dealt(events, 'e')).toBe(40);
    expect(dealt(events, 'a')).toBe(0);
    expect(events.some((e) => e.type === 'healed' && e.targetId === 'a')).toBe(true);
  });

  it('the battle still starts and plays with a summon on the field', () => {
    const state = board({ cls: 'warlock', abilities: ['warlock_imp'] }, { e: foe([8, 8]) });
    expect(() => startBattle(state, content)).not.toThrow();
  });
});
