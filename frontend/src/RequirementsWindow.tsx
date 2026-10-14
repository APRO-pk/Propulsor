import { useEffect, useRef, useState } from "react";
import { useEngineStore } from "./store";
import { useBackendMode } from "./api";
import { DesignWizard } from "./DesignWizard";
import { BrandMark, Ico } from "./Icons";
import { channel, closeThisWindow, type WindowMessage } from "./windows";
import { useInert, useReturnFocus } from "./a11y";

/**
 * The Requirements editor: propellant, thrust, chamber pressure and mixture
 * ratio, step by step. Runs as its own window (or, when a window can't be
 * opened, full-window inside the app). Edits stay here until Solve, which
 * re-solves every tier and hands the design to the workbench.
 */
export function RequirementsWindow({ mode, onClose }: { mode: "window" | "overlay"; onClose?: () => void }) {
  const store = useEngineStore();
  const backend = useBackendMode();
  const [status, setStatus] = useState<string>("");
  const [solving, setSolving] = useState(false);
  const bc = useRef<BroadcastChannel | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // In the app, the editor covers the workbench: take focus, keep Tab inside it,
  // and hand focus back to whatever opened it.
  const overlay = mode === "overlay";
  useInert(".shell > :not(.reqwin)", overlay);
  useReturnFocus('button[aria-label="Requirements"]');
  useEffect(() => {
    if (overlay) titleRef.current?.focus();
  }, [overlay]);

  // A separate window reads the design the solver already holds for the workbench.
  useEffect(() => {
    if (mode !== "window") return;
    document.title = "Propulsor — Requirements";
    const ch = channel();
    bc.current = ch;
    void useEngineStore.getState().load();
    return () => ch?.close();
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode === "overlay") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const solve = async () => {
    setSolving(true);
    setStatus("");
    await store.load();
    const { design, error } = useEngineStore.getState();
    setSolving(false);
    // A failed solve keeps the editor open with the reason, so nothing entered is lost.
    if (error || !design) {
      setStatus(`Solve failed: ${error ?? "the solver returned no design"}. Your inputs are kept; check them and solve again.`);
      return;
    }
    if (mode === "window") {
      bc.current?.postMessage({ type: "solved" } satisfies WindowMessage);
      setStatus("Solved — the workbench now shows this engine.");
    } else {
      onClose?.();
    }
  };

  const configured =
    (store.design?.operating_point.thrust ?? 0) > 0 &&
    (store.design?.operating_point.chamber_pressure ?? 0) > 0 &&
    (store.design?.operating_point.mixture_ratio ?? 0) > 0 &&
    !!store.design?.propellant.pair &&
    store.design.propellant.pair !== "Unset";

  return (
    <div className={`reqwin ${mode}`} role={mode === "overlay" ? "dialog" : undefined} aria-modal={mode === "overlay" || undefined} aria-labelledby="reqwin-title">
      <header className="reqwin-head">
        <BrandMark size={18} />
        <h1 id="reqwin-title" ref={titleRef} tabIndex={-1}>Requirements</h1>
        <span className="reqwin-rev">{store.design?.meta.name || "Untitled design"}</span>
        {backend === "mock" && <span className="reqwin-mock">Offline mock</span>}
      </header>
      <div className="reqwin-body">
        <DesignWizard />
      </div>
      <footer className="reqwin-foot">
        <span className={`reqwin-status${status.startsWith("Solve failed") ? " is-error" : ""}`} role="status">
          {status || (configured ? "Edits are kept here until you solve." : "Set thrust, chamber pressure, mixture ratio and a propellant, then solve.")}
        </span>
        <button className="qt-tool" onClick={() => (mode === "window" ? void closeThisWindow() : onClose?.())}>
          {mode === "window" ? "Close" : "Back to workbench"}
        </button>
        <button className="act act-solve" onClick={solve} disabled={!configured || solving}>
          <Ico name="solve" size={16} />
          <span>{solving ? "Solving…" : "Solve"}</span>
        </button>
      </footer>
    </div>
  );
}
