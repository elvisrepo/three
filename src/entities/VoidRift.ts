/**
 * Void Rift portal — Pyromancer extra skill visuals + driver.
 *
 * Original work for this project (no vendored code): a ground disc shader
 * matching the void-portal reference — violet/blue outer churn, cyan mid
 * bands, gold-white inner rim, lightless center (additive, so the dark middle
 * is simply absence of light). The driver grows the portal, holds it grinding,
 * then collapses it. Damage and the implosion pull are Game-side.
 */

import * as THREE from 'three';

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
`;

const RIFT_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uRadius;
  uniform float uSeed;
  uniform float uFade;
  uniform float uGlow;
  varying vec2 vUv;
  ${NOISE_GLSL}
  #define TAU 6.28318530718
  #define PI 3.141592653589793
  void main() {
    vec2 p = (vUv - 0.5) * uSize;
    float r = length(p) / max(uRadius, 0.01);
    if (r > 1.15) discard;
    float ang = atan(p.y, p.x);
    // Churn: domain-warped swirl so the bands fold instead of ringing.
    float warp = fbm3(vec3(p * 0.4, uSeed + uTime * 0.25)) * 2.4;
    float arms = 0.5 + 0.5 * sin(ang * 3.0 + warp * 3.0 - uTime * 2.4);
    float arms2 = 0.5 + 0.5 * sin(ang * 5.0 - warp * 2.0 + uTime * 1.7);
    // Outer churn: violet depths, electric blue crests.
    float outer = smoothstep(1.05, 0.55, r);
    vec3 violet = vec3(0.45, 0.2, 0.95);
    vec3 eblue = vec3(0.15, 0.55, 1.0);
    vec3 col = mix(violet, eblue, arms * outer);
    float alpha = outer * (0.35 + 0.65 * arms);
    // Mid cyan bands riding the swirl.
    float mid = smoothstep(0.62, 0.4, r) * smoothstep(0.3, 0.42, r);
    vec3 cyan = vec3(0.3, 0.9, 1.0);
    col = mix(col, cyan, mid * (0.4 + 0.6 * arms2));
    alpha += mid * 0.5 * arms2;
    // Gold-white inner rim: the hot lip around the dark.
    float rim = smoothstep(0.42, 0.3, r) * smoothstep(0.2, 0.3, r);
    float flick = 0.75 + 0.25 * sin(uTime * 9.0 + warp * 5.0);
    vec3 gold = vec3(1.0, 0.82, 0.45);
    vec3 white = vec3(1.0, 0.97, 0.9);
    col = mix(col, mix(gold, white, arms2), rim * flick);
    alpha += rim * flick;
    // Lightless center: additive pass emits nothing here.
    float dark = smoothstep(0.26, 0.1, r);
    alpha *= 1.0 - dark;
    // Soft outer edge.
    alpha *= smoothstep(1.15, 0.95, r);
    alpha *= uFade;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col * uGlow, alpha);
  }
`;

export const VOID_RIFT_RADIUS = 3.5;

/** Void Rift: grow 0.3s, grind 2.0s with pull, collapse 0.4s. */
export class VoidRift {
  private mesh!: THREE.Mesh;
  private mat!: THREE.ShaderMaterial;
  private time = { value: 0 };
  private active = false;
  private age = 0;
  private seed = 0;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: this.time,
        uSize: { value: 10 },
        uRadius: { value: 0 },
        uSeed: { value: 0 },
        uFade: { value: 0 },
        uGlow: { value: 1.6 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: RIFT_FRAGMENT,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.08;
    this.mesh.visible = false;
    this.mesh.renderOrder = 14;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Open a rift at (x, z). Damage + pull are Game-side. */
  cast(x: number, z: number): void {
    this.mesh.position.set(x, 0.08, z);
    this.seed = Math.random() * 100;
    this.mat.uniforms.uSeed.value = this.seed;
    this.mesh.visible = true;
    this.active = true;
    this.age = 0;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age += dt;
    this.time.value += dt;
    // Grow, grind, collapse.
    const grow = Math.min(1, this.age / 0.3);
    const fade = this.age < 2.3 ? grow : Math.max(0, 1 - (this.age - 2.3) / 0.4);
    this.mat.uniforms.uRadius.value = VOID_RIFT_RADIUS * (0.3 + 0.7 * grow);
    this.mat.uniforms.uFade.value = fade;
    if (this.age >= 2.7) {
      this.active = false;
      this.mesh.visible = false;
    }
  }

  clear(): void {
    this.active = false;
    this.mesh.visible = false;
  }
}
