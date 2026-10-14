/**
 * The one message between the Requirements window and the workbench. Both
 * windows share the solver's design, so "solved" only tells the workbench to
 * reload it. (In a browser, Requirements open inside the app instead.)
 */
export type WindowMessage = { type: "solved" };

export const channel = (): BroadcastChannel | null => (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("propulsor"));

const zoomLevel = () => {
  try {
    const v = Number(localStorage.getItem("propulsor.zoom"));
    return v >= 0.8 && v <= 1.5 ? v : 1;
  } catch {
    return 1;
  }
};

export const isRequirementsWindow = () => new URLSearchParams(window.location.search).get("window") === "requirements";

/**
 * Opens (or focuses) the separate Requirements window in the desktop app.
 * Resolves false everywhere else (a browser, or a desktop host that refuses),
 * so the caller opens the in-app editor instead: a browser pop-up is just
 * another tab, and closing it strands the user outside the workbench.
 */
export async function openRequirementsWindow(): Promise<boolean> {
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel("requirements");
      if (existing) {
        await existing.setFocus();
        return true;
      }
      const w = new WebviewWindow("requirements", {
        url: "index.html?window=requirements",
        title: "Propulsor — Requirements",
        // Logical size at 100%; scaled by the interface zoom so the editor still fits its content.
        width: Math.round(780 * zoomLevel()),
        height: Math.round(880 * zoomLevel()),
        minWidth: 620,
        minHeight: 600,
      });
      return await new Promise<boolean>((resolve) => {
        void w.once("tauri://created", () => resolve(true));
        void w.once("tauri://error", () => resolve(false));
      });
    } catch {
      return false;
    }
  }
  return false;
}

/** Closes this window (the Requirements window). */
export async function closeThisWindow() {
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      await getCurrentWebviewWindow().close();
      return;
    } catch {
      /* fall through */
    }
  }
  window.close();
  // A tab the browser won't close (one the user opened by URL) goes back to the workbench instead.
  setTimeout(() => {
    if (!window.closed) window.location.href = window.location.pathname;
  }, 150);
}
