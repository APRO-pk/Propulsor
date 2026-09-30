//! Computed combustion (c*) efficiency — energy-release efficiency (ERE).
//!
//! Instead of assuming a fixed c*-efficiency factor, this derives it from three
//! physical sub-processes that limit energy release in a real chamber:
//!
//! * **Residence** — whether the chamber gives the flow enough stay time to
//!   finish reacting. The residence time τ_res = ρ_c·V_c/ṁ (with V_c = L*·A_t)
//!   is compared to a reference combustion time; this is the classic
//!   "combustion efficiency rises with L*" behaviour.
//! * **Atomization** — a bounded penalty for coarse sprays, from the injector
//!   Sauter mean droplet diameter relative to a well-atomized reference.
//! * **Mixing** — inter-element mixing quality (a Rupe-style factor) from the
//!   injector element density and the injection pressure drop.
//!
//! The product is the energy-release efficiency; c* scales with the release, so
//! the c*-efficiency the nozzle model consumes is taken equal to the ERE.

/// ERE inputs.
#[derive(Debug, Clone)]
pub struct EreInput {
    /// Characteristic chamber length L* (m) — sets the combustion volume.
    pub l_star_m: f64,
    pub throat_area_m2: f64,
    pub mass_flow_kg_s: f64,
    /// Chamber gas density ρ_c = p_c/(R·T_c), kg/m³.
    pub chamber_gas_density_kg_m3: f64,
    pub chamber_temp_k: f64,
    /// Sauter mean droplet diameter from injector atomization, m.
    pub sauter_mean_diameter_m: f64,
    pub element_count: u32,
    /// Injector pressure drop as a fraction of chamber pressure.
    pub dp_fraction: f64,
    pub chamber_pressure_pa: f64,
}

/// Reference combustion time (ms) a well-atomized spray needs to finish
/// reacting; residence time is compared against this.
const REQUIRED_TIME_MS: f64 = 0.6;
/// Sauter mean diameter (m) taken as "well atomized" — no atomization penalty
/// below it.
const SMD_REFERENCE_M: f64 = 250.0e-6;

/// ERE breakdown.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EreResult {
    pub residence_time_ms: f64,
    pub required_time_ms: f64,
    /// η from residence time vs the required combustion time (rises with L*).
    pub residence_efficiency: f64,
    /// η from the spray Sauter mean diameter (coarse sprays are penalized).
    pub atomization_efficiency: f64,
    /// η from inter-element mixing (element density and ΔP).
    pub mixing_efficiency: f64,
    /// Energy-release efficiency = η_res · η_atom · η_mix.
    pub energy_release_efficiency: f64,
    /// Derived c* efficiency (= ERE), the factor the L2 nozzle model consumes.
    pub c_star_efficiency: f64,
    pub summary: String,
}

/// Compute the energy-release (and hence c*) efficiency from L*, atomization and
/// mixing.
pub fn energy_release_efficiency(input: &EreInput) -> EreResult {
    // Residence (stay) time: τ = ρ_c · V_c / ṁ, with V_c = L*·A_t.
    let v_c = input.l_star_m.max(0.05) * input.throat_area_m2.max(1e-9);
    let m_dot = input.mass_flow_kg_s.max(1e-6);
    let tau_res = input.chamber_gas_density_kg_m3.max(1e-3) * v_c / m_dot;
    let tau_req = REQUIRED_TIME_MS * 1e-3;
    // First-order approach to complete combustion as residence time grows.
    let residence = (1.0 - (-tau_res / tau_req).exp()).clamp(0.3, 0.9995);

    // Atomization: no penalty at/under the reference SMD, a bounded linear
    // penalty above it (coarse sprays don't finish burning).
    let smd = input.sauter_mean_diameter_m.max(1e-6);
    let coarseness = (smd / SMD_REFERENCE_M - 1.0).max(0.0);
    let atomization = (1.0 - 0.28 * coarseness).clamp(0.7, 0.999);

    // Mixing: finer element spacing and higher ΔP improve inter-element mixing.
    let n = input.element_count.max(1) as f64;
    let dp = input.dp_fraction.max(0.02);
    let mixing = (1.0 - 0.04 / ((n / 20.0).powf(0.4) * (dp / 0.2).powf(0.3))).clamp(0.7, 0.999);

    let ere = (residence * atomization * mixing).clamp(0.4, 0.9995);
    let summary = format!(
        "ERE={:.1}% (η_res={:.1}% η_atom={:.1}% η_mix={:.1}%) | τ_res={:.2} ms vs τ_req={:.2} ms, SMD={:.0} µm",
        ere * 100.0,
        residence * 100.0,
        atomization * 100.0,
        mixing * 100.0,
        tau_res * 1000.0,
        REQUIRED_TIME_MS,
        smd * 1e6
    );
    EreResult {
        residence_time_ms: tau_res * 1000.0,
        required_time_ms: REQUIRED_TIME_MS,
        residence_efficiency: residence,
        atomization_efficiency: atomization,
        mixing_efficiency: mixing,
        energy_release_efficiency: ere,
        c_star_efficiency: ere,
        summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nominal() -> EreInput {
        EreInput {
            l_star_m: 1.0,
            throat_area_m2: 2.0e-3,
            mass_flow_kg_s: 2.0,
            chamber_gas_density_kg_m3: 3.0,
            chamber_temp_k: 3400.0,
            sauter_mean_diameter_m: 80.0e-6,
            element_count: 24,
            dp_fraction: 0.2,
            chamber_pressure_pa: 3.0e6,
        }
    }

    #[test]
    fn ere_is_physical() {
        let r = energy_release_efficiency(&nominal());
        assert!(r.residence_time_ms > 0.0, "τ_res = {}", r.residence_time_ms);
        assert!((0.4..=0.9995).contains(&r.energy_release_efficiency), "ERE = {}", r.energy_release_efficiency);
        assert_eq!(r.c_star_efficiency, r.energy_release_efficiency);
    }

    #[test]
    fn finer_droplets_burn_more_completely() {
        let coarse = energy_release_efficiency(&EreInput { sauter_mean_diameter_m: 600.0e-6, ..nominal() });
        let fine = energy_release_efficiency(&EreInput { sauter_mean_diameter_m: 100.0e-6, ..nominal() });
        assert!(fine.atomization_efficiency > coarse.atomization_efficiency);
        // A well-atomized spray under the reference gets no penalty.
        assert!((fine.atomization_efficiency - 0.999).abs() < 1e-6 || fine.atomization_efficiency >= 0.99);
    }

    #[test]
    fn larger_l_star_lengthens_residence_and_helps() {
        let short = energy_release_efficiency(&EreInput { l_star_m: 0.4, ..nominal() });
        let long = energy_release_efficiency(&EreInput { l_star_m: 1.5, ..nominal() });
        assert!(long.residence_time_ms > short.residence_time_ms);
        assert!(long.residence_efficiency >= short.residence_efficiency);
        assert!(long.energy_release_efficiency >= short.energy_release_efficiency);
    }

    #[test]
    fn more_elements_mix_better() {
        let few = energy_release_efficiency(&EreInput { element_count: 8, ..nominal() });
        let many = energy_release_efficiency(&EreInput { element_count: 60, ..nominal() });
        assert!(many.mixing_efficiency > few.mixing_efficiency);
    }
}
