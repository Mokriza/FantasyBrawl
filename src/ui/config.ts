/**
 * Interface timings. They change nothing about the outcome of a match, so they live
 * here rather than in the balance config.
 *
 * Events are played back one at a time; these are how long each one holds the screen
 * at speed x1. The player can speed them up or turn them off entirely.
 */

import type { BattleEvent } from '../core/index.js';

export const EVENT_MS: Record<BattleEvent['type'], number> = {
  battleStarted: 260,
  turnStarted: 220,
  turnSkipped: 500,
  turnEnded: 40,
  // One event per hex stepped, so this is the pace of walking.
  moved: 130,
  pushed: 180,
  opportunityAttack: 380,
  abilityUsed: 300,
  damaged: 420,
  barrierAbsorbed: 260,
  healed: 400,
  statusApplied: 260,
  statusResisted: 420,
  statusExpired: 160,
  statusCleansed: 220,
  atbChanged: 200,
  died: 600,
  passiveTriggered: 380,
  teleported: 260,
  apChanged: 200,
  cooldownsChanged: 240,
  terrainChanged: 200,
  summoned: 380,
  abilityDelayed: 360,
  matchEnded: 300,
  itemGained: 700,
};

/** How long a damage or healing number stays on the board. */
export const FLOAT_MS = 900;

/** How many upcoming turns the queue panel shows. */
export const TURN_QUEUE_LENGTH = 6;

/** How many log lines to keep on screen. */
export const LOG_LIMIT = 200;

/**
 * How long the opponent seems to think over a draft pick or a placement at speed x1,
 * so the player sees each choice land instead of all of them at once.
 */
export const OPPONENT_PICK_MS = 900;

/** Below this many seconds the pick timer turns red. */
export const PICK_WARNING_SECONDS = 10;
