// The edge of the map: a ring of blocky hills just outside the ground so the world does not simply stop, and the
// "how close to the edge, which way am I heading" numbers the game uses to slow the vehicle down near the wall.
// The ring is one instanced mesh (a few thousand cubes at most) made from the map's own size; it holds no map data and sits
// outside the memory budget. The invisible wall at the edge of the ground stays as the last guard.
const CELL = 2, RINGS = 14, MAX = 40000;

export function createEdge(THREE, scene, World) {
  const S = World.SLAB, cells = [];
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const W = CELL * RINGS;
  // smooth value noise (two scales) so the hills roll instead of stepping in big slabs
  const vn = (x, z, sc) => { const gx = x / sc, gz = z / sc, i = Math.floor(gx), k = Math.floor(gz), fx = gx - i, fz = gz - k, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    return (hash(i, k) * (1 - u) + hash(i + 1, k) * u) * (1 - v) + (hash(i, k + 1) * (1 - u) + hash(i + 1, k + 1) * u) * v; };
  for (let x = S.x0 - W; x < S.x1 + W; x += CELL) for (let z = S.z0 - W; z < S.z1 + W; z += CELL) {
    const cx = x + CELL / 2, cz = z + CELL / 2;
    const dx = Math.max(S.x0 - cx, 0, cx - S.x1), dz = Math.max(S.z0 - cz, 0, cz - S.z1);
    const d = Math.max(dx, dz);   // how far outside the ground this cell is
    if (d <= 0) continue;
    cells.push({ cx, cz, d, ex: Math.min(S.x1 - 0.01, Math.max(S.x0 + 0.01, cx)), ez: Math.min(S.z1 - 0.01, Math.max(S.z0 + 0.01, cz)) });
    if (cells.length >= MAX) break;
  }
  const n = cells.length;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, n));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), c = new THREE.Color();
  const GRASS = [0x5aa043, 0x66ab4a, 0x4e9139, 0x6fb352], ROCK = [0x8a7a62, 0x7d6f5a, 0x9a8a70], DEEP = [0x2f5f2c, 0x3a7335, 0x2b5a2a];
  cells.forEach((k, i) => {
    const r = hash(Math.round(k.cx * 3), Math.round(k.cz * 3)), j = Math.floor(k.d / CELL);
    const base = World.heightAt(k.ex, k.ez);                    // match the ground where it ends, so the hills grow out of it
    const rise = Math.min(1, k.d / (CELL * RINGS * 0.8));
    const top = base + 0.6 + rise * rise * (7 + 9 * vn(k.cx, k.cz, 14)) + 2.2 * vn(k.cx, k.cz, 5) * (0.4 + rise) + r * 0.5;
    const bottom = Math.min(base, World.Y_MIN) - 10;
    sc.set(CELL * 1.001, top - bottom, CELL * 1.001);
    m4.compose(ps.set(k.cx, (top + bottom) / 2, k.cz), q, sc);
    mesh.setMatrixAt(i, m4);
    const hv = vn(k.cx + 91, k.cz - 37, 9);
    const pal = rise > 0.7 && hv > 0.62 ? ROCK : (rise > 0.45 && hv < 0.3 ? DEEP : GRASS);
    c.setHex(pal[Math.floor(r * 97) % pal.length]);
    mesh.setColorAt(i, c);
  });
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const WALL = 1.2, ZONE = 22;
  const out = { f: 0, away: 1 };
  return {
    cells: n,
    setVisible(v) { mesh.visible = !!v; },
    // f: 0 well inside .. 1 at the wall. out: share of the vehicle's velocity heading at the nearest edge (0..1).
    probe(x, z, vx, vz) {
      const dxl = x - (S.x0 + WALL), dxr = (S.x1 - WALL) - x, dzl = z - (S.z0 + WALL), dzr = (S.z1 - WALL) - z;
      let f = 0, o = 0;
      const sides = [[dxl, -vx], [dxr, vx], [dzl, -vz], [dzr, vz]];
      for (const [d, v] of sides) {
        if (d >= ZONE) continue;
        const ff = Math.min(1, Math.max(0, (ZONE - d) / ZONE));
        if (ff > f) f = ff;
        const sp = Math.hypot(vx, vz) || 1;
        if (v > 0) o = Math.max(o, ff * (v / sp));
      }
      out.f = f; out.away = o;
      return out;
    },
    ZONE,
    dispose() { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }
  };
}
