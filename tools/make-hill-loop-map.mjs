// One-time provenance script: writes public/maps/hill-loop.json from the frozen legacy world and scenery code.
// After it ran, the JSON file is the maintained source of the Hill Loop map; the legacy sources are never edited.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = new Function(fs.readFileSync(path.join(ROOT, 'tools/legacy-src/world.js'), 'utf8') + '\nreturn World;')();

const hex = n => '#' + n.toString(16).toUpperCase().padStart(6, '0');
const edges = [{ key: 'oval', type: 'oval', L: W.L, R: W.R, profile: null }];
W.LINES.forEach(e => edges.push({ key: e.key, type: 'line', a: [e.ax, e.az], b: [e.bx, e.bz], profile: e.pts }));
// Oval profile (same control points as the legacy source).
const LT = W.LTOT;
edges[0].profile = [[0, 0], [30, 0], [42, 0.8], [54, 2.0], [64, 2.8], [74, 2.75], [84, 3.5], [100, 3.5], [112, 3.3], [126, 2.0], [138, 0.7], [LT, 0]];

const CLUSTERS = [
  [0, 36, [[0, -1.1, 0.5], [2.2, -0.6, 0.4], [4.5, -1.3, 0.7]]], [0, 57, [[0, 1.2, 0.6], [3, 0.9, 0.45]]], [0, 66, [[0, -0.9, 0.9]]],
  [0, 88, [[0, 1.3, 0.5], [2, 0.6, 0.4], [5, 1.4, 0.7]]], [0, 98, [[0, -1.2, 0.55]]], [0, 117, [[0, 0.8, 0.7], [2.5, 1.4, 0.45]]],
  [0, 132, [[0, -1.0, 0.6], [3, -0.4, 0.5], [6, -1.2, 0.8]]], [0, 143, [[0, 1.1, 0.5]]], [0, 15, [[0, -1.3, 0.6], [3, -1.0, 0.45]]],
  [1, 8, [[0, 0.9, 0.6], [2, -0.6, 0.45]]], [1, 24, [[0, -1.2, 0.7], [3, -0.8, 0.5], [6, 1.0, 0.4]]], [1, 36, [[0, 1.1, 0.9]]],
  [1, 50, [[0, -0.9, 0.55], [2.5, -1.4, 0.4]]], [1, 62, [[0, 0.7, 0.6]]], [1, 78, [[0, -1.1, 0.7], [3, 1.2, 0.5]]],
  [2, 8, [[0, 0.8, 0.6], [2.5, -1.0, 0.5]]], [2, 14, [[0, -0.5, 0.8]]], [3, 6, [[0, 1.0, 0.6]]], [3, 12, [[0, -1.1, 0.5], [2, -0.7, 0.4]]]
];
const blob = (x, z, sx, sz, w = 1) => ({ x, z, sx, sz, w });
const padIds = ['shops', 'bus', 'far'];

// ---- Scenery, in the original draw order ----
const items = [];
let cur = null;
const flush = () => { if (cur && (cur.p.length || cur.solids.length)) items.push(cur); cur = null; };
const open = () => { if (!cur) cur = { t: 'prims', p: [], solids: [] }; return cur; };
const num = v => v;
const B = (x0, y0, z0, x1, y1, z1, col, jit) => open().p.push(['B', num(x0), num(y0), num(z0), num(x1), num(y1), num(z1), hex(col), jit]);
const PT = (x0, y0, z0, x1, y1, z1, col) => open().p.push(['PT', x0, y0, z0, x1, y1, z1, hex(col)]);
const C = (ax, a, bb, r, t0, t1, col, jit) => open().p.push(['C', ax, a, bb, r, t0, t1, hex(col), jit]);
const S = (cx, cy, cz, r, col, jit) => open().p.push(['S', cx, cy, cz, r, hex(col), jit]);
const box = (x0, z0, x1, z1) => open().solids.push(['b', x0, z0, x1, z1]);
const item = o => { flush(); items.push(o); };
const windows = (xa, xb, zf, ys, wh, ww, pitch, cols) => item({ t: 'windows', xa, xb, zf, ys, wh, ww, pitch, cols: cols.map(hex) });
const tree = (x, z, h, r) => item({ t: 'tree', x, z, h, r });
const lamp = (x, z, e, y0) => item({ t: 'lamp', x, z, e, y0 });

// Building 1
B(-9.5, 0, -6, -5.0, 4.5, -3.0, 0xE6D5AE, 0.05); B(-9.6, 4.5, -6.1, -4.9, 4.9, -2.9, 0xB89F79, 0.05);
windows(-9.0, -5.4, -3.0, [2.3, 3.5], 0.9, 0.8, 1.4, [0x7FA5C7, 0x7FA5C7, 0xF5D77A]);
PT(-7.9, 0, -3.4, -6.9, 1.8, -2.95, 0x6B4A33); box(-9.5, -6, -5.0, -3.0);
// Building 2
B(-4.5, 0, -6, 0, 6.5, -3.0, 0xC9D9E8, 0.04); B(-4.6, 6.5, -6.1, 0.1, 6.9, -2.9, 0x8DA2B5, 0.04);
windows(-4.1, -0.4, -3.0, [2.3, 3.6, 4.9], 0.9, 0.8, 1.3, [0x8EB4D6, 0x8EB4D6, 0x8EB4D6, 0xF5D77A]);
PT(-3.3, 0, -3.4, -1.2, 2.0, -2.95, 0x5B7C99); C('y', -3.2, -4.8, 0.75, 6.9, 8.0, 0x1F2227, 0.02); C('y', -1.2, -4.8, 0.75, 6.9, 8.0, 0x1F2227, 0.02);
box(-4.5, -6, 0, -3.0);
// Building 3: shop with awning
B(0.5, 0, -5.8, 5.5, 3.6, -3.0, 0xEDB88B, 0.05); B(1.0, 2.6, -3.0, 5.0, 3.3, -2.75, 0x1E4F8A, 0);
[1.3, 2.0, 2.7, 3.4, 4.1].forEach((x, i) => PT(x, 2.8 + (i % 2) * 0.1, -3.05, x + 0.4, 3.1 - (i % 2) * 0.1, -2.7, 0xF4F1EA));
for (let x = 0.5, n = 0; x < 5.5; x += 0.5, n++) B(x, 2.1, -3.0, x + 0.5, 2.4, -2.2, n % 2 ? 0xF4F1EA : 0xD9453D, 0.02);
PT(1.0, 0.4, -3.4, 2.8, 1.9, -2.95, 0x9FD3E3); PT(3.3, 0, -3.4, 4.2, 1.9, -2.95, 0x2E5E8C); box(0.5, -5.8, 5.5, -3.0);
// Building 4
B(6.0, 0, -6, 9.8, 5.2, -3.0, 0xF1D789, 0.05); B(5.9, 5.2, -6.1, 9.9, 5.6, -2.9, 0xC2A55A, 0.05);
windows(6.4, 9.3, -3.0, [1.5, 2.9, 4.2], 0.9, 0.7, 1.1, [0x7FA5C7, 0x7FA5C7, 0xF5D77A]);
box(6.0, -6, 9.8, -3.0);
// Fruit cart
[[7.3, -3.0], [8.3, -3.0], [7.3, -2.6], [8.3, -2.6]].forEach(w => C('z', w[0], 0.55, 0.3, w[1], w[1] + 0.25, 0x1D1E22, 0));
B(7.0, 0.6, -2.95, 8.6, 1.0, -2.4, 0x2E8B57, 0.04); B(7.05, 1.0, -2.9, 8.55, 1.2, -2.45, 0xF28C28, 0.15); B(7.7, 1.0, -2.9, 8.2, 1.2, -2.45, 0xD62E2E, 0.12);
C('y', 7.8, -2.7, 0.12, 1.2, 2.6, 0x9AA1A6, 0); B(7.1, 2.6, -3.3, 8.5, 2.8, -2.1, 0xF2A900, 0); B(7.3, 2.8, -3.1, 8.3, 3.0, -2.3, 0xF2A900, 0);
box(7.0, -2.95, 8.6, -2.4);
// Trees on the near grass
tree(-7.5, 4.6, 4.2, 1.6); tree(-2.5, 4.9, 3.6, 1.3); tree(5.5, 4.7, 4.4, 1.7);
// Bus shelter
[[1.2, 3.2], [3.3, 3.2], [1.2, 3.9], [3.3, 3.9]].forEach(q => B(q[0], 0, q[1], q[0] + 0.3, 2.6, q[1] + 0.3, 0x4D5660, 0.02));
B(1.0, 2.6, 3.0, 3.8, 2.9, 4.4, 0x2E7DBA, 0.03); B(1.2, 0.8, 3.2, 3.5, 2.6, 3.5, 0xA9D3EA, 0.02); B(1.4, 0.5, 3.7, 3.4, 0.8, 4.1, 0x8B6B4A, 0.05);
box(1.0, 3.0, 3.8, 4.4);
// Lamps
lamp(-6.0, 2.65, -1, 0.25); lamp(7.2, 2.65, -1, 0.25);
[-9, 1, 11].forEach(x => lamp(x, -32.65, 1, { pad: 'far', add: 0.25 }));
// Infield buildings
const bldgN = (x0, x1, depth, h, wall, trim, cols, ys, ww, pitch) => item({ t: 'bldgN', pad: 'far', zf: -27.0, x0, x1, depth, h, wall: hex(wall), trim: hex(trim), cols: cols.map(hex), ys, ww, pitch });
bldgN(-9.5, -4.6, 4.6, 4.2, 0xE8B4A0, 0xB98470, [0x7FA5C7, 0xF5D77A, 0x7FA5C7], [1.5, 2.8], 0.8, 1.3);
bldgN(-4.0, 1.0, 4.2, 7.4, 0xD6CBE6, 0x9D8DB8, [0x8EB4D6, 0x8EB4D6, 0xF5D77A], [1.4, 2.7, 4.0, 5.3], 0.8, 1.3);
bldgN(1.6, 6.2, 3.8, 3.4, 0xF0E0A8, 0xC2A55A, [0x7FA5C7, 0xF5D77A], [1.6], 0.9, 1.5);
open().p.push(['B', 1.6, { pad: 'far', add: 2.1 }, -27.8, 6.2, { pad: 'far', add: 2.4 }, -26.9, hex(0x2E8B57), 0.02]);
bldgN(7.0, 10.8, 4.4, 5.6, 0xBFDCCB, 0x86A894, [0x7FA5C7, 0x7FA5C7, 0xF5D77A], [1.5, 2.9, 4.2], 0.7, 1.1);
// Start gantry
{
  const gx = -12;
  [2.6, -2.6].forEach(z => { B(gx - 0.15, 0.25, z - 0.15, gx + 0.15, 4.9, z + 0.15, 0x4D5660, 0.02); open().solids.push(['c', gx, z, 0.3]); });
  for (let i = 0; i < 8; i++) B(gx - 0.2, 4.2, -2.8 + i * 0.7, gx + 0.2, 4.9, -2.1 + i * 0.7, i % 2 ? 0x1D1E22 : 0xF4F1EA, 0);
}
item({ t: 'guardposts', edges: [0, 1, 2, 3], from: 1.5, step: 3, offset: 3.15, outer: 2.2, minDrop: 1.0, colors: [hex(0xF4F1EA), hex(0xD9453D)] });
item({ t: 'cones', at: [[0, 36], [0, 88], [0, 132], [1, 24], [1, 50], [2, 8], [1, 78]], u: [-1.95, 1.95], back: 5 });
item({ t: 'scatter', grid: { x0: -40, x1: 40, z0: -46, z1: 16, step: 4.5 }, jitter: 3, bounds: { x0: -39.5, x1: 39.5, z0: -45.5, z1: 15.5 },
  clearRoad: 3.2, clearPad: 2.8, probe: 1.5, boulder: { p: 0.2, maxSlope: 1.6, r0: 0.5, rs: 0.7 }, maxSlope: 0.9,
  grassTree: { p: 0.14, h0: 3.2, hs: 8, r0: 1.1, rs: 0.5 }, scrubTree: { p: 0.05, h0: 2.6, hs: 8, r0: 0.9, rs: 0.3 } });
flush();

const map = {
  format: 'hill-loop-map', version: 1,
  meta: { id: 'hill-loop', name: 'Hill Loop Track', author: 'Hill Loop Track', description: 'The oval climbs round the east end, with cross roads, rock, scrub, a lake and potholes.', scale: 'game' },
  slab: { x0: W.SLAB.x0, x1: W.SLAB.x1, z0: W.SLAB.z0, z1: W.SLAB.z1 },
  ground: { layer: 0.25, chunk: 12 },
  terrain: {
    waterLevel: W.WATER, yMin: W.Y_MIN, yMax: W.Y_MAX, blend: 4.5,
    noise: { s1: 18, s2: 7, s3: 3.2 },
    relief: { hills: [1.6, 3.2, 0.8], rock: [2.2, 4.6, 1.0], scrub: 0.9, lake: 3.4 },
    lakeMin: 0.08, rockMin: 0.42, rock2At: 0.55, scrubMin: 0.5, laterAt: 0.72,
    biomes: { hills: [blob(34, -40, 14, 10), blob(-4, -46, 16, 6, 0.8)], rock: [blob(-33, -38, 11, 10)], scrub: [blob(-30, 10, 11, 7), blob(3, 15, 8, 4.5)], lake: [blob(30, 11, 9, 7)] }
  },
  roads: {
    halfWidth: W.HW, pavement: W.PAV, edgeLine: [1.75, 2.0], dash: { halfWidth: 0.125, period: 1.5, on: 0.75, offset: 4.5 }, junctionRadius: [3.0, 5.5],
    edges,
    junctions: W.JUNC.map(j => ({ x: j.x, z: j.z, h: j.h }))
  },
  markings: { zebra: { x0: 6.0, x1: 7.6, u0: -1.5, u1: 1.8, period: 0.6, duty: 0.3 }, startLine: { x: -12, halfWidth: 0.5, cell: 0.5 } },
  pads: W.FLATS.map((f, i) => ({ id: padIds[i], x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1, h: f.h, m: f.m })),
  potholes: { deepAt: 0.7, exclude: [{ edge: 0, zMin: -3, x: [[-13.5, -10.5], [5, 8.6]] }], clusters: CLUSTERS.map(c => ({ edge: c[0], t: c[1], items: c[2] })) },
  start: { x: -13.5, z: 1.0, psi: 0 },
  traffic: [
    { key: 'nBike', s: 20, dir: 1, u: 1.0, speed: 5.0, r: 0.6, ph: 0 },
    { key: 'nAuto', s: LT - 40, dir: -1, u: -1.0, speed: 3.6, r: 1.0, ph: 1.7 }
  ],
  scenery: items
};
const outFile = path.join(ROOT, 'public/maps/hill-loop.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const fmt = (k, v) => Array.isArray(v) ? '[\n' + v.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n ]' : JSON.stringify(v);
fs.writeFileSync(outFile, '{\n' + Object.keys(map).map(k => ' ' + JSON.stringify(k) + ': ' + fmt(k, map[k])).join(',\n') + '\n}\n');
console.log('wrote', outFile, fs.statSync(outFile).size, 'bytes,', items.length, 'scenery items');
