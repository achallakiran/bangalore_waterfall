// Map editor 2 (N1): floating undo/redo, a map that grows, saved map slots that survive leaving and coming back.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, frames } from './lib.mjs';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const OUT = path.join(ROOT, 'tests', 'output'); fs.mkdirSync(OUT, { recursive: true });
const { srv, url } = await serve(process.env.DIST || path.join(ROOT, 'dist'));
const browser = await launch();
// a phone-sized window: the buttons must be on the map itself, not in the top bar
const { page, errors, ctx } = await newPage(browser, { width: 390, height: 780 });
await page.goto(url + 'index.html');
const map = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__v2.editor.state.map)));
const at = (x, z) => page.evaluate(([x, z]) => window.__v2.editor.toClient(x, z), [x, z]);
const idle = () => page.waitForFunction(() => { const v = window.__v2.editor.view3d; return !v || (v.stats().pending === 0 && !v.building); }, null, { timeout: 120000 });
const open = async () => {
  await page.click('#mEditor'); await page.waitForSelector('#scEditor canvas', { timeout: 60000 });
  await page.waitForFunction(() => window.__v2.editor && window.__v2.editor.view3d && window.__v2.editor.view3d.stats().cubes > 2000, null, { timeout: 120000 }); await idle();
};
await open();

// ---- floating buttons ----
const vis = async sel => { const b = await page.$(sel); if (!b) return false; const r = await b.boundingBox(); const vp = page.viewportSize(); return !!r && r.x >= 0 && r.y >= 0 && r.x + r.width <= vp.width && r.y + r.height <= vp.height && r.width >= 40 && r.height >= 40; };
ok(await vis('.e2-fabbtn[data-act="undo"]') && await vis('.e2-fabbtn[data-act="redo"]') && await vis('.e2-fabbtn[data-act="maps"]'), 'Undo, Redo and Maps buttons are on the map, fully on screen, at least 40 px, on a phone-sized window');
ok(await page.$eval('.e2-fabbtn[data-act="undo"]', b => b.disabled) && await page.$eval('.e2-fabbtn[data-act="redo"]', b => b.disabled), 'Undo and Redo start disabled');

// ---- growing: put a tree 8 m past the east edge ----
const s0 = (await map()).slab;
await page.click('.ed-tab:has-text("Roadside")'); await page.click('.ed-tool[data-tile="t-small"]');
const x = s0.x1 + 8, z = (s0.z0 + s0.z1) / 2;
const [cx, cy] = await at(x, z);
await page.mouse.click(cx, cy); await idle();
const m1 = await map(), s1 = m1.slab;
ok(s1.x1 > s0.x1 && s1.x1 >= x + 24 && s1.x0 === s0.x0, `placing a tree past the east edge grows the map (${s0.x1} to ${s1.x1})`);
ok(m1.scenery.some(q => q.t === 'tree' && Math.abs(q.x - x) < 3), 'the tree was placed there');
ok(!(await page.$eval('.e2-fabbtn[data-act="undo"]', b => b.disabled)), 'Undo is enabled after an edit');
ok(/tree/i.test(await page.$eval('.e2-fabbtn[data-act="undo"]', b => b.title)), 'Undo says what it will undo: ' + await page.$eval('.e2-fabbtn[data-act="undo"]', b => b.title));
await page.click('.e2-fabbtn[data-act="undo"]'); await idle();
const m2 = await map();
ok(m2.slab.x1 === s0.x1 && !m2.scenery.some(q => q.t === 'tree' && Math.abs(q.x - x) < 3), 'Undo removes the tree and shrinks the map back in one step');
ok(!(await page.$eval('.e2-fabbtn[data-act="redo"]', b => b.disabled)), 'Redo is enabled after Undo');
await page.click('.e2-fabbtn[data-act="redo"]'); await idle();
ok((await map()).slab.x1 === s1.x1, 'Redo brings the tree and the bigger map back');

// ---- fit ----
await page.evaluate(() => window.__v2.editor.commit(m => { m.slab.x1 += 120; return true; }, true, null, 'Test grow'));
await idle();
const wide = (await map()).slab; await page.click('button:has-text("Fit map to content")'); await idle();
const fitd = (await map()).slab;
ok(fitd.x1 - fitd.x0 < wide.x1 - wide.x0, 'Fit map to content trims empty ground');

// ---- slots ----

await page.waitForFunction(() => document.querySelector('.e2-saved')?.textContent === 'Saved', null, { timeout: 10000 }).catch(() => {});
await page.click('.e2-fabbtn[data-act="maps"]');
await page.waitForSelector('.e2-slot', { timeout: 10000 });
ok(await page.$$eval('.e2-slot', r => r.length) === 1, 'the Maps panel lists the map that is being edited, saved automatically');
ok(await page.$eval('.e2-slot', r => /open now/.test(r.textContent)), 'the open map is marked');
const nameBefore = (await map()).meta.name;
await page.screenshot({ path: path.join(OUT, 'editor2-maps.png') });
await page.click('.e2-phead button');
// leave and come back: the map is still there
await page.click('.ed-top button:has-text("Exit editor")');
await page.waitForFunction(() => window.__v2.editor === null, null, { timeout: 10000 });
await page.reload(); await page.waitForSelector('#mEditor');
await open();
await page.waitForSelector('.e2-offer button', { timeout: 10000 });
ok(/Continue/.test(await page.$eval('.e2-offer button', b => b.textContent)), 'coming back offers to continue the saved map');
await page.click('.e2-offer button');
await page.waitForFunction(() => window.__v2.editor.state.slotId, null, { timeout: 10000 }); await idle();
const m3 = await map();
ok(m3.meta.name === nameBefore && m3.slab.x1 === fitd.x1 && m3.scenery.some(q => q.t === 'tree'), 'the continued map has its tree and its size');
// copy, rename and delete
await page.click('.e2-fabbtn[data-act="maps"]'); await page.waitForSelector('.e2-slot');
await page.click('.e2-slot button:has-text("Copy")'); await page.waitForFunction(() => document.querySelectorAll('.e2-slot').length === 2, null, { timeout: 8000 });
ok(true, 'Copy makes a second slot');
await page.click('.e2-slot:not(:has-text("open now")) button:has-text("Delete")'); await page.click('.e2-slot:not(:has-text("open now")) button:has-text("Sure?")');
await page.waitForFunction(() => document.querySelectorAll('.e2-slot').length === 1, null, { timeout: 8000 });
ok(true, 'Delete (two taps) removes the other slot');
await page.click('.e2-phead button');

// ---- the stable editor still opens and has its own storage ----
await page.click('.ed-top button:has-text("Exit editor")'); await page.waitForFunction(() => window.__v2.editor === null, null, { timeout: 10000 });
await page.click('#mEditorClassic'); await page.waitForSelector('#scEditor canvas', { timeout: 60000 });
ok(await page.evaluate(() => !document.querySelector('.e2-fab')), 'the stable editor has none of the new buttons');
await page.waitForFunction(() => window.__v2.editor && window.__v2.editor.view3d && window.__v2.editor.view3d.stats().cubes > 2000, null, { timeout: 120000 });
await page.click('.ed-top button:has-text("Exit editor")'); await page.waitForFunction(() => window.__v2.editor === null, null, { timeout: 10000 });
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
await ctx.close(); await browser.close(); srv.close();
console.log(failed ? `\n${failed} FAILED` : '\nall editor 2 checks passed');
process.exit(failed ? 1 : 0);
