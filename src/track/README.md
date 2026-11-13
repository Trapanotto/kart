# Track pipeline (team track)

```
src/track/
  format.ts          TrackDef: the hand-written, declarative track format
  path.ts            Catmull-Rom spline -> 1 m road samples with frames (width, bank, edges, surface)
  terrain.ts         heightfield: hills, rim, noise, brooks, ponds, conformed to every road
  builder.ts         TrackDef -> BuiltTrack (implements TrackRuntime): locate, sample, racing line,
                     colliders, grid, item boxes, zones, branches, barriers, scenery, lap events
  hazards.ts         sim entities: sheep herd ('hazard.sheep'), rolling hay ('hazard.hay')
  index.ts           trackList(), loadTrack(id)   (headless; 'test' = grey-box oval)
  tracks/            one file per track + index.ts (TRACK_DEFS, cup order)
  view/              render side ('three/webgpu'): trackView.ts (createTrackView), meshes, materials, props, hazard views
tools/track/validate.ts   validator used by tests/track*.test.ts
sandbox/track.html        fly/orbit, top map, overlays, lap selector, stub drive-through
```

Runtime (everything except `view/`) is headless and deterministic: math from `'three'`, no DOM,
no `Math.random()`. A fresh `BuiltTrack` is built per `loadTrack()` (about 0.7 s for Kleeblatt-Tal).

## How to author a new track

1. **Copy** `tracks/kleeblattTal.ts` to `tracks/<name>.ts`, change `id`, `name`, `cup`, `order`,
   `environment`, and add it to `TRACK_DEFS` in `tracks/index.ts`. It appears in `trackList()` and at
   `http://localhost:5173/sandbox/track.html?track=<id>` and `/?race=<id>`.
2. **Sketch the loop** with `main: ControlPoint[]`. The first point is the start line (progress 0, the
   grid stands behind it). Points are world positions `[x, y, z]` (y = road height). Kleeblatt uses a
   helper `P(e, n, y, opts)` with map coordinates (e = east = -x, n = north = z) so that a right
   turn on paper is a right turn in the game. Put a point every 15 to 40 m, closer in tight corners.
   Per point (all optional):
   - `w` half width, `bank` degrees (positive = right edge lower, use it in right-handers), both
     interpolated smoothly between the points that set them (set `bank: 0` where banking must end);
   - `surface`, `look` (`asphalt | dirt | planks | gravel`), `left` / `right` edge and `shoulder`
     are *sticky*: they apply from that point until another point changes them;
   - `name` makes an **anchor**: every other `Progress` can then be written `'anchor'`,
     `'anchor+12'`, `'anchor-8'` or `'40%'`, so features follow when you move points.
3. **Edges** (`left` / `right`): `'open'` (no barrier at the road; a boundary fence at `reach` m),
   `'fence' | 'rail' | 'wall' | 'hedge'` with `offset`, optional `height` (e.g. tall retaining walls) and
   `catchHeight` (invisible extra collider where karts fly off jumps), or `'none'` (inside of loops;
   the loop itself encloses the infield). Barriers are clipped automatically where they would cross
   another road, and outlines are closed when the kind changes. Avoid pockets: a barrier that starts
   in the middle of an open runoff traps karts behind it.
4. **Branches** (`branches`): `from` / `to` on the main path plus interior `points`. The builder adds
   the junction points, makes the branch follow the main road's plane where they overlap (it then
   sits 2 cm below it) and eases into your heights over about 30 m. Progress on a branch maps
   linearly onto the main path for ranking. `gain` is computed (with a boost if `needsBoost`).
   Give `tag` + `enabled: false` for routes that open by lap event.
5. **Features**, all placed by progress + lateral offset: `boostPads`, `ramps` (profile of the kit
   `prop.ramp`; adds a trick zone), `itemRows`, `zones`, `patches` (surface overlays on the road),
   `decks` (bridges: no terrain under them, rails, curtains under the sides; `model: 'bridge_wood'`
   draws the kit bridge), `structures` (drive-through barn on a branch, door colliders tagged),
   `respawn` rules (e.g. never respawn on a ramp), `hazards`, `lapEvents`.
6. **Terrain**: `base`, `hills` (compact bumps, `sx`/`sz` to stretch into ridges), `rim` (valley
   walls), `noise`, `brooks` (centre line with water level per point; keep the banks above the
   level), `ponds`, `patches` (`look: 'field' | 'gravel' | ...`, rectangles or circles). The road is
   always carved / embanked into it, so design the hills roughly where the road climbs.
7. **Scenery**: explicit `props` (logical names from `docs/ARCHITECTURE.md`, by world position or
   progress / lat, `rot`, `scale`, `flip` for left-turn chevrons, `solid` for a collider, `tag` for lap
   events) and `scatter` rules (density per 1000 m^2 with distance-from-road bands; `solid` rules
   become trunk colliders and are always shown, far ones are thinned by `quality.density` and use
   `.lod1`).
8. **Lap events**: `{ lap, name, enable: [tags], disable: [tags], at }`. Tags exist on colliders
   (structure doors), zones, branches, props and hazards. `setLap()` is idempotent; `step()` also
   follows the leader's lap if the race rules never call it. `createEntities()` resets the state.
9. **Validate** - add `tests/track.<id>.test.ts` (copy `tests/track.kleeblatt.test.ts`) and run
   `npx vitest run tests/track`. The validator checks: closed / continuous paths, no kinks or steep
   slopes, corner radius (main >= 15 m), widths, no self-overlap on the same level, `locate(sample())`
   round trip on every path, ground under every road / shoulder point (ray cast against the
   colliders), kill plane, grid on the road, item boxes above it, no wall collider inside a road,
   racing line inside the road. `tests/track.realphysics.test.ts` races the real physics + AI and
   prints where karts respawn.
10. **Look at it** in the sandbox: `Top`, `Driver eye` + slider, `Lap 1/2/3`, overlays (racing line
    coloured by target speed, zones, colliders by surface, branches, grid, barriers) and the map
    (click to enlarge). `window.__track.eye(progress, lat, path)`, `.orbit(...)`, `.advance(s)`.

Physics reference for design (physics team): grip radius at top speed 17 to 20 m, full-throttle
corners R >= 25 m, drift arcs 11 to 29 m, gravity 20 m/s^2 (a 1.6 m ramp at 35 m/s flies ~40 m).

## Notes for other teams

- `BuiltTrack` (class) implements `TrackRuntime`; extra public data for tools: `paths`, `terrain`,
  `barriers`, `pads`, `ramps`, `decks`, `props`, `structures`, `hazards`, `state`, `rlLat/rlSpeed`,
  `groundAt(x, z, y?)`, `frameOn`, `localS`, `mainProgress`.
- `racingLine()` returns a reused object (read it right away).
- `TrackLocation.hint` encodes path and row; `locate` keeps the current path until a kart is about
  1.7 m beyond its edge (hysteresis at junctions).
- Colliders: `road`, `road.<surface>` (branches with other surfaces), `shoulder` (offroad),
  `terrain`, `terrain.water`, `pads` (boost, 2 cm above the road), `patch.<surface>`, `ramps`,
  `walls` (barriers + bridge curtains, closed 0.3 m slabs), `walls.props`, `walls.barn`,
  `door.barnDoors` (toggled by the lap-3 event). Branch roads sit 2 cm under the main road where they
  overlap: take the highest ground hit.
- Boost pads are a `boost` surface; duration is in `BuiltTrack.pads[i].duration` (1.2 s).
