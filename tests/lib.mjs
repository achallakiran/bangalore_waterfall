// Shared helpers for the parity harness (Phase 0). Runs a browser against a page and records
// canvas screenshots, drive traces and world fingerprints in the same way for old and new builds.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REF = path.join(ROOT, 'tests', 'reference');

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    const d = fs.readdirSync(base).filter(n => n.startsWith('chromium-')).sort().pop();
    if (d) {
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch (e) {}
  return undefined; // fall back to Playwright's own browser registry
}

export async function launch() {
  return chromium.launch({
    executablePath: chromiumPath(),
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox']
  });
}

export function serve(dir, port = 0) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' })));
}

const THREE_LOCAL = path.join(ROOT, 'public', 'vendor', 'three.min.js');

export async function newPage(browser, { width = 900, height = 560 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('**/three.min.js', r => r.fulfill({ path: THREE_LOCAL, contentType: 'application/javascript' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  return { page, errors, ctx };
}

// Injected into both builds so the stage is the same size and overlays do not matter.
export const PARITY_CSS = `
#stage{position:fixed!important;left:0!important;top:0!important;width:900px!important;height:560px!important;border:0!important;border-radius:0!important;margin:0!important;z-index:99999!important}
.hud,.hint,.pad,.start,.busy,.top,.chips,.dock,.shell-ui,.fab,.screen{display:none!important}
`;

export async function waitBuilt(page, timeout = 180000) {
  await page.waitForFunction(() => window.__loop && window.__loop.HF && document.getElementById('busy').hidden, null, { timeout });
}

export async function setVoxel(page, cm) {
  await page.evaluate(v => { const e = document.getElementById('vox'); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); }, cm);
  await page.waitForTimeout(600);
  await waitBuilt(page);
}
export const frames = (page, n = 3) => page.evaluate(k => new Promise(res => { let i = 0; const f = () => (++i >= k ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

export async function setHour(page, h) {
  await page.evaluate(v => { const e = document.getElementById('tod'); e.value = String(v * 4); e.dispatchEvent(new Event('input', { bubbles: true })); }, h);
  await page.waitForTimeout(400);
}

export const SHOTS = [
  { name: 'overview-20cm-1630', vox: 20, hour: 16.5, play: false },
  { name: 'overview-20cm-0730', vox: 20, hour: 7.5, play: false },
  { name: 'overview-20cm-1930', vox: 20, hour: 19.5, play: false },
  { name: 'overview-25cm-1630', vox: 25, hour: 16.5, play: false },
  { name: 'chase-car-20cm-1630', vox: 20, hour: 16.5, play: true }
];

export async function captureShots(page, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  await page.addStyleTag({ content: PARITY_CSS });
  const files = [];
  let curVox = null;
  for (const s of SHOTS) {
    if (curVox !== s.vox) { await setVoxel(page, s.vox); curVox = s.vox; }
    await setHour(page, s.hour);
    if (s.play) {
      await page.evaluate(() => window.__loop.start('car'));
      // The chase camera swings round behind the car at a rate that depends on frame time, so let it settle fully (240 frames) before the picture is taken.
      await frames(page, 240);
    }
    await frames(page, 3);
    const f = path.join(outDir, s.name + '.png');
    await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 900, height: 560 }, animations: 'allow', timeout: 120000 });
    files.push(f);
  }
  return files;
}

// Everything runs inside one evaluate so no animation frame can interleave with the stepped simulation.
export async function captureDrives(page) {
  return page.evaluate(() => {
    const L = window.__loop, W = L.World, out = {};
    let seed = 12345; // pothole wobble direction uses Math.random: make it repeatable
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    L.state.traffic = false;
    ['nBike', 'nCar', 'nAuto'].forEach(k => L.A[k].root.position.set(9999, 0, 9999));
    L.NPC.forEach(n => { n.s = 9999; });
    const r3 = x => Math.round(x * 1000) / 1000;
    const drive = (kind, s0, u, v0, secs, throttle) => {
      L.setKind(kind);
      seed = 777;
      L.NPC.forEach(n => { n.s = 9999; });
      const tp = W.trackPoint(s0, u);
      Object.assign(L.P, { x: tp.x, z: tp.z, psi: tp.psi, v: v0, steer: 0, pitch: 0, roll: 0, jy: 0, jv: 0, wobA: 0, wobT: 9, wobRoll: 0, pot: 0, potMsg: 0, acc: 0 });
      L.P.y = L.gY(tp.x, tp.z);
      const ctl = { up: throttle, down: false, left: false, right: false, hb: false };
      const samples = [];
      for (let i = 0; i < secs * 120; i++) {
        const info = W.loopInfo(L.P.x, L.P.z), ah = W.trackPoint(info.s + 6, u);
        let ang = Math.atan2(-(ah.z - L.P.z), ah.x - L.P.x) - L.P.psi; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
        ctl.left = ang > 0.03; ctl.right = ang < -0.03;
        L.step(1 / 120, ctl);
        if (i % 60 === 59) samples.push([r3(L.P.v), r3(L.P.x), r3(L.P.z), r3(L.P.pitch)]);
      }
      return { pot: L.P.pot, samples };
    };
    out.flatCar = drive('car', 0.5, 1.0, 0, 4, true);
    out.climbCar = drive('car', 28, 1.0, 12, 3, true);
    out.climbBike = drive('bike', 28, 1.0, 14, 3, true);
    out.descentCar = drive('car', 120, 1.0, 8, 2, false);
    out.potholeCar = drive('car', 10, -1.0, 11, 2.5, true);
    out.potholeBike = drive('bike', 10, -1.0, 14, 2.5, true);
    // Lap counting: walk the car round the oval twice, then take a shortcut over a cross road (must not count).
    L.setKind('car');
    L.resetRun();
    const laps = [];
    for (let s = -2; s < 2 * W.LTOT + 4; s += 0.5) {
      const tp = W.trackPoint(s, 0);
      Object.assign(L.P, { x: tp.x, z: tp.z, psi: tp.psi, v: 8 });
      L.lapUpdate(0.5 / 8);
      if (Math.round(s * 2) % 20 === 0) laps.push(L.lap.n);
    }
    out.laps = { n: L.lap.n, trail: laps.slice(-6), last: r3(L.lap.last) };
    return out;
  });
}

export async function worldFingerprint(World, v = 0.2) {
  const fnv = (h, x) => { h ^= x; return Math.imul(h, 16777619) >>> 0; };
  const hashArr = (h, a) => { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i++) h = fnv(h, b[i]); return h; };
  const S = World.SLAB;
  let hh = 2166136261, kk = 2166136261, n = 0;
  for (let x = S.x0; x <= S.x1; x += 1) for (let z = S.z0; z <= S.z1; z += 1) {
    const y = Math.round(World.heightAt(x + 0.13, z + 0.07) * 1000);
    hh = fnv(hh, y & 0xffff); n++;
    const c = World.column(x + 0.13, z + 0.07, v); kk = fnv(kk, (c.kind | 0) + 1);
  }
  const g = await World.buildGround(v, () => Promise.resolve());
  let ph = 2166136261, ch = 2166136261;
  g.chunks.forEach(c => { ph = hashArr(ph, c.pos); ch = hashArr(ch, c.col); });
  return {
    voxel: v, lapLength: Math.round(World.LTOT * 1000) / 1000, potholes: World.POTS.length,
    potholeHash: fnv(2166136261, JSON.stringify(World.POTS).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)),
    samples: n, heightHash: hh, kindHash: kk, chunks: g.chunks.length, cubes: g.count, posHash: ph, colHash: ch
  };
}
