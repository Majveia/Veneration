// World mode: one star system you can fly through, land in and walk around.
//
// REFERENCE FRAMES (read this before touching positions)
//  * Inertial system frame: star at the origin, y = ecliptic normal. Bodies move
//    on Kepler rails (body.inertialPos) and spin (body.spin).
//  * Active frame: world.frame is the body whose sphere of influence the camera
//    is in (or the star). ALL gameplay positions (world.cam.pos, player, ships,
//    vehicles) are doubles in this body-FIXED frame, so the ground under you is
//    static and the sky / sun / other planets wheel around instead.
//  * Scene space: frame coordinates minus world.origin (a floating origin that
//    tracks the camera), so GPU-side numbers stay small. world.frameRoot has
//    position = -origin; add frame-space objects to it, and body-local objects
//    (terrain, buildings, trees) to body.group. Never bake absolute positions
//    into vertex buffers: keep geometry local to a mesh near where it is used.
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { orbitPosition } from '../../core/universe.js';
import { Emitter } from '../../core/events.js';
import { createSurface } from './planetgen.js';
import { SYSTEM_LIST } from './systems/index.js';

const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Body {
  constructor(def, kind) {
    this.def = def; this.kind = kind; // 'star' | 'planet' | 'moon' | 'gas'
    this.name = def.name; this.radius = def.radius; this.mu = def.mu;
    this.parent = null;
    this.inertialPos = new THREE.Vector3();
    this.spin = new THREE.Quaternion();          // body-fixed -> inertial
    this.group = new THREE.Group();              // child of world.frameRoot; body-fixed axes
    this.group.name = `body:${def.name}`;
    this.pos = this.group.position;              // centre, in active-frame coordinates
    this.surface = kind !== 'star' && def.terrain ? createSurface(def) : null;
    this.soi = kind === 'star' ? Infinity : this.radius * 5;
    this.spinOffset = 0;
    this._tilt = new THREE.Quaternion().setFromAxisAngle(Z, def.spin ? def.spin.tilt : 0);
  }
  updateInertial(t) {
    if (this.kind === 'star') return;
    orbitPosition(this.def.orbit, t, this.inertialPos);
    if (this.parent) this.inertialPos.add(this.parent.inertialPos);
    const a = this.def.spin.phase + this.spinOffset + (2 * Math.PI * t) / this.def.spin.period;
    this.spin.copy(this._tilt).multiply(_q.setFromAxisAngle(Y, a));
  }
  // Unit direction (body-local) for latitude / longitude in degrees.
  static dirFromLatLon(lat, lon, out = new THREE.Vector3()) {
    const a = THREE.MathUtils.degToRad(lat), o = THREE.MathUtils.degToRad(lon);
    return out.set(Math.cos(a) * Math.cos(o), Math.sin(a), Math.cos(a) * Math.sin(o));
  }
}

export default async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2e10);
  const frameRoot = new THREE.Group();
  frameRoot.name = 'frameRoot';
  scene.add(frameRoot);

  const sun = new SunLight(0xffffff, 3);
  sun.castShadow = ctx.quality.shadows > 0;
  sun.shadow.mapSize.set(ctx.quality.shadows || 1024, ctx.quality.shadows || 1024);
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0x9ec4ff, 0x4a4036, 0.6);
  scene.add(hemi);
  sun.layers.enableAll(); hemi.layers.enableAll(); // also light the refractive layer (see core/post.js)

  const world = {
    ctx, scene, camera, frameRoot,
    events: new Emitter(),
    system: null, bodies: [], star: null, frame: null,
    time: 0, timeScale: 1,
    origin: new THREE.Vector3(),
    // Camera state in frame coordinates (doubles). The active controller system
    // (player / vehicle / ship / drone) writes these every frame.
    cam: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 62 },
    sunDir: new THREE.Vector3(0, 1, 0),   // unit vector toward the star (frame == scene axes)
    sunDist: 1,
    lighting: { sun, hemi, sunColor: new THREE.Color(1, 1, 1), sunIntensity: 3 },
    systems: {}, _list: [],
    // Static collision shapes registered by world systems (buildings, trunks,
    // rocks, landed ships). The player / vehicle systems resolve against them.
    //   { body, type: 'cylinder', pos (body-local base centre), radius, height }   axis = local up at pos
    //   { body, type: 'box', pos (body-local centre), quat (body-local), half: Vector3 }
    //   { body, type: 'sphere', pos (body-local centre), radius }
    physics: {
      colliders: new Set(),
      addCollider(c) { this.colliders.add(c); return c; },
      removeCollider(c) { this.colliders.delete(c); },
    },

    // --- frame helpers -----------------------------------------------------
    toLocal(body, framePos, out = new THREE.Vector3()) { return out.copy(framePos).sub(body.pos).applyQuaternion(_q.copy(body.group.quaternion).invert()); },
    toFrame(body, localPos, out = new THREE.Vector3()) { return out.copy(localPos).applyQuaternion(body.group.quaternion).add(body.pos); },
    cameraLocalTo(body, out = new THREE.Vector3()) { return world.toLocal(body, world.cam.pos, out); },
    // Nearest solid/gas body to a frame-space point (ignores the star).
    nearestBody(framePos) {
      let best = null, bd = Infinity;
      for (const b of world.bodies) { if (b.kind === 'star') continue; const d = framePos.distanceTo(b.pos) - b.radius; if (d < bd) { bd = d; best = b; } }
      return best;
    },
    // Terrain radius (metres from body centre) under a frame-space point.
    groundRadius(body, framePos) {
      if (!body.surface) return body.radius;
      world.toLocal(body, framePos, _v).normalize();
      return body.radius + body.surface.height(_v.x, _v.y, _v.z);
    },
    // Fills out {body, up (frame space), altitude (above terrain), height (terrain above sea level), dist}.
    groundInfo(framePos, out = {}) {
      const b = world.nearestBody(framePos);
      out.body = b;
      if (!b) return out;
      out.up = (out.up || new THREE.Vector3()).copy(framePos).sub(b.pos);
      out.dist = out.up.length(); out.up.divideScalar(out.dist);
      const gr = world.groundRadius(b, framePos);
      out.height = gr - b.radius; out.altitude = out.dist - gr;
      return out;
    },
    // Newtonian gravity (m/s^2) at a frame-space point from nearby bodies.
    gravityAt(framePos, out = new THREE.Vector3()) {
      out.set(0, 0, 0);
      for (const b of world.bodies) {
        if (b.kind === 'star') continue;
        _v.copy(b.pos).sub(framePos);
        const d2 = _v.lengthSq();
        if (d2 > b.soi * b.soi * 4) continue;
        const d = Math.sqrt(d2), r = Math.max(d, b.radius);
        out.addScaledVector(_v, b.mu / (r * r * d));
      }
      return out;
    },
    // Switch the active frame, converting camera state. Listeners of
    // 'frameChange' get {from, to, convertPos(v), convertDir(v), convertQuat(q)}
    // to convert their own frame-space state (in place).
    setFrame(body) {
      const from = world.frame;
      if (from === body) return;
      const Sf = from ? from.spin.clone() : new THREE.Quaternion(), Cf = from ? from.inertialPos.clone() : new THREE.Vector3();
      const Sti = body.spin.clone().invert(), Ct = body.inertialPos.clone();
      const rot = Sti.clone().multiply(Sf);
      const conv = {
        from, to: body,
        convertPos: (v) => v.applyQuaternion(Sf).add(Cf).sub(Ct).applyQuaternion(Sti),
        convertDir: (v) => v.applyQuaternion(rot),
        convertQuat: (q) => q.premultiply(rot),
      };
      world.frame = body;
      conv.convertPos(world.cam.pos); conv.convertQuat(world.cam.quat);
      world.origin.copy(world.cam.pos);
      placeBodies();
      world.events.emit('frameChange', conv);
    },
    // Put the camera on/above a body. lat/lon/heading/pitch in degrees, alt in
    // metres above the terrain. Also makes that body the active frame.
    placeAt(body, { lat = 0, lon = 0, alt = 2, heading = 0, pitch = 0 } = {}) {
      world.setFrame(body);
      const d = Body.dirFromLatLon(lat, lon);
      const r = (body.surface ? body.radius + Math.max(body.surface.height(d.x, d.y, d.z), body.surface.hasOcean ? 0 : -1e9) : body.radius) + alt;
      world.cam.pos.copy(d).multiplyScalar(r);
      world.origin.copy(world.cam.pos);
      const up = d, north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
      if (north.lengthSq() < 0.5) north.set(1, 0, 0);
      const east = new THREE.Vector3().crossVectors(north, up).normalize();
      const h = THREE.MathUtils.degToRad(heading), p = THREE.MathUtils.degToRad(pitch);
      const fwd = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
      const right = new THREE.Vector3().crossVectors(fwd, up);
      const look = fwd.clone().multiplyScalar(Math.cos(p)).addScaledVector(up, Math.sin(p));
      const camUp = new THREE.Vector3().crossVectors(right, look);
      world.cam.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, camUp, look.clone().negate()));
      world.events.emit('teleport', { body, lat, lon, alt, heading, pitch });
    },
    // Rotate a body's spin phase so the local solar time at (lat, lon) is
    // tod in [0,1): 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
    setTimeOfDay(body, lat, lon, tod) {
      body.spinOffset = 0; body.updateInertial(world.time);
      const s = _v.copy(body.inertialPos).negate().normalize().applyQuaternion(_q.copy(body.spin).invert());
      const lonS = Math.atan2(s.z, s.x), lonP = THREE.MathUtils.degToRad(lon);
      body.spinOffset = lonP + (tod - 0.5) * Math.PI * 2 - lonS;
      body.updateInertial(world.time);
      placeBodies();
    },
  };

  function placeBodies() {
    const F = world.frame;
    const Si = _q2.copy(F.spin).invert();
    for (const b of world.bodies) {
      b.group.position.copy(b.inertialPos).sub(F.inertialPos).applyQuaternion(Si);
      b.group.quaternion.copy(Si).multiply(b.spin);
    }
  }

  function buildSystem(sysDef) {
    world.system = sysDef;
    const star = new Body({ ...sysDef.star, spin: null }, 'star');
    world.star = star;
    world.bodies = [star];
    const byIndex = [];
    for (const def of sysDef.bodies) {
      const b = new Body(def, def.kind);
      byIndex[def.index] = b;
      if (def.parent >= 0) b.parent = byIndex[def.parent];
      world.bodies.push(b);
    }
    for (const b of world.bodies) frameRoot.add(b.group);
    world.frame = star;
    for (const b of world.bodies) b.updateInertial(world.time);
    placeBodies();
  }

  function syncCamera() {
    const cam = world.cam;
    if (cam.pos.distanceToSquared(world.origin) > 1500 * 1500) world.origin.copy(cam.pos);
    frameRoot.position.copy(world.origin).negate();
    frameRoot.updateMatrixWorld(true);
    camera.position.copy(cam.pos).sub(world.origin);
    camera.quaternion.copy(cam.quat);
    if (camera.fov !== cam.fov) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
    // sun
    _v.copy(world.star.pos).sub(cam.pos);
    world.sunDist = _v.length();
    world.sunDir.copy(_v).divideScalar(world.sunDist);
    const L = world.lighting;
    L.sunColor.set(world.system.star.color);
    L.sunIntensity = THREE.MathUtils.clamp(3.2 * Math.sqrt(world.system.star.luminosity) * Math.pow(3.2e8 / world.sunDist, 0.6), 0.6, 9);
    if (!L.external) {
      // Baseline lighting. A sky/atmosphere system may set lighting.external = true and drive these itself.
      sun.color.copy(L.sunColor); sun.intensity = L.sunIntensity;
      const g = world.groundInfo(cam.pos, _gi);
      const inAtmo = g.body && g.body.def.atmosphere && g.altitude < g.body.def.atmosphere.height;
      const day = g.body ? THREE.MathUtils.smoothstep(world.sunDir.dot(g.up), -0.2, 0.25) : 1;
      hemi.intensity = inAtmo ? 0.08 + 0.75 * day : 0.06;
      if (g.body) hemi.position.copy(g.up);
    }
    sun.position.copy(world.sunDir);
  }
  const _gi = {};

  function chooseFrame() {
    let best = world.star, bestScore = Infinity;
    for (const b of world.bodies) {
      if (b.kind === 'star') continue;
      const d = world.cam.pos.distanceTo(b.pos);
      const limit = b === world.frame ? b.soi * 1.2 : b.soi;
      if (d < limit && d / b.radius < bestScore) { bestScore = d / b.radius; best = b; }
    }
    if (best !== world.frame) world.setFrame(best);
  }

  async function loadSystems() {
    for (const name of SYSTEM_LIST) {
      try {
        const mod = await import(`./systems/${name}.js`);
        const s = await mod.default(world);
        if (s) { s.name = s.name || name; world.systems[name] = s; world._list.push(s); }
      } catch (e) {
        console.error(`[world] system "${name}" failed to load`, e);
      }
    }
  }
  function disposeSystems() {
    for (const s of world._list) { try { s.dispose && s.dispose(); } catch (e) { console.error(e); } }
    world._list = []; world.systems = {};
    for (const b of world.bodies) frameRoot.remove(b.group);
    world.bodies = [];
  }

  let entered = false, frames = 0;
  const mode = {
    name: 'world', scene, camera, world,
    look: { exposure: 1.0, bloom: 0.35, bloomThreshold: 1.1, vignette: 0.22, grain: 0.015 },
    // args: { galaxyId, starId, body (index | name), lat, lon, alt, heading, pitch, tod, t }
    async enter(args = {}) {
      if (entered) disposeSystems();
      const sysDef = ctx.universe.system(args.galaxyId | 0, args.starId | 0);
      world.time = args.t !== undefined ? +args.t : 600;
      buildSystem(sysDef);
      let def = sysDef.bodies[sysDef.home];
      if (args.body !== undefined && args.body !== null && args.body !== '') {
        def = sysDef.bodies.find((b) => String(b.index) === String(args.body) || b.name.toLowerCase() === String(args.body).toLowerCase()) || def;
      }
      const body = world.bodies.find((b) => b.def === def);
      const spot = { lat: +(args.lat ?? 12), lon: +(args.lon ?? 20), alt: +(args.alt ?? (body.kind === 'gas' ? body.radius * 2 : 3)), heading: +(args.heading ?? 30), pitch: +(args.pitch ?? 0) };
      // Default spawn (or site=<index>): on the outskirts of a settlement, looking at it.
      const sites = body.surface ? body.surface.sites : [];
      if (sites.length && (args.site !== undefined || args.lat === undefined)) {
        const site = sites[Math.min(sites.length - 1, args.site | 0)];
        const off = (site.radius + +(args.away ?? 260)) / body.radius, d = site.dir;
        spot.lat = THREE.MathUtils.radToDeg(Math.asin(d.y)) - THREE.MathUtils.radToDeg(off);
        spot.lon = THREE.MathUtils.radToDeg(Math.atan2(d.z, d.x));
        if (args.heading === undefined) spot.heading = 0;
      }
      world.setFrame(body);
      world.setTimeOfDay(body, spot.lat, spot.lon, args.tod !== undefined ? +args.tod : 0.36);
      world.placeAt(body, spot);
      await loadSystems();
      syncCamera();
      entered = true; frames = 0;
      ctx.input.wantLock = true;
    },
    exit() { ctx.input.wantLock = false; ctx.input.exitLock(); disposeSystems(); entered = false; },
    update(dt) {
      if (!entered) return;
      world.time += dt * world.timeScale;
      for (const b of world.bodies) b.updateInertial(world.time);
      chooseFrame();
      placeBodies();
      for (const s of world._list) { if (s.update) { try { s.update(dt); } catch (e) { if (!s._err) { s._err = true; console.error(`[world] ${s.name}.update`, e); } } } }
      syncCamera();
      for (const s of world._list) { if (s.lateUpdate) { try { s.lateUpdate(dt); } catch (e) { if (!s._err2) { s._err2 = true; console.error(`[world] ${s.name}.lateUpdate`, e); } } } }
      frames++;
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); for (const s of world._list) s.resize && s.resize(w, h); },
    isReady() { return entered && frames > 2 && world._list.every((s) => !s.isReady || s.isReady()); },
  };
  return mode;
}
