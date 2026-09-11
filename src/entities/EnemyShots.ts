import * as THREE from 'three';

interface Shot {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  vel: THREE.Vector3;
  traveled: number;
  range: number;
  damage: number;
  active: boolean;
}

const _dir = new THREE.Vector3();

/** Pooled hostile orbs (spitter trash). Mirrors ProjectilePool, but hits the
 *  player instead of monsters — no per-shot allocation. */
export class EnemyShots {
  private shots: Shot[] = [];

  constructor(scene: THREE.Scene, size = 12) {
    const geo = new THREE.SphereGeometry(0.22, 10, 8);
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xc07bff,
        emissive: 0xc07bff,
        emissiveIntensity: 1.6,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.shots.push({ mesh, mat, vel: new THREE.Vector3(), traveled: 0, range: 16, damage: 5, active: false });
    }
  }

  fire(from: THREE.Vector3, target: THREE.Vector3, damage: number, color: number, speed = 10, range = 16): void {
    const s = this.shots.find((x) => !x.active);
    if (!s) return;
    s.active = true;
    s.damage = damage;
    s.range = range;
    s.traveled = 0;
    s.mat.color.setHex(color);
    s.mat.emissive.setHex(color);
    s.mesh.position.set(from.x, 1.2, from.z);
    s.mesh.visible = true;
    _dir.copy(target).sub(from).setY(0);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
    s.vel.copy(_dir.normalize().multiplyScalar(speed));
  }

  update(dt: number, playerPos: THREE.Vector3, onPlayerHit: (dmg: number) => void): void {
    for (const s of this.shots) {
      if (!s.active) continue;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.traveled += s.vel.length() * dt;
      const dx = s.mesh.position.x - playerPos.x;
      const dz = s.mesh.position.z - playerPos.z;
      if (dx * dx + dz * dz < 0.7 * 0.7) {
        s.active = false;
        s.mesh.visible = false;
        onPlayerHit(s.damage);
        continue;
      }
      if (s.traveled >= s.range || Math.abs(s.mesh.position.x) > 30 || Math.abs(s.mesh.position.z) > 30) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
  }

  clear(): void {
    for (const s of this.shots) {
      s.active = false;
      s.mesh.visible = false;
    }
  }
}
