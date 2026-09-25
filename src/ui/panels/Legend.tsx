/**
 * What the shapes on the board mean. Without it, a dark hex with a ring is just a
 * dark hex with a ring.
 */

import { UI } from '../strings.ru.js';

export function Legend(): JSX.Element {
  return (
    <section className="panel legend">
      <h2>{UI.legend}</h2>
      <ul>
        {UI.terrainLegend.map((entry) => (
          // One line per tile keeps the column no taller than the board; the details
          // are a hover away.
          <li key={entry.key} title={`${entry.movement} · ${entry.sight}`}>
            <span className={`legend-tile legend-${entry.key}`} aria-hidden="true" />
            <span className="legend-name">{entry.name}</span>
            <span className="dim">{entry.short}</span>
          </li>
        ))}
      </ul>
      <p className="dim legend-hint">{UI.legendHint}</p>
    </section>
  );
}
