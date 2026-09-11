/**
 * Frost Lance crystal field — Cryomancer 4th skill visuals + eruption driver.
 *
 * MIT License — Copyright (c) 2026 mohamedachrefelouafi
 * Adapted from LinearAbiltyCastingThreeJS (Elemental Sandbox):
 *   - crystal geometry generator (`createCrystalGeometry`)
 *   - ice shading (thickness tint, world-space fracture, birth flash)
 *   - eruption timing (fracture front, staggered rise with overshoot)
 * Adaptations for this codebase: fixed parameters (no live editor), own clock
 * uniform (no shared frame uniforms), plain onBeforeCompile (no custom shadow
 * pass), pooled two-cast driver, no particle/decal dependencies (the game
 * supplies those through its own Effects pool).
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Vendored GLSL noise (subset used by the ice shader)                 */
/* ------------------------------------------------------------------ */

const NOISE_GLSL = /* glsl */ `
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute289(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt4(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289v3(i);
  vec4 p = permute289(permute289(permute289(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt4(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * snoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}
float ridged(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * (1.0 - abs(snoise(p)));
    p *= 2.06;
    a *= 0.5;
  }
  return v;
}
`;

/* ------------------------------------------------------------------ */
/* Vendored crystal geometry (fixed shape — no live editor here)       */
/* ------------------------------------------------------------------ */

function hash11(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

const TAU = Math.PI * 2;
const RING_HEIGHTS = [0, 0.22, 0.5, 0.75, 0.92];

function profileRadius(t: number, taper: number): number {
  return taper + (1 - taper) * Math.pow(1 - t, 1.15);
}

/** Tapered, faceted, slightly bent prism. Unit space: base ring y=0 r=0.5, apex y=1. */
function createCrystalGeometry(seed = 1): THREE.BufferGeometry {
  const facets = 6;
  const taper = 0.13;
  const roughness = 0.28;
  const bend = 0.22;
  const bendAngle = hash11(seed * 1.77) * TAU;
  const bendX = Math.cos(bendAngle);
  const bendZ = Math.sin(bendAngle);
  const axisOffset = (t: number): number => bend * 0.5 * Math.pow(t, 1.6);

  const angles: number[] = [];
  for (let i = 0; i < facets; i++) {
    const jitter = (hash11(seed * 3.13 + i * 7.7) - 0.5) * (TAU / facets) * 0.55 * roughness * 3;
    angles.push((i / facets) * TAU + jitter);
  }

  const rings = RING_HEIGHTS.map((t, ringIndex) => {
    const baseR = profileRadius(t, taper) * 0.5;
    const drift = axisOffset(t);
    const y = t + (hash11(seed * 5.9 + ringIndex * 2.3) - 0.5) * 0.06 * roughness * (t > 0 ? 1 : 0);
    return angles.map((angle, i) => {
      const wobble = 1 + (hash11(seed * 11.1 + ringIndex * 13.7 + i * 3.9) - 0.5) * roughness * 1.3 * (0.35 + 0.65 * t);
      const r = Math.max(0.002, baseR * wobble);
      return [Math.cos(angle) * r + bendX * drift, y, Math.sin(angle) * r + bendZ * drift];
    });
  });

  const apexDrift = axisOffset(1);
  const apex = [
    bendX * apexDrift + (hash11(seed * 17.3) - 0.5) * 0.09 * roughness,
    1,
    bendZ * apexDrift + (hash11(seed * 19.7) - 0.5) * 0.09 * roughness,
  ];
  const floorCentre = [0, 0, 0];

  const positions: number[] = [];
  const push = (p: number[]): void => {
    positions.push(p[0], p[1], p[2]);
  };
  for (let ring = 0; ring < rings.length - 1; ring++) {
    const lower = rings[ring];
    const upper = rings[ring + 1];
    for (let i = 0; i < facets; i++) {
      const j = (i + 1) % facets;
      push(lower[i]); push(lower[j]); push(upper[i]);
      push(lower[j]); push(upper[j]); push(upper[i]);
    }
  }
  const top = rings[rings.length - 1];
  const base = rings[0];
  for (let i = 0; i < facets; i++) {
    const j = (i + 1) % facets;
    push(top[i]); push(top[j]); push(apex);
    push(floorCentre); push(base[j]); push(base[i]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Simplified ice material (fixed palette — no settings dependency)    */
/* ------------------------------------------------------------------ */

function createIceMaterial(timeUniform: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.16,
    metalness: 0.0,
    flatShading: true,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  const uniforms = {
    uTime: timeUniform,
    uColorDeep: { value: new THREE.Color(0x144a7c) },
    uColorIce: { value: new THREE.Color(0xbfe6ff) },
    uColorRim: { value: new THREE.Color(0xeaf7ff) },
    uColorCore: { value: new THREE.Color(0x9adcff) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aSeed;
         attribute float aBirth;
         varying vec3  vIceLocal;
         varying vec3  vIceWorld;
         varying float vIceSeed;
         varying float vIceBirth;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vIceLocal = transformed;
         vIceSeed = aSeed;
         vIceBirth = aBirth;
         #ifdef USE_INSTANCING
           vIceWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
         #else
           vIceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
         #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform vec3  uColorDeep;
         uniform vec3  uColorIce;
         uniform vec3  uColorRim;
         uniform vec3  uColorCore;
         varying vec3  vIceLocal;
         varying vec3  vIceWorld;
         varying float vIceSeed;
         varying float vIceBirth;
         ${NOISE_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           vec3  N   = normalize(normal);
           float ndv = clamp(dot(N, normalize(vViewPosition)), 0.0, 1.0);
           float thickness = clamp(ndv * 1.15, 0.0, 1.0);
           float fres = pow(1.0 - ndv, 2.4) * 2.3;
           vec3  fp     = vIceWorld * 6.5 + vIceSeed * 37.0;
           float cracks = smoothstep(0.55, 0.98, ridged(fp));
           float veins = fbm3(vIceLocal * 12.8 + vIceSeed * 11.0) * 0.5 + 0.5;
           veins = smoothstep(0.45, 0.92, veins);
           vec3 body = mix(uColorIce, uColorDeep, thickness);
           body = mix(body, uColorRim, veins * 0.45 * 0.55);
           body = mix(body, uColorRim, cracks * 0.62 * 0.4);
           float rime = smoothstep(0.55, 0.0, vIceLocal.y) *
                        (0.5 + 0.5 * fbm3(vIceLocal * 9.0 + vIceSeed * 5.0));
           body = mix(body, uColorRim, clamp(rime, 0.0, 1.0) * 0.5);
           body *= mix(1.0, 0.55 + 0.9 * ndv, 0.68);
           float sp = snoise(vIceWorld * 34.0 +
                             vec3(0.0, uTime * 0.7, 0.0) + vIceSeed * 23.0);
           sp = pow(clamp(sp, 0.0, 1.0), 14.0) * smoothstep(0.0, 0.7, fres + 0.3);
           diffuseColor.rgb *= body;
           float rimAmount = pow(1.0 - ndv, 2.4);
           vec3 glow = uColorRim * rimAmount * 2.0;
           glow += uColorCore * (cracks * 0.62 * 0.8 + veins * 0.45 * 0.35) * 1.5;
           glow += uColorRim * sp * 1.6 * 1.5;
           glow += uColorCore * vIceBirth * 3.2;
           glow *= 1.35;
           glow /= 1.0 + glow * 0.22;
           totalEmissiveRadiance += glow;
           diffuseColor.a = clamp(diffuseColor.a * (0.62 + 0.5 * fres) + cracks * 0.12, 0.0, 1.0);
         }`,
      );
  };
  // Shared across both variant meshes — one program for the field.
  material.customProgramCacheKey = () => 'frost-lance-ice';
  return material;
}

/* ------------------------------------------------------------------ */
/* Eruption driver (pooled two-cast field)                             */
/* ------------------------------------------------------------------ */

const VARIANTS = 2;
const SLOTS = 36;
const MAX_SPIKES = VARIANTS * SLOTS;

export const FROST_LANCE_LENGTH = 12;

interface SpikeRecord {
  along: number;
  lateral: number;
  impact: boolean;
  heightJitter: number;
  yaw: number;
  stagger: number;
  eruptTime: number;
}

interface CastSlot {
  active: boolean;
  age: number;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  side: THREE.Vector3;
  records: SpikeRecord[];
}

const _dummy = new THREE.Object3D();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _tilt = new THREE.Quaternion();
const _spin = new THREE.Quaternion();

function saturate(x: number): number {
  return Math.min(1, Math.max(0, x));
}
function outQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

function halfWidth(s: number): number {
  return 0.8 + (1.6 - 0.8) * Math.pow(saturate(s), 1.2);
}

function spikeHeight(along: number, jitter: number): number {
  // Ankle-high at the caster, wall of blades at the far end.
  const h = (0.5 + (2.2 - 0.5) * Math.pow(saturate(along), 1.3)) * (1 + jitter * 0.35);
  return Math.max(0.05, h);
}

/** Frost Lance crystal field: erupt along a line, stand, sink. Damage is Game-side.
 *  Instance slots are shared between the two pooled casts — safe because the
 *  field lives 3.0s and the skill cooldown (9s) makes overlap impossible. */
export class FrostLance {
  private meshes: THREE.InstancedMesh[] = [];
  private births: THREE.InstancedBufferAttribute[] = [];
  private timeUniform = { value: 0 };
  private slots: CastSlot[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    const material = createIceMaterial(this.timeUniform);
    for (let v = 0; v < VARIANTS; v++) {
      const geometry = createCrystalGeometry(7.3 + v * 21.7);
      const seeds = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS), 1);
      const births = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS), 1);
      for (let i = 0; i < SLOTS; i++) seeds.array[i] = Math.random() * 10;
      geometry.setAttribute('aSeed', seeds);
      geometry.setAttribute('aBirth', births);
      const mesh = new THREE.InstancedMesh(geometry, material, SLOTS);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.births.push(births);
    }
    for (let s = 0; s < 2; s++) {
      this.slots.push({
        active: false, age: 0,
        origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0),
        records: [],
      });
    }
  }

  /** Erupt a field from origin along dir (normalized, y=0). */
  cast(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;
    slot.active = true;
    slot.age = 0;
    slot.origin.copy(origin).setY(0);
    slot.dir.copy(dir).setY(0).normalize();
    slot.side.set(-slot.dir.z, 0, slot.dir.x);
    slot.records = [];
    const impactCount = Math.round(MAX_SPIKES * 0.22);
    for (let i = 0; i < MAX_SPIKES; i++) {
      const impact = i >= MAX_SPIKES - impactCount;
      slot.records.push({
        along: impact ? 1 - Math.random() * 0.08 : Math.pow(Math.random(), 0.85),
        lateral: impact ? (Math.random() * 2 - 1) * 1.25 : (Math.random() * 2 - 1),
        impact,
        heightJitter: Math.random() * 2 - 1,
        yaw: Math.random() * TAU,
        stagger: Math.random(),
        eruptTime: -1,
      });
    }
  }

  /** Drop all active casts (zone change). Counts zero out on the next update. */
  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.records = [];
    }
  }

  update(dt: number): void {
    this.timeUniform.value += dt;
    const used = [0, 0];
    for (const slot of this.slots) {
      if (slot.active) {
        slot.age += dt;
        // Front races out over 0.45s; field stands to 2.4s, sinks by 3.0s.
        const front = saturate(slot.age / 0.45);
        for (const r of slot.records) {
          if (r.eruptTime < 0 && (r.impact ? front >= 1 : r.along <= front)) {
            r.eruptTime = slot.age + r.stagger * 0.12;
          }
        }
        if (slot.age > 3.0) slot.active = false;
      }
      this.writeSlot(slot, used);
    }
    for (let v = 0; v < VARIANTS; v++) {
      this.meshes[v].count = used[v];
      this.meshes[v].instanceMatrix.needsUpdate = true;
      this.births[v].needsUpdate = true;
    }
  }

  private writeSlot(slot: CastSlot, used: number[]): void {
    for (let i = 0; i < slot.records.length; i++) {
      const r = slot.records[i];
      const variant = i % VARIANTS;
      const index = Math.floor(i / VARIANTS);
      // Inactive slot: park instances underground.
      if (!slot.active || r.eruptTime < 0 || slot.age < r.eruptTime) {
        _dummy.position.set(0, -999, 0);
        _dummy.quaternion.identity();
        _dummy.scale.setScalar(0.0001);
        _dummy.updateMatrix();
        this.meshes[variant].setMatrixAt(index, _dummy.matrix);
        this.births[variant].array[index] = 0;
        used[variant] = Math.max(used[variant], index + 1);
        continue;
      }
      const elapsed = slot.age - r.eruptTime;
      const rise = outQuint(saturate(elapsed / 0.22));
      // Punch-through overshoot, then settle.
      const after = elapsed - 0.22;
      const spring = after > 0 ? Math.sin(after * 14) * Math.exp(-after / 0.25) : 0;
      const emerge = rise + (elapsed > 0.22 ? 0.35 * spring : 0);
      // Sink-out in the last 0.6s.
      const retract = slot.age > 2.4 ? saturate((slot.age - 2.4) / 0.6) : 0;

      const h = spikeHeight(r.along, r.heightJitter);
      const radius = 0.32 * (0.72 + 0.43 * saturate(r.along));
      const hw = halfWidth(r.along);
      const px = slot.origin.x + slot.dir.x * r.along * FROST_LANCE_LENGTH + slot.side.x * r.lateral * hw;
      const pz = slot.origin.z + slot.dir.z * r.along * FROST_LANCE_LENGTH + slot.side.z * r.lateral * hw;

      _axis.crossVectors(_up, slot.dir);
      if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0);
      else _axis.normalize();
      _tilt.setFromAxisAngle(_axis, 0.18 * (0.35 + 0.65 * r.along));
      _spin.setFromAxisAngle(_up, r.yaw * 0.4);
      _tilt.multiply(_spin);

      const settled = Math.min(1, Math.max(0, emerge));
      _dummy.position.set(px, (emerge - 1) * h * 0.85 - retract * (h + 0.6), pz);
      _dummy.quaternion.copy(_tilt);
      _dummy.scale.set(radius, h, radius).multiplyScalar(0.86 + 0.14 * settled);
      _dummy.updateMatrix();
      this.meshes[variant].setMatrixAt(index, _dummy.matrix);
      this.births[variant].array[index] = saturate(1 - elapsed / 0.5);
      used[variant] = Math.max(used[variant], index + 1);
    }
  }
}
