//! Orchestrator for the tiered computational model.
//!
//! The *only* crate that composes the whole solver stack. Every tier reads the
//! canonical [`engine_core::EngineDesign`] and writes a tagged result back to it;
//! [`resolve`] walks the tier DAG bottom-up and re-solves only stale tiers,
//! honouring the provenance/dirty mapping in `engine-core`.

use engine_core::{EngineDesign, EngineError, SolveStatus, Tier};
use std::sync::atomic::AtomicBool;

pub mod design;

/// Re-exported so downstream users (and the Tauri host / CLI) get a single copy.
pub use engine_core::EngineError as SolveError;

/// Progress callback streamed to the frontend for long-running tiers.
#[derive(Debug, Clone)]
pub enum Progress {
    Percent { tier: Tier, pct: f32 },
    Phase { tier: Tier, phase: &'static str },
    Done { tier: Tier },
    Failed { tier: Tier, error: String },
}

/// Shared context threaded through a solve: unit system, stepping limits, and a
/// cancellation token (see ARCHITECTURE §3.1 — CPU work never runs on the tokio
/// executor; it runs on a dedicated pool and polls this token).
#[derive(Debug, Default)]
pub struct SolveContext {
    pub cancel: std::sync::Arc<AtomicBool>,
    pub max_iterations: Option<usize>,
}

impl SolveContext {
    pub fn new() -> Self {
        SolveContext {
            cancel: std::sync::Arc::new(AtomicBool::new(false)),
            max_iterations: None,
        }
    }
    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(std::sync::atomic::Ordering::Relaxed)
    }
    pub fn cancel(&self) {
        self.cancel.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Unified contract every tier must implement (ARCHITECTURE §3.1).
pub trait TierSolver {
    type Input;
    type Output;
    /// Hard pre-flight domain gate. Returns `Err(OutOfDomain)` for physically
    /// impossible inputs *before* the CPU pool ever runs (ARCHITECTURE §3.1 —
    /// mandatory for numerically explosive tiers like L3).
    fn relevance(inputs: &EngineDesign) -> Result<(), EngineError>;
    /// Run the solve. Blocking; the caller offloads this to a CPU pool.
    fn solve(
        &self,
        cx: &SolveContext,
        input: &Self::Input,
    ) -> Result<Self::Output, EngineError>;
}

/// Resolve a design by evaluating the highest stale tier and every tier above it.
///
/// This is the lazy tier pipeline (ARCHITECTURE §3). For the MVP it runs L0 (the
/// Krzycki analytical model) and stores the result in the L0 cache; higher tiers
/// mark themselves `Solved` as placeholders until their solvers land (M2–M5).
pub fn resolve(design: &mut EngineDesign) -> Result<(), EngineError> {
    // No pre-fed design: an unconfigured design (no propellant / zero
    // requirements) solves nothing — the tiers stay empty until the user enters
    // the core requirements.
    if !design.is_configured() {
        design.caches.clear();
        return Ok(());
    }
    for tier in Tier::ALL {
        if design.caches.iter().any(|c| c.tier == tier) {
            continue;
        }

        let (status, payload, error) = match tier {
            Tier::L0 => match sizing_l0::solve_l0(design, l0_assumptions(design)) {
                Ok(r0) => {
                    let payload = serde_json::to_value(&r0).map_err(|e| EngineError::Internal(e.to_string()))?;
                    (SolveStatus::Solved, Some(payload), None)
                }
                Err(e) => (SolveStatus::Failed, None, Some(e.to_string())),
            },
            Tier::L1 => {
                let (fuel_temp_k, ox_temp_k) = design::reactant_temps(design);
                let input = thermo::ThermoInput {
                    of_ratio: design.operating_point.mixture_ratio.as_f64(),
                    chamber_pressure_pa: design.operating_point.chamber_pressure.as_si(),
                    propellant_pair: design.propellant.pair,
                    method: thermo::ThermoMethod::GibbsFreeEnergy,
                    fuel_temp_k,
                    ox_temp_k,
                };
                match thermo::solve(&input) {
                    Ok(r1) => {
                        let payload = serde_json::to_value(&r1).map_err(|e| EngineError::Internal(e.to_string()))?;
                        (SolveStatus::Solved, Some(payload), None)
                    }
                    Err(e) => (SolveStatus::Failed, None, Some(e.to_string())),
                }
            }
            Tier::L2 => match l2_input(design) {
                Ok(input) => {
                    let r2 = gasdynamics::solve_l2(&input);
                    let payload = serde_json::to_value(&r2).map_err(|e| EngineError::Internal(e.to_string()))?;
                    (SolveStatus::Solved, Some(payload), None)
                }
                Err(e) => (SolveStatus::Failed, None, Some(e.to_string())),
            },
            Tier::L3 => match cooling::solve_l3(&l3_input(design)?) {
                Ok(r3) => {
                    let payload = serde_json::to_value(&r3).map_err(|e| EngineError::Internal(e.to_string()))?;
                    (SolveStatus::Solved, Some(payload), None)
                }
                Err(e) => (SolveStatus::Failed, None, Some(e.to_string())),
            },
            Tier::L4 => match structures::solve_l4(&l4_input(design)?) {
                Ok(r4) => {
                    let payload = serde_json::to_value(&r4).map_err(|e| EngineError::Internal(e.to_string()))?;
                    (SolveStatus::Solved, Some(payload), None)
                }
                Err(e) => (SolveStatus::Failed, None, Some(e.to_string())),
            },
            Tier::L5 => match feedsystem::solve_l5(&l5_input(design)?) {
                Ok(r5) => {
                    let payload = serde_json::to_value(&r5).map_err(|e| EngineError::Internal(e.to_string()))?;
                    (SolveStatus::Solved, Some(payload), None)
                }
                Err(e) => (SolveStatus::Failed, None, Some(e.to_string())),
            },
            _ => (SolveStatus::Solved, None, None),
        };

        design.caches.push(engine_core::TierCache {
            tier,
            status,
            inputs_hash: finger_print(design, tier),
            payload,
            error,
        });
    }
    Ok(())
}

fn finger_print(_design: &EngineDesign, _tier: Tier) -> u64 {
    0u64
}

/// L0 assumptions for a design: the characteristic chamber length L* comes from
/// the design when set, otherwise from the recommended value for the propellant.
fn l0_assumptions(design: &EngineDesign) -> sizing_l0::L0Assumptions {
    let l_star = design
        .geometry
        .chamber
        .as_ref()
        .and_then(|c| c.l_star_m)
        .unwrap_or_else(|| sizing_l0::recommended_l_star(design.propellant.pair));
    sizing_l0::L0Assumptions {
        l_star_m: l_star,
        ..sizing_l0::L0Assumptions::default()
    }
}

/// Build the L2 input from the cached L0 (throat area) and L1 (gas properties).
fn l2_input(design: &EngineDesign) -> Result<gasdynamics::L2Input, EngineError> {
    let l0 = design
        .caches
        .iter()
        .find(|c| c.tier == Tier::L0 && c.payload.is_some())
        .and_then(|c| c.payload.as_ref())
        .ok_or_else(|| EngineError::Precondition("L0 result missing".into()))?;
    let l0: sizing_l0::L0Result = serde_json::from_value(l0.clone())
        .map_err(|e| EngineError::Internal(e.to_string()))?;

    let l1 = design
        .caches
        .iter()
        .find(|c| c.tier == Tier::L1 && c.payload.is_some())
        .and_then(|c| c.payload.as_ref())
        .ok_or_else(|| EngineError::Precondition("L1 result missing".into()))?;
    let l1: thermo::ThermoResult = serde_json::from_value(l1.clone())
        .map_err(|e| EngineError::Internal(e.to_string()))?;

    // Flow model: "frozen" (quasi-1D default) or "equilibrium" (shifting), which
    // recombines in the nozzle and gains a few percent Isp — larger for hotter,
    // more-dissociated gas. First-order correction, not a full equilibrium expansion.
    let shifting_bonus = match design.choice("thermo.flow_model", "equilibrium").as_str() {
        "frozen" => 1.0,
        _ => 1.0 + 0.035 * ((l1.tc_k - 2500.0) / 1200.0).clamp(0.0, 1.3),
    };

    Ok(gasdynamics::L2Input {
        gamma: l1.gamma,
        c_star_m_s: l1.c_star_m_s,
        tc_k: l1.tc_k,
        mw: l1.mean_molecular_weight,
        pc_pa: design.operating_point.chamber_pressure.as_si(),
        expansion: design.operating_point.expansion,
        ambient_pressure_pa: None,
        throat_area_m2: l0.throat_area.as_si(),
        exit_half_angle_deg: 15.0,
        c_star_efficiency: design.operating_point.c_star_efficiency,
        nozzle_type: match design.geometry.nozzle.as_ref().and_then(|n| n.kind) {
            Some(engine_core::NozzleKind::Conical) => gasdynamics::NozzleType::Conical,
            _ => gasdynamics::NozzleType::Bell,
        },
        shifting_bonus,
    })
}

/// Build the L3 cooling input from L0 (wall/gap), L1 (gas), and L2 (contour).
fn l3_input(design: &EngineDesign) -> Result<cooling::L3Input, EngineError> {
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let l1: thermo::ThermoResult = payload(design, Tier::L1)?;
    let l2: gasdynamics::L2Result = payload(design, Tier::L2)?;

    Ok(cooling::L3Input {
        stations: l2.stations.clone(),
        throat_radius_m: l2.throat_diameter_m / 2.0,
        gamma: l1.gamma,
        tc_k: l1.tc_k,
        pc_pa: design.operating_point.chamber_pressure.as_si(),
        c_star_m_s: l1.c_star_m_s,
        mw_g_per_mol: l1.mean_molecular_weight,
        wall_material: design::resolve_material(
            design,
            &design.materials.chamber.clone().unwrap_or_else(|| "OFHC Copper".into()),
        ),
        wall_thickness_m: l0.wall_thickness.as_si(),
        coolant_gap_m: l0.cooling_gap.as_si(),
        // User-settable coolant conditions (persisted cooling.* params).
        coolant_velocity_m_s: design.param("cooling.coolant_velocity_m_s", 6.0).max(0.5),
        // Discrete cooling-channel geometry (0 channels → annular-gap model).
        channel_count: design.param("cooling.channel_count", 0.0).max(0.0),
        channel_width_m: design.param("cooling.channel_width_mm", 1.5).max(0.1) * 1e-3,
        channel_height_m: design.param("cooling.channel_height_mm", 3.0).max(0.1) * 1e-3,
        coolant_pressure_pa: design.param("cooling.coolant_pressure_bar", 3.0).max(0.5) * 1e5,
        film_cooling: None,
    })
}

/// Build the L4 structures input from L0 (geometry) and L3 (thermal gradient).
fn l4_input(design: &EngineDesign) -> Result<structures::L4Input, EngineError> {
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let l3: cooling::CoolingResult = payload(design, Tier::L3)?;

    let wall_temp = l3.max_wall_temp_k;
    let thermal_gradient = (wall_temp - 350.0).max(0.0);

    // Structural properties from the selected chamber material (not copper-pinned;
    // honors a user-defined "Custom" material too).
    let mat = design::resolve_material(
        design,
        &design.materials.chamber.clone().unwrap_or_else(|| "OFHC Copper".into()),
    );

    Ok(structures::L4Input {
        chamber_pressure_pa: design.operating_point.chamber_pressure.as_si(),
        chamber_radius_m: l0.chamber_diameter.as_si() / 2.0,
        wall_thickness_m: l0.wall_thickness.as_si(),
        allowable_stress_pa: mat.allowable_stress_pa,
        youngs_modulus: mat.youngs_modulus_pa,
        alpha: mat.cte_per_k,
        poisson: 0.33,
        thermal_gradient_k: thermal_gradient,
        joint_diameter_m: l0.chamber_diameter.as_si() + 0.02,
        bolt_count: 8,
        bolt_diameter_m: 0.008,
        bolt_allowable_pa: 500.0e6,
    })
}

/// Build the L5 feed-system input from L0 flow rates and geometry.
fn l5_input(design: &EngineDesign) -> Result<feedsystem::L5Input, EngineError> {
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let pc = design.operating_point.chamber_pressure.as_si();
    // Per-propellant oxidizer/fuel bulk densities (not fixed 1140/750).
    let (ox_density, fuel_density) = design::component_densities(design.propellant.pair);

    Ok(feedsystem::L5Input {
        chamber_pressure_pa: pc,
        chamber_diameter_m: l0.chamber_diameter.as_si(),
        chamber_length_m: l0.chamber_length.as_si(),
        total_flow_kg_s: l0.total_flow.as_si(),
        ox_flow_kg_s: l0.oxidizer_flow.as_si(),
        fuel_flow_kg_s: l0.fuel_flow.as_si(),
        fuel_density,
        ox_density,
        tank_pressure_pa: pc * 1.5,
        tank_allowable_pa: 200.0e6,
        line_diameter_m: 0.01,
        line_length_m: 1.0,
        injection_dp_pa: 0.2 * pc,
        injection_area_m2: l0.throat_area.as_si() * 0.3,
    })
}

/// Read a typed payload from a tier cache.
fn payload<T: serde::de::DeserializeOwned>(design: &EngineDesign, tier: Tier) -> Result<T, EngineError> {
    let p = design
        .caches
        .iter()
        .find(|c| c.tier == tier && c.payload.is_some())
        .and_then(|c| c.payload.as_ref())
        .ok_or_else(|| EngineError::Precondition(format!("{tier:?} result missing")))?;
    serde_json::from_value(p.clone()).map_err(|e| EngineError::Internal(e.to_string()))
}

/// Standard-atmosphere pressure (Pa) at an altitude (m). Troposphere and lower
/// stratosphere; good enough for sea-level → ~25 km performance mapping.
pub fn ambient_pressure(altitude_m: f64) -> f64 {
    if altitude_m <= 11_000.0 {
        101_325.0 * (1.0 - 2.25577e-5 * altitude_m).powf(5.25588)
    } else if altitude_m <= 20_000.0 {
        22_632.0 * (-(altitude_m - 11_000.0) / 6_341.6).exp()
    } else {
        5_474.9 * (1.0 - 2.25577e-5 * altitude_m).powf(5.25588)
    }
}

/// A steady-state performance map: Isp and thrust vs O/F and altitude.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PerfMap {
    pub of_axis: Vec<f64>,
    pub alt_axis: Vec<f64>,
    /// [of_idx][alt_idx]
    pub isp_matrix: Vec<Vec<f64>>,
    pub thrust_matrix: Vec<Vec<f64>>,
}

/// Build a steady-state performance map by sweeping O/F and altitude.
pub fn steady_state_map(
    design: &EngineDesign,
    of_range: (f64, f64),
    of_steps: usize,
    alt_range_m: (f64, f64),
    alt_steps: usize,
) -> Result<PerfMap, EngineError> {
    let pair = design.propellant.pair;
    let pc = design.operating_point.chamber_pressure.as_si();
    let mdot = design.operating_point.thrust.as_si() / 9.80665 / 260.0; // design-point mass flow

    let of_axis: Vec<f64> = linspace(of_range.0, of_range.1, of_steps);
    let alt_axis: Vec<f64> = linspace(alt_range_m.0, alt_range_m.1, alt_steps);

    let mut isp_matrix = Vec::with_capacity(of_steps);
    let mut thrust_matrix = Vec::with_capacity(of_steps);

    let (fuel_temp_k, ox_temp_k) = design::reactant_temps(design);
    for &of in &of_axis {
        let thermo = thermo::solve(&thermo::ThermoInput {
            of_ratio: of,
            chamber_pressure_pa: pc,
            propellant_pair: pair,
            method: thermo::ThermoMethod::GibbsFreeEnergy,
            fuel_temp_k,
            ox_temp_k,
        })?;
        let mut isp_row = Vec::with_capacity(alt_steps);
        let mut thrust_row = Vec::with_capacity(alt_steps);
        for &alt in &alt_axis {
            let pa = ambient_pressure(alt);
            let r2 = gasdynamics::solve_l2(&gasdynamics::L2Input {
                gamma: thermo.gamma,
                c_star_m_s: thermo.c_star_m_s,
                tc_k: thermo.tc_k,
                mw: thermo.mean_molecular_weight,
                pc_pa: pc,
                expansion: engine_core::ExpansionTarget::AmbientPressure(engine_core::Pressure::si(pa)),
                ambient_pressure_pa: None,
                throat_area_m2: 2.0e-5,
                exit_half_angle_deg: 15.0,
                c_star_efficiency: design.operating_point.c_star_efficiency,
                nozzle_type: gasdynamics::NozzleType::Bell,
                shifting_bonus: 1.0,
            });
            let isp = r2.isp_s;
            isp_row.push(isp);
            thrust_row.push(isp * mdot * 9.80665);
        }
        isp_matrix.push(isp_row);
        thrust_matrix.push(thrust_row);
    }

    Ok(PerfMap {
        of_axis,
        alt_axis,
        isp_matrix,
        thrust_matrix,
    })
}

fn linspace(a: f64, b: f64, n: usize) -> Vec<f64> {
    if n <= 1 {
        return vec![a];
    }
    (0..n).map(|i| a + (b - a) * (i as f64) / ((n - 1) as f64)).collect()
}

/// Find the expansion ratio (and exit pressure) that maximises Isp at a given
/// altitude — i.e. the "perfect-expansion" design point for a mission altitude.
/// Returns `(area_ratio, exit_pressure_pa, isp)`.
pub fn optimal_expansion(
    design: &EngineDesign,
    altitude_m: f64,
) -> Result<(f64, f64, f64), EngineError> {
    let pc = design.operating_point.chamber_pressure.as_si();
    let pa = ambient_pressure(altitude_m);
    let (fuel_temp_k, ox_temp_k) = design::reactant_temps(design);
    let thermo = thermo::solve(&thermo::ThermoInput {
        of_ratio: design.operating_point.mixture_ratio.as_f64(),
        chamber_pressure_pa: pc,
        propellant_pair: design.propellant.pair,
        method: thermo::ThermoMethod::GibbsFreeEnergy,
        fuel_temp_k,
        ox_temp_k,
    })?;

    let mut best = (1.0f64, 0.0f64, 0.0f64);
    for ar in linspace(1.0, 12.0, 60) {
        let l2 = gasdynamics::solve_l2(&gasdynamics::L2Input {
            gamma: thermo.gamma,
            c_star_m_s: thermo.c_star_m_s,
            tc_k: thermo.tc_k,
            mw: thermo.mean_molecular_weight,
            pc_pa: pc,
            expansion: engine_core::ExpansionTarget::Ratio(engine_core::Ratio::new(ar)),
            ambient_pressure_pa: Some(pa),
            throat_area_m2: 2.0e-5,
            exit_half_angle_deg: 15.0,
            c_star_efficiency: design.operating_point.c_star_efficiency,
            nozzle_type: gasdynamics::NozzleType::Bell,
            shifting_bonus: 1.0,
        });
        if l2.isp_s > best.2 {
            best = (ar, l2.exit_pressure_pa, l2.isp_s);
        }
    }
    Ok((best.0, best.1, best.2))
}

/// A single trade-study point.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TradePoint {
    pub pc_pa: f64,
    pub of: f64,
    pub isp_s: f64,
    pub thrust_n: f64,
    pub dry_mass_kg: f64,
    pub cost_usd: f64,
}

/// Grid sweep of chamber pressure × O/F, evaluating Isp and a dry-mass/cost proxy.
pub fn trade_study(
    base: &EngineDesign,
    pc_range: (f64, f64),
    of_range: (f64, f64),
    n: usize,
) -> Result<Vec<TradePoint>, EngineError> {
    let mut points = Vec::new();
    for pc in linspace(pc_range.0, pc_range.1, n) {
        for of in linspace(of_range.0, of_range.1, n) {
            let mut d = base.clone();
            d.operating_point.chamber_pressure = engine_core::Pressure::si(pc);
            d.operating_point.mixture_ratio = engine_core::Ratio::new(of);
            resolve(&mut d)?;

            let l2: gasdynamics::L2Result = payload(&d, Tier::L2)?;
            let l0: sizing_l0::L0Result = payload(&d, Tier::L0)?;

            // Dry mass: chamber wall + nozzle (scales with area ratio / length)
            // + tank (scales with pressure) + a fixed injector.
            let rho_cu = 8960.0;
            let d_ch = l0.chamber_diameter.as_si();
            let t_wall = l0.wall_thickness.as_si();
            let l_ch = l0.chamber_length.as_si();
            let chamber_mass = std::f64::consts::PI * d_ch * t_wall * l_ch * rho_cu;

            // Nozzle length from the parabolic bell: L = 2(r_e - r_t)/tan(θ_e).
            let r_t = l2.throat_diameter_m / 2.0;
            let r_e = l2.exit_diameter_m / 2.0;
            let theta = 15.0f64.to_radians();
            let l_n = 2.0 * (r_e - r_t) / theta.tan();
            let nozzle_mass = std::f64::consts::PI * (r_t + r_e) * t_wall * l_n * rho_cu;

            // Pressure-fed tank mass: propellant mass × pressure factor.
            let burn_time = 3.0;
            let prop_mass = l0.total_flow.as_si() * burn_time;
            let tank_mass = prop_mass * 0.2 * (pc / 3.0e6).sqrt();

            let injector_mass = 0.05;
            let dry_mass = chamber_mass + nozzle_mass + tank_mass + injector_mass;
            let cost = dry_mass * 80.0 + 1500.0;

            points.push(TradePoint {
                pc_pa: pc,
                of,
                isp_s: l2.isp_s,
                thrust_n: d.operating_point.thrust.as_si(),
                dry_mass_kg: dry_mass,
                cost_usd: cost,
            });
        }
    }
    Ok(points)
}

/// Pareto-optimal points (maximise Isp, minimise dry mass). A point is dominated
/// if another point is better on both axes.
pub fn pareto_front(points: &[TradePoint]) -> Vec<TradePoint> {
    let mut front: Vec<&TradePoint> = Vec::new();
    for p in points {
        let dominated = points.iter().any(|q| {
            (q.isp_s >= p.isp_s && q.dry_mass_kg <= p.dry_mass_kg) && (q.isp_s > p.isp_s || q.dry_mass_kg < p.dry_mass_kg)
        });
        if !dominated {
            front.push(p);
        }
    }
    front.into_iter().cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_populates_all_tier_caches() {
        let mut d = EngineDesign::new("test", "ci");
        resolve(&mut d).unwrap();
        assert_eq!(d.caches.len(), Tier::ALL.len());
        assert!(d.caches.iter().all(|c| c.status == SolveStatus::Solved));
    }

    #[test]
    fn perf_map_isp_rises_with_altitude() {
        let d = sizing_l0::krzycki_golden_design();
        let map = steady_state_map(&d, (2.0, 3.0), 3, (0.0, 10_000.0), 3).unwrap();
        for i in 0..map.of_axis.len() {
            for j in 0..map.alt_axis.len() - 1 {
                assert!(
                    map.isp_matrix[i][j + 1] > map.isp_matrix[i][j],
                    "Isp must rise with altitude at O/F={}",
                    map.of_axis[i]
                );
            }
        }
    }

    #[test]
    fn trade_study_produces_pareto_points() {
        let d = sizing_l0::krzycki_golden_design();
        let pts = trade_study(&d, (1.5e6, 3.5e6), (1.8, 3.2), 4).unwrap();
        assert_eq!(pts.len(), 16);
        let front = pareto_front(&pts);
        assert!(!front.is_empty());
        assert!(front.iter().all(|p| p.isp_s > 0.0 && p.dry_mass_kg > 0.0));

        // Dry mass must vary across the grid so the Pareto front is meaningful.
        let min_mass = pts.iter().map(|p| p.dry_mass_kg).fold(f64::INFINITY, f64::min);
        let max_mass = pts.iter().map(|p| p.dry_mass_kg).fold(f64::NEG_INFINITY, f64::max);
        assert!(
            max_mass > min_mass * 1.05,
            "mass must vary meaningfully: min={min_mass} max={max_mass}"
        );
    }

    #[test]
    fn optimal_expansion_matches_ambient_at_sea_level() {
        let d = sizing_l0::krzycki_golden_design();
        let (_, pe, isp) = optimal_expansion(&d, 0.0).unwrap();
        // At sea level the optimal exit pressure ≈ 101325 Pa (perfect expansion).
        assert!((pe - 101_325.0).abs() / 101_325.0 < 0.05, "pe = {pe}");
        assert!(isp > 200.0, "isp = {isp}");
    }

    /// Regression for the stale-cache freeze (report root cause A): after a design
    /// has solved once, editing an input must invalidate and recompute the dependent
    /// tiers — not leave frozen caches behind that `resolve` skips.
    #[test]
    fn editing_an_input_recomputes_tiers_not_frozen() {
        use engine_core::{FieldValue, SolveStatus, Tier};

        let mut d = sizing_l0::krzycki_golden_design();
        resolve(&mut d).unwrap();
        let throat_a = payload::<sizing_l0::L0Result>(&d, Tier::L0).unwrap().throat_area.as_si();

        // Double the chamber pressure: throat area scales ~1/Pc, so it must shrink.
        let pc0 = d.operating_point.chamber_pressure.as_si();
        d.apply_field("chamber_pressure", FieldValue::Num(pc0 * 2.0)).unwrap();
        resolve(&mut d).unwrap();
        let throat_b = payload::<sizing_l0::L0Result>(&d, Tier::L0).unwrap().throat_area.as_si();
        assert!(
            throat_b < 0.6 * throat_a,
            "L0 frozen: throat {throat_a} -> {throat_b} after doubling Pc"
        );

        // Changing L* must move the chamber length (report #20/#21). Baseline is
        // taken now (after the Pc edit) so the two edits don't cancel.
        let cham_len_pre = payload::<sizing_l0::L0Result>(&d, Tier::L0).unwrap().chamber_length.as_si();
        d.apply_field("l_star", FieldValue::Num(2.0)).unwrap();
        resolve(&mut d).unwrap();
        let cham_len_post = payload::<sizing_l0::L0Result>(&d, Tier::L0).unwrap().chamber_length.as_si();
        assert!(
            (cham_len_post - cham_len_pre).abs() / cham_len_pre > 0.1,
            "chamber length frozen: {cham_len_pre} -> {cham_len_post} after changing L*"
        );

        // Every tier comes back Solved with no leftover Stale entries or duplicates.
        assert!(
            d.caches.iter().all(|c| c.status == SolveStatus::Solved),
            "a tier was left non-Solved after re-resolve"
        );
        let tiers: Vec<Tier> = d.caches.iter().map(|c| c.tier).collect();
        let mut uniq = tiers.clone();
        uniq.sort();
        uniq.dedup();
        assert_eq!(tiers.len(), uniq.len(), "duplicate tier caches after re-resolve");
    }

    /// The Isp tiers are *different metrics* (report #17/#18): L1 vacuum is the
    /// Γ-limit ideal maximum (ε→∞), L2 is the delivered value at a finite ε with
    /// divergence/BL losses — so the ideal must exceed the delivered.
    #[test]
    fn ideal_vacuum_isp_exceeds_delivered() {
        use engine_core::Tier;
        let mut d = sizing_l0::krzycki_golden_design();
        resolve(&mut d).unwrap();
        let l1: thermo::ThermoResult = payload(&d, Tier::L1).unwrap();
        let l2: gasdynamics::L2Result = payload(&d, Tier::L2).unwrap();
        assert!(
            l1.isp_vacuum_s > l2.isp_s,
            "ideal-max vacuum Isp {} should exceed delivered Isp {}",
            l1.isp_vacuum_s,
            l2.isp_s
        );
        assert!((150.0..=320.0).contains(&l2.isp_s), "delivered Isp out of band: {}", l2.isp_s);
    }

    /// Regression for non-repeatable results (report #25/#30/#37/#52): the same
    /// inputs must give bit-identical outputs across repeated study calls.
    #[test]
    fn studies_are_deterministic() {
        use engine_core::FieldValue;
        let mut d = sizing_l0::krzycki_golden_design();
        // Raise Pc so the turbopump path is exercised.
        d.apply_field("chamber_pressure", FieldValue::Num(8.0e6)).unwrap();

        let a = design::turbopump_study(&mut d, 20_000.0).unwrap();
        let b = design::turbopump_study(&mut d, 20_000.0).unwrap();
        assert_eq!(
            a.shaft.first_critical_rpm.to_bits(),
            b.shaft.first_critical_rpm.to_bits(),
            "shaft critical speed not repeatable: {} vs {}",
            a.shaft.first_critical_rpm, b.shaft.first_critical_rpm
        );
        assert_eq!(a.pump.shaft_power_w.to_bits(), b.pump.shaft_power_w.to_bits(), "pump power not repeatable");

        let c1 = design::cooling_study(&mut d, "OFHC Copper", "regen").unwrap();
        let c2 = design::cooling_study(&mut d, "OFHC Copper", "regen").unwrap();
        assert_eq!(
            c1.regen.max_wall_temp_k.to_bits(),
            c2.regen.max_wall_temp_k.to_bits(),
            "wall temperature not repeatable: {} vs {}",
            c1.regen.max_wall_temp_k, c2.regen.max_wall_temp_k
        );
    }
}
