// Memory budgets: how many voxel cubes a device may keep alive at once.
// Each cube costs roughly 100-170 bytes (matrix + colour on CPU, plus the GPU copy), so these caps
// keep the whole scene well under a few hundred MB even on a phone.
export const TIERS = { low: 250000, medium: 450000, high: 900000 };
export const TIER_NAMES = ['auto', 'low', 'medium', 'high'];

// Measured on Hill Loop: ground is about 1.31 cubes per column; the factor leaves room for scenery and vehicles.
const CUBES_PER_COLUMN = 1.35 * 1.25;
export const VEHICLE_RESERVE = 20000;

export function detectTier(nav = (typeof navigator !== 'undefined' ? navigator : {})) {
  const mem = nav.deviceMemory || 0, cores = nav.hardwareConcurrency || 4;
  const touch = (nav.maxTouchPoints || 0) > 1;
  if ((mem && mem <= 4) || (touch && cores <= 6 && !(mem >= 8))) return 'low';
  if (mem >= 8 && !touch && cores >= 8) return 'high';
  return 'medium';
}

export function budgetFor(setting, nav) {
  if (typeof setting === 'number' && setting > 0) return { tier: 'custom', cubes: setting };
  const t = TIERS[setting] ? setting : detectTier(nav);
  return { tier: t, cubes: TIERS[t] };
}

// Rough cube count if the whole slab were built at voxel size v (metres).
export function estimateCubes(slab, v) {
  const nx = Math.ceil((slab.x1 - slab.x0) / v), nz = Math.ceil((slab.z1 - slab.z0) / v);
  return Math.round(nx * nz * CUBES_PER_COLUMN);
}

// Decide how to hold the map: whole (identical to the classic path) or streamed around the player.
// opts.force = true streams regardless (tests).
export function planMemory(slab, v, budgetCubes, opts = {}) {
  const est = estimateCubes(slab, v);
  const stream = !!opts.force || est > budgetCubes;
  return { stream, estimate: est, budget: budgetCubes, groundBudget: Math.max(20000, Math.floor(budgetCubes * 0.8) - VEHICLE_RESERVE) };
}
