import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useEngineStore } from "./store";
import { downloadText } from "./exporters";
import { issuesReport, useBackendMode, type IssuesReportDto } from "./api";
import { BlueprintEngine, type DrawingZone } from "./BlueprintEngine";
import { FeatureTree, type NodeStatus, type TreeEntry } from "./FeatureTree";
import { BrandMark, Ico } from "./Icons";
import type { EngineZone } from "./EngineViewer";
import { Outcome } from "./Outcome";
import { ChecksMenu } from "./ChecksMenu";
import { FirstRun, FirstTips, markTipsSeen, resetTips, tipsSeen } from "./FirstRun";
import { FloatingWindow } from "./FloatingWindow";
import { RequirementsWindow } from "./RequirementsWindow";
import { useRoleSort } from "./roles";
import { PAIR_LABEL } from "./propellants";
import { channel, openRequirementsWindow, type WindowMessage } from "./windows";

// Views load on demand so three.js / recharts stay out of the startup bundle.
const PerfMapChart = lazy(() => import("./PerfMapChart").then((m) => ({ default: m.PerfMapChart })));
const EngineViewer = lazy(() => import("./EngineViewer").then((m) => ({ default: m.EngineViewer })));
const SpecSheet = lazy(() => import("./SpecSheet").then((m) => ({ default: m.SpecSheet })));
const ContourView = lazy(() => import("./ContourView").then((m) => ({ default: m.ContourView })));
const PartResults = lazy(() => import("./PartResults").then((m) => ({ default: m.PartResults })));
const Cooling = lazy(() => import("./Cooling").then((m) => ({ default: m.Cooling })));
const Turbopumps = lazy(() => import("./Turbopumps").then((m) => ({ default: m.Turbopumps })));
const Analysis = lazy(() => import("./Analysis").then((m) => ({ default: m.Analysis })));
const FeedSystem = lazy(() => import("./FeedSystem").then((m) => ({ default: m.FeedSystem })));
const SystemAssembly = lazy(() => import("./SystemAssembly").then((m) => ({ default: m.SystemAssembly })));
const Dashboard = lazy(() => import("./Dashboard").then((m) => ({ default: m.Dashboard })));
const Trades = lazy(() => import("./Trades").then((m) => ({ default: m.Trades })));
const Blades = lazy(() => import("./Blades").then((m) => ({ default: m.Blades })));
const Validation = lazy(() => import("./Validation").then((m) => ({ default: m.Validation })));
const Control = lazy(() => import("./Control").then((m) => ({ default: m.Control })));

const PSI = 6894.76;

type View = "design" | "perf" | "section" | "cooling" | "analysis" | "turbo" | "blades" | "feed" | "control" | "assembly" | "dashboard" | "trades" | "validation";

/** What each part of the tree is, and which part of the engine it lights. */
const PART: Record<View, { label: string; crumb?: string; about: string; zones: EngineZone[] }> = {
  design: { label: "Requirements", about: "Propellant, thrust, chamber pressure and mixture ratio, step by step to export.", zones: [] },
  perf: { label: "Performance", about: "Specific impulse against altitude for this design.", zones: ["nozzle"] },
  section: { label: "Contour", crumb: "Thrust chamber", about: "Chamber, throat and nozzle contour with wall detail.", zones: ["chamber", "nozzle"] },
  cooling: { label: "Cooling jacket", crumb: "Thrust chamber", about: "Wall material, cooling method, thermal results and the print plan.", zones: ["jacket"] },
  analysis: { label: "Injector & structure", crumb: "Thrust chamber", about: "Injector flow, combustion stability, wall stress and c* efficiency.", zones: ["injector", "chamber"] },
  turbo: { label: "Turbopump", crumb: "Turbomachinery", about: "Pump, turbine, inducer, shaft and bearing sizing with cycle balance.", zones: [] },
  blades: { label: "Blades", crumb: "Turbomachinery", about: "Impeller and turbine blade profiles, losses and characteristic maps.", zones: [] },
  feed: { label: "Feed system", about: "Tanks, pressurant, feed pressure budget, P&ID and avionics harness.", zones: [] },
  control: { label: "Control", about: "Pc and mixture-ratio loops, sensors and valves, throttle response.", zones: [] },
  assembly: { label: "Vehicle", about: "Engine, tanks, pressurant and feed lines as one assembly.", zones: [] },
  dashboard: { label: "Summary", crumb: "Studies", about: "Key results, unit converter and the validation summary.", zones: [] },
  trades: { label: "Trade studies", crumb: "Studies", about: "O/F, expansion, L*, material and injector sweeps.", zones: [] },
  validation: { label: "Validation", crumb: "Studies", about: "Predicted against measured: sensor profiles, startup transient, telemetry import.", zones: [] },
};

/** Parts that open in the left panel (inputs there, results in a floating window). */
const DRILL: View[] = ["perf", "cooling", "analysis", "turbo", "blades", "feed", "control", "dashboard", "trades", "validation"];

const TREE: TreeEntry[] = [
  { id: "design", label: "Requirements" },
  { id: "perf", label: "Performance" },
  { group: "chamber", label: "Thrust chamber", children: [
    { id: "section", label: "Contour" },
    { id: "cooling", label: "Cooling jacket" },
    { id: "analysis", label: "Injector & structure" },
  ] },
  { group: "turbo", label: "Turbomachinery", children: [
    { id: "turbo", label: "Turbopump" },
    { id: "blades", label: "Blades" },
  ] },
  { id: "feed", label: "Feed system" },
  { id: "control", label: "Control" },
  { id: "assembly", label: "Vehicle" },
  { group: "studies", label: "Studies", children: [
    { id: "dashboard", label: "Summary" },
    { id: "trades", label: "Trade studies" },
    { id: "validation", label: "Validation" },
  ] },
];

/** Map an issue's area to the part that owns it. */
const AREA_VIEW: Record<string, View> = {
  analysis: "analysis", structures: "analysis", stress: "analysis", injector: "analysis",
  cooling: "cooling", thermal: "cooling", turbopumps: "turbo", turbo: "turbo", blades: "blades",
  feed: "feed", "feed system": "feed", control: "control", validation: "validation", nozzle: "section",
};


/** Axial charts each part shows at the top of its Results window (kept here so recharts stays lazy). */
const PART_TABS: Partial<Record<View, [string, string][]>> = {
  cooling: [["wall", "Wall temperature"], ["flux", "Heat flux"], ["coolant", "Coolant"]],
  analysis: [["stress", "Wall stress"]],
};

/** The view component for a drill-in part. */
function PartView({ view, perf }: { view: View; perf: ReactNode }) {
  switch (view) {
    case "dashboard": return <Dashboard />;
    case "cooling": return <Cooling />;
    case "turbo": return <Turbopumps />;
    case "blades": return <Blades />;
    case "analysis": return <Analysis />;
    case "validation": return <Validation />;
    case "feed": return <FeedSystem />;
    case "control": return <Control />;
    case "trades": return <Trades />;
    case "perf": return <>{perf}</>;
    default: return null;
  }
}

export default function App() {
  const store = useEngineStore();
  const [view, setView] = useState<View>("design");
  const [drilled, setDrilled] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [contourOpen, setContourOpen] = useState(false);
  const [reqOverlay, setReqOverlay] = useState(false);
  const [si, setSi] = useState(true);
  const [issues, setIssues] = useState<IssuesReportDto | null>(null);
  const [issuesFailed, setIssuesFailed] = useState(false);
  const [checksRun, setChecksRun] = useState(0);
  const [chartTab, setChartTab] = useState<string>("");
  const [checksOpen, setChecksOpen] = useState(false);
  // First-run tips: once, after the first engine appears; opening a part counts as seen.
  const [showTips, setShowTips] = useState(() => !tipsSeen());
  const dismissTips = useCallback(() => {
    markTipsSeen();
    setShowTips(false);
  }, []);
  const [sheet, setSheet] = useState(false);
  const backend = useBackendMode();
  const fileRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const leftBodyRef = useRef<HTMLDivElement>(null);
  const resultsBodyRef = useRef<HTMLDivElement>(null);
  const treeReturn = useRef<string>("design");
  const drillTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    store.load();
    store.loadPerfMap();
  }, []);

  const { l0, l1, l2, design, perfMap } = store;

  // A solve in the Requirements window: reload the shared design.
  useEffect(() => {
    const ch = channel();
    if (!ch) return;
    ch.addEventListener("message", async (e: MessageEvent<WindowMessage>) => {
      if (e.data.type !== "solved") return;
      await useEngineStore.getState().load();
      await useEngineStore.getState().loadPerfMap();
    });
    return () => ch.close();
  }, []);

  const configured =
    (design?.operating_point.thrust ?? 0) > 0 &&
    (design?.operating_point.chamber_pressure ?? 0) > 0 &&
    (design?.operating_point.mixture_ratio ?? 0) > 0 &&
    !!design?.propellant.pair &&
    design.propellant.pair !== "Unset";

  const openRequirements = useCallback(async () => {
    const ok = await openRequirementsWindow();
    if (!ok) setReqOverlay(true);
  }, []);

  const select = useCallback(
    (v: string) => {
      const next = v as View;
      if (next === "design") {
        void openRequirements();
        return;
      }
      setView(next);
      setChartTab(PART_TABS[next]?.[0][0] ?? "");
      if (next === "section") {
        setContourOpen(true);
        setDrilled(false);
        return;
      }
      treeReturn.current = v;
      // Opening a part completes the first tip, but only once there is an engine to explore.
      if (DRILL.includes(next) && useEngineStore.getState().l0) {
        markTipsSeen();
        setShowTips(false);
      }
      setDrilled(DRILL.includes(next));
      setResultsOpen(true);
    },
    [openRequirements],
  );

  const newDesign = async () => {
    if (configured && !window.confirm("Start a new design? This clears the current one.")) return;
    await store.reset();
    await store.loadPerfMap();
    setDrilled(false);
    setView("design");
    void openRequirements();
  };
  const saveDesign = () => {
    if (!design) return;
    const name = (design.meta.name || "propulsor-design").replace(/\s+/g, "_");
    downloadText(`${name}.json`, JSON.stringify(design, null, 2));
  };
  const openFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const dto = JSON.parse(await f.text());
      await store.reset();
      await store.importDesign(dto);
      await store.loadPerfMap();
    } catch (err) {
      window.alert(`Could not open design file: ${String(err)}`);
    }
  };

  // Keyboard: undo/redo, save, open, help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") { e.preventDefault(); helpRef.current?.showModal(); return; }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); void useEngineStore.getState().undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); void useEngineStore.getState().redo(); }
      else if (k === "s") { e.preventDefault(); saveDesign(); }
      else if (k === "o") { e.preventDefault(); fileRef.current?.click(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Collect the consolidated checks whenever the design resolves.
  const rev = design?.meta.revision;
  useEffect(() => {
    if (!l0) {
      setIssues(null);
      return;
    }
    let live = true;
    setIssuesFailed(false);
    issuesReport()
      .then((r) => live && setIssues(r))
      .catch(() => {
        if (!live) return;
        setIssues(null);
        setIssuesFailed(true);
      });
    store.loadPerfMap();
    return () => {
      live = false;
    };
  }, [rev, l0, checksRun]);

  // Opening a part moves focus to its title, so keyboard and screen-reader users land in it.
  useEffect(() => {
    if (drilled) drillTitleRef.current?.focus({ preventScroll: true });
  }, [drilled, view]);

  // Inputs stay in the left panel; results open in the floating window.
  const leftCounts = useRoleSort(leftBodyRef, [view, drilled, l0]);
  const split = drilled && leftCounts.inputs > 0 && leftCounts.results > 0;
  const showResults = split && resultsOpen;
  const [resultsCover, setResultsCover] = useState({ right: 0, bottom: 0, top: 0 });
  const stageRef = useRef<HTMLElement>(null);
  useRoleSort(resultsBodyRef, [view, showResults, l0]);

  const pressFmt = (pa: number) => (si ? `${(pa / 1e5).toFixed(pa >= 1e6 ? 0 : 2)} bar` : `${(pa / PSI).toFixed(0)} psi`);
  const thrustFmt = (n: number) => (si ? (n >= 1000 ? `${(n / 1000).toFixed(n >= 1e5 ? 0 : 1)} kN` : `${n.toFixed(0)} N`) : `${(n / 4.4482216).toFixed(0)} lbf`);

  // Solve state in plain words (a reserved stage with no solver carries no payload).
  const caches = (design?.caches ?? []).filter((c) => !(c.tier === "L6" && c.payload == null));
  const solveText = !caches.length
    ? "Not solved yet"
    : caches.some((c) => c.status === "Failed")
      ? "Solve failed — check the inputs"
      : caches.some((c) => c.status !== "Solved")
        ? "Out of date — press Solve"
        : "Solved";

  const issueList = issues?.issues ?? [];
  const statusOf = (id: string): NodeStatus => {
    if (id === "design") return configured ? "ok" : "none";
    if (!l0) return "none";
    const mine = issueList.filter((i) => AREA_VIEW[i.area.toLowerCase()] === id);
    if (mine.some((i) => i.severity === "fail")) return "fail";
    if (mine.length) return "warn";
    return "ok";
  };
  const firstFail = issueList.find((i) => i.severity === "fail");

  const part = PART[view];
  const pairLabel = configured ? PAIR_LABEL[design!.propellant.pair] ?? design!.propellant.pair : null;
  const zones = drilled || view === "section" ? part.zones : [];
  const insetZones: DrawingZone[] = zones.flatMap((z) => (z === "jacket" ? (["chamber", "nozzle"] as DrawingZone[]) : [z]));
  const zoneToView = (z: DrawingZone): View => (z === "injector" ? "analysis" : z === "chamber" ? "cooling" : "section");
  const chartTabs = l0 ? PART_TABS[view] ?? [] : [];
  const activeChart = chartTabs.some(([id]) => id === chartTab) ? chartTab : chartTabs[0]?.[0];

  const perfContent = perfMap ? (
    <>
      <h2 className="fig-title">Specific impulse vs altitude</h2>
      <PerfMapChart map={perfMap} />
    </>
  ) : (
    <p className="muted">No performance map for this design yet.</p>
  );

  return (
    <div className="shell">
      {/* ---- Top bar ---- */}
      <header className="topbar">
        <div className="brand">
          <BrandMark size={20} />
          <span>Propulsor</span>
        </div>
        <div className="ident" aria-label="Current design">
          <span className="ident-name" title={design?.meta.name || undefined}>{design?.meta.name || "Untitled design"}</span>
          <span className="ident-rev">Rev {design?.meta.revision ?? 0}</span>
          {configured ? (
            <span className="ident-spec">
              {pairLabel}<span className="dot">|</span>F <b>{thrustFmt(design!.operating_point.thrust)}</b>
              <span className="dot">|</span>Pc <b>{pressFmt(design!.operating_point.chamber_pressure)}</b>
              <span className="dot">|</span>O/F <b>{design!.operating_point.mixture_ratio.toFixed(2)}</b>
            </span>
          ) : (
            <span className="ident-empty">No requirements yet</span>
          )}
        </div>
        <nav className="actions" aria-label="Design actions">
          <button className="act" onClick={() => void openRequirements()} title="Edit the requirements in their own window" aria-label="Requirements">
            <Ico name="requirements" size={16} /><span className="label">Requirements</span>
          </button>
          <span className="vsep" />
          <button className="act" onClick={newDesign} title="New design" aria-label="New design">
            <Ico name="new" size={16} /><span className="label label-wide">New</span>
          </button>
          <button className="act" onClick={() => fileRef.current?.click()} title="Open a saved design (Ctrl+O)" aria-label="Open design">
            <Ico name="open" size={16} /><span className="label label-wide">Open</span>
          </button>
          <button className="act" onClick={saveDesign} disabled={!design} title="Save the design (Ctrl+S)" aria-label="Save design">
            <Ico name="save" size={16} /><span className="label label-wide">Save</span>
          </button>
          <span className="vsep" />
          <button className="act" onClick={() => store.undo()} disabled={store.undoStack.length === 0} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Ico name="undo" size={16} />
          </button>
          <button className="act" onClick={() => store.redo()} disabled={store.redoStack.length === 0} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <Ico name="redo" size={16} />
          </button>
          <button className={`act act-solve${store.loading ? " busy" : ""}`} onClick={() => store.load()} disabled={store.loading || !configured} aria-busy={store.loading} title={configured ? "Re-solve the design" : "Set the requirements first"} aria-label="Solve">
            <Ico name="solve" size={16} /><span className="label">Solve</span>
          </button>
          <span className="vsep" />
          <div className="units" title="Units for every readout">
            <span id="units-label" className="label-wide">Units</span>
            <div className="seg" role="group" aria-label="Readout units" aria-describedby="units-label">
              <button aria-pressed={si} onClick={() => setSi(true)}>SI</button>
              <button aria-pressed={!si} onClick={() => setSi(false)}>Imperial</button>
            </div>
          </div>
          <ChecksMenu
            issues={issues}
            open={checksOpen}
            onOpenChange={setChecksOpen}
            ready={!!l0}
            failedToLoad={issuesFailed}
            onRetry={() => setChecksRun((n) => n + 1)}
            partOf={(it) => {
              const target = AREA_VIEW[it.area.toLowerCase()];
              return target ? [target, PART[target].label] : null;
            }}
            onGoTo={(v) => select(v)}
          />
          <button className="act" onClick={() => helpRef.current?.showModal()} title="Help and shortcuts (F1)" aria-label="Help">
            <Ico name="help" size={16} />
          </button>
        </nav>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={openFile} />
      </header>

      {/* ---- Left panel: the parts list, or the selected part drilled in ---- */}
      <aside className={`left${drilled ? " drilled" : ""}`} aria-label={drilled ? `${part.label} inputs` : "Engine parts"}>
        {!drilled ? (
          <>
            <div className="tree-head">Engine</div>
            <FeatureTree entries={TREE} selected={view} status={statusOf} onSelect={select} />
            {configured && (
              <div className="tree-foot">
                <b>{pairLabel}</b> · {thrustFmt(design!.operating_point.thrust)}
                <br />
                {(design?.geometry?.cooling_jacket?.cooling_method ?? "regen") === "regen" ? "Regenerative" : design?.geometry?.cooling_jacket?.cooling_method} · {design?.materials?.chamber ?? "—"}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="drill-head">
              <button className="act drill-back" onClick={() => setDrilled(false)}>
                <Ico name="chevL" size={16} />
                <span>Engine</span>
                {part.crumb && <span className="drill-path">/ {part.crumb}</span>}
              </button>
              <div className="drill-title">
                <h1 tabIndex={-1} ref={drillTitleRef}>{part.label}</h1>
                <p>{part.about}</p>
              </div>
              {split && (
                <button className={`qt-tool${resultsOpen ? " on" : ""}`} onClick={() => setResultsOpen((o) => !o)} aria-pressed={resultsOpen}>
                  {resultsOpen ? "Hide results" : "Show results"}
                </button>
              )}
            </div>
            <div className="left-body" ref={leftBodyRef} {...(split ? { "data-show": "inputs" } : {})}>
              <Suspense fallback={<div className="page"><p className="muted" role="status">Loading…</p></div>}>
                {l0 ? (
                  <div className="page"><PartView view={view} perf={perfContent} /></div>
                ) : (
                  <div className="page">
                    <p className="muted">Every part sizes itself from the requirements. Set them first, or start from an example on the stage.</p>
                    <button className="act act-solve" onClick={() => void openRequirements()}>
                      <Ico name="requirements" size={16} />
                      <span>Set requirements</span>
                    </button>
                  </div>
                )}
              </Suspense>
            </div>
            {l0 && design && <Outcome view={view} design={design} l0={l0} l1={l1} l2={l2} />}
          </>
        )}
      </aside>

      {/* ---- Stage: the engine, always on screen ---- */}
      <section className="stage" aria-label="3D engine" ref={stageRef}>
        <Suspense fallback={<div className="stage-empty"><div className="spinner" /></div>}>
          {view === "assembly" && l0 ? (
            <SystemAssembly />
          ) : l0 ? (
            <EngineViewer
              l0={l0}
              l2={l2}
              highlight={zones}
              selectionLabel={zones.length ? selectionLabel(view, design) : undefined}
              rightInset={showResults ? resultsCover.right : 0}
              bottomInset={showResults ? resultsCover.bottom : 0}
              topInset={showResults ? resultsCover.top : 0}
              onSpecSheet={() => setSheet(true)}
              inset={
                <>
                  <div className="inset-title"><b>Section A–A</b><span>{l2 ? `ε ${l2.area_ratio.toFixed(2)}` : ""}</span></div>
                  <BlueprintEngine l0={l0} l2={l2} lit={insetZones} si={si} onZone={(z) => select(zoneToView(z))} />
                </>
              }
            />
          ) : (
            <FirstRun onRequirements={() => void openRequirements()} onOpen={() => fileRef.current?.click()} />
          )}
        </Suspense>
        <FirstTips show={showTips && !!l0 && view !== "assembly"} onDone={dismissTips} />
      </section>

      {/* ---- Results: a window over the stage (outside it, so it can go full screen) ---- */}
      {showResults && l0 && (
        <FloatingWindow
          title={`${part.label} — results`}
          stage={stageRef}
          onClose={() => {
            const inside = !!document.activeElement?.closest(".float-win");
            setResultsOpen(false);
            if (inside) requestAnimationFrame(() => document.querySelector<HTMLElement>(".drill-head .qt-tool")?.focus());
          }}
          onCover={setResultsCover}
        >
          {chartTabs.length > 0 && design && activeChart && (
            <section className="res-charts" aria-label={`${part.label} along the axis`}>
              <div className="res-tabs" role="tablist" aria-label="Charts">
                {chartTabs.map(([id, label], i) => (
                  <button
                    key={id}
                    role="tab"
                    id={`chart-${id}`}
                    aria-selected={activeChart === id}
                    aria-controls="chart-panel"
                    tabIndex={activeChart === id ? 0 : -1}
                    onClick={() => setChartTab(id)}
                    onKeyDown={(e) => {
                      const n = chartTabs.length;
                      const j = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n : -1;
                      if (j < 0) return;
                      e.preventDefault();
                      setChartTab(chartTabs[j][0]);
                      (e.currentTarget.parentElement?.querySelector(`#chart-${chartTabs[j][0]}`) as HTMLElement | null)?.focus();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div id="chart-panel" role="tabpanel" aria-labelledby={`chart-${activeChart}`}>
                <Suspense fallback={<p className="muted" role="status">Loading…</p>}>
                  <PartResults view={view} tab={activeChart} design={design} l0={l0} l2={l2} height={170} />
                </Suspense>
              </div>
            </section>
          )}
          <div className="results-body" ref={resultsBodyRef} data-show="results">
            <Suspense fallback={<p className="muted" role="status">Loading…</p>}>
              <div className="page"><PartView view={view} perf={perfContent} /></div>
            </Suspense>
          </div>
        </FloatingWindow>
      )}

      {/* ---- Status line ---- */}
      <footer className="statusline">
        <span>{store.loading ? "Solving…" : configured ? solveText : "No design — set the requirements"}</span>
        {store.error && <span className="fail" role="alert" title={store.error}><b>Solver</b>: {store.error}</span>}
        {firstFail && (
          <button className="fail" onClick={() => setChecksOpen(true)}>
            <b>{issues!.failed} failed check{issues!.failed === 1 ? "" : "s"}</b> — {PART[AREA_VIEW[firstFail.area.toLowerCase()] ?? "analysis"]?.label ?? firstFail.area}: {firstFail.message}
          </button>
        )}
        {!firstFail && (issues?.warnings ?? 0) > 0 && <span className="warn">{issues!.warnings} {issues!.warnings === 1 ? "advisory" : "advisories"}</span>}
        <span className="end">{backend === "mock" ? <span className="mock">Offline mock — approximate numbers</span> : "Rust solver"}</span>
      </footer>

      {/* ---- Full-window views ---- */}
      {contourOpen && design && l0 && (
        <Suspense fallback={null}>
          <ContourView design={design} l0={l0} l1={l1} l2={l2} si={si} onClose={() => { setContourOpen(false); setView(treeReturn.current as View); }} />
        </Suspense>
      )}
      {reqOverlay && <RequirementsWindow mode="overlay" onClose={() => setReqOverlay(false)} />}
      {sheet && design && l0 && (
        <Suspense fallback={null}>
          <SpecSheet design={design} l0={l0} l1={l1} l2={l2} issues={issues} si={si} onClose={() => setSheet(false)} />
        </Suspense>
      )}

      {/* ---- Help ---- */}
      <dialog className="dialog" ref={helpRef} aria-labelledby="help-title">
        <div className="dialog-head">
          <h2 id="help-title">Propulsor</h2>
          <button className="act" onClick={() => helpRef.current?.close()} autoFocus aria-label="Close help">
            <Ico name="close" size={16} />
          </button>
        </div>
        <div className="dialog-body">
          <p>
            Open Requirements to set thrust, chamber pressure, mixture ratio and a propellant, then press Solve: the
            engine builds in the viewport. Pick a part in the list to edit its inputs on the left; its results open in a
            window over the viewport. Use Spec sheet on the viewport to present the engine as a board.
          </p>
          <table className="keys">
            <tbody>
              <tr><td>Move through the parts list</td><td><kbd>↑</kbd> <kbd>↓</kbd> · <kbd>←</kbd> <kbd>→</kbd> · <kbd>Enter</kbd></td></tr>
              <tr><td>Save design</td><td><kbd>Ctrl</kbd> <kbd>S</kbd></td></tr>
              <tr><td>Open design</td><td><kbd>Ctrl</kbd> <kbd>O</kbd></td></tr>
              <tr><td>Undo / redo</td><td><kbd>Ctrl</kbd> <kbd>Z</kbd> · <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd></td></tr>
              <tr><td>Close a window or full view</td><td><kbd>Esc</kbd></td></tr>
              <tr><td>Interface size: larger · smaller · reset</td><td><kbd>Ctrl</kbd> <kbd>+</kbd> · <kbd>Ctrl</kbd> <kbd>−</kbd> · <kbd>Ctrl</kbd> <kbd>0</kbd></td></tr>
              <tr><td>This help</td><td><kbd>F1</kbd></td></tr>
            </tbody>
          </table>
          <button
            className="qt-tool"
            style={{ marginTop: 12 }}
            onClick={() => {
              resetTips();
              setShowTips(true);
              helpRef.current?.close();
            }}
          >
            Show the first-run tips again
          </button>
        </div>
      </dialog>
    </div>
  );
}

/** On-model label for the selected part: its name and one telling fact. */
function selectionLabel(view: View, design: ReturnType<typeof useEngineStore.getState>["design"]): string {
  if (view === "cooling") {
    const n = design?.params?.["cooling.channel_count"];
    const m = design?.geometry?.cooling_jacket?.cooling_method ?? "regen";
    if (m !== "regen") return "Cooling · " + m;
    return n ? "Cooling jacket · " + n + " channels" : "Cooling jacket";
  }
  if (view === "perf") return "Nozzle";
  return PART[view].label;
}

