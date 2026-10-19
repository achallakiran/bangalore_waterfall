// Scenery and voxel builder shared by the map editor (E4). It is the same code the game runs (copied from game.js, which stays frozen so
// Hill Loop never changes); tests/rotate.mjs checks both produce the same shapes for the same map. No DOM, no THREE.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
export function createScenery(World, map) {
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

const { L, R, HW, PAV, LTOT, SLAB, K } = World;
// ===== Scenery: the gallery block plus more of the same, standing on the terrain =====
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
  SOLIDS.length = 0;
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

return { buildObjects, tileIndex, voxelTile, voxelTiled, voxelize, inside, SOLIDS, B, PT, S, C, OB };
}
