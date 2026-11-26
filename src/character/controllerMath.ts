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
  recoilVelocity: number;
  activeClip: string;
  fireCooldown: number;
  muzzleFlashTimer: number;
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
    recoilVelocity: 0,
    activeClip: 'Idle_Natural',
    fireCooldown: 0,
    muzzleFlashTimer: 0,
  };
}

/** Shortest signed angle difference in [-PI, PI] */
export function shortestAngleDelta(from: number, to: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** Frame-rate independent exponential damping */
export function dampScalar(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export interface StepResult {
  firedThisStep: boolean;
  jumpedThisStep: boolean;
  clipWeights: Record<string, number>;
}

/**
 * Pure deterministic Battlegrounds / GTA-5 character locomotion & combat step.
 * Speeds are matched directly to the biomechanical stride lengths of each clip
 * so boots grip the ground without ice-skating.
 */
export function stepCombatController(
  state: ControllerState,
  input: InputState,
  cameraYaw: number,
  cameraPitch: number,
  dt: number
): StepResult {
  const clampedDt = Math.min(Math.max(dt, 0.0001), 0.05);
  let firedThisStep = false;
  let jumpedThisStep = false;

  state.isAiming = input.aim;
  state.isCrouching = input.crouch && !input.sprint;

  // Cooldowns
  state.fireCooldown = Math.max(0, state.fireCooldown - clampedDt);
  state.muzzleFlashTimer = Math.max(0, state.muzzleFlashTimer - clampedDt);

  // Recoil spring physics (stiff punchy kick with crisp damped recovery)
  const springForce = -240 * state.recoilAmount - 22 * state.recoilVelocity;
  state.recoilVelocity += springForce * clampedDt;
  state.recoilAmount = Math.max(0, state.recoilAmount + state.recoilVelocity * clampedDt);

  // Firing trigger
  if (input.firePressed && state.fireCooldown <= 0) {
    firedThisStep = true;
    state.fireCooldown = 0.24;
    state.muzzleFlashTimer = 0.07;
    state.recoilVelocity += 11.5;
    state.recoilAmount = Math.min(1.0, state.recoilAmount + 0.35);
  }

  // Compute desired movement vector in world XZ relative to cameraYaw
  const moveZ = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
  const moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const hasMove = moveZ !== 0 || moveX !== 0;

  // Target speed synced to animation stride lengths (m/s)
  let maxSpeed = 0;
  if (hasMove) {
    if (state.isCrouching) {
      maxSpeed = 1.35;
    } else if (state.isAiming) {
      maxSpeed = 1.65;
    } else if (input.sprint && moveZ >= 0) {
      maxSpeed = 5.4;
    } else {
      maxSpeed = 2.95; // Tactical jog default on WASD, smoothly blending through walk
    }
  }

  state.speed = dampScalar(state.speed, maxSpeed, hasMove ? 9.5 : 11.0, clampedDt);

  // Camera forward on XZ: (-sin(camYaw), -cos(camYaw)) when camera orbits behind +Z
  // Here camera looks along (sin(cameraYaw), cos(cameraYaw)) so character forward = +Z when cameraYaw = 0
  const fwdX = Math.sin(cameraYaw);
  const fwdZ = Math.cos(cameraYaw);
  const rightX = -Math.cos(cameraYaw);
  const rightZ = Math.sin(cameraYaw);

  let worldDirX = fwdX * moveZ + rightX * moveX;
  let worldDirZ = fwdZ * moveZ + rightZ * moveX;
  const dirLen = Math.hypot(worldDirX, worldDirZ);
  if (dirLen > 1e-5) {
    worldDirX /= dirLen;
    worldDirZ /= dirLen;
  }

  // Character yaw orientation:
  // When aiming or firing, upper/full body squares toward camera forward;
  // otherwise turn smoothly toward movement direction (GTA-5 feel).
  if (state.isAiming || state.recoilAmount > 0.08) {
    const delta = shortestAngleDelta(state.yaw, cameraYaw);
    state.yaw += delta * (1 - Math.exp(-16 * clampedDt));
  } else if (hasMove && dirLen > 1e-5) {
    const targetYaw = Math.atan2(worldDirX, worldDirZ);
    const delta = shortestAngleDelta(state.yaw, targetYaw);
    state.yaw += delta * (1 - Math.exp(-11 * clampedDt));
  }

  // Clamp upper-body aim pitch & yaw offset for spine/head tracking
  const clampedPitch = Math.max(-0.52, Math.min(0.52, cameraPitch));
  state.aimPitch = dampScalar(state.aimPitch, state.isAiming ? clampedPitch : 0, 14, clampedDt);
  state.aimYawOffset = dampScalar(
    state.aimYawOffset,
    state.isAiming ? Math.max(-0.6, Math.min(0.6, shortestAngleDelta(state.yaw, cameraYaw))) : 0,
    14,
    clampedDt
  );

  // Move character within clean studio turntable arena (radius 5.5m so studio rim lights stay balanced)
  if (state.speed > 0.02 && dirLen > 1e-5) {
    state.posX += worldDirX * state.speed * clampedDt;
    state.posZ += worldDirZ * state.speed * clampedDt;
    const dist = Math.hypot(state.posX, state.posZ);
    const maxRadius = 5.5;
    if (dist > maxRadius) {
      state.posX = (state.posX / dist) * maxRadius;
      state.posZ = (state.posZ / dist) * maxRadius;
    }
  }

  // Jump arc physics
  if (input.jumpPressed && state.isGrounded) {
    state.isGrounded = false;
    state.velY = 4.65;
    jumpedThisStep = true;
  }

  if (!state.isGrounded) {
    state.velY -= 12.8 * clampedDt;
    state.posY += state.velY * clampedDt;
    if (state.posY <= 0) {
      state.posY = 0;
      state.velY = 0;
      state.isGrounded = true;
    }
  }

  // Select primary animation clip & blend weights
  let clip = 'Idle_Natural';
  if (!state.isGrounded) {
    clip = 'Jump_Action';
  } else if (state.muzzleFlashTimer > 0 || state.recoilAmount > 0.22) {
    clip = 'Combat_Fire_Burst';
  } else if (state.isAiming) {
    if (hasMove && Math.abs(moveX) > Math.abs(moveZ)) {
      clip = moveX < 0 ? 'Strafe_Left' : 'Strafe_Right';
    } else if (state.speed > 0.35) {
      clip = 'Walk_Casual_GTA';
    } else {
      clip = 'Combat_Aim_Stance';
    }
  } else if (state.isCrouching) {
    clip = state.speed > 0.25 ? 'Crouch_Walk' : 'Crouch_Idle';
  } else if (state.speed > 4.1) {
    clip = 'Sprint_Combat';
  } else if (state.speed > 2.05) {
    clip = 'Jog_Tactical';
  } else if (state.speed > 0.22) {
    clip = 'Walk_Casual_GTA';
  } else {
    clip = 'Idle_Natural';
  }

  state.activeClip = clip;

  const clipWeights: Record<string, number> = {
    [clip]: 1.0,
  };

  return {
    firedThisStep,
    jumpedThisStep,
    clipWeights,
  };
}
