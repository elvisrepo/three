/** Controls / keybind list HTML builder (pure — no DOM, no game state). */

import { BIND_LABELS, BIND_ORDER, codeLabel, type BindAction } from '../core/Keybinds';

/** Full controls list innerHTML. `rebindAction` gets the "press key…" prompt. */
export function controlsListHtml(
  binds: Record<BindAction, string>,
  rebindAction: BindAction | null,
  labels: Record<BindAction, string> = BIND_LABELS,
): string {
  return BIND_ORDER.map((a) => {
    const listening = rebindAction === a;
    return `<div class="ctl-row"><span>${labels[a]}</span>` +
      `<button data-rebind="${a}">${listening ? 'press key…' : codeLabel(binds[a])}</button></div>`;
  }).join('');
}
