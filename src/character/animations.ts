import * as THREE from 'three';
import { CharacterRig } from './rig';
import { FACIAL_MORPH_NAMES, FacialMorphName } from './headSculpt';

export const ANIMATION_NAMES = [
  'Idle_Natural',
  'Walk_Casual_GTA',
  'Jog_Tactical',
  'Sprint_Combat',
  'Crouch_Idle',
  'Crouch_Walk',
  'Strafe_Left',
  'Strafe_Right',
  'Combat_Aim_Stance',
  'Combat_Fire_Burst',
  'Jump_Action',
] as const;

export type AnimationName = (typeof ANIMATION_NAMES)[number];

interface PoseFrame {
  pelvisOffset?: [number, number, number];
  /** Euler [x,y,z] rotations for spine/legs/head/fingers */
  rot: Record<string, [number, number, number]>;
  /** Exact quaternion overrides (used by analytical 2-bone arm IK solver!) */
  quat?: Record<string, THREE.Quaternion>;
  morph?: Partial<Record<FacialMorphName, number>>;
}

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();

/**
 * Analytical 2-Bone Arm IK Solver in chest-local / bind space!
 * Eliminates all A-pose Euler sign ambiguity: given desired hand offset from shoulder
 * and an elbow pole hint, computes exact UpperArm and Forearm local quaternions!
 */
function solveArmIK(
  rig: CharacterRig,
  side: 'L' | 'R',
  handRelShoulder: [number, number, number],
  elbowPoleRelShoulder: [number, number, number]
): { upperQ: THREE.Quaternion; forearmQ: THREE.Quaternion } {
  const pS = rig.bindWorldPos.get(`UpperArm_${side}`)!;
  const pE = rig.bindWorldPos.get(`Forearm_${side}`)!;
  const pH = rig.bindWorldPos.get(`Hand_${side}`)!;

  const vUpperBind = pE.clone().sub(pS);
  const vForeBind = pH.clone().sub(pE);
  const L1 = vUpperBind.length();
  const L2 = vForeBind.length();
  const u1Bind = vUpperBind.clone().normalize();
  const u2Bind = vForeBind.clone().normalize();

  const target = new THREE.Vector3(...handRelShoulder);
  const maxReach = (L1 + L2) * 0.992;
  const minReach = Math.abs(L1 - L2) + 0.04;
  let dist = target.length();
  if (dist > maxReach) {
    target.multiplyScalar(maxReach / dist);
    dist = maxReach;
  } else if (dist < minReach) {
    target.normalize().multiplyScalar(minReach);
    dist = minReach;
  }

  // Law of cosines for shoulder angle alpha between target vector and upper arm
  const cosAlpha = Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const alpha = Math.acos(cosAlpha);

  const tDir = target.clone().normalize();
  const pole = new THREE.Vector3(...elbowPoleRelShoulder);
  // Project pole perpendicular to target vector
  const bendDir = pole.sub(tDir.clone().multiplyScalar(pole.dot(tDir)));
  if (bendDir.lengthSq() < 1e-6) bendDir.set(0, -1, 0);
  bendDir.normalize();

  // Desired elbow & hand directions in parent space
  const u1Des = tDir
    .clone()
    .multiplyScalar(Math.cos(alpha))
    .addScaledVector(bendDir, Math.sin(alpha))
    .normalize();
  const elbowPos = u1Des.clone().multiplyScalar(L1);
  const u2Des = target.clone().sub(elbowPos).normalize();

  // UpperArm rotation maps u1Bind -> u1Des with twist aligned so arm plane stays natural
  const upperQ = new THREE.Quaternion().setFromUnitVectors(u1Bind, u1Des);

  // Align upper arm roll slightly so elbow bends cleanly without shoulder twist
  const bindBendNormal = new THREE.Vector3(0, 0, -1); // anatomical elbow back
  const curBendNormal = bindBendNormal.clone().applyQuaternion(upperQ);
  const projCur = curBendNormal.sub(u1Des.clone().multiplyScalar(curBendNormal.dot(u1Des)));
  const projDes = bendDir.clone().sub(u1Des.clone().multiplyScalar(bendDir.dot(u1Des)));
  if (projCur.lengthSq() > 1e-5 && projDes.lengthSq() > 1e-5) {
    projCur.normalize();
    projDes.normalize();
    const twistQ = new THREE.Quaternion().setFromUnitVectors(projCur, projDes);
    upperQ.premultiply(twistQ);
  }

  // Forearm local rotation: maps u2Bind -> upperQ^-1 * u2Des
  const u2DesLocal = u2Des.clone().applyQuaternion(upperQ.clone().invert()).normalize();
  const forearmQ = new THREE.Quaternion().setFromUnitVectors(u2Bind, u2DesLocal);

  return { upperQ, forearmQ };
}

/** Helper to set natural finger curl across all 5 fingers on one hand */
function applyFingerCurl(
  rot: Record<string, [number, number, number]>,
  side: 'L' | 'R',
  amount: number,
  triggerPose = false
) {
  const s = side === 'L' ? 1 : -1;
  const curl = (v: number): [number, number, number] => [0, 0, -v * s];

  const fingers = ['Index', 'Middle', 'Ring', 'Pinky'] as const;
  fingers.forEach((f, idx) => {
    let c = amount * (0.85 + idx * 0.14);
    if (triggerPose && f === 'Index' && side === 'R') {
      c = 0.62;
    }
    rot[`${f}_01_${side}`] = curl(c * 0.65);
    rot[`${f}_02_${side}`] = curl(c * 0.92);
    rot[`${f}_03_${side}`] = curl(c * 0.68);
  });

  const thumbC = amount * 0.55;
  rot[`Thumb_01_${side}`] = [-0.18 * thumbC, 0.25 * s * thumbC, -0.32 * s * thumbC];
  rot[`Thumb_02_${side}`] = [-0.12 * thumbC, 0, -0.45 * s * thumbC];
  rot[`Thumb_03_${side}`] = [0, 0, -0.42 * s * thumbC];
}

function calcGroundedPelvisDrop(
  thighL: number,
  kneeL: number,
  thighR: number,
  kneeR: number
): number {
  const L1 = 0.43;
  const L2 = 0.405;
  const legHeight = (th: number, kn: number) => L1 * Math.cos(th) + L2 * Math.cos(th + kn);
  const maxReach = Math.max(legHeight(thighL, kneeL), legHeight(thighR, kneeR));
  return Math.min(0, maxReach - (L1 + L2));
}

function sampleClip(
  name: AnimationName,
  duration: number,
  fps: number,
  rig: CharacterRig,
  evalPose: (u: number, t: number) => PoseFrame
): THREE.AnimationClip {
  const steps = Math.max(8, Math.round(duration * fps));
  const times: number[] = [];
  const frames: PoseFrame[] = [];
  const boneNameSet = new Set<string>();
  const morphNameSet = new Set<FacialMorphName>();

  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = u * duration;
    times.push(t);
    const f = evalPose(u, t);
    frames.push(f);
    for (const bn of Object.keys(f.rot)) {
      if (rig.boneMap.has(bn)) boneNameSet.add(bn);
    }
    if (f.quat) {
      for (const bn of Object.keys(f.quat)) {
        if (rig.boneMap.has(bn)) boneNameSet.add(bn);
      }
    }
    if (f.morph) {
      for (const mn of Object.keys(f.morph) as FacialMorphName[]) {
        morphNameSet.add(mn);
      }
    }
  }

  const tracks: THREE.KeyframeTrack[] = [];
  const pelvisBind = rig.boneMap.get('Pelvis')!.position;

  const pelVals: number[] = [];
  for (const f of frames) {
    const off = f.pelvisOffset ?? [0, 0, 0];
    pelVals.push(pelvisBind.x + off[0], pelvisBind.y + off[1], pelvisBind.z + off[2]);
  }
  tracks.push(new THREE.VectorKeyframeTrack('Pelvis.position', times, pelVals));

  for (const boneName of boneNameSet) {
    const qVals: number[] = [];
    for (const f of frames) {
      if (f.quat && f.quat[boneName]) {
        const q = f.quat[boneName];
        qVals.push(q.x, q.y, q.z, q.w);
      } else {
        const r = f.rot[boneName] ?? [0, 0, 0];
        _euler.set(r[0], r[1], r[2], 'YXZ');
        _quat.setFromEuler(_euler);
        qVals.push(_quat.x, _quat.y, _quat.z, _quat.w);
      }
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, qVals));
  }

  for (const morphName of FACIAL_MORPH_NAMES) {
    if (!morphNameSet.has(morphName)) continue;
    const mVals: number[] = [];
    for (const f of frames) {
      mVals.push(f.morph?.[morphName] ?? 0);
    }
    tracks.push(
      new THREE.NumberKeyframeTrack(
        `Head_Face_Mesh.morphTargetInfluences[${morphName}]`,
        times,
        mVals
      )
    );
  }

  return new THREE.AnimationClip(name, duration, tracks);
}

/**
 * Helper to apply analytical 2-bone IK arm targets for both L and R arms into a PoseFrame
 */
function setArmsIK(
  rig: CharacterRig,
  quat: Record<string, THREE.Quaternion>,
  leftHand: [number, number, number],
  leftPole: [number, number, number],
  rightHand: [number, number, number],
  rightPole: [number, number, number]
) {
  const L = solveArmIK(rig, 'L', leftHand, leftPole);
  const R = solveArmIK(rig, 'R', rightHand, rightPole);
  quat.UpperArm_L = L.upperQ;
  quat.Forearm_L = L.forearmQ;
  quat.UpperArm_R = R.upperQ;
  quat.Forearm_R = R.forearmQ;
}

export function createCharacterAnimations(rig: CharacterRig): THREE.AnimationClip[] {
  const clips: THREE.AnimationClip[] = [];

  // =========================================================================
  // 1. Idle_Natural: Heroic relaxed stance (arms resting naturally near thighs),
  //    rhythmic chest breathing, weight shift, natural blink & smirk!
  // =========================================================================
  clips.push(
    sampleClip('Idle_Natural', 4.4, 30, rig, (u) => {
      const w = u * Math.PI * 2;
      const breath = Math.sin(w * 2);
      const sway = Math.sin(w);
      const scan = Math.sin(w - 0.5) * 0.09 + Math.sin(w * 2) * 0.025;
      const blink = Math.exp(-Math.pow((u - 0.62) / 0.022, 2));
      const eyeYaw = Math.sin(w * 2 + 0.8) * 0.065;

      const rot: Record<string, [number, number, number]> = {
        Pelvis: [0.015, sway * 0.04, sway * 0.02],
        Spine_01: [0.01 + breath * 0.01, -sway * 0.022, -sway * 0.014],
        Spine_02: [-0.01 + breath * 0.014, -sway * 0.022, -sway * 0.01],
        Chest: [-0.02 - breath * 0.018, -sway * 0.018, -sway * 0.008],
        Neck: [0.015 + breath * 0.008, scan * 0.45, 0],
        Head: [-0.01, scan * 0.55, -sway * 0.02],
        Eye_L: [0, eyeYaw, 0],
        Eye_R: [0, eyeYaw, 0],
        Clavicle_L: [0, 0, -0.015 + breath * 0.014],
        Clavicle_R: [0, 0, 0.015 - breath * 0.014],
        Hand_L: [0.05, 0, -0.06],
        Hand_R: [0.05, 0, 0.06],
        Thigh_L: [-0.03, 0.06, 0.025 - sway * 0.015],
        Calf_L: [0.06, 0, 0],
        Foot_L: [-0.03, 0, -0.015],
        Toe_L: [0, 0, 0],
        Thigh_R: [-0.02, -0.06, -0.025 - sway * 0.015],
        Calf_R: [0.05, 0, 0],
        Foot_R: [-0.03, 0, 0.015],
        Toe_R: [0, 0, 0],
      };

      const quat: Record<string, THREE.Quaternion> = {};
      setArmsIK(
        rig,
        quat,
        [0.105 + breath * 0.006, -0.505, 0.075 + sway * 0.015],
        [0.24, -0.25, -0.25],
        [-0.105 - breath * 0.006, -0.505, 0.085 - sway * 0.015],
        [-0.24, -0.25, -0.25]
      );

      applyFingerCurl(rot, 'L', 0.42);
      applyFingerCurl(rot, 'R', 0.45);

      return {
        pelvisOffset: [sway * 0.012, -0.003 + breath * 0.003, 0],
        rot,
        quat,
        morph: {
          Blink_L: blink,
          Blink_R: blink,
          Mouth_Smirk: 0.34 + Math.sin(w) * 0.05,
          Brow_Focus: 0.14,
        },
      };
    })
  );

  // =========================================================================
  // 2. Walk_Casual_GTA: Confident natural athletic stride with opposing arm swing
  // =========================================================================
  clips.push(
    sampleClip('Walk_Casual_GTA', 1.08, 30, rig, (u) => {
      const w = u * Math.PI * 2;
      const sinW = Math.sin(w);
      const cosW = Math.cos(w);

      const thL = -0.34 * sinW - 0.06;
      const knL = Math.max(0.05, 0.38 + 0.36 * Math.sin(w - 1.05));
      const ftL = 0.24 * Math.sin(w - 1.65) - 0.04;
      const toeL = Math.max(0, 0.26 * Math.sin(w - 2.35));

      const thR = 0.34 * sinW - 0.06;
      const knR = Math.max(0.05, 0.38 + 0.36 * Math.sin(w + Math.PI - 1.05));
      const ftR = 0.24 * Math.sin(w + Math.PI - 1.65) - 0.04;
      const toeR = Math.max(0, 0.26 * Math.sin(w + Math.PI - 2.35));

      const dropY = calcGroundedPelvisDrop(thL, knL, thR, knR);
      const bounceY = Math.abs(sinW) * 0.022;

      const rot: Record<string, [number, number, number]> = {
        Pelvis: [0.05, sinW * 0.11, -cosW * 0.045],
        Spine_01: [0.03, -sinW * 0.07, cosW * 0.025],
        Spine_02: [0.02, -sinW * 0.07, cosW * 0.02],
        Chest: [0.01, -sinW * 0.08, cosW * 0.015],
        Neck: [-0.03, sinW * 0.06, 0],
        Head: [-0.03, sinW * 0.05, -cosW * 0.015],
        Clavicle_L: [0, sinW * 0.05, -0.02],
        Clavicle_R: [0, -sinW * 0.05, 0.02],
        Hand_L: [0.10 * Math.sin(w - 0.5), 0, -0.05],
        Hand_R: [-0.10 * Math.sin(w - 0.5), 0, 0.05],
        Thigh_L: [thL, 0.02, 0.015],
        Calf_L: [knL, 0, 0],
        Foot_L: [ftL, 0, 0],
        Toe_L: [-toeL, 0, 0],
        Thigh_R: [thR, -0.02, -0.015],
        Calf_R: [knR, 0, 0],
        Foot_R: [ftR, 0, 0],
        Toe_R: [-toeR, 0, 0],
      };

      // Opposing natural arm swing along torso sides (Left arm forward when Right leg forward!)
      const quat: Record<string, THREE.Quaternion> = {};
      setArmsIK(
        rig,
        quat,
        [0.095, -0.48 + Math.max(0, -sinW) * 0.08, 0.06 - sinW * 0.22],
        [0.18, -0.24, -0.35 - sinW * 0.12],
        [-0.095, -0.48 + Math.max(0, sinW) * 0.08, 0.06 + sinW * 0.22],
        [-0.18, -0.24, -0.35 + sinW * 0.12]
      );

      applyFingerCurl(rot, 'L', 0.46);
      applyFingerCurl(rot, 'R', 0.46);

      return {
        pelvisOffset: [cosW * 0.024, dropY + bounceY, 0],
        rot,
        quat,
        morph: { Mouth_Smirk: 0.28, Brow_Focus: 0.18 },
      };
    })
  );

  // =========================================================================
  // 3. Jog_Tactical: Forward-leaning Battlegrounds jog, compact bent-arm pump
  // =========================================================================
  clips.push(
    sampleClip('Jog_Tactical', 0.72, 30, rig, (u) => {
      const w = u * Math.PI * 2;
      const sinW = Math.sin(w);
      const cosW = Math.cos(w);

      const thL = -0.58 * sinW - 0.16;
      const knL = Math.max(0.12, 0.65 + 0.56 * Math.sin(w - 1.1));
      const ftL = 0.30 * Math.sin(w - 1.6) - 0.06;

      const thR = 0.58 * sinW - 0.16;
      const knR = Math.max(0.12, 0.65 + 0.56 * Math.sin(w + Math.PI - 1.1));
      const ftR = 0.30 * Math.sin(w + Math.PI - 1.6) - 0.06;

      const dropY = calcGroundedPelvisDrop(thL, knL, thR, knR);
      const bounce = Math.abs(sinW) * 0.048 - 0.015;

      const rot: Record<string, [number, number, number]> = {
        Pelvis: [0.12, sinW * 0.14, -cosW * 0.04],
        Spine_01: [0.08, -sinW * 0.09, cosW * 0.02],
        Spine_02: [0.07, -sinW * 0.09, cosW * 0.02],
        Chest: [0.05, -sinW * 0.11, 0],
        Neck: [-0.14, sinW * 0.08, 0],
        Head: [-0.14, sinW * 0.06, 0],
        Clavicle_L: [0, sinW * 0.06, 0.01],
        Clavicle_R: [0, -sinW * 0.06, -0.01],
        Hand_L: [0.05, 0, -0.1],
        Hand_R: [0.05, 0, 0.1],
        Thigh_L: [thL, 0.02, 0.01],
        Calf_L: [knL, 0, 0],
        Foot_L: [ftL, 0, 0],
        Toe_L: [-Math.max(0, 0.35 * Math.sin(w - 2.2)), 0, 0],
        Thigh_R: [thR, -0.02, -0.01],
        Calf_R: [knR, 0, 0],
        Foot_R: [ftR, 0, 0],
        Toe_R: [-Math.max(0, 0.35 * Math.sin(w + Math.PI - 2.2)), 0, 0],
      };

      const quat: Record<string, THREE.Quaternion> = {};
      setArmsIK(
        rig,
        quat,
        [0.04 - sinW * 0.03, -0.26 - sinW * 0.08, 0.25 - sinW * 0.18],
        [0.20, -0.30, -0.35],
        [-0.04 - sinW * 0.03, -0.26 + sinW * 0.08, 0.25 + sinW * 0.18],
        [-0.20, -0.30, -0.35]
      );

      applyFingerCurl(rot, 'L', 0.75);
      applyFingerCurl(rot, 'R', 0.75);

      return {
        pelvisOffset: [cosW * 0.022, dropY + bounce, 0],
        rot,
        quat,
        morph: { Brow_Focus: 0.35, Nostril_Flare: 0.22 },
      };
    })
  );

  // =========================================================================
  // 4. Sprint_Combat: Explosive high-knee sprint, deep forward lean, strong arm pump
  // =========================================================================
  clips.push(
    sampleClip('Sprint_Combat', 0.54, 30, rig, (u) => {
      const w = u * Math.PI * 2;
      const sinW = Math.sin(w);
      const cosW = Math.cos(w);

      const thL = -0.84 * sinW - 0.20;
      const knL = Math.max(0.15, 0.88 + 0.72 * Math.sin(w - 1.15));
      const ftL = 0.34 * Math.sin(w - 1.55) - 0.08;

      const thR = 0.84 * sinW - 0.20;
      const knR = Math.max(0.15, 0.88 + 0.72 * Math.sin(w + Math.PI - 1.15));
      const ftR = 0.34 * Math.sin(w + Math.PI - 1.55) - 0.08;

      const dropY = calcGroundedPelvisDrop(thL, knL, thR, knR);
      const flight = Math.abs(sinW) * 0.068 - 0.01;

      const rot: Record<string, [number, number, number]> = {
        Pelvis: [0.20, sinW * 0.18, -cosW * 0.05],
        Spine_01: [0.12, -sinW * 0.11, cosW * 0.03],
        Spine_02: [0.10, -sinW * 0.11, cosW * 0.02],
        Chest: [0.08 + Math.sin(w * 2) * 0.025, -sinW * 0.14, 0],
        Neck: [-0.22, sinW * 0.10, 0],
        Head: [-0.22, sinW * 0.08, 0],
        Clavicle_L: [0, sinW * 0.10, 0.03],
        Clavicle_R: [0, -sinW * 0.10, -0.03],
        Hand_L: [0.08, 0, -0.12],
        Hand_R: [0.08, 0, 0.12],
        Thigh_L: [thL, 0, 0.01],
        Calf_L: [knL, 0, 0],
        Foot_L: [ftL, 0, 0],
        Toe_L: [-Math.max(0, 0.40 * Math.sin(w - 2.1)), 0, 0],
        Thigh_R: [thR, 0, -0.01],
        Calf_R: [knR, 0, 0],
        Foot_R: [ftR, 0, 0],
        Toe_R: [-Math.max(0, 0.40 * Math.sin(w + Math.PI - 2.1)), 0, 0],
      };

      // Athletic tight runner arm drive (hands driving chin-to-hip forward & back!)
      const quat: Record<string, THREE.Quaternion> = {};
      setArmsIK(
        rig,
        quat,
        [-0.02 - sinW * 0.06, -0.18 - sinW * 0.14, 0.24 - sinW * 0.26],
        [0.18, -0.26, -0.40 - sinW * 0.15],
        [0.02 - sinW * 0.06, -0.18 + sinW * 0.14, 0.24 + sinW * 0.26],
        [-0.18, -0.26, -0.40 + sinW * 0.15]
      );

      applyFingerCurl(rot, 'L', 0.88);
      applyFingerCurl(rot, 'R', 0.88);

      return {
        pelvisOffset: [cosW * 0.024, dropY + flight, 0],
        rot,
        quat,
        morph: { Brow_Focus: 0.65, Mouth_Grit_Fire: 0.38, Nostril_Flare: 0.55 },
      };
    })
  );

  // =========================================================================
  // 5. Crouch_Idle: Low combat-ready crouched stance, hands up near tactical ready
  // =========================================================================
  clips.push(
    sampleClip('Crouch_Idle', 2.8, 30, rig, (u) => {
      const w = u * Math.PI * 2;
      const breath = Math.sin(w);
      const thL = -0.82;
      const knL = 1.44;
      const thR = -0.62;
      const knR = 1.24;
      const dropY = calcGroundedPelvisDrop(thL, knL, thR, knR);

      const rot: Record<string, [number, number, number]> = {
        Pelvis: [0.16, -0.18, 0],
        Spine_01: [0.14 + breath * 0.015, 0.06, 0],
        Spine_02: [0.12 + breath * 0.018, 0.06, 0],
        Chest: [0.06 + breath * 0.02, 0.08, 0],
        Neck: [-0.24, 0.04, 0],
        Head: [-0.20, 0.06, 0],
        Hand_L: [0.05, 0, -0.1],
        Hand_R: [0.05, 0, 0.1],
        Thigh_L: [thL, 0.12, 0.08],
        Calf_L: [knL, 0, 0],
        Foot_L: [-0.62, 0, 0],
        Toe_L: [0, 0, 0],
        Thigh_R: [thR, -0.14, -0.08],
        Calf_R: [knR, 0, 0],
        Foot_R: [-0.54, 0, 0],
        Toe_R: [-0.15, 0, 0],
      };

      const quat: Record<string, THREE.Quaternion> = {};
      setArmsIK(
        rig,
        quat,
        [-0.08, -0.22 + breath * 0.008, 0.36],
        [0.18, -0.35, -0.15],
        [0.10, -0.24 + breath * 0.008, 0.28],
        [-0.18, -0.35, -0.20]
      );

      applyFingerCurl(rot, 'L', 0.68);
      applyFingerCurl(rot, 'R', 0.72, true);

      return {
        pelvisOffset: [0, dropY + breath * 0.006, 0.02],
        rot,
        quat,
        morph: { Brow_Focus: 0.45 },
      };
    })
  );

  // =========================================================================
  // 6. Crouch_Walk: Smooth stealth crouch stride keeping head level
  // =========================================================================
  clips.push(
    sampleClip('Crouch_Walk', 1.05, 30, rig, (u) => {
      const w = u * Math.PI * 2;
      const sinW = Math.sin(w);
      const cosW = Math.cos(w);

      const thL = -0.76 - 0.34 * sinW;
      const knL = Math.max(0.55, 1.32 + 0.34 * Math.sin(w - 0.95));
      const ftL = -(thL + knL) * 0.85;

      const thR = -0.76 + 0.34 * sinW;
      const knR = Math.max(0.55, 1.32 + 0.34 * Math.sin(w + Math.PI - 0.95));
      const ftR = -(thR + knR) * 0.85;

      const dropY = calcGroundedPelvisDrop(thL, knL, thR, knR);

      const rot: Record<string, [number, number, number]> = {
        Pelvis: [0.18, sinW * 0.12, -cosW * 0.035],
        Spine_01: [0.14, -sinW * 0.06, cosW * 0.02],
        Spine_02: [0.12, -sinW * 0.06, cosW * 0.015],
        Chest: [0.06, -sinW * 0.05, 0],
        Neck: [-0.25, sinW * 0.03, 0],
        Head: [-0.22, sinW * 0.02, 0],
        Hand_L: [0.05, 0, -0.08],
        Hand_R: [0.05, 0, 0.08],
        Thigh_L: [thL, 0.06, 0.06],
        Calf_L: [knL, 0, 0],
        Foot_L: [ftL, 0, 0],
        Toe_L: [0, 0, 0],
        Thigh_R: [thR, -0.06, -0.06],
        Calf_R: [knR, 0, 0],
        Foot_R: [ftR, 0, 0],
        Toe_R: [0, 0, 0],
      };

      const quat: Record<string, THREE.Quaternion> = {};
      setArmsIK(
        rig,
        quat,
        [-0.08, -0.22, 0.35 - sinW * 0.04],
        [0.18, -0.35, -0.15],
        [0.10, -0.24, 0.27 + sinW * 0.04],
        [-0.18, -0.35, -0.20]
      );

      applyFingerCurl(rot, 'L', 0.70);
      applyFingerCurl(rot, 'R', 0.74, true);

      return {
        pelvisOffset: [cosW * 0.02, dropY + Math.abs(sinW) * 0.014, 0.02],
        rot,
        quat,
        morph: { Brow_Focus: 0.5 },
      };
    })
  );

  // =========================================================================
  // 7 & 8. Strafe_Left & Strafe_Right: Combat side-step with weapon-ready hands
  // =========================================================================
  const buildStrafe = (dir: 1 | -1, name: 'Strafe_Left' | 'Strafe_Right') =>
    sampleClip(name, 0.78, 30, rig, (u) => {
      const w = u * Math.PI * 2;
      const sinW = Math.sin(w);
      const cosW = Math.cos(w);

      const abdL = 0.08 + 0.24 * sinW * dir;
      const abdR = -0.08 - 0.24 * sinW * dir;
      const thL = -0.26 - Math.max(0, sinW * dir) * 0.28;
      const knL = 0.44 + Math.max(0, sinW * dir) * 0.46;
      const thR = -0.26 - Math.max(0, -sinW * dir) * 0.28;
      const knR = 0.44 + Math.max(0, -sinW * dir) * 0.46;

      const dropY = calcGroundedPelvisDrop(thL, knL, thR, knR);

      const rot: Record<string, [number, number, number]> = {
        Pelvis: [0.09, -0.18 * dir, -0.06 * dir + cosW * 0.03],
        Spine_01: [0.05, 0.08 * dir, 0.03 * dir],
        Spine_02: [0.04, 0.08 * dir, 0.02 * dir],
        Chest: [0.03, 0.12 * dir, 0.02 * dir],
        Neck: [-0.08, -0.05 * dir, 0],
        Head: [-0.08, -0.05 * dir, 0],
        Hand_L: [0.08, 0.1, -0.1],
        Hand_R: [0.08, -0.1, 0.1],
        Thigh_L: [thL, 0.06, abdL],
        Calf_L: [knL, 0, 0],
        Foot_L: [-(thL + knL) * 0.78, 0, -abdL * 0.5],
        Toe_L: [0, 0, 0],
        Thigh_R: [thR, -0.06, abdR],
        Calf_R: [knR, 0, 0],
        Foot_R: [-(thR + knR) * 0.78, 0, -abdR * 0.5],
        Toe_R: [0, 0, 0],
      };

      const quat: Record<string, THREE.Quaternion> = {};
      setArmsIK(
        rig,
        quat,
        [-0.14, -0.14, 0.44],
        [0.16, -0.35, 0.05],
        [0.14, -0.15, 0.28],
        [-0.22, -0.35, -0.12]
      );

      applyFingerCurl(rot, 'L', 0.74);
      applyFingerCurl(rot, 'R', 0.78, true);

      return {
        pelvisOffset: [sinW * 0.035 * dir, dropY + Math.abs(sinW) * 0.02, 0],
        rot,
        quat,
        morph: { Brow_Focus: 0.58 },
      };
    });

  clips.push(buildStrafe(1, 'Strafe_Left'));
  clips.push(buildStrafe(-1, 'Strafe_Right'));

  // =========================================================================
  // 9. Combat_Aim_Stance: Authentic 2-handed Battlegrounds / GTA-5 weapon-aiming
  //    posture solved via exact analytical 2-bone IK!
  //    - Left support hand cupped forward on centerline (+0.48m ahead)
  //    - Right trigger hand tucked tight near right chest/cheek sightline (+0.26m ahead)
  // =========================================================================
  clips.push(
    sampleClip('Combat_Aim_Stance', 2.4, 30, rig, (u) => {
      const w = u * Math.PI * 2;
      const breath = Math.sin(w);
      const blink = Math.exp(-Math.pow((u - 0.74) / 0.022, 2));

      const thL = -0.26;
      const knL = 0.36;
      const thR = 0.08;
      const knR = 0.24;
      const dropY = calcGroundedPelvisDrop(thL, knL, thR, knR);

      const rot: Record<string, [number, number, number]> = {
        Pelvis: [0.08, -0.30, 0.02],
        Spine_01: [0.06 + breath * 0.008, 0.09, 0],
        Spine_02: [0.05 + breath * 0.01, 0.09, 0],
        Chest: [0.04 + breath * 0.012, 0.12, 0],
        Neck: [-0.07, 0.04, -0.06],
        Head: [-0.05, 0.04, -0.09],
        Eye_L: [0.02, 0.02, 0],
        Eye_R: [0.02, 0.02, 0],
        Clavicle_L: [0, -0.14, 0.02],
        Clavicle_R: [0, 0.08, -0.02],
        Hand_L: [-0.20, 0.15, -0.15],
        Hand_R: [0.15, -0.10, 0.12],
        Thigh_L: [thL, 0.12, 0.09],
        Calf_L: [knL, 0, 0],
        Foot_L: [-0.10, 0, -0.06],
        Toe_L: [0, 0, 0],
        Thigh_R: [thR, -0.16, -0.08],
        Calf_R: [knR, 0, 0],
        Foot_R: [-0.26, 0, 0.06],
        Toe_R: [-0.06, 0, 0],
      };

      const quat: Record<string, THREE.Quaternion> = {};
      // Shoulder L is at (+0.198, 1.482, 0.002), Shoulder R is at (-0.198, 1.482, 0.002)
      // Left support hand reaches forward & inward to centerline (x ≈ -0.02 -> rel -0.21, y ≈ -0.09, z ≈ +0.46)
      // Right trigger hand reaches inward & forward near right pec/sightline (x ≈ -0.06 -> rel +0.13, y ≈ -0.11, z ≈ +0.27)
      setArmsIK(
        rig,
        quat,
        [-0.20, -0.09 + breath * 0.006, 0.45],
        [0.06, -0.40, 0.15],
        [0.13, -0.11 + breath * 0.005, 0.27],
        [-0.28, -0.35, -0.08]
      );

      applyFingerCurl(rot, 'L', 0.66);
      applyFingerCurl(rot, 'R', 0.86, true);

      return {
        pelvisOffset: [0, dropY + breath * 0.003, 0],
        rot,
        quat,
        morph: {
          Blink_L: blink,
          Blink_R: blink,
          Brow_Focus: 0.78,
          Mouth_Smirk: 0.08,
          Nostril_Flare: 0.16,
        },
      };
    })
  );

  // =========================================================================
  // 10. Combat_Fire_Burst: Authentic 3-round weapon recoil traveling through
  //     hands -> elbows -> shoulders -> chest/head + firing grit morph!
  // =========================================================================
  clips.push(
    sampleClip('Combat_Fire_Burst', 0.84, 30, rig, (u) => {
      const shotPulse = (uVal: number, center: number) => {
        const d = uVal - center;
        if (d < 0) return 0;
        return Math.sin(Math.min(1, d / 0.035) * Math.PI * 0.5) * Math.exp(-d * 14.5);
      };

      const kickHand = shotPulse(u, 0.06) + shotPulse(u, 0.32) + shotPulse(u, 0.58);
      const kickArm = shotPulse(u, 0.085) + shotPulse(u, 0.345) + shotPulse(u, 0.605);
      const kickTorso = shotPulse(u, 0.11) + shotPulse(u, 0.37) + shotPulse(u, 0.63);

      const thL = -0.28;
      const knL = 0.40;
      const thR = 0.06;
      const knR = 0.28;
      const dropY = calcGroundedPelvisDrop(thL, knL, thR, knR);

      const rot: Record<string, [number, number, number]> = {
        Pelvis: [0.10 - kickTorso * 0.03, -0.30, 0.02],
        Spine_01: [0.07 - kickTorso * 0.05, 0.09, 0],
        Spine_02: [0.06 - kickTorso * 0.065, 0.09, 0],
        Chest: [0.05 - kickTorso * 0.085, 0.12 - kickTorso * 0.04, 0],
        Neck: [-0.07 + kickTorso * 0.04, 0.04, -0.06],
        Head: [-0.05 - kickTorso * 0.065, 0.04, -0.09],
        Clavicle_L: [0, -0.14 + kickArm * 0.05, 0.02 + kickArm * 0.04],
        Clavicle_R: [0, 0.08 - kickArm * 0.06, -0.02 - kickArm * 0.05],
        Hand_L: [-0.20 - kickHand * 0.22, 0.15, -0.15],
        Hand_R: [0.15 - kickHand * 0.25, -0.10, 0.12],
        Thigh_L: [thL, 0.12, 0.09],
        Calf_L: [knL, 0, 0],
        Foot_L: [-0.12, 0, -0.06],
        Toe_L: [0, 0, 0],
        Thigh_R: [thR, -0.16, -0.08],
        Calf_R: [knR, 0, 0],
        Foot_R: [-0.28, 0, 0.06],
        Toe_R: [-0.06, 0, 0],
      };

      // Sharp muzzle climb & rearward punch on both hands during each burst impulse!
      const quat: Record<string, THREE.Quaternion> = {};
      setArmsIK(
        rig,
        quat,
        [-0.20, -0.09 + kickHand * 0.065, 0.45 - kickHand * 0.055],
        [0.06, -0.40 + kickArm * 0.06, 0.15],
        [0.13, -0.11 + kickHand * 0.055, 0.27 - kickHand * 0.05],
        [-0.28, -0.35 + kickArm * 0.06, -0.08]
      );

      applyFingerCurl(rot, 'L', 0.72);
      applyFingerCurl(rot, 'R', 0.90, true);
      rot.Index_02_R = [0, 0, 0.72 + kickHand * 0.35];

      return {
        pelvisOffset: [0, dropY - kickTorso * 0.008, -kickTorso * 0.022],
        rot,
        quat,
        morph: {
          Blink_L: Math.min(0.45, kickHand * 0.45),
          Blink_R: Math.min(0.45, kickHand * 0.45),
          Brow_Focus: 0.92,
          Mouth_Grit_Fire: Math.min(1.0, 0.58 + kickTorso * 0.42),
          Nostril_Flare: Math.min(1.0, 0.45 + kickTorso * 0.45),
        },
      };
    })
  );

  // =========================================================================
  // 11. Jump_Action: Deep anticipation dip -> launch -> mid-air tuck -> landing
  // =========================================================================
  clips.push(
    sampleClip('Jump_Action', 1.15, 30, rig, (u) => {
      let pelY = 0;
      let lean = 0.04;
      let thL = -0.05;
      let knL = 0.08;
      let thR = -0.04;
      let knR = 0.07;
      let handY = -0.48;
      let handZ = 0.08;

      if (u < 0.22) {
        const k = Math.sin((u / 0.22) * Math.PI * 0.5);
        thL = -0.68 * k;
        knL = 1.24 * k;
        thR = -0.64 * k;
        knR = 1.18 * k;
        pelY = calcGroundedPelvisDrop(thL, knL, thR, knR);
        lean = 0.28 * k;
        handY = -0.44 + k * 0.08;
        handZ = 0.08 - k * 0.34; // Arms swing back for explosive spring
      } else if (u < 0.70) {
        const airU = (u - 0.22) / 0.48;
        const arc = Math.sin(airU * Math.PI);
        pelY = arc * 0.52;
        lean = 0.14 * (1 - arc) + 0.12;
        thL = -0.92 * arc - 0.12;
        knL = 1.38 * arc + 0.18;
        thR = -0.58 * arc - 0.08;
        knR = 0.98 * arc + 0.16;
        handY = -0.44 + arc * 0.55; // Arms drive upward & forward
        handZ = 0.08 + arc * 0.32;
      } else {
        const recU = (u - 0.70) / 0.30;
        const impact = Math.sin(recU * Math.PI);
        thL = -0.74 * impact - 0.05;
        knL = 1.34 * impact + 0.08;
        thR = -0.70 * impact - 0.04;
        knR = 1.28 * impact + 0.07;
        pelY = calcGroundedPelvisDrop(thL, knL, thR, knR);
        lean = 0.30 * impact + 0.04;
        handY = -0.46 + impact * 0.14;
        handZ = 0.08 + impact * 0.22;
      }

      const rot: Record<string, [number, number, number]> = {
        Pelvis: [lean * 0.45, 0, 0],
        Spine_01: [lean * 0.35, 0, 0],
        Spine_02: [lean * 0.30, 0, 0],
        Chest: [lean * 0.25, 0, 0],
        Neck: [-lean * 0.45, 0, 0],
        Head: [-lean * 0.40, 0, 0],
        Hand_L: [0.05, 0, -0.08],
        Hand_R: [0.05, 0, 0.08],
        Thigh_L: [thL, 0.04, 0.04],
        Calf_L: [knL, 0, 0],
        Foot_L: [u >= 0.22 && u < 0.70 ? 0.35 : -(thL + knL) * 0.85, 0, 0],
        Toe_L: [0, 0, 0],
        Thigh_R: [thR, -0.04, -0.04],
        Calf_R: [knR, 0, 0],
        Foot_R: [u >= 0.22 && u < 0.70 ? 0.30 : -(thR + knR) * 0.85, 0, 0],
        Toe_R: [0, 0, 0],
      };

      const quat: Record<string, THREE.Quaternion> = {};
      setArmsIK(
        rig,
        quat,
        [0.12, handY, handZ],
        [0.25, -0.25, -0.30],
        [-0.12, handY, handZ],
        [-0.25, -0.25, -0.30]
      );

      applyFingerCurl(rot, 'L', 0.62);
      applyFingerCurl(rot, 'R', 0.62);

      return {
        pelvisOffset: [0, pelY, 0],
        rot,
        quat,
        morph: {
          Brow_Focus: 0.6,
          Mouth_Grit_Fire: u > 0.18 && u < 0.78 ? 0.45 : 0.08,
          Nostril_Flare: 0.4,
        },
      };
    })
  );

  return clips;
}
