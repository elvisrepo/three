/** Versioned localStorage persistence for characters. */

import type { ItemInstance } from '../items/Items';
import type { StarterClass, Attrs } from '../data/Classes';
import type { EquipSlots } from '../items/Inventory';

export interface CharacterSave {
  id: string;
  name: string;
  baseClass: StarterClass;
  level: number;
  xp: number;
  gold: number;
  hp: number;
  maxHp: number;
  damage: number;
  crit: number;
  potions: number;
  kills: number;
  playtimeSec: number;
  xpRate: number;
  job: string | null;
  attrs: Attrs;
  statPoints: number;
  inventory: (ItemInstance | null)[];
  equipment: EquipSlots;
  zoneId: string;
  pos: [number, number];
  version: number;
  updatedAt: number;
}

const KEY = 'arpg.chars.v1';
const VER = 1;

function readAll(): CharacterSave[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CharacterSave[];
    return Array.isArray(arr) ? arr.filter((c) => c && c.version === VER) : [];
  } catch {
    return [];
  }
}

function writeAll(chars: CharacterSave[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(chars));
  } catch {
    // storage full/blocked — game still runs, just won't persist
  }
}

export function listChars(): CharacterSave[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveChar(c: CharacterSave): void {
  const all = readAll();
  const idx = all.findIndex((x) => x.id === c.id);
  c.updatedAt = Date.now();
  if (idx === -1) all.push(c);
  else all[idx] = c;
  writeAll(all);
}

export function deleteChar(id: string): void {
  writeAll(readAll().filter((c) => c.id !== id));
}

export function makeCharId(): string {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
}

const STASH_KEY = 'arpg.stash.v1';
const STASH_SIZE = 24;

/** Account-wide shared stash (all heroes, not exported with hero files). */
export function loadSharedStash(): (ItemInstance | null)[] {
  try {
    const raw = localStorage.getItem(STASH_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as (ItemInstance | null)[];
      if (Array.isArray(arr)) {
        return Array.from({ length: STASH_SIZE }, (_, i) => arr[i] ?? null);
      }
    }
  } catch {
    /* corrupted stash — start empty */
  }
  return Array.from({ length: STASH_SIZE }, () => null);
}

export function saveSharedStash(slots: (ItemInstance | null)[]): void {
  try {
    localStorage.setItem(STASH_KEY, JSON.stringify(slots.slice(0, STASH_SIZE)));
  } catch {
    // storage full/blocked — stash just won't persist
  }
}

export { VER as SAVE_VERSION };
