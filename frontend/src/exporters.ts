import type { L0ResultDto, L2ResultDto } from "./api";

export interface ProfilePoint {
  x: number;
  r: number;
}

/** Full engine inner contour (injector → exit) from L0 geometry + the L2 nozzle. */
export function engineProfile(l0: L0ResultDto, l2?: L2ResultDto | null): ProfilePoint[] {
  const rc = l0.chamber_diameter / 2;
  const rt = l0.throat_diameter / 2;
  const re = l0.exit_diameter / 2;
  const lc = l0.chamber_length;
  const pts: ProfilePoint[] = [];
  pts.push({ x: 0, r: rc });
  pts.push({ x: lc, r: rc });
  const lConv = (rc - rt) / Math.tan((30 * Math.PI) / 180);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    pts.push({ x: lc + t * lConv, r: rt + (rc - rt) * (0.5 + 0.5 * Math.cos(Math.PI * t)) });
  }
  const throatX = lc + lConv;
  if (l2?.stations && l2.stations.length > 2) {
    const s0 = l2.stations[0].x;
    for (const s of l2.stations) pts.push({ x: throatX + (s.x - s0), r: s.r });
  } else {
    const lDiv = (re - rt) / Math.tan((15 * Math.PI) / 180);
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      pts.push({ x: throatX + t * lDiv, r: rt + (re - rt) * Math.sqrt(t) });
    }
  }
  return pts;
}

function download(name: string, content: string | ArrayBuffer, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** ASCII STL of the engine as a surface of revolution (mesh — universal CAD/print). */
export function exportStl(profile: ProfilePoint[], segments = 48) {
  const lines: string[] = ["solid engine"];
  const tri = (a: number[], b: number[], c: number[]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    lines.push(`facet normal ${n[0]} ${n[1]} ${n[2]}`, "outer loop");
    for (const p of [a, b, c]) lines.push(`vertex ${p[0]} ${p[1]} ${p[2]}`);
    lines.push("endloop", "endfacet");
  };
  const vert = (i: number, j: number): number[] => {
    const th = (2 * Math.PI * j) / segments;
    return [profile[i].x, profile[i].r * Math.cos(th), profile[i].r * Math.sin(th)];
  };
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = vert(i, j);
      const b = vert(i + 1, j);
      const c = vert(i + 1, j + 1);
      const d = vert(i, j + 1);
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  lines.push("endsolid engine");
  download("engine.stl", lines.join("\n"), "model/stl");
}

/** DXF (R12) of the 2D cross-section profile — a CAD sketch to revolve. */
export function exportDxf(profile: ProfilePoint[]) {
  const out: string[] = ["0", "SECTION", "2", "ENTITIES"];
  const line = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
    out.push("0", "LINE", "8", layer, "10", `${x1}`, "20", `${y1}`, "30", "0", "11", `${x2}`, "21", `${y2}`, "31", "0");
  };
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    line(a.x, a.r, b.x, b.r, "PROFILE"); // upper contour
    line(a.x, -a.r, b.x, -b.r, "PROFILE"); // mirrored lower contour
  }
  const xEnd = profile[profile.length - 1].x;
  line(0, 0, xEnd, 0, "AXIS"); // centerline
  out.push("0", "ENDSEC", "0", "EOF");
  download("engine_profile.dxf", out.join("\n"), "application/dxf");
}

/** Minimal ISO-10303-21 (STEP AP203) surface of revolution built from the profile. */
export function exportStep(profile: ProfilePoint[]) {
  const e: string[] = [];
  let id = 0;
  const next = () => `#${++id}`;
  // Axis of revolution (X axis).
  const originId = next();
  e.push(`${originId}=CARTESIAN_POINT('',(0.,0.,0.));`);
  const dirZ = next();
  e.push(`${dirZ}=DIRECTION('',(1.,0.,0.));`); // revolution axis = X
  const dirX = next();
  e.push(`${dirX}=DIRECTION('',(0.,0.,1.));`);
  const axis = next();
  e.push(`${axis}=AXIS1_PLACEMENT('',${originId},${dirZ});`);
  // Generatrix polyline (profile in the XY plane, y = radius).
  const ptIds = profile.map((p) => {
    const pid = next();
    e.push(`${pid}=CARTESIAN_POINT('',(${p.x.toFixed(6)},${p.r.toFixed(6)},0.));`);
    return pid;
  });
  const poly = next();
  e.push(`${poly}=POLYLINE('generatrix',(${ptIds.join(",")}));`);
  const surf = next();
  e.push(`${surf}=SURFACE_OF_REVOLUTION('engine_wall',${poly},${axis});`);

  const header = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('Propulsor engine surface of revolution'),'2;1');",
    "FILE_NAME('engine.step','',(''),(''),'Propulsor','','');",
    "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));",
    "ENDSEC;",
    "DATA;",
  ];
  download("engine.step", [...header, ...e, "ENDSEC;", "END-ISO-10303-21;"].join("\n"), "application/step");
}
