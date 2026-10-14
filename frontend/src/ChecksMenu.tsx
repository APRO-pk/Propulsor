import { useEffect, useRef } from "react";
import type { IssuesReportDto } from "./api";
import { Ico } from "./Icons";

type Issue = IssuesReportDto["issues"][number];

/**
 * Design checks as notifications: a bell in the top bar carrying the count
 * (red when something fails, amber for advisories), opening a list of the
 * findings. Each finding links to the part it concerns.
 */
export function ChecksMenu({
  issues,
  open,
  onOpenChange,
  partOf,
  onGoTo,
  ready,
  failedToLoad,
  onRetry,
}: {
  issues: IssuesReportDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The part a finding's area belongs to: [view id, label], if it maps to one. */
  partOf: (it: Issue) => [string, string] | null;
  onGoTo: (view: string) => void;
  /** False until the design has solved; the list says so instead of "all clear". */
  ready: boolean;
  /** The checks could not be fetched: never report that as "all pass". */
  failedToLoad: boolean;
  onRetry: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  // Opening moves focus into the list so it is read and reachable at once.
  useEffect(() => {
    if (open) headRef.current?.focus();
  }, [open]);
  const list = issues?.issues ?? [];
  const failed = issues?.failed ?? 0;
  const warnings = issues?.warnings ?? 0;
  const count = failed || warnings;
  const tone = failedToLoad ? "warn" : failed ? "fail" : warnings ? "warn" : "";

  // Close on Esc or a click anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
        wrap.current?.querySelector<HTMLButtonElement>(".checks-btn")?.focus();
      }
    };
    // Tabbing out of the list closes it, like any menu.
    const onFocus = (e: FocusEvent) => {
      if (!wrap.current?.contains(e.target as Node)) onOpenChange(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focusin", onFocus);
    };
  }, [open, onOpenChange]);

  const summary = !ready
    ? "No design yet"
    : failedToLoad
      ? "Checks couldn't run"
      : !issues
        ? "Running checks…"
        : failed
      ? `${failed} failed check${failed === 1 ? "" : "s"}`
      : warnings
        ? `${warnings} ${warnings === 1 ? "advisory" : "advisories"}`
        : "All checks pass";

  return (
    <div className="checks-menu" ref={wrap}>
      <button
        className={`act checks-btn${open ? " on" : ""}`}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="checks-pop"
        aria-label={`Checks: ${summary}`}
        title={`Checks — ${summary}`}
      >
        <Ico name="bell" size={16} />
        {ready && failedToLoad && <span className="checks-count warn" aria-hidden="true">!</span>}
        {ready && !failedToLoad && count > 0 && <span className={`checks-count ${tone}`}>{count}</span>}
      </button>
      {open && (
        <div className="checks-pop" id="checks-pop" role="dialog" aria-labelledby="checks-pop-title">
          <div className="checks-pop-head">
            <h2 id="checks-pop-title" ref={headRef} tabIndex={-1}>Checks</h2>
            <span className={tone ? `checks-sum ${tone}` : "checks-sum ok"}>{summary}</span>
          </div>
          {!ready ? (
            <p className="muted checks-pop-empty">Checks run once the requirements are solved.</p>
          ) : failedToLoad ? (
            <div className="checks-pop-empty">
              <p className="checks-err">The solver didn't return its checks, so margins and redlines are unverified for this revision.</p>
              <button className="qt-tool" onClick={onRetry}>Run checks again</button>
            </div>
          ) : !issues ? (
            <p className="muted checks-pop-empty" role="status">Running checks…</p>
          ) : list.length === 0 ? (
            <p className="checks-ok checks-pop-empty">No failed checks or advisories for this design.</p>
          ) : (
            <ul className="checks-pop-list">
              {list.map((it, i) => {
                const target = partOf(it);
                return (
                  <li key={i} className={it.severity === "fail" ? "is-fail" : "is-warn"}>
                    <span className={`tag ${it.severity === "fail" ? "fail" : "warn"}`}>{it.severity === "fail" ? "FAIL" : "ADVISE"}</span>
                    <div>
                      {target ? (
                        <button
                          className="area-link"
                          onClick={() => {
                            onGoTo(target[0]);
                            onOpenChange(false);
                          }}
                        >
                          {target[1]}
                        </button>
                      ) : (
                        <span className="muted">{it.area}</span>
                      )}
                      <p>{it.message}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
