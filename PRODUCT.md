# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Shipped as a Tauri desktop app on Windows (primary), macOS and Linux. The UI is a React/Vite web frontend inside the Tauri shell; the browser-dev mode (`vite dev` against the in-browser mock in `frontend/src/api.ts`) is a development harness, not a user-facing target.

## Users

Three confirmed audiences, all designing liquid rocket engines they intend to build or take further:

- **University rocketry teams** designing, building and hot-firing an engine for a competition or club program, often learning the propulsion physics while they design.
- **Amateur / hobby builders** working on small pressure-fed engines (e.g. GOX/gasoline, N₂O/propane) for a garage or club test stand.
- **Startup and professional propulsion engineers** doing preliminary design before committing to CFD/FEA and test campaigns.

The shared job: go from top-level requirements (thrust, chamber pressure, mixture ratio, propellant) to a sized, analyzed, exportable engine, then interrogate and change the assumptions behind the result.

## Product Purpose

Propulsor sizes and simulates an entire liquid rocket engine — thermochemistry, nozzle contour, cooling, structures, injector, turbomachinery, feed system and control — from a handful of requirements, renders the designed geometry in 3D, runs trade studies, validates against test data, and exports CAD and analysis files.

Success: a user can take a design from requirements to hardware-ready geometry and analysis inside one tool, and trust the numbers enough to make real design decisions with them.

## Positioning

**The whole engine, in one tool.** Combustion, nozzle, cooling, structures, injector, turbomachinery, feed system, control, 3D, trades, validation and CAD export live in a single desktop application working on a single design — where the alternatives (RPA, CEA, spreadsheets, separate CAD) each cover a slice and leave the user to stitch them together.

## Operating Context

- Desktop sessions on an engineer's or student's own machine; Windows is the primary platform.
- Work proceeds through a six-step Design wizard (propellant & mission → performance/O-F → nozzle & expansion → cooling → turbomachinery → review/export), then into per-subsystem tabs: Dashboard, 3D Model, Cross-section, Cooling, Turbopumps, Blades, Analysis, Validation, Feed System, Control, Assembly, Trades, Performance.
- Designs are saved as RON project files (`*.apro-engine.ron`) with schema-versioned migration.
- Outputs leave the tool as STL, DXF and STEP geometry, CSV analysis data (including FEM boundary data) and P&ID / avionics harness artifacts, feeding CAD, FEA and test-stand work.
- Validation consumes real telemetry CSV from the user's own test fires, matched by sensor id.

## Capabilities and Constraints

- **Fidelity tiers:** the engine is solved as a dependency chain L0 (analytical sizing) → L1 (equilibrium thermochemistry) → L2 (nozzle contour) → L3 (cooling) → L4 (structures) → L5 (feed system); L6 is reserved. Editing an input invalidates dependent tiers, which re-resolve live.
- **Live, persisted inputs:** every subsystem assumption is an input saved with the design, marked when customized, and resettable per subsystem. Defaults and ranges are grounded in NASA/industry references (NASA SP/TM/CR, Huzel & Huang, Sutton & Biblarz, Krzycki).
- **No pre-fed design:** the app opens blank. Every tab except Design shows a "Start your design" prompt until thrust, chamber pressure, mixture ratio and propellant are set.
- **Propellants:** 10 pairs (GOX/Kerosene, GOX/Gasoline, GOX/Ethanol, GOX/Methanol, LOX/RP-1, LOX/Ethanol, LOX/Methane, N₂O/Propane, NTO/MMH, NTO/UDMH).
- **Architecture:** Rust multi-crate compute core, exposed to the UI over Tauri IPC; a headless CLI (`tools/apro-engine-cli`) shares the same solver crates.
- **Units:** SI and imperial; stored canonically in SI.
- **Engineering-grade posture (confirmed):** the product intends its results to be relied on for real design decisions, with validation against test data as the trust mechanism. Consequences: models that are not yet calibrated stay disabled rather than shipped as authoritative (e.g. "Apply derived c* efficiency" is disabled until the ERE is calibrated); margins, redlines and solve status must stay visible.
- **Open:** a prior issues audit (68 bugs, 19 missing options) drove recent work; the options were addressed but the bugs have not been re-audited.

## Brand Commitments

- Product name **Propulsor**; publisher **APRO Works** (bundle id `com.apro.propulsor`, window title "Propulsor — Liquid Engine Designer").
- App icon set exists under `engines/app/src-tauri/icons/`.
- The incumbent Qt "Fusion"-style desktop theme is **not binding**: the user wants a better theme if one is possible.
- **Stated visual preference (binding, revised 2026-10-14):** "a sleek but engineering advanced display", in the calibre of Siemens NX / Ansys / Onshape with the restraint of SpaceX / Tesla vehicle UI. A CAD-style workbench: feature tree, an always-on interactive 3D engine at centre stage, inspector panel. The bold treatment lives only in the 3D viewport (hot gas, plume, section cut); the rest stays calm. No neon or glow. Must not read as a generic SaaS dashboard. (Supersedes the 2026-10-13 "blueprint / sci-fi / game UI" preference, which the user rejected as "too much everywhere".)

## Evidence on Hand

- Golden/validation tests: `crates/sizing-l0/tests/krzycki_20lbf.rs` (Krzycki 20 lbf engine reproduction) and `crates/thermo/tests/l1_validation.rs` (CEA cross-validation).
- Reference documentation: `DOCUMENTATION.md`, `USER_GUIDE.md`, `docs/ARCHITECTURE.md`.
- **Absent:** no bundled real test-fire data — the Validation tab runs on synthetic data until the user imports telemetry. No customers, testimonials, published benchmarks, pricing or licensing terms exist; future work must not invent them.

## Product Principles

1. **One engine, one place.** Every subsystem works on the same design; a capability that forces the user out to another tool and back is a gap.
2. **Earn trust, don't assert it.** Engineering-grade means showing provenance, margins, solve state and uncertainty, and withholding models that aren't calibrated rather than presenting them as authoritative.
3. **The user's numbers, never ours.** Nothing is pre-fed; defaults are sourced and visible, and any value the user changes stays theirs until they reset it.
4. **Live consequence.** An edit anywhere propagates to every dependent result and view immediately, so the user learns cause and effect by changing things.
5. **Serve the student and the professional alike.** Depth must stay reachable for a startup engineer without walling a university team out of the guided path.
