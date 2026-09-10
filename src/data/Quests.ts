/** Zone + boss + level quests (data-driven — add entries, no game-logic changes). */

export type QuestKind = 'slay' | 'boss' | 'level';

export interface QuestReward {
  gold?: number;
  xp?: number;
  potions?: number;
  /** Grant a leveled drop (boss finales). Falls at your feet when the bag is full. */
  itemLevel?: number;
}

export interface QuestDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  kind: QuestKind;
  /** Zone scope for slay/boss quests (matches ZoneDef.id). */
  zoneId?: string;
  /** Boss display name for boss quests (matches ZoneDef boss.name). */
  boss?: string;
  /** Kill target for slay quests. */
  count?: number;
  /** Required level for level quests. */
  level?: number;
  reward: QuestReward;
}

/** Per-hero progress (persisted on CharacterSave.quests — all fields optional-tolerant). */
export interface QuestProgress {
  count: number;
  claimed: boolean;
}

export const QUESTS: QuestDef[] = [
  {
    id: 'meadow_cull', name: 'Meadow Cull', icon: '🌱',
    desc: 'Slay 10 monsters in Greenmeadow.',
    kind: 'slay', zoneId: 'meadow', count: 10,
    reward: { gold: 60, xp: 60 },
  },
  {
    id: 'meadow_boss', name: 'Hulk Down', icon: '🎃',
    desc: 'Slay Pumpkin Hulk in Greenmeadow.',
    kind: 'boss', zoneId: 'meadow', boss: 'Pumpkin Hulk',
    reward: { gold: 150, xp: 120, potions: 1 },
  },
  {
    id: 'path_chosen', name: 'Path of the Chosen', icon: '⭐',
    desc: 'Reach Lv10 and choose a job at the Haven Sanctum.',
    kind: 'level', level: 10,
    reward: { gold: 100, potions: 1 },
  },
  {
    id: 'crypt_cull', name: 'Crypt Cull', icon: '🕯️',
    desc: 'Slay 12 monsters in the Sunken Crypt.',
    kind: 'slay', zoneId: 'crypt', count: 12,
    reward: { gold: 200, xp: 220 },
  },
  {
    id: 'crypt_boss', name: 'Crypt Lord Falls', icon: '💀',
    desc: 'Slay the Crypt Lord in the Sunken Crypt.',
    kind: 'boss', zoneId: 'crypt', boss: 'Crypt Lord',
    reward: { gold: 400, xp: 420, potions: 1 },
  },
  {
    id: 'path_elite', name: 'Elite Ascendant', icon: '💫',
    desc: 'Reach Lv20 and claim your ultimate.',
    kind: 'level', level: 20,
    reward: { gold: 300, potions: 1 },
  },
  {
    id: 'ember_cull', name: 'Ashen Cull', icon: '🔥',
    desc: 'Slay 15 monsters in the Ember Wastes.',
    kind: 'slay', zoneId: 'ember', count: 15,
    reward: { gold: 600, xp: 800 },
  },
  {
    id: 'ember_boss', name: 'Tyrant Slain', icon: '🌋',
    desc: 'Slay the Cinder Tyrant in the Ember Wastes.',
    kind: 'boss', zoneId: 'ember', boss: 'Cinder Tyrant',
    reward: { gold: 1200, xp: 1500, itemLevel: 25 },
  },
  {
    id: 'wilds_cull', name: 'Wilds Cull', icon: '❄️',
    desc: 'Slay 18 monsters in the Howling Wilds.',
    kind: 'slay', zoneId: 'wilds', count: 18,
    reward: { gold: 1200, xp: 1500 },
  },
  {
    id: 'wilds_boss', name: 'Hornfather Falls', icon: '🦌',
    desc: 'Slay the Hornfather in the Howling Wilds.',
    kind: 'boss', zoneId: 'wilds', boss: 'The Hornfather',
    reward: { gold: 2500, xp: 3000, itemLevel: 35 },
  },
];

export function questById(id: string): QuestDef | null {
  return QUESTS.find((q) => q.id === id) ?? null;
}

export function blankProgress(): QuestProgress {
  return { count: 0, claimed: false };
}

export function isComplete(def: QuestDef, p: QuestProgress): boolean {
  if (def.kind === 'slay') return p.count >= (def.count ?? 1);
  if (def.kind === 'boss') return p.count >= 1;
  return false;
}

/** "7/10" · "Slain ✓" · "Lv 10" — level quests resolve live, not from progress. */
export function progressText(def: QuestDef, p: QuestProgress, heroLevel: number): string {
  if (p.claimed) return '✓ claimed';
  if (def.kind === 'slay') return `${Math.min(p.count, def.count ?? 1)}/${def.count ?? 1}`;
  if (def.kind === 'boss') return p.count >= 1 ? '✓ slain' : 'not slain';
  return heroLevel >= (def.level ?? 1) ? '✓ done' : `Lv ${heroLevel}/${def.level ?? 1}`;
}

export function rewardText(def: QuestDef): string {
  const r = def.reward;
  const parts: string[] = [];
  if (r.gold) parts.push(`+${r.gold}g`);
  if (r.xp) parts.push(`+${r.xp} XP`);
  if (r.potions) parts.push(`+${r.potions} potion`);
  if (r.itemLevel) parts.push(`Lv${r.itemLevel} drop`);
  return parts.join(' · ');
}
