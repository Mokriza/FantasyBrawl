import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent } from '../../content/load.js';
import type { ContentRegistry, DraftState } from '../../core/index.js';
import {
  applyPick,
  createDraft,
  createRng,
  draftTurn,
  generatePool,
  getClass,
  legalPicks,
  teamOf,
} from '../../core/index.js';
import { choosePick } from '../draft.js';

let content: ContentRegistry;
beforeAll(() => {
  content = loadContent();
});

/** Both sides drafted by the AI from one seeded pool. */
function aiDraft(seed: number): DraftState {
  let draft = createDraft(generatePool(content, createRng(seed))[0], content);
  let rng = createRng(seed ^ 0x1234);
  for (let side = draftTurn(draft); side !== null; side = draftTurn(draft)) {
    const decision = choosePick(draft, content, rng);
    rng = decision.rng;
    expect(legalPicks(draft, side)).toContain(decision.heroId);
    draft = applyPick(draft, side, decision.heroId);
  }
  return draft;
}

describe('the draft AI', () => {
  it('only ever makes legal picks, to the end of the draft', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const draft = aiDraft(seed);
      expect(draft.picks.A).toHaveLength(3);
      expect(draft.picks.B).toHaveLength(3);
    }
  });

  it('is deterministic for a seed', () => {
    expect(aiDraft(5)).toEqual(aiDraft(5));
  });

  it('spreads its team over roles instead of stacking one', () => {
    // A team of three of one role should lose, per the design document, so the AI's
    // missing-role bonus must keep that rare.
    let stacked = 0;
    let teams = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const draft = aiDraft(seed);
      for (const side of ['A', 'B'] as const) {
        const roles = new Set(teamOf(draft, side).map((h) => getClass(content, h.classId).role));
        teams++;
        if (roles.size === 1) stacked++;
      }
    }
    expect(stacked / teams).toBeLessThan(0.05);
  });
});
