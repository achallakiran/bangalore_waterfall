// Mounts and unmounts the game. One game lives in memory at a time: unmount stops the loop, removes every listener
// the game added, disposes its three.js resources, drops its DOM and ends its WebGL context.
import { boot } from '../game/hill-loop/game.js';
import { settings } from './settings.js';

export function createHost({ root, tpl }) {
  let game = null, hooks = null;
  // Added once for the life of the page (not per game, so repeated games never stack listeners): no page scroll or rubber-banding under the game.
  root.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  const q = id => root.querySelector('#' + id);
  const pressed = id => q(id).getAttribute('aria-pressed') === 'true';
  const setToggle = (id, want) => { if (pressed(id) !== want) q(id).click(); };
  const setRange = (id, value) => { const e = q(id); e.value = String(value); e.dispatchEvent(new Event('input', { bubbles: true })); };

  function mount(kind, { start = true, map } = {}) {
    if (game) unmount();
    root.hidden = false;
    root.append(tpl.content.cloneNode(true));
    const r = settings.resolve();
    const qs = new URLSearchParams(location.search); // ?stream=1 and ?cubes=N force streaming with a given budget (tests)
    hooks = { fall: r.fall, physics: r.physics, sky: r.sky, units: r.units, hour: r.hour, vox: r.vox, lite: r.lite, traffic: r.traffic, budget: Number(qs.get('cubes')) || r.budget, forceStream: qs.get('stream') === '1' };
    q('unit').textContent = r.units === 'mph' ? 'mph' : 'km/h';
    let g;
    try { g = boot(hooks, map); } catch (e) { console.error(e); g = null; }
    if (!g) { game = null; return null; }
    game = g;
    if (r.sound) setToggle('bSound', true);
    if (r.orbit) setToggle('bOrbit', true);
    if (r.pad !== 'auto') setToggle('bPad', r.pad === 'on');
    if (start) game.api.start(kind);
    return game;
  }

  function unmount() {
    if (!game) { root.replaceChildren(); root.hidden = true; return; }
    try { game.dispose(); } catch (e) { console.error(e); }
    game = null; hooks = null;
    root.replaceChildren();
    root.hidden = true;
  }

  // Settings changed while a game is running.
  function applyLive(patch) {
    if (!game) return;
    const r = settings.resolve();
    if ('vox' in patch && patch.vox !== undefined || patch.__reset) setRange('vox', r.vox);
    if ('hour' in patch || patch.__reset) setRange('tod', Math.round(r.hour * 4));
    if ('lite' in patch || patch.__reset) setToggle('bLite', r.lite);
    if ('traffic' in patch || patch.__reset) setToggle('bTraffic', r.traffic);
    if ('orbit' in patch || patch.__reset) setToggle('bOrbit', r.orbit);
    if ('sound' in patch || patch.__reset) setToggle('bSound', r.sound);
    if ('pad' in patch || patch.__reset) {
      const want = r.pad === 'auto' ? !!(window.matchMedia && matchMedia('(pointer: coarse)').matches) : r.pad === 'on';
      setToggle('bPad', want);
    }
    if ('sky' in patch || patch.__reset) hooks.sky = r.sky;
    if ('fall' in patch || patch.__reset) hooks.fall = r.fall;
    if ('physics' in patch || patch.__reset) hooks.physics = r.physics;
    if ('units' in patch || patch.__reset) { hooks.units = r.units; const u = q('unit'); if (u) u.textContent = r.units === 'mph' ? 'mph' : 'km/h'; }
  }

  return {
    mount, unmount, applyLive, q,
    get game() { return game; },
    get active() { return !!game; }
  };
}
