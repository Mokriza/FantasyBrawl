/**
 * A whole run played headless: draft, placement and every match, AI on both sides.
 * Used by `npm run sim -- --mode draft` and by the run invariant tests.
 */

import type { BattleState, ContentRegistry, RunAction, RunState } from '../core/index.js';
import {
  applyRunAction,
  awaitingPerk,
  awaitingReward,
  awaitingUnlock,
  createRng,
  createRun,
  createRunBattle,
  draftTurn,
} from '../core/index.js';
import type { AiProfile } from '../ai/index.js';
import { choosePerk, choosePick, choosePlacement, chooseReward, chooseSwap, chooseUnlock } from '../ai/index.js';
import type { MatchResult } from './match.js';
import { playBattle } from './match.js';

export interface RunResult {
  readonly run: RunState;
  readonly matches: readonly MatchResult[];
  /** How many heroes the two sides swapped between matches, together. */
  readonly swaps: number;
}

export interface RunOptions {
  readonly seed: number;
  readonly content: ContentRegistry;
  readonly profileA: AiProfile;
  readonly profileB: AiProfile;
  /** Sees the starting state of every battle, before it is played (the Godot parity export). */
  readonly onBattle?: (initial: BattleState) => void;
  /** Sees every run action and the run after it (the Godot parity export). */
  readonly onRunAction?: (action: RunAction, after: RunState) => void;
}

export function playRun(options: RunOptions): RunResult {
  const { seed, content } = options;
  let run = createRun({ seed, content });
  // The AI's own stream for draft and placement, apart from the run and the battles.
  let aiRng = createRng(seed ^ 0x51ed270b);
  const matches: MatchResult[] = [];
  let swaps = 0;
  const act = (action: RunAction): void => {
    run = applyRunAction(run, action, content);
    options.onRunAction?.(action, run);
  };

  // A run is at most maxMatches matches long; the guard only catches a rules bug.
  for (let step = 0; step < 1000 && run.phase !== 'finished'; step++) {
    switch (run.phase) {
      case 'draft': {
        const side = draftTurn(run.draft);
        if (side === null) throw new Error('draft phase with no pick left');
        const decision = choosePick(run.draft, content, aiRng);
        aiRng = decision.rng;
        act({ type: 'pick', side, heroId: decision.heroId });
        break;
      }
      case 'placement': {
        const decision = choosePlacement(run, content, aiRng);
        aiRng = decision.rng;
        const side = run.placement?.order[run.placement.placed.length];
        if (side === undefined) throw new Error('placement phase with nobody to place');
        act({ type: 'place', side, heroId: decision.heroId, hex: decision.hex });
        break;
      }
      case 'battle': {
        const initial = createRunBattle(run, content);
        options.onBattle?.(initial);
        const result = playBattle(initial, {
          content,
          profileA: options.profileA,
          profileB: options.profileB,
        });
        matches.push(result);
        const outcome = result.state.outcome;
        if (outcome === null) throw new Error(`match ${run.match} of run ${seed} did not finish`);
        act({ type: 'matchEnded', outcome, rounds: result.state.round, loot: result.state.loot });
        break;
      }
      case 'matchOver':
        act({ type: 'nextMatch' });
        break;
      case 'upgrade': {
        for (const side of ['A', 'B'] as const) {
          // The swap first: the newcomer may be the one the reward fits best.
          const swap = chooseSwap(run, side, content);
          if (swap !== null) {
            act({ type: 'swapHero', side, ...swap });
            swaps += 1;
          }
          if (run.upgrade !== null && awaitingReward(run.upgrade, run.draft, side, content)) {
            const decision = chooseReward(run, side, content, aiRng);
            aiRng = decision.rng;
            act({ type: 'chooseReward', side, itemId: decision.itemId, heroId: decision.heroId });
          }
          for (const heroId of run.upgrade === null ? [] : awaitingUnlock(run.upgrade, run.draft, side)) {
            const decision = chooseUnlock(run, heroId, content, aiRng);
            aiRng = decision.rng;
            act({ type: 'chooseUnlock', side, heroId, optionId: decision.optionId });
          }
          for (const heroId of run.upgrade === null ? [] : awaitingPerk(run.upgrade, run.draft, side)) {
            const decision = choosePerk(run, heroId, content, aiRng);
            aiRng = decision.rng;
            act(
              decision.abilityId === undefined
                ? { type: 'choosePerk', side, heroId, perkId: decision.perkId }
                : { type: 'choosePerk', side, heroId, perkId: decision.perkId, abilityId: decision.abilityId },
            );
          }
        }
        act({ type: 'readyUpgrade', side: 'A' });
        act({ type: 'readyUpgrade', side: 'B' });
        break;
      }
    }
  }

  return { run, matches, swaps };
}
