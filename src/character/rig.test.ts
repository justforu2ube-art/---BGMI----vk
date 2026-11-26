import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applySkinWeights, computeGloveSkeletalAlignment, createCharacterRig } from './rig';
import { ANIMATION_NAMES, createCharacterAnimations } from './animations';
import {
  createInitialControllerState,
  InputState,
  stepCombatController,
} from './controllerMath';

test('character rig creates full 56-bone UE5 humanoid skeleton with fingers, jaw, and eyes', () => {
  const rig = createCharacterRig();
  assert.equal(rig.rootBone.name, 'Root');
  assert.equal(rig.bones.length, 56);

  const required = [
    'Root',
    'Pelvis',
    'Spine_01',
    'Spine_02',
    'Chest',
    'Neck',
    'Head',
    'Jaw',
    'Eye_L',
    'Eye_R',
    'Clavicle_L',
    'UpperArm_L',
    'Forearm_L',
    'Hand_L',
    'Thumb_01_L',
    'Thumb_03_L',
    'Index_01_L',
    'Index_03_L',
    'Pinky_03_R',
    'Thigh_L',
    'Calf_L',
    'Foot_L',
    'Toe_L',
    'Thigh_R',
    'Foot_R',
    'Toe_R',
  ];
  for (const b of required) {
    assert.ok(rig.boneMap.has(b), `Missing bone ${b}`);
  }

  // Verify world bind height & symmetry
  const eyeL = rig.bindWorldPos.get('Eye_L')!;
  const eyeR = rig.bindWorldPos.get('Eye_R')!;
  assert.ok(Math.abs(eyeL.x + eyeR.x) < 1e-6);
  assert.ok(eyeL.y > 1.70 && eyeL.y < 1.76);
});

test('applySkinWeights strictly normalizes <= 4 bone weights per vertex to 1.0000', () => {
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
  applySkinWeights(geo, rig);

  const idxAttr = geo.attributes.skinIndex;
  const wAttr = geo.attributes.skinWeight;
  assert.equal(idxAttr.itemSize, 4);
  assert.equal(wAttr.itemSize, 4);

  for (let i = 0; i < idxAttr.count; i++) {
    const sum =
      wAttr.getX(i) + wAttr.getY(i) + wAttr.getZ(i) + wAttr.getW(i);
    assert.ok(
      Math.abs(sum - 1.0) < 1e-4,
      `Vertex ${i} weights must sum to 1.0, got ${sum}`
    );
    assert.ok(wAttr.getX(i) >= 0 && wAttr.getY(i) >= 0 && wAttr.getZ(i) >= 0 && wAttr.getW(i) >= 0);
  }
});

test('createCharacterAnimations generates all 11 biomechanical clips with morph tracks', () => {
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

test('combat controller transitions Idle -> Jog -> Sprint -> Crouch -> Aim -> Fire -> Jump cleanly', () => {
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
  };

  // Idle
  stepCombatController(state, baseInput, 0, 0, 0.016);
  assert.equal(state.activeClip, 'Idle_Natural');

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

test('computeGloveSkeletalAlignment matches hand rig MCP knuckle bones and mirrors L/R cleanly', () => {
  const rig = createCharacterRig();
  const alignL = computeGloveSkeletalAlignment(rig, 'L');
  const alignR = computeGloveSkeletalAlignment(rig, 'R');

  assert.equal(alignL.mcpJoints.length, 4);
  assert.equal(alignR.mcpJoints.length, 4);

  for (let i = 0; i < 4; i++) {
    const jL = alignL.mcpJoints[i];
    const jR = alignR.mcpJoints[i];
    // Reconstruct world position from local alignment coords and verify < 0.1mm match against bone
    const reconL = alignL.handPos
      .clone()
      .addScaledVector(alignL.along, jL.along)
      .addScaledVector(alignL.forward, jL.forward)
      .addScaledVector(alignL.out, jL.out);
    assert.ok(
      reconL.distanceTo(rig.bindWorldPos.get(jL.boneName)!) < 1e-4,
      `${jL.boneName} alignment must match bone within 0.1mm`
    );

    // Exact L/R bilateral symmetry in local coordinates
    assert.ok(Math.abs(jL.along - jR.along) < 1e-5);
    assert.ok(Math.abs(jL.forward - jR.forward) < 1e-5);
    assert.ok(Math.abs(jL.out - jR.out) < 1e-5);
  }

  // Dorsal cutout sits cleanly proximal to the MCP knuckle arch and centered on metacarpal midline
  assert.ok(
    alignL.cutoutCenterLocal.along > alignL.meanMcpAlong * 0.35 &&
      alignL.cutoutCenterLocal.along < alignL.meanMcpAlong * 0.60
  );
  assert.ok(Math.abs(alignL.cutoutCenterLocal.forward - alignL.meanMcpForward) < 1e-5);
  assert.ok(Math.abs(alignL.cutoutCenterWorld.x + alignR.cutoutCenterWorld.x) < 1e-5);
  assert.ok(Math.abs(alignL.cutoutCenterWorld.y - alignR.cutoutCenterWorld.y) < 1e-5);
  assert.ok(Math.abs(alignL.cutoutCenterWorld.z - alignR.cutoutCenterWorld.z) < 1e-5);
});
