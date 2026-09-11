# Making skills the Elemental Sandbox way

How [LinearAbiltyCastingThreeJS](https://github.com/achrefelouafi/LinearAbiltyCastingThreeJS)
(Elemental Sandbox, MIT — copyright (c) 2026 mohamedachrefelouafi) builds its
abilities, how we adapted four of them (`FrostLance.ts`, `StormLance.ts`,
`NovaBeam.ts`, `MeteorRocks.ts`), and the repeatable recipe for the next one.

## 1. How he builds a skill

Five rules run through all of `src/abilities`, `src/materials`, `src/assets`:

**Rule 1 — Parameter-space geometry ("no metres on the CPU").**
Meshes never store world positions. The lightning bolt is a flat ladder of
quads where each vertex carries only `(t, side)` — how far along, which edge.
The beam tube carries `(t, angle)`. The vertex shader resolves those into world
positions every frame from uniforms. Nothing caches a path, so nothing goes
stale: dragging a slider reshapes a cast that is already in the air, even with
the sim paused.

**Rule 2 — One ribbon, many roles.**
The same instanced ribbon strip draws lightning filaments, beam coils, shock
discs, and the snare's leash/pillar/tendrils/rim — the vertex shader picks a
parametric path per instance index. Ice crystals are 3 `InstancedMesh`es (3
draw calls for 288 spikes). Filament *count* is nearly free; only *roles* cost
draw calls.

**Rule 3 — Patched standard materials for solids, raw ShaderMaterials for light.**
Ice and rock are `MeshStandardMaterial` with injected chunks, so they get real
shadows and probe lighting free; the stylisation (thickness tint, fracture
noise, birth flash / lava seams, charge heat) rides on top via
`onBeforeCompile`-style patching. Pure-energy things (bolt, beam) are additive
`ShaderMaterial`s with no lighting at all.

**Rule 4 — Dice-only records.**
An ice spike stores fractions and jitters (`along`, `lateral`, seeds) — no
metres, no seconds, only an eruption timestamp. Every dimension resolves
against parameters in the update loop. The meteor's displacement is a pure
function of vertex direction, so duplicated vertices move identically.

**Rule 5 — The noise split.**
Lightning uses *piecewise-linear* noise (corners preserved — corners read as
lightning). The beam uses *smooth* noise stretched along the flow (a beam that
kinks reads as a bolt). Same noise library, opposite interpolation. And the
beam's white core is three tubes (rim-weighted halo + hollow sheath +
*axis-weighted* core) — that inversion is what makes it read as a solid rod.

Supporting cast: GPU ring-buffer particles, pooled everything (12 casts then
zero allocation), a depth prepass so FX never hard-clip into the floor, and a
bloom + grade post chain. We deliberately did **not** port these — our
`Effects`/`DamageNumbers` pools, three.quarks, and no-post pipeline cover the
same jobs inside our low-end perf budget.

## 2. How we adapted it: MeteorRocks, end to end

`src/entities/MeteorRocks.ts` is the worked example. The same shape fits
`FrostLance.ts` (crystal field), `StormLance.ts` (bolt ribbon), `NovaBeam.ts`
(beam stack).

**Step 1 — Verify the license.**
The repo root has an MIT `LICENSE` file (confirmed via raw fetch). Every
adapted file carries the full MIT header + copyright notice + a list of what
was taken and what was changed. That header is a license obligation, not a
courtesy — never strip it.

**Step 2 — Decide what to take and what to leave.**
Take: geometry generators + shading + timing logic. Leave: the settings/editor
framework, shared frame uniforms, particle/decal/light systems, depth-prepass
soft-fading. Rule of thumb: if it touches `settings.*`, `frame.*`, `ctx.*`
(particles/decals/bursts/shake/flash/lights), it stays behind — our `Effects`
pool, quarks FX, and `queueAoe` damage already do those jobs.

For MeteorRocks specifically:
- Taken: `createAsteroidGeometry` (fbm lumps + planar cuts + craters),
  the lava-seam fragment injection (zero-crossing cracks, soot lips, flow
  pulse, facet variation, cavity occlusion, leading-face heat, per-chunk
  cooling), the `uCharge` heat-up beat.
- Left: raymarched wake (our streak column already reads as the wake),
  molten crack network decals (our `scorch` covers it), GPU debris (our
  burst pool covers it).

**Step 3 — Replace the dependencies with fixed values.**
| Their dependency | Our replacement |
|---|---|
| `settings.meteor.*` (30+ sliders) | Hardcoded defaults taken from their `uniforms` init block |
| `frame.uTime` shared uniform | Own `{ value: 0 }` object, advanced in `update(dt)` |
| `getColor(hex)` | `new THREE.Color(hex)` directly |
| `environment.registerShadowCasterWithPatch` | Plain `onBeforeCompile` (nothing displaces vertices, so the default depth material is correct) |
| `softFade` depth-texture fade | Deleted (no depth prepass here) |
| `commonGLSL` import | Deleted with the soft-fade (keep only the noise functions the shader calls) |

**Step 4 — Write the driver around our game loop.**
A driver class owns pooled meshes and exposes `cast(...)` + `update(dt)` +
`clear()` (zone change). Damage is **never** in the driver — the cast call
also queues Game-side `queueAoe` circles whose delays match the visual beats
(meteor: rock flight time == AoE delay, 0.5s; Cataclysm: 0.4/0.8/1.2s).
Skill data (cooldown, cost, desc) lives in `src/data/Jobs.ts`; unlock level on
the `extras[]` entry; key binds in `Keybinds.ts`; HUD slot auto-follows.

**Step 5 — Verify the seams a compiler can't.**
`tsc` + `vite build` do not check shader strings. For each port, verify:
- three version chunk order (`totalEmissiveRadiance` → `normal_fragment_begin`
  → `emissivemap_fragment` — confirmed on our three r170 via
  `node_modules/three/src/renderers/shaders/ShaderLib/meshphysical.glsl.js`).
- No GLSL-illegal code: no nested function definitions, called noise
  functions all present with matching arity (we were bitten by both — a
  self-recursive `mod289v4` typo and a 2-arg `ridged` call against a 1-arg
  definition).
- `attribute` declarations work because three's WebGL2 prefix maps
  `attribute`→`in` for built-in materials.
- Instanced attributes (`aSeed`, `aBirth`, `aHeat`) exist on every geometry
  using the material — plain meshes can carry constant-filled attributes too.
- No per-frame allocation in `update()` (module-scope temps, reused
  `Object3D` dummy).
- First cast in-game with the console open: white/unshaded output means the
  injection missed; a missing-uniform warning names the culprit.

## 3. Recipe for the next skill

1. Pick the closest reference ability (ice → field skills, bolt → projectile
   skills, beam → channeled skills, snare → zone skills, meteor → lobbed
   skills) and read its `Ability.js` + material + geometry sources.
2. Confirm MIT + write the header first (copyright, what was taken, what was
   changed).
3. Vendor geometry + shaders with fixed defaults; replace the five
   dependencies per the table above.
4. Build the driver: `cast()` rolls dice into records, `update(dt)` resolves
   dimensions + advances the clock, `clear()` parks everything.
5. Wire damage as delayed `queueAoe` circles synced to the visual beats;
   register skill data, unlock level, bind, HUD slot (all data-driven now —
   see `JobDef.extras[]`).
6. Build, then playtest the first cast with the console open (Section 2,
   Step 5).

Good next candidates: snare ring-tech for Frost Nova/Glacial Prison visuals,
coil-ribbon trails for arrows and Shield Throw.
