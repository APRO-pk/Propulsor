import { useEffect, useState } from "react";
import { analysisStudy, type AnalysisStudyDto, type EreResultDto } from "./api";
import { useEngineStore } from "./store";
import { ParamField, ParamChoice, ResetParams } from "./ParamInput";
import { downloadText } from "./Cooling";

export function Analysis() {
  const [a, setA] = useState<AnalysisStudyDto | null>(null);
  const rev = useEngineStore((s) => s.design?.meta.revision);
  useEffect(() => {
    let live = true;
    analysisStudy().then((r) => live && setA(r)).catch(() => {});
    return () => {
      live = false;
    };
  }, [rev]);

  if (!a) return <p className="muted">Running analysis…</p>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <fieldset className="qt-groupbox" style={{ gridColumn: "1 / 3" }}>
        <legend>Injector design inputs<span style={{ float: "right" }}><ResetParams prefix="injector." /></span></legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 16px" }}>
          <ParamChoice label="Element type" k="injector.element_type" def="UnlikeDoublet" options={["UnlikeDoublet", "LikeDoublet", "Coaxial"]} />
          <ParamField label="Element count" k="injector.element_count" def={24} step={1} />
          <ParamField label="ΔP (frac of Pc)" k="injector.dp_fraction" def={0.2} step={0.01} hint="0.15–0.3 typical; higher ΔP = more stable" />
          <ParamField label="Discharge coeff Cd" k="injector.discharge_coefficient" def={0.7} step={0.01} />
          <ParamField label="Surface tension" k="injector.surface_tension_n_m" def={0.02} step={0.005} unit="N/m" hint="atomization (SMD)" />
          <ParamField label="Fuel/ox density ratio" k="injector.fuel_density_factor" def={0.72} step={0.02} />
          <ParamField label="Combustion time lag τ" k="injector.time_lag_ms" def={1.5} step={0.1} unit="ms" hint="n–τ instability model" />
          <ParamField label="Interaction index n" k="injector.interaction_index" def={0.5} step={0.05} hint="Crocco n–τ; lower = more stable" />
        </div>
      </fieldset>
      <ErePanel ere={a.ere} />
      <fieldset className="qt-groupbox">
        <legend>Injector fluid-flow</legend>
        <table className="qt-proptable">
          <thead><tr><th></th><th>Oxidizer</th><th>Fuel</th></tr></thead>
          <tbody>
            <tr><td>Injection velocity</td><td className="val">{a.injector.ox.injection_velocity_m_s.toFixed(1)} m/s</td><td className="val">{a.injector.fuel.injection_velocity_m_s.toFixed(1)} m/s</td></tr>
            <tr><td>Orifice Ø</td><td className="val">{(a.injector.ox.orifice_diameter_m * 1000).toFixed(2)} mm</td><td className="val">{(a.injector.fuel.orifice_diameter_m * 1000).toFixed(2)} mm</td></tr>
            <tr><td>Sauter mean Ø (SMD)</td><td className="val">{(a.injector.ox.sauter_mean_diameter_m * 1e6).toFixed(0)} µm</td><td className="val">{(a.injector.fuel.sauter_mean_diameter_m * 1e6).toFixed(0)} µm</td></tr>
            <tr><td>Weber number</td><td className="val">{a.injector.ox.weber_number.toFixed(0)}</td><td className="val">{a.injector.fuel.weber_number.toFixed(0)}</td></tr>
          </tbody>
        </table>
        <div className="qt-field"><span>Injector ΔP</span><b>{(a.injector.pressure_drop_pa / 1000).toFixed(0)} kPa</b></div>
        <div className="qt-field"><span>Momentum ratio (ox/fuel)</span><b>{a.injector.momentum_ratio.toFixed(2)}</b></div>
        {a.injector.flags.map((f, i) => <p key={i} className="err">⚠ {f}</p>)}
      </fieldset>

      <fieldset className="qt-groupbox">
        <legend>Combustion instability (SP-8113)</legend>
        <table className="qt-proptable">
          <thead><tr><th>Acoustic mode</th><th>Frequency</th></tr></thead>
          <tbody>
            {a.instability.modes.map((m) => (
              <tr key={m.name} style={{ fontWeight: m.name === a.instability.dominant_mode ? 700 : 400 }}>
                <td>{m.name}</td><td className="val">{m.frequency_hz.toFixed(0)} Hz</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="qt-field"><span>Dominant / regime</span><b>{a.instability.dominant_mode.split(" ")[0]} · {a.instability.regime}</b></div>
        <div className="qt-field">
          <span>n–τ stability</span>
          <span className={`qt-badge ${a.instability.stable ? "solved" : "failed"}`}>margin {a.instability.stability_margin.toFixed(2)} · {a.instability.stable ? "STABLE" : "UNSTABLE"}</span>
        </div>
        {a.instability.notes.map((n, i) => <p key={i} className="muted">• {n}</p>)}
      </fieldset>

      <fieldset className="qt-groupbox" style={{ gridColumn: "1 / 3" }}>
        <legend>Distributed wall stress (FEM-like)</legend>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div className="qt-field" style={{ minWidth: 220 }}>
            <span>Peak combined stress</span>
            <span className={`qt-badge ${a.stress.yields ? "failed" : "solved"}`}>{(a.stress.max_combined_stress_pa / 1e6).toFixed(0)} MPa</span>
          </div>
          <div className="qt-field" style={{ minWidth: 200 }}><span>Min safety margin</span><b>{a.stress.min_margin.toFixed(2)}</b></div>
          <div className="qt-field" style={{ minWidth: 200 }}><span>Stations</span><b>{a.stress.stations.length}</b></div>
        </div>
        <StressStrip stations={a.stress.stations} />
        <button className="qt-tool" style={{ marginTop: 10 }} onClick={() => downloadText("stress_field.csv", a.stress_csv)}>Export stress field CSV (FEM)</button>
      </fieldset>
    </div>
  );
}

/** Computed combustion (c*) efficiency — ERE from residence time / vaporization / mixing. */
function ErePanel({ ere }: { ere: EreResultDto }) {
  const apply = useEngineStore((s) => s.apply);
  const design = useEngineStore((s) => s.design);
  const current = design?.operating_point.c_star_efficiency ?? 0.95;
  const [applied, setApplied] = useState(false);
  const bars: [string, number, string][] = [
    ["Residence η_res (from L*)", ere.residence_efficiency, "#3574e0"],
    ["Atomization η_atom (from SMD)", ere.atomization_efficiency, "#c47b12"],
    ["Mixing η_mix", ere.mixing_efficiency, "#2f8f46"],
  ];
  return (
    <fieldset className="qt-groupbox" style={{ gridColumn: "1 / 3" }}>
      <legend>Computed combustion efficiency — ERE (energy release)</legend>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div>
          {bars.map(([label, v, color]) => (
            <div key={label} style={{ margin: "6px 0" }}>
              <div className="qt-caption" style={{ display: "flex", justifyContent: "space-between", margin: 0 }}>
                <span>{label}</span><span>{(v * 100).toFixed(1)}%</span>
              </div>
              <div style={{ height: 9, background: "#eceef1", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.max(0, (v - 0.5) / 0.5) * 100}%`, height: "100%", background: color }} />
              </div>
            </div>
          ))}
          <p className="qt-caption" style={{ marginTop: 8 }}>Bars scaled 50–100%. η_res from residence time vs required combustion time (rises with L*); η_atom penalizes coarse sprays; η_mix from element density &amp; ΔP.</p>
        </div>
        <div>
          <table className="qt-proptable">
            <tbody>
              <tr><td>Residence (stay) time τ_res</td><td className="val">{ere.residence_time_ms.toFixed(2)} ms</td></tr>
              <tr><td>Required combustion time τ_req</td><td className="val">{ere.required_time_ms.toFixed(2)} ms</td></tr>
              <tr><td>Energy-release efficiency (ERE)</td><td className="val"><b>{(ere.energy_release_efficiency * 100).toFixed(1)}%</b></td></tr>
              <tr><td>Derived c* efficiency</td><td className="val">{(ere.c_star_efficiency * 100).toFixed(1)}%</td></tr>
              <tr><td>Current design c* efficiency</td><td className="val">{(current * 100).toFixed(1)}%</td></tr>
            </tbody>
          </table>
          <button
            className="qt-tool"
            style={{ marginTop: 10 }}
            onClick={() => { void apply("c_star_efficiency", +ere.c_star_efficiency.toFixed(4)); setApplied(true); }}
          >
            Apply derived c* efficiency to design
          </button>
          {applied && <span className="qt-badge solved" style={{ marginLeft: 8 }}>applied → Isp re-resolved</span>}
        </div>
      </div>
    </fieldset>
  );
}

/** A compact stress-vs-axial strip, coloured by combined stress (FEM contour). */
function StressStrip({ stations }: { stations: AnalysisStudyDto["stress"]["stations"] }) {
  const xs = stations.map((s) => s.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const smin = Math.min(...stations.map((s) => s.combined_stress_pa));
  const smax = Math.max(...stations.map((s) => s.combined_stress_pa));
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", height: 26, borderRadius: 4, overflow: "hidden", border: "1px solid var(--qt-border)" }}>
        {stations.map((s, i) => (
          <div
            key={i}
            title={`x=${s.x.toFixed(3)} m · ${(s.combined_stress_pa / 1e6).toFixed(0)} MPa · margin ${s.margin.toFixed(2)}`}
            style={{ flex: 1, background: stressColor(s.combined_stress_pa, smin, smax) }}
          />
        ))}
      </div>
      <div className="qt-caption" style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span>injector (x={x0.toFixed(2)} m)</span>
        <span>exit (x={x1.toFixed(2)} m)</span>
      </div>
    </div>
  );
}

function stressColor(v: number, min: number, max: number): string {
  const s = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0; // hot → red
  const r = Math.round(210 * s + 30);
  const g = Math.round(150 * (1 - s) + 40);
  return `rgb(${r}, ${g}, 60)`;
}
