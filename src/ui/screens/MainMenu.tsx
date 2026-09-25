/**
 * The main menu: a new run or a quick battle, with an optional seed so a run can be
 * replayed exactly. AI difficulty will join it once the other profiles are tuned
 * (stage 5); until then there is only "normal".
 */

import { useState } from 'react';
import { startQuickBattle, startRun } from '../store.js';
import { UI } from '../strings.ru.js';

function parseSeed(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function MainMenu(): JSX.Element {
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
