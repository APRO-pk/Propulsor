//! Spur-gear pair sizing for a turbopump gearbox.
//!
//! When the turbine and a pump want different optimum speeds (common when a
//! single turbine drives both a dense-oxidizer pump and a low-density fuel pump),
//! a reduction gear couples them. This sizes a spur pair from transmitted power
//! and a chosen module, checking tooth bending (Lewis) and surface contact
//! (Hertz) against allowables, and estimates mesh efficiency from tooth friction.

/// Elastic coefficient Z_E for steel-on-steel gears, in √Pa (≈ 191 √MPa).
const Z_E_STEEL: f64 = 191.0e3;

/// Gear input.
#[derive(Debug, Clone)]
pub struct GearInput {
    /// Power transmitted through the mesh, W.
    pub power_w: f64,
    /// Pinion (fast shaft, e.g. turbine) speed, rpm.
    pub input_speed_rpm: f64,
    /// Gear (slow shaft, e.g. pump) speed, rpm.
    pub output_speed_rpm: f64,
    /// Gear module (tooth size) = pitch diameter / number of teeth, m.
    pub module_m: f64,
    /// Number of teeth on the pinion (≥ 17 avoids undercut at 20°).
    pub pinion_teeth: u32,
    /// Pressure angle, degrees (typically 20 or 25).
    pub pressure_angle_deg: f64,
    /// Face width as a multiple of the module (typically 8–16).
    pub face_width_over_module: f64,
    /// Allowable bending stress of the tooth material, Pa.
    pub allowable_bending_pa: f64,
    /// Allowable surface contact stress, Pa.
    pub allowable_contact_pa: f64,
}

/// Gear result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GearResult {
    pub gear_ratio: f64,
    pub pinion_teeth: u32,
    pub gear_teeth: u32,
    pub pinion_pitch_dia_m: f64,
    pub gear_pitch_dia_m: f64,
    pub face_width_m: f64,
    pub pitch_line_velocity_m_s: f64,
    pub tangential_force_n: f64,
    pub bending_stress_pa: f64,
    pub contact_stress_pa: f64,
    pub bending_margin: f64,
    pub contact_margin: f64,
    pub mesh_efficiency: f64,
    pub bending_ok: bool,
    pub contact_ok: bool,
}

impl GearResult {
    pub fn summary(&self) -> String {
        format!(
            "ratio={:.2} ({}→{}T) | σ_b={:.0} MPa ({}) | σ_c={:.0} MPa ({}) | η={:.3}",
            self.gear_ratio,
            self.pinion_teeth,
            self.gear_teeth,
            self.bending_stress_pa / 1e6,
            if self.bending_ok { "OK" } else { "OVER" },
            self.contact_stress_pa / 1e6,
            if self.contact_ok { "OK" } else { "OVER" },
            self.mesh_efficiency,
        )
    }
}

/// Lewis form factor Y for a 20° full-depth involute tooth, approximated as a
/// function of tooth count.
fn lewis_form_factor(teeth: f64) -> f64 {
    (0.154 - 0.912 / teeth).max(0.05)
}

/// Size a spur-gear pair and check bending and contact stress.
pub fn solve_gear(input: &GearInput) -> GearResult {
    let ratio = (input.input_speed_rpm / input.output_speed_rpm.max(1e-9)).max(1.0);
    let z_p = input.pinion_teeth.max(1);
    // Round the gear tooth count to the nearest integer from the ratio.
    let z_g = ((z_p as f64) * ratio).round().max(z_p as f64) as u32;

    let d_p = input.module_m * z_p as f64;
    let d_g = input.module_m * z_g as f64;
    let face = input.face_width_over_module * input.module_m;

    let omega_p = 2.0 * std::f64::consts::PI * input.input_speed_rpm / 60.0;
    // Pitch-line velocity and tangential (transmitted) force.
    let v = omega_p * d_p / 2.0;
    let torque_p = input.power_w / omega_p.max(1e-9);
    let w_t = 2.0 * torque_p / d_p.max(1e-9);

    // Dynamic (velocity) factor, √-form Barth for high-precision ground gears
    // (well-behaved at the high pitch-line speeds typical of turbopump drives).
    let k_v = (5.6 + v.sqrt()) / 5.6;

    // Lewis bending stress on the (weaker) pinion, with the dynamic factor.
    let y = lewis_form_factor(z_p as f64);
    let bending = w_t * k_v / (face * input.module_m * y);

    // Hertz surface-contact stress (AGMA form). Geometry factor I for external
    // gears: I = (cosφ·sinφ / 2) · m_G/(m_G+1).
    let phi = input.pressure_angle_deg.to_radians();
    let i_geom = (phi.cos() * phi.sin() / 2.0) * (ratio / (ratio + 1.0));
    let contact = Z_E_STEEL * (w_t * k_v / (face * d_p * i_geom.max(1e-6))).sqrt();

    // Mesh efficiency from sliding friction, scaling with 1/z (Merritt approx).
    let mu = 0.06;
    let mesh_efficiency =
        (1.0 - mu * std::f64::consts::PI * (1.0 / z_p as f64 + 1.0 / z_g as f64)).clamp(0.0, 1.0);

    GearResult {
        gear_ratio: z_g as f64 / z_p as f64,
        pinion_teeth: z_p,
        gear_teeth: z_g,
        pinion_pitch_dia_m: d_p,
        gear_pitch_dia_m: d_g,
        face_width_m: face,
        pitch_line_velocity_m_s: v,
        tangential_force_n: w_t,
        bending_stress_pa: bending,
        contact_stress_pa: contact,
        bending_margin: input.allowable_bending_pa / bending.max(1.0),
        contact_margin: input.allowable_contact_pa / contact.max(1.0),
        mesh_efficiency,
        bending_ok: bending <= input.allowable_bending_pa,
        contact_ok: contact <= input.allowable_contact_pa,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gear_input() -> GearInput {
        GearInput {
            power_w: 200.0e3,
            input_speed_rpm: 12_000.0,
            output_speed_rpm: 8_000.0,
            module_m: 4.0e-3,
            pinion_teeth: 24,
            pressure_angle_deg: 20.0,
            face_width_over_module: 14.0,
            allowable_bending_pa: 350.0e6,
            allowable_contact_pa: 1300.0e6,
        }
    }

    #[test]
    fn gear_ratio_and_geometry() {
        let r = solve_gear(&gear_input());
        assert!((r.gear_ratio - 1.5).abs() < 0.05, "ratio = {}", r.gear_ratio);
        assert_eq!(r.gear_teeth, 36);
        assert!(r.gear_pitch_dia_m > r.pinion_pitch_dia_m);
        assert!(r.tangential_force_n > 0.0);
    }

    #[test]
    fn stresses_and_efficiency_sane() {
        let r = solve_gear(&gear_input());
        assert!(r.bending_stress_pa > 0.0);
        assert!(r.contact_stress_pa > r.bending_stress_pa, "contact should exceed bending");
        assert!(r.bending_ok && r.contact_ok, "a reasonable design should pass: {}", r.summary());
        assert!(r.mesh_efficiency > 0.95 && r.mesh_efficiency < 1.0, "η = {}", r.mesh_efficiency);
    }

    #[test]
    fn tiny_module_overstresses() {
        let mut inp = gear_input();
        inp.module_m = 0.5e-3;
        let r = solve_gear(&inp);
        assert!(!r.bending_ok || !r.contact_ok, "a tiny tooth should overstress");
    }
}
