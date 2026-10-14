import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { analysisStudy, coolingStudy, type AnalysisStudyDto, type CoolingStudyDto, type EngineDesignDto, type L0ResultDto, type L2ResultDto } from "./api";
import { engineProfile } from "./exporters";


const AXIS = { fill: "var(--ink-3)", fontSize: 11 } as const;
const TT = { background: "var(--bg-3)", border: "1px solid var(--line-2)", borderRadius: 5, fontSize: 12 } as const;

/**
 * Axial results for the selected part, plotted along the engine axis so they
 * read against the model above: wall temperature with the material limit and
 * the peak marked, heat flux, coolant budget, wall stress against allowable,
 * or the contour itself.
 */
export function PartResults({ view, tab, design, l0, l2, height = 118 }: { view: string; tab: string; design: EngineDesignDto; l0: L0ResultDto; l2: L2ResultDto | null; height?: number }) {
  const material = design.materials?.chamber ?? "OFHC Copper";
  const method = design.geometry?.cooling_jacket?.cooling_method ?? "regen";
  const rev = design.meta.revision;
  const [cool, setCool] = useState<CoolingStudyDto | null>(null);
  const [ana, setAna] = useState<AnalysisStudyDto | null>(null);
  // A failed solve says so; it never stays on "Solving…".
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (view !== "cooling") return;
    let live = true;
    setFailed(null);
    coolingStudy(material, method)
      .then((s) => live && setCool(s))
      .catch((e) => live && setFailed(String(e)));
    return () => {
      live = false;
    };
  }, [view, material, method, rev]);
  useEffect(() => {
    if (view !== "analysis") return;
    let live = true;
    setFailed(null);
    analysisStudy()
      .then((a) => live && setAna(a))
      .catch((e) => live && setFailed(String(e)));
    return () => {
      live = false;
    };
  }, [view, rev]);

  const contour = useMemo(() => engineProfile(l0, l2).map((p) => ({ x: +(p.x * 1000).toFixed(2), r: +(p.r * 1000).toFixed(2) })), [l0, l2]);
  const throatX = useMemo(() => contour.reduce((b, p) => (p.r < b.r ? p : b), contour[0]).x, [contour]);

  if (view === "cooling") {
    if (!cool) return failed ? <p className="err" role="alert">The wall solve didn't return: {failed}</p> : <p className="muted" role="status">Solving the wall…</p>;
    const st = cool.regen.stations.map((s) => ({ x: +(s.x * 1000).toFixed(1), r: s.r, t: +s.wall_temp_k.toFixed(0), q: +(s.heat_flux_w_m2 / 1e6).toFixed(2) }));
    // The thermal stations carry their own axial frame; find the throat in it.
    const coolThroat = st.reduce((b, p) => (p.r < b.r ? p : b), st[0]).x;
    if (tab === "coolant") {
      const c = cool.regen;
      const rows: [string, string][] = [
        ["Peak wall temperature", `${c.max_wall_temp_k.toFixed(0)} K`],
        ["Material limit", `${c.wall_material_limit_k.toFixed(0)} K`],
        ["Thermal margin", `${(c.wall_material_limit_k - c.max_wall_temp_k).toFixed(0)} K`],
        ["Coolant Δp", `${(c.coolant_dp_pa / 1e5).toFixed(2)} bar`],
        ["Liner thickness", `${(c.wall_thickness_m * 1000).toFixed(2)} mm`],
        ["Coolant margin", c.min_coolant_margin_k == null ? "No boiling or coking limit applies" : `${c.min_coolant_margin_k.toFixed(0)} K`],
      ];
      return (
        <div className="readout-grid">
          {rows.map(([k, v]) => (
            <div className="kv" key={k}><span>{k}</span><b>{v}</b></div>
          ))}
        </div>
      );
    }
    const peak = st.reduce((b, p) => (p.t > b.t ? p : b), st[0]);
    const isWall = tab !== "flux";
    const qPeak = st.reduce((b, p) => (p.q > b.q ? p : b), st[0]);
    const summary = isWall
      ? `Wall temperature along the chamber and nozzle: peak ${peak.t} K at x = ${peak.x} mm, against the ${material} limit of ${cool.regen.wall_material_limit_k.toFixed(0)} K.`
      : `Heat flux along the chamber and nozzle: peak ${qPeak.q} MW/m² at x = ${qPeak.x} mm.`;
    return (
      <AxialChart
        summary={summary}
        data={st}
        yKey={isWall ? "t" : "q"}
        yLabel={isWall ? "Wall T (K)" : "Heat flux (MW/m²)"}
        throatX={coolThroat}
        height={height}
        limit={isWall ? { y: cool.regen.wall_material_limit_k, label: `${material} limit ${cool.regen.wall_material_limit_k.toFixed(0)} K` } : undefined}
        peak={isWall ? { x: peak.x, y: peak.t, label: `${peak.t} K peak` } : undefined}
      />
    );
  }

  if (view === "analysis") {
    if (!ana) return failed ? <p className="err" role="alert">The stress solve didn't return: {failed}</p> : <p className="muted" role="status">Solving the wall stress…</p>;
    const st = ana.stress.stations.map((s) => ({ x: +(s.x * 1000).toFixed(1), s: +(s.combined_stress_pa / 1e6).toFixed(1), allow: s.combined_stress_pa * s.margin }));
    const allow = [...st.map((p) => p.allow)].sort((a, b) => a - b)[Math.floor(st.length / 2)] / 1e6;
    const peak = st.reduce((b, p) => (p.s > b.s ? p : b), st[0]);
    return (
      <AxialChart
        summary={`Combined wall stress along the engine: peak ${peak.s} MPa at x = ${peak.x} mm, against an allowable of ${allow.toFixed(0)} MPa.`}
        data={st}
        yKey="s"
        yLabel="Combined σ (MPa)"
        height={height}
        limit={{ y: +allow.toFixed(0), label: `allowable ${allow.toFixed(0)} MPa` }}
        peak={{ x: peak.x, y: peak.s, label: `${peak.s} MPa peak` }}
      />
    );
  }

  if (view === "section") {
    // From the axis, so the throat reads at its true proportion.
    const rMax = Math.max(...contour.map((p) => p.r));
    const rThroat = Math.min(...contour.map((p) => p.r));
    const rExit = contour[contour.length - 1]?.r ?? 0;
    return (
      <AxialChart
        summary={`Contour radius along the axis: chamber ${rMax.toFixed(1)} mm, throat ${rThroat.toFixed(1)} mm at x = ${throatX} mm, exit ${rExit.toFixed(1)} mm.`}
        data={contour}
        yKey="r"
        yLabel="Radius (mm)"
        throatX={throatX}
        height={height}
        fromZero
      />
    );
  }
  return null;
}

function AxialChart({
  summary,
  data,
  yKey,
  yLabel,
  throatX,
  limit,
  peak,
  height,
  fromZero,
}: {
  /** What the chart shows, in words, for screen readers. */
  summary: string;
  data: Record<string, number>[];
  yKey: string;
  yLabel: string;
  throatX?: number;
  limit?: { y: number; label: string };
  peak?: { x: number; y: number; label: string };
  height: number;
  fromZero?: boolean;
}) {
  return (
    <div role="img" aria-label={summary}>
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 14, right: 18, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis type="number" dataKey="x" domain={["dataMin", "dataMax"]} stroke="var(--line-2)" tick={AXIS} tickFormatter={(v) => `${Math.round(v)}`} unit=" mm" height={20} />
        <YAxis stroke="var(--line-2)" tick={AXIS} width={52} label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "var(--ink-3)", fontSize: 11, dy: 40 }} domain={fromZero ? [0, "auto"] : ["auto", "auto"]} />
        <Tooltip contentStyle={TT} labelFormatter={(v) => `x = ${v} mm`} />
        {throatX !== undefined && <ReferenceLine x={throatX} stroke="var(--line-2)" strokeDasharray="3 3" label={{ value: "throat", position: "insideBottomRight", fill: "var(--ink-3)", fontSize: 11 }} />}
        {limit && <ReferenceLine y={limit.y} stroke="var(--fail)" strokeDasharray="5 4" label={{ value: limit.label, position: "insideBottomRight", fill: "var(--fail)", fontSize: 11 }} ifOverflow="extendDomain" />}
        <Line type="monotone" dataKey={yKey} stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        {peak && <ReferenceDot x={peak.x} y={peak.y} r={3.5} fill="var(--accent)" stroke="var(--bg-2)" label={{ value: peak.label, position: "top", fill: "var(--ink)", fontSize: 11 }} />}
      </LineChart>
    </ResponsiveContainer>
    </div>
  );
}
