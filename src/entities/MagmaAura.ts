import * as THREE from 'three';
import { getMoteTexture } from './SavePoint';

interface Spark {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  angle: number;
  radius: number;
  y: number;
  speed: number;
  maxY: number;
  baseOpacity: number;
}

let magmaTex: THREE.CanvasTexture | null = null;
let streakTex: THREE.CanvasTexture | null = null;

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Dark crust + glowing cracks, drawn once and shared (cloned per aura for scrolling). */
export function getMagmaTexture(): THREE.CanvasTexture {
  if (magmaTex) return magmaTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas not supported');
  ctx.fillStyle = '#200a05';
  ctx.fillRect(0, 0, S, S);
  // Deep heat blotches.
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = rand(10, 34);
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    const hot = Math.random() < 0.4;
    g.addColorStop(0, hot ? 'rgba(255,170,40,0.85)' : 'rgba(200,60,10,0.7)');
    g.addColorStop(1, 'rgba(120,20,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Glowing cracks: random walks, orange with a yellow core.
  ctx.lineCap = 'round';
  for (let i = 0; i < 34; i++) {
    let x = Math.random() * S;
    let y = Math.random() * S;
    let a = Math.random() * Math.PI * 2;
    ctx.strokeStyle = 'rgba(255,106,0,0.9)';
    ctx.lineWidth = rand(2.5, 5.5);
    ctx.shadowColor = 'rgba(255,90,0,0.9)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 4 + Math.floor(Math.random() * 5);
    for (let s = 0; s < steps; s++) {
      a += rand(-0.9, 0.9);
      x += Math.cos(a) * rand(10, 26);
      y += Math.sin(a) * rand(10, 26);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,210,63,0.85)';
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 6;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // Cold crust plates drifting over the flow.
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    ctx.fillStyle = 'rgba(11,3,2,0.88)';
    ctx.beginPath();
    const n = 5 + Math.floor(Math.random() * 3);
    for (let k = 0; k <= n; k++) {
      const aa = (k / n) * Math.PI * 2;
      const rr = rand(8, 22);
      const px = x + Math.cos(aa) * rr;
      const py = y + Math.sin(aa) * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  magmaTex = tex;
  return tex;
}

/** Short vertical streak for recycled spark planes. */
function getStreakTexture(): THREE.CanvasTexture {
  if (streakTex) return streakTex;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas not supported');
  const v = ctx.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.45, 'rgba(255,255,255,0.9)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 32, 128);
  ctx.globalCompositeOperation = 'destination-in';
  const h = ctx.createLinearGradient(0, 0, 32, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, 32, 128);
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  streakTex = tex;
  return tex;
}

/**
 * Boss magma shell (ICS magma article, WebGL port): scrolling magma sphere +
 * reverse-scroll aura shell + BackSide rim (fresnel stand-in, no TSL) + glow
 * billboard + recycled rising spark planes + point light.
 *
 * Everything is allocated once — update() only mutates. Intensity is driven
 * externally (slam warn / enrage) and smoothed internally so flares don't pop.
 */
export class MagmaAura {
  readonly group = new THREE.Group();
  private magmaMat!: THREE.MeshBasicMaterial;
  private magmaTex!: THREE.Texture;
  private auraMat!: THREE.MeshBasicMaterial;
  private auraTex!: THREE.Texture;
  private rimMat!: THREE.MeshBasicMaterial;
  private glowMat!: THREE.SpriteMaterial;
  private glow!: THREE.Sprite;
  private light!: THREE.PointLight;
  private sparks: Spark[] = [];
  private t = 0;
  private target = 0.4;
  private level = 0.4;
  private radius: number;
  private baseLight: number;
  private glowBase: number;

  constructor(opts?: { radius?: number; sparks?: number }) {
    this.radius = opts?.radius ?? 0.9;
    const sparkCount = opts?.sparks ?? 10;
    this.baseLight = 26;
    this.glowBase = this.radius * 6;

    // Magma sphere: additive scrolling cracks over the body (body shows through).
    this.magmaTex = getMagmaTexture().clone();
    this.magmaTex.needsUpdate = true;
    this.magmaTex.wrapS = this.magmaTex.wrapT = THREE.RepeatWrapping;
    this.magmaMat = new THREE.MeshBasicMaterial({
      map: this.magmaTex,
      color: 0xffb36b,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const magma = new THREE.Mesh(new THREE.SphereGeometry(this.radius, 28, 20), this.magmaMat);
    magma.renderOrder = 20;

    // Aura shell: larger, fainter, reverse scroll (article §2).
    this.auraTex = getMagmaTexture().clone();
    this.auraTex.needsUpdate = true;
    this.auraTex.wrapS = this.auraTex.wrapT = THREE.RepeatWrapping;
    this.auraMat = new THREE.MeshBasicMaterial({
      map: this.auraTex,
      color: 0xff5a1f,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const aura = new THREE.Mesh(new THREE.SphereGeometry(this.radius * 1.14, 24, 16), this.auraMat);
    aura.renderOrder = 21;

    // Rim: BackSide shell glowing at the silhouette (fresnel stand-in, no TSL).
    this.rimMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const rim = new THREE.Mesh(new THREE.SphereGeometry(this.radius * 1.18, 24, 16), this.rimMat);
    rim.renderOrder = 19;
    this.group.add(magma, aura, rim);

    // Outer glow billboard (article §3).
    this.glowMat = new THREE.SpriteMaterial({
      map: getMoteTexture(),
      color: 0xff7b1f,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.scale.setScalar(this.glowBase);
    this.glow.renderOrder = 22;
    this.group.add(this.glow);

    // Recycled rising sparks (article §4, rising embers instead of falling).
    const streak = getStreakTexture();
    const sparkGeo = new THREE.PlaneGeometry(0.09, 1.0);
    for (let i = 0; i < sparkCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: streak,
        color: i % 2 === 0 ? 0xffb36b : 0xff5a1f,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(sparkGeo, mat);
      mesh.renderOrder = 23;
      this.group.add(mesh);
      this.sparks.push({
        mesh, mat,
        angle: Math.random() * Math.PI * 2,
        radius: rand(this.radius * 0.7, this.radius * 1.3),
        y: Math.random() * this.radius * 2.2,
        speed: rand(1.2, 2.6),
        maxY: this.radius * 2.4,
        baseOpacity: rand(0.35, 0.6),
      });
      mesh.rotation.y = Math.random() * Math.PI;
    }

    this.light = new THREE.PointLight(0xff6a1f, this.baseLight, 12, 2);
    this.light.position.y = 0.2;
    this.group.add(this.light);
  }

  /** Desired heat 0..1.5 (slam warn / enrage); smoothed in update(). */
  setIntensity(v: number): void {
    this.target = THREE.MathUtils.clamp(v, 0, 1.5);
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    this.level += (this.target - this.level) * (1 - Math.exp(-8 * dt));
    const e = this.level;

    // UV flow: magma drifts, aura counter-drifts, both breathe with heat.
    this.magmaTex.offset.x += dt * (0.04 + e * 0.1);
    this.magmaTex.offset.y += dt * (0.03 + e * 0.08);
    this.auraTex.offset.x -= dt * (0.06 + e * 0.14);
    this.auraTex.offset.y -= dt * (0.02 + e * 0.05);
    this.magmaMat.opacity = 0.32 + e * 0.34;
    this.auraMat.opacity = 0.16 + e * 0.3;
    this.rimMat.opacity = 0.18 + e * 0.34;
    this.glowMat.opacity = 0.26 + e * 0.4;
    this.glow.scale.setScalar(this.glowBase * (1 + e * 0.18 + 0.04 * Math.sin(this.t * 7)));

    for (const s of this.sparks) {
      s.y += s.speed * (0.6 + e) * dt;
      if (s.y >= s.maxY) {
        s.y = 0.1;
        s.angle = Math.random() * Math.PI * 2;
        s.radius = rand(this.radius * 0.7, this.radius * 1.3);
        s.speed = rand(1.2, 2.6);
      }
      s.mesh.position.set(Math.cos(s.angle) * s.radius, s.y, Math.sin(s.angle) * s.radius);
      const fadeIn = Math.min(1, s.y / (s.maxY * 0.25));
      const fadeOut = Math.min(1, (s.maxY - s.y) / (s.maxY * 0.35));
      s.mat.opacity = s.baseOpacity * Math.min(fadeIn, fadeOut) * Math.min(1, e + 0.2);
    }

    this.light.intensity = this.baseLight * (0.45 + e * 0.9);
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material;
        // Shared module textures (streak) stay alive; per-aura scroll clones die here.
        const tex = (mat as THREE.MeshBasicMaterial).map as THREE.Texture | undefined;
        if (tex === this.magmaTex || tex === this.auraTex) tex.dispose();
        mat.dispose();
      } else if ((o as THREE.Sprite).isSprite) {
        (o as THREE.Sprite).material.dispose();
      }
    });
  }
}
