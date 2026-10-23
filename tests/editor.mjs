// Map editor (E4/E5): drive the real 3D editor with the mouse. Camera, picking, picture tray, placing and turning buildings, moving, sculpting,
// painting, curved roads, saving, test drive and return, and giving everything back on exit.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, waitBuilt, frames } from './lib.mjs';
import { validateMap, describeErrors } from '../src/maps/format.js';
import * as ED from '../src/editor/model.js';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const OUT = path.join(ROOT, 'tests', 'output'); fs.mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve(process.env.DIST || path.join(ROOT, 'dist'));
const browser = await launch();
const { page, errors, ctx } = await newPage(browser, { width: 1200, height: 760 });
await page.goto(url + 'index.html');

const map = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__v2.editor.state.map)));
const hist = () => page.evaluate(() => window.__v2.editor.state.undo.length);
const at = (x, z) => page.evaluate(([x, z]) => window.__v2.editor.toClient(x, z), [x, z]);
const tab = n => page.click(`.ed-tab:has-text("${n}")`);
const tile = id => page.click(`.ed-tool[data-tile="${id}"]`);
const idle = () => page.waitForFunction(() => { const v = window.__v2.editor.view3d; return !v || (v.stats().pending === 0 && !v.building); }, null, { timeout: 120000 });
const ground = (x, z) => page.evaluate(([x, z]) => window.__v2.editor.view3d.world.column(x, z, 0.25), [x, z]);
async function click(p, opts) { const [x, y] = await at(...p); await page.mouse.click(x, y, opts); }
async function drag(a, b, steps = 6) { const [x0, y0] = await at(...a), [x1, y1] = await at(...b); await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps }); await page.mouse.move(x1, y1, { steps }); await page.mouse.up(); await idle(); }
const cam = () => page.evaluate(() => ({ ...window.__v2.editor.view3d.cam }));

await page.click('#mEditor');
await page.waitForSelector('#scEditor canvas', { timeout: 60000 });
await page.waitForFunction(() => window.__v2.editor && window.__v2.editor.view3d && window.__v2.editor.view3d.stats().cubes > 5000, null, { timeout: 120000 });
await idle();
ok(await page.evaluate(() => window.__v2.editor.mode) === '3d', 'the editor opens in the 3D view');
const stats = await page.evaluate(() => window.__v2.editor.view3d.stats());
ok(stats.voxel === 0.5 && stats.cubes > 5000, `the map is drawn with 50 cm cubes (${stats.cubes.toLocaleString()} cubes in ${stats.chunks} chunks)`);
ok(/map is valid/i.test(await page.textContent('.ed-errs')), 'a new map is shown as valid');

// ---- picture tray ----
await page.waitForFunction(() => { const i = document.querySelector('.ed-tool[data-tile="b-house"] img'); return i; }, null, { timeout: 5000 }).catch(() => {});
await tab('Buildings');
await page.waitForFunction(() => { const i = document.querySelector('.ed-tool[data-tile="b-house"] img'); return i && i.src.startsWith('data:image/png') && i.src.length > 3000; }, null, { timeout: 30000 }).catch(() => {});
const pics = await page.evaluate(() => [...document.querySelectorAll('.ed-tiles .ed-tool img')].map(i => i.src.length));
ok(pics.length === 5 && pics.every(n => n > 3000), `the Buildings tab shows 5 picture tiles drawn from the real pieces (picture sizes ${pics.join(', ')})`);
const labels = await page.evaluate(() => [...document.querySelectorAll('.ed-tab')].map(b => b.textContent));
ok(labels.length === 7, 'the tray has seven sections: ' + labels.join(', '));
await page.screenshot({ path: path.join(OUT, 'editor-tray.png') });

// ---- camera ----
await page.evaluate(() => window.__v2.editor.view3d.preset('iso')); await frames(page, 6);
const c0 = await cam();
const [cx, cy] = await at(0, -15);
await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' }); await page.mouse.move(cx + 120, cy + 30, { steps: 6 }); await page.mouse.up({ button: 'right' });
const c1 = await cam();
ok(Math.abs(c1.yaw - c0.yaw) > 0.3 && c1.pitch !== c0.pitch, `right-drag turns and tilts the view (turn ${(c1.yaw - c0.yaw).toFixed(2)} rad, tilt ${(c1.pitch - c0.pitch).toFixed(2)} rad)`);
const gp = await page.evaluate(([x, y]) => window.__v2.editor.view3d.pickGround(x, y), [cx, cy]);
await page.mouse.move(cx, cy); await page.mouse.wheel(0, -400); await frames(page, 6);
const c2 = await cam(), gp2 = await page.evaluate(([x, y]) => window.__v2.editor.view3d.pickGround(x, y), [cx, cy]);
ok(c2.dist < c1.dist * 0.7 && Math.hypot(gp.x - gp2.x, gp.z - gp2.z) < 1.5, `the wheel zooms toward the pointer (distance ${c1.dist.toFixed(0)} to ${c2.dist.toFixed(0)}, point under the pointer moved ${Math.hypot(gp.x - gp2.x, gp.z - gp2.z).toFixed(2)} m)`);
await page.mouse.move(cx, cy); await page.mouse.down({ button: 'middle' }); await page.mouse.move(cx + 80, cy + 40, { steps: 5 }); await page.mouse.up({ button: 'middle' });
const c3 = await cam(); ok(Math.hypot(c3.tx - c2.tx, c3.tz - c2.tz) > 3, `middle-drag slides the view along the ground (${Math.hypot(c3.tx - c2.tx, c3.tz - c2.tz).toFixed(1)} m)`);
let under = 0;
for (const yaw of [0, 1.1, 2.3, 3.4, 4.6, 5.5]) for (const [tx, tz] of [[0, -15], [30, -40], [-35, 10]]) {
  const r = await page.evaluate(([yaw, tx, tz]) => { const v = window.__v2.editor.view3d; Object.assign(v.cam, { yaw, pitch: 0.1, dist: 20, tx, tz, ty: v.groundH(tx, tz) }); v.render(); return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => { const p = v.camPos(); res(p[1] - v.groundH(p[0], p[2])); }))); }, [yaw, tx, tz]);
  if (r < 0.7) under++;
}
ok(under === 0, 'the camera never goes under the ground, even tilted flat on a hillside');
await page.evaluate(() => window.__v2.editor.view3d.preset('top')); await frames(page, 6);
const c4 = await cam(); ok(c4.pitch > 1.5, 'the Top preset looks straight down');
let worst = 0;
for (const p of [[0, -15], [20, -10], [-20, -30], [30, 5], [-10, 10]]) { const [x, y] = await at(...p); const g = await page.evaluate(([x, y]) => window.__v2.editor.view3d.pickGround(x, y), [x, y]); worst = Math.max(worst, Math.hypot(g.x - p[0], g.z - p[1])); }
ok(worst < 0.5, `clicking a spot on screen finds that spot on the ground (worst error ${worst.toFixed(2)} m)`);

// ---- place a house, face the road, turn it by the ring, move it ----
await tab('Buildings'); await tile('b-house');
await click([0, -15]); await idle();
let m = await map();
const b = m.scenery.find(s => s.t === 'bldgY');
ok(b && m.pads.length === 1 && validateMap(m).ok, 'clicking with a House tile places a turnable building on a valid map');
const exp = ED.faceRoadYaw(m, b.id);
ok(Math.abs(b.yaw - exp.yaw) < 1, `it was turned to face the nearest road (${b.yaw} degrees)`);
await tile('select'); await click([0, -15]);
ok(/Building b-1/.test(await page.textContent('.ed-sel')), 'Select shows the building that was clicked');
const h0 = await page.evaluate(() => window.__v2.editor.rotHandle());
ok(h0 && h0.client[0] > 0, 'a turn ring with a handle is shown around the selected building');
const u0 = await hist();
await page.mouse.move(h0.client[0], h0.client[1]); await page.mouse.down();
const [tx, ty] = await at(h0.centre[0] + 6, h0.centre[1]);
await page.mouse.move((h0.client[0] + tx) / 2, (h0.client[1] + ty) / 2, { steps: 4 }); await page.mouse.move(tx, ty, { steps: 4 }); await page.mouse.up(); await idle();
m = await map(); const b2 = m.scenery.find(s => s.t === 'bldgY');
ok(b2.yaw === -90 && (await hist()) === u0 + 1, `dragging the handle turns the building in 15 degree steps (now ${b2.yaw}) as one undo step`);
ok(validateMap(m).ok && m.pads[0].yaw === -90, 'the pad under it turned with it');
await page.fill('.ed-sel input[type="number"] >> nth=1', '30'); await page.press('.ed-sel input[type="number"] >> nth=1', 'Tab'); await idle();
ok((await map()).scenery.find(s => s.t === 'bldgY').yaw === 30, 'the Turn field sets an exact angle');
await page.click('.ed-sel button:has-text("Face road")'); await idle();
const b3 = (await map()).scenery.find(s => s.t === 'bldgY');
ok(Math.abs(b3.yaw - exp.yaw) < 1, 'Face road turns the front back to the road');
const sbBox = page.locator('.ed-sel label:has-text("Space between") input');
await sbBox.fill('3'); await sbBox.press('Tab'); await idle();
const sb = ED.setbackOf(await map(), b.id);
ok(Math.abs(sb.dist - 3) < 0.1, `the setback field puts the front 3 m from the road edge (${sb.dist} m)`);
const cb = (await map()).scenery.find(s => s.t === 'bldgY');
const [mx0, my0] = await at(cb.cx, cb.cz), [mx1, my1] = await at(cb.cx + 6, cb.cz + 2);
await page.mouse.move(mx0, my0); await page.mouse.down(); await page.mouse.move((mx0 + mx1) / 2, (my0 + my1) / 2, { steps: 4 }); await page.mouse.move(mx1, my1, { steps: 4 }); await page.mouse.up(); await idle();
const cb2 = (await map()).scenery.find(s => s.t === 'bldgY');
ok(Math.hypot(cb2.cx - cb.cx - 6, cb2.cz - cb.cz - 2) < 1.5, `dragging the selected building moves it (by ${(cb2.cx - cb.cx).toFixed(1)}, ${(cb2.cz - cb.cz).toFixed(1)} m)`);
await page.screenshot({ path: path.join(OUT, 'editor-turned.png') });

// ---- copy, row along road ----
const nb0 = (await map()).scenery.filter(s => s.t === 'bldgY').length, uh = await hist();
await page.click('.ed-sel button:has-text("Copy")'); await idle();
m = await map();
ok(m.scenery.filter(s => s.t === 'bldgY').length === nb0 + 1 && (await hist()) === uh + 1, 'Copy makes one more building in one undo step');
await page.keyboard.press('Control+z'); await idle();
ok((await map()).scenery.filter(s => s.t === 'bldgY').length === nb0, 'undo removes the copy');
{ const sp = (await map()).scenery.find(q => q.t === 'bldgY'); const [qx, qy] = await at(sp.cx, sp.cz); await page.mouse.click(qx, qy); await idle(); }
await page.click('.ed-sel button:has-text("Row along road")'); await idle();
const nb1 = (await map()).scenery.filter(s => s.t === 'bldgY').length;
ok(nb1 > nb0 + 1 && validateMap(await map()).ok, `Row along road lines up more buildings (${nb1 - nb0} added) and the map stays valid`);
await page.keyboard.press('Control+z'); await idle();
ok((await map()).scenery.filter(s => s.t === 'bldgY').length === nb0, 'one undo removes the whole row');
{ const sp = (await map()).scenery.find(q => q.t === 'bldgY'); const [qx, qy] = await at(sp.cx, sp.cz); await page.mouse.click(qx, qy); await idle(); }

// ---- sculpt and paint ----
await tab('Ground'); await tile('raise');
const g0 = (await ground(-34, 8)).h, u1 = await hist();
await drag([-36, 8], [-32, 8]);
const g1 = (await ground(-34, 8)).h; m = await map();
ok(g1 - g0 > 0.2 && m.layers && m.layers.sculpt.cells.length > 5 && (await hist()) === u1 + 1, `a Raise stroke lifts the ground (${g0.toFixed(2)} to ${g1.toFixed(2)} m) and is one undo step`);
ok(validateMap(m).ok, 'the map with sculpted ground is valid');
await tile('p-paver'); await drag([-36, 12], [-30, 12]);
ok((await ground(-33, 12)).kind === 19 && (await ground(-33, 4)).kind !== 19, 'a Pavers stroke paints that surface only where you drew');
await page.click('.ed-top button:has-text("Undo")'); await idle();
ok((await ground(-33, 12)).kind !== 19, 'Undo takes the paint back');
await page.click('.ed-top button:has-text("Redo")'); await idle();

// ---- curved road with handles ----
await tab('Roads'); await tile('road-curve');
const e0 = (await map()).roads.edges.length;
for (const p of [[-38, -38], [-15, -45], [10, -38]]) { await click(p); await page.waitForTimeout(500); }
const [lx, ly] = await at(38, -44); await page.mouse.click(lx, ly); await page.mouse.dblclick(lx, ly); await idle();
m = await map(); const ce = m.roads.edges[e0];
ok(m.roads.edges.length === e0 + 1 && ce && ce.type === 'curve' && ce.pts.length >= 4 && validateMap(m).ok, `clicking points and double-clicking makes a curved road (${ce && ce.pts.length} points)`);
await tile('select'); await click([-15, -45]);
const hs = await page.evaluate(() => window.__v2.editor.handles());
ok(hs.length >= 4, 'the selected curved road shows a handle at each point');
const k = 1, before = ce.pts[k].slice();
const [hx, hy] = hs[k].client, [nx, ny] = await at(before[0], before[1] + 3);
await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(nx, ny, { steps: 6 }); await page.mouse.up(); await idle();
const ce2 = (await map()).roads.edges[e0];
ok(Math.abs(ce2.pts[k][1] - before[1] - 3) < 1.5 && validateMap(await map()).ok, `dragging a handle bends the road (${before[1]} to ${ce2.pts[k][1]})`);

// ---- flat fallback ----
await page.click('.ed-nav button:has-text("Flat")'); await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__v2.editor.mode === 'flat' && !window.__v2.editor.view3d && document.querySelectorAll('#scEditor canvas').length === 1), 'the flat view is still there, and the 3D renderer is given back while it is shown');
await page.click('.ed-nav button:has-text("3D")', { timeout: 3000 }).catch(() => page.click('.ed-navbtn >> nth=0'));
await page.waitForFunction(() => window.__v2.editor.mode === '3d' && window.__v2.editor.view3d && window.__v2.editor.view3d.stats().cubes > 5000, null, { timeout: 60000 }); await idle();
ok((await map()).roads.edges.length === e0 + 1, 'switching views keeps the work');

// ---- save, test drive, come back ----
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.ed-top button:has-text("Save file")')]);
const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); const vr = validateMap(saved);
ok(vr.ok && saved.scenery.some(s => s.t === 'bldgY') && saved.layers && saved.roads.edges.some(e => e.type === 'curve'), 'the saved file passes the validator and holds the turned building, ground layers and curved road' + (vr.ok ? '' : ': ' + describeErrors(vr, 3)));
const camBefore = await cam(), keep = await map(), hk = await hist();
await page.click('.ed-top button:has-text("Test drive: car")');
await waitBuilt(page);
ok(await page.evaluate(() => window.__loop.World.map.roads.edges.length) === keep.roads.edges.length && await page.evaluate(() => window.__loop.SOLIDS.some(s => s.t === 'o')), 'test drive builds the edited map, with the turned building solid where it stands');
await frames(page, 20);
await page.screenshot({ path: path.join(OUT, 'editor-testdrive.png'), timeout: 150000 });
await page.evaluate(() => window.__v2.exitGame());
await page.waitForFunction(() => window.__v2.editor && !document.getElementById('scEditor').hidden, null, { timeout: 60000 });
await page.waitForFunction(() => window.__v2.editor.view3d && window.__v2.editor.view3d.stats().cubes > 5000, null, { timeout: 120000 }); await idle();
const camAfter = await cam(), back = await map();
ok(back.roads.edges.length === keep.roads.edges.length && back.pads.length === keep.pads.length && (await hist()) === hk, 'leaving the test drive returns to the editor with the work and history intact');
ok(Math.abs(camAfter.yaw - camBefore.yaw) < 1e-6 && Math.abs(camAfter.dist - camBefore.dist) < 1e-6, 'the camera is where it was');

// ---- drop the car at a chosen spot ----
const spot = (await map()).scenery.find(s => s.t === 'bldgY'), start0 = (await map()).start;
const [sx, sy] = await at(spot.cx, spot.cz); await page.mouse.click(sx, sy); await idle();
await page.click('.ed-sel button:has-text("Drive here")');
await waitBuilt(page);
const ds = await page.evaluate(() => ({ x: window.__loop.World.map.start.x, z: window.__loop.World.map.start.z }));
ok(Math.hypot(ds.x - start0.x, ds.z - start0.z) > 1, 'Drive here starts the test drive at the chosen spot, not at the map start');
await page.evaluate(() => window.__v2.exitGame());
await page.waitForFunction(() => window.__v2.editor && !document.getElementById('scEditor').hidden, null, { timeout: 60000 });
await page.waitForFunction(() => window.__v2.editor.view3d && window.__v2.editor.view3d.stats().cubes > 5000, null, { timeout: 120000 }); await idle();
const st1 = (await map()).start;
ok(st1.x === start0.x && st1.z === start0.z, 'the map start is unchanged after a drop-in drive');

// ---- open a file, then leave ----
const hill = fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'));
await page.setInputFiles('#scEditor input[type="file"]', { name: 'hill.json', mimeType: 'application/json', buffer: hill });
await page.waitForFunction(() => window.__v2.editor.state.map.meta.id === 'hill-loop');
await idle();
ok((await map()).roads.edges.length === 4, 'Open file loads Hill Loop into the editor');
await frames(page, 10);
await page.screenshot({ path: path.join(OUT, 'editor-hill.png') });
await page.setInputFiles('#scEditor input[type="file"]', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"x"}') });
await page.waitForTimeout(300);
ok((await map()).meta.name === 'Hill Loop Track', 'a bad file is refused and the map stays as it was');
await page.click('.ed-top button:has-text("Exit editor")');
await page.waitForFunction(() => !window.__v2.editor && !document.getElementById('scTitle').hidden, null, { timeout: 8000 }).catch(() => {});
ok(await page.evaluate(() => window.__v2.editor === null && document.querySelectorAll('canvas').length === 0 && document.getElementById('scEditor').childElementCount === 0), 'leaving the editor gives back its canvases and DOM');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
await ctx.close(); await browser.close(); srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall editor checks passed');
process.exit(failed ? 1 : 0);
