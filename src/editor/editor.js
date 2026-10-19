// Map editor screen (Phase 4). Loaded only when the editor is opened, and everything it holds is released when it closes.
// A top-down canvas over a shaded picture of the real ground (made by the same world maths as the game), with tools on the side.
import '../styles/editor.css';
import { createWorld } from '../engine/world.js';
import { validateMap, describeErrors } from '../maps/format.js';
import { parseMap, MapError } from '../maps/manager.js';
import * as ED from './model.js';

const TOOLS = [
  ['select', 'Select', 'Click a thing to see it and change it.'],
  ['pan', 'Pan', 'Drag to move the view. Mouse: right-drag or hold Space. Wheel or pinch to zoom.'],
  ['road', 'Road', 'Drag from one point to another. Ends snap to roads that are close, and a junction is made where roads cross.'],
  ['slope', 'Slope', 'Click a road to set its height there. Alt-click a height point to remove it.'],
  ['terrain', 'Terrain', 'Click to paint a hill, rock, scrub or lake area.'],
  ['building', 'Building', 'Drag a rectangle. Tick Shop to give it an awning and a name.'],
  ['tree', 'Tree', 'Click to plant a tree.'],
  ['lamp', 'Lamp', 'Click to place a street lamp.'],
  ['signal', 'Signal', 'Click to place a traffic light or a traffic police post (used in a later version).'],
  ['crossing', 'Crossing', 'Click on a road to place a pedestrian crossing (used in a later version).'],
  ['spawn', 'Spawn area', 'Drag a rectangle where people, animals or vehicles appear (used in a later version).'],
  ['start', 'Start', 'Click on a road to move the start of the lap.'],
  ['erase', 'Erase', 'Click a thing to remove it. On empty ground it removes a terrain area.']
];
const BLOB_NAMES = { hills: 'Hill', rock: 'Rock', scrub: 'Scrub', lake: 'Lake' };
const SPAWN_NAMES = { pedestrian: 'People', cow: 'Cows', buffalo: 'Buffalo', goat: 'Goats', dog: 'Dogs', vehicle: 'Vehicles' };
const DRAFT_KEY = 'hl2.editor.draft.v1';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v); }
  kids.flat().forEach(c => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); });
  return e;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const slug = s => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)) || 'my-map';

// state = { map, undo: [json], redo: [json], view: {cx, cz, s}, dirty } can be passed back in to resume after a play-test.
export function mountEditor(root, { state, base, onExit, onPlay, onToast }) {
  const st = state || { map: ED.newMapFrom(base, { id: 'my-map', name: 'My map' }), undo: [], redo: [], view: null, dirty: false };
  ED.ensureFeatures(st.map);
  const toast = (m) => onToast && onToast(m);
  let tool = 'select', selected = null, W = null, ground = null, dirtyGround = true, groundT = 0, raf = 0, saveT = 0, disposed = false;
  let drag = null, hover = null, spaceDown = false, errors = [], warns = [], lines = null;
  const opts = { h0: '', h1: '', slopeH: 2, blob: 'hills', blobSize: 8, bh: 6, shop: false, shopName: 'Corner Store', lampE: 1, sig: 'light', cross: 6, spawn: 'pedestrian', spawnN: 3 };

  // ---------- layout ----------
  const cv = el('canvas', { class: 'ed-canvas', tabindex: '0', 'aria-label': 'Map canvas' });
  const status = el('div', { class: 'ed-status', role: 'status' });
  const toolBar = el('div', { class: 'ed-tools', role: 'toolbar', 'aria-label': 'Tools' });
  const optBox = el('div', { class: 'ed-opts' });
  const selBox = el('div', { class: 'ed-sel' });
  const mapBox = el('div', { class: 'ed-map' });
  const errBox = el('div', { class: 'ed-errs', role: 'status' });
  const hint = el('p', { class: 'ed-hint' });
  const bUndo = el('button', { class: 'btn', type: 'button', text: 'Undo' }), bRedo = el('button', { class: 'btn', type: 'button', text: 'Redo' });
  const bSave = el('button', { class: 'btn', type: 'button', text: 'Save file' }), bOpen = el('button', { class: 'btn', type: 'button', text: 'Open file' });
  const bPlayCar = el('button', { class: 'btn primary', type: 'button', text: 'Test drive: car' }), bPlayBike = el('button', { class: 'btn primary', type: 'button', text: 'Test drive: bike' });
  const bNew = el('button', { class: 'btn', type: 'button', text: 'New map' }), bHill = el('button', { class: 'btn', type: 'button', text: 'Hill Loop' });
  const bExit = el('button', { class: 'btn', type: 'button', text: 'Exit editor' });
  const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const top = el('div', { class: 'ed-top' }, bExit, el('div', { class: 'ed-topbtns' }, bNew, bHill, bOpen, bSave, bUndo, bRedo), el('div', { class: 'ed-topbtns' }, bPlayCar, bPlayBike));
  const side = el('div', { class: 'ed-side' }, toolBar, hint, optBox, selBox, mapBox, errBox);
  const stage = el('div', { class: 'ed-stage' }, cv, status);
  root.replaceChildren(top, el('div', { class: 'ed-body' }, stage, side), file);

  TOOLS.forEach(([id, label, tip]) => {
    const b = el('button', { class: 'ed-tool', type: 'button', 'data-tool': id, 'aria-pressed': 'false', title: tip, text: label });
    b.addEventListener('click', () => setTool(id));
    toolBar.append(b);
  });

  // ---------- state and history ----------
  const snap = () => JSON.stringify(st.map);
  function commit(fn, groundChanged = true) {
    const before = snap();
    const res = fn(st.map);
    if (typeof res === 'string' && res.startsWith('!')) { st.map = JSON.parse(before); toast(res.slice(1)); return false; }
    st.undo.push(before); if (st.undo.length > 80) st.undo.shift();
    st.redo.length = 0; st.dirty = true;
    after(groundChanged);
    return res === undefined ? true : res;
  }
  function after(groundChanged) {
    if (groundChanged) { dirtyGround = true; lines = null; }
    check(); refreshUi(); draw();
    clearTimeout(saveT); saveT = setTimeout(autosave, 800);
  }
  function undo() { if (!st.undo.length) return; st.redo.push(snap()); st.map = JSON.parse(st.undo.pop()); selected = null; st.dirty = true; after(true); }
  function redo() { if (!st.redo.length) return; st.undo.push(snap()); st.map = JSON.parse(st.redo.pop()); selected = null; st.dirty = true; after(true); }
  function autosave() { try { localStorage.setItem(DRAFT_KEY, snap()); } catch (e) {} }
  function check() {
    const r = validateMap(st.map);
    errors = r.ok ? [] : r.errors;
    try { warns = r.ok ? ED.warnings(st.map) : []; } catch (e) { warns = []; }
  }

  // ---------- the ground picture ----------
  const KCOL = () => {
    const K = W.K, t = {};
    [K.ROAD, K.EDGE, K.DASH, K.ZEBRA, K.CHKD, K.CHKW, K.PIT, K.RIM].forEach(k => t[k] = [75, 81, 89]);
    t[K.KERB] = [199, 194, 182]; t[K.WATER] = [79, 163, 209]; t[K.SAND] = [230, 214, 162]; t[K.GRASS] = [111, 191, 74];
    t[K.SCRUB] = [201, 178, 122]; t[K.LATER] = [181, 105, 74]; t[K.ROCK] = [142, 149, 155]; t[K.ROCK2] = [113, 120, 128];
    return t;
  };
  function buildGround() {
    dirtyGround = false;
    if (errors.length && !W) return;
    try { W = createWorld(st.map); } catch (e) { return; }
    const S = st.map.slab, wM = S.x1 - S.x0, dM = S.z1 - S.z0, cell = Math.max(0.5, Math.sqrt(wM * dM / 26000));
    const nx = Math.max(1, Math.round(wM / cell)), nz = Math.max(1, Math.round(dM / cell));
    if (!ground) ground = document.createElement('canvas');
    ground.width = nx; ground.height = nz;
    const g = ground.getContext('2d'), img = g.createImageData(nx, nz), KC = KCOL();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = S.x0 + (i + 0.5) * wM / nx, z = S.z0 + (j + 0.5) * dM / nz;
      const c0 = W.column(x, z, 0.25), kind = c0.kind, h0 = c0.h;
      const h1 = W.column(x - cell * 0.8, z - cell * 0.8, 0.25).h, h2 = W.column(x + cell * 0.8, z + cell * 0.8, 0.25).h;
      const c = KC[kind] || [111, 191, 74], sh = clamp(1 + (h1 - h2) * 0.22 / Math.max(0.6, cell * 0.8) + (h0 - 3) * 0.03, 0.6, 1.35);
      const o = (j * nx + i) * 4;
      img.data[o] = Math.min(255, c[0] * sh); img.data[o + 1] = Math.min(255, c[1] * sh); img.data[o + 2] = Math.min(255, c[2] * sh); img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  // ---------- view ----------
  const view = st.view || (st.view = { cx: (st.map.slab.x0 + st.map.slab.x1) / 2, cz: (st.map.slab.z0 + st.map.slab.z1) / 2, s: 0 });
  let cw = 300, ch = 300, dpr = 1;
  const X = x => (x - view.cx) * view.s + cw / 2, Z = z => (z - view.cz) * view.s + ch / 2;
  const wx = px => (px - cw / 2) / view.s + view.cx, wz = py => (py - ch / 2) / view.s + view.cz;
  function fit() { const S = st.map.slab; view.cx = (S.x0 + S.x1) / 2; view.cz = (S.z0 + S.z1) / 2; view.s = Math.min(cw / (S.x1 - S.x0 + 8), ch / (S.z1 - S.z0 + 8)); }
  function resize() {
    const r = stage.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = Math.max(200, r.width); ch = Math.max(200, r.height);
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    if (!view.s) fit();
    draw();
  }
  const ro = new ResizeObserver(() => { if (!disposed) resize(); }); ro.observe(stage);

  // ---------- drawing ----------
  function draw() {
    if (disposed) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(paint);
  }
  function paint() {
    if (disposed) return;
    if (dirtyGround && performance.now() - groundT > 90) { groundT = performance.now(); buildGround(); } else if (dirtyGround) { setTimeout(draw, 100); }
    const c = cv.getContext('2d'), m = st.map, S = m.slab, s = view.s;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#dfe8ea'; c.fillRect(0, 0, cw, ch);
    c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, 0, cw, ch);
    if (ground) { c.imageSmoothingEnabled = true; c.drawImage(ground, X(S.x0), Z(S.z0), (S.x1 - S.x0) * s, (S.z1 - S.z0) * s); }
    // grid every 10 m
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,0.16)'; c.beginPath();
    for (let x = Math.ceil(S.x0 / 10) * 10; x <= S.x1; x += 10) { c.moveTo(X(x), Z(S.z0)); c.lineTo(X(x), Z(S.z1)); }
    for (let z = Math.ceil(S.z0 / 10) * 10; z <= S.z1; z += 10) { c.moveTo(X(S.x0), Z(z)); c.lineTo(X(S.x1), Z(z)); }
    c.stroke();
    c.strokeStyle = '#111'; c.lineWidth = 2; c.strokeRect(X(S.x0), Z(S.z0), (S.x1 - S.x0) * s, (S.z1 - S.z0) * s);
    const sel = id => selected && selected.id === id;
    const f = m.features || {};
    // spawn areas
    (f.spawnAreas || []).forEach(a => {
      c.setLineDash([6, 4]); c.strokeStyle = sel(a.id) ? '#fff' : '#7A3FB5'; c.fillStyle = 'rgba(122,63,181,0.18)'; c.lineWidth = 2;
      c.fillRect(X(a.x0), Z(a.z0), (a.x1 - a.x0) * s, (a.z1 - a.z0) * s); c.strokeRect(X(a.x0), Z(a.z0), (a.x1 - a.x0) * s, (a.z1 - a.z0) * s); c.setLineDash([]);
      label(c, (SPAWN_NAMES[a.kind] || a.kind) + ' x' + a.count, X(a.x0) + 3, Z(a.z0) + 12, '#fff', '#4B2574');
    });
    // buildings
    m.scenery.forEach(b => {
      if (b.t !== 'bldgN') return;
      const shop = (f.shops || []).find(q => q.id === b.id);
      c.fillStyle = b.wall; c.strokeStyle = sel(b.id) ? '#fff' : (b.trim || '#555'); c.lineWidth = sel(b.id) ? 3 : 2;
      c.fillRect(X(b.x0), Z(b.zf), (b.x1 - b.x0) * s, b.depth * s); c.strokeRect(X(b.x0), Z(b.zf), (b.x1 - b.x0) * s, b.depth * s);
      if (shop) { c.fillStyle = '#2E8B57'; c.fillRect(X(b.x0), Z(b.zf) - 3, (b.x1 - b.x0) * s, 4); label(c, shop.name, X(b.x0) + 3, Z(b.zf) + 13, '#fff', '#1d1e22'); }
      else label(c, b.h.toFixed(0) + ' m', X(b.x0) + 3, Z(b.zf) + 13, '#1d1e22', null);
    });
    // trees and lamps
    m.scenery.forEach(t => {
      if (t.t === 'tree') { c.fillStyle = 'rgba(30,110,50,0.85)'; c.strokeStyle = sel(t.id) ? '#fff' : '#12381d'; c.lineWidth = sel(t.id) ? 3 : 1.5; c.beginPath(); c.arc(X(t.x), Z(t.z), Math.max(3, t.r * s), 0, 6.3); c.fill(); c.stroke(); }
      if (t.t === 'lamp') { c.fillStyle = '#F2C200'; c.strokeStyle = sel(t.id) ? '#fff' : '#222'; c.lineWidth = sel(t.id) ? 3 : 1.5; c.beginPath(); c.arc(X(t.x), Z(t.z), Math.max(3, 0.5 * s), 0, 6.3); c.fill(); c.stroke(); }
    });
    // crossings
    (f.crossings || []).forEach(a => {
      c.save(); c.translate(X(a.x), Z(a.z)); c.rotate(-a.psi);
      c.fillStyle = '#fff'; c.strokeStyle = sel(a.id) ? '#ff0' : '#333'; c.lineWidth = 1.5;
      const w = 0.6 * s, hh = a.len * s / 2;
      for (let k = -2; k <= 2; k++) { c.fillRect(k * w * 1.6 - w / 2, -hh, w, hh * 2); }
      c.restore();
    });
    // signals
    (f.signals || []).forEach(a => {
      c.fillStyle = a.kind === 'police' ? '#2B5FD9' : '#D8392B'; c.strokeStyle = sel(a.id) ? '#fff' : '#111'; c.lineWidth = sel(a.id) ? 3 : 1.5;
      c.beginPath(); c.arc(X(a.x), Z(a.z), 6, 0, 6.3); c.fill(); c.stroke();
      c.fillStyle = '#fff'; c.font = '700 9px sans-serif'; c.textAlign = 'center'; c.fillText(a.kind === 'police' ? 'P' : 'T', X(a.x), Z(a.z) + 3); c.textAlign = 'start';
    });
    // road labels and height points of the selected road
    lines = lines || ED.polylines(m);
    m.roads.edges.forEach((e, i) => {
      const pts = lines[i];
      if (selected && selected.kind === 'road' && selected.edge === i) {
        c.strokeStyle = '#fff'; c.lineWidth = 2; c.setLineDash([5, 4]); c.beginPath(); pts.forEach((p, k) => (k ? c.lineTo(X(p[0]), Z(p[1])) : c.moveTo(X(p[0]), Z(p[1])))); c.stroke(); c.setLineDash([]);
      }
      if (tool === 'slope' || (selected && selected.kind === 'road' && selected.edge === i)) {
        e.profile.forEach(p => { const q = pointAt(pts, p[0]); c.fillStyle = '#F2A900'; c.strokeStyle = '#222'; c.lineWidth = 1.5; c.beginPath(); c.arc(X(q[0]), Z(q[1]), 5, 0, 6.3); c.fill(); c.stroke(); label(c, p[1].toFixed(1) + ' m', X(q[0]) + 7, Z(q[1]) - 6, '#fff', '#222'); });
      }
    });
    // junctions
    m.roads.junctions.forEach(j => { c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.5; c.beginPath(); c.arc(X(j.x), Z(j.z), 4, 0, 6.3); c.stroke(); });
    // start
    const a = m.start; c.save(); c.translate(X(a.x), Z(a.z)); c.rotate(-a.psi); c.fillStyle = '#F2A900'; c.strokeStyle = '#1C1600'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(11, 0); c.lineTo(-7, -7); c.lineTo(-7, 7); c.closePath(); c.fill(); c.stroke(); c.restore();
    // preview of the thing being drawn
    if (drag && drag.kind) {
      const p = drag.cur;
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.setLineDash([6, 4]);
      if (drag.kind === 'road') { c.beginPath(); c.moveTo(X(drag.a[0]), Z(drag.a[1])); c.lineTo(X(p[0]), Z(p[1])); c.stroke(); }
      else { c.strokeRect(X(Math.min(drag.a[0], p[0])), Z(Math.min(drag.a[1], p[1])), Math.abs(p[0] - drag.a[0]) * s, Math.abs(p[1] - drag.a[1]) * s); }
      c.setLineDash([]);
    }
    if (hover && (tool === 'tree' || tool === 'lamp' || tool === 'signal' || tool === 'terrain')) {
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.5; c.beginPath();
      if (tool === 'terrain') c.ellipse(X(hover[0]), Z(hover[1]), opts.blobSize * s, opts.blobSize * s, 0, 0, 6.3); else c.arc(X(hover[0]), Z(hover[1]), 6, 0, 6.3);
      c.stroke();
    }
  }
  function label(c, text, x, y, fg, bg) {
    c.font = '600 11px system-ui, sans-serif';
    if (bg) { const w = c.measureText(text).width; c.fillStyle = bg; c.globalAlpha = 0.75; c.fillRect(x - 2, y - 10, w + 4, 14); c.globalAlpha = 1; }
    c.fillStyle = fg; c.fillText(text, x, y);
  }
  function pointAt(pts, t) {
    for (let i = 0; i < pts.length - 1; i++) if (t <= pts[i + 1][2] || i === pts.length - 2) { const a = pts[i], b = pts[i + 1], u = (t - a[2]) / ((b[2] - a[2]) || 1); return [a[0] + (b[0] - a[0]) * clamp(u, 0, 1), a[1] + (b[1] - a[1]) * clamp(u, 0, 1)]; }
    return pts[0];
  }

  // ---------- tools ----------
  function setTool(id) {
    tool = id; drag = null;
    toolBar.querySelectorAll('.ed-tool').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
    hint.textContent = (TOOLS.find(t => t[0] === id) || [])[2] || '';
    buildOpts(); draw();
    cv.style.cursor = id === 'pan' ? 'grab' : id === 'select' ? 'default' : 'crosshair';
  }
  function num(label, key, min, max, step = 1) {
    const i = el('input', { type: 'number', min, max, step, value: opts[key], inputmode: 'decimal' });
    i.addEventListener('input', () => { opts[key] = i.value === '' ? '' : Number(i.value); });
    return el('label', { class: 'ed-f' }, el('span', { text: label }), i);
  }
  function sel(label, key, choices) {
    const s = el('select', {}, ...choices.map(([v, t]) => el('option', { value: v, text: t })));
    s.value = opts[key];
    s.addEventListener('change', () => { opts[key] = s.value; });
    return el('label', { class: 'ed-f' }, el('span', { text: label }), s);
  }
  function buildOpts() {
    const rows = [];
    if (tool === 'road') rows.push(num('Start height (m, blank = follow ground)', 'h0', -3, 11, 0.5), num('End height (m, blank = follow ground)', 'h1', -3, 11, 0.5));
    if (tool === 'slope') rows.push(num('Height at the point (m)', 'slopeH', -3, 11, 0.5));
    if (tool === 'terrain') rows.push(sel('Kind', 'blob', Object.entries(BLOB_NAMES)), num('Radius (m)', 'blobSize', 2, 40, 1));
    if (tool === 'building') {
      rows.push(num('Height (m)', 'bh', 2.5, 30, 0.5));
      const cb = el('input', { type: 'checkbox' }); cb.checked = !!opts.shop; cb.addEventListener('change', () => { opts.shop = cb.checked; buildOpts(); });
      rows.push(el('label', { class: 'ed-f row' }, cb, el('span', { text: 'Shop (awning and a name)' })));
      if (opts.shop) { const t = el('input', { type: 'text', maxlength: 40, value: opts.shopName }); t.addEventListener('input', () => { opts.shopName = t.value; }); rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Shop name' }), t)); }
    }
    if (tool === 'lamp') rows.push(sel('Arm points', 'lampE', [[1, 'toward south (+z)'], [-1, 'toward north (-z)']]));
    if (tool === 'signal') rows.push(sel('Kind', 'sig', [['light', 'Traffic light'], ['police', 'Traffic police']]));
    if (tool === 'crossing') rows.push(num('Length (m)', 'cross', 2, 20, 1));
    if (tool === 'spawn') rows.push(sel('Who appears', 'spawn', Object.entries(SPAWN_NAMES)), num('How many', 'spawnN', 1, 30, 1));
    optBox.replaceChildren(...rows); optBox.hidden = !rows.length;
  }
  const numOpt = (k, d) => (opts[k] === '' || opts[k] == null || Number.isNaN(Number(opts[k])) ? d : Number(opts[k]));

  function snapPt(x, z, toRoad = false) {
    if (toRoad) {
      lines = lines || ED.polylines(st.map);
      const n = ED.nearestRoad(st.map, x, z, 2.5 + 8 / view.s, lines);
      if (n) return { x: Math.round(n.x * 100) / 100, z: Math.round(n.z * 100) / 100, road: n };
    }
    return { x: Math.round(x), z: Math.round(z), road: null };
  }
  function roadHeightAt(p) { return p.road ? W.edgeH(p.road.edge, p.road.t) : Math.max(0, W.column(p.x, p.z, 0.25).h); }
  function pickAt(x, z) { lines = lines || ED.polylines(st.map); return ED.hitTest(st.map, x, z, 1.2 + 6 / view.s, lines); }

  function pointerAction(kind, x, z, e) {
    const m = st.map;
    if (kind === 'click') {
      switch (tool) {
        case 'select': { selected = pickAt(x, z); refreshUi(); draw(); break; }
        case 'terrain': commit(() => ED.addBlob(m, opts.blob, x, z, opts.blobSize, opts.blobSize, 1)); break;
        case 'tree': commit(() => ED.addTree(m, x, z, 3.6 + (Math.abs(Math.round(x * 7 + z * 3)) % 9) * 0.1, 1.3 + (Math.abs(Math.round(x + z * 5)) % 7) * 0.08), false); break;
        case 'lamp': commit(() => ED.addLamp(m, x, z, Number(opts.lampE)), false); break;
        case 'signal': commit(() => { const n = ED.nearestRoad(m, x, z, 8); const psi = n ? roadPsi(n) : 0; return ED.addSignal(m, x, z, psi, opts.sig); }, false); break;
        case 'crossing': {
          const p = snapPt(x, z, true);
          if (!p.road) { toast('Click on a road to place a crossing.'); break; }
          commit(() => ED.addCrossing(m, p.x, p.z, roadPsi(p.road) + Math.PI / 2, numOpt('cross', 6)), false); break;
        }
        case 'start': {
          const p = snapPt(x, z, true);
          if (!p.road) { toast('Click on a road to place the start.'); break; }
          commit(() => ED.setStart(m, p.x, p.z, roadPsi(p.road)), false); break;
        }
        case 'slope': {
          const n = pickAt(x, z);
          if (!n || n.kind !== 'road') { toast('Click on a road.'); break; }
          if (e.altKey) { commit(() => ED.removeRoadHeight(m, n.edge, n.t)); break; }
          commit(() => ED.setRoadHeight(m, n.edge, n.t, numOpt('slopeH', 2))); break;
        }
        case 'erase': {
          const h = pickAt(x, z);
          if (h && h.kind === 'road') { if (h.edge === 0) toast('The oval loop cannot be erased.'); else commit(() => ED.removeRoad(m, h.edge)); }
          else if (h) commit(() => ED.removeById(m, h.id));
          else if (!commit(() => ED.removeBlobNear(m, x, z))) { /* toast already shown */ }
          selected = null; refreshUi(); break;
        }
      }
    } else if (kind === 'drag') {
      const a = drag.a, b = drag.cur;
      if (tool === 'road') {
        const sa = drag.sa, sb = snapPt(b[0], b[1], true);
        const h0 = opts.h0 === '' ? roadHeightAt(sa) : Number(opts.h0), h1 = opts.h1 === '' ? roadHeightAt(sb) : Number(opts.h1);
        const r = commit(() => ED.addRoad(m, [sa.x, sa.z], [sb.x, sb.z], h0, h1));
        if (r !== false) { selected = { kind: 'road', edge: m.roads.edges.length - 1 }; refreshUi(); }
      } else if (tool === 'building') {
        const r = commit(() => ED.addBuilding(m, { x0: a[0], z0: a[1], x1: b[0], z1: b[1], h: numOpt('bh', 6), shop: opts.shop ? { name: opts.shopName } : null }));
        if (typeof r === 'string') { selected = { kind: opts.shop ? 'shop' : 'building', id: r }; refreshUi(); }
      } else if (tool === 'spawn') {
        commit(() => ED.addSpawnArea(m, opts.spawn, a[0], a[1], b[0], b[1], numOpt('spawnN', 3)), false);
      }
    }
  }
  function roadPsi(n) { return W.edgePoint(n.edge, n.t, 0).psi; }

  // ---------- pointer handling ----------
  const ptrs = new Map();
  let pinch = null, panning = null, moved = 0, downAt = null;
  const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); cv.focus({ preventScroll: true });
    const [px, py] = local(e); ptrs.set(e.pointerId, [px, py]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; drag = null; panning = null; return; }
    const panNow = tool === 'pan' || e.button === 1 || e.button === 2 || spaceDown;
    if (panNow) { panning = { px, py, cx: view.cx, cz: view.cz }; cv.style.cursor = 'grabbing'; return; }
    moved = 0; downAt = [px, py];
    const x = wx(px), z = wz(py);
    if (tool === 'road') { const sa = snapPt(x, z, true); drag = { kind: 'road', a: [sa.x, sa.z], sa, cur: [sa.x, sa.z] }; }
    else if (tool === 'building' || tool === 'spawn') { const sp = snapPt(x, z); drag = { kind: tool, a: [sp.x, sp.z], cur: [sp.x, sp.z] }; }
    else drag = { kind: null };
    draw();
  });
  cv.addEventListener('pointermove', e => {
    const [px, py] = local(e); const had = ptrs.has(e.pointerId); if (had) ptrs.set(e.pointerId, [px, py]);
    const x = wx(px), z = wz(py);
    hover = [Math.round(x), Math.round(z)];
    status.textContent = statusText(x, z);
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const bx = wx(pinch.mx), bz = wz(pinch.my);
      view.s = clamp(pinch.s * d / pinch.d, 1.2, 60);
      view.cx = bx - (pinch.mx - cw / 2) / view.s; view.cz = bz - (pinch.my - ch / 2) / view.s;
      draw(); return;
    }
    if (panning) { view.cx = panning.cx - (px - panning.px) / view.s; view.cz = panning.cz - (py - panning.py) / view.s; draw(); return; }
    if (drag && downAt) {
      moved = Math.max(moved, Math.hypot(px - downAt[0], py - downAt[1]));
      if (drag.kind === 'road') { const sp = snapPt(x, z, true); drag.cur = [sp.x, sp.z]; }
      else if (drag.kind) { const sp = snapPt(x, z); drag.cur = [sp.x, sp.z]; }
    }
    draw();
  });
  cv.addEventListener('pointerup', e => {
    const [px, py] = local(e); ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) pinch = null; return; }
    if (panning) { panning = null; cv.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'; return; }
    if (!drag) return;
    if (drag.kind && moved > 6) pointerAction('drag', 0, 0, e); else pointerAction('click', wx(px), wz(py), e);
    drag = null; downAt = null; draw();
  });
  cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); drag = null; panning = null; pinch = null; draw(); });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const [px, py] = local(e), bx = wx(px), bz = wz(py);
    view.s = clamp(view.s * Math.exp(-e.deltaY * 0.0015), 1.2, 60);
    view.cx = bx - (px - cw / 2) / view.s; view.cz = bz - (py - ch / 2) / view.s; draw();
  }, { passive: false });
  const onKey = e => {
    if (disposed || root.hidden) return;
    const tag = e.target && e.target.tagName;
    if (e.key === ' ' ) { if (tag === 'CANVAS') { spaceDown = e.type === 'keydown'; e.preventDefault(); } return; }
    if (e.type !== 'keydown') return;
    const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (typing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); deleteSelected(); }
  };
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);

  function statusText(x, z) {
    let h = '';
    try { if (W) h = ' · ground ' + W.column(x, z, 0.25).h.toFixed(1) + ' m'; } catch (e) {}
    return 'x ' + x.toFixed(1) + ', z ' + z.toFixed(1) + h + (st.dirty ? ' · unsaved changes' : '');
  }

  // ---------- panels ----------
  function deleteSelected() {
    if (!selected) return;
    if (selected.kind === 'road') { if (selected.edge === 0) { toast('The oval loop cannot be removed.'); return; } commit(() => ED.removeRoad(st.map, selected.edge)); }
    else commit(() => ED.removeById(st.map, selected.id), false);
    selected = null; refreshUi();
  }
  function refreshUi() {
    bUndo.disabled = !st.undo.length; bRedo.disabled = !st.redo.length;
    const ok = !errors.length;
    bSave.disabled = !ok; bPlayCar.disabled = !ok; bPlayBike.disabled = !ok;
    // selection panel
    const rows = [];
    if (selected) {
      const m = st.map;
      if (selected.kind === 'road') {
        const e = m.roads.edges[selected.edge];
        if (e) {
          rows.push(el('h4', { text: selected.edge === 0 ? 'Oval loop' : 'Road ' + e.key }), el('p', { class: 'ed-note', text: ED.roadLength(m, selected.edge).toFixed(0) + ' m long, ' + e.profile.length + ' height points. Use the Slope tool to shape the hill.' }));
          if (selected.edge === 0) {
            const L = el('input', { type: 'number', min: 4, max: 200, step: 1, value: e.L }), R = el('input', { type: 'number', min: 4, max: 200, step: 1, value: e.R });
            const go = () => commit(() => ED.setOval(m, Number(L.value), Number(R.value)));
            L.addEventListener('change', go); R.addEventListener('change', go);
            rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Straight half-length (m)' }), L), el('label', { class: 'ed-f' }, el('span', { text: 'End radius (m)' }), R));
          }
        }
      } else {
        const it = ED.getItem(m, selected.id);
        if (it) {
          rows.push(el('h4', { text: ({ building: 'Building', shop: 'Shop', tree: 'Tree', lamp: 'Lamp', signal: 'Signal', crossing: 'Crossing', spawn: 'Spawn area' })[selected.kind] + ' ' + selected.id }));
          if (it.t === 'bldgN') {
            const h = el('input', { type: 'number', min: 2.5, max: 30, step: 0.5, value: it.h });
            h.addEventListener('change', () => commit(() => ED.setBuildingHeight(m, it.id, Number(h.value)), false));
            rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Height (m)' }), h));
            const sh = (m.features.shops || []).find(q => q.id === it.id);
            if (sh) { const t = el('input', { type: 'text', maxlength: 40, value: sh.name }); t.addEventListener('change', () => commit(() => ED.renameShop(m, it.id, t.value), false)); rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Shop name' }), t)); }
          }
          if (selected.kind === 'spawn') {
            const n = el('input', { type: 'number', min: 1, max: 30, step: 1, value: it.count });
            n.addEventListener('change', () => commit(() => { it.count = clamp(Math.round(Number(n.value)), 1, 30); }, false));
            rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'How many' }), n));
          }
        }
      }
      if (rows.length) rows.push(el('button', { class: 'btn', type: 'button', text: 'Delete', onclick: null }));
    }
    selBox.replaceChildren(...rows); selBox.hidden = !rows.length;
    const del = selBox.querySelector('button'); if (del) del.addEventListener('click', deleteSelected);
    // map panel
    const m = st.map, S = m.slab;
    const name = el('input', { type: 'text', maxlength: 60, value: m.meta.name });
    name.addEventListener('change', () => commit(() => { m.meta.name = name.value.trim() || 'My map'; m.meta.id = slug(m.meta.name); }, false));
    const sl = (k, label) => { const i = el('input', { type: 'number', step: 5, value: S[k] }); i.addEventListener('change', () => commit(() => { const n = Object.assign({}, S, { [k]: Number(i.value) }); return ED.setSlab(m, n.x0, n.x1, n.z0, n.z1); })); return el('label', { class: 'ed-f' }, el('span', { text: label }), i); };
    mapBox.replaceChildren(el('h4', { text: 'This map' }), el('label', { class: 'ed-f' }, el('span', { text: 'Name' }), name),
      el('div', { class: 'ed-grid2' }, sl('x0', 'West edge (m)'), sl('x1', 'East edge (m)'), sl('z0', 'North edge (m)'), sl('z1', 'South edge (m)')),
      el('p', { class: 'ed-note', text: (S.x1 - S.x0) + ' by ' + (S.z1 - S.z0) + ' m. Each side can be 20 to 400 m. Larger maps load only the part near the car.' }));
    // errors and warnings
    const items = [];
    if (errors.length) { items.push(el('p', { class: 'ed-bad', text: 'This map cannot be saved yet:' })); errors.slice(0, 5).forEach(x => items.push(el('p', { class: 'ed-note', text: (x.path ? x.path + ' ' : '') + x.msg }))); }
    else items.push(el('p', { class: 'ed-good', text: 'The map is valid.' }));
    warns.slice(0, 5).forEach(w => items.push(el('p', { class: 'ed-warn', text: w })));
    errBox.replaceChildren(...items);
  }

  // ---------- top bar ----------
  bExit.addEventListener('click', () => {
    if (st.dirty && !bExit.dataset.armed) { bExit.dataset.armed = '1'; bExit.textContent = 'Discard changes?'; setTimeout(() => { delete bExit.dataset.armed; bExit.textContent = 'Exit editor'; }, 3500); return; }
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    onExit && onExit();
  });
  bUndo.addEventListener('click', undo); bRedo.addEventListener('click', redo);
  function replaceMap(m, note) {
    ED.ensureFeatures(m); st.map = m; st.undo = []; st.redo = []; st.dirty = false; selected = null; view.s = 0; resize(); fit(); after(true); if (note) toast(note);
  }
  bNew.addEventListener('click', () => replaceMap(ED.newMapFrom(base, { id: 'my-map', name: 'My map' }), 'Started a new map.'));
  bHill.addEventListener('click', () => replaceMap(ED.clone(base), 'Opened a copy of Hill Loop. Change the name before you save.'));
  bOpen.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0]; file.value = ''; if (!f) return;
    try { replaceMap(parseMap(await f.text()), 'Opened ' + f.name + '.'); }
    catch (err) { toast(err instanceof MapError ? err.message : 'That file could not be opened.'); }
  });
  bSave.addEventListener('click', () => {
    const r = validateMap(st.map);
    if (!r.ok) { toast('Fix the problems first: ' + describeErrors(r, 2)); return; }
    const blob = new Blob([JSON.stringify(st.map, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (st.map.meta.id || 'map') + '.json';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    st.dirty = false; status.textContent = 'Saved ' + a.download; toast('Saved ' + a.download + '. Open it from Maps, Open a map file.');
  });
  const play = kind => { const r = validateMap(st.map); if (!r.ok) { toast(describeErrors(r, 2)); return; } autosave(); onPlay && onPlay(ED.clone(st.map), kind, st); };
  bPlayCar.addEventListener('click', () => play('car')); bPlayBike.addEventListener('click', () => play('bike'));

  // ---------- start ----------
  setTool('select'); check(); refreshUi(); resize(); fit(); draw();
  // offer the last unsaved draft (once, only if this is a fresh editor)
  if (!state) {
    try {
      const d = localStorage.getItem(DRAFT_KEY);
      if (d) {
        const draft = parseMap(d);
        const b = el('button', { class: 'btn', type: 'button', text: 'Restore last draft: ' + draft.meta.name });
        b.addEventListener('click', () => { replaceMap(draft, 'Draft restored.'); b.remove(); });
        top.after(el('div', { class: 'ed-draft' }, b));
      }
    } catch (e) {}
  }

  return {
    state: st,
    toClient(x, z) { const r = cv.getBoundingClientRect(); return [r.left + X(x), r.top + Z(z)]; },
    escape() { if (tool !== 'select') setTool('select'); else { selected = null; refreshUi(); draw(); } },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); clearTimeout(saveT); ro.disconnect();
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
      ground = null; W = null; lines = null; cv.width = cv.height = 0;
      root.replaceChildren();
    }
  };
}
