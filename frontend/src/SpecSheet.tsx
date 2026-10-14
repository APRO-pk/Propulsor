import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import { toPng } from "html-to-image";
import type { EngineDesignDto, IssuesReportDto, L0ResultDto, L1ResultDto, L2ResultDto } from "./api";
import { engineProfile } from "./exporters";
import { VIEW_MODES, useViewMode } from "./viewModes";

/** Long names and a short label for each propellant pair. */
const PAIRS: Record<string, [string, string, string]> = {
  GoxKerosene: ["Gaseous oxygen", "Kerosene", "GOX / kerosene"],
  GoxGasoline: ["Gaseous oxygen", "Gasoline", "GOX / gasoline"],
  GoxEthanol: ["Gaseous oxygen", "Ethanol", "GOX / ethanol"],
  GoxMethanol: ["Gaseous oxygen", "Methanol", "GOX / methanol"],
  LoxRp1: ["Liquid oxygen", "RP-1", "LOX / RP-1"],
  LoxEthanol: ["Liquid oxygen", "Ethanol", "LOX / ethanol"],
  LoxMethane: ["Liquid oxygen", "Liquid methane", "LOX / methane"],
  LoxHydrogen: ["Liquid oxygen", "Liquid hydrogen", "LOX / hydrogen"],
  NitrousPropane: ["Nitrous oxide", "Propane", "N₂O / propane"],
  NtoMmh: ["Nitrogen tetroxide", "MMH", "NTO / MMH"],
  NtoUdmh: ["Nitrogen tetroxide", "UDMH", "NTO / UDMH"],
  H2o2Kerosene: ["Hydrogen peroxide", "Kerosene", "H₂O₂ / kerosene"],
};
const COOLING: Record<string, string> = { regen: "Regenerative", film: "Film", radiation: "Radiation", ablative: "Ablative" };

type Anchor = { x: number; y: number };
interface Geo {
  /** Axial extent of the whole figure (m) and its centre. */
  aMin: number;
  aMax: number;
  rc: number;
  rt: number;
  re: number;
  t: number;
  lc: number;
  aThroat: number;
  L: number;
  regen: boolean;
  /** Anchor points in group space (x radial, negative = up on screen; y axial). */
  anchors: [number, number][];
}

/**
 * Presentation mode: the current engine as a monochrome spec-sheet board — a
 * studio render with numbered callouts, section brackets and a technical
 * overview (metric bold over faded imperial). Everything on it is generated
 * from the design. Esc returns to the workbench; Export saves a PNG.
 */
export function SpecSheet({
  design,
  l0,
  l1,
  l2,
  issues,
  si,
  onClose,
}: {
  design: EngineDesignDto;
  l0: L0ResultDto;
  l1: L1ResultDto | null;
  l2: L2ResultDto | null;
  issues: IssuesReportDto | null;
  si: boolean;
  onClose: () => void;
}) {
  const [, setMode] = useViewMode();
  const boardRef = useRef<HTMLDivElement>(null);
  const figRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [fig, setFig] = useState({ w: 0, h: 0 });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const el = figRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFig({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const method = design.geometry?.cooling_jacket?.cooling_method ?? "regen";
  const geo = useMemo(() => buildGeo(l0, l2, method === "regen"), [l0, l2, method]);

  const pair = PAIRS[design.propellant.pair] ?? [design.propellant.pair, "", design.propellant.pair];
  const op = design.operating_point;
  const material = design.materials?.chamber ?? "—";
  const kind = design.geometry?.nozzle?.kind ?? "Bell";
  const eps = l2?.area_ratio ?? l0.area_ratio;
  const channels = design.params?.["cooling.channel_count"];
  const caches = design.caches ?? [];
  const solved = caches.some((c) => c.payload != null) && caches.every((c) => c.status === "Solved" || c.payload == null);
  const failed = issues?.failed ?? 0;

  const thrust = op.thrust >= 1000 ? `${(op.thrust / 1000).toFixed(1)} kN` : `${op.thrust.toFixed(0)} N`;
  const pc = `${(op.chamber_pressure / 1e5).toFixed(0)} bar`;
  const coolingSentence =
    method === "regen"
      ? `The ${material} liner is regeneratively cooled by the fuel${channels ? ` through ${channels} channels` : ""}.`
      : method === "film"
        ? `The ${material} chamber is film cooled.`
        : method === "ablative"
          ? `The chamber uses an ablative liner.`
          : `The ${material} chamber is radiation cooled.`;
  const abstract = `A ${thrust} ${pair[2]} thrust chamber at ${pc} chamber pressure and O/F ${op.mixture_ratio.toFixed(2)}. ${coolingSentence} A ${kind === "Conical" ? "conical" : "bell"} nozzle expands the flow to an area ratio of ${eps.toFixed(2)}.`;

  const legend: [string, string][] = [
    ["Oxidiser inlet", `${pair[0]}, axial feed`],
    ["Injector head", "and bolted flange"],
    geo.regen ? ["Coolant outlet manifold", "fuel to the injector"] : ["Combustion chamber", `L ${(l0.chamber_length * 1000).toFixed(0)} mm`],
    ["Throat", `Ø ${(l0.throat_diameter * 1000).toFixed(1)} mm`],
    [kind === "Conical" ? "Conical nozzle" : "Bell nozzle", `exit Ø ${(l0.exit_diameter * 1000).toFixed(1)} mm`],
    geo.regen ? ["Coolant inlet manifold", "fuel enters the jacket"] : ["Nozzle exit plane", `ε ${eps.toFixed(2)}`],
  ];

  // Metric over imperial (or the reverse when the readouts are set to Imperial).
  const isp = l2?.isp_s ?? l0.isp_s;
  const tc = l1?.tc_k ?? null;
  const stats: [string, [string, string], [string, string]][] = [
    ["Thrust", [(op.thrust / 1000).toFixed(1), "kN"], [Math.round(op.thrust / 4.4482216).toLocaleString("en-US"), "lbf"]],
    ["Chamber pressure", [(op.chamber_pressure / 1e5).toFixed(1), "bar"], [Math.round(op.chamber_pressure / 6894.757).toLocaleString("en-US"), "psi"]],
    [l2 ? "Delivered Isp" : "Isp, ideal sea level", [isp.toFixed(0), "s"], [Math.round(isp * 9.80665).toLocaleString("en-US"), "m/s"]],
    ["Mass flow", [l0.total_flow.toFixed(2), "kg/s"], [(l0.total_flow / 0.45359237).toFixed(1), "lb/s"]],
    ["Throat diameter", [(l0.throat_diameter * 1000).toFixed(1), "mm"], [(l0.throat_diameter / 0.0254).toFixed(2), "in"]],
    [
      "Chamber temperature",
      [tc ? Math.round(tc).toLocaleString("en-US") : "—", "K"],
      [tc ? Math.round(((tc - 273.15) * 9) / 5 + 32).toLocaleString("en-US") : "—", "°F"],
    ],
  ];

  const exportPng = async () => {
    if (!boardRef.current) return;
    setExporting(true);
    try {
      const url = await toPng(boardRef.current, {
        backgroundColor: "#050505",
        pixelRatio: 2,
        filter: (n) => !(n instanceof HTMLElement && n.classList.contains("ss-controls")),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(design.meta.name || "propulsor-engine").replace(/\s+/g, "_")}_spec_sheet.png`;
      a.click();
    } catch (err) {
      window.alert(`Could not export the spec sheet: ${String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  // Leader rows: three numbered rows on each side; each row runs in from the
  // edge, then breaks diagonally to its anchor on the render.
  const pad = 56;
  const rowY = [0.1, 0.26, 0.9].map((f) => f * fig.h);
  const rows = [
    { n: "01", side: "l", y: rowY[0] },
    { n: "02", side: "l", y: rowY[1] },
    { n: "03", side: "l", y: rowY[2] },
    { n: "04", side: "r", y: rowY[1] },
    { n: "05", side: "r", y: rowY[0] },
    { n: "06", side: "r", y: rowY[2] },
  ];
  const brackets = anchors.length >= 9 ? { inj: anchors[6], thr: anchors[7], exit: anchors[8] } : null;

  return (
    <div className="ss" role="dialog" aria-modal="true" aria-label="Engine spec sheet">
      <div className="ss-board" ref={boardRef}>
        <div className="ss-head">
          <span className="ss-brand">Propulsor</span>
          <div className="ss-controls">
            {/* The same switch as the stage: any mode returns to the workbench in that mode. */}
            <div className="ss-modes" role="group" aria-label="Display mode">
              {VIEW_MODES.map(([m, label]) => (
                <button
                  key={m}
                  aria-pressed={false}
                  onClick={() => {
                    setMode(m);
                    onClose();
                  }}
                >
                  {label}
                </button>
              ))}
              <button aria-pressed={true}>Spec sheet</button>
            </div>
            <button onClick={exportPng} disabled={exporting}>{exporting ? "Exporting…" : "Export PNG"}</button>
            <button ref={closeRef} onClick={onClose} title="Back to the workbench (Esc)">Back · Esc</button>
          </div>
          <span className="ss-cap">Rev {design.meta.revision}</span>
        </div>

        <div className="ss-titleblock">
          <div>
            <h1 className="ss-title">{pair[2]} thrust chamber</h1>
            <div className="ss-sub">Engine specification · {design.meta.name || "Untitled design"}</div>
            <p className="ss-abstract">{abstract}</p>
          </div>
          <div className="ss-meta">
            <div><span className="ss-cap">Propellant</span><p>{pair[0]}<br />{pair[1]}</p></div>
            <div><span className="ss-cap">Cooling</span><p>{COOLING[method] ?? method}<br />{material}</p></div>
            <div><span className="ss-cap">Contour</span><p>{kind === "Conical" ? "Conical" : "Rao bell"}<br />ε {eps.toFixed(2)}</p></div>
            <div>
              <span className="ss-cap">Status</span>
              <p>
                {solved ? "Solved" : "Not solved"}
                <br />
                {failed > 0 ? `${failed} failed check${failed === 1 ? "" : "s"}` : "All checks pass"}
              </p>
            </div>
          </div>
        </div>

        <div className="ss-figure" ref={figRef}>
          <Canvas frameloop="demand" dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }}>
            <color attach="background" args={["#050505"]} />
            <StudioEngine geo={geo} design={design} l0={l0} l2={l2} onAnchors={setAnchors} />
          </Canvas>

          {fig.w > 0 && anchors.length >= 6 && (
            <svg className="ss-leaders" viewBox={`0 0 ${fig.w} ${fig.h}`} aria-hidden="true">
              {rows.map((r, i) => {
                const a = anchors[i];
                const x0 = r.side === "l" ? pad : fig.w - pad;
                const x1 = r.side === "l" ? pad + 130 : fig.w - pad - 130;
                const d = `M${x0} ${r.y}H${x1}L${a.x} ${a.y}`;
                return (
                  <g key={r.n}>
                    <path d={d} fill="none" stroke="#050505" strokeWidth={3.5} strokeLinejoin="round" />
                    <path d={d} fill="none" stroke="#bdbdbd" strokeWidth={0.8} />
                    <circle cx={a.x} cy={a.y} r={3} fill="#f2f2f2" stroke="#050505" strokeWidth={1.5} />
                  </g>
                );
              })}
              {brackets && (
                <g stroke="#8a8a8a" strokeWidth={1}>
                  {[brackets.inj, brackets.thr, brackets.exit].map((p, i) => (
                    <path key={i} d={`M${p.x} ${p.y}V${p.y + 46}`} />
                  ))}
                  <path d={`M${brackets.inj.x} ${brackets.inj.y + 36}H${brackets.exit.x}`} />
                </g>
              )}
            </svg>
          )}
          {fig.w > 0 &&
            anchors.length >= 6 &&
            rows.map((r) => (
              <span key={r.n} className="ss-num" style={r.side === "l" ? { left: pad, top: r.y - 18 } : { right: pad, top: r.y - 18 }}>
                {r.n}
              </span>
            ))}
          {brackets && (
            <>
              <span className="ss-bracket" style={{ left: brackets.inj.x + 6, top: brackets.inj.y + 40 }}>
                Chamber<span>{(l0.chamber_length * 1000).toFixed(0)} mm</span>
              </span>
              <span className="ss-bracket" style={{ left: brackets.thr.x, top: brackets.thr.y + 40, transform: "translateX(-50%)", textAlign: "center" }}>
                Throat<span>Ø {(l0.throat_diameter * 1000).toFixed(1)}</span>
              </span>
              <span className="ss-bracket" style={{ left: Math.max(brackets.thr.x + 56, (brackets.thr.x + brackets.exit.x) / 2), top: brackets.exit.y + 40 }}>
                Nozzle<span>ε {eps.toFixed(2)}</span>
              </span>
            </>
          )}
        </div>

        <div className="ss-legend">
          {legend.map(([a, b], i) => (
            <div key={i}>
              <span className="ss-cap">{String(i + 1).padStart(2, "0")}</span>
              <p>{a}<br />{b}</p>
            </div>
          ))}
        </div>

        <div className="ss-over">
          <span className="ss-cap">Technical overview</span>
          <div className="ss-stats">
            {stats.map(([k, m, imp]) => {
              const [top, bottom] = si ? [m, imp] : [imp, m];
              return (
                <div key={k}>
                  <div className="k">{k}</div>
                  <div className="v">{top[0]}<small>{top[1]}</small></div>
                  <div className="i">{bottom[0]}<small>{bottom[1]}</small></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildGeo(l0: L0ResultDto, l2: L2ResultDto | null, regen: boolean): Geo {
  const prof = engineProfile(l0, l2);
  const L = prof[prof.length - 1].x;
  const rc = l0.chamber_diameter / 2;
  const re = l0.exit_diameter / 2;
  const t = Math.max(l0.wall_thickness, rc * 0.04);
  const throatIdx = prof.reduce((b, p, i) => (p.r < prof[b].r ? i : b), 0);
  const aThroat = prof[throatIdx].x;
  const rt = prof[throatIdx].r;
  const lc = l0.chamber_length;
  const tube = rc * 0.09;
  const rAt = (a: number) => {
    for (let i = 0; i < prof.length - 1; i++) if (prof[i].x <= a && prof[i + 1].x >= a) return prof[i].r + ((a - prof[i].x) / (prof[i + 1].x - prof[i].x || 1)) * (prof[i + 1].r - prof[i].r);
    return re;
  };
  const aIn = L - (L - aThroat) * 0.22;
  const rIn = rAt(aIn) + t + tube;
  const aMin = -1.45 * rc;
  const anchors: [number, number][] = [
    [0, -1.35 * rc], // 01 oxidiser inlet end
    [-0.7 * rc, -0.36 * rc], // 02 injector dome
    regen ? [rc + t + tube * 2, lc * 0.28] : [rc + t, lc * 0.5], // 03 (underside)
    [-(rt + t), aThroat], // 04 throat
    [-(re + t), L], // 05 exit lip
    regen ? [rIn + rc * 0.55, aIn] : [re + t, L], // 06
    // bracket feet: injector face, throat, exit (below the body)
    [Math.max(rc, re) + t + rc * 0.25, 0],
    [Math.max(rc, re) + t + rc * 0.25, aThroat],
    [Math.max(rc, re) + t + rc * 0.25, L],
  ];
  return { aMin, aMax: L, rc, rt, re, t, lc, aThroat, L, regen, anchors };
}

/** The engine under studio light: white metal on black, side-on with a slight downward look. */
function StudioEngine({ geo, design, l0, l2, onAnchors }: { geo: Geo; design: EngineDesignDto; l0: L0ResultDto; l2: L2ResultDto | null; onAnchors: (a: Anchor[]) => void }) {
  const { size, camera, invalidate } = useThree();
  const centre = (geo.aMin + geo.aMax) / 2;

  const parts = useMemo(() => {
    const prof = engineProfile(l0, l2);
    const { rc, t, lc, regen, aThroat, L } = geo;
    const inner = prof.map((p) => new THREE.Vector2(Math.max(p.r, 1e-4), p.x));
    const outer = [...inner].reverse().map((p) => new THREE.Vector2(p.x + t, p.y));
    const shell = new THREE.LatheGeometry([...inner, ...outer, inner[0].clone()], 160);
    shell.computeVertexNormals();
    const tube = rc * 0.09;
    const list: { g: THREE.BufferGeometry; dark?: boolean; shell?: boolean }[] = [{ g: shell, shell: true }];
    // Injector flange and dome, oxidiser inlet.
    const flange = new THREE.CylinderGeometry(rc + t + rc * 0.16, rc + t + rc * 0.16, t * 2.6, 96);
    flange.translate(0, -t * 1.3, 0);
    list.push({ g: flange, dark: true });
    // Bolt circle on the injector side of the flange.
    const nb = 16;
    const boltR = rc + t + rc * 0.08;
    for (let k = 0; k < nb; k++) {
      const a = (k / nb) * Math.PI * 2;
      const bolt = new THREE.CylinderGeometry(rc * 0.045, rc * 0.045, t * 1.1, 6);
      bolt.translate(Math.cos(a) * boltR, -t * 2.6 - t * 0.45, Math.sin(a) * boltR);
      list.push({ g: bolt });
    }
    const dome = new THREE.SphereGeometry(rc * 0.95, 64, 32, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    dome.scale(1, 0.55, 1);
    dome.translate(0, -t * 2.6, 0);
    list.push({ g: dome });
    const inlet = new THREE.CylinderGeometry(rc * 0.15, rc * 0.15, rc * 0.9, 48);
    inlet.translate(0, -rc * 0.9, 0);
    list.push({ g: inlet });
    const cap = new THREE.CylinderGeometry(rc * 0.23, rc * 0.23, rc * 0.1, 48);
    cap.translate(0, -rc * 1.35, 0);
    list.push({ g: cap, dark: true });
    if (regen) {
      const rAt = (a: number) => {
        for (let i = 0; i < prof.length - 1; i++) if (prof[i].x <= a && prof[i + 1].x >= a) return prof[i].r + ((a - prof[i].x) / (prof[i + 1].x - prof[i].x || 1)) * (prof[i + 1].r - prof[i].r);
        return prof[prof.length - 1].r;
      };
      const ring = (a: number) => {
        const g = new THREE.TorusGeometry(rAt(a) + t + tube, tube, 24, 120);
        g.rotateX(Math.PI / 2);
        g.translate(0, a, 0);
        return g;
      };
      const aOut = lc * 0.28;
      const aIn = L - (L - aThroat) * 0.22;
      list.push({ g: ring(aOut), dark: true }, { g: ring(aIn), dark: true });
      // Fuel return: from the outlet manifold, up and over into the injector dome.
      const ret = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-(rc + t + tube * 2), aOut, 0),
        new THREE.Vector3(-(rc * 1.45), aOut * 0.7, 0),
        new THREE.Vector3(-(rc * 1.5), -rc * 0.15, 0),
        new THREE.Vector3(-(rc * 0.6), -rc * 0.42, 0),
      ]);
      list.push({ g: new THREE.TubeGeometry(ret, 64, rc * 0.06, 20, false) });
      // Fuel inlet: a radial stub off the inlet manifold, hanging below.
      const stub = new THREE.CylinderGeometry(rc * 0.06, rc * 0.06, rc * 0.55, 24);
      stub.rotateZ(Math.PI / 2);
      stub.translate(rAt(aIn) + t + tube + rc * 0.275, aIn, 0);
      list.push({ g: stub });
    }
    return list;
  }, [geo, l0, l2]);

  const channels = Number(design.params?.["cooling.channel_count"] ?? 0) || 80;
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#e4e4e4", metalness: 0.45, roughness: 0.3, side: THREE.DoubleSide }), []);
  const machined = useMemo(() => {
    // Milled channels read as fine axial striations around the jacket.
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 4;
    const g = c.getContext("2d")!;
    g.fillStyle = "#808080";
    g.fillRect(0, 0, c.width, c.height);
    const step = c.width / channels;
    g.fillStyle = "#3a3a3a";
    for (let i = 0; i < channels; i++) g.fillRect(i * step, 0, Math.max(1.5, step * 0.28), c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ color: "#e4e4e4", metalness: 0.45, roughness: 0.34, bumpMap: tex, bumpScale: 1.2, side: THREE.DoubleSide });
  }, [channels]);
  const metalDark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8f8f8f", metalness: 0.5, roughness: 0.38, side: THREE.DoubleSide }), []);
  useEffect(() => () => parts.forEach((p) => p.g.dispose()), [parts]);

  // Fit the figure, then project the callout anchors into the overlay's pixels.
  useEffect(() => {
    if (!size.width || !size.height) return;
    const cam = camera as THREE.OrthographicCamera;
    const len = geo.aMax - geo.aMin;
    const tall = 2 * (Math.max(geo.rc, geo.re) + geo.t + geo.rc * 0.5);
    cam.zoom = Math.min((size.width * 0.6) / len, (size.height * 0.72) / tall);
    const tilt = (14 * Math.PI) / 180;
    cam.position.set(0, Math.sin(tilt) * 10, Math.cos(tilt) * 10);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const pts = geo.anchors.map(([r, a]) => {
      // Group space (x radial, y axial) → world: axial becomes +X, radial becomes −Y.
      const v = new THREE.Vector3(a - centre, -r, 0).project(cam);
      return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
    });
    onAnchors(pts);
    invalidate();
  }, [size.width, size.height, camera, geo, centre, onAnchors, invalidate]);

  return (
    <>
      <OrthographicCamera makeDefault near={-100} far={100} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[2, 6, 5]} intensity={2.4} />
      <directionalLight position={[-4, 3, -4]} intensity={1.1} />
      <directionalLight position={[0, -5, 3]} intensity={0.35} />
      <group position={[-centre, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        {parts.map((p, i) => (
          <mesh key={i} geometry={p.g} material={p.shell ? machined : p.dark ? metalDark : metal} />
        ))}
      </group>
    </>
  );
}
