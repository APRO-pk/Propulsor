//! `apro-engine` headless CLI.
//!
//! Drives the same `simulate` crate the desktop app uses, so a passing CLI test is
//! a passing app math. Shared by CI, golden tests, and quick scripting — no Tauri.
//!
//! Arg parsing is hand-rolled (no `clap`) to keep the workspace free of
//! `windows-sys`/`dlltool` dependencies, which is what lets this build fully
//! offline on the plain GNU host.

use engine_core::{EngineDesign, PropellantPair};
use propellants::props_for;
use std::path::PathBuf;

/// Options gathered from argv.
struct Opts {
    name: String,
    by: String,
    out: PathBuf,
    project: PathBuf,
}

impl Default for Opts {
    fn default() -> Self {
        Opts {
            name: "untitled".into(),
            by: "opencode".into(),
            out: PathBuf::from("engine.apro-engine.ron"),
            project: PathBuf::new(),
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        print_usage();
        return Ok(());
    }
    let cmd = args[1].as_str();
    let mut opts = Opts::default();
    parse_flags(&args[2..], &mut opts)?;

    match cmd {
        "new" => cmd_new(&opts)?,
        "resolve" => cmd_resolve(&opts)?,
        "dump" => cmd_dump(&opts)?,
        "verify" => cmd_verify(&opts)?,
        "golden" => cmd_golden()?,
        "report" => cmd_report(&opts)?,
        "map" => cmd_map(&opts)?,
        "safety" => cmd_safety(&opts)?,
        "trade" => cmd_trade(&opts)?,
        "thrustcurve" => cmd_thrustcurve(&opts)?,
        "transient" => cmd_transient(&opts)?,
        "optimize" => cmd_optimize(&opts)?,
        "contour" => cmd_contour(&opts)?,
        "turbopump" => cmd_turbopump(&opts)?,
        "cooling" => cmd_cooling(&opts)?,
        "expansion" => cmd_expansion(&opts)?,
        _ => {
            eprintln!("unknown command: {cmd}");
            print_usage();
        }
    }
    Ok(())
}

fn parse_flags(args: &[String], opts: &mut Opts) -> Result<(), Box<dyn std::error::Error>> {
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if let Some(val) = a.strip_prefix("--name=") {
            opts.name = val.into();
        } else if let Some(val) = a.strip_prefix("--by=") {
            opts.by = val.into();
        } else if let Some(val) = a.strip_prefix("--out=") {
            opts.out = PathBuf::from(val);
        } else if let Some(val) = a.strip_prefix("--project=") {
            opts.project = PathBuf::from(val);
        } else {
            return Err(format!("unknown flag: {a}").into());
        }
        i += 1;
    }
    Ok(())
}

fn cmd_new(opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let mut d = EngineDesign::new(&opts.name, &opts.by);
    d.propellant.pair = PropellantPair::GoxEthanol;
    if let Some(p) = props_for(d.propellant.pair) {
        println!("Seeding with {} ({})", opts.name, p.pair.label());
    }
    let ron = d.to_ron()?;
    std::fs::write(&opts.out, ron)?;
    println!("Wrote {}", opts.out.display());
    Ok(())
}

fn cmd_resolve(opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let raw = std::fs::read_to_string(&opts.project)?;
    let mut d = EngineDesign::from_ron(&raw)?;
    simulate::resolve(&mut d)?;
    for cache in &d.caches {
        println!("{:>11} -> {:?}", cache.tier.label(), cache.status);
        if let Some(p) = &cache.payload {
            match cache.tier {
                engine_core::Tier::L0 => {
                    let r0: sizing_l0::L0Result = serde_json::from_value(p.clone())?;
                    println!("        {}", r0.summary());
                }
                engine_core::Tier::L1 => {
                    let r1: thermo::ThermoResult = serde_json::from_value(p.clone())?;
                    println!("        {}", r1.summary());
                }
                engine_core::Tier::L2 => {
                    let r2: gasdynamics::L2Result = serde_json::from_value(p.clone())?;
                    println!("        {}", r2.summary());
                }
                engine_core::Tier::L3 => {
                    let r3: cooling::CoolingResult = serde_json::from_value(p.clone())?;
                    println!("        {}", r3.summary());
                }
                engine_core::Tier::L4 => {
                    let r4: structures::StructuresResult = serde_json::from_value(p.clone())?;
                    println!("        {}", r4.summary());
                }
                engine_core::Tier::L5 => {
                    let r5: feedsystem::FeedSystemResult = serde_json::from_value(p.clone())?;
                    println!("        {}", r5.summary());
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn cmd_golden() -> Result<(), Box<dyn std::error::Error>> {
    let mut d = sizing_l0::krzycki_golden_design();
    simulate::resolve(&mut d)?;
    for cache in &d.caches {
        println!("{:>11} -> {:?}", cache.tier.label(), cache.status);
        if let Some(p) = &cache.payload {
            match cache.tier {
                engine_core::Tier::L0 => {
                    let r0: sizing_l0::L0Result = serde_json::from_value(p.clone())?;
                    println!("        {}", r0.summary());
                }
                engine_core::Tier::L1 => {
                    let r1: thermo::ThermoResult = serde_json::from_value(p.clone())?;
                    println!("        {}", r1.summary());
                }
                engine_core::Tier::L2 => {
                    let r2: gasdynamics::L2Result = serde_json::from_value(p.clone())?;
                    println!("        {}", r2.summary());
                }
                engine_core::Tier::L3 => {
                    let r3: cooling::CoolingResult = serde_json::from_value(p.clone())?;
                    println!("        {}", r3.summary());
                }
                engine_core::Tier::L4 => {
                    let r4: structures::StructuresResult = serde_json::from_value(p.clone())?;
                    println!("        {}", r4.summary());
                }
                engine_core::Tier::L5 => {
                    let r5: feedsystem::FeedSystemResult = serde_json::from_value(p.clone())?;
                    println!("        {}", r5.summary());
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn cmd_report(opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let d = sizing_l0::krzycki_golden_design();
    let r0 = sizing_l0::solve_l0(&d, sizing_l0::L0Assumptions::default())?;
    let pdf = export::generate_report_pdf(&d, &r0);
    let path = if opts.out.as_os_str().is_empty() {
        PathBuf::from("design-report.pdf")
    } else {
        opts.out.clone()
    };
    std::fs::write(&path, &pdf)?;
    println!("Wrote {} ({} bytes)", path.display(), pdf.len());
    Ok(())
}

fn cmd_map(_opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let d = sizing_l0::krzycki_golden_design();
    let map = simulate::steady_state_map(&d, (1.8, 3.0), 5, (0.0, 20000.0), 5)?;

    print!("{:>8}", "O/F\\km");
    for &a in &map.alt_axis {
        print!("{:>8}", a / 1000.0);
    }
    println!();
    for (i, of) in map.of_axis.iter().enumerate() {
        print!("{:>8.2}", of);
        for &isp in &map.isp_matrix[i] {
            print!("{:>8.0}", isp);
        }
        println!();
    }
    Ok(())
}

fn cmd_trade(_opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let d = sizing_l0::krzycki_golden_design();
    let pts = simulate::trade_study(&d, (1.5e6, 3.5e6), (1.8, 3.2), 6)?;
    let front = simulate::pareto_front(&pts);
    println!("Grid: {} points | Pareto front: {} points", pts.len(), front.len());
    println!("{:>10} {:>8} {:>8} {:>9} {:>8}", "Pc(kPa)", "O/F", "Isp(s)", "mass(kg)", "cost($)");
    for p in front {
        println!(
            "{:>10.0} {:>8.2} {:>8.0} {:>9.3} {:>8.0}",
            p.pc_pa / 1000.0,
            p.of,
            p.isp_s,
            p.dry_mass_kg,
            p.cost_usd
        );
    }
    Ok(())
}

fn cmd_thrustcurve(opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let d = sizing_l0::krzycki_golden_design();
    let csv = export::thrust_curve_csv(&d, 3.0);
    let path = if opts.out.as_os_str().is_empty() || opts.out == PathBuf::from("engine.apro-engine.ron") {
        PathBuf::from("thrust_curve.csv")
    } else {
        opts.out.clone()
    };
    std::fs::write(&path, &csv)?;
    println!("Wrote thrust curve {}", path.display());
    Ok(())
}

fn cmd_transient(_opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let d = sizing_l0::krzycki_golden_design();
    let l0 = sizing_l0::solve_l0(&d, sizing_l0::L0Assumptions::default())?;
    let l1 = thermo::solve(&thermo::ThermoInput {
        of_ratio: d.operating_point.mixture_ratio.as_f64(),
        chamber_pressure_pa: d.operating_point.chamber_pressure.as_si(),
        propellant_pair: d.propellant.pair,
        method: thermo::ThermoMethod::GibbsFreeEnergy,
    })?;
    let pc = d.operating_point.chamber_pressure.as_si();

    let inp = feedsystem::TransientInput {
        chamber_volume_m3: l0.chamber_volume.as_si(),
        throat_area_m2: l0.throat_area.as_si(),
        c_star_m_s: l1.c_star_m_s,
        tc_k: l1.tc_k,
        mw_g_per_mol: l1.mean_molecular_weight,
        steady_inflow_kg_s: l0.total_flow.as_si(),
        design_pc_pa: pc,
        valve_open_s: 0.1,
        burn_time_s: 0.5,
        dt_s: 0.001,
    };
    let r = feedsystem::solve_transient(&inp);
    println!("Transient: {}", r.summary());
    // Print a few samples.
    for i in (0..r.time.len()).step_by((r.time.len() / 8).max(1)) {
        println!("  t={:.3}s  Pc={:.0} kPa", r.time[i], r.pc[i] / 1000.0);
    }
    Ok(())
}

fn cmd_optimize(_opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let d = sizing_l0::krzycki_golden_design();
    let pc = d.operating_point.chamber_pressure.as_si();

    let (best_of, best_isp) = thermo::optimal_of(d.propellant.pair, pc);
    println!("Optimal O/F for max Isp_vac: {best_of:.2} -> Isp {best_isp:.0} s");

    let lstar = sizing_l0::recommended_l_star(d.propellant.pair);
    println!("Recommended L*: {lstar:.2} m");

    for alt in [0.0, 5000.0, 10000.0, 20000.0] {
        let (ar, pe, isp) = simulate::optimal_expansion(&d, alt)?;
        println!(
            "Optimal expansion @{alt:.0} m: A_e/A_t={ar:.2}, P_e={pe:.0} Pa (vs ambient), Isp={isp:.0} s"
        );
    }
    Ok(())
}

fn cmd_contour(opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let d = sizing_l0::krzycki_golden_design();
    let l0 = sizing_l0::solve_l0(&d, sizing_l0::L0Assumptions::default())?;
    let l1 = thermo::solve(&thermo::ThermoInput {
        of_ratio: d.operating_point.mixture_ratio.as_f64(),
        chamber_pressure_pa: d.operating_point.chamber_pressure.as_si(),
        propellant_pair: d.propellant.pair,
        method: thermo::ThermoMethod::GibbsFreeEnergy,
    })?;
    let input = gasdynamics::L2Input {
        gamma: l1.gamma,
        c_star_m_s: l1.c_star_m_s,
        tc_k: l1.tc_k,
        mw: l1.mean_molecular_weight,
        pc_pa: d.operating_point.chamber_pressure.as_si(),
        expansion: d.operating_point.expansion,
        ambient_pressure_pa: None,
        throat_area_m2: l0.throat_area.as_si(),
        exit_half_angle_deg: 15.0,
        c_star_efficiency: d.operating_point.c_star_efficiency,
        nozzle_type: gasdynamics::NozzleType::Bell,
    };
    let l2 = gasdynamics::solve_l2(&input);
    let csv = export::contour_csv(&l2.stations);
    let path = if opts.out.as_os_str().is_empty() || opts.out == PathBuf::from("engine.apro-engine.ron") {
        PathBuf::from("contour.csv")
    } else {
        opts.out.clone()
    };
    std::fs::write(&path, &csv)?;
    println!("Wrote nozzle contour {}", path.display());
    Ok(())
}

fn cmd_turbopump(_opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    // A representative pump-fed engine: LOX/RP-1 class, ~200 kg/s.
    let pump = turbopumps::solve_pump(&turbopumps::PumpInput {
        mass_flow_kg_s: 200.0,
        density_kg_m3: 1140.0,
        suction_pressure_pa: 3.0e5,
        discharge_pressure_pa: 1.0e7,
        vapor_pressure_pa: 5.0e3,
        speed_rpm: 15_000.0,
        efficiency: 0.72,
        suction_specific_speed: 500.0,
    });
    println!("Pump: {}", pump.summary());

    let turbine = turbopumps::solve_turbine(&turbopumps::TurbineInput {
        mass_flow_kg_s: 12.0,
        cp_j_kg_k: 2000.0,
        gamma: 1.3,
        inlet_temp_k: 950.0,
        inlet_pressure_pa: 4.0e6,
        exit_pressure_pa: 3.0e5,
        efficiency: 0.65,
        speed_rpm: 20_000.0,
    });
    println!("Turbine: {}", turbine.summary());

    let balance = turbopumps::power_balance(pump.shaft_power_w, turbine.shaft_power_w);
    println!(
        "Power balance (turbine/pump): {balance:.2} {}",
        if balance >= 1.0 { "(OK)" } else { "(needs more turbine flow)" }
    );

    let inducer = turbopumps::solve_inducer(&turbopumps::InducerInput {
        mass_flow_kg_s: 200.0,
        density_kg_m3: 1140.0,
        speed_rpm: 15_000.0,
        npsh_available_m: 20.0,
        hub_ratio: 0.4,
    });
    println!("Inducer: {}", inducer.summary());

    let shaft = turbopumps::solve_shaft(&turbopumps::ShaftInput {
        power_w: pump.shaft_power_w,
        speed_rpm: 15_000.0,
        allowable_shear_pa: 200.0e6,
        design_safety_factor: 1.5,
        length_m: 0.35,
        youngs_modulus_pa: 200.0e9,
        lumped_mass_kg: 6.0,
    });
    println!("Shaft: {}", shaft.summary());

    let bearing = turbopumps::solve_bearing(&turbopumps::BearingInput {
        radial_load_n: 10_000.0,
        axial_load_n: 4_000.0,
        speed_rpm: 15_000.0,
        required_life_hours: 5_000.0,
        bore_diameter_m: 0.045,
        dn_limit: 2.0e6,
    });
    println!("Bearing: {}", bearing.summary());

    // Reduction gear to a lower-speed auxiliary (e.g. fuel) pump on the same shaft.
    let gear = turbopumps::solve_gear(&turbopumps::GearInput {
        power_w: 400.0e3,
        input_speed_rpm: 18_000.0,
        output_speed_rpm: 9_000.0,
        module_m: 6.0e-3,
        pinion_teeth: 22,
        pressure_angle_deg: 20.0,
        face_width_over_module: 16.0,
        allowable_bending_pa: 350.0e6,
        allowable_contact_pa: 1300.0e6,
    });
    println!("Gear: {}", gear.summary());

    let face_seal = turbopumps::solve_seal(&turbopumps::SealInput {
        kind: turbopumps::SealKind::Face,
        shaft_diameter_m: shaft.diameter_m,
        speed_rpm: 15_000.0,
        // Seal cavity pressure downstream of the balance piston, not full discharge.
        sealed_pressure_pa: 1.5e6,
        downstream_pressure_pa: 1.0e5,
        face_width_m: 3.0e-3,
        fluid_viscosity_pa_s: 1.0e-3,
        film_thickness_m: 1.0e-6,
        pv_limit_pa_m_s: 3.5e6 * 45.0,
        num_teeth: 0,
        clearance_m: 0.0,
        gas_constant_j_kg_k: 0.0,
        gas_temp_k: 0.0,
        discharge_coefficient: 0.0,
    });
    println!("Pump seal: {}", face_seal.summary());

    let laby_seal = turbopumps::solve_seal(&turbopumps::SealInput {
        kind: turbopumps::SealKind::Labyrinth,
        shaft_diameter_m: shaft.diameter_m,
        speed_rpm: 20_000.0,
        sealed_pressure_pa: 4.0e6,
        downstream_pressure_pa: 3.0e5,
        face_width_m: 0.0,
        fluid_viscosity_pa_s: 0.0,
        film_thickness_m: 0.0,
        pv_limit_pa_m_s: 0.0,
        num_teeth: 8,
        clearance_m: 1.5e-4,
        gas_constant_j_kg_k: 320.0,
        gas_temp_k: 950.0,
        discharge_coefficient: 0.7,
    });
    println!("Turbine seal: {}", laby_seal.summary());

    let gg = turbopumps::solve_gg_cycle(&turbopumps::GgCycleInput {
        total_flow_kg_s: 200.0,
        chamber_pressure_pa: 1.0e7,
        tank_pressure_pa: 3.0e5,
        propellant_density_kg_m3: 1140.0,
        pump_efficiency: 0.72,
        gg_pressure_pa: 4.0e6,
        gg_temp_k: 950.0,
        gg_gamma: 1.3,
        gg_cp_j_kg_k: 2000.0,
        turbine_exit_pressure_pa: 3.0e5,
        turbine_efficiency: 0.65,
        speed_rpm: 20_000.0,
    });
    println!("GG cycle: {}", gg.summary());

    // Ox-rich staged-combustion cycle (RD-180 class): all LOX + a fuel split
    // burn in the preburner; the solver finds the split that closes the balance.
    let preburner = turbopumps::solve_preburner(&turbopumps::PreburnerInput {
        ox_flow_kg_s: 148.0,
        fuel_flow_kg_s: 3.0,
        pressure_pa: 5.5e7,
        stoich_of: 3.4,
        stoich_temp_k: 3700.0,
        inlet_temp_k: 300.0,
        cp_j_kg_k: 2200.0,
        gamma: 1.25,
    });
    println!("Preburner: {}", preburner.summary());

    let sc = turbopumps::solve_sc_cycle(&turbopumps::ScCycleInput {
        total_flow_kg_s: 200.0,
        mixture_ratio: 2.7,
        chamber_pressure_pa: 2.5e7,
        tank_ox_pressure_pa: 5.0e5,
        tank_fuel_pressure_pa: 5.0e5,
        ox_density_kg_m3: 1140.0,
        fuel_density_kg_m3: 810.0,
        ox_pump_efficiency: 0.72,
        fuel_pump_efficiency: 0.70,
        preburner_pressure_pa: 5.5e7,
        ox_rich_preburner: true,
        turbine_efficiency: 0.70,
        turbine_exit_pressure_pa: 2.5e7,
        max_turbine_inlet_temp_k: 850.0,
        stoich_of: 3.4,
        stoich_temp_k: 3700.0,
        reactant_inlet_temp_k: 300.0,
        preburner_cp_j_kg_k: 2200.0,
        preburner_gamma: 1.25,
        speed_rpm: 18_000.0,
    });
    println!("Staged-combustion cycle: {}", sc.summary());
    Ok(())
}

fn cmd_cooling(opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    use cooling::{ablative, film, materials, radiation};

    println!("Material database:");
    for m in materials::all() {
        println!(
            "  {:<16} k={:>5.0} W/mK | T_max={:>5.0} K | ε={:.2} | {:?}",
            m.name, m.thermal_conductivity_w_m_k, m.max_service_temp_k, m.emissivity, m.cooling_class,
        );
    }

    // Regen run over a bell contour, comparing wall materials and film cooling.
    let r_t = 0.03;
    let r_e = 0.06;
    let stations = gasdynamics::contour::bell_contour(r_t, r_e, 15.0, 40);
    let base = cooling::L3Input {
        stations: stations.clone(),
        throat_radius_m: r_t,
        gamma: 1.2,
        tc_k: 3500.0,
        pc_pa: 7.0e6,
        c_star_m_s: 1800.0,
        mw_g_per_mol: 22.0,
        wall_material: materials::copper_ofhc(),
        wall_thickness_m: 0.0015,
        coolant_gap_m: 0.003,
        coolant_velocity_m_s: 20.0,
        coolant_pressure_pa: 5.0e6,
        film_cooling: None,
    };
    let cu = cooling::solve_l3(&base)?;
    println!("\nRegen (OFHC copper): {}", cu.summary());

    let inconel = cooling::solve_l3(&cooling::L3Input {
        wall_material: materials::inconel718(),
        ..base.clone()
    })?;
    println!("Regen (Inconel 718): {}", inconel.summary());

    let filmed = cooling::solve_l3(&cooling::L3Input {
        film_cooling: Some(cooling::FilmCoolingConfig {
            injection_x_m: 0.0,
            coolant_temp_k: 400.0,
            coolant_density_kg_m3: 5.0,
            coolant_velocity_m_s: 120.0,
            coolant_viscosity_pa_s: 2.0e-5,
            slot_height_m: 1.5e-3,
        }),
        ..base.clone()
    })?;
    println!("Regen + film cooling: {}", filmed.summary());

    // Standalone film-cooling station.
    let f = film::solve_film(&film::FilmCoolingInput {
        gas_temp_k: 3500.0,
        gas_density_kg_m3: 4.0,
        gas_velocity_m_s: 950.0,
        coolant_temp_k: 400.0,
        coolant_density_kg_m3: 5.0,
        coolant_velocity_m_s: 120.0,
        coolant_viscosity_pa_s: 2.0e-5,
        slot_height_m: 1.5e-3,
        distance_m: 0.05,
    });
    println!("\nFilm cooling: {}", f.summary());

    // Radiation-cooled nozzle extension (niobium C-103).
    let rad = radiation::solve_radiation(&radiation::RadiationInput {
        h_gas: 1200.0,
        adiabatic_gas_temp_k: 1900.0,
        ambient_temp_k: 250.0,
        material: materials::niobium_c103(),
    });
    println!("Radiation extension (Nb C-103): {}", rad.summary());

    // Ablative chamber liner (carbon-phenolic), sized for a representative
    // chamber-wall flux rather than the peak throat flux.
    let abl = ablative::solve_ablative(&ablative::AblativeInput {
        heat_flux_w_m2: 5.0e6,
        burn_time_s: 30.0,
        material: materials::carbon_phenolic(),
        safety_factor: 1.5,
    });
    println!("Ablative liner (carbon-phenolic): {}", abl.summary());

    // Heat-flux CSV for FEM boundary conditions.
    let path = if opts.out.as_os_str().is_empty() || opts.out == PathBuf::from("engine.apro-engine.ron") {
        PathBuf::from("heat_flux.csv")
    } else {
        opts.out.clone()
    };
    std::fs::write(&path, cu.heat_flux_csv())?;
    println!("\nWrote heat-flux table {}", path.display());
    Ok(())
}

fn cmd_expansion(_opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    use gasdynamics::optimize::{optimal_expansion, uniform_ascent_samples, ExpansionStudyInput};

    let (gamma, pc, p_sl) = (1.2, 7.0e6, 101_325.0);
    println!("Optimal nozzle expansion (γ={gamma}, Pc={:.1} MPa):", pc / 1e6);

    let cases = [
        ("Sea-level / low booster (0-5 km)", 0.0, 5_000.0),
        ("First stage (0-40 km)", 0.0, 40_000.0),
        ("Upper stage (30-80 km)", 30_000.0, 80_000.0),
    ];
    for (label, start, burnout) in cases {
        let r = optimal_expansion(&ExpansionStudyInput {
            gamma,
            pc_pa: pc,
            sea_level_pressure_pa: p_sl,
            ambient_samples_pa: uniform_ascent_samples(p_sl, start, burnout, 40),
            area_ratio_bounds: (1.5, 400.0),
        });
        println!("  {label:<32} {}", r.summary());
    }
    Ok(())
}

fn cmd_safety(opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let d = sizing_l0::krzycki_golden_design();
    print!("{}", export::safety_checklist(&d));

    let svg = export::pid_svg(&d);
    let path = if opts.out.as_os_str().is_empty() || opts.out == PathBuf::from("engine.apro-engine.ron") {
        PathBuf::from("pid.svg")
    } else {
        opts.out.clone()
    };
    std::fs::write(&path, svg)?;
    println!("\nWrote P&ID {}", path.display());
    Ok(())
}

fn cmd_dump(opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let raw = std::fs::read_to_string(&opts.project)?;
    let d = EngineDesign::from_ron(&raw)?;
    println!("{}", d.to_ron()?);
    Ok(())
}

fn cmd_verify(opts: &Opts) -> Result<(), Box<dyn std::error::Error>> {
    let raw = std::fs::read_to_string(&opts.project)?;
    let d = EngineDesign::from_ron(&raw)?;
    println!(
        "OK version={} name={} pair={} thrust={:.2} N Pc={:.0} Pa O/F={:.2}",
        d.meta.schema_version,
        d.meta.name,
        d.propellant.pair.label(),
        d.operating_point.thrust.as_si(),
        d.operating_point.chamber_pressure.as_si(),
        d.operating_point.mixture_ratio.as_f64(),
    );
    Ok(())
}

fn print_usage() {
    eprintln!(
        "apro-engine
  USAGE:
    apro-engine new     [--name=NAME] [--by=BY] [--out=PATH]
    apro-engine resolve [--project=PATH]
    apro-engine dump    [--project=PATH]
    apro-engine verify  [--project=PATH]
    apro-engine golden  (Krzycki 20 lbf / 300 psi demo)
    apro-engine report  [--out=PATH]  (PDF design report)"
    );
}
