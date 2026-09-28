/**
 * Reference data for the Godot port: what the TypeScript core says, written out as JSON
 * for the C# tests to compare against (godot/Brawl.Core.Tests/Fixtures). The TypeScript
 * core is the reference; the C# one must agree to the last hit point, or a Godot client
 * could not play online against a browser one.
 *
 *   npm run parity
 *
 * Run it after any change to core or content, and commit the fixtures with the change.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { profileByName } from '../src/ai/index.js';
import { loadContent, loadTeams } from '../src/content/load.js';
import {
  applyAction,
  createBattle,
  createRng,
  hexLine,
  nearestDirection,
  nextFloat,
  nextInt,
  ring,
  shuffle,
  startBattle,
} from '../src/core/index.js';
import type { Action, BattleState, Hex } from '../src/core/index.js';
import { playBattle } from '../src/sim/match.js';
import { playRun } from '../src/sim/series.js';

const OUT = join('godot', 'Brawl.Core.Tests', 'Fixtures');

function write(name: string, value: unknown): void {
  writeFileSync(join(OUT, name), `${JSON.stringify(value)}\n`);
  console.log(`${name} written`);
}

mkdirSync(OUT, { recursive: true });

write('content.json', loadContent());

// The generator: raw floats, integers in a range and a shuffle, from a few seeds,
// including negative and out-of-int32 ones that `| 0` has to fold.
const rngSeeds = [0, 1, 42, 123456, -7, 2 ** 31 + 5, 4294967296 * 3 + 11, 1790595209];
write(
  'rng.json',
  rngSeeds.map((seed) => {
    let rng = createRng(seed);
    const floats: number[] = [];
    for (let i = 0; i < 20; i++) {
      const [v, next] = nextFloat(rng);
      floats.push(v);
      rng = next;
    }
    const ints: number[] = [];
    for (let i = 0; i < 20; i++) {
      const [v, next] = nextInt(rng, -3, 17);
      ints.push(v);
      rng = next;
    }
    const [shuffled] = shuffle(rng, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    return { seed, floats, ints, shuffled };
  }),
);

// Hex geometry that rounds: lines (line of sight) and snapped directions, over every
// pair in a small patch, plus rings.
const patch: Hex[] = [];
for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) patch.push({ q, r });
const pairs = patch.flatMap((a) => patch.map((b) => ({ a, b })));
write('hex.json', {
  lines: pairs.map(({ a, b }) => ({ a, b, line: hexLine(a, b) })),
  directions: pairs.map(({ a, b }) => ({ a, b, dir: nearestDirection(a, b) })),
  rings: [0, 1, 2, 3].map((radius) => ({ radius, ring: ring({ q: 1, r: -2 }, radius) })),
});

// Whole battles, AI against AI: the starting state, then every action with the events it
// made and the state after it. The C# core replays the actions and must produce the same.
// Quick battles also check that the starting state is built the same from the rosters;
// battles from whole runs bring generated heroes with passives, perks, artifacts and the
// arena modifiers. Full states are kept for every step of the first battles and every
// tenth step of the rest, to keep the file small; events are kept for every step.
const content = loadContent();
const normal = profileByName(content, 'normal');
// A careless opponent for side B: its mistakes walk into rules a careful one avoids.
const novice = profileByName(content, 'novice');

interface Step {
  readonly action: Action;
  readonly events: unknown[];
  readonly state?: BattleState;
}

function record(name: string, initial: BattleState, quick: boolean, everyState: boolean): unknown {
  const actions: Action[] = [];
  playBattle(initial, { content, profileA: normal, profileB: novice, onAction: (action) => actions.push(action) });
  const started = startBattle(initial, content);
  let state = started.state;
  const steps: Step[] = [];
  actions.forEach((action, i) => {
    const applied = applyAction(state, action, content);
    state = applied.state;
    const keep = everyState || i % 10 === 9 || i === actions.length - 1 || !quick;
    steps.push(keep ? { action, events: [...applied.events], state } : { action, events: [...applied.events] });
  });
  return { name, quick, seed: initial.seed, initial, start: { events: started.events, state: started.state }, steps };
}

const battles: unknown[] = [];
for (const seed of [1, 2, 3, 4, 5, 6]) {
  battles.push(record(`quick ${seed}`, createBattle({ seed, teams: loadTeams(), content }), true, seed <= 2));
}

// Runs until every arena modifier has been seen; the first eight runs give all their matches.
const seen = new Set<string>();
for (let seed = 1; seed <= 40 && (seed <= 8 || seen.size < Object.keys(content.arenaModifiers).length); seed++) {
  let match = 0;
  playRun({
    seed,
    content,
    profileA: normal,
    profileB: novice,
    onBattle: (initial) => {
      match++;
      const fresh = initial.modifiers.filter((m) => !seen.has(m));
      if (seed > 8 && fresh.length === 0) return;
      fresh.forEach((m) => seen.add(m));
      battles.push(record(`run ${seed} match ${match}${initial.modifiers.length > 0 ? ` (${initial.modifiers.join(', ')})` : ''}`, initial, false, false));
    },
  });
}

writeFileSync(join(OUT, 'battles.json.gz'), gzipSync(JSON.stringify(battles)));
console.log(`battles.json.gz written: ${battles.length} battles, modifiers ${[...seen].join(', ')}`);
