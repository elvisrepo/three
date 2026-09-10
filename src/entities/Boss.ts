import * as THREE from 'three';
import type { Monster } from './Monster';
import { MagmaAura } from './MagmaAura';

/**
 * Boss extras via composition (Monster stays decoupled — it only exposes
 * playSpecial('slam' | 'roar') one-shot channels):
 * - telegraphed AoE slam (red ring warns 0.9s, then hits within radius)
 * - summons 2 minions once at 50% HP (Game polls consumeSummon())
 * - portal barrage (Hornfather): 3 rifts warn 1.1s tracking you, then
 *   converging beams snapshot your spot (Game polls consumePortalDamage())
 * - 30s respawn for farmable boss loop
 */

interface PortalBeam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
}

const PORTAL_WARN = 1.2;
const PORTAL_LOCK = 0.7;
const PORTAL_CD = 9;
const PORTAL_RANGE = 15;
const PORTAL_BEAM_LIFE = 0.4;
const PORTAL_BEAM_RADIUS = 1.4;
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
  private portals: THREE.Group[] = [];
  private locks: THREE.Vector3[] = [];
  private lockRings: THREE.Mesh[] = [];
  private portalT = 0;
  private portalCd = 6;
  private portalPending = 0;
  private beams: PortalBeam[] = [];

  constructor(private scene: THREE.Scene, readonly boss: Monster, opts?: { magma?: boolean; portals?: boolean }) {
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
    this.clearPortals();
    this.clearBeams();
    if (this.aura) {
      this.aura.group.visible = true;
      this.aura.setIntensity(0.4);
    }
  }

  /** Returns slam damage to the player this frame (0 if none). */
  update(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): number {
    // Beam fade is pure visual — runs even as the boss dies.
    this.updateBeams(dt);
    if (!this.boss.alive) {
      this.wasAlive = false;
      this.telegraph.visible = false;
      this.warnT = 0;
      if (this.aura) this.aura.group.visible = false;
      this.clearPortals();
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
    if (this.slamCd <= 0 && playerAlive && dist < 10) {
      this.warnT = 0.9;
      this.telegraph.visible = true;
      this.telegraph.position.set(this.boss.position.x, 0.06, this.boss.position.z);
      this.boss.playSpecial('slam');
    }
    return 0;
  }

  /**
   * Triple-rift volley: rifts track you for the first stretch, then LOCK —
   * impact rings mark the snapshot while beams charge. Moving (or dashing)
   * out of the rings during the lock dodges the beams entirely.
   */
  private updatePortals(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): void {
    if (this.portals.length > 0) {
      this.portalT -= dt;
      const grow = Math.min(1, (PORTAL_WARN - Math.max(0, this.portalT)) * 4);
      for (const g of this.portals) {
        g.scale.setScalar(Math.max(0.2, grow));
        g.lookAt(playerPos.x, g.position.y, playerPos.z);
        for (const m of g.userData.mats as THREE.MeshBasicMaterial[]) {
          m.opacity = 0.45 + Math.sin(performance.now() * 0.02) * 0.3;
        }
      }
      if (this.portalT <= PORTAL_LOCK && this.locks.length === 0) this.lockPortals(playerPos);
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
    for (const off of spreads) {
      const at = new THREE.Vector3(aim.x + lx * off, 0.07, aim.z + lz * off);
      this.locks.push(at.clone());
      const mat = new THREE.MeshBasicMaterial({
        color: 0xe0b3ff, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, PORTAL_BEAM_RADIUS, 32), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(at);
      ring.renderOrder = 18;
      this.scene.add(ring);
      this.lockRings.push(ring);
    }
  }

  /** Three rifts: above + boss-left + boss-right (boss-local axes). */
  private openPortals(): void {
    const yaw = this.boss.group.rotation.y;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Facing +Z, left hand sits at +X.
    const lx = fz;
    const lz = -fx;
    const bp = this.boss.position;
    const spots = [
      new THREE.Vector3(bp.x, 3.6, bp.z),
      new THREE.Vector3(bp.x + lx * 2.6, 1.6, bp.z + lz * 2.6),
      new THREE.Vector3(bp.x - lx * 2.6, 1.6, bp.z - lz * 2.6),
    ];
    for (const at of spots) {
      const g = new THREE.Group();
      const mats: THREE.MeshBasicMaterial[] = [];
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.85, 28),
        new THREE.MeshBasicMaterial({
          color: 0xb44dff, transparent: true, opacity: 0.5,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
        }),
      );
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.05, 32),
        new THREE.MeshBasicMaterial({
          color: 0xe0b3ff, transparent: true, opacity: 0.7,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
        }),
      );
      rim.position.z = 0.01;
      mats.push(
        disc.material as THREE.MeshBasicMaterial,
        rim.material as THREE.MeshBasicMaterial,
      );
      disc.renderOrder = 24;
      rim.renderOrder = 25;
      g.add(disc, rim);
      g.position.copy(at);
      g.scale.setScalar(0.2);
      g.userData.mats = mats;
      this.scene.add(g);
      this.portals.push(g);
    }
    this.portalT = PORTAL_WARN;
    this.boss.playSpecial('slam');
  }

  /** Boss-left unit vector (facing +Z, left hand sits at +X). */
  private bossLeft(): [number, number] {
    const yaw = this.boss.group.rotation.y;
    return [Math.cos(yaw), -Math.sin(yaw)];
  }

  /** Fire at the LOCKED impacts (empty = boss died mid-warn: fizzle silently). */
  private firePortals(now: THREE.Vector3): void {
    for (let i = 0; i < this.portals.length; i++) {
      const from = this.portals[i].position;
      const lock = this.locks[i % Math.max(1, this.locks.length)] ?? now;
      const to = new THREE.Vector3(lock.x, 0.9, lock.z);
      const len = from.distanceTo(to);
      if (len > 0.01) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xe0b3ff, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, len), mat);
        beam.position.copy(from).add(to).multiplyScalar(0.5);
        beam.lookAt(to);
        beam.renderOrder = 26;
        this.scene.add(beam);
        this.beams.push({ mesh: beam, mat, life: PORTAL_BEAM_LIFE });
      }
      const dx = now.x - lock.x;
      const dz = now.z - lock.z;
      if (dx * dx + dz * dz < PORTAL_BEAM_RADIUS * PORTAL_BEAM_RADIUS) {
        this.portalPending += Math.max(1, Math.round(this.boss.damage * 1.0));
      }
    }
    this.clearPortals();
    this.portalCd = PORTAL_CD;
  }

  /** Drain banked beam damage (Game polls every frame, like consumeSummon). */
  consumePortalDamage(): number {
    const d = this.portalPending;
    this.portalPending = 0;
    return d;
  }

  private updateBeams(dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      b.mat.opacity = Math.max(0, (b.life / PORTAL_BEAM_LIFE)) * 0.95;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mat.dispose();
        this.beams.splice(i, 1);
      }
    }
  }

  private clearPortals(): void {
    for (const r of this.lockRings) {
      this.scene.remove(r);
      r.geometry.dispose();
      (r.material as THREE.Material).dispose();
    }
    this.lockRings = [];
    this.locks = [];
    for (const g of this.portals) {
      this.scene.remove(g);
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      });
    }
    this.portals = [];
  }

  private clearBeams(): void {
    for (const b of this.beams) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mat.dispose();
    }
    this.beams = [];
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
  }
}
