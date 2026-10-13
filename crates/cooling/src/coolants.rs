//! Regenerative-coolant properties and limits.
//!
//! A regen jacket is cooled by a propellant (normally the fuel), so the coolant
//! is derived from the propellant pair. Properties are temperature-dependent
//! tables generated from sourced data by `tools/coolant_tables/generate.py`
//! (see [`crate::coolant_tables`]):
//! * **RocketProps** (C. Taylor) saturated-liquid tables, freezing point →
//!   critical point, for every coolant except gasoline. Fluids RocketProps lists
//!   as REFPROP-derived (water, LOX, CH4, para-H2, ethanol, methanol, propane,
//!   N2O) are NIST REFPROP values; RP-1, MMH, UDMH, NTO and H2O2 are its compiled
//!   data (AFRPL-TR-69-149, CPIA/Aerojet).
//! * **NIST Chemistry WebBook** (REFPROP) supercritical isobars for para-H2,
//!   CH4, O2, propane, N2O, methanol and n-heptane (the gasoline surrogate),
//!   from just above P_crit to 35–50 MPa, and the n-heptane saturated-liquid
//!   table. (NIST has no ethanol data, so ethanol, RP-1, the hydrazines, NTO,
//!   H2O2 and water use the compressed-liquid approximation below.)
//!
//! Which table applies depends on the jacket pressure:
//! * below the critical pressure, the saturated-liquid table (the coolant must
//!   stay liquid; heating past T_sat is flagged by the boiling margin);
//! * above it, the NIST isobars bracketing that pressure, blended in ln p, when
//!   the coolant has them; otherwise the saturated-liquid table as a
//!   compressed-liquid approximation, capped at 0.95·T_crit where it breaks down.
//!
//! The solver rebuilds the curve at each station's local pressure (inlet minus
//! the friction drop so far).

use crate::coolant_tables as tab;
use engine_core::PropellantPair;

/// One property table along an isobar (or along the saturated-liquid line when
/// `pressure_pa` is 0). Columns share the temperature grid `t_k`. SI units;
/// only enthalpy differences are meaningful.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PropTable {
    pub pressure_pa: f64,
    pub t_k: &'static [f64],
    pub rho: &'static [f64],
    pub mu: &'static [f64],
    pub k: &'static [f64],
    pub cp: &'static [f64],
    pub h: &'static [f64],
}

/// A regenerative coolant: identity, critical constants, limits and tables.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coolant {
    pub name: &'static str,
    /// Jacket inlet temperature, K.
    pub inlet_temp_k: f64,
    /// Normal (1 atm) boiling point, K.
    pub normal_boiling_k: f64,
    pub critical_temp_k: f64,
    pub critical_pressure_pa: f64,
    /// Maximum coolant-side wall temperature before the coolant cokes, K —
    /// `None` where no sourced limit exists.
    pub coking_limit_k: Option<f64>,
    pub source: &'static str,
    /// Saturated-liquid table (freezing/triple point → critical point).
    pub saturated: &'static PropTable,
    /// NIST isobars above the critical pressure, ascending in pressure (may be empty).
    pub supercritical: &'static [PropTable],
    /// Coolant-side heat-transfer correlation.
    pub correlation: Correlation,
}

/// Coolant-side forced-convection correlation, with a wall-to-bulk property
/// correction (the coolant at the hot wall is far hotter than the bulk).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Correlation {
    /// Gnielinski (bulk properties) × (μ_b/μ_w)^0.11 — Petukhov's property-ratio
    /// exponent for heating a liquid.
    GnielinskiPetukhov,
    /// Taylor, NASA TN D-4332 (1968), single-phase hydrogen in heated tubes to
    /// T_w/T_b = 23: Nu_b = 0.023·Re_b^0.8·Pr_b^0.4·(T_w/T_b)^−0.57 (the
    /// fully-developed limit of its −(0.57 − 1.59/(x/d)) exponent, which is
    /// conservative near the inlet).
    Taylor,
}

/// RP-1 coking limit. NASA CR-165405 (Roback, Szetela & Spadaccini, "Deposit
/// Formation in Hydrocarbon Rocket Fuels", 1981) heated-tube tests at 136–340 atm
/// found substantial RP-1 carbon deposition at wall temperatures from 600 K to
/// 800 K (peak near 700 K); 600 K is the onset used as the design limit.
pub const RP1_COKING_LIMIT_K: f64 = 600.0;
pub const RP1_COKING_SOURCE: &str = "NASA CR-165405: RP-1 deposits form at 600–800 K wall temperature";

const ATM: f64 = 101_325.0;
const ROCKETPROPS: &str = "RocketProps saturated liquid";
const ROCKETPROPS_REFPROP: &str = "RocketProps (REFPROP) saturated liquid";
const ROCKETPROPS_NIST: &str = "RocketProps (REFPROP) saturated liquid; NIST WebBook supercritical isobars";

pub const WATER: Coolant = Coolant {
    name: "Water",
    inlet_temp_k: 293.15,
    normal_boiling_k: tab::WATER_TNBP_K,
    critical_temp_k: tab::WATER_TC_K,
    critical_pressure_pa: tab::WATER_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS_REFPROP,
    saturated: &tab::WATER_SAT,
    supercritical: &[],
    correlation: Correlation::GnielinskiPetukhov,
};

pub const RP1: Coolant = Coolant {
    name: "RP-1",
    inlet_temp_k: 293.15,
    normal_boiling_k: tab::RP1_TNBP_K,
    critical_temp_k: tab::RP1_TC_K,
    critical_pressure_pa: tab::RP1_PC_PA,
    coking_limit_k: Some(RP1_COKING_LIMIT_K),
    source: ROCKETPROPS,
    saturated: &tab::RP1_SAT,
    supercritical: &[],
    correlation: Correlation::GnielinskiPetukhov,
};

pub const ETHANOL: Coolant = Coolant {
    name: "Ethanol",
    inlet_temp_k: 293.15,
    normal_boiling_k: tab::ETHANOL_TNBP_K,
    critical_temp_k: tab::ETHANOL_TC_K,
    critical_pressure_pa: tab::ETHANOL_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS_REFPROP,
    saturated: &tab::ETHANOL_SAT,
    supercritical: &[],
    correlation: Correlation::GnielinskiPetukhov,
};

pub const METHANOL: Coolant = Coolant {
    name: "Methanol",
    inlet_temp_k: 293.15,
    normal_boiling_k: tab::METHANOL_TNBP_K,
    critical_temp_k: tab::METHANOL_TC_K,
    critical_pressure_pa: tab::METHANOL_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS_NIST,
    saturated: &tab::METHANOL_SAT,
    supercritical: &tab::METHANOL_SUPERCRITICAL,
    correlation: Correlation::GnielinskiPetukhov,
};

pub const METHANE: Coolant = Coolant {
    name: "LCH4",
    inlet_temp_k: 111.67,
    normal_boiling_k: tab::METHANE_TNBP_K,
    critical_temp_k: tab::METHANE_TC_K,
    critical_pressure_pa: tab::METHANE_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS_NIST,
    saturated: &tab::METHANE_SAT,
    supercritical: &tab::METHANE_SUPERCRITICAL,
    correlation: Correlation::GnielinskiPetukhov,
};

pub const HYDROGEN: Coolant = Coolant {
    name: "LH2",
    inlet_temp_k: 20.27,
    normal_boiling_k: tab::HYDROGEN_TNBP_K,
    critical_temp_k: tab::HYDROGEN_TC_K,
    critical_pressure_pa: tab::HYDROGEN_PC_PA,
    coking_limit_k: None,
    source: "RocketProps (REFPROP) saturated para-H2; NIST WebBook para-H2 supercritical isobars",
    saturated: &tab::HYDROGEN_SAT,
    supercritical: &tab::HYDROGEN_SUPERCRITICAL,
    correlation: Correlation::Taylor,
};

pub const PROPANE: Coolant = Coolant {
    name: "Propane",
    inlet_temp_k: 298.15,
    normal_boiling_k: tab::PROPANE_TNBP_K,
    critical_temp_k: tab::PROPANE_TC_K,
    critical_pressure_pa: tab::PROPANE_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS_NIST,
    saturated: &tab::PROPANE_SAT,
    supercritical: &tab::PROPANE_SUPERCRITICAL,
    correlation: Correlation::GnielinskiPetukhov,
};

pub const GASOLINE: Coolant = Coolant {
    name: "Gasoline (n-heptane)",
    inlet_temp_k: 298.15,
    normal_boiling_k: tab::GASOLINE_TNBP_K,
    critical_temp_k: tab::GASOLINE_TC_K,
    critical_pressure_pa: tab::GASOLINE_PC_PA,
    coking_limit_k: None,
    source: "NIST WebBook n-heptane saturated liquid and supercritical isobars",
    saturated: &tab::GASOLINE_SAT,
    supercritical: &tab::GASOLINE_SUPERCRITICAL,
    correlation: Correlation::GnielinskiPetukhov,
};

pub const MMH: Coolant = Coolant {
    name: "MMH",
    inlet_temp_k: 293.15,
    normal_boiling_k: tab::MMH_TNBP_K,
    critical_temp_k: tab::MMH_TC_K,
    critical_pressure_pa: tab::MMH_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS,
    saturated: &tab::MMH_SAT,
    supercritical: &[],
    correlation: Correlation::GnielinskiPetukhov,
};

pub const UDMH: Coolant = Coolant {
    name: "UDMH",
    inlet_temp_k: 293.15,
    normal_boiling_k: tab::UDMH_TNBP_K,
    critical_temp_k: tab::UDMH_TC_K,
    critical_pressure_pa: tab::UDMH_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS,
    saturated: &tab::UDMH_SAT,
    supercritical: &[],
    correlation: Correlation::GnielinskiPetukhov,
};

pub const LOX: Coolant = Coolant {
    name: "LOX",
    inlet_temp_k: 90.19,
    normal_boiling_k: tab::LOX_TNBP_K,
    critical_temp_k: tab::LOX_TC_K,
    critical_pressure_pa: tab::LOX_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS_NIST,
    saturated: &tab::LOX_SAT,
    supercritical: &tab::LOX_SUPERCRITICAL,
    correlation: Correlation::GnielinskiPetukhov,
};

pub const NTO: Coolant = Coolant {
    name: "NTO",
    inlet_temp_k: 293.15,
    normal_boiling_k: tab::NTO_TNBP_K,
    critical_temp_k: tab::NTO_TC_K,
    critical_pressure_pa: tab::NTO_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS,
    saturated: &tab::NTO_SAT,
    supercritical: &[],
    correlation: Correlation::GnielinskiPetukhov,
};

pub const PEROXIDE: Coolant = Coolant {
    name: "H2O2 (100%)",
    inlet_temp_k: 288.15,
    normal_boiling_k: tab::PEROXIDE_TNBP_K,
    critical_temp_k: tab::PEROXIDE_TC_K,
    critical_pressure_pa: tab::PEROXIDE_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS,
    saturated: &tab::PEROXIDE_SAT,
    supercritical: &[],
    correlation: Correlation::GnielinskiPetukhov,
};

pub const NITROUS: Coolant = Coolant {
    name: "N2O",
    inlet_temp_k: 293.15,
    normal_boiling_k: tab::NITROUS_TNBP_K,
    critical_temp_k: tab::NITROUS_TC_K,
    critical_pressure_pa: tab::NITROUS_PC_PA,
    coking_limit_k: None,
    source: ROCKETPROPS_NIST,
    saturated: &tab::NITROUS_SAT,
    supercritical: &tab::NITROUS_SUPERCRITICAL,
    correlation: Correlation::GnielinskiPetukhov,
};

/// Every coolant in the table (for name lookup and tests).
pub const ALL: [Coolant; 14] = [
    WATER, RP1, ETHANOL, METHANOL, METHANE, HYDROGEN, PROPANE, GASOLINE, MMH, UDMH, LOX, NTO, PEROXIDE, NITROUS,
];

/// Coolant state at one temperature on a [`PropertyCurve`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FluidState {
    pub t_k: f64,
    pub rho: f64,
    pub mu: f64,
    pub k: f64,
    pub cp: f64,
    pub h: f64,
}

impl FluidState {
    pub fn prandtl(&self) -> f64 {
        self.mu * self.cp / self.k
    }
}

/// Coolant properties vs temperature at one (jacket) pressure.
#[derive(Debug, Clone, PartialEq)]
pub struct PropertyCurve {
    pub t_k: Vec<f64>,
    pub rho: Vec<f64>,
    pub mu: Vec<f64>,
    pub k: Vec<f64>,
    pub cp: Vec<f64>,
    pub h: Vec<f64>,
    /// Which table(s) the curve comes from, for the result report.
    pub basis: String,
}

impl PropertyCurve {
    fn from_table(t: &PropTable, basis: String) -> Self {
        PropertyCurve {
            t_k: t.t_k.to_vec(),
            rho: t.rho.to_vec(),
            mu: t.mu.to_vec(),
            k: t.k.to_vec(),
            cp: t.cp.to_vec(),
            h: t.h.to_vec(),
            basis,
        }
    }

    /// Pointwise ln-p blend of two isobars on the lower isobar's temperature grid.
    fn blend(lo: &PropTable, hi: &PropTable, p_pa: f64) -> Self {
        let w = ((p_pa / lo.pressure_pa).ln() / (hi.pressure_pa / lo.pressure_pa).ln()).clamp(0.0, 1.0);
        let mix = |a: &[f64], b: &[f64], log: bool| -> Vec<f64> {
            lo.t_k
                .iter()
                .zip(a)
                .map(|(&t, &ya)| {
                    let yb = interp(hi.t_k, b, t, log);
                    if log { (ya.ln() * (1.0 - w) + yb.ln() * w).exp() } else { ya * (1.0 - w) + yb * w }
                })
                .collect()
        };
        PropertyCurve {
            t_k: lo.t_k.to_vec(),
            rho: mix(lo.rho, hi.rho, true),
            mu: mix(lo.mu, hi.mu, true),
            k: mix(lo.k, hi.k, false),
            cp: mix(lo.cp, hi.cp, false),
            h: mix(lo.h, hi.h, false),
            basis: format!(
                "NIST isobars {:.0}–{:.0} bar, blended at {:.1} bar",
                lo.pressure_pa / 1e5,
                hi.pressure_pa / 1e5,
                p_pa / 1e5
            ),
        }
    }

    /// Highest tabulated temperature, K.
    pub fn t_max(&self) -> f64 {
        *self.t_k.last().unwrap_or(&0.0)
    }

    /// Properties at a temperature: linear interpolation (log-linear for
    /// viscosity and density), held constant beyond the table; the enthalpy is
    /// extrapolated with the end-point cp so energy is still conserved.
    pub fn at(&self, t_k: f64) -> FluidState {
        let (t0, t1) = (self.t_k[0], self.t_max());
        let h = if t_k > t1 {
            self.h[self.h.len() - 1] + self.cp[self.cp.len() - 1] * (t_k - t1)
        } else if t_k < t0 {
            self.h[0] - self.cp[0] * (t0 - t_k)
        } else {
            interp(&self.t_k, &self.h, t_k, false)
        };
        FluidState {
            t_k,
            rho: interp(&self.t_k, &self.rho, t_k, true),
            mu: interp(&self.t_k, &self.mu, t_k, true),
            k: interp(&self.t_k, &self.k, t_k, false),
            cp: interp(&self.t_k, &self.cp, t_k, false),
            h,
        }
    }

    /// Temperature at an enthalpy (the inverse of `at(..).h`; h rises with T).
    pub fn temp_from_enthalpy(&self, h: f64) -> f64 {
        let n = self.h.len();
        if h >= self.h[n - 1] {
            return self.t_max() + (h - self.h[n - 1]) / self.cp[n - 1].max(1.0);
        }
        if h <= self.h[0] {
            return self.t_k[0] - (self.h[0] - h) / self.cp[0].max(1.0);
        }
        interp(&self.h, &self.t_k, h, false)
    }
}

/// Clamped linear interpolation of `ys(xs)` at `x` (`xs` ascending); `log`
/// interpolates ln y (for quantities that vary exponentially with T).
fn interp(xs: &[f64], ys: &[f64], x: f64, log: bool) -> f64 {
    let n = xs.len();
    if x <= xs[0] {
        return ys[0];
    }
    if x >= xs[n - 1] {
        return ys[n - 1];
    }
    let i = xs.partition_point(|&v| v <= x).clamp(1, n - 1);
    let f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    if log && ys[i - 1] > 0.0 && ys[i] > 0.0 {
        (ys[i - 1].ln() * (1.0 - f) + ys[i].ln() * f).exp()
    } else {
        ys[i - 1] * (1.0 - f) + ys[i] * f
    }
}

impl Coolant {
    /// Whether the coolant is above its critical pressure (no phase change,
    /// so no boiling limit).
    pub fn is_supercritical(&self, p_pa: f64) -> bool {
        p_pa >= self.critical_pressure_pa
    }

    /// Saturation temperature at a pressure, K, or `None` above the critical
    /// pressure. Two-point Clausius–Clapeyron, ln p = A − B/T, anchored at the
    /// normal boiling point and the critical point (for water this reproduces
    /// steam-table values within ~2 K from 3 to 200 bar).
    pub fn saturation_temp_k(&self, p_pa: f64) -> Option<f64> {
        if self.is_supercritical(p_pa) {
            return None;
        }
        let b = (self.critical_pressure_pa / ATM).ln() / (1.0 / self.normal_boiling_k - 1.0 / self.critical_temp_k);
        let inv_t = 1.0 / self.normal_boiling_k - (p_pa.max(1.0) / ATM).ln() / b;
        Some(1.0 / inv_t)
    }

    /// Property curve at a jacket pressure (see the module docs for which table applies).
    pub fn curve(&self, p_pa: f64) -> PropertyCurve {
        let sc = self.supercritical;
        if self.is_supercritical(p_pa) && !sc.is_empty() {
            return match sc.iter().position(|t| t.pressure_pa >= p_pa) {
                Some(0) => PropertyCurve::from_table(
                    &sc[0],
                    format!(
                        "NIST isobar {:.0} bar (nearest; jacket {:.1} bar is between P_crit and the lowest isobar)",
                        sc[0].pressure_pa / 1e5,
                        p_pa / 1e5
                    ),
                ),
                Some(i) => PropertyCurve::blend(&sc[i - 1], &sc[i], p_pa),
                None => {
                    let last = &sc[sc.len() - 1];
                    PropertyCurve::from_table(
                        last,
                        format!("NIST isobar {:.0} bar (highest tabulated; jacket {:.1} bar)", last.pressure_pa / 1e5, p_pa / 1e5),
                    )
                }
            };
        }
        let mut c = PropertyCurve::from_table(self.saturated, "saturated-liquid table".into());
        if self.is_supercritical(p_pa) {
            // Compressed liquid ≈ saturated liquid well below T_crit; near T_crit the
            // saturated line collapses toward the critical density, so stop there.
            let cap = 0.95 * self.critical_temp_k;
            let keep = c.t_k.iter().filter(|&&t| t <= cap).count().max(2);
            for v in [&mut c.t_k, &mut c.rho, &mut c.mu, &mut c.k, &mut c.cp, &mut c.h] {
                v.truncate(keep);
            }
            c.basis = format!("saturated-liquid table as compressed liquid (no supercritical data; held constant above {cap:.0} K)");
        }
        c
    }
}

/// The (fuel, oxidizer) coolants of a propellant pair. The oxidizer is `None`
/// when it is gaseous (GOX), which cannot regen-cool a jacket as a liquid.
pub fn for_pair(pair: PropellantPair) -> (Coolant, Option<Coolant>) {
    use PropellantPair as P;
    match pair {
        P::Unset | P::GoxKerosene => (RP1, None),
        P::GoxGasoline => (GASOLINE, None),
        P::GoxEthanol => (ETHANOL, None),
        P::GoxMethanol => (METHANOL, None),
        P::LoxRp1 => (RP1, Some(LOX)),
        P::LoxEthanol => (ETHANOL, Some(LOX)),
        P::LoxMethane => (METHANE, Some(LOX)),
        P::NitrousPropane => (PROPANE, Some(NITROUS)),
        P::NtoMmh => (MMH, Some(NTO)),
        P::NtoUdmh => (UDMH, Some(NTO)),
        P::LoxHydrogen => (HYDROGEN, Some(LOX)),
        // HTP is liquid in the jacket; it is decomposed only after, in the catalyst bed.
        P::H2o2Kerosene => (RP1, Some(PEROXIDE)),
    }
}

/// Which propellant stream a coolant is, which sets its jacket mass flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoolantStream {
    Fuel,
    Oxidizer,
    /// Not a propellant of this pair (e.g. water on a test stand): its flow is
    /// independent of the engine, so it is set by the coolant velocity.
    External,
}

/// Resolve the `cooling.coolant` choice: `"fuel"` (default), `"oxidizer"`, or a
/// coolant name from [`ALL`] (case-insensitive, e.g. `"water"`).
pub fn select(pair: PropellantPair, choice: &str) -> Result<(Coolant, CoolantStream), String> {
    let (fuel, ox) = for_pair(pair);
    match choice.trim().to_ascii_lowercase().as_str() {
        "" | "fuel" => Ok((fuel, CoolantStream::Fuel)),
        "oxidizer" | "ox" => ox
            .map(|o| (o, CoolantStream::Oxidizer))
            .ok_or_else(|| format!("the {} oxidizer is gaseous and cannot regen-cool the jacket", pair.label())),
        name => {
            let c = ALL
                .iter()
                .find(|c| c.name.to_ascii_lowercase() == name)
                .copied()
                .ok_or_else(|| format!("unknown coolant '{choice}'"))?;
            let stream = if c.name == fuel.name {
                CoolantStream::Fuel
            } else if ox.is_some_and(|o| o.name == c.name) {
                CoolantStream::Oxidizer
            } else {
                CoolantStream::External
            };
            Ok((c, stream))
        }
    }
}

/// Default coolant jacket inlet pressure as a multiple of chamber pressure,
/// from a feed pressure budget (Huzel & Huang, *Modern Engineering for Design of
/// Liquid-Propellant Rocket Engines*, AIAA 1992): the jacket inlet sits above Pc
/// by the injector drop (0.20·Pc, the same budget the L5 feed tier uses) plus
/// the jacket's own drop (~0.15·Pc).
pub const DEFAULT_JACKET_PRESSURE_FACTOR: f64 = 1.35;

/// Injector pressure drop assumed in the feed budget, as a fraction of Pc.
pub const INJECTOR_DP_FRACTION: f64 = 0.20;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn water_saturation_matches_steam_tables() {
        // IAPWS-IF97: 3 bar → 406.7 K, 10 bar → 453.0 K, 100 bar → 584.1 K.
        for (p_bar, t_ref) in [(3.0, 406.7), (10.0, 453.0), (100.0, 584.1)] {
            let t = WATER.saturation_temp_k(p_bar * 1e5).unwrap();
            assert!((t - t_ref).abs() < 2.5, "{p_bar} bar: {t} vs {t_ref}");
        }
        assert!(WATER.saturation_temp_k(250e5).is_none());
    }

    #[test]
    fn saturation_curve_hits_its_anchors() {
        for c in ALL {
            let tb = c.saturation_temp_k(ATM).unwrap();
            assert!((tb - c.normal_boiling_k).abs() < 1e-6, "{}", c.name);
            let tc = c.saturation_temp_k(c.critical_pressure_pa * 0.999_999).unwrap();
            assert!((tc - c.critical_temp_k).abs() < 0.01, "{}: {tc}", c.name);
        }
    }

    /// Every table is well-formed: ascending T, physical values, enthalpy rising
    /// with T (so the march can invert it), and the inlet inside the table.
    #[test]
    fn tables_are_physical() {
        for c in ALL {
            assert!(c.inlet_temp_k < c.critical_temp_k, "{} inlet above Tc", c.name);
            for t in std::iter::once(c.saturated).chain(c.supercritical.iter()) {
                let n = t.t_k.len();
                assert!(n >= 10, "{}: {n} rows", c.name);
                for col in [t.rho, t.mu, t.k, t.cp, t.h] {
                    assert_eq!(col.len(), n, "{}", c.name);
                }
                for i in 1..n {
                    assert!(t.t_k[i] > t.t_k[i - 1] && t.h[i] > t.h[i - 1], "{} @ {} Pa row {i}", c.name, t.pressure_pa);
                }
                assert!(t.rho.iter().chain(t.mu).chain(t.k).chain(t.cp).all(|&v| v > 0.0 && v.is_finite()));
                // High isobars can start a few K above the inlet where the fluid would
                // be solid (para-H2 melts at ~23 K at 32 MPa, higher at 50 MPa); `at` holds the first row.
                let slack = if t.pressure_pa > 0.0 { 10.0 } else { 0.0 };
                assert!(t.t_k[0] <= c.inlet_temp_k + slack, "{}: table starts at {} K", c.name, t.t_k[0]);
            }
            for w in c.supercritical.windows(2) {
                assert!(w[1].pressure_pa > w[0].pressure_pa && w[0].pressure_pa > c.critical_pressure_pa);
            }
            let inlet = c.curve(ATM.max(c.critical_pressure_pa * 0.5)).at(c.inlet_temp_k);
            assert!((0.5..100.0).contains(&inlet.prandtl()), "{} Pr = {}", c.name, inlet.prandtl());
        }
    }

    /// The tables reproduce independent NIST WebBook / REFPROP point values.
    #[test]
    fn tables_match_nist_spot_values() {
        let close = |a: f64, b: f64, tol: f64| (a / b - 1.0).abs() < tol;
        // Water, 293.15 K (REFPROP): ρ 998.2, μ 1.0016e-3, k 0.5988, cp 4187.
        let w = WATER.curve(3e5).at(293.15);
        assert!(close(w.rho, 998.2, 0.01) && close(w.mu, 1.0016e-3, 0.03) && close(w.k, 0.5988, 0.02) && close(w.cp, 4187.2, 0.01), "{w:?}");
        // n-heptane, 298.15 K / 1 atm (NIST): ρ 679.61, μ 3.9014e-4, k 0.1222, cp 2246.5.
        let g = GASOLINE.curve(3e5).at(298.15);
        assert!(close(g.rho, 679.61, 0.01) && close(g.mu, 3.9014e-4, 0.03) && close(g.k, 0.1222, 0.02) && close(g.cp, 2246.5, 0.02), "{g:?}");
        // Propane, 298.15 K / 2 MPa (NIST): ρ 495.56, μ 9.93e-5, k 0.0949.
        let p = PROPANE.curve(2e6).at(298.15);
        assert!(close(p.rho, 495.56, 0.02) && close(p.mu, 9.9299e-5, 0.05) && close(p.k, 0.09488, 0.05), "{p:?}");
        // Para-H2 at 5 MPa (NIST): ρ = 66.45 / 51.39 / 23.78 kg/m³ at 30 / 40 / 60 K —
        // the pseudo-critical collapse the constant-property model missed.
        let h2 = HYDROGEN.curve(5e6);
        for (t, rho) in [(30.0, 66.452), (40.0, 51.392), (60.0, 23.784)] {
            let s = h2.at(t);
            assert!(close(s.rho, rho, 0.08), "H2 5 MPa {t} K: ρ {} vs {rho}", s.rho);
        }
    }

    #[test]
    fn enthalpy_inverts_to_temperature() {
        for (c, p) in [(HYDROGEN, 6e6), (METHANE, 9e6), (RP1, 9e6), (WATER, 3e5)] {
            let curve = c.curve(p);
            for t in [c.inlet_temp_k, 0.5 * (c.inlet_temp_k + curve.t_max()), curve.t_max() + 50.0] {
                let back = curve.temp_from_enthalpy(curve.at(t).h);
                assert!((back - t).abs() < 1e-6 * t.max(1.0), "{} {t} K → {back} K", c.name);
            }
        }
    }

    #[test]
    fn supercritical_without_isobars_caps_the_saturated_table() {
        let c = RP1.curve(90e5);
        assert!(c.t_max() <= 0.95 * RP1.critical_temp_k);
        assert!(c.basis.contains("compressed liquid"));
        assert!(METHANE.curve(90e5).basis.contains("NIST isobars"));
        assert!(RP1.curve(5e5).basis == "saturated-liquid table");
    }

    #[test]
    fn coolant_defaults_to_the_fuel() {
        let s = |pair, choice| select(pair, choice).map(|(c, stream)| (c.name, stream));
        assert_eq!(s(PropellantPair::LoxRp1, "fuel").unwrap(), ("RP-1", CoolantStream::Fuel));
        assert_eq!(s(PropellantPair::LoxMethane, "").unwrap(), ("LCH4", CoolantStream::Fuel));
        assert_eq!(s(PropellantPair::LoxHydrogen, "fuel").unwrap(), ("LH2", CoolantStream::Fuel));
        assert_eq!(s(PropellantPair::LoxRp1, "oxidizer").unwrap(), ("LOX", CoolantStream::Oxidizer));
        assert_eq!(s(PropellantPair::LoxRp1, "Water").unwrap(), ("Water", CoolantStream::External));
        assert_eq!(s(PropellantPair::LoxRp1, "rp-1").unwrap(), ("RP-1", CoolantStream::Fuel));
        assert!(select(PropellantPair::GoxKerosene, "oxidizer").is_err());
        assert!(select(PropellantPair::LoxRp1, "mercury").is_err());
    }
}
