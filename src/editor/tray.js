// The picture tray (E5): what you can place, as pictures. Buildings, trees and lamps are drawn from the real game pieces (same scenery code, same colours);
// the rest are small pixel pictures in the same blocky style. Nothing here edits the map: a tile only says which tool and which options it stands for.
import { createWorld } from '../engine/world.js';
import { createScenery } from '../engine/scenery.js';

// ---- building styles (width, depth, height, colours) ----
export const BUILDINGS = {
  house: { label: 'House', w: 8, d: 6, h: 6, wall: '#E8B4A0', trim: '#B98470' },
  shop: { label: 'Shop', w: 8, d: 5, h: 5, wall: '#F0E0A8', trim: '#C2A55A', shop: true },
  block: { label: 'Block', w: 12, d: 8, h: 9, wall: '#D6CBE6', trim: '#9D8DB8' },
  tower: { label: 'Tower', w: 6, d: 6, h: 16, wall: '#C9D9E8', trim: '#8DA2B5' },
  kiosk: { label: 'Kiosk', w: 3, d: 3, h: 3, wall: '#BFDCCB', trim: '#86A894', shop: true }
};
export const TREES = { small: { label: 'Tree', h: 3.6, r: 1.3 }, big: { label: 'Big tree', h: 6.5, r: 2.4 } };

// ---- the tiles, by section ----
// tool = the editor tool the tile switches on; set = options it sets; art = how it is drawn
export const SECTIONS = [
  { id: 'road', label: 'Roads', tiles: [
    { id: 'road-straight', tool: 'road', set: { curve: false }, label: 'Straight', art: 'roadStraight', tip: 'Drag from one point to another. Ends snap to roads and a junction is made where roads cross.' },
    { id: 'road-curve', tool: 'road', set: { curve: true }, label: 'Curved', art: 'roadCurve', tip: 'Click points along the way, double-click (or Enter) to finish. The road bends smoothly through them.' },
    { id: 'slope', tool: 'slope', set: {}, label: 'Slope', art: 'slope', tip: 'Click a road to set its height there. Drag a gold dot up or down to change a slope. Alt-click a dot to remove it.' },
    { id: 'start', tool: 'start', set: {}, label: 'Start', art: 'flag', tip: 'Click on a road to move the start of the lap.' }
  ] },
  { id: 'build', label: 'Buildings', tiles: Object.keys(BUILDINGS).map(k => ({ id: 'b-' + k, tool: 'building', set: { style: k }, label: BUILDINGS[k].label, art: 'b:' + k, tip: 'Click to place. Drag to draw your own size. Turn it afterwards by dragging the ring, or press Face road.' })) },
  { id: 'side', label: 'Roadside', tiles: [
    { id: 't-small', tool: 'tree', set: { tree: 'small' }, label: 'Tree', art: 't:small', tip: 'Click to plant a tree.' },
    { id: 't-big', tool: 'tree', set: { tree: 'big' }, label: 'Big tree', art: 't:big', tip: 'Click to plant a big tree.' },
    { id: 'lamp', tool: 'lamp', set: {}, label: 'Lamp', art: 'lamp', tip: 'Click to place a street lamp.' }
  ] },
  { id: 'traffic', label: 'Traffic', tiles: [
    { id: 'sig-light', tool: 'signal', set: { sig: 'light' }, label: 'Signal', art: 'signal', tip: 'Click to place a traffic light (used in a later version).' },
    { id: 'sig-police', tool: 'signal', set: { sig: 'police' }, label: 'Police', art: 'police', tip: 'Click to place a traffic police post (used in a later version).' },
    { id: 'crossing', tool: 'crossing', set: {}, label: 'Crossing', art: 'crossing', tip: 'Click on a road to place a pedestrian crossing (used in a later version).' }
  ] },
  { id: 'crowd', label: 'Crowd', tiles: [
    ['pedestrian', 'People', 'person'], ['cow', 'Cows', 'cow'], ['buffalo', 'Buffalo', 'buffalo'], ['goat', 'Goats', 'goat'], ['dog', 'Dogs', 'dog'], ['vehicle', 'Vehicles', 'auto']
  ].map(([k, l, a]) => ({ id: 'sp-' + k, tool: 'spawn', set: { spawn: k }, label: l, art: a, tip: 'Drag a rectangle where they appear (used in a later version).' })) },
  { id: 'ground', label: 'Ground', tiles: [
    { id: 'g-hills', tool: 'terrain', set: { blob: 'hills' }, label: 'Hill', art: 'sw:hills', tip: 'Click to add a hill area.' },
    { id: 'g-rock', tool: 'terrain', set: { blob: 'rock' }, label: 'Rock', art: 'sw:rock', tip: 'Click to add a rock area.' },
    { id: 'g-scrub', tool: 'terrain', set: { blob: 'scrub' }, label: 'Scrub', art: 'sw:scrub', tip: 'Click to add a scrub area.' },
    { id: 'g-lake', tool: 'terrain', set: { blob: 'lake' }, label: 'Lake', art: 'sw:lake', tip: 'Click to add a lake.' },
    { id: 'raise', tool: 'sculpt', set: { brush: 'raise' }, label: 'Raise', art: 'raise', tip: 'Drag over the ground to lift it.' },
    { id: 'lower', tool: 'sculpt', set: { brush: 'lower' }, label: 'Lower', art: 'lower', tip: 'Drag over the ground to dig it.' },
    { id: 'smooth', tool: 'sculpt', set: { brush: 'smooth' }, label: 'Smooth', art: 'smooth', tip: 'Drag to even out bumps.' },
    { id: 'grade', tool: 'sculpt', set: { brush: 'grade' }, label: 'Flatten', art: 'grade', tip: 'Press where you want the level, then drag: the ground is brought to that height.' },
    ...[['grass', 'Grass'], ['sand', 'Sand'], ['paver', 'Pavers'], ['soil', 'Mud'], ['rock', 'Stone'], ['erase', 'Un-paint']].map(([k, l]) => ({ id: 'p-' + k, tool: 'paint', set: { paint: k }, label: l, art: 'sw:' + k, tip: k === 'erase' ? 'Drag to take painted ground back to what the terrain would be.' : 'Drag to paint this surface onto open ground. Roads are never changed.' }))
  ] }
];
export const BASIC = [
  { id: 'select', tool: 'select', set: {}, label: 'Select', art: 'cursor', tip: 'Click a thing to see it and change it. Drag it to move it.' },
  { id: 'pan', tool: 'pan', set: {}, label: 'Look', art: 'eye', tip: 'Drag to turn and tilt the view (Shift or Space + drag slides it). Wheel or pinch zooms toward the pointer. Right-drag also turns.' },
  { id: 'drop', tool: 'drop', set: {}, label: 'Drive here', art: 'flag', tip: 'Click anywhere to test drive from that spot. Closing the drive brings you back here.' },
  { id: 'erase', tool: 'erase', set: {}, label: 'Erase', art: 'trash', tip: 'Click a thing to remove it. On empty ground it removes a terrain area.' }
];

// ---- pixel pictures (blocky, like the game) ----
const PAL = { '.': null, k: '#23252B', w: '#F4F1EA', g: '#7E8288', r: '#D8392B', y: '#F2C200', b: '#2B5FD9', s: '#E8B98A', n: '#8A5A33', t: '#C9A66B', d: '#4A4E55', p: '#E89AA5', o: '#F28C28', l: '#5BAA4A', h: '#EDE3C9', a: '#4FA3D1', e: '#3A2E26' };
const SPRITES = {
  person: ['....kkk.....', '...kssss....', '...kssss....', '....ss......', '...bbbb.....', '..bbbbbb....', '..sbbbbs....', '..sbbbbs....', '...kkkk.....', '...k..k.....', '...k..k.....', '..kk..kk....'],
  cow: ['.h......h....', '.hkkkkkkkkk..', '..wwkwwwwwk..', '.pwwkwwkwwk..', '.ppwwwwkwwk..', '..kwwwwwwww..', '...wwwwwwww..', '...k.k..k.k..', '...k.k..k.k..'],
  buffalo: ['hh.......hh..', 'hddddddddddd.', '.dddddddddd..', 'pddddddddddd.', 'ppdddddddddd.', '.dddddddddd..', '..dddddddd...', '..d.d..d.d...', '..k.k..k.k...'],
  goat: ['.h.........', '.ht.....t...', '.ttttttttt..', 'ttwttttttt..', '.tttttttwt..', '..ttttttt...', '..t.t..t.t..', '..k.k..k.k..'],
  dog: ['..........n..', '..nn.....nnn.', '.nnnnnnnnnn..', 'nknnnnnnnnn..', '.nnnnnnnnn...', '..nnnnnnnn...', '..n.n..n.n...', '..k.k..k.k...'],
  auto: ['....yyyyyy....', '...yyyyyyyy...', '...ykkyykky...', '..yyyyyyyyyy..', '.yyyyyyyyyyyy.', '.kkyyyyyyyykk.', '.kwkyyyyyykwk.', '..k........k..'],
  signal: ['....gg....', '...kkkk...', '...krrk...', '...kyyk...', '...kllk...', '...kkkk...', '....gg....', '....gg....', '....gg....', '...gggg...'],
  police: ['...www....', '..wwwww...', '...ssss...', '...ssss...', '..bbbbbb..', '.sbbwwbbs.', '.sbbbbbbs.', '..bbbbbb..', '...b..b...', '...k..k...'],
  crossing: ['dddddddddddd', 'dwwdwwdwwdww', 'dwwdwwdwwdww', 'dwwdwwdwwdww', 'dwwdwwdwwdww', 'dddddddddddd'],
  flag: ['.k..........', '.kkkkkkkkk..', '.kkwwkkwwk..', '.kwwkkwwkk..', '.kkkkkkkkk..', '.k..........', '.k..........', '.k..........', '.k..........', 'kkk.........'],
  cursor: ['k.........', 'kk........', 'kwk.......', 'kwwk......', 'kwwwk.....', 'kwwwwk....', 'kwwwwwk...', 'kwwwkkkk..', 'kwkwk.....', 'kk.kwk....', 'k..kwk....', '....kk....'],
  eye: ['...kkkkkk...', '.kkwwwwwwkk.', 'kwwwwaaawwwk', 'kwwwaakaawwk', 'kwwwaakaawwk', 'kwwwwaaawwwk', '.kkwwwwwwkk.', '...kkkkkk...'],
  trash: ['....kkkk....', '.kkkkkkkkkk.', '.kggggggggk.', '..kgkgkgkk..', '..kgkgkgkk..', '..kgkgkgkk..', '..kgkgkgkk..', '..kggggggk..', '...kkkkkk...']
};
function drawSprite(c, rows, S, bg) {
  c.fillStyle = bg; c.fillRect(0, 0, S, S);
  const h = rows.length, w = Math.max(...rows.map(r => r.length)), u = Math.floor(S * 0.78 / Math.max(w, h)), ox = Math.floor((S - w * u) / 2), oy = Math.floor((S - h * u) / 2);
  rows.forEach((row, j) => [...row].forEach((ch, i) => { const col = PAL[ch]; if (col) { c.fillStyle = col; c.fillRect(ox + i * u, oy + j * u, u, u); } }));
}
function hashJ(i, j) { let h = Math.imul(i, 374761393) + Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function drawSwatch(c, hex, S, edge) {
  const n = 8, u = S / n, r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const f = 0.88 + hashJ(i, j) * 0.2; c.fillStyle = `rgb(${Math.min(255, r * f) | 0},${Math.min(255, g * f) | 0},${Math.min(255, b * f) | 0})`; c.fillRect(i * u, j * u, u + 0.5, u + 0.5); }
  if (edge) { c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2; c.strokeRect(1, 1, S - 2, S - 2); }
}
const SW = { hills: '#6FBF4A', rock: '#8E959B', scrub: '#C9B27A', lake: '#4FA3D1', grass: '#6FBF4A', sand: '#E6D6A2', paver: '#BDB6A6', soil: '#7B5A3C', erase: '#D9D5CC' };
function drawArt(art, S) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d'), bg = '#DCE8E2';
  if (SPRITES[art]) { drawSprite(c, SPRITES[art], S, bg); return cv; }
  if (art.startsWith('sw:')) {
    const k = art.slice(3); drawSwatch(c, SW[k] || '#888', S, true);
    if (k === 'hills') { c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.moveTo(S * 0.1, S * 0.8); c.lineTo(S * 0.4, S * 0.3); c.lineTo(S * 0.65, S * 0.8); c.fill(); c.fillStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.moveTo(S * 0.45, S * 0.8); c.lineTo(S * 0.68, S * 0.42); c.lineTo(S * 0.9, S * 0.8); c.fill(); }
    if (k === 'erase') { c.strokeStyle = '#C0392B'; c.lineWidth = 4; c.beginPath(); c.moveTo(S * 0.25, S * 0.25); c.lineTo(S * 0.75, S * 0.75); c.moveTo(S * 0.75, S * 0.25); c.lineTo(S * 0.25, S * 0.75); c.stroke(); }
    return cv;
  }
  c.fillStyle = bg; c.fillRect(0, 0, S, S);
  const grass = '#6FBF4A';
  if (art === 'roadStraight' || art === 'roadCurve' || art === 'slope') {
    drawSwatch(c, grass, S, false);
    c.lineCap = 'butt'; c.strokeStyle = '#C7C2B6'; c.lineWidth = S * 0.36;
    const path = () => { c.beginPath(); if (art === 'roadCurve') { c.moveTo(-4, S * 0.78); c.bezierCurveTo(S * 0.45, S * 0.95, S * 0.45, S * 0.05, S + 4, S * 0.3); } else { c.moveTo(-4, S * 0.7); c.lineTo(S + 4, S * 0.3); } };
    path(); c.stroke(); c.strokeStyle = '#4B5159'; c.lineWidth = S * 0.26; path(); c.stroke();
    c.strokeStyle = '#F3E9B5'; c.lineWidth = S * 0.04; c.setLineDash([S * 0.09, S * 0.07]); path(); c.stroke(); c.setLineDash([]);
    if (art === 'slope') { c.fillStyle = '#F2A900'; c.strokeStyle = '#222'; c.lineWidth = 2; c.beginPath(); c.moveTo(S * 0.58, S * 0.62); c.lineTo(S * 0.86, S * 0.62); c.lineTo(S * 0.86, S * 0.3); c.closePath(); c.fill(); c.stroke(); }
    return cv;
  }
  if (art === 'raise' || art === 'lower' || art === 'smooth' || art === 'grade') {
    drawSwatch(c, grass, S, false);
    const hh = { raise: [0.1, 0.55, 0.1], lower: [0.1, -0.5, 0.1], smooth: [0.05, 0.25, -0.05], grade: [0.2, 0.2, 0.2] }[art];
    c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.moveTo(0, S * 0.75);
    for (let i = 0; i <= 20; i++) { const x = i / 20, y = art === 'grade' ? 0.2 : hh[1] * Math.exp(-Math.pow((x - 0.5) * 4, 2)) + (art === 'smooth' ? 0.04 * Math.sin(x * 20) : 0); c.lineTo(S * x, S * (0.72 - y * 0.8)); }
    c.lineTo(S, S); c.lineTo(0, S); c.closePath(); c.fill();
    c.strokeStyle = '#F2A900'; c.lineWidth = 3; c.beginPath(); for (let i = 0; i <= 20; i++) { const x = i / 20, y = art === 'grade' ? 0.2 : hh[1] * Math.exp(-Math.pow((x - 0.5) * 4, 2)) + (art === 'smooth' ? 0.04 * Math.sin(x * 20) : 0); const px = S * x, py = S * (0.72 - y * 0.8); i ? c.lineTo(px, py) : c.moveTo(px, py); } c.stroke();
    c.fillStyle = '#222'; c.font = '700 ' + (S * 0.3) + 'px system-ui'; c.textAlign = 'center';
    c.fillText(art === 'raise' ? '+' : art === 'lower' ? '−' : art === 'smooth' ? '~' : '=', S * 0.5, S * 0.3);
    return cv;
  }
  if (art === 'lamp') {
    drawSwatch(c, grass, S, false); c.fillStyle = '#2F3439'; c.fillRect(S * 0.46, S * 0.22, S * 0.08, S * 0.6); c.fillRect(S * 0.46, S * 0.2, S * 0.3, S * 0.07); c.fillStyle = '#FFE9A3'; c.fillRect(S * 0.64, S * 0.27, S * 0.16, S * 0.07);
    return cv;
  }
  drawSwatch(c, '#BDB6A6', S, false); return cv;
}

// ---- real voxel pieces, drawn with the game's own scenery code ----
// Returns { 'b:house': dataUrl, 't:small': dataUrl, ... }. Everything made here (renderer, geometry, context) is released before it returns.
export function renderPieces(base, S = 112) {
  const THREE = window.THREE, out = {};
  if (!THREE) return out;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch (e) { return out; }
  renderer.setSize(S, S, false); renderer.setPixelRatio(1); renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x8a7352, 0.75)); const sun = new THREE.DirectionalLight(0xfff2dc, 0.85); sun.position.set(-3, 5, -2); scene.add(sun);
  const cubeGeo = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const X = -37, Z = 2;
  function shoot(key, map, P, ground, rad) {
    const World = createWorld(map), SC = createScenery(World, map);
    const prims = SC.buildObjects(), v = 0.25;
    const y0 = ground;
    prims.push(SC.B(X - rad - 1, y0 - 0.5, Z - rad - 1, X + rad + 1, y0, Z + rad + 1, 0x6FBF4A, 0.1));
    const data = SC.voxelTiled(prims, v, 1), mesh = new THREE.InstancedMesh(cubeGeo, mat, Math.max(1, data.count)), d = new THREE.Object3D(), col = new THREE.Color();
    for (let i = 0; i < data.count; i++) { d.position.set(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]); d.scale.setScalar(v); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix); col.setRGB(data.col[i * 3], data.col[i * 3 + 1], data.col[i * 3 + 2]); mesh.setColorAt(i, col); }
    mesh.count = data.count; scene.add(mesh);
    const r = rad * 1.25 + P.h * 0.35;
    cam.left = -r; cam.right = r; cam.top = r * 0.95; cam.bottom = -r * 1.05; cam.updateProjectionMatrix();
    cam.position.set(X + 30, y0 + P.h * 0.5 + 28, Z + 30); cam.lookAt(X, y0 + P.h * 0.45, Z);
    renderer.render(scene, cam); out[key] = renderer.domElement.toDataURL('image/png');
    scene.remove(mesh); mesh.dispose();
  }
  const clean = () => { const m = JSON.parse(JSON.stringify(base)); m.pads = []; m.scenery = []; return m; };
  try {
    Object.entries(BUILDINGS).forEach(([k, b]) => {
      const m = clean(); m.pads.push({ id: 'p', x0: X - b.w / 2 - 0.3, x1: X + b.w / 2 + 0.3, z0: Z - b.d / 2 - 0.3, z1: Z + b.d / 2 + 0.3, h: 0, m: 2 });
      m.scenery.push({ t: 'bldgY', id: 'p', pad: 'p', cx: X, cz: Z, w: b.w, depth: b.d, h: b.h, yaw: 0, wall: b.wall, trim: b.trim, cols: ['#7FA5C7', '#F5D77A', '#7FA5C7'], ys: b.h > 5 ? [1.5, 2.8, 4.1, 5.4, 6.7, 8, 9.3, 10.6].filter(y => y + 0.9 < b.h - 0.4) : [1.5], ww: 0.8, pitch: 1.3 });
      if (b.shop) m.scenery.push({ t: 'prims', of: 'p', p: [['B', X - b.w / 2 + 0.3, 2.5, Z - b.d / 2 - 0.9, X + b.w / 2 - 0.3, 2.8, Z - b.d / 2, '#2E8B57', 0.03]], solids: [] });
      shoot('b:' + k, m, { h: b.h }, 0, Math.max(b.w, b.d) / 2);
    });
    Object.entries(TREES).forEach(([k, t]) => { const m = clean(); m.scenery.push({ t: 'tree', id: 't', x: X, z: Z, h: t.h, r: t.r }); shoot('t:' + k, m, { h: t.h + t.r }, createWorld(m).heightAt(X, Z), t.r + 1); });
  } catch (e) { console.warn('piece pictures failed', e); }
  cubeGeo.dispose(); mat.dispose(); renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) {}
  return out;
}

// A tile's picture as a canvas or an <img> source.
export function artUrl(art, pieces, S = 96) {
  if (pieces && pieces[art]) return pieces[art];
  if (art.startsWith('b:') || art.startsWith('t:')) { const cv = drawArt(art.startsWith('b:') ? 'sw:rock' : 'sw:grass', S); return cv.toDataURL(); }
  return drawArt(art, S).toDataURL();
}
