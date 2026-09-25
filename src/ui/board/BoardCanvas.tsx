/**
 * The board, drawn with Pixi. The application is created imperatively through a ref
 * and torn down explicitly, as docs/ai/ui-and-rendering.md requires: no React wrapper
 * around Pixi.
 *
 * It draws the *shown* state, which trails the real one while events play back, so a
 * move is a walk across hexes rather than a teleport. Nothing here decides anything.
 */

import { useEffect, useRef } from 'react';
import { Application, Assets, Container, Rectangle, Texture } from 'pixi.js';
import type { Ability, Arena, BattleState, Hex } from '../../core/index.js';
import {
  abilityLegality,
  abilityReach,
  abilityTargets,
  allHexes,
  emptyArena,
  getAbility,
  hexKey,
  heroById,
  legalPlacementHexes,
  otherSide,
  placementTurn,
  reachableFor,
  resolveShape,
  startZone,
} from '../../core/index.js';
import { COLORS, HEX_SIZE } from '../theme.js';
import { canAct, dispatch, placeAt, selectAbility, setHover, useUi } from '../store.js';
import type { UiState } from '../store.js';
import { classFigure, tileOrigin } from '../assets/sprites.js';
import { boardMetrics, pixelToHex } from './pixelHex.js';
import { EMPTY_HIGHLIGHTS, drawBoard } from './render.js';
import type { ClassTextures, Highlights } from './render.js';

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
    zone: resolveShape(battle, hero, ui.hoverHex, ability).map((hit) => hit.hex),
    zoneIsFriendly: ability.targets === 'ally' || ability.targets === 'self',
  };
}

/**
 * Cuts the layers of each class figure out of its sprite sheet. If a sheet fails to
 * load the board falls back to vector silhouettes, so a missing asset never breaks
 * the game.
 */
async function loadClassSprites(
  classIds: readonly string[],
): Promise<Record<string, ClassTextures>> {
  const out: Record<string, ClassTextures> = {};
  const sheets = new Map<string, Texture>();

  for (const classId of classIds) {
    const figure = classFigure(classId);
    if (figure === null) continue;

    let sheet = sheets.get(figure.sheet.url);
    if (sheet === undefined) {
      try {
        sheet = (await Assets.load(figure.sheet.url)) as Texture;
      } catch {
        continue;
      }
      // Pixel art must not be smoothed when scaled up.
      sheet.source.scaleMode = 'nearest';
      sheets.set(figure.sheet.url, sheet);
    }

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

export function BoardCanvas(): JSX.Element {
  const ui = useUi();
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const layerRef = useRef<Container | null>(null);
  const spritesRef = useRef<Record<string, ClassTextures>>({});
  const uiRef = useRef(ui);
  uiRef.current = ui;

  function hexUnderPointer(event: PointerEvent): Hex | null {
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

  function redraw(): void {
    const layer = layerRef.current;
    if (layer === null) return;
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));
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
        highlights: computeHighlights(current, battle),
        sprites: spritesRef.current,
        playerSide: current.playerSide,
      },
      performance.now(),
    );
  }

  // Create the Pixi application once and destroy it explicitly on unmount.
  useEffect(() => {
    let cancelled = false;
    const app = new Application();
    const metrics = boardMetrics(arenaOf(uiRef.current), HEX_SIZE);

    void app
      .init({
        width: metrics.width,
        height: metrics.height,
        background: COLORS.background,
        antialias: true,
      })
      .then(() => {
        if (cancelled) {
          app.destroy(true, { children: true });
          return;
        }
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

        app.canvas.addEventListener('pointermove', onPointerMove);
        app.canvas.addEventListener('pointerleave', onPointerLeave);
        app.canvas.addEventListener('pointerdown', onPointerDown);

        // Floating numbers fade over time, so the board needs a heartbeat of its own
        // while any of them are alive. Otherwise it redraws only on state changes.
        app.ticker.add(() => {
          if (uiRef.current.floats.length > 0) redraw();
        });

        redraw();

        void loadClassSprites(Object.keys(uiRef.current.content.classes)).then((sprites) => {
          if (cancelled) return;
          spritesRef.current = sprites;
          redraw();
        });
      });

    return () => {
      cancelled = true;
      const current = appRef.current;
      if (current !== null) {
        current.canvas.removeEventListener('pointermove', onPointerMove);
        current.canvas.removeEventListener('pointerleave', onPointerLeave);
        current.canvas.removeEventListener('pointerdown', onPointerDown);
        current.destroy(true, { children: true });
        appRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  useEffect(redraw);

  return <div ref={hostRef} className="board" />;
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

/** Places the chosen hero if core lists the hex as free; anything else is ignored. */
function handlePlacementClick(ui: UiState, hex: Hex): void {
  const placement = ui.run?.placement ?? null;
  if (placement === null || ui.placingHeroId === null) return;
  const key = hexKey(hex);
  const free = legalPlacementHexes(placement, ui.playerSide, ui.content.config);
  if (free.some((h) => hexKey(h) === key)) placeAt(hex);
}

/** The board is the size of the configured arena even before a battle exists. */
function arenaOf(ui: UiState): Arena {
  return ui.battle?.arena ?? emptyArena(ui.content.config);
}
