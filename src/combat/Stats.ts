/** Shared combat tuning — Phase 1 toy values, easy to rebalance. */

export function xpNeed(level: number): number {
  return Math.floor(25 * Math.pow(level, 1.5)) + 15;
}

export interface DamageRoll {
  amount: number;
  isCrit: boolean;
}

export function rollPlayerDamage(base: number, critChance = 0.1, critMult = 1.6): DamageRoll {
  const isCrit = Math.random() < critChance;
  const variance = 0.85 + Math.random() * 0.3;
  const amount = Math.max(1, Math.round(base * variance * (isCrit ? critMult : 1)));
  return { amount, isCrit };
}

export function rollMonsterDamage(base: number): number {
  const variance = 0.8 + Math.random() * 0.4;
  return Math.max(1, Math.round(base * variance));
}

/** Player growth per level — small but noticeable. */
export function playerLevelUpBonus(level: number): { maxHp: number; damage: number } {
  return {
    maxHp: 14,
    damage: 2 + Math.floor(level / 3),
  };
}
