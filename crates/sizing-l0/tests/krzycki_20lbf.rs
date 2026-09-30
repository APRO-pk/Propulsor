//! Golden test 1 (M1 gate): reproduce Krzycki's 20 lbf / 300 psi GOX/gasoline
//! worked example, intermediate value by intermediate value.
//!
//! Krzycki fixes γ = 1.2 and R = 65 ft·lbf/(lbm·°R). Expected values below are the
//! book's reported numbers; assertions use tolerance because the book rounds to
//! 3 significant figures.

use engine_core::ExpansionTarget;
use sizing_l0::{krzycki_golden_design, solve_l0, L0Assumptions};

fn rel(a: f64, b: f64) -> f64 {
    (a - b).abs() / b.abs().max(1e-12)
}

#[test]
fn reproduces_krzycki_20lbf() {
    let design = krzycki_golden_design();
    let r = solve_l0(&design, L0Assumptions::default()).expect("L0 solve");

    // (1) Total propellant flow: w = F / (Isp · g0).
    let w_lbs = r.total_flow.as_lb_per_s();
    assert!(rel(w_lbs, 0.077) < 0.01, "w = {w_lbs} lb/s, expected ~0.077");

    // (2) Throat area from A_t = w·c*/Pc.
    let at_in2 = r.throat_area.as_sq_inches();
    assert!(rel(at_in2, 0.0444) < 0.01, "A_t = {at_in2} in², expected ~0.0444");

    // (3) Throat diameter from A_t.
    let dt_in = r.throat_diameter.as_inches();
    assert!(rel(dt_in, 0.238) < 0.02, "D_t = {dt_in} in, expected ~0.238");

    // (4) Exit area ratio to sea-level ambient (γ = 1.2).
    let ar = r.area_ratio.as_f64();
    assert!((3.60..=3.78).contains(&ar), "A_e/A_t = {ar}, expected ~3.65");

    // (5) Chamber wall thickness (thin-wall hoop, copper 8000 psi, before margin).
    let tw_in = r.wall_thickness.as_inches();
    assert!(rel(tw_in, 0.0225) < 0.02, "t_wall = {tw_in} in, expected ~0.0225");

    // (6) Cooling-jacket gap (water, annulus at target velocity).
    let gap_in = r.cooling_gap.as_inches();
    assert!(rel(gap_in, 0.0425) < 0.02, "cooling_gap = {gap_in} in, expected ~0.0425");

    // Book value is quoted as 3.65; verify an explicit ratio flows through too.
    let ratio_min = crate_design_with(engine_core::Ratio::new(3.65));
    let r2 = solve_l0(&ratio_min, L0Assumptions::default()).unwrap();
    assert!(rel(r2.area_ratio.as_f64(), 3.65) < 1e-9);
}

#[test]
fn flow_splits_by_mixture_ratio() {
    let design = krzycki_golden_design();
    let r = solve_l0(&design, L0Assumptions::default()).unwrap();
    let of = 2.4;
    let expected_ox = r.total_flow.as_si() * of / (1.0 + of);
    assert!(rel(r.oxidizer_flow.as_si(), expected_ox) < 1e-9);
    assert!(rel(r.fuel_flow.as_si() + r.oxidizer_flow.as_si(), r.total_flow.as_si()) < 1e-9);
}

#[test]
fn zero_or_negative_operating_point_errors() {
    let mut design = krzycki_golden_design();
    design.operating_point.thrust = engine_core::Force::si(0.0);
    assert!(solve_l0(&design, L0Assumptions::default()).is_err());
}

/// Build the same design but fix the expansion ratio explicitly.
/// `design.operating_point.expansion` is private-ish; reconstruct via public API.
fn crate_design_with(expansion: engine_core::Ratio) -> engine_core::EngineDesign {
    let mut d = krzycki_golden_design();
    d.operating_point.expansion = ExpansionTarget::Ratio(expansion);
    d
}
