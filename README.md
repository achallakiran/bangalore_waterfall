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
