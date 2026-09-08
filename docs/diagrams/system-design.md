# 3jsgame — System Design (MVP + Full)

Diagrams live here as **Mermaid** (renders on GitHub; VS Code: Markdown Preview Mermaid Extension).
Exported images (PNG/SVG), if ever needed, go beside the `.md` that embeds them.

- [1. MVP (built today — single-player, client-only)](#1-mvp-built-today--single-player-client-only)
- [2. Full (future — accounts, multiplayer, payments)](#2-full-future--accounts-multiplayer-payments)
- [3. Data model: save file → database tables](#3-data-model-save-file--database-tables)
- [4. Migration path MVP → Full](#4-migration-path-mvp--full)

---

## 1. MVP (built today — single-player, client-only)

Everything runs in the browser. No backend, no accounts. Persistence = `localStorage` key
`arpg.chars.v1` behind the `SaveManager` interface.

```mermaid
flowchart TD
    subgraph Client["Browser SPA — Vite + TS + Three.js"]
        UI["HTML overlay UI\nHUD · bag · shop · portal\nchar select · char panel · compare"]
        CORE["Game core (Game.ts)\nloop · camera · input\nzone switching · panels"]
        SIM["Simulation\nPlayer · Monster / Boss AI\ncombat · fireball · lifesteal\npooled projectiles + floaters"]
        WORLD["World\nTerrain · zone recolor\nloot beams · trader · portal"]
        DATA["Data as code\nClasses · Items · Zones defs"]
        SAVE["SaveManager\nlocalStorage arpg.chars.v1"]
    end
    GL["Three.js renderer"]

    UI --> CORE
    CORE --> SIM
    CORE --> WORLD
    SIM --> GL
    WORLD --> GL
    DATA --> SIM
    DATA --> WORLD
    CORE --> SAVE
```

Rules this diagram encodes (see `AGENTS.md`):

- Sim code never touches the DOM — only `Game.ts` writes UI.
- Transient objects are pooled (`ProjectilePool`, `DamageNumbers`) or disposed (`LootManager`).
- Content is data (`Zones.ts`, `Items.ts`, `Classes.ts`), not `if zone === 3` branches.

### Game loop (per frame)

```mermaid
flowchart TD
    RAF["requestAnimationFrame"] --> DT["dt = clamp(clock, 50ms)"]
    DT --> IN["Input\nclick attack-move · WASD · 1/Q/I/C/E"]
    IN --> P["Player.update\nmove · collide · cooldowns"]
    P --> AI["Monsters.update\nidle · aggro · chase · attack\nleash / return home"]
    AI --> BOSS["BossController\nred-ring slam telegraph\nsummon at 50% HP"]
    BOSS --> ATK["Auto-attack + fireballs\narmor mitigation · lifesteal\ncrit rolls"]
    ATK --> KILL["Kills → gold · XP · drops\nlevel-ups (+3 stat pts)\nshop restock"]
    KILL --> PICK["Loot vacuum (<2.1m)\nscrolls · gear by rarity"]
    PICK --> FX["Floaters · hit flash\ncamera shake · light follows"]
    FX --> HUD["HUD sync @10Hz\nHP/XP · boss bar · gold\nprompt · panels"]
    HUD --> R["renderer.render"]
    R --> RAF
```

### Save flow

```mermaid
flowchart LR
    EV["zone change · kill · level-up\n30s timer · tab close"] --> COL["collectSave()"]
    COL --> LS[("localStorage\narpg.chars.v1")]
    LS --> LOAD["load · import file"]
    LOAD --> APP["applySave()\nrecompute totals:\nclass + attrs + levels + gear"]
    APP --> G["live game state"]
```

Key property: derived totals are **recomputed**, never trusted from disk
(`refreshAttributes()` / `refreshGear()` are delta-applied). That habit is what later lets a
server be the source of truth without redesigning combat.

---

## 2. Full (future — accounts, multiplayer, payments)

Client gets thinner (render + intents); a Node backend becomes authoritative for everything of
value. See `ARPG_PLAN.md` §15 for the product reasoning.

```mermaid
flowchart TD
    subgraph Browser["Browser client"]
        CUI["HTML overlay UI"]
        C3D["Three.js render\n+ player intents"]
    end
    CDN["CDN\nstatic JS + assets"]
    GW["API gateway + auth\nOAuth · sessions\nrate limit · validation"]
    GS["Authoritative zone servers\n1 process = N instances\nsim: combat · loot · XP · economy"]
    DB[("PostgreSQL\naccounts · characters\nitems · gold ledger · audit")]
    RD[("Redis\nsessions · presence\ninstance registry")]
    PAY["Payments\nStripe / Xsolla / Steam"]
    ENT["Entitlement worker\nwebhooks → grant server-side"]

    Browser --> CDN
    C3D <-->|"WSS: intents + snapshots"| GS
    CUI <-->|"HTTPS JSON"| GW
    GW --> DB
    GW --> RD
    GS --> DB
    GS --> RD
    PAY --> ENT
    ENT --> DB
```

Never-trust-the-client boundary: gold deltas, item grants, shop prices, portal gates and XP
are computed in `GS`, persisted to `DB`, and only then shown by the client.

### Zone session (sequence)

```mermaid
sequenceDiagram
    participant P as Player client
    participant G as Gateway / Auth
    participant S as Zone server
    participant D as Database

    P->>G: login (OAuth) → session token
    P->>G: list characters
    G->>D: SELECT characters WHERE account
    P->>S: join zone (token, charId)
    S->>D: load character snapshot
    S->>P: full snapshot, then delta stream
    P->>S: intent: attack monster M
    S->>S: validate range / cooldown / LoS
    S->>P: damage event + loot grant
    S->>D: persist (batched): gold, XP, items
    P->>G: buy cosmetic → provider checkout
    Note over G,D: provider webhook → entitlement worker<br/>grants item server-side, never via client
```

### Instance model

```mermaid
flowchart TD
    HUB["Haven hub instance(s)\nshared, capped ~50 players\ntrader + portal NPCs"]
    Z1["Greenmeadow instance\nper party"]
    Z2["Crypt instance\nper party"]
    ZN["Zone N instance\nper party"]
    P["Portal request\n(level-gated, server-checked)"] --> Z1
    P --> Z2
    P --> ZN
    Z1 --> HUB
    Z2 --> HUB
```

Parties share a seed/instance id; solo play is just a party of one — which is why MVP avoids
"exactly one player" assumptions in loot, damage numbers, and AI targeting.

---

## 3. Data model: save file → database tables

`CharacterSave` (versioned, `SAVE_VERSION`) maps almost 1:1 to future tables:

```mermaid
erDiagram
    ACCOUNTS ||--o{ CHARACTERS : owns
    CHARACTERS ||--o{ INVENTORY_ITEMS : holds
    CHARACTERS ||--o{ EQUIPPED_ITEMS : wears
    CHARACTERS ||--o{ GOLD_LEDGER : "earns/spends"

    ACCOUNTS {
        uuid id PK
        string provider
        string provider_sub
        timestamptz created_at
    }
    CHARACTERS {
        uuid id PK
        uuid account_id FK
        string name
        string base_class
        int level
        bigint xp
        int xp_rate
        jsonb attrs
        int stat_points
        int hp
        int potions
        string zone_id
        float x
        float z
    }
    INVENTORY_ITEMS {
        uuid uid PK
        uuid char_id FK
        string base_id
        string rarity
        jsonb affixes
        int slot_idx
    }
    GOLD_LEDGER {
        bigint seq PK
        uuid char_id FK
        int delta
        string reason
        timestamptz at
    }
```

Notes:

- Items already carry UIDs (`makeUid()`) — they become primary keys; duping is detectable.
- Gold as an append-only ledger (not a mutable column) makes rollback and fraud review possible.
- MVP `export/import hero file` is the prototype of GDPR export; account deletion = cascade delete.

---

## 4. Migration path MVP → Full

| Step | What changes | What stays untouched |
|---|---|---|
| 1. Backend saves | `SaveManager` gains a remote implementation; local stays as offline cache | `CharacterSave` shape, versioning |
| 2. Auth | Title screen adds login; `currentSaveId` becomes server id | Char select / create UX |
| 3. Authoritative sim | `Monster`/`Boss`/damage math move server-side; client keeps rendering + prediction-lite | Data defs (`Zones`, `Items`, `Classes`), tuning numbers |
| 4. Economy guard | Shop/portal/drop rolls validated server-side | Client UI flows |
| 5. Payments | Checkout + webhook worker; cosmetics only | Combat balance |

Non-goals for migration: rewriting the renderer, the HTML UI layer, or the content defs.
