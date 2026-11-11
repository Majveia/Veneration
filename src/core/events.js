// Tiny event emitter.
export class Emitter {
  constructor() { this._m = new Map(); }
  on(type, fn) { if (!this._m.has(type)) this._m.set(type, new Set()); this._m.get(type).add(fn); return () => this.off(type, fn); }
  off(type, fn) { const s = this._m.get(type); if (s) s.delete(fn); }
  emit(type, data) { const s = this._m.get(type); if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { console.error(`[event ${type}]`, e); } } }
}
