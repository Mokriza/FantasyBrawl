/**
 * What the server does for a player whose clock ran out, and whose clock is running.
 * Every automatic move is an ordinary log entry, legal by the same rules as a player's,
 * so both clients replay it like any other.
 */

import type { ContentRegistry, Side } from '../core/index.js';
import {
  draftTurn,
  itemFits,
  legalPlacementHexes,
  perkTargets,
  placementTurn,
  teamAfterSwap,
  waitingFor,
} from '../core/index.js';
import type { LogEntry, NetGame } from '../net/index.js';

/** Whose clock runs now, how long it is, and a key that changes when a new one starts. */
export interface Clock {
  readonly key: string;
  readonly side: Side | null;
  readonly seconds: number;
}

/**
 * The clock of the current moment, or null when nothing waits on a player. A clock
 * restarts only when its key changes: a new pick, a new hero to place, a new turn, a
 * new upgrade phase. Choices inside the upgrade phase do not restart it, so toggling a
 * perk cannot hold the game forever.
 */
export function clockOf(game: NetGame, turns: number, content: ContentRegistry): Clock | null {
  const run = game.run;
  const online = content.config.online;
  switch (run.phase) {
    case 'draft': {
      const picks = run.draft.picks.A.length + run.draft.picks.B.length;
      return { key: `draft:${picks}`, side: draftTurn(run.draft), seconds: content.config.draft.pickSeconds };
    }
    case 'placement': {
      const placed = run.placement?.placed.length ?? 0;
      const side = run.placement === null ? null : placementTurn(run.placement);
      return { key: `place:${run.match}:${placed}`, side, seconds: online.placeSeconds };
    }
    case 'upgrade':
      return { key: `upgrade:${run.match}`, side: null, seconds: online.upgradeSeconds };
    case 'battle': {
      const battle = game.battle;
      const active = battle?.activeHeroId === null || battle === null ? undefined : battle.heroes[battle.activeHeroId];
      const side = active?.side === 'A' || active?.side === 'B' ? active.side : null;
      return { key: `battle:${run.match}:${turns}`, side, seconds: online.turnSeconds };
    }
    case 'matchOver':
      return { key: `over:${run.match}`, side: null, seconds: online.continueSeconds };
    case 'finished':
      return null;
  }
}

/** One entry that brings a side's upgrade phase closer to done: first options, then ready. */
function upgradeStep(game: NetGame, side: Side, content: ContentRegistry): LogEntry | null {
  const upgrade = game.run.upgrade;
  if (upgrade === null || upgrade.ready[side] === true) return null;
  if (waitingFor(upgrade, game.run.draft, side, content).length === 0) {
    return { kind: 'run', action: { type: 'readyUpgrade', side } };
  }
  if (upgrade.rewarded[side] === undefined) {
    const team = teamAfterSwap(upgrade, game.run.draft, side);
    for (const itemId of upgrade.rewards[side]) {
      const item = content.items[itemId];
      const hero = item === undefined ? undefined : team.find((h) => itemFits(item, h.classId, content));
      if (hero !== undefined) return { kind: 'run', action: { type: 'chooseReward', side, itemId, heroId: hero.id } };
    }
  }
  const swap = upgrade.swapped[side];
  for (const heroId of game.run.draft.picks[side]) {
    if (swap?.outId === heroId) continue;
    const unlock = upgrade.unlocks[heroId];
    if (unlock !== undefined && upgrade.unlocked[heroId] === undefined) {
      const optionId = unlock.options[0];
      if (optionId !== undefined) return { kind: 'run', action: { type: 'chooseUnlock', side, heroId, optionId } };
    }
    const perkId = upgrade.offers[heroId]?.[0];
    if (perkId !== undefined && upgrade.chosen[heroId] === undefined) {
      const perk = content.perks[perkId];
      const hero = game.run.draft.pool.find((h) => h.id === heroId);
      const target = perk?.abilityMod === undefined || hero === undefined ? undefined : perkTargets(hero, perk, content)[0];
      return {
        kind: 'run',
        action:
          target === undefined
            ? { type: 'choosePerk', side, heroId, perkId }
            : { type: 'choosePerk', side, heroId, perkId, abilityId: target },
      };
    }
  }
  return null;
}

/**
 * The next automatic entry when the clock runs out, or null when there is none left
 * to make. The caller applies it and asks again until null: the upgrade phase takes
 * several entries per side.
 */
export function timeoutEntry(game: NetGame, content: ContentRegistry): LogEntry | null {
  const run = game.run;
  switch (run.phase) {
    case 'draft': {
      const side = draftTurn(run.draft);
      return side === null ? null : { kind: 'run', action: { type: 'autoPick', side } };
    }
    case 'placement': {
      const placement = run.placement;
      const side = placement === null ? null : placementTurn(placement);
      if (placement === null || side === null) return null;
      const heroId = run.draft.picks[side].find((id) => !placement.placed.some((p) => p.heroId === id));
      const hex = legalPlacementHexes(placement, side, content.config)[0];
      return heroId === undefined || hex === undefined ? null : { kind: 'run', action: { type: 'place', side, heroId, hex } };
    }
    case 'upgrade':
      return upgradeStep(game, 'A', content) ?? upgradeStep(game, 'B', content);
    case 'battle': {
      const id = game.battle?.activeHeroId;
      return id === null || id === undefined ? null : { kind: 'battle', action: { type: 'endTurn', heroId: id } };
    }
    case 'matchOver':
      return { kind: 'run', action: { type: 'nextMatch' } };
    case 'finished':
      return null;
  }
}
