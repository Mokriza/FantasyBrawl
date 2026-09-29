/**
 * What the shapes on the board mean. Without it, a dark hex with a ring is just a
 * dark hex with a ring. Each swatch is the board's own picture of the terrain, on the
 * board's floor; a kind without a picture keeps a CSS swatch in its vector colours.
 */

import { useEffect, useRef } from 'react';
import { paintVariant, sheetImage, terrainArt } from '../assets/sprites.js';
import { UI } from '../strings.ru.js';

/** The swatch's own pixels; CSS shows it at the legend's size, without smoothing. */
const SWATCH_PIXELS = 32;

/** Draws a terrain kind as the board does: the floor, then the picture on it. */
function TerrainSwatch({ kind }: { kind: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawn = terrainArt(kind) !== null;

  useEffect(() => {
    let cancelled = false;
    const art = terrainArt(kind);
    const floor = terrainArt('floor');
    void (async () => {
      const canvas = ref.current;
      const context = canvas?.getContext('2d');
      if (art === null || context === null || context === undefined) return;
      context.imageSmoothingEnabled = false;
      const floorImage = floor === null ? null : await sheetImage(floor.sheet);
      const image = await sheetImage(art.sheet);
      if (cancelled || image === null) return;
      const floorParts = floor?.variants[0];
      if (!art.cover && floorImage !== null && floorParts !== undefined) {
        const ground = paintVariant(floorImage, floorParts);
        if (ground !== null) context.drawImage(ground, 0, 0, SWATCH_PIXELS, SWATCH_PIXELS);
      }
      const parts = art.variants[0];
      const picture = parts === undefined ? null : paintVariant(image, parts);
      if (picture === null) return;
      // A covering picture fills the swatch; a standing one keeps its proportions.
      const fit = art.cover ? SWATCH_PIXELS / Math.max(picture.width, picture.height) : Math.min(SWATCH_PIXELS / picture.width, SWATCH_PIXELS / picture.height);
      const width = art.cover ? SWATCH_PIXELS : picture.width * fit;
      const height = art.cover ? SWATCH_PIXELS : picture.height * fit;
      context.drawImage(picture, (SWATCH_PIXELS - width) / 2, (SWATCH_PIXELS - height) / 2, width, height);
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  if (!drawn) return <span className={`legend-tile legend-${kind}`} aria-hidden="true" />;
  return (
    <canvas
      ref={ref}
      className={`legend-tile legend-picture legend-${kind}`}
      width={SWATCH_PIXELS}
      height={SWATCH_PIXELS}
      aria-hidden="true"
    />
  );
}

export function Legend(): JSX.Element {
  return (
    <section className="panel legend">
      <h2>{UI.legend}</h2>
      <ul>
        {UI.terrainLegend.map((entry) => (
          // One line per tile keeps the column no taller than the board; the details
          // are a hover away.
          <li key={entry.key} title={`${entry.movement} · ${entry.sight}`}>
            <TerrainSwatch kind={entry.key} />
            <span className="legend-name">{entry.name}</span>
            <span className="dim">{entry.short}</span>
          </li>
        ))}
      </ul>
      <p className="dim legend-hint">{UI.legendHint}</p>
    </section>
  );
}
