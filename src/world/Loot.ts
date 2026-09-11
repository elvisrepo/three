import * as THREE from 'three';
import { RARITY_COLOR, type ItemInstance } from '../items/Items';
import { isRiftKey } from '../data/Rifts';
import { buildAxe } from '../items/ItemModels';

interface Drop {
  group: THREE.Group;
  item: ItemInstance;
  phase: number;
  /** Seconds since spawn — fresh drops can't be grabbed (see PICKUP_DELAY). */
  age: number;
}

/** Grace period before a fresh drop becomes grabbable (no instant re-pickup). */
export const PICKUP_DELAY = 1.0;

/** Rift Key ground mesh: golden bow + shaft + teeth (spins/bobs like crystals). */
function buildKey(): THREE.Group {
  const gold = new THREE.MeshStandardMaterial({
    color: 0xffd21f,
    emissive: 0xa06a00,
    emissiveIntensity: 0.55,
    metalness: 0.85,
    roughness: 0.3,
  });
  const key = new THREE.Group();
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 10, 20), gold);
  bow.position.y = 0.32;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.62, 8), gold);
  shaft.position.y = -0.12;
  const tooth1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.07), gold);
  tooth1.position.set(0.11, -0.3, 0);
  const tooth2 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.07), gold);
  tooth2.position.set(0.085, -0.14, 0);
  key.add(bow, shaft, tooth1, tooth2);
  key.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return key;
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

/** Ground loot: rarity-colored crystal + light beam. Click a crystal to walk over and grab it. */
export class LootManager {
  drops: Drop[] = [];

  constructor(private scene: THREE.Scene) {}

  spawnItem(pos: THREE.Vector3, item: ItemInstance): void {
    const color = new THREE.Color(RARITY_COLOR[item.rarity]);
    const group = new THREE.Group();

    let gem: THREE.Object3D;
    if (item.baseId === 'woodsman_axe') {
      const axe = buildAxe();
      axe.position.y = 0.75;
      axe.rotation.z = 0.12;
      gem = axe;
    } else if (isRiftKey(item.baseId)) {
      gem = buildKey();
      gem.position.y = 0.75;
    } else {
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(item.rarity === 'legendary' ? 0.5 : 0.35),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.3 }),
      );
      crystal.position.y = 0.75;
      crystal.castShadow = true;
      gem = crystal;
    }

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
    this.drops.push({ group, item, phase: Math.random() * 6, age: 0 });
  }

  /** Animate only — grabbing is explicit via findDrop/removeDrop (click-to-pickup). */
  update(dt: number): void {
    for (const d of this.drops) {
      d.age += dt;
      d.phase += dt * 2.2;
      d.group.rotation.y += dt * 1.6;
      d.group.children[0].position.y = 0.75 + Math.sin(d.phase) * 0.15;
    }
  }

  findDrop(uid: string): { group: THREE.Group; item: ItemInstance; age: number } | null {
    return this.drops.find((d) => d.item.uid === uid) ?? null;
  }

  removeDrop(uid: string): void {
    const i = this.drops.findIndex((d) => d.item.uid === uid);
    if (i === -1) return;
    const [d] = this.drops.splice(i, 1);
    this.scene.remove(d.group);
    disposeGroup(d.group);
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
