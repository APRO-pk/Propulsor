import { useEffect } from "react";

/**
 * Makes the elements matching `selector` inert (unfocusable, hidden from
 * assistive tech) while `active`, for surfaces that cover them: a full-window
 * editor, a full-screen window. Restores exactly what it changed.
 */
export function useInert(selector: string, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const els = [...document.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.hasAttribute("inert"));
    els.forEach((el) => el.setAttribute("inert", ""));
    return () => els.forEach((el) => el.removeAttribute("inert"));
  }, [selector, active]);
}

/**
 * For a surface that takes focus when it opens: remembers what had focus and
 * gives it back on close, or to `fallback` when that element has gone.
 */
export function useReturnFocus(fallback: string) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      // After this surface unmounts and anything it made inert is restored.
      requestAnimationFrame(() => {
        const target = prev && prev.isConnected && prev !== document.body ? prev : document.querySelector<HTMLElement>(fallback);
        target?.focus();
      });
    };
  }, [fallback]);
}
