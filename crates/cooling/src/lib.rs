//! Regenerative cooling solver (L3).
//!
//! 1D axial mesh over the L2 nozzle contour. At each station:
//!   - Gas-side: **Bartz** convective heat-transfer coefficient.
//!   - Coolant-side: **Gnielinski** (turbulent) with a Dittus–Boelter fallback.
//!   - Wall: conduction through the chamber/nozzle wall.
//!   - Boiling margin vs the coolant saturation temperature.
//!
//! All inputs are canonical SI. The gas properties (γ, Tc, Pc, c*, MW) come from
//! L1; the contour `r(x)` from L2; the wall material and coolant gap from L0.

use engine_core::{ContourPoint, EngineError};
use gasdynamics::quasi1d::{mach_from_area, pressure_ratio, temperature_ratio};

pub mod ablative;
pub mod film;
pub mod materials;
pub mod printing;
pub mod radiation;

pub const RU: f64 = 8.314462618;

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
    /// Coolant gap (annular channel), m — the fallback when no discrete channels.
    pub coolant_gap_m: f64,
    /// Coolant bulk velocity, m/s.
    pub coolant_velocity_m_s: f64,
    /// Number of discrete milled/printed cooling channels (0 = annular gap model).
    pub channel_count: f64,
    /// Rectangular channel width, m (used when `channel_count` > 0).
    pub channel_width_m: f64,
    /// Rectangular channel height/depth, m (used when `channel_count` > 0).
    pub channel_height_m: f64,
    /// Coolant inlet pressure, Pa.
    pub coolant_pressure_pa: f64,
    /// Optional wall film cooling injected at a given axial station.
    pub film_cooling: Option<FilmCoolingConfig>,
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
    pub boiling_margin_k: f64,
    pub h_gas: f64,
    /// Wall heat flux at this station, W/m².
    #[serde(default)]
    pub heat_flux_w_m2: f64,
    /// Film-cooling effectiveness at this station (0 if no film).
    #[serde(default)]
    pub film_effectiveness: f64,
}

/// L3 result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CoolingResult {
    pub stations: Vec<CoolingStation>,
    pub max_wall_temp_k: f64,
    pub min_boiling_margin_k: f64,
    pub coolant_dp_pa: f64,
    pub wall_material_limit_k: f64,
}

impl CoolingResult {
    pub fn summary(&self) -> String {
        format!(
            "T_wall,max={:.0} K (limit {:.0}) | boil_margin,min={:.0} K | coolant_dP={:.0} kPa",
            self.max_wall_temp_k,
            self.wall_material_limit_k,
            self.min_boiling_margin_k,
            self.coolant_dp_pa / 1000.0,
        )
    }

    /// Per-station heat-flux and wall-temperature table as CSV, for import as a
    /// thermal boundary condition into an FEM solver.
    pub fn heat_flux_csv(&self) -> String {
        let mut s = String::from(
            "x_m,r_m,heat_flux_w_m2,h_gas_w_m2_k,gas_temp_k,wall_temp_k,coolant_temp_k\n",
        );
        for st in &self.stations {
            s.push_str(&format!(
                "{:.6},{:.6},{:.3},{:.3},{:.2},{:.2},{:.2}\n",
                st.x, st.r, st.heat_flux_w_m2, st.h_gas, st.gas_temp_k, st.wall_temp_k, st.coolant_temp_k,
            ));
        }
        s
    }
}

/// Solve the regenerative cooling model along the nozzle contour.
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
    let wall_limit = input.wall_material.max_service_temp_k;

    // Coolant: water by default. Its bulk temperature is *marched* along the
    // circuit (not pinned at a constant), so it enters cool and heats realistically.
    let coolant_rho = 1000.0;
    let coolant_k = 0.6;
    let coolant_mu = 0.001;
    let coolant_cp = 4186.0;
    let coolant_inlet_k = 300.0;

    // Coolant-side geometry: discrete rectangular channels when specified, else the
    // annular gap at the throat. Hydraulic diameter and total flow area set the
    // Reynolds number, coolant-side coefficient and coolant mass flow.
    let (d_h, channel_area) = if input.channel_count > 0.0 && input.channel_width_m > 0.0 && input.channel_height_m > 0.0 {
        let w = input.channel_width_m;
        let h = input.channel_height_m;
        (2.0 * w * h / (w + h), input.channel_count * w * h)
    } else {
        (2.0 * input.coolant_gap_m, std::f64::consts::PI * (2.0 * r_t) * input.coolant_gap_m)
    };
    let m_dot_cool = (coolant_rho * input.coolant_velocity_m_s * channel_area).max(1e-4);
    let re_cool = coolant_rho * input.coolant_velocity_m_s * d_h / coolant_mu;
    let h_cool = gnielinski(re_cool, 7.0, d_h, coolant_k, coolant_mu, coolant_rho);
    let t_sat = water_saturation(input.coolant_pressure_pa);

    // Per-station gas-side properties (static gas temperature, the temperature the
    // wall actually sees after any film, and the Bartz coefficient).
    struct GasSide {
        t_gas: f64,
        t_drive: f64,
        h_gas: f64,
        film_eff: f64,
    }
    let gas: Vec<GasSide> = input
        .stations
        .iter()
        .map(|pt| {
            let ar = area_ratio_at(pt.r);
            let m = mach_from_area(ar.max(1.0), input.gamma);
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
                h_gas = bartz(input.gamma, input.pc_pa, input.c_star_m_s, r_t, ar, t_drive, rho_gas, velocity_gas, cp_gas, pr_gas, mu_gas, t_wall);
                let u = 1.0 / (1.0 / h_gas + input.wall_thickness_m / wall_k + 1.0 / h_cool);
                let q = u * (t_drive - coolant_inlet_k);
                t_wall = (t_drive - q / h_gas).max(300.0);
            }
            GasSide { t_gas, t_drive, h_gas, film_eff }
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

    // March the coolant from the nozzle exit (coolest gas) toward the throat/injector
    // — counterflow — accumulating the wall heat it absorbs: dT = q·dA/(ṁ·cp).
    let mut march: Vec<usize> = (0..n).collect();
    march.sort_by(|&a, &b| input.stations[b].x.partial_cmp(&input.stations[a].x).unwrap_or(std::cmp::Ordering::Equal));
    let mut coolant_bulk = vec![coolant_inlet_k; n];
    let mut t_bulk = coolant_inlet_k;
    for &i in &march {
        coolant_bulk[i] = t_bulk;
        let g = &gas[i];
        let u = 1.0 / (1.0 / g.h_gas + input.wall_thickness_m / wall_k + 1.0 / h_cool);
        let q = (u * (g.t_drive - t_bulk)).max(0.0);
        let d_area = 2.0 * std::f64::consts::PI * input.stations[i].r.max(1e-4) * dx[i];
        t_bulk += q * d_area / (m_dot_cool * coolant_cp);
    }

    // Build the station results in contour order, using the marched coolant temps.
    let mut stations = Vec::with_capacity(n);
    let mut max_wall = f64::NEG_INFINITY;
    let mut min_boil = f64::INFINITY;
    for i in 0..n {
        let pt = &input.stations[i];
        let g = &gas[i];
        let t_bulk = coolant_bulk[i];
        let u = 1.0 / (1.0 / g.h_gas + input.wall_thickness_m / wall_k + 1.0 / h_cool);
        let q_w = (u * (g.t_drive - t_bulk)).max(0.0);
        let t_wall = g.t_drive - q_w / g.h_gas;
        // Coolant-side wall-film temperature is the limiting one for boiling.
        let t_cool_wall = t_bulk + q_w / h_cool;
        let boil_margin = t_sat - t_cool_wall;
        max_wall = max_wall.max(t_wall);
        min_boil = min_boil.min(boil_margin);
        stations.push(CoolingStation {
            x: pt.x,
            r: pt.r,
            gas_temp_k: g.t_gas,
            wall_temp_k: t_wall,
            wall_limit_k: wall_limit,
            coolant_temp_k: t_bulk,
            coolant_pressure_pa: input.coolant_pressure_pa,
            coolant_velocity_m_s: input.coolant_velocity_m_s,
            boiling_margin_k: boil_margin,
            h_gas: g.h_gas,
            heat_flux_w_m2: q_w,
            film_effectiveness: g.film_eff,
        });
    }

    // Coolant pressure drop: Blasius turbulent friction over the circuit length.
    let length = {
        let xmax = input.stations.iter().map(|s| s.x).fold(f64::NEG_INFINITY, f64::max);
        let xmin = input.stations.iter().map(|s| s.x).fold(f64::INFINITY, f64::min);
        (xmax - xmin).abs().max(d_h)
    };
    let f_darcy = 0.316 / re_cool.max(1.0).powf(0.25);
    let coolant_dp = f_darcy * (length / d_h) * 0.5 * coolant_rho * input.coolant_velocity_m_s.powi(2);

    Ok(CoolingResult {
        stations,
        max_wall_temp_k: max_wall,
        min_boiling_margin_k: min_boil,
        coolant_dp_pa: coolant_dp,
        wall_material_limit_k: wall_limit,
    })
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
    t_gas: f64,
    _rho_gas: f64,
    _vel_gas: f64,
    cp_gas: f64,
    pr_gas: f64,
    mu: f64,
    t_wall: f64,
) -> f64 {
    let d_t = 2.0 * r_t;
    let r_c = 1.5 * r_t; // throat radius of curvature
    let sigma = {
        let m = mach_from_area(area_ratio.max(1.0), gamma);
        let tw_tg = (t_wall / t_gas).clamp(0.05, 0.95);
        (0.5 * tw_tg * (1.0 + (gamma - 1.0) / 2.0 * m * m) + 0.5).powf(-0.68)
    };
    let term = 0.026 / d_t.powf(0.2) * (mu.powf(0.2) * cp_gas / pr_gas.powf(0.6));
    term * (pc / c_star).powf(0.8) * (d_t / r_c).powf(0.1) * area_ratio.powf(-0.9) * sigma
}

/// Gnielinski turbulent correlation (W/(m²·K)); Dittus–Boelter fallback below Re 3000.
fn gnielinski(re: f64, pr: f64, d_h: f64, k: f64, mu: f64, rho: f64) -> f64 {
    if re < 3000.0 {
        // Laminar/transitional → Dittus-Boelter.
        let nu = 0.023 * re.powf(0.8) * pr.powf(0.4);
        return nu * k / d_h;
    }
    let f = (0.790 * re.ln() - 1.64).powi(-2);
    let nu = ((f / 8.0) * (re - 1000.0) * pr) / (1.0 + 12.7 * (f / 8.0).sqrt() * (pr.powf(2.0 / 3.0) - 1.0));
    let _ = (mu, rho);
    nu * k / d_h
}

/// Water saturation temperature (K) at a pressure via a simple Antoine fit.
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
            channel_count: 0.0,
            channel_width_m: 0.0,
            channel_height_m: 0.0,
            coolant_pressure_pa: 3.0e5,
            film_cooling: None,
        }
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
}
