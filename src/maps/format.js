// Map file format v1 ("hill-loop-map"): what a map JSON must contain, and a validator that explains what is wrong.
// Maps are data, never code. The validator is the only door: nothing that fails it reaches the game.
import { sampleCurve } from '../engine/curve.js';
export const FORMAT = 'hill-loop-map';
export const VERSION = 1;
// Limits protect phones from files that would build far too much.
export const LIMITS = { maxBytes: 2000000, slabMin: 20, slabMax: 400, maxEdges: 64, maxPads: 64, maxJunctions: 64, maxPotholes: 600, maxTraffic: 12, maxSignals: 64, maxCrossings: 64, maxSpawnAreas: 32, maxShops: 64, maxScenery: 4000, maxPrims: 20000, maxSculpt: 60000, maxPaint: 80000 };
export const TRAFFIC_KEYS = ['nBike', 'nAuto'];
export const SPAWN_KINDS = ['pedestrian', 'cow', 'buffalo', 'goat', 'dog', 'vehicle'];
export const SCENERY_TYPES = ['prims', 'windows', 'tree', 'lamp', 'bldgN', 'bldgY', 'guardposts', 'cones', 'scatter'];
const PRIM_ARITY = { B: 9, PT: 8, C: 9, S: 7, OB: 10, OPT: 9 };   // tag + fields

export function validateMap(m) {
  const errors = [];
  const err = (path, msg) => { if (errors.length < 40) errors.push({ path, msg }); };
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const num = (p, v, lo = -1e6, hi = 1e6) => { if (!fin(v)) err(p, 'must be a number'); else if (v < lo || v > hi) err(p, 'must be between ' + lo + ' and ' + hi); return fin(v); };
  const arr = (p, v, min = 0, max = 1e9) => { if (!Array.isArray(v)) { err(p, 'must be a list'); return false; } if (v.length < min || v.length > max) { err(p, 'must have ' + (min === max ? min : 'between ' + min + ' and ' + max) + ' entries'); return false; } return true; };
  const colour = (p, v) => { if (!(typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xFFFFFF) && !(typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v))) err(p, 'must be a colour like "#E6D5AE"'); };

  if (!isObj(m)) return { ok: false, errors: [{ path: '', msg: 'This is not a map file.' }] };
  if (m.format !== FORMAT) return { ok: false, errors: [{ path: 'format', msg: 'This file is not a Hill Loop map (format must be "' + FORMAT + '").' }] };
  if (m.version !== VERSION) return { ok: false, errors: [{ path: 'version', msg: m.version > VERSION ? 'This map was made by a newer version of the game.' : 'Unsupported map version ' + m.version + '.' }] };

  // meta
  const meta = m.meta;
  if (!isObj(meta)) err('meta', 'is missing');
  else {
    if (typeof meta.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(meta.id)) err('meta.id', 'must be 1 to 40 lowercase letters, digits or dashes');
    if (typeof meta.name !== 'string' || !meta.name.trim() || meta.name.length > 60) err('meta.name', 'must be a name of up to 60 characters');
  }

  // slab and ground
  const sl = m.slab;
  if (!isObj(sl)) err('slab', 'is missing');
  else {
    ['x0', 'x1', 'z0', 'z1'].forEach(k => num('slab.' + k, sl[k], -5000, 5000));
    if (fin(sl.x0) && fin(sl.x1) && fin(sl.z0) && fin(sl.z1)) {
      const w = sl.x1 - sl.x0, d = sl.z1 - sl.z0;
      if (w < LIMITS.slabMin || d < LIMITS.slabMin) err('slab', 'must be at least ' + LIMITS.slabMin + ' m on each side');
      if (w > LIMITS.slabMax || d > LIMITS.slabMax) err('slab', 'must be at most ' + LIMITS.slabMax + ' m on each side (memory limit)');
    }
  }
  if (!isObj(m.ground)) err('ground', 'is missing'); else { num('ground.layer', m.ground.layer, 0.05, 2); num('ground.chunk', m.ground.chunk, 4, 32); }

  // terrain
  const T = m.terrain;
  if (!isObj(T)) err('terrain', 'is missing');
  else {
    ['waterLevel', 'yMin', 'yMax', 'blend', 'lakeMin', 'rockMin', 'rock2At', 'scrubMin', 'laterAt'].forEach(k => num('terrain.' + k, T[k], -100, 100));
    if (fin(T.yMin) && fin(T.yMax) && T.yMin >= T.yMax) err('terrain.yMin', 'must be below yMax');
    if (!isObj(T.noise)) err('terrain.noise', 'is missing'); else ['s1', 's2', 's3'].forEach(k => num('terrain.noise.' + k, T.noise[k], 0.5, 200));
    if (!isObj(T.relief)) err('terrain.relief', 'is missing');
    else {
      ['hills', 'rock'].forEach(k => { if (arr('terrain.relief.' + k, T.relief[k], 3, 3)) T.relief[k].forEach((v, i) => num('terrain.relief.' + k + '[' + i + ']', v, -50, 50)); });
      num('terrain.relief.scrub', T.relief.scrub, -50, 50); num('terrain.relief.lake', T.relief.lake, -50, 50);
    }
    if (!isObj(T.biomes)) err('terrain.biomes', 'is missing');
    else ['hills', 'rock', 'scrub', 'lake'].forEach(k => {
      if (arr('terrain.biomes.' + k, T.biomes[k], 1, 16)) T.biomes[k].forEach((b, i) => {
        if (!isObj(b)) return err('terrain.biomes.' + k + '[' + i + ']', 'must be an object');
        ['x', 'z'].forEach(q => num('terrain.biomes.' + k + '[' + i + '].' + q, b[q], -5000, 5000));
        ['sx', 'sz'].forEach(q => num('terrain.biomes.' + k + '[' + i + '].' + q, b[q], 0.5, 500));
        num('terrain.biomes.' + k + '[' + i + '].w', b.w, 0, 10);
      });
    });
  }

  // roads
  const R = m.roads;
  let edgeCount = 0;
  const profile = (p, pts, len, T0) => {
    if (!arr(p, pts, 2, 64)) return;
    let prev = -Infinity, okAll = true;
    pts.forEach((q, i) => {
      if (!arr(p + '[' + i + ']', q, 2, 2) || !fin(q[0]) || !fin(q[1])) { okAll = false; return; }
      if (q[0] <= prev) { err(p + '[' + i + ']', 'distances must increase'); okAll = false; }
      prev = q[0];
      if (T0 && fin(T0.yMin) && fin(T0.yMax) && (q[1] < T0.yMin || q[1] > T0.yMax)) err(p + '[' + i + ']', 'height is outside the map height range');
    });
    if (okAll) {
      if (pts[0][0] !== 0) err(p + '[0]', 'must start at distance 0');
      if (Math.abs(pts[pts.length - 1][0] - len) > 1e-6) err(p + '[' + (pts.length - 1) + ']', 'must end at the road length (' + len + ')');
    }
  };
  if (!isObj(R)) err('roads', 'is missing');
  else {
    num('roads.halfWidth', R.halfWidth, 0.5, 10); num('roads.pavement', R.pavement, 0.6, 20);
    if (fin(R.halfWidth) && fin(R.pavement) && R.pavement <= R.halfWidth) err('roads.pavement', 'must be wider than halfWidth');
    if (arr('roads.edgeLine', R.edgeLine, 2, 2)) R.edgeLine.forEach((v, i) => num('roads.edgeLine[' + i + ']', v, 0, 20));
    if (arr('roads.junctionRadius', R.junctionRadius, 2, 2)) R.junctionRadius.forEach((v, i) => num('roads.junctionRadius[' + i + ']', v, 0, 50));
    if (!isObj(R.dash)) err('roads.dash', 'is missing'); else ['halfWidth', 'period', 'on', 'offset'].forEach(k => num('roads.dash.' + k, R.dash[k], 0, 100));
    if (arr('roads.edges', R.edges, 1, LIMITS.maxEdges)) {
      edgeCount = R.edges.length;
      R.edges.forEach((e, i) => {
        const p = 'roads.edges[' + i + ']';
        if (!isObj(e)) return err(p, 'must be an object');
        if (i === 0) {
          if (e.type !== 'oval') return err(p + '.type', 'the first road must be the oval loop');
          num(p + '.L', e.L, 1, 500); num(p + '.R', e.R, 3, 500);
          if (fin(e.L) && fin(e.R)) profile(p + '.profile', e.profile, 4 * e.L + 2 * Math.PI * e.R, T);
        } else {
          if (e.type === 'curve') {
            if (!arr(p + '.pts', e.pts, 2, 24)) return;
            let okc = true;
            e.pts.forEach((q, j) => { if (!arr(p + '.pts[' + j + ']', q, 2, 2) || !fin(q[0]) || !fin(q[1]) || Math.abs(q[0]) > 5000 || Math.abs(q[1]) > 5000) { okc = false; err(p + '.pts[' + j + ']', 'must be [x, z] within the map'); } });
            if (okc) { const len = sampleCurve(e.pts).len; if (len < 1) err(p, 'must be at least 1 m long'); else profile(p + '.profile', e.profile, len, T); }
            return;
          }
          if (e.type !== 'line') return err(p + '.type', 'cross roads must be of type "line" or "curve"');
          let ok = true;
          ['a', 'b'].forEach(k => { if (!arr(p + '.' + k, e[k], 2, 2) || !fin(e[k][0]) || !fin(e[k][1])) ok = false; });
          if (ok) { const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]); if (len < 1) err(p, 'must be at least 1 m long'); else profile(p + '.profile', e.profile, len, T); }
        }
      });
    }
    if (arr('roads.junctions', R.junctions, 0, LIMITS.maxJunctions)) R.junctions.forEach((j, i) => { const p = 'roads.junctions[' + i + ']'; if (!isObj(j)) return err(p, 'must be an object'); ['x', 'z', 'h'].forEach(k => num(p + '.' + k, j[k], -5000, 5000)); });
  }

  // markings
  const MK = m.markings;
  if (!isObj(MK)) err('markings', 'is missing');
  else {
    if (!isObj(MK.zebra)) err('markings.zebra', 'is missing'); else ['x0', 'x1', 'u0', 'u1', 'period', 'duty'].forEach(k => num('markings.zebra.' + k, MK.zebra[k], -5000, 5000));
    if (!isObj(MK.startLine)) err('markings.startLine', 'is missing'); else ['x', 'halfWidth', 'cell'].forEach(k => num('markings.startLine.' + k, MK.startLine[k], -5000, 5000));
  }

  // pads
  const padIds = new Set();
  if (arr('pads', m.pads, 0, LIMITS.maxPads)) m.pads.forEach((q, i) => {
    const p = 'pads[' + i + ']';
    if (!isObj(q)) return err(p, 'must be an object');
    if (typeof q.id !== 'string' || !q.id) err(p + '.id', 'must be a name'); else if (padIds.has(q.id)) err(p + '.id', 'is used twice'); else padIds.add(q.id);
    ['x0', 'x1', 'z0', 'z1', 'h', 'm'].forEach(k => num(p + '.' + k, q[k], -5000, 5000));
    if (fin(q.x0) && fin(q.x1) && q.x0 >= q.x1) err(p, 'x0 must be below x1');
    if (fin(q.z0) && fin(q.z1) && q.z0 >= q.z1) err(p, 'z0 must be below z1');
    if (q.yaw !== undefined) num(p + '.yaw', q.yaw, -360, 360);
  });

  // potholes
  const PH = m.potholes;
  if (!isObj(PH)) err('potholes', 'is missing');
  else {
    num('potholes.deepAt', PH.deepAt, 0, 10);
    if (arr('potholes.exclude', PH.exclude, 0, 32)) PH.exclude.forEach((x, i) => {
      const p = 'potholes.exclude[' + i + ']';
      if (!isObj(x)) return err(p, 'must be an object');
      num(p + '.edge', x.edge, 0, Math.max(0, edgeCount - 1)); num(p + '.zMin', x.zMin, -5000, 5000);
      if (arr(p + '.x', x.x, 0, 16)) x.x.forEach((r, j) => { if (arr(p + '.x[' + j + ']', r, 2, 2)) r.forEach((v, k) => num(p + '.x[' + j + '][' + k + ']', v, -5000, 5000)); });
    });
    let total = 0;
    if (arr('potholes.clusters', PH.clusters, 0, LIMITS.maxPotholes)) PH.clusters.forEach((c, i) => {
      const p = 'potholes.clusters[' + i + ']';
      if (!isObj(c)) return err(p, 'must be an object');
      if (num(p + '.edge', c.edge, 0, Math.max(0, edgeCount - 1)) && !Number.isInteger(c.edge)) err(p + '.edge', 'must be a whole number');
      num(p + '.t', c.t, -1e4, 1e4);
      if (arr(p + '.items', c.items, 1, 16)) c.items.forEach((it, j) => {
        total++;
        if (arr(p + '.items[' + j + ']', it, 3, 3)) { num(p + '.items[' + j + '][0]', it[0], -100, 100); num(p + '.items[' + j + '][1]', it[1], -10, 10); num(p + '.items[' + j + '][2]', it[2], 0.1, 3); }
      });
    });
    if (total > LIMITS.maxPotholes) err('potholes', 'has too many potholes (limit ' + LIMITS.maxPotholes + ')');
  }

  // start and traffic
  if (!isObj(m.start)) err('start', 'is missing');
  else {
    ['x', 'z', 'psi'].forEach(k => num('start.' + k, m.start[k], -5000, 5000));
    if (isObj(sl) && fin(m.start.x) && fin(m.start.z) && (m.start.x < sl.x0 || m.start.x > sl.x1 || m.start.z < sl.z0 || m.start.z > sl.z1)) err('start', 'must be inside the map area');
  }
  if (arr('traffic', m.traffic, 0, LIMITS.maxTraffic)) m.traffic.forEach((n, i) => {
    const p = 'traffic[' + i + ']';
    if (!isObj(n)) return err(p, 'must be an object');
    if (!TRAFFIC_KEYS.includes(n.key)) err(p + '.key', 'must be one of ' + TRAFFIC_KEYS.join(', '));
    ['s', 'u', 'speed', 'r', 'ph'].forEach(k => num(p + '.' + k, n[k], -1e5, 1e5));
    if (n.dir !== 1 && n.dir !== -1) err(p + '.dir', 'must be 1 or -1');
  });

  // scenery
  let prims = 0;
  const padRef = (p, v) => { if (isObj(v)) { if (typeof v.pad !== 'string' || !padIds.has(v.pad)) err(p, 'refers to a pad that does not exist'); num(p + '.add', v.add, -100, 100); } else num(p, v, -5000, 5000); };
  if (arr('scenery', m.scenery, 0, LIMITS.maxScenery)) m.scenery.forEach((it, i) => {
    const p = 'scenery[' + i + ']';
    if (!isObj(it)) return err(p, 'must be an object');
    if (!SCENERY_TYPES.includes(it.t)) return err(p + '.t', 'unknown item type "' + it.t + '"');
    switch (it.t) {
      case 'prims':
        if (arr(p + '.p', it.p, 0, 5000)) it.p.forEach((q, j) => {
          const pp = p + '.p[' + j + ']';
          if (!Array.isArray(q) || !(q[0] in PRIM_ARITY)) return err(pp, 'must start with B, PT, C, S, OB or OPT');
          prims++;
          if (q.length !== PRIM_ARITY[q[0]]) return err(pp, q[0] + ' needs ' + (PRIM_ARITY[q[0]] - 1) + ' values after the tag');
          const colIdx = { B: 7, PT: 7, C: 7, S: 5, OB: 8, OPT: 8 }[q[0]];
          for (let k = 1; k < q.length; k++) { if (k === colIdx) colour(pp + '[' + k + ']', q[k]); else if (q[0] === 'C' && k === 1) { if (!['x', 'y', 'z'].includes(q[k])) err(pp + '[1]', 'axis must be x, y or z'); } else padRef(pp + '[' + k + ']', q[k]); }
        });
        if (arr(p + '.solids', it.solids, 0, 1000)) it.solids.forEach((q, j) => {
          const pp = p + '.solids[' + j + ']';
          if (!Array.isArray(q) || (q[0] !== 'b' && q[0] !== 'c' && q[0] !== 'o')) return err(pp, 'must start with b, c or o');
          if (q.length !== (q[0] === 'b' ? 5 : q[0] === 'o' ? 6 : 4)) return err(pp, 'has the wrong number of values');
          for (let k = 1; k < q.length; k++) num(pp + '[' + k + ']', q[k], -5000, 5000);
        });
        break;
      case 'windows':
        ['xa', 'xb', 'zf', 'wh', 'ww', 'pitch'].forEach(k => num(p + '.' + k, it[k], -5000, 5000));
        if (fin(it.pitch) && it.pitch <= 0) err(p + '.pitch', 'must be above 0');
        if (arr(p + '.ys', it.ys, 1, 16)) it.ys.forEach((v, j) => num(p + '.ys[' + j + ']', v, -100, 100));
        if (arr(p + '.cols', it.cols, 1, 16)) it.cols.forEach((v, j) => colour(p + '.cols[' + j + ']', v));
        break;
      case 'tree': ['x', 'z'].forEach(k => num(p + '.' + k, it[k], -5000, 5000)); num(p + '.h', it.h, 0.5, 60); num(p + '.r', it.r, 0.2, 20); break;
      case 'lamp': ['x', 'z'].forEach(k => num(p + '.' + k, it[k], -5000, 5000)); if (it.e !== 1 && it.e !== -1) err(p + '.e', 'must be 1 or -1'); padRef(p + '.y0', it.y0); break;
      case 'bldgN':
        if (typeof it.pad !== 'string' || !padIds.has(it.pad)) err(p + '.pad', 'refers to a pad that does not exist');
        ['zf', 'x0', 'x1', 'depth', 'h', 'ww', 'pitch'].forEach(k => num(p + '.' + k, it[k], -5000, 5000));
        if (fin(it.pitch) && it.pitch <= 0) err(p + '.pitch', 'must be above 0');
        colour(p + '.wall', it.wall); colour(p + '.trim', it.trim);
        if (arr(p + '.ys', it.ys, 1, 16)) it.ys.forEach((v, j) => num(p + '.ys[' + j + ']', v, -100, 100));
        if (arr(p + '.cols', it.cols, 1, 16)) it.cols.forEach((v, j) => colour(p + '.cols[' + j + ']', v));
        break;
      case 'bldgY':
        if (typeof it.pad !== 'string' || !padIds.has(it.pad)) err(p + '.pad', 'refers to a pad that does not exist');
        ['cx', 'cz', 'w', 'depth', 'h', 'ww', 'pitch'].forEach(k => num(p + '.' + k, it[k], -5000, 5000));
        if (fin(it.w) && it.w <= 0) err(p + '.w', 'must be above 0');
        if (fin(it.depth) && it.depth <= 0) err(p + '.depth', 'must be above 0');
        if (fin(it.pitch) && it.pitch <= 0) err(p + '.pitch', 'must be above 0');
        if (it.yaw !== undefined) num(p + '.yaw', it.yaw, -360, 360);
        colour(p + '.wall', it.wall); colour(p + '.trim', it.trim);
        if (arr(p + '.ys', it.ys, 1, 16)) it.ys.forEach((v, j) => num(p + '.ys[' + j + ']', v, -100, 100));
        if (arr(p + '.cols', it.cols, 1, 16)) it.cols.forEach((v, j) => colour(p + '.cols[' + j + ']', v));
        break;
      case 'guardposts':
        if (arr(p + '.edges', it.edges, 0, LIMITS.maxEdges)) it.edges.forEach((v, j) => num(p + '.edges[' + j + ']', v, 0, Math.max(0, edgeCount - 1)));
        ['from', 'offset', 'outer', 'minDrop'].forEach(k => num(p + '.' + k, it[k], -100, 100)); num(p + '.step', it.step, 0.5, 100);
        if (arr(p + '.colors', it.colors, 2, 2)) it.colors.forEach((v, j) => colour(p + '.colors[' + j + ']', v));
        break;
      case 'cones':
        if (arr(p + '.at', it.at, 0, 64)) it.at.forEach((c, j) => { if (arr(p + '.at[' + j + ']', c, 2, 2)) { num(p + '.at[' + j + '][0]', c[0], 0, Math.max(0, edgeCount - 1)); num(p + '.at[' + j + '][1]', c[1], -1e4, 1e4); } });
        if (arr(p + '.u', it.u, 1, 8)) it.u.forEach((v, j) => num(p + '.u[' + j + ']', v, -20, 20));
        num(p + '.back', it.back, -100, 100);
        break;
      case 'scatter': {
        ['x0', 'x1', 'z0', 'z1'].forEach(k => num(p + '.grid.' + k, it.grid && it.grid[k], -5000, 5000));
        num(p + '.grid.step', it.grid && it.grid.step, 1, 100);
        ['x0', 'x1', 'z0', 'z1'].forEach(k => num(p + '.bounds.' + k, it.bounds && it.bounds[k], -5000, 5000));
        ['jitter', 'clearRoad', 'clearPad', 'probe', 'maxSlope'].forEach(k => num(p + '.' + k, it[k], 0, 100));
        ['p', 'maxSlope', 'r0', 'rs'].forEach(k => num(p + '.boulder.' + k, it.boulder && it.boulder[k], 0, 100));
        ['p', 'h0', 'hs', 'r0', 'rs'].forEach(k => { num(p + '.grassTree.' + k, it.grassTree && it.grassTree[k], 0, 100); num(p + '.scrubTree.' + k, it.scrubTree && it.scrubTree[k], 0, 100); });
        if (it.grid && fin(it.grid.x0) && fin(it.grid.x1) && fin(it.grid.z0) && fin(it.grid.z1) && fin(it.grid.step)) {
          const cells = Math.ceil((it.grid.x1 - it.grid.x0) / it.grid.step + 1) * Math.ceil((it.grid.z1 - it.grid.z0) / it.grid.step + 1);
          if (cells > 40000) err(p + '.grid', 'covers too many cells (limit 40000)');
        }
        break;
      }
    }
  });
  // layers (optional): hand-sculpted height (1 m lattice, centimetres) and hand-painted surface (0.5 m lattice, code into PAINT_KINDS)
  if (m.layers !== undefined) {
    const Ly = m.layers;
    if (!isObj(Ly)) err('layers', 'must be an object');
    else {
      const cells = (name, max, cell, lo, hi) => {
        const L2 = Ly[name];
        if (L2 === undefined) return;
        if (!isObj(L2)) return err('layers.' + name, 'must be an object');
        if (L2.cell !== cell) err('layers.' + name + '.cell', 'must be ' + cell);
        if (!arr('layers.' + name + '.cells', L2.cells, 0, max)) return;
        for (let i = 0; i < L2.cells.length; i++) {
          const c = L2.cells[i];
          if (!Array.isArray(c) || c.length !== 3 || !c.every(Number.isInteger) || Math.abs(c[0]) > 10000 || Math.abs(c[1]) > 10000 || c[2] < lo || c[2] > hi) { err('layers.' + name + '.cells[' + i + ']', 'must be [x, z, value] whole numbers in range'); return; }
        }
      };
      cells('sculpt', LIMITS.maxSculpt, 1, -3000, 3000);
      cells('paint', LIMITS.maxPaint, 0.5, 0, 7);
    }
  }
  // features (optional): things the editor places that later versions of the game bring to life. The current game ignores them.
  if (m.features !== undefined) {
    const F = m.features;
    if (!isObj(F)) err('features', 'must be an object');
    else {
      const ids = new Set();
      const idOf = (p, o) => { if (o.id !== undefined) { if (typeof o.id !== 'string' || !o.id) err(p + '.id', 'must be a name'); else if (ids.has(o.id) && !p.startsWith('features.shops')) err(p + '.id', 'is used twice'); else ids.add(o.id); } };
      const list = (k, max, fn) => { if (F[k] === undefined) return; if (arr('features.' + k, F[k], 0, max)) F[k].forEach((o, i) => { const p = 'features.' + k + '[' + i + ']'; if (!isObj(o)) return err(p, 'must be an object'); idOf(p, o); fn(p, o); }); };
      list('signals', LIMITS.maxSignals, (p, o) => { ['x', 'z'].forEach(k => num(p + '.' + k, o[k], -5000, 5000)); num(p + '.psi', o.psi, -10, 10); if (o.kind !== 'light' && o.kind !== 'police') err(p + '.kind', 'must be light or police'); });
      list('crossings', LIMITS.maxCrossings, (p, o) => { ['x', 'z'].forEach(k => num(p + '.' + k, o[k], -5000, 5000)); num(p + '.psi', o.psi, -10, 10); num(p + '.len', o.len, 1, 40); });
      list('spawnAreas', LIMITS.maxSpawnAreas, (p, o) => {
        if (!SPAWN_KINDS.includes(o.kind)) err(p + '.kind', 'must be one of ' + SPAWN_KINDS.join(', '));
        ['x0', 'x1', 'z0', 'z1'].forEach(k => num(p + '.' + k, o[k], -5000, 5000));
        if (fin(o.x0) && fin(o.x1) && o.x0 >= o.x1) err(p, 'x0 must be below x1');
        if (fin(o.z0) && fin(o.z1) && o.z0 >= o.z1) err(p, 'z0 must be below z1');
        num(p + '.count', o.count, 1, 30);
      });
      list('shops', LIMITS.maxShops, (p, o) => {
        if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 40) err(p + '.name', 'must be a name of up to 40 characters');
        ['x0', 'x1', 'z0', 'z1'].forEach(k => num(p + '.' + k, o[k], -5000, 5000));
      });
    }
  }
  if (prims > LIMITS.maxPrims) err('scenery', 'has too many shapes (limit ' + LIMITS.maxPrims + ')');
  return { ok: errors.length === 0, errors };
}

export function describeErrors(res, max = 3) {
  return res.errors.slice(0, max).map(e => (e.path ? e.path + ' ' : '') + e.msg).join('; ') + (res.errors.length > max ? ' (and ' + (res.errors.length - max) + ' more)' : '');
}
