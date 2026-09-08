import * as THREE from 'three';
import type { CircleCollider } from './Player';
import type { DamageNumbers } from './DamageNumbers';
import { rollMonsterDamage } from '../combat/Stats';
import { buildGoblin, poseGoblin, type GoblinRig } from './Goblin';

export type MonsterState = 'idle' | 'chase' | 'return' | 'dead';

/** Visual species (data-driven per zone) — absent = legacy capsule. */
export type MonsterSpecies = 'goblin';

const _steer = new THREE.Vector3();

function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/**
 * Phase-1 trash monster: green slime/goblin.
 * FSM: idle (wander) -> chase (aggro) -> attack (cooldown) -> return (leash) -> dead -> respawn.
 * update() returns damage dealt to the player this frame (0 if none).
 */
export class Monster {
  readonly group = new THREE.Group();
  readonly radius = 0.55;

  level = 1;
  maxHp = 40;
  hp = 40;
  damage = 7;
  speed = 3.4;
  xpValue = 12;
  aggroRadius = 11;
  attackRange = 2.3;
  leashRadius = 26;
  attackCooldown = 1.15;

  alive = true;
  state: MonsterState = 'idle';
  /** Boss flag + display name (set via constructor opts for area bosses). */
  isBoss = false;
  displayName = '';

  home = new THREE.Vector3();
  attackTimer = 0;
  attackAnim = 0;
  wanderTarget = new THREE.Vector3();
  wanderTimer = 0;
  deadTime = 0;
  respawnTimer = 0;
  respawnDelay = 9;
  flash = 0;
  /** Frost slow timer — halves move speed while > 0. */
  slowTimer = 0;

  private body: THREE.Mesh;
  private bodyMat: THREE.MeshStandardMaterial;
  private hpBg: THREE.Sprite;
  private hpFg: THREE.Sprite;
  private hpFgBaseX = 1.5;
  /** Procedural rig (goblin species) — null = legacy capsule path. */
  private goblin: GoblinRig | null = null;
  /** Materials the hit-flash writes to (goblin mats or [bodyMat]). */
  private activeMats: THREE.MeshStandardMaterial[] = [];
  private animT = 0;
  private walkPhase = 0;
  private moving = false;

  constructor(
    spawn: THREE.Vector3,
    level = 1,
    opts?: {
      hpMult?: number;
      dmgMult?: number;
      xpMult?: number;
      scale?: number;
      tint?: number;
      name?: string;
      isBoss?: boolean;
      aggro?: number;
      respawnDelay?: number;
      species?: MonsterSpecies;
    },
  ) {
    this.level = level;
    this.isBoss = opts?.isBoss ?? false;
    this.displayName = opts?.name ?? '';
    const sizeScale = (1 + (level - 1) * 0.06) * (opts?.scale ?? 1);
    this.maxHp = this.hp = Math.round((34 + level * 9) * sizeScale * (opts?.hpMult ?? 1));
    this.damage = Math.round((5 + level * 1.6) * (opts?.dmgMult ?? 1));
    this.xpValue = Math.round((9 + level * 3) * (opts?.xpMult ?? 1));
    this.speed = randRange(3.0, 3.8) * (this.isBoss ? 0.85 : 1);
    this.aggroRadius = opts?.aggro ?? 11;
    if (opts?.respawnDelay !== undefined) this.respawnDelay = opts.respawnDelay;
    if (this.isBoss) this.group.scale.setScalar(opts?.scale ?? 1.6);

    this.bodyMat = new THREE.MeshStandardMaterial({ color: opts?.tint ?? 0x9b5de5, roughness: 0.65 });

    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x9b5de5, roughness: 0.65 });
    if (opts?.species === 'goblin' && !this.isBoss) {
      this.goblin = buildGoblin();
      // Slight visual growth with level (gameplay radius unchanged).
      this.goblin.root.scale.setScalar(sizeScale);
      this.group.add(this.goblin.root);
      this.body = this.goblin.torso;
      this.bodyMat = this.goblin.skinMat;
      this.activeMats = this.goblin.mats;
    } else {
      this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.9, 4, 10), this.bodyMat);
      this.body.position.y = 1.05;
      this.body.castShadow = true;
      this.group.add(this.body);

      // Angry eyes (face +Z)
      const eyeGeo = new THREE.SphereGeometry(0.11, 8, 8);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a0b2e });
      const eL = new THREE.Mesh(eyeGeo, eyeMat);
      eL.position.set(-0.2, 1.35, 0.48);
      const eR = new THREE.Mesh(eyeGeo, eyeMat);
      eR.position.set(0.2, 1.35, 0.48);
      this.group.add(eL, eR);
      this.activeMats = [this.bodyMat];
    }

    // Aggro ring under feet (visible when chasing)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.75, 28),
      new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.name = 'aggroRing';
    this.group.add(ring);

    // HP bar sprites (auto-face camera)
    const bgMat = new THREE.SpriteMaterial({ color: 0x141414, depthTest: false, transparent: true, opacity: 0.85 });
    this.hpBg = new THREE.Sprite(bgMat);
    this.hpBg.scale.set(1.7, 0.22, 1);
    this.hpBg.position.y = 2.5;
    this.hpBg.renderOrder = 20;
    const fgMat = new THREE.SpriteMaterial({ color: 0x5dff6b, depthTest: false, transparent: true, opacity: 0.95 });
    this.hpFg = new THREE.Sprite(fgMat);
    this.hpFg.scale.set(1.5, 0.13, 1);
    this.hpFg.position.y = 2.5;
    this.hpFg.renderOrder = 21;
    this.hpBg.visible = this.hpFg.visible = false;
    this.group.add(this.hpBg, this.hpFg);
    if (this.goblin) {
      // Shorter rig — keep the bar just overhead.
      this.hpBg.position.y = 2.0;
      this.hpFg.position.y = 2.0;
    }

    this.home.copy(spawn).setY(0);
    this.group.position.copy(this.home);
    this.wanderTarget.copy(this.home);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get hitMeshes(): THREE.Object3D[] {
    return this.goblin ? this.goblin.pick : [this.body];
  }

  takeDamage(amount: number, isCrit: boolean, numbers: DamageNumbers): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 1;
    for (const m of this.activeMats) {
      m.emissive.setHex(0xff2222);
      m.emissiveIntensity = 0.9;
    }
    numbers.spawn(this.group.position, `${amount}`, {
      color: isCrit ? '#ffd21f' : '#ffffff',
      crit: isCrit,
    });
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(numbers);
      return true;
    }
    this.updateHpBar();
    return false;
  }

  /** Chill: halves move speed for `seconds`. Re-applying refreshes the duration. */
  applySlow(seconds: number, numbers?: DamageNumbers): void {
    if (!this.alive) return;
    const fresh = this.slowTimer <= 0;
    this.slowTimer = Math.max(this.slowTimer, seconds);
    if (fresh && numbers) numbers.spawn(this.group.position, '❄ slowed', { color: '#9adcff', scale: 1.1 });
  }

  private die(numbers: DamageNumbers): void {
    this.alive = false;
    this.state = 'dead';
    this.deadTime = 1.1;
    this.respawnTimer = this.respawnDelay;
    this.hpBg.visible = this.hpFg.visible = false;
    numbers.spawn(this.group.position, `+${this.xpValue} XP`, { color: '#7dffd4', scale: 1.4 });
  }

  private respawn(): void {
    this.hp = this.maxHp;
    this.alive = true;
    this.state = 'idle';
    this.group.visible = true;
    this.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
    this.group.position.set(this.home.x + randRange(-3, 3), 0, this.home.z + randRange(-3, 3));
    this.wanderTarget.copy(this.home);
    this.attackTimer = 0;
    this.updateHpBar();
  }

  private updateHpBar(): void {
    const frac = THREE.MathUtils.clamp(this.hp / this.maxHp, 0, 1);
    const show = this.alive && frac < 1;
    this.hpBg.visible = this.hpFg.visible = show;
    this.hpFg.scale.x = Math.max(0.001, this.hpFgBaseX * frac);
    const mat = this.hpFg.material as THREE.SpriteMaterial;
    mat.color.setHex(frac > 0.5 ? 0x5dff6b : frac > 0.25 ? 0xffc44d : 0xff5d5d);
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerAlive: boolean,
    statics: CircleCollider[],
    others: Monster[],
  ): number {
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    this.animT += dt;
    this.moving = false;
    // Flash decay (cheap hit feedback)
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      for (const m of this.activeMats) m.emissiveIntensity = this.flash * 0.9;
      if (this.flash === 0) {
        for (const m of this.activeMats) m.emissive.setHex(0x000000);
      }
    }
    if (this.attackAnim > 0) {
      this.attackAnim = Math.max(0, this.attackAnim - dt * 4);
      if (!this.goblin) {
        const s = 1 + this.attackAnim * 0.18;
        this.body.scale.set(s, 2 - s > 0 ? 2 - s : 1, s);
        if (this.attackAnim === 0) this.body.scale.set(1, 1, 1);
      }
    }

    if (!this.alive) {
      // Death anim: tip over + sink, then hide until respawn
      this.deadTime -= dt;
      this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, -Math.PI / 2.2, 1 - Math.exp(-8 * dt));
      if (this.deadTime <= 0) {
        this.group.visible = false;
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) this.respawn();
      }
      return 0;
    }

    this.attackTimer -= dt;
    const toPlayer = _steer.copy(playerPos).sub(this.group.position).setY(0);
    const distPlayer = toPlayer.length();
    const distHome = this.group.position.distanceTo(this.home);

    // Leash: dragged too far -> walk home + regen
    if (distHome > this.leashRadius) {
      this.state = 'return';
    } else if (this.state === 'return') {
      if (distHome < 1.5) {
        this.state = 'idle';
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
        this.updateHpBar();
      }
    } else if (playerAlive && distPlayer < this.aggroRadius) {
      this.state = 'chase';
    } else if (this.state === 'chase' && (!playerAlive || distPlayer > this.aggroRadius * 1.6)) {
      this.state = distHome > 2 ? 'return' : 'idle';
    }

    const ring = this.group.getObjectByName('aggroRing') as THREE.Mesh | undefined;
    if (ring) {
      const m = ring.material as THREE.MeshBasicMaterial;
      m.opacity += ((this.state === 'chase' ? 0.85 : 0) - m.opacity) * Math.min(1, dt * 6);
    }

    let damageToPlayer = 0;

    if (this.state === 'return') {
      this.moveToward(this.home, dt, statics, others, 1);
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.08 * dt);
      if (Math.random() < dt * 0.5) this.updateHpBar();
    } else if (this.state === 'chase') {
      if (distPlayer > this.attackRange) {
        this.moveToward(playerPos, dt, statics, others, 1);
      } else {
        this.face(playerPos, dt);
        if (this.attackTimer <= 0 && playerAlive) {
          this.attackTimer = this.attackCooldown;
          this.attackAnim = 1;
          damageToPlayer = rollMonsterDamage(this.damage);
        }
      }
    } else {
      // idle wander around home
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = randRange(2.5, 5);
        this.wanderTarget.set(this.home.x + randRange(-4, 4), 0, this.home.z + randRange(-4, 4));
      }
      if (this.group.position.distanceTo(this.wanderTarget) > 0.6) {
        this.moveToward(this.wanderTarget, dt, statics, others, 0.35);
      }
    }

    if (this.goblin) {
      poseGoblin(this.goblin, this.animT, this.moving, this.walkPhase, this.attackAnim);
    }

    return damageToPlayer;
  }

  private face(target: THREE.Vector3, dt: number): void {
    const yaw = Math.atan2(target.x - this.group.position.x, target.z - this.group.position.z);
    let d = (yaw - this.group.rotation.y) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this.group.rotation.y += d * (1 - Math.exp(-10 * dt));
  }

  private moveToward(target: THREE.Vector3, dt: number, statics: CircleCollider[], others: Monster[], mult: number): void {
    _steer.copy(target).sub(this.group.position).setY(0);
    const len = _steer.length();
    if (len < 0.05) return;
    _steer.normalize();
    const effSpeed = this.speed * mult * (this.slowTimer > 0 ? 0.5 : 1);
    this.group.position.addScaledVector(_steer, effSpeed * dt);
    this.moving = true;
    this.walkPhase += dt * (5 + effSpeed * 1.6);

    // Static obstacles push-out
    for (const c of statics) {
      const dx = this.group.position.x - c.pos.x;
      const dz = this.group.position.z - c.pos.z;
      const min = this.radius + c.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.group.position.x += (dx / d) * (min - d);
        this.group.position.z += (dz / d) * (min - d);
      }
    }
    // Separation from other live monsters (prevents stacking)
    for (const o of others) {
      if (o === this || !o.alive) continue;
      const dx = this.group.position.x - o.group.position.x;
      const dz = this.group.position.z - o.group.position.z;
      const min = this.radius + o.radius + 0.15;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.group.position.x += (dx / d) * (min - d) * 0.5;
        this.group.position.z += (dz / d) * (min - d) * 0.5;
      }
    }

    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -29, 29);
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -29, 29);
    this.face(target, dt);
    if (!this.goblin) {
      // Hop while walking (capsule path; goblin bobs in poseGoblin)
      this.body.position.y = 1.05 + Math.abs(Math.sin(performance.now() * 0.008)) * 0.1;
    }
  }
}
