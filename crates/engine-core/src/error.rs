//! Unified error type across the solver stack.

use thiserror::Error;

/// Top-level error returned by solver crates and the IPC layer.
///
/// Carries a `tier` where the failure originated so the UI can surface it at the
/// correct control, and distinguishes soft (telemetry) faults from hard failures.
#[derive(Debug, Error)]
pub enum EngineError {
    /// A needed input is not available or a lower-tier result is stale.
    #[error("precondition not met: {0}")]
    Precondition(String),

    /// An iterative solver failed to converge.
    #[error("solver did not converge after {iter} iterations (residual {residual:e})")]
    NonConvergence { iter: usize, residual: f64 },

    /// A physical input fell outside its valid domain (e.g. coolant gap ≈ 0).
    #[error("out of domain: {what} must be in [{min:e}, {max:e}], got {actual:e}")]
    OutOfDomain {
        what: &'static str,
        min: f64,
        max: f64,
        actual: f64,
    },

    /// A material or latent-property lookup failed.
    #[error("lookup failed: {0}")]
    Lookup(String),

    /// A soft, non-fatal telemetry/hardware fault (dropped sensor, NaN sample).
    #[error("telemetry fault: {0}")]
    Telemetry(String),

    /// A serialization / schema error.
    #[error(transparent)]
    Schema(#[from] SchemaError),

    /// The solve was cancelled.
    #[error("cancelled")]
    Cancelled,

    /// Anything else — the catch-all; solver code must not panic.
    #[error("internal error: {0}")]
    Internal(String),
}

impl EngineError {
    /// Convenience constructor for [`EngineError::OutOfDomain`].
    pub fn out_of_domain(what: &'static str, min: f64, max: f64, actual: f64) -> Self {
        EngineError::OutOfDomain {
            what,
            min,
            max,
            actual,
        }
    }

    /// Construct an internal error from a formatted message.
    pub fn internal(msg: impl Into<String>) -> Self {
        EngineError::Internal(msg.into())
    }
}

impl From<Box<dyn std::error::Error + Send + Sync>> for EngineError {
    fn from(e: Box<dyn std::error::Error + Send + Sync>) -> Self {
        EngineError::Internal(e.to_string())
    }
}

impl From<std::io::Error> for EngineError {
    fn from(e: std::io::Error) -> Self {
        EngineError::Internal(e.to_string())
    }
}

/// Schema / migration-specific errors.
#[derive(Debug, Error)]
pub enum SchemaError {
    #[error("unsupported schema version {found}; this build only supports {supported}")]
    UnsupportedVersion { found: u32, supported: u32 },
    #[error("invalid project data: {0}")]
    Invalid(String),
}
