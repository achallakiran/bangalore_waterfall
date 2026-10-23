// Road cuts (v2.11.0): holes cut into the road are really removed blocks, a wheel drops into them under Physics: New, Classic still sees
// them as lowered ground, and rocks are solid while pebbles are not. Uses Hill Loop with cuts and rocks added in the page's map file.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, waitBuilt, frames } from './lib.mjs';
import { validateMap } from '../src/maps/format.js';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const dist = process.env.DIST || path.join(ROOT, 'dist');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'), 'utf8'));
ok(validateMap(JSON.parse(JSON.stringify(base))).ok !== false, 'Hill Loop still validates');
const bad = JSON.parse(JSON.stringify(base)); bad.layers = { cuts: { cell: 0.25, cells: [[0, 0, 500]] } };
const vb = validateMap(bad); ok(vb.ok === false || (vb.errors && vb.errors.length), 'a cut deeper than 100 cm is refused');
const badR = JSON.parse(JSON.stringify(base)); badR.scenery.push({ t: 'rock', id: 'k1', x: 0, z: 0, r: 99 });
const vr = validateMap(badR); ok(vr.ok === false || (vr.errors && vr.errors.length), 'a rock of radius 99 m is refused');

const { srv, url } = await serve(dist);
const browser = await launch();
for (const physics of ['new', 'classic']) {
  const { page, errors, ctx } = await newPage(browser);
  await ctx.addInitScript(p => { try { localStorage.setItem('hl2.settings.v1', JSON.stringify({ sky: 'classic', physics: p })); } catch (e) {} }, physics);
  await page.goto(url + 'index.html?parity=1');
  await waitBuilt(page);
  const r = await page.evaluate(() => {
    const L = window.__loop, W = L.World, out = {};
    const tp = W.trackPoint(0.5, 1.0);
    out.hasCutAt = typeof W.cutAt === 'function';
    out.noCut = W.cutAt(tp.x, tp.z);
    return out;
  });
  ok(r.hasCutAt && r.noCut === 0, `${physics}: an uncut road reports no cut`);
  ok(errors.filter(e => !/font/i.test(e)).length === 0, `${physics}: no page errors`);
  await ctx.close();
}
// Now the real thing: a map with a cut across the road and a rock beside it, loaded like any other map file.
{
  const { page, errors, ctx } = await newPage(browser);
  await ctx.addInitScript(() => { try { localStorage.setItem('hl2.settings.v1', JSON.stringify({ sky: 'classic', physics: 'new' })); } catch (e) {} });
  await page.goto(url + 'index.html?parity=1');
  await waitBuilt(page);
  const probe = await page.evaluate(() => { const W = window.__loop.World, t = W.trackPoint(0.5, 1.0); return { x: t.x, z: t.z, psi: t.psi }; });
  await page.goto(url + 'index.html');
  const m = JSON.parse(JSON.stringify(base)); m.meta.id = 'cut-test'; m.meta.name = 'Cut Test';
  // a trench 0.75 m wide (3 cells) and 6 m long across the road, 30 cm deep, 10 m ahead of the probe point along the road
  const cells = [];
  for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) cells.push([Math.floor(probe.x * 4) + a, Math.floor(probe.z * 4) + b, 30]);
  m.layers = Object.assign(m.layers || {}, { cuts: { cell: 0.25, cells } });
  m.scenery.push({ t: 'rock', id: 'k1', x: probe.x + 20, z: probe.z + 14, r: 0.8, seed: 3 }, { t: 'pebbles', id: 'p1', x: probe.x + 22, z: probe.z + 14, r: 1.5, n: 10, seed: 4 });
  const v = validateMap(JSON.parse(JSON.stringify(m)));
  ok(v.ok !== false && !(v.errors && v.errors.length), 'the test map with cuts, a rock and pebbles validates ' + (v.errors || []).slice(0, 2).join(';'));
  await page.evaluate(() => window.__v2.show('scMaps'));
  await page.setInputFiles('#mapFile', { name: 'cut.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(m)) });
  await page.waitForFunction(() => !document.getElementById('scRide').hidden);
  await page.click('[data-ride="car"]'); await waitBuilt(page);
  const g = await page.evaluate(([x, z]) => {
    const L = window.__loop, W = L.World;
    let cut = 0, deep = 0;
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const c = W.cutAt(x + a * 0.25, z + b * 0.25); if (c > 0) cut++; }
    return { cut, nSolids: L.SOLIDS.length, circles: L.SOLIDS.filter(q => q.t === 'c' && Math.hypot(q.x - (x + 20), q.z - (z + 14)) < 1).length, P: [L.P.x, L.P.z], around: W.cutAt(x, z), rockSolid: (q => Math.hypot(q[0], q[1]) > 0.01)(L.pushOut(x + 20.3, z + 14, 0.5)), pebbleSolid: (q => Math.hypot(q[0], q[1]) > 0.01)(L.pushOut(x + 22, z + 14, 0.3)) };
  }, [probe.x, probe.z]);
  console.log(JSON.stringify(g));
  ok(g.cut > 20 && g.around >= 25, `the cut is in the built map (${g.cut} cells near the probe, depth ${g.around} cm)`);
  ok(g.rockSolid && !g.pebbleSolid, `the rock blocks a car (${g.rockSolid}) but pebbles do not (${g.pebbleSolid})`);
  ok(errors.filter(e => !/font/i.test(e)).length === 0, 'no page errors with cuts, rock and pebbles ' + errors.slice(0, 1).join(''));
  await ctx.close();
}
await browser.close(); srv.close();
console.log(failed ? `\n${failed} cut check(s) failed` : '\nroad cuts, rocks and pebbles OK');
process.exit(failed ? 1 : 0);
