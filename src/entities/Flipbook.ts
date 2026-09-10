import * as THREE from 'three';

export interface Atlas {
  tex: THREE.CanvasTexture;
  cols: number;
  rows: number;
  frames: number;
}

const ATLAS_SIZE = 512;
const COLS = 4;
const ROWS = 4;

let fireAtlas: Atlas | null = null;
let smokeAtlas: Atlas | null = null;

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function makeAtlas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tile: number } {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas not supported');
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  return { canvas, ctx, tile: ATLAS_SIZE / COLS };
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural flipbook atlases (three.quarks reference-sheet look, drawn at boot).
 *
 * Frames are RADIALLY SYMMETRIC on purpose: quarks samples tiles in-shader
 * and our manual offset cyclers don't need flipY math when orientation is moot.
 *
 * CONTRACT: base atlas textures are READ-ONLY. quarks applies tile UVs in its
 * shader on top of map transform — mutating offset/repeat on these breaks
 * every system sampling them. Offset cyclers (bolts, muzzles) keep OWN clones.
 */
export function getFireAtlas(): Atlas {
  if (fireAtlas) return fireAtlas;
  const { canvas, ctx, tile } = makeAtlas();
  const frames = COLS * ROWS;
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const cx = (i % COLS) * tile + tile / 2;
    const cy = Math.floor(i / COLS) * tile + tile / 2;
    const R = tile * 0.48;

    // Outer glow wash.
    let g = ctx.createRadialGradient(cx, cy, 1, cx, cy, R);
    g.addColorStop(0, `rgba(255,120,20,${(0.55 * (1 - t)).toFixed(3)})`);
    g.addColorStop(1, 'rgba(120,20,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    // Ray spokes (long early, stubby late).
    const rays = 8;
    ctx.lineCap = 'round';
    for (let r = 0; r < rays; r++) {
      const a = (r / rays) * Math.PI * 2 + rand(-0.1, 0.1);
      const len = R * (0.95 - t * 0.75) * rand(0.8, 1.1);
      ctx.strokeStyle = `rgba(255,${Math.round(150 - t * 60)},30,${(0.75 * (1 - t)).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, tile * 0.045 * (1 - t * 0.7));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.12, cy + Math.sin(a) * R * 0.12);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }

    // White-hot core, shrinking.
    const cr = R * (0.42 - t * 0.3);
    g = ctx.createRadialGradient(cx, cy, 1, cx, cy, Math.max(1, cr));
    g.addColorStop(0, `rgba(255,246,220,${(1 - t * 0.55).toFixed(3)})`);
    g.addColorStop(0.5, `rgba(255,190,80,${(0.9 * (1 - t * 0.6)).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, cr), 0, Math.PI * 2);
    ctx.fill();

    // Late embers.
    if (t > 0.45) {
      for (let e = 0; e < 6; e++) {
        const a = Math.random() * Math.PI * 2;
        const d = rand(R * 0.3, R * 0.95);
        ctx.fillStyle = `rgba(255,140,40,${((t - 0.45) * 1.4).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rand(1, 2.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  fireAtlas = { tex: toTexture(canvas), cols: COLS, rows: ROWS, frames };
  return fireAtlas;
}

export function getSmokeAtlas(): Atlas {
  if (smokeAtlas) return smokeAtlas;
  const { canvas, ctx, tile } = makeAtlas();
  const frames = COLS * ROWS;
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const cx = (i % COLS) * tile + tile / 2;
    const cy = Math.floor(i / COLS) * tile + tile / 2 - t * tile * 0.12;
    const R = tile * 0.4;

    // Puff cluster: grows, drifts up, fades.
    for (let b = 0; b < 7; b++) {
      const a = (b / 7) * Math.PI * 2 + rand(-0.3, 0.3);
      const d = b === 0 ? 0 : rand(R * 0.25, R * 0.7);
      const bx = cx + Math.cos(a) * d;
      const by = cy + Math.sin(a) * d;
      const br = R * rand(0.3, 0.5) * (0.8 + t * 1.5);
      const alpha = 0.3 * (1 - t) + 0.05;
      const shade = Math.round(rand(150, 205));
      const g = ctx.createRadialGradient(bx, by, 1, bx, by, Math.max(1, br));
      g.addColorStop(0, `rgba(${shade},${shade},${shade},${alpha.toFixed(3)})`);
      g.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(1, br), 0, Math.PI * 2);
      ctx.fill();
    }

    // Early sparks riding the puff.
    if (t < 0.35) {
      for (let e = 0; e < 5; e++) {
        const a = Math.random() * Math.PI * 2;
        const d = rand(R * 0.4, R * 1.1);
        ctx.fillStyle = `rgba(255,150,50,${((0.35 - t) * 2.2).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rand(1, 2.2), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  smokeAtlas = { tex: toTexture(canvas), cols: COLS, rows: ROWS, frames };
  return smokeAtlas;
}
