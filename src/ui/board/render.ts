/**
 * Drawing the board. Nothing here decides anything: reachability, targeting and
 * previews all come from core, and this file only paints what core says.
 *
 * Heroes are drawn as class silhouettes rather than letters, so two heroes can be
 * told apart at a glance. They are vector shapes, not assets: see ASSETS.md.
 */

import { Graphics, Sprite, Text } from 'pixi.js';
import type { Container, Texture } from 'pixi.js';
import type {
  Arena,
  BattleState,
  ContentRegistry,
  Hex,
  HeroId,
  Reachable,
  Side,
} from '../../core/index.js';
import { allHexes, blocksLos, getClass, hexKey, resolveShape, terrainAt } from '../../core/index.js';
import { COLORS, HEX_SIZE, classColor, sideColor } from '../theme.js';
import type { DisplayHero, FloatingText } from '../store.js';
import { FLOAT_MS } from '../config.js';
import { boardMetrics, hexCorners, hexToPixel } from './pixelHex.js';

/** The layers of one class figure, plus the tint multiplied over them. */
export interface ClassTextures {
  readonly textures: readonly Texture[];
  readonly tint: string | null;
}

export interface Highlights {
  /** Hexes the active hero can walk to, with cost and who would swing at them. */
  readonly reachable: Map<string, Reachable>;
  /** The route to the hex under the cursor. */
  readonly path: readonly Hex[];
  /** How far the ability can reach, whatever is standing there. */
  readonly reach: readonly Hex[];
  /** The subset of the reach that may actually be clicked. */
  readonly targets: readonly Hex[];
  /** The hexes the ability would actually hit from the hex under the cursor. */
  readonly zone: readonly Hex[];
  readonly zoneIsFriendly: boolean;
  /** The cursor is on a hex this ability cannot be aimed at. */
  readonly illegal: boolean;
}

export const EMPTY_HIGHLIGHTS: Highlights = {
  reachable: new Map(),
  path: [],
  reach: [],
  targets: [],
  zone: [],
  zoneIsFriendly: false,
  illegal: false,
};

function polygonPoints(hex: Hex, arena: Arena, inset = 0): number[] {
  const metrics = boardMetrics(arena, HEX_SIZE);
  const centre = hexToPixel(hex, HEX_SIZE);
  return hexCorners(HEX_SIZE - inset).flatMap((c) => [
    centre.x + c.x + metrics.offsetX,
    centre.y + c.y + metrics.offsetY,
  ]);
}

function centreOf(hex: Hex, arena: Arena): { x: number; y: number } {
  const metrics = boardMetrics(arena, HEX_SIZE);
  const p = hexToPixel(hex, HEX_SIZE);
  return { x: p.x + metrics.offsetX, y: p.y + metrics.offsetY };
}

// --- terrain -----------------------------------------------------------------

/** A ring of short dashes: the board's shorthand for "this blocks line of sight". */
function drawSightBlockedMark(layer: Container, hex: Hex, arena: Arena): void {
  const { x, y } = centreOf(hex, arena);
  const g = new Graphics();
  const radius = HEX_SIZE * 0.78;
  for (let i = 0; i < 12; i++) {
    const a0 = (Math.PI / 6) * i;
    const a1 = a0 + Math.PI / 12;
    g.moveTo(x + Math.cos(a0) * radius, y + Math.sin(a0) * radius);
    g.lineTo(x + Math.cos(a1) * radius, y + Math.sin(a1) * radius);
  }
  g.stroke({ width: 2, color: COLORS.sightBlocked, alpha: 0.85 });
  layer.addChild(g);
}

function drawRock(layer: Container, hex: Hex, arena: Arena): void {
  const { x, y } = centreOf(hex, arena);
  const g = new Graphics();
  // A chunky boulder: unmistakably solid, unmistakably not walkable.
  g.poly([
    x - 22, y + 14,
    x - 26, y - 4,
    x - 10, y - 18,
    x + 8, y - 20,
    x + 24, y - 6,
    x + 22, y + 14,
  ]).fill({ color: COLORS.rockFill });
  g.poly([
    x - 22, y + 14,
    x - 26, y - 4,
    x - 10, y - 18,
    x + 8, y - 20,
    x + 24, y - 6,
    x + 22, y + 14,
  ]).stroke({ width: 2, color: COLORS.rockEdge });
  g.moveTo(x - 10, y - 18).lineTo(x - 4, y + 14).stroke({ width: 2, color: COLORS.rockEdge });
  g.moveTo(x + 8, y - 20).lineTo(x + 6, y + 2).stroke({ width: 2, color: COLORS.rockEdge });
  layer.addChild(g);
}

/** "Колонна": a pale pillar seen from above. Solid, but see-through, so no sight ring. */
function drawColumn(layer: Container, hex: Hex, arena: Arena): void {
  const { x, y } = centreOf(hex, arena);
  const g = new Graphics();
  g.circle(x, y, 17).fill({ color: COLORS.columnFill });
  g.circle(x, y, 17).stroke({ width: 2.5, color: COLORS.columnEdge });
  g.circle(x, y, 10).stroke({ width: 1.5, color: COLORS.columnEdge, alpha: 0.7 });
  layer.addChild(g);
}

/** "Возвышенность": a raised plateau, a smaller hex with a bright rim and a chevron. */
function drawHigh(layer: Container, hex: Hex, arena: Arena): void {
  const { x, y } = centreOf(hex, arena);
  const g = new Graphics();
  const inner = polygonPoints(hex, arena, 9);
  g.poly(inner).fill({ color: COLORS.highFill, alpha: 0.85 });
  g.poly(inner).stroke({ width: 2.5, color: COLORS.highEdge });
  g.moveTo(x - 9, y + 5).lineTo(x, y - 5).lineTo(x + 9, y + 5).stroke({ width: 3, color: COLORS.highEdge });
  layer.addChild(g);
}

function drawThicket(layer: Container, hex: Hex, arena: Arena): void {
  const { x, y } = centreOf(hex, arena);
  const g = new Graphics();
  const blobs: Array<[number, number, number]> = [
    [-14, 4, 11],
    [0, -8, 13],
    [14, 4, 11],
    [-6, 12, 9],
    [8, 12, 9],
  ];
  for (const [dx, dy, r] of blobs) {
    g.circle(x + dx, y + dy, r).fill({ color: COLORS.thicketFill });
  }
  for (const [dx, dy, r] of blobs) {
    g.circle(x + dx, y + dy, r).stroke({ width: 1.5, color: COLORS.thicketEdge });
  }
  layer.addChild(g);
}

function drawPit(layer: Container, hex: Hex, arena: Arena): void {
  const { x, y } = centreOf(hex, arena);
  const g = new Graphics();
  g.ellipse(x, y, 25, 20).fill({ color: COLORS.pitFill });
  g.ellipse(x, y, 25, 20).stroke({ width: 3, color: COLORS.pitEdge });
  g.ellipse(x, y, 15, 12).stroke({ width: 2, color: COLORS.pitEdge, alpha: 0.6 });
  layer.addChild(g);
}

/** "Стена льда": a pale crystal. Solid, but see-through, so no sight ring. */
function drawIce(layer: Container, hex: Hex, arena: Arena): void {
  const { x, y } = centreOf(hex, arena);
  const g = new Graphics();
  const crystal = [x, y - 24, x + 18, y - 8, x + 14, y + 16, x - 14, y + 16, x - 18, y - 8];
  g.poly(crystal).fill({ color: COLORS.iceFill, alpha: 0.75 });
  g.poly(crystal).stroke({ width: 2, color: COLORS.iceEdge });
  g.moveTo(x, y - 24).lineTo(x - 4, y + 16).stroke({ width: 1.5, color: COLORS.iceEdge, alpha: 0.7 });
  g.moveTo(x - 18, y - 8).lineTo(x + 14, y + 2).stroke({ width: 1.5, color: COLORS.iceEdge, alpha: 0.5 });
  layer.addChild(g);
}

/** "Дымовая завеса": grey puffs. Walkable, blocks sight, so it gets the sight ring. */
function drawSmoke(layer: Container, hex: Hex, arena: Arena): void {
  const { x, y } = centreOf(hex, arena);
  const g = new Graphics();
  const puffs: Array<[number, number, number]> = [
    [-12, 4, 12],
    [2, -6, 14],
    [14, 6, 11],
    [0, 12, 10],
  ];
  for (const [dx, dy, r] of puffs) g.circle(x + dx, y + dy, r).fill({ color: COLORS.smoke, alpha: 0.55 });
  layer.addChild(g);
}

/**
 * "Капкан": open jaws inside a ring of its owner's side colour, so a glance says
 * whose it is. Drawn for both sides; the rules keep no hidden information.
 */
function drawTrap(layer: Container, hex: Hex, arena: Arena, owner: number): void {
  const { x, y } = centreOf(hex, arena);
  const g = new Graphics();
  g.circle(x, y, 20).stroke({ width: 3, color: owner });
  g.circle(x, y, 15).stroke({ width: 3, color: COLORS.trap });
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const inner = { x: x + Math.cos(a) * 15, y: y + Math.sin(a) * 15 };
    const tip = { x: x + Math.cos(a) * 8, y: y + Math.sin(a) * 8 };
    g.moveTo(inner.x, inner.y).lineTo(tip.x, tip.y);
  }
  g.stroke({ width: 2, color: COLORS.trap });
  g.circle(x, y, 3).fill({ color: COLORS.trap });
  layer.addChild(g);
}

function trapOwnerColour(battle: BattleState, hex: Hex, playerSide: Side): number {
  const laid = battle.temporaryTerrain.find((t) => t.terrain === 'trap' && hexKey(t.hex) === hexKey(hex));
  const owner = laid === undefined ? undefined : battle.heroes[laid.ownerId];
  return owner === undefined ? COLORS.trap : sideColor(owner.side, playerSide);
}

/** Where a delayed ability ("Метеор") will land: a warning over its whole zone. */
function drawPending(layer: Container, hexes: readonly Hex[], arena: Arena): void {
  const g = new Graphics();
  for (const hex of hexes) {
    g.poly(polygonPoints(hex, arena, 4)).fill({ color: COLORS.pending, alpha: 0.22 });
    g.poly(polygonPoints(hex, arena, 4)).stroke({ width: 2, color: COLORS.pending, alpha: 0.9 });
  }
  layer.addChild(g);
}

// --- hero silhouettes --------------------------------------------------------

type Silhouette = (g: Graphics, x: number, y: number, ink: number) => void;

const SILHOUETTES: Record<string, Silhouette> = {
  // Sword: a blade with a crossguard.
  warrior: (g, x, y, ink) => {
    g.roundRect(x - 3, y - 17, 6, 24, 2).fill({ color: ink });
    g.poly([x - 3, y - 17, x, y - 23, x + 3, y - 17]).fill({ color: ink });
    g.roundRect(x - 11, y + 5, 22, 4, 2).fill({ color: ink });
    g.roundRect(x - 2, y + 9, 4, 9, 2).fill({ color: ink });
  },
  // War hammer: a heavy head on a shaft.
  paladin: (g, x, y, ink) => {
    g.roundRect(x - 2, y - 14, 4, 30, 2).fill({ color: ink });
    g.roundRect(x - 13, y - 20, 26, 12, 3).fill({ color: ink });
  },
  // Bow: an arc with a string and a nocked arrow.
  hunter: (g, x, y, ink) => {
    g.arc(x + 2, y, 16, Math.PI * 0.62, Math.PI * 1.38).stroke({ width: 4, color: ink });
    g.moveTo(x - 8, y - 15).lineTo(x - 8, y + 15).stroke({ width: 2, color: ink });
    g.moveTo(x - 8, y).lineTo(x + 15, y).stroke({ width: 3, color: ink });
  },
  // Staff topped with an orb.
  mage: (g, x, y, ink) => {
    g.roundRect(x - 2, y - 6, 4, 26, 2).fill({ color: ink });
    g.circle(x, y - 12, 9).fill({ color: ink });
    g.circle(x, y - 12, 4).fill({ color: COLORS.background });
  },
  // A plain cross, the healer's mark.
  priest: (g, x, y, ink) => {
    g.roundRect(x - 4, y - 18, 8, 34, 3).fill({ color: ink });
    g.roundRect(x - 14, y - 8, 28, 8, 3).fill({ color: ink });
  },
  // Skull: a dome with two hollow eyes.
  warlock: (g, x, y, ink) => {
    g.circle(x, y - 4, 14).fill({ color: ink });
    g.roundRect(x - 8, y + 6, 16, 9, 3).fill({ color: ink });
    g.circle(x - 5, y - 5, 4).fill({ color: COLORS.background });
    g.circle(x + 5, y - 5, 4).fill({ color: COLORS.background });
  },
};

function drawHero(
  layer: Container,
  arena: Arena,
  battle: BattleState,
  id: HeroId,
  shown: DisplayHero,
  content: ContentRegistry,
  isActive: boolean,
  sprite: ClassTextures | undefined,
  playerSide: Side,
): void {
  const hero = battle.heroes[id];
  if (hero === undefined || shown.hp <= 0) return;

  const { x, y } = centreOf(shown.hex, arena);
  const heroClass = getClass(content, hero.classId);
  // A summon is a smaller figure, so it never passes for a fourth hero.
  const radius = HEX_SIZE * (hero.summon === null ? 0.58 : 0.45);

  // Two rings, because both facts matter and neither can be dropped: the outer one is
  // the side, the inner one is the class. The tint inside repeats the class colour so
  // it reads even at a glance.
  const ink = classColor(hero.classId);
  const disc = new Graphics();
  disc.circle(x, y, radius).fill({ color: ink, alpha: 0.3 });
  disc.circle(x, y, radius).stroke({ width: 5, color: sideColor(hero.side, playerSide) });
  disc.circle(x, y, radius - 4).stroke({ width: 3, color: ink });
  if (isActive) {
    disc.circle(x, y, radius + 6).stroke({ width: 3, color: COLORS.active });
  }
  layer.addChild(disc);

  if (sprite !== undefined && sprite.textures.length > 0) {
    // Whole multiples only: a half-pixel scale turns pixel art to mush. The figure may
    // poke slightly past the disc; the tiles carry transparent margins of their own.
    const first = sprite.textures[0] as Texture;
    const scale = Math.max(1, Math.floor((radius * 2.1) / first.width));
    for (const texture of sprite.textures) {
      const figure = new Sprite(texture);
      figure.anchor.set(0.5);
      figure.scale.set(scale);
      figure.position.set(x, y);
      if (sprite.tint !== null) figure.tint = sprite.tint;
      layer.addChild(figure);
    }
  } else {
    // No asset loaded: fall back to the vector silhouette rather than drawing nothing.
    const mark = new Graphics();
    const silhouette = SILHOUETTES[heroClass.id];
    if (silhouette !== undefined) {
      silhouette(mark, x, y - 2, classColor(hero.classId));
    } else {
      mark.circle(x, y, radius * 0.5).fill({ color: classColor(hero.classId) });
    }
    layer.addChild(mark);
  }

  // Health under the feet, in the colour of the side it belongs to.
  const width = HEX_SIZE * 1.15;
  const share = Math.max(0, shown.hp / hero.base.maxHp);
  const bar = new Graphics();
  bar.rect(x - width / 2, y + radius + 5, width, 6).fill({ color: 0x000000, alpha: 0.75 });
  bar
    .rect(x - width / 2, y + radius + 5, width * share, 6)
    .fill({ color: share > 0.35 ? COLORS.hpGood : COLORS.hpLow });
  bar.rect(x - width / 2, y + radius + 5, width, 6).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
  layer.addChild(bar);

  const name = new Text({
    text: hero.name,
    style: { fontSize: 11, fill: COLORS.textSoft, fontWeight: '600' },
  });
  name.anchor.set(0.5, 0);
  name.position.set(x, y + radius + 13);
  layer.addChild(name);
}

// --- the whole board ---------------------------------------------------------

export interface BoardView {
  readonly battle: BattleState;
  readonly display: Readonly<Record<string, DisplayHero>>;
  readonly content: ContentRegistry;
  readonly hoverHex: Hex | null;
  readonly floats: readonly FloatingText[];
  readonly highlights: Highlights;
  /** Whose team is drawn blue. */
  readonly playerSide: Side;
  /** Layers per class id, back to front; empty until the sheet finishes loading. */
  readonly sprites: Readonly<Record<string, ClassTextures>>;
}

export function drawBoard(layer: Container, view: BoardView, now: number): void {
  const { battle, content, highlights } = view;
  const arena = battle.arena;

  const inPath = new Set(highlights.path.map(hexKey));
  const inZone = new Set(highlights.zone.map(hexKey));
  const inReach = new Set(highlights.reach.map(hexKey));
  const isTarget = new Set(highlights.targets.map(hexKey));

  for (const hex of allHexes(arena)) {
    const key = hexKey(hex);
    const points = polygonPoints(hex, arena);
    const terrain = terrainAt(arena, hex);

    let fill: number = (hex.q + hex.r) % 2 === 0 ? COLORS.hexFill : COLORS.hexFillAlt;
    let alpha = 1;

    let edge: number | null = null;
    // The reach is the faint field; a hex that can really be clicked is brighter.
    if (inReach.has(key)) {
      fill = COLORS.reach;
      alpha = 0.3;
      edge = COLORS.reachEdge;
    }
    if (isTarget.has(key)) {
      fill = COLORS.range;
      alpha = 0.5;
      edge = COLORS.rangeEdge;
    }
    if (highlights.reachable.has(key)) {
      fill = COLORS.reachable;
      alpha = 0.45;
    }
    if (inZone.has(key)) {
      fill = highlights.zoneIsFriendly ? COLORS.abilityZoneAlly : COLORS.abilityZone;
      alpha = 0.8;
    }
    if (inPath.has(key)) {
      fill = COLORS.path;
      alpha = 0.75;
    }

    const hovered = view.hoverHex !== null && hexKey(view.hoverHex) === key;
    if (hovered && highlights.illegal) {
      fill = COLORS.illegal;
      alpha = 0.55;
    }

    const g = new Graphics();
    g.poly(points).fill({ color: fill, alpha });
    g.poly(points).stroke({
      width: hovered ? 3 : edge !== null ? 2 : 1,
      color: hovered
        ? highlights.illegal
          ? COLORS.illegal
          : COLORS.hexHover
        : (edge ?? COLORS.hexLine),
      alpha: hovered ? 1 : edge !== null ? 0.8 : 1,
    });
    layer.addChild(g);

    if (terrain === 'rock') drawRock(layer, hex, arena);
    else if (terrain === 'column') drawColumn(layer, hex, arena);
    else if (terrain === 'high') drawHigh(layer, hex, arena);
    else if (terrain === 'thicket') drawThicket(layer, hex, arena);
    else if (terrain === 'pit') drawPit(layer, hex, arena);
    else if (terrain === 'ice') drawIce(layer, hex, arena);
    else if (terrain === 'smoke') drawSmoke(layer, hex, arena);
    else if (terrain === 'trap') drawTrap(layer, hex, arena, trapOwnerColour(battle, hex, view.playerSide));

    // Rock, thicket and smoke stop sight; the dashed ring says so without a legend.
    if (terrain !== null && blocksLos(arena, hex)) drawSightBlockedMark(layer, hex, arena);
  }

  for (const pending of battle.pending) {
    const caster = battle.heroes[pending.casterId];
    const ability = content.abilities[pending.abilityId];
    if (caster === undefined || ability === undefined) continue;
    const zone = resolveShape(battle, caster, pending.target, ability, content).map((hit) => hit.hex);
    drawPending(layer, zone, arena);
  }

  // Warn about every enemy that would swing at the route under the cursor.
  const hovered = view.hoverHex === null ? undefined : highlights.reachable.get(hexKey(view.hoverHex));
  for (const attackerId of hovered?.provokes ?? []) {
    const shown = view.display[attackerId];
    if (shown === undefined) continue;
    const { x, y } = centreOf(shown.hex, arena);
    const warn = new Graphics();
    warn.circle(x, y, HEX_SIZE * 0.78).stroke({ width: 3, color: COLORS.provoke });
    layer.addChild(warn);
  }

  for (const [id, shown] of Object.entries(view.display)) {
    const classId = battle.heroes[id]?.classId;
    drawHero(
      layer,
      arena,
      battle,
      id as HeroId,
      shown,
      content,
      battle.activeHeroId === id && !inZone.size,
      classId === undefined ? undefined : view.sprites[classId],
      view.playerSide,
    );
  }

  for (const float of view.floats) {
    const age = (now - float.bornAt) / FLOAT_MS;
    if (age >= 1) continue;
    const { x, y } = centreOf(float.hex, arena);
    const text = new Text({
      text: float.text,
      style: {
        fontSize: float.kind === 'crit' ? 24 : 18,
        fill: COLORS.float[float.kind],
        fontWeight: 'bold',
        stroke: { color: 0x000000, width: 4 },
      },
    });
    text.anchor.set(0.5, 1);
    text.position.set(x, y - HEX_SIZE * 0.4 - age * 26);
    text.alpha = 1 - age * age;
    layer.addChild(text);
  }
}
