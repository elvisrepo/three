/** Phase 3 — endgame rift loop (data-driven).
 *  Rift Keys drop in the Howling Wilds (elites + Hornfather). Click a key in
 *  the bag to open a fixed-tier remix run: scaled trash, more elites, a
 *  re-fight boss, and luck-loaded drops. Add tiers here — no logic changes. */

import { makeUid, type ItemInstance, type ItemRarity } from '../items/Items';

export interface RiftBoss {
  name: string;
  level: number;
  /** Boss Mixamo model dir under public/. */
  model?: string;
  magma?: boolean;
  portals?: boolean;
  sky?: boolean;
  slam?: boolean;
}

export interface RiftTier {
  tier: number;
  keyName: string;
  icon: string;
  /** Player level required to open. */
  minLevel: number;
  monsterMin: number;
  monsterMax: number;
  monsterCount: number;
  eliteChance: number;
  hpMult: number;
  dmgMult: number;
  /** Rarity luck bonus on rift drops (see rollRarity). */
  luck: number;
  boss: RiftBoss;
  desc: string;
}

export const RIFT_TIERS: RiftTier[] = [
  {
    tier: 1,
    keyName: 'Cracked Rift Key',
    icon: '🗝️',
    minLevel: 35,
    monsterMin: 35,
    monsterMax: 37,
    monsterCount: 12,
    eliteChance: 0.15,
    hpMult: 1.2,
    dmgMult: 1.1,
    luck: 4,
    boss: { name: 'Cinder Tyrant', level: 38, magma: true, slam: true },
    desc: 'Echo of the Tyrant · boosted drops',
  },
  {
    tier: 2,
    keyName: 'Glowing Rift Key',
    icon: '🔑',
    minLevel: 38,
    monsterMin: 38,
    monsterMax: 40,
    monsterCount: 14,
    eliteChance: 0.2,
    hpMult: 1.4,
    dmgMult: 1.2,
    luck: 8,
    boss: { name: 'The Hornfather', level: 41, model: 'models/boss/wilds', portals: true, sky: true },
    desc: 'Echo of the Hornfather · rich drops',
  },
  {
    tier: 3,
    keyName: 'Infernal Rift Key',
    icon: '🔑',
    minLevel: 40,
    monsterMin: 41,
    monsterMax: 43,
    monsterCount: 16,
    eliteChance: 0.25,
    hpMult: 1.6,
    dmgMult: 1.3,
    luck: 12,
    boss: { name: 'Empowered Hornfather', level: 44, model: 'models/boss/wilds', portals: true, sky: true, slam: true },
    desc: 'Empowered Hornfather · best drops',
  },
];

export function riftTier(tier: number): RiftTier {
  return RIFT_TIERS.find((t) => t.tier === tier) ?? RIFT_TIERS[0];
}

/** Key tier for a player level (drops + gating). */
export function keyTierForLevel(level: number): number {
  if (level >= 40) return 3;
  if (level >= 38) return 2;
  return 1;
}

export function riftKeyBaseId(tier: number): string {
  return `rift_key_${tier}`;
}

export function isRiftKey(baseId: string): boolean {
  return baseId.startsWith('rift_key_');
}

export function keyTier(baseId: string): number {
  const n = parseInt(baseId.slice('rift_key_'.length), 10);
  return Number.isFinite(n) ? n : 1;
}

/** Rift Key consumable: click in the bag to open that tier (consumed on use).
 *  Rarity follows the tier (blue → gold → orange) so keys read at a glance. */
export function makeRiftKey(tier: number, rarity?: ItemRarity): ItemInstance {
  const def = riftTier(tier);
  const r = rarity ?? (tier >= 3 ? 'legendary' : tier === 2 ? 'rare' : 'magic');
  return {
    uid: makeUid(),
    baseId: riftKeyBaseId(tier),
    name: `${def.keyName} (T${def.tier})`,
    slot: 'ring',
    rarity: r,
    levelReq: def.minLevel,
    dmg: 0,
    armor: 0,
    affixes: [],
    value: 150 * tier,
    icon: def.icon,
    kind: 'consumable',
  };
}
