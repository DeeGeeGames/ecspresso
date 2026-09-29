# ECSpresso brand note

**Concept:** Outlined side-view cup + **ECS** letters in steam clouds + `preso` wordmark → reads **ECSpresso**.

**Audience:** TypeScript / indie game-dev.

**Source of truth:** the master image supplied by David (1280×720 PNG). Every asset in this directory is
derived from those pixels (layer separation, crop, mask, recolor, LANCZOS upscale) — nothing redrawn
by AI image tools. SVGs are traced (vtracer) from the derived masks.

## Marks
| Mark | Contents | Canvas |
|---|---|---|
| **master** | full lockup: cup + ECS steam clouds + `preso` | wide, 2048×1477 |
| **variant** | cup + ECS steam clouds, **no** `preso` | square, 1024×1024 |
| **icon** | cup only (no clouds, no letters, no `preso`) | square, 1024×1024 |

Padding: ~8% of the content's longer side on every side (content centred on square canvases).

## Palettes
**Light** (original colours, measured from the master)
- Background cream `#FFF6EA`
- Ink / espresso brown `#3C2516` — cup outline, coffee surface, letters, `preso`
- Steam tan `#F3DCC1` — cloud fills

**Dark**
- Background deep espresso `#1E1410`
- Ink → cream `#F5E6D3` — cup outline, letters, `preso`
- Steam clouds → mid-brown `#6B4A33` (letters inside stay cream)
- Coffee surface → caramel `#C8956A` (kept distinct from the outline)

Transparent variants drop the background only; the cup interior is background and so becomes
transparent; cloud fills stay opaque.

## Notes
- In the master art the S cloud dips into a gap in the cup rim. In **master** and **variant** that is
  kept as drawn. In the **icon** the rim gap is closed with a stroke fitted (cubic fit of the rim's
  top & bottom edges on both sides, <0.35 px residual) and cross-faded into the original rim.
- SVGs: layered `<path>`s (tan, ink, coffee); `-transparent.svg` just omits the background `<rect>`.

## Files
- `ecspresso-{master,variant,icon}-light.png` / `-light-transparent.png`
- `ecspresso-{master,variant,icon}-dark.png` / `-dark-transparent.png`
- `ecspresso-{master,variant,icon}-light.svg` / `-light-transparent.svg`
- `ecspresso-{master,variant,icon}-dark.svg` / `-dark-transparent.svg`
- `contact-sheet.png` — all 12 PNGs; transparent ones on a checkerboard
