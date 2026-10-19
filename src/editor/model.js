// Map editing operations (Phase 4). Pure functions on a map object: no DOM, so they run in tests and in the editor.
// Every operation edits the map it is given and returns what it made (or a string starting with "!" that explains why not).
// Things the editor creates carry an "id" (b-1, t-2 ...) so they can be found and removed again; the game ignores that field.
import { sampleCurve } from '../engine/curve.js';
import { createWorld, PAINT_KINDS } from '../engine/world.js';
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
    } else if (e.type === 'curve') {
      const c = sampleCurve(e.pts);
      for (let k = 0; k < c.n; k++) pts.push([c.xs[k], c.zs[k], c.ss[k]]);
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
  return i === 0 ? 4 * e.L + 2 * Math.PI * e.R : e.type === 'curve' ? sampleCurve(e.pts).len : Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
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
  const made = junctionsFor(map, key, [[edge.a[0], edge.a[1], 0], [edge.b[0], edge.b[1], edge.profile[1][0]]], edge.profile, lines, W);
  map.roads.edges.push(edge);
  made.forEach(j => map.roads.junctions.push(j));
  return n; // index of the new road
}
const profH = (pr, t) => { if (t <= pr[0][0]) return pr[0][1]; for (let i = 1; i < pr.length; i++) if (t <= pr[i][0]) return pr[i - 1][1] + (pr[i][1] - pr[i - 1][1]) * (t - pr[i - 1][0]) / ((pr[i][0] - pr[i - 1][0]) || 1); return pr[pr.length - 1][1]; };
// Junctions where a road (given as a sampled path [x, z, distance]) crosses or ends on the other roads in `lines`.
function junctionsFor(map, key, mine, profile, lines, W, already = 0) {
  const found = [];
  lines.forEach((pts, ei) => {
    for (let a = 0; a < mine.length - 1; a++) for (let i = 0; i < pts.length - 1; i++) {
      const hit = segInter(mine[a], mine[a + 1], pts[i], pts[i + 1]);
      if (hit) found.push({ ei, x: mine[a][0] + (mine[a + 1][0] - mine[a][0]) * hit.t, z: mine[a][1] + (mine[a + 1][1] - mine[a][1]) * hit.t, tNew: mine[a][2] + (mine[a + 1][2] - mine[a][2]) * hit.t, tOld: pts[i][2] + (pts[i + 1][2] - pts[i][2]) * hit.u });
    }
    [mine[0], mine[mine.length - 1]].forEach((end, j) => {
      const nr = nearOnLine(pts, end[0], end[1]);
      if (nr.d < 0.6) found.push({ ei, x: nr.x, z: nr.z, tNew: j ? mine[mine.length - 1][2] : 0, tOld: nr.t });
    });
  });
  const made = [];
  found.forEach(f => {
    if (made.some(q => Math.hypot(q.x - f.x, q.z - f.z) < 2)) return;
    if (map.roads.junctions.length + already + made.length >= LIMITS.maxJunctions) return;
    const hOld = W.edgeH(f.ei, f.tOld), hNew = profH(profile, f.tNew);
    made.push({ x: r2(f.x), z: r2(f.z), h: r2((hOld + hNew) / 2), of: key });
  });
  return made;
}

// ---------- Curved roads (E3) ----------
// A curved road passes smoothly through 2 to 24 points. Its height profile is stretched when the shape changes so slopes keep their places.
function roadKey(map) { let k = 1; const used = new Set(map.roads.edges.map(e => e.key)); while (used.has('road-' + k)) k++; return 'road-' + k; }
export function addCurve(map, pts, h0 = 0, h1 = h0) {
  if (map.roads.edges.length >= LIMITS.maxEdges) return '!Too many roads.';
  if (pts.length < 2 || pts.length > 24) return '!A curved road needs 2 to 24 points.';
  const s = map.slab;
  for (const p of pts) if (p[0] < s.x0 || p[0] > s.x1 || p[1] < s.z0 || p[1] > s.z1) return '!A road must stay inside the map area.';
  const cp = pts.map(p => [r2(p[0]), r2(p[1])]), len = sampleCurve(cp).len;
  if (len < 4) return '!A road must be at least 4 m long.';
  const T = map.terrain;
  h0 = r2(clamp(h0, T.yMin, T.yMax)); h1 = r2(clamp(h1, T.yMin, T.yMax));
  const key = roadKey(map), n = map.roads.edges.length, edge = { key, type: 'curve', pts: cp, profile: [[0, h0], [len, h1]] };
  const made = junctionsFor(map, key, polylines({ ...map, roads: { ...map.roads, edges: [map.roads.edges[0], edge] } })[1], edge.profile, polylines(map), createWorld(map));
  map.roads.edges.push(edge);
  made.forEach(j => map.roads.junctions.push(j));
  return n;
}
function curveEdge(map, edge) { const e = map.roads.edges[edge]; return e && e.type === 'curve' ? e : null; }
function reshape(map, edge, newPts) {
  const e = curveEdge(map, edge); if (!e) return '!Not a curved road.';
  const s = map.slab;
  for (const p of newPts) if (p[0] < s.x0 || p[0] > s.x1 || p[1] < s.z0 || p[1] > s.z1) return '!A road must stay inside the map area.';
  const cp = newPts.map(p => [r2(p[0]), r2(p[1])]), len = sampleCurve(cp).len;
  if (len < 4) return '!A road must be at least 4 m long.';
  const old = e.profile[e.profile.length - 1][0], f = len / old;
  e.pts = cp;
  e.profile = e.profile.map(p => [p[0] * f, p[1]]); e.profile[0][0] = 0; e.profile[e.profile.length - 1][0] = len;
  map.roads.junctions = map.roads.junctions.filter(j => j.of !== e.key);
  const others = polylines(map).map((l, i) => (i === edge ? [] : l));
  const made = junctionsFor(map, e.key, polylines(map)[edge], e.profile, others.map(l => (l.length ? l : [[1e9, 1e9, 0], [1e9 + 1, 1e9, 1]])), createWorld(map));
  made.forEach(j => map.roads.junctions.push(j));
  return true;
}
export function moveCurvePoint(map, edge, idx, x, z) { const e = curveEdge(map, edge); if (!e || idx < 0 || idx >= e.pts.length) return '!No such point.'; const p = e.pts.map(q => q.slice()); p[idx] = [x, z]; return reshape(map, edge, p); }
export function removeCurvePoint(map, edge, idx) { const e = curveEdge(map, edge); if (!e || e.pts.length <= 2) return '!A road needs at least 2 points.'; const p = e.pts.map(q => q.slice()); p.splice(idx, 1); return reshape(map, edge, p); }
// Insert a point where you click along the road; returns its index.
export function addCurvePoint(map, edge, x, z) {
  const e = curveEdge(map, edge); if (!e) return '!Not a curved road.'; if (e.pts.length >= 24) return '!That road already has 24 points.';
  let best = 0, bd = Infinity;
  for (let i = 0; i < e.pts.length - 1; i++) { const a = e.pts[i], b = e.pts[i + 1], d = nearOnLine([[a[0], a[1], 0], [b[0], b[1], 1]], x, z).d; if (d < bd) { bd = d; best = i; } }
  const p = e.pts.map(q => q.slice()); p.splice(best + 1, 0, [x, z]);
  const r = reshape(map, edge, p); return r === true ? best + 1 : r;
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
  for (const s of map.scenery) if (s.t === 'bldgY' && s.id) { const q = toLocal(s, x, z); if (Math.abs(q[0]) <= s.w / 2 && Math.abs(q[1]) <= s.depth / 2) return { kind: (f.shops || []).some(k => k.id === s.id) ? 'shop' : 'building', id: s.id }; }
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
    let corners;
    if (s.t === 'bldgY') corners = [[-s.w / 2, -s.depth / 2], [s.w / 2, -s.depth / 2], [-s.w / 2, s.depth / 2], [s.w / 2, s.depth / 2], [0, 0]].map(q => toWorld(s, q[0], q[1]));
    else if (s.t === 'bldgN') corners = [[s.x0, s.zf], [s.x1, s.zf], [s.x0, s.zf + s.depth], [s.x1, s.zf + s.depth], [(s.x0 + s.x1) / 2, s.zf + s.depth / 2]];
    else return;
    if (corners.some(c => W.tarmacCount(c[0], c[1]) > 0 || nearestRoad(map, c[0], c[1], pav, lines))) out.push('Building ' + s.id + ' touches a road.');
  });
  const st = map.start;
  if (!nearestRoad(map, st.x, st.z, map.roads.halfWidth, lines)) out.push('The start is not on a road.');
  return out;
}

// Change a building's height (window rows are recalculated) or a shop's name.
export function setBuildingHeight(map, id, h) {
  const b = map.scenery.find(s => (s.t === 'bldgN' || s.t === 'bldgY') && s.id === id); if (!b) return '!No such building.';
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

// ---------- Turned buildings (E1) ----------
// A turned building (bldgY) has a centre, a width along its front face, a depth and a yaw in degrees. Yaw 0 puts the front face toward -z.
// Local x runs along the front face, local z away from it; world = centre + local turned by yaw.
const rad = d => d * Math.PI / 180;
export function toWorld(b, lx, lz) { const a = rad(b.yaw || 0), c = Math.cos(a), s = Math.sin(a); return [b.cx + lx * c + lz * s, b.cz - lx * s + lz * c]; }
export function toLocal(b, x, z) { const a = rad(b.yaw || 0), c = Math.cos(a), s = Math.sin(a), dx = x - b.cx, dz = z - b.cz; return [dx * c - dz * s, dx * s + dz * c]; }
function footprintBox(b) {
  const q = [[-b.w / 2, -b.depth / 2], [b.w / 2, -b.depth / 2], [-b.w / 2, b.depth / 2], [b.w / 2, b.depth / 2]].map(p => toWorld(b, p[0], p[1]));
  return { x0: r2(Math.min(...q.map(p => p[0]))), x1: r2(Math.max(...q.map(p => p[0]))), z0: r2(Math.min(...q.map(p => p[1]))), z1: r2(Math.max(...q.map(p => p[1]))) };
}
function refreshShop(map, b) { const sh = ensureFeatures(map).shops.find(q => q.id === b.id); if (sh) Object.assign(sh, footprintBox(b)); }
function awningOf(map, id) { return map.scenery.find(q => q.t === 'prims' && q.of === id); }

export function addBuildingY(map, o) {
  let { cx, cz, w = 8, depth = 6, h = 6, yaw = 0, wall, trim, shop } = o;
  cx = r2(cx); cz = r2(cz); w = r2(w); depth = r2(depth); yaw = r2(((yaw % 360) + 540) % 360 - 180);
  if (w < 3 || depth < 3) return '!A building must be at least 3 m on each side.';
  if (map.pads.length >= LIMITS.maxPads) return '!Too many buildings (' + LIMITS.maxPads + ' at most).';
  if (map.scenery.length > LIMITS.maxScenery - 4) return '!Too many items.';
  const tmp = { cx, cz, w, depth, yaw }, fb = footprintBox(tmp), sl = map.slab;
  if (fb.x0 < sl.x0 + 1 || fb.x1 > sl.x1 - 1 || fb.z0 < sl.z0 + 1 || fb.z1 > sl.z1 - 1) return '!A building must stay inside the map area.';
  h = clamp(h, 2.5, 30);
  const n = map.scenery.filter(q => q.t === 'bldgN' || q.t === 'bldgY').length;
  if (!wall) { const c = WALLS[n % WALLS.length]; wall = c[0]; trim = c[1]; }
  trim = trim || wall;
  const id = nextId(map, shop ? 's' : 'b');
  const gy = Math.max(0, r2(groundHeightAt(map, cx, cz)));
  map.pads.push({ id, x0: r2(cx - w / 2 - 0.3), x1: r2(cx + w / 2 + 0.3), z0: r2(cz - depth / 2 - 0.3), z1: r2(cz + depth / 2 + 0.3), h: gy, m: 2, yaw });
  const ys = []; for (let y = 1.5; y + 0.9 < h - 0.4 && ys.length < 8; y += 1.3) ys.push(r2(y));
  const b = { t: 'bldgY', id, pad: id, cx, cz, w, depth, h: r2(h), yaw, wall, trim, cols: ['#7FA5C7', '#F5D77A', '#7FA5C7'], ys: ys.length ? ys : [1.5], ww: 0.8, pitch: 1.3 };
  map.scenery.push(b);
  if (shop) {
    const col = AWNINGS[n % AWNINGS.length], q = toWorld(b, 0, -depth / 2 - 0.4);
    map.scenery.push({ t: 'prims', of: id, p: [['OB', r2(q[0]), r2(q[1]), r2(w / 2 - 0.3), 0.45, yaw, { pad: id, add: 2.5 }, { pad: id, add: 2.8 }, col, 0.03]], solids: [] });
    ensureFeatures(map).shops.push(Object.assign({ id, name: String(shop.name || 'Shop').slice(0, 40) }, footprintBox(b)));
  }
  return id;
}

// An old axis-aligned building becomes a turned one at yaw 0 (it draws the same). Returns the bldgY item.
export function toTurnable(map, id) {
  const i = map.scenery.findIndex(s => (s.t === 'bldgN' || s.t === 'bldgY') && s.id === id);
  if (i < 0) return '!No such building.';
  const b = map.scenery[i];
  if (b.t === 'bldgY') return b;
  const y = { t: 'bldgY', id: b.id, pad: b.pad, cx: r2((b.x0 + b.x1) / 2), cz: r2(b.zf + b.depth / 2), w: r2(b.x1 - b.x0), depth: b.depth, h: b.h, yaw: 0, wall: b.wall, trim: b.trim, cols: b.cols, ys: b.ys, ww: b.ww, pitch: b.pitch };
  map.scenery[i] = y;
  const aw = awningOf(map, id);
  aw && aw.p.forEach((q, k) => { if (q[0] === 'B') aw.p[k] = ['OB', r2((q[1] + q[4]) / 2), r2((q[3] + q[6]) / 2), r2((q[4] - q[1]) / 2), r2((q[6] - q[3]) / 2), 0, q[2], q[5], q[7], q[8]]; });
  return y;
}
// Turn a building to an absolute yaw (degrees). The pad, the awning and the shop box turn with it.
export function turnBuilding(map, id, yaw) {
  const b = toTurnable(map, id); if (typeof b === 'string') return b;
  yaw = r2(((yaw % 360) + 540) % 360 - 180);
  const aw = awningOf(map, id), old = { cx: b.cx, cz: b.cz, yaw: b.yaw || 0 };
  b.yaw = yaw;
  if (aw) aw.p.forEach(q => { if (q[0] === 'OB') { const l = toLocal(old, q[1], q[2]), w = toWorld(b, l[0], l[1]); q[1] = r2(w[0]); q[2] = r2(w[1]); q[5] = yaw; } });
  const pad = map.pads.find(p => p.id === id); if (pad) pad.yaw = yaw;
  refreshShop(map, b);
  return yaw;
}
export function moveBuilding(map, id, cx, cz) {
  const b = toTurnable(map, id); if (typeof b === 'string') return b;
  const dx = r2(cx) - b.cx, dz = r2(cz) - b.cz;
  b.cx = r2(cx); b.cz = r2(cz);
  const pad = map.pads.find(p => p.id === id); if (pad) { pad.x0 = r2(pad.x0 + dx); pad.x1 = r2(pad.x1 + dx); pad.z0 = r2(pad.z0 + dz); pad.z1 = r2(pad.z1 + dz); pad.h = Math.max(0, r2(groundHeightAt(map, b.cx, b.cz))); }
  const aw = awningOf(map, id); aw && aw.p.forEach(q => { if (q[0] === 'OB') { q[1] = r2(q[1] + dx); q[2] = r2(q[2] + dz); } });
  refreshShop(map, b);
  return true;
}
// The yaw that makes a building's front face look at the nearest road, and how far the front is from that road's edge.
export function faceRoadYaw(map, id, lines) {
  const b = map.scenery.find(s => (s.t === 'bldgN' || s.t === 'bldgY') && s.id === id); if (!b) return '!No such building.';
  const cx = b.t === 'bldgY' ? b.cx : (b.x0 + b.x1) / 2, cz = b.t === 'bldgY' ? b.cz : b.zf + b.depth / 2;
  const r = nearestRoad(map, cx, cz, 1e4, lines || polylines(map)); if (!r) return '!No road to face.';
  const dx = r.x - cx, dz = r.z - cz;
  return { yaw: r2(Math.atan2(-dx, -dz) * 180 / Math.PI), dist: r2(Math.hypot(dx, dz)), x: r.x, z: r.z };
}
export function faceRoad(map, id, lines) { const f = faceRoadYaw(map, id, lines); return typeof f === 'string' ? f : turnBuilding(map, id, f.yaw); }

// ---------- Ground layers (E2): sculpt (1 m lattice, centimetres) and paint (0.5 m lattice, code into PAINT_KINDS) ----------
export { PAINT_KINDS };
const lk = (i, j) => i + ',' + j;
function openLayer(map, name) {
  if (!map.layers) map.layers = {};
  if (!map.layers[name]) map.layers[name] = { cell: name === 'sculpt' ? 1 : 0.5, cells: [] };
  const L = map.layers[name], m = new Map();
  L.cells.forEach(c => m.set(lk(c[0], c[1]), c[2]));
  return { L, m };
}
function closeLayer(map, name, L, m, max) {
  const cells = [];
  m.forEach((v, k) => { if (v !== 0 || name === 'paint') { const [i, j] = k.split(',').map(Number); cells.push([i, j, v]); } });
  if (cells.length > max) return '!That is more hand-shaped ground than a map can hold (' + max + ' cells). Clear some first.';
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  L.cells = cells;
  if (!cells.length) { delete map.layers[name]; if (!Object.keys(map.layers).length) delete map.layers; }
  return true;
}
const inSlab = (map, x, z) => x >= map.slab.x0 && x <= map.slab.x1 && z >= map.slab.z0 && z <= map.slab.z1;
const fall = (d, r, soft) => { if (d <= r) return 1; if (d >= r + soft) return 0; const t = 1 - (d - r) / soft; return t * t * (3 - 2 * t); };

// Raise or lower ground under a round brush; amount is metres per stroke at the centre. 'smooth' relaxes toward the neighbours.
export function sculptBrush(map, x, z, radius, amount, mode = 'raise') {
  radius = clamp(radius, 1, 30);
  const { L, m } = openLayer(map, 'sculpt');
  const i0 = Math.floor(x - radius), i1 = Math.ceil(x + radius), j0 = Math.floor(z - radius), j1 = Math.ceil(z + radius);
  const upd = new Map();
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const d = Math.hypot(i - x, j - z); if (d > radius || !inSlab(map, i, j)) continue;
    const w = fall(d, 0, radius), cur = m.get(lk(i, j)) || 0;
    let v = cur;
    if (mode === 'raise') v = cur + amount * 100 * w;
    else if (mode === 'lower') v = cur - amount * 100 * w;
    else if (mode === 'smooth') { let sum = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) sum += m.get(lk(i + a, j + b)) || 0; v = cur + (sum / 8 - cur) * Math.min(1, 0.6 * w); }
    else return '!Unknown sculpt mode.';
    upd.set(lk(i, j), clamp(Math.round(v), -3000, 3000));
  }
  upd.forEach((v, k) => m.set(k, v));
  return closeLayer(map, 'sculpt', L, m, LIMITS.maxSculpt);
}
// Bring the ground under a round patch to an exact height (a flat plot or a ramp's end), fading out over `soft` metres.
export function gradeTo(map, x, z, radius, level, soft = 3) {
  radius = clamp(radius, 1, 40); soft = clamp(soft, 0.5, 20);
  const W = createWorld(map), { L, m } = openLayer(map, 'sculpt'), R = radius + soft;
  const upd = new Map();
  for (let i = Math.floor(x - R); i <= Math.ceil(x + R); i++) for (let j = Math.floor(z - R); j <= Math.ceil(z + R); j++) {
    const d = Math.hypot(i - x, j - z); if (d > R || !inSlab(map, i, j)) continue;
    const cur = m.get(lk(i, j)) || 0, c = W.column(i, j, 0.25);
    if (c.tarmac || c.kind === 5) continue;                        // never reshape tarmac or kerb
    const base = c.h - cur / 100, w = fall(d, radius, soft);
    upd.set(lk(i, j), clamp(Math.round((cur / 100 + (level - base - cur / 100) * w) * 100), -3000, 3000));
  }
  upd.forEach((v, k) => m.set(k, v));
  return closeLayer(map, 'sculpt', L, m, LIMITS.maxSculpt);
}
// Paint a surface (one of PAINT_KINDS) or 'erase' it back to what the terrain would be.
export function paintBrush(map, x, z, radius, kind) {
  radius = clamp(radius, 0.5, 30);
  const code = PAINT_KINDS.indexOf(kind);
  if (code < 0 && kind !== 'erase') return '!Unknown surface "' + kind + '".';
  const { L, m } = openLayer(map, 'paint');
  for (let i = Math.floor((x - radius) * 2); i <= Math.floor((x + radius) * 2); i++) for (let j = Math.floor((z - radius) * 2); j <= Math.floor((z + radius) * 2); j++) {
    const cx = (i + 0.5) / 2, cz = (j + 0.5) / 2;
    if (Math.hypot(cx - x, cz - z) > radius || !inSlab(map, cx, cz)) continue;
    if (kind === 'erase') m.delete(lk(i, j)); else m.set(lk(i, j), code);
  }
  return closeLayer(map, 'paint', L, m, LIMITS.maxPaint);
}
export function clearLayers(map, which) {
  if (!map.layers) return false;
  if (which) delete map.layers[which]; else map.layers = {};
  if (!Object.keys(map.layers).length) delete map.layers;
  return true;
}

// ---------- Moving and aligning things (E5) ----------
// Move any placed thing so its centre is at (x, z). Buildings take their pad, awning and shop box along; lamps and trees re-seat on the ground.
export function moveItem(map, id, x, z) {
  x = r2(x); z = r2(z);
  const b = map.scenery.find(s => s.id === id && (s.t === 'bldgN' || s.t === 'bldgY'));
  if (b) return moveBuilding(map, id, x, z);
  const t = map.scenery.find(s => s.id === id && (s.t === 'tree' || s.t === 'lamp'));
  if (t) { t.x = x; t.z = z; if (t.t === 'lamp') t.y0 = r2(Math.max(0, groundHeightAt(map, x, z)) + 0.05); return true; }
  const f = ensureFeatures(map);
  const g = f.signals.find(s => s.id === id) || f.crossings.find(s => s.id === id);
  if (g) { g.x = x; g.z = z; return true; }
  const a = f.spawnAreas.find(s => s.id === id);
  if (a) { const dx = x - (a.x0 + a.x1) / 2, dz = z - (a.z0 + a.z1) / 2; a.x0 = r2(a.x0 + dx); a.x1 = r2(a.x1 + dx); a.z0 = r2(a.z0 + dz); a.z1 = r2(a.z1 + dz); return true; }
  return '!Nothing to move.';
}
// Signals and crossings turn about their own centre (psi in radians, same as in the file).
export function turnFeature(map, id, psi) {
  const f = ensureFeatures(map), g = f.signals.find(s => s.id === id) || f.crossings.find(s => s.id === id);
  if (!g) return '!Nothing to turn.'; g.psi = r2(psi); return true;
}
// How far the front of a building is from the nearest road's pavement edge, measured straight toward the road from the front-face centre.
export function setbackOf(map, id, lines) {
  const b = map.scenery.find(s => (s.t === 'bldgN' || s.t === 'bldgY') && s.id === id); if (!b) return null;
  const y = b.t === 'bldgY' ? b : toTurnableCopy(b);
  const fc = toWorld(y, 0, -y.depth / 2), r = nearestRoad(map, fc[0], fc[1], 1e4, lines || polylines(map));
  if (!r) return null;
  return { dist: r2(Math.max(0, r.d - map.roads.pavement)), fx: fc[0], fz: fc[1], rx: r.x, rz: r.z, edge: r.edge };
}
function toTurnableCopy(b) { return { cx: (b.x0 + b.x1) / 2, cz: b.zf + b.depth / 2, w: b.x1 - b.x0, depth: b.depth, yaw: 0 }; }
// Put a building's front at an exact distance from the road's pavement edge, keeping its turn (slides it along the line to the road).
export function setSetback(map, id, metres) {
  const sb = setbackOf(map, id); if (!sb) return '!No road near.';
  const b = toTurnable(map, id); if (typeof b === 'string') return b;
  const fc = toWorld(b, 0, -b.depth / 2), dx = sb.rx - fc[0], dz = sb.rz - fc[1], d = Math.hypot(dx, dz) || 1;
  const want = map.roads.pavement + Math.max(0, metres), move = d - want;       // positive: toward the road
  return moveBuilding(map, id, b.cx + dx / d * move, b.cz + dz / d * move);
}

// ---------- Frontage: a row of buildings along a road (E6) ----------
// Stands buildings side by side along one side of a road, each turned to face it, each its own `setback` metres from the pavement edge.
// STYLES gives width, depth and height per style (the editor passes its tray styles). Returns how many were placed.
export function frontage(map, o) {
  const { edge, side = 1, style, setback = 2, gap = 1, t0 = 0, t1 = null, wall, trim, shop } = o;
  const e = map.roads.edges[edge]; if (!e) return '!No such road.';
  const W = createWorld(map), len = W.edgeLen(edge), pav = map.roads.pavement, s = side < 0 ? -1 : 1;
  const w = style.w, d = style.d, end = Math.min(len, t1 == null ? len : t1);
  let placed = 0, t = Math.max(0, t0) + 1;
  const lines = polylines(map);
  const made = [];
  while (t + w <= end - 1) {
    if (map.pads.length >= LIMITS.maxPads) break;
    const tc = t + w / 2, off = s * (pav + Math.max(0, setback) + d / 2), p = W.edgePoint(edge, tc, off), r = W.edgePoint(edge, tc, 0);
    const dx = r.x - p.x, dz = r.z - p.z, yaw = r2(Math.atan2(-dx, -dz) * 180 / Math.PI);
    const cand = { cx: p.x, cz: p.z, w, depth: d, yaw };
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]].map(q => toWorld(cand, q[0], q[1]));
    // skip a plot that would land on another road, on another building, or outside the map
    const blocked = corners.some(c => nearestRoad(map, c[0], c[1], pav + 0.2, lines) !== null) || corners.some(c => c[0] < map.slab.x0 + 1 || c[0] > map.slab.x1 - 1 || c[1] < map.slab.z0 + 1 || c[1] > map.slab.z1 - 1);
    const clash = made.some(q => Math.hypot(q.cx - p.x, q.cz - p.z) < (Math.max(q.w, q.depth) + Math.max(w, d)) / 2 - 0.5) ||
      map.scenery.some(q => (q.t === 'bldgY' && Math.hypot(q.cx - p.x, q.cz - p.z) < (Math.max(q.w, q.depth) + Math.max(w, d)) / 2 - 0.5) || (q.t === 'bldgN' && Math.hypot((q.x0 + q.x1) / 2 - p.x, q.zf + q.depth / 2 - p.z) < (Math.max(q.x1 - q.x0, q.depth) + Math.max(w, d)) / 2 - 0.5));
    if (!blocked && !clash) {
      const id = addBuildingY(map, { cx: p.x, cz: p.z, w, depth: d, h: style.h, yaw, wall: wall || style.wall, trim: trim || style.trim, shop: shop || null });
      if (typeof id === 'string' && !id.startsWith('!')) { made.push({ cx: p.x, cz: p.z, w, depth: d }); placed++; }
    }
    t += w + Math.max(0, gap);
  }
  return placed;
}

// ---------- Copies ----------
// A copy of any placed thing, centred at (x, z). Returns the new id.
export function duplicateItem(map, id, x, z) {
  const b = map.scenery.find(s => s.id === id && (s.t === 'bldgN' || s.t === 'bldgY'));
  if (b) {
    const y = b.t === 'bldgY' ? b : { w: b.x1 - b.x0, depth: b.depth, h: b.h, yaw: 0, wall: b.wall, trim: b.trim };
    const sh = ensureFeatures(map).shops.find(q => q.id === id);
    const nid = addBuildingY(map, { cx: x, cz: z, w: y.w, depth: y.depth, h: y.h, yaw: y.yaw || 0, wall: y.wall, trim: y.trim, shop: sh ? { name: sh.name } : null });
    if (typeof nid === 'string' && !nid.startsWith('!')) { const nb = map.scenery.find(s => s.id === nid); if (nb) { nb.cols = b.cols.slice(); nb.ys = b.ys.slice(); nb.ww = b.ww; nb.pitch = b.pitch; } }
    return nid;
  }
  const t = map.scenery.find(s => s.id === id && s.t === 'tree'); if (t) return addTree(map, x, z, t.h, t.r);
  const l = map.scenery.find(s => s.id === id && s.t === 'lamp'); if (l) return addLamp(map, x, z, l.e);
  const f = ensureFeatures(map);
  const g = f.signals.find(s => s.id === id); if (g) return addSignal(map, x, z, g.psi, g.kind);
  const c = f.crossings.find(s => s.id === id); if (c) return addCrossing(map, x, z, c.psi, c.len);
  const a = f.spawnAreas.find(s => s.id === id);
  if (a) { const hw = (a.x1 - a.x0) / 2, hd = (a.z1 - a.z0) / 2; return addSpawnArea(map, a.kind, x - hw, z - hd, x + hw, z + hd, a.count); }
  return '!Nothing to copy.';
}

// Where to put the car for a test drive from a clicked point: on the road if one is close, otherwise right there facing along the nearest road.
export function dropPoint(map, x, z, lines) {
  lines = lines || polylines(map);
  const W = createWorld(map), r = nearestRoad(map, x, z, 1e4, lines);
  if (!r) return { x: r2(x), z: r2(z), psi: 0 };
  const psi = W.edgePoint(r.edge, r.t, 0).psi;
  if (r.d <= map.roads.halfWidth + 1.5) return { x: r2(r.x), z: r2(r.z), psi: r2(psi) };
  return { x: r2(x), z: r2(z), psi: r2(psi) };
}


// ---------- A map that grows with what you put in it (N1) ----------
export const SLAB_STEP = 12, SLAB_MARGIN = 24;
// Make the ground reach at least `margin` metres past every point, in whole 12 m steps. Never shrinks. Returns true if it grew, false if not, or '!message'.
export function growSlab(map, pts, margin = SLAB_MARGIN) {
  const s = map.slab; let { x0, x1, z0, z1 } = s;
  for (const p of pts) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (p[0] - margin < x0) x0 = Math.floor((p[0] - margin) / SLAB_STEP) * SLAB_STEP;
    if (p[0] + margin > x1) x1 = Math.ceil((p[0] + margin) / SLAB_STEP) * SLAB_STEP;
    if (p[1] - margin < z0) z0 = Math.floor((p[1] - margin) / SLAB_STEP) * SLAB_STEP;
    if (p[1] + margin > z1) z1 = Math.ceil((p[1] + margin) / SLAB_STEP) * SLAB_STEP;
  }
  if (x0 === s.x0 && x1 === s.x1 && z0 === s.z0 && z1 === s.z1) return false;
  if (x1 - x0 > LIMITS.slabMax || z1 - z0 > LIMITS.slabMax) return '!The map can be at most ' + LIMITS.slabMax + ' m on each side.';
  s.x0 = x0; s.x1 = x1; s.z0 = z0; s.z1 = z1; return true;
}
// Every point that belongs to the map's contents, for "Fit map to content".
export function contentPoints(map) {
  const out = [], f = ensureFeatures(map);
  polylines(map).forEach(l => l.forEach(p => out.push([p[0], p[1]])));
  map.scenery.forEach(s => {
    if (s.t === 'bldgN') out.push([s.x0, s.zf], [s.x1, s.zf + s.depth]);
    else if (s.t === 'bldgY') { const r = Math.hypot(s.w, s.depth) / 2; out.push([s.cx - r, s.cz - r], [s.cx + r, s.cz + r]); }
    else if (Number.isFinite(s.x) && Number.isFinite(s.z)) out.push([s.x, s.z]);
  });
  ['signals', 'crossings'].forEach(k => (f[k] || []).forEach(a => out.push([a.x, a.z])));
  (f.spawnAreas || []).forEach(a => out.push([a.x0, a.z0], [a.x1, a.z1]));
  Object.values(map.terrain.biomes).forEach(l => l.forEach(b => { if (b.w > 0) out.push([b.x - b.sx, b.z - b.sz], [b.x + b.sx, b.z + b.sz]); }));
  out.push([map.start.x, map.start.z]);
  return out;
}
// Resize the ground to the contents plus a margin (can shrink or grow). Refused if hand-made ground would fall outside.
export function fitSlab(map, margin = SLAB_MARGIN) {
  const pts = contentPoints(map);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); });
  x0 = Math.floor((x0 - margin) / SLAB_STEP) * SLAB_STEP; x1 = Math.ceil((x1 + margin) / SLAB_STEP) * SLAB_STEP;
  z0 = Math.floor((z0 - margin) / SLAB_STEP) * SLAB_STEP; z1 = Math.ceil((z1 + margin) / SLAB_STEP) * SLAB_STEP;
  const minSide = 48;
  if (x1 - x0 < minSide) { const c = (x0 + x1) / 2; x0 = c - minSide / 2; x1 = c + minSide / 2; }
  if (z1 - z0 < minSide) { const c = (z0 + z1) / 2; z0 = c - minSide / 2; z1 = c + minSide / 2; }
  if (x1 - x0 > LIMITS.slabMax || z1 - z0 > LIMITS.slabMax) return '!Your things spread over more than ' + LIMITS.slabMax + ' m.';
  const old = Object.assign({}, map.slab);
  map.slab.x0 = x0; map.slab.x1 = x1; map.slab.z0 = z0; map.slab.z1 = z1;
  const r = validateMap(map);
  if (!r.ok) { Object.assign(map.slab, old); return '!Some hand-made ground would fall outside, so the map was left as it is.'; }
  return true;
}
