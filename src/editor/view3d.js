// The 3D map viewport (E4). Draws the map as the game draws it (same ground builder, same scenery code, same lights), only with bigger cubes
// (about 50 cm) so a whole map stays light. The camera orbits, tilts, zooms to the cursor and pans on the ground, and can never go under it.
// Everything it makes is released in dispose(). No editing logic lives here: it only draws, picks and moves the camera.
import { createWorld } from '../engine/world.js';
import { createScenery } from '../engine/scenery.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PITCH_MIN = 0.1, PITCH_MAX = 1.553;
const CUBE_BUDGET_COLUMNS = 110000;

export function createView3D(container, { getMap, onFrame, onFail }) {
  const THREE = window.THREE;
  if (!THREE) { onFail && onFail('three.js is not available'); return null; }
  const canvas = document.createElement('canvas');
  canvas.className = 'ed-canvas'; canvas.tabIndex = 0; canvas.setAttribute('aria-label', '3D map view');
  container.prepend(canvas);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { canvas.remove(); onFail && onFail('WebGL is not available'); return null; }
  const small = window.innerWidth < 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.setClearColor(0xBFE0F2, 1);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x8a7352, 0.6));
  const sun = new THREE.DirectionalLight(0xfff2dc, 0.8);
  sun.castShadow = true; sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 600; sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const cubeGeo = new THREE.BoxGeometry(1, 1, 1), cubeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const world = new THREE.Group(), overlay = new THREE.Group(), overlayDyn = new THREE.Group(); scene.add(world, overlay, overlayDyn);
  let layer = 'static';

  // ---------- the map ----------
  let map = null, W = null, SC = null, grid = null, v = 0.5;
  const chunks = new Map();            // "a,b" -> InstancedMesh
  const dirty = new Set();             // chunk keys waiting to be rebuilt
  let objMesh = null, objDirty = false, objAt = 0, shadowDirty = true, disposed = false, raf = 0, need = true, building = false;

  function makeMesh(data, cast) {
    const m = new THREE.InstancedMesh(cubeGeo, cubeMat, Math.max(1, data.count));
    const d = new THREE.Object3D(), c = new THREE.Color();
    for (let i = 0; i < data.count; i++) {
      d.position.set(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]); d.scale.setScalar(data.v); d.updateMatrix();
      m.setMatrixAt(i, d.matrix); c.setRGB(data.col[i * 3], data.col[i * 3 + 1], data.col[i * 3 + 2]); m.setColorAt(i, c);
    }
    if (!data.count) m.setColorAt(0, c);
    m.count = data.count; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = cast; m.receiveShadow = true; m.frustumCulled = false;
    return m;
  }
  const freeMesh = m => { if (!m) return; world.remove(m); m.dispose(); };

  // Cube size for the editor: 50 cm where the map is small, coarser where a big map would need too many cubes.
  function pickVoxel(slab) {
    const area = (slab.x1 - slab.x0) * (slab.z1 - slab.z0);
    return Math.max(0.5, Math.ceil(Math.sqrt(area / CUBE_BUDGET_COLUMNS) * 2) / 2);
  }

  function setMap(m) {
    map = m;
    const keepCam = !!W;
    try { W = createWorld(map); SC = createScenery(W, map); } catch (e) { onFail && onFail(String(e && e.message || e)); return; }
    v = pickVoxel(map.slab);
    grid = W.chunkGrid(v);
    chunks.forEach(freeMesh); chunks.clear(); dirty.clear();
    for (let a = 0; a < grid.na; a++) for (let b = 0; b < grid.nb; b++) dirty.add(a + ',' + b);
    objDirty = true; objAt = 0; shadowDirty = true;
    if (!keepCam) fitView();
    requestRender();
  }
  // After an edit: rebuild the chunks that touch the box (or everything), and the objects if asked.
  function invalidate(box, objects, m) {
    if (m) map = m;
    if (!map) return;
    try { W = createWorld(map); SC = createScenery(W, map); } catch (e) { return; }
    const ngrid = W.chunkGrid(v);
    if (!grid || ngrid.na !== grid.na || ngrid.nb !== grid.nb || ngrid.x0 !== grid.x0 || ngrid.z0 !== grid.z0) { setMap(map); return; }
    grid = ngrid;
    if (box === false) { /* objects only */ }
    else if (!box) { for (let a = 0; a < grid.na; a++) for (let b = 0; b < grid.nb; b++) dirty.add(a + ',' + b); }
    else {
      const CH = grid.CH, a0 = Math.max(0, Math.floor((box[0] - grid.x0 - 2 * v) / CH)), a1 = Math.min(grid.na - 1, Math.floor((box[2] - grid.x0 + 2 * v) / CH));
      const b0 = Math.max(0, Math.floor((box[1] - grid.z0 - 2 * v) / CH)), b1 = Math.min(grid.nb - 1, Math.floor((box[3] - grid.z0 + 2 * v) / CH));
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) dirty.add(a + ',' + b);
    }
    if (objects !== false) objDirty = true;
    shadowDirty = true; requestRender();
  }
  function pumpBuild(budgetMs) {
    const t0 = performance.now();
    if (objDirty && performance.now() - objAt > 120 && dirty.size === 0) {
      objDirty = false; objAt = performance.now();
      const P = SC.buildObjects(), data = SC.voxelTiled(P, v, 1);
      freeMesh(objMesh); objMesh = makeMesh(data, true); world.add(objMesh); shadowDirty = true;
    }
    for (const key of dirty) {
      if (performance.now() - t0 > budgetMs) break;
      dirty.delete(key);
      const [a, b] = key.split(',').map(Number), old = chunks.get(key);
      const r = W.buildChunk(grid, a, b), data = r && r.chunk;
      freeMesh(old); chunks.delete(key);
      if (data && data.count) { const m = makeMesh(data, false); chunks.set(key, m); world.add(m); }
      shadowDirty = true;
    }
    building = dirty.size > 0 || objDirty;
  }

  // ---------- camera ----------
  const cam = { tx: 0, ty: 0, tz: 0, yaw: 0.55, pitch: 0.75, dist: 80 };
  const groundH = (x, z) => (W ? W.column(x, z, 0.5).h : 0);
  function fitView(top) {
    const S = map.slab, spanX = S.x1 - S.x0, spanZ = S.z1 - S.z0, t = Math.tan(camera.fov * Math.PI / 360), asp = Math.max(0.4, camera.aspect || 1.3);
    cam.tx = (S.x0 + S.x1) / 2; cam.tz = (S.z0 + S.z1) / 2; cam.ty = groundH(cam.tx, cam.tz);
    const dTop = Math.max(spanZ * 1.1 / (2 * t), spanX * 1.1 / (2 * t * asp));
    cam.dist = clamp(top ? dTop : dTop * 1.2, 30, 800); cam.yaw = top ? 0 : 0.55; cam.pitch = top ? PITCH_MAX : 0.78;
  }
  function placeCamera() {
    // never under the ground: if the camera would sink, tilt it up
    for (let k = 0; k < 40; k++) {
      const cp = Math.cos(cam.pitch), x = cam.tx + Math.sin(cam.yaw) * cp * cam.dist, z = cam.tz + Math.cos(cam.yaw) * cp * cam.dist, y = cam.ty + Math.sin(cam.pitch) * cam.dist;
      if (y >= groundH(x, z) + 0.8 || cam.pitch >= PITCH_MAX) { camera.position.set(x, y, z); break; }
      cam.pitch = Math.min(PITCH_MAX, cam.pitch + 0.03);
      if (k === 39) camera.position.set(x, groundH(x, z) + 0.8, z);
    }
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    // sun follows the view so shadows stay sharp where you look
    const ext = clamp(cam.dist * 0.7, 18, 160);
    sun.position.set(cam.tx - 0.5 * ext, cam.ty + 1.1 * ext, cam.tz - 0.35 * ext); sun.target.position.set(cam.tx, cam.ty, cam.tz);
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, far: ext * 4 });
    sun.shadow.camera.updateProjectionMatrix();
  }
  function resize() {
    const r = container.getBoundingClientRect(), w = Math.max(200, r.width), h = Math.max(200, r.height);
    renderer.setSize(w, h, false); canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix(); requestRender();
  }
  const ro = new ResizeObserver(() => { if (!disposed) resize(); }); ro.observe(container);

  // ---------- picking ----------
  const ndc = (sx, sy) => { const r = canvas.getBoundingClientRect(); return [((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1]; };
  const _ray = new THREE.Raycaster();
  function rayAt(sx, sy) { const [nx, ny] = ndc(sx, sy); camera.updateMatrixWorld(); _ray.setFromCamera({ x: nx, y: ny }, camera); return { o: _ray.ray.origin.clone(), d: _ray.ray.direction.clone() }; }
  // The ground point under a screen position (client pixels): march along the ray until it passes under the terrain, then refine.
  function pickGround(sx, sy) {
    if (!W) return null;
    const { o, d } = rayAt(sx, sy), S = map.slab;
    let t = 0, prevT = 0, hit = false;
    const maxT = 1600, step0 = 1.2;
    for (; t < maxT; t += step0) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (x < S.x0 - 30 || x > S.x1 + 30 || z < S.z0 - 30 || z > S.z1 + 30) { if (t > 50 && d.y >= 0) break; prevT = t; continue; }
      if (y <= groundH(x, z)) { hit = true; break; }
      prevT = t;
    }
    if (!hit) return null;
    let lo = prevT, hi = t;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; const x = o.x + d.x * mid, y = o.y + d.y * mid, z = o.z + d.z * mid; if (y <= groundH(x, z)) hi = mid; else lo = mid; }
    const x = o.x + d.x * hi, z = o.z + d.z * hi;
    return { x, z, y: groundH(x, z), t: hi };
  }
  // Point on a horizontal plane (used while panning so the grabbed point stays under the finger).
  function pickPlane(sx, sy, y) {
    const { o, d } = rayAt(sx, sy);
    if (Math.abs(d.y) < 1e-5) return null;
    const t = (y - o.y) / d.y; if (t < 0) return null;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }
  // Ray against standing things: list of { id, kind, shape: 'obb' | 'cyl', cx, cz, hx, hz, c, s, r, y0, y1 }. Nearest hit wins, but a hit behind the ground point is ignored.
  function pickThings(sx, sy, list) {
    const { o, d } = rayAt(sx, sy); let best = null;
    for (const it of list) {
      let t0 = 0, t1 = 1e9;
      if (it.shape === 'obb') {
        const ox = o.x - it.cx, oz = o.z - it.cz;
        const lox = ox * it.c - oz * it.s, loz = ox * it.s + oz * it.c, ldx = d.x * it.c - d.z * it.s, ldz = d.x * it.s + d.z * it.c;
        const sl = [[lox, ldx, -it.hx, it.hx], [o.y, d.y, it.y0, it.y1], [loz, ldz, -it.hz, it.hz]];
        let ok = true;
        for (const [p, q, lo, hi] of sl) {
          if (Math.abs(q) < 1e-9) { if (p < lo || p > hi) { ok = false; break; } continue; }
          let a = (lo - p) / q, b = (hi - p) / q; if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { ok = false; break; }
        }
        if (!ok) continue;
      } else {
        const ox = o.x - it.cx, oz = o.z - it.cz, a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - it.r * it.r;
        if (a < 1e-12) { if (c > 0) continue; } else {
          const disc = b * b - 4 * a * c; if (disc < 0) continue;
          const sq = Math.sqrt(disc); t0 = Math.max(0, (-b - sq) / (2 * a)); t1 = (-b + sq) / (2 * a);
        }
        if (Math.abs(d.y) > 1e-9) { let a2 = (it.y0 - o.y) / d.y, b2 = (it.y1 - o.y) / d.y; if (a2 > b2) [a2, b2] = [b2, a2]; t0 = Math.max(t0, a2); t1 = Math.min(t1, b2); }
        else if (o.y < it.y0 || o.y > it.y1) continue;
        if (t0 > t1) continue;
      }
      if (t1 < 0) continue;
      const t = Math.max(t0, 0);
      if (!best || t < best.t) best = { id: it.id, kind: it.kind, t };
    }
    return best;
  }

  // Metres on the ground that one screen pixel covers at the point we look at (used for click tolerances).
  const mpp = () => 2 * Math.tan(camera.fov * Math.PI / 360) * cam.dist / Math.max(1, canvas.clientHeight || 400);
  // World point to client pixels (for tests and for placing labels).
  function project(x, y, z) {
    camera.updateMatrixWorld(); const p = new THREE.Vector3(x, y, z).project(camera), r = canvas.getBoundingClientRect();
    return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height, p.z];
  }

  // ---------- camera moves ----------
  function orbit(dx, dy) { cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.005, PITCH_MIN, PITCH_MAX); requestRender(); }
  function setYaw(y) { cam.yaw = y; requestRender(); }
  function turn(da) { cam.yaw += da; requestRender(); }
  function tilt(da) { cam.pitch = clamp(cam.pitch + da, PITCH_MIN, PITCH_MAX); requestRender(); }
  // Pan: keep the ground point grabbed at (sx0, sy0) under the pointer at (sx, sy).
  let grab = null;
  function panStart(sx, sy) { const g = pickGround(sx, sy); grab = g ? { y: g.y, x: g.x, z: g.z } : { y: cam.ty, x: cam.tx, z: cam.tz }; }
  function panMove(sx, sy) {
    if (!grab) return; const p = pickPlane(sx, sy, grab.y); if (!p) return;
    cam.tx = clamp(cam.tx + grab.x - p.x, map.slab.x0 - 40, map.slab.x1 + 40); cam.tz = clamp(cam.tz + grab.z - p.z, map.slab.z0 - 40, map.slab.z1 + 40);
    cam.ty = groundH(cam.tx, cam.tz); requestRender();
  }
  function panEnd() { grab = null; }
  // Zoom toward the cursor: the ground point under it stays put.
  function zoom(factor, sx, sy) {
    const before = sx == null ? null : pickGround(sx, sy);
    cam.dist = clamp(cam.dist * factor, 4, 800);
    if (before) {
      for (let i = 0; i < 4; i++) {
        placeCamera(); camera.updateMatrixWorld();
        const after = pickPlane(sx, sy, before.y); if (!after) break;
        const dx = before.x - after.x, dz = before.z - after.z;
        if (Math.hypot(dx, dz) < 0.02) break;
        cam.tx = clamp(cam.tx + dx, map.slab.x0 - 40, map.slab.x1 + 40); cam.tz = clamp(cam.tz + dz, map.slab.z0 - 40, map.slab.z1 + 40); cam.ty = groundH(cam.tx, cam.tz);
      }
    }
    requestRender();
  }
  function lookAt(x, z, dist) { cam.tx = x; cam.tz = z; cam.ty = groundH(x, z); if (dist) cam.dist = dist; requestRender(); }
  const PRESETS = {
    top: () => { fitView(true); },
    iso: () => { fitView(); },
    street: () => { cam.dist = 14; cam.pitch = 0.16; cam.ty = groundH(cam.tx, cam.tz) + 1.2; }
  };
  function preset(name) { if (PRESETS[name]) { PRESETS[name](); requestRender(); } }

  // ---------- overlay (selection, ghosts, rings, road lines) ----------
  const ovMats = new Map(); const ovGeo = [];
  const mat = (color, op = 1) => { const k = color + '|' + op; let m = ovMats.get(k); if (!m) { m = new THREE.LineBasicMaterial({ color, transparent: op < 1, opacity: op, depthTest: false }); ovMats.set(k, m); } return m; };
  const fillMat = (color, op) => { const k = 'f' + color + '|' + op; let m = ovMats.get(k); if (!m) { m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthTest: false, side: THREE.DoubleSide }); ovMats.set(k, m); } return m; };
  function clearOverlay(which) {
    [which !== 'dyn' && overlay, which !== 'static' && overlayDyn].forEach(g => { if (g) while (g.children.length) { const c = g.children.pop(); if (c.geometry) c.geometry.dispose(); } });
    requestRender();
  }
  const add = o => { o.renderOrder = 10; (layer === 'dyn' ? overlayDyn : overlay).add(o); return o; };
  const ov = {
    use(name) { layer = name; },
    line(pts, color = 0xffffff, op = 1) { const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[1], p[2]))); return add(new THREE.Line(g, mat(color, op))); },
    // a line draped on the ground
    drape(xz, color = 0xffffff, lift = 0.25, op = 1) { return ov.line(xz.map(p => [p[0], groundH(p[0], p[1]) + lift, p[1]]), color, op); },
    ring(x, z, r, color = 0xffffff, lift = 0.25, n = 48, op = 1) { const pts = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; pts.push([px, groundH(px, pz) + lift, pz]); } return ov.line(pts, color, op); },
    // wireframe of an oriented box (centre, half sizes, yaw degrees, y range)
    box(cx, cz, hx, hz, yawDeg, y0, y1, color = 0xffffff, op = 1) {
      const a = yawDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), W2 = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
      const q = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(p => W2(p[0], p[1]));
      const lo = q.map(p => [p[0], y0, p[1]]), hi = q.map(p => [p[0], y1, p[1]]);
      ov.line([...lo, lo[0]], color, op); ov.line([...hi, hi[0]], color, op);
      for (let i = 0; i < 4; i++) ov.line([lo[i], hi[i]], color, op);
    },
    // a filled flat rectangle on the ground
    patch(cx, cz, hx, hz, yawDeg, color = 0xffffff, op = 0.25, lift = 0.15) {
      const a = yawDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), W2 = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
      const q = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(p => W2(p[0], p[1])), y = groundH(cx, cz) + lift;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([q[0][0], y, q[0][1], q[1][0], y, q[1][1], q[2][0], y, q[2][1], q[0][0], y, q[0][1], q[2][0], y, q[2][1], q[3][0], y, q[3][1]], 3));
      return add(new THREE.Mesh(g, fillMat(color, op)));
    },
    // a vertical marker post with a coloured head (signals, handles)
    post(x, z, h, color = 0xffffff, r = 0.25) {
      const y = groundH(x, z), g = new THREE.CylinderGeometry(r, r, h, 10), m = new THREE.Mesh(g, fillMat(color, 0.95)); m.position.set(x, y + h / 2, z); return add(m);
    },
    dot(x, y, z, color = 0xffffff, r = 0.5) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), fillMat(color, 0.95)); m.position.set(x, y, z); return add(m); }
  };

  // ---------- render loop ----------
  function requestRender() { need = true; if (!raf && !disposed) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0; if (disposed) return;
    pumpBuild(7);
    placeCamera();
    if (shadowDirty && !dirty.size) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
    renderer.render(scene, camera);
    need = false;
    onFrame && onFrame(cam);
    if (dirty.size || objDirty) requestRender();
  }

  function dispose() {
    disposed = true; cancelAnimationFrame(raf); ro.disconnect();
    chunks.forEach(freeMesh); chunks.clear(); freeMesh(objMesh); objMesh = null; clearOverlay();
    ovMats.forEach(m => m.dispose()); ovMats.clear();
    cubeGeo.dispose(); cubeMat.dispose();
    if (sun.shadow.map) sun.shadow.map.dispose();
    renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) {}
    canvas.width = canvas.height = 0; canvas.remove();
    W = null; SC = null; grid = null; map = null;
  }

  resize();
  return {
    canvas, cam, ov, setMap, invalidate, resize, render: requestRender, dispose, clearOverlay,
    pickGround, pickPlane, pickThings, rayAt, groundH, project, mpp, camPos: () => camera.position.toArray(),
    orbit, turn, tilt, setYaw, zoom, panStart, panMove, panEnd, lookAt, preset, fitView,
    get voxel() { return v; }, get building() { return building; }, get world() { return W; }, get scenery() { return SC; },
    stats() { let c = 0; chunks.forEach(m => { c += m.count; }); return { cubes: c + (objMesh ? objMesh.count : 0), chunks: chunks.size, voxel: v, pending: dirty.size }; }
  };
}
