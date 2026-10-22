// Sky for Hill Loop: a gradient dome that follows the camera, a sun disc, a few blocky clouds, and the fog colour that
// hides the edge of the streamed ground. Pure drawing: it holds no map data and adds a few hundred triangles, so it
// does not touch the memory budget. "Classic" hides all of it and the page's own CSS gradient shows through as before.
const R = 280;            // dome radius; the camera far plane is 340
const CLOUDS = 16;

export function createSky(THREE, scene) {
  const group = new THREE.Group();
  group.renderOrder = -10;

  // ---- dome: vertex colours, horizon at y = 0, zenith at the top, horizon colour below ----
  const geo = new THREE.SphereGeometry(R, 28, 16);
  const pos = geo.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -10; dome.frustumCulled = false;
  group.add(dome);

  // ---- sun: a flat disc on the dome in the direction of the real sun light ----
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff6dc, fog: false, depthWrite: false });
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(15, 20), sunMat);
  sunDisc.renderOrder = -9; sunDisc.frustumCulled = false;
  group.add(sunDisc);

  // ---- clouds: flat stacks of cubes, one instanced mesh, drifting slowly round the camera ----
  const boxes = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let c = 0; c < CLOUDS; c++) {
    const ang = (c / CLOUDS) * Math.PI * 2 + rnd() * 0.3, rad = 190 + rnd() * 70, y = 50 + rnd() * 60;
    const cx = Math.cos(ang) * rad, cz = Math.sin(ang) * rad, k = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < k; i++) {
      const sx = 14 + rnd() * 16, sz = 10 + rnd() * 10, sy = 4 + rnd() * 2;
      boxes.push({ x: cx + (i - k / 2) * 12 + rnd() * 6, y: y + (i % 2) * 2, z: cz + (rnd() - 0.5) * 14, sx, sy, sz });
    }
  }
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthWrite: false });
  const clouds = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cloudMat, boxes.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  boxes.forEach((b, i) => { m4.compose(ps.set(b.x, b.y, b.z), q, sc.set(b.sx, b.sy, b.sz)); clouds.setMatrixAt(i, m4); });
  clouds.instanceMatrix.needsUpdate = true;
  clouds.renderOrder = -8; clouds.frustumCulled = false;
  group.add(clouds);

  scene.add(group);

  const horizon = new THREE.Color(0xcfe2ee), zenith = new THREE.Color(0x5a9bd4), tmp = new THREE.Color();
  let enabled = true, drift = 0;

  // Colours from the time of day (same warm factor the lighting uses): clear blue at noon, peach near the horizon at the ends of the day.
  function setHour(el, warm, sunDir) {
    zenith.setRGB(0.30 + 0.10 * warm, 0.57 - 0.12 * warm, 0.84 - 0.18 * warm);
    horizon.setRGB(0.82 + 0.15 * warm, 0.89 - 0.17 * warm, 0.94 - 0.38 * warm);
    for (let i = 0; i < n; i++) {
      const y = pos.getY(i) / R, t = y <= 0 ? 0 : Math.pow(y, 0.55);
      tmp.copy(horizon).lerp(zenith, t);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    geo.attributes.color.needsUpdate = true;
    cloudMat.color.setRGB(1, 0.99 - 0.12 * warm, 0.97 - 0.28 * warm);
    sunMat.color.setRGB(1, 0.97 - 0.2 * warm, 0.86 - 0.4 * warm);
    // keep the sun disc above the horizon and on the dome
    const d = sunDir.clone().normalize();
    d.y = Math.max(d.y, 0.12); d.normalize();
    sunDisc.position.copy(d).multiplyScalar(R - 6);
  }

  return {
    horizon,
    get enabled() { return enabled; },
    setEnabled(on) { enabled = !!on; group.visible = enabled; },
    setHour,
    // Follow the camera (x, z and y so the horizon stays at eye level); drift the clouds.
    update(camera, dt) {
      group.position.copy(camera.position);
      sunDisc.lookAt(camera.position);
      drift += dt * 0.004; clouds.rotation.y = drift;
    },
    dispose() {
      scene.remove(group);
      geo.dispose(); dome.material.dispose(); sunMat.dispose(); sunDisc.geometry.dispose(); clouds.geometry.dispose(); cloudMat.dispose(); clouds.dispose();
    }
  };
}
