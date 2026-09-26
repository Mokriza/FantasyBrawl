/**
 * A fingerprint of the content, so a client whose build differs from the server's is
 * turned away before the first move: with different numbers the two would replay the
 * same log into different games.
 */

import type { ContentRegistry } from '../core/index.js';

/** FNV-1a over the registry as JSON; its key order comes from the files, so it is stable. */
export function contentHash(content: ContentRegistry): string {
  const text = JSON.stringify(content);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
