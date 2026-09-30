# Engine Designer & Simulator — Architecture Plan

Product: APRO Works / **Propulsor** liquid-engine module.
Reference spec: `liquid-engine-designer-spec.md` (tiered computational model L0–L6).
Build targets verified: `rustc/cargo 1.97.1`, `node 24.18.1`, `npm 11.16.0` on Windows.

This document is the *build plan* for the engineering model and the UI around it. It
maps the spec's roadmap onto an ordered, testable set of crates and milestones. It does
**not** yet contain implementation code.

---

## 0. The one design decision that governs everything

The product's differentiator is **progressive refinement without re-entry**: one design
entity, started as a 5-second hand-calc (L0), refined through thermochemistry (L1),
nozzle contour (L2), cooling (L3), structures (L4), feed/transients (L5) — never re-typing
data, and every number on screen tagged with the tier that produced it.

This forces two architectural commitments up front:

1. **A single canonical design entity** is the only source of truth. Every tier reads it
   (plus the outputs of the tiers below it) and writes derived results back into it as
   cached, provenance-tagged values.
2. **A provenance + recompute graph** decides which cached tier results are still valid
   when the user edits a field. Editing `chamber pressure` invalidates everything above
   L0; editing `coolant gap` invalidates only L3+. Solving is *lazy and incremental*, not
   "recompute the world."

Tiers are **layers of solvers over one entity**, not separate tools.

---

## 1. Monorepo layout

Cargo workspace root + a Tauri app crate + a Vite frontend. Solver code never lives in
the Tauri crate; it lives in reusable crates so the same engine can be driven headlessly
by CLI tests and CI.

```
Engine/
├── Cargo.toml                     # workspace: members, resolver, [workspace.dependencies]
├── rust-toolchain.toml            # pin toolchain for reproducible CI
├── clippy.toml / .cargo/config.toml
├── README.md
│
├── crates/                        # the computational engineering model (pure Rust, no Tauri)
│   ├── engine-core/               # design entity, schema, unit/quantity types, provenance
│   ├── propellants/               # propellant pairs + materials database (seeded, embeddable)
│   ├── sizing-l0/                 # Krzycki analytical sizing (L0)
│   ├── thermo/                    # equilibrium chemistry: species, NASA coefs, Gibbs min (L1)
│   ├── gasdynamics/               # quasi-1D nozzle flow, Rao bell/MoC contour (L2)
│   ├── cooling/                   # Bartz + Gnielinski/Dittus-Boelter regen solve (L3)
│   ├── injector/                  # orifice/spray sizing + stability heuristics
│   ├── feedsystem/                # fluid network, tank/valve/regulator sizing (L5)
│   ├── structures/                # shell stress, thermal+pressure, buckling, bolts (L4)
│   ├── simulate/                  # orchestrator: tier pipeline, steady/transient runs
│   └── export/                    # PDF report, DXF, P&ID, checklist, STEP/RON bridge
│
├── engines/app/                   # Tauri application shell (owns the IPC layer)
│   ├── src-tauri/                 # Tauri v2 Rust host:
│   │                             #   - IPC routing (set_field, get_tier_array, ...) lives HERE,
│   │                             #     NOT in a separate crate (see "Tauri workspace quirk" below)
│   │                             #   - depends on crates::simulate + crates::export
│   └── ...
├── frontend/                      # React + TS + Vite (Design / Simulate / Test & Safety)
│   └── ...
├── tools/apro-engine-cli/         # headless binary: `apro-engine size --project x.ron --tier 3`
│                                 #   used by CI, golden tests, scripting. Shares crate code.
│
├── tests/golden/                  # integration golden tests (Krzycki 20 lbf, NASA SP-125)
├── tests/fixtures/                # RON + expected-value JSON fixtures
└── docs/                          # this plan + per-crate design notes
```

**Tauri workspace quirk — IPC lives in the host crate, not a standalone crate.** Tauri's CLI
and `tauri-build` scripts are tuned to run from the root of the *actual* application crate
(`engines/app/src-tauri`), not from an arbitrary sibling crate. Making `tauri-bridge` a
standalone crate that depends on `tauri` forces you to fight the bundler over where the
`tauri` dependency and its build script live. So **the IPC routing layer is collapsed directly
into `engines/app/src-tauri`** as thin modules (`commands.rs`, `progress` events). The pure
physics crates stay 100% Tauri-free; the only crate that depends on `tauri` is the app host.
If IPC logic ever needs reuse outside Tauri, extract only the *shape* (the delta/command DTOs)
into `engine-core`/`simulate` and keep the Tauri bindings in the host.

Rationale for `tools/apro-engine-cli`: the L0 golden test ("reproduce Krzycki exactly,
value by value") is far easier to drive from a CLI than through Tauri IPC. The CLI and the
desktop app call the **same** `simulate` crate, so a passing CLI test is a passing app math.

### Workspace dependency graph (build order)

```
engine-core        (no engine deps)        <- foundation
   │
   ├── propellants  (engine-core)
   ├── sizing-l0    (engine-core, propellants)
   ├── thermo       (engine-core, propellants)
   ├── injector     (engine-core, propellants)
   │
   ├── gasdynamics  (engine-core, thermo)
   ├── cooling      (engine-core, gasdynamics, thermo)
   ├── structures   (engine-core, sizing-l0)
   ├── feedsystem   (engine-core, sizing-l0)
   │
   ├── simulate     (engine-core + all above)   <- orchestrator
   │
   ├── export       (engine-core, simulate)
   └── (no tauri crate in the tree — the app host's src-tauri is the only tauri dependency)
```

Lock the dependency direction: **crates point up to `engine-core` and `simulate`; nothing
else is shared.** `simulate` is the only crate that composes the whole model. This keeps
each tier independently unit-testable and versionable, as the spec requires.

---

## 2. Central data model (`engine-core`)

The design entity, its schema, and the provenance/dirty machinery. No physics here.

### 2.1 Core types

```
struct EngineDesign {
    meta: DesignMeta,                  // name, schema_version, revision, created_by
    propellant: PropellantSelection,   // pair id, O/F ratio, phase notes
    operating_point: OperatingPoint,   // thrust, Pc, O/F, expansion target (ratio | altitude)
    geometry: EngineGeometry,          // injector, chamber, nozzle, cooling jacket
    materials: MaterialAssignments,    // per-part material + thickness
    units: UnitSystemPreference,       // SI | imperial toggle; stored canonical-SI always
    caches: Vec<TierCache>,            // last-solve result per tier, contiguous struct-of-tags
    revisions: Vec<RevisionEntry>,     // history log
}

enum Tier { L0, L1, L2, L3, L4, L5, L6 }

struct TierCache {
    tier: Tier,
    status: SolveStatus,               // Stale | Solved | Failed
    inputs_hash: u64,                  // hash of the inputs this solve used
    result: TierResult,                // opaque, tagged enum; serialized via RON
}
```

Key invariants:
- **Canonical SI internally.** The `units` toggle is presentation-only. Inputs in imperial
  are converted at the boundary; all computations and all cached results store SI. This
  eliminates whole classes of unit bugs and matches "SI by default, imperial toggle."
- **`inputs_hash` drives invalidation.** Each tier records the hash of every input it read
  (including the results of lower tiers). If a lower tier's output changes, the higher
  tier's hash no longer matches its output and it is marked `Stale`.
- **Hash quantization kills float-drift recomputes.** The lazy-recompute graph compares raw
  hashes of inputs. High-precision physics values crossing IPC (TS `f64` → Rust / serde JSON)
  can carry microscopic drift (`300.000000001` vs `300.0`). Hashing raw floats would treat
  a no-op edit as a real change and trigger endless recomputes. So every dimensioned
  quantity is **quantized to a strict engineering tolerance before hashing** (e.g. 6 decimal
  places, or a relative tolerance for dimensionless ratios), via a `QuantizedValue` wrapper
  used solely for hashing/invalidating. Results are never mutated by this — the canonical
  `f64` is retained; only the hash-input is quantized.
- **`TierResult` is an open, versioned enum.** It changes as tiers gain features, so it
  carries its own `tier` field and a `version` field. Downstream consumers match on the
  variant and tolerate a missing feature gracefully (e.g. cold-wall boundary layer at L2).

### 2.2 Provenance & recompute graph

`simulate` owns a resolver that walks tiers bottom-up. Editing a field recomputes only
affected tiers:

- Field edit → compute a *dependency set* of tiers (`field -> tier` mapped in a static table).
- Lower bound: any edit marks L0 dirty (or a specific tier if the field is a downstream
  input only).
- `resolve()` loop: for the lowest stale tier, feed it `parent.tiers[a..]` (valid outputs of
  tiers below) + current inputs, solve, store result, recompute `inputs_hash`.

Rule: a tier may only depend on tiers **below** it. This keeps the recompute graph a DAG.

### 2.3 Unit & quantity types

Use `uom` (Units of Measurement) with SI base, and thin newtypes/time helpers where `uom`
is awkward (e.g. mixture ratio is dimensionless; c* has units of velocity). Provide `compat`
modules mapping Krzycki's engraved imperial constants (e.g. `R = 65 ft·lbf/lb·R`,
`g0 = 32.2`). Never magic-number-convert in solver code — conversions live in `engine-core`.

### 2.4 RON serialization & versioning

- Serde derives + `ron` for `.apro-engine.ron`.
- Add a manymever `schema_version: u32` to `DesignMeta`.
- Migration is explicit: a `migrate(ron: &str) -> Result<&str>` pass in `engine-core` that
  steps old versions up, called on load. Because `serde` RON has no automatic versioning,
  we keep per-version loaded structs (`v1::EngineDesign`) internally and stamp up. Good
  long-term practice even though V0 files won't exist yet.
- Geometry entities are keyed so external modules (AI Mesh, AI CAD, HexaDOF) reference them
  by stable ID, not by re-serialized copy.

---

## 3. Solver architecture (`simulate`)

### 3.1 The `TierSolver` trait (unified contract)

```
#[async_trait]
trait TierSolver {
    type Input;
    type Output: TierResult;
    async fn solve(&self, cx: &SolveContext, input: &Self::Input) -> Result<Self::Output, SolveError>;
    fn relevance(inputs: &EngineDesign) -> TierRelevance;   // cheap pre-check: is this runnable now?
}
```

- **`relevance` is a hard pre-flight gate, not a soft hint** (mandatory for numerically
  explosive tiers like L3). The correlations used by some tiers blow up on borderline input:
  Gnielinski/Dittus-Boelter in the L3 cooling solve divide by zero as the coolant gap → 0 or
  silently produce garbage when velocity falls out of the turbulent regime. So `relevance`
  walks the **physics domain** of the tier (`coolant_gap > min`, `Re` inside the correlation's
  range, `velocity > min`, throat radius > 0, `Pc/At` sane, etc.) and returns
  `SolveError::OutOfDomain(what, min, max, actual)` **before** anything is sent to the CPU pool.
  A bad input never reaches the integrator; the pool never attempts a divergent problem. The
  frontend reads the returned `OutOfDomain` and disables/annotates the offending field inline.
- `SolveContext` carries unit system, iteration/step limits, and a `progress: Sender<Progress>`
  so long runs stream % to the UI without blocking.
- Multi-step tiers (L3 cooling along a 1D axial mesh, L2 MoC marching) are **chunked**:
  they poll `Progress::cancel_token` and checkpoint so the scheduler can run them in the
  background and cancel cleanly.
- The orchestrator selects the highest tier whose dependencies are all `Solved`, runs it,
  marks lower dirty if needed, and repeats. L0 is synchronous and cached.
- **CPUs off the tokio executor (critical).** The L1 Gibbs minimizer and L2 MoC march are
  CPU-bound, numeric-heavy work. They **must not** run on tokio worker threads — a heavy
  solve starving the executor would freeze the Tauri IPC channels and progress events that
  React depends on. So:
  - tokio is used **only** for orchestration: walking the tier DAG, dispatching, and
    streaming `Progress` events back to the frontend.
  - The actual numeric kernels run on **`rayon`** (a dedicated CPU work-stealing pool) or
    `tokio::task::spawn_blocking`. `spawn_blocking` is the simplest correct primitive for a
    blocking chunk; a dedicated `rayon` pool gives deterministic concurrency control and
    better isolation for long-lived heavy solves (and cleanly supports cancellation via a
    `rayon`-scoped `CancelToken`).
  - Rule: any function that would occupy a worker thread for > ~1 ms goes through
    `spawn_blocking`/`rayon`; tokio threads only fence and gather results.

### 3.2 Tier pipeline logic

Dependency discipline (which tier reads which output):

| Tier | Reads (own inputs + below) | Produces |
|---|---|---|
| L0 | OperatingPoint, propellant O/F,Isp, geometry | flow rates, At, Dt, Ae/At, chamber L/D, wall thickness, cooling gap, injector orifices |
| L1 | OperatingPoint, propellant pair, L0 flow rates | Tc, gamma, MW, c*, Isp (real equilibrium) |
| L2 | L1 Tc/gamma/c*/MW, geometry, expansion target | quasi-1D area/velocity/M, bell contour (MoC Rn/Rt), divergence + BL corrected Isp |
| L3 | L2 contour, L1 c*/Tc, geometry + cooling jacket | wall temp vs limit, coolant side temp/pressure/velocity, boiling margin, ΔP |
| L4 | L0 geometry, L3 wall temp | hoop/axial stress, ΔT thermal stress, buckling margin, bolt/flange capacity |
| L5 | L0 flow rates, props, geometry | tank wall/endplate, regulator+valve sizing, network ΔP, start/shutdown transient, hard-start flag |

### 3.3 Steady vs transient runs

- **Steady** (L0–L5): one design evaluation, cached, deterministic → drives the design UI + perf maps.
- **Transient** (L5+): a small ODE/event-based model of fill/ignition/purge, returning a
  time series + hard-start score. Run off the main thread, stream samples.

### 3.4 Error model

`SolveError` spans: `Precondition(typeof not available)`, `NonConvergence{iter,residual}`,
`OutOfDomain(what, min, max, actual)`, `Material/Lookup` failures, and `Cancelled`. Each
error carries a `tier` and a friendly message so the UI can surface it at the right control.

**Hardware/telemetry resilience (future-proofing for M4/M5).** As the `/Transient`, test-stand,
and safety layers come online they will read physical DAQ channels — load cells, pressure
transducers, thermocouples, third-party solenoid controllers — where a sensor dropout, a
`NaN`, or a dirty USB solder short can inject garbage telemetry. The Rust backend must
**never panic and crash the Tauri UI** on bad hardware. So the error model extends:

- `Telemetry{dropped_channels: Vec<ChannelId>, window_nan: ...}` — a channel stopped
  reporting, or produced non-finite values. Treated as a **soft** fault: the run degrades
  gracefully, drops the channel, and streams a warning, rather than `panic!`/`unwrap`.
- A **no-panic-in-the-solver/task boundary policy**: every threaded chunk (rayon / `spawn_blocking`)
  is wrapped so a hardware path can only return `Err`, never abort. Use `Result`-returns and
  sanitize inputs (`is_finite()` guards) where hardware is the source.
- **No hidden panics from linear-algebra crates.** `nalgebra`/`ndarray` default to `panic!` on
  a singular or ill-conditioned matrix (e.g. `.inverse()`), which would take down the Tauri
  backend instantly. Combustion Jacobians (L1 Gibbs minimizer) routinely turn singular during
  Newton–Raphson iteration, so the code base **mandates `Result`-returning** substitutes
  everywhere: `.try_inverse()`, `qr`/`try_solve`/`try_into_symmetric`, etc. A failed
  factorization folds into `SolveError::NonConvergence{iter,residual}` (or a small
  Tikhonov/LU-with-pivot fallback) rather than aborting. This is enforced by a clippy lint /
  CI grep that rejects `.inverse()` and bare `unwrap()`/`expect()` in `crates/`.
- Input sanitization at the DAQ boundary: replace `NaN`/`inf`/out-of-range with the last good
  value + a `Telemetry` warning, and surface a UI banner instead of a crash.
- A hardware loop can be cancelled (`Cancelled`) and never hangs the main thread — the DAQ
  read is always non-blocking/async, so a wedged controller can't freeze the UI.

---

## 4. Thermochemistry engine (L1) — the highest-risk crate

This is the hardest solver and the one thing holding back L2+. Native Rust, offline, no
CEA binary/Python. Two options, picked by measured robustness:

**Option A — Free-energy minimization (recommended, CEA-like).**
- For fixed T,P, minimize Gibbs free energy over species subject to element-conservation
  constraints (mass balance per element), via Lagrange multipliers → a system of nonlinear
  equations solved by Newton–Raphson on a first-order expansion (the classic "LIQ / JANNAF /
  CEA" formulation).
- NASA 7-term polynomial thermodynamic data (Gordon–McBride coefficients) per species for
  `cp/RT`, `h/RT`, `s/R`; provided by bundled species library (below).
- Solve the flamepoint as two nested problems: (1) equilibrium composition at each T-P,
  (2) the energy balance `h_reactants(T0) = h_products(Tad)` → solve for adiabatic T;
  iterate T and composition until both converge.

**Option B — Frozen/shifting closed-form shortcut (fallback).**
- If A proves flaky for a pair, a tuned frozen gamma / c* from tabulated values (Krzycki's
  `R=65`, `gamma=1.2` numbers made pair-specific) carries L1 as a validation-clamped fallback.
- Honest tier badge: the result still reports **L1** but flags `approx=CEA_grounded`; the UI
  shows the user it is CEA-validated, not CEA-equivalent.

### 4.1 Species library (offline constraint)

Since the shipped binary must be fully offline, we **bundle** a curated species set at build
time (serde-embedded arrays or a generated `.rs`):

- Combustion-relevant species for GOX/LOX + kerosene, ethanol, methanol, methane: CxHy,
  N2, O2, CO, CO2, H2O, H2, OH, H, O, NO, plus light ions later. ~25–40 species covers the
  first tiers.
- Seeds from public NASA Glenn / JANNAF coefficient tables bundled as data files under
  `crates/thermo/data/` and include via `include_str!` or a build script. Hardcode a
  licensing/source note: these coefficient tables are NASA-generated and freely usable.
- Extensible: an optional user-supplied `.cea`/species file (future) without breaking the
  offline default.

### 4.2 Numerical stack

- `nalgebra` or `ndarray` for vector/matrix (per-crate decision; keep it in `thermo` only).
- Jacobian = small dense (n_species + n_elements) Newton solve; use sparse-aware ordering
  only if species count grows past ~60.
- Guards: temperature bracketing, sensible-convergence tolerance, iteration cap, and a
  log-pressure-then-T outer loop to avoid divergent starts.

---

## 5. Gas dynamics & contour (L2)

- Quasi-1D isentropic area/Mach/velocity from L1 `gamma`.
- **Bell contour**: method of characteristics (MoC) marching from a transonic throat, Rao
  (shaped-bell) 90%-power law blending, with divergence + boundary-layer loss correction.
  References: openrocketengine / pyskyfire serve as algorithmic references; pyskyfire backs
  the proven approach (its thesis already couples MoC + cooling).
- Output: axial radius profile `r(x)` sampled into the geometry, plus `Isp` corrected for
  divergence (cosine-ish `λ`) and friction/BL. The contour and its `r(x)` sample table are
  stored in the design entity so **L3 cooling and the renderer read the same profile.**

---

## 6. Cooling (L3)

- 1D axial mesh `x ∈ [chamber|nozzle]` with `r(x)` from L2. At each station:
  - Gas-side: **Bartz** `hg` (empirical, handles the high-enthalpy gas, uses L1 gas props).
  - Coolant-side: **Gnielinski** (transitional/turbulent liquids) with Dittus–Boelter
    fallback; Nusselt from channel gap/velocity; handle regime change.
  - Energy balance + wall conduction (k from material) → `T_wall(x)` vs `T_limit`.
  - Boiling margin: film/nucleate boiling onset correlate vs local wall/enthalpy, flag when
    overrun.
- Because coolant and wall temps couple to the flow (coolant heats as it moves), this is a
  small boundary-value marching problem with a few inner iterations. Chunked/progress-aware.
- Options: regenerative (default), film cooling, ablative liner (material-driven) — the
  modular trait returns a `CoolingMargin` per station.

Validation reference: Bamboo (Cambridge University Spaceflight) is a validated Bartz+Gnielinski
solver; we compare our margin curves to its published validation engine.

---

## 7. External-module interface & export crate

`export` produces, from the design entity + a valid solve:

- **PDF design report** (via a Rust PDF generator, e.g. `printpdf`, or SVG → PDF) — works
  offline, no Chrome. Cross-section figure rendered from `geometry` + dimension callouts.
- **DXF** for the 2D drawing (simple; line/arc emit from contour + jacket).
- **P&ID** (SVG/PDF) from the `feedsystem` model.
- **Checklists** (ignition/abort) from rules tables.
- **STEP/RON** — via the **Truck** CAD kernel (already the suite-wide kernel). A thin trait
  adapter `GeometryModeler` keeps Truck out of the solver crates; `export` is the only crate
  that imports Truck, so the solver core stays kernel-agnostic. This is the APRO Works
  integration point: AI Mesh thumbs the same `geometry` entity, HexaDOF reads the thrust
  curve object, AI CAD reads/writes the same RON.
- **Truck fallback (mesh export).** Truck is a young pure-Rust B-Rep kernel; generating the
  B-Rep lofts/sweeps for a regeneratively-cooled jacket wrapped around a Rao bell contour may
  exceed its current surface-modeling API for complex geometry. Because `GeometryModeler`
  isolates it, `export` also ships a **fail-open mesh path**: if B-Rep export (or its
  tessellation) errors, fall back to a raw **polygon mesh (OBJ/STL)** generated from the same
  `r(x)` contour + channel curve set. The design, downstream AI Mesh, and the 3D viewer all
  consume the bounded mesh fine; only downstream precision-CAD tooling wants STEP. The mesh
  fallback is non-negotiable so a hard export never blocks `Test & Safety` reporting.

---

## 8. Frontend (React + TS + Vite)

- **State**: Zustand store mirroring the RON design entity (`canonical SI`). Seeded from
  `engine-core`'s serde JSON shape (shared serde structs across IPC — one set of types,
  compiled both sides via `ts-rs` type codegen from the Rust structs, to keep Rust and TS in
  lockstep).
- **Typed IPC (granular deltas, not full-state sync).** Shipping the entire `EngineDesign`
  tree over serde on every keypress is fine at L0 (tiny payloads) but becomes the latency
  bottleneck at L2/L3, where the design holds dense arrays — the `r(x)` nozzle contour and
  the 1D axial mesh temperature/pressure profiles. So the IPC contract is **delta-based**:
  - `set_field(field_id, value)` dispatches one scalar/param change with a stable field id
    (e.g. `set_chamber_pressure`), returning **only** that field's acknowledged id + its
    recompute-invalidation set. The frontend patches its Zustand store locally.
  - Heavy arrays (`r(x)`, `T_wall(x)`, the axial mesh, contour points) are **not** transferred
    during normal edits. They are fetched on demand: when the 3D viewer/chart mounts, or when
    a tier solve completes and the UI explicitly requests `get_tier_array(tier, array_id)`.
  - A `subscribe(array_id)` streaming channel pushes big-array updates only to live
    subscribers, so mounting the 3D view doesn't imply re-sending on each keystroke.
  - Shared serde structs are mirrored to TS via `ts-rs` codegen so Rust/TS stay in lockstep
    without hand-typed duplicates.
- **ts-rs desync is a repo-level (CI), not a discipline, problem.** `ts-rs` generates the TS
  bindings as a side effect of the build/test. If someone edits a Rust struct in `engine-core`
  but forgets to run the generator before committing, the frontend silently desyncs → broken
  IPC payloads and chaotic debugging. So lockstep is **enforced**, not assumed:
  - Codegen output is committed (a generated `bindings.ts`), and the generator is **re-run and
    `git diff`-checked** in CI: CI fails if regenerating produces uncommitted changes.
  - A **pre-commit hook** (husky or a thin `pre-commit` script) runs
    `cargo test ts_rs --workspace` (or the dedicated codegen step) and **halts the commit** if
    `bindings.ts` differs from the re-generated output. No commit, no merge adds on drift.
  - Put the tauri IPC `set_field`/`get_tier_array` command signatures behind this same
    generated type set so both sides compile against one source of truth.
- **Charts**: Recharts (2D performance maps, transient lines).
- **3D**: react-three-fiber for nozzle contour + cooling channel routing QA.
- **UI language**: dark / frosted-glass panels, Space Grotesk + JetBrains Mono, orange
  accents, per spec; tier badge component on every metric.

Workspaces: `Design` (params + live 2D cross-section w/ callouts), `Simulate` (maps,
transients, sweeps, Pareto), `Test & Safety` (P&ID, checklists, bolt/pressure, report).

---

## 9. Validation & test strategy

1. **L0 golden test (regression anchor)** — `tests/golden/krzycki_20lbf.rs`: reproduce
   Krzycki's 20 lbf / 300 psi / GOX-gasoline worked example value-by-value:
   `w = 0.077 lb/s`, `A_t = 0.0444 in²`, `D_t = 0.238 in`, `A_e/A_t = 3.65`,
   `chamber wall t = 0.0225 in`, `water cooling gap = 0.0425 in`, etc. Driven through
   `apro-engine-cli`, asserted against a `tests/fixtures/krzycki_20lbf.json`. This is the
   **L0 acceptance gate**.
2. **L1/L2 vs NASA SP-125 (Huzel & Huang)** — the professional worked example in SI,
   cross-checked end to end. Gate for L1/L2.
3. **L3 validation** — reuse Bamboo's published validation engine values as a comparison.
4. **Per-equation unit tests** in each crate (Bartz regression, Gnielinski, MoC throat
   invariant, hoop stress). Every solver change runs the full suite in CI.
5. **Property-based checks** where safe (e.g. `c*` monotonic in a small band, throat/Mach
   `M=1` condition at the throat). No flaky numerical assertions; use tolerances.

---

## 10. Build sequencing mapped to the roadmap

Milestones are gated: a milestone ships only when its tests and the previous gates pass.

**Status:** M0–M5 are **implemented and green** (the MVP→V3 roadmap). M6 is future.
This section records the plan; the build status of each tier is tracked by its tests.

### M0 — Scaffold (est. 0.5–1 wk)
- Cargo workspace, `rust-toolchain.toml`, shared `[workspace.dependencies]`.
- `engine-core`: design entity, units (`uom`), RON, provenance/dirty scaffolding, ts-rs
  type codegen stub.
- Empty crates for every plane + `apro-engine-cli` skeleton.
- Vite + React + Tauri v2 app skeleton; first IPC round-trip (`get_design`).
- **Status: complete.**

### M1 — MVP / L0 (the core value; est. 2–3 wks)
- `propellants` (GOX/hydrocarbon seeded pairs + copper/steel materials table), `sizing-l0`.
- **Gate: Krzycki 20 lbf golden test passes value-for-value** (L0 acceptance).
- Design wizard, live 2D cross-section with callouts, PDF report (L0 numbers, graded L0).
- *This is the "does this engine make sense" one-sitting deliverable.*
- **Status: complete.**

### M2 — V1a: L1 thermochemistry (highest risk; est. 3–5 wks)
- CEA-style Gibbs minimizer + bundled species library + energy-assed adiabatic `Tad`.
- **Gate: L1 reproduces NASA SP-125 c*/Tc within tolerance; honest L1 badge.**
- Fallback frozen-gamma clamp if optimizer unstable for a pair.
- **Status: complete** (validated against a CEA-type LOX/CH₄ reference; the exact SP-125
  cross-check awaits the SP-125 numbers).

### M3 — V1b: L2 nozzle contour + simulation module (est. 2–3 wks)
- Quasi-1D flow + MoC Rao bell contour + divergence/BL correction.
- Steady-state perf maps (O/F, altitude, throttle) + transient start/shutdown + stability
  screening heuristics. Charts wired.
- **Status: complete.** (Bell contour is the Rao *parabolic* approximation; a true MoC
  Rao bell is the rigorous upgrade.)

### M4 — V2: L3 cooling + L4 structures + test/safety tools (est. 3–4 wks)
- Bartz/Gnielinski regen channel solve, cooling margin curves; shell stress/thermal stress/
  buckling/bolt capacity.
- P&ID generator, checklists, bolt/pressure calc, doc export.
- **Gate: L3 margin curves match Bamboo validation engine.**
- **Status: complete** (Bartz/Gnielinski solved; the L3 transport properties and the
  Bamboo-validation gate are the deeper refinement).

### M5 — V3: L5 feed/transients + optimizer + suite integration (est. 3–4 wks)
- Fluid network solver, tank/valve/regulator sizing, start/shutdown transients, hard-start
  flag; trade-study optimizer (grid/gradient-free) + Pareto front.
- HexaDOF thrust-curve export hook, AI Mesh / AI CAD geometry IDs.
- **Status: complete** (trade-study Pareto front and a nominal thrust-curve export; a
  physics-based transient ODE model is a future refinement).

### M6 — V4+ (future)
- L6 CFD/FEA bridge, ML-surrogate-accelerated optimizer, shared-workspace collaboration.

### Timeline reality check (M0–M5)

Rough sums above land at **11–18 weeks**. Treat that as **optimistic serial** effort for one
person. Add a ≥20% buffer → plan on **14–22 weeks**, and treat M2 (L1 thermochemistry) as the
real schedule risk: if the equilibrium solver hitches, everything downstream slips. De-risking
order is why M2 is sequenced before the noise/cooling polish — don't let a later milestone bank
the earliest on a hard solver.

### Ownership & parallel-work boundaries (you + Danish)

For two people to run in parallel without stepping on each other, the split is **ruthless and
distinct**, with the **IPC layer** (inside `engines/app/src-tauri`) as a written API contract
between the two halves:

- **You — the Rust computation side:** `engine-core`, `propellants`, `sizing-l0`, `thermo`,
  `gasdynamics`, `cooling`, `structures`, `feedsystem`, `simulate`, `export` math, and the
  `apro-engine-cli`. Own the numerics, the golden tests, and CI gates.
- **Danish — the frontend side:** the Zustand store, all `Design`/`Simulate`/`Test & Safety`
  screens, Recharts integration, react-three-fiber 3D view, styling, and the generated `bindings.ts`.
- **The IPC layer is a strict contract.** It is the *only* place that touches both worlds.
  You define the command signatures (`set_field`, `get_tier_array`, `resolve_tiers`,
  `run_transient`, `generate_report`, `subscribe`) and the delta/array shapes; Danish consumes
  them without reading your solver internals. If the contract is respected, both halves build
  in parallel and only re-merge at the IPC layer. Changes to the contract are PRs, agreed, not
  silent edits.
- Ground rule mirrors the ts-rs enforcement: the IPC contract is type-checked through the
  same generated types, so a signature change is a visible merge conflict, not a silent drift.

---

## 11. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| L1 equilibrium solver destabilizes for some pairs (highly nonideal, frozen at low T) | Blocks L2+ | Fallback frozen-gamma/CEA-clamped L1; honest badge; robust bracketing + iteration caps |
| Tauri v2 + async progress streaming hangs UI | UX risk | CPU-bound kernels never on tokio threads (`spawn_blocking`/`rayon`); SolveContext cancellation + chunked solve + dedicated CPU pool; only TCP/IO orchestration on the UI thread |
| Float drift in recompute graph → endless recomputes | Silent perf/UX degradation | Quantize every dimensioned input to an engineering tolerance before `inputs_hash`; canonical `f64` never mutated |
| IPC full-state sync causes lag at L2/L3 (dense arrays) | UX risk | Delta-based `set_field` IPC; heavy arrays fetched only on explicit subscribe/mount |
| Truck CAD kernel can't B-Rep complex regen jacket | Export failure | `GeometryModeler` isolation + fail-open OBJ/STL polygon-mesh fallback |
| Real/imperial unit drift in solver code | Silent wrong numbers | Canonical SI only; units-in-UI-only; imperial conversion confined to engine-core `compat` |
| RON schema drift / migration pain | Multi-year risk | Versioned schema + explicit `migrate()` pipeline + per-version loader structs |
| Truck CAD kernel coupling leaks into solver crates | Coupling / IP risk | Only `export` imports Truck behind a `GeometryModeler` trait; solvers stay kernel-agnostic |
| Bundled thermo data licensing/source ambiguity | Release risk | Curate public NASA/JANNAF coefficients + license note; keep species set documented |
| ts-rs generated types desync from Rust structs (forgotten codegen re-run) | Broken IPC, chaotic debugging, wasted time | Commit generated `bindings.ts`; CI re-runs codegen and fails on `git diff`; pre-commit hook halts the commit if drift is found |
| Hardware/DAQ telemetry (dropout, `NaN`, bad solder) crashes the backend | Test-stand run aborts + UI crash | No-panic task/policy with `Result`-returns; sanitize `NaN`/inf/out-of-range to last-good + `Telemetry` warning; async, cancellable DAQ reads; graceful degradation not `unwrap()` |
| Two-person parallel work collides at the IPC layer | Merge churn / silent contract drift | `tauri-bridge` as a strict written contract; both halves only meet at that file; signature changes are agreed PRs and type-checked via the generated types |
| Hidden panic from `nalgebra`/`ndarray` `.inverse()` on a singular Jacobian (L1 Gibbs) | Instant Tauri backend crash | Mandate `Result`-returning `.try_inverse()`/`try_solve`; singular Jacobian → `SolveError::NonConvergence`; clippy/CI grep bans bare `.inverse()`, `unwrap()`, `expect()` in `crates/` |
| L3 cooling correlation blows up on near-zero gap / laminar velocity | Divergent solve, divide-by-zero, wasted CPU | `TierSolver::relevance` = hard pre-flight domain gate returning `OutOfDomain` before the pool runs; UI disables the offending input inline |
| Tauri bundler fights a standalone IPC crate (build-script home, workspace layout) | Build/CI hell | Collapse IPC into `engines/app/src-tauri`; no standalone `tauri`-dependent crate; physics crates stay Tauri-free |

---

## 12. Current status & next steps

**M0–M5 are built and green** (the MVP→V3 roadmap). Run it end to end:

- Solver workspace: `cargo test --workspace` (all tiers L0–L5 tested).
- CLI: `apro-engine new|verify|resolve|golden|map|trade|thrustcurve|report|safety`.
- Desktop app: `npm --prefix frontend run tauri dev`.

**Next candidates (in priority order):**
1. **Hardening / accuracy refinements** to the built tiers: true MoC Rao bell contour (L2),
   real gas transport properties + Bamboo-validation gate (L3), physics-based start/shutdown
   transient ODE (L5), and a richer mass model for a multi-point Pareto front.
2. **Exact SP-125 golden test** (needs the SP-125 numbers from the reference).
3. **M6**: L6 CFD/FEA bridge, ML-surrogate-accelerated optimizer, shared-workspace
   collaboration.
4. **ts-rs bindings** codegen + pre-commit/CI enforcement (so Rust/TS stay in lockstep).
