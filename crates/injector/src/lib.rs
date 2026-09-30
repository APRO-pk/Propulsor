//! Injector orifice/spray sizing, fluid-flow simulation, and combustion-
//! instability analysis.
//!
//! Sizes orifices from discharge coefficient, allocates the pressure-drop budget,
//! and flags injection velocity / pressure-drop values outside Krzycki's safe
//! ranges (70–150 psi, 50–100 ft/s) and SP-8113.

pub mod efficiency;
pub mod flow;
pub mod instability;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InjectorResult {
    pub orifice_count: u32,
    pub orifice_diameter_m: f64,
    pub injection_velocity_m_s: f64,
    pub pressure_drop_pa: f64,
    pub stability_flags: Vec<String>,
}
