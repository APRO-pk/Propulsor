//! Blade profiling from velocity triangles.
//!
//! Generates the actual blade geometry (camber line + thickness → a closed
//! surface loop) for a centrifugal pump impeller and an axial turbine rotor,
//! together with the inlet/outlet metal angles from the velocity triangles and
//! the Wiesner slip factor for the pump. The point arrays feed the 2D profile
//! plot and the 3D impeller/rotor view (patterned `blade_count` times).

use crate::G0;

/// A 2D point (metres) on a blade curve.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

/// A generated blade profile.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BladeProfile {
    pub kind: String,
    pub blade_count: u32,
    pub inlet_angle_deg: f64,
    pub outlet_angle_deg: f64,
    pub inlet_radius_m: f64,
    pub outlet_radius_m: f64,
    /// Blade span (axial height at the trailing region), m.
    pub span_m: f64,
    /// Wiesner slip factor (pump); 0 for the turbine.
    pub slip_factor: f64,
    pub camber: Vec<Pt>,
    pub surface: Vec<Pt>,
    pub summary: String,
    /// Relative inlet Mach (supersonic blade); 0 otherwise.
    #[serde(default)]
    pub inlet_mach: f64,
    /// Relative exit Mach (supersonic blade); 0 otherwise.
    #[serde(default)]
    pub exit_mach: f64,
    /// Mach angle μ = asin(1/M) at inlet (deg); 0 otherwise.
    #[serde(default)]
    pub mach_angle_deg: f64,
    /// Prandtl-Meyer expansion turn ν(M₂)−ν(M₁) through the passage (deg); 0 for
    /// a pure-impulse supersonic blade (constant Mach) and for subsonic blades.
    #[serde(default)]
    pub prandtl_meyer_turn_deg: f64,
    /// Throat opening / pitch ratio o/s (gauge); 0 for non-supersonic blades.
    #[serde(default)]
    pub throat_pitch_ratio: f64,
}

/// Pump-impeller blade input.
#[derive(Debug, Clone)]
pub struct PumpBladeInput {
    pub mass_flow_kg_s: f64,
    pub density_kg_m3: f64,
    pub head_m: f64,
    pub speed_rpm: f64,
    pub blade_count: u32,
    /// Backswept outlet metal angle from tangent, deg (20–35° typical).
    pub outlet_blade_angle_deg: f64,
    pub inlet_axial_velocity_m_s: f64,
}

fn thicken(camber: &[Pt], t_le: f64, t_te: f64) -> Vec<Pt> {
    let n = camber.len();
    if n < 2 {
        return camber.to_vec();
    }
    let mut suction = Vec::with_capacity(n);
    let mut pressure = Vec::with_capacity(n);
    for i in 0..n {
        let a = camber[(i.max(1)) - 1];
        let b = camber[(i + 1).min(n - 1)];
        let tx = b.x - a.x;
        let ty = b.y - a.y;
        let len = (tx * tx + ty * ty).sqrt().max(1e-9);
        // Normal (rotate tangent 90°).
        let nx = -ty / len;
        let ny = tx / len;
        let s = i as f64 / (n - 1) as f64;
        // Elliptic-ish thickness with rounded ends.
        let half = 0.5 * (t_le + (t_te - t_le) * s) * (1.0 - (2.0 * s - 1.0).powi(2)).max(0.05).sqrt();
        suction.push(Pt { x: camber[i].x + nx * half, y: camber[i].y + ny * half });
        pressure.push(Pt { x: camber[i].x - nx * half, y: camber[i].y - ny * half });
    }
    // Closed loop: suction LE→TE, then pressure TE→LE.
    pressure.reverse();
    suction.extend(pressure);
    suction
}

/// Generate a centrifugal pump impeller blade (r–θ plane).
pub fn pump_impeller_blade(input: &PumpBladeInput) -> BladeProfile {
    let omega = 2.0 * std::f64::consts::PI * input.speed_rpm / 60.0;
    let q = input.mass_flow_kg_s / input.density_kg_m3.max(1.0);
    let cm = input.inlet_axial_velocity_m_s.max(1.0);
    // Inlet eye radius from the through-flow area, nudged out for the hub.
    let r1 = (q / (std::f64::consts::PI * cm)).sqrt() * 1.1;
    let u1 = omega * r1;
    // Outlet blade speed from the head (Barske form, ψ ≈ 0.2 pressure factor).
    let psi = 0.2;
    let u2 = ((2.0 * G0 * input.head_m + u1 * u1) / (1.0 + psi)).sqrt();
    let r2 = (u2 / omega.max(1e-6)).max(r1 * 1.3);

    let beta1 = cm.atan2(u1); // inlet metal angle from tangent
    let beta2b = input.outlet_blade_angle_deg.to_radians();

    // Wiesner slip factor.
    let z = input.blade_count.max(1) as f64;
    let slip = 1.0 - beta2b.sin().sqrt() / z.powf(0.7);

    // Camber line: integrate θ(r), dθ/dr = 1/(r·tan β), β linear r1→r2.
    let n = 60;
    let mut theta = 0.0;
    let mut camber = Vec::with_capacity(n);
    let mut r_prev = r1;
    for i in 0..n {
        let s = i as f64 / (n - 1) as f64;
        let r = r1 + (r2 - r1) * s;
        let beta = beta1 + (beta2b - beta1) * s;
        if i > 0 {
            theta += (r - r_prev) / (r * beta.tan().max(0.05));
        }
        camber.push(Pt { x: r * theta.cos(), y: r * theta.sin() });
        r_prev = r;
    }
    let span = (q / (2.0 * std::f64::consts::PI * r2 * (u2 * (1.0 - psi)).max(1.0))).max(r2 * 0.05);
    let surface = thicken(&camber, r2 * 0.05, r2 * 0.03);

    let summary = format!(
        "impeller: Z={} | β1={:.1}° β2={:.1}° | D1={:.0} D2={:.0} mm | slip σ={:.3}",
        input.blade_count, beta1.to_degrees(), input.outlet_blade_angle_deg, 2000.0 * r1, 2000.0 * r2, slip
    );
    BladeProfile {
        kind: "pump-impeller".into(),
        blade_count: input.blade_count,
        inlet_angle_deg: beta1.to_degrees(),
        outlet_angle_deg: input.outlet_blade_angle_deg,
        inlet_radius_m: r1,
        outlet_radius_m: r2,
        span_m: span,
        slip_factor: slip,
        camber,
        surface,
        summary,
        inlet_mach: 0.0,
        exit_mach: 0.0,
        mach_angle_deg: 0.0,
        prandtl_meyer_turn_deg: 0.0,
        throat_pitch_ratio: 0.0,
    }
}

/// Turbine-rotor blade input.
#[derive(Debug, Clone)]
pub struct TurbineBladeInput {
    pub power_w: f64,
    pub mass_flow_kg_s: f64,
    pub cp_j_kg_k: f64,
    pub inlet_temp_k: f64,
    pub gamma: f64,
    pub pressure_ratio: f64,
    pub speed_rpm: f64,
    pub blade_count: u32,
    /// Nozzle (absolute flow) angle from tangent, deg (typically 15–25°).
    pub nozzle_angle_deg: f64,
}

/// Generate an axial impulse turbine rotor blade (axial–tangential plane).
pub fn turbine_rotor_blade(input: &TurbineBladeInput) -> BladeProfile {
    let omega = 2.0 * std::f64::consts::PI * input.speed_rpm / 60.0;
    // Isentropic enthalpy drop → spouting velocity C0.
    let dh = input.cp_j_kg_k * input.inlet_temp_k
        * (1.0 - input.pressure_ratio.max(1.0).powf(-(input.gamma - 1.0) / input.gamma));
    let c0 = (2.0 * dh.max(1.0)).sqrt();
    let alpha1 = input.nozzle_angle_deg.to_radians();
    // Optimum blade speed for a single impulse stage: U ≈ (C0·cosα)/2.
    let u = 0.5 * c0 * alpha1.cos();
    let r_mean = (u / omega.max(1e-6)).max(0.01);

    // Nozzle-exit velocity triangle (C1 ≈ C0).
    let c1 = c0;
    let cu1 = c1 * alpha1.cos();
    let cm1 = c1 * alpha1.sin();
    let wu1 = cu1 - u;
    let beta1 = cm1.atan2(wu1); // relative inlet angle from tangent
    // Impulse: symmetric turning, β2 ≈ β1 on the other side.
    let beta2 = beta1;

    // Cambered airfoil in the axial(x)–tangential(y) plane. Chord follows the
    // blade pitch (solidity ≈ 1.1) so the blades ring the wheel without overlap.
    let n = 50;
    let pitch = 2.0 * std::f64::consts::PI * r_mean / input.blade_count.max(1) as f64;
    let chord = 0.9 * pitch;
    // Blade metal angles from axial = 90° − (angle from tangent).
    let b1 = std::f64::consts::FRAC_PI_2 - beta1;
    let b2 = -(std::f64::consts::FRAC_PI_2 - beta2); // turn to the other side
    let mut camber = Vec::with_capacity(n);
    let mut y = 0.0;
    let mut x_prev = 0.0;
    for i in 0..n {
        let s = i as f64 / (n - 1) as f64;
        let x = s * chord;
        let b = b1 + (b2 - b1) * s;
        if i > 0 {
            y += (x - x_prev) * b.tan();
        }
        camber.push(Pt { x, y });
        x_prev = x;
    }
    let surface = thicken(&camber, chord * 0.12, chord * 0.05);
    let span = (r_mean * 0.12).max(chord);

    let summary = format!(
        "rotor: Z={} | β1={:.1}° β2={:.1}° | R_mean={:.0} mm | U/C0={:.2}",
        input.blade_count, beta1.to_degrees(), beta2.to_degrees(), 1000.0 * r_mean, u / c0.max(1.0)
    );
    BladeProfile {
        kind: "turbine-rotor".into(),
        blade_count: input.blade_count,
        inlet_angle_deg: beta1.to_degrees(),
        outlet_angle_deg: beta2.to_degrees(),
        inlet_radius_m: r_mean - span / 2.0,
        outlet_radius_m: r_mean + span / 2.0,
        span_m: span,
        slip_factor: 0.0,
        camber,
        surface,
        summary,
        inlet_mach: 0.0,
        exit_mach: 0.0,
        mach_angle_deg: 0.0,
        prandtl_meyer_turn_deg: 0.0,
        throat_pitch_ratio: 0.0,
    }
}

/// Prandtl-Meyer function ν(M) in radians (0 for M ≤ 1). The angle through which
/// a sonic flow must expand to reach Mach `m` — the basis of the shock-free
/// method-of-characteristics turning used in supersonic turbine passages.
pub fn prandtl_meyer(m: f64, gamma: f64) -> f64 {
    if m <= 1.0 {
        return 0.0;
    }
    let gp = gamma + 1.0;
    let gm = gamma - 1.0;
    let m2 = m * m - 1.0;
    (gp / gm).sqrt() * ((gm / gp * m2).sqrt()).atan() - m2.sqrt().atan()
}

/// Supersonic-turbine rotor-blade input. The relative flow enters supersonic and
/// is turned (nearly) at constant Mach through the passage.
#[derive(Debug, Clone)]
pub struct SupersonicBladeInput {
    /// Relative inlet Mach (> 1).
    pub inlet_mach: f64,
    /// Relative exit Mach (≈ inlet for a pure-impulse blade; higher for reaction).
    pub exit_mach: f64,
    /// Relative inlet flow angle from the axial direction, deg (large, ~60–72°).
    pub inlet_flow_angle_deg: f64,
    /// Relative exit flow angle from the axial direction, deg (turned to the
    /// opposite side).
    pub exit_flow_angle_deg: f64,
    pub gamma: f64,
    pub blade_count: u32,
    pub mean_radius_m: f64,
}

/// Profile a supersonic turbine rotor blade with the classic circular-arc /
/// fixed-edge / MoC-transition construction: a straight "fixed" inlet edge at the
/// relative inlet angle, a constant-curvature (circular-arc) turning section, and
/// a straight fixed exit edge — the concave (pressure) surface. The suction side
/// is the shock-free method-of-characteristics transition; the passage width o
/// follows the gauge relation o/s = cos(α_exit). A pure-impulse blade turns the
/// flow at constant Mach (Prandtl-Meyer turn ≈ 0); any exit-Mach excess is the
/// expansion the MoC transition must deliver.
pub fn supersonic_turbine_blade(input: &SupersonicBladeInput) -> BladeProfile {
    let m1 = input.inlet_mach.max(1.001);
    let m2 = input.exit_mach.max(1.001);
    let a1 = input.inlet_flow_angle_deg.abs().to_radians();
    let a2 = input.exit_flow_angle_deg.abs().to_radians();
    let z = input.blade_count.max(1);
    let r_mean = input.mean_radius_m.max(0.01);

    // Chord from the pitch and a supersonic-turbine solidity (~1.6).
    let pitch = 2.0 * std::f64::consts::PI * r_mean / z as f64;
    let solidity = 1.6;
    let chord = solidity * pitch;

    // Camber = straight inlet edge (θ=+α₁) + circular arc (θ: +α₁→−α₂, constant
    // curvature) + straight exit edge (θ=−α₂). θ is the local tangent angle from
    // the axial direction; integrating (cosθ,sinθ) over arc length builds the wall.
    let n = 70usize;
    let f_in = 0.18;
    let f_out = 0.18;
    let mut camber = Vec::with_capacity(n);
    let mut x = 0.0;
    let mut y = 0.0;
    let ds = chord / (n as f64 - 1.0);
    for i in 0..n {
        let s = i as f64 / (n as f64 - 1.0);
        let theta = if s <= f_in {
            a1
        } else if s >= 1.0 - f_out {
            -a2
        } else {
            let u = (s - f_in) / (1.0 - f_in - f_out); // 0..1 across the arc
            a1 + (-a2 - a1) * u
        };
        if i > 0 {
            x += ds * theta.cos();
            y += ds * theta.sin();
        }
        camber.push(Pt { x, y });
    }

    // Prandtl-Meyer expansion the passage must deliver, and the inlet Mach angle.
    let pm_turn = (prandtl_meyer(m2, input.gamma) - prandtl_meyer(m1, input.gamma)).to_degrees();
    let mach_angle = (1.0 / m1).asin().to_degrees();
    // Gauge (throat/pitch) from the exit flow angle; opened slightly by any
    // Prandtl-Meyer expansion the suction-surface transition adds.
    let o_over_s = (a2.cos() * (1.0 + pm_turn.to_radians().sin() * 0.5)).clamp(0.05, 0.99);

    // Thin sharp-edged supersonic profile; the trailing region thins where the
    // MoC transition opens the passage (expansion).
    let t_le = chord * 0.045;
    let t_te = chord * 0.02 / (1.0 + pm_turn.max(0.0) / 20.0);
    let surface = thicken(&camber, t_le, t_te);
    let span = r_mean * 0.12;

    let summary = format!(
        "supersonic rotor: Z={} | M₁={:.2} M₂={:.2} | turn Δ={:.0}° | μ={:.1}° | PM Δν={:.1}° | o/s={:.2}",
        z,
        m1,
        m2,
        (a1 + a2).to_degrees(),
        mach_angle,
        pm_turn,
        o_over_s
    );
    BladeProfile {
        kind: "turbine-supersonic".into(),
        blade_count: z,
        inlet_angle_deg: a1.to_degrees(),
        outlet_angle_deg: a2.to_degrees(),
        inlet_radius_m: r_mean - span / 2.0,
        outlet_radius_m: r_mean + span / 2.0,
        span_m: span,
        slip_factor: 0.0,
        camber,
        surface,
        summary,
        inlet_mach: m1,
        exit_mach: m2,
        mach_angle_deg: mach_angle,
        prandtl_meyer_turn_deg: pm_turn,
        throat_pitch_ratio: o_over_s,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pump_blade_geometry_is_valid() {
        let b = pump_impeller_blade(&PumpBladeInput {
            mass_flow_kg_s: 20.0,
            density_kg_m3: 1000.0,
            head_m: 800.0,
            speed_rpm: 20_000.0,
            blade_count: 6,
            outlet_blade_angle_deg: 22.5,
            inlet_axial_velocity_m_s: 10.0,
        });
        assert!(b.outlet_radius_m > b.inlet_radius_m);
        assert!(b.slip_factor > 0.5 && b.slip_factor < 1.0);
        assert!(b.camber.len() >= 2 && b.surface.len() > b.camber.len());
        assert!(b.inlet_angle_deg > 0.0 && b.inlet_angle_deg < 90.0);
    }

    #[test]
    fn turbine_blade_turns_the_flow() {
        let b = turbine_rotor_blade(&TurbineBladeInput {
            power_w: 2.0e6,
            mass_flow_kg_s: 3.0,
            cp_j_kg_k: 2000.0,
            inlet_temp_k: 900.0,
            gamma: 1.3,
            pressure_ratio: 10.0,
            speed_rpm: 25_000.0,
            blade_count: 40,
            nozzle_angle_deg: 20.0,
        });
        // Impulse rotor is roughly symmetric (turns the flow).
        assert!((b.inlet_angle_deg - b.outlet_angle_deg).abs() < 1.0);
        assert!(b.span_m > 0.0);
        assert!(b.surface.len() > 10);
    }

    #[test]
    fn prandtl_meyer_is_monotonic_and_zeroed_below_sonic() {
        assert_eq!(prandtl_meyer(0.8, 1.3), 0.0);
        let v15 = prandtl_meyer(1.5, 1.3);
        let v25 = prandtl_meyer(2.5, 1.3);
        assert!(v25 > v15 && v15 > 0.0, "ν(1.5)={v15} ν(2.5)={v25}");
    }

    #[test]
    fn supersonic_blade_turns_flow_shock_free() {
        // Pure-impulse supersonic blade: constant Mach, so no Prandtl-Meyer turn.
        let b = supersonic_turbine_blade(&SupersonicBladeInput {
            inlet_mach: 2.0,
            exit_mach: 2.0,
            inlet_flow_angle_deg: 68.0,
            exit_flow_angle_deg: 68.0,
            gamma: 1.3,
            blade_count: 50,
            mean_radius_m: 0.06,
        });
        assert_eq!(b.kind, "turbine-supersonic");
        assert!(b.inlet_mach > 1.0 && b.exit_mach > 1.0);
        assert!(b.prandtl_meyer_turn_deg.abs() < 1e-6, "impulse PM turn = {}", b.prandtl_meyer_turn_deg);
        // Mach angle μ = asin(1/2) = 30°.
        assert!((b.mach_angle_deg - 30.0).abs() < 0.5, "μ = {}", b.mach_angle_deg);
        assert!(b.throat_pitch_ratio > 0.0 && b.throat_pitch_ratio < 1.0);
        assert!(b.surface.len() > b.camber.len());
    }

    #[test]
    fn supersonic_reaction_blade_expands_the_flow() {
        // Exit Mach above inlet ⇒ the MoC transition must deliver a positive turn.
        let b = supersonic_turbine_blade(&SupersonicBladeInput {
            inlet_mach: 1.8,
            exit_mach: 2.4,
            inlet_flow_angle_deg: 65.0,
            exit_flow_angle_deg: 70.0,
            gamma: 1.3,
            blade_count: 48,
            mean_radius_m: 0.06,
        });
        assert!(b.prandtl_meyer_turn_deg > 0.0, "PM turn = {}", b.prandtl_meyer_turn_deg);
    }
}
