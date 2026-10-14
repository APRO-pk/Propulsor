import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  analysisStudy,
  coolingStudy,
  turbopumpStudy,
  type AnalysisStudyDto,
  type CoolingStudyDto,
  type EngineDesignDto,
  type L0ResultDto,
  type L1ResultDto,
  type L2ResultDto,
  type TurbopumpStudyDto,
} from "./api";

type Big = { value: string; unit: string; caption: string; tone?: "ok" | "fail" };
type Row = { label: string; value: string; tone?: "ok" | "fail" };

/**
 * The selected part's headline numbers, pinned under the inspector: two large
 * figures and up to two supporting rows, recomputed with every revision.
 * Parts without a clear single outcome show nothing rather than a guess.
 */
/** A value that glows briefly in the accent when it changes (not on first render): live consequence of an edit. */
function Fresh({ value, children }: { value: string; children: ReactNode }) {
  const prev = useRef(value);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setN((k) => k + 1);
    }
  }, [value]);
  return (
    <span key={n} className={n ? "fresh" : undefined}>
      {children}
    </span>
  );
}

export function Outcome({ view, design, l0, l1, l2 }: { view: string; design: EngineDesignDto; l0: L0ResultDto; l1: L1ResultDto | null; l2: L2ResultDto | null }) {
  const rev = design.meta.revision;
  const material = design.materials?.chamber ?? "OFHC Copper";
  const method = design.geometry?.cooling_jacket?.cooling_method ?? "regen";
  const rpm = Number(design.params?.["turbo.shaft_speed_rpm"] ?? 20000);
  const [cool, setCool] = useState<CoolingStudyDto | null>(null);
  const [ana, setAna] = useState<AnalysisStudyDto | null>(null);
  const [turbo, setTurbo] = useState<TurbopumpStudyDto | null>(null);

  useEffect(() => {
    let live = true;
    if (view === "cooling") coolingStudy(material, method).then((s) => live && setCool(s)).catch(() => {});
    if (view === "analysis") analysisStudy().then((s) => live && setAna(s)).catch(() => {});
    if (view === "turbo") turbopumpStudy(rpm).then((s) => live && setTurbo(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [view, material, method, rpm, rev]);

  let big: Big[] = [];
  let rows: Row[] = [];
  if (view === "design" && l1) {
    big = [
      { value: l1.tc_k.toFixed(0), unit: "K", caption: "Chamber temperature" },
      { value: l1.isp_vacuum_s.toFixed(0), unit: "s", caption: "Vacuum Isp, ideal max" },
    ];
    rows = [
      { label: "c*, equilibrium", value: `${l1.c_star_m_s.toFixed(0)} m/s` },
      { label: "Total flow", value: `${l0.total_flow.toFixed(3)} kg/s` },
    ];
  } else if (view === "perf" && l2) {
    big = [
      { value: (l2.isp_sl_s ?? l2.isp_s).toFixed(0), unit: "s", caption: "Delivered Isp, sea level" },
      { value: (l2.isp_vac_s ?? l2.isp_s).toFixed(0), unit: "s", caption: "Delivered Isp, vacuum" },
    ];
    rows = [{ label: "Exit pressure", value: `${(l2.exit_pressure_pa / 1e5).toFixed(3)} bar` }];
  } else if (view === "section" && l2) {
    big = [
      { value: l2.area_ratio.toFixed(2), unit: "", caption: "Area ratio ε" },
      { value: l2.exit_mach.toFixed(2), unit: "", caption: "Exit Mach" },
    ];
    rows = [
      { label: "Throat diameter", value: `${(l0.throat_diameter * 1000).toFixed(1)} mm` },
      { label: "Exit diameter", value: `${(l0.exit_diameter * 1000).toFixed(1)} mm` },
    ];
  } else if (view === "cooling" && cool) {
    const c = cool.regen;
    const margin = c.wall_material_limit_k - c.max_wall_temp_k;
    const peakQ = Math.max(...c.stations.map((s) => s.heat_flux_w_m2)) / 1e6;
    big = [
      { value: c.max_wall_temp_k.toFixed(0), unit: "K", caption: `Peak wall, limit ${c.wall_material_limit_k.toFixed(0)} K`, tone: margin < 0 ? "fail" : undefined },
      { value: (c.coolant_dp_pa / 1e5).toFixed(1), unit: "bar", caption: "Coolant Δp" },
    ];
    rows = [
      { label: "Thermal margin", value: `${margin.toFixed(0)} K`, tone: margin < 0 ? "fail" : "ok" },
      { label: "Peak heat flux", value: `${peakQ.toFixed(1)} MW/m²` },
    ];
  } else if (view === "analysis" && ana) {
    const st = ana.stress.stations;
    const minMargin = Math.min(...st.map((s) => s.margin));
    const peak = Math.max(...st.map((s) => s.combined_stress_pa)) / 1e6;
    big = [
      { value: minMargin.toFixed(2), unit: "", caption: "Minimum structural margin", tone: minMargin < 1 ? "fail" : undefined },
      { value: peak.toFixed(0), unit: "MPa", caption: "Peak combined stress" },
    ];
    rows = [
      { label: "Combustion stability", value: ana.instability.stable ? `Stable · margin ${ana.instability.stability_margin.toFixed(2)}` : `Unstable · margin ${ana.instability.stability_margin.toFixed(2)}`, tone: ana.instability.stable ? "ok" : "fail" },
    ];
  } else if (view === "turbo" && turbo) {
    big = [
      { value: (turbo.pump.shaft_power_w / 1000).toFixed(0), unit: "kW", caption: "Pump shaft power" },
      { value: turbo.gg_cycle.margin.toFixed(2), unit: "", caption: "Cycle power balance" },
    ];
    rows = [
      { label: "Shaft first critical", value: `${turbo.shaft.first_critical_rpm.toFixed(0)} rpm · ${turbo.shaft.subcritical ? "subcritical" : "supercritical"}` },
      { label: "Cavitation margin", value: `${turbo.pump.cavitation_margin_m.toFixed(1)} m`, tone: turbo.pump.cavitation_margin_m < 0 ? "fail" : undefined },
    ];
  }

  if (!big.length) return null;
  return (
    <section className="outcome" aria-label="Outcome">
      <h2 className="fig-title">Outcome</h2>
      <div className="outcome-big">
        {big.map((b) => (
          <div key={b.caption}>
            <div className={`n ${b.tone ?? ""}`}><Fresh value={String(b.value)}>{b.value}</Fresh>{b.unit && <small>{b.unit}</small>}</div>
            <div className="k">{b.caption}</div>
          </div>
        ))}
      </div>
      {rows.map((r) => (
        <div className="kv" key={r.label}>
          <span>{r.label}</span>
          <b className={r.tone ?? ""}><Fresh value={String(r.value)}>{r.value}</Fresh></b>
        </div>
      ))}
    </section>
  );
}
