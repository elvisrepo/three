import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { CircleCollider } from './Player';
import { deflectMove } from './Player';
import type { DamageNumbers } from './DamageNumbers';
import { rollMonsterDamage } from '../combat/Stats';
import { buildGoblin, poseGoblin, type GoblinRig } from './Goblin';

export type MonsterState = 'idle' | 'chase' | 'return' | 'dead';

/** Visual species (data-driven per zone) — absent = legacy capsule. */
export type MonsterSpecies = 'goblin';

/** Boss one-shot channels triggerable from BossController. */
export type BossSpecial = 'slam' | 'roar';

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
  /** Delayed melee impact (damage lands when the fist does, not at windup). */
  private strikeTimer = -1;
  private strikeDamage = 0;
  /** Windup length: long enough to react to on bosses, snappy on trash. */
  private strikeDelay = 0.25;
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
  // --- Mixamo boss model (capsule fallback until loaded) ---
  private modelRoot: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private mIdle: THREE.AnimationAction | null = null;
  private mWalk: THREE.AnimationAction | null = null;
  private mPunch: THREE.AnimationAction | null = null;
  private mSlam: THREE.AnimationAction | null = null;
  private mRoar: THREE.AnimationAction | null = null;
  private mHit: THREE.AnimationAction | null = null;
  private mDeath: THREE.AnimationAction | null = null;
  private modelMats: THREE.MeshStandardMaterial[] = [];
  private pickMeshes: THREE.Object3D[] | null = null;
  private lastAttackAnim = 0;
  private lastHitAnimAt = -10;
  private deathPlayed = false;

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
      /** Mixamo model dir under public/ (bosses). Absent = capsule/goblin. */
      model?: string;
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

      if (!opts?.model) {
        // Angry eyes (face +Z) — capsule path only (model hides the capsule)
        const eyeGeo = new THREE.SphereGeometry(0.11, 8, 8);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a0b2e });
        const eL = new THREE.Mesh(eyeGeo, eyeMat);
        eL.position.set(-0.2, 1.35, 0.48);
        const eR = new THREE.Mesh(eyeGeo, eyeMat);
        eR.position.set(0.2, 1.35, 0.48);
        this.group.add(eL, eR);
      }
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

    if (opts?.model && !this.goblin) {
      // Skinned boss swings read slower — give the windup dodge time.
      this.strikeDelay = 0.45;
      void this.loadBossModel(opts.model);
    }
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get hitMeshes(): THREE.Object3D[] {
    if (this.pickMeshes) return this.pickMeshes;
    return this.goblin ? this.goblin.pick : [this.body];
  }

  /** Boss one-shot (slam telegraph windup / summon roar). No-op until loaded. */
  playSpecial(kind: BossSpecial): void {
    if (!this.mixer || !this.alive) return;
    this.fadeModelTo(kind === 'slam' ? this.mSlam : this.mRoar, 0.12);
  }

  /** Load base.fbx (T-pose mesh), then animation-only clips onto its rig. */
  private async loadBossModel(base: string): Promise<void> {
    const url = (f: string): string => `${import.meta.env.BASE_URL}${base}/${f}`;
    const loader = new FBXLoader();
    let meshObj: THREE.Group;
    try {
      meshObj = await loader.loadAsync(url('base.fbx'));
    } catch (err) {
      console.warn(`[Monster] boss model missing (${url('base.fbx')}), keeping capsule`, err);
      return;
    }
    // Mixamo exports in centimeters — scale to meters.
    meshObj.scale.setScalar(0.01);
    const pick: THREE.Object3D[] = [];
    meshObj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) {
        const m = o as THREE.Mesh;
        m.castShadow = true;
        pick.push(o);
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          if (mat instanceof THREE.MeshStandardMaterial && !this.modelMats.includes(mat)) {
            this.modelMats.push(mat);
          }
        }
      }
    });
    this.modelRoot = meshObj;
    this.group.add(meshObj);
    this.body.visible = false;
    this.pickMeshes = pick;
    this.activeMats = this.modelMats.length > 0 ? this.modelMats : this.activeMats;
    this.deathPlayed = false;

    this.mixer = new THREE.AnimationMixer(meshObj);
    const extra: Array<{
      file: string;
      set: (a: THREE.AnimationAction) => void;
      loop: THREE.AnimationActionLoopStyles;
      speed: number;
    }> = [
      // Idle file is a stand->fight transition: ping-pong it so it sways
      // instead of snapping each loop. (Swap for plain "Idle" later.)
      { file: 'idle.fbx', set: (a) => (this.mIdle = a), loop: THREE.LoopPingPong, speed: 1 },
      { file: 'walk.fbx', set: (a) => (this.mWalk = a), loop: THREE.LoopRepeat, speed: 1 },
      { file: 'punch.fbx', set: (a) => (this.mPunch = a), loop: THREE.LoopOnce, speed: 0.9 },
      { file: 'slam.fbx', set: (a) => (this.mSlam = a), loop: THREE.LoopOnce, speed: 1 },
      { file: 'roar.fbx', set: (a) => (this.mRoar = a), loop: THREE.LoopOnce, speed: 1 },
      { file: 'hit.fbx', set: (a) => (this.mHit = a), loop: THREE.LoopOnce, speed: 1.6 },
      { file: 'death.fbx', set: (a) => (this.mDeath = a), loop: THREE.LoopOnce, speed: 1 },
    ];
    await Promise.all(
      extra.map(async (e) => {
        try {
          const obj = await loader.loadAsync(url(e.file));
          const clip = obj.animations[0];
          if (!clip || !this.mixer) return;
          const action = this.mixer.clipAction(clip);
          if (e.loop === THREE.LoopOnce) {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          } else {
            action.setLoop(e.loop, Infinity);
          }
          action.timeScale = e.speed;
          e.set(action);
          if (e.file === 'idle.fbx') action.play();
        } catch (err) {
          console.warn(`[Monster] missing boss anim ${e.file}`, err);
        }
      }),
    );
  }

  private fadeModelTo(action: THREE.AnimationAction | null, dur = 0.15): void {
    if (!action || !this.mixer) return;
    for (const a of [this.mIdle, this.mWalk, this.mPunch, this.mSlam, this.mRoar, this.mHit, this.mDeath]) {
      if (a && a !== action && a.enabled) a.fadeOut(dur);
    }
    action.reset();
    action.setEffectiveWeight(1);
    action.fadeIn(dur);
    action.play();
  }

  private bossOneShotPlaying(): boolean {
    return !!(
      (this.mPunch && this.mPunch.isRunning()) ||
      (this.mSlam && this.mSlam.isRunning()) ||
      (this.mRoar && this.mRoar.isRunning()) ||
      (this.mHit && this.mHit.isRunning())
    );
  }

  private playBossLoop(name: 'idle' | 'walk'): void {
    const action = name === 'walk' ? this.mWalk : this.mIdle;
    if (!action || !this.mixer) return;
    if (this.bossOneShotPlaying()) return;
    if (action.isRunning()) return;
    this.fadeModelTo(action);
  }

  takeDamage(amount: number, isCrit: boolean, numbers: DamageNumbers): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 1;
    for (const m of this.activeMats) {
      m.emissive.setHex(0xff2222);
      m.emissiveIntensity = 0.9;
    }
    if (this.mixer && this.mHit && this.animT - this.lastHitAnimAt > 0.4) {
      this.lastHitAnimAt = this.animT;
      this.fadeModelTo(this.mHit, 0.08);
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
    // Skinned death clip runs longer than the capsule tip-over.
    this.deadTime = this.modelRoot ? 2.0 : 1.1;
    this.respawnTimer = this.respawnDelay;
    this.hpBg.visible = this.hpFg.visible = false;
    // Mid-swing strikes fizzle on death.
    this.strikeTimer = -1;
    this.strikeDamage = 0;
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
    this.strikeTimer = -1;
    this.strikeDamage = 0;
    this.deathPlayed = false;
    this.lastAttackAnim = 0;
    if (this.mixer && this.mIdle) {
      this.mDeath?.stop();
      this.fadeModelTo(this.mIdle, 0.2);
    }
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
    if (this.mixer) this.mixer.update(dt);
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
    // Rising edge on attackAnim (set to 1 per melee swing) -> punch once.
    if (this.attackAnim > 0.5 && this.lastAttackAnim <= 0.5 && this.alive && this.mixer && this.mPunch) {
      this.fadeModelTo(this.mPunch, 0.08);
    }
    this.lastAttackAnim = this.attackAnim;

    if (!this.alive) {
      // Death: skinned clip for the model, tip-over + sink for primitives.
      if (this.modelRoot && this.mDeath) {
        if (!this.deathPlayed) {
          this.deathPlayed = true;
          this.fadeModelTo(this.mDeath, 0.15);
        }
      } else {
        this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, -Math.PI / 2.2, 1 - Math.exp(-8 * dt));
      }
      this.deadTime -= dt;
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
      // Plant feet while a skinned one-shot plays (punch/slam/roar/hit):
      // gliding through an attack pose is what read as "floating".
      // Capsule/goblin mobs have no one-shots, so this is boss-only in practice.
      if (distPlayer > this.attackRange && !this.bossOneShotPlaying()) {
        this.moveToward(playerPos, dt, statics, others, 1);
      } else {
        this.face(playerPos, dt);
        if (distPlayer <= this.attackRange && this.attackTimer <= 0 && playerAlive) {
          this.attackTimer = this.attackCooldown;
          this.attackAnim = 1;
          // Commit the roll at windup, land it at impact — matches the fist.
          this.strikeDamage = rollMonsterDamage(this.damage);
          this.strikeTimer = this.strikeDelay;
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
    if (this.mixer) {
      this.playBossLoop(this.moving ? 'walk' : 'idle');
    }
    // Melee impact: damage lands with the fist. Blink/dodge out of reach
    // before impact and it whiffs (generous slack for capsule-era feel).
    if (this.strikeTimer > 0) {
      this.strikeTimer -= dt;
      if (this.strikeTimer <= 0) {
        this.strikeTimer = -1;
        if (distPlayer <= this.attackRange + 1.2) damageToPlayer += this.strikeDamage;
        this.strikeDamage = 0;
      }
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
    // Slide around trunks/walls instead of juddering head-on (shared helper).
    deflectMove(this.group.position, this.radius, _steer, statics);
    if (_steer.lengthSq() <= 1e-6) {
      // Dead head-on: deterministic sidestep, same as the player.
      _steer.copy(target).sub(this.group.position).setY(0);
      if (_steer.lengthSq() > 1e-6) {
        _steer.normalize();
        _steer.set(-_steer.z, 0, _steer.x);
      }
    }
    if (_steer.lengthSq() > 1e-6) {
      _steer.normalize();
      this.group.position.addScaledVector(_steer, effSpeed * dt);
    }
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
