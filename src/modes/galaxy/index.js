// Galaxy mode placeholder: replaced by the full galaxy view.
import * as THREE from 'three';
export default async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);
  camera.position.set(0, 120, 260); camera.lookAt(0, 0, 0);
  const n = 40000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = Math.pow(Math.random(), 0.6) * 160, a = r * 0.05 + (i % 3) * 2.094 + Math.random() * 0.5; pos.set([Math.cos(a) * r, (Math.random() - 0.5) * 6, Math.sin(a) * r], i * 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.1, color: 0xffd9aa, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(pts);
  return {
    name: 'galaxy', scene, camera, look: { bloom: 0.9, bloomThreshold: 0.2 },
    async enter() {}, exit() {},
    update(dt) { pts.rotation.y += dt * 0.03; if (ctx.input.tapped) ctx.go('world', { galaxyId: 0, starId: 0 }); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    isReady() { return true; },
  };
}
