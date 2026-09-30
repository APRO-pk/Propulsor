//! Inducer (anti-cavitation front stage) sizing and cavitation check.

use crate::G0;

/// Inducer input.
#[derive(Debug, Clone)]
pub struct InducerInput {
    pub mass_flow_kg_s: f64,
    pub density_kg_m3: f64,
    pub speed_rpm: f64,
    pub npsh_available_m: f64,
    pub hub_ratio: f64,
}

/// Inducer result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InducerResult {
    pub suction_specific_speed: f64,
    pub inlet_tip_diameter_m: f64,
    pub hub_diameter_m: f64,
    pub inlet_tip_speed_m_s: f64,
    pub flow_coefficient: f64,
    pub head_coefficient: f64,
    pub blade_inlet_angle_deg: f64,
    pub npsh_margin_m: f64,
    pub cavitation_ok: bool,
}

impl InducerResult {
    pub fn summary(&self) -> String {
        format!(
            "N_ss={:.2} | D_tip={:.3} m | D_hub={:.3} m | β1={:.1}° | flow_c={:.2} | cav={}",
            self.suction_specific_speed,
            self.inlet_tip_diameter_m,
            self.hub_diameter_m,
            self.blade_inlet_angle_deg,
            self.flow_coefficient,
            if self.cavitation_ok { "OK" } else { "MARGINAL" }
        )
    }
}

/// Size an inducer (anti-cavitation front stage) and check the cavitation margin.
pub fn solve_inducer(input: &InducerInput) -> InducerResult {
    let q = input.mass_flow_kg_s / input.density_kg_m3;
    let omega = 2.0 * std::f64::consts::PI * input.speed_rpm / 60.0;
    // Dimensionless suction specific speed: ω_s = ω√Q / (g·NPSH)^0.75.
    let w_s = omega * q.sqrt() / (G0 * input.npsh_available_m).powf(0.75);
    // Size the inlet from the flow and a reasonable axial velocity.
    let v_axial = 40.0; // m/s (typical pump inlet)
    let area = q / v_axial;
    let d_tip = (4.0 * area / (std::f64::consts::PI * (1.0 - input.hub_ratio * input.hub_ratio))).sqrt();
    let d_hub = d_tip * input.hub_ratio;
    let u_tip = std::f64::consts::PI * d_tip * input.speed_rpm / 60.0;
    let flow_coefficient = v_axial / u_tip.max(1e-9);
    let head_coefficient = 0.06; // typical low-head inducer
    // Blade inlet angle from the inlet velocity triangle (axial flow, no pre-swirl):
    // tan β1 = v_axial / u_tip.
    let blade_inlet_angle_deg = (v_axial / u_tip.max(1e-9)).atan().to_degrees();
    // Cavitation margin: NPSHr scales with (ω_s/ω_s,max)²; ω_s,max ≈ 1.8.
    let npsh_required = input.npsh_available_m * (w_s / 1.8).powi(2);
    let margin = input.npsh_available_m - npsh_required;

    InducerResult {
        suction_specific_speed: w_s,
        inlet_tip_diameter_m: d_tip,
        hub_diameter_m: d_hub,
        inlet_tip_speed_m_s: u_tip,
        flow_coefficient,
        head_coefficient,
        blade_inlet_angle_deg,
        npsh_margin_m: margin,
        cavitation_ok: margin > 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inducer_geometry_is_positive() {
        let r = solve_inducer(&InducerInput {
            mass_flow_kg_s: 200.0,
            density_kg_m3: 1140.0,
            speed_rpm: 15_000.0,
            npsh_available_m: 20.0,
            hub_ratio: 0.4,
        });
        assert!(r.inlet_tip_diameter_m > 0.0);
        assert!(r.hub_diameter_m < r.inlet_tip_diameter_m);
        assert!(r.flow_coefficient > 0.0 && r.flow_coefficient < 1.0);
        assert!(r.blade_inlet_angle_deg > 0.0 && r.blade_inlet_angle_deg < 90.0);
    }
}
