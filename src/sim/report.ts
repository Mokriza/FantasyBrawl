/**
 * The balance report of whole runs: plain counters that add up, so parallel shards
 * can be merged exactly, and one printer. The metrics and their targets are those of
 * docs/ai/testing-and-simulation.md.
 *
 * Win rates by class, role, race, passive, artifact and perk are counted per hero per
 * match: a hero who played a match counts once, as a win if its side took the match.
 */

import type { BattleState, ContentRegistry, RunState } from '../core/index.js';
import { getClass } from '../core/index.js';
import type { MatchResult } from './match.js';

export interface Tally {
  n: number;
  wins: number;
}

export interface RunStats {
  runs: number;
  runWinsA: number;
  matches: number;
  matchWinsA: number;
  /** Series length in matches → runs. */
  lengths: Record<string, number>;
  /** Match number → total rounds and matches. */
  roundsByMatch: Record<string, Tally>;
  rounds: number;
  roundLimit: number;
  swaps: number;
  upgradePhases: number;
  behindAtTwo: number;
  behindWonThird: number;
  holdWins: number;
  guardianMatches: number;
  guardianKills: number;
  byModifier: Record<string, { matches: number; rounds: number; limit: number }>;
  /** Class → drafted heroes at the end of the run, and how many were on the winning side. */
  classRuns: Record<string, Tally>;
  firstPick: Record<string, number>;
  byClass: Record<string, Tally>;
  byRole: Record<string, Tally>;
  byRace: Record<string, Tally>;
  byPassive: Record<string, Tally>;
  byItem: Record<string, Tally>;
  byPerk: Record<string, Tally>;
  /** Ability → matches a hero carried it, and matches it was used at least once. */
  abilities: Record<string, { carried: number; used: number }>;
  turns: number;
  turnsLostToControl: number;
}

export function emptyStats(): RunStats {
  return {
    runs: 0,
    runWinsA: 0,
    matches: 0,
    matchWinsA: 0,
    lengths: {},
    roundsByMatch: {},
    rounds: 0,
    roundLimit: 0,
    swaps: 0,
    upgradePhases: 0,
    behindAtTwo: 0,
    behindWonThird: 0,
    holdWins: 0,
    guardianMatches: 0,
    guardianKills: 0,
    byModifier: {},
    classRuns: {},
    firstPick: {},
    byClass: {},
    byRole: {},
    byRace: {},
    byPassive: {},
    byItem: {},
    byPerk: {},
    abilities: {},
    turns: 0,
    turnsLostToControl: 0,
  };
}

function count(table: Record<string, Tally>, key: string, won: boolean): void {
  const entry = (table[key] ??= { n: 0, wins: 0 });
  entry.n++;
  if (won) entry.wins++;
}

/** One finished match: every hero that played it, what it carried and what it used. */
function addMatch(stats: RunStats, state: BattleState, events: MatchResult['events'], content: ContentRegistry): void {
  const winner = state.outcome?.winner;
  const used = new Set<string>();
  for (const event of events) {
    if (event.type === 'abilityUsed') used.add(`${event.heroId}:${event.abilityId}`);
    if (event.type === 'turnStarted') stats.turns++;
    if (event.type === 'turnSkipped') stats.turnsLostToControl++;
  }
  for (const hero of Object.values(state.heroes)) {
    if (hero.summon !== null || hero.side === 'N') continue;
    const won = hero.side === winner;
    count(stats.byClass, hero.classId, won);
    count(stats.byRole, getClass(content, hero.classId).role, won);
    if (hero.race !== null) count(stats.byRace, hero.race, won);
    if (hero.passive !== null) count(stats.byPassive, hero.passive, won);
    if (hero.item !== null) count(stats.byItem, hero.item, won);
    for (const pick of hero.perks) count(stats.byPerk, pick.perkId, won);
    for (const id of hero.abilities) {
      if (content.abilities[id]?.basic === true) continue;
      const entry = (stats.abilities[id] ??= { carried: 0, used: 0 });
      entry.carried++;
      if (used.has(`${hero.id}:${id}`)) entry.used++;
    }
  }
}

export function addRun(
  stats: RunStats,
  run: RunState,
  played: readonly MatchResult[],
  swaps: number,
  content: ContentRegistry,
): void {
  stats.runs++;
  stats.swaps += swaps;
  stats.upgradePhases += 2 * Math.max(0, run.history.length - 1);
  const winner = run.wins.A > run.wins.B ? 'A' : 'B';
  if (winner === 'A') stats.runWinsA++;
  stats.lengths[String(run.history.length)] = (stats.lengths[String(run.history.length)] ?? 0) + 1;

  const [m1, m2, m3] = run.history;
  if (m1 !== undefined && m2 !== undefined && m3 !== undefined && m1.winner === m2.winner) {
    stats.behindAtTwo++;
    if (m3.winner !== m1.winner) stats.behindWonThird++;
  }

  for (const record of run.history) {
    stats.matches++;
    if (record.winner === 'A') stats.matchWinsA++;
    stats.rounds += record.rounds;
    if (record.reason === 'roundLimit') stats.roundLimit++;
    if (record.reason === 'hold') stats.holdWins++;
    const byMatch = (stats.roundsByMatch[String(record.match)] ??= { n: 0, wins: 0 });
    byMatch.n++;
    byMatch.wins += record.rounds;
    const mod = (stats.byModifier[record.modifier ?? 'none'] ??= { matches: 0, rounds: 0, limit: 0 });
    mod.matches++;
    mod.rounds += record.rounds;
    if (record.reason === 'roundLimit') mod.limit++;
  }

  for (const match of played) {
    if (match.state.heroes.guardian !== undefined) {
      stats.guardianMatches++;
      if (match.state.loot.length > 0) stats.guardianKills++;
    }
    addMatch(stats, match.state, match.events, content);
  }

  for (const side of ['A', 'B'] as const) {
    for (const id of run.draft.picks[side]) {
      const hero = run.draft.pool.find((h) => h.id === id);
      if (hero !== undefined) count(stats.classRuns, hero.classId, side === winner);
    }
  }
  const first = run.draft.pool.find((h) => h.id === run.draft.picks.A[0]);
  if (first !== undefined) stats.firstPick[first.classId] = (stats.firstPick[first.classId] ?? 0) + 1;
}

function mergeTallies(a: Record<string, Tally>, b: Record<string, Tally>): Record<string, Tally> {
  const out: Record<string, Tally> = { ...a };
  for (const [key, t] of Object.entries(b)) {
    const base = out[key] ?? { n: 0, wins: 0 };
    out[key] = { n: base.n + t.n, wins: base.wins + t.wins };
  }
  return out;
}

function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [key, v] of Object.entries(b)) out[key] = (out[key] ?? 0) + v;
  return out;
}

export function mergeStats(a: RunStats, b: RunStats): RunStats {
  const modifiers = { ...a.byModifier };
  for (const [key, m] of Object.entries(b.byModifier)) {
    const base = modifiers[key] ?? { matches: 0, rounds: 0, limit: 0 };
    modifiers[key] = { matches: base.matches + m.matches, rounds: base.rounds + m.rounds, limit: base.limit + m.limit };
  }
  const abilities = { ...a.abilities };
  for (const [key, u] of Object.entries(b.abilities)) {
    const base = abilities[key] ?? { carried: 0, used: 0 };
    abilities[key] = { carried: base.carried + u.carried, used: base.used + u.used };
  }
  return {
    runs: a.runs + b.runs,
    runWinsA: a.runWinsA + b.runWinsA,
    matches: a.matches + b.matches,
    matchWinsA: a.matchWinsA + b.matchWinsA,
    lengths: mergeCounts(a.lengths, b.lengths),
    roundsByMatch: mergeTallies(a.roundsByMatch, b.roundsByMatch),
    rounds: a.rounds + b.rounds,
    roundLimit: a.roundLimit + b.roundLimit,
    swaps: a.swaps + b.swaps,
    upgradePhases: a.upgradePhases + b.upgradePhases,
    behindAtTwo: a.behindAtTwo + b.behindAtTwo,
    behindWonThird: a.behindWonThird + b.behindWonThird,
    holdWins: a.holdWins + b.holdWins,
    guardianMatches: a.guardianMatches + b.guardianMatches,
    guardianKills: a.guardianKills + b.guardianKills,
    byModifier: modifiers,
    classRuns: mergeTallies(a.classRuns, b.classRuns),
    firstPick: mergeCounts(a.firstPick, b.firstPick),
    byClass: mergeTallies(a.byClass, b.byClass),
    byRole: mergeTallies(a.byRole, b.byRole),
    byRace: mergeTallies(a.byRace, b.byRace),
    byPassive: mergeTallies(a.byPassive, b.byPassive),
    byItem: mergeTallies(a.byItem, b.byItem),
    byPerk: mergeTallies(a.byPerk, b.byPerk),
    abilities,
    turns: a.turns + b.turns,
    turnsLostToControl: a.turnsLostToControl + b.turnsLostToControl,
  };
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;
}

/** Rows of a win-rate table, most played first; names from content where known. */
function tallyRows(table: Record<string, Tally>, name: (id: string) => string, minN = 0): string[] {
  return Object.entries(table)
    .filter(([, t]) => t.n >= minN)
    .sort((x, y) => y[1].n - x[1].n)
    .map(([id, t]) => `  ${name(id).padEnd(28)} ${String(t.n).padStart(6)} · ${percent(t.wins, t.n).padStart(6)}`);
}

export function printStats(stats: RunStats, content: ContentRegistry, header: string): void {
  const c = content;
  const nameOf = (id: string): string =>
    c.classes[id]?.name ??
    c.races[id]?.name ??
    c.passives[id]?.name ??
    c.items[id]?.name ??
    c.perks[id]?.name ??
    c.abilities[id]?.name ??
    c.arenaModifiers[id]?.name ??
    id;
  const roleNames: Record<string, string> = { tank: 'Танк', melee: 'Ближний бой', ranged: 'Дальний бой', support: 'Поддержка' };

  console.log(`\n${header}`);
  console.log(`Винрейт первого драфтующего (A) по забегам: ${percent(stats.runWinsA, stats.runs)} (цель 48–52%)`);
  console.log(`Побед A по отдельным матчам: ${percent(stats.matchWinsA, stats.matches)}`);
  console.log(
    `Длина серии: 3 матча ${percent(stats.lengths['3'] ?? 0, stats.runs)}, 4 — ${percent(stats.lengths['4'] ?? 0, stats.runs)}, 5 — ${percent(stats.lengths['5'] ?? 0, stats.runs)}`,
  );
  console.log(`Средняя длина матча: ${(stats.rounds / Math.max(1, stats.matches)).toFixed(1)} раундов (цель 8–12)`);
  for (const [n, t] of Object.entries(stats.roundsByMatch).sort()) {
    console.log(`  матч ${n}: ${(t.wins / Math.max(1, t.n)).toFixed(1)} раундов, ${t.n} шт.`);
  }
  console.log(`Матчей по лимиту раундов: ${percent(stats.roundLimit, stats.matches)} (цель < 3%)`);
  console.log(`Ходов, потерянных на контроль: ${percent(stats.turnsLostToControl, stats.turns)} (цель < 12%)`);
  console.log(`Отстающий при 0–2 берёт 3-й матч: ${percent(stats.behindWonThird, stats.behindAtTwo)} из ${stats.behindAtTwo} (цель ≥ 35%)`);
  console.log(`Замен героя: ${percent(stats.swaps, stats.upgradePhases)} фаз усиления одной стороны`);
  console.log(`Побед удержанием точки: ${stats.holdWins} · страж убит в ${stats.guardianKills} из ${stats.guardianMatches} матчей`);

  console.log('\nМодификаторы арены: матчей · раундов в среднем · по лимиту');
  for (const [id, m] of Object.entries(stats.byModifier).sort()) {
    console.log(`  ${(id === 'none' ? 'без модификатора' : nameOf(id)).padEnd(28)} ${m.matches} · ${(m.rounds / m.matches).toFixed(1)} · ${percent(m.limit, m.matches)}`);
  }

  console.log('\nКлассы: доля пиков · винрейт забега · винрейт матча · первым пиком (цель 45–55%)');
  const totalPicks = Object.values(stats.classRuns).reduce((s, t) => s + t.n, 0);
  for (const cls of Object.values(c.classes).filter((x) => x.summonOnly !== true)) {
    const runs = stats.classRuns[cls.id] ?? { n: 0, wins: 0 };
    const matches = stats.byClass[cls.id] ?? { n: 0, wins: 0 };
    console.log(
      `  ${cls.name.padEnd(14)} ${percent(runs.n, totalPicks).padStart(6)} · ${percent(runs.wins, runs.n).padStart(6)} · ${percent(matches.wins, matches.n).padStart(6)} · ${stats.firstPick[cls.id] ?? 0}`,
    );
  }

  console.log('\nРоли, винрейт матча (цель 45–55%): героев · побед');
  for (const line of tallyRows(stats.byRole, (id) => roleNames[id] ?? id)) console.log(line);
  console.log('\nРасы: героев · побед');
  for (const line of tallyRows(stats.byRace, nameOf)) console.log(line);
  console.log('\nПассивки (от 30 появлений): героев · побед');
  for (const line of tallyRows(stats.byPassive, nameOf, 30)) console.log(line);
  console.log('\nАртефакты (от 30 появлений): героев · побед');
  for (const line of tallyRows(stats.byItem, nameOf, 30)) console.log(line);
  console.log('\nПерки (от 30 появлений): героев · побед');
  for (const line of tallyRows(stats.byPerk, nameOf, 30)) console.log(line);

  const rare = Object.entries(stats.abilities)
    .filter(([, u]) => u.carried >= 20 && u.used / u.carried < 0.6)
    .sort((x, y) => x[1].used / x[1].carried - y[1].used / y[1].carried);
  console.log(`\nСпособности, применённые меньше чем в 60% матчей, где они были (от 20): ${rare.length}`);
  for (const [id, u] of rare) {
    console.log(`  ${nameOf(id).padEnd(28)} ${percent(u.used, u.carried).padStart(6)} из ${u.carried}`);
  }
}
