import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { validationStudy, type SensorValidationDto, type SpatialSensorDto } from "./api";
import { useEngineStore } from "./store";
import { downloadText } from "./Cooling";

const AXIS = { fill: "#6b7280", fontSize: 11 } as const;
const TT = { background: "#fff", border: "1px solid #b9bcc4", borderRadius: 4, fontSize: 12 } as const;

type TransientRow = { t: number; thrust?: number; pc?: number };
type Imports = { sensors?: Map<string, number>; transient?: TransientRow[]; sensorMatched?: number; sensorTotal?: number };

function rms(xs: number[]): number {
  if (!xs.length) return 0;
  return Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length);
}

/** Parse a CSV into row objects keyed by lower-cased header. Ignores # comments. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

/** Linearly interpolate the imported transient at time t (s). */
function interpTransient(rows: TransientRow[], t: number): { thrust?: number; pc?: number } {
  if (!rows.length) return {};
  if (t <= rows[0].t) return { thrust: rows[0].thrust, pc: rows[0].pc };
  if (t >= rows[rows.length - 1].t) { const r = rows[rows.length - 1]; return { thrust: r.thrust, pc: r.pc }; }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / Math.max(b.t - a.t, 1e-9);
      const lerp = (x?: number, y?: number) => (x === undefined || y === undefined ? undefined : x + (y - x) * f);
      return { thrust: lerp(a.thrust, b.thrust), pc: lerp(a.pc, b.pc) };
    }
  }
  return {};
}

/** Merge imported telemetry onto the backend base study and recompute residuals. */
function mergeValidation(base: SensorValidationDto, imp: Imports): SensorValidationDto {
  let synthetic = base.synthetic_reference;
  let sensors = base.sensors;
  if (imp.sensors && imp.sensors.size) {
    synthetic = false;
    sensors = base.sensors.map((s) => {
      const m = imp.sensors!.get(s.id.toLowerCase());
      if (m === undefined) return s;
      const residual = s.predicted !== 0 ? ((m - s.predicted) / s.predicted) * 100 : 0;
      return { ...s, measured: m, residual_pct: residual };
    });
  }
  let time_series = base.time_series;
  let rmsThrust = base.rms_thrust_pct;
  if (imp.transient && imp.transient.length) {
    synthetic = false;
    time_series = base.time_series.map((sample) => {
      const m = interpTransient(imp.transient!, sample.t_s);
      return {
        ...sample,
        measured_thrust_n: m.thrust !== undefined ? m.thrust : sample.measured_thrust_n,
        measured_pc_pa: m.pc !== undefined ? m.pc : sample.measured_pc_pa,
      };
    });
    const res = time_series.filter((s) => s.predicted_thrust_n > 1).map((s) => ((s.measured_thrust_n - s.predicted_thrust_n) / s.predicted_thrust_n) * 100);
    rmsThrust = rms(res);
  }
  return { ...base, sensors, time_series, rms_spatial_pct: rms(sensors.map((s) => s.residual_pct)), rms_thrust_pct: rmsThrust, synthetic_reference: synthetic };
}

export function Validation() {
  const [base, setBase] = useState<SensorValidationDto | null>(null);
  const [imp, setImp] = useState<Imports>({});
  const sensorFileRef = useRef<HTMLInputElement>(null);
  const transientFileRef = useRef<HTMLInputElement>(null);
  const l2 = useEngineStore((s) => s.l2);
  useEffect(() => {
    let live = true;
    validationStudy().then((r) => live && setBase(r)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const v = useMemo(() => (base ? mergeValidation(base, imp) : null), [base, imp]);
  if (!v || !base) return <p className="muted">Placing sensors…</p>;

  const readFile = (file: File, kind: "sensor" | "transient") => {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result ?? ""));
      if (kind === "sensor") {
        const map = new Map<string, number>();
        for (const r of rows) {
          const id = (r.id ?? r.sensor ?? "").toLowerCase();
          const m = Number(r.measured ?? r.value ?? r.measured_si);
          if (id && !isNaN(m)) map.set(id, m);
        }
        setImp((p) => ({ ...p, sensors: map, sensorMatched: [...map.keys()].filter((k) => base.sensors.some((s) => s.id.toLowerCase() === k)).length, sensorTotal: base.sensors.length }));
      } else {
        const tr: TransientRow[] = rows
          .map((r) => {
            const t = r.t_s !== undefined && r.t_s !== "" ? Number(r.t_s) : Number(r.t_ms) / 1000;
            const thrust = r.measured_thrust_n !== undefined && r.measured_thrust_n !== "" ? Number(r.measured_thrust_n) : undefined;
            const pcRaw = r.measured_pc_pa ?? r.measured_pc_bar;
            const pc = pcRaw !== undefined && pcRaw !== "" ? Number(pcRaw) * (r.measured_pc_bar !== undefined ? 1e5 : 1) : undefined;
            return { t, thrust, pc };
          })
          .filter((r) => !isNaN(r.t))
          .sort((a, b) => a.t - b.t);
        setImp((p) => ({ ...p, transient: tr }));
      }
    };
    reader.readAsText(file);
  };

  const sensorTemplate = () =>
    "id,measured,predicted_ref,kind,unit\n" +
    "# fill 'measured' with test-stand data in SI units (Pa for pressure, K for wall_temp)\n" +
    base.sensors.map((s) => `${s.id},${s.predicted.toFixed(2)},${s.predicted.toFixed(2)},${s.kind},${s.unit}`).join("\n") + "\n";
  const transientTemplate = () =>
    "t_s,measured_thrust_n,measured_pc_pa,predicted_thrust_ref,predicted_pc_ref\n" +
    "# fill measured columns with logged telemetry; t in seconds\n" +
    base.time_series.map((s) => `${s.t_s.toFixed(3)},${s.predicted_thrust_n.toFixed(1)},${s.predicted_pc_pa.toFixed(0)},${s.predicted_thrust_n.toFixed(1)},${s.predicted_pc_pa.toFixed(0)}`).join("\n") + "\n";

  const imported = !v.synthetic_reference;
  const pressure = v.sensors.filter((s) => s.kind === "pressure").sort((a, b) => a.x_m - b.x_m);
  const temps = v.sensors.filter((s) => s.kind === "wall_temp").sort((a, b) => a.x_m - b.x_m);

  return (
    <div>
      <fieldset className="qt-groupbox">
        <legend>Sensor / position validation</legend>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div className="qt-field" style={{ minWidth: 200 }}><span>Spatial residual (RMS)</span><span className={`qt-badge ${v.rms_spatial_pct < 5 ? "solved" : "failed"}`}>{v.rms_spatial_pct.toFixed(2)}%</span></div>
          <div className="qt-field" style={{ minWidth: 200 }}><span>Startup thrust residual (RMS)</span><span className={`qt-badge ${v.rms_thrust_pct < 8 ? "solved" : "failed"}`}>{v.rms_thrust_pct.toFixed(2)}%</span></div>
          <div className="qt-field" style={{ minWidth: 180 }}><span>Ignition / rise</span><b>{(v.ignition_delay_s * 1000).toFixed(0)} / {(v.rise_time_s * 1000).toFixed(0)} ms</b></div>
          <div className="qt-field" style={{ minWidth: 160 }}><span>Data source</span><span className={`qt-badge ${imported ? "solved" : ""}`}>{imported ? "imported telemetry" : "synthetic reference"}</span></div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <input ref={sensorFileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0], "sensor")} />
          <input ref={transientFileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0], "transient")} />
          <button className="qt-tool" onClick={() => sensorFileRef.current?.click()}>Import sensor telemetry (CSV)</button>
          <button className="qt-tool" onClick={() => transientFileRef.current?.click()}>Import transient (CSV)</button>
          <button className="qt-tool" onClick={() => downloadText("sensor_template.csv", sensorTemplate())}>Sensor template</button>
          <button className="qt-tool" onClick={() => downloadText("transient_template.csv", transientTemplate())}>Transient template</button>
          {imported && <button className="qt-tool" onClick={() => setImp({})}>Clear imported data</button>}
        </div>
        {imp.sensors && imp.sensorTotal !== undefined && (
          <p className="qt-caption">Matched {imp.sensorMatched} of {imp.sensorTotal} sensors by id.{imp.transient ? ` Transient: ${imp.transient.length} samples.` : ""}</p>
        )}
        {v.synthetic_reference && <p className="qt-caption">Measured values are a synthetic test-stand reference (deterministic position/time bias). Import a CSV (match the template columns) to validate against real telemetry.</p>}
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
        <fieldset className="qt-groupbox">
          <legend>3D sensor positions</legend>
          <div className="viewer3d" style={{ height: 360, borderRadius: 5, overflow: "hidden" }}>
            <SensorViewer3D sensors={v.sensors} stations={l2?.stations ?? []} />
          </div>
          <p className="qt-caption">Blue = pressure taps, red = wall thermocouples. Marker size grows with the predicted-vs-measured residual.</p>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>Chamber &amp; nozzle pressure — predicted vs measured</legend>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={pressure.map((s) => ({ x: s.x_m * 1000, predicted: s.predicted / 1e5, measured: s.measured / 1e5 }))} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" stroke="#6b7280" tick={AXIS} label={{ value: "axial x (mm)", position: "insideBottom", offset: -3, fill: "#6b7280" }} />
              <YAxis stroke="#6b7280" tick={AXIS} label={{ value: "p (bar)", angle: -90, position: "insideLeft", fill: "#6b7280" }} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="predicted" stroke="#3574e0" dot strokeWidth={2} />
              <Line dataKey="measured" stroke="#c23b34" strokeDasharray="5 3" dot strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={temps.map((s) => ({ x: s.x_m * 1000, predicted: s.predicted, measured: s.measured }))} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" stroke="#6b7280" tick={AXIS} label={{ value: "axial x (mm)", position: "insideBottom", offset: -3, fill: "#6b7280" }} />
              <YAxis stroke="#6b7280" tick={AXIS} label={{ value: "T_wall (K)", angle: -90, position: "insideLeft", fill: "#6b7280" }} />
              <Tooltip contentStyle={TT} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="predicted" stroke="#c47b12" dot strokeWidth={2} />
              <Line dataKey="measured" stroke="#7a5bd0" strokeDasharray="5 3" dot strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </fieldset>
      </div>

      <fieldset className="qt-groupbox">
        <legend>Startup transient — thrust &amp; chamber pressure vs time</legend>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={v.time_series.map((t) => ({ t: t.t_s * 1000, predF: t.predicted_thrust_n / 1000, measF: t.measured_thrust_n / 1000, predP: t.predicted_pc_pa / 1e5, measP: t.measured_pc_pa / 1e5 }))} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
            <XAxis type="number" dataKey="t" stroke="#6b7280" tick={AXIS} label={{ value: "time (ms)", position: "insideBottom", offset: -3, fill: "#6b7280" }} />
            <YAxis yAxisId="F" stroke="#6b7280" tick={AXIS} label={{ value: "thrust (kN)", angle: -90, position: "insideLeft", fill: "#6b7280" }} />
            <YAxis yAxisId="P" orientation="right" stroke="#6b7280" tick={AXIS} label={{ value: "Pc (bar)", angle: 90, position: "insideRight", fill: "#6b7280" }} />
            <Tooltip contentStyle={TT} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="F" name="thrust predicted" dataKey="predF" stroke="#3574e0" dot={false} strokeWidth={2} />
            <Line yAxisId="F" name="thrust measured" dataKey="measF" stroke="#c23b34" strokeDasharray="5 3" dot={false} strokeWidth={2} />
            <Line yAxisId="P" name="Pc predicted" dataKey="predP" stroke="#2f8f46" dot={false} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </fieldset>

      <fieldset className="qt-groupbox">
        <legend>Sensor residuals</legend>
        <table className="qt-proptable">
          <thead><tr><th>Sensor</th><th>Type</th><th>x (mm)</th><th>Predicted</th><th>Measured</th><th>Residual</th></tr></thead>
          <tbody>
            {v.sensors.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td>{s.kind}</td>
                <td className="val">{(s.x_m * 1000).toFixed(0)}</td>
                <td className="val">{fmt(s.predicted, s.unit)}</td>
                <td className="val">{fmt(s.measured, s.unit)}</td>
                <td className="val" style={{ color: Math.abs(s.residual_pct) > 4 ? "#c23b34" : "#2f8f46" }}>{s.residual_pct >= 0 ? "+" : ""}{s.residual_pct.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="qt-tool" style={{ marginTop: 8 }} onClick={() => downloadText("sensor_validation.csv", "id,kind,x_m,r_m,predicted,measured,unit,residual_pct\n" + v.sensors.map((s) => `${s.id},${s.kind},${s.x_m.toFixed(5)},${s.r_m.toFixed(5)},${s.predicted.toFixed(4)},${s.measured.toFixed(4)},${s.unit},${s.residual_pct.toFixed(3)}`).join("\n") + "\n")}>Export sensor residuals CSV</button>
      </fieldset>
    </div>
  );
}

function fmt(v: number, unit: string): string {
  if (unit === "Pa") return `${(v / 1e5).toFixed(2)} bar`;
  if (unit === "K") return `${v.toFixed(0)} K`;
  return `${v.toFixed(1)} ${unit}`;
}

/** Nozzle silhouette (from L2 stations) with sensor-position markers. */
function SensorViewer3D({ sensors, stations }: { sensors: SpatialSensorDto[]; stations: { x: number; r: number }[] }) {
  const geo = useMemo(() => {
    const pts = stations.length >= 2 ? [...stations].sort((a, b) => a.x - b.x) : sensors.map((s) => ({ x: s.x_m, r: Math.max(s.r_m, 1e-3) }));
    const v = pts.map((p) => new THREE.Vector2(Math.max(p.r, 1e-4), p.x));
    const g = new THREE.LatheGeometry(v, 60);
    g.computeVertexNormals();
    return g;
  }, [stations, sensors]);

  const xs = sensors.map((s) => s.x_m);
  const span = (Math.max(...xs) - Math.min(...xs)) || 0.3;
  const cam = span * 2.0;
  const maxRes = Math.max(...sensors.map((s) => Math.abs(s.residual_pct)), 1);

  return (
    <Canvas dpr={[1, 2]} camera={{ position: [cam * 0.7, cam * 0.5, cam], fov: 42, near: 0.001, far: 100 }}>
      <color attach="background" args={["#3b4046"]} />
      <hemisphereLight args={["#ffffff", "#33383e", 1.0]} />
      <directionalLight position={[cam, cam * 1.4, cam]} intensity={2.0} />
      {/* Lathe revolves around Y; rotate so the engine axis lies along world x. */}
      <group rotation={[0, 0, Math.PI / 2]}>
        <mesh geometry={geo}>
          <meshStandardMaterial color="#aeb4bd" metalness={0.5} roughness={0.5} side={THREE.DoubleSide} transparent opacity={0.55} />
        </mesh>
        {sensors.map((s) => {
          const size = span * 0.02 * (1 + 1.5 * (Math.abs(s.residual_pct) / maxRes));
          const color = s.kind === "pressure" ? "#3574e0" : "#c23b34";
          return (
            <mesh key={s.id} position={[Math.max(s.r_m, 1e-3), s.x_m, 0]}>
              <sphereGeometry args={[size, 16, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
            </mesh>
          );
        })}
      </group>
      <OrbitControls enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}
