/**
 * Hex geometry, see docs/ai/hex-grid.md.
 *
 * Flat-top hexes. Game logic is always in axial coordinates {q, r}; the odd-q offset
 * rectangle exists only to lay out the board and to draw it.
 */

export interface Hex {
  readonly q: number;
  readonly r: number;
}

/**
 * Clockwise from north-east. The order is fixed: several tie-breaks in the rules
 * resolve by direction index, so changing it changes the game.
 */
export const DIRECTIONS: readonly Hex[] = [
  { q: +1, r: -1 },
  { q: +1, r: 0 },
  { q: 0, r: +1 },
  { q: -1, r: +1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
];

export function hex(q: number, r: number): Hex {
  return { q, r };
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexSubtract(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Key for Record/Map. Hex objects compare by reference, so never use them as keys. */
export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function parseHexKey(key: string): Hex {
  const parts = key.split(',');
  const q = Number(parts[0]);
  const r = Number(parts[1]);
  if (parts.length !== 2 || Number.isNaN(q) || Number.isNaN(r)) {
    throw new Error(`parseHexKey: malformed key "${key}"`);
  }
  return { q, r };
}

/** All six neighbours, without bounds checking, in DIRECTIONS order. */
export function neighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => hexAdd(h, d));
}

export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

export function areAdjacent(a: Hex, b: Hex): boolean {
  return distance(a, b) === 1;
}

/** Every hex within `n` of the centre, including the centre itself. */
export function hexesInRange(center: Hex, n: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -n; dq <= n; dq++) {
    const lo = Math.max(-n, -dq - n);
    const hi = Math.min(n, -dq + n);
    for (let dr = lo; dr <= hi; dr++) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

/** Hexes at exactly `radius`. Radius 0 is the centre alone. */
export function ring(center: Hex, radius: number): Hex[] {
  if (radius < 0) {
    throw new Error(`ring: negative radius ${radius}`);
  }
  if (radius === 0) {
    return [center];
  }
  const out: Hex[] = [];
  // Start on the direction-4 spoke so the walk comes out clockwise from north-east.
  const start = DIRECTIONS[4];
  if (start === undefined) {
    throw new Error('ring: DIRECTIONS is malformed');
  }
  let current = hexAdd(center, { q: start.q * radius, r: start.r * radius });
  for (let i = 0; i < 6; i++) {
    const step = DIRECTIONS[i];
    if (step === undefined) {
      throw new Error('ring: DIRECTIONS is malformed');
    }
    for (let j = 0; j < radius; j++) {
      out.push(current);
      current = hexAdd(current, step);
    }
  }
  return out;
}

// --- odd-q offset conversion -------------------------------------------------

export function offsetToAxial(col: number, row: number): Hex {
  const q = col;
  const r = row - (col - (col & 1)) / 2;
  return { q, r };
}

export function axialToOffset(h: Hex): { col: number; row: number } {
  const col = h.q;
  const row = h.r + (h.q - (h.q & 1)) / 2;
  return { col, row };
}

// --- lines -------------------------------------------------------------------

interface Cube {
  readonly q: number;
  readonly r: number;
  readonly s: number;
}

/**
 * One epsilon for the whole project. Its sign decides which way a line that runs
 * exactly along an edge falls. Change it and every line of sight changes with it.
 */
const LINE_EPSILON: Cube = { q: 1e-6, r: 2e-6, s: -3e-6 };

function cubeRound(c: Cube): Hex {
  let rq = Math.round(c.q);
  let rr = Math.round(c.r);
  let rs = Math.round(c.s);
  const dq = Math.abs(rq - c.q);
  const dr = Math.abs(rr - c.r);
  const ds = Math.abs(rs - c.s);
  // Recompute whichever coordinate was rounded the furthest, so q + r + s stays 0.
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  } else {
    rs = -rq - rr;
  }
  return { q: rq, r: rr };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inclusive of both ends. Length is always distance(a, b) + 1. */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = distance(a, b);
  if (n === 0) {
    return [a];
  }
  const ac: Cube = { q: a.q + LINE_EPSILON.q, r: a.r + LINE_EPSILON.r, s: -a.q - a.r + LINE_EPSILON.s };
  const bc: Cube = { q: b.q + LINE_EPSILON.q, r: b.r + LINE_EPSILON.r, s: -b.q - b.r + LINE_EPSILON.s };
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(cubeRound({ q: lerp(ac.q, bc.q, t), r: lerp(ac.r, bc.r, t), s: lerp(ac.s, bc.s, t) }));
  }
  return out;
}

/**
 * The direction from `from` towards `to`, snapped to one of the six. Ties go to the
 * lower DIRECTIONS index so that shapes stay deterministic.
 */
export function nearestDirection(from: Hex, to: Hex): Hex {
  const v = hexSubtract(to, from);
  const len = Math.max(1, distance(from, to));
  const nq = v.q / len;
  const nr = v.r / len;
  let best = DIRECTIONS[0];
  if (best === undefined) {
    throw new Error('nearestDirection: DIRECTIONS is malformed');
  }
  let bestScore = -Infinity;
  for (const d of DIRECTIONS) {
    // Dot product in cube space; the third coordinate keeps the metric isotropic.
    const score = d.q * nq + d.r * nr + (-d.q - d.r) * (-nq - nr);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}
