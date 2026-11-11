// World systems, loaded in this order by modes/world/index.js. Each entry is a
// file in this folder whose default export is `async function create(world)`
// returning { update?(dt), lateUpdate?(dt), resize?(w,h), isReady?(), dispose?() }.
// update() runs before the camera is synced (write world.cam here); lateUpdate()
// runs after (world.camera matrices, world.sunDir are final for the frame).
// A system that throws while loading is skipped, so one broken system never
// takes the world down.
export const SYSTEM_LIST = [
  'controller',   // camera / player input -> world.cam   (baseline: free-fly drone)
  'terrain',      // quadtree planet surfaces
  'space',        // star, sky backdrop
];
