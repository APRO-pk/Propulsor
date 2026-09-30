//! Feed system sizing and transients (L5).
//!
//! Tank wall/end-plate thickness, hydrostatic test pressure, line pressure-drop
//! budget, start/shutdown propellant-arrival timing, hard-start risk flag, and
//! combustion-stability screening (L*, injection velocity, ΔP ratio).

use engine_core::EngineError;

pub mod avionics;
pub mod control;

/// Universal gas constant, J/(mol·K).
pub const RU: f64 = 8.314462618;

/// L5 inputs.
#[derive(Debug, Clone)]
pub struct L5Input {
    pub chamber_pressure_pa: f64,
    pub chamber_diameter_m: f64,
    pub chamber_length_m: f64,
    /// Total propellant mass flow, kg/s.
    pub total_flow_kg_s: f64,
    /// Oxidizer mass flow, kg/s.
    pub ox_flow_kg_s: f64,
    /// Fuel mass flow, kg/s.
    pub fuel_flow_kg_s: f64,
    /// Fuel density, kg/m³.
    pub fuel_density: f64,
    /// Oxidizer density, kg/m³.
    pub ox_density: f64,
    /// Tank internal pressure (≈ regulator set), Pa.
    pub tank_pressure_pa: f64,
    /// Tank wall allowable stress, Pa.
    pub tank_allowable_pa: f64,
    /// Feed-line diameter, m.
    pub line_diameter_m: f64,
    /// Feed-line length, m.
    pub line_length_m: f64,
    /// Injection pressure drop (≈ 15-25% of Pc), Pa.
    pub injection_dp_pa: f64,
    /// Injection orifice total area, m².
    pub injection_area_m2: f64,
}

/// L5 result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FeedSystemResult {
    pub tank_wall_thickness_m: f64,
    pub end_plate_thickness_m: f64,
    pub hydrostatic_test_pressure_pa: f64,
    pub line_delta_p_pa: f64,
    pub fuel_arrival_s: f64,
    pub ox_arrival_s: f64,
    pub hard_start_risk: bool,
    pub hard_start_reason: String,
    pub stability_flags: Vec<String>,
}

impl FeedSystemResult {
    pub fn summary(&self) -> String {
        format!(
            "tank_wall={:.4} m | end_plate={:.4} m | test_P={:.1} bar | line_dP={:.0} kPa | hard_start={}",
            self.tank_wall_thickness_m,
            self.end_plate_thickness_m,
            self.hydrostatic_test_pressure_pa / 100_000.0,
            self.line_delta_p_pa / 1000.0,
            self.hard_start_risk,
        )
    }
}

/// Solve the feed-system / transient model.
pub fn solve_l5(input: &L5Input) -> Result<FeedSystemResult, EngineError> {
    let r = input.chamber_diameter_m / 2.0;
    if r <= 0.0 || input.tank_allowable_pa <= 0.0 {
        return Err(EngineError::out_of_domain("tank radius/allowable", 1e-3, 1e3, r));
    }

    // Tank wall (thin-wall hoop) with a 1.5x hydrostatic test.
    let wall = input.tank_pressure_pa * r / input.tank_allowable_pa;
    let test_pressure = 1.5 * input.tank_pressure_pa;
    // Flat circular end plate (simply supported): t = 0.32 r sqrt(P/σ).
    let end_plate = 0.32 * r * (test_pressure / input.tank_allowable_pa).sqrt();

    // Line pressure drop (Darcy-Weisbach, turbulent).
    let line_area = std::f64::consts::PI * input.line_diameter_m.powi(2) / 4.0;
    let v_fuel = if input.fuel_density > 0.0 && line_area > 0.0 {
        input.fuel_flow_kg_s / (input.fuel_density * line_area)
    } else {
        0.0
    };
    let rho = input.fuel_density.max(1.0);
    let mu = 1.0e-3;
    let re = rho * v_fuel * input.line_diameter_m / mu;
    let f = if re > 2000.0 {
        (0.790 * re.ln() - 1.64).powi(-2)
    } else {
        64.0 / re.max(1.0)
    };
    let line_dp = f * (input.line_length_m / input.line_diameter_m) * (rho * v_fuel * v_fuel / 2.0);

    // Propellant arrival timing at the injector (line fill + volume).
    let line_volume = line_area * input.line_length_m;
    let fuel_arrival = if input.fuel_flow_kg_s > 0.0 {
        (line_volume * input.fuel_density) / input.fuel_flow_kg_s
    } else {
        0.0
    };
    let ox_arrival = if input.ox_flow_kg_s > 0.0 {
        (line_volume * input.ox_density) / input.ox_flow_kg_s
    } else {
        0.0
    };

    // Hard-start risk: simultaneous liquid-liquid arrival is the classic cause.
    let mut hard_start_reason = String::new();
    let dt = (fuel_arrival - ox_arrival).abs();
    if dt < 0.05 {
        hard_start_reason = format!("fuel/ox arrive within {dt:.3}s of each other (liquid-liquid)");
    }
    let injection_velocity = if input.injection_area_m2 > 0.0 {
        input.total_flow_kg_s / (input.ox_density.max(1.0) * input.injection_area_m2)
    } else {
        0.0
    };
    if injection_velocity < 15.0 {
        hard_start_reason.push_str(&format!("; injection velocity {injection_velocity:.0} m/s too low"));
    }

    // Stability screening heuristics (Krzycki / SP-8113).
    let mut flags = Vec::new();
    let dp_ratio = input.injection_dp_pa / input.chamber_pressure_pa;
    if !(0.15..=0.25).contains(&dp_ratio) {
        flags.push(format!("injection ΔP/Pc = {dp_ratio:.2} outside 0.15-0.25"));
    }
    let l_star = (input.chamber_length_m * std::f64::consts::PI * input.chamber_diameter_m.powi(2) / 4.0)
        / input.injection_area_m2.max(1e-12);
    if !(0.5..=1.5).contains(&l_star) {
        flags.push(format!("L* = {l_star:.2} m outside 0.5-1.5"));
    }

    Ok(FeedSystemResult {
        tank_wall_thickness_m: wall,
        end_plate_thickness_m: end_plate,
        hydrostatic_test_pressure_pa: test_pressure,
        line_delta_p_pa: line_dp,
        fuel_arrival_s: fuel_arrival,
        ox_arrival_s: ox_arrival,
        hard_start_risk: !hard_start_reason.is_empty(),
        hard_start_reason,
        stability_flags: flags,
    })
}

/// Transient model input.
#[derive(Debug, Clone)]
pub struct TransientInput {
    pub chamber_volume_m3: f64,
    pub throat_area_m2: f64,
    pub c_star_m_s: f64,
    pub tc_k: f64,
    pub mw_g_per_mol: f64,
    pub steady_inflow_kg_s: f64,
    pub design_pc_pa: f64,
    /// Valve opening time (flow ramps 0 → steady over this time), s.
    pub valve_open_s: f64,
    pub burn_time_s: f64,
    pub dt_s: f64,
}

/// Transient result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TransientResult {
    pub time: Vec<f64>,
    pub pc: Vec<f64>,
    pub peak_pc_pa: f64,
    pub overshoot_ratio: f64,
    pub max_dpdt_pa_s: f64,
    pub hard_start: bool,
}

impl TransientResult {
    pub fn summary(&self) -> String {
        format!(
            "Pc_peak={:.0} kPa (x{:.2}) | max_dP/dt={:.2} MPa/s | hard_start={}",
            self.peak_pc_pa / 1000.0,
            self.overshoot_ratio,
            self.max_dpdt_pa_s / 1e6,
            self.hard_start,
        )
    }
}

/// Integrate the chamber-pressure transient ODE:
/// `dPc/dt = (ṁ_in(t) - ṁ_out(Pc)) · R·T_c / V_ch`, where `ṁ_out = Pc·A_t/c*`.
pub fn solve_transient(input: &TransientInput) -> TransientResult {
    let r_spec = RU / (input.mw_g_per_mol * 1e-3);
    let v = input.chamber_volume_m3.max(1e-9);

    let n = (input.burn_time_s / input.dt_s).ceil() as usize;
    let mut time = Vec::with_capacity(n);
    let mut pc = Vec::with_capacity(n);

    let mut p: f64 = 1.0e5; // start at ambient (ignition)
    let mut peak: f64 = p;
    let mut max_dpdt: f64 = 0.0;

    for i in 0..=n {
        let t = i as f64 * input.dt_s;
        time.push(t);
        pc.push(p);
        peak = peak.max(p);

        let inflow = input.steady_inflow_kg_s * (t / input.valve_open_s).min(1.0);
        let outflow = p * input.throat_area_m2 / input.c_star_m_s.max(1.0);
        let dpdt = (inflow - outflow) * r_spec * input.tc_k / v;
        max_dpdt = max_dpdt.max(dpdt.abs());
        p += dpdt * input.dt_s;
        p = p.max(1.0e4);
    }

    let overshoot = peak / input.design_pc_pa;
    // Hard start: substantial pressure overshoot, or an extremely fast spike.
    let hard_start = overshoot > 1.3 || max_dpdt > 1.5e6;

    TransientResult {
        time,
        pc,
        peak_pc_pa: peak,
        overshoot_ratio: overshoot,
        max_dpdt_pa_s: max_dpdt,
        hard_start,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> L5Input {
        L5Input {
            chamber_pressure_pa: 2.0e6,
            chamber_diameter_m: 0.06,
            chamber_length_m: 0.15,
            total_flow_kg_s: 0.03,
            ox_flow_kg_s: 0.021,
            fuel_flow_kg_s: 0.009,
            fuel_density: 750.0,
            ox_density: 1140.0,
            tank_pressure_pa: 3.0e6,
            tank_allowable_pa: 200.0e6,
            line_diameter_m: 0.01,
            line_length_m: 1.0,
            injection_dp_pa: 0.2 * 2.0e6,
            injection_area_m2: 2.0e-5,
        }
    }

    #[test]
    fn tank_and_transient_results() {
        let r = solve_l5(&input()).unwrap();
        assert!(r.tank_wall_thickness_m > 0.0);
        assert!((r.hydrostatic_test_pressure_pa - 4.5e6).abs() < 1.0, "test P = {}", r.hydrostatic_test_pressure_pa);
        assert!(r.fuel_arrival_s > 0.0);
    }

    #[test]
    fn simultaneous_arrival_flags_hard_start() {
        let mut inp = input();
        inp.ox_flow_kg_s = inp.fuel_flow_kg_s;
        let r = solve_l5(&inp).unwrap();
        assert!(r.hard_start_risk, "expected hard-start flag: {}", r.hard_start_reason);
    }

    #[test]
    fn transient_reaches_steady_pressure() {
        let inp = TransientInput {
            chamber_volume_m3: 1.5e-4,
            throat_area_m2: 2.0e-5,
            c_star_m_s: 1800.0,
            tc_k: 3400.0,
            mw_g_per_mol: 22.0,
            steady_inflow_kg_s: 0.04,
            design_pc_pa: 3.0e6,
            valve_open_s: 0.1,
            burn_time_s: 0.5,
            dt_s: 0.001,
        };
        let r = solve_transient(&inp);
        let last = *r.pc.last().unwrap();
        // The steady chamber pressure should settle near Pc = ṁ·c*/A_t.
        let expected = 0.04 * 1800.0 / 2.0e-5;
        assert!((last - expected).abs() / expected < 0.15, "Pc={last}, expected~{expected}");
        assert!(r.time.len() > 100);
    }
}
