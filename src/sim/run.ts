/**
 * Balance simulation. Runs headless in Node through tsx, no browser anywhere.
 *
 *   npm run sim -- --matches 1000 --seed 42 --profile normal --out sim-report.json
 *   npm run sim -- --mode draft --runs 200 --seed 1   whole runs: draft, placement, series
 *   npm run sim -- --mode draft --runs 25 --shards 16  the same, over 16 processes
 *   npm run sim -- --mode tournament --a veteran --b normal --matches 400   profile against profile
 */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { ContentRegistry } from '../core/index.js';
import { loadContent, loadTeams } from '../content/load.js';
import { profileByName } from '../ai/index.js';
import { playMatch } from './match.js';
import { playRun } from './series.js';
import type { RunStats } from './report.js';
import { addRun, emptyStats, mergeStats, printStats } from './report.js';

interface Args {
  mode: 'match' | 'draft' | 'tournament';
  a: string;
  b: string;
  matches: number;
  runs: number;
  seed: number;
  profile: string;
  out: string | null;
  /** Split the runs over this many processes. */
  shards: number;
  /** Print the raw counters as JSON, for a parent process to merge. */
  json: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { mode: 'match', a: 'veteran', b: 'normal', matches: 200, runs: 100, seed: 1, profile: 'normal', out: null, shards: 1, json: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--matches' && value !== undefined) args.matches = Number(value);
    if (key === '--seed' && value !== undefined) args.seed = Number(value);
    if (key === '--profile' && value !== undefined) args.profile = value;
    if (key === '--out' && value !== undefined) args.out = value;
    if (key === '--runs' && value !== undefined) args.runs = Number(value);
    if (key === '--mode' && (value === 'match' || value === 'draft' || value === 'tournament')) args.mode = value;
    if (key === '--shards' && value !== undefined) args.shards = Math.max(1, Number(value));
    if (key === '--json') args.json = true;
    if (key === '--a' && value !== undefined) args.a = value;
    if (key === '--b' && value !== undefined) args.b = value;
  }
  return args;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'draft') {
    await simulateRuns(args);
    return;
  }
  if (args.mode === 'tournament') {
    simulateTournament(args);
    return;
  }
  simulateMatches(args);
}

function simulateMatches(args: Args): void {
  const content = loadContent();
  const teams = loadTeams();
  const profile = profileByName(content, args.profile);

  const winsBySide: Record<string, number> = { A: 0, B: 0 };
  const winsByClass: Record<string, number> = {};
  const matchesByClass: Record<string, number> = {};
  const abilityUse: Record<string, number> = {};
  let roundLimitEndings = 0;
  let totalRounds = 0;
  let totalTurns = 0;
  // A monotonic counter, only ever printed. Nothing the simulation computes reads it,
  // so determinism is untouched; see CLAUDE.md rule 2.
  const started = process.hrtime.bigint();

  for (const hero of teams.heroes) {
    matchesByClass[hero.class] = 0;
    winsByClass[hero.class] = 0;
  }
  // Only abilities somebody actually carries are worth a usage metric; the rest of
  // the pool belongs to heroes this match never fields.
  const inPlay = new Set(teams.heroes.flatMap((hero) => hero.abilities));
  for (const id of inPlay) {
    abilityUse[id] = 0;
  }

  for (let i = 0; i < args.matches; i++) {
    const seed = args.seed + i;
    const result = playMatch({
      seed,
      teams,
      content,
      profileA: profile,
      profileB: profile,
    });

    const outcome = result.state.outcome;
    if (outcome === null) {
      console.error(`match ${i} (seed ${seed}) did not finish; round ${result.state.round}`);
      continue;
    }

    winsBySide[outcome.winner] = (winsBySide[outcome.winner] ?? 0) + 1;
    if (outcome.reason === 'roundLimit') roundLimitEndings++;
    totalRounds += result.state.round;
    totalTurns += result.turns;

    for (const hero of teams.heroes) {
      matchesByClass[hero.class] = (matchesByClass[hero.class] ?? 0) + 1;
      if (hero.side === outcome.winner) {
        winsByClass[hero.class] = (winsByClass[hero.class] ?? 0) + 1;
      }
    }
    for (const id of new Set(result.abilitiesUsed)) {
      if (inPlay.has(id)) abilityUse[id] = (abilityUse[id] ?? 0) + 1;
    }
  }

  const played = (winsBySide.A ?? 0) + (winsBySide.B ?? 0);
  const elapsed = (Number(process.hrtime.bigint() - started) / 1e9).toFixed(1);

  console.log(`\nМатчей: ${played} · профиль ${args.profile} · сид ${args.seed} · ${elapsed} с`);
  console.log(`Средняя длина матча: ${(totalRounds / played).toFixed(1)} раундов, ${(totalTurns / played).toFixed(1)} ходов`);
  console.log(`Побед стороны A: ${percent(winsBySide.A ?? 0, played)} (цель 45–55%)`);
  console.log(`Матчей по лимиту раундов: ${percent(roundLimitEndings, played)} (цель < 3%)`);

  console.log('\nВинрейт по классам (цель 45–55%):');
  for (const [cls, wins] of Object.entries(winsByClass)) {
    console.log(`  ${cls.padEnd(10)} ${percent(wins, matchesByClass[cls] ?? 0)}`);
  }

  const unused = Object.entries(abilityUse)
    .filter(([, count]) => count / played < 0.6)
    .map(([id, count]) => `${id} ${percent(count, played)}`);
  console.log(`\nСпособности, применённые меньше чем в 60% матчей: ${unused.length}`);
  for (const line of unused) console.log(`  ${line}`);

  if (args.out !== null) {
    const report = {
      matches: played,
      seed: args.seed,
      profile: args.profile,
      averageRounds: totalRounds / played,
      averageTurns: totalTurns / played,
      winsBySide,
      winsByClass,
      matchesByClass,
      roundLimitEndings,
      abilityUse,
    };
    writeFileSync(args.out, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nОтчёт записан в ${args.out}`);
  }
}

/**
 * Profile against profile on the stage 1 rosters, a new arena every match. The two
 * profiles swap sides every match, so neither the rosters nor side B's tie rule
 * favours one of them. docs/ai/ai-opponent.md: veteran should beat normal in 65–80%,
 * normal should beat novice in 75–90%.
 */
function simulateTournament(args: Args): void {
  const content = loadContent();
  const teams = loadTeams();
  const a = profileByName(content, args.a);
  const b = profileByName(content, args.b);
  const started = process.hrtime.bigint();
  let winsA = 0;
  let rounds = 0;
  for (let i = 0; i < args.matches; i++) {
    const aIsSideA = i % 2 === 0;
    const result = playMatch({
      seed: args.seed + i,
      teams,
      content,
      profileA: aIsSideA ? a : b,
      profileB: aIsSideA ? b : a,
    });
    const winner = result.state.outcome?.winner;
    if ((winner === 'A' && aIsSideA) || (winner === 'B' && !aIsSideA)) winsA++;
    rounds += result.state.round;
  }
  const elapsed = (Number(process.hrtime.bigint() - started) / 1e9).toFixed(1);
  console.log(`\nТурнир: ${args.a} против ${args.b} · матчей: ${args.matches} · сид ${args.seed} · ${elapsed} с`);
  console.log(`Побед ${args.a}: ${percent(winsA, args.matches)}`);
  console.log(`Средняя длина матча: ${(rounds / args.matches).toFixed(1)} раундов`);
}


/**
 * Whole runs, AI against AI on the same profile. The headline number is the first
 * picker's run win rate: the design document wants it in 48–52%, and whether the
 * second drafter needs compensation is decided from it.
 *
 * With --shards N the runs are split over N processes, seeds apart, and the counters
 * merged; with --json a process prints its counters instead of the report.
 */
async function simulateRuns(args: Args): Promise<void> {
  const content = loadContent();
  const started = process.hrtime.bigint();
  const stats = args.shards > 1 ? await runShards(args) : collectRuns(args, content);
  if (args.json) {
    process.stdout.write(JSON.stringify(stats));
    return;
  }

  const elapsed = (Number(process.hrtime.bigint() - started) / 1e9).toFixed(1);
  printStats(
    stats,
    content,
    `Забегов: ${stats.runs} · матчей: ${stats.matches} · профиль ${args.profile} · сид ${args.seed} · ${elapsed} с`,
  );
  if (args.out !== null) {
    writeFileSync(args.out, JSON.stringify(stats, null, 2), 'utf8');
    console.log(`\nОтчёт записан в ${args.out}`);
  }
}

function collectRuns(args: Args, content: ContentRegistry): RunStats {
  const profile = profileByName(content, args.profile);
  let stats = emptyStats();
  for (let i = 0; i < args.runs; i++) {
    const seed = args.seed + i;
    const { run, matches, swaps } = playRun({ seed, content, profileA: profile, profileB: profile });
    if (matches.length !== run.history.length) {
      console.error(`run ${seed}: ${matches.length} battles but ${run.history.length} results`);
    }
    const next = emptyStats();
    addRun(next, run, matches, swaps, content);
    stats = mergeStats(stats, next);
  }
  return stats;
}

/** The same simulation in child processes, each with its own block of seeds. */
async function runShards(args: Args): Promise<RunStats> {
  const shard = (index: number): Promise<RunStats> =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          ...process.execArgv,
          process.argv[1] ?? '',
          '--mode',
          'draft',
          '--runs',
          String(args.runs),
          '--seed',
          String(args.seed + index * 10007),
          '--profile',
          args.profile,
          '--json',
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
      child.on('close', (code) => {
        if (code !== 0) reject(new Error(`shard ${index} exited with ${code}`));
        else resolve(JSON.parse(out) as RunStats);
      });
    });
  const parts = await Promise.all(Array.from({ length: args.shards }, (_, i) => shard(i)));
  return parts.reduce(mergeStats, emptyStats());
}

void main();
