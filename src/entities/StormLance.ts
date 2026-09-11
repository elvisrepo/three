/**
 * Storm Lance bolt — Cryomancer extra skill visuals + flight driver.
 *
 * MIT License — Copyright (c) 2026 mohamedachrefelouafi
 * Adapted from LinearAbiltyCastingThreeJS (Elemental Sandbox):
 *   - lightning ribbon geometry (parameter-space `(t, side)` strip)
 *   - bolt vertex/fragment shaders (axis + fan + piecewise-linear kink noise,
 *     camera-facing ribbon, core/glow passes, restrike flicker)
 * Adaptations for this codebase: fixed parameters (no live editor), own clock
 * uniform (no shared frame uniforms), soft-fade against the depth buffer
 * removed (no depth prepass here), single pooled cast, no particle/decal
 * dependencies (the game supplies impact FX through its own Effects pool).
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
/* Vendored GLSL noise (subset used by the bolt shader)                */
/* ------------------------------------------------------------------ */

const NOISE_GLSL = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
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
`;

/* ------------------------------------------------------------------ */
/* Vendored ribbon geometry + bolt shaders (fixed parameters)          */
/* ------------------------------------------------------------------ */

const NODES = 48;
const STRANDS = 8;

function createBoltRibbon(): THREE.InstancedBufferGeometry {
  const steps = NODES;
  const positions = new Float32Array(steps * 2 * 3);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const o = i * 6;
    positions[o] = t;
    positions[o + 1] = -1;
    positions[o + 3] = t;
    positions[o + 4] = 1;
  }
  const indices = new Uint16Array((steps - 1) * 6);
  for (let i = 0; i < steps - 1; i++) {
    const a = i * 2;
    const o = i * 6;
    indices[o] = a;
    indices[o + 1] = a + 1;
    indices[o + 2] = a + 2;
    indices[o + 3] = a + 1;
    indices[o + 4] = a + 3;
    indices[o + 5] = a + 2;
  }
  const strandIndex = new Float32Array(STRANDS);
  for (let i = 0; i < STRANDS; i++) strandIndex[i] = i;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aStrand', new THREE.InstancedBufferAttribute(strandIndex, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.instanceCount = STRANDS;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return geometry;
}

const BOLT_VERTEX = /* glsl */ `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586
  uniform float uTime;
  uniform vec3  uOrigin;
  uniform vec3  uTarget;
  uniform vec3  uSide;
  uniform float uSag;
  uniform float uSeed;
  uniform float uRestrike;
  uniform float uStrands;
  uniform float uSpread;
  uniform float uSpreadNear;
  uniform float uSpreadCurve;
  uniform float uTwist;
  uniform float uTwistSpeed;
  uniform float uJitter;
  uniform float uJitterScale;
  uniform float uOctaves;
  uniform float uJitterFalloff;
  uniform float uCrawl;
  uniform float uPinch;
  uniform float uConverge;
  uniform float uWidth;
  uniform float uWidthTip;
  uniform float uWidthCurve;
  uniform float uCoreWidth;
  uniform float uWidthScale;
  uniform float uStrandFlash;
  uniform float uFlickerSpeed;
  uniform float uFade;
  attribute float aStrand;
  varying float vT;
  varying float vSide;
  varying float vStrand;
  varying float vFlash;
  ${NOISE_GLSL}
  float vnoise(float x, float seed) {
    float i = floor(x);
    float f = x - i;
    return mix(hash11(i + seed), hash11(i + 1.0 + seed), f) * 2.0 - 1.0;
  }
  vec2 kink(float t, float seed, float span) {
    vec2 o = vec2(0.0);
    float amp = 1.0;
    float freq = max(uJitterScale, 0.01) * span;
    float scroll = uTime * uCrawl;
    for (int i = 0; i < 5; i++) {
      float on = step(float(i), uOctaves - 1.0);
      o.x += on * amp * vnoise(t * freq + scroll, seed + 13.0 * float(i));
      o.y += on * amp * vnoise(t * freq + scroll * 1.17, seed + 71.3 + 13.0 * float(i));
      amp *= uJitterFalloff;
      freq *= 2.0;
      scroll *= 1.63;
    }
    return o;
  }
  vec3 boltPoint(float t, float seed, float radial, vec3 n1, vec3 n2, float span) {
    vec3 axis = mix(uOrigin, uTarget, t);
    axis.y += uSag * sin(t * PI);
    float pinch = max(uPinch, 1e-3);
    float ends = smoothstep(0.0, pinch, t) *
                 mix(1.0, smoothstep(0.0, pinch, 1.0 - t), clamp(uConverge, 0.0, 1.0));
    vec2 offset = kink(t, seed, span) * uJitter * ends;
    float angle = seed * TAU + (t * uTwist + uTime * uTwistSpeed) * TAU;
    float reach = mix(uSpreadNear, uSpread, pow(clamp(t, 0.0, 1.0), max(uSpreadCurve, 0.01)));
    offset += vec2(cos(angle), sin(angle)) * reach * radial;
    return axis + n1 * offset.x + n2 * offset.y;
  }
  void main() {
    float t = position.x;
    float side = position.y;
    vT = t;
    vSide = side;
    vec3 delta = uTarget - uOrigin;
    float span = max(length(delta), 0.01);
    vec3 dir = delta / span;
    vec3 n1 = uSide - dir * dot(uSide, dir);
    n1 = length(n1) > 1e-4 ? normalize(n1) : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
    vec3 n2 = normalize(cross(dir, n1));
    float strike = floor(uTime * max(uRestrike, 0.01));
    float seed = hash11(aStrand * 7.13 + uSeed + strike * 3.77) * 97.0;
    float radial = uStrands <= 1.0 ? 0.0 : aStrand / (uStrands - 1.0);
    vStrand = radial;
    vec3 here = boltPoint(t, seed, radial, n1, n2, span);
    float step_ = 0.02;
    float ahead = t + step_;
    float flip = 1.0;
    if (ahead > 1.0) { ahead = t - step_; flip = -1.0; }
    vec3 next = boltPoint(ahead, seed, radial, n1, n2, span);
    vec3 tangent = (next - here) * flip;
    tangent = length(tangent) > 1e-5 ? normalize(tangent) : dir;
    vec3 toCamera = normalize(cameraPosition - here);
    vec3 binormal = cross(tangent, toCamera);
    float bl = length(binormal);
    binormal = bl > 1e-4 ? binormal / bl : n1;
    float flash = mix(1.0, hash11(floor(uTime * uFlickerSpeed) + aStrand * 3.7 + uSeed), uStrandFlash);
    vFlash = flash;
    float halfWidth = uWidth * uWidthScale;
    halfWidth *= mix(1.0, uWidthTip, pow(clamp(t, 0.0, 1.0), max(uWidthCurve, 0.01)));
    halfWidth *= mix(uCoreWidth, 1.0, radial);
    halfWidth *= flash * uFade;
    vec4 mv = viewMatrix * vec4(here + binormal * side * halfWidth, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const BOLT_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uProgress;
  uniform float uTipGlow;
  uniform float uTipLength;
  uniform float uCoreSharp;
  uniform float uGlowFalloff;
  uniform float uBranchDim;
  uniform float uFlicker;
  uniform float uFlickerSpeed;
  uniform float uPassOpacity;
  uniform float uOpacity;
  uniform float uGlow;
  uniform float uFade;
  uniform vec3  uColorCore;
  uniform vec3  uColorInner;
  uniform vec3  uColorOuter;
  uniform vec3  uColorHalo;
  varying float vT;
  varying float vSide;
  varying float vStrand;
  varying float vFlash;
  ${NOISE_GLSL}
  void main() {
    float tip = max(uTipLength, 1e-3);
    float drawn = smoothstep(uProgress, uProgress - tip, vT);
    if (drawn <= 0.002) discard;
    float v = clamp(abs(vSide), 0.0, 1.0);
    #ifdef BOLT_GLOW
      float profile = pow(1.0 - v, max(uGlowFalloff, 0.05));
      vec3 color = mix(uColorHalo, uColorOuter, profile);
      float alpha = profile;
    #else
      float profile = pow(1.0 - v, max(uCoreSharp, 0.05));
      vec3 color = mix(uColorOuter, uColorInner, smoothstep(0.0, 0.5, profile));
      color = mix(color, uColorCore, smoothstep(0.45, 1.0, profile));
      float alpha = profile;
    #endif
    color += uColorCore * smoothstep(uProgress - tip * 2.0, uProgress, vT) * uTipGlow;
    float flicker = 1.0 - uFlicker * hash11(floor(uTime * uFlickerSpeed) + uSeed);
    alpha *= drawn * flicker * vFlash * uFade * uPassOpacity * uOpacity;
    alpha *= mix(1.0, clamp(uBranchDim, 0.0, 1.0), vStrand);
    if (alpha < 0.003) discard;
    color *= uGlow;
    gl_FragColor = vec4(color, alpha);
  }
`;

function createBoltMaterial(glow: boolean, timeUniform: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: glow ? { BOLT_GLOW: '' } : {},
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: timeUniform,
      uOrigin: { value: new THREE.Vector3() },
      uTarget: { value: new THREE.Vector3(0, 0, 1) },
      uSide: { value: new THREE.Vector3(1, 0, 0) },
      uSag: { value: 0.2 },
      uSeed: { value: 0 },
      uRestrike: { value: 24 },
      uProgress: { value: 0 },
      uFade: { value: 1 },
      uStrands: { value: STRANDS },
      uSpread: { value: 0.75 },
      uSpreadNear: { value: 0.05 },
      uSpreadCurve: { value: 1.6 },
      uTwist: { value: 0.45 },
      uTwistSpeed: { value: 0.8 },
      uBranchDim: { value: 0.72 },
      uJitter: { value: 0.34 },
      uJitterScale: { value: 0.85 },
      uOctaves: { value: 4 },
      uJitterFalloff: { value: 0.55 },
      uCrawl: { value: 3.2 },
      uPinch: { value: 0.14 },
      uConverge: { value: 0.8 },
      uWidth: { value: 0.085 },
      uWidthTip: { value: 0.5 },
      uWidthCurve: { value: 1 },
      uCoreWidth: { value: 2.1 },
      uCoreSharp: { value: 3.4 },
      uGlowFalloff: { value: 2.4 },
      uWidthScale: { value: glow ? 8 : 1 },
      uPassOpacity: { value: glow ? 0.32 : 1 },
      uFlicker: { value: 0.3 },
      uFlickerSpeed: { value: 34 },
      uStrandFlash: { value: 0.5 },
      uTipGlow: { value: 2 },
      uTipLength: { value: 0.08 },
      uOpacity: { value: 1 },
      uGlow: { value: 2.3 },
      uColorCore: { value: new THREE.Color(1, 1, 1) },
      uColorInner: { value: new THREE.Color(0.78, 0.92, 1) },
      uColorOuter: { value: new THREE.Color(0.22, 0.62, 1) },
      uColorHalo: { value: new THREE.Color(0.04, 0.24, 0.78) },
    },
    vertexShader: BOLT_VERTEX,
    fragmentShader: BOLT_FRAGMENT,
  });
}

/* ------------------------------------------------------------------ */
/* Flight driver (single pooled cast)                                  */
/* ------------------------------------------------------------------ */

export const STORM_LANCE_LENGTH = 12;

export interface StormPalette {
  core: number;
  inner: number;
  outer: number;
  halo: number;
}

/** Authored storm blue (default) + ember red for Pyromancer. */
export const STORM_BLUE: StormPalette = { core: 0xffffff, inner: 0xc7ebff, outer: 0x389eff, halo: 0x0a3dc7 };
export const STORM_RED: StormPalette = { core: 0xfff6ec, inner: 0xffd9b0, outer: 0xff7b2e, halo: 0x7a1e00 };

/** Storm Lance bolt: travel 0.35s, hold guttering 0.7s, blow out 0.4s. */
export class StormLance {  private meshes: THREE.Mesh[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private timeUniform = { value: 0 };
  private active = false;
  private age = 0;

  constructor(scene: THREE.Scene) {
    const geometry = createBoltRibbon();
    for (const glow of [false, true]) {
      const mat = createBoltMaterial(glow, this.timeUniform);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 15;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.materials.push(mat);
    }
  }

  /** Fire from the caster's hand along dir (normalized, y=0). Optional
   *  palette override (hex) — default is the authored storm blue. */
  cast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    palette?: StormPalette,
  ): void {
    const from = new THREE.Vector3(origin.x, 1.3, origin.z);
    const to = new THREE.Vector3(origin.x + dir.x * STORM_LANCE_LENGTH, 0.8, origin.z + dir.z * STORM_LANCE_LENGTH);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (const mat of this.materials) {
      mat.uniforms.uOrigin.value.copy(from);
      mat.uniforms.uTarget.value.copy(to);
      mat.uniforms.uSide.value.copy(side);
      mat.uniforms.uSeed.value = Math.random() * 100;
      mat.uniforms.uProgress.value = 0;
      mat.uniforms.uFade.value = 1;
      // Shared materials keep the last palette — always set, defaulting blue.
      const pal = palette ?? STORM_BLUE;
      (mat.uniforms.uColorCore.value as THREE.Color).setHex(pal.core);
      (mat.uniforms.uColorInner.value as THREE.Color).setHex(pal.inner);
      (mat.uniforms.uColorOuter.value as THREE.Color).setHex(pal.outer);
      (mat.uniforms.uColorHalo.value as THREE.Color).setHex(pal.halo);
    }
    for (const mesh of this.meshes) mesh.visible = true;
    this.active = true;
    this.age = 0;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age += dt;
    this.timeUniform.value += dt;
    // Travel, hold (restrike/flicker ride uTime for free), blow out.
    const progress = this.age < 0.35 ? this.age / 0.35 : 1;
    const fade = this.age < 1.05 ? 1 : Math.max(0, 1 - (this.age - 1.05) / 0.4);
    for (const mat of this.materials) {
      mat.uniforms.uProgress.value = progress;
      mat.uniforms.uFade.value = fade;
    }
    if (this.age >= 1.45) {
      this.active = false;
      for (const mesh of this.meshes) mesh.visible = false;
    }
  }

  clear(): void {
    this.active = false;
    for (const mesh of this.meshes) mesh.visible = false;
  }
}
