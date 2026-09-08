import * as THREE from 'three';
import type { Monster } from './Monster';

/**
 * Boss extras via composition (Monster stays decoupled — it only exposes
 * playSpecial('slam' | 'roar') one-shot channels):
 * - telegraphed AoE slam (red ring warns 0.9s, then hits within radius)
 * - summons 2 minions once at 50% HP (Game polls consumeSummon())
 * - 30s respawn for farmable boss loop
 */
export class BossController {
  telegraph: THREE.Mesh;
  slamRadius = 4.8;
  summonPending = false;

  private slamCd = 4;
  private warnT = 0;
  private wasAlive = true;
  private summoned = false;

  constructor(private scene: THREE.Scene, readonly boss: Monster) {
    this.telegraph = new THREE.Mesh(
      new THREE.RingGeometry(this.slamRadius - 0.55, this.slamRadius, 44),
      new THREE.MeshBasicMaterial({
        color: 0xff2222,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.telegraph.rotation.x = -Math.PI / 2;
    this.telegraph.position.y = 0.06;
    this.telegraph.visible = false;
    scene.add(this.telegraph);
  }

  reset(): void {
    this.slamCd = 4;
    this.warnT = 0;
    this.summoned = false;
    this.summonPending = false;
    this.telegraph.visible = false;
  }

  /** Returns slam damage to the player this frame (0 if none). */
  update(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): number {
    if (!this.boss.alive) {
      this.wasAlive = false;
      this.telegraph.visible = false;
      this.warnT = 0;
      return 0;
    }
    if (!this.wasAlive && this.boss.alive) this.reset();
    this.wasAlive = true;

    if (!this.summoned && this.boss.hp < this.boss.maxHp * 0.5) {
      this.summoned = true;
      this.summonPending = true;
      this.boss.playSpecial('roar');
    }

    const dist = this.boss.position.distanceTo(playerPos);
    const mat = this.telegraph.material as THREE.MeshBasicMaterial;

    if (this.warnT > 0) {
      this.warnT -= dt;
      this.telegraph.position.set(this.boss.position.x, 0.06, this.boss.position.z);
      mat.opacity = 0.55 + Math.sin(performance.now() * 0.02) * 0.3;
      if (this.warnT <= 0) {
        this.telegraph.visible = false;
        this.slamCd = 6;
        if (playerAlive && dist < this.slamRadius) {
          return Math.max(1, Math.round(this.boss.damage * 1.7));
        }
      }
      return 0;
    }

    this.slamCd -= dt;
    if (this.slamCd <= 0 && playerAlive && dist < 10) {
      this.warnT = 0.9;
      this.telegraph.visible = true;
      this.telegraph.position.set(this.boss.position.x, 0.06, this.boss.position.z);
      this.boss.playSpecial('slam');
    }
    return 0;
  }

  consumeSummon(): boolean {
    if (this.summonPending) {
      this.summonPending = false;
      return true;
    }
    return false;
  }

  dispose(): void {
    this.scene.remove(this.telegraph);
    this.telegraph.geometry.dispose();
    (this.telegraph.material as THREE.Material).dispose();
  }
}
