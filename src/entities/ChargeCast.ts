import * as THREE from 'three';
import { getMoteTexture, getCircleTexture } from './SavePoint';
import { getFireAtlas } from './Flipbook';

/** Shared muzzle-core clone (base atlas stays pristine for quarks). */
let muzzleTex: THREE.Texture | null = null;
let muzzleFrames = 16;

function getMuzzleTex(): THREE.Texture {
  if (!muzzleTex) {
    const atlas = getFireAtlas();
    muzzleTex = atlas.tex.clone();
    muzzleTex.needsUpdate = true;
    muzzleTex.wrapS = muzzleTex.wrapT = THREE.ClampToEdgeWrapping;
    muzzleTex.repeat.set(1 / atlas.cols, 1 / atlas.rows);
    muzzleFrames = atlas.frames;
  }
  return muzzleTex;
}

interface Converge {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  phase: number;
  angle: number;
  radius: number;
}

const CONVERGE_COUNT = 8;
const CONVERGE_DUR = 0.45;

/**
 * Windup half of the charged-blast kit: a glow orb swelling at the caster's
 * hand + motes converging from the air + a ring rising with fade zones.
 * Runs for the skill's existing delay, then hands off via onDone (launch).
 * Pooled — start() only mutates, update() allocates nothing.
 */
export class ChargeUp {
  readonly group = new THREE.Group();
  private orbMat!: THREE.SpriteMaterial;
  private orb!: THREE.Sprite;
  private coreMat!: THREE.SpriteMaterial;
  private core!: THREE.Sprite;
  private ringMat!: THREE.MeshBasicMaterial;
  private ring!: THREE.Mesh;
  private motes: Converge[] = [];
  private active = false;
  private t = 0;
  private dur = 0.7;
  private onDone: (() => void) | null = null;

  constructor(scene: THREE.Scene) {
    const moteTex = getMoteTexture();
    this.orbMat = new THREE.SpriteMaterial({
      map: moteTex, color: 0xff6a00, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.orb = new THREE.Sprite(this.orbMat);
    this.orb.renderOrder = 24;
    this.coreMat = new THREE.SpriteMaterial({
      map: moteTex, color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.core = new THREE.Sprite(this.coreMat);
    this.core.renderOrder = 25;
    this.group.add(this.orb, this.core);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xff6a00, transparent: true, opacity: 0,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.44, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 23;
    this.group.add(this.ring);

    for (let i = 0; i < CONVERGE_COUNT; i++) {
      const mat = new THREE.SpriteMaterial({
        map: moteTex, color: 0xff6a00, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 24;
      this.group.add(sprite);
      this.motes.push({
        sprite, mat,
        phase: i / CONVERGE_COUNT,
        angle: Math.random() * Math.PI * 2,
        radius: 1.1 + Math.random() * 0.7,
      });
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  start(x: number, y: number, z: number, color: number, duration: number, onDone?: () => void): void {
    this.group.position.set(x, y, z);
    this.orbMat.color.setHex(color);
    this.ringMat.color.setHex(color);
    for (const m of this.motes) {
      m.mat.color.setHex(color);
      m.angle = Math.random() * Math.PI * 2;
      m.radius = 1.1 + Math.random() * 0.7;
    }
    this.t = 0;
    this.dur = Math.max(0.15, duration);
    this.onDone = onDone ?? null;
    this.active = true;
    this.group.visible = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const k = Math.min(1, this.t / this.dur);

    // Orb swells, then yields to the launch flash in the last stretch.
    const tail = k > 0.85 ? (1 - k) / 0.15 : 1;
    this.orb.scale.setScalar(0.4 + k * 1.2);
    this.orbMat.opacity = Math.min(1, k * 5) * tail;
    this.core.scale.setScalar(0.2 + k * 0.55);
    this.coreMat.opacity = Math.min(1, k * 5) * tail;

    // Rising ring with fade zones (article's charge ring).
    const rk = (this.t * 1.5) % 1;
    this.ring.position.y = -0.9 + rk * 1.8;
    this.ringMat.opacity = Math.sin(rk * Math.PI) * 0.7 * tail;
    this.ring.rotation.z += dt * 2.5;

    // Motes stream into the orb, staggered loops.
    for (const m of this.motes) {
      const mk = (this.t / CONVERGE_DUR + m.phase) % 1;
      const r = (1 - mk) * m.radius;
      m.sprite.position.set(
        Math.cos(m.angle) * r,
        -0.4 + mk * 0.7,
        Math.sin(m.angle) * r,
      );
      const s = 0.22 * (0.5 + mk * 0.5);
      m.sprite.scale.set(s, s, 1);
      m.mat.opacity = Math.sin(mk * Math.PI) * tail;
    }

    if (this.t >= this.dur) {
      this.active = false;
      this.group.visible = false;
      const done = this.onDone;
      this.onDone = null;
      done?.();
    }
  }
}

/**
 * Release half: white-hot core + spinning ray disc that pops and fades in
 * ~0.22s (the article's GSAP-spun muzzle, hand-integrated). Pooled.
 */
export class MuzzleFlash {
  readonly group = new THREE.Group();
  private coreMat!: THREE.SpriteMaterial;
  private core!: THREE.Sprite;
  private raysMat!: THREE.SpriteMaterial;
  private rays!: THREE.Sprite;
  private active = false;
  private t = 0;
  private readonly dur = 0.22;

  constructor(scene: THREE.Scene) {
    this.coreMat = new THREE.SpriteMaterial({
      map: getMuzzleTex(), color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.core = new THREE.Sprite(this.coreMat);
    this.core.renderOrder = 26;
    this.raysMat = new THREE.SpriteMaterial({
      map: getCircleTexture(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.rays = new THREE.Sprite(this.raysMat);
    this.rays.renderOrder = 25;
    this.group.add(this.core, this.rays);
    this.group.visible = false;
    scene.add(this.group);
  }

  fire(x: number, y: number, z: number, color: number): void {
    this.group.position.set(x, y, z);
    this.raysMat.color.setHex(color);
    this.t = 0;
    this.active = true;
    this.group.visible = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const k = Math.min(1, this.t / this.dur);
    this.core.scale.setScalar(0.5 + k * 2.2);
    this.coreMat.opacity = 1 - k;
    // flipbook sweep across the pop (shared clone, same value for all muzzles)
    const tile = Math.min(muzzleFrames - 1, Math.floor(k * muzzleFrames));
    getMuzzleTex().offset.set((tile % 4) / 4, 1 - (Math.floor(tile / 4) + 1) / 4);
    this.rays.scale.setScalar(0.8 + k * 3.4);
    this.raysMat.rotation += dt * 14;
    this.raysMat.opacity = (1 - k) * 0.9;
    if (k >= 1) {
      this.active = false;
      this.group.visible = false;
    }
  }
}
