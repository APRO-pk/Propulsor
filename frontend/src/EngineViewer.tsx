import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { SCENE } from "./theme";
import { VIEW_MODES, useViewMode } from "./viewModes";
import { useEngineStore } from "./store";
import { useSharedState } from "./sharedState";
import { ambientPressure, exhaust } from "./exhaust";
import { PhysicalPlume } from "./PhysicalPlume";
import { analysisStudy, type L0ResultDto, type L2ResultDto, type AnalysisStudyDto } from "./api";

const SEGMENTS = 128;
const N_LEVELS = 12;
type StressStation = AnalysisStudyDto["stress"]["stations"][number];

/** Classic FEM "jet" colormap, t in [0,1] → [r,g,b] in [0,1] (blue→red). */
function jet(t: number): [number, number, number] {
  const c = (x: number) => Math.max(0, Math.min(1, x));
  return [
    c(Math.min(4 * t - 1.5, -4 * t + 4.5)),
    c(Math.min(4 * t - 0.5, -4 * t + 3.5)),
    c(Math.min(4 * t + 0.5, -4 * t + 2.5)),
  ];
}

/** Input-free time after which the plume and flow animation hold still. */
const IDLE_MS = 12000;

/** Which part of the engine the current selection is about. */
export type EngineZone = "injector" | "chamber" | "nozzle" | "jacket";

/**
 * The workbench stage: the live 3D engine, always on screen. Honours the L2
 * contour (bell vs conical), lights the part selected in the feature tree, and
 * switches display mode — shaded metal, combustion gas by temperature, FEM-style
 * wall stress, or Mach-coloured flow. Renders on demand unless something moves.
 */
export function EngineViewer({
  l0,
  l2,
  highlight = [],
  inset,
  selectionLabel,
  rightInset = 0,
  bottomInset = 0,
  topInset = 0,
  onSpecSheet,
}: {
  l0: L0ResultDto;
  l2?: L2ResultDto | null;
  highlight?: EngineZone[];
  inset?: ReactNode;
  /** Label for the selected part, drawn on the model in the selection accent. */
  selectionLabel?: string;
  /** Pixels of the stage's right side covered by a floating window; the engine is framed in the rest. */
  rightInset?: number;
  /** Pixels of the stage's bottom covered by a window docked along it (narrow stages). */
  bottomInset?: number;
  /** Pixels at the top the engine should also keep clear of when a window docks below (the stage toolbar). */
  topInset?: number;
  onSpecSheet?: () => void;
}) {
  const [mode, setMode] = useViewMode();
  const [section, setSection] = useState(true);
  const [wire, setWire] = useState(false);
  const [channels, setChannels] = useState(false);
  const [bands, setBands] = useState(true);
  const [isolines, setIsolines] = useState(true);
  const [plume, setPlume] = useState(true);
  const [stress, setStress] = useState<StressStation[] | null>(null);
  const [loadingStress, setLoadingStress] = useState(false);
  const [ready, setReady] = useState(false);
  const still = useMemo(prefersReducedMotion, []);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const controlsRef = useRef<OrbitControlsLike | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const annRefs = useRef<AnnRefs>({ paths: [], labels: [] });
  // Read at frame time, so the camera always fits the latest uncovered width.
  // Ignition: on every solve the gas warms from ember to full temperature and the
  // plume grows out of the exit plane. One uniform drives both shaders.
  const ignite = useMemo(() => ({ value: 1 }), []);
  const solveCount = useEngineStore((s) => s.solveCount);
  const insetRef = useRef({ right: rightInset, bottom: bottomInset, top: topInset });
  insetRef.current = { right: rightInset, bottom: bottomInset, top: topInset };
  const stressMode = mode === "stress";
  const flow = mode === "flow";

  const model = useMemo(() => buildEngineGeometry(l0, l2 ?? null), [l0, l2]);
  const channelGeoms = useMemo(() => (channels ? buildChannels(model.inner, model.wall, model.gap, 20) : []), [channels, model]);
  const mach = useMemo(() => machProfile(model.inner, l2?.exit_mach ?? 2.8), [model, l2]);

  useEffect(() => {
    if (stressMode && !stress) {
      setLoadingStress(true);
      analysisStudy()
        .then((a) => setStress(a.stress.stations))
        .catch(() => {})
        .finally(() => setLoadingStress(false));
    }
  }, [stressMode, stress]);
  // A new design invalidates the cached stress field.
  useEffect(() => setStress(null), [l0, l2]);

  const range = useMemo(() => {
    if (!stress?.length) return null;
    const vals = stress.map((s) => s.combined_stress_pa);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    // Yield stress ≈ combined·margin (constant for a single material/allowable).
    const allow = stress.map((s) => s.combined_stress_pa * s.margin).sort((a, b) => a - b)[Math.floor(stress.length / 2)];
    return { min, max, allow };
  }, [stress]);

  const stressColors = useMemo(
    () => (stressMode && stress && range ? computeStressColors(model.outline, stress, range.min, range.max, bands) : null),
    [stressMode, stress, range, model, bands],
  );

  const isolineRings = useMemo(
    () => (stressMode && isolines && stress && range ? buildIsolines(model.inner, model.wall, stress, range.min, range.max) : []),
    [stressMode, isolines, stress, range, model],
  );

  useEffect(() => {
    const g = model.geometry;
    if (stressColors) g.setAttribute("color", new THREE.BufferAttribute(stressColors, 3));
    else g.deleteAttribute("color");
    // Toggling vertexColors needs a shader recompile to take effect.
    if (matRef.current) matRef.current.needsUpdate = true;
  }, [model, stressColors]);

  const clip = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), []);
  const cam = Math.max(model.length, 0.05) * 1.9;
  const showPlume = plume && !stressMode;
  // Only the plume flicker and flow particles move; everything else renders on demand.
  const animating = !still && (showPlume || flow);
  // The plume and flow particles animate at 30 fps, and only while someone is
  // working with the engine: after IDLE_MS without input over the viewport (or
  // a design or mode change) they hold still and the stage costs nothing.
  const viewerRef = useRef<HTMLDivElement>(null);
  const invalidateStage = useRef<(() => void) | null>(null);
  const [awake, setAwake] = useState(true);
  const awakeRef = useRef(true);
  // While the user orbits or zooms, render at the display rate so the camera tracks the hand.
  const [interacting, setInteracting] = useState(false);
  // The orbit hint teaches once; after the first orbit or zoom it stays away.
  const [orbited, setOrbited] = useState(() => {
    try {
      return localStorage.getItem("propulsor.orbited") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!interacting || orbited) return;
    setOrbited(true);
    try {
      localStorage.setItem("propulsor.orbited", "1");
    } catch {
      /* the hint returns next session */
    }
  }, [interacting, orbited]);
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    let wheelTimer = 0;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).tagName === "CANVAS") setInteracting(true);
    };
    const up = () => setInteracting(false);
    const wheel = () => {
      setInteracting(true);
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(up, 250);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    return () => {
      window.clearTimeout(wheelTimer);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
    };
  }, []);
  useEffect(() => {
    const el = viewerRef.current;
    if (!animating || !el) return;
    let timer = 0;
    const sleep = () => {
      awakeRef.current = false;
      setAwake(false);
    };
    const wake = () => {
      if (!awakeRef.current) {
        awakeRef.current = true;
        setAwake(true);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(sleep, IDLE_MS);
    };
    wake();
    const events = ["pointermove", "pointerdown", "wheel", "keydown"] as const;
    events.forEach((ev) => el.addEventListener(ev, wake, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((ev) => el.removeEventListener(ev, wake));
    };
  }, [animating, l0, l2, mode]);
  const exitTr = 1 / (1 + ((GAMMA - 1) / 2) * Math.pow(l2?.exit_mach ?? 2.8, 2));
  // The exhaust at a chosen ambient: sea level to vacuum. Its shape is the nozzle's expansion state.
  const [altKm, setAltKm] = useSharedState("viewer.altitude", 0);
  const pa = altKm >= 100 ? 0 : ambientPressure(altKm * 1000);
  const ex = useMemo(() => exhaust(l2?.exit_pressure_pa ?? 101325, l2?.exit_mach ?? 2.8, GAMMA, pa), [l2, pa]);
  const [webgl2, setWebgl2] = useState(true);

  return (
    <div className="viewer3d" ref={viewerRef}>
      <Canvas
        frameloop={interacting ? "always" : "demand"}
        dpr={[1, 2]}
        gl={{ alpha: true, preserveDrawingBuffer: false }}
        camera={{ position: [0, cam * 0.15, cam], fov: 30, near: 0.001, far: 100 }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
          setWebgl2(gl.capabilities.isWebGL2);
        }}
      >
        <hemisphereLight args={[SCENE.sky, SCENE.ground, 1.0]} />
        <directionalLight position={[cam, cam * 1.5, cam]} intensity={stressMode ? 1.6 : 2.2} />
        <directionalLight position={[-cam * 1.2, cam * 0.5, cam * 0.4]} intensity={0.7} color={SCENE.fillCool} />
        <directionalLight position={[cam * 0.3, -cam * 0.6, -cam]} intensity={0.6} color={SCENE.rimHot} />

        {/* Side elevation: injector on the left, nozzle and plume to the right. */}
        <group ref={groupRef} rotation={[0, 0, -Math.PI / 2]}>
          <mesh geometry={model.geometry}>
            <meshStandardMaterial
              ref={matRef}
              color={stressMode ? "#ffffff" : SCENE.metal}
              vertexColors={stressMode && !!stressColors}
              metalness={stressMode ? 0.0 : 0.6}
              roughness={stressMode ? 0.9 : 0.38}
              side={THREE.DoubleSide}
              clippingPlanes={section ? [clip] : []}
              clipShadows
              wireframe={wire}
              transparent={flow}
              opacity={flow ? 0.22 : 1}
              depthWrite={!flow}
            />
          </mesh>
          {isolineRings.map((pos, i) => (
            <lineLoop key={i}>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[pos, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color="#101014" transparent opacity={0.55} />
            </lineLoop>
          ))}
          {channelGeoms.map((g, i) => (
            <mesh key={i} geometry={g}>
              <meshStandardMaterial color={SCENE.coolant} metalness={0.3} roughness={0.5} clippingPlanes={section ? [clip] : []} />
            </mesh>
          ))}
          {flow && <FlowStreamlines inner={model.inner} mach={mach} />}
          {mode === "hot" && <HotGas inner={model.inner} mach={mach} section={section} clip={clip} ignite={ignite} />}
          {showPlume &&
            (webgl2 && l2 ? (
              <PhysicalPlume inner={model.inner} length={model.length} ignite={ignite} ex={ex} still={still} />
            ) : (
              <Plume inner={model.inner} length={model.length} ignite={ignite} />
            ))}
          {section && <CutEdges outline={model.outline} />}
          {highlight.length > 0 && !stressMode && <Highlight inner={model.inner} wall={model.wall} zones={highlight} section={section} clip={clip} />}
        </group>

        <ContactShadows key={model.length} position={[0, -model.rMax * 1.85, 0]} scale={model.length * 3.2} far={model.rMax * 4} blur={2.6} opacity={0.55} frames={1} />
        <OrbitControls ref={controlsRef as never} enableDamping dampingFactor={0.08} minDistance={cam * 0.2} maxDistance={cam * 6} />
        <CameraRig length={model.length} rMax={model.rMax} controls={controlsRef} inset={insetRef} insetPx={`${rightInset}:${bottomInset}:${topInset}`} />
        <Annotations group={groupRef} refs={annRefs} model={model} zones={highlight} show={!stressMode && !flow} hasSelection={!!selectionLabel} />
        <FirstFrame onReady={() => setReady(true)} />
        <Pacer active={animating && awake} fps={30} />
        <Ignition uniform={ignite} trigger={solveCount} gentle={still} />
        <InvalidateHandle target={invalidateStage} />
      </Canvas>

      <div className="viewer3d-toolbar">
        <div className="seg seg-lg" role="group" aria-label="Display mode">
          {VIEW_MODES.map(([m, label]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
          ))}
          {onSpecSheet && (
            <button aria-pressed={false} onClick={onSpecSheet} title="Present the engine as a spec sheet">Spec sheet</button>
          )}
        </div>
        <div className="vt-toggles">
          <button className={`chip ${section ? "on" : ""}`} aria-pressed={section} onClick={() => setSection((s) => !s)}>Section</button>
          <button className={`chip ${plume ? "on" : ""}`} aria-pressed={plume} disabled={stressMode} onClick={() => setPlume((p) => !p)}>Plume</button>
          <button className={`chip ${channels ? "on" : ""}`} aria-pressed={channels} onClick={() => setChannels((c) => !c)}>Channels</button>
          <button className={`chip ${wire ? "on" : ""}`} aria-pressed={wire} onClick={() => setWire((w) => !w)}>Wire</button>
          {stressMode && <button className={`chip ${bands ? "on" : ""}`} aria-pressed={bands} onClick={() => setBands((b) => !b)}>Bands</button>}
          {stressMode && <button className={`chip ${isolines ? "on" : ""}`} aria-pressed={isolines} onClick={() => setIsolines((i) => !i)}>Isolines</button>}
          <button className="chip" onClick={() => controlsRef.current?.reset()} title="Reset the camera to fit the model">Reset view</button>
        </div>
      </div>

      {!stressMode && !flow && (
        <>
          <svg className="viewer3d-ann" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <path key={i} ref={(el) => { annRefs.current.paths[i] = el; }} className={i === 2 ? "ann-sel" : "ann-dim"} />
            ))}
          </svg>
          <div className="ann-label" ref={(el) => { annRefs.current.labels[0] = el; }}>
            Throat <b>Ø{(l0.throat_diameter * 1000).toFixed(1)} mm</b>
          </div>
          <div className="ann-label" ref={(el) => { annRefs.current.labels[1] = el; }}>
            Exit <b>Ø{(l0.exit_diameter * 1000).toFixed(1)} mm</b> · ε {(l2?.area_ratio ?? l0.area_ratio).toFixed(2)}
          </div>
          <div className="ann-label ann-sel-label" ref={(el) => { annRefs.current.labels[2] = el; }}>{selectionLabel}</div>
        </>
      )}
      {inset && !stressMode && <div className="viewer3d-inset">{inset}</div>}
      {stressMode && range && <ColorBar min={range.min} max={range.max} allow={range.allow} bands={bands} />}
      {flow && <MachBar exitMach={l2?.exit_mach ?? 2.8} />}
      {showPlume && l2 && (
        <div className="viewer3d-ambient">
          <label htmlFor="ambient-alt">Ambient</label>
          <input
            id="ambient-alt"
            type="range"
            min={0}
            max={100}
            step={1}
            value={altKm}
            onChange={(e) => {
              setAltKm(Number(e.target.value));
              invalidateStage.current?.();
            }}
            aria-valuetext={altKm >= 100 ? "vacuum" : `${altKm} kilometres`}
          />
          <span className="amb-alt">{altKm === 0 ? "Sea level" : altKm >= 100 ? "Vacuum" : `${altKm} km`}</span>
          <span className={`amb-state ${ex.separationRisk ? "risk" : ""}`}>
            {ex.state === "vacuum"
              ? "Vacuum expansion"
              : ex.state === "over"
                ? ex.separationRisk
                  ? "Over-expanded · separation risk"
                  : "Over-expanded"
                : ex.state === "under"
                  ? "Under-expanded"
                  : "Matched"}
            {ex.state !== "vacuum" && <> · P<sub>e</sub>/P<sub>a</sub> {ex.n < 10 ? ex.n.toFixed(2) : ex.n.toFixed(0)}</>}
          </span>
        </div>
      )}
      {mode === "hot" && (
        <div className="viewer3d-legend">
          <span>Gas temperature T/T<sub>c</sub></span>
          <span className="heat-bar" />
          <span>{exitTr.toFixed(2)} – 1.00</span>
        </div>
      )}
      {(!ready || loadingStress) && (
        <div className="viewer3d-loading" role="status">
          <div className="spinner" />
          {!ready ? "Initializing 3D view…" : "Computing stress field…"}
        </div>
      )}
      {!orbited && <div className="viewer3d-hint">Drag to orbit · scroll to zoom</div>}
    </div>
  );
}

type OrbitControlsLike = { reset: () => void; saveState: () => void; target: THREE.Vector3; update: () => void };
type AnnRefs = { paths: (SVGPathElement | null)[]; labels: (HTMLDivElement | null)[] };

/**
 * Fits the camera to a near side elevation: the engine fills about 60% of the
 * stage width with the plume running out to the right. Refits whenever the
 * stage size or the engine changes; Reset view returns to the fitted pose.
 */
function CameraRig({ length, rMax, controls, inset: insetRef, insetPx }: { length: number; rMax: number; controls: React.MutableRefObject<OrbitControlsLike | null>; inset: React.MutableRefObject<{ right: number; bottom: number; top: number }>; insetPx: string }) {
  const fitted = useRef("");
  const prevStage = useRef("");
  const glide = useRef<{ fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; t0: number } | null>(null);
  const reduced = useMemo(prefersReducedMotion, []);
  // The stage renders on demand: ask for a frame so a new inset gets fitted.
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [insetPx, invalidate]);
  useFrame(({ camera, size, invalidate }) => {
    if (!size.width || !size.height) return;
    const inset = Math.min(insetRef.current.right, size.width * 0.55);
    const below = Math.min(insetRef.current.bottom, size.height * 0.6);
    const above = below ? Math.min(insetRef.current.top, size.height * 0.3) : 0;
    const key = `${size.width}x${size.height}:${length.toFixed(5)}:${rMax.toFixed(5)}:${inset}:${below}:${above}`;
    if (fitted.current === key) return;
    fitted.current = key;
    const cam = camera as THREE.PerspectiveCamera;
    const free = size.width - inset;
    const freeH = Math.max(40, size.height - below - above);
    const aspect = free / size.height;
    const tanV = Math.tan(((cam.fov / 2) * Math.PI) / 180);
    const byWidth = length / 0.6 / (2 * tanV * aspect);
    // A window docked along the bottom leaves a band of freeH: fit the engine's height to that band.
    const byHeight = ((rMax * 2) / 0.42 / (2 * tanV)) * (size.height / freeH);
    const d = Math.max(byWidth, byHeight);
    // Centre the engine in the uncovered part: shift by half the covered width (and height), in world units at the target.
    const worldPerPx = (2 * d * tanV) / size.height;
    const tx = length * 0.16 + (inset / 2) * worldPerPx;
    const ty = -((below - above) / 2) * worldPerPx;
    const tilt = (9 * Math.PI) / 180;
    const toPos = new THREE.Vector3(tx, ty + Math.sin(tilt) * d, Math.cos(tilt) * d);
    const toTarget = new THREE.Vector3(tx, ty, 0);
    cam.updateProjectionMatrix();
    // A window opening or closing glides the engine aside; a first fit, a new
    // engine or a resized stage lands at once.
    const sameStage = prevStage.current === `${size.width}x${size.height}:${length.toFixed(5)}:${rMax.toFixed(5)}`;
    prevStage.current = `${size.width}x${size.height}:${length.toFixed(5)}:${rMax.toFixed(5)}`;
    const c = controls.current;
    if (sameStage && !reduced && c) {
      glide.current = { fromPos: cam.position.clone(), fromTarget: c.target.clone(), toPos, toTarget, t0: performance.now() };
    } else {
      glide.current = null;
      cam.position.copy(toPos);
      cam.lookAt(toTarget);
      if (c) {
        c.target.copy(toTarget);
        c.update();
        c.saveState();
      }
    }
    invalidate();
  });
  useFrame(({ camera, invalidate }) => {
    const g = glide.current;
    const c = controls.current;
    if (!g || !c) return;
    const t = Math.min(1, (performance.now() - g.t0) / 380);
    const e = 1 - Math.pow(1 - t, 4);
    camera.position.lerpVectors(g.fromPos, g.toPos, e);
    c.target.lerpVectors(g.fromTarget, g.toTarget, e);
    c.update();
    if (t >= 1) {
      glide.current = null;
      c.saveState();
    } else invalidate();
  });
  return null;
}

type Rect = { x: number; y: number; w: number; h: number };
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Dimension leaders for the throat and exit, and the selected part's label,
 * projected from the model every rendered frame so they follow the orbit.
 * Labels stay inside the stage and clear of the toolbar, inset, legend and
 * each other: each tries its preferred side, then the opposite side, then
 * steps further out; one that cannot be placed cleanly is hidden.
 */
function Annotations({
  group,
  refs,
  model,
  zones,
  show,
  hasSelection,
}: {
  group: React.RefObject<THREE.Group>;
  refs: React.MutableRefObject<AnnRefs>;
  model: { inner: THREE.Vector2[]; wall: number };
  zones: EngineZone[];
  show: boolean;
  hasSelection: boolean;
}) {
  const { camera, size } = useThree();
  const pts = useMemo(() => {
    const inner = model.inner;
    const n = inner.length;
    const ti = inner.reduce((b, p, i) => (p.x < inner[b].x ? i : b), 0);
    const w = model.wall;
    // Local group space: +x is radial (down on screen), y is axial. Top edge = −x.
    const top = (p: THREE.Vector2) => new THREE.Vector3(-(p.x + w), p.y, 0);
    const bottom = (p: THREE.Vector2) => new THREE.Vector3(p.x + w, p.y, 0);
    const z = zones[0];
    const mid = (a: number, b: number) => inner[Math.round((a + b) / 2)];
    const sel = z === "nozzle" ? mid(ti, n - 1) : z === "injector" ? inner[0] : mid(0, ti);
    // [above-anchor, below-anchor] per annotation: throat, exit, selection.
    return [
      [top(inner[ti]), bottom(inner[ti])],
      [top(inner[n - 1]), bottom(inner[n - 1])],
      [top(sel), bottom(sel)],
    ] as [THREE.Vector3, THREE.Vector3][];
  }, [model, zones]);
  // The engine body, sampled around the axis, so labels never sit on the model.
  const body = useMemo(() => {
    const out: THREE.Vector3[] = [];
    const step = Math.max(1, Math.floor(model.inner.length / 24));
    for (let i = 0; i < model.inner.length; i += step) {
      const p = model.inner[i];
      const r = p.x + model.wall;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        out.push(new THREE.Vector3(Math.cos(a) * r, p.y, Math.sin(a) * r));
      }
    }
    return out;
  }, [model]);
  const v = useMemo(() => new THREE.Vector3(), []);
  // Preferred placement per annotation: [vertical side (−1 up, +1 down), horizontal run sign].
  const pref: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, -1],
  ];

  // Per-frame cost is kept to arithmetic: DOM measurements are taken in one
  // batch before any write (no read/write interleaving), the stage obstacles
  // are re-measured at most every 250 ms, nothing is recomputed while the
  // camera and the measurements are unchanged, and only changed values are
  // written back.
  const cache = useRef({ key: "", obstAt: -1e9, obst: [] as Rect[], obstSig: "", d: ["", "", ""], tf: ["", "", ""], vis: ["", "", ""] });

  useFrame(() => {
    const g = group.current;
    const first = refs.current.labels[0];
    if (!g || !first) return;
    const host = first.parentElement;
    if (!host) return;
    const C = cache.current;

    // ---- Read phase.
    const now = performance.now();
    if (now - C.obstAt > 250) {
      C.obstAt = now;
      const hostBox = host.getBoundingClientRect();
      const rel = (el: Element | null): Rect | null => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return { x: r.left - hostBox.left - 6, y: r.top - hostBox.top - 6, w: r.width + 12, h: r.height + 12 };
      };
      C.obst = [
        rel(host.querySelector(".viewer3d-toolbar .seg")),
        rel(host.querySelector(".vt-toggles")),
        rel(host.querySelector(".viewer3d-inset")),
        rel(host.querySelector(".viewer3d-legend")),
        rel(host.querySelector(".viewer3d-ambient")),
        rel(document.querySelector(".stage-tip")),
        rel(host.querySelector(".viewer3d-hint")),
        rel(document.querySelector(".float-win")),
      ].filter(Boolean) as Rect[];
      C.obstSig = C.obst.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(";");
    }
    const sizes = refs.current.labels.map((l) => (l ? [l.offsetWidth, l.offsetHeight || 18] : [0, 18]));
    const key = [
      // Rounded, so the last sub-pixel creep of the orbit damping counts as still.
      camera.matrixWorld.elements.map((e) => e.toFixed(4)).join(","),
      camera.projectionMatrix.elements.map((e) => e.toFixed(4)).join(","),
      size.width,
      size.height,
      show,
      hasSelection,
      sizes.join(","),
      C.obstSig,
    ].join("|");
    if (key === C.key) return;
    C.key = key;

    // ---- Compute phase.
    const blocked: Rect[] = [...C.obst];
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of body) {
      v.copy(p).applyMatrix4(g.matrixWorld).project(camera);
      if (v.z >= 1) continue;
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
    }
    if (bx1 > bx0) blocked.push({ x: bx0 - 6, y: by0 - 6, w: bx1 - bx0 + 12, h: by1 - by0 + 12 });
    const pad = 8;
    const labelsPlaced: Rect[] = [];
    const out: { d: string; tf: string; vis: string }[] = [0, 1, 2].map(() => ({ d: "", tf: "", vis: "hidden" }));

    const order = [2, 0, 1]; // place the selection first so the dimensions route around it
    for (const i of order) {
      if (!refs.current.paths[i] || !refs.current.labels[i]) continue;
      if (!show || (i === 2 && !hasSelection)) continue;
      const [lw, lh] = sizes[i];
      let placed: { ax: number; ay: number; ey: number; lx: number; side: number } | null = null;
      const [prefSide, run] = pref[i];
      for (const [side, runDir] of [[prefSide, run], [prefSide, -run], [-prefSide, run], [-prefSide, -run]] as [number, number][]) {
        const anchor = pts[i][side < 0 ? 0 : 1];
        v.copy(anchor).applyMatrix4(g.matrixWorld).project(camera);
        if (v.z >= 1) continue;
        const ax = ((v.x + 1) / 2) * size.width;
        const ay = ((1 - v.y) / 2) * size.height;
        for (let step = 0; step < 6 && !placed; step++) {
          const ey = ay + side * (52 + step * 22);
          let lx = runDir > 0 ? ax + 30 : ax - 30 - lw;
          lx = Math.max(pad, Math.min(size.width - pad - lw, lx));
          // Pushed against the stage edge, a label can end up over its own anchor: the leader would strike through it.
          if (ax > lx - 10 && ax < lx + lw + 10) continue;
          const box = { x: lx, y: ey - lh / 2, w: lw, h: lh };
          if (box.y < pad || box.y + box.h > size.height - pad) break;
          if (blocked.some((b) => hit(box, b))) continue;
          // The leader (vertical run, then the horizontal run to the label) must not cross a placed label.
          const vRun = { x: ax - 2, y: Math.min(ay, ey), w: 4, h: Math.abs(ey - ay) };
          const hx0 = Math.min(ax, lx + lw / 2);
          const hRun = { x: hx0, y: ey - 2, w: Math.abs(ax - (lx + lw / 2)), h: 4 };
          if (labelsPlaced.some((l) => hit(vRun, l) || hit(hRun, l))) continue;
          // Nor run across the stage toolbar, inset, legend or a window.
          if (C.obst.some((o) => hit(vRun, o) || hit(hRun, o))) continue;
          placed = { ax, ay, ey, lx, side };
          labelsPlaced.push({ x: box.x - 4, y: box.y - 3, w: box.w + 8, h: box.h + 6 });
          blocked.push({ x: box.x - 6, y: box.y - 4, w: box.w + 12, h: box.h + 8 });
          // The leader's vertical run also claims space so later labels don't sit on it.
          blocked.push({ x: ax - 3, y: Math.min(ay, ey), w: 6, h: Math.abs(ey - ay) });
        }
        if (placed) break;
      }
      if (!placed) continue;
      const { ax, ay, ey, lx } = placed;
      const toLeft = lx + lw / 2 < ax;
      const endX = toLeft ? lx + lw + 6 : lx - 6;
      out[i] = {
        d: "M" + ax.toFixed(1) + " " + ay.toFixed(1) + "V" + ey.toFixed(1) + "H" + endX.toFixed(1),
        tf: "translate(" + lx.toFixed(1) + "px, " + (ey - lh / 2).toFixed(1) + "px)",
        vis: "visible",
      };
    }

    // ---- Write phase: only what changed.
    for (let i = 0; i < 3; i++) {
      const path = refs.current.paths[i];
      const label = refs.current.labels[i];
      if (!path || !label) continue;
      const o = out[i];
      if (o.d !== C.d[i]) {
        path.setAttribute("d", o.d);
        C.d[i] = o.d;
      }
      if (o.vis !== C.vis[i]) {
        label.style.visibility = o.vis;
        C.vis[i] = o.vis;
      }
      if (o.tf && o.tf !== C.tf[i]) {
        label.style.transform = o.tf;
        C.tf[i] = o.tf;
      }
    }
  });
  return null;
}

/** The selected part, tinted in the selection accent on the shell. */
function Highlight({ inner, wall, zones, section, clip }: { inner: THREE.Vector2[]; wall: number; zones: EngineZone[]; section: boolean; clip: THREE.Plane }) {
  // The selection is an outline, never a fill: thin accent tubes traced along the
  // part's outer wall on the cut plane (and a ring for the injector face), so the
  // hot gas inside keeps its colour.
  const geoms = useMemo(() => {
    const n = inner.length;
    const throat = inner.reduce((b, p, i) => (p.x < inner[b].x ? i : b), 0);
    const tubeR = Math.max(wall * 0.35, inner[throat].x * 0.035);
    // Sit the tube on the outside of the wall so all of it shows, even when the engine is drawn small.
    const rOut = wall + tubeR * 0.8;
    const trace = (a: number, b: number) => {
      // Coincident profile points give the spline NaN tangents and an empty tube.
      const seg = inner.slice(a, b + 1).filter((p, i, all) => i === 0 || p.distanceTo(all[i - 1]) > 1e-7);
      return [1, -1].map((side) => {
        const pts = seg.map((p) => new THREE.Vector3(side * (p.x + rOut), p.y, 0));
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(24, seg.length * 3), tubeR, 8, false);
      });
    };
    const out: THREE.BufferGeometry[] = [];
    for (const z of zones) {
      if (z === "jacket") out.push(...trace(0, n - 1));
      if (z === "chamber") out.push(...trace(0, throat));
      if (z === "nozzle") out.push(...trace(throat, n - 1));
      if (z === "injector") {
        const g = new THREE.TorusGeometry(inner[0].x + rOut, tubeR, 8, 96);
        g.rotateX(Math.PI / 2);
        g.translate(0, inner[0].y, 0);
        out.push(g);
      }
    }
    return out;
  }, [inner, wall, zones]);
  // Double-sided: on straight runs the tube frames can wind inside-out, and the section keeps only its back half.
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: SCENE.selection, toneMapped: false, side: THREE.DoubleSide }), []);
  useEffect(() => {
    mat.clippingPlanes = section ? [clip] : [];
    mat.needsUpdate = true;
  }, [mat, section, clip]);
  useEffect(() => () => geoms.forEach((g) => g.dispose()), [geoms]);
  return (
    <>
      {geoms.map((g, i) => (
        <mesh key={i} geometry={g} material={mat} />
      ))}
    </>
  );
}

/** A numeric FEM colour-bar legend (von Mises stress, MPa) with a yield marker. */
function ColorBar({ min, max, allow, bands }: { min: number; max: number; allow: number; bands: boolean }) {
  const stops = Array.from({ length: 33 }, (_, i) => {
    let t = i / 32;
    if (bands) t = (Math.floor(t * N_LEVELS) + 0.5) / N_LEVELS;
    const [r, g, b] = jet(t);
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${(i / 32) * 100}%`;
  });
  const ticks = 5;
  const labels = Array.from({ length: ticks }, (_, i) => {
    const frac = 1 - i / (ticks - 1);
    return { top: `${(i / (ticks - 1)) * 100}%`, value: (min + frac * (max - min)) / 1e6 };
  });
  // Position of the yield stress on the bar (0% = top = max σ, 100% = bottom = min σ).
  const yieldPct = max > min ? (1 - (allow - min) / (max - min)) * 100 : 50;
  const yieldClamped = Math.max(0, Math.min(100, yieldPct));
  // When yield falls outside the stress range, clamp to the edge and say which way:
  // below the floor → the whole field exceeds yield; above the ceiling → all safe.
  const yieldLabel =
    yieldPct > 100 ? `yield ▾ ${(allow / 1e6).toFixed(0)} (all σ > yield)` : yieldPct < 0 ? `yield ▴ ${(allow / 1e6).toFixed(0)} (all σ < yield)` : `yield ${(allow / 1e6).toFixed(0)} ▸`;

  return (
    <div className="viewer3d-colorbar">
      <div className="cb-title">von Mises σ (MPa)</div>
      <div className="cb-row">
        <div className="cb-labels">
          {labels.map((l, i) => (
            <div key={i} className="cb-tick" style={{ top: l.top }}>{l.value.toFixed(0)}</div>
          ))}
          <div className="cb-yield" style={{ top: `${yieldClamped}%`, color: yieldPct > 100 ? "var(--fail)" : undefined }}>{yieldLabel}</div>
        </div>
        <div className="cb-bar" style={{ background: `linear-gradient(to top, ${stops.join(",")})` }} />
      </div>
    </div>
  );
}

/** Signals once the render loop has drawn its first frame (hides the init overlay). */
/**
 * Drives the ignition uniform 0 → 1 after each solve (and when the engine first
 * appears): 0.8 s with a confident ease-out, frames requested only while it runs.
 * Reduced motion keeps a short brightness fade and no growth.
 */
function Ignition({ uniform, trigger, gentle }: { uniform: { value: number }; trigger: number; gentle: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const start = useRef<number | null>(null);
  const dur = gentle ? 220 : 800;
  useEffect(() => {
    uniform.value = 0;
    start.current = performance.now();
    invalidate();
  }, [trigger, uniform, invalidate]);
  useFrame(() => {
    if (start.current === null) return;
    const t = Math.min(1, (performance.now() - start.current) / dur);
    uniform.value = 1 - Math.pow(1 - t, 3);
    if (t >= 1) start.current = null;
    else invalidate();
  });
  return null;
}

/** Exposes the canvas's invalidate() to DOM controls outside it. */
function InvalidateHandle({ target }: { target: React.MutableRefObject<(() => void) | null> }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    target.current = invalidate;
    return () => {
      target.current = null;
    };
  }, [invalidate, target]);
  return null;
}

/** Requests frames at a steady rate while something on stage animates; renders on demand otherwise. */
function Pacer({ active, fps }: { active: boolean; fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!active) return;
    invalidate();
    const id = window.setInterval(() => invalidate(), 1000 / fps);
    return () => window.clearInterval(id);
  }, [active, fps, invalidate]);
  return null;
}

function FirstFrame({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (!done.current) {
      done.current = true;
      onReady();
    }
  });
  return null;
}

/** Quasi-1D Mach profile along the contour: subsonic → 1 at the throat → exit. */
function machProfile(inner: THREE.Vector2[], exitMach: number): number[] {
  let ti = 0;
  for (let i = 1; i < inner.length; i++) if (inner[i].x < inner[ti].x) ti = i;
  const rt = inner[ti].x;
  const re = inner[inner.length - 1].x;
  const arExit = Math.max((re / rt) ** 2, 1.001);
  return inner.map((p, i) => {
    if (i <= ti) return 0.12 + 0.88 * (ti > 0 ? i / ti : 1);
    const ar = Math.max((p.x / rt) ** 2, 1);
    const frac = Math.max(0, Math.min(1, (ar - 1) / (arExit - 1)));
    return 1 + (exitMach - 1) * Math.sqrt(frac);
  });
}

/** Animated gas-flow streamlines: particles advance along the nozzle at a rate
 *  and colour set by the local Mach number (blue slow → red supersonic). */
function FlowStreamlines({ inner, mach }: { inner: THREE.Vector2[]; mach: number[] }) {
  const rt = Math.min(...inner.map((p) => p.x));
  const { curves, tubes } = useMemo(() => {
    const fractions = [0.32, 0.6, 0.85];
    const angles = [0, 60, 120, 180, 240, 300].map((d) => (d * Math.PI) / 180);
    const cs: THREE.CatmullRomCurve3[] = [];
    for (const f of fractions) {
      for (const th of angles) {
        const pts = inner.map((p) => new THREE.Vector3(f * p.x * Math.cos(th), p.y, f * p.x * Math.sin(th)));
        cs.push(new THREE.CatmullRomCurve3(pts));
      }
    }
    return { curves: cs, tubes: cs.map((c) => new THREE.TubeGeometry(c, 80, rt * 0.018, 5, false)) };
  }, [inner, rt]);

  const perStream = 6;
  const count = curves.length * perStream;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => {
    const arr: { c: number; u: number }[] = [];
    for (let c = 0; c < curves.length; c++) for (let k = 0; k < perStream; k++) arr.push({ c, u: k / perStream });
    return arr;
  }, [curves]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const size = rt * 0.2;
  const machAt = (u: number) => mach[Math.max(0, Math.min(mach.length - 1, Math.round(u * (mach.length - 1))))];

  useFrame((_, dt) => {
    const m = meshRef.current;
    if (!m) return;
    const step = Math.min(dt, 0.05);
    parts.forEach((p, i) => {
      const speed = machAt(p.u);
      p.u = (p.u + step * (0.04 + 0.13 * speed)) % 1;
      const pos = curves[p.c].getPointAt(p.u);
      dummy.position.copy(pos);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      const [r, g, b] = jet(Math.max(0, Math.min(1, speed / 3)));
      col.setRGB(r, g, b);
      m.setColorAt(i, col);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <>
      {tubes.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial color={SCENE.streamline} transparent opacity={0.32} depthWrite={false} />
        </mesh>
      ))}
      <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}

const GAMMA = 1.2;
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Incandescence ramp, u in [0,1]: deep red → orange → white-hot. */
function hotRamp(u: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [0.3, 0.03, 0.02]],
    [0.35, [0.8, 0.16, 0.04]],
    [0.65, [1.0, 0.42, 0.1]],
    [0.88, [1.0, 0.72, 0.34]],
    [1, [1.0, 0.96, 0.88]],
  ];
  const t = Math.max(0, Math.min(1, u));
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (t <= b) {
      const f = (t - a) / (b - a);
      return [ca[0] + f * (cb[0] - ca[0]), ca[1] + f * (cb[1] - ca[1]), ca[2] + f * (cb[2] - ca[2])];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Combustion gas inside the chamber, coloured by its static temperature
 * T/Tc = 1 / (1 + (γ−1)/2·M²) along the quasi-1D Mach profile: white-hot in the
 * chamber, cooling through the throat to a dull red at the exit.
 */
function HotGas({ inner, mach, section, clip, ignite }: { inner: THREE.Vector2[]; mach: number[]; section: boolean; clip: THREE.Plane; ignite: { value: number } }) {
  const geometry = useMemo(() => {
    const seg = 96;
    const pts = inner.map((p) => new THREE.Vector2(p.x * 0.95, p.y));
    const g = new THREE.LatheGeometry(pts, seg);
    const per = pts.length;
    const colors = new Float32Array((seg + 1) * per * 3);
    const ramp = mach.map((m) => hotRamp((1 / (1 + ((GAMMA - 1) / 2) * m * m) - 0.35) / 0.65));
    for (let i = 0; i <= seg; i++) {
      for (let j = 0; j < per; j++) {
        const [r, gg, b] = ramp[j];
        const k = (i * per + j) * 3;
        colors[k] = r;
        colors[k + 1] = gg;
        colors[k + 2] = b;
      }
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [inner, mach]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: THREE.BackSide,
        clipping: true,
        uniforms: { uIgnite: ignite },
        vertexShader: GAS_VERT,
        fragmentShader: GAS_FRAG,
      }),
    [ignite],
  );
  useEffect(() => {
    material.clippingPlanes = section ? [clip] : [];
    material.needsUpdate = true;
  }, [material, section, clip]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} />;
}

// Luminous-gas shading: the temperature colour brightens toward grazing angles,
// so the core reads as a glowing volume rather than a painted surface.
const GAS_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  vColor = color;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewV = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const GAS_FRAG = /* glsl */ `
#include <clipping_planes_pars_fragment>
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewV;
uniform float uIgnite;
void main() {
  #include <clipping_planes_fragment>
  float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
  float rim = pow(1.0 - facing, 1.4);
  // Ignition: from a dim ember red to the full temperature colour.
  vec3 ember = vec3(0.32, 0.06, 0.02) * (0.6 + 0.4 * vColor.r);
  vec3 c = mix(ember, vColor, uIgnite) * (0.92 + 0.3 * rim);
  gl_FragColor = vec4(min(c, vec3(1.0)), 0.96);
}`;

// Plume gas: the jet is bright along its axis and fades to nothing at its edge,
// so it reads as glowing gas with depth rather than a solid cone.
const PLUME_FRAG = /* glsl */ `
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewV;
uniform float uIgnite;
void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
  float core = pow(facing, 1.5);
  vec3 c = min(vColor * core * 1.7 * uIgnite, vec3(1.0));
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
}`;

/** Exhaust plume past the exit plane: additive and flickering; held still under reduced motion. */
function Plume({ inner, length, ignite }: { inner: THREE.Vector2[]; length: number; ignite: { value: number } }) {
  const exit = inner[inner.length - 1];
  const re = exit.x;
  const lp = Math.max(length * 1.1, re * 5);
  const outerRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const still = useMemo(prefersReducedMotion, []);

  const { outer, core } = useMemo(() => {
    const make = (profile: [number, number][], bright: number) => {
      const seg = 64;
      const pts = profile.map(([r, t]) => new THREE.Vector2(Math.max(r * re, 1e-5), exit.y + t * lp));
      const g = new THREE.LatheGeometry(pts, seg);
      const per = pts.length;
      const colors = new Float32Array((seg + 1) * per * 3);
      for (let i = 0; i <= seg; i++) {
        for (let j = 0; j < per; j++) {
          const fade = Math.pow(1 - profile[j][1], 1.6);
          const [r, gg, b] = hotRamp(0.45 + 0.55 * fade);
          const k = (i * per + j) * 3;
          colors[k] = r * fade * bright;
          colors[k + 1] = gg * fade * bright;
          colors[k + 2] = b * fade * bright;
        }
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      return g;
    };
    return {
      outer: make([[0.98, 0], [1.12, 0.12], [1.08, 0.35], [0.8, 0.65], [0.35, 0.9], [0.02, 1]], 0.75),
      // Core with shock-diamond waisting.
      core: make([[0.62, 0], [0.5, 0.18], [0.66, 0.3], [0.42, 0.48], [0.5, 0.58], [0.2, 0.8], [0.01, 0.95]], 0.8),
    };
  }, [exit.y, re, lp]);

  const plumeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        uniforms: { uIgnite: ignite },
        vertexShader: GAS_VERT,
        fragmentShader: PLUME_FRAG,
      }),
    [ignite],
  );
  useEffect(() => () => plumeMat.dispose(), [plumeMat]);

  useFrame(({ clock }) => {
    // The plume grows out of the exit plane as the engine ignites.
    const grow = still ? 1 : Math.max(0.02, ignite.value);
    const t = clock.elapsedTime;
    const sr = still ? 1 : 1 + 0.035 * Math.sin(t * 23) + 0.02 * Math.sin(t * 37 + 1.3);
    const sy = (still ? 1 : 1 + 0.03 * Math.sin(t * 17)) * grow;
    for (const ref of [outerRef, coreRef]) {
      const m = ref.current;
      if (!m) continue;
      // Scale about the exit plane so the plume stays attached to the nozzle.
      m.scale.set(sr, sy, sr);
      m.position.y = exit.y * (1 - sy);
    }
  });

  return (
    <group>
      <mesh ref={outerRef} geometry={outer}>
        <primitive object={plumeMat} attach="material" />
      </mesh>
      <mesh ref={coreRef} geometry={core}>
        <primitive object={plumeMat} attach="material" />
      </mesh>
      <pointLight position={[0, exit.y + re * 0.6, 0]} color={SCENE.rimHot} intensity={2.2} distance={length * 2.2} decay={1.5} />
    </group>
  );
}

/** The half-section cut drawn as blueprint linework on the cut plane. */
function CutEdges({ outline }: { outline: THREE.Vector2[] }) {
  const lines = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({ color: SCENE.linework, transparent: true, opacity: 0.9 });
    return [1, -1].map((side) => {
      const g = new THREE.BufferGeometry().setFromPoints(outline.map((p) => new THREE.Vector3(side * p.x, p.y, 0.0002)));
      return new THREE.Line(g, mat);
    });
  }, [outline]);
  return (
    <>
      {lines.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </>
  );
}

/** Horizontal Mach colour scale for the flow-streamlines mode. */
function MachBar({ exitMach }: { exitMach: number }) {
  const stops = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16;
    const [r, g, b] = jet(Math.min(1, (t * exitMach) / 3));
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${t * 100}%`;
  });
  return (
    <div className="viewer3d-machbar">
      <span>gas flow · M 0</span>
      <span className="mb-bar" style={{ background: `linear-gradient(to right, ${stops.join(",")})` }} />
      <span>M {exitMach.toFixed(1)}</span>
    </div>
  );
}

function buildEngineGeometry(l0: L0ResultDto, l2: L2ResultDto | null) {
  const rc = l0.chamber_diameter / 2;
  const rt = l0.throat_diameter / 2;
  const re = l0.exit_diameter / 2;
  const lc = l0.chamber_length;
  const wall = Math.max(l0.wall_thickness, 0.0012);
  const gap = Math.max(l0.cooling_gap, 0.0015);

  const inner: THREE.Vector2[] = [];
  const push = (r: number, y: number) => inner.push(new THREE.Vector2(Math.max(r, 1e-4), y));

  push(rc, 0);
  push(rc, lc);
  const lConv = (rc - rt) / Math.tan((30 * Math.PI) / 180);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    push(rt + (rc - rt) * (0.5 + 0.5 * Math.cos(Math.PI * t)), lc + t * lConv);
  }
  const throatY = lc + lConv;

  if (l2?.stations && l2.stations.length > 2) {
    const s0 = l2.stations[0].x;
    for (const s of l2.stations) push(s.r, throatY + (s.x - s0));
  } else {
    const lDiv = (re - rt) / Math.tan((15 * Math.PI) / 180);
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      push(rt + (re - rt) * Math.sqrt(t), throatY + t * lDiv);
    }
  }

  const length = inner[inner.length - 1].y;
  const halfShift = length / 2;
  const outer = [...inner].reverse().map((p) => new THREE.Vector2(p.x + wall, p.y));
  const outline = [...inner, ...outer, inner[0].clone()];
  for (const p of outline) p.y -= halfShift;

  const geometry = new THREE.LatheGeometry(outline, SEGMENTS);
  geometry.computeVertexNormals();
  const rMax = Math.max(...inner.map((p) => p.x)) + wall;
  return { geometry, length, inner, outline, wall, gap, rMax };
}

function buildChannels(inner: THREE.Vector2[], wall: number, gap: number, count: number) {
  const geoms: THREE.TubeGeometry[] = [];
  for (let k = 0; k < count; k++) {
    const theta = (2 * Math.PI * k) / count;
    const pts = inner.map((p) => {
      const rOff = p.x + wall + gap * 0.5;
      return new THREE.Vector3(rOff * Math.cos(theta), p.y, rOff * Math.sin(theta));
    });
    geoms.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length, gap * 0.34, 6, false));
  }
  return geoms;
}

/** Per-vertex jet colours from the combined stress, mapped along the axis. */
function computeStressColors(outline: THREE.Vector2[], stations: StressStation[], smin: number, smax: number, bands: boolean) {
  if (!stations.length) return null;
  const ys = outline.map((p) => p.y);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const sorted = [...stations].sort((a, b) => a.x - b.x);
  const sx0 = sorted[0].x;
  const sx1 = sorted[sorted.length - 1].x;

  const stressAt = (t: number) => {
    const x = sx0 + t * (sx1 - sx0);
    let lo = sorted[0];
    let hi = sorted[sorted.length - 1];
    for (let k = 0; k < sorted.length - 1; k++) {
      if (sorted[k].x <= x && sorted[k + 1].x >= x) {
        lo = sorted[k];
        hi = sorted[k + 1];
        break;
      }
    }
    const f = hi.x > lo.x ? (x - lo.x) / (hi.x - lo.x) : 0;
    return lo.combined_stress_pa + f * (hi.combined_stress_pa - lo.combined_stress_pa);
  };

  const pts = outline.length;
  const colors = new Float32Array((SEGMENTS + 1) * pts * 3);
  for (let i = 0; i <= SEGMENTS; i++) {
    for (let j = 0; j < pts; j++) {
      const t = y1 > y0 ? (outline[j].y - y0) / (y1 - y0) : 0;
      let s = smax > smin ? (stressAt(t) - smin) / (smax - smin) : 0;
      s = Math.max(0, Math.min(1, s));
      if (bands) s = (Math.floor(s * N_LEVELS) + 0.5) / N_LEVELS;
      const [r, g, b] = jet(s);
      const idx = (i * pts + j) * 3;
      colors[idx] = r;
      colors[idx + 1] = g;
      colors[idx + 2] = b;
    }
  }
  return colors;
}

/** Isoline rings: circles on the surface where the stress crosses each level. */
function buildIsolines(inner: THREE.Vector2[], wall: number, stations: StressStation[], smin: number, smax: number) {
  const ys = inner.map((p) => p.y);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const sorted = [...stations].sort((a, b) => a.x - b.x);
  const sx0 = sorted[0].x;
  const sx1 = sorted[sorted.length - 1].x;

  const radiusAtY = (y: number) => {
    for (let k = 0; k < inner.length - 1; k++) {
      const a = inner[k];
      const b = inner[k + 1];
      if ((a.y <= y && b.y >= y) || (b.y <= y && a.y >= y)) {
        const f = b.y !== a.y ? (y - a.y) / (b.y - a.y) : 0;
        return a.x + f * (b.x - a.x);
      }
    }
    return inner[inner.length - 1].x;
  };

  const ring = (r: number, y: number) => {
    const seg = 96;
    const arr = new Float32Array((seg + 1) * 3);
    for (let i = 0; i <= seg; i++) {
      const a = (2 * Math.PI * i) / seg;
      arr[i * 3] = r * Math.cos(a);
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = r * Math.sin(a);
    }
    return arr;
  };

  const rings: Float32Array[] = [];
  if (smax <= smin) return rings;
  for (let lvl = 1; lvl < N_LEVELS; lvl++) {
    const v = smin + (lvl / N_LEVELS) * (smax - smin);
    for (let k = 0; k < sorted.length - 1; k++) {
      const va = sorted[k].combined_stress_pa;
      const vb = sorted[k + 1].combined_stress_pa;
      if (va !== vb && (va - v) * (vb - v) <= 0) {
        const f = (v - va) / (vb - va);
        const xcross = sorted[k].x + f * (sorted[k + 1].x - sorted[k].x);
        const t = sx1 > sx0 ? (xcross - sx0) / (sx1 - sx0) : 0;
        const y = y0 + t * (y1 - y0);
        rings.push(ring(radiusAtY(y) + wall + 0.0004, y));
      }
    }
  }
  return rings;
}
