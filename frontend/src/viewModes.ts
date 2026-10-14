import { useSharedState } from "./sharedState";

/** The 3D stage's display modes; the Spec sheet presents the same engine as a board. */
export type ViewMode = "shaded" | "hot" | "stress" | "flow";

export const VIEW_MODES: [ViewMode, string][] = [
  ["shaded", "Shaded"],
  ["hot", "Hot gas"],
  ["stress", "Stress"],
  ["flow", "Flow"],
];

/** The stage's display mode, shared so the Spec sheet can switch straight back into any mode. */
export const useViewMode = () => useSharedState<ViewMode>("viewer.mode", "hot");
