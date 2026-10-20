// Map editor 2, F3: New map offers blank land (no oval loop), blank with an oval, or a copy of Hill Loop. A blank map can be drawn on and driven.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, frames, waitBuilt } from './lib.mjs';
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
await page.click('#mEditor'); await page.waitForSelector('#scEditor canvas', { timeout: 60000 });
await page.waitForFunction(() => window.__v2.editor.view3d && window.__v2.editor.view3d.stats().cubes > 2000, null, { timeout: 120000 }); await idle();

// the chooser
await page.click('.ed-top button:has-text("New map")');
await page.waitForSelector('.e2-panel[aria-label="New map"]');
const labels = await page.$$eval('.e2-panel[aria-label="New map"] .e2-choice b', bs => bs.map(b => b.textContent));
ok(labels.join('|') === 'Blank land|Blank with an oval loop|Copy of Hill Loop', 'New map offers: ' + labels.join(', '));
await page.click('.e2-panel[aria-label="New map"] button[data-size="96"]');
await page.click('.e2-choice:has-text("Blank land")');
await page.waitForFunction(() => window.__v2.editor.state.map.roads.edges[0].off === true, null, { timeout: 30000 });
await page.waitForFunction(() => window.__v2.editor.view3d.stats().cubes > 500, null, { timeout: 120000 }); await idle();
let m = await map();
ok(m.slab.x1 - m.slab.x0 === 96 && m.roads.edges.length === 1 && validateMap(m).ok, 'Blank land, small: 96 m, no oval, valid');
await frames(page, 10); await page.screenshot({ path: path.join(OUT, 'blank-land.png') });
const oneOval = await page.evaluate(() => { const w = window.__v2.editor.view3d.world; return w ? w.hasLoop : null; });
ok(oneOval === false, 'the 3D view is built from a world with no loop');

// draw a road on it
await page.click('.ed-tab:has-text("Roads")'); await page.click('.ed-tool[data-tile="road-straight"]');
const a = await at(-30, 0), b = await at(30, 0);
await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 6 }); await page.mouse.move(b[0], b[1], { steps: 6 }); await page.mouse.up(); await idle();
m = await map();
ok(m.roads.edges.length === 2 && validateMap(m).ok, 'a road can be drawn on blank land');
await page.click('.ed-tool[data-tile="start"]');
const mid = await at(0, 0); await page.mouse.click(mid[0], mid[1]); await idle();
m = await map();
ok(Math.abs(m.start.z) < 3 && Math.abs(m.start.x) < 5, 'Start here puts the start on the new road (' + m.start.x + ', ' + m.start.z + ')');

// drive it
await page.click('.ed-top button:has-text("Test drive: car")');
await waitBuilt(page);
ok(await page.evaluate(() => window.__loop.World.hasLoop === false), 'the game runs the blank map with no loop');
await page.keyboard.down('ArrowUp'); await frames(page, 90); await page.keyboard.up('ArrowUp');
const lap = await page.evaluate(() => document.getElementById('lapN').textContent + '|' + document.getElementById('lapT').textContent);
ok(lap === '0|0:00.00', 'no lap counting on a map without a loop (' + lap + ')');
await page.screenshot({ path: path.join(OUT, 'blank-drive.png'), timeout: 150000 });
await page.evaluate(() => window.__v2.exitGame());
await page.waitForFunction(() => window.__v2.editor && !document.getElementById('scEditor').hidden, null, { timeout: 60000 });
await page.waitForFunction(() => window.__v2.editor.view3d && window.__v2.editor.view3d.stats().cubes > 500, null, { timeout: 120000 }); await idle();

// blank with an oval
await page.click('.ed-top button:has-text("New map")');
await page.click('.e2-panel[aria-label="New map"] button[data-size="192"]');
await page.click('.e2-choice:has-text("Blank with an oval loop")');
await page.waitForFunction(() => window.__v2.editor.state.map.roads.edges[0].off !== true && window.__v2.editor.state.map.slab.x1 === 96, null, { timeout: 30000 });
await idle(); m = await map();
ok(validateMap(m).ok && m.roads.edges.length === 1, 'Blank with an oval: valid, loop on, 192 m');
// copy of Hill Loop still reachable
await page.click('.ed-top button:has-text("New map")'); await page.click('.e2-choice:has-text("Copy of Hill Loop")');
await page.waitForFunction(() => window.__v2.editor.state.map.meta.id === 'hill-loop', null, { timeout: 30000 });
ok(true, 'Copy of Hill Loop is still offered');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
await browser.close(); srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall blank-map checks passed');
process.exit(failed ? 1 : 0);
