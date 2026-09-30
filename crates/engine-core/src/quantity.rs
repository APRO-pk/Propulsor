//! Unit & quantity types.
//!
//! Policy (per the architecture plan): **canonical SI internally**. Quantities
//! are small newtypes wrapping an `f64` expressed in the SI base unit. The unit
//! system toggle in the UI is presentation-only; conversions to/from imperial
//! happen only in these constructors/accessors, so solver code never performs a
//! magic-number conversion and the recompute graph hashes the SI value.

use serde::{Deserialize, Serialize};

/// User-facing unit-system preference. Stored on the design entity but never
/// used to mutate canonical values; it only selects which accessors the UI calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnitSystem {
    /// Default. All quantities are m·kg·s·K·Pa.
    Si,
    /// Krzycki's source numbers (in·lb·s·°F·psi) drive the imperial accessors.
    Imperial,
}

macro_rules! quantity {
    ($name:ident, $doc:literal, $si_unit:literal) => {
        #[doc = $doc]
        #[doc = "Canonical units: `"]
        #[doc = $si_unit]
        #[doc = "`."]
        #[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub f64);

        impl $name {
            #[doc = "Construct directly in canonical SI units."]
            pub const fn si(v: f64) -> Self {
                Self(v)
            }
            #[doc = "Read the canonical SI value."]
            pub const fn as_si(self) -> f64 {
                self.0
            }
        }
    };
}

quantity!(Length, "A length.", "m");
quantity!(Area, "An area.", "m²");
quantity!(Pressure, "A pressure.", "Pa");
quantity!(Temperature, "A temperature.", "K");
quantity!(MassFlow, "A mass flow rate.", "kg/s");
quantity!(Velocity, "A velocity.", "m/s");
quantity!(Force, "A force (thrust).", "N");
quantity!(Volume, "A volume.", "m³");

/// Dimensionless ratio (e.g. mixture ratio, area ratio, contraction ratio).
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Ratio(pub f64);

impl Ratio {
    pub const fn new(v: f64) -> Self {
        Self(v)
    }
    pub const fn as_f64(self) -> f64 {
        self.0
    }
}

// ---- Imperial conversion helpers ---------------------------------------------
// Krzycki's book is in the imperial system. These are the only places the
// imperial constants appear. Conversion factors are exact where defined.

impl Length {
    pub const fn inches(v: f64) -> Self {
        Self(v * 0.0254)
    }
    pub const fn as_inches(self) -> f64 {
        self.0 / 0.0254
    }
}

impl Area {
    pub const fn sq_inches(v: f64) -> Self {
        Self(v * 0.00064516)
    }
    pub const fn as_sq_inches(self) -> f64 {
        self.0 / 0.00064516
    }
}

impl MassFlow {
    pub const fn lb_per_s(v: f64) -> Self {
        Self(v * 0.45359237)
    }
    pub const fn as_lb_per_s(self) -> f64 {
        self.0 / 0.45359237
    }
}

impl Pressure {
    pub const fn psi(v: f64) -> Self {
        Self(v * 6894.757293168361)
    }
    pub const fn bar(v: f64) -> Self {
        Self(v * 100000.0)
    }
    pub const fn as_psi(self) -> f64 {
        self.0 / 6894.757293168361
    }
    pub const fn atm(self) -> Pressure {
        Pressure(self.0 / 101325.0)
    }
}

impl Temperature {
    pub const fn celsius(v: f64) -> Self {
        Self(v + 273.15)
    }
    pub const fn fahrenheit(v: f64) -> Self {
        Self((v - 32.0) * 5.0 / 9.0 + 273.15)
    }
    pub const fn as_fahrenheit(self) -> f64 {
        (self.0 - 273.15) * 9.0 / 5.0 + 32.0
    }
}

/// Standard gravitational constant from Krzycki, exposed as a named constant so
/// solver code never hard-codes it.
pub const G0_METRIC: f64 = 9.80665; // m/s²

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn si_is_canonical_round_trip() {
        let p = Pressure::psi(300.0);
        assert!((p.as_si() - 300.0 * 6894.757293168361).abs() < 1e-6);
        assert!((p.as_psi() - 300.0).abs() < 1e-9);
    }

    #[test]
    fn thermometer_round_trip() {
        let t = Temperature::fahrenheit(70.0);
        assert!((t.as_celsius() - 21.111_111).abs() < 1e-4);
        assert!((t.as_fahrenheit() - 70.0).abs() < 1e-9);
    }

    #[test]
    fn inches_round_trip() {
        let l = Length::inches(0.238);
        assert!((l.as_inches() - 0.238).abs() < 1e-12);
    }
}

// Helper used by tests above.
impl Temperature {
    pub const fn as_celsius(self) -> f64 {
        self.0 - 273.15
    }
}
