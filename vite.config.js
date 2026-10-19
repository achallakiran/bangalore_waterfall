import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const BUILD_DATE = new Date().toISOString().slice(0, 10);

// Writes dist/sw.js: pre-caches every built file so the game runs offline, versioned by a hash of the file list.
function swPlugin() {
  let outDir = 'dist';
  return {
    name: 'hl2-service-worker',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const root = path.resolve(outDir);
      const files = [];
      (function walk(d) {
        for (const n of fs.readdirSync(d)) {
          const p = path.join(d, n);
          if (fs.statSync(p).isDirectory()) walk(p); else files.push(path.relative(root, p).split(path.sep).join('/'));
        }
      })(root);
      const list = files.filter(f => f !== 'sw.js').sort();
      const h = crypto.createHash('sha1');
      list.forEach(f => { h.update(f); h.update(fs.readFileSync(path.join(root, f))); });
      const version = pkg.version + '-' + h.digest('hex').slice(0, 10);
      const tpl = fs.readFileSync(new URL('./tools/sw-template.js', import.meta.url), 'utf8');
      const precache = ['./', ...list.map(f => './' + f)];
      fs.writeFileSync(path.join(root, 'sw.js'), tpl.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)));
      console.log(`service worker ${version}: ${precache.length} files precached`);
    }
  };
}

export default defineConfig({
  base: './', // relative paths: works from any github.io subpath without configuration
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_DATE__: JSON.stringify(BUILD_DATE) },
  build: { target: 'es2020', chunkSizeWarningLimit: 800 },
  plugins: [swPlugin()]
});
