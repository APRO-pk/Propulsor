import type { L0ResultDto } from "./api";

const IN = 0.0254;
const PX_PER_IN = 90;

/**
 * A live 2D cross-section of the engine (chamber + nozzle + throat), drawn as an
 * SVG with dimension callouts — the spirit of Krzycki's Figure 8 assembly drawing.
 * Uses the L0 geometry; higher-fidelity contours replace the conical nozzle at L2.
 */
export function CrossSection({ l0 }: { l0: L0ResultDto }) {
  const chamberD = l0.chamber_diameter / IN; // in
  const throatD = l0.throat_diameter / IN;
  const exitD = l0.exit_diameter / IN;
  const chamberL = l0.chamber_length / IN;
  const exitX = chamberL + (exitD / 2 - throatD / 2) * 4; // simple conical nozzle extent
  const w = (exitX + 1) * PX_PER_IN;
  const h = (exitD + 1.5) * PX_PER_IN;

  // `cy` is the vertical centerline (axis of revolution); the drawing is wider
  // than tall, so this must be h/2, NOT w/2.
  const cy = h / 2;
  const scale = PX_PER_IN;

  // Outline (top half then mirror) — approximated with a conical nozzle.
  const top = [
    { x: 0, y: -chamberD / 2 },
    { x: chamberL, y: -throatD / 2 },
    { x: exitX, y: -exitD / 2 },
  ];
  const path = buildPath(top, cy, scale, true);
  const closedPath = path + " Z";

  const dim = (label: string, x1: number, y1: number, x2: number, y2: number) => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7c828c" strokeWidth={1} />
      <line x1={x1} y1={y1 - 4} x2={x1} y2={y1 + 4} stroke="#7c828c" strokeWidth={1} />
      <line x1={x2} y1={y2 - 4} x2={x2} y2={y2 + 4} stroke="#7c828c" strokeWidth={1} />
      <text x={(x1 + x2) / 2} y={y1 - 8} fill="#1f2329" fontSize={11} textAnchor="middle">
        {label}
      </text>
    </g>
  );

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="engine cross-section">
      <defs>
        <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e7eaef" />
          <stop offset="0.5" stopColor="#c3c9d3" />
          <stop offset="1" stopColor="#a7aeba" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill="none" />
      <path d={closedPath} fill="url(#steel)" stroke="#3574e0" strokeWidth={1.5} />

      {/* axis */}
      <line x1={0} y1={cy} x2={w} y2={cy} stroke="#9aa0aa" strokeDasharray="6 4" strokeWidth={1} />

      {/* dimension callouts */}
      {dim("D_ch", 4, cy - (chamberD / 2) * scale, 4 + 0.4 * scale, cy - (chamberD / 2) * scale)}
      {dim("D_t", chamberL * scale, cy - (throatD / 2) * scale, chamberL * scale + 2, cy - (throatD / 2) * scale)}
      {dim("D_e", w - 4, cy - (exitD / 2) * scale, w - 4 - 0.4 * scale, cy - (exitD / 2) * scale)}
    </svg>
  );
}

function buildPath(
  pts: { x: number; y: number }[],
  cx: number,
  scale: number,
  half: boolean,
): string {
  let d = `M ${pts[0].x * scale} ${cx + pts[0].y * scale}`;
  for (const p of pts.slice(1)) {
    d += ` L ${p.x * scale} ${cx + p.y * scale}`;
  }
  if (half) {
    // mirror back to the bottom
    for (const p of [...pts].reverse()) {
      d += ` L ${p.x * scale} ${cx - p.y * scale}`;
    }
  }
  return d;
}
