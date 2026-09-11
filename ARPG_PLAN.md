# Three.js ARPG — Diablo / PoE-like — Design & Build Plan

## 1. TL;DR

Build a single-player, isometric, click-to-move ARPG in **Three.js + TypeScript + Vite**.

Core loop you described maps cleanly to an MVP:

```
Title -> Choose / Load Character -> Hub City (Shop + Portal)
  -> Zone 1-10 (trash + Area Boss -> better loot)
  -> Back to City -> Portal (level-gated) -> Zone 10-20 -> ...
  -> Level thresholds -> Class/Job Advancement -> New skills, power spike
```

Don't start with multiplayer, open world, or procedural story. Start with: **1 city + 2 zones + 3 classes + shop + portal + save/load + 1 boss per zone**. Everything else should be data-driven so you can add Zone 3, 4, N without code changes.

This doc is your blueprint: architecture, systems, data models, folder layout, and phased roadmap.

---

## 2. Game Vision & Pillars

**Fantasy:** Level 1 nobody in town, come back at level 30 with legendary boss loot and a 2nd-job class.

**Pillars (use these to cut scope):**
1. **Kill -> Loot -> Power-up -> Gate** — always 10 min to next dopamine hit.
2. **Readable combat** — few monsters on screen, clear telegraphs, big damage numbers, not bullet-hell.
3. **Build expression** — gear + job choice matters, even if only 4-6 active skills.
4. **Frictionless run** — town -> portal -> zone in <15 sec, no loading pain.

**Camera / Feel target:** Diablo 3 / Torchlight: fixed-angle isometric-ish perspective camera following player, mouse click to move/attack, `1-4 / QWER` for skills, `Tab/I` inventory, `P` portal back to town.

---

## 3. MVP Scope vs. Later

### MVP (v0.1 - playable loop, ~4-6 weeks solo)
- [ ] Title screen: New Character (name + starting class: Warrior / Archer / Mage) + Load/Delete (localStorage)
- [ ] Hub City: small safe map, NPC Shopkeeper (buy starter whites with starting gold), Portal object
- [ ] 2 combat zones: `meadow_1_10`, `crypt_10_20` with different ground texture, props, skybox/fog color
- [ ] Player: click-to-move, basic attack, 2 skills per starter class, HP/MP, XP/level to 20
- [ ] Monsters: 3 trash types per zone (melee chaser, ranged, tanky) + 1 Area Boss per zone with bigger model + HP bar
- [ ] Combat: hit chance / crit, damage numbers, death, respawn at city with full HP
- [ ] Loot: gold + equippable drops (weapon/armor) with rarity: Normal > Magic > Rare, boss = high Rare chance
- [ ] Inventory + Equipment (6-8 slots), drag or right-click equip, compare tooltip
- [ ] Shop: buy/sell, limited starter stock
- [ ] Portal: list of zones, greyed out if `player.level < zone.minLevel`, teleport with fade
- [ ] Job Advancement at Lv10: `Novice/Warrior -> Knight/Berserker` etc., unlock 1 new skill + stat boost
- [ ] Save: auto-save on zone change + manual, JSON in localStorage

Explicitly **out** for MVP: multiplayer, trading, crafting, sockets, seasons, procedural dungeons, pet, minimap fog-of-war, mobile.

### v0.2+
- Zone 20-30, 30-40, endless mapping variant
- 2nd job advancement (Lv30), skill tree (even 2x3 passive grid is enough)
- 4th rarity: Legendary/Unique with fixed boss drops, affix pool
- Stash, consumables (potions), status effects (burn/freeze/stun)
- Minimap, quest tracker ("Kill 10 Slimes", "Kill Boss X"), dialogue
- Sound + music, screen-shake, hit-stop, particles

### v1.0+
- Procedural zone variants from tiles, affix-based elite packs
- Backend saves (Supabase/Firebase) + leaderboard
- Optional co-op via authoritative server (Colyseus / PlayFab) — don't architect for this now, just keep logic decoupled from rendering so you can later.

---

## 4. Tech Stack Recommendation

```
Three.js (r16x) + TypeScript + Vite
  + zustand or plain EventEmitter for UI state (avoid Redux)
  + Tailwind or plain CSS for HUD/menus (HTML overlay, NOT in-canvas)
  + Howler.js for audio
  + (optional) three/addons/Pathfinding or custom grid A*
```

Why this:
- **Three.js only for 3D world.** All UI (inventory, shop, character select) = React-less HTML/CSS overlay. Much faster to iterate, accessible, crisp text.
- **TypeScript is non-negotiable** for stats, items, skills. You will drown in JS bugs otherwise.
- **Vite** for fast HMR. Use `vite-plugin-static-copy` for assets.
- No physics engine needed. You need simple circle collision + height=0. Cannon/ Rapier is overkill.
- No ECS framework needed for MVP. Plain OOP `Entity -> Actor -> Player/Monster` + systems is fine to ~200 entities. Migrate to ECS only if perf demands.

Suggested versions: `three@latest`, `vite@latest`, `typescript@~5.6`.

---

## 5. High-Level Architecture

Keep **simulation** separate from **presentation**:

```
src/
  main.ts            // boot, game loop, resize
  core/
    Game.ts          // owns Scene, states, update(dt)
    StateMachine.ts  // TITLE, CHAR_SELECT, CITY, ZONE, DEAD
    AssetLoader.ts   // GLTF, textures, audio manifest
    SaveManager.ts   // serialize/deserialize
    EventBus.ts
  world/
    ZoneLoader.ts    // builds zone from ZoneDef JSON
    Terrain.ts       // ground plane + obstacles + spawn points
    Portal.ts
    NPCShop.ts
    DayNight? (skip for MVP)
  entities/
    Actor.ts         // hp, stats, move, damage(), die()
    Player.ts
    Monster.ts
    Boss.ts
    ProjectilePool.ts
    DamageNumbers.ts // sprite pool
  combat/
    Stats.ts         // calc damage, crit, mitigation
    Skills.ts        // SkillDef + cooldown + targeting
    AIController.ts  // FSM: idle/aggro/chase/attack/flee/dead
    DropTable.ts     // roll loot
  items/
    ItemDefs.ts      // types + affixes + rarity
    Inventory.ts
    Equipment.ts
  ui/
    HUD.ts           // hp/mp/xp bar, skill bar, buffs
    InventoryUI.ts
    ShopUI.ts
    PortalUI.ts
    CharSelectUI.ts
    ClassAdvanceUI.ts
  data/
    zones.json
    monsters.json
    items.json
    skills.json
    classes.json
```

Game loop:
`requestAnimationFrame -> dt clamp 50ms -> update AI, movement, projectiles, cooldowns -> Three render -> HTML HUD sync (throttled to 10Hz except HP bars)`.

Fixed timestep for logic (e.g. 60Hz accumulator) if you want deterministic drops later, but not required for MVP.

---

## 6. Rendering in Three.js — How to Get Diablo Feel Cheaply

1. **Camera:** `PerspectiveCamera fov 35-40`, positioned at `player + (0, 18, 12)`, `lookAt(player)`, lerp follow. Fixed yaw, slight pitch. Orthographic looks flatter/more Diablo 1 — perspective is easier with shadows. Lock rotation, allow zoom with wheel (10-26 units).
2. **Controls:** Raycaster against ground plane on click. Show click marker (ring mesh fading). Left-click = move; left-click on monster = attack-move; Right-click / `Space` = force attack/primary; `1-4` = skills aiming at cursor.
3. **Ground:** 1 large `PlaneGeometry` with tiled texture per zone + vertex color variation. Add simple edge cliffs / fog to hide bounds. Obstacles = low boxes/cylinders with colliders (circle or AABB).
4. **Characters:** Don't model from scratch. Use **Quaternius / Kenney / Mixamo** low-poly GLBs for MVP. 1 rig, recolor materials per monster tier (tint boss red + scale 1.6x). `SkeletonHelper` + 3 anims: idle/run/attack/death. Use `AnimationMixer`.
5. **Lighting:** 1 `HemisphereLight` + 1 `DirectionalLight` with shadows (2048 map, tight frustum following player). Cheap toon/lambert materials. Fog per zone for mood.
6. **Performance rules:**
   - Cap live monsters ~25-40 per zone, spawn waves via spawners, despawn corpses after 5s (sink + fade).
   - `InstancedMesh` for trees/rocks/pickups/gold, `ObjectPool` for projectiles + damage numbers.
   - No per-frame allocations in `update()`. Reuse `Vector3` temps.
   - Shadows only for actors, not props. Pixel ratio clamp `Math.min(devicePixelRatio, 2)`.

---

## 7. Detailed Systems Design

### 7.1 Character & Save

```ts
interface CharacterSave {
  id: string; name: string;
  baseClass: 'warrior'|'archer'|'mage';
  job: string; // 'warrior' -> 'knight' at 10
  level: number; xp: number; gold: number;
  stats: { str:number; dex:number; int:number; vit:number };
  hp: number; maxHp: number; mp: number; maxMp: number;
  skills: string[]; // unlocked skill ids
  inventory: ItemInstance[]; equipment: Record<Slot, ItemInstance|null>;
  zoneId: string; position: [number,number,number];
  playtimeSec: number; version: number;
}
```

Char select screen reads `localStorage['arpg.chars']`. New char starts Lv1 with 100 gold + rusty weapon from shop tutorial.

### 7.2 Stats & Leveling

Keep formula dead simple for balancing:

- `maxHp = 50 + vit*10 + level*8`
- `physDmg = weaponDmg * (1 + str/50)`, `magicDmg = weaponDmg * (1 + int/50)`
- `mitigation = armor / (armor + 50 + level*10)`
- `critChance = 5% + dex/10`, `critDmg = 150%`
- `xpNeed(level) = floor(20 * level^1.5)` → Lv1-10 fast (~2h), 10-20 slower.
- On level up: +2 stat points auto (or manual if you want PoE-lite) + full heal + floating "LEVEL UP!" + check job advancement.

### 7.3 Class / Job Advancement

Simplest fun version:

```
Lv1: Warrior / Archer / Mage (2 skills each)
Lv10: Choose 1 of 2:
  Warrior -> Knight (tank, shield throw, taunt) | Berserker (2x dmg, lifesteal)
  Archer -> Hunter (pet? skip pet, use traps) | Assassin (dash + backstab)
  Mage -> Pyromancer (burn AoE) | Cryomancer (freeze + control)
Lv30 (post-MVP): 2nd advancement, + ultimate skill (big cooldown 30-60s)
```

Implementation: `classes.json` defines `requiresLevel`, `requiresJob`, `statBonus`, `unlockSkills`. NPC or auto-popup in city + via HUD button when eligible. Changing job = keep gear if valid, swap skill bar, play effect.

### 7.4 Zones, Portal & City

```ts
interface ZoneDef {
  id: string; name: string; minLevel: number; maxLevel: number;
  size: number; groundTexture: string; fogColor: string;
  monsters: { id: string; count: number; level: [number,number] }[];
  boss: { id: string; level: number };
  spawners: { pos:[number,number]; radius:number; intervalSec:number }[];
  portalReturn: 'city';
}
```

Example:
- `city` — safe, no combat, Shop NPC + Portal + respawn point.
- `meadow_1_10` — green, slimes/wolves, Boss: `Dire Wolf Alpha Lv10`.
- `crypt_10_20` — dark, skeletons/cultists, Boss: `Crypt Lord Lv20`.

Portal UI: cards with name, `Lv X+`, locked icon + tooltip if under-leveled. Teleport = fade to black 300ms → `ZoneLoader.load(zoneId)` → spawn at entry → autosave.

No open-world travel needed for MVP. Portal-only keeps nav and balancing trivial.

### 7.5 Monsters & AI

```ts
type AIState = 'idle'|'patrol'|'aggro'|'chase'|'attack'|'stagger'|'dead';
```

- Aggro radius 8-12m, leash radius 25m (return + heal if dragged too far — prevents cheese).
- Attack = windup 0.4s (flash red telegraph ring) → apply damage → cooldown.
- Boss extras: 2-3 mechanics max (charge, summon 2 adds at 50% HP, AoE slam circle). HP bar on top + nameplate. Enrage after 3 min to avoid stall.
- Scaling: `monsterStat = base * (1 + 0.12*(level-1))`.

Spawning: fixed initial pack placement in `ZoneLoader` + respawn timer 30-60s per spawner while player in zone, cap alive.

### 7.6 Combat & Skills

Click-to-attack uses attack range + face target. Skills data-driven:

```ts
interface SkillDef {
  id: string; name: string; job: string;
  type: 'melee'|'projectile'|'aoe'|'dash'|'buff';
  mana: number; cooldownSec: number;
  range: number; radius?: number;
  dmgMult: number; effect?: 'burn'|'freeze'|'stun'|'lifesteal';
  icon: string; desc: string;
}
```

MVP: 3-4 skills per base class (incl. 1 job skill). Example Warrior: `Slash (LMB) / Whirlwind (1) / Leap Slam (2, job)`. Projectiles pooled, AoE = ring mesh growing + damage once.

Damage numbers: pooled `Sprite` with canvas texture, crit = bigger/yellow.

Death: 2s lie + loot burst + XP gain + chance respawn. Player death → overlay "You Died" → respawn in city full HP, lose 5% gold (Diablo-like sting, no XP loss for MVP).

### 7.7 Items, Drops & Shop

Slots: `weapon, helm, chest, gloves, boots, ring, amulet` (7 is plenty).

```ts
interface ItemInstance {
  uid: string; baseId: string; name: string;
  slot: Slot; rarity: 'normal'|'magic'|'rare'|'legendary';
  levelReq: number; dmg?: number; armor?: number;
  affixes: { stat: string; value: number }[];
  value: number; icon: string;
}
```

- Affix pool e.g. `+str, +vit, +crit%, +lifesteal, +fireDmg`. Normal=0 affix, Magic=1, Rare=2-3, Legendary=fixed unique + flavor text.
- Drop rates trash: 8% equip, 25% gold/potion. Boss: 100% 1-2 equips, 30% Rare, 5% Legendary (tune later). Loot = clickable glowing beam + label; vacuum to inventory within 2m or click.
- Shop: sells 6-8 level-appropriate whites/greens for starting gold, buys anything at `value*0.4`. Refresh stock on level up. Starter flow: give 150g → tutorial toast "Buy a sword!" → leave city.

Keep icons as emoji/SVG for MVP — don't waste time on item art.

### 7.8 UI Screens (HTML overlay)

- **CharSelect:** cards + New (name input + class picker with mini 3D preview = reuse same GLB on turntable — nice wow for cheap).
- **HUD:** bottom HP/MP/XP bars, skill bar with cooldown sweep, gold, level badge, potion button (`Q`), portal-to-town (`T`).
- **Inventory (`I`):** grid + equipment dolls + tooltip with green/red diff.
- **Shop:** two columns buy/sell, confirm, gold display.
- **Portal:** zone cards + requirements.
- **LevelUp + JobAdvance:** modal with 2 choices, skill preview video/gif or icon + desc.

All UI subscribes to `EventBus`: `hpChanged, xpGained, lootDropped, levelUp, jobAvailable`.

---

## 8. Persistence

- `SaveManager.save(slot)` → JSON → `localStorage`. Version field + migration fn.
- Autosave: on zone change, level up, every 30s.
- Export/import save as file for debugging.
- Later swap to IndexedDB (larger icons) or backend — keep `SaveManager` interface stable so swap is 1 file.

---

## 9. Audio / Juice (do early, cheap wins)

- Howler: swing, hit, levelup, loot shimmer, portal, boss roar (freesound.org).
- Juice: hit flash (emissive pulse), knockback 0.2m, screen shake on boss slam, particles via `Points` for blood/sparks/levelup.
- Without this the game feels dead even if systems are right. Budget 1 day for it in MVP.

---

## 10. Roadmap — Concrete Build Order

**Phase 0 — Scaffold (2-3 days)**
1. `npm create vite@latest 3jsgame -- --template vanilla-ts`, `npm i three`, add `src/` layout above.
2. Isometric camera + ground plane + click-to-move capsule + dummy target dummy.
3. HTML HUD shell + game state machine.

**Phase 1 — Combat toy (1 week)**
4. Player attack + 1 melee + 1 projectile skill, 1 monster type with chase AI, HP bars, damage numbers, death/respawn.
5. XP/level curve to 10, 3 zones textures switchable.

**Phase 2 — Loop (1-2 weeks)**
6. Inventory/equipment + 20 items + rarity gen + drop tables.
7. City + Shop + Portal gating + 2 zones + boss each.
8. Char create/load + SaveManager + death penalty.

**Phase 3 — Identity (1 week)**
9. 3 base classes + Lv10 job split (6 jobs) + 1 new skill each + balance pass Lv1-20.
10. Audio, particles, boss telegraphs, tutorial toasts, title art.

**Ship v0.1 → playtest with 3 friends → tune drop/XP numbers before adding Zone 3.**

Each phase ends with a playable build. Don't build shop UI before combat feels good.

---

## 11. Balancing Starter Numbers (to avoid rework)

- Time-to-kill trash Lv1: 2-3 hits. Boss Lv10: 60-90s with starter + 2 drops.
- Gold: monster 2-5g, starter sword 80g, full starter set ~250g → forces 15 min farm, good.
- XP: trash 8-12 XP, need ~150 XP for Lv2 → ~12 kills first level (~5 min).
- Potions: heal 40% HP, cost 15g, cooldown 5s, carry max 5 — prevents potion spam meta.

Log `timeToLevel, deathsPerZone, bossKillTime` to console/localStorage for tuning.

---

## 12. Risks & How to Dodge Them

1. **Scope creep (PoE syndrome)** — Fix: everything data-driven (`zones.json` etc.), no hardcoded Zone 3 logic.
2. **Art bottleneck** — Fix: placeholder capsules + Quaternius, never block gameplay on models.
3. **Perf with many enemies** — Fix: pools, caps, no shadows on props, test on low laptop early.
4. **Click-move + collision jank** — Fix: grid A* (10-20 lines with binary heap or use `three-pathfinding`), slide on circle colliders, no physics engine.
5. **Save breaking** — Fix: versioned saves + try/catch load with backup slot.
6. **Boring combat** — Fix: 1 telegraphed boss move > 10 stat sticks. Add knockback/slow early.

---

## 13. What to Do Next (this week)

1. Approve stack: Vite + TS + Three + HTML UI? Single-player first?
2. Lock classes: Warrior/Archer/Mage + Lv10 split names?
3. I can scaffold `package.json`, `Game.ts` loop, click-to-move + isometric camera + 1 zone in one go — say the word.
4. Collect 5-6 GLBs (player + 3 monsters + boss + NPC) from Quaternius/Mixamo so we don't stall.

---

## 14. Open Questions for You

- Solo or co-op later? (affects how pure we keep sim vs render)
- WASD + mouse or pure Diablo click? Recommend click primary + WASD optional.
- How punishing? XP loss / full loot drop on death, or gentle respawn?
- Browser-only or Electron/Steam wrapper later? (saves + controls differ slightly)
- Art style: low-poly cute (Torchlight) vs dark gritty (Diablo)? This drives lighting/fog/assets.

---

*Generated for `3jsgame` — next artifact should be `src/data/zones.json` + `classes.json` + playable movement prototype.*

---

## 15. Future Direction: Accounts, Multiplayer, Security, Monetization (NOT in scope yet)

Explicitly recorded so the current architecture doesn't block it later. Single-player + localStorage is correct for now — but observe these constraints:

**Accounts / login (future)**
- Characters move from `localStorage` to a backend DB keyed by account id. `SaveManager` + versioned `CharacterSave` already isolate persistence behind one interface — keep it that way so a backend slots in as a second implementation.
- Prefer hosted auth (OAuth / magic link) over hand-rolled passwords. Never store credentials or tokens in game code.

**Multiplayer (future)**
- Target an **authoritative-server** model: the server simulates damage, loot, XP and economy; the client renders + sends intents. Never trust client-reported kills, gold, or items.
- Practical options when the time comes: Colyseus / Nakama, or custom Node + WebSocket. Likely shape: shared town-hub instances + per-party combat-zone instances.
- Prep today (cheap): keep simulation decoupled from rendering (`Game.ts` owns the loop; monsters/skills don't touch the DOM), use fixed data-driven defs for zones/items/skills, and give every item/character a UID (already done). Avoid baking "only one player exists" deep into systems — e.g. damage numbers and loot pickup already take a position, not an assumed player.

**Security (future, load-bearing once money/accounts exist)**
- Server validates everything of value: gold deltas, item grants, shop prices, portal level gates, XP awards.
- Transport: HTTPS/WSS only. No secrets, API keys, or payment keys in the client bundle (Vite `VITE_*` vars ship to browsers).
- Input validation + rate limiting on all game endpoints; short-lived session tokens; GDPR basics from day one of accounts (data export — client export already exists — plus deletion on request).

**Monetization (future)**
- Assumption to validate later: cosmetics / stash tabs / battle-pass style — avoid pay-to-win stat sales in an ARPG economy, it kills trading and trust.
- Use a real payments provider (Stripe / Xsolla / Steam payments). Entitlements must be granted **server-side via provider webhooks**, never by client callback. Test in sandbox mode; plan for regional pricing, tax/VAT, and refund handling before launch.
- Anti-fraud follows from server-authoritative design: duped items and edited saves stop mattering once the server is the source of truth.

**What NOT to do now:** build custom auth, custom crypto, or any payment code. Just don't paint ourselves into a corner (see constraints above).

---

## 16. Backlog — Deferred Items & Playtest Notes (living list)

Things offered or noticed but deliberately not built yet. Check here before proposing "next steps".

### Deferred features (all scoped, none started)
- **Minimap click-to-move** — done (canvas `pointerdown` → world coords → `setTarget` in `Game.ts` `cacheHud`).
- **Second advancement (Lv20)** — done (6 ults on key `3`, auto-unlock; see `Jobs.ts` + `castUlt`).
- **Zone 4 (Lv 30–40)** — done (Howling Wilds + The Hornfather + curse-vent hazard gauntlet, `ZoneHazard` in `Zones.ts`; wilds quests in).
- **Wilds item tier** — done (7 bases minLvl 28–34: Howling Blade, Antler Maul, Wilds Helm, Hornfather Crown, Stormhide Armor, Windstep Boots, Frost Ring; auto-enter `generateDrop` pool for Lv26+).
- **Elite packs** — done (10%/spawn + 1 guaranteed per zone; 5 affixes in `src/data/Elites.ts`: Mighty/Tough/Swift/Savage-10+/Juggernaut-20+, 2nd affix at Lv20+; 1.3x size, gold aggro ring + minimap dot, 3x XP, guaranteed min-magic drop + bonus gold).
- **Creep variance** — done (4 archetypes in `src/data/Creatures.ts`: chaser/brute-2.6xHP/skitterer-1.5x speed/spitter-ranged-11m; per-zone weighted rosters in `Zones.ts`; hostile `EnemyShots` pool, dodge-able bolts, `spit` SFX, orange minimap dots; also fixed dead capsule `tint` so chasers show zone colors).
- **Ground-loot hover labels** — done (`#loot-tip` follows the cursor with rarity-colored name + Lv req; hides on pickup).
- **Cryomancer 4th skill (Frost Lance)** — done (key `4`, unlocks Lv15; vendored crystal geometry + ice shader from Elemental Sandbox (MIT, attributed in `FrostLance.ts`), Game-side damage rides 3 staggered slow circles; `extra` keybind remappable).
- **Cryo Storm Lance + Nova Beam (keys 5/6)** — done (unlocks Lv25/30; vendored bolt-ribbon + beam tube/coil/disc shaders from Elemental Sandbox (MIT, attributed in `StormLance.ts` / `NovaBeam.ts`); damage rides delayed Game-side AoE (4x 1.2x / 5x 1.0x ticks + 2x impact); `JobDef.extras[]` generalizes the bar — a 4th extra is one array entry + bind).
- **Meteor rock rework** — done (vendored fractured asteroid + lava-seam shader from Elemental Sandbox (MIT, attributed in `MeteorRocks.ts`); tumbling rock arcs in heating up over the AoE delay, bursts into 5 cooling chunks; pooled x3 for Cataclysm stagger).
- **Pyro Storm Lance (key 4)** — done (unlocks Lv20; shared `StormLance` driver with per-cast palette — ember red for Pyro, authored blue for Cryo, impact FX tinted to match).
- **Hunter Voltaic Snare (key 4)** — done (unlocks Lv18; vendored snare cage + burnt-field shaders from Elemental Sandbox (MIT, attributed in `SnareTrap.ts`); leash throw → snap overshoot → 2s burn hold → collapse; damage rides Game-side AoE (2.5x + 3x 0.8x ticks + slow)).
- **Endgame rift loop** — done (Rift Keys drop from wilds elites 12% + Hornfather 100%; 3 fixed tiers in `src/data/Rifts.ts` with scaled trash/elite chance/luck + re-fight bosses incl. Empowered Hornfather; rift bosses sustain keys ~1/3; 3 rift quests; T hotkey skips keys; no save migration — keys are consumables; keys render as golden key meshes on the ground + 🗝️/🔑 bag icons with tier colors).
- **QoL pack** — done (Esc pause menu, volume slider, remappable keys in `Keybinds.ts`, shared stash chest).
- **Quests** — done (8 quests: zone culls + bosses + Lv10/20, auto-payout gold/XP/potions/drops; `src/data/Quests.ts`, log on `J`, tracker HUD, state on save).
- **Composed music** — generative ambient is a placeholder; `SoundManager.setMood` is the seam for streamed tracks.
- **Art pass** — replace capsule bodies with Quaternius/Mixamo GLBs (`Player`/`Monster` constructors are the swap points; keep the ring/HP-bar/label children).
- **Balance telemetry** — done (basic: `logTelemetry` in `Game.ts` logs `timeToLevel, death, bossKill` to `arpg.telemetry.v1` + console).

### Playtest notes (verify in-game, then delete or fix)
- **Meteor vs chasers** — fixed (delay 0.7s → 0.5s + detonate vacuum drags non-boss foes in; `vacuumTo` in `Game.ts`).
- **Berserker spin lock** — 0.4s rotation override; confirm it feels powerful, not disorienting.
- **Crypt pad muddiness** — fixed in code (single-voice pads + 500→650Hz cutoff on low moods via `voices` in `Sound.ts`; rift too). Still needs ears on laptop speakers to confirm.
- **Low-end perf** — untested on weak hardware. Caps to watch: 18 monsters, 128 FX particles, 2048 shadow map, pixelRatio ≤ 2.
- **Sanctum discoverability** — fixed in code (pulsing gold star on the Haven minimap + hint toast points at it). Confirm new players find it.

### Tech debt (works, but note the shape)
- `Game.ts` split done (9 pure `src/ui/` builders; `Game.ts` keeps thin DOM wrappers + sim). Remainder intentionally in `Game.ts`: `updateBossBar`, toast/flash/marker helpers, `drawMinimap`.
- `applySave` recomputes totals from scratch (class → attrs → levels → gear → job). Any new bonus source must be added to **both** its live path and `applySave` or loads will silently drop it.
- Cooldown UI — done (one `syncCooldown` helper; a 6th skill adds one call).
- Damage chain — done (`damageMonster` pipeline + `killMonster` tail for melee/AoE/projectile-kill; pool still rolls projectile damage internally, lifesteal on its `onHit`).
- Rift mood — done (`rift` generative mood; rifts no longer play city music). True composed/streamed tracks still need asset files (zero-asset Web Audio policy).
- Art pass — partial (player classes + meadow/wilds bosses on FBX). Blocked on assets: `crypt` boss has no model dir, `ember` dir is empty → capsule fallback. Supply FBX sets to finish.
