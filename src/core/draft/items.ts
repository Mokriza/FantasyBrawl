/**
 * Which artifacts a hero may carry. An artifact names the roles and the classes it
 * fits; absent lists mean everyone. The same rule serves the starting common artifact
 * and the match rewards, so a priest is never handed a marksman's lens either way.
 */

import type { ContentRegistry, Item } from '../content.js';
import { getClass } from '../content.js';
import type { ClassId } from '../types.js';

export function itemFits(item: Item, heroClassId: ClassId, content: ContentRegistry): boolean {
  const heroClass = getClass(content, heroClassId);
  if (item.roles !== undefined && !item.roles.includes(heroClass.role)) return false;
  if (item.classes !== undefined && !item.classes.includes(heroClass.id)) return false;
  return true;
}

/** Artifacts of a tier that fit a class, in a stable order. */
export function itemsFor(
  heroClassId: ClassId,
  tier: Item['tier'],
  content: ContentRegistry,
): Item[] {
  return Object.values(content.items)
    .filter((item) => item.tier === tier && itemFits(item, heroClassId, content))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
