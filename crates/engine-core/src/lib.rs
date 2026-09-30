//! `engine-core` — the foundation of the Propulsor liquid-engine module.
//!
//! Holds the single canonical design entity ([`design::EngineDesign`]), the
//! unit/quantity types ([`quantity`]), the fidelity-tier model ([`tier`]), the
//! provenance + recompute-graph machinery ([`provenance`]), the RON schema /
//! versioning ([`schema`]), and the unified error type ([`error`]).
//!
//! This crate is deliberately free of physics and free of Tauri. It is the
//! only crate every other solver crate may read.

pub mod design;
pub mod error;
pub mod provenance;
pub mod quantity;
pub mod schema;
pub mod tier;

pub use crate::design::{
    ChamberGeometry, ContourPoint, CoolantKind, CoolingJacketGeometry, DesignMeta, EngineDesign,
    EngineGeometry, ExpansionTarget, FieldValue, InjectorGeometry, InjectorKind,
    MaterialAssignments, NozzleContour, NozzleGeometry, NozzleKind, OperatingPoint, PropellantPair,
    PropellantSelection, RevisionEntry,
};
pub use crate::error::EngineError;
pub use crate::quantity::*;
pub use crate::tier::{SolveStatus, Tier, TierCache};
