# Hill Loop Track v2

A voxel driving game on a climbing Bangalore-style road loop. v2.1 adds an app shell (title, maps, settings, pause),
full screen, install-as-app (PWA), a rewritten touch pad and a parity test harness.
The original Loop Track and Hill Loop Track pages are **not modified**: the Hill Loop game core is carried over
unchanged (`tools/make-game-from-legacy.py` documents every difference) and Loop Track opens as the original file.

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm test           # fast checks (no GPU)
npm run build      # writes dist/ with the service worker
npm run preview
```

## Host it on GitHub Pages (github.io)

1. Create a GitHub repository and push this folder to the `main` branch.
2. In the repository open **Settings, Pages** and set **Source** to **GitHub Actions**.
3. Push (or run the workflow from the Actions tab). The workflow in `.github/workflows/deploy.yml` runs the tests, builds and publishes.
4. The game is at `https://YOURNAME.github.io/REPO/`. Asset paths are relative, so no repo name needs configuring.

No Actions? Run `npm run build` and publish the `dist` folder (for example to a `gh-pages` branch, then set Pages to that branch).

## Install as an app

- **Android and desktop Chrome or Edge:** use the Install app button in the menu (or the browser's install icon).
- **iPhone / iPad (Safari):** Share, then Add to Home Screen. The installed app runs full screen.
- **Safari on Mac:** File, then Add to Dock.

## Tests

| Command | What it checks | Needs |
| --- | --- | --- |
| `npm test` | The map file passes the validator; the world built from it equals the legacy world (fingerprints); broken maps are refused; the map manager loads, replaces and releases | Node only |
| `npm run build && npm run test:parity` | Drive traces and screenshots equal the legacy build | Chromium |
| `npm run build && npm run test:shell` | Menus, pause, controls, opening map files, teardown, phone layout | Chromium |
| `npm run build && npm run test:soak` | Start and leave the game 5 times: no canvas, map or game left behind; DOM nodes and listeners stay flat; heap stays within 15% | Chromium |
| `npm run capture:ref` | Re-record references from `tests/legacy` (only when the legacy build is deliberately changed) | Chromium |

Set `CHROMIUM_PATH` to use a specific browser; otherwise `npx playwright-core install chromium` first.
| `npm run build && npm run test:stream` | Streaming: Hill Loop forced to stream under a small budget (same ground heights as the whole build, cubes stay under budget); a 320 m map streams by itself and stays bounded | Chromium |
| `npm run build && npm run test:editor` | Map editor: drives the real screen with the mouse (road, slope, building, shop, signal, crossing, spawn area), undo and redo, saves a file the validator accepts, test-drives it and returns to the editor, opens a file, then leaves with nothing left behind | Chromium |

## Map editor (3D)
Main menu, Map editor. A Hot Wheels style 3D view of the real ground (made by the same maths as the game). Pick a picture tile from the tray, then click the ground. Tabs: Roads, Buildings, Roadside (trees, lamps), Traffic (signals, crossings), Crowd (spawn areas), Ground (hills, lakes, raise, lower, smooth, level, paint).
- **Look around**: drag with Look (or right-drag) to turn and tilt, Shift/Space-drag slides, wheel zooms toward the pointer, Q/E turn, R/F tilt, Home resets. The 3D, Top and Street buttons jump to a view. The Flat button gives a top-down fallback for weak devices.
- **Buildings and shops**: click one to select it, then drag the ring's blue dot to turn it, press `[` or `]`, type an exact angle, or press Face road. The space field sets the gap between the front and the road edge. Copy, Row along road (lines up more of the same building, all facing the road) and Drive here are on the same panel.
- **Roads**: straight, or curved (click points, Enter or double-click to finish; drag the handles afterwards). Slope shapes the hills along a road.
- **Ground**: Raise, Lower, Smooth, Level and Paint brushes shape the space between roads and buildings. Roads never change; buildings sit on their own flat pad.
- **Undo and redo**: big buttons float on the map (bottom left, next to Maps), and say what they will undo. Ctrl or Cmd + Z / + Y also work. Ctrl+C and Ctrl+V copy and paste the selected thing.
- **The map grows by itself**: place something near or past the edge and the ground extends (12 m steps, 24 m margin, up to 1000 m a side) as part of the same undo step. *Fit map to content* in the This map panel trims empty ground.
- **Moving the map (2.6.1)**: two fingers slide, zoom or turn, one at a time (the first clear movement decides; the rest is ignored until you lift). The **Hand** button makes one finger slide the map; a quick flick coasts a little. Sliding keeps the spot you touched under your finger. **Fit** returns to the whole-map view. Arrow keys or WASD slide on a laptop.
- **Extending the map (2.6.1)**: the ground beyond the edge can be touched and built on (up to 200 m out). Yellow dots on the edges drag the map bigger in 12 m steps (Undo says *Extend map*). Placing a thing more than 60 m past the edge is refused so a stray tap cannot make a huge map. *Diagnostics* in the This map panel shows speed and the current gesture.
- **New map (2.7.0)**: choose a size (Small 96 m, Medium 192 m, Large 384 m) and what to start with: *Blank land* (flat grass, no oval loop, no roads), *Blank with an oval loop*, or *Copy of Hill Loop*. A map without the oval has no laps; roads you draw are drivable and *Start* (flag tile) places where the car starts.
- **Shape a road (2.8.0)**: tap a road. A gold marker shows where, with an arrow along the road and four buttons: **Up / Down** change the height there (the slope), **Left / Right** bend the road there (left and right as seen along the arrow). A straight road becomes a curved road the first time you bend it. Hold a button to repeat; one hold is one Undo. *Step* cycles Fine, Normal, Coarse; *Remove* takes away the point at the marker. The oval loop only goes up and down. The old Slope tile is gone.
- **Save file** downloads the map JSON. Open it later from the editor, or from Maps, Open a map file.
- **Test drive** plays the map you are editing, and Exit brings you back with your work, history and camera. **Drive here** (tile or button) starts from a chosen spot; the map's own start is unchanged.
- **Maps (slots)**: your map is saved on this device automatically (IndexedDB) as soon as you change something. The Maps button opens the list: Open, Rename, Copy, Delete, New map, Copy of Hill Loop, Open file. Coming back offers *Continue*. Clearing browser data removes slots, so use Save file as a backup.
- **Stable editor**: the previous editor is kept unchanged as *Map editor 2.5 stable* in the main menu, with its own storage. Both read and write the same map files.
- The editor's code and styles load only when it is opened. The 3D view frees its graphics memory when you switch to Flat and when you leave.

The first road is always the oval loop (the lap counter follows it). Map format details: docs/MAP_FORMAT.md.

## Memory budget (Phase 3)
The game never holds more voxel cubes than the device budget (Settings, Memory budget: Auto, Low 250k, Medium 450k, High 900k; Auto picks from device memory, cores and touch). If the whole map fits (Hill Loop always does), it is built whole exactly as before. A bigger map is streamed: the ground is built in 12 m chunks and the scenery in 16 m tiles around the player, nearest first, and far ones are disposed. Unloaded ground still answers height and surface queries from the map maths, so driving and the minimap stay correct. The budget applies the next time a game starts. Testing aids: add `?stream=1&cubes=30000` to the page address to force streaming with a given budget.

## Maps (Phase 2)
The Hill Loop map is a data file, `public/maps/hill-loop.json`, and the world is built from it. Maps are validated before use,
only one map is held in memory, and it is released when you leave the game. On the Maps screen, "Open a map file" loads your own
JSON map. The format is described in `docs/MAP_FORMAT.md`.

## Layout

```
index.html            screens, game template
src/main.js           shell controller
src/shell/            settings, full screen, install, game host (mount/unmount), settings UI, PWA registration
src/engine/world.js   world model built from a map file (same maths as the original)
src/maps/             map format validator and map manager (fetch, validate, hold one, release)
src/game/hill-loop/   game.js (game core; scenery is read from the map)
src/styles/           tokens + game + shell styles
public/               maps/hill-loop.json, manifest, icons, previews, vendored three.js r128, legacy/loop-track.html (unchanged)
tools/                make-hill-loop-map.mjs (provenance), service worker template, service worker template, thumbnail extractor
tests/                harness, references, legacy builds (read only)
```
