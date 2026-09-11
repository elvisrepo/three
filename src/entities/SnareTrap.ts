/**
 * Voltaic Snare trap — Hunter extra skill visuals + trap driver.
 *
 * MIT License — Copyright (c) 2026 mohamedachrefelouafi
 * Adapted from LinearAbiltyCastingThreeJS (Elemental Sandbox):
 *   - snare cage (one ribbon strip, role-per-instance: leash / twisting
 *     column / outward tendrils / rim arcs, camera-facing, restrike flicker)
 *   - burnt ground field (SDF boundary band, domain-warped veins, pressure
 *     rings, rim ticks, snap overshoot)
 * Adaptations for this codebase: fixed parameters (no live editor), own clock
 * uniform (no shared frame uniforms), soft-fade against the depth buffer
 * removed (no depth prepass here), instant-detonation trap driver (their
 * far-cast trigger replaced: the trap snaps open on landing and burns while
 * standing), no particle/light dependencies (the game supplies impact FX
 * through its own pools).
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
/* Vendored GLSL noise (subset used by the snare shaders)              */
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
/* Vendored cage geometry + shaders (fixed parameters)                 */
/* ------------------------------------------------------------------ */

const NODES = 40;
const COUNT_LEASH = 3;
const COUNT_COLUMN = 8;
const COUNT_TENDRIL = 12;
const COUNT_RIM = 7;
const STRANDS = COUNT_LEASH + COUNT_COLUMN + COUNT_TENDRIL + COUNT_RIM;

function createCageRibbon(): THREE.InstancedBufferGeometry {
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

const CAGE_VERTEX = /* glsl */ `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586
  uniform float uTime;
  uniform vec3  uCentre;
  uniform vec3  uHand;
  uniform vec3  uFront;
  uniform float uRadius;
  uniform float uHeight;
  uniform float uSeed;
  uniform float uRestrike;
  uniform float uFade;
  uniform float uCountLeash;
  uniform float uCountColumn;
  uniform float uCountTendril;
  uniform float uCountRim;
  uniform float uLeashSag;
  uniform float uLeashSpread;
  uniform float uLeashCling;
  uniform float uLeashKink;
  uniform float uLeashWidth;
  uniform float uHeightCurve;
  uniform float uThroat;
  uniform float uColumnSpread;
  uniform float uColumnCurve;
  uniform float uColumnFlare;
  uniform float uColumnTwist;
  uniform float uColumnSpin;
  uniform float uColumnKink;
  uniform float uColumnWidth;
  uniform float uColumnTaper;
  uniform float uTendrilInner;
  uniform float uTendrilReach;
  uniform float uTendrilCurve;
  uniform float uTendrilWander;
  uniform float uTendrilArch;
  uniform float uTendrilHug;
  uniform float uTendrilSpin;
  uniform float uTendrilKink;
  uniform float uTendrilWidth;
  uniform float uTendrilDim;
  uniform float uRimSpan;
  uniform float uRimSpeed;
  uniform float uRimHeight;
  uniform float uRimJitter;
  uniform float uRimKink;
  uniform float uRimWidth;
  uniform float uRimDim;
  uniform float uJitter;
  uniform float uJitterScale;
  uniform float uOctaves;
  uniform float uJitterFalloff;
  uniform float uCrawl;
  uniform float uPinch;
  uniform float uWidth;
  uniform float uWidthScale;
  uniform float uStrandFlash;
  uniform float uFlickerSpeed;
  attribute float aStrand;
  varying float vT;
  varying float vSide;
  varying float vDim;
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
  vec3 pathAt(float role, float f, float seed, float t) {
    if (role < 0.5) {
      vec3 p = mix(uHand, uFront, t);
      p.y += uLeashSag * sin(t * PI);
      p.y = max(p.y, uLeashCling);
      return p;
    }
    if (role < 1.5) {
      float a = f * TAU + (t * uColumnTwist + uTime * uColumnSpin) * TAU;
      float r = uRadius * (mix(uThroat, uColumnSpread, pow(t, max(uColumnCurve, 0.01)))
                           + uColumnFlare * smoothstep(0.72, 1.0, t));
      vec3 p = uCentre + vec3(cos(a), 0.0, sin(a)) * r;
      p.y = pow(t, max(uHeightCurve, 0.01)) * uHeight;
      return p;
    }
    if (role < 2.5) {
      float veer = (hash11(seed + 5.0) - 0.5) * 2.0 * uTendrilWander;
      float a = f * TAU + uTime * uTendrilSpin * TAU + hash11(seed) * 0.4 + veer * pow(t, 1.4);
      float r = uRadius * mix(uTendrilInner, uTendrilReach, pow(t, max(uTendrilCurve, 0.01)));
      vec3 p = uCentre + vec3(cos(a), 0.0, sin(a)) * r;
      p.y = uTendrilHug + uTendrilArch * sin(t * PI);
      return p;
    }
    float a = (f + uTime * uRimSpeed) * TAU + hash11(seed) * 0.3 + t * uRimSpan * TAU;
    float r = uRadius * (1.0 + uRimJitter * 0.25 * sin(t * 6.0 + seed));
    vec3 p = uCentre + vec3(cos(a), 0.0, sin(a)) * r;
    p.y = uTendrilHug + uRimHeight * sin(t * PI);
    return p;
  }
  void main() {
    float t = position.x;
    float side = position.y;
    vT = t;
    vSide = side;
    float b1 = uCountLeash;
    float b2 = b1 + uCountColumn;
    float b3 = b2 + uCountTendril;
    float role = 0.0;
    float local = aStrand;
    float count = max(uCountLeash, 1.0);
    if (aStrand >= b3) {
      role = 3.0; local = aStrand - b3; count = max(uCountRim, 1.0);
    } else if (aStrand >= b2) {
      role = 2.0; local = aStrand - b2; count = max(uCountTendril, 1.0);
    } else if (aStrand >= b1) {
      role = 1.0; local = aStrand - b1; count = max(uCountColumn, 1.0);
    }
    float f = local / count;
    float strike = floor(uTime * max(uRestrike, 0.01));
    float seed = hash11(aStrand * 7.13 + uSeed + strike * 3.77) * 97.0;
    float amp = uLeashKink;
    float widthMul = uLeashWidth;
    float span = max(length(uFront - uHand), 0.01);
    float dim = 1.0;
    if (role > 2.5) {
      amp = uRimKink; widthMul = uRimWidth; dim = uRimDim;
      span = max(uRadius * uRimSpan * TAU, 0.01);
    } else if (role > 1.5) {
      amp = uTendrilKink; widthMul = uTendrilWidth; dim = uTendrilDim;
      span = max(uRadius * max(uTendrilReach - uTendrilInner, 0.05), 0.01);
    } else if (role > 0.5) {
      amp = uColumnKink; widthMul = uColumnWidth;
      span = max(uHeight, 0.01);
    }
    vDim = dim;
    float step_ = 0.02;
    vec3 here = pathAt(role, f, seed, t);
    vec3 behind = pathAt(role, f, seed, max(t - step_, 0.0));
    vec3 ahead = pathAt(role, f, seed, min(t + step_, 1.0));
    vec3 tangent = ahead - behind;
    tangent = length(tangent) > 1e-5 ? normalize(tangent) : vec3(0.0, 1.0, 0.0);
    vec3 upRef = abs(tangent.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 n1 = normalize(cross(tangent, upRef));
    vec3 n2 = normalize(cross(tangent, n1));
    float pinch = max(uPinch, 1e-3);
    float ends = smoothstep(0.0, pinch, t) * smoothstep(0.0, pinch, 1.0 - t);
    vec2 k = kink(t, seed, span) * amp * uJitter * ends;
    if (role < 0.5) {
      float fan = (f - 0.5) * 2.0 * uLeashSpread;
      k += vec2(cos(seed), sin(seed)) * fan * ends;
    }
    vec3 offset = n1 * k.x + n2 * k.y;
    if (role > 1.5) offset.y *= 0.3;
    vec3 world = here + offset;
    vec3 nextWorld = ahead + offset;
    if (role > 1.5) {
      world.y = max(world.y, uTendrilHug * 0.4);
      nextWorld.y = max(nextWorld.y, uTendrilHug * 0.4);
    }
    vec3 tan2 = nextWorld - world;
    tan2 = length(tan2) > 1e-5 ? normalize(tan2) : tangent;
    vec3 toCamera = normalize(cameraPosition - world);
    vec3 binormal = cross(tan2, toCamera);
    float bl = length(binormal);
    binormal = bl > 1e-4 ? binormal / bl : n1;
    float flash = mix(1.0, hash11(floor(uTime * uFlickerSpeed) + aStrand * 3.7 + uSeed), uStrandFlash);
    vFlash = flash;
    float halfWidth = uWidth * uWidthScale * widthMul;
    halfWidth *= mix(1.0, pow(sin(clamp(t, 0.0, 1.0) * PI), 0.35), 0.85);
    if (role > 0.5 && role < 1.5) halfWidth *= mix(1.0, uColumnTaper, t);
    halfWidth *= flash * uFade;
    vec4 mv = viewMatrix * vec4(world + binormal * side * halfWidth, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const CAGE_FRAGMENT = /* glsl */ `
  #define PI 3.141592653589793
  uniform float uTime;
  uniform float uSeed;
  uniform float uCoreSharp;
  uniform float uGlowFalloff;
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
  uniform float uGlobalGlow;
  varying float vT;
  varying float vSide;
  varying float vDim;
  varying float vFlash;
  ${NOISE_GLSL}
  void main() {
    float v = clamp(abs(vSide), 0.0, 1.0);
    #ifdef CAGE_GLOW
      float profile = pow(1.0 - v, max(uGlowFalloff, 0.05));
      vec3 color = mix(uColorHalo, uColorOuter, profile);
      float alpha = profile;
    #else
      float profile = pow(1.0 - v, max(uCoreSharp, 0.05));
      vec3 color = mix(uColorOuter, uColorInner, smoothstep(0.0, 0.5, profile));
      color = mix(color, uColorCore, smoothstep(0.45, 1.0, profile));
      float alpha = profile;
    #endif
    float flicker = 1.0 - uFlicker * hash11(floor(uTime * uFlickerSpeed) + uSeed);
    alpha *= pow(sin(clamp(vT, 0.0, 1.0) * PI), 0.35);
    alpha *= flicker * vFlash * vDim * uFade * uPassOpacity * uOpacity;
    if (alpha < 0.003) discard;
    color *= uGlow * uGlobalGlow;
    gl_FragColor = vec4(color, alpha);
  }
`;

function makeCageUniforms(timeUniform: { value: number }): Record<string, THREE.IUniform> {
  const v3 = (x: number, y: number, z: number): { value: THREE.Vector3 } => ({ value: new THREE.Vector3(x, y, z) });
  const f = (x: number): { value: number } => ({ value: x });
  return {
    uTime: timeUniform,
    uCentre: v3(0, 0, 0), uHand: v3(0, 0, 0), uFront: v3(0, 0, 1),
    uRadius: f(4.5), uHeight: f(6.2), uSeed: f(0), uRestrike: f(21), uFade: f(1),
    uCountLeash: f(COUNT_LEASH), uCountColumn: f(COUNT_COLUMN),
    uCountTendril: f(COUNT_TENDRIL), uCountRim: f(COUNT_RIM),
    uLeashSag: f(-0.35), uLeashSpread: f(0.22), uLeashCling: f(0.12),
    uLeashKink: f(0.3), uLeashWidth: f(1),
    uHeightCurve: f(0.85), uThroat: f(0.07), uColumnSpread: f(0.17), uColumnCurve: f(1.35),
    uColumnFlare: f(0.12), uColumnTwist: f(0.55), uColumnSpin: f(0.4),
    uColumnKink: f(0.24), uColumnWidth: f(1.6), uColumnTaper: f(0.55),
    uTendrilInner: f(0.06), uTendrilReach: f(1), uTendrilCurve: f(0.8),
    uTendrilWander: f(0.9), uTendrilArch: f(0.22), uTendrilHug: f(0.05),
    uTendrilSpin: f(0.05), uTendrilKink: f(0.18), uTendrilWidth: f(0.75), uTendrilDim: f(0.8),
    uRimSpan: f(0.19), uRimSpeed: f(0.28), uRimHeight: f(0.35), uRimJitter: f(0.16),
    uRimKink: f(0.12), uRimWidth: f(0.7), uRimDim: f(0.9),
    uJitter: f(1), uJitterScale: f(1.4), uOctaves: f(4), uJitterFalloff: f(0.55),
    uCrawl: f(2.4), uPinch: f(0.16),
    uWidth: f(0.032), uWidthScale: f(1), uStrandFlash: f(0.45), uFlickerSpeed: f(30),
    uFlicker: f(0.26), uCoreSharp: f(4.4), uGlowFalloff: f(2.3),
    uPassOpacity: f(1), uOpacity: f(1), uGlow: f(2.2), uGlobalGlow: f(1),
    uColorCore: { value: new THREE.Color(1, 1, 1) },
    uColorInner: { value: new THREE.Color(0.86, 0.82, 1) },
    uColorOuter: { value: new THREE.Color(0.56, 0.42, 1) },
    uColorHalo: { value: new THREE.Color(0.16, 0.05, 0.55) },
  };
}

function createCageMaterial(glow: boolean, timeUniform: { value: number }): THREE.ShaderMaterial {
  const uniforms = makeCageUniforms(timeUniform);
  if (glow) {
    (uniforms.uWidthScale as { value: number }).value = 6.2;
    (uniforms.uPassOpacity as { value: number }).value = 0.44;
  }
  return new THREE.ShaderMaterial({
    defines: glow ? { CAGE_GLOW: '' } : {},
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: CAGE_VERTEX,
    fragmentShader: CAGE_FRAGMENT,
  });
}

/* ------------------------------------------------------------------ */
/* Vendored ground field (fixed parameters)                            */
/* ------------------------------------------------------------------ */

const FIELD_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uQuadSize;
  uniform float uRadius;
  uniform float uBoundary;
  uniform float uBoundaryGlow;
  uniform float uFill;
  uniform float uFalloff;
  uniform float uVeins;
  uniform float uVeinScale;
  uniform float uVeinSharp;
  uniform float uWarp;
  uniform float uCrawl;
  uniform float uRings;
  uniform float uRingSpeed;
  uniform float uSpokes;
  uniform float uSpokeLength;
  uniform float uSpin;
  uniform float uCore;
  uniform float uCoreSize;
  uniform float uPulse;
  uniform float uPulseSpeed;
  uniform float uSeed;
  uniform float uFade;
  uniform float uOpacity;
  uniform vec3  uColorField;
  uniform vec3  uColorEdge;
  uniform float uGlobalGlow;
  varying vec2 vUv;
  ${NOISE_GLSL}
  #define TAU 6.28318530718
  void main() {
    vec2 p = vec2(vUv.x - 0.5, 0.5 - vUv.y) * uQuadSize;
    float d = length(p);
    float outer = uRadius + uBoundary * 0.4;
    float inner = max(0.01, uRadius - uBoundary * 0.6);
    float aa = fwidth(d) + 0.02;
    if (d > outer + aa * 4.0) discard;
    float band = smoothstep(outer + aa, outer - aa, d) * smoothstep(inner - aa, inner + aa, d);
    float interior = smoothstep(inner + aa, inner - aa, d);
    float radial = clamp(d / inner, 0.0, 1.0);
    float warp = fbm3(vec3(p * 0.5, uTime * 0.2 + uSeed)) * uWarp;
    float fil = ridged(vec3(p * uVeinScale + warp, uSeed * 11.0 + uTime * uCrawl));
    float veins = smoothstep(mix(0.55, 0.86, uVeinSharp), 0.98, fil) * interior * uVeins;
    float ring = 0.5 + 0.5 * cos((radial * uRings - uTime * uRingSpeed) * TAU);
    ring = pow(ring, 8.0) * interior;
    float ang = atan(p.y, p.x) / TAU + 0.5;
    float spokePhase = fract(ang * uSpokes + uTime * uSpin * uSpokes);
    float spoke = 1.0 - smoothstep(0.22, 0.3, spokePhase);
    spoke *= smoothstep(inner - uSpokeLength, inner, d) * smoothstep(outer, inner, d);
    float core = smoothstep(uCoreSize * uRadius, 0.0, d) * uCore;
    float breathe = 1.0 + uPulse * sin(uTime * uPulseSpeed * TAU);
    float wash = interior * pow(radial, uFalloff) * uFill;
    float lines = (band * uBoundaryGlow + spoke + core + ring * 0.35) * breathe;
    float body = (wash + veins * 0.9) * breathe;
    float alpha = clamp(body + lines, 0.0, 1.0) * uFade * uOpacity;
    if (alpha < 0.004) discard;
    vec3 color = uColorField * body + uColorEdge * lines;
    gl_FragColor = vec4(color * uGlobalGlow, alpha);
  }
`;

function createFieldMaterial(timeUniform: { value: number }): THREE.ShaderMaterial {
  const f = (x: number): { value: number } => ({ value: x });
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: timeUniform,
      uQuadSize: f(12), uRadius: f(0), uBoundary: f(0.4), uBoundaryGlow: f(2.6),
      uFill: f(0.3), uFalloff: f(1.7), uVeins: f(1), uVeinScale: f(1.5), uVeinSharp: f(0.72),
      uWarp: f(0.55), uCrawl: f(0.5), uRings: f(2.4), uRingSpeed: f(0.8),
      uSpokes: f(20), uSpokeLength: f(0.5), uSpin: f(0.05),
      uCore: f(1.3), uCoreSize: f(0.22), uPulse: f(0.3), uPulseSpeed: f(3.4),
      uSeed: f(0), uFade: f(0), uOpacity: f(1), uGlobalGlow: f(1),
      uColorField: { value: new THREE.Color(0.56, 0.42, 1) },
      uColorEdge: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: FIELD_FRAGMENT,
  });
}

/* ------------------------------------------------------------------ */
/* Trap driver (single pooled trap)                                    */
/* ------------------------------------------------------------------ */

export const SNARE_RADIUS = 4.5;

/** Voltaic Snare: leash throw, snap open, hold burning, collapse. */
export class SnareTrap {
  private cage: THREE.Mesh[] = [];
  private cageMats: THREE.ShaderMaterial[] = [];
  private field!: THREE.Mesh;
  private fieldMat!: THREE.ShaderMaterial;
  private timeUniform = { value: 0 };
  private active = false;
  private age = 0;
  private hand = new THREE.Vector3();
  private centre = new THREE.Vector3();
  private seed = 0;

  constructor(scene: THREE.Scene) {
    const ribbon = createCageRibbon();
    for (const glow of [false, true]) {
      const mat = createCageMaterial(glow, this.timeUniform);
      const mesh = new THREE.Mesh(ribbon, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 15;
      scene.add(mesh);
      this.cage.push(mesh);
      this.cageMats.push(mat);
    }
    this.fieldMat = createFieldMaterial(this.timeUniform);
    this.field = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), this.fieldMat);
    this.field.rotation.x = -Math.PI / 2;
    this.field.position.y = 0.06;
    this.field.visible = false;
    this.field.renderOrder = 14;
    scene.add(this.field);
  }

  /** Whip a trap from the caster's hand to (x, z). Burns on landing. */
  cast(origin: THREE.Vector3, x: number, z: number): void {
    this.hand.set(origin.x, 1.2, origin.z);
    this.centre.set(x, 0, z);
    this.seed = Math.random() * 100;
    this.field.position.set(x, 0.06, z);
    for (const mat of this.cageMats) {
      mat.uniforms.uHand.value.copy(this.hand);
      mat.uniforms.uCentre.value.copy(this.centre);
      mat.uniforms.uFront.value.copy(this.hand);
      mat.uniforms.uSeed.value = this.seed;
      mat.uniforms.uRadius.value = 0;
      mat.uniforms.uFade.value = 1;
      mat.uniforms.uCountLeash.value = 3;
      mat.uniforms.uCountColumn.value = 0;
      mat.uniforms.uCountTendril.value = 0;
      mat.uniforms.uCountRim.value = 0;
    }
    this.fieldMat.uniforms.uSeed.value = this.seed;
    this.fieldMat.uniforms.uRadius.value = 0;
    this.fieldMat.uniforms.uFade.value = 0;
    for (const mesh of this.cage) mesh.visible = true;
    this.field.visible = true;
    this.active = true;
    this.age = 0;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age += dt;
    this.timeUniform.value += dt;
    // Throw 0–0.35s (leash only), snap 0.35–0.6s (overshoot past radius),
    // hold burning to 2.6s, collapse to 3.1s.
    const snapped = this.age >= 0.35;
    let radius = 0;
    if (snapped) {
      const s = Math.min(1, (this.age - 0.35) / 0.25);
      const ease = 1 - Math.pow(1 - s, 3);
      radius = SNARE_RADIUS * ease * (1 + 0.22 * Math.sin(s * Math.PI));
    }
    const fade = this.age < 2.6 ? 1 : Math.max(0, 1 - (this.age - 2.6) / 0.5);
    const frontT = Math.min(1, this.age / 0.35);
    for (const mat of this.cageMats) {
      mat.uniforms.uFront.value.lerpVectors(this.hand, this.centre, frontT);
      mat.uniforms.uFront.value.y = 1.2 - frontT * 1.1;
      mat.uniforms.uRadius.value = radius;
      mat.uniforms.uFade.value = fade;
      mat.uniforms.uCountLeash.value = snapped ? 0 : 3;
      mat.uniforms.uCountColumn.value = snapped ? COUNT_COLUMN : 0;
      mat.uniforms.uCountTendril.value = snapped ? COUNT_TENDRIL : 0;
      mat.uniforms.uCountRim.value = snapped ? COUNT_RIM : 0;
    }
    // Field snaps with the cage, then holds at full radius while burning.
    this.fieldMat.uniforms.uRadius.value = snapped ? SNARE_RADIUS : 0;
    this.fieldMat.uniforms.uFade.value = snapped ? fade : 0;
    if (this.age >= 3.1) {
      this.active = false;
      for (const mesh of this.cage) mesh.visible = false;
      this.field.visible = false;
    }
  }

  clear(): void {
    this.active = false;
    for (const mesh of this.cage) mesh.visible = false;
    this.field.visible = false;
  }
}
