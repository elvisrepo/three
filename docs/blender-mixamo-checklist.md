# Character art checklist — Blender → Mixamo → `public/models`

One page. Follow it and the model works in-game with zero code changes.

## 1. Model (Blender, free)

- [ ] Humanoid with clear head, torso, arms, legs (Mixamo rejects everything else)
- [ ] T-pose (arms straight out), symmetric left/right, mostly quads
- [ ] Feet at ground zero (y=0), facing **+Z** (our cast faces +Z)
- [ ] Real-world height (~1.8 units = 1.8 m); boss scale is tuned data-side later
- [ ] UVs + texture (or flat colors — reads fine at iso distance)
- [ ] One mesh if possible; loose parts parented, no unapplied wild scales

## 2. Rig (mixamo.com, free Adobe ID)

- [ ] Upload FBX/OBJ/ZIP (**embed media** so textures come through; OBJ needs .mtl + textures zipped)
- [ ] Place markers exactly (chin, wrists, elbows, knees, groin); pick **No Fingers** for low-poly
- [ ] Preview a walk — fix weight errors in Blender and re-upload, don't fight them in-engine

## 3. Download (settings that match our loader)

- [ ] Format **FBX**, 30fps, **In Place** (no root motion — code drives movement)
- [ ] Mesh file once, **skin ON**; every animation file **skin OFF** (animation-only)
- [ ] Trim clips tight (idle loop must loop cleanly)

## 4. Drop into the repo

Players — `public/models/player/<class>/`:

```
idle.fbx  run.fbx  attack.fbx  hit.fbx  death.fbx
```

Bosses — `public/models/boss/<name>/` (Mixamo layout):

```
base.fbx  idle.fbx  walk.fbx  punch.fbx  slam.fbx  roar.fbx  hit.fbx  death.fbx
```

Single-file rigs also work: put all takes in `base.fbx` and the loader maps them
(`idel|idle|flying` → idle, `fly|walk` → walk, `run|attack|punch` → punch,
`walk|attack2|slam` → slam, `fly|attack2|roar` → roar, hit/death by name).

- [ ] Textures live **next to the FBX** (loader resolves relatively — see dragon's `textures/` tree)
- [ ] Wire bosses data-side only: `bossModel: 'models/boss/<name>'` in `Zones.ts`,
  plus `bossModelScale` if the rig isn't centimeters (Mixamo/Quaternius = `0.01`),
  `bossEmissive` if it's a dark albedo that dies in dark zones
- [ ] Player classes: `model: 'models/player/<class>'` in `Classes.ts`

## 5. Verify in-game

- [ ] `npm run build` passes (strict + `noUnusedLocals`)
- [ ] `npm run dev`, open console: no `[Player] … model missing`, no `[Monster] missing boss anim …`
- [ ] Check: idle breathes, run leans, attack lands on the swing (not after),
  hit flinches red, death falls and hides, respawn stands back up
- [ ] Boss: slam pose holds through the telegraph, roar plays at 50% summon
- [ ] Keep total per model sane (<5 MB ideal, <20 MB hard stop — the dragon's 16 MB is the ceiling, not the norm)

## 6. Credits

- [ ] Third-party models: note author + license in `ARPG_PLAN.md` §16 art-pass line
  (Mixamo = royalty-free incl. commercial; Quaternius = CC0; Sketchfab = honor the listed license, never NonCommercial or ripped)
