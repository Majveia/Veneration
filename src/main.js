// Boot: renderer, HDR post pipeline, input, mode manager, main loop.
//
// URL parameters (all optional):
//   mode=cosmos|galaxy|world   starting mode (default cosmos)
//   q=low|medium|high|ultra    quality preset (default: auto)
//   shot=1                     harness mode: fixed timestep, no intro, no pointer lock;
//                              window.__ready becomes true once the mode reports ready
//   ui=0|1                     force UI off/on (default: on, off in shot mode)
//   ...everything else is passed to mode.enter(args) (see each mode's header).
import * as THREE from 'three';
import { Post } from './core/post.js';
import { Input } from './core/input.js';
import { Universe } from './core/universe.js';
import { Emitter } from './core/events.js';

const params = new URLSearchParams(location.search);
const args = Object.fromEntries(params.entries());
const shot = params.has('shot');
const isMobile = matchMedia('(pointer: coarse)').matches;

window.__errors = [];
window.__ready = false;
addEventListener('error', (e) => window.__errors.push(String(e.message || e)));
addEventListener('unhandledrejection', (e) => window.__errors.push('unhandled: ' + String(e.reason && (e.reason.stack || e.reason))));
const cerr = console.error.bind(console);
console.error = (...a) => { window.__errors.push(a.map((x) => (x && x.stack) || String(x)).join(' ')); cerr(...a); };

const QUALITY = {
  low: { pixelRatio: 1, msaa: 0, shadows: 0, bloomLevels: 5, detail: 0.6 },
  medium: { pixelRatio: 1.25, msaa: 2, shadows: 1024, bloomLevels: 6, detail: 0.8 },
  high: { pixelRatio: 1.5, msaa: 4, shadows: 2048, bloomLevels: 6, detail: 1.0 },
  ultra: { pixelRatio: 2, msaa: 4, shadows: 4096, bloomLevels: 7, detail: 1.3 },
};
const qName = QUALITY[args.q] ? args.q : shot ? 'high' : isMobile ? 'medium' : 'high';
const quality = { name: qName, ...QUALITY[qName] };
if (shot) quality.pixelRatio = +(args.pr || 1);

const canvas = document.getElementById('gl');
// Prefer a reversed float depth buffer (needs EXT_clip_control); fall back to logarithmic depth.
const probe = document.createElement('canvas').getContext('webgl2');
const reversed = !!(probe && probe.getExtension('EXT_clip_control')) && args.depth !== 'log';
probe && probe.getExtension('WEBGL_lose_context')?.loseContext();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', reversedDepthBuffer: reversed, logarithmicDepthBuffer: !reversed, preserveDrawingBuffer: shot });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.pixelRatio));
renderer.shadowMap.enabled = quality.shadows > 0;
renderer.toneMapping = THREE.NoToneMapping;
renderer.info.autoReset = false;

const ctx = {
  renderer, canvas, quality, params, args, shot, isMobile,
  input: new Input(canvas),
  universe: new Universe(),
  events: new Emitter(),
  post: new Post(renderer, quality),
  time: 0, frame: 0, mode: null, modeName: '', ui: null, audio: null,
  paused: false, // harness: freeze the loop (the last frame stays on the canvas)
  busy: false,
  // Switch modes with a fade. args are passed to mode.enter().
  async go(name, modeArgs = {}) {
    if (ctx.busy) return;
    ctx.busy = true;
    try {
      if (ctx.mode && !shot) await fade(1, 450);
      if (ctx.mode) { try { ctx.mode.exit && ctx.mode.exit(); } catch (e) { console.error(e); } }
      const prev = ctx.modeName;
      ctx.mode = null;
      if (!modes[name]) modes[name] = (await LOADERS[name]()).default(ctx);
      const mode = await modes[name];
      await mode.enter(modeArgs);
      ctx.post.applyLook(mode.look);
      mode.resize && mode.resize(innerWidth, innerHeight);
      ctx.mode = mode; ctx.modeName = name; readyFrames = 0;
      ctx.events.emit('mode', { name, prev, args: modeArgs, mode });
      if (!shot) fade(0, 900);
    } finally { ctx.busy = false; }
  },
};
window.__ctx = ctx;

const LOADERS = {
  cosmos: () => import('./modes/cosmos/index.js'),
  galaxy: () => import('./modes/galaxy/index.js'),
  world: () => import('./modes/world/index.js'),
};
const modes = {};

function fade(to, ms) {
  return new Promise((res) => {
    const from = ctx.post.settings.fade, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      ctx.post.settings.fade = from + (to - from) * k * k * (3 - 2 * k);
      if (k < 1) requestAnimationFrame(step); else res();
    };
    step();
  });
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  ctx.post.setSize(s.x, s.y);
  if (ctx.mode && ctx.mode.resize) ctx.mode.resize(w, h);
  ctx.events.emit('resize', { w, h });
}
addEventListener('resize', resize);
resize();

let last = performance.now(), readyFrames = 0;
const settle = +(args.settle || 6);
renderer.setAnimationLoop((now) => {
  if (ctx.paused) { last = now; return; }
  const dt = shot ? 1 / 60 : Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  ctx.time += dt; ctx.frame++;
  ctx.input.update(dt);
  const mode = ctx.mode;
  if (!mode) return;
  renderer.info.reset();
  mode.update(dt, ctx.time);
  ctx.events.emit('frame', dt);
  ctx.post.render(mode.scene, mode.camera, dt);
  if (!window.__ready) {
    readyFrames = !mode.isReady || mode.isReady() ? readyFrames + 1 : 0;
    if (readyFrames >= settle) window.__ready = true;
  }
});

(async () => {
  const wantUI = args.ui !== undefined ? args.ui !== '0' : !shot;
  if (wantUI) {
    try { ctx.ui = await (await import('./ui/index.js')).default(ctx); } catch (e) { console.error('[ui] failed to start', e); }
  }
  try {
    await ctx.go(LOADERS[args.mode] ? args.mode : 'cosmos', args);
  } catch (e) { console.error('[boot] mode failed', e); }
  const veil = document.getElementById('veil');
  veil.style.opacity = 0;
  setTimeout(() => veil.remove(), shot ? 0 : 1800);
  if (shot) veil.remove();
})();
