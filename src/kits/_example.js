// Minimal kit example for the viewer:  kit.html?kit=_example
import * as THREE from 'three';
export function makeThing(seed = 1) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshStandardMaterial({ color: 0xd8b070, roughness: 0.6, flatShading: true }));
  m.castShadow = m.receiveShadow = true;
  m.position.y = 1;
  return m;
}
export async function demo(view) {
  const thing = makeThing(+(view.params.seed || 1));
  view.scene.add(thing);
  view.frame({ center: new THREE.Vector3(0, 1, 0), radius: 1.5 });
  view.onUpdate((dt) => { thing.rotation.y += dt * 0.5; });
}
