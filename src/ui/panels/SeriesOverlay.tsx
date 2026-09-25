/**
 * The overlays between matches of a run and at its end.
 *
 * Between matches: who won, the score, and what the coming level does to each of the
 * player's heroes, stat by stat, straight from statsAtLevel. At the end: the verdict
 * and every match of the series.
 */

import type { ContentRegistry, RunState, Side, StatName } from '../../core/index.js';
import {
  STAT_NAMES,
  heroLevel,
  otherSide,
  runWinner,
  statsAtLevel,
  teamOf,
} from '../../core/index.js';
import { nextMatch, startRun, toMenu } from '../store.js';
import { UI, matchTitle, roundsText, victoryText } from '../strings.ru.js';
import { ClassIcon } from './ClassIcon.js';

function formatStat(stat: StatName, value: number): string {
  return stat === 'critChance' ? `${Math.round(value * 100)}%` : String(value);
}

/** Each of the player's heroes, with the stats the next level raises. */
function LevelUp({
  run,
  side,
  content,
}: {
  run: RunState;
  side: Side;
  content: ContentRegistry;
}): JSX.Element {
  const level = heroLevel(run);
  return (
    <ul className="level-up">
      {teamOf(run.draft, side).map((hero) => {
        const now = statsAtLevel(hero, level, content);
        const next = statsAtLevel(hero, level + 1, content);
        const grown = STAT_NAMES.filter((s) => next[s] !== now[s]);
        return (
          <li key={hero.id}>
            <ClassIcon classId={hero.classId} size={28} />
            <strong>{hero.name}</strong>
            <span className="level-changes">
              {grown.map((stat) => (
                <span key={stat}>
                  {UI.stats[stat]} {formatStat(stat, now[stat])} →{' '}
                  <b>{formatStat(stat, next[stat])}</b>
                </span>
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Score({ run, you }: { run: RunState; you: Side }): JSX.Element {
  return (
    <p className="big-score">
      <span className="score-you">{run.wins[you]}</span>
      <span className="dim"> : </span>
      <span className="score-enemy">{run.wins[otherSide(you)]}</span>
    </p>
  );
}

export function MatchOverOverlay({
  run,
  you,
  content,
}: {
  run: RunState;
  you: Side;
  content: ContentRegistry;
}): JSX.Element {
  const last = run.history[run.history.length - 1];
  const won = last?.winner === you;

  return (
    <div className="overlay">
      <div className="overlay-card overlay-wide">
        <p className="dim">{matchTitle(last?.match ?? run.match)}</p>
        <h1 className={won ? 'won' : 'lost'}>{won ? UI.matchOver.won : UI.matchOver.lost}</h1>
        {last === undefined ? null : (
          <p>
            {victoryText(last.reason, won)} · {roundsText(last.rounds)}
          </p>
        )}
        <Score run={run} you={you} />

        <h2>
          {UI.matchOver.levelUp} {heroLevel(run) + 1}
        </h2>
        <LevelUp run={run} side={you} content={content} />
        <p className="dim">{UI.matchOver.healed}</p>

        <div className="overlay-buttons">
          <button type="button" className="primary" onClick={nextMatch}>
            {UI.matchOver.next}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RunOverOverlay({
  run,
  you,
  content,
}: {
  run: RunState;
  you: Side;
  content: ContentRegistry;
}): JSX.Element {
  const won = runWinner(run, content) === you;

  return (
    <div className="overlay">
      <div className="overlay-card overlay-wide">
        <h1 className={won ? 'won' : 'lost'}>{won ? UI.runOver.won : UI.runOver.lost}</h1>
        <Score run={run} you={you} />

        <h2>{UI.runOver.history}</h2>
        <ol className="match-history">
          {run.history.map((m) => (
            <li key={m.match} className={m.winner === you ? 'won' : 'lost'}>
              {matchTitle(m.match)}: {m.winner === you ? UI.victory : UI.defeat} ·{' '}
              {roundsText(m.rounds)}
            </li>
          ))}
        </ol>
        <p className="dim">
          {UI.seed}: {run.seed}
        </p>

        <div className="overlay-buttons">
          <button type="button" className="primary" onClick={() => startRun()}>
            {UI.runOver.newRun}
          </button>
          <button type="button" onClick={toMenu}>
            {UI.toMenu}
          </button>
        </div>
      </div>
    </div>
  );
}
