//! Design-orchestration studies surfaced to the desktop UI.
//!
//! These compose the physics crates into the higher-level "design decisions" the
//! step-by-step designer needs: performance advice (optimal O/F, recommended L*,
//! optimal nozzle expansion), the cooling study (material choice + regen / film /
//! radiation / ablative), and the turbomachinery study (pumps, turbine, inducer,
//! shaft, bearing and the gas-generator cycle balance). All results are serde
//! types so the Tauri host can hand them to the frontend directly.

use engine_core::{EngineDesign, EngineError, Tier};
use serde::Serialize;

use crate::{payload, resolve};

const SEA_LEVEL_PA: f64 = 101_325.0;

/// Performance-advice bundle (section A).
#[derive(Debug, Clone, Serialize)]
pub struct DesignAdvice {
    pub current_of: f64,
    pub optimal_of: f64,
    pub optimal_isp_vac_s: f64,
    pub recommended_l_star_m: f64,
    pub expansion: gasdynamics::optimize::ExpansionStudyResult,
}

/// Compute performance advice for the current design over an ascent to
/// `burnout_altitude_m`.
pub fn design_advice(design: &mut EngineDesign, burnout_altitude_m: f64) -> Result<DesignAdvice, EngineError> {
    resolve(design)?;
    let l1: thermo::ThermoResult = payload(design, Tier::L1)?;
    let pc = design.operating_point.chamber_pressure.as_si();
    let pair = design.propellant.pair;

    let (optimal_of, optimal_isp) = thermo::optimal_of(pair, pc);
    let recommended_l_star = sizing_l0::recommended_l_star(pair);

    let expansion = gasdynamics::optimize::optimal_expansion(&gasdynamics::optimize::ExpansionStudyInput {
        gamma: l1.gamma,
        pc_pa: pc,
        sea_level_pressure_pa: SEA_LEVEL_PA,
        ambient_samples_pa: gasdynamics::optimize::uniform_ascent_samples(SEA_LEVEL_PA, 0.0, burnout_altitude_m, 40),
        area_ratio_bounds: (1.5, 300.0),
    });

    Ok(DesignAdvice {
        current_of: design.operating_point.mixture_ratio.as_f64(),
        optimal_of,
        optimal_isp_vac_s: optimal_isp,
        recommended_l_star_m: recommended_l_star,
        expansion,
    })
}

/// Cooling study (section C): material choice plus regen / film / radiation /
/// ablative results for the current contour.
#[derive(Debug, Clone, Serialize)]
pub struct CoolingStudy {
    pub materials: Vec<cooling::materials::Material>,
    pub selected_material: String,
    pub method: String,
    pub regen: cooling::CoolingResult,
    pub film: Option<cooling::film::FilmCoolingResult>,
    pub radiation: Option<cooling::radiation::RadiationResult>,
    pub ablative: Option<cooling::ablative::AblativeResult>,
    /// Multi-material: a radiation-cooled nozzle extension in a second material.
    pub nozzle_extension_material: Option<String>,
    pub nozzle_extension: Option<cooling::radiation::RadiationResult>,
    /// Per-station heat-flux CSV (FEM boundary condition).
    pub heat_flux_csv: String,
    /// Multi-material additive-manufacturing build plan with graded transitions.
    pub print_plan: cooling::printing::PrintPlan,
}

/// Run the cooling study for a chosen wall material and cooling method
/// (`"regen" | "film" | "radiation" | "ablative"`).
pub fn cooling_study(design: &mut EngineDesign, material_name: &str, method: &str) -> Result<CoolingStudy, EngineError> {
    resolve(design)?;
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let l1: thermo::ThermoResult = payload(design, Tier::L1)?;

    let material = cooling::materials::by_name(material_name).unwrap_or_else(cooling::materials::copper_ofhc);

    // Base regenerative solve on the current contour, with the chosen material and
    // optional wall film.
    // --- User design inputs (persisted cooling.* params; best-practice defaults) ---
    let film_coolant_temp = design.param("cooling.film_coolant_temp_k", 400.0);
    let film_coolant_density = design.param("cooling.film_coolant_density", 5.0).max(0.1);
    let film_coolant_velocity = design.param("cooling.film_coolant_velocity", 120.0).max(1.0);
    let film_slot_height = design.param("cooling.film_slot_height_mm", 1.5).max(0.1) * 1e-3;
    let film_injection_x = design.param("cooling.film_injection_x_m", 0.0);
    let film_visc = design.param("cooling.film_coolant_viscosity", 2.0e-5).max(1e-7);
    let ablative_burn_time = design.param("cooling.ablative_burn_time_s", 30.0).max(1.0);
    let ablative_sf = design.param("cooling.ablative_safety_factor", 1.5).clamp(1.0, 3.0);
    let radiation_ambient = design.param("cooling.radiation_ambient_k", 250.0);
    let ablative_material = match design.choice("cooling.ablative_material", "Carbon phenolic") {
        s if s.to_lowercase().contains("silica") => cooling::materials::silica_phenolic(),
        _ => cooling::materials::carbon_phenolic(),
    };

    let mut l3 = crate::l3_input(design)?;
    l3.wall_material = material.clone();
    if method == "film" {
        l3.film_cooling = Some(cooling::FilmCoolingConfig {
            injection_x_m: film_injection_x,
            coolant_temp_k: film_coolant_temp,
            coolant_density_kg_m3: film_coolant_density,
            coolant_velocity_m_s: film_coolant_velocity,
            coolant_viscosity_pa_s: film_visc,
            slot_height_m: film_slot_height,
        });
    }
    let regen = cooling::solve_l3(&l3)?;

    let peak_h = regen.stations.iter().map(|s| s.h_gas).fold(0.0, f64::max);
    let peak_q = regen.stations.iter().map(|s| s.heat_flux_w_m2).fold(0.0, f64::max);

    let film = if method == "film" {
        Some(cooling::film::solve_film(&cooling::film::FilmCoolingInput {
            gas_temp_k: l1.tc_k,
            gas_density_kg_m3: 4.0,
            gas_velocity_m_s: 950.0,
            coolant_temp_k: film_coolant_temp,
            coolant_density_kg_m3: film_coolant_density,
            coolant_velocity_m_s: film_coolant_velocity,
            coolant_viscosity_pa_s: film_visc,
            slot_height_m: film_slot_height,
            distance_m: 0.05,
        }))
    } else {
        None
    };

    let radiation = if method == "radiation" {
        Some(cooling::radiation::solve_radiation(&cooling::radiation::RadiationInput {
            h_gas: peak_h.max(500.0),
            adiabatic_gas_temp_k: l1.tc_k * 0.9,
            ambient_temp_k: radiation_ambient,
            material: material.clone(),
        }))
    } else {
        None
    };

    let ablative = if method == "ablative" {
        Some(cooling::ablative::solve_ablative(&cooling::ablative::AblativeInput {
            heat_flux_w_m2: peak_q.max(1.0e6),
            burn_time_s: ablative_burn_time,
            material: ablative_material,
            safety_factor: ablative_sf,
        }))
    } else {
        None
    };

    // Multi-material: if a (radiation-class) nozzle-extension material is assigned,
    // size it as a radiation-cooled skirt seeing the lower-flux exit gas.
    let nozzle_extension_material = design.materials.nozzle.clone();
    let nozzle_extension = nozzle_extension_material.as_deref().and_then(cooling::materials::by_name).map(|ext| {
        cooling::radiation::solve_radiation(&cooling::radiation::RadiationInput {
            h_gas: (peak_h * 0.35).max(400.0),
            adiabatic_gas_temp_k: l1.tc_k * 0.6,
            ambient_temp_k: radiation_ambient,
            material: ext,
        })
    });

    let heat_flux_csv = regen.heat_flux_csv();

    // Additive-manufacturing build plan: split the engine into axial regions
    // (chamber barrel, precision throat, diverging nozzle, and — when a second
    // material is assigned — a radiation skirt), each with its AM process, and
    // insert a functionally-graded transition at every dissimilar-material seam.
    let x_exit = regen.stations.iter().map(|s| s.x).fold(0.0_f64, f64::max);
    let throat_band = (0.05 * x_exit).clamp(0.005, 0.02);
    let ext_mat = nozzle_extension_material.as_deref().and_then(cooling::materials::by_name);
    let x_ext = if ext_mat.is_some() {
        throat_band + 0.6 * (x_exit - throat_band)
    } else {
        x_exit
    };
    let mut region_specs = vec![
        cooling::printing::RegionSpec {
            name: "Injector face + chamber barrel".into(),
            x_start_m: -l0.chamber_length.as_si(),
            x_end_m: 0.0,
            material: material.clone(),
            high_precision: false,
        },
        cooling::printing::RegionSpec {
            name: "Throat (precision)".into(),
            x_start_m: 0.0,
            x_end_m: throat_band,
            material: material.clone(),
            high_precision: true,
        },
        cooling::printing::RegionSpec {
            name: "Diverging nozzle (regen)".into(),
            x_start_m: throat_band,
            x_end_m: x_ext,
            material: material.clone(),
            high_precision: false,
        },
    ];
    if let Some(ext) = ext_mat {
        region_specs.push(cooling::printing::RegionSpec {
            name: "Radiation skirt".into(),
            x_start_m: x_ext,
            x_end_m: x_exit,
            material: ext,
            high_precision: false,
        });
    }
    let print_plan = cooling::printing::build_print_plan(&region_specs);

    Ok(CoolingStudy {
        materials: cooling::materials::all(),
        selected_material: material.name.clone(),
        method: method.to_string(),
        regen,
        film,
        radiation,
        ablative,
        nozzle_extension_material,
        nozzle_extension,
        heat_flux_csv,
        print_plan,
    })
}

/// Blade profiling, meanline losses and characteristic maps for the turbopump.
#[derive(Debug, Clone, Serialize)]
pub struct BladeStudy {
    pub speed_rpm: f64,
    pub pump_blade: turbopumps::blade::BladeProfile,
    pub turbine_blade: turbopumps::blade::BladeProfile,
    /// Supersonic turbine rotor blade (circular-arc / fixed-edge / MoC transition).
    pub supersonic_blade: turbopumps::blade::BladeProfile,
    pub pump_losses: turbopumps::losses::LossBreakdown,
    pub turbine_losses: turbopumps::losses::LossBreakdown,
    pub pump_map: turbopumps::characteristic::PumpMap,
    pub turbine_map: turbopumps::characteristic::TurbineMap,
    /// Impeller tip speed U₂ and the material/propellant structural limit (m/s).
    pub pump_tip_speed_m_s: f64,
    pub pump_tip_speed_limit_m_s: f64,
    /// Derived relative inlet Mach for the supersonic rotor.
    pub turbine_inlet_mach: f64,
    /// Recommended turbine type from the velocity ratio U/C₀ (NASA SP-8107).
    pub recommended_turbine_type: String,
    /// Design-rule warnings (tip-speed, turbine PR range, …) from the references.
    pub warnings: Vec<String>,
}

/// Turbine type recommended for a velocity ratio U/C₀ (NASA SP-8107, figs 21–23):
/// < 0.2 two-row velocity-compounded impulse; 0.2–0.34 two-stage pressure-
/// compounded impulse; > 0.34 reaction.
fn recommended_turbine_type(velocity_ratio: f64) -> &'static str {
    if velocity_ratio < 0.2 {
        "2-row velocity-compounded impulse"
    } else if velocity_ratio <= 0.34 {
        "two-stage pressure-compounded impulse"
    } else {
        "reaction (or single-stage impulse)"
    }
}

/// Impeller tip-speed structural limit (m/s) for a material, from Cannon (NASA):
/// ~610 m/s titanium (LH2), ~274 m/s Inconel-718 (LOX); a general steel default.
fn impeller_tip_limit(material: &str) -> f64 {
    match material.to_lowercase() {
        m if m.contains("titan") || m.contains("ti-") => 610.0,
        m if m.contains("inconel") || m.contains("718") => 274.0,
        m if m.contains("alumin") => 350.0,
        _ => 400.0,
    }
}

/// Blade profiling + loss models + characteristic maps for the current design.
/// Every design assumption is a persisted `blade.*` param with a physical default,
/// so the velocity-triangle / slip / loss methods recompute for custom inputs.
pub fn blade_study(design: &mut EngineDesign, speed_rpm: f64) -> Result<BladeStudy, EngineError> {
    resolve(design)?;
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let pc = design.operating_point.chamber_pressure.as_si();
    let density = propellants::props_for(design.propellant.pair).and_then(|p| p.density_kg_m3).unwrap_or(1000.0);
    let total_flow = l0.total_flow.as_si();

    // --- User design inputs (persisted params; defaults grounded in the refs) ---
    let tank_pa = design.param("blade.suction_pressure_bar", 3.0) * 1e5;
    let blade_count_pump = design.param("blade.pump_blade_count", 6.0).round().clamp(2.0, 40.0) as u32;
    let pump_beta2 = design.param("blade.pump_outlet_angle_deg", 22.5);
    let pump_cm = design.param("blade.pump_inlet_axial_vel", 10.0);
    let pump_eff = design.param("blade.pump_efficiency", 0.7).clamp(0.3, 0.95);
    let nozzle_angle = design.param("blade.nozzle_angle_deg", 20.0);
    let turbine_z = design.param("blade.turbine_blade_count", 40.0).round().clamp(4.0, 200.0) as u32;
    let ss_z = design.param("blade.supersonic_blade_count", 50.0).round().clamp(4.0, 200.0) as u32;
    let gg_frac = design.param("blade.gg_flow_fraction", 0.03).clamp(0.005, 0.5);
    let cp_t = design.param("blade.turbine_cp", 2000.0);
    let tin_t = design.param("blade.turbine_inlet_temp_k", 950.0);
    let g_t = design.param("blade.turbine_gamma", 1.3);
    // pressure_ratio: ≤1 → auto from Pc; else the user's value (impulse range 8–20).
    let pr_user = design.param("blade.turbine_pressure_ratio", 0.0);
    let pr_t = if pr_user > 1.0 { pr_user } else { (pc * 0.9 / 3.0e5).max(1.5) };
    let clearance = design.param("blade.clearance_ratio", 0.02);
    let aspect = design.param("blade.aspect_ratio", 2.0);
    let vel_ratio = design.param("blade.velocity_ratio", 0.47);
    let blade_vel_coeff = design.param("blade.turbine_blade_velocity_coeff", 0.9);
    let impeller_material = design.choice("blade.impeller_material", "Inconel 718");
    let head = ((pc * 1.25) - tank_pa).max(0.0) / (density * 9.80665);

    let mut warnings: Vec<String> = Vec::new();

    let pump = turbopumps::solve_pump(&turbopumps::PumpInput {
        mass_flow_kg_s: total_flow,
        density_kg_m3: density,
        suction_pressure_pa: tank_pa,
        discharge_pressure_pa: pc * 1.25,
        vapor_pressure_pa: 5.0e3,
        speed_rpm,
        efficiency: pump_eff,
        suction_specific_speed: design.param("blade.suction_specific_speed", 500.0),
    });
    let inducer = turbopumps::solve_inducer(&turbopumps::InducerInput {
        mass_flow_kg_s: total_flow,
        density_kg_m3: density,
        speed_rpm,
        npsh_available_m: (tank_pa - 5.0e3) / (density * 9.80665),
        hub_ratio: design.param("blade.inducer_hub_ratio", 0.4).clamp(0.2, 0.7),
    });

    let pump_blade = turbopumps::blade::pump_impeller_blade(&turbopumps::blade::PumpBladeInput {
        mass_flow_kg_s: total_flow,
        density_kg_m3: density,
        head_m: head,
        speed_rpm,
        blade_count: blade_count_pump,
        outlet_blade_angle_deg: pump_beta2,
        inlet_axial_velocity_m_s: pump_cm,
    });

    // Impeller tip-speed structural check (Cannon / Humble): U₂ = ω·r₂.
    let omega = 2.0 * std::f64::consts::PI * speed_rpm / 60.0;
    let pump_tip_speed = omega * pump_blade.outlet_radius_m;
    let tip_limit = impeller_tip_limit(&impeller_material);
    if pump_tip_speed > tip_limit {
        warnings.push(format!(
            "Impeller tip speed {:.0} m/s exceeds the {:.0} m/s limit for {} — lower shaft speed or use multiple stages",
            pump_tip_speed, tip_limit, impeller_material
        ));
    }

    let turbine_blade = turbopumps::blade::turbine_rotor_blade(&turbopumps::blade::TurbineBladeInput {
        power_w: pump.shaft_power_w,
        mass_flow_kg_s: (total_flow * gg_frac).max(0.05),
        cp_j_kg_k: cp_t,
        inlet_temp_k: tin_t,
        gamma: g_t,
        pressure_ratio: pr_t.max(1.5),
        speed_rpm,
        blade_count: turbine_z,
        nozzle_angle_deg: nozzle_angle,
    });
    if pr_user > 1.0 && !(8.0..=20.0).contains(&pr_user) {
        warnings.push(format!(
            "Turbine pressure ratio {:.1} is outside the typical single-stage impulse range 8–20",
            pr_user
        ));
    }

    // Supersonic turbine blade: derive the relative inlet Mach and flow angle from
    // the same drive-gas velocity triangle used for the subsonic rotor.
    let dh_t = cp_t * tin_t * (1.0 - pr_t.powf(-(g_t - 1.0) / g_t));
    let c1 = (2.0 * dh_t.max(1.0)).sqrt();
    let alpha1 = nozzle_angle.to_radians(); // absolute flow angle from tangential
    let u_t = 0.5 * c1 * alpha1.cos();
    let cm1 = c1 * alpha1.sin();
    let wu1 = c1 * alpha1.cos() - u_t;
    let w1 = (cm1 * cm1 + wu1 * wu1).sqrt();
    let t1 = (tin_t - dh_t / cp_t).max(50.0);
    let r_gas = cp_t * (g_t - 1.0) / g_t;
    let a1 = (g_t * r_gas * t1).sqrt();
    let m1 = (w1 / a1).max(1.05);
    let beta1_axial = 90.0 - cm1.atan2(wu1).to_degrees(); // relative flow angle from axial
    let r_mean_turb = (turbine_blade.inlet_radius_m + turbine_blade.outlet_radius_m) / 2.0;
    let supersonic_blade = turbopumps::blade::supersonic_turbine_blade(&turbopumps::blade::SupersonicBladeInput {
        inlet_mach: m1,
        exit_mach: m1, // pure-impulse: constant relative Mach through the passage
        inlet_flow_angle_deg: beta1_axial,
        exit_flow_angle_deg: beta1_axial,
        gamma: g_t,
        blade_count: ss_z,
        mean_radius_m: r_mean_turb,
    });

    let pump_losses = turbopumps::losses::pump_losses(&turbopumps::losses::PumpLossInput {
        specific_speed: pump.specific_speed,
        flow_coefficient: inducer.flow_coefficient,
        blade_count: blade_count_pump,
        clearance_ratio: clearance,
        reynolds: 1.0e6,
    });
    // Rotor turning ≈ 2·(90° − relative inlet angle) for an impulse blade.
    let deflection = (2.0 * (90.0 - turbine_blade.inlet_angle_deg)).abs().clamp(30.0, 150.0);
    let turbine_losses = turbopumps::losses::turbine_losses(&turbopumps::losses::TurbineLossInput {
        deflection_deg: deflection,
        aspect_ratio: aspect,
        clearance_ratio: clearance,
        velocity_ratio: vel_ratio,
    });

    let pump_map = turbopumps::characteristic::pump_map(total_flow / density.max(1.0), pump.head_rise_m, pump_eff);
    let turbine_map = turbopumps::characteristic::turbine_map(nozzle_angle, blade_vel_coeff);

    Ok(BladeStudy {
        speed_rpm, pump_blade, turbine_blade, supersonic_blade, pump_losses, turbine_losses, pump_map, turbine_map,
        pump_tip_speed_m_s: pump_tip_speed,
        pump_tip_speed_limit_m_s: tip_limit,
        turbine_inlet_mach: m1,
        recommended_turbine_type: recommended_turbine_type(vel_ratio).to_string(),
        warnings,
    })
}

// ---- Trade / optimization studies (section G) ------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct OfPoint {
    pub of: f64,
    pub isp_vac_s: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExpansionPoint {
    pub area_ratio: f64,
    pub cf_sea_level: f64,
    pub cf_vacuum: f64,
    pub isp_vacuum_s: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LStarPoint {
    pub l_star_m: f64,
    pub chamber_length_m: f64,
    pub chamber_volume_l: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MaterialTradeRow {
    pub name: String,
    pub max_wall_temp_k: f64,
    pub limit_k: f64,
    pub margin_k: f64,
    pub density_kg_m3: f64,
    pub cooling_class: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InjectorTradeRow {
    pub element_count: u32,
    pub injection_velocity_m_s: f64,
    pub smd_um: f64,
    pub momentum_ratio: f64,
    pub stable: bool,
}

/// Bundle of trade/optimization sweeps for the current design.
#[derive(Debug, Clone, Serialize)]
pub struct TradeBundle {
    pub of_sweep: Vec<OfPoint>,
    pub optimal_of: f64,
    pub expansion_sweep: Vec<ExpansionPoint>,
    pub optimal_area_ratio: f64,
    pub l_star_sweep: Vec<LStarPoint>,
    pub recommended_l_star_m: f64,
    pub material_trade: Vec<MaterialTradeRow>,
    pub injector_trade: Vec<InjectorTradeRow>,
}

/// Run the section-G trade studies: O/F, expansion (exit pressure), L*, material
/// and injector sweeps.
pub fn trade_bundle(design: &mut EngineDesign) -> Result<TradeBundle, EngineError> {
    resolve(design)?;
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let l1: thermo::ThermoResult = payload(design, Tier::L1)?;
    let pc = design.operating_point.chamber_pressure.as_si();
    let pair = design.propellant.pair;

    // O/F sweep → vacuum Isp.
    let mut of_sweep = Vec::new();
    let (of_lo, of_hi) = (0.8, 4.4);
    for k in 0..=18 {
        let of = of_lo + (of_hi - of_lo) * k as f64 / 18.0;
        if let Ok(r) = thermo::solve(&thermo::ThermoInput {
            of_ratio: of,
            chamber_pressure_pa: pc,
            propellant_pair: pair,
            method: thermo::ThermoMethod::GibbsFreeEnergy,
        }) {
            of_sweep.push(OfPoint { of: (of * 100.0).round() / 100.0, isp_vac_s: r.isp_vacuum_s });
        }
    }
    let (optimal_of, _) = thermo::optimal_of(pair, pc);

    // Expansion sweep → thrust coefficient at sea level and vacuum.
    let mut expansion_sweep = Vec::new();
    let g0 = 9.80665;
    for k in 0..=24 {
        let ar = 1.5 * (200.0_f64 / 1.5).powf(k as f64 / 24.0);
        let cf_sl = gasdynamics::optimize::thrust_coefficient(l1.gamma, pc, ar, 101_325.0);
        let cf_vac = gasdynamics::optimize::thrust_coefficient(l1.gamma, pc, ar, 0.0);
        expansion_sweep.push(ExpansionPoint {
            area_ratio: (ar * 10.0).round() / 10.0,
            cf_sea_level: cf_sl,
            cf_vacuum: cf_vac,
            isp_vacuum_s: l1.c_star_m_s * cf_vac / g0,
        });
    }
    let exp = gasdynamics::optimize::optimal_expansion(&gasdynamics::optimize::ExpansionStudyInput {
        gamma: l1.gamma,
        pc_pa: pc,
        sea_level_pressure_pa: 101_325.0,
        ambient_samples_pa: gasdynamics::optimize::uniform_ascent_samples(101_325.0, 0.0, 40_000.0, 30),
        area_ratio_bounds: (1.5, 200.0),
    });

    // L* sweep → chamber length / volume.
    let throat_area = l0.throat_area.as_si();
    let chamber_area = std::f64::consts::PI * (l0.chamber_diameter.as_si() / 2.0).powi(2);
    let mut l_star_sweep = Vec::new();
    for k in 0..=15 {
        let l_star = 0.5 + (2.0 - 0.5) * k as f64 / 15.0;
        let vol = throat_area * l_star;
        l_star_sweep.push(LStarPoint {
            l_star_m: (l_star * 100.0).round() / 100.0,
            chamber_length_m: vol / chamber_area,
            chamber_volume_l: vol * 1000.0,
        });
    }

    // Material trade: run the regen solve for each wall material.
    let mut l3 = crate::l3_input(design)?;
    let mut material_trade = Vec::new();
    for m in cooling::materials::all() {
        l3.wall_material = m.clone();
        if let Ok(r) = cooling::solve_l3(&l3) {
            material_trade.push(MaterialTradeRow {
                name: m.name.clone(),
                max_wall_temp_k: r.max_wall_temp_k,
                limit_k: m.max_service_temp_k,
                margin_k: m.max_service_temp_k - r.max_wall_temp_k,
                density_kg_m3: m.density_kg_m3,
                cooling_class: format!("{:?}", m.cooling_class),
                ok: r.max_wall_temp_k <= m.max_service_temp_k,
            });
        }
    }

    // Injector trade: sweep the element count.
    let density = propellants::props_for(pair).and_then(|p| p.density_kg_m3).unwrap_or(1000.0);
    let gas_density = pc / ((8314.462 / l1.mean_molecular_weight) * l1.tc_k);
    let mut injector_trade = Vec::new();
    for &n in &[8u32, 16, 24, 32, 48, 64] {
        let r = injector::flow::solve_injector_flow(&injector::flow::InjectorFlowInput {
            ox_flow_kg_s: l0.oxidizer_flow.as_si(),
            fuel_flow_kg_s: l0.fuel_flow.as_si(),
            ox_density_kg_m3: density,
            fuel_density_kg_m3: density * 0.72,
            chamber_pressure_pa: pc,
            dp_fraction: 0.2,
            element_count: n,
            discharge_coefficient: 0.7,
            surface_tension_n_m: 0.02,
            gas_density_kg_m3: gas_density,
            element_type: injector::flow::ElementType::UnlikeDoublet,
        });
        injector_trade.push(InjectorTradeRow {
            element_count: n,
            injection_velocity_m_s: r.ox.injection_velocity_m_s,
            smd_um: r.ox.sauter_mean_diameter_m * 1e6,
            momentum_ratio: r.momentum_ratio,
            stable: r.flags.is_empty(),
        });
    }

    Ok(TradeBundle {
        of_sweep,
        optimal_of,
        expansion_sweep,
        optimal_area_ratio: exp.optimal_area_ratio,
        l_star_sweep,
        recommended_l_star_m: sizing_l0::recommended_l_star(pair),
        material_trade,
        injector_trade,
    })
}

/// Closed-loop engine-control study (NASA TM-105318): Pc/MR loop architecture,
/// sensor/valve suite, chamber dynamics, and the closed-loop throttle response.
pub fn control_study(design: &mut EngineDesign, feed_type: &str) -> Result<feedsystem::control::ControlStudy, EngineError> {
    resolve(design)?;
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let pc = design.operating_point.chamber_pressure.as_si();
    let mr = design.operating_point.mixture_ratio.as_f64();

    // Recommend the cycle the same way the feed study does when unset.
    let pair = design.propellant.pair;
    let vapor = propellants::props_for(pair).and_then(|p| p.vapor_pressure_pa);
    let recommended = if vapor.map(|v| v >= 1.25 * pc).unwrap_or(false) {
        "self-pressurizing"
    } else if pc <= 3.5e6 {
        "pressure-fed"
    } else {
        "pump-fed"
    };
    let feed = if feed_type.is_empty() { recommended } else { feed_type };

    Ok(feedsystem::control::solve_control(&feedsystem::control::ControlInput {
        feed_type: feed.to_string(),
        pc_pa: pc,
        mr,
        chamber_volume_m3: l0.chamber_volume.as_si(),
        c_star_m_s: l0.c_star_m_s,
        throat_area_m2: l0.throat_area.as_si(),
        pc_bandwidth_hz: design.param("control.pc_bandwidth_hz", 5.0).clamp(0.1, 100.0),
        mr_bandwidth_hz: design.param("control.mr_bandwidth_hz", 20.0).clamp(0.1, 200.0),
        sample_rate_hz: design.param("control.sample_rate_hz", 50.0).clamp(1.0, 5000.0),
        combustion_delay_ms: design.param("control.combustion_delay_ms", 1.5).clamp(0.0, 20.0),
        throttle_target: design.param("control.throttle_target", 0.8).clamp(0.2, 1.5),
        // Redline defaults to a margin above the nominal turbine-inlet temperature
        // (so it protects against an over-temperature excursion and can actually trip).
        turbine_inlet_temp_k: design.param("turbo.turbine_inlet_temp_k", 950.0),
        turbine_redline_k: design.param(
            "control.turbine_redline_k",
            design.param("turbo.turbine_inlet_temp_k", 950.0) + 200.0,
        ),
    }))
}

// ---- Consolidated issues / warnings report -------------------------------

/// One design-check finding.
#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    /// "fail" (a hard margin/domain violation) or "warn" (an advisory).
    pub severity: String,
    /// The subsystem / tab the finding belongs to.
    pub area: String,
    pub message: String,
}

/// All design checks gathered in one place, so failures aren't hidden per-tab.
#[derive(Debug, Clone, Serialize)]
pub struct IssuesReport {
    pub issues: Vec<Issue>,
    pub failed: usize,
    pub warnings: usize,
}

/// Run the key studies and collect every failed margin / domain violation / study
/// warning into a single report (report issues #27, #38, #45, #50, #55; Missing-Option #17).
pub fn collect_issues(design: &mut EngineDesign) -> Result<IssuesReport, EngineError> {
    resolve(design)?;
    let mut issues: Vec<Issue> = Vec::new();
    let mut add = |sev: &str, area: &str, message: String| {
        issues.push(Issue { severity: sev.into(), area: area.into(), message });
    };

    let pc = design.operating_point.chamber_pressure.as_si();
    let pair = design.propellant.pair;
    let vapor = propellants::props_for(pair).and_then(|p| p.vapor_pressure_pa);
    let self_press = vapor.map(|v| v >= 1.25 * pc).unwrap_or(false);
    let is_pump_fed = !self_press && pc > 3.5e6;

    // --- Cooling ---
    let material = design.materials.chamber.clone().unwrap_or_else(|| "OFHC Copper".into());
    let method = design
        .geometry
        .cooling_jacket
        .as_ref()
        .and_then(|c| c.cooling_method.clone())
        .unwrap_or_else(|| "regen".into());
    if let Ok(c) = cooling_study(design, &material, &method) {
        if c.regen.max_wall_temp_k > c.regen.wall_material_limit_k {
            add("fail", "Cooling", format!(
                "Wall temperature {:.0} K exceeds the {} limit {:.0} K (margin {:.0} K)",
                c.regen.max_wall_temp_k, c.selected_material, c.regen.wall_material_limit_k,
                c.regen.wall_material_limit_k - c.regen.max_wall_temp_k
            ));
        }
        if c.regen.min_boiling_margin_k < 0.0 {
            add("fail", "Cooling", format!("Coolant boils — boiling margin {:.0} K", c.regen.min_boiling_margin_k));
        }
        if method == "regen" {
            if let Some(mat) = cooling::materials::by_name(&material) {
                if !matches!(mat.cooling_class, cooling::materials::CoolingClass::Regenerative) {
                    add("warn", "Cooling", format!(
                        "{material} is a {:?}-class material but regenerative cooling is selected",
                        mat.cooling_class
                    ));
                }
            }
        }
        if let Some(ext) = &c.nozzle_extension {
            if !ext.material_ok {
                add("fail", "Cooling", format!(
                    "Radiation skirt wall {:.0} K exceeds the {} limit {:.0} K",
                    ext.equilibrium_wall_temp_k,
                    c.nozzle_extension_material.clone().unwrap_or_default(),
                    ext.material_limit_k
                ));
            }
        }
    }

    // --- Analysis (structures + injector/instability) ---
    if let Ok(a) = analysis_study(design) {
        if a.stress.min_margin < 1.0 {
            add("fail", "Analysis", format!(
                "Structural margin {:.2} below 1.0 (peak σ {:.0} MPa)",
                a.stress.min_margin, a.stress.max_combined_stress_pa / 1e6
            ));
        }
        if !a.instability.stable {
            add("warn", "Analysis", format!(
                "Combustion-instability risk: {} {:.0} Hz, margin {:.2}",
                a.instability.dominant_mode, a.instability.dominant_frequency_hz, a.instability.stability_margin
            ));
        }
        for f in &a.injector.flags {
            add("warn", "Injector", f.clone());
        }
    }

    // --- Turbopumps / blades (only meaningful for a pump-fed engine) ---
    if is_pump_fed {
        let rpm = design.param("turbo.shaft_speed_rpm", 20_000.0);
        if let Ok(tp) = turbopump_study(design, rpm) {
            if !tp.bearing.dn_ok {
                add("warn", "Turbopumps", format!("Bearing DN {:.2}M exceeds its limit", tp.bearing.dn_value / 1e6));
            }
            if !tp.bearing.life_ok {
                add("warn", "Turbopumps", "Bearing L10 life is below the required life".into());
            }
            if tp.pump.cavitation_margin_m < 0.0 {
                add("warn", "Turbopumps", format!("Pump cavitates — NPSH margin {:.1} m", tp.pump.cavitation_margin_m));
            }
            if !tp.shaft.subcritical {
                add("warn", "Turbopumps", format!("Shaft runs supercritical (N_cr {:.0} rpm < {:.0} rpm)", tp.shaft.first_critical_rpm, rpm));
            }
            if tp.gg_cycle.margin < 1.0 {
                add("warn", "Turbopumps", format!("Gas-generator cycle under-powered — turbine/pump power {:.2}", tp.gg_cycle.margin));
            }
            let bore_mm = design.param("turbo.bearing_bore_mm", 45.0);
            let shaft_mm = tp.shaft.diameter_m * 1000.0;
            if bore_mm > 3.0 * shaft_mm {
                add("warn", "Turbopumps", format!(
                    "Bearing bore {bore_mm:.0} mm is far larger than the {shaft_mm:.1} mm shaft — incompatible sizing"
                ));
            }
        }
        if let Ok(b) = blade_study(design, rpm) {
            for w in &b.warnings {
                add("warn", "Blades", w.clone());
            }
        }
        if let Ok(ctrl) = control_study(design, "") {
            for w in &ctrl.warnings {
                add("warn", "Control", w.clone());
            }
        }
    }

    // --- Feed system ---
    if oxidizer_is_gaseous(pair) {
        add("warn", "Feed System",
            "Gaseous oxidizer (GOX): the tank is sized as a compressed gas — expect a large bottle volume or a high storage pressure".into());
    }
    // Turbopumps are impractical to build below roughly 0.5 kg/s total flow —
    // a small pressure-fed system is more realistic there (#33).
    if is_pump_fed {
        if let Ok(l0) = payload::<sizing_l0::L0Result>(design, Tier::L0) {
            let flow = l0.total_flow.as_si();
            if flow < 0.5 {
                add("warn", "Feed System", format!(
                    "Pump-fed selected at {flow:.3} kg/s — turbopumps are very hard to build this small; consider a pressure-fed system"
                ));
            }
        }
    }

    let failed = issues.iter().filter(|i| i.severity == "fail").count();
    let warnings = issues.len() - failed;
    Ok(IssuesReport { issues, failed, warnings })
}

/// True when the oxidizer is stored as a gas (GOX pairs), so its tank density
/// follows the ideal-gas law at the tank pressure rather than a liquid density.
pub fn oxidizer_is_gaseous(pair: engine_core::PropellantPair) -> bool {
    use engine_core::PropellantPair as P;
    matches!(pair, P::GoxKerosene | P::GoxGasoline | P::GoxEthanol | P::GoxMethanol)
}

/// Representative separate oxidizer/fuel bulk densities for a pair (kg/m³).
pub fn component_densities(pair: engine_core::PropellantPair) -> (f64, f64) {
    use engine_core::PropellantPair as P;
    match pair {
        P::Unset => (1000.0, 800.0), // never reached for a configured design
        P::GoxKerosene | P::LoxRp1 => (1140.0, 810.0),
        P::GoxGasoline => (1140.0, 740.0),
        P::GoxEthanol | P::LoxEthanol => (1140.0, 789.0),
        P::GoxMethanol => (1140.0, 792.0),
        P::LoxMethane => (1140.0, 423.0),
        P::NitrousPropane => (745.0, 493.0),
        P::NtoMmh => (1443.0, 874.0),
        P::NtoUdmh => (1443.0, 793.0),
        P::LoxHydrogen => (1140.0, 71.0),
        P::H2o2Kerosene => (1390.0, 810.0),
    }
}

/// A propellant tank.
#[derive(Debug, Clone, Serialize)]
pub struct TankSpec {
    pub propellant: String,
    pub propellant_mass_kg: f64,
    pub volume_l: f64,
    pub diameter_m: f64,
    pub length_m: f64,
    pub wall_thickness_m: f64,
    pub tank_mass_kg: f64,
}

/// Pressurant (gas) requirement for a pressure-fed system.
#[derive(Debug, Clone, Serialize)]
pub struct PressurantSpec {
    pub gas: String,
    pub mass_kg: f64,
    pub bottle_volume_l: f64,
    pub bottle_pressure_bar: f64,
}

/// Feed pressure budget.
#[derive(Debug, Clone, Serialize)]
pub struct FeedBudget {
    pub chamber_pressure_pa: f64,
    pub injector_dp_pa: f64,
    pub line_dp_pa: f64,
    pub required_tank_pressure_pa: f64,
}

/// Advanced feed-system + tank study (section F).
#[derive(Debug, Clone, Serialize)]
pub struct FeedStudy {
    pub feed_type: String,
    pub burn_time_s: f64,
    pub ox_tank: TankSpec,
    pub fuel_tank: TankSpec,
    pub tank_pressure_pa: f64,
    pub total_propellant_mass_kg: f64,
    pub dry_tank_mass_kg: f64,
    pub pressurant: Option<PressurantSpec>,
    pub feed_budget: FeedBudget,
    /// Auto-recommended feed type for this design.
    pub recommended_feed: String,
    /// Avionics electrical harness and power budget for this architecture.
    pub harness: feedsystem::avionics::AvionicsHarness,
}

struct TankParams {
    ullage: f64,
    ld_ratio: f64,
    allowable_pa: f64,
    test_factor: f64,
    wall_density: f64,
}

fn size_tank(name: &str, mass: f64, density: f64, tank_pressure_pa: f64, tp: &TankParams) -> TankSpec {
    let ullage = tp.ullage;
    let volume = mass / density.max(1.0) * ullage;
    // Cylindrical tank at the chosen L/D.
    let d = (4.0 * volume / (tp.ld_ratio * std::f64::consts::PI)).cbrt();
    let l = tp.ld_ratio * d;
    // Thin-wall hoop stress with the chosen allowable and test factor.
    let wall = (tp.test_factor * tank_pressure_pa * (d / 2.0) / tp.allowable_pa).max(0.0006);
    let surface = std::f64::consts::PI * d * l + 2.0 * std::f64::consts::PI * (d / 2.0).powi(2);
    let tank_mass = surface * wall * tp.wall_density;
    TankSpec {
        propellant: name.to_string(),
        propellant_mass_kg: mass,
        volume_l: volume * 1000.0,
        diameter_m: d,
        length_m: l,
        wall_thickness_m: wall,
        tank_mass_kg: tank_mass,
    }
}

/// Size the feed system and tanks for a burn time and feed architecture
/// (`"self-pressurizing" | "pressure-fed" | "pump-fed"`).
pub fn feed_study(design: &mut EngineDesign, burn_time_s: f64, feed_type: &str) -> Result<FeedStudy, EngineError> {
    resolve(design)?;
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let pc = design.operating_point.chamber_pressure.as_si();
    let pair = design.propellant.pair;
    let (ox_rho_liquid, fuel_rho) = component_densities(pair);
    let props = propellants::props_for(pair);
    let vapor = props.and_then(|p| p.vapor_pressure_pa);

    let ox_mass = l0.oxidizer_flow.as_si() * burn_time_s;
    let fuel_mass = l0.fuel_flow.as_si() * burn_time_s;

    // Recommended architecture: self-pressurizing if the vapor pressure alone can
    // feed the chamber; else pressure-fed for low Pc, pump-fed for high Pc.
    let recommended = if vapor.map(|v| v >= 1.25 * pc).unwrap_or(false) {
        "self-pressurizing"
    } else if pc <= 3.5e6 {
        "pressure-fed"
    } else {
        "pump-fed"
    };
    let feed = if feed_type.is_empty() { recommended } else { feed_type };

    // --- User design inputs (persisted feed.* params; doc-grounded defaults) ---
    let injector_dp = design.param("feed.injector_dp_fraction", 0.2).clamp(0.05, 0.5) * pc;
    let line_dp = design.param("feed.line_dp_bar", 1.0) * 1e5;
    let required_tank = pc + injector_dp + line_dp;
    let pumpfed_tank = design.param("feed.pumpfed_tank_bar", 3.0) * 1e5;
    let tank_pressure = match feed {
        "self-pressurizing" => vapor.unwrap_or(required_tank),
        "pump-fed" => pumpfed_tank,
        _ => required_tank,
    };

    // Gaseous-oxidizer (GOX) pairs store the oxidizer as a compressed gas, so its
    // tank density follows the ideal-gas law at the tank pressure (≈ P·MW/(R·T)),
    // not the liquid-oxygen density. This makes the GOX tank volume physical.
    let ox_rho = if oxidizer_is_gaseous(pair) {
        let storage_t = design.param("feed.gas_storage_temp_k", 293.0).max(100.0);
        (tank_pressure * 0.032 / (8.314462 * storage_t)).max(0.1)
    } else {
        ox_rho_liquid
    };

    let tp = TankParams {
        ullage: design.param("feed.ullage_factor", 1.06).clamp(1.0, 1.5),
        ld_ratio: design.param("feed.tank_ld_ratio", 2.6).clamp(1.0, 8.0),
        allowable_pa: design.param("feed.tank_allowable_mpa", 250.0) * 1e6,
        test_factor: design.param("feed.tank_test_factor", 1.5).clamp(1.0, 2.5),
        wall_density: design.param("feed.tank_wall_density", 2700.0),
    };
    let ox_tank = size_tank("oxidizer", ox_mass, ox_rho, tank_pressure, &tp);
    let fuel_tank = size_tank("fuel", fuel_mass, fuel_rho, tank_pressure, &tp);

    // Pressurant only for a regulated pressure-fed system. Gas choice sets R;
    // Helium is preferred (low MW → least pressurant mass) per Cannon (NASA).
    let pressurant = if feed == "pressure-fed" {
        let gas = design.choice("feed.pressurant_gas", "Helium");
        let r_gas = match gas.to_lowercase() {
            g if g.contains("nitro") || g.contains("n2") => 296.8,
            g if g.contains("argon") || g.contains("ar") => 208.1,
            _ => 2077.0, // Helium
        };
        let v_prop = (ox_tank.volume_l + fuel_tank.volume_l) / 1000.0;
        let t = 293.0;
        // Regulated feed needs a factor over the ideal gas mass (residual +
        // expansion cooling + ullage compression); Cannon lists these loss modes.
        let factor = design.param("feed.pressurant_factor", 1.6).clamp(1.1, 3.0);
        let mass = factor * tank_pressure * v_prop / (r_gas * t);
        // Stored up to ~270 atm (Cannon); default 274 bar.
        let bottle_p = design.param("feed.pressurant_bottle_bar", 274.0) * 1e5;
        let bottle_v = mass * r_gas * t / bottle_p;
        Some(PressurantSpec { gas, mass_kg: mass, bottle_volume_l: bottle_v * 1000.0, bottle_pressure_bar: bottle_p / 1e5 })
    } else {
        None
    };

    // Avionics harness: a characteristic wire run spanning the tank stack (a
    // positive `avionics.run_length_m` param overrides the derived length).
    let auto_run = (ox_tank.length_m + fuel_tank.length_m + l0.chamber_length.as_si()).max(0.4);
    let run_override = design.param("avionics.run_length_m", 0.0);
    let run_length = if run_override > 0.0 { run_override } else { auto_run };
    let harness = feedsystem::avionics::build_harness(&feedsystem::avionics::AvionicsInput {
        feed_type: feed.to_string(),
        burn_time_s,
        has_pressurant: pressurant.is_some(),
        run_length_m: run_length,
        bus_voltage_v: design.param("avionics.bus_voltage_v", 28.0),
        battery_reserve_factor: design.param("avionics.battery_reserve_factor", 2.0),
        battery_energy_density_wh_kg: design.param("avionics.battery_energy_density_wh_kg", 150.0),
        housekeeping_current_a: design.param("avionics.housekeeping_current_a", 0.5),
        main_valve_current_a: design.param("avionics.main_valve_current_a", 3.0),
        igniter_current_a: design.param("avionics.igniter_current_a", 5.0),
        dual_redundant: design.choice("avionics.redundancy", "single").to_lowercase().contains("dual"),
    });

    Ok(FeedStudy {
        feed_type: feed.to_string(),
        burn_time_s,
        total_propellant_mass_kg: ox_mass + fuel_mass,
        dry_tank_mass_kg: ox_tank.tank_mass_kg + fuel_tank.tank_mass_kg,
        ox_tank,
        fuel_tank,
        tank_pressure_pa: tank_pressure,
        pressurant,
        feed_budget: FeedBudget {
            chamber_pressure_pa: pc,
            injector_dp_pa: injector_dp,
            line_dp_pa: line_dp,
            required_tank_pressure_pa: required_tank,
        },
        recommended_feed: recommended.to_string(),
        harness,
    })
}

/// Analysis & detail study (section D): injector fluid-flow, combustion
/// instability, and the distributed (FEM-like) wall-stress field.
#[derive(Debug, Clone, Serialize)]
pub struct AnalysisStudy {
    pub injector: injector::flow::InjectorFlowResult,
    pub instability: injector::instability::InstabilityResult,
    pub stress: structures::distribution::StressField,
    /// Distributed-stress field as CSV (FEM boundary data).
    pub stress_csv: String,
    /// Computed combustion (c*) efficiency from L*/residence-time/mixing (ERE).
    pub ere: injector::efficiency::EreResult,
}

/// Run the section-D analyses for the current design.
pub fn analysis_study(design: &mut EngineDesign) -> Result<AnalysisStudy, EngineError> {
    resolve(design)?;
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let l1: thermo::ThermoResult = payload(design, Tier::L1)?;
    let l3: cooling::CoolingResult = payload(design, Tier::L3)?;

    let pc = design.operating_point.chamber_pressure.as_si();
    let density = propellants::props_for(design.propellant.pair)
        .and_then(|p| p.density_kg_m3)
        .unwrap_or(1000.0);
    let r_spec = 8314.462 / l1.mean_molecular_weight;
    let gas_density = pc / (r_spec * l1.tc_k);
    let sound_speed = (l1.gamma * r_spec * l1.tc_k).sqrt();

    // --- User design inputs (persisted injector.* params; best-practice defaults) ---
    let dp_fraction = design.param("injector.dp_fraction", 0.2).clamp(0.03, 0.6);
    let element_count = design.param("injector.element_count", 24.0).round().clamp(1.0, 2000.0) as u32;
    let discharge_coefficient = design.param("injector.discharge_coefficient", 0.7).clamp(0.4, 1.0);
    let surface_tension = design.param("injector.surface_tension_n_m", 0.02).clamp(0.001, 0.1);
    let fuel_density_factor = design.param("injector.fuel_density_factor", 0.72).clamp(0.2, 2.0);
    let time_lag_s = design.param("injector.time_lag_ms", 1.5) * 1e-3;
    let interaction_index = design.param("injector.interaction_index", 0.5).clamp(0.0, 1.0);
    let element_type = match design.choice("injector.element_type", "UnlikeDoublet") {
        s if s.contains("Like") && !s.contains("Unlike") => injector::flow::ElementType::LikeDoublet,
        s if s.contains("Coax") => injector::flow::ElementType::Coaxial,
        _ => injector::flow::ElementType::UnlikeDoublet,
    };

    // Injector fluid-flow simulation.
    let injector = injector::flow::solve_injector_flow(&injector::flow::InjectorFlowInput {
        ox_flow_kg_s: l0.oxidizer_flow.as_si(),
        fuel_flow_kg_s: l0.fuel_flow.as_si(),
        ox_density_kg_m3: density,
        fuel_density_kg_m3: density * fuel_density_factor,
        chamber_pressure_pa: pc,
        dp_fraction,
        element_count,
        discharge_coefficient,
        surface_tension_n_m: surface_tension,
        gas_density_kg_m3: gas_density,
        element_type,
    });

    // Combustion-instability analysis.
    let instability = injector::instability::solve_instability(&injector::instability::InstabilityInput {
        chamber_diameter_m: l0.chamber_diameter.as_si(),
        chamber_length_m: l0.chamber_length.as_si(),
        sound_speed_m_s: sound_speed,
        dp_fraction,
        time_lag_s,
        interaction_index,
    });

    // Distributed wall-stress field over chamber + nozzle stations.
    let material = design.materials.chamber.as_deref().and_then(cooling::materials::by_name).unwrap_or_else(cooling::materials::copper_ofhc);
    let throat_r = l3.stations.iter().map(|s| s.r).fold(f64::INFINITY, f64::min).max(1e-4);
    let mut stations: Vec<structures::distribution::StressStationInput> = Vec::new();
    // Chamber stations at full chamber pressure.
    for i in 0..4 {
        stations.push(structures::distribution::StressStationInput {
            x: -l0.chamber_length.as_si() * (1.0 - i as f64 / 3.0),
            r_inner_m: l0.chamber_diameter.as_si() / 2.0,
            wall_thickness_m: l0.wall_thickness.as_si(),
            gas_pressure_pa: pc,
            wall_temp_hot_k: l3.max_wall_temp_k,
            wall_temp_cold_k: 400.0,
        });
    }
    // Nozzle stations: gas pressure from the local area ratio.
    for s in &l3.stations {
        let ar = (s.r / throat_r).powi(2).max(1.0);
        let m = gasdynamics::quasi1d::mach_from_area(ar, l1.gamma);
        let p = pc * gasdynamics::quasi1d::pressure_ratio(m, l1.gamma);
        stations.push(structures::distribution::StressStationInput {
            x: s.x,
            r_inner_m: s.r,
            wall_thickness_m: l0.wall_thickness.as_si(),
            gas_pressure_pa: p,
            wall_temp_hot_k: s.wall_temp_k,
            wall_temp_cold_k: s.coolant_temp_k,
        });
    }
    let stress = structures::distribution::solve_stress_field(&stations, &structures::distribution::StressMaterial {
        youngs_modulus_pa: material.youngs_modulus_pa,
        alpha_per_k: material.cte_per_k,
        poisson: 0.33,
        allowable_stress_pa: material.allowable_stress_pa,
    });
    let stress_csv = stress.to_csv();

    // Computed combustion efficiency (ERE): residence time from L*, droplet
    // vaporization from the injector SMD, and inter-element mixing.
    let smd = 0.5 * (injector.ox.sauter_mean_diameter_m + injector.fuel.sauter_mean_diameter_m);
    let l_star = l0.chamber_volume.as_si() / l0.throat_area.as_si().max(1e-9);
    let ere = injector::efficiency::energy_release_efficiency(&injector::efficiency::EreInput {
        l_star_m: l_star,
        throat_area_m2: l0.throat_area.as_si(),
        mass_flow_kg_s: l0.total_flow.as_si(),
        chamber_gas_density_kg_m3: gas_density,
        chamber_temp_k: l1.tc_k,
        sauter_mean_diameter_m: smd,
        element_count,
        dp_fraction,
        chamber_pressure_pa: pc,
    });

    Ok(AnalysisStudy { injector, instability, stress, stress_csv, ere })
}

/// Turbomachinery study (section B): pump, turbine, inducer, shaft, bearing and
/// the gas-generator cycle balance sized from the current design.
#[derive(Debug, Clone, Serialize)]
pub struct TurbopumpStudy {
    pub pump: turbopumps::PumpResult,
    pub turbine: turbopumps::TurbineResult,
    pub inducer: turbopumps::InducerResult,
    pub shaft: turbopumps::ShaftResult,
    pub bearing: turbopumps::BearingResult,
    pub gg_cycle: turbopumps::GgCycleResult,
}

/// Size the turbomachinery for the current design at a chosen shaft speed.
pub fn turbopump_study(design: &mut EngineDesign, speed_rpm: f64) -> Result<TurbopumpStudy, EngineError> {
    resolve(design)?;
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let pc = design.operating_point.chamber_pressure.as_si();
    let density = propellants::props_for(design.propellant.pair)
        .and_then(|p| p.density_kg_m3)
        .unwrap_or(1000.0);

    let total_flow = l0.total_flow.as_si();

    // --- User design inputs (persisted turbo.* params; doc-grounded defaults) ---
    let tank_pa = design.param("turbo.tank_pressure_bar", 3.0) * 1e5;
    let discharge_factor = design.param("turbo.discharge_pressure_factor", 1.25);
    let discharge_pa = pc * discharge_factor;
    let pump_eff = design.param("turbo.pump_efficiency", 0.7).clamp(0.3, 0.95);
    let suction_nss = design.param("turbo.suction_specific_speed", 500.0);
    let hub_ratio = design.param("turbo.inducer_hub_ratio", 0.4).clamp(0.2, 0.7);
    let gg_frac = design.param("turbo.gg_flow_fraction", 0.03).clamp(0.005, 0.5);
    let cp_t = design.param("turbo.turbine_cp", 2000.0);
    let g_t = design.param("turbo.turbine_gamma", 1.3);
    let tin_t = design.param("turbo.turbine_inlet_temp_k", 950.0);
    let turb_inlet_factor = design.param("turbo.turbine_inlet_pressure_factor", 0.9);
    let turb_exit_pa = design.param("turbo.turbine_exit_pressure_bar", 3.0) * 1e5;
    let turb_eff = design.param("turbo.turbine_efficiency", 0.65).clamp(0.3, 0.95);
    let shaft_shear_mpa = design.param("turbo.shaft_allowable_shear_mpa", 200.0);
    let shaft_sf = design.param("turbo.shaft_safety_factor", 1.5);
    let shaft_len = design.param("turbo.shaft_length_m", 0.35);
    let brg_radial = design.param("turbo.bearing_radial_load_n", 10_000.0);
    let brg_axial = design.param("turbo.bearing_axial_load_n", 4_000.0);
    let brg_life = design.param("turbo.bearing_life_hours", 5_000.0);
    let brg_bore = design.param("turbo.bearing_bore_mm", 45.0) / 1000.0;
    // DN limit: Cannon (NASA) gives 1.6–2.1 million for rolling-element bearings.
    let dn_limit = design.param("turbo.bearing_dn_limit_millions", 2.0).clamp(0.5, 3.0) * 1e6;

    let pump = turbopumps::solve_pump(&turbopumps::PumpInput {
        mass_flow_kg_s: total_flow,
        density_kg_m3: density,
        suction_pressure_pa: tank_pa,
        discharge_pressure_pa: discharge_pa,
        vapor_pressure_pa: 5.0e3,
        speed_rpm,
        efficiency: pump_eff,
        suction_specific_speed: suction_nss,
    });

    let turbine = turbopumps::solve_turbine(&turbopumps::TurbineInput {
        mass_flow_kg_s: (total_flow * gg_frac).max(0.05),
        cp_j_kg_k: cp_t,
        gamma: g_t,
        inlet_temp_k: tin_t,
        inlet_pressure_pa: pc * turb_inlet_factor,
        exit_pressure_pa: turb_exit_pa,
        efficiency: turb_eff,
        speed_rpm,
    });

    let inducer = turbopumps::solve_inducer(&turbopumps::InducerInput {
        mass_flow_kg_s: total_flow,
        density_kg_m3: density,
        speed_rpm,
        npsh_available_m: (tank_pa - 5.0e3) / (density * 9.80665),
        hub_ratio,
    });

    let shaft = turbopumps::solve_shaft(&turbopumps::ShaftInput {
        power_w: pump.shaft_power_w,
        speed_rpm,
        allowable_shear_pa: shaft_shear_mpa * 1e6,
        design_safety_factor: shaft_sf,
        length_m: shaft_len,
        youngs_modulus_pa: design.param("turbo.shaft_youngs_gpa", 200.0) * 1e9,
        lumped_mass_kg: design.param("turbo.shaft_lumped_mass_kg", 6.0),
    });

    let bearing = turbopumps::solve_bearing(&turbopumps::BearingInput {
        radial_load_n: brg_radial,
        axial_load_n: brg_axial,
        speed_rpm,
        required_life_hours: brg_life,
        bore_diameter_m: brg_bore,
        dn_limit,
    });

    let gg_cycle = turbopumps::solve_gg_cycle(&turbopumps::GgCycleInput {
        total_flow_kg_s: total_flow,
        chamber_pressure_pa: pc,
        tank_pressure_pa: tank_pa,
        propellant_density_kg_m3: density,
        pump_efficiency: pump_eff,
        gg_pressure_pa: pc * turb_inlet_factor,
        gg_temp_k: tin_t,
        gg_gamma: g_t,
        gg_cp_j_kg_k: cp_t,
        turbine_exit_pressure_pa: turb_exit_pa,
        turbine_efficiency: turb_eff,
        speed_rpm,
    });

    Ok(TurbopumpStudy { pump, turbine, inducer, shaft, bearing, gg_cycle })
}

// ---- Sensor / position validation ------------------------------------------

/// One spatially-located sensor: predicted vs (test-stand) measured value.
#[derive(Debug, Clone, Serialize)]
pub struct SpatialSensor {
    pub id: String,
    /// "pressure" or "wall_temp".
    pub kind: String,
    pub x_m: f64,
    pub r_m: f64,
    pub predicted: f64,
    pub measured: f64,
    pub unit: String,
    pub residual_pct: f64,
}

/// One time sample of the startup transient.
#[derive(Debug, Clone, Serialize)]
pub struct TimeSample {
    pub t_s: f64,
    pub predicted_thrust_n: f64,
    pub measured_thrust_n: f64,
    pub predicted_pc_pa: f64,
    pub measured_pc_pa: f64,
}

/// Sensor/position validation: spatial predicted-vs-measured profiles along the
/// chamber and nozzle, plus a startup time-series — the spatial and transient
/// comparison that a single scalar thrust/Isp/Pc check cannot capture.
#[derive(Debug, Clone, Serialize)]
pub struct SensorValidation {
    pub sensors: Vec<SpatialSensor>,
    pub time_series: Vec<TimeSample>,
    /// RMS of the spatial residuals (percent).
    pub rms_spatial_pct: f64,
    /// RMS of the thrust residual over the transient after ignition (percent).
    pub rms_thrust_pct: f64,
    pub ignition_delay_s: f64,
    pub rise_time_s: f64,
    /// Note: measured values here are a synthetic test-stand reference; replace
    /// with imported telemetry for a real validation.
    pub synthetic_reference: bool,
    pub summary: String,
    pub csv: String,
}

/// Build the sensor/position validation for the current design. Measured values
/// are a deterministic synthetic test-stand reference (a smooth position/time
/// bias plus ripple) so the framework is exercised without live telemetry.
pub fn validation_study(design: &mut EngineDesign) -> Result<SensorValidation, EngineError> {
    resolve(design)?;
    let l0: sizing_l0::L0Result = payload(design, Tier::L0)?;
    let l1: thermo::ThermoResult = payload(design, Tier::L1)?;
    let l3: cooling::CoolingResult = payload(design, Tier::L3)?;

    let pc = design.operating_point.chamber_pressure.as_si();
    let thrust = design.operating_point.thrust.as_si();
    let gamma = l1.gamma;
    let throat_r = l3.stations.iter().map(|s| s.r).fold(f64::INFINITY, f64::min).max(1e-4);

    // Smooth deterministic bias (no RNG): a model that runs slightly hot at the
    // throat and slightly under-predicts pressure downstream, plus a small ripple.
    let bias = |x: f64, k: f64| 1.0 + 0.03 * (x * 30.0 + k).sin() - 0.015 * (x * 12.0).cos();

    let mut sensors = Vec::new();
    let mut sq_sum = 0.0;
    let mut n = 0.0;

    // Pressure taps: injector, mid-chamber, throat, and two nozzle stations.
    let cl = l0.chamber_length.as_si();
    let chamber_r = l0.chamber_diameter.as_si() / 2.0;
    let taps = [
        ("P1 injector", -cl, chamber_r, 1.0),
        ("P2 mid-chamber", -cl * 0.5, chamber_r, 0.99),
    ];
    for (id, x, r, pratio) in taps {
        let predicted = pc * pratio;
        let measured = predicted * bias(x, 0.4);
        let residual = (measured - predicted) / predicted * 100.0;
        sq_sum += residual * residual;
        n += 1.0;
        sensors.push(SpatialSensor {
            id: id.into(), kind: "pressure".into(), x_m: x, r_m: r,
            predicted, measured, unit: "Pa".into(), residual_pct: residual,
        });
    }
    // Nozzle pressure taps from the local area ratio.
    for (frac, label) in [(0.0, "P3 throat"), (0.35, "P4 nozzle"), (0.9, "P5 exit")] {
        let idx = ((l3.stations.len() as f64 - 1.0) * frac).round() as usize;
        if let Some(s) = l3.stations.get(idx) {
            let ar = (s.r / throat_r).powi(2).max(1.0);
            let m = gasdynamics::quasi1d::mach_from_area(ar, gamma);
            let predicted = pc * gasdynamics::quasi1d::pressure_ratio(m, gamma);
            let measured = predicted * bias(s.x, 1.1);
            let residual = (measured - predicted) / predicted.max(1.0) * 100.0;
            sq_sum += residual * residual;
            n += 1.0;
            sensors.push(SpatialSensor {
                id: label.into(), kind: "pressure".into(), x_m: s.x, r_m: s.r,
                predicted, measured, unit: "Pa".into(), residual_pct: residual,
            });
        }
    }
    // Wall thermocouples along the nozzle.
    for (i, frac) in [0.0, 0.2, 0.5, 0.8].iter().enumerate() {
        let idx = ((l3.stations.len() as f64 - 1.0) * frac).round() as usize;
        if let Some(s) = l3.stations.get(idx) {
            let predicted = s.wall_temp_k;
            let measured = predicted * bias(s.x, 2.0 + i as f64);
            let residual = (measured - predicted) / predicted.max(1.0) * 100.0;
            sq_sum += residual * residual;
            n += 1.0;
            sensors.push(SpatialSensor {
                id: format!("T{} wall", i + 1), kind: "wall_temp".into(), x_m: s.x, r_m: s.r,
                predicted, measured, unit: "K".into(), residual_pct: residual,
            });
        }
    }
    let rms_spatial_pct = if n > 0.0 { (sq_sum / n).sqrt() } else { 0.0 };

    // Startup transient: predicted first-order rise after an ignition delay; the
    // measured trace has a slightly longer time constant and a small overshoot.
    let ignition_delay_s = 0.05;
    let rise_time_s = 0.15;
    let mut time_series = Vec::new();
    let mut t_sq = 0.0;
    let mut t_n = 0.0;
    let steps = 50;
    for i in 0..=steps {
        let t = 1.0 * i as f64 / steps as f64;
        let td = (t - ignition_delay_s).max(0.0);
        let pred_frac = 1.0 - (-td / rise_time_s).exp();
        // Measured: longer τ (0.18 s) + damped overshoot.
        let meas_frac = if td > 0.0 {
            let base = 1.0 - (-td / 0.18).exp();
            let overshoot = 0.04 * (-td / 0.25).exp() * (td / 0.05).sin();
            (base + overshoot).max(0.0)
        } else {
            0.0
        };
        let predicted_thrust_n = thrust * pred_frac;
        let measured_thrust_n = thrust * meas_frac;
        let predicted_pc_pa = pc * pred_frac;
        let measured_pc_pa = pc * meas_frac;
        if td > 0.02 {
            let r = (measured_thrust_n - predicted_thrust_n) / thrust.max(1.0) * 100.0;
            t_sq += r * r;
            t_n += 1.0;
        }
        time_series.push(TimeSample {
            t_s: t, predicted_thrust_n, measured_thrust_n, predicted_pc_pa, measured_pc_pa,
        });
    }
    let rms_thrust_pct = if t_n > 0.0 { (t_sq / t_n).sqrt() } else { 0.0 };

    let mut csv = String::from("id,kind,x_m,r_m,predicted,measured,unit,residual_pct\n");
    for s in &sensors {
        csv.push_str(&format!(
            "{},{},{:.5},{:.5},{:.4},{:.4},{},{:.3}\n",
            s.id, s.kind, s.x_m, s.r_m, s.predicted, s.measured, s.unit, s.residual_pct
        ));
    }

    let summary = format!(
        "{} sensors | spatial RMS {:.2}% | startup RMS {:.2}% | t_ig={:.0} ms, t_rise={:.0} ms",
        sensors.len(),
        rms_spatial_pct,
        rms_thrust_pct,
        ignition_delay_s * 1000.0,
        rise_time_s * 1000.0
    );

    Ok(SensorValidation {
        sensors,
        time_series,
        rms_spatial_pct,
        rms_thrust_pct,
        ignition_delay_s,
        rise_time_s,
        synthetic_reference: true,
        summary,
        csv,
    })
}
