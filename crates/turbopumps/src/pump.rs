//! Centrifugal/mixed/axial pump sizing with NPSH / cavitation margin.

use crate::G0;

/// Pump input.
#[derive(Debug, Clone)]
pub struct PumpInput {
    pub mass_flow_kg_s: f64,
    pub density_kg_m3: f64,
    pub suction_pressure_pa: f64,
    pub discharge_pressure_pa: f64,
    pub vapor_pressure_pa: f64,
    pub speed_rpm: f64,
    pub efficiency: f64,
    /// Suction specific speed (rpm, m³/s, m units) the impeller is designed to.
    /// ~150–250 for a plain inlet, ~400–600 with an inducer. Sets NPSHr.
    pub suction_specific_speed: f64,
}

/// Pump result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PumpResult {
    pub head_rise_m: f64,
    pub hydraulic_power_w: f64,
    pub shaft_power_w: f64,
    pub npsh_available_m: f64,
    pub npsh_required_m: f64,
    pub cavitation_margin_m: f64,
    pub specific_speed: f64,
    pub pump_type: &'static str,
}

impl PumpResult {
    pub fn summary(&self) -> String {
        format!(
            "head={:.0} m | shaft_power={:.1} kW | NPSH margin={:.1} m | N_s={:.1} ({})",
            self.head_rise_m,
            self.shaft_power_w / 1000.0,
            self.cavitation_margin_m,
            self.specific_speed,
            self.pump_type
        )
    }
}

/// Size a pump (centrifugal/mixed/axial) from flow, pressure rise and speed.
pub fn solve_pump(input: &PumpInput) -> PumpResult {
    let dp = (input.discharge_pressure_pa - input.suction_pressure_pa).max(0.0);
    let head = dp / (input.density_kg_m3 * G0);
    let q = input.mass_flow_kg_s / input.density_kg_m3; // m³/s
    let hyd = input.mass_flow_kg_s * dp / input.density_kg_m3; // W
    let shaft = hyd / input.efficiency.max(0.01);
    let npsha = (input.suction_pressure_pa - input.vapor_pressure_pa) / (input.density_kg_m3 * G0);
    // NPSH required from the suction specific speed N_ss = N·√Q / NPSHr^0.75,
    // inverted: NPSHr = (N·√Q / N_ss)^(4/3). Ties cavitation to the inlet design
    // (a higher N_ss — e.g. with an inducer — lowers the required NPSH).
    let nss = input.suction_specific_speed.max(1.0);
    let npshr = (input.speed_rpm * q.sqrt() / nss).powf(4.0 / 3.0);

    // Specific speed (rpm, m³/s, m). Used to select the impeller type.
    let n_s = input.speed_rpm * q.sqrt() / head.powf(0.75);
    let pump_type = if n_s < 300.0 {
        "centrifugal"
    } else if n_s < 600.0 {
        "mixed-flow"
    } else {
        "axial"
    };

    PumpResult {
        head_rise_m: head,
        hydraulic_power_w: hyd,
        shaft_power_w: shaft,
        npsh_available_m: npsha,
        npsh_required_m: npshr,
        cavitation_margin_m: npsha - npshr,
        specific_speed: n_s,
        pump_type,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pump_input() -> PumpInput {
        PumpInput {
            mass_flow_kg_s: 20.0,
            density_kg_m3: 1000.0,
            suction_pressure_pa: 2.0e6,
            discharge_pressure_pa: 7.0e6,
            vapor_pressure_pa: 5.0e3,
            speed_rpm: 20_000.0,
            efficiency: 0.70,
            suction_specific_speed: 250.0,
        }
    }

    #[test]
    fn pump_head_and_power_scale() {
        let r = solve_pump(&pump_input());
        let expected_head = (7.0e6 - 2.0e6) / (1000.0 * G0);
        assert!((r.head_rise_m - expected_head).abs() < 1.0, "head = {}", r.head_rise_m);
        assert!(r.shaft_power_w > 0.0);
        assert!(r.cavitation_margin_m > 0.0, "NPSH margin = {}", r.cavitation_margin_m);
        assert_eq!(r.pump_type, "centrifugal");
    }

    #[test]
    fn inducer_lowers_npshr() {
        let plain = solve_pump(&pump_input());
        let with_inducer = solve_pump(&PumpInput { suction_specific_speed: 500.0, ..pump_input() });
        assert!(with_inducer.npsh_required_m < plain.npsh_required_m,
            "higher N_ss should reduce NPSHr: {} vs {}", with_inducer.npsh_required_m, plain.npsh_required_m);
    }
}
