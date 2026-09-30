//! Multi-material additive-manufacturing build plan with functionally-graded
//! (FGM) transitions.
//!
//! Real bimetallic thrust chambers (e.g. a GRCop/copper regen liner blended into
//! an Inconel jacket, or a refractory radiation skirt) are printed as a single
//! part with the composition graded across a transition band so there is no sharp
//! bond line. This turns the engine's per-region material assignment into a
//! concrete AM process spec: which process and parameters build each axial region,
//! and how the composition is ramped through each dissimilar-material boundary.

use crate::materials::{CoolingClass, Material};

/// AM process parameters for one material.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AmProcess {
    pub process: String,
    pub layer_thickness_um: f64,
    pub laser_power_w: f64,
    pub hatch_spacing_um: f64,
    pub note: String,
}

/// Choose an AM process and parameters for a material from its class and
/// conductivity (copper reflects, so it needs a green/high-power laser; refractory
/// alloys need inert atmosphere and preheat; carbon-carbon is not printed).
pub fn am_process(m: &Material) -> AmProcess {
    let name = m.name.to_lowercase();
    if name.contains("carbon") && m.cooling_class == CoolingClass::Radiation {
        return AmProcess {
            process: "CVI/CVD layup (not AM)".into(),
            layer_thickness_um: 0.0,
            laser_power_w: 0.0,
            hatch_spacing_um: 0.0,
            note: "carbon-carbon is woven and densified, not printed; bonded as an insert".into(),
        };
    }
    if m.thermal_conductivity_w_m_k > 150.0 {
        // High-conductivity copper alloy liner.
        AmProcess {
            process: "LPBF (green laser)".into(),
            layer_thickness_um: 30.0,
            laser_power_w: 400.0,
            hatch_spacing_um: 100.0,
            note: "reflective Cu needs a green/high-power laser and low layer height".into(),
        }
    } else if m.max_service_temp_k > 1600.0 || name.contains("niob") || name.contains("c103") || name.contains("refract") {
        AmProcess {
            process: "LPBF (inert, preheat)".into(),
            layer_thickness_um: 30.0,
            laser_power_w: 300.0,
            hatch_spacing_um: 90.0,
            note: "refractory alloy: inert chamber and substrate preheat to limit cracking".into(),
        }
    } else {
        // Nickel superalloy / stainless jacket.
        AmProcess {
            process: "LPBF".into(),
            layer_thickness_um: 40.0,
            laser_power_w: 285.0,
            hatch_spacing_um: 110.0,
            note: "standard powder-bed parameters".into(),
        }
    }
}

/// One axial build region.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrintRegion {
    pub name: String,
    pub x_start_m: f64,
    pub x_end_m: f64,
    pub material: String,
    pub process: String,
    pub layer_thickness_um: f64,
    pub laser_power_w: f64,
    pub hatch_spacing_um: f64,
    pub high_precision: bool,
    pub build_note: String,
}

/// A functionally-graded composition ramp between two dissimilar materials.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GradientTransition {
    pub from_material: String,
    pub to_material: String,
    pub x_center_m: f64,
    pub blend_length_mm: f64,
    pub layers: u32,
    /// Fraction of the downstream material at each graded layer (0→1).
    pub composition_steps: Vec<f64>,
    pub note: String,
}

/// The complete build plan.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrintPlan {
    pub regions: Vec<PrintRegion>,
    pub transitions: Vec<GradientTransition>,
    pub total_length_m: f64,
    pub estimated_layers: u32,
    pub build_direction: String,
    pub summary: String,
}

/// A region request: axial extent, material, and whether it is a precision region
/// (throat) that gets a finer layer height and contour compensation.
pub struct RegionSpec {
    pub name: String,
    pub x_start_m: f64,
    pub x_end_m: f64,
    pub material: Material,
    pub high_precision: bool,
}

/// Assemble the print plan from ordered axial regions, inserting a graded
/// transition wherever two adjacent regions use different materials.
pub fn build_print_plan(specs: &[RegionSpec]) -> PrintPlan {
    let mut regions = Vec::with_capacity(specs.len());
    let mut transitions = Vec::new();
    let mut layers_f = 0.0f64;

    for (i, s) in specs.iter().enumerate() {
        let mut p = am_process(&s.material);
        if s.high_precision && p.layer_thickness_um > 0.0 {
            // Precision region: halve the layer height and note contour compensation.
            p.layer_thickness_um *= 0.7;
            p.hatch_spacing_um *= 0.85;
        }
        let length = (s.x_end_m - s.x_start_m).abs();
        if p.layer_thickness_um > 0.0 {
            layers_f += length / (p.layer_thickness_um * 1e-6);
        }
        regions.push(PrintRegion {
            name: s.name.clone(),
            x_start_m: s.x_start_m,
            x_end_m: s.x_end_m,
            material: s.material.name.clone(),
            process: p.process,
            layer_thickness_um: p.layer_thickness_um,
            laser_power_w: p.laser_power_w,
            hatch_spacing_um: p.hatch_spacing_um,
            high_precision: s.high_precision,
            build_note: p.note,
        });

        // Graded transition at the boundary to the next region if materials differ.
        if i + 1 < specs.len() && specs[i + 1].material.name != s.material.name {
            let next = &specs[i + 1];
            transitions.push(graded_transition(&s.material, &next.material, s.x_end_m));
        }
    }

    let total_length_m: f64 = specs.iter().map(|s| (s.x_end_m - s.x_start_m).abs()).sum();
    let estimated_layers = layers_f.round().max(0.0) as u32;
    let mat_list: Vec<&str> = {
        let mut v: Vec<&str> = specs.iter().map(|s| s.material.name.as_str()).collect();
        v.dedup();
        v
    };
    let summary = format!(
        "{} regions, {} material(s), {} graded transition(s) | ~{} layers over {:.0} mm build",
        regions.len(),
        mat_list.len(),
        transitions.len(),
        estimated_layers,
        total_length_m * 1000.0
    );

    PrintPlan {
        regions,
        transitions,
        total_length_m,
        estimated_layers,
        build_direction: "axial, nozzle exit on the build plate".into(),
        summary,
    }
}

/// Build a functionally-graded composition ramp between two materials. The blend
/// length scales with the CTE mismatch — the larger the thermal-expansion gap,
/// the longer the ramp needed to keep interface stress manageable.
pub fn graded_transition(from: &Material, to: &Material, x_center_m: f64) -> GradientTransition {
    let cte_mismatch = (from.cte_per_k - to.cte_per_k).abs();
    // 6 mm base, +1 mm per 1e-6/K of CTE mismatch, capped.
    let blend_length_mm = (6.0 + cte_mismatch * 1.0e6).clamp(4.0, 20.0);
    let layer_um = am_process(to).layer_thickness_um.max(20.0);
    let layers = ((blend_length_mm * 1e-3) / (layer_um * 1e-6)).round().clamp(6.0, 60.0) as u32;
    let composition_steps: Vec<f64> = (0..layers).map(|i| (i as f64 + 0.5) / layers as f64).collect();
    GradientTransition {
        from_material: from.name.clone(),
        to_material: to.name.clone(),
        x_center_m,
        blend_length_mm,
        layers,
        composition_steps,
        note: format!(
            "FGM ramp; ΔCTE = {:.1}e-6/K sets the {:.0} mm blend to limit interface stress",
            cte_mismatch * 1e6,
            blend_length_mm
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materials::{copper_ofhc, inconel718, niobium_c103};

    #[test]
    fn copper_gets_green_laser_low_layer() {
        let p = am_process(&copper_ofhc());
        assert!(p.process.contains("green"));
        assert!(p.layer_thickness_um <= 30.0 && p.laser_power_w >= 350.0);
    }

    #[test]
    fn plan_inserts_graded_transition_between_dissimilar_materials() {
        let specs = vec![
            RegionSpec { name: "Chamber".into(), x_start_m: -0.1, x_end_m: 0.0, material: copper_ofhc(), high_precision: false },
            RegionSpec { name: "Throat".into(), x_start_m: 0.0, x_end_m: 0.01, material: copper_ofhc(), high_precision: true },
            RegionSpec { name: "Skirt".into(), x_start_m: 0.01, x_end_m: 0.2, material: niobium_c103(), high_precision: false },
        ];
        let plan = build_print_plan(&specs);
        assert_eq!(plan.regions.len(), 3);
        // Copper→copper boundary has no transition; copper→niobium has one.
        assert_eq!(plan.transitions.len(), 1);
        assert_eq!(plan.transitions[0].from_material, "OFHC Copper");
        assert!(plan.transitions[0].layers >= 6);
        assert!(plan.estimated_layers > 0);
        // Precision throat has a finer layer than the plain chamber.
        let chamber = plan.regions.iter().find(|r| r.name == "Chamber").unwrap();
        let throat = plan.regions.iter().find(|r| r.name == "Throat").unwrap();
        assert!(throat.layer_thickness_um < chamber.layer_thickness_um);
    }

    #[test]
    fn bigger_cte_mismatch_lengthens_the_ramp() {
        let small = graded_transition(&copper_ofhc(), &copper_ofhc(), 0.0);
        let big = graded_transition(&copper_ofhc(), &inconel718(), 0.0);
        assert!(big.blend_length_mm >= small.blend_length_mm);
    }
}
