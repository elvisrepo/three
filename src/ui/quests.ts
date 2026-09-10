/** Pure HTML builders for the quest log + HUD tracker (Game.ts owns state/DOM). */

import { progressText, rewardText, type QuestDef, type QuestProgress } from '../data/Quests';

export interface QuestEntry {
  def: QuestDef;
  progress: QuestProgress;
}

export function questTrackerHtml(entries: QuestEntry[], heroLevel: number): string {
  if (entries.length === 0) return `<div class="dim">All quests claimed 🏆</div>`;
  return entries.map(({ def, progress }) => {
    const done = progress.claimed;
    return `<div class="quest-row${done ? ' done' : ''}"><span>${def.icon} ${def.name}</span><b>${progressText(def, progress, heroLevel)}</b></div>`;
  }).join('');
}

export function questLogHtml(entries: QuestEntry[], heroLevel: number): string {
  return entries.map(({ def, progress }) => {
    const done = progress.claimed;
    const pct = def.kind === 'slay' && !done
      ? Math.min(100, Math.round((progress.count / (def.count ?? 1)) * 100))
      : done ? 100 : 0;
    return `<div class="quest-card${done ? ' done' : ''}">` +
      `<div class="quest-head"><b>${def.icon} ${def.name}</b><span>${progressText(def, progress, heroLevel)}</span></div>` +
      `<div class="dim">${def.desc}</div>` +
      `<div class="quest-bar"><div style="width:${pct}%"></div></div>` +
      `<div class="quest-reward">🎁 ${rewardText(def)}</div>` +
      `</div>`;
  }).join('');
}
