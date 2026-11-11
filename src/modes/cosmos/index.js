// Cosmos mode placeholder: replaced by the cosmic-web structure-formation simulation.
import * as THREE from 'three';
export default async function create(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);
  camera.position.set(0, 0, 320);
  const n = 20000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * 400;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.2, color: 0x88aaff, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(pts);
  return {
    name: 'cosmos', scene, camera, look: { bloom: 0.9, bloomThreshold: 0.2 },
    async enter() {}, exit() {},
    update(dt) { pts.rotation.y += dt * 0.02; if (ctx.input.tapped) ctx.go('galaxy', { galaxyId: 0 }); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    isReady() { return true; },
  };
}
