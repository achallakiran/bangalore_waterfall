// Physics: New against Physics: Classic on ordinary driving of Hill Loop. Both modes follow the same autopilot round the road for
// 45 seconds (car and bike); New must feel like Classic where nothing unusual happens: similar distance and top speed, no air time on
// the road, similar pitch, and the same potholes met. Margins are set here, in one place.
import path from 'node:path';
import { ROOT, launch, newPage, serve, waitBuilt } from './lib.mjs';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const dist = process.env.DIST || path.join(ROOT, 'dist');
const { srv, url } = await serve(dist);
const browser = await launch();

const M = { distance: 0.08, topSpeed: 0.08, pitch: 0.06, airSeconds: 0.3, potholes: 2 };

async function run(physics) {
  const { page, errors, ctx } = await newPage(browser);
  await ctx.addInitScript(p => { try { localStorage.setItem('hl2.settings.v1', JSON.stringify({ sky: 'classic', physics: p })); } catch (e) {} }, physics);
  await page.goto(url + 'index.html?parity=1');
  await waitBuilt(page);
  const res = await page.evaluate(() => {
    const L = window.__loop, W = L.World, out = {};
    let seed = 99;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    L.state.traffic = false;
    ['nBike', 'nCar', 'nAuto'].forEach(k => L.A[k].root.position.set(9999, 0, 9999));
    L.NPC.forEach(n => { n.s = 9999; });
    for (const kind of ['car', 'bike']) {
      L.setKind(kind);
      L.NPC.forEach(n => { n.s = 9999; });
      const tp = W.trackPoint(0.5, 1.0);
      Object.assign(L.P, { x: tp.x, z: tp.z, psi: tp.psi, v: 0, steer: 0, pitch: 0, roll: 0, jy: 0, jv: 0, wobA: 0, wobT: 9, wobRoll: 0, pot: 0, potMsg: 0, acc: 0 });
      const ctl = { up: true, down: false, left: false, right: false, hb: false };
      const events = []; let wasAir = false;
      let top = 0, air = 0, pitchSum = 0, n = 0, prog = 0, last = W.loopInfo(L.P.x, L.P.z).s, maxJump = 0;
      for (let i = 0; i < 45 * 120; i++) {
        const info = W.loopInfo(L.P.x, L.P.z), ah = W.trackPoint(info.s + 6, 1.0);
        let ang = Math.atan2(-(ah.z - L.P.z), ah.x - L.P.x) - L.P.psi; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
        ctl.left = ang > 0.03; ctl.right = ang < -0.03;
        L.step(1 / 120, ctl);
        top = Math.max(top, L.P.v);
        if (L.P.air) air += 1 / 120;
        if (L.P.air && !wasAir && events.length < 4) events.push({ t: +(i / 120).toFixed(2), s: +info.s.toFixed(1), u: +info.u.toFixed(2), v: +L.P.v.toFixed(1), by: +L.P.by.toFixed(2), gy: +L.P.gy.toFixed(2), vy: +L.P.vy.toFixed(1), pitch: +L.P.pitch.toFixed(2) });
        wasAir = L.P.air;
        pitchSum += Math.abs(L.P.pitch); n++;
        let d = info.s - last; if (d > W.LTOT / 2) d -= W.LTOT; else if (d < -W.LTOT / 2) d += W.LTOT; last = info.s; prog += d;
        const jump = Math.abs((L.P.by !== null && L.P.by !== undefined ? L.P.by : L.P.y) - L.gY(L.P.x, L.P.z));
        maxJump = Math.max(maxJump, jump);
      }
      out[kind] = { distance: prog, top, air, pitch: pitchSum / n, pot: L.P.pot, maxJump, events };
    }
    return out;
  });
  const real = errors.filter(e => !/font/i.test(e));
  await ctx.close();
  return { res, errors: real };
}

const classic = await run('classic'), fresh = await run('new');
for (const kind of ['car', 'bike']) {
  const c = classic.res[kind], n = fresh.res[kind];
  console.log(kind, 'classic', JSON.stringify(c), '\n', kind, 'new    ', JSON.stringify(n));
  ok(Math.abs(n.distance - c.distance) <= M.distance * c.distance, `${kind}: distance in 45 s ${n.distance.toFixed(0)} m against ${c.distance.toFixed(0)} m (margin ${M.distance * 100}%)`);
  ok(Math.abs(n.top - c.top) <= M.topSpeed * c.top, `${kind}: top speed ${n.top.toFixed(1)} against ${c.top.toFixed(1)} m/s (margin ${M.topSpeed * 100}%)`);
  ok(Math.abs(n.pitch - c.pitch) <= M.pitch, `${kind}: average pitch ${n.pitch.toFixed(3)} against ${c.pitch.toFixed(3)} rad (margin ${M.pitch})`);
  ok(n.air <= M.airSeconds, `${kind}: airborne ${n.air.toFixed(2)} s in 45 s on the road (limit ${M.airSeconds} s)`);
  ok(Math.abs(n.pot - c.pot) <= M.potholes, `${kind}: potholes met ${n.pot} against ${c.pot}`);
}
ok(classic.errors.length === 0 && fresh.errors.length === 0, 'no page errors' + [...classic.errors, ...fresh.errors].slice(0, 1).join(''));
await browser.close(); srv.close();
console.log(failed ? `\n${failed} physics comparison check(s) failed` : '\nNew physics matches Classic on ordinary driving');
process.exit(failed ? 1 : 0);
