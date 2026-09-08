import * as THREE from 'three';
import { Player } from '../entities/Player';
import { createTerrain } from '../world/Terrain';
import { StateMachine } from './StateMachine';

const CAM_FOV = 38;
const CAM_MIN = 10;
const CAM_MAX = 26;
const CAM_DIR = new THREE.Vector3(0, 18, 12).normalize();

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
  private dummies: THREE.Object3D[] = [];

  private dirLight!: THREE.DirectionalLight;
  private clickMarker!: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private markerLife = 0;

  private keys = new Set<string>();
  private camDist = 21;
  private tmpVec = new THREE.Vector3();
  private tmpNdc = new THREE.Vector2();

  private elPos: HTMLElement | null;
  private elState: HTMLElement | null;
  private elFps: HTMLElement | null;
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

    this.elPos = document.getElementById('stat-pos');
    this.elState = document.getElementById('stat-state');
    this.elFps = document.getElementById('stat-fps');

    // Start camera snapped behind player
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
    this.dummies = terrain.dummies;
    this.scene.add(this.player.group);
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

  // ---------- input ----------

  private bindInput(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        this.player.stop();
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
      this.updateHoverCursor(e.clientX, e.clientY);
    });

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
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

  private handleGroundClick(clientX: number, clientY: number): void {
    this.setNdc(clientX, clientY);

    // 1) Dummies first (attack-move stub: walk up to them)
    const dummyHits = this.raycaster.intersectObjects(this.dummies, true);
    if (dummyHits.length > 0) {
      let obj: THREE.Object3D | null = dummyHits[0].object;
      while (obj && !obj.userData.isTarget) obj = obj.parent;
      const p = obj ? obj.position : dummyHits[0].point;
      // Stop just outside the dummy collider so we don't overlap
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

    // 2) Ground
    const groundHits = this.raycaster.intersectObject(this.ground, false);
    if (groundHits.length > 0) {
      const p = groundHits[0].point;
      p.x = THREE.MathUtils.clamp(p.x, -29, 29);
      p.z = THREE.MathUtils.clamp(p.z, -29, 29);
      this.player.setTarget(p);
      this.showMarker(p, 0xffd479);
    }
  }

  private hoverCheck = 0;

  private updateHoverCursor(clientX: number, clientY: number): void {
    // Throttle hover raycasts — every 3rd mousemove is plenty
    if (++this.hoverCheck % 3 !== 0) return;
    this.setNdc(clientX, clientY);
    const hits = this.raycaster.intersectObjects(this.dummies, true);
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

    // Move
    this.keyboardDir(this.tmpVec);
    // NOTE: keyboardDir reuses tmpVec — copy before Player consumes it
    const kb = this.tmpVec.clone();
    this.player.update(dt, this.colliders, kb);

    // Camera follow (smooth)
    const desired = new THREE.Vector3()
      .copy(this.player.position)
      .addScaledVector(CAM_DIR, this.camDist);
    const k = 1 - Math.exp(-5 * dt);
    this.camera.position.lerp(desired, k);
    this.camera.lookAt(this.player.position.x, 1, this.player.position.z);

    // Light follows player so shadows stay crisp
    this.dirLight.position.set(
      this.player.position.x + 10,
      20,
      this.player.position.z + 6,
    );
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

    // HUD @ ~10Hz
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      if (this.elPos) {
        const p = this.player.position;
        this.elPos.textContent = `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
      }
      if (this.elState) this.elState.textContent = this.player.isMoving ? 'moving' : 'idle';
      if (this.elFps) this.elFps.textContent = `${Math.round(this.fpsEma)}`;
    }

    this.renderer.render(this.scene, this.camera);
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
