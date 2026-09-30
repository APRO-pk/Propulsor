//! Avionics electrical harness and power budget.
//!
//! Turns the feed architecture into a concrete electrical bill of materials: the
//! command/sensor channels a flight computer must drive (main and vent valves,
//! the igniter exciter, pressure transducers and thermocouples, plus pump
//! controllers on a pump-fed engine), the wire gauge each needs, and the battery
//! and harness mass that follow from the current draw and burn time.

/// One wired channel between the avionics and a component.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HarnessChannel {
    pub name: String,
    /// "valve" | "igniter" | "sensor" | "pump" | "pressurant".
    pub kind: String,
    /// "power" | "pwm" | "digital" | "analog" | "highvoltage".
    pub signal: String,
    pub voltage_v: f64,
    /// Peak current the channel draws, A.
    pub current_a: f64,
    pub wire_awg: u32,
    pub connector: String,
    /// Whether the run is held on continuously through the burn (vs pulsed).
    pub continuous: bool,
    pub note: String,
}

/// The complete avionics harness and power budget.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AvionicsHarness {
    pub channels: Vec<HarnessChannel>,
    pub bus_voltage_v: f64,
    /// Worst-case simultaneous current (ignition: valves + exciter), A.
    pub peak_current_a: f64,
    /// Steady current held through the burn (held valves + sensors), A.
    pub continuous_current_a: f64,
    pub battery_capacity_wh: f64,
    pub battery_mass_kg: f64,
    pub harness_mass_kg: f64,
    pub total_wire_length_m: f64,
    pub channel_count: u32,
    pub summary: String,
}

/// Inputs for the harness build.
#[derive(Debug, Clone)]
pub struct AvionicsInput {
    /// "self-pressurizing" | "pressure-fed" | "pump-fed".
    pub feed_type: String,
    pub burn_time_s: f64,
    pub has_pressurant: bool,
    /// Characteristic run length for a wire (avionics bay → component), m.
    pub run_length_m: f64,
    /// DC bus voltage (V).
    pub bus_voltage_v: f64,
    /// Battery sizing reserve factor over the mission energy (e.g. 2.0).
    pub battery_reserve_factor: f64,
    /// Battery specific energy (Wh/kg), e.g. ~150 for Li-ion.
    pub battery_energy_density_wh_kg: f64,
    /// Flight-computer + telemetry housekeeping current (A).
    pub housekeeping_current_a: f64,
    /// Main-valve actuator current (A).
    pub main_valve_current_a: f64,
    /// Igniter-exciter peak current (A).
    pub igniter_current_a: f64,
    /// Dual-redundant avionics (redundant flight computer + main valves + Pc sensor).
    pub dual_redundant: bool,
}

impl Default for AvionicsInput {
    fn default() -> Self {
        AvionicsInput {
            feed_type: "pressure-fed".into(),
            burn_time_s: 30.0,
            has_pressurant: true,
            run_length_m: 1.2,
            bus_voltage_v: 28.0,
            battery_reserve_factor: 2.0,
            battery_energy_density_wh_kg: 150.0,
            housekeeping_current_a: 0.5,
            main_valve_current_a: 3.0,
            igniter_current_a: 5.0,
            dual_redundant: false,
        }
    }
}

/// Copper wire mass per metre (g/m, insulated) for a gauge.
fn awg_mass_g_per_m(awg: u32) -> f64 {
    match awg {
        16 => 12.0,
        18 => 8.0,
        20 => 5.2,
        22 => 3.4,
        _ => 2.0, // 24 AWG signal wire
    }
}

/// Continuous current rating (A) for a gauge in a bundled harness.
fn awg_current_rating(awg: u32) -> f64 {
    match awg {
        16 => 13.0,
        18 => 10.0,
        20 => 7.5,
        22 => 5.0,
        _ => 3.5,
    }
}

/// Pick the smallest (highest-number) gauge whose rating covers the current with
/// margin.
fn gauge_for(current_a: f64) -> u32 {
    for awg in [24u32, 22, 20, 18, 16] {
        if awg_current_rating(awg) >= current_a * 1.5 {
            return awg;
        }
    }
    16
}

/// Build the avionics harness and power budget from the feed architecture.
pub fn build_harness(input: &AvionicsInput) -> AvionicsHarness {
    let bus = input.bus_voltage_v.max(5.0);
    let mv = input.main_valve_current_a.max(0.1);
    let pump_fed = input.feed_type == "pump-fed";
    let mut channels: Vec<HarnessChannel> = Vec::new();

    let mut add = |name: &str, kind: &str, signal: &str, current: f64, connector: &str, continuous: bool, note: &str| {
        channels.push(HarnessChannel {
            name: name.into(),
            kind: kind.into(),
            signal: signal.into(),
            voltage_v: bus,
            current_a: current,
            wire_awg: gauge_for(current),
            connector: connector.into(),
            continuous,
            note: note.into(),
        });
    };

    // Main propellant valves (solenoid pilot or electric actuator), held open.
    add("Ox main valve", "valve", "power", mv, "MS3116-8", true, "held open through the burn");
    add("Fuel main valve", "valve", "power", mv, "MS3116-8", true, "held open through the burn");
    // Fill/vent valves (pulsed at fill/safing).
    add("Ox vent/fill valve", "valve", "power", 2.0, "MS3116-6", false, "pulsed at fill and safing");
    add("Fuel vent/fill valve", "valve", "power", 2.0, "MS3116-6", false, "pulsed at fill and safing");
    if input.has_pressurant {
        add("Pressurant regulator solenoid", "pressurant", "pwm", 2.0, "MS3116-6", true, "regulated He, PWM duty for tank pressure");
    }
    // Igniter exciter (spark/torch), high-energy pulse.
    add("Igniter exciter", "igniter", "highvoltage", input.igniter_current_a.max(0.1), "HV-BNC", false, "capacitive-discharge exciter, pulsed at start");

    // Pressure transducers.
    add("Chamber pressure (Pc)", "sensor", "analog", 0.03, "M8-4pin", true, "0–5 V / 4–20 mA, shielded");
    add("Ox tank pressure", "sensor", "analog", 0.03, "M8-4pin", true, "shielded");
    add("Fuel tank pressure", "sensor", "analog", 0.03, "M8-4pin", true, "shielded");
    // Thermocouples.
    add("Chamber wall TC", "sensor", "analog", 0.01, "TC-mini", true, "K-type, TC-grade extension wire");
    add("Nozzle TC", "sensor", "analog", 0.01, "TC-mini", true, "K-type");

    if pump_fed {
        add("Ox pump controller", "pump", "digital", 8.0, "MS3116-10", true, "ESC / speed command + telemetry");
        add("Fuel pump controller", "pump", "digital", 8.0, "MS3116-10", true, "ESC / speed command + telemetry");
        add("Turbine/GG spin-start valve", "valve", "power", 2.5, "MS3116-6", false, "start sequence");
    }

    // Dual-redundant avionics: redundant main valves and Pc sensor (a redundant
    // flight computer is added to the housekeeping load below).
    if input.dual_redundant {
        add("Ox main valve (redundant)", "valve", "power", mv, "MS3116-8", true, "redundant series/parallel actuator");
        add("Fuel main valve (redundant)", "valve", "power", mv, "MS3116-8", true, "redundant series/parallel actuator");
        add("Chamber pressure (redundant)", "sensor", "analog", 0.03, "M8-4pin", true, "redundant Pc transducer (voting)");
    }

    // Currents.
    let peak_current: f64 = channels.iter().map(|c| c.current_a).sum();
    let continuous_current: f64 = channels.iter().filter(|c| c.continuous).map(|c| c.current_a).sum();

    // Wire mass: each channel is a round-trip run at the characteristic length.
    let run = input.run_length_m.max(0.3);
    let total_wire_length_m: f64 = channels.iter().map(|_| 2.0 * run).sum();
    let harness_mass_kg: f64 = channels
        .iter()
        .map(|c| 2.0 * run * awg_mass_g_per_m(c.wire_awg) / 1000.0)
        .sum::<f64>()
        + 0.15; // connectors, backshells, lacing

    // Battery: hold the continuous load through the burn with the chosen reserve,
    // plus the avionics housekeeping load (doubled for a redundant flight computer).
    let fc_count = if input.dual_redundant { 2.0 } else { 1.0 };
    let housekeeping_w = bus * input.housekeeping_current_a.max(0.0) * fc_count; // flight computer(s) + telemetry
    let continuous_w = bus * continuous_current + housekeeping_w;
    let reserve = input.battery_reserve_factor.clamp(1.0, 5.0);
    let battery_capacity_wh = continuous_w * (input.burn_time_s.max(1.0) / 3600.0) * reserve + 5.0;
    let battery_mass_kg = battery_capacity_wh / input.battery_energy_density_wh_kg.max(20.0) + 0.1;

    let channel_count = channels.len() as u32;
    let summary = format!(
        "{} channels on a {:.0} V bus | peak {:.1} A, continuous {:.1} A | battery {:.0} Wh ({:.2} kg), harness {:.2} kg",
        channel_count, bus, peak_current, continuous_current, battery_capacity_wh, battery_mass_kg, harness_mass_kg
    );

    AvionicsHarness {
        channels,
        bus_voltage_v: bus,
        peak_current_a: peak_current,
        continuous_current_a: continuous_current,
        battery_capacity_wh,
        battery_mass_kg,
        harness_mass_kg,
        total_wire_length_m,
        channel_count,
        summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(feed: &str, pressurant: bool) -> AvionicsInput {
        AvionicsInput { feed_type: feed.into(), has_pressurant: pressurant, ..Default::default() }
    }

    #[test]
    fn pressure_fed_harness_is_physical() {
        let h = build_harness(&base("pressure-fed", true));
        assert!(h.channel_count >= 10, "channels = {}", h.channel_count);
        assert!(h.peak_current_a > h.continuous_current_a);
        assert!(h.battery_capacity_wh > 0.0 && h.battery_mass_kg > 0.0);
        assert!(h.harness_mass_kg > 0.0);
        // The igniter exciter is a pulsed high-voltage channel.
        let ig = h.channels.iter().find(|c| c.kind == "igniter").unwrap();
        assert_eq!(ig.signal, "highvoltage");
        assert!(!ig.continuous);
    }

    #[test]
    fn pump_fed_adds_pump_controllers() {
        let press = build_harness(&base("pressure-fed", true));
        let pump = build_harness(&base("pump-fed", false));
        assert!(pump.channel_count > press.channel_count);
        assert!(pump.channels.iter().any(|c| c.kind == "pump"));
        // Pump controllers draw more, so the peak current rises.
        assert!(pump.peak_current_a > press.peak_current_a);
    }

    #[test]
    fn gauge_scales_with_current() {
        // A 0.03 A sensor uses fine signal wire; an 8 A pump uses heavy gauge.
        assert!(gauge_for(0.03) > gauge_for(8.0));
    }

    #[test]
    fn longer_burn_needs_more_battery() {
        let short = build_harness(&AvionicsInput { burn_time_s: 10.0, ..base("pressure-fed", true) });
        let long = build_harness(&AvionicsInput { burn_time_s: 120.0, ..base("pressure-fed", true) });
        assert!(long.battery_capacity_wh > short.battery_capacity_wh);
    }

    #[test]
    fn dual_redundancy_adds_channels_and_battery() {
        let single = build_harness(&base("pressure-fed", true));
        let dual = build_harness(&AvionicsInput { dual_redundant: true, ..base("pressure-fed", true) });
        assert!(dual.channel_count > single.channel_count, "redundant channels");
        assert!(dual.battery_capacity_wh > single.battery_capacity_wh, "second flight computer draws more");
    }

    #[test]
    fn bus_voltage_and_energy_density_scale_battery_mass() {
        let base = build_harness(&base("pressure-fed", true));
        let dense = build_harness(&AvionicsInput { battery_energy_density_wh_kg: 250.0, ..super::AvionicsInput::default() });
        assert!(dense.battery_mass_kg < base.battery_mass_kg);
    }
}
