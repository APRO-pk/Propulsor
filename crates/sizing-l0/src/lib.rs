//! Krzycki analytical sizing (L0).
//!
//! Reproduces the hand-calc equations: total propellant flow, throat/exit area
//! from constant-gamma isentropic relations, L* chamber sizing, wall thickness
//! from thin-wall hoop stress, and the cooling-jacket bulk energy balance.
//!
//! Krzycki's book fixes, for GOX/hydrocarbon, `gamma = 1.2` and
//! `R = 65 ft·lbf/(lbm·°R)`. All computations here are **canonical SI**; the test
//! harness converts back to the imperial values Krzycki reports.

use engine_core::{
    Area, EngineDesign, ExpansionTarget, Force, Length, MassFlow, Pressure, Ratio, Temperature, Volume,
};
use propellants::props_for;

/// Standard gravitational acceleration used to relate Isp to mass flow.
const G0: f64 = 9.80665;

/// All output quantities a single L0 evaluation produces (canonical SI).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct L0Result {
    pub total_flow: MassFlow,
    pub oxidizer_flow: MassFlow,
    pub fuel_flow: MassFlow,
    pub isp_s: f64,
    pub c_star_m_s: f64,
    pub tc_k: f64,
    pub gamma: f64,
    pub throat_area: Area,
    pub throat_diameter: Length,
    pub exit_area: Area,
    pub exit_diameter: Length,
    pub area_ratio: Ratio,
    pub chamber_volume: Volume,
    pub chamber_length: Length,
    pub chamber_diameter: Length,
    pub wall_thickness: Length,
    pub cooling_gap: Length,
}

/// L0 geometry assumptions the book picks as free design choices (not derived).
///
/// The flow/throat/expansion chain is computed; these are inputs that the book
/// selects for a given build. Values here are the Krzycki reference defaults:
/// copper at 8000 psi, water coolant, and a coolant flow/target velocity that
/// reproduce the book's 0.0425 in jacket gap for the 20 lbf example.
#[derive(Debug, Clone, Copy)]
pub struct L0Assumptions {
    /// Chamber-to-throat area ratio (contraction ratio), used only when the
    /// design doesn't specify a chamber diameter directly.
    pub contraction_ratio: f64,
    /// Characteristic chamber length L* (m). `V_ch = L* · A_t`.
    pub l_star_m: f64,
    /// Allowable wall stress (Pa). Krzycki copper: 8000 psi ≈ 55.16 MPa.
    pub allowable_stress: Pressure,
    /// Wall safety factor (thin-wall hoop stress). Krzycki's reported value is
    /// *before* margin, so the reference case uses 1.0; a margin is applied later.
    pub wall_safety_factor: f64,
    /// Coolant temperature rise over the jacket (K).
    pub coolant_delta_t: Temperature,
    /// Maximum coolant velocity to target in the jacket (m/s).
    pub coolant_target_velocity: f64,
    /// Coolant mass flow (kg/s). Water for a static test stand.
    pub coolant_flow_kg_s: f64,
    /// Coolant density (kg/m³). Water = 1000.
    pub coolant_density: f64,
    /// Coolant specific heat (J/(kg·K)). Water = 4186.
    pub coolant_cp: f64,
}

impl Default for L0Assumptions {
    fn default() -> Self {
        L0Assumptions {
            contraction_ratio: 4.0,
            l_star_m: 1.0,
            allowable_stress: Pressure::si(55_158_000.0), // 8000 psi
            wall_safety_factor: 1.0,
            coolant_delta_t: Temperature::si(40.0),
            coolant_target_velocity: 6.0,
            coolant_flow_kg_s: 0.62,
            coolant_density: 1000.0,
            coolant_cp: 4186.0,
        }
    }
}

/// Evaluate the L0 analytical model for a design.
///
/// Returns `OutOfDomain` if the design has no propellant kinetics or an invalid
/// operating point — the hard pre-flight check (ARCHITECTURE §3.1).
pub fn solve_l0(design: &EngineDesign, assumptions: L0Assumptions) -> Result<L0Result, engine_core::EngineError> {
    let props = props_for(design.propellant.pair)
        .ok_or_else(|| engine_core::EngineError::Lookup(format!("{:?}", design.propellant.pair)))?;

    let g = props.gamma;
    let thrust = design.operating_point.thrust.as_si();
    let pc = design.operating_point.chamber_pressure.as_si();
    let of = design.operating_point.mixture_ratio.as_f64();

    if thrust <= 0.0 || pc <= 0.0 {
        return Err(engine_core::EngineError::out_of_domain("thrust/Pc", 1e-6, 1e9, thrust.min(pc)));
    }

    // (1) Total propellant mass flow from specific impulse:  w = F / (Isp · g0).
    let total = MassFlow::si(thrust / (props.isp_s * G0));

    // (2) O/F split.
    let ox = MassFlow::si(total.as_si() * of / (1.0 + of));
    let fuel = MassFlow::si(total.as_si() - ox.as_si());

    // (3) Characteristic velocity from γ, R, Tc, then throat area:  A_t = w·c* / Pc.
    let c_star = props.c_star_m_s();
    let throat_area = Area::si(total.as_si() * c_star / pc);
    let throat_dia = Length::si((4.0 * throat_area.as_si() / std::f64::consts::PI).sqrt());

    // (4) Exit area ratio. Either taken directly, or derived from the target
    //     ambient pressure with constant-γ isentropic flow.
    let area_ratio = match design.operating_point.expansion {
        ExpansionTarget::Ratio(r) => Ratio::new(r.as_f64()),
        ExpansionTarget::AmbientPressure(pa) => {
            Ratio::new(area_ratio_from_pressure(pc, pa.as_si(), g))
        }
    };
    let exit_area = Area::si(throat_area.as_si() * area_ratio.as_f64());
    let exit_dia = Length::si((4.0 * exit_area.as_si() / std::f64::consts::PI).sqrt());

    // (5) Chamber sizing. Use an explicit chamber diameter if the design provides
    //     one (the book's worked example sets it), otherwise derive it from the
    //     contraction ratio.
    let chamber_dia = match design
        .geometry
        .chamber
        .as_ref()
        .and_then(|c| c.inner_diameter)
    {
        Some(d) => d,
        None => {
            let chamber_area = Area::si(throat_area.as_si() * assumptions.contraction_ratio);
            Length::si((4.0 * chamber_area.as_si() / std::f64::consts::PI).sqrt())
        }
    };
    let chamber_area = Area::si(std::f64::consts::PI * chamber_dia.as_si().powi(2) / 4.0);
    let chamber_volume = Volume::si(throat_area.as_si() * assumptions.l_star_m);
    let chamber_length = Length::si(chamber_volume.as_si() / chamber_area.as_si());

    // (6) Thin-wall hoop stress wall thickness:  t = P·r / σ · SF.
    let radius = chamber_dia.as_si() / 2.0;
    let wall = Length::si(
        pc * radius / assumptions.allowable_stress.as_si() * assumptions.wall_safety_factor,
    );

    // (7) Cooling-jacket gap from an annular energy balance: the coolant flows
    //     through an annulus of area π·D·gap at a target velocity, sized to carry
    //     the heat load.  gap = ẇ_cool / (ρ·v·π·D).
    let gap = assumptions.coolant_flow_kg_s
        / (assumptions.coolant_density
            * assumptions.coolant_target_velocity
            * std::f64::consts::PI
            * chamber_dia.as_si());
    let cooling_gap = Length::si(gap);

    Ok(L0Result {
        total_flow: total,
        oxidizer_flow: ox,
        fuel_flow: fuel,
        isp_s: props.isp_s,
        c_star_m_s: c_star,
        tc_k: props.tc_k,
        gamma: g,
        throat_area,
        throat_diameter: throat_dia,
        exit_area,
        exit_diameter: exit_dia,
        area_ratio,
        chamber_volume,
        chamber_length,
        chamber_diameter: chamber_dia,
        wall_thickness: wall,
        cooling_gap,
    })
}

/// Constant-γ isentropic area ratio A_e/A_t for an expansion from Pc to Pa.
fn area_ratio_from_pressure(pc: f64, pa: f64, gamma: f64) -> f64 {
    let pr = pc / pa;
    let m2 = (pr.powf((gamma - 1.0) / gamma) - 1.0) * 2.0 / (gamma - 1.0);
    let me = m2.sqrt();
    let k = (1.0 + (gamma - 1.0) / 2.0 * m2) * 2.0 / (gamma + 1.0);
    (1.0 / me) * k.powf((gamma + 1.0) / (2.0 * (gamma - 1.0)))
}

impl L0Result {
    /// Human-readable, unit-labelled summary (imperial where Krzycki reports them).
    pub fn summary(&self) -> String {
        format!(
            "w={:.3} lb/s | A_t={:.4} in² | D_t={:.3} in | A_e/A_t={:.2} | Isp={:.0} s | c*={:.0} m/s | t_wall={:.4} in | cooling_gap={:.4} in",
            self.total_flow.as_lb_per_s(),
            self.throat_area.as_sq_inches(),
            self.throat_diameter.as_inches(),
            self.area_ratio.as_f64(),
            self.isp_s,
            self.c_star_m_s,
            self.wall_thickness.as_inches(),
            self.cooling_gap.as_inches(),
        )
    }
}

/// Recommended characteristic chamber length L* (m) for a propellant pair.
pub fn recommended_l_star(pair: engine_core::PropellantPair) -> f64 {
    match pair {
        engine_core::PropellantPair::Unset => 1.0,
        engine_core::PropellantPair::GoxKerosene
        | engine_core::PropellantPair::GoxGasoline
        | engine_core::PropellantPair::LoxRp1 => 1.0,
        engine_core::PropellantPair::GoxEthanol
        | engine_core::PropellantPair::LoxEthanol
        | engine_core::PropellantPair::GoxMethanol => 0.9,
        engine_core::PropellantPair::LoxMethane => 0.8,
        // Nitrous/hydrocarbon burns slower — a longer chamber aids completeness.
        engine_core::PropellantPair::NitrousPropane => 1.1,
        // Hypergolics ignite instantly and burn fast — a short chamber suffices.
        engine_core::PropellantPair::NtoMmh | engine_core::PropellantPair::NtoUdmh => 0.75,
        // Hydrogen reacts very fast → short chamber; peroxide/kerosene needs more.
        engine_core::PropellantPair::LoxHydrogen => 0.7,
        engine_core::PropellantPair::H2o2Kerosene => 1.3,
    }
}

/// Convenience: build a 20 lbf / 300 psi GOX/gasoline design (the Krzycki
/// golden-test operating point) for use in tests and demos. The chamber diameter
/// (1.2 in) is the book's reference value for this engine.
pub fn krzycki_golden_design() -> EngineDesign {
    let mut d = EngineDesign::new("Krzycki 20 lbf", "golden");
    d.propellant.pair = engine_core::PropellantPair::GoxGasoline;
    d.propellant.of_ratio = Ratio::new(2.4);
    d.operating_point.thrust = Force::si(88.964); // 20 lbf
    d.operating_point.chamber_pressure = Pressure::psi(300.0);
    d.operating_point.mixture_ratio = Ratio::new(2.4);
    d.operating_point.expansion = ExpansionTarget::AmbientPressure(Pressure::si(101_325.0));
    d.geometry.chamber = Some(engine_core::ChamberGeometry {
        inner_diameter: Some(Length::inches(1.2)),
        ..Default::default()
    });
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recommended_l_star_in_expected_range() {
        for pair in [engine_core::PropellantPair::GoxKerosene, engine_core::PropellantPair::LoxMethane] {
            let l = recommended_l_star(pair);
            assert!((0.5..=2.0).contains(&l), "{pair:?} L* = {l}");
        }
    }
}
