/**
 * Nova Beam column — Cryomancer extra skill visuals + firing driver.
 *
 * MIT License — Copyright (c) 2026 mohamedachrefelouafi
 * Adapted from LinearAbiltyCastingThreeJS (Elemental Sandbox):
 *   - beam tube / coil ribbon / shock-disc geometries (parameter-space
 *     `(t, a)` builders)
 *   - beam shaders (rim-weighted shell + axis-weighted core volume trick,
 *     helical coils, clock-driven shock-disc train, charge orb)
 * Adaptations for this codebase: fixed parameters (no live editor), own clock
 * uniform (no shared frame uniforms), soft-fade against the depth buffer
 * removed (no depth prepass here), single pooled cast, no particle/light
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
/* Vendored GLSL noise (subset used by the beam shader)                */
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
float fbm4(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * snoise(p);
    p = p * 2.03 + vec3(17.3, 5.1, 9.7);
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
/* Vendored geometries                                                 */
/* ------------------------------------------------------------------ */

function createBeamTube(nodes = 48, sides = 20): THREE.BufferGeometry {
  const steps = nodes;
  const facets = sides;
  const columns = facets + 1;
  const positions = new Float32Array(steps * columns * 3);
  let v = 0;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    for (let j = 0; j < columns; j++) {
      positions[v++] = t;
      positions[v++] = j / facets;
      positions[v++] = 0;
    }
  }
  const indices = new Uint16Array((steps - 1) * facets * 6);
  let k = 0;
  for (let i = 0; i < steps - 1; i++) {
    for (let j = 0; j < facets; j++) {
      const a = i * columns + j;
      const b = a + columns;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = a + 1;
      indices[k++] = b;
      indices[k++] = b + 1;
      indices[k++] = a + 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return geometry;
}

const COIL_STRANDS = 3;

function createCoilRibbon(nodes = 48): THREE.InstancedBufferGeometry {
  const steps = nodes;
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
  const strandIndex = new Float32Array(COIL_STRANDS);
  for (let i = 0; i < COIL_STRANDS; i++) strandIndex[i] = i;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aStrand', new THREE.InstancedBufferAttribute(strandIndex, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.instanceCount = COIL_STRANDS;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return geometry;
}

const RING_COUNT = 6;

function createBeamRings(segments = 32): THREE.InstancedBufferGeometry {
  const facets = segments;
  const columns = facets + 1;
  const positions = new Float32Array(2 * columns * 3);
  let v = 0;
  for (let band = 0; band < 2; band++) {
    for (let j = 0; j < columns; j++) {
      positions[v++] = band;
      positions[v++] = j / facets;
      positions[v++] = 0;
    }
  }
  const indices = new Uint16Array(facets * 6);
  let k = 0;
  for (let j = 0; j < facets; j++) {
    const a = j;
    const b = columns + j;
    indices[k++] = a;
    indices[k++] = b;
    indices[k++] = a + 1;
    indices[k++] = b;
    indices[k++] = b + 1;
    indices[k++] = a + 1;
  }
  const ringIndex = new Float32Array(RING_COUNT);
  for (let i = 0; i < RING_COUNT; i++) ringIndex[i] = i;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRing', new THREE.InstancedBufferAttribute(ringIndex, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.instanceCount = RING_COUNT;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Vendored beam shaders (fixed parameters)                            */
/* ------------------------------------------------------------------ */

const BEAM_UNIFORMS = /* glsl */ `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586
  uniform float uTime;
  uniform vec3  uOrigin;
  uniform vec3  uTarget;
  uniform vec3  uSide;
  uniform float uSeed;
  uniform float uProgress;
  uniform float uFade;
  uniform float uWidthFade;
  uniform float uCharge;
  uniform float uRadius;
  uniform float uRadiusNear;
  uniform float uRadiusCurve;
  uniform float uRadiusScale;
  uniform float uFlare;
  uniform float uFlareWidth;
  uniform float uThrob;
  uniform float uThrobScale;
  uniform float uThrobSpeed;
  uniform float uWander;
  uniform float uWanderScale;
  uniform float uWanderSpeed;
  uniform float uRipple;
  uniform float uRippleBands;
  uniform float uRippleScale;
  uniform float uRippleSpeed;
  uniform float uStreak;
  uniform float uStreakSharp;
  uniform float uStreakScale;
  uniform float uStreakBands;
  uniform float uStreakGlow;
  uniform float uFlowSpeed;
  uniform float uCoreSharp;
  uniform float uCoreFill;
  uniform float uEdgePower;
  uniform float uShellRim;
  uniform float uShellFill;
  uniform float uHaloRim;
  uniform float uPassOpacity;
  uniform float uMouthGlow;
  uniform float uMouthLength;
  uniform float uTipGlow;
  uniform float uTipLength;
  uniform float uCoils;
  uniform float uCoilTurns;
  uniform float uCoilSpeed;
  uniform float uCoilRadius;
  uniform float uCoilFlare;
  uniform float uCoilWidth;
  uniform float uCoilWidthTip;
  uniform float uCoilSharp;
  uniform float uCoilPulse;
  uniform float uCoilPulseFreq;
  uniform float uCoilPulseSpeed;
  uniform float uRingCount;
  uniform float uRingSpeed;
  uniform float uRingInner;
  uniform float uRingOuter;
  uniform float uRingSwell;
  uniform float uRingFade;
  uniform float uRingSharp;
  uniform float uOrbTurbulence;
  uniform float uOrbScale;
  uniform float uOrbFlow;
  uniform float uOrbBands;
  uniform float uOrbRim;
  uniform float uOpacity;
  uniform float uGlow;
  uniform vec3  uColorCore;
  uniform vec3  uColorInner;
  uniform vec3  uColorOuter;
  uniform vec3  uColorHalo;
  uniform vec3  uColorCoil;
  uniform vec3  uColorCoilEdge;
  uniform vec3  uColorRing;
`;

const BEAM_VARYINGS = /* glsl */ `
  varying float vT;
  varying float vViewZ;
  #if BEAM_PASS <= 2
    varying float vA;
    varying float vFacing;
  #elif BEAM_PASS == 3
    varying float vSide;
  #elif BEAM_PASS == 4
    varying float vBand;
    varying float vPhase;
  #else
    varying vec3  vNormalW;
    varying vec3  vViewDir;
    varying float vDisp;
  #endif
`;

const BEAM_SHAPE = /* glsl */ `
  float beamRadius(float t) {
    float u = clamp(t, 0.0, 1.0);
    float r = mix(uRadiusNear, uRadius, pow(u, max(uRadiusCurve, 0.01)));
    r *= 1.0 + uThrob * sin((u * uThrobScale - uTime * uThrobSpeed) * TAU);
    r *= 1.0 + uFlare * smoothstep(1.0 - max(uFlareWidth, 1e-3), 1.0, u);
    return max(r * uRadiusScale * uWidthFade, 1e-4);
  }
  void beamFrame(out vec3 dir, out vec3 n1, out vec3 n2) {
    vec3 delta = uTarget - uOrigin;
    float span = max(length(delta), 0.01);
    dir = delta / span;
    vec3 lateral = uSide - dir * dot(uSide, dir);
    n1 = length(lateral) > 1e-4 ? normalize(lateral) : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
    n2 = normalize(cross(dir, n1));
  }
  vec3 beamAxis(float t, vec3 n1, vec3 n2) {
    vec3 p = mix(uOrigin, uTarget, t);
    float ends = sin(clamp(t, 0.0, 1.0) * PI);
    float dx = snoise(vec3(t * uWanderScale, uTime * uWanderSpeed, uSeed));
    float dy = snoise(vec3(t * uWanderScale + 31.7, uTime * uWanderSpeed, uSeed + 7.3));
    return p + (n1 * dx + n2 * dy) * uWander * ends;
  }
`;

const BEAM_VERTEX = /* glsl */ `
  ${BEAM_UNIFORMS}
  ${BEAM_VARYINGS}
  #if BEAM_PASS == 3
    attribute float aStrand;
  #endif
  #if BEAM_PASS == 4
    attribute float aRing;
  #endif
  ${NOISE_GLSL}
  ${BEAM_SHAPE}
  #if BEAM_PASS == 3
    vec3 coilPoint(float t, float phase, vec3 n1, vec3 n2) {
      float angle = (t * uCoilTurns + uTime * uCoilSpeed + phase) * TAU;
      float r = beamRadius(t) * uCoilRadius * (1.0 + uCoilFlare * pow(clamp(t, 0.0, 1.0), 3.0));
      return beamAxis(t, n1, n2) + (n1 * cos(angle) + n2 * sin(angle)) * r;
    }
  #endif
  void main() {
    vec3 dir, n1, n2;
    #if BEAM_PASS != 5
      beamFrame(dir, n1, n2);
    #endif
    #if BEAM_PASS <= 2
      float t = position.x;
      float a = position.y;
      float angle = a * TAU;
      vec3 nrm = n1 * cos(angle) + n2 * sin(angle);
      float rip = snoise(vec3(
        cos(angle) * uRippleBands,
        sin(angle) * uRippleBands,
        t * uRippleScale - uTime * uRippleSpeed + uSeed
      ));
      float r = beamRadius(t) * (1.0 + uRipple * rip);
      vec3 here = beamAxis(t, n1, n2) + nrm * r;
      vT = t;
      vA = a;
      vFacing = abs(dot(normalize(cameraPosition - here), nrm));
    #elif BEAM_PASS == 3
      float t = position.x;
      vSide = position.y;
      vT = t;
      float phase = uCoils <= 1.0 ? 0.0 : aStrand / uCoils;
      phase += hash11(aStrand * 5.31 + uSeed) * 0.12;
      vec3 here = coilPoint(t, phase, n1, n2);
      float step_ = 0.015;
      float ahead = t + step_;
      float flip = 1.0;
      if (ahead > 1.0) { ahead = t - step_; flip = -1.0; }
      vec3 tangent = (coilPoint(ahead, phase, n1, n2) - here) * flip;
      tangent = length(tangent) > 1e-5 ? normalize(tangent) : dir;
      vec3 binormal = cross(tangent, normalize(cameraPosition - here));
      float bl = length(binormal);
      binormal = bl > 1e-4 ? binormal / bl : n1;
      float halfWidth = uCoilWidth * mix(1.0, uCoilWidthTip, clamp(t, 0.0, 1.0));
      halfWidth *= smoothstep(0.0, 0.05, t) * uWidthFade * uFade;
      here += binormal * position.y * halfWidth;
    #elif BEAM_PASS == 4
      float phase = fract(aRing / max(uRingCount, 1.0) + uTime * uRingSpeed + uSeed * 0.37);
      float t = phase;
      float angle = position.y * TAU;
      float r = beamRadius(t) * mix(uRingInner, uRingOuter, position.x) * (1.0 + uRingSwell * phase);
      vec3 here = beamAxis(t, n1, n2) + (n1 * cos(angle) + n2 * sin(angle)) * r;
      vT = t;
      vBand = position.x;
      vPhase = phase;
    #else
      vec3 np = normal * uOrbScale + vec3(uSeed * 3.1) - vec3(0.0, uTime * uOrbFlow, 0.0);
      float n = fbm4(np) * 0.6 + ridged(np * 1.4) * 0.4;
      vDisp = n;
      vec4 world = modelMatrix * vec4(position + normal * n * uOrbTurbulence, 1.0);
      vec3 here = world.xyz;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vViewDir = cameraPosition - here;
      vT = 0.0;
    #endif
    vec4 mv = viewMatrix * vec4(here, 1.0);
    vViewZ = mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  ${BEAM_UNIFORMS}
  ${BEAM_VARYINGS}
  uniform float uGlobalGlow;
  ${NOISE_GLSL}
  void main() {
    vec3 color = vec3(0.0);
    float alpha = 0.0;
    #if BEAM_PASS == 5
      float facing = abs(dot(normalize(vViewDir), normalize(vNormalW)));
      float rim = pow(1.0 - facing, max(uOrbRim, 0.05));
      float heat = clamp(vDisp * 0.5 + 0.5, 0.0, 1.0);
      float fil = smoothstep(0.74, 0.98,
        ridged(vNormalW * uOrbBands + vec3(0.0, uTime * uOrbFlow * 2.0, 0.0) + uSeed, 4));
      color = mix(uColorOuter, uColorInner, heat);
      color = mix(color, uColorCore, clamp(fil + rim * 0.35, 0.0, 1.0));
      color += uColorCore * fil * 1.6;
      alpha = (0.2 + rim * 0.9 + fil * 0.75) * uCharge;
    #else
      float tip = max(uTipLength, 1e-3);
      float drawn = smoothstep(uProgress, uProgress - tip, vT);
      if (drawn <= 0.002) discard;
      #if BEAM_PASS <= 2
        float angle = vA * TAU;
        float flow = ridged(vec3(
          vT * uStreakScale - uTime * uFlowSpeed,
          cos(angle) * uStreakBands,
          sin(angle) * uStreakBands + uSeed
        ));
        float streak = smoothstep(mix(0.42, 0.86, clamp(uStreakSharp, 0.0, 1.0)), 0.99, flow) * uStreak;
        float facing = clamp(vFacing, 0.0, 1.0);
        float axisward = pow(facing, max(uCoreSharp, 0.05));
        float rim = pow(1.0 - facing, max(uEdgePower, 0.05));
        #if BEAM_PASS == 0
          color = mix(uColorInner, uColorCore, clamp(0.35 + streak, 0.0, 1.0));
          alpha = uCoreFill * mix(0.28, 1.0, axisward) + streak * 0.35;
        #elif BEAM_PASS == 1
          color = mix(uColorOuter, uColorInner, clamp(rim * 0.55 + streak, 0.0, 1.0));
          color += uColorCore * streak * uStreakGlow;
          alpha = rim * uShellRim + uShellFill * mix(0.12, 1.0, axisward) + streak * 0.4;
        #else
          float wide = pow(1.0 - facing, max(uHaloRim, 0.05));
          color = mix(uColorHalo, uColorOuter, wide);
          alpha = wide;
        #endif
        float mouth = smoothstep(uMouthLength, 0.0, vT);
        color += uColorCore * mouth * uMouthGlow;
        alpha += mouth * uMouthGlow * 0.2;
        float lead = smoothstep(uProgress - tip * 2.0, uProgress, vT);
        color += uColorCore * lead * uTipGlow;
        alpha += lead * uTipGlow * 0.18;
      #elif BEAM_PASS == 3
        float v = clamp(abs(vSide), 0.0, 1.0);
        float profile = pow(1.0 - v, max(uCoilSharp, 0.05));
        float pulse = 0.5 + 0.5 * sin((vT * uCoilPulseFreq - uTime * uCoilPulseSpeed) * TAU);
        color = mix(uColorCoilEdge, uColorCoil, profile);
        color += uColorCore * pulse * profile * uCoilPulse;
        alpha = profile * mix(1.0 - clamp(uCoilPulse, 0.0, 0.9) * 0.5, 1.0, pulse);
      #else
        float band = 1.0 - abs(vBand * 2.0 - 1.0);
        float profile = pow(clamp(band, 0.0, 1.0), max(uRingSharp, 0.05));
        color = mix(uColorRing, uColorCore, profile);
        alpha = profile * mix(1.0, uRingFade, vPhase);
      #endif
      alpha *= drawn;
    #endif
    alpha *= uFade * uOpacity * uPassOpacity;
    if (alpha < 0.003) discard;
    color *= uGlow * uGlobalGlow;
    gl_FragColor = vec4(color, alpha);
  }
`;

function makeBeamUniforms(timeUniform: { value: number }): Record<string, THREE.IUniform> {
  const v3 = (x: number, y: number, z: number): { value: THREE.Vector3 } => ({ value: new THREE.Vector3(x, y, z) });
  const f = (x: number): { value: number } => ({ value: x });
  return {
    uTime: timeUniform,
    uOrigin: v3(0, 0, 0), uTarget: v3(0, 0, 1), uSide: v3(1, 0, 0),
    uSeed: f(0), uProgress: f(0), uFade: f(1), uWidthFade: f(1), uCharge: f(0),
    uRadius: f(0.62), uRadiusNear: f(0.22), uRadiusCurve: f(0.7), uRadiusScale: f(1),
    uFlare: f(0.9), uFlareWidth: f(0.22),
    uThrob: f(0.06), uThrobScale: f(2.4), uThrobSpeed: f(1.6),
    uWander: f(0.06), uWanderScale: f(0.9), uWanderSpeed: f(0.7),
    uRipple: f(0.12), uRippleBands: f(1.6), uRippleScale: f(3.2), uRippleSpeed: f(2.4),
    uStreak: f(0.9), uStreakSharp: f(0.45), uStreakScale: f(5.5), uStreakBands: f(2.6),
    uStreakGlow: f(1.1), uFlowSpeed: f(7),
    uCoreSharp: f(1.4), uCoreFill: f(0.85), uEdgePower: f(2.2),
    uShellRim: f(0.9), uShellFill: f(0.18), uHaloRim: f(3.4), uPassOpacity: f(1),
    uMouthGlow: f(1.5), uMouthLength: f(0.1), uTipGlow: f(1.6), uTipLength: f(0.06),
    uCoils: f(COIL_STRANDS), uCoilTurns: f(2.2), uCoilSpeed: f(0.9), uCoilRadius: f(1.35),
    uCoilFlare: f(0.8), uCoilWidth: f(0.1), uCoilWidthTip: f(1.8), uCoilSharp: f(2.2),
    uCoilPulse: f(0.6), uCoilPulseFreq: f(3), uCoilPulseSpeed: f(1.6),
    uRingCount: f(RING_COUNT), uRingSpeed: f(1.3), uRingInner: f(1.15), uRingOuter: f(2.1),
    uRingSwell: f(0.5), uRingFade: f(0.15), uRingSharp: f(1.6),
    uOrbTurbulence: f(0.22), uOrbScale: f(2.2), uOrbFlow: f(0.8), uOrbBands: f(5), uOrbRim: f(1.8),
    uOpacity: f(1), uGlow: f(2.2), uGlobalGlow: f(1),
    uColorCore: { value: new THREE.Color(1, 1, 1) },
    uColorInner: { value: new THREE.Color(0.82, 0.96, 1) },
    uColorOuter: { value: new THREE.Color(0.29, 0.78, 1) },
    uColorHalo: { value: new THREE.Color(0.05, 0.2, 0.85) },
    uColorCoil: { value: new THREE.Color(1, 0.86, 0.5) },
    uColorCoilEdge: { value: new THREE.Color(1, 0.45, 0.12) },
    uColorRing: { value: new THREE.Color(0.6, 0.94, 1) },
  };
}

function createBeamMaterial(pass: number, timeUniform: { value: number }): THREE.ShaderMaterial {
  const uniforms = makeBeamUniforms(timeUniform);
  // Per-pass tube radius + draw weight (the core/sheath/halo volume trick).
  if (pass === 0) {
    (uniforms.uRadiusScale as { value: number }).value = 0.5;
  } else if (pass === 1) {
    (uniforms.uRadiusScale as { value: number }).value = 1;
    (uniforms.uPassOpacity as { value: number }).value = 0.55;
  } else if (pass === 2) {
    (uniforms.uRadiusScale as { value: number }).value = 2.2;
    (uniforms.uPassOpacity as { value: number }).value = 0.28;
    (uniforms.uGlow as { value: number }).value = 1.8;
  } else if (pass === 3) {
    (uniforms.uPassOpacity as { value: number }).value = 0.9;
  } else if (pass === 4) {
    (uniforms.uPassOpacity as { value: number }).value = 0.9;
  } else {
    (uniforms.uPassOpacity as { value: number }).value = 1;
  }
  return new THREE.ShaderMaterial({
    defines: { BEAM_PASS: pass },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
  });
}

/* ------------------------------------------------------------------ */
/* Firing driver (single pooled cast)                                  */
/* ------------------------------------------------------------------ */

export const NOVA_BEAM_LENGTH = 12;

interface BeamPass {
  mesh: THREE.Object3D;
  mat: THREE.ShaderMaterial;
}

/** Nova Beam: charge 0.7s, fire, hold burning 1.3s, collapse 0.5s. */
export class NovaBeam {
  private passes: BeamPass[] = [];
  private orb!: THREE.Mesh;
  private orbMat!: THREE.ShaderMaterial;
  private timeUniform = { value: 0 };
  private active = false;
  private age = 0;
  private origin = new THREE.Vector3();
  private target = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const tube = createBeamTube();
    const coils = createCoilRibbon();
    const rings = createBeamRings();
    for (let pass = 0; pass < 5; pass++) {
      const mat = createBeamMaterial(pass, this.timeUniform);
      const mesh = pass === 4
        ? new THREE.Mesh(rings, mat)
        : pass === 3
          ? new THREE.Mesh(coils, mat)
          : new THREE.Mesh(tube, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 15;
      scene.add(mesh);
      this.passes.push({ mesh, mat });
    }
    this.orbMat = createBeamMaterial(5, this.timeUniform);
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), this.orbMat);
    this.orb.visible = false;
    this.orb.renderOrder = 15;
    scene.add(this.orb);
  }

  /** Wind up at the caster's hands, then discharge along dir (normalized, y=0). */
  cast(origin: THREE.Vector3, dir: THREE.Vector3): void {
    this.origin.set(origin.x, 1.2, origin.z);
    this.target.set(origin.x + dir.x * NOVA_BEAM_LENGTH, 0.1, origin.z + dir.z * NOVA_BEAM_LENGTH);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const seed = Math.random() * 100;
    for (const p of this.passes) {
      p.mat.uniforms.uOrigin.value.copy(this.origin);
      p.mat.uniforms.uTarget.value.copy(this.target);
      p.mat.uniforms.uSide.value.copy(side);
      p.mat.uniforms.uSeed.value = seed;
      p.mesh.visible = true;
    }
    this.orbMat.uniforms.uSeed.value = seed;
    this.orb.position.copy(this.origin);
    this.orb.visible = true;
    this.active = true;
    this.age = 0;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age += dt;
    this.timeUniform.value += dt;
    // Charge 0–0.7s, front out by 0.95s, hold burning to 2.0s, collapse by 2.5s.
    const charge = Math.min(1, this.age / 0.7);
    const progress = this.age < 0.7 ? 0 : Math.min(1, (this.age - 0.7) / 0.25);
    const fade = this.age < 2.0 ? 1 : Math.max(0, 1 - (this.age - 2.0) / 0.5);
    const widthFade = fade;
    this.orb.scale.setScalar(0.2 + charge * 0.35);
    for (const p of this.passes) {
      p.mat.uniforms.uProgress.value = progress;
      p.mat.uniforms.uFade.value = fade;
      p.mat.uniforms.uWidthFade.value = widthFade;
      p.mat.uniforms.uCharge.value = charge;
    }
    this.orbMat.uniforms.uCharge.value = charge;
    this.orbMat.uniforms.uFade.value = this.age < 0.95 ? 1 : Math.max(0, 1 - (this.age - 0.95) / 0.3);
    if (this.age >= 2.5) {
      this.active = false;
      for (const p of this.passes) p.mesh.visible = false;
      this.orb.visible = false;
    }
  }

  clear(): void {
    this.active = false;
    for (const p of this.passes) p.mesh.visible = false;
    this.orb.visible = false;
  }
}
