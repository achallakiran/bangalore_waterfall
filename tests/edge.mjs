// World edge (v2.9.1): hills round the map, a smooth slow-down near the wall, a "turn back" hint, and the wall still holds.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, waitBuilt, frames, PARITY_CSS } from './lib.mjs';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const dist = process.env.DIST || path.join(ROOT, 'dist');
const out = path.join(ROOT, 'tests', 'output', 'edge'); fs.mkdirSync(out, { recursive: true });
const { srv, url } = await serve(dist);
const browser = await launch();
async function open(query, settings) {
  const { page, errors, ctx } = await newPage(browser);
  await ctx.addInitScript(s => { try { localStorage.setItem('hl2.settings.v1', s); } catch (e) {} }, JSON.stringify({ vox: 32, budget: 'medium', ...settings }));
  await page.goto(url + 'index.html' + (query || ''));
  // a copy of Hill Loop without edgeSlow:false, like a map made in the editor (the built-in Hill Loop keeps its old behaviour)
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'), 'utf8'));
  delete m.edgeSlow; m.meta.id = 'edge-test'; m.meta.name = 'Edge Test';
  await page.evaluate(() => window.__v2.show('scMaps'));
  await page.setInputFiles('#mapFile', { name: 'edge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(m)) });
  await page.waitForFunction(() => !document.getElementById('scRide').hidden);
  await page.click('[data-ride="car"]'); await waitBuilt(page);
  return { page, errors, ctx };
}

const a = await open('?stream=1&cubes=30000');
const { page } = a;
const info = await page.evaluate(() => { const l = window.__loop; return { slab: l.World.SLAB, cells: l.edge.cells }; });
ok(info.cells > 200, `hills ring the map: ${info.cells} cubes round a ${Math.round(info.slab.x1 - info.slab.x0)} x ${Math.round(info.slab.z1 - info.slab.z0)} m ground`);

// Drive straight at each of the four walls, in the car and on the bike, at nearly full speed, holding the gas.
const SIDES = [
  { n: 'east', psi: 0, at: s => [s.x1 - 14, (s.z0 + s.z1) / 2] },
  { n: 'west', psi: Math.PI, at: s => [s.x0 + 14, (s.z0 + s.z1) / 2] },
  { n: 'north', psi: -Math.PI / 2, at: s => [(s.x0 + s.x1) / 2, s.z1 - 14] },
  { n: 'south', psi: Math.PI / 2, at: s => [(s.x0 + s.x1) / 2, s.z0 + 14] }
];
for (const kind of ['car', 'bike']) {
  await page.evaluate(k => window.__loop.start(k), kind);
  for (const sd of SIDES) {
    const [x, z] = sd.at(info.slab);
    await page.evaluate(([x, z, psi]) => { const P = window.__loop.P; P.x = x; P.z = z; P.psi = psi; P.v = 0; }, [x, z, sd.psi]);
    await frames(page, 80); await page.waitForTimeout(200);   // let the ground near the edge load
    const r = await page.evaluate(([psi, slab]) => {
      const l = window.__loop, P = l.P, ctl = { up: true, down: false, left: false, right: false, hb: false };
      P.psi = psi; P.v = l.VEH[l.kind].maxF * 0.95;
      let vWall = null, maxOver = 0, peakAt = 0, s0 = P.v;
      for (let i = 0; i < 600; i++) {
        l.step(1 / 60, ctl);
        const over = Math.max(slab.x0 + 1.2 - P.x, P.x - (slab.x1 - 1.2), slab.z0 + 1.2 - P.z, P.z - (slab.z1 - 1.2));
        maxOver = Math.max(maxOver, over);
        if (vWall === null && over > -0.3) vWall = Math.abs(P.v);
      }
      return { vWall, maxOver, vEnd: P.v, s0 };
    }, [sd.psi, info.slab]);
    ok(r.maxOver < 0.05, `${kind} ${sd.n}: never crosses the wall (max overshoot ${r.maxOver.toFixed(2)} m)`);
    ok(r.vWall === null || r.vWall < 4.5, `${kind} ${sd.n}: arrives at the wall slowly (${r.vWall === null ? 'never touched it' : r.vWall.toFixed(1) + ' m/s from ' + r.s0.toFixed(1)})`);
  }
}

// Driving away from the edge is not slowed, and turning in the zone does not trap the player.
await page.evaluate(k => window.__loop.start(k), 'car');
const [bx, bz] = SIDES[0].at(info.slab);
await page.evaluate(([x, z]) => { const P = window.__loop.P; P.x = x + 11; P.z = z; P.psi = Math.PI; P.v = 0; }, [bx, bz]);
await frames(page, 60);
const away = await page.evaluate(() => {
  const l = window.__loop, P = l.P; P.psi = Math.PI; P.v = 10;
  const ctl = { up: false, down: false, left: false, right: false, hb: false };
  const e = l.edge.probe(P.x, P.z, Math.cos(P.psi) * P.v, -Math.sin(P.psi) * P.v);
  return { f: e.f, away: e.away };
});
ok(away.f > 0.4 && away.away === 0, `heading away from the edge inside the zone: zone ${away.f.toFixed(2)}, slow-down ${away.away}`);

// The hint shows when heading at the edge and goes away when turning back
await page.evaluate(([x, z]) => { const P = window.__loop.P; P.x = x + 6; P.z = z; P.psi = 0; P.v = 9; }, [bx, bz]);
await frames(page, 4);
const shown = await page.evaluate(() => !document.getElementById('edgewarn').hidden);
ok(shown, 'the "Edge of the map" hint shows when heading at the edge');
await page.evaluate(() => { const P = window.__loop.P; P.psi = Math.PI; P.v = 9; });
await frames(page, 4);
ok(await page.evaluate(() => document.getElementById('edgewarn').hidden), 'the hint goes away after turning back');

// A picture from the edge, looking outward, and the Classic switch
await page.addStyleTag({ content: PARITY_CSS });
await page.evaluate(([x, z]) => { const P = window.__loop.P; P.x = x + 10; P.z = z; P.psi = 0; P.v = 0; }, [bx, bz]);
await frames(page, 150);
await page.screenshot({ path: path.join(out, 'east-edge.png'), clip: { x: 0, y: 0, width: 900, height: 560 }, timeout: 120000 });
ok(a.errors.length === 0, 'no page errors' + (a.errors.length ? ': ' + a.errors[0] : ''));
await a.ctx.close();

const c = await open('?stream=1&cubes=30000', { sky: 'classic' });
await c.page.evaluate(() => window.__loop.start('car')); await frames(c.page, 60);
ok(await c.page.evaluate(() => window.__loop.edge.cells > 0 && !window.__loop.skyOn), 'Classic hides the hills with the sky');
await c.ctx.close();

// The built-in Hill Loop (edgeSlow: false) is not slowed near its edge, exactly as before
const h = await (async () => { const { page, errors, ctx } = await newPage(browser);
  await ctx.addInitScript(s => { try { localStorage.setItem('hl2.settings.v1', s); } catch (e) {} }, JSON.stringify({ vox: 32, budget: 'medium' }));
  await page.goto(url + 'index.html'); await page.evaluate(() => window.__v2.show('scRide')); await page.click('[data-ride="car"]'); await waitBuilt(page);
  return { page, ctx }; })();
const v0 = await h.page.evaluate(() => { const l = window.__loop, P = l.P, S = l.World.SLAB; l.start('car'); P.x = S.x1 - 10; P.z = (S.z0 + S.z1) / 2; P.psi = 0; P.v = 12; P.by = null;
  const ctl = { up: false, down: false, left: false, right: false, hb: false }; const v1 = P.v; l.step(1 / 60, ctl); return { v1, v2: P.v }; });
ok(v0.v2 > v0.v1 - 0.5, `the built-in Hill Loop is not slowed near its edge (${v0.v1.toFixed(1)} to ${v0.v2.toFixed(1)} m/s in one step)`);
await h.ctx.close();

await browser.close(); srv.close();
console.log(failed ? failed + ' check(s) failed' : 'all edge checks passed');
process.exit(failed ? 1 : 0);
