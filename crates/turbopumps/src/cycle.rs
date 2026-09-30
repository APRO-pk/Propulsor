//! Power-cycle models: gas-generator (open) and staged-combustion (closed),
//! plus a shared preburner combustion model.
//!
//! Both cycles close the pump↔turbine power balance by solving for the fraction
//! of propellant routed through the turbine-drive combustor, rather than assuming
//! a fixed turbine flow. The gas-generator cycle dumps the turbine exhaust
//! overboard; the staged-combustion cycle routes it into the main chamber, so its
//! preburner runs the full flow of one propellant and a smaller split of the other.

/// Preburner / gas-generator combustor input.
#[derive(Debug, Clone)]
pub struct PreburnerInput {
    pub ox_flow_kg_s: f64,
    pub fuel_flow_kg_s: f64,
    pub pressure_pa: f64,
    /// Stoichiometric oxidizer/fuel mass ratio of the pair.
    pub stoich_of: f64,
    /// Adiabatic flame temperature at stoichiometric, K.
    pub stoich_temp_k: f64,
    /// Reactant inlet (unburned) temperature, K.
    pub inlet_temp_k: f64,
    /// Product gas cp, J/(kg·K).
    pub cp_j_kg_k: f64,
    /// Product gas specific-heat ratio.
    pub gamma: f64,
}

/// Preburner result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PreburnerResult {
    pub mixture_ratio: f64,
    pub gas_temp_k: f64,
    pub total_flow_kg_s: f64,
    pub ox_rich: bool,
}

impl PreburnerResult {
    pub fn summary(&self) -> String {
        format!(
            "MR={:.1} ({}) | T={:.0} K | ṁ={:.2} kg/s",
            self.mixture_ratio,
            if self.ox_rich { "ox-rich" } else { "fuel-rich" },
            self.gas_temp_k,
            self.total_flow_kg_s,
        )
    }
}

/// Off-stoichiometric flame temperature. Peaks at the stoichiometric ratio and
/// falls off as excess reactant dilutes the products and absorbs heat.
///
/// - Oxidizer-rich (`mr ≥ stoich_of`): fuel is limiting, so heat release is fixed
///   and spread over `1 + mr` of products: `T = T0 + ΔT·(1+stoich)/(1+mr)`.
/// - Fuel-rich (`mr < stoich_of`): oxidizer is limiting; heat release scales with
///   burned oxidizer per unit product mass, `mr/(1+mr)`, normalized at stoich.
pub fn preburner_temp(mr: f64, stoich_of: f64, stoich_temp_k: f64, inlet_temp_k: f64) -> f64 {
    let dt = (stoich_temp_k - inlet_temp_k).max(0.0);
    if mr >= stoich_of {
        inlet_temp_k + dt * (1.0 + stoich_of) / (1.0 + mr)
    } else {
        let f_actual = mr / (1.0 + mr);
        let f_stoich = stoich_of / (1.0 + stoich_of);
        inlet_temp_k + dt * (f_actual / f_stoich.max(1e-9))
    }
}

/// Solve a preburner: mixture ratio, product temperature, total flow.
pub fn solve_preburner(input: &PreburnerInput) -> PreburnerResult {
    let mr = input.ox_flow_kg_s / input.fuel_flow_kg_s.max(1e-12);
    let t = preburner_temp(mr, input.stoich_of, input.stoich_temp_k, input.inlet_temp_k);
    PreburnerResult {
        mixture_ratio: mr,
        gas_temp_k: t,
        total_flow_kg_s: input.ox_flow_kg_s + input.fuel_flow_kg_s,
        ox_rich: mr >= input.stoich_of,
    }
}

/// Turbine specific work per kg of drive gas (J/kg).
fn turbine_specific_work(cp: f64, t_in: f64, pr: f64, gamma: f64, eta: f64) -> f64 {
    let pr = pr.max(1.0);
    let temp_ratio = pr.powf(-(gamma - 1.0) / gamma);
    cp * t_in * (1.0 - temp_ratio) * eta
}

// ---------------------------------------------------------------------------
// Gas-generator (open) cycle
// ---------------------------------------------------------------------------

/// Gas-generator cycle input. The GG burns a fraction `f` of the total flow; the
/// resulting hot gas drives the turbine, which must power the pump.
#[derive(Debug, Clone)]
pub struct GgCycleInput {
    pub total_flow_kg_s: f64,
    pub chamber_pressure_pa: f64,
    pub tank_pressure_pa: f64,
    pub propellant_density_kg_m3: f64,
    pub pump_efficiency: f64,
    pub gg_pressure_pa: f64,
    pub gg_temp_k: f64,
    pub gg_gamma: f64,
    pub gg_cp_j_kg_k: f64,
    pub turbine_exit_pressure_pa: f64,
    pub turbine_efficiency: f64,
    pub speed_rpm: f64,
}

/// Gas-generator cycle result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GgCycleResult {
    pub gg_flow_fraction: f64,
    pub gg_flow_kg_s: f64,
    pub chamber_flow_kg_s: f64,
    pub pump_power_w: f64,
    pub turbine_power_w: f64,
    pub margin: f64,
}

impl GgCycleResult {
    pub fn summary(&self) -> String {
        format!(
            "GG fraction={:.3} | GG flow={:.2} kg/s | chamber flow={:.2} kg/s | P_turb/P_pump={:.2}",
            self.gg_flow_fraction,
            self.gg_flow_kg_s,
            self.chamber_flow_kg_s,
            self.margin,
        )
    }
}

/// Close the gas-generator power balance: find the GG flow fraction `f` such that
/// the turbine (driven by the GG gas) produces exactly the pump power.
pub fn solve_gg_cycle(input: &GgCycleInput) -> GgCycleResult {
    let dp = (input.chamber_pressure_pa - input.tank_pressure_pa).max(0.0);
    // Pump work per kg of propellant.
    let pump_work = dp / input.propellant_density_kg_m3 / input.pump_efficiency.max(0.01);
    // Turbine specific work per kg of GG gas.
    let pr = input.gg_pressure_pa / input.turbine_exit_pressure_pa;
    let turb_work = turbine_specific_work(
        input.gg_cp_j_kg_k,
        input.gg_temp_k,
        pr,
        input.gg_gamma,
        input.turbine_efficiency,
    );

    // f = pump_work / turb_work (per kg of total flow).
    let f = (pump_work / turb_work.max(1e-9)).clamp(0.0, 0.5);
    let gg_flow = f * input.total_flow_kg_s;
    let chamber_flow = input.total_flow_kg_s - gg_flow;
    let pump_power = input.total_flow_kg_s * pump_work;
    let turbine_power = gg_flow * turb_work;

    GgCycleResult {
        gg_flow_fraction: f,
        gg_flow_kg_s: gg_flow,
        chamber_flow_kg_s: chamber_flow,
        pump_power_w: pump_power,
        turbine_power_w: turbine_power,
        margin: turbine_power / pump_power.max(1e-9),
    }
}

// ---------------------------------------------------------------------------
// Staged-combustion (closed) cycle
// ---------------------------------------------------------------------------

/// Staged-combustion cycle input.
///
/// One propellant passes entirely through the preburner and turbine before
/// entering the main chamber; the other is split, with a minority flow burned in
/// the preburner (to set the drive-gas temperature) and the balance injected
/// directly. The solver finds the split that closes the pump↔turbine balance,
/// subject to a turbine-inlet temperature ceiling.
#[derive(Debug, Clone)]
pub struct ScCycleInput {
    pub total_flow_kg_s: f64,
    /// Overall (chamber) oxidizer/fuel mass ratio.
    pub mixture_ratio: f64,
    pub chamber_pressure_pa: f64,
    pub tank_ox_pressure_pa: f64,
    pub tank_fuel_pressure_pa: f64,
    pub ox_density_kg_m3: f64,
    pub fuel_density_kg_m3: f64,
    pub ox_pump_efficiency: f64,
    pub fuel_pump_efficiency: f64,
    /// Preburner (and pump-discharge) pressure, Pa. Above chamber pressure.
    pub preburner_pressure_pa: f64,
    /// If true the preburner (and turbine) runs oxidizer-rich; else fuel-rich.
    pub ox_rich_preburner: bool,
    pub turbine_efficiency: f64,
    /// Turbine back-pressure, Pa (≈ chamber pressure, since exhaust feeds the chamber).
    pub turbine_exit_pressure_pa: f64,
    /// Turbine-inlet (preburner product) temperature ceiling, K.
    pub max_turbine_inlet_temp_k: f64,
    // Preburner combustion reference data:
    pub stoich_of: f64,
    pub stoich_temp_k: f64,
    pub reactant_inlet_temp_k: f64,
    pub preburner_cp_j_kg_k: f64,
    pub preburner_gamma: f64,
    pub speed_rpm: f64,
}

/// Staged-combustion cycle result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScCycleResult {
    pub ox_flow_kg_s: f64,
    pub fuel_flow_kg_s: f64,
    /// Minority reactant flow routed to the preburner, kg/s.
    pub preburner_split_flow_kg_s: f64,
    pub preburner_flow_kg_s: f64,
    pub preburner_mixture_ratio: f64,
    pub turbine_inlet_temp_k: f64,
    pub ox_pump_power_w: f64,
    pub fuel_pump_power_w: f64,
    pub total_pump_power_w: f64,
    pub turbine_power_w: f64,
    pub margin: f64,
    /// True when the balance closed within the temperature ceiling.
    pub balanced: bool,
    /// True when the required turbine-inlet temperature hit the ceiling.
    pub temperature_limited: bool,
}

impl ScCycleResult {
    pub fn summary(&self) -> String {
        format!(
            "PB split={:.2} kg/s | PB MR={:.1} | T_turb={:.0} K | P_turb/P_pump={:.2} | {}",
            self.preburner_split_flow_kg_s,
            self.preburner_mixture_ratio,
            self.turbine_inlet_temp_k,
            self.margin,
            if self.balanced {
                "balanced"
            } else if self.temperature_limited {
                "temp-limited (raise P_pb / lower Pc)"
            } else {
                "unbalanced"
            },
        )
    }
}

/// Solve the staged-combustion cycle: find the preburner split that closes the
/// pump↔turbine power balance, subject to the turbine-inlet temperature ceiling.
pub fn solve_sc_cycle(input: &ScCycleInput) -> ScCycleResult {
    let mr = input.mixture_ratio.max(1e-6);
    let ox_flow = input.total_flow_kg_s * mr / (1.0 + mr);
    let fuel_flow = input.total_flow_kg_s / (1.0 + mr);

    // Both pumps discharge to the preburner pressure (the higher requirement).
    let dp_ox = (input.preburner_pressure_pa - input.tank_ox_pressure_pa).max(0.0);
    let dp_fuel = (input.preburner_pressure_pa - input.tank_fuel_pressure_pa).max(0.0);
    let ox_pump = ox_flow * dp_ox / (input.ox_density_kg_m3 * input.ox_pump_efficiency.max(0.01));
    let fuel_pump =
        fuel_flow * dp_fuel / (input.fuel_density_kg_m3 * input.fuel_pump_efficiency.max(0.01));
    let pump_power = ox_pump + fuel_pump;

    let pr = input.preburner_pressure_pa / input.turbine_exit_pressure_pa;

    // Majority reactant runs fully through the preburner/turbine; the minority is
    // the split we solve for.
    let (majority, minority_total) = if input.ox_rich_preburner {
        (ox_flow, fuel_flow)
    } else {
        (fuel_flow, ox_flow)
    };

    // Turbine power delivered for a given minority split, and the preburner state.
    let evaluate = |split: f64| -> (f64, f64, f64) {
        let mr_pb = if input.ox_rich_preburner {
            ox_flow / split.max(1e-9)
        } else {
            split / fuel_flow.max(1e-9)
        };
        let mut t_pb =
            preburner_temp(mr_pb, input.stoich_of, input.stoich_temp_k, input.reactant_inlet_temp_k);
        t_pb = t_pb.min(input.max_turbine_inlet_temp_k);
        let w = turbine_specific_work(
            input.preburner_cp_j_kg_k,
            t_pb,
            pr,
            input.preburner_gamma,
            input.turbine_efficiency,
        );
        let turb_power = (majority + split) * w;
        (turb_power, t_pb, mr_pb)
    };

    // Turbine power rises monotonically with the split (more flow, hotter gas),
    // so bisection on the residual closes the balance.
    let lo = minority_total * 1e-4;
    let hi = minority_total; // at most all of the minority reactant burns in the preburner
    let (p_lo, _, _) = evaluate(lo);
    let (p_hi, _, _) = evaluate(hi);

    let (split, balanced) = if p_hi < pump_power {
        // Even routing all the minority reactant through the preburner cannot
        // close the balance — cycle is under-powered at this pressure.
        (hi, false)
    } else if p_lo > pump_power {
        // Even a trace of preburner flow overshoots — balanced at the low end.
        (lo, true)
    } else {
        let mut a = lo;
        let mut b = hi;
        for _ in 0..80 {
            let m = 0.5 * (a + b);
            let (pm, _, _) = evaluate(m);
            if pm > pump_power {
                b = m;
            } else {
                a = m;
            }
        }
        (0.5 * (a + b), true)
    };

    let (turb_power, t_turb, mr_pb) = evaluate(split);
    // Flag if the balance is riding the temperature ceiling.
    let t_uncapped =
        preburner_temp(mr_pb, input.stoich_of, input.stoich_temp_k, input.reactant_inlet_temp_k);
    let temperature_limited = t_uncapped > input.max_turbine_inlet_temp_k + 1.0;

    ScCycleResult {
        ox_flow_kg_s: ox_flow,
        fuel_flow_kg_s: fuel_flow,
        preburner_split_flow_kg_s: split,
        preburner_flow_kg_s: majority + split,
        preburner_mixture_ratio: mr_pb,
        turbine_inlet_temp_k: t_turb,
        ox_pump_power_w: ox_pump,
        fuel_pump_power_w: fuel_pump,
        total_pump_power_w: pump_power,
        turbine_power_w: turb_power,
        margin: turb_power / pump_power.max(1e-9),
        balanced,
        temperature_limited,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preburner_temp_peaks_at_stoich() {
        let stoich = 2.5;
        let t_stoich = preburner_temp(stoich, stoich, 3600.0, 300.0);
        let t_ox_rich = preburner_temp(20.0, stoich, 3600.0, 300.0);
        let t_fuel_rich = preburner_temp(0.5, stoich, 3600.0, 300.0);
        assert!((t_stoich - 3600.0).abs() < 1.0);
        assert!(t_ox_rich < t_stoich && t_ox_rich > 300.0);
        assert!(t_fuel_rich < t_stoich && t_fuel_rich > 300.0);
    }

    #[test]
    fn preburner_solves_mr_and_temp() {
        let r = solve_preburner(&PreburnerInput {
            ox_flow_kg_s: 180.0,
            fuel_flow_kg_s: 3.0,
            pressure_pa: 5.0e7,
            stoich_of: 2.7,
            stoich_temp_k: 3600.0,
            inlet_temp_k: 300.0,
            cp_j_kg_k: 2100.0,
            gamma: 1.2,
        });
        assert!(r.ox_rich);
        assert!(r.gas_temp_k < 3600.0 && r.gas_temp_k > 300.0);
        assert!((r.mixture_ratio - 60.0).abs() < 1e-6);
    }

    #[test]
    fn gg_cycle_closes_balance() {
        let r = solve_gg_cycle(&GgCycleInput {
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
        assert!((0.0..0.5).contains(&r.gg_flow_fraction), "f = {}", r.gg_flow_fraction);
        assert!((r.margin - 1.0).abs() < 1e-6, "margin = {}", r.margin);
        assert!(r.gg_flow_kg_s > 0.0);
    }

    fn sc_input() -> ScCycleInput {
        // Ox-rich staged combustion, LOX/RP-1 class (RD-180-like).
        ScCycleInput {
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
        }
    }

    #[test]
    fn sc_cycle_closes_and_is_ox_rich() {
        let r = solve_sc_cycle(&sc_input());
        assert!(r.balanced, "cycle should close: {}", r.summary());
        assert!((r.margin - 1.0).abs() < 1e-3, "margin = {}", r.margin);
        // Ox-rich preburner MR must exceed the stoichiometric ratio.
        assert!(r.preburner_mixture_ratio > 3.4, "PB MR = {}", r.preburner_mixture_ratio);
        assert!(r.turbine_inlet_temp_k <= 850.0 + 1e-6);
        assert!(r.preburner_split_flow_kg_s > 0.0 && r.preburner_split_flow_kg_s < r.fuel_flow_kg_s);
    }

    #[test]
    fn sc_cycle_flags_underpowered_low_pressure() {
        let mut inp = sc_input();
        // Collapse the turbine pressure ratio so it cannot make enough power.
        inp.preburner_pressure_pa = 2.55e7;
        inp.turbine_exit_pressure_pa = 2.5e7;
        let r = solve_sc_cycle(&inp);
        assert!(!r.balanced, "cycle should not close: {}", r.summary());
        assert!(r.margin < 1.0);
    }
}
