import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
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

/**
 * Live 3D engine model. Honours the L2 contour (bell vs conical) and can show
 * cooling channels or an FEM-style distributed wall-stress contour with a jet
 * colour map, discrete contour bands, isoline rings, and a numeric MPa scale.
 */
export function EngineViewer({ l0, l2 }: { l0: L0ResultDto; l2?: L2ResultDto | null }) {
  const [section, setSection] = useState(true);
  const [wire, setWire] = useState(false);
  const [channels, setChannels] = useState(false);
  const [stressMode, setStressMode] = useState(false);
  const [bands, setBands] = useState(true);
  const [isolines, setIsolines] = useState(true);
  const [flow, setFlow] = useState(false);
  const [stress, setStress] = useState<StressStation[] | null>(null);
  const [loadingStress, setLoadingStress] = useState(false);
  const [ready, setReady] = useState(false);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const controlsRef = useRef<{ reset: () => void } | null>(null);

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

  const clip = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const cam = Math.max(model.length, 0.05) * 1.9;

  return (
    <div className="viewer3d">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [cam * 0.7, cam * 0.55, cam], fov: 42, near: 0.001, far: 100 }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
        }}
      >
        <color attach="background" args={["#3b4046"]} />
        <hemisphereLight args={["#ffffff", "#33383e", 1.1]} />
        <directionalLight position={[cam, cam * 1.5, cam]} intensity={stressMode ? 1.6 : 2.4} />
        <directionalLight position={[-cam * 1.2, cam * 0.5, cam * 0.4]} intensity={0.9} color="#a9c0dd" />
        <directionalLight position={[cam * 0.3, -cam * 0.6, -cam]} intensity={0.7} color="#ffd9b0" />

        <group rotation={[0, 0, Math.PI / 2]}>
          <mesh geometry={model.geometry}>
            <meshStandardMaterial
              ref={matRef}
              color={stressMode ? "#ffffff" : "#cdd2da"}
              vertexColors={stressMode && !!stressColors}
              metalness={stressMode ? 0.0 : 0.62}
              roughness={stressMode ? 0.9 : 0.42}
              side={THREE.DoubleSide}
              clippingPlanes={section ? [clip] : []}
              clipShadows
              wireframe={wire}
              transparent={flow && !stressMode}
              opacity={flow && !stressMode ? 0.22 : 1}
              depthWrite={!(flow && !stressMode)}
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
              <meshStandardMaterial color="#4aa3e0" metalness={0.3} roughness={0.5} clippingPlanes={section ? [clip] : []} />
            </mesh>
          ))}
          {flow && <FlowStreamlines inner={model.inner} mach={mach} />}
        </group>

        <gridHelper args={[cam * 4, 24, "#565b62", "#474c52"]} position={[0, -model.length * 0.75, 0]} />
        <OrbitControls ref={controlsRef as never} enableDamping dampingFactor={0.08} minDistance={cam * 0.2} maxDistance={cam * 6} />
        <FirstFrame onReady={() => setReady(true)} />
      </Canvas>

      <div className="viewer3d-toolbar">
        <button className={`qt-tool ${section ? "on" : ""}`} onClick={() => setSection((s) => !s)}>Half section</button>
        <button className={`qt-tool ${wire ? "on" : ""}`} onClick={() => setWire((w) => !w)}>Wireframe</button>
        <button className={`qt-tool ${channels ? "on" : ""}`} onClick={() => setChannels((c) => !c)}>Cooling channels</button>
        <button className={`qt-tool ${stressMode ? "on" : ""}`} onClick={() => setStressMode((s) => !s)}>Stress map</button>
        {stressMode && <button className={`qt-tool ${bands ? "on" : ""}`} onClick={() => setBands((b) => !b)}>Contour bands</button>}
        {stressMode && <button className={`qt-tool ${isolines ? "on" : ""}`} onClick={() => setIsolines((i) => !i)}>Isolines</button>}
        <button className={`qt-tool ${flow ? "on" : ""}`} onClick={() => setFlow((f) => !f)}>Flow streamlines</button>
        <button className="qt-tool" onClick={() => controlsRef.current?.reset()} title="Reset the camera to fit the model">Reset view</button>
      </div>

      {stressMode && range && <ColorBar min={range.min} max={range.max} allow={range.allow} bands={bands} />}
      {flow && <MachBar exitMach={l2?.exit_mach ?? 2.8} />}
      {(!ready || loadingStress) && (
        <div className="viewer3d-loading">
          <div className="spinner" />
          {!ready ? "Initializing 3D view…" : "Computing stress field…"}
        </div>
      )}
      <div className="viewer3d-hint">drag to orbit · scroll to zoom</div>
    </div>
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
          <div className="cb-yield" style={{ top: `${yieldClamped}%`, color: yieldPct > 100 ? "#c23b34" : undefined }}>{yieldLabel}</div>
        </div>
        <div className="cb-bar" style={{ background: `linear-gradient(to top, ${stops.join(",")})` }} />
      </div>
    </div>
  );
}

/** Signals once the render loop has drawn its first frame (hides the init overlay). */
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
          <meshBasicMaterial color="#9fdaff" transparent opacity={0.32} depthWrite={false} />
        </mesh>
      ))}
      <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
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
  return { geometry, length, inner, outline, wall, gap };
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
