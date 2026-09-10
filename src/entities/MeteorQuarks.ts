import * as THREE from 'three';
import {
  BatchedRenderer,
  ParticleSystem,
  RenderMode,
  ConeEmitter,
  SphereEmitter,
  ConstantValue,
  IntervalValue,
  ConstantColor,
  ColorOverLife,
  SizeOverLife,
  SpeedOverLife,
  FrameOverLife,
  Gradient,
  Bezier,
  PiecewiseBezier,
  GravityForce,
  Vector3 as QuarksVec3,
  Vector4 as QuarksVec4,
} from 'three.quarks';
import { getMoteTexture } from './SavePoint';
import { getFireAtlas, getSmokeAtlas } from './Flipbook';

interface LiveOneShot {
  s: ParticleSystem;
  t: number;
  ttl: number;
}

function fireGradient(): Gradient {
  return new Gradient(
    [
      [new QuarksVec3(1, 0.75, 0.35), 0],
      [new QuarksVec3(1, 0.35, 0.08), 0.55],
      [new QuarksVec3(0.45, 0.05, 0.01), 1],
    ],
    [
      [1, 0],
      [0.95, 0.25],
      [0, 1],
    ],
  );
}

function arcaneGradient(): Gradient {
  return new Gradient(
    [
      [new QuarksVec3(1, 0.96, 1), 0],
      [new QuarksVec3(0.72, 0.42, 1), 0.5],
      [new QuarksVec3(0.32, 0.1, 0.62), 1],
    ],
    [
      [1, 0],
      [0.95, 0.3],
      [0, 1],
    ],
  );
}


/** Full flipbook sweep 0 → frames-1 over particle life (tile blending on). */
function fullSweep(frames: number): FrameOverLife {
  const last = frames - 1;
  return new FrameOverLife(new PiecewiseBezier([[new Bezier(0, last / 3, (2 * last) / 3, last), 0]]));
}

/**
 * three.quarks pilot (meteor only): GPU-batched fall streaks while the
 * telegraph warns + flash/fire/embers/smoke one-shots on detonation.
 * Everything else keeps using the hand-rolled pooled FX.
 *
 * Lifecycle: templates are built once; per cast we clone() (cast-time
 * allocation, never per-frame). finishers are tracked and removed after ttl.
 */
export class MeteorFx {
  private batch = new BatchedRenderer();
  private scene: THREE.Scene;
  private fallTemplate!: ParticleSystem;
  private flashTemplate!: ParticleSystem;
  private fireTemplate!: ParticleSystem;
  private emberTemplate!: ParticleSystem;
  private smokeTemplate!: ParticleSystem;
  private live: LiveOneShot[] = [];
  private skyBoltMat!: THREE.MeshBasicMaterial;
  private skyChargeTemplate!: ParticleSystem;
  private skyBoltTemplate!: ParticleSystem;
  /** Looping fall columns, keyed by handle for stopFall/stopAll. */
  private falls = new Set<ParticleSystem>();
  private addMat!: THREE.MeshBasicMaterial;
  private flipMat!: THREE.MeshBasicMaterial;
  private smokeMat!: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.add(this.batch);
    const mote = getMoteTexture();
    const fire = getFireAtlas();
    const smoke = getSmokeAtlas();
    // Soft dots (fall streaks). Flipbook maps below (flash/fire/embers/smoke).
    this.addMat = new THREE.MeshBasicMaterial({
      map: mote,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flipMat = new THREE.MeshBasicMaterial({
      map: fire.tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.skyBoltMat = new THREE.MeshBasicMaterial({
      map: mote,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.smokeMat = new THREE.MeshBasicMaterial({
      map: smoke.tex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });

    // Falling streak column (looping; emitter hovers above the target).
    this.fallTemplate = new ParticleSystem({
      looping: true,
      duration: 1,
      worldSpace: true,
      shape: new ConeEmitter({ radius: 2.2, angle: 0.22 }),
      startLife: new IntervalValue(0.55, 0.7),
      startSpeed: new IntervalValue(13, 17),
      startSize: new ConstantValue(0.32),
      startLength: new IntervalValue(1.2, 2.0),
      startColor: new ConstantColor(new QuarksVec4(1, 0.55, 0.15, 1)),
      emissionOverTime: new ConstantValue(46),
      renderMode: RenderMode.StretchedBillBoard,
      material: this.addMat,
      renderOrder: 24,
      behaviors: [new ColorOverLife(fireGradient())],
    });

    // Detonation flash: flipbook starburst, gone in a blink.
    this.flashTemplate = new ParticleSystem({
      looping: false,
      duration: 0.4,
      worldSpace: true,
      shape: new SphereEmitter({ radius: 0.6 }),
      startLife: new ConstantValue(0.32),
      startSpeed: new IntervalValue(1, 3),
      startSize: new IntervalValue(3.0, 4.2),
      startColor: new ConstantColor(new QuarksVec4(1, 0.9, 0.7, 1)),
      emissionBursts: [{ time: 0, count: new ConstantValue(10), cycle: 1, interval: 0.01, probability: 1 }],
      renderMode: RenderMode.BillBoard,
      material: this.flipMat,
      renderOrder: 26,
      uTileCount: fire.cols,
      vTileCount: fire.rows,
      blendTiles: true,
      behaviors: [fullSweep(fire.frames)],
    });

    // Fireball core: flipbook flames in an upward cone, decays fast.
    this.fireTemplate = new ParticleSystem({
      looping: false,
      duration: 0.9,
      worldSpace: true,
      shape: new ConeEmitter({ radius: 1.1, angle: 0.45 }),
      startLife: new IntervalValue(0.5, 0.8),
      startSpeed: new IntervalValue(5, 9),
      startSize: new IntervalValue(0.5, 0.9),
      startColor: new ConstantColor(new QuarksVec4(1, 0.5, 0.1, 1)),
      emissionBursts: [{ time: 0.05, count: new ConstantValue(42), cycle: 1, interval: 0.01, probability: 1 }],
      renderMode: RenderMode.BillBoard,
      material: this.flipMat,
      renderOrder: 25,
      uTileCount: fire.cols,
      vTileCount: fire.rows,
      blendTiles: true,
      behaviors: [
        fullSweep(fire.frames),
        new SpeedOverLife(new PiecewiseBezier([[new Bezier(1, 0.7, 0.3, 0.15), 0]])),
      ],
    });

    // Embers: flipbook tails on long-lived rising sparks.
    this.emberTemplate = new ParticleSystem({
      looping: false,
      duration: 1.6,
      worldSpace: true,
      shape: new SphereEmitter({ radius: 2.2 }),
      startLife: new IntervalValue(0.9, 1.5),
      startSpeed: new IntervalValue(2, 5),
      startSize: new IntervalValue(0.12, 0.26),
      startColor: new ConstantColor(new QuarksVec4(1, 0.6, 0.2, 1)),
      emissionBursts: [{ time: 0.1, count: new ConstantValue(26), cycle: 1, interval: 0.01, probability: 1 }],
      renderMode: RenderMode.BillBoard,
      material: this.flipMat,
      renderOrder: 25,
      uTileCount: fire.cols,
      vTileCount: fire.rows,
      blendTiles: true,
      behaviors: [fullSweep(fire.frames)],
    });

    // Smoke: flipbook puffs (own material/batch).
    this.smokeTemplate = new ParticleSystem({
      looping: false,
      duration: 1.8,
      worldSpace: true,
      shape: new SphereEmitter({ radius: 1.4 }),
      startLife: new IntervalValue(1.0, 1.6),
      startSpeed: new IntervalValue(1.5, 3),
      startSize: new IntervalValue(0.7, 1.1),
      startColor: new ConstantColor(new QuarksVec4(0.62, 0.56, 0.72, 0.85)),
      emissionBursts: [{ time: 0.3, count: new ConstantValue(8), cycle: 1, interval: 0.01, probability: 1 }],
      renderMode: RenderMode.BillBoard,
      material: this.smokeMat,
      renderOrder: 23,
      uTileCount: smoke.cols,
      vTileCount: smoke.rows,
      blendTiles: true,
      behaviors: [
        fullSweep(smoke.frames),
        new SizeOverLife(new PiecewiseBezier([[new Bezier(0.6, 1, 1.2, 1.4), 0]])),
      ],
    });

    // Skyfall charge: violet motes imploding onto the crown (looping; the
    // boss drives the emitter + gravity center every frame, see setGravity).
    this.skyChargeTemplate = new ParticleSystem({
      looping: true,
      duration: 1,
      worldSpace: true,
      shape: new SphereEmitter({ radius: 3.4 }),
      startLife: new IntervalValue(0.5, 0.8),
      startSpeed: new ConstantValue(1.2),
      startSize: new IntervalValue(0.14, 0.26),
      startColor: new ConstantColor(new QuarksVec4(0.85, 0.65, 1, 1)),
      emissionOverTime: new ConstantValue(70),
      renderMode: RenderMode.BillBoard,
      material: this.addMat,
      renderOrder: 26,
      behaviors: [
        new GravityForce(new QuarksVec3(0, 0, 0), 60),
        new ColorOverLife(fireGradient()),
      ],
    });

    // Skyfall bolt: single heavy orb + ribbon trail, aimed by emitter quaternion.
    this.skyBoltTemplate = new ParticleSystem({
      looping: false,
      duration: 2,
      worldSpace: true,
      shape: new ConeEmitter({ radius: 0.2, angle: 0.04 }),
      startLife: new ConstantValue(1.0),
      startSpeed: new ConstantValue(13),
      startSize: new ConstantValue(1.25),
      startColor: new ConstantColor(new QuarksVec4(1, 1, 1, 1)),
      emissionBursts: [{ time: 0, count: new ConstantValue(1), cycle: 1, interval: 0.01, probability: 1 }],
      renderMode: RenderMode.Trail,
      rendererEmitterSettings: { startLength: new ConstantValue(4.2), followLocalOrigin: false },
      material: this.skyBoltMat,
      renderOrder: 26,
      behaviors: [new ColorOverLife(arcaneGradient())],
    });
  }

  /** Clone a template, attach it, and play — caller owns the handle. */
  cloneSky(which: 'charge' | 'bolt'): ParticleSystem {
    const s = (which === 'charge' ? this.skyChargeTemplate : this.skyBoltTemplate).clone();
    this.attach(s);
    s.play();
    return s;
  }

  /** Steer a charge clone's implosion point (world space). */
  setGravity(s: ParticleSystem, x: number, y: number, z: number): void {
    for (const b of s.behaviors) {
      if (b instanceof GravityForce) {
        b.center.set(x, y, z);
        return;
      }
    }
  }

  /** Looping streak column above (x, z). Caller stores the handle; stopFall ends it. */
  startFall(x: number, z: number): ParticleSystem {
    const s = this.fallTemplate.clone();
    s.emitter.position.set(x, 9, z);
    s.emitter.rotation.x = Math.PI;
    this.attach(s);
    s.play();
    this.falls.add(s);
    return s;
  }

  stopFall(s: ParticleSystem): void {
    if (!this.falls.has(s)) return;
    this.falls.delete(s);
    this.detach(s);
  }

  /** One-shot flash + fire + embers + smoke at (x, z). Tuned for r≈3.5. */
  impact(x: number, z: number): void {
    const defs: Array<[ParticleSystem, number, number]> = [
      [this.flashTemplate, 0.5, 1.2],
      [this.fireTemplate, 0.6, 1.8],
      [this.emberTemplate, 0.4, 2.4],
      [this.smokeTemplate, 1.0, 2.8],
    ];
    for (const [template, y, ttl] of defs) {
      const s = template.clone();
      s.emitter.position.set(x, y, z);
      this.attach(s);
      s.play();
      this.live.push({ s, t: 0, ttl });
    }
  }

  /** Zone change: drop every live system (falls + finishers). */
  stopAll(): void {
    for (const { s } of this.live) this.detach(s);
    this.live = [];
    for (const s of this.falls) this.detach(s);
    this.falls.clear();
  }

  update(dt: number): void {
    this.batch.update(dt);
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.t += dt;
      if (l.t >= l.ttl) {
        this.detach(l.s);
        this.live.splice(i, 1);
      }
    }
  }

  /** Attach a system to the scene + batch (shared with boss skills). */
  attach(s: ParticleSystem): void {
    this.scene.add(s.emitter);
    this.batch.addSystem(s);
  }

  /** Remove a system from the batch + scene and free it. */
  detach(s: ParticleSystem): void {
    this.batch.deleteSystem(s);
    s.emitter.parent?.remove(s.emitter);
    s.dispose();
  }
}
