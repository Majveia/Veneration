// Deterministic procedural universe: galaxy -> star system -> planets / moons.
// Pure data (no three.js objects) so every mode, worker and tool can use it.
//
// Scale convention (compressed, Outer-Wilds-like but big enough for real vistas):
//   rocky planet radius 60-140 km, moons 15-45 km, gas giants 500-900 km,
//   star radius 5,000-12,000 km, orbits 150,000 km - 3,000,000 km.
//   Surface gravity is real (mu = g * R^2) so orbits, jumps and falls are physical.
import { RNG, seedFrom, lerp } from './rng.js';

export const HERO_SEED = 0x7e3a11;

const SYL_A = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ou', 'y', 'ei', 'ua'];
const SYL_C = ['v', 'n', 'r', 'l', 's', 'th', 'k', 'm', 'd', 'z', 'sh', 'h', 't', 'q', 'x', 'c', 'ph', 'b', 'g', 'lj', 'rr'];
const SYL_END = ['', '', 'n', 's', 'r', 'th', 'x', 'l', 'a', 'is', 'on', 'ar', 'um', 'el'];
export function makeName(rng, min = 2, max = 3) {
  const n = rng.int(min, max);
  let s = rng.bool(0.35) ? rng.pick(SYL_A) : '';
  for (let i = 0; i < n; i++) s += rng.pick(SYL_C) + rng.pick(SYL_A);
  s += rng.pick(SYL_END);
  return s[0].toUpperCase() + s.slice(1);
}

// Star classes: [class, tempK, colorHex, radius (m), relative luminosity, weight]
const STAR_CLASSES = [
  ['M', 3200, 0xff8a52, 5.0e6, 0.45, 30],
  ['K', 4600, 0xffb46b, 6.5e6, 0.7, 26],
  ['G', 5800, 0xfff1dc, 8.0e6, 1.0, 22],
  ['F', 7000, 0xf4f3ff, 9.5e6, 1.5, 10],
  ['A', 9000, 0xcfdcff, 1.1e7, 2.2, 6],
  ['B', 16000, 0xa9c1ff, 1.25e7, 3.2, 3],
  ['O', 32000, 0x8fb0ff, 1.4e7, 4.5, 1],
];

// "mood" names an art-direction reference used by sky, grading, flora and
// architecture so every world feels authored: a director, painter or film.
export const PLANET_TYPES = {
  terran: {
    moods: ['miyazaki', 'turner', 'botw', 'hudson-river'],
    palette: [
      { rock: 0x6b6660, rockHigh: 0x8d8780, soil: 0x5a4632, grass: 0x4f8f3a, grassDry: 0x9aa34a, sand: 0xdcc9a0, snow: 0xf4f8ff, flora: [0x2f6b2a, 0x4c9a3c, 0x87b84a, 0xe3a23c, 0xd9627a], accent: 0xffd27a },
      { rock: 0x5d6470, rockHigh: 0x878f9c, soil: 0x4f3f38, grass: 0x3f9a6a, grassDry: 0x8fae6c, sand: 0xe6d6b8, snow: 0xf6fbff, flora: [0x1f6f5a, 0x3fae84, 0xa7d68a, 0xf2c6de, 0xfff0a8], accent: 0x9fe8ff },
    ],
    sea: 0.62, atmosphere: { scatter: [0.10, 0.23, 0.56], density: 1, mie: 0.35, haze: 0xcfe2ff, sunset: 0xff8a4a, clouds: 0.5 },
    ocean: { shallow: 0x2fb7b0, deep: 0x06324f },
    terrain: { relief: 1.0, mountains: 1.0, rough: 0.5, dunes: 0, craters: 0, terraces: 0.15 },
    life: [0.9, 0.8], civ: [0.75, 3], temp: [0.1, 0.5], humid: [0.5, 0.8],
  },
  jungle: {
    moods: ['avatar', 'rousseau', 'annihilation'],
    palette: [
      { rock: 0x3d4a45, rockHigh: 0x5f6f66, soil: 0x33261f, grass: 0x1f8a4c, grassDry: 0x4fae5c, sand: 0xb8c49a, snow: 0xe8fff4, flora: [0x0f5f3c, 0x1fae7a, 0x6ee0a0, 0xc84bd8, 0x39d8ff], accent: 0x6effe0 },
      { rock: 0x4a3d52, rockHigh: 0x6d5f7a, soil: 0x2e1f33, grass: 0x7a3fae, grassDry: 0xb86ad0, sand: 0xd9b8c8, snow: 0xfbeeff, flora: [0x5a1f8a, 0xb23fc8, 0xff7ad8, 0x39ffd0, 0xffe86a], accent: 0xff8af0 },
    ],
    sea: 0.5, atmosphere: { scatter: [0.14, 0.30, 0.42], density: 1.5, mie: 0.6, haze: 0xbfffe0, sunset: 0xff6aa8, clouds: 0.7 },
    ocean: { shallow: 0x39d8c0, deep: 0x06283f },
    terrain: { relief: 1.2, mountains: 1.3, rough: 0.6, dunes: 0, craters: 0, terraces: 0.3 },
    life: [1.0, 0.9], civ: [0.5, 2], temp: [0.5, 0.8], humid: [0.8, 1.0],
  },
  desert: {
    moods: ['villeneuve', 'moebius', 'bebop', 'lawrence'],
    palette: [
      { rock: 0x9a5a3a, rockHigh: 0xc47a4f, soil: 0xb8804f, grass: 0xa89a5a, grassDry: 0xc8b070, sand: 0xe6b877, snow: 0xfff3e0, flora: [0x6f7a3a, 0x9a8a4a, 0xc8a85a, 0x3f8a7a, 0xd8583a], accent: 0xffc86a },
      { rock: 0x7a4a5f, rockHigh: 0xb06a7f, soil: 0xa86a6f, grass: 0x8a7a9a, grassDry: 0xc8a0b0, sand: 0xf0c4a8, snow: 0xfff0f0, flora: [0x4a8a9a, 0x7ac8c0, 0xf0a0a8, 0xe8d08a, 0x6a4a9a], accent: 0x7af0e0 },
    ],
    sea: 0.08, atmosphere: { scatter: [0.26, 0.20, 0.14], density: 0.8, mie: 0.9, haze: 0xf0c8a0, sunset: 0x6aa8ff, clouds: 0.12 },
    ocean: { shallow: 0x4fc0b0, deep: 0x0f3f4a },
    terrain: { relief: 0.9, mountains: 0.8, rough: 0.35, dunes: 1, craters: 0.1, terraces: 0.8 },
    life: [0.25, 0.3], civ: [0.55, 2], temp: [0.6, 0.95], humid: [0.02, 0.2],
  },
  ocean: {
    moods: ['hokusai', 'ponyo', 'solaris'],
    palette: [
      { rock: 0x4f5a66, rockHigh: 0x7a8794, soil: 0x5f5a4a, grass: 0x5aae6a, grassDry: 0xa8c87a, sand: 0xf0e4c4, snow: 0xffffff, flora: [0x2f8a5a, 0x6ac88a, 0xf07a5a, 0xf0d86a, 0xf0a0c8], accent: 0x8af0ff },
    ],
    sea: 0.9, atmosphere: { scatter: [0.09, 0.22, 0.58], density: 1.1, mie: 0.4, haze: 0xd8f0ff, sunset: 0xffa06a, clouds: 0.65 },
    ocean: { shallow: 0x38c8d8, deep: 0x04284f },
    terrain: { relief: 0.7, mountains: 0.9, rough: 0.5, dunes: 0, craters: 0, terraces: 0.1 },
    life: [0.8, 0.9], civ: [0.5, 2], temp: [0.3, 0.6], humid: [0.8, 1.0],
  },
  ice: {
    moods: ['tarkovsky', 'friedrich', 'the-thing'],
    palette: [
      { rock: 0x4a5566, rockHigh: 0x77859a, soil: 0x6a7480, grass: 0x8aa0a8, grassDry: 0xb0c0c8, sand: 0xc8d4e0, snow: 0xf2f8ff, flora: [0x3a5a6a, 0x5f8a9a, 0x9ac8d8, 0xd8f0ff, 0x7a6ab0], accent: 0x8affd8 },
    ],
    sea: 0.3, atmosphere: { scatter: [0.08, 0.18, 0.40], density: 0.7, mie: 0.5, haze: 0xe0f0ff, sunset: 0xffb0c8, clouds: 0.4 },
    ocean: { shallow: 0x7ad8e8, deep: 0x0a2f55 },
    terrain: { relief: 1.1, mountains: 1.2, rough: 0.55, dunes: 0.3, craters: 0.1, terraces: 0 },
    life: [0.3, 0.3], civ: [0.3, 1], temp: [-0.9, -0.5], humid: [0.3, 0.7],
  },
  lava: {
    moods: ['mordor', 'martin', 'mustafar'],
    palette: [
      { rock: 0x241f22, rockHigh: 0x4a3f3f, soil: 0x33282a, grass: 0x4a3a3a, grassDry: 0x6a4a3a, sand: 0x3f3536, snow: 0x8a8a90, flora: [0x5a2a1f, 0x8a3a1f, 0xff6a1f, 0xffc04a, 0x3a3a4a], accent: 0xff5a1a },
    ],
    sea: 0.25, atmosphere: { scatter: [0.30, 0.14, 0.08], density: 1.3, mie: 1.0, haze: 0xb85a3a, sunset: 0xffd08a, clouds: 0.5 },
    ocean: { shallow: 0xffa030, deep: 0xc8300a, lava: true },
    terrain: { relief: 1.2, mountains: 1.4, rough: 0.7, dunes: 0, craters: 0.3, terraces: 0.2 },
    life: [0.05, 0.05], civ: [0.15, 1], temp: [0.95, 1.0], humid: [0, 0.1],
  },
  barren: {
    moods: ['kubrick', 'apollo', 'gravity'],
    palette: [
      { rock: 0x6a6866, rockHigh: 0x9a9895, soil: 0x77736e, grass: 0x77736e, grassDry: 0x8a8680, sand: 0x9a958c, snow: 0xdcdcdc, flora: [0x5a5a5a, 0x7a7a7a, 0x9a9a9a, 0xbababa, 0xdadada], accent: 0xa8d8ff },
      { rock: 0x7a5a4a, rockHigh: 0xa8826a, soil: 0x8a6a55, grass: 0x8a6a55, grassDry: 0x9a7a62, sand: 0xb8937a, snow: 0xe8dcd0, flora: [0x6a4a3a, 0x8a6a55, 0xa8826a, 0xc8a88a, 0xe8d0b8], accent: 0xffb07a },
    ],
    sea: 0, atmosphere: null, ocean: null,
    terrain: { relief: 0.8, mountains: 0.7, rough: 0.6, dunes: 0.1, craters: 1, terraces: 0 },
    life: [0, 0], civ: [0.25, 1], temp: [-0.6, 0.6], humid: [0, 0],
  },
  toxic: {
    moods: ['rick-and-morty', 'giger', 'roadside-picnic'],
    palette: [
      { rock: 0x4a4a2a, rockHigh: 0x7a7a3a, soil: 0x55501f, grass: 0x9ab81f, grassDry: 0xc8d83a, sand: 0xb8a84a, snow: 0xe8f0a0, flora: [0x6a8a1f, 0xa8d81f, 0xf0ff5a, 0xff4ad8, 0x4affd8], accent: 0xd8ff3a },
      { rock: 0x3a2a4a, rockHigh: 0x5a3f7a, soil: 0x2a1f3a, grass: 0xff5a9a, grassDry: 0xff9ac0, sand: 0x7a5a9a, snow: 0xf0d0ff, flora: [0xff3a8a, 0xff8ac0, 0x3affea, 0xfff03a, 0x8a3aff], accent: 0x3affea },
    ],
    sea: 0.35, atmosphere: { scatter: [0.20, 0.34, 0.12], density: 1.8, mie: 1.0, haze: 0xd8e88a, sunset: 0xc84aff, clouds: 0.8 },
    ocean: { shallow: 0xa8f03a, deep: 0x1f4a0a },
    terrain: { relief: 1.0, mountains: 0.9, rough: 0.6, dunes: 0.2, craters: 0.2, terraces: 0.5 },
    life: [0.7, 0.6], civ: [0.3, 2], temp: [0.2, 0.8], humid: [0.5, 0.9],
  },
  gas: {
    moods: ['2001', 'interstellar'],
    palette: [
      { bands: [0xd8b88a, 0xb8875a, 0xf0e0c0, 0x8a5a3a, 0xe8c8a0], storm: 0xc8502a },
      { bands: [0x8ab8d8, 0x5a8ab8, 0xc0e0f0, 0x3a5a8a, 0xa0c8e8], storm: 0xf0f8ff },
      { bands: [0xd8a8c8, 0xa86a9a, 0xf0d0e8, 0x6a3a6a, 0xe8b8d8], storm: 0xffe08a },
      { bands: [0xa8d8b8, 0x5aa88a, 0xd8f0d0, 0x2a6a5a, 0xc8e8b8], storm: 0xfff0c0 },
    ],
    sea: 0, atmosphere: { scatter: [0.2, 0.25, 0.35], density: 1.2, mie: 0.3, haze: 0xfff0e0, sunset: 0xffa06a, clouds: 0 },
    ocean: null, terrain: null, life: [0, 0], civ: [0, 0], temp: [-0.5, 0.2], humid: [0, 0],
  },
};

const CIV_STYLES = ['spire', 'adobe', 'pagoda', 'brutalist', 'organic', 'neon', 'monolith', 'nomad'];

function makePlanet(rng, sys, index, type, a, opts = {}) {
  const T = PLANET_TYPES[type];
  const isGas = type === 'gas';
  const isMoon = !!opts.moonOf;
  const radius = opts.radius || (isGas ? rng.float(5.0e5, 9.0e5) : isMoon ? rng.float(1.5e4, 4.5e4) : rng.float(6.0e4, 1.4e5));
  const gravity = opts.gravity || (isGas ? rng.float(12, 24) : lerp(1.6, 11.5, Math.pow((radius - 1.5e4) / 1.25e5, 0.7)) * rng.float(0.85, 1.15));
  const palette = structuredClone(rng.pick(T.palette));
  const seed = seedFrom(sys.seed, 'body', index, isMoon ? 77 : 0);
  const parentMu = opts.moonOf ? opts.moonOf.mu : sys.star.mu;
  const p = {
    id: `${sys.id}:${index}`, index, seed, name: opts.name || makeName(rng), type,
    mood: opts.mood || rng.pick(T.moods),
    kind: isGas ? 'gas' : isMoon ? 'moon' : 'planet',
    parent: opts.moonOf ? opts.moonOf.index : -1,
    radius, gravity, mu: gravity * radius * radius,
    orbit: {
      a, e: opts.e ?? rng.float(0, 0.06), inc: opts.inc ?? rng.float(-0.06, 0.06) * (isMoon ? 3 : 1),
      node: rng.float(0, Math.PI * 2), peri: rng.float(0, Math.PI * 2), M0: opts.M0 ?? rng.float(0, Math.PI * 2),
      period: 2 * Math.PI * Math.sqrt((a * a * a) / parentMu),
    },
    spin: { period: opts.day || (isGas ? rng.float(900, 1800) : rng.float(1500, 3000)), tilt: opts.tilt ?? rng.float(0, 0.45), phase: rng.float(0, Math.PI * 2) },
    palette,
    climate: { temp: rng.float(T.temp[0], T.temp[1]), humidity: rng.float(T.humid[0], T.humid[1]) },
    terrain: T.terrain ? {
      ...T.terrain,
      seaLevel: T.sea, // fraction of the surface under water (0 = dry world)
      maxHeight: (isMoon ? 0.045 : 0.032) * radius * T.terrain.relief * rng.float(0.8, 1.2),
      continentFreq: rng.float(1.1, 1.9), warp: rng.float(0.3, 0.7),
    } : null,
    atmosphere: T.atmosphere ? {
      ...T.atmosphere,
      height: radius * (isGas ? 0.05 : 0.11),
      scaleHeight: radius * (isGas ? 0.012 : 0.022),
      clouds: T.atmosphere.clouds * rng.float(0.6, 1.3),
    } : null,
    ocean: T.sea > 0 && T.ocean ? { ...T.ocean } : null,
    life: { flora: T.life[0] * rng.float(0.7, 1), fauna: T.life[1] * rng.float(0.6, 1), glow: type === 'jungle' || type === 'toxic' },
    civ: { level: 0, style: rng.pick(CIV_STYLES), settlements: 0 },
    rings: null, moons: [],
  };
  if (rng.bool(T.civ[0])) {
    p.civ.level = rng.int(1, T.civ[1]);
    p.civ.settlements = [0, 6, 14, 26][p.civ.level];
  }
  if (isMoon && p.atmosphere) p.atmosphere.density *= 0.8;
  Object.assign(p, opts.override || {});
  return p;
}

function addMoons(rng, sys, planet, list, count, types) {
  let a = planet.radius * rng.float(5.5, 8);
  for (let i = 0; i < count; i++) {
    const type = Array.isArray(types) ? types[i % types.length] : rng.weighted(types);
    const m = makePlanet(rng, sys, list.length, type, a, { moonOf: planet });
    planet.moons.push(m.index);
    list.push(m);
    a *= rng.float(1.5, 2.1);
  }
}

export class Universe {
  constructor(seed = 20261111) {
    this.seed = seed >>> 0;
    this._systems = new Map();
  }

  // Galaxy descriptor for the galaxy view; `id` is any integer (e.g. a halo
  // index from the cosmic web simulation).
  galaxy(id = 0) {
    const seed = seedFrom(this.seed, 'galaxy', id);
    const rng = new RNG(seed);
    const type = id === 0 ? 'spiral' : rng.weighted([['spiral', 5], ['barred', 3], ['elliptical', 2], ['irregular', 1], ['ring', 0.5]]);
    return {
      id, seed, type, name: id === 0 ? 'Veneration' : makeName(rng, 2, 4),
      arms: type === 'elliptical' || type === 'irregular' ? 0 : rng.int(2, 5),
      radiusLy: rng.float(3.5e4, 9e4), twist: rng.float(2.2, 4.5), bulge: rng.float(0.12, 0.3),
      tilt: rng.float(-0.5, 0.5), hue: rng.float(0, 1), starCount: Math.round(rng.float(0.8, 4) * 1e11),
    };
  }

  // Star system descriptor. `galaxyId`, `starId` are integers; (0, 0) is the
  // hand-tuned hero system the game starts in.
  system(galaxyId = 0, starId = 0) {
    const key = `${galaxyId}/${starId}`;
    if (this._systems.has(key)) return this._systems.get(key);
    const sys = galaxyId === 0 && starId === 0 ? this._heroSystem() : this._randomSystem(galaxyId, starId);
    this._systems.set(key, sys);
    return sys;
  }

  _star(rng, forceClass) {
    const c = forceClass ? STAR_CLASSES.find((s) => s[0] === forceClass) : rng.weighted(STAR_CLASSES.map((s) => [s, s[5]]));
    const radius = c[3] * rng.float(0.9, 1.1);
    // mu chosen so a planet at 3e8 m takes roughly a day of real time to orbit
    const mu = 1.4e17 * (radius / 8e6) ** 2;
    return { class: c[0], temp: c[1] * rng.float(0.93, 1.07), color: c[2], radius, luminosity: c[4], mu, name: '' };
  }

  _heroSystem() {
    const rng = new RNG(HERO_SEED);
    const sys = { id: '0/0', galaxyId: 0, starId: 0, seed: HERO_SEED, name: 'Sol Venera', star: this._star(rng, 'G'), bodies: [], belts: [] };
    sys.star.name = sys.name;
    const B = sys.bodies;
    B.push(makePlanet(rng, sys, B.length, 'lava', 1.6e8, { name: 'Cinder', mood: 'mordor', radius: 6.2e4 }));
    const home = makePlanet(rng, sys, B.length, 'terran', 3.2e8, {
      name: 'Aurelia', mood: 'miyazaki', radius: 1.2e5, gravity: 9.2, day: 2400, tilt: 0.28, M0: 0.4,
    });
    home.civ = { level: 3, style: 'spire', settlements: 28 };
    home.life = { flora: 1, fauna: 0.9, glow: false };
    B.push(home);
    addMoons(rng, sys, home, B, 2, ['barren', 'ice']);
    B[home.moons[0]].name = 'Pale';
    B[home.moons[1]].name = 'Hoarfrost';
    const dune = makePlanet(rng, sys, B.length, 'desert', 5.4e8, { name: 'Moebius', mood: 'moebius', radius: 9.5e4, day: 2100 });
    dune.civ = { level: 2, style: 'adobe', settlements: 14 };
    B.push(dune);
    addMoons(rng, sys, dune, B, 1, ['barren']);
    const giant = makePlanet(rng, sys, B.length, 'gas', 1.05e9, { name: 'Leviathan', mood: '2001', radius: 8.2e5 });
    giant.rings = { inner: giant.radius * 1.35, outer: giant.radius * 2.3, color: 0xd8c8a8, seed: 7 };
    B.push(giant);
    addMoons(rng, sys, giant, B, 3, ['jungle', 'ocean', 'ice']);
    B[giant.moons[0]].name = 'Eywa';
    B[giant.moons[0]].mood = 'avatar';
    B[giant.moons[0]].civ = { level: 1, style: 'organic', settlements: 6 };
    const toxic = makePlanet(rng, sys, B.length, 'toxic', 1.7e9, { name: 'Squanch', mood: 'rick-and-morty', radius: 8.0e4 });
    toxic.civ = { level: 2, style: 'neon', settlements: 12 };
    B.push(toxic);
    B.push(makePlanet(rng, sys, B.length, 'ice', 2.5e9, { name: 'Solace', mood: 'tarkovsky', radius: 1.0e5 }));
    sys.belts.push({ inner: 7.2e8, outer: 8.4e8, count: 4000, seed: 11 });
    sys.home = home.index;
    return sys;
  }

  _randomSystem(galaxyId, starId) {
    const seed = seedFrom(this.seed, 'system', galaxyId, starId);
    const rng = new RNG(seed);
    const sys = { id: `${galaxyId}/${starId}`, galaxyId, starId, seed, name: makeName(rng), star: this._star(rng), bodies: [], belts: [] };
    sys.star.name = sys.name;
    const B = sys.bodies;
    const n = rng.int(3, 7);
    let a = rng.float(1.3e8, 2.2e8);
    const hot = sys.star.luminosity;
    for (let i = 0; i < n; i++) {
      const warmth = (hot * 3.2e8 * 3.2e8) / (a * a); // 1 = habitable zone
      let table;
      if (warmth > 2.2) table = [['lava', 4], ['desert', 3], ['barren', 3], ['toxic', 1]];
      else if (warmth > 0.45) table = [['terran', 4], ['jungle', 3], ['ocean', 3], ['desert', 3], ['toxic', 2], ['barren', 1]];
      else if (warmth > 0.08) table = [['gas', 5], ['ice', 3], ['barren', 2], ['toxic', 1], ['desert', 1]];
      else table = [['ice', 4], ['gas', 3], ['barren', 3]];
      const type = rng.weighted(table);
      const p = makePlanet(rng, sys, B.length, type, a);
      B.push(p);
      if (type === 'gas') {
        if (rng.bool(0.6)) p.rings = { inner: p.radius * rng.float(1.25, 1.5), outer: p.radius * rng.float(1.9, 2.6), color: rng.pick([0xd8c8a8, 0xa8c8d8, 0xd8a8b8, 0xc8d8c0]), seed: rng.int(1, 999) };
        addMoons(rng, sys, p, B, rng.int(1, 4), [['ice', 3], ['barren', 3], ['jungle', 1], ['ocean', 1], ['desert', 1], ['lava', 1]]);
      } else if (rng.bool(0.55)) {
        addMoons(rng, sys, p, B, rng.int(1, 2), [['barren', 5], ['ice', 2], ['desert', 1]]);
      }
      if (rng.bool(0.25)) sys.belts.push({ inner: a * 1.25, outer: a * 1.4, count: rng.int(1500, 4000), seed: rng.int(1, 9999) });
      a *= rng.float(1.55, 2.2);
    }
    // the most hospitable body is "home"
    let best = 0, score = -1;
    B.forEach((b, i) => { const s = b.life.flora + b.civ.level * 0.5 + (b.kind === 'planet' ? 0.2 : 0); if (b.type !== 'gas' && s > score) { score = s; best = i; } });
    sys.home = best;
    return sys;
  }
}

// Kepler: position of a body on its orbit at time t, relative to its parent, in
// the system's inertial frame (y up = ecliptic normal). Writes into out {x,y,z}.
export function orbitPosition(orbit, t, out) {
  const M = orbit.M0 + (2 * Math.PI * t) / orbit.period;
  let E = M;
  for (let i = 0; i < 5; i++) E -= (E - orbit.e * Math.sin(E) - M) / (1 - orbit.e * Math.cos(E));
  const xo = orbit.a * (Math.cos(E) - orbit.e), zo = orbit.a * Math.sqrt(1 - orbit.e * orbit.e) * Math.sin(E);
  const cw = Math.cos(orbit.peri), sw = Math.sin(orbit.peri), cn = Math.cos(orbit.node), sn = Math.sin(orbit.node), ci = Math.cos(orbit.inc), si = Math.sin(orbit.inc);
  const x1 = xo * cw - zo * sw, z1 = xo * sw + zo * cw;
  out.x = x1 * cn - z1 * ci * sn;
  out.z = x1 * sn + z1 * ci * cn;
  out.y = z1 * si;
  return out;
}
