//! Propellant pair + materials database.
//!
//! Seeded low-fidelity property tables so the whole model runs offline from day
//! one. L1 thermochemistry replaces the rough molecular-weight/`R` values later;
//! this crate stays the place that knows a pair's handling class and stored
//! density.

use engine_core::{PropellantPair, Ratio};
use serde::{Deserialize, Serialize};

/// Low-fidelity propellant pair properties (rough, for L0/L5 sizing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropellantProps {
    pub pair: PropellantPair,
    /// Combined density of the two bulk propellants if co-stored (else None).
    pub density_kg_m3: Option<f64>,
    /// L0 kinematic assumptions per the Krzycki method. The book fixes
    /// `gamma = 1.2` and `R = 65 ft·lbf/(lbm·°R)` for GOX/hydrocarbon.
    pub gamma: f64,
    /// Specific gas constant, J/(kg·K). `R = 65 ft·lbf/(lbm·°R) ≈ 349.72 J/(kg·K)`.
    pub r_si: f64,
    /// Assumed adiabatic flame temperature, K.
    pub tc_k: f64,
    /// Assumed sea-level ideal specific impulse, s (Krzycki table).
    pub isp_s: f64,
    /// Handling / toxicity class (H: hypergolic, O: oxidizer, F: fuel, T: toxic).
    pub handling_class: &'static str,
    /// Vapor pressure at 300 K, Pa.
    pub vapor_pressure_pa: Option<f64>,
    /// Recommended O/F window (min, max).
    pub of_window: (Ratio, Ratio),
    pub note: &'static str,
}

/// Static seed table. In the full build these come from RON data; for now a
/// hand-seeded table keeps the crate offline and dependency-free.
pub fn seeded_pairs() -> &'static [PropellantProps] {
    &SEEDED
}

static SEEDED: [PropellantProps; 12] = [
    PropellantProps {
        pair: PropellantPair::GoxKerosene,
        density_kg_m3: Some(1_000.0),
        gamma: 1.2,
        r_si: 349.72,
        tc_k: 3_300.0,
        isp_s: 250.0,
        handling_class: "O/F",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(2.5), Ratio::new(3.5)),
        note: "Classic small-engine test combo (kerosene ~ gasoline).",
    },
    PropellantProps {
        pair: PropellantPair::GoxGasoline,
        density_kg_m3: Some(800.0),
        gamma: 1.2,
        r_si: 349.72,
        tc_k: 3_460.0,
        isp_s: 260.0,
        handling_class: "O/F",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(2.0), Ratio::new(3.0)),
        note: "Krzycki's worked-example propellant (GOX + gasoline), 20 lbf / 300 psi.",
    },
    PropellantProps {
        pair: PropellantPair::GoxEthanol,
        density_kg_m3: Some(940.0),
        gamma: 1.2,
        r_si: 349.72,
        tc_k: 3_000.0,
        isp_s: 230.0,
        handling_class: "O/F",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(1.5), Ratio::new(2.2)),
        note: "Safe, low-soot; common in university test campaigns.",
    },
    PropellantProps {
        pair: PropellantPair::LoxMethane,
        density_kg_m3: Some(850.0),
        gamma: 1.2,
        r_si: 349.72,
        tc_k: 3_400.0,
        isp_s: 290.0,
        handling_class: "O/F",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(2.8), Ratio::new(3.8)),
        note: "High c*, clean; modern expander-cycle trend.",
    },
    PropellantProps {
        pair: PropellantPair::GoxMethanol,
        density_kg_m3: Some(790.0),
        gamma: 1.2,
        r_si: 349.72,
        tc_k: 2_800.0,
        isp_s: 220.0,
        handling_class: "F/T",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(1.2), Ratio::new(1.8)),
        note: "Toxic; handled last.",
    },
    PropellantProps {
        pair: PropellantPair::LoxRp1,
        density_kg_m3: Some(1_000.0),
        gamma: 1.2,
        r_si: 349.72,
        tc_k: 3_500.0,
        isp_s: 300.0,
        handling_class: "O/F",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(2.4), Ratio::new(3.0)),
        note: "Flight-representative; high thrust.",
    },
    PropellantProps {
        pair: PropellantPair::LoxEthanol,
        density_kg_m3: Some(940.0),
        gamma: 1.2,
        r_si: 349.72,
        tc_k: 3_100.0,
        isp_s: 280.0,
        handling_class: "O/F",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(1.5), Ratio::new(2.2)),
        note: "PSAS 2.5 kN engine family.",
    },
    PropellantProps {
        pair: PropellantPair::NitrousPropane,
        // Blended bulk density at ~O/F 7 (N2O ~1220, propane ~493 kg/m³).
        density_kg_m3: Some(1_030.0),
        gamma: 1.2,
        r_si: 349.72,
        tc_k: 3_200.0,
        isp_s: 250.0,
        handling_class: "O/F",
        // Self-pressurizing: N2O vapor pressure ≈ 5.1 MPa at 293 K.
        vapor_pressure_pa: Some(5.1e6),
        of_window: (Ratio::new(5.0), Ratio::new(8.0)),
        note: "Nitrous/LPG: storable, self-pressurizing (no turbopump needed). Converse-Engine class.",
    },
    PropellantProps {
        pair: PropellantPair::NtoMmh,
        // Blended bulk density at ~O/F 2.0 (NTO ~1440, MMH ~874 kg/m³).
        density_kg_m3: Some(1_190.0),
        gamma: 1.2,
        r_si: 349.72,
        tc_k: 3_300.0,
        isp_s: 285.0,
        handling_class: "H/T",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(1.6), Ratio::new(2.4)),
        note: "Storable hypergolic (self-igniting); toxic. Apollo/Shuttle OMS class.",
    },
    PropellantProps {
        pair: PropellantPair::NtoUdmh,
        density_kg_m3: Some(1_180.0),
        gamma: 1.2,
        r_si: 349.72,
        tc_k: 3_350.0,
        isp_s: 285.0,
        handling_class: "H/T",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(2.2), Ratio::new(3.0)),
        note: "Storable hypergolic; Proton/Titan class. Toxic.",
    },
    PropellantProps {
        pair: PropellantPair::LoxHydrogen,
        // Cryogenic, stored separately.
        density_kg_m3: None,
        // Hydrogen-rich exhaust: low mean MW (~13 g/mol) → high R and c*.
        gamma: 1.26,
        r_si: 640.0,
        tc_k: 3_400.0,
        isp_s: 380.0,
        handling_class: "O/F",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(3.5), Ratio::new(6.5)),
        note: "LOX/LH2: highest Isp; deep-cryogenic, bulky hydrogen (RS-25/RL10 class).",
    },
    PropellantProps {
        pair: PropellantPair::H2o2Kerosene,
        density_kg_m3: None,
        gamma: 1.21,
        r_si: 330.0,
        tc_k: 2_900.0,
        isp_s: 265.0,
        handling_class: "O/F",
        vapor_pressure_pa: None,
        of_window: (Ratio::new(6.0), Ratio::new(8.0)),
        note: "High-test peroxide / kerosene: storable, non-toxic, catalytically decomposed.",
    },
];

/// Look up seeded properties for a pair.
pub fn props_for(pair: PropellantPair) -> Option<&'static PropellantProps> {
    seeded_pairs().iter().find(|p| p.pair == pair)
}

impl PropellantProps {
    /// Ideal-gas characteristic velocity from the L0 kinematic assumptions,
    /// `c* = sqrt(γ R Tc) / ((2/(γ+1))^((γ+1)/(2(γ-1))))` (V0, m/s).
    pub fn c_star_m_s(&self) -> f64 {
        let g = self.gamma;
        let term = (2.0 / (g + 1.0)).powf((g + 1.0) / (2.0 * (g - 1.0)));
        (self.r_si * self.tc_k / g).sqrt() / term
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_seeded_pairs_resolvable() {
        for pair in seeded_pairs() {
            assert_eq!(props_for(pair.pair).unwrap().pair, pair.pair);
        }
    }

    #[test]
    fn gasoline_cstar_matches_book() {
        let p = props_for(PropellantPair::GoxGasoline).unwrap();
        // ~1696 m/s reproduces the Krzycki 20 lbf example (A_t = 0.0444 in²).
        assert!((p.c_star_m_s() - 1696.0).abs() < 12.0);
    }
}

