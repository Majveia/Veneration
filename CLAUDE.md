# Veneration

A playable, fully procedural simulated universe in three.js. You start inside an
emergent cosmic web (real gravity + expansion), dive into a galaxy, pick a star,
fly through its system and land on living planets you explore on foot (first /
third person) and in vehicles. No external assets: every mesh, texture, sound
and world comes from code. Reference bar for look and feel: No Man's Sky,
Starfield, Outer Wilds, Pacific Drive, Breath of the Wild; "Cosmos: Possible
Worlds x Planet Earth III". OLED-black space, rich colour, constant gentle motion,
a small, quiet, immersive UI on desktop and mobile.

## Run / test

    node tools/serve.mjs 8080            # static server, then open http://localhost:8080/
    node tools/shot.mjs out.png "mode=world&body=Aurelia&tod=0.3" --size=960x540
    node tools/shot.mjs out.png "kit=flora" --page=kit.html --size=960x540

No build step, no npm install. ES modules + import map; three.js r187 is vendored
in `vendor/three` (`three`, `three/addons/...`). `tools/shot.mjs` starts its own
server and a headless Chromium (software WebGL: slow, 1-10 fps; use small sizes
such as 960x540 while iterating, and `q=medium` when shadows/MSAA are not what
you are judging). It prints page errors and exits non-zero if there were any.
Useful flags: `--eval="js"`, `--frames=N` (advance N frames after ready),
`--wait=ms`, `--keys=w:1500`, `--verbose`. Harness state: `window.__ctx`
(`ctx.mode.world` in world mode), `window.__errors`, `window.__ready`.

## Layout

    index.html, kit.html
    src/main.js                 boot, quality presets, mode manager (ctx.go), loop
    src/core/post.js            HDR pipeline: scene -> effects chain -> bloom -> ACES/grade
    src/core/input.js           device-independent actions (keyboard, mouse, touch, gamepad)
    src/core/universe.js        deterministic galaxy / system / planet definitions (pure data)
    src/core/noise.js, rng.js   JS simplex + GLSL noise chunks; seeded RNG, hashing
    src/modes/cosmos/           cosmic web simulation (mode)
    src/modes/galaxy/           galaxy view (mode)
    src/modes/world/index.js    star-system mode: frames, bodies, lighting, system loader
    src/modes/world/planetgen.js  surface function (height + climate) per planet
    src/modes/world/sites.js    settlement sites (terrain is flattened under them)
    src/modes/world/systems/    world systems (terrain, atmosphere, ocean, player, ...)
    src/kits/                   standalone procedural asset kits + viewer (kit.html?kit=name)
    src/ui/                     HUD, menus, touch controls, audio
    tools/                      serve.mjs, shot.mjs

## Core contracts

**ctx** (`window.__ctx`): `renderer, canvas, quality {name, pixelRatio, msaa, shadows, detail}`,
`input, universe, events, post, time, frame, mode, modeName, shot, isMobile, args, ui, audio`,
`go(modeName, args)` (fade + switch).

**Mode** (`src/modes/<name>/index.js`): `export default async function create(ctx)` returning
`{ scene, camera, look?, async enter(args), exit(), update(dt, t), resize(w, h), isReady() }`.
`look` is a partial `post.settings` (exposure, bloom, bloomThreshold, vignette, grain,
saturation, contrast, tint, lift, aberration). `isReady()` must only return true when the
view is fully loaded (the screenshot harness waits for it). URL params are passed as `args`.
Flow: cosmos -> `ctx.go('galaxy', {galaxyId})` -> `ctx.go('world', {galaxyId, starId, body?})`.

**Rendering**: everything is linear HDR into a float target; tone mapping happens once in
post. Materials must not tone-map; emissive / additive values above ~1.2 bloom. The depth
buffer is reversed float depth where `EXT_clip_control` exists, logarithmic otherwise: custom
`ShaderMaterial`s must include three's `logdepthbuf_*` chunks (`#include <common>` +
`<logdepthbuf_pars_vertex>`, `<logdepthbuf_vertex>` after gl_Position, and the two fragment
chunks) so they work in both. Depth-reading fullscreen work goes through
`ctx.post.addEffect({name, order, material, update?})` using `POST_VERT` + `GLSL_POST_COMMON`
(`viewDepth`, `pixelRay`, `sceneDistance`). Camera range in world mode: near 0.1, far 2e10.

**Input**: read actions only (`input.move`, `input.look`, `input.down/pressed('jump')`,
`input.pointer`, `input.tapped`, `input.zoom`). Touch UI drives `input.virtual`.

**World mode** (see the header of `src/modes/world/index.js`): gameplay positions are
doubles in the active body-fixed frame (`world.frame`); `world.frameRoot` holds frame-space
objects, `body.group` holds body-local ones; the scene origin floats with the camera.
Helpers: `world.toLocal/toFrame`, `groundInfo`, `groundRadius`, `gravityAt`, `nearestBody`,
`placeAt`, `setTimeOfDay`, `setFrame`, events `frameChange`, `teleport`. `world.cam
{pos, quat, fov}` is written by the active controller in `update()`; `world.sunDir`,
`world.lighting {sun, hemi, sunColor, sunIntensity, external}` describe the light.
Systems are files in `systems/` registered in `systems/index.js`.

**Surface** (`body.surface`, from `planetgen.js`): `height(x,y,z,minWL?)`, `sample(x,y,z,out)`
-> `{h, temp, moist, mountain, land, site}`, `normal()`, `sites`, `radius`, `hasOcean`.
Sea level is height 0 (the body radius). It is the single source of truth for terrain:
meshes, physics and placement must all agree with it.

**Player / vehicles contract** (player system consumes, vehicles system provides):

    world.player = { pos, vel, up (Vector3, frame coords, feet position), quat, state:
                     'foot' | 'vehicle', vehicle: null | Vehicle, viewMode: 'third' | 'first',
                     object: THREE.Object3D }
    world.vehicles = [Vehicle]
    Vehicle = { kind: 'rover' | 'hoverbike' | 'ship' | ..., name, object (in frameRoot),
                pos, quat, vel (frame coords), seatOffset: Vector3 (local),
                camera: { distance, height, fov, firstPerson: Vector3 (local eye) },
                canEnter(playerPos) -> bool, enter(player), exit(player) -> exit position,
                drive(dt, input), idle(dt), speed (m/s, for HUD), hud?: {...} }

While mounted the player system calls `vehicle.drive(dt, ctx.input)` every frame, keeps the
character in the seat and drives the camera from `vehicle.camera`; otherwise the vehicles
system calls `idle(dt)`. `interact` (E) mounts the nearest `canEnter` vehicle, `exit` (Z) leaves.

## Scale and units

Metres, seconds. Rocky planets 60-140 km radius, moons 15-45 km, gas giants 500-900 km,
star 5,000-12,000 km, orbits 1.5e8-3e9 m. Surface gravity is real (`body.mu = g R^2`).
The hero system (`universe.system(0,0)`): Cinder, Aurelia (home, +moons Pale, Hoarfrost),
Moebius, Leviathan (ringed giant, moons Eywa ...), Squanch, Solace. Each planet def carries
`type`, `mood` (an art-direction reference: a director / painter / film), `palette`,
`atmosphere`, `ocean`, `terrain`, `climate`, `life`, `civ`.

## Rules for everyone working here

- Stay inside the files you own; if you must touch a shared file (core, `systems/index.js`,
  this document) keep the change minimal and backwards compatible, and say so in your report.
- Several agents work in this directory at once. Never run git commands that change state
  (commit, add, stash, checkout, reset, clean, rebase). The lead integrates and commits.
- Never leave the app broken: after every change run the harness on your area and confirm
  there are no page errors. Put screenshots and scratch files outside the repo.
- Everything procedural and deterministic from seeds (`core/rng.js`); no network, no assets,
  no new dependencies.
- Performance is a feature: target 60 fps on a mid-range laptop GPU and a usable frame rate
  on phones. Instance, batch, cull by distance, share materials, respect `ctx.quality`
  (`quality.detail` scales counts / distances), dispose what you create.
- Judge your work by looking at it. Take screenshots from several angles, times of day and
  distances, look at them critically against the reference games, and iterate until a
  harsh art director would sign off. Typical failures to hunt down: flat lighting, noisy or
  blurry surfaces, visible tiling, popping, z-fighting, hard LOD seams, programmer-art
  proportions, washed-out or oversaturated colour, empty frames.
