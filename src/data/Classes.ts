/** Starter classes — picked once at character creation. */

export type StarterClass = 'warrior' | 'archer' | 'mage';

/** Core attributes. Effects: STR +1 DMG/2pts · DEX +0.5% crit/pt · INT +3% fireball/pt · VIT +6 HP/pt */
export interface Attrs {
  str: number;
  dex: number;
  int: number;
  vit: number;
}

export interface ClassDef {
  id: StarterClass;
  name: string;
  desc: string;
  icon: string;
  color: number;
  maxHp: number;
  damage: number;
  speed: number;
  crit: number;
  fireMult: number;
  attrs: Attrs;
  /** Optional Mixamo model dir under public/ (e.g. 'models/player/warrior'). Absent = capsule fallback. */
  model?: string;
}

export const CLASSES: Record<StarterClass, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    desc: 'Tanky melee. +HP, +damage.',
    icon: '⚔️',
    color: 0x4da3ff,
    maxHp: 130,
    damage: 15,
    speed: 6,
    crit: 0.08,
    fireMult: 0.9,
    attrs: { str: 8, dex: 5, int: 3, vit: 7 },
    model: 'models/player/warrior',
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    desc: 'Fast skirmisher. +speed, +crit.',
    icon: '🏹',
    color: 0x5dff6b,
    maxHp: 95,
    damage: 13,
    speed: 6.8,
    crit: 0.15,
    fireMult: 1.0,
    attrs: { str: 5, dex: 8, int: 4, vit: 5 },
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    desc: 'Fireball specialist. 1.5x fire.',
    icon: '🔥',
    color: 0xc77dff,
    maxHp: 85,
    damage: 11,
    speed: 5.8,
    crit: 0.1,
    fireMult: 1.5,
    attrs: { str: 3, dex: 5, int: 9, vit: 4 },
  },
};

export const CLASS_IDS: StarterClass[] = ['warrior', 'archer', 'mage'];
