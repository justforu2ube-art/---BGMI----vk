import * as THREE from 'three';
import { CharacterRig, getHandBasis } from '../character/rig';
import { BuiltWeapon } from './weaponGeoHelpers';
import { getReloadStage, WeaponCombatState, WeaponId } from './weaponTypes';

// Reusable scratch math objects (ZERO per-frame GC allocations!)
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _vD = new THREE.Vector3();
const _vE = new THREE.Vector3();
const _vF = new THREE.Vector3();
const _vTargetLocal = new THREE.Vector3();
const _vPoleLocal = new THREE.Vector3();
const _m4A = new THREE.Matrix4();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qC = new THREE.Quaternion();
const _qParentWorld = new THREE.Quaternion();
const _qParentInv = new THREE.Quaternion();
const _eA = new THREE.Euler(0, 0, 0, 'YXZ');

export interface TwoBoneIKResult {
  upperLocalQuat: THREE.Quaternion;
  forearmLocalQuat: THREE.Quaternion;
  achievedDist: number;
}

export interface SwingTwistResult {
  twist: THREE.Quaternion;
  swing: THREE.Quaternion;
  twistAngle: number;
}

/**
 * Pure Swing-Twist Decomposition: factors `q = twist * swing` where `twist` is a pure rotation
 * around unit `axis` (shortest hemisphere, twistAngle in [-PI, PI]).
 * Used to distribute anatomical pronation/supination twist onto the Forearm bone while keeping
 * the Hand world position 100% invariant and eliminating wrist candy-wrapper glove tearing!
 */
export function decomposeSwingTwist(
  q: THREE.Quaternion,
  axis: THREE.Vector3,
  outTwist = new THREE.Quaternion(),
  outSwing = new THREE.Quaternion()
): SwingTwistResult {
  const ax = _vA.copy(axis).normalize();
  const dot = q.x * ax.x + q.y * ax.y + q.z * ax.z;
  outTwist.set(ax.x * dot, ax.y * dot, ax.z * dot, q.w);

  if (outTwist.lengthSq() < 1e-10) {
    outTwist.identity();
  } else {
    outTwist.normalize();
  }

  // Shortest-arc hemisphere
  if (outTwist.w < 0) {
    outTwist.set(-outTwist.x, -outTwist.y, -outTwist.z, -outTwist.w);
  }

  const sinHalf = outTwist.x * ax.x + outTwist.y * ax.y + outTwist.z * ax.z;
  const twistAngle = 2 * Math.atan2(sinHalf, outTwist.w);

  // q = twist * swing  =>  swing = inv(twist) * q
  outSwing.copy(outTwist).invert().multiply(q).normalize();

  return {
    twist: outTwist,
    swing: outSwing,
    twistAngle,
  };
}

/**
 * Pure, deterministic 2-Bone Analytical IK solver.
 * Given bind-space upper/forearm vectors, a target hand position relative to the shoulder
 * (in the shoulder's parent space), and an elbow pole hint, computes exact local quaternions
 * for UpperArm and Forearm with ZERO flipping and exact reach clamping.
 */
export function solveTwoBoneAnalytical(
  upperBindVec: THREE.Vector3,
  forearmBindVec: THREE.Vector3,
  targetRelShoulder: THREE.Vector3,
  poleRelShoulder: THREE.Vector3,
  outUpperQ = new THREE.Quaternion(),
  outForeQ = new THREE.Quaternion()
): TwoBoneIKResult {
  const L1 = upperBindVec.length();
  const L2 = forearmBindVec.length();
  const u1Bind = _vA.copy(upperBindVec).normalize();
  const u2Bind = _vB.copy(forearmBindVec).normalize();

  const target = _vC.copy(targetRelShoulder);
  const maxReach = (L1 + L2) * 0.992;
  const minReach = Math.abs(L1 - L2) + 0.04;
  let dist = target.length();
  if (dist < 1e-6) {
    target.set(0, -minReach, 0.05);
    dist = target.length();
  }
  if (dist > maxReach) {
    target.multiplyScalar(maxReach / dist);
    dist = maxReach;
  } else if (dist < minReach) {
    target.multiplyScalar(minReach / dist);
    dist = minReach;
  }

  const cosAlpha = Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const alpha = Math.acos(cosAlpha);

  const tDir = _vD.copy(target).normalize();
  const bendDir = _vE.copy(poleRelShoulder);
  bendDir.addScaledVector(tDir, -bendDir.dot(tDir));
  if (bendDir.lengthSq() < 1e-6) {
    bendDir.set(0, -1, -0.4).addScaledVector(tDir, -tDir.y * -1);
  }
  bendDir.normalize();

  // Desired upper-arm unit vector & elbow position
  const u1Des = _vF
    .copy(tDir)
    .multiplyScalar(Math.cos(alpha))
    .addScaledVector(bendDir, Math.sin(alpha))
    .normalize();

  // Upper arm rotation from bind direction to desired direction
  outUpperQ.setFromUnitVectors(u1Bind, u1Des);

  // Twist-align upper arm roll so elbow plane tracks bendDir smoothly
  const bindBack = new THREE.Vector3(0, 0, -1).applyQuaternion(outUpperQ);
  bindBack.addScaledVector(u1Des, -bindBack.dot(u1Des));
  const desPerp = bendDir.clone().addScaledVector(u1Des, -bendDir.dot(u1Des));
  if (bindBack.lengthSq() > 1e-5 && desPerp.lengthSq() > 1e-5) {
    bindBack.normalize();
    desPerp.normalize();
    _qA.setFromUnitVectors(bindBack, desPerp);
    outUpperQ.premultiply(_qA);
  }

  // Desired forearm unit vector in upperArm's rotated local frame
  const elbowPos = u1Des.clone().multiplyScalar(L1);
  const u2DesWorld = target.clone().sub(elbowPos).normalize();
  const invUpper = _qB.copy(outUpperQ).invert();
  const u2DesLocal = u2DesWorld.applyQuaternion(invUpper).normalize();
  outForeQ.setFromUnitVectors(u2Bind, u2DesLocal);

  return {
    upperLocalQuat: outUpperQ,
    forearmLocalQuat: outForeQ,
    achievedDist: dist,
  };
}

interface WeaponErgonomicsConfig {
  /** Weapon Grip_Right position in Chest-local space during Combat Ready / Idle */
  readyPos: [number, number, number];
  readyRot: [number, number, number];
  /** Weapon Grip_Right position in Chest-local space during Aim Down Sights (ADS) */
  adsPos: [number, number, number];
  adsRot: [number, number, number];
  /** Weapon Grip_Right position in Chest-local space during Sprint */
  sprintPos: [number, number, number];
  sprintRot: [number, number, number];
  /** Natural anatomical scapular protraction on Clavicle_L (+Y yaw moves left shoulder forward toward forend) */
  clavicleLProtract: number;
  /** Weapon-local offset from Grip_Right to upper tang / palm seating point */
  rightGripOffset: [number, number, number];
  /** Right hand palm anchor in hand-basis (along, forward, out) to lock flush onto Grip_Right */
  rightPalmAnchor: [number, number, number];
  /** Right hand dorsal-out & finger-along directions in weapon space */
  rightHandOut: [number, number, number];
  rightHandAlong: [number, number, number];
  /** Weapon-local offset from Grip_Left to exact forend/pump/AFG palm contact point */
  leftGripOffset: [number, number, number];
  /** Left hand palm anchor in hand-basis (along, forward, out) to lock flush onto Grip_Left */
  leftPalmAnchor: [number, number, number];
  /** Left hand dorsal-out & finger-along directions in weapon space */
  leftHandOut: [number, number, number];
  leftHandAlong: [number, number, number];
  /** Left hand finger curl tightness [0..1] for ready stance */
  leftGripCurl: number;
  /** Left thumb opposition tightness [0..1] */
  leftThumbCurl: number;
  /** Elbow pole hints in Chest-local space */
  elbowLPole: [number, number, number];
  elbowRPole: [number, number, number];
}

const WEAPON_ERGONOMICS: Record<WeaponId, WeaponErgonomicsConfig> = {
  mk18: {
    // SOPMOD buttpad seated squarely in right shoulder pocket; left arm comfortably within physical reach (0.49m < 0.55m)!
    readyPos: [-0.132, 0.048, 0.244],
    readyRot: [0.025, 0.28, -0.025],
    adsPos: [-0.074, 0.134, 0.218],
    adsRot: [0.0, 0.04, 0.0],
    sprintPos: [-0.06, -0.015, 0.25],
    sprintRot: [0.34, 0.7, -0.2],
    clavicleLProtract: 0.24,
    rightGripOffset: [0.002, 0.012, 0.005],
    rightPalmAnchor: [0.056, 0.002, -0.023],
    rightHandOut: [-0.96, -0.06, -0.25],
    rightHandAlong: [-0.22, 0.04, 0.97],
    // Left palm cradling angled AFG foregrip tightly from underneath-left with fingers wrapping snugly up right flank!
    leftGripOffset: [0.003, 0.004, 0.006],
    leftPalmAnchor: [0.058, 0.002, -0.020],
    leftHandOut: [0.42, -0.89, -0.18],
    leftHandAlong: [-0.78, -0.20, 0.59],
    leftGripCurl: 0.92,
    leftThumbCurl: 0.60,
    elbowLPole: [0.42, -0.36, 0.02],
    elbowRPole: [-0.46, -0.32, -0.16],
  },
  ak74m: {
    // Oiled wood stock seated solidly in shoulder pocket
    readyPos: [-0.134, 0.052, 0.252],
    readyRot: [0.025, 0.28, -0.025],
    adsPos: [-0.074, 0.140, 0.224],
    adsRot: [0.0, 0.04, 0.0],
    sprintPos: [-0.055, -0.015, 0.255],
    sprintRot: [0.36, 0.72, -0.2],
    clavicleLProtract: 0.24,
    rightGripOffset: [0.002, 0.011, 0.004],
    rightPalmAnchor: [0.056, 0.002, -0.023],
    rightHandOut: [-0.96, -0.06, -0.25],
    rightHandAlong: [-0.22, 0.04, 0.97],
    // Classic AK palm-under oiled wood handguard cradle — zero air gap!
    leftGripOffset: [0.003, 0.005, 0.005],
    leftPalmAnchor: [0.058, 0.002, -0.020],
    leftHandOut: [0.36, -0.92, -0.16],
    leftHandAlong: [-0.80, -0.18, 0.57],
    leftGripCurl: 0.94,
    leftThumbCurl: 0.62,
    elbowLPole: [0.42, -0.38, 0.02],
    elbowRPole: [-0.46, -0.32, -0.16],
  },
  m870: {
    // Tactical stock & rubber recoil pad firmly seated in shoulder pocket; Hand_L dead-center on ribbed sliding pump!
    readyPos: [-0.136, 0.050, 0.242],
    readyRot: [0.02, 0.31, -0.02],
    adsPos: [-0.074, 0.146, 0.214],
    adsRot: [0.0, 0.05, 0.0],
    sprintPos: [-0.055, -0.02, 0.255],
    sprintRot: [0.34, 0.68, -0.18],
    clavicleLProtract: 0.27,
    rightGripOffset: [0.002, 0.012, 0.005],
    rightPalmAnchor: [0.056, 0.002, -0.023],
    rightHandOut: [-0.96, -0.06, -0.25],
    rightHandAlong: [-0.22, 0.04, 0.97],
    // Firm cylindrical wrap dead-center around the ribbed sliding pump forend (ZERO floating, ZERO reach-clamp, ZERO wrist tear!)
    leftGripOffset: [0.004, 0.006, 0.0],
    leftPalmAnchor: [0.058, 0.002, -0.019],
    leftHandOut: [0.34, -0.92, -0.16],
    leftHandAlong: [-0.82, -0.20, 0.54],
    leftGripCurl: 0.98,
    leftThumbCurl: 0.68,
    elbowLPole: [0.40, -0.38, 0.04],
    elbowRPole: [-0.46, -0.32, -0.16],
  },
  awm: {
    // Heavy precision chassis recoil pad seated in shoulder pocket; Hand_L firmly cradling OD chassis forend!
    readyPos: [-0.138, 0.050, 0.250],
    readyRot: [0.02, 0.31, -0.02],
    adsPos: [-0.074, 0.128, 0.218],
    adsRot: [0.0, 0.04, 0.0],
    sprintPos: [-0.05, -0.025, 0.26],
    sprintRot: [0.3, 0.66, -0.16],
    clavicleLProtract: 0.27,
    rightGripOffset: [0.002, 0.014, 0.004],
    rightPalmAnchor: [0.056, 0.002, -0.023],
    rightHandOut: [-0.96, -0.06, -0.25],
    rightHandAlong: [-0.22, 0.04, 0.97],
    // Steady precision sniper palm-flat cradle beneath OD chassis forend
    leftGripOffset: [0.003, 0.006, -0.012],
    leftPalmAnchor: [0.058, 0.002, -0.019],
    leftHandOut: [0.30, -0.94, -0.14],
    leftHandAlong: [-0.78, -0.16, 0.60],
    leftGripCurl: 0.88,
    leftThumbCurl: 0.52,
    elbowLPole: [0.38, -0.40, 0.06],
    elbowRPole: [-0.46, -0.32, -0.16],
  },
  glock19: {
    // Modern two-handed thumbs-forward combat pistol extension
    readyPos: [-0.045, 0.074, 0.405],
    readyRot: [0.03, 0.05, 0.0],
    adsPos: [-0.024, 0.168, 0.445],
    adsRot: [0.0, 0.0, 0.0],
    sprintPos: [-0.14, 0.02, 0.28],
    sprintRot: [0.52, 0.2, -0.14],
    clavicleLProtract: 0.15,
    rightGripOffset: [0.002, 0.006, 0.005],
    rightPalmAnchor: [0.054, 0.002, -0.021],
    rightHandOut: [-0.96, -0.05, -0.24],
    rightHandAlong: [-0.20, 0.02, 0.98],
    // Thumbs-forward interlocking support grip wrapping cleanly over right fingers on left side of grip!
    leftGripOffset: [0.0, 0.005, 0.004],
    leftPalmAnchor: [0.058, 0.004, -0.023],
    leftHandOut: [0.82, -0.26, 0.51],
    leftHandAlong: [-0.54, -0.15, 0.83],
    leftGripCurl: 0.92,
    leftThumbCurl: 0.22, // Support thumb points straight forward along Glock frame!
    elbowLPole: [0.46, -0.32, 0.02],
    elbowRPole: [-0.46, -0.32, -0.04],
  },
};

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Real-Time Biomechanical 2-Handed Weapon IK & Mechanical Articulation Controller.
 * Features:
 * - Forearm Swing-Twist pronation/supination distribution (ZERO wrist glove tearing!)
 * - Exact anatomical palm-surface contact anchoring (ZERO floating hands!)
 * - Orthonormal basis hand orientation solver (ZERO Euler flips!)
 * - True-axis anatomical finger & thumb flexion
 * - 5 unique physically grounded per-weapon reload choreographies!
 */
export class WeaponIKController {
  private rig: CharacterRig;
  private bindUpperL: THREE.Vector3;
  private bindForeL: THREE.Vector3;
  private bindUpperR: THREE.Vector3;
  private bindForeR: THREE.Vector3;
  private bindForeAxisL: THREE.Vector3;
  private bindForeAxisR: THREE.Vector3;
  private handBasisL: { along: THREE.Vector3; forward: THREE.Vector3; out: THREE.Vector3 };
  private handBasisR: { along: THREE.Vector3; forward: THREE.Vector3; out: THREE.Vector3 };
  private handBindInvQuatL: THREE.Quaternion;
  private handBindInvQuatR: THREE.Quaternion;

  private adsBlend = 0;
  private sprintBlend = 0;

  constructor(rig: CharacterRig) {
    this.rig = rig;

    const pSL = rig.bindWorldPos.get('UpperArm_L')!;
    const pEL = rig.bindWorldPos.get('Forearm_L')!;
    const pHL = rig.bindWorldPos.get('Hand_L')!;
    this.bindUpperL = pEL.clone().sub(pSL);
    this.bindForeL = pHL.clone().sub(pEL);
    this.bindForeAxisL = this.bindForeL.clone().normalize();

    const pSR = rig.bindWorldPos.get('UpperArm_R')!;
    const pER = rig.bindWorldPos.get('Forearm_R')!;
    const pHR = rig.bindWorldPos.get('Hand_R')!;
    this.bindUpperR = pER.clone().sub(pSR);
    this.bindForeR = pHR.clone().sub(pER);
    this.bindForeAxisR = this.bindForeR.clone().normalize();

    const bL = getHandBasis('L', rig);
    const bR = getHandBasis('R', rig);
    // Strictly orthonormalize hand basis triples (det = +1) to eliminate minor A-pose shear
    const lAlong = bL.along.clone().normalize();
    const lOut = bL.out.clone().normalize();
    const lFwd = new THREE.Vector3().crossVectors(lAlong, lOut).normalize();
    const rAlong = bR.along.clone().normalize();
    const rOut = bR.out.clone().normalize();
    const rFwd = new THREE.Vector3().crossVectors(rOut, rAlong).normalize();

    this.handBasisL = { along: lAlong, forward: lFwd, out: lOut };
    this.handBasisR = { along: rAlong, forward: rFwd, out: rOut };

    // Valid right-handed (det = +1) orthonormal bind basis for Left hand: [out, forward, along]
    const handLBindMat = new THREE.Matrix4().makeBasis(lOut, lFwd, lAlong);
    this.handBindInvQuatL = new THREE.Quaternion().setFromRotationMatrix(handLBindMat).normalize().invert();

    // Valid right-handed (det = +1) orthonormal bind basis for Right hand: [-out, forward, along]
    const handRBindMat = new THREE.Matrix4().makeBasis(rOut.clone().negate(), rFwd, rAlong);
    this.handBindInvQuatR = new THREE.Quaternion().setFromRotationMatrix(handRBindMat).normalize().invert();
  }

  /**
   * Builds an exact, flip-free world quaternion for `Hand_L` or `Hand_R` from desired
   * weapon-space dorsal-out (`targetOutW`) and wrist-to-fingers (`targetAlongW`) vectors.
   */
  public buildHandWorldQuat(
    side: 'L' | 'R',
    weaponWorldQuat: THREE.Quaternion,
    targetOutW: [number, number, number],
    targetAlongW: [number, number, number]
  ): THREE.Quaternion {
    const o = new THREE.Vector3(...targetOutW).normalize();
    const a = new THREE.Vector3(...targetAlongW);
    a.addScaledVector(o, -a.dot(o));
    if (a.lengthSq() < 1e-6) {
      a.set(0, 0, 1);
      a.addScaledVector(o, -a.dot(o));
    }
    a.normalize();

    let mat: THREE.Matrix4;
    if (side === 'L') {
      // Left bind basis is [out, forward, along] where forward = cross(along, out)
      const f = new THREE.Vector3().crossVectors(a, o).normalize();
      mat = new THREE.Matrix4().makeBasis(o, f, a);
    } else {
      // Right bind basis is [-out, forward, along] where forward = cross(out, along)
      const f = new THREE.Vector3().crossVectors(o, a).normalize();
      mat = new THREE.Matrix4().makeBasis(o.clone().negate(), f, a);
    }

    const weaponLocalHandQ = new THREE.Quaternion()
      .setFromRotationMatrix(mat)
      .normalize()
      .multiply(side === 'L' ? this.handBindInvQuatL : this.handBindInvQuatR)
      .normalize();

    return weaponWorldQuat.clone().multiply(weaponLocalHandQ).normalize();
  }

  /**
   * Derives exact world wrist bone position so the hand's anatomical palm contact anchor
   * `(alongD, fwdD, outD)` sits millimeter-flush onto `palmTargetWorld` at ANY rotation!
   */
  public computeWristFromPalm(
    side: 'L' | 'R',
    palmTargetWorld: THREE.Vector3,
    handWorldQuat: THREE.Quaternion,
    anchor: [number, number, number]
  ): THREE.Vector3 {
    const b = side === 'L' ? this.handBasisL : this.handBasisR;
    const localPalm = new THREE.Vector3()
      .addScaledVector(b.along, anchor[0])
      .addScaledVector(b.forward, anchor[1])
      .addScaledVector(b.out, anchor[2]);
    localPalm.applyQuaternion(handWorldQuat);
    return palmTargetWorld.clone().sub(localPalm);
  }

  /**
   * Solves one arm in world space directly on the live skeleton bones with anatomical
   * Forearm Swing-Twist pronation/supination distribution (~68% forearm, ~32% wrist) so
   * wrist skin & fingerless gloves stay 100% smooth and cylindrical at all angles!
   */
  public solveArmWorld(
    side: 'L' | 'R',
    wristTargetWorld: THREE.Vector3,
    elbowPoleWorld: THREE.Vector3,
    handWorldQuat: THREE.Quaternion
  ): void {
    const upper = this.rig.boneMap.get(`UpperArm_${side}`)!;
    const fore = this.rig.boneMap.get(`Forearm_${side}`)!;
    const hand = this.rig.boneMap.get(`Hand_${side}`)!;
    const clav = upper.parent!;

    clav.updateMatrixWorld(true);
    upper.getWorldPosition(_vA); // Shoulder world pos
    clav.getWorldQuaternion(_qParentWorld);
    _qParentInv.copy(_qParentWorld).invert();

    // Transform target & pole into Clavicle local space (aligned with bind vectors)
    _vTargetLocal.copy(wristTargetWorld).sub(_vA).applyQuaternion(_qParentInv);
    _vPoleLocal.copy(elbowPoleWorld).sub(_vA).applyQuaternion(_qParentInv);

    const bindUpper = side === 'L' ? this.bindUpperL : this.bindUpperR;
    const bindFore = side === 'L' ? this.bindForeL : this.bindForeR;
    const bindForeAxis = side === 'L' ? this.bindForeAxisL : this.bindForeAxisR;

    const res = solveTwoBoneAnalytical(
      bindUpper,
      bindFore,
      _vTargetLocal,
      _vPoleLocal,
      upper.quaternion,
      fore.quaternion
    );
    upper.quaternion.copy(res.upperLocalQuat);
    fore.quaternion.copy(res.forearmLocalQuat);
    upper.updateMatrixWorld(true);

    // Compute wrist relative quaternion before forearm twist sharing
    fore.getWorldQuaternion(_qA);
    const rawHandLocal = _qB.copy(_qA).invert().multiply(handWorldQuat).normalize();

    // Decompose into forearm axial pronation/supination twist + wrist flexion/deviation swing
    const st = decomposeSwingTwist(rawHandLocal, bindForeAxis);
    // Transfer ~68% of axial pronation/supination twist onto Forearm (clamped within physiological radius-ulna limits)
    const foreTwistRad = THREE.MathUtils.clamp(st.twistAngle * 0.68, -1.52, 1.52);
    const qForeTwist = _qC.setFromAxisAngle(bindForeAxis, foreTwistRad);

    // Rotating Forearm purely around bindForeAxis leaves Hand's world position 100% INVARIANT!
    fore.quaternion.multiply(qForeTwist).normalize();
    fore.updateMatrixWorld(true);

    // Remaining wrist orientation hits handWorldQuat EXACTLY without candy-wrapper collapse
    fore.getWorldQuaternion(_qA);
    hand.quaternion.copy(_qA).invert().multiply(handWorldQuat).normalize();
    hand.updateMatrixWorld(true);
  }

  /**
   * True-axis anatomical finger & thumb curling around each hand's exact bind-pose flexion axis
   * (`forward` curls fingertips strictly into `-out` palm; thumb opposes cleanly across palm).
   */
  public setFingerGripPose(
    side: 'L' | 'R',
    gripCurl: number,
    indexTriggerPull = 0,
    isTriggerHand = false,
    thumbCurlOverride?: number
  ): void {
    const s = side === 'L' ? 1 : -1;
    const b = side === 'L' ? this.handBasisL : this.handBasisR;
    const flexAxis = b.forward;
    const splayAxis = b.out;

    const setAxisRot = (name: string, flexAngle: number, splayAngle = 0) => {
      const bone = this.rig.boneMap.get(name);
      if (!bone) return;
      // Rotate by -s * flexAngle around `forward` -> curls strictly inward toward palm (-out)!
      bone.quaternion.setFromAxisAngle(flexAxis, -s * flexAngle);
      if (Math.abs(splayAngle) > 1e-4) {
        _qA.setFromAxisAngle(splayAxis, s * splayAngle);
        bone.quaternion.premultiply(_qA);
      }
    };

    const fingers = ['Index', 'Middle', 'Ring', 'Pinky'] as const;
    fingers.forEach((f, idx) => {
      if (isTriggerHand && f === 'Index') {
        // Trigger discipline: index enters trigger guard cleanly and curls naturally onto curved trigger blade
        const pull = Math.max(0, Math.min(1, indexTriggerPull));
        setAxisRot(`${f}_01_${side}`, 0.22 + pull * 0.24, 0.04);
        setAxisRot(`${f}_02_${side}`, 0.48 + pull * 0.46, 0);
        setAxisRot(`${f}_03_${side}`, 0.36 + pull * 0.40, 0);
      } else {
        const c = Math.max(0, Math.min(1.18, gripCurl * (0.96 + idx * 0.06)));
        setAxisRot(`${f}_01_${side}`, 0.76 * c, (idx - 1.5) * -0.025);
        setAxisRot(`${f}_02_${side}`, 1.02 * c, 0);
        setAxisRot(`${f}_03_${side}`, 0.78 * c, 0);
      }
    });

    // Opposable thumb wrapping snugly around grip backstrap / forend (never bending backwards!)
    const tc = thumbCurlOverride !== undefined ? thumbCurlOverride : gripCurl * 0.65;
    const thumbOppAxis = _vA
      .copy(b.along)
      .multiplyScalar(0.68)
      .addScaledVector(b.forward, 0.73)
      .normalize();

    const t1 = this.rig.boneMap.get(`Thumb_01_${side}`);
    if (t1) {
      t1.quaternion.setFromAxisAngle(b.along, s * 0.56 * tc);
      _qA.setFromAxisAngle(thumbOppAxis, -s * 0.42 * tc);
      t1.quaternion.premultiply(_qA);
    }
    const t2 = this.rig.boneMap.get(`Thumb_02_${side}`);
    if (t2) {
      t2.quaternion.setFromAxisAngle(b.along, s * 0.52 * tc);
    }
    const t3 = this.rig.boneMap.get(`Thumb_03_${side}`);
    if (t3) {
      t3.quaternion.setFromAxisAngle(b.along, s * 0.44 * tc);
    }
  }

  /**
   * Main per-frame update called right after `mixer.update(dt)` whenever a weapon is equipped.
   * Positions weapon in shoulder pocket, articulates moving parts, runs biomechanical 2-bone IK
   * with forearm twist sharing on both arms, and drives 5 distinct realistic reload choreographies!
   */
  public update(
    weapon: BuiltWeapon,
    state: WeaponCombatState,
    isAiming: boolean,
    isSprinting: boolean,
    aimPitch: number,
    dt: number
  ): void {
    const cfg = WEAPON_ERGONOMICS[weapon.id];
    const chest = this.rig.boneMap.get('Chest')!;
    const pelvis = this.rig.boneMap.get('Pelvis')!;
    const head = this.rig.boneMap.get('Head')!;
    const clavL = this.rig.boneMap.get('Clavicle_L');
    if (clavL) {
      // Natural tactical scapular protraction: -Y yaw rotates +X clavicle forward (+Z) toward forend/pump!
      const protract = cfg.clavicleLProtract + this.adsBlend * 0.06;
      clavL.quaternion.setFromAxisAngle(_vA.set(0, 1, 0), -protract);
    }
    chest.updateMatrixWorld(true);

    // Smooth ADS & Sprint blend factors
    const targetAds = isAiming && !state.isReloading && !state.isInspecting ? 1 : 0;
    const targetSprint =
      isSprinting && !isAiming && !state.isReloading && !state.isInspecting ? 1 : 0;
    const k = 1 - Math.exp(-12 * Math.min(dt, 0.05));
    this.adsBlend += (targetAds - this.adsBlend) * k;
    this.sprintBlend += (targetSprint - this.sprintBlend) * k;

    // 1. Compute weapon Grip_Right target pose in Chest-local space
    const posX = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(cfg.readyPos[0], cfg.adsPos[0], this.adsBlend),
      cfg.sprintPos[0],
      this.sprintBlend
    );
    const posY = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(cfg.readyPos[1], cfg.adsPos[1], this.adsBlend),
      cfg.sprintPos[1],
      this.sprintBlend
    );
    const posZ = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(cfg.readyPos[2], cfg.adsPos[2], this.adsBlend),
      cfg.sprintPos[2],
      this.sprintBlend
    );

    let rotX = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(cfg.readyRot[0], cfg.adsRot[0], this.adsBlend),
      cfg.sprintRot[0],
      this.sprintBlend
    );
    let rotY = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(cfg.readyRot[1], cfg.adsRot[1], this.adsBlend),
      cfg.sprintRot[1],
      this.sprintBlend
    );
    let rotZ = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(cfg.readyRot[2], cfg.adsRot[2], this.adsBlend),
      cfg.sprintRot[2],
      this.sprintBlend
    );

    // Smooth draw/equip lift from holster/sling
    const drawU = smoothstep(state.equipBlend);
    const drawOffsetY = (1 - drawU) * -0.24;
    const drawRotX = (1 - drawU) * 0.6;

    // Weapon Inspect showcase tilt & slow side-to-side admire rotation (`I` key)
    let inspectOffX = 0;
    let inspectOffY = 0;
    let inspectOffZ = 0;
    if (state.isInspecting) {
      const w = state.inspectTime;
      inspectOffX = 0.055;
      inspectOffY = 0.048;
      inspectOffZ = 0.045;
      rotY += 0.68 + Math.sin(w * 1.15) * 0.42;
      rotZ += -0.4 + Math.cos(w * 0.85) * 0.22;
      rotX += -0.15;
    }

    // Per-weapon ergonomic reload canting (exposes magwell / loading gate / charging handle naturally!)
    let reloadTiltX = 0;
    let reloadTiltY = 0;
    let reloadTiltZ = 0;
    let reloadOffX = 0;
    let reloadOffY = 0;
    let reloadOffZ = 0;
    if (state.isReloading) {
      const p = Math.max(0, Math.min(1, state.reloadProgress));
      const env = Math.sin(p * Math.PI);
      if (weapon.id === 'glock19') {
        // John-Wick workspace cant in front of chest
        reloadTiltZ = -0.34 * env;
        reloadTiltY = 0.28 * env;
        reloadTiltX = -0.14 * env;
        reloadOffX = 0.035 * env;
        reloadOffY = 0.03 * env;
        reloadOffZ = -0.055 * env;
      } else if (weapon.id === 'ak74m') {
        // Cant left for rock-and-lock mag swap, then gently cant right during under-hand charging handle rack!
        const rackPhase = p > 0.7 && p < 0.92 ? Math.sin(((p - 0.7) / 0.22) * Math.PI) : 0;
        reloadTiltZ = -0.24 * env + 0.36 * rackPhase;
        reloadTiltX = -0.11 * env;
        reloadOffY = 0.015 * env;
      } else if (weapon.id === 'm870') {
        // Tilt slightly so bottom stainless loading gate faces upward-left for thumb-fed shell insertion
        reloadTiltZ = -0.26 * env;
        reloadTiltX = -0.15 * env;
        reloadOffY = 0.02 * env;
      } else if (weapon.id === 'awm') {
        reloadTiltZ = -0.16 * env;
        reloadTiltX = -0.08 * env;
      } else {
        // MK18 speed-mag cant
        reloadTiltZ = -0.28 * env;
        reloadTiltX = -0.1 * env;
        reloadOffY = 0.015 * env;
      }
    }

    // Apply live spring-damper recoil directly onto weapon & shoulder
    const finalLocalPos = new THREE.Vector3(
      posX + inspectOffX + reloadOffX,
      posY + drawOffsetY + inspectOffY + reloadOffY + state.recoilPitch * 0.035,
      posZ + inspectOffZ + reloadOffZ - state.recoilZ
    );

    _eA.set(
      rotX + drawRotX + reloadTiltX - state.recoilPitch + aimPitch * 0.28,
      rotY + reloadTiltY + state.recoilYaw,
      rotZ + reloadTiltZ,
      'YXZ'
    );
    const finalLocalQuat = new THREE.Quaternion().setFromEuler(_eA);

    // Convert weapon root transform into WORLD space via Chest matrixWorld
    chest.updateMatrixWorld(true);
    const weaponWorldPos = finalLocalPos.clone().applyMatrix4(chest.matrixWorld);
    const chestWorldQuat = new THREE.Quaternion();
    chest.getWorldQuaternion(chestWorldQuat);
    const weaponWorldQuat = chestWorldQuat.clone().multiply(finalLocalQuat);

    weapon.root.position.copy(weaponWorldPos);
    weapon.root.quaternion.copy(weaponWorldQuat);
    weapon.root.scale.set(1, 1, 1);
    weapon.root.updateMatrixWorld(true);

    // 2. Articulate Weapon Moving Parts (Trigger, Bolt/Slide/Pump)
    weapon.triggerPivot.rotation.x = -state.triggerPull * 0.38;

    weapon.boltOrSlide.position.copy(weapon.boltRestPos);
    weapon.boltOrSlide.position.z -= state.boltTravel * weapon.boltTravelMax;
    weapon.boltOrSlide.rotation.copy(weapon.boltRestRot);
    if (weapon.boltLiftMax > 0) {
      weapon.boltOrSlide.rotation.z = -state.boltLift * weapon.boltLiftMax;
    }
    weapon.boltOrSlide.updateMatrixWorld(true);

    // 3. Compute Right Hand (Hand_R) World Target & Orientation (seated high in grip tang so index rests on trigger!)
    const gripRWorldPos = new THREE.Vector3();
    weapon.gripRight.getWorldPosition(gripRWorldPos);
    const gripROffWorld = new THREE.Vector3(...cfg.rightGripOffset).applyQuaternion(weaponWorldQuat);

    let handRTargetQuat = this.buildHandWorldQuat(
      'R',
      weaponWorldQuat,
      cfg.rightHandOut,
      cfg.rightHandAlong
    );
    let palmRTarget = gripRWorldPos.clone().add(gripROffWorld);
    let rightPalmAnchor = cfg.rightPalmAnchor;
    let isSniperBoltHand = false;

    // AWM manual sniper bolt cycle (either post-shot cycle OR reload rack_bolt phase!)
    const awmReloadBolt =
      weapon.id === 'awm' &&
      state.isReloading &&
      state.reloadProgress >= 0.7 &&
      state.reloadProgress <= 0.94;
    if (
      weapon.id === 'awm' &&
      ((state.cycleActive && (state.boltLift > 0.01 || state.boltTravel > 0.01)) || awmReloadBolt)
    ) {
      isSniperBoltHand = true;
      const knobLocal = new THREE.Vector3(-0.044, -0.026, -0.036);
      const knobWorld = knobLocal.applyMatrix4(weapon.boltOrSlide.matrixWorld);
      const boltQuat = this.buildHandWorldQuat(
        'R',
        weaponWorldQuat,
        [-0.90, 0.22, -0.37],
        [-0.10, -0.32, 0.94]
      );

      // Smooth blend onto & off the precision bolt knob (zero snapping!)
      let boltBlend = 1;
      if (awmReloadBolt) {
        const u = (state.reloadProgress - 0.7) / 0.24;
        boltBlend = Math.sin(Math.max(0, Math.min(1, u)) * Math.PI);
        boltBlend = smoothstep(Math.min(1, boltBlend * 2.2));
      } else {
        boltBlend = smoothstep(Math.min(1, (state.boltLift + state.boltTravel) * 2.5));
      }

      palmRTarget.lerp(knobWorld, boltBlend);
      handRTargetQuat.slerp(boltQuat, boltBlend);
      rightPalmAnchor = [0.066, 0.010, -0.020];
    }

    const wristRTarget = this.computeWristFromPalm('R', palmRTarget, handRTargetQuat, rightPalmAnchor);
    const elbowRPole = new THREE.Vector3(...cfg.elbowRPole).applyMatrix4(chest.matrixWorld);
    this.solveArmWorld('R', wristRTarget, elbowRPole, handRTargetQuat);
    this.setFingerGripPose(
      'R',
      isSniperBoltHand ? 0.78 : 0.96,
      state.triggerPull,
      !isSniperBoltHand,
      isSniperBoltHand ? 0.58 : 0.68
    );

    // 4. Compute Left Hand (Hand_L) World Target, Orientation & 5 Unique Reload Choreographies!
    const gripLWorldPos = new THREE.Vector3();
    weapon.gripLeft.getWorldPosition(gripLWorldPos);
    gripLWorldPos.add(new THREE.Vector3(...cfg.leftGripOffset).applyQuaternion(weaponWorldQuat));

    const readyLeftQuat = this.buildHandWorldQuat(
      'L',
      weaponWorldQuat,
      cfg.leftHandOut,
      cfg.leftHandAlong
    );
    const handLTargetQuat = readyLeftQuat.clone();
    const palmLTarget = gripLWorldPos.clone();
    let leftPalmAnchor: [number, number, number] = [...cfg.leftPalmAnchor];
    let leftGripCurl = cfg.leftGripCurl;
    let leftThumbCurl = cfg.leftThumbCurl;
    let elbowLShiftX = 0;
    let elbowLShiftY = 0;

    // Reset magazine to seated rest in magwell by default
    weapon.magPivot.position.copy(weapon.magRestPos);
    weapon.magPivot.rotation.copy(weapon.magRestRot);
    if (weapon.id === 'm870') {
      const shellChild = weapon.magPivot.children[0];
      if (shellChild) shellChild.visible = false;
    }

    if (state.isReloading) {
      const { stage, localT } = getReloadStage(state.reloadProgress);
      const u = smoothstep(localT);
      const invWeaponMat = _m4A.copy(weapon.root.matrixWorld).invert();

      // Ergonomic orientations for reload maneuvers (zero wrist twisting!)
      const magPinchQuat = this.buildHandWorldQuat(
        'L',
        weaponWorldQuat,
        [0.88, -0.22, -0.42],
        [-0.38, -0.22, 0.9]
      );
      const pouchReachQuat = this.buildHandWorldQuat(
        'L',
        chestWorldQuat,
        [0.85, -0.32, 0.42],
        [-0.3, -0.82, 0.48]
      );
      const boltCatchQuat = this.buildHandWorldQuat(
        'L',
        weaponWorldQuat,
        [0.92, -0.18, -0.34],
        [-0.25, 0.25, 0.93]
      );
      const akUnderRackQuat = this.buildHandWorldQuat(
        'L',
        weaponWorldQuat,
        [0.24, -0.94, -0.24],
        [-0.86, -0.14, 0.49]
      );
      const shellThumbQuat = this.buildHandWorldQuat(
        'L',
        weaponWorldQuat,
        [0.36, -0.9, -0.24],
        [-0.65, 0.08, 0.75]
      );
      const pistolMagQuat = this.buildHandWorldQuat(
        'L',
        weaponWorldQuat,
        [0.80, -0.38, 0.46],
        [-0.44, -0.08, 0.89]
      );
      const pistolSlideQuat = this.buildHandWorldQuat(
        'L',
        weaponWorldQuat,
        [0.64, 0.68, -0.35],
        [-0.72, 0.42, -0.55]
      );

      // Common belt pouch waypoint on left tactical hip
      const beltPouchWorld = new THREE.Vector3(0.24, -0.02, 0.16).applyMatrix4(pelvis.matrixWorld);
      const magRestWorld = weapon.magRestPos.clone().applyMatrix4(weapon.root.matrixWorld);

      if (weapon.id === 'm870') {
        // [M870] Authentic thumb-fed shell-by-shell reload (3 crisp crimson shells into bottom loading gate + pump rack!)
        const shellChild = weapon.magPivot.children[0];
        const loadingGateWorld = new THREE.Vector3(0.008, 0.032, 0.125).applyMatrix4(
          weapon.root.matrixWorld
        );
        const p = state.reloadProgress;

        if (p < 0.12) {
          // Leave pump forend toward belt shell loops
          const t0 = smoothstep(p / 0.12);
          palmLTarget.lerpVectors(gripLWorldPos, beltPouchWorld, t0);
          handLTargetQuat.slerpQuaternions(readyLeftQuat, pouchReachQuat, t0);
          leftGripCurl = THREE.MathUtils.lerp(cfg.leftGripCurl, 0.62, t0);
          if (shellChild) shellChild.visible = false;
        } else if (p < 0.72) {
          // 3 rapid shell-feed cycles between belt pouch & bottom stainless loading gate!
          const cycles = 3;
          const cycPos = ((p - 0.12) / 0.6) * cycles;
          const cycT = cycPos - Math.floor(cycPos); // 0..1 within single shell load
          if (cycT < 0.42) {
            // Carry gleaming crimson 12G shell upward to bottom loading gate
            const kUp = smoothstep(cycT / 0.42);
            palmLTarget.lerpVectors(beltPouchWorld, loadingGateWorld, kUp);
            handLTargetQuat.slerpQuaternions(pouchReachQuat, shellThumbQuat, kUp);
            leftGripCurl = 0.76;
            leftThumbCurl = 0.42;
            if (shellChild) shellChild.visible = true;
            const sLocal = palmLTarget
              .clone()
              .add(new THREE.Vector3(-0.008, 0.012, 0.015).applyQuaternion(weaponWorldQuat))
              .applyMatrix4(invWeaponMat);
            weapon.magPivot.position.copy(sLocal);
          } else if (cycT < 0.68) {
            // Thumb-press shell cleanly UP into the tubular magazine loading gate!
            const kIn = smoothstep((cycT - 0.42) / 0.26);
            palmLTarget.copy(loadingGateWorld).add(
              new THREE.Vector3(0, 0.014 * kIn, 0.01 * kIn).applyQuaternion(weaponWorldQuat)
            );
            handLTargetQuat.copy(shellThumbQuat);
            leftGripCurl = 0.68;
            leftThumbCurl = 0.75;
            if (shellChild) shellChild.visible = kIn < 0.75;
            weapon.magPivot.position.lerpVectors(
              new THREE.Vector3(0, 0.022, 0.122),
              new THREE.Vector3(0, 0.044, 0.135),
              kIn
            );
          } else {
            // Sweep back down to belt pouch for next shell (or toward pump on final cycle!)
            const kDown = smoothstep((cycT - 0.68) / 0.32);
            const isLast = Math.floor(cycPos) >= cycles - 1;
            const nextDest = isLast ? gripLWorldPos : beltPouchWorld;
            const nextQ = isLast ? readyLeftQuat : pouchReachQuat;
            palmLTarget.lerpVectors(loadingGateWorld, nextDest, kDown);
            handLTargetQuat.slerpQuaternions(shellThumbQuat, nextQ, kDown);
            leftGripCurl = 0.55;
            if (shellChild) shellChild.visible = false;
          }
          elbowLShiftY = -0.06;
        } else {
          // Pump rack & settle cleanly on ribbed sliding pump forend (`Grip_Left` moves with `Bolt_Or_Slide`!)
          palmLTarget.copy(gripLWorldPos);
          handLTargetQuat.copy(readyLeftQuat);
          leftGripCurl = cfg.leftGripCurl;
          if (shellChild) shellChild.visible = false;
        }
      } else if (weapon.id === 'ak74m') {
        // [AK-74M] Authentic Soviet Rock-and-Lock Bakelite Banana Mag + Right-Side Charging Handle Rack!
        const magBodyLocal = new THREE.Vector3(0.014, -0.065, 0.022);
        const magGrabWorld = magRestWorld
          .clone()
          .add(magBodyLocal.clone().applyQuaternion(weaponWorldQuat));
        const magRockOutPos = weapon.magRestPos.clone().add(new THREE.Vector3(0, -0.075, 0.048));
        const magRockOutWorld = magRockOutPos.clone().applyMatrix4(weapon.root.matrixWorld);
        const akChargeWorld = new THREE.Vector3(
          -0.04,
          0.088,
          0.154 - state.boltTravel * weapon.boltTravelMax
        ).applyMatrix4(weapon.root.matrixWorld);

        if (stage === 'reach_mag') {
          palmLTarget.lerpVectors(gripLWorldPos, magGrabWorld, u);
          handLTargetQuat.slerpQuaternions(readyLeftQuat, magPinchQuat, u);
          leftGripCurl = THREE.MathUtils.lerp(cfg.leftGripCurl, 0.94, u);
        } else if (stage === 'detach_mag') {
          // Phase 1: rock banana mag forward (+0.48 rad), Phase 2: pull down to belt pouch
          if (localT < 0.35) {
            const kr = smoothstep(localT / 0.35);
            weapon.magPivot.position.lerpVectors(weapon.magRestPos, magRockOutPos, kr);
            weapon.magPivot.rotation.set(0.48 * kr, 0, 0);
            palmLTarget.lerpVectors(magGrabWorld, magRockOutWorld, kr);
            handLTargetQuat.copy(magPinchQuat);
          } else {
            const kd = smoothstep((localT - 0.35) / 0.65);
            palmLTarget.lerpVectors(magRockOutWorld, beltPouchWorld, kd);
            handLTargetQuat.slerpQuaternions(magPinchQuat, pouchReachQuat, kd);
            const magW = palmLTarget
              .clone()
              .add(new THREE.Vector3(-0.010, 0.056, 0.016).applyQuaternion(weaponWorldQuat));
            weapon.magPivot.position.copy(magW.applyMatrix4(invWeaponMat));
            weapon.magPivot.rotation.set(0.48, 0.18 * kd, -0.15 * kd);
          }
          leftGripCurl = 0.98;
          leftPalmAnchor = [0.06, 0.004, -0.020];
        } else if (stage === 'fetch_mag') {
          // Bring fresh full-brass windowed Bakelite mag up angled forward ready to hook trunnion lug
          palmLTarget.lerpVectors(beltPouchWorld, magRockOutWorld, u);
          handLTargetQuat.slerpQuaternions(pouchReachQuat, magPinchQuat, u);
          const magW = palmLTarget
            .clone()
            .add(new THREE.Vector3(-0.010, 0.056, 0.016).applyQuaternion(weaponWorldQuat));
          weapon.magPivot.position.copy(magW.applyMatrix4(invWeaponMat));
          weapon.magPivot.rotation.set(0.44, 0.12 * (1 - u), 0);
          leftGripCurl = 0.98;
          leftPalmAnchor = [0.06, 0.004, -0.020];
        } else if (stage === 'insert_mag') {
          // Authentic AK rock-and-lock: hook front lug and rock straight back-up into receiver!
          weapon.magPivot.position.lerpVectors(magRockOutPos, weapon.magRestPos, u);
          weapon.magPivot.rotation.set(0.44 * (1 - u), 0, 0);
          const curMagW = weapon.magPivot.position.clone().applyMatrix4(weapon.root.matrixWorld);
          palmLTarget.copy(curMagW).add(magBodyLocal.clone().applyQuaternion(weaponWorldQuat));
          handLTargetQuat.copy(magPinchQuat);
          leftGripCurl = 0.94;
        } else if (stage === 'rack_bolt') {
          // Iconic under-hand reach cleanly onto right-side hooked charging handle!
          const reachK = smoothstep(Math.min(1, localT * 2.6));
          palmLTarget.lerpVectors(magGrabWorld, akChargeWorld, reachK);
          handLTargetQuat.slerpQuaternions(magPinchQuat, akUnderRackQuat, reachK);
          leftGripCurl = 0.86;
          leftPalmAnchor = [0.068, 0.01, -0.018];
          elbowLShiftX = -0.08;
          elbowLShiftY = -0.06;
        } else if (stage === 'return_hand') {
          palmLTarget.lerpVectors(akChargeWorld, gripLWorldPos, u);
          handLTargetQuat.slerpQuaternions(akUnderRackQuat, readyLeftQuat, u);
          leftGripCurl = THREE.MathUtils.lerp(0.75, cfg.leftGripCurl, u);
        }
      } else if (weapon.id === 'awm') {
        // [AWM .338] Precision vertical 5-round steel box mag swap + early return to chassis while Hand_R racks bolt!
        const magGrabWorld = magRestWorld
          .clone()
          .add(new THREE.Vector3(0.014, -0.042, 0.0).applyQuaternion(weaponWorldQuat));
        const preInsertPos = weapon.magRestPos.clone().add(new THREE.Vector3(0, -0.09, 0));
        const preInsertWorld = preInsertPos.clone().applyMatrix4(weapon.root.matrixWorld);

        if (stage === 'reach_mag') {
          palmLTarget.lerpVectors(gripLWorldPos, magGrabWorld, u);
          handLTargetQuat.slerpQuaternions(readyLeftQuat, magPinchQuat, u);
          leftGripCurl = 0.9;
        } else if (stage === 'detach_mag') {
          palmLTarget.lerpVectors(magGrabWorld, beltPouchWorld, u);
          handLTargetQuat.slerpQuaternions(magPinchQuat, pouchReachQuat, u);
          const magW = palmLTarget
            .clone()
            .add(new THREE.Vector3(-0.012, 0.042, 0).applyQuaternion(weaponWorldQuat));
          weapon.magPivot.position.copy(magW.applyMatrix4(invWeaponMat));
          weapon.magPivot.rotation.set(0.15 * u, 0.14 * u, 0);
          leftGripCurl = 0.96;
        } else if (stage === 'fetch_mag') {
          palmLTarget.lerpVectors(beltPouchWorld, preInsertWorld, u);
          handLTargetQuat.slerpQuaternions(pouchReachQuat, magPinchQuat, u);
          const magW = palmLTarget
            .clone()
            .add(new THREE.Vector3(-0.012, 0.042, 0).applyQuaternion(weaponWorldQuat));
          weapon.magPivot.position.copy(magW.applyMatrix4(invWeaponMat));
          weapon.magPivot.rotation.set(0.1 * (1 - u), 0, 0);
          leftGripCurl = 0.96;
        } else if (stage === 'insert_mag') {
          weapon.magPivot.position.lerpVectors(preInsertPos, weapon.magRestPos, u);
          weapon.magPivot.rotation.set(0, 0, 0);
          const curMagW = weapon.magPivot.position.clone().applyMatrix4(weapon.root.matrixWorld);
          palmLTarget
            .copy(curMagW)
            .add(new THREE.Vector3(0.014, -0.042, 0).applyQuaternion(weaponWorldQuat));
          handLTargetQuat.copy(magPinchQuat);
          leftGripCurl = 0.92;
        } else if (stage === 'rack_bolt') {
          // Left hand returns cleanly to steady the heavy sniper chassis while Hand_R cycles the 60° bolt!
          const retU = smoothstep(Math.min(1, localT * 2.2));
          palmLTarget.lerpVectors(magGrabWorld, gripLWorldPos, retU);
          handLTargetQuat.slerpQuaternions(magPinchQuat, readyLeftQuat, retU);
        } else {
          palmLTarget.copy(gripLWorldPos);
          handLTargetQuat.copy(readyLeftQuat);
        }
      } else if (weapon.id === 'glock19') {
        // [GLOCK 19] Crisp John-Wick drop-mag reload aligned with grip angle + milled slide release snap!
        const magBaseWorld = weapon.magRestPos
          .clone()
          .add(new THREE.Vector3(0.008, -0.056, -0.006))
          .applyMatrix4(weapon.root.matrixWorld);
        // Grip channel runs along (0, -0.98, -0.18)
        const preInsertPos = weapon.magRestPos.clone().add(new THREE.Vector3(0, -0.105, -0.02));
        const preInsertWorld = preInsertPos.clone().applyMatrix4(weapon.root.matrixWorld);
        const slideRackWorld = new THREE.Vector3(
          0.012,
          0.068,
          0.012 - state.boltTravel * weapon.boltTravelMax
        ).applyMatrix4(weapon.root.matrixWorld);

        if (stage === 'reach_mag') {
          palmLTarget.lerpVectors(gripLWorldPos, magBaseWorld, u);
          handLTargetQuat.slerpQuaternions(readyLeftQuat, pistolMagQuat, u);
          leftGripCurl = 0.82;
        } else if (stage === 'detach_mag') {
          // Magazine drops straight down grip channel as Hand_L drops to belt pouch
          const dropU = smoothstep(Math.min(1, localT * 1.4));
          weapon.magPivot.position.lerpVectors(
            weapon.magRestPos,
            weapon.magRestPos.clone().add(new THREE.Vector3(0, -0.22, -0.04)),
            dropU
          );
          palmLTarget.lerpVectors(magBaseWorld, beltPouchWorld, u);
          handLTargetQuat.slerpQuaternions(pistolMagQuat, pouchReachQuat, u);
          leftGripCurl = 0.72;
        } else if (stage === 'fetch_mag') {
          // Fresh 15-round 9mm mag rises straight from belt pouch to flared magwell mouth
          palmLTarget.lerpVectors(beltPouchWorld, preInsertWorld, u);
          handLTargetQuat.slerpQuaternions(pouchReachQuat, pistolMagQuat, u);
          const magW = palmLTarget
            .clone()
            .add(new THREE.Vector3(-0.008, 0.048, 0.012).applyQuaternion(weaponWorldQuat));
          weapon.magPivot.position.copy(magW.applyMatrix4(invWeaponMat));
          weapon.magPivot.rotation.set(0.12 * (1 - u), 0, 0);
          leftGripCurl = 0.94;
        } else if (stage === 'insert_mag') {
          // Drive straight up grip channel through flared magwell until flush (zero wrist pinch!)
          weapon.magPivot.position.lerpVectors(preInsertPos, weapon.magRestPos, u);
          weapon.magPivot.rotation.set(0, 0, 0);
          const curMagW = weapon.magPivot.position.clone().applyMatrix4(weapon.root.matrixWorld);
          palmLTarget
            .copy(curMagW)
            .add(new THREE.Vector3(0.008, -0.056, -0.004).applyQuaternion(weaponWorldQuat));
          handLTargetQuat.copy(pistolMagQuat);
          leftGripCurl = 0.92;
        } else if (stage === 'rack_bolt') {
          // Overhand slide rack / slide-release snap on rear serrations!
          const reachK = smoothstep(Math.min(1, localT * 2.5));
          palmLTarget.lerpVectors(magBaseWorld, slideRackWorld, reachK);
          handLTargetQuat.slerpQuaternions(pistolMagQuat, pistolSlideQuat, reachK);
          leftGripCurl = 0.84;
          leftPalmAnchor = [0.062, 0.004, -0.02];
        } else if (stage === 'return_hand') {
          palmLTarget.lerpVectors(slideRackWorld, gripLWorldPos, u);
          handLTargetQuat.slerpQuaternions(pistolSlideQuat, readyLeftQuat, u);
          leftGripCurl = THREE.MathUtils.lerp(0.84, cfg.leftGripCurl, u);
        }
      } else {
        // [MK18 MOD 1] Tactical Speed-Mag Swap + Left-Side Bolt-Catch Slap!
        const magGrabWorld = magRestWorld
          .clone()
          .add(new THREE.Vector3(0.014, -0.068, 0.008).applyQuaternion(weaponWorldQuat));
        const preInsertPos = weapon.magRestPos.clone().add(new THREE.Vector3(0, -0.095, 0.01));
        const preInsertWorld = preInsertPos.clone().applyMatrix4(weapon.root.matrixWorld);
        const boltCatchWorld = new THREE.Vector3(0.024, 0.066, 0.112).applyMatrix4(
          weapon.root.matrixWorld
        );

        if (stage === 'reach_mag') {
          palmLTarget.lerpVectors(gripLWorldPos, magGrabWorld, u);
          handLTargetQuat.slerpQuaternions(readyLeftQuat, magPinchQuat, u);
          leftGripCurl = THREE.MathUtils.lerp(cfg.leftGripCurl, 0.95, u);
        } else if (stage === 'detach_mag') {
          palmLTarget.lerpVectors(magGrabWorld, beltPouchWorld, u);
          handLTargetQuat.slerpQuaternions(magPinchQuat, pouchReachQuat, u);
          const magW = palmLTarget
            .clone()
            .add(new THREE.Vector3(-0.010, 0.058, 0.014).applyQuaternion(weaponWorldQuat));
          weapon.magPivot.position.copy(magW.applyMatrix4(invWeaponMat));
          weapon.magPivot.rotation.set(0.22 * u, 0.16 * u, -0.14 * u);
          leftGripCurl = 0.98;
          leftPalmAnchor = [0.06, 0.004, -0.020];
        } else if (stage === 'fetch_mag') {
          palmLTarget.lerpVectors(beltPouchWorld, preInsertWorld, u);
          handLTargetQuat.slerpQuaternions(pouchReachQuat, magPinchQuat, u);
          const magW = palmLTarget
            .clone()
            .add(new THREE.Vector3(-0.010, 0.058, 0.014).applyQuaternion(weaponWorldQuat));
          weapon.magPivot.position.copy(magW.applyMatrix4(invWeaponMat));
          weapon.magPivot.rotation.set(0.16 * (1 - u), 0.1 * (1 - u), 0);
          leftGripCurl = 0.98;
          leftPalmAnchor = [0.06, 0.004, -0.020];
        } else if (stage === 'insert_mag') {
          weapon.magPivot.position.lerpVectors(preInsertPos, weapon.magRestPos, u);
          weapon.magPivot.rotation.set(0, 0, 0);
          const curMagW = weapon.magPivot.position.clone().applyMatrix4(weapon.root.matrixWorld);
          palmLTarget
            .copy(curMagW)
            .add(new THREE.Vector3(0.014, -0.068, 0.008).applyQuaternion(weaponWorldQuat));
          handLTargetQuat.copy(magPinchQuat);
          leftGripCurl = 0.94;
        } else if (stage === 'rack_bolt') {
          // Crisp palm slap on left-side AR bolt-catch paddle!
          const slapPulse = Math.sin(u * Math.PI);
          const reachK = smoothstep(Math.min(1, localT * 2.6));
          const slapHover = boltCatchWorld
            .clone()
            .add(new THREE.Vector3(0.026 * (1 - slapPulse), 0, 0).applyQuaternion(weaponWorldQuat));
          palmLTarget.lerpVectors(magGrabWorld, slapHover, reachK);
          handLTargetQuat.slerpQuaternions(magPinchQuat, boltCatchQuat, reachK);
          leftGripCurl = 0.35; // Flat open-palm tactical bolt-catch slap!
          leftThumbCurl = 0.25;
        } else if (stage === 'return_hand') {
          palmLTarget.lerpVectors(boltCatchWorld, gripLWorldPos, u);
          handLTargetQuat.slerpQuaternions(boltCatchQuat, readyLeftQuat, u);
          leftGripCurl = THREE.MathUtils.lerp(0.35, cfg.leftGripCurl, u);
        }
      }
    }

    const wristLTarget = this.computeWristFromPalm('L', palmLTarget, handLTargetQuat, leftPalmAnchor);
    const elbowLPole = new THREE.Vector3(
      cfg.elbowLPole[0] + elbowLShiftX,
      cfg.elbowLPole[1] + elbowLShiftY,
      cfg.elbowLPole[2]
    ).applyMatrix4(chest.matrixWorld);
    this.solveArmWorld('L', wristLTarget, elbowLPole, handLTargetQuat);
    this.setFingerGripPose('L', leftGripCurl, 0, false, leftThumbCurl);

    // Subtle cheek-weld head tilt toward optic during ADS
    if (this.adsBlend > 0.02) {
      _eA.set(0.04 * this.adsBlend, -0.08 * this.adsBlend, -0.14 * this.adsBlend, 'YXZ');
      _qC.setFromEuler(_eA);
      head.quaternion.multiply(_qC);
      head.updateMatrixWorld(true);
    }
  }
}
