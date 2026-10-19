// Map editor (Phase 4): drive the real editor with the mouse, save a file, test-drive the map, and check everything is given back.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, waitBuilt, frames } from './lib.mjs';
import { validateMap, describeErrors } from '../src/maps/format.js';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const OUT = path.join(ROOT, 'tests', 'output'); fs.mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve(path.join(ROOT, 'dist'));
const browser = await launch();
const { page, errors, ctx } = await newPage(browser, { width: 1100, height: 700 });
await page.goto(url + 'index.html');

const ed = () => page.evaluate(() => { const e = window.__v2.editor; return e ? { edges: e.state.map.roads.edges.length, pads: e.state.map.pads.length, scen: e.state.map.scenery.length, shops: e.state.map.features.shops.length, sig: e.state.map.features.signals.length, cross: e.state.map.features.crossings.length, spawn: e.state.map.features.spawnAreas.length, undo: e.state.undo.length, name: e.state.map.meta.name, junc: e.state.map.roads.junctions.length } : null; });
const at = (x, z) => page.evaluate(([x, z]) => window.__v2.editor.toClient(x, z), [x, z]);
const tool = id => page.click(`.ed-tool[data-tool="${id}"]`);
async function drag(a, b) { const [x0, y0] = await at(...a), [x1, y1] = await at(...b); await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up(); }
async function click(p, opts) { const [x, y] = await at(...p); await page.mouse.click(x, y, opts); }

await page.click('#mEditor');
await page.waitForSelector('#scEditor canvas', { timeout: 30000 });
await page.waitForFunction(() => window.__v2.editor && !document.getElementById('scEditor').hidden);
await frames(page, 20);
let s = await ed();
ok(s && s.edges === 1 && s.scen === 0, 'editor opens with a new map (the oval only, no buildings)');
ok(/map is valid/i.test(await page.textContent('.ed-errs')), 'a new map is shown as valid');

await tool('road'); await drag([-30, -15], [30, -15]);
s = await ed(); ok(s.edges === 2, 'dragging with the Road tool adds a cross road');
ok(s.junc >= 2, `junctions appear where it crosses the oval (${s.junc})`);
await tool('slope'); await click([0, -15]); s = await ed();
ok(await page.evaluate(() => window.__v2.editor.state.map.roads.edges[1].profile.length) === 3, 'the Slope tool adds a height point');
await tool('building'); await drag([-30, 5], [-18, 12]);
s = await ed(); ok(s.pads === 1, 'dragging with the Building tool adds a building');
await page.click('.ed-opts input[type="checkbox"]'); await page.fill('.ed-opts input[type="text"]', 'Test Stores');
await drag([-14, 5], [-5, 11]);
s = await ed(); ok(s.shops === 1 && s.pads === 2, 'a shop is added with its name');
await tool('tree'); await click([10, 8]);
await tool('lamp'); await click([12, 4]);
await tool('signal'); await click([0, -12]);
await tool('crossing'); await click([20, -15]);
await tool('spawn'); await drag([20, 5], [28, 10]);
await tool('terrain'); await click([-20, 14]);
s = await ed();
ok(s.sig === 1 && s.cross === 1 && s.spawn === 1, 'signal, crossing and spawn area are added');
await frames(page, 30);
await page.screenshot({ path: path.join(OUT, 'editor.png') });

const before = (await ed()).undo;
await page.click('.ed-top button:has-text("Undo")'); s = await ed();
ok(s.undo === before - 1 && s.spawn + s.sig + s.cross >= 2, 'Undo steps back one change');
await page.click('.ed-top button:has-text("Redo")');
ok((await ed()).undo === before, 'Redo brings it back');

const nScen = (await ed()).scen;
await tool('erase'); await click([10, 8]);
ok((await ed()).scen === nScen - 1, 'the Erase tool removes the tree that was clicked');
await tool('select'); await click([-24, 8]);
ok(/Building b-1/.test(await page.textContent('.ed-sel')), 'Select shows the building that was clicked');

// save
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.ed-top button:has-text("Save file")')]);
const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
const vr = validateMap(saved);
ok(vr.ok, 'the saved file passes the map validator' + (vr.ok ? '' : ': ' + describeErrors(vr, 3)));
ok(saved.features.shops[0].name === 'Test Stores' && saved.features.spawnAreas.length === 1 && saved.roads.edges.length === 2, 'the saved file holds the roads, shop name and features');

// test drive, then come back to the editor with everything still there
const keep = await ed();
await page.click('.ed-top button:has-text("Test drive: car")');
await waitBuilt(page);
ok(await page.evaluate(() => window.__loop.World.map.roads.edges.length) === 2, 'test drive builds the map that was edited');
await frames(page, 30);
await page.screenshot({ path: path.join(OUT, 'editor-testdrive.png') });
await page.evaluate(() => window.__v2.exitGame());
await page.waitForFunction(() => window.__v2.editor && !document.getElementById('scEditor').hidden);
const back = await ed();
ok(back.edges === keep.edges && back.pads === keep.pads && back.undo === keep.undo, 'leaving the test drive returns to the editor with the work and history intact');

// open a file with the editor
const hill = fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'));
await page.setInputFiles('#scEditor input[type="file"]', { name: 'hill.json', mimeType: 'application/json', buffer: hill });
await page.waitForFunction(() => window.__v2.editor.state.map.meta.id === 'hill-loop');
ok((await ed()).edges === 4, 'Open file loads Hill Loop into the editor');
await frames(page, 20);
await page.screenshot({ path: path.join(OUT, 'editor-hill.png') });
await page.setInputFiles('#scEditor input[type="file"]', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"x"}') });
await page.waitForTimeout(300);
ok((await ed()).name === 'Hill Loop Track', 'a bad file is refused and the map stays as it was');

// leave
await page.click('.ed-top button:has-text("Exit editor")');
await page.click('.ed-top button:has-text("Discard changes?")').catch(() => {});
await page.waitForFunction(() => !window.__v2.editor && !document.getElementById('scTitle').hidden, null, { timeout: 8000 }).catch(() => {});
ok(await page.evaluate(() => window.__v2.editor === null && document.querySelectorAll('canvas').length === 0 && document.getElementById('scEditor').childElementCount === 0), 'leaving the editor gives back its canvas and DOM');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
await ctx.close(); await browser.close(); srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall editor checks passed');
process.exit(failed ? 1 : 0);
