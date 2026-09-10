import * as THREE from 'three';
import type { Monster } from './Monster';
import type { DamageNumbers } from './DamageNumbers';
import { getFireAtlas } from './Flipbook';

interface Bolt {
  /** Container (position/visibility driver) — ball XOR arrow child is visible. */
  mesh: THREE.Group;
  ball: THREE.Mesh;
  arrow: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  glowMat: THREE.SpriteMaterial;
  vel: THREE.Vector3;
  traveled: number;
  range: number;
  damage: number;
  color: number;
  /** Trail ember color (null = no trail — arrows, shields stay clean). */
  trail: number | null;
  trailT: number;
  /** Mana refunded to the caster on hit (mage/archer builder loop, 0 = none). */
  siphon: number;
  active: boolean;
}

/** Shared arrow build (shaft + head + fletch along +Z, lookAt-aimed on fire). */
const ARROW_SHAFT = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6);
const ARROW_HEAD = new THREE.ConeGeometry(0.09, 0.28, 8);
const ARROW_FLETCH = new THREE.BoxGeometry(0.02, 0.18, 0.28);
const _aim = new THREE.Vector3();

/** Pooled player projectiles (Fireball). No per-shot allocation. */
export class ProjectilePool {
  private bolts: Bolt[] = [];
  /** Own flipbook clone (read-only base atlas stays pristine for quarks). */
  private headTex: THREE.Texture;
  private headTile = 0;
  private headFrames = 16;

  constructor(scene: THREE.Scene, size = 16) {
    const geo = new THREE.SphereGeometry(0.24, 12, 10);
    const atlas = getFireAtlas();
    this.headTex = atlas.tex.clone();
    this.headTex.needsUpdate = true;
    this.headTex.wrapS = this.headTex.wrapT = THREE.ClampToEdgeWrapping;
    this.headTex.repeat.set(1 / atlas.cols, 1 / atlas.rows);
    this.headFrames = atlas.frames;
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xff9a2e,
        emissive: 0xff6a00,
        emissiveIntensity: 1.6,
        roughness: 0.3,
      });
      const mesh = new THREE.Group();
      mesh.visible = false;
      const ball = new THREE.Mesh(geo, mat);
      const arrow = new THREE.Group();
      const shaft = new THREE.Mesh(ARROW_SHAFT, mat);
      shaft.rotation.x = Math.PI / 2;
      const head = new THREE.Mesh(ARROW_HEAD, mat);
      head.rotation.x = Math.PI / 2;
      head.position.z = 0.56;
      const fletch = new THREE.Mesh(ARROW_FLETCH, mat);
      fletch.position.z = -0.38;
      arrow.add(shaft, head, fletch);
      arrow.visible = false;
      const glowMat = new THREE.SpriteMaterial({
        map: this.headTex,
        color: 0xff6a00,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glowBall = new THREE.Sprite(glowMat);
      glowBall.scale.setScalar(1.7);
      glowBall.renderOrder = 21;
      ball.add(glowBall);
      const glowArrow = new THREE.Sprite(glowMat);
      glowArrow.scale.setScalar(1.3);
      glowArrow.renderOrder = 21;
      arrow.add(glowArrow);
      mesh.add(ball, arrow);
      scene.add(mesh);
      this.bolts.push({ mesh, ball, arrow, mat, glowMat, vel: new THREE.Vector3(), traveled: 0, range: 18, damage: 10, color: 0xff6a00, trail: null, trailT: 0, siphon: 0, active: false });
    }
  }

  fire(from: THREE.Vector3, dir: THREE.Vector3, damage: number, speed = 15, range = 18, color?: number, trail?: number | null, siphon = 0, arrow = false): void {
    const bolt = this.bolts.find((b) => !b.active);
    if (!bolt) return;
    bolt.active = true;
    bolt.damage = damage;
    bolt.color = color ?? 0xff6a00;
    bolt.trail = trail ?? null;
    bolt.trailT = 0;
    bolt.siphon = siphon;
    bolt.range = range;
    bolt.traveled = 0;
    if (color !== undefined) {
      bolt.mat.color.setHex(color);
      bolt.mat.emissive.setHex(color);
      bolt.glowMat.color.setHex(color);
    } else {
      bolt.mat.color.setHex(0xff9a2e);
      bolt.mat.emissive.setHex(0xff6a00);
      bolt.glowMat.color.setHex(0xff6a00);
    }
    bolt.vel.copy(dir).setY(0).normalize().multiplyScalar(speed);
    bolt.mesh.position.set(from.x, 1.3, from.z);
    bolt.mesh.visible = true;
    bolt.ball.visible = !arrow;
    bolt.arrow.visible = arrow;
    if (arrow) bolt.arrow.lookAt(_aim.copy(from).setY(1.3).add(dir));
  }

  get activeCount(): number {
    let n = 0;
    for (const b of this.bolts) if (b.active) n++;
    return n;
  }

  update(
    dt: number,
    monsters: Monster[],
    numbers: DamageNumbers,
    onKill: (m: Monster) => void,
    onHit?: (dealt: number, m: Monster, color: number, siphon: number) => void,
    onTrail?: (x: number, y: number, z: number, color: number) => void,
  ): void {
    // flipbook head cycle (shared clone — all bolts stay in sync, invisible in flight)
    this.headTile = (this.headTile + dt * 24) % this.headFrames;
    const headCol = Math.floor(this.headTile) % 4;
    const headRow = Math.floor(Math.floor(this.headTile) / 4);
    this.headTex.offset.set(headCol / 4, 1 - (headRow + 1) / 4);
    for (const bolt of this.bolts) {
      if (!bolt.active) continue;
      const step = bolt.vel.clone().multiplyScalar(dt);
      bolt.mesh.position.add(step);
      bolt.traveled += step.length();
      // spin glow pulse
      bolt.mat.emissiveIntensity = 1.3 + Math.sin(performance.now() * 0.02) * 0.5;
      // fire trail: one ember mote per tick (pool-side, Game supplies the puff)
      if (bolt.trail !== null && onTrail) {
        bolt.trailT -= dt;
        if (bolt.trailT <= 0) {
          bolt.trailT = 0.06;
          onTrail(bolt.mesh.position.x, bolt.mesh.position.y, bolt.mesh.position.z, bolt.trail);
        }
      }

      let hit = false;
      if (bolt.traveled < bolt.range + 2) {
        for (const m of monsters) {
          if (!m.alive) continue;
          const dx = bolt.mesh.position.x - m.position.x;
          const dz = bolt.mesh.position.z - m.position.z;
          const r = m.radius + 0.35;
          if (dx * dx + dz * dz < r * r) {
            const crit = Math.random() < 0.15;
            const dmg = Math.max(1, Math.round(bolt.damage * (0.9 + Math.random() * 0.25) * (crit ? 1.5 : 1)));
            const died = m.takeDamage(dmg, crit, numbers);
            onHit?.(dmg, m, bolt.color, bolt.siphon);
            if (died) onKill(m);
            hit = true;
            break;
          }
        }
      }

      const out =
        Math.abs(bolt.mesh.position.x) > 30 ||
        Math.abs(bolt.mesh.position.z) > 30 ||
        bolt.traveled >= bolt.range;

      if (hit || out) {
        bolt.active = false;
        bolt.mesh.visible = false;
      }
    }
  }
}
