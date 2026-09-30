//! Evaluation of the NASA 7-coefficient polynomials (Gordon–McBride form).
//!
//! For a species at temperature T (K), with coefficients a1..a7 and integration
//! constants b1, b2:
//! ```text
//! cp°/R = a1 T^-2 + a2 T^-1 + a3 + a4 T + a5 T^2 + a6 T^3 + a7 T^4
//! h°/(RT) = -a1 T^-2 + a2 T^-1 lnT + a3 + a4 T/2 + a5 T^2/3 + a6 T^3/4 + a7 T^4/5 + b1/T
//! s°/R  = -a1 T^-2/2 - a2 T^-1 + a3 lnT + a4 T + a5 T^2/2 + a6 T^3/3 + a7 T^4/4 + b2
//! ```

use crate::data::{fit_for, Species};

pub const RU: f64 = 8.314462618; // J/(mol·K)

pub fn cp_over_r(sp: &Species, t: f64) -> f64 {
    let a = fit_for(sp, t).a;
    a[0] * t.powi(-2) + a[1] / t + a[2] + a[3] * t + a[4] * t.powi(2) + a[5] * t.powi(3) + a[6] * t.powi(4)
}

pub fn h_over_rt(sp: &Species, t: f64) -> f64 {
    let f = fit_for(sp, t);
    let a = f.a;
    let b1 = f.b[0];
    -a[0] * t.powi(-2) + a[1] * t.ln() / t + a[2] + a[3] * t / 2.0 + a[4] * t.powi(2) / 3.0
        + a[5] * t.powi(3) / 4.0 + a[6] * t.powi(4) / 5.0 + b1 / t
}

pub fn s_over_r(sp: &Species, t: f64) -> f64 {
    let f = fit_for(sp, t);
    let a = f.a;
    let b2 = f.b[1];
    -a[0] * t.powi(-2) / 2.0 - a[1] / t + a[2] * t.ln() + a[3] * t + a[4] * t.powi(2) / 2.0
        + a[5] * t.powi(3) / 3.0 + a[6] * t.powi(4) / 4.0 + b2
}

/// Dimensionless Gibbs free energy g°/(RT) = h°/(RT) - s°/R.
pub fn g_over_rt(sp: &Species, t: f64) -> f64 {
    h_over_rt(sp, t) - s_over_r(sp, t)
}

/// Molar heat capacity, J/(mol·K).
pub fn cp_molar(sp: &Species, t: f64) -> f64 {
    cp_over_r(sp, t) * RU
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::species_by_name;

    #[test]
    fn n2_cp_at_298() {
        let n2 = species_by_name("N2").unwrap();
        // cp°(N2, 298 K) ≈ 29.12 J/(mol·K) → cp/R ≈ 3.50.
        let cp = cp_molar(n2, 298.15);
        assert!((cp - 29.12).abs() < 0.2, "cp = {cp}");
    }

    #[test]
    fn h2o_enthalpy_includes_formation() {
        let h2o = species_by_name("H2O").unwrap();
        // h°(298.15)/RT for H2O; ΔH°f(H2O,g) = -241826 J/mol → h/RT ≈ -241826/R/298.15.
        let h_rt = h_over_rt(h2o, 298.15);
        let expected = -241826.0 / (RU * 298.15);
        assert!((h_rt - expected).abs() / expected.abs() < 0.02, "h/RT = {h_rt}, expected {expected}");
    }
}
