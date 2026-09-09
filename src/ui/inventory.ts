/** Inventory panel HTML builders (pure — no DOM, no game state). */

import { sellPrice, type ItemInstance, type ItemSlot } from '../items/Items';
import type { EquipSlots } from '../items/Inventory';
import { itemTooltip } from './compare';

export interface PlayerStatsLine {
  attackDamage: number;
  armor: number;
  hp: number;
  maxHp: number;
  critChance: number;
  lifesteal: number;
}

export function gearStatsText(p: PlayerStatsLine): string {
  return (
    `DMG ${p.attackDamage} · Armor ${p.armor} · ` +
    `HP ${p.hp}/${p.maxHp} · Crit ${Math.round(p.critChance * 100)}% · ` +
    `LS ${p.lifesteal}%`
  );
}

const EQUIP_ORDER: ItemSlot[] = ['weapon', 'helm', 'chest', 'boots', 'ring'];

export function equipRowHtml(slots: EquipSlots): string {
  return EQUIP_ORDER.map((slot) => {
    const it = slots[slot];
    return it
      ? `<div class="equip-slot r-${it.rarity}" data-slot="${slot}" title="${itemTooltip(it)}">${it.icon}<span>${slot}</span></div>`
      : `<div class="equip-slot empty" data-slot="${slot}">+<span>${slot}</span></div>`;
  }).join('');
}

export function invGridHtml(
  items: (ItemInstance | null)[],
  playerLevel: number,
  shopOpen: boolean,
): string {
  return items.map((it) => {
    if (!it) return '<div class="inv-cell empty"></div>';
    const usable = playerLevel >= it.levelReq;
    const tag = shopOpen
      ? `<i>+${sellPrice(it)}g</i>`
      : it.kind === 'consumable' ? '<i>use</i>' : '';
    return `<div class="inv-cell r-${it.rarity}${usable ? '' : ' unusable'}" data-uid="${it.uid}" title="${itemTooltip(it)}">${it.icon}${tag}</div>`;
  }).join('');
}
