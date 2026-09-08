import * as THREE from 'three';

/**
 * Procedural Greenmeadow goblin: squat green bruiser with a club.
 * Primitives under hierarchical pivots (shoulders/hips/neck) so Monster can
 * pose it cheaply every frame — pose only writes rotations/positions, never
 * allocates. Faces +Z like the rest of the cast.
 */
export interface GoblinRig {
  root: THREE.Group;
  /** Torso mesh (also serves as Monster.body for shared code paths). */
  torso: THREE.Mesh;
  skinMat: THREE.MeshStandardMaterial;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  earL: THREE.Mesh;
  earR: THREE.Mesh;
  /** Standard materials (hit-flash targets). */
  mats: THREE.MeshStandardMaterial[];
  /** All meshes (click-pick list). */
  pick: THREE.Object3D[];
}

function std(color: number, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

export function buildGoblin(): GoblinRig {
  const skin = std(0x55b356);
  const skinDark = std(0x3d8a41);
  const cloth = std(0x7a5230);
  const wood = std(0x6b4423);
  const woodDark = std(0x4e3220);
  const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  const pupil = new THREE.MeshBasicMaterial({ color: 0x201408 });

  const root = new THREE.Group();

  // Squat belly torso
  const torso = part(new THREE.SphereGeometry(0.5, 14, 12), skin, 0, 0.72, 0);
  torso.scale.set(1, 0.85, 0.9);
  root.add(torso);

  // Loincloth + belt
  root.add(part(new THREE.CylinderGeometry(0.4, 0.48, 0.22, 12), cloth, 0, 0.42, 0));
  const belt = part(new THREE.TorusGeometry(0.42, 0.05, 8, 14), woodDark, 0, 0.52, 0);
  belt.rotation.x = Math.PI / 2;
  root.add(belt);

  // Head (pivot at neck for look-around / attack nod)
  const head = new THREE.Group();
  head.position.set(0, 1.3, 0);
  head.add(part(new THREE.SphereGeometry(0.34, 14, 12), skin, 0, 0, 0));
  // Big nose
  head.add(part(new THREE.SphereGeometry(0.11, 8, 8), skinDark, 0, -0.04, 0.32));
  // Ears jutting sideways-down (cone +Y rotated out)
  const earGeo = new THREE.ConeGeometry(0.09, 0.4, 8);
  const earL = part(earGeo, skinDark, -0.38, 0.08, 0);
  earL.rotation.z = 1.9;
  const earR = part(earGeo, skinDark, 0.38, 0.08, 0);
  earR.rotation.z = -1.9;
  head.add(earL, earR);
  // Angry eyes
  const eyeGeo = new THREE.SphereGeometry(0.085, 8, 8);
  const pupGeo = new THREE.SphereGeometry(0.04, 8, 8);
  head.add(part(eyeGeo, eyeWhite, -0.13, 0.09, 0.27));
  head.add(part(eyeGeo, eyeWhite, 0.13, 0.09, 0.27));
  head.add(part(pupGeo, pupil, -0.13, 0.09, 0.335));
  head.add(part(pupGeo, pupil, 0.13, 0.09, 0.335));
  // Angry brow slabs
  const browGeo = new THREE.BoxGeometry(0.17, 0.05, 0.05);
  const browL = part(browGeo, skinDark, -0.13, 0.21, 0.28);
  browL.rotation.z = -0.35;
  const browR = part(browGeo, skinDark, 0.13, 0.21, 0.28);
  browR.rotation.z = 0.35;
  head.add(browL, browR);
  root.add(head);

  // Arms (shoulder pivots so they swing / raise the club)
  const armGeo = new THREE.CapsuleGeometry(0.11, 0.32, 4, 8);
  const handGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const armL = new THREE.Group();
  armL.position.set(-0.52, 1.0, 0);
  armL.add(part(armGeo, skin, 0, -0.26, 0));
  armL.add(part(handGeo, skinDark, 0, -0.5, 0));
  root.add(armL);

  const armR = new THREE.Group();
  armR.position.set(0.52, 1.0, 0);
  armR.add(part(armGeo, skin, 0, -0.26, 0));
  armR.add(part(handGeo, skinDark, 0, -0.5, 0));
  // Club parented to the fist so it follows the smash
  const club = new THREE.Group();
  club.position.set(0, -0.5, 0.08);
  club.rotation.x = -0.5;
  club.add(part(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8), wood, 0, 0.18, 0));
  const knob = part(new THREE.SphereGeometry(0.15, 8, 8), woodDark, 0, 0.5, 0);
  knob.scale.set(1, 1.25, 1);
  club.add(knob);
  armR.add(club);
  root.add(armR);

  // Short legs (hip pivots for the waddle)
  const legGeo = new THREE.CylinderGeometry(0.13, 0.11, 0.34, 8);
  const footGeo = new THREE.BoxGeometry(0.17, 0.1, 0.3);
  const legL = new THREE.Group();
  legL.position.set(-0.19, 0.44, 0);
  legL.add(part(legGeo, skin, 0, -0.17, 0));
  legL.add(part(footGeo, skinDark, 0, -0.36, 0.06));
  root.add(legL);
  const legR = new THREE.Group();
  legR.position.set(0.19, 0.44, 0);
  legR.add(part(legGeo, skin, 0, -0.17, 0));
  legR.add(part(footGeo, skinDark, 0, -0.36, 0.06));
  root.add(legR);

  const pick: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      (o as THREE.Mesh).castShadow = true;
      pick.push(o);
    }
  });

  return {
    root,
    torso,
    skinMat: skin,
    head,
    armL,
    armR,
    legL,
    legR,
    earL,
    earR,
    mats: [skin, skinDark, cloth, wood, woodDark],
    pick,
  };
}

/**
 * Pose the rig. `attack` is Monster.attackAnim (1 at trigger, decays to 0):
 * the club starts raised at trigger — damage is instant — and slams down.
 */
export function poseGoblin(rig: GoblinRig, t: number, moving: boolean, phase: number, attack: number): void {
  const { armL, armR, legL, legR, head, earL, earR, root } = rig;
  if (moving) {
    const s = Math.sin(phase);
    legL.rotation.x = s * 0.6;
    legR.rotation.x = -s * 0.6;
    armL.rotation.x = -s * 0.5;
    root.position.y = Math.abs(Math.cos(phase)) * 0.07;
    root.rotation.x = 0.07;
    head.rotation.set(-0.06, 0, 0);
  } else {
    legL.rotation.x = 0;
    legR.rotation.x = 0;
    armL.rotation.x = Math.sin(t * 1.7) * 0.07;
    root.position.y = Math.sin(t * 2.2) * 0.02;
    root.rotation.x = 0;
    head.rotation.set(0, Math.sin(t * 0.5) * 0.15, 0);
  }
  if (attack > 0.02) {
    armR.rotation.x = -2.4 * attack;
    root.rotation.x = 0.07 + 0.2 * attack;
    head.rotation.x = 0.15 * attack;
  } else if (moving) {
    armR.rotation.x = Math.sin(phase) * 0.5;
  } else {
    armR.rotation.x = Math.sin(t * 1.7 + 1) * 0.07;
  }
  earL.rotation.z = 1.9 + Math.sin(t * 0.8) * 0.05;
  earR.rotation.z = -1.9 - Math.sin(t * 0.8 + 0.6) * 0.05;
}
