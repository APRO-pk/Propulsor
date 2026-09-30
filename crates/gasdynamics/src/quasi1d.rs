//! Quasi-1D isentropic nozzle flow (L2).
//!
//! Exact constant-γ relations between area ratio, Mach number, pressure and
//! temperature. Used to size the nozzle and to compute exit conditions from the
//! expansion ratio.

/// Area ratio A/A* for a given Mach number (constant γ).
pub fn area_ratio_from_mach(m: f64, gamma: f64) -> f64 {
    let k = (1.0 + (gamma - 1.0) / 2.0 * m * m) * 2.0 / (gamma + 1.0);
    (1.0 / m) * k.powf((gamma + 1.0) / (2.0 * (gamma - 1.0)))
}

/// Supersonic Mach number for a given area ratio A/A* > 1 (constant γ).
/// Solved by bisection on the supersonic branch.
pub fn mach_from_area(area_ratio: f64, gamma: f64) -> f64 {
    // For a large area ratio, M grows; find an upper bound.
    let mut hi = 2.0;
    while area_ratio_from_mach(hi, gamma) < area_ratio && hi < 100.0 {
        hi *= 2.0;
    }
    let mut lo = 1.0;
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if area_ratio_from_mach(mid, gamma) < area_ratio {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

/// Pressure ratio P/Pc for a given Mach number (constant γ).
pub fn pressure_ratio(m: f64, gamma: f64) -> f64 {
    (1.0 + (gamma - 1.0) / 2.0 * m * m).powf(-gamma / (gamma - 1.0))
}

/// Temperature ratio T/Tc for a given Mach number (constant γ).
pub fn temperature_ratio(m: f64, gamma: f64) -> f64 {
    1.0 / (1.0 + (gamma - 1.0) / 2.0 * m * m)
}

/// Isentropic expansion from chamber pressure Pc to an ambient/back pressure Pa.
/// Returns the Mach number (supersonic) and the area ratio A/A*.
pub fn expand_to_pressure(pc: f64, pa: f64, gamma: f64) -> (f64, f64) {
    let m2 = ((pc / pa).powf((gamma - 1.0) / gamma) - 1.0) * 2.0 / (gamma - 1.0);
    let m = m2.sqrt();
    (m, area_ratio_from_mach(m, gamma))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn area_mach_round_trip() {
        let g = 1.2;
        let m = 2.5;
        let a = area_ratio_from_mach(m, g);
        let m2 = mach_from_area(a, g);
        assert!((m - m2).abs() < 1e-6, "{m} vs {m2}");
    }

    #[test]
    fn throat_is_sonic() {
        // A/A* = 1 must give M = 1.
        assert!((mach_from_area(1.0, 1.2) - 1.0).abs() < 1e-6);
    }
}
