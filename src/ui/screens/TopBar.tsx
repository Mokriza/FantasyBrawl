/** The strip across the top: where the run stands, the seed, playback speed, the way out. */

import { useSyncExternalStore } from 'react';
import { heroLevel, holdToWin, otherSide } from '../../core/index.js';
import { OnlineBanner, OnlineClock } from '../panels/Online.js';
import { onSoundChange, setSoundEnabled, soundEnabled } from '../sound.js';
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

/** Out to the menu; walking out of an online game in progress hands it to the opponent. */
function leave(ui: UiState): void {
  const online = ui.online;
  const playing = online !== null && ui.run !== null && online.ended === null && ui.run.phase !== 'finished';
  if (playing && !window.confirm(UI.online.leaveConfirm)) return;
  toMenu();
}

export function TopBar({ ui, status, busy }: Props): JSX.Element {
  const run = ui.run;
  const you = ui.playerSide;
  const online = ui.online;
  const sound = useSyncExternalStore(onSoundChange, soundEnabled, soundEnabled);

  return (
    <>
    <header className="topbar">
      <h1>{UI.appTitle}</h1>

      {online === null || online.names === null ? null : (
        <span className="dim">
          {online.names[you]} {UI.online.vs} <b>{online.names[otherSide(you)]}</b>
        </span>
      )}

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

      {online === null ? null : <OnlineClock online={online} you={you} />}

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

      <button
        type="button"
        className={`sound-toggle${sound ? ' speed-on' : ''}`}
        title={sound ? UI.soundOn : UI.soundOff}
        aria-pressed={sound}
        onClick={() => setSoundEnabled(!sound)}
      >
        {sound ? '🔊' : '🔇'} {UI.sound}
      </button>

      <button type="button" className="new-battle" onClick={() => leave(ui)}>
        {UI.toMenu}
      </button>
    </header>
    {online === null ? null : <OnlineBanner online={online} />}
    </>
  );
}
