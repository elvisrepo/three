/** HUD formatting helpers (pure — no DOM, no game state). */

import { ADVANCE_LEVEL } from '../data/Jobs';
import type { ItemInstance } from '../items/Items';

/** Cooldown sweep height (0-100%). */
export function cdHeight(timer: number, max: number): string {
  if (!(max > 0)) return '0%';
  return `${Math.round((timer / max) * 100)}%`;
}

/** Cooldown number overlay ('' when ready). */
export function cdNum(timer: number): string {
  return timer > 0.05 ? `${Math.ceil(timer)}` : '';
}

/** Player state label for the debug line. */
export function stateText(alive: boolean, attacking: boolean, moving: boolean): string {
  if (!alive) return 'dead';
  if (attacking) return 'attacking';
  if (moving) return 'moving';
  return 'idle';
}

/** Bar width percent with one decimal. Guards divide-by-zero. */
export function barPct(value: number, max: number): string {
  if (!(max > 0)) return '0.0%';
  return `${((value / max) * 100).toFixed(1)}%`;
}

export function potionHtml(potions: number, cooldown: number): { html: string; locked: boolean } {
  const q = cooldown > 0 ? ` (${cooldown.toFixed(0)}s)` : '';
  return { html: `Q<span class="sub">x${potions}${q}</span>`, locked: potions <= 0 };
}

export function tpScrollCount(slots: (ItemInstance | null)[]): number {
  return slots.filter((s) => s?.kind === 'consumable').length;
}

export type InteractKind = 'shop' | 'portal' | 'sanctum' | 'stash' | null;

/** Interact prompt text. `visible=false` means fade the prompt out. */
export function promptFor(
  near: InteractKind,
  interactKey: string,
  job: string | null,
  level: number,
): { text: string; visible: boolean } {
  if (near === 'shop') return { text: `${interactKey} — Trade`, visible: true };
  if (near === 'portal') return { text: `${interactKey} — Travel`, visible: true };
  if (near === 'sanctum') {
    const ready = job === null && level >= ADVANCE_LEVEL;
    return { text: ready ? `${interactKey} — Advance job ⭐` : `${interactKey} — Sanctum (Lv10)`, visible: true };
  }
  if (near === 'stash') return { text: `${interactKey} — Stash`, visible: true };
  return { text: '', visible: false };
}
