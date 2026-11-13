# Trapanotto Kart 2 – Architecture and team rules

Read this, `KONZEPT.md` (German, the game concept) and `src/core/types.ts` (the contract) before writing code.

## Stack

- Vite + TypeScript (strict), three.js r187 with `WebGPURenderer` (automatic WebGL2 fallback), Rapier (`@dimforge/rapier3d-compat`), Vitest.
- Targets: desktop with a GPU and current phones. Three quality tiers (`src/core/quality.ts`).
- Blender 5.2 headless for models: `"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P script.py -- args`.

## Layout and ownership

Seven teams work in parallel in the same folder. Only edit files you own.

| Team | Owns |
|---|---|
| lead | `src/core/`, `src/game/`, `src/stubs/`, `src/main.ts`, `index.html`, config files, `docs/ARCHITECTURE.md` |
| physics | `src/physics/`, `src/input/`, `src/camera/`, `sandbox/physics.*`, `tests/physics*.test.ts` |
| track | `src/track/`, `tools/track/`, `sandbox/track.*`, `tests/track*.test.ts` |
| render | `src/render/`, `src/core/quality.ts`, `sandbox/render.*` |
| actors | `src/actors/`, `tools/blender/actors/`, `public/assets/models/char.*`, `kart.*`, `item.*`, `public/assets/portraits/`, `sandbox/actors.*`, `docs/ASSETS-actors.md` |
| gameplay | `src/race/`, `src/items/`, `src/ai/`, `sandbox/gameplay.*`, `tests/gameplay*.test.ts` |
| ui | `src/ui/`, `src/audio/`, `public/assets/audio/`, `public/assets/fonts/`, `sandbox/ui.*` |
| envart | `tools/blender/props/`, `public/assets/models/prop.*`, `public/assets/textures/`, `public/assets/env/`, `docs/ASSETS-props.md`, `LICENSES.md` |

`src/game/modules.ts` is the one shared file: when your module works, replace the stub on your own lines
(marked `[physics]`, `[track]`, ...) with your factory, using the Edit tool on exactly those lines. Add your import. Touch nothing else in it.

The grey box (`src/stubs/`) is a complete, running game made of placeholders: flat test track, kinematic karts,
box views, basic renderer. Use the stubs for everything outside your area; they are also what the headless tests use.

## Rules

1. **The contract is `src/core/types.ts`.** Do not change existing members. If you truly need something new, add an
   *optional* member, keep everything compiling, and list it in your final report.
2. **Sim is headless and deterministic.** Code under `src/physics`, `src/race`, `src/items`, `src/ai` and the runtime part
   of `src/track` must not touch the DOM or the renderer, imports math from `'three'` only, and uses `sim.rng` / `sim.time`
   instead of `Math.random()` / `Date.now()`. It must run in Node (Vitest). Avoid per-step allocations in hot paths.
3. **Render side uses WebGPU-compatible three.js only.** Import from `'three/webgpu'` (and `'three/tsl'` for shaders).
   No `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` or `EffectComposer`: custom shading is TSL node materials,
   post-processing is the TSL pipeline. Standard materials (`MeshStandardMaterial`, `MeshPhysicalMaterial`) are fine.
   Everything must also work on the WebGL2 fallback (`?webgl` forces it once the render team wires that).
4. **Views read, the sim writes.** Views use `kart.renderPos` / `kart.renderQuat` (already interpolated) and never mutate sim state.
   Cross-module reactions go through `sim.events` (see `GameEvents`). One-shot effects: emit `'fx'`.
5. **Units and axes** are fixed in the header of `types.ts`: metres, Y up, kart forward = +Z, +X = left, signed sideways values positive = right.
   Reference feel numbers are in `KART` (`src/core/data.ts`): top speed 29 m/s in class "normal", kart 2.0 × 1.3 m.
6. **Mobile matters.** Respect `ctx.quality` (density, shadows, texture size, fur). Budget for a race on tier `mobile`:
   under 150 draw calls, under 300k triangles, 60 sim steps/s for 8 karts in under 2 ms each.
7. **UI text is German with Swiss spelling** (`ss` instead of `ß`). Code, comments and docs are English.
8. **Third-party assets must be CC0** and listed in `LICENSES.md` (name, source URL, licence). Nothing else may be downloaded.
9. **No git commits, no pushes, no branch changes.** The lead commits. Do not delete or rewrite other teams' files.
10. **Dependencies:** everything needed should already be installed. Only if indispensable, run `npm install <pkg>` once and report it.

## Running and verifying

- A dev server is already running at **http://localhost:5173** (Vite, hot reload). Do not start another one and do not stop it.
- Your isolated playground: `sandbox/<team>.html` + `sandbox/<team>.ts`, served at `http://localhost:5173/sandbox/<team>.html`.
  Build your sandbox so it works with stubs for the other areas.
- The whole game: `http://localhost:5173/?race=test` (optional `&char=otter&class=normal&laps=1&seed=1`).
  `window.__kart` is the app (`src/game/app.ts`): `__kart.sim`, `__kart.advance(seconds)` steps the loop manually,
  `__kart.inputOverride = { throttle: 1, steer: -0.3 }` drives the player.
- Browser checks: open **your own tab** (`tabs_create`), pass its `tabId` to every browser call, never use another team's tab.
  A background tab may not fire `requestAnimationFrame`; drive it with `advance()` (expose the same helper in your sandbox).
  Look at screenshots of your work and judge them critically; iterate until it looks and feels good, not merely until it runs.
- `npm run typecheck` checks the whole project; other teams' files may be mid-edit, fix only errors in your own files.
- `npx vitest run tests/<yours>` for headless tests. `tests/greybox.test.ts` shows how to build a headless race.

## Asset names

`assets.model(name)` loads `public/assets/models/<name>.glb`; a missing file yields a visible placeholder, so code can
be written before the art exists. Real-world scale in metres, origin on the ground at the centre, front = +Z, Y up.

- `char.<id>` for `sloth sheep redpanda hedgehog penguin capybara otter axolotl`: rigged driver in sitting pose.
- `kart.<id>`: kart per character; child nodes `wheel_fl wheel_fr wheel_rl wheel_rr` (origin at wheel centre), `steering`, `seat`.
- `item.<id>` for `itembox acorn honey giftbox yarn bee bubble carrot goldcarrot lolly cloud`.
- `prop.<name>` (track 1, Kleeblatt-Tal): `tree_oak tree_birch tree_apple bush hedge flower_patch grass_tuft rock_a rock_b
  fence_wood hay_bale hay_stack crate barn windmill farmhouse silo tractor sheep scarecrow well sign_arrow start_gate
  grandstand balloon_arch bridge_wood boost_pad ramp`. Moving parts are child nodes: `barn` has `door_l door_r`, `windmill` has `blades`.
- Textures: `public/assets/textures/<set>/{color,normal,orm}.webp` (ORM = occlusion, roughness, metalness in R, G, B).
  Sets for track 1: `grass dirt asphalt wood hay rock bark planks`.
- Environment: `public/assets/env/<name>.hdr` (`meadow_day`).

Item ids (gameplay and art must match): `acorn acorn3 honey giftbox yarn bees bubble carrot carrot3 goldcarrot lolly cloud yawn`.

## Final report (every team)

End with: what exists and where, how you verified it (tests, what you saw in the browser), known gaps and rough edges,
contract additions, and anything another team must know to integrate with you.
