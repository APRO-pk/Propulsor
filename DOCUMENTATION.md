# Propulsor — Liquid Rocket Engine Designer

**Full application documentation**

Propulsor is an end-to-end **liquid rocket engine design tool**. You enter a handful of top-level requirements (thrust, chamber pressure, mixture ratio, propellant, expansion) and it sizes and simulates the entire engine — combustion thermochemistry, nozzle contour, cooling, structures, injector, turbomachinery, feed system, control system — and lets you drive **every design assumption** as a live, saved input. It renders the real designed geometry in 3D, runs trade studies and optimizations, validates against test data, and exports CAD and analysis files.

---

## 1. What it is

- **Desktop app** (Tauri) with a Qt-style "Fusion" desktop UI, plus a **browser-dev mode** that runs the same UI against an in-browser mock of the compute backend.
- A **Rust compute core** organized as a multi-crate workspace, exposing its results to the UI over Tauri IPC commands.
- A **React + Vite + TypeScript** frontend with **react-three-fiber / three.js** 3D viewers and **recharts** plots.

### Design philosophy: fidelity tiers

The engine is solved as a dependency chain of fidelity tiers, each consuming the previous one. Editing any input invalidates the dependent tiers and re-resolves them live.

| Tier | Name | What it computes |
|------|------|------------------|
| **L0** | Analytical sizing | Flow rates, throat/exit areas, chamber volume & length, wall thickness, Isp, c\* |
| **L1** | Thermochemistry | Equilibrium combustion (Gibbs free-energy minimization): Tc, γ, MW, c\*, species |
| **L2** | Nozzle contour | Quasi-1D flow + true Rao/MoC bell (or conical) contour, exit Mach/pressure, divergence loss |
| **L3** | Cooling | Regenerative/film/radiation/ablative wall thermal solution, per-station heat flux |
| **L4** | Structures | Distributed (FEM-like) wall stress: hoop + thermal, margins |
| **L5** | Feed system | Tanks, pressurant, feed pressure budget, transients |
| **L6** | (reserved) | — |

---

## 2. Application layout (tabs)

The main window has a left **Design** panel, a center **tabbed viewer**, and a right **Properties** panel showing live L0/L1/L2 results.

| Tab | Purpose |
|-----|---------|
| **Design** | Step-by-step design wizard (propellant & mission → performance/O-F → nozzle & expansion → cooling → turbomachinery → review/export) |
| **Dashboard** | Key results at a glance, unit converter, and test-data validation summary |
| **3D Model** | Interactive 3D of the designed engine (revolved contour, chamber, nozzle) |
| **Cross-section** | 2D section view of the contour with wall/cooling detail |
| **Cooling** | Wall material + cooling method, thermal results, material database, **AM print plan** |
| **Turbopumps** | Pump/turbine/inducer/shaft/bearing sizing + gas-generator cycle balance |
| **Blades** | Blade profiling (pump impeller, subsonic & supersonic turbine) + meanline losses + characteristic maps |
| **Analysis** | Injector fluid-flow, combustion instability, distributed wall stress, **computed c\* efficiency (ERE)** |
| **Validation** | Sensor/position validation, startup transient, **import real telemetry CSV** |
| **Feed System** | Tanks, pressurant, feed budget, **P&ID schematic**, **avionics electrical harness** |
| **Control** | Closed-loop control model: Pc/MR loops, sensors/valves, chamber dynamics, throttle step response |
| **Assembly** | 3D vehicle assembly (real nozzle + tanks + pressurant + feed lines), **animated exploded view** |
| **Trades** | Trade studies & optimization sweeps (O/F, expansion, L\*, material, injector) with Pareto |
| **Performance** | Steady-state performance map (Isp/thrust vs O/F × altitude) |

---

## 3. Core capabilities by subsystem

### 3.1 Propellants & combustion (thermo)
- **10 propellant pairs**: GOX/Kerosene, GOX/Gasoline, GOX/Ethanol, GOX/Methanol, LOX/RP-1, LOX/Ethanol, LOX/Methane, N₂O/Propane, NTO/MMH, NTO/UDMH.
- **Equilibrium thermochemistry** via Gibbs free-energy minimization using NASA 7-coefficient (Glenn) polynomials.
- Broadened species set (CO₂, CO, H₂O, H₂, O₂, OH, H, O, N₂, NO, NO₂, N, …) with CEA cross-validation.
- Optimal O/F search; adiabatic flame temperature, γ, mean molecular weight, characteristic velocity c\*.

### 3.2 Nozzle & gas dynamics (gasdynamics)
- Quasi-1D isentropic nozzle flow (area–Mach, pressure/temperature ratios).
- **True Rao thrust-optimized (TOP) bell**: downstream throat arc + method-of-characteristics/quadratic-Bézier parabola using Rao θn/θe chart angles — not just a parabolic approximation.
- Conical nozzle option with divergence-loss correction.
- Exit Mach/pressure/temperature, divergence (λ) and boundary-layer corrections, delivered Isp.

### 3.3 Cooling (cooling)
- **Regenerative** cooling with per-station heat flux, hot/cold wall temperatures, coolant ΔP, boiling margin.
- **Film**, **radiation**, and **ablative** cooling strategies.
- **Material database**: OFHC Copper, CuCrZr, Inconel 718, SS 316L, Niobium C-103, Carbon-Carbon (+ Silica/Carbon-Phenolic ablatives) — conductivity, service temp, allowable stress, CTE, emissivity.
- **Multi-material / functionally-graded additive-manufacturing (AM) build plan**: splits the engine into axial regions (chamber barrel, precision throat, diverging nozzle, radiation skirt), assigns each an AM process (LPBF green-laser for copper, inert-preheat for refractory, etc.), and inserts a **functionally-graded transition** at each dissimilar-material seam (blend length scaled by CTE mismatch). Rendered as a 3D region-banded engine.

### 3.4 Structures (structures)
- Distributed (FEM-like) wall-stress field over chamber + nozzle stations: hoop stress + thermal stress, combined stress and safety margins, yield check.
- Exportable stress-field CSV (FEM boundary data).

### 3.5 Injector (injector)
- Orifice sizing, injection velocity, discharge coefficient, pressure-drop budget.
- Element types: unlike-doublet, like-doublet, coaxial.
- **Atomization**: Weber number and Sauter mean droplet diameter (SMD).
- **Combustion instability** (SP-8113 style): acoustic modes (1L/1T/1R), dominant mode/regime, Crocco n–τ stability margin.
- **Computed combustion (c\*) efficiency — ERE**: derived from **residence time (from L\*)**, **atomization** (SMD), and **inter-element mixing** (element density & ΔP) instead of a fixed factor; applies back to the design's c\* efficiency to re-resolve Isp.

### 3.6 Turbomachinery (turbopumps)
- **Pumps**: centrifugal/mixed/axial sizing, NPSH & cavitation margin, specific speed, head rise, shaft power.
- **Inducer**: anti-cavitation front stage, suction specific speed, flow coefficient.
- **Turbine**: pressure ratio, spouting velocity, U/C₀, power, exit temperature.
- **Mechanicals**: shaft (torque, critical speed), rolling-element bearings (DN limit, L10 life), gears, seals.
- **Power cycles**: open gas-generator and closed staged-combustion cycle with pump↔turbine power balance.
- **Blade profiling**: centrifugal pump impeller (camber + thickness, Wiesner slip), subsonic axial turbine rotor, and **supersonic turbine blade** (circular-arc / fixed-edge / method-of-characteristics transition).
- **Meanline loss models** (build-ups, not single efficiencies): pump (incidence/friction/diffusion/disk/leakage), turbine (Soderberg profile/secondary/tip-clearance/exit-kinetic).
- **Off-design characteristic maps**: pump H–Q family across shaft speeds (affinity laws) + efficiency curve; turbine diagram-efficiency vs U/C₀.
- **Design guardrails** (from NASA references): impeller tip-speed limit by material (274 m/s Inconel/LOX … 610 m/s Ti/LH₂), bearing DN limit 1.6–2.1 M, turbine PR 8–20 range, **turbine type recommendation from U/C₀** (SP-8107: <0.2 velocity-compounded, 0.2–0.34 pressure-compounded, >0.34 reaction).

### 3.7 Feed system (feedsystem)
- Tank sizing (propellant mass, volume, diameter/length, wall thickness, mass) from burn time & architecture.
- **Feed architectures**: self-pressurizing, pressure-fed (with pressurant), pump-fed — auto-recommended or user-selected.
- **Pressurant**: gas choice (He/N₂/Ar), sizing factor, storage bottle (up to ~270 atm).
- Feed **pressure budget**: chamber + injector ΔP + line ΔP = required tank pressure.
- **P&ID schematic** reflecting the architecture (tanks, valves, pumps, pressurant, injector, chamber).
- **Avionics electrical harness**: derived channel list (main/vent valves, igniter exciter, pressure transducers, thermocouples, pump controllers), wire gauge sized to current, connectors, **star-topology wiring diagram** color-coded by signal type, and a **power budget** (bus voltage, peak/continuous current, battery Wh & mass, harness mass & wire length). Supports single/dual redundancy.

### 3.8 Control system (feedsystem::control)
- Closed-loop model per NASA TM-105318: **thrust (Pc) slow loop** + **mixture-ratio (MR) fast loop**, both PI.
- Sensor & valve suite derived by cycle (pressure-fed MOV/MFV; gas-generator throttle + ox valve, turbine-temp sensors/redlines).
- **Chamber dynamics**: fill time τ = V_c/(c\*·A_t) + combustion dead time σ.
- **Closed-loop throttle step response** (digital PI on first-order + dead-time plant, IMC-tuned to loop bandwidth), with settling time & overshoot.
- Redlines (chamber overpressure, turbine temperature), open-loop startup/shutdown note.
- **Guardrails**: warns when a loop bandwidth exceeds ~1/10 the sample rate or the combustion-dead-time limit.
- Two-loop **control block diagram** (Σ → PI → valve → engine → sensor).

---

## 4. Full design-input freedom

Beyond the top-level requirements, **every subsystem assumption is a user input** that is **saved with the design and re-resolves live**. Inputs commit on blur/Enter, are marked when customized, and each subsystem has a "Reset to defaults" control. Defaults and validation ranges are grounded in NASA/industry references.

**Top-level (persisted design fields):** thrust, chamber pressure, mixture ratio (O/F), propellant pair, expansion ratio, characteristic length L\*, nozzle kind (Bell/Conical), chamber & nozzle materials, cooling method, c\* efficiency.

**Per-subsystem inputs (dotted `namespace.key` design parameters):**
- **Blades** (`blade.*`): pump blade count Z, outlet blade angle β₂, inlet axial velocity, pump efficiency, impeller material, inducer hub ratio; turbine blade count, nozzle angle α, drive-gas cp/Tin/γ/pressure-ratio, GG flow fraction; supersonic blade count; loss knobs (clearance, aspect ratio, U/C₀).
- **Turbopumps** (`turbo.*`): pump/turbine efficiency, suction specific speed, inducer hub ratio, tank & discharge pressure, GG flow fraction, drive-gas cp/γ/Tin, turbine exit pressure, bearing bore/DN limit/life, shaft allowable shear.
- **Feed** (`feed.*`): injector ΔP fraction, line ΔP, pump-fed tank pressure, tank L/D, ullage factor, wall allowable/density, test factor, pressurant gas/factor/bottle pressure.
- **Avionics** (`avionics.*`): bus voltage, redundancy (single/dual), battery reserve factor, battery specific energy, housekeeping current, main-valve & igniter current, wire-run override.
- **Control** (`control.*`): Pc & MR loop bandwidths, sample rate, combustion dead time, throttle step target, turbine-temperature redline.
- **Injector** (`injector.*`): element type/count, ΔP fraction, discharge coefficient, surface tension, fuel/ox density ratio, combustion time lag τ, interaction index n.
- **Cooling detail** (`cooling.*`): film coolant temperature/density/velocity/slot height/injection point, ablative material/burn time/safety factor, radiation ambient temperature.

---

## 5. 3D & visualization

- **3D Model**: revolved engine contour (real Rao bell / conical) with interactive orbit/zoom.
- **Assembly**: full vehicle — real revolved nozzle + chamber, injector plate, oxidizer/fuel tanks (sized from the feed study), **pressurant bottle** (pressure-fed only), feed lines, translucent airframe. **Animated exploded view** separates every part along the stack axis with leader labels. Updates live with any design change.
- **Blades**: 3D pump impeller / turbine rotor / supersonic rotor rings, 2D blade profiles, loss bars, H–Q and efficiency maps.
- **Cooling**: 3D region-banded engine colored by AM material, FGM composition-ramp bars.
- **Analysis**: distributed-stress strip (FEM contour), ERE breakdown bars.
- **Validation**: 3D sensor-position map (pressure taps / thermocouples), predicted-vs-measured pressure & temperature profiles, startup transient chart.
- **Control**: two-loop block diagram + closed-loop step-response chart.
- **Feed System**: P&ID schematic + avionics wiring diagram.
- **Performance**: Isp/thrust performance-map plots.

---

## 6. Trade studies, validation & I/O

### Trade studies & optimization
- O/F sweep (optimal O/F), expansion-ratio sweep (optimal ε, sea-level vs vacuum Cf), L\* sweep, material trade, injector element-count trade, Pareto front.
- Steady-state performance map across O/F × altitude.
- Design-advice engine (recommended O/F, L\*, expansion for a target burnout altitude).

### Validation
- **Sensor/position validation**: spatial predicted-vs-measured pressure & wall-temperature profiles, residuals + RMS, 3D sensor positions.
- **Startup transient**: predicted vs measured thrust & Pc over time.
- **Import real telemetry (CSV)**: match sensor data by id and interpolate transient logs onto the predicted grid; recomputes residuals/RMS and flips the data source from synthetic to imported. Template downloads and clear provided.

### Export / CAD
- **CAD**: STL, DXF, STEP export of the engine geometry.
- **Data**: nozzle contour CSV, thrust-curve CSV, per-station heat-flux CSV (FEM BC), distributed stress-field CSV, sensor-residuals CSV.
- **Project files**: RON-based save/load (`*.apro-engine.ron`) with schema-versioned migration.

---

## 7. Architecture & tech stack

**Backend (Rust workspace crates):**
`engine-core` (canonical design entity, tiers, units, persistence, the `params`/`choices` design-parameter bag) · `thermo` (equilibrium combustion) · `gasdynamics` (nozzle/contour) · `cooling` (thermal, materials, AM printing) · `structures` (stress) · `injector` (flow, instability, ERE) · `turbopumps` (pumps/turbines/blades/losses/maps/cycles) · `feedsystem` (tanks, avionics, control) · `sizing-l0` (analytical sizing) · `propellants` (property database) · `simulate` (orchestration: resolve chain + all the "studies") · `export` (CSV/CAD) · `tools/apro-engine-cli`.

**Desktop shell:** Tauri app (`engines/app/src-tauri`) exposing ~12 IPC commands: `get_design`, `set_field`, `perf_map`, `design_advice`, `cooling_study`, `turbopump_study`, `analysis_study`, `blade_study`, `feed_study`, `control_study`, `validation_study`, `trade_bundle`.

**Frontend:** React 18 + Vite + TypeScript; `zustand` state store; `react-three-fiber` + `drei` + `three` for 3D; `recharts` for plots. A browser-dev mock (`api.ts`) mirrors every Rust study so the full UI runs under `vite dev` without the desktop backend. Reusable `ParamField`/`ParamChoice`/`ResetParams` inputs persist through `set_field` and re-resolve live.

**Persistence & live updates:** a single edit → `set_field` → invalidate dependent tiers → re-resolve → UI refresh. Per-subsystem inputs live in a persistent `params`/`choices` bag on the design, read by studies with physical defaults, so any knob is saved with the project and updates every dependent view (including the 3D assembly) immediately.

---

## 8. Reference basis

Defaults, correlations, and guardrails are grounded in published sources, including:
- NASA/Wiley — Cannon, *Propellant Feed System Design* (feed & turbopump defaults, pressurant, NPSH, tip-speed limits).
- NASA SP-8107, *Turbopump Systems for Liquid Rocket Engines* (specific speed, suction specific speed, turbine type vs U/C₀).
- NASA MSFC, *Simplex Turbopump Design* (real design anchor values).
- NASA TM-105318, *Overview of Rocket Engine Control* (Pc/MR loops, PI control, chamber dynamics, sensor/valve suites).
- Krzycki / Huzel & Huang / Sutton & Biblarz style analytical sizing and injector/instability criteria; NASA Glenn thermodynamic polynomials.

---

*Generated with [Claude Code](https://claude.com/claude-code)*
