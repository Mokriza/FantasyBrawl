/**
 * The board, drawn with Pixi. The application is created imperatively through a ref
 * and torn down explicitly, as docs/ai/ui-and-rendering.md requires: no React wrapper
 * around Pixi.
 *
 * It draws the *shown* state, which trails the real one while events play back, so a
 * move is a walk across hexes rather than a teleport. Nothing here decides anything.
 */

import { useEffect, useRef, useState } from 'react';
import { Application, Assets, Container, Rectangle, Texture } from 'pixi.js';
import type { Ability, Arena, BattleState, Hex } from '../../core/index.js';
import {
  abilityLegality,
  abilityReach,
  abilityTargets,
  allHexes,
  centreHex,
  emptyArena,
  getAbility,
  hexKey,
  heroById,
  holdToWin,
  legalPlacementHexes,
  otherSide,
  placementTurn,
  reachableFor,
  resolveShape,
  startZone,
  terrainAt,
} from '../../core/index.js';
import { COLORS, HEX_SIZE } from '../theme.js';
import { canAct, dispatch, placeAt, selectAbility, setHover, useUi } from '../store.js';
import type { UiState } from '../store.js';
import { classFigure, paintVariant, terrainArt, terrainKinds, tileOrigin } from '../assets/sprites.js';
import { boardMetrics, hexToPixel, pixelToHex } from './pixelHex.js';
import { TipCard } from '../panels/Tip.js';
import { EMPTY_HIGHLIGHTS, drawBoard } from './render.js';
import { UI } from '../strings.ru.js';
import { PLACE_DRAG_TYPE } from '../config.js';
import type { ClassTextures, Highlights, TerrainTextures, VfxFrames, VfxTextures } from './render.js';
import { NO_VFX } from './render.js';
import { ANIMATIONS, SPRITES } from '../vfx.js';
import { assetUrl } from '../assets/url.js';

/** How long the board waits for its renderer before saying it cannot draw. */
const RENDERER_TIMEOUT_MS = 8000;

/**
 * During placement the free hexes of the player's zone are the clickable targets and
 * the enemy's zone is shown faintly, so both lines are visible before the match.
 */
function placementHighlights(ui: UiState): Highlights {
  const placement = ui.run?.placement ?? null;
  if (placement === null) return EMPTY_HIGHLIGHTS;
  const config = ui.content.config;
  const enemyZone = startZone(config, otherSide(ui.playerSide));
  if (placementTurn(placement) !== ui.playerSide || ui.placingHeroId === null) {
    return { ...EMPTY_HIGHLIGHTS, reach: [...startZone(config, ui.playerSide), ...enemyZone] };
  }
  return {
    ...EMPTY_HIGHLIGHTS,
    reach: enemyZone,
    targets: legalPlacementHexes(placement, ui.playerSide, config),
  };
}

function computeHighlights(ui: UiState, battle: BattleState): Highlights {
  if (ui.run?.phase === 'placement') return placementHighlights(ui);
  const active = battle.activeHeroId;
  if (active === null || !canAct(ui)) return EMPTY_HIGHLIGHTS;
  const hero = heroById(battle, active);

  if (ui.selectedAbility === null) {
    const reachable = reachableFor(battle, hero, ui.content);
    const hovered = ui.hoverHex === null ? undefined : reachable.get(hexKey(ui.hoverHex));
    return { ...EMPTY_HIGHLIGHTS, reachable, path: hovered?.path ?? [] };
  }

  const ability = getAbility(ui.content, ui.selectedAbility);
  // The reach is drawn even when nothing valid stands in it, so a ranged ability
  // always shows how far it goes; the clickable hexes are painted on top of it.
  const reach = abilityReach(battle, hero, ability, ui.content);
  const targets = abilityTargets(battle, hero, ability, ui.content);

  if (ui.hoverHex === null) {
    return { ...EMPTY_HIGHLIGHTS, reach, targets };
  }
  if (!abilityLegality(battle, hero, ability, ui.hoverHex, ui.content).ok) {
    return { ...EMPTY_HIGHLIGHTS, reach, targets, illegal: true };
  }

  return {
    ...EMPTY_HIGHLIGHTS,
    reach,
    targets,
    zone: resolveShape(battle, hero, ui.hoverHex, ability, ui.content).map((hit) => hit.hex),
    zoneIsFriendly: ability.targets === 'ally' || ability.targets === 'self',
  };
}

/**
 * Cuts the layers of each class figure out of its sprite sheet. If a sheet fails to
 * load the board falls back to vector silhouettes, so a missing asset never breaks
 * the game.
 */
async function loadSheet(url: string, sheets: Map<string, Texture>): Promise<Texture | null> {
  const known = sheets.get(url);
  if (known !== undefined) return known;
  let sheet: Texture;
  try {
    sheet = (await Assets.load(url)) as Texture;
  } catch {
    return null;
  }
  // Pixel art must not be smoothed when scaled up.
  sheet.source.scaleMode = 'nearest';
  sheets.set(url, sheet);
  return sheet;
}

async function loadClassSprites(
  classIds: readonly string[],
  sheets: Map<string, Texture>,
): Promise<Record<string, ClassTextures>> {
  const out: Record<string, ClassTextures> = {};

  for (const classId of classIds) {
    const figure = classFigure(classId);
    if (figure === null) continue;

    const sheet = await loadSheet(figure.sheet.url, sheets);
    if (sheet === null) continue;

    const size = figure.sheet.tileSize;
    const source = sheet.source;
    out[classId] = {
      tint: figure.tint,
      textures: figure.layers.map((ref) => {
        const origin = tileOrigin(figure.sheet, ref);
        return new Texture({ source, frame: new Rectangle(origin.x, origin.y, size, size) });
      }),
    };
  }
  return out;
}

/**
 * The floor and terrain pictures, each variant put together on a canvas of its own and
 * made a texture. A shape filled with a texture takes the texture's whole source, not a
 * frame of it, so a picture that fills a hex cannot be a frame of the sheet. A kind whose
 * sheet fails to load is simply left out, and drawn as a vector shape.
 */
async function loadTerrainTextures(sheets: Map<string, Texture>): Promise<Record<string, TerrainTextures>> {
  const out: Record<string, TerrainTextures> = {};
  for (const kind of terrainKinds()) {
    const art = terrainArt(kind);
    if (art === null) continue;
    const sheet = await loadSheet(art.sheet.url, sheets);
    const image = sheet?.source.resource as CanvasImageSource | undefined;
    if (image === undefined) continue;
    const textures: Texture[] = [];
    for (const parts of art.variants) {
      const canvas = paintVariant(image, parts, art.cover);
      if (canvas === null) continue;
      const texture = Texture.from(canvas);
      texture.source.scaleMode = 'nearest';
      textures.push(texture);
    }
    if (textures.length > 0) out[kind] = { cover: art.cover, scale: art.scale, textures };
  }
  return out;
}

/** A colour written as "#rrggbb" in vfx.json, as Pixi takes it. */
function tintOf(colour: string | undefined): number | null {
  return colour === undefined ? null : Number.parseInt(colour.replace('#', ''), 16);
}

interface StripInfo {
  readonly url: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frames: number;
  readonly scale: number;
  readonly tint?: string;
  readonly pointsAt?: number | null;
}

/**
 * The frames of every animation and sprite in assets/vfx.json. A strip whose picture
 * fails to load is left out, and its flourish falls back to a drawn shape.
 */
async function loadVfxTextures(sheets: Map<string, Texture>): Promise<VfxTextures> {
  const cut = async (entries: Readonly<Record<string, StripInfo>>): Promise<Record<string, VfxFrames>> => {
    const out: Record<string, VfxFrames> = {};
    for (const [name, info] of Object.entries(entries)) {
      const sheet = await loadSheet(assetUrl(info.url), sheets);
      if (sheet === null) continue;
      const frames: Texture[] = [];
      for (let i = 0; i < info.frames; i++) {
        frames.push(new Texture({ source: sheet.source, frame: new Rectangle(i * info.frameWidth, 0, info.frameWidth, info.frameHeight) }));
      }
      out[name] = { frames, scale: info.scale, tint: tintOf(info.tint), pointsAt: info.pointsAt ?? null };
    }
    return out;
  };
  return { anims: await cut(ANIMATIONS), sprites: await cut(SPRITES) };
}

export function BoardCanvas(): JSX.Element {
  const ui = useUi();
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const layerRef = useRef<Container | null>(null);
  const spritesRef = useRef<Record<string, ClassTextures>>({});
  const terrainRef = useRef<Record<string, TerrainTextures>>({});
  const vfxRef = useRef<VfxTextures>(NO_VFX);
  const uiRef = useRef(ui);
  uiRef.current = ui;
  // Why the board cannot be drawn, if it cannot: no WebGL, or the GPU dropped the context.
  const [failure, setFailure] = useState<'init' | 'lost' | null>(null);

  function hexUnderPointer(event: MouseEvent): Hex | null {
    const app = appRef.current;
    if (app === null) return null;
    const rect = app.canvas.getBoundingClientRect();
    const arena = arenaOf(uiRef.current);
    const metrics = boardMetrics(arena, HEX_SIZE);
    // The canvas may be laid out smaller than its backing size, so scale the point.
    const scaleX = app.canvas.width / rect.width;
    const scaleY = app.canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX - metrics.offsetX;
    const y = (event.clientY - rect.top) * scaleY - metrics.offsetY;
    const hex = pixelToHex(x, y, HEX_SIZE);
    return allHexes(arena).find((h) => h.q === hex.q && h.r === hex.r) ?? null;
  }

  function onPointerMove(event: PointerEvent): void {
    setHover(hexUnderPointer(event));
  }

  function onPointerLeave(): void {
    setHover(null);
  }

  function onPointerDown(event: PointerEvent): void {
    const hex = hexUnderPointer(event);
    if (hex !== null) handleClick(uiRef.current, hex);
  }

  // A hero dragged from the placement list: the hex under it lights up, and the drop is
  // allowed only on a free hex of the player's zone, the same check a click goes through.
  function onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes(PLACE_DRAG_TYPE) !== true) return;
    const hex = hexUnderPointer(event);
    setHover(hex);
    if (hex !== null && canPlaceAt(uiRef.current, hex)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    const hex = hexUnderPointer(event);
    if (hex !== null) handlePlacementClick(uiRef.current, hex);
  }

  function redraw(): void {
    const layer = layerRef.current;
    if (layer === null) return;
    // The board is drawn afresh, so last frame's objects go, and their graphics contexts
    // with them: Pixi keeps a Graphics' own context alive unless told `context: true`,
    // which at 60 redraws a second is a gigabyte a minute. Sprite textures are shared
    // and stay; `texture` is not set.
    layer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    const current = uiRef.current;
    const battle = current.battle;
    if (battle === null) return;
    drawBoard(
      layer,
      {
        battle,
        display: current.display,
        content: current.content,
        hoverHex: current.hoverHex,
        floats: current.floats,
        effects: current.effects,
        highlights: computeHighlights(current, battle),
        sprites: spritesRef.current,
        terrain: terrainRef.current,
        vfx: vfxRef.current,
        playerSide: current.playerSide,
      },
      performance.now(),
    );
  }

  // Create the Pixi application once and destroy it explicitly on unmount.
  useEffect(() => {
    let cancelled = false;
    let started = false;
    const app = new Application();
    // A renderer that has not started in this long is not going to.
    const watchdog = window.setTimeout(() => {
      if (!started && !cancelled) setFailure('init');
    }, RENDERER_TIMEOUT_MS);
    const metrics = boardMetrics(arenaOf(uiRef.current), HEX_SIZE);

    void app
      .init({
        width: metrics.width,
        height: metrics.height,
        background: COLORS.background,
        antialias: true,
        // WebGL, or plain 2D canvas when the browser has none. Not WebGPU: the board does
        // not need it, and asking a GPU that has just crashed for an adapter can hang for
        // good, leaving no board and no error.
        preference: ['webgl', 'canvas'],
      })
      .then(() => {
        if (cancelled) {
          app.destroy(true, { children: true });
          return;
        }
        started = true;
        window.clearTimeout(watchdog);
        setFailure(null);
        appRef.current = app;
        const layer = new Container();
        app.stage.addChild(layer);
        layerRef.current = layer;

        // Both sizes auto with both maxima set: the browser keeps the aspect ratio and
        // shrinks the board to whichever limit bites first, width or window height.
        app.canvas.style.width = 'auto';
        app.canvas.style.height = 'auto';
        app.canvas.style.maxWidth = '100%';
        hostRef.current?.appendChild(app.canvas);
        // A GPU reset takes the drawing with it; say so instead of showing a dead canvas.
        app.canvas.addEventListener('webglcontextlost', () => setFailure('lost'));

        app.canvas.addEventListener('pointermove', onPointerMove);
        app.canvas.addEventListener('pointerleave', onPointerLeave);
        app.canvas.addEventListener('pointerdown', onPointerDown);
        app.canvas.addEventListener('dragover', onDragOver);
        app.canvas.addEventListener('dragleave', onPointerLeave);
        app.canvas.addEventListener('drop', onDrop);

        // Floating numbers fade over time, so the board needs a heartbeat of its own
        // while any of them are alive. Otherwise it redraws only on state changes.
        app.ticker.add(() => {
          // Anything moving on its own keeps the board redrawing: numbers, flourishes, walks.
          const current = uiRef.current;
          if (current.floats.length > 0 || current.effects.length > 0 || current.busy) redraw();
        });

        redraw();

        const sheets = new Map<string, Texture>();
        void loadClassSprites(Object.keys(uiRef.current.content.classes), sheets)
          .then(async (sprites) => {
            if (cancelled) return;
            spritesRef.current = sprites;
            terrainRef.current = await loadTerrainTextures(sheets);
            vfxRef.current = await loadVfxTextures(sheets);
            if (!cancelled) redraw();
          });
      })
      .catch((error: unknown) => {
        // Chrome takes WebGL away from a site whose tab crashed the GPU process, until the
        // browser restarts; without this the board would just be missing, silently.
        console.error('The board could not start its renderer', error);
        if (!cancelled) setFailure('init');
      });

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      const current = appRef.current;
      if (current !== null) {
        current.canvas.removeEventListener('pointermove', onPointerMove);
        current.canvas.removeEventListener('pointerleave', onPointerLeave);
        current.canvas.removeEventListener('pointerdown', onPointerDown);
        current.canvas.removeEventListener('dragover', onDragOver);
        current.canvas.removeEventListener('dragleave', onPointerLeave);
        current.canvas.removeEventListener('drop', onDrop);
        current.destroy(true, { children: true });
        appRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  useEffect(redraw);

  // What the hex under the cursor is, when it is anything but plain ground: shown by
  // the hex's right edge, so it moves with the hex and not with every pixel of the mouse.
  const tip = ui.hoverHex === null || ui.battle === null ? null : hexTip(ui, ui.battle, ui.hoverHex);
  const anchor = tip === null || ui.hoverHex === null ? null : hexScreenPoint(ui.hoverHex);

  return (
    <div ref={hostRef} className="board">
      {failure === null ? null : (
        <p className="board-failed" role="alert">
          {failure === 'init' ? UI.boardFailed : UI.boardLost}
        </p>
      )}
      {tip === null || anchor === null ? null : <TipCard at={anchor}>{tip}</TipCard>}
    </div>
  );

  /** Where a hex's right edge is on the page, for the terrain card. */
  function hexScreenPoint(hex: Hex): { x: number; y: number } | null {
    const app = appRef.current;
    if (app === null) return null;
    const rect = app.canvas.getBoundingClientRect();
    const metrics = boardMetrics(arenaOf(uiRef.current), HEX_SIZE);
    const centre = hexToPixel(hex, HEX_SIZE);
    const scaleX = rect.width / app.canvas.width;
    const scaleY = rect.height / app.canvas.height;
    return {
      x: rect.left + (centre.x + metrics.offsetX + HEX_SIZE * 0.6) * scaleX,
      y: rect.top + (centre.y + metrics.offsetY - HEX_SIZE * 0.6) * scaleY,
    };
  }
}

/**
 * The terrain card for a hex: what the terrain does to walking and to sight, whose it
 * is and how long it lasts when it is temporary, and the centre of "Точка силы".
 * Null for plain ground.
 */
function hexTip(ui: UiState, battle: BattleState, hex: Hex): JSX.Element | null {
  const terrain = terrainAt(battle.arena, hex);
  const key = hexKey(hex);
  const isCentre = holdToWin(battle, ui.content) !== null && hexKey(centreHex(battle.arena)) === key;
  if (terrain === null && !isCentre) return null;
  const entry = terrain === null ? undefined : UI.terrainLegend.find((t) => t.key === terrain);
  const laid = battle.temporaryTerrain.find((t) => hexKey(t.hex) === key);
  const owner = laid === undefined ? undefined : battle.heroes[laid.ownerId];
  return (
    <div className="tip-plain">
      {entry === undefined ? null : (
        <>
          <strong>{entry.name}</strong>
          <p>
            {UI.terrainTip.movement}: {entry.movement}
            <br />
            {UI.terrainTip.sight}: {entry.sight}
          </p>
          {laid === undefined ? null : (
            <p className="dim">
              {owner === undefined ? '' : `${owner.name} · `}
              {UI.terrainTip.lasts(laid.turns)}
            </p>
          )}
        </>
      )}
      {isCentre ? (
        <>
          <strong>{UI.hold}</strong>
          <p>{UI.holdHint}</p>
        </>
      ) : null}
    </div>
  );
}

/** Turns a click into an Action and checks it through core before dispatching. */
function handleClick(ui: UiState, hex: Hex): void {
  if (ui.run?.phase === 'placement') {
    handlePlacementClick(ui, hex);
    return;
  }
  const battle = ui.battle;
  if (battle === null || !canAct(ui)) return;
  const active = battle.activeHeroId;
  if (active === null) return;
  const hero = heroById(battle, active);

  if (ui.selectedAbility !== null) {
    const ability: Ability = getAbility(ui.content, ui.selectedAbility);
    if (abilityLegality(battle, hero, ability, hex, ui.content).ok) {
      dispatch({ type: 'ability', heroId: hero.id, abilityId: ability.id as never, target: hex });
    } else {
      selectAbility(null);
    }
    return;
  }

  const entry = reachableFor(battle, hero, ui.content).get(hexKey(hex));
  if (entry !== undefined) {
    dispatch({ type: 'move', heroId: hero.id, path: entry.path });
  }
}

/** Whether the chosen hero may go on this hex: core lists it as a free hex of the zone. */
function canPlaceAt(ui: UiState, hex: Hex): boolean {
  const placement = ui.run?.placement ?? null;
  if (placement === null || ui.placingHeroId === null) return false;
  const key = hexKey(hex);
  return legalPlacementHexes(placement, ui.playerSide, ui.content.config).some((h) => hexKey(h) === key);
}

/** Places the chosen hero if core lists the hex as free; anything else is ignored. */
function handlePlacementClick(ui: UiState, hex: Hex): void {
  if (canPlaceAt(ui, hex)) placeAt(hex);
}

/** The board is the size of the configured arena even before a battle exists. */
function arenaOf(ui: UiState): Arena {
  return ui.battle?.arena ?? emptyArena(ui.content.config);
}
