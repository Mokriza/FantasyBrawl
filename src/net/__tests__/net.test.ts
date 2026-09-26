import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../content/load.js';
import type { ContentRegistry, Side } from '../../core/index.js';
import {
  availableHeroes,
  draftTurn,
  itemFits,
  legalActions,
  legalPlacementHexes,
  perkTargets,
  placementTurn,
  teamAfterSwap,
  waitingFor,
} from '../../core/index.js';
import { actorOf, isLegalEntry } from '../authority.js';
import { contentHash } from '../hash.js';
import type { LogEntry, NetGame } from '../log.js';
import { applyEntry, createNetGame, replay } from '../log.js';
import { logEntrySchema, toLogEntry } from '../protocol.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

/** Every choice of one side in the upgrade phase, first options, then ready. */
function upgradeEntries(game: NetGame, side: Side): LogEntry[] {
  const upgrade = game.run.upgrade;
  if (upgrade === null || upgrade.ready[side] === true) return [];
  if (waitingFor(upgrade, game.run.draft, side, content).length === 0) {
    return [{ kind: 'run', action: { type: 'readyUpgrade', side } }];
  }
  for (const itemId of upgrade.rewarded[side] === undefined ? upgrade.rewards[side] : []) {
    const item = content.items[itemId];
    const hero = teamAfterSwap(upgrade, game.run.draft, side).find((h) => item !== undefined && itemFits(item, h.classId, content));
    if (hero !== undefined) return [{ kind: 'run', action: { type: 'chooseReward', side, itemId, heroId: hero.id } }];
  }
  for (const heroId of game.run.draft.picks[side]) {
    const unlock = upgrade.unlocks[heroId];
    if (unlock !== undefined && upgrade.unlocked[heroId] === undefined) {
      return [{ kind: 'run', action: { type: 'chooseUnlock', side, heroId, optionId: unlock.options[0] ?? '' } }];
    }
    const perkId = upgrade.offers[heroId]?.[0];
    if (perkId !== undefined && upgrade.chosen[heroId] === undefined) {
      const perk = content.perks[perkId];
      const hero = game.run.draft.pool.find((h) => h.id === heroId);
      const target = perk?.abilityMod === undefined || hero === undefined ? undefined : perkTargets(hero, perk, content)[0];
      return [
        {
          kind: 'run',
          action: target === undefined ? { type: 'choosePerk', side, heroId, perkId } : { type: 'choosePerk', side, heroId, perkId, abilityId: target },
        },
      ];
    }
  }
  return [];
}

/** The next entry of a plain bot that takes the first legal option everywhere. */
function nextEntry(game: NetGame): LogEntry | null {
  const run = game.run;
  switch (run.phase) {
    case 'draft': {
      const side = draftTurn(run.draft);
      const hero = availableHeroes(run.draft)[0];
      return side === null || hero === undefined ? null : { kind: 'run', action: { type: 'pick', side, heroId: hero.id } };
    }
    case 'placement': {
      const placement = run.placement;
      const side = placement === null ? null : placementTurn(placement);
      if (placement === null || side === null) return null;
      const heroId = run.draft.picks[side].find((id) => !placement.placed.some((p) => p.heroId === id));
      const hex = legalPlacementHexes(placement, side, content.config)[0];
      return heroId === undefined || hex === undefined ? null : { kind: 'run', action: { type: 'place', side, heroId, hex } };
    }
    case 'battle': {
      if (game.battle === null) return null;
      const actions = legalActions(game.battle, content);
      const action = actions.find((a) => a.type === 'ability') ?? actions.find((a) => a.type === 'endTurn');
      return action === undefined ? null : { kind: 'battle', action };
    }
    case 'matchOver':
      return { kind: 'run', action: { type: 'nextMatch' } };
    case 'upgrade':
      return upgradeEntries(game, 'A')[0] ?? upgradeEntries(game, 'B')[0] ?? null;
    case 'finished':
      return null;
  }
}

function playOut(seed: number): { game: NetGame; log: LogEntry[] } {
  let game = createNetGame(seed, content);
  const log: LogEntry[] = [];
  for (let step = 0; step < 20000; step++) {
    const entry = nextEntry(game);
    if (entry === null) break;
    expect(isLegalEntry(game, entry, content)).toBe(true);
    game = applyEntry(game, entry, content).game;
    log.push(entry);
  }
  return { game, log };
}

describe('the online log', () => {
  let played: { game: NetGame; log: LogEntry[] };
  beforeAll(() => {
    played = playOut(21);
  }, 120_000);

  it('plays a whole run: the battle starts and reports itself', () => {
    expect(played.game.run.phase).toBe('finished');
    expect(played.game.run.history.length).toBeGreaterThanOrEqual(content.config.run.winsToFinish);
  });

  it('replaying the log from the seed gives the very same game', () => {
    expect(replay(21, played.log, content)).toEqual(played.game);
  });

  it('every entry survives the wire: JSON, then the schema', () => {
    for (const entry of played.log) {
      const parsed = logEntrySchema.parse(JSON.parse(JSON.stringify(entry)));
      expect(toLogEntry(parsed)).toEqual(entry);
    }
  });
});

describe('who may send what', () => {
  it('a battle action belongs to the side of the active hero, a run action to its side', () => {
    let game = createNetGame(3, content);
    let entry = nextEntry(game);
    // Through the draft and placement to the first battle turn.
    while (entry !== null && game.run.phase !== 'battle') {
      game = applyEntry(game, entry, content).game;
      entry = nextEntry(game);
    }
    const battle = game.battle;
    if (battle === null || battle.activeHeroId === null || entry === null) throw new Error('setup');
    const activeSide = battle.heroes[battle.activeHeroId]?.side;
    expect(actorOf(game, entry)).toBe(activeSide);
    expect(actorOf(game, { kind: 'run', action: { type: 'nextMatch' } })).toBeNull();
    expect(actorOf(game, { kind: 'run', action: { type: 'autoPick', side: 'A' } })).toBeNull();
    expect(actorOf(game, { kind: 'run', action: { type: 'readyUpgrade', side: 'B' } })).toBe('B');
  });

  it('an illegal entry is refused without throwing', () => {
    const game = createNetGame(3, content);
    const hero = availableHeroes(game.run.draft)[0];
    if (hero === undefined) throw new Error('setup');
    const wrongTurn: Side = draftTurn(game.run.draft) === 'A' ? 'B' : 'A';
    expect(isLegalEntry(game, { kind: 'run', action: { type: 'pick', side: wrongTurn, heroId: hero.id } }, content)).toBe(false);
    expect(isLegalEntry(game, { kind: 'run', action: { type: 'nextMatch' } }, content)).toBe(false);
  });
});

describe('the content fingerprint', () => {
  it('is stable, and a changed number changes it', () => {
    expect(contentHash(content)).toBe(contentHash(loadContent()));
    const changed: ContentRegistry = { ...content, config: { ...content.config, battle: { ...content.config.battle, apPerTurn: 5 } } };
    expect(contentHash(changed)).not.toBe(contentHash(content));
  });
});
