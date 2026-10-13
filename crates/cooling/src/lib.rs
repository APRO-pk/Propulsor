//! Regenerative cooling solver (L3).
//!
//! 1D axial mesh over the L2 nozzle contour. At each station:
//!   - Gas-side: **Bartz** convective heat-transfer coefficient.
//!   - Coolant-side: **Gnielinski** (turbulent) with a Dittus–Boelter fallback.
//!   - Wall: conduction through the chamber/nozzle wall.
//!   - Coolant limit: boiling margin vs the coolant saturation temperature when
//!     the jacket is subcritical; above the coolant's critical pressure there is
//!     no boiling, so the limit is its coking temperature (RP-1) or none at all.
//!
//! All inputs are canonical SI. The gas properties (γ, Tc, Pc, c*, MW) come from
//! L1; the contour `r(x)` from L2; the wall material and coolant gap from L0;
//! the coolant (normally the fuel) from [`coolants`].

use engine_core::{ContourPoint, EngineError};
use gasdynamics::quasi1d::{mach_from_area, pressure_ratio, subsonic_mach_from_area, temperature_ratio};

pub mod ablative;
pub mod coolant_tables;
pub mod coolants;
pub mod film;
pub mod materials;
pub mod printing;
pub mod radiation;

pub const RU: f64 = 8.314462618;
const ATM_PA: f64 = 101_325.0;
/// Highest surface-to-bulk temperature ratio in Taylor's hydrogen data (NASA TN D-4332).
const TAYLOR_MAX_WALL_TO_BULK: f64 = 23.0;

/// L3 inputs.
#[derive(Debug, Clone)]
pub struct L3Input {
    pub stations: Vec<ContourPoint>,
    pub throat_radius_m: f64,
    pub gamma: f64,
    pub tc_k: f64,
    pub pc_pa: f64,
    pub c_star_m_s: f64,
    pub mw_g_per_mol: f64,
    /// Wall material (sets thermal conductivity and the service-temperature limit).
    pub wall_material: materials::Material,
    /// Wall thickness, m.
    pub wall_thickness_m: f64,
    /// Coolant gap (annular channel), m — used when there are no discrete channels
    /// and no fixed coolant mass flow.
    pub coolant_gap_m: f64,
    /// Coolant inlet velocity, m/s. Sets the mass flow when `coolant_mass_flow_kg_s`
    /// is `None`; with a fixed mass flow it is the design velocity that sizes the
    /// annular gap (unused with discrete channels).
    pub coolant_velocity_m_s: f64,
    /// Coolant mass flow through the jacket, kg/s — the propellant flow when the
    /// coolant is a propellant; `None` for an external coolant (e.g. test-stand water).
    pub coolant_mass_flow_kg_s: Option<f64>,
    /// Number of discrete milled/printed cooling channels (0 = annular gap model).
    pub channel_count: f64,
    /// Rectangular channel width, m (used when `channel_count` > 0).
    pub channel_width_m: f64,
    /// Rectangular channel height/depth, m (used when `channel_count` > 0).
    pub channel_height_m: f64,
    /// Coolant inlet pressure, Pa.
    pub coolant_pressure_pa: f64,
    /// The coolant fluid (temperature-dependent property tables).
    pub coolant: coolants::Coolant,
    /// Optional wall film cooling injected at a given axial station.
    pub film_cooling: Option<FilmCoolingConfig>,
    /// Hot-gas-side carbon-deposit (soot) thermal resistance, m²·K/W, in series
    /// between the gas film and the metal wall; 0 = clean wall. A design input:
    /// sources disagree on its magnitude for LOX/hydrocarbon main chambers (Cook,
    /// NASA CR-159790; Masters et al., NASA TP-2862), so no value is assumed.
    pub deposit_resistance_m2k_w: f64,
}

/// A wall film-cooling injection, applied to all stations downstream of the slot.
#[derive(Debug, Clone)]
pub struct FilmCoolingConfig {
    /// Axial location of the film slot, m.
    pub injection_x_m: f64,
    pub coolant_temp_k: f64,
    pub coolant_density_kg_m3: f64,
    pub coolant_velocity_m_s: f64,
    pub coolant_viscosity_pa_s: f64,
    pub slot_height_m: f64,
}

/// A single cooling station result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CoolingStation {
    pub x: f64,
    pub r: f64,
    pub gas_temp_k: f64,
    pub wall_temp_k: f64,
    pub wall_limit_k: f64,
    pub coolant_temp_k: f64,
    pub coolant_pressure_pa: f64,
    pub coolant_velocity_m_s: f64,
    /// Saturation temperature minus the coolant-side wall temperature, K —
    /// `None` when the jacket is supercritical (no boiling).
    #[serde(default)]
    pub boiling_margin_k: Option<f64>,
    /// Governing coolant limit (boiling or coking, whichever is lower) minus the
    /// coolant-side wall temperature, K — `None` when no limit applies.
    #[serde(default)]
    pub coolant_margin_k: Option<f64>,
    pub h_gas: f64,
    /// Wall heat flux at this station, W/m².
    #[serde(default)]
    pub heat_flux_w_m2: f64,
    /// Film-cooling effectiveness at this station (0 if no film).
    #[serde(default)]
    pub film_effectiveness: f64,
    /// Coolant-side wall temperature, K (what boiling/coking are checked against).
    #[serde(default)]
    pub coolant_wall_temp_k: f64,
    /// Coolant-side heat-transfer coefficient, W/(m²·K).
    #[serde(default)]
    pub h_coolant: f64,
    /// Static hot-gas pressure at this station, Pa (the liner carries coolant − gas).
    #[serde(default)]
    pub gas_pressure_pa: f64,
}

/// L3 result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CoolingResult {
    pub stations: Vec<CoolingStation>,
    pub max_wall_temp_k: f64,
    /// Minimum boiling margin, K — `None` when the jacket is supercritical.
    #[serde(default)]
    pub min_boiling_margin_k: Option<f64>,
    /// Minimum margin to the governing coolant limit, K — `None` when no limit applies.
    #[serde(default)]
    pub min_coolant_margin_k: Option<f64>,
    pub coolant_dp_pa: f64,
    pub wall_material_limit_k: f64,
    /// Hot-gas wall thickness the heat is conducted through, m.
    #[serde(default)]
    pub wall_thickness_m: f64,
    /// Which coolant was used and which limit governs it.
    #[serde(default)]
    pub coolant: CoolantReport,
}

/// The coolant and its governing limit, as reported with an L3 result.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct CoolantReport {
    pub name: String,
    pub source: String,
    pub inlet_temp_k: f64,
    pub inlet_pressure_pa: f64,
    /// Pressure leaving the jacket (inlet minus the friction drop), Pa.
    pub outlet_pressure_pa: f64,
    pub critical_pressure_pa: f64,
    /// The whole circuit is at/above the coolant's critical pressure (no boiling).
    pub supercritical: bool,
    /// Saturation temperature at the lowest (outlet) pressure, K — the most
    /// limiting one (`None` if the outlet is supercritical). Station margins use
    /// the local pressure.
    pub saturation_temp_k: Option<f64>,
    /// Coking wall-temperature limit, K, when one is sourced.
    pub coking_limit_k: Option<f64>,
    /// `"boiling"`, `"coking"` or `"none"` — what `min_coolant_margin_k` is measured to.
    pub limit_kind: String,
    /// The governing limit temperature at the outlet pressure, K.
    pub limit_k: Option<f64>,
    /// Coolant mass flow through the jacket, kg/s.
    pub mass_flow_kg_s: f64,
    /// Bulk temperature leaving the jacket, K.
    pub outlet_temp_k: f64,
    /// Bulk velocity at the jacket inlet, m/s.
    pub inlet_velocity_m_s: f64,
    /// Highest bulk velocity along the circuit (the coolant expands as it heats), m/s.
    pub max_velocity_m_s: f64,
    /// Total coolant flow area, m².
    pub flow_area_m2: f64,
    /// Coolant-passage hydraulic diameter, m.
    pub hydraulic_diameter_m: f64,
    /// Coolant-side heat-transfer correlation used.
    pub correlation: String,
    /// Which property table(s) the march used.
    pub property_basis: String,
    /// Plain-language statement of which check applies and why.
    pub note: String,
}

impl CoolantReport {
    fn new(c: &coolants::Coolant, p_in: f64, p_out: f64, mass_flow_kg_s: f64) -> Self {
        // The outlet has the lowest pressure, so the lowest T_sat: it governs boiling.
        let t_sat = c.saturation_temp_k(p_out);
        let (limit_kind, limit_k) = match (t_sat, c.coking_limit_k) {
            (Some(ts), Some(tk)) if tk < ts => ("coking", Some(tk)),
            (Some(ts), _) => ("boiling", Some(ts)),
            (None, Some(tk)) => ("coking", Some(tk)),
            (None, None) => ("none", None),
        };
        let pressures = if (p_in - p_out).abs() < 0.05e5 {
            format!("{:.1} bar", p_in / 1e5)
        } else {
            format!("{:.1} → {:.1} bar", p_in / 1e5, p_out / 1e5)
        };
        let pcr_bar = c.critical_pressure_pa / 1e5;
        let coking = c.coking_limit_k.unwrap_or(0.0);
        let state = match (c.is_supercritical(p_in), t_sat) {
            (true, None) => format!("{} at {pressures} stays supercritical (P_crit {pcr_bar:.1} bar)", c.name),
            (true, Some(ts)) => format!(
                "{} enters supercritical but falls below P_crit {pcr_bar:.1} bar along the jacket ({pressures}); it can boil where subcritical (T_sat {ts:.0} K at the outlet)",
                c.name
            ),
            (false, Some(ts)) => format!(
                "{} at {pressures} is subcritical (P_crit {pcr_bar:.1} bar; T_sat {ts:.0} K at the outlet)",
                c.name
            ),
            (false, None) => unreachable!("outlet pressure cannot exceed the inlet"),
        };
        let note = match limit_kind {
            "boiling" => format!("{state}: boiling margin vs the local T_sat."),
            "coking" if t_sat.is_some() => format!(
                "{state}, but the coking limit {coking:.0} K is lower and governs ({}).",
                coolants::RP1_COKING_SOURCE
            ),
            "coking" => format!(
                "{state}: no boiling, so the boiling check is replaced by the coolant-side wall coking limit {coking:.0} K ({}).",
                coolants::RP1_COKING_SOURCE
            ),
            _ => format!("{state}: no boiling, and no sourced coking/decomposition limit — only the wall-material limit applies."),
        };
        CoolantReport {
            name: c.name.to_string(),
            source: c.source.to_string(),
            inlet_temp_k: c.inlet_temp_k,
            inlet_pressure_pa: p_in,
            outlet_pressure_pa: p_out,
            critical_pressure_pa: c.critical_pressure_pa,
            supercritical: t_sat.is_none(),
            saturation_temp_k: t_sat,
            coking_limit_k: c.coking_limit_k,
            limit_kind: limit_kind.to_string(),
            limit_k,
            mass_flow_kg_s,
            note,
            ..Default::default()
        }
    }
}

impl CoolingResult {
    pub fn summary(&self) -> String {
        let margin = match self.min_coolant_margin_k {
            Some(m) => format!("{}_margin,min={m:.0} K", self.coolant.limit_kind),
            None => "no coolant limit (supercritical)".to_string(),
        };
        format!(
            "T_wall,max={:.0} K (limit {:.0}) | coolant {} | {margin} | coolant_dP={:.0} kPa",
            self.max_wall_temp_k,
            self.wall_material_limit_k,
            self.coolant.name,
            self.coolant_dp_pa / 1000.0,
        )
    }

    /// Per-station heat-flux and wall-temperature table as CSV, for import as a
    /// thermal boundary condition into an FEM solver.
    pub fn heat_flux_csv(&self) -> String {
        let mut s = String::from(
            "x_m,r_m,heat_flux_w_m2,h_gas_w_m2_k,gas_temp_k,wall_temp_k,coolant_temp_k,coolant_wall_temp_k,h_coolant_w_m2_k\n",
        );
        for st in &self.stations {
            s.push_str(&format!(
                "{:.6},{:.6},{:.3},{:.3},{:.2},{:.2},{:.2},{:.2},{:.3}\n",
                st.x,
                st.r,
                st.heat_flux_w_m2,
                st.h_gas,
                st.gas_temp_k,
                st.wall_temp_k,
                st.coolant_temp_k,
                st.coolant_wall_temp_k,
                st.h_coolant,
            ));
        }
        s
    }
}

/// Solve the regenerative cooling model along the chamber + nozzle contour
/// (x < 0 upstream of the throat).
pub fn solve_l3(input: &L3Input) -> Result<CoolingResult, EngineError> {
    if input.stations.len() < 2 {
        return Err(EngineError::Precondition("need >= 2 contour stations".into()));
    }
    if input.coolant_gap_m <= 0.0 {
        return Err(EngineError::out_of_domain("coolant_gap", 1e-5, 1.0, input.coolant_gap_m));
    }

    let r_t = input.throat_radius_m;
    let area_ratio_at = |r: f64| (r / r_t).powi(2);

    // Gas mixture properties.
    let r_spec = RU / (input.mw_g_per_mol * 1e-3);

    // Wall material sets conduction and the temperature limit.
    let wall_k = input.wall_material.thermal_conductivity_w_m_k;
    let r_deposit = input.deposit_resistance_m2k_w.max(0.0);
    let wall_limit = input.wall_material.max_service_temp_k;

    // Coolant (normally the fuel) with temperature-dependent properties. Its bulk
    // enthalpy is marched along the circuit, and the property curve is rebuilt at
    // each station's local pressure (inlet minus the friction drop so far), so the
    // bulk temperature, density, viscosity, conductivity and cp all follow the
    // coolant as it heats — through the pseudo-critical region for supercritical
    // LH2/LCH4.
    let coolant = &input.coolant;
    let p_in = input.coolant_pressure_pa;
    let inlet_curve = coolant.curve(p_in);
    let inlet = inlet_curve.at(coolant.inlet_temp_k);

    // Coolant-side geometry: discrete rectangular channels when specified, else an
    // annulus at the throat. With a fixed propellant mass flow the annular gap is
    // sized for the design velocity at the inlet (ṁ = ρ·v·π·D_t·gap, as L0 sizes
    // its water jacket); otherwise the L0 gap is used and the velocity sets ṁ.
    let channels = input.channel_count > 0.0 && input.channel_width_m > 0.0 && input.channel_height_m > 0.0;
    let circumference = std::f64::consts::PI * (2.0 * r_t);
    let gap = match input.coolant_mass_flow_kg_s {
        Some(m) if !channels => m / (inlet.rho * input.coolant_velocity_m_s.max(0.1) * circumference),
        _ => input.coolant_gap_m,
    };
    let (d_h, flow_area) = if channels {
        let w = input.channel_width_m;
        let h = input.channel_height_m;
        (2.0 * w * h / (w + h), input.channel_count * w * h)
    } else {
        (2.0 * gap, circumference * gap)
    };
    let m_dot_cool = input
        .coolant_mass_flow_kg_s
        .unwrap_or(inlet.rho * input.coolant_velocity_m_s * flow_area)
        .max(1e-4);
    // Mass flux is fixed by continuity; velocity and Re vary with ρ(T), μ(T).
    let g_flux = m_dot_cool / flow_area;

    // Coolant-side coefficient from bulk properties, corrected for the hotter
    // fluid at the wall (`t_wall` = coolant-side wall temperature; no correction
    // when the wall is not hotter than the bulk).
    let h_cool_at = |curve: &coolants::PropertyCurve, b: &coolants::FluidState, t_wall: f64| -> (f64, f64) {
        let re = g_flux * d_h / b.mu;
        let t_wall = t_wall.max(b.t_k);
        let h = match coolant.correlation {
            coolants::Correlation::Taylor => {
                // Held at the correlation's data limit rather than extrapolated: past
                // it (T_w/T_b)^-0.57 keeps cutting h as the wall heats, which runs away.
                let ratio = (t_wall / b.t_k).min(TAYLOR_MAX_WALL_TO_BULK);
                0.023 * re.powf(0.8) * b.prandtl().powf(0.4) * ratio.powf(-0.57) * b.k / d_h
            }
            coolants::Correlation::GnielinskiPetukhov => {
                gnielinski(re, b.prandtl(), d_h, b.k) * (b.mu / curve.at(t_wall).mu).powf(0.11)
            }
        };
        (h, re)
    };
    let (h_cool_inlet, _) = h_cool_at(&inlet_curve, &inlet, inlet.t_k);

    // Per-station gas-side properties (static gas temperature, the temperature the
    // wall actually sees after any film, and the Bartz coefficient). Stations
    // upstream of the throat (x < 0: chamber barrel and convergent) are subsonic.
    struct GasSide {
        t_gas: f64,
        t_drive: f64,
        h_gas: f64,
        film_eff: f64,
        p_gas: f64,
    }
    let gas: Vec<GasSide> = input
        .stations
        .iter()
        .map(|pt| {
            let ar = area_ratio_at(pt.r).max(1.0);
            let m = if pt.x < 0.0 { subsonic_mach_from_area(ar, input.gamma) } else { mach_from_area(ar, input.gamma) };
            let t_gas = input.tc_k * temperature_ratio(m, input.gamma);
            let p_gas = input.pc_pa * pressure_ratio(m, input.gamma);
            let rho_gas = p_gas / (r_spec * t_gas);
            let velocity_gas = m * (input.gamma * r_spec * t_gas).sqrt();
            let (t_drive, film_eff) = film_driving_temp(input, pt.x, t_gas, rho_gas, velocity_gas);
            // Hot-wall iteration for the Bartz coefficient (uses inlet coolant as a
            // conservative lower bound while converging the wall temperature guess).
            let mut t_wall = 800.0;
            let mut h_gas = 0.0;
            for _ in 0..4 {
                let t_film = 0.5 * (t_drive + t_wall);
                let (mu_gas, cp_gas, pr_gas) = gas_transport(input.gamma, r_spec, t_film);
                h_gas = bartz(input.gamma, input.pc_pa, input.c_star_m_s, r_t, ar, m, t_drive, cp_gas, pr_gas, mu_gas, t_wall);
                let u = 1.0 / (1.0 / h_gas + r_deposit + input.wall_thickness_m / wall_k + 1.0 / h_cool_inlet);
                let q = u * (t_drive - inlet.t_k);
                // Bartz's property correction uses the gas-side surface, i.e. the
                // deposit surface when there is one.
                t_wall = (t_drive - q / h_gas).max(300.0);
            }
            GasSide { t_gas, t_drive, h_gas, film_eff, p_gas }
        })
        .collect();

    // Axial spacing per station (wall area for the coolant energy balance).
    let n = input.stations.len();
    let dx: Vec<f64> = (0..n)
        .map(|i| {
            let xi = input.stations[i].x;
            let lo = if i > 0 { input.stations[i - 1].x } else { xi };
            let hi = if i + 1 < n { input.stations[i + 1].x } else { xi };
            ((hi - lo) / 2.0).abs().max(1e-6)
        })
        .collect();

    // March the coolant from the nozzle exit (coolest gas) toward the injector —
    // counterflow. At each station the wall heat flux, the coolant-side
    // coefficient and the coolant-side wall temperature are solved together (the
    // property correction depends on that wall temperature); the absorbed heat
    // raises the bulk enthalpy, dh = q·dA/ṁ, the temperature follows from h(T) at
    // the local pressure, and the Blasius friction drop lowers that pressure.
    struct CoolSide {
        t_bulk: f64,
        h_cool: f64,
        velocity: f64,
        q: f64,
        t_cool_wall: f64,
        pressure: f64,
    }
    let mut march: Vec<usize> = (0..n).collect();
    march.sort_by(|&a, &b| input.stations[b].x.partial_cmp(&input.stations[a].x).unwrap_or(std::cmp::Ordering::Equal));
    let mut cool: Vec<Option<CoolSide>> = (0..n).map(|_| None).collect();
    let mut t_bulk = inlet.t_k;
    let mut pressure = p_in;
    let mut coolant_dp = 0.0;
    let mut pressure_exhausted = false;
    let mut beyond_correlation = 0usize;
    for &i in &march {
        let curve = if pressure == p_in { inlet_curve.clone() } else { coolant.curve(pressure) };
        let b = curve.at(t_bulk);
        let g = &gas[i];
        let conduction = r_deposit + input.wall_thickness_m / wall_k;
        // Damped fixed point on the coolant-side wall temperature.
        let mut t_cw = b.t_k;
        let (mut h_cool, mut re, mut q) = (0.0, 0.0, 0.0);
        for _ in 0..40 {
            (h_cool, re) = h_cool_at(&curve, &b, t_cw);
            q = ((g.t_drive - b.t_k) / (1.0 / g.h_gas + conduction + 1.0 / h_cool)).max(0.0);
            let next = b.t_k + q / h_cool;
            let done = (next - t_cw).abs() < 0.01;
            t_cw = if done { next } else { 0.5 * (t_cw + next) };
            if done {
                break;
            }
        }
        let velocity = g_flux / b.rho;
        let t_cool_wall = b.t_k + q / h_cool;
        if coolant.correlation == coolants::Correlation::Taylor && t_cool_wall > TAYLOR_MAX_WALL_TO_BULK * b.t_k {
            beyond_correlation += 1;
        }
        cool[i] = Some(CoolSide { t_bulk: b.t_k, h_cool, velocity, q, t_cool_wall, pressure });
        let d_area = 2.0 * std::f64::consts::PI * input.stations[i].r.max(1e-4) * dx[i];
        t_bulk = curve.temp_from_enthalpy(b.h + q * d_area / m_dot_cool);
        let f_darcy = 0.316 / re.max(1.0).powf(0.25);
        let dp = f_darcy * (dx[i] / d_h) * 0.5 * b.rho * velocity * velocity;
        coolant_dp += dp;
        if pressure - dp < ATM_PA {
            pressure_exhausted = true;
        }
        pressure = (pressure - dp).max(ATM_PA);
    }
    let outlet_temp = t_bulk;
    let outlet_curve_tmax = coolant.curve(pressure).t_max();

    // Build the station results in contour order, using the marched coolant states.
    let mut stations = Vec::with_capacity(n);
    let mut max_wall = f64::NEG_INFINITY;
    let mut max_velocity: f64 = 0.0;
    let mut min_boil: Option<f64> = None;
    let mut min_margin: Option<f64> = None;
    for i in 0..n {
        let pt = &input.stations[i];
        let g = &gas[i];
        let c = cool[i].as_ref().expect("every station is marched");
        // Metal hot-side temperature, beneath any carbon deposit.
        let t_wall = g.t_drive - c.q * (1.0 / g.h_gas + r_deposit);
        // Coolant-side wall temperature is the limiting one for boiling and coking;
        // boiling is checked against T_sat at the local pressure.
        let t_sat = coolant.saturation_temp_k(c.pressure);
        let limit = match (t_sat, coolant.coking_limit_k) {
            (Some(ts), Some(tk)) => Some(ts.min(tk)),
            (a, b) => a.or(b),
        };
        let boil_margin = t_sat.map(|ts| ts - c.t_cool_wall);
        let margin = limit.map(|tl| tl - c.t_cool_wall);
        max_wall = max_wall.max(t_wall);
        max_velocity = max_velocity.max(c.velocity);
        min_boil = opt_min(min_boil, boil_margin);
        min_margin = opt_min(min_margin, margin);
        stations.push(CoolingStation {
            x: pt.x,
            r: pt.r,
            gas_temp_k: g.t_gas,
            wall_temp_k: t_wall,
            wall_limit_k: wall_limit,
            coolant_temp_k: c.t_bulk,
            coolant_pressure_pa: c.pressure,
            coolant_velocity_m_s: c.velocity,
            boiling_margin_k: boil_margin,
            coolant_margin_k: margin,
            h_gas: g.h_gas,
            heat_flux_w_m2: c.q,
            film_effectiveness: g.film_eff,
            coolant_wall_temp_k: c.t_cool_wall,
            h_coolant: c.h_cool,
            gas_pressure_pa: g.p_gas,
        });
    }

    let mut report = CoolantReport::new(coolant, p_in, pressure, m_dot_cool);
    if pressure_exhausted {
        report.note.push_str(&format!(
            " The jacket friction drop ({:.1} bar) exceeds the inlet pressure; the coolant pressure was floored at 1 atm.",
            coolant_dp / 1e5
        ));
    }
    if beyond_correlation > 0 {
        report.note.push_str(&format!(
            " At {beyond_correlation} of {n} stations the coolant-side wall exceeds {TAYLOR_MAX_WALL_TO_BULK:.0}× the bulk temperature, beyond Taylor's data (NASA TN D-4332); the wall-property correction is held at that limit there, so those coefficients are extrapolated."
        ));
    }
    report.outlet_temp_k = outlet_temp;
    report.inlet_velocity_m_s = g_flux / inlet.rho;
    report.max_velocity_m_s = max_velocity;
    report.flow_area_m2 = flow_area;
    report.hydraulic_diameter_m = d_h;
    report.correlation = match coolant.correlation {
        coolants::Correlation::Taylor => "Taylor (NASA TN D-4332), (T_w/T_b)^-0.57".into(),
        coolants::Correlation::GnielinskiPetukhov => "Gnielinski × (μ_b/μ_w)^0.11 (Petukhov)".into(),
    };
    report.property_basis = if outlet_temp > outlet_curve_tmax {
        format!(
            "{}; outlet {outlet_temp:.0} K is beyond the table ({outlet_curve_tmax:.0} K), so properties are held at the last row",
            inlet_curve.basis
        )
    } else {
        inlet_curve.basis.clone()
    };

    Ok(CoolingResult {
        stations,
        max_wall_temp_k: max_wall,
        min_boiling_margin_k: min_boil,
        min_coolant_margin_k: min_margin,
        coolant_dp_pa: coolant_dp,
        wall_material_limit_k: wall_limit,
        wall_thickness_m: input.wall_thickness_m,
        coolant: report,
    })
}

fn opt_min(a: Option<f64>, b: Option<f64>) -> Option<f64> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.min(y)),
        (x, None) => x,
        (None, y) => y,
    }
}

/// Effective gas driving temperature at an axial station, reduced by wall film
/// cooling when a film slot is present upstream. Returns `(t_drive, effectiveness)`.
fn film_driving_temp(
    input: &L3Input,
    x: f64,
    t_gas: f64,
    rho_gas: f64,
    velocity_gas: f64,
) -> (f64, f64) {
    let Some(cfg) = &input.film_cooling else {
        return (t_gas, 0.0);
    };
    if x < cfg.injection_x_m {
        return (t_gas, 0.0);
    }
    let g_c = cfg.coolant_density_kg_m3 * cfg.coolant_velocity_m_s;
    let g_g = (rho_gas * velocity_gas).max(1e-9);
    let blowing = g_c / g_g;
    let re_s = cfg.coolant_density_kg_m3 * cfg.coolant_velocity_m_s * cfg.slot_height_m
        / cfg.coolant_viscosity_pa_s.max(1e-9);
    let eta = film::effectiveness(x - cfg.injection_x_m, blowing, cfg.slot_height_m, re_s);
    (t_gas - eta * (t_gas - cfg.coolant_temp_k), eta)
}

/// Real-gas transport properties at the film temperature.
/// `cp` in J/(kg·K), `mu` in kg/(m·s), `pr` dimensionless.
fn gas_transport(gamma: f64, r_spec: f64, t_film: f64) -> (f64, f64, f64) {
    let cp = gamma * r_spec / (gamma - 1.0);
    // Combustion-gas viscosity (Sutherland-like, in the 1500–3500 K range).
    let mu = 6.8e-5 * (t_film / 2000.0).powf(0.7);
    // Eucken relation for Prandtl number of a polyatomic gas.
    let pr = 4.0 * gamma / (9.0 * gamma - 5.0);
    (mu, cp, pr)
}

/// Bartz gas-side heat-transfer coefficient (W/(m²·K)).
#[allow(clippy::too_many_arguments)]
fn bartz(
    gamma: f64,
    pc: f64,
    c_star: f64,
    r_t: f64,
    area_ratio: f64,
    mach: f64,
    t_gas: f64,
    cp_gas: f64,
    pr_gas: f64,
    mu: f64,
    t_wall: f64,
) -> f64 {
    let d_t = 2.0 * r_t;
    let r_c = 1.5 * r_t; // throat radius of curvature
    let sigma = {
        let m = mach;
        let tw_tg = (t_wall / t_gas).clamp(0.05, 0.95);
        (0.5 * tw_tg * (1.0 + (gamma - 1.0) / 2.0 * m * m) + 0.5).powf(-0.68)
    };
    let term = 0.026 / d_t.powf(0.2) * (mu.powf(0.2) * cp_gas / pr_gas.powf(0.6));
    term * (pc / c_star).powf(0.8) * (d_t / r_c).powf(0.1) * area_ratio.powf(-0.9) * sigma
}

/// Gnielinski turbulent correlation (W/(m²·K)); Dittus–Boelter fallback below Re 3000.
fn gnielinski(re: f64, pr: f64, d_h: f64, k: f64) -> f64 {
    if re < 3000.0 {
        // Laminar/transitional → Dittus-Boelter.
        let nu = 0.023 * re.powf(0.8) * pr.powf(0.4);
        return nu * k / d_h;
    }
    let f = (0.790 * re.ln() - 1.64).powi(-2);
    let nu = ((f / 8.0) * (re - 1000.0) * pr) / (1.0 + 12.7 * (f / 8.0).sqrt() * (pr.powf(2.0 / 3.0) - 1.0));
    nu * k / d_h
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> L3Input {
        let r_t = 0.005;
        let r_e = 0.01;
        let stations = gasdynamics::contour::bell_contour(r_t, r_e, 15.0, 20);
        L3Input {
            stations,
            throat_radius_m: r_t,
            gamma: 1.2,
            tc_k: 3400.0,
            pc_pa: 3.0e6,
            c_star_m_s: 1800.0,
            mw_g_per_mol: 22.0,
            wall_material: materials::copper_ofhc(),
            wall_thickness_m: 0.001,
            coolant_gap_m: 0.002,
            coolant_velocity_m_s: 6.0,
            coolant_mass_flow_kg_s: None,
            channel_count: 0.0,
            channel_width_m: 0.0,
            channel_height_m: 0.0,
            coolant_pressure_pa: 3.0e5,
            coolant: coolants::WATER,
            film_cooling: None,
            deposit_resistance_m2k_w: 0.0,
        }
    }

    #[test]
    fn subcritical_water_reports_a_boiling_margin() {
        let r = solve_l3(&input()).unwrap();
        assert_eq!(r.coolant.name, "Water");
        assert_eq!(r.coolant.limit_kind, "boiling");
        assert!(!r.coolant.supercritical);
        let t_sat = r.coolant.saturation_temp_k.unwrap();
        assert!((t_sat - 406.7).abs() < 2.5, "T_sat(3 bar) = {t_sat}");
        assert_eq!(r.min_boiling_margin_k, r.min_coolant_margin_k);
        assert!(r.stations.iter().all(|s| s.boiling_margin_k.is_some()));
    }

    /// RP-1 above its 21.7 bar critical pressure cannot boil: the boiling check is
    /// replaced by the coking limit, and the result says so.
    #[test]
    fn supercritical_rp1_uses_the_coking_limit() {
        let mut inp = input();
        inp.coolant = coolants::RP1;
        inp.pc_pa = 70e5;
        inp.coolant_pressure_pa = 1.35 * 70e5;
        let r = solve_l3(&inp).unwrap();
        assert!(r.coolant.supercritical);
        assert_eq!(r.coolant.limit_kind, "coking");
        assert_eq!(r.coolant.limit_k, Some(coolants::RP1_COKING_LIMIT_K));
        assert!(r.min_boiling_margin_k.is_none());
        assert!(r.stations.iter().all(|s| s.boiling_margin_k.is_none() && s.coolant_margin_k.is_some()));
        assert!(r.coolant.note.contains("supercritical") && r.coolant.note.contains("coking"), "{}", r.coolant.note);
        // The JSON round-trip the tier cache relies on must survive the Options.
        let back: CoolingResult = serde_json::from_value(serde_json::to_value(&r).unwrap()).unwrap();
        assert_eq!(back.coolant, r.coolant);
    }

    #[test]
    fn subcritical_rp1_is_governed_by_the_lower_of_boiling_and_coking() {
        let mut inp = input();
        inp.coolant = coolants::RP1;
        inp.coolant_pressure_pa = 3.0e5;
        let r = solve_l3(&inp).unwrap();
        assert!(!r.coolant.supercritical);
        let t_sat = r.coolant.saturation_temp_k.unwrap();
        // RP-1 boils near 540 K at 3 bar, below its 600 K coking limit.
        assert!(t_sat < coolants::RP1_COKING_LIMIT_K, "T_sat = {t_sat}");
        assert_eq!(r.coolant.limit_kind, "boiling");
    }

    #[test]
    fn supercritical_hydrogen_has_no_coolant_limit() {
        let mut inp = input();
        inp.coolant = coolants::HYDROGEN;
        inp.coolant_pressure_pa = 60e5;
        let r = solve_l3(&inp).unwrap();
        assert_eq!(r.coolant.limit_kind, "none");
        assert!(r.min_coolant_margin_k.is_none() && r.min_boiling_margin_k.is_none());
        assert!(r.summary().contains("no coolant limit"));
    }

    /// The coolant's own properties drive the coolant side: at the same velocity
    /// and geometry, water (k ≈ 0.6) cools better than RP-1 (k ≈ 0.14).
    #[test]
    fn coolant_properties_change_the_wall_temperature() {
        let water = solve_l3(&input()).unwrap();
        let mut inp = input();
        inp.coolant = coolants::RP1;
        let rp1 = solve_l3(&inp).unwrap();
        assert!(rp1.max_wall_temp_k > water.max_wall_temp_k, "RP-1 {} vs water {}", rp1.max_wall_temp_k, water.max_wall_temp_k);
        // Same inlet velocity and area → mass flow scales with the inlet density.
        let ratio = rp1.coolant.mass_flow_kg_s / water.coolant.mass_flow_kg_s;
        assert!((ratio - 810.0 / 998.2).abs() < 0.01, "ṁ ratio {ratio}");
    }

    /// The enthalpy march conserves energy: ṁ·(h_out − h_in) equals the wall heat
    /// absorbed over the circuit. Exact where the property table does not depend
    /// on pressure (water, RP-1); within 2 % for LH2, whose isobar is re-read at the
    /// falling local pressure.
    #[test]
    fn coolant_march_conserves_energy() {
        for (coolant, p, tol) in [(coolants::WATER, 3e5, 1e-6), (coolants::RP1, 90e5, 1e-6), (coolants::HYDROGEN, 60e5, 0.02)] {
            let mut inp = input();
            inp.coolant = coolant;
            inp.coolant_pressure_pa = p;
            inp.coolant_mass_flow_kg_s = Some(0.05);
            let r = solve_l3(&inp).unwrap();
            let n = r.stations.len();
            let q_total: f64 = (0..n)
                .map(|i| {
                    let lo = r.stations[i.saturating_sub(1)].x;
                    let hi = r.stations[(i + 1).min(n - 1)].x;
                    let dx = ((hi - lo) / 2.0).abs().max(1e-6);
                    r.stations[i].heat_flux_w_m2 * 2.0 * std::f64::consts::PI * r.stations[i].r.max(1e-4) * dx
                })
                .sum();
            let curve = coolant.curve(p);
            let absorbed = 0.05 * (curve.at(r.coolant.outlet_temp_k).h - curve.at(coolant.inlet_temp_k).h);
            assert!((absorbed / q_total - 1.0).abs() < tol, "{}: absorbed {absorbed} W vs wall {q_total} W", coolant.name);
            assert!(r.coolant.outlet_temp_k > coolant.inlet_temp_k);
        }
    }

    /// The coolant pressure falls along the circuit by exactly the friction drop,
    /// and boiling is checked against the local (lower) saturation temperature.
    #[test]
    fn coolant_pressure_falls_along_the_circuit() {
        let mut inp = input();
        inp.coolant_velocity_m_s = 20.0;
        let r = solve_l3(&inp).unwrap();
        let mut by_flow: Vec<&CoolingStation> = r.stations.iter().collect();
        by_flow.sort_by(|a, b| b.x.partial_cmp(&a.x).unwrap()); // exit → injector
        assert_eq!(by_flow[0].coolant_pressure_pa, inp.coolant_pressure_pa);
        assert!(by_flow.windows(2).all(|w| w[1].coolant_pressure_pa < w[0].coolant_pressure_pa));
        let drop = inp.coolant_pressure_pa - r.coolant.outlet_pressure_pa;
        assert!((drop - r.coolant_dp_pa).abs() < 1e-6, "{drop} vs {}", r.coolant_dp_pa);
        let t_sat_out = coolants::WATER.saturation_temp_k(r.coolant.outlet_pressure_pa).unwrap();
        assert_eq!(r.coolant.saturation_temp_k, Some(t_sat_out));
    }

    /// The coolant-side coefficient carries a wall-to-bulk property correction:
    /// a heated liquid is thinner at the wall (Petukhov raises h), a heated gas-like
    /// coolant is hotter and lighter there (Taylor lowers h for hydrogen).
    #[test]
    fn coolant_side_wall_property_correction() {
        for (coolant, p, raises) in [(coolants::RP1, 90e5, true), (coolants::HYDROGEN, 60e5, false)] {
            let mut inp = input();
            inp.coolant = coolant;
            inp.coolant_pressure_pa = p;
            inp.coolant_mass_flow_kg_s = Some(if raises { 0.08 } else { 0.01 });
            let r = solve_l3(&inp).unwrap();
            let d_h = r.coolant.hydraulic_diameter_m;
            let g_flux = r.coolant.mass_flow_kg_s / r.coolant.flow_area_m2;
            for s in &r.stations {
                assert!(s.coolant_wall_temp_k > s.coolant_temp_k, "{}: wall not hotter than bulk", coolant.name);
                let b = coolant.curve(s.coolant_pressure_pa).at(s.coolant_temp_k);
                let re = g_flux * d_h / b.mu;
                let bulk_only = match coolant.correlation {
                    coolants::Correlation::Taylor => 0.023 * re.powf(0.8) * b.prandtl().powf(0.4) * b.k / d_h,
                    coolants::Correlation::GnielinskiPetukhov => gnielinski(re, b.prandtl(), d_h, b.k),
                };
                if raises {
                    assert!(s.h_coolant > bulk_only, "{}: {} vs bulk {bulk_only}", coolant.name, s.h_coolant);
                } else {
                    assert!(s.h_coolant < bulk_only, "{}: {} vs bulk {bulk_only}", coolant.name, s.h_coolant);
                }
                // The station's flux, coefficient and wall temperature are consistent.
                assert!((s.coolant_temp_k + s.heat_flux_w_m2 / s.h_coolant - s.coolant_wall_temp_k).abs() < 1e-6);
            }
        }
    }

    /// Stations upstream of the throat (x < 0) are subsonic: the gas there is near
    /// chamber pressure and temperature, not on the supersonic branch.
    #[test]
    fn chamber_stations_are_subsonic() {
        let mut inp = input();
        let r_c = 2.0 * inp.throat_radius_m;
        let mut stations: Vec<ContourPoint> = (0..6).map(|i| ContourPoint { x: -0.03 + 0.005 * i as f64, r: r_c }).collect();
        stations.extend(inp.stations.iter().copied());
        inp.stations = stations;
        let r = solve_l3(&inp).unwrap();
        for s in r.stations.iter().filter(|s| s.x < 0.0) {
            assert!(s.gas_pressure_pa > 0.95 * inp.pc_pa && s.gas_temp_k > 0.98 * inp.tc_k, "{s:?}");
        }
        let throat = r.stations.iter().find(|s| s.x == 0.0).unwrap();
        let barrel = &r.stations[0];
        assert!(throat.heat_flux_w_m2 > barrel.heat_flux_w_m2);
    }

    /// A fixed propellant mass flow sets the coolant side: the annulus is sized for
    /// the design velocity, and more flow (at the same gap) cools the wall better.
    #[test]
    fn fixed_mass_flow_sizes_the_annulus_and_sets_velocity() {
        let mut inp = input();
        inp.coolant = coolants::RP1;
        inp.coolant_pressure_pa = 90e5;
        inp.coolant_mass_flow_kg_s = Some(0.08);
        inp.coolant_velocity_m_s = 15.0;
        let r = solve_l3(&inp).unwrap();
        assert!((r.coolant.mass_flow_kg_s - 0.08).abs() < 1e-12);
        assert!((r.coolant.inlet_velocity_m_s - 15.0).abs() < 1e-9, "v_in = {}", r.coolant.inlet_velocity_m_s);
        // Annulus: ṁ = ρ_in·v·π·D_t·gap, with D_h = 2·gap.
        let rho_in = coolants::RP1.curve(90e5).at(coolants::RP1.inlet_temp_k).rho;
        let gap = 0.08 / (rho_in * 15.0 * std::f64::consts::PI * 2.0 * inp.throat_radius_m);
        assert!((r.coolant.hydraulic_diameter_m - 2.0 * gap).abs() < 1e-12);

        // Same channels, double the flow → faster coolant, cooler wall.
        let mut ch = inp.clone();
        ch.channel_count = 20.0;
        ch.channel_width_m = 1.0e-3;
        ch.channel_height_m = 2.0e-3;
        let base = solve_l3(&ch).unwrap();
        ch.coolant_mass_flow_kg_s = Some(0.16);
        let more = solve_l3(&ch).unwrap();
        assert!((more.coolant.inlet_velocity_m_s / base.coolant.inlet_velocity_m_s - 2.0).abs() < 1e-9);
        assert!(more.max_wall_temp_k < base.max_wall_temp_k);
        assert!(more.coolant.outlet_temp_k < base.coolant.outlet_temp_k);
    }

    /// Supercritical LH2 is heated far past its critical temperature: the density
    /// collapses, so the coolant accelerates along the circuit — the behaviour the
    /// constant-property model could not represent.
    #[test]
    fn supercritical_hydrogen_expands_along_the_circuit() {
        let mut inp = input();
        inp.coolant = coolants::HYDROGEN;
        inp.coolant_pressure_pa = 60e5;
        inp.coolant_mass_flow_kg_s = Some(0.01);
        let r = solve_l3(&inp).unwrap();
        assert!(r.coolant.outlet_temp_k > coolants::HYDROGEN.critical_temp_k, "outlet {} K", r.coolant.outlet_temp_k);
        assert!(r.coolant.max_velocity_m_s > 2.0 * r.coolant.inlet_velocity_m_s, "{:?}", r.coolant);
        assert!(r.coolant.property_basis.contains("NIST isobars"), "{}", r.coolant.property_basis);
    }

    #[test]
    fn cooling_produces_finite_station_data() {
        let r = solve_l3(&input()).unwrap();
        assert_eq!(r.stations.len(), 20);
        for s in &r.stations {
            assert!(s.h_gas.is_finite() && s.h_gas > 0.0, "h_gas = {}", s.h_gas);
            assert!(s.wall_temp_k > 300.0 && s.wall_temp_k < 4000.0);
        }
        assert!(r.max_wall_temp_k.is_finite());
    }

    #[test]
    fn zero_gap_is_out_of_domain() {
        let mut inp = input();
        inp.coolant_gap_m = 0.0;
        assert!(solve_l3(&inp).is_err());
    }

    #[test]
    fn higher_coolant_velocity_lowers_wall_temp() {
        // Raising coolant velocity increases h_c and reduces the wall temperature
        // (a physical check that the cooling model responds correctly).
        let slow = solve_l3(&input()).unwrap();
        let mut fast_inp = input();
        fast_inp.coolant_velocity_m_s = 12.0;
        let fast = solve_l3(&fast_inp).unwrap();
        assert!(
            fast.max_wall_temp_k < slow.max_wall_temp_k,
            "fast wall {} vs slow wall {}",
            fast.max_wall_temp_k,
            slow.max_wall_temp_k
        );
    }

    #[test]
    fn carbon_deposit_insulates_the_wall() {
        // A hot-side deposit adds series resistance: less heat reaches the metal
        // and the coolant, so heat flux and metal temperature both fall.
        let clean = solve_l3(&input()).unwrap();
        let mut sooty_inp = input();
        sooty_inp.deposit_resistance_m2k_w = 3e-5; // 0.3 cm²·K/W (TP-2862 Fig. 10 order)
        let sooty = solve_l3(&sooty_inp).unwrap();
        for (c, s) in clean.stations.iter().zip(&sooty.stations) {
            assert!(s.heat_flux_w_m2 < c.heat_flux_w_m2);
        }
        assert!(sooty.max_wall_temp_k < clean.max_wall_temp_k);
        // Zero resistance is the clean wall exactly.
        let mut zero = input();
        zero.deposit_resistance_m2k_w = 0.0;
        assert_eq!(solve_l3(&zero).unwrap().max_wall_temp_k, clean.max_wall_temp_k);
    }
}
