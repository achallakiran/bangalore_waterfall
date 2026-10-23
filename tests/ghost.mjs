// Ghost and invisible buildings (v2.12.0): while driving fast through a street of buildings in streaming mode, every building near the
// vehicle must already be built (drawn). Counts, each frame, building solids within 30 m whose model tile is not built yet.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, waitBuilt } from './lib.mjs';
import * as ED from '../src/editor/model.js';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const dist = process.env.DIST || path.join(ROOT, 'dist');
// the editor accepts well over the old 64 buildings
{
  const big = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'), 'utf8'));
  big.slab = { x0: -400, x1: 400, z0: -400, z1: 400 };
  let placed = 0; for (let i = 0; i < 150; i++) { const r = ED.addBuildingY(big, { cx: -380 + (i % 25) * 30, cz: -380 + Math.floor(i / 25) * 30, w: 8, depth: 7, h: 6, yaw: 0 }); if (typeof r === 'string' && r[0] === '!') break; placed++; }
  ok(placed === 150, `the editor now places ${placed} buildings (was limited to 64)`);
  const v = ED.checkMap(JSON.parse(JSON.stringify(big)));
  ok(!(v.errors && v.errors.length) && v.ok !== false, 'a map with 150 buildings validates');
}
const { srv, url } = await serve(dist);
const browser = await launch();
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'), 'utf8'));
map.meta.id = 'ghost'; map.meta.name = 'Ghost Test'; map.slab = { x0: -160, x1: 160, z0: -170, z1: 150 };
// a street of buildings either side of a line along z = -100, x from -150 to 150 (about 28 of them each side)
let n = 0;
for (let x = -145; x <= 145; x += 11) for (const z of [-118, -82]) { const r = ED.addBuildingY(map, { cx: x, cz: z, w: 8 + (n % 3), depth: 7, h: 6 + (n % 5) * 2, yaw: (n % 4) * 7 }); if (typeof r === 'string' && r[0] === '!') break; n++; }
console.log('buildings placed', n);
const { page, errors, ctx } = await newPage(browser);
await ctx.addInitScript(() => { try { localStorage.setItem('hl2.settings.v1', JSON.stringify({ sky: 'classic', physics: 'new', vox: 32, budget: 'low' })); } catch (e) {} });
await page.goto(url + 'index.html');
await page.evaluate(() => window.__v2.show('scMaps'));
await page.setInputFiles('#mapFile', { name: 'g.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(map)) });
await page.waitForFunction(() => !document.getElementById('scRide').hidden);
await page.click('[data-ride="car"]'); await waitBuilt(page);
await page.evaluate(() => window.__loop.start('car')); await page.waitForTimeout(800);
const res = await page.evaluate(async () => {
  const L = window.__loop, P = L.P; L.state.traffic = false;
  P.x = -150; P.z = -100; P.psi = 0; P.v = 0;
  for (let k = 0; k < 40; k++) L.streamTick();   // as the game does on a teleport or start
  const first = L.unbuiltNear(22);
  let worst = 0, sum = 0, frames = 0, worstAt = 0;
  for (let i = 0; i < 700; i++) {
    P.x += 25 / 60; P.z = -100; P.v = 25;     // 90 km/h along the street between the rows, no collisions
    L.streamTick();
    const u = L.unbuiltNear(22); frames++; sum += u.unbuilt;
    if (u.unbuilt > worst) { worst = u.unbuilt; worstAt = P.x; }
  }
  return { first, worst, avg: sum / frames, worstAt, end: L.unbuiltNear(22) };
});
console.log(JSON.stringify(res));
ok(res.first.streaming, 'the test map streams (low budget)');
ok(res.worst <= 1 && res.avg < 0.05, `buildings within 22 m of the vehicle are built (at most ${res.worst} unbuilt for a moment at x=${res.worstAt && res.worstAt.toFixed(0)}, average ${res.avg.toFixed(3)}; before the fix the average was about 2)`);
ok(res.end.tileCubes <= res.end.tileBudget * 2.2, `scenery memory stays near its budget (${res.end.tileCubes} cubes live, budget ${res.end.tileBudget})`);
ok(errors.filter(e => !/font/i.test(e)).length === 0, 'no page errors');
await browser.close(); srv.close();
console.log(failed ? `\n${failed} ghost-building check(s) failed` : '\nno ghost buildings');
process.exit(failed ? 1 : 0);
