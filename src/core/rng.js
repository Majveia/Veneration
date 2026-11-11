// Deterministic hashing + seeded random number generation.
// Everything in the universe is derived from integer seeds so any place can be
// regenerated identically from its coordinates.

export function hash32(a) {
  a |= 0;
  a = (a ^ 61) ^ (a >>> 16);
  a = (a + (a << 3)) | 0;
  a ^= a >>> 4;
  a = Math.imul(a, 0x27d4eb2d);
  a ^= a >>> 15;
  return a >>> 0;
}

// Combine any number of integers / strings into one 32-bit seed.
export function seedFrom(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    if (typeof p === 'string') {
      for (let i = 0; i < p.length; i++) h = Math.imul(h ^ p.charCodeAt(i), 0x01000193);
    } else {
      h = Math.imul(h ^ (p | 0), 0x01000193);
      h = Math.imul(h ^ ((p * 4096) | 0), 0x01000193);
    }
    h = hash32(h);
  }
  return h >>> 0;
}

// mulberry32-based generator with convenience helpers.
export class RNG {
  constructor(seed = 1) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); }
  bool(p = 0.5) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  // Weighted pick: items = [[value, weight], ...]
  weighted(items) {
    let total = 0;
    for (const it of items) total += it[1];
    let r = this.next() * total;
    for (const it of items) { r -= it[1]; if (r <= 0) return it[0]; }
    return items[items.length - 1][0];
  }
  gauss() {
    const u = 1 - this.next(), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Uniform direction on the unit sphere, written into out {x,y,z}.
  onSphere(out) {
    const z = this.float(-1, 1), a = this.float(0, Math.PI * 2), r = Math.sqrt(1 - z * z);
    out.x = r * Math.cos(a); out.y = z; out.z = r * Math.sin(a);
    return out;
  }
  fork(tag = 0) { return new RNG(seedFrom(this.s, tag, 0x51ed)); }
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a, b, x) => {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const remap = (x, a, b, c, d) => c + (d - c) * saturate((x - a) / (b - a));
