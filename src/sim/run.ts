/**
 * Balance simulation. Runs headless in Node through tsx, no browser anywhere.
 *
 *   npm run sim -- --matches 1000 --seed 42 --profile normal --out sim-report.json
 *   npm run sim -- --mode draft --runs 200 --seed 1   whole runs: draft, placement, series
 *   npm run sim -- --mode tournament --a veteran --b normal --matches 400   profile against profile
 */

import { writeFileSync } from 'node:fs';
import { loadContent, loadTeams } from '../content/load.js';
import { profileByName } from '../ai/index.js';
import { playMatch } from './match.js';
import { playRun } from './series.js';

interface Args {
  mode: 'match' | 'draft' | 'tournament';
  a: string;
  b: string;
  matches: number;
  runs: number;
  seed: number;
  profile: string;
  out: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { mode: 'match', a: 'veteran', b: 'normal', matches: 200, runs: 100, seed: 1, profile: 'normal', out: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--matches' && value !== undefined) args.matches = Number(value);
    if (key === '--seed' && value !== undefined) args.seed = Number(value);
    if (key === '--profile' && value !== undefined) args.profile = value;
    if (key === '--out' && value !== undefined) args.out = value;
    if (key === '--runs' && value !== undefined) args.runs = Number(value);
    if (key === '--mode' && (value === 'match' || value === 'draft' || value === 'tournament')) args.mode = value;
    if (key === '--a' && value !== undefined) args.a = value;
    if (key === '--b' && value !== undefined) args.b = value;
  }
  return args;
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'draft') {
    simulateRuns(args);
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
 */
function simulateRuns(args: Args): void {
  const content = loadContent();
  const profile = profileByName(content, args.profile);
  const started = process.hrtime.bigint();

  const runWins: Record<string, number> = { A: 0, B: 0 };
  const matchWins: Record<string, number> = { A: 0, B: 0 };
  const lengths: Record<number, number> = {};
  const picksByClass: Record<string, number> = {};
  const runWinsByClass: Record<string, number> = {};
  const firstPickByClass: Record<string, number> = {};
  const roundsByMatch: Record<number, number[]> = {};
  let matches = 0;
  let roundLimit = 0;
  let swaps = 0;
  let upgradePhases = 0;
  // Catch-up check from the design document: after 0-2, how often the side behind
  // takes the third match. Below 35% the compensation needs strengthening.
  let behindAtTwo = 0;
  // Matches by arena modifier: how long, and how often to the round limit.
  const byModifier: Record<string, { matches: number; rounds: number; limit: number }> = {};
  let holdWins = 0;
  let guardianMatches = 0;
  let guardianKills = 0;
  let behindWonThird = 0;

  for (let i = 0; i < args.runs; i++) {
    const seed = args.seed + i;
    const { run, matches: played, swaps: swapped } = playRun({ seed, content, profileA: profile, profileB: profile });
    swaps += swapped;
    for (const match of played) {
      if (match.state.heroes.guardian === undefined) continue;
      guardianMatches++;
      if (match.state.loot.length > 0) guardianKills++;
    }
    upgradePhases += 2 * Math.max(0, run.history.length - 1);
    const [m1, m2, m3] = run.history;
    if (m1 !== undefined && m2 !== undefined && m3 !== undefined && m1.winner === m2.winner) {
      behindAtTwo++;
      if (m3.winner !== m1.winner) behindWonThird++;
    }
    const winner = run.wins.A > run.wins.B ? 'A' : 'B';
    runWins[winner] = (runWins[winner] ?? 0) + 1;
    lengths[run.history.length] = (lengths[run.history.length] ?? 0) + 1;

    for (const record of run.history) {
      matches++;
      matchWins[record.winner] = (matchWins[record.winner] ?? 0) + 1;
      if (record.reason === 'roundLimit') roundLimit++;
      (roundsByMatch[record.match] ??= []).push(record.rounds);
      const mod = (byModifier[record.modifier ?? 'none'] ??= { matches: 0, rounds: 0, limit: 0 });
      mod.matches++;
      mod.rounds += record.rounds;
      if (record.reason === 'roundLimit') mod.limit++;
      if (record.reason === 'hold') holdWins++;
    }
    for (const side of ['A', 'B'] as const) {
      for (const id of run.draft.picks[side]) {
        const hero = run.draft.pool.find((h) => h.id === id);
        if (hero === undefined) continue;
        picksByClass[hero.classId] = (picksByClass[hero.classId] ?? 0) + 1;
        if (side === winner) runWinsByClass[hero.classId] = (runWinsByClass[hero.classId] ?? 0) + 1;
      }
    }
    const first = run.draft.pool.find((h) => h.id === run.draft.picks.A[0]);
    if (first !== undefined) {
      firstPickByClass[first.classId] = (firstPickByClass[first.classId] ?? 0) + 1;
    }
    if (played.length !== run.history.length) {
      console.error(`run ${seed}: ${played.length} battles but ${run.history.length} results`);
    }
  }

  const elapsed = (Number(process.hrtime.bigint() - started) / 1e9).toFixed(1);
  const runs = args.runs;
  const allRounds = Object.values(roundsByMatch).flat();
  const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

  console.log(`\nЗабегов: ${runs} · матчей: ${matches} · профиль ${args.profile} · сид ${args.seed} · ${elapsed} с`);
  console.log(`Винрейт первого драфтующего (A) по забегам: ${percent(runWins.A ?? 0, runs)} (цель 48–52%)`);
  console.log(`Побед A по отдельным матчам: ${percent(matchWins.A ?? 0, matches)}`);
  console.log(
    `Длина серии: 3 матча ${percent(lengths[3] ?? 0, runs)}, 4 — ${percent(lengths[4] ?? 0, runs)}, 5 — ${percent(lengths[5] ?? 0, runs)}`,
  );
  console.log(`Средняя длина матча: ${mean(allRounds).toFixed(1)} раундов (цель 8–12)`);
  for (const [n, rounds] of Object.entries(roundsByMatch)) {
    console.log(`  матч ${n} (уровень ${n}): ${mean(rounds).toFixed(1)} раундов, ${rounds.length} шт.`);
  }
  console.log(`Матчей по лимиту раундов: ${percent(roundLimit, matches)} (цель < 3%)`);
  console.log(`Отстающий при 0–2 берёт 3-й матч: ${percent(behindWonThird, behindAtTwo)} из ${behindAtTwo} (цель ≥ 35%)`);
  console.log(`Замен героя: ${percent(swaps, upgradePhases)} фаз усиления одной стороны`);
  console.log(`Побед удержанием точки: ${holdWins} · страж убит в ${guardianKills} из ${guardianMatches} матчей`);
  console.log('Модификаторы арены: матчей · раундов в среднем · по лимиту');
  for (const [id, m] of Object.entries(byModifier).sort()) {
    console.log(`  мод ${id} ${m.matches} · ${(m.rounds / m.matches).toFixed(1)} · ${percent(m.limit, m.matches)}`);
  }

  console.log('\nКлассы в драфте: доля пиков · винрейт забега · первым пиком');
  const totalPicks = Object.values(picksByClass).reduce((s, x) => s + x, 0);
  // Summon-only classes are never drafted, so they have no row.
  for (const cls of Object.values(content.classes).filter((c) => c.summonOnly !== true).map((c) => c.id)) {
    const picks = picksByClass[cls] ?? 0;
    console.log(
      `  ${cls.padEnd(10)} ${percent(picks, totalPicks).padStart(6)} · ${percent(runWinsByClass[cls] ?? 0, picks).padStart(6)} · ${firstPickByClass[cls] ?? 0}`,
    );
  }

  if (args.out !== null) {
    const report = { runs, matches, seed: args.seed, profile: args.profile, runWins, matchWins, lengths, roundsByMatch, picksByClass, runWinsByClass, roundLimit, behindAtTwo, behindWonThird, swaps, upgradePhases, byModifier };
    writeFileSync(args.out, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nОтчёт записан в ${args.out}`);
  }
}

main();
