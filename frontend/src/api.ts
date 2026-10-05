/**
 * Thin IPC layer over Tauri's `invoke`.
 *
 * The command signatures mirror the Rust `set_field`/`get_design`/... contract
 * (see ARCHITECTURE §8 — delta-based IPC, heavy arrays fetched on demand). The
 * Rust side generates the canonical types via `ts-rs` into `bindings.ts`; until
 * that exists we keep a small local mirror.
 *
 * This module must build even outside a Tauri host (e.g. `vite build` for CI or
 * preview), so the "is Tauri present?" check is runtime-only.
 */

/// Result envelope of the `get_design` IPC command.
export interface EngineDesignDto {
  meta: DesignMetaDto;
  propellant: PropellantSelectionDto;
  operating_point: OperatingPointDto;
  caches: TierCacheDto[];
  geometry?: {
    chamber?: { l_star_m?: number | null } | null;
    nozzle?: { kind?: "Bell" | "Conical" | null } | null;
    cooling_jacket?: { cooling_method?: string | null } | null;
  };
  materials?: { chamber?: string | null; nozzle?: string | null; tank?: string | null };
  params?: Record<string, number>;
  choices?: Record<string, string>;
}

export interface DesignMetaDto {
  name: string;
  schema_version: number;
  revision: number;
  unit_system: "Si" | "Imperial";
}

export interface PropellantSelectionDto {
  pair: string;
  of_ratio: number;
}

export interface OperatingPointDto {
  thrust: number;
  chamber_pressure: number;
  mixture_ratio: number;
  c_star_efficiency?: number;
}

export interface TierCacheDto {
  tier: string;
  status: "Stale" | "Solved" | "Failed";
  inputs_hash: number;
  /** Serialized solver payload (e.g. the L0 analytical result). */
  payload?: L0ResultDto | L1ResultDto | L2ResultDto;
}

/** Mirrors `sizing_l0::L0Result`, canonical SI (serde-transparent f64s). */
export interface L0ResultDto {
  total_flow: number; // kg/s
  oxidizer_flow: number;
  fuel_flow: number;
  isp_s: number;
  c_star_m_s: number;
  tc_k: number;
  gamma: number;
  throat_area: number; // m²
  throat_diameter: number; // m
  exit_area: number;
  exit_diameter: number;
  area_ratio: number;
  chamber_volume: number; // m³
  chamber_length: number; // m
  chamber_diameter: number; // m
  wall_thickness: number; // m
  cooling_gap: number; // m
}

/** Mirrors `thermo::ThermoResult`. */
export interface L1ResultDto {
  tc_k: number;
  gamma: number;
  mean_molecular_weight: number;
  c_star_m_s: number;
  isp_vacuum_s: number;
  species_mol: [string, number][];
}

/** A nozzle contour station (`engine_core::ContourPoint`). */
export interface ContourPointDto {
  x: number; // axial position, m
  r: number; // radius, m
}

/** Mirrors `gasdynamics::L2Result`. */
export interface L2ResultDto {
  area_ratio: number;
  exit_mach: number;
  exit_pressure_pa: number;
  exit_temperature_k: number;
  exit_diameter_m: number;
  throat_diameter_m: number;
  divergence_correction: number;
  boundary_layer_correction: number;
  isp_s: number;
  c_star_m_s: number;
  /** Nozzle contour r(x) (throat → exit), when present in the payload. */
  stations?: ContourPointDto[];
  bell_theta_n_deg?: number;
  bell_theta_e_deg?: number;
}

/** Mirrors `simulate::PerfMap`. */
export interface PerfMapDto {
  of_axis: number[];
  alt_axis: number[];
  isp_matrix: number[][];
  thrust_matrix: number[][];
}

/** Nozzle-expansion trade (`gasdynamics::optimize::ExpansionStudyResult`). */
export interface ExpansionStudyDto {
  optimal_area_ratio: number;
  mean_thrust_coefficient: number;
  sea_level_optimal_area_ratio: number;
  separation_limited_area_ratio: number;
  exit_pressure_pa: number;
  sea_level_exit_pressure_ratio: number;
  separated_at_sea_level: boolean;
}

/** Performance advice (`simulate::design::DesignAdvice`). */
export interface DesignAdviceDto {
  current_of: number;
  optimal_of: number;
  optimal_isp_vac_s: number;
  recommended_l_star_m: number;
  expansion: ExpansionStudyDto;
}

/** Wall material (`cooling::materials::Material`). */
export interface MaterialDto {
  name: string;
  thermal_conductivity_w_m_k: number;
  max_service_temp_k: number;
  density_kg_m3: number;
  allowable_stress_pa: number;
  youngs_modulus_pa: number;
  cte_per_k: number;
  emissivity: number;
  cooling_class: "Regenerative" | "Radiation" | "Ablative";
}

export interface CoolingStudyDto {
  materials: MaterialDto[];
  selected_material: string;
  method: string;
  regen: {
    max_wall_temp_k: number;
    wall_material_limit_k: number;
    min_boiling_margin_k: number;
    coolant_dp_pa: number;
    stations: { x: number; r: number; heat_flux_w_m2: number; wall_temp_k: number }[];
  };
  film?: { blowing_ratio: number; effectiveness: number; adiabatic_wall_temp_k: number; effective_length_m: number } | null;
  radiation?: { equilibrium_wall_temp_k: number; radiated_flux_w_m2: number; material_limit_k: number; material_ok: boolean; margin_k: number } | null;
  ablative?: { recession_rate_m_s: number; total_recession_m: number; required_thickness_m: number; liner_mass_per_area_kg_m2: number } | null;
  nozzle_extension_material?: string | null;
  nozzle_extension?: { equilibrium_wall_temp_k: number; radiated_flux_w_m2: number; material_limit_k: number; material_ok: boolean; margin_k: number } | null;
  heat_flux_csv: string;
  print_plan: PrintPlanDto;
}

export interface PrintRegionDto {
  name: string;
  x_start_m: number;
  x_end_m: number;
  material: string;
  process: string;
  layer_thickness_um: number;
  laser_power_w: number;
  hatch_spacing_um: number;
  high_precision: boolean;
  build_note: string;
}
export interface GradientTransitionDto {
  from_material: string;
  to_material: string;
  x_center_m: number;
  blend_length_mm: number;
  layers: number;
  composition_steps: number[];
  note: string;
}
export interface PrintPlanDto {
  regions: PrintRegionDto[];
  transitions: GradientTransitionDto[];
  total_length_m: number;
  estimated_layers: number;
  build_direction: string;
  summary: string;
}

export interface Pt2 { x: number; y: number }
export interface BladeProfileDto {
  kind: string;
  blade_count: number;
  inlet_angle_deg: number;
  outlet_angle_deg: number;
  inlet_radius_m: number;
  outlet_radius_m: number;
  span_m: number;
  slip_factor: number;
  camber: Pt2[];
  surface: Pt2[];
  summary: string;
  inlet_mach?: number;
  exit_mach?: number;
  mach_angle_deg?: number;
  prandtl_meyer_turn_deg?: number;
  throat_pitch_ratio?: number;
}
export interface LossBreakdownDto {
  items: { name: string; fraction: number }[];
  total_loss_fraction: number;
  efficiency: number;
}
export interface BladeStudyDto {
  speed_rpm: number;
  pump_blade: BladeProfileDto;
  turbine_blade: BladeProfileDto;
  supersonic_blade: BladeProfileDto;
  pump_losses: LossBreakdownDto;
  turbine_losses: LossBreakdownDto;
  pump_map: {
    design_flow_m3_s: number;
    design_head_m: number;
    speed_curves: { speed_fraction: number; points: { flow_m3_s: number; head_m: number }[] }[];
    efficiency_curve: { flow_fraction: number; efficiency: number }[];
  };
  turbine_map: {
    nozzle_angle_deg: number;
    optimum_velocity_ratio: number;
    peak_efficiency: number;
    points: { velocity_ratio: number; efficiency: number }[];
  };
  pump_tip_speed_m_s: number;
  pump_tip_speed_limit_m_s: number;
  turbine_inlet_mach: number;
  recommended_turbine_type: string;
  warnings: string[];
}

export interface TradeBundleDto {
  of_sweep: { of: number; isp_vac_s: number }[];
  optimal_of: number;
  expansion_sweep: { area_ratio: number; cf_sea_level: number; cf_vacuum: number; isp_vacuum_s: number }[];
  optimal_area_ratio: number;
  l_star_sweep: { l_star_m: number; chamber_length_m: number; chamber_volume_l: number }[];
  recommended_l_star_m: number;
  material_trade: { name: string; max_wall_temp_k: number; limit_k: number; margin_k: number; density_kg_m3: number; cooling_class: string; ok: boolean }[];
  injector_trade: { element_count: number; injection_velocity_m_s: number; smd_um: number; momentum_ratio: number; stable: boolean }[];
}

interface TankSpecDto {
  propellant: string;
  propellant_mass_kg: number;
  volume_l: number;
  diameter_m: number;
  length_m: number;
  wall_thickness_m: number;
  tank_mass_kg: number;
}

export interface FeedStudyDto {
  feed_type: string;
  burn_time_s: number;
  ox_tank: TankSpecDto;
  fuel_tank: TankSpecDto;
  tank_pressure_pa: number;
  total_propellant_mass_kg: number;
  dry_tank_mass_kg: number;
  pressurant?: { gas: string; mass_kg: number; bottle_volume_l: number; bottle_pressure_bar: number } | null;
  feed_budget: { chamber_pressure_pa: number; injector_dp_pa: number; line_dp_pa: number; required_tank_pressure_pa: number };
  recommended_feed: string;
  harness: AvionicsHarnessDto;
}

export interface HarnessChannelDto {
  name: string;
  kind: string;
  signal: string;
  voltage_v: number;
  current_a: number;
  wire_awg: number;
  connector: string;
  continuous: boolean;
  note: string;
}
export interface AvionicsHarnessDto {
  channels: HarnessChannelDto[];
  bus_voltage_v: number;
  peak_current_a: number;
  continuous_current_a: number;
  battery_capacity_wh: number;
  battery_mass_kg: number;
  harness_mass_kg: number;
  total_wire_length_m: number;
  channel_count: number;
  summary: string;
}

interface SideFlowDto {
  injection_velocity_m_s: number;
  orifice_diameter_m: number;
  weber_number: number;
  sauter_mean_diameter_m: number;
}

export interface AnalysisStudyDto {
  injector: {
    pressure_drop_pa: number;
    ox: SideFlowDto;
    fuel: SideFlowDto;
    momentum_ratio: number;
    element_type: string;
    flags: string[];
  };
  instability: {
    modes: { name: string; frequency_hz: number }[];
    dominant_mode: string;
    dominant_frequency_hz: number;
    regime: string;
    stability_margin: number;
    stable: boolean;
    notes: string[];
  };
  stress: {
    stations: { x: number; r: number; hoop_stress_pa: number; thermal_stress_pa: number; combined_stress_pa: number; margin: number }[];
    max_combined_stress_pa: number;
    min_margin: number;
    yields: boolean;
  };
  stress_csv: string;
  ere: EreResultDto;
}

export interface EreResultDto {
  residence_time_ms: number;
  required_time_ms: number;
  residence_efficiency: number;
  atomization_efficiency: number;
  mixing_efficiency: number;
  energy_release_efficiency: number;
  c_star_efficiency: number;
  summary: string;
}

export interface TurbopumpStudyDto {
  pump: { head_rise_m: number; shaft_power_w: number; cavitation_margin_m: number; specific_speed: number; pump_type: string; npsh_available_m: number; npsh_required_m: number };
  turbine: { pressure_ratio: number; shaft_power_w: number; exit_temp_k: number; specific_speed: number };
  inducer: { suction_specific_speed: number; inlet_tip_diameter_m: number; hub_diameter_m: number; flow_coefficient: number; cavitation_ok: boolean };
  shaft: { torque_nm: number; diameter_m: number; safety_margin: number; first_critical_rpm: number; critical_speed_margin: number; subcritical: boolean };
  bearing: { equivalent_load_n: number; dynamic_load_rating_n: number; l10_life_hours: number; dn_value: number; life_ok: boolean; dn_ok: boolean };
  gg_cycle: { gg_flow_fraction: number; gg_flow_kg_s: number; chamber_flow_kg_s: number; pump_power_w: number; turbine_power_w: number; margin: number };
}

export interface SpatialSensorDto {
  id: string;
  kind: string;
  x_m: number;
  r_m: number;
  predicted: number;
  measured: number;
  unit: string;
  residual_pct: number;
}
export interface TimeSampleDto {
  t_s: number;
  predicted_thrust_n: number;
  measured_thrust_n: number;
  predicted_pc_pa: number;
  measured_pc_pa: number;
}
export interface SensorValidationDto {
  sensors: SpatialSensorDto[];
  time_series: TimeSampleDto[];
  rms_spatial_pct: number;
  rms_thrust_pct: number;
  ignition_delay_s: number;
  rise_time_s: number;
  synthetic_reference: boolean;
  summary: string;
  csv: string;
}

export interface ControlLoopDto { name: string; variable: string; speed: string; bandwidth_hz: number; setpoint: number; unit: string; actuator: string }
export interface ControlActuatorDto { name: string; function: string; closed_loop: boolean; note: string }
export interface ControlRedlineDto { name: string; limit: number; unit: string }
export interface ControlStepDto { t_s: number; setpoint: number; response: number }
export interface ControlStudyDto {
  architecture: string;
  control_law: string;
  sample_rate_hz: number;
  pc_setpoint_bar: number;
  mr_setpoint: number;
  chamber_fill_time_ms: number;
  combustion_delay_ms: number;
  loops: ControlLoopDto[];
  sensors: string[];
  actuators: ControlActuatorDto[];
  redlines: ControlRedlineDto[];
  pc_step: ControlStepDto[];
  pc_settling_time_s: number;
  pc_overshoot_pct: number;
  warnings: string[];
  summary: string;
}

export interface IssueDto {
  severity: "fail" | "warn";
  area: string;
  message: string;
}
export interface IssuesReportDto {
  issues: IssueDto[];
  failed: number;
  warnings: number;
}

export interface SweepPointDto { pc_bar: number; of: number; tc_k: number; c_star_m_s: number; isp_vac_s: number; gamma: number }
export interface SweepResultDto { pc_values_bar: number[]; of_values: number[]; points: SweepPointDto[] }

const TAURI_AVAILABLE = "__TAURI_INTERNALS__" in window;

/** Invoke a Tauri command, or return a browser-dev fallback outside the host. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!TAURI_AVAILABLE) {
    // Browser mode: call the `apro-engine-server` HTTP host. If it isn't
    // reachable (e.g. plain `vite dev`), fall back to mock data.
    try {
      const r = await fetch(`/api/${cmd}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args ?? {}),
      });
      if (r.ok) return (await r.json()) as T;
    } catch {
      // ignore → mock fallback
    }
    return mockCommand<T>(cmd, args ?? {});
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Persist a single field edit and get the re-resolved design back. */
export const setField = (fieldId: string, value: number | string) =>
  invoke<EngineDesignDto>("set_field", { fieldId, value });

export const designAdvice = (burnoutM: number) =>
  invoke<DesignAdviceDto>("design_advice", { burnoutAltitudeM: burnoutM });
export const coolingStudy = (material: string, method: string) =>
  invoke<CoolingStudyDto>("cooling_study", { material, method });
export const turbopumpStudy = (speedRpm: number) =>
  invoke<TurbopumpStudyDto>("turbopump_study", { speedRpm });
export const analysisStudy = () => invoke<AnalysisStudyDto>("analysis_study");
export const validationStudy = () => invoke<SensorValidationDto>("validation_study");
export const controlStudy = (feedType: string) => invoke<ControlStudyDto>("control_study", { feedType });
export const feedStudy = (burnTimeS: number, feedType: string) =>
  invoke<FeedStudyDto>("feed_study", { burnTimeS, feedType });
export const tradeBundle = () => invoke<TradeBundleDto>("trade_bundle");
export const bladeStudy = (speedRpm: number) => invoke<BladeStudyDto>("blade_study", { speedRpm });
export const issuesReport = () => invoke<IssuesReportDto>("issues_report");
export const sweep = (pcMinBar: number, pcMaxBar: number, pcSteps: number, ofMin: number, ofMax: number, ofSteps: number) =>
  invoke<SweepResultDto>("sweep", { pcMinBar, pcMaxBar, pcSteps, ofMin, ofMax, ofSteps });

/**
 * Representative data for running the UI in a plain browser (`vite dev`) without
 * a Tauri backend — so the desktop shell, charts and 3D viewer all render for
 * development and preview. The real host overrides every one of these.
 */
function mockCommand<T>(cmd: string, args: Record<string, unknown>): T {
  switch (cmd) {
    case "get_design":
      mockResolve();
      return liveDesign as unknown as T;
    case "set_field":
      mockApply(String(args.fieldId), args.value);
      mockResolve();
      return liveDesign as unknown as T;
    case "perf_map":
      return mockPerfMap() as unknown as T;
    case "design_advice":
      return mockAdvice(Number(args.burnoutAltitudeM ?? 40000)) as unknown as T;
    case "cooling_study": {
      const mat = String(args.material || liveDesign.materials?.chamber || "OFHC Copper");
      const method = String(args.method || liveDesign.geometry?.cooling_jacket?.cooling_method || "regen");
      return mockCooling(mat, method) as unknown as T;
    }
    case "turbopump_study":
      return mockTurbopump(Number(args.speedRpm ?? 20000)) as unknown as T;
    case "analysis_study":
      return mockAnalysis() as unknown as T;
    case "feed_study":
      return mockFeed(Number(args.burnTimeS ?? 30), String(args.feedType ?? "")) as unknown as T;
    case "trade_bundle":
      return mockTrade() as unknown as T;
    case "blade_study":
      return mockBlade(Number(args.speedRpm ?? 20000)) as unknown as T;
    case "validation_study":
      return mockValidation() as unknown as T;
    case "control_study":
      return mockControl(String(args.feedType ?? "")) as unknown as T;
    case "issues_report":
      return mockIssues() as unknown as T;
    case "sweep":
      return mockSweep(args) as unknown as T;
    default:
      return undefined as unknown as T;
  }
}

/** Read a persistent design param / choice from the browser-dev design. */
function pval(key: string, def: number): number {
  const v = liveDesign.params?.[key];
  return v === undefined ? def : v;
}
function pchoice(key: string, def: string): string {
  return liveDesign.choices?.[key] ?? def;
}

/**
 * Low-fidelity propellant properties for the browser-dev mock — mirrors the Rust
 * `propellants::seeded_pairs()` table so the mock responds to the propellant
 * choice (Tc, Isp, c*) instead of showing one fixed engine. The Rust host still
 * overrides all of this with the real thermochemistry.
 */
interface MockProp { gamma: number; r: number; tc: number; ispSea: number; ofOpt: number; lStar: number }
const MOCK_PROPS: Record<string, MockProp> = {
  GoxKerosene:    { gamma: 1.2, r: 349.72, tc: 3300, ispSea: 250, ofOpt: 3.0,  lStar: 1.0 },
  GoxGasoline:    { gamma: 1.2, r: 349.72, tc: 3460, ispSea: 260, ofOpt: 2.5,  lStar: 1.0 },
  GoxEthanol:     { gamma: 1.2, r: 349.72, tc: 3000, ispSea: 230, ofOpt: 1.85, lStar: 0.9 },
  LoxMethane:     { gamma: 1.2, r: 349.72, tc: 3400, ispSea: 290, ofOpt: 3.3,  lStar: 0.8 },
  GoxMethanol:    { gamma: 1.2, r: 349.72, tc: 2800, ispSea: 220, ofOpt: 1.5,  lStar: 0.9 },
  LoxRp1:         { gamma: 1.2, r: 349.72, tc: 3500, ispSea: 300, ofOpt: 2.7,  lStar: 1.0 },
  LoxEthanol:     { gamma: 1.2, r: 349.72, tc: 3100, ispSea: 280, ofOpt: 1.85, lStar: 0.9 },
  NitrousPropane: { gamma: 1.2, r: 349.72, tc: 3200, ispSea: 250, ofOpt: 6.5,  lStar: 1.1 },
  NtoMmh:         { gamma: 1.2, r: 349.72, tc: 3300, ispSea: 285, ofOpt: 2.0,  lStar: 0.75 },
  NtoUdmh:        { gamma: 1.2, r: 349.72, tc: 3350, ispSea: 285, ofOpt: 2.6,  lStar: 0.75 },
  LoxHydrogen:    { gamma: 1.26, r: 640.0, tc: 3400, ispSea: 380, ofOpt: 5.5,  lStar: 0.7 },
  H2o2Kerosene:   { gamma: 1.21, r: 330.0, tc: 2900, ispSea: 265, ofOpt: 7.0,  lStar: 1.3 },
};
const DEFAULT_PROP: MockProp = MOCK_PROPS.GoxKerosene;
function mockProps(): MockProp {
  return MOCK_PROPS[liveDesign.propellant.pair] ?? DEFAULT_PROP;
}
/** Ideal c* = sqrt(γ R Tc)/γ / ((2/(γ+1))^((γ+1)/2(γ-1))), mirrors the Rust formula. */
function cstarOf(p: MockProp): number {
  const g = p.gamma;
  const term = Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
  return Math.sqrt((p.r * p.tc) / g) / term;
}

function thickenJs(camber: Pt2[], tLe: number, tTe: number): Pt2[] {
  const n = camber.length;
  if (n < 2) return camber.slice();
  const suction: Pt2[] = [];
  const pressure: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const a = camber[Math.max(i, 1) - 1];
    const b = camber[Math.min(i + 1, n - 1)];
    const tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1e-9;
    const nx = -ty / len, ny = tx / len;
    const s = i / (n - 1);
    const half = 0.5 * (tLe + (tTe - tLe) * s) * Math.sqrt(Math.max(0.05, 1 - (2 * s - 1) ** 2));
    suction.push({ x: camber[i].x + nx * half, y: camber[i].y + ny * half });
    pressure.push({ x: camber[i].x - nx * half, y: camber[i].y - ny * half });
  }
  pressure.reverse();
  return suction.concat(pressure);
}

// Rao thrust-optimized bell angles (80%-chart interp + length adjust) — mirrors
// the Rust `gasdynamics::contour::rao_angles`.
function raoAngles(eps: number, lf: number): [number, number] {
  const RAO80: [number, number, number][] = [
    [4, 26.5, 14], [5, 27.5, 13], [10, 30, 11], [20, 32, 9.8], [30, 33.5, 9], [50, 34.5, 8.2], [100, 36, 7.3],
  ];
  const e = Math.max(RAO80[0][0], Math.min(RAO80[RAO80.length - 1][0], eps));
  let tn = RAO80[0][1], te = RAO80[0][2];
  for (let i = 0; i < RAO80.length - 1; i++) {
    if (e >= RAO80[i][0] && e <= RAO80[i + 1][0]) {
      const f = (e - RAO80[i][0]) / (RAO80[i + 1][0] - RAO80[i][0]);
      tn = RAO80[i][1] + f * (RAO80[i + 1][1] - RAO80[i][1]);
      te = RAO80[i][2] + f * (RAO80[i + 1][2] - RAO80[i][2]);
      break;
    }
  }
  if (e >= RAO80[RAO80.length - 1][0]) { tn = RAO80[RAO80.length - 1][1]; te = RAO80[RAO80.length - 1][2]; }
  const d = 0.8 - Math.max(0.6, Math.min(1.0, lf));
  return [Math.max(15, tn + 14 * d), Math.max(2, te + 22 * d)];
}

function raoStations(rt: number, re: number, lf: number, n: number): ContourPointDto[] {
  const eps = (re / rt) ** 2;
  const [tnDeg, teDeg] = raoAngles(eps, lf);
  const tn = (tnDeg * Math.PI) / 180, te = (teDeg * Math.PI) / 180;
  const r2 = 0.382 * rt;
  const nArc = Math.max(6, Math.floor(n / 6));
  const pts: ContourPointDto[] = [];
  for (let i = 0; i < nArc; i++) {
    const phi = tn * (i / nArc);
    pts.push({ x: r2 * Math.sin(phi), r: rt + r2 * (1 - Math.cos(phi)) });
  }
  const nx = r2 * Math.sin(tn), ny = rt + r2 * (1 - Math.cos(tn));
  const ex = lf * (re - rt) / Math.tan((15 * Math.PI) / 180), ey = re;
  const m1 = Math.tan(tn), m2 = Math.tan(te);
  const qx = (ey - ny + m1 * nx - m2 * ex) / (m1 - m2), qy = ny + m1 * (qx - nx);
  const nPar = n - nArc;
  for (let i = 0; i < nPar; i++) {
    const t = i / Math.max(1, nPar - 1), mt = 1 - t;
    pts.push({ x: mt * mt * nx + 2 * mt * t * qx + t * t * ex, r: mt * mt * ny + 2 * mt * t * qy + t * t * ey });
  }
  return pts;
}

function mockBlade(speedRpm: number): BladeStudyDto {
  const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
  const pc = liveDesign.operating_point.chamber_pressure;
  const density = 1000;
  const g0 = 9.80665;
  const omega = (2 * Math.PI * speedRpm) / 60;
  const total = l0?.total_flow ?? 2.0;
  const tankPa = pval("blade.suction_pressure_bar", 3.0) * 1e5;
  const head = Math.max(0, pc * 1.25 - tankPa) / (density * g0);

  // Pump impeller (user params: Z, β2, inlet axial velocity, efficiency).
  const q = total / density;
  const cm = pval("blade.pump_inlet_axial_vel", 10);
  const beta2deg = pval("blade.pump_outlet_angle_deg", 22.5);
  const Z = Math.round(pval("blade.pump_blade_count", 6));
  const pumpEff = pval("blade.pump_efficiency", 0.7);
  const r1 = Math.sqrt(q / (Math.PI * cm)) * 1.1;
  const u1 = omega * r1;
  const psi = 0.2;
  const u2 = Math.sqrt((2 * g0 * head + u1 * u1) / (1 + psi));
  const r2 = Math.max(u2 / omega, r1 * 1.3);
  const beta1 = Math.atan2(cm, u1);
  const beta2 = (beta2deg * Math.PI) / 180;
  const slip = 1 - Math.sqrt(Math.sin(beta2)) / Z ** 0.7;
  const pumpCamber: Pt2[] = [];
  let theta = 0, rPrev = r1;
  for (let i = 0; i < 60; i++) {
    const s = i / 59;
    const r = r1 + (r2 - r1) * s;
    const b = beta1 + (beta2 - beta1) * s;
    if (i > 0) theta += (r - rPrev) / (r * Math.max(Math.tan(b), 0.05));
    pumpCamber.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
    rPrev = r;
  }
  const pump_blade: BladeProfileDto = {
    kind: "pump-impeller", blade_count: Z, inlet_angle_deg: (beta1 * 180) / Math.PI, outlet_angle_deg: beta2deg,
    inlet_radius_m: r1, outlet_radius_m: r2, span_m: Math.max(r2 * 0.08, 0.004), slip_factor: slip,
    camber: pumpCamber, surface: thickenJs(pumpCamber, r2 * 0.05, r2 * 0.03),
    summary: `impeller: Z=${Z} | β1=${((beta1 * 180) / Math.PI).toFixed(1)}° β2=${beta2deg.toFixed(1)}° | D2=${(2000 * r2).toFixed(0)} mm | σ=${slip.toFixed(3)}`,
  };

  // Impeller tip-speed structural check vs material limit (Cannon/Humble).
  const tipSpeed = omega * r2;
  const impMat = pchoice("blade.impeller_material", "Inconel 718").toLowerCase();
  const tipLimit = impMat.includes("titan") ? 610 : impMat.includes("inconel") || impMat.includes("718") ? 274 : impMat.includes("alumin") ? 350 : 400;

  // Turbine rotor (user params: Z, nozzle α, drive-gas cp/Tin/γ/PR).
  const turbZ = Math.round(pval("blade.turbine_blade_count", 40));
  const gamma = pval("blade.turbine_gamma", 1.3), cp = pval("blade.turbine_cp", 2000), tin = pval("blade.turbine_inlet_temp_k", 950);
  const prUser = pval("blade.turbine_pressure_ratio", 0);
  const PR = prUser > 1 ? prUser : Math.max(1.5, (pc * 0.9) / 3e5);
  const alphaDeg = pval("blade.nozzle_angle_deg", 20);
  const dh = cp * tin * (1 - Math.pow(PR, -(gamma - 1) / gamma));
  const c0 = Math.sqrt(2 * dh);
  const alpha = (alphaDeg * Math.PI) / 180;
  const u = 0.5 * c0 * Math.cos(alpha);
  const rMean = Math.max(u / omega, 0.01);
  const cu1 = c0 * Math.cos(alpha), cm1 = c0 * Math.sin(alpha);
  const tbeta1 = Math.atan2(cm1, cu1 - u);
  const chord = 0.9 * ((2 * Math.PI * rMean) / turbZ);
  const tspan = Math.max(rMean * 0.12, chord);
  const b1 = Math.PI / 2 - tbeta1, b2 = -(Math.PI / 2 - tbeta1);
  const turbCamber: Pt2[] = [];
  let y = 0, xPrev = 0;
  for (let i = 0; i < 50; i++) {
    const s = i / 49;
    const x = s * chord;
    const b = b1 + (b2 - b1) * s;
    if (i > 0) y += (x - xPrev) * Math.tan(b);
    turbCamber.push({ x, y });
    xPrev = x;
  }
  const turbine_blade: BladeProfileDto = {
    kind: "turbine-rotor", blade_count: turbZ, inlet_angle_deg: (tbeta1 * 180) / Math.PI, outlet_angle_deg: (tbeta1 * 180) / Math.PI,
    inlet_radius_m: rMean - tspan / 2, outlet_radius_m: rMean + tspan / 2, span_m: tspan, slip_factor: 0,
    camber: turbCamber, surface: thickenJs(turbCamber, chord * 0.12, chord * 0.05),
    summary: `rotor: Z=${turbZ} | β1=${((tbeta1 * 180) / Math.PI).toFixed(1)}° | R_mean=${(1000 * rMean).toFixed(0)} mm | U/C0=${(u / c0).toFixed(2)}`,
  };

  // Supersonic turbine rotor: relative inlet Mach from the drive-gas triangle,
  // circular-arc / fixed-edge / MoC-transition profile (mirrors the Rust model).
  const cm1s = c0 * Math.sin(alpha), wu1s = c0 * Math.cos(alpha) - u;
  const w1 = Math.hypot(cm1s, wu1s);
  const t1s = Math.max(tin - dh / cp, 50);
  const rGas = (cp * (gamma - 1)) / gamma;
  const a1s = Math.sqrt(gamma * rGas * t1s);
  const m1s = Math.max(w1 / a1s, 1.05);
  const betaAx = ((90 - (Math.atan2(cm1s, wu1s) * 180) / Math.PI) * Math.PI) / 180; // from axial (rad)
  const Zs = Math.round(pval("blade.supersonic_blade_count", 50));
  const pitchS = (2 * Math.PI * rMean) / Zs;
  const chordS = 1.6 * pitchS;
  const nS = 70, fIn = 0.18, fOut = 0.18;
  const ssCamber: Pt2[] = [];
  let sx = 0, sy = 0;
  const dsS = chordS / (nS - 1);
  for (let i = 0; i < nS; i++) {
    const s = i / (nS - 1);
    const th = s <= fIn ? betaAx : s >= 1 - fOut ? -betaAx : betaAx + (-betaAx - betaAx) * ((s - fIn) / (1 - fIn - fOut));
    if (i > 0) { sx += dsS * Math.cos(th); sy += dsS * Math.sin(th); }
    ssCamber.push({ x: sx, y: sy });
  }
  const pmTurn = 0; // pure impulse: constant Mach ⇒ ν(M2)−ν(M1)=0
  const machAngle = (Math.asin(1 / m1s) * 180) / Math.PI;
  const oOverS = Math.min(0.99, Math.max(0.05, Math.cos(betaAx)));
  const sSpan = rMean * 0.12;
  const supersonic_blade: BladeProfileDto = {
    kind: "turbine-supersonic", blade_count: Zs,
    inlet_angle_deg: (betaAx * 180) / Math.PI, outlet_angle_deg: (betaAx * 180) / Math.PI,
    inlet_radius_m: rMean - sSpan / 2, outlet_radius_m: rMean + sSpan / 2, span_m: sSpan, slip_factor: 0,
    camber: ssCamber, surface: thickenJs(ssCamber, chordS * 0.045, chordS * 0.02),
    summary: `supersonic rotor: Z=${Zs} | M₁=${m1s.toFixed(2)} M₂=${m1s.toFixed(2)} | turn Δ=${((2 * betaAx * 180) / Math.PI).toFixed(0)}° | μ=${machAngle.toFixed(1)}° | PM Δν=${pmTurn.toFixed(1)}° | o/s=${oOverS.toFixed(2)}`,
    inlet_mach: m1s, exit_mach: m1s, mach_angle_deg: machAngle, prandtl_meyer_turn_deg: pmTurn, throat_pitch_ratio: oOverS,
  };

  // Loss fractions respond to the design: leakage/tip-clearance scale with the
  // running clearance, pump diffusion with blade count, secondary with aspect.
  const clearance = pval("blade.clearance_ratio", 0.02);
  const aspect = pval("blade.aspect_ratio", 2.0);
  const pumpLossItems = [
    { name: "Incidence", fraction: 0.03 }, { name: "Skin friction", fraction: 0.03 },
    { name: "Diffusion", fraction: 0.045 * (6 / Math.max(Z, 2)) }, { name: "Disk friction", fraction: 0.03 },
    { name: "Leakage", fraction: 0.04 * (clearance / 0.02) },
  ];
  const pTot = pumpLossItems.reduce((a, b) => a + b.fraction, 0);
  const turbLossItems = [
    { name: "Profile", fraction: 0.055 }, { name: "Secondary", fraction: 0.05 * (2 / Math.max(aspect, 0.5)) },
    { name: "Tip clearance", fraction: 0.03 * (clearance / 0.02) }, { name: "Exit kinetic", fraction: 0.08 },
  ];
  const tTot = turbLossItems.reduce((a, b) => a + b.fraction, 0);

  const h0 = 1.25 * head, k = (h0 - head) / (q * q || 1e-9);
  const speed_curves = [0.6, 0.8, 1.0, 1.2].map((sp) => ({
    speed_fraction: sp,
    points: Array.from({ length: 25 }, (_, i) => {
      const flow = 1.4 * q * (i / 24);
      const qeq = flow / sp;
      return { flow_m3_s: flow, head_m: Math.max(0, h0 - k * qeq * qeq) * sp * sp };
    }),
  }));
  const efficiency_curve = Array.from({ length: 29 }, (_, i) => {
    const f = 1.4 * (i / 28);
    return { flow_fraction: f, efficiency: Math.max(0, pumpEff * (1 - 1.1 * (f - 1) ** 2)) };
  });
  const bvc = pval("blade.turbine_blade_velocity_coeff", 0.9);
  const nuOpt = Math.cos(alpha) / 2;
  const tpoints = Array.from({ length: 41 }, (_, i) => {
    const nu = 0.7 * (i / 40);
    return { velocity_ratio: nu, efficiency: Math.max(0, 2 * nu * (Math.cos(alpha) - nu) * (1 + bvc)) };
  });

  const velRatio = pval("blade.velocity_ratio", 0.47);
  const recTurbine = velRatio < 0.2 ? "2-row velocity-compounded impulse" : velRatio <= 0.34 ? "two-stage pressure-compounded impulse" : "reaction (or single-stage impulse)";
  const warnings: string[] = [];
  if (tipSpeed > tipLimit) warnings.push(`Impeller tip speed ${tipSpeed.toFixed(0)} m/s exceeds the ${tipLimit.toFixed(0)} m/s limit for ${pchoice("blade.impeller_material", "Inconel 718")} — lower shaft speed or use multiple stages`);
  if (prUser > 1 && (prUser < 8 || prUser > 20)) warnings.push(`Turbine pressure ratio ${prUser.toFixed(1)} is outside the typical single-stage impulse range 8–20`);

  return {
    speed_rpm: speedRpm, pump_blade, turbine_blade, supersonic_blade,
    pump_losses: { items: pumpLossItems, total_loss_fraction: pTot, efficiency: 1 - pTot },
    turbine_losses: { items: turbLossItems, total_loss_fraction: tTot, efficiency: 1 - tTot },
    pump_map: { design_flow_m3_s: q, design_head_m: head, speed_curves, efficiency_curve },
    turbine_map: { nozzle_angle_deg: alphaDeg, optimum_velocity_ratio: nuOpt, peak_efficiency: Math.max(...tpoints.map((p) => p.efficiency)), points: tpoints },
    pump_tip_speed_m_s: tipSpeed, pump_tip_speed_limit_m_s: tipLimit, turbine_inlet_mach: m1s, recommended_turbine_type: recTurbine, warnings,
  };
}

function mockControl(feedType: string): ControlStudyDto {
  const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
  const pc = liveDesign.operating_point.chamber_pressure;
  const mr = liveDesign.operating_point.mixture_ratio;
  const pair = liveDesign.propellant.pair;
  const vapor = VAPOR_PRESSURE[pair];
  const recommended = vapor && vapor >= 1.25 * pc ? "self-pressurizing" : pc <= 3.5e6 ? "pressure-fed" : "pump-fed";
  const feed = feedType || recommended;
  const pumpFed = feed === "pump-fed";
  const architecture = feed === "self-pressurizing" ? "Self-pressurizing (blowdown / regulated)" : pumpFed ? "Gas-generator pump-fed" : "Pressure-fed";

  const cstar = l0?.c_star_m_s ?? 1712;
  const vc = l0?.chamber_volume ?? 2e-3;
  const at = l0?.throat_area ?? 1.7e-3;
  const tauFill = vc / (Math.max(cstar, 1) * Math.max(at, 1e-9));

  const pcBw = pval("control.pc_bandwidth_hz", 5);
  const mrBw = pval("control.mr_bandwidth_hz", 20);
  const sample = pval("control.sample_rate_hz", 50);
  const sigmaMs = pval("control.combustion_delay_ms", 1.5);
  const target = pval("control.throttle_target", 0.8);
  const turbInletK = pval("turbo.turbine_inlet_temp_k", 950);
  const redlineK = pval("control.turbine_redline_k", turbInletK + 200);

  const pcAct = pumpFed ? "Gas-generator throttle valve" : "Main oxidizer valve";
  const mrAct = pumpFed ? "Oxidizer valve" : "Main fuel valve";
  const loops: ControlLoopDto[] = [
    { name: "Chamber pressure (thrust)", variable: "Pc", speed: "slow", bandwidth_hz: pcBw, setpoint: pc / 1e5, unit: "bar", actuator: pcAct },
    { name: "Mixture ratio", variable: "MR", speed: "fast", bandwidth_hz: mrBw, setpoint: mr, unit: "O/F", actuator: mrAct },
  ];
  const sensors = ["Chamber pressure (Pc)", "Oxidizer mass flow", "Fuel mass flow"];
  const actuators: ControlActuatorDto[] = [];
  if (pumpFed) {
    actuators.push({ name: "Gas-generator throttle valve", function: "Pc loop", closed_loop: true, note: "sets turbopump speed → Pc (slow loop)" });
    actuators.push({ name: "Oxidizer valve", function: "MR loop", closed_loop: true, note: "trims oxidizer flow → MR (fast loop)" });
    actuators.push({ name: "Main fuel valve", function: "on/off", closed_loop: false, note: "full-open at mainstage" });
    actuators.push({ name: "GG oxidizer valve", function: "scheduled", closed_loop: false, note: "holds GG mixture ratio (turbine temperature)" });
    sensors.push("Turbine discharge temperature", "Gas-generator temperature", "Pump discharge pressures");
  } else {
    actuators.push({ name: "Main oxidizer valve (MOV)", function: "Pc loop", closed_loop: true, note: "throttles total flow → Pc (slow loop)" });
    actuators.push({ name: "Main fuel valve (MFV)", function: "MR loop", closed_loop: true, note: "trims fuel flow → MR (fast loop)" });
  }
  actuators.push({ name: "Igniter", function: "on/off", closed_loop: false, note: "start-sequence spark/torch" });
  const redlines: ControlRedlineDto[] = [{ name: "Chamber overpressure", limit: (pc / 1e5) * 1.2, unit: "bar" }];
  if (pumpFed) redlines.push({ name: "Turbine inlet temperature", limit: redlineK, unit: "K" });

  // Closed-loop Pc step: PI (IMC) on first-order + dead-time, plant on a fine step.
  const tau = Math.max(tauFill, 1e-4);
  const sigma = Math.max(sigmaMs * 1e-3, 0);
  const tauCl = Math.max(1 / (2 * Math.PI * Math.max(pcBw, 0.05)), sigma + 1e-3);
  const kp = tau / (tauCl + sigma);
  const ki = 1 / (tauCl + sigma);
  const dt = Math.min(Math.max(tau / 20, 1e-5), 5e-4);
  const ts = Math.max(1 / Math.max(sample, 1), dt);
  const tEnd = Math.min(Math.max(10 * tauCl + sigma, 0.4), 30);
  const n = Math.floor(tEnd / dt);
  const delaySteps = Math.round(sigma / dt);
  const hist: number[] = [];
  const step: ControlStepDto[] = [];
  let pcv = 1, integ = 0, u = 1, settling = tEnd, peakBeyond = 0;
  const span = Math.max(Math.abs(1 - target), 1e-6);
  const dir = Math.sign(target - 1) || -1;
  const rec = Math.max(Math.floor(n / 240), 1);
  let nextCtrl = 0.05;
  for (let i = 0; i <= n; i++) {
    const t = i * dt;
    const sp = t < 0.05 ? 1 : target;
    const measured = i >= delaySteps ? hist[i - delaySteps] : 1;
    if (t >= nextCtrl) {
      const err = sp - measured;
      integ += err * ts;
      u = Math.min(1.5, Math.max(0, 1 + kp * err + ki * integ));
      nextCtrl += ts;
    }
    pcv += ((u - pcv) / tau) * dt;
    hist.push(pcv);
    const beyond = (measured - target) * dir;
    if (beyond > peakBeyond) peakBeyond = beyond;
    if (t > 0.05 && Math.abs(measured - target) > 0.02 * span) settling = t - 0.05;
    if (i % rec === 0) step.push({ t_s: t, setpoint: sp, response: measured });
  }
  const overshoot = (peakBeyond / span) * 100;
  const warnings: string[] = [];
  const nyq = sample / 10;
  if (pcBw > nyq) warnings.push(`Pc-loop bandwidth ${pcBw.toFixed(1)} Hz exceeds ~1/10 of the ${sample.toFixed(0)} Hz sample rate (${nyq.toFixed(1)} Hz) — expect overshoot; raise the sample rate or lower the bandwidth`);
  if (mrBw > nyq) warnings.push(`MR-loop bandwidth ${mrBw.toFixed(1)} Hz exceeds ~1/10 of the ${sample.toFixed(0)} Hz sample rate (${nyq.toFixed(1)} Hz)`);
  if (sigma > 0) { const dbw = 1 / (2 * Math.PI * 5 * sigma); if (pcBw > dbw) warnings.push(`Pc-loop bandwidth ${pcBw.toFixed(1)} Hz is above the combustion-dead-time limit ~${dbw.toFixed(1)} Hz (σ=${sigmaMs.toFixed(1)} ms)`); }
  if (pumpFed && redlineK <= turbInletK) warnings.push(`Turbine redline ${redlineK.toFixed(0)} K is at/below the nominal turbine-inlet temperature ${turbInletK.toFixed(0)} K — it can never trip; set it above the operating inlet temperature with margin`);
  return {
    architecture, control_law: "PI (proportional-integral)", sample_rate_hz: sample, warnings,
    pc_setpoint_bar: pc / 1e5, mr_setpoint: mr, chamber_fill_time_ms: tauFill * 1e3, combustion_delay_ms: sigmaMs,
    loops, sensors, actuators, redlines, pc_step: step, pc_settling_time_s: settling, pc_overshoot_pct: overshoot,
    summary: `${architecture} | PI @ ${sample.toFixed(0)} Hz | Pc setpt ${(pc / 1e5).toFixed(1)} bar, MR ${mr.toFixed(2)} | τ_fill=${(tauFill * 1e3).toFixed(1)} ms, σ=${sigmaMs.toFixed(1)} ms | Pc settle ${settling.toFixed(2)} s, overshoot ${overshoot.toFixed(1)}%`,
  };
}

function mockSweep(args: Record<string, unknown>): SweepResultDto {
  const props = mockProps();
  const lin = (lo: number, hi: number, n: number) => {
    n = Math.max(1, Math.min(9, Math.round(n)));
    if (n === 1) return [lo];
    return Array.from({ length: n }, (_, i) => lo + (hi - lo) * (i / (n - 1)));
  };
  const pcMin = Math.max(0.5, Number(args.pcMinBar ?? 20));
  const pcMax = Math.max(pcMin + 0.5, Number(args.pcMaxBar ?? 100));
  const ofMin = Math.max(0.1, Number(args.ofMin ?? props.ofOpt - 1));
  const ofMax = Math.max(ofMin + 0.1, Number(args.ofMax ?? props.ofOpt + 1));
  const pc_values_bar = lin(pcMin, pcMax, Number(args.pcSteps ?? 5));
  const of_values = lin(ofMin, ofMax, Number(args.ofSteps ?? 5));
  const cstar = cstarOf(props);
  const peak = props.ispSea + 40;
  const points: SweepPointDto[] = [];
  for (const pc of pc_values_bar) {
    for (const of of of_values) {
      const dOf = of - props.ofOpt;
      points.push({
        pc_bar: +pc.toFixed(1),
        of: +of.toFixed(2),
        tc_k: props.tc - 400 * dOf * dOf,
        c_star_m_s: cstar - 80 * dOf * dOf,
        isp_vac_s: peak - 55 * dOf * dOf + 6 * Math.log(pc / 20),
        gamma: props.gamma,
      });
    }
  }
  return { pc_values_bar, of_values, points };
}

function mockIssues(): IssuesReportDto {
  const issues: IssueDto[] = [];
  const add = (severity: "fail" | "warn", area: string, message: string) => issues.push({ severity, area, message });
  const pc = liveDesign.operating_point.chamber_pressure;
  const pair = liveDesign.propellant.pair;
  const vapor = VAPOR_PRESSURE[pair];
  const selfPress = vapor ? vapor >= 1.25 * pc : false;
  const isPump = !selfPress && pc > 3.5e6;

  const material = String(liveDesign.materials?.chamber || "OFHC Copper");
  const method = String(liveDesign.geometry?.cooling_jacket?.cooling_method || "regen");
  const c = mockCooling(material, method);
  if (c.regen.max_wall_temp_k > c.regen.wall_material_limit_k)
    add("fail", "Cooling", `Wall temperature ${c.regen.max_wall_temp_k.toFixed(0)} K exceeds the ${c.selected_material} limit ${c.regen.wall_material_limit_k.toFixed(0)} K (margin ${(c.regen.wall_material_limit_k - c.regen.max_wall_temp_k).toFixed(0)} K)`);
  if (c.regen.min_boiling_margin_k < 0)
    add("fail", "Cooling", `Coolant boils — boiling margin ${c.regen.min_boiling_margin_k.toFixed(0)} K`);
  if (method === "regen") {
    const mat = MOCK_MATERIALS.find((m) => m.name === material);
    if (mat && mat.cooling_class !== "Regenerative") add("warn", "Cooling", `${material} is a ${mat.cooling_class}-class material but regenerative cooling is selected`);
  }
  if (c.nozzle_extension && !c.nozzle_extension.material_ok)
    add("fail", "Cooling", `Radiation skirt wall ${c.nozzle_extension.equilibrium_wall_temp_k.toFixed(0)} K exceeds the ${c.nozzle_extension_material} limit ${c.nozzle_extension.material_limit_k.toFixed(0)} K`);

  const a = mockAnalysis();
  if (a.stress.min_margin < 1) add("fail", "Analysis", `Structural margin ${a.stress.min_margin.toFixed(2)} below 1.0 (peak σ ${(a.stress.max_combined_stress_pa / 1e6).toFixed(0)} MPa)`);
  if (!a.instability.stable) add("warn", "Analysis", `Combustion-instability risk: ${a.instability.dominant_mode} ${a.instability.dominant_frequency_hz.toFixed(0)} Hz, margin ${a.instability.stability_margin.toFixed(2)}`);
  for (const f of a.injector.flags) add("warn", "Injector", f);

  if (isPump) {
    const tp = mockTurbopump(20000);
    if (!tp.bearing.dn_ok) add("warn", "Turbopumps", `Bearing DN ${(tp.bearing.dn_value / 1e6).toFixed(2)}M exceeds its limit`);
    if (tp.pump.cavitation_margin_m < 0) add("warn", "Turbopumps", `Pump cavitates — NPSH margin ${tp.pump.cavitation_margin_m.toFixed(1)} m`);
    if (!tp.shaft.subcritical) add("warn", "Turbopumps", `Shaft runs supercritical (N_cr ${tp.shaft.first_critical_rpm.toFixed(0)} rpm)`);
    if (tp.gg_cycle.margin < 1) add("warn", "Turbopumps", `Gas-generator cycle under-powered — turbine/pump power ${tp.gg_cycle.margin.toFixed(2)}`);
    const boreMm = pval("turbo.bearing_bore_mm", 45);
    const shaftMm = tp.shaft.diameter_m * 1000;
    if (boreMm > 3 * shaftMm) add("warn", "Turbopumps", `Bearing bore ${boreMm.toFixed(0)} mm is far larger than the ${shaftMm.toFixed(1)} mm shaft — incompatible sizing`);
    for (const w of mockBlade(20000).warnings) add("warn", "Blades", w);
    for (const w of mockControl("").warnings) add("warn", "Control", w);
  }

  if (["GoxKerosene", "GoxGasoline", "GoxEthanol", "GoxMethanol"].includes(pair))
    add("warn", "Feed System", "Gaseous oxidizer (GOX): the tank is sized as a compressed gas — expect a large bottle volume or a high storage pressure");

  if (isPump) {
    const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
    const flow = l0?.total_flow ?? 0;
    if (flow > 0 && flow < 0.5)
      add("warn", "Feed System", `Pump-fed selected at ${flow.toFixed(3)} kg/s — turbopumps are very hard to build this small; consider a pressure-fed system`);
  }

  const failed = issues.filter((i) => i.severity === "fail").length;
  return { issues, failed, warnings: issues.length - failed };
}

function mockTrade(): TradeBundleDto {
  const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
  const pc = liveDesign.operating_point.chamber_pressure;
  const props = mockProps();
  const gamma = props.gamma;
  const cstar = cstarOf(props);
  const g0 = 9.80665;
  const ofPeak = props.ofOpt;
  const ispPeak = props.ispSea + 40;
  const ofLo = Math.max(0.5, ofPeak - 2.0);
  const ofHi = ofPeak + 2.0;
  const of_sweep = Array.from({ length: 19 }, (_, k) => {
    const of = ofLo + (ofHi - ofLo) * (k / 18);
    return { of: +of.toFixed(2), isp_vac_s: ispPeak - 60 * (of - ofPeak) ** 2 };
  });
  const cf = (ar: number, pa: number) => {
    const me = Math.sqrt((Math.pow(ar, 0.9) * 3) || 4);
    const pe = pc * Math.pow(1 + ((gamma - 1) / 2) * me * me, -gamma / (gamma - 1));
    const k = Math.sqrt(((2 * gamma * gamma) / (gamma - 1)) * Math.pow(2 / (gamma + 1), (gamma + 1) / (gamma - 1)));
    return k * Math.sqrt(1 - Math.pow(pe / pc, (gamma - 1) / gamma)) + (ar * (pe - pa)) / pc;
  };
  const expansion_sweep = Array.from({ length: 25 }, (_, k) => {
    const ar = 1.5 * Math.pow(200 / 1.5, k / 24);
    return { area_ratio: +ar.toFixed(1), cf_sea_level: cf(ar, 101325), cf_vacuum: cf(ar, 0), isp_vacuum_s: (cstar * cf(ar, 0)) / g0 };
  });
  const throatA = l0?.throat_area ?? 7e-4;
  const chamberA = Math.PI * ((l0?.chamber_diameter ?? 0.14) / 2) ** 2;
  const l_star_sweep = Array.from({ length: 16 }, (_, k) => {
    const ls = 0.5 + (2.0 - 0.5) * (k / 15);
    const vol = throatA * ls;
    return { l_star_m: +ls.toFixed(2), chamber_length_m: vol / chamberA, chamber_volume_l: vol * 1000 };
  });
  const material_trade = MOCK_MATERIALS.map((m) => {
    const wall = (620 + 9000 / m.thermal_conductivity_w_m_k) * Math.pow(pc / 2e6, 0.15);
    return { name: m.name, max_wall_temp_k: wall, limit_k: m.max_service_temp_k, margin_k: m.max_service_temp_k - wall, density_kg_m3: m.density_kg_m3, cooling_class: m.cooling_class, ok: wall <= m.max_service_temp_k };
  });
  const oxRho = (COMPONENT_DENSITY[liveDesign.propellant.pair] ?? [1140, 800])[0];
  const of = liveDesign.operating_point.mixture_ratio || ofPeak;
  const injector_trade = [8, 16, 24, 32, 48, 64].map((n) => {
    const v = 0.7 * Math.sqrt((2 * 0.2 * pc) / oxRho);
    const d = Math.sqrt((4 * ((l0?.oxidizer_flow ?? 1.5) / (oxRho * v))) / (n * Math.PI));
    const we = (2 * v * v * d) / 0.02;
    const mr = of * Math.sqrt(0.72); // ox/fuel momentum ratio (fuel ≈ 0.72·ox density)
    return { element_count: n, injection_velocity_m_s: v, smd_um: d * 3 * Math.pow(Math.max(we, 1), -0.4) * 1e6, momentum_ratio: mr, stable: v >= 15 && v <= 60 };
  });
  return { of_sweep, optimal_of: ofPeak, expansion_sweep, optimal_area_ratio: 29, l_star_sweep, recommended_l_star_m: props.lStar, material_trade, injector_trade };
}

const COMPONENT_DENSITY: Record<string, [number, number]> = {
  GoxKerosene: [1140, 810], LoxRp1: [1140, 810], GoxGasoline: [1140, 740],
  GoxEthanol: [1140, 789], LoxEthanol: [1140, 789], GoxMethanol: [1140, 792],
  LoxMethane: [1140, 423], NitrousPropane: [745, 493], NtoMmh: [1443, 874], NtoUdmh: [1443, 793],
  LoxHydrogen: [1140, 71], H2o2Kerosene: [1390, 810],
};
const VAPOR_PRESSURE: Record<string, number> = { NitrousPropane: 5.1e6 };

function sizeTank(name: string, mass: number, density: number, tankP: number): TankSpecDto {
  const ullage = pval("feed.ullage_factor", 1.06);
  const ld = pval("feed.tank_ld_ratio", 2.6);
  const allowable = pval("feed.tank_allowable_mpa", 250) * 1e6;
  const testF = pval("feed.tank_test_factor", 1.5);
  const wallDensity = pval("feed.tank_wall_density", 2700);
  const volume = (mass / Math.max(density, 1)) * ullage;
  const d = Math.cbrt((4 * volume) / (ld * Math.PI));
  const l = ld * d;
  const wall = Math.max((testF * tankP * (d / 2)) / allowable, 0.0006);
  const surface = Math.PI * d * l + 2 * Math.PI * (d / 2) ** 2;
  return { propellant: name, propellant_mass_kg: mass, volume_l: volume * 1000, diameter_m: d, length_m: l, wall_thickness_m: wall, tank_mass_kg: surface * wall * wallDensity };
}

function mockFeed(burn: number, feedType: string): FeedStudyDto {
  const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
  const pc = liveDesign.operating_point.chamber_pressure;
  const pair = liveDesign.propellant.pair;
  const [oxRho, fuRho] = COMPONENT_DENSITY[pair] ?? [1140, 800];
  const vapor = VAPOR_PRESSURE[pair];
  const oxMass = (l0?.oxidizer_flow ?? 1.5) * burn;
  const fuMass = (l0?.fuel_flow ?? 0.6) * burn;
  const recommended = vapor && vapor >= 1.25 * pc ? "self-pressurizing" : pc <= 3.5e6 ? "pressure-fed" : "pump-fed";
  const feed = feedType || recommended;
  const injDp = pval("feed.injector_dp_fraction", 0.2) * pc;
  const lineDp = pval("feed.line_dp_bar", 1.0) * 1e5;
  const reqTank = pc + injDp + lineDp;
  const pumpfedTank = pval("feed.pumpfed_tank_bar", 3.0) * 1e5;
  const tankP = feed === "self-pressurizing" ? vapor ?? reqTank : feed === "pump-fed" ? pumpfedTank : reqTank;
  // Gaseous oxidizer (GOX): tank density from the ideal-gas law at tank pressure.
  const isGox = ["GoxKerosene", "GoxGasoline", "GoxEthanol", "GoxMethanol"].includes(pair);
  const oxRhoEff = isGox ? Math.max((tankP * 0.032) / (8.314462 * 293), 0.1) : oxRho;
  const ox = sizeTank("oxidizer", oxMass, oxRhoEff, tankP);
  const fu = sizeTank("fuel", fuMass, fuRho, tankP);
  let pressurant = null;
  if (feed === "pressure-fed") {
    const gas = pchoice("feed.pressurant_gas", "Helium");
    const gl = gas.toLowerCase();
    const rGas = gl.includes("nitro") || gl.includes("n2") ? 296.8 : gl.includes("argon") || gl.includes("ar") ? 208.1 : 2077;
    const factor = pval("feed.pressurant_factor", 1.6);
    const bottleBar = pval("feed.pressurant_bottle_bar", 274);
    const vProp = (ox.volume_l + fu.volume_l) / 1000;
    const mass = (factor * tankP * vProp) / (rGas * 293);
    pressurant = { gas, mass_kg: mass, bottle_volume_l: ((mass * rGas * 293) / (bottleBar * 1e5)) * 1000, bottle_pressure_bar: bottleBar };
  }
  const runLen = Math.max(0.4, ox.length_m + fu.length_m + (l0?.chamber_length ?? 0.25));
  const harness = mockHarness(feed, burn, pressurant !== null, runLen);
  return {
    feed_type: feed, burn_time_s: burn, ox_tank: ox, fuel_tank: fu, tank_pressure_pa: tankP,
    total_propellant_mass_kg: oxMass + fuMass, dry_tank_mass_kg: ox.tank_mass_kg + fu.tank_mass_kg,
    pressurant, feed_budget: { chamber_pressure_pa: pc, injector_dp_pa: injDp, line_dp_pa: lineDp, required_tank_pressure_pa: reqTank }, recommended_feed: recommended,
    harness,
  };
}

function mockHarness(feed: string, burn: number, hasPressurant: boolean, runLen: number): AvionicsHarnessDto {
  const bus = pval("avionics.bus_voltage_v", 28);
  const mv = pval("avionics.main_valve_current_a", 3.0);
  const ig = pval("avionics.igniter_current_a", 5.0);
  const reserve = Math.min(5, Math.max(1, pval("avionics.battery_reserve_factor", 2.0)));
  const eDens = Math.max(20, pval("avionics.battery_energy_density_wh_kg", 150));
  const house = Math.max(0, pval("avionics.housekeeping_current_a", 0.5));
  const dual = pchoice("avionics.redundancy", "single").toLowerCase().includes("dual");
  const runOverride = pval("avionics.run_length_m", 0);
  const awgMass = (awg: number) => ({ 16: 12, 18: 8, 20: 5.2, 22: 3.4 }[awg] ?? 2);
  const awgRating = (awg: number) => ({ 16: 13, 18: 10, 20: 7.5, 22: 5 }[awg] ?? 3.5);
  const gaugeFor = (a: number) => [24, 22, 20, 18, 16].find((g) => awgRating(g) >= a * 1.5) ?? 16;
  type Raw = [string, string, string, number, string, boolean, string];
  const raw: Raw[] = [
    ["Ox main valve", "valve", "power", mv, "MS3116-8", true, "held open through the burn"],
    ["Fuel main valve", "valve", "power", mv, "MS3116-8", true, "held open through the burn"],
    ["Ox vent/fill valve", "valve", "power", 2.0, "MS3116-6", false, "pulsed at fill and safing"],
    ["Fuel vent/fill valve", "valve", "power", 2.0, "MS3116-6", false, "pulsed at fill and safing"],
  ];
  if (hasPressurant) raw.push(["Pressurant regulator solenoid", "pressurant", "pwm", 2.0, "MS3116-6", true, "regulated He, PWM duty for tank pressure"]);
  raw.push(["Igniter exciter", "igniter", "highvoltage", ig, "HV-BNC", false, "capacitive-discharge exciter, pulsed at start"]);
  raw.push(["Chamber pressure (Pc)", "sensor", "analog", 0.03, "M8-4pin", true, "0–5 V / 4–20 mA, shielded"]);
  raw.push(["Ox tank pressure", "sensor", "analog", 0.03, "M8-4pin", true, "shielded"]);
  raw.push(["Fuel tank pressure", "sensor", "analog", 0.03, "M8-4pin", true, "shielded"]);
  raw.push(["Chamber wall TC", "sensor", "analog", 0.01, "TC-mini", true, "K-type, TC-grade extension wire"]);
  raw.push(["Nozzle TC", "sensor", "analog", 0.01, "TC-mini", true, "K-type"]);
  if (feed === "pump-fed") {
    raw.push(["Ox pump controller", "pump", "digital", 8.0, "MS3116-10", true, "ESC / speed command + telemetry"]);
    raw.push(["Fuel pump controller", "pump", "digital", 8.0, "MS3116-10", true, "ESC / speed command + telemetry"]);
    raw.push(["Turbine/GG spin-start valve", "valve", "power", 2.5, "MS3116-6", false, "start sequence"]);
  }
  if (dual) {
    raw.push(["Ox main valve (redundant)", "valve", "power", mv, "MS3116-8", true, "redundant series/parallel actuator"]);
    raw.push(["Fuel main valve (redundant)", "valve", "power", mv, "MS3116-8", true, "redundant series/parallel actuator"]);
    raw.push(["Chamber pressure (redundant)", "sensor", "analog", 0.03, "M8-4pin", true, "redundant Pc transducer (voting)"]);
  }
  const channels: HarnessChannelDto[] = raw.map(([name, kind, signal, current, connector, continuous, note]) => ({
    name, kind, signal, voltage_v: bus, current_a: current, wire_awg: gaugeFor(current), connector, continuous, note,
  }));
  const peak = channels.reduce((a, c) => a + c.current_a, 0);
  const cont = channels.filter((c) => c.continuous).reduce((a, c) => a + c.current_a, 0);
  const run = Math.max(runOverride > 0 ? runOverride : runLen, 0.3);
  const totalWire = channels.length * 2 * run;
  const harnessMass = channels.reduce((a, c) => a + (2 * run * awgMass(c.wire_awg)) / 1000, 0) + 0.15;
  const contW = bus * cont + bus * house * (dual ? 2 : 1);
  const wh = contW * (Math.max(burn, 1) / 3600) * reserve + 5;
  const mass = wh / eDens + 0.1;
  return {
    channels, bus_voltage_v: bus, peak_current_a: peak, continuous_current_a: cont,
    battery_capacity_wh: wh, battery_mass_kg: mass, harness_mass_kg: harnessMass,
    total_wire_length_m: totalWire, channel_count: channels.length,
    summary: `${channels.length} channels on a ${bus.toFixed(0)} V bus | peak ${peak.toFixed(1)} A, continuous ${cont.toFixed(1)} A | battery ${wh.toFixed(0)} Wh (${mass.toFixed(2)} kg), harness ${harnessMass.toFixed(2)} kg`,
  };
}

function mockAnalysis(): AnalysisStudyDto {
  const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
  const l2 = liveDesign.caches.find((c) => c.tier === "L2")?.payload as L2ResultDto | undefined;
  const pc = liveDesign.operating_point.chamber_pressure;
  const mat = mockMaterial(String(liveDesign.materials?.chamber || "OFHC Copper"));
  const dpFrac = pval("injector.dp_fraction", 0.2);
  const nElem = Math.round(pval("injector.element_count", 24));
  const cd = pval("injector.discharge_coefficient", 0.7);
  const sigma = pval("injector.surface_tension_n_m", 0.02);
  const fuelDensFactor = pval("injector.fuel_density_factor", 0.72);
  const elementType = pchoice("injector.element_type", "UnlikeDoublet");
  const dp = dpFrac * pc;
  // Real propellant densities + chamber gas density (from Pc / R·Tc).
  const oxRho = (COMPONENT_DENSITY[liveDesign.propellant.pair] ?? [1140, 800])[0];
  const gasRho = pc / ((8314.462 / 24) * (l0?.tc_k ?? 3400));
  const side = (mdot: number, density: number) => {
    const v = cd * Math.sqrt((2 * dp) / density);
    const d = Math.sqrt((4 * (mdot / (density * v))) / (nElem * Math.PI));
    const we = (gasRho * v * v * d) / sigma;
    return { injection_velocity_m_s: v, orifice_diameter_m: d, weber_number: we, sauter_mean_diameter_m: d * 3 * Math.pow(Math.max(we, 1), -0.4) };
  };
  const ox = side(l0?.oxidizer_flow ?? 1.5, oxRho);
  // Fuel density mirrors Rust: ox density × injector.fuel_density_factor.
  const fuel = side(l0?.fuel_flow ?? 0.6, oxRho * fuelDensFactor);

  const chamberD = l0?.chamber_diameter ?? 0.14;
  const chamberL = l0?.chamber_length ?? 0.25;
  // Chamber sound speed a = √(γ·R·Tc) from the resolved L0 (varies with propellant).
  const a = Math.sqrt((l0?.gamma ?? 1.2) * (8314.462 / 24) * (l0?.tc_k ?? 3400));
  const modes = [
    { name: "1L (longitudinal)", frequency_hz: a / (2 * chamberL) },
    { name: "1T (tangential)", frequency_hz: (1.8412 * a) / (Math.PI * chamberD) },
    { name: "1R (radial)", frequency_hz: (3.8317 * a) / (Math.PI * chamberD) },
  ];
  const dom = modes[1];
  const regime = dom.frequency_hz < 400 ? "chug" : dom.frequency_hz < 1000 ? "buzz" : "acoustic";
  // Higher ΔP and lower interaction index widen the stability margin (n–τ).
  const nIdx = pval("injector.interaction_index", 0.5);
  const margin = Math.max(0, dpFrac / 0.05 - 2 * nIdx);

  // Distributed stress: chamber (Pc) + nozzle stations.
  const rt = (l0?.throat_diameter ?? 0.03) / 2;
  const t = l0?.wall_thickness ?? 0.0016;
  const stress = (ri: number, p: number, dT: number) => {
    const ro = ri + t;
    const hoop = (p * (ro * ro + ri * ri)) / (ro * ro - ri * ri);
    const thermal = (mat.youngs_modulus_pa * mat.cte_per_k * dT) / (2 * (1 - 0.33));
    return { hoop, thermal, combined: hoop + thermal };
  };
  const stations: AnalysisStudyDto["stress"]["stations"] = [];
  for (let i = 0; i < 4; i++) {
    const s = stress(chamberD / 2, pc, 220);
    stations.push({ x: -chamberL * (1 - i / 3), r: chamberD / 2, hoop_stress_pa: s.hoop, thermal_stress_pa: s.thermal, combined_stress_pa: s.combined, margin: mat.allowable_stress_pa / s.combined });
  }
  for (const st of l2?.stations ?? []) {
    const ar = Math.max(1, (st.r / rt) ** 2);
    const p = pc / (1 + 0.1 * (ar - 1)) / ar ** 0.6; // rough falling pressure
    const dT = 130 + 150 * (rt / Math.max(st.r, rt)); // hotter near the throat
    const s = stress(st.r, p, dT);
    stations.push({ x: st.x, r: st.r, hoop_stress_pa: s.hoop, thermal_stress_pa: s.thermal, combined_stress_pa: s.combined, margin: mat.allowable_stress_pa / s.combined });
  }
  const maxC = Math.max(...stations.map((s) => s.combined_stress_pa));
  const minM = Math.min(...stations.map((s) => s.margin));

  // Computed combustion (c*) efficiency — ERE (mirrors the Rust model).
  const smd = 0.5 * (ox.sauter_mean_diameter_m + fuel.sauter_mean_diameter_m);
  const throatA = l0?.throat_area ?? Math.PI * rt * rt;
  const lStar = (l0?.chamber_volume ?? throatA * 1.0) / Math.max(throatA, 1e-9);
  const rSpec = 8314.462 / 22; // R_specific with a representative MW ≈ 22 g/mol
  const tc = l0?.tc_k ?? 3400;
  const gasDensity = pc / (rSpec * tc);
  const mdotTot = l0?.total_flow ?? 2.0;
  const tauRes = (gasDensity * lStar * throatA) / Math.max(mdotTot, 1e-6);
  const REQ_MS = 0.6, SMD_REF = 250e-6;
  const res = Math.min(0.9995, Math.max(0.3, 1 - Math.exp(-tauRes / (REQ_MS * 1e-3))));
  const atom = Math.min(0.999, Math.max(0.7, 1 - 0.28 * Math.max(0, smd / SMD_REF - 1)));
  const mix = Math.min(0.999, Math.max(0.7, 1 - 0.04 / (Math.pow(nElem / 20, 0.4) * Math.pow(dpFrac / 0.2, 0.3))));
  const ereVal = Math.min(0.9995, Math.max(0.4, res * atom * mix));
  const ere: EreResultDto = {
    residence_time_ms: tauRes * 1000,
    required_time_ms: REQ_MS,
    residence_efficiency: res,
    atomization_efficiency: atom,
    mixing_efficiency: mix,
    energy_release_efficiency: ereVal,
    c_star_efficiency: ereVal,
    summary: `ERE=${(ereVal * 100).toFixed(1)}% (η_res=${(res * 100).toFixed(1)}% η_atom=${(atom * 100).toFixed(1)}% η_mix=${(mix * 100).toFixed(1)}%) | τ_res=${(tauRes * 1000).toFixed(2)} ms vs τ_req=${REQ_MS.toFixed(2)} ms, SMD=${(smd * 1e6).toFixed(0)} µm`,
  };

  return {
    injector: { pressure_drop_pa: dp, ox, fuel, momentum_ratio: ((l0?.oxidizer_flow ?? 1.5) * ox.injection_velocity_m_s) / ((l0?.fuel_flow ?? 0.6) * fuel.injection_velocity_m_s), element_type: elementType, flags: [] },
    instability: { modes, dominant_mode: dom.name, dominant_frequency_hz: dom.frequency_hz, regime, stability_margin: margin, stable: margin > 0, notes: regime === "acoustic" ? ["High-frequency (1T) risk — consider baffles"] : [] },
    stress: { stations, max_combined_stress_pa: maxC, min_margin: minM, yields: minM < 1 },
    stress_csv: "x_m,r_m,combined_pa,margin\n(browser-dev mock)\n",
    ere,
  };
}

// ---- Stateful browser-dev design (mirrors the persistent Tauri app state) ----
let liveEps = 4.0;
let liveCStarEff = 0.95;
let liveExpansionMode: "ratio" | "pressure" = "ratio";
let liveExitPa = 0;

/** Isentropic area ratio A_e/A_t for perfect expansion from Pc to Pe (constant γ). */
function areaRatioFromPressure(pc: number, pe: number, g: number): number {
  const m2 = Math.max(0, (Math.pow(pc / Math.max(pe, 1), (g - 1) / g) - 1) * 2) / (g - 1);
  const me = Math.sqrt(m2);
  if (me <= 0) return 1;
  const k = ((1 + ((g - 1) / 2) * m2) * 2) / (g + 1);
  return (1 / me) * Math.pow(k, (g + 1) / (2 * (g - 1)));
}

/** Supersonic Mach for an area ratio A/A* > 1 (constant γ), by bisection. */
function machFromAreaMock(ar: number, g: number): number {
  if (ar <= 1.0001) return 1;
  const areaOf = (m: number) => (1 / m) * Math.pow(((2 / (g + 1)) * (1 + ((g - 1) / 2) * m * m)), (g + 1) / (2 * (g - 1)));
  let lo = 1, hi = 25;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (areaOf(mid) > ar) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}
const liveDesign: EngineDesignDto = {
  meta: { name: "Untitled design", schema_version: 1, revision: 1, unit_system: "Si" },
  // Blank start: no pre-fed engine. The user enters these in the Design tab.
  propellant: { pair: "", of_ratio: 0 },
  operating_point: { thrust: 0, chamber_pressure: 0, mixture_ratio: 0, c_star_efficiency: 0.95 },
  geometry: { chamber: { l_star_m: 1.0 }, nozzle: { kind: "Bell" }, cooling_jacket: { cooling_method: "regen" } },
  materials: { chamber: "OFHC Copper", nozzle: null, tank: null },
  params: {},
  choices: {},
  caches: [],
};

/** The core requirements are set → the design can resolve. Until then the app
 *  shows nothing pre-computed (no pre-fed design). */
function isConfigured(): boolean {
  const op = liveDesign.operating_point;
  return op.thrust > 0 && op.chamber_pressure > 0 && op.mixture_ratio > 0 && !!liveDesign.propellant.pair;
}

function mockApply(field: string, value: unknown) {
  const num = Number(value);
  const txt = String(value);
  // Dotted keys are per-subsystem study params/choices (mirror the Rust bag).
  if (field.includes(".")) {
    if (txt === "__reset__") {
      delete liveDesign.params?.[field];
      delete liveDesign.choices?.[field];
    } else if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value)))) {
      (liveDesign.params ??= {})[field] = num;
    } else {
      (liveDesign.choices ??= {})[field] = txt;
    }
    liveDesign.meta.revision += 1;
    return;
  }
  switch (field) {
    case "thrust": liveDesign.operating_point.thrust = num; break;
    case "chamber_pressure": liveDesign.operating_point.chamber_pressure = num; break;
    case "of_ratio":
    case "mixture_ratio":
      liveDesign.operating_point.mixture_ratio = num;
      liveDesign.propellant.of_ratio = num;
      break;
    case "expansion_ratio": liveEps = num; liveExpansionMode = "ratio"; break;
    case "exit_pressure_bar": liveExitPa = num * 1e5; liveExpansionMode = "pressure"; break;
    case "c_star_efficiency": liveCStarEff = num; liveDesign.operating_point.c_star_efficiency = num; break;
    case "l_star": liveDesign.geometry!.chamber = { l_star_m: num }; break;
    case "propellant_pair": liveDesign.propellant.pair = txt; break;
    case "nozzle_kind": liveDesign.geometry!.nozzle = { kind: txt as "Bell" | "Conical" }; break;
    case "wall_material":
    case "chamber_material":
      liveDesign.materials!.chamber = txt; break;
    case "nozzle_material": liveDesign.materials!.nozzle = txt; break;
    case "cooling_method": liveDesign.geometry!.cooling_jacket = { cooling_method: txt }; break;
  }
  liveDesign.meta.revision += 1;
}

// Simplified resolve: rebuild L0/L1/L2 caches from the operating point + nozzle.
function mockResolve() {
  const d = liveDesign;
  // No pre-fed design: nothing resolves until the core requirements are set.
  if (!isConfigured()) {
    d.caches = [];
    return;
  }
  const pc = d.operating_point.chamber_pressure;
  const thrust = d.operating_point.thrust;
  const of = d.operating_point.mixture_ratio;
  const g0 = 9.80665;
  const props = mockProps();
  const cstar = cstarOf(props);
  const mdot = thrust / (props.ispSea * g0);
  // O/F split: ox = total·O/F/(1+O/F); NOT a fixed 70/30.
  const oxFlow = of > 0 ? (mdot * of) / (1 + of) : mdot * 0.7;
  const fuelFlow = mdot - oxFlow;
  const throatArea = (mdot * cstar) / pc;
  const throatD = 2 * Math.sqrt(throatArea / Math.PI);
  // Expansion from the area-ratio target, or perfect expansion to a set exit pressure.
  const eps = liveExpansionMode === "pressure" && liveExitPa > 0
    ? Math.max(1.05, areaRatioFromPressure(pc, liveExitPa, props.gamma))
    : liveEps;
  const exitD = throatD * Math.sqrt(eps);
  const kind = d.geometry?.nozzle?.kind ?? "Bell";
  const lStar = d.geometry?.chamber?.l_star_m ?? props.lStar;
  const chamberD = throatD * 2; // contraction ratio 4 (Ø = √4·throat) — matches Rust L0
  const chamberVol = throatArea * lStar;
  const chamberLen = chamberVol / (Math.PI * (chamberD / 2) ** 2);
  const [thetaN, thetaE] = raoAngles(eps, 0.8);
  const stations =
    kind === "Conical"
      ? (() => {
          const len = (exitD / 2 - throatD / 2) / Math.tan((15 * Math.PI) / 180);
          return Array.from({ length: 48 }, (_, i) => {
            const t = i / 47;
            return { x: t * len, r: throatD / 2 + (exitD / 2 - throatD / 2) * t };
          });
        })()
      : raoStations(throatD / 2, exitD / 2, 0.8, 60);
  // Thin-wall hoop stress: t = Pc·r/σ (OFHC copper allowable ≈ 55 MPa).
  const wallThickness = Math.max((pc * (chamberD / 2)) / 55e6, 5e-4);
  const l0: L0ResultDto = {
    total_flow: mdot, oxidizer_flow: oxFlow, fuel_flow: fuelFlow, isp_s: props.ispSea, c_star_m_s: cstar,
    tc_k: props.tc, gamma: props.gamma, throat_area: throatArea, throat_diameter: throatD, exit_area: throatArea * eps,
    exit_diameter: exitD, area_ratio: eps, chamber_volume: chamberVol, chamber_length: chamberLen,
    chamber_diameter: chamberD, wall_thickness: wallThickness, cooling_gap: 0.003,
  };
  // L1 thermochem (mock): γ, Tc, c* from the propellant; MW from R = 8314.462/MW.
  const gam = props.gamma;
  const mw = 8314.462 / props.r;
  const me = machFromAreaMock(eps, gam); // supersonic exit Mach, consistent with ε
  const pe = pc * Math.pow(1 + ((gam - 1) / 2) * me * me, -gam / (gam - 1));
  const cfVac = Math.sqrt(((2 * gam * gam) / (gam - 1)) * Math.pow(2 / (gam + 1), (gam + 1) / (gam - 1)) * (1 - Math.pow(pe / pc, (gam - 1) / gam))) + (eps * pe) / pc;
  const effScale = liveCStarEff / 0.95;
  // Equilibrium (shifting) flow gains a few % Isp over frozen (mirrors the Rust l2_input).
  const flowBonus = pchoice("thermo.flow_model", "equilibrium") === "frozen" ? 1 : 1 + 0.035 * Math.min(1.3, Math.max(0, (props.tc - 2500) / 1200));
  const l1: L1ResultDto = {
    tc_k: props.tc, gamma: gam, mean_molecular_weight: mw, c_star_m_s: cstar, isp_vacuum_s: props.ispSea + 40,
    species_mol: [["CO2", 0.19], ["H2O", 0.31], ["CO", 0.22], ["OH", 0.05], ["H2", 0.09], ["O2", 0.04], ["N2", 0.1]],
  };
  const l2: L2ResultDto = {
    area_ratio: eps, exit_mach: me, exit_pressure_pa: Math.max(1000, pe),
    exit_temperature_k: props.tc / (1 + ((gam - 1) / 2) * me * me), exit_diameter_m: exitD, throat_diameter_m: throatD,
    divergence_correction: kind === "Bell" ? 0.5 * (1 + Math.cos((thetaE * Math.PI) / 180)) : 0.983, boundary_layer_correction: 0.985,
    isp_s: (cstar * cfVac / g0) * effScale * flowBonus, c_star_m_s: cstar * effScale, stations,
    bell_theta_n_deg: kind === "Bell" ? thetaN : 0, bell_theta_e_deg: kind === "Bell" ? thetaE : 0,
  };
  d.caches = [
    { tier: "L0", status: "Solved", inputs_hash: 1, payload: l0 },
    { tier: "L1", status: "Solved", inputs_hash: 2, payload: l1 },
    { tier: "L2", status: "Solved", inputs_hash: 3, payload: l2 },
  ];
}

const MOCK_MATERIALS: MaterialDto[] = [
  { name: "OFHC Copper", thermal_conductivity_w_m_k: 391, max_service_temp_k: 700, density_kg_m3: 8960, allowable_stress_pa: 55e6, youngs_modulus_pa: 117e9, cte_per_k: 17e-6, emissivity: 0.3, cooling_class: "Regenerative" },
  { name: "CuCrZr", thermal_conductivity_w_m_k: 320, max_service_temp_k: 750, density_kg_m3: 8900, allowable_stress_pa: 200e6, youngs_modulus_pa: 127e9, cte_per_k: 17e-6, emissivity: 0.3, cooling_class: "Regenerative" },
  { name: "Inconel 718", thermal_conductivity_w_m_k: 11.4, max_service_temp_k: 980, density_kg_m3: 8190, allowable_stress_pa: 1000e6, youngs_modulus_pa: 200e9, cte_per_k: 13e-6, emissivity: 0.7, cooling_class: "Regenerative" },
  { name: "SS 316L", thermal_conductivity_w_m_k: 16, max_service_temp_k: 870, density_kg_m3: 8000, allowable_stress_pa: 200e6, youngs_modulus_pa: 193e9, cte_per_k: 16e-6, emissivity: 0.6, cooling_class: "Regenerative" },
  { name: "Niobium C-103", thermal_conductivity_w_m_k: 42, max_service_temp_k: 1750, density_kg_m3: 8600, allowable_stress_pa: 120e6, youngs_modulus_pa: 100e9, cte_per_k: 7.5e-6, emissivity: 0.8, cooling_class: "Radiation" },
  { name: "Carbon-Carbon", thermal_conductivity_w_m_k: 40, max_service_temp_k: 2200, density_kg_m3: 1600, allowable_stress_pa: 100e6, youngs_modulus_pa: 70e9, cte_per_k: 2e-6, emissivity: 0.85, cooling_class: "Radiation" },
];

/** Resolve a wall material by name; "Custom" is built from material.custom_* params. */
function mockMaterial(name: string): MaterialDto {
  if (name.toLowerCase() === "custom") {
    return {
      name: "Custom",
      thermal_conductivity_w_m_k: Math.max(0.1, pval("material.custom_k", 350)),
      max_service_temp_k: Math.max(100, pval("material.custom_tmax_k", 800)),
      density_kg_m3: Math.max(100, pval("material.custom_density", 8000)),
      allowable_stress_pa: Math.max(1, pval("material.custom_allowable_mpa", 200)) * 1e6,
      youngs_modulus_pa: Math.max(1, pval("material.custom_youngs_gpa", 120)) * 1e9,
      cte_per_k: Math.max(0.1, pval("material.custom_cte_ppm", 16)) * 1e-6,
      emissivity: Math.min(1, Math.max(0.05, pval("material.custom_emissivity", 0.5))),
      cooling_class: "Regenerative",
    };
  }
  return MOCK_MATERIALS.find((x) => x.name === name) ?? MOCK_MATERIALS[0];
}

function mockAdvice(burnoutM: number): DesignAdviceDto {
  const highAlt = Math.min(300, 4 + burnoutM / 1500);
  const sep = burnoutM > 20000;
  const props = mockProps();
  return {
    current_of: liveDesign.operating_point.mixture_ratio || props.ofOpt,
    optimal_of: props.ofOpt,
    optimal_isp_vac_s: props.ispSea + 40,
    recommended_l_star_m: props.lStar,
    expansion: {
      optimal_area_ratio: highAlt,
      mean_thrust_coefficient: 1.6 + Math.min(0.4, burnoutM / 200000),
      sea_level_optimal_area_ratio: 9.0,
      separation_limited_area_ratio: 18.0,
      exit_pressure_pa: Math.max(800, 90000 - burnoutM),
      sea_level_exit_pressure_ratio: sep ? 0.22 : 0.75,
      separated_at_sea_level: sep,
    },
  };
}

/** Resolved chamber flame temperature (falls back before L0 solves). */
function chamberTc(): number {
  const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
  return l0?.tc_k ?? 3400;
}
function mockFilm() {
  // Effectiveness rises with coolant velocity/slot; wall temp drops accordingly.
  const vel = pval("cooling.film_coolant_velocity", 120);
  const slot = pval("cooling.film_slot_height_mm", 1.5);
  const tCool = pval("cooling.film_coolant_temp_k", 400);
  const tc = chamberTc();
  const blowing = Math.min(0.6, 0.16 * (vel / 120) * (slot / 1.5) * (5 / pval("cooling.film_coolant_density", 5)));
  const eff = Math.min(0.85, 0.29 * (1 + 0.6 * (blowing / 0.16 - 1)));
  return { blowing_ratio: blowing, effectiveness: eff, adiabatic_wall_temp_k: tCool + (tc - tCool) * (1 - eff), effective_length_m: 0.048 * (slot / 1.5) * (vel / 120) };
}
function mockRadiation(limitK: number): { equilibrium_wall_temp_k: number; radiated_flux_w_m2: number; material_limit_k: number; material_ok: boolean; margin_k: number } {
  const amb = pval("cooling.radiation_ambient_k", 250);
  // Equilibrium wall ≈ 0.48·Tc for a radiation-cooled wall (≈1632 K at 3400 K).
  const eq = 0.48 * chamberTc() + (amb - 250) * 0.3;
  const flux = 5.67e-8 * 0.8 * (eq ** 4 - amb ** 4);
  return { equilibrium_wall_temp_k: eq, radiated_flux_w_m2: flux, material_limit_k: limitK, material_ok: limitK > eq, margin_k: limitK - eq };
}
function mockAblative(): { recession_rate_m_s: number; total_recession_m: number; required_thickness_m: number; liner_mass_per_area_kg_m2: number } {
  const burn = pval("cooling.ablative_burn_time_s", 30);
  const sf = pval("cooling.ablative_safety_factor", 1.5);
  const isSilica = pchoice("cooling.ablative_material", "Carbon phenolic").toLowerCase().includes("silica");
  const rate = isSilica ? 2.3e-4 : 1.72e-4; // silica recedes faster than carbon
  const density = isSilica ? 1730 : 1450;
  const total = rate * burn;
  const req = total * sf;
  return { recession_rate_m_s: rate, total_recession_m: total, required_thickness_m: req, liner_mass_per_area_kg_m2: req * density };
}

function mockCooling(material: string, method: string): CoolingStudyDto {
  const m = mockMaterial(material);
  const extMat = MOCK_MATERIALS.find((x) => x.name === liveDesign.materials?.nozzle);
  const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
  const l2 = liveDesign.caches.find((c) => c.tier === "L2")?.payload as L2ResultDto | undefined;
  const pc = liveDesign.operating_point.chamber_pressure || 2e6;
  const throatR = (l0?.throat_diameter ?? 0.03) / 2;
  const chamberR = (l0?.chamber_diameter ?? 0.09) / 2;
  const chamberLen = l0?.chamber_length ?? 0.15;
  // Peak (throat) heat flux scales like Bartz q ∝ Pc^0.8; ~30 MW/m² at 20 bar.
  const qThroat = 272 * Math.pow(pc, 0.8);
  // Coolant conditions (user params, mirror the Rust L3 inputs).
  const coolantVel = pval("cooling.coolant_velocity_m_s", 6);
  const coolantPBar = pval("cooling.coolant_pressure_bar", 3);
  // Peak wall temperature: lower conductivity → hotter, hotter at higher Pc, and
  // cooler as coolant velocity rises (higher coolant-side h).
  const wall = (620 + 9000 / m.thermal_conductivity_w_m_k) * Math.pow(pc / 2e6, 0.15) * Math.pow(6 / Math.max(coolantVel, 0.5), 0.2);
  // Boiling margin grows with coolant pressure (higher saturation temp) and
  // velocity (cooler wall-side coolant).
  const boilMargin = 40 + 28 * (coolantPBar - 3) + 6 * (coolantVel - 6);

  // Build stations from the real geometry: chamber barrel at r=chamberR, then the
  // converging/throat/diverging contour from L2 (fallback: throat→exit taper).
  type St = { x: number; r: number; heat_flux_w_m2: number; wall_temp_k: number };
  const raw: { x: number; r: number }[] = [];
  for (let i = 0; i < 6; i++) raw.push({ x: -chamberLen * (1 - i / 6), r: chamberR });
  const contour = (l2?.stations && l2.stations.length > 2)
    ? l2.stations.map((s) => ({ x: s.x, r: s.r }))
    : Array.from({ length: 34 }, (_, i) => { const t = i / 33; return { x: t * (l0?.exit_diameter ?? 0.09), r: throatR + ((l0?.exit_diameter ?? 0.09) / 2 - throatR) * Math.sqrt(t) }; });
  raw.push(...contour);
  const stations: St[] = raw.map((p) => {
    const rr = Math.max(p.r, throatR);
    // Flux falls off away from the throat as (A_t/A)^0.9 = (r_t/r)^1.8.
    const q = qThroat * Math.pow(throatR / rr, 1.8);
    return { x: p.x, r: p.r, heat_flux_w_m2: q, wall_temp_k: 400 + (wall - 400) * Math.min(1, q / qThroat) };
  });
  const coolantDp = 30000 * (pc / 2e6);
  return {
    materials: [...MOCK_MATERIALS, mockMaterial("Custom")],
    selected_material: m.name,
    method,
    regen: { max_wall_temp_k: wall, wall_material_limit_k: m.max_service_temp_k, min_boiling_margin_k: boilMargin, coolant_dp_pa: coolantDp, stations },
    film: method === "film" ? mockFilm() : null,
    radiation: method === "radiation" ? mockRadiation(m.max_service_temp_k) : null,
    ablative: method === "ablative" ? mockAblative() : null,
    nozzle_extension_material: liveDesign.materials?.nozzle ?? null,
    nozzle_extension: extMat
      ? (() => {
          // Radiation skirt sees the cooler exit gas (~0.42·Tc).
          const eq = 0.42 * chamberTc();
          return { equilibrium_wall_temp_k: eq, radiated_flux_w_m2: 5.67e-8 * extMat.emissivity * (eq ** 4 - 250 ** 4), material_limit_k: extMat.max_service_temp_k, material_ok: extMat.max_service_temp_k > eq, margin_k: extMat.max_service_temp_k - eq };
        })()
      : null,
    heat_flux_csv: "x_m,r_m,heat_flux_w_m2,wall_temp_k\n(browser-dev mock)\n",
    print_plan: mockPrintPlan(m, extMat),
  };
}

function amProcessJs(mat: MaterialDto): { process: string; layer: number; power: number; hatch: number; note: string } {
  const name = mat.name.toLowerCase();
  if (name.includes("carbon") && String(mat.cooling_class).toLowerCase().includes("radiation"))
    return { process: "CVI/CVD layup (not AM)", layer: 0, power: 0, hatch: 0, note: "carbon-carbon is woven and densified, not printed; bonded as an insert" };
  if (mat.thermal_conductivity_w_m_k > 150)
    return { process: "LPBF (green laser)", layer: 30, power: 400, hatch: 100, note: "reflective Cu needs a green/high-power laser and low layer height" };
  if (mat.max_service_temp_k > 1600 || name.includes("niob") || name.includes("c103"))
    return { process: "LPBF (inert, preheat)", layer: 30, power: 300, hatch: 90, note: "refractory alloy: inert chamber and substrate preheat to limit cracking" };
  return { process: "LPBF", layer: 40, power: 285, hatch: 110, note: "standard powder-bed parameters" };
}

function mockPrintPlan(chamberMat: MaterialDto, extMat: MaterialDto | undefined): PrintPlanDto {
  const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
  const chamberL = l0?.chamber_length ?? 0.25;
  const xExit = 0.2;
  const throatBand = Math.min(Math.max(0.05 * xExit, 0.005), 0.02);
  const xExtStart = extMat ? throatBand + 0.6 * (xExit - throatBand) : xExit;
  const specs: { name: string; x0: number; x1: number; mat: MaterialDto; hp: boolean }[] = [
    { name: "Injector face + chamber barrel", x0: -chamberL, x1: 0, mat: chamberMat, hp: false },
    { name: "Throat (precision)", x0: 0, x1: throatBand, mat: chamberMat, hp: true },
    { name: "Diverging nozzle (regen)", x0: throatBand, x1: xExtStart, mat: chamberMat, hp: false },
  ];
  if (extMat) specs.push({ name: "Radiation skirt", x0: xExtStart, x1: xExit, mat: extMat, hp: false });

  const regions: PrintRegionDto[] = [];
  const transitions: GradientTransitionDto[] = [];
  let layersF = 0;
  specs.forEach((s, i) => {
    const p = amProcessJs(s.mat);
    let layer = p.layer, hatch = p.hatch;
    if (s.hp && layer > 0) { layer *= 0.7; hatch *= 0.85; }
    const len = Math.abs(s.x1 - s.x0);
    if (layer > 0) layersF += len / (layer * 1e-6);
    regions.push({ name: s.name, x_start_m: s.x0, x_end_m: s.x1, material: s.mat.name, process: p.process, layer_thickness_um: layer, laser_power_w: p.power, hatch_spacing_um: hatch, high_precision: s.hp, build_note: p.note });
    if (i + 1 < specs.length && specs[i + 1].mat.name !== s.mat.name) {
      const to = specs[i + 1].mat;
      const cteMis = Math.abs(s.mat.cte_per_k - to.cte_per_k);
      const blend = Math.min(Math.max(6 + cteMis * 1e6, 4), 20);
      const layerUm = Math.max(amProcessJs(to).layer, 20);
      const nLayers = Math.min(Math.max(Math.round((blend * 1e-3) / (layerUm * 1e-6)), 6), 60);
      transitions.push({ from_material: s.mat.name, to_material: to.name, x_center_m: s.x1, blend_length_mm: blend, layers: nLayers, composition_steps: Array.from({ length: nLayers }, (_, k) => (k + 0.5) / nLayers), note: `FGM ramp; ΔCTE = ${(cteMis * 1e6).toFixed(1)}e-6/K sets the ${blend.toFixed(0)} mm blend to limit interface stress` });
    }
  });
  const totalLen = specs.reduce((a, s) => a + Math.abs(s.x1 - s.x0), 0);
  const mats = [...new Set(specs.map((s) => s.mat.name))];
  return {
    regions,
    transitions,
    total_length_m: totalLen,
    estimated_layers: Math.round(layersF),
    build_direction: "axial, nozzle exit on the build plate",
    summary: `${regions.length} regions, ${mats.length} material(s), ${transitions.length} graded transition(s) | ~${Math.round(layersF)} layers over ${(totalLen * 1000).toFixed(0)} mm build`,
  };
}

function mockValidation(): SensorValidationDto {
  const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
  const l2 = liveDesign.caches.find((c) => c.tier === "L2")?.payload as L2ResultDto | undefined;
  const pc = liveDesign.operating_point.chamber_pressure;
  const thrust = liveDesign.operating_point.thrust;
  const gamma = l0?.gamma ?? 1.2;
  const rt = (l0?.throat_diameter ?? 0.03) / 2;
  const chamberL = l0?.chamber_length ?? 0.25;
  const chamberR = (l0?.chamber_diameter ?? 0.14) / 2;
  const bias = (x: number, k: number) => 1 + 0.03 * Math.sin(x * 30 + k) - 0.015 * Math.cos(x * 12);
  // Isentropic area→Mach (supersonic branch) by bisection, and the pressure ratio.
  const areaOf = (m: number) => (1 / m) * Math.pow((2 / (gamma + 1)) * (1 + ((gamma - 1) / 2) * m * m), (gamma + 1) / (2 * (gamma - 1)));
  const machFromArea = (ar: number) => {
    if (ar <= 1.0001) return 1;
    let lo = 1.0, hi = 25.0;
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (lo + hi);
      if (areaOf(mid) > ar) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  };
  const pRatio = (m: number) => Math.pow(1 + ((gamma - 1) / 2) * m * m, -gamma / (gamma - 1));

  const sensors: SpatialSensorDto[] = [];
  let sq = 0, n = 0;
  const push = (id: string, kind: string, x: number, r: number, predicted: number, unit: string, k: number) => {
    const measured = predicted * bias(x, k);
    const residual = predicted !== 0 ? ((measured - predicted) / predicted) * 100 : 0;
    sq += residual * residual; n += 1;
    sensors.push({ id, kind, x_m: x, r_m: r, predicted, measured, unit, residual_pct: residual });
  };
  push("P1 injector", "pressure", -chamberL, chamberR, pc, "Pa", 0.4);
  push("P2 mid-chamber", "pressure", -chamberL * 0.5, chamberR, pc * 0.99, "Pa", 0.4);
  const stns = l2?.stations ?? Array.from({ length: 40 }, (_, i) => ({ x: (i / 39) * 0.2, r: rt * (1 + 2 * (i / 39)) }));
  [[0, "P3 throat"], [0.35, "P4 nozzle"], [0.9, "P5 exit"]].forEach(([frac, label]) => {
    const st = stns[Math.round((stns.length - 1) * (frac as number))];
    if (!st) return;
    const ar = Math.max(1, (st.r / rt) ** 2);
    const pred = pc * pRatio(machFromArea(ar));
    push(label as string, "pressure", st.x, st.r, pred, "Pa", 1.1);
  });
  [0, 0.2, 0.5, 0.8].forEach((frac, i) => {
    const st = stns[Math.round((stns.length - 1) * frac)];
    if (!st) return;
    const wall = 0.28 * (l0?.tc_k ?? 3400) * (0.75 + 0.25 * Math.exp(-((st.x - 0.11) ** 2) / 0.02));
    push(`T${i + 1} wall`, "wall_temp", st.x, st.r, wall, "K", 2 + i);
  });
  const rmsSpatial = n > 0 ? Math.sqrt(sq / n) : 0;

  const ignition = 0.05, rise = 0.15;
  const time_series: TimeSampleDto[] = [];
  let tsq = 0, tn = 0;
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    const td = Math.max(0, t - ignition);
    const predFrac = 1 - Math.exp(-td / rise);
    const measFrac = td > 0 ? Math.max(0, 1 - Math.exp(-td / 0.18) + 0.04 * Math.exp(-td / 0.25) * Math.sin(td / 0.05)) : 0;
    if (td > 0.02) { const r = ((measFrac - predFrac) * thrust) / Math.max(thrust, 1) * 100; tsq += r * r; tn += 1; }
    time_series.push({ t_s: t, predicted_thrust_n: thrust * predFrac, measured_thrust_n: thrust * measFrac, predicted_pc_pa: pc * predFrac, measured_pc_pa: pc * measFrac });
  }
  const rmsThrust = tn > 0 ? Math.sqrt(tsq / tn) : 0;
  return {
    sensors, time_series, rms_spatial_pct: rmsSpatial, rms_thrust_pct: rmsThrust,
    ignition_delay_s: ignition, rise_time_s: rise, synthetic_reference: true,
    summary: `${sensors.length} sensors | spatial RMS ${rmsSpatial.toFixed(2)}% | startup RMS ${rmsThrust.toFixed(2)}% | t_ig=${(ignition * 1000).toFixed(0)} ms, t_rise=${(rise * 1000).toFixed(0)} ms`,
    csv: "id,kind,x_m,r_m,predicted,measured,unit,residual_pct\n(browser-dev mock)\n",
  };
}

function mockTurbopump(rpm: number): TurbopumpStudyDto {
  const l0 = liveDesign.caches.find((c) => c.tier === "L0")?.payload as L0ResultDto | undefined;
  const totalFlow = l0?.total_flow ?? 2.04;
  const pumpEff = pval("turbo.pump_efficiency", 0.7);
  const turbEff = pval("turbo.turbine_efficiency", 0.65);
  const ggFrac = pval("turbo.gg_flow_fraction", 0.03);
  const bore = pval("turbo.bearing_bore_mm", 45);
  const dnLimit = pval("turbo.bearing_dn_limit_millions", 2.0) * 1e6;
  const life = pval("turbo.bearing_life_hours", 5000);
  // Pump head from the pressure rise (discharge − tank), power from ṁ·g·H/η.
  const pcPa = liveDesign.operating_point.chamber_pressure || 2e6;
  const rho = 1000, g0 = 9.80665;
  const tankPa = pval("turbo.tank_pressure_bar", 3) * 1e5;
  const disch = pcPa * pval("turbo.discharge_pressure_factor", 1.25);
  const head = Math.max(0, disch - tankPa) / (rho * g0);
  const q = totalFlow / rho;
  const power = (rho * q * g0 * head) / Math.max(pumpEff, 0.1);
  const omega = (2 * Math.PI * rpm) / 60;
  const dnValue = rpm * bore;

  // Dimensionless pump specific speed Ns = ω√Q/(gH)^0.75 (→ US units ×2733).
  const nsDimless = omega * Math.sqrt(Math.max(q, 1e-6)) / Math.pow(g0 * Math.max(head, 1), 0.75);
  const nsUs = nsDimless * 2733;
  const pumpType = nsUs < 1500 ? "radial (centrifugal)" : nsUs < 4200 ? "mixed-flow" : "axial";
  // NPSH: available from tank head; required from NPSHr = (N·√Q/Nss)^(4/3)
  // (mirrors the Rust pump model — higher Nss / inducer lowers the requirement).
  const npshAvail = (tankPa - 5e3) / (rho * g0);
  const nss = pval("turbo.suction_specific_speed", 500);
  const npshReq = Math.pow((rpm * Math.sqrt(Math.max(q, 1e-6))) / Math.max(nss, 1), 4 / 3);
  const cavMargin = npshAvail - npshReq;

  // Turbine: pressure ratio, ideal exit temperature and shaft power from the GG gas.
  const gT = pval("turbo.turbine_gamma", 1.3);
  const cpT = pval("turbo.turbine_cp", 2000);
  const tinT = pval("turbo.turbine_inlet_temp_k", 950);
  const turbPr = (pcPa * pval("turbo.turbine_inlet_pressure_factor", 0.9)) / (pval("turbo.turbine_exit_pressure_bar", 3) * 1e5);
  const turbTempRatio = Math.pow(1 / Math.max(turbPr, 1.01), (gT - 1) / gT);
  // Efficiency-corrected exit temperature (lower efficiency ⇒ hotter exit).
  const exitT = tinT * (1 - turbEff * (1 - turbTempRatio));
  const ggFlow = Math.max(totalFlow * ggFrac, 0.05);
  const dhT = cpT * tinT * (1 - Math.pow(Math.max(turbPr, 1.01), -(gT - 1) / gT));
  const turbPower = ggFlow * dhT * turbEff;

  // Shaft: solid-shaft diameter from torque and allowable shear; 1st critical speed.
  const torque = power / Math.max(omega, 1);
  const tauAllow = pval("turbo.shaft_allowable_shear_mpa", 200) * 1e6;
  const sf = pval("turbo.shaft_safety_factor", 1.5);
  const shaftD = Math.cbrt((16 * torque * sf) / (Math.PI * tauAllow));
  const critRpm = rpm * (1.2 + 0.5 * (20000 / Math.max(rpm, 1000)));

  // Bearing: equivalent load, dynamic rating from bore, L10 life = (C/P)^3·1e6/(60N).
  const eqLoad = Math.hypot(pval("turbo.bearing_radial_load_n", 10000), pval("turbo.bearing_axial_load_n", 4000));
  const cRating = 42000 * Math.pow(bore, 1.3); // ~ bore(mm)^1.3 fit for angular-contact
  const l10 = (Math.pow(cRating / Math.max(eqLoad, 1), 3) * 1e6) / (60 * rpm);

  return {
    pump: { head_rise_m: head, shaft_power_w: power, cavitation_margin_m: cavMargin, specific_speed: nsUs, pump_type: pumpType, npsh_available_m: npshAvail, npsh_required_m: npshReq },
    turbine: { pressure_ratio: turbPr, shaft_power_w: turbPower, exit_temp_k: exitT, specific_speed: 6.2 },
    inducer: { suction_specific_speed: nss, inlet_tip_diameter_m: Math.max(2 * Math.sqrt(q / (Math.PI * 30)), 0.02), hub_diameter_m: Math.max(2 * Math.sqrt(q / (Math.PI * 30)), 0.02) * pval("turbo.inducer_hub_ratio", 0.4), flow_coefficient: 0.55, cavitation_ok: cavMargin > 0 },
    shaft: { torque_nm: torque, diameter_m: shaftD, safety_margin: sf, first_critical_rpm: critRpm, critical_speed_margin: critRpm / Math.max(rpm, 1), subcritical: critRpm > rpm },
    bearing: { equivalent_load_n: eqLoad, dynamic_load_rating_n: cRating, l10_life_hours: l10, dn_value: dnValue, life_ok: l10 >= life, dn_ok: dnValue < dnLimit },
    gg_cycle: { gg_flow_fraction: ggFrac, gg_flow_kg_s: ggFlow, chamber_flow_kg_s: totalFlow, pump_power_w: power, turbine_power_w: turbPower, margin: turbPower / Math.max(power, 1) },
  };
}

/** Steady-state Isp/thrust map (O/F × altitude), computed from the current
 *  propellant and thrust — peaks near the propellant's optimal O/F and rises
 *  with altitude. The Rust host replaces this with the real steady-state sweep. */
function mockPerfMap(): PerfMapDto {
  const props = mockProps();
  const thrust = liveDesign.operating_point.thrust || 5000;
  const ofc = props.ofOpt;
  const of_axis = [ofc - 0.6, ofc - 0.2, ofc + 0.2, ofc + 0.6].map((v) => +Math.max(0.5, v).toFixed(2));
  const alt_axis = Array.from({ length: 11 }, (_, i) => i * 8000);
  const peak = props.ispSea + 40; // vacuum-ish peak
  const isp_matrix = of_axis.map((of) =>
    alt_axis.map((alt) => peak - 45 * (of - ofc) ** 2 - 55 * (1 - alt / 80000)),
  );
  const thrust_matrix = of_axis.map(() => alt_axis.map((alt) => thrust * (1 + alt / 120000)));
  return { of_axis, alt_axis, isp_matrix, thrust_matrix };
}

/** Fetch the engine design from the backend (first IPC round-trip). */
export function getDesign(): Promise<EngineDesignDto> {
  return invoke<EngineDesignDto>("get_design");
}

/** Fetch the steady-state performance map (O/F × altitude). */
export function getPerfMap(): Promise<PerfMapDto> {
  return invoke<PerfMapDto>("perf_map");
}
