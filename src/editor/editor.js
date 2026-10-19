// Map editor screen (Phase 4). Loaded only when the editor is opened, and everything it holds is released when it closes.
// A top-down canvas over a shaded picture of the real ground (made by the same world maths as the game), with tools on the side.
import '../styles/editor.css';
import { createWorld } from '../engine/world.js';
import { validateMap, describeErrors } from '../maps/format.js';
import { parseMap, MapError } from '../maps/manager.js';
import * as ED from './model.js';
import { createView3D } from './view3d.js';
import { sampleCurve } from '../engine/curve.js';
import { SECTIONS, BASIC, BUILDINGS, TREES, renderPieces, artUrl } from './tray.js';

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
  let mode = '3d', v3 = null, ovT = 0, hoverRaf = 0, lastPtr = null;
  let tool = 'select', selected = null, W = null, ground = null, dirtyGround = true, groundT = 0, raf = 0, saveT = 0, disposed = false;
  let drag = null, hover = null, spaceDown = false, errors = [], warns = [], lines = null;
  const opts = { h0: '', h1: '', slopeH: 2, blob: 'hills', blobSize: 8, bh: 6, shopName: 'Corner Store', lampE: 1, sig: 'light', cross: 6, spawn: 'pedestrian', spawnN: 3, curve: false, style: 'house', tree: 'small', brush: 'raise', paint: 'grass', brushD: 8, brushS: 0.4, faceRoad: true, yaw: 0 };

  // ---------- layout ----------
  const cv = el('canvas', { class: 'ed-canvas', tabindex: '0', 'aria-label': 'Map canvas' });
  const status = el('div', { class: 'ed-status', role: 'status' });
  const toolBar = el('div', { class: 'ed-tray' });
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
  const nav = el('div', { class: 'ed-nav', role: 'toolbar', 'aria-label': 'View' });
  const navBtn = (label, title, fn) => { const b = el('button', { class: 'ed-navbtn', type: 'button', title, 'aria-label': title, text: label }); b.addEventListener('click', fn); nav.append(b); return b; };
  const compass = el('button', { class: 'ed-compass', type: 'button', title: 'North up', 'aria-label': 'Compass: click to face north' }, el('span', { text: 'N' }));
  const stage = el('div', { class: 'ed-stage' }, cv, nav, status);
  root.replaceChildren(top, el('div', { class: 'ed-body' }, stage, side), file);

  // ---------- the picture tray ----------
  const pieces = {};                                   // real-piece pictures, filled in a moment after the editor opens
  const tabBar = el('div', { class: 'ed-tabs', role: 'tablist', 'aria-label': 'Sections' }), tileGrid = el('div', { class: 'ed-tiles' }), basicRow = el('div', { class: 'ed-basic' });
  let section = SECTIONS[0].id;
  const tileBtn = (t) => {
    const img = el('img', { class: 'ed-pic', alt: '', width: 56, height: 56, draggable: 'false' });
    img.src = artUrl(t.art, pieces, 96); img.dataset.art = t.art;
    const b = el('button', { class: 'ed-tool', type: 'button', 'data-tool': t.tool, 'data-tile': t.id, 'aria-pressed': 'false', title: t.tip, 'aria-label': t.label }, img, el('span', { text: t.label }));
    b.addEventListener('click', () => setTool(t.tool, t));
    return b;
  };
  function renderTray() {
    basicRow.replaceChildren(...BASIC.map(tileBtn));
    tabBar.replaceChildren(...SECTIONS.map(sx => { const b = el('button', { class: 'ed-tab', type: 'button', role: 'tab', 'aria-selected': String(sx.id === section), text: sx.label }); b.addEventListener('click', () => { section = sx.id; renderTray(); }); return b; }));
    tileGrid.replaceChildren(...SECTIONS.find(sx => sx.id === section).tiles.map(tileBtn));
    root.querySelectorAll('.ed-tool').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tile === (tile && tile.id))));
  }
  toolBar.append(basicRow, tabBar, tileGrid);

  // ---------- state and history ----------
  const snap = () => JSON.stringify(st.map);
  function commit(fn, groundChanged = true, box = null) {
    const before = snap();
    const res = fn(st.map);
    if (typeof res === 'string' && res.startsWith('!')) { st.map = JSON.parse(before); toast(res.slice(1)); return false; }
    st.undo.push(before); if (st.undo.length > 80) st.undo.shift();
    st.redo.length = 0; st.dirty = true;
    after(groundChanged, box);
    return res === undefined ? true : res;
  }
  function after(groundChanged, box) {
    if (groundChanged) { dirtyGround = true; lines = null; }
    lines = null;
    check(); refreshUi();
    if (v3 && !errors.length) v3.invalidate(groundChanged ? (box || null) : false, true, st.map);
    draw();
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
    if (v3) v3.resize();
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    if (!view.s) fit();
    draw();
  }
  const ro = new ResizeObserver(() => { if (!disposed) resize(); }); ro.observe(stage);

  // ---------- drawing ----------
  function draw() {
    if (disposed) return;
    if (mode === '3d') { clearTimeout(ovT); ovT = setTimeout(() => { if (!disposed) drawStatic3d(); }, 0); return; }
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
  let tile = BASIC[0];
  const findTile = id => BASIC.concat(...SECTIONS.map(s => s.tiles)).find(t => t.id === id);
  function setTool(id, t) {
    const tt = t || (tile && tile.tool === id ? tile : BASIC.concat(...SECTIONS.map(s => s.tiles)).find(x => x.tool === id));
    tool = id; tile = tt || BASIC[0]; drag = null; curvePts = [];
    Object.assign(opts, tile.set || {});
    root.querySelectorAll('.ed-tool').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tile === tile.id)));
    hint.textContent = tile.tip || '';
    buildOpts(); draw();
    activeCanvas().style.cursor = id === 'pan' ? 'grab' : id === 'select' ? 'default' : 'crosshair';
  }
  function num(label, key, min, max, step = 1) {
    const i = el('input', { type: 'number', min, max, step, value: opts[key], inputmode: 'decimal' });
    i.addEventListener('input', () => { opts[key] = i.value === '' ? '' : Number(i.value); });
    return el('label', { class: 'ed-f' }, el('span', { text: label }), i);
  }
  function check1(label, key, after) {
    const cb = el('input', { type: 'checkbox' }); cb.checked = !!opts[key]; cb.addEventListener('change', () => { opts[key] = cb.checked; if (after) after(); draw(); });
    return el('label', { class: 'ed-f row' }, cb, el('span', { text: label }));
  }
  function buildOpts() {
    const rows = [];
    if (tool === 'road') {
      rows.push(num('Start height (m, blank = follow ground)', 'h0', -3, 11, 0.5), num('End height (m, blank = follow ground)', 'h1', -3, 11, 0.5));
      if (opts.curve) rows.push(el('p', { class: 'ed-note', text: curvePts.length ? curvePts.length + ' point' + (curvePts.length > 1 ? 's' : '') + ' so far. Double-click or press Enter to finish, Esc to cancel.' : 'Click the first point of the road.' }));
    }
    if (tool === 'slope') rows.push(num('Height at the point (m)', 'slopeH', -3, 11, 0.5));
    if (tool === 'terrain') rows.push(num('Radius (m)', 'blobSize', 2, 40, 1));
    if (tool === 'sculpt' || tool === 'paint') {
      rows.push(num('Brush size (m across)', 'brushD', 2, 40, 1));
      if (tool === 'sculpt' && opts.brush !== 'grade') rows.push(num('Strength (m per stroke)', 'brushS', 0.1, 2, 0.1));
      rows.push(el('p', { class: 'ed-note', text: 'Hold the button and drag. Roads and kerbs are never reshaped; buildings keep their flat plot.' }));
    }
    if (tool === 'building') {
      const b = BUILDINGS[opts.style] || BUILDINGS.house;
      rows.push(num('Height (m)', 'bh', 2.5, 30, 0.5), check1('Turn to face the nearest road', 'faceRoad'), el('p', { class: 'ed-note', text: b.label + ': ' + b.w + ' by ' + b.d + ' m. Click to place, or drag to draw your own size. Press [ or ] to turn by 15 degrees.' }));
      if (b.shop) rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Shop name' }), (() => { const t = el('input', { type: 'text', maxlength: 40, value: opts.shopName }); t.addEventListener('input', () => { opts.shopName = t.value; }); return t; })()));
    }
    if (tool === 'lamp') rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Arm points' }), (() => { const s = el('select', {}, el('option', { value: 1, text: 'toward south (+z)' }), el('option', { value: -1, text: 'toward north (-z)' })); s.value = opts.lampE; s.addEventListener('change', () => { opts.lampE = s.value; }); return s; })()));
    if (tool === 'crossing') rows.push(num('Length (m)', 'cross', 2, 20, 1));
    if (tool === 'spawn') rows.push(num('How many', 'spawnN', 1, 30, 1));
    optBox.replaceChildren(...rows); optBox.hidden = !rows.length;
  }
  const numOpt = (k, d) => (opts[k] === '' || opts[k] == null || Number.isNaN(Number(opts[k])) ? d : Number(opts[k]));

  function snapPt(x, z, toRoad = false) {
    if (toRoad) {
      lines = lines || ED.polylines(st.map);
      const n = ED.nearestRoad(st.map, x, z, 2.5 + tolM(), lines);
      if (n) return { x: Math.round(n.x * 100) / 100, z: Math.round(n.z * 100) / 100, road: n };
    }
    return { x: Math.round(x), z: Math.round(z), road: null };
  }
  function roadHeightAt(p) { const w = WW(); return p.road ? w.edgeH(p.road.edge, p.road.t) : Math.max(0, w.column(p.x, p.z, 0.25).h); }
  function pickAt(x, z) { lines = lines || ED.polylines(st.map); return ED.hitTest(st.map, x, z, 1.2 + 0.75 * tolM(), lines); }
  function roadPsi(n) { return WW().edgePoint(n.edge, n.t, 0).psi; }

  // Where a new building would stand, how it is turned, and its size.
  function buildingPlan(x, z, w, d) {
    const b = BUILDINGS[opts.style] || BUILDINGS.house;
    const o = { cx: Math.round(x * 2) / 2, cz: Math.round(z * 2) / 2, w: w || b.w, depth: d || b.d, h: numOpt('bh', b.h), yaw: Number(opts.yaw) || 0, wall: b.wall, trim: b.trim, shop: b.shop ? { name: opts.shopName } : null };
    if (opts.faceRoad !== false) {
      try { lines = lines || ED.polylines(st.map); const r = ED.nearestRoad(st.map, o.cx, o.cz, 40, lines); if (r) o.yaw = Math.round(Math.atan2(-(r.x - o.cx), -(r.z - o.cz)) * 180 / Math.PI * 2) / 2; } catch (e) { /* keep yaw */ }
    }
    return o;
  }
  const spanBox = (cx, cz, r) => [cx - r, cz - r, cx + r, cz + r];

  function pointerAction(kind, x, z, e) {
    const m = st.map;
    if (kind === 'click') {
      switch (tool) {
        case 'select': { selected = pickAny(e); refreshUi(); draw(); break; }
        case 'terrain': commit(() => ED.addBlob(m, opts.blob, x, z, opts.blobSize, opts.blobSize, 1), true, spanBox(x, z, opts.blobSize * 3)); break;
        case 'tree': { const t = TREES[opts.tree] || TREES.small, j = Math.abs(Math.round(x * 7 + z * 3)) % 9; commit(() => ED.addTree(m, x, z, t.h + j * 0.1, t.r + (Math.abs(Math.round(x + z * 5)) % 7) * 0.08), false); break; }
        case 'lamp': commit(() => ED.addLamp(m, x, z, Number(opts.lampE)), false); break;
        case 'building': {
          const o = buildingPlan(x, z), big = Math.max(o.w, o.depth) / 2 + 6;
          const r = commit(() => ED.addBuildingY(m, o), true, spanBox(o.cx, o.cz, big));
          if (typeof r === 'string') { selected = { kind: o.shop ? 'shop' : 'building', id: r }; refreshUi(); }
          break;
        }
        case 'road': if (opts.curve) addCurvePoint(x, z, e); break;
        case 'drop': dropHere(x, z, 'car'); break;
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
          const h = pickAny(e);
          if (h && h.kind === 'road') { if (h.edge === 0) toast('The oval loop cannot be erased.'); else commit(() => ED.removeRoad(m, h.edge)); }
          else if (h) commit(() => ED.removeById(m, h.id), h.kind === 'building' || h.kind === 'shop');
          else if (!commit(() => ED.removeBlobNear(m, x, z))) { /* toast already shown */ }
          selected = null; refreshUi(); break;
        }
      }
    } else if (kind === 'drag') {
      const a = drag.a, b = drag.cur;
      if (tool === 'road' && !opts.curve) {
        const sa = drag.sa, sb = snapPt(b[0], b[1], true);
        const h0 = opts.h0 === '' ? roadHeightAt(sa) : Number(opts.h0), h1 = opts.h1 === '' ? roadHeightAt(sb) : Number(opts.h1);
        const r = commit(() => ED.addRoad(m, [sa.x, sa.z], [sb.x, sb.z], h0, h1));
        if (r !== false) { selected = { kind: 'road', edge: m.roads.edges.length - 1 }; refreshUi(); }
      } else if (tool === 'building') {
        const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2, o = buildingPlan(cx, cz, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        const r = commit(() => ED.addBuildingY(m, o), true, spanBox(cx, cz, Math.max(o.w, o.depth) / 2 + 6));
        if (typeof r === 'string') { selected = { kind: o.shop ? 'shop' : 'building', id: r }; refreshUi(); }
      } else if (tool === 'spawn') {
        commit(() => ED.addSpawnArea(m, opts.spawn, a[0], a[1], b[0], b[1], numOpt('spawnN', 3)), false);
      }
    }
  }

  // ---------- curved roads: click points, finish with a double-click or Enter ----------
  let curvePts = [], lastClickT = 0;
  function addCurvePoint(x, z, e) {
    const sp = snapPt(x, z, true), now = performance.now(), last = curvePts[curvePts.length - 1];
    if (curvePts.length >= 2 && last && Math.hypot(last[0] - sp.x, last[1] - sp.z) < 1.5 + tolM() * 3 && now - lastClickT < 450) { finishCurve(); return; }
    lastClickT = now;
    if (!last || Math.hypot(last[0] - sp.x, last[1] - sp.z) > 0.5) curvePts.push([sp.x, sp.z]);
    buildOpts(); draw();
  }
  function finishCurve() {
    if (curvePts.length < 2) { toast('A curved road needs at least two points.'); return; }
    const pts = curvePts.slice(), w = WW();
    const h0 = opts.h0 === '' ? Math.max(0, w.column(pts[0][0], pts[0][1], 0.25).h) : Number(opts.h0), h1 = opts.h1 === '' ? Math.max(0, w.column(pts[pts.length - 1][0], pts[pts.length - 1][1], 0.25).h) : Number(opts.h1);
    curvePts = [];
    const r = commit(() => ED.addCurve(st.map, pts, h0, h1));
    if (r !== false) { selected = { kind: 'road', edge: st.map.roads.edges.length - 1 }; }
    buildOpts(); refreshUi(); draw();
  }

  // ---------- live edits (drags): applied to the map as you move, one undo step when you let go ----------
  function liveApply(fn, box) {
    const r = fn(st.map);
    if (typeof r === 'string' && r.startsWith('!')) return r;
    st.dirty = true; lines = null; dirtyGround = true;
    if (v3) v3.invalidate(box || null, true, st.map); else draw();
    return r;
  }
  function endLive(before, groundBox) {
    if (snap() === before) return false;
    st.undo.push(before); if (st.undo.length > 80) st.undo.shift(); st.redo.length = 0; st.dirty = true;
    check(); refreshUi(); draw();
    clearTimeout(saveT); saveT = setTimeout(autosave, 800);
    return true;
  }
  // brush stamps
  function stamp(x, z, s) {
    const r = clamp(numOpt('brushD', 8), 2, 40) / 2, box = spanBox(x, z, r + 3);
    if (tool === 'paint') return liveApply(m => ED.paintBrush(m, x, z, r, opts.paint), box);
    if (opts.brush === 'grade') return liveApply(m => ED.gradeTo(m, x, z, r * 0.7, s.level, r * 0.3 + 1), box);
    return liveApply(m => ED.sculptBrush(m, x, z, r, numOpt('brushS', 0.4), opts.brush), box);
  }

  // ---------- 3D: things you can click, and what is drawn over the scene ----------
  const WW = () => (mode === '3d' && v3 && v3.world) || W;
  function pickables() {
    const w = WW(), m = st.map, shops = new Set((m.features.shops || []).map(q => q.id)), out = [];
    if (!w) return out;
    m.scenery.forEach(b => {
      if (b.t === 'bldgN' || b.t === 'bldgY') {
        const pd = w.pad(b.pad); if (!pd) return;
        const y0 = pd.h - 0.4, y1 = pd.h + b.h + 0.4, kind = shops.has(b.id) ? 'shop' : 'building';
        if (b.t === 'bldgN') out.push({ id: b.id, kind, shape: 'obb', cx: (b.x0 + b.x1) / 2, cz: b.zf + b.depth / 2, hx: (b.x1 - b.x0) / 2, hz: b.depth / 2, c: 1, s: 0, y0, y1 });
        else { const a = (b.yaw || 0) * Math.PI / 180; out.push({ id: b.id, kind, shape: 'obb', cx: b.cx, cz: b.cz, hx: b.w / 2, hz: b.depth / 2, c: Math.cos(a), s: Math.sin(a), y0, y1 }); }
      } else if (b.t === 'tree' && b.id) { const y = w.heightAt(b.x, b.z); out.push({ id: b.id, kind: 'tree', shape: 'cyl', cx: b.x, cz: b.z, r: Math.max(0.9, b.r), y0: y, y1: y + b.h + b.r }); }
      else if (b.t === 'lamp' && b.id) { const y = w.heightAt(b.x, b.z); out.push({ id: b.id, kind: 'lamp', shape: 'cyl', cx: b.x, cz: b.z, r: 0.9, y0: y, y1: y + 4.5 }); }
    });
    return out;
  }
  // What is under the pointer: a standing thing first, otherwise whatever lies on the ground there.
  function pickAny(e) {
    if (mode === '3d' && v3) {
      const g = v3.pickGround(e.clientX, e.clientY), th = v3.pickThings(e.clientX, e.clientY, pickables());
      if (th && (!g || th.t <= g.t + 2)) return { kind: th.kind, id: th.id };
      return g ? ED.hitTest(st.map, g.x, g.z, 1.2 + 6 * v3.mpp(), lines || (lines = ED.polylines(st.map))) : null;
    }
    const [px, py] = local(e); return pickAt(wx(px), wz(py));
  }
  function itemBox(id) {
    const m = st.map, w = WW(), b = m.scenery.find(q => q.id === id && (q.t === 'bldgN' || q.t === 'bldgY'));
    if (!b || !w || !w.pad(b.pad)) return null;
    const y0 = w.pad(b.pad).h;
    if (b.t === 'bldgN') return [(b.x0 + b.x1) / 2, b.zf + b.depth / 2, (b.x1 - b.x0) / 2, b.depth / 2, 0, y0 - 0.4, y0 + b.h + 0.5];
    return [b.cx, b.cz, b.w / 2, b.depth / 2, b.yaw || 0, y0 - 0.4, y0 + b.h + 0.5];
  }
  function drawStatic3d() {
    if (!v3 || !v3.world) return;
    const ov = v3.ov, m = st.map, f = m.features || {}, isSel = id => selected && selected.id === id;
    ov.use('static'); v3.clearOverlay('static');
    (f.spawnAreas || []).forEach(a => {
      const col = isSel(a.id) ? 0xffffff : 0x7A3FB5;
      ov.patch((a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2, (a.x1 - a.x0) / 2, (a.z1 - a.z0) / 2, 0, 0x7A3FB5, 0.3);
      ov.drape([[a.x0, a.z0], [a.x1, a.z0], [a.x1, a.z1], [a.x0, a.z1], [a.x0, a.z0]], col, 0.3);
    });
    (f.crossings || []).forEach(a => {
      const yaw = a.psi * 180 / Math.PI;
      for (let k = -2; k <= 2; k++) { const c = Math.cos(a.psi), s = Math.sin(a.psi); ov.patch(a.x + (k * 0.96) * c, a.z - (k * 0.96) * s, 0.3, a.len / 2, yaw, isSel(a.id) ? 0xffee55 : 0xffffff, 0.9, 0.12); }
    });
    (f.signals || []).forEach(a => { const col = a.kind === 'police' ? 0x2B5FD9 : 0xD8392B; ov.post(a.x, a.z, 3.6, 0x333333, 0.12); ov.dot(a.x, v3.groundH(a.x, a.z) + 3.8, a.z, col, 0.45); if (isSel(a.id)) ov.ring(a.x, a.z, 1.2, 0xffffff); });
    m.roads.junctions.forEach(j => ov.ring(j.x, j.z, 1.6, 0xffffff, 0.3, 24, 0.6));
    ov.post(m.start.x, m.start.z, 2.6, 0xF2A900, 0.15); ov.ring(m.start.x, m.start.z, 1.2, 0xF2A900);
    lines = lines || ED.polylines(m);
    m.roads.edges.forEach((e, i) => {
      const pts = lines[i], selRoad = selected && selected.kind === 'road' && selected.edge === i;
      if (selRoad) ov.drape(pts.map(p => [p[0], p[1]]), 0xffffff, 0.5);
      if (selRoad || tool === 'slope') e.profile.forEach(p => { const q = pointAt(pts, p[0]); ov.dot(q[0], (v3.world.edgeH(i, p[0])) + 1.2, q[1], 0xF2A900, 0.45); });
      if (e.type === 'curve' && (selRoad || tool === 'road')) e.pts.forEach(p => ov.dot(p[0], v3.groundH(p[0], p[1]) + 0.9, p[1], 0x35c4ff, 0.4));
    });
    const ri = tool === 'select' ? rotInfo() : null;
    if (ri) {
      ov.ring(ri.cx, ri.cz, ri.r, 0x35c4ff, 0.35, 64, 0.9);
      ov.drape([[ri.cx, ri.cz], ri.hp], 0x35c4ff, 0.35, 0.9);
      ov.dot(ri.hp[0], v3.groundH(ri.hp[0], ri.hp[1]) + 0.6, ri.hp[1], 0x35c4ff, 0.55);
      if (ri.type === 'bldg') { const sb = ED.setbackOf(m, selected.id, lines); if (sb) { ov.drape([[sb.fx, sb.fz], [sb.rx, sb.rz]], 0xffd23f, 0.5); ov.dot(sb.rx, v3.groundH(sb.rx, sb.rz) + 0.5, sb.rz, 0xffd23f, 0.3); } }
    }
    if (selected && selected.id) {
      const b = itemBox(selected.id), it = ED.getItem(m, selected.id);
      if (b) ov.box(b[0], b[1], b[2] + 0.2, b[3] + 0.2, b[4], b[5], b[6], 0xffffff);
      else if (it && (it.t === 'tree' || it.t === 'lamp')) ov.ring(it.x, it.z, Math.max(1, it.r || 0.8), 0xffffff, 0.3);
    }
    drawDyn3d();
  }
  function drawDyn3d() {
    if (!v3 || !v3.world) return;
    const ov = v3.ov; ov.use('dyn'); v3.clearOverlay('dyn');
    if (drag && drag.kind === 'road') ov.drape([drag.a, drag.cur], 0xffffff, 0.5);
    else if (drag && drag.kind) {
      const a = drag.a, b = drag.cur, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
      ov.patch((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, 0xffffff, 0.25); ov.drape([[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]], 0xffffff, 0.5);
    } else if (hover && tool === 'building') {
      const o = buildingPlan(hover[0], hover[1]);
      ov.box(o.cx, o.cz, o.w / 2, o.depth / 2, o.yaw, v3.groundH(o.cx, o.cz), v3.groundH(o.cx, o.cz) + o.h, 0xffffff, 0.9);
      ov.patch(o.cx, o.cz, o.w / 2, o.depth / 2, o.yaw, 0xffffff, 0.25);
      const a = o.yaw * Math.PI / 180, fx = o.cx - Math.sin(a) * (o.depth / 2 + 1.5), fz = o.cz - Math.cos(a) * (o.depth / 2 + 1.5);
      ov.drape([[o.cx, o.cz], [fx, fz]], 0xffd23f, 0.5);
    } else if (hover && (tool === 'sculpt' || tool === 'paint')) ov.ring(hover[0], hover[1], numOpt('brushD', 8) / 2, 0xffffff, 0.4, 48);
    else if (hover && (tool === 'tree' || tool === 'lamp' || tool === 'signal' || tool === 'terrain')) ov.ring(hover[0], hover[1], tool === 'terrain' ? opts.blobSize : 1, 0xffffff, 0.4);
    if (tool === 'road' && opts.curve && curvePts.length) {
      const pts = curvePts.slice(); if (hover) pts.push([hover[0], hover[1]]);
      if (pts.length >= 2) { const c = sampleCurve(pts); ov.drape(c.xs.map((x, i) => [x, c.zs[i]]), 0xffffff, 0.5); }
      curvePts.forEach(p => ov.dot(p[0], v3.groundH(p[0], p[1]) + 0.9, p[1], 0x35c4ff, 0.4));
    }
  }

  // ---------- pointer handling ----------
  const ptrs = new Map();
  let pinch = null, panning = null, orbiting = null, moved = 0, downAt = null;
  const activeCanvas = () => (mode === '3d' && v3 ? v3.canvas : cv);
  const local = e => { const r = activeCanvas().getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // The world point under a pointer event (ground in 3D, flat map in the fallback view).
  function toXZ(e) {
    if (mode === '3d' && v3) { const g = v3.pickGround(e.clientX, e.clientY); return g ? [g.x, g.z] : null; }
    const [px, py] = local(e); return [wx(px), wz(py)];
  }
  const tolM = () => (mode === '3d' && v3 ? 8 * v3.mpp() : 8 / view.s);
  // ---------- things you can grab: the turn ring, road handles, and the selected thing itself ----------
  let rot = null, mv = null, hd = null, stroke = null;
  function rotInfo() {
    if (!selected || !selected.id) return null;
    const m = st.map, b = itemBox(selected.id);
    if (b) { const a = b[4] * Math.PI / 180, r = Math.max(b[2], b[3]) + 2; return { type: 'bldg', cx: b[0], cz: b[1], hx: b[2], hz: b[3], yaw: b[4], hp: [b[0] - Math.sin(a) * r, b[1] - Math.cos(a) * r], r }; }
    const f = m.features || {}, g = (f.signals || []).find(q => q.id === selected.id) || (f.crossings || []).find(q => q.id === selected.id);
    if (g) return { type: 'feat', cx: g.x, cz: g.z, hp: [g.x + Math.cos(g.psi) * 2.5, g.z - Math.sin(g.psi) * 2.5], r: 2.5 };
    return null;
  }
  function grabAt(e) {
    if (!(mode === '3d' && v3) || tool !== 'select') return null;
    const near = (x, y, z, px = 22) => { const p = v3.project(x, y, z); return Math.hypot(p[0] - e.clientX, p[1] - e.clientY) < px; };
    const ri = rotInfo();
    if (ri && near(ri.hp[0], v3.groundH(ri.hp[0], ri.hp[1]) + 0.6, ri.hp[1])) return { kind: 'rot', ri };
    if (selected && selected.kind === 'road') {
      const i = selected.edge, ed = st.map.roads.edges[i]; if (!ed) return null;
      lines = lines || ED.polylines(st.map);
      if (ed.type === 'curve') for (let k = 0; k < ed.pts.length; k++) if (near(ed.pts[k][0], v3.groundH(ed.pts[k][0], ed.pts[k][1]) + 0.9, ed.pts[k][1])) return { kind: 'cp', edge: i, idx: k };
      for (let k = 0; k < ed.profile.length; k++) { const q = pointAt(lines[i], ed.profile[k][0]); if (near(q[0], v3.world.edgeH(i, ed.profile[k][0]) + 1.2, q[1])) return { kind: 'ph', edge: i, idx: k, t: ed.profile[k][0], h: ed.profile[k][1] }; }
    }
    return null;
  }
  const snap15 = (v, e) => (e.altKey ? v : Math.round(v / 15) * 15);
  const boxAround = (x, z, r) => [x - r, z - r, x + r, z + r];
  // Apply whatever drag is in progress to the pointer's current position (once per frame).
  function applyDrags(e, q) {
    if (rot && q) {
      const ri = rot.ri;
      if (ri.type === 'bldg') { const yaw = snap15(Math.atan2(-(q[0] - ri.cx), -(q[1] - ri.cz)) * 180 / Math.PI, e); liveApply(m => ED.turnBuilding(m, rot.id, yaw), boxAround(ri.cx, ri.cz, Math.max(ri.hx, ri.hz) + 8)); }
      else { const psi = snap15(Math.atan2(-(q[1] - ri.cz), q[0] - ri.cx) * 180 / Math.PI, e) * Math.PI / 180; liveApply(m => ED.turnFeature(m, rot.id, psi), false); }
      return true;
    }
    if (mv && q) {
      if (!mv.moved) return true;
      const nx = Math.round((q[0] + mv.off[0]) * 2) / 2, nz = Math.round((q[1] + mv.off[1]) * 2) / 2;
      liveApply(m => ED.moveItem(m, mv.id, nx, nz), boxAround(nx, nz, mv.r));
      return true;
    }
    if (hd) {
      if (hd.kind === 'cp' && q) { liveApply(m => ED.moveCurvePoint(m, hd.edge, hd.idx, Math.round(q[0] * 2) / 2, Math.round(q[1] * 2) / 2)); return true; }
      if (hd.kind === 'ph') { const h = Math.round((hd.h + (hd.y0 - e.clientY) * v3.mpp() * 0.5) * 2) / 2; liveApply(m => ED.setRoadHeight(m, hd.edge, hd.t, h)); return true; }
    }
    if (stroke && q) {
      const r = numOpt('brushD', 8) / 2;
      if (!stroke.last || Math.hypot(q[0] - stroke.last[0], q[1] - stroke.last[1]) >= Math.max(0.6, r * 0.35)) { stroke.last = q; stamp(q[0], q[1], stroke); }
      return true;
    }
    return false;
  }
  const dragging = () => rot || mv || hd || stroke;
  function onDown(e) {
    const c = e.currentTarget; c.setPointerCapture(e.pointerId); c.focus({ preventScroll: true });
    const [px, py] = local(e); ptrs.set(e.pointerId, [px, py, e.clientX, e.clientY]);
    const is3 = mode === '3d' && v3;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), a: Math.atan2(b[1] - a[1], b[0] - a[0]), s: view.s, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, cx: (a[2] + b[2]) / 2, cy: (a[3] + b[3]) / 2 };
      drag = null; panning = null; orbiting = null; if (is3) v3.panEnd(); return;
    }
    const shift = e.shiftKey || spaceDown;
    if (is3) {
      if (e.button === 1 || (e.button === 0 && shift && tool === 'pan') || (e.button === 2 && shift) || (e.button === 0 && spaceDown)) { v3.panStart(e.clientX, e.clientY); panning = { three: true }; c.style.cursor = 'grabbing'; return; }
      if (e.button === 2 || (e.button === 0 && tool === 'pan')) { orbiting = { x: e.clientX, y: e.clientY }; c.style.cursor = 'grabbing'; return; }
    } else if (tool === 'pan' || e.button === 1 || e.button === 2 || spaceDown) { panning = { px, py, cx: view.cx, cz: view.cz }; c.style.cursor = 'grabbing'; return; }
    moved = 0; downAt = [px, py];
    if (e.button !== 0) return;
    const p = toXZ(e); if (!p) { drag = null; return; }
    const [x, z] = p;
    const g = grabAt(e);
    if (g) {
      if (g.kind === 'rot') rot = { id: selected.id, ri: g.ri, before: snap() };
      else hd = { ...g, before: snap(), y0: e.clientY };
      return;
    }
    if (tool === 'sculpt' || tool === 'paint') {
      stroke = { before: snap(), last: null, level: Math.round(WW().column(x, z, 0.25).h * 10) / 10 };
      stroke.last = [x, z]; stamp(x, z, stroke); return;
    }
    if (tool === 'select') {
      const pre = pickAny(e);
      if (pre && selected && pre.id && pre.id === selected.id && pre.kind !== 'road') {
        const b = itemBox(pre.id), it = ED.getItem(st.map, pre.id), f = st.map.features || {};
        const c = b ? [b[0], b[1]] : it && it.x != null ? [it.x, it.z] : (f.spawnAreas || []).filter(a => a.id === pre.id).map(a => [(a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2])[0];
        if (c) { mv = { id: pre.id, before: snap(), off: [c[0] - x, c[1] - z], moved: false, r: b ? Math.max(b[2], b[3]) + 8 : 8 }; return; }
      }
    }
    if (tool === 'road' && opts.curve) { drag = { kind: null }; }
    else if (tool === 'road') { const sa = snapPt(x, z, true); drag = { kind: 'road', a: [sa.x, sa.z], sa, cur: [sa.x, sa.z] }; }
    else if (tool === 'building' || tool === 'spawn') { const sp = snapPt(x, z); drag = { kind: tool, a: [sp.x, sp.z], cur: [sp.x, sp.z] }; }
    else drag = { kind: null };
    draw();
  }
  function onMove(e) {
    const [px, py] = local(e); if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [px, py, e.clientX, e.clientY]);
    const is3 = mode === '3d' && v3;
    lastPtr = e;
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const mcx = (a[2] + b[2]) / 2, mcy = (a[3] + b[3]) / 2;
      if (is3) {
        v3.panStart(pinch.cx, pinch.cy); v3.panMove(mcx, mcy); v3.panEnd();
        v3.zoom(pinch.d / d, mcx, mcy); v3.turn(-(ang - pinch.a));
        pinch.d = d; pinch.a = ang; pinch.cx = mcx; pinch.cy = mcy; return;
      }
      const bx = wx(pinch.mx), bz = wz(pinch.my);
      view.s = clamp(pinch.s * d / pinch.d, 1.2, 60);
      view.cx = bx - (pinch.mx - cw / 2) / view.s; view.cz = bz - (pinch.my - ch / 2) / view.s;
      draw(); return;
    }
    if (orbiting) { v3.orbit(e.clientX - orbiting.x, e.clientY - orbiting.y); orbiting.x = e.clientX; orbiting.y = e.clientY; return; }
    if (panning) { if (panning.three) v3.panMove(e.clientX, e.clientY); else { view.cx = panning.cx - (px - panning.px) / view.s; view.cz = panning.cz - (py - panning.py) / view.s; draw(); } return; }
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0; if (disposed || !lastPtr) return;
      const q = toXZ(lastPtr);
      if (q) { hover = [Math.round(q[0]), Math.round(q[1])]; status.textContent = statusText(q[0], q[1]); }
      if (dragging() && applyDrags(lastPtr, q)) { if (mode === '3d') drawDyn3d(); return; }
      if (drag && downAt) {
        const [qx, qy] = local(lastPtr); moved = Math.max(moved, Math.hypot(qx - downAt[0], qy - downAt[1]));
        if (q && drag.kind === 'road') { const sp = snapPt(q[0], q[1], true); drag.cur = [sp.x, sp.z]; }
        else if (q && drag.kind) { const sp = snapPt(q[0], q[1]); drag.cur = [sp.x, sp.z]; }
      }
      if (mode === '3d') drawDyn3d(); else draw();
    });
    if (downAt) { moved = Math.max(moved, Math.hypot(px - downAt[0], py - downAt[1])); if (mv && moved > 6) mv.moved = true; }
  }
  function onUp(e) {
    ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) pinch = null; return; }
    const c = e.currentTarget;
    if (orbiting) { orbiting = null; c.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'; return; }
    if (panning) { if (panning.three) v3.panEnd(); panning = null; c.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'; return; }
    if (rot || hd || stroke || (mv && mv.moved)) {
      const o = rot || hd || stroke || mv; const q = toXZ(e);
      if (!stroke && q) applyDrags(e, q);
      const before = o.before; rot = hd = stroke = null; const wasMv = mv; mv = null;
      if (endLive(before)) { if (wasMv || before) after(true, null); }
      drag = null; downAt = null; draw(); return;
    }
    if (mv) { mv = null; drag = null; downAt = null; if (q0(e)) pointerAction('click', q0(e)[0], q0(e)[1], e); draw(); return; }
    if (!drag) return;
    // the last drag position may not have been processed yet: refresh it from this event
    const q = toXZ(e);
    if (q && drag.kind) { const sp = drag.kind === 'road' ? snapPt(q[0], q[1], true) : snapPt(q[0], q[1]); drag.cur = [sp.x, sp.z]; }
    if (drag.kind && moved > 6) pointerAction('drag', 0, 0, e); else if (q) pointerAction('click', q[0], q[1], e);
    drag = null; downAt = null; draw();
  }
  const q0 = e => toXZ(e);
  function onCancel(e) { ptrs.delete(e.pointerId); drag = null; panning = null; pinch = null; orbiting = null; rot = hd = stroke = mv = null; if (v3) v3.panEnd(); draw(); }
  function onWheel(e) {
    e.preventDefault();
    if (mode === '3d' && v3) { v3.zoom(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); return; }
    const [px, py] = local(e), bx = wx(px), bz = wz(py);
    view.s = clamp(view.s * Math.exp(-e.deltaY * 0.0015), 1.2, 60);
    view.cx = bx - (px - cw / 2) / view.s; view.cz = bz - (py - ch / 2) / view.s; draw();
  }
  const handlers = { pointerdown: onDown, pointermove: onMove, pointerup: onUp, pointercancel: onCancel, contextmenu: e => e.preventDefault() };
  function bindCanvas(c) { Object.entries(handlers).forEach(([k, f]) => c.addEventListener(k, f)); c.addEventListener('wheel', onWheel, { passive: false }); }
  bindCanvas(cv);
  const onKey = e => {
    if (disposed || root.hidden) return;
    const tag = e.target && e.target.tagName;
    if (e.key === ' ' ) { if (tag === 'CANVAS') { spaceDown = e.type === 'keydown'; e.preventDefault(); } return; }
    if (e.type !== 'keydown') return;
    const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selected && selected.id) { e.preventDefault(); clip = selected.id; toast('Copied. Ctrl+V pastes at the pointer.'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); const q = lastPtr ? toXZ(lastPtr) : null; if (q) pasteAt(q[0] != null ? q[0] : q.x, q[1] != null ? q[1] : q.z); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); deleteSelected(); return; }
    if (e.key === 'Enter' && tool === 'road' && opts.curve && curvePts.length) { e.preventDefault(); finishCurve(); return; }
    if (e.key === '[' || e.key === ']') {
      const d = e.key === '[' ? 15 : -15;
      if (selected && ED.getItem(st.map, selected.id) && /^bldg/.test(ED.getItem(st.map, selected.id).t)) { const b = ED.getItem(st.map, selected.id); commit(() => ED.turnBuilding(st.map, selected.id, (b.yaw || 0) + d), true, boxAround(b.cx != null ? b.cx : (b.x0 + b.x1) / 2, b.cz != null ? b.cz : b.zf + b.depth / 2, 16)); }
      else { opts.yaw = (Number(opts.yaw) || 0) + d; opts.faceRoad = false; buildOpts(); draw(); }
      return;
    }
    if (mode === '3d' && v3) {
      const k = e.key.toLowerCase();
      if (k === 'q') v3.turn(-Math.PI / 12); else if (k === 'e') v3.turn(Math.PI / 12);
      else if (k === 'r') v3.tilt(0.08); else if (k === 'f') v3.tilt(-0.08);
      else if (k === '=' || k === '+') v3.zoom(0.85); else if (k === '-') v3.zoom(1.18);
      else if (k === 'home') v3.preset('iso');
    }
  };
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);

  function statusText(x, z) {
    let h = '';
    try { const w = WW(); if (w) h = ' · ground ' + w.column(x, z, 0.25).h.toFixed(1) + ' m'; } catch (e) {}
    return 'x ' + x.toFixed(1) + ', z ' + z.toFixed(1) + h + (st.dirty ? ' · unsaved changes' : '');
  }

  // ---------- panels ----------
  // ---------- copy, rows, drop-in test drive (E6) ----------
  let clip = null;
  function copyThenPaste(id) {
    const it = ED.getItem(st.map, id); if (!it) return;
    const cx = it.cx != null ? it.cx : it.x != null ? it.x : (it.x0 + it.x1) / 2, cz = it.cz != null ? it.cz : it.z != null ? it.z : it.zf != null ? it.zf + it.depth / 2 : (it.z0 + it.z1) / 2;
    clip = id; pasteAt(cx + 6, cz + 6);
  }
  function pasteAt(x, z) {
    if (!clip || !ED.getItem(st.map, clip)) { toast('Copy something first (select it, then Ctrl+C).'); return; }
    const src = ED.getItem(st.map, clip), big = Math.max(src.w || 0, src.depth || 0, 8) + 8;
    const r = commit(() => ED.duplicateItem(st.map, clip, x, z), true, spanBox(x, z, big));
    if (typeof r === 'string') {
      const f = st.map.features || {}, n = ED.getItem(st.map, r);
      const kind = (f.signals || []).some(q => q.id === r) ? 'signal' : (f.crossings || []).some(q => q.id === r) ? 'crossing' : (f.spawnAreas || []).some(q => q.id === r) ? 'spawn' : n && /^bldg/.test(n.t) ? ((f.shops || []).some(q => q.id === r) ? 'shop' : 'building') : (n ? n.t : 'building');
      selected = { kind, id: r }; refreshUi(); draw();
    }
  }
  function rowAlong(id) {
    const it = ED.getItem(st.map, id), m = st.map; if (!it) return;
    const w = it.w != null ? it.w : it.x1 - it.x0, d = it.depth, cx = it.cx != null ? it.cx : (it.x0 + it.x1) / 2, cz = it.cz != null ? it.cz : it.zf + d / 2;
    lines = lines || ED.polylines(m);
    const r = ED.nearestRoad(m, cx, cz, 60, lines); if (!r) { toast('There is no road near this building.'); return; }
    const W0 = WW(); if (!W0) return;
    const side = Math.hypot(W0.edgePoint(r.edge, r.t, 1).x - cx, W0.edgePoint(r.edge, r.t, 1).z - cz) < Math.hypot(W0.edgePoint(r.edge, r.t, -1).x - cx, W0.edgePoint(r.edge, r.t, -1).z - cz) ? 1 : -1;
    const sb = ED.setbackOf(m, id, lines), shopName = ((m.features.shops || []).find(q => q.id === id) || {}).name;
    const n = commit(() => ED.frontage(m, { edge: r.edge, side, style: { w, d, h: it.h, wall: it.wall, trim: it.trim }, setback: sb ? sb.dist : 2, gap: 1, t0: r.t + w / 2 + 1, shop: shopName ? { name: shopName } : null }), true, [Math.min(cx, r.x) - 200, Math.min(cz, r.z) - 200, Math.max(cx, r.x) + 200, Math.max(cz, r.z) + 200]);
    if (typeof n === 'number') toast(n ? 'Placed ' + n + ' more along the road.' : 'No room along the road beyond this building.');
  }
  function dropHere(x, z, kind) {
    const r = validateMap(st.map); if (!r.ok) { toast(describeErrors(r, 2)); return; }
    const mm = ED.clone(st.map), dp = ED.dropPoint(mm, x, z);
    ED.setStart(mm, dp.x, dp.z, dp.psi); autosave();
    onPlay && onPlay(mm, kind || 'car', st);
  }

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
          if (it.t === 'bldgN' || it.t === 'bldgY') {
            const cx = it.t === 'bldgY' ? it.cx : (it.x0 + it.x1) / 2, cz = it.t === 'bldgY' ? it.cz : it.zf + it.depth / 2, bx = boxAround(cx, cz, Math.max(it.w || it.x1 - it.x0, it.depth) / 2 + 12);
            const h = el('input', { type: 'number', min: 2.5, max: 30, step: 0.5, value: it.h });
            h.addEventListener('change', () => commit(() => ED.setBuildingHeight(m, it.id, Number(h.value)), false));
            rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Height (m)' }), h));
            const yaw = el('input', { type: 'number', min: -180, max: 180, step: 5, value: it.yaw || 0 });
            yaw.addEventListener('change', () => commit(() => ED.turnBuilding(m, it.id, Number(yaw.value)), true, bx));
            rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Turn (degrees, 0 = front faces north)' }), yaw));
            const tb = (txt, title, fn) => { const b = el('button', { class: 'btn', type: 'button', title, text: txt }); b.addEventListener('click', fn); return b; };
            rows.push(el('div', { class: 'ed-row3' },
              tb('\u21BA 15\u00B0', 'Turn left 15 degrees ( [ )', () => commit(() => ED.turnBuilding(m, it.id, (it.yaw || 0) + 15), true, bx)),
              tb('\u21BB 15\u00B0', 'Turn right 15 degrees ( ] )', () => commit(() => ED.turnBuilding(m, it.id, (it.yaw || 0) - 15), true, bx)),
              tb('Face road', 'Turn the front to face the nearest road', () => commit(() => ED.faceRoad(m, it.id), true, bx))));
            const sb = ED.setbackOf(m, it.id, lines);
            if (sb) {
              const sbi = el('input', { type: 'number', min: 0, max: 60, step: 0.5, value: sb.dist });
              sbi.addEventListener('change', () => commit(() => ED.setSetback(m, it.id, Number(sbi.value)), true, bx));
              rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Space between the front and the road edge (m)' }), sbi));
            }
            rows.push(el('div', { class: 'ed-row3' },
              tb('Copy', 'Make a copy next to it (Ctrl+C then Ctrl+V pastes at the pointer)', () => copyThenPaste(it.id)),
              tb('Row along road', 'Line up copies of this building along the same side of the road, all facing it', () => rowAlong(it.id)),
              tb('Drive here', 'Test drive starting next to this building', () => dropHere(it.cx != null ? it.cx : (it.x0 + it.x1) / 2, it.cz != null ? it.cz : it.zf + it.depth / 2, 'car'))));
            const sh = (m.features.shops || []).find(q => q.id === it.id);
            if (sh) { const t = el('input', { type: 'text', maxlength: 40, value: sh.name }); t.addEventListener('change', () => commit(() => ED.renameShop(m, it.id, t.value), false)); rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Shop name' }), t)); }
            rows.push(el('p', { class: 'ed-note', text: 'Drag the blue dot on the ring to turn it. Drag the building to move it.' }));
          }
          if (selected.kind === 'signal' || selected.kind === 'crossing') {
            const yaw = el('input', { type: 'number', min: -360, max: 360, step: 15, value: Math.round(it.psi * 180 / Math.PI) });
            yaw.addEventListener('change', () => commit(() => ED.turnFeature(m, it.id, Number(yaw.value) * Math.PI / 180), false));
            rows.push(el('label', { class: 'ed-f' }, el('span', { text: 'Direction (degrees)' }), yaw));
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
    ED.ensureFeatures(m); st.map = m; st.undo = []; st.redo = []; st.dirty = false; selected = null; view.s = 0; resize(); fit();
    if (v3) { v3.setMap(st.map); v3.fitView(); }
    after(true); if (note) toast(note);
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

  // ---------- 3D and flat views ----------
  const bFlat = navBtn('Flat', 'Switch between the 3D view and the flat map', () => setMode(mode === '3d' ? 'flat' : '3d'));
  const nav3 = [
    navBtn('3D', 'Tilted view of the whole map', () => v3 && v3.preset('iso')), navBtn('Top', 'Look straight down', () => v3 && v3.preset('top')),
    navBtn('Street', 'Street level, from the ground', () => v3 && v3.preset('street')),
    navBtn('\u21BA', 'Turn the view left (Q)', () => v3 && v3.turn(-Math.PI / 12)), navBtn('\u21BB', 'Turn the view right (E)', () => v3 && v3.turn(Math.PI / 12)),
    navBtn('\u25B2', 'Tilt up (R)', () => v3 && v3.tilt(0.1)), navBtn('\u25BC', 'Tilt down (F)', () => v3 && v3.tilt(-0.1)),
    navBtn('+', 'Zoom in', () => v3 && v3.zoom(0.8)), navBtn('\u2212', 'Zoom out', () => v3 && v3.zoom(1.25))
  ];
  stage.append(compass);
  compass.append(el('i', { class: 'ed-needle' }));
  compass.addEventListener('click', () => v3 && v3.setYaw(0));
  function make3d() {
    if (v3) return true;
    v3 = createView3D(stage, {
      onFrame: c => { st.cam3 = { tx: c.tx, ty: c.ty, tz: c.tz, yaw: c.yaw, pitch: c.pitch, dist: c.dist }; compass.style.setProperty('--yaw', c.yaw + 'rad'); },
      onFail: msg => { console.warn('3D view unavailable:', msg); }
    });
    if (!v3) return false;
    bindCanvas(v3.canvas);
    v3.setMap(st.map);
    if (st.cam3) Object.assign(v3.cam, st.cam3);
    return true;
  }
  function setMode(m) {
    if (m === '3d' && !make3d()) { toast('The 3D view is not available on this device, so this is the flat map.'); m = 'flat'; }
    mode = m;
    if (m === 'flat' && v3) { v3.dispose(); v3 = null; dirtyGround = true; W = null; }
    cv.style.display = m === 'flat' ? '' : 'none';
    if (v3) v3.canvas.style.display = m === '3d' ? '' : 'none';
    nav3.forEach(b => { b.hidden = m !== '3d'; }); compass.hidden = m !== '3d';
    bFlat.textContent = m === '3d' ? 'Flat' : '3D';
    activeCanvas().style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
    resize(); draw();
  }

  // ---------- start ----------
  renderTray();
  setMode('3d'); setTool('select', BASIC[0]); check(); refreshUi(); resize(); fit(); draw();
  setTimeout(() => { if (disposed) return; try { Object.assign(pieces, renderPieces(base)); renderTray(); } catch (e) { console.warn(e); } }, 120);
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
    toClient(x, z) {
      if (mode === '3d' && v3) { const p = v3.project(x, v3.groundH(x, z), z); return [p[0], p[1]]; }
      const r = cv.getBoundingClientRect(); return [r.left + X(x), r.top + Z(z)];
    },
    get mode() { return mode; },
    // where the turn handle of the selected thing is on screen (for tests and for touch hints)
    rotHandle() { const ri = rotInfo(); if (!ri || !v3) return null; const p = v3.project(ri.hp[0], v3.groundH(ri.hp[0], ri.hp[1]) + 0.6, ri.hp[1]); return { client: [p[0], p[1]], centre: [ri.cx, ri.cz], r: ri.r }; },
    handles() { const out = []; if (selected && selected.kind === 'road' && v3) { const e = st.map.roads.edges[selected.edge]; if (e && e.type === 'curve') e.pts.forEach((q, i) => { const p = v3.project(q[0], v3.groundH(q[0], q[1]) + 0.9, q[1]); out.push({ idx: i, client: [p[0], p[1]] }); }); } return out; },
    get view3d() { return v3; },
    setMode,
    escape() { if (curvePts.length) { curvePts = []; buildOpts(); draw(); } else if (tool !== 'select') setTool('select', BASIC[0]); else { selected = null; refreshUi(); draw(); } },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); clearTimeout(saveT); ro.disconnect();
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
      if (v3) { v3.dispose(); v3 = null; }
      ground = null; W = null; lines = null; cv.width = cv.height = 0;
      root.replaceChildren();
    }
  };
}
