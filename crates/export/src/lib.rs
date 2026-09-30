//! Export targets: PDF report, DXF, P&ID, checklists, and geometry (STEP or mesh).
//!
//! The **only** crate that may depend on an external CAD kernel (Truck). It does so
//! through the [`GeometryModeler`] trait with a fail-open polygon-mesh (OBJ/STL)
//! fallback, per ARCHITECTURE §7, so a B-Rep failure never blocks a report.

pub mod report;
pub mod safety;

pub use report::generate_report_pdf;
pub use safety::{pid_svg, safety_checklist};

/// Serialize a nozzle contour `r(x)` table to CSV (`x_m,r_m`).
pub fn contour_csv(points: &[engine_core::ContourPoint]) -> String {
    let mut out = String::from("x_m,r_m\n");
    for p in points {
        out.push_str(&format!("{:.6},{:.6}\n", p.x, p.r));
    }
    out
}

/// Generate a nominal thrust-vs-time burn profile (CSV) for the HexaDOF 6DOF
/// simulator: ramp-up, steady burn, ramp-down. Thrust from the design point.
pub fn thrust_curve_csv(design: &engine_core::EngineDesign, burn_time_s: f64) -> String {
    let thrust = design.operating_point.thrust.as_si();
    let ramp = 0.5;
    let n = 100;
    let dt = burn_time_s / (n as f64);
    let mut out = String::from("t_s,thrust_N\n");
    for i in 0..=n {
        let t = i as f64 * dt;
        let f = if t < ramp {
            thrust * (t / ramp)
        } else if t > burn_time_s - ramp {
            thrust * ((burn_time_s - t) / ramp)
        } else {
            thrust
        };
        out.push_str(&format!("{t:.4},{f:.2}\n"));
    }
    out
}

/// Target format for a geometry export.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeometryFormat {
    /// Precise B-Rep via the Truck kernel (preferred for downstream CAD).
    Step,
    /// Fail-open polygon mesh, always works.
    Obj,
    Stl,
}

/// Abstraction isolating the CAD kernel from the solver crates.
pub trait GeometryModeler {
    /// Export the design's geometry. `precise` should be attempted first;
    /// the trait impl owns the Truck call and the mesh fallback.
    fn export_geometry(&self, design: &engine_core::EngineDesign, format: GeometryFormat) -> Result<Vec<u8>, simulate::SolveError>;
}

/// Report/checklist generation is stubbed until the corresponding tiers land;
/// this crate's real implementation is scaffolded in M4/M5.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReportManifest {
    pub title: String,
    pub sections: Vec<String>,
}
