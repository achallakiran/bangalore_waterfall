// Streaming and memory budgets (Phase 3).
// 1. Hill Loop forced into streaming with a small budget: memory stays under it, chunks come and go as the player moves,
//    and the ground height / surface kind match the whole-map build exactly.
// 2. A big synthetic map (320 m wide) streams by itself on the default budget and stays bounded wherever the player goes.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, waitBuilt, frames } from './lib.mjs';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const { srv, url } = await serve(path.join(ROOT, 'dist'));
const browser = await launch();
const SETTINGS = JSON.stringify({ vox: 32, budget: 'medium' });
async function open(query, extra) {
  const { page, errors, ctx } = await newPage(browser);
  await ctx.addInitScript(s => { try { localStorage.setItem('hl2.settings.v1', s); } catch (e) {} }, SETTINGS);
  await page.goto(url + 'index.html' + (query || ''));
  return { page, errors, ctx };
}
async function ride(page, kind = 'car') { await page.evaluate(() => window.__v2.show('scRide')); await page.click(`[data-ride="${kind}"]`); await waitBuilt(page); }
const mem = page => page.evaluate(() => window.__loop.memory);
const teleport = async (page, x, z) => { await page.evaluate(([x, z]) => { const P = window.__loop.P; P.x = x; P.z = z; }, [x, z]); await frames(page, 90); await page.waitForTimeout(200); };

const PTS = []; for (let i = 0; i < 40; i++) PTS.push([-38 + (i * 37 % 76), -44 + (i * 53 % 60)]);
const sample = page => page.evaluate(pts => pts.map(([x, z]) => [window.__loop.gY(x, z), window.__loop.World.column(x, z, 0.32).kind]), PTS);

// ---- 1. Hill Loop, whole vs forced streaming ----
const whole = await open();
await ride(whole.page);
const m0 = await mem(whole.page);
ok(m0.streaming === false, `Hill Loop is held whole on the default budget (estimate ${m0.estimate.toLocaleString()} cubes, budget ${m0.budget.toLocaleString()})`);
const refY = await sample(whole.page);
await whole.ctx.close();

const BUD = 30000;
const st = await open(`?stream=1&cubes=${BUD}`);
await ride(st.page);
let m = await mem(st.page);
ok(m.streaming === true && m.budget === BUD, `forced streaming starts (budget ${BUD.toLocaleString()} cubes)`);
ok(m.cubes <= BUD && m.chunks > 0, `at the start ${m.cubes.toLocaleString()} cubes are live in ${m.chunks} chunks and ${m.tiles} tiles, under the budget`);
const strY = await sample(st.page);
let maxDiff = 0, kindDiff = 0;
strY.forEach((s, i) => { maxDiff = Math.max(maxDiff, Math.abs(s[0] - refY[i][0])); if (s[1] !== refY[i][1]) kindDiff++; });
ok(maxDiff < 1e-6, `ground height is identical to the whole-map build at ${PTS.length} points (max difference ${maxDiff.toExponential(1)})`);
const seen = new Set(); let peak = m.cubes;
for (const [x, z] of [[30, -40], [-30, 10], [0, -46], [35, 14], [-35, -40], [0, 0]]) {
  await teleport(st.page, x, z);
  m = await mem(st.page); peak = Math.max(peak, m.cubes, m.peak);
  seen.add(m.chunks + ':' + m.meshes);
  ok(m.cubes <= BUD && m.meshes <= m.chunks, `at (${x}, ${z}): ${m.cubes.toLocaleString()} cubes live, ${m.chunks} chunks, ${m.tiles} tiles`);
}
ok(peak <= BUD, `peak ${peak.toLocaleString()} cubes never exceeded the ${BUD.toLocaleString()} budget`);
const gl = await st.page.evaluate(() => { const r = window.__loop; return r.state.phase; });
ok(typeof gl === 'string', 'game still responds after moving around');
ok(st.errors.length === 0, 'no page errors while streaming' + (st.errors.length ? ': ' + st.errors[0] : ''));
await st.ctx.close();

// ---- 2. A big map ----
const big = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'), 'utf8'));
big.meta.id = 'big-test'; big.meta.name = 'Big Test'; big.slab = { x0: -160, x1: 160, z0: -170, z1: 150 };
const b = await open();
await b.page.evaluate(() => window.__v2.show('scMaps'));
await b.page.setInputFiles('#mapFile', { name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(big)) });
await b.page.waitForFunction(() => !document.getElementById('scRide').hidden);
await b.page.click('[data-ride="car"]');
await waitBuilt(b.page);
m = await mem(b.page);
ok(m.streaming === true, `a 320 m map streams by itself on the ${m.tier} budget (${m.budget.toLocaleString()} cubes)`);
let bpeak = m.cubes;
for (const [x, z] of [[140, 130], [-140, -150], [100, -100], [-120, 100], [0, 0]]) {
  await teleport(b.page, x, z);
  m = await mem(b.page); bpeak = Math.max(bpeak, m.cubes, m.peak);
  ok(m.cubes <= m.budget && m.chunks > 0, `at (${x}, ${z}): ${m.cubes.toLocaleString()} cubes live, ${m.chunks} chunks`);
}
ok(bpeak <= m.budget, `peak ${bpeak.toLocaleString()} cubes stayed under the budget on the big map`);
ok(b.errors.length === 0, 'no page errors on the big map' + (b.errors.length ? ': ' + b.errors[0] : ''));
await b.ctx.close();

await browser.close(); srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall streaming checks passed');
process.exit(failed ? 1 : 0);
