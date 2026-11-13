# Third-party assets and licences

Every third-party file shipped with Trapanotto Kart 2 is listed here with its source and licence.
Only CC0 (public domain) assets are used.

## Environment art (envart team)

### Models

All scenery models in `public/assets/models/prop.*.glb` (and their `.lod1` variants) are original work of the
project, generated procedurally by the scripts in `tools/blender/props/`. No third-party meshes are used.

### Sky / lighting (`public/assets/env/`)

| File | Asset | Author | Source | Licence |
|---|---|---|---|---|
| `meadow_day.hdr` (2k), `meadow_day_1k.hdr` (1k) | Meadow 2 | Sergej Majboroda | https://polyhaven.com/a/meadow_2 | CC0 1.0 |

### Surface textures (`public/assets/textures/`)

Downloaded at 2k and processed by `tools/blender/props/textures.py` (resized to 1024 px, stylised colour,
softened normals, packed ORM). The processed files are derivatives of the CC0 originals below.

| Set | Asset | Author | Source | Licence |
|---|---|---|---|---|
| `grass` | Grass 004 | ambientCG (no individual author given) | https://ambientcg.com/view?id=Grass004 | CC0 1.0 |
| `hay` | Thatched Roof 001 A | ambientCG (no individual author given) | https://ambientcg.com/view?id=ThatchedRoof001A | CC0 1.0 |
| `dirt` | Dirt | Charlotte Baglioni | https://polyhaven.com/a/dirt | CC0 1.0 |
| `asphalt` | Asphalt 04 | Sergej Majboroda (photo), Jenelle van Heerden (processing) | https://polyhaven.com/a/asphalt_04 | CC0 1.0 |
| `wood` | Rough Wood | Rob Tuytel | https://polyhaven.com/a/rough_wood | CC0 1.0 |
| `rock` | Rock Boulder Dry | Dimitrios Savva (photo), Rico Cilliers (processing) | https://polyhaven.com/a/rock_boulder_dry | CC0 1.0 |
| `bark` | Bark Brown 02 | Rob Tuytel | https://polyhaven.com/a/bark_brown_02 | CC0 1.0 |
| `planks` | Wood Planks | Amal Kumar | https://polyhaven.com/a/wood_planks | CC0 1.0 |

Poly Haven licence: https://polyhaven.com/license (CC0). ambientCG licence: https://docs.ambientcg.com/license/ (CC0).

## Interface and audio (ui team)

### Font (`public/assets/fonts/`)

| File | Asset | Author | Source | Licence |
|---|---|---|---|---|
| `fredoka-latin-wght.woff2` (variable, weights 300–700, Latin subset) | Fredoka | The Fredoka Project Authors | https://github.com/hafontia/Fredoka-One, packaged by Fontsource: https://fontsource.org/fonts/fredoka | SIL Open Font License 1.1 (full text: `public/assets/fonts/OFL-Fredoka.txt`) |

The font is the one non-CC0 file; the lead asked for a rounded display font under an open licence. It is bundled
locally, nothing is fetched at runtime.

### Audio

All music, sound effects, engine sounds and animal voices are synthesised in code (`src/audio/`); there are no
audio files and no third-party samples. Icons, logo, track emblems and item icons are original inline SVG.
