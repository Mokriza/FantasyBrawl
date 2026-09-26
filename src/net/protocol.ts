/**
 * The messages between the client and the server, as Zod schemas: anything that comes
 * off the wire is parsed before it is trusted. See docs/ai/online-pvp.md.
 */

import { z } from 'zod';
import type { Action, RunAction } from '../core/index.js';
import type { LogEntry } from './log.js';

const side = z.enum(['A', 'B']);
const hex = z.object({ q: z.number().int(), r: z.number().int() }).strict();
const id = z.string().min(1).max(64);

const battleAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), heroId: id, path: z.array(hex).min(1).max(32) }).strict(),
  z.object({ type: z.literal('ability'), heroId: id, abilityId: id, target: hex }).strict(),
  z.object({ type: z.literal('endTurn'), heroId: id }).strict(),
]);

/** Run actions a log may hold. The match report is derived from the battle, never sent. */
const runAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pick'), side, heroId: id }).strict(),
  z.object({ type: z.literal('autoPick'), side }).strict(),
  z.object({ type: z.literal('place'), side, heroId: id, hex }).strict(),
  z.object({ type: z.literal('nextMatch') }).strict(),
  z.object({ type: z.literal('chooseUnlock'), side, heroId: id, optionId: id }).strict(),
  z.object({ type: z.literal('chooseReward'), side, itemId: id, heroId: id }).strict(),
  z.object({ type: z.literal('swapHero'), side, outId: id, inId: id }).strict(),
  z.object({ type: z.literal('cancelSwap'), side }).strict(),
  z.object({ type: z.literal('choosePerk'), side, heroId: id, perkId: id, abilityId: id.optional() }).strict(),
  z.object({ type: z.literal('readyUpgrade'), side }).strict(),
  z.object({ type: z.literal('unreadyUpgrade'), side }).strict(),
]);

export const logEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('run'), action: runAction }).strict(),
  z.object({ kind: z.literal('battle'), action: battleAction }).strict(),
]);

/**
 * A parsed entry as the core types: the ids are checked strings, which is all the
 * branded id types of core are. choosePerk's optional abilityId is dropped when absent,
 * as exactOptionalPropertyTypes asks.
 */
export function toLogEntry(parsed: z.infer<typeof logEntrySchema>): LogEntry {
  if (parsed.kind === 'battle') return { kind: 'battle', action: parsed.action as Action };
  const action = parsed.action;
  if (action.type === 'choosePerk' && action.abilityId === undefined) {
    const { type, side, heroId, perkId } = action;
    return { kind: 'run', action: { type, side, heroId, perkId } as RunAction };
  }
  return { kind: 'run', action: action as RunAction };
}

const name = z.string().trim().min(1).max(24);
export const ROOM_CODE = /^[A-HJ-NP-Z2-9]{5}$/;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), version: z.string().max(64), contentHash: z.string().max(64), name, token: z.string().max(128).optional() }).strict(),
  z.object({ type: z.literal('createRoom') }).strict(),
  z.object({ type: z.literal('joinRoom'), code: z.string().regex(ROOM_CODE) }).strict(),
  z.object({ type: z.literal('lobbyReady'), ready: z.boolean() }).strict(),
  z.object({ type: z.literal('act'), seq: z.number().int().nonnegative(), entry: logEntrySchema }).strict(),
  z.object({ type: z.literal('continue') }).strict(),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(200) }).strict(),
  z.object({ type: z.literal('leave') }).strict(),
]);

/** A message as it comes off the wire, after the schema. */
export type ParsedClientMessage = z.infer<typeof clientMessageSchema>;

/** A message as a client builds it: the entry in core types. */
export type ClientMessage =
  | Exclude<ParsedClientMessage, { type: 'act' }>
  | { readonly type: 'act'; readonly seq: number; readonly entry: LogEntry };

export interface SeatView {
  readonly name: string;
  readonly ready: boolean;
  readonly connected: boolean;
}

export interface ChatLine {
  readonly from: string;
  readonly text: string;
  readonly at: number;
}

/** Why something was refused, as a code the interface turns into Russian text. */
export type RefusalReason =
  | 'version'
  | 'no_room'
  | 'room_full'
  | 'not_in_room'
  | 'not_your_turn'
  | 'illegal'
  | 'stale'
  | 'too_fast'
  | 'bad_message'
  | 'server_full';

export type ServerMessage =
  | { readonly type: 'welcome'; readonly playerId: string; readonly token: string }
  | {
      readonly type: 'room';
      readonly code: string;
      readonly seats: readonly (SeatView | null)[];
      readonly started: boolean;
    }
  | { readonly type: 'started'; readonly seed: number; readonly you: 'A' | 'B'; readonly names: Readonly<Record<'A' | 'B', string>> }
  | { readonly type: 'applied'; readonly seq: number; readonly entry: LogEntry }
  | { readonly type: 'rejected'; readonly seq: number; readonly reason: RefusalReason }
  | {
      readonly type: 'snapshot';
      readonly seed: number;
      readonly you: 'A' | 'B';
      readonly names: Readonly<Record<'A' | 'B', string>>;
      readonly log: readonly LogEntry[];
      readonly chat: readonly ChatLine[];
    }
  /** When the side on the clock runs out of time, as server milliseconds since epoch. */
  | { readonly type: 'timer'; readonly deadline: number; readonly serverNow: number; readonly side: 'A' | 'B' | null }
  | { readonly type: 'chat'; readonly line: ChatLine }
  | { readonly type: 'continueWaiting'; readonly sides: readonly ('A' | 'B')[] }
  | { readonly type: 'opponentLeft'; readonly returnBy: number; readonly serverNow: number }
  | { readonly type: 'opponentBack' }
  | { readonly type: 'ended'; readonly winner: 'A' | 'B'; readonly reason: 'finished' | 'forfeit' }
  | { readonly type: 'error'; readonly reason: RefusalReason };
