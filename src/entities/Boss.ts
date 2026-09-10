import * as THREE from 'three';
import type { Monster } from './Monster';
import { MagmaAura } from './MagmaAura';
import { ConstantValue } from 'three.quarks';
import type { ParticleSystem } from 'three.quarks';
import type { MeteorFx } from './MeteorQuarks';
import { getMoteTexture, getCircleTexture, getPillarTexture } from './SavePoint';

/**
 * Boss extras via composition (Monster stays decoupled — it only exposes
 * playSpecial('slam' | 'roar') one-shot channels):
 * - telegraphed AoE slam (red ring warns 0.9s, then hits within radius)
 * - summons 2 minions once at 50% HP (Game polls consumeSummon())
 * - portal barrage (Hornfather): 3 rifts warn 1.1s tracking you, then
 *   converging beams snapshot your spot (Game polls consumePortalDamage())
 * - skyfall (Hornfather): elevates, implodes a quarks charge overhead, hurls
 *   a ribbon-trailed orb (Game polls consumeSkyDamage/Fired/Impacts)
 * - 30s respawn for farmable boss loop
 */

interface PortalBeam {
  group: THREE.Group;
  mats: THREE.Material[];
  life: number;
  maxLife: number;
  age: number;
  phase: number;
  len: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  pulse: THREE.Sprite;
}

interface RiftMote {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  angle: number;
  t: number;
}

/** Pooled rift dress: disc + rim + spinning rune + inhaled spark motes. */
interface Rift {
  group: THREE.Group;
  discMat: THREE.MeshBasicMaterial;
  rimMat: THREE.MeshBasicMaterial;
  runeMat: THREE.MeshBasicMaterial;
  rune: THREE.Mesh;
  motes: RiftMote[];
}

/** Pooled lock mark: ground ring + brightening fill disc. */
interface LockMark {
  group: THREE.Group;
  ringMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
}

interface DyingRift {
  rift: Rift;
  life: number;
}

const PORTAL_WARN = 1.2;
const PORTAL_LOCK = 0.7;
const PORTAL_CD = 9;
const PORTAL_RANGE = 15;
const PORTAL_BEAM_LIFE = 0.4;
const PORTAL_BEAM_RADIUS = 1.4;
const PORTAL_POP_LIFE = 0.18;

const SKY_CD = 12;
const SKY_RISE = 0.5;
const SKY_CHARGE = 1.3;
const SKY_ELEVATE = 4.2;
const SKY_RANGE = 20;
const SKY_BOLT_SPEED = 13;
const SKY_RADIUS = 3;
const SKY_DMG = 2.2;
const SKY_FADE = 0.35;

const _skyDir = new THREE.Vector3();
const _skyHead = new THREE.Vector3();
const _skyFwd = new THREE.Vector3(0, 0, 1);
export class BossController {
  telegraph: THREE.Mesh;
  slamRadius = 4.8;
  summonPending = false;
  /** Magma shell (ember boss only) — rides the boss group, flares on warn/enrage. */
  readonly aura: MagmaAura | null = null;

  private slamCd = 4;
  private warnT = 0;
  private wasAlive = true;
  private summoned = false;
  /** Portal barrage state (wilds boss only — enabled via opts). */
  private portalVolley = false;
  private rifts: Rift[] = [];
  private locks: LockMark[] = [];
  private lockPoints: THREE.Vector3[] = [];
  private dying: DyingRift[] = [];
  private volleyActive = false;
  private portalT = 0;
  private portalCd = 6;
  private portalPending = 0;
  private skyPending = 0;
  private fxT = 0;
  private portalImpacts: Array<{ x: number; z: number; s: number; sc: number }> = [];
  private beams: PortalBeam[] = [];
  /** Skyfall state (wilds boss only — enabled via opts.skyFx). */
  private skyFx: MeteorFx | null = null;
  private slamOn = true;
  private skyPhase: 'idle' | 'rise' | 'charge' | 'fly' | 'fade' = 'idle';
  private skyT = 0;
  private skyCd = 8;
  private skyCharge: ParticleSystem | null = null;
  private skyBolt: ParticleSystem | null = null;
  private skyTo = new THREE.Vector3();
  private skyFired = false;
  private skyCore!: THREE.Sprite;
  private skyCoreMat!: THREE.SpriteMaterial;
  /** Rider glow glued to the flying bolt + crown-pop timer. */
  private skyGlow!: THREE.Sprite;
  private skyGlowMat!: THREE.SpriteMaterial;
  private skyPopT = 0;
  /** Shared beam-flow texture (scrolls globally; per-beam materials fade). */
  private beamTex: THREE.Texture | null = null;

  constructor(private scene: THREE.Scene, readonly boss: Monster, opts?: { magma?: boolean; portals?: boolean; skyFx?: MeteorFx | null; slam?: boolean }) {
    this.telegraph = new THREE.Mesh(
      new THREE.RingGeometry(this.slamRadius - 0.55, this.slamRadius, 44),
      new THREE.MeshBasicMaterial({
        color: 0xff2222,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.telegraph.rotation.x = -Math.PI / 2;
    this.telegraph.position.y = 0.06;
    this.telegraph.visible = false;
    scene.add(this.telegraph);

    if (opts?.magma) {
      this.aura = new MagmaAura({ radius: 0.95 });
      // Group-space (boss group is scaled ~1.7x): sits over the torso.
      this.aura.group.position.y = 1.0;
      boss.group.add(this.aura.group);
    }
    this.portalVolley = opts?.portals ?? false;
    if (this.portalVolley) this.buildPortalDress();
    this.skyFx = opts?.skyFx ?? null;
    this.slamOn = opts?.slam ?? true;
    if (this.skyFx) {
      this.skyCoreMat = new THREE.SpriteMaterial({
        map: getMoteTexture(), color: 0xf2e6ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.skyCore = new THREE.Sprite(this.skyCoreMat);
      this.skyCore.renderOrder = 27;
      this.skyCore.visible = false;
      this.scene.add(this.skyCore);
      this.skyGlowMat = new THREE.SpriteMaterial({
        map: getMoteTexture(), color: 0xf2e6ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.skyGlow = new THREE.Sprite(this.skyGlowMat);
      this.skyGlow.scale.setScalar(3.2);
      this.skyGlow.renderOrder = 28;
      this.skyGlow.visible = false;
      this.scene.add(this.skyGlow);
    }
  }

  /** Pre-allocate all volley visuals once (zero allocation during the fight). */
  private buildPortalDress(): void {
    const moteTex = getMoteTexture();
    const circleTex = getCircleTexture();
    this.beamTex = getPillarTexture().clone();
    this.beamTex.needsUpdate = true;
    this.beamTex.wrapS = this.beamTex.wrapT = THREE.RepeatWrapping;
    this.beamTex.repeat.set(2, 3);
    for (let i = 0; i < 3; i++) {
      const discMat = new THREE.MeshBasicMaterial({
        color: 0xb44dff, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const rimMat = new THREE.MeshBasicMaterial({
        color: 0xe0b3ff, transparent: true, opacity: 0.7,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const runeMat = new THREE.MeshBasicMaterial({
        map: circleTex, color: 0xd9a7ff, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const group = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.85, 28), discMat);
      disc.renderOrder = 24;
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.08, 32), rimMat);
      rim.position.z = 0.01;
      rim.renderOrder = 25;
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), runeMat);
      rune.position.z = 0.02;
      rune.renderOrder = 26;
      group.add(disc, rim, rune);
      const motes: RiftMote[] = [];
      for (let m = 0; m < 3; m++) {
        const mat = new THREE.SpriteMaterial({
          map: moteTex, color: 0xd9a7ff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.setScalar(0.3);
        sprite.renderOrder = 27;
        group.add(sprite);
        motes.push({ sprite, mat, angle: (m / 3) * Math.PI * 2, t: m / 3 });
      }
      group.visible = false;
      this.scene.add(group);
      this.rifts.push({ group, discMat, rimMat, runeMat, rune, motes });
    }
    for (let i = 0; i < 3; i++) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xe0b3ff, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const fillMat = new THREE.MeshBasicMaterial({
        map: moteTex, color: 0xb44dff, transparent: true, opacity: 0.2,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const group = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, PORTAL_BEAM_RADIUS, 32), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 18;
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), fillMat);
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = 0.01;
      fill.renderOrder = 17;
      group.add(ring, fill);
      group.position.y = 0.07;
      group.visible = false;
      this.scene.add(group);
      this.locks.push({ group, ringMat, fillMat });
    }
  }

  reset(): void {
    this.slamCd = 4;
    this.warnT = 0;
    this.summoned = false;
    this.summonPending = false;
    this.telegraph.visible = false;
    this.portalCd = 6;
    this.portalT = 0;
    this.portalPending = 0;
    this.skyPending = 0;
    this.portalImpacts = [];
    this.skyCleanup();
    this.skyPhase = 'idle';
    this.skyCd = 6;
    this.volleyActive = false;
    this.hideDress();
    this.clearBeams();
    if (this.aura) {
      this.aura.group.visible = true;
      this.aura.setIntensity(0.4);
    }
  }

  /** Returns slam damage to the player this frame (0 if none). */
  update(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): number {
    // Beam fade + rift collapse are pure visual — run even as the boss dies.
    this.updatePortalFx(dt);
    if (!this.boss.alive) {
      this.wasAlive = false;
      this.telegraph.visible = false;
      this.warnT = 0;
      if (this.aura) this.aura.group.visible = false;
      this.volleyActive = false;
      this.hideDress();
      this.skyCleanup();
      this.skyPhase = 'idle';
      this.boss.group.position.y = 0;
      return 0;
    }
    if (!this.wasAlive && this.boss.alive) this.reset();
    this.wasAlive = true;

    if (!this.summoned && this.boss.hp < this.boss.maxHp * 0.5) {
      this.summoned = true;
      this.summonPending = true;
      this.boss.playSpecial('roar');
    }

    if (this.portalVolley) this.updatePortals(dt, playerPos, playerAlive);

    // Magma heat: idle simmer, slam warning flare, post-50% enrage burn.
    if (this.aura) {
      const enraged = this.boss.hp < this.boss.maxHp * 0.5;
      this.aura.setIntensity(this.warnT > 0 ? 1.25 : enraged ? 0.8 : 0.4);
      this.aura.update(dt);
    }

    const dist = this.boss.position.distanceTo(playerPos);
    if (this.skyFx) this.updateSky(dt, playerPos, playerAlive, dist);
    const mat = this.telegraph.material as THREE.MeshBasicMaterial;

    if (this.warnT > 0) {
      this.warnT -= dt;
      this.telegraph.position.set(this.boss.position.x, 0.06, this.boss.position.z);
      mat.opacity = 0.55 + Math.sin(performance.now() * 0.02) * 0.3;
      if (this.warnT <= 0) {
        this.telegraph.visible = false;
        this.slamCd = 6;
        if (playerAlive && dist < this.slamRadius) {
          return Math.max(1, Math.round(this.boss.damage * 1.7));
        }
      }
      return 0;
    }

    this.slamCd -= dt;
    if (this.slamOn && this.slamCd <= 0 && playerAlive && dist < 10) {
      this.warnT = 0.9;
      this.telegraph.visible = true;
      this.telegraph.position.set(this.boss.position.x, 0.06, this.boss.position.z);
      this.boss.playSpecial('slam');
    }
    return 0;
  }

  /**
   * Triple-rift volley: rifts track you for the first stretch, then LOCK —
   * filled impact rings mark the snapshot while beams charge. Moving (or
   * dashing) out of the rings during the lock dodges the beams entirely.
   */
  private updatePortals(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): void {
    if (this.volleyActive) {
      this.portalT -= dt;
      const grow = Math.min(1, (PORTAL_WARN - Math.max(0, this.portalT)) * 4);
      for (const r of this.rifts) {
        r.group.scale.setScalar(Math.max(0.2, grow));
        r.group.lookAt(playerPos.x, r.group.position.y, playerPos.z);
        const pulse = 0.45 + Math.sin(performance.now() * 0.02) * 0.3;
        r.discMat.opacity = pulse;
        r.rimMat.opacity = pulse + 0.2;
        r.rune.rotation.z += dt * 3.5;
        r.runeMat.opacity = 0.55 + Math.sin(performance.now() * 0.013) * 0.25;
        for (const mo of r.motes) {
          mo.t = (mo.t + dt * 2) % 1;
          mo.angle += dt * 5;
          const rad = 1.15 * (1 - mo.t) + 0.15;
          mo.sprite.position.set(Math.cos(mo.angle) * rad, Math.sin(mo.angle) * rad, 0.1);
          mo.mat.opacity = Math.sin(mo.t * Math.PI) * 0.9;
        }
      }
      if (this.portalT <= PORTAL_LOCK && this.lockPoints.length === 0) this.lockPortals(playerPos);
      const heat = this.lockPoints.length > 0 ? 1 - Math.max(0, this.portalT) / PORTAL_LOCK : 0;
      for (const l of this.locks) {
        l.fillMat.opacity = 0.2 + 0.6 * heat;
        l.ringMat.opacity = 0.6 + 0.35 * Math.sin(performance.now() * (0.02 + heat * 0.03));
      }
      if (this.portalT <= 0) this.firePortals(playerPos);
      return;
    }
    if (this.portalCd > 0) this.portalCd -= dt;
    if (this.portalCd > 0 || !playerAlive) return;
    const dist = this.boss.position.distanceTo(playerPos);
    if (dist < PORTAL_RANGE) this.openPortals();
  }

  /** Snapshot the tracked spot: mark the three impact rings. */
  private lockPortals(aim: THREE.Vector3): void {
    const [lx, lz] = this.bossLeft();
    const spreads = [-0.9, 0, 0.9];
    for (let i = 0; i < this.locks.length; i++) {
      const at = new THREE.Vector3(aim.x + lx * spreads[i], 0.07, aim.z + lz * spreads[i]);
      this.lockPoints.push(at);
      this.locks[i].group.position.set(at.x, 0.07, at.z);
      this.locks[i].group.visible = true;
    }
  }

  /** Boss-left unit vector (facing +Z, left hand sits at +X). */
  private bossLeft(): [number, number] {
    const yaw = this.boss.group.rotation.y;
    return [Math.cos(yaw), -Math.sin(yaw)];
  }

  /** Three rifts: above + boss-left + boss-right (boss-local axes). */
  private openPortals(): void {
    const [lx, lz] = this.bossLeft();
    const bp = this.boss.position;
    const spots = [
      new THREE.Vector3(bp.x, 3.6, bp.z),
      new THREE.Vector3(bp.x + lx * 2.6, 1.6, bp.z + lz * 2.6),
      new THREE.Vector3(bp.x - lx * 2.6, 1.6, bp.z - lz * 2.6),
    ];
    for (let i = 0; i < this.rifts.length; i++) {
      const r = this.rifts[i];
      r.group.position.copy(spots[i]);
      r.group.scale.setScalar(0.2);
      r.group.visible = true;
      r.discMat.opacity = 0.5;
      r.rimMat.opacity = 0.7;
      r.runeMat.opacity = 0.8;
      for (let m = 0; m < r.motes.length; m++) {
        r.motes[m].t = m / r.motes.length;
        r.motes[m].angle = (m / r.motes.length) * Math.PI * 2;
      }
    }
    this.lockPoints = [];
    this.portalT = PORTAL_WARN;
    this.volleyActive = true;
    this.boss.playSpecial('slam');
  }

  /** Fire at the LOCKED impacts: twin core+halo beams, banked hits + impacts. */
  private firePortals(now: THREE.Vector3): void {
    for (let i = 0; i < this.rifts.length; i++) {
      const from = this.rifts[i].group.position;
      const lock = this.lockPoints[i] ?? now;
      const to = new THREE.Vector3(lock.x, 0.9, lock.z);
      const len = from.distanceTo(to);
      if (len > 0.01 && this.beamTex) {
        const haloMat = new THREE.MeshBasicMaterial({
          map: this.beamTex, color: 0xb44dff, transparent: true, opacity: 0.75,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const coreMat = new THREE.MeshBasicMaterial({
          map: this.beamTex, color: 0xffffff, transparent: true, opacity: 1.0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const beamGroup = new THREE.Group();
        const halo = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, len, 12, 1, true), haloMat);
        halo.rotation.x = Math.PI / 2;
        halo.renderOrder = 26;
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, len, 10, 1, true), coreMat);
        core.rotation.x = Math.PI / 2;
        core.renderOrder = 27;
        const mouthMat = new THREE.SpriteMaterial({
          map: getMoteTexture(), color: 0xe0b3ff, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const mouth = new THREE.Sprite(mouthMat);
        mouth.scale.setScalar(2.4);
        mouth.position.z = -len / 2;
        mouth.renderOrder = 28;
        const pulseMat = new THREE.SpriteMaterial({
          map: getMoteTexture(), color: 0xffffff, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const pulse = new THREE.Sprite(pulseMat);
        pulse.scale.setScalar(1.5);
        pulse.position.z = -len / 2;
        pulse.renderOrder = 28;
        beamGroup.add(halo, core, mouth, pulse);
        beamGroup.position.copy(from).add(to).multiplyScalar(0.5);
        beamGroup.lookAt(to);
        beamGroup.scale.set(1, 1, 0.01);
        this.scene.add(beamGroup);
        this.beams.push({
          group: beamGroup, mats: [haloMat, coreMat, mouthMat, pulseMat],
          life: PORTAL_BEAM_LIFE, maxLife: PORTAL_BEAM_LIFE, age: 0,
          phase: Math.random() * 10, len, from: from.clone(), to: to.clone(), pulse,
        });
      }
      const dx = now.x - lock.x;
      const dz = now.z - lock.z;
      if (dx * dx + dz * dz < PORTAL_BEAM_RADIUS * PORTAL_BEAM_RADIUS) {
        this.portalPending += Math.max(1, Math.round(this.boss.damage * 1.0));
      }
      this.portalImpacts.push({ x: lock.x, z: lock.z, s: 1, sc: 1 });
    }
    // Rifts collapse with a pop instead of blinking out.
    for (const r of this.rifts) {
      r.group.visible = false;
      this.dying.push({ rift: r, life: PORTAL_POP_LIFE });
      r.group.visible = true;
    }
    for (const l of this.locks) l.group.visible = false;
    this.lockPoints = [];
    this.volleyActive = false;
    this.portalCd = PORTAL_CD;
  }

  /** Drain banked beam damage (Game polls every frame, like consumeSummon). */
  consumePortalDamage(): number {
    const d = this.portalPending;
    this.portalPending = 0;
    return d;
  }

  /** Drain impact points for Game-side detonation FX (rings, bursts, scorch). */
  consumePortalImpacts(): Array<{ x: number; z: number; s: number; sc: number }> {
    const out = this.portalImpacts;
    this.portalImpacts = [];
    return out;
  }

  private updatePortalFx(dt: number): void {
    this.fxT += dt;
    if (this.beamTex) this.beamTex.offset.y -= dt * 2.6;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      b.age += dt;
      const k = Math.max(0, b.life / b.maxLife);
      b.group.scale.set(1, 1, Math.max(0.01, Math.min(1, b.age * 12)));
      const flick = 0.82 + 0.28 * Math.sin(this.fxT * 47 + b.phase) * Math.sin(this.fxT * 31 + b.phase * 1.7);
      const wob = 1 + 0.16 * Math.sin(this.fxT * 39 + b.phase);
      b.group.scale.x = wob;
      b.group.scale.y = wob;
      const haloMat = b.mats[0] as THREE.MeshBasicMaterial;
      const coreMat = b.mats[1] as THREE.MeshBasicMaterial;
      const mouthMat = b.mats[2] as THREE.SpriteMaterial;
      const pulseMat = b.mats[3] as THREE.SpriteMaterial;
      haloMat.opacity = 0.75 * k * flick;
      coreMat.opacity = k * flick;
      mouthMat.opacity = Math.max(0, 1 - b.age * 5);
      pulseMat.opacity = k;
      b.pulse.position.z = -b.len / 2 + b.len * Math.min(1, b.age / (b.maxLife * 0.8));
      if (b.life <= 0) {
        this.scene.remove(b.group);
        b.group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry.dispose();
        });
        for (const m of b.mats) m.dispose();
        this.beams.splice(i, 1);
      }
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.life -= dt;
      const k = Math.max(0, d.life / PORTAL_POP_LIFE);
      d.rift.group.scale.setScalar(1 + (1 - k) * 0.45);
      d.rift.discMat.opacity = 0.5 * k;
      d.rift.rimMat.opacity = 0.7 * k;
      d.rift.runeMat.opacity = 0.8 * k;
      for (const mo of d.rift.motes) mo.mat.opacity = 0.9 * k;
      if (d.life <= 0) {
        d.rift.group.visible = false;
        d.rift.group.scale.setScalar(1);
        this.dying.splice(i, 1);
      }
    }
  }

  /** Hide all pooled dress (zone change, death, reset). */
  private hideDress(): void {
    for (const r of this.rifts) r.group.visible = false;
    for (const l of this.locks) l.group.visible = false;
    this.dying = [];
    this.lockPoints = [];
    this.volleyActive = false;
  }

  private clearBeams(): void {
    for (const b of this.beams) {
      this.scene.remove(b.group);
      b.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      for (const m of b.mats) m.dispose();
    }
    this.beams = [];
  }

  /** Crown hover point (world): boss feet + torso height. */
  private skyHead(out: THREE.Vector3): THREE.Vector3 {
    out.set(this.boss.position.x, this.boss.group.position.y + 2.8, this.boss.position.z);
    return out;
  }

  /**
   * Skyfall: rise → implode a quarks charge overhead → hurl a ribbon orb.
   * The charge tracks the crown; the bolt flies to a snapshot; the blast
   * banks damage + a scaled impact for Game-side FX.
   */
  private updateSky(dt: number, playerPos: THREE.Vector3, playerAlive: boolean, dist: number): void {
    const fx = this.skyFx;
    if (!fx) return;
    switch (this.skyPhase) {
      case 'idle': {
        if (this.skyCd > 0) {
          this.skyCd -= dt;
          return;
        }
        if (!playerAlive || dist > SKY_RANGE) return;
        if (this.volleyActive || this.warnT > 0) return;
        this.skyPhase = 'rise';
        this.skyT = SKY_RISE;
        this.boss.playSpecial('slam');
        return;
      }
      case 'rise': {
        this.skyT -= dt;
        const k = 1 - Math.max(0, this.skyT) / SKY_RISE;
        const e = k * k * (3 - 2 * k);
        this.boss.group.position.y = SKY_ELEVATE * e;
        if (this.skyT <= 0) {
          const head = this.skyHead(_skyHead);
          this.skyCharge = fx.cloneSky('charge');
          this.skyCharge.emitter.position.copy(head);
          fx.setGravity(this.skyCharge, head.x, head.y, head.z);
          this.skyCore.position.copy(head);
          this.skyCore.scale.setScalar(0.4);
          this.skyCoreMat.opacity = 0.4;
          this.skyCore.visible = true;
          this.skyPhase = 'charge';
          this.skyT = SKY_CHARGE;
          this.boss.playSpecial('slam');
        }
        return;
      }
      case 'charge': {
        const head = this.skyHead(_skyHead);
        if (this.skyCharge) {
          this.skyCharge.emitter.position.copy(head);
          fx.setGravity(this.skyCharge, head.x, head.y, head.z);
        }
        const k = 1 - Math.max(0, this.skyT) / SKY_CHARGE;
        this.skyCore.position.copy(head);
        this.skyCore.scale.setScalar(0.4 + k * 1.6);
        this.skyCoreMat.opacity = 0.4 + k * 0.6;
        this.skyT -= dt;
        if (this.skyT <= 0) this.fireSky(playerPos);
        return;
      }
      case 'fly': {
        this.skyT -= dt;
        if (this.skyBolt) {
          this.skyGlow.position.copy(this.skyBolt.emitter.position);
        }
        if (this.skyPopT > 0) {
          this.skyPopT -= dt;
          if (this.skyPopT <= 0) this.skyCore.visible = false;
        }
        if (this.skyT <= 0) this.detonateSky(playerPos);
        return;
      }
      case 'fade': {
        this.skyT -= dt;
        const y = this.boss.group.position.y;
        this.boss.group.position.y = Math.max(0, y - dt * 14);
        if (this.skyT <= 0) {
          this.boss.group.position.y = 0;
          this.skyPhase = 'idle';
          this.skyCd = SKY_CD;
        }
        return;
      }
    }
  }

  /** Hurl the charged orb at a snapshot of the target. */
  private fireSky(aim: THREE.Vector3): void {
    const fx = this.skyFx;
    if (!fx) {
      this.skyPhase = 'fade';
      this.skyT = SKY_FADE;
      return;
    }
    const head = this.skyHead(_skyHead);
    this.skyTo.set(aim.x, 0.9, aim.z);
    _skyDir.copy(this.skyTo).sub(head);
    const dist = _skyDir.length();
    if (dist < 0.01) {
      this.skyPhase = 'fade';
      this.skyT = SKY_FADE;
      return;
    }
    _skyDir.normalize();
    const bolt = fx.cloneSky('bolt');
    bolt.emitter.position.copy(head);
    bolt.emitter.quaternion.setFromUnitVectors(_skyFwd, _skyDir);
    bolt.startLife = new ConstantValue(dist / SKY_BOLT_SPEED + 0.05);
    this.skyBolt = bolt;
    if (this.skyCharge) {
      fx.detach(this.skyCharge);
      this.skyCharge = null;
    }
    this.skyCore.scale.setScalar(2.6);
    this.skyCoreMat.opacity = 1;
    this.skyPopT = 0.15;
    this.skyGlow.visible = true;
    this.skyGlowMat.opacity = 0.9;
    this.skyFired = true;
    this.skyPhase = 'fly';
    this.skyT = dist / SKY_BOLT_SPEED;
  }

  /** Orb arrival: bank AoE damage + a scaled impact for Game-side FX. */
  private detonateSky(playerPos: THREE.Vector3): void {
    const fx = this.skyFx;
    this.skyGlow.visible = false;
    if (this.skyBolt && fx) {
      this.skyBolt.endEmit();
      fx.detach(this.skyBolt);
      this.skyBolt = null;
    }
    const dx = playerPos.x - this.skyTo.x;
    const dz = playerPos.z - this.skyTo.z;
    if (dx * dx + dz * dz < SKY_RADIUS * SKY_RADIUS) {
      this.skyPending += Math.max(1, Math.round(this.boss.damage * SKY_DMG));
    }
    this.portalImpacts.push({ x: this.skyTo.x, z: this.skyTo.z, s: 1.8, sc: 0.6 });
    this.skyPhase = 'fade';
    this.skyT = SKY_FADE;
  }

  /** Detach charge/bolt, drop the core, ground the boss (reset/death path). */
  private skyCleanup(): void {
    const fx = this.skyFx;
    if (fx) {
      if (this.skyCharge) {
        fx.detach(this.skyCharge);
        this.skyCharge = null;
      }
      if (this.skyBolt) {
        fx.detach(this.skyBolt);
        this.skyBolt = null;
      }
    } else {
      this.skyCharge = null;
      this.skyBolt = null;
    }
    if (this.skyCore) this.skyCore.visible = false;
    if (this.skyGlow) this.skyGlow.visible = false;
    this.boss.group.position.y = 0;
  }

  /** Drain banked skyfall damage (separate channel so toasts stay truthful). */
  consumeSkyDamage(): number {
    const d = this.skyPending;
    this.skyPending = 0;
    return d;
  }

  /** Announce flag for the Game-side "takes flight" toast (one per cast). */
  consumeSkyFired(): boolean {
    if (this.skyFired) {
      this.skyFired = false;
      return true;
    }
    return false;
  }

  consumeSummon(): boolean {
    if (this.summonPending) {
      this.summonPending = false;
      return true;
    }
    return false;
  }

  dispose(): void {
    this.scene.remove(this.telegraph);
    this.telegraph.geometry.dispose();
    (this.telegraph.material as THREE.Material).dispose();
    this.aura?.dispose();
    this.beamTex?.dispose();
    this.beamTex = null;
    if (this.skyCore) {
      this.scene.remove(this.skyCore);
      this.skyCoreMat.dispose();
    }
    if (this.skyGlow) {
      this.scene.remove(this.skyGlow);
      this.skyGlowMat.dispose();
    }
    for (const r of this.rifts) {
      this.scene.remove(r.group);
      r.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      r.discMat.dispose();
      r.rimMat.dispose();
      r.runeMat.dispose();
      for (const mo of r.motes) mo.mat.dispose();
    }
    this.rifts = [];
    for (const l of this.locks) {
      this.scene.remove(l.group);
      l.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      l.ringMat.dispose();
      l.fillMat.dispose();
    }
    this.locks = [];
  }
}
