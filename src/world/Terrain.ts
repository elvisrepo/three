import * as THREE from 'three';
import type { CircleCollider } from '../entities/Player';

export interface TerrainResult {
  ground: THREE.Mesh;
  colliders: CircleCollider[];
  /** Static obstacles only (trees/rocks) — monsters collide with these, not dummies. */
  statics: CircleCollider[];
  dummies: THREE.Object3D[];
  bounds: number;
}

const BOUNDS = 29;

function makeTree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, 1.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 }),
  );
  trunk.position.y = 0.8;
  trunk.castShadow = true;
  const leaves = new THREE.Mesh(
    new THREE.ConeGeometry(1.4, 2.8, 8),
    new THREE.MeshStandardMaterial({ color: 0x2e6b34, roughness: 0.8 }),
  );
  leaves.position.y = 2.8;
  leaves.castShadow = true;
  g.add(trunk, leaves);
  return g;
}

function makeRock(scale: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.DodecahedronGeometry(scale, 0),
    new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.95, flatShading: true }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeDummy(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.6, 12), bodyMat);
  body.position.y = 0.9;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xe0a37a, roughness: 0.7 }),
  );
  head.position.y = 2.0;
  head.castShadow = true;
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.8, 0.15, 20),
    new THREE.MeshStandardMaterial({ color: 0x555c66, roughness: 0.9 }),
  );
  base.position.y = 0.075;
  base.receiveShadow = true;
  g.add(body, head, base);
  g.userData.isTarget = true;
  return g;
}

/** Meadow prototype zone: flat ground + obstacles + training dummies. */
export function createTerrain(scene: THREE.Scene): TerrainResult {
  const colliders: CircleCollider[] = [];
  const statics: CircleCollider[] = [];
  const dummies: THREE.Object3D[] = [];

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x35793e, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  const grid = new THREE.GridHelper(60, 30, 0xffffff, 0xffffff);
  grid.position.y = 0.02;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.08;
  scene.add(grid);

  // Spawn pad at origin (future: city portal location)
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(2, 40),
    new THREE.MeshStandardMaterial({ color: 0x3f6fb5, roughness: 0.8 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.015;
  scene.add(pad);

  // Deterministic obstacle placement (avoids spawn radius 5)
  const spots: Array<[number, number, 'tree' | 'rock']> = [
    [8, -6, 'tree'], [-9, -3, 'tree'], [12, 6, 'tree'],
    [-12, 9, 'tree'], [3, -12, 'rock'], [-5, 13, 'rock'],
    [14, -1, 'rock'], [-14, -10, 'tree'], [0, 16, 'tree'],
    [10, 13, 'rock'],
  ];
  for (const [x, z, kind] of spots) {
    if (kind === 'tree') {
      const t = makeTree();
      t.position.set(x, 0, z);
      scene.add(t);
      const c = { pos: new THREE.Vector3(x, 0, z), radius: 0.7 };
      colliders.push(c);
      statics.push(c);
    } else {
      const r = makeRock(0.9);
      r.position.set(x, 0.6, z);
      r.rotation.set(Math.random(), Math.random() * 3, 0);
      scene.add(r);
      const c = { pos: new THREE.Vector3(x, 0, z), radius: 1.0 };
      colliders.push(c);
      statics.push(c);
    }
  }

  // Training dummies (attack-move targets for Phase 1)
  const dummyPositions: Array<[number, number]> = [[6, -4], [-7, 5], [4, 8]];
  for (const [x, z] of dummyPositions) {
    const d = makeDummy();
    d.position.set(x, 0, z);
    scene.add(d);
    dummies.push(d);
    colliders.push({ pos: new THREE.Vector3(x, 0, z), radius: 0.7 });
  }

  // Edge walls (visual only — Player clamps to bounds)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x24402a, roughness: 1 });
  const wallGeo = new THREE.BoxGeometry(62, 1.5, 1);
  const walls: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(wallGeo, wallMat);
    const edge = 30.5;
    if (i === 0) w.position.set(0, 0.75, -edge);
    if (i === 1) w.position.set(0, 0.75, edge);
    if (i === 2) {
      w.position.set(-edge, 0.75, 0);
      w.rotation.y = Math.PI / 2;
    }
    if (i === 3) {
      w.position.set(edge, 0.75, 0);
      w.rotation.y = Math.PI / 2;
    }
    walls.push(w);
    scene.add(w);
  }

  return { ground, colliders, statics, dummies, bounds: BOUNDS };
}
