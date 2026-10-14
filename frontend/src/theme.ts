/**
 * Palette for WebGL scenes. three.js can't read CSS custom properties, so the
 * 3D views take their colours from here; the selection accent is read from
 * the CSS token at use, the rest are scene-only values.
 * Graphite stage, neutral metal, one selection accent — heat is the only warm
 * colour, and it lives in the hot-gas and plume shaders.
 */
/** A CSS custom property's value, for the few scene colours that must match the UI exactly. */
const cssVar = (name: string, fallback: string) =>
  (typeof document !== "undefined" && getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || fallback;

export const SCENE = {
  /** Background for the secondary 3D views (the main viewport is transparent over its CSS stage). */
  background: "#141619",
  /** Floor grid — barely there. */
  gridMajor: "#2a2e35",
  gridMinor: "#1c1f24",
  /** Sky / ground hemisphere light colours. */
  sky: "#eef1f5",
  ground: "#16181c",
  /** Neutral cool fill and a warm rim that reads as engine heat. */
  fillCool: "#b9c6d6",
  rimHot: "#ffb066",
  /** Machined metal. */
  metal: "#cfd5dd",
  metalDark: "#9aa3ae",
  metalDarker: "#7d8691",
  /** Section-cut edges and isolines. */
  linework: "#d7dce3",
  /** Cooling channels. */
  coolant: "#6fa9a4", // a cool teal, never the selection blue
  /** Flow streamline tubes. */
  streamline: "#c9dcf3",
  /** The part selected in the feature tree: the UI accent itself, read from the CSS token so it can't drift. */
  get selection() {
    return cssVar("--accent", "#78a9e6");
  },
  /** Propellant colours shared with the P&ID. */
  ox: "#8fb4e8",
  fuel: "#e0b062",
  /** Injector plate. */
  injector: "#b8bec6", // plain metal: green is reserved for pass
  /** Sensor markers. */
  pressure: "#78a9e6",
  thermal: "#ff7a2e",
} as const;
