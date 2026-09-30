//! Radiation cooling: a thin uncooled wall (e.g. a niobium or carbon-carbon
//! nozzle extension) reaches an equilibrium temperature where the gas-side
//! convective heat flux equals the heat it radiates away.
//!
//! Balance solved for `T_w`:  `h_g·(T_aw − T_w) = ε·σ·(T_w⁴ − T_amb⁴)`.

use crate::materials::Material;

pub const SIGMA: f64 = 5.670374419e-8;

/// Radiation-cooling input.
#[derive(Debug, Clone)]
pub struct RadiationInput {
    /// Gas-side heat-transfer coefficient, W/(m²·K).
    pub h_gas: f64,
    /// Adiabatic (recovery) gas temperature driving the wall, K.
    pub adiabatic_gas_temp_k: f64,
    /// Ambient/sink temperature the wall radiates to, K.
    pub ambient_temp_k: f64,
    pub material: Material,
}

/// Radiation-cooling result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RadiationResult {
    pub equilibrium_wall_temp_k: f64,
    pub radiated_flux_w_m2: f64,
    pub material_limit_k: f64,
    pub material_ok: bool,
    pub margin_k: f64,
}

impl RadiationResult {
    pub fn summary(&self) -> String {
        format!(
            "T_eq={:.0} K (limit {:.0}, margin {:.0} K) | q_rad={:.2} MW/m² | {}",
            self.equilibrium_wall_temp_k,
            self.material_limit_k,
            self.margin_k,
            self.radiated_flux_w_m2 / 1e6,
            if self.material_ok { "OK" } else { "OVER LIMIT" },
        )
    }
}

/// Solve the radiation-equilibrium wall temperature by Newton iteration on
/// `f(T) = h_g·(T_aw − T) − ε·σ·(T⁴ − T_amb⁴)`.
pub fn solve_radiation(input: &RadiationInput) -> RadiationResult {
    let eps = input.material.emissivity;
    let t_amb4 = input.ambient_temp_k.powi(4);
    let h = input.h_gas.max(1e-9);

    // Start between the sink and the driving temperature.
    let mut t = 0.5 * (input.ambient_temp_k + input.adiabatic_gas_temp_k);
    for _ in 0..100 {
        let f = h * (input.adiabatic_gas_temp_k - t) - eps * SIGMA * (t.powi(4) - t_amb4);
        let df = -h - 4.0 * eps * SIGMA * t.powi(3);
        let step = f / df;
        t -= step;
        if step.abs() < 1e-6 {
            break;
        }
    }
    t = t.clamp(input.ambient_temp_k, input.adiabatic_gas_temp_k);

    let q_rad = eps * SIGMA * (t.powi(4) - t_amb4);
    let limit = input.material.max_service_temp_k;
    RadiationResult {
        equilibrium_wall_temp_k: t,
        radiated_flux_w_m2: q_rad,
        material_limit_k: limit,
        material_ok: t <= limit,
        margin_k: limit - t,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materials;

    #[test]
    fn equilibrium_balances_flux() {
        let inp = RadiationInput {
            h_gas: 2000.0,
            adiabatic_gas_temp_k: 2200.0,
            ambient_temp_k: 250.0,
            material: materials::niobium_c103(),
        };
        let r = solve_radiation(&inp);
        // At equilibrium convective in ≈ radiative out.
        let q_conv = inp.h_gas * (inp.adiabatic_gas_temp_k - r.equilibrium_wall_temp_k);
        assert!((q_conv - r.radiated_flux_w_m2).abs() / q_conv < 1e-3);
        assert!(r.equilibrium_wall_temp_k > inp.ambient_temp_k);
        assert!(r.equilibrium_wall_temp_k < inp.adiabatic_gas_temp_k);
    }

    #[test]
    fn niobium_survives_where_copper_would_not() {
        let base = RadiationInput {
            h_gas: 1500.0,
            adiabatic_gas_temp_k: 2000.0,
            ambient_temp_k: 250.0,
            material: materials::niobium_c103(),
        };
        let nb = solve_radiation(&base);
        let cu = solve_radiation(&RadiationInput { material: materials::copper_ofhc(), ..base.clone() });
        assert!(nb.material_ok, "Nb should survive: {}", nb.summary());
        assert!(!cu.material_ok, "copper should be over limit: {}", cu.summary());
    }
}
