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

/** One rectangle cut from a sheet, and where it goes in the finished picture. */
export interface TerrainPart {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly dx: number;
  readonly dy: number;
}

/** How the board paints one kind of terrain, or the floor. See the manifest's "terrain". */
export interface TerrainArt {
  readonly sheet: SheetInfo;
  /** Pictures to choose from, each put together from its parts; picked by hex coordinates. */
  readonly variants: readonly (readonly TerrainPart[])[];
  /** The picture paints the whole hex; otherwise it stands on the floor as a sprite. */
  readonly cover: boolean;
  /** Whole-number scale of a standing picture on the board. */
  readonly scale: number;
}

interface RawTerrain {
  readonly sheet: string;
  readonly cover?: boolean;
  readonly scale?: number;
  readonly variants: readonly (readonly (readonly number[])[])[];
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
  const variants: TerrainPart[][] = [];
  for (const raw of entry.variants) {
    const parts: TerrainPart[] = [];
    for (const [x, y, width, height, dx = 0, dy = 0] of raw) {
      if (x === undefined || y === undefined || width === undefined || height === undefined) continue;
      parts.push({ x, y, width, height, dx, dy });
    }
    if (parts.length > 0) variants.push(parts);
  }
  if (variants.length === 0) return null;
  return { sheet, variants, cover: entry.cover === true, scale: entry.scale ?? 1 };
}

/**
 * One variant put together on a canvas of its own size. With trim, a covering picture
 * loses a pixel row at the top and the bottom: a flat-top hex is 1.15 times as wide as
 * it is tall, and 16 × 14 stretched over it keeps the pixels nearly square.
 */
export function paintVariant(
  image: CanvasImageSource,
  parts: readonly TerrainPart[],
  trim = false,
): HTMLCanvasElement | null {
  const width = Math.max(...parts.map((p) => p.dx + p.width));
  const height = Math.max(...parts.map((p) => p.dy + p.height));
  const cut = trim ? 1 : 0;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height - cut * 2;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.imageSmoothingEnabled = false;
  for (const part of parts) {
    context.drawImage(image, part.x, part.y, part.width, part.height, part.dx, part.dy - cut, part.width, part.height);
  }
  return canvas;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

/** A sheet as an image, loaded once; null if it cannot be loaded. For the React panels. */
export function sheetImage(sheet: SheetInfo): Promise<HTMLImageElement | null> {
  let loading = images.get(sheet.url);
  if (loading === undefined) {
    loading = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = sheet.url;
    });
    images.set(sheet.url, loading);
  }
  return loading;
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
