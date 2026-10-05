//! Tauri IPC commands — the boundary between the frontend and the solver core.
//!
//! These mirror the delta-based contract in ARCHITECTURE §8: `get_design` returns
//! the design entity, `set_field` dispatches a single field change and returns an
//! acknowledgement with the invalidation set (a single scalar, not a full re-serial
//! of the design tree).

use super::AppState;
use engine_core::EngineDesign;
use tauri::State;

/// First IPC round-trip: return the current design, resolved through the tier
/// pipeline. Until a real design exists the host lazily creates a default one.
#[tauri::command]
pub fn get_design(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let mut guard = state.design.lock().map_err(|e| e.to_string())?;
    let mut design = guard.clone().unwrap_or_else(|| EngineDesign::blank("untitled", "propulsor"));
    simulate::resolve(&mut design).map_err(|e| e.to_string())?;
    *guard = Some(design.clone());
    serde_json::to_value(design).map_err(|e| e.to_string())
}

/// Delta update: mutate a single field, re-resolve the dependent tiers, persist
/// the new design in the app state, and return the resolved design. `value` may
/// be a number or a string (e.g. a nozzle kind or material name).
#[tauri::command]
pub fn set_field(
    state: State<'_, AppState>,
    field_id: String,
    value: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let fv = match &value {
        serde_json::Value::Number(n) => engine_core::FieldValue::Num(n.as_f64().unwrap_or(0.0)),
        serde_json::Value::String(s) => engine_core::FieldValue::Text(s.clone()),
        _ => return Err("field value must be a number or string".into()),
    };

    let mut guard = state.design.lock().map_err(|e| e.to_string())?;
    let mut design = guard.clone().unwrap_or_else(|| EngineDesign::blank("untitled", "propulsor"));
    design.apply_field(&field_id, fv).map_err(|e| e.to_string())?;
    simulate::resolve(&mut design).map_err(|e| e.to_string())?;
    *guard = Some(design.clone());
    serde_json::to_value(design).map_err(|e| e.to_string())
}

/// Steady-state performance map (O/F × altitude), computed from the current design.
#[tauri::command]
pub fn perf_map(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let design = state
        .design
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .unwrap_or_else(|| EngineDesign::blank("untitled", "propulsor"));
    let map = simulate::steady_state_map(&design, (1.8, 3.0), 9, (0.0, 20_000.0), 7)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(map).map_err(|e| e.to_string())
}

/// Return a mutable clone of the current design, or a default one.
fn current_design(state: &State<'_, AppState>) -> Result<EngineDesign, String> {
    Ok(state
        .design
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .unwrap_or_else(|| EngineDesign::blank("untitled", "propulsor")))
}

/// Performance advice for the step-by-step designer (section A): optimal O/F,
/// recommended L*, and the trajectory-optimal nozzle expansion.
#[tauri::command]
pub fn design_advice(
    state: State<'_, AppState>,
    burnout_altitude_m: f64,
) -> Result<serde_json::Value, String> {
    let mut design = current_design(&state)?;
    let advice = simulate::design::design_advice(&mut design, burnout_altitude_m).map_err(|e| e.to_string())?;
    serde_json::to_value(advice).map_err(|e| e.to_string())
}

/// Cooling study (section C): wall material + regen / film / radiation / ablative.
#[tauri::command]
pub fn cooling_study(
    state: State<'_, AppState>,
    material: String,
    method: String,
) -> Result<serde_json::Value, String> {
    let mut design = current_design(&state)?;
    let study = simulate::design::cooling_study(&mut design, &material, &method).map_err(|e| e.to_string())?;
    serde_json::to_value(study).map_err(|e| e.to_string())
}

/// Turbomachinery study (section B): pumps, turbine, inducer, shaft, bearing and
/// the gas-generator cycle balance at a chosen shaft speed.
#[tauri::command]
pub fn turbopump_study(
    state: State<'_, AppState>,
    speed_rpm: f64,
) -> Result<serde_json::Value, String> {
    let mut design = current_design(&state)?;
    let study = simulate::design::turbopump_study(&mut design, speed_rpm).map_err(|e| e.to_string())?;
    serde_json::to_value(study).map_err(|e| e.to_string())
}

/// Analysis & detail study (section D): injector flow, combustion instability,
/// and the distributed wall-stress field.
#[tauri::command]
pub fn analysis_study(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let mut design = current_design(&state)?;
    let study = simulate::design::analysis_study(&mut design).map_err(|e| e.to_string())?;
    serde_json::to_value(study).map_err(|e| e.to_string())
}

/// Blade profiling + meanline losses + characteristic maps for the turbopump.
#[tauri::command]
pub fn blade_study(state: State<'_, AppState>, speed_rpm: f64) -> Result<serde_json::Value, String> {
    let mut design = current_design(&state)?;
    let study = simulate::design::blade_study(&mut design, speed_rpm).map_err(|e| e.to_string())?;
    serde_json::to_value(study).map_err(|e| e.to_string())
}

/// Closed-loop engine-control study: Pc/MR loops, sensor/valve suite, chamber
/// dynamics, and the throttle step response.
#[tauri::command]
pub fn control_study(state: State<'_, AppState>, feed_type: String) -> Result<serde_json::Value, String> {
    let mut design = current_design(&state)?;
    let study = simulate::design::control_study(&mut design, &feed_type).map_err(|e| e.to_string())?;
    serde_json::to_value(study).map_err(|e| e.to_string())
}

/// Sensor/position validation: spatial predicted-vs-measured profiles plus the
/// startup time-series.
#[tauri::command]
pub fn validation_study(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let mut design = current_design(&state)?;
    let study = simulate::design::validation_study(&mut design).map_err(|e| e.to_string())?;
    serde_json::to_value(study).map_err(|e| e.to_string())
}

/// Consolidated issues/warnings report: every failed margin / domain violation /
/// study warning gathered in one place.
#[tauri::command]
pub fn issues_report(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let mut design = current_design(&state)?;
    let report = simulate::design::collect_issues(&mut design).map_err(|e| e.to_string())?;
    serde_json::to_value(report).map_err(|e| e.to_string())
}

/// Parametric sweep (CEA-style): equilibrium thermochemistry over a Pc × O/F grid.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn sweep(
    state: State<'_, AppState>,
    pc_min_bar: f64,
    pc_max_bar: f64,
    pc_steps: f64,
    of_min: f64,
    of_max: f64,
    of_steps: f64,
) -> Result<serde_json::Value, String> {
    let design = current_design(&state)?;
    let r = simulate::design::sweep(&design, pc_min_bar, pc_max_bar, pc_steps as usize, of_min, of_max, of_steps as usize)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(r).map_err(|e| e.to_string())
}

/// Trade/optimization studies (section G): O/F, expansion, L*, material, injector.
#[tauri::command]
pub fn trade_bundle(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let mut design = current_design(&state)?;
    let bundle = simulate::design::trade_bundle(&mut design).map_err(|e| e.to_string())?;
    serde_json::to_value(bundle).map_err(|e| e.to_string())
}

/// Advanced feed-system + tank study (section F).
#[tauri::command]
pub fn feed_study(
    state: State<'_, AppState>,
    burn_time_s: f64,
    feed_type: String,
) -> Result<serde_json::Value, String> {
    let mut design = current_design(&state)?;
    let study = simulate::design::feed_study(&mut design, burn_time_s, &feed_type).map_err(|e| e.to_string())?;
    serde_json::to_value(study).map_err(|e| e.to_string())
}
