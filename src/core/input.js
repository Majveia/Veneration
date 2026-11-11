// Device-independent input. Modes read *actions*, never raw devices:
//
//   input.move        Vector2  x = strafe (-1..1), y = forward (-1..1)
//   input.look        Vector2  accumulated look delta this frame, in radians
//   input.zoom        number   wheel / pinch delta this frame (+ = zoom in)
//   input.down(a)     boolean  action currently held
//   input.pressed(a)  boolean  action went down this frame
//   input.released(a) boolean  action went up this frame
//   input.pointer     {x, y, ndcX, ndcY, down, moved}  primary pointer for picking
//   input.tapped      boolean  a click / tap (no drag) completed this frame
//   input.isTouch     boolean  last interaction came from a touch screen
//
// Actions: jump sprint crouch interact use view boost brake up down primary
//          secondary map menu light scan exit rollL rollR
//
// Touch UI lives in src/ui/ and drives input.virtual.{setMove, addLook, set}.
import * as THREE from 'three';

const KEYMAP = {
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint', ControlLeft: 'crouch', KeyC: 'crouch',
  KeyE: 'interact', KeyF: 'use', KeyV: 'view', KeyB: 'boost', KeyX: 'brake', KeyR: 'up', KeyG: 'down',
  KeyM: 'map', Escape: 'menu', KeyL: 'light', KeyT: 'scan', KeyQ: 'rollL', KeyZ: 'exit', Tab: 'map',
  Enter: 'primary', KeyH: 'help', KeyP: 'photo',
};
const AXIS_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.move = new THREE.Vector2();
    this.look = new THREE.Vector2();
    this.zoom = 0;
    this.pointer = { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, moved: 0 };
    this.tapped = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.sensitivity = 0.0022;
    this.wantLock = false;      // modes set this to request pointer lock on click
    this.dragLook = false;      // when true, dragging with the mouse produces look deltas (no lock needed)
    this.locked = false;
    this._held = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this._keys = new Set();
    this._lookAcc = new THREE.Vector2();
    this._zoomAcc = 0;
    this._tapAcc = false;
    this._vMove = new THREE.Vector2();
    this._vHeld = new Set();
    this._padHeld = new Set();
    const self = this;
    this.virtual = {
      setMove(x, y) { self._vMove.set(x, y); self.isTouch = true; },
      addLook(dx, dy) { self._lookAcc.x += dx; self._lookAcc.y += dy; },
      set(action, on) { self._setAction(action, on, self._vHeld); },
      tap(action) { self._pressed.add(action); },
    };
    this._bind();
  }

  _setAction(a, on, bank = this._held) {
    if (on) { if (!this.down(a)) this._pressed.add(a); bank.add(a); }
    else if (bank.has(a)) { bank.delete(a); if (!this.down(a)) this._released.add(a); }
  }

  down(a) { return this._held.has(a) || this._vHeld.has(a) || this._padHeld.has(a); }
  pressed(a) { return this._frame_pressed ? this._frame_pressed.has(a) : false; }
  released(a) { return this._frame_released ? this._frame_released.has(a) : false; }

  _bind() {
    const dom = this.dom;
    const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this._keys.add(e.code);
      this.isTouch = false;
      const a = KEYMAP[e.code];
      if (a) this._setAction(a, true);
    });
    addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      const a = KEYMAP[e.code];
      if (a) this._setAction(a, false);
    });
    addEventListener('blur', () => { this._keys.clear(); for (const a of [...this._held]) this._setAction(a, false); });

    // Pointer: mouse look (locked or drag) + primary pointer for picking.
    // Touch look/move is handled by the touch UI through input.virtual; the
    // fallback below gives a usable left-half-move / right-half-look scheme
    // when no touch UI is mounted.
    const touches = new Map();
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.isTouch = true;
        touches.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, left: e.clientX < innerWidth * 0.4, t: performance.now(), moved: 0 });
      } else {
        this.isTouch = false;
        if (this.wantLock && !this.locked && e.button === 0) dom.requestPointerLock?.();
        if (e.button === 0) this._setAction('primary', true);
        if (e.button === 2) this._setAction('secondary', true);
      }
      this.pointer.down = true; this.pointer.moved = 0;
      this._setPointer(e);
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        const t = touches.get(e.pointerId);
        if (!t) return;
        const dx = e.clientX - t.x, dy = e.clientY - t.y;
        t.x = e.clientX; t.y = e.clientY; t.moved += Math.abs(dx) + Math.abs(dy);
        if (this.touchFallback) {
          if (t.left) {
            const mx = (t.x - t.x0) / 60, my = -(t.y - t.y0) / 60;
            const l = Math.hypot(mx, my);
            this._vMove.set(l > 1 ? mx / l : mx, l > 1 ? my / l : my);
          } else { this._lookAcc.x += dx * this.sensitivity * 2.2; this._lookAcc.y += dy * this.sensitivity * 2.2; }
        } else if (this.dragLook) {
          if (touches.size === 1) { this._lookAcc.x += dx * this.sensitivity * 2.2; this._lookAcc.y += dy * this.sensitivity * 2.2; }
        }
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (this._pinch) this._zoomAcc += (d - this._pinch) * 0.01;
          this._pinch = d;
        }
        this.pointer.moved += Math.abs(dx) + Math.abs(dy);
        this._setPointer(e);
      } else {
        if (this.locked) { this._lookAcc.x += e.movementX * this.sensitivity; this._lookAcc.y += e.movementY * this.sensitivity; }
        else if (this.dragLook && this.pointer.down) { this._lookAcc.x += e.movementX * this.sensitivity * 1.5; this._lookAcc.y += e.movementY * this.sensitivity * 1.5; }
        this.pointer.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        this._setPointer(e);
      }
    });
    const up = (e) => {
      if (e.pointerType === 'touch') {
        const t = touches.get(e.pointerId);
        touches.delete(e.pointerId);
        if (touches.size < 2) this._pinch = 0;
        if (t && t.left && this.touchFallback) this._vMove.set(0, 0);
        if (t && t.moved < 12 && performance.now() - t.t < 350) this._tapAcc = true;
      } else {
        if (e.button === 0) this._setAction('primary', false);
        if (e.button === 2) this._setAction('secondary', false);
        if (this.pointer.moved < 6 && e.button === 0 && e.target === dom) this._tapAcc = true;
      }
      this.pointer.down = touches.size > 0;
    };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this._zoomAcc += -Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    this.touchFallback = true;
  }

  _setPointer(e) {
    const p = this.pointer;
    p.x = e.clientX; p.y = e.clientY;
    p.ndcX = (e.clientX / innerWidth) * 2 - 1;
    p.ndcY = -(e.clientY / innerHeight) * 2 + 1;
  }

  exitLock() { if (this.locked) document.exitPointerLock?.(); }

  // Called once per frame by main before mode.update().
  update(dt) {
    // keyboard axes
    let mx = 0, my = 0;
    for (const k of this._keys) { const a = AXIS_KEYS[k]; if (a) { mx += a[0]; my += a[1]; } }
    // gamepad
    this._padHeld.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.14 ? 0 : v);
      mx += dz(gp.axes[0] || 0); my -= dz(gp.axes[1] || 0);
      this._lookAcc.x += dz(gp.axes[2] || 0) * 2.6 * dt; this._lookAcc.y += dz(gp.axes[3] || 0) * 2.0 * dt;
      const map = ['jump', 'crouch', 'interact', 'view', 'down', 'up', 'brake', 'boost', 'map', 'menu', 'sprint', 'scan'];
      map.forEach((a, i) => { if (gp.buttons[i] && gp.buttons[i].pressed) { if (!this.down(a) && !this._padPrev?.has(a)) this._pressed.add(a); this._padHeld.add(a); } });
      break;
    }
    this._padPrev = new Set(this._padHeld);
    mx += this._vMove.x; my += this._vMove.y;
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    this.move.set(mx, my);
    this.look.copy(this._lookAcc); this._lookAcc.set(0, 0);
    this.zoom = this._zoomAcc; this._zoomAcc = 0;
    this.tapped = this._tapAcc; this._tapAcc = false;
    this._frame_pressed = this._pressed; this._pressed = new Set();
    this._frame_released = this._released; this._released = new Set();
  }
}
