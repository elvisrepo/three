/** Lv10 job advancement — each starter class splits into two jobs, each with one active skill (key 2). */

import type { StarterClass } from './Classes';

export interface JobSkillDef {
  id: string;
  name: string;
  icon: string;
  cooldown: number;
  desc: string;
}

export interface JobDef {
  id: string;
  name: string;
  baseClass: StarterClass;
  icon: string;
  desc: string;
  bonus: { maxHp: number; damage: number; crit: number };
  skill: JobSkillDef;
}

export const ADVANCE_LEVEL = 10;

export const JOBS: JobDef[] = [
  {
    id: 'knight',
    name: 'Knight',
    baseClass: 'warrior',
    icon: '🛡️',
    desc: 'Unbreakable wall. Hurls a piercing shield.',
    bonus: { maxHp: 45, damage: 4, crit: 0 },
    skill: { id: 'shield_throw', name: 'Shield Throw', icon: '🛡️', cooldown: 5, desc: 'Throw shield for 2.6x damage.' },
  },
  {
    id: 'berserker',
    name: 'Berserker',
    baseClass: 'warrior',
    icon: '🪓',
    desc: 'Spinning death. Whirlwind hits all around.',
    bonus: { maxHp: 20, damage: 8, crit: 0.02 },
    skill: { id: 'whirlwind', name: 'Whirlwind', icon: '🌪️', cooldown: 6, desc: 'Spin: 1.8x to all within 4m.' },
  },
  {
    id: 'hunter',
    name: 'Hunter',
    baseClass: 'archer',
    icon: '🎯',
    desc: 'Volley specialist. Fan of three shots.',
    bonus: { maxHp: 20, damage: 6, crit: 0.02 },
    skill: { id: 'multishot', name: 'Multishot', icon: '🎯', cooldown: 5, desc: '3 arrows, 1.3x each.' },
  },
  {
    id: 'assassin',
    name: 'Assassin',
    baseClass: 'archer',
    icon: '🗡️',
    desc: 'Strikes from shadow. Dash + execute.',
    bonus: { maxHp: 15, damage: 7, crit: 0.03 },
    skill: { id: 'shadowstrike', name: 'Shadowstrike', icon: '🌙', cooldown: 7, desc: 'Dash 10m, 2.6x landing burst.' },
  },
  {
    id: 'pyromancer',
    name: 'Pyromancer',
    baseClass: 'mage',
    icon: '☄️',
    desc: 'Sky-fire caller. Meteor devastates an area.',
    bonus: { maxHp: 15, damage: 6, crit: 0 },
    skill: { id: 'meteor', name: 'Meteor', icon: '☄️', cooldown: 8, desc: '3.2x fire blast after 0.7s.' },
  },
  {
    id: 'cryomancer',
    name: 'Cryomancer',
    baseClass: 'mage',
    icon: '❄️',
    desc: 'Battlefield control. Freezing nova slows.',
    bonus: { maxHp: 25, damage: 5, crit: 0 },
    skill: { id: 'frost_nova', name: 'Frost Nova', icon: '❄️', cooldown: 7, desc: '1.6x + 50% slow, 4.5m.' },
  },
];

export function jobsFor(base: StarterClass): JobDef[] {
  return JOBS.filter((j) => j.baseClass === base);
}

export function jobById(id: string | null): JobDef | null {
  if (!id) return null;
  return JOBS.find((j) => j.id === id) ?? null;
}
