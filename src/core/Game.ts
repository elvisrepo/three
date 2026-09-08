import * as THREE from 'three';
import { Player } from '../entities/Player';
import { Monster } from '../entities/Monster';
import { BossController } from '../entities/Boss';
import { DamageNumbers } from '../entities/DamageNumbers';
import { Effects } from '../entities/Effects';
import { ProjectilePool } from '../entities/ProjectilePool';
import { rollPlayerDamage, xpNeed } from '../combat/Stats';
import { createTerrain } from '../world/Terrain';
import { ZONES, zoneById, type ZoneDef } from '../world/Zones';
import { LootManager } from '../world/Loot';
import { Inventory, Equipment } from '../items/Inventory';
import {
  generateDrop,
  generateShopStock,
  starterKit,
  gearBonus,
  sellPrice,
  affixLabel,
  makeTpScroll,
  itemStats,
  RARITY_COLOR,
  type ItemInstance,
  type ItemSlot,
  type GearBonus,
} from '../items/Items';
import { CLASSES, CLASS_IDS, type StarterClass, type Attrs } from '../data/Classes';
import { jobsFor, jobById, ADVANCE_LEVEL } from '../data/Jobs';
import { listChars, saveChar, deleteChar, makeCharId, SAVE_VERSION, type CharacterSave } from './SaveManager';
import { StateMachine, GameState } from './StateMachine';

const CAM_FOV = 38;
const CAM_MIN = 10;
const CAM_MAX = 40;
const CAM_DIR = new THREE.Vector3(0, 18, 12).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const _aoeVec = new THREE.Vector3();

const FIREBALL_CD = 3;
const FIREBALL_MULT = 2.1;
const BLINK_CD = 4;
const BLINK_RANGE = 9;
const RESPAWN_DELAY = 2.5;
const AUTOSAVE_SEC = 30;
const INTERACT_RADIUS = 3.4;

function randi(a: number, b: number): number {
  return a + Math.floor(Math.random() * (b - a + 1));
}

/** Delayed ground-targeted blast (meteor, frost nova telegraph). */
interface PendingAoe {
  x: number;
  z: number;
  radius: number;
  damage: number;
  slow: number;
  timer: number;
  color: number;
  flash: string | null;
  scorch: boolean;
  mesh: THREE.Mesh;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private player = new Player();
  private states = new StateMachine();

  private ground!: THREE.Mesh;
  private groundMat!: THREE.MeshStandardMaterial;
  private wallMats: THREE.MeshStandardMaterial[] = [];
  private colliders: { pos: THREE.Vector3; radius: number }[] = [];
  private statics: { pos: THREE.Vector3; radius: number }[] = [];
  private dummies: THREE.Object3D[] = [];
  private monsters: Monster[] = [];
  private bossCtrls: BossController[] = [];
  private pendingAoe: PendingAoe[] = [];

  private numbers!: DamageNumbers;
  private effects!: Effects;
  private projectiles!: ProjectilePool;
  private loot!: LootManager;
  private inventory = new Inventory();
  private equipment = new Equipment();
  private prevGear: GearBonus = { damage: 0, maxHp: 0, armor: 0, crit: 0, lifesteal: 0 };

  private shopNpc!: THREE.Group;
  private portalMesh!: THREE.Group;
  private sanctum!: THREE.Group;
  private shopStock: ItemInstance[] = [];

  private dirLight!: THREE.DirectionalLight;
  private clickMarker!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private markerLife = 0;

  private keys = new Set<string>();
  private camDist = 21;
  private tmpVec = new THREE.Vector3();
  private tmpNdc = new THREE.Vector2();
  private desiredCam = new THREE.Vector3();
  private lastMouse = { x: window.innerWidth / 2, y: window.innerHeight * 0.4 };

  private currentZoneId = 'city';
  private started = false;
  private currentSaveId: string | null = null;
  private invOpen = false;
  private shopOpen = false;
  private portalOpen = false;
  private charOpen = false;
  private compareUid: string | null = null;
  private pendingClass: StarterClass = 'warrior';
  private pendingRate = 1;
  private xpRate = 1;

  private kills = 0;
  private playtime = 0;
  private autosaveTimer = AUTOSAVE_SEC;
  private fireTimer = 0;
  private blinkTimer = 0;
  private skillTimer = 0;
  private skillCdMax = 1;
  private whirlTimer = 0;
  private sanctumHintShown = false;
  private deathTimer = 0;
  private camShake = 0;
  private flashTimer = 0;
  private flashMax = 0.3;
  private flashStrength = 0.45;
  private elFlash: HTMLElement | null = null;
  private sanctumFx = 0;
  private toastTimer = 0;
  private hoverCheck = 0;

  private elPos: HTMLElement | null = null;
  private elState: HTMLElement | null = null;
  private elFps: HTMLElement | null = null;
  private elHpFill: HTMLElement | null = null;
  private elHpText: HTMLElement | null = null;
  private elXpFill: HTMLElement | null = null;
  private elLevel: HTMLElement | null = null;
  private elKills: HTMLElement | null = null;
  private elGold: HTMLElement | null = null;
  private elZone: HTMLElement | null = null;
  private elSaveState: HTMLElement | null = null;
  private elFireCd: HTMLElement | null = null;
  private elBlinkCd: HTMLElement | null = null;
  private elPotion: HTMLElement | null = null;
  private elToast: HTMLElement | null = null;
  private elDeath: HTMLElement | null = null;
  private elDeathSub: HTMLElement | null = null;
  private elBossBar: HTMLElement | null = null;
  private elBossName: HTMLElement | null = null;
  private elBossFill: HTMLElement | null = null;
  private elPrompt: HTMLElement | null = null;
  private minimap: HTMLCanvasElement | null = null;
  private mmCtx: CanvasRenderingContext2D | null = null;
  private elInvPanel: HTMLElement | null = null;
  private elInvGrid: HTMLElement | null = null;
  private elInvGold: HTMLElement | null = null;
  private elEquipRow: HTMLElement | null = null;
  private elGearStats: HTMLElement | null = null;
  private elShopPanel: HTMLElement | null = null;
  private elShopStock: HTMLElement | null = null;
  private elShopGold: HTMLElement | null = null;
  private elPortalPanel: HTMLElement | null = null;
  private elPortalList: HTMLElement | null = null;
  private elCharSelect: HTMLElement | null = null;
  private elCharList: HTMLElement | null = null;
  private elNewName: HTMLInputElement | null = null;
  private elImportFile: HTMLInputElement | null = null;
  private elImportStatus: HTMLElement | null = null;
  private elCharPanel: HTMLElement | null = null;
  private elCharBody: HTMLElement | null = null;
  private elJobModal: HTMLElement | null = null;
  private elJobCards: HTMLElement | null = null;
  private elSkill2: HTMLElement | null = null;
  private elSkill2Cd: HTMLElement | null = null;
  private elCdnFire: HTMLElement | null = null;
  private elCdnBlink: HTMLElement | null = null;
  private elCdnSkill2: HTMLElement | null = null;
  private elCompare: HTMLElement | null = null;
  private elXpRate: HTMLElement | null = null;
  private elFade: HTMLElement | null = null;
  private hudTimer = 0;
  private fpsEma = 60;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x11141c);
    this.scene.fog = new THREE.Fog(0x11141c, 34, 105);

    this.camera = new THREE.PerspectiveCamera(
      CAM_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      220,
    );

    this.setupLights();
    this.setupWorld();
    this.setupNPCs();
    this.setupClickMarker();
    this.bindInput();
    this.cacheHud();
    this.buildCharSelect();

    // Backdrop city behind the character-select overlay
    this.loadZone('city');
    this.snapCamera();

    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- setup ----------

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
    this.groundMat = terrain.ground.material as THREE.MeshStandardMaterial;
    this.wallMats = [...new Set(terrain.walls.map((w) => w.material as THREE.MeshStandardMaterial))];
    this.colliders = terrain.colliders;
    this.statics = terrain.statics;
    this.dummies = terrain.dummies;
    this.scene.add(this.player.group);

    this.numbers = new DamageNumbers(this.scene);
    this.effects = new Effects(this.scene);
    this.projectiles = new ProjectilePool(this.scene, 16);
    this.loot = new LootManager(this.scene);
  }

  private makeLabel(text: string): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d canvas not supported');
    ctx.font = '900 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(text, 128, 32);
    ctx.fillStyle = '#ffd479';
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(3.6, 0.9, 1);
    sp.renderOrder = 30;
    return sp;
  }

  private setupNPCs(): void {
    // Trader
    const shop = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 1.0, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.6 }),
    );
    body.position.y = 1.1;
    body.castShadow = true;
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.8, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 }),
    );
    apron.position.set(0, 1.0, 0.42);
    const label = this.makeLabel('🛒 TRADER');
    label.position.y = 2.9;
    shop.add(body, apron, label);
    shop.userData.interact = 'shop';
    this.scene.add(shop);
    this.shopNpc = shop;

    // Portal arch
    const portal = new THREE.Group();
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(1.3, 0.28, 12, 28),
      new THREE.MeshStandardMaterial({ color: 0x5da9ff, emissive: 0x2b6fd6, emissiveIntensity: 1.1, roughness: 0.3 }),
    );
    arch.position.y = 1.7;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 28),
      new THREE.MeshBasicMaterial({ color: 0x5da9ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    );
    disc.position.y = 1.7;
    const plabel = this.makeLabel('PORTAL');
    plabel.position.y = 3.5;
    portal.add(arch, disc, plabel);
    portal.userData.interact = 'portal';
    this.scene.add(portal);
    this.portalMesh = portal;

    // Job sanctum (Haven): walkable golden circle, advancement happens inside it
    const sanctum = new THREE.Group();
    const sring = new THREE.Mesh(
      new THREE.RingGeometry(2.1, 2.6, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    sring.rotation.x = -Math.PI / 2;
    sring.position.y = 0.05;
    const sdisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    );
    sdisc.rotation.x = -Math.PI / 2;
    sdisc.position.y = 0.04;
    const sbeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 6, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    sbeam.position.y = 3;
    const slabel = this.makeLabel('⭐ SANCTUM');
    slabel.position.y = 4.4;
    sanctum.add(sring, sdisc, sbeam, slabel);
    sanctum.userData.interact = 'sanctum';
    this.scene.add(sanctum);
    this.sanctum = sanctum;
  }

  private rebuildColliders(): void {
    const extra: { pos: THREE.Vector3; radius: number }[] = [];
    if (this.shopNpc.visible) extra.push({ pos: this.shopNpc.position, radius: 0.9 });
    if (this.portalMesh.visible) extra.push({ pos: this.portalMesh.position, radius: 1.1 });
    // Note: terrain colliders (statics + dummies) are the stable base array.
    this.colliders = [...this.statics, ...extra];
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
    const $ = (s: string) => document.getElementById(s);
    this.elPos = $('stat-pos');
    this.elState = $('stat-state');
    this.elFps = $('stat-fps');
    this.elHpFill = $('hp-fill');
    this.elHpText = $('hp-text');
    this.elXpFill = $('xp-fill');
    this.elLevel = $('stat-level');
    this.elKills = $('stat-kills');
    this.elGold = $('stat-gold');
    this.elZone = $('stat-zone');
    this.elSaveState = $('stat-save');
    this.elFireCd = $('cd-fire');
    this.elBlinkCd = $('cd-blink');
    this.elPotion = $('skill-potion');
    this.elToast = $('hud-toast');
    this.elDeath = $('death-overlay');
    this.elDeathSub = $('death-sub');
    this.elBossBar = $('boss-bar');
    this.elBossName = $('boss-name');
    this.elBossFill = $('boss-fill');
    this.elPrompt = $('interact-prompt');
    this.elInvPanel = $('inventory-panel');
    this.elInvGrid = $('inv-grid');
    this.elInvGold = $('inv-gold');
    this.elEquipRow = $('equip-row');
    this.elGearStats = $('gear-stats');
    this.elShopPanel = $('shop-panel');
    this.elShopStock = $('shop-stock');
    this.elShopGold = $('shop-gold');
    this.elPortalPanel = $('portal-panel');
    this.elPortalList = $('portal-list');
    this.elCharSelect = $('char-select');
    this.elCharList = $('char-list');
    this.elNewName = $('new-name') as HTMLInputElement | null;
    this.elImportFile = $('import-file') as HTMLInputElement | null;
    this.elImportStatus = $('import-status');
    this.elCharPanel = $('char-panel');
    this.elCharBody = $('char-body');
    this.elJobModal = $('job-modal');
    this.elJobCards = $('job-cards');
    this.elSkill2 = $('skill-job');
    this.elSkill2Cd = $('cd-skill2');
    this.elCdnFire = $('cdn-fire');
    this.elCdnBlink = $('cdn-blink');
    this.elCdnSkill2 = $('cdn-skill2');
    this.elCompare = $('compare-panel');
    this.elXpRate = $('stat-xprate');
    this.minimap = $('minimap') as HTMLCanvasElement | null;
    this.mmCtx = this.minimap?.getContext('2d') ?? null;
    this.elFlash = $('flash');
    this.elFade = $('fade');

    // Panel interactions (delegated — survive innerHTML re-renders)
    this.elInvGrid?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-uid]') as HTMLElement | null;
      if (!t) return;
      const uid = t.dataset.uid;
      if (!uid) return;
      if (this.shopOpen) {
        this.sellItem(uid);
        return;
      }
      const it = this.inventory.find(uid);
      if (it?.kind === 'consumable') this.useScroll(uid);
      else this.equipItem(uid);
    });
    this.elEquipRow?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-slot]') as HTMLElement | null;
      const slot = t?.dataset.slot as ItemSlot | undefined;
      if (slot) this.unequipItem(slot);
    });
    this.elShopStock?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-buy],[data-buyscroll]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.buyscroll !== undefined) {
        this.buyScroll();
        return;
      }
      const uid = t.dataset.buy;
      if (uid) this.buyStock(uid);
    });
    this.elShopStock?.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest('[data-buy]') as HTMLElement | null;
      const uid = t?.dataset.buy;
      if (!uid || uid === this.compareUid) return;
      this.compareUid = uid;
      const it = this.shopStock.find((s) => s.uid === uid);
      if (it) this.showCompare(it);
    });
    this.elShopStock?.addEventListener('mouseleave', () => this.hideCompare());
    this.elInvGrid?.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest('[data-uid]') as HTMLElement | null;
      const uid = t?.dataset.uid;
      if (!uid || uid === this.compareUid) return;
      this.compareUid = uid;
      const it = this.inventory.find(uid);
      if (it) this.showCompare(it);
    });
    this.elInvGrid?.addEventListener('mouseleave', () => this.hideCompare());
    this.elCharBody?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-alloc]') as HTMLElement | null;
      const attr = t?.dataset.alloc as keyof Attrs | undefined;
      if (!attr) return;
      if (this.player.allocate(attr)) {
        this.autosave();
        this.renderChar();
        this.renderInventory();
      } else {
        this.showToast('No stat points left — level up to earn +3.');
      }
    });
    this.elPortalList?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-travel]') as HTMLElement | null;
      const id = t?.dataset.travel;
      if (id) this.travelTo(id);
    });
    document.getElementById('btn-inv')?.addEventListener('click', () => this.toggleInventory());
    document.getElementById('btn-chars')?.addEventListener('click', () => this.openCharSelect());
    document.getElementById('btn-char')?.addEventListener('click', () => this.toggleChar());
    document.getElementById('btn-save')?.addEventListener('click', () => {
      this.autosave();
      this.showToast('Progress saved.');
    });
    document.getElementById('inv-close')?.addEventListener('click', () => this.toggleInventory(false));
    document.getElementById('char-close')?.addEventListener('click', () => this.toggleChar(false));
    document.getElementById('job-later')?.addEventListener('click', () => this.closeJobModal());
    this.elJobCards?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-job]') as HTMLElement | null;
      const id = t?.dataset.job;
      if (id) this.chooseJob(id);
    });
    document.getElementById('shop-close')?.addEventListener('click', () => this.closeShop());
    document.getElementById('portal-close')?.addEventListener('click', () => this.closePortal());
  }

  // ---------- character select + saves ----------

  private buildCharSelect(): void {
    // Class cards
    document.querySelectorAll('#class-row .class-card').forEach((el) => {
      el.addEventListener('click', () => {
        this.pendingClass = (el as HTMLElement).dataset.class as StarterClass;
        document.querySelectorAll('#class-row .class-card').forEach((x) => x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
    document.getElementById('btn-create')?.addEventListener('click', () => this.startNewChar());
    document.querySelectorAll('#rate-row .rate-card').forEach((el) => {
      el.addEventListener('click', () => {
        this.pendingRate = Number((el as HTMLElement).dataset.rate) || 1;
        document.querySelectorAll('#rate-row .rate-card').forEach((x) => x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
    document.getElementById('btn-import')?.addEventListener('click', () => this.elImportFile?.click());
    this.elImportFile?.addEventListener('change', () => this.importHeroFile());
    this.elCharList?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const id = t.dataset.id;
      if (!id) return;
      if (t.dataset.act === 'load') this.loadSave(id);
      else if (t.dataset.act === 'exp') this.exportHero(id);
      else if (t.dataset.act === 'del') {
        deleteChar(id);
        this.renderCharList();
      }
    });
    this.renderCharList();
  }

  private exportHero(id: string): void {
    const s = listChars().find((c) => c.id === id);
    if (!s || !this.elImportStatus) return;
    try {
      const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${s.name.replace(/[^a-z0-9-_]+/gi, '_') || 'hero'}.hero.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      this.elImportStatus.textContent = `Exported ${s.name}.`;
    } catch {
      this.elImportStatus.textContent = 'Export failed in this browser.';
    }
  }

  private importHeroFile(): void {
    const file = this.elImportFile?.files?.[0];
    if (!file) return;
    const done = (msg: string) => {
      if (this.elImportStatus) this.elImportStatus.textContent = msg;
      if (this.elImportFile) this.elImportFile.value = '';
    };
    file.text().then((text) => {
      try {
        const obj = JSON.parse(text) as Partial<CharacterSave>;
        if (!obj || typeof obj.name !== 'string') throw new Error('bad file');
        const bc: StarterClass = CLASS_IDS.includes(obj.baseClass as StarterClass)
          ? (obj.baseClass as StarterClass)
          : 'warrior';
        const level = Math.max(1, Math.min(60, Math.floor(Number(obj.level) || 1)));
        const save: CharacterSave = {
          id: makeCharId(),
          name: String(obj.name).slice(0, 16) || 'Hero',
          baseClass: bc,
          level,
          xp: Math.max(0, Number(obj.xp) || 0),
          gold: Math.max(0, Math.floor(Number(obj.gold) || 0)),
          hp: Math.max(1, Number(obj.hp) || 50),
          maxHp: Math.max(20, Number(obj.maxHp) || 100),
          damage: Math.max(1, Number(obj.damage) || 10),
          crit: Number(obj.crit) || 0.1,
          potions: Math.max(0, Math.min(5, Math.floor(Number(obj.potions) || 0))),
          kills: Math.max(0, Math.floor(Number(obj.kills) || 0)),
          playtimeSec: Math.max(0, Number(obj.playtimeSec) || 0),
          xpRate: [1, 2, 3, 5, 10].includes(Number(obj.xpRate)) ? Number(obj.xpRate) : 1,
          job: jobById(typeof obj.job === 'string' ? obj.job : null)?.id ?? null,
          attrs: obj.attrs ?? { ...CLASSES[bc].attrs },
          statPoints: Math.max(0, Math.floor(Number(obj.statPoints) || 0)),
          inventory: Array.isArray(obj.inventory) ? obj.inventory.slice(0, 24) : [],
          equipment: obj.equipment ?? { weapon: null, helm: null, chest: null, boots: null, ring: null },
          zoneId: typeof obj.zoneId === 'string' ? obj.zoneId : 'city',
          pos: Array.isArray(obj.pos) ? [Number(obj.pos[0]) || 0, Number(obj.pos[1]) || 6] : [0, 6],
          version: SAVE_VERSION,
          updatedAt: Date.now(),
        };
        saveChar(save);
        this.renderCharList();
        done(`Imported ${save.name} (Lv${save.level}).`);
      } catch {
        done('Import failed: not a valid hero file.');
      }
    }).catch(() => done('Import failed: could not read file.'));
  }

  /** Back to hero select mid-game: saves first, freezes the sim behind the overlay. */
  private openCharSelect(): void {
    this.autosave();
    this.closeAllPanels();
    if (this.elDeath) this.elDeath.style.display = 'none';
    this.started = false;
    this.renderCharList();
    if (this.elCharSelect) this.elCharSelect.style.display = 'flex';
  }

  private renderCharList(): void {
    if (!this.elCharList) return;
    const chars = listChars();
    if (chars.length === 0) {
      this.elCharList.innerHTML = '<div class="char-empty">No heroes yet — create one below.</div>';
      return;
    }
    this.elCharList.innerHTML = chars.map((c) => {
      const zone = zoneById(c.zoneId).name;
      const when = new Date(c.updatedAt).toLocaleDateString();
      return `<div class="char-row">
        <div><b>${c.name}</b> <span class="dim">${c.baseClass} · Lv${c.level} · ${zone} · x${c.xpRate ?? 1} EXP</span></div>
        <div class="dim">played ${Math.round(c.playtimeSec / 60)}m · ${when}</div>
        <div class="row-btns"><button data-act="load" data-id="${c.id}">Load</button>
        <button data-act="exp" data-id="${c.id}">Export</button>
        <button data-act="del" data-id="${c.id}" class="danger">Delete</button></div>
      </div>`;
    }).join('');
  }

  private startNewChar(): void {
    const name = (this.elNewName?.value ?? 'Hero').trim().slice(0, 16) || 'Hero';
    // Reset the shared Player body (a previous hero may have died mid-pose).
    this.player.respawn(new THREE.Vector3(0, 0, 0));
    this.player.applyClass(this.pendingClass);
    this.player.charName = name;
    this.player.level = 1;
    this.player.xp = 0;
    this.player.xpNext = xpNeed(1);
    this.player.potions = 3;
    this.player.armor = 0;
    this.player.lifesteal = 0;
    this.player.statPoints = 0;
    this.player.refreshAttributes();
    this.kills = 0;
    this.playtime = 0;
    this.xpRate = this.pendingRate;
    this.inventory = new Inventory();
    this.equipment = new Equipment();
    this.prevGear = { damage: 0, maxHp: 0, armor: 0, crit: 0, lifesteal: 0 };
    for (const it of starterKit()) this.equipment.equip(it);
    this.refreshGear();
    this.inventory.add(makeTpScroll());
    this.inventory.add(makeTpScroll());
    this.player.hp = this.player.maxHp;
    this.currentSaveId = makeCharId();
    this.sanctumHintShown = false;
    this.started = true;
    if (this.elCharSelect) this.elCharSelect.style.display = 'none';
    this.loadZone('city');
    this.showToast(`Welcome, ${name}! Grab gear at the Trader 🛒 (click him)`);
  }

  private loadSave(id: string): void {
    const s = listChars().find((c) => c.id === id);
    if (!s) return;
    this.applySave(s);
    this.currentSaveId = s.id;
    this.sanctumHintShown = false;
    this.started = true;
    if (this.elCharSelect) this.elCharSelect.style.display = 'none';
    this.loadZone(s.zoneId, { pos: [s.pos[0], s.pos[1]] });
    this.showToast(`Welcome back, ${s.name}!`);
  }

  private applySave(s: CharacterSave): void {
    // Recompute everything deterministically: class base + attributes + levels + gear.
    this.player.applyClass(s.baseClass);
    this.player.charName = s.name;
    this.player.setAttrs(s.attrs ?? { ...CLASSES[s.baseClass].attrs });
    this.player.refreshAttributes();
    this.player.replayLevels(s.level);
    this.player.xp = s.xp;
    this.player.statPoints = s.statPoints ?? 0;
    this.player.armor = 0;
    this.player.lifesteal = 0;
    this.kills = s.kills;
    this.playtime = s.playtimeSec;
    this.xpRate = s.xpRate ?? 1;
    this.inventory.fromJSON(s.inventory, s.gold);
    this.equipment.fromJSON(s.equipment);
    this.prevGear = { damage: 0, maxHp: 0, armor: 0, crit: 0, lifesteal: 0 };
    this.refreshGear();
    const job = jobById(s.job ?? null);
    if (job && job.baseClass === this.player.baseClass) {
      this.player.job = job.id;
      this.player.maxHp += job.bonus.maxHp;
      this.player.attackDamage += job.bonus.damage;
      this.player.critChance += job.bonus.crit;
    }
    this.player.hp = Math.min(s.hp, this.player.maxHp);
    this.player.potions = s.potions;
    if (!this.player.alive || this.player.hp <= 0) {
      this.player.alive = true;
      this.player.group.rotation.x = 0;
      this.player.hp = this.player.maxHp;
    }
    if (this.elDeath) this.elDeath.style.display = 'none';
  }

  private collectSave(): CharacterSave | null {
    if (!this.currentSaveId) return null;
    return {
      id: this.currentSaveId,
      name: this.player.charName,
      baseClass: this.player.baseClass,
      level: this.player.level,
      xp: this.player.xp,
      gold: this.inventory.gold,
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      damage: this.player.attackDamage,
      crit: this.player.critChance,
      potions: this.player.potions,
      kills: this.kills,
      playtimeSec: Math.round(this.playtime),
      xpRate: this.xpRate,
      job: this.player.job,
      attrs: this.player.attrs(),
      statPoints: this.player.statPoints,
      inventory: this.inventory.toJSON(),
      equipment: this.equipment.toJSON(),
      zoneId: this.currentZoneId,
      pos: [this.player.position.x, this.player.position.z],
      version: SAVE_VERSION,
      updatedAt: Date.now(),
    };
  }

  private autosave(): void {
    if (!this.started) return;
    const s = this.collectSave();
    if (!s) return;
    saveChar(s);
    if (this.elSaveState) this.elSaveState.textContent = `saved ${new Date().toLocaleTimeString()}`;
  }

  // ---------- zones ----------

  private loadZone(zoneId: string, opts?: { pos?: [number, number] }): void {
    const def = zoneById(zoneId);
    this.currentZoneId = def.id;
    this.states.set(def.id === 'city' ? GameState.City : GameState.Zone);

    for (const m of this.monsters) this.scene.remove(m.group);
    for (const b of this.bossCtrls) b.dispose();
    for (const a of this.pendingAoe) {
      this.scene.remove(a.mesh);
      a.mesh.geometry.dispose();
      (a.mesh.material as THREE.Material).dispose();
    }
    this.pendingAoe = [];
    this.monsters = [];
    this.bossCtrls = [];
    this.loot.clear();
    this.player.clearAttackTarget();
    this.player.stop();

    this.scene.background = new THREE.Color(def.fogColor);
    (this.scene.fog as THREE.Fog).color.setHex(def.fogColor);
    this.groundMat.color.setHex(def.groundColor);
    for (const w of this.wallMats) w.color.setHex(def.wallColor);

    this.shopNpc.position.set(def.shopPos[0], 0, def.shopPos[1]);
    this.portalMesh.position.set(def.portalPos[0], 0, def.portalPos[1]);
    this.sanctum.position.set(def.sanctumPos[0], 0, def.sanctumPos[1]);
    this.shopNpc.visible = def.hasShop;
    this.portalMesh.visible = def.hasPortal;
    this.sanctum.visible = def.id === 'city';
    this.rebuildColliders();

    if (def.monsters) this.spawnZoneMonsters(def);
    if (def.boss) this.spawnBoss(def);
    if (def.hasShop) {
      this.refreshShopStock();
      this.renderShop();
    }

    const px = opts?.pos?.[0] ?? def.spawn[0];
    const pz = opts?.pos?.[1] ?? def.spawn[1];
    this.player.position.set(px, 0, pz);
    this.snapCamera();
    this.closeShop();
    this.closePortal();
    this.updateBossBar();
    if (this.started) {
      this.showToast(`Entered ${def.name} — ${def.sub}`);
      this.autosave();
      this.hintSanctum();
    }
    this.refreshSkillSlot();
  }

  private spawnZoneMonsters(def: ZoneDef): void {
    if (!def.monsters) return;
    const [sx, sz] = def.spawn;
    for (let i = 0; i < def.monsters.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 15;
      let x = THREE.MathUtils.clamp(sx + Math.cos(a) * r, -27, 27);
      let z = THREE.MathUtils.clamp(sz + Math.sin(a) * r, -27, 27);
      // Keep clear of the entry point
      const dx = x - sx;
      const dz = z - sz;
      if (dx * dx + dz * dz < 36) {
        x = THREE.MathUtils.clamp(x + 9, -27, 27);
        z = THREE.MathUtils.clamp(z + 9, -27, 27);
      }
      const level = randi(def.monsters.levelMin, def.monsters.levelMax);
      const m = new Monster(new THREE.Vector3(x, 0, z), level);
      m.group.userData.monster = m;
      this.monsters.push(m);
      this.scene.add(m.group);
    }
  }

  private spawnBoss(def: ZoneDef): void {
    if (!def.boss) return;
    const tint = def.id === 'crypt' ? 0x7b2ff7 : 0xb81f2d;
    const boss = new Monster(new THREE.Vector3(def.bossPos[0], 0, def.bossPos[1]), def.boss.level, {
      hpMult: 6,
      dmgMult: 1.4,
      xpMult: 12,
      scale: 1.7,
      tint,
      name: def.boss.name,
      isBoss: true,
      aggro: 16,
      respawnDelay: 30,
    });
    boss.attackRange = 3.4;
    boss.group.userData.monster = boss;
    this.monsters.push(boss);
    this.scene.add(boss.group);
    this.bossCtrls.push(new BossController(this.scene, boss));
  }

  private spawnMinion(x: number, z: number, level: number): void {
    if (this.monsters.length >= 18) return;
    const m = new Monster(new THREE.Vector3(
      THREE.MathUtils.clamp(x, -27, 27), 0, THREE.MathUtils.clamp(z, -27, 27),
    ), Math.max(1, level));
    m.group.userData.monster = m;
    this.monsters.push(m);
    this.scene.add(m.group);
  }

  private refreshShopStock(): void {
    this.shopStock = generateShopStock(this.player.level);
  }

  /** Recompute player totals from equipped gear (delta-applied, no double count). */
  private refreshGear(): void {
    const b = gearBonus(this.equipment.all());
    const p = this.prevGear;
    this.player.attackDamage += b.damage - p.damage;
    const dHp = b.maxHp - p.maxHp;
    this.player.maxHp += dHp;
    if (dHp > 0) this.player.hp = Math.min(this.player.maxHp, this.player.hp + dHp);
    else this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    this.player.critChance += (b.crit - p.crit) / 100;
    this.player.armor = b.armor;
    this.player.lifesteal = b.lifesteal;
    this.prevGear = b;
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
      this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.015, CAM_MIN, CAM_MAX);
    }, { passive: false });

    canvas.addEventListener('pointermove', (e) => {
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
      this.updateHoverCursor(e.clientX, e.clientY);
    });

    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.started) return;
      if (e.code === 'Digit1') this.tryFireball();
      if (e.code === 'Digit2') this.castJobSkill();
      if (e.code === 'KeyQ') this.tryPotion();
      if (e.code === 'KeyI') this.toggleInventory();
      if (e.code === 'KeyC') this.toggleChar();
      if (e.code === 'KeyE') this.tryBlink();
      if (e.code === 'KeyF') this.interact();
      if (e.code === 'Escape') this.closeAllPanels();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('beforeunload', () => this.autosave());
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

  private findInteractFromHit(obj: THREE.Object3D | null): 'shop' | 'portal' | 'sanctum' | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      if (o.userData.interact === 'shop' || o.userData.interact === 'portal' || o.userData.interact === 'sanctum') {
        return o.userData.interact as 'shop' | 'portal' | 'sanctum';
      }
      o = o.parent;
    }
    return null;
  }

  private handleGroundClick(clientX: number, clientY: number): void {
    if (!this.started || !this.player.alive) return;
    this.setNdc(clientX, clientY);

    // 1) Live monsters first (attack-move)
    const liveGroups = this.monsters.filter((m) => m.alive).map((m) => m.group);
    const monsterHits = this.raycaster.intersectObjects(liveGroups, true);
    if (monsterHits.length > 0) {
      const m = this.findMonsterFromHit(monsterHits[0].object);
      if (m) {
        this.player.attackTarget = m;
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

    // 2) Shop / portal / sanctum
    const npcMeshes: THREE.Object3D[] = [];
    if (this.shopNpc.visible) npcMeshes.push(this.shopNpc);
    if (this.portalMesh.visible) npcMeshes.push(this.portalMesh);
    if (this.sanctum.visible) npcMeshes.push(this.sanctum);
    if (npcMeshes.length > 0) {
      const npcHits = this.raycaster.intersectObjects(npcMeshes, true);
      if (npcHits.length > 0) {
        const kind = this.findInteractFromHit(npcHits[0].object);
        if (kind === 'shop') {
          this.player.clearAttackTarget();
          this.openShop();
          this.showMarker(this.shopNpc.position, 0x2ecc71);
          return;
        }
        if (kind === 'portal') {
          this.player.clearAttackTarget();
          this.openPortal();
          this.showMarker(this.portalMesh.position, 0x5da9ff);
          return;
        }
        if (kind === 'sanctum') {
          this.player.clearAttackTarget();
          this.trySanctum();
          this.showMarker(this.sanctum.position, 0xffd21f);
          return;
        }
      }
    }

    // 3) Ground loot — walk to it (vacuum pickup on arrival)
    if (this.loot.count > 0) {
      const lootHits = this.raycaster.intersectObjects(this.loot.drops.map((d) => d.group), true);
      if (lootHits.length > 0) {
        let o: THREE.Object3D | null = lootHits[0].object;
        while (o && o.parent !== this.scene) o = o.parent;
        if (o) {
          this.player.clearAttackTarget();
          this.player.setTarget(o.position);
          this.showMarker(o.position, 0xffd21f);
          return;
        }
      }
    }

    // 4) Dummies (decor — walk up, no combat)
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

    // 5) Ground move (cancels attack)
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

  private updateHoverCursor(clientX: number, clientY: number): void {
    if (++this.hoverCheck % 3 !== 0) return;
    this.setNdc(clientX, clientY);
    const liveGroups = this.monsters.filter((m) => m.alive).map((m) => m.group);
    const npcMeshes: THREE.Object3D[] = [];
    if (this.shopNpc.visible) npcMeshes.push(this.shopNpc);
    if (this.portalMesh.visible) npcMeshes.push(this.portalMesh);
    if (this.sanctum.visible) npcMeshes.push(this.sanctum);
    const lootMeshes = this.loot.drops.map((d) => d.group);
    const hits = this.raycaster.intersectObjects([...liveGroups, ...npcMeshes, ...lootMeshes, ...this.dummies], true);
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

  private showToast(text: string, ms = 2.6): void {
    if (!this.elToast) return;
    this.elToast.textContent = text;
    this.elToast.style.opacity = '1';
    this.toastTimer = ms;
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
    this.projectiles.fire(
      this.player.position,
      this.tmpVec,
      this.player.attackDamage * FIREBALL_MULT * this.player.fireMult,
      16,
      18,
    );
    this.player.faceInstant(this.tmpVec.clone().add(this.player.position));
    this.player.swingAnim = 1;
    this.fireTimer = FIREBALL_CD;
    this.effects.burst(
      this.player.position.x + this.tmpVec.x,
      1.3,
      this.player.position.z + this.tmpVec.z,
      { color: 0xff9a2e, count: 8, speed: 3, life: 0.35, size: 0.8 },
    );
  }

  private tryPotion(): void {
    if (this.player.drinkPotion()) {
      this.numbers.spawn(this.player.position, `+${Math.round(this.player.maxHp * 0.45)}`, { color: '#5dff6b', scale: 1.4 });
    }
  }

  /** Blink: short-range teleport toward the cursor (or facing). The universal dodge tool. */
  private tryBlink(): void {
    if (!this.started || !this.player.alive || this.blinkTimer > 0) return;
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
    const dist = aim ? Math.min(aim.distanceTo(this.player.position), BLINK_RANGE) : BLINK_RANGE;
    const dest = this.tmpVec.clone().multiplyScalar(dist).add(this.player.position);
    this.effects.burst(this.player.position.x, 1.2, this.player.position.z, { color: 0x7dffd4, count: 10, speed: 3, life: 0.4, size: 0.9 });
    this.resolveTeleport(dest);
    this.player.position.copy(dest);
    this.player.setTarget(dest);
    this.player.faceInstant(this.tmpVec.clone().add(dest));
    this.player.swingAnim = 1;
    this.showMarker(dest, 0x7dffd4);
    this.numbers.spawn(dest, '✨', { color: '#7dffd4', scale: 1.2 });
    this.effects.burst(dest.x, 1.2, dest.z, { color: 0x7dffd4, count: 12, speed: 4, life: 0.45, size: 1 });
    this.blinkTimer = BLINK_CD;
  }

  /** Push a teleport destination out of colliders + world bounds. */
  private resolveTeleport(dest: THREE.Vector3): void {
    dest.y = 0;
    for (const c of this.colliders) {
      const dx = dest.x - c.pos.x;
      const dz = dest.z - c.pos.z;
      const min = 0.5 + c.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          dest.x = c.pos.x + (dx / d) * min;
          dest.z = c.pos.z + (dz / d) * min;
        } else {
          dest.x = c.pos.x + min;
        }
      }
    }
    dest.x = THREE.MathUtils.clamp(dest.x, -29, 29);
    dest.z = THREE.MathUtils.clamp(dest.z, -29, 29);
  }

  /** Direction from player toward cursor (fallback: facing). Null if degenerate. */
  private aimDir(): THREE.Vector3 | null {
    this.tmpVec.set(0, 0, 1).applyQuaternion(this.player.group.quaternion).setY(0);
    const aim = this.groundPointFromScreen(this.lastMouse.x, this.lastMouse.y);
    if (aim) {
      this.tmpVec.copy(aim).sub(this.player.position).setY(0);
      if (this.tmpVec.lengthSq() < 0.25) {
        this.tmpVec.set(0, 0, 1).applyQuaternion(this.player.group.quaternion).setY(0);
      }
    }
    if (this.tmpVec.lengthSq() < 1e-6) return null;
    return this.tmpVec.normalize();
  }

  // ---------- job advancement ----------

  /** One-time hint pointing at the Haven sanctum — advancement itself happens there, never auto-pops. */
  private hintSanctum(): void {
    if (!this.started || this.player.job !== null || this.player.level < ADVANCE_LEVEL || this.sanctumHintShown) return;
    this.sanctumHintShown = true;
    this.showToast('⭐ Job advancement awaits in the golden Sanctum circle in Haven!', 3.5);
  }

  private openJobModal(): void {
    if (!this.elJobModal || !this.elJobCards) return;
    const jobs = jobsFor(this.player.baseClass);
    this.elJobCards.innerHTML = jobs.map((j) => {
      const b = j.bonus;
      const bonusTxt = `+${b.maxHp} HP · +${b.damage} DMG${b.crit > 0 ? ` · +${Math.round(b.crit * 100)}% crit` : ''}`;
      return `<div class="job-card" data-job="${j.id}">
        <div class="job-icon">${j.icon}</div>
        <b>${j.name}</b>
        <div class="dim">${j.desc}</div>
        <div class="job-bonus">${bonusTxt}</div>
        <div class="job-skill">${j.skill.icon} <b>${j.skill.name}</b> (2)<br><span class="dim">${j.skill.desc} ${j.skill.cooldown}s CD</span></div>
      </div>`;
    }).join('');
    this.elJobModal.style.display = 'flex';
  }

  private closeJobModal(): void {
    if (this.elJobModal) this.elJobModal.style.display = 'none';
  }

  private chooseJob(id: string): void {
    const def = jobById(id);
    if (!def || this.player.job !== null) {
      this.closeJobModal();
      return;
    }
    if (def.baseClass !== this.player.baseClass || this.player.level < ADVANCE_LEVEL) {
      this.showToast('You are not eligible for that job.');
      this.closeJobModal();
      return;
    }
    this.player.job = def.id;
    this.player.maxHp += def.bonus.maxHp;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + def.bonus.maxHp);
    this.player.attackDamage += def.bonus.damage;
    this.player.critChance += def.bonus.crit;
    this.closeJobModal();
    this.refreshSkillSlot();
    this.renderChar();
    this.numbers.spawn(this.player.position, `${def.name.toUpperCase()}!`, { color: '#ffd21f', crit: true, scale: 1.8 });
    this.showToast(`${def.icon} Advanced: ${def.name}! Press 2 — ${def.skill.name}.`, 3.5);
    this.autosave();
  }

  /** Sync skill slot 2 with the current job (locked until advancement). */
  private refreshSkillSlot(): void {
    if (!this.elSkill2) return;
    const job = jobById(this.player.job);
    if (job) {
      this.elSkill2.classList.remove('locked');
      this.elSkill2.innerHTML = `${job.skill.icon}<span class="key">2</span><span class="cd-num" id="cdn-skill2"></span><div id="cd-skill2" class="cd"></div>`;
      this.elSkill2.title = `${job.skill.name} (2) — ${job.skill.desc}`;
    } else {
      this.elSkill2.classList.add('locked');
      this.elSkill2.innerHTML = `2<span class="cd-num" id="cdn-skill2"></span><div id="cd-skill2" class="cd"></div>`;
      this.elSkill2.title = 'Reach Lv10 and choose a job in the Haven Sanctum';
    }
    this.elSkill2Cd = document.getElementById('cd-skill2');
    this.elCdnSkill2 = document.getElementById('cdn-skill2');
  }

  private castJobSkill(): void {
    if (!this.started || !this.player.alive || this.skillTimer > 0) return;
    const job = jobById(this.player.job);
    if (!job) {
      if (this.player.level >= ADVANCE_LEVEL) this.showToast('⭐ Visit the golden Sanctum in Haven to advance!');
      else this.showToast('Reach Lv10 and choose a job to unlock this slot.');
      return;
    }
    const dmg = this.player.attackDamage;
    switch (job.skill.id) {
      case 'shield_throw': {
        const dir = this.aimDir();
        if (!dir) return;
        this.projectiles.fire(this.player.position, dir, dmg * 2.6, 18, 20, 0x7cc4ff);
        this.player.faceInstant(dir.clone().add(this.player.position));
        this.player.swingAnim = 1;
        break;
      }
      case 'multishot': {
        const dir = this.aimDir();
        if (!dir) return;
        for (const a of [-0.18, 0, 0.18]) {
          this.projectiles.fire(this.player.position, dir.clone().applyAxisAngle(UP, a), dmg * 1.3, 16, 18, 0x5dff6b);
        }
        this.player.faceInstant(dir.clone().add(this.player.position));
        this.player.swingAnim = 1;
        break;
      }
      case 'whirlwind': {
        this.whirlTimer = 0.4;
        this.player.swingAnim = 1;
        this.showMarker(this.player.position, 0xffd21f);
        this.effects.ring(this.player.position.x, this.player.position.z, 0xffd21f, 4);
        this.hitAllInRadius(this.player.position, 4, dmg * 1.8, 0, 0xffd21f);
        break;
      }
      case 'shadowstrike': {
        const dir = this.aimDir();
        if (!dir) return;
        const dest = dir.clone().multiplyScalar(10).add(this.player.position);
        this.effects.burst(this.player.position.x, 1.2, this.player.position.z, { color: 0x9b5de5, count: 12, speed: 4, life: 0.4, size: 1 });
        this.resolveTeleport(dest);
        this.player.position.copy(dest);
        this.player.setTarget(dest);
        this.player.faceInstant(dir.clone().add(dest));
        this.player.swingAnim = 1;
        this.showMarker(dest, 0x9b5de5);
        this.effects.ring(dest.x, dest.z, 0x9b5de5, 2.6);
        this.hitAllInRadius(dest, 2.6, dmg * 2.6, 0, 0x9b5de5);
        break;
      }
      case 'meteor': {
        const aim = this.groundPointFromScreen(this.lastMouse.x, this.lastMouse.y);
        if (!aim) return;
        this.queueAoe(aim.x, aim.z, 3.5, dmg * 3.2 * this.player.fireMult, 0, 0.7, 0xff6a00, { flash: '#ff8a2e', scorch: true });
        this.player.swingAnim = 1;
        break;
      }
      case 'frost_nova': {
        this.queueAoe(this.player.position.x, this.player.position.z, 4.5, dmg * 1.6, 3, 0.2, 0x9adcff);
        this.player.swingAnim = 1;
        break;
      }
      default:
        return;
    }
    this.skillTimer = job.skill.cooldown;
    this.skillCdMax = job.skill.cooldown;
  }

  /** Melee-style AoE with lifesteal + shared kill handling. Slow in seconds (0 = none). */
  private hitAllInRadius(center: THREE.Vector3, radius: number, damage: number, slow: number, color = 0xffffff): void {
    let hitAny = false;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const dx = m.position.x - center.x;
      const dz = m.position.z - center.z;
      if (dx * dx + dz * dz > radius * radius) continue;
      const roll = rollPlayerDamage(damage, this.player.critChance);
      const died = m.takeDamage(roll.amount, roll.isCrit, this.numbers);
      if (slow > 0) m.applySlow(slow, this.numbers);
      this.healLifesteal(roll.amount);
      this.effects.burst(m.position.x, 1.3, m.position.z, { color, count: 7, speed: 4, life: 0.4, size: 0.9 });
      hitAny = true;
      if (died) {
        this.onMonsterKilled(m);
        if (this.player.attackTarget === m) this.player.clearAttackTarget();
      }
    }
    if (hitAny) {
      this.camShake = Math.min(0.6, this.camShake + 0.2);
      this.updateBossBar();
    }
  }

  private queueAoe(x: number, z: number, radius: number, damage: number, slow: number, delay: number, color: number, opts?: { flash?: string; scorch?: boolean }): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.1, radius - 0.4), radius, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    this.scene.add(mesh);
    this.pendingAoe.push({ x, z, radius, damage, slow, timer: delay, color, flash: opts?.flash ?? null, scorch: opts?.scorch ?? false, mesh });
  }

  private updatePendingAoe(dt: number): void {
    for (let i = this.pendingAoe.length - 1; i >= 0; i--) {
      const a = this.pendingAoe[i];
      a.timer -= dt;
      const mat = a.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.4 + Math.abs(Math.sin(performance.now() * 0.015)) * 0.4;
      if (a.timer > 0) continue;
      this.scene.remove(a.mesh);
      a.mesh.geometry.dispose();
      mat.dispose();
      this.pendingAoe.splice(i, 1);
      // Detonation: shockwave ring, fireball burst, optional scorch + screen flash
      this.effects.ring(a.x, a.z, a.color, a.radius, 0.5);
      this.effects.burst(a.x, 1.0, a.z, { color: a.color, count: 22, speed: 7, life: 0.6, size: 1.2 });
      if (a.scorch) this.effects.scorch(a.x, a.z, a.radius);
      if (a.flash) this.flashScreen(a.flash);
      this.camShake = Math.min(0.9, this.camShake + 0.45);
      this.hitAllInRadius(_aoeVec.set(a.x, 0, a.z), a.radius, a.damage, a.slow, a.color);
    }
  }

  /** Fullscreen color flash (meteor impacts, death, level-up). */
  private flashScreen(color: string, strength = 0.45, time = 0.3): void {
    if (!this.elFlash) return;
    this.elFlash.style.background = color;
    this.elFlash.style.opacity = String(strength);
    this.flashTimer = time;
    this.flashMax = Math.max(0.01, time);
    this.flashStrength = strength;
  }

  private healLifesteal(dealt: number): void {
    if (this.player.lifesteal > 0 && dealt > 0 && this.player.alive) {
      const heal = Math.max(1, Math.floor((dealt * this.player.lifesteal) / 100));
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
    }
  }

  private mitigate(raw: number): number {
    return Math.max(1, Math.round((raw * 100) / (100 + this.player.armor * 6)));
  }

  private damagePlayer(raw: number): boolean {
    if (!this.player.alive) return false;
    const taken = this.mitigate(raw);
    const died = this.player.takeDamage(taken);
    this.numbers.spawn(this.player.position, `${taken}`, { color: '#ff6b6b' });
    this.camShake = Math.min(0.6, this.camShake + 0.25);
    if (died) {
      this.effects.burst(this.player.position.x, 1.2, this.player.position.z, { color: 0xff2222, count: 26, speed: 6, life: 0.7, size: 1.2 });
      this.flashScreen('#7a0000', 0.5, 0.5);
      this.deathTimer = RESPAWN_DELAY;
      if (this.elDeath) this.elDeath.style.display = 'flex';
      this.showToast('You died — a portal drags you back to Haven…');
    }
    return died;
  }

  private onMonsterKilled(m: Monster): void {
    this.kills += 1;
    this.effects.burst(m.position.x, 1.0, m.position.z, m.isBoss
      ? { color: 0xffd21f, count: 30, speed: 7, life: 0.8, size: 1.3 }
      : { color: 0x9b5de5, count: 9, speed: 4, life: 0.45, size: 0.9 });
    const gold = m.isBoss ? randi(60, 120) : randi(2, 5) + m.level;
    this.inventory.gold += gold;
    this.numbers.spawn(m.position, `+${gold}g`, { color: '#ffd479', scale: 1.1 });

    if (m.isBoss) {
      // Guaranteed drop, minimum magic quality.
      const r = Math.random();
      const force = r < 0.06 ? 'legendary' : r < 0.4 ? 'rare' : 'magic';
      this.loot.spawnItem(m.position, generateDrop(this.player.level, 6, force));
      if (Math.random() < 0.5) this.loot.spawnItem(m.position, generateDrop(this.player.level));
      this.loot.spawnItem(m.position, makeTpScroll());
      this.loot.spawnItem(m.position, makeTpScroll());
      this.showToast(`👑 ${m.displayName || 'Boss'} slain! Guaranteed loot — grab the crystals!`, 3.2);
    } else {
      if (Math.random() < 0.09) this.loot.spawnItem(m.position, generateDrop(this.player.level));
      if (Math.random() < 0.05) this.loot.spawnItem(m.position, makeTpScroll());
    }

    const leveled = this.player.gainXp(m.xpValue * this.xpRate);
    if (leveled) {
      this.numbers.spawn(this.player.position, 'LEVEL UP!', { color: '#ffd21f', crit: true, scale: 1.8 });
      this.effects.burst(this.player.position.x, 1.0, this.player.position.z, { color: 0xffd21f, count: 24, speed: 5, life: 0.7, size: 1.1 });
      this.effects.ring(this.player.position.x, this.player.position.z, 0xffd21f, 3.5);
      this.flashScreen('#ffd21f', 0.25, 0.4);
      this.showToast(`Level ${this.player.level}! +3 stat points (C) · Trader restocked · +1 potion`, 3.2);
      this.player.potions = Math.min(5, this.player.potions + 1);
      this.refreshShopStock();
      this.renderShop();
      this.renderChar();
      this.hintSanctum();
    }
    this.updateBossBar();
    this.renderInventory();
    this.autosave();
  }

  private onLootPickup(item: ItemInstance): void {
    if (!this.inventory.add(item)) {
      this.loot.spawnItem(this.player.position, item);
      this.showToast('Inventory full! Press I to manage gear.');
      return;
    }
    this.numbers.spawn(this.player.position, item.name, { color: RARITY_COLOR[item.rarity], scale: 1.15 });
    this.effects.burst(this.player.position.x, 1.2, this.player.position.z, { color: parseInt(RARITY_COLOR[item.rarity].slice(1), 16), count: 8, speed: 3, life: 0.4, size: 0.8 });
    this.showToast(`${item.icon} ${item.name} — press I to equip`);
    this.renderInventory();
  }

  // ---------- shop / inventory / portal ----------

  private itemTooltip(it: ItemInstance): string {
    if (it.kind === 'consumable') {
      return `${it.icon} ${it.name}\nClick: teleport to Haven (consumed on use)\nSell: ${sellPrice(it)}g`;
    }    const lines = [
      `${it.icon} ${it.name} (Lv${it.levelReq})`,
      it.dmg > 0 ? `Damage: ${it.dmg}` : '',
      it.armor > 0 ? `Armor: ${it.armor}` : '',
      ...it.affixes.map((a) => affixLabel(a)),
      `Sell: ${sellPrice(it)}g`,
    ].filter((l) => l.length > 0);
    return lines.join('\n');
  }

  private toggleInventory(force?: boolean): void {
    this.invOpen = force ?? !this.invOpen;
    this.renderInventory();
  }

  private openShop(): void {
    this.shopOpen = true;
    this.invOpen = true; // selling needs the bag visible
    this.renderShop();
    this.renderInventory();
  }

  private closeShop(): void {
    this.shopOpen = false;
    this.renderShop();
  }

  private openPortal(): void {
    this.portalOpen = true;
    this.renderPortal();
  }

  private closePortal(): void {
    this.portalOpen = false;
    this.renderPortal();
  }

  private closeAllPanels(): void {
    this.invOpen = false;
    this.shopOpen = false;
    this.portalOpen = false;
    this.charOpen = false;
    this.closeJobModal();
    this.hideCompare();
    this.renderInventory();
    this.renderShop();
    this.renderPortal();
    this.renderChar();
  }

  // ---------- character panel ----------

  private toggleChar(force?: boolean): void {
    this.charOpen = force ?? !this.charOpen;
    this.renderChar();
  }

  private jobLine(): string {
    const j = jobById(this.player.job);
    if (j) return `<div class="dim">${j.icon} ${j.name} · ${j.skill.icon} ${j.skill.name} (2)</div>`;
    if (this.player.level >= ADVANCE_LEVEL) {
      return `<div class="dim">⭐ Step into the golden Sanctum in Haven</div>`;
    }
    return `<div class="dim">Job advancement at Lv${ADVANCE_LEVEL}</div>`;
  }

  private renderChar(): void {
    if (this.elCharPanel) this.elCharPanel.style.display = this.charOpen ? 'block' : 'none';
    if (!this.charOpen || !this.elCharBody) return;
    const p = this.player;
    const cls = CLASSES[p.baseClass];
    const attrRow = (key: keyof Attrs, label: string, effect: string): string => {
      const v = p.attrs()[key];
      return `<div class="attr-row"><span><b>${label}</b> ${v}</span>` +
        `<span class="dim">${effect}</span>` +
        `<button data-alloc="${key}" ${p.statPoints > 0 ? '' : 'disabled'}>+</button></div>`;
    };
    this.elCharBody.innerHTML =
      `<div class="char-head">${cls.icon} <b>${p.charName}</b> <span class="dim">${cls.name} · Lv${p.level}</span></div>` +
      this.jobLine() +
      `<div class="dim" id="char-xp">XP ${Math.floor(p.xp)}/${p.xpNext} · x${this.xpRate} EXP rate</div>` +
      `<div class="stat-points" id="char-points">⭐ ${p.statPoints} stat point${p.statPoints === 1 ? '' : 's'} — +3 per level</div>` +
      attrRow('str', 'STR', '+1 DMG / 2') +
      attrRow('dex', 'DEX', '+0.5% crit each') +
      attrRow('int', 'INT', '+3% fireball each') +
      attrRow('vit', 'VIT', '+6 HP each') +
      `<div class="derived" id="char-derived">DMG ${p.attackDamage} · Armor ${p.armor}<br>` +
      `HP ${p.hp}/${p.maxHp} · Crit ${Math.round(p.critChance * 100)}%<br>` +
      `Lifesteal ${p.lifesteal}% · Fire x${p.fireMult.toFixed(2)}</div>`;
  }

  /**
   * Cheap live refresh of the open char panel — text nodes only, never rebuilds
   * the + buttons. Full innerHTML rebuilds at 10Hz were destroying buttons
   * mid-click and eating most clicks.
   */
  private refreshCharLive(): void {
    if (!this.charOpen || !this.elCharBody) return;
    const p = this.player;
    const xp = this.elCharBody.querySelector('#char-xp');
    if (xp) xp.textContent = `XP ${Math.floor(p.xp)}/${p.xpNext} · x${this.xpRate} EXP rate`;
    const pts = this.elCharBody.querySelector('#char-points');
    if (pts) pts.textContent = `⭐ ${p.statPoints} stat point${p.statPoints === 1 ? '' : 's'} — +3 per level`;
    const der = this.elCharBody.querySelector('#char-derived');
    if (der) {
      der.innerHTML =
        `DMG ${p.attackDamage} · Armor ${p.armor}<br>` +
        `HP ${p.hp}/${p.maxHp} · Crit ${Math.round(p.critChance * 100)}%<br>` +
        `Lifesteal ${p.lifesteal}% · Fire x${p.fireMult.toFixed(2)}`;
    }
  }

  // ---------- item compare ----------

  private showCompare(item: ItemInstance): void {
    if (!this.elCompare) return;
    if (item.kind === 'consumable') {
      this.elCompare.innerHTML =
        `<b>${item.icon} ${item.name}</b>` +
        `<div class="dim">Click in bag: teleport to Haven.<br>Consumed on use · sells for ${sellPrice(item)}g.</div>`;
      this.elCompare.style.display = 'block';
      return;
    }
    const eq = this.equipment.slots[item.slot];
    const a = itemStats(item);
    const b = eq ? itemStats(eq) : { dmg: 0, armor: 0, hp: 0, crit: 0, lifesteal: 0 };
    const row = (label: string, av: number, bv: number, suffix = ''): string => {
      const d = av - bv;
      const cls = d > 0 ? 'better' : d < 0 ? 'worse' : '';
      const diff = d !== 0 ? ` <span class="${cls}">(${d > 0 ? '+' : ''}${d}${suffix})</span>` : '';
      return `<div class="cmp-row"><span>${label}</span><b class="${cls}">${av}${suffix}</b><span class="dim">eq ${bv}${suffix}</span>${diff}</div>`;
    };
    const reqWarn = this.player.level < item.levelReq
      ? `<div class="worse">Requires Lv${item.levelReq}</div>` : '';
    this.elCompare.innerHTML =
      `<b style="color:${RARITY_COLOR[item.rarity]}">${item.icon} ${item.name}</b>` +
      `<div class="dim">vs ${eq ? `${eq.icon} ${eq.name}` : '— nothing equipped —'}</div>` +
      reqWarn +
      row('Damage', a.dmg, b.dmg) +
      row('Armor', a.armor, b.armor) +
      row('Max HP', a.hp, b.hp) +
      row('Crit %', a.crit, b.crit) +
      row('Lifesteal %', a.lifesteal, b.lifesteal);
    this.elCompare.style.display = 'block';
  }

  private hideCompare(): void {
    this.compareUid = null;
    if (this.elCompare) this.elCompare.style.display = 'none';
  }

  // ---------- town portal scrolls ----------

  /** Consume one scroll from the bag and teleport to Haven. */
  private useScroll(uid: string): void {
    const it = this.inventory.find(uid);
    if (!it || it.kind !== 'consumable') return;
    if (!this.player.alive) return;
    if (this.currentZoneId === 'city') {
      this.showToast('Already in Haven — no need for a scroll.');
      return;
    }
    this.inventory.remove(uid);
    this.hideCompare();
    this.renderInventory();
    if (this.elFade) this.elFade.style.opacity = '1';
    window.setTimeout(() => {
      this.loadZone('city');
      this.snapCamera();
      if (this.elFade) this.elFade.style.opacity = '0';
      this.showToast('🌀 Town portal! Back in Haven.');
    }, 300);
  }

  private buyScroll(): void {
    const price = 20;
    if (this.inventory.gold < price) {
      this.showToast('Not enough gold (20g).');
      return;
    }
    const scroll = makeTpScroll();
    if (!this.inventory.add(scroll)) {
      this.showToast('Inventory full!');
      return;
    }
    this.inventory.gold -= price;
    this.renderShop();
    this.renderInventory();
  }

  private renderInventory(): void {
    if (this.elInvPanel) this.elInvPanel.style.display = this.invOpen ? 'block' : 'none';
    if (!this.invOpen) return;
    if (this.elInvGold) this.elInvGold.textContent = `${this.inventory.gold}g`;
    if (this.elGearStats) {
      this.elGearStats.textContent =
        `DMG ${this.player.attackDamage} · Armor ${this.player.armor} · ` +
        `HP ${this.player.hp}/${this.player.maxHp} · Crit ${Math.round(this.player.critChance * 100)}% · ` +
        `LS ${this.player.lifesteal}%`;
    }
    if (this.elEquipRow) {
      const order: ItemSlot[] = ['weapon', 'helm', 'chest', 'boots', 'ring'];
      this.elEquipRow.innerHTML = order.map((slot) => {
        const it = this.equipment.slots[slot];
        return it
          ? `<div class="equip-slot r-${it.rarity}" data-slot="${slot}" title="${this.itemTooltip(it)}">${it.icon}<span>${slot}</span></div>`
          : `<div class="equip-slot empty" data-slot="${slot}">+<span>${slot}</span></div>`;
      }).join('');
    }
    if (this.elInvGrid) {
      this.elInvGrid.innerHTML = this.inventory.slots.map((it) => {
        if (!it) return '<div class="inv-cell empty"></div>';
        const usable = this.player.level >= it.levelReq;
        const tag = this.shopOpen
          ? `<i>+${sellPrice(it)}g</i>`
          : it.kind === 'consumable' ? '<i>use</i>' : '';
        return `<div class="inv-cell r-${it.rarity}${usable ? '' : ' unusable'}" data-uid="${it.uid}" title="${this.itemTooltip(it)}">${it.icon}${tag}</div>`;
      }).join('');
    }
  }

  private renderShop(): void {
    if (this.elShopPanel) this.elShopPanel.style.display = this.shopOpen ? 'block' : 'none';
    if (!this.shopOpen) return;
    if (this.elShopGold) this.elShopGold.textContent = `${this.inventory.gold}g`;
    if (this.elShopStock) {
      const scrollRow = `<div class="shop-row">
          <div class="shop-icon r-magic">📜</div>
          <div class="shop-info"><b style="color:${RARITY_COLOR.magic}">Scroll of Town Portal</b>
          <div class="dim">Teleport to Haven · consumed on use</div></div>
          <button data-buyscroll="1">20g</button>
        </div>`;
      this.elShopStock.innerHTML = scrollRow + this.shopStock.map((it) => {
        const stats = [
          it.dmg > 0 ? `${it.dmg} dmg` : '',
          it.armor > 0 ? `${it.armor} arm` : '',
          ...it.affixes.map((a) => affixLabel(a)),
        ].filter((s) => s.length > 0).join(' · ');
        const afford = this.inventory.gold >= it.value;
        const req = this.player.level >= it.levelReq;
        return `<div class="shop-row">
          <div class="shop-icon r-${it.rarity}">${it.icon}</div>
          <div class="shop-info"><b style="color:${RARITY_COLOR[it.rarity]}">${it.name}</b>
          <div class="dim">${stats} · Lv${it.levelReq}</div></div>
          <button data-buy="${it.uid}" ${afford && req ? '' : 'disabled'}>${it.value}g</button>
        </div>`;
      }).join('');
    }
  }

  private renderPortal(): void {
    if (this.elPortalPanel) this.elPortalPanel.style.display = this.portalOpen ? 'block' : 'none';
    if (!this.portalOpen || !this.elPortalList) return;
    this.elPortalList.innerHTML = ZONES.map((z) => {
      const locked = this.player.level < z.minLevel;
      const current = z.id === this.currentZoneId;
      return `<div class="portal-card${locked ? ' locked' : ''}${current ? ' current' : ''}" data-travel="${z.id}">
        <b>${z.name}</b><div class="dim">${z.sub}</div>
        <div class="dim">${locked ? `🔒 Requires Lv${z.minLevel}` : current ? '● here' : 'Enter →'}</div>
      </div>`;
    }).join('');
  }

  private buyStock(uid: string): void {
    const idx = this.shopStock.findIndex((s) => s.uid === uid);
    if (idx === -1) return;
    const it = this.shopStock[idx];
    if (this.player.level < it.levelReq) {
      this.showToast(`Requires Lv${it.levelReq}.`);
      return;
    }
    if (this.inventory.gold < it.value) {
      this.showToast('Not enough gold.');
      return;
    }
    if (!this.inventory.add(it)) {
      this.showToast('Inventory full! (sell something first)');
      return;
    }
    this.inventory.gold -= it.value;
    this.shopStock.splice(idx, 1);
    this.numbers.spawn(this.player.position, it.name, { color: RARITY_COLOR[it.rarity], scale: 1.15 });
    this.renderShop();
    this.renderInventory();
  }

  private sellItem(uid: string): void {
    const it = this.inventory.remove(uid);
    if (!it) return;
    // Never sell equipped-by-accident: only bag items reach here.
    const price = sellPrice(it);
    this.inventory.gold += price;
    this.showToast(`Sold ${it.name} +${price}g`);
    this.renderShop();
    this.renderInventory();
  }

  private equipItem(uid: string): void {
    const it = this.inventory.find(uid);
    if (!it) return;
    if (this.player.level < it.levelReq) {
      this.showToast(`${it.name} requires Lv${it.levelReq}.`);
      return;
    }
    this.inventory.remove(uid);
    const prev = this.equipment.equip(it);
    // Always succeeds: removing the equipped item just freed exactly one bag slot.
    if (prev) this.inventory.add(prev);
    this.refreshGear();
    this.showToast(`Equipped ${it.icon} ${it.name}`);
    this.renderInventory();
  }

  private unequipItem(slot: ItemSlot): void {
    const it = this.equipment.unequip(slot);
    if (!it) return;
    if (!this.inventory.add(it)) {
      this.equipment.equip(it);
      this.showToast('Inventory full!');
      return;
    }
    this.refreshGear();
    this.renderInventory();
  }

  private travelTo(id: string): void {
    const def = zoneById(id);
    if (this.player.level < def.minLevel) {
      this.showToast(`🔒 ${def.name} requires Lv${def.minLevel}. (You: ${this.player.level})`);
      return;
    }
    if (id === this.currentZoneId) {
      this.closePortal();
      return;
    }
    if (this.elFade) this.elFade.style.opacity = '1';
    window.setTimeout(() => {
      this.loadZone(id);
      this.snapCamera();
      if (this.elFade) this.elFade.style.opacity = '0';
    }, 280);
  }

  private nearestInteract(): 'shop' | 'portal' | 'sanctum' | null {
    if (this.currentZoneId !== 'city' || !this.player.alive) return null;
    if (this.shopNpc.visible && this.player.position.distanceTo(this.shopNpc.position) < INTERACT_RADIUS) return 'shop';
    if (this.portalMesh.visible && this.player.position.distanceTo(this.portalMesh.position) < INTERACT_RADIUS) return 'portal';
    if (this.sanctum.visible && this.player.position.distanceTo(this.sanctum.position) < 2.9) return 'sanctum';
    return null;
  }

  private interact(): void {
    const kind = this.nearestInteract();
    if (kind === 'shop') this.openShop();
    else if (kind === 'portal') this.openPortal();
    else if (kind === 'sanctum') this.trySanctum();
  }

  /** Advancement only happens inside the Haven sanctum circle. */
  private trySanctum(): void {
    if (this.player.job !== null) {
      this.showToast('Your path is already chosen.');
      return;
    }
    if (this.player.level < ADVANCE_LEVEL) {
      this.showToast(`The Sanctum awakens at Lv${ADVANCE_LEVEL} (you: ${this.player.level}).`);
      return;
    }
    this.openJobModal();
  }

  private updateBossBar(): void {
    const boss = this.monsters.find((m) => m.isBoss);
    const show = !!boss && this.currentZoneId !== 'city';
    if (this.elBossBar) this.elBossBar.style.display = show ? 'block' : 'none';
    if (!show || !boss) return;
    if (this.elBossName) this.elBossName.textContent = `👑 ${boss.displayName || 'Boss'} Lv${boss.level}`;
    if (this.elBossFill) {
      const frac = (boss.hp / boss.maxHp) * 100;
      this.elBossFill.style.width = `${frac.toFixed(1)}%`;
    }
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

    // Behind the character-select overlay: render the city, simulate nothing.
    if (!this.started) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.playtime += dt;
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.blinkTimer = Math.max(0, this.blinkTimer - dt);
    this.skillTimer = Math.max(0, this.skillTimer - dt);
    this.camShake = Math.max(0, this.camShake - dt * 1.6);

    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = AUTOSAVE_SEC;
      this.autosave();
    }

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

    // Whirlwind spin visual + trailing sparks
    if (this.whirlTimer > 0) {
      this.whirlTimer -= dt;
      this.player.group.rotation.y += dt * 18;
      this.effects.burst(this.player.position.x, 1.1, this.player.position.z, { color: 0xffd21f, count: 2, speed: 5, life: 0.35, size: 0.9 });
    }

    // Monsters + incoming damage
    for (const m of this.monsters) {
      const dmg = m.update(dt, this.player.position, this.player.alive, this.statics, this.monsters);
      if (dmg > 0 && this.player.alive) this.damagePlayer(dmg);
    }

    // Boss extras: telegraphed slams + summons
    for (const b of this.bossCtrls) {
      const slam = b.update(dt, this.player.position, this.player.alive);
      if (slam > 0 && this.player.alive) {
        this.damagePlayer(slam);
        this.camShake = Math.min(0.9, this.camShake + 0.5);
        this.showToast('💥 Boss slam! Move out of the red ring!');
      }
      if (b.consumeSummon()) {
        this.spawnMinion(b.boss.position.x + 2.5, b.boss.position.z + 2.5, b.boss.level - 1);
        this.spawnMinion(b.boss.position.x - 2.5, b.boss.position.z - 2.5, b.boss.level - 1);
        this.showToast('The boss calls for aid!', 2);
      }
    }

    // Player death / respawn in Haven with a gold penalty
    if (!this.player.alive) {
      this.deathTimer -= dt;
      if (this.elDeathSub) this.elDeathSub.textContent = `Respawn in ${Math.max(0, this.deathTimer).toFixed(1)}s`;
      if (this.deathTimer <= 0) {
        const penalty = Math.floor(this.inventory.gold * 0.05);
        this.inventory.gold -= penalty;
        this.loadZone('city');
        const city = zoneById('city');
        this.player.respawn(new THREE.Vector3(city.spawn[0], 0, city.spawn[1]));
        if (this.elDeath) this.elDeath.style.display = 'none';
        this.showToast(`Revived in Haven. (lost ${penalty}g — 5%) Use Q to heal!`);
        this.snapCamera();
        this.autosave();
        this.renderInventory();
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
        this.healLifesteal(roll.amount);
        this.effects.burst(target.position.x, 1.4, target.position.z, { color: 0xfff2b0, count: 5, speed: 3, life: 0.3, size: 0.7 });
        if (died) {
          this.onMonsterKilled(target);
          this.player.clearAttackTarget();
        }
        this.updateBossBar();
      }
    }

    // Projectiles + delayed blasts + loot + floaters
    this.updatePendingAoe(dt);
    this.projectiles.update(
      dt,
      this.monsters,
      this.numbers,
      (m) => {
        this.onMonsterKilled(m);
        if (this.player.attackTarget === m) this.player.clearAttackTarget();
        this.updateBossBar();
      },
      (dealt, m, color) => {
        this.healLifesteal(dealt);
        this.effects.burst(m.position.x, 1.4, m.position.z, { color, count: 10, speed: 4, life: 0.4, size: 0.9 });
      },
    );
    this.loot.update(dt, this.player.position, (item) => this.onLootPickup(item));
    this.numbers.update(dt);
    this.effects.update(dt);
    // Sanctum idle sparkles (gold dust drifting up)
    this.sanctumFx -= dt;
    if (this.sanctumFx <= 0) {
      this.sanctumFx = 0.3;
      if (this.sanctum.visible) {
        this.effects.burst(this.sanctum.position.x, 0.4, this.sanctum.position.z, { color: 0xffd21f, count: 2, speed: 1.2, life: 0.9, size: 0.7, gravity: -1 });
      }
    }

    // Walked away from the trader/portal? Close their panels.
    if (this.shopOpen && this.shopNpc.visible &&
      this.player.position.distanceTo(this.shopNpc.position) > 4.5) this.closeShop();
    if (this.portalOpen && this.portalMesh.visible &&
      this.player.position.distanceTo(this.portalMesh.position) > 4.5) this.closePortal();

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

    // Screen flash decay (meteor, death, level-up)
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.elFlash) {
        this.elFlash.style.opacity = String(Math.max(0, this.flashTimer / this.flashMax) * this.flashStrength);
      }
    }

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

    this.updateHud();
    this.renderer.render(this.scene, this.camera);
  }

  private updateHud(): void {
    if (this.elFireCd) {
      const frac = this.fireTimer / FIREBALL_CD;
      this.elFireCd.style.height = `${Math.round(frac * 100)}%`;
    }
    if (this.elBlinkCd) {
      const frac = this.blinkTimer / BLINK_CD;
      this.elBlinkCd.style.height = `${Math.round(frac * 100)}%`;
    }
    if (this.elSkill2Cd) {
      const frac = this.skillTimer / this.skillCdMax;
      this.elSkill2Cd.style.height = `${Math.round(frac * 100)}%`;
    }
    if (this.elCdnFire) this.elCdnFire.textContent = this.fireTimer > 0.05 ? `${Math.ceil(this.fireTimer)}` : '';
    if (this.elCdnBlink) this.elCdnBlink.textContent = this.blinkTimer > 0.05 ? `${Math.ceil(this.blinkTimer)}` : '';
    if (this.elCdnSkill2) this.elCdnSkill2.textContent = this.skillTimer > 0.05 ? `${Math.ceil(this.skillTimer)}` : '';

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
    if (this.elXpRate) this.elXpRate.textContent = `x${this.xpRate}`;
    if (this.elGold) this.elGold.textContent = `${this.inventory.gold}g`;
    if (this.elZone) this.elZone.textContent = zoneById(this.currentZoneId).name;
    if (this.elPotion) {
      const q = this.player.potionCooldown > 0 ? ` (${this.player.potionCooldown.toFixed(0)}s)` : '';
      this.elPotion.innerHTML = `Q<span class="sub">x${this.player.potions}${q}</span>`;
      this.elPotion.classList.toggle('locked', this.player.potions <= 0);
    }
    const near = this.nearestInteract();
    if (this.elPrompt) {
      if (near === 'shop') {
        this.elPrompt.textContent = 'F — Trade';
        this.elPrompt.style.opacity = '1';
      } else if (near === 'portal') {
        this.elPrompt.textContent = 'F — Travel';
        this.elPrompt.style.opacity = '1';
      } else if (near === 'sanctum') {
        const ready = this.player.job === null && this.player.level >= ADVANCE_LEVEL;
        this.elPrompt.textContent = ready ? 'F — Advance job ⭐' : 'F — Sanctum (Lv10)';
        this.elPrompt.style.opacity = '1';
      } else {
        this.elPrompt.style.opacity = '0';
      }
    }
    if (this.charOpen) this.refreshCharLive();
    this.drawMinimap();
    this.updateBossBar();
  }

  /** Full-zone minimap: obstacles, loot, NPCs, monsters — live boss pulses with a crown. */
  private drawMinimap(): void {
    const ctx = this.mmCtx;
    const canvas = this.minimap;
    if (!ctx || !canvas || !this.started) return;
    const S = canvas.width;
    const toMap = (x: number, z: number): [number, number] => [
      ((x + 30) / 60) * S,
      ((z + 30) / 60) * S,
    ];

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(8, 12, 20, 0.85)';
    ctx.fillRect(0, 0, S, S);

    // Obstacles
    ctx.fillStyle = 'rgba(130, 140, 150, 0.55)';
    for (const c of this.statics) {
      const [mx, mz] = toMap(c.pos.x, c.pos.z);
      ctx.beginPath();
      ctx.arc(mx, mz, Math.max(1.5, c.radius * (S / 60)), 0, Math.PI * 2);
      ctx.fill();
    }
    // Loot crystals
    ctx.fillStyle = '#ffd21f';
    for (const d of this.loot.drops) {
      const [mx, mz] = toMap(d.group.position.x, d.group.position.z);
      ctx.fillRect(mx - 1.5, mz - 1.5, 3, 3);
    }
    // Trader (green square) + portal (cyan diamond)
    if (this.shopNpc.visible) {
      const [mx, mz] = toMap(this.shopNpc.position.x, this.shopNpc.position.z);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(mx - 3, mz - 3, 6, 6);
    }
    if (this.portalMesh.visible) {
      const [mx, mz] = toMap(this.portalMesh.position.x, this.portalMesh.position.z);
      ctx.fillStyle = '#5da9ff';
      ctx.beginPath();
      ctx.moveTo(mx, mz - 4);
      ctx.lineTo(mx + 4, mz);
      ctx.lineTo(mx, mz + 4);
      ctx.lineTo(mx - 4, mz);
      ctx.closePath();
      ctx.fill();
    }
    // Trash monsters
    ctx.fillStyle = '#c07bff';
    for (const m of this.monsters) {
      if (!m.alive || m.isBoss) continue;
      const [mx, mz] = toMap(m.position.x, m.position.z);
      ctx.beginPath();
      ctx.arc(mx, mz, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Boss: pulsing red marker + crown (drawn last, on top)
    const t = performance.now() / 300;
    for (const m of this.monsters) {
      if (!m.alive || !m.isBoss) continue;
      const [mx, mz] = toMap(m.position.x, m.position.z);
      ctx.fillStyle = 'rgba(255, 60, 60, 0.35)';
      ctx.beginPath();
      ctx.arc(mx, mz, 8 + Math.sin(t) * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff3b3b';
      ctx.beginPath();
      ctx.arc(mx, mz, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('👑', mx, mz - 5);
    }
    // Player arrow (rotates with facing)
    const [px, pz] = toMap(this.player.position.x, this.player.position.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(Math.PI - this.player.group.rotation.y);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 212, 121, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, S - 2, S - 2);
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
