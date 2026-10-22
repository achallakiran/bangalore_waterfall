// Wheel-contact model (Physics: New). Pure maths: no screen, no three.js, no map. The game gives it the ground height under each
// wheel and it returns the body height, pitch and roll, which wheels touch, and the force each wheel carries.
//
//  * A wheel is a circle of radius R rolling along the travel direction. Its "effective ground" is the height its centre-bottom rides
//    at: flat ground gives the ground height, an edge or a pit rim is rolled over along the wheel's arc (effectiveHeight).
//  * Each wheel has a spring and damper between the body and that effective ground. Compression sets the upward force; a wheel may
//    droop a little below its rest length and stays in contact (pulling nothing) before it leaves the ground.
//  * The body (unit mass) is pushed by the sum of the wheel forces and by gravity: height, then pitch and roll through the wheel arms.
//  * No wheel in contact means airborne: the body falls freely. The first contact after air reports the landing speed.
// Units: metres, seconds, forces as accelerations (mass 1). The rest height of the body is the ground height, so a parked vehicle
// reports y equal to the ground under it, exactly like the old model.

export const G = 9.8;   // default; the game passes its own (cfg.g) so falls feel as they did in v2.9.2

// Height of the lowest point of a wheel of radius R whose centre is over (wx, wz), rolling along (dx, dz) (unit vector).
// ground(x, z) is the ground height. The wheel touches wherever the arc sits on the ground; the answer is the largest of
// ground(s) + sqrt(R^2 - s^2) - R over the arc samples, so a lip lifts the wheel smoothly and a pit lets it fall in smoothly.
const ARC = [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1];
export function effectiveHeight(ground, wx, wz, dx, dz, R) {
  let best = -Infinity;
  for (let i = 0; i < ARC.length; i++) {
    const s = ARC[i] * R, h = ground(wx + dx * s, wz + dz * s) + Math.sqrt(Math.max(0, R * R - s * s)) - R;
    if (h > best) best = h;
  }
  return best;
}

// cfg: { wheels: [[lx, lz], ...] (lx forward, lz to the right), R, stat (static compression, m), zeta (damping ratio),
//        droop (m a wheel can drop below rest length and still touch), stop (m of compression before the bump stop),
//        rgP, rgR (radius of gyration for pitch and roll, m), pitchLimit, rollLimit }
export function createContact(cfg) {
  const W = cfg.wheels, n = W.length;
  const stat = cfg.stat, droop = cfg.droop, stop = cfg.stop, g = cfg.g || G;
  const kk = g / (n * stat);                           // spring rate per wheel (acceleration per metre) so n wheels hold the body at `stat`
  const cc = 2 * cfg.zeta * Math.sqrt(n * kk) / n;     // damper per wheel
  const rgP2 = cfg.rgP * cfg.rgP, rgR2 = cfg.rgR * cfg.rgR;
  const hasRoll = W.some(w => w[1] !== 0);
  const S = {
    y: 0, vy: 0, pitch: 0, wp: 0, roll: 0, wr: 0,
    x: new Float64Array(n),            // compression of each wheel (negative = drooping)
    f: new Float64Array(n),            // force each wheel carries
    c: new Float64Array(n),            // effective ground under each wheel (as last given)
    touch: new Uint8Array(n), nTouch: 0, airT: 0, airborne: false,
    landed: 0,                         // landing speed reported by the last step that touched down after being in the air (else 0)
    bottomed: 0,                       // speed at which the bump stop was hit in the last step (else 0)
    cfg, kk, cc, g
  };

  S.reset = function (y, pitch, roll) {
    S.y = y; S.vy = 0; S.pitch = pitch || 0; S.wp = 0; S.roll = roll || 0; S.wr = 0; S.airT = 0; S.airborne = false; S.landed = 0; S.bottomed = 0;
    S.x.fill(0); S.f.fill(0); S.touch.fill(0); S.nTouch = 0;
  };

  // One physics step of length dt (seconds). cNew[i] = effective ground under wheel i at the end of the step, cOld[i] at the start.
  // The ground is blended across the sub-steps so a fast wheel meets an edge gradually instead of all at once.
  S.step = function (dt, cOld, cNew) {
    const sub = Math.max(1, Math.ceil(dt * 240)), h = dt / sub;
    S.landed = 0; S.bottomed = 0;
    for (let q = 0; q < sub; q++) {
      const a = (q + 1) / sub, b = q / sub;
      const sp = Math.sin(S.pitch), sr = Math.sin(S.roll);
      let F = 0, TP = 0, TR = 0, touching = 0;
      for (let i = 0; i < n; i++) {
        const ci = cOld[i] + (cNew[i] - cOld[i]) * a, cp = cOld[i] + (cNew[i] - cOld[i]) * b;
        const att = S.y + W[i][0] * sp - W[i][1] * sr;              // height of the wheel mount above the ground datum
        const x = ci + stat - att;                                  // compression (stat at rest on flat ground)
        const attV = S.vy + W[i][0] * Math.cos(S.pitch) * S.wp - W[i][1] * Math.cos(S.roll) * S.wr;
        const xd = (ci - cp) / h - attV;                            // rate of compression
        S.x[i] = x; S.c[i] = ci;
        if (x > -droop) {
          touching++;
          if (!S.touch[i] && xd > S.landed) S.landed = xd;           // a wheel meeting the ground again: how fast it arrived
          S.touch[i] = 1;
          let f = x > 0 ? kk * x + cc * xd : 0;
          if (f < 0) f = 0;
          S.f[i] = f; F += f; TP += f * W[i][0]; TR += f * W[i][1];
        } else { S.touch[i] = 0; S.f[i] = 0; }
      }
      const was = S.airborne;
      S.nTouch = touching;
      if (touching) {
        // Bump stop: the deepest wheel cannot compress past `stop`. The body is lifted back and the speed it hit at is reported.
        let deep = 0;
        for (let i = 0; i < n; i++) if (S.x[i] - stop > deep) deep = S.x[i] - stop;
        if (deep > 0) {
          S.y += deep;
          if (S.vy < 0) { S.bottomed = Math.max(S.bottomed, -S.vy); S.vy *= -0.05; }
        }
        S.airborne = false; S.airT = 0;
      } else {
        S.airT += h;
        S.airborne = true;
      }
      // Rising and unsupported (a crest, a hill-climb stair) gravity pulls harder, so the vehicle settles back on the road instead of
      // hopping off it. Falling is plain gravity, so cliffs and ledges are unchanged.
      S.vy += (F - (S.vy > 0 && F === 0 ? g * (cfg.upMul || 1) : g)) * h;
      S.y += S.vy * h;
      if (touching) {
        S.wp += (TP / rgP2) * h;
        if (hasRoll) S.wr += (-TR / rgR2) * h;
      } else {
        S.wp *= Math.exp(-0.5 * h); S.wr *= Math.exp(-0.5 * h);
      }
      S.pitch += S.wp * h; S.roll += S.wr * h;
      if (S.pitch > cfg.pitchLimit) { S.pitch = cfg.pitchLimit; if (S.wp > 0) S.wp = 0; }
      if (S.pitch < -cfg.pitchLimit) { S.pitch = -cfg.pitchLimit; if (S.wp < 0) S.wp = 0; }
      if (S.roll > cfg.rollLimit) { S.roll = cfg.rollLimit; if (S.wr > 0) S.wr = 0; }
      if (S.roll < -cfg.rollLimit) { S.roll = -cfg.rollLimit; if (S.wr < 0) S.wr = 0; }
    }
  };

  // Sum of the wheel forces (acceleration) and the force-weighted ground slope for the last step: used for the speed lost climbing.
  S.load = function () { let s = 0; for (let i = 0; i < n; i++) s += S.f[i]; return s; };

  return S;
}
