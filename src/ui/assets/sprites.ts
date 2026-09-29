/**
 * Where the pictures are. The only module that knows an image path, and even it
 * reads them from manifest.json rather than hard-coding them, as
 * docs/ai/ui-and-rendering.md requires.
 *
 * A hero figure is a stack of tiles drawn back to front: Kenney's character pack is
 * a builder, so the orc warrior is a green body plus armour plus an axe. Classes
 * whose pack ships a finished figure simply have one layer.
 *
 * Every asset and its licence is recorded in ASSETS.md.
 */

import manifest from './manifest.json' with { type: 'json' };
import { assetUrl } from './url.js';

export interface SheetInfo {
  readonly url: string;
  readonly tileSize: number;
  /** Gap between tiles on the sheet. Kenney's character pack uses 1px. */
  readonly margin: number;
  readonly columns: number;
  readonly rows: number;
}

export interface TileRef {
  readonly row: number;
  readonly col: number;
}

export interface ClassFigure {
  readonly sheet: SheetInfo;
  /** Back to front: body first, weapon last. */
  readonly layers: readonly TileRef[];
  /** Multiplied over the figure, the same way Pixi tints a sprite. */
  readonly tint: string | null;
}

interface RawEntry {
  readonly sheet: string;
  readonly layers: readonly (readonly number[])[];
  readonly tint?: string;
}

const SHEETS: Record<string, SheetInfo> = Object.fromEntries(
  Object.entries(manifest.sheets).map(([id, sheet]) => [id, { ...sheet, url: assetUrl(sheet.url) }]),
);
const FIGURES = manifest.classSprites as unknown as Record<string, RawEntry>;

/** The figure for a class, or null when the manifest has nothing for it. */
export function classFigure(classId: string): ClassFigure | null {
  const entry = FIGURES[classId];
  if (entry === undefined) return null;
  const sheet = SHEETS[entry.sheet];
  if (sheet === undefined) return null;

  const layers: TileRef[] = [];
  for (const layer of entry.layers) {
    const row = layer[0];
    const col = layer[1];
    if (row === undefined || col === undefined) continue;
    layers.push({ row, col });
  }
  return layers.length === 0 ? null : { sheet, layers, tint: entry.tint ?? null };
}

/** How the board paints one kind of terrain, or the floor. */
export interface TerrainArt {
  readonly sheet: SheetInfo;
  /** Variants; the board picks one by the hex coordinates. */
  readonly tiles: readonly TileRef[];
  /** The tile paints the whole hex; otherwise it stands on the floor as a sprite. */
  readonly cover: boolean;
}

interface RawTerrain {
  readonly sheet: string;
  readonly cover: boolean;
  readonly tiles: readonly (readonly number[])[];
}

const TERRAIN = Object.fromEntries(
  Object.entries(manifest.terrain).filter(([key]) => !key.startsWith('_')),
) as unknown as Record<string, RawTerrain>;

/** Every terrain kind the manifest has pictures for ("floor" is the ground itself). */
export function terrainKinds(): string[] {
  return Object.keys(TERRAIN);
}

/** The pictures for a terrain kind, or null when it is drawn as a vector shape. */
export function terrainArt(kind: string): TerrainArt | null {
  const entry = TERRAIN[kind];
  if (entry === undefined) return null;
  const sheet = SHEETS[entry.sheet];
  if (sheet === undefined) return null;
  const tiles: TileRef[] = [];
  for (const tile of entry.tiles) {
    const row = tile[0];
    const col = tile[1];
    if (row !== undefined && col !== undefined) tiles.push({ row, col });
  }
  return tiles.length === 0 ? null : { sheet, tiles, cover: entry.cover };
}

/**
 * CSS for a terrain swatch in the legend, looking as the board draws it: a covering
 * tile alone, a standing one on the floor. Null for kinds drawn as vector shapes.
 */
export function terrainSwatchStyle(kind: string, size: number): Record<string, string> | null {
  const art = terrainArt(kind);
  const first = art?.tiles[0];
  if (art === null || first === undefined) return null;
  const floor = terrainArt('floor')?.tiles[0];
  // Both layers must come from one sheet to share a background size; the floor is
  // left out otherwise, and the tile stands on the panel.
  const layers = !art.cover && floor !== undefined && terrainArt('floor')?.sheet === art.sheet ? [floor, first] : [first];
  return figureBackgroundStyle({ sheet: art.sheet, layers, tint: null }, size);
}

/** Top-left pixel of a tile on its sheet. */
export function tileOrigin(sheet: SheetInfo, ref: TileRef): { x: number; y: number } {
  const stride = sheet.tileSize + sheet.margin;
  return { x: ref.col * stride, y: ref.row * stride };
}

/**
 * CSS for showing the whole figure as stacked backgrounds, used by the React panels.
 * The board uses Pixi textures instead; see ui/board/render.ts.
 */
export function figureBackgroundStyle(
  figure: ClassFigure,
  size: number,
): Record<string, string> {
  const { sheet } = figure;
  const scale = size / sheet.tileSize;
  const sheetWidth = (sheet.columns * (sheet.tileSize + sheet.margin) - sheet.margin) * scale;
  const sheetHeight = (sheet.rows * (sheet.tileSize + sheet.margin) - sheet.margin) * scale;

  // CSS paints the first background layer on top, so the order is reversed here.
  const ordered = [...figure.layers].reverse();

  return {
    backgroundImage: ordered.map(() => `url(${sheet.url})`).join(', '),
    backgroundPosition: ordered
      .map((ref) => {
        const origin = tileOrigin(sheet, ref);
        return `-${origin.x * scale}px -${origin.y * scale}px`;
      })
      .join(', '),
    backgroundSize: ordered.map(() => `${sheetWidth}px ${sheetHeight}px`).join(', '),
    width: `${size}px`,
    height: `${size}px`,
    // Pixel art must not be smoothed, or it turns to mush at these sizes.
    imageRendering: 'pixelated',
  };
}
