import * as THREE from 'three';

export interface CircleCollider {
  pos: THREE.Vector3;
  radius: number;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Player {
  readonly group = new THREE.Group();
  readonly radius = 0.5;
  speed = 6;
  bounds = 29;
  isMoving = false;

  private body: THREE.Mesh;
  private nose: THREE.Mesh;
  private target: THREE.Vector3 | null = null;
  private walkTime = 0;
  private stopDistance = 0.2;

  constructor() {
    const bodyGeo = new THREE.CapsuleGeometry(0.5, 1.0, 4, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4da3ff, roughness: 0.6 });
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.body.position.y = 1.1;
    this.body.castShadow = true;
    this.group.add(this.body);

    // Facing indicator (nose cone points +Z when rotation.y = 0)
    const noseGeo = new THREE.ConeGeometry(0.18, 0.5, 10);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xffe066, roughness: 0.4 });
    this.nose = new THREE.Mesh(noseGeo, noseMat);
    this.nose.rotation.x = Math.PI / 2;
    this.nose.position.set(0, 1.1, 0.75);
    this.group.add(this.nose);

    // Selection ring under feet
    const ringGeo = new THREE.RingGeometry(0.55, 0.7, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7cc4ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    this.group.add(ring);

    this.group.position.set(0, 0, 0);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  setTarget(p: THREE.Vector3): void {
    if (!this.target) this.target = new THREE.Vector3();
    this.target.set(p.x, 0, p.z);
  }

  stop(): void {
    this.target = null;
    this.isMoving = false;
  }

  hasTarget(): boolean {
    return this.target !== null;
  }

  update(dt: number, colliders: CircleCollider[], keyboardDir: THREE.Vector3): void {
    const move = new THREE.Vector3();

    if (keyboardDir.lengthSq() > 0.0001) {
      // Keyboard overrides click-target (Diablo + WASD hybrid)
      this.target = null;
      move.copy(keyboardDir).normalize();
    } else if (this.target) {
      move.copy(this.target).sub(this.group.position);
      move.y = 0;
      const dist = move.length();
      if (dist < this.stopDistance) {
        this.target = null;
        this.isMoving = false;
        return;
      }
      move.normalize();
    } else {
      this.isMoving = false;
      return;
    }

    this.isMoving = true;

    // Integrate
    this.group.position.addScaledVector(move, this.speed * dt);

    // Circle vs circle push-out
    for (const c of colliders) {
      const dx = this.group.position.x - c.pos.x;
      const dz = this.group.position.z - c.pos.z;
      const minDist = this.radius + c.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < minDist * minDist && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = minDist - d;
        this.group.position.x += (dx / d) * push;
        this.group.position.z += (dz / d) * push;
      }
    }

    // World bounds
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -this.bounds, this.bounds);
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -this.bounds, this.bounds);
    this.group.position.y = 0;

    // Face movement smoothly
    const targetYaw = Math.atan2(move.x, move.z);
    this.group.rotation.y = lerpAngle(this.group.rotation.y, targetYaw, 1 - Math.exp(-12 * dt));

    // Walk bob
    this.walkTime += dt * 10;
    this.body.position.y = 1.1 + Math.abs(Math.sin(this.walkTime)) * 0.08;
    this.nose.position.y = this.body.position.y;
  }
}
