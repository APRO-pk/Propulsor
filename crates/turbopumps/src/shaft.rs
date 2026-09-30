//! Drive-shaft sizing: torsional strength and first critical (whirl) speed.

/// Shaft input.
#[derive(Debug, Clone)]
pub struct ShaftInput {
    pub power_w: f64,
    pub speed_rpm: f64,
    pub allowable_shear_pa: f64,
    /// Design factor applied to the allowable shear when sizing the diameter.
    pub design_safety_factor: f64,
    /// Bearing span (shaft length between supports), m.
    pub length_m: f64,
    /// Young's modulus of the shaft material, Pa.
    pub youngs_modulus_pa: f64,
    /// Lumped rotating mass carried by the shaft (impeller + turbine wheel), kg.
    pub lumped_mass_kg: f64,
}

/// Shaft result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ShaftResult {
    pub torque_nm: f64,
    pub diameter_m: f64,
    pub shear_stress_pa: f64,
    pub safety_margin: f64,
    pub first_critical_rpm: f64,
    pub critical_speed_margin: f64,
    pub subcritical: bool,
}

impl ShaftResult {
    pub fn summary(&self) -> String {
        format!(
            "T={:.0} N·m | D={:.4} m | SF={:.2} | N_cr={:.0} rpm ({}, margin={:.2})",
            self.torque_nm,
            self.diameter_m,
            self.safety_margin,
            self.first_critical_rpm,
            if self.subcritical { "subcritical" } else { "supercritical" },
            self.critical_speed_margin,
        )
    }
}

/// Size a solid drive shaft from transmitted power and allowable shear, then check
/// its first bending critical (whirl) speed against the operating speed.
///
/// The critical speed is a first-cut Rayleigh estimate: a massless shaft of the
/// computed diameter, simply supported over `length_m`, carrying `lumped_mass_kg`
/// at mid-span, giving stiffness `k = 48·E·I/L³` and `N_cr = (1/2π)·√(k/M)`.
pub fn solve_shaft(input: &ShaftInput) -> ShaftResult {
    let omega = 2.0 * std::f64::consts::PI * input.speed_rpm / 60.0;
    let torque = input.power_w / omega.max(1e-9);
    let sf = input.design_safety_factor.max(1.0);
    let working = input.allowable_shear_pa / sf;
    let diameter = (16.0 * torque / (std::f64::consts::PI * working)).cbrt();
    // Actual torsional shear at the chosen diameter and the true margin to allowable.
    let shear = 16.0 * torque / (std::f64::consts::PI * diameter.powi(3));
    let margin = input.allowable_shear_pa / shear.max(1.0);

    // First bending critical (whirl) speed.
    let i_area = std::f64::consts::PI * diameter.powi(4) / 64.0;
    let l = input.length_m.max(1e-6);
    let k = 48.0 * input.youngs_modulus_pa * i_area / l.powi(3);
    let m = input.lumped_mass_kg.max(1e-9);
    let omega_cr = (k / m).sqrt();
    let n_cr = omega_cr * 60.0 / (2.0 * std::f64::consts::PI);

    ShaftResult {
        torque_nm: torque,
        diameter_m: diameter,
        shear_stress_pa: shear,
        safety_margin: margin,
        first_critical_rpm: n_cr,
        critical_speed_margin: n_cr / input.speed_rpm.max(1.0),
        subcritical: input.speed_rpm < n_cr,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shaft_input() -> ShaftInput {
        ShaftInput {
            power_w: 2.5e6,
            speed_rpm: 20_000.0,
            allowable_shear_pa: 200.0e6,
            design_safety_factor: 1.5,
            length_m: 0.3,
            youngs_modulus_pa: 200.0e9,
            lumped_mass_kg: 5.0,
        }
    }

    #[test]
    fn shaft_diameter_from_torque() {
        let r = solve_shaft(&shaft_input());
        assert!(r.torque_nm > 0.0);
        assert!(r.diameter_m > 0.0);
        // Sized exactly to the working stress, so the margin equals the design factor.
        assert!((r.safety_margin - 1.5).abs() < 1e-6, "margin = {}", r.safety_margin);
    }

    #[test]
    fn critical_speed_is_reported() {
        let r = solve_shaft(&shaft_input());
        assert!(r.first_critical_rpm > 0.0);
        // Heavier wheel drops the critical speed.
        let heavy = solve_shaft(&ShaftInput { lumped_mass_kg: 20.0, ..shaft_input() });
        assert!(heavy.first_critical_rpm < r.first_critical_rpm);
    }

    #[test]
    fn higher_safety_factor_grows_diameter() {
        let a = solve_shaft(&shaft_input());
        let b = solve_shaft(&ShaftInput { design_safety_factor: 3.0, ..shaft_input() });
        assert!(b.diameter_m > a.diameter_m);
        assert!((b.safety_margin - 3.0).abs() < 1e-6);
    }
}
