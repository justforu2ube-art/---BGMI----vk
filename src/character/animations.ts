import * as THREE from 'three';
import { CharacterRig, resolveBoneName } from './rig';

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

export interface AnimationClipMeta {
  name: AnimationName;
  label: string;
  category: 'Locomotion' | 'Combat';
  duration: number;
  loop: boolean;
}

export const ANIMATION_CLIP_METAS: AnimationClipMeta[] = [
  { name: 'Idle_Natural', label: 'Idle Natural', category: 'Locomotion', duration: 3.6, loop: true },
  { name: 'Walk_Casual_GTA', label: 'Walk Casual', category: 'Locomotion', duration: 1.05, loop: true },
  { name: 'Jog_Tactical', label: 'Jog Tactical', category: 'Locomotion', duration: 0.72, loop: true },
  { name: 'Sprint_Combat', label: 'Sprint Combat', category: 'Combat', duration: 0.56, loop: true },
  { name: 'Crouch_Idle', label: 'Crouch Idle', category: 'Combat', duration: 2.6, loop: true },
  { name: 'Crouch_Walk', label: 'Crouch Walk', category: 'Combat', duration: 1.15, loop: true },
  { name: 'Strafe_Left', label: 'Strafe Left', category: 'Combat', duration: 0.85, loop: true },
  { name: 'Strafe_Right', label: 'Strafe Right', category: 'Combat', duration: 0.85, loop: true },
  { name: 'Combat_Aim_Stance', label: 'Combat Aim', category: 'Combat', duration: 2.4, loop: true },
  { name: 'Combat_Fire_Burst', label: 'Fire Burst', category: 'Combat', duration: 0.65, loop: true },
  { name: 'Jump_Action', label: 'Jump Action', category: 'Locomotion', duration: 1.0, loop: false },
];

type PoseSample = {
  pelvisOffset?: [number, number, number];
  rot: Record<string, [number, number, number]>;
  morphs?: Record<string, number>;
};

const UPPER_BODY_BONES = new Set<string>([
  'spine_02',
  'spine_03',
  'neck_01',
  'head',
  'clavicle_l',
  'upperarm_l',
  'upperarm_twist_01_l',
  'lowerarm_l',
  'lowerarm_twist_01_l',
  'hand_l',
  'clavicle_r',
  'upperarm_r',
  'upperarm_twist_01_r',
  'lowerarm_r',
  'lowerarm_twist_01_r',
  'hand_r',
  'thumb_01_l', 'thumb_02_l', 'thumb_03_l',
  'index_01_l', 'index_02_l', 'index_03_l',
  'middle_01_l', 'middle_02_l', 'middle_03_l',
  'ring_01_l', 'ring_02_l', 'ring_03_l',
  'pinky_01_l', 'pinky_02_l', 'pinky_03_l',
  'thumb_01_r', 'thumb_02_r', 'thumb_03_r',
  'index_01_r', 'index_02_r', 'index_03_r',
  'middle_01_r', 'middle_02_r', 'middle_03_r',
  'ring_01_r', 'ring_02_r', 'ring_03_r',
  'pinky_01_r', 'pinky_02_r', 'pinky_03_r',
]);

function eulerToQuatArray(rx: number, ry: number, rz: number): [number, number, number, number] {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  return [q.x, q.y, q.z, q.w];
}

function buildClipFromSampler(
  name: string,
  duration: number,
  rig: CharacterRig,
  sampleFn: (phase: number, time: number) => PoseSample,
  fps = 30
): THREE.AnimationClip {
  const steps = Math.max(12, Math.round(duration * fps));
  const times: number[] = [];
  const samples: PoseSample[] = [];
  const boneSet = new Set<string>();
  const morphSet = new Set<string>();

  for (let i = 0; i <= steps; i++) {
    const phase = i / steps;
    const t = phase * duration;
    times.push(t);
    const s = sampleFn(phase, t);
    // Normalize all bone keys to canonical UE5 snake_case names
    const normalizedRot: Record<string, [number, number, number]> = {};
    for (const [k, v] of Object.entries(s.rot)) {
      const canonical = resolveBoneName(k);
      normalizedRot[canonical] = v;
      boneSet.add(canonical);
    }
    s.rot = normalizedRot;
    if (s.morphs) {
      for (const m of Object.keys(s.morphs)) morphSet.add(m);
    }
    samples.push(s);
  }

  const tracks: THREE.KeyframeTrack[] = [];

  // Pelvis position track
  const pelvisRest = rig.getBone('pelvis')!.position.clone();
  const posValues: number[] = [];
  let hasPosDelta = false;
  for (const s of samples) {
    const off = s.pelvisOffset ?? [0, 0, 0];
    if (off[0] !== 0 || off[1] !== 0 || off[2] !== 0) hasPosDelta = true;
    posValues.push(pelvisRest.x + off[0], pelvisRest.y + off[1], pelvisRest.z + off[2]);
  }
  if (hasPosDelta) {
    tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, posValues));
  }

  // Bone quaternion tracks at 30 fps
  for (const boneName of boneSet) {
    const values: number[] = [];
    for (const s of samples) {
      const e = s.rot[boneName] ?? [0, 0, 0];
      const q = eulerToQuatArray(e[0], e[1], e[2]);
      values.push(q[0], q[1], q[2], q[3]);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
  }

  // Morph tracks strictly on SK_Head
  for (const morphName of morphSet) {
    const values: number[] = [];
    for (const s of samples) {
      values.push(s.morphs?.[morphName] ?? 0);
    }
    tracks.push(
      new THREE.NumberKeyframeTrack(`SK_Head.morphTargetInfluences[${morphName}]`, times, values)
    );
  }

  return new THREE.AnimationClip(name, duration, tracks);
}

/**
 * Helper to create natural relaxed finger curl in canonical UE5 Finger_Humanoid names
 */
function addFingerCurl(
  rot: Record<string, [number, number, number]>,
  side: 'l' | 'r',
  curl: number,
  thumbCurl = curl * 0.65
): void {
  const s = side === 'l' ? 1 : -1;
  rot[`thumb_01_${side}`] = [0.22 * thumbCurl, -0.35 * s * thumbCurl, -0.25 * s * thumbCurl];
  rot[`thumb_02_${side}`] = [0.18 * thumbCurl, -0.25 * s * thumbCurl, -0.22 * s * thumbCurl];
  rot[`thumb_03_${side}`] = [0.14 * thumbCurl, -0.20 * s * thumbCurl, -0.18 * s * thumbCurl];
  for (const f of ['index', 'middle', 'ring', 'pinky'] as const) {
    const mult = f === 'index' ? 0.85 : f === 'middle' ? 1.0 : f === 'ring' ? 1.12 : 1.22;
    rot[`${f}_01_${side}`] = [0, 0, -0.45 * s * curl * mult];
    rot[`${f}_02_${side}`] = [0, 0, -0.58 * s * curl * mult];
    rot[`${f}_03_${side}`] = [0, 0, -0.42 * s * curl * mult];
  }
}

/**
 * Extract ONLY upper-body tracks (`spine_02+`, arms, neck, head, fingers) from an aim clip
 * for masked skeletal animation layering during ADS movement/strafing.
 */
export function createMaskedUpperBodyClip(source: THREE.AnimationClip): THREE.AnimationClip {
  const upperTracks = source.tracks
    .filter((t) => {
      const bone = t.name.split('.')[0];
      return UPPER_BODY_BONES.has(bone) || bone === 'SK_Head';
    })
    .map((t) => t.clone());
  return new THREE.AnimationClip(`${source.name}_UpperMask`, source.duration, upperTracks);
}

/**
 * Extract ONLY lower-body locomotion tracks (`pelvis`, `spine_01`, legs, feet) from a locomotion clip
 * so strafing while holding ADS NEVER disturbs upper-body spine/weapon aim pitch!
 */
export function createMaskedLowerBodyClip(source: THREE.AnimationClip): THREE.AnimationClip {
  const lowerTracks = source.tracks
    .filter((t) => {
      const bone = t.name.split('.')[0];
      return !UPPER_BODY_BONES.has(bone) && bone !== 'SK_Head';
    })
    .map((t) => t.clone());
  return new THREE.AnimationClip(`${source.name}_LowerMask`, source.duration, lowerTracks);
}

export function createCharacterAnimations(rig: CharacterRig): THREE.AnimationClip[] {
  const clips: THREE.AnimationClip[] = [];

  // 1. Idle_Natural (breathing, subtle weight shift, micro-head scan & natural blink)
  clips.push(
    buildClipFromSampler('Idle_Natural', 3.6, rig, (p) => {
      const a = p * Math.PI * 2;
      const breath = Math.sin(a);
      const sway = Math.sin(a * 0.5);
      const blink =
        p > 0.72 && p < 0.78 ? Math.sin(((p - 0.72) / 0.06) * Math.PI) : 0;

      const rot: Record<string, [number, number, number]> = {
        pelvis: [0.02, sway * 0.03, sway * 0.015],
        spine_01: [0.01 + breath * 0.014, -sway * 0.02, 0],
        spine_02: [breath * 0.018, 0, 0],
        spine_03: [breath * 0.022, -sway * 0.02, 0],
        neck_01: [-0.02 - breath * 0.012, Math.sin(a) * 0.04, 0],
        head: [0.02 - breath * 0.01, Math.sin(a) * 0.05, Math.cos(a) * 0.015],
        clavicle_l: [0, 0, -0.04 + breath * 0.018],
        clavicle_r: [0, 0, 0.04 - breath * 0.018],
        upperarm_l: [0.08, 0.06, -1.24 - breath * 0.02],
        lowerarm_l: [0.14, 0.24, -0.10],
        hand_l: [0, 0.08, -0.06],
        upperarm_r: [0.08, -0.06, 1.24 + breath * 0.02],
        lowerarm_r: [0.14, -0.24, 0.10],
        hand_r: [0, -0.08, 0.06],
        thigh_l: [-0.04, 0.06, 0.03],
        calf_l: [0.07, 0, 0],
        foot_l: [-0.03, 0.05, -0.02],
        thigh_r: [-0.03, -0.07, -0.03],
        calf_r: [0.06, 0, 0],
        foot_r: [-0.03, -0.05, 0.02],
      };
      addFingerCurl(rot, 'l', 0.45);
      addFingerCurl(rot, 'r', 0.45);
      return {
        pelvisOffset: [sway * 0.008, -0.006 + breath * 0.004, 0],
        rot,
        morphs: { Blink_L: blink, Blink_R: blink, Brow_Focus: 0.14, Mouth_Smirk: 0.30 },
      };
    })
  );

  // 3. Walk_Casual_GTA
  clips.push(
    buildClipFromSampler('Walk_Casual_GTA', 1.05, rig, (p) => {
      const a = p * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const bob = Math.abs(Math.sin(a)) * 0.028 - 0.022;
      const rot: Record<string, [number, number, number]> = {
        pelvis: [0.04, -s * 0.09, s * 0.03],
        spine_01: [0.02, s * 0.05, -s * 0.02],
        spine_02: [0.02, s * 0.06, -s * 0.02],
        spine_03: [0.02, s * 0.08, 0],
        neck_01: [-0.02, -s * 0.06, 0],
        head: [-0.02, -s * 0.06, 0],
        upperarm_l: [0.08 - s * 0.34, 0.08, -1.26],
        lowerarm_l: [0.18 + Math.max(0, -s) * 0.28, 0.25, -0.08],
        upperarm_r: [0.08 + s * 0.34, -0.08, 1.26],
        lowerarm_r: [0.18 + Math.max(0, s) * 0.28, -0.25, 0.08],
        thigh_l: [-s * 0.44 - 0.04, 0.03, 0.02],
        calf_l: [Math.max(0.05, -c * 0.62 + 0.22), 0, 0],
        foot_l: [c * 0.22 - 0.05, 0, 0],
        thigh_r: [s * 0.44 - 0.04, -0.03, -0.02],
        calf_r: [Math.max(0.05, c * 0.62 + 0.22), 0, 0],
        foot_r: [-c * 0.22 - 0.05, 0, 0],
      };
      addFingerCurl(rot, 'l', 0.55);
      addFingerCurl(rot, 'r', 0.55);
      return { pelvisOffset: [s * 0.012, bob, 0], rot };
    })
  );

  // 3. Jog_Tactical
  clips.push(
    buildClipFromSampler('Jog_Tactical', 0.72, rig, (p) => {
      const a = p * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const bob = Math.abs(Math.sin(a)) * 0.055 - 0.045;
      const rot: Record<string, [number, number, number]> = {
        pelvis: [0.11, -s * 0.14, s * 0.04],
        spine_01: [0.07, s * 0.09, -s * 0.03],
        spine_02: [0.06, s * 0.09, -s * 0.02],
        spine_03: [0.05, s * 0.11, 0],
        neck_01: [-0.08, -s * 0.09, 0],
        head: [-0.09, -s * 0.08, 0],
        upperarm_l: [0.14 - s * 0.72, 0.14, -1.16],
        lowerarm_l: [0.55 + Math.max(0, -s) * 0.48, 0.55, -0.18],
        upperarm_r: [0.14 + s * 0.72, -0.14, 1.16],
        lowerarm_r: [0.55 + Math.max(0, s) * 0.48, -0.55, 0.18],
        thigh_l: [-s * 0.76 - 0.12, 0.02, 0.02],
        calf_l: [Math.max(0.10, -c * 1.12 + 0.42), 0, 0],
        foot_l: [c * 0.34 - 0.08, 0, 0],
        thigh_r: [s * 0.76 - 0.12, -0.02, -0.02],
        calf_r: [Math.max(0.10, c * 1.12 + 0.42), 0, 0],
        foot_r: [-c * 0.34 - 0.08, 0, 0],
      };
      addFingerCurl(rot, 'l', 0.85);
      addFingerCurl(rot, 'r', 0.85);
      return {
        pelvisOffset: [s * 0.016, bob, 0.015],
        rot,
        morphs: { Brow_Focus: 0.38 },
      };
    })
  );

  // 5. Sprint_Combat — Tactical Low-Ready Carry (ZERO chest clipping!)
  // Arms project forward (hand_r forward clearance Z >= +0.28m from spine_03), muzzle pitched -0.45 rad down-left
  clips.push(
    buildClipFromSampler('Sprint_Combat', 0.56, rig, (p) => {
      const a = p * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const bob = Math.abs(Math.sin(a)) * 0.056 - 0.058;
      const carryOsc = Math.sin(a * 2) * 0.04;
      const rot: Record<string, [number, number, number]> = {
        pelvis: [0.15, -s * 0.14, s * 0.035],
        spine_01: [0.08, s * 0.06, -s * 0.02],
        spine_02: [0.06, s * 0.05, 0],
        spine_03: [0.05, -0.08 + s * 0.04, 0],
        neck_01: [-0.12, 0.05, 0],
        head: [-0.14, 0.04, 0],
        // Low-ready forward-clear tactical rifle carry: elbows clear of torso, hands well forward of chest
        clavicle_r: [0.06, -0.14, 0.05],
        upperarm_r: [-0.46 + carryOsc, -0.68, 0.76],
        lowerarm_r: [0.22, -0.78, 0.24],
        hand_r: [-0.32, 0.22, 0.12],
        clavicle_l: [0.08, 0.16, -0.04],
        upperarm_l: [-0.52 - carryOsc, 0.86, -0.72],
        lowerarm_l: [0.28, 0.66, -0.18],
        hand_l: [-0.20, -0.16, -0.10],
        thigh_l: [-s * 0.88 - 0.16, 0.02, 0.02],
        calf_l: [Math.max(0.12, -c * 1.24 + 0.48), 0, 0],
        foot_l: [c * 0.36 - 0.08, 0, 0],
        thigh_r: [s * 0.88 - 0.16, -0.02, -0.02],
        calf_r: [Math.max(0.12, c * 1.24 + 0.48), 0, 0],
        foot_r: [-c * 0.36 - 0.08, 0, 0],
      };
      addFingerCurl(rot, 'l', 0.92);
      addFingerCurl(rot, 'r', 0.92);
      return {
        pelvisOffset: [s * 0.014, bob, 0.028],
        rot,
        morphs: { Brow_Focus: 0.52, Mouth_Grit_Fire: 0.32 },
      };
    })
  );

  // 5. Crouch_Idle
  clips.push(
    buildClipFromSampler('Crouch_Idle', 2.6, rig, (p) => {
      const a = p * Math.PI * 2;
      const breath = Math.sin(a);
      const rot: Record<string, [number, number, number]> = {
        pelvis: [0.26, 0.14, 0],
        spine_01: [0.10 + breath * 0.015, -0.06, 0],
        spine_02: [0.09 + breath * 0.018, -0.06, 0],
        spine_03: [0.06 + breath * 0.02, -0.05, 0],
        neck_01: [-0.18, 0.04, 0],
        head: [-0.22, 0.06 + Math.sin(a * 0.5) * 0.05, 0],
        upperarm_l: [-0.36, 0.48, -0.96],
        lowerarm_l: [0.35, 0.64, -0.12],
        upperarm_r: [-0.42, -0.44, 0.94],
        lowerarm_r: [0.38, -0.64, 0.12],
        thigh_l: [-1.12, 0.24, 0.14],
        calf_l: [1.62, 0, 0],
        foot_l: [-0.50, 0, 0],
        thigh_r: [-0.94, -0.20, -0.12],
        calf_r: [1.56, 0, 0],
        foot_r: [-0.62, 0, 0],
      };
      addFingerCurl(rot, 'l', 0.72);
      addFingerCurl(rot, 'r', 0.72);
      return {
        pelvisOffset: [0, -0.34 + breath * 0.008, 0.02],
        rot,
        morphs: { Brow_Focus: 0.45 },
      };
    })
  );

  // 7. Crouch_Walk
  clips.push(
    buildClipFromSampler('Crouch_Walk', 1.15, rig, (p) => {
      const a = p * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const rot: Record<string, [number, number, number]> = {
        pelvis: [0.24, -s * 0.09, s * 0.03],
        spine_01: [0.10, s * 0.05, 0],
        spine_02: [0.08, s * 0.05, 0],
        spine_03: [0.06, s * 0.05, 0],
        neck_01: [-0.18, -s * 0.04, 0],
        head: [-0.20, -s * 0.04, 0],
        upperarm_l: [-0.36 - s * 0.14, 0.52, -0.92],
        lowerarm_l: [0.36, 0.68, -0.10],
        upperarm_r: [-0.42 + s * 0.14, -0.46, 0.92],
        lowerarm_r: [0.38, -0.68, 0.10],
        thigh_l: [-0.98 - s * 0.36, 0.14, 0.08],
        calf_l: [1.46 + Math.max(0, -c) * 0.34, 0, 0],
        foot_l: [-0.48 + c * 0.16, 0, 0],
        thigh_r: [-0.98 + s * 0.36, -0.14, -0.08],
        calf_r: [1.46 + Math.max(0, c) * 0.34, 0, 0],
        foot_r: [-0.48 - c * 0.16, 0, 0],
      };
      addFingerCurl(rot, 'l', 0.78);
      addFingerCurl(rot, 'r', 0.78);
      return {
        pelvisOffset: [s * 0.015, -0.32 + Math.abs(s) * 0.025, 0.02],
        rot,
      };
    })
  );

  // 7. Jump_Action
  clips.push(
    buildClipFromSampler('Jump_Action', 1.0, rig, (p) => {
      let yOff = 0;
      let kneeBend = 0.12;
      let hipFlex = -0.1;
      let torsoLean = 0.08;
      if (p < 0.22) {
        const t = Math.sin((p / 0.22) * Math.PI * 0.5);
        yOff = -0.18 * t;
        kneeBend = 0.12 + 0.92 * t;
        hipFlex = -0.1 - 0.65 * t;
        torsoLean = 0.08 + 0.22 * t;
      } else if (p < 0.72) {
        const t = (p - 0.22) / 0.5;
        const arc = Math.sin(t * Math.PI);
        yOff = -0.06 + arc * 0.36;
        kneeBend = 0.65 * arc + 0.25;
        hipFlex = -0.58 * arc - 0.18;
        torsoLean = 0.14 - 0.08 * arc;
      } else {
        const t = (p - 0.72) / 0.28;
        const absorb = Math.sin(t * Math.PI);
        yOff = -0.22 * absorb;
        kneeBend = 0.14 + 1.02 * absorb;
        hipFlex = -0.12 - 0.68 * absorb;
        torsoLean = 0.08 + 0.24 * absorb;
      }
      const rot: Record<string, [number, number, number]> = {
        pelvis: [torsoLean * 0.6, 0, 0],
        spine_01: [torsoLean * 0.35, 0, 0],
        spine_02: [torsoLean * 0.3, 0, 0],
        spine_03: [torsoLean * 0.25, 0, 0],
        neck_01: [-torsoLean * 0.5, 0, 0],
        head: [-torsoLean * 0.45, 0, 0],
        upperarm_l: [-0.28, 0.32, -0.82],
        lowerarm_l: [0.35, 0.54, -0.15],
        upperarm_r: [-0.28, -0.32, 0.82],
        lowerarm_r: [0.35, -0.54, 0.15],
        thigh_l: [hipFlex, 0.08, 0.05],
        calf_l: [kneeBend, 0, 0],
        foot_l: [-kneeBend * 0.35, 0, 0],
        thigh_r: [hipFlex * 0.9, -0.08, -0.05],
        calf_r: [kneeBend * 0.94, 0, 0],
        foot_r: [-kneeBend * 0.32, 0, 0],
      };
      addFingerCurl(rot, 'l', 0.8);
      addFingerCurl(rot, 'r', 0.8);
      return { pelvisOffset: [0, yOff, 0], rot };
    })
  );

  // 9. Strafe_Left (clean level upper-body posture, crisp lateral step cadence)
  clips.push(
    buildClipFromSampler('Strafe_Left', 0.85, rig, (p) => {
      const a = p * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const rot: Record<string, [number, number, number]> = {
        pelvis: [0.07, -0.14 + s * 0.06, -0.03 + s * 0.03],
        spine_01: [0.02, 0.06, 0.02],
        spine_02: [0.01, 0.05, 0.01],
        spine_03: [0.01, 0.06, 0.0],
        neck_01: [-0.03, -0.04, 0],
        head: [-0.03, -0.03, 0],
        upperarm_l: [-0.52, 0.68, -0.78],
        lowerarm_l: [0.42, 0.72, -0.16],
        upperarm_r: [-0.56, -0.58, 0.76],
        lowerarm_r: [0.48, -0.76, 0.16],
        thigh_l: [-0.26 - Math.max(0, s) * 0.24, 0.10, 0.14 + s * 0.26],
        calf_l: [0.46 + Math.max(0, -c) * 0.38, 0, 0],
        foot_l: [-0.20, 0, -s * 0.14],
        thigh_r: [-0.26 - Math.max(0, -s) * 0.24, -0.10, -0.10 + s * 0.24],
        calf_r: [0.46 + Math.max(0, c) * 0.38, 0, 0],
        foot_r: [-0.20, 0, -s * 0.14],
      };
      addFingerCurl(rot, 'l', 0.85);
      addFingerCurl(rot, 'r', 0.85);
      return {
        pelvisOffset: [s * 0.024, -0.075 + Math.abs(s) * 0.022, 0],
        rot,
        morphs: { Brow_Focus: 0.46 },
      };
    })
  );

  // 9. Strafe_Right (clean level upper-body posture, crisp lateral step cadence)
  clips.push(
    buildClipFromSampler('Strafe_Right', 0.85, rig, (p) => {
      const a = p * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const rot: Record<string, [number, number, number]> = {
        pelvis: [0.07, 0.14 - s * 0.06, 0.03 - s * 0.03],
        spine_01: [0.02, -0.06, -0.02],
        spine_02: [0.01, -0.05, -0.01],
        spine_03: [0.01, -0.06, 0.0],
        neck_01: [-0.03, 0.04, 0],
        head: [-0.03, 0.03, 0],
        upperarm_l: [-0.52, 0.68, -0.78],
        lowerarm_l: [0.42, 0.72, -0.16],
        upperarm_r: [-0.56, -0.58, 0.76],
        lowerarm_r: [0.48, -0.76, 0.16],
        thigh_l: [-0.26 - Math.max(0, -s) * 0.24, 0.10, 0.10 - s * 0.24],
        calf_l: [0.46 + Math.max(0, c) * 0.38, 0, 0],
        foot_l: [-0.20, 0, s * 0.14],
        thigh_r: [-0.26 - Math.max(0, s) * 0.24, -0.10, -0.14 - s * 0.26],
        calf_r: [0.46 + Math.max(0, -c) * 0.38, 0, 0],
        foot_r: [-0.20, 0, s * 0.14],
      };
      addFingerCurl(rot, 'l', 0.85);
      addFingerCurl(rot, 'r', 0.85);
      return {
        pelvisOffset: [-s * 0.024, -0.075 + Math.abs(s) * 0.022, 0],
        rot,
        morphs: { Brow_Focus: 0.46 },
      };
    })
  );

  // 10. Combat_Aim_Stance (upright neck, disciplined shoulder cheek-weld, steady rifle sight line)
  clips.push(
    buildClipFromSampler('Combat_Aim_Stance', 2.4, rig, (p) => {
      const a = p * Math.PI * 2;
      const breath = Math.sin(a);
      const rot: Record<string, [number, number, number]> = {
        pelvis: [0.06, -0.22, 0.01],
        spine_01: [0.03, 0.08, 0],
        spine_02: [0.03 + breath * 0.008, 0.09, 0],
        spine_03: [0.02 + breath * 0.010, 0.10, -0.02],
        // Upright forward-facing neck & head (never twisted backward!)
        neck_01: [-0.02, -0.05, 0.03],
        head: [-0.03, -0.04, 0.04],
        clavicle_r: [0.04, -0.10, 0.02],
        upperarm_r: [-0.72, -0.52, 0.56],
        lowerarm_r: [0.28, -1.04, 0.18],
        hand_r: [-0.08, 0.14, 0.08],
        clavicle_l: [0.06, 0.14, -0.02],
        upperarm_l: [-0.74, 0.88, -0.52],
        lowerarm_l: [0.24, 0.68, -0.14],
        hand_l: [0.06, -0.12, -0.08],
        thigh_l: [-0.26, 0.16, 0.08],
        calf_l: [0.40, 0, 0],
        foot_l: [-0.14, 0.08, 0],
        thigh_r: [0.14, -0.16, -0.08],
        calf_r: [0.24, 0, 0],
        foot_r: [-0.20, -0.14, 0],
      };
      addFingerCurl(rot, 'l', 0.88);
      addFingerCurl(rot, 'r', 0.90);
      rot['index_01_r'] = [0, 0, 0.14];
      rot['index_02_r'] = [0, 0, 0.32];
      rot['index_03_r'] = [0, 0, 0.28];
      return {
        pelvisOffset: [0, -0.055 + breath * 0.004, 0],
        rot,
        morphs: { Brow_Focus: 0.72 },
      };
    })
  );

  // 11. Combat_Fire_Burst (3-round shoulder recoil pulse + amplified Mouth_Grit_Fire morph!)
  clips.push(
    buildClipFromSampler('Combat_Fire_Burst', 0.65, rig, (p) => {
      const burstPulse =
        Math.pow(Math.max(0, Math.sin(p * Math.PI * 3)), 3) * (p < 0.78 ? 1.0 : 0.2);
      const kick = burstPulse * 0.085;
      const rot: Record<string, [number, number, number]> = {
        pelvis: [0.07 - kick * 0.2, -0.22, 0.01],
        spine_01: [0.03 - kick * 0.4, 0.08, 0],
        spine_02: [0.02 - kick * 0.65, 0.09, 0],
        spine_03: [0.02 - kick * 0.85, 0.10, -0.02],
        neck_01: [-0.02 + kick * 0.45, -0.05, 0.03],
        head: [-0.03 + kick * 0.40, -0.04, 0.04],
        clavicle_r: [0.04 - kick * 0.8, -0.10, 0.02],
        upperarm_r: [-0.74 - kick * 1.1, -0.52, 0.56],
        lowerarm_r: [0.28, -1.04, 0.18],
        hand_r: [-0.08 - kick * 0.5, 0.14, 0.08],
        clavicle_l: [0.06 - kick * 0.5, 0.14, -0.02],
        upperarm_l: [-0.76 - kick * 0.9, 0.88, -0.52],
        lowerarm_l: [0.24, 0.68, -0.14],
        hand_l: [0.06, -0.12, -0.08],
        thigh_l: [-0.28, 0.16, 0.08],
        calf_l: [0.42, 0, 0],
        foot_l: [-0.14, 0.08, 0],
        thigh_r: [0.15, -0.16, -0.08],
        calf_r: [0.25, 0, 0],
        foot_r: [-0.20, -0.14, 0],
      };
      addFingerCurl(rot, 'l', 0.92);
      addFingerCurl(rot, 'r', 0.94);
      rot['index_01_r'] = [0, 0, 0.30 + burstPulse * 0.25];
      rot['index_02_r'] = [0, 0, 0.55 + burstPulse * 0.30];
      rot['index_03_r'] = [0, 0, 0.44 + burstPulse * 0.24];
      return {
        pelvisOffset: [0, -0.062, -kick * 0.14],
        rot,
        morphs: {
          Brow_Focus: 0.85,
          Mouth_Grit_Fire: 0.55 + burstPulse * 0.45,
          Nostril_Flare: 0.32 + burstPulse * 0.35,
        },
      };
    })
  );

  return clips;
}
