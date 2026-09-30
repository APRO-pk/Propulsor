//! Tauri host for the Propulsor liquid-engine module.
//!
//! The IPC routing layer is deliberately kept here (not in a standalone crate) so
//! the solver workspace stays 100% Tauri-free. Commands are defined in
//! [`commands`]; the frontend calls them over `invoke`.

pub mod commands;

use std::sync::Mutex;

/// Minimal backend state: the current in-memory design. In later milestones this
/// becomes the RON-backed workspace entity + a tier-cache store.
#[derive(Default)]
pub struct AppState {
    pub design: Mutex<Option<engine_core::EngineDesign>>,
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_design,
            commands::set_field,
            commands::perf_map,
            commands::design_advice,
            commands::cooling_study,
            commands::turbopump_study,
            commands::analysis_study,
            commands::feed_study,
            commands::trade_bundle,
            commands::blade_study,
            commands::validation_study,
            commands::control_study,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Propulsor application");
}
