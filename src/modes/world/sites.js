// Settlement sites: deterministic list of places on a planet where
// civilisation lives. Pure data (no three.js) so planetgen can flatten the
// terrain under each site and any system can query them.
//
//   generateSites(def, raw) -> [{ id, name, kind, dir:{x,y,z} (unit, planet-local),
//       radius (m, flattened core), blend (m, falloff ring), height (m above sea),
//       seed, size (0..1) }]
//   `raw` is the un-flattened surface ({ sample(x,y,z,out,minWL) }).
// sites[0] is the capital: the default spawn point looks at it.
import { RNG, seedFrom } from '../../core/rng.js';
import { makeName } from '../../core/universe.js';

const KINDS = [
  // kind, radius range (m), weight per civ level [l1, l2, l3]
  ['outpost', [70, 110], [5, 3, 2]],
  ['village', [110, 170], [4, 5, 4]],
  ['town', [180, 260], [1, 3, 4]],
  ['city', [300, 420], [0, 1, 2]],
];

export function generateSites(def, raw) {
  const count = def.civ ? def.civ.settlements | 0 : 0;
  if (!count || !def.terrain) return [];
  const rng = new RNG(seedFrom(def.seed, 'sites'));
  const R = def.radius, H = def.terrain.maxHeight, lvl = Math.max(1, Math.min(3, def.civ.level));
  const s = { h: 0 }, d = { x: 0, y: 0, z: 0 }, sites = [];
  const hAt = (x, y, z) => raw.sample(x, y, z, s, 60).h;
  for (let i = 0; i < count; i++) {
    const kind = i === 0 ? KINDS[Math.min(3, lvl)] : rng.weighted(KINDS.map((k) => [k, k[2][lvl - 1]]));
    const radius = rng.float(kind[1][0], kind[1][1]);
    for (let tries = 0; tries < 400; tries++) {
      rng.onSphere(d);
      if (Math.abs(d.y) > 0.8) continue;                           // not at the poles
      if (i === 0 && (Math.abs(d.y) > 0.35)) continue;             // capital in the temperate belt
      const h = hAt(d.x, d.y, d.z);
      if (h < 6 || h > H * 0.3) continue;                          // on land, below the peaks
      // gentle ground: compare heights around the site
      let tx = -d.z, tz = d.x; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const bx = d.y * tz, by = d.z * tx - d.x * tz, bz = -d.y * tx;
      const e = (radius * 1.2) / R;
      let worst = 0, ok = true;
      for (let k = 0; k < 6 && ok; k++) {
        const a = (k / 6) * Math.PI * 2, ca = Math.cos(a) * e, sa = Math.sin(a) * e;
        const hh = hAt(d.x + tx * ca + bx * sa, d.y + by * sa, d.z + tz * ca + bz * sa);
        if (hh < 2) ok = false;
        worst = Math.max(worst, Math.abs(hh - h));
      }
      if (!ok || worst > radius * (0.14 + tries * 0.0006)) continue;
      const minSep = (3200 + radius * 4) / R;
      if (sites.some((o) => Math.acos(Math.min(1, o.dir.x * d.x + o.dir.y * d.y + o.dir.z * d.z)) < minSep)) continue;
      sites.push({ id: i, name: makeName(rng), kind: kind[0], dir: { x: d.x, y: d.y, z: d.z }, radius, blend: radius * 1.4, height: h, seed: seedFrom(def.seed, 'site', i), size: (radius - 70) / 350 });
      break;
    }
  }
  return sites;
}
