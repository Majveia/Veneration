// HDR render pipeline shared by every mode.
//
//   scene  ->  rtScene (RGBA16F + 32F depth, MSAA)
//             (objects on LAYER_REFRACT are drawn in a second phase and can
//              sample the opaque scene behind them: post.shared.tOpaqueColor /
//              tOpaqueDepth - water, glass, heat haze, force fields ...)
//          ->  [effects chain: fullscreen passes that read tColor + tDepth]
//          ->  bloom (13-tap down / tent up mip chain)
//          ->  final: exposure, ACES tonemap, grade, vignette, grain, dither, sRGB
//
// Effects are how modes add depth-aware fullscreen work (atmospheric scattering,
// analytic oceans, volumetric clouds, god rays ...). See addEffect().
import * as THREE from 'three';

// Refractive layer. Put a mesh on it with mesh.layers.set(LAYER_REFRACT) and set
// scene.userData.refractive = true. Its material may reference the uniform
// objects in post.shared directly (same object identity = always current):
//   tOpaqueColor  HDR colour of everything opaque (and layer-0 transparent)
//   tOpaqueDepth  .r = positive view-space depth in metres of that scene (1e30+ = sky)
//   uResolution   render size in pixels (gl_FragCoord.xy / uResolution = screen uv)
// The mesh is depth-tested against the opaque scene and may write depth.
// Lights only reach the layer if light.layers.enableAll() was called.
export const LAYER_REFRACT = 1;

// Shared GLSL for effect fragment shaders. Uniform values are filled in
// automatically for any effect material that declares them (see STD_UNIFORMS).
export const GLSL_POST_COMMON = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uCamNear;
uniform float uCamFar;
uniform mat4 uProjInv;   // camera.projectionMatrixInverse
uniform mat4 uViewInv;   // camera.matrixWorld (view -> scene/world space)
uniform vec3 uCamPos;    // camera position in scene space
uniform vec2 uResolution;
uniform float uTime;
varying vec2 vUv;

// Positive distance along the camera forward axis for a raw depth sample.
// Handles the reversed (preferred), logarithmic and standard depth encodings.
float viewDepth(float d) {
#if defined( USE_REVERSED_DEPTH_BUFFER )
  return (uCamNear * uCamFar) / (uCamNear + d * (uCamFar - uCamNear));
#elif defined( USE_LOGARITHMIC_DEPTH_BUFFER )
  return exp2(d * log2(uCamFar + 1.0)) - 1.0;
#else
  return (uCamNear * uCamFar) / (uCamFar - d * (uCamFar - uCamNear));
#endif
}
// Scene-space ray direction through this pixel (normalised). dirViewZ receives
// the view-space z of that direction (negative) so callers can convert
// viewDepth -> distance along the ray: dist = viewDepth / -dirViewZ.
vec3 pixelRay(vec2 uv, out float dirViewZ) {
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, 0.5, 1.0);
  vec3 dv = normalize(v.xyz / v.w);
  dirViewZ = dv.z;
  return normalize((uViewInv * vec4(dv, 0.0)).xyz);
}
// Distance from the camera to the opaque surface at uv, along the pixel ray.
// Returns a huge value (>= 1e30) for sky pixels.
float sceneDistance(vec2 uv, float dirViewZ) {
  float d = texture2D(tDepth, uv).x;
  float vd = viewDepth(d);
  if (vd >= uCamFar * 0.98) return 1e30;
  return vd / max(1e-4, -dirViewZ);
}
`;

export const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee; uniform float uFirst;
varying vec2 vUv;
vec3 prefilter(vec3 c) {
  if (uFirst < 0.5) return c;
  c = min(c, vec3(64.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
  return c * contrib;
}
float karis(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main() {
  vec2 t = uTexel;
  vec3 a = texture2D(tSrc, vUv + t * vec2(-2.0,  2.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + t * vec2( 0.0,  2.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + t * vec2( 2.0,  2.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + t * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 f = texture2D(tSrc, vUv + t * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tSrc, vUv + t * vec2( 0.0, -2.0)).rgb;
  vec3 i = texture2D(tSrc, vUv + t * vec2( 2.0, -2.0)).rgb;
  vec3 j = texture2D(tSrc, vUv + t * vec2(-1.0,  1.0)).rgb;
  vec3 k = texture2D(tSrc, vUv + t * vec2( 1.0,  1.0)).rgb;
  vec3 l = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tSrc, vUv + t * vec2( 1.0, -1.0)).rgb;
  vec3 col;
  if (uFirst > 0.5) {
    // Karis-weighted groups kill single-pixel fireflies on the first downsample.
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) / (0.125 * (w0 + w1 + w2 + w3) + 0.5 * w4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(prefilter(col), 0.0), 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + t).rgb + texture2D(tSrc, vUv - t).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tSrc; varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }`;

const DEPTH_COPY_FRAG = /* glsl */ `
${'uniform sampler2D tDepth; uniform float uCamNear; uniform float uCamFar; varying vec2 vUv;'}
float viewDepth(float d) {
#if defined( USE_REVERSED_DEPTH_BUFFER )
  return (uCamNear * uCamFar) / (uCamNear + d * (uCamFar - uCamNear));
#elif defined( USE_LOGARITHMIC_DEPTH_BUFFER )
  return exp2(d * log2(uCamFar + 1.0)) - 1.0;
#else
  return (uCamNear * uCamFar) / (uCamFar - d * (uCamFar - uCamNear));
#endif
}
void main() { float vd = viewDepth(texture2D(tDepth, vUv).x); gl_FragColor = vec4(vd >= uCamFar * 0.98 ? 1e30 : vd, 0.0, 0.0, 1.0); }`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tBloom;
uniform float uExposure, uBloom, uVignette, uGrain, uSaturation, uContrast, uFade, uTime, uAberration;
uniform vec3 uTint, uLift;
uniform vec2 uResolution;
varying vec2 vUv;
vec3 aces(vec3 x) {
  // Stephen Hill's fitted ACES (RRT + ODT), sRGB primaries in/out.
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  x = inM * x;
  vec3 a = x * (x + 0.0245786) - 0.000090537;
  vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081;
  return clamp(outM * (a / b), 0.0, 1.0);
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  vec3 col;
  if (uAberration > 0.0) {
    vec2 off = cc * dot(cc, cc) * uAberration;
    col = vec3(texture2D(tColor, uv + off).r, texture2D(tColor, uv).g, texture2D(tColor, uv - off).b);
  } else col = texture2D(tColor, uv).rgb;
  col += texture2D(tBloom, uv).rgb * uBloom;
  col *= uExposure;
  float vig = 1.0 - uVignette * smoothstep(0.25, 1.1, length(cc * vec2(1.0, uResolution.y / uResolution.x) * 2.0));
  col *= vig;
  col = aces(col * uTint);
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;
  col = max(col + uLift * (1.0 - col), 0.0);
  col = pow(col, vec3(1.0 / 2.2));
  float n = hash(gl_FragCoord.xy + fract(uTime) * 61.7);
  // grain is luminance-weighted so pure black stays pure black on OLED
  col += (n - 0.5) * uGrain * smoothstep(0.0, 0.08, luma);
  col += (hash(gl_FragCoord.xy * 1.37 + 3.1) - 0.5) / 255.0 * step(0.002, luma);
  col *= 1.0 - uFade;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Post {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.effects = [];
    this.time = 0;
    // Look settings; modes overwrite these through applyLook().
    this.defaults = {
      exposure: 1.0, bloom: 0.6, bloomThreshold: 1.0, bloomKnee: 0.5, bloomRadius: 1.0,
      vignette: 0.25, grain: 0.02, saturation: 1.0, contrast: 1.0, aberration: 0.0,
      tint: new THREE.Color(1, 1, 1), lift: new THREE.Color(0, 0, 0), fade: 0,
    };
    this.settings = { ...this.defaults, tint: this.defaults.tint.clone(), lift: this.defaults.lift.clone() };

    this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._tri = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this._tri.frustumCulled = false;
    this._scene = new THREE.Scene();
    this._scene.add(this._tri);

    const mk = (frag, uniforms) => new THREE.ShaderMaterial({
      vertexShader: POST_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this._down = mk(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.5 }, uFirst: { value: 0 } });
    this._up = mk(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
    this._up.blending = THREE.AdditiveBlending;
    this._up.transparent = true;
    this._copy = mk(COPY_FRAG, { tSrc: { value: null } });
    this._depthCopy = mk(DEPTH_COPY_FRAG, { tDepth: { value: null }, uCamNear: { value: 0.1 }, uCamFar: { value: 1000 } });
    this.shared = { tOpaqueColor: { value: null }, tOpaqueDepth: { value: null }, uResolution: { value: new THREE.Vector2(1, 1) } };
    this._final = mk(FINAL_FRAG, {
      tColor: { value: null }, tBloom: { value: null }, uExposure: { value: 1 }, uBloom: { value: 0.6 }, uVignette: { value: 0.25 },
      uGrain: { value: 0.02 }, uSaturation: { value: 1 }, uContrast: { value: 1 }, uFade: { value: 0 }, uTime: { value: 0 }, uAberration: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) }, uLift: { value: new THREE.Color(0, 0, 0) }, uResolution: { value: new THREE.Vector2(1, 1) },
    });
    this.size = new THREE.Vector2(1, 1);
    this._build(2, 2);
  }

  _build(w, h) {
    this.dispose();
    const hdr = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { ...hdr, depthBuffer: true, samples: this.quality.msaa | 0 });
    this.rtScene.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.rtScene.depthTexture.format = THREE.DepthFormat;
    this.rtOpaque = new THREE.WebGLRenderTarget(w, h, hdr);
    this.rtOpaqueDepth = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RedFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
    this.shared.tOpaqueColor.value = this.rtOpaque.texture;
    this.shared.tOpaqueDepth.value = this.rtOpaqueDepth.texture;
    this.shared.uResolution.value.set(w, h);
    this.rtA = new THREE.WebGLRenderTarget(w, h, hdr);
    this.rtB = new THREE.WebGLRenderTarget(w, h, hdr);
    this.mips = [];
    let mw = w, mh = h;
    const levels = this.quality.bloomLevels || 6;
    for (let i = 0; i < levels; i++) {
      mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
      const rt = new THREE.WebGLRenderTarget(mw, mh, hdr);
      rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      this.mips.push(rt);
      if (mw <= 4 || mh <= 4) break;
    }
    this.size.set(w, h);
  }

  dispose() {
    for (const rt of [this.rtScene, this.rtOpaque, this.rtOpaqueDepth, this.rtA, this.rtB, ...(this.mips || [])]) rt && rt.dispose();
    if (this.rtScene && this.rtScene.depthTexture) this.rtScene.depthTexture.dispose();
  }

  setSize(w, h) {
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    if (w !== this.size.x || h !== this.size.y) this._build(w, h);
  }

  // look: partial settings object; missing keys fall back to defaults.
  applyLook(look = {}) {
    const s = this.settings, d = this.defaults;
    for (const k of Object.keys(d)) {
      if (k === 'fade') continue;
      const v = look[k] !== undefined ? look[k] : d[k];
      if (s[k] && s[k].isColor) s[k].set(v); else s[k] = v;
    }
  }

  // effect = { name, order = 0, enabled = true, material: ShaderMaterial, update?(camera, post) }
  // The material should use POST_VERT + GLSL_POST_COMMON; standard uniforms it
  // declares (tColor, tDepth, uCamNear, uCamFar, uProjInv, uViewInv, uCamPos,
  // uResolution, uTime) are set automatically each frame.
  addEffect(effect) {
    if (effect.order === undefined) effect.order = 0;
    if (effect.enabled === undefined) effect.enabled = true;
    this.effects.push(effect);
    this.effects.sort((a, b) => a.order - b.order);
    return effect;
  }
  removeEffect(effect) {
    const i = this.effects.indexOf(effect);
    if (i >= 0) this.effects.splice(i, 1);
  }

  _pass(material, target) {
    this._tri.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this._scene, this._cam);
  }

  render(scene, camera, dt = 0) {
    const r = this.renderer, s = this.settings;
    this.time += dt;
    // shadow maps render once per frame (first scene pass), not once per pass
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;
    const mask = camera.layers.mask;
    camera.layers.disable(LAYER_REFRACT);
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(scene, camera);
    if (scene.userData.refractive) {
      // snapshot the opaque scene, then draw the refractive layer over it
      this._copy.uniforms.tSrc.value = this.rtScene.texture;
      this._pass(this._copy, this.rtOpaque);
      const dc = this._depthCopy.uniforms;
      dc.tDepth.value = this.rtScene.depthTexture; dc.uCamNear.value = camera.near; dc.uCamFar.value = camera.far;
      this._pass(this._depthCopy, this.rtOpaqueDepth);
      r.autoClear = false;
      // the MSAA colour buffer may have been invalidated by the resolve: restore it
      this._copy.uniforms.tSrc.value = this.rtOpaque.texture;
      this._pass(this._copy, this.rtScene);
      camera.layers.set(LAYER_REFRACT);
      r.setRenderTarget(this.rtScene);
      r.render(scene, camera);
      r.autoClear = true;
    }
    camera.layers.mask = mask;

    // effects chain
    let read = this.rtScene, write = this.rtA;
    for (const fx of this.effects) {
      if (!fx.enabled) continue;
      const u = fx.material.uniforms;
      if (u.tColor) u.tColor.value = read.texture;
      if (u.tDepth) u.tDepth.value = this.rtScene.depthTexture;
      if (u.uCamNear) u.uCamNear.value = camera.near;
      if (u.uCamFar) u.uCamFar.value = camera.far;
      if (u.uProjInv) u.uProjInv.value.copy(camera.projectionMatrixInverse);
      if (u.uViewInv) u.uViewInv.value.copy(camera.matrixWorld);
      if (u.uCamPos) u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
      if (u.uResolution) u.uResolution.value.copy(this.size);
      if (u.uTime) u.uTime.value = this.time;
      if (fx.update) fx.update(camera, this);
      this._pass(fx.material, write);
      read = write;
      write = write === this.rtA ? this.rtB : this.rtA;
    }

    // bloom
    const mips = this.mips;
    if (s.bloom > 0) {
      let src = read;
      for (let i = 0; i < mips.length; i++) {
        const u = this._down.uniforms;
        u.tSrc.value = src.texture;
        u.uTexel.value.set(1 / src.width, 1 / src.height);
        u.uFirst.value = i === 0 ? 1 : 0;
        u.uThreshold.value = s.bloomThreshold; u.uKnee.value = s.bloomKnee;
        this._pass(this._down, mips[i]);
        src = mips[i];
      }
      r.autoClear = false;
      for (let i = mips.length - 1; i > 0; i--) {
        const u = this._up.uniforms;
        u.tSrc.value = mips[i].texture;
        u.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
        u.uRadius.value = s.bloomRadius;
        this._pass(this._up, mips[i - 1]);
      }
      r.autoClear = true;
    }

    const f = this._final.uniforms;
    f.tColor.value = read.texture;
    f.tBloom.value = mips[0].texture;
    f.uExposure.value = s.exposure; f.uBloom.value = s.bloom / Math.max(1, mips.length * 0.5);
    f.uVignette.value = s.vignette; f.uGrain.value = s.grain; f.uSaturation.value = s.saturation; f.uContrast.value = s.contrast;
    f.uFade.value = s.fade; f.uTime.value = this.time; f.uAberration.value = s.aberration;
    f.uTint.value.copy(s.tint); f.uLift.value.copy(s.lift); f.uResolution.value.copy(this.size);
    this._pass(this._final, null);
  }
}
