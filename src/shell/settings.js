// Settings persisted on this device (localStorage, always inside try/catch: private windows can throw).
const KEY = 'hl2.settings.v1';
const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export const DEFAULTS = {
  vox: null,        // null = automatic (20 cm, or 25 cm in Lite)
  lite: null,       // null = automatic (on for narrow screens)
  hour: 16.5,
  traffic: null,    // null = automatic (off when reduced motion is requested)
  sound: false,
  orbit: false,
  pad: 'auto',      // auto | on | off
  padSide: 'right', // right | left
  padScale: 1,
  units: 'kmh',     // kmh | mph
  theme: 'auto',    // auto | light | dark
  budget: 'auto'    // memory budget: auto | low | medium | high (applies the next time a game starts)
};

let cur = { ...DEFAULTS };
try { cur = { ...DEFAULTS, ...pick(JSON.parse(localStorage.getItem(KEY) || '{}')) }; } catch (e) {}

function pick(raw) {
  const o = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in raw)) continue;
    const d = DEFAULTS[k], v = raw[k];
    if (d === null) { if (v === null || typeof v === 'number' || typeof v === 'boolean') o[k] = v; }
    else if (typeof v === typeof d) o[k] = v;
  }
  return o;
}

const subs = new Set();
function save() { try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {} }

export const settings = {
  get: () => ({ ...cur }),
  set(patch) { Object.assign(cur, patch); save(); applyGlobal(); subs.forEach(f => f(patch)); },
  reset() { cur = { ...DEFAULTS }; save(); applyGlobal(); subs.forEach(f => f({ ...DEFAULTS, __reset: true })); },
  on(f) { subs.add(f); return () => subs.delete(f); },
  // Settings with automatic values resolved for this device.
  resolve() {
    const lite = cur.lite === null ? window.innerWidth < 700 : cur.lite;
    return { ...cur, lite, vox: cur.vox === null ? (lite ? 25 : 20) : cur.vox, traffic: cur.traffic === null ? !reducedMotion() : cur.traffic };
  }
};

// Settings that style the page itself, applied whether or not a game is running.
export function applyGlobal() {
  const root = document.documentElement;
  if (cur.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', cur.theme);
  root.style.setProperty('--pad-scale', String(cur.padScale));
  document.body.dataset.padSide = cur.padSide;
}
