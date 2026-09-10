/** Compare tooltip + item tooltip HTML builders (pure — no DOM, no game state). */

import { affixLabel, itemStats, sellPrice, RARITY_COLOR, type ItemInstance } from '../items/Items';
import { isRiftKey, keyTier, riftTier } from '../data/Rifts';

/** `title` text for hover tooltips (plain text, newlines). */
export function itemTooltip(it: ItemInstance): string {
  if (it.kind === 'consumable') {
    if (isRiftKey(it.baseId)) {
      const t = riftTier(keyTier(it.baseId));
      return `${it.icon} ${it.name}\nClick: open a Tier ${t.tier} rift (Lv${t.minLevel}+, consumed on use)\n${t.desc}\nSell: ${sellPrice(it)}g`;
    }
    return `${it.icon} ${it.name}\nClick: teleport to Haven (consumed on use)\nSell: ${sellPrice(it)}g`;
  }
  const lines = [
    `${it.icon} ${it.name} (Lv${it.levelReq})`,
    it.dmg > 0 ? `Damage: ${it.dmg}` : '',
    it.armor > 0 ? `Armor: ${it.armor}` : '',
    ...it.affixes.map((a) => affixLabel(a)),
    `Sell: ${sellPrice(it)}g`,
  ].filter((l) => l.length > 0);
  return lines.join('\n');
}

/** Full compare-panel innerHTML for `item` vs equipped (null = nothing equipped). */
export function compareHtml(item: ItemInstance, equipped: ItemInstance | null, playerLevel: number): string {
  if (item.kind === 'consumable') {
    if (isRiftKey(item.baseId)) {
      const t = riftTier(keyTier(item.baseId));
      return (
        `<b>${item.icon} ${item.name}</b>` +
        `<div class="dim">Click in bag: open a Tier ${t.tier} rift (Lv${t.minLevel}+).<br>${t.desc}<br>Consumed on use · sells for ${sellPrice(item)}g.</div>`
      );
    }
    return (
      `<b>${item.icon} ${item.name}</b>` +
      `<div class="dim">Click in bag: teleport to Haven.<br>Consumed on use · sells for ${sellPrice(item)}g.</div>`
    );
  }
  const a = itemStats(item);
  const b = equipped ? itemStats(equipped) : { dmg: 0, armor: 0, hp: 0, crit: 0, lifesteal: 0 };
  const row = (label: string, av: number, bv: number, suffix = ''): string => {
    const d = av - bv;
    const cls = d > 0 ? 'better' : d < 0 ? 'worse' : '';
    const diff = d !== 0 ? ` <span class="${cls}">(${d > 0 ? '+' : ''}${d}${suffix})</span>` : '';
    return `<div class="cmp-row"><span>${label}</span><b class="${cls}">${av}${suffix}</b><span class="dim">eq ${bv}${suffix}</span>${diff}</div>`;
  };
  const reqWarn = playerLevel < item.levelReq
    ? `<div class="worse">Requires Lv${item.levelReq}</div>` : '';
  return (
    `<b style="color:${RARITY_COLOR[item.rarity]}">${item.icon} ${item.name}</b>` +
    `<div class="dim">vs ${equipped ? `${equipped.icon} ${equipped.name}` : '— nothing equipped —'}</div>` +
    reqWarn +
    row('Damage', a.dmg, b.dmg) +
    row('Armor', a.armor, b.armor) +
    row('Max HP', a.hp, b.hp) +
    row('Crit %', a.crit, b.crit) +
    row('Lifesteal %', a.lifesteal, b.lifesteal)
  );
}
