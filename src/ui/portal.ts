/** World portal panel HTML builder (pure — no DOM, no game state). */

import type { ZoneDef } from '../world/Zones';

/** Full portal list innerHTML for all zones. */
export function portalListHtml(zones: ZoneDef[], playerLevel: number, currentZoneId: string): string {
  return zones.map((z) => {
    const locked = playerLevel < z.minLevel;
    const current = z.id === currentZoneId;
    return `<div class="portal-card${locked ? ' locked' : ''}${current ? ' current' : ''}" data-travel="${z.id}">
      <b>${z.name}</b><div class="dim">${z.sub}</div>
      <div class="dim">${locked ? `🔒 Requires Lv${z.minLevel}` : current ? '● here' : 'Enter →'}</div>
    </div>`;
  }).join('');
}
