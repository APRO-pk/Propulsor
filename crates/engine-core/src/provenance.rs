//! Provenance, hash-quantization, and the lazy recompute graph.
//!
//! Two responsibilities:
//!
//! 1. **Float-drift-safe hashing.** Inputs are quantized to a strict engineering
//!    tolerance before being hashed, so `300.000000001` and `300.0` hash the same
//!    and a no-op edit can't trigger an endless recompute.
//! 2. **Field→tier dependency map.** Tells the orchestrator which cached tier
//!    results are invalidated by a given field edit, so solving stays incremental.

use crate::design::EngineDesign;
use crate::error::EngineError;
use crate::tier::Tier;

/// Decimal places used when quantizing floats for hashing. Engineering tolerance:
/// 6 decimals ≈ 1e-6 in the canonical SI magnitude of whatever quantity is hashed.
pub const HASH_QUANT_DECIMALS: u32 = 6;

/// Round `x` to `decimals` decimal places (banker's-ish via f64 ops; exact enough
/// for hashing).
pub fn quantize(x: f64, decimals: u32) -> f64 {
    let scale = 10f64.powi(decimals as i32);
    (x * scale).round() / scale
}

/// Incremental hash builder for quantized inputs. FNV-1a 64-bit.
#[derive(Debug, Default, Clone)]
pub struct InputFingerprint {
    hash: u64,
}

impl InputFingerprint {
    pub fn new() -> Self {
        InputFingerprint {
            hash: 0xcbf2_9ce4_8422_2325,
        }
    }

    fn mix(&mut self, byte: u8) {
        self.hash ^= u64::from(byte);
        self.hash = self.hash.wrapping_mul(0x0000_0100_0000_01b3);
    }

    /// Mix a quantized f64 by hashing its canonical bit pattern.
    pub fn add_f64(&mut self, value: f64, decimals: u32) -> &mut Self {
        let q = quantize(value, decimals).to_bits();
        for b in q.to_be_bytes() {
            self.mix(b);
        }
        self
    }

    pub fn add_u64(&mut self, value: u64) -> &mut Self {
        for b in value.to_be_bytes() {
            self.mix(b);
        }
        self
    }

    pub fn add_str(&mut self, value: &str) -> &mut Self {
        for b in value.as_bytes() {
            self.mix(*b);
        }
        self.mix(0xff);
        self
    }

    pub fn finish(&self) -> u64 {
        self.hash
    }
}

/// The tier a given field lives at / primarily affects.
///
/// Editing a field that is an `L0` input invalidates `L0` and everything above it.
/// Editing a field that is only read by `L3` invalidates `L3` and above.
pub fn field_root_tier(field: &str) -> Tier {
    match field {
        // Injector geometry is sized at L0 but refined later; treat as L0 root.
        "injector" | "orifice_diameter" | "element_count" => Tier::L0,

        // Chamber geometry contributes to L0 sizing and L3 cooling.
        "chamber_wall_material" | "chamber_wall_thickness" | "wall_material" => Tier::L3,

        // Coolant channel geometry is read exclusively by L3+.
        "coolant_gap" | "coolant" | "coolant_inlet_pressure" | "coolant_target_velocity" => Tier::L3,

        // Nozzle contour is produced by L2 and consumed by L3.
        "nozzle_half_angle" | "throat_diameter" | "exit_diameter" => Tier::L2,

        // Operating point feeds everything from L0 up.
        "thrust" | "chamber_pressure" | "mixture_ratio" | "expansion" | "of_ratio" => Tier::L0,

        // Fallback: unknown fields are conservative and reset from the root.
        _ => Tier::L0,
    }
}

/// Returns the set of tiers (and above) invalidated by editing `root`.
/// The root tier and every tier above it become stale.
pub fn invalidated_tiers(root: Tier) -> Vec<Tier> {
    crate::tier::Tier::ALL
        .into_iter()
        .skip_while(|&t| t < root)
        .collect()
}

/// Mark `root` and every higher tier as stale on a design (lazy recompute hook).
pub fn mark_stale_from_root(design: &mut EngineDesign, root: Tier) {
    let stale = invalidated_tiers(root);
    for t in stale {
        if let Some(cache) = design.caches.iter_mut().find(|c| c.tier == t) {
            cache.status = crate::tier::SolveStatus::Stale;
        }
    }
}

/// Serialize a design to a RON project-file body.
pub fn to_ron(design: &EngineDesign) -> Result<String, EngineError> {
    ron::ser::to_string(design).map_err(|e| EngineError::internal(format!("RON serialize: {e}")))
}

/// Parse a RON project-file body through the schema migration pass.
pub fn from_ron(raw: &str) -> Result<EngineDesign, EngineError> {
    let migrated = crate::schema::migrate(raw)?;
    ron::de::from_str::<EngineDesign>(&migrated)
        .map_err(|e| EngineError::internal(format!("RON decode: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantization_suppresses_float_drift() {
        let mut a = InputFingerprint::new();
        a.add_f64(300.0, HASH_QUANT_DECIMALS);
        let mut b = InputFingerprint::new();
        b.add_f64(300.000000001, HASH_QUANT_DECIMALS);
        assert_eq!(a.finish(), b.finish(), "drift must not change the hash");
    }

    #[test]
    fn real_changes_do_change_hash() {
        let mut a = InputFingerprint::new();
        a.add_f64(300.0, HASH_QUANT_DECIMALS);
        let mut b = InputFingerprint::new();
        b.add_f64(301.0, HASH_QUANT_DECIMALS);
        assert_ne!(a.finish(), b.finish());
    }

    #[test]
    fn dependency_map_root_l3() {
        assert_eq!(field_root_tier("coolant_gap"), Tier::L3);
        assert_eq!(invalidated_tiers(Tier::L3), vec![Tier::L3, Tier::L4, Tier::L5, Tier::L6]);
    }

    #[test]
    fn ron_round_trip() {
        let d = EngineDesign::new("test", "martin");
        let ron = to_ron(&d).unwrap();
        let back = from_ron(&ron).unwrap();
        assert_eq!(d.meta.name, back.meta.name);
        assert_eq!(d.operating_point.chamber_pressure, back.operating_point.chamber_pressure);
    }
}
