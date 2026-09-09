/** Character panel HTML builders (pure — no DOM, no game state). */

import type { Attrs } from '../data/Classes';
import { ADVANCE_LEVEL, ULT_LEVEL, type JobDef } from '../data/Jobs';

export interface CharSnapshot {
  charName: string;
  classIcon: string;
  className: string;
  level: number;
  xp: number;
  xpNext: number;
  xpRate: number;
  statPoints: number;
  attrs: Attrs;
  attackDamage: number;
  buffActive: boolean;
  armor: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  critChance: number;
  lifesteal: number;
  fireMult: number;
}

/** Job status line under the char header. */
export function jobLineHtml(job: JobDef | null, playerLevel: number): string {
  if (job) {
    const ult = playerLevel >= ULT_LEVEL
      ? ` · ${job.ultimate.icon} ${job.ultimate.name} (3)`
      : ` · ??? (3 at Lv${ULT_LEVEL})`;
    return `<div class="dim">${job.icon} ${job.name} · ${job.skill.icon} ${job.skill.name} (2)${ult}</div>`;
  }
  if (playerLevel >= ADVANCE_LEVEL) {
    return `<div class="dim">⭐ Step into the golden Sanctum in Haven</div>`;
  }
  return `<div class="dim">Job advancement at Lv${ADVANCE_LEVEL}</div>`;
}

function attrRow(key: keyof Attrs, label: string, effect: string, value: number, canAlloc: boolean): string {
  return `<div class="attr-row"><span><b>${label}</b> ${value}</span>` +
    `<span class="dim">${effect}</span>` +
    `<button data-alloc="${key}" ${canAlloc ? '' : 'disabled'}>+</button></div>`;
}

export function derivedHtml(s: CharSnapshot): string {
  return (
    `DMG ${s.attackDamage}${s.buffActive ? ' 😡x2' : ''} · Armor ${s.armor}<br>` +
    `HP ${s.hp}/${s.maxHp} · MP ${Math.floor(s.mana)}/${s.maxMana} · Crit ${Math.round(s.critChance * 100)}%<br>` +
    `Lifesteal ${s.lifesteal}% · Fire x${s.fireMult.toFixed(2)}`
  );
}

/** Full char panel body innerHTML (renderChar). Live refresh stays text-node only in Game. */
export function charBodyHtml(s: CharSnapshot, jobHtml: string): string {
  const canAlloc = s.statPoints > 0;
  return (
    `<div class="char-head">${s.classIcon} <b>${s.charName}</b> <span class="dim">${s.className} · Lv${s.level}</span></div>` +
    jobHtml +
    `<div class="dim" id="char-xp">XP ${Math.floor(s.xp)}/${s.xpNext} · x${s.xpRate} EXP rate</div>` +
    `<div class="stat-points" id="char-points">⭐ ${s.statPoints} stat point${s.statPoints === 1 ? '' : 's'} — +3 per level</div>` +
    attrRow('str', 'STR', '+1 DMG / 2', s.attrs.str, canAlloc) +
    attrRow('dex', 'DEX', '+0.5% crit each', s.attrs.dex, canAlloc) +
    attrRow('int', 'INT', '+3% fireball each', s.attrs.int, canAlloc) +
    attrRow('vit', 'VIT', '+6 HP each', s.attrs.vit, canAlloc) +
    `<div class="derived" id="char-derived">${derivedHtml(s)}</div>`
  );
}

export function charXpText(xp: number, xpNext: number, xpRate: number): string {
  return `XP ${Math.floor(xp)}/${xpNext} · x${xpRate} EXP rate`;
}

export function charPointsText(statPoints: number): string {
  return `⭐ ${statPoints} stat point${statPoints === 1 ? '' : 's'} — +3 per level`;
}
