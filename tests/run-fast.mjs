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

// 6. engine E1/E2: ground layers and turned buildings
{
  const m = ED.newMapFrom(fresh());
  const valid = (label) => { const r = validateMap(m); ok(r.ok, 'layers: ' + label + (r.ok ? '' : ': ' + describeErrors(r, 4))); return r.ok; };
  const H = (x, z) => createWorld(m).column(x, z, 0.25);
  const h0 = H(-37, 2).h, k0 = H(-37, 2).kind, roadH0 = H(0, -15).h;
  ok(ED.sculptBrush(m, -37, 2, 5, 1.5, 'raise') === true && Math.abs(H(-37, 2).h - (h0 + 1.5)) < 0.05, 'layers: raising ground by 1.5 m lifts the centre by 1.5 m');
  ok(H(-37, 9).h === createWorld(ED.newMapFrom(fresh())).column(-37, 9, 0.25).h, 'layers: ground outside the brush is untouched');
  valid('map with a sculpted hump');
  ED.sculptBrush(m, -37, 2, 5, 1.5, 'lower');
  ok(!m.layers && Math.abs(H(-37, 2).h - h0) < 1e-9, 'layers: lowering it back removes the layer entirely');
  ok(ED.gradeTo(m, -37, 2, 3, 5, 3) === true && Math.abs(H(-37, 2).h - 5) < 0.02 && Math.abs(H(-36, 3).h - 5) < 0.02, 'layers: grade-to sets an exact level');
  valid('map after grading');
  ok(ED.paintBrush(m, -37, 2, 2, 'paver') === true && H(-37, 2).kind === 19 && H(-30, 14).kind === createWorld(ED.newMapFrom(fresh())).column(-30, 14, 0.25).kind, 'layers: paint changes the surface under the brush only');
  valid('map with painted pavers');
  ok(ED.paintBrush(m, -37, 2, 2, 'lava').startsWith('!'), 'layers: an unknown surface is refused');
  ED.paintBrush(m, -37, 2, 3, 'erase'); ok(H(-37, 2).kind === k0, 'layers: erase gives back the natural surface');
  ok(Math.abs(H(0, -15).h - roadH0) < 1e-9 && H(0, -15).kind === createWorld(ED.newMapFrom(fresh())).column(0, -15, 0.25).kind, 'layers: tarmac is never changed by a brush');
  ED.sculptBrush(m, -37, 2, 4, 1, 'raise'); ED.sculptBrush(m, -37, 2, 6, 1, 'smooth'); valid('map after smoothing');
  const bad = JSON.parse(JSON.stringify(m)); bad.layers.sculpt.cells[0] = [1.5, 2, 3];
  ok(!validateMap(bad).ok, 'layers: fractional lattice cells are refused');
  const bad2 = JSON.parse(JSON.stringify(m)); bad2.layers.sculpt.cells.push([0, 0, 99999]);
  ok(!validateMap(bad2).ok, 'layers: absurd heights are refused');
  ok(ED.clearLayers(m) === true && !m.layers, 'layers: clearing removes them');

  // turned buildings
  const id = ED.addBuildingY(m, { cx: -37, cz: 2, w: 6, depth: 4, h: 6, yaw: 0, shop: { name: 'Turn Stores' } });
  ok(typeof id === 'string' && !id.startsWith('!'), 'turn: a building is added with a yaw');
  valid('map with a turnable shop');
  ok(ED.turnBuilding(m, id, 30) === 30 && m.pads.find(p => p.id === id).yaw === 30, 'turn: turning moves the pad with it');
  valid('map with a turned shop');
  const sh = m.features.shops.find(q => q.id === id);
  ok(sh.x1 - sh.x0 > 6 && sh.z1 - sh.z0 > 4, 'turn: the shop box grows to cover the turned footprint');
  ok(ED.hitTest(m, -37, 2).id === id, 'turn: a click on the turned building finds it');
  const f = ED.faceRoadYaw(m, id);
  ok(f.yaw < -30 && f.yaw > -90 && f.dist > 0, `turn: the nearest road lies east-north-east, so facing it turns the front to between -30 and -90 degrees (${f.yaw})`);
  ok(ED.faceRoad(m, id) === f.yaw, 'turn: face-the-road applies that yaw');
  valid('map after facing the road');
  const old = ED.addBuilding(m, { x0: -40, x1: -34, z0: 8, z1: 12, h: 5, shop: { name: 'Old' } });
  ok(ED.turnBuilding(m, old, 45) === 45 && m.scenery.some(q => q.t === 'bldgY' && q.id === old), 'turn: an old axis-aligned building can be turned');
  valid('map with a converted building');
  ok(ED.moveBuilding(m, id, -36, 3) === true && ED.hitTest(m, -36, 3).id === id, 'turn: a building can be moved');
  valid('map after moving a building');
  ok(ED.removeById(m, id) === true && !m.pads.some(p => p.id === id) && !m.scenery.some(q => q.of === id), 'turn: removing it removes pad and awning');
}

// 7. engine E3: curved roads
{
  const mk = type => { const m = ED.newMapFrom(fresh()); m.roads.edges.push(type === 'line'
    ? { key: 'r', type: 'line', a: [-40, -30], b: [40, -30], profile: [[0, 0], [30, 2], [80, 0]] }
    : { key: 'r', type: 'curve', pts: [[-40, -30], [40, -30]], profile: [[0, 0], [30, 2], [80, 0]] }); return m; };
  const WL = createWorld(mk('line')), WC = createWorld(mk('curve'));
  let worst = 0, kindDiff = 0;
  for (let i = 0; i < 400; i++) { const x = -45 + (i * 37 % 90), z = -36 + (i * 11 % 12) * 1.0; const a = WL.column(x, z, 0.3), b = WC.column(x, z, 0.3); worst = Math.max(worst, Math.abs(a.h - b.h)); if (a.kind !== b.kind) kindDiff++; }
  ok(worst < 1e-9 && kindDiff === 0, `curve: a two-point curve is the same road as a straight line (max height difference ${worst.toExponential(1)}, ${kindDiff} surface differences)`);
  const m = ED.newMapFrom(fresh());
  const idx = ED.addCurve(m, [[-38, -36], [-15, -44], [10, -38], [38, -45]], 0, 3);
  ok(typeof idx === 'number' && m.roads.edges[idx].type === 'curve', 'curve: a curved road is added');
  ok(validateMap(m).ok, 'curve: the map with a curved road is valid');
  const W = createWorld(m), len = W.edgeLen(idx), chord = Math.hypot(76, 10);
  ok(len > chord + 1, `curve: it is longer than the straight chord (${len.toFixed(1)} m against ${chord.toFixed(1)} m)`);
  let onRoad = 0, far = 0;
  for (let t = 2; t < len - 2; t += 3) { const p = W.edgePoint(idx, t, 0), q = W.edgePoint(idx, t, 6); if (W.column(p.x, p.z, 0.3).tarmac >= 1) onRoad++; if (W.column(q.x, q.z, 0.3).tarmac === 0 || Math.abs(W.loopInfo(q.x, q.z).u) <= 4) far++; }
  const total = Math.floor((len - 4) / 3) + 1;
  ok(onRoad >= total - 1 && far >= total - 1, `curve: the road surface follows the curve (${onRoad}/${total} centre points on tarmac, ${far}/${total} points 6 m aside off it)`);
  const pe = W.edgePoint(idx, len / 2, 0), c = W.column(pe.x, pe.z, 0.3);
  ok(Math.abs(c.h - W.edgeH(idx, len / 2)) < 0.05, 'curve: the ground height on the road matches the road profile');
  { const mj = ED.newMapFrom(fresh()); ED.addCurve(mj, [[0, -20], [4, -34], [0, -46]], 0, 0); ok(mj.roads.junctions.length >= 1 && validateMap(mj).ok, `curve: crossing the oval makes a junction (${mj.roads.junctions.length})`); }
  const e = m.roads.edges[idx], L0 = W.edgeLen(idx);
  ok(ED.moveCurvePoint(m, idx, 1, -15, -40) === true && Math.abs(e.profile.at(-1)[0] - createWorld(m).edgeLen(idx)) < 1e-9 && validateMap(m).ok, 'curve: moving a point stretches the height profile to the new length');
  const ai = ED.addCurvePoint(m, idx, 0, -39); ok(typeof ai === 'number' && e.pts.length === 5 && validateMap(m).ok, 'curve: a point is inserted along the road');
  ok(ED.removeCurvePoint(m, idx, ai) === true && e.pts.length === 4 && validateMap(m).ok, 'curve: a point is removed');
  const W2 = createWorld(m), hp = W2.edgePoint(idx, W2.edgeLen(idx) / 3, 0);
  ok(ED.hitTest(m, hp.x, hp.z).kind === 'road', 'curve: a click on a curved road finds it');
  const bad = JSON.parse(JSON.stringify(m)); bad.roads.edges[idx].profile.at(-1)[0] = 5;
  ok(!validateMap(bad).ok, 'curve: a profile that does not end at the road length is refused');
  const bad2 = JSON.parse(JSON.stringify(m)); bad2.roads.edges[idx].pts = [[0, 0]];
  ok(!validateMap(bad2).ok, 'curve: a one-point curve is refused');
  ok(ED.removeRoad(m, idx) === true && m.roads.edges.length === 1, 'curve: a curved road is removed');
}

// 8. editor E6: rows of buildings, copies, drop-in start
{
  const m = ED.newMapFrom(fresh()); ED.setSlab(m, -120, 120, -140, 60);
  const ar = ED.addRoad(m, [-60, -90], [60, -90], 0, 0); ok(typeof ar === 'number', 'frontage: a test road is added');
  const ei = m.roads.edges.length - 1, before = m.scenery.length;
  const n = ED.frontage(m, { edge: ei, side: 1, style: { w: 8, d: 6, h: 7, wall: '#E6D5AE', trim: '#8A6D4B' }, setback: 3, gap: 1 });
  ok(typeof n === 'number' && n >= 8, `frontage: a row of buildings is placed along a road (${n})`);
  const valid = label => { const r = validateMap(m); ok(r.ok, 'frontage: ' + label + (r.ok ? '' : ': ' + describeErrors(r, 4))); return r.ok; };
  valid('map after a row of buildings');
  const bs = m.scenery.filter(q => q.t === 'bldgY');
  const W = createWorld(m);
  const gaps = bs.every(q => { const r = ED.setbackOf(m, q.id); return r && Math.abs(r.dist - 3) < 0.6; });
  ok(gaps, 'frontage: every building keeps the 3 m space from the road edge');
  const clear = bs.every(q => { const lines = ED.polylines(m); return !ED.nearestRoad(m, q.cx, q.cz, m.roads.pavement - 0.5, lines); });
  ok(clear, 'frontage: no building stands on the road');
  const again = ED.frontage(m, { edge: ei, side: 1, style: { w: 8, d: 6, h: 7 }, setback: 3, gap: 1 });
  ok(again === 0 && m.scenery.filter(q => q.t === 'bldgY').length === bs.length, 'frontage: a second row on the same spots adds nothing');
  const c = ED.duplicateItem(m, bs[0].id, 10, -60);
  const cb = ED.getItem(m, c);
  ok(typeof c === 'string' && cb && cb.w === bs[0].w && cb.yaw === bs[0].yaw && c !== bs[0].id, 'copy: a building is copied with its size and turn');
  valid('map after a copy');
  const t = ED.addTree(m, 5, -50), tc = ED.duplicateItem(m, t, 9, -50);
  ok(ED.getItem(m, tc) && ED.getItem(m, tc).t === 'tree', 'copy: a tree is copied');
  const sg = ED.addSignal(m, 0, -70, 0, 'light'), sc = ED.duplicateItem(m, sg, 4, -70);
  ok(ED.getItem(m, sc) && m.features.signals.length === 2, 'copy: a signal is copied');
  const dp = ED.dropPoint(m, 0, -90.4);
  ok(Math.abs(dp.z + 90) < 1 && Number.isFinite(dp.psi), 'drop: a point near a road lands on the road');
  const dq = ED.dropPoint(m, 30, -70);
  ok(dq.x === 30 && dq.z === -70, 'drop: a point away from roads stays where it was clicked');
  const m2 = ED.clone(m); ED.setStart(m2, dp.x, dp.z, dp.psi); ok(validateMap(m2).ok && m.start.x !== m2.start.x, 'drop: the test copy has the new start and the map is untouched');
}

// 9. N1: the map grows with what is placed, can be fitted to its contents, and carries an optional real-route note
{
  const base = fresh(), m = ED.newMapFrom(base, { id: 'grow', name: 'Grow' });
  ED.growSlab(m, [[0, 0]]);
  const s0 = Object.assign({}, m.slab);
  ok(ED.growSlab(m, [[0, 0]]) === false && m.slab.x0 === s0.x0 && m.slab.z1 === s0.z1, 'grow: a point well inside the map changes nothing');
  ok(ED.growSlab(m, [[s0.x1 + 5, 0]]) === true && m.slab.x1 >= s0.x1 + 5 + 24 && m.slab.x1 % 12 === 0 && m.slab.x0 === s0.x0, 'grow: a point past the east edge grows the east side in 12 m steps with a 24 m margin');
  ok(ED.growSlab(m, [[0, s0.z0 - 3]]) === true && m.slab.z0 <= s0.z0 - 3 - 24 && m.slab.z0 % 12 === 0, 'grow: a point past the north edge grows the north side');
  ok(validateMap(m).ok, 'grow: the grown map is valid');
  const wide = ED.growSlab(m, [[5000 - 30, 0]]);
  ok(typeof wide === 'string' && wide.startsWith('!'), 'grow: a map cannot pass the size limit (' + LIMITS.slabMax + ' m)');
  ok(LIMITS.slabMax === 1000, 'grow: the side limit is 1000 m');
  const r = ED.addRoad(m, [m.slab.x1 - 10, 0], [m.slab.x1 - 2, 10]);
  ok(typeof r === 'number', 'grow: a road can now be placed in the grown area');
  ok(ED.fitSlab(m) === true && validateMap(m).ok, 'fit: fitting keeps the map valid');
  ok(m.slab.x1 - m.slab.x0 >= 48 && m.slab.z1 - m.slab.z0 >= 48 && (m.slab.x1 - m.slab.x0) % 12 === 0, 'fit: the fitted map is at least 48 m and in 12 m steps');
  const pts = ED.contentPoints(m);
  ok(pts.every(p => p[0] >= m.slab.x0 && p[0] <= m.slab.x1 && p[1] >= m.slab.z0 && p[1] <= m.slab.z1), 'fit: everything placed is inside the fitted map');
  const mm = ED.clone(m); mm.meta.route = { realLengthM: 13120, ratio: 6.6, label: 'Utopia to Aquamarine' };
  ok(validateMap(mm).ok, 'route note: a valid note is accepted');
  mm.meta.route.ratio = 0; ok(!validateMap(mm).ok, 'route note: a ratio of zero is refused');
  const g = createWorld(fresh()); ok(!!g, 'grow: Hill Loop still builds');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll fast checks passed');
process.exit(failed ? 1 : 0);
