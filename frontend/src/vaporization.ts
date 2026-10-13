/**
 * Browser-dev mirror of the Rust injector atomization + Priem–Heidmann
 * vaporization model (crates/injector/src/{liquids,flow,efficiency}.rs).
 * Sources and derivations are documented there; this file only mirrors the
 * numbers so the offline mock shows the same results. The one simplification:
 * the mock has no equilibrium solver, so the c*(MR_v)/c*(MR) ratio is taken as 1
 * (the mass-fraction term alone).
 */

export type Phase = "Liquid" | "Gas";

export interface Liquid {
  name: string;
  density_kg_m3: number;
  viscosity_pa_s: number;
  surface_tension_n_m: number;
  heat_of_vaporization_j_kg: number;
  critical_temp_k: number;
  molecular_weight: number;
  injection_temp_k: number;
  source: string;
}

const L = (name: string, density_kg_m3: number, viscosity_pa_s: number, surface_tension_n_m: number, hv_kj: number, critical_temp_k: number, molecular_weight: number, injection_temp_k: number, source: string): Liquid => ({
  name, density_kg_m3, viscosity_pa_s, surface_tension_n_m, heat_of_vaporization_j_kg: hv_kj * 1e3, critical_temp_k, molecular_weight, injection_temp_k, source,
});

const LOX = L("LOX", 1142.1, 1.957e-4, 0.01319, 213.2, 154.58, 32.0, 90.0, "NIST sat. liquid, 90 K");
const METHANE = L("LCH4", 422.3, 1.167e-4, 0.01291, 510.8, 190.56, 16.04, 111.7, "NIST sat. liquid, 111.7 K");
const PROPANE = L("Propane", 492.4, 9.72e-5, 0.00702, 335.7, 369.89, 44.1, 298.15, "NIST sat. liquid, 298.15 K");
const NITROUS = L("N2O", 785.1, 6.82e-5, 0.00206, 169.9, 309.52, 44.01, 293.15, "NIST sat. liquid, 293.15 K");
const METHANOL = L("Methanol", 786.3, 5.437e-4, 0.02215, 1168.9, 512.6, 32.04, 298.15, "NIST liquid, 298.15 K");
const HYDROGEN = L("LH2", 70.9, 1.357e-5, 0.00192, 449.0, 33.15, 2.016, 20.3, "NIST sat. liquid, 20.3 K");
const GASOLINE = L("Gasoline (n-heptane)", 679.6, 3.901e-4, 0.01974, 365.0, 540.2, 100.2, 298.15, "NIST n-heptane, 298.15 K");
const RP1 = L("RP-1", 810.0, 1.669e-3, 0.02904, 290.75, 676.5, 172.0, 293.17, "rocketprops / NASA CR-168066, 527.7 °R");
const ETHANOL = L("Ethanol", 789.6, 1.195e-3, 0.02242, 927.1, 513.9, 46.07, 293.17, "rocketprops, 527.7 °R");
const MMH = L("MMH", 879.8, 8.449e-4, 0.03431, 876.9, 585.4, 46.07, 293.17, "rocketprops (AFRPL-TR-69-149), 527.7 °R");
const UDMH = L("UDMH", 790.4, 5.533e-4, 0.02464, 582.7, 523.2, 60.1, 293.17, "rocketprops (AFRPL-TR-69-149), 527.7 °R");
const NTO = L("NTO", 1441.4, 4.201e-4, 0.02622, 414.5, 431.4, 92.01, 293.17, "rocketprops, 527.7 °R");
const PEROXIDE = L("H2O2 (100%)", 1450.0, 1.363e-3, 0.08136, 1564.9, 730.2, 34.02, 288.17, "rocketprops, 518.7 °R");

type Side = [Liquid, Phase];
const PAIRS: Record<string, [Side, Side]> = {
  GoxKerosene: [[LOX, "Gas"], [RP1, "Liquid"]],
  GoxGasoline: [[LOX, "Gas"], [GASOLINE, "Liquid"]],
  GoxEthanol: [[LOX, "Gas"], [ETHANOL, "Liquid"]],
  GoxMethanol: [[LOX, "Gas"], [METHANOL, "Liquid"]],
  LoxRp1: [[LOX, "Liquid"], [RP1, "Liquid"]],
  LoxEthanol: [[LOX, "Liquid"], [ETHANOL, "Liquid"]],
  LoxMethane: [[LOX, "Liquid"], [METHANE, "Liquid"]],
  NitrousPropane: [[NITROUS, "Liquid"], [PROPANE, "Liquid"]],
  NtoMmh: [[NTO, "Liquid"], [MMH, "Liquid"]],
  NtoUdmh: [[NTO, "Liquid"], [UDMH, "Liquid"]],
  LoxHydrogen: [[LOX, "Liquid"], [HYDROGEN, "Gas"]],
  H2o2Kerosene: [[PEROXIDE, "Gas"], [RP1, "Liquid"]],
};

export function liquidsFor(pair: string): [Side, Side] {
  const p = PAIRS[pair] ?? PAIRS.GoxKerosene;
  return [[{ ...p[0][0] }, p[0][1]], [{ ...p[1][0] }, p[1][1]]];
}

export function vaporizationModelApplies(pair: string): string | null {
  return pair === "NtoMmh" || pair === "NtoUdmh"
    ? "hypergolic propellants react in the liquid phase, so combustion is not vaporization-limited; the Priem–Heidmann model does not apply"
    : null;
}

export type ElementType = "LikeDoublet" | "UnlikeDoublet" | "Triplet" | "Coaxial" | "Pintle";
type Family = "ImpingingJets" | "Triplet" | "ParallelJets";

export function sprayFamily(e: string): [Family, boolean] {
  if (e === "LikeDoublet") return ["ImpingingJets", false];
  if (e === "Triplet") return ["Triplet", false];
  if (e === "Coaxial") return ["ParallelJets", true];
  return ["ImpingingJets", true]; // UnlikeDoublet, Pintle
}

/** TR R-67 Fig. 27 (via CR-168066) uncorrected mass-median radius, µm; d in cm. */
function uncorrectedRadiusUm(f: Family, dCm: number): number {
  const d = Math.max(dCm, 1e-4);
  if (f === "ImpingingJets") return 449.0 * Math.pow(d, 0.992);
  if (f === "Triplet") return 78.8 * Math.pow(d, 0.622);
  return 430.4 * Math.pow(d, 0.616);
}

export function massMedianRadiusUm(f: Family, dM: number, l: Liquid): number {
  const group = Math.pow((l.surface_tension_n_m * l.viscosity_pa_s) / l.density_kg_m3, 0.25);
  return 99.29 * uncorrectedRadiusUm(f, dM * 100) * group;
}

export const defaultMixingEfficiency = (e: string) => (e === "LikeDoublet" ? 0.97 : 1.0);

/** CR-168066 Fig. 26 (L_gen cm, probit z). */
const CURVE: [number, number][] = [
  [0.05, -2.7307], [0.1, -2.3575], [0.15, -2.1294], [0.25, -1.8719], [0.5, -1.5167], [0.75, -1.2959],
  [1.0, -1.1527], [1.5, -0.9307], [2.5, -0.62], [3.5, -0.4157], [5.0, -0.1938], [7.5, 0.067],
  [10.0, 0.2723], [15.0, 0.5421], [20.0, 0.7651], [25.0, 0.9338], [35.0, 1.229], [50.0, 1.5665],
  [75.0, 1.9905], [100.0, 2.3167], [150.0, 2.8845], [250.0, 3.6727],
];

function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + (z >= 0 ? erf : -erf));
}

export function fractionVaporized(lGenCm: number): number {
  const x = Math.log(Math.max(lGenCm, 1e-6));
  let seg = CURVE.findIndex((_, i) => i < CURVE.length - 1 && x <= Math.log(CURVE[i + 1][0]));
  if (seg < 0) seg = CURVE.length - 2;
  const [a, b] = [CURVE[seg], CURVE[seg + 1]];
  const z = a[1] + ((b[1] - a[1]) * (x - Math.log(a[0]))) / (Math.log(b[0]) - Math.log(a[0]));
  return normalCdf(Math.max(-6, Math.min(6, z)));
}

export function generalizedLengthCm(pcPa: number, cr: number, cylLenM: number, l: Liquid, rUm: number, vMs: number): number {
  const c = Math.max(cr, 1);
  const lEff = (Math.max(cylLenM, 0) * 100) / Math.pow(c, 0.44);
  const tr = Math.min(l.injection_temp_k / l.critical_temp_k, 0.99);
  const kp = Math.pow(1 - tr, 0.4) * Math.pow(l.heat_of_vaporization_j_kg / 325.64e3, 0.8) * Math.pow(l.molecular_weight / 100, 0.35);
  const kj = Math.pow(Math.max(rUm, 0.1) / 76.2, 1.45) * Math.pow(Math.max(vMs, 0.5) / 30.48, 0.75);
  return (lEff * Math.pow(pcPa / 2068.4e3, 0.66)) / (kp * kj);
}
