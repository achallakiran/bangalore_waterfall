// Curved road centre lines (E3). A curve is a smooth Catmull-Rom path through 2 to 24 control points, sampled about every metre.
// Shared by the world (to draw and drive it), the validator (to know its length) and the editor (to snap and hit-test).
// Two points give a straight road, so a curve with two points is the same road as a "line" edge.
export const CURVE_STEP = 1;
export function sampleCurve(pts, step = CURVE_STEP) {
  const n = pts.length, xs = [pts[0][0]], zs = [pts[0][1]], ss = [0];
  const P = i => pts[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), m = Math.max(1, Math.ceil(segLen / step));
    for (let k = 1; k <= m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      const j = xs.length - 1;
      xs.push(x); zs.push(z); ss.push(ss[j] + Math.hypot(x - xs[j], z - zs[j]));
    }
  }
  return { xs, zs, ss, len: ss[ss.length - 1], n: xs.length };
}
// Nearest point on a sampled curve: { d, t (distance along), side (negative = left of travel) }. Blocks of 8 segments are skipped by box distance.
const BLK = 8;
export function prepareCurve(c) {
  c.boxes = [];
  for (let a = 0; a < c.n - 1; a += BLK) {
    const b = Math.min(c.n - 1, a + BLK); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = a; i <= b; i++) { if (c.xs[i] < x0) x0 = c.xs[i]; if (c.xs[i] > x1) x1 = c.xs[i]; if (c.zs[i] < z0) z0 = c.zs[i]; if (c.zs[i] > z1) z1 = c.zs[i]; }
    c.boxes.push([x0, x1, z0, z1, a, b]);
  }
  return c;
}
const res = { d: 0, t: 0, side: 0 };
export function nearCurve(c, x, z) {
  let best = Infinity, bt = 0, bs = 0;
  for (let q = 0; q < c.boxes.length; q++) {
    const bx = c.boxes[q], ddx = Math.max(bx[0] - x, 0, x - bx[1]), ddz = Math.max(bx[2] - z, 0, z - bx[3]);
    if (ddx * ddx + ddz * ddz >= best * best) continue;
    for (let i = bx[4]; i < bx[5]; i++) {
      const ax = c.xs[i], az = c.zs[i], dx = c.xs[i + 1] - ax, dz = c.zs[i + 1] - az, sl = c.ss[i + 1] - c.ss[i] || 1e-9;
      const ux = dx / sl, uz = dz / sl, px = x - ax, pz = z - az, t = Math.min(sl, Math.max(0, px * ux + pz * uz));
      const cx = px - ux * t, cz = pz - uz * t, d = Math.hypot(cx, cz);
      if (d < best) { best = d; bt = c.ss[i] + t; bs = px * -uz + pz * ux; }
    }
  }
  res.d = best; res.t = bt; res.side = bs;
  return res;
}
export function curvePoint(c, s, u) {
  s = Math.min(c.len, Math.max(0, s));
  let lo = 0, hi = c.n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c.ss[mid] <= s) lo = mid; else hi = mid; }
  const sl = c.ss[hi] - c.ss[lo] || 1e-9, f = (s - c.ss[lo]) / sl;
  const dx = (c.xs[hi] - c.xs[lo]) / sl, dz = (c.zs[hi] - c.zs[lo]) / sl;
  return { x: c.xs[lo] + (c.xs[hi] - c.xs[lo]) * f + -dz * u, z: c.zs[lo] + (c.zs[hi] - c.zs[lo]) * f + dx * u, psi: Math.atan2(-dz, dx) };
}
