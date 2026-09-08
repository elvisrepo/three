import * as THREE from 'three';
import { RARITY_COLOR, type ItemInstance } from '../items/Items';

interface Drop {
  group: THREE.Group;
  item: ItemInstance;
  phase: number;
}

function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}

/** Ground loot: rarity-colored crystal + light beam. Walk within ~2m to pick up. */
export class LootManager {
  drops: Drop[] = [];

  constructor(private scene: THREE.Scene) {}

  spawnItem(pos: THREE.Vector3, item: ItemInstance): void {
    const color = new THREE.Color(RARITY_COLOR[item.rarity]);
    const group = new THREE.Group();

    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(item.rarity === 'legendary' ? 0.5 : 0.35),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.3 }),
    );
    gem.position.y = 0.75;
    gem.castShadow = true;

    const beamH = item.rarity === 'legendary' ? 3.4 : item.rarity === 'rare' ? 2.4 : 1.6;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.24, beamH, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.y = beamH / 2;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.55, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;

    group.add(gem, beam, ring);
    group.position.set(
      THREE.MathUtils.clamp(pos.x + (Math.random() - 0.5) * 2.4, -28, 28),
      0,
      THREE.MathUtils.clamp(pos.z + (Math.random() - 0.5) * 2.4, -28, 28),
    );
    this.scene.add(group);
    this.drops.push({ group, item, phase: Math.random() * 6 });
  }

  update(dt: number, playerPos: THREE.Vector3, onPickup: (item: ItemInstance, at: THREE.Vector3) => void): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.phase += dt * 2.2;
      d.group.rotation.y += dt * 1.6;
      d.group.children[0].position.y = 0.75 + Math.sin(d.phase) * 0.15;
      const dx = playerPos.x - d.group.position.x;
      const dz = playerPos.z - d.group.position.z;
      if (dx * dx + dz * dz < 2.1 * 2.1) {
        onPickup(d.item, d.group.position);
        this.scene.remove(d.group);
        disposeGroup(d.group);
        this.drops.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const d of this.drops) {
      this.scene.remove(d.group);
      disposeGroup(d.group);
    }
    this.drops = [];
  }

  get count(): number {
    return this.drops.length;
  }
}
