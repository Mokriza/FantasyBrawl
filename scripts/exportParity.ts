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
import { loadContent } from '../src/content/load.js';
import { createRng, hexLine, nearestDirection, nextFloat, nextInt, ring, shuffle } from '../src/core/index.js';
import type { Hex } from '../src/core/index.js';

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
