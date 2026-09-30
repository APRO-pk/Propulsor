import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { tradeBundle, type TradeBundleDto } from "./api";

const AXIS = { fill: "#6b7280", fontSize: 12 } as const;
const TT = { background: "#fff", border: "1px solid #b9bcc4", borderRadius: 4, fontSize: 12 } as const;

export function Trades() {
  const [t, setT] = useState<TradeBundleDto | null>(null);
  useEffect(() => {
    let live = true;
    tradeBundle().then((r) => live && setT(r)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!t) return <p className="muted">Running trade studies…</p>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <fieldset className="qt-groupbox">
          <legend>O/F sweep → vacuum Isp (optimum {t.optimal_of.toFixed(2)})</legend>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={t.of_sweep} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
              <XAxis dataKey="of" stroke="#6b7280" tick={AXIS} label={{ value: "O/F", position: "insideBottom", offset: -3, fill: "#6b7280" }} />
              <YAxis stroke="#6b7280" tick={AXIS} domain={["auto", "auto"]} label={{ value: "Isp vac (s)", angle: -90, position: "insideLeft", fill: "#6b7280" }} />
              <Tooltip contentStyle={TT} />
              <ReferenceLine x={t.optimal_of} stroke="#2f8f46" strokeDasharray="4 3" label={{ value: "opt", fill: "#2f8f46", fontSize: 11 }} />
              <Line type="monotone" dataKey="isp_vac_s" stroke="#3574e0" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>Expansion sweep → thrust coefficient (opt ε {t.optimal_area_ratio.toFixed(0)})</legend>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={t.expansion_sweep} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
              <XAxis dataKey="area_ratio" stroke="#6b7280" tick={AXIS} scale="log" domain={["auto", "auto"]} label={{ value: "area ratio ε", position: "insideBottom", offset: -3, fill: "#6b7280" }} />
              <YAxis stroke="#6b7280" tick={AXIS} label={{ value: "Cf", angle: -90, position: "insideLeft", fill: "#6b7280" }} />
              <Tooltip contentStyle={TT} />
              <ReferenceLine x={t.optimal_area_ratio} stroke="#2f8f46" strokeDasharray="4 3" />
              <Line type="monotone" dataKey="cf_vacuum" name="vacuum" stroke="#c23b34" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="cf_sea_level" name="sea level" stroke="#3574e0" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </fieldset>
      </div>

      <fieldset className="qt-groupbox">
        <legend>L* sweep → chamber length (recommended {t.recommended_l_star_m.toFixed(2)} m)</legend>
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={t.l_star_sweep.map((p) => ({ ...p, len_mm: p.chamber_length_m * 1000 }))} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#dcdce2" strokeDasharray="3 3" />
            <XAxis dataKey="l_star_m" stroke="#6b7280" tick={AXIS} label={{ value: "L* (m)", position: "insideBottom", offset: -3, fill: "#6b7280" }} />
            <YAxis stroke="#6b7280" tick={AXIS} label={{ value: "chamber length (mm)", angle: -90, position: "insideLeft", fill: "#6b7280" }} />
            <Tooltip contentStyle={TT} />
            <ReferenceLine x={t.recommended_l_star_m} stroke="#2f8f46" strokeDasharray="4 3" label={{ value: "rec", fill: "#2f8f46", fontSize: 11 }} />
            <Line type="monotone" dataKey="len_mm" stroke="#7a5bd0" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
            <thead><tr><th>Elements</th><th>v_inj</th><th>SMD</th><th>MR</th><th>Stable</th></tr></thead>
            <tbody>
              {t.injector_trade.map((r) => (
                <tr key={r.element_count}>
                  <td>{r.element_count}</td>
                  <td className="val">{r.injection_velocity_m_s.toFixed(1)} m/s</td>
                  <td className="val">{r.smd_um.toFixed(0)} µm</td>
                  <td className="val">{r.momentum_ratio.toFixed(2)}</td>
                  <td className="val"><span className={`qt-badge ${r.stable ? "solved" : "failed"}`}>{r.stable ? "OK" : "check"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      </div>
    </div>
  );
}
