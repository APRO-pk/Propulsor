/**
 * Interface size for the desktop app: Ctrl/⌘ + and − step the webview zoom,
 * Ctrl/⌘ 0 resets it, and the level is remembered for every window. In a
 * browser the browser's own zoom already does this, so nothing is installed.
 */
const KEY = "propulsor.zoom";
const STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.5];

const read = () => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return STEPS.includes(v) ? v : 1;
  } catch {
    return 1;
  }
};

// Zoom changes apply the latest requested level, one call at a time. A reply
// that never comes back (it can happen while another window opens or closes)
// times out instead of blocking every later change.
let target = 1;
let running = false;
const settle = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
function apply(level: number) {
  target = level;
  if (running) return;
  running = true;
  void (async () => {
    let applied: number;
    do {
      applied = target;
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        await settle(getCurrentWebview().setZoom(applied), 400);
      } catch {
        /* host refused: the interface stays at its current size */
      }
    } while (applied !== target);
    running = false;
  })();
}

export function installZoom() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  let level = read();
  // Always apply at startup: WebView2 keeps its own per-host zoom, which could disagree with the saved level.
  apply(level);
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const i = STEPS.indexOf(level);
    const next =
      e.key === "=" || e.key === "+" ? STEPS[Math.min(STEPS.length - 1, i + 1)] : e.key === "-" || e.key === "_" ? STEPS[Math.max(0, i - 1)] : e.key === "0" ? 1 : null;
    if (next === null) return;
    e.preventDefault();
    level = next;
    apply(level);
    try {
      localStorage.setItem(KEY, String(level));
    } catch {
      /* not remembered this time */
    }
  });
}
