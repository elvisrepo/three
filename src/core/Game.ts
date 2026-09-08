import * as THREE from 'three';
import { Player } from '../entities/Player';
import { Monster } from '../entities/Monster';
import { DamageNumbers } from '../entities/DamageNumbers';
import { ProjectilePool } from '../entities/ProjectilePool';
import { rollPlayerDamage } from '../combat/Stats';
import { createTerrain } from '../world/Terrain';
import { StateMachine } from './StateMachine';

const CAM_FOV = 38;
const CAM_MIN = 10;
const CAM_MAX = 26;
const CAM_DIR = new THREE.Vector3(0, 18, 12).normalize();

const FIREBALL_CD = 3;
const FIREBALL_MULT = 2.1;
const RESPAWN_DELAY = 2.5;
const SPAWN_HOME = new THREE.Vector3(0, 0, 0);

const MONSTER_SPAWNS: Array<{ x: number; z: number; level: number }> = [
  { x: 10, z: -8, level: 1 },
  { x: -10, z: -8, level: 1 },
  { x: -12, z: 5, level: 1 },
  { x: 12, z: 8, level: 2 },
  { x: 0, z: -16, level: 2 },
  { x: -4, z: 16, level: 2 },
  { x: 18, z: -4, level: 3 },
  { x: -18, z: -2, level: 3 },
];

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private player = new Player();
  private states = new StateMachine();

  private ground!: THREE.Mesh;
  private colliders: { pos: THREE.Vector3; radius: number }[] = [];
  private statics: { pos: THREE.Vector3; radius: number }[] = [];
  private dummies: THREE.Object3D[] = [];
  private monsters: Monster[] = [];

  private numbers!: DamageNumbers;
  private projectiles!: ProjectilePool;

  private dirLight!: THREE.DirectionalLight;
  private clickMarker!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private markerLife = 0;

  private keys = new Set<string>();
  private camDist = 21;
  private tmpVec = new THREE.Vector3();
  private tmpNdc = new THREE.Vector2();
  private desiredCam = new THREE.Vector3();
  private lastMouse = { x: window.innerWidth / 2, y: window.innerHeight * 0.4 };

  private kills = 0;
  private fireTimer = 0;
  private deathTimer = 0;
  private camShake = 0;
  private toastTimer = 0;

  private elPos: HTMLElement | null = null;
  private elState: HTMLElement | null = null;
  private elFps: HTMLElement | null = null;
  private elHpFill: HTMLElement | null = null;
  private elHpText: HTMLElement | null = null;
  private elXpFill: HTMLElement | null = null;
  private elLevel: HTMLElement | null = null;
  private elKills: HTMLElement | null = null;
  private elFireCd: HTMLElement | null = null;
  private elPotion: HTMLElement | null = null;
  private elToast: HTMLElement | null = null;
  private elDeath: HTMLElement | null = null;
  private elDeathSub: HTMLElement | null = null;
  private hudTimer = 0;
  private fpsEma = 60;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0b0e14);
    this.scene.fog = new THREE.Fog(0x0b0e14, 32, 85);

    this.camera = new THREE.PerspectiveCamera(
      CAM_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      220,
    );

    this.setupLights();
    this.setupWorld();
    this.setupClickMarker();
    this.bindInput();
    this.cacheHud();

    this.snapCamera();
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x2a3a2a, 0.9);
    this.scene.add(hemi);

    this.dirLight = new THREE.DirectionalLight(0xfff2d9, 1.7);
    this.dirLight.position.set(10, 20, 6);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.left = -22;
    this.dirLight.shadow.camera.right = 22;
    this.dirLight.shadow.camera.top = 22;
    this.dirLight.shadow.camera.bottom = -22;
    this.dirLight.shadow.camera.near = 1;
    this.dirLight.shadow.camera.far = 60;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);
  }

  private setupWorld(): void {
    const terrain = createTerrain(this.scene);
    this.ground = terrain.ground;
    this.colliders = terrain.colliders;
    this.statics = terrain.statics;
    this.dummies = terrain.dummies;
    this.scene.add(this.player.group);

    for (const s of MONSTER_SPAWNS) {
      const m = new Monster(new THREE.Vector3(s.x, 0, s.z), s.level);
      m.group.userData.monster = m;
      this.monsters.push(m);
      this.scene.add(m.group);
    }

    this.numbers = new DamageNumbers(this.scene);
    this.projectiles = new ProjectilePool(this.scene, 16);
  }

  private setupClickMarker(): void {
    this.clickMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.55, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffd479,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.clickMarker.rotation.x = -Math.PI / 2;
    this.clickMarker.position.y = 0.04;
    this.clickMarker.visible = false;
    this.scene.add(this.clickMarker);
  }

  private cacheHud(): void {
    const id = (s: string) => document.getElementById(s);
    this.elPos = id('stat-pos');
    this.elState = id('stat-state');
    this.elFps = id('stat-fps');
    this.elHpFill = id('hp-fill');
    this.elHpText = id('hp-text');
    this.elXpFill = id('xp-fill');
    this.elLevel = id('stat-level');
    this.elKills = id('stat-kills');
    this.elFireCd = id('cd-fire');
    this.elPotion = id('skill-potion');
    this.elToast = id('hud-toast');
    this.elDeath = id('death-overlay');
    this.elDeathSub = id('death-sub');
  }

  // ---------- input ----------

  private bindInput(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        this.player.stop();
        this.player.clearAttackTarget();
        this.clickMarker.visible = false;
        return;
      }
      if (e.button !== 0) return;
      this.handleGroundClick(e.clientX, e.clientY);
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.01, CAM_MIN, CAM_MAX);
    }, { passive: false });

    canvas.addEventListener('pointermove', (e) => {
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
      this.updateHoverCursor(e.clientX, e.clientY);
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Digit1') this.tryFireball();
      if (e.code === 'KeyQ') this.tryPotion();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('resize', () => this.onResize());
  }

  private setNdc(clientX: number, clientY: number): void {
    this.tmpNdc.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.tmpNdc, this.camera);
  }

  private groundPointFromScreen(clientX: number, clientY: number): THREE.Vector3 | null {
    this.setNdc(clientX, clientY);
    const hits = this.raycaster.intersectObject(this.ground, false);
    return hits.length > 0 ? hits[0].point : null;
  }

  private findMonsterFromHit(obj: THREE.Object3D | null): Monster | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      if (o.userData.monster) return o.userData.monster as Monster;
      o = o.parent;
    }
    return null;
  }

  private handleGroundClick(clientX: number, clientY: number): void {
    if (!this.player.alive) return;
    this.setNdc(clientX, clientY);

    // 1) Live monsters first (attack-move)
    const liveGroups = this.monsters.filter((m) => m.alive).map((m) => m.group);
    const monsterHits = this.raycaster.intersectObjects(liveGroups, true);
    if (monsterHits.length > 0) {
      const m = this.findMonsterFromHit(monsterHits[0].object);
      if (m) {
        this.player.attackTarget = m;
        // Run to just outside attack range; follow logic keeps tracking
        this.tmpVec.copy(m.position).sub(this.player.position).setY(0);
        const len = this.tmpVec.length();
        if (len > this.player.attackRange) {
          this.tmpVec.multiplyScalar((len - (this.player.attackRange - 0.4)) / len).add(this.player.position);
          this.player.setTarget(this.tmpVec);
        } else {
          this.player.stop();
        }
        this.showMarker(m.position, 0xff6b6b);
        return;
      }
    }

    // 2) Dummies (decor — walk up, no combat)
    const dummyHits = this.raycaster.intersectObjects(this.dummies, true);
    if (dummyHits.length > 0) {
      let obj: THREE.Object3D | null = dummyHits[0].object;
      while (obj && !obj.userData.isTarget) obj = obj.parent;
      const p = obj ? obj.position : dummyHits[0].point;
      this.player.clearAttackTarget();
      this.tmpVec.copy(p).sub(this.player.position).setY(0);
      const len = this.tmpVec.length();
      if (len > 1.6) {
        this.tmpVec.multiplyScalar((len - 1.4) / len).add(this.player.position);
        this.player.setTarget(this.tmpVec);
      } else {
        this.player.stop();
      }
      this.showMarker(p, 0xff6b6b);
      return;
    }

    // 3) Ground move (cancels attack)
    const groundHits = this.raycaster.intersectObject(this.ground, false);
    if (groundHits.length > 0) {
      const p = groundHits[0].point;
      p.x = THREE.MathUtils.clamp(p.x, -29, 29);
      p.z = THREE.MathUtils.clamp(p.z, -29, 29);
      this.player.clearAttackTarget();
      this.player.setTarget(p);
      this.showMarker(p, 0xffd479);
    }
  }

  private hoverCheck = 0;

  private updateHoverCursor(clientX: number, clientY: number): void {
    if (++this.hoverCheck % 3 !== 0) return;
    this.setNdc(clientX, clientY);
    const liveGroups = this.monsters.filter((m) => m.alive).map((m) => m.group);
    const hits = this.raycaster.intersectObjects([...liveGroups, ...this.dummies], true);
    this.renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'crosshair';
  }

  private showMarker(p: THREE.Vector3, color: number): void {
    this.clickMarker.position.set(p.x, 0.04, p.z);
    (this.clickMarker.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.clickMarker.visible = true;
    this.clickMarker.scale.setScalar(1);
    (this.clickMarker.material as THREE.MeshBasicMaterial).opacity = 0.95;
    this.markerLife = 0.55;
  }

  // ---------- combat actions ----------

  private tryFireball(): void {
    if (!this.player.alive || this.fireTimer > 0) return;
    const aim = this.groundPointFromScreen(this.lastMouse.x, this.lastMouse.y);
    this.tmpVec.set(0, 0, 1).applyQuaternion(this.player.group.quaternion).setY(0);
    if (aim) {
      this.tmpVec.copy(aim).sub(this.player.position).setY(0);
      if (this.tmpVec.lengthSq() < 0.25) {
        this.tmpVec.set(0, 0, 1).applyQuaternion(this.player.group.quaternion).setY(0);
      }
    }
    if (this.tmpVec.lengthSq() < 1e-6) return;
    this.tmpVec.normalize();
    this.projectiles.fire(this.player.position, this.tmpVec, this.player.attackDamage * FIREBALL_MULT, 16, 18);
    this.player.faceInstant(this.tmpVec.clone().add(this.player.position));
    this.player.swingAnim = 1;
    this.fireTimer = FIREBALL_CD;
  }

  private tryPotion(): void {
    if (this.player.drinkPotion()) {
      this.numbers.spawn(this.player.position, `+${Math.round(this.player.maxHp * 0.45)}`, { color: '#5dff6b', scale: 1.4 });
    }
  }

  private onMonsterKilled(m: Monster): void {
    this.kills += 1;
    const leveled = this.player.gainXp(m.xpValue);
    if (leveled) {
      this.numbers.spawn(this.player.position, 'LEVEL UP!', { color: '#ffd21f', crit: true, scale: 1.8 });
      this.showToast(`Level ${this.player.level}! +HP +DMG (potions refilled)`);
      this.player.potions = Math.min(5, this.player.potions + 1);
    }
  }

  private showToast(text: string, ms = 2.4): void {
    if (!this.elToast) return;
    this.elToast.textContent = text;
    this.elToast.style.opacity = '1';
    this.toastTimer = ms;
  }

  // ---------- per-frame ----------

  private keyboardDir(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) out.z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) out.z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) out.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) out.x += 1;
    return out;
  }

  private snapCamera(): void {
    this.tmpVec.copy(this.player.position).addScaledVector(CAM_DIR, this.camDist);
    this.camera.position.copy(this.tmpVec);
    this.camera.lookAt(this.player.position.x, 1, this.player.position.z);
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (dt > 0) this.fpsEma += (1 / dt - this.fpsEma) * 0.05;
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.camShake = Math.max(0, this.camShake - dt * 1.6);

    // Movement input (WASD cancels attack-move)
    this.keyboardDir(this.tmpVec);
    const kb = this.tmpVec.clone();
    if (kb.lengthSq() > 0.0001 && this.player.alive) this.player.clearAttackTarget();

    // Attack-follow: chase target until in range
    const atk = this.player.attackTarget as Monster | null;
    if (this.player.alive && atk) {
      if (!atk.alive) {
        this.player.clearAttackTarget();
      } else {
        const dist = this.player.position.distanceTo(atk.position);
        if (dist > this.player.attackRange) {
          this.player.setTarget(atk.position);
        } else {
          this.player.stop();
        }
      }
    }

    this.player.update(dt, this.colliders, kb);

    // Monsters + incoming damage
    for (const m of this.monsters) {
      const dmg = m.update(dt, this.player.position, this.player.alive, this.statics, this.monsters);
      if (dmg > 0 && this.player.alive) {
        const died = this.player.takeDamage(dmg);
        this.numbers.spawn(this.player.position, `${dmg}`, { color: '#ff6b6b' });
        this.camShake = Math.min(0.6, this.camShake + 0.25);
        if (died) {
          this.deathTimer = RESPAWN_DELAY;
          if (this.elDeath) this.elDeath.style.display = 'flex';
          this.showToast('You died — respawning in town…');
        }
      }
    }

    // Player death / respawn
    if (!this.player.alive) {
      this.deathTimer -= dt;
      if (this.elDeathSub) this.elDeathSub.textContent = `Respawn in ${Math.max(0, this.deathTimer).toFixed(1)}s`;
      if (this.deathTimer <= 0) {
        this.player.respawn(SPAWN_HOME);
        if (this.elDeath) this.elDeath.style.display = 'none';
        this.showToast('Revived! Watch your HP — use Q to heal.');
        this.snapCamera();
      }
    }

    // Player auto-attack
    const target = this.player.attackTarget as Monster | null;
    if (this.player.alive && target && target.alive) {
      const dist = this.player.position.distanceTo(target.position);
      if (dist <= this.player.attackRange + 0.35 && this.player.attackTimer <= 0) {
        this.player.attackTimer = this.player.attackCooldown;
        this.player.faceInstant(target.position);
        this.player.swingAnim = 1;
        const roll = rollPlayerDamage(this.player.attackDamage, this.player.critChance);
        const died = target.takeDamage(roll.amount, roll.isCrit, this.numbers);
        if (died) {
          this.onMonsterKilled(target);
          this.player.clearAttackTarget();
        }
      }
    }

    // Projectiles + floaters
    this.projectiles.update(dt, this.monsters, this.numbers, (m) => this.onMonsterKilled(m));
    this.numbers.update(dt);

    // Camera follow (+ shake)
    this.desiredCam.copy(this.player.position).addScaledVector(CAM_DIR, this.camDist);
    const k = 1 - Math.exp(-5 * dt);
    this.camera.position.lerp(this.desiredCam, k);
    if (this.camShake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.camShake;
      this.camera.position.y += (Math.random() - 0.5) * this.camShake * 0.6;
    }
    this.camera.lookAt(this.player.position.x, 1, this.player.position.z);

    // Light follows player
    this.dirLight.position.set(this.player.position.x + 10, 20, this.player.position.z + 6);
    this.dirLight.target.position.copy(this.player.position);
    this.dirLight.target.updateMatrixWorld();

    // Click marker fade
    if (this.clickMarker.visible) {
      this.markerLife -= dt;
      const m = this.clickMarker.material;
      m.opacity = Math.max(0, this.markerLife / 0.55) * 0.95;
      this.clickMarker.scale.addScalar(dt * 1.2);
      if (this.markerLife <= 0) this.clickMarker.visible = false;
    }

    // Toast fade
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0 && this.elToast) this.elToast.style.opacity = '0';
    }

    this.updateHud(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateHud(_dt: number): void {
    // Cooldown sweep every frame (smooth)
    if (this.elFireCd) {
      const frac = this.fireTimer / FIREBALL_CD;
      this.elFireCd.style.height = `${Math.round(frac * 100)}%`;
    }

    this.hudTimer -= 1 / 60;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.1;

    if (this.elPos) {
      const p = this.player.position;
      this.elPos.textContent = `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
    }
    if (this.elFps) this.elFps.textContent = `${Math.round(this.fpsEma)}`;
    if (this.elState) {
      this.elState.textContent = !this.player.alive
        ? 'dead'
        : (this.player.attackTarget as Monster | null)?.alive
          ? 'attacking'
          : this.player.isMoving
            ? 'moving'
            : 'idle';
    }
    if (this.elHpFill) {
      const frac = (this.player.hp / this.player.maxHp) * 100;
      this.elHpFill.style.width = `${frac.toFixed(1)}%`;
    }
    if (this.elHpText) this.elHpText.textContent = `${this.player.hp}/${this.player.maxHp}`;
    if (this.elXpFill) {
      const frac = (this.player.xp / this.player.xpNext) * 100;
      this.elXpFill.style.width = `${frac.toFixed(1)}%`;
    }
    if (this.elLevel) this.elLevel.textContent = `${this.player.level}`;
    if (this.elKills) this.elKills.textContent = `${this.kills}`;
    if (this.elPotion) {
      const q = this.player.potionCooldown > 0 ? ` (${this.player.potionCooldown.toFixed(0)}s)` : '';
      this.elPotion.innerHTML = `Q<span class="sub">x${this.player.potions}${q}</span>`;
      this.elPotion.classList.toggle('locked', this.player.potions <= 0);
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  get state() {
    return this.states.state;
  }
}
