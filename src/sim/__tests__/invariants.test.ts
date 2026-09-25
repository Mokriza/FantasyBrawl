/**
 * Properties that must hold in any match at all, checked over AI-against-AI games.
 * See docs/ai/testing-and-simulation.md. Every failure prints its seed so it can be
 * reproduced exactly.
 *
 * The cheap checks run over the full set of matches; the expensive ones (deep
 * immutability, serialisation, replay) run over a smaller sample, because they copy
 * the whole state on every single action.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadContent, loadTeams } from '../../content/load.js';
import type { ContentRegistry, Teams } from '../../core/content.js';
import { profileByName } from '../../ai/index.js';
import { playMatch } from '../match.js';
import type { Action, BattleState } from '../../core/types.js';
import { applyAction, startBattle } from '../../core/battle/apply.js';
import { createBattle } from '../../core/battle/state.js';
import { legalActions } from '../../core/battle/legal.js';
import { allHeroes, livingHeroes } from '../../core/battle/query.js';
import { hexKey } from '../../core/hex.js';

const MATCHES = 200;
const DEEP_MATCHES = 15;

let content: ContentRegistry;
let teams: Teams;

beforeAll(() => {
  content = loadContent();
  teams = loadTeams();
});

function checkStateInvariants(state: BattleState, seed: number, label: string): void {
  const occupied = new Set<string>();
  for (const hero of allHeroes(state)) {
    expect(hero.hp, `seed ${seed} ${label}: ${hero.id} hp out of range`).toBeGreaterThanOrEqual(0);
    expect(hero.hp, `seed ${seed} ${label}: ${hero.id} hp over max`).toBeLessThanOrEqual(
      hero.base.maxHp,
    );
    for (const [id, turns] of Object.entries(hero.cooldowns)) {
      // Negative means spent for the match; anything else must not go below zero.
      expect(turns >= 0 || turns === -1, `seed ${seed} ${label}: cooldown ${id}=${turns}`).toBe(
        true,
      );
    }
    if (hero.hp > 0) {
      const key = hexKey(hero.hex);
      expect(occupied.has(key), `seed ${seed} ${label}: two heroes on ${key}`).toBe(false);
      occupied.add(key);
    }
  }
  expect(state.apLeft, `seed ${seed} ${label}: negative AP`).toBeGreaterThanOrEqual(0);
}

describe('battle invariants', () => {
  it(
    `holds over ${MATCHES} AI matches`,
    () => {
      const profile = profileByName(content, 'normal');
      for (let i = 0; i < MATCHES; i++) {
        const seed = 1000 + i;
        const result = playMatch({ seed, teams, content, profileA: profile, profileB: profile });

        checkStateInvariants(result.state, seed, 'final');
        expect(result.state.outcome, `seed ${seed}: match never finished`).not.toBeNull();
        expect(
          result.state.round,
          `seed ${seed}: ran past the round limit`,
        ).toBeLessThanOrEqual(content.config.battle.maxRounds + 1);

        // Nobody can be left standing on the losing side.
        const winner = result.state.outcome?.winner;
        const losers = livingHeroes(result.state).filter((h) => h.side !== winner);
        if (result.state.outcome?.reason === 'elimination') {
          expect(losers, `seed ${seed}: eliminated side still has heroes`).toHaveLength(0);
        }
      }
    },
    240_000,
  );

  it(
    'every action legalActions offers can actually be applied',
    () => {
      const profile = profileByName(content, 'normal');
      for (let i = 0; i < DEEP_MATCHES; i++) {
        const seed = 5000 + i;
        playMatch({
          seed,
          teams,
          content,
          profileA: profile,
          profileB: profile,
          onAction: (_action, state) => {
            if (state.outcome !== null) return;
            for (const option of legalActions(state, content)) {
              expect(() => applyAction(state, option, content, { deterministic: true })).not.toThrow();
            }
            checkStateInvariants(state, seed, 'mid');
          },
        });
      }
    },
    240_000,
  );

  it(
    'applyAction never touches the state it was given',
    () => {
      const profile = profileByName(content, 'normal');
      for (let i = 0; i < DEEP_MATCHES; i++) {
        const seed = 7000 + i;
        playMatch({
          seed,
          teams,
          content,
          profileA: profile,
          profileB: profile,
          onAction: (_action, state) => {
            const snapshot = JSON.stringify(state);
            const copy: BattleState = JSON.parse(snapshot) as BattleState;
            const options = legalActions(state, content);
            const first = options[0];
            if (first !== undefined) {
              applyAction(state, first, content, { deterministic: true });
            }
            expect(JSON.stringify(state), `seed ${seed}: state mutated`).toBe(
              JSON.stringify(copy),
            );
          },
        });
      }
    },
    240_000,
  );

  it(
    'the state survives a round trip through JSON',
    () => {
      const profile = profileByName(content, 'normal');
      const result = playMatch({
        seed: 31337,
        teams,
        content,
        profileA: profile,
        profileB: profile,
      });
      const copy = JSON.parse(JSON.stringify(result.state)) as BattleState;
      expect(copy).toEqual(result.state);
    },
    60_000,
  );

  it(
    'the same seed and the same actions give the same match twice',
    () => {
      const profile = profileByName(content, 'normal');
      for (const seed of [11, 22, 33]) {
        const first = playMatch({ seed, teams, content, profileA: profile, profileB: profile });
        const second = playMatch({ seed, teams, content, profileA: profile, profileB: profile });
        expect(JSON.stringify(second.state), `seed ${seed}: not reproducible`).toBe(
          JSON.stringify(first.state),
        );
        expect(second.events.length).toBe(first.events.length);
      }
    },
    120_000,
  );

  it(
    'replaying a recorded action list reproduces the state exactly',
    () => {
      const profile = profileByName(content, 'normal');
      const seed = 4242;
      const recorded: Action[] = [];
      const played = playMatch({
        seed,
        teams,
        content,
        profileA: profile,
        profileB: profile,
        onAction: (action) => recorded.push(action),
      });

      let replay = startBattle(createBattle({ seed, teams, content }), content).state;
      for (const action of recorded) {
        replay = applyAction(replay, action, content).state;
      }
      expect(JSON.stringify(replay)).toBe(JSON.stringify(played.state));
    },
    60_000,
  );
});
