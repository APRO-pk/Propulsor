//! Adiabatic flame temperature + combustion gas properties (L1).
//!
//! Balances reactant enthalpy against equilibrium product enthalpy to find the
//! adiabatic flame temperature, then reports mixture properties and c*/Isp.

use crate::data::Species;
use crate::equilibrium::equilibrium;
use crate::nasa::{h_over_rt, RU};
use crate::{EngineError, EngineResult};
use engine_core::PropellantPair;

/// A fuel surrogate: formula, molecular weight, and heat of formation.
#[derive(Debug, Clone, Copy)]
pub struct Fuel {
    pub name: &'static str,
    pub mw: f64,
    /// [C, H, O, N] atoms per molecule.
    pub atoms: [u8; 4],
    /// Standard heat of formation, J/mol.
    pub d_hf: f64,
}

/// Reference temperature for reactants, K.
pub const T_REF: f64 = 298.15;

pub fn fuel_for(pair: PropellantPair) -> Fuel {
    match pair {
        // Never reached: L1 only solves for a configured design (real propellant).
        PropellantPair::Unset => Fuel { name: "—", mw: 1.0, atoms: [0, 0, 0, 0], d_hf: 0.0 },
        PropellantPair::GoxGasoline | PropellantPair::GoxKerosene => Fuel {
            name: "isooctane",
            mw: 114.23,
            atoms: [8, 18, 0, 0],
            d_hf: -259_280.0,
        },
        PropellantPair::LoxRp1 => Fuel {
            name: "kerosene",
            mw: 167.31,
            atoms: [12, 23, 0, 0],
            d_hf: -290_000.0,
        },
        PropellantPair::GoxEthanol | PropellantPair::LoxEthanol => Fuel {
            name: "ethanol",
            mw: 46.07,
            atoms: [2, 6, 1, 0],
            d_hf: -277_600.0,
        },
        PropellantPair::GoxMethanol => Fuel {
            name: "methanol",
            mw: 32.04,
            atoms: [1, 4, 1, 0],
            d_hf: -238_700.0,
        },
        PropellantPair::LoxMethane => Fuel {
            name: "methane",
            mw: 16.04,
            atoms: [1, 4, 0, 0],
            d_hf: -74_850.0,
        },
        PropellantPair::NitrousPropane => Fuel {
            name: "propane",
            mw: 44.10,
            atoms: [3, 8, 0, 0],
            d_hf: -104_700.0,
        },
        // Monomethylhydrazine CH3-NH-NH2 (CH6N2), endothermic (positive Δh_f).
        PropellantPair::NtoMmh => Fuel {
            name: "MMH",
            mw: 46.07,
            atoms: [1, 6, 0, 2],
            d_hf: 54_200.0,
        },
        // Unsymmetrical dimethylhydrazine (CH3)2N-NH2 (C2H8N2).
        PropellantPair::NtoUdmh => Fuel {
            name: "UDMH",
            mw: 60.10,
            atoms: [2, 8, 0, 2],
            d_hf: 48_900.0,
        },
    }
}

/// An oxidizer: molecular weight, `[C, H, O, N]` atoms per molecule, and heat of
/// formation. Unlike O₂, some oxidizers (N₂O) carry nitrogen and a non-zero heat
/// of formation that adds energy to the flame on decomposition.
#[derive(Debug, Clone, Copy)]
pub struct Oxidizer {
    pub name: &'static str,
    pub mw: f64,
    pub atoms: [u8; 4],
    pub d_hf: f64,
}

pub fn oxidizer_for(pair: PropellantPair) -> Oxidizer {
    match pair {
        // Nitrous oxide: 1 O + 2 N per molecule, and a strongly positive heat of
        // formation (+81.6 kJ/mol) — the energy released when it decomposes.
        PropellantPair::NitrousPropane => Oxidizer {
            name: "N2O",
            mw: 44.013,
            atoms: [0, 0, 1, 2],
            d_hf: 81_600.0,
        },
        // Nitrogen tetroxide N₂O₄: 4 O + 2 N per molecule (storable hypergolic).
        PropellantPair::NtoMmh | PropellantPair::NtoUdmh => Oxidizer {
            name: "N2O4",
            mw: 92.011,
            atoms: [0, 0, 4, 2],
            d_hf: 9_160.0,
        },
        // Everything else is molecular oxygen (GOX/LOX), Δh_f = 0.
        _ => Oxidizer {
            name: "O2",
            mw: 31.9988,
            atoms: [0, 0, 2, 0],
            d_hf: 0.0,
        },
    }
}

/// Moles of oxidizer per mole of fuel for a given O/F mass ratio.
fn ox_moles_per_fuel(fuel: &Fuel, ox: &Oxidizer, of_ratio: f64) -> f64 {
    of_ratio * fuel.mw / ox.mw
}

/// Element atom moles `[C, H, O, N]` per mole of fuel, given the O/F mass ratio.
pub fn element_amounts(fuel: &Fuel, ox: &Oxidizer, of_ratio: f64) -> [f64; 4] {
    let r = ox_moles_per_fuel(fuel, ox, of_ratio);
    [
        fuel.atoms[0] as f64 + ox.atoms[0] as f64 * r,
        fuel.atoms[1] as f64 + ox.atoms[1] as f64 * r,
        fuel.atoms[2] as f64 + ox.atoms[2] as f64 * r,
        fuel.atoms[3] as f64 + ox.atoms[3] as f64 * r,
    ]
}

/// Adiabatic flame temperature (K) for a propellant pair at a chamber pressure.
pub fn adiabatic_tc(
    species: &[Species],
    fuel: &Fuel,
    ox: &Oxidizer,
    of_ratio: f64,
    p: f64,
) -> EngineResult<f64> {
    let b = element_amounts(fuel, ox, of_ratio);
    // Reactant enthalpy includes the oxidizer's heat of formation (zero for O₂).
    let h_react = fuel.d_hf + ox_moles_per_fuel(fuel, ox, of_ratio) * ox.d_hf;

    // f(T) = H_products(T) - H_reactants. H_products increases with T.
    let f = |t: f64| -> f64 {
        let n = match equilibrium(species, &b, t, p) {
            Ok(n) => n,
            Err(_) => return f64::NAN,
        };
        let mut h = 0.0;
        for (i, sp) in species.iter().enumerate() {
            h += n[i] * RU * t * h_over_rt(sp, t);
        }
        h - h_react
    };

    // Bracket the root.
    let (mut lo, mut hi) = (1200.0, 4500.0);
    let mut f_lo = f(lo);
    let mut f_hi = f(hi);
    let mut steps = 0;
    while !(f_lo.is_finite()) && steps < 200 {
        lo *= 0.9;
        f_lo = f(lo);
        steps += 1;
    }
    if !f_lo.is_finite() {
        return Err(EngineError::NonConvergence { iter: 0, residual: f_lo });
    }
    // Ensure bracket has opposite signs.
    let mut guard = 0;
    while f_lo * f_hi > 0.0 && guard < 50 {
        hi *= 1.1;
        f_hi = f(hi);
        guard += 1;
    }
    if f_lo * f_hi > 0.0 {
        return Err(EngineError::NonConvergence { iter: 0, residual: f_hi });
    }

    for _ in 0..80 {
        let mid = 0.5 * (lo + hi);
        let fm = f(mid);
        if !fm.is_finite() {
            // Narrow the bracket away from the non-finite region.
            if lo < mid { lo = mid } else { hi = mid }
            continue;
        }
        if fm.abs() < 1e-6 * h_react.abs().max(1.0) {
            return Ok(mid);
        }
        if f_lo * fm < 0.0 {
            hi = mid;
        } else {
            lo = mid;
            f_lo = fm;
        }
    }
    Ok(0.5 * (lo + hi))
}

