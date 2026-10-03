//! Turbine drive sizing from a hot-gas stream (gas-generator / staged-combustion).

use crate::G0;

/// Turbine input.
#[derive(Debug, Clone)]
pub struct TurbineInput {
    pub mass_flow_kg_s: f64,
    pub cp_j_kg_k: f64,
    pub gamma: f64,
    pub inlet_temp_k: f64,
    pub inlet_pressure_pa: f64,
    pub exit_pressure_pa: f64,
    pub efficiency: f64,
    pub speed_rpm: f64,
}

/// Turbine result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TurbineResult {
    pub pressure_ratio: f64,
    pub exit_temp_k: f64,
    pub available_power_w: f64,
    pub shaft_power_w: f64,
    pub specific_speed: f64,
}

impl TurbineResult {
    pub fn summary(&self) -> String {
        format!(
            "PR={:.2} | shaft_power={:.1} kW | T_exit={:.0} K | N_s={:.1}",
            self.pressure_ratio,
            self.shaft_power_w / 1000.0,
            self.exit_temp_k,
            self.specific_speed
        )
    }
}

/// Size a turbine drive from a gas-generator / staged-combustion stream.
pub fn solve_turbine(input: &TurbineInput) -> TurbineResult {
    let pr = (input.inlet_pressure_pa / input.exit_pressure_pa).max(1.0);
    let exponent = (input.gamma - 1.0) / input.gamma;
    let temp_ratio = pr.powf(-exponent);
    // Actual (efficiency-corrected) exit temperature: an inefficient turbine
    // extracts less work, so it leaves the gas hotter than the isentropic ideal.
    // ΔT_actual = η·(T_in − T_in·temp_ratio), so T_exit = T_in·(1 − η·(1−temp_ratio)).
    let exit_temp = input.inlet_temp_k * (1.0 - input.efficiency * (1.0 - temp_ratio));
    let specific_work = input.cp_j_kg_k * input.inlet_temp_k * (1.0 - temp_ratio) * input.efficiency;
    let shaft = input.mass_flow_kg_s * specific_work;
    // Turbine specific speed (rpm, m³/s, m) using the gas volumetric flow. The
    // drive gas is combustion product, not air: get its gas constant from the
    // supplied cp and γ via R = cp·(γ-1)/γ.
    let r_spec = input.cp_j_kg_k * (input.gamma - 1.0) / input.gamma;
    let rho = input.inlet_pressure_pa / (r_spec * input.inlet_temp_k);
    let q = input.mass_flow_kg_s / rho;
    let head = specific_work / G0;
    let n_s = input.speed_rpm * q.sqrt() / head.powf(0.75);

    TurbineResult {
        pressure_ratio: pr,
        exit_temp_k: exit_temp,
        available_power_w: input.mass_flow_kg_s * input.cp_j_kg_k * input.inlet_temp_k * (1.0 - temp_ratio),
        shaft_power_w: shaft,
        specific_speed: n_s,
    }
}

/// Turbopump power balance: the turbine must drive the pumps. Returns the balance
/// margin (turbine power / pump power); ≥ 1.0 means the turbine has enough power.
pub fn power_balance(pump_power_w: f64, turbine_power_w: f64) -> f64 {
    turbine_power_w / pump_power_w.max(1e-9)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turbine_produces_power() {
        let r = solve_turbine(&TurbineInput {
            mass_flow_kg_s: 2.0,
            cp_j_kg_k: 2000.0,
            gamma: 1.3,
            inlet_temp_k: 900.0,
            inlet_pressure_pa: 4.0e6,
            exit_pressure_pa: 3.0e5,
            efficiency: 0.65,
            speed_rpm: 25_000.0,
        });
        assert!(r.shaft_power_w > 0.0);
        assert!(r.exit_temp_k < 900.0);
        assert!(r.pressure_ratio > 1.0);
    }

    #[test]
    fn balance_is_ratio() {
        assert!((power_balance(100.0, 150.0) - 1.5).abs() < 1e-9);
    }
}
