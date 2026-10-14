import { useEffect, useState, type RefObject } from "react";

const EDIT = "input:not([type=hidden]), select, textarea";
/** Action buttons count as inputs (importing data is an input too); exports and reports are results. */
const isAction = (b: Element) => {
  const t = b.textContent ?? "";
  return /import/i.test(t) || !/export|csv|download|stl|dxf|step|report|print|template/i.test(t);
};
const isActionButton = (el: Element) => (el.matches("button.qt-tool") && isAction(el)) || el.matches("button[aria-pressed]");
const editable = (el: Element) =>
  el.matches(EDIT) ||
  isActionButton(el) ||
  !!el.querySelector(EDIT) ||
  !!el.querySelector("button[aria-pressed]") ||
  [...el.querySelectorAll("button.qt-tool")].some(isAction);

/**
 * Sorts a view's content into Inputs (anything editable) and Results (anything
 * read-only), row by row: a computed value inside an input section still counts
 * as a result. Elements get data-role="inputs" | "results" | "mixed"; a parent
 * with data-show="inputs" or "results" hides the other kind via CSS. Re-sorts
 * whenever the content changes. Returns how many of each it found.
 */
export function useRoleSort(ref: RefObject<HTMLElement>, deps: unknown[]) {
  const [counts, setCounts] = useState({ inputs: 0, results: 0 });
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let inputs = 0;
    let results = 0;
    const tag = (el: HTMLElement): "inputs" | "results" | "mixed" => {
      if (el.tagName === "LEGEND" || el.classList.contains("fig-title")) return "mixed";
      if (!editable(el)) {
        el.dataset.role = "results";
        results++;
        return "results";
      }
      const kids = [...el.children] as HTMLElement[];
      // A field (or a <label> wrapping its caption and control) stays whole: the caption belongs with its input.
      if (el.classList.contains("qt-field") || el.tagName === "LABEL" || el.matches(EDIT) || kids.length === 0) {
        el.dataset.role = "inputs";
        inputs++;
        return "inputs";
      }
      const roles = kids.map(tag);
      if (roles.every((r) => r !== "results")) {
        kids.forEach((k) => delete k.dataset.role);
        el.dataset.role = "inputs";
        return "inputs";
      }
      el.dataset.role = "mixed";
      return "mixed";
    };
    const run = () => {
      root.querySelectorAll<HTMLElement>("[data-role]").forEach((e) => delete e.dataset.role);
      inputs = 0;
      results = 0;
      const page = root.querySelector<HTMLElement>(".page");
      if (page) [...page.children].forEach((c) => tag(c as HTMLElement));
      setCounts((c) => (c.inputs === inputs && c.results === results ? c : { inputs, results }));
    };
    run();
    const mo = new MutationObserver(run);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return counts;
}
