/**
 * Meteor rock + impact chunks — Pyromancer meteor visuals + flight driver.
 *
 * MIT License — Copyright (c) 2026 mohamedachrefelouafi
 * Adapted from LinearAbiltyCastingThreeJS (Elemental Sandbox):
 *   - fractured asteroid geometry (fbm lumps + planar cuts + craters)
 *   - burning-rock shading (lava seams as fbm zero-crossings welded to the
 *     rock in local space, soot halo, charge-driven heat-up, leading-face
 *     heat, per-chunk cooling)
 * Adaptations for this codebase: fixed parameters (no live editor), own clock
 * uniform (no shared frame uniforms), plain onBeforeCompile (no custom shadow
 * pass), pooled three-rock driver with per-slot materials, no particle/decal
 * dependencies (the game supplies impact FX through its own pools).
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
/* Vendored GLSL noise (subset used by the rock shader)                */
/* ------------------------------------------------------------------ */

const NOISE_GLSL = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
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
`;

/* ------------------------------------------------------------------ */
/* Vendored asteroid geometry (fixed shape)                            */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

function hash11(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}
function sstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function lattice(ix: number, iy: number, iz: number, seed: number): number {
  return hash11(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 19.19);
}

function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = lattice(ix, iy, iz, seed);
  const c100 = lattice(ix + 1, iy, iz, seed);
  const c010 = lattice(ix, iy + 1, iz, seed);
  const c110 = lattice(ix + 1, iy + 1, iz, seed);
  const c001 = lattice(ix, iy, iz + 1, seed);
  const c101 = lattice(ix + 1, iy, iz + 1, seed);
  const c011 = lattice(ix, iy + 1, iz + 1, seed);
  const c111 = lattice(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

function fbmValue(x: number, y: number, z: number, seed: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * (valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 7.7) * 2 - 1);
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

/** Fractured, cratered rock. Unit space (radius ~1) — instances scale to metres. */
function createAsteroidGeometry(seed = 3, detail = 2): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
  const array = geometry.attributes.position.array as Float32Array;
  const direction = (a: number, b: number): { x: number; y: number; z: number } => {
    const phi = Math.acos(2 * hash11(a) - 1);
    const theta = hash11(b) * TAU;
    const sinPhi = Math.sin(phi);
    return { x: sinPhi * Math.cos(theta), y: Math.cos(phi), z: sinPhi * Math.sin(theta) };
  };
  const planes: { x: number; y: number; z: number; offset: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const n = direction(seed * 2.3 + i * 9.1, seed * 5.7 + i * 4.3);
    planes.push({ ...n, offset: 1 - 0.2 * (0.35 + 0.9 * hash11(seed * 13.1 + i * 6.7)) });
  }
  const bowls: { x: number; y: number; z: number; radius: number; depth: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const c = direction(seed * 3.1 + i * 12.9, seed * 7.7 + i * 5.3);
    bowls.push({
      ...c,
      radius: Math.max(0.08, 0.5 * (0.45 + 0.8 * hash11(seed * 11.3 + i * 3.7))),
      depth: 0.18 * (0.5 + hash11(seed * 17.9 + i * 2.1)),
    });
  }
  for (let i = 0; i < array.length; i += 3) {
    const x = array[i];
    const y = array[i + 1];
    const z = array[i + 2];
    let radius = 1;
    radius += fbmValue(x * 1.5, y * 1.5, z * 1.5, seed, 3) * 0.26;
    radius += fbmValue(x * 6.45, y * 6.45, z * 6.45, seed + 31.7, 2) * 0.08;
    for (const bowl of bowls) {
      const angle = Math.acos(clamp(x * bowl.x + y * bowl.y + z * bowl.z, -1, 1));
      const q = angle / bowl.radius;
      if (q >= 1.4) continue;
      radius -= bowl.depth * Math.max(0, 1 - q * q);
      radius += bowl.depth * 0.5 * sstep(0.72, 1.0, q) * (1 - sstep(1.0, 1.4, q));
    }
    radius = Math.max(0.35, radius);
    let px = x * radius;
    let py = y * radius;
    let pz = z * radius;
    for (const plane of planes) {
      const along = px * plane.x + py * plane.y + pz * plane.z;
      const over = along - plane.offset;
      if (over <= 0) continue;
      px -= plane.x * over;
      py -= plane.y * over;
      pz -= plane.z * over;
    }
    array[i] = px;
    array[i + 1] = py;
    array[i + 2] = pz;
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Burning-rock material (fixed palette)                               */
/* ------------------------------------------------------------------ */

function createRockMaterial(timeUniform: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0.0,
    flatShading: true,
  });
  const uniforms = {
    uTime: timeUniform,
    uColorRock: { value: new THREE.Color(0x4a4038) },
    uColorChar: { value: new THREE.Color(0x191411) },
    uColorCrack: { value: new THREE.Color(0xff5a00) },
    uColorHot: { value: new THREE.Color(0xffdca0) },
    uCharge: { value: 0 },
    uHeading: { value: new THREE.Vector3(0, 0, 1) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aSeed;
         attribute float aHeat;
         varying vec3  vRockLocal;
         varying vec3  vRockNormalW;
         varying float vRockSeed;
         varying float vRockHeat;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vRockLocal = transformed;
         vRockSeed = aSeed;
         vRockHeat = aHeat;
         vRockNormalW = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform vec3  uColorRock;
         uniform vec3  uColorChar;
         uniform vec3  uColorCrack;
         uniform vec3  uColorHot;
         uniform vec3  uHeading;
         uniform float uCharge;
         varying vec3  vRockLocal;
         varying vec3  vRockNormalW;
         varying float vRockSeed;
         varying float vRockHeat;
         ${NOISE_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           vec3  N   = normalize(normal);
           float ndv = clamp(dot(N, normalize(vViewPosition)), 0.0, 1.0);
           float rim = pow(1.0 - ndv, 2.2);
           vec3  p  = vRockLocal * 2.4 + vRockSeed * 19.0;
           float f1 = fbm3(p);
           float f2 = fbm3(p * 2.7 + 11.3);
           float width = max(0.004, 0.1 * (1.0 + uCharge * 0.8));
           float distance = min(abs(f1), abs(f2) / 0.65);
           float fissure = 1.0 - smoothstep(width * 0.35, width, distance);
           float lip     = 1.0 - smoothstep(width, width * 2.0, distance);
           float core    = 1.0 - smoothstep(0.0, width * 0.45, distance);
           float pulse = snoise(vRockLocal * 4.0 + vec3(0.0, uTime * 0.9, 0.0) + vRockSeed * 7.0);
           float flow  = mix(1.0, 0.45 + 0.75 * (pulse * 0.5 + 0.5), 0.7);
           float mottle = fbm3(vRockLocal * 3.4 + vRockSeed * 31.0) * 0.5 + 0.5;
           vec3  rock   = mix(uColorRock, uColorChar, smoothstep(0.3, 0.85, mottle));
           vec3  faceN = normalize(cross(dFdx(vRockLocal), dFdy(vRockLocal)));
           float facet = hash13(faceN * 37.0 + vRockSeed + 0.5);
           rock *= 1.0 + (facet - 0.5) * 0.35;
           float cavity = smoothstep(0.55, 1.0, length(vRockLocal));
           rock *= mix(0.55, 1.0, cavity);
           rock = mix(rock, uColorChar, lip * 0.8);
           rock *= 1.0 - fissure * 0.92;
           rock *= mix(0.55, 1.15, ndv);
           diffuseColor.rgb *= rock;
           float heat = fissure * flow * vRockHeat;
           vec3  glow = mix(uColorCrack, uColorHot, core * core) * heat * 3.2;
           float charge2 = uCharge * uCharge;
           glow += uColorCrack * rim * 1.1 * vRockHeat * charge2;
           float lead = pow(clamp(dot(normalize(vRockNormalW), uHeading), 0.0, 1.0), 2.6);
           glow += uColorHot * lead * 1.6 * vRockHeat * charge2;
           glow /= 1.0 + glow * 0.22;
           totalEmissiveRadiance += glow;
         }`,
      );
  };
  material.customProgramCacheKey = () => 'meteor-rock';
  material.userData.uniforms = uniforms;
  return material;
}

/** Fill a constant per-vertex attribute (seeds / heat on plain meshes). */
function constAttr(geo: THREE.BufferGeometry, name: string, value: number): THREE.BufferAttribute {
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count).fill(value);
  const attr = new THREE.BufferAttribute(arr, 1);
  geo.setAttribute(name, attr);
  return attr;
}

/* ------------------------------------------------------------------ */
/* Flight driver (pooled rocks, per-slot materials)                    */
/* ------------------------------------------------------------------ */

const CHUNKS = 5;

interface Chunk {
  mesh: THREE.Mesh;
  heatAttr: THREE.BufferAttribute;
  vel: THREE.Vector3;
  heat: number;
  active: boolean;
}

interface RockSlot {
  active: boolean;
  impacted: boolean;
  age: number;
  flight: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  rock: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  timeUniform: { value: number };
  spin: THREE.Vector3;
  chunks: Chunk[];
}

/** Lobbed burning rocks: arc down heating up, burst into cooling chunks. */
export class MeteorRocks {
  private slots: RockSlot[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    const rockGeo = createAsteroidGeometry(3, 2);
    constAttr(rockGeo, 'aSeed', 3);
    constAttr(rockGeo, 'aHeat', 1);
    const chunkGeo = createAsteroidGeometry(11, 0);
    for (let s = 0; s < 3; s++) {
      const timeUniform = { value: 0 };
      const mat = createRockMaterial(timeUniform);
      const uniforms = mat.userData.uniforms as Record<string, THREE.IUniform>;
      const rock = new THREE.Mesh(rockGeo, mat);
      rock.scale.setScalar(0.75);
      rock.castShadow = true;
      rock.visible = false;
      scene.add(rock);
      const chunks: Chunk[] = [];
      for (let c = 0; c < CHUNKS; c++) {
        const geo = chunkGeo.clone();
        const heatAttr = constAttr(geo, 'aHeat', 0);
        constAttr(geo, 'aSeed', 3 + s * 7 + c * 1.3);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.scale.setScalar(0.22 + Math.random() * 0.12);
        mesh.castShadow = true;
        mesh.visible = false;
        scene.add(mesh);
        chunks.push({ mesh, heatAttr, vel: new THREE.Vector3(), heat: 0, active: false });
      }
      this.slots.push({
        active: false, impacted: false, age: 0, flight: 0.5,
        from: new THREE.Vector3(), to: new THREE.Vector3(),
        rock, uniforms, timeUniform,
        spin: new THREE.Vector3(),
        chunks,
      });
    }
  }

  /** Lob a rock at (x, z) arriving in `flight` seconds (match the AoE delay). */
  cast(x: number, z: number, flight = 0.5): void {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;
    // Reclaim: hide any lingering chunks from this slot's previous run.
    for (const c of slot.chunks) {
      c.active = false;
      c.mesh.visible = false;
    }
    slot.active = true;
    slot.impacted = false;
    slot.age = 0;
    slot.flight = Math.max(0.1, flight);
    // Lobbed in from up-range so it arcs downrange into the target.
    slot.from.set(x - 9 + Math.random() * 2, 13, z + 3);
    slot.to.set(x, 0.4, z);
    slot.spin.set(2 + Math.random() * 3, 3 + Math.random() * 3, 1 + Math.random() * 2);
    (slot.uniforms.uCharge as { value: number }).value = 0;
    const heading = slot.to.clone().sub(slot.from).normalize();
    (slot.uniforms.uHeading as { value: THREE.Vector3 }).value.copy(heading);
    slot.rock.visible = true;
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      slot.timeUniform.value += dt;
      if (!slot.impacted) {
        const t = Math.min(1, slot.age / slot.flight);
        slot.rock.position.lerpVectors(slot.from, slot.to, t);
        slot.rock.position.y += Math.sin(t * Math.PI) * 4;
        slot.rock.rotation.x += slot.spin.x * dt;
        slot.rock.rotation.y += slot.spin.y * dt;
        slot.rock.rotation.z += slot.spin.z * dt;
        (slot.uniforms.uCharge as { value: number }).value = t;
        if (t >= 1) {
          slot.impacted = true;
          slot.rock.visible = false;
          for (const c of slot.chunks) {
            c.active = true;
            c.heat = 1;
            c.mesh.visible = true;
            c.mesh.position.copy(slot.to);
            c.vel.set((Math.random() - 0.5) * 10, 4 + Math.random() * 5, (Math.random() - 0.5) * 10);
            c.mesh.rotation.set(Math.random() * TAU, Math.random() * TAU, 0);
          }
        }
      } else {
        let alive = false;
        for (const c of slot.chunks) {
          if (!c.active) continue;
          alive = true;
          c.vel.y -= 18 * dt;
          c.mesh.position.addScaledVector(c.vel, dt);
          if (c.mesh.position.y < 0.2) {
            c.mesh.position.y = 0.2;
            c.vel.set(0, 0, 0);
          }
          c.heat = Math.max(0, c.heat - dt / 1.2);
          const arr = c.heatAttr.array as Float32Array;
          arr.fill(c.heat);
          c.heatAttr.needsUpdate = true;
          c.mesh.rotation.x += dt * 2;
          if (c.heat <= 0) {
            c.active = false;
            c.mesh.visible = false;
          }
        }
        if (!alive) slot.active = false;
      }
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.impacted = false;
      slot.rock.visible = false;
      for (const c of slot.chunks) {
        c.active = false;
        c.mesh.visible = false;
      }
    }
  }
}
