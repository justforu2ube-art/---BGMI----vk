import * as THREE from 'three';
import { applyCreasedNormals, bakeDihedralEdgeWear } from '../character/geometryUtils';

/**
 * Paint uniform vertex COLOR_0 on a geometry (used for polymer tints, FDE tan, wood, crimson shells, brass)
 * while optionally preserving dihedral edge wear on gunmetal parts.
 */
export function tintGeometryVertexColor(
  geo: THREE.BufferGeometry,
  hex: number,
  options?: { isGunmetal?: boolean; wearStrength?: number }
): THREE.BufferGeometry {
  if (options?.isGunmetal) {
    bakeDihedralEdgeWear(geo, options.wearStrength ?? 0.9);
    if (hex !== 0xffffff) {
      const tint = new THREE.Color(hex);
      const col = geo.attributes.color;
      for (let i = 0; i < col.count; i++) {
        // Preserve edgeWear delta (g - r) while tinting base
        const r0 = col.getX(i);
        const g0 = col.getY(i);
        const wearDelta = Math.max(0, g0 - r0);
        const nr = Math.min(1, r0 * tint.r);
        const ng = Math.min(1, nr + wearDelta);
        const nb = Math.min(1, col.getZ(i) * tint.b);
        col.setXYZ(i, nr, ng, nb);
      }
    }
    return geo;
  }

  const c = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}

/**
 * Create a chamfered/beveled hard-surface box using THREE.ExtrudeGeometry (bevelEnabled: true, bevelSegments: 2)
 * followed by toCreasedNormals(degToRad(35)) and dihedral curvature edge wear baking.
 */
export function createChamferedBoxGeo(
  width: number,
  height: number,
  depth: number,
  bevel = 0.0022,
  isGunmetal = true,
  tintHex = 0xffffff
): THREE.BufferGeometry {
  const b = Math.min(bevel, width * 0.25, height * 0.25, depth * 0.25);
  const hw = Math.max(0.0008, width * 0.5 - b);
  const hh = Math.max(0.0008, height * 0.5 - b);
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments: 2,
  });
  raw.center();
  const creased = applyCreasedNormals(raw, 35);
  raw.dispose();
  return tintGeometryVertexColor(creased, tintHex, { isGunmetal });
}

/**
 * Create an extruded 2D silhouette along X (centered) with beveled edges (bevelSegments: 2)
 * + toCreasedNormals(35 deg) — ideal for AWM thumbhole chassis, chamfered receivers,
 * EOTech/Kobra/RMR optic hoods, and ergonomic pistol grips!
 */
export function createBeveledProfileGeo(
  points: Array<[number, number]>,
  thicknessX: number,
  bevel = 0.0024,
  holes?: Array<Array<[number, number]>>,
  isGunmetal = false,
  tintHex = 0xffffff
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < points.length; i++) {
    const [z, y] = points[i];
    if (i === 0) shape.moveTo(z, y);
    else shape.lineTo(z, y);
  }
  shape.closePath();

  if (holes) {
    for (const holePts of holes) {
      const path = new THREE.Path();
      for (let i = 0; i < holePts.length; i++) {
        const [z, y] = holePts[i];
        if (i === 0) path.moveTo(z, y);
        else path.lineTo(z, y);
      }
      path.closePath();
      shape.holes.push(path);
    }
  }

  const b = Math.min(bevel, thicknessX * 0.3);
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, thicknessX - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // ExtrudeGeometry extrudes along +Z; rotateY(-PI/2) maps shape X->+Z (weapon forward), Y->+Y (up), extrusion->X (width)
  raw.translate(0, 0, -(thicknessX - b * 2) * 0.5);
  raw.rotateY(-Math.PI * 0.5);

  const creased = applyCreasedNormals(raw, 35);
  raw.dispose();
  return tintGeometryVertexColor(creased, tintHex, { isGunmetal });
}

/**
 * Create an extruded hollow chamfered optic hood (EOTech, Kobra, Glock RMR) along Z (weapon forward)
 * with real beveled outer shroud and clear center sight window!
 */
export function createBeveledOpticHoodGeo(
  outerW: number,
  outerH: number,
  innerW: number,
  innerH: number,
  lengthZ: number,
  bevel = 0.0018,
  tintHex = 0xd6dde6
): THREE.BufferGeometry {
  const hw = outerW * 0.5;
  const hh = outerH * 0.5;
  const iw = innerW * 0.5;
  const ih = innerH * 0.5;
  const c = Math.min(outerW, outerH) * 0.16;

  // Chamfered octagon outer contour
  const shape = new THREE.Shape();
  shape.moveTo(-hw + c, -hh);
  shape.lineTo(hw - c, -hh);
  shape.lineTo(hw, -hh + c);
  shape.lineTo(hw, hh - c);
  shape.lineTo(hw - c, hh);
  shape.lineTo(-hw + c, hh);
  shape.lineTo(-hw, hh - c);
  shape.lineTo(-hw, -hh + c);
  shape.closePath();

  // Inner sight window cutout
  const hole = new THREE.Path();
  const ic = Math.min(innerW, innerH) * 0.12;
  hole.moveTo(-iw + ic, -ih);
  hole.lineTo(iw - ic, -ih);
  hole.lineTo(iw, -ih + ic);
  hole.lineTo(iw, ih - ic);
  hole.lineTo(iw - ic, ih);
  hole.lineTo(-iw + ic, ih);
  hole.lineTo(-iw, ih - ic);
  hole.lineTo(-iw, -ih + ic);
  hole.closePath();
  shape.holes.push(hole);

  const b = Math.min(bevel, lengthZ * 0.22);
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.002, lengthZ - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments: 3,
  });
  raw.center();
  const creased = applyCreasedNormals(raw, 35);
  raw.dispose();
  return tintGeometryVertexColor(creased, tintHex, { isGunmetal: true, wearStrength: 1.0 });
}

/**
 * Create a barrel/tube cylinder aligned along +Z with creased normals & optional gunmetal dihedral wear.
 */
export function createBarrelGeo(
  rTop: number,
  rBot: number,
  len: number,
  radialSegs = 12,
  isGunmetal = true,
  tintHex = 0xffffff
): THREE.BufferGeometry {
  const raw = new THREE.CylinderGeometry(rTop, rBot, len, radialSegs, 1);
  raw.rotateX(Math.PI * 0.5);
  const creased = applyCreasedNormals(raw, 35);
  raw.dispose();
  return tintGeometryVertexColor(creased, tintHex, { isGunmetal });
}

/**
 * Compact Picatinny rail teeth strip along +Z (budget-friendly tris with crisp chamfered silhouette).
 */
export function createPicatinnyStrip(
  length: number,
  width: number,
  yTop: number,
  zCenter: number,
  mat: THREE.Material,
  tintHex = 0xd0d6de
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Picatinny_Rail';

  const base = new THREE.Mesh(
    createChamferedBoxGeo(width, 0.0045, length, 0.0008, true, tintHex),
    mat
  );
  base.position.set(0, yTop, zCenter);
  g.add(base);

  const lugCount = Math.min(10, Math.max(3, Math.floor(length / 0.022)));
  const spacing = length / lugCount;
  const lugGeo = createChamferedBoxGeo(width * 0.96, 0.0032, spacing * 0.48, 0.0005, true, tintHex);
  for (let i = 0; i < lugCount; i++) {
    const z = zCenter - length * 0.5 + (i + 0.5) * spacing;
    const lug = new THREE.Mesh(lugGeo, mat);
    lug.position.set(0, yTop + 0.0036, z);
    g.add(lug);
  }
  return g;
}

/**
 * Live brass/copper cartridge mesh for windowed magazines, breeches, and ejection ports.
 */
export function createCartridgeMesh(
  length: number,
  radius: number,
  mat: THREE.Material,
  shellHex = 0xd6b05e,
  tipHex = 0xc97640
): THREE.Group {
  const g = new THREE.Group();
  const caseLen = length * 0.68;
  const tipLen = length * 0.32;

  const casing = new THREE.Mesh(
    createBarrelGeo(radius, radius * 1.03, caseLen, 8, false, shellHex),
    mat
  );
  casing.position.z = -tipLen * 0.5;
  g.add(casing);

  const bullet = new THREE.Mesh(
    createBarrelGeo(radius * 0.25, radius * 0.92, tipLen, 8, false, tipHex),
    mat
  );
  bullet.position.z = caseLen * 0.5;
  g.add(bullet);

  return g;
}

/**
 * 12-gauge crimson tactical buckshot shell with brass hull head for M870 side saddle & breech.
 */
export function createShotgunShellMesh(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  // Crimson ribbed hull
  const hull = new THREE.Mesh(
    createBarrelGeo(0.0096, 0.0096, 0.048, 10, false, 0xc82424),
    mat
  );
  hull.position.z = 0.008;
  g.add(hull);

  // Brass rimmed base
  const brass = new THREE.Mesh(
    createBarrelGeo(0.0102, 0.0106, 0.017, 10, false, 0xd8b458),
    mat
  );
  brass.position.z = -0.023;
  g.add(brass);
  return g;
}

export interface LiveAmmoVisuals {
  /** Visible stacked cartridges inside translucent mag window or AWM mag (bottom -> top) */
  magRounds: THREE.Object3D[];
  /** Optional magazine follower rising as cartridges deplete */
  magFollower?: THREE.Object3D;
  followerBottomY?: number;
  followerTopY?: number;
  /** Visible red 12-gauge shells mounted on M870 receiver side saddle (6 slots) */
  saddleShells?: THREE.Object3D[];
  /** Visible chamber / breech brass round peeking through ejection port when mag > 0 */
  chamberRound?: THREE.Object3D;
}

export interface BuiltWeapon {
  id: 'mk18' | 'ak74m' | 'm870' | 'awm' | 'glock19';
  root: THREE.Group;
  gripRight: THREE.Object3D;
  gripLeft: THREE.Object3D;
  muzzleTip: THREE.Object3D;
  ejectionPort: THREE.Object3D;
  magPivot: THREE.Group;
  boltOrSlide: THREE.Group;
  triggerPivot: THREE.Group;
  laserOrigin: THREE.Object3D;
  /** Canonical UE5 socket aliases */
  muzzleSocket: THREE.Object3D;
  laserSocket: THREE.Object3D;
  opticEyeSocket: THREE.Object3D;
  ejectionPortSocket: THREE.Object3D;
  weaponLightSocket: THREE.Object3D;
  magRestPos: THREE.Vector3;
  magRestRot: THREE.Euler;
  boltRestPos: THREE.Vector3;
  boltRestRot: THREE.Euler;
  boltTravelMax: number;
  boltLiftMax: number;
  ammoVisuals: LiveAmmoVisuals;
  materialSlots: number;
  triangleCount: number;
  dispose: () => void;
}

/**
 * Pure live-ammo mapping for M870 6-shell side saddle:
 * Depletes cleanly as rounds are fired (8->6, 7->5, 4->3, 1->1, 0->0) and refills progressively during reload!
 */
export function computeM870SaddleShellCount(
  mag: number,
  magSize: number,
  isReloading: boolean,
  reloadProgress: number,
  preReloadMag: number,
  reserve: number
): number {
  const slots = 6;
  const mapRoundsToSaddle = (rounds: number) => {
    if (rounds <= 0) return 0;
    if (rounds >= magSize) return slots;
    return Math.max(1, Math.min(slots - 1, Math.floor((rounds / magSize) * slots)));
  };

  if (!isReloading) {
    return mapRoundsToSaddle(mag);
  }

  const startCount = mapRoundsToSaddle(preReloadMag);
  const targetMag = Math.min(magSize, preReloadMag + reserve);
  const endCount = mapRoundsToSaddle(targetMag);
  if (reloadProgress < 0.14) return startCount;
  if (reloadProgress >= 0.72) return endCount;
  const u = (reloadProgress - 0.14) / (0.72 - 0.14);
  return Math.round(startCount + (endCount - startCount) * u);
}

/**
 * Pure visible slot count mapping for translucent rifle mags (12 slots for 30 rounds) & exact 5-for-5 AWM mag.
 */
export function computeVisibleSlotCount(rounds: number, magSize: number, totalSlots: number): number {
  if (rounds <= 0 || magSize <= 0 || totalSlots <= 0) return 0;
  if (rounds >= magSize) return totalSlots;
  if (magSize === totalSlots) return Math.min(totalSlots, rounds);
  return Math.max(1, Math.min(totalSlots - 1, Math.floor((rounds / magSize) * totalSlots)));
}

/**
 * Pure reload-aware magazine display round count:
 * Shows depleted pre-reload mag while detaching (< 0.36) and fresh full pouch mag once fetched (>= 0.36).
 */
export function getDisplayedMagRounds(
  mag: number,
  magSize: number,
  isReloading: boolean,
  reloadProgress: number,
  preReloadMag: number,
  reserve: number
): number {
  if (!isReloading) return mag;
  if (reloadProgress < 0.36) return preReloadMag;
  return Math.min(magSize, preReloadMag + reserve);
}

/**
 * Sync all 3D live-ammo meshes (windowed rifle cartridges, rising follower, M870 crimson side-saddle shells,
 * and breech/ejection-port brass) every frame with combat ammo & reload state.
 */
export function updateWeaponLiveAmmoVisuals(
  weapon: BuiltWeapon,
  mag: number,
  magSize: number,
  isReloading: boolean,
  reloadProgress: number,
  preReloadMag: number,
  reserve: number
): void {
  const vis = weapon.ammoVisuals;
  const displayRounds = getDisplayedMagRounds(
    mag,
    magSize,
    isReloading,
    reloadProgress,
    preReloadMag,
    reserve
  );

  if (vis.magRounds.length > 0) {
    const visibleCount = computeVisibleSlotCount(displayRounds, magSize, vis.magRounds.length);
    for (let i = 0; i < vis.magRounds.length; i++) {
      vis.magRounds[i].visible = i < visibleCount;
    }
    if (
      vis.magFollower &&
      vis.followerBottomY !== undefined &&
      vis.followerTopY !== undefined
    ) {
      const fracEmpty = 1 - visibleCount / vis.magRounds.length;
      vis.magFollower.position.y = THREE.MathUtils.lerp(
        vis.followerBottomY,
        vis.followerTopY,
        fracEmpty
      );
    }
  }

  if (vis.saddleShells && vis.saddleShells.length > 0) {
    const saddleCount = computeM870SaddleShellCount(
      mag,
      magSize,
      isReloading,
      reloadProgress,
      preReloadMag,
      reserve
    );
    for (let i = 0; i < vis.saddleShells.length; i++) {
      vis.saddleShells[i].visible = i < saddleCount;
    }
  }

  if (vis.chamberRound) {
    vis.chamberRound.visible = mag > 0;
  }
}

