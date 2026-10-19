// Saves the car and bike thumbnails drawn by the legacy page, so the ride picker can show them before any game is loaded.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, launch, newPage } from '../tests/lib.mjs';
const browser = await launch();
const { page } = await newPage(browser);
await page.goto(pathToFileURL(path.join(ROOT, 'tests/legacy/hill-loop-track.html')).href);
await page.waitForFunction(() => document.getElementById('thCar') && document.getElementById('thBike'));
await page.waitForTimeout(500);
for (const [id, name] of [['thCar', 'car'], ['thBike', 'bike']]) {
  const url = await page.evaluate(i => document.getElementById(i).toDataURL('image/png'), id);
  fs.writeFileSync(path.join(ROOT, 'public/previews', name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
}
await browser.close();
console.log('thumbnails saved');
