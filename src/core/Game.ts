import * as THREE from 'three';
import { Player, DODGE_CD } from '../entities/Player';
import { Monster } from '../entities/Monster';
import { BossController } from '../entities/Boss';
import { DamageNumbers } from '../entities/DamageNumbers';
import { SoundManager } from '../audio/Sound';
import { Effects } from '../entities/Effects';
import { ProjectilePool } from '../entities/ProjectilePool';
import { rollPlayerDamage, xpNeed } from '../combat/Stats';
import { createTerrain } from '../world/Terrain';
import { ZONES, zoneById, type ZoneDef } from '../world/Zones';
import { LootManager, PICKUP_DELAY } from '../world/Loot';
import { Inventory, Equipment } from '../items/Inventory';
import {
  generateDrop,
  generateShopStock,
  starterKit,
  gearBonus,
  sellPrice,
  makeTpScroll,
  RARITY_COLOR,
  type ItemInstance,
  type ItemSlot,
  type GearBonus,
} from '../items/Items';
import { CLASSES, CLASS_IDS, type StarterClass, type Attrs } from '../data/Classes';
import { jobsFor, jobById, ADVANCE_LEVEL, ULT_LEVEL } from '../data/Jobs';
import { listChars, saveChar, deleteChar, makeCharId, SAVE_VERSION, loadSharedStash, saveSharedStash, type CharacterSave } from './SaveManager';
import { getBinds, setBind, codeLabel, BIND_LABELS, type BindAction } from './Keybinds';
import { StateMachine, GameState } from './StateMachine';
import { compareHtml } from '../ui/compare';
import { gearStatsText, equipRowHtml, invGridHtml } from '../ui/inventory';
import { shopStockHtml } from '../ui/shop';
import { portalListHtml } from '../ui/portal';
import { jobLineHtml, charBodyHtml, derivedHtml, charXpText, charPointsText, type CharSnapshot } from '../ui/character';
import { stashGridHtml } from '../ui/stash';
import { controlsListHtml } from '../ui/controls';
import { charListHtml } from '../ui/charlist';
import { cdHeight, cdNum, stateText, barPct, potionHtml, tpScrollCount, promptFor } from '../ui/hud';

const CAM_FOV = 38;
const CAM_MIN = 10;
const CAM_MAX = 40;
const CAM_DIR = new THREE.Vector3(0, 18, 12).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const _aoeVec = new THREE.Vector3();

const FIREBALL_CD = 3;
const FIREBALL_MULT = 2.1;
const FIREBALL_COST = 8;
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
  sfx: string | null;
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
  private sound = new SoundManager();
  private inventory = new Inventory();
  private equipment = new Equipment();
  /** Account-wide shared stash (separate localStorage key, all heroes). */
  private stash = new Inventory();
  private prevGear: GearBonus = { damage: 0, maxHp: 0, armor: 0, crit: 0, lifesteal: 0 };

  private shopNpc!: THREE.Group;
  private portalMesh!: THREE.Group;
  private sanctum!: THREE.Group;
  private chest!: THREE.Group;
  private fountain!: THREE.Group;
  private fountainWater!: THREE.MeshStandardMaterial;
  private fountainFxT = 0;
  private paused = false;
  private stashOpen = false;
  private rebindAction: BindAction | null = null;
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
  /** Item uid the player explicitly clicked to pick up (sticky until grabbed/gone/zone change). */
  private pickupUid: string | null = null;
  /** True while a town-portal fade is in flight (blocks double-taps). */
  private tpBusy = false;
  private pendingClass: StarterClass = 'warrior';
  private pendingRate = 1;
  private xpRate = 1;

  private kills = 0;
  private playtime = 0;
  /** Telemetry anchors (§11): playtime snapshot at current level start + zone enter. */
  private levelStartPlaytime = 0;
  private zoneEnterPlaytime = 0;
  private autosaveTimer = AUTOSAVE_SEC;
  private fireTimer = 0;
  private blinkTimer = 0;
  private skillTimer = 0;
  private skillCdMax = 1;
  private skill3Timer = 0;
  private skill3CdMax = 1;
  private ultHintShown = false;
  private buffFxAcc = 0;
  private whirlTimer = 0;
  /** Whirlwind: time to next damage spin + damage per spin (stored at cast). */
  private whirlTick = 0;
  private whirlDmg = 0;
  /** Persistent orbital flame bands + fire light (Diablo-style swirl, toggled per spin). */
  private whirlFx!: THREE.Group;
  private whirlBands: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private whirlLight!: THREE.PointLight;
  private whirlFade = 0;
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
  private elMpFill: HTMLElement | null = null;
  private elMpText: HTMLElement | null = null;
  private elXpFill: HTMLElement | null = null;
  private elLevel: HTMLElement | null = null;
  private elKills: HTMLElement | null = null;
  private elGold: HTMLElement | null = null;
  private elZone: HTMLElement | null = null;
  private elSaveState: HTMLElement | null = null;
  private elFireCd: HTMLElement | null = null;
  private elBlinkCd: HTMLElement | null = null;
  private elDodgeCd: HTMLElement | null = null;
  private elPotion: HTMLElement | null = null;
  private elTpSlot: HTMLElement | null = null;
  private elTpCount: HTMLElement | null = null;
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
  private elPause: HTMLElement | null = null;
  private elControlsList: HTMLElement | null = null;
  private elStashPanel: HTMLElement | null = null;
  private elStashGrid: HTMLElement | null = null;
  private elJobModal: HTMLElement | null = null;
  private elJobCards: HTMLElement | null = null;
  private elSkill2: HTMLElement | null = null;
  private elSkill2Cd: HTMLElement | null = null;
  private elSkill3: HTMLElement | null = null;
  private elSkill3Cd: HTMLElement | null = null;
  private elCdnSkill3: HTMLElement | null = null;
  private elCdnFire: HTMLElement | null = null;
  private elCdnBlink: HTMLElement | null = null;
  private elCdnDodge: HTMLElement | null = null;
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
    this.setupWhirlwind();
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
    this.projectiles = new ProjectilePool(this.scene, 24);
    this.loot = new LootManager(this.scene);
    this.stash.fromJSON(loadSharedStash(), 0);
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

    // Shared stash chest (Haven)
    const chest = new THREE.Group();
    const cbody = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.8 }),
    );
    cbody.position.y = 0.4;
    cbody.castShadow = true;
    const clid = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.25, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 }),
    );
    clid.position.y = 0.9;
    clid.castShadow = true;
    const ctrim = new THREE.Mesh(
      new THREE.BoxGeometry(1.28, 0.12, 0.88),
      new THREE.MeshStandardMaterial({ color: 0xd4a017, emissive: 0x6b4a00, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.6 }),
    );
    ctrim.position.y = 0.72;
    const chlabel = this.makeLabel('📦 STASH');
    chlabel.position.y = 2.2;
    chest.add(cbody, clid, ctrim, chlabel);
    chest.userData.interact = 'stash';
    this.scene.add(chest);
    this.chest = chest;

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

    // Healing fountain (Haven): stand close to regenerate HP + mana
    const fountain = new THREE.Group();
    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.3, 0.7, 16),
      new THREE.MeshStandardMaterial({ color: 0x8a93a3, roughness: 0.8 }),
    );
    basin.position.y = 0.35;
    basin.castShadow = true;
    this.fountainWater = new THREE.MeshStandardMaterial({
      color: 0x3fc9ff, emissive: 0x1a7fd6, emissiveIntensity: 0.8,
      transparent: true, opacity: 0.85, roughness: 0.2,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), this.fountainWater);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.72;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.24, 1.0, 10),
      new THREE.MeshStandardMaterial({ color: 0x8a93a3, roughness: 0.8 }),
    );
    pillar.position.y = 1.0;
    pillar.castShadow = true;
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x9ae6ff, emissive: 0x3fc9ff, emissiveIntensity: 1.4, roughness: 0.2 }),
    );
    orb.position.y = 1.65;
    const flabel = this.makeLabel('⛲ FOUNTAIN');
    flabel.position.y = 2.7;
    fountain.add(basin, water, pillar, orb, flabel);
    this.scene.add(fountain);
    this.fountain = fountain;
  }

  private rebuildColliders(): void {
    const extra: { pos: THREE.Vector3; radius: number }[] = [];
    if (this.shopNpc.visible) extra.push({ pos: this.shopNpc.position, radius: 0.9 });
    if (this.portalMesh.visible) extra.push({ pos: this.portalMesh.position, radius: 1.1 });
    if (this.chest.visible) extra.push({ pos: this.chest.position, radius: 0.9 });
    if (this.fountain.visible) extra.push({ pos: this.fountain.position, radius: 1.2 });
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

  /** Diablo-style whirlwind swirl: 3 stacked orbital flame bands + fire light. Built once, faded in/out per spin. */
  private setupWhirlwind(): void {
    const g = new THREE.Group();
    const defs = [
      { r: 2.2, tube: 0.3, arc: Math.PI * 1.5, color: 0xff5a00, y: 0.55, opacity: 0.8 },
      { r: 1.75, tube: 0.24, arc: Math.PI * 1.2, color: 0xff9a2e, y: 1.0, opacity: 0.9 },
      { r: 1.3, tube: 0.18, arc: Math.PI, color: 0xffd76a, y: 1.45, opacity: 0.95 },
    ];
    for (const d of defs) {
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(d.r, d.tube, 10, 42, d.arc),
        new THREE.MeshBasicMaterial({
          color: d.color,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.random() * Math.PI * 2;
      mesh.position.y = d.y;
      mesh.userData.baseOpacity = d.opacity;
      mesh.visible = true;
      g.add(mesh);
      this.whirlBands.push(mesh);
    }
    this.whirlLight = new THREE.PointLight(0xff8a2e, 0, 10, 2);
    this.whirlLight.position.y = 1.5;
    g.add(this.whirlLight);
    g.visible = false;
    this.scene.add(g);
    this.whirlFx = g;
  }

  private cacheHud(): void {
    const $ = (s: string) => document.getElementById(s);
    this.elPos = $('stat-pos');
    this.elState = $('stat-state');
    this.elFps = $('stat-fps');
    this.elHpFill = $('hp-fill');
    this.elHpText = $('hp-text');
    this.elMpFill = $('mp-fill');
    this.elMpText = $('mp-text');
    this.elXpFill = $('xp-fill');
    this.elLevel = $('stat-level');
    this.elKills = $('stat-kills');
    this.elGold = $('stat-gold');
    this.elZone = $('stat-zone');
    this.elSaveState = $('stat-save');
    this.elFireCd = $('cd-fire');
    this.elBlinkCd = $('cd-blink');
    this.elDodgeCd = $('cd-dodge');
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
    this.elPause = $('pause-overlay');
    this.elControlsList = $('controls-list');
    this.elStashPanel = $('stash-panel');
    this.elStashGrid = $('stash-grid');
    this.elJobModal = $('job-modal');
    this.elJobCards = $('job-cards');
    this.elSkill2 = $('skill-job');
    this.elSkill2Cd = $('cd-skill2');
    this.elSkill3 = $('skill-ult');
    this.elSkill3Cd = $('cd-skill3');
    this.elCdnSkill3 = $('cdn-skill3');
    this.elCdnFire = $('cdn-fire');
    this.elCdnBlink = $('cdn-blink');
    this.elCdnDodge = $('cdn-dodge');
    this.elCdnSkill2 = $('cdn-skill2');
    this.elTpSlot = $('skill-tp');
    this.elTpCount = $('tp-count');
    this.elCompare = $('compare-panel');
    this.elXpRate = $('stat-xprate');
    this.minimap = $('minimap') as HTMLCanvasElement | null;
    this.mmCtx = this.minimap?.getContext('2d') ?? null;
    // Minimap click-to-move: map px → world coords → setTarget (display-only before).
    this.minimap?.addEventListener('pointerdown', (e) => {
      if (!this.started || !this.player.alive || this.paused) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const canvas = this.minimap;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const mx = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const mz = ((e.clientY - rect.top) / rect.height) * canvas.height;
      const S = canvas.width;
      this.tmpVec.set(
        THREE.MathUtils.clamp((mx / S) * 60 - 30, -29, 29),
        0,
        THREE.MathUtils.clamp((mz / S) * 60 - 30, -29, 29),
      );
      this.player.clearAttackTarget();
      this.pickupUid = null;
      this.player.setTarget(this.tmpVec);
      this.showMarker(this.tmpVec, 0xffd479);
      this.sound.unlock();
    });
    this.elFlash = $('flash');
    this.elFade = $('fade');
    this.syncMuteIcon();

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
      if (this.stashOpen) {
        this.moveToStash(uid);
        return;
      }
      const it = this.inventory.find(uid);
      if (it?.kind === 'consumable') this.useScroll(uid);
      else this.equipItem(uid);
    });
    // Right-click a bag item: drop it on the ground (browser menu suppressed).
    this.elInvGrid?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const t = (e.target as HTMLElement).closest('[data-uid]') as HTMLElement | null;
      const uid = t?.dataset.uid;
      if (uid) this.dropItem(uid);
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
    document.getElementById('btn-mute')?.addEventListener('click', () => this.toggleMute());
    document.getElementById('btn-chars')?.addEventListener('click', () => this.openCharSelect());
    document.getElementById('btn-resume')?.addEventListener('click', () => this.togglePause(false));
    document.getElementById('btn-pause-heroes')?.addEventListener('click', () => {
      this.togglePause(false);
      this.openCharSelect();
    });
    document.getElementById('stash-close')?.addEventListener('click', () => this.closeStash());
    const vol = document.getElementById('volume-slider') as HTMLInputElement | null;
    if (vol) {
      vol.value = String(Math.round(this.sound.volume * 100));
      vol.addEventListener('input', () => this.sound.setVolume(Number(vol.value) / 100));
    }
    this.elControlsList?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-rebind]') as HTMLElement | null;
      const action = t?.dataset.rebind as BindAction | undefined;
      if (!action) return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      this.rebindAction = action;
      this.sound.uiClick();
      this.renderControls();
    });
    this.elStashGrid?.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-stash]') as HTMLElement | null;
      const uid = t?.dataset.stash;
      if (uid) this.takeFromStash(uid);
    });
    document.getElementById('skill-tp')?.addEventListener('click', () => this.useScrollKey());
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
    this.togglePause(false);
    this.closeAllPanels();
    if (this.elDeath) this.elDeath.style.display = 'none';
    this.started = false;
    this.renderCharList();
    if (this.elCharSelect) this.elCharSelect.style.display = 'flex';
  }

  private renderCharList(): void {
    if (!this.elCharList) return;
    this.elCharList.innerHTML = charListHtml(listChars(), (id) => zoneById(id).name);
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
    this.levelStartPlaytime = 0;
    this.zoneEnterPlaytime = 0;
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
    this.ultHintShown = false;
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
    this.ultHintShown = false;
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
    this.levelStartPlaytime = s.playtimeSec;
    this.zoneEnterPlaytime = s.playtimeSec;
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
    this.player.mana = Math.min(s.mana ?? this.player.maxMana, this.player.maxMana);
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
      mana: Math.floor(this.player.mana),
      maxMana: this.player.maxMana,
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

  /** §11 balance telemetry: append one sample to localStorage + console for tuning. */
  private logTelemetry(kind: 'timeToLevel' | 'death' | 'bossKill', detail: string, seconds?: number): void {
    const KEY = 'arpg.telemetry.v1';
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? (JSON.parse(raw) as Record<string, Record<string, number[] | number>>) : {};
      const bucket = (data[kind] ?? {}) as Record<string, number[] | number>;
      if (kind === 'death') {
        bucket[detail] = (typeof bucket[detail] === 'number' ? (bucket[detail] as number) : 0) + 1;
      } else {
        const arr = (Array.isArray(bucket[detail]) ? (bucket[detail] as number[]) : []) as number[];
        arr.push(Math.round(seconds ?? 0));
        bucket[detail] = arr.slice(-50);
      }
      data[kind] = bucket;
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* telemetry never blocks gameplay */
    }
    if (seconds !== undefined) console.log(`[telemetry] ${kind} ${detail}: ${Math.round(seconds)}s`);
    else console.log(`[telemetry] ${kind} ${detail}`);
  }

  // ---------- zones ----------

  private loadZone(zoneId: string, opts?: { pos?: [number, number] }): void {
    const def = zoneById(zoneId);
    this.currentZoneId = def.id;
    this.zoneEnterPlaytime = this.playtime;
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
    this.pickupUid = null;
    this.player.clearAttackTarget();
    this.player.stop();

    this.scene.background = new THREE.Color(def.fogColor);
    (this.scene.fog as THREE.Fog).color.setHex(def.fogColor);
    const mood = def.id === 'ember' ? 'ember' : def.id === 'crypt' ? 'crypt' : def.id === 'meadow' ? 'meadow' : 'city';
    this.sound.setMood(mood);
    this.groundMat.color.setHex(def.groundColor);
    for (const w of this.wallMats) w.color.setHex(def.wallColor);

    this.shopNpc.position.set(def.shopPos[0], 0, def.shopPos[1]);
    this.portalMesh.position.set(def.portalPos[0], 0, def.portalPos[1]);
    this.sanctum.position.set(def.sanctumPos[0], 0, def.sanctumPos[1]);
    this.chest.position.set(def.chestPos[0], 0, def.chestPos[1]);
    this.fountain.position.set(def.fountainPos[0], 0, def.fountainPos[1]);
    this.shopNpc.visible = def.hasShop;
    this.portalMesh.visible = def.hasPortal;
    this.sanctum.visible = def.id === 'city';
    this.chest.visible = def.id === 'city';
    this.fountain.visible = def.id === 'city';
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
    this.closeStash();
    this.updateBossBar();
    if (this.started) {
      this.showToast(`Entered ${def.name} — ${def.sub}`);
      this.autosave();
      this.hintSanctum();
      this.hintUlt();
    }
    this.refreshSkillSlot();
    this.refreshSkillSlot3();
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
      const m = new Monster(new THREE.Vector3(x, 0, z), level, { tint: def.monsterTint, species: def.monsterSpecies });
      m.group.userData.monster = m;
      this.monsters.push(m);
      this.scene.add(m.group);
    }
  }

  private spawnBoss(def: ZoneDef): void {
    if (!def.boss) return;
    const tint = def.id === 'crypt' ? 0x7b2ff7 : def.id === 'ember' ? 0xff5a1f : 0xb81f2d;
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
      model: def.bossModel,
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
      this.sound.unlock();
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
      // Rebind capture (volume slider focused is fine — Escape still cancels).
      if (this.rebindAction) {
        e.preventDefault();
        if (e.code !== 'Escape') {
          setBind(this.rebindAction, e.code);
          this.showToast(`${BIND_LABELS[this.rebindAction]} → ${codeLabel(e.code)}`);
        }
        this.rebindAction = null;
        this.renderControls();
        return;
      }
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && e.code !== 'Escape') return;
      if (e.repeat) return;
      this.sound.unlock();
      this.keys.add(e.code);
      if (e.code === 'Escape') {
        if (this.anyUiOpen()) this.closeAllPanels();
        else if (this.started) this.togglePause();
        return;
      }
      if (!this.started || this.paused) return;
      const b = getBinds();
      if (e.code === b.fire) this.tryFireball();
      else if (e.code === b.job) this.castJobSkill();
      else if (e.code === b.ult) this.castUlt();
      else if (e.code === b.potion) this.tryPotion();
      else if (e.code === b.bag) this.toggleInventory();
      else if (e.code === b.char) this.toggleChar();
      else if (e.code === b.blink) this.tryBlink();
      else if (e.code === b.dodge) this.tryDodge();
      else if (e.code === b.interact) this.interact();
      else if (e.code === b.tp) this.useScrollKey();
      else if (e.code === b.mute) this.toggleMute();
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

  private findInteractFromHit(obj: THREE.Object3D | null): 'shop' | 'portal' | 'sanctum' | 'stash' | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      const k = o.userData.interact as string | undefined;
      if (k === 'shop' || k === 'portal' || k === 'sanctum' || k === 'stash') {
        return k;
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

    // 2) Shop / portal / sanctum / stash
    const npcMeshes: THREE.Object3D[] = [];
    if (this.shopNpc.visible) npcMeshes.push(this.shopNpc);
    if (this.portalMesh.visible) npcMeshes.push(this.portalMesh);
    if (this.sanctum.visible) npcMeshes.push(this.sanctum);
    if (this.chest.visible) npcMeshes.push(this.chest);
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
        if (kind === 'stash') {
          this.player.clearAttackTarget();
          this.openStash();
          this.showMarker(this.chest.position, 0xd4a017);
          return;
        }
      }
    }

    // 3) Ground loot — click a crystal to walk over and grab it (no vacuum)
    if (this.loot.count > 0) {
      const lootHits = this.raycaster.intersectObjects(this.loot.drops.map((d) => d.group), true);
      if (lootHits.length > 0) {
        let o: THREE.Object3D | null = lootHits[0].object;
        while (o && o.parent !== this.scene) o = o.parent;
        const drop = o ? this.loot.drops.find((d) => d.group === o) : undefined;
        if (o && drop) {
          this.player.clearAttackTarget();
          this.player.setTarget(o.position);
          this.pickupUid = drop.item.uid;
          this.showMarker(o.position, 0xffd21f);
          return;
        }
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
    if (this.chest.visible) npcMeshes.push(this.chest);
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
    if (!this.spendSkillMana(FIREBALL_COST)) return;
    this.projectiles.fire(
      this.player.position,
      this.tmpVec,
      this.effDmg(this.player.attackDamage) * FIREBALL_MULT * this.player.fireMult,
      16,
      18,
    );
    this.player.faceInstant(this.tmpVec.clone().add(this.player.position));
    this.player.swingAnim = 1;
    this.fireTimer = FIREBALL_CD;
    this.sound.fireball();
    this.effects.burst(
      this.player.position.x + this.tmpVec.x,
      1.3,
      this.player.position.z + this.tmpVec.z,
      { color: 0xff9a2e, count: 8, speed: 3, life: 0.35, size: 0.8 },
    );
  }

  /** Spend skill mana with feedback. Returns false (casts nothing) if short. */
  private spendSkillMana(cost: number): boolean {
    if (this.player.spendMana(cost)) return true;
    this.showToast('Not enough mana.');
    return false;
  }

  private tryPotion(): void {
    if (this.player.drinkPotion()) {
      this.sound.potion();
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
    this.sound.blink();
  }

  private tryDodge(): void {
    if (!this.started || !this.player.alive) return;
    // Dash toward cursor (aimDir falls back to facing, which tracks WASD).
    const dir = this.aimDir();
    if (!dir) return;
    if (!this.player.startDodge(dir)) return;
    this.effects.burst(this.player.position.x, 0.6, this.player.position.z, { color: 0xbfd9ff, count: 8, speed: 4, life: 0.3, size: 0.8 });
    this.sound.blink();
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

  /** One-time ultimate unlock toast (the slot itself refreshes every zone load). */
  private hintUlt(): void {
    if (!this.started || !this.ultUnlocked() || this.ultHintShown) return;
    this.ultHintShown = true;
    const job = jobById(this.player.job);
    this.showToast(`🌟 ULTIMATE unlocked: ${job?.ultimate.icon} ${job?.ultimate.name} — press 3!`, 3.5);
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
    this.refreshSkillSlot3();
    this.renderChar();
    this.sound.jobAdvance();
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
      this.elSkill2.title = `${job.skill.name} (2) — ${job.skill.desc} · ${job.skill.cost} MP`;
    } else {
      this.elSkill2.classList.add('locked');
      this.elSkill2.innerHTML = `2<span class="cd-num" id="cdn-skill2"></span><div id="cd-skill2" class="cd"></div>`;
      this.elSkill2.title = 'Reach Lv10 and choose a job in the Haven Sanctum';
    }
    this.elSkill2Cd = document.getElementById('cd-skill2');
    this.elCdnSkill2 = document.getElementById('cdn-skill2');
  }

  /** Ultimate slot is job-bound and unlocks at Lv20 — no save data needed. */
  private ultUnlocked(): boolean {
    return this.player.job !== null && this.player.level >= ULT_LEVEL;
  }

  private refreshSkillSlot3(): void {
    if (!this.elSkill3) return;
    const job = jobById(this.player.job);
    if (job && this.player.level >= ULT_LEVEL) {
      this.elSkill3.classList.remove('locked');
      this.elSkill3.innerHTML = `${job.ultimate.icon}<span class="key">3</span><span class="cd-num" id="cdn-skill3"></span><div id="cd-skill3" class="cd"></div>`;
      this.elSkill3.title = `${job.ultimate.name} (3) — ${job.ultimate.desc} · ${job.ultimate.cost} MP`;
    } else {
      this.elSkill3.classList.add('locked');
      this.elSkill3.innerHTML = `3<span class="cd-num" id="cdn-skill3"></span><div id="cd-skill3" class="cd"></div>`;
      this.elSkill3.title = job ? `Ultimate unlocks at Lv${ULT_LEVEL}` : 'Advance to a job first';
    }
    this.elSkill3Cd = document.getElementById('cd-skill3');
    this.elCdnSkill3 = document.getElementById('cdn-skill3');
  }

  /** Base damage after temporary buffs (Rampage). Apply at every damage source. */
  private effDmg(base: number): number {
    return base * this.player.buffDmgMult;
  }

  private castJobSkill(): void {
    if (!this.started || !this.player.alive || this.skillTimer > 0) return;
    const job = jobById(this.player.job);
    if (!job) {
      if (this.player.level >= ADVANCE_LEVEL) this.showToast('⭐ Visit the golden Sanctum in Haven to advance!');
      else this.showToast('Reach Lv10 and choose a job to unlock this slot.');
      return;
    }
    if (this.player.mana < job.skill.cost) {
      this.showToast('Not enough mana.');
      return;
    }
    const dmg = this.effDmg(this.player.attackDamage);
    switch (job.skill.id) {
      case 'shield_throw': {
        const dir = this.aimDir();
        if (!dir) return;
        this.projectiles.fire(this.player.position, dir, dmg * 2.6, 18, 20, 0x7cc4ff);
        this.sound.fireball();
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
        this.sound.fireball();
        this.player.faceInstant(dir.clone().add(this.player.position));
        this.player.swingAnim = 1;
        break;
      }
      case 'whirlwind': {
        // Channeled spin: 1.2s, free steering, 1.0x damage each 0.4s spin (3 spins).
        this.whirlTimer = 1.2;
        this.whirlTick = 0.4;
        this.whirlDmg = dmg;
        this.player.clearAttackTarget();
        this.player.swingAnim = 1;
        this.sound.swing();
        this.showMarker(this.player.position, 0xff7b1f);
        this.effects.ring(this.player.position.x, this.player.position.z, 0xff7b1f, 4);
        this.effects.ring(this.player.position.x, this.player.position.z, 0xfff6d8, 2.5, 0.35);
        this.effects.burst(this.player.position.x, 0.6, this.player.position.z, { color: 0xff7b1f, count: 14, speed: 6, life: 0.5, size: 1.1 });
        this.camShake = Math.min(0.6, this.camShake + 0.22);
        this.hitAllInRadius(this.player.position, 4, dmg * 1.0, 0, 0xffd21f);
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
        this.sound.blink();
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
        this.sound.fireball();
        break;
      }
      case 'frost_nova': {
        this.queueAoe(this.player.position.x, this.player.position.z, 4.5, dmg * 1.6, 3, 0.2, 0x9adcff);
        this.player.swingAnim = 1;
        this.sound.blink();
        break;
      }
      default:
        return;
    }
    this.player.spendMana(job.skill.cost);
    this.skillTimer = job.skill.cooldown;
    this.skillCdMax = job.skill.cooldown;
  }

  /** Ultimate: job signature nuke on key 3. Auto-unlocked at Lv20 for your job. */
  private castUlt(): void {
    if (!this.started || !this.player.alive || this.skill3Timer > 0) return;
    const job = jobById(this.player.job);
    if (!job || this.player.level < ULT_LEVEL) {
      this.showToast(job ? `Ultimate unlocks at Lv${ULT_LEVEL}.` : 'Advance to a job first (Haven Sanctum).');
      return;
    }
    const ult = job.ultimate;
    const dmg = this.effDmg(this.player.attackDamage);
    let cd = ult.cooldown;
    if (this.player.mana < ult.cost) {
      this.showToast('Not enough mana.');
      return;
    }
    switch (ult.id) {
      case 'judgment': {
        this.player.swingAnim = 1;
        this.sound.bossSlam();
        this.effects.ring(this.player.position.x, this.player.position.z, 0xffd21f, 6, 0.6);
        this.flashScreen('#ffd21f', 0.35, 0.35);
        this.camShake = Math.min(0.9, this.camShake + 0.4);
        this.hitAllInRadius(this.player.position, 6, dmg * 5, 0, 0xffd21f);
        break;
      }
      case 'rampage': {
        this.player.buffDmgMult = 2;
        this.player.buffTimer = 8;
        this.player.swingAnim = 1;
        this.sound.roar();
        this.effects.ring(this.player.position.x, this.player.position.z, 0xff3b3b, 3.5);
        this.numbers.spawn(this.player.position, 'RAMPAGE!', { color: '#ff3b3b', crit: true, scale: 1.6 });
        break;
      }
      case 'arrow_storm': {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.projectiles.fire(this.player.position, _aoeVec.set(Math.sin(a), 0, Math.cos(a)), dmg * 1.5, 15, 14, 0x5dff6b);
        }
        this.player.swingAnim = 1;
        this.sound.fireball();
        this.effects.ring(this.player.position.x, this.player.position.z, 0x5dff6b, 3);
        break;
      }
      case 'execute': {
        const dir = this.aimDir();
        if (!dir) return;
        const dest = dir.clone().multiplyScalar(12).add(this.player.position);
        this.effects.burst(this.player.position.x, 1.2, this.player.position.z, { color: 0x444444, count: 14, speed: 4, life: 0.4, size: 1 });
        this.resolveTeleport(dest);
        this.player.position.copy(dest);
        this.player.setTarget(dest);
        this.player.faceInstant(dir.clone().add(dest));
        this.player.swingAnim = 1;
        this.sound.blink();
        this.showMarker(dest, 0x444444);
        this.effects.ring(dest.x, dest.z, 0xff3b3b, 3);
        const k0 = this.kills;
        this.hitAllInRadius(dest, 3, dmg * 6, 0, 0xff3b3b);
        if (this.kills > k0) {
          cd *= 0.5;
          this.showToast('💀 EXECUTED! Half cooldown refunded.');
        }
        break;
      }
      case 'cataclysm': {
        const aim = this.groundPointFromScreen(this.lastMouse.x, this.lastMouse.y);
        if (!aim) return;
        const spots: Array<[number, number, number]> = [[aim.x, aim.z, 0.4], [aim.x + 2.5, aim.z + 1, 0.8], [aim.x - 2.5, aim.z - 1, 1.2]];
        for (const [sx, sz, delay] of spots) {
          this.queueAoe(sx, sz, 3.5, dmg * 3 * this.player.fireMult, 0, delay, 0xff6a00, { flash: '#ff8a2e', scorch: true, sfx: 'slam' });
        }
        this.player.swingAnim = 1;
        this.sound.fireball();
        break;
      }
      case 'glacial_prison': {
        this.queueAoe(this.player.position.x, this.player.position.z, 7, dmg * 2.5, 5, 0.5, 0x9adcff);
        this.player.swingAnim = 1;
        this.sound.blink();
        break;
      }
      default:
        return;
    }
    this.player.spendMana(ult.cost);
    this.skill3Timer = cd;
    this.skill3CdMax = cd;
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
      this.sound.hit(false);
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

  private queueAoe(x: number, z: number, radius: number, damage: number, slow: number, delay: number, color: number, opts?: { flash?: string; scorch?: boolean; sfx?: string }): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.1, radius - 0.4), radius, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    this.scene.add(mesh);
    this.pendingAoe.push({ x, z, radius, damage, slow, timer: delay, color, flash: opts?.flash ?? null, scorch: opts?.scorch ?? false, sfx: opts?.sfx ?? null, mesh });
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
      if (a.sfx === 'slam') this.sound.bossSlam();
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
    if (this.player.isDodging()) {
      this.numbers.spawn(this.player.position, 'dodged', { color: '#bfd9ff', scale: 1.1 });
      return false;
    }
    const taken = this.mitigate(raw);
    const died = this.player.takeDamage(taken);
    this.numbers.spawn(this.player.position, `${taken}`, { color: '#ff6b6b' });
    this.sound.hurt();
    this.camShake = Math.min(0.6, this.camShake + 0.25);
    if (died) {
      this.effects.burst(this.player.position.x, 1.2, this.player.position.z, { color: 0xff2222, count: 26, speed: 6, life: 0.7, size: 1.2 });
      this.flashScreen('#7a0000', 0.5, 0.5);
      this.sound.death();
      this.deathTimer = RESPAWN_DELAY;
      if (this.elDeath) this.elDeath.style.display = 'flex';
      this.showToast('You died — a portal drags you back to Haven…');
      this.logTelemetry('death', this.currentZoneId);
    }
    return died;
  }

  private onMonsterKilled(m: Monster): void {
    this.kills += 1;
    this.effects.burst(m.position.x, 1.0, m.position.z, m.isBoss
      ? { color: 0xffd21f, count: 30, speed: 7, life: 0.8, size: 1.3 }
      : { color: 0x9b5de5, count: 9, speed: 4, life: 0.45, size: 0.9 });
    if (m.isBoss) this.sound.bossDie();
    else this.sound.monsterDie();
    this.sound.gold();
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
      this.logTelemetry('bossKill', this.currentZoneId, this.playtime - this.zoneEnterPlaytime);
    } else {
      if (Math.random() < 0.09) this.loot.spawnItem(m.position, generateDrop(this.player.level));
      if (Math.random() < 0.05) this.loot.spawnItem(m.position, makeTpScroll());
    }

    const leveled = this.player.gainXp(m.xpValue * this.xpRate);
    if (leveled) {
      this.logTelemetry('timeToLevel', `lv${this.player.level}`, this.playtime - this.levelStartPlaytime);
      this.levelStartPlaytime = this.playtime;
      this.numbers.spawn(this.player.position, 'LEVEL UP!', { color: '#ffd21f', crit: true, scale: 1.8 });
      this.effects.burst(this.player.position.x, 1.0, this.player.position.z, { color: 0xffd21f, count: 24, speed: 5, life: 0.7, size: 1.1 });
      this.effects.ring(this.player.position.x, this.player.position.z, 0xffd21f, 3.5);
      this.flashScreen('#ffd21f', 0.25, 0.4);
      this.sound.levelup();
      this.showToast(`Level ${this.player.level}! +3 stat points (C) · Trader restocked · +1 potion`, 3.2);
      this.player.potions = Math.min(5, this.player.potions + 1);
      this.refreshShopStock();
      this.renderShop();
      this.renderChar();
      this.hintSanctum();
      if (this.ultUnlocked()) {
        this.refreshSkillSlot3();
        this.hintUlt();
      }
    }
    this.updateBossBar();
    this.renderInventory();
    this.autosave();
  }

  /** Loot grabbed by clicking its crystal — bag space is checked before removal. */
  private onLootPickup(item: ItemInstance): void {
    this.numbers.spawn(this.player.position, item.name, { color: RARITY_COLOR[item.rarity], scale: 1.15 });
    this.sound.lootRarity(item.rarity);
    this.effects.burst(this.player.position.x, 1.2, this.player.position.z, { color: parseInt(RARITY_COLOR[item.rarity].slice(1), 16), count: 8, speed: 3, life: 0.4, size: 0.8 });
    this.showToast(`${item.icon} ${item.name} — press I to equip`);
    this.renderInventory();
  }

  // ---------- shop / inventory / portal ----------

  private toggleInventory(force?: boolean): void {
    this.invOpen = force ?? !this.invOpen;
    if (this.invOpen) this.sound.uiClick();
    this.renderInventory();
  }

  private openShop(): void {
    this.closeStash();
    this.shopOpen = true;
    this.invOpen = true; // selling needs the bag visible
    this.sound.uiClick();
    this.renderShop();
    this.renderInventory();
  }

  private closeShop(): void {
    this.shopOpen = false;
    this.renderShop();
  }

  private openPortal(): void {
    this.closeStash();
    this.portalOpen = true;
    this.sound.uiClick();
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
    this.stashOpen = false;
    this.closeJobModal();
    this.hideCompare();
    this.renderInventory();
    this.renderShop();
    this.renderPortal();
    this.renderChar();
    this.renderStash();
  }

  private togglePause(force?: boolean): void {
    if (!this.started && force !== false) return;
    this.paused = force ?? !this.paused;
    if (this.elPause) this.elPause.style.display = this.paused ? 'flex' : 'none';
    if (this.paused) {
      this.renderControls();
      this.syncMuteIcon();
      const vol = document.getElementById('volume-slider') as HTMLInputElement | null;
      if (vol) vol.value = String(Math.round(this.sound.volume * 100));
    }
  }

  private anyUiOpen(): boolean {
    return this.invOpen || this.shopOpen || this.portalOpen || this.charOpen || this.stashOpen ||
      this.elJobModal?.style.display === 'flex';
  }

  private renderControls(): void {
    if (!this.elControlsList) return;
    this.elControlsList.innerHTML = controlsListHtml(getBinds(), this.rebindAction);
  }

  private openStash(): void {
    this.closeShop();
    this.closePortal();
    this.stashOpen = true;
    this.invOpen = true;
    this.sound.uiClick();
    this.renderStash();
    this.renderInventory();
  }

  private closeStash(): void {
    this.stashOpen = false;
    this.renderStash();
  }

  private renderStash(): void {
    if (this.elStashPanel) this.elStashPanel.style.display = this.stashOpen ? 'block' : 'none';
    if (!this.stashOpen || !this.elStashGrid) return;
    this.elStashGrid.innerHTML = stashGridHtml(this.stash.slots);
  }

  private moveToStash(uid: string): void {
    const it = this.inventory.remove(uid);
    if (!it) return;
    if (!this.stash.add(it)) {
      this.inventory.add(it);
      this.showToast('Stash is full!');
      return;
    }
    this.sound.equip();
    saveSharedStash(this.stash.toJSON());
    this.renderStash();
    this.renderInventory();
  }

  private takeFromStash(uid: string): void {
    const idx = this.stash.slots.findIndex((s) => s?.uid === uid);
    if (idx === -1) return;
    const it = this.stash.slots[idx];
    if (!it) return;
    this.stash.slots[idx] = null;
    if (!this.inventory.add(it)) {
      this.stash.slots[idx] = it;
      this.showToast('Inventory full!');
      return;
    }
    this.sound.equip();
    saveSharedStash(this.stash.toJSON());
    this.renderStash();
    this.renderInventory();
  }

  // ---------- character panel ----------

  private toggleChar(force?: boolean): void {
    this.charOpen = force ?? !this.charOpen;
    if (this.charOpen) this.sound.uiClick();
    this.renderChar();
  }

  private jobLine(): string {
    return jobLineHtml(jobById(this.player.job), this.player.level);
  }

  private charSnapshot(): CharSnapshot {
    const p = this.player;
    return {
      charName: p.charName,
      classIcon: CLASSES[p.baseClass].icon,
      className: CLASSES[p.baseClass].name,
      level: p.level,
      xp: p.xp,
      xpNext: p.xpNext,
      xpRate: this.xpRate,
      statPoints: p.statPoints,
      attrs: p.attrs(),
      attackDamage: p.attackDamage,
      buffActive: p.buffTimer > 0,
      armor: p.armor,
      hp: p.hp,
      maxHp: p.maxHp,
      mana: p.mana,
      maxMana: p.maxMana,
      critChance: p.critChance,
      lifesteal: p.lifesteal,
      fireMult: p.fireMult,
    };
  }

  private renderChar(): void {
    if (this.elCharPanel) this.elCharPanel.style.display = this.charOpen ? 'block' : 'none';
    if (!this.charOpen || !this.elCharBody) return;
    const s = this.charSnapshot();
    this.elCharBody.innerHTML = charBodyHtml(s, this.jobLine());
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
    if (xp) xp.textContent = charXpText(p.xp, p.xpNext, this.xpRate);
    const pts = this.elCharBody.querySelector('#char-points');
    if (pts) pts.textContent = charPointsText(p.statPoints);
    const der = this.elCharBody.querySelector('#char-derived');
    if (der) {
      der.innerHTML = derivedHtml(this.charSnapshot());
    }
  }

  // ---------- item compare ----------

  private showCompare(item: ItemInstance): void {
    if (!this.elCompare) return;
    const eq = this.equipment.slots[item.slot] ?? null;
    this.elCompare.innerHTML = compareHtml(item, eq, this.player.level);
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
    if (!this.player.alive || this.tpBusy) return;
    if (this.currentZoneId === 'city') {
      this.showToast('Already in Haven — no need for a scroll.');
      return;
    }
    this.tpBusy = true;
    this.inventory.remove(uid);
    this.hideCompare();
    this.renderInventory();
    this.sound.scroll();
    if (this.elFade) this.elFade.style.opacity = '1';
    window.setTimeout(() => {
      this.tpBusy = false;
      this.loadZone('city');
      this.snapCamera();
      if (this.elFade) this.elFade.style.opacity = '0';
      this.sound.portal();
      this.showToast('🌀 Town portal! Back in Haven.');
    }, 300);
  }

  /** T hotkey: burn one TP scroll from the bag, if any. */
  private useScrollKey(): void {
    if (!this.started || !this.player.alive || this.tpBusy) return;
    const scroll = this.inventory.slots.find((s) => s?.kind === 'consumable');
    if (!scroll) {
      this.showToast('No Town Portal scrolls — the Trader sells them (20g).');
      return;
    }
    this.useScroll(scroll.uid);
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
      this.elGearStats.textContent = gearStatsText(this.player);
    }
    if (this.elEquipRow) {
      this.elEquipRow.innerHTML = equipRowHtml(this.equipment.slots);
    }
    if (this.elInvGrid) {
      this.elInvGrid.innerHTML = invGridHtml(this.inventory.slots, this.player.level, this.shopOpen);
    }
  }

  private renderShop(): void {
    if (this.elShopPanel) this.elShopPanel.style.display = this.shopOpen ? 'block' : 'none';
    if (!this.shopOpen) return;
    if (this.elShopGold) this.elShopGold.textContent = `${this.inventory.gold}g`;
    if (this.elShopStock) {
      this.elShopStock.innerHTML = shopStockHtml(this.shopStock, this.inventory.gold, this.player.level);
    }
  }

  private renderPortal(): void {
    if (this.elPortalPanel) this.elPortalPanel.style.display = this.portalOpen ? 'block' : 'none';
    if (!this.portalOpen || !this.elPortalList) return;
    this.elPortalList.innerHTML = portalListHtml(ZONES, this.player.level, this.currentZoneId);
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
    this.sound.buy();
    this.numbers.spawn(this.player.position, it.name, { color: RARITY_COLOR[it.rarity], scale: 1.15 });
    this.renderShop();
    this.renderInventory();
  }

  /** Drop a bag item on the ground beneath you — walk over it to pick it back up. */
  private dropItem(uid: string): void {
    const it = this.inventory.remove(uid);
    if (!it) return;
    this.loot.spawnItem(this.player.position, it);
    this.hideCompare();
    this.sound.equip();
    this.showToast(`Dropped ${it.icon} ${it.name} — click it to pick it back up`);
    this.renderInventory();
  }

  private sellItem(uid: string): void {
    const it = this.inventory.remove(uid);
    if (!it) return;
    // Never sell equipped-by-accident: only bag items reach here.
    const price = sellPrice(it);
    this.inventory.gold += price;
    this.sound.sell();
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
    this.sound.equip();
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
    this.sound.equip();
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
      this.sound.portal();
    }, 280);
  }

  private nearestInteract(): 'shop' | 'portal' | 'sanctum' | 'stash' | null {
    if (this.currentZoneId !== 'city' || !this.player.alive) return null;
    if (this.shopNpc.visible && this.player.position.distanceTo(this.shopNpc.position) < INTERACT_RADIUS) return 'shop';
    if (this.portalMesh.visible && this.player.position.distanceTo(this.portalMesh.position) < INTERACT_RADIUS) return 'portal';
    if (this.sanctum.visible && this.player.position.distanceTo(this.sanctum.position) < 2.9) return 'sanctum';
    if (this.chest.visible && this.player.position.distanceTo(this.chest.position) < INTERACT_RADIUS) return 'stash';
    return null;
  }

  private interact(): void {
    const kind = this.nearestInteract();
    if (kind === 'shop') this.openShop();
    else if (kind === 'portal') this.openPortal();
    else if (kind === 'sanctum') this.trySanctum();
    else if (kind === 'stash') this.openStash();
  }

  private toggleMute(): void {
    this.sound.setMuted(!this.sound.muted);
    this.syncMuteIcon();
  }

  private syncMuteIcon(): void {
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = this.sound.muted ? '🔇' : '🔊';
  }

  /** Haven fountain aura: stand close to regenerate HP + mana. City only. */
  private fountainTick(dt: number): void {
    if (!this.fountain.visible) return;
    this.fountainWater.emissiveIntensity = 0.7 + Math.sin(performance.now() * 0.004) * 0.3;
    if (this.currentZoneId !== 'city' || !this.player.alive) return;
    if (this.player.position.distanceTo(this.fountain.position) > 3.2) return;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.25 * dt);
    this.player.mana = Math.min(this.player.maxMana, this.player.mana + this.player.maxMana * 0.6 * dt);
    this.fountainFxT -= dt;
    if (this.fountainFxT <= 0) {
      this.fountainFxT = 0.5;
      this.effects.burst(this.player.position.x, 1.2, this.player.position.z, { color: 0x5dd9ff, count: 4, speed: 2, life: 0.5, size: 0.7 });
    }
  }

  /** Advancement only happens inside the Haven sanctum circle. */
  private trySanctum(): void {    if (this.player.job !== null) {
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

    // Paused: frozen frame, sim untouched (music scheduler also holds).
    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.playtime += dt;
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.blinkTimer = Math.max(0, this.blinkTimer - dt);
    this.skillTimer = Math.max(0, this.skillTimer - dt);
    this.skill3Timer = Math.max(0, this.skill3Timer - dt);
    this.camShake = Math.max(0, this.camShake - dt * 1.6);
    this.fountainTick(dt);

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

    // Marked-loot grab: clicked crystal within reach and past its spawn delay
    if (this.pickupUid) {
      const drop = this.loot.findDrop(this.pickupUid);
      if (!drop) {
        this.pickupUid = null;
      } else {
        const dx = this.player.position.x - drop.group.position.x;
        const dz = this.player.position.z - drop.group.position.z;
        if (dx * dx + dz * dz < 1.7 * 1.7 && drop.age >= PICKUP_DELAY) {
          this.pickupUid = null;
          this.player.stop();
          if (this.inventory.add(drop.item)) {
            this.loot.removeDrop(drop.item.uid);
            this.onLootPickup(drop.item);
          } else {
            this.showToast('Inventory full! Press I to manage gear.');
          }
        }
      }
    }

    // Rampage aura: pulsing red ring while the damage buff holds
    if (this.player.buffTimer > 0) {
      this.buffFxAcc -= dt;
      if (this.buffFxAcc <= 0) {
        this.buffFxAcc = 0.4;
        this.effects.ring(this.player.position.x, this.player.position.z, 0xff3b3b, 2.5, 0.4);
      }
    }

    // Whirlwind: orbital flame swirl follows the player (steering stays free —
    // player.update ran above), each 0.4s spin deals damage at the current position.
    if (this.whirlTimer > 0 || this.whirlFade > 0) {
      const target = this.whirlTimer > 0 ? 1 : 0;
      this.whirlFade = THREE.MathUtils.clamp(this.whirlFade + Math.sign(target - this.whirlFade) * dt * 5, 0, 1);
      this.whirlFx.visible = this.whirlFade > 0.01;
      this.whirlFx.position.set(this.player.position.x, 0, this.player.position.z);
      this.whirlFx.rotation.y += dt * 11;
      for (let i = 0; i < this.whirlBands.length; i++) {
        const band = this.whirlBands[i];
        band.rotation.z += dt * (i % 2 === 0 ? 2.5 : -2);
        band.material.opacity = (band.userData.baseOpacity as number) * this.whirlFade;
      }
      this.whirlLight.intensity = (34 + Math.sin(performance.now() * 0.045) * 10) * this.whirlFade;
    }
    if (this.whirlTimer > 0) {
      this.whirlTimer -= dt;
      this.player.group.rotation.y += dt * 12;
      this.effects.burst(this.player.position.x, 1.1, this.player.position.z, { color: 0xff7b1f, count: 3, speed: 5, life: 0.35, size: 1 });
      this.effects.burst(this.player.position.x, 1.1, this.player.position.z, { color: 0xfff6d8, count: 1, speed: 3, life: 0.3, size: 0.7 });
      this.whirlTick -= dt;
      if (this.whirlTick <= 0 && this.whirlTimer > 0) {
        this.whirlTick += 0.4;
        this.effects.ring(this.player.position.x, this.player.position.z, 0xff7b1f, 4, 0.35);
        this.effects.ring(this.player.position.x, this.player.position.z, 0xfff6d8, 2.5, 0.3);
        this.effects.burst(this.player.position.x, 0.3, this.player.position.z, { color: 0xd6c98a, count: 8, speed: 3, life: 0.6, size: 1.3 });
        this.camShake = Math.min(0.6, this.camShake + 0.12);
        this.hitAllInRadius(this.player.position, 4, this.whirlDmg * 1.0, 0, 0xff7b1f);
      }
      if (this.whirlTimer <= 0) this.whirlTick = 0;
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
        this.sound.bossSlam();
        this.showToast('💥 Boss slam! Move out of the red ring!');
      }
      if (b.consumeSummon()) {
        this.spawnMinion(b.boss.position.x + 2.5, b.boss.position.z + 2.5, b.boss.level - 1);
        this.spawnMinion(b.boss.position.x - 2.5, b.boss.position.z - 2.5, b.boss.level - 1);
        this.sound.roar();
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
        const roll = rollPlayerDamage(this.effDmg(this.player.attackDamage), this.player.critChance);
        const died = target.takeDamage(roll.amount, roll.isCrit, this.numbers);
        this.healLifesteal(roll.amount);
        this.sound.hit(roll.isCrit);
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
        this.sound.hit(false);
        this.effects.burst(m.position.x, 1.4, m.position.z, { color, count: 10, speed: 4, life: 0.4, size: 0.9 });
      },
    );
    this.loot.update(dt);
    this.numbers.update(dt);
    this.effects.update(dt);
    this.sound.update(dt);
    // Sanctum idle sparkles (gold dust drifting up)
    this.sanctumFx -= dt;
    if (this.sanctumFx <= 0) {
      this.sanctumFx = 0.3;
      if (this.sanctum.visible) {
        this.effects.burst(this.sanctum.position.x, 0.4, this.sanctum.position.z, { color: 0xffd21f, count: 2, speed: 1.2, life: 0.9, size: 0.7, gravity: -1 });
      }
    }

    // Walked away from the trader/portal/stash? Close their panels.
    if (this.shopOpen && this.shopNpc.visible &&
      this.player.position.distanceTo(this.shopNpc.position) > 4.5) this.closeShop();
    if (this.portalOpen && this.portalMesh.visible &&
      this.player.position.distanceTo(this.portalMesh.position) > 4.5) this.closePortal();
    if (this.stashOpen && this.chest.visible &&
      this.player.position.distanceTo(this.chest.position) > 4.5) this.closeStash();

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
      this.elFireCd.style.height = cdHeight(this.fireTimer, FIREBALL_CD);
    }
    if (this.elBlinkCd) {
      this.elBlinkCd.style.height = cdHeight(this.blinkTimer, BLINK_CD);
    }
    if (this.elDodgeCd) {
      this.elDodgeCd.style.height = cdHeight(this.player.dodgeCd, DODGE_CD);
    }
    if (this.elSkill2Cd) {
      this.elSkill2Cd.style.height = cdHeight(this.skillTimer, this.skillCdMax);
    }
    if (this.elSkill3Cd) {
      this.elSkill3Cd.style.height = cdHeight(this.skill3Timer, this.skill3CdMax);
    }
    if (this.elCdnSkill3) this.elCdnSkill3.textContent = cdNum(this.skill3Timer);
    if (this.elCdnFire) this.elCdnFire.textContent = cdNum(this.fireTimer);
    if (this.elCdnBlink) this.elCdnBlink.textContent = cdNum(this.blinkTimer);
    if (this.elCdnDodge) this.elCdnDodge.textContent = cdNum(this.player.dodgeCd);
    if (this.elCdnSkill2) this.elCdnSkill2.textContent = cdNum(this.skillTimer);

    this.hudTimer -= 1 / 60;
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.1;

    if (this.elPos) {
      const p = this.player.position;
      this.elPos.textContent = `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
    }
    if (this.elFps) this.elFps.textContent = `${Math.round(this.fpsEma)}`;
    if (this.elState) {
      this.elState.textContent = stateText(
        this.player.alive,
        ((this.player.attackTarget as Monster | null)?.alive) ?? false,
        this.player.isMoving,
      );
    }
    if (this.elHpFill) {
      this.elHpFill.style.width = barPct(this.player.hp, this.player.maxHp);
    }
    if (this.elHpText) this.elHpText.textContent = `${this.player.hp}/${this.player.maxHp}`;
    if (this.elMpFill) {
      this.elMpFill.style.width = barPct(this.player.mana, this.player.maxMana);
    }
    if (this.elMpText) this.elMpText.textContent = `${Math.floor(this.player.mana)}/${this.player.maxMana}`;
    if (this.elXpFill) {
      this.elXpFill.style.width = barPct(this.player.xp, this.player.xpNext);
    }
    if (this.elLevel) this.elLevel.textContent = `${this.player.level}`;
    if (this.elKills) this.elKills.textContent = `${this.kills}`;
    if (this.elXpRate) this.elXpRate.textContent = `x${this.xpRate}`;
    if (this.elGold) this.elGold.textContent = `${this.inventory.gold}g`;
    if (this.elZone) this.elZone.textContent = zoneById(this.currentZoneId).name;
    if (this.elPotion) {
      const view = potionHtml(this.player.potions, this.player.potionCooldown);
      this.elPotion.innerHTML = view.html;
      this.elPotion.classList.toggle('locked', view.locked);
    }
    if (this.elTpCount || this.elTpSlot) {
      const n = tpScrollCount(this.inventory.slots);
      if (this.elTpCount) this.elTpCount.textContent = `x${n}`;
      if (this.elTpSlot) this.elTpSlot.classList.toggle('locked', n <= 0);
    }
    const prompt = promptFor(this.nearestInteract(), codeLabel(getBinds().interact), this.player.job, this.player.level);
    if (this.elPrompt) {
      if (prompt.visible) {
        this.elPrompt.textContent = prompt.text;
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
    // Trader (green square) + portal (cyan diamond) + stash (gold square)
    if (this.shopNpc.visible) {
      const [mx, mz] = toMap(this.shopNpc.position.x, this.shopNpc.position.z);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(mx - 3, mz - 3, 6, 6);
    }
    if (this.chest.visible) {
      const [mx, mz] = toMap(this.chest.position.x, this.chest.position.z);
      ctx.fillStyle = '#d4a017';
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
