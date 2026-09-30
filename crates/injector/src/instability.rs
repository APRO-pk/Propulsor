//! Combustion-instability analysis (SP-8113).
//!
//! Resolves the chamber acoustic mode frequencies (longitudinal, first tangential
//! and first radial) for a cylindrical chamber, classifies the dominant regime
//! (chug / buzz / acoustic), and gives a Crocco n–τ sensitive-time-lag stability
//! margin. Goes beyond the ΔP/Pc + L* screening in the feed-system tier.

/// Zeros of the derivative of the Bessel function J1 — first tangential (1T) and
/// first radial (1R) transverse-mode eigenvalues for a cylinder.
const S_1T: f64 = 1.8412;
const S_1R: f64 = 3.8317;

/// Instability-analysis input.
#[derive(Debug, Clone)]
pub struct InstabilityInput {
    pub chamber_diameter_m: f64,
    pub chamber_length_m: f64,
    /// Combustion-gas sound speed, m/s (`a = √(γ R T_c)`).
    pub sound_speed_m_s: f64,
    /// Injector pressure-drop fraction of chamber pressure.
    pub dp_fraction: f64,
    /// Combustion (sensitive) time lag τ, s.
    pub time_lag_s: f64,
    /// Crocco interaction index n (pressure sensitivity of the burning rate).
    pub interaction_index: f64,
}

/// A resonant acoustic mode.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AcousticMode {
    pub name: String,
    pub frequency_hz: f64,
}

/// Instability-analysis result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstabilityResult {
    pub modes: Vec<AcousticMode>,
    pub dominant_mode: String,
    pub dominant_frequency_hz: f64,
    /// Regime: "chug" (<400 Hz), "buzz" (400–1000 Hz) or "acoustic" (>1000 Hz).
    pub regime: String,
    /// n–τ margin: how far the design sits below the neutral-stability index at
    /// the dominant mode. > 0 is stable.
    pub stability_margin: f64,
    pub stable: bool,
    pub notes: Vec<String>,
}

impl InstabilityResult {
    pub fn summary(&self) -> String {
        format!(
            "dominant {} @ {:.0} Hz ({}) | n–τ margin {:.2} | {}",
            self.dominant_mode,
            self.dominant_frequency_hz,
            self.regime,
            self.stability_margin,
            if self.stable { "STABLE" } else { "UNSTABLE" },
        )
    }
}

/// Run the instability analysis.
pub fn solve_instability(input: &InstabilityInput) -> InstabilityResult {
    let a = input.sound_speed_m_s;
    let d = input.chamber_diameter_m.max(1e-4);
    let l = input.chamber_length_m.max(1e-4);

    let modes = vec![
        AcousticMode { name: "1L (longitudinal)".into(), frequency_hz: a / (2.0 * l) },
        AcousticMode { name: "1T (tangential)".into(), frequency_hz: S_1T * a / (std::f64::consts::PI * d) },
        AcousticMode { name: "1R (radial)".into(), frequency_hz: S_1R * a / (std::f64::consts::PI * d) },
    ];

    // The first tangential mode is the classic high-frequency killer; take the
    // dominant driven mode as whichever couples closest to the combustion lag.
    let f_couple = 1.0 / (2.0 * input.time_lag_s.max(1e-6));
    let dominant = modes
        .iter()
        .min_by(|x, y| (x.frequency_hz - f_couple).abs().partial_cmp(&(y.frequency_hz - f_couple).abs()).unwrap())
        .cloned()
        .unwrap();

    let regime = if dominant.frequency_hz < 400.0 {
        "chug"
    } else if dominant.frequency_hz < 1000.0 {
        "buzz"
    } else {
        "acoustic"
    };

    // Crocco n–τ neutral index: the mode is driven when n exceeds a critical value
    // that grows with acoustic damping (approximated by the injector ΔP fraction).
    // Margin = n_crit − n; positive is stable.
    let omega_tau = 2.0 * std::f64::consts::PI * dominant.frequency_hz * input.time_lag_s;
    let coupling = (0.5 * omega_tau).sin().abs();
    let n_crit = 0.5 + 3.0 * input.dp_fraction / coupling.max(0.1);
    let margin = n_crit - input.interaction_index;

    let mut notes = Vec::new();
    if input.dp_fraction < 0.15 {
        notes.push("Low injector ΔP/Pc — weak acoustic damping, raise ΔP".into());
    }
    if regime == "acoustic" {
        notes.push("High-frequency (1T) risk — consider baffles / acoustic cavities".into());
    }

    InstabilityResult {
        modes,
        dominant_mode: dominant.name,
        dominant_frequency_hz: dominant.frequency_hz,
        regime: regime.into(),
        stability_margin: margin,
        stable: margin > 0.0,
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> InstabilityInput {
        InstabilityInput {
            chamber_diameter_m: 0.14,
            chamber_length_m: 0.25,
            sound_speed_m_s: 1150.0,
            dp_fraction: 0.2,
            time_lag_s: 1.5e-3,
            interaction_index: 0.5,
        }
    }

    #[test]
    fn modes_ordered_and_finite() {
        let r = solve_instability(&input());
        assert_eq!(r.modes.len(), 3);
        // 1R sits above 1T for a cylinder.
        let f1t = r.modes[1].frequency_hz;
        let f1r = r.modes[2].frequency_hz;
        assert!(f1r > f1t, "1R {f1r} should exceed 1T {f1t}");
        assert!(r.dominant_frequency_hz > 0.0);
    }

    #[test]
    fn higher_dp_improves_margin() {
        let low = solve_instability(&input());
        let high = solve_instability(&InstabilityInput { dp_fraction: 0.3, ..input() });
        assert!(high.stability_margin > low.stability_margin);
    }
}
