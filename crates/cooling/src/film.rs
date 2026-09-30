//! Film cooling: a coolant film injected along the wall that shields it from the
//! hot gas, lowering the adiabatic wall temperature the wall actually sees.
//!
//! Uses a turbulent slot-film effectiveness correlation (Stollery–El-Ehwany
//! form): the effectiveness is ~1 at the injection slot and decays downstream as
//! the film mixes into the mainstream. The film-cooled adiabatic wall temperature
//! is `T_aw = T_g − η·(T_g − T_c)`.

/// Film-cooling configuration for a tangential-slot injector.
#[derive(Debug, Clone)]
pub struct FilmCoolingInput {
    pub gas_temp_k: f64,
    pub gas_density_kg_m3: f64,
    pub gas_velocity_m_s: f64,
    pub coolant_temp_k: f64,
    pub coolant_density_kg_m3: f64,
    pub coolant_velocity_m_s: f64,
    pub coolant_viscosity_pa_s: f64,
    /// Injection slot height, m.
    pub slot_height_m: f64,
    /// Distance downstream of the slot, m.
    pub distance_m: f64,
}

/// Film-cooling result at the requested downstream distance.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FilmCoolingResult {
    pub blowing_ratio: f64,
    pub effectiveness: f64,
    pub adiabatic_wall_temp_k: f64,
    /// Distance over which effectiveness stays above 0.3, m.
    pub effective_length_m: f64,
}

impl FilmCoolingResult {
    pub fn summary(&self) -> String {
        format!(
            "M={:.2} | η={:.2} @ x | T_aw={:.0} K | effective_length={:.3} m",
            self.blowing_ratio, self.effectiveness, self.adiabatic_wall_temp_k, self.effective_length_m,
        )
    }
}

/// Film-cooling effectiveness `η(x)` for a blowing ratio `m`, slot height `s`,
/// and coolant slot Reynolds number `re_s`. Bounded to [0, 1]; unity at the slot.
pub fn effectiveness(distance_m: f64, blowing_ratio: f64, slot_height_m: f64, re_s: f64) -> f64 {
    let m = blowing_ratio.max(1e-6);
    let s = slot_height_m.max(1e-9);
    // Correlating length ξ = (x / (M·s))·Re_s^{−0.25}.
    let xi = (distance_m / (m * s)) * re_s.max(1.0).powf(-0.25);
    (1.0 + 0.25 * xi).powf(-0.8).clamp(0.0, 1.0)
}

/// Solve a film-cooling station: blowing ratio, effectiveness, and the
/// film-cooled adiabatic wall temperature.
pub fn solve_film(input: &FilmCoolingInput) -> FilmCoolingResult {
    let g_c = input.coolant_density_kg_m3 * input.coolant_velocity_m_s;
    let g_g = input.gas_density_kg_m3 * input.gas_velocity_m_s;
    let m = g_c / g_g.max(1e-9);
    let re_s = input.coolant_density_kg_m3 * input.coolant_velocity_m_s * input.slot_height_m
        / input.coolant_viscosity_pa_s.max(1e-9);

    let eta = effectiveness(input.distance_m, m, input.slot_height_m, re_s);
    let t_aw = input.gas_temp_k - eta * (input.gas_temp_k - input.coolant_temp_k);

    // March downstream to find where effectiveness falls to 0.3.
    let mut eff_len = 0.0;
    let step = input.slot_height_m.max(1e-4);
    let mut x = 0.0;
    for _ in 0..100_000 {
        if effectiveness(x, m, input.slot_height_m, re_s) < 0.3 {
            break;
        }
        eff_len = x;
        x += step;
    }

    FilmCoolingResult {
        blowing_ratio: m,
        effectiveness: eta,
        adiabatic_wall_temp_k: t_aw,
        effective_length_m: eff_len,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> FilmCoolingInput {
        FilmCoolingInput {
            gas_temp_k: 3400.0,
            gas_density_kg_m3: 3.0,
            gas_velocity_m_s: 900.0,
            coolant_temp_k: 400.0,
            coolant_density_kg_m3: 5.0,
            coolant_velocity_m_s: 120.0,
            coolant_viscosity_pa_s: 2.0e-5,
            slot_height_m: 1.0e-3,
            distance_m: 0.02,
        }
    }

    #[test]
    fn film_lowers_wall_temperature() {
        let r = solve_film(&input());
        assert!(r.effectiveness > 0.0 && r.effectiveness <= 1.0);
        assert!(r.adiabatic_wall_temp_k < 3400.0);
        assert!(r.adiabatic_wall_temp_k > 400.0);
    }

    #[test]
    fn effectiveness_decays_downstream() {
        let near = effectiveness(0.0, 1.0, 1.0e-3, 5000.0);
        let far = effectiveness(0.2, 1.0, 1.0e-3, 5000.0);
        assert!((near - 1.0).abs() < 1e-9, "η at slot should be 1: {near}");
        assert!(far < near);
    }

    #[test]
    fn more_coolant_extends_the_film() {
        let base = solve_film(&input());
        let more = solve_film(&FilmCoolingInput { coolant_velocity_m_s: 240.0, ..input() });
        assert!(more.effective_length_m > base.effective_length_m);
    }
}
