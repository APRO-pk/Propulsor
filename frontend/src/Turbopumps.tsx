import { useEffect, useState } from "react";
import { turbopumpStudy, type TurbopumpStudyDto } from "./api";
import { useEngineStore } from "./store";
import { ParamField, ResetParams } from "./ParamInput";

function Badge({ ok, good, bad }: { ok: boolean; good: string; bad: string }) {
  return <span className={`qt-badge ${ok ? "solved" : "failed"}`}>{ok ? good : bad}</span>;
}

/** Power with adaptive units: W below 1 kW, kW otherwise (3 sig figs when small). */
function power(w: number): string {
  if (w < 1000) return `${w.toFixed(0)} W`;
  if (w < 1e4) return `${(w / 1000).toFixed(2)} kW`;
  return `${(w / 1000).toFixed(0)} kW`;
}

export function Turbopumps() {
  const design = useEngineStore((s) => s.design);
  const rev = design?.meta.revision;
  // Shaft speed is a shared design param (also edited on the Blades tab).
  const rpm = design?.params?.["turbo.shaft_speed_rpm"] ?? 20000;
  const ggInput = design?.params?.["turbo.gg_flow_fraction"] ?? 0.03;
  const [study, setStudy] = useState<TurbopumpStudyDto | null>(null);

  useEffect(() => {
    let live = true;
    turbopumpStudy(rpm).then((s) => live && setStudy(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [rpm, rev]);

  if (!study) return <p className="muted">Sizing turbomachinery…</p>;
  const { pump, turbine, inducer, shaft, bearing, gg_cycle } = study;

  return (
    <div>
      <fieldset className="qt-groupbox">
        <legend>Shaft</legend>
        <ParamField label="Shaft speed" k="turbo.shaft_speed_rpm" def={20000} step={500} unit="rpm" hint="shared with the Blades tab" />
      </fieldset>

      <fieldset className="qt-groupbox">
        <legend>Design inputs<span style={{ float: "right" }}><ResetParams prefix="turbo." /></span></legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 16px" }}>
          <ParamField label="Pump efficiency" k="turbo.pump_efficiency" def={0.7} step={0.01} />
          <ParamField label="Suction spec. speed Nss" k="turbo.suction_specific_speed" def={500} step={50} hint="cavitation/inducer suction performance" />
          <ParamField label="Inducer hub ratio" k="turbo.inducer_hub_ratio" def={0.4} step={0.02} />
          <ParamField label="Tank pressure" k="turbo.tank_pressure_bar" def={3.0} step={0.5} dim="pressure" baseUnit="bar" />
          <ParamField label="Discharge factor ×Pc" k="turbo.discharge_pressure_factor" def={1.25} step={0.05} />
          <ParamField label="GG flow fraction" k="turbo.gg_flow_fraction" def={0.03} step={0.005} />
          <ParamField label="Turbine efficiency" k="turbo.turbine_efficiency" def={0.65} step={0.01} />
          <ParamField label="Turbine cp" k="turbo.turbine_cp" def={2000} step={50} unit="J/kg·K" />
          <ParamField label="Turbine γ" k="turbo.turbine_gamma" def={1.3} step={0.01} />
          <ParamField label="Turbine Tin" k="turbo.turbine_inlet_temp_k" def={950} step={25} dim="temperature" baseUnit="K" />
          <ParamField label="Turbine exit pressure" k="turbo.turbine_exit_pressure_bar" def={3.0} step={0.5} dim="pressure" baseUnit="bar" />
          <ParamField label="Bearing bore" k="turbo.bearing_bore_mm" def={45} step={1} dim="length" baseUnit="mm" />
          <ParamField label="Bearing DN limit" k="turbo.bearing_dn_limit_millions" def={2.0} step={0.1} unit="M" hint="rolling-element DN limit 1.6–2.1 million (Cannon)" />
          <ParamField label="Bearing life" k="turbo.bearing_life_hours" def={5000} step={500} unit="h" />
          <ParamField label="Shaft allowable shear" k="turbo.shaft_allowable_shear_mpa" def={200} step={10} dim="pressure" baseUnit="MPa" />
        </div>
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <fieldset className="qt-groupbox">
          <legend>Pump</legend>
          <table className="qt-proptable">
            <tbody>
              <tr><td>Head rise</td><td className="val">{pump.head_rise_m.toFixed(0)} m</td></tr>
              <tr><td>Shaft power</td><td className="val">{power(pump.shaft_power_w)}</td></tr>
              <tr><td>Specific speed Nₛ</td><td className="val">{pump.specific_speed.toFixed(0)} ({pump.pump_type})</td></tr>
              <tr><td>NPSH avail / req</td><td className="val">{pump.npsh_available_m.toFixed(1)} / {pump.npsh_required_m.toFixed(1)} m</td></tr>
              <tr><td>Cavitation margin</td><td className="val"><Badge ok={pump.cavitation_margin_m > 0} good={`${pump.cavitation_margin_m.toFixed(1)} m`} bad={`${pump.cavitation_margin_m.toFixed(1)} m`} /></td></tr>
            </tbody>
          </table>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>Turbine drive</legend>
          <table className="qt-proptable">
            <tbody>
              <tr><td>Pressure ratio</td><td className="val">{turbine.pressure_ratio.toFixed(2)}</td></tr>
              <tr><td>Shaft power</td><td className="val">{power(turbine.shaft_power_w)}</td></tr>
              <tr><td>Exit temperature</td><td className="val">{turbine.exit_temp_k.toFixed(0)} K</td></tr>
              <tr><td>Specific speed</td><td className="val">{turbine.specific_speed.toFixed(1)}</td></tr>
            </tbody>
          </table>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>Inducer</legend>
          <table className="qt-proptable">
            <tbody>
              <tr><td>Suction specific speed</td><td className="val">{inducer.suction_specific_speed.toFixed(1)}</td></tr>
              <tr><td>Inlet tip Ø</td><td className="val">{(inducer.inlet_tip_diameter_m * 1000).toFixed(0)} mm</td></tr>
              <tr><td>Hub Ø</td><td className="val">{(inducer.hub_diameter_m * 1000).toFixed(0)} mm</td></tr>
              <tr><td>Flow coefficient</td><td className="val">{inducer.flow_coefficient.toFixed(2)}</td></tr>
              <tr><td>Cavitation</td><td className="val"><Badge ok={inducer.cavitation_ok} good="OK" bad="MARGINAL" /></td></tr>
            </tbody>
          </table>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>Shaft &amp; bearing</legend>
          <table className="qt-proptable">
            <tbody>
              <tr><td>Torque</td><td className="val">{shaft.torque_nm.toFixed(0)} N·m</td></tr>
              <tr><td>Diameter</td><td className="val">{(shaft.diameter_m * 1000).toFixed(1)} mm</td></tr>
              <tr><td>Critical speed</td><td className="val">{shaft.first_critical_rpm.toFixed(0)} rpm</td></tr>
              <tr><td>Whirl margin</td><td className="val"><Badge ok={shaft.subcritical} good={`${shaft.critical_speed_margin.toFixed(2)} (sub)`} bad={`${shaft.critical_speed_margin.toFixed(2)} (super)`} /></td></tr>
              <tr><td>Bearing L10 life</td><td className="val"><Badge ok={bearing.life_ok} good={`${bearing.l10_life_hours.toFixed(0)} h`} bad={`${bearing.l10_life_hours.toFixed(0)} h`} /></td></tr>
              <tr><td>DN value</td><td className="val"><Badge ok={bearing.dn_ok} good={`${(bearing.dn_value / 1e6).toFixed(2)}M`} bad={`${(bearing.dn_value / 1e6).toFixed(2)}M`} /></td></tr>
            </tbody>
          </table>
        </fieldset>
      </div>

      <fieldset className="qt-groupbox">
        <legend>Gas-generator cycle balance</legend>
        <table className="qt-proptable">
          <tbody>
            <tr><td>GG fraction (input)</td><td className="val">{(ggInput * 100).toFixed(1)} %</td></tr>
            <tr><td>GG fraction (balanced)</td><td className="val">{(gg_cycle.gg_flow_fraction * 100).toFixed(1)} %</td></tr>
            <tr><td>GG flow</td><td className="val">{gg_cycle.gg_flow_kg_s.toFixed(3)} kg/s</td></tr>
            <tr><td>Chamber flow</td><td className="val">{gg_cycle.chamber_flow_kg_s.toFixed(3)} kg/s</td></tr>
            <tr><td>Pump / turbine power</td><td className="val">{power(gg_cycle.pump_power_w)} / {power(gg_cycle.turbine_power_w)}</td></tr>
            <tr><td>Power balance</td><td className="val"><Badge ok={gg_cycle.margin >= 1 - 0.05} good={`${gg_cycle.margin.toFixed(2)} balanced`} bad={`${gg_cycle.margin.toFixed(2)} under-powered`} /></td></tr>
          </tbody>
        </table>
        <p className="qt-caption" style={{ marginTop: 6 }}>
          <b>Input</b> fraction sizes the turbine drive; <b>balanced</b> is the fraction the gas-generator cycle needs to make the turbine power the pump.
        </p>
      </fieldset>
    </div>
  );
}
