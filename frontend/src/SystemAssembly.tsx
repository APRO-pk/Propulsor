import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useEngineStore } from "./store";
import { feedStudy, type FeedStudyDto } from "./api";

/**
 * CAD-style vehicle/thruster assembly: the engine at the aft end with the
 * oxidizer and fuel tanks stacked forward, an injector plate, feed lines routed
 * down the side, inside a translucent airframe. Sizes come from the L0 geometry
 * and the feed study. An animated exploded view separates the parts along the
 * stack axis with leader labels, so the build order reads clearly.
 */
export function SystemAssembly() {
  const l0 = useEngineStore((s) => s.l0);
  const l2 = useEngineStore((s) => s.l2);
  const rev = useEngineStore((s) => s.design?.meta.revision);
  const [feed, setFeed] = useState<FeedStudyDto | null>(null);
  const [airframe, setAirframe] = useState(true);
  const [exploded, setExploded] = useState(false);

  // Re-fetch the feed study whenever the design changes, so tanks / pressurant
  // track the current design live.
  useEffect(() => {
    let live = true;
    feedStudy(30, "").then((f) => live && setFeed(f)).catch(() => {});
    return () => { live = false; };
  }, [rev]);

  const layout = useMemo(() => {
    if (!l0 || !feed) return null;
    // The real designed nozzle contour (L2 stations: throat x=0 → exit). Falls
    // back to a straight cone before L2 resolves.
    const stations = (l2?.stations ?? []).filter((p) => p.x >= 0).sort((a, b) => a.x - b.x);
    const throatR = l0.throat_diameter / 2;
    const exitR = l0.exit_diameter / 2;
    const contour = stations.length >= 2 ? stations : [{ x: 0, r: throatR }, { x: (exitR - throatR) * 1.4, r: exitR }];
    const nozzleL = contour[contour.length - 1].x || (exitR - throatR) * 1.4;
    const eng = { chamberR: l0.chamber_diameter / 2, exitR, throatR, chamberL: l0.chamber_length, nozzleL, contour };
    const ox = { r: feed.ox_tank.diameter_m / 2, l: feed.ox_tank.length_m };
    const fu = { r: feed.fuel_tank.diameter_m / 2, l: feed.fuel_tank.length_m };
    // Pressurant bottle (pressure-fed) — a stored-gas sphere on the forward end.
    const bottle = feed.pressurant ? Math.cbrt((3 * (feed.pressurant.bottle_volume_l / 1000)) / (4 * Math.PI)) : 0;
    return { eng, ox, fu, bottleR: bottle };
  }, [l0, l2, feed]);

  if (!layout) return <p className="muted">Assembling…</p>;
  const { eng, ox, fu, bottleR } = layout;

  // Stack along +Y (forward). Engine aft (nozzle points -Y).
  const engTop = eng.chamberL;
  const gap = 0.03;
  const injThk = Math.max(eng.chamberR * 0.12, 0.006);
  const injY = engTop + injThk / 2;
  const fuY = engTop + injThk + gap + fu.l / 2;
  const oxY = fuY + fu.l / 2 + gap + ox.l / 2;
  const bottleY = oxY + ox.l / 2 + gap + bottleR;
  const bodyR = Math.max(ox.r, fu.r, eng.chamberR, bottleR) * 1.25;
  const totalH = oxY + ox.l / 2 + eng.nozzleL + (bottleR > 0 ? 2 * bottleR + gap : 0);
  const cam = totalH * 1.35;

  const OX = "#5aa9e6";
  const FU = "#e6a15a";

  return (
    <div className="viewer3d">
      <Canvas dpr={[1, 2]} camera={{ position: [cam * 0.9, totalH * 0.35, cam], fov: 40, near: 0.001, far: 100 }}>
        <color attach="background" args={["#3b4046"]} />
        <hemisphereLight args={["#ffffff", "#33383e", 1.0]} />
        <directionalLight position={[cam, cam, cam]} intensity={2.2} />
        <directionalLight position={[-cam, cam * 0.4, -cam]} intensity={0.7} color="#a9c0dd" />

        <AssemblyScene
          eng={eng} ox={ox} fu={fu} OX={OX} FU={FU}
          oxY={oxY} fuY={fuY} injY={injY} injThk={injThk} engTop={engTop}
          bodyR={bodyR} totalH={totalH} airframe={airframe} exploded={exploded}
          bottleR={bottleR} bottleY={bottleY} pumpFed={feed?.feed_type === "pump-fed"}
        />

        <gridHelper args={[cam * 4, 24, "#565b62", "#474c52"]} position={[0, -totalH / 2, 0]} />
        <OrbitControls enableDamping dampingFactor={0.08} />
      </Canvas>

      <div className="viewer3d-toolbar">
        <button className={`qt-tool ${exploded ? "on" : ""}`} onClick={() => setExploded((e) => !e)}>Exploded</button>
        <button className={`qt-tool ${airframe ? "on" : ""}`} onClick={() => setAirframe((a) => !a)}>Airframe</button>
      </div>
      <div className="viewer3d-machbar">
        <span style={{ color: "#8fc6f0" }}>■ oxidizer</span>
        <span style={{ color: "#f0c08f" }}>■ fuel</span>
        <span>· feed: {feed?.feed_type}</span>
      </div>
      <div className="viewer3d-hint">drag to orbit · scroll to zoom · toggle Exploded</div>
    </div>
  );
}

type SceneProps = {
  eng: { chamberR: number; exitR: number; throatR: number; chamberL: number; nozzleL: number; contour: { x: number; r: number }[] };
  ox: { r: number; l: number };
  fu: { r: number; l: number };
  OX: string; FU: string;
  oxY: number; fuY: number; injY: number; injThk: number; engTop: number;
  bodyR: number; totalH: number; airframe: boolean; exploded: boolean;
  bottleR: number; bottleY: number; pumpFed: boolean;
};

/** The animated assembly. The chamber and nozzle are the real designed contour
 *  (revolved), tanks/pressurant come from the feed study, and each part eases
 *  along the stack axis toward its exploded offset. */
function AssemblyScene(props: SceneProps) {
  const { eng, ox, fu, OX, FU, oxY, fuY, injY, injThk, engTop, bodyR, totalH, airframe, exploded, bottleR, bottleY, pumpFed } = props;

  const oxRef = useRef<THREE.Group>(null);
  const fuRef = useRef<THREE.Group>(null);
  const injRef = useRef<THREE.Group>(null);
  const chRef = useRef<THREE.Group>(null);
  const nzRef = useRef<THREE.Group>(null);
  const bottleRef = useRef<THREE.Group>(null);
  const feedRef = useRef<THREE.Group>(null);
  const airMat = useRef<THREE.MeshStandardMaterial>(null);
  const feedMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const factor = useRef(0);

  // Revolve the real combustion-chamber + throat and the L2 nozzle contour.
  const chamberGeo = useMemo(() => {
    const conv = Math.min(0.25 * eng.chamberL, eng.chamberL * 0.5);
    const pts = [
      new THREE.Vector2(Math.max(eng.throatR, 1e-4), 0),
      new THREE.Vector2(eng.chamberR, conv),
      new THREE.Vector2(eng.chamberR, eng.chamberL),
    ];
    const g = new THREE.LatheGeometry(pts, 56);
    g.computeVertexNormals();
    return g;
  }, [eng.throatR, eng.chamberR, eng.chamberL]);
  const nozzleGeo = useMemo(() => {
    const pts = eng.contour.map((p) => new THREE.Vector2(Math.max(p.r, 1e-4), -p.x));
    const g = new THREE.LatheGeometry(pts, 56);
    g.computeVertexNormals();
    return g;
  }, [eng.contour]);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#cdd2da", metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }), []);

  // Explode offsets (m) along +Y, spreading the stack apart.
  const off = {
    bottle: totalH * 0.72,
    ox: totalH * 0.55,
    fu: totalH * 0.28,
    inj: totalH * 0.1,
    ch: -totalH * 0.12,
    nz: -totalH * 0.45,
  };

  useFrame((_, dt) => {
    const target = exploded ? 1 : 0;
    factor.current += (target - factor.current) * Math.min(1, dt * 3.5);
    const f = factor.current;
    if (bottleRef.current) bottleRef.current.position.y = bottleY + off.bottle * f;
    if (oxRef.current) oxRef.current.position.y = oxY + off.ox * f;
    if (fuRef.current) fuRef.current.position.y = fuY + off.fu * f;
    if (injRef.current) injRef.current.position.y = injY + off.inj * f;
    if (chRef.current) chRef.current.position.y = off.ch * f; // chamber base at throat (y=0)
    if (nzRef.current) nzRef.current.position.y = off.nz * f; // nozzle base at throat (y=0)
    if (feedRef.current) feedRef.current.visible = f < 0.98;
    for (const m of feedMats.current) if (m) m.opacity = 1 - f;
    if (airMat.current) airMat.current.opacity = (airframe ? 0.14 : 0) * (1 - 0.85 * f);
  });

  const labelStyle: React.CSSProperties = {
    background: "rgba(28,32,38,0.82)", color: "#e8ecf2", padding: "2px 7px", borderRadius: 4,
    fontSize: 11, whiteSpace: "nowrap", pointerEvents: "none", transform: "translateX(10px)",
    border: "1px solid rgba(255,255,255,0.15)",
  };
  const showLabels = exploded;

  return (
    <group position={[0, -totalH / 2, 0]}>
      {/* Airframe (always mounted so it can fade; opacity animated) */}
      <mesh position={[0, oxY - eng.nozzleL / 2, 0]} visible={airframe || exploded}>
        <cylinderGeometry args={[bodyR, bodyR, totalH, 48, 1, true]} />
        <meshStandardMaterial ref={airMat} color="#aeb6c2" metalness={0.4} roughness={0.5} transparent opacity={0.14} side={THREE.DoubleSide} />
      </mesh>

      {/* Pressurant bottle (pressure-fed only) */}
      {bottleR > 0 && (
        <group ref={bottleRef} position={[0, bottleY, 0]}>
          <mesh>
            <sphereGeometry args={[bottleR, 32, 24]} />
            <meshStandardMaterial color="#4a9d5a" metalness={0.5} roughness={0.4} />
          </mesh>
          {showLabels && <Html position={[bottleR, 0, 0]} style={labelStyle}>Pressurant bottle</Html>}
        </group>
      )}

      {/* Oxidizer tank */}
      <group ref={oxRef} position={[0, oxY, 0]}>
        <TankMesh r={ox.r} l={ox.l} color={OX} />
        {showLabels && <Html position={[ox.r, 0, 0]} style={labelStyle}>Oxidizer tank</Html>}
      </group>
      {/* Fuel tank */}
      <group ref={fuRef} position={[0, fuY, 0]}>
        <TankMesh r={fu.r} l={fu.l} color={FU} />
        {showLabels && <Html position={[fu.r, 0, 0]} style={labelStyle}>Fuel tank</Html>}
      </group>
      {/* Turbopumps (pump-fed only): two pump volutes + turbine disks flanking the
          chamber, so the architecture reads as pump-fed in the assembly. */}
      {pumpFed && (
        <group position={[0, engTop * 0.6, 0]}>
          {[-1, 1].map((s) => (
            <group key={s} position={[s * eng.chamberR * 1.7, 0, 0]}>
              <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[eng.chamberR * 0.55, eng.chamberR * 0.55, eng.chamberR * 1.0, 20]} />
                <meshStandardMaterial color={s < 0 ? OX : FU} metalness={0.72} roughness={0.35} />
              </mesh>
              <mesh position={[s * eng.chamberR * 0.62, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[eng.chamberR * 0.38, eng.chamberR * 0.38, eng.chamberR * 0.2, 20]} />
                <meshStandardMaterial color="#9aa2af" metalness={0.8} roughness={0.3} />
              </mesh>
            </group>
          ))}
          {exploded && <Html position={[eng.chamberR * 2.4, 0, 0]} style={labelStyle}>Turbopumps</Html>}
        </group>
      )}

      {/* Injector plate */}
      <group ref={injRef} position={[0, injY, 0]}>
        <mesh rotation={[0, 0, 0]}>
          <cylinderGeometry args={[eng.chamberR * 1.02, eng.chamberR * 1.02, injThk, 40]} />
          <meshStandardMaterial color="#b7bdc7" metalness={0.75} roughness={0.3} />
        </mesh>
        {showLabels && <Html position={[eng.chamberR, 0, 0]} style={labelStyle}>Injector plate</Html>}
      </group>
      {/* Combustion chamber + throat (revolved real contour) */}
      <group ref={chRef} position={[0, 0, 0]}>
        <mesh geometry={chamberGeo} material={metal} />
        {showLabels && <Html position={[eng.chamberR, eng.chamberL / 2, 0]} style={labelStyle}>Combustion chamber</Html>}
      </group>
      {/* Nozzle (revolved L2 bell/conical contour) */}
      <group ref={nzRef} position={[0, 0, 0]}>
        <mesh geometry={nozzleGeo} material={metal} />
        {showLabels && <Html position={[eng.exitR, -eng.nozzleL / 2, 0]} style={labelStyle}>Nozzle (designed contour)</Html>}
      </group>

      {/* Feed lines down the side (fade out when exploded) */}
      <group ref={feedRef}>
        <FeedLine fromY={oxY} toY={engTop} r={bodyR * 0.86} color={OX} angle={0.5} matRef={(m) => { feedMats.current[0] = m; }} />
        <FeedLine fromY={fuY} toY={engTop} r={bodyR * 0.86} color={FU} angle={-0.5} matRef={(m) => { feedMats.current[1] = m; }} />
      </group>
    </group>
  );
}

function TankMesh({ r, l, color }: { r: number; l: number; color: string }) {
  const cylL = Math.max(l - 2 * r, r * 0.2);
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[r, r, cylL, 32]} />
        <meshStandardMaterial color={color} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, cylL / 2, 0]}>
        <sphereGeometry args={[r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, -cylL / 2, 0]} rotation={[Math.PI, 0, 0]}>
        <sphereGeometry args={[r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
}

function FeedLine({ fromY, toY, r, color, angle, matRef }: { fromY: number; toY: number; r: number; color: string; angle: number; matRef: (m: THREE.MeshStandardMaterial | null) => void }) {
  const geo = useMemo(() => {
    const x = r * Math.cos(angle);
    const z = r * Math.sin(angle);
    const pts = [
      new THREE.Vector3(0, fromY, 0),
      new THREE.Vector3(x, fromY - 0.02, z),
      new THREE.Vector3(x, toY + 0.02, z),
      new THREE.Vector3(0, toY, 0),
    ];
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r * 0.05, 8, false);
  }, [fromY, toY, r, angle]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial ref={matRef} color={color} metalness={0.4} roughness={0.5} transparent />
    </mesh>
  );
}
