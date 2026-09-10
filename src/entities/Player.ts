import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { xpNeed, playerLevelUpBonus } from '../combat/Stats';
import { CLASSES, type StarterClass, type Attrs } from '../data/Classes';
import { buildAxe } from '../items/ItemModels';

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

/**
 * Slide steering (shared player + monster): strip the velocity component
 * pointing into nearby colliders, keeping tangential motion so bodies slip
 * around trunks/NPCs/walls instead of juddering head-on forever.
 * Mutates `move` (caller-owned); zero vector = fully pocketed, stay put.
 */
export function deflectMove(pos: THREE.Vector3, radius: number, move: THREE.Vector3, colliders: CircleCollider[]): void {
  for (const c of colliders) {
    const dx = pos.x - c.pos.x;
    const dz = pos.z - c.pos.z;
    const bubble = radius + c.radius + 0.5;
    const d2 = dx * dx + dz * dz;
    if (d2 >= bubble * bubble || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const nz = dz / d;
    const into = -(move.x * nx + move.z * nz);
    if (into > 0) {
      move.x += nx * into;
      move.z += nz * into;
    }
  }
}

/** Dodge dash: brief i-frame dash toward cursor/facing (≈5.5 units). */
export const DODGE_TIME = 0.25;
export const DODGE_CD = 2.5;
const DODGE_SPEED = 22;

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
  maxMana = 30;
  mana = 30;
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
  /** Windup-cast gesture (mage cast.fbx) — rising edge plays animCast, like swingAnim. */
  castAnim = 0;
  /** While true, locomotion never touches facing (whirlwind owns rotation). */
  spinLock = false;
  /** While true, arms are held out horizontally (whirlwind T-pose). Set by Game. */
  spinPose = false;
  /** Visible weapon prop (axe first). Parented to the hand bone or body fallback. */
  private weaponAnchor = new THREE.Group();
  private weaponBaseId: string | null = null;
  /** Dodge dash state (i-frames while dodgeTimer > 0). */
  dodgeTimer = 0;
  dodgeCd = 0;
  private dodgeDir = new THREE.Vector3(0, 0, 1);

  private body: THREE.Mesh;
  private bodyMat: THREE.MeshStandardMaterial;
  private nose: THREE.Mesh;
  /** Capsule-fallback spin arms (hidden unless whirlwinding without a model). */
  private fallbackArmL: THREE.Mesh;
  private fallbackArmR: THREE.Mesh;
  private target: THREE.Vector3 | null = null;
  private walkTime = 0;
  /** Scratch for the pocket sidestep (no per-frame allocation). */
  private steerTmp = new THREE.Vector3();
  private stopDistance = 0.2;
  private flash = 0;

  // --- Mixamo skinned model (warrior first; capsule fallback until loaded) ---
  private modelRoot: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private animIdle: THREE.AnimationAction | null = null;
  private animRun: THREE.AnimationAction | null = null;
  private animAttack: THREE.AnimationAction | null = null;
  private animCast: THREE.AnimationAction | null = null;
  private animHit: THREE.AnimationAction | null = null;
  private animDeath: THREE.AnimationAction | null = null;
  private modelMats: THREE.MeshStandardMaterial[] = [];
  private modelKey: string | null = null;
  private modelLoading = false;
  /** T-pose arm bones (model path): {bone, side} — side +1 = left (+X). */
  private spinArmBones: { bone: THREE.Object3D; side: number }[] = [];
  private spinArmsFor: THREE.Group | null = null;
  private readonly spinQG = new THREE.Quaternion();
  private readonly spinQW = new THREE.Quaternion();
  private readonly spinQR = new THREE.Quaternion();
  private readonly spinQP = new THREE.Quaternion();
  private readonly spinDir = new THREE.Vector3();
  private readonly spinTgt = new THREE.Vector3();  private lastSwing = 0;
  private lastCast = 0;
  private lastHitAnimAt = -10;
  private elapsed = 0;
  private deathPlayed = false;

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

    // Hand prop anchor (body-space fallback until a hand bone is found).
    this.weaponAnchor.position.set(0.55, 1.1, 0.25);
    this.group.add(this.weaponAnchor);

    // Spin-pose arms for the capsule body: horizontal bars at shoulder height,
    // shown only while whirlwinding (the skinned model poses its real bones).
    const armGeo = new THREE.CapsuleGeometry(0.13, 0.55, 4, 8);
    this.fallbackArmL = new THREE.Mesh(armGeo, this.bodyMat);
    this.fallbackArmL.position.set(0.62, 1.35, 0);
    this.fallbackArmL.rotation.z = Math.PI / 2;
    this.fallbackArmL.castShadow = true;
    this.fallbackArmL.visible = false;
    this.fallbackArmR = new THREE.Mesh(armGeo, this.bodyMat);
    this.fallbackArmR.position.set(-0.62, 1.35, 0);
    this.fallbackArmR.rotation.z = Math.PI / 2;
    this.fallbackArmR.castShadow = true;
    this.fallbackArmR.visible = false;
    this.group.add(this.fallbackArmL, this.fallbackArmR);

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

  /** Begin a dodge dash along dir. Returns false if on cooldown/dead. */
  startDodge(dir: THREE.Vector3): boolean {
    if (!this.alive || this.dodgeCd > 0 || dir.lengthSq() < 1e-6) return false;
    this.dodgeDir.copy(dir).setY(0).normalize();
    this.dodgeTimer = DODGE_TIME;
    this.dodgeCd = DODGE_CD;
    this.group.rotation.y = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
    return true;
  }

  isDodging(): boolean {
    return this.dodgeTimer > 0;
  }

  /** Apply starter-class base stats (fresh character). */
  applyClass(cls: StarterClass): void {
    const def = CLASSES[cls];
    this.baseClass = cls;
    this.job = null;
    this.maxHp = def.maxHp;
    this.hp = def.maxHp;
    this.maxMana = def.maxMana;
    this.mana = def.maxMana;
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
    this.ensureModel(cls);
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

  /** Spend mana. Returns false (spends nothing) if insufficient. */
  spendMana(amount: number): boolean {
    if (!this.alive || this.mana < amount) return false;
    this.mana -= amount;
    return true;
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
      this.maxMana += b.maxMana;
      this.attackDamage += b.damage;
    }
    this.level = target;
    this.xpNext = xpNeed(target);
  }

  /** Recolor body (used when loading a saved class). */
  setBodyColor(hex: number): void {
    this.bodyMat.color.setHex(hex);
  }

  /** Swap to the class Mixamo model if defined; otherwise keep the capsule. */
  private ensureModel(cls: StarterClass): void {
    const base = CLASSES[cls].model ?? null;
    if (base === this.modelKey || this.modelLoading) return;
    if (!base) {
      this.hideModel();
      return;
    }
    this.modelLoading = true;
    void this.loadModel(cls, base).finally(() => {
      this.modelLoading = false;
    });
  }

  private hideModel(): void {
    this.modelKey = null;
    this.mixer = null;
    this.animIdle = this.animRun = this.animAttack = this.animCast = this.animHit = this.animDeath = null;
    this.modelMats = [];
    if (this.modelRoot) {
      this.group.remove(this.modelRoot);
      this.modelRoot = null;
    }
    this.body.visible = true;
    this.nose.visible = true;
    this.mountWeaponAnchor();
  }

  /** Show the equipped weapon model in hand (axe only for now, others = bare hands). */
  setWeaponModel(baseId: string | null): void {
    const want = baseId === 'woodsman_axe' ? baseId : null;
    if (want === this.weaponBaseId) return;
    this.weaponBaseId = want;
    for (let i = this.weaponAnchor.children.length - 1; i >= 0; i--) {
      const c = this.weaponAnchor.children[i];
      this.weaponAnchor.remove(c);
      c.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mat = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    }
    if (want) {
      const axe = buildAxe();
      axe.scale.setScalar(0.85);
      axe.position.y = -0.2;
      axe.rotation.x = 0.2;
      this.weaponAnchor.add(axe);
    }
    this.mountWeaponAnchor();
  }

  /** Arm + forearm bones for the spin T-pose (Mixamo names, exact match). */
  private resolveSpinArms(): void {
    this.spinArmBones = [];
    this.spinArmsFor = this.modelRoot;
    if (!this.modelRoot) return;
    const names = new Set<string>();
    this.modelRoot.traverse((o) => {
      names.add(o.name.toLowerCase());
    });
    const take = (suffix: string, side: number): void => {
      const want = `mixamorig${suffix}`;
      if (!names.has(want)) return;
      let hit: THREE.Object3D | null = null;
      this.modelRoot?.traverse((o) => {
        if (!hit && o.name.toLowerCase() === want) hit = o;
      });
      if (hit) this.spinArmBones.push({ bone: hit, side });
    };
    take('leftarm', 1);
    take('leftforearm', 1);
    take('rightarm', -1);
    take('rightforearm', -1);
  }

  /**
   * Hold the arms out horizontally while spinning. Runs after mixer.update so
   * the override wins over the locomotion clip; it aligns each limb's +Y axis
   * (verified Mixamo bind direction) to the body's ±X via the shortest arc —
   * no axis guessing, works from any animation pose. When spinPose clears we
   * simply stop overriding and the clip resumes (nothing to restore).
   */
  private updateSpinArms(): void {
    this.fallbackArmL.visible = this.fallbackArmR.visible = this.spinPose && !this.modelRoot;
    if (!this.spinPose || !this.modelRoot) return;
    if (this.spinArmsFor !== this.modelRoot) this.resolveSpinArms();
    if (this.spinArmBones.length === 0) return;
    this.group.getWorldQuaternion(this.spinQG);
    for (const { bone, side } of this.spinArmBones) {
      if (!bone.parent) continue;
      bone.getWorldQuaternion(this.spinQW);
      this.spinDir.set(0, 1, 0).applyQuaternion(this.spinQW);
      this.spinTgt.set(side, 0, 0).applyQuaternion(this.spinQG);
      this.spinQR.setFromUnitVectors(this.spinDir, this.spinTgt);
      bone.parent.getWorldQuaternion(this.spinQP);
      bone.quaternion.copy(this.spinQP.invert().multiply(this.spinQR).multiply(this.spinQW));
    }
  }

  /** Parent the weapon anchor to the right-hand bone (cm-scale rig) or body fallback. */
  private mountWeaponAnchor(): void {
    let hand: THREE.Object3D | null = null;
    if (this.modelRoot) {
      this.modelRoot.traverse((o) => {
        if (!hand && /righthand/i.test(o.name)) hand = o;      });
      if (!hand) {
        this.modelRoot.traverse((o) => {
          if (!hand && /hand/i.test(o.name)) hand = o;
        });
      }
    }
    if (hand) {
      // Rig is centimeter-scale (root ×0.01) — counter-scale back to meters.
      (hand as THREE.Object3D).add(this.weaponAnchor);
      this.weaponAnchor.position.set(0, 0, 0);
      this.weaponAnchor.rotation.set(0, 0, 0);
      this.weaponAnchor.scale.setScalar(100);
    } else {
      this.group.add(this.weaponAnchor);
      this.weaponAnchor.position.set(0.55, 1.1, 0.25);
      this.weaponAnchor.rotation.set(0, 0, 0);
      this.weaponAnchor.scale.setScalar(1);
    }
  }

  /**
   * Kill XZ root motion on looping clips (run/idle) so the model stays glued
   * to the simulated body. Mixamo downloads without "In Place" translate the
   * hips meters per loop — the model lunges ahead and snaps back every stride
   * while the real position advances steadily. Y bounce is preserved.
   */
  private stripRootMotion(clip: THREE.AnimationClip): void {
    for (const track of clip.tracks) {
      if (!track.name.endsWith('mixamorigHips.position')) continue;
      const v = (track as THREE.VectorKeyframeTrack).values;
      if (v.length < 3) continue;
      const bx = v[0];
      const bz = v[2];
      for (let i = 0; i < v.length; i += 3) {
        v[i] = bx;
        v[i + 2] = bz;
      }
    }
  }

  /** Load idle.fbx (mesh + idle clip), then animation-only clips onto the same rig. */
  private async loadModel(cls: StarterClass, base: string): Promise<void> {
    // Stale request (class changed mid-load) — abort quietly.
    if (this.baseClass !== cls) return;
    const url = (f: string): string => `${import.meta.env.BASE_URL}${base}/${f}`;
    const loader = new FBXLoader();
    let baseObj: THREE.Group;
    try {
      baseObj = await loader.loadAsync(url('idle.fbx'));
    } catch (err) {
      console.warn(`[Player] warrior model missing (${url('idle.fbx')}), keeping capsule`, err);
      return;
    }
    if (this.baseClass !== cls) return;

    // Mixamo exports in centimeters — scale to meters to match capsule (~1.8m).
    baseObj.scale.setScalar(0.01);
    baseObj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = o as THREE.Mesh;
        mesh.castShadow = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial && !this.modelMats.includes(m)) {
            this.modelMats.push(m);
          }
        }
      }
    });
    if (this.modelRoot) this.group.remove(this.modelRoot);
    this.modelRoot = baseObj;
    this.group.add(baseObj);
    this.body.visible = false;
    this.nose.visible = false;
    this.modelKey = base;
    this.deathPlayed = false;
    this.mountWeaponAnchor();

    this.mixer = new THREE.AnimationMixer(baseObj);
    const idleClip = baseObj.animations[0] ?? null;
    if (idleClip) this.stripRootMotion(idleClip);
    if (idleClip) {
      this.animIdle = this.mixer.clipAction(idleClip);
      this.animIdle.setLoop(THREE.LoopRepeat, Infinity);
      this.animIdle.play();
    }

    // Animation-only files share the same mixamorig bone names — clips apply directly.
    // cast.fbx is mage-only (skyward channel for windups); other classes skip it
    // so their consoles stay clean.
    const extra: Array<{ file: string; set: (a: THREE.AnimationAction) => void; loop: boolean; speed: number }> = [
      { file: 'run.fbx', set: (a) => (this.animRun = a), loop: true, speed: 1 },
      // Mage spams its basic every 0.5s — its gesture must finish inside that
      // window or locomotion starves (warrior's 3s slash never has this problem).
      { file: 'attack.fbx', set: (a) => (this.animAttack = a), loop: false, speed: cls === 'mage' ? 3.5 : 2.2 },
      { file: 'hit.fbx', set: (a) => (this.animHit = a), loop: false, speed: 1.6 },
      { file: 'death.fbx', set: (a) => (this.animDeath = a), loop: false, speed: 1 },
    ];
    if (cls === 'mage') {
      extra.push({ file: 'cast.fbx', set: (a) => (this.animCast = a), loop: false, speed: 2 });
    }
    await Promise.all(
      extra.map(async (e) => {
        try {
          const obj = await loader.loadAsync(url(e.file));
          const clip = obj.animations[0];
          if (!clip || !this.mixer) return;
          if (e.file === 'run.fbx') this.stripRootMotion(clip);
          const action = this.mixer.clipAction(clip);
          if (e.loop) {
            action.setLoop(THREE.LoopRepeat, Infinity);
          } else {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          }
          action.timeScale = e.speed;
          e.set(action);
        } catch (err) {
          console.warn(`[Player] missing anim ${e.file}, locomotion fallback`, err);
        }
      }),
    );
  }

  private fadeTo(action: THREE.AnimationAction | null, dur = 0.15): void {
    if (!action || !this.mixer) return;
    // Fade out everything else so one-shots never stack (hit interrupts
    // slash, death interrupts all). `enabled` (not `isRunning`) on purpose:
    // a finished one-shot is paused-but-enabled, clamped at its end pose,
    // and fading is mixer-time driven so it still releases.
    for (const a of [this.animIdle, this.animRun, this.animAttack, this.animCast, this.animHit, this.animDeath]) {
      if (a && a !== action && a.enabled) a.fadeOut(dur);
    }
    action.reset();
    action.setEffectiveWeight(1);
    action.fadeIn(dur);
    action.play();
  }

  private oneShotPlaying(): boolean {
    return !!(
      (this.animAttack && this.animAttack.isRunning()) ||
      (this.animCast && this.animCast.isRunning()) ||
      (this.animHit && this.animHit.isRunning())
    );
  }

  private playLoop(name: 'idle' | 'run'): void {
    const action = name === 'run' ? this.animRun : this.animIdle;
    if (!action || !this.mixer) return;
    // Let a slash / hit-reaction finish first; this is re-asserted every
    // frame from update(), so locomotion resumes on its own.
    if (this.oneShotPlaying()) return;
    // Check the action itself, not a remembered name: a finished one-shot
    // leaves the loop faded out and three disables it, so isRunning() is
    // false and we fade back in. (Matching on name alone caused the
    // post-cast "floating" — stuck in the slash end pose while gliding.)
    if (action.isRunning()) return;
    this.fadeTo(action);
  }

  faceInstant(p: THREE.Vector3): void {
    this.group.rotation.y = Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z);
  }

  /**
   * True when an obstacle crowds the click point AND we have reached its rim:
   * closest possible distance is (rim - targetDepth); +0.9 covers the slide
   * orbit radius so circling the trunk counts as arriving.
   */
  private arrivalBlocked(target: THREE.Vector3, colliders: CircleCollider[]): boolean {
    const px = this.group.position.x - target.x;
    const pz = this.group.position.z - target.z;
    const pd2 = px * px + pz * pz;
    for (const c of colliders) {
      const tx = target.x - c.pos.x;
      const tz = target.z - c.pos.z;
      const rim = c.radius + this.radius;
      const hug = rim + 0.9;
      const tc2 = tx * tx + tz * tz;
      if (tc2 >= hug * hug) continue;
      const closest = Math.max(0, rim - Math.sqrt(tc2)) + 0.9;
      if (pd2 <= closest * closest) return true;
    }
    return false;
  }

  takeDamage(amount: number): boolean {
    if (!this.alive || this.dodgeTimer > 0) return false;
    this.hp -= amount;
    this.flash = 1;
    this.bodyMat.emissive.setHex(0xff2222);
    this.bodyMat.emissiveIntensity = 0.7;
    for (const m of this.modelMats) {
      m.emissive.setHex(0xff2222);
      m.emissiveIntensity = 0.7;
    }
    if (this.mixer && this.animHit && this.elapsed - this.lastHitAnimAt > 0.35 && !this.animHit.isRunning()) {
      this.lastHitAnimAt = this.elapsed;
      this.fadeTo(this.animHit, 0.08);
    }
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
      this.maxMana += bonus.maxMana;
      this.attackDamage += bonus.damage;
      this.statPoints += 3;
      this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * 0.4));
      this.mana = Math.min(this.maxMana, this.mana + bonus.maxMana);
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
    this.mana = this.maxMana;
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
    for (const m of this.modelMats) {
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
    }
    this.dodgeTimer = 0;
    this.dodgeCd = 0;
    this.deathPlayed = false;
    this.lastSwing = 0;
    this.lastCast = 0;
    if (this.mixer && this.animIdle) {
      this.animDeath?.stop();
      this.fadeTo(this.animIdle, 0.2);
    }
  }

  update(dt: number, colliders: CircleCollider[], keyboardDir: THREE.Vector3): void {
    this.elapsed += dt;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.potionCooldown = Math.max(0, this.potionCooldown - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    if (this.alive && this.mana < this.maxMana) {
      this.mana = Math.min(this.maxMana, this.mana + (2 + this.maxMana * 0.03) * dt);
    }
    if (this.buffTimer > 0) {
      this.buffTimer -= dt;
      if (this.buffTimer <= 0) this.buffDmgMult = 1;
    }
    if (this.mixer) this.mixer.update(dt);
    this.updateSpinArms();

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 4);
      this.bodyMat.emissiveIntensity = this.flash * 0.7;
      for (const m of this.modelMats) m.emissiveIntensity = this.flash * 0.7;
      if (this.flash === 0) {
        this.bodyMat.emissive.setHex(0x000000);
        for (const m of this.modelMats) m.emissive.setHex(0x000000);
      }
    }
    const swingBefore = this.lastSwing;
    if (this.swingAnim > 0) {
      this.swingAnim = Math.max(0, this.swingAnim - dt * 6);
      if (!this.modelRoot) {
        const s = 1 + this.swingAnim * 0.12;
        this.body.scale.set(s, 2 - s > 0.6 ? 2 - s : 1, s);
        if (this.swingAnim === 0 && this.castAnim === 0) this.body.scale.set(1, 1, 1);
      }
    }
    // Rising edge on swingAnim (Game sets it to 1 per attack) -> slash once.
    // Never restart a running gesture: spam casts would snap the torso
    // back-and-forth and starve the run loop (mage 0.5s builder).
    if (this.swingAnim > 0.5 && swingBefore <= 0.5 && this.alive && this.mixer && this.animAttack && !this.animAttack.isRunning()) {
      this.fadeTo(this.animAttack, 0.08);
    }
    this.lastSwing = this.swingAnim;
    // Rising edge on castAnim (Game sets it to 1 per windup cast) -> channel once.
    const castBefore = this.lastCast;
    if (this.castAnim > 0) {
      this.castAnim = Math.max(0, this.castAnim - dt * 6);
      if (!this.modelRoot && this.swingAnim === 0) {
        const s = 1 + this.castAnim * 0.12;
        this.body.scale.set(s, 2 - s > 0.6 ? 2 - s : 1, s);
        if (this.castAnim === 0) this.body.scale.set(1, 1, 1);
      }
    }
    if (this.castAnim > 0.5 && castBefore <= 0.5 && this.alive && this.mixer && this.animCast) {
      this.fadeTo(this.animCast, 0.12);
    }
    this.lastCast = this.castAnim;

    if (!this.alive) {
      if (this.mixer && this.animDeath) {
        if (!this.deathPlayed) {
          this.deathPlayed = true;
          this.fadeTo(this.animDeath, 0.15);
        }
      } else {
        // Capsule fallback death pose: fall over
        this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, -Math.PI / 2.4, 1 - Math.exp(-6 * dt));
      }
      this.isMoving = false;
      return;
    }
    if (this.group.rotation.x !== 0) this.group.rotation.x = 0;

    const move = new THREE.Vector3();

    const dodging = this.dodgeTimer > 0;
    if (dodging) {
      // Dash overrides steering (click target resumes after); shares the
      // collider push-out + clamp path below.
      this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
      move.copy(this.dodgeDir);
    } else if (keyboardDir.lengthSq() > 0.0001) {
      this.target = null;
      move.copy(keyboardDir).normalize();
    } else if (this.target) {
      move.copy(this.target).sub(this.group.position);
      move.y = 0;
      const dist = move.length();
      // Blocked arrival: a click inside/against a trunk or fountain rim can
      // never get closer than the rim — arriving at rim + reach counts.
      if (dist < this.stopDistance || (dist < 3 && this.arrivalBlocked(this.target, colliders))) {
        this.target = null;
        this.isMoving = false;
        if (this.mixer) this.playLoop('idle');
        return;
      }
      move.normalize();
    } else {
      this.isMoving = false;
      if (this.mixer) this.playLoop('idle');
      return;
    }

    this.isMoving = true;
    if (this.mixer) this.playLoop('run');
    const stepLen = (dodging ? DODGE_SPEED : this.speed) * dt;
    deflectMove(this.group.position, this.radius, move, colliders);
    let moved = false;
    if (move.lengthSq() > 1e-6) {
      move.normalize();
      this.group.position.addScaledVector(move, stepLen);
      moved = true;
    } else {
      // Dead head-on (measure-zero symmetry): deterministic left sidestep to
      // break it — next frame the geometry is asymmetric and slide takes over.
      this.steerTmp.copy(this.target && !dodging ? this.target : this.group.position)
        .sub(this.group.position)
        .setY(0);
      if (!dodging && this.steerTmp.lengthSq() > 1e-6) {
        this.steerTmp.normalize();
        move.set(-this.steerTmp.z, 0, this.steerTmp.x);
      } else if (dodging) {
        move.copy(this.dodgeDir);
      }
      if (move.lengthSq() > 1e-6) {
        this.group.position.addScaledVector(move, stepLen);
        moved = true;
      } else {
        this.isMoving = false;
        if (this.mixer) this.playLoop('idle');
      }
    }

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
    if (moved && !this.spinLock) {
      this.group.rotation.y = lerpAngle(this.group.rotation.y, targetYaw, 1 - Math.exp(-12 * dt));
    }

    this.walkTime += dt * 10;
    if (!this.modelRoot) {
      this.body.position.y = 1.1 + Math.abs(Math.sin(this.walkTime)) * 0.08;
      this.nose.position.y = this.body.position.y;
    }
  }
}
