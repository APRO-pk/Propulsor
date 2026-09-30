//! Turbomachinery sizing for liquid rocket engines (turboRocket-inspired).
//!
//! Covers the turbopump subsystem end to end: centrifugal/mixed/axial pump
//! sizing with NPSH/cavitation margin ([`pump`]), inducer anti-cavitation front
//! stages ([`inducer`]), turbine drive sizing ([`turbine`]), the rotating-group
//! mechanicals — shaft ([`shaft`]), rolling-element bearings ([`bearing`]),
//! reduction gearing ([`gear`]) and shaft seals ([`seal`]) — and the power
//! cycles ([`cycle`]): an open gas-generator cycle and a closed staged-combustion
//! cycle with a preburner, both of which close the pump↔turbine power balance by
//! solving for the turbine-drive flow rather than assuming it fixed.

pub const G0: f64 = 9.80665;

pub mod bearing;
pub mod blade;
pub mod characteristic;
pub mod cycle;
pub mod gear;
pub mod inducer;
pub mod losses;
pub mod pump;
pub mod seal;
pub mod shaft;
pub mod turbine;

pub use bearing::{solve_bearing, BearingInput, BearingResult};
pub use cycle::{
    preburner_temp, solve_gg_cycle, solve_preburner, solve_sc_cycle, GgCycleInput, GgCycleResult,
    PreburnerInput, PreburnerResult, ScCycleInput, ScCycleResult,
};
pub use gear::{solve_gear, GearInput, GearResult};
pub use inducer::{solve_inducer, InducerInput, InducerResult};
pub use pump::{solve_pump, PumpInput, PumpResult};
pub use seal::{solve_seal, SealInput, SealKind, SealResult};
pub use shaft::{solve_shaft, ShaftInput, ShaftResult};
pub use turbine::{power_balance, solve_turbine, TurbineInput, TurbineResult};
