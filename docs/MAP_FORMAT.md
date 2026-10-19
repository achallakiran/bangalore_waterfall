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
Every other edge is a straight cross road (`type: "line"`, `a` and `b` as `[x, z]`). Each edge has a `profile`: a list of
`[distance, height]` pairs that start at distance 0 and end at the road's length. Heights between points follow a smooth curve,
so a steeper pair of points is a steeper hill. Later phases add curved and free-drawn roads.

## Scenery items (`t`)
- `prims`: raw shapes. `["B", x0,y0,z0, x1,y1,z1, colour, jitter]` box, `["PT", ...]` paint (colours existing cubes only),
  `["C", axis, a, b, radius, from, to, colour, jitter]` cylinder, `["S", cx,cy,cz, radius, colour, jitter]` sphere.
  `solids` lists what the car cannot drive through: `["b", x0,z0,x1,z1]` box or `["c", x,z,radius]` circle.
  Any height may be `{ "pad": "far", "add": 2.1 }`, meaning that pad's height plus 2.1.
- `windows`, `tree`, `lamp`, `bldgN` (a building on a pad): ready-made pieces with a few numbers.
- `guardposts`, `cones`, `scatter`: rules that place many pieces (posts beside drops, cones before potholes, trees and boulders on a lattice).

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
