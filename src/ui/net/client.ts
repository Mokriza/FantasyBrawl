/**
 * The socket to the online server, and nothing about the game: it connects, parses
 * what arrives, and when the connection drops it tries again with a growing pause
 * until close() is called. The store speaks the protocol on top of it.
 */

import type { ClientMessage, ServerMessage } from '../../net/index.js';

export type ConnectionStatus = 'connecting' | 'open' | 'lost';

export interface NetClient {
  send(message: ClientMessage): void;
  /** Drops this connection and opens a new one, as if it had been lost. */
  drop(): void;
  /** Hangs up for good: no more reconnecting. */
  close(): void;
}

export interface ClientHandlers {
  /** A connection has opened (the first one or after a drop): time to say hello. */
  onOpen(): void;
  onMessage(message: ServerMessage): void;
  onStatus(status: ConnectionStatus): void;
}

/** Pauses between reconnection attempts, in milliseconds; the last one repeats. */
const RETRY_MS = [500, 1000, 2000, 4000, 8000];

export function connect(url: string, handlers: ClientHandlers): NetClient {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let retryTimer: number | null = null;

  function open(): void {
    if (closed) return;
    handlers.onStatus(attempt === 0 ? 'connecting' : 'lost');
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener('open', () => {
      attempt = 0;
      handlers.onStatus('open');
      handlers.onOpen();
    });
    ws.addEventListener('message', (event) => {
      let message: ServerMessage;
      try {
        // The server is trusted to speak the protocol; a broken frame is dropped.
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      handlers.onMessage(message);
    });
    ws.addEventListener('close', () => {
      if (socket !== ws) return;
      socket = null;
      if (closed) return;
      handlers.onStatus('lost');
      const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 8000;
      attempt++;
      retryTimer = window.setTimeout(open, delay);
    });
  }

  open();

  return {
    send(message) {
      if (socket !== null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    drop() {
      socket?.close();
    },
    close() {
      closed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
      socket = null;
    },
  };
}
