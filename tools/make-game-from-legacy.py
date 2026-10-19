#!/usr/bin/env python3
"""HISTORICAL, do not run again (it would overwrite the Phase 2 data-driven code). One-time provenance script: builds src/game/hill-loop/{world.js,game.js} from the
frozen legacy sources in tools/legacy-src (copied unchanged from the published Hill Loop
Track build). After this ran, game.js is the maintained source; legacy files are never edited.
Transformations are limited to: ES-module wrapper, cleanup hooks (listeners, rAF, build
cancel), pause flag, speed units, and the rewritten touch-pad button handler."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
L = root / 'tools' / 'legacy-src'
out = root / 'src' / 'game' / 'hill-loop'
out.mkdir(parents=True, exist_ok=True)

world = (L / 'world.js').read_text()
(out / 'world.js').write_text(world.rstrip() + '\n\nexport { World };\n')

main = (L / 'main_v1.js').read_text().split('\n')
core = '\n'.join(main[2:79])
veh = '\n'.join(main[320:376])
scen = (L / 'scenery.js').read_text()
rt = (L / 'runtime.js').read_text()

def must(s, old, new, count=1):
    assert s.count(old) >= 1, 'missing: ' + old[:60]
    return s.replace(old, new) if count == 0 else s.replace(old, new, count)

# --- hooks on runtime ---
rt = re.sub(r'window\.addEventListener\(', 'on(window, ', rt)
rt = must(rt, "if (window.ResizeObserver) new ResizeObserver(resize).observe($('stage'));",
          "const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;\nif (ro) ro.observe($('stage'));")
rt = must(rt, 'function frame(now) {\n', 'function frame(now) {\n  if (!alive) return;\n  if (state.paused) { last = now; rafId = requestAnimationFrame(frame); return; }\n')
rt = rt.replace('requestAnimationFrame(frame);', 'rafId = requestAnimationFrame(frame);')
rt = rt.replace('rafId = rafId = ', 'rafId = ')
rt = must(rt, "setText('spd', String(Math.round(Math.abs(P.v) * 3.6)));",
          "setText('spd', String(Math.round(Math.abs(P.v) * (hooks.units === 'mph' ? 2.23694 : 3.6))));")
# state: add paused
rt = must(rt, "phase: 'menu', pad: false, sound: false };", "phase: 'menu', pad: false, sound: false, paused: false };")


# settings hooks: initial hour, traffic, lite and voxel size chosen by the shell
rt = must(rt, "const state = { hour: 16.5, traffic: !reduced, orbit: false, lite: window.innerWidth < 700,",
          "const state = { hour: hooks.hour !== undefined ? hooks.hour : 16.5, traffic: hooks.traffic !== undefined ? hooks.traffic : !reduced, orbit: false, lite: hooks.lite !== undefined ? hooks.lite : window.innerWidth < 700,")
rt = must(rt, "if (state.lite) { $('vox').value = 25; $('voxOut').textContent = '25 cm'; }",
          "if (hooks.vox) { $('vox').value = hooks.vox; $('voxOut').textContent = hooks.vox + ' cm'; } else if (state.lite) { $('vox').value = 25; $('voxOut').textContent = '25 cm'; }\n$('tod').value = String(Math.round(state.hour * 4)); $('todOut').textContent = clockLabel(state.hour);")

# new per-pointer touch pad handler
old_start = rt.index('function holdBtn(id, key) {')
old_end = rt.index("holdBtn('pG', 'gas');")
new_hold = '''// Touch pad: each button tracks its own pointers, so two fingers (gas + steer) never interfere,
// and nothing sticks if a finger slides off, a second finger lands, or the page loses focus.
const padHeld = { gas: new Set(), brk: new Set(), l: new Set(), r: new Set() };
function holdBtn(id, key) {
  const b = $(id), held = padHeld[key];
  const sync = () => { pad[key] = held.size > 0; b.classList.toggle('down', pad[key]); };
  const on = e => {
    e.preventDefault(); e.stopPropagation();
    held.add(e.pointerId); sync();
    try { b.setPointerCapture(e.pointerId); } catch (x) {}
    if (navigator.vibrate && e.pointerType === 'touch') { try { navigator.vibrate(6); } catch (x) {} }
  };
  const off = e => { held.delete(e.pointerId); sync(); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('lostpointercapture', off);
  ['contextmenu', 'selectstart', 'dragstart', 'touchstart'].forEach(t => b.addEventListener(t, e => e.preventDefault(), { passive: false }));
}
const clearPad = () => { Object.keys(padHeld).forEach(k => { padHeld[k].clear(); pad[k] = false; }); document.querySelectorAll('.pad button').forEach(b => b.classList.remove('down')); };
on(document, 'visibilitychange', () => { if (document.hidden) { keys.clear(); clearPad(); } });
'''
rt = rt[:old_start] + new_hold + rt[old_end:]
rt = must(rt, "on(window, 'blur', () => { keys.clear(); pad.gas = pad.brk = pad.l = pad.r = false; });",
          "on(window, 'blur', () => { keys.clear(); clearPad(); });")
# stage-level selection / callout guards
rt = must(rt, "canvas.addEventListener('pointerdown', e => {",
          "['contextmenu', 'selectstart', 'dragstart'].forEach(t => $('stage').addEventListener(t, e => e.preventDefault()));\ncanvas.addEventListener('pointerdown', e => {")

# tail: replace debug handle with api + dispose
tail_old = "window.__loop = { P, lap, state, SOLIDS, World, start, setCam, keys, A, gY, NPC, VEH, get HF() { return HF; }, potholeHit, setKind, step, inp, resetRun, lapUpdate };"
assert tail_old in rt
tail_new = '''const api = {
  start, setCam, setKind, resetRun,
  get state() { return state; },
  get kind() { return kind; },
  get built() { return !!HF; },
  setPaused(p) { state.paused = !!p; if (p) { keys.clear(); clearPad(); } },
  resize
};
function dispose() {
  alive = false; buildId++;
  cancelAnimationFrame(rafId); clearTimeout(rebuildTimer);
  _L.forEach(([t, e, f, o]) => t.removeEventListener(e, f, o)); _L.length = 0;
  try { audioOff(); if (actx) actx.close(); } catch (e) {}
  try { if (ro) ro.disconnect(); } catch (e) {}
  try {
    scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      if (o.shadow && o.shadow.map) o.shadow.map.dispose();
    });
    renderer.dispose();
    renderer.forceContextLoss();
  } catch (e) {}
  if (window.__loop === dbg) delete window.__loop;
}
const dbg = { P, lap, state, SOLIDS, World, start, setCam, keys, A, gY, NPC, VEH, get HF() { return HF; }, potholeHit, setKind, step, inp, resetRun, lapUpdate };
window.__loop = dbg;
return { api, dispose, debug: dbg };'''
rt = rt.replace(tail_old, tail_new)

header = '''// Hill Loop Track game core, carried over unchanged from the published v1 build (see tools/make-game-from-legacy.py).
// Rendering, shading, physics and world are frozen; only the listed hooks differ (mount/dispose, pause, units, touch pad).
import { World } from './world.js';

const THREE = window.THREE;
export function boot(hooks) {
'use strict';
hooks = hooks || {};
let alive = true, rafId = 0;
const _L = [];
const on = (t, e, f, o) => { t.addEventListener(e, f, o); _L.push([t, e, f, o]); };
'''
body = core + '\n' + scen + '\n' + veh + '\n' + rt
js = header + body + '\n}\n'
(out / 'game.js').write_text(js)
print('game.js', len(js))
