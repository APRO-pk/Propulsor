//! Injector fluid-flow simulation.
//!
//! A first-principles orifice-flow model (not a CFD solve, but resolving the real
//! flow quantities): discharge-coefficient velocity, per-orifice sizing, the
//! oxidizer/fuel momentum ratio for impinging elements, and the Sauter mean
//! droplet diameter from a Weber-number atomization correlation.

/// Injector element type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ElementType {
    LikeDoublet,
    UnlikeDoublet,
    Coaxial,
    Pintle,
}

/// Injector flow input.
#[derive(Debug, Clone)]
pub struct InjectorFlowInput {
    pub ox_flow_kg_s: f64,
    pub fuel_flow_kg_s: f64,
    pub ox_density_kg_m3: f64,
    pub fuel_density_kg_m3: f64,
    pub chamber_pressure_pa: f64,
    /// Injector pressure-drop fraction of chamber pressure (0.15–0.25 typical).
    pub dp_fraction: f64,
    pub element_count: u32,
    /// Orifice discharge coefficient (~0.6–0.8).
    pub discharge_coefficient: f64,
    /// Propellant surface tension, N/m (atomization).
    pub surface_tension_n_m: f64,
    /// Chamber gas density, kg/m³ (for the aerodynamic Weber number).
    pub gas_density_kg_m3: f64,
    pub element_type: ElementType,
}

/// One propellant side's orifice flow.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SideFlow {
    pub injection_velocity_m_s: f64,
    pub orifice_diameter_m: f64,
    pub weber_number: f64,
    pub sauter_mean_diameter_m: f64,
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
            "ΔP={:.0} kPa | v_ox={:.0} v_fu={:.0} m/s | SMD_ox={:.0} µm | MR_mom={:.2}",
            self.pressure_drop_pa / 1000.0,
            self.ox.injection_velocity_m_s,
            self.fuel.injection_velocity_m_s,
            self.ox.sauter_mean_diameter_m * 1e6,
            self.momentum_ratio,
        )
    }
}

fn side_flow(
    mdot: f64,
    density: f64,
    dp: f64,
    n: f64,
    cd: f64,
    sigma: f64,
    gas_density: f64,
) -> SideFlow {
    // Bernoulli orifice velocity with a discharge coefficient.
    let v = cd * (2.0 * dp / density).sqrt();
    // Total effective orifice area from continuity, split over n elements.
    let area_total = mdot / (density * v).max(1e-9);
    let area_each = area_total / n.max(1.0);
    let d = (4.0 * area_each / std::f64::consts::PI).sqrt();
    // Aerodynamic Weber number and a SMD/d = C·We^-0.4 atomization correlation.
    let we = gas_density * v * v * d / sigma.max(1e-6);
    let smd = d * 3.0 * we.max(1.0).powf(-0.4);
    SideFlow {
        injection_velocity_m_s: v,
        orifice_diameter_m: d,
        weber_number: we,
        sauter_mean_diameter_m: smd,
    }
}

/// Solve the injector flow for both propellant sides.
pub fn solve_injector_flow(input: &InjectorFlowInput) -> InjectorFlowResult {
    let dp = input.dp_fraction * input.chamber_pressure_pa;
    let n = input.element_count as f64;
    let ox = side_flow(input.ox_flow_kg_s, input.ox_density_kg_m3, dp, n, input.discharge_coefficient, input.surface_tension_n_m, input.gas_density_kg_m3);
    let fuel = side_flow(input.fuel_flow_kg_s, input.fuel_density_kg_m3, dp, n, input.discharge_coefficient, input.surface_tension_n_m, input.gas_density_kg_m3);

    // Oxidizer/fuel momentum ratio (impinging-element mixing quality).
    let momentum_ratio = (input.ox_flow_kg_s * ox.injection_velocity_m_s)
        / (input.fuel_flow_kg_s * fuel.injection_velocity_m_s).max(1e-9);

    let mut flags = Vec::new();
    if !(0.15..=0.25).contains(&input.dp_fraction) {
        flags.push(format!("ΔP/Pc = {:.2} outside 0.15–0.25", input.dp_fraction));
    }
    if !(15.0..=60.0).contains(&ox.injection_velocity_m_s) {
        flags.push(format!("ox injection velocity {:.0} m/s outside 15–60", ox.injection_velocity_m_s));
    }
    // Good mixing wants the momentum ratio near unity for unlike doublets.
    if input.element_type == ElementType::UnlikeDoublet && !(0.5..=2.0).contains(&momentum_ratio) {
        flags.push(format!("momentum ratio {momentum_ratio:.2} off-optimal (target ~1)"));
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

    fn input() -> InjectorFlowInput {
        InjectorFlowInput {
            ox_flow_kg_s: 1.5,
            fuel_flow_kg_s: 0.6,
            ox_density_kg_m3: 1140.0,
            fuel_density_kg_m3: 810.0,
            chamber_pressure_pa: 2.0e6,
            dp_fraction: 0.2,
            element_count: 24,
            discharge_coefficient: 0.7,
            surface_tension_n_m: 0.02,
            gas_density_kg_m3: 2.0,
            element_type: ElementType::UnlikeDoublet,
        }
    }

    #[test]
    fn velocities_and_droplets_are_physical() {
        let r = solve_injector_flow(&input());
        assert!(r.ox.injection_velocity_m_s > 5.0 && r.ox.injection_velocity_m_s < 60.0);
        assert!(r.ox.orifice_diameter_m > 0.0 && r.ox.orifice_diameter_m < 0.01);
        assert!(r.ox.sauter_mean_diameter_m > 0.0 && r.ox.sauter_mean_diameter_m < r.ox.orifice_diameter_m);
    }

    #[test]
    fn higher_dp_atomizes_finer() {
        let coarse = solve_injector_flow(&input());
        let fine = solve_injector_flow(&InjectorFlowInput { dp_fraction: 0.4, ..input() });
        assert!(fine.ox.sauter_mean_diameter_m < coarse.ox.sauter_mean_diameter_m);
    }
}
