# Propulsor — Complete User Guide

*How Propulsor works, how a design is built step by step, and what every tab takes and gives.*

Propulsor is a liquid rocket engine **design tool**. You give it your requirements — thrust, chamber pressure, mixture ratio, propellant — and it sizes and simulates the whole engine: combustion, nozzle, cooling, structure, injector, turbomachinery, feed system and control. You can then open up **every** design assumption as a live input, see the engine in 3D, run trade studies, validate against test data, and export CAD.

---

## 1. How it works (the core idea)

### Fidelity tiers
The engine is solved as a **chain of tiers**, each built from the one before it. When you change any input, the tiers that depend on it are marked stale and re-solved automatically.

| Tier | Name | Produces |
|------|------|----------|
| **L0** | Analytical sizing | Flow rates, throat/exit areas, chamber volume & length, wall thickness, Isp, c\* |
| **L1** | Thermochemistry | Equilibrium combustion: flame temp T_c, γ, molecular weight, c\*, species |
| **L2** | Nozzle contour | Nozzle flow + Rao/MoC bell (or conical) contour, exit Mach/pressure, divergence loss |
| **L3** | Cooling | Wall thermal solution (regen/film/radiation/ablative), per-station heat flux |
| **L4** | Structures | Distributed wall stress (hoop + thermal), safety margins |
| **L5** | Feed system | Tanks, pressurant, feed pressure budget |

The left panel shows the tier status (`L0/L1/L2 Solved`). The right **Properties** panel shows the live L0/L1/L2 numbers.

### Nothing is pre-fed
Propulsor **does not ship a demo engine.** On open it's blank — thrust 0, no propellant, "No solve yet." Every tab except **Design** shows a *"Start your design"* prompt until you enter the four core requirements. The moment thrust, chamber pressure, mixture ratio and a propellant are set, L0–L2 resolve and every tab and 3D view builds itself from your inputs.

### Live, saved inputs
Every input — from the top-level requirements down to a single blade angle — is:
- **Persisted** with the design (saved in the project file),
- **Live**: editing it re-resolves the dependent tiers and refreshes every dependent view (including the 3D assembly) immediately,
- **Reversible**: customized values are marked, and each subsystem has a **Reset to defaults**.

---

## 2. Quick start (5 steps)

1. Open Propulsor → you land on the **Design** tab, Step 1.
2. **Pick a propellant** and enter **Thrust (N)**, **Chamber pressure (bar)**, **Mixture ratio O/F**. (Tiers turn green; T_c and Isp appear.)
3. Click **Next ›** through the wizard: choose O/F & L\*, nozzle type & expansion, cooling, feed system, then review.
4. Explore the tabs — 3D Model, Cooling, Turbopumps, Blades, Analysis, Feed System, Control, Assembly, Trades, Performance.
5. Open any tab's **Design inputs** panel to change assumptions and watch everything update; **export** CAD/CSV from the Review step or individual tabs.

---

## 3. The Design Wizard — step by step

The wizard (left rail with 6 steps) is the guided path from requirements to a review/export. Every choice writes to the design and re-solves live. You can jump between steps freely.

### Step 1 — Requirements & propellant
**You enter:**
- **Propellant pair** — one of 10 (GOX/Kerosene, GOX/Gasoline, GOX/Ethanol, GOX/Methanol, LOX/RP-1, LOX/Ethanol, LOX/Methane, N₂O/Propane, NTO/MMH, NTO/UDMH).
- **Thrust (N)** — the design thrust.
- **Chamber pressure (bar)**.
- **Mixture ratio O/F**.
- **Target burnout altitude (km)** — used by the expansion advisor later.

**You get (once configured):** flame temperature T_c and equilibrium vacuum Isp (from L1), and the whole engine begins resolving. *Until all four core values are set, it tells you nothing is pre-computed.*

### Step 2 — Performance / O·F
**You get:** current O/F, the **optimal O/F** for max Isp (with the resulting Isp), the **recommended L\*** for your propellant, and the resulting chamber length.
**You enter / actions:**
- **Characteristic length L\*** (m) — sets chamber volume (V_c = L\*·A_t).
- **Use optimal O/F** button — applies the max-Isp mixture ratio.
- **Use recommended L\*** button — applies the propellant's reference L\*.

### Step 3 — Nozzle & expansion
**You choose:**
- **Contour** — Bell (Rao thrust-optimized) or Conical.
- **Expansion strategy** (radio):
  - *Max performance* — optimal area ratio,
  - *Separation-safe* — the largest ratio that won't flow-separate at sea-level start,
  - *Sea-level optimum*.
**You get:** the resulting expansion ratio ε (solved), and a warning if the max-performance nozzle separates at sea level.

### Step 4 — Cooling
**You choose:**
- **Method** — Regenerative / Film / Radiation / Ablative.
- **Chamber wall material** — from the material database.
- **Nozzle-extension material** (optional, multi-material) — a radiation-class skirt.
**You get:** max wall temperature vs the material limit (pass/fail badge), and the radiation skirt equilibrium temperature if used.

### Step 5 — Turbomachinery / feed
**You choose:**
- **Feed type** — Pressure-fed or Pump-fed.
- If pump-fed: **shaft speed (rpm)**.
**You get (pump-fed):** pump shaft power, shaft critical-speed margin, gas-generator flow fraction, cycle power balance. Full sizing lives on the **Turbopumps** tab. Pressure-fed shows guidance (suited to storable/self-pressurizing propellants like N₂O/propane).

### Step 6 — Review & export
**You get:** a design summary (propellant, O/F, nozzle & ε, cooling, feed, throat/exit Ø, revision).
**Actions:** **Export nozzle contour CSV** and **Export heat-flux CSV**.

---

## 4. Design-input freedom (open every assumption)

Beyond the wizard, each subsystem tab has a **"Design inputs"** panel exposing the assumptions the study used to be hardcoded on. Each input:
- Edits commit on **blur / Enter**,
- Shows a **blue dot** when it differs from the default,
- Has a per-subsystem **Reset to defaults**,
- Is saved with the design and re-resolves live.

Defaults and valid ranges are grounded in NASA/industry references (see §8), and several inputs drive **live guardrail warnings** (see §7).

The full input catalog is in the Appendix (§10).

---

## 5. Tab-by-tab reference — what each tab *takes* and *gives*

> Every non-Design tab is inert until the design resolves (L0 present).

### Design
Guided wizard (§3). **Takes:** all core requirements + wizard choices. **Gives:** a fully-resolved design and the export actions.

### Dashboard
**Gives:** key results at a glance, a **unit converter**, and a **test-data validation** summary (predicted thrust/Isp/Pc vs entered measured values). **Takes:** measured scalar values in the validation widget.

### 3D Model
**Gives:** an interactive 3D of the designed engine — the real revolved contour (chamber + Rao bell / conical nozzle), orbit/zoom. **Takes:** nothing (view only); it tracks the design live.

### Cross-section
**Gives:** a 2D section of the contour (chamber · throat · nozzle) with wall detail. **Takes:** nothing.

### Cooling
**Takes:** cooling method, wall material, nozzle-extension material, and the **cooling-detail inputs** (film coolant temp/density/velocity/slot/injection point; ablative material/burn time/safety factor; radiation ambient).
**Gives:** wall temperatures vs material limit, coolant ΔP, method-specific results (film effectiveness, ablative recession/liner thickness, radiation equilibrium temp), the **material database**, and the **additive-manufacturing build plan** — axial regions with AM process, functionally-graded transitions, and a 3D region-banded engine.

### Turbopumps
**Takes:** shaft rpm + **turbo design inputs** (pump/turbine efficiency, suction specific speed, inducer hub ratio, tank & discharge pressure, GG flow fraction, drive-gas cp/γ/Tin, turbine exit pressure, bearing bore/DN limit/life, shaft allowable shear).
**Gives:** pump (head, power, specific speed, NPSH & cavitation margin), turbine (PR, power, exit temp), inducer, shaft (torque, critical speed), bearing (DN, L10 life), and the gas-generator cycle balance.

### Blades
**Takes:** shaft rpm, blade **mode** (pump impeller / turbine rotor / supersonic turbine), and **blade design inputs** (pump Z, β₂, inlet axial velocity, efficiency, impeller material; turbine Z, nozzle α, drive-gas cp/Tin/γ/PR, GG flow fraction; supersonic Z; loss knobs — clearance, aspect ratio, U/C₀).
**Gives:** the 3D blade ring, the 2D blade profile, blade angles & slip factor, **meanline loss build-ups**, **characteristic maps** (pump H–Q family + efficiency; turbine diagram-efficiency vs U/C₀), impeller **tip-speed vs limit**, turbine relative inlet Mach, and a **recommended turbine type** from U/C₀.

### Analysis
**Takes:** **injector design inputs** (element type, count, ΔP fraction, discharge coefficient, surface tension, fuel/ox density ratio, combustion time lag τ, interaction index n).
**Gives:** injector fluid-flow (injection velocity, orifice Ø, Weber number, Sauter mean droplet diameter), **combustion instability** (acoustic modes, dominant mode/regime, n–τ stability margin), **distributed wall stress** (FEM-like), and the **computed combustion (c\*) efficiency — ERE** (residence + atomization + mixing) with an **"Apply to design"** button that feeds it back into Isp.

### Validation
**Takes:** **imported telemetry CSV** — sensor data (`id,measured`) and/or a startup transient (`t_s,measured_thrust_n,measured_pc_pa`). Template downloads provided; **Clear imported data** reverts.
**Gives:** predicted-vs-measured **pressure & wall-temperature profiles** along the engine, a **startup transient** (thrust & Pc vs time), a **3D sensor-position map**, spatial + startup **RMS residuals**, and a data-source badge (synthetic reference ↔ imported telemetry).

### Feed System
**Takes:** feed type, burn time, and **feed design inputs** (injector ΔP fraction, line ΔP, pump-fed tank pressure, tank L/D, ullage, wall allowable/density, test factor, pressurant gas/factor/bottle pressure) plus **avionics inputs** (bus voltage, redundancy single/dual, battery reserve/energy-density, housekeeping current, main-valve & igniter current, wire-run override).
**Gives:** tank sizing (mass, volume, Ø×L, wall, tank mass), pressurant spec, the feed **pressure budget**, a **P&ID schematic**, and the **avionics electrical harness** — channel list with wire gauges/connectors, a **star-topology wiring diagram**, and a **power budget** (bus, peak/continuous current, battery Wh & mass, harness mass & wire length).

### Control
**Takes:** engine cycle + **control inputs** (Pc & MR loop bandwidths, sample rate, combustion dead time, throttle step target, turbine-temperature redline).
**Gives:** the two-loop architecture (Pc slow loop, MR fast loop), the **sensor & valve suite** for the cycle, chamber dynamics (fill time τ + dead time σ), a **closed-loop throttle step response** (settling time, overshoot), redlines, a **control block diagram**, and guardrail warnings (bandwidth vs sample rate / dead time).

### Assembly
**Gives:** the full 3D vehicle — the **real revolved nozzle** + chamber, injector plate, oxidizer/fuel tanks (sized from the feed study), **pressurant bottle** (pressure-fed), feed lines, and a translucent airframe. **Animated exploded view** with labeled parts. Updates live with any design change. **Takes:** view toggles (Exploded / Airframe).

### Trades
**Gives:** trade-study sweeps — O/F (optimal O/F), expansion ratio (optimal ε, sea-level vs vacuum Cf), L\*, material trade, injector element-count trade, and a Pareto front. **Takes:** nothing (reads the design).

### Performance
**Gives:** the steady-state **performance map** — Isp (and thrust) across O/F × altitude. **Takes:** nothing.

---

## 6. 3D & visualization summary
- **3D Model / Assembly** — real revolved contour; assembly adds tanks, pressurant, feed lines, exploded view.
- **Cooling** — 3D region-banded engine colored by AM material + FGM ramp bars.
- **Blades** — 3D impeller/rotor rings + 2D profiles + H–Q / efficiency maps.
- **Analysis** — distributed-stress strip + ERE bars.
- **Validation** — 3D sensor map + predicted/measured profiles + transient chart.
- **Control** — loop block diagram + step-response chart.
- **Feed System** — P&ID + avionics wiring diagram.
- **Performance / Trades** — sweep plots + Pareto.

## 7. Guardrails (live warnings)
The tool flags when an input leaves a physically-sound range, e.g.:
- Impeller **tip speed** over the material limit (274 m/s Inconel/LOX … 610 m/s Ti/LH₂).
- Bearing **DN** outside 1.6–2.1 million.
- Turbine **pressure ratio** outside the 8–20 impulse range.
- **Turbine type** recommendation from U/C₀ (velocity-compounded < 0.2, pressure-compounded 0.2–0.34, reaction > 0.34).
- Nozzle flow **separation** at sea level.
- Control **loop bandwidth** above ~1/10 the sample rate or the combustion-dead-time limit.

## 8. Reference basis
Defaults, correlations and guardrails come from published sources: NASA/Wiley (Cannon, *Propellant Feed System Design*), NASA SP-8107 (*Turbopump Systems*), NASA MSFC (*Simplex Turbopump*), NASA TM-105318 (*Overview of Rocket Engine Control*), plus Krzycki / Huzel & Huang / Sutton & Biblarz analytical sizing and NASA Glenn thermodynamic polynomials.

## 9. Files & export
- **CAD:** STL, DXF, STEP of the engine geometry.
- **Data CSV:** nozzle contour, thrust curve, per-station heat flux (FEM BC), distributed stress field, sensor residuals.
- **Projects:** RON save/load (`*.apro-engine.ron`) with schema-versioned migration.
- **Telemetry:** import measured CSV into Validation (with template downloads).

---

## 10. Appendix — full input catalog

**Core (wizard / Design):** thrust, chamber pressure, mixture ratio O/F, propellant pair, expansion ratio / strategy, characteristic length L\*, nozzle kind, chamber & nozzle materials, cooling method, c\* efficiency.

**Blades (`blade.*`):** pump blade count Z, outlet blade angle β₂, inlet axial velocity, pump efficiency, impeller material, inducer hub ratio, suction specific speed; turbine blade count, nozzle angle α, drive-gas cp/Tin/γ, turbine pressure ratio, GG flow fraction, turbine blade-velocity coefficient; supersonic blade count; clearance ratio, aspect ratio, velocity ratio U/C₀.

**Turbopumps (`turbo.*`):** pump efficiency, suction specific speed, inducer hub ratio, tank pressure, discharge factor, GG flow fraction, turbine efficiency/cp/γ/Tin, turbine inlet-pressure factor, turbine exit pressure, bearing bore/DN limit/life, bearing radial & axial load, shaft allowable shear/safety factor/length/Young's/lumped mass.

**Feed (`feed.*`):** injector ΔP fraction, line ΔP, pump-fed tank pressure, tank L/D, ullage factor, tank allowable, tank test factor, tank wall density, pressurant gas, pressurant factor, pressurant bottle pressure.

**Avionics (`avionics.*`):** bus voltage, redundancy, battery reserve factor, battery specific energy, housekeeping current, main-valve current, igniter current, wire-run override.

**Control (`control.*`):** Pc loop bandwidth, MR loop bandwidth, sample rate, combustion dead time, throttle target, turbine-temperature redline.

**Injector (`injector.*`):** element type, element count, ΔP fraction, discharge coefficient, surface tension, fuel/ox density ratio, combustion time lag τ, interaction index n.

**Cooling detail (`cooling.*`):** film coolant temp/density/velocity/viscosity/slot height/injection point, ablative material/burn time/safety factor, radiation ambient temperature.

---

*See also `DOCUMENTATION.md` (architecture & feature overview) and `engines/app/WINDOWS_PACKAGING.md` (desktop build & signing).*
