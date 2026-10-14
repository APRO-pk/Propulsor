import { lazy, Suspense, useEffect } from "react";
import type { EngineDesignDto, L0ResultDto, L1ResultDto, L2ResultDto } from "./api";
import { BlueprintEngine } from "./BlueprintEngine";
import { Outcome } from "./Outcome";
import { Ico } from "./Icons";
import { useInert, useReturnFocus } from "./a11y";

const PartResults = lazy(() => import("./PartResults").then((m) => ({ default: m.PartResults })));

/**
 * The contour, full window: the dimensioned section and the radius profile along the axis at a size that reads. Esc or Back returns to
 * the workbench.
 */
export function ContourView({ design, l0, l1, l2, si, onClose }: { design: EngineDesignDto; l0: L0ResultDto; l1: L1ResultDto | null; l2: L2ResultDto | null; si: boolean; onClose: () => void }) {
  // It covers the workbench: nothing behind it takes focus, and focus returns to the parts list.
  useInert(".shell > .left, .shell > .stage, .shell > .float-win", true);
  useReturnFocus('[role="treeitem"][aria-selected="true"]');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fullview" role="region" aria-labelledby="contour-title">
      <header className="fullview-head">
        <button className="act" onClick={onClose} autoFocus>
          <Ico name="chevL" size={16} />
          <span>Workbench</span>
        </button>
        <h1 id="contour-title">Contour</h1>
        <p>Chamber, throat and nozzle: the designed contour with its dimensions.</p>
      </header>
      <div className="fullview-body contour-grid">
        <section className="fullview-panel wide">
          <h2 className="fig-title">Section A–A</h2>
          <div className="contour-drawing">
            <BlueprintEngine l0={l0} l2={l2} lit={[]} si={si} onZone={() => {}} />
          </div>
        </section>
        <section className="fullview-panel wide">
          <h2 className="fig-title">Radius along the axis</h2>
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <PartResults view="section" tab="contour" design={design} l0={l0} l2={l2} height={260} />
          </Suspense>
        </section>
        <aside className="fullview-side">
          <Outcome view="section" design={design} l0={l0} l1={l1} l2={l2} />
        </aside>
      </div>
    </div>
  );
}
