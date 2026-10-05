//! Equilibrium thermochemistry (L1) — the highest-risk crate.
//!
//! Native Rust Gibbs free-energy minimization over bundled NASA polynomial
//! coefficient species, solving for the adiabatic flame temperature and
//! combustion gas composition. No external CEA binary, no Python. Validated
//! against NASA CEA-type reference values.

pub mod data;
pub mod equilibrium;
pub mod flame;
pub mod nasa;

use engine_core::EngineError;

pub type EngineResult<T> = Result<T, EngineError>;

/// Solver method (ARCHITECTURE §4).
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub enum ThermoMethod {
    GibbsFreeEnergy,
    FrozenGamma,
}

/// L1 inputs.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ThermoInput {
    pub of_ratio: f64,
    pub chamber_pressure_pa: f64,
    pub propellant_pair: engine_core::PropellantPair,
    pub method: ThermoMethod,
    /// Fuel inlet (reactant) temperature, K. Below 298.15 (e.g. cryogenic) lowers
    /// the flame temperature via the reactant sensible-enthalpy term.
    #[serde(default = "default_reactant_temp")]
    pub fuel_temp_k: f64,
    /// Oxidizer inlet (reactant) temperature, K.
    #[serde(default = "default_reactant_temp")]
    pub ox_temp_k: f64,
}

fn default_reactant_temp() -> f64 {
    298.15
}

/// L1 result: real equilibrium combustion properties.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ThermoResult {
    pub tc_k: f64,
    pub gamma: f64,
    pub mean_molecular_weight: f64,
    pub c_star_m_s: f64,
    pub isp_vacuum_s: f64,
    pub species_mol: Vec<(String, f64)>,
}

impl ThermoResult {
    pub fn summary(&self) -> String {
        format!(
            "Tc={:.0} K | gamma={:.3} | MW={:.2} | c*={:.0} m/s | Isp_vac={:.0} s",
            self.tc_k, self.gamma, self.mean_molecular_weight, self.c_star_m_s, self.isp_vacuum_s
        )
    }
}

/// Sweep O/F to find the mixture ratio maximising vacuum Isp.
/// Returns `(best_of, best_isp_vac)`.
pub fn optimal_of(propellant_pair: engine_core::PropellantPair, pc_pa: f64) -> (f64, f64) {
    let mut best = (0.0f64, 0.0f64);
    let mut of = 0.6;
    while of <= 4.6 {
        let r = solve(&ThermoInput {
            of_ratio: of,
            chamber_pressure_pa: pc_pa,
            propellant_pair,
            method: ThermoMethod::GibbsFreeEnergy,
            fuel_temp_k: default_reactant_temp(),
            ox_temp_k: default_reactant_temp(),
        });
        if let Ok(r) = r {
            if r.isp_vacuum_s > best.1 {
                best = (of, r.isp_vacuum_s);
            }
        }
        of += 0.05;
    }
    best
}

/// Which product species are considered. This set covers hydrocarbon/oxygen
/// combustion with dissociation products; N2/NO are included for the air-derived
/// GOX cases (GOX from a cryo plant is nominally pure O2, so N2/NO are small).
fn species_set(_pair: engine_core::PropellantPair) -> &'static [data::Species] {
    data::SPECIES
}

/// Solve the L1 thermochemistry for an operating point.
pub fn solve(input: &ThermoInput) -> EngineResult<ThermoResult> {
    let pair = input.propellant_pair;
    let fuel = flame::fuel_for(pair);
    let ox = flame::oxidizer_for(pair);
    let species = species_set(pair);

    let tc = flame::adiabatic_tc(species, &fuel, &ox, input.of_ratio, input.chamber_pressure_pa, input.fuel_temp_k, input.ox_temp_k)?;
    let b = flame::element_amounts(&fuel, &ox, input.of_ratio);
    let n = equilibrium::equilibrium(species, &b, tc, input.chamber_pressure_pa)?;

    let props = equilibrium::mixture_props(species, &n, tc);
    let r_spec = equilibrium::r_specific(props.mean_mw);
    let cstar = equilibrium::c_star(props.gamma, r_spec, tc);

    // Vacuum thrust coefficient and Isp.
    let g = props.gamma;
    let cf_vac = (2.0 * g * g / (g - 1.0) * (2.0 / (g + 1.0)).powf((g + 1.0) / (g - 1.0))).sqrt();
    let isp_vac = cstar * cf_vac / 9.80665;

    let nsum: f64 = n.iter().sum();
    let species_mol = species
        .iter()
        .zip(n.iter())
        .map(|(s, &ni)| (s.name.to_string(), ni / nsum))
        .collect();

    Ok(ThermoResult {
        tc_k: tc,
        gamma: props.gamma,
        mean_molecular_weight: props.mean_mw,
        c_star_m_s: cstar,
        isp_vacuum_s: isp_vac,
        species_mol,
    })
}
