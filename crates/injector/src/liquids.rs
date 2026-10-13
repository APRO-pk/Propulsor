//! Liquid-propellant properties at injection conditions, for atomization and
//! vaporization.
//!
//! Every value is sourced:
//! * **NIST** — NIST Chemistry WebBook fluid data (REFPROP equations of state),
//!   saturated liquid at the listed temperature (LOX, CH4, propane, N2O,
//!   methanol, LH2) or 1 atm liquid (n-heptane).
//! * **rocketprops** — RocketProps reference points (C. Taylor), compiled from
//!   AFRPL-TR-69-149 (hydrazines), CPIA/Aerojet propellant data and REFPROP;
//!   converted from lbf/in, poise, BTU/lbm and °R. RP-1 H_v/T_c/MW also match the
//!   NASA CR-168066 vaporization program constants (125 BTU/lb, 1218 °R, 172).
//!
//! Gasoline is modeled by n-heptane (a primary-reference-fuel surrogate).

/// Physical properties of one liquid propellant at its injection temperature.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Liquid {
    pub name: &'static str,
    pub density_kg_m3: f64,
    pub viscosity_pa_s: f64,
    pub surface_tension_n_m: f64,
    /// Latent heat of vaporization, J/kg.
    pub heat_of_vaporization_j_kg: f64,
    pub critical_temp_k: f64,
    pub molecular_weight: f64,
    /// Temperature the properties are taken at (the assumed injection temperature), K.
    pub injection_temp_k: f64,
    pub source: &'static str,
}

pub const LOX: Liquid = Liquid {
    name: "LOX",
    density_kg_m3: 1142.1,
    viscosity_pa_s: 1.957e-4,
    surface_tension_n_m: 0.01319,
    heat_of_vaporization_j_kg: 213.2e3,
    critical_temp_k: 154.58,
    molecular_weight: 32.00,
    injection_temp_k: 90.0,
    source: "NIST sat. liquid, 90 K",
};

pub const METHANE: Liquid = Liquid {
    name: "LCH4",
    density_kg_m3: 422.3,
    viscosity_pa_s: 1.167e-4,
    surface_tension_n_m: 0.01291,
    heat_of_vaporization_j_kg: 510.8e3,
    critical_temp_k: 190.56,
    molecular_weight: 16.04,
    injection_temp_k: 111.7,
    source: "NIST sat. liquid, 111.7 K",
};

pub const PROPANE: Liquid = Liquid {
    name: "Propane",
    density_kg_m3: 492.4,
    viscosity_pa_s: 9.72e-5,
    surface_tension_n_m: 0.00702,
    heat_of_vaporization_j_kg: 335.7e3,
    critical_temp_k: 369.89,
    molecular_weight: 44.10,
    injection_temp_k: 298.15,
    source: "NIST sat. liquid, 298.15 K",
};

pub const NITROUS: Liquid = Liquid {
    name: "N2O",
    density_kg_m3: 785.1,
    viscosity_pa_s: 6.82e-5,
    surface_tension_n_m: 0.00206,
    heat_of_vaporization_j_kg: 169.9e3,
    critical_temp_k: 309.52,
    molecular_weight: 44.01,
    injection_temp_k: 293.15,
    source: "NIST sat. liquid, 293.15 K",
};

pub const METHANOL: Liquid = Liquid {
    name: "Methanol",
    density_kg_m3: 786.3,
    viscosity_pa_s: 5.437e-4,
    surface_tension_n_m: 0.02215,
    heat_of_vaporization_j_kg: 1168.9e3,
    critical_temp_k: 512.6,
    molecular_weight: 32.04,
    injection_temp_k: 298.15,
    source: "NIST liquid, 298.15 K",
};

pub const HYDROGEN: Liquid = Liquid {
    name: "LH2",
    density_kg_m3: 70.9,
    viscosity_pa_s: 1.357e-5,
    surface_tension_n_m: 0.00192,
    heat_of_vaporization_j_kg: 449.0e3,
    critical_temp_k: 33.15,
    molecular_weight: 2.016,
    injection_temp_k: 20.3,
    source: "NIST sat. liquid, 20.3 K",
};

pub const GASOLINE: Liquid = Liquid {
    name: "Gasoline (n-heptane)",
    density_kg_m3: 679.6,
    viscosity_pa_s: 3.901e-4,
    surface_tension_n_m: 0.01974,
    heat_of_vaporization_j_kg: 365.0e3,
    critical_temp_k: 540.2,
    molecular_weight: 100.2,
    injection_temp_k: 298.15,
    source: "NIST n-heptane, 298.15 K",
};

pub const RP1: Liquid = Liquid {
    name: "RP-1",
    density_kg_m3: 810.0,
    viscosity_pa_s: 1.669e-3,
    surface_tension_n_m: 0.02904,
    heat_of_vaporization_j_kg: 290.75e3,
    critical_temp_k: 676.5,
    molecular_weight: 172.0,
    injection_temp_k: 293.17,
    source: "rocketprops / NASA CR-168066, 527.7 °R",
};

pub const ETHANOL: Liquid = Liquid {
    name: "Ethanol",
    density_kg_m3: 789.6,
    viscosity_pa_s: 1.195e-3,
    surface_tension_n_m: 0.02242,
    heat_of_vaporization_j_kg: 927.1e3,
    critical_temp_k: 513.9,
    molecular_weight: 46.07,
    injection_temp_k: 293.17,
    source: "rocketprops, 527.7 °R",
};

pub const MMH: Liquid = Liquid {
    name: "MMH",
    density_kg_m3: 879.8,
    viscosity_pa_s: 8.449e-4,
    surface_tension_n_m: 0.03431,
    heat_of_vaporization_j_kg: 876.9e3,
    critical_temp_k: 585.4,
    molecular_weight: 46.07,
    injection_temp_k: 293.17,
    source: "rocketprops (AFRPL-TR-69-149), 527.7 °R",
};

pub const UDMH: Liquid = Liquid {
    name: "UDMH",
    density_kg_m3: 790.4,
    viscosity_pa_s: 5.533e-4,
    surface_tension_n_m: 0.02464,
    heat_of_vaporization_j_kg: 582.7e3,
    critical_temp_k: 523.2,
    molecular_weight: 60.10,
    injection_temp_k: 293.17,
    source: "rocketprops (AFRPL-TR-69-149), 527.7 °R",
};

pub const NTO: Liquid = Liquid {
    name: "NTO",
    density_kg_m3: 1441.4,
    viscosity_pa_s: 4.201e-4,
    surface_tension_n_m: 0.02622,
    heat_of_vaporization_j_kg: 414.5e3,
    critical_temp_k: 431.4,
    molecular_weight: 92.01,
    injection_temp_k: 293.17,
    source: "rocketprops, 527.7 °R",
};

pub const PEROXIDE: Liquid = Liquid {
    name: "H2O2 (100%)",
    density_kg_m3: 1450.0,
    viscosity_pa_s: 1.363e-3,
    surface_tension_n_m: 0.08136,
    heat_of_vaporization_j_kg: 1564.9e3,
    critical_temp_k: 730.2,
    molecular_weight: 34.02,
    injection_temp_k: 288.17,
    source: "rocketprops, 518.7 °R",
};

/// How a propellant enters the chamber.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Phase {
    Liquid,
    /// Injected as a gas (GOX, regen-heated H2/CH4): nothing to vaporize.
    Gas,
}

/// The (oxidizer, fuel) liquids and default injection phases of a propellant
/// pair. GOX is always gaseous; LH2 defaults to gas (it leaves a regen jacket
/// supercritical/gaseous); HTP defaults to gas (decomposed in a catalyst bed
/// before injection, the usual peroxide/kerosene architecture); everything
/// else defaults to liquid.
pub fn for_pair(pair: engine_core::PropellantPair) -> ((Liquid, Phase), (Liquid, Phase)) {
    use engine_core::PropellantPair as P;
    use Phase::{Gas, Liquid as L};
    match pair {
        P::Unset | P::GoxKerosene => ((LOX, Gas), (RP1, L)),
        P::GoxGasoline => ((LOX, Gas), (GASOLINE, L)),
        P::GoxEthanol => ((LOX, Gas), (ETHANOL, L)),
        P::GoxMethanol => ((LOX, Gas), (METHANOL, L)),
        P::LoxRp1 => ((LOX, L), (RP1, L)),
        P::LoxEthanol => ((LOX, L), (ETHANOL, L)),
        P::LoxMethane => ((LOX, L), (METHANE, L)),
        P::NitrousPropane => ((NITROUS, L), (PROPANE, L)),
        P::NtoMmh => ((NTO, L), (MMH, L)),
        P::NtoUdmh => ((NTO, L), (UDMH, L)),
        P::LoxHydrogen => ((LOX, L), (HYDROGEN, Gas)),
        P::H2o2Kerosene => ((PEROXIDE, Gas), (RP1, L)),
    }
}

/// Whether combustion of this pair is vaporization-limited, i.e. whether the
/// Priem–Heidmann model applies. Hypergolic pairs react in the liquid phase on
/// contact (NASA TM X-52244 studies exactly this for N2H4/NTO), so a
/// vaporization model badly under-predicts them.
pub fn vaporization_model_applies(pair: engine_core::PropellantPair) -> Result<(), &'static str> {
    use engine_core::PropellantPair as P;
    match pair {
        P::NtoMmh | P::NtoUdmh => Err(
            "hypergolic propellants react in the liquid phase, so combustion is not vaporization-limited; the Priem–Heidmann model does not apply",
        ),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// NASA CR-168066 Eq. 2 normalizes drop size to n-heptane:
    /// 99.29·(σμ/ρ)^0.25 must be ≈1 for heptane.
    #[test]
    fn heptane_normalizes_cr168066_property_group() {
        let h = GASOLINE;
        let g = 99.29 * (h.surface_tension_n_m * h.viscosity_pa_s / h.density_kg_m3).powf(0.25);
        assert!((g - 1.0).abs() < 0.03, "heptane group = {g}");
    }

    #[test]
    fn every_pair_has_physical_liquids() {
        for p in [
            engine_core::PropellantPair::LoxRp1,
            engine_core::PropellantPair::NtoMmh,
            engine_core::PropellantPair::H2o2Kerosene,
            engine_core::PropellantPair::NitrousPropane,
        ] {
            let ((o, _), (f, _)) = for_pair(p);
            for l in [o, f] {
                assert!(l.injection_temp_k < l.critical_temp_k, "{} above Tc", l.name);
                assert!(l.density_kg_m3 > 50.0 && l.surface_tension_n_m > 0.0 && l.viscosity_pa_s > 0.0);
            }
        }
    }
}
