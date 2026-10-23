// Driving over rocks, pebbles and road cuts (v2.11.1): small rocks and pebbles are bumps a vehicle drives over (some speed lost, never
// stopped); a boulder blocks; a cut in the road slows and wobbles the vehicle in Classic and in New physics alike.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, waitBuilt } from './lib.mjs';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const dist = process.env.DIST || path.join(ROOT, 'dist');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'), 'utf8'));
const { srv, url } = await serve(dist);
const browser = await launch();

async function open(physics, kind, extra) {
  const { page, errors, ctx } = await newPage(browser);
  await ctx.addInitScript(p => { try { localStorage.setItem('hl2.settings.v1', JSON.stringify({ sky: 'classic', physics: p, vox: 25 })); } catch (e) {} }, physics);
  await page.goto(url + 'index.html?parity=1'); await waitBuilt(page);
  const g = await page.evaluate(() => { const W = window.__loop.World, i = W.loopInfo(0, 0); const t = W.trackPoint(0.5, 1.0), a = W.trackPoint(W.loopInfo(t.x, t.z).s + 14, 1.0); return { t, a, s: W.loopInfo(t.x, t.z).s }; });
  const m = JSON.parse(JSON.stringify(base)); m.meta.id = 'rd'; m.meta.name = 'Rock Drive';
  extra(m, g);
  await page.goto(url + 'index.html');
  await page.evaluate(() => window.__v2.show('scMaps'));
  await page.setInputFiles('#mapFile', { name: 'rd.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(m)) });
  await page.waitForFunction(() => !document.getElementById('scRide').hidden);
  await page.click(`[data-ride="${kind}"]`); await waitBuilt(page);
  await page.evaluate(k => window.__loop.start(k), kind); await page.waitForTimeout(500);
  return { page, errors, ctx, g };
}
async function run(page, g, kind0 = 'car') {
  return page.evaluate(([t, a, kind0]) => {
    const L = window.__loop, P = L.P, W = L.World;
    L.state.traffic = false; ['nBike', 'nCar', 'nAuto'].forEach(k => L.A[k].root.position.set(9999, 0, 9999)); L.NPC.forEach(n => { n.s = 9999; });
    L.setKind(kind0); L.NPC.forEach(n => { n.s = 9999; });
    Object.assign(P, { x: t.x, z: t.z, psi: t.psi, v: 0, steer: 0, pitch: 0, roll: 0, jy: 0, jv: 0, wobA: 0, wobT: 9, wobRoll: 0, pot: 0, potMsg: 0, acc: 0 });
    const ctl = { up: true, down: false, left: false, right: false, hb: false };
    const s0 = W.loopInfo(P.x, P.z).s; let minV = 99, wob = 0, prog = 0, last = s0;
    for (let i = 0; i < 360; i++) {
      const info = W.loopInfo(P.x, P.z), ah = W.trackPoint(info.s + 5, 1.0);
      let ang = Math.atan2(-(ah.z - P.z), ah.x - P.x) - P.psi; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
      ctl.left = ang > 0.03; ctl.right = ang < -0.03;
      L.step(1 / 120, ctl);
      if (i > 40) minV = Math.min(minV, P.v);
      wob = Math.max(wob, Math.abs(P.wobA || 0));
      let d = info.s - last; if (d > W.LTOT / 2) d -= W.LTOT; else if (d < -W.LTOT / 2) d += W.LTOT; last = info.s; prog += d;
    }
    return { minV, wob, prog, v: P.v, pot: P.pot, physics: L.physics, rocks: L.rocks, bumpAt: L.rockBump(a.x, a.z), gy: L.gY(a.x, a.z) };
  }, [g.t, g.a, kind0]);
}
const none = () => {};
const pointAhead = (g, d) => { const W = g.a; return W; };
for (const physics of ['new', 'classic']) {
  const kind = 'car';
  const ctl = await open(physics, kind, none); const base0 = await run(ctl.page, ctl.g); await ctl.ctx.close();
  const small = await open(physics, kind, (m, g) => m.scenery.push({ t: 'rock', id: 'k1', x: g.a.x, z: g.a.z + 0.72, r: 0.35, seed: 1 }));
  const rs = await run(small.page, small.g); ok(small.errors.filter(e => !/font/i.test(e)).length === 0, `${physics}: no page errors with a small rock`); await small.ctx.close();
  const peb = await open(physics, kind, (m, g) => m.scenery.push({ t: 'pebbles', id: 'p1', x: g.a.x, z: g.a.z, r: 2, n: 20, seed: 2 }));
  const rp = await run(peb.page, peb.g); await peb.ctx.close();
  const big = await open(physics, kind, (m, g) => m.scenery.push({ t: 'rock', id: 'k2', x: g.a.x, z: g.a.z + 0.3, r: 1.3, seed: 3 }));
  const rb = await run(big.page, big.g); await big.ctx.close();
  const cut = await open(physics, kind, (m, g) => { const cells = []; for (let a = -12; a <= 12; a++) for (let b = -2; b <= 2; b++) cells.push([Math.floor(g.a.x * 4) + b, Math.floor(g.a.z * 4) + a, 40]); m.layers = Object.assign(m.layers || {}, { cuts: { cell: 0.25, cells } }); });
  const rc = await run(cut.page, cut.g); await cut.ctx.close();
  console.log(physics, 'control', JSON.stringify(base0), '\n small', JSON.stringify(rs), '\n pebbles', JSON.stringify(rp), '\n boulder', JSON.stringify(rb), '\n cut', JSON.stringify(rc));
  ok(rs.prog > base0.prog * 0.8 && rs.minV > 2, `${physics}: a small rock is driven over (progress ${rs.prog.toFixed(0)} against ${base0.prog.toFixed(0)} m, slowest ${rs.minV.toFixed(1)} m/s)`);
  ok(rp.prog > base0.prog * 0.9 && rp.minV > base0.minV * 0.85, `${physics}: pebbles hardly slow the car (slowest ${rp.minV.toFixed(1)} against ${base0.minV.toFixed(1)} m/s)`);
  ok(rb.prog < base0.prog * 0.6, `${physics}: a tall boulder blocks the car (progress ${rb.prog.toFixed(0)} against ${base0.prog.toFixed(0)} m)`);
  ok(rc.minV < base0.minV * 0.9 || rc.wob > base0.wob + 0.05, `${physics}: a cut in the road slows or wobbles the car (slowest ${rc.minV.toFixed(1)} against ${base0.minV.toFixed(1)}, wobble ${rc.wob.toFixed(2)})`);
}
await browser.close(); srv.close();
console.log(failed ? `\n${failed} rock/cut driving check(s) failed` : '\nrocks, pebbles and cuts drive as intended');
process.exit(failed ? 1 : 0);
