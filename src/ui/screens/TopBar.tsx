/** The strip across the top: where the run stands, the seed, playback speed, the way out. */

import { heroLevel, holdToWin, otherSide } from '../../core/index.js';
import { setSpeed, toMenu } from '../store.js';
import type { Speed, UiState } from '../store.js';
import { UI, matchTitle } from '../strings.ru.js';

const SPEEDS: readonly Speed[] = [1, 2, 4, 0];

interface Props {
  readonly ui: UiState;
  /** What is happening right now, such as "Ваш ход". */
  readonly status?: string;
  readonly busy?: boolean;
}

export function TopBar({ ui, status, busy }: Props): JSX.Element {
  const run = ui.run;
  const you = ui.playerSide;

  return (
    <header className="topbar">
      <h1>{UI.appTitle}</h1>

      {run === null ? null : (
        <span className="series" title={UI.series.score}>
          <span className="dim">{matchTitle(run.match)}</span>
          <span className="score">
            <span className="score-you">{run.wins[you]}</span>
            <span className="dim">:</span>
            <span className="score-enemy">{run.wins[otherSide(you)]}</span>
          </span>
          <span className="dim">
            {UI.series.levelLong} {heroLevel(run)}
          </span>
        </span>
      )}

      {/* The arena modifier of this match, or of the next one while it is announced. */}
      {run === null || run.modifier === null || run.phase === 'matchOver' || run.phase === 'finished' ? null : (
        <span className="modifier-chip" title={ui.content.arenaModifiers[run.modifier]?.description}>
          {UI.modifier}: {ui.content.arenaModifiers[run.modifier]?.name ?? run.modifier}
        </span>
      )}

      {/* "Точка силы": how many rounds each side has held the centre. */}
      {ui.battle === null || holdToWin(ui.battle, ui.content) === null ? null : (
        <span className="modifier-chip" title={UI.holdHint}>
          {UI.hold}: {ui.battle.hold[you]} : {ui.battle.hold[otherSide(you)]} / {holdToWin(ui.battle, ui.content)}
        </span>
      )}

      {status === undefined ? null : (
        <span className={`turn-indicator${busy === true ? ' busy' : ''}`}>{status}</span>
      )}

      <span className="dim">
        {UI.seed}: {ui.seed}
      </span>

      <div className="speed">
        <span className="dim">{UI.speed}</span>
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            className={ui.speed === value ? 'speed-on' : undefined}
            onClick={() => setSpeed(value)}
          >
            {value === 0 ? UI.speedInstant : `×${value}`}
          </button>
        ))}
      </div>

      <button type="button" className="new-battle" onClick={toMenu}>
        {UI.toMenu}
      </button>
    </header>
  );
}
