import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/load.js';
import type { ContentRegistry } from '../../content.js';
import { getClass } from '../../content.js';
import { applyPick, availableHeroes, createDraft, draftTurn, legalPicks } from '../../draft/draft.js';
import { generatePool } from '../../draft/generate.js';
import { hexKey } from '../../hex.js';
import { createRng } from '../../rng.js';
import type { HeroTemplate, RunState, Side } from '../../types.js';
import { IllegalActionError, heroId } from '../../types.js';
import { statsAtLevel } from '../levels.js';
import { legalPlacementHexes, placementTurn, startZone } from '../placement.js';
import { applyRunAction, createRun, createRunBattle, heroLevel, runWinner } from '../run.js';
import { awaitingPerk, awaitingUnlock, perkTargets } from '../upgrade.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

function pool(): HeroTemplate[] {
  return generatePool(content, createRng(5))[0];
}

/** Drafts by always taking the first hero left, whoever's turn it is. */
function draftAll(run: RunState): RunState {
  let current = run;
  while (current.phase === 'draft') {
    const side = draftTurn(current.draft);
    const first = availableHeroes(current.draft)[0];
    if (side === null || first === undefined) throw new Error('stuck draft');
    current = applyRunAction(current, { type: 'pick', side, heroId: first.id }, content);
  }
  return current;
}

/** Places heroes in order on the first free hexes of each side's zone. */
function placeAll(run: RunState): RunState {
  let current = run;
  while (current.phase === 'placement' && current.placement !== null) {
    const side = placementTurn(current.placement);
    if (side === null) throw new Error('stuck placement');
    const hero = current.draft.picks[side].find(
      (id) => !current.placement?.placed.some((p) => p.heroId === id),
    );
    const hex = legalPlacementHexes(current.placement, side, content.config)[0];
    if (hero === undefined || hex === undefined) throw new Error('nothing to place');
    current = applyRunAction(current, { type: 'place', side, heroId: hero, hex }, content);
  }
  return current;
}

/**
 * Every hero takes the first perk on offer (on its first possible ability) and the
 * first unlock on offer, then on.
 */
function upgradeAll(run: RunState): RunState {
  let current = run;
  for (const side of ['A', 'B'] as const) {
    for (const id of current.upgrade === null ? [] : awaitingUnlock(current.upgrade, current.draft, side)) {
      const optionId = current.upgrade?.unlocks[id]?.options[0];
      if (optionId === undefined) throw new Error('no unlock');
      current = applyRunAction(current, { type: 'chooseUnlock', side, heroId: id, optionId }, content);
    }
    for (const id of current.upgrade === null ? [] : awaitingPerk(current.upgrade, current.draft, side)) {
      const perkId = current.upgrade?.offers[id]?.[0];
      const perk = perkId === undefined ? undefined : content.perks[perkId];
      if (perk === undefined || perkId === undefined) throw new Error('no offer');
      const hero = current.draft.pool.find((h) => h.id === id);
      if (hero === undefined) throw new Error('no hero');
      const target = perk.abilityMod === undefined ? undefined : perkTargets(hero, perk, content)[0];
      current = applyRunAction(
        current,
        target === undefined
          ? { type: 'choosePerk', side, heroId: id, perkId }
          : { type: 'choosePerk', side, heroId: id, perkId, abilityId: target },
        content,
      );
    }
  }
  return applyRunAction(current, { type: 'endUpgrade' }, content);
}

function win(run: RunState, winner: Side): RunState {
  return applyRunAction(
    run,
    { type: 'matchEnded', outcome: { winner, reason: 'elimination' }, rounds: 7 },
    content,
  );
}

describe('the snake draft', () => {
  it('follows A B B A A B and then stops', () => {
    let draft = createDraft(pool(), content);
    const seen: (Side | null)[] = [];
    for (let i = 0; i < 6; i++) {
      const side = draftTurn(draft);
      seen.push(side);
      const first = availableHeroes(draft)[0];
      if (side === null || first === undefined) break;
      draft = applyPick(draft, side, first.id);
    }
    expect(seen).toEqual(['A', 'B', 'B', 'A', 'A', 'B']);
    expect(draftTurn(draft)).toBeNull();
    expect(availableHeroes(draft)).toHaveLength(4);
  });

  it('a taken hero leaves the pool for both sides', () => {
    const draft = applyPick(createDraft(pool(), content), 'A', heroId('h03'));
    expect(legalPicks(draft, 'B')).not.toContain('h03');
    expect(() => applyPick(draft, 'B', heroId('h03'))).toThrow(IllegalActionError);
  });

  it('refuses a pick out of turn', () => {
    const draft = createDraft(pool(), content);
    expect(legalPicks(draft, 'B')).toEqual([]);
    expect(() => applyPick(draft, 'B', heroId('h01'))).toThrow(IllegalActionError);
  });

  it('the timer pick takes a hero still in the pool, from the run stream', () => {
    const run = createRun({ seed: 11, content });
    const after = applyRunAction(run, { type: 'autoPick', side: 'A' }, content);
    expect(after.draft.picks.A).toHaveLength(1);
    expect(after.rng).not.toEqual(run.rng);
    // Same run, same timer pick.
    expect(applyRunAction(run, { type: 'autoPick', side: 'A' }, content)).toEqual(after);
  });
});

describe('placement', () => {
  it('alternates A B A B A B and only allows free hexes of the own start zone', () => {
    const run = draftAll(createRun({ seed: 3, content }));
    expect(run.phase).toBe('placement');
    const placement = run.placement;
    if (placement === null) throw new Error('no placement');

    const zoneA = new Set(startZone(content.config, 'A').map(hexKey));
    for (const hex of legalPlacementHexes(placement, 'A', content.config)) {
      expect(zoneA.has(hexKey(hex))).toBe(true);
    }

    const wrongZone = startZone(content.config, 'B')[0];
    const heroA = run.draft.picks.A[0];
    if (wrongZone === undefined || heroA === undefined) throw new Error('setup');
    expect(() =>
      applyRunAction(run, { type: 'place', side: 'A', heroId: heroA, hex: wrongZone }, content),
    ).toThrow(IllegalActionError);

    const heroB = run.draft.picks.B[0];
    const hexB = legalPlacementHexes(placement, 'B', content.config)[0];
    if (heroB === undefined || hexB === undefined) throw new Error('setup');
    expect(() =>
      applyRunAction(run, { type: 'place', side: 'B', heroId: heroB, hex: hexB }, content),
    ).toThrow(IllegalActionError);
  });

  it('refuses a hex somebody already stands on and a hero of the other side', () => {
    const run = draftAll(createRun({ seed: 3, content }));
    const heroA = run.draft.picks.A[0];
    const hex = run.placement && legalPlacementHexes(run.placement, 'A', content.config)[0];
    if (heroA === undefined || !hex) throw new Error('setup');
    const once = applyRunAction(run, { type: 'place', side: 'A', heroId: heroA, hex }, content);

    const heroB = once.draft.picks.B[0];
    if (heroB === undefined) throw new Error('setup');
    expect(() =>
      applyRunAction(once, { type: 'place', side: 'B', heroId: heroB, hex }, content),
    ).toThrow(IllegalActionError);
    expect(() =>
      applyRunAction(once, { type: 'place', side: 'B', heroId: heroA, hex }, content),
    ).toThrow(IllegalActionError);
  });

  it('builds a battle with every drafted hero where they were placed', () => {
    const run = placeAll(draftAll(createRun({ seed: 3, content })));
    expect(run.phase).toBe('battle');
    const battle = createRunBattle(run, content);
    expect(Object.keys(battle.heroes)).toHaveLength(6);
    for (const spot of run.placement?.placed ?? []) {
      const hero = battle.heroes[spot.heroId];
      expect(hero?.side).toBe(spot.side);
      expect(hero && hexKey(hero.hex)).toBe(hexKey(spot.hex));
    }
    expect(battle.arena).toBe(run.placement?.arena);
  });
});

describe('the series', () => {
  it('ends at three wins, with a level gained after every match', () => {
    let run = placeAll(draftAll(createRun({ seed: 8, content })));
    const winners: Side[] = ['A', 'B', 'A', 'B', 'A'];
    for (const [i, winner] of winners.entries()) {
      expect(run.phase).toBe('battle');
      expect(heroLevel(run)).toBe(i + 1);
      run = win(run, winner);
      if (i < winners.length - 1) {
        expect(run.phase).toBe('matchOver');
        run = placeAll(upgradeAll(applyRunAction(run, { type: 'nextMatch' }, content)));
      }
    }
    expect(run.phase).toBe('finished');
    expect(run.wins).toEqual({ A: 3, B: 2 });
    expect(runWinner(run, content)).toBe('A');
    expect(run.history.map((m) => m.match)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a 3-0 sweep finishes after three matches', () => {
    let run = placeAll(draftAll(createRun({ seed: 9, content })));
    for (let i = 0; i < 3; i++) {
      run = win(run, 'B');
      if (run.phase === 'matchOver') {
        run = placeAll(upgradeAll(applyRunAction(run, { type: 'nextMatch' }, content)));
      }
    }
    expect(run.phase).toBe('finished');
    expect(runWinner(run, content)).toBe('B');
  });

  it('every match gets a new arena and a new battle seed', () => {
    const first = placeAll(draftAll(createRun({ seed: 21, content })));
    const second = placeAll(upgradeAll(applyRunAction(win(first, 'A'), { type: 'nextMatch' }, content)));
    expect(createRunBattle(second, content).seed).not.toBe(createRunBattle(first, content).seed);
    expect(second.placement?.arena).not.toEqual(first.placement?.arena);
  });

  it('refuses actions from the wrong phase', () => {
    const run = createRun({ seed: 1, content });
    expect(() => applyRunAction(run, { type: 'nextMatch' }, content)).toThrow(IllegalActionError);
    expect(() => win(run, 'A')).toThrow(IllegalActionError);
  });

  it('the same seed gives the same run', () => {
    expect(createRun({ seed: 77, content })).toEqual(createRun({ seed: 77, content }));
  });

  it('who picks first is rolled, so both sides come up', () => {
    const sides = new Set<Side>();
    for (let seed = 1; seed <= 20; seed++) sides.add(createRun({ seed, content }).playerSide);
    expect(sides).toEqual(new Set(['A', 'B']));
  });
});

describe('levels', () => {
  it('level 1 is the generated line', () => {
    const hero = pool()[0];
    if (hero === undefined) throw new Error('setup');
    expect(statsAtLevel(hero, 1, content)).toEqual(hero.stats);
  });

  it('grows Health, the primary and the secondaries by the class growth rates per level, compounding', () => {
    for (const hero of pool()) {
      const cls = getClass(content, hero.classId);
      const g = cls.statGrowth;
      const at3 = statsAtLevel(hero, 3, content);
      expect(at3.maxHp).toBe(Math.round(hero.stats.maxHp * (1 + g.hp) ** 2));
      const primary = cls.primaryStat;
      const round = (v: number) =>
        primary === 'critChance' ? Math.round(v * 100) / 100 : Math.round(v);
      expect(at3[primary]).toBe(round(hero.stats[primary] * (1 + g.primary) ** 2));
      for (const stat of cls.secondaryStats) {
        if (stat === 'maxHp') continue;
        const r = stat === 'critChance' ? Math.round(hero.stats[stat] * (1 + g.secondary) ** 2 * 100) / 100
          : Math.round(hero.stats[stat] * (1 + g.secondary) ** 2);
        expect(at3[stat]).toBe(r);
      }
    }
  });

  it('leaves the stats the class does not care about alone', () => {
    const hero = pool().find((h) => h.classId === 'warrior') ?? pool()[0];
    if (hero === undefined) throw new Error('setup');
    const cls = getClass(content, hero.classId);
    const at5 = statsAtLevel(hero, 5, content);
    for (const stat of ['magic', 'resist', 'speed', 'critChance'] as const) {
      if (stat === cls.primaryStat || cls.secondaryStats.includes(stat)) continue;
      expect(at5[stat]).toBe(hero.stats[stat]);
    }
  });
});

describe('the upgrade phase', () => {
  function afterFirstMatch(seed: number): RunState {
    const first = placeAll(draftAll(createRun({ seed, content })));
    return applyRunAction(win(first, 'A'), { type: 'nextMatch' }, content);
  }

  it('comes between matches and offers each hero three perks it may take', () => {
    const run = afterFirstMatch(4);
    expect(run.phase).toBe('upgrade');
    expect(heroLevel(run)).toBe(2);
    for (const side of ['A', 'B'] as const) {
      for (const id of run.draft.picks[side]) {
        const offers = run.upgrade?.offers[id] ?? [];
        expect(offers).toHaveLength(content.config.run.perkChoices);
        expect(new Set(offers).size).toBe(offers.length);
        const hero = run.draft.pool.find((h) => h.id === id);
        const role = hero === undefined ? null : getClass(content, hero.classId).role;
        for (const perkId of offers) {
          const perk = content.perks[perkId];
          if (perk?.roles !== undefined) expect(perk.roles).toContain(role);
          if (perk?.classes !== undefined) expect(perk.classes).toContain(hero?.classId);
        }
      }
    }
  });

  it('refuses a perk that was not offered, a hero of the other side, and moving on too early', () => {
    const run = afterFirstMatch(4);
    const id = run.draft.picks.A[0];
    if (id === undefined) throw new Error('setup');
    const offered = run.upgrade?.offers[id] ?? [];
    const notOffered = Object.keys(content.perks).find((p) => !offered.includes(p));
    if (notOffered === undefined) throw new Error('setup');
    expect(() =>
      applyRunAction(run, { type: 'choosePerk', side: 'A', heroId: id, perkId: notOffered }, content),
    ).toThrow(IllegalActionError);
    expect(() => applyRunAction(run, { type: 'endUpgrade' }, content)).toThrow(IllegalActionError);
    expect(() =>
      applyRunAction(run, { type: 'choosePerk', side: 'B', heroId: id, perkId: offered[0] ?? '' }, content),
    ).toThrow(IllegalActionError);
  });

  it('a perk or an unlock may be chosen again until the phase ends: the new choice replaces the old', () => {
    let run = afterFirstMatch(4);
    const id = run.draft.picks.A[0];
    if (id === undefined) throw new Error('setup');
    // Two plain perks, so neither asks for an ability.
    const plain = (run.upgrade?.offers[id] ?? []).filter((p) => content.perks[p]?.abilityMod === undefined);
    const options = run.upgrade?.unlocks[id]?.options ?? [];
    const [first, second] = plain;
    const [optionA, optionB] = options;
    if (first === undefined || second === undefined || optionA === undefined || optionB === undefined) {
      throw new Error('setup: needs two plain perks and two unlock options');
    }

    run = applyRunAction(run, { type: 'choosePerk', side: 'A', heroId: id, perkId: first }, content);
    run = applyRunAction(run, { type: 'choosePerk', side: 'A', heroId: id, perkId: second }, content);
    expect(run.upgrade?.chosen[id]).toEqual({ perkId: second });

    run = applyRunAction(run, { type: 'chooseUnlock', side: 'A', heroId: id, optionId: optionA }, content);
    run = applyRunAction(run, { type: 'chooseUnlock', side: 'A', heroId: id, optionId: optionB }, content);
    expect(run.upgrade?.unlocked[id]).toBe(optionB);

    // Only the last choice reaches the hero.
    run = placeAll(upgradeAll(run));
    const hero = run.draft.pool.find((h) => h.id === id);
    expect(hero?.perks.map((p) => p.perkId)).toEqual([second]);
    expect(hero?.passive).toBe(optionB);
  });

  it('an ability perk needs one of the abilities it can change', () => {
    let run = afterFirstMatch(4);
    // Offer the quick-hands perk directly, so the test does not hang on the dice.
    const id = run.draft.picks.A[0];
    if (id === undefined || run.upgrade === null) throw new Error('setup');
    run = { ...run, upgrade: { ...run.upgrade, offers: { ...run.upgrade.offers, [id]: ['perk_quick_hands'] } } };
    const hero = run.draft.pool.find((h) => h.id === id);
    const perk = content.perks.perk_quick_hands;
    if (hero === undefined || perk === undefined) throw new Error('setup');
    const targets = perkTargets(hero, perk, content);
    expect(() =>
      applyRunAction(run, { type: 'choosePerk', side: 'A', heroId: id, perkId: 'perk_quick_hands' }, content),
    ).toThrow(IllegalActionError);
    const target = targets[0];
    if (target === undefined) return;
    const picked = applyRunAction(
      run,
      { type: 'choosePerk', side: 'A', heroId: id, perkId: 'perk_quick_hands', abilityId: target },
      content,
    );
    expect(picked.upgrade?.chosen[id]).toEqual({ perkId: 'perk_quick_hands', abilityId: target });
  });

  it('writes the perks into the heroes and carries them into the next battle', () => {
    const run = placeAll(upgradeAll(afterFirstMatch(6)));
    expect(run.phase).toBe('battle');
    const battle = createRunBattle(run, content);
    for (const side of ['A', 'B'] as const) {
      for (const id of run.draft.picks[side]) {
        const hero = run.draft.pool.find((h) => h.id === id);
        expect(hero?.perks).toHaveLength(1);
        expect(battle.heroes[id]?.perks).toEqual(hero?.perks);
      }
    }
  });

  it('after the first match every hero chooses a passive of its class from two', () => {
    const run = afterFirstMatch(4);
    for (const side of ['A', 'B'] as const) {
      for (const id of run.draft.picks[side]) {
        const hero = run.draft.pool.find((h) => h.id === id);
        const unlock = run.upgrade?.unlocks[id];
        expect(unlock?.kind).toBe('passive');
        expect(unlock?.options).toHaveLength(content.config.run.unlockChoices);
        for (const option of unlock?.options ?? []) expect(content.passives[option]?.class).toBe(hero?.classId);
      }
    }
  });

  it('refuses an unlock that was not offered, and moving on before every unlock is chosen', () => {
    let run = afterFirstMatch(4);
    const id = run.draft.picks.A[0];
    if (id === undefined) throw new Error('setup');
    const offered = run.upgrade?.unlocks[id]?.options ?? [];
    const other = Object.keys(content.passives).find((p) => !offered.includes(p));
    if (other === undefined) throw new Error('setup');
    expect(() => applyRunAction(run, { type: 'chooseUnlock', side: 'A', heroId: id, optionId: other }, content)).toThrow(
      IllegalActionError,
    );
    // Every perk taken, but the unlocks still open: not yet.
    for (const side of ['A', 'B'] as const) {
      for (const hero of awaitingPerk(run.upgrade ?? { offers: {}, chosen: {}, unlocks: {}, unlocked: {} }, run.draft, side)) {
        const perkId = run.upgrade?.offers[hero]?.find((p) => content.perks[p]?.abilityMod === undefined);
        if (perkId !== undefined) run = applyRunAction(run, { type: 'choosePerk', side, heroId: hero, perkId }, content);
      }
    }
    expect(() => applyRunAction(run, { type: 'endUpgrade' }, content)).toThrow(IllegalActionError);
  });

  it('the chosen passive goes into the hero and into the next battle', () => {
    const run = placeAll(upgradeAll(afterFirstMatch(6)));
    const battle = createRunBattle(run, content);
    for (const side of ['A', 'B'] as const) {
      for (const id of run.draft.picks[side]) {
        const hero = run.draft.pool.find((h) => h.id === id);
        expect(hero?.passive).not.toBeNull();
        expect(battle.heroes[id]?.passive).toBe(hero?.passive);
      }
    }
  });

  it('after the second match every hero chooses a tier IV ability of its class, which joins the battle', () => {
    let run = placeAll(upgradeAll(afterFirstMatch(6)));
    run = applyRunAction(win(run, 'B'), { type: 'nextMatch' }, content);
    for (const side of ['A', 'B'] as const) {
      for (const id of run.draft.picks[side]) {
        const hero = run.draft.pool.find((h) => h.id === id);
        const unlock = run.upgrade?.unlocks[id];
        expect(unlock?.kind).toBe('ultimate');
        expect((unlock?.options ?? []).length).toBeGreaterThan(0);
        for (const option of unlock?.options ?? []) {
          const ability = content.abilities[option];
          expect(ability?.tier).toBe(4);
          expect(ability?.class).toBe(hero?.classId);
        }
      }
    }
    run = placeAll(upgradeAll(run));
    const battle = createRunBattle(run, content);
    for (const id of [...run.draft.picks.A, ...run.draft.picks.B]) {
      const abilities = battle.heroes[id]?.abilities ?? [];
      expect(abilities).toHaveLength(content.config.generation.startingAbilities + 1);
      expect(abilities.filter((a) => content.abilities[a]?.tier === 4)).toHaveLength(1);
    }
  });

  it('after the third match there is nothing left to unlock', () => {
    let run = placeAll(upgradeAll(afterFirstMatch(6)));
    run = placeAll(upgradeAll(applyRunAction(win(run, 'B'), { type: 'nextMatch' }, content)));
    run = applyRunAction(win(run, 'B'), { type: 'nextMatch' }, content);
    expect(run.upgrade?.unlocks).toEqual({});
  });

  it('never offers a hero a perk it already has', () => {
    let run = placeAll(upgradeAll(afterFirstMatch(9)));
    run = applyRunAction(win(run, 'B'), { type: 'nextMatch' }, content);
    for (const side of ['A', 'B'] as const) {
      for (const id of run.draft.picks[side]) {
        const owned = run.draft.pool.find((h) => h.id === id)?.perks.map((p) => p.perkId) ?? [];
        for (const offered of run.upgrade?.offers[id] ?? []) expect(owned).not.toContain(offered);
      }
    }
  });
});
