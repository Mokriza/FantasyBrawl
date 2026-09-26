/**
 * What server and client share for online play: the log and its replay, who may send
 * what, the content fingerprint and the message schemas. Depends on core only.
 */

export type { Applied, LogEntry, NetGame } from './log.js';
export { applyEntry, createNetGame, replay } from './log.js';
export { actorOf, isLegalEntry } from './authority.js';
export { contentHash } from './hash.js';
export type { ChatLine, ClientMessage, ParsedClientMessage, RefusalReason, SeatView, ServerMessage } from './protocol.js';
export { ROOM_CODE, clientMessageSchema, logEntrySchema, toLogEntry } from './protocol.js';

/** Bumped when the protocol changes, so an old tab is told to reload. */
export const PROTOCOL_VERSION = '1';
