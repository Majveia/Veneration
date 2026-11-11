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
  if (view.params.refract) {
    // refractive-layer smoke test: a lens that distorts and tints what is behind it
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16), new THREE.ShaderMaterial({
      uniforms: { tOpaqueColor: view.post.shared.tOpaqueColor, tOpaqueDepth: view.post.shared.tOpaqueDepth, uResolution: view.post.shared.uResolution },
      vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vN; void main(){ vN = normalMatrix * normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);\n#include <logdepthbuf_vertex>\n}',
      fragmentShader: '#include <logdepthbuf_pars_fragment>\nuniform sampler2D tOpaqueColor; uniform sampler2D tOpaqueDepth; uniform vec2 uResolution; varying vec3 vN; void main(){\n#include <logdepthbuf_fragment>\n vec2 uv = gl_FragCoord.xy / uResolution; vec3 n = normalize(vN); vec3 c = texture2D(tOpaqueColor, uv + n.xy * 0.05).rgb; float d = texture2D(tOpaqueDepth, uv).r; gl_FragColor = vec4(c * vec3(0.6, 0.9, 1.0) + vec3(0.0, 0.02, 0.05) * min(d, 20.0), 1.0); }',
    }));
    lens.position.set(1.4, 1.0, 1.2);
    lens.layers.set(1);
    view.scene.add(lens);
    view.scene.userData.refractive = true;
  }
  view.frame({ center: new THREE.Vector3(0, 1, 0), radius: 1.5 });
  view.onUpdate((dt) => { thing.rotation.y += dt * 0.5; });
}
