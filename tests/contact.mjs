// Unit tests for the wheel-contact model: pure maths, no browser. Run: node tests/contact.mjs
import { createContact, effectiveHeight } from '../src/game/hill-loop/contact.js';

let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };

const CAR = { g: 20, wheels: [[1.2, -0.72], [1.2, 0.72], [-1.2, -0.72], [-1.2, 0.72]], R: 0.35, stat: 0.11, zeta: 0.55, droop: 0.15, stop: 0.3, rgP: 1.1, rgR: 0.6, pitchLimit: 0.7, rollLimit: 0.5 };
const BIKE = { g: 20, wheels: [[0.8, 0], [-0.8, 0]], R: 0.33, stat: 0.1, zeta: 0.5, droop: 0.15, stop: 0.28, rgP: 0.7, rgR: 0.4, pitchLimit: 0.8, rollLimit: 0.5 };

const ramp = (x, a, b, h) => h * Math.min(1, Math.max(0, (x - a) / (b - a)));   // like the game's ground: a step is a 0.2 m ramp

// Drive a vehicle along +x over a ground function g(x, z) at speed v for T seconds. Returns what happened.
function drive(cfg, g, x0, v, T, opts = {}) {
  const c = createContact(cfg), W = cfg.wheels, n = W.length, dt = opts.dt || 1 / 120;
  const eff = (X, i) => effectiveHeight(g, X + W[i][0], W[i][1], 1, 0, cfg.R);
  const cOld = new Float64Array(n), cNew = new Float64Array(n);
  let X = x0;
  for (let i = 0; i < n; i++) cOld[i] = eff(X, i);
  c.reset(opts.y0 !== undefined ? opts.y0 : (cOld.reduce((a, b) => a + b, 0) / n), opts.pitch0 || 0, 0);
  const r = { maxY: -1e9, minY: 1e9, air: 0, firstAir: -1, landed: 0, pitchMin: 0, pitchMax: 0, maxF: 0, nan: false, trace: [], t: 0 };
  for (let k = 0; k < Math.round(T / dt); k++) {
    X += v * dt;
    for (let i = 0; i < n; i++) cNew[i] = eff(X, i);
    c.step(dt, cOld, cNew);
    for (let i = 0; i < n; i++) cOld[i] = cNew[i];
    r.t += dt;
    if (!isFinite(c.y) || !isFinite(c.pitch)) r.nan = true;
    r.maxY = Math.max(r.maxY, c.y); r.minY = Math.min(r.minY, c.y);
    r.pitchMin = Math.min(r.pitchMin, c.pitch); r.pitchMax = Math.max(r.pitchMax, c.pitch);
    if (c.airborne) { r.air += dt; if (r.firstAir < 0) r.firstAir = X; }
    if (c.landed) r.landed = Math.max(r.landed, c.landed);
    r.maxF = Math.max(r.maxF, c.load());
    if (k % 12 === 0) r.trace.push([+X.toFixed(2), +c.y.toFixed(3), +c.pitch.toFixed(3), c.airborne ? 1 : 0]);
  }
  r.y = c.y; r.pitch = c.pitch; r.roll = c.roll; r.X = X;
  return r;
}

// 1. Flat ground: dropped 0.3 m above the ground it settles to the ground height and sits level.
{
  const r = drive(CAR, () => 0, 0, 0, 3, { y0: 0.3 });
  ok(!r.nan && Math.abs(r.y) < 0.003 && Math.abs(r.pitch) < 0.003, `car dropped 0.3 m settles on flat ground (y ${r.y.toFixed(4)}, pitch ${r.pitch.toFixed(4)})`);
  ok(r.minY > -0.15, `it does not sink more than the bump stop allows (lowest ${r.minY.toFixed(3)} m)`);
}
// 2. A slope: the body takes the slope's angle.
{
  const r = drive(CAR, x => 0.2 * x, 0, 4, 3);
  ok(Math.abs(r.pitch - Math.atan(0.2)) < 0.03 && r.air === 0, `car on a 20% slope pitches to ${r.pitch.toFixed(3)} rad (slope ${Math.atan(0.2).toFixed(3)}), never airborne`);
  const rb = drive(BIKE, x => 0.2 * x, 0, 4, 3);
  ok(Math.abs(rb.pitch - Math.atan(0.2)) < 0.03 && rb.air === 0, `bike on a 20% slope pitches to ${rb.pitch.toFixed(3)} rad, never airborne`);
}
// 3. A low step up (curb): rides over it, a bump that grows with speed, no air.
{
  const step = x => ramp(x, 10, 10.2, 0.15);
  const slow = drive(CAR, step, 0, 3, 6), fast = drive(CAR, step, 0, 12, 3);
  ok(!slow.nan && slow.air === 0 && Math.abs(slow.y - 0.15) < 0.01, `car climbs a 15 cm curb at 3 m/s and ends on top (y ${slow.y.toFixed(3)})`);
  ok(fast.maxF > slow.maxF, `the same curb hits harder at 12 m/s (peak wheel load ${fast.maxF.toFixed(1)}) than at 3 m/s (${slow.maxF.toFixed(1)})`);
}
// 4. A pit 0.2 m deep and 1.4 m wide: the wheels drop in and climb out, the body dips a little, and a faster car feels more of it.
{
  const pit = x => ramp(x, 10, 10.2, -0.2) + ramp(x, 11.2, 11.4, 0.2);
  const slow = drive(CAR, pit, 0, 3, 6), fast = drive(CAR, pit, 0, 10, 3);
  ok(!fast.nan && fast.minY < -0.01 && fast.minY > -0.2, `car through a 20 cm pit at 10 m/s dips ${(-fast.minY * 100).toFixed(1)} cm and recovers (end y ${fast.y.toFixed(3)})`);
  ok(fast.maxF > slow.maxF * 1.2, `the pit is a harder hit at 10 m/s (peak load ${fast.maxF.toFixed(1)}) than at 3 m/s (${slow.maxF.toFixed(1)})`);
  const bike = drive(BIKE, pit, 0, 10, 3);
  ok(!bike.nan && bike.minY > -0.25, `bike through the pit stays controlled (dip ${(-bike.minY * 100).toFixed(1)} cm)`);
}
// 5. A strip across the road 0.4 m wide and 0.15 m deep: a sharp hit.
{
  const strip = x => ramp(x, 10, 10.2, -0.15) + ramp(x, 10.2, 10.4, 0.15);
  const r = drive(CAR, strip, 0, 12, 3);
  ok(!r.nan && r.air < 0.2, `car over a narrow 15 cm trench at 12 m/s is jolted but not thrown (air ${r.air.toFixed(2)} s)`);
}
// 6. A cliff, 6 m: a fast car and a crawling one both leave the ground and land.
const cliff = x => 6 - ramp(x, 10, 10.2, 6);
{
  const r = drive(CAR, cliff, 0, 12, 4);
  ok(r.air > 0.4 && r.landed > 6 && r.landed < 18, `car off a 6 m cliff at 12 m/s: airborne ${r.air.toFixed(2)} s, lands at ${r.landed.toFixed(1)} m/s`);
  const rb = drive(BIKE, cliff, 0, 12, 4);
  ok(rb.air > 0.4 && rb.landed > 6, `bike off a 6 m cliff at 12 m/s: airborne ${rb.air.toFixed(2)} s, lands at ${rb.landed.toFixed(1)} m/s`);
  const crawl = drive(CAR, cliff, 6, 0.8, 14);
  ok(crawl.air > 0.4 && crawl.landed > 6, `car crawling off the cliff at 0.8 m/s leaves the face: airborne ${crawl.air.toFixed(2)} s, nose-down to ${crawl.pitchMin.toFixed(2)} rad on the lip`);
  const crawlB = drive(BIKE, cliff, 7, 0.8, 14);
  ok(crawlB.air > 0.4 && crawlB.landed > 6, `bike crawling off the cliff at 0.8 m/s leaves the face: airborne ${crawlB.air.toFixed(2)} s`);
}
// 7. A small drop (a 1 m ledge) lands softly, the car is back on its wheels and level.
{
  const r = drive(CAR, x => 1 - ramp(x, 10, 10.2, 1), 4, 6, 4);
  ok(r.landed > 2 && r.landed < 8 && Math.abs(r.pitch) < 0.01 && Math.abs(r.y) < 0.005, `car off a 1 m ledge lands at ${r.landed.toFixed(1)} m/s and ends level on the ground (y ${r.y.toFixed(3)})`);
}
// 8. Ordinary rolling ground (small hills) never launches the car.
{
  const hills = x => 0.5 * Math.sin(x * 0.12) + 0.2 * Math.sin(x * 0.31);
  const r = drive(CAR, hills, 0, 15, 20);
  ok(!r.nan && r.air < 0.3, `a car at 15 m/s over rolling ground is airborne only ${r.air.toFixed(2)} s in 20 s`);
}
// 9. The rolling wheel takes a lip smoothly: the effective height is between the two levels.
{
  const g = x => (x < 0 ? 1 : 0);
  const e = effectiveHeight(g, 0.1, 0, 1, 0, 0.35);
  ok(e > 0 && e < 1, `a wheel just past a 1 m lip is on the arc, not on the floor (effective ${e.toFixed(2)} m)`);
}

console.log(failed ? `${failed} check(s) failed` : 'all contact checks passed');
process.exit(failed ? 1 : 0);
