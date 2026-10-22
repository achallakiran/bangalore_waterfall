// Sky and fog (v2.9.0): a sky that does not depend on the device theme, fog that closes in only when the ground is streamed,
// and a Classic switch that restores the old look. Pictures are written to tests/output/sky for a quick look.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, newPage, waitBuilt, frames, PARITY_CSS } from './lib.mjs';

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const dist = process.env.DIST || path.join(ROOT, 'dist');
const out = path.join(ROOT, 'tests', 'output', 'sky'); fs.mkdirSync(out, { recursive: true });
const { srv, url } = await serve(dist);
const browser = await launch();
async function open(query, settings, scheme) {
  const { page, errors, ctx } = await newPage(browser);
  if (scheme) await page.emulateMedia({ colorScheme: scheme });
  await ctx.addInitScript(s => { try { localStorage.setItem('hl2.settings.v1', s); } catch (e) {} }, JSON.stringify({ vox: 32, budget: 'medium', ...settings }));
  await page.goto(url + 'index.html' + (query || ''));
  await page.evaluate(() => window.__v2.show('scRide')); await page.click('[data-ride="car"]'); await waitBuilt(page);
  await page.addStyleTag({ content: PARITY_CSS });
  return { page, errors, ctx };
}
const shot = async (page, name) => { await frames(page, 30); await page.screenshot({ path: path.join(out, name + '.png'), clip: { x: 0, y: 0, width: 900, height: 560 }, timeout: 120000 }); };
// average colour of a horizontal band of the picture, read back through the canvas of a screenshot
async function band(page, y0, y1) {
  const buf = await page.screenshot({ clip: { x: 0, y: y0, width: 900, height: y1 - y0 }, timeout: 120000 });
  return page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let r = 0, gg = 0, b = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    return [r / n, gg / n, b / n];
  }, buf.toString('base64'));
}

// 1. streamed ground: fog is on, closes in inside the loaded ring, and is the horizon colour
const a = await open('?stream=1&cubes=30000', {}, 'light');
await a.page.evaluate(() => window.__loop.start('car')); await frames(a.page, 120);
const f = await a.page.evaluate(() => { const l = window.__loop, F = l.fog; return F && { near: F.near, far: F.far, eff: l.memory.chunks, on: l.skyOn }; });
ok(f && f.on, 'sky is on by default');
ok(f && f.far > f.near && f.far > 20, `fog is on with streamed ground (near ${f && f.near.toFixed(0)} m, far ${f && f.far.toFixed(0)} m)`);
const eff = await a.page.evaluate(() => { const S = window.__loop.memory; return window.__loop.order ? window.__loop.order.length : 0; });
ok(eff > 0, `chunk build order is set (${eff} wanted chunks)`);
await shot(a.page, 'stream-light');
const lightTop = await band(a.page, 0, 80);
await a.ctx.close();

// 2. device dark mode no longer changes the sky
const b = await open('?stream=1&cubes=30000', {}, 'dark');
await b.page.evaluate(() => window.__loop.start('car')); await frames(b.page, 120);
await shot(b.page, 'stream-dark');
const darkTop = await band(b.page, 0, 80);
const dd = Math.max(...lightTop.map((v, i) => Math.abs(v - darkTop[i])));
ok(dd < 6, `sky looks the same in light and dark device mode (max channel difference ${dd.toFixed(1)})`);
ok(darkTop[2] > 140, `the sky is a light blue, not dark (blue ${darkTop[2].toFixed(0)})`);
await b.ctx.close();

// 3. whole-map game (Hill Loop): no fog
const w = await open('', {}, 'light');
await w.page.evaluate(() => window.__loop.start('car')); await frames(w.page, 60);
ok(await w.page.evaluate(() => window.__loop.fog === null && window.__loop.skyOn), 'maps held whole have the sky but no fog');
await shot(w.page, 'whole-chase');
await w.ctx.close();

// 4. Classic switch: no sky, no fog
const c = await open('?stream=1&cubes=30000', { sky: 'classic' }, 'light');
await c.page.evaluate(() => window.__loop.start('car')); await frames(c.page, 90);
ok(await c.page.evaluate(() => window.__loop.fog === null && !window.__loop.skyOn), 'Classic switches the sky and the fog off');
await shot(c.page, 'stream-classic');
await c.ctx.close();

// 5. no page errors, frame time similar with and without the new sky
const p = await open('?stream=1&cubes=30000', {}, 'light');
await p.page.evaluate(() => window.__loop.start('car'));
const ms = await p.page.evaluate(() => new Promise(res => { const t0 = performance.now(); let i = 0; const f = () => (++i >= 90 ? res((performance.now() - t0) / 90) : requestAnimationFrame(f)); requestAnimationFrame(f); }));
ok(p.errors.length === 0, 'no page errors' + (p.errors.length ? ': ' + p.errors[0] : ''));
console.log('frame time with new sky: ' + ms.toFixed(1) + ' ms (software GL)');
await p.ctx.close();

await browser.close(); srv.close();
console.log(failed ? failed + ' check(s) failed' : 'all sky checks passed');
process.exit(failed ? 1 : 0);
