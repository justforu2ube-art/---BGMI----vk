export type WeaponId = 'mk18' | 'ak74m' | 'm870' | 'awm' | 'glock19';
export type EquippedWeaponId = WeaponId | 'none';
export type FireMode = 'AUTO' | 'SEMI' | 'PUMP' | 'BOLT';

export interface WeaponSpec {
  id: WeaponId;
  slot: number;
  name: string;
  shortName: string;
  caliber: string;
  defaultFireMode: FireMode;
  supportedFireModes: FireMode[];
  rpm: number;
  magSize: number;
  reserveMax: number;
  reloadDuration: number;
  /** Seconds after shot before bolt/pump cycle starts (shotgun pump, sniper bolt) */
  cycleDelay: number;
  cycleDuration: number;
  pellets: number;
  spreadRad: number;
  adsSpreadRad: number;
  recoilKickZ: number;
  recoilClimbX: number;
  recoilYawVariance: number;
  cameraKick: number;
  muzzleFlashScale: number;
  casingType: 'brass_556' | 'brass_762' | 'hull_12g' | 'brass_338' | 'brass_9mm';
  adsFov: number;
  isSidearm: boolean;
  hasLaser: boolean;
  hasFlashlight: boolean;
  lengthMeters: number;
  turntableDist: number;
  turntableCenter: [number, number, number];
}

export const WEAPON_ORDER: WeaponId[] = ['mk18', 'ak74m', 'm870', 'awm', 'glock19'];

export const WEAPON_SPECS: Record<WeaponId, WeaponSpec> = {
  mk18: {
    id: 'mk18',
    slot: 1,
    name: 'MK18 Mod 1 CQBR',
    shortName: 'MK18 MOD 1',
    caliber: '5.56×45mm NATO',
    defaultFireMode: 'AUTO',
    supportedFireModes: ['AUTO', 'SEMI'],
    rpm: 800,
    magSize: 30,
    reserveMax: 120,
    reloadDuration: 2.15,
    cycleDelay: 0,
    cycleDuration: 0.065,
    pellets: 1,
    spreadRad: 0.018,
    adsSpreadRad: 0.004,
    recoilKickZ: 0.026,
    recoilClimbX: 0.042,
    recoilYawVariance: 0.014,
    cameraKick: 0.012,
    muzzleFlashScale: 1.0,
    casingType: 'brass_556',
    adsFov: 28,
    isSidearm: false,
    hasLaser: true,
    hasFlashlight: false,
    lengthMeters: 0.78,
    turntableDist: 1.12,
    turntableCenter: [0, 0.055, 0.14],
  },
  ak74m: {
    id: 'ak74m',
    slot: 2,
    name: 'AK-74M / Modernized AKM',
    shortName: 'AK-74M',
    caliber: '7.62×39mm',
    defaultFireMode: 'AUTO',
    supportedFireModes: ['AUTO', 'SEMI'],
    rpm: 600,
    magSize: 30,
    reserveMax: 120,
    reloadDuration: 2.35,
    cycleDelay: 0,
    cycleDuration: 0.085,
    pellets: 1,
    spreadRad: 0.024,
    adsSpreadRad: 0.006,
    recoilKickZ: 0.036,
    recoilClimbX: 0.064,
    recoilYawVariance: 0.022,
    cameraKick: 0.018,
    muzzleFlashScale: 1.2,
    casingType: 'brass_762',
    adsFov: 28,
    isSidearm: false,
    hasLaser: true,
    hasFlashlight: false,
    lengthMeters: 0.88,
    turntableDist: 1.24,
    turntableCenter: [0, 0.045, 0.17],
  },
  m870: {
    id: 'm870',
    slot: 3,
    name: 'Benelli M4 / M870 Tactical',
    shortName: 'M870 TACTICAL',
    caliber: '12-Gauge Buckshot',
    defaultFireMode: 'PUMP',
    supportedFireModes: ['PUMP'],
    rpm: 75,
    magSize: 8,
    reserveMax: 32,
    reloadDuration: 2.6,
    cycleDelay: 0.14,
    cycleDuration: 0.42,
    pellets: 8,
    spreadRad: 0.072,
    adsSpreadRad: 0.046,
    recoilKickZ: 0.055,
    recoilClimbX: 0.115,
    recoilYawVariance: 0.026,
    cameraKick: 0.034,
    muzzleFlashScale: 1.45,
    casingType: 'hull_12g',
    adsFov: 30,
    isSidearm: false,
    hasLaser: true,
    hasFlashlight: false,
    lengthMeters: 0.94,
    turntableDist: 1.32,
    turntableCenter: [0, 0.04, 0.21],
  },
  awm: {
    id: 'awm',
    slot: 4,
    name: 'AWM / M200 Precision Sniper',
    shortName: 'AWM .338',
    caliber: '.338 Lapua Magnum',
    defaultFireMode: 'BOLT',
    supportedFireModes: ['BOLT'],
    rpm: 42,
    magSize: 5,
    reserveMax: 25,
    reloadDuration: 2.65,
    cycleDelay: 0.18,
    cycleDuration: 0.86,
    pellets: 1,
    spreadRad: 0.012,
    adsSpreadRad: 0.0008,
    recoilKickZ: 0.068,
    recoilClimbX: 0.13,
    recoilYawVariance: 0.012,
    cameraKick: 0.042,
    muzzleFlashScale: 1.65,
    casingType: 'brass_338',
    adsFov: 15,
    isSidearm: false,
    hasLaser: true,
    hasFlashlight: false,
    lengthMeters: 1.18,
    turntableDist: 1.56,
    turntableCenter: [0, 0.065, 0.3],
  },
  glock19: {
    id: 'glock19',
    slot: 5,
    name: 'Tactical Glock 19 Gen5',
    shortName: 'GLOCK 19 TAC',
    caliber: '9×19mm Parabellum',
    defaultFireMode: 'SEMI',
    supportedFireModes: ['SEMI'],
    rpm: 420,
    magSize: 15,
    reserveMax: 60,
    reloadDuration: 1.65,
    cycleDelay: 0,
    cycleDuration: 0.075,
    pellets: 1,
    spreadRad: 0.022,
    adsSpreadRad: 0.007,
    recoilKickZ: 0.02,
    recoilClimbX: 0.065,
    recoilYawVariance: 0.016,
    cameraKick: 0.011,
    muzzleFlashScale: 0.72,
    casingType: 'brass_9mm',
    adsFov: 31,
    isSidearm: true,
    hasLaser: false,
    hasFlashlight: true,
    lengthMeters: 0.21,
    turntableDist: 0.44,
    turntableCenter: [0, 0.035, 0.05],
  },
};

export interface WeaponAmmoState {
  mag: number;
  reserve: number;
  fireMode: FireMode;
}

export type ReloadStage =
  | 'none'
  | 'reach_mag'
  | 'detach_mag'
  | 'fetch_mag'
  | 'insert_mag'
  | 'rack_bolt'
  | 'return_hand';

export interface WeaponCombatState {
  equipped: EquippedWeaponId;
  ammo: Record<WeaponId, WeaponAmmoState>;
  fireCooldown: number;
  triggerHeldPrev: boolean;
  triggerPull: number;
  /** Spring-damper weapon recoil state */
  recoilZ: number;
  recoilVelZ: number;
  recoilPitch: number;
  recoilVelPitch: number;
  recoilYaw: number;
  recoilVelYaw: number;
  /** Reciprocating bolt / pump / slide 0..1 */
  boltTravel: number;
  /** Sniper bolt lift rotation 0..1 (0..60deg) */
  boltLift: number;
  /** Slide locked back when pistol mag empty */
  slideLockedBack: boolean;
  /** Delayed cycle timer (for pump-action / bolt-action) */
  cycleTimer: number;
  cycleActive: boolean;
  cycleEjected: boolean;
  /** Reload state */
  isReloading: boolean;
  reloadProgress: number; // 0..1
  reloadSoundFlags: number; // bitmask for magOut(1), magIn(2), boltRack(4)
  /** Mag count captured when reload started (so detached empty mag shows depleted brass while fresh mag shows full brass!) */
  preReloadMag: number;
  /** Equip draw blend 0..1 */
  equipBlend: number;
  /** Weapon inspect mode */
  isInspecting: boolean;
  inspectTime: number;
  /** Laser / tactical weapon light toggle */
  laserEnabled: boolean;
  /** Reticle dynamic bloom 0..1 */
  reticleSpread: number;
  /** Muzzle flash countdown */
  muzzleFlashTimer: number;
  /** Heat/smoke counter for rising gunpowder wisps */
  barrelHeat: number;
}

export interface WeaponStepEvents {
  fired: boolean;
  dryFired: boolean;
  ejectCasing: boolean;
  pumpSound: boolean;
  boltCycleSound: boolean;
  magOutSound: boolean;
  magInSound: boolean;
  boltRackSound: boolean;
  reloadCompleted: boolean;
}

export function createInitialWeaponCombatState(
  initialWeapon: EquippedWeaponId = 'mk18'
): WeaponCombatState {
  const ammo = {} as Record<WeaponId, WeaponAmmoState>;
  for (const id of WEAPON_ORDER) {
    const s = WEAPON_SPECS[id];
    ammo[id] = {
      mag: s.magSize,
      reserve: s.reserveMax,
      fireMode: s.defaultFireMode,
    };
  }
  return {
    equipped: initialWeapon,
    ammo,
    fireCooldown: 0,
    triggerHeldPrev: false,
    triggerPull: 0,
    recoilZ: 0,
    recoilVelZ: 0,
    recoilPitch: 0,
    recoilVelPitch: 0,
    recoilYaw: 0,
    recoilVelYaw: 0,
    boltTravel: 0,
    boltLift: 0,
    slideLockedBack: false,
    cycleTimer: 0,
    cycleActive: false,
    cycleEjected: false,
    isReloading: false,
    reloadProgress: 0,
    reloadSoundFlags: 0,
    preReloadMag: initialWeapon === 'none' ? 0 : WEAPON_SPECS[initialWeapon].magSize,
    equipBlend: 1,
    isInspecting: false,
    inspectTime: 0,
    laserEnabled: false,
    reticleSpread: 0,
    muzzleFlashTimer: 0,
    barrelHeat: 0,
  };
}

export function switchWeaponState(state: WeaponCombatState, next: EquippedWeaponId): boolean {
  if (state.equipped === next) return false;
  state.equipped = next;
  state.isReloading = false;
  state.reloadProgress = 0;
  state.reloadSoundFlags = 0;
  state.cycleActive = false;
  state.cycleTimer = 0;
  state.cycleEjected = false;
  state.boltTravel = 0;
  state.boltLift = 0;
  state.fireCooldown = 0.24;
  state.equipBlend = 0;
  state.isInspecting = false;
  state.inspectTime = 0;
  state.recoilZ = 0;
  state.recoilVelZ = 0;
  state.recoilPitch = 0;
  state.recoilVelPitch = 0;
  state.recoilYaw = 0;
  state.recoilVelYaw = 0;
  state.muzzleFlashTimer = 0;
  if (next !== 'none') {
    const ammo = state.ammo[next];
    state.slideLockedBack = next === 'glock19' && ammo.mag === 0;
    state.preReloadMag = ammo.mag;
  } else {
    state.slideLockedBack = false;
    state.preReloadMag = 0;
  }
  return true;
}

export function toggleWeaponFireMode(state: WeaponCombatState): FireMode | null {
  if (state.equipped === 'none') return null;
  const spec = WEAPON_SPECS[state.equipped];
  if (spec.supportedFireModes.length <= 1) return state.ammo[state.equipped].fireMode;
  const cur = state.ammo[state.equipped].fireMode;
  const idx = spec.supportedFireModes.indexOf(cur);
  const nextMode = spec.supportedFireModes[(idx + 1) % spec.supportedFireModes.length];
  state.ammo[state.equipped].fireMode = nextMode;
  return nextMode;
}

export function startWeaponReload(state: WeaponCombatState): boolean {
  if (state.equipped === 'none') return false;
  if (state.isReloading) return false;
  const spec = WEAPON_SPECS[state.equipped];
  const ammo = state.ammo[state.equipped];
  if (ammo.mag >= spec.magSize || ammo.reserve <= 0) return false;
  state.isReloading = true;
  state.reloadProgress = 0;
  state.reloadSoundFlags = 0;
  state.preReloadMag = ammo.mag;
  state.cycleActive = false;
  state.isInspecting = false;
  return true;
}

export function getReloadStage(progress: number): { stage: ReloadStage; localT: number } {
  if (progress <= 0 || progress >= 1) return { stage: 'none', localT: 0 };
  if (progress < 0.14) return { stage: 'reach_mag', localT: progress / 0.14 };
  if (progress < 0.34) return { stage: 'detach_mag', localT: (progress - 0.14) / 0.2 };
  if (progress < 0.56) return { stage: 'fetch_mag', localT: (progress - 0.34) / 0.22 };
  if (progress < 0.72) return { stage: 'insert_mag', localT: (progress - 0.56) / 0.16 };
  if (progress < 0.89) return { stage: 'rack_bolt', localT: (progress - 0.72) / 0.17 };
  return { stage: 'return_hand', localT: (progress - 0.89) / 0.11 };
}

/** Deterministic spring-damper recoil & weapon mechanics step (pure, unit-testable) */
export function stepWeaponMechanics(
  state: WeaponCombatState,
  firePressed: boolean,
  isAiming: boolean,
  moveSpeed: number,
  dt: number,
  randomVal = 0.5
): WeaponStepEvents {
  const events: WeaponStepEvents = {
    fired: false,
    dryFired: false,
    ejectCasing: false,
    pumpSound: false,
    boltCycleSound: false,
    magOutSound: false,
    magInSound: false,
    boltRackSound: false,
    reloadCompleted: false,
  };

  const cDt = Math.min(Math.max(dt, 0.0001), 0.05);
  state.fireCooldown = Math.max(0, state.fireCooldown - cDt);
  state.muzzleFlashTimer = Math.max(0, state.muzzleFlashTimer - cDt);
  state.barrelHeat = Math.max(0, state.barrelHeat - cDt * 0.32);
  state.equipBlend = Math.min(1, state.equipBlend + cDt * 4.2);

  // Spring-damper recoil recovery (snappy Call of Duty feel)
  const kZ = 340;
  const dZ = 24;
  state.recoilVelZ += (-kZ * state.recoilZ - dZ * state.recoilVelZ) * cDt;
  state.recoilZ = Math.max(0, state.recoilZ + state.recoilVelZ * cDt);

  const kP = 210;
  const dP = 18;
  state.recoilVelPitch += (-kP * state.recoilPitch - dP * state.recoilVelPitch) * cDt;
  state.recoilPitch = Math.max(-0.04, state.recoilPitch + state.recoilVelPitch * cDt);

  const kY = 190;
  const dY = 17;
  state.recoilVelYaw += (-kY * state.recoilYaw - dY * state.recoilVelYaw) * cDt;
  state.recoilYaw += state.recoilVelYaw * cDt;

  if (state.equipped === 'none') {
    state.triggerHeldPrev = firePressed;
    state.reticleSpread = Math.max(0, state.reticleSpread - cDt * 4);
    return events;
  }

  const spec = WEAPON_SPECS[state.equipped];
  const ammo = state.ammo[state.equipped];

  // Weapon inspect animation timer
  if (state.isInspecting) {
    state.inspectTime += cDt;
    if (firePressed || isAiming) {
      state.isInspecting = false;
    }
  }

  // Trigger pull smoothing
  const targetTrig = firePressed ? 1 : 0;
  state.triggerPull += (targetTrig - state.triggerPull) * (1 - Math.exp(-26 * cDt));

  // Active mechanical reload timeline
  if (state.isReloading) {
    state.reloadProgress += cDt / spec.reloadDuration;
    const p = state.reloadProgress;

    if (p >= 0.16 && (state.reloadSoundFlags & 1) === 0) {
      state.reloadSoundFlags |= 1;
      events.magOutSound = true;
    }
    if (p >= 0.62 && (state.reloadSoundFlags & 2) === 0) {
      state.reloadSoundFlags |= 2;
      events.magInSound = true;
      // Commit ammo refill on mag lock-in
      const needed = spec.magSize - ammo.mag;
      const take = Math.min(needed, ammo.reserve);
      ammo.mag += take;
      ammo.reserve -= take;
      state.slideLockedBack = false;
    }
    if (p >= 0.76 && (state.reloadSoundFlags & 4) === 0) {
      state.reloadSoundFlags |= 4;
      events.boltRackSound = true;
    }

    // Animate bolt/slide/pump visibly during rack phase (0.72 -> 0.89)
    if (p >= 0.72 && p <= 0.89) {
      const u = (p - 0.72) / 0.17;
      state.boltTravel = Math.sin(u * Math.PI);
      if (state.equipped === 'awm') {
        state.boltLift = Math.sin(u * Math.PI);
      }
    } else if (!state.slideLockedBack) {
      state.boltTravel = Math.max(0, state.boltTravel - cDt * 12);
      state.boltLift = Math.max(0, state.boltLift - cDt * 10);
    }

    if (p >= 1) {
      state.isReloading = false;
      state.reloadProgress = 0;
      state.boltTravel = 0;
      state.boltLift = 0;
      events.reloadCompleted = true;
    }
  } else {
    // Handle firing trigger
    const justPressed = firePressed && !state.triggerHeldPrev;
    const wantsFire = ammo.fireMode === 'AUTO' ? firePressed : justPressed;

    if (wantsFire && state.fireCooldown <= 0 && !state.cycleActive && state.equipBlend >= 0.85) {
      if (ammo.mag > 0) {
        events.fired = true;
        ammo.mag -= 1;
        state.fireCooldown = 60 / spec.rpm;
        state.muzzleFlashTimer = 0.068;
        state.barrelHeat = Math.min(1, state.barrelHeat + 0.22);

        const adsFactor = isAiming ? 0.62 : 1.0;
        state.recoilVelZ += spec.recoilKickZ * 26 * adsFactor;
        state.recoilZ = Math.min(0.085, state.recoilZ + spec.recoilKickZ * adsFactor);
        state.recoilVelPitch += spec.recoilClimbX * 16 * adsFactor;
        state.recoilPitch = Math.min(0.26, state.recoilPitch + spec.recoilClimbX * 0.45 * adsFactor);
        state.recoilVelYaw += (randomVal - 0.5) * 2 * spec.recoilYawVariance * 22 * adsFactor;
        state.reticleSpread = Math.min(1, state.reticleSpread + (isAiming ? 0.24 : 0.48));

        if (spec.cycleDelay > 0) {
          // Pump shotgun or bolt-action sniper: manual action begins after brief recoil kick
          state.cycleActive = true;
          state.cycleTimer = 0;
          state.cycleEjected = false;
          state.boltTravel = 0.08;
        } else {
          // Gas-operated / blowback: instant bolt slam & brass ejection!
          state.boltTravel = 1.0;
          events.ejectCasing = true;
          if (state.equipped === 'glock19' && ammo.mag === 0) {
            state.slideLockedBack = true;
          }
        }
      } else if (justPressed) {
        events.dryFired = true;
        state.fireCooldown = 0.22;
        if (ammo.reserve > 0) {
          startWeaponReload(state);
        }
      }
    }

    // Delayed pump / manual bolt-action cycling
    if (state.cycleActive) {
      state.cycleTimer += cDt;
      const tInCycle = state.cycleTimer - spec.cycleDelay;
      if (tInCycle >= 0) {
        const u = Math.min(1, tInCycle / spec.cycleDuration);
        if (state.equipped === 'm870') {
          // Smooth tactical pump back (0..0.48) and forward slam (0.48..1.0)
          if (u < 0.48) {
            state.boltTravel = Math.sin((u / 0.48) * (Math.PI * 0.5));
          } else {
            state.boltTravel = Math.cos(((u - 0.48) / 0.52) * (Math.PI * 0.5));
          }
          if (!state.cycleEjected && u >= 0.36) {
            state.cycleEjected = true;
            events.ejectCasing = true;
            events.pumpSound = true;
          }
        } else if (state.equipped === 'awm') {
          // Full manual sniper bolt cycle: lift 60° (0..0.22) -> pull back (0.22..0.52) -> push forward (0.52..0.8) -> lock down (0.8..1.0)
          if (u < 0.22) {
            state.boltLift = u / 0.22;
            state.boltTravel = 0;
          } else if (u < 0.52) {
            state.boltLift = 1;
            state.boltTravel = (u - 0.22) / 0.3;
          } else if (u < 0.8) {
            state.boltLift = 1;
            state.boltTravel = 1 - (u - 0.52) / 0.28;
          } else {
            state.boltLift = 1 - (u - 0.8) / 0.2;
            state.boltTravel = 0;
          }
          if (!state.cycleEjected && u >= 0.42) {
            state.cycleEjected = true;
            events.ejectCasing = true;
            events.boltCycleSound = true;
          }
        }
        if (u >= 1) {
          state.cycleActive = false;
          state.cycleTimer = 0;
          state.boltTravel = 0;
          state.boltLift = 0;
        }
      }
    } else if (state.slideLockedBack) {
      state.boltTravel = 1.0;
    } else {
      // Gas-operated bolt / slide rapid return forward
      state.boltTravel = Math.max(0, state.boltTravel - cDt / Math.max(spec.cycleDuration, 0.04));
      state.boltLift = Math.max(0, state.boltLift - cDt * 12);
    }
  }

  // Dynamic crosshair bloom target (tightens cleanly on ADS, expands on sprint/fire)
  const baseSpread = isAiming ? 0.05 : Math.min(0.65, 0.14 + moveSpeed * 0.09);
  state.reticleSpread += (baseSpread - state.reticleSpread) * (1 - Math.exp(-9 * cDt));
  state.triggerHeldPrev = firePressed;
  return events;
}
