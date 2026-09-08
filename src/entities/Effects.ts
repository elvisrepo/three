import * as THREE from 'three';

export interface BurstOpts {
  color?: number;
  count?: number;
  speed?: number;
  up?: number;
  life?: number;
  size?: number;
  gravity?: number;
}

interface Particle {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  baseScale: number;
  active: boolean;
}

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  maxR: number;
  active: boolean;
}

interface Scorch {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  active: boolean;
}

const P_COUNT = 128;
const R_COUNT = 10;
const S_COUNT = 6;

function softTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas not supported');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Pooled combat FX: additive glow particles, expanding rings, fading scorch decals.
 * Zero allocation after construction — call burst()/ring()/scorch(), then update(dt).
 */
export class Effects {
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private scorches: Scorch[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    const tex = softTexture();
    for (let i = 0; i < P_COUNT; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 40;
      scene.add(sprite);
      this.parts.push({ sprite, mat, vel: new THREE.Vector3(), life: 0, maxLife: 0.4, gravity: 6, baseScale: 1, active: false });
    }
    const ringGeo = new THREE.RingGeometry(0.85, 1.0, 48);
    for (let i = 0; i < R_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 15;
      scene.add(mesh);
      this.rings.push({ mesh, mat, life: 0, maxLife: 0.45, maxR: 4, active: false });
    }
    const scorchGeo = new THREE.CircleGeometry(1, 24);
    for (let i = 0; i < S_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(scorchGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.scorches.push({ mesh, mat, life: 0, active: false });
    }
  }

  burst(x: number, y: number, z: number, opts?: BurstOpts): void {
    const count = opts?.count ?? 10;
    const speed = opts?.speed ?? 4;
    const color = opts?.color ?? 0xffffff;
    const life = opts?.life ?? 0.4;
    const size = opts?.size ?? 0.9;
    const gravity = opts?.gravity ?? 6;
    const up = opts?.up ?? 2;
    for (let n = 0; n < count; n++) {
      const p = this.parts[this.cursor];
      this.cursor = (this.cursor + 1) % this.parts.length;
      const theta = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      p.vel.set(Math.cos(theta) * sp, up * (0.4 + Math.random() * 0.8), Math.sin(theta) * sp);
      p.sprite.position.set(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.4);
      p.mat.color.setHex(color);
      p.mat.opacity = 1;
      p.baseScale = size * (0.6 + Math.random() * 0.8);
      p.sprite.scale.setScalar(p.baseScale);
      p.life = p.maxLife = life * (0.6 + Math.random() * 0.7);
      p.gravity = gravity;
      p.active = true;
      p.sprite.visible = true;
    }
  }

  ring(x: number, z: number, color: number, maxR: number, life = 0.45, y = 0.07): void {
    const r = this.rings.find((q) => !q.active) ?? this.rings[0];
    r.active = true;
    r.life = r.maxLife = life;
    r.maxR = maxR;
    r.mat.color.setHex(color);
    r.mesh.position.set(x, y, z);
    r.mesh.visible = true;
  }

  scorch(x: number, z: number, r = 3): void {
    const s = this.scorches.find((q) => !q.active) ?? this.scorches[0];
    s.active = true;
    s.life = 5;
    s.mat.opacity = 0.55;
    s.mesh.position.set(x, 0.025, z);
    s.mesh.scale.setScalar(r);
    s.mesh.visible = true;
  }

  update(dt: number): void {
    for (const p of this.parts) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      if (p.sprite.position.y < 0.05) {
        p.sprite.position.y = 0.05;
        p.vel.y *= -0.3;
      }
      const t = p.life / p.maxLife;
      p.mat.opacity = t;
      p.sprite.scale.setScalar(Math.max(0.01, p.baseScale * t));
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(0.2 + t * r.maxR);
      r.mat.opacity = (1 - t) * 0.9;
    }
    for (const s of this.scorches) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.mat.opacity = Math.min(0.55, s.life * 0.3);
    }
  }
}
