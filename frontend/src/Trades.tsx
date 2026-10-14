import { useEffect, useState } from "react";
import { useSharedState } from "./sharedState";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tradeBundle, sweep, type TradeBundleDto, type SweepResultDto } from "./api";
import { useEngineStore } from "./store";

const AXIS = { fill: "var(--ink-3)", fontSize: 12 } as const;
const TT = { background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: 4, fontSize: 12 } as const;
const CUR = "var(--ink)"; // current design: a plain solid marker
const REF = "var(--ink-3)"; // optimum / recommendation: a quiet dashed reference

export function Trades() {
  const [t, setT] = useState<TradeBundleDto | null>(null);
  const design = useEngineStore((s) => s.design);
  const l2 = useEngineStore((s) => s.l2);
  const rev = design?.meta.revision;
  useEffect(() => {
    let live = true;
    tradeBundle().then((r) => live && setT(r)).catch(() => {});
    return () => {
      live = false;
    };
  }, [rev]);

  // Current design's position on each sweep, to mark alongside the optimum.
  const curOf = design?.operating_point.mixture_ratio ?? 0;
  const curEps = l2?.area_ratio ?? 0;
  const curLStar = design?.geometry?.chamber?.l_star_m ?? 0;
  const curPcBar = (design?.operating_point.chamber_pressure ?? 6e6) / 1e5;

  const [sw, setSw] = useState<SweepResultDto | null>(null);
  const [metric, setMetric] = useSharedState<"isp" | "cstar" | "tc">("trades.metric", "isp");
  const [range, setRange] = useSharedState("trades.range", () => ({
    pcMin: Math.max(5, Math.round(curPcBar * 0.5)),
    pcMax: Math.max(10, Math.round(curPcBar * 1.5)),
    pcSteps: 5, ofMin: 2, ofMax: 4, ofSteps: 5,
  }));
  const runSweep = () => sweep(range.pcMin, range.pcMax, range.pcSteps, range.ofMin, range.ofMax, range.ofSteps).then(setSw).catch(() => {});

  if (!t) return <p className="muted">Running trade studies…</p>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 12 }}>
        <fieldset className="qt-groupbox">
          <legend>O/F sweep → vacuum Isp (optimum {t.optimal_of.toFixed(2)})</legend>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={t.of_sweep} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="of" stroke="var(--ink-3)" tick={AXIS} label={{ value: "O/F", position: "insideBottom", offset: -3, fill: "var(--ink-3)" }} />
              <YAxis stroke="var(--ink-3)" tick={AXIS} domain={["auto", "auto"]} label={{ value: "Isp vac (s)", angle: -90, position: "insideLeft", fill: "var(--ink-3)" }} />
              <Tooltip contentStyle={TT} />
              <ReferenceLine x={t.optimal_of} stroke={REF} strokeDasharray="4 3" label={{ value: "opt", fill: REF, fontSize: 11 }} />
              {curOf > 0 && <ReferenceLine x={+curOf.toFixed(2)} stroke={CUR} label={{ value: "current", fill: CUR, fontSize: 11 }} />}
              <Line type="monotone" dataKey="isp_vac_s" stroke="var(--cyan)" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>Expansion sweep → thrust coefficient (opt ε {t.optimal_area_ratio.toFixed(0)})</legend>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={t.expansion_sweep.map((p) => ({ ...p, cf_sea_level: Math.max(0, p.cf_sea_level) }))} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis dataKey="area_ratio" stroke="var(--ink-3)" tick={AXIS} scale="log" domain={["auto", "auto"]} label={{ value: "area ratio ε", position: "insideBottom", offset: -3, fill: "var(--ink-3)" }} />
              <YAxis stroke="var(--ink-3)" tick={AXIS} domain={[0, "auto"]} label={{ value: "Cf", angle: -90, position: "insideLeft", fill: "var(--ink-3)" }} />
              <Tooltip contentStyle={TT} />
              <ReferenceLine x={t.optimal_area_ratio} stroke={REF} strokeDasharray="4 3" label={{ value: "traj. opt", fill: REF, fontSize: 11 }} />
              {curEps > 0 && <ReferenceLine x={+curEps.toFixed(1)} stroke={CUR} label={{ value: "current", fill: CUR, fontSize: 11 }} />}
              <Line type="monotone" dataKey="cf_vacuum" name="vacuum" stroke="var(--violet)" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="cf_sea_level" name="sea level" stroke="var(--cyan)" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
          <p className="qt-caption">Sea-level Cf is floored at 0: a real over-expanded nozzle flow-separates rather than producing negative thrust. "traj. opt" is the trajectory-averaged optimum, not the sea-level peak.</p>
        </fieldset>
      </div>

      <fieldset className="qt-groupbox">
        <legend>L* sweep → chamber length (recommended {t.recommended_l_star_m.toFixed(2)} m)</legend>
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={t.l_star_sweep.map((p) => ({ ...p, len_mm: p.chamber_length_m * 1000 }))} margin={{ top: 6, right: 14, bottom: 4, left: 18 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
            <XAxis dataKey="l_star_m" stroke="var(--ink-3)" tick={AXIS} label={{ value: "L* (m)", position: "insideBottom", offset: -3, fill: "var(--ink-3)" }} />
            <YAxis stroke="var(--ink-3)" tick={AXIS} width={70} label={{ value: "chamber L (mm)", angle: -90, position: "insideLeft", fill: "var(--ink-3)" }} />
            <Tooltip contentStyle={TT} />
            <ReferenceLine x={t.recommended_l_star_m} stroke={REF} strokeDasharray="4 3" label={{ value: "rec", fill: REF, fontSize: 11 }} />
            {curLStar > 0 && <ReferenceLine x={+curLStar.toFixed(2)} stroke={CUR} label={{ value: "current", fill: CUR, fontSize: 11 }} />}
            <Line type="monotone" dataKey="len_mm" stroke="var(--violet)" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 12 }}>
        <fieldset className="qt-groupbox">
          <legend>Material trade-off</legend>
          <table className="qt-proptable">
            <thead><tr><th>Material</th><th>T_wall</th><th>Margin</th><th>ρ</th><th>Class</th></tr></thead>
            <tbody>
              {t.material_trade.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td className="val">{m.max_wall_temp_k.toFixed(0)} K</td>
                  <td className="val"><span className={`qt-badge ${m.ok ? "solved" : "failed"}`}>{m.margin_k.toFixed(0)} K</span></td>
                  <td className="val">{m.density_kg_m3.toFixed(0)}</td>
                  <td>{m.cooling_class}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>Injector trade-off (element count)</legend>
          <table className="qt-proptable">
            <thead><tr><th>Elements</th><th>v_inj</th><th title="mass-median drop diameter (Priem–Heidmann)">MMD</th><th>MR</th><th>Stable</th></tr></thead>
            <tbody>
              {t.injector_trade.map((r) => (
                <tr key={r.element_count}>
                  <td>{r.element_count}</td>
                  <td className="val">{r.injection_velocity_m_s.toFixed(1)} m/s</td>
                  <td className="val">{r.mmd_um.toFixed(0)} µm</td>
                  <td className="val">{r.momentum_ratio.toFixed(2)}</td>
                  <td className="val"><span className={`qt-badge ${r.stable ? "solved" : "failed"}`}>{r.stable ? "OK" : "check"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      </div>

      <fieldset className="qt-groupbox">
        <legend>Parametric sweep (Pc × O/F) — CEA-style</legend>
        {([["Pc min (bar)", "pcMin"], ["Pc max (bar)", "pcMax"], ["Pc steps", "pcSteps"], ["O/F min", "ofMin"], ["O/F max", "ofMax"], ["O/F steps", "ofSteps"]] as const).map(([lbl, key]) => (
          <label key={key} className="qt-field">
            <span>{lbl}</span>
            <input type="number" value={range[key]} onChange={(e) => setRange((r) => ({ ...r, [key]: Number(e.target.value) }))} />
          </label>
        ))}
        <div className="qt-field">
          <span>Tabulate</span>
          <span className="seg" role="group" aria-label="Value to tabulate">
            {([["isp", "Isp vac"], ["cstar", "c*"], ["tc", "Tc"]] as const).map(([m, lbl]) => (
              <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>{m === "tc" ? <>T<sub>c</sub></> : lbl}</button>
            ))}
          </span>
        </div>
        <div className="qt-actions">
          <button className="qt-tool" onClick={runSweep}>Run sweep</button>
        </div>
        {sw ? (
          <table className="qt-proptable">
            <thead>
              <tr>
                <th>O/F ╲ Pc (bar)</th>
                {sw.pc_values_bar.map((p) => <th key={p} className="val">{p.toFixed(0)}</th>)}
              </tr>
            </thead>
            <tbody>
              {sw.of_values.map((of) => (
                <tr key={of}>
                  <td className="val">{of.toFixed(2)}</td>
                  {sw.pc_values_bar.map((pc) => {
                    const pt = sw.points.find((q) => Math.abs(q.pc_bar - pc) < 0.5 && Math.abs(q.of - of) < 0.05);
                    const v = !pt ? "—" : metric === "isp" ? pt.isp_vac_s.toFixed(1) : metric === "cstar" ? pt.c_star_m_s.toFixed(0) : pt.tc_k.toFixed(0);
                    return <td key={pc} className="val">{v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Set the Pc and O/F ranges and click "Run sweep" to tabulate equilibrium Isp / c* / T<sub>c</sub> across the grid (steps capped at 9 each).</p>
        )}
        <p className="qt-caption" style={{ marginTop: 4 }}>Isp is the vacuum ideal-max (Γ-limit) from the equilibrium solve; rows = O/F, columns = chamber pressure (bar).</p>
      </fieldset>
    </div>
  );
}
