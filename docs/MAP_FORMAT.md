# Map file format v1

A map is one JSON file with `"format": "hill-loop-map"` and `"version": 1`. The game ships `public/maps/hill-loop.json`;
it is the reference example. Maps are data only: they contain no code, and every file is checked by `src/maps/format.js`
before anything is built. A file that fails the check is refused with a message that names the field.

Units are metres. `x` runs east, `z` runs south (so north is negative `z`), `y` is height. Colours are `"#RRGGBB"`.

| Section | What it holds |
| --- | --- |
| `meta` | `id` (lowercase letters, digits, dashes), `name`, optional `author`, `description` |
| `slab` | The ground area: `x0, x1, z0, z1`. Each side 20 to 400 m |
| `ground` | `layer` (surface thickness, m) and `chunk` (build chunk size, m) |
| `terrain` | Water level, height range, noise scales, relief strength and the biome blobs (`hills`, `rock`, `scrub`, `lake`) |
| `roads` | Road width, kerb, line and dash settings, junction blend radii, `edges` and `junctions` |
| `markings` | Zebra crossing and the chequered start line |
| `pads` | Named flat areas under buildings (`id`, box, height `h`, blend `m`) |
| `potholes` | Clusters placed along a road by distance, plus exclusion zones |
| `start` | Where the player starts |
| `traffic` | The moving background vehicles (`nBike`, `nAuto`) |
| `scenery` | Buildings, trees, lamps and props, in drawing order |
| `features` | Optional. Things the editor places for later versions: `signals`, `crossings`, `spawnAreas`, `shops` |

## Roads
`roads.edges[0]` must be the oval loop (`type: "oval"`, half-length `L`, end radius `R`). The lap counter follows it.
Every other edge is a straight cross road (`type: "line"`, `a` and `b` as `[x, z]`) or a curved road (`type: "curve"`, see below). Each edge has a `profile`: a list of
`[distance, height]` pairs that start at distance 0 and end at the road's length. Heights between points follow a smooth curve,
so a steeper pair of points is a steeper hill.

## Scenery items (`t`)
- `prims`: raw shapes. `["B", x0,y0,z0, x1,y1,z1, colour, jitter]` box, `["PT", ...]` paint (colours existing cubes only),
  `["C", axis, a, b, radius, from, to, colour, jitter]` cylinder, `["S", cx,cy,cz, radius, colour, jitter]` sphere.
  `solids` lists what the car cannot drive through: `["b", x0,z0,x1,z1]` box or `["c", x,z,radius]` circle.
  Any height may be `{ "pad": "far", "add": 2.1 }`, meaning that pad's height plus 2.1.
- `windows`, `tree`, `lamp`, `bldgN` (a building on a pad): ready-made pieces with a few numbers.
- `guardposts`, `cones`, `scatter`: rules that place many pieces (posts beside drops, cones before potholes, trees and boulders on a lattice).

### Curved roads
`{ "key": "r5", "type": "curve", "pts": [[x, z], ...], "profile": [...] }` with 2 to 24 points. The game draws a smooth Catmull-Rom curve through the points
(sampled every metre). `profile` distances run along the curve, so the last entry must equal the curve's sampled length; the editor keeps it in step
when you move a point. A two-point curve is the same road as a straight line.

## Turned buildings and shapes
- `bldgY`: a building that can face any direction: `{ t, id, pad, cx, cz, w, depth, h, yaw, wall, trim, cols, ys, ww, pitch }`. `cx, cz` is the centre, `w` the width of the front face,
  `yaw` degrees turned about the vertical axis. With `yaw` 0 the front faces north (negative `z`); the front faces world direction `(-sin yaw, -cos yaw)`.
  To face a point, use `yaw = atan2(-dx, -dz)` where `(dx, dz)` points from the building to it. A turned building is solid where it really stands.
- `pads[].yaw`: the flat area under a turned building turns with it (blend and height follow the turned box).
- `prims` may use `["OB", cx, cz, halfWidth, halfDepth, yaw, y0, y1, colour, jitter]` (turned box) and `["OPT", ...]` (turned paint, 9 numbers/colours as for `PT`), and solids `["o", cx, cz, halfWidth, halfDepth, yaw]`.
  A `yaw` of 0 draws exactly what the plain `B`/`b` forms draw.
- `bldgY` and `bldgN` buildings may be copied or lined up in rows by the editor; the file only stores the result.

## Layers: hand-shaped ground
`layers` is optional and holds what the editor's sculpt and paint brushes make. Both are sparse lists keyed by a 0.5 m lattice cell.
- `layers.sculpt`: `{ "cells": [[ix, iz, cm], ...] }`, height change in centimetres (limit +/-3000), up to 60000 cells. Heights between cells are blended smoothly.
  Sculpting is applied before flat building pads, so a pad always wins at its own spot. Roads and kerbs are never changed.
- `layers.paint`: `{ "cells": [[ix, iz, code], ...] }`, a surface code 0 to 7 (0 grass, 1 sand, 2 scrub, 3 laterite, 4 rock, 5 deep rock, 6 soil, 7 paver; `PAINT_KINDS` in `src/engine/world.js`), up to 80000 cells.
  Paint never covers water or road surfaces.
Streamed and whole-map builds read the same layers, so both give the same ground.

## Features (optional)
Maps made in the editor may carry a `features` section. The current game ignores it; later versions use it.
- `signals`: `{ id, kind: "light" | "police", x, z, psi }`
- `crossings`: `{ id, x, z, psi, len }` (a pedestrian crossing, `psi` is the direction across the road)
- `spawnAreas`: `{ id, kind: "pedestrian" | "cow" | "buffalo" | "goat" | "dog" | "vehicle", x0, z0, x1, z1, count }`
- `shops`: `{ id, name, x0, x1, z0, z1 }` (the building itself is a `bldgN` item with the same `id`)
Items the editor makes carry an `id` so they can be found again. Any other field is ignored by the game.

## Limits (memory safety)
Up to 2 MB per file, 64 roads, 4000 scenery items, 20000 shapes, 600 potholes. These can be raised later once streaming (Phase 3) is in.

## Big maps
If a map is too big to keep whole in memory for the device's budget, it is streamed around the player (see README, Memory budget). Nothing in the file changes; keep `slab` as large as the world really is (up to 400 m).

## Try your own
Copy `hill-loop.json`, change `meta.id` and `meta.name`, edit numbers, and open it from Maps, Open a map file. The map editor writes
this same format.

## The 3D map editor
Maps > Map editor opens a 3D editor (a flat top-down view stays available with the Flat button for weak devices). Pick a picture tile from the tray and click the ground:
roads (straight or curved, with handles), buildings and shops (turn with the ring, `[` and `]`, or Face road; set the space between the front and the road edge),
trees, lamps, signals, crossings, spawn areas, hills and lakes, and ground brushes (raise, lower, smooth, level, paint). Select a building to copy it, line up a row of the same
building along the road (Row along road), or start a test drive next to it (Drive here). The Drive here tile starts a test drive from any clicked spot; closing the drive returns to the editor
with the camera and history as they were, and the map's own start is not changed.
Camera: drag with Look (or right-drag) to turn and tilt, Shift/Space-drag or middle-drag to slide, wheel to zoom toward the pointer; Q/E turn, R/F tilt, +/- zoom, Home resets.
Ctrl+Z / Ctrl+Y undo and redo, Ctrl+C / Ctrl+V copy and paste a selected thing at the pointer.
