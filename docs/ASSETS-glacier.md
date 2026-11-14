# Gletscher-Gipfel scenery kit (track 4)

Same conventions as `docs/ASSETS-props.md`: glTF binary with Draco, metres, Y up, origin on the ground at
the footprint centre, front = +Z, vertex colours with baked AO, one material per prop unless noted.
Built by `tools/blender/props/props_glacier.py` (registered in `build.py`):

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P tools/blender/props/build.py -- glacier_pine glacier_rock ...
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P tools/blender/props/render.py -- glacier_pine ...
```

The module adds three material presets at runtime (`kit.MAT_PRESETS`, kit.py is untouched):
`ice` (glossy, faint cyan emission), `snow`, `lamp` (warm emission for windows). Every material called
`M_glacier_*_ice` is replaced in the game by the TSL ice material of the theme (vertex colour + inner glow +
fresnel rim), so the exported ice values are only a fallback.

Total of all glacier GLBs (20 props + 6 LOD files): **336 KB**.

| Prop | Size (m, W x H x D) | Tris (LOD1) | Notes |
|---|---|---|---|
| `glacier_pine` | 6.4 x 9.0 x 6.3 | 363 (119) | snow-laden spruce, one double-sided foliage material; scatter by the hundred |
| `glacier_rock`, `glacier_rock_b` | 3.5 x 1.7 x 3.0 / 2.0 x 0.9 x 1.6 | 300 (80) | snow caps on up-facing faces |
| `glacier_crystal` | 2.2 x 3.0 x 1.8 | 174 | ice crystal cluster on a snow drift (2 materials: snow + ice) |
| `glacier_serac` | 5.5 x 9.6 x 4.6 | 704 | leaning, tapering ice tower with a snow cap |
| `glacier_icicles` | 3.2 x 1.7 x 1.4 | 89 | **origin at the top** (ceiling attach point), hangs down |
| `glacier_icicle` | 0.8 x 2.3 x 0.8 | 27 | the falling hazard; **origin at its top** |
| `glacier_seal` | 1.4 x 7.3 x 10.6 | 704 | tunnel wall slab closing the lap-2 crack, 10.4 m long along Z, reaches 1.5 m below 0 |
| `glacier_iceblock` | 1.9 x 6.5 x 9.6 | 44 | ice block, long along Z, base 1.4 m below 0 |
| `glacier_snowpile` | 24 x 5 x 13 | 1958 | avalanche deposit (lap 3), with snow chunks and broken pine tops |
| `glacier_snowbridge` | 24.6 x 8.1 x 23 | 644 | deck model for the crevasse: origin = deck top centre, child `deck` (hidden), sagging snow arch with icicles, marker poles at x = +-11.8 |
| `glacier_hut` | 8.3 x 7.5 x 8.1 | 1632 (688) | log hut, snowy roof, warm windows (`M_glacier_hut_lamp`, emissive) |
| `glacier_fishhut` | 4.0 x 3.2 x 3.1 | 452 | ice-fishing shack with hole, stool and rod (+ lamp material) |
| `glacier_snowman` | 2.8 x 3.3 x 1.6 | 714 | carrot nose, scarf, hat, stick arms |
| `glacier_flag_r`, `glacier_flag_b` | 1.2 x 2.1 x 0.4 | 92 | slalom poles, flag points to +X |
| `glacier_snowfence` | 4.1 x 1.9 x 0.9 | 168 | tiles every 4 m along X like `fence_wood`; child `end_post` at x = +2 |
| `glacier_station` | 15.7 x 10.8 x 16.5 | 796 (692) | cable-car summit station, front -> road; cable hall at the back (local -Z 6.9 m, cable height 7.1 m, bullwheel); 3 materials (base, glass, lamp) |
| `glacier_pylon` | 5.6 x 18.4 x 3.4 | 496 (160) | lattice pylon, sheaves at x = +-2.4, y = 17.4 |
| `glacier_gondola` | 2.0 x 4.4 x 2.4 | 252 | **origin = grip on the cable**, cabin hangs 4.4 m below; 2 materials (body, glass) |

## Theme (`src/track/view/themes/glacier.ts` + `themes/glacier/`)

- `materials.ts`: snow terrain (cool albedo well below white, large tint variation, wind ripples, blue
  hollows, packed snow near the roads, glacier ice on slopes > ~0.2, snowy rock on steep cuts and the peak,
  frozen lake with Worley cracks and drifted snow, view-dependent sparkle on desktop), glacier road
  (look `asphalt` = matt packed snow with groomer grooves and wheel tracks, look `gravel` = glossy blue
  ice with clear-coat, cracks and blue edge lines, look `dirt` = deep snow), glowing tunnel ice, prop ice,
  cloud sea, distant peaks (hazed by distance), cracked thin ice patches, icicle warning marker.
- `backdrop.ts`: the terrain falls from the grid border below the cloud sea (y = -26); 22 (mobile 14)
  ridged peaks 1 to 2.2 km away stand out of it. Replaces the default rising backdrop and forest.
- `tunnel.ts`: the ice arch swept along the main road between `caveIn` and `caveOut` (inner glowing
  surface, outer snow shell, portal rims), open on the right where the lap-2 crack breaks through
  (the `glacier_seal` props close it until then); icicle clusters under the ceiling.
- `fences.ts`: boundary fences as slatted ribbons (alpha test, 2 triangles per barrier point); near `fence`
  runs use the `glacier_snowfence` model on desktop; on mobile every wooden barrier is a ribbon.
- `events.ts`: icicle hazard view (`hazard.icicle`: growing pulsing marker, shaking icicle, fall, shatter),
  the avalanche (cornice on the slope in laps 1-2, trembling during the rumble, sliding snow mass with
  powder puffs, then the `glacier_snowpile` prop), the cable car (cables and four cabins).

Sky: `public/assets/env/glacier_day.hdr` (2k) / `glacier_day_1k.hdr` (1k), Poly Haven "Horn-koppe Snow"
(CC0). Its sun measured from the file: `sunDir` [0.712, 0.474, 0.518] (28 degrees up). The visible sky stays
procedural (renderer); the HDRI only lights and reflects, and its snowy horizon keeps the glossy ice from
reflecting green meadows.
