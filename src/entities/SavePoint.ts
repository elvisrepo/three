import * as THREE from 'three';

export interface SavePointOpts {
  color?: number;
  /** Ground radius of the circle/swirl. */
  radius?: number;
  /** Height of the light pillar. */
  height?: number;
  /** Rising mote count (pooled sprites, created once). */
  motes?: number;
  /** Stagger pulse cycles so Haven spots don't breathe in sync. */
  phase?: number;
}

interface Mote {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  angle: number;
  orbitR: number;
  riseH: number;
  life: number;
  maxLife: number;
  drift: number;
  size: number;
}

let pillarTex: THREE.CanvasTexture | null = null;
let circleTex: THREE.CanvasTexture | null = null;
let moteTex: THREE.CanvasTexture | null = null;

/** Vertical light streaks (white on black — black vanishes under AdditiveBlending). */
function getPillarTexture(): THREE.CanvasTexture {
  if (pillarTex) return pillarTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas not supported');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 128;
    const w = 2 + Math.random() * 9;
    const a = 0.12 + Math.random() * 0.5;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${a.toFixed(2)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w, 256);
  }
  // Fade top/bottom so the tube ends dissolve instead of clipping.
  const fade = ctx.createLinearGradient(0, 0, 0, 256);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.25, 'rgba(0,0,0,0)');
  fade.addColorStop(0.75, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 128, 256);
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  pillarTex = tex;
  return tex;
}

/** Rune circle: concentric rings + tick marks, drawn once, tinted per effect. */
function getCircleTexture(): THREE.CanvasTexture {
  if (circleTex) return circleTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas not supported');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 118, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 100, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, 62, 0, Math.PI * 2);
  ctx.stroke();
  // Outer rune ticks.
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const long = i % 3 === 0;
    const r0 = long ? 102 : 108;
    ctx.lineWidth = long ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
    ctx.lineTo(S / 2 + Math.cos(a) * 116, S / 2 + Math.sin(a) * 116);
    ctx.stroke();
  }
  // Inner triangle glyph.
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    const x = S / 2 + Math.cos(a) * 52;
    const y = S / 2 + Math.sin(a) * 52;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  circleTex = tex;
  return tex;
}

function getMoteTexture(): THREE.CanvasTexture {
  if (moteTex) return moteTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d canvas not supported');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  moteTex = tex;
  return tex;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/**
 * RPG save-point aura from the ICS article (technique-for-technique port):
 * double light pillar (scrolling additive cylinders) + ground swirl (flat torus)
 * + rune-circle planes + rising mote sprites + a shared energy/sparkle pulse.
 *
 * No GSAP / no bloom composer (we are WebGL + dependency-free): the pulse
 * timeline is integrated by hand in update(), glow is faked with additive
 * layers + a PointLight. Everything is allocated once in the constructor —
 * update() only mutates, so it is safe to tick every frame.
 */
export class SavePointEffect {
  readonly group = new THREE.Group();
  private outerMat!: THREE.MeshBasicMaterial;
  private innerMat!: THREE.MeshBasicMaterial;
  private outerTex!: THREE.Texture;
  private innerTex!: THREE.Texture;
  private swirl!: THREE.Mesh;
  private swirlMat!: THREE.MeshBasicMaterial;
  private circleMats: THREE.MeshBasicMaterial[] = [];
  private circleMeshes: THREE.Mesh[] = [];
  private light!: THREE.PointLight;
  private motes: Mote[] = [];
  private t = 0;
  private phase: number;
  private radius: number;
  private height: number;
  private baseLight: number;

  constructor(opts?: SavePointOpts) {
    const color = opts?.color ?? 0x5da9ff;
    this.radius = opts?.radius ?? 1.5;
    this.height = opts?.height ?? 6;
    this.phase = opts?.phase ?? 0;
    const moteCount = opts?.motes ?? 12;
    this.baseLight = 14 + this.radius * 8;

    // --- pillar: outer + inner open cylinders, opposite scroll directions ---
    const pillarGeo = new THREE.CylinderGeometry(
      this.radius * 0.62, this.radius * 0.72, this.height, 32, 1, true,
    );
    this.outerTex = getPillarTexture().clone();
    this.outerTex.needsUpdate = true;
    this.outerTex.wrapS = this.outerTex.wrapT = THREE.RepeatWrapping;
    this.outerMat = new THREE.MeshBasicMaterial({
      map: this.outerTex,
      color,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outer = new THREE.Mesh(pillarGeo, this.outerMat);
    outer.position.y = this.height / 2;
    outer.renderOrder = 20;

    this.innerTex = getPillarTexture().clone();
    this.innerTex.needsUpdate = true;
    this.innerTex.wrapS = this.innerTex.wrapT = THREE.RepeatWrapping;
    this.innerMat = new THREE.MeshBasicMaterial({
      map: this.innerTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const inner = new THREE.Mesh(pillarGeo, this.innerMat);
    inner.scale.set(0.72, 1, 0.72);
    inner.position.y = this.height / 2;
    inner.renderOrder = 21;
    this.group.add(outer, inner);

    // --- swirl: flat torus hugging the ground (article §2) ---
    const swirlGeo = new THREE.TorusGeometry(this.radius * 0.95, this.radius * 0.16, 8, 64);
    this.swirlMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.swirl = new THREE.Mesh(swirlGeo, this.swirlMat);
    this.swirl.rotation.x = Math.PI / 2;
    this.swirl.position.y = 0.06;
    this.swirl.renderOrder = 18;
    this.group.add(this.swirl);

    // --- magic circle: 3 planes, alternating spin (article finale) ---
    const circleTex = getCircleTexture();
    const layers = [
      { s: this.radius * 2.5, y: 0.03, opacity: 0.55, spin: 0.12 },
      { s: this.radius * 1.9, y: 0.045, opacity: 0.7, spin: -0.2 },
      { s: this.radius * 1.2, y: 0.06, opacity: 0.5, spin: 0.3 },
    ];
    layers.forEach((l) => {
      const mat = new THREE.MeshBasicMaterial({
        map: circleTex,
        color,
        transparent: true,
        opacity: l.opacity,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(l.s, l.s), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = l.y;
      mesh.renderOrder = 17;
      mesh.userData.spin = l.spin;
      mesh.userData.baseOpacity = l.opacity;
      this.group.add(mesh);
      this.circleMats.push(mat);
      this.circleMeshes.push(mesh);
    });

    // --- rising motes: staggered loop, no GSAP (article §3 by hand) ---
    const mtex = getMoteTexture();
    for (let i = 0; i < moteCount; i++) {
      const mat = new THREE.SpriteMaterial({
        map: mtex,
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 22;
      this.group.add(sprite);
      const maxLife = rand(2.6, 4.6);
      this.motes.push({
        sprite, mat,
        angle: Math.random() * Math.PI * 2,
        orbitR: rand(0.2, this.radius * 0.8),
        riseH: rand(this.height * 0.55, this.height * 0.95),
        life: Math.random() * maxLife,
        maxLife,
        drift: rand(0.2, 0.9) * (Math.random() < 0.5 ? -1 : 1),
        size: rand(0.22, 0.5),
      });
    }

    this.light = new THREE.PointLight(color, this.baseLight, this.radius * 7 + 6, 2);
    this.light.position.y = 1.6;
    this.group.add(this.light);
  }

  /** Advance the pulse + scroll + rise. dt seconds; no allocation. */
  update(dt: number): void {
    if (!this.group.visible) return;
    let parent = this.group.parent;
    while (parent) {
      if (!parent.visible) return;
      parent = parent.parent;
    }
    this.t += dt;

    // Shared energy/sparkle pulse (article finale: 1.2s build → 3s afterglow).
    const CYCLE = 4.4;
    const ct = (this.t + this.phase) % CYCLE;
    let energy: number;
    let sparkle: number;
    if (ct < 1.2) {
      const k = ct / 1.2;
      const e = k * k * (3 - 2 * k); // smoothstep build-up
      energy = 0.8 * e;
      sparkle = 0.2 + 0.8 * e;
    } else {
      const k = (ct - 1.2) / (CYCLE - 1.2);
      const e = 1 - Math.pow(1 - k, 2); // ease-out afterglow
      energy = 0.8 * (1 - e);
      sparkle = 1 - 0.8 * e;
    }

    // Pillar scroll (opposing directions) + breathing opacity.
    this.outerTex.offset.x += dt * (0.12 + energy * 0.25);
    this.innerTex.offset.x -= dt * (0.18 + energy * 0.3);
    this.outerMat.opacity = 0.26 + energy * 0.3;
    this.innerMat.opacity = 0.2 + energy * 0.28;

    // Swirl spins faster during the pulse (article §2 speed term).
    const speed = 0.35 + energy * 1.4;
    this.swirl.rotation.z += dt * speed * 2;
    this.swirlMat.opacity = 0.24 + energy * 0.3;

    // Magic-circle layers counter-rotate.
    for (const m of this.circleMeshes) {
      m.rotation.z += dt * (m.userData.spin as number) * (1 + energy * 2.2);
      const base = m.userData.baseOpacity as number;
      (m.material as THREE.MeshBasicMaterial).opacity = base * (0.7 + energy * 0.8);
    }

    // Motes rise + fade; brightness follows sparkle.
    for (const mo of this.motes) {
      mo.life += dt;
      if (mo.life >= mo.maxLife) {
        mo.life = 0;
        mo.angle = Math.random() * Math.PI * 2;
        mo.orbitR = rand(0.2, this.radius * 0.8);
        mo.riseH = rand(this.height * 0.55, this.height * 0.95);
        mo.maxLife = rand(2.6, 4.6);
      }
      const k = mo.life / mo.maxLife;
      mo.angle += dt * mo.drift;
      mo.sprite.position.set(
        Math.cos(mo.angle) * mo.orbitR,
        0.3 + k * mo.riseH,
        Math.sin(mo.angle) * mo.orbitR,
      );
      const fadeIn = Math.min(1, k / 0.2);
      const fadeOut = Math.min(1, (1 - k) / 0.3);
      mo.mat.opacity = Math.min(fadeIn, fadeOut) * (0.35 + sparkle * 0.65);
      const s = mo.size * (0.7 + k * 0.7);
      mo.sprite.scale.set(s, s, 1);
    }

    this.light.intensity = this.baseLight * (0.65 + energy * 1.1 + sparkle * 0.25);
  }
}
