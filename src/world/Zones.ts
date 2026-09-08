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
  monsters: MonsterPack | null;
  boss: BossDef | null;
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
    boss: { name: 'Dire Wolf Alpha', level: 8 },
    hasShop: false,
    hasPortal: false,
    spawn: [0, 18],
    shopPos: [0, 0],
    portalPos: [0, 0],
    bossPos: [12, -14],
    sanctumPos: [0, 0],
    chestPos: [0, 0],
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
  },
];

export function zoneById(id: string): ZoneDef {
  return ZONES.find((z) => z.id === id) ?? ZONES[0];
}
