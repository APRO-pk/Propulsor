import { useEffect, useState } from "react";
import { feedStudy, type FeedStudyDto, type AvionicsHarnessDto, type HarnessChannelDto } from "./api";
import { useEngineStore } from "./store";
import { ParamField, ParamChoice, ResetParams } from "./ParamInput";

const FEEDS: [string, string][] = [
  ["", "Auto"],
  ["self-pressurizing", "Self-pressurizing"],
  ["pressure-fed", "Pressure-fed"],
  ["pump-fed", "Pump-fed"],
];

export function FeedSystem() {
  const [burn, setBurn] = useState(30);
  const [feedType, setFeedType] = useState("");
  const [study, setStudy] = useState<FeedStudyDto | null>(null);
  const rev = useEngineStore((s) => s.design?.meta.revision);

  useEffect(() => {
    let live = true;
    feedStudy(burn, feedType).then((s) => live && setStudy(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [burn, feedType, rev]);

  if (!study) return <p className="muted">Sizing feed system…</p>;
  const bar = (pa: number) => (pa / 1e5).toFixed(1);

  return (
    <div>
      <fieldset className="qt-groupbox">
        <legend>Architecture</legend>
        <div className="qt-field">
          <span>Feed type</span>
          <span>
            {FEEDS.map(([id, label]) => (
              <button key={id} className={`qt-tool ${feedType === id ? "on" : ""}`} style={{ marginLeft: 6 }} onClick={() => setFeedType(id)}>{label}</button>
            ))}
          </span>
        </div>
        <label className="qt-field">
          <span>Burn time (s)</span>
          <input type="number" step={5} value={burn} onChange={(e) => setBurn(Number(e.target.value))} />
        </label>
        <div className="qt-field">
          <span>Active architecture</span>
          <b>{study.feed_type} {study.feed_type === study.recommended_feed ? "" : `(recommended: ${study.recommended_feed})`}</b>
        </div>
        <div className="qt-field"><span>Tank pressure</span><b>{bar(study.tank_pressure_pa)} bar</b></div>
      </fieldset>

      <fieldset className="qt-groupbox">
        <legend>Design inputs<span style={{ float: "right" }}><ResetParams prefix="feed." /></span></legend>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 16px" }}>
          <ParamField label="Injector ΔP (frac of Pc)" k="feed.injector_dp_fraction" def={0.2} step={0.01} hint="0.15–0.3 typical" />
          <ParamField label="Line ΔP" k="feed.line_dp_bar" def={1.0} step={0.1} unit="bar" />
          <ParamField label="Pump-fed tank pressure" k="feed.pumpfed_tank_bar" def={3.0} step={0.5} unit="bar" />
          <ParamField label="Tank L/D ratio" k="feed.tank_ld_ratio" def={2.6} step={0.1} />
          <ParamField label="Ullage factor" k="feed.ullage_factor" def={1.06} step={0.01} />
          <ParamField label="Tank wall allowable" k="feed.tank_allowable_mpa" def={250} step={10} unit="MPa" />
          <ParamField label="Tank test factor" k="feed.tank_test_factor" def={1.5} step={0.1} />
          <ParamField label="Tank wall density" k="feed.tank_wall_density" def={2700} step={100} unit="kg/m³" />
          <ParamChoice label="Pressurant gas" k="feed.pressurant_gas" def="Helium" options={["Helium", "Nitrogen", "Argon"]} hint="He preferred (lowest MW → least mass)" />
          <ParamField label="Pressurant factor" k="feed.pressurant_factor" def={1.6} step={0.1} hint="over ideal-gas mass (residual, cooling, ullage)" />
          <ParamField label="Pressurant bottle P" k="feed.pressurant_bottle_bar" def={274} step={10} unit="bar" hint="stored up to ~270 atm (Cannon)" />
        </div>
      </fieldset>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <fieldset className="qt-groupbox">
          <legend>Propellant tanks</legend>
          <table className="qt-proptable">
            <thead><tr><th></th><th>Oxidizer</th><th>Fuel</th></tr></thead>
            <tbody>
              <tr><td>Propellant mass</td><td className="val">{study.ox_tank.propellant_mass_kg.toFixed(1)} kg</td><td className="val">{study.fuel_tank.propellant_mass_kg.toFixed(1)} kg</td></tr>
              <tr><td>Volume</td><td className="val">{study.ox_tank.volume_l.toFixed(1)} L</td><td className="val">{study.fuel_tank.volume_l.toFixed(1)} L</td></tr>
              <tr><td>Ø × L</td><td className="val">{(study.ox_tank.diameter_m * 1000).toFixed(0)}×{(study.ox_tank.length_m * 1000).toFixed(0)} mm</td><td className="val">{(study.fuel_tank.diameter_m * 1000).toFixed(0)}×{(study.fuel_tank.length_m * 1000).toFixed(0)} mm</td></tr>
              <tr><td>Wall thickness</td><td className="val">{(study.ox_tank.wall_thickness_m * 1000).toFixed(2)} mm</td><td className="val">{(study.fuel_tank.wall_thickness_m * 1000).toFixed(2)} mm</td></tr>
              <tr><td>Tank mass</td><td className="val">{study.ox_tank.tank_mass_kg.toFixed(1)} kg</td><td className="val">{study.fuel_tank.tank_mass_kg.toFixed(1)} kg</td></tr>
            </tbody>
          </table>
          <div className="qt-field" style={{ marginTop: 6 }}><span>Total propellant / dry tanks</span><b>{study.total_propellant_mass_kg.toFixed(1)} / {study.dry_tank_mass_kg.toFixed(1)} kg</b></div>
        </fieldset>

        <fieldset className="qt-groupbox">
          <legend>Pressurant &amp; feed budget</legend>
          {study.pressurant ? (
            <table className="qt-proptable">
              <tbody>
                <tr><td>Pressurant gas</td><td className="val">{study.pressurant.gas}</td></tr>
                <tr><td>Gas mass</td><td className="val">{study.pressurant.mass_kg.toFixed(2)} kg</td></tr>
                <tr><td>Bottle</td><td className="val">{study.pressurant.bottle_volume_l.toFixed(1)} L @ {study.pressurant.bottle_pressure_bar.toFixed(0)} bar</td></tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">{study.feed_type === "self-pressurizing" ? "Self-pressurizing — the propellant vapor pressure feeds the chamber, no separate pressurant." : "Pump-fed — turbomachinery raises the pressure, no pressurant bottle."}</p>
          )}
          <table className="qt-proptable" style={{ marginTop: 8 }}>
            <tbody>
              <tr><td>Chamber pressure</td><td className="val">{bar(study.feed_budget.chamber_pressure_pa)} bar</td></tr>
              <tr><td>+ Injector ΔP</td><td className="val">{bar(study.feed_budget.injector_dp_pa)} bar</td></tr>
              <tr><td>+ Line ΔP</td><td className="val">{bar(study.feed_budget.line_dp_pa)} bar</td></tr>
              <tr><td>= Required tank P</td><td className="val">{bar(study.feed_budget.required_tank_pressure_pa)} bar</td></tr>
            </tbody>
          </table>
        </fieldset>
      </div>

      <fieldset className="qt-groupbox">
        <legend>Feed schematic (P&amp;ID) &amp; avionics</legend>
        <PID study={study} />
      </fieldset>

      <fieldset className="qt-groupbox">
        <legend>Avionics &amp; electrical harness</legend>
        <Avionics harness={study.harness} />
      </fieldset>
    </div>
  );
}

const SIGNAL_COLOR: Record<string, string> = {
  power: "#c47b12",
  pwm: "#3574e0",
  digital: "#2f8f46",
  analog: "#7a5bd0",
  highvoltage: "#c23b34",
};
const KIND_GLYPH: Record<string, string> = {
  valve: "▽",
  igniter: "✷",
  sensor: "◉",
  pump: "◆",
  pressurant: "⬡",
};

/** Avionics power budget, electrical harness diagram, and channel BOM. */
function Avionics({ harness }: { harness: AvionicsHarnessDto }) {
  return (
    <div>
      <div className="qt-field"><span>Harness</span><span className="qt-badge solved">{harness.summary}</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 16px", margin: "6px 0 10px" }}>
        <ParamField label="Bus voltage" k="avionics.bus_voltage_v" def={28} step={1} unit="V" />
        <ParamChoice label="Redundancy" k="avionics.redundancy" def="single" options={["single", "dual"]} hint="dual adds a redundant flight computer, main valves, and Pc sensor" />
        <ParamField label="Battery reserve ×" k="avionics.battery_reserve_factor" def={2.0} step={0.1} hint="battery sizing margin over mission energy" />
        <ParamField label="Battery specific energy" k="avionics.battery_energy_density_wh_kg" def={150} step={10} unit="Wh/kg" />
        <ParamField label="Housekeeping current" k="avionics.housekeeping_current_a" def={0.5} step={0.1} unit="A" hint="flight computer + telemetry" />
        <ParamField label="Main-valve current" k="avionics.main_valve_current_a" def={3.0} step={0.5} unit="A" />
        <ParamField label="Igniter current" k="avionics.igniter_current_a" def={5.0} step={0.5} unit="A" />
        <ParamField label="Wire run (0=auto)" k="avionics.run_length_m" def={0} step={0.1} unit="m" hint="override the derived avionics-bay→component run length" />
      </div>
      <div style={{ textAlign: "right", marginBottom: 6 }}><ResetParams prefix="avionics." /></div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", margin: "6px 0 10px" }}>
        <div className="qt-field" style={{ minWidth: 150 }}><span>Bus voltage</span><b>{harness.bus_voltage_v.toFixed(0)} V DC</b></div>
        <div className="qt-field" style={{ minWidth: 150 }}><span>Peak / continuous</span><b>{harness.peak_current_a.toFixed(1)} / {harness.continuous_current_a.toFixed(1)} A</b></div>
        <div className="qt-field" style={{ minWidth: 150 }}><span>Battery</span><b>{harness.battery_capacity_wh.toFixed(0)} Wh · {harness.battery_mass_kg.toFixed(2)} kg</b></div>
        <div className="qt-field" style={{ minWidth: 150 }}><span>Harness</span><b>{harness.harness_mass_kg.toFixed(2)} kg · {harness.total_wire_length_m.toFixed(1)} m</b></div>
      </div>

      <HarnessDiagram channels={harness.channels} />

      <table className="qt-proptable" style={{ marginTop: 10 }}>
        <thead><tr><th>Channel</th><th>Type</th><th>Signal</th><th>V</th><th>Peak A</th><th>Wire</th><th>Connector</th></tr></thead>
        <tbody>
          {harness.channels.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td>{c.kind}</td>
              <td><span style={{ color: SIGNAL_COLOR[c.signal] ?? "#555", fontWeight: 600 }}>{c.signal}</span></td>
              <td className="val">{c.voltage_v.toFixed(0)}</td>
              <td className="val">{c.current_a >= 0.1 ? c.current_a.toFixed(1) : (c.current_a * 1000).toFixed(0) + "m"}</td>
              <td className="val">{c.wire_awg} AWG{c.continuous ? "" : " (pulsed)"}</td>
              <td className="val">{c.connector}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Star-topology harness: flight computer / PDU on the left, one coloured wire
 *  per channel to its component, thickness set by wire gauge. */
function HarnessDiagram({ channels }: { channels: HarnessChannelDto[] }) {
  const rowH = 24;
  const top = 18;
  const h = top + channels.length * rowH + 16;
  const fcX = 20, fcW = 128, wireX0 = fcX + fcW, compX = 560;
  const gaugeW = (awg: number) => ({ 16: 4, 18: 3.2, 20: 2.6, 22: 2 }[awg] ?? 1.4);
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--qt-border)", borderRadius: 4, background: "#fafbfc" }}>
      <svg viewBox={`0 0 640 ${h}`} width="100%" role="img" aria-label="avionics electrical harness">
        {/* Flight computer / PDU */}
        <rect x={fcX} y={top} width={fcW} height={channels.length * rowH} rx={5} fill="#eef1f6" stroke="#6b7280" strokeWidth={1.5} />
        <text x={fcX + fcW / 2} y={top + 18} textAnchor="middle" fontSize={12} fill="#333" fontWeight={700}>Flight computer</text>
        <text x={fcX + fcW / 2} y={top + 33} textAnchor="middle" fontSize={9.5} fill="#666">+ power distribution</text>
        <text x={fcX + fcW / 2} y={top + 48} textAnchor="middle" fontSize={9.5} fill="#666">28 V bus · MCU · TM</text>

        {channels.map((c, i) => {
          const y = top + rowH * i + rowH / 2;
          const color = SIGNAL_COLOR[c.signal] ?? "#555";
          const dash = c.continuous ? undefined : "6 4";
          return (
            <g key={c.name}>
              <line x1={wireX0} y1={y} x2={compX} y2={y} stroke={color} strokeWidth={gaugeW(c.wire_awg)} strokeDasharray={dash} />
              <circle cx={wireX0} cy={y} r={2.5} fill={color} />
              <text x={compX + 8} y={y - 2} fontSize={11} fill="#222">{KIND_GLYPH[c.kind] ?? "•"} {c.name}</text>
              <text x={wireX0 + 8} y={y - 4} fontSize={8.5} fill="#777">{c.wire_awg} AWG · {c.current_a >= 0.1 ? c.current_a.toFixed(1) + " A" : (c.current_a * 1000).toFixed(0) + " mA"}</text>
              <text x={compX + 8} y={y + 9} fontSize={8} fill="#999">{c.connector}{c.continuous ? "" : " · pulsed"}</text>
            </g>
          );
        })}

        {/* Signal-type legend */}
        {Object.entries(SIGNAL_COLOR).map(([sig, col], i) => (
          <g key={sig}>
            <line x1={fcX + i * 118} y1={h - 6} x2={fcX + 22 + i * 118} y2={h - 6} stroke={col} strokeWidth={3} />
            <text x={fcX + 26 + i * 118} y={h - 3} fontSize={9} fill="#555">{sig}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** A piping-and-instrumentation schematic reflecting the feed architecture. */
function PID({ study }: { study: FeedStudyDto }) {
  const pumpFed = study.feed_type === "pump-fed";
  const pressFed = study.feed_type === "pressure-fed";
  const OX = "#5aa9e6";
  const FU = "#e6a15a";
  const line = (x1: number, y1: number, x2: number, y2: number, c: string) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={2.5} />
  );
  const valve = (x: number, y: number, c: string) => (
    <g>
      <polygon points={`${x - 8},${y - 7} ${x},${y} ${x - 8},${y + 7}`} fill={c} />
      <polygon points={`${x + 8},${y - 7} ${x},${y} ${x + 8},${y + 7}`} fill={c} />
    </g>
  );
  const pump = (x: number, y: number, c: string) => (
    <g>
      <circle cx={x} cy={y} r={13} fill="#f5f6f8" stroke={c} strokeWidth={2.5} />
      <path d={`M ${x - 6} ${y} L ${x + 6} ${y - 5} L ${x + 6} ${y + 5} Z`} fill={c} />
    </g>
  );
  const tank = (x: number, y: number, c: string, label: string) => (
    <g>
      <rect x={x - 34} y={y} width={68} height={78} rx={20} fill="#fafbfc" stroke={c} strokeWidth={2.5} />
      <text x={x} y={y + 44} textAnchor="middle" fontSize={12} fill="#333" fontWeight={600}>{label}</text>
    </g>
  );

  return (
    <svg viewBox="0 0 640 360" width="100%" role="img" aria-label="feed system P&ID">
      {/* Pressurant */}
      {pressFed && (
        <g>
          <circle cx={60} cy={54} r={26} fill="#eef7ee" stroke="#4a9d5a" strokeWidth={2.5} />
          <text x={60} y={58} textAnchor="middle" fontSize={11} fill="#333">He</text>
          {valve(60, 108, "#4a9d5a")}
          {line(60, 80, 60, 100, "#4a9d5a")}
          {line(60, 116, 60, 140, "#4a9d5a")}
          {line(60, 140, 200, 140, "#4a9d5a")}
          {line(200, 140, 440, 140, "#4a9d5a")}
          {line(200, 140, 200, 150, "#4a9d5a")}
          {line(440, 140, 440, 150, "#4a9d5a")}
          <text x={250} y={134} fontSize={10} fill="#4a9d5a">regulated pressurant</text>
        </g>
      )}

      {/* Tanks */}
      {tank(200, 150, OX, "OX")}
      {tank(440, 150, FU, "FUEL")}

      {/* Ox line */}
      {line(200, 228, 200, 262, OX)}
      {valve(200, 262, OX)}
      {pumpFed ? (
        <>
          {line(200, 270, 200, 288, OX)}
          {pump(200, 300, OX)}
          {line(200, 313, 200, 330, OX)}
        </>
      ) : (
        line(200, 270, 200, 330, OX)
      )}

      {/* Fuel line */}
      {line(440, 228, 440, 262, FU)}
      {valve(440, 262, FU)}
      {pumpFed ? (
        <>
          {line(440, 270, 440, 288, FU)}
          {pump(440, 300, FU)}
          {line(440, 313, 440, 330, FU)}
        </>
      ) : (
        line(440, 270, 440, 330, FU)
      )}

      {/* Converge to injector */}
      {line(200, 330, 300, 330, OX)}
      {line(440, 330, 340, 330, FU)}
      <rect x={300} y={322} width={40} height={16} fill="#c9ccd2" stroke="#8a8f98" />
      <text x={320} y={318} textAnchor="middle" fontSize={9} fill="#555">injector</text>

      {/* Chamber + nozzle */}
      <path d="M 305 338 L 335 338 L 342 356 L 298 356 Z" fill="#cdd2da" stroke="#7a8088" strokeWidth={1.5} />

      {/* Avionics controller + sensors */}
      <rect x={520} y={250} width={96} height={70} rx={4} fill="#f2f2f5" stroke="#6b7280" strokeWidth={1.5} />
      <text x={568} y={270} textAnchor="middle" fontSize={11} fill="#333" fontWeight={600}>Avionics</text>
      <text x={568} y={286} textAnchor="middle" fontSize={9} fill="#666">flight computer</text>
      <text x={568} y={302} textAnchor="middle" fontSize={9} fill="#666">valve · igniter ctrl</text>
      {/* sensor/control dashed lines */}
      <g stroke="#b06fb0" strokeWidth={1.3} strokeDasharray="4 3" fill="none">
        <path d="M 520 262 L 234 165" />
        <path d="M 520 275 L 462 160" />
        <path d="M 520 305 L 344 340" />
      </g>
      <text x={352} y={352} fontSize={9} fill="#b06fb0">igniter</text>
      <circle cx={320} cy={344} r={3} fill="#d14" />
    </svg>
  );
}
