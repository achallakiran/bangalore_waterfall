// Fast, GPU-free checks. Runs on every push (blocks deploy):
//  1. the Hill Loop map file passes the validator;
//  2. the world built from that file has the same fingerprints as the frozen legacy build (terrain, roads, potholes, ground cubes);
//  3. the validator refuses broken maps with clear messages;
//  4. the map manager loads, replaces and releases maps, and rejects bad files without keeping them.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, REF, worldFingerprint } from './lib.mjs';
import { validateMap, describeErrors, LIMITS } from '../src/maps/format.js';
import { createMapManager, parseMap, MapError } from '../src/maps/manager.js';
import { createWorld } from '../src/engine/world.js';
import * as ED from '../src/editor/model.js';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const mapPath = path.join(ROOT, 'public/maps/hill-loop.json');
const text = fs.readFileSync(mapPath, 'utf8');
const fresh = () => JSON.parse(text);

// 1. the shipped map
const res = validateMap(fresh());
ok(res.ok, 'hill-loop.json passes the map validator' + (res.ok ? '' : ': ' + describeErrors(res, 5)));

// 2. world parity with the legacy build
const World = createWorld(fresh());
const refFile = path.join(REF, 'world.json');
if (!fs.existsSync(refFile)) { console.log('SKIP no reference world.json (run npm run capture:ref)'); }
else {
  const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'));
  for (const r of ref) {
    const now = await worldFingerprint(World, r.voxel);
    ok(JSON.stringify(now) === JSON.stringify(r), `world from the map file matches the legacy build at ${Math.round(r.voxel * 100)} cm (${now.cubes} ground cubes, ${now.potholes} potholes)`);
  }
}

// 2b. building chunk by chunk (streaming) gives exactly the cubes and heights of the whole-map build
{
  const v = 0.25, grid = World.chunkGrid(v), whole = await World.buildGround(v, () => Promise.resolve());
  const byKey = new Map(whole.chunks.map(c => [Math.round((c.box[0] - World.SLAB.x0) / grid.CH) + ',' + Math.round((c.box[2] - World.SLAB.z0) / grid.CH), c]));
  const same = (x, y) => x.length === y.length && x.every((q, i) => q === y[i]);
  let identical = 0, total = 0, count = 0, anyNull = 0;
  const store = World.createChunkStore(grid);
  for (let b = 0; b < grid.nb; b++) for (let a = 0; a < grid.na; a++) {
    const r = World.buildChunk(grid, a, b);
    const w = byKey.get(a + ',' + b);
    if (!r) { anyNull++; continue; }
    total++; count += r.chunk.count;
    if (w && w.count === r.chunk.count && same(w.pos, r.chunk.pos) && same(w.col, r.chunk.col) && same(w.box, r.chunk.box)) identical++;
    store.set(a, b, r.hf);
  }
  ok(total === byKey.size && identical === total && count === whole.count && anyNull === 0, `chunk-by-chunk build equals the whole-map build (${identical} of ${total} chunks identical, ${count} cubes)`);
  let worst = 0, kindOk = true;
  for (let i = 0; i < 4000; i++) {
    const x = World.SLAB.x0 + ((i * 7919) % 8400) / 100, z = World.SLAB.z0 + ((i * 104729) % 6600) / 100;
    worst = Math.max(worst, Math.abs(store.y(x, z) - World.hfY(whole.HF, x, z)));
    if (store.kind(x, z) !== World.hfKind(whole.HF, x, z)) kindOk = false;
  }
  ok(worst === 0 && kindOk, `streamed heightfield gives the same heights and surfaces everywhere (largest difference ${worst})`);
  const empty = World.createChunkStore(grid);
  let worst2 = 0;
  for (let i = 0; i < 400; i++) { const x = World.SLAB.x0 + ((i * 7919) % 8400) / 100, z = World.SLAB.z0 + ((i * 104729) % 6600) / 100; worst2 = Math.max(worst2, Math.abs(empty.y(x, z) - World.hfY(whole.HF, x, z))); }
  ok(worst2 === 0, 'a lookup in a chunk that is not loaded still returns the right height');
}

// 3. the validator refuses broken maps
const bad = (name, mutate, expectPath) => {
  const m = fresh(); mutate(m);
  const r = validateMap(m);
  ok(!r.ok && (!expectPath || r.errors.some(e => e.path.startsWith(expectPath))), `validator refuses: ${name}` + (r.ok ? ' (it accepted it)' : ''));
};
ok(!validateMap(null).ok && !validateMap([]).ok && !validateMap('x').ok, 'validator refuses things that are not objects');
bad('wrong format name', m => { m.format = 'other'; }, 'format');
bad('newer version', m => { m.version = 2; }, 'version');
bad('bad id', m => { m.meta.id = 'Bad Id!'; }, 'meta.id');
bad('huge map area (memory limit)', m => { m.slab.x1 = m.slab.x0 + 10000; }, 'slab');
bad('road profile not starting at 0', m => { m.roads.edges[0].profile[0][0] = 1; }, 'roads.edges[0].profile');
bad('road profile not ending at the road length', m => { m.roads.edges[1].profile.pop(); }, 'roads.edges[1].profile');
bad('first road is not the oval', m => { m.roads.edges[0].type = 'line'; }, 'roads.edges[0]');
bad('pavement narrower than the road', m => { m.roads.pavement = 1; }, 'roads.pavement');
bad('unknown scenery type', m => { m.scenery.push({ t: 'ufo' }); }, 'scenery');
bad('scenery refers to a missing pad', m => { m.scenery.find(i => i.t === 'bldgN').pad = 'nowhere'; }, 'scenery');
bad('bad colour', m => { m.scenery.find(i => i.t === 'windows').cols[0] = 'red'; }, 'scenery');
bad('shape with the wrong number of values', m => { m.scenery[0].p[0].pop(); }, 'scenery');
bad('NaN number', m => { m.terrain.blend = 'x'; }, 'terrain.blend');
bad('start outside the map', m => { m.start.x = 9999; }, 'start');
bad('unknown traffic vehicle', m => { m.traffic[0].key = 'tank'; }, 'traffic');
bad('pothole on a road that does not exist', m => { m.potholes.clusters[0].edge = 99; }, 'potholes');
bad('too many scenery items', m => { m.scenery = new Array(LIMITS.maxScenery + 1).fill({ t: 'tree', x: 0, z: 0, h: 3, r: 1 }); }, 'scenery');
const e1 = validateMap((() => { const m = fresh(); m.terrain.blend = 'x'; return m; })()).errors[0];
ok(e1 && e1.msg && e1.path, 'each error names where the problem is and what to fix');

// 4. the manager
const fakeFetch = async url => url.endsWith('hill-loop.json') ? { ok: true, status: 200, text: async () => text } : { ok: false, status: 404, text: async () => '' };
const mgr = createMapManager({ fetchImpl: fakeFetch });
ok(mgr.current === null, 'manager holds no map at the start');
const m1 = await mgr.load('hill-loop');
ok(mgr.current === m1 && mgr.source === 'hill-loop' && m1.meta.id === 'hill-loop', 'manager loads the built-in map');
const custom = fresh(); custom.meta.id = 'my-map'; custom.meta.name = 'My map';
const m2 = await mgr.load({ text: JSON.stringify(custom) });
ok(mgr.current === m2 && mgr.current !== m1 && mgr.source === 'file', 'loading another map replaces the first (only one map is held)');
mgr.release();
ok(mgr.current === null && mgr.source === null, 'release gives the map back');
const rejects = async (label, p) => { let e = null; try { await p; } catch (x) { e = x; } ok(e instanceof MapError && e.message.length > 10, label + (e ? ': "' + e.message.slice(0, 80) + '"' : ' (no error)')); };
await rejects('not JSON is refused', mgr.load({ text: 'hello {' }));
await rejects('wrong format is refused', mgr.load({ text: '{"format":"x"}' }));
await rejects('broken map is refused with the reason', mgr.load({ text: JSON.stringify({ ...custom, slab: { x0: 0, x1: 5, z0: 0, z1: 5 } }) }));
await rejects('unknown built-in id is refused', mgr.load('nope'));
await rejects('network failure is explained', createMapManager({ fetchImpl: async () => { throw new Error('offline'); } }).load('hill-loop'));
await rejects('oversized file is refused', mgr.load({ text: ' '.repeat(LIMITS.maxBytes + 1) }));
ok(mgr.current === null, 'a refused file leaves nothing loaded');
ok(parseMap(text).meta.id === 'hill-loop', 'parseMap accepts the shipped file');

// 5. map editor operations (Phase 4): every edit leaves a map the validator accepts, and edits do what they say
{
  const base = fresh();
  const m = ED.newMapFrom(base, { id: 'edit-test', name: 'Edit Test' });
  const valid = (label) => { const r = validateMap(m); ok(r.ok, 'editor: ' + label + (r.ok ? '' : ': ' + describeErrors(r, 4))); return r.ok; };
  valid('a new map from Hill Loop is valid');
  ok(m.scenery.length === 0 && m.roads.edges.length === 1 && m.pads.length === 0, 'editor: a new map has the oval only and no buildings');
  const n = ED.addRoad(m, [-30, -15], [30, -15], 0.5, 2);
  ok(typeof n === 'number' && m.roads.edges.length === 2, 'editor: a cross road is added');
  ok(m.roads.junctions.length >= 2, `editor: junctions are made where the road meets the oval (${m.roads.junctions.length})`);
  valid('map with a cross road');
  ok(ED.addRoad(m, [0, 0], [1, 0]).startsWith('!'), 'editor: a road under 4 m is refused');
  ok(ED.addRoad(m, [0, 0], [500, 0]).startsWith('!'), 'editor: a road outside the map is refused');
  const hp = ED.setRoadHeight(m, n, 15, 3.5);
  ok(m.roads.edges[n].profile.length === 3 && m.roads.edges[n].profile[1][1] === 3.5, 'editor: a slope point is added to a road');
  ED.setRoadHeight(m, n, 15.5, 1.2);
  ok(m.roads.edges[n].profile.length === 3 && m.roads.edges[n].profile[1][1] === 1.2, 'editor: a nearby height point is moved, not duplicated');
  ED.setRoadHeight(m, 0, 0, 1);
  const ov = m.roads.edges[0].profile; ok(ov[0][1] === 1 && ov[ov.length - 1][1] === 1, 'editor: the oval keeps closing when its start height changes');
  valid('map with slopes');
  ok(ED.removeRoadHeight(m, n, 15) === true && m.roads.edges[n].profile.length === 2, 'editor: a slope point is removed');
  const b = ED.addBuilding(m, { x0: -30, x1: -20, z0: 5, z1: 12, h: 8 });
  ok(typeof b === 'string' && !b.startsWith('!') && m.pads.some(p => p.id === b) && m.scenery.some(s => s.t === 'bldgN' && s.pad === b), 'editor: a building makes a pad and a building item');
  const sh = ED.addBuilding(m, { x0: -15, x1: -6, z0: 5, z1: 11, h: 4.5, shop: { name: 'Corner Store' } });
  ok(m.features.shops.some(s => s.id === sh && s.name === 'Corner Store') && m.scenery.some(s => s.of === sh), 'editor: a shop is a building with a name and an awning');
  ok(ED.addBuilding(m, { x0: 0, x1: 1, z0: 0, z1: 1 }).startsWith('!'), 'editor: a tiny building is refused');
  valid('map with buildings and a shop');
  ok(ED.addTree(m, 10, 10) && ED.addLamp(m, 12, 10, 1), 'editor: tree and lamp are added');
  ED.addSignal(m, 0, -12, 0); ED.addSignal(m, 4, -12, 3.14, 'police'); ED.addCrossing(m, 6, 0, 0, 5);
  ED.addSpawnArea(m, 'cow', 20, 4, 26, 9, 2); ED.addSpawnArea(m, 'pedestrian', -12, 3, -6, 4, 6);
  ok(ED.addSpawnArea(m, 'dragon', 0, 0, 5, 5).startsWith('!'), 'editor: an unknown spawn kind is refused');
  valid('map with signals, crossing and spawn areas');
  ok(ED.hitTest(m, -25, 8).id === b && ED.hitTest(m, 0, -12).kind === 'signal' && ED.hitTest(m, 23, 6).kind === 'spawn', 'editor: hit tests find buildings, signals and spawn areas');
  ok(ED.removeById(m, sh) === true && !m.pads.some(p => p.id === sh) && !m.features.shops.length && !m.scenery.some(s => s.of === sh), 'editor: removing a shop removes its pad, awning and listing');
  const k0 = m.terrain.biomes.lake.length; ED.addBlob(m, 'lake', 20, 10, 6, 5, 1);
  ok(m.terrain.biomes.lake.length === k0 + 1 && ED.removeBlobNear(m, 20, 10) === 'lake' && m.terrain.biomes.lake.length === k0, 'editor: a terrain area is added and removed');
  ED.setOval(m, 18, 12);
  ok(Math.abs(m.roads.edges[0].profile.at(-1)[0] - (4 * 18 + 2 * Math.PI * 12)) < 1e-9, 'editor: resizing the oval stretches its profile to the new length');
  valid('map after the oval was resized');
  ED.addRoad(m, [-20, -30], [20, -30], 0, 0); ED.addRoad(m, [0, -35], [0, -25], 0, 0);
  ok(ED.removeRoad(m, 1) === true, 'editor: a cross road is removed');
  valid('map after a road was removed (others renumbered)');
  ok(ED.removeRoad(m, 0).startsWith('!'), 'editor: the oval cannot be removed');
  const w = ED.warnings(ED.newMapFrom(base)); ok(Array.isArray(w), 'editor: warnings list is produced');
  ED.addBuilding(m, { x0: -3, x1: 3, z0: -2, z1: 2, h: 5 });
  ok(ED.warnings(m).some(t => /touches a road/.test(t)), 'editor: a building on a road gets a warning');
  const bad = JSON.parse(JSON.stringify(m)); bad.features.spawnAreas[0].kind = 'x';
  ok(!validateMap(bad).ok, 'validator: a bad spawn area kind is refused');
  const bad2 = JSON.parse(JSON.stringify(m)); bad2.features.signals[0].kind = 'x';
  ok(!validateMap(bad2).ok, 'validator: a bad signal kind is refused');
  ok(validateMap(fresh()).ok, 'validator: maps without a features section are still valid');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll fast checks passed');
process.exit(failed ? 1 : 0);
