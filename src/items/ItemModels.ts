/** Procedural 3D item models (primitives, matching the goblin-style art direction). */

import * as THREE from 'three';

/** Woodsman axe: haft + steel head with bright edge + leather wrap + pommel. ~1.2 units tall. */
export function buildAxe(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.7 });
  const edge = new THREE.MeshStandardMaterial({
    color: 0xe8eef4, roughness: 0.2, metalness: 0.85,
    emissive: 0x39424d, emissiveIntensity: 0.5,
  });
  const leather = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });

  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 1.15, 8), wood);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), steel);
  pommel.position.y = -0.62;
  const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.032, 8, 14), leather);
  wrap.rotation.x = Math.PI / 2;
  wrap.position.y = 0.36;
  // Head block + wedge blade fanning out +x.
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.12), steel);
  head.position.set(0.1, 0.47, 0);
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.32, 4), edge);
  blade.rotation.z = -Math.PI / 2;
  blade.scale.z = 0.45;
  blade.position.set(0.38, 0.47, 0);

  for (const m of [haft, pommel, wrap, head, blade]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** Recurve bow: bent limbs + taut string + leather grip, ~1.4 units tall. Held vertical. */
export function buildBow(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 });
  const darkwood = new THREE.MeshStandardMaterial({ color: 0x3d2716, roughness: 0.85 });
  const string = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.6 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });

  // Limbs: shallow arc (torus segment) in the XY plane, belly facing +x.
  const limbs = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 8, 20, Math.PI * 0.75), wood);
  limbs.rotation.z = Math.PI / 2 - (Math.PI * 0.75) / 2;
  // Nocked tips.
  const tipTop = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), darkwood);
  tipTop.position.set(-0.12, 0.68, 0);
  const tipBottom = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), darkwood);
  tipBottom.position.set(-0.12, -0.68, 0);
  // Bowstring: two straight runs tip-to-tip (slight V via the grip).
  const stringTop = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 6), string);
  stringTop.position.set(-0.1, 0.34, 0);
  stringTop.rotation.z = 0.06;
  const stringBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 6), string);
  stringBottom.position.set(-0.1, -0.34, 0);
  stringBottom.rotation.z = -0.06;
  // Leather grip at the belly.
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 8), leather);
  grip.position.set(0.02, 0, 0);

  for (const m of [limbs, tipTop, tipBottom, stringTop, stringBottom, grip]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}
