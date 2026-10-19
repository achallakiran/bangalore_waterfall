// Engine stage E1: turned buildings, turned colliders and turned pads.
// A building with yaw 0 must draw the same shapes as the old axis-aligned building, and a turned one must be solid where it really stands.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, waitBuilt } from './lib.mjs';
import { validateMap } from '../src/maps/format.js';
import * as ED from '../src/editor/model.js';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const { srv, url } = await serve(path.join(ROOT, 'dist'));
const browser = await launch();
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'), 'utf8'));
base.pads = []; base.scenery = [];
const look = { wall: '#E6D5AE', trim: '#8A6D4B', cols: ['#7FA5C7', '#F5D77A'], ys: [1.5, 3.5], ww: 0.8, pitch: 1.25 };
function mapWith(id, pad, item) {
  const m = JSON.parse(JSON.stringify(base)); m.meta.id = id; m.meta.name = id;
  m.pads.push(Object.assign({ id: 't1', h: 3, m: 2 }, pad)); m.scenery.push(item); return m;
}
const PAD0 = { x0: -39.5, x1: -34.5, z0: -0.5, z1: 4.5 };
const A = mapWith('rot-a', PAD0, Object.assign({ t: 'bldgN', id: 't1', pad: 't1', zf: 0, x0: -39, x1: -35, depth: 4, h: 6 }, look));
const Y0 = mapWith('rot-b', PAD0, Object.assign({ t: 'bldgY', id: 't1', pad: 't1', cx: -37, cz: 2, w: 4, depth: 4, h: 6, yaw: 0 }, look));
const Y30 = mapWith('rot-c', Object.assign({}, PAD0, { yaw: 30 }), Object.assign({ t: 'bldgY', id: 't1', pad: 't1', cx: -37, cz: 2, w: 4, depth: 4, h: 6, yaw: 30 }, look));
[A, Y0, Y30].forEach((m, i) => ok(validateMap(m).ok, `test map ${i + 1} passes the validator`));
const bad = JSON.parse(JSON.stringify(Y30)); bad.scenery[0].yaw = 'x';
ok(!validateMap(bad).ok, 'validator: a non-numeric yaw is refused');

async function boot(map) {
  const { page, errors, ctx } = await newPage(browser);
  await ctx.addInitScript(v => { try { localStorage.setItem('hl2.settings.v1', v); } catch (e) {} }, JSON.stringify({ vox: 32, budget: 'medium' }));
  await page.goto(url + 'index.html');
  await page.evaluate(() => window.__v2.show('scMaps'));
  await page.setInputFiles('#mapFile', { name: 'm.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(map)) });
  await page.waitForFunction(() => !document.getElementById('scRide').hidden);
  await page.click('[data-ride="car"]', { timeout: 150000 });
  await waitBuilt(page);
  return { page, errors, ctx };
}
const shapes = page => page.evaluate(() => window.__loop.buildObjects().map(p => ({ k: p.k, b: p.b, col: p.col, jit: p.jit, paint: !!p.paint })));

const a = await boot(A), pa = await shapes(a.page);
const b = await boot(Y0), pb = await shapes(b.page);
ok(pa.length === pb.length && pa.length > 5, `yaw 0 draws the same number of shapes as the old building (${pa.length})`);
let worst = 0, same = true;
pa.forEach((p, i) => { const q = pb[i]; if (!q || p.k !== q.k || p.col !== q.col || p.jit !== q.jit || p.paint !== q.paint) same = false; else p.b.forEach((v, j) => { worst = Math.max(worst, Math.abs(v - q.b[j])); }); });
ok(same && worst < 1e-9, `yaw 0 shapes match the old ones in kind, colour and size (largest difference ${worst.toExponential(1)} m)`);
const sa = await a.page.evaluate(() => window.__loop.SOLIDS.map(s => [s.t, s.x0, s.z0, s.x1, s.z1]));
const sb = await b.page.evaluate(() => window.__loop.SOLIDS.map(s => [s.t, s.x0, s.z0, s.x1, s.z1]));
ok(JSON.stringify(sa) === JSON.stringify(sb), 'yaw 0 collider is the same plain box as before');
ok(a.errors.length + b.errors.length === 0, 'no page errors (yaw 0)');
await a.ctx.close(); await b.ctx.close();

const c = await boot(Y30);
const r = await c.page.evaluate(() => {
  const L = window.__loop, P = L.buildObjects();
  const sol = L.SOLIDS.find(s => s.t === 'o');
  const wall = P.find(p => p.k === 'o' && p.y0 < 3);
  const W = (lx, lz) => [-37 + lx * sol.c + lz * sol.s, 2 - lx * sol.s + lz * sol.c];
  const out = { hasSolid: !!sol, hasWall: !!wall };
  if (!sol || !wall) return out;
  const hw = 2, hd = 2;
  const nearSide = W(hw + 0.05, 0), farSide = W(hw + 0.6, 0), inCentre = W(0, 0);
  const pOut = L.pushOut(nearSide[0], nearSide[1], 0.1), pFar = L.pushOut(farSide[0], farSide[1], 0.1);
  out.push = pOut; out.dir = [sol.c, -sol.s]; out.far = pFar;
  out.centrePush = L.pushOut(inCentre[0], inCentre[1], 0.1);
  // the old (unturned) corner of the footprint is no longer solid, the turned corner is
  const oldCorner = L.pushOut(-35 + 0.02, 4 - 0.02, 0.05);
  const newCorner = W(hw - 0.05, hd - 0.05); out.newCornerPush = L.pushOut(newCorner[0], newCorner[1], 0.05);
  out.oldCorner = oldCorner;
  const y = 3 + 2;
  const c0 = W(0, 0), c1 = W(hw + 0.5, 0), c2 = W(hw - 0.1, hd - 0.1), c3 = [-35 - 0.02, 4 - 0.02];
  out.drawn = [L.inside(wall, c0[0], y, c0[1]), L.inside(wall, c1[0], y, c1[1]), L.inside(wall, c2[0], y, c2[1]), L.inside(wall, c3[0], y, c3[1])];
  // pad: turned with the building
  const h = (lx, lz) => { const q = W(lx, lz); return L.World.column(q[0], q[1], 0.2).h; };
  out.padIn = h(2.2, 0); out.padOut = h(2.5 + 8, 0);
  const oc = L.World.column(-39.5, -0.5, 0.2).h; out.padUnturnedCorner = oc;
  return out;
});
ok(r.hasSolid && r.hasWall, 'a turned building makes an oriented collider and an oriented wall');
ok(r.push && Math.hypot(r.push[0], r.push[1]) > 0.04 && Math.hypot(r.push[0], r.push[1]) < 0.1 && Math.abs(r.push[0] * r.dir[1] - r.push[1] * r.dir[0]) < 1e-6 && r.push[0] * r.dir[0] + r.push[1] * r.dir[1] > 0,
  `the car is pushed straight out of the turned wall (${r.push && r.push.map(v => v.toFixed(3))})`);
ok(r.far && Math.hypot(r.far[0], r.far[1]) === 0, 'clear of the turned wall there is no push');
ok(r.centrePush && Math.hypot(r.centrePush[0], r.centrePush[1]) > 0.1, 'inside the footprint the car is pushed out');
ok(Math.hypot(...r.newCornerPush) > 0.01 && Math.hypot(...r.oldCorner) === 0, 'the turned corner is solid and the old unturned corner is free');
ok(r.drawn && r.drawn[0] && !r.drawn[1] && r.drawn[2] && !r.drawn[3], 'the wall is drawn where the turned building stands, not at its old corner');
ok(Math.abs(r.padIn - 3) < 1e-9 && Math.abs(r.padOut - 3) > 0.2, `the pad is turned with the building (inside ${r.padIn.toFixed(2)} m, 8 m beyond ${r.padOut.toFixed(2)} m)`);
ok(c.errors.length === 0, 'no page errors (yaw 30)' + (c.errors.length ? ': ' + c.errors[0] : ''));
await c.page.screenshot({ path: path.join(ROOT, 'tests', 'output', 'rotate.png') }).catch(() => {});
await c.ctx.close();

// ---- Hand-shaped ground: the same heights and surfaces whole and streamed, and a turned shop drawn on a graded plot ----
const LM = ED.newMapFrom(base); LM.meta.id = 'layers-test'; LM.meta.name = 'layers-test';
ED.sculptBrush(LM, -36, -8, 6, 1.2, 'raise'); ED.gradeTo(LM, -37, 6, 4, 2, 3); ED.paintBrush(LM, -37, 6, 6, 'paver'); ED.paintBrush(LM, -36, -8, 3, 'soil');
ED.addBuildingY(LM, { cx: -37, cz: 6, w: 6, depth: 4, h: 6, yaw: 35, shop: { name: 'Plot Stores' } });
ED.addCurve(LM, [[-38, -36], [-15, -44], [10, -38], [38, -45]], 0, 3);
ok(validateMap(LM).ok, 'layers and curve test map passes the validator');
const PTS = []; for (let i = 0; i < 30; i++) PTS.push([-41 + (i * 7 % 13), -14 + (i * 5 % 23)]);
for (let i = 0; i < 24; i++) PTS.push([-36 + i * 3.1, -41 + 3 * Math.sin(i / 3)]);
async function sampleMap(query) {
  const { page, errors, ctx } = await newPage(browser);
  await ctx.addInitScript(v => { try { localStorage.setItem('hl2.settings.v1', v); } catch (e) {} }, JSON.stringify({ vox: 32, budget: 'medium' }));
  await page.goto(url + 'index.html' + query);
  await page.evaluate(() => window.__v2.show('scMaps'));
  await page.setInputFiles('#mapFile', { name: 'm.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(LM)) });
  await page.waitForFunction(() => !document.getElementById('scRide').hidden);
  await page.click('[data-ride="car"]', { timeout: 150000 });
  await waitBuilt(page);
  const r = await page.evaluate(pts => ({ y: pts.map(([x, z]) => window.__loop.gY(x, z)), k: pts.map(([x, z]) => window.__loop.World.column(x, z, 0.32).kind), stream: window.__loop.memory.streaming }), PTS);
  if (!query) await page.screenshot({ path: path.join(ROOT, 'tests', 'output', 'layers.png') }).catch(() => {});
  await ctx.close(); return Object.assign(r, { errors });
}
const lw = await sampleMap(''), ls = await sampleMap('?stream=1&cubes=30000');
ok(!lw.stream && ls.stream, 'one run is whole, the other streamed');
const dY = Math.max(...lw.y.map((v, i) => Math.abs(v - ls.y[i])));
ok(dY < 1e-6 && lw.k.every((k, i) => k === ls.k[i]), `sculpted and painted ground is identical whole and streamed (max difference ${dY.toExponential(1)})`);
ok(lw.k.includes(19) && lw.k.includes(16) && lw.k.slice(30).filter(k => k === 1).length > 5, 'painted pavers, mud and the curved road show up in the sampled ground');
ok(lw.errors.length + ls.errors.length === 0, 'no page errors with hand-shaped ground');

await browser.close(); srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall rotation checks passed');
process.exit(failed ? 1 : 0);
