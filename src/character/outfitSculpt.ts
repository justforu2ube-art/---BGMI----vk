import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BONE_NAME_TO_INDEX,
  CharacterRig,
  computeSmoothstepTwistWeights,
  normalizeSkinWeightsOnGeometry,
  skinRigidToBone,
  skinSmoothToBones,
} from './rig';
import { CharacterMaterialSet } from './textures';
import {
  bakeVertexColorAndDirt,
  createLoftedLimb,
  createLoftedTube,
  createRoundedBox,
  mergeNormalizedGeometries,
} from './geometryUtils';

export interface OutfitBuildResult {
  meshes: THREE.SkinnedMesh[];
}

/**
 * Closed-manifold rolled-sleeve torus-fold cuff built via THREE.LatheGeometry.
 * Inner collar radius = forearmRadius - 0.003m overlapping cleanly onto the bare forearm
 * with outward-verified FrontSide normals and outer/inner vertices locked identically to upperarm_l/r smoothstep weights.
 */
function createClosedManifoldSleeveCuff(
  side: 1 | -1,
  rig: CharacterRig,
  radialSegments = 22
): THREE.BufferGeometry {
  const forearmRadius = 0.043;
  const rInner = forearmRadius - 0.003; // 0.040m cleanly hugs bare forearm with zero hollow gap
  const rOuter = 0.062;
  const cuffLen = 0.056;

  // Closed-loop 2D cross-section profile around +Y axis:
  // Outer wall runs bottom-to-top (-Y -> +Y) and inner wall runs top-to-bottom (+Y -> -Y)
  // so THREE.LatheGeometry generates verified outward FrontSide normals on every wall!
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(rInner, -cuffLen * 0.45),
    new THREE.Vector2(rInner + 0.004, -cuffLen * 0.48),
    new THREE.Vector2((rInner + rOuter) * 0.50, -cuffLen * 0.50),
    new THREE.Vector2(rOuter, -cuffLen * 0.36),
    new THREE.Vector2(rOuter + 0.004, 0.0),
    new THREE.Vector2(rOuter, cuffLen * 0.36),
    new THREE.Vector2((rInner + rOuter) * 0.52, cuffLen * 0.52),
    new THREE.Vector2(rInner + 0.006, cuffLen * 0.48),
    new THREE.Vector2(rInner, cuffLen * 0.32),
    new THREE.Vector2(rInner, -cuffLen * 0.45),
  ];

  const lathe = new THREE.LatheGeometry(profile, radialSegments);

  const sSuffix = side === 1 ? 'l' : 'r';
  const elbowPos = rig.restWorldPositions[`lowerarm_${sSuffix}`];
  const upperPos = rig.restWorldPositions[`upperarm_${sSuffix}`];
  const twistPos = rig.restWorldPositions[`upperarm_twist_01_${sSuffix}`];

  // Orient lathe +Y axis EXACTLY coaxial with upperarm -> elbow bone vector (zero sideways ring!)
  const armVec = elbowPos.clone().sub(upperPos);
  const armLen = armVec.length();
  const armAxis = armVec.clone().divideScalar(Math.max(armLen, 1e-5));
  const alignQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), armAxis);
  lathe.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(alignQuat));

  // Seat rolled cuff purely on upper arm proximal to elbow crease so flexion never pinches it
  const cuffCenter = upperPos.clone().lerp(elbowPos, 0.72);
  lathe.translate(cuffCenter.x, cuffCenter.y, cuffCenter.z);

  const welded = BufferGeometryUtils.mergeVertices(lathe, 1e-4);
  lathe.dispose();
  welded.computeVertexNormals();
  bakeVertexColorAndDirt(welded, 0xf0f4ec, { aoStrength: 0.18 });

  // Lock ALL outer & inner cuff vertices identically to upperarm_l/r + upperarm_twist_01_l/r
  // using exact longitudinal projection along armAxis!
  const upperIdx = BONE_NAME_TO_INDEX[`upperarm_${sSuffix}`];
  const twistIdx = BONE_NAME_TO_INDEX[`upperarm_twist_01_${sSuffix}`];
  const pos = welded.attributes.position;
  const count = pos.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  const sMid = twistPos.clone().sub(upperPos).dot(armAxis);
  const pt = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    pt.fromBufferAttribute(pos, i).sub(upperPos);
    const sLong = pt.dot(armAxis);
    const { wPrimary, wTwist } = computeSmoothstepTwistWeights(sLong, 0, sMid, armLen, 0.045);
    skinIndices[i * 4] = upperIdx;
    skinIndices[i * 4 + 1] = twistIdx;
    skinWeights[i * 4] = wPrimary;
    skinWeights[i * 4 + 1] = wTwist;
  }

  welded.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  welded.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  return normalizeSkinWeightsOnGeometry(welded);
}

/**
 * Smooth bare forearms (22 radial segments) welded via BufferGeometryUtils.mergeVertices()
 * with computeVertexNormals() (flatShading: false) and explicit lowerarm + lowerarm_twist_01
 * smoothstep weights (radius = 0.045m).
 */
function createSmoothBareForearm(
  side: 1 | -1,
  rig: CharacterRig,
  radialSegments = 22
): THREE.BufferGeometry {
  const sSuffix = side === 1 ? 'l' : 'r';
  const elbow = rig.restWorldPositions[`lowerarm_${sSuffix}`];
  const twist = rig.restWorldPositions[`lowerarm_twist_01_${sSuffix}`];
  const wrist = rig.restWorldPositions[`hand_${sSuffix}`];
  const upper = rig.restWorldPositions[`upperarm_${sSuffix}`];
  const start = upper.clone().lerp(elbow, 0.66); // Tucks seamlessly inside the closed torus-fold cuff!

  const rings = [
    { center: start, rx: 0.041, ry: 0.041 },
    { center: start.clone().lerp(elbow, 0.55), rx: 0.0475, ry: 0.0455 },
    { center: elbow.clone().lerp(wrist, 0.14), rx: 0.0505, ry: 0.0475 },
    { center: elbow.clone().lerp(wrist, 0.36), rx: 0.0475, ry: 0.0445 },
    { center: elbow.clone().lerp(wrist, 0.60), rx: 0.0415, ry: 0.0390 },
    { center: elbow.clone().lerp(wrist, 0.84), rx: 0.0355, ry: 0.0335 },
    { center: wrist.clone().lerp(elbow, 0.04), rx: 0.0335, ry: 0.0315 },
  ];

  const raw = createLoftedLimb(rings, radialSegments, true, true);
  const welded = BufferGeometryUtils.mergeVertices(raw, 1e-4);
  raw.dispose();
  welded.computeVertexNormals();
  // Map arm UVs strictly onto pure body-skin strip (u in 0.04..0.22) away from portrait face atlas
  const fUv = welded.attributes.uv;
  if (fUv) {
    for (let i = 0; i < fUv.count; i++) {
      fUv.setXY(i, 0.04 + (fUv.getX(i) % 1) * 0.18, 0.12 + (fUv.getY(i) % 1) * 0.76);
    }
  }
  bakeVertexColorAndDirt(welded, 0xffffff, { aoStrength: 0.10 });

  const lowerIdx = BONE_NAME_TO_INDEX[`lowerarm_${sSuffix}`];
  const lowerTwistIdx = BONE_NAME_TO_INDEX[`lowerarm_twist_01_${sSuffix}`];
  const upperTwistIdx = BONE_NAME_TO_INDEX[`upperarm_twist_01_${sSuffix}`];
  const handIdx = BONE_NAME_TO_INDEX[`hand_${sSuffix}`];

  const foreVec = wrist.clone().sub(elbow);
  const foreLen = foreVec.length();
  const foreAxis = foreVec.clone().divideScalar(Math.max(foreLen, 1e-5));
  const sTwist = twist.clone().sub(elbow).dot(foreAxis);

  const pos = welded.attributes.position;
  const count = pos.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  const pt = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    pt.fromBufferAttribute(pos, i).sub(elbow);
    const sLong = pt.dot(foreAxis);

    if (sLong < -0.01) {
      const t = THREE.MathUtils.clamp((-sLong - 0.01) / 0.045, 0, 1);
      const u = t * t * (3 - 2 * t);
      skinIndices[i * 4] = lowerIdx;
      skinIndices[i * 4 + 1] = upperTwistIdx;
      skinWeights[i * 4] = 1 - u * 0.7;
      skinWeights[i * 4 + 1] = u * 0.7;
    } else {
      const { wPrimary, wTwist } = computeSmoothstepTwistWeights(
        sLong,
        0,
        sTwist,
        foreLen,
        0.045
      );
      const nearWrist = THREE.MathUtils.clamp((sLong - (foreLen - 0.032)) / 0.032, 0, 1);
      const wHand = nearWrist * nearWrist * (3 - 2 * nearWrist) * 0.35;
      skinIndices[i * 4] = lowerIdx;
      skinIndices[i * 4 + 1] = lowerTwistIdx;
      skinIndices[i * 4 + 2] = handIdx;
      skinWeights[i * 4] = wPrimary * (1 - wHand);
      skinWeights[i * 4 + 1] = wTwist * (1 - wHand);
      skinWeights[i * 4 + 2] = wHand;
    }
  }

  welded.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  welded.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  return normalizeSkinWeightsOnGeometry(welded);
}

function createArticulatedHands(
  rig: CharacterRig,
  lodFactor: number
): { skinParts: THREE.BufferGeometry[]; gloveParts: THREE.BufferGeometry[] } {
  const skinParts: THREE.BufferGeometry[] = [];
  const gloveParts: THREE.BufferGeometry[] = [];
  const fingerNames = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
  const fSegs = Math.max(6, Math.round(10 * lodFactor));

  for (const side of [1, -1] as const) {
    const s = side === 1 ? 'l' : 'r';
    const handPos = rig.restWorldPositions[`hand_${s}`];
    const midPos = rig.restWorldPositions[`middle_01_${s}`];
    const palmCenter = handPos.clone().lerp(midPos, 0.52);

    // Armored fingerless tactical glove shell over palm & knuckles
    const palmBox = createRoundedBox(0.088, 0.032, 0.082, 0.009, 2);
    palmBox.translate(palmCenter.x, palmCenter.y - 0.002, palmCenter.z + 0.002);
    bakeVertexColorAndDirt(palmBox, 0xd4dcd0, { aoStrength: 0.16 });
    skinRigidToBone(palmBox, `hand_${s}`);
    gloveParts.push(palmBox);

    // Molded carbon knuckle guard across metacarpals
    const knuckleBar = createRoundedBox(0.022, 0.015, 0.078, 0.005, 1);
    knuckleBar.translate(midPos.x - side * 0.006, midPos.y + 0.015, midPos.z - 0.004);
    bakeVertexColorAndDirt(knuckleBar, 0xb8bec4, { aoStrength: 0.18 });
    skinRigidToBone(knuckleBar, `hand_${s}`);
    gloveParts.push(knuckleBar);

    // Velcro wrist cuff strap on glove
    const wristStrap = createRoundedBox(0.028, 0.044, 0.068, 0.008, 1);
    wristStrap.translate(handPos.x + side * 0.012, handPos.y, handPos.z);
    bakeVertexColorAndDirt(wristStrap, 0xc2c8c0, { aoStrength: 0.18 });
    skinRigidToBone(wristStrap, `hand_${s}`);
    gloveParts.push(wristStrap);

    // Articulated 3-phalanx fingers (proximal glove wrap + exposed skin fingertips)
    for (const f of fingerNames) {
      const b1 = `${f}_01_${s}`;
      const b2 = `${f}_02_${s}`;
      const b3 = `${f}_03_${s}`;
      const p1 = rig.restWorldPositions[b1];
      const p2 = rig.restWorldPositions[b2];
      const p3 = rig.restWorldPositions[b3];
      const tip =
        f === 'thumb'
          ? p3.clone().add(new THREE.Vector3(side * 0.022, -0.010, 0.014))
          : p3.clone().add(new THREE.Vector3(side * 0.026, -0.002, 0));

      const rBase = f === 'thumb' ? 0.0105 : f === 'pinky' ? 0.0076 : 0.009;
      const prox = createLoftedLimb(
        [
          { center: p1.clone().lerp(palmCenter, 0.12), rx: rBase * 1.12, ry: rBase * 1.08 },
          { center: p2, rx: rBase * 0.98, ry: rBase * 0.94 },
        ],
        fSegs,
        true,
        true
      );
      bakeVertexColorAndDirt(prox, 0xd4dcd0, { aoStrength: 0.16 });
      skinSmoothToBones(prox, rig, [`hand_${s}`, b1, b2], 5.5);
      gloveParts.push(prox);

      const dist = createLoftedLimb(
        [
          { center: p2.clone().lerp(p1, 0.06), rx: rBase * 0.88, ry: rBase * 0.86 },
          { center: p3, rx: rBase * 0.80, ry: rBase * 0.78 },
          { center: tip, rx: rBase * 0.62, ry: rBase * 0.58 },
        ],
        fSegs,
        true,
        true
      );
      const dUv = dist.attributes.uv;
      if (dUv) {
        for (let i = 0; i < dUv.count; i++) {
          dUv.setXY(i, 0.05 + (dUv.getX(i) % 1) * 0.16, 0.18 + (dUv.getY(i) % 1) * 0.64);
        }
      }
      bakeVertexColorAndDirt(dist, 0xffffff, { aoStrength: 0.14 });
      skinSmoothToBones(dist, rig, [b1, b2, b3], 6.0);
      skinParts.push(dist);
    }
  }

  return { skinParts, gloveParts };
}

/**
 * Beveled polymer/Cordura drop-leg Kydex holster mounted cleanly on thigh_r
 * under the two tactical leg straps.
 */
function createDropLegKydexHolster(rig: CharacterRig): {
  leatherParts: THREE.BufferGeometry[];
  metalParts: THREE.BufferGeometry[];
} {
  const leatherParts: THREE.BufferGeometry[] = [];
  const metalParts: THREE.BufferGeometry[] = [];
  const thighR = rig.restWorldPositions['thigh_r'];
  const hx = thighR.x - 0.104;
  const hy = thighR.y - 0.165;
  const hz = thighR.z + 0.008;

  // Molded drop-leg Cordura/polymer backing shroud
  const shroud = createRoundedBox(0.018, 0.185, 0.115, 0.006, 2);
  shroud.translate(hx + 0.008, hy + 0.005, hz);
  bakeVertexColorAndDirt(shroud, 0xc8cec6, { aoStrength: 0.18 });
  skinRigidToBone(shroud, 'thigh_r');
  leatherParts.push(shroud);

  // Beveled Kydex shell body wrapping holstered pistol slide + trigger guard
  const shellMain = createRoundedBox(0.044, 0.155, 0.068, 0.008, 2);
  shellMain.rotateX(0.06);
  shellMain.translate(hx - 0.012, hy - 0.006, hz + 0.004);
  bakeVertexColorAndDirt(shellMain, 0xb6bcc2, { aoStrength: 0.20 });
  skinRigidToBone(shellMain, 'thigh_r');
  leatherParts.push(shellMain);

  // Raised Kydex retention hood & ALS thumb release tab
  const hood = createRoundedBox(0.040, 0.036, 0.048, 0.006, 2);
  hood.translate(hx - 0.012, hy + 0.064, hz - 0.002);
  bakeVertexColorAndDirt(hood, 0xa8aeb4, { aoStrength: 0.18 });
  skinRigidToBone(hood, 'thigh_r');
  leatherParts.push(hood);

  // Vertical belt-drop hanger strap connecting holster shroud up to tactical duty belt
  const hanger = createRoundedBox(0.014, 0.175, 0.044, 0.004, 1);
  hanger.translate(hx + 0.006, hy + 0.160, hz);
  bakeVertexColorAndDirt(hanger, 0xc2c7c0, { aoStrength: 0.18 });
  skinSmoothToBones(hanger, rig, ['thigh_r', 'pelvis'], 4.5);
  leatherParts.push(hanger);

  // Dual Kydex retention screws & quick-release QD buckle hardware
  for (const dy of [-0.04, 0.025]) {
    const rivet = new THREE.CylinderGeometry(0.0055, 0.0055, 0.010, 8);
    rivet.rotateZ(Math.PI * 0.5);
    rivet.translate(hx - 0.034, hy + dy, hz + 0.020);
    bakeVertexColorAndDirt(rivet, 0xd8dfe6, { aoStrength: 0.14 });
    skinRigidToBone(rivet, 'thigh_r');
    metalParts.push(rivet);
  }

  return { leatherParts, metalParts };
}

/**
 * Build the complete Vanguard Tactical Operator outfit with:
 * - Closed-manifold rolled-sleeve torus-fold cuffs (zero hollow gap/flap)
 * - Smooth 22-segment twist-weighted bare forearms (zero crease pinch)
 * - Drop-leg Kydex holster on thigh_r under twin leg straps
 * - Rear trouser seat pockets strictly locked to pelvis = 1.0 (zero skew)
 * - Consolidated <= 6 character materials + vertex COLOR_0 cavity AO & lower-leg dirt
 * - Adaptive LOD scaling (lodFactor: 1.0 = LOD0 ~22k body+outfit, 0.65 = LOD1, 0.40 = LOD2)
 */
export function buildCharacterOutfit(
  rig: CharacterRig,
  materials: CharacterMaterialSet,
  lodFactor = 1.0
): OutfitBuildResult {
  const skinParts: THREE.BufferGeometry[] = [];
  const corduraParts: THREE.BufferGeometry[] = [];
  const leatherParts: THREE.BufferGeometry[] = [];
  const metalParts: THREE.BufferGeometry[] = [];

  const torsoRad = Math.max(12, Math.round(28 * lodFactor));
  const limbRad = Math.max(10, Math.round(22 * lodFactor));
  const legRad = Math.max(10, Math.round(22 * lodFactor));

  // 1. Tactical Combat Jacket Torso + Standing Collar
  const jacketTorso = createLoftedTube(
    [
      { y: 0.895, rx: 0.186, rz: 0.132, zOffset: -0.004 },
      { y: 0.965, rx: 0.174, rz: 0.126, zOffset: -0.002 },
      { y: 1.060, rx: 0.164, rz: 0.118, zOffset: 0.002 },
      { y: 1.180, rx: 0.178, rz: 0.128, zOffset: 0.005 },
      { y: 1.310, rx: 0.204, rz: 0.140, zOffset: 0.006 },
      { y: 1.430, rx: 0.214, rz: 0.132, zOffset: 0.002 },
      { y: 1.505, rx: 0.165, rz: 0.105, zOffset: -0.006 },
      { y: 1.555, rx: 0.088, rz: 0.082, zOffset: -0.006 },
      { y: 1.605, rx: 0.082, rz: 0.078, zOffset: -0.004 },
    ],
    torsoRad,
    true,
    false
  );
  bakeVertexColorAndDirt(jacketTorso, 0xf2f6ee, { aoStrength: 0.16 });
  skinSmoothToBones(
    jacketTorso,
    rig,
    ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'clavicle_l', 'clavicle_r'],
    3.4
  );
  corduraParts.push(jacketTorso);

  // Center front storm flap + metal YKK zipper rail
  const stormFlap = createRoundedBox(0.036, 0.56, 0.018, 0.005, 1);
  stormFlap.translate(0, 1.24, 0.136);
  bakeVertexColorAndDirt(stormFlap, 0xd8dfd2, { aoStrength: 0.18 });
  skinSmoothToBones(stormFlap, rig, ['spine_01', 'spine_02', 'spine_03'], 4.0);
  corduraParts.push(stormFlap);

  const zipperPull = createRoundedBox(0.016, 0.040, 0.012, 0.003, 1);
  zipperPull.translate(0, 1.49, 0.130);
  bakeVertexColorAndDirt(zipperPull, 0xe0e6ec, { aoStrength: 0.14 });
  skinRigidToBone(zipperPull, 'spine_03');
  metalParts.push(zipperPull);

  // 2. Rolled Upper Sleeves + Closed-Manifold Torus-Fold Cuffs + Smooth Twist-Weighted Forearms
  for (const side of [1, -1] as const) {
    const s = side === 1 ? 'l' : 'r';
    const clav = rig.restWorldPositions[`clavicle_${s}`];
    const upper = rig.restWorldPositions[`upperarm_${s}`];
    const elbow = rig.restWorldPositions[`lowerarm_${s}`];

    const sleeve = createLoftedLimb(
      [
        { center: clav.clone().lerp(upper, 0.65), rx: 0.094, ry: 0.098 },
        { center: upper.clone(), rx: 0.084, ry: 0.086 },
        { center: upper.clone().lerp(elbow, 0.35), rx: 0.072, ry: 0.072 },
        { center: upper.clone().lerp(elbow, 0.64), rx: 0.063, ry: 0.063 },
        { center: upper.clone().lerp(elbow, 0.76), rx: 0.058, ry: 0.058 },
      ],
      limbRad,
      true,
      true
    );
    bakeVertexColorAndDirt(sleeve, 0xf2f6ee, { aoStrength: 0.16 });
    skinSmoothToBones(
      sleeve,
      rig,
      ['spine_03', `clavicle_${s}`, `upperarm_${s}`, `upperarm_twist_01_${s}`],
      3.8
    );
    corduraParts.push(sleeve);

    // Closed-manifold rolled sleeve torus-fold cuff (coaxial with upperarm->elbow, zero gap!)
    const cuff = createClosedManifoldSleeveCuff(side, rig, limbRad);
    corduraParts.push(cuff);

    // Shoulder armor pad cap hugging deltoid contour
    const shoulderPad = createRoundedBox(0.105, 0.030, 0.105, 0.012, 2);
    shoulderPad.rotateZ(side * -0.52);
    shoulderPad.translate(upper.x - side * 0.004, upper.y + 0.044, upper.z);
    bakeVertexColorAndDirt(shoulderPad, 0xc2c8c0, { aoStrength: 0.18 });
    skinSmoothToBones(shoulderPad, rig, [`clavicle_${s}`, `upperarm_${s}`], 4.2);
    leatherParts.push(shoulderPad);

    // Velcro unit patch on upper sleeve
    const patch = createRoundedBox(0.062, 0.044, 0.010, 0.003, 1);
    patch.rotateY(side * Math.PI * 0.5);
    const patchPos = upper.clone().lerp(elbow, 0.36);
    patch.translate(patchPos.x + side * 0.064, patchPos.y + 0.004, patchPos.z);
    bakeVertexColorAndDirt(patch, 0xc8cec4, { aoStrength: 0.16 });
    skinRigidToBone(patch, `upperarm_${s}`);
    leatherParts.push(patch);

    // Smooth 22-segment bare forearm with mergeVertices + lowerarm_twist_01 smoothstep weights
    const forearm = createSmoothBareForearm(side, rig, limbRad);
    skinParts.push(forearm);
  }

  // 3. Tactical Plate Carrier / Chest Rig, Magazine Pouches & Brass Grommets
  const frontPlate = createRoundedBox(0.285, 0.305, 0.056, 0.014, 2);
  frontPlate.translate(0, 1.315, 0.132);
  bakeVertexColorAndDirt(frontPlate, 0xdfe6d9, { aoStrength: 0.16 });
  skinSmoothToBones(frontPlate, rig, ['spine_02', 'spine_03'], 4.2);
  corduraParts.push(frontPlate);

  const rearPlate = createRoundedBox(0.285, 0.315, 0.054, 0.014, 2);
  rearPlate.translate(0, 1.320, -0.130);
  bakeVertexColorAndDirt(rearPlate, 0xdfe6d9, { aoStrength: 0.16 });
  skinSmoothToBones(rearPlate, rig, ['spine_02', 'spine_03'], 4.2);
  corduraParts.push(rearPlate);

  // Triple front magazine pouches + admin pouch + radio pouch
  for (let i = -1; i <= 1; i++) {
    const pouch = createRoundedBox(0.072, 0.128, 0.044, 0.008, 2);
    pouch.translate(i * 0.084, 1.215, 0.168);
    bakeVertexColorAndDirt(pouch, 0xd0d8c8, { aoStrength: 0.18 });
    skinSmoothToBones(pouch, rig, ['spine_01', 'spine_02'], 4.5);
    corduraParts.push(pouch);

    // Retention flap strap
    const flap = createRoundedBox(0.048, 0.036, 0.048, 0.005, 1);
    flap.translate(i * 0.084, 1.275, 0.170);
    bakeVertexColorAndDirt(flap, 0xc2c8c0, { aoStrength: 0.16 });
    skinSmoothToBones(flap, rig, ['spine_02', 'spine_03'], 4.5);
    leatherParts.push(flap);
  }

  // Side cummerbund utility pouches
  for (const side of [1, -1] as const) {
    const sidePouch = createRoundedBox(0.048, 0.120, 0.105, 0.008, 1);
    sidePouch.translate(side * 0.194, 1.175, 0.010);
    bakeVertexColorAndDirt(sidePouch, 0xcfd7c7, { aoStrength: 0.18 });
    skinSmoothToBones(sidePouch, rig, ['spine_01', 'spine_02'], 4.5);
    corduraParts.push(sidePouch);
  }

  // Chest ventilation / PALS hardware grommets (8 clean rings on upper chest)
  const grommetSegs = lodFactor >= 0.8 ? 8 : 6;
  for (const side of [1, -1] as const) {
    for (let g = 0; g < 4; g++) {
      const grom = new THREE.TorusGeometry(0.0075, 0.0022, 6, grommetSegs);
      grom.translate(side * (0.068 + (g % 2) * 0.028), 1.385 + Math.floor(g / 2) * 0.026, 0.162);
      bakeVertexColorAndDirt(grom, 0xddd6c2, { aoStrength: 0.14 });
      skinRigidToBone(grom, 'spine_03');
      metalParts.push(grom);
    }
  }

  // 4. Heavy Tactical Duty Belt & Quick-Release Cobra Buckle
  const belt = createLoftedTube(
    [
      { y: 0.920, rx: 0.184, rz: 0.138, zOffset: 0.002 },
      { y: 0.972, rx: 0.184, rz: 0.138, zOffset: 0.002 },
    ],
    torsoRad,
    true,
    true
  );
  bakeVertexColorAndDirt(belt, 0xbec4ca, { aoStrength: 0.18 });
  skinRigidToBone(belt, 'pelvis');
  leatherParts.push(belt);

  const buckle = createRoundedBox(0.072, 0.056, 0.022, 0.005, 2);
  buckle.translate(0, 0.946, 0.145);
  bakeVertexColorAndDirt(buckle, 0xd4dce4, { aoStrength: 0.14 });
  skinRigidToBone(buckle, 'pelvis');
  metalParts.push(buckle);

  // 5. Pelvis / Seat Trousers + Legs (with Lower-Leg Mud/Dust Gradient baked in COLOR_0)
  const pelvisShell = createLoftedTube(
    [
      { y: 0.805, rx: 0.182, rz: 0.130, zOffset: -0.006 },
      { y: 0.875, rx: 0.188, rz: 0.136, zOffset: -0.005 },
      { y: 0.945, rx: 0.180, rz: 0.130, zOffset: -0.002 },
    ],
    torsoRad,
    true,
    true
  );
  bakeVertexColorAndDirt(pelvisShell, 0xe4ebdd, { aoStrength: 0.18 });
  skinSmoothToBones(pelvisShell, rig, ['pelvis', 'thigh_l', 'thigh_r'], 3.8);
  corduraParts.push(pelvisShell);

  // Rear trouser seat pockets locked STRICTLY to pelvis = 1.0 (zero thigh skew!)
  for (const side of [1, -1] as const) {
    const rearPocket = createRoundedBox(0.095, 0.105, 0.022, 0.006, 1);
    rearPocket.rotateY(side * -0.18);
    rearPocket.translate(side * 0.088, 0.885, -0.128);
    bakeVertexColorAndDirt(rearPocket, 0xd4dcd0, { aoStrength: 0.18 });
    skinRigidToBone(rearPocket, 'pelvis'); // Strictly pelvis = 1.0!
    corduraParts.push(rearPocket);
  }

  for (const side of [1, -1] as const) {
    const s = side === 1 ? 'l' : 'r';
    const thigh = rig.restWorldPositions[`thigh_${s}`];
    const calf = rig.restWorldPositions[`calf_${s}`];
    const foot = rig.restWorldPositions[`foot_${s}`];

    const trouserLeg = createLoftedTube(
      [
        { y: 0.195, rx: 0.068, rz: 0.072, xOffset: foot.x, zOffset: foot.z + 0.006 },
        { y: 0.340, rx: 0.076, rz: 0.080, xOffset: calf.x, zOffset: calf.z },
        { y: 0.495, rx: 0.082, rz: 0.086, xOffset: calf.x, zOffset: calf.z + 0.006 },
        { y: 0.680, rx: 0.094, rz: 0.096, xOffset: thigh.x, zOffset: thigh.z + 0.004 },
        { y: 0.875, rx: 0.104, rz: 0.106, xOffset: thigh.x, zOffset: thigh.z - 0.002 },
      ],
      legRad,
      true,
      true
    );
    // Lower-leg mud/dust gradient up to y=0.58m -> drives Cordura roughness -> 0.94
    bakeVertexColorAndDirt(trouserLeg, 0xe4ebdd, {
      dirtMaxY: 0.58,
      dirtStrength: 0.45,
      aoStrength: 0.18,
    });
    skinSmoothToBones(
      trouserLeg,
      rig,
      ['pelvis', `thigh_${s}`, `thigh_twist_01_${s}`, `calf_${s}`, `calf_twist_01_${s}`],
      3.8
    );
    corduraParts.push(trouserLeg);

    // Side cargo pocket on left thigh (right thigh carries the drop-leg Kydex holster!)
    if (side === 1) {
      const cargoPocket = createRoundedBox(0.036, 0.155, 0.118, 0.008, 2);
      cargoPocket.translate(thigh.x + 0.098, thigh.y - 0.165, thigh.z + 0.004);
      bakeVertexColorAndDirt(cargoPocket, 0xd6ded0, { aoStrength: 0.18 });
      skinRigidToBone(cargoPocket, 'thigh_l');
      corduraParts.push(cargoPocket);
    } else {
      // Twin drop-leg tactical thigh straps around thigh_r securing the Kydex holster
      for (const dy of [-0.115, -0.215]) {
        const strap = createLoftedTube(
          [
            { y: thigh.y + dy - 0.016, rx: 0.104, rz: 0.104, xOffset: thigh.x, zOffset: thigh.z + 0.003 },
            { y: thigh.y + dy + 0.016, rx: 0.104, rz: 0.104, xOffset: thigh.x, zOffset: thigh.z + 0.003 },
          ],
          legRad,
          false,
          false
        );
        bakeVertexColorAndDirt(strap, 0xb8bec4, { aoStrength: 0.18 });
        skinRigidToBone(strap, 'thigh_r');
        leatherParts.push(strap);
      }
    }

    // Articulated tactical hard-shell knee pads + retention straps
    const kneePad = createRoundedBox(0.118, 0.128, 0.044, 0.016, 2);
    kneePad.translate(calf.x, calf.y + 0.008, calf.z + 0.088);
    bakeVertexColorAndDirt(kneePad, 0xc2c8ce, { dirtMaxY: 0.56, dirtStrength: 0.35, aoStrength: 0.18 });
    skinSmoothToBones(kneePad, rig, [`thigh_twist_01_${s}`, `calf_${s}`], 4.8);
    leatherParts.push(kneePad);

    const kneeStrap = createLoftedTube(
      [
        { y: calf.y - 0.025, rx: 0.086, rz: 0.088, xOffset: calf.x, zOffset: calf.z + 0.004 },
        { y: calf.y + 0.018, rx: 0.086, rz: 0.088, xOffset: calf.x, zOffset: calf.z + 0.004 },
      ],
      legRad,
      false,
      false
    );
    bakeVertexColorAndDirt(kneeStrap, 0xc4cacf, { dirtMaxY: 0.56, dirtStrength: 0.30, aoStrength: 0.18 });
    skinSmoothToBones(kneeStrap, rig, [`calf_${s}`], 5.0);
    leatherParts.push(kneeStrap);

    // 6. Combat Boots (Ankle Shaft, Vamp, Toe Cap, Lugged Outsole & Metal Lace Eyelets)
    const bootShaft = createLoftedTube(
      [
        { y: 0.075, rx: 0.056, rz: 0.074, xOffset: foot.x, zOffset: foot.z + 0.014 },
        { y: 0.145, rx: 0.058, rz: 0.068, xOffset: foot.x, zOffset: foot.z + 0.006 },
        { y: 0.225, rx: 0.066, rz: 0.072, xOffset: foot.x, zOffset: foot.z + 0.004 },
      ],
      Math.max(10, Math.round(18 * lodFactor)),
      true,
      true
    );
    bakeVertexColorAndDirt(bootShaft, 0xc6ccd2, { dirtMaxY: 0.28, dirtStrength: 0.45, aoStrength: 0.18 });
    skinSmoothToBones(bootShaft, rig, [`calf_twist_01_${s}`, `foot_${s}`], 4.5);
    leatherParts.push(bootShaft);

    const bootVamp = createRoundedBox(0.104, 0.072, 0.228, 0.028, 2);
    bootVamp.translate(foot.x, 0.052, foot.z + 0.074);
    bakeVertexColorAndDirt(bootVamp, 0xc0c6cc, { dirtMaxY: 0.16, dirtStrength: 0.50, aoStrength: 0.18 });
    skinSmoothToBones(bootVamp, rig, [`foot_${s}`, `ball_${s}`], 4.6);
    leatherParts.push(bootVamp);

    const outsole = createRoundedBox(0.112, 0.026, 0.244, 0.008, 1);
    outsole.translate(foot.x, 0.013, foot.z + 0.074);
    bakeVertexColorAndDirt(outsole, 0xa8aeb4, { dirtMaxY: 0.08, dirtStrength: 0.60, aoStrength: 0.22 });
    skinSmoothToBones(outsole, rig, [`foot_${s}`, `ball_${s}`], 4.6);
    leatherParts.push(outsole);

    // Metal lace eyelets along boot tongue
    if (lodFactor >= 0.65) {
      for (let e = 0; e < 4; e++) {
        for (const es of [-1, 1] as const) {
          const eyelet = new THREE.CylinderGeometry(0.004, 0.004, 0.006, 6);
          eyelet.rotateX(Math.PI * 0.5);
          eyelet.translate(foot.x + es * 0.022, 0.095 + e * 0.028, foot.z + 0.078 - e * 0.005);
          bakeVertexColorAndDirt(eyelet, 0xe4eaf0, { aoStrength: 0.12 });
          skinRigidToBone(eyelet, `foot_${s}`);
          metalParts.push(eyelet);
        }
      }
    }
  }

  // 7. Drop-leg Kydex Holster on thigh_r
  const holster = createDropLegKydexHolster(rig);
  leatherParts.push(...holster.leatherParts);
  metalParts.push(...holster.metalParts);

  // 8. Articulated Fingerless Tactical Gloves + Fingers
  const hands = createArticulatedHands(rig, lodFactor);
  skinParts.push(...hands.skinParts);
  leatherParts.push(...hands.gloveParts);

  // Merge by consolidated material slot (keeps draw calls & material count minimal!)
  const makeSkinned = (
    name: string,
    parts: THREE.BufferGeometry[],
    material: THREE.Material
  ): THREE.SkinnedMesh => {
    const merged = mergeNormalizedGeometries(parts);
    for (const p of parts) p.dispose();
    normalizeSkinWeightsOnGeometry(merged);
    const mesh = new THREE.SkinnedMesh(merged, material);
    mesh.name = name;
    mesh.bind(rig.skeleton);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  };

  const meshes: THREE.SkinnedMesh[] = [
    makeSkinned('SK_Forearms_Hands_Skin', skinParts, materials.skin),
    makeSkinned('SK_Tactical_Cordura_Garments', corduraParts, materials.tacticalCordura),
    makeSkinned('SK_Tactical_Leather_Armor_Holster', leatherParts, materials.leatherRubber),
    makeSkinned('SK_Tactical_Hardware_Metal', metalParts, materials.hardwareMetal),
  ];

  return { meshes };
}
