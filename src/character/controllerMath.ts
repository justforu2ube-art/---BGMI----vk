import type { AimPitchDistribution } from '../types/studioTypes';

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  crouch: boolean;
  aim: boolean;
  jumpPressed: boolean;
  firePressed: boolean;
  isArmed?: boolean;
}

export interface ControllerState {
  posX: number;
  posY: number;
  posZ: number;
  velY: number;
  yaw: number;
  speed: number;
  isGrounded: boolean;
  isCrouching: boolean;
  isAiming: boolean;
  aimPitch: number;
  aimYawOffset: number;
  recoilAmount: number;
  muzzleFlashTimer: number;
  fireCooldown: number;
  activeClip: string;
}

export interface StepCombatResult {
  firedThisStep: boolean;
  jumpedThisStep: boolean;
  isSprinting: boolean;
}

export const ARENA_BOUND_RADIUS = 11.2;
const GRAVITY = -19.5;
const JUMP_VELOCITY = 6.2;

export function dampScalar(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * Math.max(0, dt)));
}

export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(current: number, target: number, alpha: number): number {
  const diff = wrapAngle(target - current);
  return wrapAngle(current + diff * Math.min(1, Math.max(0, alpha)));
}

/**
 * Pure non-accumulating aim-pitch distribution across spine_02, spine_03, neck_01, head.
 * Clamps cameraPitch to [-0.55, +0.55] rad and distributes [0.25, 0.35, 0.20, 0.20]
 * around character-local +X relative to the clip pose.
 */
export function computeAimPitchDistribution(cameraPitch: number): AimPitchDistribution {
  const clampedPitch = Math.max(-0.55, Math.min(0.55, cameraPitch));
  return {
    clampedPitch,
    spine_02: clampedPitch * 0.25,
    spine_03: clampedPitch * 0.35,
    neck_01: clampedPitch * 0.20,
    head: clampedPitch * 0.20,
  };
}

/**
 * Pure mouse-wheel weapon step debouncer:
 * Accumulates deltaY until |acc| >= 40 with a 150ms cooldown,
 * stepping strictly by Math.sign(delta) (±1 mod slotCount).
 */
export class WheelStepDebouncer {
  private accumulator = 0;
  private lastStepTimeMs = -Infinity;
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(threshold = 40, cooldownMs = 150) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
  }

  public reset(): void {
    this.accumulator = 0;
    this.lastStepTimeMs = -Infinity;
  }

  public consume(deltaY: number, nowMs: number): -1 | 0 | 1 {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;

    if (nowMs - this.lastStepTimeMs < this.cooldownMs) {
      return 0;
    }

    if (this.accumulator !== 0 && Math.sign(deltaY) !== Math.sign(this.accumulator)) {
      this.accumulator = 0;
    }

    this.accumulator += deltaY;
    if (Math.abs(this.accumulator) >= this.threshold) {
      const step = Math.sign(this.accumulator) as -1 | 1;
      this.accumulator = 0;
      this.lastStepTimeMs = nowMs;
      return step;
    }
    return 0;
  }
}

export function stepWeaponIndex(currentIndex: number, step: -1 | 0 | 1, count = 5): number {
  if (step === 0 || count <= 0) return currentIndex;
  return (((currentIndex + step) % count) + count) % count;
}

export function createInitialControllerState(): ControllerState {
  return {
    posX: 0,
    posY: 0,
    posZ: 0,
    velY: 0,
    yaw: 0,
    speed: 0,
    isGrounded: true,
    isCrouching: false,
    isAiming: false,
    aimPitch: 0,
    aimYawOffset: 0,
    recoilAmount: 0,
    muzzleFlashTimer: 0,
    fireCooldown: 0,
    activeClip: 'Idle_Natural',
  };
}

/**
 * Steps live Combat Controller locomotion, jump, unarmed fire fallback, and armed A/D combat strafing.
 * When armed (excluding Sprint) or aiming, characterYaw locks smoothly to cameraYaw so A/D cleanly
 * drives Strafe_Left / Strafe_Right instead of spinning sideways!
 */
export function stepCombatController(
  state: ControllerState,
  input: InputState,
  cameraYaw: number,
  cameraPitch: number,
  dt: number
): StepCombatResult {
  const clampedDt = Math.min(Math.max(dt, 0.001), 0.05);
  state.isCrouching = input.crouch;
  state.isAiming = input.aim;

  const isArmed = input.isArmed ?? true;

  const moveForward = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
  const moveRight = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const hasMove = moveForward !== 0 || moveRight !== 0;

  const fwdX = Math.sin(cameraYaw);
  const fwdZ = Math.cos(cameraYaw);
  const rightX = -Math.cos(cameraYaw);
  const rightZ = Math.sin(cameraYaw);

  let dirX = fwdX * moveForward + rightX * moveRight;
  let dirZ = fwdZ * moveForward + rightZ * moveRight;
  const len = Math.hypot(dirX, dirZ);
  if (len > 1e-5) {
    dirX /= len;
    dirZ /= len;
  }

  const isSprinting = hasMove && input.sprint && !input.crouch && !input.aim;

  let targetSpeed = 0;
  if (hasMove) {
    if (input.aim) {
      targetSpeed = 1.65;
    } else if (input.crouch) {
      targetSpeed = 1.75;
    } else if (isSprinting) {
      targetSpeed = 5.4;
    } else {
      targetSpeed = 2.85;
    }
  }

  state.speed = dampScalar(state.speed, targetSpeed, hasMove ? 11.5 : 13.0, clampedDt);
  if (!hasMove && state.speed < 0.03) state.speed = 0;

  state.posX += dirX * state.speed * clampedDt;
  state.posZ += dirZ * state.speed * clampedDt;

  const distFromCenter = Math.hypot(state.posX, state.posZ);
  if (distFromCenter > ARENA_BOUND_RADIUS) {
    const scale = ARENA_BOUND_RADIUS / distFromCenter;
    state.posX *= scale;
    state.posZ *= scale;
  }

  // Lock characterYaw to cameraYaw when armed (excluding Sprint) or aiming -> crisp A/D combat strafing!
  if (input.aim || (isArmed && !isSprinting)) {
    state.yaw = lerpAngle(state.yaw, cameraYaw, 18.0 * clampedDt);
  } else if (hasMove) {
    const moveYaw = Math.atan2(dirX, dirZ);
    state.yaw = lerpAngle(state.yaw, moveYaw, 10.5 * clampedDt);
  }

  // Clamped aim pitch & yaw offset for upper-body spine/neck/head tracking
  state.aimPitch = Math.max(-0.55, Math.min(0.55, cameraPitch));
  state.aimYawOffset = Math.max(-0.35, Math.min(0.35, wrapAngle(cameraYaw - state.yaw)));

  // Jump & gravity
  let jumpedThisStep = false;
  if (input.jumpPressed && state.isGrounded && !input.crouch) {
    state.velY = JUMP_VELOCITY;
    state.isGrounded = false;
    jumpedThisStep = true;
  }

  if (!state.isGrounded) {
    state.velY += GRAVITY * clampedDt;
    state.posY += state.velY * clampedDt;
    if (state.posY <= 0) {
      state.posY = 0;
      state.velY = 0;
      state.isGrounded = true;
    }
  } else {
    state.posY = 0;
    state.velY = 0;
  }

  // Unarmed burst fire fallback (when weapon is holstered)
  state.fireCooldown = Math.max(0, state.fireCooldown - clampedDt);
  state.muzzleFlashTimer = Math.max(0, state.muzzleFlashTimer - clampedDt);
  state.recoilAmount = dampScalar(state.recoilAmount, 0, 11.0, clampedDt);

  let firedThisStep = false;
  if (input.firePressed && state.fireCooldown <= 0) {
    firedThisStep = true;
    state.fireCooldown = 0.13;
    state.muzzleFlashTimer = 0.07;
    state.recoilAmount = Math.min(1.0, state.recoilAmount + 0.45);
  }

  // Choose base locomotion / combat clip
  if (!state.isGrounded) {
    state.activeClip = 'Jump_Action';
  } else if (firedThisStep || state.muzzleFlashTimer > 0) {
    state.activeClip = 'Combat_Fire_Burst';
  } else if (input.crouch) {
    state.activeClip = hasMove ? 'Crouch_Walk' : 'Crouch_Idle';
  } else if (isSprinting) {
    state.activeClip = 'Sprint_Combat';
  } else if (hasMove && (input.aim || isArmed)) {
    if (moveRight < 0 && Math.abs(moveRight) >= Math.abs(moveForward)) {
      state.activeClip = 'Strafe_Left';
    } else if (moveRight > 0 && Math.abs(moveRight) >= Math.abs(moveForward)) {
      state.activeClip = 'Strafe_Right';
    } else {
      state.activeClip = state.speed > 2.4 && !input.aim ? 'Jog_Tactical' : 'Walk_Casual_GTA';
    }
  } else if (input.aim) {
    state.activeClip = 'Combat_Aim_Stance';
  } else if (hasMove) {
    state.activeClip = state.speed > 2.4 ? 'Jog_Tactical' : 'Walk_Casual_GTA';
  } else {
    state.activeClip = 'Idle_Natural';
  }

  return { firedThisStep, jumpedThisStep, isSprinting };
}
