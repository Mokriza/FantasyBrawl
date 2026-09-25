/**
 * The main menu: a new run or a quick battle, the opponent's difficulty, and an
 * optional seed so a run can be replayed exactly.
 */

import { useState } from 'react';
import { DIFFICULTIES, setDifficulty, startQuickBattle, startRun, useUi } from '../store.js';
import { UI } from '../strings.ru.js';

function parseSeed(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function MainMenu(): JSX.Element {
  const ui = useUi();
  const [seedText, setSeedText] = useState('');
  const seed = parseSeed(seedText);
  const invalid = seedText.trim() !== '' && seed === undefined;

  return (
    <main className="menu">
      <div className="menu-card">
        <h1>{UI.appTitle}</h1>
        <p className="dim">{UI.menu.subtitle}</p>

        <button type="button" className="primary menu-button" onClick={() => startRun(seed)}>
          <strong>{UI.menu.newRun}</strong>
          <span>{UI.menu.newRunHint}</span>
        </button>

        <button type="button" className="menu-button" onClick={() => startQuickBattle(seed)}>
          <strong>{UI.menu.quickBattle}</strong>
          <span>{UI.menu.quickBattleHint}</span>
        </button>

        <div className="menu-difficulty" role="radiogroup" aria-label={UI.menu.difficulty}>
          <span className="dim">{UI.menu.difficulty}</span>
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={ui.difficulty === d}
              className={ui.difficulty === d ? 'speed-on' : undefined}
              title={UI.menu.difficulties[d].hint}
              onClick={() => setDifficulty(d)}
            >
              {UI.menu.difficulties[d].name}
            </button>
          ))}
        </div>

        <label className="menu-seed" title={UI.menu.seedHint}>
          <span className="dim">{UI.menu.seedLabel}</span>
          <input
            type="text"
            inputMode="numeric"
            value={seedText}
            placeholder={UI.menu.seedPlaceholder}
            className={invalid ? 'invalid' : undefined}
            onChange={(event) => setSeedText(event.target.value)}
          />
        </label>
      </div>
    </main>
  );
}
