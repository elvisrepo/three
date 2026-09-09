/** Hero-select list HTML builder (pure — no DOM, no game state). */

import type { CharacterSave } from '../core/SaveManager';

/** Full hero list innerHTML. `zoneName` resolves a zone id to display name. */
export function charListHtml(chars: CharacterSave[], zoneName: (id: string) => string): string {
  if (chars.length === 0) {
    return '<div class="char-empty">No heroes yet — create one below.</div>';
  }
  return chars.map((c) => {
    const zone = zoneName(c.zoneId);
    const when = new Date(c.updatedAt).toLocaleDateString();
    return `<div class="char-row">
      <div><b>${c.name}</b> <span class="dim">${c.baseClass} · Lv${c.level} · ${zone} · x${c.xpRate ?? 1} EXP</span></div>
      <div class="dim">played ${Math.round(c.playtimeSec / 60)}m · ${when}</div>
      <div class="row-btns"><button data-act="load" data-id="${c.id}">Load</button>
      <button data-act="exp" data-id="${c.id}">Export</button>
      <button data-act="del" data-id="${c.id}" class="danger">Delete</button></div>
    </div>`;
  }).join('');
}
