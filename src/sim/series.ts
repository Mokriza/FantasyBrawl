/**
 * A whole run played headless: draft, placement and every match, AI on both sides.
 * Used by `npm run sim -- --mode draft` and by the run invariant tests.
 */

import type { ContentRegistry, RunState } from '../core/index.js';
import {
  applyRunAction,
  awaitingPerk,
  awaitingUnlock,
  createRng,
  createRun,
  createRunBattle,
  draftTurn,
} from '../core/index.js';
import type { AiProfile } from '../ai/index.js';
import { choosePerk, choosePick, choosePlacement, chooseUnlock } from '../ai/index.js';
import type { MatchResult } from './match.js';
import { playBattle } from './match.js';

export interface RunResult {
  readonly run: RunState;
  readonly matches: readonly MatchResult[];
}

export interface RunOptions {
  readonly seed: number;
  readonly content: ContentRegistry;
  readonly profileA: AiProfile;
  readonly profileB: AiProfile;
}

export function playRun(options: RunOptions): RunResult {
  const { seed, content } = options;
  let run = createRun({ seed, content });
  // The AI's own stream for draft and placement, apart from the run and the battles.
  let aiRng = createRng(seed ^ 0x51ed270b);
  const matches: MatchResult[] = [];

  // A run is at most maxMatches matches long; the guard only catches a rules bug.
  for (let step = 0; step < 1000 && run.phase !== 'finished'; step++) {
    switch (run.phase) {
      case 'draft': {
        const side = draftTurn(run.draft);
        if (side === null) throw new Error('draft phase with no pick left');
        const decision = choosePick(run.draft, content, aiRng);
        aiRng = decision.rng;
        run = applyRunAction(run, { type: 'pick', side, heroId: decision.heroId }, content);
        break;
      }
      case 'placement': {
        const decision = choosePlacement(run, content, aiRng);
        aiRng = decision.rng;
        const side = run.placement?.order[run.placement.placed.length];
        if (side === undefined) throw new Error('placement phase with nobody to place');
        run = applyRunAction(
          run,
          { type: 'place', side, heroId: decision.heroId, hex: decision.hex },
          content,
        );
        break;
      }
      case 'battle': {
        const result = playBattle(createRunBattle(run, content), {
          content,
          profileA: options.profileA,
          profileB: options.profileB,
        });
        matches.push(result);
        const outcome = result.state.outcome;
        if (outcome === null) throw new Error(`match ${run.match} of run ${seed} did not finish`);
        run = applyRunAction(
          run,
          { type: 'matchEnded', outcome, rounds: result.state.round },
          content,
        );
        break;
      }
      case 'matchOver':
        run = applyRunAction(run, { type: 'nextMatch' }, content);
        break;
      case 'upgrade': {
        for (const side of ['A', 'B'] as const) {
          for (const heroId of run.upgrade === null ? [] : awaitingUnlock(run.upgrade, run.draft, side)) {
            const decision = chooseUnlock(run, heroId, content, aiRng);
            aiRng = decision.rng;
            run = applyRunAction(run, { type: 'chooseUnlock', side, heroId, optionId: decision.optionId }, content);
          }
          for (const heroId of run.upgrade === null ? [] : awaitingPerk(run.upgrade, run.draft, side)) {
            const decision = choosePerk(run, heroId, content, aiRng);
            aiRng = decision.rng;
            run = applyRunAction(
              run,
              decision.abilityId === undefined
                ? { type: 'choosePerk', side, heroId, perkId: decision.perkId }
                : { type: 'choosePerk', side, heroId, perkId: decision.perkId, abilityId: decision.abilityId },
              content,
            );
          }
        }
        run = applyRunAction(run, { type: 'endUpgrade' }, content);
        break;
      }
    }
  }

  return { run, matches };
}
