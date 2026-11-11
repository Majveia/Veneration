// Quadtree cube-sphere terrain LOD for every solid body in the system.
//
// Each body gets 6 root quads; nodes split as the camera approaches so vertex
// spacing goes from ~kilometres (seen from orbit) down to ~1.5 m underfoot.
// Chunk meshes are generated on the CPU from body.surface (planetgen) with
// positions relative to the chunk centre, so float32 precision is never an
// issue, and skirts hide the cracks between LOD levels.
//
// Baseline implementation: vertex-colour biomes + a flat water sheet per chunk.
import * as THREE from 'three';

const N = 32;                 // cells per chunk edge
const SPLIT = 2.6;            // split when distance < chunkSize * SPLIT
const FACES = [
  // [normal axis, u axis, v axis]
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
const QP = Math.PI / 4;
const _v = new THREE.Vector3(), _c = new THREE.Color(), _s = { h: 0, temp: 0, moist: 0, mountain: 0, land: 0 };

function faceDir(face, u, v, out) {
  const f = FACES[face];
  const a = Math.tan(u * QP), b = Math.tan(v * QP); // tangent warp -> near-uniform cells
  const x = f[0][0] + a * f[1][0] + b * f[2][0], y = f[0][1] + a * f[1][1] + b * f[2][1], z = f[0][2] + a * f[1][2] + b * f[2][2];
  const l = Math.hypot(x, y, z);
  out.x = x / l; out.y = y / l; out.z = z / l;
  return out;
}

class Node {
  constructor(tree, face, level, ix, iy) {
    this.tree = tree; this.face = face; this.level = level; this.ix = ix; this.iy = iy;
    const span = 2 / (1 << level);
    this.u0 = -1 + ix * span; this.v0 = -1 + iy * span; this.span = span;
    this.size = tree.body.radius * (Math.PI / 2) / (1 << level);
    const d = faceDir(face, this.u0 + span / 2, this.v0 + span / 2, new THREE.Vector3());
    const h = tree.surface.height(d.x, d.y, d.z, this.size / N * 2);
    this.center = d.clone().multiplyScalar(tree.body.radius + h);
    this.dir = d;
    this.children = null; this.mesh = null; this.water = null; this.queued = false;
  }
}

class Tree {
  constructor(sys, body) {
    this.sys = sys; this.body = body; this.surface = body.surface;
    this.maxLevel = Math.max(2, Math.round(Math.log2((body.radius * Math.PI / 2) / 46)));
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    body.group.add(this.group);
    this.roots = [];
    for (let f = 0; f < 6; f++) this.roots.push(new Node(this, f, 0, 0, 0));
    this.pal = makePalette(body.def);
  }

  update(camLocal, queue) {
    this.camDist = camLocal.length();
    // horizon: nodes whose centre is beyond the visible cap can't be seen
    const R = this.body.radius;
    const hCam = Math.max(this.camDist - R, 2);
    this.horizon = Math.sqrt(2 * R * hCam + hCam * hCam) + Math.sqrt(2 * R * this.surface.maxHeight);
    for (const r of this.roots) this._visit(r, camLocal, queue);
  }

  _visit(n, cam, queue) {
    const d = cam.distanceTo(n.center);
    const visible = d - n.size * 0.75 < this.horizon;
    const split = n.level < this.maxLevel && d < n.size * SPLIT && (visible || n.level < 2);
    if (split) {
      if (!n.children) {
        n.children = [];
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) n.children.push(new Node(this, n.face, n.level + 1, n.ix * 2 + i, n.iy * 2 + j));
      }
      let ready = true;
      for (const c of n.children) if (!c.mesh) { ready = false; this._request(c, cam, queue); }
      if (ready) {
        this._show(n, false);
        for (const c of n.children) this._visit(c, cam, queue);
        return;
      }
    } else if (n.children) {
      for (const c of n.children) this._dispose(c);
      n.children = null;
    }
    if (!n.mesh) this._request(n, cam, queue);
    this._show(n, visible || n.level < 2);
    if (n.children) for (const c of n.children) this._hide(c);
  }

  _request(n, cam, queue) {
    if (n.queued) return;
    n.queued = true;
    queue.push({ node: n, tree: this, pri: cam.distanceTo(n.center) / n.size });
  }
  _show(n, on) { if (n.mesh) n.mesh.visible = on; if (n.water) n.water.visible = on; }
  _hide(n) { this._show(n, false); if (n.children) for (const c of n.children) this._hide(c); }
  _dispose(n) {
    if (n.children) for (const c of n.children) this._dispose(c);
    n.children = null; n.disposed = true;
    if (n.mesh) { this.group.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh = null; }
    if (n.water) { this.group.remove(n.water); n.water.geometry.dispose(); n.water = null; }
  }

  build(n) {
    n.queued = false;
    if (n.disposed || n.mesh) return;
    const surf = this.surface, R = this.body.radius, pal = this.pal;
    const M = N + 3;                       // grid with a 1-cell border for normals
    const step = n.span / N, minWL = n.size / N * 2;
    const P = new Float32Array(M * M * 3), Hh = new Float32Array(M * M), Cl = new Float32Array(M * M * 3);
    const cx = n.center.x, cy = n.center.y, cz = n.center.z;
    let minH = Infinity;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const d = faceDir(n.face, n.u0 + (i - 1) * step, n.v0 + (j - 1) * step, _v);
      surf.sample(d.x, d.y, d.z, _s, minWL);
      const k = j * M + i, r = R + _s.h;
      P[k * 3] = d.x * r - cx; P[k * 3 + 1] = d.y * r - cy; P[k * 3 + 2] = d.z * r - cz;
      Hh[k] = _s.h; if (_s.h < minH) minH = _s.h;
      pal.shade(_s, _c);
      Cl[k * 3] = _c.r; Cl[k * 3 + 1] = _c.g; Cl[k * 3 + 2] = _c.b;
    }
    const V = N + 1, total = V * V + V * 4;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = (j + 1) * M + (i + 1), o = (j * V + i) * 3;
      pos[o] = P[k * 3]; pos[o + 1] = P[k * 3 + 1]; pos[o + 2] = P[k * 3 + 2];
      e1.set(P[(k + 1) * 3] - P[(k - 1) * 3], P[(k + 1) * 3 + 1] - P[(k - 1) * 3 + 1], P[(k + 1) * 3 + 2] - P[(k - 1) * 3 + 2]);
      e2.set(P[(k + M) * 3] - P[(k - M) * 3], P[(k + M) * 3 + 1] - P[(k - M) * 3 + 1], P[(k + M) * 3 + 2] - P[(k - M) * 3 + 2]);
      nn.crossVectors(e1, e2).normalize();
      if (nn.dot(n.dir) < 0) nn.negate();
      nor[o] = nn.x; nor[o + 1] = nn.y; nor[o + 2] = nn.z;
      // slope-based rock on steep ground
      const slope = 1 - nn.dot(_v.set(pos[o] + cx, pos[o + 1] + cy, pos[o + 2] + cz).normalize());
      const rk = THREE.MathUtils.smoothstep(slope, 0.18, 0.42);
      col[o] = Cl[k * 3] + (pal.rock.r - Cl[k * 3]) * rk; col[o + 1] = Cl[k * 3 + 1] + (pal.rock.g - Cl[k * 3 + 1]) * rk; col[o + 2] = Cl[k * 3 + 2] + (pal.rock.b - Cl[k * 3 + 2]) * rk;
    }
    // skirts: duplicate the border ring, pushed toward the planet centre
    const drop = n.size * 0.08 + 2;
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    let sk = V * V;
    const edge = (get, flip) => {
      const start = sk;
      for (let i = 0; i < V; i++) {
        const src = get(i), o = sk * 3, s = src * 3;
        pos[o] = pos[s] - n.dir.x * drop; pos[o + 1] = pos[s + 1] - n.dir.y * drop; pos[o + 2] = pos[s + 2] - n.dir.z * drop;
        nor[o] = nor[s]; nor[o + 1] = nor[s + 1]; nor[o + 2] = nor[s + 2];
        col[o] = col[s]; col[o + 1] = col[s + 1]; col[o + 2] = col[s + 2];
        sk++;
      }
      for (let i = 0; i < N; i++) {
        const a = get(i), b = get(i + 1), c = start + i, d = start + i + 1;
        idx.push(a, c, b, b, c, d, a, b, c, b, d, c); // both windings: visible from either side
      }
    };
    edge((i) => i); edge((i) => N * V + i); edge((i) => i * V); edge((i) => i * V + N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.sys.material);
    mesh.position.copy(n.center);
    mesh.castShadow = n.level >= this.maxLevel - 4;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.group.add(mesh);
    n.mesh = mesh;
    n.minH = minH;
    if (this.surface.hasOcean && minH < 0) {
      const wp = new Float32Array(V * V * 3), wn = new Float32Array(V * V * 3);
      for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
        const d = faceDir(n.face, n.u0 + i * step, n.v0 + j * step, _v), o = (j * V + i) * 3;
        wp[o] = d.x * R - cx; wp[o + 1] = d.y * R - cy; wp[o + 2] = d.z * R - cz;
        wn[o] = d.x; wn[o + 1] = d.y; wn[o + 2] = d.z;
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
      wg.setAttribute('normal', new THREE.BufferAttribute(wn, 3));
      wg.setIndex(idx.slice(0, N * N * 6));
      wg.computeBoundingSphere();
      const water = new THREE.Mesh(wg, this.waterMaterial || (this.waterMaterial = makeWater(this.body.def)));
      water.position.copy(n.center); water.visible = false; water.receiveShadow = true;
      water.matrixAutoUpdate = false; water.updateMatrix();
      this.group.add(water);
      n.water = water;
    }
  }
}

function makeWater(def) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(def.ocean.deep).lerp(new THREE.Color(def.ocean.shallow), 0.35), roughness: 0.12, metalness: 0,
    transparent: true, opacity: 0.86, emissive: def.ocean.lava ? new THREE.Color(def.ocean.deep) : 0x000000, emissiveIntensity: def.ocean.lava ? 2.5 : 0,
  });
}

function makePalette(def) {
  const p = def.palette, C = (h) => new THREE.Color(h);
  const rock = C(p.rock), rockHigh = C(p.rockHigh), grass = C(p.grass), dry = C(p.grassDry), sand = C(p.sand), snow = C(p.snow), soil = C(p.soil);
  const hasSea = !!def.ocean && def.terrain.seaLevel > 0;
  const tmp = new THREE.Color();
  return {
    rock,
    shade(s, out) {
      const h = s.h;
      out.copy(dry).lerp(grass, THREE.MathUtils.smoothstep(s.moist, 0.25, 0.7));
      out.lerp(soil, THREE.MathUtils.smoothstep(s.moist, 0.3, 0.05) * 0.6);
      if (hasSea) out.lerp(sand, 1 - THREE.MathUtils.smoothstep(h, 3, 14));
      out.lerp(tmp.copy(rock).lerp(rockHigh, 0.5), THREE.MathUtils.smoothstep(s.mountain, 0.25, 0.6));
      out.lerp(snow, THREE.MathUtils.smoothstep(-s.temp, 0.12, 0.3));
      if (h < 0) out.lerp(tmp.copy(sand).multiplyScalar(0.55), THREE.MathUtils.smoothstep(-h, 0, 30));
      return out;
    },
  };
}

export default async function create(world) {
  const sys = {
    material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 }),
    trees: [],
  };
  for (const body of world.bodies) if (body.surface) { const t = new Tree(sys, body); sys.trees.push(t); body.terrain = t; }
  const queue = [];
  const camLocal = new THREE.Vector3();
  let pending = 0;
  return {
    name: 'terrain',
    update() {
      queue.length = 0;
      for (const t of sys.trees) {
        world.cameraLocalTo(t.body, camLocal);
        // distant bodies only need their 6 root chunks
        t.update(camLocal, queue);
      }
      queue.sort((a, b) => a.pri - b.pri);
      const budget = world.ctx.shot ? 40 : 7, t0 = performance.now();
      let i = 0;
      for (; i < queue.length; i++) {
        queue[i].tree.build(queue[i].node);
        if (performance.now() - t0 > budget) { i++; break; }
      }
      for (let j = i; j < queue.length; j++) queue[j].node.queued = false;
      pending = queue.length - i;
    },
    isReady() { return pending === 0; },
    dispose() { for (const t of sys.trees) { for (const r of t.roots) t._dispose(r); t.body.group.remove(t.group); } },
  };
}
