//! Material database for chamber/nozzle walls and liners.
//!
//! Replaces the hardcoded copper properties the regen solver used to assume. Each
//! [`Material`] carries the thermal, structural and radiative properties the
//! cooling and structures tiers need, plus a `cooling_class` hint for which
//! cooling strategy the material is normally used with. [`AblativeMaterial`]
//! carries the extra properties an ablative liner needs.

/// The cooling strategy a wall material is typically paired with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum CoolingClass {
    /// High-conductivity liner for regenerative/actively cooled walls.
    Regenerative,
    /// High-temperature alloy/composite for radiation-cooled sections.
    Radiation,
    /// Sacrificial ablative liner.
    Ablative,
}

/// A structural/thermal wall material.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Material {
    pub name: String,
    pub thermal_conductivity_w_m_k: f64,
    /// Maximum sustained service temperature, K.
    pub max_service_temp_k: f64,
    pub density_kg_m3: f64,
    /// Allowable stress at elevated temperature, Pa.
    pub allowable_stress_pa: f64,
    pub youngs_modulus_pa: f64,
    /// Coefficient of thermal expansion, 1/K.
    pub cte_per_k: f64,
    /// Surface (radiative) emissivity, dimensionless.
    pub emissivity: f64,
    pub cooling_class: CoolingClass,
}

/// Oxygen-free high-conductivity copper — classic regen liner (Krzycki).
pub fn copper_ofhc() -> Material {
    Material {
        name: "OFHC Copper".into(),
        thermal_conductivity_w_m_k: 391.0,
        max_service_temp_k: 700.0,
        density_kg_m3: 8960.0,
        allowable_stress_pa: 55.0e6,
        youngs_modulus_pa: 117.0e9,
        cte_per_k: 17.0e-6,
        emissivity: 0.30,
        cooling_class: CoolingClass::Regenerative,
    }
}

/// CuCrZr — precipitation-hardened copper alloy, higher strength/temperature
/// than OFHC (SSME NARloy-Z class liner).
pub fn cucrzr() -> Material {
    Material {
        name: "CuCrZr".into(),
        thermal_conductivity_w_m_k: 320.0,
        max_service_temp_k: 750.0,
        density_kg_m3: 8900.0,
        allowable_stress_pa: 200.0e6,
        youngs_modulus_pa: 127.0e9,
        cte_per_k: 17.0e-6,
        emissivity: 0.30,
        cooling_class: CoolingClass::Regenerative,
    }
}

/// Inconel 718 — nickel superalloy for hot structures and regen jackets.
pub fn inconel718() -> Material {
    Material {
        name: "Inconel 718".into(),
        thermal_conductivity_w_m_k: 11.4,
        max_service_temp_k: 980.0,
        density_kg_m3: 8190.0,
        allowable_stress_pa: 1000.0e6,
        youngs_modulus_pa: 200.0e9,
        cte_per_k: 13.0e-6,
        emissivity: 0.70,
        cooling_class: CoolingClass::Regenerative,
    }
}

/// 316L stainless steel — general structure / low-cost chambers.
pub fn ss316l() -> Material {
    Material {
        name: "SS 316L".into(),
        thermal_conductivity_w_m_k: 16.0,
        max_service_temp_k: 870.0,
        density_kg_m3: 8000.0,
        allowable_stress_pa: 200.0e6,
        youngs_modulus_pa: 193.0e9,
        cte_per_k: 16.0e-6,
        emissivity: 0.60,
        cooling_class: CoolingClass::Regenerative,
    }
}

/// Niobium alloy C-103 (silicide-coated) — radiation-cooled nozzle extensions
/// (RL10, Apollo SPS).
pub fn niobium_c103() -> Material {
    Material {
        name: "Niobium C-103".into(),
        thermal_conductivity_w_m_k: 42.0,
        max_service_temp_k: 1750.0,
        density_kg_m3: 8600.0,
        allowable_stress_pa: 120.0e6,
        youngs_modulus_pa: 100.0e9,
        cte_per_k: 7.5e-6,
        emissivity: 0.80,
        cooling_class: CoolingClass::Radiation,
    }
}

/// Carbon-carbon composite — very high-temperature radiation-cooled sections.
pub fn carbon_carbon() -> Material {
    Material {
        name: "Carbon-Carbon".into(),
        thermal_conductivity_w_m_k: 40.0,
        max_service_temp_k: 2200.0,
        density_kg_m3: 1600.0,
        allowable_stress_pa: 100.0e6,
        youngs_modulus_pa: 70.0e9,
        cte_per_k: 2.0e-6,
        emissivity: 0.85,
        cooling_class: CoolingClass::Radiation,
    }
}

/// Every wall material in the database.
pub fn all() -> Vec<Material> {
    vec![
        copper_ofhc(),
        cucrzr(),
        inconel718(),
        ss316l(),
        niobium_c103(),
        carbon_carbon(),
    ]
}

/// Look up a wall material by (case-insensitive) name.
pub fn by_name(name: &str) -> Option<Material> {
    all().into_iter().find(|m| m.name.eq_ignore_ascii_case(name))
}

/// An ablative liner material.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AblativeMaterial {
    pub name: String,
    /// Effective heat of ablation, J/kg (energy absorbed per kg of material lost).
    pub heat_of_ablation_j_kg: f64,
    /// Virgin density, kg/m³.
    pub density_kg_m3: f64,
    /// Char-layer thermal conductivity, W/(m·K).
    pub char_conductivity_w_m_k: f64,
}

/// Silica-phenolic — common low-cost ablative. The heat of ablation is an
/// *effective* Q* that lumps in pyrolysis, char re-radiation and gas blocking.
pub fn silica_phenolic() -> AblativeMaterial {
    AblativeMaterial {
        name: "Silica-Phenolic".into(),
        heat_of_ablation_j_kg: 8.0e6,
        density_kg_m3: 1700.0,
        char_conductivity_w_m_k: 0.5,
    }
}

/// Carbon-phenolic — higher-performance ablative (throats, high flux). Effective
/// Q* is higher than silica-phenolic thanks to the insulating carbon char.
pub fn carbon_phenolic() -> AblativeMaterial {
    AblativeMaterial {
        name: "Carbon-Phenolic".into(),
        heat_of_ablation_j_kg: 20.0e6,
        density_kg_m3: 1450.0,
        char_conductivity_w_m_k: 1.2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_lookup_is_case_insensitive() {
        assert!(by_name("ofhc copper").is_some());
        assert!(by_name("Inconel 718").is_some());
        assert!(by_name("unobtainium").is_none());
        assert_eq!(all().len(), 6);
    }

    #[test]
    fn radiation_materials_outrank_copper_on_temperature() {
        assert!(niobium_c103().max_service_temp_k > copper_ofhc().max_service_temp_k);
        assert!(carbon_carbon().max_service_temp_k > niobium_c103().max_service_temp_k);
        // Copper conducts far better than the superalloys.
        assert!(copper_ofhc().thermal_conductivity_w_m_k > inconel718().thermal_conductivity_w_m_k);
    }
}
