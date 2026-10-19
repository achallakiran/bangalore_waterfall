// Memory soak: start and leave the game several times and check that everything is given back.
// After each cycle (and a forced garbage collection) the JS heap, DOM nodes and event listeners must settle, and no canvas, map or game may stay behind.
import path from 'node:path';
import { ROOT, launch, serve, waitBuilt } from './lib.mjs';

const CYCLES = Number(process.env.SOAK_CYCLES || 5);
const GROWTH_LIMIT = Number(process.env.SOAK_HEAP_GROWTH || 0.15);   // allowed heap growth from cycle 2 to the last cycle
let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };
const mb = n => (n / 1048576).toFixed(1) + ' MB';

const { srv, url } = await serve(path.join(ROOT, 'dist'));
const browser = await launch();
const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 900, height: 620 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => { try { localStorage.setItem('hl2.settings.v1', JSON.stringify({ vox: 32 })); } catch (e) {} });   // a coarse voxel keeps each cycle quick on software rendering
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await page.goto(url + 'index.html');

async function sample() {
  await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const live = await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, loop: !!window.__loop, map: window.__v2.maps.current !== null, root: document.getElementById('gameRoot').childElementCount }));
  return { heap: m.JSHeapUsedSize, nodes: m.Nodes, listeners: m.JSEventListeners, ...live };
}

const base = await sample();
console.log(`baseline: heap ${mb(base.heap)}, ${base.nodes} nodes, ${base.listeners} listeners`);
const after = [];
for (let i = 1; i <= CYCLES; i++) {
  await page.evaluate(() => window.__v2.show('scRide'));
  await page.click(i % 2 ? '[data-ride="car"]' : '[data-ride="bike"]');
  await waitBuilt(page);
  const inGame = await sample();
  ok(inGame.canvases >= 1 && inGame.map, `cycle ${i}: game running, map held (heap ${mb(inGame.heap)})`);
  await page.evaluate(() => window.__v2.exitGame());
  await page.waitForTimeout(300);
  const s = await sample(); after.push(s);
  ok(s.canvases === 0 && !s.loop && !s.map && s.root === 0, `cycle ${i}: after leaving, no canvas, game, map or game DOM is left (heap ${mb(s.heap)}, ${s.nodes} nodes, ${s.listeners} listeners)`);
}
const first = after[1] || after[0], last = after[after.length - 1];
ok(last.nodes <= first.nodes + 2, `DOM nodes stay flat across cycles (cycle 2: ${first.nodes}, cycle ${CYCLES}: ${last.nodes}; start ${base.nodes})`);
ok(last.listeners <= first.listeners, `event listeners stay flat across cycles (cycle 2: ${first.listeners}, cycle ${CYCLES}: ${last.listeners}; start ${base.listeners}, the test driver adds some of its own)`);
const growth = (last.heap - first.heap) / first.heap;
ok(growth <= GROWTH_LIMIT, `heap does not keep growing: cycle 2 ${mb(first.heap)}, cycle ${CYCLES} ${mb(last.heap)} (${(growth * 100).toFixed(1)}%, limit ${GROWTH_LIMIT * 100}%)`);
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));
await browser.close(); srv.close();
console.log(failed ? `\n${failed} soak check(s) failed` : '\nSoak passed');
process.exit(failed ? 1 : 0);
