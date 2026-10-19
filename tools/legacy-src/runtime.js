// ===== Vehicle handling. Speeds are in m/s; the HUD shows km/h. =====
const VEH = {
  car: { maxF: 15.5, maxR: 5, acc: 7.5, brk: 16, wb: 2.3, sMax: 0.5, sMin: 0.16, circ: [-0.95, 0.95], r: 0.85, camD: 19, lean: 0.03, wheels: [[1.2, -0.72], [1.2, 0.72], [-1.2, -0.72], [-1.2, 0.72]], wob: 0.75 },
  bike: { maxF: 19, maxR: 4, acc: 9.5, brk: 14, wb: 1.5, sMax: 0.7, sMin: 0.12, circ: [-0.5, 0.5], r: 0.45, camD: 15, lean: 0.42, wheels: [[0.8, 0], [-0.8, 0]], wob: 1.3 }
};

// ===== Three.js =====
const canvas = $('gl');
function fail() { $('nogl').hidden = false; $('start').hidden = true; }
if (!window.THREE) { fail(); return; }
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); } catch (e) { fail(); return; }
renderer.setClearColor(0x000000, 0);
const basePR = Math.min(window.devicePixelRatio || 1, 2);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 1, 340);
const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x8a7352, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 0.8);
sun.castShadow = true;
const smap = window.innerWidth < 700 ? 1024 : 2048;
sun.shadow.mapSize.set(smap, smap);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 140;
sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
let shadowExt = 24;
function setShadowExt(e) {
  shadowExt = e;
  Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e });
  sun.shadow.camera.updateProjectionMatrix();
}
setShadowExt(24);

const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const cubeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
function makeMesh(data, shadowCast) {
  const m = new THREE.InstancedMesh(cubeGeo, cubeMat, Math.max(1, data.count));
  const d = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < data.count; i++) {
    d.position.set(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]);
    d.scale.setScalar(data.v);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
    c.setRGB(data.col[i * 3], data.col[i * 3 + 1], data.col[i * 3 + 2]);
    m.setColorAt(i, c);
  }
  m.count = data.count;
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = shadowCast;
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

const state = { hour: 16.5, traffic: !reduced, orbit: false, lite: window.innerWidth < 700, cam: 'chase', phase: 'menu', pad: false, sound: false };
const worldRoot = new THREE.Group();
scene.add(worldRoot);
const groundChunks = [];
function mkActor() { const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner); scene.add(root); return { root, inner }; }
const A = { pCar: mkActor(), pBike: mkActor(), nCar: mkActor(), nBike: mkActor(), nAuto: mkActor() };

function clearAll() {
  const kill = g => {
    const list = [];
    g.traverse(o => { if (o !== g) list.push(o); });
    list.forEach(o => { if (o.isInstancedMesh) o.dispose(); });
    while (g.children.length) g.remove(g.children[0]);
  };
  kill(worldRoot);
  Object.keys(A).forEach(k => { while (A[k].inner.children.length) A[k].inner.remove(A[k].inner.children[0]); });
  groundChunks.length = 0;
}

function sprite(cv, prims, min, max) {
  const v = 0.07, d = voxelize(prims, min, max, v, 2);
  const nx = Math.ceil((max[0] - min[0]) / v), ny = Math.ceil((max[1] - min[1]) / v);
  const best = new Float32Array(nx * ny).fill(-1e9), cols = new Array(nx * ny);
  let x0 = nx, x1 = 0, y0 = ny, y1 = 0;
  for (let i = 0; i < d.count; i++) {
    const px = Math.floor((d.pos[i * 3] - min[0]) / v), py = Math.floor((d.pos[i * 3 + 1] - min[1]) / v), z = d.pos[i * 3 + 2];
    const id = px + nx * py;
    if (z > best[id]) { best[id] = z; cols[id] = [d.col[i * 3], d.col[i * 3 + 1], d.col[i * 3 + 2]]; }
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const c = cols[px + nx * py];
    if (!c) continue;
    g.fillStyle = 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
    g.fillRect(px - x0, y1 - py, 1, 1);
  }
}

// ----- ground lookups (built heightfield) -----
let HF = null;
const gY = (x, z) => World.hfY(HF, x, z);
const gKind = (x, z) => World.hfKind(HF, x, z);

// ----- build -----
const mods = { car: null, bike: null, auto: null, objects: null };
let buildId = 0;
const tick = () => new Promise(r => setTimeout(r, 0));
async function rebuild() {
  const id = ++buildId;
  $('busy').hidden = false;
  await tick();
  const v = Number($('vox').value) / 100;
  const t0 = performance.now();
  mods.objects = mods.objects || buildObjects();
  const g = await World.buildGround(v, tick);
  if (id !== buildId) return;
  await tick();
  const ob = voxelTiled(mods.objects, v, 1);
  const car = voxelize(mods.car, CAR_MIN, CAR_MAX, v, 4), bike = voxelize(mods.bike, BIKE_MIN, BIKE_MAX, v, 2), auto = voxelize(mods.auto, AUTO_MIN, AUTO_MAX, v, 3);
  if (id !== buildId) return;
  clearAll();
  let cubes = 0;
  g.chunks.forEach(c => {
    const m = makeMesh(c, false);
    worldRoot.add(m);
    groundChunks.push({ mesh: m, box: new THREE.Box3(new THREE.Vector3(c.box[0], c.box[1], c.box[2]), new THREE.Vector3(c.box[3], c.box[4], c.box[5])) });
    cubes += c.count;
  });
  worldRoot.add(makeMesh(ob, true));
  cubes += ob.count;
  A.pCar.inner.add(makeMesh(car, true)); A.nCar.inner.add(makeMesh(car, true));
  A.pBike.inner.add(makeMesh(bike, true)); A.nBike.inner.add(makeMesh(bike, true));
  A.nAuto.inner.add(makeMesh(auto, true));
  cubes += car.count * 2 + bike.count * 2 + auto.count;
  HF = g.HF;
  makeMini();
  $('sStat').textContent = cubes.toLocaleString('en-IN') + ' cubes · ' + Math.round(World.LTOT) + ' m lap · ' + World.POTS.length + ' potholes · built in ' + Math.round(performance.now() - t0) + ' ms';
  applyVisibility();
  snapPlayer();
  $('busy').hidden = true;
}
function applyVisibility() {
  A.pCar.root.visible = kind === 'car'; A.pBike.root.visible = kind === 'bike';
  A.nBike.root.visible = kind === 'car'; A.nCar.root.visible = kind === 'bike';
  A.nAuto.root.visible = true;
}

// ===== Player, traffic, lap logic =====
let kind = 'car';
const P = { x: -13.5, z: 1.0, psi: 0, v: 0, steer: 0, y: 0, pitch: 0, roll: 0, acc: 0, hit: false, jy: 0, jv: 0, wobA: 0, wobT: 9, wobRoll: 0, pot: 0, potMsg: 0 };
const lap = { prog: -1.5, prevS: 0, n: 0, idx: -1, t0: -1, time: 0, last: -1, wrong: 0 };
const best = { car: 0, bike: 0 };
try { const b = JSON.parse(localStorage.getItem('loop-hills-best') || '{}'); best.car = b.car || 0; best.bike = b.bike || 0; } catch (e) {}
const NPC = [
  { key: 'nBike', s: 20, dir: 1, u: 1.0, speed: 5.0, r: 0.6, ph: 0, y: 0, pitch: 0 },
  { key: 'nAuto', s: World.LTOT - 40, dir: -1, u: -1.0, speed: 3.6, r: 1.0, ph: 1.7, y: 0, pitch: 0 }
];
const potState = [-1, -1, -1, -1], recent = new Map();
function snapPlayer() { P.y = gY(P.x, P.z); NPC.forEach(n => { n.y = null; }); snapCam = true; }
function resetRun() {
  P.x = -13.5; P.z = 1.0; P.psi = 0; P.v = 0; P.steer = 0; P.pitch = 0; P.roll = 0; P.jy = P.jv = 0; P.wobA = 0; P.wobT = 9; P.pot = 0;
  potState.fill(-1); recent.clear();
  lap.prog = -1.5; lap.prevS = World.loopInfo(P.x, P.z).s; lap.n = 0; lap.idx = -1; lap.t0 = -1; lap.time = 0; lap.last = -1; lap.wrong = 0; lap.running = false;
  cam.userAz = 0; snapPlayer();
}

const keys = new Set();
const pad = { gas: false, brk: false, l: false, r: false };
function inp() {
  return {
    up: keys.has('w') || keys.has('arrowup') || pad.gas, down: keys.has('s') || keys.has('arrowdown') || pad.brk,
    left: keys.has('a') || keys.has('arrowleft') || pad.l, right: keys.has('d') || keys.has('arrowright') || pad.r, hb: keys.has(' ')
  };
}

function pushOut(px, pz, r) {
  let ox = 0, oz = 0;
  for (let i = 0; i < SOLIDS.length; i++) {
    const s = SOLIDS[i];
    let nx, nz;
    if (s.t === 'b') { nx = clamp(px, s.x0, s.x1); nz = clamp(pz, s.z0, s.z1); } else { nx = s.x; nz = s.z; }
    let dx = px - nx, dz = pz - nz;
    const rr = s.t === 'c' ? r + s.r : r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    let d = Math.sqrt(d2);
    if (d < 1e-4) { dx = px - (s.x0 + s.x1) / 2; dz = pz - (s.z0 + s.z1) / 2; d = Math.hypot(dx, dz) || 1; }
    const k = (rr - d) / d;
    ox += dx * k; oz += dz * k;
  }
  return [ox, oz];
}

// A wheel dropping into a pothole: speed loss, a jolt, a steering wobble and a shake, for car and bike alike.
function potholeHit(pi, wheelIdx, side) {
  const p = World.POTS[pi], sp = VEH[kind];
  const sev = (p.r / 0.7) * (p.depth === 2 ? 1.2 : 1) * clamp(Math.abs(P.v) / (sp.maxF * 0.55), 0.35, 1.5);
  P.v *= 1 - Math.min(0.45, 0.22 * sev);
  P.jv += 2.4 * sev;
  P.wobA = Math.max(P.wobA * 0.5, 0.2 * sev * sp.wob); P.wobT = 0; P.wobPh = Math.random() < 0.5 ? 1 : -1;
  P.psi += (side || P.wobPh) * 0.045 * sev * sp.wob;
  shake = Math.max(shake, 0.12 + 0.2 * sev);
  const now = performance.now();
  if (!recent.has(pi) || now - recent.get(pi) > 1500) { P.pot++; P.potMsg = 0.9; }
  recent.set(pi, now);
  thump(sev);
}

function step(dt, ctl) {
  const sp = VEH[kind];
  const surf = World.MULT[gKind(P.x, P.z)];
  const vmax = sp.maxF * surf, rmax = sp.maxR * surf;
  const thr = (ctl.up ? 1 : 0) - (ctl.down ? 1 : 0);
  const vPrev = P.v;
  if (ctl.up) { if (P.v >= 0) P.v += sp.acc * clamp(1 - P.v / vmax, -3, 1) * dt; else P.v += sp.brk * dt; }
  else if (ctl.down) { if (P.v > 0.3) P.v -= sp.brk * dt; else P.v = Math.max(P.v - sp.acc * 0.6 * dt, -rmax); }
  if (!thr) { const dr = 1.2 + 0.05 * Math.abs(P.v); P.v -= Math.sign(P.v) * Math.min(Math.abs(P.v), dr * dt); }
  if (P.v > vmax) P.v -= (P.v - vmax) * Math.min(1, 3 * dt);
  if (P.v < -rmax) P.v -= (P.v + rmax) * Math.min(1, 3 * dt);
  if (ctl.hb) P.v -= Math.sign(P.v) * Math.min(Math.abs(P.v), 18 * dt);
  // gravity along the slope: uphill bleeds speed, downhill gives it back; a gentle slope holds a parked vehicle
  const g = 9.8 * 0.55 * Math.sin(P.pitch);
  if (!(thr === 0 && Math.abs(P.v) < 0.5 && Math.abs(P.pitch) < 0.08)) P.v -= g * dt; else P.v = 0;

  const tgt = (ctl.left ? 1 : 0) - (ctl.right ? 1 : 0);
  P.steer += (tgt - P.steer) * Math.min(1, dt * 9);
  P.wobT += dt;
  const wob = P.wobA * Math.sin(P.wobT * 20) * Math.exp(-P.wobT * 2.4) * (P.wobPh || 1);
  const t = clamp(Math.abs(P.v) / sp.maxF, 0, 1);
  const delta = P.steer * lerp(sp.sMax, sp.sMin, Math.pow(t, 0.7)) + wob * (0.4 + 0.6 * t);
  P.wobRoll = wob * (kind === 'bike' ? 1.6 : 0.6);
  const yaw = P.v / sp.wb * Math.tan(delta) * (ctl.hb ? 1.4 : 1);
  const px0 = P.x, pz0 = P.z;
  P.psi += yaw * dt;
  P.x += Math.cos(P.psi) * P.v * dt;
  P.z -= Math.sin(P.psi) * P.v * dt;

  // Collisions: a few circles along the body against buildings, trees, poles and other traffic; steep faces are walls.
  let hit = false;
  const fx = Math.cos(P.psi), fz = -Math.sin(P.psi);
  const yHere = gY(px0, pz0);
  for (let c = 0; c < sp.circ.length; c++) {
    const cx = P.x + fx * sp.circ[c], cz = P.z + fz * sp.circ[c];
    if (gY(cx, cz) - yHere > 0.85) { P.x = px0; P.z = pz0; hit = true; break; }
  }
  for (let c = 0; c < sp.circ.length; c++) {
    const [ox, oz] = pushOut(P.x + fx * sp.circ[c], P.z + fz * sp.circ[c], sp.r);
    if (ox || oz) { P.x += ox; P.z += oz; hit = true; }
  }
  NPC.forEach(n => {
    const a = A[n.key].root;
    if (!a.visible) return;
    for (let c = 0; c < sp.circ.length; c++) {
      const cx = P.x + fx * sp.circ[c], cz = P.z + fz * sp.circ[c];
      const dx = cx - a.position.x, dz = cz - a.position.z, d = Math.hypot(dx, dz), rr = sp.r + n.r;
      if (d < rr) { const k = (rr - d) / (d || 1); P.x += dx * k; P.z += dz * k; hit = true; }
    }
  });
  const S = World.SLAB;
  if (P.x < S.x0 + 1.2 || P.x > S.x1 - 1.2 || P.z < S.z0 + 1.2 || P.z > S.z1 - 1.2) {
    P.x = clamp(P.x, S.x0 + 1.2, S.x1 - 1.2); P.z = clamp(P.z, S.z0 + 1.2, S.z1 - 1.2); hit = true;
  }
  if (hit) {
    if (!P.hit && Math.abs(P.v) > 4) { shake = Math.min(0.5, Math.abs(P.v) * 0.03); P.v *= -0.25; }
    else P.v *= Math.max(0, 1 - 4 * dt);
  }
  P.hit = hit;

  // Wheels: ride height, pitch, roll and pothole hits.
  const fx2 = Math.cos(P.psi), fz2 = -Math.sin(P.psi), rx = Math.sin(P.psi), rz = Math.cos(P.psi);
  const ws = sp.wheels;
  let ysum = 0, fy = 0, ry = 0, fn = 0, rn = 0, ly = 0, rty = 0, ln = 0, rtn = 0;
  for (let i = 0; i < ws.length; i++) {
    const wx = P.x + fx2 * ws[i][0] + rx * ws[i][1], wz = P.z + fz2 * ws[i][0] + rz * ws[i][1];
    const y = gY(wx, wz);
    ysum += y;
    if (ws[i][0] > 0) { fy += y; fn++; } else { ry += y; rn++; }
    if (ws[i][1] < 0) { ly += y; ln++; } else if (ws[i][1] > 0) { rty += y; rtn++; }
    const pi = World.potholeAt(wx, wz, 0.08);
    if (pi >= 0 && potState[i] !== pi && Math.abs(P.v) > 0.8) potholeHit(pi, i, ws[i][1] < 0 ? -1 : ws[i][1] > 0 ? 1 : 0);
    potState[i] = pi;
  }
  const half = ws[0][0];
  const pitchT = Math.atan2(fy / fn - ry / rn, 2 * half);
  P.pitch = lerp(P.pitch, pitchT, Math.min(1, dt * 10));
  const rollT = rtn && ln ? -Math.atan2(rty / rtn - ly / ln, 1.44) : 0;
  P.roll = lerp(P.roll, rollT, Math.min(1, dt * 10));
  P.gy = ysum / ws.length;
  P.acc = lerp(P.acc, clamp((P.v - vPrev) / dt, -10, 10), 0.2);
  // jolt spring
  P.jv += (-180 * P.jy - 14 * P.jv) * dt; P.jy = clamp(P.jy + P.jv * dt, -0.05, 0.3);
}

function fmt(t) {
  if (t < 0) return '--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}
function lapUpdate(dt) {
  const info = World.loopInfo(P.x, P.z);
  let d = info.s - lap.prevS;
  if (d > World.LTOT / 2) d -= World.LTOT; else if (d < -World.LTOT / 2) d += World.LTOT;
  lap.prevS = info.s;
  if (Math.abs(d) < 25 && Math.abs(info.u) < 8) {
    lap.prog += d;
    lap.wrong = d < -0.02 && P.v > 2 ? lap.wrong + dt : (d > 0 ? 0 : lap.wrong);
  }
  const idx = Math.floor(lap.prog / World.LTOT);
  if (idx > lap.idx) {
    if (lap.idx >= 0 && lap.t0 >= 0) {
      lap.last = lap.time; lap.n = idx;
      if (!best[kind] || lap.last < best[kind]) { best[kind] = lap.last; try { localStorage.setItem('loop-hills-best', JSON.stringify(best)); } catch (e) {} }
    }
    lap.idx = idx; lap.t0 = lap.time = 0; lap.running = true;
  }
  if (lap.running) lap.time += dt;
}

// ===== Camera =====
const camPos = new THREE.Vector3(0, 60, 80), camLook = new THREE.Vector3(0, 2, -15);
const cam = { pol: 0.95, zoom: 1, userAz: 0, chaseAz: 0, drag: false };
const OV = { az: 0.0, pol: 0.95, zoom: 1 };
let snapCam = true, shake = 0, vw = 1, vh = 1, lastDt = 0.016;
const camPosD = new THREE.Vector3(), camLookD = new THREE.Vector3();
function overviewDesired() {
  const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const fit = 40 / Math.sin(Math.min(vf, hf) / 2);
  const d = Math.max(fit * 0.8, 80) * OV.zoom;
  camLookD.set(0, 2.5, -15);
  camPosD.set(Math.sin(OV.pol) * Math.sin(OV.az) * d, Math.cos(OV.pol) * d + 2.5, -15 + Math.sin(OV.pol) * Math.cos(OV.az) * d);
}
function chaseDesired() {
  const sp = VEH[kind], frac = clamp(Math.abs(P.v) / sp.maxF, 0, 1);
  const d = (sp.camD + frac * 3) * cam.zoom;
  let diff = P.psi - Math.PI / 2 - cam.chaseAz;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  cam.chaseAz += diff * Math.min(1, lastDt * 3.5);
  const az = cam.chaseAz + cam.userAz, pol = cam.pol + 0.05;
  const lead = 1.5 + Math.max(0, P.v) * 0.22, ty = P.y + 0.9;
  camLookD.set(P.x + Math.cos(P.psi) * lead, ty, P.z - Math.sin(P.psi) * lead);
  camPosD.set(P.x + Math.sin(pol) * Math.sin(az) * d, Math.cos(pol) * d + ty, P.z + Math.sin(pol) * Math.cos(az) * d);
  const floor = gY(camPosD.x, camPosD.z) + 1.5;
  if (camPosD.y < floor) camPosD.y = floor;
  camera.fov = 36 + frac * 5;
}
function placeCamera(dt) {
  lastDt = dt;
  const chase = state.cam === 'chase' && state.phase === 'play';
  if (chase) chaseDesired(); else { camera.fov = 32; overviewDesired(); }
  camera.updateProjectionMatrix();
  const k = snapCam ? 1 : 1 - Math.exp(-dt * (chase ? 9 : 8));
  camPos.lerp(camPosD, k); camLook.lerp(camLookD, k);
  snapCam = false;
  camera.position.copy(camPos);
  if (shake > 0.001 && !reduced) {
    camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-dt * 8);
  }
  camera.lookAt(camLook);
}

const sunOff = new THREE.Vector3(0, 25, 20);
function setSun(h) {
  const t = (h - 6) / 12;
  const el = Math.max(0.2, Math.sin(Math.PI * t)) * 1.25;
  const az = (0.5 - t) * 2.6;
  const ce = Math.cos(el), se = Math.sin(el);
  sunOff.set(Math.sin(az) * ce * 30, se * 30 + 2, (0.55 + 0.45 * Math.cos(az)) * ce * 30);
  const warm = clamp((0.6 - el) / 0.4, 0, 1);
  sun.color.setRGB(1, 0.96 - 0.28 * warm, 0.88 - 0.48 * warm);
  sun.intensity = 0.5 + 0.4 * Math.min(1, el / 1.0);
  hemi.intensity = 0.5 + 0.12 * Math.min(1, el / 1.0);
  hemi.color.setRGB(0.81 + 0.19 * warm, 0.9 - 0.12 * warm, 1 - 0.25 * warm);
  hemi.groundColor.setRGB(0.54, 0.45, 0.32);
}
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _dir = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function followShadow(tx, ty, tz) {
  _dir.copy(sunOff).normalize();
  _lx.crossVectors(_up, _dir).normalize(); _ly.crossVectors(_dir, _lx);
  _t.set(tx, ty, tz);
  const texel = (2 * shadowExt) / sun.shadow.mapSize.x;
  const ax = _t.dot(_lx), ay = _t.dot(_ly);
  _t.addScaledVector(_lx, Math.round(ax / texel) * texel - ax).addScaledVector(_ly, Math.round(ay / texel) * texel - ay);
  sun.target.position.copy(_t);
  sun.position.set(_t.x + sunOff.x, _t.y + sunOff.y, _t.z + sunOff.z);
}
function clockLabel(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return (((hh + 11) % 12) + 1) + ':' + String(mm).padStart(2, '0') + ' ' + (hh >= 12 ? 'pm' : 'am');
}

function resize() {
  const st = $('stage');
  vw = Math.max(1, st.clientWidth); vh = Math.max(1, st.clientHeight);
  renderer.setPixelRatio(state.lite ? 1 : basePR);
  renderer.setSize(vw, vh, false);
  camera.aspect = vw / vh;
  camera.updateProjectionMatrix();
}
if (window.ResizeObserver) new ResizeObserver(resize).observe($('stage'));
window.addEventListener('resize', resize);

// ===== Input =====
const ptrs = new Map();
let pinch = 0;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cam.drag = true;
  $('stage').focus({ preventScroll: true });
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  const chase = state.cam === 'chase' && state.phase === 'play';
  if (ptrs.size === 1) {
    if (chase) { cam.userAz -= dx * 0.007; cam.pol = clamp(cam.pol - dy * 0.005, 0.55, 1.35); }
    else { OV.az -= dx * 0.007; OV.pol = clamp(OV.pol - dy * 0.006, 0.3, 1.45); }
  } else if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0 && d > 0) { const z = pinch / d; if (chase) cam.zoom = clamp(cam.zoom * z, 0.5, 2); else OV.zoom = clamp(OV.zoom * z, 0.4, 1.6); }
    pinch = d;
  }
});
const endPtr = e => { ptrs.delete(e.pointerId); pinch = 0; if (!ptrs.size) cam.drag = false; };
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const z = Math.exp(e.deltaY * 0.001);
  if (state.cam === 'chase' && state.phase === 'play') cam.zoom = clamp(cam.zoom * z, 0.5, 2); else OV.zoom = clamp(OV.zoom * z, 0.4, 1.6);
}, { passive: false });

const DRIVE = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ']);
window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' && e.target.type !== 'range') return;
  if (DRIVE.has(k)) {
    if (tag === 'BUTTON' && k === ' ') return;
    if (tag === 'INPUT') e.target.blur();
    e.preventDefault();
    if (state.phase === 'menu') return;
    keys.add(k);
  } else if (k === 'c') { if (state.phase === 'play') setCam(state.cam === 'chase' ? 'overview' : 'chase'); }
  else if (k === 'r') { if (state.phase === 'play') resetRun(); }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); pad.gas = pad.brk = pad.l = pad.r = false; });

function holdBtn(id, key) {
  const b = $(id);
  const on = e => { e.preventDefault(); pad[key] = true; b.classList.add('down'); try { b.setPointerCapture(e.pointerId); } catch (x) {} };
  const off = () => { pad[key] = false; b.classList.remove('down'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  b.addEventListener('contextmenu', e => e.preventDefault());
}
holdBtn('pG', 'gas'); holdBtn('pB', 'brk'); holdBtn('pL', 'l'); holdBtn('pR', 'r');

// ===== Controls =====
function pressed(id, on) { $(id).setAttribute('aria-pressed', String(on)); }
function setKind(k) {
  if (k === kind) return;
  kind = k;
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.v === k)));
  applyVisibility();
  lap.last = -1; lap.running = false; lap.t0 = -1; lap.time = 0; lap.idx = Math.floor(lap.prog / World.LTOT);
  updateBest();
}
function updateBest() { setText('progress', 'Best lap ' + fmt(best[kind] || -1)); }
function setCam(m) { state.cam = m; pressed('bCam', m === 'overview'); }
function start(k) {
  setKind(k);
  state.phase = 'play';
  $('start').hidden = true;
  resetRun();
  $('stage').focus({ preventScroll: true });
}
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', e => { setKind(c.dataset.v); if (state.phase === 'menu') start(c.dataset.v); if (e.detail) c.blur(); }));
document.querySelectorAll('.ride').forEach(c => c.addEventListener('click', () => start(c.dataset.v)));

let rebuildTimer = 0;
$('vox').addEventListener('input', e => {
  $('voxOut').textContent = e.target.value + ' cm';
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 120);
});
$('tod').addEventListener('input', e => {
  state.hour = Number(e.target.value) / 4;
  $('todOut').textContent = clockLabel(state.hour);
  setSun(state.hour);
});
['vox', 'tod'].forEach(id => $(id).addEventListener('change', e => e.target.blur()));
function toggle(id, key, fn) {
  const b = $(id);
  b.addEventListener('click', e => { state[key] = !state[key]; pressed(id, state[key]); if (fn) fn(); if (e.detail) b.blur(); });
  pressed(id, state[key]);
}
toggle('bTraffic', 'traffic');
toggle('bOrbit', 'orbit');
toggle('bLite', 'lite', resize);
toggle('bPad', 'pad', () => $('pad').classList.toggle('on', state.pad));
toggle('bSound', 'sound', () => { state.sound ? audioOn() : audioOff(); });
$('bCam').addEventListener('click', e => { setCam(state.cam === 'chase' ? 'overview' : 'chase'); if (e.detail) e.target.blur(); });
$('bReset').addEventListener('click', e => { if (state.phase === 'play') resetRun(); else { OV.az = 0; OV.pol = 0.95; OV.zoom = 1; } if (e.detail) e.target.blur(); });
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) { state.pad = true; pressed('bPad', true); $('pad').classList.add('on'); }
if (state.lite) pressed('bLite', true);

// Engine sound and pothole thump, off until the Sound button is pressed.
let actx = null, osc = null, gain = null, lp = null;
function audioOn() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    osc = actx.createOscillator(); gain = actx.createGain(); lp = actx.createBiquadFilter();
    osc.type = 'sawtooth'; lp.type = 'lowpass'; lp.frequency.value = 500; gain.gain.value = 0;
    osc.connect(lp); lp.connect(gain); gain.connect(actx.destination); osc.start();
  } catch (e) { state.sound = false; pressed('bSound', false); }
}
function audioOff() { try { if (osc) { osc.stop(); osc.disconnect(); osc = null; } } catch (e) {} }
function thump(sev) {
  if (!state.sound || !actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110, actx.currentTime); o.frequency.exponentialRampToValueAtTime(40, actx.currentTime + 0.18);
    g.gain.setValueAtTime(Math.min(0.35, 0.12 + 0.1 * sev), actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.22);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.25);
  } catch (e) {}
}
function audioTick() {
  if (!osc || !actx) return;
  const sp = VEH[kind], f = clamp(Math.abs(P.v) / sp.maxF, 0, 1), c = inp();
  const base = kind === 'bike' ? 70 : 48;
  osc.frequency.setTargetAtTime(base + f * (kind === 'bike' ? 150 : 110) + (c.up ? 12 : 0), actx.currentTime, 0.05);
  lp.frequency.setTargetAtTime(350 + f * 700, actx.currentTime, 0.05);
  gain.gain.setTargetAtTime(state.phase === 'play' ? 0.03 + (c.up ? 0.03 : 0) + f * 0.02 : 0, actx.currentTime, 0.08);
}

// ===== Minimap: a shaded height map of the built ground =====
const mini = $('mini'), mg = mini.getContext('2d');
const MW = mini.width, MH = mini.height, SL = World.SLAB;
const mx = x => (x - SL.x0) / (SL.x1 - SL.x0) * MW, mz = z => (z - SL.z0) / (SL.z1 - SL.z0) * MH;
const miniBg = document.createElement('canvas'); miniBg.width = MW; miniBg.height = MH;
const KC = (function () {
  const K = World.K, t = {};
  [K.ROAD, K.EDGE, K.DASH, K.ZEBRA, K.CHKD, K.CHKW, K.PIT, K.RIM].forEach(k => t[k] = [75, 81, 89]);
  t[K.KERB] = [199, 194, 182]; t[K.WATER] = [79, 163, 209]; t[K.SAND] = [230, 214, 162]; t[K.GRASS] = [111, 191, 74];
  t[K.SCRUB] = [201, 178, 122]; t[K.LATER] = [181, 105, 74]; t[K.ROCK] = [142, 149, 155]; t[K.ROCK2] = [113, 120, 128];
  return t;
})();
function makeMini() {
  if (!HF) return;
  const g = miniBg.getContext('2d'), img = g.createImageData(MW, MH);
  for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
    const x = SL.x0 + (i + 0.5) / MW * (SL.x1 - SL.x0), z = SL.z0 + (j + 0.5) / MH * (SL.z1 - SL.z0);
    const c = KC[World.hfKind(HF, x, z)] || [111, 191, 74];
    const sh = clamp(1 + (gY(x - 0.8, z - 0.8) - gY(x + 0.8, z + 0.8)) * 0.22 + (gY(x, z) - 3) * 0.03, 0.6, 1.35);
    const o = (j * MW + i) * 4;
    img.data[o] = Math.min(255, c[0] * sh); img.data[o + 1] = Math.min(255, c[1] * sh); img.data[o + 2] = Math.min(255, c[2] * sh); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#F4F1EA'; g.fillRect(mx(-12) - 1.5, mz(-World.HW), 3, World.HW * 2 * MW / (SL.x1 - SL.x0));
}
function drawMini() {
  mg.clearRect(0, 0, MW, MH);
  mg.drawImage(miniBg, 0, 0);
  NPC.forEach(n => { const a = A[n.key].root; mg.fillStyle = n.key === 'nAuto' ? '#F2C200' : '#D8392B'; mg.beginPath(); mg.arc(mx(a.position.x), mz(a.position.z), 4, 0, 6.3); mg.fill(); });
  mg.fillStyle = '#1D1E22';
  World.POTS.forEach(p => { mg.fillRect(mx(p.x) - 1, mz(p.z) - 1, 2.5, 2.5); });
  mg.save(); mg.translate(mx(P.x), mz(P.z)); mg.rotate(-P.psi);
  mg.fillStyle = '#F2A900'; mg.strokeStyle = '#1C1600'; mg.lineWidth = 1.5;
  mg.beginPath(); mg.moveTo(8, 0); mg.lineTo(-5, -5.5); mg.lineTo(-5, 5.5); mg.closePath(); mg.fill(); mg.stroke();
  mg.restore();
}

// ===== Loop =====
let last = performance.now(), clock = 0, hudT = 0;
const frustum = new THREE.Frustum(), pm = new THREE.Matrix4();
const txt = {};
function setText(id, s) { if (txt[id] !== s) { txt[id] = s; $(id).textContent = s; } }

function placeNpc(n, dt) {
  const a = A[n.key];
  if (state.traffic) n.s += n.dir * n.speed * dt;
  const tp = World.trackPoint(n.s, n.u);
  const y = gY(tp.x, tp.z);
  n.y = n.y === null || n.y === undefined ? y : lerp(n.y, y, Math.min(1, dt * 10));
  const fx = Math.cos(tp.psi), fz = -Math.sin(tp.psi), sgn = n.dir;
  const pitch = Math.atan2(gY(tp.x + fx * 1.0, tp.z + fz * 1.0) - gY(tp.x - fx * 1.0, tp.z - fz * 1.0), 2) * sgn;
  n.pitch = lerp(n.pitch || 0, pitch, Math.min(1, dt * 8));
  a.root.position.set(tp.x, n.y, tp.z);
  a.root.rotation.y = tp.psi + (n.dir < 0 ? Math.PI : 0);
  a.inner.rotation.z = n.pitch;
  a.inner.position.y = state.traffic ? Math.abs(Math.sin(clock * 9 + n.ph)) * 0.03 : 0;
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  const playing = state.phase === 'play';

  if (playing && HF) {
    const ctl = inp(), n = 2;
    for (let i = 0; i < n; i++) step(dt / n, ctl);
    lapUpdate(dt);
  } else {
    P.v = 0;
    if (!reduced) OV.az += dt * 0.12;
  }
  if (state.orbit && !reduced && playing && state.cam === 'overview') OV.az += dt * 0.15;
  if (!cam.drag) cam.userAz *= Math.exp(-dt * 1.2);

  NPC[0].key = kind === 'car' ? 'nBike' : 'nCar';
  NPC[0].r = kind === 'car' ? 0.6 : 0.95;
  NPC.forEach(n => placeNpc(n, dt));

  const pa = kind === 'car' ? A.pCar : A.pBike, sp = VEH[kind];
  const target = P.gy !== undefined ? P.gy : gY(P.x, P.z);
  P.y = lerp(P.y, target, Math.min(1, dt * 14));
  const frac = clamp(Math.abs(P.v) / sp.maxF, 0, 1);
  pa.root.position.set(P.x, P.y + P.jy, P.z);
  pa.root.rotation.y = P.psi;
  const lean = -P.steer * frac * sp.lean * (P.v < 0 ? -1 : 1);
  pa.inner.rotation.x = lerp(pa.inner.rotation.x, lean + P.roll + P.wobRoll, Math.min(1, dt * 8));
  pa.inner.rotation.z = lerp(pa.inner.rotation.z, P.pitch + clamp(P.acc * 0.006, -0.06, 0.06), Math.min(1, dt * 6));
  pa.inner.position.y = Math.abs(Math.sin(clock * 9)) * 0.03 * Math.min(1, Math.abs(P.v));

  placeCamera(dt);
  const chase = state.cam === 'chase' && playing;
  const wantExt = chase ? 24 : 56;
  if (wantExt !== shadowExt) setShadowExt(wantExt);
  followShadow(chase ? P.x : 0, chase ? P.y : 2, chase ? P.z : -15);

  camera.updateMatrixWorld();
  pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(pm);
  for (let i = 0; i < groundChunks.length; i++) groundChunks[i].mesh.visible = frustum.intersectsBox(groundChunks[i].box);

  renderer.shadowMap.needsUpdate = true;
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);

  setText('spd', String(Math.round(Math.abs(P.v) * 3.6)));
  setText('lapN', String(lap.n));
  setText('lapT', lap.running ? fmt(lap.time) : '0:00.00');
  setText('lapL', fmt(lap.last));
  setText('potN', String(P.pot));
  setText('alt', P.y.toFixed(1));
  const gr = Math.round(Math.tan(P.pitch) * 100);
  setText('grade', (gr > 0 ? '+' : '') + gr + '%');
  P.potMsg = Math.max(0, P.potMsg - dt);
  const w = playing && lap.wrong > 0.6, pm2 = P.potMsg > 0;
  if ($('wrong').hidden === w) $('wrong').hidden = !w;
  if ($('potwarn').hidden === pm2) $('potwarn').hidden = !pm2;
  hudT += dt;
  if (hudT > 0.05) { hudT = 0; drawMini(); updateBest(); }
  audioTick();
  requestAnimationFrame(frame);
}

// ===== Boot =====
mods.car = buildCar(); mods.bike = buildBike(); mods.auto = buildAuto();
sprite($('thCar'), mods.car, CAR_MIN, CAR_MAX);
sprite($('thBike'), mods.bike, BIKE_MIN, BIKE_MAX);
resize();
setSun(state.hour);
if (state.lite) { $('vox').value = 25; $('voxOut').textContent = '25 cm'; }
resetRun();
updateBest();
requestAnimationFrame(frame);
rebuild();
window.__loop = { P, lap, state, SOLIDS, World, start, setCam, keys, A, gY, NPC, VEH, get HF() { return HF; }, potholeHit, setKind, step, inp, resetRun, lapUpdate };
