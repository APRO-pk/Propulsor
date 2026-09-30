import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { bladeStudy, type BladeProfileDto, type BladeStudyDto, type LossBreakdownDto } from "./api";
import { useEngineStore } from "./store";
import { ParamField, ParamChoice, ResetParams } from "./ParamInput";

const AXIS = { fill: "#6b7280", fontSize: 11 } as const;
const TT = { background: "#fff", border: "1px solid #b9bcc4", borderRadius: 4, fontSize: 12 } as const;

export function Blades() {
  const [speed, setSpeed] = useState(20000);
  const [study, setStudy] = useState<BladeStudyDto | null>(null);
  const [mode, setMode] = useState<"pump" | "turbine" | "supersonic">("pump");
  const rev = useEngineStore((s) => s.design?.meta.revision);

  useEffect(() => {
    let live = true;
    bladeStudy(speed).then((s) => live && setStudy(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [speed, rev]);

  if (!study) return <p className="muted">Profiling blades…</p>;
  const blade = mode === "pump" ? study.pump_blade : mode === "supersonic" ? study.supersonic_blade : study.turbine_blade;
  const isSupersonic = mode === "supersonic";

  return (
    <div>
      <fieldset className="qt-groupbox">
        <legend>Rotor</legend>
        <div className="qt-field">
          <span>Component</span>
          <span>
            <button className={`qt-tool ${mode === "pump" ? "on" : ""}`} onClick={() => setMode("pump")}>Pump impeller</button>
            <button className={`qt-tool ${mode === "turbine" ? "on" : ""}`} style={{ marginLeft: 6 }} onClick={() => setMode("turbine")}>Turbine rotor</button>
            <button className={`qt-tool ${mode === "supersonic" ? "on" : ""}`} style={{ marginLeft: 6 }} onClick={() => setMode("supersonic")}>Supersonic turbine</button>
          </span>
        </div>
        <label className="qt-field"><span>Shaft speed (rpm)</span><input type="number" step={1000} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></label>
        <p className="muted">{blade.summary}</p>
      </fieldset>

      <fieldset className="qt-groupbox">
        <legend>
          Design inputs — {mode === "pump" ? "pump impeller" : mode === "supersonic" ? "supersonic turbine" : "turbine rotor"}
          <span style={{ float: "right" }}><ResetParams prefix="blade." /></span>
        </legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          {mode === "pump" && <>
            <ParamField label="Blade count Z" k="blade.pump_blade_count" def={6} step={1} hint="number of impeller blades (Wiesner slip factor)" />
            <ParamField label="Outlet blade angle β₂" k="blade.pump_outlet_angle_deg" def={22.5} step={0.5} unit="°" hint="backswept angle from tangent (20–35° typical)" />
            <ParamField label="Inlet axial velocity" k="blade.pump_inlet_axial_vel" def={10} step={0.5} unit="m/s" />
            <ParamField label="Pump efficiency" k="blade.pump_efficiency" def={0.7} step={0.01} hint="hydraulic efficiency (0.3–0.95)" />
            <ParamChoice label="Impeller material" k="blade.impeller_material" def="Inconel 718" options={["Inconel 718", "Titanium", "Aluminum", "Steel"]} hint="sets the tip-speed structural limit" />
            <ParamField label="Inducer hub ratio" k="blade.inducer_hub_ratio" def={0.4} step={0.02} />
          </>}
          {mode === "turbine" && <>
            <ParamField label="Blade count Z" k="blade.turbine_blade_count" def={40} step={1} />
            <ParamField label="Nozzle angle α" k="blade.nozzle_angle_deg" def={20} step={0.5} unit="°" hint="absolute flow angle from tangent (15–25°)" />
            <ParamField label="Drive-gas cp" k="blade.turbine_cp" def={2000} step={50} unit="J/kg·K" />
            <ParamField label="Drive-gas Tin" k="blade.turbine_inlet_temp_k" def={950} step={25} unit="K" />
            <ParamField label="Drive-gas γ" k="blade.turbine_gamma" def={1.3} step={0.01} />
            <ParamField label="Pressure ratio (0=auto)" k="blade.turbine_pressure_ratio" def={0} step={0.5} hint="0 → from Pc; impulse range 8–20" />
            <ParamField label="GG flow fraction" k="blade.gg_flow_fraction" def={0.03} step={0.005} hint="turbine drive flow / total flow" />
          </>}
          {mode === "supersonic" && <>
            <ParamField label="Blade count Z" k="blade.supersonic_blade_count" def={50} step={1} />
            <ParamField label="Nozzle angle α" k="blade.nozzle_angle_deg" def={20} step={0.5} unit="°" />
            <ParamField label="Drive-gas cp" k="blade.turbine_cp" def={2000} step={50} unit="J/kg·K" />
            <ParamField label="Drive-gas Tin" k="blade.turbine_inlet_temp_k" def={950} step={25} unit="K" />
            <ParamField label="Drive-gas γ" k="blade.turbine_gamma" def={1.3} step={0.01} />
          </>}
          <ParamField label="Tip clearance ratio" k="blade.clearance_ratio" def={0.02} step={0.005} hint="clearance / span (loss model)" />
          {mode !== "pump" && <ParamField label="Blade aspect ratio" k="blade.aspect_ratio" def={2.0} step={0.1} />}
          {mode !== "pump" && <ParamField label="Velocity ratio U/C₀" k="blade.velocity_ratio" def={0.47} step={0.01} />}
        </div>
        {mode === "pump" && (
          <div className="qt-field" style={{ marginTop: 6 }}>
            <span>Impeller tip speed U₂</span>
            <span className={`qt-badge ${blade.kind === "pump-impeller" && study.pump_tip_speed_m_s > study.pump_tip_speed_limit_m_s ? "failed" : "solved"}`}>
              {study.pump_tip_speed_m_s.toFixed(0)} / {study.pump_tip_speed_limit_m_s.toFixed(0)} m/s limit
            </span>
          </div>
        )}
        {(mode === "turbine" || mode === "supersonic") && (
          <>
            <div className="qt-field" style={{ marginTop: 6 }}><span>Turbine relative inlet Mach</span><b>{study.turbine_inlet_mach.toFixed(2)}</b></div>
            <div className="qt-field"><span>Recommended type (U/C₀, SP-8107)</span><b>{study.recommended_turbine_type}</b></div>
          </>
        )}
        {study.warnings.map((w, i) => <p key={i} className="err">⚠ {w}</p>)}
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
        <fieldset className="qt-groupbox">
          <legend>3D {mode === "pump" ? "impeller" : isSupersonic ? "supersonic rotor" : "rotor"} ({blade.blade_count} blades)</legend>
          <div className="viewer3d" style={{ height: 440, borderRadius: 5, overflow: "hidden" }}>
            <BladeViewer3D blade={blade} />
          </div>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>{isSupersonic ? "Supersonic profile (circular-arc / fixed-edge / MoC)" : "Blade profile & velocity triangle"}</legend>
          <BladeSvg blade={blade} />
          <table className="qt-proptable" style={{ marginTop: 8 }}>
            <tbody>
              <tr><td>{isSupersonic ? "Inlet flow angle (from axial)" : "Inlet metal angle β₁"}</td><td className="val">{blade.inlet_angle_deg.toFixed(1)}°</td></tr>
              <tr><td>{isSupersonic ? "Exit flow angle (from axial)" : "Outlet metal angle β₂"}</td><td className="val">{blade.outlet_angle_deg.toFixed(1)}°</td></tr>
              <tr><td>Inlet / outlet radius</td><td className="val">{(blade.inlet_radius_m * 1000).toFixed(1)} / {(blade.outlet_radius_m * 1000).toFixed(1)} mm</td></tr>
              {mode === "pump" && <tr><td>Slip factor σ</td><td className="val">{blade.slip_factor.toFixed(3)}</td></tr>}
              {isSupersonic && <tr><td>Relative Mach M₁ / M₂</td><td className="val">{(blade.inlet_mach ?? 0).toFixed(2)} / {(blade.exit_mach ?? 0).toFixed(2)}</td></tr>}
              {isSupersonic && <tr><td>Mach angle μ = asin(1/M)</td><td className="val">{(blade.mach_angle_deg ?? 0).toFixed(1)}°</td></tr>}
              {isSupersonic && <tr><td>Prandtl-Meyer turn Δν</td><td className="val">{(blade.prandtl_meyer_turn_deg ?? 0).toFixed(1)}°</td></tr>}
              {isSupersonic && <tr><td>Throat / pitch o/s (gauge)</td><td className="val">{(blade.throat_pitch_ratio ?? 0).toFixed(2)}</td></tr>}
              <tr><td>Blade count Z</td><td className="val">{blade.blade_count}</td></tr>
            </tbody>
          </table>
          {isSupersonic && (
            <p className="qt-caption" style={{ marginTop: 6 }}>
              Concave surface: straight fixed inlet edge → constant-curvature circular arc → straight fixed exit edge.
              Suction side is the shock-free method-of-characteristics transition; a pure-impulse blade turns at constant
              Mach (Δν ≈ 0), so any exit-Mach excess is the expansion the MoC arc must deliver.
            </p>
          )}
        </fieldset>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <LossBars title="Pump meanline losses" loss={study.pump_losses} />
        <LossBars title="Turbine meanline losses" loss={study.turbine_losses} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <fieldset className="qt-groupbox">
          <legend>Pump characteristic — head vs flow (affinity)</legend>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
              <XAxis type="number" dataKey="q" stroke="#6b7280" tick={AXIS} label={{ value: "flow (L/s)", position: "insideBottom", offset: -3, fill: "#6b7280" }} />
              <YAxis stroke="#6b7280" tick={AXIS} label={{ value: "head (m)", angle: -90, position: "insideLeft", fill: "#6b7280" }} />
              <Tooltip contentStyle={TT} />
              {study.pump_map.speed_curves.map((c, i) => (
                <Line key={c.speed_fraction} data={c.points.map((p) => ({ q: p.flow_m3_s * 1000, h: p.head_m }))} dataKey="h" name={`${(c.speed_fraction * 100).toFixed(0)}% N`} stroke={["#9db4d0", "#5f8fd0", "#3574e0", "#1b3f7a"][i]} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>Turbine efficiency vs U/C₀ (opt {study.turbine_map.optimum_velocity_ratio.toFixed(2)})</legend>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={study.turbine_map.points} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
              <XAxis dataKey="velocity_ratio" stroke="#6b7280" tick={AXIS} tickFormatter={(v) => v.toFixed(1)} label={{ value: "U / C₀", position: "insideBottom", offset: -3, fill: "#6b7280" }} />
              <YAxis stroke="#6b7280" tick={AXIS} domain={[0, 1]} label={{ value: "η", angle: -90, position: "insideLeft", fill: "#6b7280" }} />
              <Tooltip contentStyle={TT} />
              <ReferenceLine x={study.turbine_map.optimum_velocity_ratio} stroke="#2f8f46" strokeDasharray="4 3" />
              <Line dataKey="efficiency" stroke="#c23b34" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </fieldset>
      </div>
    </div>
  );
}

function LossBars({ title, loss }: { title: string; loss: LossBreakdownDto }) {
  const colors = ["#3574e0", "#c47b12", "#2f8f46", "#c23b34", "#7a5bd0"];
  const max = Math.max(...loss.items.map((i) => i.fraction), 0.01);
  return (
    <fieldset className="qt-groupbox">
      <legend>{title}</legend>
      <div className="qt-field"><span>Stage efficiency</span><span className="qt-badge solved">η = {(loss.efficiency * 100).toFixed(1)}%</span></div>
      {loss.items.map((it, i) => (
        <div key={it.name} style={{ margin: "6px 0" }}>
          <div className="qt-caption" style={{ display: "flex", justifyContent: "space-between", margin: 0 }}>
            <span>{it.name}</span><span>{(it.fraction * 100).toFixed(1)}%</span>
          </div>
          <div style={{ height: 8, background: "#eceef1", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${(it.fraction / max) * 100}%`, height: "100%", background: colors[i % colors.length] }} />
          </div>
        </div>
      ))}
    </fieldset>
  );
}

/** 2D blade profile: patterned impeller (top view) or a single turbine airfoil. */
function BladeSvg({ blade }: { blade: BladeProfileDto }) {
  const isPump = blade.kind === "pump-impeller";
  const blades: string[] = [];
  const toPath = (pts: { x: number; y: number }[], rot: number) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return pts.map((p, i) => `${i ? "L" : "M"} ${(p.x * c - p.y * s).toFixed(5)} ${(p.x * s + p.y * c).toFixed(5)}`).join(" ") + " Z";
  };
  if (isPump) {
    for (let k = 0; k < blade.blade_count; k++) blades.push(toPath(blade.surface, (2 * Math.PI * k) / blade.blade_count));
  } else {
    blades.push(toPath(blade.surface, 0));
  }
  const all = isPump
    ? Array.from({ length: blade.blade_count }, (_, k) => blade.surface.map((p) => rot(p, (2 * Math.PI * k) / blade.blade_count))).flat()
    : blade.surface;
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const pad = 0.1 * Math.max(...xs.map(Math.abs), ...ys.map(Math.abs), 1e-3);
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const vb = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  const sw = (maxX - minX) / 260;

  return (
    <svg viewBox={vb} width="100%" height={200} style={{ background: "#fafbfc", border: "1px solid var(--qt-border)", borderRadius: 4 }} preserveAspectRatio="xMidYMid meet">
      {isPump && <circle cx={0} cy={0} r={blade.inlet_radius_m * 0.9} fill="#e6eefb" stroke="#3574e0" strokeWidth={sw} />}
      {blades.map((d, i) => (
        <path key={i} d={d} fill={isPump ? "#c7d6ee" : "#dfe6ef"} stroke="#2a4d80" strokeWidth={sw} />
      ))}
    </svg>
  );
}

function rot(p: { x: number; y: number }, a: number) {
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

/** 3D impeller/rotor: one blade mesh per blade, patterned Z times around the shaft. */
function BladeViewer3D({ blade }: { blade: BladeProfileDto }) {
  const isPump = blade.kind === "pump-impeller";
  const rMean = (blade.inlet_radius_m + blade.outlet_radius_m) / 2;
  // Display span (blade height): exaggerate so it reads in 3D. For the turbine
  // the blades occupy a prominent outer band (~32% of the radius).
  const vizSpan = isPump ? Math.max(blade.span_m, blade.outlet_radius_m * 0.2) : rMean * 0.32;
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    blade.surface.forEach((p, i) => (i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: vizSpan, bevelEnabled: false });
    g.computeVertexNormals();
    return g;
  }, [blade, vizSpan]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#cdd2da", metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }), []);

  const chord = Math.max(...blade.camber.map((p) => p.x)) - Math.min(...blade.camber.map((p) => p.x));
  const cam = (isPump ? blade.outlet_radius_m : rMean * 1.1) * 3.0;
  const Z = blade.blade_count;
  const angles = Array.from({ length: Z }, (_, k) => (2 * Math.PI * k) / Z);

  return (
    <Canvas key={blade.kind} dpr={[1, 2]} camera={{ position: [cam * 0.8, cam * 0.7, cam], fov: 42, near: 0.0005, far: 100 }}>
      <color attach="background" args={["#3b4046"]} />
      <hemisphereLight args={["#ffffff", "#33383e", 1.0]} />
      <directionalLight position={[cam, cam * 1.4, cam]} intensity={2.2} />
      <directionalLight position={[-cam, cam * 0.4, -cam]} intensity={0.6} color="#a9c0dd" />
      <group rotation={isPump ? [-Math.PI / 3.2, 0, 0] : [-Math.PI / 7, 0, 0]}>
        {angles.map((phi, k) =>
          isPump ? (
            // Impeller blade lies in the r–θ plane, extruded axially; spun about the axis.
            <mesh key={k} geometry={geo} material={mat} rotation={[0, 0, phi]} />
          ) : (
            // Turbine airfoil: rotate extrude(+z)→radial(+x), then spin to azimuth φ.
            <group key={k} rotation={[0, 0, phi]}>
              <mesh geometry={geo} material={mat} position={[rMean - vizSpan, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
            </group>
          ),
        )}
        {isPump ? (
          <>
            <mesh position={[0, 0, -vizSpan * 0.15]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[blade.outlet_radius_m, blade.outlet_radius_m, vizSpan * 0.3, 56]} />
              <meshStandardMaterial color="#9aa2af" metalness={0.6} roughness={0.45} />
            </mesh>
            <mesh position={[0, 0, vizSpan * 0.55]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[blade.inlet_radius_m * 1.1, blade.inlet_radius_m * 1.3, vizSpan * 1.4, 40]} />
              <meshStandardMaterial color="#8f97a4" metalness={0.6} roughness={0.45} />
            </mesh>
          </>
        ) : (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[rMean - vizSpan, rMean - vizSpan, chord * 0.6, 64]} />
            <meshStandardMaterial color="#9aa2af" metalness={0.65} roughness={0.42} />
          </mesh>
        )}
      </group>
      <OrbitControls enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}
