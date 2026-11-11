// Planet surface function: the single source of truth for terrain shape and
// climate. Terrain meshes, physics, flora / settlement placement all sample it,
// so what you see is exactly what you collide with.
//
//   const surface = createSurface(planetDef)
//   surface.height(x, y, z, minWavelength?)  -> metres above sea level (the
//       planet's base radius) for unit direction (x, y, z) in planet-local
//       space. minWavelength (metres) skips octaves finer than the caller can
//       resolve (LOD); omit it for full detail (physics, placement).
//   surface.sample(x, y, z, out)  -> fills out {h, temp, moist, mountain, land}
//   surface.normal(x, y, z, out)  -> surface normal (unit, planet-local)
//   surface.radius, surface.maxHeight, surface.hasOcean
//   surface.sites  -> settlement sites (see sites.js); the terrain is flattened
//       to site.height inside site.radius and blends back over site.blend.
//       sample() sets out.site to the site whose core contains the point (or null).
import { Simplex } from '../../core/noise.js';
import { hash32, smoothstep, saturate, lerp } from '../../core/rng.js';
import { generateSites } from './sites.js';

export function createSurface(def) {
  const T = def.terrain;
  if (!T) return null;
  const R = def.radius, H = T.maxHeight;
  const nA = new Simplex(def.seed), nB = new Simplex(def.seed ^ 0x9e3779b9), nC = new Simplex(def.seed ^ 0x51ed270b);
  const hasOcean = !!def.ocean && T.seaLevel > 0;
  // continent threshold: fraction of the surface that ends up below sea level
  const seaBias = hasOcean ? (T.seaLevel - 0.5) * 0.95 : -0.75;
  const cf = T.continentFreq, warp = T.warp;
  // physical wavelengths (metres) -> frequencies on the unit sphere
  const fMtn = R / 16000, fHill = R / 4200, fDet = R / 620, fMicro = R / 85, fTiny = R / 11, fDune = R / 420;
  const craterSeed = def.seed ^ 0xc2b2ae35;

  function craters(x, y, z, freq, depth) {
    // cellular craters: bowl + raised rim around hashed feature points
    const px = x * freq, py = y * freq, pz = z * freq;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    let h = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      let s = hash32((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791) ^ craterSeed);
      const fx = cx + (s & 1023) / 1023; s = hash32(s);
      const fy = cy + (s & 1023) / 1023; s = hash32(s);
      const fz = cz + (s & 1023) / 1023; s = hash32(s);
      const rad = 0.12 + 0.3 * ((s & 255) / 255);
      if ((s >>> 8 & 3) === 0) continue;
      const ddx = px - fx, ddy = py - fy, ddz = pz - fz;
      const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / rad;
      if (d < 1.5) {
        const bowl = d < 1 ? (d * d - 1) : 0;
        const rim = Math.exp(-(d - 1) * (d - 1) * 14) * 0.35;
        h += (bowl + rim) * rad * depth;
      }
    }
    return h;
  }

  const tmp = { h: 0, temp: 0, moist: 0, mountain: 0, land: 0 };

  function sample(x, y, z, out = tmp, minWL = 0) {
    rawSample(x, y, z, out, minWL);
    out.site = null;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i], d = x * s.dir.x + y * s.dir.y + z * s.dir.z;
      if (d > s.cosOuter) {
        const r = Math.acos(d > 1 ? 1 : d) * R;
        const w = 1 - smoothstep(s.radius, s.radius + s.blend, r);
        out.h = lerp(out.h, s.height, w);
        if (w > 0.999) out.site = s;
      }
    }
    return out;
  }

  function rawSample(x, y, z, out = tmp, minWL = 0) {
    // domain warp so coastlines and ranges meander
    const wx = nB.fbm(x * 1.3 + 7.1, y * 1.3, z * 1.3, 2), wy = nB.fbm(x * 1.3, y * 1.3 + 3.7, z * 1.3, 2), wz = nB.fbm(x * 1.3, y * 1.3, z * 1.3 + 9.2, 2);
    const qx = x + wx * warp, qy = y + wy * warp, qz = z + wz * warp;
    const c = nA.fbm(qx * cf, qy * cf, qz * cf, 6, 2.05, 0.52) - seaBias;
    // land profile: shelf -> coast -> plains -> highlands
    let base, land;
    if (c > 0) { land = smoothstep(0, 0.06, c); base = 0.012 * land + 0.22 * c * c + 0.05 * c; }
    else { land = 0; base = -0.02 - 0.5 * smoothstep(0, 0.5, -c) * (hasOcean ? 0.45 : 0.25); if (c > -0.03) base *= smoothstep(0, 0.03, -c); }
    // mountain ranges where a low-frequency mask allows
    const mm = nC.fbm(qx * cf * 1.9 + 31.4, qy * cf * 1.9, qz * cf * 1.9, 3);
    const mask = smoothstep(-0.05, 0.4, mm + c * 0.5) * (0.15 + 0.85 * land);
    let mtn = 0;
    if (mask > 0.001) {
      const r = nB.ridged(qx * fMtn, qy * fMtn, qz * fMtn, minWL > 4000 ? 3 : minWL > 800 ? 5 : 7);
      mtn = mask * Math.pow(r, 1.35) * T.mountains;
    }
    let h = base + mtn * 0.62;
    // rolling hills, attenuated on flat coastal plains
    const hillAmp = 0.035 * (0.25 + 0.75 * land) * (0.5 + T.rough);
    if (minWL < 3000) h += nA.fbm(x * fHill + 11, y * fHill + 5, z * fHill + 3, minWL > 500 ? 3 : 5) * hillAmp * (0.4 + mask);
    // mesas / terraces (desert canyon country)
    if (T.terraces > 0 && h > 0.01) {
      const steps = 14, t = h * steps, ft = Math.floor(t), fr = t - ft;
      const terr = (ft + smoothstep(0.35, 0.65, fr)) / steps;
      const tm = saturate(nC.noise(x * cf * 3.1, y * cf * 3.1, z * cf * 3.1) * 1.5 + T.terraces - 0.2);
      h = lerp(h, terr, tm * 0.85);
    }
    let hm = h * H;
    // medium / fine detail in metres
    const rough = 0.4 + T.rough + mtn * 1.5;
    if (minWL < 500) hm += nC.fbm(x * fDet, y * fDet, z * fDet, minWL > 80 ? 2 : 4) * 34 * rough;
    if (minWL < 60) hm += nB.fbm(x * fMicro + 3, y * fMicro + 1, z * fMicro + 7, minWL > 10 ? 2 : 3) * 4.5 * rough;
    if (minWL < 8) hm += nA.noise(x * fTiny, y * fTiny, z * fTiny) * 0.55 * rough;
    if (T.dunes > 0 && minWL < 300 && hm > 2) {
      const dm = smoothstep(0.5, 0.0, mask + mtn) * T.dunes;
      if (dm > 0.01) {
        const w = nA.noise(x * fDune * 0.25, y * fDune * 0.25, z * fDune * 0.25) * 2.2;
        const d = 1 - Math.abs(nB.noise(x * fDune + w, y * fDune * 0.35, z * fDune + w));
        hm += d * d * 26 * dm;
      }
    }
    if (T.craters > 0) {
      hm += craters(x, y, z, R / 30000, 30000 * 0.16) * T.craters;
      if (minWL < 2500) hm += craters(x, y, z, R / 5200, 5200 * 0.15) * T.craters;
      if (minWL < 400) hm += craters(x, y, z, R / 800, 800 * 0.14) * T.craters;
    }
    out.h = hm;
    out.land = land;
    out.mountain = mtn;
    // climate: latitude (y is the spin axis), altitude lapse and broad noise
    const lat = Math.abs(y);
    out.temp = def.climate.temp + 0.35 - lat * lat * 0.95 - Math.max(0, hm) / H * 0.7 + mm * 0.12;
    out.moist = saturate(def.climate.humidity + nC.fbm(x * 2.3 + 4, y * 2.3 + 8, z * 2.3 + 1, 3) * 0.45 - (hasOcean ? 0 : 0.1) + (c < 0.08 ? 0.15 : 0));
    return out;
  }

  function height(x, y, z, minWL = 0) { return sample(x, y, z, tmp, minWL).h; }

  function normal(x, y, z, out, eps = 1.5 / R) {
    // finite differences on the tangent plane
    let tx = -z, ty = 0, tz = x;
    let tl = Math.hypot(tx, tz);
    if (tl < 1e-6) { tx = 1; tz = 0; tl = 1; }
    tx /= tl; tz /= tl;
    const bx = y * tz - z * ty, by = z * tx - x * tz, bz = x * ty - y * tx;
    const h0 = height(x, y, z);
    const h1 = height(x + tx * eps, y + ty * eps, z + tz * eps);
    const h2 = height(x + bx * eps, y + by * eps, z + bz * eps);
    const d = eps * R;
    const sx = (h1 - h0) / d, sy = (h2 - h0) / d;
    let nx = x - tx * sx - bx * sy, ny = y - ty * sx - by * sy, nz = z - tz * sx - bz * sy;
    const nl = Math.hypot(nx, ny, nz);
    out.x = nx / nl; out.y = ny / nl; out.z = nz / nl;
    return out;
  }

  const sites = [];
  for (const s of generateSites(def, { sample: rawSample })) { s.cosOuter = Math.cos((s.radius + s.blend) / R); sites.push(s); }
  return { def, radius: R, maxHeight: H * 1.25 + 80, hasOcean, sample, height, normal, sites };
}
