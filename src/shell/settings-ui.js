// Binds the Settings screen to the saved settings, and to the running game when there is one.
import { settings } from './settings.js';
import { fsSupported, toggleFs, isFs, onFsChange } from './fullscreen.js';

const $ = id => document.getElementById(id);
const clockLabel = h => {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60) % 60;
  return (((hh + 11) % 12) + 1) + ':' + String(mm).padStart(2, '0') + ' ' + (hh >= 12 ? 'pm' : 'am');
};

export function bindSettings({ onLive }) {
  const root = $('scSettings');
  const set = patch => { settings.set(patch); onLive(patch); render(); };

  $('sVox').addEventListener('input', e => set({ vox: Number(e.target.value) }));
  $('sTod').addEventListener('input', e => set({ hour: Number(e.target.value) / 4 }));
  $('sPad').addEventListener('input', e => set({ padScale: Number(e.target.value) / 100 }));

  root.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.toggle, r = settings.resolve();
    set({ [k]: !r[k] });
    if (b.detail) b.blur();
  }));
  root.querySelectorAll('[data-seg]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    set({ [seg.dataset.seg]: b.dataset.val });
    if (b.detail) b.blur();
  })));

  $('sFull').hidden = !fsSupported;
  $('sFull').addEventListener('click', e => { toggleFs(); if (e.detail) e.target.blur(); });
  onFsChange(() => { $('sFull').textContent = isFs() ? 'Exit full screen' : 'Full screen'; });
  $('sReset').addEventListener('click', e => { settings.reset(); onLive({ __reset: true }); render(); if (e.detail) e.target.blur(); });

  function render() {
    const r = settings.resolve();
    $('sVox').value = r.vox; $('sVoxOut').textContent = r.vox + ' cm';
    $('sTod').value = Math.round(r.hour * 4); $('sTodOut').textContent = clockLabel(r.hour);
    $('sPad').value = Math.round(r.padScale * 100); $('sPadOut').textContent = Math.round(r.padScale * 100) + '%';
    root.querySelectorAll('[data-toggle]').forEach(b => b.setAttribute('aria-pressed', String(!!r[b.dataset.toggle])));
    root.querySelectorAll('[data-seg]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(r[seg.dataset.seg] === b.dataset.val))));
  }
  render();
  return { render };
}
