import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { controlStudy, type ControlStudyDto, type ControlActuatorDto } from "./api";
import { useEngineStore } from "./store";
import { ParamField, ResetParams } from "./ParamInput";

const AXIS = { fill: "#6b7280", fontSize: 11 } as const;
const TT = { background: "#fff", border: "1px solid #b9bcc4", borderRadius: 4, fontSize: 12 } as const;
const FEEDS: [string, string][] = [
  ["", "Auto"],
  ["pressure-fed", "Pressure-fed"],
  ["pump-fed", "Gas-generator"],
];

export function Control() {
  const [feedType, setFeedType] = useState("");
  const [study, setStudy] = useState<ControlStudyDto | null>(null);
  const rev = useEngineStore((s) => s.design?.meta.revision);

  useEffect(() => {
    let live = true;
    controlStudy(feedType).then((s) => live && setStudy(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [feedType, rev]);

  if (!study) return <p className="muted">Designing controller…</p>;

  return (
    <div>
      <fieldset className="qt-groupbox">
        <legend>Control architecture (NASA TM-105318)</legend>
        <div className="qt-field">
          <span>Engine cycle</span>
          <span>
            {FEEDS.map(([id, label]) => (
              <button key={id} className={`qt-tool ${feedType === id ? "on" : ""}`} style={{ marginLeft: 6 }} onClick={() => setFeedType(id)}>{label}</button>
            ))}
          </span>
        </div>
        <div className="qt-field"><span>Controller</span><span className="qt-badge solved">{study.summary}</span></div>
      </fieldset>

      <fieldset className="qt-groupbox">
        <legend>Control inputs<span style={{ float: "right" }}><ResetParams prefix="control." /></span></legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 16px" }}>
          <ParamField label="Pc loop bandwidth (slow)" k="control.pc_bandwidth_hz" def={5} step={0.5} unit="Hz" hint="thrust-response bandwidth" />
          <ParamField label="MR loop bandwidth (fast)" k="control.mr_bandwidth_hz" def={20} step={1} unit="Hz" hint="fast loop holds combustion temperature" />
          <ParamField label="Sample rate" k="control.sample_rate_hz" def={50} step={10} unit="Hz" hint="SSME uses 50 Hz PI" />
          <ParamField label="Combustion dead time σ" k="control.combustion_delay_ms" def={1.5} step={0.1} unit="ms" />
          <ParamField label="Throttle step target" k="control.throttle_target" def={0.8} step={0.05} hint="fraction of rated Pc for the step test" />
          <ParamField label="Turbine temp redline" k="control.turbine_redline_k" def={1100} step={25} unit="K" hint="pump-fed shutdown redline" />
        </div>
      </fieldset>

      <fieldset className="qt-groupbox">
        <legend>Control loop diagram</legend>
        <LoopDiagram study={study} />
        <table className="qt-proptable" style={{ marginTop: 8 }}>
          <thead><tr><th>Loop</th><th>Var</th><th>Speed</th><th>Bandwidth</th><th>Setpoint</th><th>Actuator</th></tr></thead>
          <tbody>
            {study.loops.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td><td>{l.variable}</td>
                <td>{l.speed === "fast" ? "fast ⚡" : "slow"}</td>
                <td className="val">{l.bandwidth_hz.toFixed(1)} Hz</td>
                <td className="val">{l.setpoint.toFixed(2)} {l.unit}</td>
                <td>{l.actuator}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      <div>
        <fieldset className="qt-groupbox">
          <legend>Closed-loop throttle step — Pc (settle {study.pc_settling_time_s.toFixed(2)} s, overshoot {study.pc_overshoot_pct.toFixed(1)}%)</legend>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={study.pc_step.map((s) => ({ t: s.t_s * 1000, sp: s.setpoint * study.pc_setpoint_bar, pc: s.response * study.pc_setpoint_bar }))} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
              <XAxis type="number" dataKey="t" stroke="#6b7280" tick={AXIS} label={{ value: "time (ms)", position: "insideBottom", offset: -3, fill: "#6b7280" }} />
              <YAxis stroke="#6b7280" tick={AXIS} domain={["auto", "auto"]} label={{ value: "Pc (bar)", angle: -90, position: "insideLeft", fill: "#6b7280" }} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line name="commanded" dataKey="sp" stroke="#8a8f98" strokeDasharray="5 3" dot={false} strokeWidth={1.5} />
              <Line name="closed-loop Pc" dataKey="pc" stroke="#3574e0" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
          <p className="qt-caption">PI on a first-order chamber (τ_fill = V_c/(c*·A_t) = {study.chamber_fill_time_ms.toFixed(1)} ms) with {study.combustion_delay_ms.toFixed(1)} ms combustion dead time, IMC-tuned to the Pc-loop bandwidth.</p>
          {study.warnings.map((w, i) => <p key={i} className="err">⚠ {w}</p>)}
        </fieldset>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
        <fieldset className="qt-groupbox">
          <legend>Actuators (valves)</legend>
          <table className="qt-proptable">
            <thead><tr><th>Valve</th><th>Function</th><th>Mode</th></tr></thead>
            <tbody>
              {study.actuators.map((a: ControlActuatorDto) => (
                <tr key={a.name}>
                  <td title={a.note}>{a.name}</td>
                  <td>{a.function}</td>
                  <td><span className={`qt-badge ${a.closed_loop ? "solved" : ""}`}>{a.closed_loop ? "closed-loop" : "open-loop"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>Sensors &amp; redlines</legend>
          <p className="qt-caption" style={{ margin: "2px 0 6px" }}>Sensor suite</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {study.sensors.map((s) => <span key={s} className="qt-badge" style={{ background: "#eef1f6", color: "#333" }}>{s}</span>)}
          </div>
          <p className="qt-caption" style={{ margin: "10px 0 6px" }}>Redlines (safety cutoffs)</p>
          <table className="qt-proptable">
            <tbody>
              {study.redlines.map((r) => (
                <tr key={r.name}><td>{r.name}</td><td className="val">{r.limit.toFixed(0)} {r.unit}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="qt-caption" style={{ marginTop: 8 }}>Startup &amp; shutdown are open-loop scheduled (ignition timing, propellant arrival, valve sequencing); turbine-temperature redlines command shutdown.</p>
        </fieldset>
      </div>
    </div>
  );
}

/** Two-loop feedback block diagram: setpoint → PI → valve → engine → sensor. */
function LoopDiagram({ study }: { study: ControlStudyDto }) {
  const pc = study.loops.find((l) => l.variable === "Pc");
  const mr = study.loops.find((l) => l.variable === "MR");
  const row = (y: number, color: string, loop: typeof pc, label: string) => {
    if (!loop) return null;
    const box = (x: number, w: number, text: string, sub?: string) => (
      <g>
        <rect x={x} y={y - 16} width={w} height={32} rx={4} fill="#f2f4f8" stroke={color} strokeWidth={1.5} />
        <text x={x + w / 2} y={sub ? y - 2 : y + 4} textAnchor="middle" fontSize={10.5} fill="#222">{text}</text>
        {sub && <text x={x + w / 2} y={y + 11} textAnchor="middle" fontSize={8.5} fill="#777">{sub}</text>}
      </g>
    );
    const arrow = (x1: number, x2: number) => <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth={1.6} markerEnd="url(#ah)" />;
    return (
      <g>
        <circle cx={40} cy={y} r={10} fill="#fff" stroke={color} strokeWidth={1.5} />
        <text x={40} y={y + 4} textAnchor="middle" fontSize={12} fill={color}>Σ</text>
        <text x={40} y={y - 18} textAnchor="middle" fontSize={9} fill="#666">{label} set</text>
        {arrow(50, 92)}
        {box(92, 66, "PI", `${loop.speed}`)}
        {arrow(158, 196)}
        {box(196, 96, loop.actuator.length > 16 ? loop.actuator.slice(0, 15) + "…" : loop.actuator, "valve")}
        {arrow(292, 330)}
        {box(330, 84, "Engine", `${loop.variable}`)}
        {arrow(414, 452)}
        <text x={470} y={y + 4} fontSize={10} fill="#333">{loop.variable} = {loop.setpoint.toFixed(2)} {loop.unit}</text>
        {/* feedback */}
        <line x1={372} y1={y + 16} x2={372} y2={y + 30} stroke={color} strokeWidth={1.2} />
        <line x1={372} y1={y + 30} x2={40} y2={y + 30} stroke={color} strokeWidth={1.2} />
        <line x1={40} y1={y + 30} x2={40} y2={y + 11} stroke={color} strokeWidth={1.2} markerEnd="url(#ah)" />
        <rect x={196} y={y + 22} width={60} height={16} rx={2} fill="#fafbfc" stroke={color} strokeWidth={1} />
        <text x={226} y={y + 34} textAnchor="middle" fontSize={8.5} fill="#666">sensor</text>
      </g>
    );
  };
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--qt-border)", borderRadius: 4, background: "#fafbfc" }}>
      <svg viewBox="0 0 560 150" width="100%" role="img" aria-label="control loop diagram">
        <defs>
          <marker id="ah" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#555" /></marker>
        </defs>
        {row(38, "#3574e0", pc, "Pc")}
        {row(112, "#c23b34", mr, "MR")}
      </svg>
    </div>
  );
}
