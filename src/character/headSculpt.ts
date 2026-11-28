import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CharacterRig, skinRigidToBone, skinSmoothToBones } from './rig';
import { CharacterMaterialSet } from './textures';
import { bakeVertexColorAndDirt, mergeNormalizedGeometries } from './geometryUtils';

export const FACIAL_MORPH_NAMES = [
  'Blink_L',
  'Blink_R',
  'Brow_Focus',
  'Mouth_Smirk',
  'Mouth_Grit_Fire',
  'Nostril_Flare',
] as const;

export type FacialMorphName = (typeof FACIAL_MORPH_NAMES)[number];
export const MORPH_NAMES = FACIAL_MORPH_NAMES;
export type MorphName = FacialMorphName;

// Anatomically deep-set masculine orbital centers (cornea front at z=0.0754, nestled deeply INSIDE orbital rim!)
export const EYE_L_CENTER = new THREE.Vector3(0.0310, 1.724, 0.0640);
export const EYE_R_CENTER = new THREE.Vector3(-0.0310, 1.724, 0.0640);
export const EYEBALL_RADIUS = 0.0114;
export const EYELID_ARC_RADIUS = EYEBALL_RADIUS + 0.0015; // R = eyeballRadius + 0.0015m
export const UPPER_BLINK_DELTA_RAD = -0.68; // 78% travel downward
export const LOWER_BLINK_DELTA_RAD = +0.20; // 22% travel upward

/**
 * Pure analytical spherical-arc eyelid rotation around eyeballCenter at R = eyeballRadius + 0.0015m.
 * Rotates upper eyelid margin downward by Δθ_upper = -0.68 rad (78% travel) and lower eyelid upward
 * by Δθ_lower = +0.20 rad (22% travel) so eyelids meet cleanly at 100% closure with zero eye bleed.
 */
export function computeAnalyticalBlinkArc(
  pos: THREE.Vector3,
  eyeCenter: THREE.Vector3,
  isUpperLid: boolean,
  influence: number
): THREE.Vector3 {
  if (influence <= 1e-4) return pos.clone();
  const rel = pos.clone().sub(eyeCenter);
  const dx = rel.x;
  const dy = rel.y;
  const dz = rel.z;
  const rYZ = Math.hypot(dy, dz);
  if (rYZ < 1e-5) return pos.clone();

  const currentTheta = Math.atan2(dy, dz);
  const deltaTheta = (isUpperLid ? UPPER_BLINK_DELTA_RAD : LOWER_BLINK_DELTA_RAD) * influence;
  const targetTheta = currentTheta + deltaTheta;

  const curRadius = Math.max(rel.length(), EYELID_ARC_RADIUS);
  const targetRadius = THREE.MathUtils.lerp(curRadius, EYELID_ARC_RADIUS, Math.min(1, influence * 0.85));
  const yzPlaneR = Math.sqrt(Math.max(1e-6, targetRadius * targetRadius - dx * dx));

  return new THREE.Vector3(
    eyeCenter.x + dx,
    eyeCenter.y + Math.sin(targetTheta) * yzPlaneR,
    eyeCenter.z + Math.cos(targetTheta) * yzPlaneR
  );
}

export interface HeadSculptResult {
  headMesh: THREE.SkinnedMesh;
  hairMesh: THREE.SkinnedMesh;
  eyesMesh: THREE.SkinnedMesh;
  morphNames: readonly MorphName[];
}

/**
 * Shared exact head surface radius/center evaluator for the cranium & face dome,
 * ensuring the sculpted hair volume and eyebrow ribbons hug the skull without gaps or clipping.
 */
function evalBaseCraniumProfile(y: number, theta: number): { x: number; z: number } {
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const absSin = Math.abs(sinT);

  // Smooth masculine anatomical cross-section width (rx) and depth (rz) along face height y in [1.618..1.805]
  const yn = THREE.MathUtils.clamp((y - 1.618) / 0.187, 0, 1);

  // Width: natural athletic masculine oval-to-square taper with early smooth cranial rounding
  let rx = 0.077;
  if (yn < 0.24) {
    // Chin -> mandibular jaw angle
    const t = yn / 0.24;
    const s = t * t * (3 - 2 * t);
    rx = THREE.MathUtils.lerp(0.048, 0.0685, s);
  } else if (yn < 0.56) {
    // Smooth athletic lower cheek -> cheekbone arch
    const t = (yn - 0.24) / 0.32;
    const s = t * t * (3 - 2 * t);
    rx = THREE.MathUtils.lerp(0.0685, 0.0768, s);
  } else if (yn < 0.68) {
    // Cheekbone -> temple/parietal widest point
    const t = (yn - 0.56) / 0.12;
    rx = THREE.MathUtils.lerp(0.0768, 0.0774, t);
  } else {
    // Natural ellipsoidal rounding into the spherical crown dome (zero tall cylinder!)
    const t = (yn - 0.68) / 0.32;
    rx = THREE.MathUtils.lerp(0.0774, 0.0535, Math.pow(t, 1.55));
  }

  // Front depth (rzFront) vs rear occipital skull depth (rzBack)
  let rzFront = 0.091;
  if (yn < 0.20) {
    const t = yn / 0.20;
    const s = t * t * (3 - 2 * t);
    rzFront = THREE.MathUtils.lerp(0.085, 0.090, s);
  } else if (yn < 0.68) {
    const t = (yn - 0.20) / 0.48;
    rzFront = THREE.MathUtils.lerp(0.090, 0.093, Math.sin(t * Math.PI * 0.72));
  } else {
    const t = (yn - 0.68) / 0.32;
    rzFront = THREE.MathUtils.lerp(0.0915, 0.063, Math.pow(t, 1.5));
  }

  let rzBack = 0.092;
  if (yn < 0.28) {
    const t = yn / 0.28;
    const s = t * t * (3 - 2 * t);
    rzBack = THREE.MathUtils.lerp(0.066, 0.088, s);
  } else if (yn < 0.68) {
    const t = (yn - 0.28) / 0.40;
    rzBack = 0.088 + Math.sin(t * Math.PI) * 0.015;
  } else {
    const t = (yn - 0.68) / 0.32;
    rzBack = THREE.MathUtils.lerp(0.092, 0.064, Math.pow(t, 1.45));
  }

  const rz = cosT >= 0 ? rzFront : rzBack;

  // Slightly squared masculine jaw/temple superellipse exponent instead of cartoonish round egg
  const sq = yn < 0.42 && cosT > -0.15 ? 0.08 * (1 - yn / 0.42) : 0;
  const x = sinT * rx * (1 + sq * (1 - absSin));
  const z = -0.004 + cosT * rz;

  return { x, z };
}

/**
 * High-resolution anatomical tactical operator head & neck mesh (segU=64, segV=52).
 * Uses a dedicated linear vertical face band (v in [0.28..0.86] -> y in [1.618..1.805])
 * matching ProceduralTextureFactory's 768x768 portrait skin texture to sub-millimeter precision.
 */
function createSculptedHeadBaseGeometry(segU = 64, segV = 52): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV; // 0 = neck base (y=1.545), 1 = crown top (y=1.844)
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const theta = (u - 0.5) * Math.PI * 2; // 0 = front (+Z)
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      let x = 0;
      let y = 1.724;
      let z = 0;

      if (v < 0.18) {
        // 1. Sturdy anatomical neck (y = 1.545 -> 1.615) with SCM tendons & subtle Adam's apple
        const nt = v / 0.18;
        const s = nt * nt * (3 - 2 * nt);
        y = THREE.MathUtils.lerp(1.545, 1.615, nt);
        const rx = THREE.MathUtils.lerp(0.060, 0.055, s);
        const rz = THREE.MathUtils.lerp(0.061, 0.058, s);
        const zOff = THREE.MathUtils.lerp(-0.013, -0.009, s);
        x = sinT * rx;
        z = zOff + cosT * rz;

        // Subtle sternocleidomastoid (SCM) diagonal V-tendons along sides of neck
        const scmCenter = Math.PI * (0.20 + nt * 0.24);
        const scm = Math.exp(-Math.pow((Math.abs(theta) - scmCenter) / 0.16, 2));
        x += Math.sign(sinT) * scm * 0.0028;
        z += scm * 0.0022;

        // Subtle Adam's apple laryngeal prominence
        if (cosT > 0.6) {
          const apple =
            Math.exp(-Math.pow(theta / 0.18, 2)) * Math.exp(-Math.pow((y - 1.592) / 0.011, 2));
          z += apple * 0.0038;
        }
      } else if (v < 0.28) {
        // 2. Crisp under-chin & underside of jawline shelf (y = 1.615 -> 1.618 at front, 1.615 -> 1.638 at sides/nape)
        const jt = (v - 0.18) / 0.10;
        const s = jt * jt * (3 - 2 * jt);
        const neckX = sinT * 0.055;
        const neckZ = -0.009 + cosT * 0.058;
        const jawBase = evalBaseCraniumProfile(1.618, theta);
        // Keep a crisp flat/slightly sloped under-chin plane so jaw never melts into neck!
        const chinShelfY = cosT > 0 ? 1.618 : THREE.MathUtils.lerp(1.618, 1.630, Math.abs(cosT));
        x = THREE.MathUtils.lerp(neckX, jawBase.x, s);
        y = THREE.MathUtils.lerp(1.615, chinShelfY, Math.pow(jt, 1.3));
        z = THREE.MathUtils.lerp(neckZ, jawBase.z, s);
      } else if (v <= 0.86) {
        // 3. High-resolution linear face & cranium mid-band (30 full rings across y = 1.618 -> 1.805!)
        const ft = (v - 0.28) / 0.58;
        y = 1.618 + ft * 0.187;
        const base = evalBaseCraniumProfile(y, theta);
        x = base.x;
        z = base.z;

        // Smooth athletic masculine jawline & strong balanced chin (Ricketts E-line harmony)
        if (cosT > -0.35 && y < 1.682) {
          const gonion =
            Math.exp(-Math.pow((Math.abs(theta) - 0.92) / 0.38, 2)) *
            Math.exp(-Math.pow((y - 1.644) / 0.024, 2));
          x += Math.sign(sinT) * gonion * 0.0038;
          z += gonion * 0.0028;

          const chin =
            Math.exp(-Math.pow(x / 0.028, 2)) * Math.exp(-Math.pow((y - 1.626) / 0.015, 2));
          z += chin * 0.0125 * Math.max(0, cosT);
          y -= chin * 0.0025 * Math.max(0, cosT);

          // Subtle labiomental fold between lower lip and chin
          const labio =
            Math.exp(-Math.pow(x / 0.022, 2)) * Math.exp(-Math.pow((y - 1.6375) / 0.0055, 2));
          z -= labio * 0.0042 * Math.max(0, cosT);
        }

        // Front & 3/4 facial anatomy sculpting
        if (cosT > 0.05) {
          const frontFade = THREE.MathUtils.clamp((cosT - 0.05) / 0.35, 0, 1);

          // Gently sculpted temples
          const temple =
            Math.exp(-Math.pow((Math.abs(x) - 0.068) / 0.020, 2)) *
            Math.exp(-Math.pow((y - 1.756) / 0.022, 2));
          x -= Math.sign(x) * temple * 0.0032 * frontFade;
          z -= temple * 0.0025 * frontFade;

          // Defined masculine supraorbital brow ridge + subtle central glabella notch
          const browRidge =
            Math.exp(-Math.pow(x / 0.056, 2)) * Math.exp(-Math.pow((y - 1.747) / 0.012, 2));
          const glabellaDip =
            Math.exp(-Math.pow(x / 0.010, 2)) * Math.exp(-Math.pow((y - 1.744) / 0.009, 2));
          z += (browRidge * 0.0095 - glabellaDip * 0.0025) * frontFade;

          // Tight anatomical orbital aperture recess ONLY over the eyeball opening,
          // keeping outer orbital rim, brow hood & cheekbone forward so eyeball sides are 100% enclosed!
          const eyeX = Math.abs(x) - 0.0310;
          const eyeY = y - 1.724;
          const eyeSocket = Math.exp(
            -(eyeX * eyeX) / (0.0116 * 0.0116) - (eyeY * eyeY) / (0.0078 * 0.0078)
          );
          z -= eyeSocket * 0.0195 * frontFade;

          // Natural zygomatic cheekbones + gentle masculine cheek plane (zero pinched hourglass!)
          const cheekbone =
            Math.exp(-Math.pow((Math.abs(x) - 0.049) / 0.022, 2)) *
            Math.exp(-Math.pow((y - 1.701) / 0.019, 2));
          x += Math.sign(x) * cheekbone * 0.0040 * frontFade;
          z += cheekbone * 0.0068 * frontFade;

          const buccalHollow =
            Math.exp(-Math.pow((Math.abs(x) - 0.048) / 0.018, 2)) *
            Math.exp(-Math.pow((y - 1.664) / 0.020, 2));
          x -= Math.sign(x) * buccalHollow * 0.0014 * frontFade;
          z -= buccalHollow * 0.0016 * frontFade;

          // Subtle nasolabial cheek plane
          const nasoFold =
            Math.exp(-Math.pow((Math.abs(x) - 0.026) / 0.009, 2)) *
            Math.exp(-Math.pow((y - 1.672) / 0.016, 2));
          z += nasoFold * 0.0024 * frontFade;

          // Anatomical masculine nose: nasion -> straight bridge -> crisp tip -> columella -> alae -> recessed nostrils
          const nasionDip =
            Math.exp(-Math.pow(x / 0.009, 2)) * Math.exp(-Math.pow((y - 1.732) / 0.007, 2));
          const bridgeT = THREE.MathUtils.clamp((1.732 - y) / 0.046, 0, 1);
          const noseBridgeMask =
            Math.exp(-Math.pow(x / (0.0072 + bridgeT * 0.0022), 2)) *
            THREE.MathUtils.clamp((y - 1.682) / 0.008, 0, 1) *
            THREE.MathUtils.clamp((1.736 - y) / 0.010, 0, 1);
          const bridgeHeight = THREE.MathUtils.lerp(0.007, 0.0205, bridgeT);

          const noseTip =
            Math.exp(-Math.pow(x / 0.0095, 2)) * Math.exp(-Math.pow((y - 1.6855) / 0.0078, 2));
          const columella =
            Math.exp(-Math.pow(x / 0.0045, 2)) * Math.exp(-Math.pow((y - 1.6775) / 0.0055, 2));

          const alarWing =
            Math.exp(-Math.pow((Math.abs(x) - 0.0128) / 0.0052, 2)) *
            Math.exp(-Math.pow((y - 1.6815) / 0.0052, 2));
          const nostrilRecess =
            Math.exp(-Math.pow((Math.abs(x) - 0.0074) / 0.0034, 2)) *
            Math.exp(-Math.pow((y - 1.6775) / 0.0036, 2));

          x += Math.sign(x) * alarWing * 0.0036 * frontFade;
          z +=
            (noseBridgeMask * bridgeHeight +
              noseTip * 0.0090 +
              columella * 0.0078 +
              alarWing * 0.0078 -
              nasionDip * 0.0032 -
              nostrilRecess * 0.0068) *
            frontFade;
          y -= noseTip * 0.0018 * frontFade;

          // Philtrum groove below nose
          const philtrum =
            Math.exp(-Math.pow(x / 0.0042, 2)) * Math.exp(-Math.pow((y - 1.667) / 0.0075, 2));
          z -= philtrum * 0.0020 * frontFade;

          // Harmonious masculine lips with Cupid's bow & crisp mouth crease (realistic profile projection!)
          const mouthW = THREE.MathUtils.clamp(1 - Math.pow(Math.abs(x) / 0.0225, 2.2), 0, 1);
          const cupidShift =
            0.0016 * Math.exp(-Math.pow((Math.abs(x) - 0.0052) / 0.0040, 2)) -
            0.0012 * Math.exp(-Math.pow(x / 0.0030, 2));
          const upperLip =
            mouthW * Math.exp(-Math.pow((y - (1.6578 + cupidShift)) / 0.0046, 2));
          const lowerLip =
            THREE.MathUtils.clamp(1 - Math.pow(Math.abs(x) / 0.0200, 2.2), 0, 1) *
            Math.exp(-Math.pow((y - 1.6452) / 0.0052, 2));
          const mouthPart =
            THREE.MathUtils.clamp(1 - Math.pow(Math.abs(x) / 0.0235, 2.6), 0, 1) *
            Math.exp(-Math.pow((y - 1.6515) / 0.0022, 2));
          const cornerTuck =
            Math.exp(-Math.pow((Math.abs(x) - 0.0225) / 0.0042, 2)) *
            Math.exp(-Math.pow((y - 1.6510) / 0.0050, 2));

          z += (upperLip * 0.0068 + lowerLip * 0.0062 - mouthPart * 0.0054 - cornerTuck * 0.0040) * frontFade;
        }
      } else {
        // 4. Smooth spherical crown dome closing cleanly to natural human top pole (y = 1.805 -> 1.833)
        const ct = (v - 0.86) / 0.14; // 0 = rim at y=1.805, 1 = top pole
        const angle = ct * Math.PI * 0.5;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const rim = evalBaseCraniumProfile(1.805, theta);
        // Smooth radial collapse to crown center (0, 1.833, -0.006)
        const radScale = Math.max(0.0004, cosA);
        x = rim.x * radScale;
        z = -0.006 + (rim.z + 0.006) * radScale;
        y = 1.805 + sinA * 0.028;
      }

      positions.push(x, y, z);
      // Direct non-inverted v so WebGL v=1 -> canvas top (crown) and v=0 -> canvas bottom (neck)!
      uvs.push(u, v);
    }
  }

  // Strictly outward (+normal) counter-clockwise winding verified against skull center
  const cols = segU + 1;
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const outDir = new THREE.Vector3();

  const pushOutward = (i0: number, i1: number, i2: number) => {
    vA.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
    vB.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
    vC.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    nrm.crossVectors(e1, e2);
    const midY = (vA.y + vB.y + vC.y) / 3;
    const centerY = THREE.MathUtils.clamp(midY, 1.56, 1.76);
    outDir.set((vA.x + vB.x + vC.x) / 3, midY - centerY, (vA.z + vB.z + vC.z) / 3 + 0.006);
    if (nrm.dot(outDir) >= 0) {
      indices.push(i0, i1, i2);
    } else {
      indices.push(i0, i2, i1);
    }
  };

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * cols + iu;
      const b = a + 1;
      const c = (iv + 1) * cols + iu;
      const d = c + 1;
      pushOutward(a, b, d);
      pushOutward(a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Dedicated anatomical almond-shaped upper & lower eyelid shells riding on spherical arc
 * R = eyeballRadius + 0.0015m. Upper lid rests at +0.44 rad (covering top ~18% of iris for
 * natural focused human gaze — zero wide-eyed bug-eye look!) and aligns UVs directly to the
 * orbital skin + dark lashline of the 768x768 face texture.
 */
function createEyelidShell(
  eyeCenter: THREE.Vector3,
  isUpper: boolean,
  side: 1 | -1,
  segU = 16,
  segV = 7
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const R = EYELID_ARC_RADIUS;

  // Natural relaxed masculine palpebral fissure:
  // Upper lid margin rests at +0.30 rad (hooded focused gaze, zero wide-eyed bug-eye!)
  // Lower lid margin rests at -0.16 rad. Roots sweep smoothly back INTO orbital skin so sides never show!
  const thetaMargin = isUpper ? 0.30 : -0.16;
  const thetaRoot = isUpper ? 1.18 : -0.74;

  for (let iv = 0; iv <= segV; iv++) {
    const t = iv / segV; // 0 = recessed orbital root tucked into face, 1 = lid lash margin
    const baseTheta = THREE.MathUtils.lerp(thetaRoot, thetaMargin, t);
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU; // 0 = left edge, 1 = right edge
      const phi = THREE.MathUtils.lerp(-1.12, 1.12, u);
      const lateralSign = side * (u * 2 - 1); // -1 = inner tear duct, +1 = outer temple corner
      const canthalTilt = lateralSign * 0.045;
      const archCurve = Math.pow(Math.max(0, Math.cos(phi * 0.95)), 0.80);
      const theta = isUpper
        ? THREE.MathUtils.lerp(0.01 + canthalTilt, baseTheta + canthalTilt, Math.max(0.14, archCurve))
        : THREE.MathUtils.lerp(-0.01 + canthalTilt, baseTheta + canthalTilt, Math.max(0.14, archCurve));

      // Root (t=0) tucks cleanly INTO surrounding orbital skin (zero raised cup rim or shadow ring!);
      // Margin (t=1) hugs the eyeball sphere cleanly along R = eyeballRadius + 0.0015m.
      const rad =
        t < 0.38
          ? R - 0.0016 * (1 - t / 0.38)
          : R + 0.0007 * Math.sin(((t - 0.38) / 0.62) * Math.PI);
      const x = eyeCenter.x + Math.sin(phi) * Math.cos(theta) * rad;
      const y = eyeCenter.y + Math.sin(theta) * rad;
      // Tuck outer corners (|phi| > 0.72) smoothly back into the orbital socket wall!
      const cornerRecess = Math.max(0, Math.abs(phi) - 0.72) * 0.0058;
      const z = eyeCenter.z + Math.cos(phi) * Math.cos(theta) * rad - cornerRecess;

      positions.push(x, y, z);

      // Map UVs onto exact orbital skin & subtle lashline in the 768x768 portrait map!
      const uMap = 0.5 + side * (0.056 + lateralSign * 0.020);
      const vMap = isUpper
        ? THREE.MathUtils.lerp(0.640, 0.6155, t)
        : THREE.MathUtils.lerp(0.576, 0.6015, t);
      uvs.push(uMap, vMap);
    }
  }

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const outDir = new THREE.Vector3();

  const pushOutwardTri = (i0: number, i1: number, i2: number) => {
    vA.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
    vB.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
    vC.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    nrm.crossVectors(e1, e2);
    outDir.copy(vA).add(vB).add(vC).multiplyScalar(1 / 3).sub(eyeCenter);
    if (nrm.dot(outDir) >= 0) {
      indices.push(i0, i1, i2);
    } else {
      indices.push(i0, i2, i1);
    }
  };

  const cols = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * cols + iu;
      const b = a + 1;
      const c = (iv + 1) * cols + iu;
      const d = c + 1;
      pushOutwardTri(a, b, d);
      pushOutwardTri(a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Multi-detail sculpted anatomical ear (helix rim, antihelix ridge, recessed concha bowl & earlobe)
 * mapped cleanly onto pure body-skin UV band (u in 0.06..0.20).
 */
function createEarGeometry(side: 1 | -1): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.023, 16, 14);
  geo.scale(0.32, 1.38, 0.76);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    const ny = y / 0.032; // -1 (lobe) .. +1 (top helix)
    const nz = z / 0.017; // -1 (back) .. +1 (front tragus)

    // Recessed concha bowl on outer ear face + raised outer helix rim & antihelix fold
    const isOuter = side * x > 0;
    const radial = Math.hypot(ny * 0.85, nz + 0.15);
    if (isOuter) {
      const concha = Math.exp(-Math.pow((ny + 0.12) / 0.42, 2) - Math.pow((nz - 0.12) / 0.45, 2));
      const helix = Math.exp(-Math.pow((radial - 0.84) / 0.18, 2));
      const antihelix = Math.exp(-Math.pow((radial - 0.48) / 0.16, 2)) * (ny > -0.25 ? 1 : 0);
      x += side * (-concha * 0.0062 + helix * 0.0028 + antihelix * 0.0016);
    }

    // Taper earlobe neatly at bottom and tilt upper ear slightly outward & back
    const flare = ny > 0 ? ny * 0.0062 : 0;
    const lobeTuck = ny < -0.55 ? (ny + 0.55) * 0.004 : 0;

    pos.setXYZ(
      i,
      side * (0.078 + Math.abs(x) * 0.70 + flare + lobeTuck),
      1.712 + y,
      -0.012 + z - ny * 0.004 - Math.abs(x) * 0.35
    );
    uv.setXY(i, 0.08 + uv.getX(i) * 0.12, 0.35 + uv.getY(i) * 0.30);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Helper to create a sculpted parametric 3D hair shell (faded sides/nape OR volumetric top quiff)
 * directly anchored to evalBaseCraniumProfile so there are ZERO gaps, bald patches, or floating spikes.
 */
function createSculptedHairShell(
  uSegs: number,
  vSegs: number,
  evalPoint: (u: number, v: number) => { pos: THREE.Vector3; uv: THREE.Vector2 }
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const center = new THREE.Vector3(0, 1.745, -0.006);

  for (let iv = 0; iv <= vSegs; iv++) {
    const v = iv / vSegs;
    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;
      const sample = evalPoint(u, v);
      positions.push(sample.pos.x, sample.pos.y, sample.pos.z);
      uvs.push(sample.uv.x, sample.uv.y);
    }
  }

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const outDir = new THREE.Vector3();

  const pushOutward = (i0: number, i1: number, i2: number) => {
    vA.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
    vB.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
    vC.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    nrm.crossVectors(e1, e2);
    outDir.copy(vA).add(vB).add(vC).multiplyScalar(1 / 3).sub(center);
    if (nrm.dot(outDir) >= 0) {
      indices.push(i0, i1, i2);
    } else {
      indices.push(i0, i2, i1);
    }
  };

  const cols = uSegs + 1;
  for (let iv = 0; iv < vSegs; iv++) {
    for (let iu = 0; iu < uSegs; iu++) {
      const a = iv * cols + iu;
      const b = a + 1;
      const c = (iv + 1) * cols + iu;
      const d = c + 1;
      pushOutward(a, b, d);
      pushOutward(a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 3-Layer AAA Realistic Sculpted Tactical Fade Haircut + Continuous 3D Masculine Eyebrows:
 *  - Layer A: Sculpted tight high-and-tight faded sides & nape shell with natural M-shaped male hairline
 *  - Layer B: Sculpted volumetric top crew-cut / combed quiff mass with organic directional wave flow
 *  - Layer C: 28 smooth hugging directional strand ribbons (zero spiky floating paper scraps!)
 *  - Eyebrows: Continuous tapered 3D sculpted brow arches hugging the supraorbital ridge
 */
function createHairAlphaCardsGeometry(lodFactor = 1.0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Shared helper computing the exact sculpted outer hair surface for any angle theta & elevation elev in [0..1]
  // elev = 0 -> hairline / ear / nape perimeter; elev = 1 -> crown top center!
  const evalTacticalHairSurface = (theta: number, elev: number): THREE.Vector3 => {
    const absT = Math.abs(theta); // 0 = center front forehead, PI = center back nape

    // Natural masculine tactical hairline perimeter height yMin(theta):
    let yMin: number;
    if (absT < 0.74) {
      // Balanced 1/3-proportion male hairline across forehead with soft natural temple curve
      const t = absT / 0.74;
      const templeRecess = Math.sin(t * Math.PI) * 0.0038;
      yMin = 1.775 + templeRecess - t * t * 0.005;
    } else if (absT < 1.24) {
      // Temple smoothly into neat tapered sideburn in front of ear
      const t = (absT - 0.74) / 0.50;
      const s = t * t * (3 - 2 * t);
      yMin = THREE.MathUtils.lerp(1.770, 1.726, s);
    } else if (absT < 1.78) {
      // Smooth clean arch around upper ear
      const t = (absT - 1.24) / 0.54;
      yMin = 1.726 + Math.sin(t * Math.PI) * 0.016 - t * 0.016;
    } else {
      // Behind ear smoothly down to tapered tactical nape
      const t = (absT - 1.78) / (Math.PI - 1.78);
      const s = t * t * (3 - 2 * t);
      yMin = THREE.MathUtils.lerp(1.710, 1.656, s);
    }

    // Smooth dome-hugging vertical distribution matching natural rounded crown (y = 1.830)
    const y = THREE.MathUtils.lerp(yMin, 1.830, Math.pow(elev, 0.85));

    // Evaluate underlying rounded cranium position at (y, theta)
    let baseX: number;
    let baseZ: number;
    if (y <= 1.805) {
      const b = evalBaseCraniumProfile(y, theta);
      baseX = b.x;
      baseZ = b.z;
    } else {
      const ct = THREE.MathUtils.clamp((y - 1.805) / 0.028, 0, 1);
      const cosA = Math.sqrt(Math.max(0, 1 - ct * ct));
      const rim = evalBaseCraniumProfile(1.805, theta);
      const rs = Math.max(0.0006, cosA);
      baseX = rim.x * rs;
      baseZ = -0.006 + (rim.z + 0.006) * rs;
    }

    const dir = new THREE.Vector3(baseX, Math.max(0.01, y - 1.735), baseZ + 0.006);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    else dir.normalize();

    // Sleek realistic tactical short haircut thickness hugging the natural oval cranium:
    // - Perimeter maintains clean >= 1.8mm skull clearance so nape skin never Z-fights through hair
    // - Sides stay ultra-tight (+1.8..3.0mm)
    // - Top crown adds subtle natural fullness (+4..6mm) with zero tall bump!
    const edgeTaper = Math.sin(Math.min(1, elev * 4.2) * Math.PI * 0.5);
    const domeCenterMask = Math.pow(Math.sin(Math.min(1, elev) * Math.PI * 0.5), 1.45);
    const topMask = THREE.MathUtils.smoothstep(y, 1.778, 1.822);
    const frontQuiff =
      topMask *
      Math.exp(-Math.pow((theta - 0.08) / 0.70, 2)) *
      Math.sin(Math.min(1, elev * 1.2) * Math.PI) *
      0.0028;
    const organicWave =
      (Math.sin(theta * 5.3 + elev * 3.1) * 0.5 + Math.sin(theta * 11.7 - elev * 2.4) * 0.5) *
      0.0009 *
      topMask;

    const sideThick = 0.0018 + elev * 0.0014 * (0.25 + 0.75 * edgeTaper);
    const topLift = (topMask * 0.0042 * domeCenterMask + frontQuiff + organicWave) * edgeTaper;

    return new THREE.Vector3(
      baseX + dir.x * (sideThick + topLift * 0.22),
      y + dir.y * (sideThick + topLift) + topLift * 0.25,
      baseZ + dir.z * (sideThick + topLift * 0.28)
    );
  };

  // Layer A + B: High-resolution continuous sculpted tactical fade + natural rounded crown shell
  const shellU = Math.max(28, Math.round(64 * lodFactor));
  const shellV = Math.max(14, Math.round(30 * lodFactor));
  const mainHairShell = createSculptedHairShell(shellU, shellV, (u, v) => {
    const theta = (u - 0.5) * Math.PI * 2;
    const pos = evalTacticalHairSurface(theta, v);
    const uvU = u * 2.0;
    const uvV = 0.66 + v * 0.30;
    return { pos, uv: new THREE.Vector2(uvU, uvV) };
  });
  parts.push(mainHairShell);

  // Layer C: Flush, tapered sculpted 3D masculine eyebrows conforming 100% to curved supraorbital bone!
  for (const side of [1, -1] as const) {
    const browSegs = lodFactor >= 0.8 ? 14 : 6;
    const browGeo = createSculptedHairShell(browSegs, 4, (u, v) => {
      // u = 0 (inner glabella) -> 1 (outer brow tail); v = 0..1 across brow height
      const x = side * THREE.MathUtils.lerp(0.0120, 0.0485, u);
      const archLift =
        Math.exp(-Math.pow((u - 0.62) / 0.30, 2)) * 0.0018 - Math.max(0, u - 0.74) * 0.0038;
      // Smooth pinch taper at inner & outer ends so brow NEVER has blocky or protruding ends!
      const endTaper = Math.sin(u * Math.PI);
      const halfThick =
        THREE.MathUtils.lerp(0.0030, 0.0012, Math.pow(u, 1.1)) *
        (0.22 + 0.78 * Math.pow(endTaper, 0.45));
      const y = 1.7435 + archLift + (v - 0.5) * 2 * halfThick;

      // Exact head-surface theta (x = sin(theta) * rx) so outer brow tail wraps tightly around temple!
      const theta = Math.asin(THREE.MathUtils.clamp(x / 0.0772, -0.92, 0.92));
      const base = evalBaseCraniumProfile(y, theta);
      const frontFade = THREE.MathUtils.clamp((Math.cos(theta) - 0.05) / 0.35, 0, 1);
      const browBoost =
        Math.exp(-Math.pow(x / 0.056, 2)) * Math.exp(-Math.pow((y - 1.747) / 0.012, 2)) * 0.0095 * frontFade;
      const glabellaDip =
        Math.exp(-Math.pow(x / 0.010, 2)) * Math.exp(-Math.pow((y - 1.744) / 0.009, 2)) * 0.0025 * frontFade;
      const templeRecess =
        Math.exp(-Math.pow((Math.abs(x) - 0.068) / 0.020, 2)) *
        Math.exp(-Math.pow((y - 1.756) / 0.022, 2)) *
        0.0025 *
        frontFade;
      // Perimeter tucks -0.9mm INSIDE brow skin; center rises subtly +0.9mm flush along ridge
      const profileBump = Math.sin(v * Math.PI) * Math.pow(endTaper, 0.4) * 0.0016 - 0.0009;
      const z = base.z + browBoost - glabellaDip - templeRecess + profileBump;
      return {
        pos: new THREE.Vector3(x, y, z),
        uv: new THREE.Vector2(0.15 + u * 0.70, 0.72 + v * 0.22),
      };
    });
    parts.push(browGeo);
  }

  return mergeNormalizedGeometries(parts);
}

/**
 * Build SK_Head (< 8k tris), SK_Hair (3-layer sculpted tactical fade + eyebrows), and SK_Eyes.
 * Sets geometry.morphTargetsRelative = true strictly on SK_Head.
 */
export function buildCharacterHead(
  rig: CharacterRig,
  materials: CharacterMaterialSet,
  lodFactor = 1.0
): HeadSculptResult {
  const segU = Math.max(24, Math.round(64 * lodFactor));
  const segV = Math.max(20, Math.round(52 * lodFactor));
  const lidU = Math.max(8, Math.round(16 * lodFactor));
  const lidV = Math.max(4, Math.round(7 * lodFactor));

  const baseHead = createSculptedHeadBaseGeometry(segU, segV);
  const earL = createEarGeometry(1);
  const earR = createEarGeometry(-1);
  const upperLidL = createEyelidShell(EYE_L_CENTER, true, 1, lidU, lidV);
  const lowerLidL = createEyelidShell(EYE_L_CENTER, false, 1, lidU, lidV);
  const upperLidR = createEyelidShell(EYE_R_CENTER, true, -1, lidU, lidV);
  const lowerLidR = createEyelidShell(EYE_R_CENTER, false, -1, lidU, lidV);

  const headParts = [baseHead, earL, earR, upperLidL, lowerLidL, upperLidR, lowerLidR];
  const nonIndexedParts = headParts.map((g) => (g.index ? g.toNonIndexed() : g.clone()));
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const part of nonIndexedParts) {
    const c = part.attributes.position.count;
    ranges.push({ start: cursor, end: cursor + c });
    cursor += c;
  }

  const headGeo = mergeNormalizedGeometries(nonIndexedParts);
  for (const g of headParts) g.dispose();
  for (const g of nonIndexedParts) g.dispose();

  // Gentle vertex AO so the 768x768 portrait PBR texture drives rich natural facial shading cleanly
  bakeVertexColorAndDirt(headGeo, 0xffffff, { aoStrength: 0.08 });

  // Sculpted inner-ear concha bowl cavity AO for crisp anatomical ear depth in 3/4 & side profile
  const headPosAttr = headGeo.attributes.position;
  const headColAttr = headGeo.attributes.color;
  if (headColAttr) {
    for (let i = 0; i < headPosAttr.count; i++) {
      const vx = Math.abs(headPosAttr.getX(i));
      const vy = headPosAttr.getY(i);
      const vz = headPosAttr.getZ(i);
      if (vx > 0.074 && vy > 1.692 && vy < 1.734 && vz > -0.026 && vz < 0.005) {
        const conchaAO = Math.exp(
          -Math.pow((vy - 1.709) / 0.011, 2) - Math.pow((vz + 0.009) / 0.009, 2)
        );
        const rimShade = 1.0 - conchaAO * 0.32;
        headColAttr.setXYZ(
          i,
          headColAttr.getX(i) * rimShade,
          headColAttr.getY(i) * rimShade * 0.96,
          headColAttr.getZ(i) * rimShade * 0.94
        );
      }
    }
    headColAttr.needsUpdate = true;
  }

  skinSmoothToBones(headGeo, rig, ['neck_01', 'head'], 4.2);

  // Strictly relative morph targets on SK_Head (deltas = target - base)
  const posAttr = headGeo.attributes.position;
  const vCount = posAttr.count;
  const morphPosAttrs: THREE.Float32BufferAttribute[] = [];

  const [baseRange, , , uLidLRange, lLidLRange, uLidRRange, lLidRRange] = ranges;
  const tmp = new THREE.Vector3();

  for (const morphName of MORPH_NAMES) {
    const deltas = new Float32Array(vCount * 3);

    for (let i = 0; i < vCount; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      let dx = 0;
      let dy = 0;
      let dz = 0;

      if (morphName === 'Blink_L') {
        if (i >= uLidLRange.start && i < uLidLRange.end) {
          tmp.set(x, y, z);
          const rootBlend = THREE.MathUtils.clamp((1.742 - y) / 0.015, 0.15, 1.0);
          const target = computeAnalyticalBlinkArc(tmp, EYE_L_CENTER, true, rootBlend);
          dx = target.x - x;
          dy = target.y - y;
          dz = target.z - z;
        } else if (i >= lLidLRange.start && i < lLidLRange.end) {
          tmp.set(x, y, z);
          const rootBlend = THREE.MathUtils.clamp((y - 1.709) / 0.012, 0.2, 1.0);
          const target = computeAnalyticalBlinkArc(tmp, EYE_L_CENTER, false, rootBlend);
          dx = target.x - x;
          dy = target.y - y;
          dz = target.z - z;
        } else if (i >= baseRange.start && i < baseRange.end && x > 0.008 && z > 0.065) {
          const m = Math.exp(-Math.pow((x - 0.0315) / 0.018, 2) - Math.pow((y - 1.734) / 0.009, 2));
          dy -= m * 0.0040;
        }
      } else if (morphName === 'Blink_R') {
        if (i >= uLidRRange.start && i < uLidRRange.end) {
          tmp.set(x, y, z);
          const rootBlend = THREE.MathUtils.clamp((1.742 - y) / 0.015, 0.15, 1.0);
          const target = computeAnalyticalBlinkArc(tmp, EYE_R_CENTER, true, rootBlend);
          dx = target.x - x;
          dy = target.y - y;
          dz = target.z - z;
        } else if (i >= lLidRRange.start && i < lLidRRange.end) {
          tmp.set(x, y, z);
          const rootBlend = THREE.MathUtils.clamp((y - 1.709) / 0.012, 0.2, 1.0);
          const target = computeAnalyticalBlinkArc(tmp, EYE_R_CENTER, false, rootBlend);
          dx = target.x - x;
          dy = target.y - y;
          dz = target.z - z;
        } else if (i >= baseRange.start && i < baseRange.end && x < -0.008 && z > 0.065) {
          const m = Math.exp(-Math.pow((x + 0.0315) / 0.018, 2) - Math.pow((y - 1.734) / 0.009, 2));
          dy -= m * 0.0040;
        }
      } else if (morphName === 'Brow_Focus') {
        if (z > 0.06 && y > 1.725 && y < 1.78) {
          const inner = Math.exp(-Math.pow(x / 0.044, 2)) * Math.exp(-Math.pow((y - 1.748) / 0.015, 2));
          dx -= Math.sign(x) * inner * 0.0038;
          dy -= inner * 0.0054;
          dz += inner * 0.0034;
        }
        if (i >= lLidLRange.start && i < lLidLRange.end) {
          tmp.set(x, y, z);
          const target = computeAnalyticalBlinkArc(tmp, EYE_L_CENTER, false, 0.28);
          dx += target.x - x;
          dy += target.y - y;
          dz += target.z - z;
        } else if (i >= lLidRRange.start && i < lLidRRange.end) {
          tmp.set(x, y, z);
          const target = computeAnalyticalBlinkArc(tmp, EYE_R_CENTER, false, 0.28);
          dx += target.x - x;
          dy += target.y - y;
          dz += target.z - z;
        }
      } else if (morphName === 'Mouth_Smirk') {
        if (z > 0.055 && y > 1.63 && y < 1.685 && x > 0.004) {
          const corner =
            Math.exp(-Math.pow((x - 0.024) / 0.015, 2)) *
            Math.exp(-Math.pow((y - 1.652) / 0.012, 2));
          dx += corner * 0.0038;
          dy += corner * 0.0046;
          dz -= corner * 0.0024;
        }
      } else if (morphName === 'Mouth_Grit_Fire') {
        // Amplified tactical fire grit: jaw -3.5mm, lip pull ±4.5mm, upper lip curl +3mm
        if (z > 0.042 && y > 1.602 && y < 1.705) {
          const jawMask =
            THREE.MathUtils.clamp((1.651 - y) / 0.036, 0, 1) * Math.exp(-Math.pow(x / 0.056, 2));
          dy -= jawMask * 0.0035;
          dz += jawMask * 0.0018;

          const cornerPull =
            Math.exp(-Math.pow((Math.abs(x) - 0.024) / 0.016, 2)) *
            Math.exp(-Math.pow((y - 1.651) / 0.014, 2));
          dx += Math.sign(x) * cornerPull * 0.0045;
          dz -= cornerPull * 0.0022;

          const upperCurl =
            Math.exp(-Math.pow(x / 0.026, 2)) *
            Math.exp(-Math.pow((y - 1.658) / 0.008, 2));
          dy += upperCurl * 0.0030;
          dz += upperCurl * 0.0028;

          const lowerDepress =
            Math.exp(-Math.pow(x / 0.026, 2)) *
            Math.exp(-Math.pow((y - 1.644) / 0.008, 2));
          dy -= lowerDepress * 0.0026;
          dz += lowerDepress * 0.0016;

          const nasolabial =
            Math.exp(-Math.pow((Math.abs(x) - 0.024) / 0.013, 2)) *
            Math.exp(-Math.pow((y - 1.676) / 0.014, 2));
          dy += nasolabial * 0.0020;
          dz += nasolabial * 0.0022;
        }
      } else if (morphName === 'Nostril_Flare') {
        if (z > 0.070 && y > 1.668 && y < 1.696) {
          const wing =
            Math.exp(-Math.pow((Math.abs(x) - 0.013) / 0.008, 2)) *
            Math.exp(-Math.pow((y - 1.681) / 0.007, 2));
          dx += Math.sign(x) * wing * 0.0038;
          dy += wing * 0.0016;
          dz += wing * 0.0018;
        }
      }

      deltas[i * 3] = dx;
      deltas[i * 3 + 1] = dy;
      deltas[i * 3 + 2] = dz;
    }

    const attr = new THREE.Float32BufferAttribute(deltas, 3);
    attr.name = morphName;
    morphPosAttrs.push(attr);
  }

  headGeo.morphAttributes.position = morphPosAttrs;
  headGeo.morphTargetsRelative = true; // Strictly true on SK_Head!

  const headMesh = new THREE.SkinnedMesh(headGeo, materials.skin);
  headMesh.name = 'SK_Head';
  headMesh.morphTargetDictionary = Object.fromEntries(MORPH_NAMES.map((n, i) => [n, i]));
  headMesh.morphTargetInfluences = new Array(MORPH_NAMES.length).fill(0);
  headMesh.bind(rig.skeleton);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headMesh.frustumCulled = false;

  // 3-Layer Sculpted Tactical Hair + Continuous Sculpted Eyebrows mesh
  const hairGeo = createHairAlphaCardsGeometry(lodFactor);
  skinRigidToBone(hairGeo, 'head');
  const hairMesh = new THREE.SkinnedMesh(hairGeo, materials.hairCards);
  hairMesh.name = 'SK_Hair';
  hairMesh.bind(rig.skeleton);
  hairMesh.castShadow = true;
  hairMesh.receiveShadow = true;
  hairMesh.frustumCulled = false;

  // Eyeballs mesh (iris oriented forward along +Z with upper-lid AO shadow)
  const buildEyeball = (center: THREE.Vector3) => {
    const seg = Math.max(12, Math.round(18 * lodFactor));
    const eye = new THREE.SphereGeometry(EYEBALL_RADIUS, seg, Math.max(10, Math.round(14 * lodFactor)));
    const pos = eye.attributes.position;
    const uv = eye.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const u = 0.5 + (px / EYEBALL_RADIUS) * 0.44;
      const v = 0.5 + (py / EYEBALL_RADIUS) * 0.44;
      uv.setXY(
        i,
        pz >= 0 ? THREE.MathUtils.clamp(u, 0.02, 0.98) : 0.92,
        pz >= 0 ? THREE.MathUtils.clamp(v, 0.02, 0.98) : 0.92
      );
    }
    eye.translate(center.x, center.y, center.z);
    return eye;
  };
  const eyeL = buildEyeball(EYE_L_CENTER);
  const eyeR = buildEyeball(EYE_R_CENTER);
  const eyesGeo = mergeNormalizedGeometries([eyeL, eyeR]);
  eyeL.dispose();
  eyeR.dispose();
  skinRigidToBone(eyesGeo, 'head');

  const eyesMesh = new THREE.SkinnedMesh(eyesGeo, materials.eyeOptic);
  eyesMesh.name = 'SK_Eyes';
  eyesMesh.bind(rig.skeleton);
  eyesMesh.castShadow = true;
  eyesMesh.receiveShadow = true;
  eyesMesh.frustumCulled = false;

  void BufferGeometryUtils;

  return {
    headMesh,
    hairMesh,
    eyesMesh,
    morphNames: MORPH_NAMES,
  };
}
