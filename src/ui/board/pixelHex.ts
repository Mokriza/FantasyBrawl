/**
 * Hex to pixel and back. This lives in ui, not in core: pixels are not rules.
 * Flat-top layout, see docs/ai/hex-grid.md.
 */

import type { Arena, Hex } from '../../core/index.js';
import { allHexes } from '../../core/index.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function hexToPixel(h: Hex, size: number): Point {
  return {
    x: size * (3 / 2) * h.q,
    y: size * Math.sqrt(3) * (h.r + h.q / 2),
  };
}

function cubeRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;
  return { q: rq, r: rr };
}

export function pixelToHex(x: number, y: number, size: number): Hex {
  const q = ((2 / 3) * x) / size;
  const r = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / size;
  return cubeRound(q, r);
}

/** The six corners of a flat-top hex, relative to its centre. */
export function hexCorners(size: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    out.push({ x: size * Math.cos(angle), y: size * Math.sin(angle) });
  }
  return out;
}

export interface BoardMetrics {
  readonly width: number;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** How big the board is in pixels, and how far to shift it so nothing is clipped. */
export function boardMetrics(arena: Arena, size: number): BoardMetrics {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // A flat-topped hex is 2 × size wide but only sqrt(3) × size tall.
  const halfHeight = (Math.sqrt(3) / 2) * size;
  for (const h of allHexes(arena)) {
    const p = hexToPixel(h, size);
    minX = Math.min(minX, p.x - size);
    maxX = Math.max(maxX, p.x + size);
    minY = Math.min(minY, p.y - halfHeight);
    maxY = Math.max(maxY, p.y + halfHeight);
  }

  const pad = 8;
  return {
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    offsetX: -minX + pad,
    offsetY: -minY + pad,
  };
}
