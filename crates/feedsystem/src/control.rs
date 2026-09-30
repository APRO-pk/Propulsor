//! Closed-loop engine control model (NASA TM-105318).
//!
//! A rocket-engine controller regulates two variables: thrust (through chamber
//! pressure Pc) and mixture ratio (MR). MR is the *fast* loop — it holds the
//! combustion temperature at the design point — and Pc is the *slow* loop, whose
//! bandwidth is set by the thrust-response requirement. Both are usually
//! Proportional-Integral (PI). This module derives the sensor/actuator suite for
//! the engine cycle, the chamber dynamics (fill time + combustion dead time),
//! and simulates the closed-loop Pc throttle step so the loop tuning is visible.

/// A control-loop specification.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LoopSpec {
    pub name: String,
    pub variable: String,
    /// "fast" (MR) or "slow" (Pc).
    pub speed: String,
    pub bandwidth_hz: f64,
    pub setpoint: f64,
    pub unit: String,
    pub actuator: String,
}

/// A commanded actuator (valve) and the loop it serves.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ControlActuator {
    pub name: String,
    /// "Pc loop" | "MR loop" | "scheduled" | "on/off".
    pub function: String,
    pub closed_loop: bool,
    pub note: String,
}

/// A redline (safety cutoff) limit.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Redline {
    pub name: String,
    pub limit: f64,
    pub unit: String,
}

/// One sample of the closed-loop step response.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StepSample {
    pub t_s: f64,
    pub setpoint: f64,
    pub response: f64,
}

/// The control-system study.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ControlStudy {
    pub architecture: String,
    pub control_law: String,
    pub sample_rate_hz: f64,
    pub pc_setpoint_bar: f64,
    pub mr_setpoint: f64,
    pub chamber_fill_time_ms: f64,
    pub combustion_delay_ms: f64,
    pub loops: Vec<LoopSpec>,
    pub sensors: Vec<String>,
    pub actuators: Vec<ControlActuator>,
    pub redlines: Vec<Redline>,
    /// Closed-loop chamber-pressure throttle step (fraction of rated Pc).
    pub pc_step: Vec<StepSample>,
    /// Settling time of the Pc step to within 2% (s).
    pub pc_settling_time_s: f64,
    /// Peak overshoot of the Pc step (percent).
    pub pc_overshoot_pct: f64,
    /// Design-rule warnings (bandwidth vs sample rate / dead time).
    pub warnings: Vec<String>,
    pub summary: String,
}

/// Control-model inputs.
#[derive(Debug, Clone)]
pub struct ControlInput {
    /// "self-pressurizing" | "pressure-fed" | "pump-fed".
    pub feed_type: String,
    pub pc_pa: f64,
    pub mr: f64,
    pub chamber_volume_m3: f64,
    pub c_star_m_s: f64,
    pub throat_area_m2: f64,
    /// Pc (slow) loop bandwidth, Hz.
    pub pc_bandwidth_hz: f64,
    /// MR (fast) loop bandwidth, Hz.
    pub mr_bandwidth_hz: f64,
    pub sample_rate_hz: f64,
    pub combustion_delay_ms: f64,
    /// Commanded throttle step target (fraction of rated Pc), e.g. 0.8.
    pub throttle_target: f64,
    /// Turbine-discharge-temperature redline (K); used only when pump-fed.
    pub turbine_redline_k: f64,
}

/// Build the control study: derive the suite, chamber dynamics, and simulate the
/// closed-loop Pc throttle step.
pub fn solve_control(input: &ControlInput) -> ControlStudy {
    let pump_fed = input.feed_type == "pump-fed";
    let staged = false; // the app's pump-fed cycle is gas-generator; staged is future
    let architecture = match input.feed_type.as_str() {
        "self-pressurizing" => "Self-pressurizing (blowdown / regulated)",
        "pump-fed" => "Gas-generator pump-fed",
        _ => "Pressure-fed",
    }
    .to_string();

    // Chamber dynamics: fill time τ = V_c / (c*·A_t); combustion dead time σ.
    let tau_fill = input.chamber_volume_m3 / (input.c_star_m_s.max(1.0) * input.throat_area_m2.max(1e-9));
    let sigma = input.combustion_delay_ms * 1e-3;

    // Loops: MR fast, Pc slow (TM-105318).
    let (pc_actuator, mr_actuator): (&str, &str) = if pump_fed {
        ("Gas-generator throttle valve", "Oxidizer valve")
    } else {
        ("Main oxidizer valve", "Main fuel valve")
    };
    let loops = vec![
        LoopSpec {
            name: "Chamber pressure (thrust)".into(),
            variable: "Pc".into(),
            speed: "slow".into(),
            bandwidth_hz: input.pc_bandwidth_hz,
            setpoint: input.pc_pa / 1e5,
            unit: "bar".into(),
            actuator: pc_actuator.into(),
        },
        LoopSpec {
            name: "Mixture ratio".into(),
            variable: "MR".into(),
            speed: "fast".into(),
            bandwidth_hz: input.mr_bandwidth_hz,
            setpoint: input.mr,
            unit: "O/F".into(),
            actuator: mr_actuator.into(),
        },
    ];

    // Actuators + sensors by cycle.
    let mut actuators: Vec<ControlActuator> = Vec::new();
    let mut sensors: Vec<String> = vec![
        "Chamber pressure (Pc)".into(),
        "Oxidizer mass flow".into(),
        "Fuel mass flow".into(),
    ];
    if pump_fed {
        actuators.push(ControlActuator { name: "Gas-generator throttle valve".into(), function: "Pc loop".into(), closed_loop: true, note: "sets turbopump speed → Pc (slow loop)".into() });
        actuators.push(ControlActuator { name: "Oxidizer valve".into(), function: "MR loop".into(), closed_loop: true, note: "trims oxidizer flow → MR (fast loop)".into() });
        actuators.push(ControlActuator { name: "Main fuel valve".into(), function: "on/off".into(), closed_loop: false, note: "full-open at mainstage".into() });
        actuators.push(ControlActuator { name: "GG oxidizer valve".into(), function: "scheduled".into(), closed_loop: false, note: "holds GG mixture ratio (turbine temperature)".into() });
        sensors.push("Turbine discharge temperature".into());
        sensors.push("Gas-generator temperature".into());
        sensors.push("Pump discharge pressures".into());
    } else {
        actuators.push(ControlActuator { name: "Main oxidizer valve (MOV)".into(), function: "Pc loop".into(), closed_loop: true, note: "throttles total flow → Pc (slow loop)".into() });
        actuators.push(ControlActuator { name: "Main fuel valve (MFV)".into(), function: "MR loop".into(), closed_loop: true, note: "trims fuel flow → MR (fast loop)".into() });
    }
    actuators.push(ControlActuator { name: "Igniter".into(), function: "on/off".into(), closed_loop: false, note: "start-sequence spark/torch".into() });

    // Redlines.
    let mut redlines = vec![Redline { name: "Chamber overpressure".into(), limit: input.pc_pa / 1e5 * 1.2, unit: "bar".into() }];
    if pump_fed {
        redlines.push(Redline { name: "Turbine discharge temperature".into(), limit: input.turbine_redline_k, unit: "K".into() });
    }

    // Closed-loop Pc throttle step: PI on a first-order+dead-time plant, IMC-tuned
    // so the closed-loop time constant matches the chosen loop bandwidth.
    let (pc_step, settling, overshoot) = simulate_pi_step(tau_fill, sigma, input.pc_bandwidth_hz, input.throttle_target, input.sample_rate_hz);

    // Guardrails: a digital loop bandwidth should stay below ~1/10 of the sample
    // rate, and below the combustion-dead-time limit ~1/(2π·5σ).
    let mut warnings: Vec<String> = Vec::new();
    let nyquist_bw = input.sample_rate_hz / 10.0;
    if input.pc_bandwidth_hz > nyquist_bw {
        warnings.push(format!(
            "Pc-loop bandwidth {:.1} Hz exceeds ~1/10 of the {:.0} Hz sample rate ({:.1} Hz) — expect overshoot; raise the sample rate or lower the bandwidth",
            input.pc_bandwidth_hz, input.sample_rate_hz, nyquist_bw
        ));
    }
    if input.mr_bandwidth_hz > nyquist_bw {
        warnings.push(format!(
            "MR-loop bandwidth {:.1} Hz exceeds ~1/10 of the {:.0} Hz sample rate ({:.1} Hz)",
            input.mr_bandwidth_hz, input.sample_rate_hz, nyquist_bw
        ));
    }
    if sigma > 0.0 {
        let deadtime_bw = 1.0 / (2.0 * std::f64::consts::PI * 5.0 * sigma);
        if input.pc_bandwidth_hz > deadtime_bw {
            warnings.push(format!(
                "Pc-loop bandwidth {:.1} Hz is above the combustion-dead-time limit ~{:.1} Hz (σ={:.1} ms)",
                input.pc_bandwidth_hz, deadtime_bw, input.combustion_delay_ms
            ));
        }
    }

    let control_law = if staged { "PI (multivariable capable)" } else { "PI (proportional-integral)" }.to_string();
    let summary = format!(
        "{} | {} @ {:.0} Hz | Pc setpt {:.1} bar, MR {:.2} | τ_fill={:.1} ms, σ={:.1} ms | Pc settle {:.2} s, overshoot {:.1}%",
        architecture, control_law, input.sample_rate_hz, input.pc_pa / 1e5, input.mr,
        tau_fill * 1e3, input.combustion_delay_ms, settling, overshoot
    );

    ControlStudy {
        architecture,
        control_law,
        sample_rate_hz: input.sample_rate_hz,
        pc_setpoint_bar: input.pc_pa / 1e5,
        mr_setpoint: input.mr,
        chamber_fill_time_ms: tau_fill * 1e3,
        combustion_delay_ms: input.combustion_delay_ms,
        loops,
        sensors,
        actuators,
        redlines,
        pc_step,
        pc_settling_time_s: settling,
        pc_overshoot_pct: overshoot,
        warnings,
        summary,
    }
}

/// Simulate a digital PI controller on the plant G(s) = e^{-σs}/(τ s + 1) doing a
/// Pc setpoint step from 1.0 to `target`. The plant is integrated on a fine step
/// while the controller updates at the sample rate (zero-order hold). Returns the
/// trace plus 2%-settling time and overshoot (percent of the commanded step).
fn simulate_pi_step(tau: f64, sigma: f64, bandwidth_hz: f64, target: f64, sample_hz: f64) -> (Vec<StepSample>, f64, f64) {
    let tau = tau.max(1e-4);
    let sigma = sigma.max(0.0);
    // IMC tuning: closed-loop time constant from the loop bandwidth.
    let tau_cl = (1.0 / (2.0 * std::f64::consts::PI * bandwidth_hz.max(0.05))).max(sigma + 1e-3);
    let kp = tau / (tau_cl + sigma);
    let ki = 1.0 / (tau_cl + sigma);

    // Fine plant integration step (explicit Euler needs dt ≪ τ), separate from the
    // controller sample interval.
    let dt = (tau / 20.0).clamp(1e-5, 5e-4);
    let ts = (1.0 / sample_hz.max(1.0)).max(dt);
    let t_end = (10.0 * tau_cl + sigma).clamp(0.4, 30.0);
    let n = (t_end / dt) as usize;
    let delay_steps = (sigma / dt).round() as usize;

    let mut pc = 1.0_f64; // start at rated
    let mut integ = 0.0_f64;
    let mut u = 1.0_f64; // commanded flow fraction (held between controller ticks)
    let mut hist: Vec<f64> = Vec::with_capacity(n + 1);
    let mut out: Vec<StepSample> = Vec::new();
    let mut settling = t_end;
    let mut peak_beyond = 0.0_f64;
    let step_span = (1.0 - target).abs().max(1e-6);
    let dir = (target - 1.0).signum();
    let record_every = (n / 240).max(1);
    let mut next_ctrl_t = 0.05_f64; // command step at t = 50 ms

    for i in 0..=n {
        let t = i as f64 * dt;
        let setpoint = if t < 0.05 { 1.0 } else { target };
        // Measurement is the plant output delayed by the combustion dead time.
        let measured = if i >= delay_steps { hist[i - delay_steps] } else { 1.0 };
        // Digital controller: update the held command at the sample interval.
        if t >= next_ctrl_t {
            let err = setpoint - measured;
            integ += err * ts;
            u = (1.0 + kp * err + ki * integ).clamp(0.0, 1.5);
            next_ctrl_t += ts;
        }
        // First-order plant: dPc/dt = (u - Pc)/τ.
        pc += (u - pc) / tau * dt;
        hist.push(pc);

        let beyond = (measured - target) * dir; // >0 when past the target
        if beyond > peak_beyond {
            peak_beyond = beyond;
        }
        if t > 0.05 && (measured - target).abs() > 0.02 * step_span {
            settling = t - 0.05;
        }
        if i % record_every == 0 {
            out.push(StepSample { t_s: t, setpoint, response: measured });
        }
    }
    let overshoot = (peak_beyond / step_span) * 100.0;
    (out, settling, overshoot)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> ControlInput {
        ControlInput {
            feed_type: "pressure-fed".into(),
            pc_pa: 2.0e6,
            mr: 2.4,
            chamber_volume_m3: 2.0e-3,
            c_star_m_s: 1700.0,
            throat_area_m2: 1.7e-3,
            pc_bandwidth_hz: 5.0,
            mr_bandwidth_hz: 20.0,
            sample_rate_hz: 50.0,
            combustion_delay_ms: 1.5,
            throttle_target: 0.8,
            turbine_redline_k: 1100.0,
        }
    }

    #[test]
    fn pressure_fed_has_two_closed_loops() {
        let s = solve_control(&base());
        assert_eq!(s.loops.len(), 2);
        let closed: Vec<_> = s.actuators.iter().filter(|a| a.closed_loop).collect();
        assert_eq!(closed.len(), 2, "pressure-fed: MOV + MFV closed loops");
        assert!(s.chamber_fill_time_ms > 0.0);
        assert!(s.pc_step.len() > 10);
    }

    #[test]
    fn pump_fed_adds_turbine_redline_and_gg_valve() {
        let s = solve_control(&ControlInput { feed_type: "pump-fed".into(), ..base() });
        assert!(s.redlines.iter().any(|r| r.name.contains("Turbine")));
        assert!(s.actuators.iter().any(|a| a.name.contains("Gas-generator")));
        assert!(s.sensors.iter().any(|x| x.contains("Turbine discharge")));
    }

    #[test]
    fn step_response_reaches_target() {
        let s = solve_control(&base());
        let last = s.pc_step.last().unwrap();
        assert!((last.response - 0.8).abs() < 0.03, "Pc settled at {}", last.response);
        assert!(s.pc_settling_time_s > 0.0);
    }

    #[test]
    fn faster_bandwidth_settles_sooner() {
        let slow = solve_control(&ControlInput { pc_bandwidth_hz: 2.0, ..base() });
        let fast = solve_control(&ControlInput { pc_bandwidth_hz: 10.0, ..base() });
        assert!(fast.pc_settling_time_s < slow.pc_settling_time_s, "fast {} vs slow {}", fast.pc_settling_time_s, slow.pc_settling_time_s);
    }
}
