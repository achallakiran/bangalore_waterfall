// Road shape point: tap a road, then up / down change the slope and left / right bend it.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, frames } from './lib.mjs';
import { validateMap } from '../src/maps/format.js';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const OUT = path.join(ROOT, 'tests', 'output'); fs.mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve(process.env.DIST || path.join(ROOT, 'dist'));
const browser = await launch();
const { page, errors } = await newPage(browser, { width: 390, height: 780 });
await page.goto(url + 'index.html');
const map = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__v2.editor.state.map)));
const at = (x, z) => page.evaluate(([x, z]) => window.__v2.editor.toClient(x, z), [x, z]);
const idle = () => page.waitForFunction(() => { const v = window.__v2.editor.view3d; return !v || (v.stats().pending === 0 && !v.building); }, null, { timeout: 120000 });
const undoTitle = () => page.$eval('.e2-fabbtn[data-act="undo"]', b => b.title);
const press = async (act, hold = 0) => { const b = await page.$('.e2-sbtn[data-shape="' + act + '"]'); const r = await b.boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); if (hold) await page.waitForTimeout(hold); await page.mouse.up(); await page.waitForTimeout(150); };

await page.click('#mEditor'); await page.waitForSelector('#scEditor canvas', { timeout: 60000 });
await page.waitForFunction(() => window.__v2.editor.view3d && window.__v2.editor.view3d.stats().cubes > 2000, null, { timeout: 120000 }); await idle();
await page.click('.ed-top button:has-text("New map")'); await page.click('.e2-panel[aria-label="New map"] button[data-size="96"]'); await page.click('.e2-choice:has-text("Blank land")');
await page.waitForFunction(() => window.__v2.editor.state.map.roads.edges[0].off === true, null, { timeout: 30000 });
await page.waitForFunction(() => window.__v2.editor.view3d.stats().cubes > 500, null, { timeout: 120000 }); await idle();
// a straight road
await page.click('.ed-tab:has-text("Roads")'); await page.click('.ed-tool[data-tile="road-straight"]');
let a = await at(-30, 0), b = await at(30, 0);
await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move(b[0], b[1], { steps: 10 }); await page.mouse.up(); await idle();
await page.evaluate(() => window.__v2.editor.escape());
ok(await page.$eval('.e2-shape', e => e.hidden), 'no shape panel before a road is selected');
const mid = await at(0, 0); await page.mouse.click(mid[0], mid[1]); await idle();
ok(!(await page.$eval('.e2-shape', e => e.hidden)), 'tapping a road shows the shape panel');
const info = await page.$eval('.e2-sinfo', e => e.textContent);
ok(/road-1/.test(info) && /height 0\.0 m/.test(info), 'the panel says which road and its height here (' + info + ')');
const vis = await page.$$eval('.e2-sbtn', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [r.x >= 0 && r.x + r.width <= innerWidth && r.y >= 0 && r.y + r.height <= innerHeight, r.width >= 44 && r.height >= 44]; }));
ok(vis.every(v => v[0]), 'every button is fully on screen on a phone');
ok(vis.slice(0, 4).every(v => v[1]), 'the four arrow buttons are at least 44 px');
await page.screenshot({ path: path.join(OUT, 'shape-panel.png') });

// up: slope
await press('up'); let m = await map();
ok(m.roads.edges[1].profile.length === 3 && Math.abs(m.roads.edges[1].profile[1][1] - 0.5) < 0.01, 'Up raises the road 0.5 m at the marker, adding a height point');
ok(/Change slope/.test(await undoTitle()), 'Undo says "Change slope"');
await press('up'); m = await map();
ok(Math.abs(m.roads.edges[1].profile[1][1] - 1.0) < 0.01 && m.roads.edges[1].profile.length === 3, 'Up again changes the same point');
await press('down'); m = await map(); ok(Math.abs(m.roads.edges[1].profile[1][1] - 0.5) < 0.01, 'Down lowers it');
// hold
const hBefore = (await map()).roads.edges[1].profile[1][1];
await press('up', 1400); m = await map();
const hAfter = m.roads.edges[1].profile[1][1];
ok(hAfter >= hBefore + 2, 'holding Up keeps raising (' + hBefore + ' to ' + hAfter + ')');
await page.click('.e2-fabbtn[data-act="undo"]'); await page.waitForTimeout(150); m = await map();
ok(Math.abs(m.roads.edges[1].profile[1][1] - hBefore) < 0.01, 'one Undo takes back the whole hold');

// bend
await press('left'); m = await map();
ok(m.roads.edges[1].type === 'curve' && m.roads.edges[1].pts.length === 3 && Math.abs(m.roads.edges[1].pts[1][1] + 2) < 0.2, 'Left bends the road (it became a curve, point 2 m to the left: z ' + m.roads.edges[1].pts[1][1] + ')');
ok(/Bend road/.test(await undoTitle()) && validateMap(m).ok, 'Undo says "Bend road" and the map is valid');
await press('left'); m = await map();
ok(m.roads.edges[1].pts.length === 3 && Math.abs(m.roads.edges[1].pts[1][1] + 4) < 0.3, 'Left again moves the same point (z ' + m.roads.edges[1].pts[1][1] + ')');
await press('right'); await press('right'); await press('right'); m = await map();
ok(m.roads.edges[1].pts.length === 3 && Math.abs(m.roads.edges[1].pts[1][1] - 2) < 0.3, 'Right moves it back and past (z ' + m.roads.edges[1].pts[1][1] + ')');
await page.screenshot({ path: path.join(OUT, 'shape-bent.png') });
await press('step'); ok(/Fine/.test(await page.$eval('.e2-sbtn[data-shape="step"]', e => e.textContent)), 'the step button cycles to Fine');
// remove
await press('remove'); m = await map();
ok(m.roads.edges[1].pts.length === 2 && validateMap(m).ok, 'Remove takes the bend point away');
// many undos return to the straight road
for (let i = 0; i < 12; i++) { const t = await undoTitle(); if (/Nothing/.test(t)) break; await page.click('.e2-fabbtn[data-act="undo"]'); await page.waitForTimeout(100); }
m = await map(); ok(m.roads.edges.length === 1 || m.roads.edges[1].type === 'line', 'undoing everything gets back to the start');

// oval loop: up and down only
await page.click('.ed-top button:has-text("New map")'); await page.click('.e2-panel[aria-label="New map"] button[data-size="192"]'); await page.click('.e2-choice:has-text("Blank with an oval loop")');
await page.waitForFunction(() => window.__v2.editor.state.map.roads.edges[0].off !== true, null, { timeout: 30000 }); await idle();
const ov = await page.evaluate(() => { const m = window.__v2.editor.state.map, e = m.roads.edges[0]; return { L: e.L, R: e.R }; });
const oc = await at(0, -ov.R * 2); await page.mouse.click(oc[0], oc[1]); await idle();
const dis = await page.$$eval('.e2-sbtn', bs => bs.slice(0, 4).map(b => b.disabled));
ok(dis[0] && dis[3] && !dis[1] && !dis[2], 'on the oval loop Left and Right are off and Up and Down work (' + dis + ')');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
await browser.close(); srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall shape checks passed');
process.exit(failed ? 1 : 0);
