/** Remappable action keybinds (movement keys stay fixed: WASD/arrows). */

export type BindAction =
  | 'fire' | 'job' | 'ult' | 'potion' | 'blink' | 'dodge'
  | 'interact' | 'tp' | 'bag' | 'char' | 'mute';

export const BIND_LABELS: Record<BindAction, string> = {
  fire: 'Fireball',
  job: 'Job skill',
  ult: 'Ultimate',
  potion: 'Potion',
  blink: 'Blink',
  dodge: 'Dodge',
  interact: 'Interact',
  tp: 'Town portal',
  bag: 'Inventory',
  char: 'Character',
  mute: 'Mute',
};

export const BIND_ORDER: BindAction[] = [
  'fire', 'job', 'ult', 'potion', 'blink', 'dodge', 'interact', 'tp', 'bag', 'char', 'mute',
];

export const DEFAULT_BINDS: Record<BindAction, string> = {
  fire: 'Digit1',
  job: 'Digit2',
  ult: 'Digit3',
  potion: 'KeyQ',
  blink: 'KeyE',
  dodge: 'Space',
  interact: 'KeyF',
  tp: 'KeyT',
  bag: 'KeyI',
  char: 'KeyC',
  mute: 'KeyM',
};

const KEY = 'arpg.binds.v1';

let cache: Record<BindAction, string> | null = null;

export function getBinds(): Record<BindAction, string> {
  if (cache) return cache;
  const out: Record<BindAction, string> = { ...DEFAULT_BINDS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Partial<Record<BindAction, string>>;
      for (const a of BIND_ORDER) {
        if (typeof obj[a] === 'string' && (obj[a] as string).length > 0) out[a] = obj[a] as string;
      }
    }
  } catch {
    /* corrupted binds — fall back to defaults */
  }
  cache = out;
  return out;
}

/** Bind `code` to `action`, swapping with whatever held it (no duplicates, no dead ends). */
export function setBind(action: BindAction, code: string): void {
  const binds = getBinds();
  for (const a of BIND_ORDER) {
    if (a !== action && binds[a] === code) binds[a] = binds[action];
  }
  binds[action] = code;
  try {
    localStorage.setItem(KEY, JSON.stringify(binds));
  } catch {
    /* storage blocked — binds still hold for the session */
  }
}

/** Human label for a KeyboardEvent.code. */
export function codeLabel(code: string): string {
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  const special: Record<string, string> = {
    Space: 'Space', Escape: 'Esc', Tab: 'Tab', ShiftLeft: 'Shift', ShiftRight: 'Shift',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  };
  return special[code] ?? code;
}
