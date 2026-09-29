/**
 * What the shapes on the board mean. Without it, a dark hex with a ring is just a
 * dark hex with a ring. Terrain drawn with tiles shows the same tile here; the rest
 * keeps a CSS swatch in the colours of its vector shape.
 */

import { terrainSwatchStyle } from '../assets/sprites.js';
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
            <span
              className={`legend-tile legend-${entry.key}`}
              style={terrainSwatchStyle(entry.key, 16) ?? undefined}
              aria-hidden="true"
            />
            <span className="legend-name">{entry.name}</span>
            <span className="dim">{entry.short}</span>
          </li>
        ))}
      </ul>
      <p className="dim legend-hint">{UI.legendHint}</p>
    </section>
  );
}
