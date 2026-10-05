//! L1 validation: compare the equilibrium solver against NASA CEA-type reference
//! values for a well-known case. This is the M2 gate — the L1 result should be
//! in the ballpark of published equilibrium performance, not the constant
//! γ=1.2/R=65 Krzycki assumption.

use thermo::{solve, ThermoInput, ThermoMethod};
use engine_core::PropellantPair;

#[test]
fn lox_methane_equilibrium_ballpark() {
    // LOX / CH4, O/F = 3.4, Pc = 3.0 MPa. Published CEA values are roughly:
    // Tc ≈ 3390–3450 K, γ ≈ 1.15–1.20, MW ≈ 22–23, c* ≈ 1800–1850 m/s.
    let r = solve(&ThermoInput {
        of_ratio: 3.4,
        chamber_pressure_pa: 3.0e6,
        propellant_pair: PropellantPair::LoxMethane,
        method: ThermoMethod::GibbsFreeEnergy,
        fuel_temp_k: 298.15,
        ox_temp_k: 298.15,
    })
    .expect("L1 solve");

    assert!(
        (3200.0..=3600.0).contains(&r.tc_k),
        "Tc = {} K, expected ~3400",
        r.tc_k
    );
    assert!(
        (1.10..=1.25).contains(&r.gamma),
        "gamma = {}, expected ~1.16",
        r.gamma
    );
    assert!(
        (20.0..=26.0).contains(&r.mean_molecular_weight),
        "MW = {}, expected ~22.5",
        r.mean_molecular_weight
    );
    assert!(
        (1700.0..=1950.0).contains(&r.c_star_m_s),
        "c* = {} m/s, expected ~1830",
        r.c_star_m_s
    );
    assert!(r.isp_vacuum_s > 330.0, "Isp_vac = {} s", r.isp_vacuum_s);
}

#[test]
fn gasoline_composition_is_physical() {
    // GOX / gasoline, O/F = 2.4, Pc = 300 psi (Krzycki example).
    let r = solve(&ThermoInput {
        of_ratio: 2.4,
        chamber_pressure_pa: 2.0684e6,
        propellant_pair: PropellantPair::GoxGasoline,
        method: ThermoMethod::GibbsFreeEnergy,
        fuel_temp_k: 298.15,
        ox_temp_k: 298.15,
    })
    .expect("L1 solve");

    let total: f64 = r.species_mol.iter().map(|(_, m)| m).sum();
    assert!((total - 1.0).abs() < 1e-6, "mole fractions must sum to 1, got {total}");
    assert!(r.tc_k > 2500.0 && r.tc_k < 3600.0, "Tc = {}", r.tc_k);
    assert!(r.mean_molecular_weight > 18.0, "MW = {}", r.mean_molecular_weight);
}

#[test]
fn converges_for_every_seeded_pair() {
    let cases = [
        (PropellantPair::GoxKerosene, 2.6),
        (PropellantPair::GoxGasoline, 2.4),
        (PropellantPair::GoxEthanol, 1.8),
        (PropellantPair::GoxMethanol, 1.5),
        (PropellantPair::LoxRp1, 2.6),
        (PropellantPair::LoxEthanol, 1.8),
        (PropellantPair::LoxMethane, 3.4),
        (PropellantPair::NitrousPropane, 7.0),
        (PropellantPair::NtoMmh, 2.0),
        (PropellantPair::NtoUdmh, 2.6),
    ];
    for (pair, of) in cases {
        let r = solve(&ThermoInput {
            of_ratio: of,
            chamber_pressure_pa: 3.0e6,
            propellant_pair: pair,
            method: ThermoMethod::GibbsFreeEnergy,
            fuel_temp_k: 298.15,
            ox_temp_k: 298.15,
        })
        .unwrap_or_else(|e| panic!("L1 failed for {pair:?}: {e}"));
        assert!(
            (2200.0..=4000.0).contains(&r.tc_k),
            "{pair:?} Tc = {} K",
            r.tc_k
        );
        assert!(r.c_star_m_s > 1500.0, "{pair:?} c* = {}", r.c_star_m_s);
    }
}

#[test]
fn nitrous_propane_is_physical_and_nitrogen_bearing() {
    // N2O / propane, O/F = 7.0, Pc = 3.0 MPa. Published values are roughly
    // Tc ≈ 3200–3400 K with substantial N2 in the products (nitrous carries its
    // own nitrogen, and its decomposition energy keeps the flame hot).
    let r = solve(&ThermoInput {
        of_ratio: 7.0,
        chamber_pressure_pa: 3.0e6,
        propellant_pair: PropellantPair::NitrousPropane,
        method: ThermoMethod::GibbsFreeEnergy,
        fuel_temp_k: 298.15,
        ox_temp_k: 298.15,
    })
    .expect("L1 solve");

    assert!((2900.0..=3500.0).contains(&r.tc_k), "Tc = {} K, expected ~3300", r.tc_k);
    let n2 = r.species_mol.iter().find(|(s, _)| s == "N2").map(|(_, m)| *m).unwrap_or(0.0);
    assert!(n2 > 0.15, "N2O combustion should leave substantial N2, got {n2}");
}

#[test]
fn cea_cross_validation_lox_rp1() {
    // LOX / RP-1, O/F = 2.56, Pc = 6.9 MPa (~1000 psi) — an F-1/RD-170-class point.
    // NASA CEA equilibrium reference is roughly Tc ≈ 3600 K, c* ≈ 1795 m/s,
    // γ ≈ 1.14, MW ≈ 23. We assert we land in that neighbourhood.
    let r = solve(&ThermoInput {
        of_ratio: 2.56,
        chamber_pressure_pa: 6.9e6,
        propellant_pair: PropellantPair::LoxRp1,
        method: ThermoMethod::GibbsFreeEnergy,
        fuel_temp_k: 298.15,
        ox_temp_k: 298.15,
    })
    .expect("L1 solve");
    assert!((3350.0..=3800.0).contains(&r.tc_k), "Tc = {} K (CEA ~3600)", r.tc_k);
    assert!((1700.0..=1900.0).contains(&r.c_star_m_s), "c* = {} m/s (CEA ~1795)", r.c_star_m_s);
    assert!((1.10..=1.22).contains(&r.gamma), "γ = {} (CEA ~1.14)", r.gamma);
    assert!((20.0..=26.0).contains(&r.mean_molecular_weight), "MW = {}", r.mean_molecular_weight);
}

#[test]
fn species_set_covers_major_products() {
    let names: Vec<&str> = thermo::data::SPECIES.iter().map(|s| s.name).collect();
    for n in ["CO2", "CO", "H2O", "H2", "O2", "OH", "H", "O", "N2", "NO", "NO2", "N"] {
        assert!(names.contains(&n), "species set missing {n}");
    }
}

#[test]
fn optimal_of_is_physical() {
    let (of, isp) = thermo::optimal_of(PropellantPair::LoxMethane, 3.0e6);
    assert!((1.0..=4.5).contains(&of), "optimal O/F = {of}");
    assert!(isp > 300.0, "optimal Isp = {isp}");
}
