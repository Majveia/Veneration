// Baseline camera controller: a free-flying drone that follows the curvature of
// whatever body is nearest and never goes underground. Speed scales with
// altitude so the same controls work from 2 m above the grass to deep space.
//   WASD / left stick  move      mouse / right stick  look
//   Space / C          up / down Shift  fast
import * as THREE from 'three';

export default async function create(world) {
  const { input } = world.ctx;
  const cam = world.cam;
  const up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(), right = new THREE.Vector3(), look = new THREE.Vector3(), camUp = new THREE.Vector3();
  const m = new THREE.Matrix4(), g = {}, v = new THREE.Vector3();
  let pitch = 0, init = false;

  function fromQuat() {
    world.groundInfo(cam.pos, g);
    if (g.body) up.copy(g.up);
    look.set(0, 0, -1).applyQuaternion(cam.quat);
    pitch = Math.asin(THREE.MathUtils.clamp(look.dot(up), -1, 1));
    fwd.copy(look).addScaledVector(up, -look.dot(up));
    if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
    fwd.normalize();
    init = true;
  }
  world.events.on('teleport', fromQuat);
  world.events.on('frameChange', (c) => { c.convertDir(fwd); c.convertDir(up); });

  return {
    name: 'controller',
    update(dt) {
      if (!init) fromQuat();
      world.groundInfo(cam.pos, g);
      const near = g.body && g.altitude < g.body.radius * 3;
      if (near) up.lerp(g.up, 1).normalize();
      // keep heading tangent to the (possibly new) up
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      fwd.applyAxisAngle(up, -input.look.x);
      pitch = THREE.MathUtils.clamp(pitch - input.look.y, -1.55, 1.55);
      right.crossVectors(fwd, up).normalize();
      look.copy(fwd).multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch));
      camUp.crossVectors(right, look);
      cam.quat.setFromRotationMatrix(m.makeBasis(right, camUp, v.copy(look).negate()));
      const alt = g.body ? Math.max(g.altitude, 0) : 1e7;
      let speed = THREE.MathUtils.clamp(alt * 0.9, 6, 4e7);
      if (input.down('sprint')) speed *= 5;
      const vert = (input.down('jump') ? 1 : 0) - (input.down('crouch') ? 1 : 0);
      cam.pos.addScaledVector(look, input.move.y * speed * dt).addScaledVector(right, input.move.x * speed * dt).addScaledVector(up, vert * speed * dt);
      // stay above ground / sea
      world.groundInfo(cam.pos, g);
      if (g.body) {
        const floor = Math.max(world.groundRadius(g.body, cam.pos), g.body.surface && g.body.surface.hasOcean ? g.body.radius : 0) + 1.7;
        if (g.dist < floor) cam.pos.sub(g.body.pos).setLength(floor).add(g.body.pos);
      }
    },
  };
}
