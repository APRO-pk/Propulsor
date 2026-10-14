import { useEffect, useState } from "react";
import { Ico } from "./Icons";
import { PRESETS, applyPreset } from "./presets";
import { useEngineStore } from "./store";

const TIPS_KEY = "propulsor.firstTips";

/**
 * The stage before any engine exists: what the four requirements do, the two
 * ways in (set them, or open a saved design), and the example engines, each
 * of which loads and solves straight away so the engine lights up.
 */
export function FirstRun({ onRequirements, onOpen }: { onRequirements: () => void; onOpen: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const start = async (p: (typeof PRESETS)[number]) => {
    setBusy(p.name);
    await applyPreset(p);
    await useEngineStore.getState().load();
    setBusy(null);
  };
  return (
    <div className="stage-empty first-run">
      <svg width="260" height="104" viewBox="0 0 220 88" aria-hidden="true">
        <path className="bp-ghost" d="M16 22h70c14 0 18 16 32 16s30-9 86-20M16 66h70c14 0 18-16 32-16s30 9 86 20M16 22v44" />
        <path className="bp-center" d="M6 44h208" />
      </svg>
      <h2>Design a liquid rocket engine</h2>
      <p>
        Four requirements build the whole engine: propellant, thrust, chamber pressure and mixture ratio. Every part
        sizes itself from them, and you can change any assumption after.
      </p>
      <div className="first-run-actions">
        <button className="act act-solve" onClick={onRequirements}>
          <Ico name="requirements" size={16} />
          <span>Set requirements</span>
        </button>
        <button className="qt-tool" onClick={onOpen}>
          <Ico name="open" size={16} />
          <span>Open a saved design</span>
        </button>
      </div>
      <div className="first-run-examples" role="group" aria-labelledby="examples-caption">
        <span id="examples-caption">Or start from an example, solved straight away</span>
        <div>
          {PRESETS.map((p) => (
            <button key={p.name} className="qt-tool" onClick={() => void start(p)} disabled={!!busy} aria-busy={busy === p.name}>
              {busy === p.name ? "Solving…" : p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Whether the first-run tips have been seen (or dismissed). */
export const tipsSeen = () => {
  try {
    return localStorage.getItem(TIPS_KEY) === "1";
  } catch {
    return false;
  }
};
export const resetTips = () => {
  try {
    localStorage.removeItem(TIPS_KEY);
  } catch {
    /* tips will show anyway this session */
  }
};

/**
 * Three things to try, shown once after the first engine appears. Dismissed
 * by "Got it" or by opening a part (the first tip done); replayable from Help.
 */
export function FirstTips({ show, onDone }: { show: boolean; onDone: () => void }) {
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, onDone]);
  if (!show) return null;
  return (
    <section className="stage-tip" aria-labelledby="tips-title">
      <h2 id="tips-title">Your engine is solved. Next:</h2>
      <ol>
        <li>
          <b>Pick a part</b> on the left: its inputs open there, its results beside the engine.
        </li>
        <li>
          <b>Drag Ambient</b> to watch the exhaust change from sea level to vacuum.
        </li>
        <li>
          <b>Spec sheet</b> presents the engine as a board you can export.
        </li>
      </ol>
      <button className="qt-tool" onClick={onDone}>
        Got it
      </button>
    </section>
  );
}

export function markTipsSeen() {
  try {
    localStorage.setItem(TIPS_KEY, "1");
  } catch {
    /* shown again next session */
  }
}
