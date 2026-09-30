//! The fidelity-tier model and per-tier solve cache.
//!
//! A design is refined progressively through tiers L0→L6. Each tier's last solve
//! is cached on the design entity with provenance so downstream tiers know whether
//! their inputs are still valid.

use serde::{Deserialize, Serialize};

/// Fidelity tier. Higher tiers are more physically resolved and require the
/// outputs of every lower tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Tier {
    /// Krzycki analytical sizing (constant gamma = 1.2, hand-calc equations).
    L0,
    /// Real equilibrium thermochemistry (T_c, gamma, MW, c*, Isp).
    L1,
    /// Quasi-1D nozzle flow + Rao/MoC bell contour.
    L2,
    /// Bartz + Gnielinski/Dittus-Boelter regenerative cooling.
    L3,
    /// Thin-wall stress, combined thermal+pressure stress, buckling, bolts.
    L4,
    /// Feed system, regulators, network, transients.
    L5,
    /// Future CFD/FEA bridge (not built in the first version).
    L6,
}

impl Tier {
    /// All tiers, ordered from lowest to highest fidelity.
    pub const ALL: [Tier; 7] = [
        Tier::L0,
        Tier::L1,
        Tier::L2,
        Tier::L3,
        Tier::L4,
        Tier::L5,
        Tier::L6,
    ];

    /// Human-readable label used by the UI tier badge.
    pub fn label(self) -> &'static str {
        match self {
            Tier::L0 => "L0 Analytical",
            Tier::L1 => "L1 Thermochemistry",
            Tier::L2 => "L2 Gas Dynamics & Contour",
            Tier::L3 => "L3 Heat Transfer & Cooling",
            Tier::L4 => "L4 Structures",
            Tier::L5 => "L5 Feed System & Transients",
            Tier::L6 => "L6 Full-Field (future)",
        }
    }

    /// The tier one level of fidelity below this one, if any.
    pub fn below(self) -> Option<Tier> {
        match self {
            Tier::L0 => None,
            Tier::L1 => Some(Tier::L0),
            Tier::L2 => Some(Tier::L1),
            Tier::L3 => Some(Tier::L2),
            Tier::L4 => Some(Tier::L3),
            Tier::L5 => Some(Tier::L4),
            Tier::L6 => Some(Tier::L5),
        }
    }
}

/// Whether a tier's cached result is trusted, stale, or failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum SolveStatus {
    /// Never solved, or invalidated by a change to an input below it.
    #[default]
    Stale,
    /// Last solve is valid for the current inputs.
    Solved,
    /// Last solve errored; the failure detail is carried in the cache entry.
    Failed,
}

/// Cached result of a single tier solve, tagged with provenance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierCache {
    pub tier: Tier,
    pub status: SolveStatus,
    /// Hash of the exact inputs (quantized) this solve consumed. Enables the
    /// lazy recompute graph to detect drift without re-running the solver.
    pub inputs_hash: u64,
    /// Optional serialized result payload (e.g. an L0 result). Stored as JSON so
    /// `engine-core` stays free of solver-type dependencies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    /// Optional human-readable failure message when `status == Failed`.
    pub error: Option<String>,
}
