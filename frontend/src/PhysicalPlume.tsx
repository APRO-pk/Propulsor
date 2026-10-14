import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SCENE } from "./theme";
import type { Exhaust } from "./exhaust";

/**
 * The exhaust as glowing gas whose shape is the nozzle's expansion state:
 * raymarched through a bounding box in the plume's own frame. Over-expanded
 * the jet pinches and its first shock cell sits close to the exit (a sharp
 * Mach disk); under-expanded it barrels out with longer cells; in vacuum the
 * cells vanish into a wide, dim bloom. Brightness and length follow ignition.
 */
export function PhysicalPlume({
  inner,
  ex,
  ignite,
  still,
  length,
}: {
  inner: THREE.Vector2[];
  ex: Exhaust;
  ignite: { value: number };
  still: boolean;
  length: number;
}) {
  const exit = inner[inner.length - 1];
  const re = exit.x;
  const de = 2 * re;
  const meshRef = useRef<THREE.Mesh>(null);

  // Plume extent in exit diameters, and the box that bounds it.
  // The picture caps the expanded-jet growth: in vacuum the ideal jet diameter is unbounded,
  // and the spread is drawn by the bloom term instead.
  const grow = Math.min(1.4, Math.max(-0.45, ex.djDe - 1)) * (1 - ex.vacuum);
  const lenDe = Math.min(14, Math.max(5, 3 + 2.2 * Math.min(ex.cellDe, 4)) + ex.vacuum * 3);
  const rMaxDe = Math.min(3.2, Math.max(0.8, 0.5 * (1 + grow) * 1.3 + 0.04 * lenDe + ex.vacuum * 1.9));
  const geometry = useMemo(() => {
    const g = new THREE.BoxGeometry(2 * rMaxDe * de, lenDe * de, 2 * rMaxDe * de);
    g.translate(0, exit.y + (lenDe * de) / 2, 0);
    return g;
  }, [rMaxDe, lenDe, de, exit.y]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uIgnite: ignite,
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uExitY: { value: 0 },
      uDe: { value: 1 },
      uLen: { value: 8 },
      uRMax: { value: 1 },
      uGrow: { value: 0 },
      uCell: { value: 1 },
      uVac: { value: 0 },
      uOver: { value: 0 },
      uSteps: { value: 56 },
    }),
    [ignite],
  );
  uniforms.uExitY.value = exit.y;
  uniforms.uDe.value = de;
  uniforms.uLen.value = lenDe;
  uniforms.uRMax.value = rMaxDe;
  uniforms.uGrow.value = grow;
  // Shock-cell spacing from Prandtl–Pack, capped at 1.6 exit diameters for display so the
  // cells stay within the framed stage; the readout and the trend with altitude stay true.
  uniforms.uCell.value = Math.min(1.6, Math.max(0.35, ex.cellDe));
  uniforms.uVac.value = ex.vacuum;
  uniforms.uOver.value = ex.n < 1 ? Math.min(1, (1 - ex.n) * 1.6) : 0;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        // Premultiplied additive: colour adds straight onto the stage and alpha carries
        // brightness, so empty gas stays transparent over the CSS stage behind the canvas.
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor,
        side: THREE.FrontSide,
        vertexShader: VERT,
        fragmentShader: FRAG,
      }),
    [uniforms],
  );
  useEffect(() => () => material.dispose(), [material]);

  const v = useMemo(() => new THREE.Vector3(), []);
  // Adaptive quality: fewer raymarch samples when frames run long (weak or software GPUs).
  const frameAvg = useRef(16);
  useFrame(({ camera, clock }, dt) => {
    const m = meshRef.current;
    if (!m) return;
    if (dt > 0 && dt < 0.5) {
      frameAvg.current = frameAvg.current * 0.9 + dt * 1000 * 0.1;
      const steps = frameAvg.current > 45 ? 20 : frameAvg.current > 28 ? 32 : 56;
      if (steps !== uniforms.uSteps.value) uniforms.uSteps.value = steps;
    }
    m.updateWorldMatrix(true, false);
    uniforms.uCam.value.copy(m.worldToLocal(v.copy(camera.position)));
    if (!still) uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <group>
      <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />
      <pointLight position={[0, exit.y + re * 0.6, 0]} color={SCENE.rimHot} intensity={2.2 * (1 - 0.6 * ex.vacuum)} distance={length * 2.2} decay={1.5} />
    </group>
  );
}

const VERT = /* glsl */ `
varying vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vObj;
uniform vec3 uCam;
uniform float uTime, uExitY, uDe, uLen, uRMax, uGrow, uCell, uVac, uOver, uIgnite;
uniform int uSteps;

vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.30, 0.03, 0.00), b = vec3(1.00, 0.32, 0.05), c = vec3(1.00, 0.72, 0.30), d = vec3(1.00, 0.97, 0.90);
  return t < 0.33 ? mix(a, b, t / 0.33) : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33) : mix(c, d, (t - 0.66) / 0.34);
}
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

// Emission and density at a point, in exit diameters (z axial from the exit plane, r radial).
vec4 gas(float z, float r) {
  float len = uLen * max(uIgnite, 0.02);
  if (z > len) return vec4(0.0);
  float phase = z / uCell;
  float cellAmp = exp(-phase * 0.32) * (1.0 - uVac);
  // Envelope: relaxes from the exit radius toward the fully-expanded jet, then mixes out.
  float R = 0.5 * (1.0 + uGrow * (1.0 - exp(-z / 0.7))) + 0.035 * z;
  R += uVac * 0.8 * z / (1.0 + 0.35 * z);                         // vacuum bloom
  R *= 1.0 - 0.22 * cellAmp * (0.5 + 0.5 * cos(6.2832 * phase));   // waist at each recompression
  float rr = r / max(R, 0.02);
  float core = exp(-rr * rr * 4.5);
  // Shock diamonds: bright recompression knots on the axis, at the cell centres.
  float k = fract(phase) - 0.5;
  float knot = exp(-k * k / 0.006) * exp(-pow(r / max(R * 0.5, 0.02), 2.0) * 3.0) * cellAmp;
  // Over-expanded: a sharp Mach disk at the first cell.
  float disk = uOver * exp(-pow((phase - 0.55) / 0.08, 2.0)) * exp(-pow(r / max(R * 0.7, 0.02), 2.0) * 2.0);
  float fade = exp(-z / (len * 0.45));
  float turb = 0.85 + 0.3 * noise(vec3(r * 3.0, z * 1.6 - uTime * 6.0, uTime * 0.7));
  float dens = core * fade * turb * mix(1.0, 0.35, uVac);
  // Hot on the axis, cooler at the shear layer; recompression knots run hotter.
  float temp = 0.15 + 0.62 * exp(-z / (len * 0.4)) - 0.4 * rr * rr + 0.75 * knot + 0.9 * disk;
  return vec4(heat(temp), dens + 2.6 * knot + 3.0 * disk);
}

void main() {
  vec3 ro = uCam;
  vec3 rd = normalize(vObj - uCam);
  // Ray through the box [−R, R] × [exit, exit + len] × [−R, R] (object units).
  float rB = uRMax * uDe;
  vec3 bmin = vec3(-rB, uExitY, -rB), bmax = vec3(rB, uExitY + uLen * uDe, rB);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tf <= tn) discard;
  const int MAX_STEPS = 56;
  float dt = (tf - tn) / float(uSteps);
  vec3 col = vec3(0.0);
  float jitter = hash(vObj * 91.7 + uTime) * dt;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * (tn + jitter + dt * float(i));
    float z = (p.y - uExitY) / uDe;
    float r = length(p.xz) / uDe;
    vec4 g = gas(z, r);
    col += g.rgb * g.a * (dt / uDe) * 3.0;
  }
  col *= uIgnite;
  col = vec3(1.0) - exp(-col * 1.4);   // soft highlight roll-off
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
}`;
