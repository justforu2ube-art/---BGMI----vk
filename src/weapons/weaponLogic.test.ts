import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createInitialWeaponCombatState,
  getReloadStage,
  startWeaponReload,
  stepWeaponMechanics,
  switchWeaponState,
  toggleWeaponFireMode,
  WEAPON_ORDER,
  WEAPON_SPECS,
} from './weaponTypes';
import { decomposeSwingTwist, solveTwoBoneAnalytical, WeaponIKController } from './weaponIK';
import { computeCasingBounce, stepCasingPhysics } from './combatFX';
import { selectShellPingClip } from './weaponAudio';
import {
  computeM870SaddleShellCount,
  computeVisibleSlotCount,
  getDisplayedMagRounds,
} from './weaponGeoHelpers';
import { createCharacterRig, getHandBasis } from '../character/rig';

test('all 5 tactical firearms define complete ballistic specs and unique slots 1..5', () => {
  assert.equal(WEAPON_ORDER.length, 5);
  const slots = WEAPON_ORDER.map((id) => WEAPON_SPECS[id].slot);
  assert.deepEqual(slots, [1, 2, 3, 4, 5]);
  assert.equal(WEAPON_SPECS.mk18.rpm, 800);
  assert.equal(WEAPON_SPECS.ak74m.rpm, 600);
  assert.equal(WEAPON_SPECS.m870.pellets, 8);
  assert.equal(WEAPON_SPECS.awm.magSize, 5);
  assert.equal(WEAPON_SPECS.glock19.magSize, 15);
});

test('MK18 and AK-74M toggle AUTO/SEMI while pump/bolt/pistol keep fixed fire mode', () => {
  const st = createInitialWeaponCombatState('mk18');
  assert.equal(st.ammo.mk18.fireMode, 'AUTO');
  assert.equal(toggleWeaponFireMode(st), 'SEMI');
  assert.equal(toggleWeaponFireMode(st), 'AUTO');

  switchWeaponState(st, 'ak74m');
  assert.equal(toggleWeaponFireMode(st), 'SEMI');

  switchWeaponState(st, 'm870');
  assert.equal(toggleWeaponFireMode(st), 'PUMP');

  switchWeaponState(st, 'awm');
  assert.equal(toggleWeaponFireMode(st), 'BOLT');
});

test('full-auto firing consumes ammo, kicks spring-damper recoil, and ejects brass casings', () => {
  const st = createInitialWeaponCombatState('mk18');
  const startMag = st.ammo.mk18.mag;
  const ev = stepWeaponMechanics(st, true, false, 0, 0.016, 0.7);
  assert.equal(ev.fired, true);
  assert.equal(ev.ejectCasing, true);
  assert.equal(st.ammo.mk18.mag, startMag - 1);
  assert.ok(st.recoilZ > 0, 'recoilZ must kick backward');
  assert.ok(st.recoilPitch > 0, 'recoilPitch must climb upward');
  assert.ok(st.boltTravel > 0.7, 'bolt should kick rearward immediately on shot');

  // Settle recoil smoothly over 0.6s without firing
  for (let i = 0; i < 40; i++) {
    stepWeaponMechanics(st, false, false, 0, 0.016, 0.5);
  }
  assert.ok(st.recoilZ < 0.004, 'recoilZ should damp back near rest');
  assert.ok(st.boltTravel < 0.01, 'bolt should return forward');
});

test('Glock 19 locks slide back on empty magazine and releases slide after reload', () => {
  const st = createInitialWeaponCombatState('glock19');
  st.ammo.glock19.mag = 1;
  const ev = stepWeaponMechanics(st, true, false, 0, 0.016, 0.5);
  assert.equal(ev.fired, true);
  assert.equal(st.ammo.glock19.mag, 0);
  assert.equal(st.slideLockedBack, true);

  // Advance frames — slide remains locked back at 1.0
  stepWeaponMechanics(st, false, false, 0, 0.05, 0.5);
  assert.equal(st.boltTravel, 1);

  // Trigger reload and step to completion
  assert.equal(startWeaponReload(st), true);
  let sawMagOut = false;
  let sawMagIn = false;
  let sawBoltRack = false;
  let completed = false;
  for (let i = 0; i < 120; i++) {
    const rev = stepWeaponMechanics(st, false, false, 0, 0.02, 0.5);
    if (rev.magOutSound) sawMagOut = true;
    if (rev.magInSound) sawMagIn = true;
    if (rev.boltRackSound) sawBoltRack = true;
    if (rev.reloadCompleted) completed = true;
  }
  assert.equal(sawMagOut, true);
  assert.equal(sawMagIn, true);
  assert.equal(sawBoltRack, true);
  assert.equal(completed, true);
  assert.equal(st.slideLockedBack, false);
  assert.equal(st.ammo.glock19.mag, 15);
});

test('AWM sniper performs delayed 60-degree bolt lift & pull cycle with .338 casing ejection', () => {
  const st = createInitialWeaponCombatState('awm');
  const fireEv = stepWeaponMechanics(st, true, true, 0, 0.016, 0.5);
  assert.equal(fireEv.fired, true);
  assert.equal(fireEv.ejectCasing, false, 'bolt-action should eject during manual bolt pull, not instant');
  assert.equal(st.cycleActive, true);

  let maxLift = 0;
  let maxTravel = 0;
  let ejected = false;
  for (let i = 0; i < 80; i++) {
    const ev = stepWeaponMechanics(st, false, true, 0, 0.02, 0.5);
    if (st.boltLift > maxLift) maxLift = st.boltLift;
    if (st.boltTravel > maxTravel) maxTravel = st.boltTravel;
    if (ev.ejectCasing) ejected = true;
  }
  assert.ok(maxLift > 0.9, 'bolt handle must lift full 60 degrees');
  assert.ok(maxTravel > 0.9, 'bolt must pull fully back');
  assert.equal(ejected, true, 'must eject .338 casing during bolt pull');
  assert.equal(st.cycleActive, false, 'bolt cycle should finish cleanly');
});

test('reload stage timeline maps cleanly across all 6 mechanical phases', () => {
  assert.equal(getReloadStage(0.05).stage, 'reach_mag');
  assert.equal(getReloadStage(0.24).stage, 'detach_mag');
  assert.equal(getReloadStage(0.45).stage, 'fetch_mag');
  assert.equal(getReloadStage(0.64).stage, 'insert_mag');
  assert.equal(getReloadStage(0.8).stage, 'rack_bolt');
  assert.equal(getReloadStage(0.95).stage, 'return_hand');
});

test('2-bone analytical IK solver reaches reachable targets with sub-millimeter precision', () => {
  const upperBind = new THREE.Vector3(0.184, -0.234, -0.016); // Left upper arm bind vector
  const foreBind = new THREE.Vector3(0.156, -0.203, 0.032); // Left forearm bind vector
  const target = new THREE.Vector3(-0.14, -0.18, 0.36);
  const pole = new THREE.Vector3(0.35, -0.3, -0.1);

  const res = solveTwoBoneAnalytical(upperBind, foreBind, target, pole);
  const elbowPos = upperBind.clone().applyQuaternion(res.upperLocalQuat);
  const foreWorld = foreBind
    .clone()
    .applyQuaternion(res.forearmLocalQuat)
    .applyQuaternion(res.upperLocalQuat);
  const handPos = elbowPos.clone().add(foreWorld);

  const err = handPos.distanceTo(target);
  assert.ok(err < 0.001, `2-bone IK hand error should be < 1mm, got ${(err * 1000).toFixed(3)}mm`);
});

test('casing bounce physics randomizes angular velocity, sustains micro-bounces, and maps impact-force ping clips', () => {
  const vel = { x: -1.6, y: -3.2, z: -0.4 };
  const ang = { x: 8, y: -6, z: 18 };

  const b9a = computeCasingBounce(vel, ang, 'brass_9mm', 0, 0.12, 0.2, 0.82);
  const b9b = computeCasingBounce(vel, ang, 'brass_9mm', 0, 0.88, 0.85, 0.15);
  const b762 = computeCasingBounce(vel, ang, 'brass_762', 0, 0.5, 0.5, 0.5);
  const b338 = computeCasingBounce(vel, ang, 'brass_338', 0, 0.5, 0.5, 0.5);

  assert.equal(b9a.shouldPing, true);
  assert.equal(b9a.pingClip, 'heavy_clatter');
  assert.equal(b762.pingClip, 'heavy_clatter');
  assert.equal(b338.pingClip, 'heavy_clatter');
  assert.notEqual(b9a.velZ, b9b.velZ, 'different random seeds must produce distinct scatter trajectories');
  assert.notEqual(b9a.angVelX, b9b.angVelX, 'impact must impart randomized angular velocity on X');
  assert.notEqual(b9a.angVelY, b9b.angVelY, 'impact must impart randomized angular velocity on Y');
  assert.notEqual(b9a.angVelZ, b9b.angVelZ, 'impact must impart randomized angular velocity on Z');
  assert.ok(b9a.velY > b762.velY && b762.velY > b338.velY, 'lighter 9mm should rebound higher than 7.62 and .338');

  // Medium secondary impact maps cleanly to medium_ping
  const med = computeCasingBounce({ x: -0.7, y: -1.35, z: 0.2 }, ang, 'brass_762', 1, 0.4, 0.6, 0.3);
  assert.equal(med.pingClip, 'medium_ping');
  assert.equal(med.isMicroBounce, false);
  assert.equal(med.settled, false);

  // Low-energy micro-bounce sustains hop + triggers delicate micro_tink audio clip
  const micro = computeCasingBounce({ x: -0.35, y: -0.42, z: 0.12 }, ang, 'brass_9mm', 2, 0.72, 0.55, 0.31);
  assert.equal(micro.isMicroBounce, true);
  assert.equal(micro.shouldPing, true);
  assert.equal(micro.pingClip, 'micro_tink');
  assert.ok(micro.velY > 0.065, 'micro-bounce should produce a subtle upward hop before settling');
  assert.equal(micro.settled, false);

  // 12-gauge shotgun hulls map to hull_thud / hull_skitter by impact force
  assert.equal(selectShellPingClip('hull_12g', 2.4), 'hull_thud');
  assert.equal(selectShellPingClip('hull_12g', 0.45), 'hull_skitter');

  // Settled casings past 5 bounces stop bouncing and do not spam audio
  const settled = computeCasingBounce({ x: -0.2, y: -0.1, z: 0.1 }, ang, 'brass_762', 5, 0.5, 0.5, 0.5);
  assert.equal(settled.shouldPing, false, 'settled casings past max bounces should not spam pings');
  assert.equal(settled.settled, true);
  assert.equal(settled.velY, 0);
});

test('stepCasingPhysics simulates ballistic flight, randomized bounce/spin, micro-bounces, and studio floor settle', () => {
  // Deterministic PRNG for repeatable physics verification
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const body = {
    posX: -0.1,
    posY: 1.42,
    posZ: 0.28,
    velX: -1.85,
    velY: 1.35,
    velZ: -0.42,
    rotX: 0.2,
    rotY: 0.4,
    rotZ: 1.2,
    angVelX: 10,
    angVelY: -8,
    angVelZ: 20,
    bounceCount: 0,
    casingType: 'brass_762' as const,
    floorY: 0.0065,
    settled: false,
  };

  const events: ReturnType<typeof stepCasingPhysics> = [];
  for (let i = 0; i < 160; i++) {
    events.push(...stepCasingPhysics(body, 0.02, rand));
  }

  assert.ok(events.length >= 3, `expected primary + secondary + micro-bounces, got ${events.length}`);
  assert.equal(events[0].pingClip, 'heavy_clatter', 'first drop impact from shoulder height must trigger heavy_clatter');
  assert.ok(
    events.some((e) => e.isMicroBounce && e.pingClip === 'micro_tink'),
    'simulation must progress through micro-bounces emitting micro_tink'
  );
  assert.equal(body.settled, true, 'casing must settle cleanly on studio floor plane');
  assert.equal(body.posY, body.floorY, 'settled casing must rest flush at floorY without tunneling');
  assert.ok(Math.abs(Math.abs(body.rotZ) - Math.PI / 2) < 0.05, 'settled cylinder should lie flat on studio floor');
});

test('decomposeSwingTwist factors q = twist * swing cleanly and forearm twist sharing keeps wrist position invariant', () => {
  const axis = new THREE.Vector3(0.6, -0.78, 0.14).normalize();
  const orthoAxis = new THREE.Vector3(0, 1, 0).cross(axis).normalize();
  const qTwistRef = new THREE.Quaternion().setFromAxisAngle(axis, 1.85);
  const qSwingRef = new THREE.Quaternion().setFromAxisAngle(orthoAxis, 0.42);
  const qCombined = qTwistRef.clone().multiply(qSwingRef).normalize();

  const { twist, swing, twistAngle } = decomposeSwingTwist(qCombined, axis);
  const recomposed = twist.clone().multiply(swing).normalize();
  assert.ok(Math.abs(recomposed.dot(qCombined)) > 0.99999, 'twist * swing must reconstruct input quaternion');
  assert.ok(Math.abs(twistAngle - 1.85) < 1e-5, `expected exact twistAngle 1.85, got ${twistAngle}`);

  // Verify solveArmWorld hits wrist target to < 1mm while transferring axial twist onto Forearm!
  const rig = createCharacterRig();
  const ik = new WeaponIKController(rig);
  const wristTarget = new THREE.Vector3(0.08, 1.32, 0.42);
  const elbowPole = new THREE.Vector3(0.45, 1.05, 0.02);
  const desiredHandQ = ik.buildHandWorldQuat('L', new THREE.Quaternion(), [0.32, -0.93, -0.16], [-0.78, -0.17, 0.6]);

  ik.solveArmWorld('L', wristTarget, elbowPole, desiredHandQ);
  const handBone = rig.boneMap.get('Hand_L')!;
  const actualPos = new THREE.Vector3();
  const actualQuat = new THREE.Quaternion();
  handBone.getWorldPosition(actualPos);
  handBone.getWorldQuaternion(actualQuat);

  assert.ok(
    actualPos.distanceTo(wristTarget) < 0.002,
    `wrist error with forearm twist sharing must stay < 2mm, got ${(actualPos.distanceTo(wristTarget) * 1000).toFixed(3)}mm`
  );
  assert.ok(
    Math.abs(actualQuat.dot(desiredHandQ)) > 0.9999,
    'hand world orientation must match target exactly after forearm twist split'
  );
  // Confirm local wrist axial twist is bounded (no 150deg candy-wrapper collapse!)
  const bindForeL = rig.bindWorldPos.get('Hand_L')!.clone().sub(rig.bindWorldPos.get('Forearm_L')!).normalize();
  const residualTwist = Math.abs(decomposeSwingTwist(handBone.quaternion, bindForeL).twistAngle);
  assert.ok(
    residualTwist < 0.85,
    `residual wrist axial twist must be reduced by forearm sharing, got ${(residualTwist * 180 / Math.PI).toFixed(1)}deg`
  );
});

test('true-axis anatomical finger curling bends every fingertip strictly inward toward the palm (-out)', () => {
  const rig = createCharacterRig();
  const ik = new WeaponIKController(rig);

  for (const side of ['L', 'R'] as const) {
    const b = getHandBasis(side, rig);
    const hand = rig.boneMap.get(`Hand_${side}`)!;
    const mid3 = rig.boneMap.get(`Middle_03_${side}`)!;

    // Bind position projection onto +out axis
    rig.rootBone.updateMatrixWorld(true);
    const handPos = new THREE.Vector3();
    const bindTip = new THREE.Vector3();
    hand.getWorldPosition(handPos);
    mid3.getWorldPosition(bindTip);
    const bindOutProj = bindTip.clone().sub(handPos).dot(b.out);

    ik.setFingerGripPose(side, 0.92, 0, false);
    rig.rootBone.updateMatrixWorld(true);
    const curledTip = new THREE.Vector3();
    mid3.getWorldPosition(curledTip);
    const curledOutProj = curledTip.clone().sub(handPos).dot(b.out);

    assert.ok(
      curledOutProj < bindOutProj - 0.025,
      `${side} curled Middle finger must move strongly inward toward palm (-out): bind=${bindOutProj.toFixed(4)}, curled=${curledOutProj.toFixed(4)}`
    );
  }
});

test('M870 side-saddle red shells and translucent rifle magazines deplete on fire and refill on reload', () => {
  // M870 6 visible crimson shells deplete immediately on first shot, reach 0 when empty, and refill smoothly during reload
  assert.equal(computeM870SaddleShellCount(8, 8, false, 0, 8, 32), 6);
  assert.equal(computeM870SaddleShellCount(7, 8, false, 0, 8, 32), 5);
  assert.equal(computeM870SaddleShellCount(4, 8, false, 0, 8, 32), 3);
  assert.equal(computeM870SaddleShellCount(1, 8, false, 0, 8, 32), 1);
  assert.equal(computeM870SaddleShellCount(0, 8, false, 0, 8, 32), 0);
  // Mid-reload refills progressively from 0 -> 3 -> 6
  assert.equal(computeM870SaddleShellCount(0, 8, true, 0.14, 0, 32), 0);
  assert.equal(computeM870SaddleShellCount(0, 8, true, 0.43, 0, 32), 3);
  assert.equal(computeM870SaddleShellCount(8, 8, true, 0.72, 0, 32), 6);

  // Translucent rifle window slots (12 slots for 30 rounds) & AWM exact 5-for-5 slots
  assert.equal(computeVisibleSlotCount(30, 30, 12), 12);
  assert.equal(computeVisibleSlotCount(29, 30, 12), 11);
  assert.equal(computeVisibleSlotCount(15, 30, 12), 6);
  assert.equal(computeVisibleSlotCount(1, 30, 12), 1);
  assert.equal(computeVisibleSlotCount(0, 30, 12), 0);
  assert.equal(computeVisibleSlotCount(5, 5, 5), 5);
  assert.equal(computeVisibleSlotCount(3, 5, 5), 3);
  assert.equal(computeVisibleSlotCount(0, 5, 5), 0);

  // Reload magazine visual swap: detached empty mag shows 0 rounds (< 0.36), fresh pouch mag shows full 30 (>= 0.36)
  assert.equal(getDisplayedMagRounds(0, 30, true, 0.24, 0, 90), 0);
  assert.equal(getDisplayedMagRounds(0, 30, true, 0.46, 0, 90), 30);
});
