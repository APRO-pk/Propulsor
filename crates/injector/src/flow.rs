//! Injector fluid-flow simulation.
//!
//! A first-principles orifice-flow model (not a CFD solve, but resolving the real
//! flow quantities): discharge-coefficient velocity, per-orifice sizing, the
//! oxidizer/fuel momentum ratio for impinging elements, and the mass-median
//! droplet size from the Priem–Heidmann hot-fire drop-size correlation.
//!
//! **Drop size** (Priem & Heidmann NASA TR R-67, as reproduced in NASA
//! CR-168066 §V.A): the mass-median radius r_m,uncor(d) inferred from LOX/heptane
//! hot-fire performance, Fig. 27, digitized here as power laws in jet diameter
//! d (cm), corrected for liquid properties by TR R-67's recommended group (Eq. 2):
//!
//! ```text
//! r_m = 99.29 · r_m,uncor(d) · (σ·μ/ρ)^0.25                            [SI]
//! ```
//!
//! CR-168066 additionally proposes a (V/19.8 m/s)^-0.66 velocity correction; it
//! is *not* applied, because Pavli (NASA TM-79319) validated the TR R-67 form
//! without it against measured c* efficiency, and reproducing his predicted
//! values requires leaving it out.

use crate::liquids::{Liquid, Phase};

/// Injector element type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ElementType {
    LikeDoublet,
    UnlikeDoublet,
    Triplet,
    Coaxial,
    Pintle,
}

/// Drop-size family of CR-168066 Fig. 27 an element atomizes like.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SprayFamily {
    ImpingingJets,
    Triplet,
    ParallelJets,
}

impl ElementType {
    /// Fig. 27 drop-size family, and whether that mapping goes beyond the
    /// element types the figure was measured for (like doublets and triplets).
    pub fn spray_family(self) -> (SprayFamily, bool) {
        match self {
            ElementType::LikeDoublet => (SprayFamily::ImpingingJets, false),
            ElementType::Triplet => (SprayFamily::Triplet, false),
            // Two-jet impingement: treated with the impinging-jet line.
            ElementType::UnlikeDoublet | ElementType::Pintle => (SprayFamily::ImpingingJets, true),
            // Non-impinging (shear) element: the parallel-jet line.
            ElementType::Coaxial => (SprayFamily::ParallelJets, true),
        }
    }
}

/// Uncorrected mass-median drop radius (µm) for jet diameter `d_cm`, digitized
/// from CR-168066 Fig. 27 (log-log straight lines; fit rms < 0.006 decades).
pub fn uncorrected_drop_radius_um(family: SprayFamily, d_cm: f64) -> f64 {
    let d = d_cm.max(1e-4);
    match family {
        SprayFamily::ImpingingJets => 449.0 * d.powf(0.992),
        SprayFamily::Triplet => 78.8 * d.powf(0.622),
        SprayFamily::ParallelJets => 430.4 * d.powf(0.616),
    }
}

/// Mass-median drop radius (µm) for a jet of diameter `d_m` — TR R-67 Fig. 27
/// with the Eq. 2 liquid-property group.
pub fn mass_median_radius_um(family: SprayFamily, d_m: f64, liquid: &Liquid) -> f64 {
    let group = (liquid.surface_tension_n_m * liquid.viscosity_pa_s / liquid.density_kg_m3).powf(0.25);
    99.29 * uncorrected_drop_radius_um(family, d_m * 100.0) * group
}

/// One propellant side of the injector.
#[derive(Debug, Clone)]
pub struct SideInput {
    pub flow_kg_s: f64,
    pub liquid: Liquid,
    pub phase: Phase,
}

/// Injector flow input.
#[derive(Debug, Clone)]
pub struct InjectorFlowInput {
    pub ox: SideInput,
    pub fuel: SideInput,
    pub chamber_pressure_pa: f64,
    /// Injector pressure-drop fraction of chamber pressure (0.15–0.25 typical).
    pub dp_fraction: f64,
    pub element_count: u32,
    /// Orifice discharge coefficient (~0.6–0.8).
    pub discharge_coefficient: f64,
    /// Chamber gas density, kg/m³ (for the aerodynamic Weber number).
    pub gas_density_kg_m3: f64,
    pub element_type: ElementType,
}

/// One propellant side's orifice flow.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SideFlow {
    pub phase: Phase,
    pub injection_velocity_m_s: f64,
    pub orifice_diameter_m: f64,
    pub weber_number: f64,
    /// Mass-median droplet diameter (2·r_m); zero for a gas-injected side.
    pub mass_median_diameter_m: f64,
}

/// Injector flow result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InjectorFlowResult {
    pub pressure_drop_pa: f64,
    pub ox: SideFlow,
    pub fuel: SideFlow,
    pub momentum_ratio: f64,
    pub element_type: ElementType,
    pub flags: Vec<String>,
}

impl InjectorFlowResult {
    pub fn summary(&self) -> String {
        format!(
            "ΔP={:.0} kPa | v_ox={:.0} v_fu={:.0} m/s | MMD ox/fu={:.0}/{:.0} µm | MR_mom={:.2}",
            self.pressure_drop_pa / 1000.0,
            self.ox.injection_velocity_m_s,
            self.fuel.injection_velocity_m_s,
            self.ox.mass_median_diameter_m * 1e6,
            self.fuel.mass_median_diameter_m * 1e6,
            self.momentum_ratio,
        )
    }
}

fn side_flow(side: &SideInput, dp: f64, n: f64, cd: f64, gas_density: f64, family: SprayFamily) -> SideFlow {
    let density = side.liquid.density_kg_m3;
    // Bernoulli orifice velocity with a discharge coefficient.
    let v = cd * (2.0 * dp / density).sqrt();
    // Total effective orifice area from continuity, split over n elements.
    let area_total = side.flow_kg_s / (density * v).max(1e-9);
    let area_each = area_total / n.max(1.0);
    let d = (4.0 * area_each / std::f64::consts::PI).sqrt();
    // Aerodynamic Weber number (informational).
    let we = gas_density * v * v * d / side.liquid.surface_tension_n_m.max(1e-6);
    let mmd = match side.phase {
        Phase::Liquid => 2.0 * mass_median_radius_um(family, d, &side.liquid) * 1e-6,
        Phase::Gas => 0.0,
    };
    SideFlow {
        phase: side.phase,
        injection_velocity_m_s: v,
        orifice_diameter_m: d,
        weber_number: we,
        mass_median_diameter_m: mmd,
    }
}

/// Solve the injector flow for both propellant sides.
pub fn solve_injector_flow(input: &InjectorFlowInput) -> InjectorFlowResult {
    let dp = input.dp_fraction * input.chamber_pressure_pa;
    let n = input.element_count as f64;
    let (family, extrapolated) = input.element_type.spray_family();
    let cd = input.discharge_coefficient;
    let ox = side_flow(&input.ox, dp, n, cd, input.gas_density_kg_m3, family);
    let fuel = side_flow(&input.fuel, dp, n, cd, input.gas_density_kg_m3, family);

    // Oxidizer/fuel momentum ratio (impinging-element mixing quality).
    let momentum_ratio = (input.ox.flow_kg_s * ox.injection_velocity_m_s)
        / (input.fuel.flow_kg_s * fuel.injection_velocity_m_s).max(1e-9);

    let mut flags = Vec::new();
    if !(0.15..=0.25).contains(&input.dp_fraction) {
        flags.push(format!("ΔP/Pc = {:.2} outside 0.15–0.25", input.dp_fraction));
    }
    if input.ox.phase == Phase::Liquid && !(15.0..=60.0).contains(&ox.injection_velocity_m_s) {
        flags.push(format!("ox injection velocity {:.0} m/s outside 15–60", ox.injection_velocity_m_s));
    }
    // Good mixing wants the momentum ratio near unity for unlike doublets.
    if input.element_type == ElementType::UnlikeDoublet && !(0.5..=2.0).contains(&momentum_ratio) {
        flags.push(format!("momentum ratio {momentum_ratio:.2} off-optimal (target ~1)"));
    }
    if extrapolated {
        flags.push(format!(
            "{:?} drop size uses the {:?} line of CR-168066 Fig. 27 (measured for like doublets/triplets)",
            input.element_type, family
        ));
    }

    InjectorFlowResult {
        pressure_drop_pa: dp,
        ox,
        fuel,
        momentum_ratio,
        element_type: input.element_type,
        flags,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::liquids::{LOX, RP1};

    fn input() -> InjectorFlowInput {
        InjectorFlowInput {
            ox: SideInput { flow_kg_s: 1.5, liquid: LOX, phase: Phase::Liquid },
            fuel: SideInput { flow_kg_s: 0.6, liquid: RP1, phase: Phase::Liquid },
            chamber_pressure_pa: 2.0e6,
            dp_fraction: 0.2,
            element_count: 24,
            discharge_coefficient: 0.7,
            gas_density_kg_m3: 2.0,
            element_type: ElementType::UnlikeDoublet,
        }
    }

    #[test]
    fn velocities_and_droplets_are_physical() {
        let r = solve_injector_flow(&input());
        assert!(r.ox.injection_velocity_m_s > 5.0 && r.ox.injection_velocity_m_s < 60.0);
        assert!(r.ox.orifice_diameter_m > 0.0 && r.ox.orifice_diameter_m < 0.01);
        assert!(r.ox.mass_median_diameter_m > 0.0 && r.ox.mass_median_diameter_m < r.ox.orifice_diameter_m);
    }

    #[test]
    fn higher_dp_atomizes_finer() {
        let coarse = solve_injector_flow(&input());
        let fine = solve_injector_flow(&InjectorFlowInput { dp_fraction: 0.4, ..input() });
        assert!(fine.ox.mass_median_diameter_m < coarse.ox.mass_median_diameter_m);
    }

    /// Fig. 27 points read off the figure at d = 1 mm (heptane):
    /// like-impinging ≈ 46 µm, triplet ≈ 19 µm, parallel jets ≈ 104 µm radius.
    #[test]
    fn fig27_digitization_matches_figure() {
        let near = |a: f64, b: f64| (a / b - 1.0).abs() < 0.05;
        assert!(near(uncorrected_drop_radius_um(SprayFamily::ImpingingJets, 0.1), 45.7));
        assert!(near(uncorrected_drop_radius_um(SprayFamily::Triplet, 0.1), 18.8));
        assert!(near(uncorrected_drop_radius_um(SprayFamily::ParallelJets, 0.1), 104.3));
        // Impinging and parallel lines cross near d ≈ 0.9 cm.
        let a = uncorrected_drop_radius_um(SprayFamily::ImpingingJets, 0.9);
        let b = uncorrected_drop_radius_um(SprayFamily::ParallelJets, 0.9);
        assert!((a / b - 1.0).abs() < 0.06, "{a} vs {b}");
    }

    /// Impinging sprays are tens of µm, not hundreds.
    #[test]
    fn drops_are_tens_of_microns() {
        let r = solve_injector_flow(&input());
        let mmd = r.fuel.mass_median_diameter_m * 1e6;
        assert!((20.0..250.0).contains(&mmd), "fuel MMD = {mmd} µm");
    }

    #[test]
    fn gas_side_has_no_drops() {
        let mut i = input();
        i.ox.phase = Phase::Gas;
        assert_eq!(solve_injector_flow(&i).ox.mass_median_diameter_m, 0.0);
    }
}
