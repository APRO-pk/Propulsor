//! Bell nozzle contour generation (L2).
//!
//! A Rao-style "parabolic bell": a short circular arc at the throat (radius of
//! curvature ≈ 1.5·r_t) for the sonic turnaround, then a parabolic profile to the
//! exit that matches the exit half-angle. This is the standard engineering
//! approximation to the true method-of-characteristics Rao contour, and it yields
//! a smooth `r(x)` table that L3 cooling and the renderer consume.

use engine_core::ContourPoint;

/// Generate a bell contour from throat radius `r_t` to exit radius `r_e`.
/// `theta_e_deg` is the target exit half-angle (e.g. 15° for a bell).
///
/// Uses the Rao parabolic-bell approximation: a parabolic profile
/// `r(x) = r_t + (r_e - r_t)·(x/L)²` that is tangent to the axis at the throat
/// (dr/dx = 0) and matches the exit half-angle at the exit.
pub fn bell_contour(r_t: f64, r_e: f64, theta_e_deg: f64, n: usize) -> Vec<ContourPoint> {
    let dr = r_e - r_t;
    let theta = theta_e_deg.to_radians();
    let l = if dr > 0.0 { 2.0 * dr / theta.tan() } else { 0.0 };
    let n = n.max(2);

    let mut pts = Vec::with_capacity(n);
    for i in 0..n {
        let s = (i as f64) / ((n - 1) as f64); // 0..1
        let x = l * s;
        let r = r_t + dr * s * s;
        pts.push(ContourPoint { x, r });
    }
    pts
}

/// Rao thrust-optimized parabolic (TOP) bell wall angles: the initial parabola
/// angle `θ_n` (just downstream of the throat arc) and the exit angle `θ_e`,
/// interpolated from Rao's charts for an 80%-length bell and adjusted for the
/// chosen length fraction. Returns `(θ_n_deg, θ_e_deg)`.
pub fn rao_angles(area_ratio: f64, length_fraction: f64) -> (f64, f64) {
    // Rao 80%-bell chart: (ε, θ_n, θ_e).
    const RAO80: [(f64, f64, f64); 7] = [
        (4.0, 26.5, 14.0),
        (5.0, 27.5, 13.0),
        (10.0, 30.0, 11.0),
        (20.0, 32.0, 9.8),
        (30.0, 33.5, 9.0),
        (50.0, 34.5, 8.2),
        (100.0, 36.0, 7.3),
    ];
    let eps = area_ratio.clamp(RAO80[0].0, RAO80[RAO80.len() - 1].0);
    let (mut tn, mut te) = (RAO80[0].1, RAO80[0].2);
    for w in RAO80.windows(2) {
        if eps >= w[0].0 && eps <= w[1].0 {
            let f = (eps - w[0].0) / (w[1].0 - w[0].0);
            tn = w[0].1 + f * (w[1].1 - w[0].1);
            te = w[0].2 + f * (w[1].2 - w[0].2);
            break;
        }
    }
    if eps >= RAO80[RAO80.len() - 1].0 {
        tn = RAO80[RAO80.len() - 1].1;
        te = RAO80[RAO80.len() - 1].2;
    }
    // Shorter bells turn harder (higher θ_n) and leave more exit divergence.
    let d = 0.8 - length_fraction.clamp(0.6, 1.0);
    ((tn + 14.0 * d).max(15.0), (te + 22.0 * d).max(2.0))
}

/// Generate a true Rao thrust-optimized parabolic (TOP) bell: a downstream throat
/// arc (radius 0.382·r_t) turning the flow from 0 to `θ_n`, then a quadratic
/// (Bézier) parabola to the exit that leaves at `θ_e`. `length_fraction` is the
/// bell length as a fraction of the equivalent 15° cone (e.g. 0.8 for an 80% bell).
pub fn rao_bell_contour(r_t: f64, r_e: f64, length_fraction: f64, n: usize) -> Vec<ContourPoint> {
    let dr = r_e - r_t;
    if dr <= 0.0 {
        return vec![ContourPoint { x: 0.0, r: r_t }, ContourPoint { x: 0.0, r: r_t }];
    }
    let eps = (r_e / r_t).powi(2);
    let (theta_n, theta_e) = rao_angles(eps, length_fraction);
    let tn = theta_n.to_radians();
    let te = theta_e.to_radians();

    // Downstream throat arc, radius 0.382·r_t, centre (0, r_t + 0.382·r_t).
    let r2 = 0.382 * r_t;
    let n = n.max(12);
    let n_arc = (n / 6).max(6);
    let mut pts = Vec::with_capacity(n);
    for i in 0..n_arc {
        let phi = tn * (i as f64) / (n_arc as f64);
        pts.push(ContourPoint { x: r2 * phi.sin(), r: r_t + r2 * (1.0 - phi.cos()) });
    }
    let nx = r2 * tn.sin();
    let ny = r_t + r2 * (1.0 - tn.cos());

    // Parabola exit point at the length-fraction of the equivalent 15° cone.
    let ex = length_fraction * dr / (15.0_f64).to_radians().tan();
    let ey = r_e;
    // Quadratic Bézier control point = intersection of the θ_n and θ_e tangents.
    let m1 = tn.tan();
    let m2 = te.tan();
    let qx = (ey - ny + m1 * nx - m2 * ex) / (m1 - m2);
    let qy = ny + m1 * (qx - nx);

    // Fill the remaining points on the parabola, last point exactly at the exit.
    let n_par = n - n_arc;
    for i in 0..n_par {
        let t = (i as f64) / ((n_par - 1).max(1) as f64);
        let mt = 1.0 - t;
        let x = mt * mt * nx + 2.0 * mt * t * qx + t * t * ex;
        let r = mt * mt * ny + 2.0 * mt * t * qy + t * t * ey;
        pts.push(ContourPoint { x, r });
    }
    pts
}

/// Conical divergence-loss correction λ = (1 + cos θ)/2 for a half-angle θ.
pub fn conical_divergence_correction(theta_deg: f64) -> f64 {
    (1.0 + theta_deg.to_radians().cos()) / 2.0
}

/// Generate a straight conical nozzle contour from throat to exit at a half-angle.
pub fn conical_contour(r_t: f64, r_e: f64, theta_deg: f64, n: usize) -> Vec<engine_core::ContourPoint> {
    let dr = r_e - r_t;
    let l = if dr > 0.0 { dr / theta_deg.to_radians().tan() } else { 0.0 };
    let n = n.max(2);
    let mut pts = Vec::with_capacity(n);
    for i in 0..n {
        let s = (i as f64) / ((n - 1) as f64);
        pts.push(engine_core::ContourPoint {
            x: l * s,
            r: r_t + dr * s,
        });
    }
    pts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contour_reaches_exit_area() {
        let pts = bell_contour(0.1, 0.4, 15.0, 40);
        let last = pts.last().unwrap();
        assert!((last.r - 0.4).abs() < 1e-6, "exit r = {}", last.r);
        assert!(pts[0].r >= 0.1 - 1e-6, "throat r = {}", pts[0].r);
        // Monotonic increasing radius.
        for w in pts.windows(2) {
            assert!(w[1].r >= w[0].r - 1e-9);
        }
    }

    #[test]
    fn rao_bell_reaches_exit_and_turns_correctly() {
        let pts = rao_bell_contour(0.05, 0.15, 0.8, 60);
        let last = pts.last().unwrap();
        assert!((last.r - 0.15).abs() < 1e-4, "exit r = {}", last.r);
        // Monotonic increasing radius from throat to exit.
        for w in pts.windows(2) {
            assert!(w[1].r >= w[0].r - 1e-6, "not monotonic: {} -> {}", w[0].r, w[1].r);
        }
        // Exit wall angle (last segment) should be shallow (θ_e), well under 15°.
        let dx = last.x - pts[pts.len() - 2].x;
        let drr = last.r - pts[pts.len() - 2].r;
        let exit_deg = (drr / dx).atan().to_degrees();
        assert!(exit_deg < 15.0 && exit_deg > 3.0, "exit angle {exit_deg}");
    }

    #[test]
    fn rao_angles_track_expansion_ratio() {
        let (tn_lo, te_lo) = rao_angles(5.0, 0.8);
        let (tn_hi, te_hi) = rao_angles(80.0, 0.8);
        // Higher ε → steeper initial turn, shallower exit.
        assert!(tn_hi > tn_lo, "θ_n {tn_lo} -> {tn_hi}");
        assert!(te_hi < te_lo, "θ_e {te_lo} -> {te_hi}");
    }

    #[test]
    fn conical_contour_is_straight() {
        let pts = conical_contour(0.1, 0.4, 15.0, 30);
        let last = pts.last().unwrap();
        assert!((last.r - 0.4).abs() < 1e-6, "exit r = {}", last.r);
        // A conical contour is a straight line: slope constant.
        let slope = (pts[1].r - pts[0].r) / (pts[1].x - pts[0].x);
        let slope_last = (last.r - pts[pts.len() - 2].r) / (last.x - pts[pts.len() - 2].x);
        assert!((slope - slope_last).abs() < 1e-6, "not straight: {slope} vs {slope_last}");
    }
}
