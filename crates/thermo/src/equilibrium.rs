//! Chemical equilibrium via Gibbs free-energy minimization.
//!
//! Solves the element-conservation + equilibrium system for species mole numbers
//! `n_i` and element Lagrange multipliers `??_j` with a damped Newton???Raphson
//! iteration. The linear system is solved by Gaussian elimination with partial
//! pivoting that returns `Err` on a singular matrix ??? never panics (ARCHITECTURE
//! ??3.4: no hidden `.inverse()` panics).

use crate::data::Species;
use crate::nasa::{g_over_rt, RU};
use crate::{EngineError, EngineResult};

/// Reference pressure for the standard-state Gibbs term (1 atm).
pub const P0: f64 = 101_325.0;

/// Solve the equilibrium composition for element atom moles `b = [C, H, O, N]`
/// at temperature `t` (K) and pressure `p` (Pa).
///
/// Returns the species mole numbers in the same order as `species`.
pub fn equilibrium(
    species: &[Species],
    b: &[f64; 4],
    t: f64,
    p: f64,
) -> EngineResult<Vec<f64>> {
    let s = species.len();
    let e = 4usize;
    let mut n = initial_guess(species, b);

    // ??_i = g??_i/(RT) + ln(P/P??)
    let mu: Vec<f64> = species.iter().map(|sp| g_over_rt(sp, t) + (p / P0).ln()).collect();

    let nvars = s + e;
    let mut x = vec![0.0f64; nvars];
    for i in 0..s {
        x[i] = n[i].max(1e-30).ln();
    }
    // ??_j initialised to zero.
    for j in 0..e {
        x[s + j] = 0.0;
    }

    for iter in 0..200 {
        // Residual, Jacobian, then a backtracking line search.
        let (r, nsum, n, norm) = residual(&x, s, e, species, &mu, b);
        if norm < 1e-9 {
            return Ok(n);
        }

        // Jacobian with variables x = [ln n_i (S), λ_j (E)].
        let mut jac = vec![0.0f64; nvars * nvars];
        for i in 0..s {
            for k in 0..s {
                let val = if i == k { 1.0 } else { 0.0 } - n[k] / nsum;
                jac[i * nvars + k] = val;
            }
            for m in 0..e {
                jac[i * nvars + s + m] = -(species[i].atoms[m] as f64);
            }
        }
        for j in 0..e {
            for k in 0..s {
                jac[(s + j) * nvars + k] = species[k].atoms[j] as f64 * n[k];
            }
            for m in 0..e {
                jac[(s + j) * nvars + s + m] = 0.0;
            }
        }

        // Newton step: J Δ = -r → Δ = -dx, so x <- x - α·dx.
        let dx = solve(&jac, &r).map_err(|_| {
            EngineError::NonConvergence {
                iter,
                residual: norm,
            }
        })?;

        // Backtracking line search (Armijo on the residual norm) so the log-
        // variable step can't overshoot and blow up at low temperature.
        let mut alpha = 1.0f64;
        let mut accepted = false;
        for _ in 0..40 {
            let xn = trial(&x, &dx, alpha, s, e);
            let (_, _, _, nnorm) = residual(&xn, s, e, species, &mu, b);
            if nnorm.is_finite() && nnorm < norm {
                x = xn;
                accepted = true;
                break;
            }
            alpha *= 0.5;
        }
        if !accepted {
            x = trial(&x, &dx, 0.05, s, e);
        }
    }

    for i in 0..s {
        n[i] = x[i].exp();
    }
    Err(EngineError::NonConvergence {
        iter: 200,
        residual: f64::NAN,
    })
}

/// Compute the residual and current composition for a candidate `x`.
#[allow(clippy::too_many_arguments)]
fn residual(
    x: &[f64],
    s: usize,
    e: usize,
    species: &[Species],
    mu: &[f64],
    b: &[f64; 4],
) -> (Vec<f64>, f64, Vec<f64>, f64) {
    let mut n = vec![0.0f64; s];
    let mut nsum = 0.0;
    for i in 0..s {
        n[i] = x[i].exp();
        nsum += n[i];
    }
    let nvars = s + e;
    let mut r = vec![0.0f64; nvars];
    for i in 0..s {
        let mut lam = 0.0;
        for j in 0..e {
            lam += x[s + j] * species[i].atoms[j] as f64;
        }
        r[i] = x[i] - nsum.ln() + mu[i] - lam;
    }
    for j in 0..e {
        let mut sum = 0.0;
        for i in 0..s {
            sum += species[i].atoms[j] as f64 * n[i];
        }
        r[s + j] = sum - b[j];
    }
    let norm = r.iter().map(|v| v * v).sum::<f64>().sqrt();
    (r, nsum, n, norm)
}

/// Trial point `x - α·dx` with the log-species entries clamped to avoid overflow.
fn trial(x: &[f64], dx: &[f64], alpha: f64, s: usize, e: usize) -> Vec<f64> {
    let mut xn = vec![0.0f64; x.len()];
    for i in 0..s {
        xn[i] = (x[i] - alpha * dx[i]).clamp(-700.0, 60.0);
    }
    for j in 0..e {
        xn[s + j] = x[s + j] - alpha * dx[s + j];
    }
    xn
}

/// A crude but robust initial guess: CO2 + CO + H2O + O2 (or leftover) from the
/// element balance, with the remaining species seeded very small.
fn initial_guess(species: &[Species], b: &[f64; 4]) -> Vec<f64> {
    let nc = b[0];
    let nh = b[1];
    let no = b[2];
    let mut n = vec![1e-8f64; species.len()];

    let h2o = (nh / 2.0).min(no);
    let o_after_h2o = (no - nh / 2.0).max(0.0);
    let (co2, co, o2) = if o_after_h2o >= nc {
        (nc, 0.0, o_after_h2o - nc)
    } else {
        (o_after_h2o, nc - o_after_h2o, 0.0)
    };
    let h2 = ((nh - 2.0 * h2o) / 2.0).max(0.0);

    for (i, sp) in species.iter().enumerate() {
        n[i] = match sp.name {
            "H2O" => h2o,
            "CO2" => co2,
            "CO" => co,
            "O2" => o2,
            "H2" => h2,
            _ => 1e-8,
        }
        .max(1e-8);
    }
    n
}

/// Solve `A x = rhs` by Gaussian elimination with partial pivoting. Returns
/// `Err` on a singular (or ill-conditioned) matrix rather than panicking.
fn solve(a: &[f64], rhs: &[f64]) -> Result<Vec<f64>, ()> {
    let n = rhs.len();
    let mut m = a.to_vec();
    let mut b = rhs.to_vec();

    for col in 0..n {
        // Partial pivot.
        let mut piv = col;
        let mut best = m[col * n + col].abs();
        for row in (col + 1)..n {
            let v = m[row * n + col].abs();
            if v > best {
                best = v;
                piv = row;
            }
        }
        if best < 1e-14 {
            return Err(());
        }
        if piv != col {
            for k in 0..n {
                m.swap(col * n + k, piv * n + k);
            }
            b.swap(col, piv);
        }
        let diag = m[col * n + col];
        for row in (col + 1)..n {
            let factor = m[row * n + col] / diag;
            for k in col..n {
                m[row * n + k] -= factor * m[col * n + k];
            }
            b[row] -= factor * b[col];
        }
    }

    // Back substitution.
    let mut x = vec![0.0f64; n];
    for row in (0..n).rev() {
        let mut acc = b[row];
        for k in (row + 1)..n {
            acc -= m[row * n + k] * x[k];
        }
        let diag = m[row * n + row];
        if diag.abs() < 1e-14 {
            return Err(());
        }
        x[row] = acc / diag;
    }
    Ok(x)
}

/// Mixture properties at `t` from species mole numbers.
pub struct MixtureProps {
    pub mean_mw: f64,
    pub gamma: f64,
    pub cp_mix: f64, // J/(mol??K)
}

/// Mean molecular weight, cp, and frozen gamma of the mixture.
pub fn mixture_props(species: &[Species], n: &[f64], t: f64) -> MixtureProps {
    let nsum: f64 = n.iter().sum();
    let mut mw = 0.0;
    let mut cp = 0.0;
    for (i, sp) in species.iter().enumerate() {
        let x = n[i] / nsum;
        mw += x * sp.mw;
        cp += x * crate::nasa::cp_molar(sp, t);
    }
    let gamma = if cp > RU { cp / (cp - RU) } else { 1.0 };
    MixtureProps {
        mean_mw: mw,
        gamma,
        cp_mix: cp,
    }
}

/// Specific gas constant of the mixture, J/(kg·K). `mean_mw` is in g/mol.
pub fn r_specific(mean_mw: f64) -> f64 {
    RU / (mean_mw * 1e-3)
}

/// Characteristic velocity `c*` (m/s) from gas properties.
pub fn c_star(gamma: f64, r_spec: f64, tc: f64) -> f64 {
    let term = (2.0 / (gamma + 1.0)).powf((gamma + 1.0) / (2.0 * (gamma - 1.0)));
    (r_spec * tc / gamma).sqrt() / term
}

