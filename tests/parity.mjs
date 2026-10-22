// Parity: the built v2 game must look and drive like the frozen legacy build.
//  - drive traces must match exactly (numbers rounded to 3 decimals)
//  - screenshots must match within a tiny tolerance (software rendering is deterministic, so this is strict)
// Needs a build in ./dist (npm run build) and a Chromium (set CHROMIUM_PATH or install via playwright).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, REF, launch, newPage, serve, waitBuilt, captureShots, captureDrives, SHOTS } from './lib.mjs';

const OUT = path.join(ROOT, 'tests', 'output');
fs.mkdirSync(OUT, { recursive: true });
const MAX_BAD_FRAC = Number(process.env.PARITY_MAX_BAD_FRAC || 0.002);   // share of pixels differing by more than 8/255
const MAX_MEAN = Number(process.env.PARITY_MAX_MEAN || 0.3);             // mean absolute difference per channel (0..255)

let failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) failed++; };

const { srv, url } = await serve(path.join(ROOT, 'dist'));
const browser = await launch();
const { page, errors, ctx } = await newPage(browser);
// The pictures are compared with the original game, which has the flat page sky and no fog: use Classic for this check.
await ctx.addInitScript(() => { try { localStorage.setItem('hl2.settings.v1', JSON.stringify({ sky: 'classic' })); } catch (e) {} });
await page.goto(url + 'index.html?parity=1');
await waitBuilt(page);
ok(true, 'v2 game built in parity mode');

const files = await captureShots(page, path.join(OUT, 'shots'));
const ref = JSON.parse(fs.readFileSync(path.join(REF, 'drives.json'), 'utf8'));
const now = await captureDrives(page);
for (const k of Object.keys(ref)) ok(JSON.stringify(now[k]) === JSON.stringify(ref[k]), `drive trace "${k}" identical to legacy`);

const cmp = await browser.newPage();
for (const s of SHOTS) {
  const a = fs.readFileSync(path.join(REF, 'shots', s.name + '.png')).toString('base64');
  const b = fs.readFileSync(path.join(OUT, 'shots', s.name + '.png')).toString('base64');
  const r = await cmp.evaluate(async ([a, b]) => {
    const load = async d => { const i = new Image(); i.src = 'data:image/png;base64,' + d; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
    const A = await load(a), B = await load(b);
    if (A.width !== B.width || A.height !== B.height) return { size: false };
    let sum = 0, bad = 0, n = A.width * A.height;
    for (let p = 0; p < n; p++) {
      let m = 0;
      for (let c = 0; c < 3; c++) { const d = Math.abs(A.data[p * 4 + c] - B.data[p * 4 + c]); sum += d; if (d > m) m = d; }
      if (m > 8) bad++;
    }
    return { size: true, mean: sum / (n * 3), bad: bad / n };
  }, [a, b]);
  ok(r.size && r.bad <= MAX_BAD_FRAC && r.mean <= MAX_MEAN, `screenshot ${s.name}: ${r.size ? `mean diff ${r.mean.toFixed(3)}, ${(r.bad * 100).toFixed(3)}% pixels differ` : 'size mismatch'}`);
}
const real = errors.filter(e => !/font/i.test(e));
ok(real.length === 0, 'no page errors' + (real.length ? ': ' + real.join(' | ') : ''));
await browser.close(); srv.close();
console.log(failed ? `\n${failed} parity check(s) failed` : '\nParity passed');
process.exit(failed ? 1 : 0);
