/** Hero-select list HTML builder (pure — no DOM, no game state). */

import type { CharacterSave } from '../core/SaveManager';
import { jobById } from '../data/Jobs';

const CLASS_ICON: Record<string, string> = { warrior: '⚔️', archer: '🏹', mage: '🔥' };

/** "just now" · "25m ago" · "3h ago" · "yesterday" · "4d ago". */
function ago(ts: number): string {
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function playtime(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 > 0 ? ` ${m % 60}m` : ''}`;
}

/** Full hero list innerHTML. `zoneName` resolves a zone id to display name. */
export function charListHtml(chars: CharacterSave[], zoneName: (id: string) => string): string {
  if (chars.length === 0) {
    return '<div class="char-empty">No heroes yet — create one below.</div>';
  }
  return chars.map((c) => {
    const job = jobById(c.job);
    const cls = job?.name ?? c.baseClass;
    const icon = job?.icon ?? CLASS_ICON[c.baseClass] ?? '⚔️';
    return `<div class="char-row">
      <div class="char-top">
        <div class="char-avatar">${icon}</div>
        <div class="char-main">
          <div class="char-title"><b>${c.name}</b><span class="lvl">Lv${c.level}</span></div>
          <div class="dim">${cls} · ${zoneName(c.zoneId)} · x${c.xpRate ?? 1} EXP</div>
          <div class="dim">${playtime(c.playtimeSec)} played · ${ago(c.updatedAt)}</div>
        </div>
      </div>
      <div class="char-actions"><button class="primary" data-act="load" data-id="${c.id}">▶ Load</button>
      <button data-act="exp" data-id="${c.id}">Export</button>
      <button class="danger" data-act="del" data-id="${c.id}">Delete</button></div>
    </div>`;
  }).join('');
}
