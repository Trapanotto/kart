# Honigfabrik scenery kit (track 3)

Built with the shared prop toolkit (`tools/blender/props/kit.py`), builders in `tools/blender/props/props_honey.py`
(registered in `build.py`'s `MODULES`). Same conventions as `docs/ASSETS-props.md`: metres, origin on the ground at
the footprint centre, front = +Z (glTF), vertex colours with baked AO, Draco, one material per prop unless noted.
No textures, no third-party assets. Total: 30 files, **0.36 MB**.

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P tools/blender/props/build.py -- honey_crate honey_tank ...
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P tools/blender/props/render.py -- honey_crate ...
```

| Prop | Size (m) | Tris | LOD1 tris | Nodes / notes |
|---|---|---|---|---|
| `honey_jar_giant` | 4.7 x 6.6 x 4.8 | 934 | 258 | yard decoration, gloss material |
| `honey_jar` | 0.4 x 0.5 x 0.4 | 258 | - | stacked on crates |
| `honey_barrel` | 1.0 x 1.2 x 1.0 | 890 | 56 | standing; the rolling barrel view lies it on its side (axis X, centre 0.6 m up) |
| `honey_crate` | 1.2 x 1.1 x 1.2 | 1164 | 52 | bee logo on all sides |
| `honey_tank` | 29.7 x 20.8 x 26.5 | 3032 | 336 | radius 10.5 m body; glowing gauge strip on the front (+Z; placed rotated 180 deg to face the courtyard); materials base + emit |
| `honey_press` | 11.5 x 10.5 x 4.5 | 580 | 480 | column at +X, arm over an 8.4 m strip; child `head` (origin = bottom centre, rest y = 4.4, animate y 0.05..4.4), child `lamp` (emissive warning light); materials base + emit |
| `honey_cannon` | 5.7 x 15.1 x 14.9 | 1224 | - | intake funnel at the ground facing -Z, barrel rising to +Z; base + emit (arrow lights) |
| `honey_cannon_lid` | 5.3 x 5.3 x 0.3 | 388 | - | closed hatch; place 3.35 m behind the cannon origin; tagged `cannonLid`, hidden in lap 3 |
| `honey_pipe` | 6.2 x 1.5 x 1.2 | 136 | - | straight pipe along X on two stands |
| `honey_vat` | 6.9 x 3.0 x 6.1 | 432 | 288 | open honey vat with paddle |
| `honey_hive` | 0.9 x 1.6 x 1.1 | 216 | - | bee box with red roof |
| `honey_hive_tower` | 6.9 x 18.0 x 8.0 | 1046 | 422 | stacked hexagonal hive tower, emissive beacon |
| `honey_sunflower` | 0.9 x 2.6 x 0.5 | 285 | - | head faces +Z, instanced scatter |
| `honey_lavender` | 0.6 x 0.9 x 0.6 | 447 | - | instanced scatter |
| `honey_bee` | 1.1 x 1.7 x 0.9 | 1306 | 482 | worker bee with hard hat; child `wings` (lod0 only) |
| `honey_lamp` | 1.2 x 3.7 x 1.2 | 252 | - | hanging hall lamp, origin = cable top; base + emit |
| `honey_lamp_post` | 1.4 x 5.0 x 0.6 | 208 | - | yard lamp; base + emit |
| `honey_wall` | 8.1 x 12.3 x 1.1 | 344 | 144 | hall wall section (brick plinth, open steel window frame, honeycomb frieze); tile every 8 m |
| `honey_truss` | 46.2 x 4.2 x 0.3 | 600 | 312 | roof truss along X, scale X to the bay width |
| `honey_column` | 1.1 x 13.0 x 1.1 | 80 | - | hall column with hazard guard; also used as door jambs |

The theme (`src/track/view/themes/honey.ts`) adds the `.lod1` names to `LOD_PROPS`, so medium / mobile tiers and far
scatter use them.

## Procedural set pieces (no GLB)

`src/track/view/themes/honey/setpieces.ts` + `materials.ts` (TSL): factory road (asphalt / sealed concrete tiles in the
hall / steel diamond plate above y = 5.5 / grating on the gantry / cobbles on the crate cut, yellow lines, yellow-black
kerbs), terrain (golden meadow, paved slabs, hall floor, striped sunflower / lavender fields), conveyor belts with
running chevrons, glossy flowing honey for the flood stages (rises / sinks on the lap events), the copper pipe
tunnel with lamp strips, the packing house under the roof road (brick facade with windows, cornice, green roof strip),
the hall roofs with skylights (no shadows, so the hall stays bright), lintels and glowing door signs.

## Environment

No HDRI: `hdr: null`, so the scene is lit by the golden-hour procedural sky (`skyTop #86acd9`, `skyHorizon #ffd391`,
low warm sun `#ffc27a` from the south-west, warm fog, pollen particles).
