/** Shop panel HTML builders (pure — no DOM, no game state). */

import { affixLabel, RARITY_COLOR, type ItemInstance } from '../items/Items';

const SCROLL_ROW =
  `<div class="shop-row">` +
  `<div class="shop-icon r-magic">📜</div>` +
  `<div class="shop-info"><b style="color:${RARITY_COLOR.magic}">Scroll of Town Portal</b>` +
  `<div class="dim">Teleport to Haven · consumed on use</div></div>` +
  `<button data-buyscroll="1">20g</button>` +
  `</div>`;

/** Full shop stock innerHTML (scroll row first, then stock). */
export function shopStockHtml(stock: ItemInstance[], gold: number, playerLevel: number): string {
  return SCROLL_ROW + stock.map((it) => {
    const stats = [
      it.dmg > 0 ? `${it.dmg} dmg` : '',
      it.armor > 0 ? `${it.armor} arm` : '',
      ...it.affixes.map((a) => affixLabel(a)),
    ].filter((s) => s.length > 0).join(' · ');
    const afford = gold >= it.value;
    const req = playerLevel >= it.levelReq;
    return `<div class="shop-row">
      <div class="shop-icon r-${it.rarity}">${it.icon}</div>
      <div class="shop-info"><b style="color:${RARITY_COLOR[it.rarity]}">${it.name}</b>
      <div class="dim">${stats} · Lv${it.levelReq}</div></div>
      <button data-buy="${it.uid}" ${afford && req ? '' : 'disabled'}>${it.value}g</button>
    </div>`;
  }).join('');
}
