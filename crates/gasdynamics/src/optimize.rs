//! Nozzle-expansion optimization and vehicle-dynamics trade.
//!
//! A fixed nozzle can only be perfectly expanded at one ambient pressure. A large
//! expansion ratio wins in vacuum but overexpands (and may flow-separate) at sea
//! level; a small ratio is optimal at lift-off but leaves vacuum performance on
//! the table. This module finds the single fixed expansion ratio that maximizes
//! the thrust coefficient averaged over an ascent trajectory.

use crate::quasi1d;

/// Atmospheric scale height for the exponential model, m.
pub const SCALE_HEIGHT_M: f64 = 8_500.0;

/// Vacuum thrust-coefficient constant `Γ = √(2γ²/(γ−1)·(2/(γ+1))^((γ+1)/(γ−1)))`.
fn cf_gamma(g: f64) -> f64 {
    (2.0 * g * g / (g - 1.0) * (2.0 / (g + 1.0)).powf((g + 1.0) / (g - 1.0))).sqrt()
}

/// Ideal thrust coefficient at an ambient pressure `pa`: momentum term plus the
/// pressure-thrust term `ε·(p_e − p_a)/p_c`.
pub fn thrust_coefficient(gamma: f64, pc: f64, area_ratio: f64, pa: f64) -> f64 {
    let g = gamma;
    let m_e = quasi1d::mach_from_area(area_ratio, g);
    let p_e = pc * quasi1d::pressure_ratio(m_e, g);
    let momentum = cf_gamma(g) * (1.0 - (p_e / pc).powf((g - 1.0) / g)).sqrt();
    let pressure = area_ratio * (p_e - pa) / pc;
    momentum + pressure
}

/// Ambient pressure at an altitude via an exponential atmosphere.
pub fn ambient_pressure_at(altitude_m: f64, sea_level_pa: f64) -> f64 {
    sea_level_pa * (-altitude_m / SCALE_HEIGHT_M).exp()
}

/// Build a time-uniform set of ambient-pressure samples for an ascent between two
/// altitudes (a first-cut trajectory when a real profile isn't supplied).
pub fn uniform_ascent_samples(sea_level_pa: f64, start_m: f64, burnout_m: f64, n: usize) -> Vec<f64> {
    let n = n.max(1);
    (0..n)
        .map(|i| {
            let frac = i as f64 / (n - 1).max(1) as f64;
            ambient_pressure_at(start_m + frac * (burnout_m - start_m), sea_level_pa)
        })
        .collect()
}

/// Flow-separation onset (Summerfield): an overexpanded nozzle separates when the
/// exit pressure falls below ~40% of the ambient pressure.
pub const SEPARATION_RATIO: f64 = 0.4;

/// Expansion-study input.
#[derive(Debug, Clone)]
pub struct ExpansionStudyInput {
    pub gamma: f64,
    pub pc_pa: f64,
    pub sea_level_pressure_pa: f64,
    /// Ambient pressures sampled over the trajectory (uniform time weighting).
    pub ambient_samples_pa: Vec<f64>,
    /// Search bounds for the area ratio `A_e/A_t`.
    pub area_ratio_bounds: (f64, f64),
}

/// Expansion-study result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExpansionStudyResult {
    /// Trajectory-optimal fixed expansion ratio.
    pub optimal_area_ratio: f64,
    /// Trajectory-averaged thrust coefficient at that ratio.
    pub mean_thrust_coefficient: f64,
    /// Expansion ratio that is perfectly expanded at sea level.
    pub sea_level_optimal_area_ratio: f64,
    /// Largest expansion ratio that does NOT flow-separate at sea level — the
    /// actionable cap for a nozzle that must ignite at lift-off.
    pub separation_limited_area_ratio: f64,
    /// Exit pressure at the optimal ratio, Pa.
    pub exit_pressure_pa: f64,
    /// Exit/ambient pressure ratio at sea level for the optimal nozzle.
    pub sea_level_exit_pressure_ratio: f64,
    /// Whether the optimal nozzle would flow-separate at sea level.
    pub separated_at_sea_level: bool,
}

impl ExpansionStudyResult {
    pub fn summary(&self) -> String {
        format!(
            "optimal ε={:.1} (sea-level ε={:.1}, sep-limit ε={:.1}) | mean Cf={:.3} | p_e={:.1} kPa | sep@SL={}",
            self.optimal_area_ratio,
            self.sea_level_optimal_area_ratio,
            self.separation_limited_area_ratio,
            self.mean_thrust_coefficient,
            self.exit_pressure_pa / 1000.0,
            self.separated_at_sea_level,
        )
    }
}

/// Find the fixed expansion ratio maximizing the trajectory-averaged thrust
/// coefficient. Sweeps the (log-spaced) area-ratio range and averages Cf over the
/// supplied ambient-pressure samples with uniform weight.
pub fn optimal_expansion(input: &ExpansionStudyInput) -> ExpansionStudyResult {
    let g = input.gamma;
    let pc = input.pc_pa;
    let (lo, hi) = input.area_ratio_bounds;
    let lo = lo.max(1.001);
    let hi = hi.max(lo * 1.01);
    let samples = if input.ambient_samples_pa.is_empty() {
        vec![input.sea_level_pressure_pa]
    } else {
        input.ambient_samples_pa.clone()
    };

    let mean_cf = |ar: f64| -> f64 {
        samples.iter().map(|&pa| thrust_coefficient(g, pc, ar, pa)).sum::<f64>() / samples.len() as f64
    };

    let n = 600;
    let mut best_ar = lo;
    let mut best_cf = f64::NEG_INFINITY;
    for i in 0..=n {
        let ar = lo * (hi / lo).powf(i as f64 / n as f64);
        let cf = mean_cf(ar);
        if cf > best_cf {
            best_cf = cf;
            best_ar = ar;
        }
    }

    let m_e = quasi1d::mach_from_area(best_ar, g);
    let p_e = pc * quasi1d::pressure_ratio(m_e, g);
    let sl_ratio = p_e / input.sea_level_pressure_pa.max(1.0);
    let (_, sl_optimal_ar) = quasi1d::expand_to_pressure(pc, input.sea_level_pressure_pa, g);
    // Largest ε whose exit pressure stays at/above the sea-level separation limit.
    let (_, sep_limited_ar) =
        quasi1d::expand_to_pressure(pc, SEPARATION_RATIO * input.sea_level_pressure_pa, g);

    ExpansionStudyResult {
        optimal_area_ratio: best_ar,
        mean_thrust_coefficient: best_cf,
        sea_level_optimal_area_ratio: sl_optimal_ar,
        separation_limited_area_ratio: sep_limited_ar,
        exit_pressure_pa: p_e,
        sea_level_exit_pressure_ratio: sl_ratio,
        separated_at_sea_level: sl_ratio < SEPARATION_RATIO,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vacuum_cf_exceeds_sea_level() {
        let (g, pc, ar) = (1.2, 5.0e6, 20.0);
        let vac = thrust_coefficient(g, pc, ar, 0.0);
        let sl = thrust_coefficient(g, pc, ar, 101_325.0);
        assert!(vac > sl, "vacuum Cf {vac} should beat sea-level {sl}");
    }

    #[test]
    fn atmosphere_decays_with_altitude() {
        assert!((ambient_pressure_at(0.0, 101_325.0) - 101_325.0).abs() < 1.0);
        assert!(ambient_pressure_at(10_000.0, 101_325.0) < ambient_pressure_at(1_000.0, 101_325.0));
    }

    #[test]
    fn single_altitude_optimum_is_perfect_expansion() {
        // Over a single ambient pressure, the Cf-optimal ratio is the one that is
        // perfectly expanded there (p_e = p_a).
        let pa = 50_000.0;
        let input = ExpansionStudyInput {
            gamma: 1.2,
            pc_pa: 5.0e6,
            sea_level_pressure_pa: 101_325.0,
            ambient_samples_pa: vec![pa],
            area_ratio_bounds: (1.5, 200.0),
        };
        let r = optimal_expansion(&input);
        let (_, perfect) = quasi1d::expand_to_pressure(5.0e6, pa, 1.2);
        assert!(
            (r.optimal_area_ratio - perfect).abs() / perfect < 0.05,
            "optimal ε={} vs perfect-expansion ε={perfect}",
            r.optimal_area_ratio
        );
    }

    #[test]
    fn higher_trajectory_favors_larger_nozzle() {
        let base = ExpansionStudyInput {
            gamma: 1.2,
            pc_pa: 5.0e6,
            sea_level_pressure_pa: 101_325.0,
            ambient_samples_pa: uniform_ascent_samples(101_325.0, 0.0, 5_000.0, 20),
            area_ratio_bounds: (1.5, 300.0),
        };
        let low = optimal_expansion(&base);
        let high = optimal_expansion(&ExpansionStudyInput {
            ambient_samples_pa: uniform_ascent_samples(101_325.0, 0.0, 60_000.0, 20),
            ..base.clone()
        });
        assert!(
            high.optimal_area_ratio > low.optimal_area_ratio,
            "high-altitude trajectory should want a bigger nozzle: {} vs {}",
            high.optimal_area_ratio,
            low.optimal_area_ratio
        );
    }

    #[test]
    fn separation_limited_ratio_sits_at_the_threshold() {
        let input = ExpansionStudyInput {
            gamma: 1.2,
            pc_pa: 7.0e6,
            sea_level_pressure_pa: 101_325.0,
            ambient_samples_pa: uniform_ascent_samples(101_325.0, 0.0, 40_000.0, 20),
            area_ratio_bounds: (1.5, 400.0),
        };
        let r = optimal_expansion(&input);
        // The separation-limited nozzle exits at exactly the 0.4·p_sl threshold and
        // is never larger than the unconstrained trajectory optimum here.
        let m_e = quasi1d::mach_from_area(r.separation_limited_area_ratio, 1.2);
        let p_e = 7.0e6 * quasi1d::pressure_ratio(m_e, 1.2);
        assert!((p_e - 0.4 * 101_325.0).abs() / (0.4 * 101_325.0) < 0.02);
        assert!(r.separation_limited_area_ratio < r.optimal_area_ratio);
    }

    #[test]
    fn big_vacuum_nozzle_separates_at_sea_level() {
        let input = ExpansionStudyInput {
            gamma: 1.2,
            pc_pa: 5.0e6,
            sea_level_pressure_pa: 101_325.0,
            // Near-vacuum trajectory drives a large optimal ratio.
            ambient_samples_pa: vec![100.0, 500.0, 1_000.0],
            area_ratio_bounds: (1.5, 400.0),
        };
        let r = optimal_expansion(&input);
        assert!(r.separated_at_sea_level, "large nozzle should separate at SL: {}", r.summary());
    }
}
