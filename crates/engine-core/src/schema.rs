//! RON project schema & versioning.
//!
//! Project files are `apro-engine.ron` with a leading `schema_version`. Because
//! `serde` + `ron` have no built-in versioning, we gate on the version and run an
//! explicit migration pass on load. Newer versions keep the old loader structs
//! (`v1`, ...) and stamp up one step at a time.

use crate::error::EngineError;

/// The highest schema version this build can read.
pub const SCHEMA_VERSION: u32 = 1;

/// Validate a raw schema version against the supported range.
pub fn check_version(found: u32) -> Result<(), EngineError> {
    if found > SCHEMA_VERSION {
        return Err(EngineError::Schema(crate::error::SchemaError::UnsupportedVersion {
            found,
            supported: SCHEMA_VERSION,
        }));
    }
    Ok(())
}

/// Placeholder migration pass. For version 1 there is nothing to do; future
/// versions add a `v1::EngineDesign -> v2::EngineDesign` step here and bump
/// `SCHEMA_VERSION` accordingly.
pub fn migrate(raw: &str) -> Result<String, EngineError> {
    // Cheap forward-compat read of just the version field.
    let version = read_version(raw)?;
    check_version(version)?;
    // Only v1 exists today. When v2 lands, insert the stepped migration here.
    Ok(raw.to_string())
}

fn read_version(raw: &str) -> Result<u32, EngineError> {
    // Use serde_json to peek at the version cross-format-free? RON is not JSON.
    // Instead parse minimally: find `schema_version:` followed by an integer.
    let marker = "schema_version:";
    let idx = raw
        .find(marker)
        .ok_or_else(|| EngineError::Schema(crate::error::SchemaError::Invalid(
            "missing `schema_version` field".into(),
        )))?;
    let rest = &raw[idx + marker.len()..];
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    let version = digits
        .parse::<u32>()
        .map_err(|_| EngineError::Schema(crate::error::SchemaError::Invalid(
            "could not parse `schema_version`".into(),
        )))?;
    Ok(version)
}
