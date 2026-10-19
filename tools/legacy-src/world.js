// ===== World model: road network with elevation, terrain, potholes, ground builder. No DOM, no THREE. =====
const World = (function () {
'use strict';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash3(i, j, k, s) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483629) + Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- Constants ----
const L = 14, R = 15;                  // oval: half-length of the straights, radius of the ends (road centre line)
const HW = 2.25, PAV = 3.0;            // tarmac half-width, pavement outer edge (unchanged from the gallery)
const LTOT = 4 * L + 2 * Math.PI * R;  // ~150 m lap
const SLAB = { x0: -42, x1: 42, z0: -48, z1: 18 };
const WATER = -0.9, Y_MIN = -3.0, Y_MAX = 11.0;

// Surface kinds
const K = { GRASS: 0, ROAD: 1, EDGE: 2, DASH: 3, ZEBRA: 4, KERB: 5, WATER: 6, SAND: 7, CHKD: 8, CHKW: 9, PIT: 10, RIM: 11, SCRUB: 12, LATER: 13, ROCK: 14, ROCK2: 15, SOIL: 16, WALL: 17, PITWALL: 18 };
const COLS = [];
COLS[K.GRASS] = [0x6FBF4A, 0.1]; COLS[K.ROAD] = [0x4B5159, 0.04]; COLS[K.EDGE] = [0xE9EDEF, 0]; COLS[K.DASH] = [0xF3E9B5, 0];
COLS[K.ZEBRA] = [0xF4F1EA, 0]; COLS[K.KERB] = [0xC7C2B6, 0.05]; COLS[K.WATER] = [0x4FA3D1, 0.06]; COLS[K.SAND] = [0xE6D6A2, 0.06];
COLS[K.CHKD] = [0x23252B, 0]; COLS[K.CHKW] = [0xF4F1EA, 0]; COLS[K.PIT] = [0x1F1B18, 0.1]; COLS[K.RIM] = [0x7E8288, 0.08];
COLS[K.SCRUB] = [0xC9B27A, 0.08]; COLS[K.LATER] = [0xB5694A, 0.08]; COLS[K.ROCK] = [0x8E959B, 0.07]; COLS[K.ROCK2] = [0x717880, 0.08];
COLS[K.SOIL] = [0x7B5A3C, 0.08]; COLS[K.WALL] = [0x9A9187, 0.06]; COLS[K.PITWALL] = [0x3A3029, 0.08];
const MULT = [];   // speed multiplier per surface
MULT[K.GRASS] = 0.5; MULT[K.ROAD] = 1; MULT[K.EDGE] = 1; MULT[K.DASH] = 1; MULT[K.ZEBRA] = 1; MULT[K.KERB] = 0.85; MULT[K.WATER] = 0.3; MULT[K.SAND] = 0.45;
MULT[K.CHKD] = 1; MULT[K.CHKW] = 1; MULT[K.PIT] = 1; MULT[K.RIM] = 1; MULT[K.SCRUB] = 0.55; MULT[K.LATER] = 0.5; MULT[K.ROCK] = 0.6; MULT[K.ROCK2] = 0.55;
MULT[K.SOIL] = 0.5; MULT[K.WALL] = 0.5; MULT[K.PITWALL] = 0.5;
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
// Oval circuit: flat on the shop-row straight, climbs round the east end, crests with a dip, flat past the infield buildings, drops round the west end.
const loopF = pchip([[0, 0], [30, 0], [42, 0.8], [54, 2.0], [64, 2.8], [74, 2.75], [84, 3.5], [100, 3.5], [112, 3.3], [126, 2.0], [138, 0.7], [LTOT, 0]]);
const loopH = s => loopF(((s % LTOT) + LTOT) % LTOT);
const S_EAST = 2 * L + Math.PI * R / 2, S_WEST = 4 * L + Math.PI * R + Math.PI * R / 2, S_FAR0 = 2 * L + Math.PI * R + L;

// ---- Oval geometry (as in the first game) ----
function loopInfo(x, z) {
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
const hFar = loopH(S_FAR0), hW = loopH(S_WEST), hE = loopH(S_EAST);
const LINES = [
  { key: 'spine', ax: -42, az: -15, bx: 42, bz: -15, pts: [[0, 0.9], [13, hW], [30, 0.8], [42, 0.5], [54, 0.8], [71, hE], [84, 2.9]] },
  { key: 'link', ax: 11.5, az: 0, bx: 11.5, bz: 18, pts: [[0, 0], [5, -0.1], [18, -1.0]] },
  { key: 'spur', ax: 0, az: -30, bx: 0, bz: -48, pts: [[0, hFar], [6, hFar + 0.2], [18, hFar + 1.2]] }
];
LINES.forEach(e => {
  const dx = e.bx - e.ax, dz = e.bz - e.az, len = Math.hypot(dx, dz);
  e.len = len; e.dx = dx / len; e.dz = dz / len; e.nx = -e.dz; e.nz = e.dx; e.f = pchip(e.pts);
});
const JUNC = [{ x: -29, z: -15, h: hW }, { x: 29, z: -15, h: hE }, { x: 11.5, z: 0, h: 0 }, { x: 0, z: -30, h: hFar }];
// Edge 0 is the oval, edges 1.. are LINES.
function edgeLen(ei) { return ei === 0 ? LTOT : LINES[ei - 1].len; }
function edgeH(ei, t) { return ei === 0 ? loopH(t) : LINES[ei - 1].f(t); }
function edgePoint(ei, t, u) {
  if (ei === 0) return trackPoint(t, u);
  const e = LINES[ei - 1];
  return { x: e.ax + e.dx * t + e.nx * u, z: e.az + e.dz * t + e.nz * u, psi: Math.atan2(-e.dz, e.dx) };
}

// Flat pads under the buildings, and the gallery's bus-stop strip.
const FLATS = [
  { x0: -10.5, x1: 10.8, z0: -7.0, z1: -2.9, h: 0, m: 2 },
  { x0: -9.5, x1: 7.5, z0: 2.9, z1: 6.5, h: 0, m: 2 },
  { x0: -10.5, x1: 11.8, z0: -27.2, z1: -21.2, h: hFar, m: 2.5 }
];
function inFlat(x, z, margin) {
  for (const r of FLATS) if (x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin) return true;
  return false;
}

// ---- Noise and biomes ----
function vn(x, z, sc, sd) {
  x /= sc; z /= sc;
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iz, sd, 3), b = hash3(ix + 1, iz, sd, 3), c = hash3(ix, iz + 1, sd, 3), d = hash3(ix + 1, iz + 1, sd, 3);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}
const gs = (x, z, cx, cz, sx, sz) => Math.exp(-(((x - cx) ** 2) / (2 * sx * sx) + ((z - cz) ** 2) / (2 * sz * sz)));
function biomes(x, z, o) {
  o.hills = Math.max(gs(x, z, 34, -40, 14, 10), 0.8 * gs(x, z, -4, -46, 16, 6));
  o.rock = gs(x, z, -33, -38, 11, 10);
  o.scrub = Math.max(gs(x, z, -30, 10, 11, 7), gs(x, z, 3, 15, 8, 4.5));
  o.lake = gs(x, z, 30, 11, 9, 7);
}

// ---- Potholes: fixed positions, clustered, never in junctions, on the start line or on the zebra ----
const CLUSTERS = [
  [0, 36, [[0, -1.1, 0.5], [2.2, -0.6, 0.4], [4.5, -1.3, 0.7]]], [0, 57, [[0, 1.2, 0.6], [3, 0.9, 0.45]]], [0, 66, [[0, -0.9, 0.9]]],
  [0, 88, [[0, 1.3, 0.5], [2, 0.6, 0.4], [5, 1.4, 0.7]]], [0, 98, [[0, -1.2, 0.55]]], [0, 117, [[0, 0.8, 0.7], [2.5, 1.4, 0.45]]],
  [0, 132, [[0, -1.0, 0.6], [3, -0.4, 0.5], [6, -1.2, 0.8]]], [0, 143, [[0, 1.1, 0.5]]], [0, 15, [[0, -1.3, 0.6], [3, -1.0, 0.45]]],
  [1, 8, [[0, 0.9, 0.6], [2, -0.6, 0.45]]], [1, 24, [[0, -1.2, 0.7], [3, -0.8, 0.5], [6, 1.0, 0.4]]], [1, 36, [[0, 1.1, 0.9]]],
  [1, 50, [[0, -0.9, 0.55], [2.5, -1.4, 0.4]]], [1, 62, [[0, 0.7, 0.6]]], [1, 78, [[0, -1.1, 0.7], [3, 1.2, 0.5]]],
  [2, 8, [[0, 0.8, 0.6], [2.5, -1.0, 0.5]]], [2, 14, [[0, -0.5, 0.8]]], [3, 6, [[0, 1.0, 0.6]]], [3, 12, [[0, -1.1, 0.5], [2, -0.7, 0.4]]]
];
function tarmacCount(x, z) {
  let n = Math.abs(loopInfo(x, z).u) <= HW + 1.2 ? 1 : 0;
  for (const e of LINES) {
    const px = x - e.ax, pz = z - e.az, t = clamp(px * e.dx + pz * e.dz, 0, e.len);
    if (Math.hypot(px - e.dx * t, pz - e.dz * t) <= HW + 1.2) n++;
  }
  return n;
}
const POTS = [];
CLUSTERS.forEach(c => c[2].forEach(it => {
  const ei = c[0], t = c[1] + it[0], p = edgePoint(ei, t, it[1]);
  if (tarmacCount(p.x, p.z) > 1) return;
  if (ei === 0 && p.z > -3 && ((p.x > -13.5 && p.x < -10.5) || (p.x > 5 && p.x < 8.6))) return;
  POTS.push({ x: p.x, z: p.z, r: it[2], depth: it[2] >= 0.7 ? 2 : 1, edge: ei });
}));
function potholeAt(x, z, pad) {
  for (let i = 0; i < POTS.length; i++) {
    const p = POTS[i], dx = x - p.x, dz = z - p.z, r = p.r + (pad || 0);
    if (dx * dx + dz * dz < r * r) return i;
  }
  return -1;
}

// ---- One ground column: surface kind and continuous height at (x, z) ----
const out = { h: 0, kind: 0, wall: 0, depth: 0, d: 0, edge: 0, u: 0, t: 0, tarmac: 0 };
const ds = new Float64Array(4), hs = new Float64Array(4), bio = { hills: 0, rock: 0, scrub: 0, lake: 0 };
function column(x, z, v) {
  const li = loopInfo(x, z);
  let bd = Math.abs(li.u), bu = li.u, bt = li.s, bE = 0, nT = bd <= HW ? 1 : 0;
  ds[0] = bd; hs[0] = loopF(((li.s % LTOT) + LTOT) % LTOT);
  for (let i = 0; i < LINES.length; i++) {
    const e = LINES[i], px = x - e.ax, pz = z - e.az, t = clamp(px * e.dx + pz * e.dz, 0, e.len);
    const cx = px - e.dx * t, cz = pz - e.dz * t, d = Math.hypot(cx, cz), side = px * e.nx + pz * e.nz;
    ds[i + 1] = d; hs[i + 1] = e.f(t);
    if (d <= HW) nT++;
    if (d < bd) { bd = d; bu = side < 0 ? -d : d; bt = t; bE = i + 1; }
  }
  let roadH = hs[bE];
  for (let j = 0; j < JUNC.length; j++) {
    const J = JUNC[j], dj = Math.hypot(x - J.x, z - J.z);
    if (dj < 5.5) roadH = lerp(roadH, J.h, 1 - sstep(3.0, 5.5, dj));
  }
  out.d = bd; out.u = bu; out.t = bt; out.edge = bE; out.tarmac = nT; out.wall = 0; out.depth = 0;

  if (nT >= 1) {
    out.h = roadH; let kind = K.ROAD;
    if (nT < 2) {
      const au = Math.abs(bu);
      if (au >= 1.75 && au < 2.0) kind = K.EDGE;
      else if (au < 0.125 && ((((bt - 4.5) % 1.5) + 1.5) % 1.5) < 0.75) kind = K.DASH;
      if (bE === 0 && z > -R && au <= HW) {
        if (x >= 6.0 && x < 7.6 && bu >= -1.5 && bu < 1.8 && (((bu + 1.5) % 0.6) + 0.6) % 0.6 < 0.3) kind = K.ZEBRA;
        if (Math.abs(x + 12) < 0.5) kind = ((Math.floor((bu + HW) / 0.5) + Math.floor((x + 12.5) / 0.5)) & 1) ? K.CHKD : K.CHKW;
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
  for (let i = 0; i < 4; i++) { const w = 1 / Math.pow(ds[i] + 2, 3); sw += w; sh += w * hs[i]; }
  let H = sh / sw;
  biomes(x, z, bio);
  const n1 = vn(x, z, 18, 1), n2 = vn(x, z, 7, 2), n3 = vn(x, z, 3.2, 4);
  H += 0.5 * (n1 - 0.5) * 2;
  H += bio.hills * (1.6 + 3.2 * n1 + 0.8 * n2);
  const ridge = 1 - Math.abs(2 * n2 - 1);
  H += bio.rock * (2.2 + 4.6 * ridge + 1.0 * n3);
  H += bio.scrub * 0.9 * (n1 - 0.5) * 2;
  H -= bio.lake * 3.4;
  for (let i = 0; i < FLATS.length; i++) {
    const r = FLATS[i], dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
    H = lerp(H, r.h, 1 - sstep(0, r.m, Math.hypot(dx, dz)));
  }
  H = lerp(roadH, H, sstep(PAV, PAV + 4.5, bd));
  H = clamp(H, Y_MIN + 0.4, Y_MAX - 0.4);
  let kind = K.GRASS;
  const inLake = bio.lake > 0.08;
  if (inLake && H < WATER) { kind = K.WATER; H = WATER; }
  else if (inLake && H < WATER + 0.5) kind = K.SAND;
  else if (bio.rock > 0.42) kind = n3 > 0.55 ? K.ROCK2 : K.ROCK;
  else if (bio.scrub > 0.5) kind = n3 > 0.72 ? K.LATER : K.SCRUB;
  out.h = H; out.kind = kind; out.wall = bd < PAV + 5 ? 1 : 0;
  return out;
}
function heightAt(x, z) { return column(x, z, 0.2).h; }

// ---- Ground builder: one column of cubes per cell, grouped into 12 m chunks ----
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
async function buildGround(v, tick) {
  const x0 = SLAB.x0, z0 = SLAB.z0;
  const nx = Math.ceil((SLAB.x1 - x0) / v - 1e-6), nz = Math.ceil((SLAB.z1 - z0) / v - 1e-6);
  const BOT = Math.round(Y_MIN / v), layN = Math.max(1, Math.round(0.25 / v)), kerbN = layN;
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
  const CH = 12, chunks = new Map();
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

return { L, R, HW, PAV, LTOT, SLAB, WATER, Y_MIN, Y_MAX, K, COLS, MULT, LINES, JUNC, FLATS, POTS, loopInfo, trackPoint, loopH, loopF, column, heightAt,
  edgeLen, edgeH, edgePoint, inFlat, potholeAt, tarmacCount, buildGround, hfY, hfKind, S_EAST, S_WEST, S_FAR0, hash3, vn, biomes };
})();
