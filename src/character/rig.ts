import * as THREE from 'three';

export interface BoneDef {
  name: string;
  parent: string | null;
  /** World-space bind position in meters (Y=0 is floor, character faces +Z, height = 1.85m) */
  worldPos: [number, number, number];
}

export interface BoneSegment {
  boneIndex: number;
  boneName: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  radius: number;
  region: SkinRegion;
}

export type SkinRegion =
  | 'head'
  | 'eye_l'
  | 'eye_r'
  | 'torso'
  | 'arm_l'
  | 'arm_r'
  | 'hand_l'
  | 'hand_r'
  | 'leg_l'
  | 'leg_r'
  | 'foot_l'
  | 'foot_r'
  | 'auto';

/**
 * Heroic 1.85m male commando humanoid skeleton (55 bones total).
 * Facing +Z, +Y up, +X is character's LEFT (_L), -X is character's RIGHT (_R).
 * Soles sit flush at Y = 0.000, crown of hair reaches Y = 1.850.
 */
function buildFingerDefs(side: 'L' | 'R'): BoneDef[] {
  const s = side === 'L' ? 1 : -1;
  // Hand_L world bind pos: (+0.538, 1.045, 0.018)
  // Arm A-pose direction vector from Forearm to Hand:
  // Forearm_L: (+0.382, 1.248, -0.014) -> Hand_L: (+0.538, 1.045, 0.018)
  // Unit arm dir: normalize(0.156, -0.203, 0.032) ≈ (0.604, -0.786, 0.124)
  // Palm normal (outward back of hand): roughly (+0.78, +0.60, 0.0)
  // Forward direction along palm width (thumb toward +Z, pinky toward -Z)
  const hx = 0.538 * s;
  const hy = 1.045;
  const hz = 0.018;

  // Hand local basis in world space (A-pose, palms angled inward toward thighs)
  const along = new THREE.Vector3(0.58 * s, -0.80, 0.14).normalize();
  const forward = new THREE.Vector3(-0.14 * s, 0.05, 0.99).normalize();
  const out = new THREE.Vector3().crossVectors(forward, along).multiplyScalar(s).normalize();
  // Ensure out points away from torso (+X for L, -X for R)
  if (out.x * s < 0) out.negate();

  const pt = (a: number, f: number, o: number): [number, number, number] => [
    hx + along.x * a + forward.x * f + out.x * o,
    hy + along.y * a + forward.y * f + out.y * o,
    hz + along.z * a + forward.z * f + out.z * o,
  ];

  const defs: BoneDef[] = [
    // Thumb (3 phalanges)
    { name: `Thumb_01_${side}`, parent: `Hand_${side}`, worldPos: pt(0.028, 0.032, -0.006) },
    { name: `Thumb_02_${side}`, parent: `Thumb_01_${side}`, worldPos: pt(0.056, 0.052, -0.012) },
    { name: `Thumb_03_${side}`, parent: `Thumb_02_${side}`, worldPos: pt(0.082, 0.064, -0.016) },
    // Index (3 phalanges)
    { name: `Index_01_${side}`, parent: `Hand_${side}`, worldPos: pt(0.088, 0.030, 0.004) },
    { name: `Index_02_${side}`, parent: `Index_01_${side}`, worldPos: pt(0.124, 0.030, 0.001) },
    { name: `Index_03_${side}`, parent: `Index_02_${side}`, worldPos: pt(0.151, 0.030, -0.003) },
    // Middle (3 phalanges)
    { name: `Middle_01_${side}`, parent: `Hand_${side}`, worldPos: pt(0.092, 0.009, 0.006) },
    { name: `Middle_02_${side}`, parent: `Middle_01_${side}`, worldPos: pt(0.132, 0.009, 0.002) },
    { name: `Middle_03_${side}`, parent: `Middle_02_${side}`, worldPos: pt(0.161, 0.009, -0.003) },
    // Ring (3 phalanges)
    { name: `Ring_01_${side}`, parent: `Hand_${side}`, worldPos: pt(0.088, -0.012, 0.005) },
    { name: `Ring_02_${side}`, parent: `Ring_01_${side}`, worldPos: pt(0.124, -0.012, 0.001) },
    { name: `Ring_03_${side}`, parent: `Ring_02_${side}`, worldPos: pt(0.150, -0.012, -0.003) },
    // Pinky (3 phalanges)
    { name: `Pinky_01_${side}`, parent: `Hand_${side}`, worldPos: pt(0.081, -0.031, 0.002) },
    { name: `Pinky_02_${side}`, parent: `Pinky_01_${side}`, worldPos: pt(0.109, -0.031, -0.001) },
    { name: `Pinky_03_${side}`, parent: `Pinky_02_${side}`, worldPos: pt(0.131, -0.031, -0.005) },
  ];

  return defs;
}

export const BONE_DEFS: BoneDef[] = [
  // Core spine & head
  { name: 'Root', parent: null, worldPos: [0, 0, 0] },
  { name: 'Pelvis', parent: 'Root', worldPos: [0, 0.965, 0] },
  { name: 'Spine_01', parent: 'Pelvis', worldPos: [0, 1.080, 0.002] },
  { name: 'Spine_02', parent: 'Spine_01', worldPos: [0, 1.215, 0.004] },
  { name: 'Chest', parent: 'Spine_02', worldPos: [0, 1.370, 0.005] },
  { name: 'Neck', parent: 'Chest', worldPos: [0, 1.545, 0.006] },
  { name: 'Head', parent: 'Neck', worldPos: [0, 1.638, 0.014] },
  { name: 'Jaw', parent: 'Head', worldPos: [0, 1.630, 0.044] },
  { name: 'Eye_L', parent: 'Head', worldPos: [0.0295, 1.728, 0.090] },
  { name: 'Eye_R', parent: 'Head', worldPos: [-0.0295, 1.728, 0.090] },

  // Left arm (+X)
  { name: 'Clavicle_L', parent: 'Chest', worldPos: [0.055, 1.500, 0.014] },
  { name: 'UpperArm_L', parent: 'Clavicle_L', worldPos: [0.198, 1.482, 0.002] },
  { name: 'Forearm_L', parent: 'UpperArm_L', worldPos: [0.382, 1.248, -0.014] },
  { name: 'Hand_L', parent: 'Forearm_L', worldPos: [0.538, 1.045, 0.018] },
  ...buildFingerDefs('L'),

  // Right arm (-X)
  { name: 'Clavicle_R', parent: 'Chest', worldPos: [-0.055, 1.500, 0.014] },
  { name: 'UpperArm_R', parent: 'Clavicle_R', worldPos: [-0.198, 1.482, 0.002] },
  { name: 'Forearm_R', parent: 'UpperArm_R', worldPos: [-0.382, 1.248, -0.014] },
  { name: 'Hand_R', parent: 'Forearm_R', worldPos: [-0.538, 1.045, 0.018] },
  ...buildFingerDefs('R'),

  // Left leg (+X)
  { name: 'Thigh_L', parent: 'Pelvis', worldPos: [0.105, 0.920, 0.002] },
  { name: 'Calf_L', parent: 'Thigh_L', worldPos: [0.112, 0.490, 0.012] },
  { name: 'Foot_L', parent: 'Calf_L', worldPos: [0.116, 0.088, -0.012] },
  { name: 'Toe_L', parent: 'Foot_L', worldPos: [0.116, 0.028, 0.132] },

  // Right leg (-X)
  { name: 'Thigh_R', parent: 'Pelvis', worldPos: [-0.105, 0.920, 0.002] },
  { name: 'Calf_R', parent: 'Thigh_R', worldPos: [-0.112, 0.490, 0.012] },
  { name: 'Foot_R', parent: 'Calf_R', worldPos: [-0.116, 0.088, -0.012] },
  { name: 'Toe_R', parent: 'Foot_R', worldPos: [-0.116, 0.028, 0.132] },
];

export interface CharacterRig {
  rootBone: THREE.Bone;
  bones: THREE.Bone[];
  boneMap: Map<string, THREE.Bone>;
  boneIndexMap: Map<string, number>;
  skeleton: THREE.Skeleton;
  bindWorldPos: Map<string, THREE.Vector3>;
  segments: BoneSegment[];
}

export function createCharacterRig(): CharacterRig {
  const bones: THREE.Bone[] = [];
  const boneMap = new Map<string, THREE.Bone>();
  const boneIndexMap = new Map<string, number>();
  const bindWorldPos = new Map<string, THREE.Vector3>();

  for (let i = 0; i < BONE_DEFS.length; i++) {
    const def = BONE_DEFS[i];
    const bone = new THREE.Bone();
    bone.name = def.name;
    const wp = new THREE.Vector3(...def.worldPos);
    bindWorldPos.set(def.name, wp);

    if (def.parent === null) {
      bone.position.copy(wp);
    } else {
      const parentBone = boneMap.get(def.parent);
      const parentWp = bindWorldPos.get(def.parent);
      if (!parentBone || !parentWp) {
        throw new Error(`Missing parent bone ${def.parent} for ${def.name}`);
      }
      bone.position.copy(wp).sub(parentWp);
      parentBone.add(bone);
    }

    bones.push(bone);
    boneMap.set(def.name, bone);
    boneIndexMap.set(def.name, i);
  }

  const rootBone = bones[0];
  rootBone.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(bones);
  const segments = buildBoneSegments(boneIndexMap, bindWorldPos);

  return {
    rootBone,
    bones,
    boneMap,
    boneIndexMap,
    skeleton,
    bindWorldPos,
    segments,
  };
}

function buildBoneSegments(
  indexMap: Map<string, number>,
  wp: Map<string, THREE.Vector3>
): BoneSegment[] {
  const segs: BoneSegment[] = [];
  const add = (
    boneName: string,
    endNameOrOffset: string | [number, number, number],
    radius: number,
    region: SkinRegion
  ) => {
    const idx = indexMap.get(boneName);
    const a = wp.get(boneName);
    if (idx === undefined || !a) return;
    let b: THREE.Vector3;
    if (typeof endNameOrOffset === 'string') {
      const endP = wp.get(endNameOrOffset);
      if (!endP) return;
      b = endP.clone();
    } else {
      b = a.clone().add(new THREE.Vector3(...endNameOrOffset));
    }
    segs.push({ boneIndex: idx, boneName, a: a.clone(), b, radius, region });
  };

  // Spine & Head
  add('Pelvis', 'Spine_01', 0.16, 'torso');
  add('Spine_01', 'Spine_02', 0.15, 'torso');
  add('Spine_02', 'Chest', 0.165, 'torso');
  add('Chest', 'Neck', 0.175, 'torso');
  add('Neck', 'Head', 0.075, 'torso');
  add('Head', [0, 0.19, 0], 0.12, 'head');

  // Arms
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const armReg: SkinRegion = side === 'L' ? 'arm_l' : 'arm_r';
    const handReg: SkinRegion = side === 'L' ? 'hand_l' : 'hand_r';
    add(`Clavicle_${side}`, `UpperArm_${side}`, 0.095, armReg);
    add(`UpperArm_${side}`, `Forearm_${side}`, 0.085, armReg);
    add(`Forearm_${side}`, `Hand_${side}`, 0.068, armReg);
    add(`Hand_${side}`, [0.055 * s, -0.072, 0.012], 0.055, handReg);

    // Fingers
    const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;
    for (const f of fingers) {
      const b1 = `${f}_01_${side}`;
      const b2 = `${f}_02_${side}`;
      const b3 = `${f}_03_${side}`;
      add(b1, b2, 0.015, handReg);
      add(b2, b3, 0.013, handReg);
      const p2 = wp.get(b2)!;
      const p3 = wp.get(b3)!;
      const tipDir = p3.clone().sub(p2).normalize().multiplyScalar(0.024);
      add(b3, [tipDir.x, tipDir.y, tipDir.z], 0.011, handReg);
    }
  }

  // Legs
  for (const side of ['L', 'R'] as const) {
    const legReg: SkinRegion = side === 'L' ? 'leg_l' : 'leg_r';
    const footReg: SkinRegion = side === 'L' ? 'foot_l' : 'foot_r';
    add(`Thigh_${side}`, `Calf_${side}`, 0.115, legReg);
    add(`Calf_${side}`, `Foot_${side}`, 0.085, legReg);
    add(`Foot_${side}`, `Toe_${side}`, 0.078, footReg);
    add(`Toe_${side}`, [0, -0.005, 0.075], 0.055, footReg);
  }

  return segs;
}

/** Distance from point P to segment AB, plus parameter t in [0, 1] */
function pointToSegmentDistSq(
  px: number,
  py: number,
  pz: number,
  a: THREE.Vector3,
  b: THREE.Vector3
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = px - a.x;
  const apy = py - a.y;
  const apz = pz - a.z;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = abLenSq > 1e-8 ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = a.x + abx * t - px;
  const cy = a.y + aby * t - py;
  const cz = a.z + abz * t - pz;
  return cx * cx + cy * cy + cz * cz;
}

export interface SkinWeightOptions {
  /** Lock all vertices strictly to one bone (e.g. Eye_L, Eye_R, Hair on Head) */
  rigidBone?: string;
  /** Restrict candidate bone names to prevent cross-limb bleeding */
  allowedBones?: string[];
  /** Sharpness exponent for smooth anatomical joint falloff (default 2.6) */
  sharpness?: number;
}

/**
 * Computes smooth anatomical skinIndex (Uint16) and skinWeight (Float32) attributes
 * for any BufferGeometry in character bind space.
 * Guarantees strictly <= 4 non-zero weights per vertex, normalized to 1.0000.
 */
export function applySkinWeights(
  geometry: THREE.BufferGeometry,
  rig: CharacterRig,
  options: SkinWeightOptions = {}
): THREE.BufferGeometry {
  const posAttr = geometry.attributes.position;
  const vCount = posAttr.count;
  const skinIndices = new Uint16Array(vCount * 4);
  const skinWeights = new Float32Array(vCount * 4);

  if (options.rigidBone) {
    const bIdx = rig.boneIndexMap.get(options.rigidBone);
    if (bIdx === undefined) {
      throw new Error(`Unknown rigidBone: ${options.rigidBone}`);
    }
    for (let i = 0; i < vCount; i++) {
      const o = i * 4;
      skinIndices[o] = bIdx;
      skinIndices[o + 1] = 0;
      skinIndices[o + 2] = 0;
      skinIndices[o + 3] = 0;
      skinWeights[o] = 1.0;
      skinWeights[o + 1] = 0.0;
      skinWeights[o + 2] = 0.0;
      skinWeights[o + 3] = 0.0;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    return geometry;
  }

  const allowedSet = options.allowedBones ? new Set(options.allowedBones) : null;
  const candidateSegs = allowedSet
    ? rig.segments.filter((seg) => allowedSet.has(seg.boneName))
    : rig.segments;

  const sharpness = options.sharpness ?? 2.8;
  const topIdx = [0, 0, 0, 0];
  const topW = [0, 0, 0, 0];

  for (let i = 0; i < vCount; i++) {
    const px = posAttr.getX(i);
    const py = posAttr.getY(i);
    const pz = posAttr.getZ(i);

    topIdx[0] = topIdx[1] = topIdx[2] = topIdx[3] = 0;
    topW[0] = topW[1] = topW[2] = topW[3] = 0;

    for (let s = 0; s < candidateSegs.length; s++) {
      const seg = candidateSegs[s];
      // Prevent cross-side bleeding between left and right legs or arms when auto-skinning
      if (!allowedSet) {
        if (seg.region === 'leg_l' && px < -0.008) continue;
        if (seg.region === 'leg_r' && px > 0.008) continue;
        if (seg.region === 'foot_l' && px < -0.005) continue;
        if (seg.region === 'foot_r' && px > 0.005) continue;
        if ((seg.region === 'arm_l' || seg.region === 'hand_l') && px < 0.08) continue;
        if ((seg.region === 'arm_r' || seg.region === 'hand_r') && px > -0.08) continue;
      }

      const dSq = pointToSegmentDistSq(px, py, pz, seg.a, seg.b);
      const normDist = Math.sqrt(dSq) / Math.max(seg.radius, 0.01);
      // Smooth inverse-power falloff with soft joint blending zone
      const w = 1.0 / Math.pow(0.12 + normDist * normDist, sharpness);

      // Insert into top 4
      if (w > topW[3]) {
        let pos = 3;
        while (pos > 0 && w > topW[pos - 1]) {
          topW[pos] = topW[pos - 1];
          topIdx[pos] = topIdx[pos - 1];
          pos--;
        }
        topW[pos] = w;
        topIdx[pos] = seg.boneIndex;
      }
    }

    // Drop negligible micro-weights (< 3% of strongest) for cleaner deformation
    const maxW = topW[0];
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      if (topW[k] < maxW * 0.03) {
        topW[k] = 0;
        topIdx[k] = 0;
      }
      sum += topW[k];
    }

    const o = i * 4;
    if (sum > 1e-8) {
      let running = 0;
      for (let k = 0; k < 4; k++) {
        skinIndices[o + k] = topIdx[k];
        if (k < 3) {
          const nw = topW[k] / sum;
          skinWeights[o + k] = nw;
          running += nw;
        } else {
          skinWeights[o + k] = Math.max(0, 1.0 - running);
        }
      }
      // Re-normalize exactly to float32 sum = 1.0
      const exactSum =
        skinWeights[o] + skinWeights[o + 1] + skinWeights[o + 2] + skinWeights[o + 3];
      if (exactSum > 0) {
        skinWeights[o] /= exactSum;
        skinWeights[o + 1] /= exactSum;
        skinWeights[o + 2] /= exactSum;
        skinWeights[o + 3] /= exactSum;
      }
    } else {
      skinIndices[o] = rig.boneIndexMap.get('Pelvis') ?? 1;
      skinWeights[o] = 1.0;
    }
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  return geometry;
}

/**
 * Helper to create a properly bound SkinnedMesh with UE5/glTF-safe settings.
 */
export function createBoundSkinnedMesh(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  rig: CharacterRig
): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.bind(rig.skeleton, new THREE.Matrix4());
  return mesh;
}

/**
 * Computes hand coordinate frame matching the bind-pose finger orientation.
 */
export function getHandBasis(side: 'L' | 'R', rig: CharacterRig) {
  const s = side === 'L' ? 1 : -1;
  const handPos = rig.bindWorldPos.get(`Hand_${side}`)!.clone();
  const along = new THREE.Vector3(0.58 * s, -0.80, 0.14).normalize();
  const forward = new THREE.Vector3(-0.14 * s, 0.05, 0.99).normalize();
  const out = new THREE.Vector3().crossVectors(forward, along).multiplyScalar(s).normalize();
  if (out.x * s < 0) out.negate();
  return { handPos, along, forward, out, s };
}

export interface GloveMcpJoint {
  name: 'Pinky' | 'Ring' | 'Middle' | 'Index';
  boneName: string;
  worldPos: THREE.Vector3;
  along: number;
  forward: number;
  out: number;
}

export interface GloveSkeletalAlignment {
  side: 'L' | 'R';
  handPos: THREE.Vector3;
  along: THREE.Vector3;
  forward: THREE.Vector3;
  out: THREE.Vector3;
  /** 4 MCP knuckles ordered ulnar-to-radial: Pinky -> Ring -> Middle -> Index */
  mcpJoints: GloveMcpJoint[];
  thumbMcpLocal: { along: number; forward: number; out: number };
  meanMcpAlong: number;
  meanMcpForward: number;
  mcpSpanForward: number;
  /** Dorsal back-of-hand cutout centered over the metacarpal arch proximal to the 4 MCP knuckles */
  cutoutCenterLocal: { along: number; forward: number };
  cutoutCenterWorld: THREE.Vector3;
}

/**
 * Computes exact skeletal alignment for the fingerless tactical glove dorsal cutout,
 * 4-knuckle impact armor crowns, and palm reinforcement pads directly from the hand rig's bones.
 */
export function computeGloveSkeletalAlignment(
  rig: CharacterRig,
  side: 'L' | 'R'
): GloveSkeletalAlignment {
  const { handPos, along, forward, out } = getHandBasis(side, rig);
  const basisInv = new THREE.Matrix4().makeBasis(along, forward, out).invert();

  const toLocal = (wp: THREE.Vector3) => {
    const rel = wp.clone().sub(handPos).applyMatrix4(basisInv);
    return { along: rel.x, forward: rel.y, out: rel.z };
  };

  const mcpOrder: ('Pinky' | 'Ring' | 'Middle' | 'Index')[] = ['Pinky', 'Ring', 'Middle', 'Index'];
  const mcpJoints: GloveMcpJoint[] = mcpOrder.map((name) => {
    const boneName = `${name}_01_${side}`;
    const worldPos = rig.bindWorldPos.get(boneName)!.clone();
    const loc = toLocal(worldPos);
    return {
      name,
      boneName,
      worldPos,
      along: loc.along,
      forward: loc.forward,
      out: loc.out,
    };
  });

  const thumbMcpLocal = toLocal(rig.bindWorldPos.get(`Thumb_01_${side}`)!);

  const meanMcpAlong =
    mcpJoints.reduce((acc, j) => acc + j.along, 0) / mcpJoints.length;
  const meanMcpForward =
    mcpJoints.reduce((acc, j) => acc + j.forward, 0) / mcpJoints.length;
  const mcpSpanForward =
    mcpJoints[mcpJoints.length - 1].forward - mcpJoints[0].forward;

  // Center dorsal cutout squarely over the metacarpal shaft valley between carpal wrist & MCP arch
  const cutoutAlong = meanMcpAlong * 0.48;
  const cutoutForward = meanMcpForward;
  const cutoutCenterWorld = handPos
    .clone()
    .addScaledVector(along, cutoutAlong)
    .addScaledVector(forward, cutoutForward)
    .addScaledVector(out, 0.021);

  return {
    side,
    handPos,
    along,
    forward,
    out,
    mcpJoints,
    thumbMcpLocal,
    meanMcpAlong,
    meanMcpForward,
    mcpSpanForward,
    cutoutCenterLocal: { along: cutoutAlong, forward: cutoutForward },
    cutoutCenterWorld,
  };
}
