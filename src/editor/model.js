// Map editing operations (Phase 4). Pure functions on a map object: no DOM, so they run in tests and in the editor.
// Every operation edits the map it is given and returns what it made (or a string starting with "!" that explains why not).
// Things the editor creates carry an "id" (b-1, t-2 ...) so they can be found and removed again; the game ignores that field.
import { createWorld } from '../engine/world.js';
import { validateMap, LIMITS } from '../maps/format.js';

export const clone = m => JSON.parse(JSON.stringify(m));
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const FEATURE_LISTS = ['signals', 'crossings', 'spawnAreas', 'shops'];
export const BIOMES = ['hills', 'rock', 'scrub', 'lake'];

export function ensureFeatures(map) {
  if (!map.features || typeof map.features !== 'object') map.features = {};
  FEATURE_LISTS.forEach(k => { if (!Array.isArray(map.features[k])) map.features[k] = []; });
  return map.features;
}

function nextId(map, prefix) {
  let n = 1;
  const used = new Set();
  (map.scenery || []).forEach(s => { if (s.id) used.add(s.id); });
  (map.pads || []).forEach(s => used.add(s.id));
  FEATURE_LISTS.forEach(k => ((map.features && map.features[k]) || []).forEach(s => { if (s.id) used.add(s.id); }));
  while (used.has(prefix + '-' + n)) n++;
  return prefix + '-' + n;
}

// A new map starts as a copy of a base map (the shipped Hill Loop), emptied of buildings, trees and traffic markers.
export function newMapFrom(base, { id = 'my-map', name = 'My map' } = {}) {
  const m = clone(base);
  m.meta = { id, name, author: '', description: '', scale: 'game' };
  m.pads = []; m.scenery = []; m.potholes.clusters = []; m.potholes.exclude = [];
  m.roads.edges = m.roads.edges.slice(0, 1); m.roads.junctions = [];
  m.features = { signals: [], crossings: [], spawnAreas: [], shops: [] };
  return m;
}

// ---------- Roads ----------
// Centre lines of every road as lists of [x, z, distance]; used for junctions, snapping and hit tests.
export function polylines(map) {
  const out = [];
  map.roads.edges.forEach((e, i) => {
    const pts = [];
    if (i === 0) {
      const W = createWorld(map), n = Math.ceil(W.LTOT / 1);
      for (let k = 0; k <= n; k++) { const t = Math.min(W.LTOT, k * W.LTOT / n), p = W.trackPoint(t, 0); pts.push([p.x, p.z, t]); }
    } else {
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      pts.push([e.a[0], e.a[1], 0], [e.b[0], e.b[1], len]);
    }
    out.push(pts);
  });
  return out;
}
function segInter(p, q, r, s) {
  const d1x = q[0] - p[0], d1z = q[1] - p[1], d2x = s[0] - r[0], d2z = s[1] - r[1], den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((r[0] - p[0]) * d2z - (r[1] - p[1]) * d2x) / den, u = ((r[0] - p[0]) * d1z - (r[1] - p[1]) * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}
function nearOnLine(pts, x, z) { // closest point on a polyline: { d, t (distance along), x, z }
  let best = { d: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    const s = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1), px = a[0] + dx * s, pz = a[1] + dz * s, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, t: a[2] + (b[2] - a[2]) * s, x: px, z: pz };
  }
  return best;
}
export function nearestRoad(map, x, z, maxD = 3, lines = polylines(map)) {
  let best = null;
  lines.forEach((pts, i) => { const n = nearOnLine(pts, x, z); if (n.d <= maxD && (!best || n.d < best.d)) best = { edge: i, ...n }; });
  return best;
}
export function roadLength(map, i) {
  const e = map.roads.edges[i];
  return i === 0 ? 4 * e.L + 2 * Math.PI * e.R : Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
}

export function addRoad(map, a, b, h0 = 0, h1 = h0) {
  if (map.roads.edges.length >= LIMITS.maxEdges) return '!Too many roads.';
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 4) return '!A road must be at least 4 m long.';
  const s = map.slab;
  for (const p of [a, b]) if (p[0] < s.x0 || p[0] > s.x1 || p[1] < s.z0 || p[1] > s.z1) return '!A road must stay inside the map area.';
  const T = map.terrain, lo = T.yMin, hi = T.yMax;
  h0 = clamp(h0, lo, hi); h1 = clamp(h1, lo, hi);
  const lines = polylines(map), W = createWorld(map), n = map.roads.edges.length;
  let k = 1; const used = new Set(map.roads.edges.map(e => e.key));
  while (used.has('road-' + k)) k++;
  const key = 'road-' + k;
  const edge = { key, type: 'line', a: [r2(a[0]), r2(a[1])], b: [r2(b[0]), r2(b[1])], profile: [[0, r2(h0)], [r2(len), r2(h1)]] };
  edge.profile[1][0] = Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]);
  // junctions where the new road crosses or ends on an existing road
  const found = [];
  const mine = [[edge.a[0], edge.a[1], 0], [edge.b[0], edge.b[1], edge.profile[1][0]]];
  lines.forEach((pts, ei) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const hit = segInter(mine[0], mine[1], pts[i], pts[i + 1]);
      if (hit) found.push({ ei, x: mine[0][0] + (mine[1][0] - mine[0][0]) * hit.t, z: mine[0][1] + (mine[1][1] - mine[0][1]) * hit.t, tNew: hit.t * edge.profile[1][0], tOld: pts[i][2] + (pts[i + 1][2] - pts[i][2]) * hit.u });
    }
    [mine[0], mine[1]].forEach((end, j) => {
      const nr = nearOnLine(pts, end[0], end[1]);
      if (nr.d < 0.6) found.push({ ei, x: nr.x, z: nr.z, tNew: j ? edge.profile[1][0] : 0, tOld: nr.t });
    });
  });
  const made = [];
  found.forEach(f => {
    if (made.some(q => Math.hypot(q.x - f.x, q.z - f.z) < 2)) return;
    if (map.roads.junctions.length + made.length >= LIMITS.maxJunctions) return;
    const hOld = W.edgeH(f.ei, f.tOld), hNew = h0 + (h1 - h0) * (f.tNew / edge.profile[1][0]);
    made.push({ x: r2(f.x), z: r2(f.z), h: r2((hOld + hNew) / 2), of: key });
  });
  map.roads.edges.push(edge);
  made.forEach(j => map.roads.junctions.push(j));
  return n; // index of the new road
}

// Remove a cross road. Everything that refers to roads by number (potholes, guard posts, cones) is renumbered.
export function removeRoad(map, i) {
  if (i < 1 || i >= map.roads.edges.length) return '!The oval loop cannot be removed.';
  const key = map.roads.edges[i].key;
  map.roads.edges.splice(i, 1);
  map.roads.junctions = map.roads.junctions.filter(j => j.of !== key);
  const fix = n => (n > i ? n - 1 : n);
  map.potholes.clusters = map.potholes.clusters.filter(c => c.edge !== i); map.potholes.clusters.forEach(c => { c.edge = fix(c.edge); });
  map.potholes.exclude = map.potholes.exclude.filter(c => c.edge !== i); map.potholes.exclude.forEach(c => { c.edge = fix(c.edge); });
  map.scenery.forEach(s => {
    if (s.t === 'guardposts') s.edges = s.edges.filter(e => e !== i).map(fix);
    if (s.t === 'cones') s.at = s.at.filter(a => a[0] !== i).map(a => [fix(a[0]), a[1]]);
  });
  return true;
}

// Set the height of a road at a distance along it (a slope). Near an existing control point it moves that point.
export function setRoadHeight(map, edge, t, h) {
  const e = map.roads.edges[edge]; if (!e) return '!No such road.';
  const len = roadLength(map, edge), T = map.terrain;
  h = r2(clamp(h, T.yMin, T.yMax)); t = clamp(t, 0, len);
  const pts = e.profile, snap = Math.min(2.5, len / 8);
  let hit = pts.findIndex(p => Math.abs(p[0] - t) <= snap);
  if (hit >= 0) {
    pts[hit][1] = h;
    if (edge === 0 && (hit === 0 || hit === pts.length - 1)) { pts[0][1] = h; pts[pts.length - 1][1] = h; } // the loop must close
    return hit;
  }
  if (pts.length >= 60) return '!Too many height points on this road.';
  pts.push([r2(t), h]); pts.sort((p, q) => p[0] - q[0]);
  return pts.findIndex(p => p[0] === r2(t));
}
export function removeRoadHeight(map, edge, t) {
  const e = map.roads.edges[edge]; if (!e) return '!No such road.';
  const pts = e.profile; let best = -1, bd = 1e9;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs(pts[i][0] - t); if (d < bd) { bd = d; best = i; } }
  if (best < 0 || bd > 4) return '!No height point here to remove.';
  pts.splice(best, 1); return true;
}

// Change the oval: its profile is stretched to the new length so the slope shape is kept.
export function setOval(map, L, R) {
  const e = map.roads.edges[0], old = 4 * e.L + 2 * Math.PI * e.R;
  L = clamp(L, 4, 200); R = clamp(R, 4, 200);
  const nw = 4 * L + 2 * Math.PI * R, f = nw / old;
  e.L = r2(L); e.R = r2(R);
  e.profile = e.profile.map(p => [p[0] * f, p[1]]);
  e.profile[e.profile.length - 1][0] = 4 * e.L + 2 * Math.PI * e.R;
  e.profile[0][0] = 0;
  return true;
}

// ---------- Terrain ----------
export function addBlob(map, biome, x, z, sx = 8, sz = 8, w = 1) {
  if (!BIOMES.includes(biome)) return '!Unknown terrain kind.';
  const list = map.terrain.biomes[biome];
  if (list.length >= 16) return '!Too many ' + biome + ' areas (16 at most).';
  list.push({ x: r2(x), z: r2(z), sx: r2(clamp(sx, 1, 80)), sz: r2(clamp(sz, 1, 80)), w: r2(clamp(w, 0.1, 2)) });
  return list.length - 1;
}
// Removing the last blob of a kind sets its strength to zero instead (the file format needs at least one).
export function removeBlobNear(map, x, z) {
  let best = null, bd = 1e9;
  BIOMES.forEach(k => map.terrain.biomes[k].forEach((b, i) => {
    if (b.w <= 0) return;
    const d = Math.hypot((x - b.x) / b.sx, (z - b.z) / b.sz);
    if (d < bd) { bd = d; best = { k, i }; }
  }));
  if (!best || bd > 1.6) return '!No terrain area here.';
  const list = map.terrain.biomes[best.k];
  if (list.length > 1) list.splice(best.i, 1); else list[0].w = 0;
  return best.k;
}

// ---------- Buildings and shops ----------
export function groundHeightAt(map, x, z) { return createWorld(map).column(x, z, 0.25).h; }

const WALLS = [['#E8B4A0', '#B98470'], ['#D6CBE6', '#9D8DB8'], ['#F0E0A8', '#C2A55A'], ['#BFDCCB', '#86A894'], ['#E6D5AE', '#B89F79'], ['#C9D9E8', '#8DA2B5']];
const AWNINGS = ['#2E8B57', '#1E4F8A', '#B8423A', '#C98A1B'];
export function addBuilding(map, o) {
  let { x0, x1, z0, z1, h = 6, wall, trim, shop } = o;
  if (x1 < x0) [x0, x1] = [x1, x0]; if (z1 < z0) [z0, z1] = [z1, z0];
  x0 = r2(x0); x1 = r2(x1); z0 = r2(z0); z1 = r2(z1);
  if (x1 - x0 < 3 || z1 - z0 < 3) return '!A building must be at least 3 m on each side.';
  if (map.pads.length >= LIMITS.maxPads) return '!Too many buildings (' + LIMITS.maxPads + ' at most).';
  if (map.scenery.length > LIMITS.maxScenery - 4) return '!Too many items.';
  const s = map.slab;
  if (x0 < s.x0 + 1 || x1 > s.x1 - 1 || z0 < s.z0 + 1 || z1 > s.z1 - 1) return '!A building must stay inside the map area.';
  h = clamp(h, 2.5, 30);
  const n = map.scenery.filter(q => q.t === 'bldgN').length;
  if (!wall) { const c = WALLS[n % WALLS.length]; wall = c[0]; trim = c[1]; }
  trim = trim || wall;
  const id = nextId(map, shop ? 's' : 'b');
  const gy = Math.max(0, r2(groundHeightAt(map, (x0 + x1) / 2, (z0 + z1) / 2)));
  map.pads.push({ id, x0: r2(x0 - 0.3), x1: r2(x1 + 0.3), z0: r2(z0 - 0.3), z1: r2(z1 + 0.3), h: gy, m: 2 });
  const ys = []; for (let y = 1.5; y + 0.9 < h - 0.4 && ys.length < 8; y += 1.3) ys.push(r2(y));
  map.scenery.push({ t: 'bldgN', id, pad: id, zf: z0, x0, x1, depth: r2(z1 - z0), h: r2(h), wall, trim, cols: ['#7FA5C7', '#F5D77A', '#7FA5C7'], ys: ys.length ? ys : [1.5], ww: 0.8, pitch: 1.3 });
  if (shop) {
    const col = AWNINGS[n % AWNINGS.length];
    map.scenery.push({ t: 'prims', of: id, p: [['B', r2(x0 + 0.3), { pad: id, add: 2.5 }, r2(z0 - 0.9), r2(x1 - 0.3), { pad: id, add: 2.8 }, z0, col, 0.03]], solids: [] });
    ensureFeatures(map).shops.push({ id, name: String(shop.name || 'Shop').slice(0, 40), x0, x1, z0, z1 });
  }
  return id;
}

export function addTree(map, x, z, h = 4, r = 1.5) {
  if (map.scenery.length >= LIMITS.maxScenery) return '!Too many items.';
  const id = nextId(map, 't');
  map.scenery.push({ t: 'tree', id, x: r2(x), z: r2(z), h: r2(clamp(h, 1, 20)), r: r2(clamp(r, 0.5, 8)) });
  return id;
}
// A street lamp; e = -1 leans toward -z, e = 1 toward +z (the arm over the road).
export function addLamp(map, x, z, e = 1) {
  if (map.scenery.length >= LIMITS.maxScenery) return '!Too many items.';
  const id = nextId(map, 'l');
  map.scenery.push({ t: 'lamp', id, x: r2(x), z: r2(z), e: e < 0 ? -1 : 1, y0: r2(Math.max(0, groundHeightAt(map, x, z)) + 0.05) });
  return id;
}

// ---------- Features the game will use in later phases ----------
export function addSignal(map, x, z, psi = 0, kind = 'light') {
  const f = ensureFeatures(map);
  if (f.signals.length >= 64) return '!Too many signals.';
  const id = nextId(map, 'g'); f.signals.push({ id, kind: kind === 'police' ? 'police' : 'light', x: r2(x), z: r2(z), psi: r2(psi) }); return id;
}
export function addCrossing(map, x, z, psi = 0, len = 6) {
  const f = ensureFeatures(map);
  if (f.crossings.length >= 64) return '!Too many crossings.';
  const id = nextId(map, 'c'); f.crossings.push({ id, x: r2(x), z: r2(z), psi: r2(psi), len: r2(clamp(len, 2, 20)) }); return id;
}
export const SPAWN_KINDS = ['pedestrian', 'cow', 'buffalo', 'goat', 'dog', 'vehicle'];
export function addSpawnArea(map, kind, x0, z0, x1, z1, count = 3) {
  const f = ensureFeatures(map);
  if (!SPAWN_KINDS.includes(kind)) return '!Unknown spawn kind.';
  if (f.spawnAreas.length >= 32) return '!Too many spawn areas.';
  if (x1 < x0) [x0, x1] = [x1, x0]; if (z1 < z0) [z0, z1] = [z1, z0];
  if (x1 - x0 < 1 || z1 - z0 < 1) return '!Spawn area is too small.';
  const id = nextId(map, 'a'); f.spawnAreas.push({ id, kind, x0: r2(x0), z0: r2(z0), x1: r2(x1), z1: r2(z1), count: clamp(Math.round(count), 1, 30) }); return id;
}

export function setStart(map, x, z, psi) { map.start.x = r2(x); map.start.z = r2(z); map.start.psi = r2(psi); return true; }
export function setSlab(map, x0, x1, z0, z1) {
  const s = map.slab; s.x0 = Math.round(x0); s.x1 = Math.round(x1); s.z0 = Math.round(z0); s.z1 = Math.round(z1); return true;
}

// ---------- Finding and removing things ----------
// What is under a point? Returns { kind, id|edge|... } or null. Smaller things win over bigger ones.
export function hitTest(map, x, z, tol = 1.5, lines) {
  const f = map.features || {};
  lines = lines || null;
  for (const s of (f.signals || [])) if (Math.hypot(x - s.x, z - s.z) <= tol) return { kind: 'signal', id: s.id };
  for (const s of (f.crossings || [])) if (Math.hypot(x - s.x, z - s.z) <= Math.max(tol, s.len / 2)) return { kind: 'crossing', id: s.id };
  for (const s of map.scenery) {
    if ((s.t === 'tree' || s.t === 'lamp') && s.id && Math.hypot(x - s.x, z - s.z) <= tol) return { kind: s.t, id: s.id };
  }
  for (const s of map.scenery) if (s.t === 'bldgN' && s.id && x >= s.x0 && x <= s.x1 && z >= s.zf && z <= s.zf + s.depth) return { kind: (f.shops || []).some(q => q.id === s.id) ? 'shop' : 'building', id: s.id };
  for (const s of (f.spawnAreas || [])) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return { kind: 'spawn', id: s.id };
  const r = nearestRoad(map, x, z, Math.max(tol, map.roads.halfWidth), lines || polylines(map));
  if (r) return { kind: 'road', edge: r.edge, t: r.t };
  return null;
}
export function removeById(map, id) {
  let did = false;
  const before = map.scenery.length;
  map.scenery = map.scenery.filter(s => s.id !== id && s.of !== id);
  if (map.scenery.length !== before) did = true;
  const padN = map.pads.length; map.pads = map.pads.filter(p => p.id !== id); if (map.pads.length !== padN) did = true;
  FEATURE_LISTS.forEach(k => { if (map.features && map.features[k]) { const n = map.features[k].length; map.features[k] = map.features[k].filter(s => s.id !== id); if (map.features[k].length !== n) did = true; } });
  return did || '!Nothing to remove.';
}

export function checkMap(map) { return validateMap(map); }

// Soft warnings: things that are legal in the file but probably not wanted.
export function warnings(map) {
  const out = [], W = createWorld(map), pav = map.roads.pavement, lines = polylines(map);
  map.scenery.forEach(s => {
    if (s.t !== 'bldgN') return;
    const corners = [[s.x0, s.zf], [s.x1, s.zf], [s.x0, s.zf + s.depth], [s.x1, s.zf + s.depth], [(s.x0 + s.x1) / 2, s.zf + s.depth / 2]];
    if (corners.some(c => W.tarmacCount(c[0], c[1]) > 0 || nearestRoad(map, c[0], c[1], pav, lines))) out.push('Building ' + s.id + ' touches a road.');
  });
  const st = map.start;
  if (!nearestRoad(map, st.x, st.z, map.roads.halfWidth, lines)) out.push('The start is not on a road.');
  return out;
}

// Change a building's height (window rows are recalculated) or a shop's name.
export function setBuildingHeight(map, id, h) {
  const b = map.scenery.find(s => s.t === 'bldgN' && s.id === id); if (!b) return '!No such building.';
  h = clamp(h, 2.5, 30); b.h = r2(h);
  const ys = []; for (let y = 1.5; y + 0.9 < h - 0.4 && ys.length < 8; y += 1.3) ys.push(r2(y));
  b.ys = ys.length ? ys : [1.5];
  return true;
}
export function renameShop(map, id, name) {
  const s = ensureFeatures(map).shops.find(q => q.id === id); if (!s) return '!No such shop.';
  s.name = String(name || 'Shop').slice(0, 40) || 'Shop'; return true;
}
export function getItem(map, id) {
  const f = map.features || {};
  return map.scenery.find(s => s.id === id && s.t !== 'prims') || FEATURE_LISTS.map(k => (f[k] || []).find(s => s.id === id)).find(Boolean) || null;
}
