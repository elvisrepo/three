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
