// Falling off edges (v2.9.2): a vehicle that drives off a cliff or ledge leaves the ground, falls, lands with a jolt, and a very
// long fall puts it back on the last road. Ordinary driving never triggers it, and Settings > Cliff falls > Off restores the old behaviour.
// The cliffs are made by raising a block of the built ground in the page, so no map file is needed.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, waitBuilt, frames, PARITY_CSS } from './lib.mjs';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const dist = process.env.DIST || path.join(ROOT, 'dist');
const out = path.join(ROOT, 'tests', 'output', 'fall-new'); fs.mkdirSync(out, { recursive: true });
const { srv, url } = await serve(dist);
const browser = await launch();
async function open(settings) {
  const { page, errors, ctx } = await newPage(browser);
  await ctx.addInitScript(s => { try { localStorage.setItem('hl2.settings.v1', s); } catch (e) {} }, JSON.stringify({ vox: 32, budget: 'medium', physics: 'new', ...settings }));
  await page.goto(url + 'index.html');
  // a 320 m map (open land round the Hill Loop) gives room for cliffs; it streams its ground
  const big = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'), 'utf8'));
  big.meta.id = 'fall-test'; big.meta.name = 'Fall Test'; big.slab = { x0: -160, x1: 160, z0: -170, z1: 150 };
  await page.evaluate(() => window.__v2.show('scMaps'));
  await page.setInputFiles('#mapFile', { name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(big)) });
  await page.waitForFunction(() => !document.getElementById('scRide').hidden);
  await page.click('[data-ride="car"]'); await waitBuilt(page);
  return { page, errors, ctx };
}
let nth = 0;
async function drop(page, h, v, kind) {
  const sz = -140 + 22 * (nth++);     // a fresh strip of land each time
  await page.evaluate(k => window.__loop.start(k), kind);
  await page.evaluate(([x, z]) => { const P = window.__loop.P; P.x = x; P.z = z; P.v = 0; }, [-110, sz]);
  await frames(page, 90); await page.waitForTimeout(300);
  return page.evaluate(`${DROP}(${h}, ${v}, '${kind}', -110, ${sz})`);
}

// Raise a block of the ground by hMetres and drive a vehicle at speed v off its east edge. Returns what happened.
const DROP = `(function (hM, v, kind, sx, sz) {
  const l = window.__loop, P = l.P, HF = l.HF, World = l.World;
  const cells = Math.round(hM / HF.v), r = kind === 'car' ? 1.2 : 0.8, spot = { x: sx, z: sz };
  for (let d = -14; d <= 34; d += 1.5) for (let dz = -6; dz <= 6; dz += 3) { const o = l.pushOut(sx + d, sz + dz, r + 1); if (o[0] || o[1]) return { err: 'not clear at ' + (sx + d) + ',' + (sz + dz) }; }
  const xe = spot.x + 14;                                        // east edge of the block
  const inBlock = (x, z) => x > spot.x - 20 && x < xe && z > spot.z - 14 && z < spot.z + 14;
  if (HF.stream) {
    HF.loaded.forEach(e => { const rows = e.top.length / e.wI; for (let kk = 0; kk < rows; kk++) for (let ii = 0; ii < e.wI; ii++) {
      if (inBlock(HF.x0 + (e.I0 + ii + 0.5) * HF.v, HF.z0 + (e.K0 + kk + 0.5) * HF.v)) e.top[ii + e.wI * kk] += cells; } });
  } else {
    for (let k = 0; k < HF.nz; k++) for (let i = 0; i < HF.nx; i++) if (inBlock(HF.x0 + (i + 0.5) * HF.v, HF.z0 + (k + 0.5) * HF.v)) HF.top[i + HF.nx * k] += cells;
  }
  P.safe.x = World.map.start.x; P.safe.z = World.map.start.z; P.safe.psi = World.map.start.psi;
  P.x = v < 2 ? xe - 3 : spot.x - 6; P.z = spot.z; P.psi = 0; P.v = 0; P.air = false; P.by = null;
  const idle = { up: false, down: false, left: false, right: false, hb: false };
  for (let i = 0; i < 4; i++) l.step(1 / 60, idle);
  P.v = v; P.vyG = 0;
  const ctl = { up: true, down: false, left: false, right: false, hb: false };
  let airT = 0, firstAir = -1, landed = false, impact = 0, maxJy = 0, crashed = false, yMin = 1e9, pitchMin = 0;
  const xe0 = xe, trace = [];
  for (let i = 0; i < (v < 2 ? 2500 : 1500); i++) {
    if (v < 2 && !P.air) P.v = v;   // crawl: hold the speed
    const was = P.air, vy0 = P.vy;
    l.step(1 / 120, ctl);
    if (P.air) { airT += 1 / 120; if (firstAir < 0) firstAir = P.x - xe0; pitchMin = Math.min(pitchMin, P.pitch); }
    if (was && !P.air) { landed = true; impact = -vy0; }
    maxJy = Math.max(maxJy, P.gy - P.by);
    if (i % 15 === 0) trace.push([+(P.x - xe0).toFixed(2), +P.v.toFixed(2), +P.by.toFixed(2), +P.gy.toFixed(2), P.air ? 1 : 0, +P.vy.toFixed(1)]);
    yMin = Math.min(yMin, P.by);
    if (P.fallMsg > 0) { crashed = true; break; }
    if (landed && i > 0 && !P.air && airT > 0 && P.vy === 0 && (P.x - xe0) > 12) break;
  }
  return { trace, spot, airT, firstAir, landed, impact, maxJy, crashed, yEnd: P.by, gEnd: l.gY(P.x, P.z), pitchMin, back: Math.hypot(P.x - P.safe.x, P.z - P.safe.z), x: P.x, vEnd: P.v };
})`;

const a = await open({});
const { page } = a;
const r6 = await drop(page, 6, 12, 'car');
console.log(JSON.stringify(r6));
if (process.env.FALL_ONE) { await browser.close(); srv.close(); process.exit(0); }
ok(!r6.err, 'a clear run was found for the test cliffs');
ok(r6.airT > 0.25 && r6.airT < 1.6, `car off a 6 m cliff at 12 m/s leaves the ground and is airborne ${r6.airT && r6.airT.toFixed(2)} s`);
ok(r6.firstAir > -0.5 && r6.firstAir < 2.5, `it leaves the ground at the edge of the cliff (${r6.firstAir && r6.firstAir.toFixed(2)} m past the edge)`);
ok(r6.landed && Math.abs(r6.yEnd - r6.gEnd) < 0.1, 'it lands back on the lower ground, no longer in the air');
ok(r6.impact > 9 && r6.impact < 22, `landing speed ${r6.impact && r6.impact.toFixed(1)} m/s (a hard landing but not a crash)`);
ok(r6.maxJy > 0.02, `the landing jolts the suspension (${r6.maxJy && r6.maxJy.toFixed(2)})`);
ok(r6.pitchMin < -0.15, `the nose drops in the air (pitch ${r6.pitchMin && r6.pitchMin.toFixed(2)})`);

const rb = await drop(page, 6, 15, 'bike');
ok(rb.landed && rb.airT > 0.4, `bike off a 6 m cliff falls and lands (${rb.airT && rb.airT.toFixed(2)} s in the air)`);

const r1 = await drop(page, 1.2, 3, 'car');
console.log("r1", JSON.stringify({ ...r1, trace: undefined }));
ok(r1.yEnd !== undefined && Math.abs(r1.yEnd - r1.gEnd) < 0.15 && r1.x > r1.spot.x + 17, `car creeping off a 1.2 m ledge at 3 m/s drops and lands (${r1.airT && r1.airT.toFixed(2)} s)`);

const rc = await drop(page, 20, 12, 'car');
ok(rc.crashed && rc.back < 1.5, `a 20 m fall counts as a crash and puts the car back on the road (${rc.back && rc.back.toFixed(1)} m from the last road point)`);
const rcreep = await drop(page, 6, 0.8, 'car');
ok(rcreep.landed && rcreep.airT > 0.3, `car crawling off a 6 m cliff at 0.8 m/s (3 km/h) still leaves the wall and falls (${rcreep.airT && rcreep.airT.toFixed(2)} s in the air)`);
await page.screenshot({ path: path.join(out, 'after-crash.png'), clip: { x: 0, y: 0, width: 900, height: 560 }, timeout: 120000 });

// Small things never trigger a fall: drive the real game (road, curbs, hills, potholes) with the gas held, watching for any air time.
await page.evaluate(() => { window.__air = 0; window.__loop.start('car'); setInterval(() => { if (window.__loop.P.air) window.__air++; }, 16); });
await page.keyboard.down('ArrowUp');
await frames(page, 240);
await page.keyboard.up('ArrowUp');
const air = await page.evaluate(() => ({ n: window.__air, v: window.__loop.P.v, x: window.__loop.P.x }));
ok(air.n === 0, `driving the road with the gas held never leaves the ground (${air.n} airborne samples, reached ${air.v.toFixed(1)} m/s)`);
ok(a.errors.length === 0, 'no page errors' + (a.errors.length ? ': ' + a.errors[0] : ''));
await a.ctx.close();

await browser.close(); srv.close();
console.log(failed ? failed + ' check(s) failed' : 'all fall checks passed');
process.exit(failed ? 1 : 0);
