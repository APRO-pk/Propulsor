import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { Ico } from "./Icons";
import { useInert } from "./a11y";

type Rect = { x: number; y: number; w: number; h: number };
/** normal: floats over the stage · min: a title bar docked bottom-right · max: fills the stage · full: fills the workbench. */
type WinState = "normal" | "min" | "max" | "full";
type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_W = 320;
/** Below this stage width the window docks along the bottom instead of the right. */
const NARROW = 640;
const MIN_H = 200;
const SIZE_KEY = "propulsor.resultsWindow";
const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const savedSize = (): { w: number; h: number } | null => {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "null");
    return v && v.w > 0 && v.h > 0 ? v : null;
  } catch {
    return null;
  }
};
const saveSize = (w: number, h: number) => {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ w: Math.round(w), h: Math.round(h) }));
  } catch {
    /* storage unavailable: the size lasts this session */
  }
};

/**
 * A window floating over the 3D stage (non-modal: the engine stays interactive
 * around it). Drag it by the title bar, resize it from any edge or corner,
 * minimise it to a title bar, maximise it over the stage (or double-click the
 * title), or take it full screen over the workbench. Esc steps back out of
 * full screen or maximised, then closes. The size you choose is remembered.
 * `onCover` reports how much of the stage's right side the window covers, so
 * the engine can be framed in the rest.
 *
 * It renders at the shell level (the stage's container queries would trap a
 * full-screen window), and is placed in the coordinates of `stage`.
 */
export function FloatingWindow({
  title,
  stage,
  onClose,
  onCover,
  children,
}: {
  title: string;
  stage: RefObject<HTMLElement>;
  onClose: () => void;
  onCover?: (cover: { right: number; bottom: number; top: number }) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [state, setState] = useState<WinState>("normal");
  const gesture = useRef<{ kind: "move" | Edge; id: number; px: number; py: number; start: Rect } | null>(null);
  const coverRef = useRef(onCover);
  coverRef.current = onCover;

  const host = () => stage.current;
  // Follow the stage when the app window resizes.
  const [, setTick] = useState(0);
  useEffect(() => {
    const h = stage.current;
    if (!h) return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(h);
    return () => ro.disconnect();
  }, [stage]);

  // The stage area the window may use: below the stage toolbar when docked over it.
  const toolbarBottom = (h: HTMLElement) => {
    const hb = h.getBoundingClientRect();
    const tools = [...h.querySelectorAll(".viewer3d-toolbar > *")].map((t) => t.getBoundingClientRect()).filter((r) => r.width > 0);
    if (!tools.length) return { right: 0, bottom: 0 };
    return { right: Math.max(...tools.map((r) => r.right)) - hb.left, bottom: Math.max(...tools.map((r) => r.bottom)) - hb.top };
  };

  // Open docked to the stage's right edge, at the remembered size or a roomy default.
  useEffect(() => {
    const h = host();
    if (!h) return;
    const W = h.clientWidth;
    const H = h.clientHeight;
    const tb0 = toolbarBottom(h);
    // A narrow stage has no room beside the window: dock it along the bottom,
    // full width, and keep the engine in the band above it.
    if (W < NARROW) {
      // Leave the engine a band of at least 120 px under the stage toolbar.
      const y = Math.round(Math.min(H * 0.62, Math.max(tb0.bottom + 120, H * 0.42)));
      setRect({ x: 8, y, w: W - 16, h: Math.max(MIN_H, H - y - 8) });
      return;
    }
    const size = savedSize();
    const w = Math.min(W - 24, Math.max(MIN_W, size?.w ?? Math.min(560, W * 0.48)));
    const x = Math.max(12, W - w - 12);
    const tb = toolbarBottom(h);
    const y = x < tb.right + 8 ? Math.round(tb.bottom + 8) : 12;
    const hgt = Math.min(H - y - 12, Math.max(MIN_H, size?.h ?? 560));
    setRect({ x, y, w, h: hgt });
  }, []);

  // Report the covered width: only a normal window on the right half shares the stage.
  useEffect(() => {
    const h = host();
    if (!rect || !h || gesture.current) return;
    const W = h.clientWidth;
    const H = h.clientHeight;
    // Docked along the bottom (spanning most of the width, in the lower part): the engine sits above it.
    const onBottom = rect.w > W * 0.75 && rect.y > H * 0.25;
    // Anchored to the right side (its right edge in the stage's right third), however wide.
    const onRight = !onBottom && rect.x + rect.w > W * 0.67 && rect.x > 0;
    const none = { right: 0, bottom: 0, top: 0 };
    // Docked at the bottom, the stage toolbar above also bounds the engine's band.
    coverRef.current?.(
      state !== "normal" ? none : onBottom ? { right: 0, bottom: H - rect.y + 8, top: toolbarBottom(h).bottom } : onRight ? { right: W - rect.x + 12, bottom: 0, top: 0 } : none,
    );
  }, [rect, state]);
  useEffect(() => () => coverRef.current?.({ right: 0, bottom: 0, top: 0 }), []);

  // What the window covers stops taking focus: the stage when it fills it, the workbench when full screen.
  useInert(".shell > .stage", state === "max" || state === "full");
  useInert(".shell > .left", state === "full");
  // Switching windows mid-drag ends the drag rather than leaving it stuck.
  useEffect(() => {
    const stop = () => {
      if (gesture.current) end();
    };
    window.addEventListener("blur", stop);
    return () => window.removeEventListener("blur", stop);
  });

  const begin = (kind: "move" | Edge) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !rect || state !== "normal") return;
    if (kind === "move" && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    if (gesture.current) return; // a second pointer never takes over a drag in progress
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture.current = { kind, id: e.pointerId, px: e.clientX, py: e.clientY, start: rect };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    const h = host();
    if (!g || !h || e.pointerId !== g.id) return;
    const W = h.clientWidth;
    const H = h.clientHeight;
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;
    let { x, y, w, h: hh } = g.start;
    if (g.kind === "move") {
      x = Math.min(Math.max(0, x + dx), W - 80);
      y = Math.min(Math.max(0, y + dy), H - 40);
    } else {
      if (g.kind.includes("e")) w = Math.min(Math.max(MIN_W, w + dx), W - x);
      if (g.kind.includes("s")) hh = Math.min(Math.max(MIN_H, hh + dy), H - y);
      if (g.kind.includes("w")) {
        const nx = Math.min(Math.max(0, x + dx), x + w - MIN_W);
        w += x - nx;
        x = nx;
      }
      if (g.kind.includes("n")) {
        const ny = Math.min(Math.max(0, y + dy), y + hh - MIN_H);
        hh += y - ny;
        y = ny;
      }
    }
    setRect({ x, y, w, h: hh });
  };
  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !rect) return;
    if (g.kind !== "move") saveSize(rect.w, rect.h);
    setRect({ ...rect }); // re-report the cover once the gesture ends
  };

  const toggle = (s: WinState) => setState((cur) => (cur === s ? "normal" : s));

  // Keyboard alternative to dragging: arrows move the window, Shift+arrows resize it.
  const nudge = (e: React.KeyboardEvent<HTMLElement>) => {
    const h = host();
    if (!rect || !h || state !== "normal" || e.target !== e.currentTarget) return;
    const step = e.altKey ? 4 : 24;
    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const W = h.clientWidth;
    const H = h.clientHeight;
    const next = e.shiftKey
      ? { ...rect, w: Math.min(Math.max(MIN_W, rect.w + dx), W - rect.x), h: Math.min(Math.max(MIN_H, rect.h + dy), H - rect.y) }
      : { ...rect, x: Math.min(Math.max(0, rect.x + dx), W - 80), y: Math.min(Math.max(0, rect.y + dy), H - 40) };
    setRect(next);
    if (e.shiftKey) saveSize(next.w, next.h);
  };

  // Stage coordinates → shell coordinates (the window's containing block).
  const h = stage.current;
  const ox = h?.offsetLeft ?? 0;
  const oy = h?.offsetTop ?? 0;
  const SW = h?.clientWidth ?? 0;
  const SH = h?.clientHeight ?? 0;
  const style =
    state === "full"
      ? undefined
      : state === "max"
        ? { left: ox + 8, top: oy + 8, width: SW - 16, height: SH - 16 }
        : state === "min"
          ? { left: ox + SW - 312, top: oy + SH - 50, width: 300 }
          : rect
            ? { left: ox + Math.min(rect.x, Math.max(0, SW - 80)), top: oy + Math.min(rect.y, Math.max(0, SH - 40)), width: Math.min(rect.w, SW), height: Math.min(rect.h, SH) }
            : { visibility: "hidden" as const };

  return (
    <div
      ref={ref}
      className={`float-win is-${state}`}
      role="dialog"
      aria-label={title}
      style={style}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (state === "full" || state === "max") setState("normal");
        else onClose();
      }}
    >
      <div
        className="float-win-head"
        role="group"
        aria-roledescription="title bar"
        tabIndex={state === "normal" ? 0 : -1}
        aria-label={`${title}. Arrow keys move the window; Shift and arrow keys resize it.`}
        onKeyDown={nudge}
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button")) toggle("max");
        }}
      >
        <h2>{title}</h2>
        <div className="float-win-ctl">
          <button className="act" onClick={() => toggle("min")} aria-label={state === "min" ? `Restore ${title}` : `Minimise ${title}`} title={state === "min" ? "Restore" : "Minimise"}>
            <Ico name={state === "min" ? "chevUp" : "minimize"} size={14} />
          </button>
          <button className="act" onClick={() => toggle("max")} aria-label={state === "max" ? "Restore size" : "Fill the stage"} title={state === "max" ? "Restore size" : "Fill the stage (double-click the title)"} aria-pressed={state === "max"}>
            <Ico name={state === "max" ? "restoreWin" : "maximize"} size={14} />
          </button>
          <button className="act" onClick={() => toggle("full")} aria-label={state === "full" ? "Exit full screen" : "Full screen"} title={state === "full" ? "Exit full screen (Esc)" : "Full screen"} aria-pressed={state === "full"}>
            <Ico name={state === "full" ? "restore" : "expand"} size={14} />
          </button>
          <button className="act" onClick={onClose} aria-label={`Close ${title}`} title="Close (Esc)">
            <Ico name="close" size={14} />
          </button>
        </div>
      </div>
      <div className="float-win-body" hidden={state === "min"}>
        {children}
      </div>
      {state === "normal" &&
        EDGES.map((d) => (
          <div key={d} className={`float-win-grip g-${d}`} aria-hidden="true" onPointerDown={begin(d)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} />
        ))}
    </div>
  );
}
