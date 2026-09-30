//! Structural analysis (L4).
//!
//! Thin-wall pressure-vessel hoop/axial stress, combined pressure + thermal
//! stress, buckling under external pressure, and bolt/flange load capacity.

use engine_core::EngineError;

pub mod distribution;

/// L4 inputs.
#[derive(Debug, Clone)]
pub struct L4Input {
    pub chamber_pressure_pa: f64,
    pub chamber_radius_m: f64,
    pub wall_thickness_m: f64,
    /// Material allowable stress, Pa.
    pub allowable_stress_pa: f64,
    /// Material Young's modulus, Pa.
    pub youngs_modulus: f64,
    /// Thermal expansion coefficient, 1/K.
    pub alpha: f64,
    /// Poisson ratio.
    pub poisson: f64,
    /// Thermal gradient across the wall (from L3), K.
    pub thermal_gradient_k: f64,
    /// Joint diameter for the bolt check, m.
    pub joint_diameter_m: f64,
    /// Number of bolts.
    pub bolt_count: u32,
    /// Bolt root diameter, m.
    pub bolt_diameter_m: f64,
    /// Bolt allowable stress, Pa.
    pub bolt_allowable_pa: f64,
}

/// L4 result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StructuresResult {
    pub hoop_stress_pa: f64,
    pub axial_stress_pa: f64,
    pub thermal_stress_pa: f64,
    pub combined_stress_pa: f64,
    pub pressure_margin: f64,
    pub buckling_margin: f64,
    pub bolt_force_n: f64,
    pub bolt_stress_pa: f64,
    pub bolt_margin: f64,
}

impl StructuresResult {
    pub fn summary(&self) -> String {
        format!(
            "sigma_hoop={:.0} MPa | sigma_axial={:.0} MPa | combined={:.0} MPa | margin={:.2} | bolt_margin={:.2}",
            self.hoop_stress_pa / 1e6,
            self.axial_stress_pa / 1e6,
            self.combined_stress_pa / 1e6,
            self.pressure_margin,
            self.bolt_margin,
        )
    }
}

pub fn solve_l4(input: &L4Input) -> Result<StructuresResult, EngineError> {
    if input.wall_thickness_m <= 0.0 {
        return Err(EngineError::out_of_domain("wall_thickness", 1e-4, 1.0, input.wall_thickness_m));
    }
    let r = input.chamber_radius_m;
    let t = input.wall_thickness_m;
    let p = input.chamber_pressure_pa;

    // Thin-wall hoop and axial stress.
    let hoop = p * r / t;
    let axial = p * r / (2.0 * t);

    // Thermal stress (constrained flat-plate estimate).
    let thermal = input.youngs_modulus * input.alpha * input.thermal_gradient_k
        / (2.0 * (1.0 - input.poisson));

    // Combined stress (Tresca-like: hoop + thermal).
    let combined = hoop + thermal;

    let pressure_margin = input.allowable_stress_pa / combined;

    // Elastic buckling under external pressure (long cylinder).
    let buckling = input.youngs_modulus * (t / r).powi(3)
        / (4.0 * (1.0 - input.poisson * input.poisson));
    let buckling_margin = buckling / p.max(1.0);

    // Bolt/flange load check: separating force at the joint.
    let joint_area = std::f64::consts::PI * input.joint_diameter_m.powi(2) / 4.0;
    let bolt_force = p * joint_area;
    let bolt_area_per = std::f64::consts::PI * input.bolt_diameter_m.powi(2) / 4.0;
    let total_bolt_area = bolt_area_per * input.bolt_count as f64;
    let bolt_stress = bolt_force / total_bolt_area;
    let bolt_margin = input.bolt_allowable_pa / bolt_stress;

    Ok(StructuresResult {
        hoop_stress_pa: hoop,
        axial_stress_pa: axial,
        thermal_stress_pa: thermal,
        combined_stress_pa: combined,
        pressure_margin,
        buckling_margin,
        bolt_force_n: bolt_force,
        bolt_stress_pa: bolt_stress,
        bolt_margin,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> L4Input {
        L4Input {
            chamber_pressure_pa: 3.0e6,
            chamber_radius_m: 0.03,
            wall_thickness_m: 0.002,
            allowable_stress_pa: 300e6,
            youngs_modulus: 120e9,
            alpha: 1.6e-5,
            poisson: 0.33,
            thermal_gradient_k: 20.0,
            joint_diameter_m: 0.08,
            bolt_count: 8,
            bolt_diameter_m: 0.008,
            bolt_allowable_pa: 500e6,
        }
    }

    #[test]
    fn hoop_stress_scales_with_pressure() {
        let r = solve_l4(&input()).unwrap();
        let expected = 3.0e6 * 0.03 / 0.002;
        assert!((r.hoop_stress_pa - expected).abs() < 1.0, "hoop = {}", r.hoop_stress_pa);
        assert!(r.pressure_margin > 1.0);
        assert!(r.bolt_margin > 0.0);
    }

    #[test]
    fn zero_wall_errors() {
        let mut inp = input();
        inp.wall_thickness_m = 0.0;
        assert!(solve_l4(&inp).is_err());
    }
}
