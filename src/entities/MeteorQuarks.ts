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
  Gradient,
  Bezier,
  PiecewiseBezier,
  Vector3 as QuarksVec3,
  Vector4 as QuarksVec4,
} from 'three.quarks';
import { getMoteTexture } from './SavePoint';

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

function shrink(): PiecewiseBezier {
  return new PiecewiseBezier([[new Bezier(1, 0.9, 0.25, 0), 0]]);
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
  /** Looping fall columns, keyed by handle for stopFall/stopAll. */
  private falls = new Set<ParticleSystem>();
  private addMat!: THREE.MeshBasicMaterial;
  private smokeMat!: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.add(this.batch);
    const mote = getMoteTexture();
    this.addMat = new THREE.MeshBasicMaterial({
      map: mote,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.smokeMat = new THREE.MeshBasicMaterial({
      map: mote,
      color: 0x555555,
      transparent: true,
      opacity: 0.4,
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

    // Detonation flash: big soft billboards, gone in a blink.
    this.flashTemplate = new ParticleSystem({
      looping: false,
      duration: 0.4,
      worldSpace: true,
      shape: new SphereEmitter({ radius: 0.6 }),
      startLife: new ConstantValue(0.28),
      startSpeed: new IntervalValue(1, 3),
      startSize: new IntervalValue(2.2, 3.2),
      startColor: new ConstantColor(new QuarksVec4(1, 0.9, 0.7, 1)),
      emissionBursts: [{ time: 0, count: new ConstantValue(10), cycle: 1, interval: 0.01, probability: 1 }],
      renderMode: RenderMode.BillBoard,
      material: this.addMat,
      renderOrder: 26,
      behaviors: [new ColorOverLife(fireGradient()), new SizeOverLife(shrink())],
    });

    // Fireball core: upward cone, decays fast.
    this.fireTemplate = new ParticleSystem({
      looping: false,
      duration: 0.9,
      worldSpace: true,
      shape: new ConeEmitter({ radius: 1.1, angle: 0.45 }),
      startLife: new IntervalValue(0.5, 0.8),
      startSpeed: new IntervalValue(5, 9),
      startSize: new IntervalValue(0.5, 0.9),
      startColor: new ConstantColor(new QuarksVec4(1, 0.5, 0.1, 1)),
      emissionBursts: [{ time: 0, count: new ConstantValue(42), cycle: 1, interval: 0.01, probability: 1 }],
      renderMode: RenderMode.BillBoard,
      material: this.addMat,
      renderOrder: 25,
      behaviors: [
        new ColorOverLife(fireGradient()),
        new SizeOverLife(shrink()),
        new SpeedOverLife(new PiecewiseBezier([[new Bezier(1, 0.7, 0.3, 0.15), 0]])),
      ],
    });

    // Embers: long-lived rising sparks.
    this.emberTemplate = new ParticleSystem({
      looping: false,
      duration: 1.6,
      worldSpace: true,
      shape: new SphereEmitter({ radius: 2.2 }),
      startLife: new IntervalValue(0.9, 1.5),
      startSpeed: new IntervalValue(2, 5),
      startSize: new IntervalValue(0.12, 0.26),
      startColor: new ConstantColor(new QuarksVec4(1, 0.6, 0.2, 1)),
      emissionBursts: [{ time: 0, count: new ConstantValue(26), cycle: 1, interval: 0.01, probability: 1 }],
      renderMode: RenderMode.BillBoard,
      material: this.addMat,
      renderOrder: 25,
      behaviors: [new ColorOverLife(fireGradient()), new SizeOverLife(shrink())],
    });

    // Smoke: normal-blended gray puffs (own material/batch).
    this.smokeTemplate = new ParticleSystem({
      looping: false,
      duration: 1.8,
      worldSpace: true,
      shape: new SphereEmitter({ radius: 1.4 }),
      startLife: new IntervalValue(1.0, 1.6),
      startSpeed: new IntervalValue(1.5, 3),
      startSize: new IntervalValue(0.9, 1.4),
      startColor: new ConstantColor(new QuarksVec4(0.35, 0.32, 0.32, 0.5)),
      emissionBursts: [{ time: 0, count: new ConstantValue(12), cycle: 1, interval: 0.01, probability: 1 }],
      renderMode: RenderMode.BillBoard,
      material: this.smokeMat,
      renderOrder: 23,
      behaviors: [new SizeOverLife(new PiecewiseBezier([[new Bezier(0.6, 1, 1.2, 1.4), 0]]))],
    });
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

  private attach(s: ParticleSystem): void {
    this.scene.add(s.emitter);
    this.batch.addSystem(s);
  }

  private detach(s: ParticleSystem): void {
    this.batch.deleteSystem(s);
    s.emitter.parent?.remove(s.emitter);
    s.dispose();
  }
}
