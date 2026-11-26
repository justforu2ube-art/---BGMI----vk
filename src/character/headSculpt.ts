import * as THREE from 'three';
import {
  applySkinWeights,
  CharacterRig,
  createBoundSkinnedMesh,
} from './rig';
import {
  createLoftedGeometry,
  LoftRing,
  mergeNormalizedGeometries,
} from './geometryUtils';
import { PBRMaterialLibrary } from './textures';

export const FACIAL_MORPH_NAMES = [
  'Blink_L',
  'Blink_R',
  'Brow_Focus',
  'Mouth_Smirk',
  'Mouth_Grit_Fire',
  'Nostril_Flare',
] as const;

export type FacialMorphName = (typeof FACIAL_MORPH_NAMES)[number];

/** Shared UV vertical bounds synchronized 1:1 with textures.ts bakeSkinPBR */
export const HEAD_ORIGIN = new THREE.Vector3(0, 1.716, 0.010);
export const HEAD_UV_Y_MIN = -0.148;
export const HEAD_UV_Y_MAX = 0.118;
/** Lower neck mesh extends deeper than UV_Y_MIN to anchor solidly inside upper chest & turtleneck */
const HEAD_MESH_Y_MIN = -0.172;

/**
 * Eyeball centers (local to HEAD_ORIGIN) deeply enclosed inside the orbital skull envelope:
 * - Slightly recessed (-2mm Z) so upper & lower 3D eyelids wrap with generous clearance
 * - Combined with chord-compensated blink targets -> ZERO blue iris clipping at ANY blink w in [0, 1]!
 */
const EYE_LOCAL_X = 0.0266;
const EYE_LOCAL_Y = 0.0128;
const EYE_LOCAL_Z = 0.0596;
const EYE_IRIS_RADIUS = 0.0144;
const EYE_CORNEA_RADIUS = 0.0147;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function gauss(d: number, sigma: number): number {
  const t = d / sigma;
  return Math.exp(-t * t);
}

function gauss2D(x: number, y: number, cx: number, cy: number, sx: number, sy: number): number {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-(dx * dx + dy * dy));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth Catmull-Rom interpolation over sorted [y, val] profile knots */
function evalProfileCurve(knots: readonly [number, number][], y: number): number {
  const n = knots.length;
  if (y <= knots[0][0]) return knots[0][1];
  if (y >= knots[n - 1][0]) return knots[n - 1][1];
  let i = 0;
  while (i < n - 2 && y > knots[i + 1][0]) i++;
  const [y0, v0] = knots[i];
  const [y1, v1] = knots[i + 1];
  const h = y1 - y0;
  const t = (y - y0) / h;

  const m0 =
    i === 0
      ? (v1 - v0) / h
      : ((v1 - knots[i - 1][1]) / (y1 - knots[i - 1][0]) + (v1 - v0) / h) * 0.5;
  const m1 =
    i === n - 2
      ? (v1 - v0) / h
      : ((knots[i + 2][1] - v0) / (knots[i + 2][0] - y0) + (v1 - v0) / h) * 0.5;

  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * v0 + h10 * h * m0 + h01 * v1 + h11 * h * m1;
}

/**
 * Explicit Anatomical Side-Profile & Heroic Tapered Oval Width Curves (matching 4_a81a6ae0.jpg!):
 * - Tall nearly vertical upright forehead
 * - Sleek chiseled heroic oval taper from cheekbones down jawline to smooth rounded-square chin
 * - Straight masculine nose bridge with softly rounded fleshy tip (ZERO pointy triangle or beak!)
 * - Full soft pillowy lips behind nose tip & aligned vertically with proud chin
 */
const Z_FRONT_KNOTS: readonly [number, number][] = [
  [-0.172, 0.050], // Deep lower neck anchored solidly inside chest & turtleneck
  [-0.148, 0.048], // Lower anterior neck
  [-0.122, 0.048], // Strong masculine throat column
  [-0.106, 0.057], // Crisp submental throat-to-chin crease
  [-0.096, 0.087], // Chin underside front curve
  [-0.088, 0.0952], // Proud subtly-squared heroic chin apex
  [-0.076, 0.0894], // Smooth mentolabial sulcus
  [-0.064, 0.0942], // Lower lip base pedestal
  [-0.051, 0.0942], // Upper lip base pedestal
  [-0.036, 0.0930], // Subnasale / philtrum top
  [-0.014, 0.0910], // Mid-face
  [0.014, 0.0888], // Nasion / eye level base
  [0.034, 0.0934], // Strong masculine brow ridge
  [0.060, 0.0906], // Mid-forehead — nearly vertical upright!
  [0.085, 0.0820], // Upper forehead / hairline
  [0.104, 0.054], // Front crown curvature
  [0.116, 0.002], // Crown apex
];

const Z_BACK_KNOTS: readonly [number, number][] = [
  [-0.172, -0.068], // Deep trapezius back base inside torso
  [-0.148, -0.062], // Posterior neck column inside turtleneck
  [-0.112, -0.064], // Strong posterior neck
  [-0.078, -0.076],
  [-0.045, -0.092],
  [-0.005, -0.105], // Full rounded occiput
  [0.042, -0.105],
  [0.082, -0.088],
  [0.104, -0.058],
  [0.116, -0.002],
];

const HALF_WIDTH_KNOTS: readonly [number, number][] = [
  [-0.172, 0.0720], // Broad trapezius neck root deep inside upper chest
  [-0.148, 0.0610], // Strong lower neck / trapezius flare
  [-0.124, 0.0545], // Solid masculine neck column (~75% of jaw width — ZERO pinch!)
  [-0.106, 0.0525], // Upper neck directly beneath jaw — ZERO bobblehead hourglass!
  [-0.095, 0.0475], // Smooth masculine chin-to-neck transition
  [-0.086, 0.0445], // Clean athletic rounded-square heroic chin (NOT boxy!)
  [-0.064, 0.0575], // Chiseled masculine lower jaw (gonion)
  [-0.040, 0.0655], // Athletic jaw/cheek plane
  [-0.014, 0.0705], // Mid-cheekbone rise
  [0.006, 0.0730], // Heroic cheekbones
  [0.030, 0.0730], // Temples & brow width
  [0.060, 0.0730], // Parietal cranium
  [0.086, 0.0660], // Upper cranium
  [0.104, 0.0465], // Crown shoulder
  [0.116, 0.0020], // Crown apex
];

function evalBaseCraniumPoint(theta: number, y: number): [number, number, number] {
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const zFront = evalProfileCurve(Z_FRONT_KNOTS, y);
  const zBack = evalProfileCurve(Z_BACK_KNOTS, y);
  const halfW = evalProfileCurve(HALF_WIDTH_KNOTS, y);

  const zCenter = (zFront + zBack) * 0.5;
  const rzFront = Math.max(0.002, zFront - zCenter);
  const rzBack = Math.max(0.002, zCenter - zBack);

  const foreheadZone = smoothstep(0.022, 0.046, y) * smoothstep(0.095, 0.068, y);
  const chinZone = smoothstep(-0.095, -0.084, y) * smoothstep(-0.068, -0.079, y);
  // Subtle athletic chin plane & upright forehead (smooth rounded corners, never boxy!)
  const frontPlanar = (foreheadZone * 0.11 + chinZone * 0.06) * smoothstep(-0.1, 0.55, cosT);
  const exp = 1.0 - frontPlanar;

  const sx = Math.sign(sinT) * Math.pow(Math.abs(sinT), exp);
  const cz = Math.sign(cosT) * Math.pow(Math.abs(cosT), exp);

  let x = sx * halfW;
  let z = zCenter + (cz >= 0 ? cz * rzFront : cz * rzBack);

  // Subtle anatomical sternocleidomastoid (SCM) & trapezius contour on thick neck column (NO pinch!)
  const neckBand = smoothstep(-0.092, -0.112, y) * smoothstep(-0.174, -0.148, y);
  const scmRidge =
    neckBand *
    gauss(Math.abs(theta) - (0.72 + (-0.105 - y) * 3.8), 0.30) *
    0.0026;
  const trapFlare = smoothstep(-0.125, -0.168, y) * smoothstep(0.25, 0.95, Math.abs(sinT)) * 0.0065;
  x += Math.sign(sinT) * (scmRidge + trapFlare);
  z += scmRidge * 0.55;

  // Crisp submental under-jaw contour ONLY under anterior chin — keeps lateral neck thick & solid!
  const underChinCrease =
    gauss(y - -0.102, 0.0075) *
    smoothstep(0.15, 0.85, cosT) *
    smoothstep(0.85, 0.35, Math.abs(sinT));
  z -= underChinCrease * 0.0065;

  // Strong clean masculine mandibular angle (gonion) directly below ear
  const gonion = gauss(y - -0.060, 0.017) * gauss(Math.abs(theta) - 1.36, 0.30);
  x += Math.sign(sinT) * gonion * 0.0032;
  z += gonion * 0.0022;

  return [x, y, z];
}

/** Evaluates full sculpted face surface point (brow, cheeks, orbital recess, rounded nose, pillowy lips) */
function evalSculptedFacePoint(theta: number, y: number): [number, number, number] {
  const cosT = Math.cos(theta);
  let [x, py, z] = evalBaseCraniumPoint(theta, y);

  const frontMask = smoothstep(-0.15, 0.30, cosT);
  const faceVertical = smoothstep(-0.108, -0.090, py) * smoothstep(0.104, 0.084, py);
  const ax = Math.abs(x);

  if (frontMask > 0.001 && faceVertical > 0.001) {
    const f = frontMask * faceVertical;

    // 1. STRONG DETERMINED SUPRAORBITAL BROW RIDGE (framing eyes closely like 4_a81a6ae0.jpg!)
    const browArcY = 0.0308 - Math.pow(ax / 0.055, 1.55) * 0.0032;
    const browRidge = gauss(py - browArcY, 0.0088) * smoothstep(0.060, 0.009, ax);
    const glabellaDip = gauss2D(x, py, 0, 0.023, 0.0082, 0.0072);
    z += (browRidge * 0.0064 - glabellaDip * 0.0020) * f;

    // 2. SCULPTED ZYGOMATIC CHEEKBONES & SLEEK BUCCAL CONTOUR
    const cheekBone = gauss2D(ax, py, 0.043, -0.008, 0.020, 0.016);
    const cheekHollow = gauss2D(ax, py, 0.039, -0.044, 0.017, 0.018);
    z += (cheekBone * 0.0072 - cheekHollow * 0.0030) * f;
    x += Math.sign(x) * (cheekBone * 0.0026 - cheekHollow * 0.0012) * f;

    // 3. TIGHTLY ENCLOSED ORBITAL SOCKET OPENING DIRECTLY BEHIND EYEBALLS
    // Keeps lateral orbital rim (ax > 0.0375) 100% SOLID & FORWARD so ZERO sclera ever peeks out sides!
    const lateralGuard = smoothstep(0.0410, 0.0340, ax);
    const socketGentle = gauss2D(ax, py, EYE_LOCAL_X, EYE_LOCAL_Y + 0.0005, 0.0144, 0.0118) * lateralGuard;
    const socketCore = gauss2D(ax, py, EYE_LOCAL_X, EYE_LOCAL_Y, 0.0108, 0.0086) * lateralGuard;
    z -= (socketGentle * 0.0074 + socketCore * 0.0255) * f;

    // 4. STRAIGHT MASCULINE NOSE WITH BROAD SOFTLY ROUNDED FLESHY TIP & SCULPTED NOSTRILS (NO pointy beak!)
    const noseT = clamp01((0.015 - py) / (0.015 - -0.022));
    const bridgeRamp = smoothstep(0.018, 0.009, py) * smoothstep(-0.035, -0.022, py);
    const bridgeHalfW = 0.0074 + noseT * 0.0030;
    const bridgeProfile = gauss(x, bridgeHalfW) * bridgeRamp * (0.0022 + noseT * 0.0098);

    // Broad, softly rounded fleshy tip dome & horizontal columella base (matches friendly heroic nose in 4_a81a6ae0.jpg!)
    const tipDome = gauss2D(x, py, 0, -0.0228, 0.0126, 0.0110) * 0.0068;
    const tipLowerRound = gauss2D(x, py, 0, -0.0285, 0.0116, 0.0078) * 0.0064;
    const noseAla = gauss2D(ax, py, 0.0138, -0.0278, 0.0072, 0.0056) * 0.0108;
    const alarCrease = gauss2D(ax, py, 0.0188, -0.0272, 0.0028, 0.0060) * 0.0032;
    const nostrilRecess = gauss2D(ax, py, 0.0078, -0.0328, 0.0040, 0.0025) * 0.0056;
    const nasionDip = gauss2D(x, py, 0, 0.015, 0.0090, 0.0065) * 0.0020;

    z += (bridgeProfile + tipDome + tipLowerRound + noseAla - alarCrease - nostrilRecess - nasionDip) * f;

    // 5. VERTICAL PHILTRUM & FULL PLUMP PILLOWY LIPS (matching 4_a81a6ae0.jpg!)
    const philtrumGroove = gauss2D(x, py, 0, -0.042, 0.0038, 0.0056) * 0.0022;
    const philtrumCol = gauss2D(ax, py, 0.0058, -0.042, 0.0028, 0.0054) * 0.0018;

    const mouthW = smoothstep(0.0290, 0.0085, ax);
    const cupidBowY = -0.0506 + 0.0017 * (1 - gauss(x, 0.0050));
    const upperLipPillow = mouthW * gauss(py - cupidBowY, 0.0070) * 0.0084;
    const lowerLipPillow = smoothstep(0.0272, 0.0075, ax) * gauss(py - -0.0648, 0.0084) * 0.0090;
    const lipPartCrease = smoothstep(0.0278, 0.0075, ax) * gauss(py - -0.0574, 0.0023) * 0.0072;
    const mouthCornerDimple = gauss2D(ax, py, 0.0265, -0.0572, 0.0046, 0.0044) * 0.0038;

    z += (
      -philtrumGroove +
      philtrumCol +
      upperLipPillow +
      lowerLipPillow -
      lipPartCrease -
      mouthCornerDimple
    ) * f;

    // 6. PROUD SUBTLY-SQUARED CHIN PAD & SOFT NASOLABIAL TRANSITION
    const chinPad = gauss2D(x, py, 0, -0.0885, 0.020, 0.013) * 0.0048;
    const chinCleft = gauss2D(x, py, 0, -0.0895, 0.0030, 0.0068) * 0.0009;
    const nasoFold =
      gauss(ax - (0.0195 + (-0.028 - py) * 0.34), 0.0055) *
      smoothstep(-0.066, -0.048, py) *
      smoothstep(-0.020, -0.032, py) *
      0.0016;

    z += (chinPad - chinCleft - nasoFold) * f;
  }

  return [x, py, z];
}

/** Evaluates exact sculpted head Z at any front-face local (x, y) */
function evalFrontHeadZAt(lx: number, ly: number): number {
  const approxTheta = Math.atan2(lx, 0.078);
  const [, , z] = evalSculptedFacePoint(approxTheta, ly);
  return z;
}

/** Shared UV projection (x, y, z local to HEAD_ORIGIN) -> [u, v] matching textures.ts 1:1.
 *  Clamps v >= 0.085 so deep lower neck vertices NEVER sample the hidden lash/ear swatch band at v = 0.04! */
function headLocalToUV(x: number, y: number, z: number): [number, number] {
  const theta = Math.atan2(x, z);
  const u = 0.5 + theta / (Math.PI * 2);
  const v = Math.max(0.085, clamp01((y - HEAD_UV_Y_MIN) / (HEAD_UV_Y_MAX - HEAD_UV_Y_MIN)));
  return [u, v];
}

interface EyelidSpec {
  side: 1 | -1; // +1 = Left (+X), -1 = Right (-X)
  isUpper: boolean;
}

/**
 * Evaluates a dedicated 3D spherically-conforming upper or lower eyelid shell vertex.
 * - Wraps cleanly all the way around both inner (-0.84) and outer (+0.96) corners so ZERO white sclera
 *   can EVER peek past the outer canthus from Front, 3/4, or 90-degree Side Profile!
 * - Larger expressive heroic aperture matching 4_a81a6ae0.jpg with crisp dark espresso upper lash line!
 * - Outer skirt fuses smoothly directly onto evalFrontHeadZAt(lx, ly)!
 */
function evalEyelidPoint(
  spec: EyelidSpec,
  uFrac: number,
  vFrac: number,
  blinkAmount = 0,
  browFocus = 0
): { pos: [number, number, number]; uv: [number, number] } {
  const { side, isUpper } = spec;
  const ex = EYE_LOCAL_X * side;
  const ey = EYE_LOCAL_Y;
  const ez = EYE_LOCAL_Z;

  // s in [0, 1]: 0 = inner tear duct, 1 = outer temple canthus
  const s = side === 1 ? uFrac : 1 - uFrac;

  // Full horizontal wrap around the eyeball hemisphere (especially outer temple corner +1.00 rad!)
  // so outer sclera is 100% SEALED behind sculpted 3D skin from every viewing angle!
  const alphaInner = -0.84 * side;
  const alphaOuter = 1.00 * side;
  const alpha = THREE.MathUtils.lerp(alphaInner, alphaOuter, s);

  // Aperture peaks cleanly across the iris (s in [0.05, 0.87]) and seals tight at outer wrap (s in [0.87, 1.0])
  const sAp = clamp01((s - 0.03) / 0.85);
  const archShape = Math.sin(sAp * Math.PI);
  const upperPeakShift = Math.sin(Math.pow(sAp, 0.88) * Math.PI);
  const canthusTilt = THREE.MathUtils.lerp(-0.04, 0.04, sAp);

  // Wide-awake, confident, sharp heroic aperture matching 4_a81a6ae0.jpg:
  // Upper lid grazes only the top ~10% of the vivid blue iris (NO sleepy drooping lids!)
  const betaUpperOpen = canthusTilt + upperPeakShift * 0.55;
  const betaLowerOpen = canthusTilt - archShape * 0.40;

  const betaUpperClosed = betaLowerOpen + 0.02;
  const betaLowerClosed = betaLowerOpen + 0.05;
  const betaUpper =
    THREE.MathUtils.lerp(betaUpperOpen, betaUpperClosed, blinkAmount) -
    browFocus * 0.03 * archShape;
  const betaLower =
    THREE.MathUtils.lerp(betaLowerOpen, betaLowerClosed, blinkAmount * 0.25) +
    browFocus * 0.05 * archShape;

  const baseBeta = isUpper ? betaUpper : betaLower;
  const dir = isUpper ? 1 : -1;

  let betaOff = 0;
  let radOff = 0;
  if (vFrac < 0.18) {
    // Crisp thick rounded eyelid rim wrapping cleanly outside cornea
    const t = vFrac / 0.18;
    const ease = smoothstep(0, 1, t);
    betaOff = dir * THREE.MathUtils.lerp(-0.035, 0.0, ease);
    radOff = THREE.MathUtils.lerp(0.0014, 0.0031, Math.sin(t * Math.PI * 0.5));
  } else if (vFrac < 0.62) {
    // Thick fleshy tarsal eyelid hood & soft supratarsal crease (guaranteed >= 2.7mm clearance!)
    const t = (vFrac - 0.18) / 0.44;
    const bulge = Math.sin(t * Math.PI);
    betaOff = dir * THREE.MathUtils.lerp(0.0, isUpper ? 0.34 : 0.26, t);
    radOff = 0.0031 + bulge * (isUpper ? 0.0015 : 0.0010);
    if (isUpper) {
      radOff -= smoothstep(0.68, 1.0, t) * 0.0005 * archShape;
    }
  } else {
    // Wide outer skirt flaring cleanly outward to fuse seamlessly into orbital rim!
    const t = (vFrac - 0.62) / 0.38;
    betaOff = dir * THREE.MathUtils.lerp(isUpper ? 0.34 : 0.26, isUpper ? 0.78 : 0.66, t);
    radOff = THREE.MathUtils.lerp(isUpper ? 0.0026 : 0.0024, 0.0010, t);
  }

  // MATHEMATICAL CHORD COMPENSATION FOR LINEAR MORPH INTERPOLATION:
  // Halfway through a blink (w = 0.5), linear interpolation between two sphere points dips by cos(Δβ/2) ≈ 0.892.
  // Bowing the closed upper eyelid target +3.8mm radially outward ensures the w=0.5 linear midpoint clears
  // EYE_CORNEA_RADIUS by >= +1.8mm across the ENTIRE tarsal hood -> ZERO blue iris clipping EVER!
  const outerSkirt = smoothstep(0.55, 1.0, vFrac);
  if (isUpper && blinkAmount > 0.001) {
    radOff += 0.0038 * blinkAmount * Math.sin(sAp * Math.PI) * (1 - outerSkirt * 0.85);
  }

  // Keep lateral wrap (s > 0.78) wide vertically so upper & lower outer skirts overlap & seal completely!
  const lateralSeal = smoothstep(0.74, 1.0, s) * 0.46;
  const cornerPinch =
    vFrac < 0.62
      ? Math.max(lateralSeal, 0.34 + 0.66 * Math.pow(Math.sin(s * Math.PI), 0.42))
      : Math.max(0.60, 0.52 + 0.48 * Math.pow(Math.sin(s * Math.PI), 0.35));
  const beta = baseBeta + betaOff * cornerPinch;

  const rSphere = EYE_CORNEA_RADIUS + radOff;
  const cosB = Math.cos(beta);
  const sinB = Math.sin(beta);
  let lx = ex + Math.sin(alpha) * cosB * rSphere;
  let ly = ey + sinB * rSphere;
  let lz = ez + Math.cos(alpha) * cosB * rSphere;

  // Seamless outer-skirt fusion onto exact head mesh Z (keeping outer lateral seal proud of eyeball!)
  if (outerSkirt > 0.001) {
    lx += Math.sin(alpha) * outerSkirt * 0.0038;
    ly += dir * outerSkirt * 0.0020;
    const headZ = evalFrontHeadZAt(lx, ly);
    const targetZ = headZ - outerSkirt * 0.0006;
    lz = THREE.MathUtils.lerp(lz, targetZ, smoothstep(0.58, 0.96, vFrac));
  }
  // Guarantee outer temple canthus (s > 0.76) always wraps cleanly OUTSIDE the eyeball hemisphere
  const outerCanthusGuard = smoothstep(0.76, 0.96, s) * smoothstep(0.95, 0.65, vFrac);
  if (outerCanthusGuard > 0.001) {
    const minCanthusZ = ez + Math.cos(alpha) * cosB * (EYE_CORNEA_RADIUS + 0.0018);
    lz = Math.max(lz, minCanthusZ);
  }

  // Crisp dark espresso upper eyelash rim right along upper lid aperture (matches reference dark upper lash!)
  const isLashRim = isUpper && vFrac >= 0.04 && vFrac <= 0.22 && s > 0.06 && s < 0.87;
  const uv: [number, number] = isLashRim ? [0.04, 0.04] : headLocalToUV(lx, ly, lz);

  return {
    pos: [HEAD_ORIGIN.x + lx, HEAD_ORIGIN.y + ly, HEAD_ORIGIN.z + lz],
    uv,
  };
}

/** Tiny warm-pink inner tear caruncle cushion tucked cleanly at the inner eye corner */
function buildInnerCaruncle(side: 1 | -1): THREE.BufferGeometry {
  const ex = EYE_LOCAL_X * side;
  const ey = EYE_LOCAL_Y;
  const ez = EYE_LOCAL_Z;

  const alpha = -0.80 * side;
  const r = EYE_CORNEA_RADIUS + 0.0006;
  const cx = HEAD_ORIGIN.x + ex + Math.sin(alpha) * r;
  const cy = HEAD_ORIGIN.y + ey - 0.0004;
  const cz = HEAD_ORIGIN.z + ez + Math.cos(alpha) * r;

  const segU = 10;
  const segV = 8;
  const stride = segU + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const phi = (iv / segV) * Math.PI;
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    for (let iu = 0; iu <= segU; iu++) {
      const th = (iu / segU) * Math.PI * 2;
      pos.push(
        cx + Math.cos(th) * sinP * 0.0022,
        cy + cosP * 0.0018,
        cz + Math.sin(th) * sinP * 0.0018
      );
      uv.push(0.08, 0.04);
    }
  }
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = (iv + 1) * stride + iu;
      const c = (iv + 1) * stride + iu + 1;
      const d = iv * stride + iu + 1;
      idx.push(a, b, d);
      idx.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 100% SOLID, WATERTIGHT, CLOSED anatomical outer ear (ZERO holes, ZERO cheek bleed!) */
function buildSolidWatertightEar(side: 1 | -1): THREE.BufferGeometry {
  const segU = 52;
  const segV = 34;
  const stride = segU + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const earAttachX = 0.0620 * side;
  const earAttachY = HEAD_ORIGIN.y - 0.004;
  const earAttachZ = HEAD_ORIGIN.z - 0.008;

  const tiltRad = 0.16;
  const cosTilt = Math.cos(tiltRad);
  const sinTilt = Math.sin(tiltRad);

  for (let iv = 0; iv <= segV; iv++) {
    const vFrac = iv / segV;
    const v = vFrac * Math.PI;
    const sinV = Math.sin(v);
    const cosV = Math.cos(v);
    const isFront = cosV >= 0;

    for (let iu = 0; iu <= segU; iu++) {
      const uFrac = iu / segU;
      const u = uFrac * Math.PI * 2;
      const cosU = Math.cos(u);
      const sinU = Math.sin(u);

      const upperBroad = smoothstep(-0.1, 0.75, sinU);
      const lobeRound = smoothstep(-0.35, -0.95, sinU);
      const backSweep = smoothstep(0.1, -0.85, cosU);

      const radZ = 0.0150 + upperBroad * 0.0038 + backSweep * 0.0032 - lobeRound * 0.0020;
      const radY = 0.0282 + lobeRound * 0.0038;

      let lz = sinV * cosU * radZ - 0.004 * sinV;
      let ly = sinV * sinU * radY;

      const frontWaist = smoothstep(0.2, 0.85, cosU) * gauss(sinU + 0.35, 0.35);
      lz -= frontWaist * 0.0024 * sinV;

      let lOut = isFront ? cosV * 0.0070 : cosV * 0.0064;
      let conchaWeight = 0;

      if (isFront) {
        const helixArc = smoothstep(0.55, -0.15, cosU) * smoothstep(-0.72, -0.20, sinU);
        const helixBand = gauss(sinV - 0.88, 0.14) * helixArc;
        lOut += helixBand * 0.0052;

        const antiBand =
          gauss(sinV - 0.56, 0.15) *
          smoothstep(0.25, -0.65, cosU) *
          smoothstep(-0.65, 0.55, sinU);
        lOut += antiBand * 0.0036;

        const conchaMask = gauss(sinV, 0.40) * smoothstep(-0.55, 0.35, cosU + 0.15);
        lOut -= conchaMask * 0.0050;
        conchaWeight = conchaMask;

        const tragus =
          gauss(sinV - 0.52, 0.18) *
          smoothstep(0.45, 0.92, cosU) *
          gauss(sinU + 0.12, 0.32);
        lOut += tragus * 0.0046;

        const lobeCushion = smoothstep(-0.45, -0.95, sinU) * gauss(sinV - 0.58, 0.36);
        lOut += lobeCushion * 0.0034;
      }

      const flareOut = smoothstep(0.010, -0.020, lz) * 0.0125;
      const skullEmbed = smoothstep(-0.006, 0.014, lz) * 0.011;
      const xOut = 0.0072 + lOut + flareOut - skullEmbed;

      const rotZ = lz * cosTilt - ly * sinTilt;
      const rotY = lz * sinTilt + ly * cosTilt;

      positions.push(earAttachX + xOut * side, earAttachY + rotY, earAttachZ + rotZ);

      // Smooth continuous gradient across hidden ear swatch [0.110..0.172] -> zero sharp concha seam!
      const earU = THREE.MathUtils.lerp(0.168, 0.114, clamp01(conchaWeight * 1.15));
      uvs.push(earU, 0.04);
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = (iv + 1) * stride + iu;
      const c = (iv + 1) * stride + iu + 1;
      const d = iv * stride + iu + 1;
      if (side === 1) {
        indices.push(a, d, b);
        indices.push(b, d, c);
      } else {
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** High-density sculpted head + fused 3D eyelids + caruncles + watertight ears + 6 morph targets */
function buildSculptedHeadWithMorphs(rig: CharacterRig): THREE.BufferGeometry {
  const segU = 112;
  const segV = 88;
  const stride = segU + 1;

  const basePos: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const morphDeltas: Record<FacialMorphName, number[]> = {
    Blink_L: [],
    Blink_R: [],
    Brow_Focus: [],
    Mouth_Smirk: [],
    Mouth_Grit_Fire: [],
    Nostril_Flare: [],
  };

  for (let iv = 0; iv <= segV; iv++) {
    const vFrac = iv / segV;
    const y = THREE.MathUtils.lerp(HEAD_MESH_Y_MIN, 0.116, vFrac);

    for (let iu = 0; iu <= segU; iu++) {
      const uFrac = iu / segU;
      const theta = (uFrac - 0.5) * Math.PI * 2;
      const cosT = Math.cos(theta);

      const [x, py, z] = evalSculptedFacePoint(theta, y);
      const ax = Math.abs(x);

      const wx = HEAD_ORIGIN.x + x;
      const wy = HEAD_ORIGIN.y + py;
      const wz = HEAD_ORIGIN.z + z;
      basePos.push(wx, wy, wz);

      const [u, v] = headLocalToUV(x, py, z);
      const finalU = iu === 0 ? 0 : iu === segU ? 1 : u;
      uvs.push(finalU, v);

      const frontW = smoothstep(0.15, 0.65, cosT);

      const blinkHeadDelta = (sideSign: 1 | -1): [number, number, number] => {
        if (x * sideSign < 0.006 || frontW < 0.01) return [0, 0, 0];
        const dx = x * sideSign - EYE_LOCAL_X;
        const dy = py - (EYE_LOCAL_Y + 0.014);
        const mask = smoothstep(0.020, 0.006, Math.abs(dx)) * gauss(dy, 0.007) * frontW;
        return [0, -0.0018 * mask, 0.0005 * mask];
      };
      const blL = blinkHeadDelta(1);
      const blR = blinkHeadDelta(-1);
      morphDeltas.Blink_L.push(wx + blL[0], wy + blL[1], wz + blL[2]);
      morphDeltas.Blink_R.push(wx + blR[0], wy + blR[1], wz + blR[2]);

      const browMask = gauss(py - 0.030, 0.013) * smoothstep(0.058, 0.004, ax) * frontW;
      const squintLower = gauss2D(ax, py, EYE_LOCAL_X, 0.000, 0.015, 0.007) * frontW;
      morphDeltas.Brow_Focus.push(
        wx - Math.sign(x) * browMask * 0.0032,
        wy - browMask * 0.0048 + squintLower * 0.0022,
        wz + browMask * 0.0025
      );

      const rightCorner = gauss2D(x, py, -0.022, -0.0574, 0.016, 0.013) * frontW;
      const rightCheek = gauss2D(x, py, -0.036, -0.028, 0.020, 0.016) * frontW;
      const leftCorner = gauss2D(x, py, 0.022, -0.0574, 0.012, 0.010) * frontW;
      morphDeltas.Mouth_Smirk.push(
        wx - rightCorner * 0.0040 + leftCorner * 0.0008,
        wy + rightCorner * 0.0062 + rightCheek * 0.0025 + leftCorner * 0.0008,
        wz - rightCorner * 0.0032 + rightCheek * 0.0025
      );

      const lipPull = gauss2D(ax, py, 0.022, -0.0574, 0.018, 0.013) * frontW;
      const upperSneer = gauss2D(x, py, 0, -0.051, 0.020, 0.0085) * frontW;
      const lowerTense = gauss2D(x, py, 0, -0.068, 0.024, 0.015) * frontW;
      morphDeltas.Mouth_Grit_Fire.push(
        wx + Math.sign(x) * lipPull * 0.0042,
        wy + upperSneer * 0.0032 - lowerTense * 0.0022,
        wz - lipPull * 0.0025 + upperSneer * 0.0018
      );

      const flareMask = gauss2D(ax, py, 0.013, -0.0272, 0.0085, 0.0075) * frontW;
      morphDeltas.Nostril_Flare.push(
        wx + Math.sign(x) * flareMask * 0.0034,
        wy + flareMask * 0.0014,
        wz + flareMask * 0.0020
      );
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = (iv + 1) * stride + iu;
      const c = (iv + 1) * stride + iu + 1;
      const d = iv * stride + iu + 1;
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  // Append 4 Dedicated 3D Seamlessly-Fused Eyelid Shells
  const lidSpecs: EyelidSpec[] = [
    { side: 1, isUpper: true },
    { side: 1, isUpper: false },
    { side: -1, isUpper: true },
    { side: -1, isUpper: false },
  ];
  const lidSegU = 36;
  const lidSegV = 14;
  const lidStride = lidSegU + 1;

  for (const spec of lidSpecs) {
    const startIdx = basePos.length / 3;
    for (let iv = 0; iv <= lidSegV; iv++) {
      const vf = iv / lidSegV;
      for (let iu = 0; iu <= lidSegU; iu++) {
        const uf = iu / lidSegU;
        const basePt = evalEyelidPoint(spec, uf, vf, 0, 0);
        const blinkPt = evalEyelidPoint(spec, uf, vf, 1, 0);
        const focusPt = evalEyelidPoint(spec, uf, vf, 0, 1);

        const [bx, by, bz] = basePt.pos;
        basePos.push(bx, by, bz);
        uvs.push(basePt.uv[0], basePt.uv[1]);

        if (spec.side === 1) {
          morphDeltas.Blink_L.push(blinkPt.pos[0], blinkPt.pos[1], blinkPt.pos[2]);
          morphDeltas.Blink_R.push(bx, by, bz);
        } else {
          morphDeltas.Blink_L.push(bx, by, bz);
          morphDeltas.Blink_R.push(blinkPt.pos[0], blinkPt.pos[1], blinkPt.pos[2]);
        }
        morphDeltas.Brow_Focus.push(focusPt.pos[0], focusPt.pos[1], focusPt.pos[2]);
        morphDeltas.Mouth_Smirk.push(bx, by, bz);
        morphDeltas.Mouth_Grit_Fire.push(bx, by, bz);
        morphDeltas.Nostril_Flare.push(bx, by, bz);
      }
    }

    for (let iv = 0; iv < lidSegV; iv++) {
      for (let iu = 0; iu < lidSegU; iu++) {
        const a = startIdx + iv * lidStride + iu;
        const b = startIdx + (iv + 1) * lidStride + iu;
        const c = startIdx + (iv + 1) * lidStride + iu + 1;
        const d = startIdx + iv * lidStride + iu + 1;
        if (spec.isUpper) {
          indices.push(a, d, b);
          indices.push(b, d, c);
        } else {
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
    }
  }

  // Merge Solid Watertight Closed Ears & Inner Tear Caruncles
  const earL = buildSolidWatertightEar(1);
  const earR = buildSolidWatertightEar(-1);
  const carL = buildInnerCaruncle(1);
  const carR = buildInnerCaruncle(-1);
  const extrasMerged = mergeNormalizedGeometries([earL, earR, carL, carR]);
  earL.dispose();
  earR.dispose();
  carL.dispose();
  carR.dispose();

  const extraPos = extrasMerged.attributes.position;
  const extraUv = extrasMerged.attributes.uv;
  const baseVertCount = basePos.length / 3;
  const totalVertCount = baseVertCount + extraPos.count;

  const finalPos = new Float32Array(totalVertCount * 3);
  finalPos.set(basePos, 0);
  for (let i = 0; i < extraPos.count; i++) {
    const o = (baseVertCount + i) * 3;
    finalPos[o] = extraPos.getX(i);
    finalPos[o + 1] = extraPos.getY(i);
    finalPos[o + 2] = extraPos.getZ(i);
  }

  const finalUv = new Float32Array(totalVertCount * 2);
  finalUv.set(uvs, 0);
  for (let i = 0; i < extraUv.count; i++) {
    const o = (baseVertCount + i) * 2;
    finalUv[o] = extraUv.getX(i);
    finalUv[o + 1] = extraUv.getY(i);
  }

  const finalIndices = new Uint32Array(indices.length + extraPos.count);
  finalIndices.set(indices, 0);
  for (let i = 0; i < extraPos.count; i++) {
    finalIndices[indices.length + i] = baseVertCount + i;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(finalPos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(finalUv, 2));
  geo.setIndex(new THREE.BufferAttribute(finalIndices, 1));
  geo.computeVertexNormals();

  geo.morphAttributes.position = FACIAL_MORPH_NAMES.map((name) => {
    const fullTarget = new Float32Array(totalVertCount * 3);
    fullTarget.set(morphDeltas[name], 0);
    for (let i = 0; i < extraPos.count; i++) {
      const o = (baseVertCount + i) * 3;
      fullTarget[o] = extraPos.getX(i);
      fullTarget[o + 1] = extraPos.getY(i);
      fullTarget[o + 2] = extraPos.getZ(i);
    }
    const attr = new THREE.Float32BufferAttribute(fullTarget, 3);
    attr.name = name;
    return attr;
  });

  extrasMerged.dispose();

  applySkinWeights(geo, rig, {
    allowedBones: ['Chest', 'Neck', 'Head'],
    sharpness: 3.1,
  });

  return geo;
}

/** Deeply recessed realistic steel-blue eyeballs sitting cleanly inside the skull orbit */
function buildSculptedEyes(rig: CharacterRig) {
  const buildSingleEye = (side: 'L' | 'R', isCornea: boolean): THREE.BufferGeometry => {
    const s = side === 'L' ? 1 : -1;
    const ex = HEAD_ORIGIN.x + EYE_LOCAL_X * s;
    const ey = HEAD_ORIGIN.y + EYE_LOCAL_Y;
    const ez = HEAD_ORIGIN.z + EYE_LOCAL_Z;

    const r = isCornea ? EYE_CORNEA_RADIUS : EYE_IRIS_RADIUS;
    const segU = 32;
    const segV = 24;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const stride = segU + 1;

    for (let iv = 0; iv <= segV; iv++) {
      const phi = (iv / segV) * Math.PI;
      const sinP = Math.sin(phi);
      const cosP = Math.cos(phi);
      const frontFactor = Math.max(0, cosP);
      const rad = isCornea
        ? r + Math.pow(frontFactor, 5) * 0.0008
        : r - Math.pow(frontFactor, 6) * 0.0003;

      for (let iu = 0; iu <= segU; iu++) {
        const theta = (iu / segU) * Math.PI * 2;
        const x = Math.cos(theta) * sinP * rad;
        const y = Math.sin(theta) * sinP * rad;
        const z = cosP * rad;
        positions.push(ex + x, ey + y, ez + z);

        const uvR = Math.min(0.5, (phi / (Math.PI * 0.5)) * 0.48);
        uvs.push(0.5 + Math.cos(theta) * uvR, 0.5 + Math.sin(theta) * uvR);
      }
    }

    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = iv * stride + iu;
        const b = (iv + 1) * stride + iu;
        const c = (iv + 1) * stride + iu + 1;
        const d = iv * stride + iu + 1;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    applySkinWeights(geo, rig, { rigidBone: `Eye_${side}` });
    return geo;
  };

  const irisL = buildSingleEye('L', false);
  const irisR = buildSingleEye('R', false);
  const irisGeo = mergeNormalizedGeometries([irisL, irisR]);
  irisL.dispose();
  irisR.dispose();

  const corneaL = buildSingleEye('L', true);
  const corneaR = buildSingleEye('R', true);
  const corneaGeo = mergeNormalizedGeometries([corneaL, corneaR]);
  corneaL.dispose();
  corneaR.dispose();

  return { irisGeo, corneaGeo };
}

/** Seamless undercut/fade hairline around cranium with soft natural forehead wave (NO ruler straight edge!) */
function evalHairFadeBottomY(theta: number): number {
  const at = Math.abs(theta);
  const knots: readonly [number, number][] = [
    [0.0, 0.069], // Natural feathered forehead hairline
    [0.46, 0.071],
    [0.82, 0.061],
    [1.06, 0.036],
    [1.26, -0.008], // Tapered sideburn in front of tragus
    [1.40, 0.015], // Tight front-of-ear step
    [1.58, 0.020], // Tight arch directly over top of ear (ZERO bald triangle!)
    [1.82, 0.014],
    [2.05, -0.022], // Descends cleanly behind ear
    [2.38, -0.048],
    [Math.PI, -0.056], // Clean tapered nape
  ];
  // Subtle organic forehead part dip & soft feathered micro-wave across front hairline
  const frontWave =
    smoothstep(0.75, 0.15, at) *
    (Math.sin(theta * 9.0 + 0.5) * 0.0014 - gauss(theta + 0.44, 0.18) * 0.0024);
  return evalProfileCurve(knots, at) + frontWave;
}

/**
 * Evaluates a point directly ON the sculpted swept olive-blonde quiff volume surface
 * tuned closely to the fuller layered olive-blonde crown volume in 4_a81a6ae0.jpg!
 */
function evalQuiffSurfacePoint(theta: number, vf: number, extraRadial = 0): THREE.Vector3 {
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const elev = vf * Math.PI * 0.5;
  const sinE = Math.sin(elev);

  const frontMask = smoothstep(-0.15, 0.80, cosT);
  const backMask = smoothstep(-0.15, -0.85, cosT);
  const partNotch = gauss(theta + 0.56, 0.24) * frontMask * (1 - vf * 0.65) * 0.006;

  // Lower, sleeker, tighter side-transition rim matching 4_a81a6ae0.jpg
  const rimY = 0.052 + frontMask * 0.015 - backMask * 0.036;
  const y = THREE.MathUtils.lerp(rimY, 0.1155, Math.pow(vf, 0.84));
  const [bx, by, bz] = evalBaseCraniumPoint(theta, y);

  const outDir = new THREE.Vector3(bx, by - 0.010, bz + 0.010);
  if (outDir.lengthSq() < 1e-6) outDir.set(0, 1, 0);
  outDir.normalize();

  // Seamless zero-ledge tuck at vf=0, fuller layered olive-blonde swept crown volume!
  const smoothRise = smoothstep(0.0, 0.42, vf);
  const domeTaper = 1 - Math.pow(sinE, 2.0) * 0.34;
  const sweepVolume =
    (0.0105 +
      smoothstep(-0.35, 0.55, sinT) * 0.0065 +
      frontMask * 0.0055 +
      backMask * 0.0046 -
      partNotch) *
    smoothRise *
    domeTaper;

  const flowWave =
    (Math.sin(theta * 14 + vf * 6.0) * 0.0014 + Math.sin(theta * 24 - vf * 8.0) * 0.0007) *
    Math.sin(vf * Math.PI);

  // Fuller natural olive-blonde crest matching 4_a81a6ae0.jpg
  const crestShiftX = Math.pow(sinE, 1.5) * 0.0065;
  const crestLiftY =
    Math.pow(sinE, 1.12) * (0.0175 + smoothstep(-0.25, 0.55, sinT) * 0.0065 - partNotch);
  const frontSoftForward = frontMask * Math.sin(vf * Math.PI) * 0.0052;

  const rad = 0.0014 + sweepVolume + flowWave + extraRadial;

  return new THREE.Vector3(
    HEAD_ORIGIN.x + bx + outDir.x * rad + crestShiftX,
    HEAD_ORIGIN.y + by + outDir.y * rad * 0.68 + crestLiftY,
    HEAD_ORIGIN.z + bz + outDir.z * rad + frontSoftForward
  );
}

/** Tapered 3D ribbon/lock with guaranteed right-handed outward normals */
function buildTaperedStrand(
  pts: THREE.Vector3[],
  width: number,
  thick: number,
  steps: number,
  radialSegments: number,
  upHint: THREE.Vector3,
  rootSharpness = 3.2,
  tipTaper = 0.94,
  uvScaleV = 0.95
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const rings: LoftRing[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.getPointAt(t);
    const tang = curve.getTangentAt(t).normalize();

    let right = new THREE.Vector3().crossVectors(upHint, tang);
    if (right.lengthSq() < 1e-4) {
      right.set(1, 0, 0).cross(tang);
    }
    right.normalize();
    const forward = new THREE.Vector3().crossVectors(tang, right).normalize();

    const rootIn = Math.sin(Math.min(1, t * rootSharpness) * Math.PI * 0.5);
    const tipOut = Math.pow(Math.max(0.02, 1 - t * tipTaper), 0.75);
    const wScale = rootIn * tipOut;
    const tScale = rootIn * Math.pow(Math.max(0.03, 1 - t * (tipTaper * 0.9)), 0.72);

    rings.push({
      center: p,
      right,
      forward,
      v: t * uvScaleV,
      profile: (theta) => [
        Math.cos(theta) * width * wScale,
        Math.sin(theta) * thick * tScale,
      ],
    });
  }

  return createLoftedGeometry(rings, radialSegments, true, true, 1);
}

/** Builds smooth seamless fade scalp, fuller flush feathered eyebrows, and cohesive swept quiff */
function buildSculptedHairAndBrows(rig: CharacterRig) {
  const rand = mulberry32(4211);
  const sidesParts: THREE.BufferGeometry[] = [];

  // 1. SMOOTH VELVETY SEAMLESS FADE SCALP BASE (v in [0, 1] -> ZERO zebra texture banding!)
  const segU = 84;
  const segV = 30;
  const stride = segU + 1;
  const capPos: number[] = [];
  const capUv: number[] = [];
  const capIdx: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const vf = iv / segV;
    for (let iu = 0; iu <= segU; iu++) {
      const uf = iu / segU;
      const theta = (uf - 0.5) * Math.PI * 2;
      const bottomY = evalHairFadeBottomY(theta);
      const topY = 0.1155;

      const y = THREE.MathUtils.lerp(bottomY, topY, Math.pow(vf, 0.90));
      const [bx, by, bz] = evalBaseCraniumPoint(theta, y);

      const dir = new THREE.Vector3(bx, by - 0.015, bz + 0.010);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();

      const fadeThick = THREE.MathUtils.lerp(0.0005, 0.0040, smoothstep(0.0, 0.55, vf));
      capPos.push(
        HEAD_ORIGIN.x + bx + dir.x * fadeThick,
        HEAD_ORIGIN.y + by + dir.y * fadeThick,
        HEAD_ORIGIN.z + bz + dir.z * fadeThick
      );
      // Keep V strictly in [0, 1] so subtle root-to-crown shade NEVER repeats as horizontal stripes!
      capUv.push(uf * 3.0, vf);
    }
  }
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = (iv + 1) * stride + iu;
      const c = (iv + 1) * stride + iu + 1;
      const d = iv * stride + iu + 1;
      capIdx.push(a, d, b);
      capIdx.push(b, d, c);
    }
  }
  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
  capGeo.setAttribute('uv', new THREE.Float32BufferAttribute(capUv, 2));
  capGeo.setIndex(capIdx);
  capGeo.computeVertexNormals();
  sidesParts.push(capGeo);

  // 2. FULLER FLUSH FEATHERED MULTI-STRAND EYEBROWS (18 fine tapered tufts per brow, framing eyes cleanly!)
  for (const side of [1, -1] as const) {
    const strandCount = 18;
    for (let i = 0; i < strandCount; i++) {
      const f = i / (strandCount - 1);
      const pts: THREE.Vector3[] = [];
      const rowOff = ((i % 3) - 1) * 0.0018;

      const segLen = THREE.MathUtils.lerp(0.011, 0.0145, Math.sin(f * Math.PI));
      const tStart = Math.max(0, f * 0.88 - 0.02);
      const tEnd = Math.min(1, tStart + segLen / 0.043);

      for (let k = 0; k <= 3; k++) {
        const u = k / 3;
        const t = THREE.MathUtils.lerp(tStart, tEnd, u);
        const innerLift = (1 - t) * u * 0.0022;
        const bx = (0.0088 + t * 0.0415) * side;
        // Positioned cleanly ~3mm closer to eyes for strong confident heroic gaze (matches 4_a81a6ae0.jpg!)
        const archY = 0.0286 + Math.sin(t * Math.PI * 0.82) * 0.0044 - t * 0.0020;
        const by = archY + rowOff * (1 - t * 0.42) + innerLift;

        const surfaceZ = evalFrontHeadZAt(bx, by);
        const liftZ = THREE.MathUtils.lerp(-0.0008, 0.0009, Math.sin(u * Math.PI * 0.65));
        const bz = surfaceZ + liftZ;

        pts.push(new THREE.Vector3(HEAD_ORIGIN.x + bx, HEAD_ORIGIN.y + by, HEAD_ORIGIN.z + bz));
      }

      const w = (0.0028 + (rand() - 0.5) * 0.0004) * (1 - f * 0.38);
      const th = (0.0015 + (rand() - 0.5) * 0.0002) * (1 - f * 0.34);
      sidesParts.push(
        buildTaperedStrand(pts, w, th, 6, 6, new THREE.Vector3(0, 0, 1), 3.6, 0.88, 0.9)
      );
    }
  }

  const hairSidesGeo = mergeNormalizedGeometries(sidesParts);
  for (const p of sidesParts) p.dispose();
  applySkinWeights(hairSidesGeo, rig, { rigidBone: 'Head' });

  // 3. COHESIVE SCULPTED SWEPT OLIVE-BLONDE QUIFF + 82 SURFACE-HUGGING PARALLEL FLOWING LOCKS!
  const topParts: THREE.BufferGeometry[] = [];

  const qSegU = 72;
  const qSegV = 34;
  const qStride = qSegU + 1;
  const qPos: number[] = [];
  const qUv: number[] = [];
  const qIdx: number[] = [];

  for (let iv = 0; iv <= qSegV; iv++) {
    const vf = iv / qSegV;
    for (let iu = 0; iu <= qSegU; iu++) {
      const uf = iu / qSegU;
      const theta = (uf - 0.5) * Math.PI * 2;
      const p = evalQuiffSurfacePoint(theta, vf, 0);
      qPos.push(p.x, p.y, p.z);
      // V strictly in [0, 1] -> smooth dark-olive roots transitioning cleanly to warm olive-blonde crown tips!
      qUv.push(uf * 2.8 + vf * 0.45, vf);
    }
  }
  for (let iv = 0; iv < qSegV; iv++) {
    for (let iu = 0; iu < qSegU; iu++) {
      const a = iv * qStride + iu;
      const b = (iv + 1) * qStride + iu;
      const c = (iv + 1) * qStride + iu + 1;
      const d = iv * qStride + iu + 1;
      qIdx.push(a, d, b);
      qIdx.push(b, d, c);
    }
  }
  const quiffCore = new THREE.BufferGeometry();
  quiffCore.setAttribute('position', new THREE.Float32BufferAttribute(qPos, 3));
  quiffCore.setAttribute('uv', new THREE.Float32BufferAttribute(qUv, 2));
  quiffCore.setIndex(qIdx);
  quiffCore.computeVertexNormals();
  topParts.push(quiffCore);

  const upWorld = new THREE.Vector3(0, 1, 0);

  // B. 50 Cohesive Parallel-Flowing Surface-Hugging Top Quiff Locks
  for (let i = 0; i < 50; i++) {
    const row = i % 3;
    const f = i / 49;
    const jitter = (rand() - 0.5) * 0.06;

    const th0 = THREE.MathUtils.lerp(-0.56, -1.75, f) + jitter;
    const th1 = THREE.MathUtils.lerp(-0.08, -0.55, f) + jitter * 0.8;
    const th2 = THREE.MathUtils.lerp(0.45, 0.72, f) + jitter * 0.8;
    const th3 = THREE.MathUtils.lerp(0.95, 2.05, f) + jitter;

    const vf0 = THREE.MathUtils.lerp(0.08, 0.22, row / 2) + (rand() - 0.5) * 0.04;
    const vf1 = Math.min(0.94, THREE.MathUtils.lerp(0.52, 0.82, Math.sin(f * Math.PI * 0.85)) + row * 0.06);
    const vf2 = Math.min(0.90, THREE.MathUtils.lerp(0.46, 0.68, 1 - f * 0.4) + row * 0.05);
    const vf3 = THREE.MathUtils.lerp(0.14, 0.04, f) + rand() * 0.05;

    const lift = 0.0010 + row * 0.0012;
    const pts = [
      evalQuiffSurfacePoint(th0, vf0, 0.0002),
      evalQuiffSurfacePoint(th1, vf1, lift + 0.0020),
      evalQuiffSurfacePoint(th2, vf2, lift + 0.0016),
      evalQuiffSurfacePoint(th3, vf3, 0.0004),
    ];

    const w = 0.0084 + rand() * 0.0036;
    const th = 0.0024 + rand() * 0.0009;
    topParts.push(buildTaperedStrand(pts, w, th, 10, 7, upWorld, 2.8, 0.92, 0.95));
  }

  // C. 24 Smooth Tapered Crown-to-Fade Transition Shingle Locks around sides & back
  for (let i = 0; i < 24; i++) {
    const f = i / 23;
    const sideSign = i % 2 === 0 ? 1 : -1;
    const thStart = sideSign * THREE.MathUtils.lerp(0.68, 2.38, f);
    const thMid = sideSign * Math.min(Math.PI * 0.98, Math.abs(thStart) + 0.28);
    const thEnd = sideSign * Math.min(Math.PI * 0.99, Math.abs(thStart) + 0.56);

    const pts = [
      evalQuiffSurfacePoint(thStart, 0.42 + rand() * 0.14, 0.0028),
      evalQuiffSurfacePoint(thMid, 0.22 + rand() * 0.08, 0.0022),
      evalQuiffSurfacePoint(thEnd, 0.04 + rand() * 0.04, 0.0008),
    ];

    const w = 0.0076 + rand() * 0.0026;
    const th = 0.0022 + rand() * 0.0008;
    topParts.push(buildTaperedStrand(pts, w, th, 8, 6, upWorld, 3.0, 0.94, 0.92));
  }

  // D. Soft Integrated Staggered Forelock & Hairline Transition Tufts (flush with crown mass, NO spiky twigs!)
  const hairlineWisps: { pts: [number, number, number][]; w: number; th: number }[] = [
    // Signature soft curved comma forelock tucked cleanly near right-front part (matching 4_a81a6ae0.jpg!)
    {
      pts: [
        [-0.036, 0.078, 0.082],
        [-0.030, 0.069, 0.088],
        [-0.024, 0.063, 0.089],
        [-0.018, 0.060, 0.088],
      ],
      w: 0.0072,
      th: 0.0022,
    },
    // Lush overlapping forehead-to-crown waves nested snugly into the quiff volume
    {
      pts: [
        [-0.030, 0.073, 0.084],
        [-0.008, 0.087, 0.088],
        [0.020, 0.097, 0.083],
        [0.048, 0.090, 0.065],
      ],
      w: 0.0110,
      th: 0.0028,
    },
    {
      pts: [
        [-0.016, 0.070, 0.086],
        [0.010, 0.083, 0.088],
        [0.036, 0.090, 0.077],
        [0.058, 0.081, 0.054],
      ],
      w: 0.0105,
      th: 0.0027,
    },
    {
      pts: [
        [0.002, 0.070, 0.087],
        [0.026, 0.081, 0.084],
        [0.048, 0.084, 0.068],
        [0.066, 0.072, 0.042],
      ],
      w: 0.0102,
      th: 0.0026,
    },
    {
      pts: [
        [0.022, 0.069, 0.084],
        [0.044, 0.077, 0.074],
        [0.062, 0.073, 0.050],
      ],
      w: 0.0094,
      th: 0.0024,
    },
    // Soft right-temple feathered sweep framing the side part
    {
      pts: [
        [-0.042, 0.073, 0.076],
        [-0.056, 0.082, 0.060],
        [-0.068, 0.076, 0.036],
        [-0.074, 0.062, 0.012],
      ],
      w: 0.0096,
      th: 0.0025,
    },
    // Layered upper-crown loft waves for fuller olive-blonde hero silhouette
    {
      pts: [
        [-0.022, 0.085, 0.082],
        [0.006, 0.105, 0.074],
        [0.036, 0.111, 0.054],
        [0.060, 0.097, 0.028],
      ],
      w: 0.0115,
      th: 0.0032,
    },
    {
      pts: [
        [-0.034, 0.087, 0.072],
        [-0.004, 0.111, 0.060],
        [0.028, 0.117, 0.036],
        [0.054, 0.103, 0.010],
      ],
      w: 0.0115,
      th: 0.0032,
    },
  ];

  for (const wisp of hairlineWisps) {
    const vPts = wisp.pts.map(
      ([x, y, z]) => new THREE.Vector3(HEAD_ORIGIN.x + x, HEAD_ORIGIN.y + y, HEAD_ORIGIN.z + z)
    );
    topParts.push(buildTaperedStrand(vPts, wisp.w, wisp.th, 10, 7, upWorld, 2.8, 0.94, 0.95));
  }

  const hairTopGeo = mergeNormalizedGeometries(topParts);
  for (const p of topParts) p.dispose();
  applySkinWeights(hairTopGeo, rig, { rigidBone: 'Head' });

  return { hairSidesGeo, hairTopGeo };
}

export interface HeadSculptResult {
  headMesh: THREE.SkinnedMesh;
  eyeIrisMesh: THREE.SkinnedMesh;
  eyeCorneaMesh: THREE.SkinnedMesh;
  hairSidesMesh: THREE.SkinnedMesh;
  hairTopMesh: THREE.SkinnedMesh;
}

export function buildHeadAssembly(
  rig: CharacterRig,
  materials: PBRMaterialLibrary
): HeadSculptResult {
  const headGeo = buildSculptedHeadWithMorphs(rig);
  const headMesh = createBoundSkinnedMesh('Head_Face_Mesh', headGeo, materials.skinHead, rig);

  headMesh.morphTargetDictionary = {};
  headMesh.morphTargetInfluences = [];
  FACIAL_MORPH_NAMES.forEach((name, idx) => {
    headMesh.morphTargetDictionary![name] = idx;
    headMesh.morphTargetInfluences![idx] = 0;
  });

  const { irisGeo, corneaGeo } = buildSculptedEyes(rig);
  const eyeIrisMesh = createBoundSkinnedMesh('Eyes_Iris_Mesh', irisGeo, materials.eyeIris, rig);
  const eyeCorneaMesh = createBoundSkinnedMesh(
    'Eyes_Cornea_Mesh',
    corneaGeo,
    materials.eyeCornea,
    rig
  );
  eyeCorneaMesh.castShadow = false;
  eyeCorneaMesh.renderOrder = 2;

  const { hairSidesGeo, hairTopGeo } = buildSculptedHairAndBrows(rig);
  const hairSidesMesh = createBoundSkinnedMesh(
    'Hair_Undercut_Brows_Mesh',
    hairSidesGeo,
    materials.hairSides,
    rig
  );
  const hairTopMesh = createBoundSkinnedMesh(
    'Hair_Quiff_Mesh',
    hairTopGeo,
    materials.hairTop,
    rig
  );

  return {
    headMesh,
    eyeIrisMesh,
    eyeCorneaMesh,
    hairSidesMesh,
    hairTopMesh,
  };
}
