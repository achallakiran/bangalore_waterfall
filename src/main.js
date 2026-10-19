import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './styles/base.css';
import './styles/game.css';
import './styles/shell.css';
import { settings, applyGlobal } from './shell/settings.js';
import { fsSupported, toggleFs, isFs, onFsChange } from './shell/fullscreen.js';
import { canInstall, promptInstall, hintText, onInstallChange, isStandalone } from './shell/install.js';
import { createHost } from './shell/host.js';
import { bindSettings } from './shell/settings-ui.js';
import { registerSW } from './shell/pwa.js';
import { createMapManager, MapError } from './maps/manager.js';

const $ = id => document.getElementById(id);
const SCREENS = ['scTitle', 'scMaps', 'scRide', 'scSettings', 'scHelp', 'scAbout', 'scEditor'];
const host = createHost({ root: $('gameRoot'), tpl: $('gameTpl') });
const maps = createMapManager();
let customMap = null;                       // a map the player opened from a file; the built-in map is fetched only when a game starts
const DEFAULT_RIDE_TEXT = $('rideText').textContent;
let editor = null, editorState = null, editorBase = null, returnToEditor = false, opening = false;
let current = 'scTitle', stack = [], paused = false, settingsFromPause = false, toastT = 0;

applyGlobal();
$('verLine').textContent = 'Version ' + __APP_VERSION__;
$('aboutVer').textContent = 'Version ' + __APP_VERSION__ + ' (built ' + __BUILD_DATE__ + ').';

function toast(msg, ms = 4200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- Screens ----
function show(id) {
  if (id === 'scTitle') { customMap = null; maps.release(); $('rideText').textContent = DEFAULT_RIDE_TEXT; }
  SCREENS.forEach(s => { $(s).hidden = s !== id; }); current = id; const f = $(id).querySelector('.mbtn.primary, .mapcard, .ride, .btn'); if (f) f.focus({ preventScroll: true });
}
function go(id) { stack.push(current); show(id); }
function back() {
  if (current === 'scSettings' && settingsFromPause) { closeSettingsToPause(); return; }
  show(stack.pop() || 'scTitle');
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', back));

$('mPlay').addEventListener('click', () => go('scRide'));
$('mMaps').addEventListener('click', () => go('scMaps'));
$('mSettings').addEventListener('click', () => { settingsFromPause = false; $('scSettings').classList.remove('over'); go('scSettings'); });
$('mHelp').addEventListener('click', () => go('scHelp'));
$('mAbout').addEventListener('click', () => go('scAbout'));
document.querySelectorAll('[data-map]').forEach(b => b.addEventListener('click', () => { if (b.dataset.map === 'hill') { customMap = null; maps.release(); $('rideText').textContent = DEFAULT_RIDE_TEXT; go('scRide'); } else openClassic(); }));
document.querySelectorAll('[data-ride]').forEach(b => b.addEventListener('click', () => startGame(b.dataset.ride)));

// ---- Open a map file (validated before anything is built) ----
$('mapOpen').addEventListener('click', () => $('mapFile').click());
$('mapFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  const msg = $('mapMsg'); msg.hidden = true;
  if (!f) return;
  try {
    customMap = await maps.load({ file: f });
    $('rideText').textContent = (customMap.meta.name || 'Custom map') + (customMap.meta.description ? ': ' + customMap.meta.description : '');
    toast('Loaded ' + customMap.meta.name + '.');
    go('scRide');
  } catch (err) {
    customMap = null; maps.release();
    msg.textContent = err instanceof MapError ? err.message : 'This map could not be opened.'; msg.hidden = false;
  }
});

// ---- Map editor: its code loads only when opened and is released when closed ----
async function openEditor(state) {
  if (opening) return;
  opening = true;
  try {
    const [{ mountEditor }] = await Promise.all([import('./editor/editor.js')]);
    if (!editorBase) { const m = await maps.load('hill-loop'); editorBase = JSON.parse(JSON.stringify(m)); maps.release(); }
    SCREENS.forEach(s => { $(s).hidden = s !== 'scEditor'; }); current = 'scEditor'; stack = [];
    editor = mountEditor($('scEditor'), { state, base: editorBase, onExit: closeEditor, onPlay: playFromEditor, onToast: toast });
  } catch (err) {
    console.error(err); toast('The map editor could not be opened.'); show('scTitle');
  }
  opening = false;
}
function closeEditor() {
  if (editor) { editor.dispose(); editor = null; }
  editorState = null; editorBase = null; returnToEditor = false;
  show('scTitle'); stack = [];
}
function playFromEditor(map, kind, state) {
  editorState = state; editor.dispose(); editor = null;
  customMap = map; returnToEditor = true;
  startGame(kind);
}
$('mEditor').addEventListener('click', () => openEditor(null));

// ---- Settings ----
bindSettings({ onLive: p => host.applyLive(p) });
function openSettingsFromPause() {
  settingsFromPause = true;
  $('scPause').hidden = true;
  const s = $('scSettings'); s.classList.add('over'); s.hidden = false; current = 'scSettings';
}
function closeSettingsToPause() {
  settingsFromPause = false;
  const s = $('scSettings'); s.hidden = true; s.classList.remove('over');
  $('scPause').hidden = false; current = 'game'; $('pResume').focus({ preventScroll: true });
}

// ---- Game ----
let starting = false;
async function startGame(kind) {
  if (starting) return;
  starting = true;
  let map;
  try { map = customMap || await maps.load('hill-loop'); }
  catch (err) { starting = false; toast(err instanceof MapError ? err.message : 'The map could not be loaded.'); return; }
  starting = false;
  SCREENS.forEach(s => { $(s).hidden = true; });
  stack = []; current = 'game'; paused = false;
  const g = host.mount(kind, { map });
  if (!g) { exitGame(); toast('This browser could not start 3D graphics.'); return; }
  document.body.classList.add('playing');
  host.q('fPause').addEventListener('click', pause);
  host.q('fCam').addEventListener('click', () => { toggleCam(); focusStage(); });
  const ff = host.q('fFull'); ff.hidden = !fsSupported; ff.addEventListener('click', () => { toggleFs(); focusStage(); });
  focusStage();
}
function focusStage() { const s = host.q('stage'); if (s) s.focus({ preventScroll: true }); }
function toggleCam() { const a = host.game && host.game.api; if (a) a.setCam(a.state.cam === 'chase' ? 'overview' : 'chase'); }
function pause() {
  const g = host.game; if (!g || paused) return;
  paused = true; g.api.setPaused(true);
  $('pauseBest').textContent = host.q('progress').textContent;
  $('pCamSub').textContent = g.api.state.cam === 'chase' ? 'Chase' : 'Overview';
  $('scPause').hidden = false; $('pResume').focus({ preventScroll: true });
}
function resume() {
  const g = host.game; if (!g) return;
  paused = false; g.api.setPaused(false); $('scPause').hidden = true; focusStage();
}
function exitGame() {
  paused = false; $('scPause').hidden = true; $('scSettings').classList.remove('over'); settingsFromPause = false;
  host.unmount(); maps.release(); customMap = null; document.body.classList.remove('playing');
  if (returnToEditor && editorState) { openEditor(editorState); return; }
  show('scTitle'); stack = [];
}
$('pResume').addEventListener('click', resume);
$('pRestart').addEventListener('click', () => { host.game.api.resetRun(); resume(); });
$('pCam').addEventListener('click', () => { toggleCam(); $('pCamSub').textContent = host.game.api.state.cam === 'chase' ? 'Chase' : 'Overview'; });
$('pSettings').addEventListener('click', openSettingsFromPause);
$('pExit').addEventListener('click', exitGame);

// ---- Classic map: the original page, loaded as it was published, only while it is open ----
function openClassic() {
  const c = $('classic');
  SCREENS.forEach(s => { $(s).hidden = true; });
  const f = document.createElement('iframe');
  f.title = 'Loop Track (classic)'; f.src = './legacy/loop-track.html'; f.allow = 'fullscreen'; f.setAttribute('allowfullscreen', '');
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'fab'; b.textContent = 'Menu';
  b.addEventListener('click', closeClassic);
  c.replaceChildren(f, b); c.hidden = false; current = 'classic';
}
function closeClassic() { const c = $('classic'); c.replaceChildren(); c.hidden = true; show('scTitle'); stack = []; }

// ---- Full screen and install ----
function syncFs() { const on = isFs(); $('tFull').setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); }
$('tFull').hidden = !fsSupported;
$('tFull').addEventListener('click', () => toggleFs());
onFsChange(syncFs);

function syncInstall() {
  const show = canInstall();
  $('mInstall').hidden = !show;
  $('mInstallSub').textContent = hintText() ? 'How' : '';
}
syncInstall(); onInstallChange(syncInstall);
$('mInstall').addEventListener('click', async () => {
  const r = await promptInstall();
  if (r === 'hint') toast(hintText() || 'Use your browser menu to install this app.', 7000);
});
if (!fsSupported && !isStandalone() && hintText()) $('mInstallSub').textContent = 'Full screen';

// ---- Keyboard ----
window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), tag = e.target && e.target.tagName;
  if (paused && ['w', 'a', 's', 'd', 'c', 'r', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k) && tag !== 'BUTTON') { e.stopImmediatePropagation(); e.preventDefault(); return; }
  if (current === 'scEditor') { if (k === 'escape' && editor && !e.repeat && tag !== 'INPUT' && tag !== 'SELECT') editor.escape(); return; }
  if (tag === 'INPUT' && e.target.type === 'text') return;
  if (k === 'f' && !e.repeat) { toggleFs(); return; }
  if ((k === 'escape' || k === 'p') && !e.repeat) {
    if (current === 'classic') return;
    if (current === 'game') { if (paused) resume(); else pause(); e.preventDefault(); }
    else if (current === 'scSettings' && settingsFromPause) closeSettingsToPause();
    else if (current !== 'scTitle' && k === 'escape') back();
  }
}, true);

// Keep a tapped button from holding focus, so Space (handbrake) never "clicks" it again.
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('button');
  if (b && e.detail && current === 'game') { b.blur(); focusStage(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && current === 'game' && !paused) pause(); });
document.addEventListener('gesturestart', e => e.preventDefault());

// ---- Test hooks (used by the parity harness) ----
const params = new URLSearchParams(location.search);
if (params.has('parity')) {
  SCREENS.forEach(s => { $(s).hidden = true; });
  maps.load('hill-loop').then(map => { if (!host.mount('car', { start: false, map })) document.title = 'parity-nogl'; });
}
window.__v2 = { get editor() { return editor; }, host, maps, settings, show, startGame, pause, resume, exitGame, get paused() { return paused; }, get current() { return current; } };

registerSW();
