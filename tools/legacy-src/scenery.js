// ===== Scenery: the gallery block plus more of the same, standing on the terrain =====
const { L, R, HW, PAV, LTOT, SLAB, K } = World;
const SOLIDS = [];
const box = (x0, z0, x1, z1) => SOLIDS.push({ t: 'b', x0, z0, x1, z1 });
const circ = (x, z, r) => SOLIDS.push({ t: 'c', x, z, r });
const gh = (x, z) => World.heightAt(x, z);

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
// A building on the infield side of the far straight, front face toward -z, standing on a pad at height y0.
function bldgN(P, x0, x1, depth, h, wall, trim, cols, ys, ww, pitch) {
  const zf = -27.0, y0 = World.FLATS[2].h;
  P.push(B(x0, y0 - 0.4, zf, x1, y0 + h, zf + depth, wall, 0.05));
  P.push(B(x0 - 0.1, y0 + h, zf - 0.1, x1 + 0.1, y0 + h + 0.4, zf + depth + 0.1, trim, 0.05));
  for (let x = x0 + 0.5, ix = 0; x + ww <= x1 - 0.3; x += pitch, ix++) {
    ys.forEach((yy, iy) => P.push(PT(x, y0 + yy, zf - 0.05, x + ww, y0 + yy + 0.9, zf + 0.45, cols[(ix * 3 + iy * 5) % cols.length])));
  }
  P.push(PT(x0 + 1.0, y0, zf - 0.05, x0 + 2.0, y0 + 1.8, zf + 0.45, 0x6B4A33));
  box(x0, zf, x1, zf + depth);
}
function cone(P, x, z, y0) {
  P.push(B(x - 0.25, y0, z - 0.25, x + 0.25, y0 + 0.08, z + 0.25, 0x23252B, 0));
  P.push(C('y', x, z, 0.2, y0 + 0.08, y0 + 0.3, 0xF28C28, 0.02));
  P.push(C('y', x, z, 0.12, y0 + 0.3, y0 + 0.55, 0xF28C28, 0.02));
  P.push(C('y', x, z, 0.16, y0 + 0.24, y0 + 0.34, 0xF4F1EA, 0));
}

function buildObjects() {
  SOLIDS.length = 0;
  const P = [];

  // Building 1: cream, three floors of small windows.
  P.push(B(-9.5, 0, -6, -5.0, 4.5, -3.0, 0xE6D5AE, 0.05));
  P.push(B(-9.6, 4.5, -6.1, -4.9, 4.9, -2.9, 0xB89F79, 0.05));
  windowsRow(P, -9.0, -5.4, -3.0, [2.3, 3.5], 0.9, 0.8, 1.4, [0x7FA5C7, 0x7FA5C7, 0xF5D77A]);
  P.push(PT(-7.9, 0, -3.4, -6.9, 1.8, -2.95, 0x6B4A33));
  box(-9.5, -6, -5.0, -3.0);

  // Building 2: pale blue office block with rooftop water tanks.
  P.push(B(-4.5, 0, -6, 0, 6.5, -3.0, 0xC9D9E8, 0.04));
  P.push(B(-4.6, 6.5, -6.1, 0.1, 6.9, -2.9, 0x8DA2B5, 0.04));
  windowsRow(P, -4.1, -0.4, -3.0, [2.3, 3.6, 4.9], 0.9, 0.8, 1.3, [0x8EB4D6, 0x8EB4D6, 0x8EB4D6, 0xF5D77A]);
  P.push(PT(-3.3, 0, -3.4, -1.2, 2.0, -2.95, 0x5B7C99));
  P.push(C('y', -3.2, -4.8, 0.75, 6.9, 8.0, 0x1F2227, 0.02));
  P.push(C('y', -1.2, -4.8, 0.75, 6.9, 8.0, 0x1F2227, 0.02));
  box(-4.5, -6, 0, -3.0);

  // Building 3: shop with striped awning and a signboard.
  P.push(B(0.5, 0, -5.8, 5.5, 3.6, -3.0, 0xEDB88B, 0.05));
  P.push(B(1.0, 2.6, -3.0, 5.0, 3.3, -2.75, 0x1E4F8A, 0));
  [1.3, 2.0, 2.7, 3.4, 4.1].forEach((x, i) => P.push(PT(x, 2.8 + (i % 2) * 0.1, -3.05, x + 0.4, 3.1 - (i % 2) * 0.1, -2.7, 0xF4F1EA)));
  for (let x = 0.5, n = 0; x < 5.5; x += 0.5, n++) P.push(B(x, 2.1, -3.0, x + 0.5, 2.4, -2.2, n % 2 ? 0xF4F1EA : 0xD9453D, 0.02));
  P.push(PT(1.0, 0.4, -3.4, 2.8, 1.9, -2.95, 0x9FD3E3));
  P.push(PT(3.3, 0, -3.4, 4.2, 1.9, -2.95, 0x2E5E8C));
  box(0.5, -5.8, 5.5, -3.0);

  // Building 4: yellow block behind the fruit cart.
  P.push(B(6.0, 0, -6, 9.8, 5.2, -3.0, 0xF1D789, 0.05));
  P.push(B(5.9, 5.2, -6.1, 9.9, 5.6, -2.9, 0xC2A55A, 0.05));
  windowsRow(P, 6.4, 9.3, -3.0, [1.5, 2.9, 4.2], 0.9, 0.7, 1.1, [0x7FA5C7, 0x7FA5C7, 0xF5D77A]);
  box(6.0, -6, 9.8, -3.0);

  // Fruit cart with umbrella on the pavement.
  [[7.3, -3.0], [8.3, -3.0], [7.3, -2.6], [8.3, -2.6]].forEach(w => P.push(C('z', w[0], 0.55, 0.3, w[1], w[1] + 0.25, 0x1D1E22, 0)));
  P.push(B(7.0, 0.6, -2.95, 8.6, 1.0, -2.4, 0x2E8B57, 0.04));
  P.push(B(7.05, 1.0, -2.9, 8.55, 1.2, -2.45, 0xF28C28, 0.15));
  P.push(B(7.7, 1.0, -2.9, 8.2, 1.2, -2.45, 0xD62E2E, 0.12));
  P.push(C('y', 7.8, -2.7, 0.12, 1.2, 2.6, 0x9AA1A6, 0));
  P.push(B(7.1, 2.6, -3.3, 8.5, 2.8, -2.1, 0xF2A900, 0));
  P.push(B(7.3, 2.8, -3.1, 8.3, 3.0, -2.3, 0xF2A900, 0));
  box(7.0, -2.95, 8.6, -2.4);

  // Trees on the near grass, from the gallery (the one at x = 8.6 made way for the south link).
  tree(P, -7.5, 4.6, 4.2, 1.6);
  tree(P, -2.5, 4.9, 3.6, 1.3);
  tree(P, 5.5, 4.7, 4.4, 1.7);

  // Bus shelter.
  [[1.2, 3.2], [3.3, 3.2], [1.2, 3.9], [3.3, 3.9]].forEach(q => P.push(B(q[0], 0, q[1], q[0] + 0.3, 2.6, q[1] + 0.3, 0x4D5660, 0.02)));
  P.push(B(1.0, 2.6, 3.0, 3.8, 2.9, 4.4, 0x2E7DBA, 0.03));
  P.push(B(1.2, 0.8, 3.2, 3.5, 2.6, 3.5, 0xA9D3EA, 0.02));
  P.push(B(1.4, 0.5, 3.7, 3.4, 0.8, 4.1, 0x8B6B4A, 0.05));
  box(1.0, 3.0, 3.8, 4.4);

  // Lamps: the two from the gallery, then three along the far straight, standing on its (raised) kerb.
  lamp(P, -6.0, 2.65, -1, 0.25);
  lamp(P, 7.2, 2.65, -1, 0.25);
  const hF = World.FLATS[2].h + 0.25;
  [-9, 1, 11].forEach(x => lamp(P, x, -32.65, 1, hF));

  // Infield buildings on the far-straight pad.
  bldgN(P, -9.5, -4.6, 4.6, 4.2, 0xE8B4A0, 0xB98470, [0x7FA5C7, 0xF5D77A, 0x7FA5C7], [1.5, 2.8], 0.8, 1.3);
  bldgN(P, -4.0, 1.0, 4.2, 7.4, 0xD6CBE6, 0x9D8DB8, [0x8EB4D6, 0x8EB4D6, 0xF5D77A], [1.4, 2.7, 4.0, 5.3], 0.8, 1.3);
  bldgN(P, 1.6, 6.2, 3.8, 3.4, 0xF0E0A8, 0xC2A55A, [0x7FA5C7, 0xF5D77A], [1.6], 0.9, 1.5);
  P.push(B(1.6, World.FLATS[2].h + 2.1, -27.8, 6.2, World.FLATS[2].h + 2.4, -26.9, 0x2E8B57, 0.02));
  bldgN(P, 7.0, 10.8, 4.4, 5.6, 0xBFDCCB, 0x86A894, [0x7FA5C7, 0x7FA5C7, 0xF5D77A], [1.5, 2.9, 4.2], 0.7, 1.1);

  // Start gantry on the near straight with a chequered banner.
  const gx = -12;
  [2.6, -2.6].forEach(z => { P.push(B(gx - 0.15, 0.25, z - 0.15, gx + 0.15, 4.9, z + 0.15, 0x4D5660, 0.02)); circ(gx, z, 0.3); });
  for (let i = 0; i < 8; i++) P.push(B(gx - 0.2, 4.2, -2.8 + i * 0.7, gx + 0.2, 4.9, -2.1 + i * 0.7, i % 2 ? 0x1D1E22 : 0xF4F1EA, 0));

  // Guard posts where the road runs along a drop of more than a metre (hill-road look).
  [0, 1, 2, 3].forEach(ei => {
    const n = World.edgeLen(ei);
    let pi = 0;
    for (let t = 1.5; t < n - 1; t += 3) {
      [-1, 1].forEach(sd => {
        const p = World.edgePoint(ei, t, sd * 3.15), q = World.edgePoint(ei, t, sd * (PAV + 2.2));
        if (World.tarmacCount(p.x, p.z) > 1 || World.tarmacCount(q.x, q.z) > 1) return;
        const rh = World.edgeH(ei, t), drop = rh - gh(q.x, q.z);
        if (drop < 1.0) return;
        P.push(B(p.x - 0.12, rh - 0.1, p.z - 0.12, p.x + 0.12, rh + 0.85, p.z + 0.12, (pi++ & 1) ? 0xF4F1EA : 0xD9453D, 0));
        circ(p.x, p.z, 0.2);
      });
    }
  });

  // Cones ahead of some pothole clusters, on the shoulder inside the edge line.
  [[0, 36], [0, 88], [0, 132], [1, 24], [1, 50], [2, 8], [1, 78]].forEach(c => {
    [-1.95, 1.95].forEach(u => { const p = World.edgePoint(c[0], Math.max(0.5, c[1] - 5), u); cone(P, p.x, p.z, World.edgeH(c[0], Math.max(0.5, c[1] - 5))); });
  });

  // Trees on a jittered lattice and boulders in the rock country; clear of roads, pads and steep ground.
  for (let gx2 = -40; gx2 <= 40; gx2 += 4.5) {
    for (let gz = -46; gz <= 16; gz += 4.5) {
      const hx = World.hash3(Math.round(gx2 * 10), Math.round(gz * 10), 7, 11);
      const hz = World.hash3(Math.round(gx2 * 10), Math.round(gz * 10), 13, 5);
      const hk = World.hash3(Math.round(gx2 * 10), Math.round(gz * 10), 17, 9);
      const x = gx2 + (hx - 0.5) * 3, z = gz + (hz - 0.5) * 3;
      if (x < -39.5 || x > 39.5 || z < -45.5 || z > 15.5) continue;
      const c = World.column(x, z, 0.2), kind = c.kind, d = c.d, h = c.h;
      if (d < PAV + 3.2 || World.inFlat(x, z, 2.8)) continue;
      const slope = Math.max(Math.abs(gh(x + 1.5, z) - h), Math.abs(gh(x - 1.5, z) - h), Math.abs(gh(x, z + 1.5) - h), Math.abs(gh(x, z - 1.5) - h));
      if (kind === K.ROCK || kind === K.ROCK2) { if (hk < 0.2 && slope < 1.6) boulder(P, x, z, 0.5 + hx * 0.7); continue; }
      if (slope > 0.9) continue;
      if (kind === K.GRASS && hk < 0.14) tree(P, x, z, 3.2 + hk * 8, 1.1 + hx * 0.5);
      else if (kind === K.SCRUB && hk < 0.05) tree(P, x, z, 2.6 + hk * 8, 0.9 + hx * 0.3);
    }
  }
  return P;
}

// Voxelize in 16 m tiles on the global lattice, so a bigger map never needs one giant grid.
function voxelTiled(P, v, seed) {
  const T = Math.round(16 / v) * v, tiles = new Map();
  P.forEach((p, idx) => {
    const b = p.b;
    for (let tx = Math.floor(b[0] / T); tx <= Math.floor((b[3] - 1e-6) / T); tx++) for (let tz = Math.floor(b[2] / T); tz <= Math.floor((b[5] - 1e-6) / T); tz++) {
      const key = tx + ',' + tz; let a = tiles.get(key);
      if (!a) { a = { tx, tz, list: [] }; tiles.set(key, a); }
      a.list.push(p);
    }
  });
  const pos = [], col = [];
  tiles.forEach(t => {
    let y0 = 1e9, y1 = -1e9;
    t.list.forEach(p => { if (p.b[1] < y0) y0 = p.b[1]; if (p.b[4] > y1) y1 = p.b[4]; });
    y0 = Math.floor(y0 / v) * v; y1 = Math.ceil(y1 / v) * v + v;
    const d = voxelize(t.list, [t.tx * T, y0, t.tz * T], [(t.tx + 1) * T, y1, (t.tz + 1) * T], v, seed);
    for (let i = 0; i < d.pos.length; i++) pos.push(d.pos[i]);
    for (let i = 0; i < d.col.length; i++) col.push(d.col[i]);
  });
  return { count: pos.length / 3, pos: new Float32Array(pos), col: new Float32Array(col), v };
}
