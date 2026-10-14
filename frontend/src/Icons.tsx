/**
 * Propulsor's icon set: drafted line icons on a 20-unit grid, one 1.5 stroke,
 * square caps — the same pen as the blueprint linework.
 */
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export type IconName =
  | "new" | "open" | "save" | "undo" | "redo" | "solve" | "help" | "readouts" | "close" | "warn" | "chevL" | "chevR" | "chevUp" | "chevDown" | "tree" | "expand" | "restore" | "minimize" | "maximize" | "restoreWin" | "bell"
  | "requirements" | "summary" | "model" | "section" | "cooling" | "stress" | "perf"
  | "turbo" | "blades" | "feed" | "control" | "assembly" | "trades" | "validation";

const PATHS: Record<IconName, ReactNode> = {
  new: (<><path d="M5 2.75h6.5l3.5 3.5v11H5z" /><path d="M11.25 2.75v3.75H15" /><path d="M10 9.5v5M7.5 12h5" /></>),
  open: (<><path d="M2.75 5V15.75h12.5l2-7H6.5l-2 7" /><path d="M2.75 5h4.5l1.5 1.75h6.5v2" /></>),
  save: (<><path d="M3.25 3.25h11l2.5 2.5v11h-13.5z" /><path d="M6.25 3.25v4h7v-4" /><path d="M6.25 16.75v-5h7.5v5" /></>),
  undo: (<><path d="M7 4.5L3.5 8 7 11.5" /><path d="M3.75 8h8.5a4 4 0 010 8H9" /></>),
  redo: (<><path d="M13 4.5L16.5 8 13 11.5" /><path d="M16.25 8h-8.5a4 4 0 000 8H11" /></>),
  solve: (<><path d="M3 10a7 7 0 0112.2-4.7" /><path d="M17 10a7 7 0 01-12.2 4.7" /><path d="M15.5 2.5v3.25h-3.25" /><path d="M4.5 17.5v-3.25h3.25" /></>),
  help: (<><circle cx="10" cy="10" r="7.25" /><path d="M7.75 7.75a2.25 2.25 0 114 1.4c-.9.6-1.75 1.1-1.75 2.35" /><path d="M10 14.25v.5" /></>),
  readouts: (<><path d="M2.75 3.75h14.5v12.5H2.75z" /><path d="M12.25 3.75v12.5" /><path d="M14 7h1.5M14 9.5h1.5M14 12h1.5" /></>),
  close: (<path d="M5 5l10 10M15 5L5 15" />),
  warn: (<><path d="M10 2.75l7.5 13.5h-15z" /><path d="M10 8v3.75M10 13.75v.5" /></>),
  chevL: (<path d="M12.5 4.5L7 10l5.5 5.5" />),
  chevR: (<path d="M7.5 4.5L13 10l-5.5 5.5" />),
  chevUp: (<path d="M4.5 12.5L10 7l5.5 5.5" />),
  chevDown: (<path d="M4.5 7.5L10 13l5.5-5.5" />),
  tree: (<><path d="M3 4.5h5M6 10h5M6 15.5h5" /><path d="M4.5 4.5V15.5H6M4.5 10H6" /><path d="M13.5 10h3.5M13.5 15.5h3.5M10.5 4.5h6.5" /></>),
  expand: (<><path d="M11.5 3h5.5v5.5M17 3l-6 6" /><path d="M8.5 17H3v-5.5M3 17l6-6" /></>),
  restore: (<><path d="M17 8.5h-5.5V3M11.5 8.5l5.5-5.5" /><path d="M3 11.5h5.5V17M8.5 11.5L3 17" /></>),
  minimize: (<path d="M5 14h10" />),
  bell: (<><path d="M5.5 13.5V9a4.5 4.5 0 0 1 9 0v4.5l1.5 2h-12z" /><path d="M8.5 17.5a1.6 1.6 0 0 0 3 0" /></>),
  maximize: (<rect x="4.5" y="4.5" width="11" height="11" rx="1" />),
  restoreWin: (<><rect x="4" y="7" width="9" height="9" rx="1" /><path d="M7 7V4.5a.5.5 0 0 1 .5-.5H16a.5.5 0 0 1 .5.5V13a.5.5 0 0 1-.5.5h-3" /></>),
  requirements: (<><path d="M3 5.5h14M3 10h14M3 14.5h14" /><path d="M7 3.75v3.5M13 8.25v3.5M9 12.75v3.5" /></>),
  summary: (<><path d="M3.25 14.5a6.75 6.75 0 1113.5 0" /><path d="M10 14.5l3.5-5" /><path d="M2.75 14.5h14.5" /></>),
  model: (<><path d="M10 2.75l6.5 3.6v7.3L10 17.25l-6.5-3.6v-7.3z" /><path d="M3.5 6.35L10 10l6.5-3.65M10 10v7.25" /></>),
  section: (<><path d="M2.5 6.5h5.5c1.6 0 2.2 2.5 3.5 2.5s3-2.5 6-4" /><path d="M2.5 13.5h5.5c1.6 0 2.2-2.5 3.5-2.5s3 2.5 6 4" /><path d="M2.5 6.5v7" /></>),
  cooling: (<><path d="M10 2.75s-4.75 5.4-4.75 8.75a4.75 4.75 0 009.5 0C14.75 8.15 10 2.75 10 2.75z" /><path d="M7.75 12a2.25 2.25 0 002.25 2.25" /></>),
  stress: (<><path d="M2.75 4.5h14.5M2.75 15.5h14.5" /><path d="M6 4.5l-1.5 11M10 4.5v11M14 4.5l1.5 11" /></>),
  perf: (<><path d="M2.75 2.75v14.5h14.5" /><path d="M5 14c2-5.5 4-8.5 6-8.5s3.5 2 5 4.5" /></>),
  turbo: (<><circle cx="10" cy="10" r="2" /><path d="M10 8C10 5 12 3 15 3M12 10c3 0 5 2 5 5M10 12c0 3-2 5-5 5M8 10C5 10 3 8 3 5" /></>),
  blades: (<><path d="M4 16.5C4 9.5 8.5 4 16 3.5c-.5 7-5 12.5-12 13z" /><path d="M4 16.5l7-7" /></>),
  feed: (<><path d="M6 2.75h8v9.5a4 4 0 01-8 0z" /><path d="M10 16.25v1.5M6 6.5h8" /></>),
  control: (<><path d="M2.75 10h3l1.5-5 2.5 10 2-6.5 1.25 1.5h4.25" /></>),
  assembly: (<><path d="M10 2.25c2.25 2 3.25 4.5 3.25 7.5v4.5h-6.5v-4.5c0-3 1-5.5 3.25-7.5z" /><path d="M6.75 11.5L4.5 14v2.75l2.25-1.5M13.25 11.5l2.25 2.5v2.75l-2.25-1.5" /><path d="M8.75 17.75h2.5" /></>),
  trades: (<><path d="M2.75 2.75v14.5h14.5" /><circle cx="6.5" cy="12.5" r="1" /><circle cx="10" cy="8.5" r="1" /><circle cx="13" cy="11" r="1" /><circle cx="15" cy="5.5" r="1" /></>),
  validation: (<><circle cx="10" cy="10" r="7.25" /><circle cx="10" cy="10" r="3.5" /><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" /></>),
};

export function Ico({ name, size }: { name: IconName; size?: number }) {
  return <Icon size={size}>{PATHS[name]}</Icon>;
}

/** Brand mark: a bell nozzle in section with its plume. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14.2 10.2L22.5 8v8l-8.3-2.2z" fill="#ff7a2e" opacity="0.9" />
      <path d="M1.5 6.5h5c1.6 0 2.4 3 4 3s2-.5 3-1.2M1.5 17.5h5c1.6 0 2.4-3 4-3s2 .5 3 1.2M1.5 6.5v11" fill="none" stroke="#e9ebee" strokeWidth="1.6" />
    </svg>
  );
}
