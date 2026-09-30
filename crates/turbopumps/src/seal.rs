//! Shaft-seal design: face (mechanical) seals and labyrinth seals.
//!
//! A turbopump seals the pumped propellant at the impeller back face (usually a
//! rubbing face seal) and the hot turbine gas at the shaft penetration (usually a
//! non-contacting labyrinth). This sizes both: the face seal against its PV limit
//! with a thin-film leakage estimate, and the labyrinth via Martin's compressible
//! leakage equation across `n` teeth.

/// Which seal to size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SealKind {
    /// Rubbing mechanical face seal (low leakage, PV-limited).
    Face,
    /// Non-contacting labyrinth seal (gas, leakage across teeth).
    Labyrinth,
}

/// Seal input.
#[derive(Debug, Clone)]
pub struct SealInput {
    pub kind: SealKind,
    pub shaft_diameter_m: f64,
    pub speed_rpm: f64,
    /// Sealed (upstream) pressure, Pa.
    pub sealed_pressure_pa: f64,
    /// Downstream (leak-to) pressure, Pa.
    pub downstream_pressure_pa: f64,

    // --- Face-seal parameters ---
    /// Radial face width, m (Face).
    pub face_width_m: f64,
    /// Sealed-fluid dynamic viscosity, Pa·s (Face leakage film).
    pub fluid_viscosity_pa_s: f64,
    /// Lubricating film thickness, m (Face; ~1 µm typical).
    pub film_thickness_m: f64,
    /// PV limit of the seal face pairing, Pa·(m/s) (Face).
    pub pv_limit_pa_m_s: f64,

    // --- Labyrinth parameters ---
    /// Number of sealing teeth (Labyrinth).
    pub num_teeth: u32,
    /// Radial tip clearance, m (Labyrinth).
    pub clearance_m: f64,
    /// Gas constant of the sealed gas, J/(kg·K) (Labyrinth).
    pub gas_constant_j_kg_k: f64,
    /// Gas temperature, K (Labyrinth).
    pub gas_temp_k: f64,
    /// Discharge (flow) coefficient of the labyrinth throttling (Labyrinth; ~0.7).
    pub discharge_coefficient: f64,
}

/// Seal result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SealResult {
    pub kind: SealKind,
    pub sliding_velocity_m_s: f64,
    /// Face PV value, Pa·(m/s) (0 for labyrinth).
    pub pv_value_pa_m_s: f64,
    pub pv_ok: bool,
    pub leakage_kg_s: f64,
}

impl SealResult {
    pub fn summary(&self) -> String {
        match self.kind {
            SealKind::Face => format!(
                "face | v={:.1} m/s | PV={:.2} MPa·m/s ({}) | leak={:.2e} kg/s",
                self.sliding_velocity_m_s,
                self.pv_value_pa_m_s / 1e6,
                if self.pv_ok { "OK" } else { "OVER" },
                self.leakage_kg_s,
            ),
            SealKind::Labyrinth => format!(
                "labyrinth | v={:.1} m/s | leak={:.4} kg/s",
                self.sliding_velocity_m_s, self.leakage_kg_s,
            ),
        }
    }
}

/// Size a shaft seal and estimate its leakage.
pub fn solve_seal(input: &SealInput) -> SealResult {
    let v = std::f64::consts::PI * input.shaft_diameter_m * input.speed_rpm / 60.0;
    let dp = (input.sealed_pressure_pa - input.downstream_pressure_pa).max(0.0);

    match input.kind {
        SealKind::Face => {
            // PV limit governs face wear/heat.
            let pv = input.sealed_pressure_pa * v;
            // Radial laminar leakage across the sealing dam (parallel-plate film):
            // Q = π·D·h³·ΔP / (12·μ·b), converted to mass with an assumed density
            // proxy via the film — reported as a volumetric-to-mass estimate using
            // the sealed liquid. Here we return the volumetric leak times a nominal
            // 1000 kg/m³ if no better density is known via viscosity alone.
            let mu = input.fluid_viscosity_pa_s.max(1e-6);
            let b = input.face_width_m.max(1e-6);
            let q_vol = std::f64::consts::PI * input.shaft_diameter_m * input.film_thickness_m.powi(3)
                * dp
                / (12.0 * mu * b);
            // Liquid-propellant density proxy (kg/m³) for the mass-leak estimate.
            let rho_proxy = 1000.0;
            SealResult {
                kind: SealKind::Face,
                sliding_velocity_m_s: v,
                pv_value_pa_m_s: pv,
                pv_ok: pv <= input.pv_limit_pa_m_s,
                leakage_kg_s: q_vol * rho_proxy,
            }
        }
        SealKind::Labyrinth => {
            // Martin's compressible leakage across n teeth:
            // ṁ = Cd·A·sqrt[ (P1² − P2²) / (R·T·(n + ln(P1/P2))) ].
            let area = std::f64::consts::PI * input.shaft_diameter_m * input.clearance_m;
            let p1 = input.sealed_pressure_pa.max(1.0);
            let p2 = input.downstream_pressure_pa.max(1.0);
            let n = input.num_teeth.max(1) as f64;
            let denom = input.gas_constant_j_kg_k.max(1.0) * input.gas_temp_k.max(1.0)
                * (n + (p1 / p2).ln());
            let leak = input.discharge_coefficient * area * ((p1 * p1 - p2 * p2) / denom).sqrt();
            SealResult {
                kind: SealKind::Labyrinth,
                sliding_velocity_m_s: v,
                pv_value_pa_m_s: 0.0,
                pv_ok: true,
                leakage_kg_s: leak,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face() -> SealInput {
        SealInput {
            kind: SealKind::Face,
            shaft_diameter_m: 0.05,
            speed_rpm: 15_000.0,
            sealed_pressure_pa: 1.0e7,
            downstream_pressure_pa: 1.0e5,
            face_width_m: 3.0e-3,
            fluid_viscosity_pa_s: 1.0e-3,
            film_thickness_m: 1.0e-6,
            pv_limit_pa_m_s: 3.5e6 * 40.0,
            num_teeth: 0,
            clearance_m: 0.0,
            gas_constant_j_kg_k: 0.0,
            gas_temp_k: 0.0,
            discharge_coefficient: 0.0,
        }
    }

    #[test]
    fn face_seal_pv_and_leak() {
        let r = solve_seal(&face());
        assert!(r.sliding_velocity_m_s > 0.0);
        assert!(r.pv_value_pa_m_s > 0.0);
        assert!(r.leakage_kg_s >= 0.0);
    }

    #[test]
    fn labyrinth_leak_drops_with_more_teeth() {
        let base = SealInput {
            kind: SealKind::Labyrinth,
            shaft_diameter_m: 0.05,
            speed_rpm: 20_000.0,
            sealed_pressure_pa: 4.0e6,
            downstream_pressure_pa: 3.0e5,
            face_width_m: 0.0,
            fluid_viscosity_pa_s: 0.0,
            film_thickness_m: 0.0,
            pv_limit_pa_m_s: 0.0,
            num_teeth: 4,
            clearance_m: 1.5e-4,
            gas_constant_j_kg_k: 320.0,
            gas_temp_k: 900.0,
            discharge_coefficient: 0.7,
        };
        let few = solve_seal(&base);
        let many = solve_seal(&SealInput { num_teeth: 12, ..base.clone() });
        assert!(many.leakage_kg_s < few.leakage_kg_s, "more teeth should leak less");
        assert!(few.leakage_kg_s > 0.0);
    }
}
