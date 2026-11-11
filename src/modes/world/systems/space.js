// Baseline space rendering: the star disc + glow and a procedural star field.
import * as THREE from 'three';
import { RNG } from '../../../core/rng.js';

export default async function create(world) {
  const star = world.star, def = world.system.star;
  const color = new THREE.Color(def.color);
  const disc = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 48, 24), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(40), toneMapped: false }));
  star.group.add(disc);
  // sky backdrop: points at "infinity", re-centred on the camera every frame
  const rng = new RNG(world.system.seed ^ 0xabc), n = 9000;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    rng.onSphere(v);
    // concentrate some stars in a galactic band
    if (i % 3 === 0) { v.y *= 0.18; v.normalize(); }
    pos.set([v.x, v.y, v.z], i * 3);
    const mag = Math.pow(rng.next(), 7) * 5 + 0.25;
    c.setHSL(rng.pick([0.6, 0.62, 0.08, 0.12, 0.0, 0.55]), rng.float(0.1, 0.6), 0.7).multiplyScalar(mag);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false, toneMapped: false }));
  stars.frustumCulled = false; stars.renderOrder = -10;
  stars.scale.setScalar(1e9);
  world.scene.add(stars);
  // the sky is fixed in the inertial frame, so it wheels overhead as a planet spins
  const q = new THREE.Quaternion();
  return {
    name: 'space',
    lateUpdate() {
      stars.position.copy(world.camera.position);
      stars.quaternion.copy(q.copy(world.frame.spin).invert());
    },
    dispose() { world.scene.remove(stars); geo.dispose(); },
  };
}
