import * as THREE from 'three';

interface FloatText {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  life: number;
  maxLife: number;
  vy: number;
  baseScale: number;
}

const POOL_SIZE = 28;

/** Pooled world-space floating damage numbers (zero per-frame allocation). */
export class DamageNumbers {
  private pool: FloatText[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d canvas not supported');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 50;
      sprite.scale.set(1.7, 0.85, 1);
      scene.add(sprite);
      this.pool.push({ sprite, canvas, ctx, texture, life: 0, maxLife: 0.9, vy: 1.9, baseScale: 1.7 });
    }
  }

  spawn(pos: THREE.Vector3, text: string, opts?: { color?: string; crit?: boolean; scale?: number }): void {
    const item = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;

    const { ctx, canvas, texture, sprite } = item;
    const color = opts?.color ?? '#ffffff';
    const crit = opts?.crit ?? false;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `900 ${crit ? 44 : 34}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 80, 40);
    ctx.fillStyle = color;
    ctx.fillText(text, 80, 40);
    texture.needsUpdate = true;

    sprite.position.set(pos.x + (Math.random() - 0.5) * 0.7, pos.y + 2.2 + Math.random() * 0.3, pos.z);
    const s = (opts?.scale ?? 1.7) * (crit ? 1.35 : 1);
    item.baseScale = s;
    sprite.scale.set(s, s * 0.5, 1);
    (sprite.material as THREE.SpriteMaterial).opacity = 1;
    sprite.visible = true;
    item.life = item.maxLife = crit ? 1.0 : 0.8;
    item.vy = crit ? 2.3 : 1.9;
  }

  update(dt: number): void {
    for (const item of this.pool) {
      if (!item.sprite.visible) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.sprite.visible = false;
        continue;
      }
      item.sprite.position.y += item.vy * dt;
      const t = item.life / item.maxLife;
      (item.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, t * 2);
      const pop = 1 + (1 - t) * 0.08;
      item.sprite.scale.set(item.baseScale * pop, item.baseScale * 0.5 * pop, 1);
    }
  }
}
