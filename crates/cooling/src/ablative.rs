//! Ablative cooling: a sacrificial liner absorbs heat by charring and eroding.
//! The surface recedes at a rate set by the incident heat flux and the material's
//! effective heat of ablation; the liner must be thick enough to survive the burn
//! with a safety-factor margin.

use crate::materials::AblativeMaterial;

/// Ablative-liner input.
#[derive(Debug, Clone)]
pub struct AblativeInput {
    /// Incident (gas-side) heat flux, W/m².
    pub heat_flux_w_m2: f64,
    pub burn_time_s: f64,
    pub material: AblativeMaterial,
    /// Design safety factor applied to the eroded depth.
    pub safety_factor: f64,
}

/// Ablative-liner result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AblativeResult {
    pub recession_rate_m_s: f64,
    pub total_recession_m: f64,
    pub required_thickness_m: f64,
    pub liner_mass_per_area_kg_m2: f64,
}

impl AblativeResult {
    pub fn summary(&self) -> String {
        format!(
            "recession={:.2} mm/s | total={:.1} mm | thickness(w/ SF)={:.1} mm | {:.1} kg/m²",
            self.recession_rate_m_s * 1000.0,
            self.total_recession_m * 1000.0,
            self.required_thickness_m * 1000.0,
            self.liner_mass_per_area_kg_m2,
        )
    }
}

/// Solve the ablative liner: recession rate `ṡ = q / (ρ·h_ablation)`, total
/// recession over the burn, and the liner thickness with a safety-factor margin.
pub fn solve_ablative(input: &AblativeInput) -> AblativeResult {
    let rho = input.material.density_kg_m3.max(1.0);
    let h_abl = input.material.heat_of_ablation_j_kg.max(1.0);
    let rate = input.heat_flux_w_m2 / (rho * h_abl);
    let total = rate * input.burn_time_s;
    let thickness = total * input.safety_factor.max(1.0);
    AblativeResult {
        recession_rate_m_s: rate,
        total_recession_m: total,
        required_thickness_m: thickness,
        liner_mass_per_area_kg_m2: thickness * rho,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materials;

    fn input() -> AblativeInput {
        AblativeInput {
            heat_flux_w_m2: 5.0e6,
            burn_time_s: 30.0,
            material: materials::silica_phenolic(),
            safety_factor: 1.5,
        }
    }

    #[test]
    fn recession_and_thickness_positive() {
        let r = solve_ablative(&input());
        assert!(r.recession_rate_m_s > 0.0);
        assert!(r.required_thickness_m > r.total_recession_m, "SF should add margin");
        assert!(r.liner_mass_per_area_kg_m2 > 0.0);
    }

    #[test]
    fn carbon_phenolic_recedes_slower() {
        let silica = solve_ablative(&input());
        let carbon = solve_ablative(&AblativeInput { material: materials::carbon_phenolic(), ..input() });
        assert!(carbon.recession_rate_m_s < silica.recession_rate_m_s);
    }

    #[test]
    fn longer_burn_needs_thicker_liner() {
        let short = solve_ablative(&input());
        let long = solve_ablative(&AblativeInput { burn_time_s: 120.0, ..input() });
        assert!(long.required_thickness_m > short.required_thickness_m);
    }
}
