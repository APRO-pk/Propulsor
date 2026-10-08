//! Regenerative coolant properties.
//!
//! A regen jacket is cooled by the engine's own fuel (or, on a test stand, by
//! water). Each coolant carries representative constant transport properties for
//! the jacket, its inlet temperature, a saturation curve and its critical point,
//! and the coolant-side wall-temperature limit that applies once it is
//! supercritical (coking for hydrocarbons, thermal decomposition for alcohols and
//! hydrazines, none for hydrogen).
//!
//! Properties are single representative values (the L3 model is constant-
//! property): liquids at inlet conditions; for the cryogens (methane, hydrogen),
//! which heat through the critical region in the jacket, mean-jacket values. The
//! supercritical limits are approximate engineering values and can be overridden
//! per design.

use engine_core::PropellantPair;

use crate::RU;

/// What bounds the coolant-side wall temperature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CoolantLimitKind {
    /// Subcritical: the coolant-side wall must stay below saturation.
    Boiling,
    /// Supercritical hydrocarbon: carbon deposits above this wall temperature.
    Coking,
    /// Supercritical alcohol / hydrazine: thermal decomposition limit.
    Decomposition,
    /// Supercritical with no practical coolant-side limit (hydrogen, water).
    None,
}

/// A regenerative coolant.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Coolant {
    pub name: String,
    pub density_kg_m3: f64,
    pub cp_j_kg_k: f64,
    pub conductivity_w_m_k: f64,
    pub viscosity_pa_s: f64,
    /// Jacket inlet (bulk) temperature, K.
    pub inlet_temp_k: f64,
    /// Normal boiling point (1 atm), K.
    pub normal_boiling_k: f64,
    /// Molar heat of vaporization at the normal boiling point, J/mol.
    pub heat_of_vaporization_j_mol: f64,
    pub critical_pressure_pa: f64,
    pub critical_temp_k: f64,
    /// Coolant-side wall limit once supercritical, K (None = no limit).
    pub supercritical_limit_k: Option<f64>,
    pub supercritical_limit_kind: CoolantLimitKind,
    /// Default design coolant velocity at the throat, m/s.
    pub default_velocity_m_s: f64,
}

impl Coolant {
    pub fn prandtl(&self) -> f64 {
        self.viscosity_pa_s * self.cp_j_kg_k / self.conductivity_w_m_k
    }

    /// Saturation temperature at `p_pa` (Clausius–Clapeyron anchored at the
    /// normal boiling point, capped at the critical temperature).
    pub fn saturation_temp_k(&self, p_pa: f64) -> f64 {
        if self.name == "Water" {
            return water_saturation(p_pa).min(self.critical_temp_k);
        }
        let p = p_pa.max(1.0);
        let inv_t = 1.0 / self.normal_boiling_k - RU * (p / 101_325.0).ln() / self.heat_of_vaporization_j_mol;
        if inv_t <= 0.0 {
            return self.critical_temp_k;
        }
        (1.0 / inv_t).min(self.critical_temp_k)
    }

    /// The coolant-side wall-temperature limit at `p_pa` and what sets it.
    /// Subcritical → saturation (or the coking/decomposition limit if lower);
    /// supercritical → the coking/decomposition limit, or `None`.
    pub fn wall_limit(&self, p_pa: f64) -> (Option<f64>, CoolantLimitKind) {
        if p_pa < self.critical_pressure_pa {
            let t_sat = self.saturation_temp_k(p_pa);
            match self.supercritical_limit_k {
                Some(t) if t < t_sat => (Some(t), self.supercritical_limit_kind),
                _ => (Some(t_sat), CoolantLimitKind::Boiling),
            }
        } else {
            (self.supercritical_limit_k, self.supercritical_limit_kind)
        }
    }

    /// Water (test-stand jacket; Krzycki's 20 lbf engine).
    pub fn water() -> Self {
        Coolant {
            name: "Water".into(),
            density_kg_m3: 1000.0,
            cp_j_kg_k: 4186.0,
            conductivity_w_m_k: 0.6,
            viscosity_pa_s: 1.0e-3,
            inlet_temp_k: 300.0,
            normal_boiling_k: 373.15,
            heat_of_vaporization_j_mol: 40_650.0,
            critical_pressure_pa: 220.64e5,
            critical_temp_k: 647.1,
            supercritical_limit_k: None,
            supercritical_limit_kind: CoolantLimitKind::None,
            default_velocity_m_s: 6.0,
        }
    }

    /// The coolant for a propellant pair's fuel.
    pub fn for_fuel(pair: PropellantPair) -> Self {
        #[allow(clippy::too_many_arguments)]
        fn c(
            name: &str, rho: f64, cp: f64, k: f64, mu: f64, t_in: f64, t_b: f64, h_vap: f64,
            p_c_bar: f64, t_c: f64, limit: Option<f64>, kind: CoolantLimitKind, v: f64,
        ) -> Coolant {
            Coolant {
                name: name.into(),
                density_kg_m3: rho,
                cp_j_kg_k: cp,
                conductivity_w_m_k: k,
                viscosity_pa_s: mu,
                inlet_temp_k: t_in,
                normal_boiling_k: t_b,
                heat_of_vaporization_j_mol: h_vap,
                critical_pressure_pa: p_c_bar * 1e5,
                critical_temp_k: t_c,
                supercritical_limit_k: limit,
                supercritical_limit_kind: kind,
                default_velocity_m_s: v,
            }
        }
        use CoolantLimitKind::{Coking, Decomposition, None as NoLimit};
        use PropellantPair as P;
        match pair {
            // RP-1 / kerosene: 589 K (600 °F) coolant-side coking limit.
            P::LoxRp1 | P::GoxKerosene | P::H2o2Kerosene => {
                c("RP-1", 810.0, 2010.0, 0.12, 1.0e-3, 298.0, 489.0, 42_000.0, 21.7, 678.0, Some(589.0), Coking, 20.0)
            }
            P::GoxGasoline => c("Gasoline", 740.0, 2220.0, 0.12, 5.0e-4, 298.0, 400.0, 35_000.0, 25.0, 568.0, Some(589.0), Coking, 20.0),
            P::GoxEthanol | P::LoxEthanol => {
                c("Ethanol", 789.0, 2440.0, 0.17, 1.07e-3, 298.0, 351.4, 38_600.0, 61.4, 514.0, Some(700.0), Decomposition, 20.0)
            }
            P::GoxMethanol => c("Methanol", 792.0, 2530.0, 0.20, 5.4e-4, 298.0, 337.8, 35_300.0, 81.0, 512.6, Some(700.0), Decomposition, 20.0),
            // Methane is far more coking-resistant than RP-1.
            P::LoxMethane => c("Methane", 422.0, 3480.0, 0.19, 1.2e-4, 112.0, 111.7, 8_190.0, 46.0, 190.6, Some(900.0), Coking, 30.0),
            // Hydrogen: mean-jacket supercritical properties; no coolant-side limit.
            P::LoxHydrogen => c("Hydrogen", 40.0, 13_000.0, 0.12, 8.0e-6, 25.0, 20.3, 904.0, 12.96, 33.2, None, NoLimit, 100.0),
            P::NitrousPropane => c("Propane", 493.0, 2700.0, 0.094, 9.8e-5, 298.0, 231.1, 19_040.0, 42.5, 369.8, Some(700.0), Coking, 20.0),
            P::NtoMmh => c("MMH", 875.0, 2930.0, 0.25, 7.8e-4, 298.0, 360.6, 40_400.0, 82.4, 567.0, Some(500.0), Decomposition, 20.0),
            P::NtoUdmh => c("UDMH", 791.0, 2730.0, 0.20, 5.1e-4, 298.0, 336.0, 35_000.0, 53.5, 523.0, Some(500.0), Decomposition, 20.0),
            P::Unset => Coolant::water(),
        }
    }
}

/// Water saturation temperature (K) via an Antoine fit.
fn water_saturation(p_pa: f64) -> f64 {
    let p_atm = p_pa / 101_325.0;
    if p_atm <= 1.0 {
        return 373.15;
    }
    // Antoine (water, K): log10(p_mmHg) = 8.07131 - 1730.63/(233.426+T_C)
    let p_mmhg = p_pa * 0.00750062;
    let t_c = 1730.63 / (8.07131 - p_mmhg.log10()) - 233.426;
    t_c + 273.15
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saturation_matches_normal_boiling_point() {
        for pair in [PropellantPair::LoxRp1, PropellantPair::LoxMethane, PropellantPair::NtoMmh, PropellantPair::LoxEthanol] {
            let c = Coolant::for_fuel(pair);
            assert!((c.saturation_temp_k(101_325.0) - c.normal_boiling_k).abs() < 0.5, "{}", c.name);
        }
    }

    #[test]
    fn ethanol_saturation_near_reference() {
        // Ethanol boils at ~424 K at 10 bar (NIST ≈ 423.9 K).
        let t = Coolant::for_fuel(PropellantPair::LoxEthanol).saturation_temp_k(10e5);
        assert!((t - 424.0).abs() < 10.0, "T_sat = {t}");
    }

    #[test]
    fn limit_switches_from_boiling_to_coking_above_critical() {
        let rp1 = Coolant::for_fuel(PropellantPair::LoxRp1);
        assert_eq!(rp1.wall_limit(5e5).1, CoolantLimitKind::Boiling);
        assert_eq!(rp1.wall_limit(100e5), (Some(589.0), CoolantLimitKind::Coking));
        let h2 = Coolant::for_fuel(PropellantPair::LoxHydrogen);
        assert_eq!(h2.wall_limit(100e5), (None, CoolantLimitKind::None));
    }
}
