//! Distributed (FEM-like) wall-stress field along the contour.
//!
//! Where L4 reports a single closed-form chamber stress, this discretizes the
//! wall into axial stations and evaluates the thick-wall (Lamé) hoop stress plus
//! the through-wall thermal stress at each one, yielding a stress profile the 3D
//! view can colour-map and export as FEM boundary data.

/// Per-station wall loading (from L2 pressure + L3 wall temperature).
#[derive(Debug, Clone)]
pub struct StressStationInput {
    pub x: f64,
    pub r_inner_m: f64,
    pub wall_thickness_m: f64,
    pub gas_pressure_pa: f64,
    /// Hot-gas-side wall temperature, K.
    pub wall_temp_hot_k: f64,
    /// Coolant-side wall temperature, K.
    pub wall_temp_cold_k: f64,
}

/// Material elastic/allowable properties.
#[derive(Debug, Clone)]
pub struct StressMaterial {
    pub youngs_modulus_pa: f64,
    pub alpha_per_k: f64,
    pub poisson: f64,
    pub allowable_stress_pa: f64,
}

/// Resolved stress at one station.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StressStation {
    pub x: f64,
    pub r: f64,
    pub hoop_stress_pa: f64,
    pub thermal_stress_pa: f64,
    pub combined_stress_pa: f64,
    pub margin: f64,
}

/// Distributed-stress result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StressField {
    pub stations: Vec<StressStation>,
    pub max_combined_stress_pa: f64,
    pub min_margin: f64,
    pub yields: bool,
}

impl StressField {
    pub fn summary(&self) -> String {
        format!(
            "peak σ={:.0} MPa | min margin={:.2} | {}",
            self.max_combined_stress_pa / 1e6,
            self.min_margin,
            if self.yields { "YIELDS" } else { "OK" },
        )
    }

    /// CSV of the stress field for FEM/report import.
    pub fn to_csv(&self) -> String {
        let mut s = String::from("x_m,r_m,hoop_pa,thermal_pa,combined_pa,margin\n");
        for st in &self.stations {
            s.push_str(&format!(
                "{:.6},{:.6},{:.1},{:.1},{:.1},{:.3}\n",
                st.x, st.r, st.hoop_stress_pa, st.thermal_stress_pa, st.combined_stress_pa, st.margin,
            ));
        }
        s
    }
}

/// Evaluate the distributed stress field over a set of wall stations.
pub fn solve_stress_field(stations: &[StressStationInput], mat: &StressMaterial) -> StressField {
    let mut out = Vec::with_capacity(stations.len());
    let mut max_combined = 0.0_f64;
    let mut min_margin = f64::INFINITY;

    for s in stations {
        let ri = s.r_inner_m.max(1e-4);
        let ro = ri + s.wall_thickness_m.max(1e-5);
        let p = s.gas_pressure_pa.max(0.0);
        // Lamé thick-wall hoop stress at the inner surface (external pressure ≈ 0).
        let hoop = p * (ro * ro + ri * ri) / (ro * ro - ri * ri);
        // Through-wall thermal stress (constrained-plate estimate).
        let dt = (s.wall_temp_hot_k - s.wall_temp_cold_k).max(0.0);
        let thermal = mat.youngs_modulus_pa * mat.alpha_per_k * dt / (2.0 * (1.0 - mat.poisson));
        let combined = hoop + thermal;
        let margin = mat.allowable_stress_pa / combined.max(1.0);

        max_combined = max_combined.max(combined);
        min_margin = min_margin.min(margin);
        out.push(StressStation { x: s.x, r: ri, hoop_stress_pa: hoop, thermal_stress_pa: thermal, combined_stress_pa: combined, margin });
    }

    StressField {
        stations: out,
        max_combined_stress_pa: max_combined,
        min_margin: if min_margin.is_finite() { min_margin } else { 0.0 },
        yields: min_margin < 1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mat() -> StressMaterial {
        StressMaterial { youngs_modulus_pa: 117e9, alpha_per_k: 17e-6, poisson: 0.33, allowable_stress_pa: 200e6 }
    }

    #[test]
    fn stress_peaks_where_pressure_and_heat_peak() {
        let stations = vec![
            StressStationInput { x: 0.0, r_inner_m: 0.045, wall_thickness_m: 0.0016, gas_pressure_pa: 2.0e6, wall_temp_hot_k: 900.0, wall_temp_cold_k: 400.0 },
            StressStationInput { x: 0.1, r_inner_m: 0.015, wall_thickness_m: 0.0016, gas_pressure_pa: 1.1e6, wall_temp_hot_k: 950.0, wall_temp_cold_k: 400.0 },
        ];
        let f = solve_stress_field(&stations, &mat());
        assert_eq!(f.stations.len(), 2);
        assert!(f.max_combined_stress_pa > 0.0);
        assert!(f.min_margin > 0.0 && f.min_margin.is_finite());
        assert!(f.to_csv().contains("combined_pa"));
    }

    #[test]
    fn thinner_wall_raises_stress() {
        let s = |t: f64| vec![StressStationInput { x: 0.0, r_inner_m: 0.05, wall_thickness_m: t, gas_pressure_pa: 3.0e6, wall_temp_hot_k: 800.0, wall_temp_cold_k: 400.0 }];
        let thick = solve_stress_field(&s(0.003), &mat());
        let thin = solve_stress_field(&s(0.001), &mat());
        assert!(thin.max_combined_stress_pa > thick.max_combined_stress_pa);
    }
}
