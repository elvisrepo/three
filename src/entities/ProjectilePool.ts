import * as THREE from 'three';
import type { Monster } from './Monster';
import type { DamageNumbers } from './DamageNumbers';

interface Bolt {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  vel: THREE.Vector3;
  traveled: number;
  range: number;
  damage: number;
  active: boolean;
}

/** Pooled player projectiles (Fireball). No per-shot allocation. */
export class ProjectilePool {
  private bolts: Bolt[] = [];

  constructor(scene: THREE.Scene, size = 16) {
    const geo = new THREE.SphereGeometry(0.24, 12, 10);
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xff9a2e,
        emissive: 0xff6a00,
        emissiveIntensity: 1.6,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.castShadow = false;
      scene.add(mesh);
      this.bolts.push({ mesh, mat, vel: new THREE.Vector3(), traveled: 0, range: 18, damage: 10, active: false });
    }
  }

  fire(from: THREE.Vector3, dir: THREE.Vector3, damage: number, speed = 15, range = 18): void {
    const bolt = this.bolts.find((b) => !b.active);
    if (!bolt) return;
    bolt.active = true;
    bolt.damage = damage;
    bolt.range = range;
    bolt.traveled = 0;
    bolt.vel.copy(dir).setY(0).normalize().multiplyScalar(speed);
    bolt.mesh.position.set(from.x, 1.3, from.z);
    bolt.mesh.visible = true;
  }

  get activeCount(): number {
    let n = 0;
    for (const b of this.bolts) if (b.active) n++;
    return n;
  }

  update(dt: number, monsters: Monster[], numbers: DamageNumbers, onKill: (m: Monster) => void): void {
    for (const bolt of this.bolts) {
      if (!bolt.active) continue;
      const step = bolt.vel.clone().multiplyScalar(dt);
      bolt.mesh.position.add(step);
      bolt.traveled += step.length();
      // spin glow pulse
      bolt.mat.emissiveIntensity = 1.3 + Math.sin(performance.now() * 0.02) * 0.5;

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
