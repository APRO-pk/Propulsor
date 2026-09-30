import { useEffect, useRef, useState } from "react";
import { useEngineStore } from "./store";
import { downloadText } from "./Cooling";
import { CrossSection } from "./CrossSection";
import { PerfMapChart } from "./PerfMapChart";
import { EngineViewer } from "./EngineViewer";
import { DesignWizard } from "./DesignWizard";
import { Cooling } from "./Cooling";
import { Turbopumps } from "./Turbopumps";
import { Analysis } from "./Analysis";
import { FeedSystem } from "./FeedSystem";
import { SystemAssembly } from "./SystemAssembly";
import { Dashboard } from "./Dashboard";
import { Trades } from "./Trades";
import { Blades } from "./Blades";
import { Validation } from "./Validation";
import { Control } from "./Control";

const IN = 0.0254;
const KG_TO_LB = 1 / 0.45359237;
const PSI = 6894.76;

type Tab = "design" | "dashboard" | "model" | "section" | "cooling" | "turbo" | "blades" | "analysis" | "validation" | "feed" | "control" | "assembly" | "trades" | "perf";
const TABS: [Tab, string][] = [
  ["design", "Design"],
  ["dashboard", "Dashboard"],
  ["model", "3D Model"],
  ["section", "Cross-section"],
  ["cooling", "Cooling"],
  ["turbo", "Turbopumps"],
  ["blades", "Blades"],
  ["analysis", "Analysis"],
  ["validation", "Validation"],
  ["feed", "Feed System"],
  ["control", "Control"],
  ["assembly", "Assembly"],
  ["trades", "Trades"],
  ["perf", "Performance"],
];

export default function App() {
  const store = useEngineStore();
  const [tab, setTab] = useState<Tab>("design");
  const [si, setSi] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    store.load();
    store.loadPerfMap();
  }, []);

  const { l0, l1, l2, design, perfMap } = store;

  const configured =
    (design?.operating_point.thrust ?? 0) > 0 &&
    (design?.operating_point.chamber_pressure ?? 0) > 0 &&
    (design?.operating_point.mixture_ratio ?? 0) > 0 &&
    !!design?.propellant.pair &&
    design.propellant.pair !== "Unset";

  const newDesign = async () => {
    if (configured && !window.confirm("Start a new design? This clears the current one.")) return;
    await store.reset();
    await store.loadPerfMap();
    setTab("design");
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

  const len = (m: number) => (si ? `${(m * 1000).toFixed(1)} mm` : `${(m / IN).toFixed(3)} in`);
  const flow = (k: number) => (si ? `${k.toFixed(3)} kg/s` : `${(k * KG_TO_LB).toFixed(3)} lb/s`);
  const press = (pa: number) => (si ? `${(pa / 1e5).toFixed(2)} bar` : `${(pa / PSI).toFixed(0)} psi`);

  const solved = (design?.caches ?? []).filter((c) => c.status === "Solved").length;

  return (
    <div className="qt-window">
      {/* Menu bar */}
      <div className="qt-menubar">
        <div className="qt-menu" title="Save the current design to a JSON file" onClick={saveDesign}>
          File
        </div>
        <div className="qt-menu" title="Open a saved design" onClick={() => fileRef.current?.click()}>
          Open
        </div>
        <div className="qt-menu" title="Re-resolve all tiers" onClick={() => store.load()}>
          Solve
        </div>
        <div className="qt-menu" title="New (clear) design" onClick={newDesign}>
          New
        </div>
        <div
          className="qt-menu"
          title="About Propulsor"
          onClick={() =>
            window.alert(
              "PROPULSOR — Liquid Engine Designer\n\nStart from a blank design: enter thrust, chamber pressure, mixture ratio and a propellant in the Design tab, and every tier and view builds from your inputs.",
            )
          }
        >
          Help
        </div>
        <div className="spacer" />
        <div className="title">PROPULSOR — Liquid Engine Designer</div>
      </div>

      {/* Hidden file input for Open */}
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={openFile} />

      {/* Toolbar */}
      <div className="qt-toolbar">
        <button className="qt-tool" onClick={newDesign} title="Clear the design and start over">
          <span className="ico">📄</span> New
        </button>
        <button className="qt-tool" onClick={() => fileRef.current?.click()} title="Open a saved design JSON">
          <span className="ico">📂</span> Open
        </button>
        <button className="qt-tool" onClick={saveDesign} disabled={!design} title="Save the design to JSON">
          <span className="ico">💾</span> Save
        </button>
        <div className="qt-sep" />
        <button className="qt-tool" onClick={() => store.load()}>
          <span className="ico">⚙</span> Resolve
        </button>
        <div className="qt-sep" />
        <button className={`qt-tool ${si ? "on" : ""}`} onClick={() => setSi(true)}>
          SI
        </button>
        <button className={`qt-tool ${!si ? "on" : ""}`} onClick={() => setSi(false)}>
          Imperial
        </button>
        <div className="spacer" style={{ flex: 1 }} />
      </div>

      {/* Main: left dock | center | right dock */}
      <div className="qt-main">
        {/* Left dock — design tree / inputs */}
        <div className="qt-dock left">
          <div className="qt-dock-title">Design</div>
          <div className="qt-dock-body">
            <fieldset className="qt-groupbox">
              <legend>Operating point</legend>
              <label className="qt-field">
                <span>Thrust (N)</span>
                <ThrustField
                  value={design?.operating_point.thrust ?? 0}
                  onCommit={(n) => store.setThrust(n)}
                />
              </label>
              <div className="qt-field">
                <span>Chamber pressure</span>
                <b>{press(design?.operating_point.chamber_pressure ?? 0)}</b>
              </div>
              <div className="qt-field">
                <span>Mixture ratio O/F</span>
                <b>{design?.operating_point.mixture_ratio ?? "—"}</b>
              </div>
              <div className="qt-field">
                <span>Propellant</span>
                <b>{design?.propellant.pair && design.propellant.pair !== "Unset" ? design.propellant.pair : "—"}</b>
              </div>
            </fieldset>

            <fieldset className="qt-groupbox">
              <legend>Fidelity tiers</legend>
              {(design?.caches ?? []).length === 0 && <p className="muted">No solve yet.</p>}
              {(design?.caches ?? []).map((c) => (
                <div key={c.tier} className="qt-field">
                  <span>{c.tier}</span>
                  <span className={`qt-badge ${c.status.toLowerCase()}`}>{c.status}</span>
                </div>
              ))}
            </fieldset>
          </div>
        </div>

        {/* Center — tabbed viewer */}
        <div className="qt-center">
          <div className="qt-tabbar">
            {TABS.map(([id, label]) => (
              <div key={id} className={`qt-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
                {label}
              </div>
            ))}
          </div>

          {tab === "design" && (
            <div className="qt-tabpage fill">
              <DesignWizard />
            </div>
          )}

          {/* Nothing is pre-computed: the other tabs come alive only once the
              design resolves (thrust, Pc, O/F and propellant are entered). */}
          {tab !== "design" && !l0 && (
            <div className="qt-tabpage">
              <div style={{ maxWidth: 460, margin: "48px auto", textAlign: "center" }}>
                <h3 style={{ margin: "0 0 8px" }}>Start your design</h3>
                <p className="muted">
                  This tab has nothing yet — Propulsor doesn't ship a pre-made engine. Enter your
                  requirements (thrust, chamber pressure, mixture ratio and propellant) in the Design
                  tab, and every tab and 3D view builds itself from your inputs.
                </p>
                <button className="qt-tool" style={{ marginTop: 8 }} onClick={() => setTab("design")}>Go to Design →</button>
              </div>
            </div>
          )}

          {tab === "dashboard" && l0 && (
            <div className="qt-tabpage">
              <Dashboard />
            </div>
          )}

          {tab === "cooling" && l0 && (
            <div className="qt-tabpage">
              <Cooling />
            </div>
          )}

          {tab === "turbo" && l0 && (
            <div className="qt-tabpage">
              <Turbopumps />
            </div>
          )}

          {tab === "blades" && l0 && (
            <div className="qt-tabpage">
              <Blades />
            </div>
          )}

          {tab === "analysis" && l0 && (
            <div className="qt-tabpage">
              <Analysis />
            </div>
          )}

          {tab === "validation" && l0 && (
            <div className="qt-tabpage">
              <Validation />
            </div>
          )}

          {tab === "feed" && l0 && (
            <div className="qt-tabpage">
              <FeedSystem />
            </div>
          )}

          {tab === "control" && l0 && (
            <div className="qt-tabpage">
              <Control />
            </div>
          )}

          {tab === "assembly" && l0 && (
            <div className="qt-tabpage fill">
              <SystemAssembly />
            </div>
          )}

          {tab === "trades" && l0 && (
            <div className="qt-tabpage">
              <Trades />
            </div>
          )}

          {tab === "model" && l0 && (
            <div className="qt-tabpage fill">
              <EngineViewer l0={l0} l2={l2} />
            </div>
          )}

          {tab === "section" && l0 && (
            <div className="qt-tabpage">
              <div className="qt-canvaswrap">
                <p className="qt-caption">Engine assembly cross-section (chamber · throat · nozzle)</p>
                <CrossSection l0={l0} />
              </div>
            </div>
          )}

          {tab === "perf" && l0 && (
            <div className="qt-tabpage">
              {perfMap ? (
                <div className="qt-canvaswrap">
                  <p className="qt-caption">Steady-state specific impulse vs altitude</p>
                  <PerfMapChart map={perfMap} />
                </div>
              ) : (
                <p className="muted">No performance map.</p>
              )}
            </div>
          )}
        </div>

        {/* Right dock — properties */}
        <div className="qt-dock right">
          <div className="qt-dock-title">Properties</div>
          <div className="qt-dock-body">
            {store.loading && <p className="muted">Loading…</p>}
            {store.error && <p className="err">IPC error: {store.error}</p>}

            {l0 && (
              <PropTable
                title="L0 · Analytical sizing"
                rows={[
                  ["Total flow", flow(l0.total_flow)],
                  ["Throat dia.", len(l0.throat_diameter)],
                  ["Exit dia.", len(l0.exit_diameter)],
                  ["Chamber dia.", len(l0.chamber_diameter)],
                  ["Area ratio Aₑ/Aₜ", l0.area_ratio.toFixed(2)],
                  ["Isp", `${l0.isp_s.toFixed(0)} s`],
                  ["c*", `${l0.c_star_m_s.toFixed(0)} m/s`],
                  ["Wall thickness", len(l0.wall_thickness)],
                ]}
              />
            )}
            {l1 && (
              <PropTable
                title="L1 · Thermochemistry"
                rows={[
                  ["T_c", `${l1.tc_k.toFixed(0)} K`],
                  ["γ", l1.gamma.toFixed(3)],
                  ["MW", `${l1.mean_molecular_weight.toFixed(2)} g/mol`],
                  ["c*", `${l1.c_star_m_s.toFixed(0)} m/s`],
                  ["Isp vac", `${l1.isp_vacuum_s.toFixed(0)} s`],
                ]}
              />
            )}
            {l2 && (
              <PropTable
                title="L2 · Nozzle contour"
                rows={[
                  ["Area ratio", l2.area_ratio.toFixed(2)],
                  ["Exit Mach", l2.exit_mach.toFixed(2)],
                  ["Exit dia.", len(l2.exit_diameter_m)],
                  ["Divergence λ", l2.divergence_correction.toFixed(3)],
                  ["Isp", `${l2.isp_s.toFixed(0)} s`],
                ]}
              />
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="qt-statusbar">
        <div className="cell">
          <b>{design?.meta.name ?? "—"}</b>
        </div>
        <div className="cell">rev {design?.meta.revision ?? 0}</div>
        <div className="cell">{si ? "SI" : "Imperial"}</div>
        <div className="cell grow">
          {solved} tier{solved === 1 ? "" : "s"} solved
        </div>
        <div className="cell">{configured ? "design resolved" : "no design — enter requirements"}</div>
      </div>
    </div>
  );
}

/** Number field that commits on blur / Enter (not on every keystroke), so a
 *  full re-resolve fires once per edit. Re-syncs when the design changes. */
function ThrustField({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      step={10}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function PropTable({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <table className="qt-proptable" style={{ marginBottom: 12 }}>
      <thead>
        <tr>
          <th colSpan={2}>{title}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="val">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
