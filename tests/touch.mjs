// Map editor 2, F1: real touch events on a phone-sized screen. Camera gestures (slide, zoom, turn must not mix),
// the Hand button, picking and drawing past the map edge, the edge handles, and growing while moving.
import path from 'node:path';
import { ROOT, launch, serve } from './lib.mjs';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const { srv, url } = await serve(process.env.DIST || path.join(ROOT, 'dist'));
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' });
await ctx.route('**/three.min.js', r => r.fulfill({ path: path.join(ROOT, 'public', 'vendor', 'three.min.js'), contentType: 'application/javascript' }));
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await page.goto(url + 'index.html');

// ---- touch helpers: points are client pixels; ids keep fingers apart ----
const tp = (pts) => pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1, radiusX: 4, radiusY: 4, force: 1 }));
const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : tp(pts) });
const wait = ms => page.waitForTimeout(ms);
async function swipe(paths, steps = 10, hold = 0) {      // paths: one list of [from, to] per finger
  await send('touchStart', paths.map(p => p[0]));
  for (let i = 1; i <= steps; i++) { await send('touchMove', paths.map(p => [p[0][0] + (p[1][0] - p[0][0]) * i / steps, p[0][1] + (p[1][1] - p[0][1]) * i / steps])); await wait(16); }
  if (hold) await wait(hold);
  await send('touchEnd', []);
}
const lerp = (a, b, t) => a + (b - a) * t;
async function twoFingers(c0, r0, c1, r1, ang0, ang1, steps = 12) {   // centre, half-gap, angle: from -> to
  const at = t => { const c = [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t)], r = lerp(r0, r1, t), a = lerp(ang0, ang1, t); return [[c[0] - Math.cos(a) * r, c[1] - Math.sin(a) * r], [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]]; };
  await send('touchStart', at(0));
  for (let i = 1; i <= steps; i++) { await send('touchMove', at(i / steps)); await wait(16); }
  await send('touchEnd', []);
}
const cam = () => page.evaluate(() => ({ ...window.__v2.editor.view3d.cam }));
const map = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__v2.editor.state.map)));
const client = (x, z) => page.evaluate(([x, z]) => window.__v2.editor.toClient(x, z), [x, z]);
const ground = (sx, sy) => page.evaluate(([x, y]) => window.__v2.editor.view3d.pickGround(x, y), [sx, sy]);
const idle = () => page.waitForFunction(() => { const v = window.__v2.editor.view3d; return !v || (v.stats().pending === 0 && !v.building); }, null, { timeout: 120000 });
const settle = async () => { await wait(900); };         // let coasting finish

await page.click('#mEditor'); await page.waitForSelector('#scEditor canvas', { timeout: 60000 });
await page.waitForFunction(() => window.__v2.editor && window.__v2.editor.view3d && window.__v2.editor.view3d.stats().cubes > 2000, null, { timeout: 120000 }); await idle();
const box = await page.$eval('.ed-stage', e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
const mid = [box[0] + box[2] / 2, box[1] + box[3] * 0.45];
const S0 = (await map()).slab;

// ---- one finger without Hand uses the tool, not the camera ----
let c0 = await cam();
await swipe([[[mid[0], mid[1]], [mid[0] - 100, mid[1] + 10]]]); await settle();
let c1 = await cam();
ok(Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz) < 0.5 && Math.abs(c1.yaw - c0.yaw) < 0.001, 'one finger without Hand does not move the camera');

// ---- Hand: one finger slides, the grabbed ground stays under the finger ----
await page.click('.e2-fabbtn[data-act="hand"]');
ok(await page.$eval('.e2-fabbtn[data-act="hand"]', b => b.getAttribute('aria-pressed') === 'true'), 'Hand turns on');
const from = [mid[0] + 60, mid[1]], to = [mid[0] - 40, mid[1] + 30];
const g0 = await ground(...from);
c0 = await cam();
await swipe([[from, to]], 12); await settle();
c1 = await cam();
const g1 = await ground(...to);
ok(Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz) > 3, `Hand: one finger slides the map (moved ${Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz).toFixed(1)} m)`);
ok(g0 && g1 && Math.hypot(g0.x - g1.x, g0.z - g1.z) < 3.5, `Hand: the ground point first touched ends under the finger (off by ${g0 && g1 ? Math.hypot(g0.x - g1.x, g0.z - g1.z).toFixed(2) : '?'} m)`);
ok(Math.abs(c1.yaw - c0.yaw) < 0.001 && Math.abs(c1.dist / c0.dist - 1) < 0.001, 'Hand: sliding does not turn or zoom');

// ---- coasting: a fast flick keeps moving a little, then stops ----
await page.evaluate(() => window.__v2.editor.view3d.preset('iso')); await wait(200);
c0 = await cam();
await send('touchStart', [[mid[0] + 80, mid[1]]]);
for (let i = 1; i <= 6; i++) { await send('touchMove', [[mid[0] + 80 - i * 22, mid[1]]]); await wait(12); }
const cA = c0;
await send('touchEnd', []); await wait(120);
const cB = await cam(); await wait(1100);
const cC = await cam(), cD = (await wait(200), await cam());
ok(Math.hypot(cB.tx - cA.tx, cB.tz - cA.tz) > 0.2, 'a fast flick coasts after the finger lifts');
ok(Math.hypot(cD.tx - cC.tx, cD.tz - cC.tz) < 0.05, 'and the coasting stops by itself');
await page.click('.e2-fabbtn[data-act="hand"]');                       // Hand off again

// ---- two fingers: the gesture is locked, so the others do not leak in ----
await page.evaluate(() => window.__v2.editor.view3d.preset('iso')); await wait(200);
c0 = await cam();
await twoFingers(mid, 50, [mid[0] - 70, mid[1] + 20], 50, 0, 0.05);     // slide with a little accidental twist
await settle(); c1 = await cam();
ok(Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz) > 2, 'two-finger slide moves the map');
ok(Math.abs(c1.yaw - c0.yaw) < 0.001 && Math.abs(c1.dist / c0.dist - 1) < 0.001, 'two-finger slide with a little twist does not turn or zoom');
c0 = await cam();
await twoFingers(mid, 40, mid, 90, 0, 0.04);                            // pinch out, with a small twist
await settle(); c1 = await cam();
ok(c1.dist / c0.dist < 0.7, `pinch out zooms in (${(c1.dist / c0.dist).toFixed(2)} of the distance)`);
ok(Math.abs(c1.yaw - c0.yaw) < 0.001, 'pinch does not turn the map');
c0 = await cam();
await twoFingers(mid, 60, mid, 60, 0, 0.7);                             // twist
await settle(); c1 = await cam();
ok(Math.abs(c1.yaw - c0.yaw) > 0.4, `twist turns the map (${(c1.yaw - c0.yaw).toFixed(2)} rad)`);
ok(Math.abs(c1.dist / c0.dist - 1) < 0.001 && Math.hypot(c1.tx - c0.tx, c1.tz - c0.tz) < 0.5, 'twist does not zoom or slide');

// ---- an edit started by the first finger is cancelled when a second finger lands ----
await page.evaluate(() => window.__v2.editor.view3d.preset('iso')); await wait(200);
await page.click('.ed-tab:has-text("Ground")'); await page.click('.ed-tool[data-tile="raise"]');
const before = await map();
await send('touchStart', [[mid[0], mid[1]]]); await wait(60);
await send('touchStart', [[mid[0], mid[1]], [mid[0] + 60, mid[1]]]); await wait(60);
await send('touchEnd', []); await wait(300); await idle();
const after = await map();
ok(JSON.stringify(after.layers || null) === JSON.stringify(before.layers || null), 'a brush stroke started by one finger is undone when a second finger lands (camera gesture)');
await page.evaluate(() => window.__v2.editor.escape());

// ---- the extension zone ----
await page.evaluate(() => window.__v2.editor.view3d.preset('iso')); await wait(200);
const pe = await client(S0.x1 + 40, (S0.z0 + S0.z1) / 2);
const gp = await ground(pe[0], pe[1]);
ok(gp && gp.x > S0.x1 + 20, `a touch 40 m past the east edge picks ground there (x ${gp ? gp.x.toFixed(0) : 'none'}, edge ${S0.x1})`);
const hE = await client(S0.x1, (S0.z0 + S0.z1) / 2), toE = await client(S0.x1 + 40, (S0.z0 + S0.z1) / 2);
await swipe([[hE, toE]], 12); await wait(300); await idle();
let m = await map();
ok(m.slab.x1 >= S0.x1 + 36 && m.slab.x1 % 12 === 0 && m.slab.x0 === S0.x0, `dragging the east handle extends the map (${S0.x1} to ${m.slab.x1})`);
ok(/Extend map/.test(await page.$eval('.e2-fabbtn[data-act="undo"]', b => b.title)), 'Undo says "Extend map"');
await page.click('.e2-fabbtn[data-act="undo"]'); await idle();
ok((await map()).slab.x1 === S0.x1, 'Undo takes the extension back');

// draw a road out past the edge
await page.click('.ed-tab:has-text("Roads")'); await page.click('.ed-tool[data-tile="road-straight"]');
const rA = await client(S0.x1 - 14, -5), rB = await client(S0.x1 + 36, -5);
await swipe([[rA, rB]], 12); await wait(300); await idle();
m = await map();
ok(m.roads.edges.length === 2 && m.slab.x1 >= S0.x1 + 36, `a road drawn 36 m past the edge is made, and the map grows (${S0.x1} to ${m.slab.x1})`);
await page.click('.e2-fabbtn[data-act="undo"]'); await idle();
ok((await map()).roads.edges.length === 1 && (await map()).slab.x1 === S0.x1, 'one Undo removes the road and the extra ground');

// a stray tap far away does not balloon the map
await page.click('.ed-tab:has-text("Roadside")'); await page.click('.ed-tool[data-tile="t-small"]');
const far = await client(S0.x1 + 150, 0);
await swipe([[far, [far[0] + 1, far[1]]]], 2); await wait(300);
ok((await map()).slab.x1 === S0.x1, 'a tap 150 m past the edge does not grow the map');

// moving a building past the edge grows the map
await page.click('.ed-tab:has-text("Buildings")'); await page.click('.ed-tool[data-tile="b-house"]');
const bp = await client(S0.x1 - 18, -22);
await swipe([[bp, [bp[0] + 1, bp[1]]]], 2); await wait(400); await idle();
await page.evaluate(() => window.__v2.editor.escape());
await page.evaluate(() => window.__v2.editor.view3d.preset('iso')); await wait(1500); await idle();
m = await map();
const bld = m.scenery.find(s => s.t === 'bldgY' || s.t === 'bldgN');
if (!bld) ok(false, 'a building was placed for the move test');
else {
  const bx = bld.cx != null ? bld.cx : (bld.x0 + bld.x1) / 2, bz = bld.cz != null ? bld.cz : bld.zf + bld.depth / 2;
  await page.evaluate(([x, z]) => { const v = window.__v2.editor.view3d; v.cam.tx = x; v.cam.tz = z; v.cam.dist = Math.min(v.cam.dist, 35); v.invalidate && 0; }, [bx, bz]); await wait(600);
  const bc = await client(bx, bz);
  console.log('handlepx', await page.evaluate(([x, z, bc]) => { const v = window.__v2.editor.view3d; return null; }, [bx, bz, bc]).catch(e => 'err'), 'dist', (await cam()).dist);
  await send('touchStart', [bc]); await wait(60); await send('touchEnd', []); await wait(300);                    // tap: select it
  console.log('slab', JSON.stringify(m.slab), 'n', m.scenery.length, await page.evaluate(() => Object.keys(window.__v2.editor).join(',')));
  console.log('bld', JSON.stringify(bld), 'sel', await page.evaluate(() => { const e = window.__v2.editor; return JSON.stringify(e.selected || null); }));
  console.log('handles', JSON.stringify(await page.evaluate(() => window.__v2.editor.handles && window.__v2.editor.handles())), 'bc', bc, 'box', box);
  const target = await client(S0.x1 + 30, bz);
  await swipe([[bc, target]], 14); await wait(400); await idle();
  console.log('undo', await page.$eval('.e2-fabbtn[data-act="undo"]', b => b.title), 'toast', await page.evaluate(() => (document.querySelector('.ed-toast,.e2-toast,[role=status]') || {}).textContent), 'status', await page.evaluate(() => (document.querySelector('.ed-status,.ed-hint') || {}).textContent));
  m = await map();
  const nb = m.scenery.find(s => s.id === bld.id); console.log('yaw', bld.yaw, '->', nb.yaw);
  const nx = nb.cx != null ? nb.cx : (nb.x0 + nb.x1) / 2;
  ok(nx > S0.x1 + 15 && m.slab.x1 > S0.x1, `a building dragged past the edge goes there and the map grows (building x ${nx.toFixed(0)}, edge ${S0.x1} to ${m.slab.x1})`);
}

// ---- diagnostics ----
await page.evaluate(() => window.scrollTo(0, 0));
const dg = await page.$('.ed-map input[type="checkbox"]');
if (dg) { await dg.scrollIntoViewIfNeeded(); await dg.check(); await wait(1300); ok(/fps/.test(await page.$eval('.e2-diag', e => e.textContent)), 'Diagnostics shows speed and gesture'); } else ok(false, 'Diagnostics switch exists');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
await ctx.close(); await browser.close(); srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall touch checks passed');
process.exit(failed ? 1 : 0);
