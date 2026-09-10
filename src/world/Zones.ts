/** Phase 2 — data-driven zones. Add Zone 3+ here without touching game logic. */

import type { MonsterSpecies } from '../entities/Monster';

export interface MonsterPack {
  count: number;
  levelMin: number;
  levelMax: number;
}

export interface BossDef {
  name: string;
  level: number;
}

/** Recurring environmental hazard: warns for `warn` sec, then detonates.
 *  Hurts monsters (flat `damage`) AND the player (`pct` of max HP) — dodge it. */
export interface ZoneHazard {
  x: number;
  z: number;
  radius: number;
  damage: number;
  pct: number;
  period: number;
  warn: number;
  color: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  sub: string;
  minLevel: number;
  groundColor: number;
  fogColor: number;
  wallColor: number;
  /** Trash-monster body tint for zone identity. */
  monsterTint: number;
  /** Trash-monster visual species. Absent = legacy capsule. */
  monsterSpecies?: MonsterSpecies;
  /** Boss Mixamo model dir under public/. Absent = capsule. */
  bossModel?: string;
  monsters: MonsterPack | null;
  boss: BossDef | null;
  hazards?: ZoneHazard[];
  hasShop: boolean;
  hasPortal: boolean;
  /** Where the player appears on entering. */
  spawn: [number, number];
  shopPos: [number, number];
  portalPos: [number, number];
  bossPos: [number, number];
  /** Job-advancement sanctum circle (Haven only, [0,0] = unused). */
  sanctumPos: [number, number];
  /** Shared stash chest (Haven only, [0,0] = unused). */
  chestPos: [number, number];
  /** Healing fountain (Haven only, [0,0] = unused). */
  fountainPos: [number, number];
}

export const ZONES: ZoneDef[] = [
  {
    id: 'city',
    name: 'Haven',
    sub: 'Safe town',
    minLevel: 1,
    groundColor: 0x5b6470,
    fogColor: 0x11141c,
    wallColor: 0x3a4150,
    monsterTint: 0x9b5de5,
    monsters: null,
    boss: null,
    hasShop: true,
    hasPortal: true,
    spawn: [0, 6],
    shopPos: [-7, 0],
    portalPos: [7, 0],
    bossPos: [0, -20],
    sanctumPos: [0, -8],
    chestPos: [-4, -6],
    fountainPos: [4, 4],
  },
  {
    id: 'meadow',
    name: 'Greenmeadow',
    sub: 'Lv 1–10',
    minLevel: 1,
    groundColor: 0x35793e,
    fogColor: 0x0b0e14,
    wallColor: 0x24402a,
    monsterTint: 0x9b5de5,
    monsterSpecies: 'goblin',
    monsters: { count: 8, levelMin: 1, levelMax: 4 },
    boss: { name: 'Pumpkin Hulk', level: 8 },
    bossModel: 'models/boss/meadow',
    hasShop: false,
    hasPortal: false,
    spawn: [0, 18],
    shopPos: [0, 0],
    portalPos: [0, 0],
    bossPos: [12, -14],
    sanctumPos: [0, 0],
    chestPos: [0, 0],
    fountainPos: [0, 0],
  },
  {
    id: 'crypt',
    name: 'Sunken Crypt',
    sub: 'Lv 10–20',
    minLevel: 10,
    groundColor: 0x3a3f5e,
    fogColor: 0x0a0a18,
    wallColor: 0x23263d,
    monsterTint: 0x4fd18b,
    monsters: { count: 10, levelMin: 10, levelMax: 13 },
    boss: { name: 'Crypt Lord', level: 15 },
    hasShop: false,
    hasPortal: false,
    spawn: [0, 18],
    shopPos: [0, 0],
    portalPos: [0, 0],
    bossPos: [-12, -14],
    sanctumPos: [0, 0],
    chestPos: [0, 0],
    fountainPos: [0, 0],
  },
  {
    id: 'ember',
    name: 'Ember Wastes',
    sub: 'Lv 20–30',
    minLevel: 20,
    groundColor: 0x5e2f23,
    fogColor: 0x140a08,
    wallColor: 0x332016,
    monsterTint: 0xe25822,
    monsters: { count: 12, levelMin: 20, levelMax: 24 },
    boss: { name: 'Cinder Tyrant', level: 25 },
    hasShop: false,
    hasPortal: false,
    spawn: [0, 18],
    shopPos: [0, 0],
    portalPos: [0, 0],
    bossPos: [0, -18],
    sanctumPos: [0, 0],
    chestPos: [0, 0],
    fountainPos: [0, 0],
  },
  {
    id: 'wilds',
    name: 'Howling Wilds',
    sub: 'Lv 30–40 · dodge the curse vents',
    minLevel: 30,
    groundColor: 0x46536a,
    fogColor: 0x0a0e1a,
    wallColor: 0x232c3d,
    monsterTint: 0xcfe3f5,
    monsterSpecies: 'goblin',
    monsters: { count: 14, levelMin: 30, levelMax: 34 },
    boss: { name: 'The Hornfather', level: 35 },
    bossModel: 'models/boss/wilds',
    hasShop: false,
    hasPortal: false,
    spawn: [0, 18],
    shopPos: [0, 0],
    portalPos: [0, 0],
    bossPos: [0, -18],
    sanctumPos: [0, 0],
    chestPos: [0, 0],
    fountainPos: [0, 0],
    // Gauntlet: staggered curse vents from entry to the arena + arena flanks.
    hazards: [
      { x: -4, z: 10, radius: 2.6, damage: 120, pct: 0.16, period: 3.4, warn: 1.0, color: 0xb44dff },
      { x: 4, z: 4, radius: 2.6, damage: 120, pct: 0.16, period: 3.8, warn: 1.0, color: 0xb44dff },
      { x: -4, z: -2, radius: 3.0, damage: 120, pct: 0.16, period: 4.2, warn: 1.0, color: 0xb44dff },
      { x: 4, z: -8, radius: 3.0, damage: 120, pct: 0.16, period: 3.6, warn: 1.0, color: 0xb44dff },
      { x: -6, z: -14, radius: 3.2, damage: 150, pct: 0.18, period: 4.0, warn: 1.0, color: 0xb44dff },
      { x: 6, z: -14, radius: 3.2, damage: 150, pct: 0.18, period: 4.4, warn: 1.0, color: 0xb44dff },
    ],
  },
];

export function zoneById(id: string): ZoneDef {
  return ZONES.find((z) => z.id === id) ?? ZONES[0];
}
