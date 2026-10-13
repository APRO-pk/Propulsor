import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { coolingStudy, pairCoolantNames, DEFAULT_JACKET_PRESSURE_FACTOR, DEFAULT_LINER_THICKNESS_MM, type CoolingStudyDto, type PrintPlanDto } from "./api";
import { useEngineStore } from "./store";
import { ParamField, ParamChoice, ResetParams } from "./ParamInput";

/** A stable-ish colour for a material name (AM region shading). */
export function materialColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("copper") || n.includes("cucrzr") || n.includes("grcop")) return "#c1743a";
  if (n.includes("inconel")) return "#8a93a6";
  if (n.includes("niob") || n.includes("c103")) return "#6f7787";
  if (n.includes("carbon")) return "#3b3f45";
  if (n.includes("316") || n.includes("steel")) return "#9aa2af";
  return "#7d97c4";
}

const METHODS = [
  { id: "regen", label: "Regenerative" },
  { id: "film", label: "Film" },
  { id: "radiation", label: "Radiation" },
  { id: "ablative", label: "Ablative" },
];

/** Row label for the governing coolant limit. */
function coolantLimitLabel(kind: "boiling" | "coking" | "none"): string {
  if (kind === "boiling") return "Boiling margin";
  if (kind === "coking") return "Coking margin";
  return "Coolant limit";
}

export function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Cooling() {
  const store = useEngineStore();
  const material = store.design?.materials?.chamber ?? "OFHC Copper";
  const method = store.design?.geometry?.cooling_jacket?.cooling_method ?? "regen";
  const nozzleMat = store.design?.materials?.nozzle ?? "";
  const setMaterial = (m: string) => store.apply("wall_material", m);
  const setMethod = (m: string) => store.apply("cooling_method", m);
  const setNozzleMat = (m: string) => store.apply("nozzle_material", m);
  const [study, setStudy] = useState<CoolingStudyDto | null>(null);
  const coolants = pairCoolantNames(store.design?.propellant?.pair ?? "");
  const coolantChoice = store.design?.choices?.["cooling.coolant"] ?? "fuel";
  // Fuel/oxidizer coolants carry the propellant flow; water is an external supply.
  const propellantCoolant = coolantChoice !== "Water";
  const hasChannels = (store.design?.params?.["cooling.channel_count"] ?? 0) > 0;
  const pcBar = (store.design?.operating_point?.chamber_pressure ?? 0) / 1e5;
  const pressureFactor = store.design?.params?.["cooling.coolant_pressure_factor"] ?? DEFAULT_JACKET_PRESSURE_FACTOR;
  const l0Len = (store.design?.caches.find((c) => c.tier === "L0")?.payload as { chamber_length?: number } | undefined)?.chamber_length;

  const rev = store.design?.meta.revision;
  useEffect(() => {
    let live = true;
    coolingStudy(material, method).then((s) => live && setStudy(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [material, method, nozzleMat, rev]);

  const over = study && study.regen.max_wall_temp_k > study.regen.wall_material_limit_k;
  // Jacket ΔP the feed budget leaves: inlet − Pc − 20 % injector drop.
  const dpBudget = study ? study.regen.coolant.inlet_pressure_pa - pcBar * 1e5 * 1.2 : 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <fieldset className="qt-groupbox">
        <legend>Cooling strategy</legend>
        <label className="qt-field">
          <span>Cooling method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="qt-field">
          <span>Wall material</span>
          <select value={material} onChange={(e) => setMaterial(e.target.value)}>
            {(study?.materials ?? []).map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {material === "Custom" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", borderTop: "1px solid var(--qt-border)", borderBottom: "1px solid var(--qt-border)", padding: "4px 0", margin: "4px 0" }}>
            <ParamField label="Conductivity k" k="material.custom_k" def={350} step={10} unit="W/m·K" />
            <ParamField label="Max service temp" k="material.custom_tmax_k" def={800} step={25} dim="temperature" baseUnit="K" />
            <ParamField label="Density" k="material.custom_density" def={8000} step={100} unit="kg/m³" />
            <ParamField label="Allowable stress" k="material.custom_allowable_mpa" def={200} step={10} dim="pressure" baseUnit="MPa" />
            <ParamField label="Young's modulus" k="material.custom_youngs_gpa" def={120} step={5} dim="pressure" baseUnit="GPa" />
            <ParamField label="CTE" k="material.custom_cte_ppm" def={16} step={1} unit="ppm/K" />
            <ParamField label="Emissivity" k="material.custom_emissivity" def={0.5} step={0.05} />
          </div>
        )}
        <label className="qt-field">
          <span>Nozzle-extension material</span>
          <select value={nozzleMat} onChange={(e) => setNozzleMat(e.target.value)}>
            <option value="">— none (single material) —</option>
            {(study?.materials ?? []).map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="qt-field" title="regen coolant — normally the fuel; water for a water-cooled test stand">
          <span>Coolant</span>
          <select value={coolantChoice} onChange={(e) => void store.apply("cooling.coolant", e.target.value)}>
            <option value="fuel">Fuel ({coolants.fuel})</option>
            {coolants.oxidizer && <option value="oxidizer">Oxidizer ({coolants.oxidizer})</option>}
            <option value="Water">Water (test stand)</option>
          </select>
        </label>
        {propellantCoolant ? (
          <>
            <ParamField label="Coolant flow fraction" k="cooling.coolant_flow_fraction" def={1} step={0.05} min={0.05} max={1} hint="share of the coolant propellant's flow routed through the jacket (1 = all of it, the usual regen circuit)" />
            <ParamField label="Design velocity" k="cooling.coolant_velocity_m_s" def={6} step={1} dim="velocity" baseUnit="m/s" hint="inlet velocity that sizes the annular gap for the propellant flow; with channels the velocity follows from the flow and channel area" />
          </>
        ) : (
          <ParamField label="Coolant velocity" k="cooling.coolant_velocity_m_s" def={6} step={1} dim="velocity" baseUnit="m/s" hint="test-stand coolant velocity through the L0 jacket gap — sets the coolant flow; higher lowers the wall temperature" />
        )}
        <ParamField label="Jacket pressure / Pc" k="cooling.coolant_pressure_factor" def={DEFAULT_JACKET_PRESSURE_FACTOR} step={0.05} min={1} hint="jacket inlet pressure as a multiple of Pc (feed pressure budget: Pc + injector ΔP + jacket ΔP, Huzel & Huang); used unless an explicit pressure is set" />
        <ParamField label="Coolant pressure" k="cooling.coolant_pressure_bar" def={Number((pressureFactor * pcBar).toFixed(1))} step={0.5} dim="pressure" baseUnit="bar" hint="coolant inlet pressure — follows Pc × factor until you set it; sets boiling vs supercritical" />
        <ParamField label="Carbon deposit resistance" k="cooling.deposit_resistance_cm2k_w" def={0} step={0.05} min={0} unit="cm²·K/W" hint="Hot-wall soot/carbon layer in series with the gas film (0 = clean wall). Sources disagree for LOX/hydrocarbon main chambers: NASA TP-2862's 4.3 MPa LOX/RP-1 throat data imply ≈0.3; Cook's correlation (NASA CR-159790) gives several cm²·K/W but is flagged uncertain at high Pc; NASA's carbon-deposition program saw no wall deposits at O/F 2–4. Enter a value only if you have one for your injector." />
        <ParamField label="Cooling channels" k="cooling.channel_count" def={0} step={10} hint="discrete milled/printed channels; 0 → annular-gap model" />
        <ParamField label="Channel width" k="cooling.channel_width_mm" def={1.5} step={0.1} dim="length" baseUnit="mm" hint="rectangular channel width (used when channels > 0)" />
        <ParamField label="Channel height" k="cooling.channel_height_mm" def={3.0} step={0.1} dim="length" baseUnit="mm" hint="rectangular channel depth (used when channels > 0)" />
        {hasChannels && (
          <ParamField label="Liner thickness" k="cooling.liner_thickness_mm" def={DEFAULT_LINER_THICKNESS_MM} step={0.05} dim="length" baseUnit="mm" hint="hot-gas wall between the gas and the channels (default 0.89 mm, NASA TP-1834); the lands and closeout carry the pressure. Without channels the heat crosses L0's full chamber wall." />
        )}
        {study && (
          <>
            <div className="qt-field">
              <span>Max wall temperature</span>
              <span className={`qt-badge ${over ? "failed" : "solved"}`}>
                {study.regen.max_wall_temp_k.toFixed(0)} K
              </span>
            </div>
            <div className="qt-field">
              <span>Material limit</span>
              <b>{study.regen.wall_material_limit_k.toFixed(0)} K</b>
            </div>
            <div className="qt-field">
              <span>Margin</span>
              <b>{(study.regen.wall_material_limit_k - study.regen.max_wall_temp_k).toFixed(0)} K</b>
            </div>
            <div className="qt-field" title="jacket friction drop; for a propellant coolant it must fit in the budget jacket inlet − Pc − 20 % injector drop">
              <span>Coolant ΔP</span>
              {propellantCoolant ? (
                <span className={`qt-badge ${study.regen.coolant_dp_pa > dpBudget ? "failed" : "solved"}`}>
                  {(study.regen.coolant_dp_pa / 1e5).toFixed(2)} bar (budget {(Math.max(0, dpBudget) / 1e5).toFixed(1)} bar)
                </span>
              ) : (
                <b>{(study.regen.coolant_dp_pa / 1000).toFixed(0)} kPa</b>
              )}
            </div>
            <div className="qt-field" title={study.regen.coolant.source}>
              <span>Coolant</span>
              <b>
                {study.regen.coolant.name} · {(study.regen.coolant.inlet_pressure_pa / 1e5).toFixed(1)} → {(study.regen.coolant.outlet_pressure_pa / 1e5).toFixed(1)} bar ·{" "}
                {study.regen.coolant.supercritical ? "supercritical" : "subcritical"}
              </b>
            </div>
            <div className="qt-field">
              <span>{coolantLimitLabel(study.regen.coolant.limit_kind)}</span>
              {study.regen.min_coolant_margin_k === null ? (
                <b>n/a</b>
              ) : (
                <span className={`qt-badge ${study.regen.min_coolant_margin_k < 0 ? "failed" : "solved"}`}>
                  {study.regen.min_coolant_margin_k.toFixed(0)} K (limit {(study.regen.coolant.limit_k ?? 0).toFixed(0)} K)
                </span>
              )}
            </div>
            <div className="qt-field">
              <span>Coolant flow</span>
              <b>{study.regen.coolant.mass_flow_kg_s.toFixed(3)} kg/s</b>
            </div>
            <div className="qt-field" title="bulk velocity at the inlet and its peak along the circuit (the coolant expands as it heats)">
              <span>Velocity in / max</span>
              <b>{study.regen.coolant.inlet_velocity_m_s.toFixed(1)} / {study.regen.coolant.max_velocity_m_s.toFixed(1)} m/s</b>
            </div>
            <div className="qt-field">
              <span>Coolant in → out</span>
              <b>{study.regen.coolant.inlet_temp_k.toFixed(0)} → {study.regen.coolant.outlet_temp_k.toFixed(0)} K</b>
            </div>
            <p className="qt-caption" style={{ marginTop: 4 }}>{study.regen.coolant.note}</p>
            <div className="qt-field">
              <span>Hot-gas wall</span>
              <b>{(study.regen.wall_thickness_m * 1000).toFixed(2)} mm</b>
            </div>
            <p className="qt-caption" style={{ marginTop: 2 }} title={study.regen.coolant.source}>Properties: {study.regen.coolant.property_basis}</p>
            <p className="qt-caption" style={{ marginTop: 2 }}>Coolant side: {study.regen.coolant.correlation}</p>
            <button
              className="qt-tool"
              style={{ marginTop: 8 }}
              onClick={() => downloadText("heat_flux.csv", study.heat_flux_csv)}
            >
              Export heat-flux CSV (FEM)
            </button>
          </>
        )}
      </fieldset>

      {(method === "film" || method === "ablative" || method === "radiation") && (
        <fieldset className="qt-groupbox" style={{ gridColumn: "1 / 3" }}>
          <legend>{METHODS.find((m) => m.id === method)?.label} detail inputs<span style={{ float: "right" }}><ResetParams prefix="cooling." /></span></legend>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 16px" }}>
            {method === "film" && <>
              <ParamField label="Film fraction" k="cooling.film_fraction" def={0} step={0.01} hint="fraction of total flow bled as film coolant; >0 sets the film velocity (0 = use velocity below)" />
              <ParamField label="Coolant temperature" k="cooling.film_coolant_temp_k" def={400} step={25} dim="temperature" baseUnit="K" />
              <ParamField label="Coolant density" k="cooling.film_coolant_density" def={5} step={0.5} unit="kg/m³" />
              <ParamField label="Coolant velocity" k="cooling.film_coolant_velocity" def={120} step={10} dim="velocity" baseUnit="m/s" hint="used when film fraction = 0; higher velocity → thicker film" />
              <ParamField label="Slot height" k="cooling.film_slot_height_mm" def={1.5} step={0.1} dim="length" baseUnit="mm" />
              <ParamField label="Injection x" k="cooling.film_injection_x_m" def={-(l0Len ?? 0)} step={0.01} dim="length" baseUnit="m" hint="axial start of the film (throat at 0; default: injector face at −L_c)" />
            </>}
            {method === "ablative" && <>
              <ParamChoice label="Ablative material" k="cooling.ablative_material" def="Carbon phenolic" options={["Carbon phenolic", "Silica phenolic"]} />
              <ParamField label="Burn time" k="cooling.ablative_burn_time_s" def={30} step={5} dim="time" baseUnit="s" />
              <ParamField label="Safety factor" k="cooling.ablative_safety_factor" def={1.5} step={0.1} />
            </>}
            {method === "radiation" && <ParamField label="Ambient temperature" k="cooling.radiation_ambient_k" def={250} step={25} dim="temperature" baseUnit="K" />}
          </div>
        </fieldset>
      )}

      <fieldset className="qt-groupbox">
        <legend>{METHODS.find((m) => m.id === method)?.label} result</legend>
        {study?.film && method === "film" && (
          <table className="qt-proptable">
            <tbody>
              <tr><td>Blowing ratio</td><td className="val">{study.film.blowing_ratio.toFixed(2)}</td></tr>
              <tr><td>Effectiveness η</td><td className="val">{study.film.effectiveness.toFixed(2)}</td></tr>
              <tr><td>Film adiabatic wall T</td><td className="val">{study.film.adiabatic_wall_temp_k.toFixed(0)} K</td></tr>
              <tr><td>Effective length</td><td className="val">{(study.film.effective_length_m * 1000).toFixed(0)} mm</td></tr>
            </tbody>
          </table>
        )}
        {study?.radiation && method === "radiation" && (
          <table className="qt-proptable">
            <tbody>
              <tr><td>Equilibrium wall T</td><td className="val">{study.radiation.equilibrium_wall_temp_k.toFixed(0)} K</td></tr>
              <tr><td>Radiated flux</td><td className="val">{(study.radiation.radiated_flux_w_m2 / 1e6).toFixed(2)} MW/m²</td></tr>
              <tr><td>Material limit</td><td className="val">{study.radiation.material_limit_k.toFixed(0)} K</td></tr>
              <tr><td>Status</td><td className="val">{study.radiation.material_ok ? "OK" : "OVER LIMIT"}</td></tr>
            </tbody>
          </table>
        )}
        {study?.ablative && method === "ablative" && (
          <table className="qt-proptable">
            <tbody>
              <tr><td>Recession rate</td><td className="val">{(study.ablative.recession_rate_m_s * 1000).toFixed(2)} mm/s</td></tr>
              <tr><td>Total recession</td><td className="val">{(study.ablative.total_recession_m * 1000).toFixed(1)} mm</td></tr>
              <tr><td>Liner thickness (SF)</td><td className="val">{(study.ablative.required_thickness_m * 1000).toFixed(1)} mm</td></tr>
              <tr><td>Liner mass</td><td className="val">{study.ablative.liner_mass_per_area_kg_m2.toFixed(1)} kg/m²</td></tr>
            </tbody>
          </table>
        )}
        {method === "regen" && (
          <p className="muted">
            Active regenerative cooling with the selected wall material. Choose Film, Radiation or
            Ablative to compare an alternative strategy.
          </p>
        )}
      </fieldset>

      <fieldset className="qt-groupbox" style={{ gridColumn: "1 / 3" }}>
        <legend>Material database</legend>
        <table className="qt-proptable">
          <thead>
            <tr>
              <th>Material</th>
              <th>k (W/m·K)</th>
              <th>T_max (K)</th>
              <th>ε</th>
              <th>Class</th>
            </tr>
          </thead>
          <tbody>
            {(study?.materials ?? []).map((m) => (
              <tr key={m.name} style={{ fontWeight: m.name === material ? 700 : 400 }}>
                <td>{m.name}</td>
                <td className="val">{m.thermal_conductivity_w_m_k.toFixed(0)}</td>
                <td className="val">{m.max_service_temp_k.toFixed(0)}</td>
                <td className="val">{m.emissivity.toFixed(2)}</td>
                <td>{m.cooling_class}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      {study && (
        <fieldset className="qt-groupbox" style={{ gridColumn: "1 / 3" }}>
          <legend>Additive-manufacturing build plan (multi-material / graded)</legend>
          <div className="qt-field"><span>Plan</span><span className="qt-badge solved">{study.print_plan.summary}</span></div>
          <div className="qt-field"><span>Build direction</span><b>{study.print_plan.build_direction}</b></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start", marginTop: 8 }}>
            <div className="viewer3d" style={{ height: 320, borderRadius: 5, overflow: "hidden" }}>
              <PrintPlan3D
                plan={study.print_plan}
                throatR={(store.l0?.throat_diameter ?? 0.03) / 2}
                chamberR={(store.l0?.chamber_diameter ?? 0.14) / 2}
                stations={study.regen.stations}
              />
            </div>
            <div>
              <table className="qt-proptable">
                <thead><tr><th>Region</th><th>Material</th><th>Process</th><th>Layer</th><th>Power</th></tr></thead>
                <tbody>
                  {study.print_plan.regions.map((r) => (
                    <tr key={r.name}>
                      <td><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: materialColor(r.material), marginRight: 6 }} />{r.name}{r.high_precision ? " ★" : ""}</td>
                      <td>{r.material}</td>
                      <td className="val">{r.process}</td>
                      <td className="val">{r.layer_thickness_um > 0 ? `${r.layer_thickness_um.toFixed(0)} µm` : "—"}</td>
                      <td className="val">{r.laser_power_w > 0 ? `${r.laser_power_w.toFixed(0)} W` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="qt-caption" style={{ marginTop: 4 }}>★ precision region — finer layer height &amp; hatch, contour compensation.</p>
            </div>
          </div>

          {study.print_plan.transitions.length > 0 ? (
            study.print_plan.transitions.map((t, i) => (
              <div key={i} style={{ marginTop: 10 }}>
                <div className="qt-caption" style={{ display: "flex", justifyContent: "space-between", margin: "0 0 3px" }}>
                  <span><b>{t.from_material} → {t.to_material}</b> functionally-graded transition</span>
                  <span>{t.layers} layers · {t.blend_length_mm.toFixed(1)} mm</span>
                </div>
                <div style={{ display: "flex", height: 18, borderRadius: 3, overflow: "hidden", border: "1px solid var(--qt-border)" }}>
                  {t.composition_steps.map((f, k) => (
                    <div key={k} title={`layer ${k + 1}: ${(f * 100).toFixed(0)}% ${t.to_material}`} style={{ flex: 1, background: mix2(materialColor(t.from_material), materialColor(t.to_material), f) }} />
                  ))}
                </div>
                <p className="qt-caption" style={{ marginTop: 3 }}>{t.note}</p>
              </div>
            ))
          ) : (
            <p className="muted" style={{ marginTop: 8 }}>Single material — assign a nozzle-extension material above to generate a graded bimetallic transition.</p>
          )}
        </fieldset>
      )}
    </div>
  );
}

/** Blend two hex colours (0→c1, 1→c2). */
function mix2(c1: string, c2: string, f: number): string {
  const h = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [r1, g1, b1] = h(c1), [r2, g2, b2] = h(c2);
  const r = Math.round(r1 + (r2 - r1) * f), g = Math.round(g1 + (g2 - g1) * f), b = Math.round(b1 + (b2 - b1) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Revolved engine coloured by AM build region — one lathe segment per region. */
function PrintPlan3D({ plan, throatR, chamberR, stations }: { plan: PrintPlanDto; throatR: number; chamberR: number; stations: { x: number; r: number }[] }) {
  const segments = useMemo(() => {
    // Full inner profile: chamber barrel (flat) → converge to throat → nozzle stations.
    const nozzle = [...stations].sort((a, b) => a.x - b.x);
    const chamberStart = plan.regions[0]?.x_start_m ?? -0.25;
    const profile: { x: number; r: number }[] = [
      { x: chamberStart, r: chamberR },
      { x: chamberStart * 0.15, r: chamberR },
      { x: 0, r: throatR },
      ...nozzle.filter((p) => p.x > 1e-6),
    ];
    // Split the profile into per-region point runs (overlap by one point to join).
    return plan.regions.map((reg) => {
      const pts = profile.filter((p) => p.x >= reg.x_start_m - 1e-9 && p.x <= reg.x_end_m + 1e-9);
      if (pts.length < 2) {
        // Guarantee at least a thin ring so every region shows.
        const rr = (reg.x_start_m <= 0 ? chamberR : throatR);
        pts.push({ x: reg.x_start_m, r: rr }, { x: reg.x_end_m, r: rr });
      }
      return { material: reg.material, color: materialColor(reg.material), pts };
    });
  }, [plan, throatR, chamberR, stations]);

  const xs = segments.flatMap((s) => s.pts.map((p) => p.x));
  const span = Math.max(...xs) - Math.min(...xs) || 0.3;
  const cam = span * 1.7;

  return (
    <Canvas dpr={[1, 2]} camera={{ position: [cam * 0.7, cam * 0.5, cam], fov: 42, near: 0.001, far: 100 }}>
      <color attach="background" args={["#3b4046"]} />
      <hemisphereLight args={["#ffffff", "#33383e", 1.0]} />
      <directionalLight position={[cam, cam * 1.4, cam]} intensity={2.0} />
      <directionalLight position={[-cam, cam * 0.4, -cam]} intensity={0.6} color="#a9c0dd" />
      {/* Axis points along +x; lathe revolves around Y, so rotate the group. */}
      <group rotation={[0, 0, Math.PI / 2]}>
        {segments.map((seg, i) => (
          <LatheSeg key={i} pts={seg.pts} color={seg.color} />
        ))}
      </group>
      <OrbitControls enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}

function LatheSeg({ pts, color }: { pts: { x: number; r: number }[]; color: string }) {
  const geo = useMemo(() => {
    const sorted = [...pts].sort((a, b) => a.x - b.x);
    const v = sorted.map((p) => new THREE.Vector2(Math.max(p.r, 1e-4), p.x));
    const g = new THREE.LatheGeometry(v, 64);
    g.computeVertexNormals();
    return g;
  }, [pts]);
  return <mesh geometry={geo}><meshStandardMaterial color={color} metalness={0.6} roughness={0.45} side={THREE.DoubleSide} /></mesh>;
}
