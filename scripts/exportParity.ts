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
import {
  choosePerk,
  choosePick,
  choosePlacement,
  chooseReward,
  chooseSwap,
  chooseUnlock,
  profileByName,
} from '../src/ai/index.js';
import { loadContent, loadTeams } from '../src/content/load.js';
import {
  IllegalActionError,
  applyAction,
  applyRunAction,
  awaitingPerk,
  awaitingReward,
  awaitingUnlock,
  createBattle,
  createRng,
  createRun,
  createRunBattle,
  describeAbility,
  draftTurn,
  generatePool,
  getClass,
  heroLevel,
  hexLine,
  nearestDirection,
  nextFloat,
  nextInt,
  perkTargets,
  placementTurn,
  previewBattle,
  ring,
  shuffle,
  startBattle,
  startZone,
  statsInBattle,
  teamOf,
} from '../src/core/index.js';
import type { Action, BattleState, Hex, HeroTemplate, RunAction, RunState, Side } from '../src/core/index.js';
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

// --- runs ------------------------------------------------------------------------------
// The draft pool, the run actions and the upgrade phase. Pools from many seeds cover the
// generator; whole runs, AI against AI, cover every run action the AI takes, the state
// after each, and the starting state of each battle as createRunBattle builds it (the
// battles themselves are checked above). A scripted run adds what the AI never does
// but a person or the server will: autoPick, a swap undone, a ready taken back, and
// actions the rules refuse. Ability texts come from heroes with perks and artifacts.

const pools: unknown[] = [];
for (let seed = 1; seed <= 50; seed++) {
  const [pool, rng] = generatePool(content, createRng(seed));
  pools.push({ seed, pool, rng });
}

interface RunStep {
  readonly action: RunAction;
  readonly state?: RunState;
  readonly illegal?: true;
  readonly battle?: BattleState;
}

interface Described {
  readonly heroId: string;
  readonly level: number;
  readonly hero: HeroTemplate;
  readonly stats: unknown;
  readonly texts: Record<string, string>;
}

const described: Described[] = [];

/** Every ability of the hero's class, its basic attack included, as its card would say it. */
function describeHero(hero: HeroTemplate, level: number): void {
  const preview = previewBattle(hero, level, 'A', content);
  const entry = preview.heroes[hero.id];
  if (entry === undefined) throw new Error(`no preview of ${hero.id}`);
  const heroClass = getClass(content, hero.classId);
  const texts: Record<string, string> = {};
  for (const ability of Object.values(content.abilities)) {
    if (ability.class !== hero.classId && ability.id !== heroClass.baseAttack) continue;
    texts[ability.id] = describeAbility(ability, entry, content, preview);
  }
  described.push({ heroId: hero.id, level, hero, stats: statsInBattle(preview, entry, content), texts });
}

const runs: unknown[] = [];
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const initial = createRun({ seed, content });
  const steps: RunStep[] = [];
  playRun({
    seed,
    content,
    profileA: normal,
    profileB: novice,
    onRunAction: (action, after) => {
      if (after.phase === 'battle') {
        steps.push({ action, state: after, battle: createRunBattle(after, content) });
        if (seed <= 2) {
          for (const side of ['A', 'B'] as const) {
            for (const hero of teamOf(after.draft, side)) describeHero(hero, heroLevel(after));
          }
        }
      } else {
        steps.push({ action, state: after });
      }
    },
  });
  runs.push({ name: `run ${seed}`, seed, scripted: false, initial, steps });
}

/** A run driven by hand around the AI, for the actions the AI never takes. */
function scriptedRun(seed: number): unknown {
  let run = createRun({ seed, content });
  const initial = run;
  let aiRng = createRng(seed ^ 0x51ed270b);
  const steps: RunStep[] = [];
  const act = (action: RunAction): void => {
    try {
      run = applyRunAction(run, action, content);
    } catch (error) {
      if (!(error instanceof IllegalActionError)) throw error;
      steps.push({ action, illegal: true });
      return;
    }
    steps.push(
      run.phase === 'battle' && action.type === 'place'
        ? { action, state: run, battle: createRunBattle(run, content) }
        : { action, state: run },
    );
  };
  const other = (side: Side): Side => (side === 'A' ? 'B' : 'A');

  const upgradeByAi = (side: Side): void => {
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
  };

  let firstPlacement = true;
  for (let guard = 0; guard < 1000 && run.phase !== 'finished'; guard++) {
    switch (run.phase) {
      case 'draft': {
        const side = draftTurn(run.draft);
        if (side === null) throw new Error('draft phase with no pick left');
        if (side === 'A') {
          // Out of turn, then the timer running out.
          const first = run.draft.pool[0];
          if (first !== undefined) act({ type: 'pick', side: 'B', heroId: first.id });
          act({ type: 'autoPick', side: 'A' });
        } else {
          const taken = run.draft.picks.A[0];
          if (taken !== undefined) act({ type: 'pick', side: 'B', heroId: taken });
          const decision = choosePick(run.draft, content, aiRng);
          aiRng = decision.rng;
          act({ type: 'pick', side, heroId: decision.heroId });
        }
        break;
      }
      case 'placement': {
        const placement = run.placement;
        const side = placement === null ? null : placementTurn(placement);
        if (side === null) throw new Error('placement phase with nobody to place');
        const decision = choosePlacement(run, content, aiRng);
        aiRng = decision.rng;
        if (firstPlacement) {
          // The other side's start zone, and a hero of the other side.
          const foreign = startZone(content.config, other(side))[0];
          if (foreign !== undefined) act({ type: 'place', side, heroId: decision.heroId, hex: foreign });
          const stranger = run.draft.picks[other(side)][0];
          if (stranger !== undefined) act({ type: 'place', side, heroId: stranger, hex: decision.hex });
        }
        act({ type: 'place', side, heroId: decision.heroId, hex: decision.hex });
        if (firstPlacement && run.placement !== null) {
          // The same hero again, now by the side whose turn it is.
          const placed = run.placement.placed[0];
          const turn = placementTurn(run.placement);
          if (placed !== undefined && turn !== null) act({ type: 'place', side: turn, heroId: placed.heroId, hex: placed.hex });
        }
        firstPlacement = false;
        break;
      }
      case 'battle': {
        act({ type: 'nextMatch' });
        const result = playBattle(createRunBattle(run, content), { content, profileA: normal, profileB: novice });
        const outcome = result.state.outcome;
        if (outcome === null) throw new Error(`scripted run ${seed}: a match did not finish`);
        act({ type: 'matchEnded', outcome, rounds: result.state.round, loot: result.state.loot });
        break;
      }
      case 'matchOver':
        act({ type: 'readyUpgrade', side: 'A' });
        act({ type: 'nextMatch' });
        break;
      case 'upgrade': {
        firstPlacement = true;
        // Ready with everything still to choose.
        act({ type: 'readyUpgrade', side: 'A' });
        const upgradeAtStart = run.upgrade;
        if (upgradeAtStart === null) throw new Error('upgrade phase without offers');
        const candidates = upgradeAtStart.candidates.A;
        const picks = run.draft.picks.A;
        const [c0, c1] = candidates;
        const [p0, p1] = picks;
        if (c0 !== undefined && c1 !== undefined && p0 !== undefined && p1 !== undefined) {
          act({ type: 'swapHero', side: 'A', outId: p0, inId: c0.id });
          act({ type: 'swapHero', side: 'A', outId: p1, inId: c1.id });
          act({ type: 'cancelSwap', side: 'A' });
          act({ type: 'cancelSwap', side: 'A' });
          act({ type: 'swapHero', side: 'A', outId: p0, inId: c0.id });
          // The leaving hero chooses nothing more.
          const offer = upgradeAtStart.offers[p0]?.[0];
          if (offer !== undefined) act({ type: 'choosePerk', side: 'A', heroId: p0, perkId: offer });
        }
        upgradeByAi('A');
        if (p1 !== undefined) act({ type: 'choosePerk', side: 'A', heroId: p1, perkId: 'no-such-perk' });
        act({ type: 'readyUpgrade', side: 'A' });
        // A second thought after ready takes the ready back.
        const upgrade = run.upgrade;
        const hero = upgrade === null ? undefined : picks.slice(1).find((id) => (upgrade.offers[id] ?? []).length >= 2);
        const perkId = hero === undefined ? undefined : upgrade?.offers[hero]?.[1];
        const perk = perkId === undefined ? undefined : content.perks[perkId];
        const template = run.draft.pool.find((h) => h.id === hero);
        if (hero !== undefined && perkId !== undefined && perk !== undefined && template !== undefined) {
          const target = perk.abilityMod === undefined ? undefined : perkTargets(template, perk, content)[0];
          act(
            target === undefined
              ? { type: 'choosePerk', side: 'A', heroId: hero, perkId }
              : { type: 'choosePerk', side: 'A', heroId: hero, perkId, abilityId: target },
          );
        }
        const swap = chooseSwap(run, 'B', content);
        if (swap !== null) act({ type: 'swapHero', side: 'B', ...swap });
        upgradeByAi('B');
        act({ type: 'readyUpgrade', side: 'B' });
        act({ type: 'unreadyUpgrade', side: 'B' });
        act({ type: 'readyUpgrade', side: 'B' });
        act({ type: 'readyUpgrade', side: 'A' });
        break;
      }
    }
  }
  if (run.phase !== 'finished') throw new Error(`scripted run ${seed} did not finish`);
  return { name: `scripted ${seed}`, seed, scripted: true, initial, steps };
}
runs.push(scriptedRun(11));
runs.push(scriptedRun(12));

for (let seed = 1; seed <= 6; seed++) {
  const [pool] = generatePool(content, createRng(seed * 7919));
  for (const hero of pool) for (const level of [1, 3]) describeHero(hero, level);
}

writeFileSync(join(OUT, 'runs.json.gz'), gzipSync(JSON.stringify({ pools, runs, described })));
console.log(`runs.json.gz written: ${pools.length} pools, ${runs.length} runs, ${described.length} described heroes`);
