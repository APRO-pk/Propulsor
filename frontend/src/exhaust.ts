/**
 * Exhaust plume physics for the viewport: ambient pressure from altitude, the
 * nozzle's expansion state, the fully-expanded jet and its shock-cell spacing.
 * Engineering approximations (quasi-1D isentropic, Prandtl–Pack cells), sized
 * for a faithful picture of the expansion state, not for jet acoustics.
 */

/** U.S. Standard Atmosphere 1976, piecewise to 86 km, then an exponential tail (Pa). */
export function ambientPressure(hM: number): number {
  const h = Math.max(0, hM);
  if (h <= 11000) return 101325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
  if (h <= 20000) return 22632.1 * Math.exp(-1.57688e-4 * (h - 11000));
  if (h <= 32000) return 5474.89 * Math.pow(1 + 4.61574e-6 * (h - 20000), -34.1632);
  if (h <= 47000) return 868.019 * Math.pow(1 + 1.22458e-5 * (h - 32000), -12.2011);
  // Above 47 km a single scale height is within ~40% of the standard table, ample for a picture.
  if (h <= 86000) return 110.906 * Math.exp(-(h - 47000) / 6900);
  return 0.3734 * Math.exp(-(h - 86000) / 6000);
}

/** Isentropic area ratio A/A* at Mach M. */
const areaRatio = (M: number, g: number) => (1 / M) * Math.pow((2 / (g + 1)) * (1 + ((g - 1) / 2) * M * M), (g + 1) / (2 * (g - 1)));

export type ExpansionState = "over" | "matched" | "under" | "vacuum";

export interface Exhaust {
  /** Exit-to-ambient pressure ratio Pe/Pa. */
  n: number;
  state: ExpansionState;
  /** Fully-expanded jet Mach number. */
  mj: number;
  /** Fully-expanded jet diameter over exit diameter. */
  djDe: number;
  /** Shock-cell spacing in exit diameters (Prandtl–Pack, 1.306·Dj·√(Mj²−1)). */
  cellDe: number;
  /** Blend toward the diffuse vacuum bloom (0 at sea level, 1 in vacuum). */
  vacuum: number;
  /** Summerfield criterion: over-expanded below Pe/Pa ≈ 0.4 the flow may separate inside the nozzle. */
  separationRisk: boolean;
}

export function exhaust(pe: number, me: number, gamma: number, pa: number): Exhaust {
  const g = gamma;
  const n = pa > 1e-3 ? pe / pa : 1e9;
  // Total-to-ambient pressure ratio, then the Mach the jet reaches once expanded to ambient.
  const p0pe = Math.pow(1 + ((g - 1) / 2) * me * me, g / (g - 1));
  const p0pa = Math.min(p0pe * n, 1e7);
  const mj = Math.sqrt(Math.max(1.0001, (2 / (g - 1)) * (Math.pow(p0pa, (g - 1) / g) - 1)));
  const djDe = Math.sqrt(areaRatio(mj, g) / areaRatio(me, g));
  const cellDe = Math.min(12, 1.306 * djDe * Math.sqrt(mj * mj - 1));
  const vacuum = Math.min(1, Math.max(0, (Math.log10(n) - 2.3) / 1.4));
  const state: ExpansionState = vacuum > 0.6 ? "vacuum" : n < 0.9 ? "over" : n > 1.1 ? "under" : "matched";
  return { n, state, mj, djDe, cellDe, vacuum, separationRisk: n < 0.4 };
}
