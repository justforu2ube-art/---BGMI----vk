import * as THREE from 'three';
import { BuiltWeapon } from './weaponGeoHelpers';
import { WEAPON_SPECS, WeaponId } from './weaponTypes';
import { selectShellPingClip, ShellCasingType, ShellPingClipId, weaponAudio } from './weaponAudio';

export type CasingType = ShellCasingType;

export interface CasingBounceResult {
  velX: number;
  velY: number;
  velZ: number;
  angVelX: number;
  angVelY: number;
  angVelZ: number;
  impactForce: number;
  isMicroBounce: boolean;
  settled: boolean;
  shouldPing: boolean;
  pingClip: ShellPingClipId;
  impactIntensity: number;
}

/**
 * Pure deterministic-capable casing ground-plane bounce & micro-bounce solver.
 * Applies randomized 3-axis angular velocity impulses from uneven brass rim strikes,
 * tangential scatter deflection, progressive micro-bouncing (down to 0.06 m/s) before
 * rolling to rest, and impact-force-mapped metallic ping audio clip selection!
 */
export function computeCasingBounce(
  vel: { x: number; y: number; z: number },
  angVel: { x: number; y: number; z: number },
  casingType: CasingType,
  bounceCount: number,
  rand1: number,
  rand2: number,
  rand3: number
): CasingBounceResult {
  const restitutionMap: Record<CasingType, number> = {
    brass_9mm: 0.44,
    brass_556: 0.4,
    brass_762: 0.37,
    brass_338: 0.33,
    hull_12g: 0.28,
  };
  const baseRestitution = restitutionMap[casingType];
  const impactForce = Math.abs(vel.y);
  const isMicroBounce = impactForce < 0.85 && impactForce >= 0.14;

  // Randomize deflection yaw angle (+-42° on main bounce, jittered +-28° chatter on micro-bounce)
  const scatterSpan = isMicroBounce ? 0.98 : 1.45;
  const scatterAngle = (rand1 - 0.5) * scatterSpan;
  const cosA = Math.cos(scatterAngle);
  const sinA = Math.sin(scatterAngle);
  const horizDrag = isMicroBounce ? 0.66 + rand2 * 0.14 : 0.58 + rand2 * 0.16;

  // Couple angular spin into sideways floor skitter on impact
  const spinKickX = Math.max(-0.35, Math.min(0.35, angVel.z * 0.012));
  const spinKickZ = Math.max(-0.35, Math.min(0.35, -angVel.x * 0.012));

  const rx = vel.x * cosA - vel.z * sinA;
  const rz = vel.x * sinA + vel.z * cosA;
  let nextVelX = rx * horizDrag + spinKickX * (0.45 + rand3 * 0.55);
  let nextVelZ = rz * horizDrag + spinKickZ * (0.45 + rand3 * 0.55);

  // Micro-bounce restitution keeps small brass hops lively before final settle
  const microBoost = isMicroBounce ? 0.82 + rand3 * 0.28 : 0.88 + rand2 * 0.24;
  let nextVelY = impactForce * (baseRestitution * microBoost);

  // Randomized 3-axis angular velocity kick scaled by impact force (rim/shoulder uneven strike)
  const torqueScale = Math.min(1.25, Math.max(0.22, impactForce * 0.55));
  const rimTorqueX = (rand2 - 0.5) * 26 * torqueScale;
  const rimTorqueY = (rand1 - 0.5) * 32 * torqueScale;
  const rimTorqueZ = (rand3 - 0.5) * 26 * torqueScale;

  // Blend in floor rolling torque from horizontal translation speed
  let nextAngX = angVel.x * 0.52 + rimTorqueX + nextVelZ * 6.5;
  let nextAngY = angVel.y * 0.58 + rimTorqueY;
  let nextAngZ = angVel.z * 0.52 + rimTorqueZ - nextVelX * 6.5;

  const pingClip = selectShellPingClip(casingType, impactForce);
  const shouldPing = bounceCount < 5 && impactForce >= 0.16;
  const impactIntensity = Math.min(1.15, Math.max(0.16, impactForce / 3.4));

  let settled = false;
  if (nextVelY < 0.065 || bounceCount >= 5) {
    settled = true;
    nextVelY = 0;
    nextVelX *= 0.82;
    nextVelZ *= 0.82;
    nextAngX *= 0.65;
    nextAngY *= 0.72;
    nextAngZ *= 0.65;
  } else if (isMicroBounce) {
    // Tiny lateral chatter nudge during rapid micro-bounces
    nextVelX += (rand3 - 0.5) * 0.16;
    nextVelZ += (rand1 - 0.5) * 0.16;
  }

  return {
    velX: nextVelX,
    velY: nextVelY,
    velZ: nextVelZ,
    angVelX: nextAngX,
    angVelY: nextAngY,
    angVelZ: nextAngZ,
    impactForce,
    isMicroBounce,
    settled,
    shouldPing,
    pingClip,
    impactIntensity,
  };
}

export interface CasingBodyState {
  posX: number;
  posY: number;
  posZ: number;
  velX: number;
  velY: number;
  velZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  angVelX: number;
  angVelY: number;
  angVelZ: number;
  bounceCount: number;
  casingType: CasingType;
  floorY: number;
  settled: boolean;
}

export interface CasingImpactEvent {
  pingClip: ShellPingClipId;
  impactForce: number;
  isMicroBounce: boolean;
}

/**
 * Pure sub-stepped rigid-body physics step for an ejected 3D brass/hull casing.
 * Integrates gravity & air drag, prevents studio-floor tunneling on low-FPS ticks,
 * couples cylinder tilt angle into uneven rim-strike velocity/spin scatter,
 * drives progressive micro-bounces before rolling flat to rest on the floor plane,
 * and returns any floor-contact audio impact events emitted during `dt`.
 */
export function stepCasingPhysics(
  body: CasingBodyState,
  dt: number,
  randFn: () => number = Math.random
): CasingImpactEvent[] {
  const impacts: CasingImpactEvent[] = [];
  if (dt <= 0) return impacts;

  const maxSubDt = 1 / 120;
  const steps = Math.max(1, Math.min(8, Math.ceil(dt / maxSubDt)));
  const subDt = dt / steps;

  for (let s = 0; s < steps; s++) {
    if (!body.settled) {
      // Gravity + subtle aerodynamic drag on tumbling light brass cylinder
      const airDrag = Math.exp(-0.42 * subDt);
      body.velX *= airDrag;
      body.velZ *= airDrag;
      body.velY -= 9.81 * subDt;

      body.posX += body.velX * subDt;
      body.posY += body.velY * subDt;
      body.posZ += body.velZ * subDt;

      body.rotX += body.angVelX * subDt;
      body.rotY += body.angVelY * subDt;
      body.rotZ += body.angVelZ * subDt;

      // Studio floor plane collision check
      if (body.posY <= body.floorY && body.velY <= 0) {
        body.posY = body.floorY;

        // End-on rim impact (|cos(rotZ)| near 1) kicks stronger scatter & angular tumble than flat impact
        const rimFactor = 0.72 + 0.56 * Math.abs(Math.cos(body.rotZ));
        const r1 = randFn();
        const r2 = randFn();
        const r3 = randFn();

        const bounce = computeCasingBounce(
          { x: body.velX, y: body.velY, z: body.velZ },
          { x: body.angVelX, y: body.angVelY, z: body.angVelZ },
          body.casingType,
          body.bounceCount,
          r1,
          r2,
          r3
        );

        // Modulate tangential scatter & tumble spin by cylinder rim contact geometry
        body.velX = bounce.velX + (r1 - 0.5) * 0.22 * rimFactor * Math.min(1, bounce.impactForce * 0.45);
        body.velY = bounce.velY;
        body.velZ = bounce.velZ + (r3 - 0.5) * 0.22 * rimFactor * Math.min(1, bounce.impactForce * 0.45);

        body.angVelX = bounce.angVelX * (0.85 + 0.3 * rimFactor);
        body.angVelY = bounce.angVelY * (0.85 + 0.3 * rimFactor);
        body.angVelZ = bounce.angVelZ * (0.85 + 0.3 * rimFactor);

        if (bounce.shouldPing) {
          impacts.push({
            pingClip: bounce.pingClip,
            impactForce: bounce.impactForce,
            isMicroBounce: bounce.isMicroBounce,
          });
          body.bounceCount++;
        }
        if (bounce.settled) {
          body.settled = true;
        }
      }
    } else {
      // Rolling resistance & friction decay while brass settles flush flat onto studio floor
      body.posX += body.velX * subDt;
      body.posZ += body.velZ * subDt;
      body.posY = body.floorY;

      const rollDrag = Math.exp(-5.6 * subDt);
      body.velX *= rollDrag;
      body.velZ *= rollDrag;
      if (Math.hypot(body.velX, body.velZ) < 0.004) {
        body.velX = 0;
        body.velZ = 0;
      }

      const spinDrag = Math.exp(-6.8 * subDt);
      body.angVelX *= spinDrag;
      body.angVelY *= spinDrag;
      body.angVelZ *= spinDrag;

      // Roll along floor yaw + settle cylinder axis horizontally (rotZ -> +-PI/2)
      body.rotY += body.angVelY * subDt;
      body.rotX += (body.velZ / Math.max(0.004, body.floorY)) * 0.12 * subDt;
      const targetFlatZ = body.rotZ >= 0 ? Math.PI / 2 : -Math.PI / 2;
      body.rotZ += (targetFlatZ - body.rotZ) * Math.min(1, subDt * 14);
    }
  }

  return impacts;
}

interface EjectedCasing {
  mesh: THREE.Mesh;
  body: CasingBodyState;
  life: number;
  maxLife: number;
}

interface BulletTracer {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface SmokePuff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  baseScale: number;
}

function createMuzzleFlashTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size * 0.5;
  const cy = size * 0.5;
  ctx.clearRect(0, 0, size, size);

  // Hot white-yellow core bloom
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, size * 0.46);
  g.addColorStop(0.0, 'rgba(255, 255, 240, 1.0)');
  g.addColorStop(0.18, 'rgba(255, 224, 130, 0.96)');
  g.addColorStop(0.45, 'rgba(255, 135, 36, 0.62)');
  g.addColorStop(0.75, 'rgba(255, 72, 12, 0.16)');
  g.addColorStop(1.0, 'rgba(255, 40, 0, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Sharp jagged gas star spikes
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    const sg = ctx.createLinearGradient(0, 0, 0, -size * 0.48);
    sg.addColorStop(0, 'rgba(255, 250, 220, 0.95)');
    sg.addColorStop(0.4, 'rgba(255, 165, 45, 0.72)');
    sg.addColorStop(1, 'rgba(255, 90, 15, 0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(0, -size * 0.48);
    ctx.lineTo(10, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createSmokeTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 58);
  g.addColorStop(0, 'rgba(225, 228, 232, 0.48)');
  g.addColorStop(0.5, 'rgba(180, 185, 192, 0.24)');
  g.addColorStop(1, 'rgba(160, 165, 175, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * High-impact Call-of-Duty Combat VFX System:
 * - Multi-card HDR muzzle flash + sideways tank-brake jets + warm PointLight
 * - Physics-driven spinning 3D brass casings & red 12G shotgun hulls with floor bounce
 * - High-speed bullet tracers (8-pellet buckshot spread for M870!)
 * - Rising muzzle gunpowder smoke puffs
 * - Toggleable red tactical laser beam + Glock weapon flashlight beam (`L` key)
 */
export class CombatFXSystem {
  private scene: THREE.Scene;
  private fxGroup: THREE.Group;

  // Muzzle flash multi-card assembly + warm dynamic PointLight
  private flashGroup: THREE.Group;
  private flashSideJets: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private flashTex: THREE.CanvasTexture;
  private flashMat: THREE.MeshBasicMaterial;

  // Smoke puff pool
  private smokeTex: THREE.CanvasTexture;
  private smokeGeo: THREE.PlaneGeometry;
  private smokes: SmokePuff[] = [];

  // Brass casing & shotgun hull shared geometries/materials
  private brassGeoSmall: THREE.CylinderGeometry;
  private brassGeoRifle: THREE.CylinderGeometry;
  private brassGeo338: THREE.CylinderGeometry;
  private hullGeo12g: THREE.CylinderGeometry;
  private brassMat: THREE.MeshStandardMaterial;
  private hullMat: THREE.MeshStandardMaterial;
  private casings: EjectedCasing[] = [];

  // Bullet tracers
  private tracerGeo: THREE.CylinderGeometry;
  private tracerMat: THREE.MeshBasicMaterial;
  private tracers: BulletTracer[] = [];

  // Tactical Laser Beam & Pistol Weapon Flashlight
  private laserBeam: THREE.Mesh;
  private laserDot: THREE.Mesh;
  private flashlightCone: THREE.Mesh;
  private flashlightSpot: THREE.SpotLight;
  private flashlightTarget: THREE.Object3D;

  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();
  private readonly _q1 = new THREE.Quaternion();
  private readonly _up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fxGroup = new THREE.Group();
    this.fxGroup.name = 'Combat_VFX_Group';
    this.fxGroup.userData.excludeFromGLB = true;
    this.scene.add(this.fxGroup);

    // 1. Multi-card HDR Muzzle Flash
    this.flashTex = createMuzzleFlashTexture();
    this.flashMat = new THREE.MeshBasicMaterial({
      map: this.flashTex,
      color: 0xffd27a,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.flashGroup = new THREE.Group();
    this.flashGroup.name = 'Muzzle_Flash_Cards';
    this.flashGroup.visible = false;

    const cardFront = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), this.flashMat);
    cardFront.position.z = 0.06;
    const cardHoriz = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.44), this.flashMat);
    cardHoriz.rotation.x = Math.PI / 2;
    cardHoriz.position.z = 0.18;
    const cardVert = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.44), this.flashMat);
    cardVert.rotation.x = Math.PI / 2;
    cardVert.rotation.z = Math.PI / 2;
    cardVert.position.z = 0.18;

    // Twin sideways tank-brake blast jets (activated for AWM .338 sniper!)
    this.flashSideJets = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.17), this.flashMat);
    this.flashSideJets.rotation.x = Math.PI / 2;
    this.flashSideJets.position.z = -0.02;
    this.flashSideJets.visible = false;

    this.flashGroup.add(cardFront, cardHoriz, cardVert, this.flashSideJets);
    this.fxGroup.add(this.flashGroup);

    this.flashLight = new THREE.PointLight(0xffae4a, 0, 5.2, 2);
    this.fxGroup.add(this.flashLight);

    // 2. Smoke puffs
    this.smokeTex = createSmokeTexture();
    this.smokeGeo = new THREE.PlaneGeometry(0.16, 0.16);

    // 3. Ejected 3D casings
    this.brassGeoSmall = new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 8);
    this.brassGeoRifle = new THREE.CylinderGeometry(0.0052, 0.0056, 0.044, 8);
    this.brassGeo338 = new THREE.CylinderGeometry(0.0074, 0.0078, 0.068, 10);
    this.hullGeo12g = new THREE.CylinderGeometry(0.0094, 0.0096, 0.058, 10);

    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xe4b552,
      metalness: 0.94,
      roughness: 0.2,
    });
    this.hullMat = new THREE.MeshStandardMaterial({
      color: 0xb81c1c,
      metalness: 0.12,
      roughness: 0.42,
    });

    // 4. High-speed bullet tracers
    this.tracerGeo = new THREE.CylinderGeometry(0.0032, 0.0014, 0.72, 6);
    this.tracerGeo.rotateX(Math.PI / 2);
    this.tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffe49a,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // 5. Tactical Red Laser Beam & Dot — pre-baked strictly from z = 0 to z = 1 so scaling Z hits exact crosshair distance!
    const laserGeo = new THREE.CylinderGeometry(0.0012, 0.0012, 1, 6);
    laserGeo.rotateX(Math.PI / 2);
    laserGeo.translate(0, 0, 0.5);
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xff1e1e,
      transparent: true,
      opacity: 0.68,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.laserBeam = new THREE.Mesh(laserGeo, laserMat);
    this.laserBeam.name = 'Tactical_Laser_Beam';
    this.laserBeam.userData.excludeFromGLB = true;
    this.laserBeam.visible = false;
    this.fxGroup.add(this.laserBeam);

    this.laserDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.011, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3b30 })
    );
    this.laserDot.name = 'Tactical_Laser_Dot';
    this.laserDot.userData.excludeFromGLB = true;
    this.laserDot.visible = false;
    this.fxGroup.add(this.laserDot);

    // 6. Glock Tactical Weaponlight Cone Helper (hidden when adsBlend > 0.70) + Pooled 22m SpotLight on weapon_light_socket
    const coneGeo = new THREE.ConeGeometry(0.42, 3.2, 16, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    coneGeo.translate(0, 0, 1.6);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xfff5dc,
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flashlightCone = new THREE.Mesh(coneGeo, coneMat);
    this.flashlightCone.name = 'Weaponlight_Volumetric_Cone';
    this.flashlightCone.userData.isLensHelper = true;
    this.flashlightCone.userData.excludeFromGLB = true;
    this.flashlightCone.visible = false;
    this.fxGroup.add(this.flashlightCone);

    this.flashlightSpot = new THREE.SpotLight(0xfff6e2, 0, 22, 0.42, 0.5, 1.5);
    this.flashlightSpot.name = 'Weaponlight_SpotLight';
    this.flashlightSpot.userData.excludeFromGLB = true;
    this.flashlightTarget = new THREE.Object3D();
    this.flashlightTarget.userData.excludeFromGLB = true;
    this.flashlightSpot.target = this.flashlightTarget;
    this.fxGroup.add(this.flashlightSpot, this.flashlightTarget);
  }

  public spawnShotFX(weapon: BuiltWeapon, weaponId: WeaponId, isAiming: boolean): void {
    const spec = WEAPON_SPECS[weaponId];
    weapon.root.updateMatrixWorld(true);
    weapon.muzzleTip.getWorldPosition(this._v1);
    weapon.root.getWorldQuaternion(this._q1);

    // 1. Trigger HDR Muzzle Flash + Dynamic PointLight
    this.flashGroup.position.copy(this._v1);
    this.flashGroup.quaternion.copy(this._q1);
    this.flashGroup.rotateZ(Math.random() * Math.PI * 2);
    this.flashGroup.scale.setScalar(spec.muzzleFlashScale * (0.9 + Math.random() * 0.28));
    this.flashSideJets.visible = weaponId === 'awm';
    this.flashGroup.visible = true;

    this.flashLight.position.copy(this._v1);
    this.flashLight.intensity = 18.0 * spec.muzzleFlashScale;

    // 2. Spawn High-Speed Bullet Tracers (8-pellet spread for M870 shotgun!)
    const spread = isAiming ? spec.adsSpreadRad : spec.spreadRad;
    const baseDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this._q1).normalize();
    const speed = weaponId === 'awm' ? 56 : weaponId === 'm870' ? 36 : 44;

    for (let p = 0; p < spec.pellets; p++) {
      const dir = baseDir.clone();
      dir.x += (Math.random() - 0.5) * spread * 2;
      dir.y += (Math.random() - 0.5) * spread * 2;
      dir.z += (Math.random() - 0.5) * spread * 0.6;
      dir.normalize();

      const tracer = new THREE.Mesh(this.tracerGeo, this.tracerMat);
      if (weaponId === 'awm') {
        tracer.scale.set(1.6, 1.6, 2.2);
      } else if (weaponId === 'm870') {
        tracer.scale.set(0.85, 0.85, 0.55);
      }
      tracer.position.copy(this._v1).addScaledVector(dir, 0.35);
      tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      this.fxGroup.add(tracer);
      this.tracers.push({
        mesh: tracer,
        vel: dir.multiplyScalar(speed),
        life: 0,
        maxLife: weaponId === 'awm' ? 0.35 : 0.22,
      });
    }

    // 3. Spawn rising muzzle gunpowder smoke puffs
    const puffCount = weaponId === 'm870' || weaponId === 'awm' ? 3 : 2;
    for (let i = 0; i < puffCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.smokeTex,
        transparent: true,
        opacity: 0.44,
        depthWrite: false,
      });
      const puff = new THREE.Mesh(this.smokeGeo, mat);
      puff.position
        .copy(this._v1)
        .addScaledVector(baseDir, 0.08 + i * 0.06)
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, 0));
      this.fxGroup.add(puff);
      this.smokes.push({
        mesh: puff,
        vel: baseDir
          .clone()
          .multiplyScalar(0.55 + Math.random() * 0.35)
          .add(new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.45 + Math.random() * 0.25, 0)),
        life: 0,
        maxLife: 0.72 + Math.random() * 0.35,
        baseScale: 0.55 + Math.random() * 0.45,
      });
    }
  }

  public spawnEjectedCasing(weapon: BuiltWeapon, weaponId: WeaponId): void {
    const spec = WEAPON_SPECS[weaponId];
    weapon.root.updateMatrixWorld(true);
    weapon.ejectionPort.getWorldPosition(this._v1);
    weapon.root.getWorldQuaternion(this._q1);

    let geo: THREE.BufferGeometry = this.brassGeoRifle;
    let mat: THREE.Material = this.brassMat;
    let floorY = 0.0065;

    if (spec.casingType === 'brass_9mm') {
      geo = this.brassGeoSmall;
      floorY = 0.0052;
    } else if (spec.casingType === 'brass_338') {
      geo = this.brassGeo338;
      floorY = 0.0085;
    } else if (spec.casingType === 'hull_12g') {
      geo = this.hullGeo12g;
      mat = this.hullMat;
      floorY = 0.01;
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.copy(this._v1);
    mesh.quaternion.copy(this._q1);
    mesh.rotateZ(Math.PI / 2);

    // Eject cleanly out to weapon's right side (-X in weapon space), upward (+Y), slightly rearward (-Z)!
    // Caliber-specific ejection vigor (AK 7.62 throws briskly, .338 bolt flicks heavier arc, 9mm arcs crisp)
    const speedMult =
      spec.casingType === 'brass_762'
        ? 1.18
        : spec.casingType === 'brass_338'
          ? 0.88
          : spec.casingType === 'brass_9mm'
            ? 0.94
            : 1.0;
    const ejectLocal = new THREE.Vector3(
      -(1.55 + Math.random() * 0.85) * speedMult,
      (1.15 + Math.random() * 0.65) * speedMult,
      -(0.28 + Math.random() * 0.48) * speedMult
    );
    const vel = ejectLocal.applyQuaternion(this._q1);

    this.fxGroup.add(mesh);
    this.casings.push({
      mesh,
      body: {
        posX: mesh.position.x,
        posY: mesh.position.y,
        posZ: mesh.position.z,
        velX: vel.x,
        velY: vel.y,
        velZ: vel.z,
        rotX: mesh.rotation.x,
        rotY: mesh.rotation.y,
        rotZ: mesh.rotation.z,
        angVelX: (Math.random() - 0.5) * 26,
        angVelY: (Math.random() - 0.5) * 24,
        angVelZ: 14 + Math.random() * 16,
        bounceCount: 0,
        casingType: spec.casingType,
        floorY,
        settled: false,
      },
      life: 0,
      maxLife: 3.8,
    });

    // Keep pool bounded for crisp performance
    while (this.casings.length > 36) {
      const oldest = this.casings.shift()!;
      this.fxGroup.remove(oldest.mesh);
    }
  }

  public update(
    dt: number,
    camera: THREE.Camera,
    activeWeapon: BuiltWeapon | null,
    activeWeaponId: WeaponId | 'none',
    muzzleFlashTimer: number,
    laserEnabled: boolean,
    opts?: {
      adsBlend?: number;
      hideLaser?: boolean;
      nightOp?: boolean;
      aimTargetWorld?: THREE.Vector3;
    }
  ): void {
    const adsBlend = opts?.adsBlend ?? 0;
    const hideLaser = opts?.hideLaser ?? false;
    const nightOp = opts?.nightOp ?? false;

    // 1. Fade HDR muzzle flash & warm light
    if (muzzleFlashTimer > 0 && activeWeapon) {
      activeWeapon.muzzleTip.getWorldPosition(this._v1);
      activeWeapon.root.getWorldQuaternion(this._q1);
      this.flashGroup.position.copy(this._v1);
      this.flashGroup.quaternion.copy(this._q1);
      this.flashGroup.visible = true;
      const frac = Math.min(1, muzzleFlashTimer / 0.068);
      this.flashLight.position.copy(this._v1);
      this.flashLight.intensity = 18.0 * frac;
    } else {
      this.flashGroup.visible = false;
      this.flashLight.intensity = 0;
    }

    // 2. Update tactical laser / pooled 22m weaponlight SpotLight after skeleton.updateMatrixWorld(true)
    if (activeWeapon && activeWeaponId !== 'none' && !hideLaser) {
      const spec = WEAPON_SPECS[activeWeaponId];
      activeWeapon.root.updateMatrixWorld(true);
      activeWeapon.root.getWorldQuaternion(this._q1);
      const fwd = this._v3.set(0, 0, 1).applyQuaternion(this._q1).normalize();

      // Pooled 22m SpotLight on weapon_light_socket: active on Night Operation or when Glock weaponlight toggled
      const spotOn = (spec.hasFlashlight && laserEnabled) || nightOp;
      if (spotOn) {
        activeWeapon.weaponLightSocket.getWorldPosition(this._v2);
        this.flashlightSpot.position.copy(this._v2);
        const lightTarget = opts?.aimTargetWorld
          ? opts.aimTargetWorld
          : this._v1.copy(this._v2).addScaledVector(fwd, 12);
        this.flashlightTarget.position.copy(lightTarget);
        this.flashlightSpot.intensity = nightOp ? 28 : 18;

        // Hide translucent volumetric cone helper when adsBlend > 0.70 so zero disc floats over crosshair!
        const showCone = spec.hasFlashlight && laserEnabled && adsBlend <= 0.70;
        this.flashlightCone.visible = showCone;
        if (showCone) {
          this.flashlightCone.position.copy(this._v2);
          this.flashlightCone.quaternion.copy(this._q1);
        }
      } else {
        this.flashlightCone.visible = false;
        this.flashlightSpot.intensity = 0;
      }

      // Crosshair-converged barrel laser beam (pre-baked z=0..1, scaled to exact raycast hit distance!)
      if (laserEnabled && !spec.hasFlashlight) {
        activeWeapon.laserSocket.getWorldPosition(this._v2);
        const targetPt = opts?.aimTargetWorld
          ? this._v1.copy(opts.aimTargetWorld)
          : this._v1.copy(this._v2).addScaledVector(fwd, 14);
        const dist = Math.max(0.25, Math.min(28, this._v2.distanceTo(targetPt)));
        const dir = this._v3.copy(targetPt).sub(this._v2).normalize();

        this.laserBeam.visible = true;
        this.laserBeam.position.copy(this._v2);
        this.laserBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        this.laserBeam.scale.set(1, 1, dist);

        this.laserDot.visible = true;
        this.laserDot.position.copy(this._v2).addScaledVector(dir, dist);
      } else {
        this.laserBeam.visible = false;
        this.laserDot.visible = false;
      }
    } else {
      this.laserBeam.visible = false;
      this.laserDot.visible = false;
      this.flashlightCone.visible = false;
      this.flashlightSpot.intensity = 0;
    }

    // 3. Step spinning ejected 3D casings with gravity & studio floor bounce
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life += dt;
      if (c.life >= c.maxLife) {
        this.fxGroup.remove(c.mesh);
        this.casings.splice(i, 1);
        continue;
      }
      const impacts = stepCasingPhysics(c.body, dt);
      for (const imp of impacts) {
        weaponAudio.playShellPingClip(imp.pingClip, c.body.casingType, imp.impactForce);
      }
      c.mesh.position.set(c.body.posX, c.body.posY, c.body.posZ);
      c.mesh.rotation.set(c.body.rotX, c.body.rotY, c.body.rotZ);
    }

    // 4. Step high-speed bullet tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life += dt;
      if (tr.life >= tr.maxLife) {
        this.fxGroup.remove(tr.mesh);
        this.tracers.splice(i, 1);
        continue;
      }
      tr.mesh.position.addScaledVector(tr.vel, dt);
    }

    // 5. Step rising gunpowder smoke puffs (billboarded to camera)
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const sm = this.smokes[i];
      sm.life += dt;
      if (sm.life >= sm.maxLife) {
        (sm.mesh.material as THREE.Material).dispose();
        this.fxGroup.remove(sm.mesh);
        this.smokes.splice(i, 1);
        continue;
      }
      const u = sm.life / sm.maxLife;
      sm.mesh.position.addScaledVector(sm.vel, dt);
      sm.vel.multiplyScalar(1 - Math.min(0.9, dt * 1.8));
      sm.vel.y += 0.12 * dt;
      const sc = sm.baseScale * (1 + u * 2.4);
      sm.mesh.scale.setScalar(sc);
      sm.mesh.quaternion.copy(camera.quaternion);
      (sm.mesh.material as THREE.MeshBasicMaterial).opacity = 0.42 * (1 - u) * (1 - u);
    }
  }

  public clearDynamic(): void {
    this.flashGroup.visible = false;
    this.flashLight.intensity = 0;
    for (const c of this.casings) this.fxGroup.remove(c.mesh);
    this.casings.length = 0;
    for (const tr of this.tracers) this.fxGroup.remove(tr.mesh);
    this.tracers.length = 0;
    for (const sm of this.smokes) {
      (sm.mesh.material as THREE.Material).dispose();
      this.fxGroup.remove(sm.mesh);
    }
    this.smokes.length = 0;
  }

  public dispose(): void {
    this.clearDynamic();
    this.flashTex.dispose();
    this.flashMat.dispose();
    this.smokeTex.dispose();
    this.smokeGeo.dispose();
    this.brassGeoSmall.dispose();
    this.brassGeoRifle.dispose();
    this.brassGeo338.dispose();
    this.hullGeo12g.dispose();
    this.brassMat.dispose();
    this.hullMat.dispose();
    this.tracerGeo.dispose();
    this.tracerMat.dispose();
    (this.laserBeam.geometry as THREE.BufferGeometry).dispose();
    (this.laserBeam.material as THREE.Material).dispose();
    (this.laserDot.geometry as THREE.BufferGeometry).dispose();
    (this.laserDot.material as THREE.Material).dispose();
    (this.flashlightCone.geometry as THREE.BufferGeometry).dispose();
    (this.flashlightCone.material as THREE.Material).dispose();
    this.scene.remove(this.fxGroup);
  }
}
