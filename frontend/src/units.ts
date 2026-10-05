/**
 * Per-field unit system. Every physical input is stored canonically (the design
 * keeps SI, or a param's natural base unit) and converted only for display/entry.
 * Each dimension lists the units a field can be shown in; a unit converts to and
 * from the dimension's SI base. Temperature is affine (offset), the rest linear.
 */
export type Dim =
  | "pressure"
  | "force"
  | "length"
  | "temperature"
  | "velocity"
  | "massflow"
  | "power"
  | "time";

export interface Unit {
  label: string;
  toSI: (x: number) => number;
  fromSI: (x: number) => number;
  /** Suggested display precision for this unit. */
  decimals: number;
}

/** A linear (factor-only) unit: `1 unit = factor × SI base`. */
function lin(label: string, factor: number, decimals: number): Unit {
  return { label, toSI: (x) => x * factor, fromSI: (x) => x / factor, decimals };
}

export const DIMS: Record<Dim, { base: string; units: Unit[] }> = {
  pressure: {
    base: "Pa",
    units: [lin("bar", 1e5, 2), lin("psi", 6894.757, 0), lin("MPa", 1e6, 3), lin("GPa", 1e9, 4), lin("kPa", 1e3, 1), lin("atm", 101325, 3), lin("Pa", 1, 0)],
  },
  force: {
    base: "N",
    units: [lin("N", 1, 0), lin("kN", 1e3, 3), lin("lbf", 4.4482216, 1), lin("kgf", 9.80665, 1), lin("MN", 1e6, 4)],
  },
  length: {
    base: "m",
    units: [lin("mm", 1e-3, 2), lin("cm", 1e-2, 3), lin("m", 1, 4), lin("in", 0.0254, 3)],
  },
  velocity: {
    base: "m/s",
    units: [lin("m/s", 1, 2), lin("ft/s", 0.3048, 1), lin("km/h", 1 / 3.6, 1)],
  },
  massflow: {
    base: "kg/s",
    units: [lin("kg/s", 1, 3), lin("g/s", 1e-3, 1), lin("lb/s", 0.45359237, 3)],
  },
  power: {
    base: "W",
    units: [lin("W", 1, 0), lin("kW", 1e3, 2), lin("MW", 1e6, 3), lin("hp", 745.6999, 1)],
  },
  time: {
    base: "s",
    units: [lin("s", 1, 2), lin("ms", 1e-3, 1), lin("min", 60, 2)],
  },
  temperature: {
    base: "K",
    units: [
      { label: "K", toSI: (x) => x, fromSI: (x) => x, decimals: 1 },
      { label: "°C", toSI: (x) => x + 273.15, fromSI: (x) => x - 273.15, decimals: 1 },
      { label: "°F", toSI: (x) => ((x - 32) * 5) / 9 + 273.15, fromSI: (x) => ((x - 273.15) * 9) / 5 + 32, decimals: 1 },
    ],
  },
};

/** Look up a unit by label within a dimension (falls back to the first). */
export function unitOf(dim: Dim, label: string | undefined): Unit {
  const d = DIMS[dim];
  return d.units.find((u) => u.label === label) ?? d.units[0];
}

/** Round to a unit's suggested precision and drop trailing zeros. */
export function show(u: Unit, siValue: number): string {
  return String(Number(u.fromSI(siValue).toFixed(u.decimals)));
}
