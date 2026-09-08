# AGENTS.md — 3jsgame contributor guide

Three.js isometric ARPG (Diablo/PoE-like), single-player prototype. Read this before changing code.

## Current state

Playable Phase 2 loop: title → hero select/create (Warrior/Archer/Mage, x1–x10 EXP rate) → Haven
(shop + portal) → Greenmeadow 1–10 + boss → Crypt 10–20 + boss → attrs, loot rarities, TP scrolls,
minimap, blink, localStorage saves with export/import. **Lv10 job advancement is in** (`src/data/Jobs.ts`,
6 jobs each with a key-2 skill). Design doc: `ARPG_PLAN.md`. Future (accounts, multiplayer, security,
monetization) is **documented, not built** — see `ARPG_PLAN.md` §15 and "Product constraints" below.

## Stack & commands

- Vite + TypeScript (strict) + Three.js. UI is an **HTML overlay** (`index.html` + `src/style.css`),
  never in-canvas text.
- `npm run dev` — play at http://localhost:5173 · `npm run build` — typecheck + production build.
- Saves live in browser `localStorage` key `arpg.chars.v1` (versioned `CharacterSave`).

## Layout

- `src/core/Game.ts` — game loop, camera, input, combat wiring, zone switching, all HUD/panel rendering.
- `src/core/SaveManager.ts` — versioned persistence (localStorage today, backend later). Keep this interface stable.
- `src/core/StateMachine.ts` — Title / City / Zone.
- `src/entities/` — `Player` (attrs, HP/XP, movement), `Monster` (aggro/chase/leash/dead AI + HP bars),
  `Boss` (slam telegraph + summons, composition over `Monster`), `DamageNumbers` + `ProjectilePool`
  (both **pooled — no per-frame allocation**).
- `src/combat/Stats.ts` — XP curve, damage rolls, level bonuses.
- `src/items/` — `Items.ts` (bases, rarities, affixes, drop/shop generation, TP scroll, compare helper),
  `Inventory.ts` (24-slot bag + 5 gear slots + gold).
- `src/world/` — `Terrain.ts` (one 60×60 ground, recolored per zone), `Zones.ts` (**data-driven zone defs**),
  `Loot.ts` (rarity beams, walk-over pickup).
- `src/data/Classes.ts` — starter classes + `Attrs` (STR +1 DMG/2 · DEX +0.5% crit · INT +3% fire · VIT +6 HP).
- `docs/diagrams/` — Mermaid system-design docs (MVP + future online architecture). New diagrams go here.

## Conventions (follow these)

- `tsconfig` has `noUnusedLocals` + `noUnusedParameters` — `npm run build` **must** pass before finishing.
  Unused fn params: prefix with `_`.
- Content over code: new zones/items/classes go in `Zones.ts` / `Items.ts` / `Classes.ts`, not in `Game.ts` logic.
- Transient world objects (projectiles, floaters, loot meshes) must be pooled or explicitly disposed.
- Player/monster sim code must not touch the DOM; `Game.ts` is the only DOM writer.
- Item/character identity: `makeUid()` / `makeCharId()` — keep UIDs on everything of value.
- Save format changes: bump `SAVE_VERSION`, keep `readAll` tolerant (filter by version), keep old saves loadable
  (`??` fallbacks for new fields, recompute derived totals — see `applySave`).
- Attribute/gear bonuses are **delta-applied** (`prevGear` / `prevAttr`) — never add the same bonus twice;
  use `refreshGear()` / `refreshAttributes()`, don't hand-edit totals elsewhere.

## Product constraints (from roadmap — do not violate)

- Stay server-authoritative-ready: validate nothing client-side that will matter online; keep sim decoupled
  from render; no "exactly one player" assumptions in new systems.
- **No auth, networking, crypto, or payment code yet.** No secrets/API keys in the repo or in `VITE_*` vars.
  Real money later = provider webhooks (Stripe/Xsolla/Steam) granting entitlements server-side — nothing to build now.

## Working agreements

- Verify with `npm run build`; playtest via `npm run dev` when touching gameplay.
- Small, reviewable diffs; prefer editing existing files over new ones.
- Don't commit/push unless asked. Don't add dependencies without asking.
