/** Shared stash panel HTML builder (pure — no DOM, no game state). */

import type { ItemInstance } from '../items/Items';
import { itemTooltip } from './compare';

/** Full stash grid innerHTML. */
export function stashGridHtml(slots: (ItemInstance | null)[]): string {
  return slots.map((it) => {
    if (!it) return '<div class="inv-cell empty"></div>';
    return `<div class="inv-cell r-${it.rarity}" data-stash="${it.uid}" title="${itemTooltip(it)}">${it.icon}</div>`;
  }).join('');
}
