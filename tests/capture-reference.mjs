// Records the reference data from the frozen legacy Hill Loop Track page (tests/legacy). Run once; commit the output.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, REF, launch, newPage, waitBuilt, captureShots, captureDrives, worldFingerprint } from './lib.mjs';
import { pathToFileURL } from 'node:url';

fs.mkdirSync(REF, { recursive: true });
const legacyWorld = new Function(fs.readFileSync(path.join(ROOT, 'tools/legacy-src/world.js'), 'utf8') + '\nreturn World;')();
const fps = [];
for (const v of [0.2, 0.25]) fps.push(await worldFingerprint(legacyWorld, v));
fs.writeFileSync(path.join(REF, 'world.json'), JSON.stringify(fps, null, 1));
console.log('world fingerprints', fps.map(f => `${f.voxel}: ${f.cubes} cubes`).join(', '));

const browser = await launch();
const { page, errors } = await newPage(browser);
await page.goto(pathToFileURL(path.join(ROOT, 'tests/legacy/hill-loop-track.html')).href);
await waitBuilt(page);
const files = await captureShots(page, path.join(REF, 'shots'));
console.log('screenshots:', files.map(f => path.basename(f)).join(', '));
const drives = await captureDrives(page);
fs.writeFileSync(path.join(REF, 'drives.json'), JSON.stringify(drives, null, 1));
console.log('drives recorded:', Object.keys(drives).join(', '), 'laps', JSON.stringify(drives.laps));
if (errors.length) console.log('errors:', errors);
await browser.close();
