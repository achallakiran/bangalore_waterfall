// Hill Loop Track game core, carried over unchanged from the published v1 build (see tools/make-game-from-legacy.py).
// Rendering, shading, physics and world are frozen; only the listed hooks differ (mount/dispose, pause, units, touch pad).
import { createWorld } from '../../engine/world.js';
import { budgetFor, planMemory } from '../../engine/budget.js';
import { createSky } from './sky.js';
import { createEdge } from './edge.js';
import { createContact, effectiveHeight } from './contact.js';

const THREE = window.THREE;
export function boot(hooks, map) {
'use strict';
hooks = hooks || {};
const World = createWorld(map);   // everything map-specific (roads, terrain, potholes, scenery, start, traffic) comes from the map file
let alive = true, rafId = 0;
const _L = [];
const on = (t, e, f, o) => { t.addEventListener(e, f, o); _L.push([t, e, f, o]); };

// ===== Voxel core, copied from the Style Gallery =====
const B = (x0, y0, z0, x1, y1, z1, col, jit) => ({ k: 'b', b: [x0, y0, z0, x1, y1, z1], col, jit });
const PT = (x0, y0, z0, x1, y1, z1, col) => ({ k: 'b', b: [x0, y0, z0, x1, y1, z1], col, jit: 0.02, paint: true });
const S = (cx, cy, cz, r, col, jit) => ({ k: 's', c: [cx, cy, cz], r, b: [cx - r, cy - r, cz - r, cx + r, cy + r, cz + r], col, jit });
const C = (ax, a, bb, r, t0, t1, col, jit) => {
  let b;
  if (ax === 'y') b = [a - r, t0, bb - r, a + r, t1, bb + r];
  else if (ax === 'z') b = [a - r, bb - r, t0, a + r, bb + r, t1];
  else b = [t0, a - r, bb - r, t1, a + r, bb + r];
  return { k: 'c', ax, a, bb, r, t0, t1, b, col, jit };
};
// Oriented box (turned about the vertical axis by yaw degrees). Yaw 0 is the plain axis-aligned box, so nothing already drawn changes.
const OB = (cx, cz, hx, hz, yawDeg, y0, y1, col, jit, paint) => {
  if (!yawDeg) return paint ? PT(cx - hx, y0, cz - hz, cx + hx, y1, cz + hz, col) : B(cx - hx, y0, cz - hz, cx + hx, y1, cz + hz, col, jit);
  const a = yawDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
  return { k: 'o', cx, cz, hx, hz, c, s, y0, y1, b: [cx - ex, y0, cz - ez, cx + ex, y1, cz + ez], col, jit: paint ? 0.02 : jit, paint: !!paint };
};
function inside(p, x, y, z) {
  if (p.k === 'o') {
    if (y < p.y0 || y >= p.y1) return false;
    const dx = x - p.cx, dz = z - p.cz, lx = dx * p.c - dz * p.s, lz = dx * p.s + dz * p.c;
    return lx >= -p.hx && lx < p.hx && lz >= -p.hz && lz < p.hz;
  }
  if (p.k === 'b') { const b = p.b; return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; }
  if (p.k === 's') { const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2]; return dx * dx + dy * dy + dz * dz <= p.r * p.r; }
  let r1, r2, t;
  if (p.ax === 'y') { r1 = x - p.a; r2 = z - p.bb; t = y; }
  else if (p.ax === 'z') { r1 = x - p.a; r2 = y - p.bb; t = z; }
  else { r1 = y - p.a; r2 = z - p.bb; t = x; }
  return t >= p.t0 && t < p.t1 && r1 * r1 + r2 * r2 <= p.r * p.r;
}
function hash3(i, j, k, s) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483629) + Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function voxelize(prims, min, max, v, seed) {
  const nx = Math.ceil((max[0] - min[0]) / v - 1e-6);
  const ny = Math.ceil((max[1] - min[1]) / v - 1e-6);
  const nz = Math.ceil((max[2] - min[2]) / v - 1e-6);
  const sy = nx, sz = nx * ny;
  const grid = new Int32Array(nx * ny * nz);
  for (let n = 0; n < prims.length; n++) {
    const p = prims[n], b = p.b;
    const i0 = Math.max(0, Math.floor((b[0] - min[0]) / v)), i1 = Math.min(nx - 1, Math.floor((b[3] - min[0]) / v));
    const j0 = Math.max(0, Math.floor((b[1] - min[1]) / v)), j1 = Math.min(ny - 1, Math.floor((b[4] - min[1]) / v));
    const k0 = Math.max(0, Math.floor((b[2] - min[2]) / v)), k1 = Math.min(nz - 1, Math.floor((b[5] - min[2]) / v));
    for (let k = k0; k <= k1; k++) {
      const cz = min[2] + (k + 0.5) * v;
      for (let j = j0; j <= j1; j++) {
        const cy = min[1] + (j + 0.5) * v;
        for (let i = i0; i <= i1; i++) {
          const id = i + sy * j + sz * k;
          if (p.paint && !grid[id]) continue;
          if (inside(p, min[0] + (i + 0.5) * v, cy, cz)) grid[id] = n + 1;
        }
      }
    }
  }
  const pos = [], col = [];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const id = i + sy * j + sz * k;
        const o = grid[id];
        if (!o) continue;
        const exposed = i === 0 || i === nx - 1 || j === 0 || j === ny - 1 || k === 0 || k === nz - 1 ||
          !grid[id - 1] || !grid[id + 1] || !grid[id - sy] || !grid[id + sy] || !grid[id - sz] || !grid[id + sz];
        if (!exposed) continue;
        const p = prims[o - 1];
        const cy = min[1] + (j + 0.5) * v;
        const jt = p.jit === undefined ? 0.05 : p.jit;
        const f = (1 + (hash3(i, j, k, seed) - 0.5) * 2 * jt) * (cy < -0.01 ? 0.85 : 0.8 + 0.2 * Math.min(1, cy / 1.5));
        const c = p.col;
        pos.push(min[0] + (i + 0.5) * v, cy, min[2] + (k + 0.5) * v);
        col.push(Math.min(1, ((c >> 16) & 255) / 255 * f), Math.min(1, ((c >> 8) & 255) / 255 * f), Math.min(1, (c & 255) / 255 * f));
      }
    }
  }
  return { count: pos.length / 3, pos: new Float32Array(pos), col: new Float32Array(col), v };
}

const $ = id => document.getElementById(id);
// Everything the game queries or listens to lives inside its own screen. Searching the whole document would also catch the menu's buttons
// (and keep this game's closures alive on them after it is closed).
const gameRootEl = $('stage');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// ===== Scenery: the gallery block plus more of the same, standing on the terrain =====
const { L, R, HW, PAV, LTOT, SLAB, K } = World;
const SOLIDS = [];
const box = (x0, z0, x1, z1) => SOLIDS.push({ t: 'b', x0, z0, x1, z1 });
const circ = (x, z, r) => SOLIDS.push({ t: 'c', x, z, r });
const obox = (x, z, hx, hz, yawDeg) => { if (!yawDeg) return box(x - hx, z - hz, x + hx, z + hz); const a = yawDeg * Math.PI / 180; SOLIDS.push({ t: 'o', x, z, hx, hz, c: Math.cos(a), s: Math.sin(a) }); };
const gh = (x, z) => World.heightAt(x, z);

// Map files give colours as "#RRGGBB" (or a number) and heights either as numbers or as { pad, add } (a pad's height plus an offset).
const col = c => (typeof c === 'string' ? parseInt(c.slice(1), 16) : c);
const nv = v => (typeof v === 'object' ? World.pad(v.pad).h + v.add : v);
function windowsRow(P, xa, xb, zf, ys, wh, ww, pitch, cols) {
  let ix = 0;
  for (let x = xa; x + ww <= xb + 1e-6; x += pitch, ix++) {
    ys.forEach((y0, iy) => P.push(PT(x, y0, zf - 0.45, x + ww, y0 + wh, zf + 0.05, cols[(ix * 3 + iy * 5) % cols.length])));
  }
}
function tree(P, x, z, h, r) {
  const y0 = gh(x, z);
  P.push(C('y', x, z, 0.3, y0 - 0.3, y0 + h * 0.55, 0x7A5233, 0.06));
  P.push(S(x, y0 + h * 0.55 + r * 0.6, z, r, 0x3F9B3F, 0.12));
  P.push(S(x + r * 0.55, y0 + h * 0.55 + r * 0.3, z - r * 0.3, r * 0.7, 0x4DAA45, 0.12));
  P.push(S(x - r * 0.5, y0 + h * 0.55 + r * 0.35, z + r * 0.3, r * 0.65, 0x367F38, 0.12));
  circ(x, z, 0.5);
}
// Rocks and pebbles are part of the ground the wheels read (rockBump, added in gY): a small rock is a bump to climb, a tall one is also
// solid so it blocks. Pebbles are a light roughness. ROCKS/PEBS are cleared with the other objects when the map is built.
const ROCKS = new Map(), PEBS = [], ROCK_SOLID_R = 0.55;
const rkey = (x, z) => Math.floor(x / 2) + ',' + Math.floor(z / 2);
function addRockBump(x, z, r) {
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const k = rkey(x + a * 2, z + b * 2); let l = ROCKS.get(k); if (!l) ROCKS.set(k, l = []); if (!l.some(q => q.x === x && q.z === z)) l.push({ x, z, r }); }
}
function rockBump(x, z) {
  let m = 0;
  const l = ROCKS.get(rkey(x, z));
  if (l) for (let i = 0; i < l.length; i++) {
    const q = l[i], d = Math.hypot(x - q.x, z - q.z);
    if (d < q.r * 0.917) { const h = 0.4 * q.r + Math.sqrt(q.r * q.r - d * d); if (h > m) m = h; }
  }
  for (let i = 0; i < PEBS.length; i++) {
    const q = PEBS[i], d = Math.hypot(x - q.x, z - q.z);
    if (d < q.r) { const nz = Math.sin(Math.floor(x * 9) * 12.9898 + Math.floor(z * 9) * 78.233) * 43758.5453; const h = 0.035 * (nz - Math.floor(nz)) * (1 - d / q.r); if (h > m) m = h; }
  }
  return m;
}
function rockAt(P, x, z, r, seed) {
  const y0 = gh(x, z), h = (k) => { let q = Math.imul((seed | 0) + k * 7919, 374761393); q = Math.imul(q ^ (q >>> 13), 1274126177); return ((q ^ (q >>> 16)) >>> 0) / 4294967296; };
  const greys = [0x8E959B, 0x7B8289, 0x9A9690, 0x6F757C];
  P.push(S(x, y0 + r * 0.4, z, r, greys[Math.floor(h(1) * 4)], 0.1));
  if (r >= 0.4) P.push(S(x + r * (0.5 + h(2) * 0.4) * (h(3) < 0.5 ? -1 : 1), y0 + r * 0.22, z + r * (0.3 + h(4) * 0.4) * (h(5) < 0.5 ? -1 : 1), r * 0.55, greys[Math.floor(h(6) * 4)], 0.1));
  addRockBump(x, z, r);
  if (r > ROCK_SOLID_R) circ(x, z, r * 0.85);   // only a tall rock blocks; a small one is a bump the wheels climb
}
function pebblesAt(P, x, z, n, spread, seed) {
  PEBS.push({ x, z, r: spread });
  const h = (k) => { let q = Math.imul((seed | 0) + k * 6151, 374761393); q = Math.imul(q ^ (q >>> 13), 1274126177); return ((q ^ (q >>> 16)) >>> 0) / 4294967296; };
  const greys = [0x9A9690, 0x8A8F94, 0xA8A39A, 0x77797C, 0xB3AA98];
  for (let i = 0; i < n; i++) {
    const a = h(i * 3 + 1) * 6.2832, d = Math.sqrt(h(i * 3 + 2)) * spread, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, s = 0.04 + h(i * 3 + 3) * 0.07;
    P.push(S(px, gh(px, pz) + s * 0.4, pz, s, greys[i % greys.length], 0.1));
  }
}
function boulder(P, x, z, r) {
  const y0 = gh(x, z);
  P.push(S(x, y0 + r * 0.35, z, r, 0x8E959B, 0.08));
  P.push(S(x + r * 0.75, y0 + r * 0.2, z + r * 0.3, r * 0.6, 0x717880, 0.08));
  circ(x, z, r * 0.8);
}
// Street lamp standing on a kerb whose top is y0; e = -1 reaches toward -z, +1 toward +z. The gallery lamp is e = -1, y0 = 0.25, z = 2.65.
function lamp(P, x, zp, e, y0) {
  P.push(C('y', x, zp, 0.2, y0, y0 + 4.15, 0x2F3439, 0.02));
  const a0 = zp + e * 0.95, a1 = zp - e * 0.05, l0 = zp + e * 1.25, l1 = zp + e * 0.65;
  P.push(B(x - 0.2, y0 + 3.95, Math.min(a0, a1), x + 0.2, y0 + 4.2, Math.max(a0, a1), 0x2F3439, 0.02));
  P.push(B(x - 0.3, y0 + 3.75, Math.min(l0, l1), x + 0.3, y0 + 3.95, Math.max(l0, l1), 0xFFE9A3, 0));
  circ(x, zp, 0.35);
}
// A building on the infield side of a straight, front face toward -z, standing on a pad at height y0.
function bldgN(P, it) {
  const zf = it.zf, y0 = World.pad(it.pad).h, x0 = it.x0, x1 = it.x1, depth = it.depth, h = it.h, ys = it.ys, ww = it.ww, pitch = it.pitch, cols = it.cols.map(col);
  P.push(B(x0, y0 - 0.4, zf, x1, y0 + h, zf + depth, col(it.wall), 0.05));
  P.push(B(x0 - 0.1, y0 + h, zf - 0.1, x1 + 0.1, y0 + h + 0.4, zf + depth + 0.1, col(it.trim), 0.05));
  for (let x = x0 + 0.5, ix = 0; x + ww <= x1 - 0.3; x += pitch, ix++) {
    ys.forEach((yy, iy) => P.push(PT(x, y0 + yy, zf - 0.05, x + ww, y0 + yy + 0.9, zf + 0.45, cols[(ix * 3 + iy * 5) % cols.length])));
  }
  P.push(PT(x0 + 1.0, y0, zf - 0.05, x0 + 2.0, y0 + 1.8, zf + 0.45, 0x6B4A33));
  box(x0, zf, x1, zf + depth);
}
// A building standing on a pad that may be turned to face the road: centre, width, depth, height and yaw (degrees).
// Local frame: x along the front face, z away from it (front face at -depth/2). Yaw 0 draws exactly what bldgN draws.
function bldgY(P, it) {
  const y0 = World.pad(it.pad).h, cx = it.cx, cz = it.cz, w = it.w, depth = it.depth, h = it.h, yaw = it.yaw || 0, cols = it.cols.map(col);
  const a = yaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const hw = w / 2, zf = -depth / 2;
  const W = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  const mk = (lx0, lz0, lx1, lz1, ya, yb, colr, jit, paint) => {
    if (!yaw) return OB(cx + (lx0 + lx1) / 2, cz + (lz0 + lz1) / 2, (lx1 - lx0) / 2, (lz1 - lz0) / 2, 0, ya, yb, colr, jit, paint);
    const q = W((lx0 + lx1) / 2, (lz0 + lz1) / 2);
    return OB(q[0], q[1], (lx1 - lx0) / 2, (lz1 - lz0) / 2, yaw, ya, yb, colr, jit, paint);
  };
  P.push(mk(-hw, zf, hw, zf + depth, y0 - 0.4, y0 + h, col(it.wall), 0.05));
  P.push(mk(-hw - 0.1, zf - 0.1, hw + 0.1, zf + depth + 0.1, y0 + h, y0 + h + 0.4, col(it.trim), 0.05));
  for (let x = -hw + 0.5, ix = 0; x + it.ww <= hw - 0.3; x += it.pitch, ix++) {
    it.ys.forEach((yy, iy) => P.push(mk(x, zf - 0.05, x + it.ww, zf + 0.45, y0 + yy, y0 + yy + 0.9, cols[(ix * 3 + iy * 5) % cols.length], 0, true)));
  }
  P.push(mk(-hw + 1.0, zf - 0.05, -hw + 2.0, zf + 0.45, y0, y0 + 1.8, 0x6B4A33, 0, true));
  obox(cx, cz, hw, depth / 2, yaw);
}
function cone(P, x, z, y0) {
  P.push(B(x - 0.25, y0, z - 0.25, x + 0.25, y0 + 0.08, z + 0.25, 0x23252B, 0));
  P.push(C('y', x, z, 0.2, y0 + 0.08, y0 + 0.3, 0xF28C28, 0.02));
  P.push(C('y', x, z, 0.12, y0 + 0.3, y0 + 0.55, 0xF28C28, 0.02));
  P.push(C('y', x, z, 0.16, y0 + 0.24, y0 + 0.34, 0xF4F1EA, 0));
}

// Scenery comes from map.scenery, in file order (order matters: window paint goes on top of the wall drawn before it).
function buildObjects() {
  SOLIDS.length = 0; ROCKS.clear(); PEBS.length = 0;
  const P = [];
  for (const it of map.scenery) {
    switch (it.t) {
      case 'prims':
        it.p.forEach(q => {
          const k = q[0];
          if (k === 'B') P.push(B(nv(q[1]), nv(q[2]), nv(q[3]), nv(q[4]), nv(q[5]), nv(q[6]), col(q[7]), q[8]));
          else if (k === 'PT') P.push(PT(nv(q[1]), nv(q[2]), nv(q[3]), nv(q[4]), nv(q[5]), nv(q[6]), col(q[7])));
          else if (k === 'C') P.push(C(q[1], q[2], q[3], q[4], nv(q[5]), nv(q[6]), col(q[7]), q[8]));
          else if (k === 'S') P.push(S(q[1], nv(q[2]), q[3], q[4], col(q[5]), q[6]));
          else if (k === 'OB') P.push(OB(q[1], q[2], q[3], q[4], q[5], nv(q[6]), nv(q[7]), col(q[8]), q[9]));
          else if (k === 'OPT') P.push(OB(q[1], q[2], q[3], q[4], q[5], nv(q[6]), nv(q[7]), col(q[8]), 0, true));
        });
        it.solids.forEach(q => { if (q[0] === 'b') box(q[1], q[2], q[3], q[4]); else if (q[0] === 'o') obox(q[1], q[2], q[3], q[4], q[5]); else circ(q[1], q[2], q[3]); });
        break;
      case 'windows': windowsRow(P, it.xa, it.xb, it.zf, it.ys, it.wh, it.ww, it.pitch, it.cols.map(col)); break;
      case 'tree': tree(P, it.x, it.z, it.h, it.r); break;
      case 'rock': rockAt(P, it.x, it.z, it.r, it.seed || 0); break;
      case 'pebbles': pebblesAt(P, it.x, it.z, it.n, it.r, it.seed || 0); break;
      case 'lamp': lamp(P, it.x, it.z, it.e, nv(it.y0)); break;
      case 'bldgN': bldgN(P, it); break;
      case 'bldgY': bldgY(P, it); break;
      case 'guardposts': {
        // Guard posts where the road runs along a drop of more than a metre (hill-road look).
        it.edges.forEach(ei => {
          const n = World.edgeLen(ei);
          let pi = 0;
          for (let t = it.from; t < n - 1; t += it.step) {
            [-1, 1].forEach(sd => {
              const p = World.edgePoint(ei, t, sd * it.offset), q = World.edgePoint(ei, t, sd * (PAV + it.outer));
              if (World.tarmacCount(p.x, p.z) > 1 || World.tarmacCount(q.x, q.z) > 1) return;
              const rh = World.edgeH(ei, t), drop = rh - gh(q.x, q.z);
              if (drop < it.minDrop) return;
              P.push(B(p.x - 0.12, rh - 0.1, p.z - 0.12, p.x + 0.12, rh + 0.85, p.z + 0.12, (pi++ & 1) ? col(it.colors[0]) : col(it.colors[1]), 0));
              circ(p.x, p.z, 0.2);
            });
          }
        });
        break;
      }
      case 'cones':
        // Cones ahead of some pothole clusters, on the shoulder inside the edge line.
        it.at.forEach(c => {
          it.u.forEach(u => { const p = World.edgePoint(c[0], Math.max(0.5, c[1] - it.back), u); cone(P, p.x, p.z, World.edgeH(c[0], Math.max(0.5, c[1] - it.back))); });
        });
        break;
      case 'scatter': {
        // Trees on a jittered lattice and boulders in the rock country; clear of roads, pads and steep ground.
        const g = it.grid, bd = it.bounds, pr = it.probe;
        for (let gx2 = g.x0; gx2 <= g.x1; gx2 += g.step) {
          for (let gz = g.z0; gz <= g.z1; gz += g.step) {
            const hx = World.hash3(Math.round(gx2 * 10), Math.round(gz * 10), 7, 11);
            const hz = World.hash3(Math.round(gx2 * 10), Math.round(gz * 10), 13, 5);
            const hk = World.hash3(Math.round(gx2 * 10), Math.round(gz * 10), 17, 9);
            const x = gx2 + (hx - 0.5) * it.jitter, z = gz + (hz - 0.5) * it.jitter;
            if (x < bd.x0 || x > bd.x1 || z < bd.z0 || z > bd.z1) continue;
            const c = World.column(x, z, 0.2), kind = c.kind, d = c.d, h = c.h;
            if (d < PAV + it.clearRoad || World.inFlat(x, z, it.clearPad)) continue;
            const slope = Math.max(Math.abs(gh(x + pr, z) - h), Math.abs(gh(x - pr, z) - h), Math.abs(gh(x, z + pr) - h), Math.abs(gh(x, z - pr) - h));
            if (kind === K.ROCK || kind === K.ROCK2) { if (hk < it.boulder.p && slope < it.boulder.maxSlope) boulder(P, x, z, it.boulder.r0 + hx * it.boulder.rs); continue; }
            if (slope > it.maxSlope) continue;
            const gt = it.grassTree, st = it.scrubTree;
            if (kind === K.GRASS && hk < gt.p) tree(P, x, z, gt.h0 + hk * gt.hs, gt.r0 + hx * gt.rs);
            else if (kind === K.SCRUB && hk < st.p) tree(P, x, z, st.h0 + hk * st.hs, st.r0 + hx * st.rs);
          }
        }
        break;
      }
    }
  }
  return P;
}

// Voxelize in 16 m tiles on the global lattice, so a bigger map never needs one giant grid.
function tileIndex(P, v) {
  const T = Math.round(16 / v) * v, tiles = new Map();
  P.forEach((p, idx) => {
    const b = p.b;
    for (let tx = Math.floor(b[0] / T); tx <= Math.floor((b[3] - 1e-6) / T); tx++) for (let tz = Math.floor(b[2] / T); tz <= Math.floor((b[5] - 1e-6) / T); tz++) {
      const key = tx + ',' + tz; let a = tiles.get(key);
      if (!a) { a = { tx, tz, list: [] }; tiles.set(key, a); }
      a.list.push(p);
    }
  });
  return { T, tiles };
}
function voxelTile(t, T, v, seed) {
  let y0 = 1e9, y1 = -1e9;
  t.list.forEach(p => { if (p.b[1] < y0) y0 = p.b[1]; if (p.b[4] > y1) y1 = p.b[4]; });
  y0 = Math.floor(y0 / v) * v; y1 = Math.ceil(y1 / v) * v + v;
  return voxelize(t.list, [t.tx * T, y0, t.tz * T], [(t.tx + 1) * T, y1, (t.tz + 1) * T], v, seed);
}
function voxelTiled(P, v, seed) {
  const { T, tiles } = tileIndex(P, v);
  const pos = [], col = [];
  tiles.forEach(t => {
    const d = voxelTile(t, T, v, seed);
    for (let i = 0; i < d.pos.length; i++) pos.push(d.pos[i]);
    for (let i = 0; i < d.col.length; i++) col.push(d.col[i]);
  });
  return { count: pos.length / 3, pos: new Float32Array(pos), col: new Float32Array(col), v };
}

const BIKE_MIN = [-1.5, 0, -0.7], BIKE_MAX = [1.3, 2.7, 0.7];
const AUTO_MIN = [-1.6, 0, -0.9], AUTO_MAX = [1.5, 2.2, 0.9];
const CAR_MIN = [-2.1, 0, -1.0], CAR_MAX = [2.1, 1.7, 1.0];
function buildBike() {
  return [
    C('z', -0.8, 0.38, 0.38, -0.13, 0.13, 0x1D1E22, 0), C('z', 0.8, 0.38, 0.38, -0.13, 0.13, 0x1D1E22, 0),
    C('z', -0.8, 0.38, 0.15, -0.16, 0.16, 0xB8BEC4, 0), C('z', 0.8, 0.38, 0.15, -0.16, 0.16, 0xB8BEC4, 0),
    B(-0.7, 0.5, -0.15, 0.55, 0.95, 0.15, 0xD8392B, 0.03), B(-0.1, 0.9, -0.2, 0.5, 1.12, 0.2, 0xD8392B, 0.03),
    B(-0.75, 0.95, -0.18, -0.05, 1.1, 0.18, 0x1E1E22, 0), B(0.5, 0.4, -0.1, 0.64, 1.1, 0.1, 0xAEB6BD, 0),
    B(0.5, 1.05, -0.55, 0.66, 1.2, 0.55, 0x1E1E22, 0), B(0.62, 0.85, -0.15, 0.82, 1.08, 0.15, 0xFFE9A3, 0),
    B(-1.0, 0.35, 0.14, -0.2, 0.55, 0.32, 0x8B9299, 0.02), B(-0.5, 0.95, 0.14, 0.15, 1.2, 0.36, 0x2C3E66, 0.03),
    B(-0.5, 0.95, -0.36, 0.15, 1.2, -0.14, 0x2C3E66, 0.03), B(0.0, 0.5, 0.14, 0.22, 1.2, 0.36, 0x2C3E66, 0.03),
    B(0.0, 0.5, -0.36, 0.22, 1.2, -0.14, 0x2C3E66, 0.03), B(-0.6, 1.1, -0.28, -0.1, 1.95, 0.28, 0x2F6DB5, 0.04),
    B(-0.2, 1.3, 0.24, 0.56, 1.5, 0.44, 0x2F6DB5, 0.03), B(-0.2, 1.3, -0.44, 0.56, 1.5, -0.24, 0x2F6DB5, 0.03),
    B(-0.9, 1.3, -0.26, -0.6, 1.9, 0.26, 0x2A9D8F, 0.04), S(-0.3, 2.2, 0, 0.28, 0xE0AC82, 0.02), S(-0.3, 2.3, 0, 0.35, 0xF2A900, 0.02)
  ];
}
function buildAuto() {
  return [
    C('z', 1.05, 0.3, 0.3, -0.13, 0.13, 0x1D1E22, 0), C('z', -0.8, 0.3, 0.3, 0.42, 0.7, 0x1D1E22, 0), C('z', -0.8, 0.3, 0.3, -0.7, -0.42, 0x1D1E22, 0),
    B(-1.25, 0.3, -0.62, 0.75, 0.8, 0.62, 0x23252B, 0.02), B(0.7, 0.3, -0.4, 1.35, 0.9, 0.4, 0x23252B, 0.02), B(1.3, 0.5, -0.2, 1.42, 0.7, 0.2, 0xFFE9A3, 0),
    B(-1.1, 0.8, -0.5, -0.2, 1.15, 0.5, 0x7A2E2E, 0.04), B(-1.25, 0.8, -0.62, -0.97, 1.7, -0.34, 0xF2C200, 0.02), B(-1.25, 0.8, 0.34, -0.97, 1.7, 0.62, 0xF2C200, 0.02),
    B(0.45, 0.8, -0.62, 0.73, 1.7, -0.34, 0xF2C200, 0.02), B(0.45, 0.8, 0.34, 0.73, 1.7, 0.62, 0xF2C200, 0.02), B(0.5, 0.9, -0.58, 0.7, 1.7, 0.58, 0xA7D2EA, 0),
    B(-1.35, 1.7, -0.75, 0.85, 1.95, 0.75, 0xF2C200, 0.03), B(0.6, 1.0, -0.45, 0.8, 1.15, 0.45, 0x23252B, 0), B(-0.45, 0.85, -0.2, 0.0, 1.5, 0.2, 0x7F8F6B, 0.04),
    S(-0.2, 1.62, 0, 0.2, 0xB9825C, 0.02)
  ];
}
// New: a small hatchback in the same blocky vocabulary (white body, red roof, light-blue glass).
function buildCar() {
  const W = 0xF4F1EA, RD = 0xD9453D, GL = 0x8FB8D4, K = 0x1D1E22, D = 0x23252B, SV = 0xB8BEC4;
  const P = [];
  [[1.2, -1], [1.2, 1], [-1.2, -1], [-1.2, 1]].forEach(w => {
    const z0 = w[1] > 0 ? 0.58 : -0.84, z1 = w[1] > 0 ? 0.84 : -0.58;
    P.push(C('z', w[0], 0.34, 0.34, z0, z1, K, 0));
    const h0 = w[1] > 0 ? 0.8 : -0.86, h1 = w[1] > 0 ? 0.86 : -0.8;
    P.push(C('z', w[0], 0.34, 0.16, h0, h1, SV, 0));
  });
  P.push(B(-1.85, 0.28, -0.8, 1.85, 0.85, 0.8, W, 0.03));
  P.push(B(1.8, 0.28, -0.8, 1.94, 0.46, 0.8, D, 0));
  P.push(B(-1.94, 0.28, -0.8, -1.8, 0.46, 0.8, D, 0));
  P.push(B(-1.0, 0.85, -0.72, 0.7, 1.42, 0.72, W, 0.03));
  P.push(B(0.7, 0.85, -0.68, 0.98, 1.12, 0.68, GL, 0));
  P.push(B(-1.12, 0.85, -0.68, -0.98, 1.25, 0.68, GL, 0));
  P.push(B(-1.05, 1.42, -0.75, 0.78, 1.52, 0.75, RD, 0.02));
  P.push(PT(-0.85, 0.95, 0.66, 0.55, 1.38, 0.78, GL));
  P.push(PT(-0.85, 0.95, -0.78, 0.55, 1.38, -0.66, GL));
  P.push(PT(-0.1, 0.9, 0.66, 0.0, 1.42, 0.78, W));
  P.push(PT(-0.1, 0.9, -0.78, 0.0, 1.42, -0.66, W));
  [[0.45, 0.75], [-0.75, -0.45]].forEach(z => {
    P.push(B(1.88, 0.55, z[0], 1.98, 0.72, z[1], 0xFFE9A3, 0));
    P.push(B(-1.98, 0.55, z[0], -1.88, 0.72, z[1], 0xD62E2E, 0));
  });
  P.push(B(1.9, 0.5, -0.3, 1.97, 0.7, 0.3, D, 0));
  return P;
}

// ===== Vehicle handling. Speeds are in m/s; the HUD shows km/h. =====
const VEH = {
  car: { maxF: 15.5, maxR: 5, acc: 7.5, brk: 16, wb: 2.3, sMax: 0.5, sMin: 0.16, circ: [-0.95, 0.95], r: 0.85, camD: 19, lean: 0.03, wheels: [[1.2, -0.72], [1.2, 0.72], [-1.2, -0.72], [-1.2, 0.72]], wob: 0.75,
    ct: { wheels: [[1.2, -0.72], [1.2, 0.72], [-1.2, -0.72], [-1.2, 0.72]], R: 0.35, stat: 0.11, g: 20, upMul: 4, zeta: 0.55, droop: 0.25, stop: 0.3, climb: 0.6, rgP: 1.1, rgR: 0.6, pitchLimit: 0.7, rollLimit: 0.5 } },
  bike: { maxF: 19, maxR: 4, acc: 9.5, brk: 14, wb: 1.5, sMax: 0.7, sMin: 0.12, circ: [-0.5, 0.5], r: 0.45, camD: 15, lean: 0.42, wheels: [[0.8, 0], [-0.8, 0]], wob: 1.3,
    ct: { wheels: [[0.8, 0], [-0.8, 0]], R: 0.33, stat: 0.1, g: 20, upMul: 4, zeta: 0.5, droop: 0.3, stop: 0.28, climb: 0.6, rgP: 0.7, rgR: 0.4, pitchLimit: 0.8, rollLimit: 0.5 } }
};

// ===== Three.js =====
const canvas = $('gl');
function fail() { $('nogl').hidden = false; $('start').hidden = true; }
if (!window.THREE) { fail(); return; }
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { fail(); return; }
renderer.setClearColor(0x000000, 0);
const basePR = Math.min(window.devicePixelRatio || 1, 2);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 1, 340);
const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x8a7352, 0.6);
scene.add(hemi);
const sky = createSky(THREE, scene);   // gradient dome, sun, clouds; hidden in Classic mode
const edge = createEdge(THREE, scene, World);   // hills round the map edge, plus the slow-down near the wall
const sun = new THREE.DirectionalLight(0xfff2dc, 0.8);
sun.castShadow = true;
const smap = window.innerWidth < 700 ? 1024 : 2048;
sun.shadow.mapSize.set(smap, smap);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 140;
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
let shadowExt = 24;
function setShadowExt(e) {
  shadowExt = e;
  Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e });
  sun.shadow.camera.updateProjectionMatrix();
}
setShadowExt(24);

const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const cubeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
function makeMesh(data, shadowCast) {
  const m = new THREE.InstancedMesh(cubeGeo, cubeMat, Math.max(1, data.count));
  const d = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < data.count; i++) {
    d.position.set(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]);
    d.scale.setScalar(data.v);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
    c.setRGB(data.col[i * 3], data.col[i * 3 + 1], data.col[i * 3 + 2]);
    m.setColorAt(i, c);
  }
  if (!data.count) m.setColorAt(0, c);   // an empty mesh (a map with no scenery) still needs its colour buffer, or the renderer fails
  m.count = data.count;
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = shadowCast;
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

const state = { hour: hooks.hour !== undefined ? hooks.hour : 16.5, traffic: hooks.traffic !== undefined ? hooks.traffic : !reduced, orbit: false, lite: hooks.lite !== undefined ? hooks.lite : window.innerWidth < 700, cam: 'chase', phase: 'menu', pad: false, sound: false, paused: false };
const worldRoot = new THREE.Group();
scene.add(worldRoot);
const groundChunks = [];
let stream = null; // set only when the map is too big to hold whole (see streaming below)
function mkActor() { const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner); scene.add(root); return { root, inner }; }
const A = { pCar: mkActor(), pBike: mkActor(), nCar: mkActor(), nBike: mkActor(), nAuto: mkActor() };

function clearAll() {
  const kill = g => {
    const list = [];
    g.traverse(o => { if (o !== g) list.push(o); });
    list.forEach(o => { if (o.isInstancedMesh) o.dispose(); });
    while (g.children.length) g.remove(g.children[0]);
  };
  kill(worldRoot);
  Object.keys(A).forEach(k => { while (A[k].inner.children.length) A[k].inner.remove(A[k].inner.children[0]); });
  groundChunks.length = 0;
  if (stream) { stream.chunks.clear(); stream.tiles.clear(); stream = null; }
}

function sprite(cv, prims, min, max) {
  const v = 0.07, d = voxelize(prims, min, max, v, 2);
  const nx = Math.ceil((max[0] - min[0]) / v), ny = Math.ceil((max[1] - min[1]) / v);
  const best = new Float32Array(nx * ny).fill(-1e9), cols = new Array(nx * ny);
  let x0 = nx, x1 = 0, y0 = ny, y1 = 0;
  for (let i = 0; i < d.count; i++) {
    const px = Math.floor((d.pos[i * 3] - min[0]) / v), py = Math.floor((d.pos[i * 3 + 1] - min[1]) / v), z = d.pos[i * 3 + 2];
    const id = px + nx * py;
    if (z > best[id]) { best[id] = z; cols[id] = [d.col[i * 3], d.col[i * 3 + 1], d.col[i * 3 + 2]]; }
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const c = cols[px + nx * py];
    if (!c) continue;
    g.fillStyle = 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
    g.fillRect(px - x0, y1 - py, 1, 1);
  }
}

// ----- ground lookups (built heightfield) -----
let HF = null;
const gY = (x, z) => (HF && HF.stream ? HF.y(x, z) : World.hfY(HF, x, z)) + ((ROCKS.size || PEBS.length) ? rockBump(x, z) : 0);
const gKind = (x, z) => (HF && HF.stream ? HF.kind(x, z) : World.hfKind(HF, x, z));

// ----- build -----
const mods = { car: null, bike: null, auto: null, objects: null };
let buildId = 0;
const tick = () => new Promise(r => setTimeout(r, 0));
const mem = { setting: hooks.budget || 'auto', force: !!hooks.forceStream, tier: '', plan: null };
async function rebuild() {
  const id = ++buildId;
  $('busy').hidden = false;
  await tick();
  const v = Number($('vox').value) / 100;
  const t0 = performance.now();
  mods.objects = mods.objects || buildObjects();
  const bud = budgetFor(mem.setting);
  mem.tier = bud.tier;
  mem.plan = planMemory(World.SLAB, v, bud.cubes, { force: mem.force });
  if (mem.plan.stream) { await rebuildStreamed(id, v, t0); return; }
  const g = await World.buildGround(v, tick);
  if (id !== buildId) return;
  await tick();
  const ob = voxelTiled(mods.objects, v, 1);
  const car = voxelize(mods.car, CAR_MIN, CAR_MAX, v, 4), bike = voxelize(mods.bike, BIKE_MIN, BIKE_MAX, v, 2), auto = voxelize(mods.auto, AUTO_MIN, AUTO_MAX, v, 3);
  if (id !== buildId) return;
  clearAll();
  let cubes = 0;
  g.chunks.forEach(c => {
    const m = makeMesh(c, false);
    worldRoot.add(m);
    groundChunks.push({ mesh: m, box: new THREE.Box3(new THREE.Vector3(c.box[0], c.box[1], c.box[2]), new THREE.Vector3(c.box[3], c.box[4], c.box[5])) });
    cubes += c.count;
  });
  worldRoot.add(makeMesh(ob, true));
  cubes += ob.count;
  A.pCar.inner.add(makeMesh(car, true)); A.nCar.inner.add(makeMesh(car, true));
  A.pBike.inner.add(makeMesh(bike, true)); A.nBike.inner.add(makeMesh(bike, true));
  A.nAuto.inner.add(makeMesh(auto, true));
  cubes += car.count * 2 + bike.count * 2 + auto.count;
  HF = g.HF;
  makeMini();
  $('sStat').textContent = cubes.toLocaleString('en-IN') + ' cubes · ' + Math.round(World.LTOT) + ' m lap · ' + World.POTS.length + ' potholes · built in ' + Math.round(performance.now() - t0) + ' ms';
  applyVisibility();
  snapPlayer();
  $('busy').hidden = true;
}

// ===== Streaming: only the map near the player is kept in memory =====
// Used when the estimated cube count exceeds the device budget. The ground is built one 12 m chunk at a time
// (cube-for-cube the same as the whole build), scenery one 16 m tile at a time. Chunks and tiles far from the
// player are disposed, so memory stays under the budget however big the map is.
const STREAM_MAX_R = 100, STREAM_MS = 5;
async function rebuildStreamed(id, v, t0) {
  const car = voxelize(mods.car, CAR_MIN, CAR_MAX, v, 4), bike = voxelize(mods.bike, BIKE_MIN, BIKE_MAX, v, 2), auto = voxelize(mods.auto, AUTO_MIN, AUTO_MAX, v, 3);
  if (id !== buildId) return;
  clearAll();
  const grid = World.chunkGrid(v), store = World.createChunkStore(grid), ti = tileIndex(mods.objects, v);
  const perChunk = Math.pow(grid.CH / v, 2) * 1.35;
  stream = { v, grid, store, ti, chunks: new Map(), tiles: new Map(), groundCubes: 0, tileCubes: 0, peak: 0, pa: -1, pb: -1, want: [], wantSet: new Set(), eff: 0,
    maxChunks: Math.max(9, Math.floor(mem.plan.groundBudget / perChunk)), tileBudget: Math.floor(mem.plan.budget * 0.15), vehicleCubes: car.count * 2 + bike.count * 2 + auto.count };
  A.pCar.inner.add(makeMesh(car, true)); A.nCar.inner.add(makeMesh(car, true));
  A.pBike.inner.add(makeMesh(bike, true)); A.nBike.inner.add(makeMesh(bike, true));
  A.nAuto.inner.add(makeMesh(auto, true));
  HF = store;
  makeMini();
  applyVisibility();
  snapPlayer(); // loads the ring around the player
  streamStat(t0);
  $('busy').hidden = true;
}
function streamPlan() {
  const S = stream, CH = S.grid.CH, g = S.grid, px = P.x, pz = P.z, cand = [];
  for (let a = 0; a < g.na; a++) for (let b = 0; b < g.nb; b++) {
    if (g.iStart(a) < 0 || g.kStart(b) < 0) continue;
    const d = Math.hypot(g.x0 + (a + 0.5) * CH - px, g.z0 + (b + 0.5) * CH - pz);
    if (d <= STREAM_MAX_R) cand.push({ a, b, d, key: a + ',' + b });
  }
  cand.sort((p, q) => p.d - q.d);
  S.want = cand.slice(0, S.maxChunks);
  S.wantSet = new Set(S.want.map(c => c.key));
  S.eff = S.want.length ? S.want[S.want.length - 1].d : 0;
  // Build order: chunks ahead of a moving vehicle first (what is loaded and kept is still decided by distance alone).
  S.order = S.want;
  if (Math.abs(P.v) > 1) {
    const hx = Math.cos(P.psi), hz = -Math.sin(P.psi), sg = P.v >= 0 ? 1 : -1;
    const pri = c => c.d - 10 * sg * ((g.x0 + (c.a + 0.5) * CH - px) * hx + (g.z0 + (c.b + 0.5) * CH - pz) * hz) / (c.d || 1);
    S.order = S.want.slice().sort((p, q) => pri(p) - pri(q));
  }
  // unload what is clearly outside the ring (with a margin so a chunk on the edge does not flicker)
  S.chunks.forEach((c, key) => {
    if (S.wantSet.has(key)) return;
    const d = Math.hypot(g.x0 + (c.a + 0.5) * CH - px, g.z0 + (c.b + 0.5) * CH - pz);
    if (d > S.eff + CH * 0.75) streamDropChunk(key);
  });
  S.tiles.forEach((t, key) => {
    if (Math.hypot((t.tx + 0.5) * S.ti.T - px, (t.tz + 0.5) * S.ti.T - pz) > S.eff + 8 + S.ti.T) streamDropTile(key);
  });
}
function streamDropChunk(key) {
  const S = stream, c = S.chunks.get(key); if (!c) return;
  if (c.mesh) { worldRoot.remove(c.mesh); c.mesh.dispose(); const i = groundChunks.findIndex(e => e.mesh === c.mesh); if (i >= 0) groundChunks.splice(i, 1); }
  S.store.remove(c.a, c.b); S.groundCubes -= c.count; S.chunks.delete(key);
}
function streamDropTile(key) {
  const S = stream, t = S.tiles.get(key); if (!t) return;
  if (t.mesh) { worldRoot.remove(t.mesh); t.mesh.dispose(); }
  S.tileCubes -= t.count; S.tiles.delete(key);
}
// Load the nearest missing chunks (and tiles). ms = time budget; n = minimum number to load regardless of time.
function streamPump(ms, n) {
  const S = stream, T0 = performance.now(), CH = S.grid.CH;
  let loaded = 0;
  const order = S.order || S.want;
  for (let i = 0; i < order.length; i++) {
    const w = order[i];
    if (S.chunks.has(w.key)) continue;
    if (loaded >= n && performance.now() - T0 > ms) return true;
    const r = World.buildChunk(S.grid, w.a, w.b);
    if (!r) { S.chunks.set(w.key, { a: w.a, b: w.b, count: 0 }); continue; }
    const m = makeMesh(r.chunk, false);
    worldRoot.add(m);
    groundChunks.push({ mesh: m, box: new THREE.Box3(new THREE.Vector3(r.chunk.box[0], r.chunk.box[1], r.chunk.box[2]), new THREE.Vector3(r.chunk.box[3], r.chunk.box[4], r.chunk.box[5])) });
    S.chunks.set(w.key, { a: w.a, b: w.b, mesh: m, count: r.chunk.count });
    S.store.set(w.a, w.b, r.hf);
    S.groundCubes += r.chunk.count; loaded++;
  }
  const T = S.ti.T, R = S.eff + 8 + T * 0.5;
  const need = [];
  S.ti.tiles.forEach((t, key) => {
    if (S.tiles.has(key)) return;
    const d = Math.hypot((t.tx + 0.5) * T - P.x, (t.tz + 0.5) * T - P.z);
    if (d <= R) need.push({ t, key, d });
  });
  need.sort((p, q) => p.d - q.d);
  for (let i = 0; i < need.length; i++) {
    if (S.tileCubes >= S.tileBudget) break;
    if (loaded >= n && performance.now() - T0 > ms) return true;
    const { t, key } = need[i], d = voxelTile(t, T, S.v, 1);
    let m = null;
    if (d.count > 0) { m = makeMesh({ count: d.count, pos: d.pos, col: d.col, v: S.v }, true); worldRoot.add(m); }
    S.tiles.set(key, { tx: t.tx, tz: t.tz, mesh: m, count: d.count });
    S.tileCubes += d.count; loaded++;
  }
  S.peak = Math.max(S.peak, S.groundCubes + S.tileCubes + S.vehicleCubes);
  return false;
}
function streamSync() { // player jumped (start, reset): plan around the new spot and load the nearest chunks now
  const S = stream; if (!S) return;
  S.pa = Math.floor((P.x - S.grid.x0) / S.grid.CH); S.pb = Math.floor((P.z - S.grid.z0) / S.grid.CH);
  streamPlan(); streamPump(1e9, 25);
}
function streamTick() {
  const S = stream; if (!S) return;
  const a = Math.floor((P.x - S.grid.x0) / S.grid.CH), b = Math.floor((P.z - S.grid.z0) / S.grid.CH);
  if (a !== S.pa || b !== S.pb) { S.pa = a; S.pb = b; streamPlan(); }
  streamPump(STREAM_MS, 0);
}
function streamLine() {
  const S = stream, c = S.groundCubes + S.tileCubes + S.vehicleCubes;
  return 'streaming · ' + c.toLocaleString('en-IN') + ' cubes live of ' + mem.plan.budget.toLocaleString('en-IN') + ' (' + mem.tier + ') · ' + S.chunks.size + ' chunks · ' + S.tiles.size + ' tiles · ' + Math.round(World.LTOT) + ' m lap';
}
function streamStat() { $('sStat').textContent = streamLine(); }
function applyVisibility() {
  A.pCar.root.visible = kind === 'car'; A.pBike.root.visible = kind === 'bike';
  A.nBike.root.visible = kind === 'car'; A.nCar.root.visible = kind === 'bike';
  A.nAuto.root.visible = true;
}

// ===== Player, traffic, lap logic =====
let kind = 'car';
const P = { x: map.start.x, z: map.start.z, psi: map.start.psi, v: 0, steer: 0, y: 0, pitch: 0, roll: 0, acc: 0, hit: false, jy: 0, jv: 0, wobA: 0, wobT: 9, wobRoll: 0, pot: 0, potMsg: 0, air: false, vy: 0, vyG: 0, by: null, fallMsg: 0, safeT: 0, safe: { x: map.start.x, z: map.start.z, psi: map.start.psi } };
const lap = { prog: -1.5, prevS: 0, n: 0, idx: -1, t0: -1, time: 0, last: -1, wrong: 0 };
const best = { car: 0, bike: 0 };
try { const b = JSON.parse(localStorage.getItem('loop-hills-best') || '{}'); best.car = b.car || 0; best.bike = b.bike || 0; } catch (e) {}
const NPC = map.traffic.map(n => ({ key: n.key, s: n.s, dir: n.dir, u: n.u, speed: n.speed, r: n.r, ph: n.ph, y: 0, pitch: 0 }));
const potState = [-1, -1, -1, -1], recent = new Map();
let cFresh = true;   // Physics: New starts the wheel model again from the ground
function snapPlayer() { cFresh = true; if (stream) streamSync(); P.y = gY(P.x, P.z); P.by = P.y; P.air = false; P.vy = 0; P.vyG = 0; NPC.forEach(n => { n.y = null; }); snapCam = true; }
function resetRun() {
  P.x = map.start.x; P.z = map.start.z; P.psi = map.start.psi; P.v = 0; P.steer = 0; P.pitch = 0; P.roll = 0; P.jy = P.jv = 0; P.wobA = 0; P.wobT = 9; P.pot = 0;
  potState.fill(-1); recent.clear();
  lap.prog = -1.5; lap.prevS = World.loopInfo(P.x, P.z).s; lap.n = 0; lap.idx = -1; lap.t0 = -1; lap.time = 0; lap.last = -1; lap.wrong = 0; lap.running = false;
  cam.userAz = 0; snapPlayer();
}

const keys = new Set();
const pad = { gas: false, brk: false, l: false, r: false };
function inp() {
  return {
    up: keys.has('w') || keys.has('arrowup') || pad.gas, down: keys.has('s') || keys.has('arrowdown') || pad.brk,
    left: keys.has('a') || keys.has('arrowleft') || pad.l, right: keys.has('d') || keys.has('arrowright') || pad.r, hb: keys.has(' ')
  };
}

function pushOut(px, pz, r) {
  let ox = 0, oz = 0;
  for (let i = 0; i < SOLIDS.length; i++) {
    const s = SOLIDS[i];
    if (s.t === 'o') {
      const dx0 = px - s.x, dz0 = pz - s.z, lx = dx0 * s.c - dz0 * s.s, lz = dx0 * s.s + dz0 * s.c;
      let dlx = lx - clamp(lx, -s.hx, s.hx), dlz = lz - clamp(lz, -s.hz, s.hz);
      const d2 = dlx * dlx + dlz * dlz;
      if (d2 >= r * r) continue;
      let ax, az;
      if (d2 < 1e-8) {   // inside the footprint: out through the nearest face
        const ex = s.hx - Math.abs(lx), ez = s.hz - Math.abs(lz);
        if (ex < ez) { ax = (lx < 0 ? -1 : 1) * (ex + r); az = 0; } else { ax = 0; az = (lz < 0 ? -1 : 1) * (ez + r); }
      } else { const d = Math.sqrt(d2), k = (r - d) / d; ax = dlx * k; az = dlz * k; }
      ox += ax * s.c + az * s.s; oz += -ax * s.s + az * s.c;
      continue;
    }
    let nx, nz;
    if (s.t === 'b') { nx = clamp(px, s.x0, s.x1); nz = clamp(pz, s.z0, s.z1); } else { nx = s.x; nz = s.z; }
    let dx = px - nx, dz = pz - nz;
    const rr = s.t === 'c' ? r + s.r : r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    let d = Math.sqrt(d2);
    if (d < 1e-4) { dx = px - (s.x0 + s.x1) / 2; dz = pz - (s.z0 + s.z1) / 2; d = Math.hypot(dx, dz) || 1; }
    const k = (rr - d) / d;
    ox += dx * k; oz += dz * k;
  }
  return [ox, oz];
}

// A wheel dropping into a pothole: speed loss, a jolt, a steering wobble and a shake, for car and bike alike.
function potholeHit(pi, wheelIdx, side) {
  const p = World.POTS[pi], sp = VEH[kind];
  const sev = (p.r / 0.7) * (p.depth === 2 ? 1.2 : 1) * clamp(Math.abs(P.v) / (sp.maxF * 0.55), 0.35, 1.5);
  P.v *= 1 - Math.min(0.45, 0.22 * sev);
  P.jv += 2.4 * sev;
  P.wobA = Math.max(P.wobA * 0.5, 0.2 * sev * sp.wob); P.wobT = 0; P.wobPh = Math.random() < 0.5 ? 1 : -1;
  P.psi += (side || P.wobPh) * 0.045 * sev * sp.wob;
  shake = Math.max(shake, 0.12 + 0.2 * sev);
  const now = performance.now();
  if (!recent.has(pi) || now - recent.get(pi) > 1500) { P.pot++; P.potMsg = 0.9; }
  recent.set(pi, now);
  thump(sev);
}

// ===== Falling. The vehicle normally follows the ground exactly. When the ground drops away steeper than it could follow
// (a cliff edge, a ledge) it leaves the ground, keeps its speed, falls under gravity and lands with a jolt. A very long fall
// puts it back on the last road it was on. Curbs, speed breakers, potholes and ordinary slopes never trigger it.
// Settings > Cliff falls > Off restores the old behaviour (ground-hugging everywhere).
const EDGE_SLOW = map.edgeSlow !== false;   // the original Hill Loop file says false, so it drives exactly as it always did
const FALL = { g: 20, slope: 1.2, window: 1.3, crash: 22 };
const _hd = [], _hy = []; let fallDist = 0;   // recent (distance travelled, height) pairs for the creep check   // slope: steepest ground-height drop per metre travelled that the four-wheel average can follow
function fallReset() {
  const s = P.safe;
  P.x = s.x; P.z = s.z; P.psi = s.psi; P.v = 0; P.steer = 0; P.pitch = 0; P.roll = 0; P.jy = P.jv = 0; P.air = false; P.vy = 0;
  snapPlayer(); P.by = P.y; P.fallMsg = 1.8; shake = 0.5;
}
function fallStep(dt) {
  const g = P.gy;
  P.lx = P.x; P.lz = P.z;
  if (hooks.fall === 'off' || !isFinite(g)) { P.air = false; P.by = g; _hd.length = 0; _hy.length = 0; return; }
  if (P.by === null || P.by === undefined) P.by = g;
  if (!P.air) {
    const drop = P.by - g, ds = Math.abs(P.v) * dt;
    fallDist += ds;
    // Also look at the drop over the last ~0.4 m of travel, so a vehicle creeping over an edge (too slow for the per-step check) still leaves the wall.
    while (_hd.length && fallDist - _hd[0] > 0.4) { _hd.shift(); _hy.shift(); }
    let creep = false;
    if (_hd.length) { const dd = fallDist - _hd[0], dr = _hy[0] - g; creep = dd > 0.1 && dr > 0.1 && dr / dd > FALL.window; }
    if ((drop > 0.03 && drop > ds * FALL.slope + 0.01) || creep) { P.air = true; P.vy = Math.min(0, P.vyG); _hd.length = 0; _hy.length = 0; }
    else {
      _hd.push(fallDist); _hy.push(g);
      P.vyG = clamp((g - P.by) / dt, -8, 8); P.by = g;
      P.safeT -= dt;
      if (P.safeT <= 0 && gKind(P.x, P.z) === K.ROAD) { P.safe.x = P.x; P.safe.z = P.z; P.safe.psi = P.psi; P.safeT = 0.4; }
      return;
    }
  }
  P.vy -= FALL.g * dt; P.by += P.vy * dt;
  if (P.by < World.Y_MIN - 8) { fallReset(); return; }
  if (P.by <= g) {
    const impact = -P.vy;
    P.by = g; P.air = false; P.vy = 0; P.vyG = 0; _hd.length = 0; _hy.length = 0;
    if (impact > FALL.crash) { fallReset(); return; }
    if (impact > 2.5) {
      const sev = clamp(impact / 10, 0.2, 1.6);
      P.jv += 2.6 * sev; shake = Math.max(shake, 0.1 + 0.25 * sev);
      P.v *= 1 - Math.min(0.4, 0.04 * Math.max(0, impact - 3));
      thump(sev);
    }
  }
}


// ===== Physics: New (wheel contact). The classic path below is untouched; this one is used only when Settings > Physics is New. =====
// Each wheel is a circle of radius R rolling over the ground (see contact.js). The vehicle is held up by springs and dampers, leaves the
// ground when no wheel touches, lands with the speed its wheels arrive at, and loses speed climbing in proportion to the load on the wheel
// and the slope it is on. There is no separate pothole, ledge or cliff rule: they are all just ground height under the wheels.
const physNew = () => hooks.physics === 'new';
const CT = {};
const ctOf = () => CT[kind] || (CT[kind] = createContact(VEH[kind].ct));
const cOld = new Float64Array(4), cNew = new Float64Array(4);
function wheelPos(i, fx, fz, rx, rz) { const w = VEH[kind].wheels[i]; return [P.x + fx * w[0] + rx * w[1], P.z + fz * w[0] + rz * w[1]]; }
function sampleWheels(out) {
  const sp = VEH[kind], fx = Math.cos(P.psi), fz = -Math.sin(P.psi), rx = Math.sin(P.psi), rz = Math.cos(P.psi);
  for (let i = 0; i < sp.wheels.length; i++) { const w = wheelPos(i, fx, fz, rx, rz); out[i] = effectiveHeight(gY, w[0], w[1], fx, fz, sp.ct.R); }
}
// True when a wheel would have to climb more than the vehicle can (a wall, a steep cliff face): the move is refused.
function climbBlocked() {
  const sp = VEH[kind], C = ctOf(), t = sp.ct;
  sampleWheels(cNew);
  const spn = Math.sin(C.pitch), srn = Math.sin(C.roll);
  for (let i = 0; i < sp.wheels.length; i++) {
    const att = C.y + sp.wheels[i][0] * spn - sp.wheels[i][1] * srn;
    if (cNew[i] + t.stat - att - t.stop > t.climb) return true;
  }
  return false;
}
const cutState = [false, false, false, false]; let cutLast = 0;
// A wheel meeting a hole cut into the road (editor Road damage): the ground there is really lower, and this adds the bite of a pothole,
// scaled by its depth and the speed: speed lost, wobble, a shake, a thump and the counter. Same in Classic and New.
function cutNote(i, wx, wz, side) {
  const sp = VEH[kind], cm = World.cutAt ? World.cutAt(wx, wz) : 0, hit = cm >= 8;
  if (hit && !cutState[i] && Math.abs(P.v) > 0.8) {
    const sev = clamp(cm / 25, 0.5, 3) * clamp(Math.abs(P.v) / (sp.maxF * 0.55), 0.35, 1.5);
    P.v *= 1 - Math.min(0.4, 0.2 * sev);
    P.wobA = Math.max(P.wobA * 0.5, 0.2 * sev * sp.wob); P.wobT = 0; P.wobPh = Math.random() < 0.5 ? 1 : -1;
    P.psi += (side || P.wobPh) * 0.04 * sev * sp.wob;
    shake = Math.max(shake, 0.1 + 0.18 * sev); thump(sev);
    const now = performance.now();
    if (now - cutLast > 1500) { P.pot++; P.potMsg = 0.9; }
    cutLast = now;
  }
  cutState[i] = hit;
}
function potholeNote(pi, side) {
  const p = World.POTS[pi], sp = VEH[kind];
  const sev = (p.r / 0.7) * (p.depth === 2 ? 1.2 : 1) * clamp(Math.abs(P.v) / (sp.maxF * 0.55), 0.35, 1.5);
  P.v *= 1 - Math.min(0.45, 0.22 * sev);     // the map's pothole keeps its bite, as in Classic
  P.wobA = Math.max(P.wobA * 0.5, 0.2 * sev * sp.wob); P.wobT = 0; P.wobPh = Math.random() < 0.5 ? 1 : -1;
  P.psi += (side || P.wobPh) * 0.045 * sev * sp.wob;
  shake = Math.max(shake, 0.12 + 0.2 * sev);
  const now = performance.now();
  if (!recent.has(pi) || now - recent.get(pi) > 1500) { P.pot++; P.potMsg = 0.9; }
  recent.set(pi, now);
  thump(sev);
}
function newWheels(dt) {
  const sp = VEH[kind], C = ctOf(), n = sp.wheels.length;
  const fx = Math.cos(P.psi), fz = -Math.sin(P.psi), rx = Math.sin(P.psi), rz = Math.cos(P.psi);
  sampleWheels(cNew);
  for (let i = 0; i < n; i++) {
    const w = wheelPos(i, fx, fz, rx, rz), pi = World.potholeAt(w[0], w[1], 0.08);
    if (pi >= 0 && potState[i] !== pi && Math.abs(P.v) > 0.8) potholeNote(pi, sp.wheels[i][1] < 0 ? -1 : sp.wheels[i][1] > 0 ? 1 : 0);
    potState[i] = pi;
    cutNote(i, w[0], w[1], sp.wheels[i][1] < 0 ? -1 : sp.wheels[i][1] > 0 ? 1 : 0);
  }
  if (cFresh) {   // first step, a reset or a teleport: start resting on the ground
    let a = 0; for (let i = 0; i < n; i++) { cOld[i] = cNew[i]; a += cNew[i]; }
    C.reset(a / n, 0, 0); cFresh = false; P.air = false;
  }
  const wasAir = P.air;
  P.lx = P.x; P.lz = P.z;
  C.step(dt, cOld, cNew);
  // the slope each wheel climbed this step (rise per metre travelled) gives the speed lost going up and gained going down
  const ds = Math.abs(P.v) * dt;
  let sf = 0;
  if (ds > 1e-4) for (let i = 0; i < n; i++) sf += C.f[i] * clamp((cNew[i] - cOld[i]) / ds, -1.5, 1.5);
  P.slopeF = sf;
  let a = 0; for (let i = 0; i < n; i++) { cOld[i] = cNew[i]; a += cNew[i]; }
  P.gy = a / n;
  P.air = C.airborne && C.airT > 0.12;
  P.by = C.y; P.vy = C.vy; P.vyG = 0;
  if (P.air) {
    // in the air the nose follows the flight path; the body model follows the displayed attitude so it lands as it looks
    const pitchT = clamp(Math.atan2(C.vy, Math.max(Math.abs(P.v), 4)), -0.7, 0.3);
    P.pitch = lerp(P.pitch, pitchT, Math.min(1, dt * 10)); P.roll = lerp(P.roll, 0, Math.min(1, dt * 10));
    C.pitch = P.pitch; C.wp = 0; C.roll = P.roll; C.wr = 0;
  } else { P.pitch = C.pitch; P.roll = C.roll; }
  P.jy = 0; P.jv = 0;
  if (C.y < World.Y_MIN - 8) { fallReset(); return; }
  if (wasAir && C.landed > 0) {
    const impact = C.landed;
    if (impact > FALL.crash) { fallReset(); return; }
    if (impact > 2.5) {
      const sev = clamp(impact / 10, 0.2, 1.6);
      shake = Math.max(shake, 0.1 + 0.25 * sev);
      P.v *= 1 - Math.min(0.4, 0.04 * Math.max(0, impact - 3));
      thump(sev);
    }
  }
  if (!P.air) {
    const hard = (C.load() - 30) / 70;     // a hard hit on the wheels shakes the view a little, more the harder it is
    if (hard > 0) shake = Math.max(shake, Math.min(0.35, 0.05 + 0.3 * hard));
    P.safeT -= dt;
    if (P.safeT <= 0 && gKind(P.x, P.z) === K.ROAD) { P.safe.x = P.x; P.safe.z = P.z; P.safe.psi = P.psi; P.safeT = 0.4; }
  }
}

function step(dt, ctl) {
  const sp = VEH[kind];
  // A jump of more than 2 m between steps is a teleport (start, reset, a test placing the vehicle): forget the old body height.
  if (P.lx !== undefined && (Math.abs(P.x - P.lx) > 2 || Math.abs(P.z - P.lz) > 2)) { P.by = null; P.air = false; P.vy = 0; P.vyG = 0; _hd.length = 0; _hy.length = 0; cFresh = true; }
  const surf = World.MULT[gKind(P.x, P.z)];
  const vmax = sp.maxF * surf, rmax = sp.maxR * surf;
  const thr = (ctl.up ? 1 : 0) - (ctl.down ? 1 : 0);
  const vPrev = P.v;
  if (!P.air) {   // in the air nothing pushes the vehicle: it keeps its speed until it lands
  if (ctl.up) { if (P.v >= 0) P.v += sp.acc * clamp(1 - P.v / vmax, -3, 1) * dt; else P.v += sp.brk * dt; }
  else if (ctl.down) { if (P.v > 0.3) P.v -= sp.brk * dt; else P.v = Math.max(P.v - sp.acc * 0.6 * dt, -rmax); }
  if (!thr) { const dr = 1.2 + 0.05 * Math.abs(P.v); P.v -= Math.sign(P.v) * Math.min(Math.abs(P.v), dr * dt); }
  if (P.v > vmax) P.v -= (P.v - vmax) * Math.min(1, 3 * dt);
  if (P.v < -rmax) P.v -= (P.v + rmax) * Math.min(1, 3 * dt);
  if (ctl.hb) P.v -= Math.sign(P.v) * Math.min(Math.abs(P.v), 18 * dt);
  // Near the edge of the map a vehicle driving over open ground and heading at it slows down smoothly (turning back is not slowed; maps may switch it off with edgeSlow: false), so the wall is rarely hit hard.
  { const e = edge.probe(P.x, P.z, Math.cos(P.psi) * P.v, -Math.sin(P.psi) * P.v); P.edge = e.f; P.edgeOut = e.away;
    if (e.away > 0 && EDGE_SLOW) P.v *= Math.exp(-3.2 * e.away * e.away * dt); }
  // gravity along the slope: uphill bleeds speed, downhill gives it back; a gentle slope holds a parked vehicle
  let g = 9.8 * 0.55 * Math.sin(P.pitch);
  if (physNew() && Math.abs(P.v) >= 0.5) g = Math.sign(P.v) * 0.55 * (P.slopeF || 0) * 9.8 / VEH[kind].ct.g;   // from the wheels: steps and rises cost speed
  if (!(thr === 0 && Math.abs(P.v) < 0.5 && Math.abs(P.pitch) < 0.08)) P.v -= g * dt; else P.v = 0;
  }

  const tgt = (ctl.left ? 1 : 0) - (ctl.right ? 1 : 0);
  P.steer += (tgt - P.steer) * Math.min(1, dt * 9);
  P.wobT += dt;
  const wob = P.wobA * Math.sin(P.wobT * 20) * Math.exp(-P.wobT * 2.4) * (P.wobPh || 1);
  const t = clamp(Math.abs(P.v) / sp.maxF, 0, 1);
  const delta = P.steer * lerp(sp.sMax, sp.sMin, Math.pow(t, 0.7)) + wob * (0.4 + 0.6 * t);
  P.wobRoll = wob * (kind === 'bike' ? 1.6 : 0.6);
  const yaw = P.v / sp.wb * Math.tan(delta) * (ctl.hb ? 1.4 : 1) * (P.air ? 0.2 : 1);
  const px0 = P.x, pz0 = P.z;
  P.psi += yaw * dt;
  P.x += Math.cos(P.psi) * P.v * dt;
  P.z -= Math.sin(P.psi) * P.v * dt;

  // Collisions: a few circles along the body against buildings, trees, poles and other traffic; steep faces are walls.
  let hit = false;
  const fx = Math.cos(P.psi), fz = -Math.sin(P.psi);
  // The steep-face wall compares the ground ahead with the vehicle's own height (so a car leaving a cliff edge is not held by the lip it is
  // driving off). With Cliff falls off it is the ground under the centre, exactly as before.
  const yHere = (hooks.fall === 'off' || P.by === null || P.by === undefined) ? gY(px0, pz0) : P.by;
  if (physNew()) {
    if (climbBlocked()) { P.x = px0; P.z = pz0; hit = true; }
  } else
  for (let c = 0; c < sp.circ.length; c++) {
    const cx = P.x + fx * sp.circ[c], cz = P.z + fz * sp.circ[c];
    if (gY(cx, cz) - yHere > 0.85) { P.x = px0; P.z = pz0; hit = true; break; }
  }
  for (let c = 0; c < sp.circ.length; c++) {
    const [ox, oz] = pushOut(P.x + fx * sp.circ[c], P.z + fz * sp.circ[c], sp.r);
    if (ox || oz) { P.x += ox; P.z += oz; hit = true; }
  }
  NPC.forEach(n => {
    const a = A[n.key].root;
    if (!a.visible) return;
    for (let c = 0; c < sp.circ.length; c++) {
      const cx = P.x + fx * sp.circ[c], cz = P.z + fz * sp.circ[c];
      const dx = cx - a.position.x, dz = cz - a.position.z, d = Math.hypot(dx, dz), rr = sp.r + n.r;
      if (d < rr) { const k = (rr - d) / (d || 1); P.x += dx * k; P.z += dz * k; hit = true; }
    }
  });
  const S = World.SLAB;
  if (P.x < S.x0 + 1.2 || P.x > S.x1 - 1.2 || P.z < S.z0 + 1.2 || P.z > S.z1 - 1.2) {
    P.x = clamp(P.x, S.x0 + 1.2, S.x1 - 1.2); P.z = clamp(P.z, S.z0 + 1.2, S.z1 - 1.2); hit = true;
  }
  if (hit) {
    if (!P.hit && Math.abs(P.v) > 4) { shake = Math.min(0.5, Math.abs(P.v) * 0.03); P.v *= -0.25; }
    else P.v *= Math.max(0, 1 - 4 * dt);
  }
  P.hit = hit;

  if (physNew()) { newWheels(dt); P.acc = lerp(P.acc, clamp((P.v - vPrev) / dt, -10, 10), 0.2); return; }
  // Wheels: ride height, pitch, roll and pothole hits.
  const fx2 = Math.cos(P.psi), fz2 = -Math.sin(P.psi), rx = Math.sin(P.psi), rz = Math.cos(P.psi);
  const ws = sp.wheels;
  let ysum = 0, fy = 0, ry = 0, fn = 0, rn = 0, ly = 0, rty = 0, ln = 0, rtn = 0;
  for (let i = 0; i < ws.length; i++) {
    const wx = P.x + fx2 * ws[i][0] + rx * ws[i][1], wz = P.z + fz2 * ws[i][0] + rz * ws[i][1];
    const y = gY(wx, wz);
    ysum += y;
    if (ws[i][0] > 0) { fy += y; fn++; } else { ry += y; rn++; }
    if (ws[i][1] < 0) { ly += y; ln++; } else if (ws[i][1] > 0) { rty += y; rtn++; }
    const pi = World.potholeAt(wx, wz, 0.08);
    if (pi >= 0 && potState[i] !== pi && Math.abs(P.v) > 0.8) potholeHit(pi, i, ws[i][1] < 0 ? -1 : ws[i][1] > 0 ? 1 : 0);
    potState[i] = pi;
    cutNote(i, wx, wz, ws[i][1] < 0 ? -1 : ws[i][1] > 0 ? 1 : 0);
  }
  const half = ws[0][0];
  const pitchT = P.air ? clamp(Math.atan2(P.vy, Math.max(Math.abs(P.v), 4)), -0.7, 0.3) : Math.atan2(fy / fn - ry / rn, 2 * half);
  P.pitch = lerp(P.pitch, pitchT, Math.min(1, dt * 10));
  const rollT = !P.air && rtn && ln ? -Math.atan2(rty / rtn - ly / ln, 1.44) : 0;
  P.roll = lerp(P.roll, rollT, Math.min(1, dt * 10));
  P.gy = ysum / ws.length;
  fallStep(dt);
  P.acc = lerp(P.acc, clamp((P.v - vPrev) / dt, -10, 10), 0.2);
  // jolt spring
  P.jv += (-180 * P.jy - 14 * P.jv) * dt; P.jy = clamp(P.jy + P.jv * dt, -0.05, 0.3);
}

function fmt(t) {
  if (t < 0) return '--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}
function lapUpdate(dt) {
  if (!World.hasLoop) return;
  const info = World.loopInfo(P.x, P.z);
  let d = info.s - lap.prevS;
  if (d > World.LTOT / 2) d -= World.LTOT; else if (d < -World.LTOT / 2) d += World.LTOT;
  lap.prevS = info.s;
  if (Math.abs(d) < 25 && Math.abs(info.u) < 8) {
    lap.prog += d;
    lap.wrong = d < -0.02 && P.v > 2 ? lap.wrong + dt : (d > 0 ? 0 : lap.wrong);
  }
  const idx = Math.floor(lap.prog / World.LTOT);
  if (idx > lap.idx) {
    if (lap.idx >= 0 && lap.t0 >= 0) {
      lap.last = lap.time; lap.n = idx;
      if (!best[kind] || lap.last < best[kind]) { best[kind] = lap.last; try { localStorage.setItem('loop-hills-best', JSON.stringify(best)); } catch (e) {} }
    }
    lap.idx = idx; lap.t0 = lap.time = 0; lap.running = true;
  }
  if (lap.running) lap.time += dt;
}

// ===== Camera =====
const camPos = new THREE.Vector3(0, 60, 80), camLook = new THREE.Vector3(0, 2, -15);
const cam = { pol: 0.95, zoom: 1, userAz: 0, chaseAz: 0, drag: false };
const OV = { az: 0.0, pol: 0.95, zoom: 1 };
let snapCam = true, shake = 0, vw = 1, vh = 1, lastDt = 0.016;
const camPosD = new THREE.Vector3(), camLookD = new THREE.Vector3();
function overviewDesired() {
  const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const fit = 40 / Math.sin(Math.min(vf, hf) / 2);
  const d = Math.max(fit * 0.8, 80) * OV.zoom;
  const ox = stream ? P.x : 0, oz = stream ? P.z : -15;
  camLookD.set(ox, 2.5, oz);
  camPosD.set(ox + Math.sin(OV.pol) * Math.sin(OV.az) * d, Math.cos(OV.pol) * d + 2.5, oz + Math.sin(OV.pol) * Math.cos(OV.az) * d);
}
function chaseDesired() {
  const sp = VEH[kind], frac = clamp(Math.abs(P.v) / sp.maxF, 0, 1);
  const d = (sp.camD + frac * 3) * cam.zoom;
  let diff = P.psi - Math.PI / 2 - cam.chaseAz;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  cam.chaseAz += diff * Math.min(1, lastDt * 3.5);
  const az = cam.chaseAz + cam.userAz, pol = cam.pol + 0.05;
  const lead = 1.5 + Math.max(0, P.v) * 0.22, ty = P.y + 0.9;
  camLookD.set(P.x + Math.cos(P.psi) * lead, ty, P.z - Math.sin(P.psi) * lead);
  camPosD.set(P.x + Math.sin(pol) * Math.sin(az) * d, Math.cos(pol) * d + ty, P.z + Math.sin(pol) * Math.cos(az) * d);
  const floor = gY(camPosD.x, camPosD.z) + 1.5;
  if (camPosD.y < floor) camPosD.y = floor;
  camera.fov = 36 + frac * 5;
}
function placeCamera(dt) {
  lastDt = dt;
  const chase = state.cam === 'chase' && state.phase === 'play';
  if (chase) chaseDesired(); else { camera.fov = 32; overviewDesired(); }
  camera.updateProjectionMatrix();
  const k = snapCam ? 1 : 1 - Math.exp(-dt * (chase ? 9 : 8));
  camPos.lerp(camPosD, k); camLook.lerp(camLookD, k);
  snapCam = false;
  camera.position.copy(camPos);
  if (shake > 0.001 && !reduced) {
    camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-dt * 8);
  }
  camera.lookAt(camLook);
}

const sunOff = new THREE.Vector3(0, 25, 20);
function setSun(h) {
  const t = (h - 6) / 12;
  const el = Math.max(0.2, Math.sin(Math.PI * t)) * 1.25;
  const az = (0.5 - t) * 2.6;
  const ce = Math.cos(el), se = Math.sin(el);
  sunOff.set(Math.sin(az) * ce * 30, se * 30 + 2, (0.55 + 0.45 * Math.cos(az)) * ce * 30);
  const warm = clamp((0.6 - el) / 0.4, 0, 1);
  sun.color.setRGB(1, 0.96 - 0.28 * warm, 0.88 - 0.48 * warm);
  sun.intensity = 0.5 + 0.4 * Math.min(1, el / 1.0);
  hemi.intensity = 0.5 + 0.12 * Math.min(1, el / 1.0);
  hemi.color.setRGB(0.81 + 0.19 * warm, 0.9 - 0.12 * warm, 1 - 0.25 * warm);
  hemi.groundColor.setRGB(0.54, 0.45, 0.32);
  sky.setHour(el, warm, sunOff);
}
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _dir = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function followShadow(tx, ty, tz) {
  _dir.copy(sunOff).normalize();
  _lx.crossVectors(_up, _dir).normalize(); _ly.crossVectors(_dir, _lx);
  _t.set(tx, ty, tz);
  const texel = (2 * shadowExt) / sun.shadow.mapSize.x;
  const ax = _t.dot(_lx), ay = _t.dot(_ly);
  _t.addScaledVector(_lx, Math.round(ax / texel) * texel - ax).addScaledVector(_ly, Math.round(ay / texel) * texel - ay);
  sun.target.position.copy(_t);
  sun.position.set(_t.x + sunOff.x, _t.y + sunOff.y, _t.z + sunOff.z);
}
function clockLabel(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return (((hh + 11) % 12) + 1) + ':' + String(mm).padStart(2, '0') + ' ' + (hh >= 12 ? 'pm' : 'am');
}

function resize() {
  const st = $('stage');
  vw = Math.max(1, st.clientWidth); vh = Math.max(1, st.clientHeight);
  renderer.setPixelRatio(state.lite ? 1 : basePR);
  renderer.setSize(vw, vh, false);
  camera.aspect = vw / vh;
  camera.updateProjectionMatrix();
}
const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
if (ro) ro.observe($('stage'));
on(window, 'resize', resize);

// ===== Input =====
const ptrs = new Map();
let pinch = 0;
['contextmenu', 'selectstart', 'dragstart'].forEach(t => $('stage').addEventListener(t, e => e.preventDefault()));
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cam.drag = true;
  $('stage').focus({ preventScroll: true });
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  const chase = state.cam === 'chase' && state.phase === 'play';
  if (ptrs.size === 1) {
    if (chase) { cam.userAz -= dx * 0.007; cam.pol = clamp(cam.pol - dy * 0.005, 0.55, 1.35); }
    else { OV.az -= dx * 0.007; OV.pol = clamp(OV.pol - dy * 0.006, 0.3, 1.45); }
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0 && d > 0) { const z = pinch / d; if (chase) cam.zoom = clamp(cam.zoom * z, 0.5, 2); else OV.zoom = clamp(OV.zoom * z, 0.4, 1.6); }
    pinch = d;
  }
});
const endPtr = e => { ptrs.delete(e.pointerId); pinch = 0; if (!ptrs.size) cam.drag = false; };
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const z = Math.exp(e.deltaY * 0.001);
  if (state.cam === 'chase' && state.phase === 'play') cam.zoom = clamp(cam.zoom * z, 0.5, 2); else OV.zoom = clamp(OV.zoom * z, 0.4, 1.6);
}, { passive: false });

const DRIVE = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ']);
on(window, 'keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' && e.target.type !== 'range') return;
  if (DRIVE.has(k)) {
    if (tag === 'BUTTON' && k === ' ') return;
    if (tag === 'INPUT') e.target.blur();
    e.preventDefault();
    if (state.phase === 'menu') return;
    keys.add(k);
  } else if (k === 'c') { if (state.phase === 'play') setCam(state.cam === 'chase' ? 'overview' : 'chase'); }
  else if (k === 'r') { if (state.phase === 'play') resetRun(); }
});
on(window, 'keyup', e => keys.delete(e.key.toLowerCase()));
on(window, 'blur', () => { keys.clear(); clearPad(); });

// Touch pad: each button tracks its own pointers, so two fingers (gas + steer) never interfere,
// and nothing sticks if a finger slides off, a second finger lands, or the page loses focus.
const padHeld = { gas: new Set(), brk: new Set(), l: new Set(), r: new Set() };
function holdBtn(id, key) {
  const b = $(id), held = padHeld[key];
  const sync = () => { pad[key] = held.size > 0; b.classList.toggle('down', pad[key]); };
  const on = e => {
    e.preventDefault(); e.stopPropagation();
    held.add(e.pointerId); sync();
    try { b.setPointerCapture(e.pointerId); } catch (x) {}
    if (navigator.vibrate && e.pointerType === 'touch') { try { navigator.vibrate(6); } catch (x) {} }
  };
  const off = e => { held.delete(e.pointerId); sync(); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('lostpointercapture', off);
  ['contextmenu', 'selectstart', 'dragstart', 'touchstart'].forEach(t => b.addEventListener(t, e => e.preventDefault(), { passive: false }));
}
const clearPad = () => { Object.keys(padHeld).forEach(k => { padHeld[k].clear(); pad[k] = false; }); gameRootEl.querySelectorAll('.pad button').forEach(b => b.classList.remove('down')); };
on(document, 'visibilitychange', () => { if (document.hidden) { keys.clear(); clearPad(); } });
holdBtn('pG', 'gas'); holdBtn('pB', 'brk'); holdBtn('pL', 'l'); holdBtn('pR', 'r');

// ===== Controls =====
function pressed(id, on) { $(id).setAttribute('aria-pressed', String(on)); }
function setKind(k) {
  if (k === kind) return;
  kind = k;
  gameRootEl.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.v === k)));
  applyVisibility();
  lap.last = -1; lap.running = false; lap.t0 = -1; lap.time = 0; lap.idx = Math.floor(lap.prog / World.LTOT);
  updateBest();
}
function updateBest() { setText('progress', 'Best lap ' + fmt(best[kind] || -1)); }
function setCam(m) { state.cam = m; pressed('bCam', m === 'overview'); }
function start(k) {
  setKind(k);
  state.phase = 'play';
  $('start').hidden = true;
  resetRun();
  $('stage').focus({ preventScroll: true });
}
gameRootEl.querySelectorAll('.chip').forEach(c => c.addEventListener('click', e => { setKind(c.dataset.v); if (state.phase === 'menu') start(c.dataset.v); if (e.detail) c.blur(); }));
gameRootEl.querySelectorAll('.ride').forEach(c => c.addEventListener('click', () => start(c.dataset.v)));

let rebuildTimer = 0;
$('vox').addEventListener('input', e => {
  $('voxOut').textContent = e.target.value + ' cm';
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 120);
});
$('tod').addEventListener('input', e => {
  state.hour = Number(e.target.value) / 4;
  $('todOut').textContent = clockLabel(state.hour);
  setSun(state.hour);
});
['vox', 'tod'].forEach(id => $(id).addEventListener('change', e => e.target.blur()));
function toggle(id, key, fn) {
  const b = $(id);
  b.addEventListener('click', e => { state[key] = !state[key]; pressed(id, state[key]); if (fn) fn(); if (e.detail) b.blur(); });
  pressed(id, state[key]);
}
toggle('bTraffic', 'traffic');
toggle('bOrbit', 'orbit');
toggle('bLite', 'lite', resize);
toggle('bPad', 'pad', () => $('pad').classList.toggle('on', state.pad));
toggle('bSound', 'sound', () => { state.sound ? audioOn() : audioOff(); });
$('bCam').addEventListener('click', e => { setCam(state.cam === 'chase' ? 'overview' : 'chase'); if (e.detail) e.target.blur(); });
$('bReset').addEventListener('click', e => { if (state.phase === 'play') resetRun(); else { OV.az = 0; OV.pol = 0.95; OV.zoom = 1; } if (e.detail) e.target.blur(); });
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) { state.pad = true; pressed('bPad', true); $('pad').classList.add('on'); }
if (state.lite) pressed('bLite', true);

// Engine sound and pothole thump, off until the Sound button is pressed.
let actx = null, osc = null, gain = null, lp = null;
function audioOn() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    osc = actx.createOscillator(); gain = actx.createGain(); lp = actx.createBiquadFilter();
    osc.type = 'sawtooth'; lp.type = 'lowpass'; lp.frequency.value = 500; gain.gain.value = 0;
    osc.connect(lp); lp.connect(gain); gain.connect(actx.destination); osc.start();
  } catch (e) { state.sound = false; pressed('bSound', false); }
}
function audioOff() { try { if (osc) { osc.stop(); osc.disconnect(); osc = null; } } catch (e) {} }
function thump(sev) {
  if (!state.sound || !actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110, actx.currentTime); o.frequency.exponentialRampToValueAtTime(40, actx.currentTime + 0.18);
    g.gain.setValueAtTime(Math.min(0.35, 0.12 + 0.1 * sev), actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.22);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.25);
  } catch (e) {}
}
function audioTick() {
  if (!osc || !actx) return;
  const sp = VEH[kind], f = clamp(Math.abs(P.v) / sp.maxF, 0, 1), c = inp();
  const base = kind === 'bike' ? 70 : 48;
  osc.frequency.setTargetAtTime(base + f * (kind === 'bike' ? 150 : 110) + (c.up ? 12 : 0), actx.currentTime, 0.05);
  lp.frequency.setTargetAtTime(350 + f * 700, actx.currentTime, 0.05);
  gain.gain.setTargetAtTime(state.phase === 'play' ? 0.03 + (c.up ? 0.03 : 0) + f * 0.02 : 0, actx.currentTime, 0.08);
}

// ===== Minimap: a shaded height map of the built ground =====
const mini = $('mini'), mg = mini.getContext('2d');
const MW = mini.width, MH = mini.height, SL = World.SLAB;
const mx = x => (x - SL.x0) / (SL.x1 - SL.x0) * MW, mz = z => (z - SL.z0) / (SL.z1 - SL.z0) * MH;
const miniBg = document.createElement('canvas'); miniBg.width = MW; miniBg.height = MH;
const KC = (function () {
  const K = World.K, t = {};
  [K.ROAD, K.EDGE, K.DASH, K.ZEBRA, K.CHKD, K.CHKW, K.PIT, K.RIM, K.CRACK].forEach(k => t[k] = [75, 81, 89]);
  t[K.KERB] = [199, 194, 182]; t[K.WATER] = [79, 163, 209]; t[K.SAND] = [230, 214, 162]; t[K.GRASS] = [111, 191, 74];
  t[K.SCRUB] = [201, 178, 122]; t[K.LATER] = [181, 105, 74]; t[K.ROCK] = [142, 149, 155]; t[K.ROCK2] = [113, 120, 128];
  return t;
})();
function makeMini() {
  if (!HF) return;
  const g = miniBg.getContext('2d'), img = g.createImageData(MW, MH);
  for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
    const x = SL.x0 + (i + 0.5) / MW * (SL.x1 - SL.x0), z = SL.z0 + (j + 0.5) / MH * (SL.z1 - SL.z0);
    let c, sh;
    if (HF.stream) { // streamed map: nothing is built yet, so sample the map maths directly
      const k0 = World.column(x, z, 0.25), kk = k0.kind, h0 = k0.h, h1 = World.column(x - 0.8, z - 0.8, 0.25).h, h2 = World.column(x + 0.8, z + 0.8, 0.25).h;
      c = KC[kk] || [111, 191, 74];
      sh = clamp(1 + (h1 - h2) * 0.22 + (h0 - 3) * 0.03, 0.6, 1.35);
    } else {
      c = KC[World.hfKind(HF, x, z)] || [111, 191, 74];
      sh = clamp(1 + (gY(x - 0.8, z - 0.8) - gY(x + 0.8, z + 0.8)) * 0.22 + (gY(x, z) - 3) * 0.03, 0.6, 1.35);
    }
    const o = (j * MW + i) * 4;
    img.data[o] = Math.min(255, c[0] * sh); img.data[o + 1] = Math.min(255, c[1] * sh); img.data[o + 2] = Math.min(255, c[2] * sh); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#F4F1EA'; g.fillRect(mx(map.markings.startLine.x) - 1.5, mz(-World.HW), 3, World.HW * 2 * MW / (SL.x1 - SL.x0));
}
function drawMini() {
  mg.clearRect(0, 0, MW, MH);
  mg.drawImage(miniBg, 0, 0);
  NPC.forEach(n => { const a = A[n.key].root; mg.fillStyle = n.key === 'nAuto' ? '#F2C200' : '#D8392B'; mg.beginPath(); mg.arc(mx(a.position.x), mz(a.position.z), 4, 0, 6.3); mg.fill(); });
  mg.fillStyle = '#1D1E22';
  World.POTS.forEach(p => { mg.fillRect(mx(p.x) - 1, mz(p.z) - 1, 2.5, 2.5); });
  mg.save(); mg.translate(mx(P.x), mz(P.z)); mg.rotate(-P.psi);
  mg.fillStyle = '#F2A900'; mg.strokeStyle = '#1C1600'; mg.lineWidth = 1.5;
  mg.beginPath(); mg.moveTo(8, 0); mg.lineTo(-5, -5.5); mg.lineTo(-5, 5.5); mg.closePath(); mg.fill(); mg.stroke();
  mg.restore();
}

// ===== Loop =====
let last = performance.now(), clock = 0, hudT = 0;
const frustum = new THREE.Frustum(), pm = new THREE.Matrix4();
const txt = {};
function setText(id, s) { if (txt[id] !== s) { txt[id] = s; $(id).textContent = s; } }

function placeNpc(n, dt) {
  const a = A[n.key];
  if (state.traffic) n.s += n.dir * n.speed * dt;
  const tp = World.trackPoint(n.s, n.u);
  const y = gY(tp.x, tp.z);
  n.y = n.y === null || n.y === undefined ? y : lerp(n.y, y, Math.min(1, dt * 10));
  const fx = Math.cos(tp.psi), fz = -Math.sin(tp.psi), sgn = n.dir;
  const pitch = Math.atan2(gY(tp.x + fx * 1.0, tp.z + fz * 1.0) - gY(tp.x - fx * 1.0, tp.z - fz * 1.0), 2) * sgn;
  n.pitch = lerp(n.pitch || 0, pitch, Math.min(1, dt * 8));
  a.root.position.set(tp.x, n.y, tp.z);
  a.root.rotation.y = tp.psi + (n.dir < 0 ? Math.PI : 0);
  a.inner.rotation.z = n.pitch;
  a.inner.position.y = state.traffic ? Math.abs(Math.sin(clock * 9 + n.ph)) * 0.03 : 0;
}

// Sky and fog. Fog only closes in when the ground is streamed (so ground never appears to pop in at the edge of the loaded ring);
// it is measured from the camera, so the overview camera works too. "Classic" (hooks.sky === 'classic') leaves the old look.
function skyFrame(dt) {
  const on = hooks.sky !== 'classic';
  if (sky.enabled !== on) { sky.setEnabled(on); edge.setVisible(on); }
  if (!on || !stream || !stream.eff) { scene.fog = null; if (on) sky.update(camera, dt); return; }
  const cd = camera.position.distanceTo(_fogP.set(P.x, P.y, P.z)), eff = stream.eff;
  if (!scene.fog) scene.fog = new THREE.Fog(0xffffff, 10, 100);
  scene.fog.color.copy(sky.horizon);
  scene.fog.near = cd + eff * 0.45; scene.fog.far = cd + eff * 0.93;
  sky.update(camera, dt);
}
const _fogP = new THREE.Vector3();
function frame(now) {
  if (!alive) return;
  if (state.paused) { last = now; rafId = requestAnimationFrame(frame); return; }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  const playing = state.phase === 'play';

  if (playing && HF) {
    const ctl = inp(), n = 2;
    for (let i = 0; i < n; i++) step(dt / n, ctl);
    lapUpdate(dt);
  } else {
    P.v = 0;
    if (!reduced) OV.az += dt * 0.12;
  }
  if (state.orbit && !reduced && playing && state.cam === 'overview') OV.az += dt * 0.15;
  if (!cam.drag) cam.userAz *= Math.exp(-dt * 1.2);

  if (NPC[0]) { NPC[0].key = kind === 'car' ? 'nBike' : 'nCar'; NPC[0].r = kind === 'car' ? 0.6 : 0.95; }
  NPC.forEach(n => placeNpc(n, dt));

  const pa = kind === 'car' ? A.pCar : A.pBike, sp = VEH[kind];
  const target = P.gy !== undefined ? P.gy : gY(P.x, P.z);
  if (P.air || physNew()) P.y = P.by; else P.y = lerp(P.y, target, Math.min(1, dt * 14));
  const frac = clamp(Math.abs(P.v) / sp.maxF, 0, 1);
  pa.root.position.set(P.x, P.y + P.jy, P.z);
  pa.root.rotation.y = P.psi;
  const lean = -P.steer * frac * sp.lean * (P.v < 0 ? -1 : 1);
  pa.inner.rotation.x = lerp(pa.inner.rotation.x, lean + P.roll + P.wobRoll, Math.min(1, dt * 8));
  pa.inner.rotation.z = lerp(pa.inner.rotation.z, P.pitch + clamp(P.acc * 0.006, -0.06, 0.06), Math.min(1, dt * 6));
  pa.inner.position.y = Math.abs(Math.sin(clock * 9)) * 0.03 * Math.min(1, Math.abs(P.v));

  placeCamera(dt);
  const chase = state.cam === 'chase' && playing;
  const wantExt = chase ? 24 : 56;
  if (wantExt !== shadowExt) setShadowExt(wantExt);
  followShadow(chase || stream ? P.x : 0, chase ? P.y : 2, chase || stream ? P.z : -15);

  camera.updateMatrixWorld();
  pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(pm);
  if (stream) streamTick();
  for (let i = 0; i < groundChunks.length; i++) groundChunks[i].mesh.visible = frustum.intersectsBox(groundChunks[i].box);

  skyFrame(dt);
  renderer.shadowMap.needsUpdate = true;
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);

  setText('spd', String(Math.round(Math.abs(P.v) * (hooks.units === 'mph' ? 2.23694 : 3.6))));
  setText('lapN', String(lap.n));
  setText('lapT', lap.running ? fmt(lap.time) : '0:00.00');
  setText('lapL', fmt(lap.last));
  setText('potN', String(P.pot));
  setText('alt', P.y.toFixed(1));
  const gr = Math.round(Math.tan(P.pitch) * 100);
  setText('grade', (gr > 0 ? '+' : '') + gr + '%');
  P.potMsg = Math.max(0, P.potMsg - dt);
  const w = playing && lap.wrong > 0.6, pm2 = P.potMsg > 0;
  if ($('wrong').hidden === w) $('wrong').hidden = !w;
  if ($('potwarn').hidden === pm2) $('potwarn').hidden = !pm2;
  P.fallMsg = Math.max(0, P.fallMsg - dt);
  { const fw = $('fallwarn'), wf = P.fallMsg > 0; if (fw && fw.hidden === wf) fw.hidden = !wf; }
  { const ew = $('edgewarn'), want = state.phase === 'play' && (P.edgeOut || 0) > 0.25; if (ew && ew.hidden === want) ew.hidden = !want; }
  hudT += dt;
  if (hudT > 0.05) { hudT = 0; drawMini(); updateBest(); if (stream) setText('sStat', streamLine()); }
  audioTick();
  rafId = requestAnimationFrame(frame);
}

// ===== Boot =====
mods.car = buildCar(); mods.bike = buildBike(); mods.auto = buildAuto();
sprite($('thCar'), mods.car, CAR_MIN, CAR_MAX);
sprite($('thBike'), mods.bike, BIKE_MIN, BIKE_MAX);
resize();
setSun(state.hour);
if (hooks.vox) { $('vox').value = hooks.vox; $('voxOut').textContent = hooks.vox + ' cm'; } else if (state.lite) { $('vox').value = 25; $('voxOut').textContent = '25 cm'; }
$('tod').value = String(Math.round(state.hour * 4)); $('todOut').textContent = clockLabel(state.hour);
resetRun();
updateBest();
rafId = requestAnimationFrame(frame);
rebuild();
const api = {
  start, setCam, setKind, resetRun,
  get state() { return state; },
  get kind() { return kind; },
  get built() { return !!HF; },
  get memory() { return stream ? { streaming: true, tier: mem.tier, budget: mem.plan.budget, cubes: stream.groundCubes + stream.tileCubes + stream.vehicleCubes, peak: stream.peak, chunks: stream.chunks.size, tiles: stream.tiles.size, meshes: groundChunks.length } : { streaming: false, tier: mem.tier, budget: mem.plan ? mem.plan.budget : 0, estimate: mem.plan ? mem.plan.estimate : 0 }; },
  setPaused(p) { state.paused = !!p; if (p) { keys.clear(); clearPad(); } },
  resize
};
function dispose() {
  alive = false; buildId++; stream = null; try { sky.dispose(); edge.dispose(); } catch (e) {}
  cancelAnimationFrame(rafId); clearTimeout(rebuildTimer);
  _L.forEach(([t, e, f, o]) => t.removeEventListener(e, f, o)); _L.length = 0;
  try { audioOff(); if (actx) actx.close(); } catch (e) {}
  try { if (ro) ro.disconnect(); } catch (e) {}
  try {
    scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      if (o.shadow && o.shadow.map) o.shadow.map.dispose();
    });
    renderer.dispose();
    renderer.forceContextLoss();
  } catch (e) {}
  if (window.__loop === dbg) delete window.__loop;
}
// Test helper: building solids within R metres of the player whose scenery tile is not built yet (a vehicle would hit something it cannot see).
function unbuiltNear(R) {
  const S = stream; if (!S) return { streaming: false, near: 0, unbuilt: 0 };
  const T = S.ti.T; let near = 0, unbuilt = 0;
  for (let i = 0; i < SOLIDS.length; i++) {
    const q = SOLIDS[i]; if (q.t === 'c') continue;
    const cx = q.t === 'b' ? (q.x0 + q.x1) / 2 : q.x, cz = q.t === 'b' ? (q.z0 + q.z1) / 2 : q.z;
    if (Math.hypot(cx - P.x, cz - P.z) > R) continue;
    near++;
    const t = S.tiles.get(Math.floor(cx / T) + ',' + Math.floor(cz / T));
    if (!t) unbuilt++;
  }
  return { streaming: true, near, unbuilt, tiles: S.tiles.size, tileCubes: S.tileCubes, tileBudget: S.tileBudget };
}
const dbg = { unbuiltNear, get physics() { return hooks.physics; }, get rocks() { return ROCKS.size + '/' + PEBS.length; }, rockBump, get memory() { return api.memory; }, buildObjects, pushOut, inside, P, lap, state, SOLIDS, World, start, setCam, keys, A, gY, NPC, VEH, get HF() { return HF; }, potholeHit, setKind, step, inp, resetRun, lapUpdate, edge, FALL, fallReset, get kind() { return kind; }, get fog() { return scene.fog; }, get skyOn() { return sky.enabled; }, get order() { return stream && stream.order; } };
window.__loop = dbg;
return { api, dispose, debug: dbg };

}
