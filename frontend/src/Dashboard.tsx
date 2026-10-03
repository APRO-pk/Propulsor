import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEngineStore } from "./store";
import { engineProfile, exportStl, exportDxf, exportStep } from "./exporters";

export function Dashboard() {
  const { l0, l1, l2, design } = useEngineStore();

  const profileData = useMemo(() => {
    if (!l0) return [];
    const prof = engineProfile(l0, l2);
    const gamma = l1?.gamma ?? 1.2;
    const pc = design?.operating_point.chamber_pressure ?? 2e6;
    const rt = Math.min(...prof.map((p) => p.r));
    let ti = 0;
    for (let i = 1; i < prof.length; i++) if (prof[i].r < prof[ti].r) ti = i;
    const exitMach = l2?.exit_mach ?? 2.8;
    const arExit = Math.max((prof[prof.length - 1].r / rt) ** 2, 1.001);
    return prof.map((p, i) => {
      let M: number;
      if (i <= ti) M = 0.12 + 0.88 * (ti > 0 ? i / ti : 1);
      else {
        const ar = Math.max((p.r / rt) ** 2, 1);
        M = 1 + (exitMach - 1) * Math.sqrt(Math.max(0, Math.min(1, (ar - 1) / (arExit - 1))));
      }
      const pr = (1 + ((gamma - 1) / 2) * M * M) ** (-gamma / (gamma - 1));
      return { x: +(p.x * 1000).toFixed(1), r: +(p.r * 1000).toFixed(1), M: +M.toFixed(2), p: +((pc * pr) / 1e5).toFixed(1) };
    });
  }, [l0, l1, l2, design]);

  if (!l0) return <p className="muted">No design solved.</p>;

  const thrustN = design?.operating_point.thrust ?? 0;
  const tiles: [string, string][] = [
    ["Thrust", thrustN < 1000 ? `${thrustN.toFixed(0)} N` : `${(thrustN / 1000).toFixed(2)} kN`],
    ["Isp (SL, ideal)", `${l0.isp_s.toFixed(0)} s`],
    ["Chamber P", `${((design?.operating_point.chamber_pressure ?? 0) / 1e5).toFixed(1)} bar`],
    ["T_c", `${(l1?.tc_k ?? l0.tc_k).toFixed(0)} K`],
    ["c* (ideal)", `${l0.c_star_m_s.toFixed(0)} m/s`],
    ["Throat Ø", `${(l0.throat_diameter * 1000).toFixed(1)} mm`],
    ["Exit Ø", `${(l0.exit_diameter * 1000).toFixed(1)} mm`],
    ["Area ratio", l0.area_ratio.toFixed(2)],
    ["Total flow", `${l0.total_flow < 1 ? l0.total_flow.toFixed(3) : l0.total_flow.toFixed(2)} kg/s`],
  ];

  return (
    <div>
      <div className="kpi-row">
        {tiles.map(([k, v]) => (
          <div key={k} className="kpi-tile">
            <div className="kpi-val">{v}</div>
            <div className="kpi-key">{k}</div>
          </div>
        ))}
      </div>

      <fieldset className="qt-groupbox">
        <legend>Nozzle profile — radius &amp; Mach along the axis</legend>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={profileData} margin={{ top: 8, right: 16, bottom: 6, left: 0 }}>
            <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
            <XAxis dataKey="x" stroke="#6b7280" tick={{ fill: "#6b7280", fontSize: 12 }} label={{ value: "axial x (mm)", position: "insideBottom", offset: -4, fill: "#6b7280" }} />
            <YAxis yAxisId="r" stroke="#3574e0" tick={{ fill: "#6b7280", fontSize: 12 }} label={{ value: "radius (mm)", angle: -90, position: "insideLeft", fill: "#3574e0" }} />
            <YAxis yAxisId="m" orientation="right" stroke="#c23b34" tick={{ fill: "#6b7280", fontSize: 12 }} label={{ value: "Mach", angle: 90, position: "insideRight", fill: "#c23b34" }} />
            <Tooltip contentStyle={{ background: "#fff", border: "1px solid #b9bcc4", borderRadius: 4, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area yAxisId="r" type="monotone" dataKey="r" name="radius (mm)" stroke="#3574e0" fill="#3574e0" fillOpacity={0.14} />
            <Line yAxisId="m" type="monotone" dataKey="M" name="Mach" stroke="#c23b34" dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <fieldset className="qt-groupbox">
          <legend>CAD export</legend>
          <p className="muted">Export the engine geometry for CAD, CFD or 3D printing.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="qt-tool" onClick={() => exportStl(engineProfile(l0, l2))}>STL mesh (3D)</button>
            <button className="qt-tool" onClick={() => exportDxf(engineProfile(l0, l2))}>DXF profile (2D)</button>
            <button className="qt-tool" onClick={() => exportStep(engineProfile(l0, l2))}>STEP surface</button>
          </div>
        </fieldset>

        <UnitConverter />
      </div>

      <Validation predictedThrustN={design?.operating_point.thrust ?? 0} predictedIsp={l0.isp_s} predictedPcBar={(design?.operating_point.chamber_pressure ?? 0) / 1e5} />
    </div>
  );
}

// ---- Unit converter --------------------------------------------------------
const UNITS: Record<string, Record<string, number>> = {
  Length: { m: 1, mm: 1e-3, cm: 1e-2, in: 0.0254, ft: 0.3048 },
  Pressure: { Pa: 1, kPa: 1e3, bar: 1e5, MPa: 1e6, psi: 6894.76, atm: 101325 },
  Force: { N: 1, kN: 1e3, lbf: 4.44822, kgf: 9.80665 },
  Mass: { kg: 1, g: 1e-3, lb: 0.453592 },
  Velocity: { "m/s": 1, "km/h": 1 / 3.6, "ft/s": 0.3048, mph: 0.44704 },
  "Mass flow": { "kg/s": 1, "g/s": 1e-3, "lb/s": 0.453592 },
};

function UnitConverter() {
  const [quantity, setQuantity] = useState("Pressure");
  const units = Object.keys(UNITS[quantity]);
  const [from, setFrom] = useState(units[0]);
  const [to, setTo] = useState(units[1]);
  const [value, setValue] = useState(1);

  const validFrom = UNITS[quantity][from] ? from : units[0];
  const validTo = UNITS[quantity][to] ? to : units[1];
  const result = (value * UNITS[quantity][validFrom]) / UNITS[quantity][validTo];

  return (
    <fieldset className="qt-groupbox">
      <legend>Unit converter</legend>
      <label className="qt-field">
        <span>Quantity</span>
        <select value={quantity} onChange={(e) => { const q = e.target.value; setQuantity(q); setFrom(Object.keys(UNITS[q])[0]); setTo(Object.keys(UNITS[q])[1]); }}>
          {Object.keys(UNITS).map((q) => <option key={q}>{q}</option>)}
        </select>
      </label>
      <label className="qt-field">
        <span>Value</span>
        <input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} />
      </label>
      <label className="qt-field">
        <span>From</span>
        <select value={validFrom} onChange={(e) => setFrom(e.target.value)}>{units.map((u) => <option key={u}>{u}</option>)}</select>
      </label>
      <label className="qt-field">
        <span>To</span>
        <select value={validTo} onChange={(e) => setTo(e.target.value)}>{units.map((u) => <option key={u}>{u}</option>)}</select>
      </label>
      <div className="qt-field"><span>Result</span><b>{result.toPrecision(6)} {validTo}</b></div>
    </fieldset>
  );
}

// ---- Test-data validation --------------------------------------------------
function Validation({ predictedThrustN, predictedIsp, predictedPcBar }: { predictedThrustN: number; predictedIsp: number; predictedPcBar: number }) {
  const [mThrust, setMThrust] = useState(predictedThrustN * 0.96);
  const [mIsp, setMIsp] = useState(predictedIsp * 0.97);
  const [mPc, setMPc] = useState(predictedPcBar * 0.98);

  const row = (label: string, predicted: number, measured: number, unit: string) => {
    const err = predicted !== 0 ? ((measured - predicted) / predicted) * 100 : 0;
    const ok = Math.abs(err) <= 5;
    return (
      <tr>
        <td>{label}</td>
        <td className="val">{predicted.toFixed(1)} {unit}</td>
        <td className="val">{measured.toFixed(1)} {unit}</td>
        <td className="val"><span className={`qt-badge ${ok ? "solved" : "failed"}`}>{err >= 0 ? "+" : ""}{err.toFixed(1)}%</span></td>
      </tr>
    );
  };

  return (
    <fieldset className="qt-groupbox">
      <legend>Validation vs test-stand data</legend>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
        <label className="qt-field" style={{ gap: 6 }}><span>Measured thrust (N)</span><input type="number" value={Math.round(mThrust)} onChange={(e) => setMThrust(Number(e.target.value))} /></label>
        <label className="qt-field" style={{ gap: 6 }}><span>Measured Isp (s)</span><input type="number" value={Math.round(mIsp)} onChange={(e) => setMIsp(Number(e.target.value))} /></label>
        <label className="qt-field" style={{ gap: 6 }}><span>Measured Pc (bar)</span><input type="number" value={+mPc.toFixed(1)} onChange={(e) => setMPc(Number(e.target.value))} /></label>
      </div>
      <table className="qt-proptable">
        <thead><tr><th>Quantity</th><th>Predicted</th><th>Measured</th><th>Error (±5%)</th></tr></thead>
        <tbody>
          {row("Thrust", predictedThrustN, mThrust, "N")}
          {row("Isp", predictedIsp, mIsp, "s")}
          {row("Chamber pressure", predictedPcBar, mPc, "bar")}
        </tbody>
      </table>
    </fieldset>
  );
}
