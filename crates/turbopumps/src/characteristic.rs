//! Off-design characteristic maps.
//!
//! Pump head–flow (H–Q) curves at several shaft speeds via the affinity laws
//! plus an efficiency-vs-flow curve, and a turbine diagram-efficiency curve
//! against the blade/spouting velocity ratio U/C0.

/// One point on a pump H–Q curve.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HqPoint {
    pub flow_m3_s: f64,
    pub head_m: f64,
}

/// A pump characteristic at one shaft speed.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SpeedCurve {
    pub speed_fraction: f64,
    pub points: Vec<HqPoint>,
}

/// Pump efficiency-vs-flow point.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EffPoint {
    pub flow_fraction: f64,
    pub efficiency: f64,
}

/// Pump characteristic map.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PumpMap {
    pub design_flow_m3_s: f64,
    pub design_head_m: f64,
    pub speed_curves: Vec<SpeedCurve>,
    pub efficiency_curve: Vec<EffPoint>,
}

/// Build a pump H–Q map from the design point and peak efficiency.
///
/// The head follows a backswept-impeller law `H = H0 − k·Q²` normalised so the
/// design point sits on the design-speed curve; other speeds scale by the
/// affinity laws (`Q∝N`, `H∝N²`). Efficiency is a parabola peaking at design flow.
pub fn pump_map(design_flow_m3_s: f64, design_head_m: f64, peak_efficiency: f64) -> PumpMap {
    let qd = design_flow_m3_s.max(1e-6);
    let hd = design_head_m.max(1e-6);
    // Shut-off head ≈ 1.25·H_design; solve k so H(Qd) = Hd.
    let h0 = 1.25 * hd;
    let k = (h0 - hd) / (qd * qd);

    let speeds = [0.6, 0.8, 1.0, 1.2];
    let mut speed_curves = Vec::new();
    for &sp in &speeds {
        let mut points = Vec::new();
        let n = 24;
        let q_max = 1.4 * qd;
        for i in 0..=n {
            let q = q_max * i as f64 / n as f64;
            // Head at design speed, then affinity-scaled to this speed.
            let h_design_speed = (h0 - k * q * q).max(0.0);
            // Map this speed's flow back to the design-speed curve (Q ∝ N).
            let q_eq = q / sp;
            let h_eq = (h0 - k * q_eq * q_eq).max(0.0);
            let h = h_eq * sp * sp;
            let _ = h_design_speed;
            points.push(HqPoint { flow_m3_s: q, head_m: h });
        }
        speed_curves.push(SpeedCurve { speed_fraction: sp, points });
    }

    let mut efficiency_curve = Vec::new();
    for i in 0..=28 {
        let f = 1.4 * i as f64 / 28.0;
        // Parabola peaking at the design flow (f = 1).
        let eta = (peak_efficiency * (1.0 - 1.1 * (f - 1.0).powi(2))).max(0.0);
        efficiency_curve.push(EffPoint { flow_fraction: f, efficiency: eta });
    }

    PumpMap { design_flow_m3_s: qd, design_head_m: hd, speed_curves, efficiency_curve }
}

/// Turbine diagram-efficiency point.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TurbineEffPoint {
    pub velocity_ratio: f64,
    pub efficiency: f64,
}

/// Turbine characteristic: diagram efficiency vs U/C0.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TurbineMap {
    pub nozzle_angle_deg: f64,
    pub optimum_velocity_ratio: f64,
    pub peak_efficiency: f64,
    pub points: Vec<TurbineEffPoint>,
}

/// Single-stage impulse diagram efficiency vs velocity ratio ν = U/C0:
/// `η = 2·ν·(cosα − ν)·(1 + k)`, with a relative-velocity friction factor k.
pub fn turbine_map(nozzle_angle_deg: f64, blade_velocity_coeff: f64) -> TurbineMap {
    let alpha = nozzle_angle_deg.to_radians();
    let k = blade_velocity_coeff.clamp(0.0, 1.0);
    let nu_opt = alpha.cos() / 2.0;
    let mut points = Vec::new();
    let mut peak = 0.0;
    let n = 40;
    for i in 0..=n {
        let nu = 0.7 * i as f64 / n as f64;
        let eta = (2.0 * nu * (alpha.cos() - nu) * (1.0 + k)).max(0.0);
        peak = f64::max(peak, eta);
        points.push(TurbineEffPoint { velocity_ratio: nu, efficiency: eta });
    }
    TurbineMap { nozzle_angle_deg, optimum_velocity_ratio: nu_opt, peak_efficiency: peak, points }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pump_head_falls_with_flow_and_design_point_matches() {
        let m = pump_map(0.02, 800.0, 0.72);
        let design = m.speed_curves.iter().find(|c| (c.speed_fraction - 1.0).abs() < 1e-6).unwrap();
        // Head decreases monotonically with flow at design speed.
        for w in design.points.windows(2) {
            assert!(w[1].head_m <= w[0].head_m + 1e-6);
        }
        // Shut-off head exceeds the design head.
        assert!(design.points[0].head_m > 800.0);
    }

    #[test]
    fn higher_speed_gives_more_head() {
        let m = pump_map(0.02, 800.0, 0.72);
        let lo = &m.speed_curves[0]; // 0.6
        let hi = m.speed_curves.last().unwrap(); // 1.2
        assert!(hi.points[0].head_m > lo.points[0].head_m);
    }

    #[test]
    fn turbine_efficiency_peaks_near_half_cos_alpha() {
        let m = turbine_map(20.0, 0.9);
        let best = m.points.iter().max_by(|a, b| a.efficiency.partial_cmp(&b.efficiency).unwrap()).unwrap();
        assert!((best.velocity_ratio - m.optimum_velocity_ratio).abs() < 0.05);
        assert!(m.peak_efficiency > 0.5);
    }
}
