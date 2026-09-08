import * as THREE from 'three';
import { xpNeed, playerLevelUpBonus } from '../combat/Stats';
import { CLASSES, type StarterClass, type Attrs } from '../data/Classes';

/** Attribute-derived combat bonus (delta-applied like gear — never double-counts). */
export interface AttrBonus {
  damage: number;
  maxHp: number;
  crit: number;
  fire: number;
}

export interface CircleCollider {
  pos: THREE.Vector3;
  radius: number;
}

/** Anything the player can auto-attack (Monster satisfies this structurally). */
export interface Attackable {
  position: THREE.Vector3;
  alive: boolean;
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

  // --- identity / progression ---
  charName = 'Hero';
  baseClass: StarterClass = 'warrior';
  /** Advanced job id (null until Lv10 advancement). */
  job: string | null = null;
  /** Temporary damage buff (Rampage): multiplier + remaining seconds. */
  buffDmgMult = 1;
  buffTimer = 0;
  fireMult = 1;
  level = 1;
  xp = 0;
  xpNext = xpNeed(1);
  maxHp = 100;
  hp = 100;
  attackDamage = 13;
  attackRange = 2.8;
  attackCooldown = 0.45;
  attackTimer = 0;
  critChance = 0.1;
  /** Gear-derived mitigation + sustain (recomputed by Game.refreshGear). */
  armor = 0;
  lifesteal = 0;
  // --- core attributes (STR/DEX/INT/VIT) ---
  str = 5;
  dex = 5;
  int = 5;
  vit = 5;
  statPoints = 0;
  private prevAttr: AttrBonus = { damage: 0, maxHp: 0, crit: 0, fire: 0 };
  potions = 3;
  potionCooldown = 0;
  alive = true;
  attackTarget: Attackable | null = null;
  swingAnim = 0;

  private body: THREE.Mesh;
  private bodyMat: THREE.MeshStandardMaterial;
  private nose: THREE.Mesh;
  private target: THREE.Vector3 | null = null;
  private walkTime = 0;
  private stopDistance = 0.2;
  private flash = 0;

  constructor() {
    const bodyGeo = new THREE.CapsuleGeometry(0.5, 1.0, 4, 12);
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x4da3ff, roughness: 0.6 });
    this.body = new THREE.Mesh(bodyGeo, this.bodyMat);
    this.body.position.y = 1.1;
    this.body.castShadow = true;
    this.group.add(this.body);

    const noseGeo = new THREE.ConeGeometry(0.18, 0.5, 10);
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xffe066, roughness: 0.4 });
    this.nose = new THREE.Mesh(noseGeo, noseMat);
    this.nose.rotation.x = Math.PI / 2;
    this.nose.position.set(0, 1.1, 0.75);
    this.group.add(this.nose);

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

  clearAttackTarget(): void {
    this.attackTarget = null;
  }

  /** Apply starter-class base stats (fresh character). */
  applyClass(cls: StarterClass): void {
    const def = CLASSES[cls];
    this.baseClass = cls;
    this.job = null;
    this.maxHp = def.maxHp;
    this.hp = def.maxHp;
    this.attackDamage = def.damage;
    this.speed = def.speed;
    this.critChance = def.crit;
    this.fireMult = def.fireMult;
    this.str = def.attrs.str;
    this.dex = def.attrs.dex;
    this.int = def.attrs.int;
    this.vit = def.attrs.vit;
    this.prevAttr = { damage: 0, maxHp: 0, crit: 0, fire: 0 };
    this.bodyMat.color.setHex(def.color);
  }

  attrs(): Attrs {
    return { str: this.str, dex: this.dex, int: this.int, vit: this.vit };
  }

  setAttrs(a: Attrs): void {
    this.str = a.str;
    this.dex = a.dex;
    this.int = a.int;
    this.vit = a.vit;
    this.prevAttr = { damage: 0, maxHp: 0, crit: 0, fire: 0 };
  }

  /**
   * Recompute attribute bonuses (STR +1 DMG/2 · DEX +0.5% crit/pt ·
   * INT +3% fireball/pt · VIT +6 HP/pt). Delta-applied — safe to call anytime.
   */
  refreshAttributes(): void {
    const b: AttrBonus = {
      damage: Math.floor(this.str / 2),
      maxHp: this.vit * 6,
      crit: this.dex * 0.5,
      fire: this.int * 0.03,
    };
    const p = this.prevAttr;
    this.attackDamage += b.damage - p.damage;
    const dHp = b.maxHp - p.maxHp;
    this.maxHp += dHp;
    if (dHp > 0) this.hp = Math.min(this.maxHp, this.hp + dHp);
    else this.hp = Math.min(this.hp, this.maxHp);
    this.critChance += (b.crit - p.crit) / 100;
    this.fireMult += b.fire - p.fire;
    this.prevAttr = b;
  }

  /** Spend one stat point on an attribute. Returns false if none left. */
  allocate(attr: keyof Attrs): boolean {
    if (this.statPoints <= 0) return false;
    this.statPoints -= 1;
    if (attr === 'str') this.str += 1;
    else if (attr === 'dex') this.dex += 1;
    else if (attr === 'int') this.int += 1;
    else this.vit += 1;
    this.refreshAttributes();
    return true;
  }

  /** Replay level-up stat growth (used when loading a save — no heals). */
  replayLevels(target: number): void {
    for (let l = 2; l <= target; l++) {
      const b = playerLevelUpBonus(l);
      this.maxHp += b.maxHp;
      this.attackDamage += b.damage;
    }
    this.level = target;
    this.xpNext = xpNeed(target);
  }

  /** Recolor body (used when loading a saved class). */
  setBodyColor(hex: number): void {
    this.bodyMat.color.setHex(hex);
  }

  faceInstant(p: THREE.Vector3): void {
    this.group.rotation.y = Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z);
  }

  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flash = 1;
    this.bodyMat.emissive.setHex(0xff2222);
    this.bodyMat.emissiveIntensity = 0.7;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.attackTarget = null;
      this.target = null;
      this.isMoving = false;
      return true;
    }
    return false;
  }

  /** Returns true if this XP caused a level-up (can chain, but one level per kill is typical). */
  gainXp(amount: number): boolean {
    if (!this.alive) return false;
    this.xp += amount;
    if (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level += 1;
      this.xpNext = xpNeed(this.level);
      const bonus = playerLevelUpBonus(this.level);
      this.maxHp += bonus.maxHp;
      this.attackDamage += bonus.damage;
      this.statPoints += 3;
      this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * 0.4));
      return true;
    }
    return false;
  }

  drinkPotion(): boolean {
    if (!this.alive || this.potions <= 0 || this.potionCooldown > 0 || this.hp >= this.maxHp) return false;
    this.potions -= 1;
    this.potionCooldown = 5;
    this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * 0.45));
    return true;
  }

  respawn(at: THREE.Vector3): void {
    this.hp = this.maxHp;
    this.alive = true;
    this.group.position.copy(at).setY(0);
    this.group.rotation.set(0, 0, 0);
    this.target = null;
    this.attackTarget = null;
    this.attackTimer = 0;
    this.potionCooldown = 0;
    this.buffDmgMult = 1;
    this.buffTimer = 0;
    this.potions = Math.max(this.potions, 2);
    this.bodyMat.emissive.setHex(0x000000);
    this.bodyMat.emissiveIntensity = 0;
  }

  update(dt: number, colliders: CircleCollider[], keyboardDir: THREE.Vector3): void {
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.potionCooldown = Math.max(0, this.potionCooldown - dt);
    if (this.buffTimer > 0) {
      this.buffTimer -= dt;
      if (this.buffTimer <= 0) this.buffDmgMult = 1;
    }

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 4);
      this.bodyMat.emissiveIntensity = this.flash * 0.7;
      if (this.flash === 0) this.bodyMat.emissive.setHex(0x000000);
    }
    if (this.swingAnim > 0) {
      this.swingAnim = Math.max(0, this.swingAnim - dt * 6);
      const s = 1 + this.swingAnim * 0.12;
      this.body.scale.set(s, 2 - s > 0.6 ? 2 - s : 1, s);
      if (this.swingAnim === 0) this.body.scale.set(1, 1, 1);
    }

    if (!this.alive) {
      // Death pose: fall over
      this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, -Math.PI / 2.4, 1 - Math.exp(-6 * dt));
      this.isMoving = false;
      return;
    }
    if (this.group.rotation.x !== 0) this.group.rotation.x = 0;

    const move = new THREE.Vector3();

    if (keyboardDir.lengthSq() > 0.0001) {
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
    this.group.position.addScaledVector(move, this.speed * dt);

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

    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -this.bounds, this.bounds);
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -this.bounds, this.bounds);
    this.group.position.y = 0;

    const targetYaw = Math.atan2(move.x, move.z);
    this.group.rotation.y = lerpAngle(this.group.rotation.y, targetYaw, 1 - Math.exp(-12 * dt));

    this.walkTime += dt * 10;
    this.body.position.y = 1.1 + Math.abs(Math.sin(this.walkTime)) * 0.08;
    this.nose.position.y = this.body.position.y;
  }
}
