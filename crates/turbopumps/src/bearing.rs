//! Rolling-element bearing: L10 life and DN speed limit.

/// Bearing input (rolling-element ball bearing).
#[derive(Debug, Clone)]
pub struct BearingInput {
    pub radial_load_n: f64,
    pub axial_load_n: f64,
    pub speed_rpm: f64,
    pub required_life_hours: f64,
    /// Bore (inner-race) diameter, m. Sets the DN value.
    pub bore_diameter_m: f64,
    /// DN limit (bore in mm × rpm) for the lubrication/bearing class.
    /// Oil-lubricated steel ball bearings run to ~1.5–2.0 million.
    pub dn_limit: f64,
}

/// Bearing result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BearingResult {
    pub equivalent_load_n: f64,
    pub dynamic_load_rating_n: f64,
    pub l10_life_hours: f64,
    pub dn_value: f64,
    pub life_ok: bool,
    pub dn_ok: bool,
}

impl BearingResult {
    pub fn summary(&self) -> String {
        format!(
            "P={:.0} N | C={:.0} N | L10={:.0} h ({}) | DN={:.2}M ({})",
            self.equivalent_load_n,
            self.dynamic_load_rating_n,
            self.l10_life_hours,
            if self.life_ok { "OK" } else { "SHORT" },
            self.dn_value / 1e6,
            if self.dn_ok { "OK" } else { "OVER" },
        )
    }
}

/// Equivalent dynamic load P for a deep-groove ball bearing. For a light axial
/// load (Fa/Fr below the switching value e≈0.35) the radial load governs, P = Fr;
/// above it the combined-load factors X=0.56, Y=1.5 apply.
fn equivalent_load(fr: f64, fa: f64) -> f64 {
    let e = 0.35;
    if fr > 0.0 && fa / fr > e {
        0.56 * fr + 1.5 * fa
    } else {
        fr.max(fa)
    }
}

/// Estimate the required dynamic load rating (C) for a target L10 life (ball
/// bearing, exponent 3) and check the DN speed limit.
pub fn solve_bearing(input: &BearingInput) -> BearingResult {
    let p = equivalent_load(input.radial_load_n, input.axial_load_n).max(1.0);
    let n = input.speed_rpm;
    // L10 = (C/P)^3 · 10^6 revolutions / 60n  (hours). Solve for C.
    let revs = input.required_life_hours * 60.0 * n;
    let c = p * (revs / 1.0e6).powf(1.0 / 3.0);
    let l10 = (c / p).powi(3) * 1.0e6 / (60.0 * n.max(1.0));

    let dn = input.bore_diameter_m * 1000.0 * n;

    BearingResult {
        equivalent_load_n: p,
        dynamic_load_rating_n: c,
        l10_life_hours: l10,
        dn_value: dn,
        // C is sized to exactly meet the target; tolerate cbrt round-off.
        life_ok: l10 >= input.required_life_hours * (1.0 - 1e-9),
        dn_ok: dn <= input.dn_limit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bearing_input() -> BearingInput {
        BearingInput {
            radial_load_n: 10_000.0,
            axial_load_n: 0.0,
            speed_rpm: 15_000.0,
            required_life_hours: 5_000.0,
            bore_diameter_m: 0.04,
            dn_limit: 2.0e6,
        }
    }

    #[test]
    fn bearing_life_meets_target() {
        let r = solve_bearing(&bearing_input());
        assert!(r.dynamic_load_rating_n > 0.0);
        assert!(r.life_ok);
        // Pure radial: equivalent load is the radial load, not half of it.
        assert!((r.equivalent_load_n - 10_000.0).abs() < 1e-6);
    }

    #[test]
    fn axial_load_raises_equivalent_load() {
        let r = solve_bearing(&BearingInput { axial_load_n: 8_000.0, ..bearing_input() });
        assert!(r.equivalent_load_n > 10_000.0, "P = {}", r.equivalent_load_n);
    }

    #[test]
    fn dn_limit_flags_overspeed() {
        let r = solve_bearing(&BearingInput {
            bore_diameter_m: 0.1,
            speed_rpm: 30_000.0,
            ..bearing_input()
        });
        assert!(!r.dn_ok, "DN = {}", r.dn_value);
    }
}
