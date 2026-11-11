// Kit viewer: a neutral outdoor "studio" for developing and reviewing asset
// kits (characters, vehicles, buildings, plants, creatures ...) in isolation,
// rendered through the same HDR pipeline as the game.
//
//   kit.html?kit=<name>&...      loads src/kits/<name>.js and calls its
//                                `export async function demo(view)`
//   view = { scene, camera, renderer, sun, hemi, ground, params, quality,
//            onUpdate(fn(dt, t)), frame({center: Vector3, radius}), post }
//   Camera: az / el (degrees), dist, tx / ty / tz (target) URL params, or drag
//   to orbit / wheel to zoom. tod=0..1 moves the sun. shot=1 for the harness.
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { Post } from '../core/post.js';

const params = Object.fromEntries(new URLSearchParams(location.search).entries());
const shot = 'shot' in params;
window.__errors = []; window.__ready = false;
addEventListener('error', (e) => window.__errors.push(String(e.message || e)));
addEventListener('unhandledrejection', (e) => window.__errors.push('unhandled: ' + String(e.reason && (e.reason.stack || e.reason))));
const cerr = console.error.bind(console);
console.error = (...a) => { window.__errors.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); cerr(...a); };

const canvas = document.getElementById('gl');
const quality = { name: 'high', pixelRatio: shot ? 1 : 1.5, msaa: 4, shadows: 2048, bloomLevels: 6, detail: 1 };
const probe = document.createElement('canvas').getContext('webgl2');
const reversed = !!(probe && probe.getExtension('EXT_clip_control'));
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, reversedDepthBuffer: reversed, logarithmicDepthBuffer: !reversed, preserveDrawingBuffer: shot });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.pixelRatio));
renderer.shadowMap.enabled = true;
const post = new Post(renderer, quality);
post.applyLook({ exposure: 1.0, bloom: 0.3, bloomThreshold: 1.1, vignette: 0.2, grain: 0.01 });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(+(params.fov || 40), innerWidth / innerHeight, 0.05, 20000);
const tod = +(params.tod ?? 0.36), sa = (tod - 0.25) * Math.PI * 2;
const sunDir = new THREE.Vector3(Math.cos(sa) * 0.75, Math.sin(sa), 0.45).normalize();
const day = THREE.MathUtils.smoothstep(sunDir.y, -0.1, 0.3);
const sun = new SunLight(new THREE.Color(1, 0.96 - 0.3 * (1 - day), 0.9 - 0.5 * (1 - day)), 3.2 * Math.max(0.05, day));
sun.position.copy(sunDir); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.far = +(params.shadowFar || 120); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xa9c8ff, 0x5a5148, 0.15 + 0.75 * day);
scene.add(hemi);
sun.layers.enableAll(); hemi.layers.enableAll();
// sky dome: simple analytic gradient + sun glow so silhouettes read like they will in-game
const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, uniforms: { uSun: { value: sunDir }, uDay: { value: day } },
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `varying vec3 vD; uniform vec3 uSun; uniform float uDay;
    void main(){ vec3 d = normalize(vD); float h = clamp(d.y, -0.2, 1.0);
      vec3 zen = mix(vec3(0.01,0.015,0.04), vec3(0.16,0.36,0.80), uDay), hor = mix(vec3(0.03,0.03,0.06), vec3(0.72,0.84,0.98), uDay);
      vec3 c = mix(hor, zen, pow(max(h,0.0), 0.45));
      float s = max(dot(d, uSun), 0.0);
      c += vec3(1.0,0.75,0.5) * (pow(s, 8.0) * 0.25 + pow(s, 900.0) * 30.0) * max(uDay, 0.15);
      c = mix(c, hor * 0.55, smoothstep(0.0, -0.15, d.y));
      gl_FragColor = vec4(c, 1.0); }`,
}));
sky.renderOrder = -1;
scene.add(sky);
const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 96), new THREE.MeshStandardMaterial({ color: 0x6f7466, roughness: 0.96 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
if (params.ground !== '0') scene.add(ground);

const orbit = { az: +(params.az ?? 35), el: +(params.el ?? 14), dist: +(params.dist ?? 8), target: new THREE.Vector3(+(params.tx || 0), +(params.ty ?? 1), +(params.tz || 0)) };
const updates = [];
const view = {
  scene, camera, renderer, sun, hemi, ground, sky, params, quality, post, sunDir, shot,
  onUpdate(fn) { updates.push(fn); },
  // Frame an object of given centre / radius unless the URL overrides the camera.
  frame({ center, radius }) {
    if (params.tx === undefined && params.ty === undefined && params.tz === undefined) orbit.target.copy(center);
    if (params.dist === undefined) orbit.dist = radius * 2.6;
  },
};
window.__view = view;

let dragging = false;
canvas.addEventListener('pointerdown', () => { dragging = true; });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => { if (dragging) { orbit.az -= e.movementX * 0.3; orbit.el = THREE.MathUtils.clamp(orbit.el + e.movementY * 0.3, -5, 89); } });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist *= Math.exp(Math.sign(e.deltaY) * 0.1); }, { passive: false });

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(s.x, s.y);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

let loaded = false, frames = 0, t = +(params.t || 0), last = performance.now();
view.paused = false;
renderer.setAnimationLoop((now) => {
  if (view.paused) { last = now; return; }
  const dt = shot ? 1 / 60 : Math.min(0.1, (now - last) / 1000); last = now; t += dt;
  for (const fn of updates) fn(dt, t);
  const a = THREE.MathUtils.degToRad(orbit.az), e = THREE.MathUtils.degToRad(orbit.el);
  camera.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(orbit.dist).add(orbit.target);
  camera.lookAt(orbit.target);
  sky.position.copy(camera.position);
  post.render(scene, camera, dt);
  if (loaded && ++frames >= +(params.settle || 4)) window.__ready = true;
});
// the screenshot harness pauses through __ctx
window.__ctx = { get frame() { return frames; }, renderer, set paused(v) { view.paused = v; }, get paused() { return view.paused; } };

(async () => {
  try {
    const mod = await import(`./${params.kit}.js`);
    await mod.demo(view);
  } catch (e) { console.error('[kit] failed', e); }
  loaded = true;
})();
