// Shell, controls and teardown checks in a real browser (software GL). Screenshots go to tests/output/shell.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, waitBuilt } from './lib.mjs';

const OUT = path.join(ROOT, 'tests', 'output', 'shell');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };

const { srv, url } = await serve(path.join(ROOT, 'dist'));
const browser = await launch();

async function session(name, opts) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  await page.goto(url + 'index.html');
  return { page, errors, ctx, shot: f => page.screenshot({ path: path.join(OUT, name + '-' + f + '.png') }) };
}
const vis = (page, id) => page.evaluate(i => !document.getElementById(i).hidden, id);

// ---------- Desktop ----------
{
  const { page, errors, shot } = await session('desktop', { viewport: { width: 1280, height: 780 }, colorScheme: 'light', reducedMotion: 'reduce' });
  await shot('title');
  ok(await vis(page, 'scTitle'), 'desktop: title screen shows first');
  ok(await page.evaluate(() => !window.__loop && document.getElementById('gameRoot').childElementCount === 0), 'desktop: no game is loaded before Play (nothing in memory)');
  await page.click('#mMaps'); await shot('maps');
  await page.click('[data-back]:visible'); await page.click('#mSettings'); await shot('settings');
  await page.click('[data-seg="units"] [data-val="mph"]');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('hl2.settings.v1')).units === 'mph'), 'desktop: settings persist to localStorage');
  await page.click('[data-back]:visible');
  await page.click('#mPlay'); await shot('ride');
  await page.click('[data-ride="car"]');
  await waitBuilt(page);
  await page.waitForTimeout(1500);
  await shot('play');
  ok(await page.evaluate(() => document.getElementById('unit').textContent) === 'mph', 'desktop: mph setting reaches the HUD');
  ok(await page.evaluate(() => window.__loop.state.phase) === 'play', 'desktop: game is in play');
  // keyboard drive
  await page.keyboard.down('w');
  // Software rendering draws only a few frames a second, so wait for the speed to rise instead of a fixed delay.
  await page.waitForFunction(() => window.__loop.P.v > 0.3, null, { timeout: 90000 }).catch(() => {});
  const v1 = await page.evaluate(() => window.__loop.P.v);
  await page.keyboard.up('w');
  ok(v1 > 0.3, `desktop: W accelerates the car (v=${v1.toFixed(2)} m/s)`);
  // text selection cannot start on the stage
  await page.mouse.dblclick(120, 60);
  ok(await page.evaluate(() => window.getSelection().toString() === ''), 'desktop: double-click on the HUD selects no text');
  // pause menu
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => window.__v2.paused) && await vis(page, 'scPause'), 'desktop: Esc pauses and shows the menu');
  const vp = await page.evaluate(() => window.__loop.P.v);
  await page.waitForTimeout(600);
  ok(Math.abs((await page.evaluate(() => window.__loop.P.v)) - vp) < 1e-6, 'desktop: simulation is frozen while paused');
  await shot('pause');
  await page.click('#pSettings'); ok(await vis(page, 'scSettings'), 'desktop: Settings opens from pause');
  await page.click('[data-back]:visible'); ok(await vis(page, 'scPause'), 'desktop: Back returns to the pause menu');
  await page.click('#pResume'); ok(!(await page.evaluate(() => window.__v2.paused)), 'desktop: Resume continues');
  // exit and teardown
  await page.keyboard.press('Escape'); await page.click('#pExit');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !window.__loop && document.getElementById('gameRoot').childElementCount === 0 && document.querySelectorAll('canvas').length === 0), 'desktop: exit removes the game, its canvas and its debug handle');
  ok(await vis(page, 'scTitle'), 'desktop: back on the title screen');
  await page.keyboard.press('c'); await page.keyboard.press('r'); await page.keyboard.press('w');
  ok(errors.length === 0, 'desktop: no page errors' + (errors.length ? ' - ' + errors.join(' | ') : ''));
}

// ---------- Maps: files are validated, only the chosen map is held ----------
{
  const { page, errors } = await session('maps', { viewport: { width: 1000, height: 700 }, colorScheme: 'light', reducedMotion: 'reduce' });
  ok(await page.evaluate(() => window.__v2.maps.current === null), 'maps: no map is held before a game starts');
  await page.click('#mMaps');
  await page.setInputFiles('#mapFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"hill-loop-map","version":1}') });
  await page.waitForFunction(() => !document.getElementById('mapMsg').hidden);
  ok(/cannot be used/.test(await page.textContent('#mapMsg')) && await vis(page, 'scMaps'), 'maps: a broken map file shows a clear reason and stays on the Maps screen');
  ok(await page.evaluate(() => window.__v2.maps.current === null), 'maps: a refused file leaves nothing loaded');
  await page.setInputFiles('#mapFile', { name: 'notjson.json', mimeType: 'application/json', buffer: Buffer.from('hello') });
  await page.waitForFunction(() => /not valid JSON/.test(document.getElementById('mapMsg').textContent));
  ok(true, 'maps: a file that is not JSON is explained');
  const good = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/maps/hill-loop.json'), 'utf8'));
  good.meta.id = 'test-copy'; good.meta.name = 'Test Copy'; good.meta.description = 'A copy used by the tests.';
  await page.setInputFiles('#mapFile', { name: 'copy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
  await page.waitForFunction(() => !document.getElementById('scRide').hidden);
  ok(/Test Copy/.test(await page.textContent('#rideText')), 'maps: a valid map file opens the ride screen with its name');
  await page.click('[data-ride="car"]');
  await waitBuilt(page);
  ok(await page.evaluate(() => window.__loop.World.map.meta.name) === 'Test Copy', 'maps: the game is built from the opened file');
  await page.evaluate(() => window.__v2.exitGame());
  ok(await page.evaluate(() => window.__v2.maps.current === null && !window.__loop), 'maps: leaving the game releases the map and the game');
  await page.click('#mMaps'); await page.click('[data-map="hill"]'); await page.click('[data-ride="bike"]');
  await waitBuilt(page);
  ok(await page.evaluate(() => window.__loop.World.map.meta.name) === 'Hill Loop Track', 'maps: the built-in map is fetched again when chosen');
  await page.evaluate(() => window.__v2.exitGame());
  ok(errors.length === 0, 'maps: no page errors' + (errors.length ? ' ' + errors[0] : ''));
}

// ---------- Phone (touch, dark theme) ----------
{
  const { page, errors, shot } = await session('phone', { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', reducedMotion: 'reduce' });
  await shot('title');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: no sideways scroll on the title');
  await page.tap('#mPlay'); await page.tap('[data-ride="bike"]');
  await waitBuilt(page); await page.waitForTimeout(1500);
  await shot('play');
  ok(await page.evaluate(() => document.getElementById('pad').classList.contains('on')), 'phone: touch pad turns on by itself');
  const pads = await page.evaluate(() => ['pG', 'pB', 'pL', 'pR'].map(id => { const b = document.getElementById(id), r = b.getBoundingClientRect(), s = getComputedStyle(b); return { id, w: Math.round(r.width), txt: b.textContent.trim(), sel: s.userSelect || s.webkitUserSelect }; }));
  ok(pads.every(p => p.txt === '' && p.sel === 'none' && p.w >= 64), 'phone: pad buttons are icon-only, no-select and at least 64 px: ' + JSON.stringify(pads.map(p => p.w)));
  // two fingers at once: gas + left, through real pointer events
  const press = (id, pid) => page.evaluate(([id, pid]) => { const b = document.getElementById(id), r = b.getBoundingClientRect(); b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: pid, pointerType: 'touch', bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); }, [id, pid]);
  const lift = (id, pid) => page.evaluate(([id, pid]) => { document.getElementById(id).dispatchEvent(new PointerEvent('pointerup', { pointerId: pid, pointerType: 'touch', bubbles: true })); }, [id, pid]);
  await press('pG', 11); await press('pL', 12);
  let c = await page.evaluate(() => window.__loop.inp());
  ok(c.up && c.left, 'phone: gas and steer work together with two fingers');
  await lift('pL', 12);
  c = await page.evaluate(() => window.__loop.inp());
  ok(c.up && !c.left, 'phone: lifting one finger leaves the other control held');
  await lift('pG', 11);
  c = await page.evaluate(() => window.__loop.inp());
  ok(!c.up && !c.left, 'phone: lifting all fingers releases everything');
  // a held control must not stick when the page goes to the background
  await press('pG', 21);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  c = await page.evaluate(() => window.__loop.inp());
  ok(!c.up, 'phone: backgrounding the page clears held controls');
  ok(await page.evaluate(() => window.__v2.paused), 'phone: backgrounding the page pauses the game');
  // selection / context menu
  const guarded = await page.evaluate(() => { const ev = new Event('contextmenu', { bubbles: true, cancelable: true }); document.getElementById('pG').dispatchEvent(ev); const ev2 = new Event('selectstart', { bubbles: true, cancelable: true }); document.querySelector('.hud .pill').dispatchEvent(ev2); return ev.defaultPrevented && ev2.defaultPrevented; });
  ok(guarded, 'phone: context menu and text selection are blocked on the stage');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: no sideways scroll while playing');
  await shot('paused');
  ok(errors.length === 0, 'phone: no page errors' + (errors.length ? ' - ' + errors.join(' | ') : ''));
}

await browser.close(); srv.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nShell checks passed');
process.exit(failed ? 1 : 0);
