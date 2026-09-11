/** Phase 3 — trash archetypes (data-driven creep variance).
 *  Every zone rolls each spawn from its roster: chasers hold the zone tint,
 *  while brute (red) / skitterer (yellow) / spitter (purple) read at a glance.
 *  Add archetypes or reweight rosters here — no logic changes. */

export interface RangedKit {
  range: number;
  cooldown: number;
  dmgMult: number;
  color: number;
}

export interface CreatureArchetype {
  id: string;
  hpMult: number;
  dmgMult: number;
  speedMult: number;
  scale: number;
  xpMult: number;
  /** Skin tint override (absent = zone monsterTint). */
  tint?: number;
  /** Present = keeps its distance and spits bolts (melee bite up close). */
  ranged?: RangedKit;
}

export const CREATURES: Record<string, CreatureArchetype> = {
  chaser: { id: 'chaser', hpMult: 1, dmgMult: 1, speedMult: 1, scale: 1, xpMult: 1 },
  brute: { id: 'brute', hpMult: 2.6, dmgMult: 1.25, speedMult: 0.8, scale: 1.3, xpMult: 2, tint: 0xb03a2e },
  skitterer: { id: 'skitterer', hpMult: 0.55, dmgMult: 0.75, speedMult: 1.5, scale: 0.78, xpMult: 0.8, tint: 0xd9c53a },
  spitter: {
    id: 'spitter', hpMult: 0.8, dmgMult: 0.9, speedMult: 0.95, scale: 0.9, xpMult: 1.5, tint: 0x7b2ff7,
    ranged: { range: 11, cooldown: 2.6, dmgMult: 0.8, color: 0xc07bff },
  },
};

export interface RosterEntry {
  creature: string;
  weight: number;
}

/** Weighted roll from a zone roster. Unknown ids ignored; empty roster = chaser. */
export function rollCreature(roster: RosterEntry[] | undefined): CreatureArchetype {
  const pool = (roster ?? []).filter((e) => e.weight > 0 && CREATURES[e.creature]);
  if (pool.length === 0) return CREATURES.chaser;
  let total = 0;
  for (const e of pool) total += e.weight;
  let r = Math.random() * total;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) return CREATURES[e.creature];
  }
  return CREATURES[pool[pool.length - 1].creature];
}
