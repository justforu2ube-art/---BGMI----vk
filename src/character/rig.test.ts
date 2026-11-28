import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createCharacterRig,
  getHandBasis,
  skinSmoothToBones,
} from './rig';
import { ANIMATION_NAMES, createCharacterAnimations } from './animations';
import {
  computeAimPitchDistribution,
  createInitialControllerState,
  InputState,
  stepCombatController,
  stepWeaponIndex,
  WheelStepDebouncer,
} from './controllerMath';
import {
  computeAnalyticalBlinkArc,
  EYE_L_CENTER,
  EYEBALL_RADIUS,
  EYELID_ARC_RADIUS,
} from './headSculpt';
import { ensureChestClearance } from '../weapons/weaponIK';

test('character rig creates full 63-bone UE5 IK_Mannequin skeleton with twist bones, sockets, and legacy aliases', () => {
  const rig = createCharacterRig();
  assert.equal(rig.rootBone.name, 'root');
  assert.ok(rig.bones.length >= 62, `Expected >= 62 UE5 bones, got ${rig.bones.length}`);
  assert.equal(rig.bones.length, 63);

  const requiredUE5 = [
    'root',
    'pelvis',
    'spine_01',
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
    'thumb_01_l',
    'thumb_03_l',
    'index_01_l',
    'index_03_l',
    'pinky_03_r',
    'thigh_l',
    'thigh_twist_01_l',
    'calf_l',
    'calf_twist_01_l',
    'foot_l',
    'ball_l',
    'thigh_r',
    'thigh_twist_01_r',
    'calf_r',
    'calf_twist_01_r',
    'foot_r',
    'ball_r',
    'ik_hand_root',
    'ik_foot_root',
  ];
  for (const b of requiredUE5) {
    assert.ok(rig.boneMap.has(b), `Missing UE5 bone ${b}`);
  }

  // Verify legacy PascalCase alias compatibility
  for (const alias of ['Root', 'Pelvis', 'Chest', 'Neck', 'Head', 'Forearm_L', 'Hand_R']) {
    assert.ok(rig.boneMap.has(alias), `Missing legacy alias ${alias}`);
  }

  // Verify named UE5 attachment sockets
  assert.ok(rig.sockets.hand_r_weapon, 'Missing hand_r_weapon socket');
  assert.ok(rig.sockets.thigh_holster_socket, 'Missing thigh_holster_socket');

  // Verify symmetrical head/eye elevation
  const headPos = rig.bindWorldPos.get('head')!;
  assert.ok(headPos.y > 1.60 && headPos.y < 1.72);
});

test('skinSmoothToBones stores Uint16BufferAttribute skinIndex and normalizes <= 4 weights to 1.0000', () => {
  const rig = createCharacterRig();
  const geo = new THREE.BufferGeometry();
  const pts = new Float32Array([
    0, 1.40, 0.12, // chest
    0.38, 1.25, 0.0, // left elbow
    -0.11, 0.49, 0.01, // right knee
    0.116, 0.02, 0.12, // left boot toe
    0, 1.72, 0.09, // face
  ]);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  skinSmoothToBones(geo, rig);

  const idxAttr = geo.attributes.skinIndex;
  const wAttr = geo.attributes.skinWeight;
  assert.ok(
    idxAttr instanceof THREE.Uint16BufferAttribute,
    'skinIndex must use Uint16BufferAttribute for UE5 glTF 2.0 compliance'
  );
  assert.equal(idxAttr.itemSize, 4);
  assert.equal(wAttr.itemSize, 4);

  for (let i = 0; i < idxAttr.count; i++) {
    const sum = wAttr.getX(i) + wAttr.getY(i) + wAttr.getZ(i) + wAttr.getW(i);
    assert.ok(
      Math.abs(sum - 1.0) < 1e-4,
      `Vertex ${i} weights must sum to 1.0, got ${sum}`
    );
    assert.ok(wAttr.getX(i) >= 0 && wAttr.getY(i) >= 0 && wAttr.getZ(i) >= 0 && wAttr.getW(i) >= 0);
  }
});

test('createCharacterAnimations generates all 11 biomechanical clips with Mouth_Grit_Fire morph track', () => {
  const rig = createCharacterRig();
  const clips = createCharacterAnimations(rig);
  assert.equal(clips.length, ANIMATION_NAMES.length);

  for (const name of ANIMATION_NAMES) {
    const clip = clips.find((c) => c.name === name);
    assert.ok(clip, `Missing clip ${name}`);
    assert.ok(clip.duration > 0.4, `Clip ${name} duration too short`);
    assert.ok(clip.tracks.length >= 10, `Clip ${name} has too few bone tracks`);
  }

  const fireClip = clips.find((c) => c.name === 'Combat_Fire_Burst')!;
  assert.ok(
    fireClip.tracks.some((t) => t.name.includes('morphTargetInfluences[Mouth_Grit_Fire]')),
    'Combat_Fire_Burst must animate Mouth_Grit_Fire morph target'
  );
});

test('computeAimPitchDistribution clamps to [-0.55, +0.55] and distributes [0.25, 0.35, 0.20, 0.20]', () => {
  const up = computeAimPitchDistribution(1.2);
  assert.equal(up.clampedPitch, 0.55);
  assert.ok(Math.abs(up.spine_02 - 0.55 * 0.25) < 1e-6);
  assert.ok(Math.abs(up.spine_03 - 0.55 * 0.35) < 1e-6);
  assert.ok(Math.abs(up.neck_01 - 0.55 * 0.20) < 1e-6);
  assert.ok(Math.abs(up.head - 0.55 * 0.20) < 1e-6);
  assert.ok(
    Math.abs(up.spine_02 + up.spine_03 + up.neck_01 + up.head - up.clampedPitch) < 1e-6
  );

  const down = computeAimPitchDistribution(-0.95);
  assert.equal(down.clampedPitch, -0.55);
  assert.ok(down.head < 0);
});

test('combat controller locks characterYaw to cameraYaw for armed A/D strafe and handles Sprint/Fire/Jump', () => {
  const state = createInitialControllerState();
  const baseInput: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    crouch: false,
    aim: false,
    jumpPressed: false,
    firePressed: false,
    isArmed: true,
  };

  // Idle
  stepCombatController(state, baseInput, 0, 0, 0.016);
  assert.equal(state.activeClip, 'Idle_Natural');

  // Armed Strafe Left (A key without holding RMB) locks yaw to cameraYaw = 0 and selects Strafe_Left
  for (let i = 0; i < 18; i++) {
    stepCombatController(state, { ...baseInput, left: true }, 0, 0, 0.02);
  }
  assert.equal(state.activeClip, 'Strafe_Left');
  assert.ok(Math.abs(state.yaw) < 0.08, `Armed strafe must keep yaw locked to cameraYaw, got ${state.yaw}`);

  // Armed Strafe Right (D key)
  for (let i = 0; i < 18; i++) {
    stepCombatController(state, { ...baseInput, right: true }, 0, 0, 0.02);
  }
  assert.equal(state.activeClip, 'Strafe_Right');

  // Sprint forward
  for (let i = 0; i < 40; i++) {
    stepCombatController(state, { ...baseInput, forward: true, sprint: true }, 0, 0, 0.02);
  }
  assert.equal(state.activeClip, 'Sprint_Combat');
  assert.ok(state.posZ > 1.0);

  // Stop & Aim + Fire
  state.speed = 0;
  const fireRes = stepCombatController(
    state,
    { ...baseInput, aim: true, firePressed: true },
    0,
    0.1,
    0.016
  );
  assert.equal(fireRes.firedThisStep, true);
  assert.equal(state.activeClip, 'Combat_Fire_Burst');
  assert.ok(state.recoilAmount > 0.2);

  // Jump & land back on Y=0
  state.recoilAmount = 0;
  state.muzzleFlashTimer = 0;
  const jumpRes = stepCombatController(
    state,
    { ...baseInput, jumpPressed: true },
    0,
    0,
    0.016
  );
  assert.equal(jumpRes.jumpedThisStep, true);
  assert.equal(state.isGrounded, false);
  for (let i = 0; i < 80; i++) {
    stepCombatController(state, baseInput, 0, 0, 0.02);
  }
  assert.equal(state.isGrounded, true);
  assert.equal(state.posY, 0);
});

test('WheelStepDebouncer accumulates deltaY >= 40 with 150ms cooldown and steps strictly ±1 mod 5', () => {
  const debouncer = new WheelStepDebouncer(40, 150);

  // Below threshold does not trigger
  assert.equal(debouncer.consume(15, 1000), 0);
  assert.equal(debouncer.consume(20, 1010), 0);
  // Crosses threshold -> +1
  assert.equal(debouncer.consume(10, 1020), 1);
  // Rapid events inside 150ms cooldown are blocked (zero skipped slots)
  assert.equal(debouncer.consume(120, 1050), 0);
  assert.equal(debouncer.consume(120, 1150), 0);
  // After 150ms cooldown -> triggers cleanly
  assert.equal(debouncer.consume(-45, 1200), -1);

  assert.equal(stepWeaponIndex(0, -1, 5), 4);
  assert.equal(stepWeaponIndex(4, 1, 5), 0);
  assert.equal(stepWeaponIndex(2, 1, 5), 3);
});

test('computeAnalyticalBlinkArc closes upper (-0.68 rad) and lower (+0.20 rad) eyelids flush along eyeball arc', () => {
  const upperMargin = new THREE.Vector3(
    EYE_L_CENTER.x,
    EYE_L_CENTER.y + Math.sin(0.66) * EYELID_ARC_RADIUS,
    EYE_L_CENTER.z + Math.cos(0.66) * EYELID_ARC_RADIUS
  );
  const lowerMargin = new THREE.Vector3(
    EYE_L_CENTER.x,
    EYE_L_CENTER.y + Math.sin(-0.22) * EYELID_ARC_RADIUS,
    EYE_L_CENTER.z + Math.cos(-0.22) * EYELID_ARC_RADIUS
  );

  const upperClosed = computeAnalyticalBlinkArc(upperMargin, EYE_L_CENTER, true, 1.0);
  const lowerClosed = computeAnalyticalBlinkArc(lowerMargin, EYE_L_CENTER, false, 1.0);

  // Closed eyelids meet cleanly around the eye equator (within 0.6mm) and stay outside eyeball radius
  assert.ok(Math.abs(upperClosed.y - lowerClosed.y) < 0.0006);
  assert.ok(upperClosed.distanceTo(EYE_L_CENTER) >= EYEBALL_RADIUS + 0.0012);
  assert.ok(lowerClosed.distanceTo(EYE_L_CENTER) >= EYEBALL_RADIUS + 0.0012);
});

test('ensureChestClearance clamps Sprint_Combat hand_r forward clearance to Z >= +0.28m', () => {
  const pos = new THREE.Vector3(-0.08, -0.05, 0.14);
  ensureChestClearance(pos, 1.0, 0.28);
  assert.ok(pos.z >= 0.28 - 1e-6, `Expected forward clearance >= 0.28m, got ${pos.z}`);
});

test('getHandBasis builds orthonormal bilaterally mirrored left/right wrist frames', () => {
  const rig = createCharacterRig();
  const basisL = getHandBasis('L');
  const basisR = getHandBasis('R');

  // Orthonormality checks
  assert.ok(Math.abs(basisL.along.length() - 1) < 1e-5);
  assert.ok(Math.abs(basisL.forward.length() - 1) < 1e-5);
  assert.ok(Math.abs(basisL.out.length() - 1) < 1e-5);
  assert.ok(Math.abs(basisL.along.dot(basisL.forward)) < 1e-5);
  assert.ok(Math.abs(basisL.along.dot(basisL.out)) < 1e-5);
  assert.ok(Math.abs(basisL.along.x + basisR.along.x) < 1e-5);

  // Exact L/R bilateral mirror symmetry across X=0
  const handL = rig.bindWorldPos.get('hand_l')!;
  const handR = rig.bindWorldPos.get('hand_r')!;
  assert.ok(Math.abs(handL.x + handR.x) < 1e-5);
  assert.ok(Math.abs(handL.y - handR.y) < 1e-5);
  assert.ok(Math.abs(handL.z - handR.z) < 1e-5);
});
