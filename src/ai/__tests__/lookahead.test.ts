import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent, loadTeams } from '../../content/load.js';
import type { BattleState, ContentRegistry } from '../../core/index.js';
import { applyAction, createBattle, createRng, startBattle } from '../../core/index.js';
import { chooseActions, profileByName } from '../index.js';
import { bestReply, closeTurn, playOut, plansToDeepen } from '../lookahead.js';
import { generatePlans } from '../plans.js';

let content: ContentRegistry;
let start: BattleState;
beforeAll(() => {
  content = loadContent();
  start = startBattle(createBattle({ seed: 7, teams: loadTeams(), content }), content).state;
});

describe('looking ahead', () => {
  it('closing a turn hands it on, and an already closed one is left alone', () => {
    const acting = start.activeHeroId;
    const closed = closeTurn(start, acting, content);
    expect(closed.activeHeroId).not.toBe(acting);
    expect(closeTurn(closed, acting, content)).toBe(closed);
  });

  it('the best reply is a turn played by whoever acts next, and ends it', () => {
    const next = closeTurn(start, start.activeHeroId, content);
    const replied = bestReply(next, content, profileByName(content, 'normal'));
    expect(replied.activeHeroId).not.toBe(next.activeHeroId);
  });

  it('plays out as many turns as the depth asks', () => {
    const plan = generatePlans(start, content, true)[0];
    const acting = start.activeHeroId;
    if (plan === undefined || acting === null) throw new Error('setup');
    const profile = profileByName(content, 'nightmare');
    const one = playOut(plan.state, acting, 1, content, profile);
    const two = playOut(plan.state, acting, 2, content, profile);
    expect(two.tick).toBeGreaterThanOrEqual(one.tick);
    expect(plansToDeepen(1, content)).toBe(content.config.ai.lookaheadTopPlans[0]);
    expect(plansToDeepen(2, content)).toBe(content.config.ai.lookaheadTopPlans[1]);
  });

  it('the looking-ahead profiles choose legal turns, the same one for the same seed', () => {
    for (const name of ['veteran', 'nightmare']) {
      const profile = profileByName(content, name);
      const first = chooseActions(start, content, createRng(3), profile);
      const again = chooseActions(start, content, createRng(3), profile);
      expect(again.actions).toEqual(first.actions);
      let state = start;
      for (const action of first.actions) state = applyAction(state, action, content).state;
      expect(state.activeHeroId).not.toBe(start.activeHeroId);
    }
  });
});
