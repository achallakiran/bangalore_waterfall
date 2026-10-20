// ===== World model built from a map file: road network with elevation, terrain, potholes, ground builder. No DOM, no THREE. =====
// The maths is the Hill Loop world, unchanged; every number that used to be a constant now comes from the map (see src/maps/format.js).
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash3(i, j, k, s) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483629) + Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Surface kinds (fixed by the engine, not by maps)
const K = { GRASS: 0, ROAD: 1, EDGE: 2, DASH: 3, ZEBRA: 4, KERB: 5, WATER: 6, SAND: 7, CHKD: 8, CHKW: 9, PIT: 10, RIM: 11, SCRUB: 12, LATER: 13, ROCK: 14, ROCK2: 15, SOIL: 16, WALL: 17, PITWALL: 18, PAVER: 19 };
const COLS = [];
COLS[K.GRASS] = [0x6FBF4A, 0.1]; COLS[K.ROAD] = [0x4B5159, 0.04]; COLS[K.EDGE] = [0xE9EDEF, 0]; COLS[K.DASH] = [0xF3E9B5, 0];
COLS[K.ZEBRA] = [0xF4F1EA, 0]; COLS[K.KERB] = [0xC7C2B6, 0.05]; COLS[K.WATER] = [0x4FA3D1, 0.06]; COLS[K.SAND] = [0xE6D6A2, 0.06];
COLS[K.CHKD] = [0x23252B, 0]; COLS[K.CHKW] = [0xF4F1EA, 0]; COLS[K.PIT] = [0x1F1B18, 0.1]; COLS[K.RIM] = [0x7E8288, 0.08];
COLS[K.SCRUB] = [0xC9B27A, 0.08]; COLS[K.LATER] = [0xB5694A, 0.08]; COLS[K.ROCK] = [0x8E959B, 0.07]; COLS[K.ROCK2] = [0x717880, 0.08];
COLS[K.PAVER] = [0xBDB6A6, 0.05]; COLS[K.SOIL] = [0x7B5A3C, 0.08]; COLS[K.WALL] = [0x9A9187, 0.06]; COLS[K.PITWALL] = [0x3A3029, 0.08];
const MULT = [];   // speed multiplier per surface
MULT[K.GRASS] = 0.5; MULT[K.ROAD] = 1; MULT[K.EDGE] = 1; MULT[K.DASH] = 1; MULT[K.ZEBRA] = 1; MULT[K.KERB] = 0.85; MULT[K.WATER] = 0.3; MULT[K.SAND] = 0.45;
MULT[K.CHKD] = 1; MULT[K.CHKW] = 1; MULT[K.PIT] = 1; MULT[K.RIM] = 1; MULT[K.SCRUB] = 0.55; MULT[K.LATER] = 0.5; MULT[K.ROCK] = 0.6; MULT[K.ROCK2] = 0.55;
MULT[K.PAVER] = 0.85; MULT[K.SOIL] = 0.5; MULT[K.WALL] = 0.5; MULT[K.PITWALL] = 0.5;
// Surfaces the map editor can paint onto open ground (order = the code stored in the map's paint layer).
export const PAINT_KINDS = ['grass', 'sand', 'scrub', 'later', 'rock', 'rock2', 'soil', 'paver'];
const PAINT_K = [K.GRASS, K.SAND, K.SCRUB, K.LATER, K.ROCK, K.ROCK2, K.SOIL, K.PAVER];
const DEEP = []; DEEP[K.ROCK] = K.ROCK2; DEEP[K.ROCK2] = K.ROCK2; DEEP[K.SCRUB] = K.LATER; DEEP[K.LATER] = K.LATER; DEEP[K.SAND] = K.SAND;

// ---- Smooth height profiles (monotone cubic, so grades follow the control points) ----
function pchip(pts) {
  const n = pts.length, h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = pts[i + 1][0] - pts[i][0]; d[i] = (pts[i + 1][1] - pts[i][1]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return t => {
    t = clamp(t, pts[0][0], pts[n - 1][0]);
    let i = 0; while (i < n - 2 && t > pts[i + 1][0]) i++;
    const s = (t - pts[i][0]) / h[i], s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * pts[i][1] + (s3 - 2 * s2 + s) * h[i] * m[i] + (-2 * s3 + 3 * s2) * pts[i + 1][1] + (s3 - s2) * h[i] * m[i + 1];
  };
}

import { sampleCurve, prepareCurve, nearCurve, curvePoint } from './curve.js';
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createWorld(map) {
  const T = map.terrain, RD = map.roads, ground = map.ground;
  const oval = RD.edges[0];
  const OFF = oval.off === true;                      // a map with no oval loop: the oval stays in the file as a placeholder but is never drawn or driven
  const L = oval.L, R = oval.R;                       // oval: half-length of the straights, radius of the ends (road centre line)
  const HW = RD.halfWidth, PAV = RD.pavement;         // tarmac half-width, pavement outer edge
  const LTOT = 4 * L + 2 * Math.PI * R;
  const SLAB = { x0: map.slab.x0, x1: map.slab.x1, z0: map.slab.z0, z1: map.slab.z1 };
  const WATER = T.waterLevel, Y_MIN = T.yMin, Y_MAX = T.yMax;
  const EL = RD.edgeLine, DS = RD.dash;
  const JR = RD.junctionRadius;

  const loopF = pchip(oval.profile);
  const loopH = s => loopF(((s % LTOT) + LTOT) % LTOT);

  // ---- Oval geometry ----
  function loopInfo(x, z) {
    if (OFF) return { u: 1e9, s: 0 };
    const px = clamp(x, -L, L), dx = x - px, dz = z + R;
    const u = Math.hypot(dx, dz) - R;
    let s;
    if (x > L) s = 2 * L + (Math.PI / 2 - Math.atan2(dz, dx)) * R;
    else if (x < -L) s = 4 * L + Math.PI * R + (Math.atan2(dz, -(x + L)) + Math.PI / 2) * R;
    else if (z >= -R) s = x + L;
    else s = 2 * L + Math.PI * R + (L - x);
    return { u, s };
  }
  function trackPoint(s, u) {
    s = ((s % LTOT) + LTOT) % LTOT;
    const A = 2 * L, Bn = A + Math.PI * R, Cn = Bn + 2 * L;
    if (s < A) return { x: -L + s, z: u, psi: 0 };
    if (s < Bn) { const a = Math.PI / 2 - (s - A) / R, r = R + u; return { x: L + r * Math.cos(a), z: -R + r * Math.sin(a), psi: Math.atan2(Math.cos(a), Math.sin(a)) }; }
    if (s < Cn) return { x: L - (s - Bn), z: -2 * R - u, psi: Math.PI };
    const ap = -Math.PI / 2 + (s - Cn) / R, r = R + u;
    return { x: -L - r * Math.cos(ap), z: -R + r * Math.sin(ap), psi: Math.atan2(-Math.cos(ap), Math.sin(ap)) };
  }

  // ---- Cross roads (straight pieces with their own height profiles) ----
  const LINES = RD.edges.slice(1).map(e => e.type === 'curve'
    ? { key: e.key, ax: e.pts[0][0], az: e.pts[0][1], bx: e.pts[e.pts.length - 1][0], bz: e.pts[e.pts.length - 1][1], pts: e.profile, curve: prepareCurve(sampleCurve(e.pts)) }
    : { key: e.key, ax: e.a[0], az: e.a[1], bx: e.b[0], bz: e.b[1], pts: e.profile });
  LINES.forEach(e => {
    if (e.curve) { e.len = e.curve.len; e.f = pchip(e.pts); return; }
    const dx = e.bx - e.ax, dz = e.bz - e.az, len = Math.hypot(dx, dz);
    e.len = len; e.dx = dx / len; e.dz = dz / len; e.nx = -e.dz; e.nz = e.dx; e.f = pchip(e.pts);
  });
  const JUNC = RD.junctions.map(j => ({ x: j.x, z: j.z, h: j.h }));
  function edgeLen(ei) { return ei === 0 ? LTOT : LINES[ei - 1].len; }
  function edgeH(ei, t) { return ei === 0 ? loopH(t) : LINES[ei - 1].f(t); }
  function edgePoint(ei, t, u) {
    if (ei === 0) return trackPoint(t, u);
    const e = LINES[ei - 1];
    if (e.curve) return curvePoint(e.curve, t, u);
    return { x: e.ax + e.dx * t + e.nx * u, z: e.az + e.dz * t + e.nz * u, psi: Math.atan2(-e.dz, e.dx) };
  }
  // Named heights that scenery can refer to (pads), plus the three profile heights the old code derived.
  const S_EAST = 2 * L + Math.PI * R / 2, S_WEST = 4 * L + Math.PI * R + Math.PI * R / 2, S_FAR0 = 2 * L + Math.PI * R + L;

  // Flat pads under the buildings
  const FLATS = map.pads.map(p => ({ id: p.id, x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, h: p.h, m: p.m, yaw: p.yaw || 0, c: Math.cos((p.yaw || 0) * Math.PI / 180), s: Math.sin((p.yaw || 0) * Math.PI / 180) }));
  // A turned pad is the same box turned about its centre; the point is moved into the box's own frame first. Yaw 0 keeps the old arithmetic.
  function padFrame(r, x, z) {
    if (!r.yaw) return [x, z];
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, dx = x - cx, dz = z - cz;
    return [cx + dx * r.c - dz * r.s, cz + dx * r.s + dz * r.c];
  }
  function inFlat(x, z, margin) {
    for (const r of FLATS) {
      const q = padFrame(r, x, z);
      if (q[0] > r.x0 - margin && q[0] < r.x1 + margin && q[1] > r.z0 - margin && q[1] < r.z1 + margin) return true;
    }
    return false;
  }
  const pad = id => FLATS.find(p => p.id === id);

  // ---- Ground layers (optional, from the editor): hand-sculpted height on a 1 m lattice and hand-painted surface on a 0.5 m lattice ----
  // Sparse and keyed by lattice cell, so an untouched map pays nothing and a stream chunk only meets the cells it covers.
  const LY = map.layers || null;
  const lkey = (i, j) => (i + 20000) * 40001 + (j + 20000);
  let SC = null, PN = null;
  if (LY && LY.sculpt && LY.sculpt.cells.length) { SC = new Map(); LY.sculpt.cells.forEach(c => SC.set(lkey(c[0], c[1]), c[2] / 100)); }
  if (LY && LY.paint && LY.paint.cells.length) { PN = new Map(); LY.paint.cells.forEach(c => PN.set(lkey(c[0], c[1]), PAINT_K[c[2]])); }
  function sculptAt(x, z) {
    const fx = Math.floor(x), fz = Math.floor(z), tx = x - fx, tz = z - fz;
    const a = SC.get(lkey(fx, fz)) || 0, b = SC.get(lkey(fx + 1, fz)) || 0, c = SC.get(lkey(fx, fz + 1)) || 0, d = SC.get(lkey(fx + 1, fz + 1)) || 0;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  // ---- Noise and biomes ----
  function vn(x, z, sc, sd) {
    x /= sc; z /= sc;
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = hash3(ix, iz, sd, 3), b = hash3(ix + 1, iz, sd, 3), c = hash3(ix, iz + 1, sd, 3), d = hash3(ix + 1, iz + 1, sd, 3);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
  }
  const gs = (x, z, cx, cz, sx, sz) => Math.exp(-(((x - cx) ** 2) / (2 * sx * sx) + ((z - cz) ** 2) / (2 * sz * sz)));
  const blobMax = (x, z, blobs) => {
    let m = -Infinity;
    for (let i = 0; i < blobs.length; i++) { const b = blobs[i], g = b.w * gs(x, z, b.x, b.z, b.sx, b.sz); if (g > m) m = g; }
    return m;
  };
  const BIO = T.biomes;
  function biomes(x, z, o) {
    o.hills = blobMax(x, z, BIO.hills); o.rock = blobMax(x, z, BIO.rock); o.scrub = blobMax(x, z, BIO.scrub); o.lake = blobMax(x, z, BIO.lake);
  }

  // ---- Potholes: fixed positions, clustered, never in junctions, on the start line or on the zebra ----
  function tarmacCount(x, z) {
    let n = Math.abs(loopInfo(x, z).u) <= HW + 1.2 ? 1 : 0;
    for (const e of LINES) {
      if (e.curve) { if (nearCurve(e.curve, x, z).d <= HW + 1.2) n++; continue; }
      const px = x - e.ax, pz = z - e.az, t = clamp(px * e.dx + pz * e.dz, 0, e.len);
      if (Math.hypot(px - e.dx * t, pz - e.dz * t) <= HW + 1.2) n++;
    }
    return n;
  }
  const POTS = [];
  map.potholes.clusters.forEach(c => c.items.forEach(it => {
    const ei = c.edge, t = c.t + it[0], p = edgePoint(ei, t, it[1]);
    if (tarmacCount(p.x, p.z) > 1) return;
    if (map.potholes.exclude.some(ex => ei === ex.edge && p.z > ex.zMin && ex.x.some(r => p.x > r[0] && p.x < r[1]))) return;
    POTS.push({ x: p.x, z: p.z, r: it[2], depth: it[2] >= map.potholes.deepAt ? 2 : 1, edge: ei });
  }));
  function potholeAt(x, z, pad) {
    for (let i = 0; i < POTS.length; i++) {
      const p = POTS[i], dx = x - p.x, dz = z - p.z, r = p.r + (pad || 0);
      if (dx * dx + dz * dz < r * r) return i;
    }
    return -1;
  }

  // ---- One ground column: surface kind and continuous height at (x, z) ----
  const MK = map.markings, ZB = MK.zebra, SL_ = MK.startLine, TN = T.noise, HR = T.relief;
  const out = { h: 0, kind: 0, wall: 0, depth: 0, d: 0, edge: 0, u: 0, t: 0, tarmac: 0 };
  const nE = LINES.length + 1, ds = new Float64Array(nE), hs = new Float64Array(nE), bio = { hills: 0, rock: 0, scrub: 0, lake: 0 };
  function column(x, z, v) {
    const li = loopInfo(x, z);
    let bd = Math.abs(li.u), bu = li.u, bt = li.s, bE = 0, nT = bd <= HW ? 1 : 0;
    ds[0] = bd; hs[0] = loopF(((li.s % LTOT) + LTOT) % LTOT);
    for (let i = 0; i < LINES.length; i++) {
      const e = LINES[i];
      let t, d, side;
      if (e.curve) { const q = nearCurve(e.curve, x, z); t = q.t; d = q.d; side = q.side; }
      else {
        const px = x - e.ax, pz = z - e.az;
        t = clamp(px * e.dx + pz * e.dz, 0, e.len);
        const cx = px - e.dx * t, cz = pz - e.dz * t; d = Math.hypot(cx, cz); side = px * e.nx + pz * e.nz;
      }
      ds[i + 1] = d; hs[i + 1] = e.f(t);
      if (d <= HW) nT++;
      if (d < bd) { bd = d; bu = side < 0 ? -d : d; bt = t; bE = i + 1; }
    }
    let roadH = hs[bE];
    for (let j = 0; j < JUNC.length; j++) {
      const J = JUNC[j], dj = Math.hypot(x - J.x, z - J.z);
      if (dj < JR[1]) roadH = lerp(roadH, J.h, 1 - sstep(JR[0], JR[1], dj));
    }
    out.d = bd; out.u = bu; out.t = bt; out.edge = bE; out.tarmac = nT; out.wall = 0; out.depth = 0;

    if (nT >= 1) {
      out.h = roadH; let kind = K.ROAD;
      if (nT < 2) {
        const au = Math.abs(bu);
        if (au >= EL[0] && au < EL[1]) kind = K.EDGE;
        else if (au < DS.halfWidth && ((((bt - DS.offset) % DS.period) + DS.period) % DS.period) < DS.on) kind = K.DASH;
        if (bE === 0 && z > -R && au <= HW) {
          if (x >= ZB.x0 && x < ZB.x1 && bu >= ZB.u0 && bu < ZB.u1 && (((bu - ZB.u0) % ZB.period) + ZB.period) % ZB.period < ZB.duty) kind = K.ZEBRA;
          if (Math.abs(x - SL_.x) < SL_.halfWidth) kind = ((Math.floor((bu + HW) / SL_.cell) + Math.floor((x + (-SL_.x + SL_.halfWidth)) / SL_.cell)) & 1) ? K.CHKD : K.CHKW;
        }
        for (let i = 0; i < POTS.length; i++) {
          const p = POTS[i], dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz, rr = Math.max(p.r, 1.4 * v);
          if (d2 < rr * rr) { kind = K.PIT; out.depth = p.depth; break; }
          if (d2 < (rr + 0.3) * (rr + 0.3) && kind !== K.CHKD && kind !== K.CHKW && kind !== K.ZEBRA) kind = K.RIM;
        }
      }
      out.kind = kind; out.wall = 1;
      return out;
    }
    if (bd <= PAV) { out.h = roadH; out.kind = K.KERB; out.wall = 1; return out; }

    // Terrain: follows the nearby roads, plus biome relief, flattened under buildings, blended into the road corridor.
    let sw = 0, sh = 0;
    for (let i = 0; i < nE; i++) { const w = 1 / Math.pow(ds[i] + 2, 3); sw += w; sh += w * hs[i]; }
    let H = sh / sw;
    biomes(x, z, bio);
    const n1 = vn(x, z, TN.s1, 1), n2 = vn(x, z, TN.s2, 2), n3 = vn(x, z, TN.s3, 4);
    H += (OFF ? 0 : 0.5) * (n1 - 0.5) * 2;
    H += bio.hills * (HR.hills[0] + HR.hills[1] * n1 + HR.hills[2] * n2);
    const ridge = 1 - Math.abs(2 * n2 - 1);
    H += bio.rock * (HR.rock[0] + HR.rock[1] * ridge + HR.rock[2] * n3);
    H += bio.scrub * HR.scrub * (n1 - 0.5) * 2;
    H -= bio.lake * HR.lake;
    if (SC) H += sculptAt(x, z);
    for (let i = 0; i < FLATS.length; i++) {
      const r = FLATS[i], q = r.yaw ? padFrame(r, x, z) : null, qx = q ? q[0] : x, qz = q ? q[1] : z;
      const dx = Math.max(r.x0 - qx, 0, qx - r.x1), dz = Math.max(r.z0 - qz, 0, qz - r.z1);
      H = lerp(H, r.h, 1 - sstep(0, r.m, Math.hypot(dx, dz)));
    }
    H = lerp(roadH, H, sstep(PAV, PAV + T.blend, bd));
    H = clamp(H, Y_MIN + 0.4, Y_MAX - 0.4);
    let kind = K.GRASS;
    const inLake = bio.lake > T.lakeMin;
    if (inLake && H < WATER) { kind = K.WATER; H = WATER; }
    else if (inLake && H < WATER + 0.5) kind = K.SAND;
    else if (bio.rock > T.rockMin) kind = n3 > T.rock2At ? K.ROCK2 : K.ROCK;
    else if (bio.scrub > T.scrubMin) kind = n3 > T.laterAt ? K.LATER : K.SCRUB;
    if (PN && kind !== K.WATER) { const pk = PN.get(lkey(Math.floor(x * 2), Math.floor(z * 2))); if (pk !== undefined) kind = pk; }
    out.h = H; out.kind = kind; out.wall = bd < PAV + 5 ? 1 : 0;
    return out;
  }
  function heightAt(x, z) { return column(x, z, 0.2).h; }

  // ---- Ground builder: one column of cubes per cell, grouped into chunks ----
  // Cubes of one ground column (cell i, k) into chunk record ch. Shared by the whole-map build and the per-chunk build, so both give the same cubes.
  function emitCell(ch, i, k, cx, cz, t, kind, f, m, v, layN, kerbN) {
    for (let kk = Math.min(m, t - 1); kk <= t - 1; kk++) {
      const dIdx = t - 1 - kk;
      let key;
      if (kind === K.KERB) key = dIdx < kerbN ? K.KERB : dIdx < kerbN + layN ? K.GRASS : (f & 1 ? K.WALL : K.SOIL);
      else if (kind === K.WATER) key = dIdx === 0 ? K.WATER : K.SOIL;
      else if (dIdx < layN) key = kind;
      else if (f & 2) key = K.PITWALL;
      else if (f & 1) key = K.WALL;
      else key = DEEP[kind] !== undefined ? DEEP[kind] : K.SOIL;
      const cy = (kk + 0.5) * v, def = COLS[key], jt = def[1], c = def[0];
      const j = (1 + (hash3(i, kk, k, 1) - 0.5) * 2 * jt) * (cy < -0.01 ? 0.85 : 0.8 + 0.2 * Math.min(1, cy / 1.5));
      ch.pos.push(cx, cy, cz);
      ch.col.push(Math.min(1, ((c >> 16) & 255) / 255 * j), Math.min(1, ((c >> 8) & 255) / 255 * j), Math.min(1, (c & 255) / 255 * j));
      if (cy < ch.y0) ch.y0 = cy; if (cy > ch.y1) ch.y1 = cy;
    }
  }

  async function buildGround(v, tick) {
    const x0 = SLAB.x0, z0 = SLAB.z0;
    const nx = Math.ceil((SLAB.x1 - x0) / v - 1e-6), nz = Math.ceil((SLAB.z1 - z0) / v - 1e-6);
    const BOT = Math.round(Y_MIN / v), layN = Math.max(1, Math.round(ground.layer / v)), kerbN = layN;
    const top = new Int16Array(nx * nz), tb = new Int16Array(nx * nz), kd = new Uint8Array(nx * nz), fl = new Uint8Array(nx * nz);
    let ts = nowMs();
    for (let k = 0; k < nz; k++) {
      const cz = z0 + (k + 0.5) * v;
      for (let i = 0; i < nx; i++) {
        const cx = x0 + (i + 0.5) * v, id = i + nx * k, c = column(cx, cz, v);
        let t = Math.round(c.h / v);
        if (c.kind === K.KERB) t += kerbN;
        tb[id] = t; top[id] = c.kind === K.PIT ? t - c.depth : t; kd[id] = c.kind; fl[id] = c.wall;
      }
      if (tick && nowMs() - ts > 14) { await tick(); ts = nowMs(); }
    }
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const id = i + nx * k;
      if (kd[id] === K.PIT) { if (i > 0) fl[id - 1] |= 2; if (i < nx - 1) fl[id + 1] |= 2; if (k > 0) fl[id - nx] |= 2; if (k < nz - 1) fl[id + nx] |= 2; }
    }
    const CH = ground.chunk, chunks = new Map();
    let count = 0;
    for (let k = 0; k < nz; k++) {
      const cz = z0 + (k + 0.5) * v;
      for (let i = 0; i < nx; i++) {
        const id = i + nx * k, t = top[id], kind = kd[id], f = fl[id];
        let m = t;
        const n0 = i > 0 ? top[id - 1] : BOT, n1 = i < nx - 1 ? top[id + 1] : BOT, n2 = k > 0 ? top[id - nx] : BOT, n3 = k < nz - 1 ? top[id + nx] : BOT;
        if (n0 < m) m = n0; if (n1 < m) m = n1; if (n2 < m) m = n2; if (n3 < m) m = n3;
        const cx = x0 + (i + 0.5) * v;
        const ck = Math.floor((cx - x0) / CH) + ',' + Math.floor((cz - z0) / CH);
        let ch = chunks.get(ck);
        if (!ch) { ch = { pos: [], col: [], y0: 1e9, y1: -1e9, a: Math.floor((cx - x0) / CH), b: Math.floor((cz - z0) / CH) }; chunks.set(ck, ch); }
        emitCell(ch, i, k, cx, cz, t, kind, f, m, v, layN, kerbN);
      }
      if (tick && nowMs() - ts > 14) { await tick(); ts = nowMs(); }
    }
    const outChunks = [];
    chunks.forEach(ch => {
      count += ch.pos.length / 3;
      outChunks.push({ count: ch.pos.length / 3, pos: new Float32Array(ch.pos), col: new Float32Array(ch.col), v,
        box: [x0 + ch.a * CH, ch.y0 - v, z0 + ch.b * CH, x0 + (ch.a + 1) * CH, ch.y1 + v, z0 + (ch.b + 1) * CH] });
    });
    return { chunks: outChunks, count, HF: { x0, z0, nx, nz, v, top: tb, kind: kd } };
  }
  // ---- Per-chunk building, for maps too big to hold whole (streaming). Same cubes as buildGround, one chunk at a time. ----
  function chunkGrid(v) {
    const x0 = SLAB.x0, z0 = SLAB.z0, CH = ground.chunk;
    const nx = Math.ceil((SLAB.x1 - x0) / v - 1e-6), nz = Math.ceil((SLAB.z1 - z0) / v - 1e-6);
    const aOf = new Int32Array(nx), bOf = new Int32Array(nz);
    for (let i = 0; i < nx; i++) { const cx = x0 + (i + 0.5) * v; aOf[i] = Math.floor((cx - x0) / CH); }
    for (let k = 0; k < nz; k++) { const cz = z0 + (k + 0.5) * v; bOf[k] = Math.floor((cz - z0) / CH); }
    const na = aOf[nx - 1] + 1, nb = bOf[nz - 1] + 1;
    const ia = new Int32Array(na + 1), kb = new Int32Array(nb + 1);
    ia.fill(-1); kb.fill(-1);
    for (let i = nx - 1; i >= 0; i--) ia[aOf[i]] = i;
    for (let k = nz - 1; k >= 0; k--) kb[bOf[k]] = k;
    ia[na] = nx; kb[nb] = nz;
    return { v, x0, z0, CH, nx, nz, na, nb, aOf, bOf, iStart: a => ia[a], iEnd: a => ia[a + 1], kStart: b => kb[b], kEnd: b => kb[b + 1] };
  }
  function buildChunk(grid, a, b) {
    const { v, x0, z0, nx, nz } = grid;
    const i0 = grid.iStart(a), i1 = grid.iEnd(a), k0 = grid.kStart(b), k1 = grid.kEnd(b);
    if (i0 < 0 || k0 < 0 || i1 <= i0 || k1 <= k0) return null;
    const BOT = Math.round(Y_MIN / v), layN = Math.max(1, Math.round(ground.layer / v)), kerbN = layN;
    const I0 = Math.max(0, i0 - 1), I1 = Math.min(nx, i1 + 1), K0 = Math.max(0, k0 - 1), K1 = Math.min(nz, k1 + 1);
    const wI = I1 - I0, wK = K1 - K0;
    const top = new Int16Array(wI * wK), tb = new Int16Array(wI * wK), kd = new Uint8Array(wI * wK), fl = new Uint8Array(wI * wK);
    for (let k = K0; k < K1; k++) {
      const cz = z0 + (k + 0.5) * v;
      for (let i = I0; i < I1; i++) {
        const cx = x0 + (i + 0.5) * v, id = (i - I0) + wI * (k - K0), c = column(cx, cz, v);
        let t = Math.round(c.h / v);
        if (c.kind === K.KERB) t += kerbN;
        tb[id] = t; top[id] = c.kind === K.PIT ? t - c.depth : t; kd[id] = c.kind; fl[id] = c.wall;
      }
    }
    for (let k = K0; k < K1; k++) for (let i = I0; i < I1; i++) {
      const id = (i - I0) + wI * (k - K0);
      if (kd[id] === K.PIT) { if (i > I0) fl[id - 1] |= 2; if (i < I1 - 1) fl[id + 1] |= 2; if (k > K0) fl[id - wI] |= 2; if (k < K1 - 1) fl[id + wI] |= 2; }
    }
    const ch = { pos: [], col: [], y0: 1e9, y1: -1e9, a, b };
    for (let k = k0; k < k1; k++) {
      const cz = z0 + (k + 0.5) * v;
      for (let i = i0; i < i1; i++) {
        const id = (i - I0) + wI * (k - K0), t = top[id], kind = kd[id], f = fl[id];
        let m = t;
        const n0 = i > 0 ? top[id - 1] : BOT, n1 = i < nx - 1 ? top[id + 1] : BOT, n2 = k > 0 ? top[id - wI] : BOT, n3 = k < nz - 1 ? top[id + wI] : BOT;
        if (n0 < m) m = n0; if (n1 < m) m = n1; if (n2 < m) m = n2; if (n3 < m) m = n3;
        emitCell(ch, i, k, x0 + (i + 0.5) * v, cz, t, kind, f, m, v, layN, kerbN);
      }
    }
    const CH = grid.CH;
    const chunk = { count: ch.pos.length / 3, pos: new Float32Array(ch.pos), col: new Float32Array(ch.col), v,
      box: [x0 + a * CH, ch.y0 - v, z0 + b * CH, x0 + (a + 1) * CH, ch.y1 + v, z0 + (b + 1) * CH] };
    return { chunk, hf: { I0, K0, wI, wK, top: tb, kind: kd } };
  }
  // Heightfield for a streamed map: tops and kinds are kept per loaded chunk (with a one-cell border), so lookups work near the player.
  // A lookup in a chunk that is not loaded falls back to the same maths (slower, but never wrong).
  function createChunkStore(grid) {
    const { v, x0, z0, nx, nz, aOf, bOf } = grid, kerbN = Math.max(1, Math.round(ground.layer / v));
    const loaded = new Map();
    const topAt = (i, k) => {
      const e = loaded.get(aOf[i] + ',' + bOf[k]);
      if (e) return e.top[(i - e.I0) + e.wI * (k - e.K0)];
      const c = column(x0 + (i + 0.5) * v, z0 + (k + 0.5) * v, v), t = Math.round(c.h / v);
      return c.kind === K.KERB ? t + kerbN : t;
    };
    return {
      stream: true, x0, z0, nx, nz, v, loaded,
      has: (a, b) => loaded.has(a + ',' + b),
      set: (a, b, hf) => { loaded.set(a + ',' + b, hf); },
      remove: (a, b) => { loaded.delete(a + ',' + b); },
      y(x, z) {
        const fx = (x - x0) / v - 0.5, fz = (z - z0) / v - 0.5;
        let i = Math.floor(fx), k = Math.floor(fz);
        const tx = fx - i, tz = fz - k;
        i = clamp(i, 0, nx - 2); k = clamp(k, 0, nz - 2);
        const a = topAt(i, k), b = topAt(i + 1, k), c = topAt(i, k + 1), d = topAt(i + 1, k + 1);
        return lerp(lerp(a, b, clamp(tx, 0, 1)), lerp(c, d, clamp(tx, 0, 1)), clamp(tz, 0, 1)) * v;
      },
      kind(x, z) {
        const i = clamp(Math.floor((x - x0) / v), 0, nx - 1), k = clamp(Math.floor((z - z0) / v), 0, nz - 1);
        const e = loaded.get(aOf[i] + ',' + bOf[k]);
        if (e) return e.kind[(i - e.I0) + e.wI * (k - e.K0)];
        return column(x0 + (i + 0.5) * v, z0 + (k + 0.5) * v, v).kind;
      }
    };
  }

  // Surface lookup on a built ground (bilinear on cube tops, so vehicles ride smoothly over the steps).
  function hfY(HF, x, z) {
    if (!HF) return 0;
    const fx = (x - HF.x0) / HF.v - 0.5, fz = (z - HF.z0) / HF.v - 0.5;
    let i = Math.floor(fx), k = Math.floor(fz);
    const tx = fx - i, tz = fz - k;
    i = clamp(i, 0, HF.nx - 2); k = clamp(k, 0, HF.nz - 2);
    const a = HF.top[i + HF.nx * k], b = HF.top[i + 1 + HF.nx * k], c = HF.top[i + HF.nx * (k + 1)], d = HF.top[i + 1 + HF.nx * (k + 1)];
    return lerp(lerp(a, b, clamp(tx, 0, 1)), lerp(c, d, clamp(tx, 0, 1)), clamp(tz, 0, 1)) * HF.v;
  }
  function hfKind(HF, x, z) {
    if (!HF) return K.ROAD;
    const i = clamp(Math.floor((x - HF.x0) / HF.v), 0, HF.nx - 1), k = clamp(Math.floor((z - HF.z0) / HF.v), 0, HF.nz - 1);
    return HF.kind[i + HF.nx * k];
  }

  return { hasLoop: !OFF, L, R, HW, PAV, LTOT, SLAB, WATER, Y_MIN, Y_MAX, K, COLS, MULT, LINES, JUNC, FLATS, POTS, loopInfo, trackPoint, loopH, loopF, column, heightAt,
    edgeLen, edgeH, edgePoint, inFlat, potholeAt, tarmacCount, buildGround, chunkGrid, buildChunk, createChunkStore, hfY, hfKind, S_EAST, S_WEST, S_FAR0, hash3, vn, biomes, pad, map };
}
