import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WeaponId } from './weaponTypes';
import { WeaponMaterialLibrary } from './weaponMaterials';

export interface LiveAmmoVisuals {
  /** Individual crimson 12G shells on M870 side saddle (index 0..5) */
  saddleShells: THREE.Object3D[];
  /** Live stacked cartridges visible through translucent mag windows or witness slots (index 0 = top) */
  windowCartridges: THREE.Object3D[];
  /** Top live cartridge seated in feed lips (visible when magazine detaches during reload!) */
  topFeedRound: THREE.Object3D | null;
  /** High-visibility anti-tilt follower that physically rises up the magazine as rounds are expended */
  followerMesh: THREE.Object3D | null;
  /** Optional chamber/breech live cartridge visible when bolt or slide retracts */
  breechRound: THREE.Object3D | null;
  /** Synchronizes all 3D live ammo visuals with real-time magazine count, bolt travel, and reload stage */
  syncLiveAmmo: (
    magCount: number,
    magSize: number,
    isReloading: boolean,
    reloadProgress: number,
    preReloadMag: number,
    reserve: number,
    boltTravel?: number
  ) => void;
}

export interface BuiltWeapon {
  id: WeaponId;
  root: THREE.Group;
  gripRight: THREE.Object3D;
  gripLeft: THREE.Object3D;
  muzzleTip: THREE.Object3D;
  ejectionPort: THREE.Object3D;
  magPivot: THREE.Group;
  boltOrSlide: THREE.Group;
  triggerPivot: THREE.Group;
  laserOrigin: THREE.Object3D;
  boltRestPos: THREE.Vector3;
  boltRestRot: THREE.Euler;
  magRestPos: THREE.Vector3;
  magRestRot: THREE.Euler;
  boltTravelMax: number;
  boltLiftMax: number;
  liveAmmo: LiveAmmoVisuals;
  dispose: () => void;
}

/**
 * Normalize geometry attributes so BufferGeometryUtils.mergeGeometries never fails
 * and glTF validation always sees clean non-indexed/indexed position + normal + uv.
 */
export function normalizeForMerge(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.attributes.normal) {
    g.computeVertexNormals();
  }
  if (!g.attributes.uv) {
    const count = g.attributes.position.count;
    const uvs = new Float32Array(count * 2);
    const pos = g.attributes.position;
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = pos.getZ(i) * 4.0 + pos.getX(i) * 2.0;
      uvs[i * 2 + 1] = pos.getY(i) * 4.0;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  // Remove tangent or color attributes if inconsistent
  if (g.attributes.color) g.deleteAttribute('color');
  if (g.attributes.tangent) g.deleteAttribute('tangent');
  return g;
}

export function safeMergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized = geos.map(normalizeForMerge);
  const merged = mergeGeometries(normalized, false);
  for (const n of normalized) n.dispose();
  if (!merged) {
    throw new Error('Failed to merge weapon geometries');
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Extrudes a 2D side-profile defined in weapon (z, y) coordinates symmetrically along X.
 * Weapon forward is +Z, up is +Y, left is +X, right is -X.
 */
export function createSideExtrudeGeo(
  zyPoints: [number, number][],
  widthX: number,
  bevelSize = 0.0022,
  bevelThickness = 0.0022,
  bevelSegments = 2
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(zyPoints[0][0], zyPoints[0][1]);
  for (let i = 1; i < zyPoints.length; i++) {
    shape.lineTo(zyPoints[i][0], zyPoints[i][1]);
  }
  shape.closePath();

  const depth = Math.max(0.001, widthX - bevelThickness * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelSize > 0,
    bevelThickness,
    bevelSize,
    bevelSegments,
    curveSegments: 8,
  });

  // ExtrudeGeometry lays shape in XY and extrudes along +Z.
  // Center extrusion around Z=0, then rotateY(-PI/2) so shape X -> weapon +Z and extrusion Z -> weapon -X!
  geo.translate(0, 0, -depth * 0.5);
  geo.rotateY(-Math.PI / 2);

  // Clean planar side-projection UVs so gunmetal/wood/bakelite grain flows along barrel Z!
  const pos = geo.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = pos.getZ(i) * 3.8 + pos.getX(i) * 1.5;
    uvs[i * 2 + 1] = pos.getY(i) * 3.8;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates a LatheGeometry rotated cleanly along the weapon's +Z axis.
 * Pairs are [radius, zPosition].
 */
export function createLatheAlongZ(
  rzPairs: [number, number][],
  radialSegments = 20
): THREE.BufferGeometry {
  const pts = rzPairs.map(([r, z]) => new THREE.Vector2(Math.max(0.0002, r), z));
  const geo = new THREE.LatheGeometry(pts, radialSegments);
  // Lathe revolves around +Y -> rotateX(+PI/2) maps +Y to +Z!
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a realistic MIL-STD-1913 Picatinny rail with beveled dovetail base & crisp cross-slots.
 */
export function createPicatinnyRailGeo(
  zStart: number,
  zEnd: number,
  yBase: number,
  width = 0.0212,
  height = 0.0085,
  slotPitch = 0.01
): THREE.BufferGeometry {
  const length = Math.max(0.02, zEnd - zStart);
  const geos: THREE.BufferGeometry[] = [];

  // Tapered dovetail spine base
  const baseGeo = new THREE.BoxGeometry(width * 0.8, height * 0.55, length);
  baseGeo.translate(0, yBase + height * 0.275, zStart + length * 0.5);
  geos.push(baseGeo);

  // Crisp machined rail teeth separated by cross-slots
  const count = Math.max(2, Math.floor(length / slotPitch));
  const toothLen = slotPitch * 0.56;
  const startOffset = zStart + (length - count * slotPitch) * 0.5 + slotPitch * 0.5;
  for (let i = 0; i < count; i++) {
    const z = startOffset + i * slotPitch;
    const lug = new THREE.BoxGeometry(width, height * 0.52, toothLen);
    lug.translate(0, yBase + height * 0.76, z);
    geos.push(lug);
  }

  return safeMergeGeometries(geos);
}

/**
 * Sweeps a beveled rectangular/hexagonal magazine cross-section along a curved spine
 * for authentic curved STANAG and deep-curve AK Bakelite banana magazines.
 */
export function createCurvedMagGeo(
  spineZY: [number, number][],
  widthX: number,
  depthZ: number,
  ribCount = 0
): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const halfW = widthX * 0.5;
  const halfD = depthZ * 0.5;

  // Build lofted prism rings with subtle side chamfer
  const ringProfile: [number, number][] = [
    [-halfW * 0.84, -halfD],
    [halfW * 0.84, -halfD],
    [halfW, -halfD * 0.72],
    [halfW, halfD * 0.72],
    [halfW * 0.84, halfD],
    [-halfW * 0.84, halfD],
    [-halfW, halfD * 0.72],
    [-halfW, -halfD * 0.72],
  ];

  const ringCount = spineZY.length;
  const ptsPerRing = ringProfile.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const rings3D: THREE.Vector3[][] = [];
  for (let i = 0; i < ringCount; i++) {
    const [z, y] = spineZY[i];
    // Tangent along spine in ZY plane
    const prev = spineZY[Math.max(0, i - 1)];
    const next = spineZY[Math.min(ringCount - 1, i + 1)];
    const tz = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const tLen = Math.hypot(tz, ty) || 1;
    // Normal perpendicular to spine (pointing forward +Z)
    const nz = -ty / tLen;
    const ny = tz / tLen;

    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < ptsPerRing; j++) {
      const [rx, rd] = ringProfile[j];
      const vx = rx;
      const vz = z + nz * rd;
      const vy = y + ny * rd;
      ring.push(new THREE.Vector3(vx, vy, vz));
      positions.push(vx, vy, vz);
      uvs.push(j / ptsPerRing, i / Math.max(1, ringCount - 1));
    }
    rings3D.push(ring);
  }

  for (let i = 0; i < ringCount - 1; i++) {
    const r0 = i * ptsPerRing;
    const r1 = (i + 1) * ptsPerRing;
    for (let j = 0; j < ptsPerRing; j++) {
      const jn = (j + 1) % ptsPerRing;
      indices.push(r0 + j, r1 + j, r1 + jn);
      indices.push(r0 + j, r1 + jn, r0 + jn);
    }
  }

  // Bottom floorplate cap
  const botCenterIdx = positions.length / 3;
  const lastSpine = spineZY[ringCount - 1];
  positions.push(0, lastSpine[1], lastSpine[0]);
  uvs.push(0.5, 1);
  const lastRingStart = (ringCount - 1) * ptsPerRing;
  for (let j = 0; j < ptsPerRing; j++) {
    const jn = (j + 1) % ptsPerRing;
    indices.push(lastRingStart + j, botCenterIdx, lastRingStart + jn);
  }

  // Top feed-lip cap
  const topCenterIdx = positions.length / 3;
  const firstSpine = spineZY[0];
  positions.push(0, firstSpine[1], firstSpine[0]);
  uvs.push(0.5, 0);
  for (let j = 0; j < ptsPerRing; j++) {
    const jn = (j + 1) % ptsPerRing;
    indices.push(j, jn, topCenterIdx);
  }

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  bodyGeo.setIndex(indices);
  bodyGeo.computeVertexNormals();
  geos.push(bodyGeo);

  // Base floorplate flange lip
  const lastPrev = spineZY[ringCount - 2];
  const botAngle = Math.atan2(lastSpine[0] - lastPrev[0], lastPrev[1] - lastSpine[1]);
  const basePlate = new THREE.BoxGeometry(widthX * 1.12, 0.008, depthZ * 1.12);
  basePlate.rotateX(-botAngle);
  basePlate.translate(0, lastSpine[1] - 0.003, lastSpine[0]);
  geos.push(basePlate);

  // Optional stamped side reinforcing ribs (STANAG / steel AK mag)
  for (let r = 0; r < ribCount; r++) {
    const u = 0.25 + (r / Math.max(1, ribCount)) * 0.55;
    const idx = Math.min(ringCount - 2, Math.floor(u * (ringCount - 1)));
    const pA = spineZY[idx];
    const pB = spineZY[idx + 1];
    const ang = Math.atan2(pB[0] - pA[0], pA[1] - pB[1]);
    const rib = new THREE.BoxGeometry(widthX * 1.08, 0.005, depthZ * 0.72);
    rib.rotateX(-ang);
    rib.translate(0, (pA[1] + pB[1]) * 0.5, (pA[0] + pB[0]) * 0.5);
    geos.push(rib);
  }

  return safeMergeGeometries(geos);
}

/** Creates a visible 12-gauge crimson shotgun shell with brass base */
export function createShotgunShellGroup(
  mats: WeaponMaterialLibrary,
  namePrefix = 'Shell12G'
): THREE.Group {
  const g = new THREE.Group();
  g.name = namePrefix;

  const brassGeo = new THREE.CylinderGeometry(0.0094, 0.0098, 0.017, 14);
  brassGeo.translate(0, -0.022, 0);
  const brass = new THREE.Mesh(brassGeo, mats.cartridgeBrass);
  brass.name = `${namePrefix}_Brass`;
  brass.castShadow = true;

  const rimGeo = new THREE.CylinderGeometry(0.0106, 0.0106, 0.0025, 14);
  rimGeo.translate(0, -0.031, 0);
  const rim = new THREE.Mesh(rimGeo, mats.cartridgeBrass);
  rim.name = `${namePrefix}_Rim`;

  const hullGeo = new THREE.CylinderGeometry(0.0092, 0.0093, 0.044, 14);
  hullGeo.translate(0, 0.008, 0);
  const hull = new THREE.Mesh(hullGeo, mats.shotgunHullRed);
  hull.name = `${namePrefix}_Hull`;
  hull.castShadow = true;

  g.add(brass, rim, hull);
  return g;
}

export type CartridgeCaliber = '556' | '762' | '338' | '9mm';

/**
 * Creates a realistic scaled brass casing + FMJ copper-jacketed projectile pointing along +Z.
 * Used inside translucent magazine windows, feed lips, and open rifle/pistol breeches.
 */
export function createCartridgeGroup(
  mats: WeaponMaterialLibrary,
  caliber: CartridgeCaliber,
  namePrefix = 'Cartridge'
): THREE.Group {
  const specs: Record<
    CartridgeCaliber,
    { caseR: number; caseLen: number; neckR: number; bulletLen: number }
  > = {
    '556': { caseR: 0.0046, caseLen: 0.036, neckR: 0.0031, bulletLen: 0.017 },
    '762': { caseR: 0.0054, caseLen: 0.034, neckR: 0.004, bulletLen: 0.018 },
    '338': { caseR: 0.0072, caseLen: 0.052, neckR: 0.0046, bulletLen: 0.026 },
    '9mm': { caseR: 0.0047, caseLen: 0.018, neckR: 0.0044, bulletLen: 0.01 },
  };
  const s = specs[caliber];
  const halfTot = (s.caseLen + s.bulletLen) * 0.5;
  const z0 = -halfTot;

  const g = new THREE.Group();
  g.name = namePrefix;

  const caseGeo = createLatheAlongZ(
    [
      [s.caseR * 1.04, z0],
      [s.caseR * 1.04, z0 + 0.0025],
      [s.caseR * 0.9, z0 + 0.004],
      [s.caseR, z0 + 0.006],
      [s.caseR * 0.96, z0 + s.caseLen * 0.78],
      [s.neckR * 1.05, z0 + s.caseLen * 0.9],
      [s.neckR * 1.05, z0 + s.caseLen],
    ],
    10
  );
  const caseMesh = new THREE.Mesh(caseGeo, mats.cartridgeBrass);
  caseMesh.name = `${namePrefix}_Brass`;

  const bulletGeo = createLatheAlongZ(
    [
      [s.neckR, z0 + s.caseLen - 0.001],
      [s.neckR * 0.96, z0 + s.caseLen + s.bulletLen * 0.35],
      [s.neckR * 0.58, z0 + s.caseLen + s.bulletLen * 0.74],
      [0.0005, z0 + s.caseLen + s.bulletLen],
    ],
    10
  );
  const bulletMesh = new THREE.Mesh(bulletGeo, mats.bulletCopper);
  bulletMesh.name = `${namePrefix}_Bullet`;

  g.add(caseMesh, bulletMesh);
  return g;
}

/**
 * Pure deterministic helper mapping live magazine rounds to visible slots (0..slotCount).
 * Guarantees:
 * - Full mag -> all slots visible
 * - First shot immediately shows depletion (when slotCount < magSize)
 * - 1 round remaining -> at least 1 visible round
 * - 0 rounds remaining -> 0 visible rounds
 */
export function computeVisibleSlotCount(
  magCount: number,
  magSize: number,
  slotCount: number
): number {
  const clamped = Math.max(0, Math.min(magSize, Math.floor(magCount)));
  if (clamped <= 0 || slotCount <= 0) return 0;
  if (clamped >= magSize) return slotCount;
  if (slotCount >= magSize) return clamped;
  // Map 1..(magSize-1) smoothly onto 1..(slotCount-1) so shot #1 immediately removes a visible round/shell!
  const ratio = (clamped - 1) / Math.max(1, magSize - 2);
  return Math.max(1, Math.min(slotCount - 1, 1 + Math.round(ratio * (slotCount - 2))));
}

/**
 * Computes effective live ammo displayed on a magazine during reload:
 * - Before fetch_mag (progress < 0.36): detached spent magazine shows preReloadMag!
 * - From fetch_mag onward (progress >= 0.36): fresh magazine from belt pouch shows post-reload ammo!
 */
export function getDisplayedMagRounds(
  magCount: number,
  magSize: number,
  isReloading: boolean,
  reloadProgress: number,
  preReloadMag: number,
  reserve: number
): number {
  if (!isReloading) return magCount;
  if (reloadProgress < 0.36) return preReloadMag;
  // Fresh magazine fetched from tactical belt pouch
  const targetRefill = Math.min(magSize, preReloadMag + reserve);
  return Math.max(magCount, targetRefill);
}

/**
 * Computes how many of the 6 visible crimson shells on the M870 side saddle are displayed.
 * Depletes visibly as shots are fired (8 -> 6, 7 -> 5, ..., 0 -> 0) and refills smoothly shell-by-shell during reload!
 */
export function computeM870SaddleShellCount(
  magCount: number,
  magSize: number,
  isReloading: boolean,
  reloadProgress: number,
  preReloadMag: number,
  reserve: number
): number {
  if (!isReloading) {
    return computeVisibleSlotCount(magCount, magSize, 6);
  }
  const startShells = computeVisibleSlotCount(preReloadMag, magSize, 6);
  const targetMag = Math.min(magSize, Math.max(magCount, preReloadMag + reserve));
  const targetShells = computeVisibleSlotCount(targetMag, magSize, 6);
  // Refill shells smoothly across thumb-feed phase (0.14 -> 0.72)
  const fillU = Math.max(0, Math.min(1, (reloadProgress - 0.14) / 0.58));
  return Math.round(startShells + (targetShells - startShells) * fillU);
}

export interface WindowedMagOptions {
  spineZY: [number, number][];
  widthX: number;
  depthZ: number;
  caliber: CartridgeCaliber;
  stackSlots: number;
  bodyMat: THREE.Material;
  windowMat: THREE.Material;
  mats: WeaponMaterialLibrary;
  namePrefix: string;
  ribCount?: number;
}

/**
 * Builds a high-detail tactical magazine with genuine dual-sided translucent ammo windows,
 * structural front/rear rails, internal stacked brass+copper cartridges, dark coil spring,
 * rising orange anti-tilt follower, and a gleaming top feed-lip round!
 */
export function buildWindowedMagazineGroup(
  targetPivot: THREE.Group,
  opts: WindowedMagOptions
): LiveAmmoVisuals {
  const { spineZY, widthX, depthZ, caliber, stackSlots, bodyMat, windowMat, mats, namePrefix } =
    opts;
  const ringCount = spineZY.length;

  // Helper to evaluate interpolated point & spine tangent/normal at u in [0..1] (0 = top, 1 = bottom)
  const evalSpine = (u: number) => {
    const f = Math.max(0, Math.min(1, u)) * (ringCount - 1);
    const i0 = Math.min(ringCount - 2, Math.floor(f));
    const i1 = i0 + 1;
    const t = f - i0;
    const z = THREE.MathUtils.lerp(spineZY[i0][0], spineZY[i1][0], t);
    const y = THREE.MathUtils.lerp(spineZY[i0][1], spineZY[i1][1], t);
    const tz = spineZY[i1][0] - spineZY[i0][0];
    const ty = spineZY[i1][1] - spineZY[i0][1];
    const angle = Math.atan2(tz, -ty); // Forward curve pitch around X
    return { z, y, angle };
  };

  // 1. Structural opaque magazine frame:
  //    - Upper opaque feed collar (u: 0.0 -> 0.20)
  //    - Lower opaque floorplate collar (u: 0.84 -> 1.0)
  //    - Front & rear structural curved frame rails framing the open translucent side windows!
  const frameGeos: THREE.BufferGeometry[] = [];
  const halfD = depthZ * 0.5;
  const railDepth = depthZ * 0.24;

  // Upper collar & lower base blocks along spine segments (generous overlap eliminates curved outer-arc V-notches!)
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    const uMid = (u0 + u1) * 0.5;
    const p0 = evalSpine(u0);
    const p1 = evalSpine(u1);
    const pM = evalSpine(uMid);
    const chordLen = Math.hypot(p1.z - p0.z, p1.y - p0.y);
    const segLen = chordLen * 1.24 + 0.004;

    if (uMid < 0.19 || uMid > 0.85) {
      // Full-width solid collar at top feed lips and bottom base
      const blk = new THREE.BoxGeometry(widthX, segLen, depthZ);
      blk.rotateX(-pM.angle);
      blk.translate(0, pM.y, pM.z);
      frameGeos.push(blk);
    } else {
      // Windowed section: front wall rail + rear wall rail leaving a clean see-through cavity on BOTH flanks!
      const frontRail = new THREE.BoxGeometry(widthX, segLen, railDepth);
      frontRail.translate(0, 0, halfD - railDepth * 0.5);
      frontRail.rotateX(-pM.angle);
      frontRail.translate(0, pM.y, pM.z);
      frameGeos.push(frontRail);

      const rearRail = new THREE.BoxGeometry(widthX, segLen, railDepth);
      rearRail.translate(0, 0, -(halfD - railDepth * 0.5));
      rearRail.rotateX(-pM.angle);
      rearRail.translate(0, pM.y, pM.z);
      frameGeos.push(rearRail);
    }
  }

  // Floorplate lip at bottom of magazine
  const bot = evalSpine(1);
  const floorPlate = new THREE.BoxGeometry(widthX * 1.14, 0.0085, depthZ * 1.14);
  floorPlate.rotateX(-bot.angle);
  floorPlate.translate(0, bot.y - 0.004, bot.z);
  frameGeos.push(floorPlate);

  // Subtle horizontal reinforcing ribs across window rails
  const ribCount = opts.ribCount ?? 2;
  for (let r = 0; r < ribCount; r++) {
    const ru = 0.34 + (r / Math.max(1, ribCount)) * 0.38;
    const pr = evalSpine(ru);
    const rib = new THREE.BoxGeometry(widthX * 1.07, 0.0042, depthZ * 1.04);
    rib.rotateX(-pr.angle);
    rib.translate(0, pr.y, pr.z);
    frameGeos.push(rib);
  }

  targetPivot.add(makePart(safeMergeGeometries(frameGeos), bodyMat, `${namePrefix}_BodyFrame`));

  // 2. Dark internal compression spring coils — individually toggled strictly BELOW the rising orange follower!
  //    When magazine is full, all coils stay compressed below the follower so brass cartridges gleam completely unobstructed.
  const springCoils: { mesh: THREE.Mesh; u: number }[] = [];
  for (let sIdx = 0; sIdx < 8; sIdx++) {
    const su = 0.25 + (sIdx / 7) * 0.57;
    const ps = evalSpine(su);
    const coilGeo = new THREE.BoxGeometry(widthX * 0.28, 0.0022, depthZ * 0.42);
    coilGeo.rotateX(-ps.angle + (sIdx % 2 === 0 ? 0.22 : -0.22));
    coilGeo.translate(0, ps.y, ps.z);
    const coilMesh = makePart(coilGeo, mats.gunmetalSteel, `${namePrefix}_Spring_${sIdx + 1}`);
    coilMesh.castShadow = false;
    coilMesh.visible = false; // Full mag compresses spring beneath follower
    targetPivot.add(coilMesh);
    springCoils.push({ mesh: coilMesh, u: su });
  }

  // 3. Internal live brass + copper cartridge stack (index 0 = top of window, index N-1 = bottom of window!)
  //    In real spring-fed magazines, rounds rise UP from the bottom as you fire, so bottom slots empty first!
  const windowCartridges: THREE.Object3D[] = [];
  const winStartU = 0.21;
  const winEndU = 0.81;
  for (let i = 0; i < stackSlots; i++) {
    const u = THREE.MathUtils.lerp(winStartU, winEndU, i / Math.max(1, stackSlots - 1));
    const p = evalSpine(u);
    const round = createCartridgeGroup(mats, caliber, `${namePrefix}_Round_${i + 1}`);
    // Double-stack stagger left/right inside magazine walls so brass gleams clearly through BOTH side windows!
    const staggerX = (i % 2 === 0 ? 1 : -1) * (widthX * 0.14);
    round.position.set(staggerX, p.y, p.z);
    round.rotation.x = -p.angle * 0.45;
    targetPivot.add(round);
    windowCartridges.push(round);
  }

  // 4. High-visibility orange anti-tilt spring follower sitting directly beneath the live brass stack!
  const followerGeo = new THREE.BoxGeometry(widthX * 0.72, 0.0085, depthZ * 0.56);
  const followerMesh = makePart(followerGeo, mats.magFollowerOrange, `${namePrefix}_Follower`);
  followerMesh.castShadow = false;
  const initF = evalSpine(0.84);
  followerMesh.position.set(0, initF.y, initF.z);
  followerMesh.rotation.x = -initF.angle;
  targetPivot.add(followerMesh);

  // 5. Top feed-lip live cartridge (gleams at top of magazine when detached during reload!)
  const topP = evalSpine(0.0);
  const topFeedRound = createCartridgeGroup(mats, caliber, `${namePrefix}_TopFeedRound`);
  topFeedRound.position.set(0, topP.y + 0.0035, topP.z);
  topFeedRound.rotation.x = -0.05;
  targetPivot.add(topFeedRound);

  // 6. Dual-sided Translucent Smoked-Polymer / Bakelite Ammo Windows covering both +X and -X flanks
  const windowGeos: THREE.BufferGeometry[] = [];
  const winDepth = depthZ - railDepth * 1.88;
  for (let i = 0; i < segs; i++) {
    const u0 = i / segs;
    const u1 = (i + 1) / segs;
    const uMid = (u0 + u1) * 0.5;
    if (uMid < 0.19 || uMid > 0.85) continue;
    const p0 = evalSpine(u0);
    const p1 = evalSpine(u1);
    const pM = evalSpine(uMid);
    const segLen = Math.hypot(p1.z - p0.z, p1.y - p0.y) * 1.12 + 0.002;
    for (const side of [-1, 1]) {
      const pane = new THREE.BoxGeometry(0.0014, segLen, winDepth);
      pane.rotateX(-pM.angle);
      pane.translate(side * (widthX * 0.475), pM.y, pM.z);
      windowGeos.push(pane);
    }
  }
  const windowMesh = makePart(
    safeMergeGeometries(windowGeos),
    windowMat,
    `${namePrefix}_TranslucentWindow`
  );
  windowMesh.castShadow = false;
  windowMesh.renderOrder = 4;
  targetPivot.add(windowMesh);

  const liveAmmo: LiveAmmoVisuals = {
    saddleShells: [],
    windowCartridges,
    topFeedRound,
    followerMesh,
    breechRound: null,
    syncLiveAmmo: (
      magCount,
      magSize,
      isReloading,
      reloadProgress,
      preReloadMag,
      reserve,
      boltTravel = 0
    ) => {
      const displayRounds = getDisplayedMagRounds(
        magCount,
        magSize,
        isReloading,
        reloadProgress,
        preReloadMag,
        reserve
      );
      const visibleCount = computeVisibleSlotCount(displayRounds, magSize, stackSlots);
      // Real spring physics: top cartridges (indices 0..visibleCount-1) stay packed at top;
      // bottom slots empty as spring pushes stack & orange follower UPWARD!
      for (let i = 0; i < windowCartridges.length; i++) {
        windowCartridges[i].visible = i < visibleCount;
      }
      if (topFeedRound) {
        topFeedRound.visible = displayRounds > 0;
      }
      // Follower rises directly beneath the bottom-most visible cartridge (u = 0.84 when full -> 0.21 when empty)!
      const fU =
        visibleCount <= 0
          ? 0.21
          : Math.min(
              0.845,
              THREE.MathUtils.lerp(winStartU, winEndU, (visibleCount - 1) / Math.max(1, stackSlots - 1)) +
                0.045
            );
      if (followerMesh) {
        const fp = evalSpine(fU);
        followerMesh.position.set(0, fp.y, fp.z);
        followerMesh.rotation.x = -fp.angle;
      }
      // Show ONLY spring coils strictly BELOW the follower (never overlapping live brass cartridges!)
      for (const coil of springCoils) {
        coil.mesh.visible = coil.u > fU + 0.04;
      }
      if (liveAmmo.breechRound) {
        liveAmmo.breechRound.visible = magCount > 0 && boltTravel > 0.14;
      }
    },
  };

  return liveAmmo;
}

/** Helper to wrap a geometry in a shadow-casting named mesh */
export function makePart(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  name: string,
  pos?: [number, number, number],
  rot?: [number, number, number]
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  return mesh;
}
