import { useMemo } from "react";
import type { L0ResultDto, L2ResultDto } from "./api";
import { engineProfile } from "./exporters";

/** Which part of the drawing a view is about. */
export type DrawingZone = "injector" | "chamber" | "nozzle";

const W = 220;
const X0 = 16; // injector face
const PLUME = 10; // right margin past the exit plane

/**
 * The viewport's section inset: a dimensioned half-section of the designed
 * thrust chamber drawn from the actual L0/L2 contour. The selected part is
 * drawn in the selection accent; clicking a zone selects that part.
 */
export function BlueprintEngine({
  l0,
  l2,
  lit,
  si,
  onZone,
}: {
  l0: L0ResultDto | null;
  l2: L2ResultDto | null;
  lit: DrawingZone[];
  si: boolean;
  onZone: (z: DrawingZone) => void;
}) {
  const g = useMemo(() => (l0 ? build(l0, l2) : null), [l0, l2]);
  const len = (m: number) => (si ? `${(m * 1000).toFixed(m < 0.1 ? 1 : 0)}` : `${(m / 0.0254).toFixed(2)}`);
  const unit = si ? "mm" : "in";

  if (!g || !l0) {
    return (
      <svg viewBox={`0 0 ${W} 112`} role="img" aria-label="No engine drawn yet — enter the requirements">
        <path className="bp-ghost" d="M16 30h70c14 0 18 18 32 18s30-10 86-22M16 82h70c14 0 18-18 32-18s30 10 86 22M16 30v52" />
        <path className="bp-center" d="M8 56h206" />
        <text className="bp-ghost-text" x={W / 2} y={106} textAnchor="middle">AWAITING REQUIREMENTS</text>
      </svg>
    );
  }

  const lit_ = (z: DrawingZone) => (lit.includes(z) ? "bp-region lit" : "bp-region");
  const throatLabel = `Ø${len(l0.throat_diameter)}`;
  const exitLabel = `Ø${len(l0.exit_diameter)}`;
  const lcLabel = `${len(l0.chamber_length)} ${unit}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${g.h}`}
      role="img"
      aria-label={`Thrust chamber half-section: throat ${throatLabel} ${unit}, exit ${exitLabel} ${unit}, chamber length ${lcLabel}`}
    >
      <defs>
        <marker id="bp-arrow" viewBox="0 0 6 6" refX="5.5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L6 3 0 6z" fill="var(--ink-3)" />
        </marker>
      </defs>

      <path className="bp-center" d={`M4 ${g.cy}H${W - 2}`} />

      <g className={lit_("injector")} onClick={() => onZone("injector")}>
        <path className="bp-feed" d={`M2 ${g.cy - g.rc * 0.5}H${X0}M2 ${g.cy + g.rc * 0.5}H${X0}`} />
        <path className="bp-face" d={`M${X0} ${g.cy - g.rcOut}V${g.cy + g.rcOut}`} />
        <rect x={0} y={g.cy - g.rcOut} width={X0 + 2} height={g.rcOut * 2} fill="transparent" />
      </g>
      <g className={lit_("chamber")} onClick={() => onZone("chamber")}>
        <path className="bp-wall" d={g.wallChamberTop} />
        <path className="bp-wall" d={g.wallChamberBot} />
      </g>
      <g className={lit_("nozzle")} onClick={() => onZone("nozzle")}>
        <path className="bp-wall" d={g.wallNozzleTop} />
        <path className="bp-wall" d={g.wallNozzleBot} />
      </g>

      {/* Dimensions */}
      <g aria-hidden="true">
        <path className="bp-dim" d={`M${g.xt} ${g.cy - g.rt + 1}V${g.cy + g.rt - 1}`} markerStart="url(#bp-arrow)" markerEnd="url(#bp-arrow)" />
        <path className="bp-dim" d={`M${g.xt} ${g.cy + g.rtOut + 2}V${g.yThroatLabel - 8}`} />
        <text className="bp-dim-text" x={g.xt} y={g.yThroatLabel} textAnchor="middle">{throatLabel}</text>

        <path className="bp-dim" d={`M${g.xe} ${g.cy - g.re + 1}V${g.cy + g.re - 1}`} markerStart="url(#bp-arrow)" markerEnd="url(#bp-arrow)" />
        <path className="bp-dim" d={`M${g.xe} ${g.cy - g.reOut - 2}V${g.yExitLabel + 3}`} />
        <text className="bp-dim-text" x={g.xe} y={g.yExitLabel} textAnchor="end">{exitLabel}</text>

        <path className="bp-dim" d={`M${X0} ${g.cy + g.rcOut + 3}V${g.yLen + 4}M${g.xc} ${g.cy + g.rcOut + 3}V${g.yLen + 4}`} />
        <path className="bp-dim" d={`M${X0 + 1} ${g.yLen}H${g.xc - 1}`} markerStart="url(#bp-arrow)" markerEnd="url(#bp-arrow)" />
        <text className="bp-dim-text" x={(X0 + g.xc) / 2} y={g.yLen - 3} textAnchor="middle">{lcLabel}</text>
      </g>
    </svg>
  );
}

function build(l0: L0ResultDto, l2: L2ResultDto | null) {
  const prof = engineProfile(l0, l2);
  const L = prof[prof.length - 1].x || 1e-3;
  const rc = l0.chamber_diameter / 2;
  const re = l0.exit_diameter / 2;
  const rMax = Math.max(rc, re);
  // Fit the length, but never let a stubby engine grow taller than the rail.
  const s = Math.min((W - X0 - PLUME) / L, 34 / rMax);
  const t = Math.max(l0.wall_thickness * s, 2.2);
  const top = 18;
  const cy = top + rMax * s + t;

  const px = (x: number) => X0 + x * s;
  const throatIdx = prof.reduce((best, p, i) => (p.r < prof[best].r ? i : best), 0);
  const chamberEnd = prof.findIndex((p) => p.x > l0.chamber_length * 0.999);

  const band = (from: number, to: number, sign: 1 | -1) => {
    const pts = prof.slice(from, to + 1);
    const inner = pts.map((p) => `${px(p.x).toFixed(2)} ${(cy - sign * p.r * s).toFixed(2)}`);
    const outer = pts
      .slice()
      .reverse()
      .map((p) => `${px(p.x).toFixed(2)} ${(cy - sign * (p.r * s + t)).toFixed(2)}`);
    return `M${inner.join("L")}L${outer.join("L")}Z`;
  };

  const xt = px(prof[throatIdx].x);
  const xe = px(L);
  const xc = px(l0.chamber_length);
  const rtPx = prof[throatIdx].r * s;
  const rePx = re * s;
  const rcPx = rc * s;

  // Plume: a flared jet with a white-hot core, scaled to the exit.
  const pl = Math.min(PLUME, W - xe - 2);
  const plume = `M${xe} ${cy - rePx}C${xe + pl * 0.35} ${cy - rePx * 1.08} ${xe + pl * 0.7} ${cy - rePx * 0.55} ${xe + pl} ${cy - rePx * 0.2}L${xe + pl} ${cy + rePx * 0.2}C${xe + pl * 0.7} ${cy + rePx * 0.55} ${xe + pl * 0.35} ${cy + rePx * 1.08} ${xe} ${cy + rePx}Z`;
  const core = `M${xe} ${cy - rePx * 0.55}Q${xe + pl * 0.45} ${cy - rePx * 0.3} ${xe + pl * 0.75} ${cy}Q${xe + pl * 0.45} ${cy + rePx * 0.3} ${xe} ${cy + rePx * 0.55}Z`;

  const bottom = cy + rMax * s + t;
  const yThroatLabel = bottom + 12;
  const yLen = bottom + 26;
  const yExitLabel = Math.max(10, cy - rePx - t - 6);

  const split = Math.max(1, chamberEnd > 0 ? Math.min(chamberEnd, throatIdx) : throatIdx);
  return {
    h: Math.ceil(yLen + 4),
    cy,
    rc: rcPx,
    rcOut: rcPx + t,
    rt: rtPx,
    rtOut: rtPx + t,
    re: rePx,
    reOut: rePx + t,
    xt,
    xe,
    xc,
    yThroatLabel,
    yExitLabel,
    yLen,
    plume,
    core,
    wallChamberTop: band(0, Math.max(split, throatIdx), 1),
    wallChamberBot: band(0, Math.max(split, throatIdx), -1),
    wallNozzleTop: band(throatIdx, prof.length - 1, 1),
    wallNozzleBot: band(throatIdx, prof.length - 1, -1),
  };
}
