/** Phase 2 — data-driven items: bases, rarities, affixes, drop + shop generation. */

export type ItemRarity = 'normal' | 'magic' | 'rare' | 'legendary';
export type ItemSlot = 'weapon' | 'helm' | 'chest' | 'boots' | 'ring';

export type AffixStat = 'dmg' | 'hp' | 'armor' | 'crit' | 'lifesteal';

export interface Affix {
  stat: AffixStat;
  value: number;
}

export interface ItemInstance {
  uid: string;
  baseId: string;
  name: string;
  slot: ItemSlot;
  rarity: ItemRarity;
  levelReq: number;
  dmg: number;
  armor: number;
  affixes: Affix[];
  value: number;
  icon: string;
  /** Gear equips; consumables (TP scroll) are used from the bag. */
  kind: 'gear' | 'consumable';
}

interface ItemBase {
  id: string;
  name: string;
  slot: ItemSlot;
  dmg: number;
  armor: number;
  icon: string;
  minLvl: number;
}

const BASES: ItemBase[] = [
  { id: 'rusty_sword', name: 'Rusty Sword', slot: 'weapon', dmg: 4, armor: 0, icon: '🗡️', minLvl: 1 },
  { id: 'woodsman_axe', name: 'Woodsman Axe', slot: 'weapon', dmg: 6, armor: 0, icon: '🪓', minLvl: 1 },
  { id: 'club', name: 'Oak Club', slot: 'weapon', dmg: 5, armor: 0, icon: '🏏', minLvl: 1 },
  { id: 'short_bow', name: 'Short Bow', slot: 'weapon', dmg: 5, armor: 0, icon: '🏹', minLvl: 2 },
  { id: 'apprentice_staff', name: 'Apprentice Staff', slot: 'weapon', dmg: 6, armor: 0, icon: '🪄', minLvl: 3 },
  { id: 'soldier_blade', name: 'Soldier Blade', slot: 'weapon', dmg: 9, armor: 0, icon: '⚔️', minLvl: 5 },
  { id: 'hunter_bow', name: 'Hunter Bow', slot: 'weapon', dmg: 10, armor: 0, icon: '🏹', minLvl: 8 },
  { id: 'crypt_mace', name: 'Crypt Mace', slot: 'weapon', dmg: 14, armor: 0, icon: '🔨', minLvl: 10 },
  { id: 'runed_staff', name: 'Runed Staff', slot: 'weapon', dmg: 15, armor: 0, icon: '🌟', minLvl: 12 },
  { id: 'cloth_hood', name: 'Cloth Hood', slot: 'helm', dmg: 0, armor: 2, icon: '🪖', minLvl: 1 },
  { id: 'iron_helm', name: 'Iron Helm', slot: 'helm', dmg: 0, armor: 5, icon: '⛑️', minLvl: 5 },
  { id: 'crypt_helm', name: 'Crypt Helm', slot: 'helm', dmg: 0, armor: 8, icon: '🪖', minLvl: 10 },
  { id: 'rags', name: 'Worn Rags', slot: 'chest', dmg: 0, armor: 3, icon: '🥋', minLvl: 1 },
  { id: 'leather_armor', name: 'Leather Armor', slot: 'chest', dmg: 0, armor: 6, icon: '🦺', minLvl: 4 },
  { id: 'plate', name: 'Crypt Plate', slot: 'chest', dmg: 0, armor: 11, icon: '🛡️', minLvl: 10 },
  { id: 'worn_boots', name: 'Worn Boots', slot: 'boots', dmg: 0, armor: 2, icon: '🥾', minLvl: 1 },
  { id: 'swift_boots', name: 'Swift Boots', slot: 'boots', dmg: 0, armor: 5, icon: '👢', minLvl: 6 },
  { id: 'copper_ring', name: 'Copper Ring', slot: 'ring', dmg: 0, armor: 0, icon: '💍', minLvl: 2 },
  { id: 'silver_ring', name: 'Silver Ring', slot: 'ring', dmg: 0, armor: 0, icon: '💍', minLvl: 8 },
  { id: 'ember_ring', name: 'Ember Ring', slot: 'ring', dmg: 0, armor: 0, icon: '💍', minLvl: 18 },
  { id: 'inferno_blade', name: 'Inferno Blade', slot: 'weapon', dmg: 20, armor: 0, icon: '🔥', minLvl: 20 },
  { id: 'magma_plate', name: 'Magma Plate', slot: 'chest', dmg: 0, armor: 16, icon: '🌋', minLvl: 20 },
];

export const RARITY_COLOR: Record<ItemRarity, string> = {
  normal: '#c8c8c8',
  magic: '#5da9ff',
  rare: '#ffd21f',
  legendary: '#ff7b2e',
};

const RARITY_TAG: Record<ItemRarity, string> = {
  normal: '',
  magic: 'Fine ',
  rare: 'Superior ',
  legendary: 'Legendary ',
};

const RARITY_MULT: Record<ItemRarity, number> = {
  normal: 1,
  magic: 1.15,
  rare: 1.35,
  legendary: 1.65,
};

let uidCounter = 0;

export function makeUid(): string {
  uidCounter += 1;
  return `it${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
}

function randi(a: number, b: number): number {
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function rollRarity(luck = 0): ItemRarity {
  const r = Math.random() * 100 + luck;
  if (r >= 98.5) return 'legendary';
  if (r >= 88) return 'rare';
  if (r >= 65) return 'magic';
  return 'normal';
}

const AFFIX_STATS: AffixStat[] = ['dmg', 'hp', 'armor', 'crit', 'lifesteal'];

function rollAffixValue(stat: AffixStat, rarity: ItemRarity): number {
  const leg = rarity === 'legendary';
  switch (stat) {
    case 'dmg': return leg ? randi(3, 7) : randi(1, 4);
    case 'hp': return leg ? randi(15, 35) : randi(6, 18);
    case 'armor': return leg ? randi(3, 6) : randi(1, 4);
    case 'crit': return leg ? randi(2, 4) : randi(1, 3);
    case 'lifesteal': return leg ? randi(2, 4) : randi(1, 3);
  }
}

function rollAffixes(rarity: ItemRarity, slot: ItemSlot): Affix[] {
  let count = 0;
  if (rarity === 'magic') count = 1;
  else if (rarity === 'rare') count = randi(2, 3);
  else if (rarity === 'legendary') count = 3;
  else if (Math.random() < 0.12) count = 1;

  // Rings always carry at least 1 affix (they have no base armor/dmg)
  if (slot === 'ring' && count === 0 && rarity === 'normal') count = 1;

  const stats = [...AFFIX_STATS];
  // Weight: weapons favor dmg, armor favors armor/hp
  if (slot === 'weapon') stats.push('dmg', 'dmg', 'crit');
  else if (slot === 'ring') stats.push('crit', 'lifesteal', 'hp');
  else stats.push('armor', 'hp');

  const out: Affix[] = [];
  const used = new Set<AffixStat>();
  for (let i = 0; i < count && stats.length > 0; i++) {
    const idx = randi(0, stats.length - 1);
    const stat = stats.splice(idx, 1)[0];
    if (used.has(stat)) continue;
    used.add(stat);
    out.push({ stat, value: rollAffixValue(stat, rarity) });
  }
  return out;
}

/** Random level-scaled drop from any base near the player's level. */
export function generateDrop(playerLevel: number, luck = 0, force?: ItemRarity): ItemInstance {
  const pool = BASES.filter((b) => b.minLvl <= playerLevel + 2);
  const base = pool.length > 0 ? pool[randi(0, pool.length - 1)] : BASES[0];
  return buildItem(base, playerLevel, force ?? rollRarity(luck));
}

/** Build a specific base by id (quest gifts, city displays). Falls back to first base. */
export function buildItemById(baseId: string, playerLevel: number, rarity: ItemRarity): ItemInstance {
  const base = BASES.find((b) => b.id === baseId) ?? BASES[0];
  return buildItem(base, playerLevel, rarity);
}

function buildItem(base: ItemBase, playerLevel: number, rarity: ItemRarity): ItemInstance {
  const mult = RARITY_MULT[rarity];
  const growth = 1 + 0.22 * Math.max(0, playerLevel - 1);
  const dmg = base.slot === 'weapon' ? Math.max(1, Math.round(base.dmg * growth * mult)) : 0;
  const armor = base.slot === 'weapon' || base.slot === 'ring'
    ? 0
    : Math.max(1, Math.round(base.armor * growth * mult));
  const affixes = rollAffixes(rarity, base.slot);
  const tierIdx = rarity === 'normal' ? 0 : rarity === 'magic' ? 1 : rarity === 'rare' ? 2 : 3;
  const value = Math.round(
    (8 + dmg * 6 + armor * 8 + affixes.length * 14) *
    (1 + 0.3 * Math.max(0, base.minLvl - 1)) *
    (0.7 + tierIdx * 0.5),
  );
  return {
    uid: makeUid(),
    baseId: base.id,
    name: `${RARITY_TAG[rarity]}${base.name}`,
    slot: base.slot,
    rarity,
    levelReq: base.minLvl,
    dmg,
    armor,
    affixes,
    value: Math.max(4, value),
    icon: base.icon,
    kind: 'gear',
  };
}

/** 6 level-appropriate wares for the Haven shop. */
export function generateShopStock(playerLevel: number): ItemInstance[] {
  const pool = BASES.filter((b) => b.minLvl <= playerLevel + 1);
  const stock: ItemInstance[] = [];
  const forced: ItemRarity[] = ['normal', 'normal', 'magic', 'magic', 'normal', playerLevel >= 4 ? 'rare' : 'magic'];
  // Ensure one weapon + one chest are always offered
  const weapons = pool.filter((b) => b.slot === 'weapon');
  const chests = pool.filter((b) => b.slot === 'chest');
  const others = pool.filter((b) => b.slot !== 'weapon' && b.slot !== 'chest');
  const picks: ItemBase[] = [];
  if (weapons.length > 0) picks.push(weapons[randi(0, weapons.length - 1)]);
  if (chests.length > 0) picks.push(chests[randi(0, chests.length - 1)]);
  for (let i = picks.length; i < 6; i++) {
    picks.push(others.length > 0 ? others[randi(0, others.length - 1)] : pool[randi(0, pool.length - 1)]);
  }
  picks.forEach((base, i) => {
    if (base) stock.push(buildItem(base, playerLevel, forced[i % forced.length]));
  });
  stock.sort((a, b) => a.value - b.value);
  return stock;
}

/** Fixed starter kit: always equipped on a fresh hero. */
export function starterKit(): ItemInstance[] {
  const sword = buildItem(BASES[0], 1, 'normal');
  sword.name = 'Rusty Sword';
  sword.value = 10;
  const rags = buildItem(BASES.find((b) => b.id === 'rags') ?? BASES[11], 1, 'normal');
  rags.name = 'Worn Rags';
  rags.value = 6;
  return [sword, rags];
}

export function affixLabel(a: Affix): string {
  switch (a.stat) {
    case 'dmg': return `+${a.value} Damage`;
    case 'hp': return `+${a.value} Max HP`;
    case 'armor': return `+${a.value} Armor`;
    case 'crit': return `+${a.value}% Crit`;
    case 'lifesteal': return `+${a.value}% Lifesteal`;
  }
}

export interface GearBonus {
  damage: number;
  maxHp: number;
  armor: number;
  crit: number;
  lifesteal: number;
}

export function gearBonus(items: (ItemInstance | null)[]): GearBonus {
  const out: GearBonus = { damage: 0, maxHp: 0, armor: 0, crit: 0, lifesteal: 0 };
  for (const it of items) {
    if (!it) continue;
    out.damage += it.dmg;
    out.armor += it.armor;
    for (const a of it.affixes) {
      if (a.stat === 'dmg') out.damage += a.value;
      else if (a.stat === 'hp') out.maxHp += a.value;
      else if (a.stat === 'armor') out.armor += a.value;
      else if (a.stat === 'crit') out.crit += a.value;
      else if (a.stat === 'lifesteal') out.lifesteal += a.value;
    }
  }
  return out;
}

export function sellPrice(item: ItemInstance): number {
  return Math.max(1, Math.floor(item.value * 0.4));
}

/** Scroll of Town Portal: click in the bag to teleport to Haven. Consumed on use. */
export function makeTpScroll(): ItemInstance {
  return {
    uid: makeUid(),
    baseId: 'tp_scroll',
    name: 'Scroll of Town Portal',
    slot: 'ring',
    rarity: 'magic',
    levelReq: 1,
    dmg: 0,
    armor: 0,
    affixes: [],
    value: 20,
    icon: '📜',
    kind: 'consumable',
  };
}

export interface ItemStatVector {
  dmg: number;
  armor: number;
  hp: number;
  crit: number;
  lifesteal: number;
}

/** Total stat contribution of one item (base + affixes) — used for compare. */
export function itemStats(it: ItemInstance): ItemStatVector {
  const out: ItemStatVector = { dmg: it.dmg, armor: it.armor, hp: 0, crit: 0, lifesteal: 0 };
  for (const a of it.affixes) {
    if (a.stat === 'dmg') out.dmg += a.value;
    else if (a.stat === 'hp') out.hp += a.value;
    else if (a.stat === 'armor') out.armor += a.value;
    else if (a.stat === 'crit') out.crit += a.value;
    else if (a.stat === 'lifesteal') out.lifesteal += a.value;
  }
  return out;
}
