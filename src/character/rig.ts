import * as THREE from 'three';
import type { UE5BoneName, UE5SocketName } from '../types/studioTypes';

export interface BoneDef {
  name: UE5BoneName;
  parent: UE5BoneName | null;
  pos: [number, number, number];
}

/**
 * 63-Bone UE5 IK_Mannequin Hierarchy (Right-handed Y-up, +Z forward, meters, 1.87m hero scale):
 *  - Core (7): root (0,0,0) -> pelvis -> spine_01..03 -> neck_01 -> head
 *  - Arms + Twist (12): clavicle_l/r, upperarm_l/r, upperarm_twist_01_l/r,
 *                       lowerarm_l/r, lowerarm_twist_01_l/r, hand_l/r
 *  - Fingers (30): thumb/index/middle/ring/pinky_01..03_l/r (Finger_Humanoid)
 *  - Legs + Twist (12): thigh_l/r, thigh_twist_01_l/r, calf_l/r, calf_twist_01_l/r, foot_l/r, ball_l/r
 *  - IK Roots (2): ik_hand_root, ik_foot_root
 */
export const BONE_DEFS: BoneDef[] = [
  // Core (7)
  { name: 'root', parent: null, pos: [0, 0, 0] },
  { name: 'pelvis', parent: 'root', pos: [0, 0.97, 0] },
  { name: 'spine_01', parent: 'pelvis', pos: [0, 1.07, 0.004] },
  { name: 'spine_02', parent: 'spine_01', pos: [0, 1.21, 0.002] },
  { name: 'spine_03', parent: 'spine_02', pos: [0, 1.38, 0.0] },
  { name: 'neck_01', parent: 'spine_03', pos: [0, 1.545, -0.008] },
  { name: 'head', parent: 'neck_01', pos: [0, 1.645, 0.002] },

  // Left Arm + Twist (6)
  { name: 'clavicle_l', parent: 'spine_03', pos: [0.06, 1.485, 0.005] },
  { name: 'upperarm_l', parent: 'clavicle_l', pos: [0.195, 1.47, -0.01] },
  { name: 'upperarm_twist_01_l', parent: 'upperarm_l', pos: [0.325, 1.448, -0.016] },
  { name: 'lowerarm_l', parent: 'upperarm_l', pos: [0.46, 1.425, -0.022] },
  { name: 'lowerarm_twist_01_l', parent: 'lowerarm_l', pos: [0.585, 1.404, -0.015] },
  { name: 'hand_l', parent: 'lowerarm_l', pos: [0.715, 1.382, -0.008] },

  // Left Fingers (15)
  { name: 'thumb_01_l', parent: 'hand_l', pos: [0.742, 1.372, 0.024] },
  { name: 'thumb_02_l', parent: 'thumb_01_l', pos: [0.768, 1.356, 0.045] },
  { name: 'thumb_03_l', parent: 'thumb_02_l', pos: [0.790, 1.344, 0.062] },
  { name: 'index_01_l', parent: 'hand_l', pos: [0.795, 1.380, 0.026] },
  { name: 'index_02_l', parent: 'index_01_l', pos: [0.830, 1.377, 0.027] },
  { name: 'index_03_l', parent: 'index_02_l', pos: [0.858, 1.374, 0.028] },
  { name: 'middle_01_l', parent: 'hand_l', pos: [0.798, 1.382, 0.004] },
  { name: 'middle_02_l', parent: 'middle_01_l', pos: [0.836, 1.379, 0.004] },
  { name: 'middle_03_l', parent: 'middle_02_l', pos: [0.868, 1.376, 0.004] },
  { name: 'ring_01_l', parent: 'hand_l', pos: [0.794, 1.380, -0.018] },
  { name: 'ring_02_l', parent: 'ring_01_l', pos: [0.829, 1.377, -0.018] },
  { name: 'ring_03_l', parent: 'ring_02_l', pos: [0.858, 1.374, -0.018] },
  { name: 'pinky_01_l', parent: 'hand_l', pos: [0.788, 1.377, -0.038] },
  { name: 'pinky_02_l', parent: 'pinky_01_l', pos: [0.816, 1.374, -0.039] },
  { name: 'pinky_03_l', parent: 'pinky_02_l', pos: [0.840, 1.371, -0.039] },

  // Right Arm + Twist (6)
  { name: 'clavicle_r', parent: 'spine_03', pos: [-0.06, 1.485, 0.005] },
  { name: 'upperarm_r', parent: 'clavicle_r', pos: [-0.195, 1.47, -0.01] },
  { name: 'upperarm_twist_01_r', parent: 'upperarm_r', pos: [-0.325, 1.448, -0.016] },
  { name: 'lowerarm_r', parent: 'upperarm_r', pos: [-0.46, 1.425, -0.022] },
  { name: 'lowerarm_twist_01_r', parent: 'lowerarm_r', pos: [-0.585, 1.404, -0.015] },
  { name: 'hand_r', parent: 'lowerarm_r', pos: [-0.715, 1.382, -0.008] },

  // Right Fingers (15)
  { name: 'thumb_01_r', parent: 'hand_r', pos: [-0.742, 1.372, 0.024] },
  { name: 'thumb_02_r', parent: 'thumb_01_r', pos: [-0.768, 1.356, 0.045] },
  { name: 'thumb_03_r', parent: 'thumb_02_r', pos: [-0.790, 1.344, 0.062] },
  { name: 'index_01_r', parent: 'hand_r', pos: [-0.795, 1.380, 0.026] },
  { name: 'index_02_r', parent: 'index_01_r', pos: [-0.830, 1.377, 0.027] },
  { name: 'index_03_r', parent: 'index_02_r', pos: [-0.858, 1.374, 0.028] },
  { name: 'middle_01_r', parent: 'hand_r', pos: [-0.798, 1.382, 0.004] },
  { name: 'middle_02_r', parent: 'middle_01_r', pos: [-0.836, 1.379, 0.004] },
  { name: 'middle_03_r', parent: 'middle_02_r', pos: [-0.868, 1.376, 0.004] },
  { name: 'ring_01_r', parent: 'hand_r', pos: [-0.794, 1.380, -0.018] },
  { name: 'ring_02_r', parent: 'ring_01_r', pos: [-0.829, 1.377, -0.018] },
  { name: 'ring_03_r', parent: 'ring_02_r', pos: [-0.858, 1.374, -0.018] },
  { name: 'pinky_01_r', parent: 'hand_r', pos: [-0.788, 1.377, -0.038] },
  { name: 'pinky_02_r', parent: 'pinky_01_r', pos: [-0.816, 1.374, -0.039] },
  { name: 'pinky_03_r', parent: 'pinky_02_r', pos: [-0.840, 1.371, -0.039] },

  // Left Leg + Twist (6)
  { name: 'thigh_l', parent: 'pelvis', pos: [0.105, 0.915, 0.0] },
  { name: 'thigh_twist_01_l', parent: 'thigh_l', pos: [0.104, 0.715, 0.008] },
  { name: 'calf_l', parent: 'thigh_l', pos: [0.102, 0.505, 0.014] },
  { name: 'calf_twist_01_l', parent: 'calf_l', pos: [0.102, 0.305, 0.004] },
  { name: 'foot_l', parent: 'calf_l', pos: [0.102, 0.105, -0.012] },
  { name: 'ball_l', parent: 'foot_l', pos: [0.102, 0.025, 0.115] },

  // Right Leg + Twist (6)
  { name: 'thigh_r', parent: 'pelvis', pos: [-0.105, 0.915, 0.0] },
  { name: 'thigh_twist_01_r', parent: 'thigh_r', pos: [-0.104, 0.715, 0.008] },
  { name: 'calf_r', parent: 'thigh_r', pos: [-0.102, 0.505, 0.014] },
  { name: 'calf_twist_01_r', parent: 'calf_r', pos: [-0.102, 0.305, 0.004] },
  { name: 'foot_r', parent: 'calf_r', pos: [-0.102, 0.105, -0.012] },
  { name: 'ball_r', parent: 'foot_r', pos: [-0.102, 0.025, 0.115] },

  // UE5 IK Root Chains (2)
  { name: 'ik_hand_root', parent: 'root', pos: [0, 0, 0] },
  { name: 'ik_foot_root', parent: 'root', pos: [0, 0, 0] },
];

export const BONE_NAME_TO_INDEX: Record<string, number> = Object.fromEntries(
  BONE_DEFS.map((b, i) => [b.name, i])
);

export const LEGACY_BONE_ALIASES: Record<string, UE5BoneName> = {
  Root: 'root',
  Pelvis: 'pelvis',
  Spine1: 'spine_01',
  Spine2: 'spine_02',
  Chest: 'spine_03',
  Neck: 'neck_01',
  Head: 'head',
  Clavicle_L: 'clavicle_l',
  UpperArm_L: 'upperarm_l',
  Forearm_L: 'lowerarm_l',
  Hand_L: 'hand_l',
  Clavicle_R: 'clavicle_r',
  UpperArm_R: 'upperarm_r',
  Forearm_R: 'lowerarm_r',
  Hand_R: 'hand_r',
  Thigh_L: 'thigh_l',
  Shin_L: 'calf_l',
  Foot_L: 'foot_l',
  Toe_L: 'ball_l',
  Thigh_R: 'thigh_r',
  Shin_R: 'calf_r',
  Foot_R: 'foot_r',
  Toe_R: 'ball_r',
};

export function resolveBoneName(name: string): UE5BoneName {
  if (name in BONE_NAME_TO_INDEX) return name as UE5BoneName;
  if (name in LEGACY_BONE_ALIASES) return LEGACY_BONE_ALIASES[name];
  // Map legacy Finger_01_L or Finger1_L -> finger_01_l
  const m1 = /^(Thumb|Index|Middle|Ring|Pinky)_0([123])_([LR])$/.exec(name);
  if (m1) {
    return `${m1[1].toLowerCase()}_0${m1[2]}_${m1[3].toLowerCase()}` as UE5BoneName;
  }
  const m2 = /^(Thumb|Index|Middle|Ring|Pinky)([123])_([LR])$/.exec(name);
  if (m2) {
    return `${m2[1].toLowerCase()}_0${m2[2]}_${m2[3].toLowerCase()}` as UE5BoneName;
  }
  return name as UE5BoneName;
}

class AliasLookupMap<V> extends Map<string, V> {
  public override get(key: string): V | undefined {
    const direct = super.get(key);
    if (direct !== undefined) return direct;
    const resolved = resolveBoneName(key);
    return super.get(resolved);
  }
  public override has(key: string): boolean {
    if (super.has(key)) return true;
    return super.has(resolveBoneName(key));
  }
}

export interface CharacterRig {
  rootBone: THREE.Bone;
  bones: THREE.Bone[];
  boneMap: Map<string, THREE.Bone>;
  bindWorldPos: Map<string, THREE.Vector3>;
  skeleton: THREE.Skeleton;
  restWorldPositions: Record<string, THREE.Vector3>;
  sockets: Record<UE5SocketName, THREE.Object3D>;
  getBone: (name: string) => THREE.Bone | undefined;
  updateTwistBones: () => void;
}

/**
 * Anatomical orthonormal bind basis for Hand_L / Hand_R:
 * - `along`: points from wrist toward fingertips (+X on L, -X on R)
 * - `forward`: points toward thumb / index front side (+Z)
 * - `out`: points outward from the dorsal back of the hand (+Y), so palm faces `-out`!
 */
export function getHandBasis(
  side: 'L' | 'R',
  rig?: CharacterRig
): { along: THREE.Vector3; forward: THREE.Vector3; out: THREE.Vector3 } {
  const s = side.toLowerCase();
  let along: THREE.Vector3;
  if (rig) {
    const handPos = rig.restWorldPositions[`hand_${s}`];
    const midPos = rig.restWorldPositions[`middle_01_${s}`];
    along = midPos.clone().sub(handPos).normalize();
  } else {
    along = new THREE.Vector3(side === 'L' ? 1 : -1, -0.02, 0).normalize();
  }

  const refForward = new THREE.Vector3(0, 0, 1);
  // Ensure strict orthonormal right-handed frame with `out` pointing dorsal (+Y)
  const out = new THREE.Vector3()
    .crossVectors(side === 'L' ? refForward : along, side === 'L' ? along : refForward)
    .normalize();
  if (out.y < 0) out.negate();
  const forward = new THREE.Vector3()
    .crossVectors(side === 'L' ? along : out, side === 'L' ? out : along)
    .normalize();
  if (forward.z < 0) forward.negate();

  return { along, forward, out };
}

export function createCharacterRig(): CharacterRig {
  const bones: THREE.Bone[] = [];
  const boneMap = new AliasLookupMap<THREE.Bone>();
  const bindWorldPos = new AliasLookupMap<THREE.Vector3>();
  const restWorldPositions: Record<string, THREE.Vector3> = {};

  for (const def of BONE_DEFS) {
    const bone = new THREE.Bone();
    bone.name = def.name;
    bones.push(bone);
    boneMap.set(def.name, bone);
    const v = new THREE.Vector3(...def.pos);
    restWorldPositions[def.name] = v;
    bindWorldPos.set(def.name, v.clone());
  }

  for (const def of BONE_DEFS) {
    const bone = boneMap.get(def.name)!;
    if (def.parent) {
      const parentBone = boneMap.get(def.parent)!;
      const pPos = restWorldPositions[def.parent];
      const cPos = restWorldPositions[def.name];
      bone.position.copy(cPos).sub(pPos);
      parentBone.add(bone);
    } else {
      bone.position.set(...def.pos);
    }
  }

  // Attach UE5 Sockets
  const handRWeapon = new THREE.Object3D();
  handRWeapon.name = 'hand_r_weapon';
  handRWeapon.position.set(-0.04, -0.015, 0.015);
  boneMap.get('hand_r')!.add(handRWeapon);

  const thighHolster = new THREE.Object3D();
  thighHolster.name = 'thigh_holster_socket';
  thighHolster.position.set(-0.106, -0.17, 0.008);
  boneMap.get('thigh_r')!.add(thighHolster);

  const makeSocket = (name: UE5SocketName, parent: THREE.Object3D) => {
    const s = new THREE.Object3D();
    s.name = name;
    parent.add(s);
    return s;
  };

  const sockets: Record<UE5SocketName, THREE.Object3D> = {
    hand_r_weapon: handRWeapon,
    thigh_holster_socket: thighHolster,
    muzzle_socket: makeSocket('muzzle_socket', handRWeapon),
    laser_socket: makeSocket('laser_socket', handRWeapon),
    optic_eye_socket: makeSocket('optic_eye_socket', handRWeapon),
    ejection_port_socket: makeSocket('ejection_port_socket', handRWeapon),
    weapon_light_socket: makeSocket('weapon_light_socket', handRWeapon),
  };

  const getBone = (name: string): THREE.Bone | undefined => boneMap.get(name);

  const rootBone = boneMap.get('root')!;
  rootBone.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skeleton.calculateInverses();

  const _tmpEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  const _axisX = new THREE.Vector3(1, 0, 0);

  /**
   * Drive upperarm_twist_01_l/r and lowerarm_twist_01_l/r at 0.5 * axial roll
   * so rolled-sleeve cuffs and bare forearms twist smoothly with zero pinch.
   */
  const updateTwistBones = () => {
    for (const side of ['l', 'r'] as const) {
      const upper = boneMap.get(`upperarm_${side}`);
      const upperTwist = boneMap.get(`upperarm_twist_01_${side}`);
      const lowerTwist = boneMap.get(`lowerarm_twist_01_${side}`);
      const hand = boneMap.get(`hand_${side}`);

      if (upper && upperTwist) {
        _tmpEuler.setFromQuaternion(upper.quaternion, 'XYZ');
        upperTwist.quaternion.setFromAxisAngle(_axisX, _tmpEuler.x * 0.5);
      }
      if (lowerTwist && hand) {
        _tmpEuler.setFromQuaternion(hand.quaternion, 'XYZ');
        const roll = THREE.MathUtils.clamp(_tmpEuler.x, -1.4, 1.4);
        lowerTwist.quaternion.setFromAxisAngle(_axisX, roll * 0.5);
      }
    }
  };

  return {
    rootBone,
    bones,
    boneMap,
    bindWorldPos,
    skeleton,
    restWorldPositions,
    sockets,
    getBone,
    updateTwistBones,
  };
}

export interface BoneSegment {
  bone: UE5BoneName;
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
}

export function buildBoneSegments(rig: CharacterRig): BoneSegment[] {
  const p = (name: UE5BoneName) => rig.restWorldPositions[name].clone();
  const segs: BoneSegment[] = [
    { bone: 'pelvis', a: p('pelvis').add(new THREE.Vector3(0, -0.05, 0)), b: p('spine_01'), radius: 0.16 },
    { bone: 'spine_01', a: p('spine_01'), b: p('spine_02'), radius: 0.15 },
    { bone: 'spine_02', a: p('spine_02'), b: p('spine_03'), radius: 0.16 },
    { bone: 'spine_03', a: p('spine_03'), b: p('neck_01'), radius: 0.18 },
    { bone: 'neck_01', a: p('neck_01'), b: p('head'), radius: 0.07 },
    { bone: 'head', a: p('head'), b: p('head').add(new THREE.Vector3(0, 0.22, 0)), radius: 0.14 },

    // Left Arm + Twist
    { bone: 'clavicle_l', a: p('clavicle_l'), b: p('upperarm_l'), radius: 0.085 },
    { bone: 'upperarm_l', a: p('upperarm_l'), b: p('upperarm_twist_01_l'), radius: 0.068 },
    { bone: 'upperarm_twist_01_l', a: p('upperarm_twist_01_l'), b: p('lowerarm_l'), radius: 0.062 },
    { bone: 'lowerarm_l', a: p('lowerarm_l'), b: p('lowerarm_twist_01_l'), radius: 0.045 },
    { bone: 'lowerarm_twist_01_l', a: p('lowerarm_twist_01_l'), b: p('hand_l'), radius: 0.045 },
    { bone: 'hand_l', a: p('hand_l'), b: p('middle_01_l'), radius: 0.042 },

    // Right Arm + Twist
    { bone: 'clavicle_r', a: p('clavicle_r'), b: p('upperarm_r'), radius: 0.085 },
    { bone: 'upperarm_r', a: p('upperarm_r'), b: p('upperarm_twist_01_r'), radius: 0.068 },
    { bone: 'upperarm_twist_01_r', a: p('upperarm_twist_01_r'), b: p('lowerarm_r'), radius: 0.062 },
    { bone: 'lowerarm_r', a: p('lowerarm_r'), b: p('lowerarm_twist_01_r'), radius: 0.045 },
    { bone: 'lowerarm_twist_01_r', a: p('lowerarm_twist_01_r'), b: p('hand_r'), radius: 0.045 },
    { bone: 'hand_r', a: p('hand_r'), b: p('middle_01_r'), radius: 0.042 },

    // Left Leg + Twist
    { bone: 'thigh_l', a: p('thigh_l'), b: p('thigh_twist_01_l'), radius: 0.11 },
    { bone: 'thigh_twist_01_l', a: p('thigh_twist_01_l'), b: p('calf_l'), radius: 0.10 },
    { bone: 'calf_l', a: p('calf_l'), b: p('calf_twist_01_l'), radius: 0.085 },
    { bone: 'calf_twist_01_l', a: p('calf_twist_01_l'), b: p('foot_l'), radius: 0.075 },
    { bone: 'foot_l', a: p('foot_l'), b: p('ball_l'), radius: 0.07 },
    { bone: 'ball_l', a: p('ball_l'), b: p('ball_l').add(new THREE.Vector3(0, 0, 0.09)), radius: 0.055 },

    // Right Leg + Twist
    { bone: 'thigh_r', a: p('thigh_r'), b: p('thigh_twist_01_r'), radius: 0.11 },
    { bone: 'thigh_twist_01_r', a: p('thigh_twist_01_r'), b: p('calf_r'), radius: 0.10 },
    { bone: 'calf_r', a: p('calf_r'), b: p('calf_twist_01_r'), radius: 0.085 },
    { bone: 'calf_twist_01_r', a: p('calf_twist_01_r'), b: p('foot_r'), radius: 0.075 },
    { bone: 'foot_r', a: p('foot_r'), b: p('ball_r'), radius: 0.07 },
    { bone: 'ball_r', a: p('ball_r'), b: p('ball_r').add(new THREE.Vector3(0, 0, 0.09)), radius: 0.055 },
  ];

  const fingerNames = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
  for (const side of ['l', 'r'] as const) {
    const sign = side === 'l' ? 1 : -1;
    for (const f of fingerNames) {
      const b1 = `${f}_01_${side}` as UE5BoneName;
      const b2 = `${f}_02_${side}` as UE5BoneName;
      const b3 = `${f}_03_${side}` as UE5BoneName;
      const tipOffset =
        f === 'thumb'
          ? new THREE.Vector3(sign * 0.022, -0.01, 0.014)
          : new THREE.Vector3(sign * 0.028, -0.002, 0);
      segs.push({ bone: b1, a: p(b1), b: p(b2), radius: 0.014 });
      segs.push({ bone: b2, a: p(b2), b: p(b3), radius: 0.012 });
      segs.push({ bone: b3, a: p(b3), b: p(b3).add(tipOffset), radius: 0.011 });
    }
  }

  return segs;
}

function distToSegment(pt: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ap = new THREE.Vector3().subVectors(pt, a);
  const lenSq = ab.lengthSq();
  const t = lenSq > 1e-8 ? THREE.MathUtils.clamp(ap.dot(ab) / lenSq, 0, 1) : 0;
  const closest = a.clone().addScaledVector(ab, t);
  return pt.distanceTo(closest);
}

/**
 * Pure smoothstep forearm/upperarm twist blending (smoothstep radius = 0.045m).
 */
export function computeSmoothstepTwistWeights(
  xCoord: number,
  jointStart: number,
  jointMid: number,
  jointEnd: number,
  smoothRadius = 0.045
): { wPrimary: number; wTwist: number } {
  const s = Math.sign(jointEnd - jointStart) || 1;
  const distFromMid = (xCoord - jointMid) * s;
  const u = THREE.MathUtils.clamp((distFromMid + smoothRadius) / (2 * smoothRadius), 0, 1);
  const wTwist = u * u * (3 - 2 * u);
  return { wPrimary: 1 - wTwist, wTwist };
}

export function normalizeSkinWeightsOnGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const idxAttr = geo.getAttribute('skinIndex');
  const wAttr = geo.getAttribute('skinWeight');
  if (!idxAttr || !wAttr) return geo;

  const count = idxAttr.count;
  const idxArr = new Uint16Array(count * 4);
  const wArr = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const bi = Math.max(0, Math.min(BONE_DEFS.length - 1, Math.round(idxAttr.getComponent(i, k))));
      const w = Math.max(0, wAttr.getComponent(i, k));
      idxArr[i * 4 + k] = bi;
      wArr[i * 4 + k] = w;
      sum += w;
    }
    if (sum > 1e-6) {
      for (let k = 0; k < 4; k++) wArr[i * 4 + k] /= sum;
    } else {
      wArr[i * 4] = 1;
    }
  }

  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idxArr, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wArr, 4));
  return geo;
}

export function skinRigidToBone(geo: THREE.BufferGeometry, boneName: string): THREE.BufferGeometry {
  const resolved = resolveBoneName(boneName);
  const idx = BONE_NAME_TO_INDEX[resolved] ?? 0;
  const count = geo.attributes.position.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    skinIndices[i * 4] = idx;
    skinWeights[i * 4] = 1.0;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  return geo;
}

export function skinSmoothToBones(
  geo: THREE.BufferGeometry,
  rig: CharacterRig,
  allowedBones?: string[],
  sharpness = 3.6
): THREE.BufferGeometry {
  const allSegs = buildBoneSegments(rig);
  const resolvedAllowed = allowedBones ? new Set(allowedBones.map(resolveBoneName)) : null;
  const segs = resolvedAllowed ? allSegs.filter((s) => resolvedAllowed.has(s.bone)) : allSegs;

  const pos = geo.attributes.position;
  const count = pos.count;
  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);
  const pt = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    pt.fromBufferAttribute(pos, i);
    const influences: Array<{ idx: number; w: number }> = [];

    for (const seg of segs) {
      const d = distToSegment(pt, seg.a, seg.b);
      const norm = d / Math.max(seg.radius, 0.01);
      const w = Math.exp(-norm * norm * sharpness);
      if (w > 0.0004) {
        influences.push({ idx: BONE_NAME_TO_INDEX[seg.bone], w });
      }
    }

    if (influences.length === 0) {
      let bestIdx = 0;
      let bestD = Infinity;
      for (const seg of segs) {
        const d = distToSegment(pt, seg.a, seg.b);
        if (d < bestD) {
          bestD = d;
          bestIdx = BONE_NAME_TO_INDEX[seg.bone];
        }
      }
      influences.push({ idx: bestIdx, w: 1 });
    }

    influences.sort((a, b) => b.w - a.w);
    const top = influences.slice(0, 4);
    let sum = 0;
    for (const t of top) sum += t.w;
    if (sum < 1e-6) sum = 1;

    for (let k = 0; k < 4; k++) {
      if (k < top.length) {
        skinIndices[i * 4 + k] = top[k].idx;
        skinWeights[i * 4 + k] = top[k].w / sum;
      } else {
        skinIndices[i * 4 + k] = 0;
        skinWeights[i * 4 + k] = 0;
      }
    }
  }

  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  return normalizeSkinWeightsOnGeometry(geo);
}
