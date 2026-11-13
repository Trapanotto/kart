# Kleeblatt-Tal scenery kit (envart)

Target look: `docs/kleeblatt-moodboard.webp` (road view) and `docs/kleeblatt-moodboard-overview.webp`.
Every prop at a glance: `docs/props-sheet-1.webp`, `docs/props-sheet-2.webp`; single previews in
`tools/blender/props/previews/<name>.webp`.

## Conventions (all props)

- glTF binary, Draco-compressed (`/draco/` decoder must be set on the GLTFLoader), Y up, metres.
- Origin on the ground at the centre of the footprint, **front = +Z**. Exceptions: `bridge_wood` (origin = centre of the deck top, see below).
- Colour comes from **vertex colours** (`COLOR_0`, baked AO already multiplied in), no textures inside the GLBs.
  Materials have `baseColorFactor` 1, roughness about 0.78, metalness 0.
- One material per prop, except `start_gate` (+ `M_start_gate_banner`) and `boost_pad` (+ emissive `M_boost_pad_emit`).
  Trees put trunk, canopy and leaf cards on one double-sided material (`M_<name>_foliage`) so an instanced tree is one draw call.
- `TEXCOORD_0` is a box projection in world metres, **1 UV unit = 2 m**, so the tiling sets in `public/assets/textures/`
  (e.g. `planks`, `wood`, `bark`, `hay` normal maps) can be layered on as detail maps without stretching.
- Normals: hard-surface props use weighted (face-area) normals with sharp edges above 50 deg; foliage uses custom normals
  bent towards the canopy centre for soft, fluffy lighting. Leaf cards are folded 2-triangle quads.
- LODs: separate files `prop.<name>.lod1.glb` with the same node names (load with `assets.model('prop.tree_oak.lod1')`).
- Previews and the moodboard were rendered with **Khronos PBR Neutral** tone mapping (three.js `NeutralToneMapping`),
  which keeps the palette as authored. ACES makes the kit darker and more orange; AgX makes it paler.

Total size of all 36 prop files (28 props + 8 LOD files): **1.3 MB**. Textures: 1.7 MB. HDRIs: 6.3 MB (2k) + 1.5 MB (1k).

## Props

Size = width (X) x height (Y) x depth (Z) in metres, from the exported bounds (leaf cards and straw included).

| Prop | Size (m) | Tris | File | Child nodes | LOD1 (tris / file) | Mats |
|---|---|---|---|---|---|---|
| `tree_oak` | 6.5 x 8.1 x 5.9 | 2271 | 75 KB | - | 674 / 23 KB | 1 |
| `tree_birch` | 3.7 x 10.3 x 3.1 | 1702 | 64 KB | - | 500 / 20 KB | 1 |
| `tree_apple` | 5.3 x 6.3 x 5.0 | 2509 | 83 KB | - | 1034 / 37 KB | 1 |
| `bush` | 2.2 x 1.4 x 2.0 | 380 | 16 KB | - | - | 1 |
| `hedge` | 4.1 x 1.8 x 1.5 | 408 | 17 KB | - | - | 1 |
| `flower_patch` | 0.6 x 0.3 x 0.7 | 86 | 5 KB | - | - | 1 |
| `grass_tuft` | 0.6 x 0.5 x 0.6 | 48 | 3 KB | - | - | 1 |
| `rock_a` | 3.1 x 1.5 x 2.3 | 260 | 8 KB | - | - | 1 |
| `rock_b` | 1.6 x 0.7 x 1.3 | 260 | 9 KB | - | - | 1 |
| `fence_wood` | 4.2 x 1.3 x 0.3 | 248 | 8 KB | `end_post` | - | 1 |
| `hay_bale` | 1.4 x 1.6 x 1.6 | 1020 | 28 KB | `roll` | - | 1 |
| `hay_stack` | 3.5 x 3.8 x 3.4 | 830 | 27 KB | - | - | 1 |
| `crate` | 1.1 x 1.0 x 1.1 | 696 | 8 KB | - | - | 1 |
| `barn` | 13.8 x 14.7 x 33.1 | 7396 | 121 KB | `door_l`, `door_r` | 1076 / 19 KB | 1 |
| `windmill` | 15.2 x 18.9 x 9.6 | 2720 | 50 KB | `blades` | 1080 / 26 KB | 1 |
| `farmhouse` | 11.8 x 10.9 x 11.8 | 3436 | 54 KB | - | 812 / 17 KB | 1 |
| `silo` | 5.7 x 13.4 x 6.0 | 2746 | 53 KB | - | 254 / 7 KB | 1 |
| `tractor` | 2.5 x 3.0 x 3.6 | 2428 | 53 KB | - | - | 1 |
| `sheep` | 0.9 x 1.1 x 1.4 | 1520 | 47 KB | `head`, `legs` | - | 1 |
| `scarecrow` | 2.2 x 2.5 x 0.9 | 1012 | 26 KB | - | - | 1 |
| `well` | 2.7 x 3.1 x 2.3 | 1628 | 33 KB | - | - | 1 |
| `sign_arrow` | 2.4 x 1.9 x 0.2 | 204 | 5 KB | - | - | 1 |
| `start_gate` | 22.1 x 11.3 x 1.6 | 1356 | 26 KB | `banner` | - | 2 |
| `grandstand` | 17.7 x 8.7 x 7.4 | 6094 | 132 KB | - | 1836 / 26 KB | 1 |
| `balloon_arch` | 21.7 x 9.4 x 1.8 | 4608 | 80 KB | - | - | 1 |
| `bridge_wood` | 18.8 x 7.2 x 24.2 | 3760 | 61 KB | `deck`, `railing_l`, `railing_r`, `supports` | - | 1 |
| `boost_pad` | 4.0 x 0.1 x 6.0 | 280 | 7 KB | - | - | 2 |
| `ramp` | 11.2 x 2.7 x 6.2 | 692 | 13 KB | - | - | 1 |

## Placement notes

**Trees, bush, rocks, grass, flowers.** Random Y rotation and 0.85 to 1.2 uniform scale are safe. Roots and rock bases sink
0.1 to 0.14 m below the origin so they sit on uneven ground. `grass_tuft` and `flower_patch` are meant for instancing by the
thousand (one material each). Use LOD1 for trees beyond roughly 40 m (mobile: 25 m).

**`fence_wood`** runs along local X. One post at x = -2; the rails span -2..+2. Tile sections **every 4.0 m along X**.
The child `end_post` (x = +2) closes a run: hide it on every section except the last one of a run.
Rails are on the front (+Z) side of the posts.

**`hedge`** runs along local X, 4.0 m long, ends clipped flat: tile every 4.0 m.

**`hay_bale`** (round bale, diameter 1.53 m, 1.2 m wide, axis along X). Root is an empty; the mesh child **`roll`** has
its pivot on the axle at (0, 0.75, 0). To roll it forward along +Z, rotate `roll` about its local X
(angle = distance / 0.765 m) and move the root. Collider: cylinder r = 0.76, length 1.2, axis X, centre y = 0.75.

**`hay_stack`, `crate`** (1 m cube): destructible obstacles; collider = cylinder r 1.6 h 3.5 / box 1 m.

**`barn`** (drive-through on lap 3). Exterior 13.8 x 14.7 x 33.1 m. Interior 12.0 m wide (walls at x = +-6.0), 30 m long,
open at both gable ends, no floor mesh (lay the road through it at y = 0).
- Openings: **11.0 m wide (x = -5.5..+5.5), 5.4 m high** at both ends (front at z = +15.15, rear at z = -15.15).
- Clear drive lane inside: |x| < 4.5 m (hay bales and posts stand along the walls outside that), height clearance
  **5.25 m** (underside of the tie beams; knee braces only exist at |x| > 4.6 m).
- Doors (front only): `door_l` at **+X**, `door_r` at -X (left/right in the model's own frame, +X = left as for karts).
  Each door is 5.46 m wide, 5.3 m high. Node origins are on the **hinge axis: vertical (local Y) at x = +-5.5,
  z = +15.42**, door leaves extend towards the centre line. Closed = rotation 0.
  **Open outward: `door_l.rotation.y = +angle`, `door_r.rotation.y = -angle`** (90 deg = flat against the gable wall's
  plane, swung forward; 100 to 110 deg looks natural).
- LOD1 keeps the doors (same names) but drops interior beams, hay, battens and shingles.

**`windmill`.** Tower foot octagon about 6.7 m across, gallery at 4.5 m, cap top 12.9 m.
Child **`blades`**: pivot on the hub at (0, 11.3, 3.05); rotate about its **local Z** (the forward axis). Sail radius 7.6 m,
lowest sail tip at about 3.7 m above ground. Suggested speed 0.6 to 1.0 rad/s.

**`farmhouse`** 9 x 10 m body, gable and door face +Z. **`silo`** diameter 4.4 m, ladder and chute on the +Z side.

**`tractor`** about 3.6 m long, front +Z, wheel axles: rear (y 0.85, z -0.55), front (y 0.45, z +1.35). Static decoration (no wheel nodes).

**`sheep`** (lap 2 crossing herd). Body length about 1.1 m (1.4 m including the head), height 1.05 m, front +Z.
- `head`: pivot at the neck (0, 0.76, 0.40). Bob/graze: rotate about local X (+-0.25 rad), look around: about Y.
- `legs`: pivot at the hips (0, 0.42, 0); all four legs in one node. Toy waddle: rock `legs.rotation.x` +-0.3 rad at
  about 4 Hz while bobbing the root up 0.04 m; that reads well at race distance.
- Collider: capsule radius 0.45, length 1.1, along Z.

**`scarecrow`, `well`**: decoration, collider = post / cylinder r 1.3.

**`sign_arrow`**: chevron sign facing +Z (towards approaching karts). The chevrons point to the sign's **+X**, which is
the driver's right when a kart drives towards the sign (kart moving along the sign's -Z). For a left turn use `scale.x = -1` (three.js flips the winding for negative determinants automatically).
Board 2.4 x 0.95 m at 0.85 to 1.8 m height.

**`start_gate`**: spans an 18 m road. Pillars at x = +-10 (inner faces at +-9.45, clear width 18.9 m). Clear height under the
beam 6.2 m; the bunting sags to **4.9 m** in the middle. Child `banner` (material `M_start_gate_banner`, white) is a double
quad 18.6 x 2.05 m at y 6.75..8.8, **UV 0..1 across each face** so a banner texture can be assigned to that material.

**`grandstand`**: 16 m wide, 6 rows, faces +Z. Place its front edge 2 m or more from the track edge. About 50 seated animal fans (lod1 drops them).

**`balloon_arch`**: spans an 18 m road, bases at x = +-9.9, about 18 m clear between the balloon clusters near the ground and
7.5 m clear at the top. Lower balloons dip 0.57 m below y = 0 (meant to be buried in the verge). Material `M_balloon_arch_gloss` (roughness 0.35).

**`bridge_wood`**: origin = **centre of the deck top surface** (put it at road height). Deck 18.75 m wide including the kerb
beams (17.85 m clear between kerbs), 24 m long along Z. Railings at x = +-9.25, top rail 1.65 m. Supports reach 5.6 m below
the deck (trim them into the terrain). Nodes: `deck`, `railing_l` (+X), `railing_r` (-X), `supports`; hide `deck` if the
track mesh provides the road surface.

**`boost_pad`**: 4.0 m wide (X) x 6.0 m long (Z), 0.08 m thick; three chevrons point **+Z** (driving direction).
Chevrons use `M_boost_pad_emit` (emissive #ffb21e, KHR_materials_emissive_strength 3); pulse `emissiveIntensity` for animation.
Lay it 0.01 m above the road to avoid z-fighting.

**`ramp`**: 10 m wide (planks; side posts reach 11.2 m), 6 m long, **lip height 1.6 m**. Karts drive along +Z: foot at
z = -3 (height 0), lip at z = +3. Curved surface h(t) = 1.6 (0.55 t + 0.45 t^2), t = 0 at the foot: **8 deg at the foot,
21 deg at the lip (launch angle), 15 deg on average**. Red/white marker posts at the four corners (2.6 m at the lip, 1.6 m
at the foot) with orange flags at the lip; yellow/black hazard stripe on the lip edge.

## Surface textures

`public/assets/textures/<set>/{color,normal,orm}.webp`, 1024 x 1024, seamlessly tiling, OpenGL normal maps (+Y up),
ORM = R occlusion, G roughness, B metalness (0). Colour is stylised (simplified detail, softer contrast, saturation up, mean
colour moved onto the kit palette). Suggested world tiling: grass 4 to 6 m, dirt 4 m, asphalt 6 to 8 m, rock 3 m, bark/wood/planks 2 m, hay 2 m.

| Set | Source | color / normal / orm | Total |
|---|---|---|---|
| grass | ambientCG Grass004 | 149 / 199 / 15 KB | 363 KB |
| dirt | Poly Haven dirt | 38 / 103 / 13 KB | 155 KB |
| asphalt | Poly Haven asphalt_04 | 136 / 34 / 3 KB | 174 KB |
| wood | Poly Haven rough_wood | 116 / 33 / 16 KB | 164 KB |
| rock | Poly Haven rock_boulder_dry | 77 / 29 / 28 KB | 133 KB |
| bark | Poly Haven bark_brown_02 | 170 / 152 / 50 KB | 372 KB |
| planks | Poly Haven wood_planks | 43 / 18 / 9 KB | 70 KB |
| hay | ambientCG ThatchedRoof001A | 154 / 142 / 21 KB | 318 KB |

`planks` runs horizontally (boards along U); `bark` and `wood` grain runs along V.

## Sky and sun (`public/assets/env/`)

`meadow_day.hdr` (2048 x 1024) and `meadow_day_1k.hdr` (1024 x 512) = Poly Haven "Meadow 2": clear blue sky with a few
thin clouds over a green meadow with trees, late morning. Mapping as three.js `EquirectangularReflectionMapping`, no rotation.

Values for the track's `EnvironmentDef` (measured from the HDRI's sun disc with three.js' equirect convention,
u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5; script: `render.py --sun`):

| Field | Value |
|---|---|
| `hdr` | `'meadow_day'` (`meadow_day_1k` on tier mobile) |
| `sunDir` (normalised, TO the sun, Y up) | **[0.7194, 0.4538, 0.5259]** (elevation 27 deg, towards +X/+Z) |
| `sunColor` | **`'#fff3e3'`** (sRGB hex; linear ratio of the sun disc 1.00 : 0.90 : 0.77) |
| `sunIntensity` | **3.0** (three.js DirectionalLight, with the HDRI as environment at intensity 1.0) |
| `ambientIntensity` | 0.6 to 0.8 if the HDRI is not used for the environment |
| `skyTop` / `skyHorizon` | `'#5d97d8'` / `'#cfe0ea'` (for the procedural fallback) |
| `fogColor` / `fogDensity` | `'#cddfe6'` / about 0.0025 |
| `exposure` | 1.0 with NeutralToneMapping |

Note: the HDRI contains the real sun (peak radiance about 1.4e5). With PMREM it produces a hot specular spot that matches
`sunDir`; if it double-lights the scene together with the DirectionalLight, lower `scene.environmentIntensity` to about 0.6
rather than dimming the sun.

## Regenerating

```
B="C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
"$B" -b -P tools/blender/props/build.py -- [name ...] [--no-ao] [--no-lod]   # GLBs + out/stats.json
"$B" -b -P tools/blender/props/render.py -- name ...                         # previews (re-imports the GLBs)
"$B" -b -P tools/blender/props/moodboard.py -- out.png [--cam 2]             # beauty scene
python tools/blender/props/sheet.py docs/props-sheet-1.webp 5 name ...        # contact sheet (Pillow)
python -I tools/blender/props/textures.py <raw_download_dir>                  # texture sets (Pillow + numpy)
python tools/blender/props/glbinfo.py public/assets/models/prop.barn.glb      # node / material dump
```

Toolkit: `kit.py` (palette, rounded boxes, cylinders, lathe, sweep, prism, metaball blobs, leaf cards, AO bake to
vertex colours, box UVs, weighted normals, Draco export). Prop builders: `props_nature.py`, `props_farm.py`,
`props_buildings.py`, `props_race.py`.
