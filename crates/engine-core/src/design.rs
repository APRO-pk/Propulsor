//! The canonical design entity.
//!
//! [`EngineDesign`] is the single source of truth. Every tier solver reads it and
//! writes cached results back into it. Serialization is via RON for project files
//! (`*.apro-engine.ron`) and serde JSON across the IPC boundary.

use crate::error::EngineError;
use crate::quantity::*;
use crate::tier::TierCache;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// File extension for APRO Works engine projects.
pub const ENGINE_PROJECT_EXT: &str = "apro-engine.ron";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignMeta {
    pub name: String,
    pub schema_version: u32,
    pub revision: u32,
    pub created_by: String,
    /// ISO-8601 timestamp string (kept as a string to avoid a chrono dep here).
    pub created_ts: String,
    pub unit_system: UnitSystem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropellantSelection {
    pub pair: PropellantPair,
    /// Mixture ratio O/F.
    pub of_ratio: Ratio,
}

/// Seeded propellant pairs (spec §4). Storable hypergolics are added later.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PropellantPair {
    /// No propellant chosen yet — a blank/unconfigured design. Solvers never run
    /// with this (see [`EngineDesign::is_configured`]); the UI shows "— Select —".
    Unset,
    GoxKerosene,
    GoxGasoline,
    GoxEthanol,
    GoxMethanol,
    LoxRp1,
    LoxEthanol,
    LoxMethane,
    /// Nitrous oxide / propane (LPG) — storable, self-pressurizing.
    NitrousPropane,
    /// Nitrogen tetroxide / monomethylhydrazine — storable hypergolic.
    NtoMmh,
    /// Nitrogen tetroxide / UDMH — storable hypergolic.
    NtoUdmh,
}

impl PropellantPair {
    pub fn label(self) -> &'static str {
        match self {
            PropellantPair::Unset => "—",
            PropellantPair::GoxKerosene => "GOX / Kerosene",
            PropellantPair::GoxGasoline => "GOX / Gasoline",
            PropellantPair::GoxEthanol => "GOX / Ethanol",
            PropellantPair::GoxMethanol => "GOX / Methanol",
            PropellantPair::LoxRp1 => "LOX / RP-1",
            PropellantPair::LoxEthanol => "LOX / Ethanol",
            PropellantPair::LoxMethane => "LOX / Methane",
            PropellantPair::NitrousPropane => "N2O / Propane",
            PropellantPair::NtoMmh => "NTO / MMH",
            PropellantPair::NtoUdmh => "NTO / UDMH",
        }
    }

    /// Parse a pair from its serde variant name (e.g. `"GoxGasoline"`).
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "GoxKerosene" => PropellantPair::GoxKerosene,
            "GoxGasoline" => PropellantPair::GoxGasoline,
            "GoxEthanol" => PropellantPair::GoxEthanol,
            "GoxMethanol" => PropellantPair::GoxMethanol,
            "LoxRp1" => PropellantPair::LoxRp1,
            "LoxEthanol" => PropellantPair::LoxEthanol,
            "LoxMethane" => PropellantPair::LoxMethane,
            "NitrousPropane" => PropellantPair::NitrousPropane,
            "NtoMmh" => PropellantPair::NtoMmh,
            "NtoUdmh" => PropellantPair::NtoUdmh,
            "" | "Unset" => PropellantPair::Unset,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatingPoint {
    pub thrust: Force,
    pub chamber_pressure: Pressure,
    pub mixture_ratio: Ratio,
    /// Either a fixed expansion ratio or a target ambient pressure (altitude).
    pub expansion: ExpansionTarget,
    /// Combustion / c* efficiency (0-1), scales c* and Isp.
    #[serde(default = "default_c_star_efficiency")]
    pub c_star_efficiency: f64,
}

fn default_c_star_efficiency() -> f64 {
    0.95
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ExpansionTarget {
    /// A fixed nozzle expansion ratio A_e / A_t.
    Ratio(Ratio),
    /// A target ambient/back pressure in Pa (derives the altitude-set ratio).
    AmbientPressure(Pressure),
}

/// Geometry entity placeholder. Fields are filled in as tiers land; remaining as
/// Options so a new design need not specify everything up front.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EngineGeometry {
    pub injector: Option<InjectorGeometry>,
    pub chamber: Option<ChamberGeometry>,
    pub nozzle: Option<NozzleGeometry>,
    pub cooling_jacket: Option<CoolingJacketGeometry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InjectorGeometry {
    pub kind: Option<InjectorKind>,
    /// Number of orifices / spray elements.
    pub element_count: Option<u32>,
    pub orifice_diameter: Option<Length>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InjectorKind {
    ImpingingStream,
    SprayNozzle,
    Pintle,
    CoaxialSwirl,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChamberGeometry {
    pub inner_diameter: Option<Length>,
    pub length: Option<Length>,
    pub contraction_ratio: Option<Ratio>,
    pub wall_material: Option<String>,
    pub wall_thickness: Option<Length>,
    /// Characteristic chamber length L* (m); `V_ch = L*·A_t`. `None` falls back to
    /// the recommended L* for the propellant pair.
    #[serde(default)]
    pub l_star_m: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NozzleGeometry {
    pub throat_diameter: Option<Length>,
    pub exit_diameter: Option<Length>,
    pub half_angle_deg: Option<f64>,
    /// Contour family (bell vs conical). `None` defaults to a bell.
    #[serde(default)]
    pub kind: Option<NozzleKind>,
    /// Axial radius profile r(x) for bell contours, once L2 is online.
    pub contour: Option<NozzleContour>,
}

/// Nozzle contour family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NozzleKind {
    Bell,
    Conical,
}

impl NozzleKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "bell" => Some(NozzleKind::Bell),
            "conical" | "cone" => Some(NozzleKind::Conical),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NozzleContour {
    /// Station list: x (m) and radius r (m).
    pub stations: Vec<ContourPoint>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ContourPoint {
    pub x: f64,
    pub r: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CoolingJacketGeometry {
    pub gap: Option<Length>,
    pub coolant: Option<CoolantKind>,
    pub inlet_pressure: Option<Pressure>,
    pub target_velocity: Option<Velocity>,
    /// Cooling strategy: "regen" | "film" | "radiation" | "ablative".
    #[serde(default)]
    pub cooling_method: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CoolantKind {
    Water,
    RegenerativeFuel,
    RegenerativeOxidizer,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MaterialAssignments {
    pub chamber: Option<String>,
    pub nozzle: Option<String>,
    pub tank: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevisionEntry {
    pub revision: u32,
    pub ts: String,
    pub note: String,
}

/// The canonical design entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineDesign {
    pub meta: DesignMeta,
    pub propellant: PropellantSelection,
    pub operating_point: OperatingPoint,
    pub geometry: EngineGeometry,
    pub materials: MaterialAssignments,
    /// Last-solve cache per tier (provenance for the recompute graph).
    #[serde(default)]
    pub caches: Vec<TierCache>,
    #[serde(default)]
    pub revisions: Vec<RevisionEntry>,
    /// Persistent numeric design parameters for the per-subsystem studies
    /// (turbomachinery/blades/feed/…), keyed as `"<subsystem>.<name>"`. Studies
    /// read these with [`EngineDesign::param`] so a value that isn't set falls
    /// back to the study's physical default. This lets the studies expose every
    /// assumption as a saved, live design input without a schema change per knob.
    #[serde(default)]
    pub params: BTreeMap<String, f64>,
    /// Persistent text design choices (e.g. `"feed.pressurant_gas"`), read with
    /// [`EngineDesign::choice`].
    #[serde(default)]
    pub choices: BTreeMap<String, String>,
}

/// A typed field-edit value crossing the IPC boundary (number or text).
#[derive(Debug, Clone)]
pub enum FieldValue {
    Num(f64),
    Text(String),
}

impl EngineDesign {
    /// Create a fresh design with sensible defaults.
    pub fn new(name: impl Into<String>, created_by: impl Into<String>) -> Self {
        EngineDesign {
            meta: DesignMeta {
                name: name.into(),
                schema_version: crate::schema::SCHEMA_VERSION,
                revision: 1,
                created_by: created_by.into(),
                created_ts: default_ts(),
                unit_system: UnitSystem::Si,
            },
            propellant: PropellantSelection {
                pair: PropellantPair::GoxKerosene,
                of_ratio: Ratio::new(3.4),
            },
            operating_point: OperatingPoint {
                thrust: Force::si(89.0),
                chamber_pressure: Pressure::si(2_068_427.0),
                mixture_ratio: Ratio::new(3.4),
                expansion: ExpansionTarget::Ratio(Ratio::new(3.65)),
                c_star_efficiency: 0.95,
            },
            geometry: EngineGeometry::default(),
            materials: MaterialAssignments::default(),
            caches: Vec::new(),
            revisions: Vec::new(),
            params: BTreeMap::new(),
            choices: BTreeMap::new(),
        }
    }

    /// A blank, unconfigured design: no propellant chosen and zero requirements.
    /// Nothing is solved until the user enters the core requirements — the app's
    /// starting state (there is no pre-fed design). `new()` keeps a solvable
    /// default and is used by tests/templates.
    pub fn blank(name: impl Into<String>, created_by: impl Into<String>) -> Self {
        let mut d = Self::new(name, created_by);
        d.propellant.pair = PropellantPair::Unset;
        d.propellant.of_ratio = Ratio::new(0.0);
        d.operating_point.thrust = Force::si(0.0);
        d.operating_point.chamber_pressure = Pressure::si(0.0);
        d.operating_point.mixture_ratio = Ratio::new(0.0);
        d.caches.clear();
        d
    }

    /// Whether the design has the core requirements needed to solve: a propellant
    /// is chosen and thrust / chamber pressure / mixture ratio are positive.
    pub fn is_configured(&self) -> bool {
        self.propellant.pair != PropellantPair::Unset
            && self.operating_point.thrust.as_si() > 0.0
            && self.operating_point.chamber_pressure.as_si() > 0.0
            && self.operating_point.mixture_ratio.as_f64() > 0.0
    }

    /// Read a persistent numeric design parameter, or `default` if unset.
    pub fn param(&self, key: &str, default: f64) -> f64 {
        self.params.get(key).copied().unwrap_or(default)
    }

    /// Read a persistent text design choice, or `default` if unset.
    pub fn choice(&self, key: &str, default: &str) -> String {
        self.choices.get(key).cloned().unwrap_or_else(|| default.to_string())
    }

    /// Apply a single field edit, mark the dependent tiers stale, and return the
    /// root tier that was invalidated (so the caller can re-resolve from there).
    ///
    /// This is the persistence path behind the desktop designer: the step-by-step
    /// wizard writes each decision through here, so choices flow into the canonical
    /// design and every dependent tier re-solves.
    pub fn apply_field(&mut self, field: &str, value: FieldValue) -> Result<crate::tier::Tier, EngineError> {
        use crate::tier::Tier;
        let num = |v: &FieldValue| -> Result<f64, EngineError> {
            match v {
                FieldValue::Num(n) => Ok(*n),
                FieldValue::Text(_) => Err(EngineError::Precondition(format!("field '{field}' expects a number"))),
            }
        };
        let text = |v: &FieldValue| -> Result<String, EngineError> {
            match v {
                FieldValue::Text(s) => Ok(s.clone()),
                FieldValue::Num(_) => Err(EngineError::Precondition(format!("field '{field}' expects text"))),
            }
        };

        // Dotted keys (e.g. "blade.pump_blade_count", "feed.pressurant_gas") are
        // per-subsystem study parameters: persisted in the param/choice bag and
        // read by the studies with a physical default. They don't feed the L0–L5
        // tier chain, so nothing is invalidated.
        if field.contains('.') {
            match &value {
                // Sentinel: clear the key so the study reverts to its default.
                FieldValue::Text(s) if s == "__reset__" => {
                    self.params.remove(field);
                    self.choices.remove(field);
                }
                FieldValue::Num(n) => {
                    self.params.insert(field.to_string(), *n);
                }
                FieldValue::Text(s) => {
                    self.choices.insert(field.to_string(), s.clone());
                }
            }
            self.meta.revision += 1;
            return Ok(Tier::L5);
        }

        let root = match field {
            "thrust" => {
                self.operating_point.thrust = Force::si(num(&value)?);
                Tier::L0
            }
            "chamber_pressure" => {
                self.operating_point.chamber_pressure = Pressure::si(num(&value)?);
                Tier::L0
            }
            "of_ratio" | "mixture_ratio" => {
                let r = Ratio::new(num(&value)?);
                self.operating_point.mixture_ratio = r;
                self.propellant.of_ratio = r;
                Tier::L0
            }
            "expansion_ratio" => {
                self.operating_point.expansion = ExpansionTarget::Ratio(Ratio::new(num(&value)?));
                Tier::L2
            }
            "c_star_efficiency" => {
                let v = num(&value)?;
                if !(0.5..=1.0).contains(&v) {
                    return Err(EngineError::out_of_domain("c_star_efficiency", 0.5, 1.0, v));
                }
                self.operating_point.c_star_efficiency = v;
                Tier::L2
            }
            "l_star" => {
                let v = num(&value)?;
                if !(0.05..=5.0).contains(&v) {
                    return Err(EngineError::out_of_domain("l_star", 0.05, 5.0, v));
                }
                self.geometry.chamber.get_or_insert_with(Default::default).l_star_m = Some(v);
                Tier::L0
            }
            "propellant_pair" => {
                self.propellant.pair = PropellantPair::parse(&text(&value)?)
                    .ok_or_else(|| EngineError::Precondition("unknown propellant pair".into()))?;
                Tier::L0
            }
            "nozzle_kind" => {
                let k = NozzleKind::parse(&text(&value)?)
                    .ok_or_else(|| EngineError::Precondition("unknown nozzle kind".into()))?;
                self.geometry.nozzle.get_or_insert_with(Default::default).kind = Some(k);
                Tier::L2
            }
            "wall_material" | "chamber_material" => {
                self.materials.chamber = Some(text(&value)?);
                Tier::L3
            }
            "nozzle_material" => {
                self.materials.nozzle = Some(text(&value)?);
                Tier::L3
            }
            "cooling_method" => {
                self.geometry.cooling_jacket.get_or_insert_with(Default::default).cooling_method = Some(text(&value)?);
                Tier::L3
            }
            other => return Err(EngineError::Precondition(format!("unknown field '{other}'"))),
        };

        crate::provenance::mark_stale_from_root(self, root);
        self.meta.revision += 1;
        Ok(root)
    }

    /// Serialize to a RON project file body.
    pub fn to_ron(&self) -> Result<String, EngineError> {
        crate::provenance::to_ron(self)
    }

    /// Parse a RON project file body through the migration pass.
    pub fn from_ron(raw: &str) -> Result<Self, EngineError> {
        crate::provenance::from_ron(raw)
    }
}

fn default_ts() -> String {
    "1970-01-01T00:00:00Z".to_string()
}
