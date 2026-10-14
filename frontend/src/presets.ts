import { useEngineStore } from "./store";

/** Example engines: a starting point the user picks, never a design the app pre-fills. */
export const PRESETS: { name: string; fields: [string, number | string][] }[] = [
  { name: "GOX/Kerosene test · 500 N", fields: [["propellant_pair", "GoxKerosene"], ["thrust", 500], ["chamber_pressure", 15e5], ["mixture_ratio", 2.4], ["l_star", 1.0], ["wall_material", "OFHC Copper"], ["cooling_method", "regen"], ["cooling.coolant", "Water"], ["cooling.coolant_velocity_m_s", 20], ["cooling.coolant_pressure_bar", 40]] },
  { name: "LOX/Methane · 25 kN", fields: [["propellant_pair", "LoxMethane"], ["thrust", 25000], ["chamber_pressure", 60e5], ["mixture_ratio", 3.4], ["l_star", 0.8], ["wall_material", "CuCrZr"], ["cooling_method", "regen"], ["cooling.channel_count", 80], ["cooling.channel_width_mm", 0.8], ["cooling.channel_height_mm", 1.5], ["cooling.coolant_pressure_factor", 2.0]] },
  { name: "LOX/RP-1 booster · 100 kN", fields: [["propellant_pair", "LoxRp1"], ["thrust", 100000], ["chamber_pressure", 70e5], ["mixture_ratio", 2.6], ["l_star", 1.0], ["wall_material", "SS 316L"], ["cooling_method", "ablative"]] },
  { name: "N₂O/Propane · 2 kN", fields: [["propellant_pair", "NitrousPropane"], ["thrust", 2000], ["chamber_pressure", 20e5], ["mixture_ratio", 6.5], ["l_star", 1.1], ["cooling_method", "ablative"]] },
  { name: "LOX/LH₂ upper · 50 kN", fields: [["propellant_pair", "LoxHydrogen"], ["thrust", 50000], ["chamber_pressure", 50e5], ["mixture_ratio", 5.5], ["l_star", 0.7], ["wall_material", "CuCrZr"], ["cooling_method", "film"], ["cooling.film_fraction", 0.1], ["cooling.channel_count", 100], ["cooling.channel_width_mm", 1.0], ["cooling.channel_height_mm", 2.0], ["cooling.coolant_pressure_factor", 2.2]] },
];

/** Replace the design with an example's requirements (its other inputs stay at their defaults). */
export async function applyPreset(p: (typeof PRESETS)[number]) {
  const store = useEngineStore.getState();
  await store.reset();
  for (const [k, v] of p.fields) await useEngineStore.getState().apply(k, v);
}
