import { useEffect, useState } from "react";
import { useEngineStore } from "./store";
import { designAdvice, coolingStudy, turbopumpStudy, type DesignAdviceDto, type CoolingStudyDto, type TurbopumpStudyDto } from "./api";
import { downloadText } from "./Cooling";
import { CommitNumberField, ParamChoice } from "./ParamInput";
import { engineProfile } from "./exporters";

// Approximate stoichiometric O/F per pair, for equivalence-ratio / %-fuel input.
const STOICH_OF: Record<string, number> = {
  GoxKerosene: 3.4, GoxGasoline: 3.5, GoxEthanol: 2.08, GoxMethanol: 1.5,
  LoxRp1: 3.4, LoxEthanol: 2.08, LoxMethane: 3.99, LoxHydrogen: 7.94,
  NitrousPropane: 9.5, NtoMmh: 2.5, NtoUdmh: 3.0, H2o2Kerosene: 7.5,
};

// Complete starting-point designs (applied through the normal field API).
const PRESETS: { name: string; fields: [string, number | string][] }[] = [
  { name: "GOX/Kerosene test · 500 N", fields: [["propellant_pair", "GoxKerosene"], ["thrust", 500], ["chamber_pressure", 15e5], ["mixture_ratio", 2.4], ["l_star", 1.0], ["wall_material", "OFHC Copper"], ["cooling_method", "regen"]] },
  { name: "LOX/Methane · 25 kN", fields: [["propellant_pair", "LoxMethane"], ["thrust", 25000], ["chamber_pressure", 60e5], ["mixture_ratio", 3.4], ["l_star", 0.8], ["wall_material", "CuCrZr"], ["cooling_method", "regen"]] },
  { name: "LOX/RP-1 booster · 100 kN", fields: [["propellant_pair", "LoxRp1"], ["thrust", 100000], ["chamber_pressure", 70e5], ["mixture_ratio", 2.6], ["l_star", 1.0], ["wall_material", "CuCrZr"]] },
  { name: "N₂O/Propane · 2 kN", fields: [["propellant_pair", "NitrousPropane"], ["thrust", 2000], ["chamber_pressure", 20e5], ["mixture_ratio", 6.5], ["l_star", 1.1]] },
  { name: "LOX/LH₂ upper · 50 kN", fields: [["propellant_pair", "LoxHydrogen"], ["thrust", 50000], ["chamber_pressure", 50e5], ["mixture_ratio", 5.5], ["l_star", 0.7], ["wall_material", "Inconel 718"]] },
];

const STEPS = ["Propellant & mission", "Performance / O·F", "Nozzle & expansion", "Cooling", "Feed & turbomachinery", "Review & export"];

const PAIRS = [
  "GoxKerosene", "GoxGasoline", "GoxEthanol", "GoxMethanol",
  "LoxRp1", "LoxEthanol", "LoxMethane", "LoxHydrogen",
  "NitrousPropane", "NtoMmh", "NtoUdmh", "H2o2Kerosene",
];

export function DesignWizard() {
  const store = useEngineStore();
  const { l0, l1, l2, design } = store;
  const [step, setStep] = useState(0);
  const [burnoutKm, setBurnoutKm] = useState(40);
  const [strategy, setStrategy] = useState<"performance" | "separation-safe" | "sea-level">("performance");
  const [feed, setFeed] = useState<"Auto" | "Self-pressurizing" | "Pressure-fed" | "Pump-fed">("Pump-fed");
  const [ofMode, setOfMode] = useState<"O/F" | "φ" | "%fuel">("O/F");
  const [rpm, setRpm] = useState(20000);

  const [advice, setAdvice] = useState<DesignAdviceDto | null>(null);
  const [cool, setCool] = useState<CoolingStudyDto | null>(null);
  const [turbo, setTurbo] = useState<TurbopumpStudyDto | null>(null);

  // Persisted design values (source of truth).
  const curThrust = design?.operating_point.thrust ?? 0;
  const curPcBar = (design?.operating_point.chamber_pressure ?? 0) / 1e5;
  const curOf = design?.operating_point.mixture_ratio ?? 0;
  const pair = design?.propellant.pair;
  const pairSet = !!pair && pair !== "Unset";
  const configured = curThrust > 0 && curPcBar > 0 && curOf > 0 && pairSet;
  // Mixture-ratio input modes: O/F, equivalence ratio φ, or %fuel. The design
  // always stores O/F; these convert for display/entry using the stoichiometric O/F.
  const stoich = STOICH_OF[pairSet ? (pair as string) : ""] ?? 3.0;
  const ofToDisplay = (of: number) => (of <= 0 ? 0 : ofMode === "φ" ? stoich / of : ofMode === "%fuel" ? 100 / (1 + of) : of);
  const displayToOf = (v: number) => (v <= 0 ? 0 : ofMode === "φ" ? stoich / v : ofMode === "%fuel" ? (100 - v) / v : v);
  const curLStar = design?.geometry?.chamber?.l_star_m ?? 1.0;
  const curKind = design?.geometry?.nozzle?.kind ?? "Bell";
  const curMaterial = design?.materials?.chamber ?? "OFHC Copper";
  const curNozzleMat = design?.materials?.nozzle ?? "";
  const curMethod = design?.geometry?.cooling_jacket?.cooling_method ?? "regen";
  const curEps = l2?.area_ratio ?? 0;

  useEffect(() => { designAdvice(burnoutKm * 1000).then(setAdvice).catch(() => {}); }, [burnoutKm, design?.propellant.pair, design?.operating_point.chamber_pressure]);
  useEffect(() => { coolingStudy(curMaterial, curMethod).then(setCool).catch(() => {}); }, [curMaterial, curMethod, curNozzleMat]);
  useEffect(() => { if (feed === "Pump-fed") turbopumpStudy(rpm).then(setTurbo).catch(() => {}); }, [rpm, feed, design?.operating_point.thrust]);

  const applyStrategy = (s: typeof strategy) => {
    setStrategy(s);
    if (!advice) return;
    const eps = s === "performance" ? advice.expansion.optimal_area_ratio : s === "separation-safe" ? advice.expansion.separation_limited_area_ratio : advice.expansion.sea_level_optimal_area_ratio;
    store.apply("expansion_ratio", Number(eps.toFixed(2)));
  };

  const exportContourCsv = () => {
    if (!l0) return;
    // Full injector→exit contour (chamber + converging + nozzle), in mm.
    const prof = engineProfile(l0, l2);
    downloadText(
      "engine_contour.csv",
      "x_mm,r_mm\n" + prof.map((p) => `${(p.x * 1000).toFixed(3)},${(p.r * 1000).toFixed(3)}`).join("\n") + "\n",
    );
  };

  const applyPreset = async (p: (typeof PRESETS)[number]) => {
    await store.reset();
    for (const [k, v] of p.fields) await store.apply(k, v);
  };

  // Full design report (Markdown) — operating point, every solved tier and species.
  const buildReport = (): string => {
    const op = design?.operating_point;
    const L: string[] = [];
    L.push(`# Propulsor design report — ${design?.meta.name ?? "Untitled"}`, "");
    L.push(`Revision ${design?.meta.revision ?? 0}`, "");
    L.push("## Requirements", "");
    L.push(`- Propellant: ${pairSet ? pair : "—"}`);
    L.push(`- Thrust: ${curThrust.toFixed(0)} N`);
    L.push(`- Chamber pressure: ${curPcBar.toFixed(2)} bar`);
    L.push(`- Mixture ratio O/F: ${curOf.toFixed(3)}`);
    if (op?.c_star_efficiency) L.push(`- c* efficiency: ${(op.c_star_efficiency * 100).toFixed(1)} %`);
    if (l0) {
      L.push("", "## L0 — Analytical sizing", "");
      L.push(`- Total flow: ${l0.total_flow.toFixed(4)} kg/s (ox ${l0.oxidizer_flow.toFixed(4)}, fuel ${l0.fuel_flow.toFixed(4)})`);
      L.push(`- Throat Ø: ${(l0.throat_diameter * 1000).toFixed(2)} mm · Exit Ø: ${(l0.exit_diameter * 1000).toFixed(2)} mm · Chamber Ø: ${(l0.chamber_diameter * 1000).toFixed(2)} mm`);
      L.push(`- Area ratio: ${l0.area_ratio.toFixed(2)} · Chamber length: ${(l0.chamber_length * 1000).toFixed(1)} mm · Wall: ${(l0.wall_thickness * 1000).toFixed(2)} mm`);
      L.push(`- Isp (sea-level, ideal): ${l0.isp_s.toFixed(0)} s · c* (ideal): ${l0.c_star_m_s.toFixed(0)} m/s`);
    }
    if (l1) {
      L.push("", "## L1 — Thermochemistry (equilibrium)", "");
      L.push(`- T_c: ${l1.tc_k.toFixed(0)} K · γ: ${l1.gamma.toFixed(3)} · MW: ${l1.mean_molecular_weight.toFixed(2)} g/mol`);
      L.push(`- c*: ${l1.c_star_m_s.toFixed(0)} m/s · Isp (vacuum, ideal max): ${l1.isp_vacuum_s.toFixed(0)} s`);
      L.push("", "Species (mole fraction):");
      [...l1.species_mol].filter(([, x]) => x > 0.0005).sort((a, b) => b[1] - a[1]).forEach(([n, x]) => L.push(`- ${n}: ${(x * 100).toFixed(2)} %`));
    }
    if (l2) {
      L.push("", "## L2 — Nozzle", "");
      L.push(`- Contour: ${curKind} · Area ratio: ${l2.area_ratio.toFixed(2)} · Exit Mach: ${l2.exit_mach.toFixed(2)}`);
      L.push(`- Exit P: ${(l2.exit_pressure_pa / 1e5).toFixed(3)} bar · Exit T: ${l2.exit_temperature_k.toFixed(0)} K`);
      L.push(`- Divergence λ: ${l2.divergence_correction.toFixed(3)} · BL: ${l2.boundary_layer_correction.toFixed(3)} · Isp (delivered): ${l2.isp_s.toFixed(0)} s`);
    }
    const params = Object.entries(design?.params ?? {});
    const choices = Object.entries(design?.choices ?? {});
    if (params.length || choices.length) {
      L.push("", "## Customized subsystem parameters", "");
      params.forEach(([k, v]) => L.push(`- ${k} = ${v}`));
      choices.forEach(([k, v]) => L.push(`- ${k} = ${v}`));
    }
    L.push("", `_Generated by Propulsor. Isp figures: L0 sea-level ideal, L1 vacuum ideal-max, L2 delivered at ε._`, "");
    return L.join("\n");
  };

  // Full design CSV (one key,value per row) — whole design, not just contour.
  const buildFullCsv = (): string => {
    const rows: [string, string | number][] = [
      ["name", design?.meta.name ?? ""], ["revision", design?.meta.revision ?? 0],
      ["propellant", pairSet ? (pair as string) : ""],
      ["thrust_N", curThrust], ["chamber_pressure_bar", curPcBar], ["mixture_ratio_of", curOf],
    ];
    if (l0) rows.push(["total_flow_kg_s", l0.total_flow], ["ox_flow_kg_s", l0.oxidizer_flow], ["fuel_flow_kg_s", l0.fuel_flow], ["throat_dia_mm", l0.throat_diameter * 1000], ["exit_dia_mm", l0.exit_diameter * 1000], ["chamber_dia_mm", l0.chamber_diameter * 1000], ["chamber_length_mm", l0.chamber_length * 1000], ["wall_thickness_mm", l0.wall_thickness * 1000], ["l0_isp_sl_s", l0.isp_s], ["l0_cstar_m_s", l0.c_star_m_s]);
    if (l1) rows.push(["tc_k", l1.tc_k], ["gamma", l1.gamma], ["mw_g_mol", l1.mean_molecular_weight], ["l1_cstar_m_s", l1.c_star_m_s], ["isp_vac_idealmax_s", l1.isp_vacuum_s]);
    if (l2) rows.push(["area_ratio", l2.area_ratio], ["exit_mach", l2.exit_mach], ["exit_pressure_bar", l2.exit_pressure_pa / 1e5], ["exit_temp_k", l2.exit_temperature_k], ["divergence", l2.divergence_correction], ["l2_isp_delivered_s", l2.isp_s]);
    (l1?.species_mol ?? []).forEach(([n, x]) => rows.push([`species_${n}_molefrac`, x]));
    Object.entries(design?.params ?? {}).forEach(([k, v]) => rows.push([`param_${k}`, v]));
    Object.entries(design?.choices ?? {}).forEach(([k, v]) => rows.push([`choice_${k}`, v]));
    return "key,value\n" + rows.map(([k, v]) => `${k},${v}`).join("\n") + "\n";
  };

  return (
    <div className="wizard">
      <div className="wizard-rail">
        {STEPS.map((s, i) => (
          <div key={s} className={`wizard-step ${i === step ? "active" : ""} ${i < step ? "done" : ""}`} onClick={() => setStep(i)}>
            <span className="num">{i < step ? "✓" : i + 1}</span>
            {s}
          </div>
        ))}
      </div>

      <div className="wizard-body">
        <h2 className="wizard-title">Step {step + 1} — {STEPS[step]}</h2>

        {step === 0 && (
          <fieldset className="qt-groupbox">
            <legend>Requirements &amp; propellant</legend>
            <div className="qt-field" style={{ alignItems: "flex-start" }}>
              <span>Load an example</span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
                {PRESETS.map((p) => (
                  <button key={p.name} className="qt-tool" style={{ fontSize: 11 }} onClick={() => applyPreset(p)}>{p.name}</button>
                ))}
              </span>
            </div>
            <hr style={{ border: "none", borderTop: "1px solid #e2e2e6", margin: "8px 0" }} />
            <label className="qt-field">
              <span>Propellant pair</span>
              <select value={pairSet ? pair : ""} onChange={(e) => store.apply("propellant_pair", e.target.value)}>
                <option value="">— Select propellant —</option>
                {PAIRS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="qt-field">
              <span>Thrust (N)</span>
              <CommitNumberField value={curThrust} step={100} placeholder="e.g. 5000" emptyWhenZero onCommit={(n) => store.apply("thrust", n)} />
            </label>
            <label className="qt-field">
              <span>Chamber pressure (bar)</span>
              <CommitNumberField value={curPcBar} step={1} placeholder="e.g. 20" emptyWhenZero displayDecimals={2} onCommit={(n) => store.apply("chamber_pressure", n * 1e5)} />
            </label>
            <label className="qt-field">
              <span>
                Mixture ratio
                <span style={{ marginLeft: 6 }}>
                  {(["O/F", "φ", "%fuel"] as const).map((m) => (
                    <button key={m} type="button" className={`qt-tool ${ofMode === m ? "on" : ""}`} style={{ padding: "0 5px", marginLeft: 2, fontSize: 11 }} onClick={() => setOfMode(m)}>{m}</button>
                  ))}
                </span>
              </span>
              <CommitNumberField value={+ofToDisplay(curOf).toFixed(3)} step={ofMode === "%fuel" ? 1 : 0.1} placeholder={ofMode === "φ" ? "e.g. 1.0" : ofMode === "%fuel" ? "e.g. 29" : "e.g. 2.4"} emptyWhenZero onCommit={(n) => store.apply("mixture_ratio", +displayToOf(n).toFixed(4))} />
            </label>
            <label className="qt-field">
              <span>Target burnout altitude (km)</span>
              <input type="number" step={5} value={burnoutKm} onChange={(e) => setBurnoutKm(Number(e.target.value))} />
            </label>
            {!configured ? (
              <p className="muted">Enter thrust, chamber pressure, mixture ratio and a propellant to build the engine — nothing is pre-computed.</p>
            ) : (
              <>
                <div className="qt-field"><span>Flame temperature T_c</span><b>{l1 ? `${l1.tc_k.toFixed(0)} K` : "—"}</b></div>
                <div className="qt-field"><span>Vacuum Isp (equilibrium)</span><b>{l1 ? `${l1.isp_vacuum_s.toFixed(0)} s` : "—"}</b></div>
                <p className="muted">Choices are written to the design and every dependent tier re-solves live.</p>
              </>
            )}
          </fieldset>
        )}

        {step === 1 && (
          <fieldset className="qt-groupbox">
            <legend>Mixture ratio &amp; chamber length</legend>
            <div className="qt-field"><span>Current O/F</span><b>{curOf.toFixed(2)}</b></div>
            <div className="qt-field"><span>Optimal O/F (max Isp)</span><b>{advice ? `${advice.optimal_of.toFixed(2)} → ${advice.optimal_isp_vac_s.toFixed(0)} s` : "…"}</b></div>
            <button className="qt-tool" disabled={!advice} onClick={() => advice && store.apply("of_ratio", Number(advice.optimal_of.toFixed(2)))}>Use optimal O/F</button>
            <hr style={{ border: "none", borderTop: "1px solid #e2e2e6", margin: "10px 0" }} />
            <label className="qt-field">
              <span>Characteristic length L* (m)</span>
              <CommitNumberField value={curLStar} step={0.05} displayDecimals={2} onCommit={(n) => store.apply("l_star", n)} />
            </label>
            <div className="qt-field"><span>Recommended L* for this pair</span><b>{advice ? `${advice.recommended_l_star_m.toFixed(2)} m` : "…"}</b></div>
            <button className="qt-tool" disabled={!advice} onClick={() => advice && store.apply("l_star", Number(advice.recommended_l_star_m.toFixed(2)))}>Use recommended L*</button>
            <div className="qt-field" style={{ marginTop: 8 }}><span>Resulting chamber length (solved)</span><b>{l0 ? `${(l0.chamber_length * 1000).toFixed(0)} mm` : "—"}</b></div>
          </fieldset>
        )}

        {step === 2 && (
          <fieldset className="qt-groupbox">
            <legend>Nozzle type &amp; expansion</legend>
            <div className="qt-field">
              <span>Contour</span>
              <span>
                {(["Bell", "Conical"] as const).map((n) => (
                  <button key={n} className={`qt-tool ${curKind === n ? "on" : ""}`} style={{ marginLeft: 6 }} onClick={() => store.apply("nozzle_kind", n)}>{n}</button>
                ))}
              </span>
            </div>
            <div className="qt-field"><span>Expansion strategy</span><span /></div>
            {([
              ["performance", "Max performance", advice?.expansion.optimal_area_ratio],
              ["separation-safe", "Separation-safe (sea-level start)", advice?.expansion.separation_limited_area_ratio],
              ["sea-level", "Sea-level optimum", advice?.expansion.sea_level_optimal_area_ratio],
            ] as const).map(([id, label, val]) => (
              <label key={id} className="qt-field" style={{ cursor: "pointer" }}>
                <span><input type="radio" checked={strategy === id} onChange={() => applyStrategy(id as typeof strategy)} style={{ marginRight: 8 }} />{label}</span>
                <b>ε = {val ? val.toFixed(1) : "…"}</b>
              </label>
            ))}
            {advice?.expansion.separated_at_sea_level && strategy === "performance" && (
              <p className="err">⚠ The max-performance nozzle (ε={advice.expansion.optimal_area_ratio.toFixed(0)}) flow-separates at sea level — use the separation-safe ratio for a lift-off nozzle.</p>
            )}
            <div className="qt-field"><span>Design expansion ratio (solved)</span><b>ε = {curEps.toFixed(1)}</b></div>
            <hr style={{ border: "none", borderTop: "1px solid #e2e2e6", margin: "10px 0" }} />
            <ParamChoice label="Nozzle flow model" k="thermo.flow_model" def="equilibrium" options={["equilibrium", "frozen"]} hint="equilibrium (shifting) recombines in the nozzle for a few % more Isp; frozen holds the chamber composition (approximate first-order correction)" />
            <div className="qt-field"><span>Delivered Isp (solved)</span><b>{l2 ? `${l2.isp_s.toFixed(0)} s` : "—"}</b></div>
          </fieldset>
        )}

        {step === 3 && (
          <fieldset className="qt-groupbox">
            <legend>Cooling</legend>
            <label className="qt-field">
              <span>Method</span>
              <select value={curMethod} onChange={(e) => store.apply("cooling_method", e.target.value)}>
                <option value="regen">Regenerative</option>
                <option value="film">Film</option>
                <option value="radiation">Radiation</option>
                <option value="ablative">Ablative</option>
              </select>
            </label>
            <label className="qt-field">
              <span>Chamber wall material</span>
              <select value={curMaterial} onChange={(e) => store.apply("wall_material", e.target.value)}>
                {(cool?.materials ?? []).map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
            </label>
            <label className="qt-field">
              <span>Nozzle-extension material (multi-material)</span>
              <select value={curNozzleMat} onChange={(e) => store.apply("nozzle_material", e.target.value)}>
                <option value="">(none)</option>
                {(cool?.materials ?? []).filter((m) => m.cooling_class === "Radiation").map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
            </label>
            {cool && (
              <div className="qt-field">
                <span>Max wall temperature</span>
                <span className={`qt-badge ${cool.regen.max_wall_temp_k > cool.regen.wall_material_limit_k ? "failed" : "solved"}`}>
                  {cool.regen.max_wall_temp_k.toFixed(0)} K / {cool.regen.wall_material_limit_k.toFixed(0)} K
                </span>
              </div>
            )}
            {cool?.nozzle_extension && (
              <div className="qt-field">
                <span>Radiation nozzle skirt ({cool.nozzle_extension_material})</span>
                <span className={`qt-badge ${cool.nozzle_extension.material_ok ? "solved" : "failed"}`}>{cool.nozzle_extension.equilibrium_wall_temp_k.toFixed(0)} K</span>
              </div>
            )}
          </fieldset>
        )}

        {step === 4 && (
          <fieldset className="qt-groupbox">
            <legend>Feed system</legend>
            <div className="qt-field">
              <span>Feed type</span>
              <span>
                {(["Auto", "Self-pressurizing", "Pressure-fed", "Pump-fed"] as const).map((f) => (
                  <button key={f} className={`qt-tool ${feed === f ? "on" : ""}`} style={{ marginLeft: 6 }} onClick={() => setFeed(f)}>{f}</button>
                ))}
              </span>
            </div>
            {feed === "Pump-fed" && (
              <>
                <label className="qt-field"><span>Shaft speed (rpm)</span><input type="number" step={500} value={rpm} onChange={(e) => setRpm(Number(e.target.value))} /></label>
                {turbo && (
                  <table className="qt-proptable">
                    <tbody>
                      <tr><td>Pump shaft power</td><td className="val">{(turbo.pump.shaft_power_w / 1000).toFixed(0)} kW</td></tr>
                      <tr><td>Shaft critical speed</td><td className="val">{turbo.shaft.first_critical_rpm.toFixed(0)} rpm ({turbo.shaft.subcritical ? "sub" : "super"})</td></tr>
                      <tr><td>GG flow fraction</td><td className="val">{(turbo.gg_cycle.gg_flow_fraction * 100).toFixed(1)} %</td></tr>
                      <tr><td>Cycle balance</td><td className="val">{turbo.gg_cycle.margin.toFixed(2)}</td></tr>
                    </tbody>
                  </table>
                )}
                <p className="muted">Full sizing on the Turbopumps tab.</p>
              </>
            )}
            {feed === "Pressure-fed" && <p className="muted">Pressure-fed: no turbomachinery — a regulated gas pushes the propellants.</p>}
            {feed === "Self-pressurizing" && <p className="muted">Self-pressurizing: the propellant's own vapor pressure feeds the chamber (e.g. N₂O/propane) — no pressurant or pumps.</p>}
            {feed === "Auto" && <p className="muted">Auto: the Feed System tab recommends an architecture from the propellant vapor pressure and chamber pressure.</p>}
          </fieldset>
        )}

        {step === 5 && (
          <fieldset className="qt-groupbox">
            <legend>Design summary</legend>
            <table className="qt-proptable">
              <tbody>
                <tr><td>Propellant</td><td className="val">{pairSet ? pair : "—"}</td></tr>
                <tr><td>Mixture ratio O/F</td><td className="val">{curOf.toFixed(2)}</td></tr>
                <tr><td>Nozzle</td><td className="val">{curKind}, ε = {curEps.toFixed(1)}</td></tr>
                <tr><td>Cooling</td><td className="val">{curMethod}, {curMaterial}{curNozzleMat ? ` + ${curNozzleMat} skirt` : ""}</td></tr>
                <tr><td>Feed</td><td className="val">{feed}{feed === "Pump-fed" ? ` @ ${rpm} rpm` : ""}</td></tr>
                <tr><td>Throat / exit Ø</td><td className="val">{l0 ? `${(l0.throat_diameter * 1000).toFixed(1)} / ${(l0.exit_diameter * 1000).toFixed(1)} mm` : "—"}</td></tr>
                <tr><td>Design revision</td><td className="val">{design?.meta.revision ?? 0}</td></tr>
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button className="qt-tool" onClick={() => downloadText(`${(design?.meta.name || "propulsor").replace(/\s+/g, "_")}_report.md`, buildReport())} disabled={!l0}>Full report (Markdown)</button>
              <button className="qt-tool" onClick={() => downloadText(`${(design?.meta.name || "propulsor").replace(/\s+/g, "_")}_design.csv`, buildFullCsv())} disabled={!l0}>Full design CSV</button>
              <button className="qt-tool" onClick={exportContourCsv} disabled={!l2?.stations}>Nozzle contour CSV</button>
              <button className="qt-tool" onClick={() => cool && downloadText("heat_flux.csv", cool.heat_flux_csv)} disabled={!cool}>Heat-flux CSV</button>
            </div>
          </fieldset>
        )}

        <div className="wizard-nav">
          <button className="qt-tool" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>‹ Back</button>
          <div style={{ flex: 1 }} />
          <button className="qt-tool" disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>Next ›</button>
        </div>
      </div>
    </div>
  );
}
