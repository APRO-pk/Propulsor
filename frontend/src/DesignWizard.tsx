import { useEffect, useState } from "react";
import { useEngineStore } from "./store";
import { designAdvice, coolingStudy, turbopumpStudy, type DesignAdviceDto, type CoolingStudyDto, type TurbopumpStudyDto } from "./api";
import { downloadText } from "./Cooling";
import { CommitNumberField } from "./ParamInput";
import { engineProfile } from "./exporters";

const STEPS = ["Propellant & mission", "Performance / O·F", "Nozzle & expansion", "Cooling", "Feed & turbomachinery", "Review & export"];

const PAIRS = [
  "GoxKerosene", "GoxGasoline", "GoxEthanol", "GoxMethanol",
  "LoxRp1", "LoxEthanol", "LoxMethane", "NitrousPropane", "NtoMmh", "NtoUdmh",
];

export function DesignWizard() {
  const store = useEngineStore();
  const { l0, l1, l2, design } = store;
  const [step, setStep] = useState(0);
  const [burnoutKm, setBurnoutKm] = useState(40);
  const [strategy, setStrategy] = useState<"performance" | "separation-safe" | "sea-level">("performance");
  const [feed, setFeed] = useState<"Auto" | "Self-pressurizing" | "Pressure-fed" | "Pump-fed">("Pump-fed");
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
              <span>Mixture ratio O/F</span>
              <CommitNumberField value={curOf} step={0.1} placeholder="e.g. 2.4" emptyWhenZero onCommit={(n) => store.apply("mixture_ratio", n)} />
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
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="qt-tool" onClick={exportContourCsv} disabled={!l2?.stations}>Export nozzle contour CSV</button>
              <button className="qt-tool" onClick={() => cool && downloadText("heat_flux.csv", cool.heat_flux_csv)} disabled={!cool}>Export heat-flux CSV</button>
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
