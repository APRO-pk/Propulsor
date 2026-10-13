//! Computed combustion (c*) efficiency from propellant vaporization — the
//! Priem–Heidmann generalized-length model.
//!
//! Sources:
//! * **Priem & Heidmann, NASA TR R-67 (1960)** — vaporization-limited
//!   combustion; percent of each propellant vaporized correlates with a
//!   generalized chamber length L_gen.
//! * **NASA CR-168066 (Fang, Aerojet 1983), §V.A Eq. 1 and Fig. 26** — the
//!   SI form of L_gen and the L_gen → percent-vaporized curve (digitized below).
//!   The program listing (App. C) confirms the exact form: the property and
//!   drop-size groups *divide* L_gen and the velocity reference is 100 ft/s.
//! * **Heidmann & Priem, NACA TN 4219 (1958)**, as written in NASA TM X-52244
//!   App. A — c* efficiency of a partly vaporized spray: only vaporized
//!   propellant burns, at the vaporized mixture ratio.
//! * **Pavli, NASA TM-79319 (1979)** — LOX/RP-1/JP-10 at 4.1 MPa: triplet
//!   injectors matched this vaporization model within ~½ % (98.9–100 %
//!   measured); the like-on-like doublet measured 96.6–98.4 % of its prediction
//!   (mixing-limited). Table III's predicted values are reproduced by the tests
//!   below, and anchor the mixing-efficiency defaults.
//!
//! Valid for vaporization-limited combustion only; hypergols are excluded (see
//! [`crate::liquids::vaporization_model_applies`]).
//!
//! ```text
//! L_gen = (L_c/CR^0.44 + 0.833·L_N/(CR^0.22·S^0.33)) · (Pc/2068 kPa)^0.66 / (K_P·K_J)
//! K_P   = (1 − T/T_c)^0.4 · (H_v/325.6 kJ/kg)^0.8 · (M/100)^0.35
//! K_J   = (r_m/76.2 µm)^1.45 · (V/30.48 m/s)^0.75
//! S     = (1 + 1/√CR + 1/CR)/3                       (lengths in cm)
//! η_vap = c*(MR_v)/c*(MR) · (f_o·MR + f_f)/(MR + 1),   MR_v = MR·f_o/f_f
//! ```

use crate::liquids::{Liquid, Phase};

/// CR-168066 Fig. 26: (generalized length cm, probit z of fraction vaporized).
/// Digitized from the scanned figure on its log × normal-probability grid.
const VAPORIZATION_CURVE: [(f64, f64); 22] = [
    (0.05, -2.7307),
    (0.1, -2.3575),
    (0.15, -2.1294),
    (0.25, -1.8719),
    (0.5, -1.5167),
    (0.75, -1.2959),
    (1.0, -1.1527),
    (1.5, -0.9307),
    (2.5, -0.6200),
    (3.5, -0.4157),
    (5.0, -0.1938),
    (7.5, 0.0670),
    (10.0, 0.2723),
    (15.0, 0.5421),
    (20.0, 0.7651),
    (25.0, 0.9338),
    (35.0, 1.2290),
    (50.0, 1.5665),
    (75.0, 1.9905),
    (100.0, 2.3167),
    (150.0, 2.8845),
    (250.0, 3.6727),
];

/// Standard normal CDF (Abramowitz & Stegun 7.1.26 erf, |error| < 1.5e-7).
fn normal_cdf(z: f64) -> f64 {
    let x = z.abs() / std::f64::consts::SQRT_2;
    let t = 1.0 / (1.0 + 0.3275911 * x);
    let poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    let erf = 1.0 - poly * (-x * x).exp();
    0.5 * (1.0 + if z >= 0.0 { erf } else { -erf })
}

/// Fraction of a propellant vaporized at generalized length `l_gen_cm`
/// (Fig. 26; log-probit interpolation, end segments extrapolated as the
/// figure's dashed lines do).
pub fn fraction_vaporized(l_gen_cm: f64) -> f64 {
    let c = &VAPORIZATION_CURVE;
    let x = l_gen_cm.max(1e-6).ln();
    let seg = c.windows(2).position(|w| x <= w[1].0.ln()).unwrap_or(c.len() - 2);
    let (a, b) = (c[seg], c[seg + 1]);
    let z = a.1 + (b.1 - a.1) * (x - a.0.ln()) / (b.0.ln() - a.0.ln());
    normal_cdf(z.clamp(-6.0, 6.0))
}

/// One propellant side for the vaporization model.
#[derive(Debug, Clone)]
pub struct VaporizationSide {
    pub liquid: Liquid,
    pub phase: Phase,
    /// Mass-median drop radius from the injector model, µm.
    pub drop_radius_um: f64,
    pub injection_velocity_m_s: f64,
}

/// ERE inputs.
#[derive(Debug, Clone)]
pub struct EreInput {
    pub chamber_pressure_pa: f64,
    /// Chamber-to-throat area ratio.
    pub contraction_ratio: f64,
    /// Length of the straight (cylindrical) chamber section, m.
    pub cylinder_length_m: f64,
    /// Length of the converging section, m.
    pub convergent_length_m: f64,
    /// Oxidizer/fuel mass ratio.
    pub mixture_ratio: f64,
    pub ox: VaporizationSide,
    pub fuel: VaporizationSide,
    /// Mixing efficiency (stream-tube mixture-ratio maldistribution loss).
    /// A design input — see [`default_mixing_efficiency`].
    pub mixing_efficiency: f64,
    /// Why the vaporization model does not apply to this design, if it doesn't.
    pub not_applicable: Option<String>,
}

/// Default mixing efficiency by element type, anchored to Pavli (NASA
/// TM-79319 Table III): unlike-impinging triplets matched the vaporization
/// prediction (η_mix ≈ 1); the like-on-like doublet (No. 251, RP-1) measured
/// 0.966–0.984 of its prediction, mean ≈ 0.97.
pub fn default_mixing_efficiency(element: crate::flow::ElementType) -> f64 {
    match element {
        crate::flow::ElementType::LikeDoublet => 0.97,
        _ => 1.0,
    }
}

/// Vaporization of one propellant.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SideVaporization {
    pub propellant: String,
    pub phase: Phase,
    pub drop_radius_um: f64,
    /// Priem–Heidmann generalized length, cm (∞ shown as 0 for a gas side).
    pub generalized_length_cm: f64,
    pub fraction_vaporized: f64,
}

/// ERE breakdown.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EreResult {
    /// False when the vaporization model does not apply (e.g. hypergols); the
    /// efficiencies are then not a prediction and must not be applied.
    pub applicable: bool,
    pub ox: SideVaporization,
    pub fuel: SideVaporization,
    /// Mixture ratio of the vaporized (burning) propellant.
    pub vaporized_mixture_ratio: f64,
    /// η from incomplete vaporization (Heidmann–Priem).
    pub vaporization_efficiency: f64,
    /// η from mixing (design input).
    pub mixing_efficiency: f64,
    /// Energy-release efficiency = η_vap · η_mix.
    pub energy_release_efficiency: f64,
    /// Derived c* efficiency (= ERE), the factor the L2 nozzle model consumes.
    pub c_star_efficiency: f64,
    pub flags: Vec<String>,
    pub summary: String,
}

/// Priem–Heidmann generalized length (cm) for one liquid propellant.
pub fn generalized_length_cm(input: &EreInput, side: &VaporizationSide) -> f64 {
    let cr = input.contraction_ratio.max(1.0);
    let s = (1.0 + 1.0 / cr.sqrt() + 1.0 / cr) / 3.0;
    let l_eff_cm = input.cylinder_length_m.max(0.0) * 100.0 / cr.powf(0.44)
        + 0.833 * input.convergent_length_m.max(0.0) * 100.0 / (cr.powf(0.22) * s.powf(0.33));
    let l = &side.liquid;
    let t_r = (l.injection_temp_k / l.critical_temp_k).min(0.99);
    let k_p = (1.0 - t_r).powf(0.4)
        * (l.heat_of_vaporization_j_kg / 325.64e3).powf(0.8)
        * (l.molecular_weight / 100.0).powf(0.35);
    let k_j = (side.drop_radius_um.max(0.1) / 76.2).powf(1.45) * (side.injection_velocity_m_s.max(0.5) / 30.48).powf(0.75);
    l_eff_cm * (input.chamber_pressure_pa / 2068.4e3).powf(0.66) / (k_p * k_j)
}

fn side_vaporization(input: &EreInput, side: &VaporizationSide, flags: &mut Vec<String>) -> SideVaporization {
    let (l_gen, f) = match side.phase {
        Phase::Gas => (0.0, 1.0),
        Phase::Liquid => {
            let l_gen = generalized_length_cm(input, side);
            let t_r = side.liquid.injection_temp_k / side.liquid.critical_temp_k;
            if t_r > 0.9 {
                flags.push(format!(
                    "{} injected near-critical (T/Tc = {:.2}): flash vaporization, Priem–Heidmann droplet model is outside its data",
                    side.liquid.name, t_r
                ));
            }
            // Past the top of Fig. 26 (250 cm) vaporization is already ≥ 99.99 %, so
            // only the low end is a meaningful extrapolation.
            if l_gen < 0.05 {
                flags.push(format!(
                    "{} L_gen = {:.3} cm is below the Fig. 26 data (0.05 cm); value extrapolated",
                    side.liquid.name, l_gen
                ));
            }
            (l_gen, fraction_vaporized(l_gen))
        }
    };
    SideVaporization {
        propellant: side.liquid.name.to_string(),
        phase: side.phase,
        drop_radius_um: if side.phase == Phase::Liquid { side.drop_radius_um } else { 0.0 },
        generalized_length_cm: l_gen,
        fraction_vaporized: f,
    }
}

/// Compute the energy-release (and hence c*) efficiency. `c_star_at(MR)`
/// returns the theoretical c* at a mixture ratio (the caller's equilibrium
/// solver); `None` falls back to the mass-fraction term alone.
pub fn energy_release_efficiency(input: &EreInput, c_star_at: impl Fn(f64) -> Option<f64>) -> EreResult {
    let mut flags = Vec::new();
    if let Some(reason) = &input.not_applicable {
        flags.push(format!("combustion efficiency not computed: {reason}"));
    }
    let ox = side_vaporization(input, &input.ox, &mut flags);
    let fuel = side_vaporization(input, &input.fuel, &mut flags);

    let mr = input.mixture_ratio.max(1e-3);
    let (f_o, f_f) = (ox.fraction_vaporized.max(1e-6), fuel.fraction_vaporized.max(1e-6));
    let mr_v = (mr * f_o / f_f).clamp(mr / 20.0, mr * 20.0);
    let mass_term = (f_o * mr + f_f) / (mr + 1.0);
    let c_star_ratio = match (c_star_at(mr_v), c_star_at(mr)) {
        (Some(v), Some(n)) if n > 0.0 => v / n,
        _ => {
            flags.push(format!("c* unavailable at vaporized MR {mr_v:.2}; mass-fraction term only"));
            1.0
        }
    };
    let vaporization = (c_star_ratio * mass_term).clamp(0.0, 1.0);
    let mixing = input.mixing_efficiency.clamp(0.5, 1.0);
    let ere = (vaporization * mixing).clamp(0.3, 1.0);

    let summary = if input.not_applicable.is_some() {
        "ERE not computed (vaporization model does not apply)".to_string()
    } else { format!(
        "ERE={:.1}% (η_vap={:.1}% η_mix={:.1}%) | vaporized ox {:.1}% fuel {:.1}%, MR_v={:.2}",
        ere * 100.0,
        vaporization * 100.0,
        mixing * 100.0,
        f_o * 100.0,
        f_f * 100.0,
        mr_v,
    ) };
    EreResult {
        applicable: input.not_applicable.is_none(),
        ox,
        fuel,
        vaporized_mixture_ratio: mr_v,
        vaporization_efficiency: vaporization,
        mixing_efficiency: mixing,
        energy_release_efficiency: ere,
        c_star_efficiency: ere,
        flags,
        summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow::{mass_median_radius_um, SprayFamily};
    use crate::liquids::{LOX, RP1};

    #[test]
    fn curve_reproduces_fig26_points() {
        let near = |l: f64, pct: f64| (fraction_vaporized(l) * 100.0 - pct).abs() < 0.6;
        assert!(near(1.0, 12.45));
        assert!(near(10.0, 60.7));
        assert!(near(50.0, 94.1));
        assert!((fraction_vaporized(100.0) - 0.9897).abs() < 0.002);
        // Monotonic, bounded, and extrapolates sanely past both ends.
        let mut prev = 0.0;
        for k in 0..60 {
            let f = fraction_vaporized(0.01 * 1.25f64.powi(k));
            assert!(f >= prev && (0.0..=1.0).contains(&f));
            prev = f;
        }
        assert!(fraction_vaporized(1000.0) > 0.9999);
    }

    /// Pavli NASA TM-79319 hardware (Tables I & III): LOX/RP-1, Pc = 4137 kPa,
    /// O/F = 2.7, 6.60 cm throat, 13.69 cm chamber (CR = 4.30), injector-to-
    /// throat length treated as cylinder. Flow from an assumed theoretical
    /// c* ≈ 1774 m/s; orifice velocities from continuity through the listed holes.
    fn pavli(family: SprayFamily, ox_holes: f64, d_ox_mm: f64, fuel_holes: f64, d_fu_mm: f64, length_cm: f64) -> EreInput {
        let pc = 4.137e6;
        let mdot = pc * std::f64::consts::PI / 4.0 * 0.066f64.powi(2) / 1774.0;
        let mr = 2.7;
        let side = |liq: Liquid, flow: f64, n: f64, d_mm: f64| {
            let d = d_mm * 1e-3;
            let v = flow / n / (liq.density_kg_m3 * std::f64::consts::PI / 4.0 * d * d);
            VaporizationSide { liquid: liq, phase: Phase::Liquid, drop_radius_um: mass_median_radius_um(family, d, &liq), injection_velocity_m_s: v }
        };
        EreInput {
            chamber_pressure_pa: pc,
            contraction_ratio: (13.69f64 / 6.60).powi(2),
            cylinder_length_m: length_cm / 100.0,
            convergent_length_m: 0.0,
            mixture_ratio: mr,
            ox: side(LOX, mdot * mr / (1.0 + mr), ox_holes, d_ox_mm),
            fuel: side(RP1, mdot / (1.0 + mr), fuel_holes, d_fu_mm),
            mixing_efficiency: 1.0,
            not_applicable: None,
        }
    }

    /// Reproduce Pavli's Table III *predicted* c* efficiencies (his own
    /// Priem–Heidmann calculation) and stay within his measured values.
    /// Constant c* isolates the vaporization mass term, which is what dominates
    /// for these nearly fully vaporized sprays.
    #[test]
    fn reproduces_pavli_table_iii() {
        // (injector, family, ox holes, Ø ox mm, fuel holes, Ø fuel mm, L cm, measured %, Pavli predicted %)
        let cases = [
            ("250-2", SprayFamily::Triplet, 74.0, 1.55, 37.0, 1.40, 40.82, Some(99.9), 99.55),
            ("250-2", SprayFamily::Triplet, 74.0, 1.55, 37.0, 1.40, 43.36, Some(99.4), 99.66),
            ("250-A-2", SprayFamily::Triplet, 74.0, 1.70, 37.0, 1.57, 36.37, Some(100.0), 99.51),
            ("250-B-2", SprayFamily::Triplet, 74.0, 1.85, 37.0, 1.70, 24.94, Some(99.1), 98.90),
            ("250-B-2", SprayFamily::Triplet, 74.0, 1.85, 37.0, 1.70, 31.93, Some(100.4), 99.37),
            ("251-1", SprayFamily::ImpingingJets, 72.0, 1.57, 75.0, 1.02, 40.82, Some(93.4), 95.84),
            ("251-1", SprayFamily::ImpingingJets, 72.0, 1.57, 75.0, 1.02, 56.59, Some(94.3), 97.65),
            ("251-B-1", SprayFamily::ImpingingJets, 72.0, 1.85, 75.0, 1.19, 36.37, Some(93.9), 95.46),
        ];
        for (name, fam, no, dox, nf, dfu, l, measured, predicted) in cases {
            let r = energy_release_efficiency(&pavli(fam, no, dox, nf, dfu, l), |_| Some(1774.0));
            let ours = r.vaporization_efficiency * 100.0;
            let tol = if fam == SprayFamily::Triplet { 0.3 } else { 1.0 };
            assert!((ours - predicted).abs() < tol, "{name} @ {l} cm: ours {ours:.2} vs Pavli predicted {predicted}");
            // Triplets were vaporization-limited: prediction ≈ measurement.
            if let (SprayFamily::Triplet, Some(m)) = (fam, measured) {
                assert!((ours - m).abs() < 1.6, "{name} @ {l} cm: ours {ours:.2} vs measured {m}");
            }
            // The like doublet with its default mixing efficiency lands near the data.
            if let (SprayFamily::ImpingingJets, Some(m)) = (fam, measured) {
                let with_mix = ours * default_mixing_efficiency(crate::flow::ElementType::LikeDoublet);
                assert!((with_mix - m).abs() < 1.5, "{name} @ {l} cm: ours×η_mix {with_mix:.2} vs measured {m}");
            }
        }
    }

    fn pavli_triplet(length_cm: f64) -> EreInput {
        pavli(SprayFamily::Triplet, 74.0, 1.85, 37.0, 1.70, length_cm)
    }

    #[test]
    fn coarser_spray_and_shorter_chamber_lose_efficiency() {
        let trip = energy_release_efficiency(&pavli_triplet(25.0), |_| Some(1774.0));
        let doub = energy_release_efficiency(&pavli(SprayFamily::ImpingingJets, 74.0, 1.85, 37.0, 1.70, 25.0), |_| Some(1774.0));
        assert!(doub.fuel.drop_radius_um > trip.fuel.drop_radius_um);
        assert!(doub.vaporization_efficiency < trip.vaporization_efficiency);
        let short = energy_release_efficiency(&pavli_triplet(8.0), |_| Some(1774.0));
        assert!(short.vaporization_efficiency < trip.vaporization_efficiency);
    }

    #[test]
    fn higher_pressure_vaporizes_more() {
        let lo = energy_release_efficiency(&EreInput { chamber_pressure_pa: 1.0e6, ..pavli_triplet(15.0) }, |_| None);
        let hi = energy_release_efficiency(&EreInput { chamber_pressure_pa: 8.0e6, ..pavli_triplet(15.0) }, |_| None);
        assert!(hi.fuel.fraction_vaporized > lo.fuel.fraction_vaporized);
    }

    #[test]
    fn gas_injection_is_fully_vaporized_and_mixing_multiplies() {
        let mut i = pavli_triplet(25.0);
        i.ox.phase = Phase::Gas;
        i.fuel.phase = Phase::Gas;
        i.mixing_efficiency = 0.95;
        let r = energy_release_efficiency(&i, |_| Some(1774.0));
        assert_eq!(r.vaporization_efficiency, 1.0);
        assert!((r.c_star_efficiency - 0.95).abs() < 1e-12);
    }

    #[test]
    fn unburned_fuel_shifts_the_burning_mixture_ratio() {
        let r = energy_release_efficiency(&pavli_triplet(5.0), |_| Some(1774.0));
        assert!(r.vaporized_mixture_ratio > 2.7);
    }

    #[test]
    fn not_applicable_is_reported() {
        let r = energy_release_efficiency(&EreInput { not_applicable: Some("hypergolic".into()), ..pavli_triplet(25.0) }, |_| None);
        assert!(!r.applicable);
        assert!(r.flags.iter().any(|f| f.contains("hypergolic")));
    }
}
