//! Quasi-1D nozzle flow and Rao/MoC bell contour (L2).
//!
//! Takes L1 gas properties and produces the axial area/velocity/Mach profile, the
//! bell contour `r(x)` table (consumed by L3 cooling and the renderer), and the
//! divergence/boundary-layer corrected specific impulse.

pub mod contour;
pub mod optimize;
pub mod quasi1d;

use engine_core::{ContourPoint, ExpansionTarget};

/// Nozzle contour type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum NozzleType {
    Conical,
    Bell,
}

/// L2 inputs.
#[derive(Debug, Clone)]
pub struct L2Input {
    pub gamma: f64,
    pub c_star_m_s: f64,
    pub tc_k: f64,
    pub mw: f64,
    pub pc_pa: f64,
    pub expansion: ExpansionTarget,
    /// Ambient/back pressure for the pressure-thrust term (over/under-expansion).
    /// When `None`, it falls back to the expansion target (perfect expansion for a
    /// fixed ratio, or the ambient pressure of `ExpansionTarget::AmbientPressure`).
    pub ambient_pressure_pa: Option<f64>,
    pub throat_area_m2: f64,
    /// Exit half-angle (deg) for the bell contour.
    pub exit_half_angle_deg: f64,
    /// Combustion / c* efficiency (0-1).
    pub c_star_efficiency: f64,
    pub nozzle_type: NozzleType,
}

/// L2 result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct L2Result {
    pub stations: Vec<ContourPoint>,
    pub area_ratio: f64,
    pub exit_mach: f64,
    pub exit_pressure_pa: f64,
    pub exit_temperature_k: f64,
    pub exit_diameter_m: f64,
    pub throat_diameter_m: f64,
    pub divergence_correction: f64,
    pub boundary_layer_correction: f64,
    pub isp_s: f64,
    pub c_star_m_s: f64,
    /// Rao bell initial parabola angle θ_n (deg); 0 for conical.
    #[serde(default)]
    pub bell_theta_n_deg: f64,
    /// Rao bell exit angle θ_e (deg); 0 for conical.
    #[serde(default)]
    pub bell_theta_e_deg: f64,
}

impl L2Result {
    pub fn summary(&self) -> String {
        format!(
            "A_e/A_t={:.2} | M_e={:.2} | D_e={:.4} m | lambda={:.3} | BL={:.3} | Isp={:.0} s",
            self.area_ratio,
            self.exit_mach,
            self.exit_diameter_m,
            self.divergence_correction,
            self.boundary_layer_correction,
            self.isp_s,
        )
    }
}

/// Solve the L2 gas-dynamics / contour model.
pub fn solve_l2(input: &L2Input) -> L2Result {
    let g = input.gamma;
    let pc = input.pc_pa;

    // Area ratio from the expansion target.
    let area_ratio = match input.expansion {
        ExpansionTarget::Ratio(r) => r.as_f64(),
        ExpansionTarget::AmbientPressure(pa) => {
            let (_, ar) = quasi1d::expand_to_pressure(pc, pa.as_si(), g);
            ar
        }
    };

    // Throat / exit geometry.
    let r_t = (input.throat_area_m2 / std::f64::consts::PI).sqrt();
    let r_e = r_t * area_ratio.sqrt();

    // Exit conditions (isentropic).
    let m_e = quasi1d::mach_from_area(area_ratio, g);
    let p_e = pc * quasi1d::pressure_ratio(m_e, g);
    let t_e = input.tc_k * quasi1d::temperature_ratio(m_e, g);

    // Ambient pressure (perfect expansion when the target is a fixed ratio).
    let pa = match input.ambient_pressure_pa {
        Some(pa) => pa,
        None => match input.expansion {
            ExpansionTarget::AmbientPressure(pa) => pa.as_si(),
            ExpansionTarget::Ratio(_) => p_e,
        },
    };

    // Ideal thrust coefficient (momentum + pressure term).
    let cf_ideal = optimize::thrust_coefficient(g, pc, area_ratio, pa);

    // Losses: divergence (bell has less than a conical) + boundary layer.
    let lambda_conical = contour::conical_divergence_correction(input.exit_half_angle_deg);
    // A Rao bell leaves the flow at θ_e; its divergence loss ≈ ½(1+cos θ_e).
    let bell_length_fraction = 0.8;
    let (theta_n_deg, theta_e_deg) = contour::rao_angles(area_ratio, bell_length_fraction);
    let divergence = match input.nozzle_type {
        NozzleType::Conical => lambda_conical,
        NozzleType::Bell => 0.5 * (1.0 + theta_e_deg.to_radians().cos()),
    };
    let bl = 0.985;

    // Apply combustion/c* efficiency.
    let c_star_eff = input.c_star_m_s * input.c_star_efficiency.clamp(0.0, 1.0);
    let cf = cf_ideal * divergence;
    let isp = c_star_eff * cf / 9.80665 * bl;

    let stations = match input.nozzle_type {
        NozzleType::Conical => contour::conical_contour(r_t, r_e, input.exit_half_angle_deg, 60),
        NozzleType::Bell => contour::rao_bell_contour(r_t, r_e, bell_length_fraction, 60),
    };

    L2Result {
        stations,
        area_ratio,
        exit_mach: m_e,
        exit_pressure_pa: p_e,
        exit_temperature_k: t_e,
        exit_diameter_m: 2.0 * r_e,
        throat_diameter_m: 2.0 * r_t,
        divergence_correction: divergence,
        boundary_layer_correction: bl,
        isp_s: isp,
        c_star_m_s: c_star_eff,
        bell_theta_n_deg: if input.nozzle_type == NozzleType::Bell { theta_n_deg } else { 0.0 },
        bell_theta_e_deg: if input.nozzle_type == NozzleType::Bell { theta_e_deg } else { 0.0 },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_area_is_consistent() {
        let input = L2Input {
            gamma: 1.2,
            c_star_m_s: 1700.0,
            tc_k: 3400.0,
            mw: 22.0,
            pc_pa: 3.0e6,
            expansion: ExpansionTarget::AmbientPressure(engine_core::Pressure::si(101_325.0)),
            ambient_pressure_pa: None,
            throat_area_m2: 2.0e-5,
            exit_half_angle_deg: 15.0,
            c_star_efficiency: 0.95,
            nozzle_type: NozzleType::Bell,
        };
        let r = solve_l2(&input);
        assert!((3.0..=5.0).contains(&r.area_ratio), "area ratio = {}", r.area_ratio);
        assert!(r.isp_s > 200.0 && r.isp_s < 400.0, "Isp = {}", r.isp_s);
        assert!(r.exit_mach > 1.0);
        assert_eq!(r.stations.len(), 60);
    }
}
