//! Meanline loss models.
//!
//! Builds up the efficiency of a pump or turbine stage from individual loss
//! mechanisms rather than assuming a single efficiency: pump hydraulic losses
//! (incidence, skin friction, diffusion, disk friction, leakage) and turbine
//! losses (profile, secondary, tip clearance, exit kinetic energy — a
//! Soderberg-style build-up).

/// A named loss contribution, as a fraction of the ideal work.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LossItem {
    pub name: String,
    pub fraction: f64,
}

/// A loss build-up and the resulting efficiency.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LossBreakdown {
    pub items: Vec<LossItem>,
    pub total_loss_fraction: f64,
    pub efficiency: f64,
}

impl LossBreakdown {
    pub fn summary(&self) -> String {
        format!("η={:.3} | losses: {:.1}%", self.efficiency, self.total_loss_fraction * 100.0)
    }
}

/// Pump meanline input.
#[derive(Debug, Clone)]
pub struct PumpLossInput {
    pub specific_speed: f64,
    pub flow_coefficient: f64,
    pub blade_count: u32,
    /// Tip clearance / blade span ratio.
    pub clearance_ratio: f64,
    /// Reynolds number proxy (higher → lower friction).
    pub reynolds: f64,
}

/// Build up pump hydraulic efficiency from the loss mechanisms.
pub fn pump_losses(input: &PumpLossInput) -> LossBreakdown {
    let phi = input.flow_coefficient.clamp(0.03, 0.4);
    // Incidence: worst away from the design flow coefficient (~0.1).
    let incidence = 0.02 + 1.2 * (phi - 0.1).powi(2);
    // Skin friction falls with Reynolds number.
    let friction = 0.03 * (1.0e6 / input.reynolds.max(1.0e4)).powf(0.2);
    // Diffusion (blade loading) — fewer blades load harder.
    let diffusion = 0.02 + 0.15 / input.blade_count.max(1) as f64;
    // Disk friction grows at low specific speed (small, fast impellers).
    let disk = 0.03 * (60.0 / input.specific_speed.max(10.0));
    // Leakage across the tip clearance.
    let leakage = 2.0 * input.clearance_ratio.clamp(0.0, 0.1);

    let items = vec![
        LossItem { name: "Incidence".into(), fraction: incidence },
        LossItem { name: "Skin friction".into(), fraction: friction },
        LossItem { name: "Diffusion".into(), fraction: diffusion },
        LossItem { name: "Disk friction".into(), fraction: disk },
        LossItem { name: "Leakage".into(), fraction: leakage },
    ];
    let total = items.iter().map(|i| i.fraction).sum::<f64>().min(0.6);
    LossBreakdown { items, total_loss_fraction: total, efficiency: 1.0 - total }
}

/// Turbine meanline input.
#[derive(Debug, Clone)]
pub struct TurbineLossInput {
    /// Flow deflection (turning) through the rotor, deg.
    pub deflection_deg: f64,
    /// Blade aspect ratio (span / chord).
    pub aspect_ratio: f64,
    /// Tip clearance / span ratio.
    pub clearance_ratio: f64,
    /// Blade speed / spouting velocity U/C0.
    pub velocity_ratio: f64,
}

/// Soderberg-style turbine loss build-up.
pub fn turbine_losses(input: &TurbineLossInput) -> LossBreakdown {
    let eps = input.deflection_deg;
    // Soderberg nominal profile loss coefficient from the deflection.
    let profile = 0.04 + 0.06 * (eps / 100.0).powi(2);
    // Secondary loss scales inversely with aspect ratio.
    let secondary = profile * (0.5 + 3.2 / input.aspect_ratio.max(0.5));
    let secondary = secondary - profile; // marginal secondary contribution
    // Tip clearance loss.
    let tip = 0.5 * input.clearance_ratio.clamp(0.0, 0.1) * (1.0 + 3.2 / input.aspect_ratio.max(0.5));
    // Exit kinetic energy left unused, minimised near the optimum velocity ratio.
    let nu = input.velocity_ratio.clamp(0.05, 0.9);
    let exit = 0.08 + 0.6 * (nu - 0.47).powi(2);

    let items = vec![
        LossItem { name: "Profile".into(), fraction: profile },
        LossItem { name: "Secondary".into(), fraction: secondary.max(0.0) },
        LossItem { name: "Tip clearance".into(), fraction: tip },
        LossItem { name: "Exit kinetic".into(), fraction: exit },
    ];
    let total = items.iter().map(|i| i.fraction).sum::<f64>().min(0.7);
    LossBreakdown { items, total_loss_fraction: total, efficiency: 1.0 - total }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pump_efficiency_is_physical() {
        let b = pump_losses(&PumpLossInput {
            specific_speed: 40.0,
            flow_coefficient: 0.1,
            blade_count: 6,
            clearance_ratio: 0.02,
            reynolds: 1.0e6,
        });
        assert!(b.efficiency > 0.5 && b.efficiency < 0.95, "η = {}", b.efficiency);
        assert!((b.total_loss_fraction + b.efficiency - 1.0).abs() < 1e-9);
    }

    #[test]
    fn off_design_flow_costs_efficiency() {
        let base = PumpLossInput { specific_speed: 40.0, flow_coefficient: 0.1, blade_count: 6, clearance_ratio: 0.02, reynolds: 1.0e6 };
        let on = pump_losses(&base);
        let off = pump_losses(&PumpLossInput { flow_coefficient: 0.25, ..base });
        assert!(off.efficiency < on.efficiency);
    }

    #[test]
    fn turbine_efficiency_peaks_near_optimum_ratio() {
        let base = TurbineLossInput { deflection_deg: 120.0, aspect_ratio: 2.0, clearance_ratio: 0.02, velocity_ratio: 0.47 };
        let opt = turbine_losses(&base);
        let off = turbine_losses(&TurbineLossInput { velocity_ratio: 0.2, ..base });
        assert!(opt.efficiency > off.efficiency);
        assert!(opt.efficiency > 0.5 && opt.efficiency < 0.95);
    }
}
