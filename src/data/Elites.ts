/** Phase 3 — elite (champion) affixes, data-driven.
 *  Elites are upgraded trash monsters: base resilience bump x rolled affix
 *  mults, gold aggro ring + minimap dot, guaranteed min-magic drop.
 *  Add entries here — no game-logic changes needed. */

/** Base bump every elite gets (multiplied by rolled affix mults). */
export const ELITE_BASE_HP = 2.2;
export const ELITE_BASE_DMG = 1.25;
export const ELITE_XP_MULT = 3;
export const ELITE_SCALE = 1.3;
/** Roll chance per trash spawn (plus a guaranteed elite per zone in Game). */
export const ELITE_CHANCE = 0.1;

export interface EliteAffix {
  id: string;
  title: string;
  icon: string;
  hpMult: number;
  dmgMult: number;
  /** Applied post-construction (Monster.speed is a public field). */
  speedMult: number;
  weight: number;
  minLevel: number;
}

export const ELITE_AFFIXES: EliteAffix[] = [
  { id: 'mighty', title: 'Mighty', icon: '⚔️', hpMult: 1.2, dmgMult: 1.6, speedMult: 1, weight: 3, minLevel: 1 },
  { id: 'tough', title: 'Tough', icon: '🛡️', hpMult: 3.2, dmgMult: 1, speedMult: 1, weight: 3, minLevel: 1 },
  { id: 'swift', title: 'Swift', icon: '💨', hpMult: 1, dmgMult: 1.1, speedMult: 1.4, weight: 2, minLevel: 1 },
  { id: 'savage', title: 'Savage', icon: '🩸', hpMult: 1.8, dmgMult: 1.3, speedMult: 1.1, weight: 2, minLevel: 10 },
  { id: 'juggernaut', title: 'Juggernaut', icon: '👹', hpMult: 4, dmgMult: 1.4, speedMult: 0.95, weight: 2, minLevel: 20 },
];

export interface EliteRoll {
  titles: string[];
  icon: string;
  hpMult: number;
  dmgMult: number;
  speedMult: number;
}

/** Roll elite affixes for a monster level, or null (not elite). `force` skips the chance check. */
export function rollElite(monsterLevel: number, force = false): EliteRoll | null {
  if (!force && Math.random() >= ELITE_CHANCE) return null;
  const pool = ELITE_AFFIXES.filter((a) => monsterLevel >= a.minLevel);
  if (pool.length === 0) return null;
  const pick = (): EliteAffix => {
    let total = 0;
    for (const a of pool) total += a.weight;
    let r = Math.random() * total;
    for (const a of pool) {
      r -= a.weight;
      if (r <= 0) return a;
    }
    return pool[pool.length - 1];
  };
  const first = pick();
  const affixes = [first];
  // High-level elites can roll a second, distinct affix.
  if (monsterLevel >= 20 && Math.random() < 0.35) {
    const rest = pool.filter((a) => a.id !== first.id);
    if (rest.length > 0) {
      let total = 0;
      for (const a of rest) total += a.weight;
      let r = Math.random() * total;
      affixes.push(rest[rest.length - 1]);
      for (const a of rest) {
        r -= a.weight;
        if (r <= 0) {
          affixes[affixes.length - 1] = a;
          break;
        }
      }
    }
  }
  let hpMult = ELITE_BASE_HP;
  let dmgMult = ELITE_BASE_DMG;
  let speedMult = 1;
  for (const a of affixes) {
    hpMult *= a.hpMult;
    dmgMult *= a.dmgMult;
    speedMult *= a.speedMult;
  }
  return {
    titles: affixes.map((a) => a.title),
    icon: affixes[0].icon,
    hpMult,
    dmgMult,
    speedMult,
  };
}
