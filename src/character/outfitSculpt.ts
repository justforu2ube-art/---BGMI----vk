import * as THREE from 'three';
import {
  applySkinWeights,
  CharacterRig,
  computeGloveSkeletalAlignment,
  createBoundSkinnedMesh,
} from './rig';
import {
  createBeveledPanel,
  createGrommetRing,
  createLoftedGeometry,
  createSweptStrap,
  createTubeCurve,
  LoftRing,
  mergeNormalizedGeometries,
} from './geometryUtils';
import { PBRMaterialLibrary } from './textures';

function transformGeo(
  geo: THREE.BufferGeometry,
  pos: [number, number, number],
  rot: [number, number, number] = [0, 0, 0]
): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
  m.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m);
  return geo;
}

/** Places a panel centered at `center` with local +Z facing `outNormal` and local +Y along `upHint` */
function orientPanelAt(
  geo: THREE.BufferGeometry,
  center: THREE.Vector3,
  outNormal: THREE.Vector3,
  upHint: THREE.Vector3
): THREE.BufferGeometry {
  const zAxis = outNormal.clone().normalize();
  const xAxis = new THREE.Vector3().crossVectors(upHint, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  m.setPosition(center);
  geo.applyMatrix4(m);
  return geo;
}

/**
 * Builds a pole-free, softly pillowed, rounded-edge, subtly wrinkled cloth pouch or flap
 * using a subdivided box grid (ZERO polar star-pinch!) with convex torso curvature (curveRadiusX > 0).
 */
function createSoftClothPouch(opts: {
  width: number;
  height: number;
  depth: number;
  pillow?: number;
  cornerRadius?: number;
  curveRadiusX?: number;
  pleats?: number;
  wrinkleSeed?: number;
  centerCrease?: boolean;
  embedBack?: number;
}): THREE.BufferGeometry {
  const {
    width,
    height,
    depth,
    pillow = depth * 0.24,
    cornerRadius = Math.min(width, height) * 0.18,
    curveRadiusX = 0,
    pleats = 0,
    wrinkleSeed = 1,
    centerCrease = false,
    embedBack = 0.006,
  } = opts;

  const totalZ = depth + embedBack;
  const geo = new THREE.BoxGeometry(width, height, totalZ, 12, 12, 4);
  const hw = width * 0.5;
  const hh = height * 0.5;
  const hz = totalZ * 0.5;
  const cr = Math.min(cornerRadius, hw * 0.45, hh * 0.45);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    // Shift box so back sits at -embedBack and front sits at +depth
    let z = pos.getZ(i) + (depth - embedBack) * 0.5;

    const nx = x / Math.max(hw, 0.001); // [-1, 1]
    const ny = y / Math.max(hh, 0.001); // [-1, 1]
    const nz = (pos.getZ(i) + hz) / Math.max(totalZ, 0.001); // 0 = back, 1 = front

    // 1. Softly round all 4 XY corners so pouch reads as stitched cloth, never a sharp wooden box
    const innerX = Math.max(0, Math.abs(x) - (hw - cr));
    const innerY = Math.max(0, Math.abs(y) - (hh - cr));
    if (innerX > 0 && innerY > 0) {
      const dist = Math.hypot(innerX, innerY);
      if (dist > cr) {
        const scale = cr / dist;
        x = Math.sign(x) * (hw - cr + innerX * scale);
        y = Math.sign(y) * (hh - cr + innerY * scale);
      }
    }

    // 2. Softly pillow front face & round front edge bevel smoothly
    const edgeDistX = Math.max(0, 1 - Math.abs(nx));
    const edgeDistY = Math.max(0, 1 - Math.abs(ny));
    const dome = Math.sqrt(Math.max(0, 1 - nx * nx * 0.85)) * Math.sqrt(Math.max(0, 1 - ny * ny * 0.85));
    const frontFactor = Math.max(0, (nz - 0.35) / 0.65);

    if (frontFactor > 0) {
      // Softly tuck perimeter edges inward on front face for natural rounded cloth seam lip
      const edgeTuck = (1 - Math.min(1, Math.min(edgeDistX, edgeDistY) / 0.22)) * depth * 0.22;
      z += (dome * pillow - edgeTuck) * frontFactor;

      // Subtle vertical bellows pleats
      if (pleats > 0) {
        z += Math.cos(nx * Math.PI * pleats) * depth * 0.10 * dome * frontFactor;
      }
      // Center stitched divider crease for left chest cargo pocket
      if (centerCrease) {
        const midCrease = Math.exp(-Math.pow(nx / 0.11, 2)) * depth * 0.28;
        z -= midCrease * frontFactor;
      }
      // Subtle organic cloth wrinkle & gravity fullness toward bottom of pocket
      const bottomFull = Math.max(0, -ny) * depth * 0.08 * dome;
      const wrinkle =
        (Math.sin(nx * 5.0 + ny * 3.6 + wrinkleSeed * 2.1) * 0.0013 +
          Math.cos(nx * 8.5 - ny * 6.8 + wrinkleSeed * 4.3) * 0.0006) *
        dome;
      z += (wrinkle + bottomFull) * frontFactor;
    }

    // 3. Convex cylindrical torso wrap (curveRadiusX > 0 bends outer X edges BACKWARD around chest!)
    if (Math.abs(curveRadiusX) > 0.001) {
      const angle = x / curveRadiusX;
      const rad = curveRadiusX + z;
      x = Math.sin(angle) * rad;
      z = Math.cos(angle) * rad - curveRadiusX;
    }

    pos.setXYZ(i, x, y, z);
    uv.setXY(i, (x + hw) * 3.8, (y + hh) * 3.8);
  }

  geo.computeVertexNormals();
  return geo;
}

/**
 * 1. INNER RIBBED TURTLENECK (Solid double-walled, smoothly rolled-edge vertical-ribbed dark forest knit
 *    wrapping snugly around the entire thick masculine neck — ZERO jagged edge, ZERO skin gap!)
 */
function buildTurtleneck(rig: CharacterRig): THREE.BufferGeometry {
  const levels = [
    // Outer knit wall rising cleanly from deep inside closed torso yoke
    { y: 1.485, rx: 0.086, rz: 0.082, zOff: 0.002, rib: 0.0011, v: 0.0 },
    { y: 1.525, rx: 0.072, rz: 0.070, zOff: 0.002, rib: 0.0014, v: 0.22 },
    { y: 1.560, rx: 0.067, rz: 0.066, zOff: 0.003, rib: 0.0014, v: 0.45 },
    { y: 1.590, rx: 0.0655, rz: 0.0645, zOff: 0.003, rib: 0.0010, v: 0.68 },
    // Butter-smooth thick 6mm rolled knit hem (rib fades cleanly to 0 before rim -> ZERO sawtooth!)
    { y: 1.602, rx: 0.0645, rz: 0.0635, zOff: 0.003, rib: 0.0002, v: 0.78 },
    { y: 1.608, rx: 0.0600, rz: 0.0592, zOff: 0.003, rib: 0.0, v: 0.85 },
    { y: 1.607, rx: 0.0550, rz: 0.0545, zOff: 0.003, rib: 0.0, v: 0.91 },
    { y: 1.601, rx: 0.0505, rz: 0.0505, zOff: 0.003, rib: 0.0, v: 0.96 },
    // Inner hem descending snugly inside thick masculine neck -> ZERO air gap from ANY angle!
    { y: 1.584, rx: 0.0485, rz: 0.0485, zOff: 0.003, rib: 0.0, v: 1.08 },
    { y: 1.545, rx: 0.0480, rz: 0.0480, zOff: 0.003, rib: 0.0, v: 1.25 },
  ];

  const rings: LoftRing[] = levels.map((lv) => ({
    center: new THREE.Vector3(0, lv.y, lv.zOff),
    right: new THREE.Vector3(1, 0, 0),
    forward: new THREE.Vector3(0, 0, 1),
    v: lv.v,
    profile: (theta) => {
      const rib = Math.cos(theta * 28) * lv.rib;
      return [Math.sin(theta) * (lv.rx + rib), Math.cos(theta) * (lv.rz + rib)];
    },
  }));

  // Double-walled continuous loop (outer wall -> rolled top hem -> inner wall) has 100% outward watertight normals!
  const geo = createLoftedGeometry(rings, 56, false, false, 2);
  applySkinWeights(geo, rig, { allowedBones: ['Chest', 'Neck', 'Head'], sharpness: 2.8 });
  return geo;
}

/**
 * 2. REAL TACTICAL CLOTH UPPER JACKET:
 *    - Closed high-res draped torso + upward-facing solid trapezius shoulder deck (ZERO top-down holes!)
 *    - Solid 14mm double-walled padded standing collar with front V-notch (NO floating green ring!)
 *    - Fused deltoid shoulders + low-profile flush conformal matte honeycomb yoke pads (NO floating horns!)
 *    - Stitched fabric placket welt framing chunky black zipper + 38 teeth + slider/pull-tab
 *    - Torso-curved 2x4 chest grommet webbing panels + 16 flush gunmetal eyelets
 *    - Softly pillowed, wrinkled tactical cloth pouches & pleated bellows pockets
 *    - Heavy bunched accordion rolled sleeves + solid double-walled folded cloth cuffs + flush curved Velcro patch
 */
function buildUpperOutfit(rig: CharacterRig) {
  const corduraParts: THREE.BufferGeometry[] = [];
  const forestWebbingParts: THREE.BufferGeometry[] = [];
  const honeycombParts: THREE.BufferGeometry[] = [];
  const webbingParts: THREE.BufferGeometry[] = [];
  const gunmetalParts: THREE.BufferGeometry[] = [];
  const upperSilverParts: THREE.BufferGeometry[] = [];
  const velcroParts: THREE.BufferGeometry[] = [];
  const stitchParts: THREE.BufferGeometry[] = [];

  // --- A. High-Res Draped Tactical Jacket Torso + Closed Solid Upper Trapezius Yoke ---
  // Athletic V-taper profile: trimmed mid/upper ribcage & chest depth so silhouette stays lean, never barrel-chested!
  const torsoLevels = [
    { y: 0.945, rx: 0.163, rz: 0.114, zOff: -0.004, fold: 0.0050, v: 0.0 },
    { y: 0.978, rx: 0.164, rz: 0.115, zOff: -0.003, fold: 0.0060, v: 0.08 },
    { y: 1.018, rx: 0.158, rz: 0.112, zOff: -0.001, fold: 0.0055, v: 0.16 },
    { y: 1.068, rx: 0.154, rz: 0.110, zOff: 0.001, fold: 0.0046, v: 0.25 },
    { y: 1.125, rx: 0.159, rz: 0.113, zOff: 0.003, fold: 0.0040, v: 0.36 },
    { y: 1.185, rx: 0.168, rz: 0.119, zOff: 0.005, fold: 0.0036, v: 0.47 },
    { y: 1.245, rx: 0.180, rz: 0.125, zOff: 0.006, fold: 0.0034, v: 0.58 },
    { y: 1.305, rx: 0.191, rz: 0.130, zOff: 0.006, fold: 0.0032, v: 0.69 },
    { y: 1.365, rx: 0.197, rz: 0.132, zOff: 0.006, fold: 0.0034, v: 0.80 },
    { y: 1.418, rx: 0.197, rz: 0.129, zOff: 0.005, fold: 0.0032, v: 0.89 },
    { y: 1.462, rx: 0.193, rz: 0.123, zOff: 0.005, fold: 0.0024, v: 0.96 },
    { y: 1.495, rx: 0.182, rz: 0.116, zOff: 0.004, fold: 0.0016, v: 1.02 },
    // Solid upward-facing trapezius shoulder deck sealing tightly into standing collar & turtleneck!
    { y: 1.518, rx: 0.160, rz: 0.107, zOff: 0.003, fold: 0.0012, v: 1.08 },
    { y: 1.530, rx: 0.132, rz: 0.098, zOff: 0.003, fold: 0.0008, v: 1.14 },
    { y: 1.535, rx: 0.106, rz: 0.091, zOff: 0.003, fold: 0.0004, v: 1.20 },
    { y: 1.529, rx: 0.082, rz: 0.078, zOff: 0.003, fold: 0.0, v: 1.25 },
    { y: 1.508, rx: 0.058, rz: 0.058, zOff: 0.003, fold: 0.0, v: 1.30 },
  ];

  const torsoRings: LoftRing[] = torsoLevels.map((lv) => ({
    center: new THREE.Vector3(0, lv.y, lv.zOff),
    right: new THREE.Vector3(1, 0, 0),
    forward: new THREE.Vector3(0, 0, 1),
    v: lv.v * 1.45,
    profile: (theta) => {
      const s = Math.sin(theta);
      const c = Math.cos(theta);
      const isDeck = lv.y > 1.505;
      const pec =
        !isDeck && c > 0
          ? Math.pow(c, 1.5) * 0.008 * (lv.y > 1.21 && lv.y < 1.45 ? 1 : 0.2)
          : 0;
      const spineGroove = !isDeck && c < -0.65 ? -Math.pow(-c - 0.65, 2) * 0.036 : 0;

      // Sculpted fabric placket welt flanking recessed center zipper channel
      const zipperChannel = !isDeck && c > 0.94 ? -0.0045 * Math.pow((c - 0.94) / 0.06, 2) : 0;
      const placketWelt =
        !isDeck && c > 0.80 && c < 0.96
          ? Math.sin(((c - 0.80) / 0.16) * Math.PI) * 0.0032
          : 0;

      // Multi-frequency real cloth drapery: waist bunching, diagonal armpit tension creases & scapula folds
      const waistBunch =
        lv.y < 1.12 ? Math.sin(lv.y * 54 + Math.abs(theta) * 4.0) * 0.0032 * (1.12 - lv.y) * 5.0 : 0;
      const armpitCrease =
        lv.y > 1.26 && lv.y < 1.47
          ? Math.sin((lv.y - 1.36) * 46 - Math.abs(s) * 9.0) * 0.0028 * Math.pow(Math.abs(s), 1.4)
          : 0;
      const broadDrape =
        (Math.sin(theta * 5 + lv.y * 19) * 0.65 + Math.cos(theta * 9 - lv.y * 27) * 0.35) *
        lv.fold;
      const totalFold = broadDrape + waistBunch + armpitCrease;

      const rx = Math.sign(s) * Math.pow(Math.abs(s), 0.88) * lv.rx + totalFold * s;
      const rz =
        Math.sign(c) * Math.pow(Math.abs(c), 0.92) * lv.rz +
        pec +
        spineGroove +
        zipperChannel +
        placketWelt +
        totalFold * c;
      return [rx, rz];
    },
  }));
  const torsoGeo = createLoftedGeometry(torsoRings, 64, false, false, 2.0);
  applySkinWeights(torsoGeo, rig, {
    allowedBones: ['Pelvis', 'Spine_01', 'Spine_02', 'Chest', 'Neck', 'Clavicle_L', 'Clavicle_R'],
    sharpness: 2.5,
  });
  corduraParts.push(torsoGeo);

  // --- B. Solid 14mm Double-Walled Padded Standing Tactical Jacket Collar (ZERO hollow gap, NO floating ring!) ---
  const collarLevels = [
    // Outer standing collar wall anchored deeply inside closed trapezius shoulder deck
    { y: 1.505, rx: 0.114, rz: 0.106, fold: 0.0008, v: 0.0, notchW: 0.0 },
    { y: 1.536, rx: 0.106, rz: 0.100, fold: 0.0018, v: 0.26, notchW: 0.18 },
    { y: 1.568, rx: 0.103, rz: 0.097, fold: 0.0022, v: 0.54, notchW: 0.58 },
    { y: 1.594, rx: 0.105, rz: 0.099, fold: 0.0018, v: 0.78, notchW: 0.92 },
    // Smooth thick 14mm rounded padded top lip (strictly UPWARD-facing normals for top-down solidity!)
    { y: 1.602, rx: 0.103, rz: 0.097, fold: 0.0010, v: 0.88, notchW: 1.0 },
    { y: 1.605, rx: 0.098, rz: 0.093, fold: 0.0006, v: 0.96, notchW: 1.0 },
    { y: 1.602, rx: 0.093, rz: 0.088, fold: 0.0006, v: 1.04, notchW: 1.0 },
    { y: 1.595, rx: 0.090, rz: 0.085, fold: 0.0010, v: 1.12, notchW: 0.92 },
    // Inner padded lining wall descending cleanly inside closed shoulder deck!
    { y: 1.564, rx: 0.088, rz: 0.083, fold: 0.0012, v: 1.38, notchW: 0.52 },
    { y: 1.530, rx: 0.087, rz: 0.082, fold: 0.0006, v: 1.66, notchW: 0.14 },
    { y: 1.504, rx: 0.086, rz: 0.081, fold: 0.0, v: 1.90, notchW: 0.0 },
  ];

  const collarRings: LoftRing[] = collarLevels.map((lv) => ({
    center: new THREE.Vector3(0, lv.y, 0.003),
    right: new THREE.Vector3(1, 0, 0),
    forward: new THREE.Vector3(0, 0, 1),
    v: lv.v,
    profile: (theta) => {
      const s = Math.sin(theta);
      const c = Math.cos(theta);
      // Soft vertical cloth creases around padded collar
      const crease =
        (Math.sin(theta * 7 + lv.y * 28) * 0.65 + Math.cos(theta * 11 - lv.y * 18) * 0.35) *
        lv.fold;
      const frontPinch = c > 0.84 ? -0.006 * Math.pow((c - 0.84) / 0.16, 1.4) * lv.notchW : 0;
      return [s * (lv.rx + crease), c * (lv.rz + crease) + frontPinch];
    },
    yOffset: (theta) => {
      const c = Math.cos(theta);
      // Crisp tactical front V-notch right above the zipper slider showing ribbed turtleneck underneath!
      if (c > 0.78 && lv.notchW > 0) {
        const t = (c - 0.78) / 0.22;
        return -0.036 * Math.pow(t, 1.35) * lv.notchW;
      }
      return 0;
    },
  }));
  const collarGeo = createLoftedGeometry(collarRings, 56, false, false, 1.6);
  applySkinWeights(collarGeo, rig, { allowedBones: ['Chest', 'Neck'], sharpness: 2.9 });
  corduraParts.push(collarGeo);

  // --- C. Conformal Flush Stitched Matte Honeycomb Shoulder Yoke Pads (Clearly Visible, ZERO Floating Horns!) ---
  // Rides flush ON TOP of the exact closed trapezius-to-deltoid shoulder contour, embedded 12mm underneath so ZERO gap!
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const yokeRings: LoftRing[] = [];
    const steps = 14;
    for (let r = 0; r <= steps; r++) {
      const t = r / steps; // 0 = flush at collar base, 1 = flush over outer deltoid shoulder seam
      const cx = (0.100 + t * 0.142) * s;
      // Rides cleanly +6mm proud along the full trapezius deck (1.535) AND deltoid cap crest (1.547 -> 1.530)
      const cy = 1.538 + Math.sin(t * Math.PI) * 0.015 - Math.pow(t, 3.0) * 0.014;
      const cz = 0.004 - t * 0.004;

      // Sleek tapered tactical shoulder armor strap matching 4_a81a6ae0.jpg!
      const endTaper = Math.pow(Math.sin(t * Math.PI), 0.30);
      const halfDepth = Math.max(0.002, (0.046 - t * 0.004) * endTaper);
      const topThick = Math.max(0.001, 0.0075 * endTaper);
      const embedDepth = Math.max(0.002, 0.018 * endTaper);

      const slopeAngle = (0.04 + t * 0.34) * s;
      const normalAxis = new THREE.Vector3(Math.sin(slopeAngle), Math.cos(slopeAngle), 0).normalize();
      const zAxis = new THREE.Vector3(0, 0, -s);

      yokeRings.push({
        center: new THREE.Vector3(cx, cy, cz),
        right: zAxis,
        forward: normalAxis,
        v: t * 1.8,
        profile: (theta) => {
          const c = Math.cos(theta);
          const sn = Math.sin(theta);
          const zVal = Math.sign(c) * Math.pow(Math.abs(c), 0.56) * halfDepth;
          const nVal =
            sn >= 0 ? Math.pow(sn, 0.40) * topThick : -Math.pow(-sn, 0.55) * embedDepth;
          return [zVal, nVal];
        },
      });
    }
    const yokeGeo = createLoftedGeometry(yokeRings, 24, false, false, 1.5);
    applySkinWeights(yokeGeo, rig, {
      allowedBones: ['Chest', `Clavicle_${side}`, `UpperArm_${side}`],
      sharpness: 2.6,
    });
    honeycombParts.push(yokeGeo);
  }

  // --- D. Stitched Fabric Zipper Placket Welt + Chunky Black Zipper + 38 Sculpted Teeth + Slider ---
  // Proud +4mm over slimmer athletic chest curve so cloth NEVER clips through the zipper teeth!
  const zipTapePts = [
    new THREE.Vector3(0, 0.950, 0.117),
    new THREE.Vector3(0, 1.075, 0.119),
    new THREE.Vector3(0, 1.245, 0.140),
    new THREE.Vector3(0, 1.375, 0.147),
    new THREE.Vector3(0, 1.482, 0.130),
    new THREE.Vector3(0, 1.548, 0.103),
  ];
  const zipCurve = new THREE.CatmullRomCurve3(zipTapePts);
  const zipTape = createSweptStrap(zipTapePts, 0.024, 0.007, 34, false, new THREE.Vector3(1, 0, 0));
  applySkinWeights(zipTape, rig, {
    allowedBones: ['Pelvis', 'Spine_01', 'Spine_02', 'Chest', 'Neck'],
    sharpness: 2.7,
  });
  webbingParts.push(zipTape);

  // Flanking stitched Cordura fabric placket welt strips terminating neatly at collar V-notch (y=1.542)
  const weltBasePts = [
    new THREE.Vector3(0, 0.950, 0.115),
    new THREE.Vector3(0, 1.075, 0.117),
    new THREE.Vector3(0, 1.245, 0.138),
    new THREE.Vector3(0, 1.375, 0.145),
    new THREE.Vector3(0, 1.482, 0.128),
    new THREE.Vector3(0, 1.540, 0.104),
  ];
  for (const s of [1, -1] as const) {
    const weltPts = weltBasePts.map((p) => new THREE.Vector3(0.017 * s, p.y, p.z));
    const welt = createSweptStrap(weltPts, 0.010, 0.006, 28, false, new THREE.Vector3(1, 0, 0));
    applySkinWeights(welt, rig, {
      allowedBones: ['Pelvis', 'Spine_01', 'Spine_02', 'Chest', 'Neck'],
      sharpness: 2.7,
    });
    corduraParts.push(welt);
  }

  const toothCount = 38;
  for (let i = 0; i < toothCount; i++) {
    const t = 0.02 + (i / (toothCount - 1)) * 0.90;
    const pt = zipCurve.getPointAt(t);
    const sideShift = (i % 2 === 0 ? 1 : -1) * 0.0028;
    const tooth = createBeveledPanel({
      width: 0.009,
      height: 0.0052,
      depth: 0.0052,
      cornerRadius: 0.0012,
      bevel: 0.0008,
    });
    transformGeo(tooth, [pt.x + sideShift, pt.y, pt.z + 0.0034]);
    applySkinWeights(tooth, rig, {
      allowedBones: ['Pelvis', 'Spine_01', 'Spine_02', 'Chest', 'Neck'],
      sharpness: 3.0,
    });
    gunmetalParts.push(tooth);
  }

  const sliderPos = zipCurve.getPointAt(0.93);
  const sliderBox = createBeveledPanel({
    width: 0.015,
    height: 0.021,
    depth: 0.009,
    cornerRadius: 0.0024,
    bevel: 0.0015,
  });
  transformGeo(sliderBox, [sliderPos.x, sliderPos.y, sliderPos.z + 0.0048]);
  const pullTab = createBeveledPanel({
    width: 0.011,
    height: 0.026,
    depth: 0.0042,
    cornerRadius: 0.0028,
    bevel: 0.001,
  });
  transformGeo(pullTab, [sliderPos.x, sliderPos.y - 0.019, sliderPos.z + 0.0115], [0.22, 0, 0]);
  for (const part of [sliderBox, pullTab]) {
    applySkinWeights(part, rig, { allowedBones: ['Chest', 'Neck'], sharpness: 3.2 });
    upperSilverParts.push(part);
  }

  // --- E. Convex Torso-Curved Left & Right Chest Webbing Panels + ALL 16 Crisp Proud Gunmetal Grommets ---
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const panelX = 0.086 * s;
    const panelY = 1.404;
    const panelZ = 0.134;
    const rotX = -0.15;
    const rotY = 0.27 * s;
    const pDepth = 0.0065;
    const pBevel = 0.0018;
    // POSITIVE curveRadiusX wraps outer edges BACKWARD around the slimmer convex chest ribcage!
    const curveR = 0.215;

    const panel = createBeveledPanel({
      width: 0.114,
      height: 0.062,
      depth: pDepth,
      cornerRadius: 0.006,
      bevel: pBevel,
      curveRadiusX: curveR,
    });
    transformGeo(panel, [panelX, panelY, panelZ], [rotX, rotY, 0]);
    applySkinWeights(panel, rig, { allowedBones: ['Chest', `Clavicle_${side}`], sharpness: 3.2 });
    forestWebbingParts.push(panel);

    // Subtle stitched border piping following the exact convex curved webbing perimeter
    const borderPts: THREE.Vector3[] = [];
    const bw = 0.056;
    const bh = 0.030;
    const perimeter: [number, number][] = [
      [-bw, -bh],
      [0, -bh],
      [bw, -bh],
      [bw, 0],
      [bw, bh],
      [0, bh],
      [-bw, bh],
      [-bw, 0],
    ];
    const mPanel = new THREE.Matrix4().compose(
      new THREE.Vector3(panelX, panelY, panelZ),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0, 'XYZ')),
      new THREE.Vector3(1, 1, 1)
    );
    for (const [bx, by] of perimeter) {
      const ang = bx / curveR;
      const rad = curveR + pDepth + pBevel * 0.5;
      const pLocal = new THREE.Vector3(
        Math.sin(ang) * rad,
        by,
        Math.cos(ang) * rad - curveR
      ).applyMatrix4(mPanel);
      borderPts.push(pLocal);
    }
    const borderStitch = createTubeCurve(borderPts, 0.0017, 28, 5, true);
    applySkinWeights(borderStitch, rig, { allowedBones: ['Chest'], sharpness: 3.2 });
    stitchParts.push(borderStitch);

    // 2 horizontal rows x 4 gunmetal circular grommet eyelets (ALL 16 proud & flush on convex panel face!)
    const frontZ = pDepth + pBevel + 0.0022;
    for (let row = 0; row < 2; row++) {
      const ly = row === 0 ? 0.0155 : -0.0155;
      for (let col = 0; col < 4; col++) {
        const lx = -0.0398 + col * 0.0265;
        const ang = lx / curveR;
        const rad = curveR + frontZ;
        const gx = Math.sin(ang) * rad;
        const gz = Math.cos(ang) * rad - curveR;
        const grommet = createGrommetRing(0.0072, 0.0026);
        transformGeo(grommet, [gx, ly, gz], [0, ang, 0]);
        transformGeo(grommet, [panelX, panelY, panelZ], [rotX, rotY, 0]);
        applySkinWeights(grommet, rig, { allowedBones: ['Chest'], sharpness: 3.4 });
        gunmetalParts.push(grommet);
      }
    }
  }

  // --- F. Softly Sculpted Pole-Free Pillowed Cloth Pouches, Pleated Bellows Pockets & Stitch Piping ---
  // RIGHT CHEST (-X): 3 softly pillowed narrow vertical magazine pouches with rounded overhanging flaps & snap studs
  for (let i = 0; i < 3; i++) {
    const px = -0.044 - i * 0.033;
    const py = 1.255;
    const pz = 0.135 - i * 0.007;
    const yaw = -0.14 - i * 0.14;

    const body = createSoftClothPouch({
      width: 0.029,
      height: 0.118,
      depth: 0.023,
      pillow: 0.0052,
      cornerRadius: 0.007,
      wrinkleSeed: 10 + i * 3,
      embedBack: 0.008,
    });
    transformGeo(body, [px, py, pz], [0, yaw, 0]);
    applySkinWeights(body, rig, { allowedBones: ['Spine_02', 'Chest'], sharpness: 3.2 });
    corduraParts.push(body);

    const flap = createSoftClothPouch({
      width: 0.032,
      height: 0.044,
      depth: 0.0085,
      pillow: 0.0035,
      cornerRadius: 0.008,
      wrinkleSeed: 22 + i * 3,
      embedBack: 0.006,
    });
    transformGeo(flap, [px, py + 0.039, pz + 0.022], [0.05, yaw, 0]);
    applySkinWeights(flap, rig, { allowedBones: ['Spine_02', 'Chest'], sharpness: 3.2 });
    corduraParts.push(flap);

    const stud = createGrommetRing(0.0035, 0.0019);
    transformGeo(stud, [px, py + 0.026, pz + 0.0325], [0, yaw, 0]);
    applySkinWeights(stud, rig, { allowedBones: ['Spine_02', 'Chest'], sharpness: 3.4 });
    gunmetalParts.push(stud);
  }

  // Smaller outer right soft cloth flap pocket with snap stud
  {
    const px = -0.143;
    const py = 1.246;
    const pz = 0.098;
    const yaw = -0.60;
    const smallPouch = createSoftClothPouch({
      width: 0.044,
      height: 0.074,
      depth: 0.018,
      pillow: 0.0042,
      cornerRadius: 0.009,
      wrinkleSeed: 35,
      embedBack: 0.008,
    });
    transformGeo(smallPouch, [px, py, pz], [0, yaw, 0]);
    const smallFlap = createSoftClothPouch({
      width: 0.046,
      height: 0.030,
      depth: 0.0075,
      pillow: 0.003,
      cornerRadius: 0.008,
      wrinkleSeed: 39,
      embedBack: 0.006,
    });
    transformGeo(smallFlap, [px - 0.009, py + 0.022, pz + 0.016], [0.05, yaw, 0]);
    const stud = createGrommetRing(0.0038, 0.0020);
    transformGeo(stud, [px - 0.013, py + 0.014, pz + 0.023], [0, yaw, 0]);
    for (const p of [smallPouch, smallFlap]) {
      applySkinWeights(p, rig, { allowedBones: ['Spine_02', 'Chest'], sharpness: 3.2 });
      corduraParts.push(p);
    }
    applySkinWeights(stud, rig, { allowedBones: ['Spine_02', 'Chest'], sharpness: 3.4 });
    gunmetalParts.push(stud);
  }

  // LEFT CHEST (+X): Large softly pillowed, convex-curved pleated bellows cargo pocket with center divider crease
  {
    const px = 0.089;
    const py = 1.258;
    const pz = 0.130;
    const yaw = 0.29;
    const bellows = createSoftClothPouch({
      width: 0.108,
      height: 0.126,
      depth: 0.026,
      pillow: 0.0075,
      cornerRadius: 0.016,
      curveRadiusX: 0.215,
      pleats: 2,
      centerCrease: true,
      wrinkleSeed: 48,
      embedBack: 0.010,
    });
    transformGeo(bellows, [px, py, pz], [0, yaw, 0]);
    applySkinWeights(bellows, rig, { allowedBones: ['Spine_02', 'Chest'], sharpness: 3.1 });
    corduraParts.push(bellows);

    const flap = createSoftClothPouch({
      width: 0.112,
      height: 0.043,
      depth: 0.009,
      pillow: 0.0038,
      cornerRadius: 0.012,
      curveRadiusX: 0.225,
      wrinkleSeed: 53,
      embedBack: 0.008,
    });
    transformGeo(flap, [px + 0.007, py + 0.043, pz + 0.025], [0.05, yaw, 0]);
    applySkinWeights(flap, rig, { allowedBones: ['Spine_02', 'Chest'], sharpness: 3.1 });
    corduraParts.push(flap);

    const btn = createGrommetRing(0.0052, 0.0022);
    transformGeo(btn, [px + 0.010, py + 0.029, pz + 0.036], [0, yaw, 0]);
    applySkinWeights(btn, rig, { allowedBones: ['Spine_02', 'Chest'], sharpness: 3.2 });
    gunmetalParts.push(btn);
  }

  // LOWER TORSO: Softly pillowed convex-curved front waist cargo pockets + 3D raised stitch seam piping
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const px = 0.091 * s;
    const py = 1.078;
    const pz = 0.114;
    const yaw = 0.35 * s;

    const lowerPocket = createSoftClothPouch({
      width: 0.106,
      height: 0.116,
      depth: 0.024,
      pillow: 0.007,
      cornerRadius: 0.016,
      curveRadiusX: 0.20,
      pleats: 2,
      wrinkleSeed: side === 'L' ? 61 : 67,
      embedBack: 0.010,
    });
    transformGeo(lowerPocket, [px, py, pz], [0, yaw, 0]);
    applySkinWeights(lowerPocket, rig, {
      allowedBones: ['Pelvis', 'Spine_01', 'Spine_02'],
      sharpness: 2.9,
    });
    corduraParts.push(lowerPocket);

    const lowerFlap = createSoftClothPouch({
      width: 0.110,
      height: 0.036,
      depth: 0.0082,
      pillow: 0.0033,
      cornerRadius: 0.012,
      curveRadiusX: 0.21,
      wrinkleSeed: side === 'L' ? 73 : 79,
      embedBack: 0.008,
    });
    transformGeo(lowerFlap, [px + 0.008 * s, py + 0.042, pz + 0.024], [0.04, yaw, 0]);
    applySkinWeights(lowerFlap, rig, {
      allowedBones: ['Pelvis', 'Spine_01', 'Spine_02'],
      sharpness: 2.9,
    });
    corduraParts.push(lowerFlap);

    // 3D raised stitch piping princess seams
    const seamPts = [
      new THREE.Vector3(0.030 * s, 0.960, 0.114),
      new THREE.Vector3(0.032 * s, 1.120, 0.119),
      new THREE.Vector3(0.035 * s, 1.320, 0.134),
      new THREE.Vector3(0.042 * s, 1.490, 0.111),
    ];
    const seam = createTubeCurve(seamPts, 0.0022, 22, 6, false);
    applySkinWeights(seam, rig, {
      allowedBones: ['Pelvis', 'Spine_01', 'Spine_02', 'Chest'],
      sharpness: 2.8,
    });
    stitchParts.push(seam);
  }

  // --- G. Fused Shoulders + Heavy Bunched Rolled Sleeves + Double-Walled Cloth Cuffs + Flush Curved Velcro ---
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const pShoulder = rig.bindWorldPos.get(`UpperArm_${side}`)!;
    const pElbow = rig.bindWorldPos.get(`Forearm_${side}`)!;
    const pHand = rig.bindWorldPos.get(`Hand_${side}`)!;

    const pCuffEnd = pElbow.clone().lerp(pHand, 0.34);
    // Start sleeve root DEEP inside solid upper torso shoulder socket -> ZERO dark torso-arm air gap!
    const armCurve = new THREE.CatmullRomCurve3([
      pShoulder.clone().add(new THREE.Vector3(-0.072 * s, -0.012, 0.002)),
      pShoulder.clone().add(new THREE.Vector3(-0.018 * s, -0.010, 0.002)),
      pShoulder.clone().lerp(pElbow, 0.48),
      pElbow.clone(),
      pCuffEnd,
    ]);

    const sleeveRings: LoftRing[] = [];
    const ringSteps = 32;
    const fwdRef = new THREE.Vector3(0, 0, 1);

    const evalSleeveRadius = (t: number): number => {
      if (t < 0.20) {
        // Full rounded deltoid cap fusing seamlessly into upper chest & trapezius yoke
        return THREE.MathUtils.lerp(0.080, 0.078, t / 0.20);
      }
      if (t < 0.64) {
        // Tapered upper arm sleeve with subtle bicep drapery
        return THREE.MathUtils.lerp(0.078, 0.065, (t - 0.20) / 0.44);
      }
      // Heavy bunched accordion cloth rolls pushed up around lower elbow / upper forearm!
      const rt = (t - 0.64) / 0.36;
      const accordion =
        Math.sin(rt * Math.PI * 5.0) * 0.0068 + Math.sin(rt * Math.PI * 2.0) * 0.0045;
      return 0.066 + accordion;
    };

    for (let i = 0; i <= ringSteps; i++) {
      const t = i / ringSteps;
      const center = armCurve.getPointAt(t);
      const tang = armCurve.getTangentAt(t).normalize();
      const sideAxis = new THREE.Vector3().crossVectors(fwdRef, tang).normalize();
      const orthoFwd = new THREE.Vector3().crossVectors(tang, sideAxis).normalize();
      const rad = evalSleeveRadius(t);

      sleeveRings.push({
        center,
        right: sideAxis,
        forward: orthoFwd,
        v: t * 2.5,
        profile: (theta) => {
          const wrinkleAmp = t > 0.62 ? 0.0048 : t > 0.24 ? 0.0026 : 0.0014;
          const wrinkle =
            (Math.sin(theta * 4 + t * 24) * 0.65 + Math.cos(theta * 7 - t * 32) * 0.35) *
            wrinkleAmp;
          return [
            Math.cos(theta) * (rad * 1.03 + wrinkle),
            Math.sin(theta) * (rad * 0.99 + wrinkle),
          ];
        },
      });
    }

    // Solid 8mm DOUBLE-WALLED folded cloth cuff turning cleanly inside the sleeve (ZERO forearm poke-through!)
    const endCenter = armCurve.getPointAt(1.0);
    const endTang = armCurve.getTangentAt(1.0).normalize();
    const endSide = new THREE.Vector3().crossVectors(fwdRef, endTang).normalize();
    const endFwd = new THREE.Vector3().crossVectors(endTang, endSide).normalize();
    const cuffLipSpecs = [
      { alongOff: 0.0045, r: 0.067, wr: 0.0025, v: 2.58 },
      { alongOff: 0.0065, r: 0.062, wr: 0.0015, v: 2.64 },
      { alongOff: 0.0030, r: 0.0565, wr: 0.0008, v: 2.70 },
      { alongOff: -0.012, r: 0.055, wr: 0.0, v: 2.82 },
      { alongOff: -0.036, r: 0.053, wr: 0.0, v: 2.98 },
    ];
    for (const lip of cuffLipSpecs) {
      sleeveRings.push({
        center: endCenter.clone().addScaledVector(endTang, lip.alongOff),
        right: endSide,
        forward: endFwd,
        v: lip.v,
        profile: (theta) => {
          const w = Math.sin(theta * 4 + 1.2) * lip.wr;
          return [Math.cos(theta) * (lip.r + w), Math.sin(theta) * (lip.r * 0.97 + w)];
        },
      });
    }

    const sleeveGeo = createLoftedGeometry(sleeveRings, 36, true, false, 1.6);
    applySkinWeights(sleeveGeo, rig, {
      allowedBones: ['Chest', `Clavicle_${side}`, `UpperArm_${side}`, `Forearm_${side}`],
      sharpness: 2.3,
    });
    corduraParts.push(sleeveGeo);

    // Subtle tailored cuff seam welt hugging the outer rolled cuff cloth
    const cuffCenter = armCurve.getPointAt(0.95);
    const cuffTang = armCurve.getTangentAt(0.95).normalize();
    const cuffSide = new THREE.Vector3().crossVectors(fwdRef, cuffTang).normalize();
    const cuffFwd = new THREE.Vector3().crossVectors(cuffTang, cuffSide).normalize();
    const rCuffTrim = evalSleeveRadius(0.95) + 0.0005;

    const cuffPts: THREE.Vector3[] = [];
    const zigCount = 36;
    for (let z = 0; z < zigCount; z++) {
      const a = (z / zigCount) * Math.PI * 2;
      const zigOffset = (z % 2 === 0 ? 1 : -1) * 0.0012;
      cuffPts.push(
        cuffCenter
          .clone()
          .addScaledVector(cuffSide, Math.cos(a) * rCuffTrim * 1.025)
          .addScaledVector(cuffFwd, Math.sin(a) * rCuffTrim * 0.99)
          .addScaledVector(cuffTang, zigOffset)
      );
    }
    const cuffTrim = createTubeCurve(cuffPts, 0.0016, 48, 6, true);
    applySkinWeights(cuffTrim, rig, {
      allowedBones: [`UpperArm_${side}`, `Forearm_${side}`],
      sharpness: 3.0,
    });
    stitchParts.push(cuffTrim);

    // Reinforced posterior elbow guard patch — POSITIVE curveRadiusX hugs the cylindrical elbow tightly!
    const armDir = pElbow.clone().sub(pShoulder).normalize();
    const elbowOut = new THREE.Vector3(0.28 * s, -0.22, -0.92).normalize();
    const elbowCenter = pElbow.clone().addScaledVector(elbowOut, 0.064);
    const elbowGuard = createBeveledPanel({
      width: 0.062,
      height: 0.076,
      depth: 0.0055,
      cornerRadius: 0.015,
      bevel: 0.0020,
      curveRadiusX: 0.072,
    });
    orientPanelAt(elbowGuard, elbowCenter, elbowOut, armDir.clone().negate());
    applySkinWeights(elbowGuard, rig, {
      allowedBones: [`UpperArm_${side}`, `Forearm_${side}`],
      sharpness: 2.9,
    });
    honeycombParts.push(elbowGuard);

    // Thin (2.4mm) convex cylindrically curved black Velcro cloth patch hugging LEFT bicep sleeve cleanly!
    if (side === 'L') {
      const tVelcro = 0.44;
      const bicepCenter = armCurve.getPointAt(tVelcro);
      const vTang = armCurve.getTangentAt(tVelcro).normalize();
      const vSide = new THREE.Vector3().crossVectors(fwdRef, vTang).normalize();
      const vFwd = new THREE.Vector3().crossVectors(vTang, vSide).normalize();
      const outDir = vSide.clone().multiplyScalar(0.95).addScaledVector(vFwd, 0.30).normalize();
      // Account for sleeve 1.03x lateral width + 2.6mm cloth wrinkle crest so patch is 100% unbroken & flush
      const rSleeveAtVelcro = evalSleeveRadius(tVelcro) * 1.03 + 0.0026;
      const patchPos = bicepCenter.clone().addScaledVector(outDir, rSleeveAtVelcro + 0.0008);
      const velcro = createBeveledPanel({
        width: 0.060,
        height: 0.078,
        depth: 0.0024,
        cornerRadius: 0.0035,
        bevel: 0.0007,
        curveRadiusX: rSleeveAtVelcro + 0.002,
      });
      orientPanelAt(velcro, patchPos, outDir, vTang.clone().negate());
      applySkinWeights(velcro, rig, { allowedBones: ['UpperArm_L'], sharpness: 3.2 });
      velcroParts.push(velcro);
    }
  }

  return {
    corduraParts,
    forestWebbingParts,
    honeycombParts,
    webbingParts,
    gunmetalParts,
    upperSilverParts,
    velcroParts,
    stitchParts,
  };
}

/**
 * 3. BARE MUSCULAR FOREARMS, DOUBLE-WALLED FINGERLESS TACTICAL COMBAT GLOVES
 *    (smooth circular dorsal cutout + 5 individual tailored finger cuffs + 4-dome anatomical knuckle guard +
 *     snug Velcro wrist strap + palm grip pad), AND 10 ANATOMICAL BARE FINGERS WITH EMBEDDED CURVED NAILS
 */
function buildForearmsGlovesAndHands(rig: CharacterRig) {
  const skinParts: THREE.BufferGeometry[] = [];
  const gloveParts: THREE.BufferGeometry[] = [];
  const glovePlateParts: THREE.BufferGeometry[] = [];
  const nailParts: THREE.BufferGeometry[] = [];

  for (const side of ['L', 'R'] as const) {
    const pElbow = rig.bindWorldPos.get(`Forearm_${side}`)!;
    const pHand = rig.bindWorldPos.get(`Hand_${side}`)!;
    const align = computeGloveSkeletalAlignment(rig, side);
    const { handPos, along, forward, out, mcpJoints, cutoutCenterLocal } = align;

    const handDet = new THREE.Vector3().crossVectors(forward, out).dot(along);
    const flipWinding = handDet < 0;

    // Helper: ensure lofted hand/forearm meshes always have outward-facing winding on both L and R sides
    const fixHandWinding = (geo: THREE.BufferGeometry) => {
      if (!flipWinding) return;
      const idx = geo.getIndex();
      if (!idx) return;
      const arr = idx.array as Uint16Array | Uint32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const tmp = arr[i + 1];
        arr[i + 1] = arr[i + 2];
        arr[i + 2] = tmp;
      }
      idx.needsUpdate = true;
      geo.computeVertexNormals();
    };

    // --- A. Sculpted Athletic Bare Forearm (stays <= 48mm inside cuff t<0.30, swells below cuff!) ---
    const foreStart = pElbow.clone().lerp(pHand, 0.10);
    const foreEnd = pHand.clone().addScaledVector(along, 0.015);
    const foreRings: LoftRing[] = [];
    const foreSteps = 20;

    for (let i = 0; i <= foreSteps; i++) {
      const t = i / foreSteps;
      const center = foreStart.clone().lerp(foreEnd, t);
      const belowCuff = Math.max(0, Math.min(1, (t - 0.24) / 0.14));
      const muscBell = Math.sin(Math.min(1, Math.max(0, (t - 0.22) / 0.65)) * Math.PI);
      const muscBulge = belowCuff * belowCuff * (3 - 2 * belowCuff) * muscBell * 0.0085;

      const baseRx = THREE.MathUtils.lerp(0.045, 0.030, Math.pow(t, 0.90));
      const baseRz = THREE.MathUtils.lerp(0.042, 0.024, Math.pow(t, 0.90));
      const rx = baseRx + muscBulge;
      const rz = baseRz + muscBulge * 0.65;
      const wristBone = Math.exp(-Math.pow((t - 0.90) / 0.07, 2)) * 0.0032;

      foreRings.push({
        center,
        right: forward,
        forward: out,
        v: t * 1.5,
        profile: (theta) => {
          const c = Math.cos(theta);
          const sn = Math.sin(theta);
          const tendon = Math.sin(theta * 5) * 0.0010 * t;
          const ulna = c < -0.5 ? wristBone * (-c - 0.5) * 2 : 0;
          return [c * (rx + ulna + tendon), sn * (rz + tendon)];
        },
      });
    }
    const foreGeo = createLoftedGeometry(foreRings, 28, true, true, 1);
    fixHandWinding(foreGeo);
    applySkinWeights(foreGeo, rig, {
      allowedBones: [`UpperArm_${side}`, `Forearm_${side}`, `Hand_${side}`],
      sharpness: 2.8,
    });
    skinParts.push(foreGeo);

    // --- B. Anatomical Bare Palm & Dorsal Hand Core (snug beneath dorsal cutout, strictly nested inside glove edges!) ---
    const palmRings: LoftRing[] = [];
    const palmSteps = 16;
    for (let i = 0; i <= palmSteps; i++) {
      const t = i / palmSteps;
      const distA = THREE.MathUtils.lerp(-0.020, 0.088, t);
      const center = handPos.clone().addScaledVector(along, distA);
      // Stay strictly narrower than gloveShell laterally & stop cleanly before tipRoll (ZERO skin poke-through!)
      const halfW = THREE.MathUtils.lerp(0.0290, 0.0405, t);
      const halfT = THREE.MathUtils.lerp(0.0195, 0.0150, t);
      palmRings.push({
        center,
        right: forward,
        forward: out,
        v: t,
        profile: (theta) => {
          const c = Math.cos(theta);
          const sn = Math.sin(theta);
          const xBase = Math.sign(c) * Math.pow(Math.abs(c), 0.72) * halfW;
          // Anatomical palmar eminences kept cleanly inside the gloved palm shell
          const thenar = sn < 0 && c > 0.15 ? Math.sin(Math.min(1, t * 1.35) * Math.PI) * 0.0032 * c * -sn : 0;
          const hypothenar = sn < 0 && c < -0.25 ? Math.sin(t * Math.PI) * 0.0020 * (-c - 0.25) * -sn : 0;

          // Snug dorsal metacarpal cushion + extensor tendons radiating toward the 4 skeletal MCP knuckles!
          let dorsalAnatomy = 0;
          if (sn > 0.25) {
            const dorsalRise = Math.sin(Math.min(1, Math.max(0, (t - 0.12) / 0.76)) * Math.PI) * 0.0018 * sn;
            const tendonEnv = Math.sin(Math.min(1, Math.max(0, (t - 0.16) / 0.80)) * Math.PI);
            dorsalAnatomy += dorsalRise;
            for (const j of mcpJoints) {
              const targetF = THREE.MathUtils.lerp(j.forward * 0.42, j.forward, Math.max(0, (t - 0.15) / 0.85));
              const tendonRidge = Math.exp(-Math.pow((xBase - targetF) / 0.0046, 2)) * 0.0014 * tendonEnv;
              dorsalAnatomy += tendonRidge * sn;
            }
          }

          return [
            xBase,
            Math.sign(sn) * Math.pow(Math.abs(sn), 0.76) * halfT - thenar - hypothenar + dorsalAnatomy,
          ];
        },
      });
    }
    const palmGeo = createLoftedGeometry(palmRings, 36, true, true, 1);
    fixHandWinding(palmGeo);
    applySkinWeights(palmGeo, rig, {
      allowedBones: [`Forearm_${side}`, `Hand_${side}`],
      sharpness: 3.0,
    });
    skinParts.push(palmGeo);

    // --- C. High-Res Fingerless Combat Glove Shell with SKELETAL-ALIGNED Dorsal Keyhole Cutout & Knuckle Relief! ---

    const gloveSegU = 64;
    const gloveSegV = 32;
    const gStride = gloveSegU + 1;
    const gPos: number[] = [];
    const gUv: number[] = [];
    const gIdx: number[] = [];

    const gloveStartA = -0.036;
    const gloveEndA = 0.098;
    const gloveLenA = gloveEndA - gloveStartA;

    const evalGloveDimensions = (t: number) => {
      const distAlong = THREE.MathUtils.lerp(gloveStartA, gloveEndA, t);
      const wristRoll = t < 0.07 ? -0.0036 * (1 - t / 0.07) : 0;
      // Roll the distal end cleanly inward to seal flush around the finger bases (ZERO hollow palm-side gap!)
      const tipRoll = t > 0.91 ? -0.0042 * Math.pow((t - 0.91) / 0.09, 1.4) : 0;
      const halfW =
        (t < 0.24
          ? THREE.MathUtils.lerp(0.0355, 0.0352, t / 0.24)
          : THREE.MathUtils.lerp(0.0352, 0.0474, (t - 0.24) / 0.76)) +
        wristRoll +
        tipRoll;
      const halfT =
        (t < 0.24 ? 0.0242 : THREE.MathUtils.lerp(0.0236, 0.0186, (t - 0.24) / 0.76)) +
        wristRoll * 0.75 +
        tipRoll * 0.95;
      return { distAlong, halfW, halfT };
    };

    // Derive dorsal cutout center DIRECTLY from skeletal metacarpal valley alignment!
    const holeV = THREE.MathUtils.clamp((cutoutCenterLocal.along - gloveStartA) / gloveLenA + 0.02, 0.28, 0.74);
    const holeDims = evalGloveDimensions(holeV);
    const holeCos = THREE.MathUtils.clamp(cutoutCenterLocal.forward / holeDims.halfW, -0.35, 0.35);
    const holeTheta = Math.acos(holeCos); // +out (PI/2) shifted accurately onto skeletal metacarpal midline!
    const holeRx = 0.142;
    const holeRy = 0.118;

    for (let iv = 0; iv <= gloveSegV; iv++) {
      const tRaw = iv / gloveSegV;
      for (let iu = 0; iu <= gloveSegU; iu++) {
        const uf = iu / gloveSegU;
        const thetaRaw = uf * Math.PI * 2;

        // Radially snap vertices around the skeletal-aligned dorsal keyhole onto an exact smooth ellipse!
        let dTheta = thetaRaw - holeTheta;
        while (dTheta > Math.PI) dTheta -= Math.PI * 2;
        while (dTheta < -Math.PI) dTheta += Math.PI * 2;
        const hx = (dTheta * 0.44) / holeRx;
        const hy = ((tRaw - holeV) * 1.15) / holeRy;
        const dNorm = Math.hypot(hx, hy);

        let theta = thetaRaw;
        let t = tRaw;
        if (dNorm > 0.001 && dNorm > 0.70 && dNorm < 1.22) {
          const pull = 1 - Math.abs(dNorm - 1.0) / 0.30;
          if (pull > 0) {
            const targetN = THREE.MathUtils.lerp(dNorm, 1.0, pull * 0.80);
            const scale = targetN / dNorm;
            theta = holeTheta + (hx * scale * holeRx) / 0.44;
            t = THREE.MathUtils.clamp(holeV + (hy * scale * holeRy) / 1.15, 0, 1);
          }
        }

        const { distAlong, halfW, halfT } = evalGloveDimensions(t);
        const center = handPos.clone().addScaledVector(along, distAlong);
        const c = Math.cos(theta);
        const sn = Math.sin(theta);

        const baseX = Math.sign(c) * Math.pow(Math.abs(c), 0.72) * halfW;
        // Subtle flat tailored binding welt around cutout perimeter (replaces bulbous bump)
        const rimBump = Math.exp(-Math.pow((dNorm - 1.04) / 0.18, 2)) * 0.0009;

        // Sculpt anatomical fabric stretch over the 4 skeletal MCP knuckles + wrist/palm tension creases
        let mcpStretch = 0;
        if (sn > 0.25) {
          for (const j of mcpJoints) {
            const da = distAlong - j.along;
            const df = baseX - j.forward;
            mcpStretch += Math.exp(-(da * da) / 0.00018 - (df * df) / 0.000095) * 0.0022 * sn;
          }
        }
        const palmCrease =
          sn < -0.35 ? Math.sin(distAlong * 130 + baseX * 35) * 0.00055 * (-sn) : 0;
        const clothFold = Math.sin(theta * 5 + t * 15) * 0.00040;

        const rx = Math.sign(c) * Math.pow(Math.abs(c), 0.72) * (halfW + rimBump + clothFold);
        const rz =
          Math.sign(sn) * Math.pow(Math.abs(sn), 0.78) * (halfT + rimBump + clothFold) +
          mcpStretch +
          palmCrease;

        const wp = center.clone().addScaledVector(forward, rx).addScaledVector(out, rz);
        gPos.push(wp.x, wp.y, wp.z);
        gUv.push(uf * 1.4, t * 1.2);
      }
    }

    for (let iv = 0; iv < gloveSegV; iv++) {
      const tMid = (iv + 0.5) / gloveSegV;
      for (let iu = 0; iu < gloveSegU; iu++) {
        const thetaMid = ((iu + 0.5) / gloveSegU) * Math.PI * 2;
        let dTheta = thetaMid - holeTheta;
        while (dTheta > Math.PI) dTheta -= Math.PI * 2;
        while (dTheta < -Math.PI) dTheta += Math.PI * 2;
        const dNorm = Math.hypot((dTheta * 0.44) / holeRx, ((tMid - holeV) * 1.15) / holeRy);
        if (dNorm < 0.965) continue;

        const a = iv * gStride + iu;
        const b = (iv + 1) * gStride + iu;
        const c = (iv + 1) * gStride + iu + 1;
        const d = iv * gStride + iu + 1;
        if (flipWinding) {
          gIdx.push(a, b, d);
          gIdx.push(b, c, d);
        } else {
          gIdx.push(a, d, b);
          gIdx.push(b, d, c);
        }
      }
    }
    const gloveShell = new THREE.BufferGeometry();
    gloveShell.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
    gloveShell.setAttribute('uv', new THREE.Float32BufferAttribute(gUv, 2));
    gloveShell.setIndex(gIdx);
    gloveShell.computeVertexNormals();
    applySkinWeights(gloveShell, rig, {
      allowedBones: [
        `Forearm_${side}`,
        `Hand_${side}`,
        `Thumb_01_${side}`,
        `Index_01_${side}`,
        `Middle_01_${side}`,
        `Ring_01_${side}`,
        `Pinky_01_${side}`,
      ],
      sharpness: 3.1,
    });
    gloveParts.push(gloveShell);

    // Sleek tailored double-stitched binding welt sealing the skeletal-aligned dorsal keyhole perimeter (1.8mm radius, NOT a fat donut!)
    const cutoutRimPts: THREE.Vector3[] = [];
    for (let k = 0; k < 36; k++) {
      const ang = (k / 36) * Math.PI * 2;
      const tRing = holeV + (Math.sin(ang) * holeRy * 1.01) / 1.15;
      const thRing = holeTheta + (Math.cos(ang) * holeRx * 1.01) / 0.44;
      const { distAlong, halfW, halfT } = evalGloveDimensions(tRing);
      const center = handPos.clone().addScaledVector(along, distAlong);
      const c = Math.cos(thRing);
      const sn = Math.sin(thRing);
      cutoutRimPts.push(
        center
          .clone()
          .addScaledVector(forward, Math.sign(c) * Math.pow(Math.abs(c), 0.72) * (halfW + 0.0003))
          .addScaledVector(out, Math.sign(sn) * Math.pow(Math.abs(sn), 0.78) * (halfT + 0.0005))
      );
    }
    const cutoutRim = createTubeCurve(cutoutRimPts, 0.0019, 36, 10, true);
    applySkinWeights(cutoutRim, rig, { allowedBones: [`Hand_${side}`], sharpness: 3.3 });
    gloveParts.push(cutoutRim);

    // Double-walled rolled wrist cuff hem sealing cleanly around the bare wrist skin
    const wristHemPts: THREE.Vector3[] = [];
    const wristHemCenter = handPos.clone().addScaledVector(along, -0.036);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      wristHemPts.push(
        wristHemCenter
          .clone()
          .addScaledVector(forward, Math.cos(a) * 0.0335)
          .addScaledVector(out, Math.sin(a) * 0.0230)
      );
    }
    const wristHem = createTubeCurve(wristHemPts, 0.0032, 28, 8, true);
    applySkinWeights(wristHem, rig, {
      allowedBones: [`Forearm_${side}`, `Hand_${side}`],
      sharpness: 3.2,
    });
    gloveParts.push(wristHem);

    // Helper to scale panel UVs so Clarino micro-suede + diamond knurl matches physical texel density everywhere
    const scaleUVs = (geo: THREE.BufferGeometry, sx: number, sy: number) => {
      const uvAttr = geo.attributes.uv;
      for (let i = 0; i < uvAttr.count; i++) {
        uvAttr.setXY(i, uvAttr.getX(i) * sx, uvAttr.getY(i) * sy);
      }
    };

    // Snug matte micro-fabric Velcro wrist cinch strap + reinforced pull tab on back of wrist
    const strapPts: THREE.Vector3[] = [];
    const wristCenter = handPos.clone().addScaledVector(along, -0.020);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      strapPts.push(
        wristCenter
          .clone()
          .addScaledVector(forward, Math.cos(a) * 0.0365)
          .addScaledVector(out, Math.sin(a) * 0.0252)
      );
    }
    const wristStrap = createSweptStrap(strapPts, 0.017, 0.0044, 28, true, along);
    scaleUVs(wristStrap, 0.55, 0.25);
    applySkinWeights(wristStrap, rig, {
      allowedBones: [`Forearm_${side}`, `Hand_${side}`],
      sharpness: 3.2,
    });
    glovePlateParts.push(wristStrap);

    const wristTab = createBeveledPanel({
      width: 0.024,
      height: 0.015,
      depth: 0.0040,
      cornerRadius: 0.0035,
      bevel: 0.0011,
      curveRadiusX: 0.038,
    });
    scaleUVs(wristTab, 2.4, 2.4);
    orientPanelAt(
      wristTab,
      wristCenter.clone().addScaledVector(out, 0.0262),
      out,
      along.clone().negate()
    );
    applySkinWeights(wristTab, rig, {
      allowedBones: [`Forearm_${side}`, `Hand_${side}`],
      sharpness: 3.2,
    });
    glovePlateParts.push(wristTab);

    // --- D. SKELETAL-ALIGNED Sculpted 4-Crown Molded Knuckle Guard (Directly Follows Pinky_01..Index_01 Bones!) ---
    const evalGloveSurfaceOut = (alongVal: number, fwdVal: number) => {
      const tVal = THREE.MathUtils.clamp((alongVal - gloveStartA) / gloveLenA, 0, 1);
      const { halfW, halfT } = evalGloveDimensions(tVal);
      const nx = THREE.MathUtils.clamp(fwdVal / Math.max(halfW, 0.001), -0.96, 0.96);
      const surfFactor = Math.pow(Math.max(0.08, 1 - nx * nx), 0.42);
      return halfT * surfFactor;
    };

    const jPinky = mcpJoints[0];
    const jRing = mcpJoints[1];
    const jMiddle = mcpJoints[2];
    const jIndex = mcpJoints[3];

    const knuckControlPts = [
      handPos
        .clone()
        .addScaledVector(along, jPinky.along - 0.004)
        .addScaledVector(forward, jPinky.forward - 0.012)
        .addScaledVector(out, evalGloveSurfaceOut(jPinky.along, jPinky.forward - 0.012) + 0.0010),
      ...mcpJoints.map((j) =>
        handPos
          .clone()
          .addScaledVector(along, j.along - 0.003)
          .addScaledVector(forward, j.forward)
          .addScaledVector(out, evalGloveSurfaceOut(j.along - 0.003, j.forward) + 0.0022)
      ),
      handPos
        .clone()
        .addScaledVector(along, jIndex.along - 0.004)
        .addScaledVector(forward, jIndex.forward + 0.012)
        .addScaledVector(out, evalGloveSurfaceOut(jIndex.along, jIndex.forward + 0.012) + 0.0010),
    ];

    const knuckSpine = new THREE.CatmullRomCurve3(knuckControlPts);
    const knuckRings: LoftRing[] = [];
    const knuckSteps = 36;
    const basisInv = new THREE.Matrix4().makeBasis(along, forward, out).invert();

    for (let ki = 0; ki <= knuckSteps; ki++) {
      const kt = ki / knuckSteps;
      const kc = knuckSpine.getPointAt(kt);
      const ktTang = knuckSpine.getTangentAt(kt).normalize();
      const kAlong = new THREE.Vector3().crossVectors(out, ktTang).normalize();
      const kOut = new THREE.Vector3().crossVectors(ktTang, kAlong).normalize();
      const locPt = kc.clone().sub(handPos).applyMatrix4(basisInv);

      const endEnv = Math.sin(kt * Math.PI);
      const smoothEnd = Math.pow(Math.max(0.06, endEnv), 0.42);

      // Evaluate exact anatomical crown bump centered on EACH skeletal MCP bone (Pinky/Ring/Middle/Index)
      let crownPeak = 0;
      let flexValley = 0;
      for (let m = 0; m < mcpJoints.length; m++) {
        const df = locPt.y - mcpJoints[m].forward;
        const sizeScale = m === 2 ? 1.15 : m === 0 ? 0.88 : 1.0; // Middle MCP knuckle slightly proudest!
        crownPeak = Math.max(crownPeak, Math.exp(-(df * df) / 0.000042) * sizeScale);
        if (m < mcpJoints.length - 1) {
          const midF = (mcpJoints[m].forward + mcpJoints[m + 1].forward) * 0.5;
          const dv = locPt.y - midF;
          flexValley = Math.max(flexValley, Math.exp(-(dv * dv) / 0.000018));
        }
      }

      const halfAlong = 0.0110 * smoothEnd + crownPeak * 0.0024 - flexValley * 0.0014;
      const halfThick = 0.0036 * smoothEnd + crownPeak * 0.0034 - flexValley * 0.0011;

      knuckRings.push({
        center: kc,
        right: kAlong,
        forward: kOut,
        v: kt * 1.15,
        profile: (theta) => {
          const c = Math.cos(theta);
          const sn = Math.sin(theta);
          const apexRib = sn > 0.72 && Math.abs(c) < 0.35 ? 0.0008 * crownPeak : 0;
          const domeOut = sn > 0 ? Math.pow(sn, 0.72) * halfThick + apexRib : sn * 0.0024 * smoothEnd;
          return [Math.sign(c) * Math.pow(Math.abs(c), 0.72) * halfAlong, domeOut];
        },
      });
    }
    const knuckGuardGeo = createLoftedGeometry(knuckRings, 20, true, true, 0.55);
    applySkinWeights(knuckGuardGeo, rig, {
      allowedBones: [
        `Hand_${side}`,
        `Index_01_${side}`,
        `Middle_01_${side}`,
        `Ring_01_${side}`,
        `Pinky_01_${side}`,
      ],
      sharpness: 3.4,
    });
    glovePlateParts.push(knuckGuardGeo);

    // Sleek low-profile dorsal metacarpal side-reinforcement trims hugging cleanly inside the dorsal hand edges
    for (const flankSign of [-1, 1] as const) {
      const flankPts = [0.012, 0.040, 0.068].map((aPos) => {
        const tVal = THREE.MathUtils.clamp((aPos - gloveStartA) / gloveLenA, 0, 1);
        const { halfW } = evalGloveDimensions(tVal);
        const fCoord = flankSign * halfW * 0.72;
        return handPos
          .clone()
          .addScaledVector(along, aPos)
          .addScaledVector(forward, fCoord)
          .addScaledVector(out, evalGloveSurfaceOut(aPos, fCoord) + 0.0008);
      });
      const flankPatch = createSweptStrap(flankPts, 0.0065, 0.0016, 14, false, forward);
      scaleUVs(flankPatch, 0.30, 0.40);
      applySkinWeights(flankPatch, rig, { allowedBones: [`Hand_${side}`], sharpness: 3.3 });
      glovePlateParts.push(flankPatch);
    }

    // --- E. 3-Zone Ergonomic Micro-Fabric Tactical Palm Reinforcement Plates (Seated Flush on Outer Palmar Surface!) ---
    // 1. Distal Metacarpal Grip Cushion Plate spanning across the base of all 4 fingers on the inner palm
    const distalAlong = align.meanMcpAlong - 0.017;
    const distalPalmOut = evalGloveSurfaceOut(distalAlong, align.meanMcpForward);
    const distalPalmPad = createBeveledPanel({
      width: 0.066,
      height: 0.030,
      depth: 0.0036,
      cornerRadius: 0.010,
      bevel: 0.0012,
      curveRadiusX: 0.088,
    });
    scaleUVs(distalPalmPad, 2.8, 2.8);
    const distalNorm = out.clone().negate().addScaledVector(along, 0.055).normalize();
    orientPanelAt(
      distalPalmPad,
      handPos
        .clone()
        .addScaledVector(along, distalAlong)
        .addScaledVector(forward, align.meanMcpForward)
        .addScaledVector(out, -(distalPalmOut + 0.0024)),
      distalNorm,
      along.clone().negate()
    );
    applySkinWeights(distalPalmPad, rig, {
      allowedBones: [`Hand_${side}`, `Index_01_${side}`, `Middle_01_${side}`, `Ring_01_${side}`, `Pinky_01_${side}`],
      sharpness: 3.2,
    });
    glovePlateParts.push(distalPalmPad);

    // 2. Thenar / Thumb-Saddle Reinforced Abrasion Pad hugging the thumb base & grip web
    const thenarAlong = 0.030;
    const thenarFwd = 0.019;
    const thenarOut = evalGloveSurfaceOut(thenarAlong, thenarFwd);
    const thenarPad = createBeveledPanel({
      width: 0.034,
      height: 0.044,
      depth: 0.0036,
      cornerRadius: 0.012,
      bevel: 0.0013,
      curveRadiusX: 0.046,
    });
    scaleUVs(thenarPad, 2.8, 2.8);
    const thenarNorm = out.clone().negate().addScaledVector(forward, 0.28).normalize();
    orientPanelAt(
      thenarPad,
      handPos
        .clone()
        .addScaledVector(along, thenarAlong)
        .addScaledVector(forward, thenarFwd)
        .addScaledVector(out, -(thenarOut + 0.0008)),
      thenarNorm,
      along.clone().negate()
    );
    applySkinWeights(thenarPad, rig, {
      allowedBones: [`Hand_${side}`, `Thumb_01_${side}`],
      sharpness: 3.2,
    });
    glovePlateParts.push(thenarPad);

    // 3. Hypothenar / Heel-of-Palm Shock Cushion Plate protecting the outer ulnar palm base
    const heelAlong = 0.022;
    const heelFwd = -0.019;
    const heelOut = evalGloveSurfaceOut(heelAlong, heelFwd);
    const heelPalmPad = createBeveledPanel({
      width: 0.032,
      height: 0.042,
      depth: 0.0038,
      cornerRadius: 0.011,
      bevel: 0.0013,
      curveRadiusX: 0.048,
    });
    scaleUVs(heelPalmPad, 2.8, 2.8);
    const hypoNorm = out.clone().negate().addScaledVector(forward, -0.24).normalize();
    orientPanelAt(
      heelPalmPad,
      handPos
        .clone()
        .addScaledVector(along, heelAlong)
        .addScaledVector(forward, heelFwd)
        .addScaledVector(out, -(heelOut + 0.0008)),
      hypoNorm,
      along.clone().negate()
    );
    applySkinWeights(heelPalmPad, rig, { allowedBones: [`Hand_${side}`], sharpness: 3.3 });
    glovePlateParts.push(heelPalmPad);

    // --- F. 10 High-Detail Anatomical Bare Fingers + 10 Articulated Fingerless Cuffs + Flush Cuticle-Seated Nails ---
    const fingerSpecs: { name: string; rBase: number; tipLen: number; cuffEndT: number }[] = [
      { name: 'Thumb', rBase: 0.0112, tipLen: 0.026, cuffEndT: 0.34 },
      { name: 'Index', rBase: 0.0094, tipLen: 0.024, cuffEndT: 0.36 },
      { name: 'Middle', rBase: 0.0098, tipLen: 0.025, cuffEndT: 0.36 },
      { name: 'Ring', rBase: 0.0092, tipLen: 0.023, cuffEndT: 0.36 },
      { name: 'Pinky', rBase: 0.0080, tipLen: 0.020, cuffEndT: 0.35 },
    ];

    for (const fSpec of fingerSpecs) {
      const b1 = `${fSpec.name}_01_${side}`;
      const b2 = `${fSpec.name}_02_${side}`;
      const b3 = `${fSpec.name}_03_${side}`;
      const p1 = rig.bindWorldPos.get(b1)!;
      const p2 = rig.bindWorldPos.get(b2)!;
      const p3 = rig.bindWorldPos.get(b3)!;
      const dirTip = p3.clone().sub(p2).normalize();
      const pTip = p3.clone().addScaledVector(dirTip, fSpec.tipLen);
      const pRoot = p1.clone().addScaledVector(p2.clone().sub(p1).normalize(), -0.018);

      const fCurve = new THREE.CatmullRomCurve3([pRoot, p1, p2, p3, pTip]);
      const fRings: LoftRing[] = [];
      const fSteps = 26;

      for (let i = 0; i <= fSteps; i++) {
        const t = i / fSteps;
        const cPos = fCurve.getPointAt(t);
        const tang = fCurve.getTangentAt(t).normalize();
        const sideAxis = new THREE.Vector3().crossVectors(out, tang).normalize();
        const dorsalAxis = new THREE.Vector3().crossVectors(tang, sideAxis).normalize();

        // Natural anatomical phalangeal taper + refined bony PIP & DIP condyles (NO sausage pinching!)
        const phalanxWaist1 = Math.exp(-Math.pow((t - 0.28) / 0.08, 2)) * -0.00028;
        const phalanxWaist2 = Math.exp(-Math.pow((t - 0.56) / 0.07, 2)) * -0.00024;
        const pipCondyle = Math.exp(-Math.pow((t - 0.43) / 0.052, 2)) * 0.00095;
        const dipCondyle = Math.exp(-Math.pow((t - 0.69) / 0.044, 2)) * 0.00068;

        // Multi-pleat dorsal PIP & DIP knuckle skin folds (crisp anatomical transverse creases)
        const pipSkinFolds =
          Math.exp(-Math.pow((t - 0.43) / 0.036, 2)) * Math.cos((t - 0.43) * 260) * 0.00040;
        const dipSkinFolds =
          Math.exp(-Math.pow((t - 0.69) / 0.026, 2)) * Math.cos((t - 0.69) * 280) * 0.00028;

        // Palmar joint flexion creases on underside of PIP & DIP joints
        const palmarFlex1 = Math.exp(-Math.pow((t - 0.43) / 0.013, 2)) * -0.00058;
        const palmarFlex2 = Math.exp(-Math.pow((t - 0.69) / 0.011, 2)) * -0.00044;

        // Cuticle / eponychium soft rim pocket right behind the fingernail base (t ≈ 0.715)
        const cuticleRim = Math.exp(-Math.pow((t - 0.715) / 0.016, 2)) * 0.00045;

        // Smooth hemisphere fingertip dome closing completely to 0.0001 at t=1 (ZERO open pinhole!)
        const tipRound =
          i === fSteps
            ? 0.00015
            : t > 0.855
              ? Math.sqrt(Math.max(0.0004, 1 - Math.pow((t - 0.855) / 0.145, 2)))
              : 1;
        const r =
          (fSpec.rBase * THREE.MathUtils.lerp(1.04, 0.78, t) +
            phalanxWaist1 +
            phalanxWaist2 +
            pipCondyle +
            dipCondyle) *
          tipRound;

        fRings.push({
          center: cPos,
          right: sideAxis,
          forward: dorsalAxis,
          v: t,
          profile: (theta) => {
            const c = Math.cos(theta);
            const sn = Math.sin(theta);
            const latBone = (pipCondyle + dipCondyle) * 0.30 * Math.abs(c) * tipRound;
            const dorsalDetail = sn > 0.30 ? (pipSkinFolds + dipSkinFolds + cuticleRim) * sn * tipRound : 0;
            const palmarCrease = sn < -0.30 ? (palmarFlex1 + palmarFlex2) * (-sn) * tipRound : 0;
            const distalPad =
              sn < 0 && t > 0.72 && t < 0.94
                ? -sn * 0.0013 * Math.sin(((t - 0.72) / 0.22) * Math.PI) * tipRound
                : 0;
            const midPad =
              sn < 0 && t > 0.46 && t < 0.66
                ? -sn * 0.0006 * Math.sin(((t - 0.46) / 0.20) * Math.PI) * tipRound
                : 0;
            return [
              c * (r * 1.02 + latBone),
              sn * r * 0.91 + dorsalDetail + palmarCrease - distalPad - midPad,
            ];
          },
        });
      }

      const fGeo = createLoftedGeometry(fRings, 18, true, true, 1);
      applySkinWeights(fGeo, rig, {
        allowedBones: [`Hand_${side}`, b1, b2, b3],
        sharpness: 3.4,
      });
      skinParts.push(fGeo);

      // Individual Tailored Double-Walled Fingerless Glove Cuff with Dorsal Flex Pleats & Rolled Hem!
      const cuffRings: LoftRing[] = [];
      const cuffTStops = [
        { t: 0.01, rMult: 1.24, pleat: 0.0, v: 0.0 },
        { t: 0.10, rMult: 1.20, pleat: 0.0008, v: 0.22 },
        { t: 0.19, rMult: 1.17, pleat: -0.0004, v: 0.44 },
        { t: 0.27, rMult: 1.18, pleat: 0.0008, v: 0.65 },
        { t: fSpec.cuffEndT - 0.02, rMult: 1.15, pleat: 0.0, v: 0.80 },
        { t: fSpec.cuffEndT, rMult: 1.11, pleat: 0.0, v: 0.90 },
        // Rounded double-stitched cloth hem rolling cleanly inward against bare finger skin!
        { t: fSpec.cuffEndT + 0.007, rMult: 1.02, pleat: 0.0, v: 0.96 },
        { t: fSpec.cuffEndT - 0.014, rMult: 0.96, pleat: 0.0, v: 1.0 },
      ];
      for (const cs of cuffTStops) {
        const cPos = fCurve.getPointAt(Math.min(0.95, Math.max(0.0, cs.t)));
        const tang = fCurve.getTangentAt(Math.min(0.95, Math.max(0.0, cs.t))).normalize();
        const sideAxis = new THREE.Vector3().crossVectors(out, tang).normalize();
        const dorsalAxis = new THREE.Vector3().crossVectors(tang, sideAxis).normalize();
        const rBaseAtT = fSpec.rBase * THREE.MathUtils.lerp(1.04, 0.78, cs.t);
        const cr = rBaseAtT * cs.rMult;
        cuffRings.push({
          center: cPos,
          right: sideAxis,
          forward: dorsalAxis,
          v: cs.v * 0.55,
          profile: (theta) => {
            const c = Math.cos(theta);
            const sn = Math.sin(theta);
            const flexPleat = sn > 0.35 ? cs.pleat * sn : 0;
            // Subtle lateral fourchette stitching ridge along both sides of each finger cuff
            const sideStitch = Math.abs(c) > 0.85 ? 0.00040 : 0;
            return [c * (cr * 1.04 + sideStitch), sn * cr * 0.95 + flexPleat];
          },
        });
      }
      const fingerCuff = createLoftedGeometry(cuffRings, 16, false, false, 0.55);
      applySkinWeights(fingerCuff, rig, {
        allowedBones: [`Hand_${side}`, b1, b2],
        sharpness: 3.4,
      });
      gloveParts.push(fingerCuff);

      // Sleek low-profile molded dorsal micro-fabric impact tab centered on proximal Index/Middle/Ring finger cuffs!
      if (fSpec.name === 'Index' || fSpec.name === 'Middle' || fSpec.name === 'Ring') {
        const tabT = 0.21;
        const tabPos = fCurve.getPointAt(tabT);
        const tabTang = fCurve.getTangentAt(tabT).normalize();
        const tabSide = new THREE.Vector3().crossVectors(out, tabTang).normalize();
        const tabDorsal = new THREE.Vector3().crossVectors(tabTang, tabSide).normalize();
        const tabR = fSpec.rBase * THREE.MathUtils.lerp(1.04, 0.78, tabT) * 1.15;
        const fingerPad = createBeveledPanel({
          width: fSpec.rBase * 1.04,
          height: 0.013,
          depth: 0.0018,
          cornerRadius: 0.0028,
          bevel: 0.0006,
          curveRadiusX: tabR * 0.96,
        });
        scaleUVs(fingerPad, 2.8, 2.8);
        const mTab = new THREE.Matrix4().makeBasis(tabSide, tabTang, tabDorsal);
        mTab.setPosition(tabPos.clone().addScaledVector(tabDorsal, tabR * 0.90));
        fingerPad.applyMatrix4(mTab);
        applySkinWeights(fingerPad, rig, { allowedBones: [`Hand_${side}`, b1, b2], sharpness: 3.4 });
        glovePlateParts.push(fingerPad);
      }

      // Flush Curved Keratin Fingernail embedded cleanly into dorsal nail bed (t = 0.72..0.855, NEVER overhangs tip!)
      const nailStart = fCurve.getPointAt(0.72);
      const nailEnd = fCurve.getPointAt(0.855);
      const nailMid = nailStart.clone().lerp(nailEnd, 0.5);
      const nailTang = nailEnd.clone().sub(nailStart).normalize();
      const nailSide = new THREE.Vector3().crossVectors(out, nailTang).normalize();
      const nailDorsal = new THREE.Vector3().crossVectors(nailTang, nailSide).normalize();

      const rAtNail = fSpec.rBase * THREE.MathUtils.lerp(1.04, 0.78, 0.79);
      const nailW = rAtNail * 1.18;
      const nailL = nailStart.distanceTo(nailEnd);
      const nailGeo = createBeveledPanel({
        width: nailW,
        height: nailL,
        depth: 0.0009,
        cornerRadius: nailW * 0.44,
        bevel: 0.00025,
        curveRadiusX: rAtNail * 0.95,
        curveRadiusY: nailL * 1.55,
      });
      const mNail = new THREE.Matrix4().makeBasis(nailSide, nailTang, nailDorsal);
      // Seat flush so back of nail rests inside dorsal skin bed and convex dorsal arch rises ~0.45mm proud!
      mNail.setPosition(nailMid.clone().addScaledVector(nailDorsal, rAtNail * 0.855));
      nailGeo.applyMatrix4(mNail);
      applySkinWeights(nailGeo, rig, { rigidBone: b3 });
      nailParts.push(nailGeo);
    }
  }

  return { skinParts, gloveParts, glovePlateParts, nailParts };
}

/**
 * 4. HEAVY TACTICAL BELT + DOUBLE-ROW GROMMETS + OPEN-FRAME BUCKLE,
 *    DRAPED RIPSTOP CARGO TROUSERS + CONVEX PILLOWED POCKETS + FLUSH RIGHT-THIGH DROP-LEG STRAPS,
 *    CONVEX ERGONOMIC MATTE-BLACK KNEE PADS + EXACT-FIT REAR STRAPS,
 *    AND CONTINUOUS ANATOMICAL PEBBLED-LEATHER COMBAT BOOTS WITH DEEP VIBRAM LUGS FLUSH AT Y = 0.000!
 */
function buildLowerOutfitAndBoots(rig: CharacterRig) {
  const trouserParts: THREE.BufferGeometry[] = [];
  const webbingParts: THREE.BufferGeometry[] = [];
  const armorParts: THREE.BufferGeometry[] = [];
  const gunmetalParts: THREE.BufferGeometry[] = [];
  const silverParts: THREE.BufferGeometry[] = [];
  const leatherParts: THREE.BufferGeometry[] = [];
  const rubberParts: THREE.BufferGeometry[] = [];

  // --- A. Heavy Tactical Duty Belt + 20 Double-Row Grommets + Stitched Loops + Open-Frame Buckle ---
  const beltY = 0.968;
  const beltPts: THREE.Vector3[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    beltPts.push(new THREE.Vector3(Math.sin(a) * 0.178, beltY, -0.003 + Math.cos(a) * 0.128));
  }
  const beltStrap = createSweptStrap(beltPts, 0.046, 0.011, 44, true, new THREE.Vector3(0, 1, 0));
  applySkinWeights(beltStrap, rig, { allowedBones: ['Pelvis', 'Spine_01'], sharpness: 3.2 });
  webbingParts.push(beltStrap);

  // 6 Thick stitched Cordura trouser belt loops hugging belt cleanly
  for (const ang of [-2.45, -1.52, -0.54, 0.54, 1.52, 2.45]) {
    const lx = Math.sin(ang) * 0.182;
    const lz = -0.003 + Math.cos(ang) * 0.132;
    const loop = createBeveledPanel({
      width: 0.015,
      height: 0.056,
      depth: 0.007,
      cornerRadius: 0.0022,
      bevel: 0.0014,
      curveRadiusX: 0.18,
    });
    transformGeo(loop, [lx, beltY, lz], [0, ang, 0]);
    applySkinWeights(loop, rig, { allowedBones: ['Pelvis', 'Spine_01'], sharpness: 3.2 });
    trouserParts.push(loop);
  }

  // Double row of crisp brushed gunmetal belt grommet eyelets matching 4_a81a6ae0.jpg!
  const beltGrommetAngles = [-1.22, -0.98, -0.78, -0.34, 0.34, 0.78, 0.98, 1.22];
  for (const ang of beltGrommetAngles) {
    const gx = Math.sin(ang) * 0.184;
    const gz = -0.003 + Math.cos(ang) * 0.134;
    for (const dy of [-0.010, 0.010]) {
      const g = createGrommetRing(0.0044, 0.0018);
      transformGeo(g, [gx, beltY + dy, gz], [0, ang, 0]);
      applySkinWeights(g, rig, { allowedBones: ['Pelvis'], sharpness: 3.4 });
      gunmetalParts.push(g);
    }
  }

  // Sculpted open-frame double-prong tactical gunmetal buckle (top/bottom/left/right bars + center pin + prongs!)
  const bz = 0.132;
  const buckleTop = createBeveledPanel({ width: 0.068, height: 0.009, depth: 0.010, cornerRadius: 0.0025, bevel: 0.0016 });
  transformGeo(buckleTop, [0, beltY + 0.023, bz]);
  const buckleBot = createBeveledPanel({ width: 0.068, height: 0.009, depth: 0.010, cornerRadius: 0.0025, bevel: 0.0016 });
  transformGeo(buckleBot, [0, beltY - 0.023, bz]);
  const buckleLeft = createBeveledPanel({ width: 0.010, height: 0.055, depth: 0.010, cornerRadius: 0.0025, bevel: 0.0016 });
  transformGeo(buckleLeft, [-0.029, beltY, bz]);
  const buckleRight = createBeveledPanel({ width: 0.010, height: 0.055, depth: 0.010, cornerRadius: 0.0025, bevel: 0.0016 });
  transformGeo(buckleRight, [0.029, beltY, bz]);
  const buckleCenter = createBeveledPanel({ width: 0.009, height: 0.052, depth: 0.009, cornerRadius: 0.002, bevel: 0.0014 });
  transformGeo(buckleCenter, [0.004, beltY, bz + 0.001]);
  const prongTop = createBeveledPanel({ width: 0.026, height: 0.005, depth: 0.006, cornerRadius: 0.0015, bevel: 0.001 });
  transformGeo(prongTop, [-0.010, beltY + 0.010, bz + 0.004]);
  const prongBot = createBeveledPanel({ width: 0.026, height: 0.005, depth: 0.006, cornerRadius: 0.0015, bevel: 0.001 });
  transformGeo(prongBot, [-0.010, beltY - 0.010, bz + 0.004]);
  for (const b of [buckleTop, buckleBot, buckleLeft, buckleRight, buckleCenter, prongTop, prongBot]) {
    applySkinWeights(b, rig, { allowedBones: ['Pelvis'], sharpness: 3.4 });
    gunmetalParts.push(b);
  }

  // --- B. Solid Seamless Olive Ripstop Cargo Trousers Pelvis & Waistband (UPWARD rings = 100% OUTWARD normals!) ---
  const pelvisLevels = [
    // Smooth tapered lower crotch-saddle curve so pelvis blends organically into both thighs (ZERO harsh step!)
    { y: 0.784, rx: 0.108, rz: 0.086, zOff: -0.003, v: 0.0 },
    { y: 0.808, rx: 0.146, rz: 0.104, zOff: -0.005, v: 0.12 },
    { y: 0.836, rx: 0.171, rz: 0.116, zOff: -0.006, v: 0.25 },
    { y: 0.870, rx: 0.180, rz: 0.123, zOff: -0.007, v: 0.42 },
    { y: 0.916, rx: 0.178, rz: 0.125, zOff: -0.006, v: 0.65 },
    { y: 0.962, rx: 0.171, rz: 0.121, zOff: -0.004, v: 0.88 },
    { y: 0.992, rx: 0.166, rz: 0.118, zOff: -0.003, v: 1.05 },
  ];
  const pelvisRings: LoftRing[] = pelvisLevels.map((lv) => ({
    center: new THREE.Vector3(0, lv.y, lv.zOff),
    right: new THREE.Vector3(1, 0, 0),
    forward: new THREE.Vector3(0, 0, 1),
    v: lv.v * 1.1,
    profile: (theta) => {
      const s = Math.sin(theta);
      const c = Math.cos(theta);
      const glute = c < -0.15 ? Math.pow(-c, 1.35) * 0.017 * (lv.y < 0.935 && lv.y > 0.815 ? 1 : 0.28) : 0;
      const gluteCleft = c < -0.82 ? -Math.pow((-c - 0.82) / 0.18, 2) * 0.011 : 0;
      const drape =
        (Math.sin(theta * 6 + lv.y * 28) * 0.62 + Math.cos(theta * 10 - lv.y * 20) * 0.38) * 0.0034;
      return [
        Math.sign(s) * Math.pow(Math.abs(s), 0.90) * lv.rx + drape * s,
        Math.sign(c) * Math.pow(Math.abs(c), 0.92) * lv.rz - glute - gluteCleft + drape * c,
      ];
    },
  }));
  // capStart=false, capEnd=false + UPWARD rings -> 100% solid opaque outward-facing trouser pelvis!
  const pelvisGeo = createLoftedGeometry(pelvisRings, 44, false, false, 1.6);
  applySkinWeights(pelvisGeo, rig, {
    allowedBones: ['Pelvis', 'Thigh_L', 'Thigh_R'],
    sharpness: 2.5,
  });
  trouserParts.push(pelvisGeo);

  // Subtle flush stitched front trouser fly flap (sits cleanly on front pelvis — ZERO floating stick!)
  const flyPts = [
    new THREE.Vector3(0.004, 0.946, 0.120),
    new THREE.Vector3(0.004, 0.900, 0.122),
    new THREE.Vector3(0.003, 0.855, 0.114),
  ];
  const flyPlacket = createSweptStrap(flyPts, 0.014, 0.0032, 12, false, new THREE.Vector3(1, 0, 0));
  applySkinWeights(flyPlacket, rig, { allowedBones: ['Pelvis'], sharpness: 3.1 });
  trouserParts.push(flyPlacket);

  // Tailored rear tactical seat pockets with subtle overhanging stitched flaps
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const seatPocket = createSoftClothPouch({
      width: 0.108,
      height: 0.100,
      depth: 0.011,
      pillow: 0.0032,
      cornerRadius: 0.012,
      curveRadiusX: 0.18,
      wrinkleSeed: side === 'L' ? 61 : 67,
      embedBack: 0.020,
    });
    transformGeo(seatPocket, [0.072 * s, 0.878, -0.129], [0.08, Math.PI - 0.24 * s, 0]);
    const seatFlap = createSoftClothPouch({
      width: 0.112,
      height: 0.032,
      depth: 0.006,
      pillow: 0.0022,
      cornerRadius: 0.008,
      curveRadiusX: 0.18,
      wrinkleSeed: side === 'L' ? 71 : 73,
      embedBack: 0.014,
    });
    transformGeo(seatFlap, [0.073 * s, 0.918, -0.135], [0.05, Math.PI - 0.24 * s, 0]);
    for (const sp of [seatPocket, seatFlap]) {
      applySkinWeights(sp, rig, { allowedBones: ['Pelvis', `Thigh_${side}`], sharpness: 3.0 });
      trouserParts.push(sp);
    }
  }

  // --- C. Tailored Draped Ripstop Cargo Legs + Convex Pockets + Flush Thigh Straps + Ergonomic Knee Pads + Combat Boots ---
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const pHip = rig.bindWorldPos.get(`Thigh_${side}`)!;
    const pKnee = rig.bindWorldPos.get(`Calf_${side}`)!;
    const pAnkle = rig.bindWorldPos.get(`Foot_${side}`)!;

    // 22-level tailored cargo trouser profile in STRICT BOTTOM-TO-TOP order (100% OUTWARD normals + realistic cloth bunching!)
    const legLevels = [
      // Tucks cleanly DEEP INSIDE the double-walled padded boot ankle collar (ZERO shin gap!)
      { y: 0.218, x: pAnkle.x, z: -0.010, rx: 0.052, rz: 0.055, fold: 0.0, crease: 0.0, v: 0.0 },
      { y: 0.248, x: pAnkle.x, z: -0.010, rx: 0.057, rz: 0.060, fold: 0.0014, crease: 0.0, v: 0.05 },
      { y: 0.270, x: pAnkle.x, z: -0.010, rx: 0.073, rz: 0.075, fold: 0.0052, crease: 0.0035, v: 0.09 },
      // Bloused tactical trouser cloth billowing softly with real accordion folds right over the boot ankle collar!
      { y: 0.292, x: pAnkle.x, z: -0.009, rx: 0.082, rz: 0.083, fold: 0.0078, crease: 0.0055, v: 0.14 },
      { y: 0.314, x: pAnkle.x, z: -0.008, rx: 0.076, rz: 0.078, fold: 0.0064, crease: -0.0032, v: 0.19 },
      { y: 0.340, x: pAnkle.x, z: -0.005, rx: 0.080, rz: 0.082, fold: 0.0066, crease: 0.0038, v: 0.24 },
      { y: 0.376, x: pAnkle.x + 0.001 * s, z: -0.002, rx: 0.078, rz: 0.079, fold: 0.0056, crease: -0.0018, v: 0.30 },
      // Fabric gather below lower knee pad strap
      { y: 0.415, x: pKnee.x + 0.002 * s, z: 0.003, rx: 0.083, rz: 0.085, fold: 0.0065, crease: 0.0035, v: 0.36 },
      { y: 0.448, x: pKnee.x + 0.001 * s, z: 0.006, rx: 0.077, rz: 0.079, fold: 0.0050, crease: -0.0025, v: 0.41 },
      { y: 0.484, x: pKnee.x, z: 0.009, rx: 0.080, rz: 0.082, fold: 0.0052, crease: 0.0015, v: 0.46 },
      { y: 0.520, x: pKnee.x, z: 0.010, rx: 0.079, rz: 0.081, fold: 0.0048, crease: -0.0022, v: 0.51 },
      // Rich tactical cloth bunching fold directly above the knee pad (matching 4_a81a6ae0.jpg!)
      { y: 0.556, x: pKnee.x, z: 0.011, rx: 0.090, rz: 0.092, fold: 0.0074, crease: 0.0052, v: 0.57 },
      { y: 0.584, x: pKnee.x + 0.001 * s, z: 0.009, rx: 0.085, rz: 0.087, fold: 0.0058, crease: -0.0034, v: 0.62 },
      { y: 0.620, x: pKnee.x + 0.002 * s, z: 0.008, rx: 0.091, rz: 0.092, fold: 0.0062, crease: 0.0032, v: 0.67 },
      { y: 0.662, x: pHip.x * 1.03, z: 0.007, rx: 0.092, rz: 0.094, fold: 0.0052, crease: -0.0018, v: 0.73 },
      { y: 0.706, x: pHip.x * 1.03, z: 0.005, rx: 0.095, rz: 0.097, fold: 0.0050, crease: 0.0022, v: 0.80 },
      { y: 0.748, x: pHip.x * 1.03, z: 0.004, rx: 0.096, rz: 0.098, fold: 0.0048, crease: -0.0016, v: 0.86 },
      { y: 0.790, x: pHip.x * 1.02, z: 0.002, rx: 0.099, rz: 0.101, fold: 0.0052, crease: 0.0020, v: 0.92 },
      { y: 0.832, x: pHip.x * 1.00, z: 0.000, rx: 0.100, rz: 0.102, fold: 0.0048, crease: 0.0, v: 0.98 },
      { y: 0.880, x: pHip.x * 0.95, z: -0.002, rx: 0.098, rz: 0.101, fold: 0.0040, crease: 0.0, v: 1.05 },
      { y: 0.940, x: pHip.x * 0.86, z: -0.003, rx: 0.094, rz: 0.098, fold: 0.0030, crease: 0.0, v: 1.14 },
    ];

    const evalLegCrossSection = (yQuery: number) => {
      for (let i = 0; i < legLevels.length - 1; i++) {
        const a = legLevels[i];
        const b = legLevels[i + 1];
        if (yQuery >= a.y && yQuery <= b.y) {
          const f = (yQuery - a.y) / Math.max(0.0001, b.y - a.y);
          return {
            x: THREE.MathUtils.lerp(a.x, b.x, f),
            z: THREE.MathUtils.lerp(a.z, b.z, f),
            rx: THREE.MathUtils.lerp(a.rx, b.rx, f),
            rz: THREE.MathUtils.lerp(a.rz, b.rz, f),
            fold: THREE.MathUtils.lerp(a.fold, b.fold, f),
          };
        }
      }
      const edge = yQuery < legLevels[0].y ? legLevels[0] : legLevels[legLevels.length - 1];
      return { x: edge.x, z: edge.z, rx: edge.rx, rz: edge.rz, fold: edge.fold };
    };

    const legRings: LoftRing[] = legLevels.map((lv) => ({
      center: new THREE.Vector3(lv.x, lv.y, lv.z),
      right: new THREE.Vector3(1, 0, 0),
      forward: new THREE.Vector3(0, 0, 1),
      v: lv.v * 2.2,
      profile: (theta) => {
        const sn = Math.sin(theta);
        const cs = Math.cos(theta);
        // Diagonal thigh & knee cloth drapery waves + realistic popliteal creases behind the knee
        const diagWave = Math.sin(theta * 3 + lv.y * 28 * s) * 0.52 + Math.cos(theta * 6 - lv.y * 36) * 0.34;
        const blousePleat =
          lv.y > 0.268 && lv.y < 0.355 ? Math.sin(theta * 7 + lv.y * 46) * 0.0036 : 0;
        const behindKneeCrease =
          cs < -0.25 && lv.y > 0.43 && lv.y < 0.56
            ? Math.sin(lv.y * 115) * 0.0036 * (-cs)
            : 0;
        const frontCrease = cs > 0.15 ? lv.crease * (0.55 + 0.45 * cs) : lv.crease * 0.30;
        const drapery = diagWave * lv.fold + blousePleat + behindKneeCrease + frontCrease;
        // Subtle raised outseam + inseam stitched ridges
        const outSeam = Math.exp(-Math.pow((sn * s - 1) / 0.12, 2)) * 0.0020;
        const inSeam = Math.exp(-Math.pow((sn * s + 1) / 0.12, 2)) * 0.0014;
        return [sn * (lv.rx + drapery + outSeam + inSeam), cs * (lv.rz + drapery)];
      },
    }));
    const legGeo = createLoftedGeometry(legRings, 40, false, false, 1.6);
    applySkinWeights(legGeo, rig, {
      allowedBones: ['Pelvis', `Thigh_${side}`, `Calf_${side}`],
      sharpness: 2.7,
    });
    trouserParts.push(legGeo);

    // Convex-Curved Soft Pillowed Side Thigh Bellows Cargo Pocket (POSITIVE curveRadiusX -> hugs outer thigh!)
    const pocketY = 0.680;
    const thighAtPocket = evalLegCrossSection(pocketY);
    const pocketX = thighAtPocket.x + (thighAtPocket.rx - 0.007) * s;
    const pocketZ = thighAtPocket.z + 0.002;
    const thighPocket = createSoftClothPouch({
      width: 0.122,
      height: 0.158,
      depth: 0.023,
      pillow: 0.0072,
      cornerRadius: 0.015,
      curveRadiusX: 0.125,
      pleats: 2,
      centerCrease: true,
      wrinkleSeed: side === 'L' ? 81 : 89,
      embedBack: 0.016,
    });
    transformGeo(thighPocket, [pocketX, pocketY, pocketZ], [0, Math.PI * 0.5 * s, 0]);
    const thighFlap = createSoftClothPouch({
      width: 0.126,
      height: 0.044,
      depth: 0.0085,
      pillow: 0.0038,
      cornerRadius: 0.012,
      curveRadiusX: 0.130,
      wrinkleSeed: side === 'L' ? 93 : 97,
      embedBack: 0.010,
    });
    transformGeo(thighFlap, [pocketX + 0.020 * s, pocketY + 0.058, pocketZ], [0, Math.PI * 0.5 * s, 0]);
    for (const tp of [thighPocket, thighFlap]) {
      applySkinWeights(tp, rig, { allowedBones: [`Thigh_${side}`], sharpness: 3.2 });
      trouserParts.push(tp);
    }
    for (const dz of [-0.032, 0.032]) {
      const ang = dz / 0.130;
      const sx = pocketX + (0.029 - (0.130 - Math.cos(ang) * 0.130)) * s;
      const stud = createGrommetRing(0.0038, 0.0019);
      transformGeo(stud, [sx, pocketY + 0.048, pocketZ + dz], [0, Math.PI * 0.5 * s - ang * s, 0]);
      applySkinWeights(stud, rig, { allowedBones: [`Thigh_${side}`], sharpness: 3.4 });
      gunmetalParts.push(stud);
    }

    // Dual Flush Diagonal Black Webbing Tactical Drop-Leg Straps on Right Thigh (-X) — ZERO AIR GAPS!
    if (side === 'R') {
      for (let st = 0; st < 2; st++) {
        const baseY = 0.785 - st * 0.060;
        const strapLoop: THREE.Vector3[] = [];
        for (let k = 0; k < 32; k++) {
          const a = (k / 32) * Math.PI * 2;
          const slantY = baseY + Math.cos(a - 0.45) * 0.022;
          const leg = evalLegCrossSection(slantY);
          strapLoop.push(
            new THREE.Vector3(
              leg.x + Math.sin(a) * (leg.rx + 0.0022),
              slantY,
              leg.z + Math.cos(a) * (leg.rz + 0.0022)
            )
          );
        }
        const thighStrap = createSweptStrap(strapLoop, 0.028, 0.0062, 36, true, new THREE.Vector3(0, 1, 0));
        applySkinWeights(thighStrap, rig, { allowedBones: ['Thigh_R'], sharpness: 3.3 });
        webbingParts.push(thighStrap);

        const bAng = -0.68;
        const bY = baseY + Math.cos(bAng - 0.45) * 0.022;
        const bLeg = evalLegCrossSection(bY);
        const clip = createBeveledPanel({
          width: 0.036,
          height: 0.032,
          depth: 0.0085,
          cornerRadius: 0.0045,
          bevel: 0.0018,
          curveRadiusX: 0.11,
        });
        transformGeo(
          clip,
          [
            bLeg.x + Math.sin(bAng) * (bLeg.rx + 0.0032),
            bY,
            bLeg.z + Math.cos(bAng) * (bLeg.rz + 0.0032),
          ],
          [0.14, bAng, -0.14]
        );
        applySkinWeights(clip, rig, { allowedBones: ['Thigh_R'], sharpness: 3.4 });
        gunmetalParts.push(clip);
      }
    }

    // --- D. Sculpted Convex Ergonomic Matte-Black Tactical Knee Pad + Exact-Fit Dual Rear Straps ---
    const kpY = pKnee.y + 0.004;
    const kneeSec = evalLegCrossSection(kpY);
    const kpX = kneeSec.x;
    const kpZ = kneeSec.z + kneeSec.rz + 0.0045;
    const padCurveX = 0.098;
    const padCurveY = 0.44;
    const shellCurveY = 0.28;

    const kpBacking = createBeveledPanel({
      width: 0.136,
      height: 0.152,
      depth: 0.014,
      cornerRadius: 0.030,
      bevel: 0.005,
      curveRadiusX: padCurveX,
      curveRadiusY: padCurveY,
    });
    transformGeo(kpBacking, [kpX, kpY, kpZ]);
    applySkinWeights(kpBacking, rig, {
      allowedBones: [`Thigh_${side}`, `Calf_${side}`],
      sharpness: 3.2,
    });
    webbingParts.push(kpBacking);

    const kpShell = createBeveledPanel({
      width: 0.106,
      height: 0.122,
      depth: 0.017,
      cornerRadius: 0.026,
      bevel: 0.0055,
      curveRadiusX: 0.090,
      curveRadiusY: shellCurveY,
    });
    transformGeo(kpShell, [kpX, kpY, kpZ + 0.010]);
    applySkinWeights(kpShell, rig, {
      allowedBones: [`Thigh_${side}`, `Calf_${side}`],
      sharpness: 3.2,
    });
    armorParts.push(kpShell);

    for (let rb = -1; rb <= 1; rb++) {
      const ribY = rb * 0.027;
      const ribAngY = ribY / shellCurveY;
      const ribZOff = Math.cos(ribAngY) * shellCurveY - shellCurveY;
      const rib = createBeveledPanel({
        width: rb === 0 ? 0.086 : 0.074,
        height: rb === 0 ? 0.018 : 0.013,
        depth: 0.0062,
        cornerRadius: 0.005,
        bevel: 0.002,
        curveRadiusX: 0.090,
      });
      transformGeo(rib, [kpX, kpY + ribY, kpZ + 0.027 + ribZOff], [-ribAngY, 0, 0]);
      applySkinWeights(rib, rig, {
        allowedBones: [`Thigh_${side}`, `Calf_${side}`],
        sharpness: 3.3,
      });
      armorParts.push(rib);
    }

    for (const rx of [-0.036, 0.036]) {
      for (const ry of [-0.043, 0.043]) {
        const angX = rx / 0.090;
        const angY = ry / shellCurveY;
        const rSurface = 0.090 + 0.0225;
        const gx = Math.sin(angX) * rSurface;
        const gz = Math.cos(angX) * rSurface - 0.090 + (Math.cos(angY) * shellCurveY - shellCurveY);
        const rivet = createGrommetRing(0.0040, 0.0018);
        transformGeo(rivet, [kpX + gx, kpY + ry, kpZ + 0.010 + gz], [-angY, angX, 0]);
        applySkinWeights(rivet, rig, {
          allowedBones: [`Thigh_${side}`, `Calf_${side}`],
          sharpness: 3.4,
        });
        gunmetalParts.push(rivet);
      }
    }

    // Dual exact-fit rear elastic knee pad retention straps hugging cleanly over popliteal cloth folds
    for (const dy of [-0.042, 0.042]) {
      const sy = kpY + dy;
      const legS = evalLegCrossSection(sy);
      const kStrapPts: THREE.Vector3[] = [];
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        kStrapPts.push(
          new THREE.Vector3(
            legS.x + Math.sin(a) * (legS.rx + 0.0052),
            sy,
            legS.z + Math.cos(a) * (legS.rz + 0.0056)
          )
        );
      }
      const kStrap = createSweptStrap(kStrapPts, 0.021, 0.0054, 28, true, new THREE.Vector3(0, 1, 0));
      applySkinWeights(kStrap, rig, {
        allowedBones: [`Thigh_${side}`, `Calf_${side}`],
        sharpness: 3.1,
      });
      webbingParts.push(kStrap);
    }

    // --- E. PHOTOREALISTIC CONTINUOUS ANATOMICAL PEBBLED-LEATHER COMBAT BOOTS (FLUSH AT Y = 0.000!) ---
    // OUTER wall runs STRICTLY BOTTOM-TO-TOP -> OVER rounded padded collar -> DOWNWARD inner collar lining!
    // Aligned rear Achilles-to-heel profile (z - rz flows smoothly from -0.086 at collar -> -0.088 at heel base: ZERO rear bubble!)
    const bx = pAnkle.x;

    const shaftLevels = [
      // Outer boot shaft moving UPWARD from sole welt to top padded ankle collar (OUTWARD NORMALS!)
      { y: 0.040, z: 0.010, rx: 0.056, rz: 0.098, dip: 0.0, crease: 0.0, v: 0.0 },
      { y: 0.072, z: 0.006, rx: 0.057, rz: 0.093, dip: 0.0, crease: 0.0005, v: 0.12 },
      { y: 0.108, z: -0.002, rx: 0.059, rz: 0.083, dip: 0.0, crease: 0.0014, v: 0.26 },
      { y: 0.146, z: -0.009, rx: 0.061, rz: 0.074, dip: 0.0, crease: 0.0022, v: 0.40 },
      { y: 0.185, z: -0.012, rx: 0.064, rz: 0.071, dip: 0.002, crease: 0.0020, v: 0.56 },
      { y: 0.225, z: -0.012, rx: 0.068, rz: 0.073, dip: 0.005, crease: 0.0014, v: 0.72 },
      { y: 0.258, z: -0.011, rx: 0.072, rz: 0.076, dip: 0.008, crease: 0.0008, v: 0.85 },
      // Plush 11mm rounded padded top ankle collar lip (dipped naturally at rear Achilles tendon!)
      { y: 0.270, z: -0.011, rx: 0.070, rz: 0.075, dip: 0.010, crease: 0.0, v: 0.92 },
      { y: 0.268, z: -0.011, rx: 0.062, rz: 0.067, dip: 0.010, crease: 0.0, v: 1.00 },
      // Inner padded collar wall moving DOWNWARD hugging bloused trouser hem cleanly!
      { y: 0.252, z: -0.011, rx: 0.058, rz: 0.062, dip: 0.006, crease: 0.0, v: 1.08 },
      { y: 0.224, z: -0.011, rx: 0.055, rz: 0.059, dip: 0.0, crease: 0.0, v: 1.18 },
    ];
    const shaftRings: LoftRing[] = shaftLevels.map((lv) => ({
      center: new THREE.Vector3(bx, lv.y, lv.z),
      right: new THREE.Vector3(1, 0, 0),
      forward: new THREE.Vector3(0, 0, 1),
      v: lv.v * 1.4,
      profile: (theta) => {
        const sn = Math.sin(theta);
        const cs = Math.cos(theta);
        const throatDip =
          cs > 0.78 && lv.y > 0.125 && lv.v < 0.88
            ? -0.0045 * Math.pow((cs - 0.78) / 0.22, 1.3)
            : 0;
        const flexCrease = Math.sin(lv.y * 84 + cs * 2.6) * lv.crease;
        // Integral molded leather heel counter reinforcement hugging the lower rear boot seamlessly (ZERO floating plate!)
        const heelEnvY = lv.y < 0.110 ? Math.sin(Math.min(1, Math.max(0, (lv.y - 0.036) / 0.074)) * Math.PI) : 0;
        const heelWrap = cs < -0.18 ? Math.pow((-cs - 0.18) / 0.82, 0.7) * heelEnvY * 0.0028 : 0;
        return [sn * (lv.rx + flexCrease + heelWrap * 0.6), cs * (lv.rz + flexCrease + heelWrap) + throatDip];
      },
      yOffset: (theta) => {
        const cs = Math.cos(theta);
        return cs < -0.2 ? -lv.dip * Math.pow(-cs, 1.2) : 0;
      },
    }));
    const shaftGeo = createLoftedGeometry(shaftRings, 40, false, false, 1.5);
    applySkinWeights(shaftGeo, rig, {
      allowedBones: [`Calf_${side}`, `Foot_${side}`],
      sharpness: 3.1,
    });
    leatherParts.push(shaftGeo);

    // 2. Seamless Continuous Anatomical Boot Vamp & Full Rounded Military Toe Dome (flows out of shaft — ZERO rear bulb!)
    const footZStops = [
      // Rear starts flush inside lower shaft (-0.078) so ZERO lump pokes out behind heel!
      { z: -0.078, yBot: 0.038, yTop: 0.088, halfW: 0.044, xOff: 0.0, v: 0.0 },
      { z: -0.048, yBot: 0.036, yTop: 0.104, halfW: 0.052, xOff: 0.0, v: 0.14 },
      { z: -0.005, yBot: 0.036, yTop: 0.122, halfW: 0.055, xOff: 0.0, v: 0.30 },
      { z: 0.036, yBot: 0.036, yTop: 0.124, halfW: 0.057, xOff: -0.001 * s, v: 0.44 },
      { z: 0.074, yBot: 0.036, yTop: 0.108, halfW: 0.059, xOff: -0.002 * s, v: 0.58 },
      { z: 0.112, yBot: 0.036, yTop: 0.094, halfW: 0.060, xOff: -0.003 * s, v: 0.72 },
      { z: 0.146, yBot: 0.036, yTop: 0.086, halfW: 0.058, xOff: -0.0035 * s, v: 0.84 },
      { z: 0.174, yBot: 0.038, yTop: 0.079, halfW: 0.053, xOff: -0.004 * s, v: 0.94 },
      { z: 0.196, yBot: 0.041, yTop: 0.070, halfW: 0.042, xOff: -0.0045 * s, v: 1.02 },
      { z: 0.210, yBot: 0.044, yTop: 0.060, halfW: 0.026, xOff: -0.0045 * s, v: 1.07 },
      { z: 0.217, yBot: 0.047, yTop: 0.052, halfW: 0.010, xOff: -0.0045 * s, v: 1.11 },
    ];
    const footRings: LoftRing[] = footZStops.map((fs) => {
      const yMid = (fs.yBot + fs.yTop) * 0.5;
      const yRad = (fs.yTop - fs.yBot) * 0.5;
      return {
        center: new THREE.Vector3(bx + fs.xOff, yMid, fs.z),
        right: new THREE.Vector3(1, 0, 0),
        forward: new THREE.Vector3(0, 1, 0),
        v: fs.v * 1.4,
        profile: (theta) => {
          const c = Math.cos(theta);
          const sn = Math.sin(theta);
          // Organic rounded full-volume military toe box (NOT flat octagonal!)
          const xVal = Math.sign(c) * Math.pow(Math.abs(c), 0.84) * fs.halfW;
          const yVal =
            sn < 0
              ? Math.sign(sn) * Math.pow(Math.abs(sn), 0.48) * yRad
              : Math.pow(sn, 0.82) * yRad;
          return [xVal, yVal];
        },
      };
    });
    const footGeo = createLoftedGeometry(footRings, 40, true, true, 1.5);
    applySkinWeights(footGeo, rig, {
      allowedBones: [`Foot_${side}`, `Toe_${side}`],
      sharpness: 3.2,
    });
    leatherParts.push(footGeo);

    // 3. Proud Reinforced Leather Toe Cap Overlay (+2.2mm smooth contoured tactical toe shield + subtle stitched edge!)
    const toeCapStops = [
      { z: 0.140, yBot: 0.037, yTop: 0.088, halfW: 0.0598, xOff: -0.0035 * s, v: 0.0 },
      { z: 0.160, yBot: 0.038, yTop: 0.085, halfW: 0.0578, xOff: -0.004 * s, v: 0.30 },
      { z: 0.184, yBot: 0.040, yTop: 0.077, halfW: 0.0502, xOff: -0.0042 * s, v: 0.65 },
      { z: 0.203, yBot: 0.043, yTop: 0.067, halfW: 0.0365, xOff: -0.0045 * s, v: 0.88 },
      { z: 0.215, yBot: 0.046, yTop: 0.057, halfW: 0.0190, xOff: -0.0045 * s, v: 0.98 },
      { z: 0.219, yBot: 0.048, yTop: 0.051, halfW: 0.0080, xOff: -0.0045 * s, v: 1.04 },
    ];
    const toeCapRings: LoftRing[] = toeCapStops.map((fs) => {
      const yMid = (fs.yBot + fs.yTop) * 0.5;
      const yRad = (fs.yTop - fs.yBot) * 0.5;
      return {
        center: new THREE.Vector3(bx + fs.xOff, yMid, fs.z),
        right: new THREE.Vector3(1, 0, 0),
        forward: new THREE.Vector3(0, 1, 0),
        v: fs.v * 0.6,
        profile: (theta) => {
          const c = Math.cos(theta);
          const sn = Math.sin(theta);
          return [
            Math.sign(c) * Math.pow(Math.abs(c), 0.84) * fs.halfW,
            sn < 0 ? Math.sign(sn) * Math.pow(Math.abs(sn), 0.48) * yRad : Math.pow(sn, 0.82) * yRad,
          ];
        },
      };
    });
    const toeCapGeo = createLoftedGeometry(toeCapRings, 36, false, true, 0.7);
    applySkinWeights(toeCapGeo, rig, { allowedBones: [`Foot_${side}`, `Toe_${side}`], sharpness: 3.3 });
    leatherParts.push(toeCapGeo);

    // 4. Stitched rear webbing pull-tab loop seated cleanly behind the top boot collar
    const pullLoopPts = [
      new THREE.Vector3(bx, 0.244, -0.084),
      new THREE.Vector3(bx, 0.260, -0.094),
      new THREE.Vector3(bx, 0.270, -0.086),
      new THREE.Vector3(bx, 0.256, -0.077),
    ];
    const pullLoop = createSweptStrap(pullLoopPts, 0.015, 0.004, 14, false, new THREE.Vector3(1, 0, 0));
    applySkinWeights(pullLoop, rig, { allowedBones: [`Calf_${side}`, `Foot_${side}`], sharpness: 3.2 });
    webbingParts.push(pullLoop);

    // 5. Padded Gusseted Tongue + Flanking Raised Leather Eyestay Lace Strips
    const tonguePts = [
      new THREE.Vector3(bx, 0.096, 0.104),
      new THREE.Vector3(bx, 0.132, 0.078),
      new THREE.Vector3(bx, 0.178, 0.062),
      new THREE.Vector3(bx, 0.226, 0.060),
      new THREE.Vector3(bx, 0.266, 0.063),
    ];
    const tongueCurve = new THREE.CatmullRomCurve3(tonguePts);
    const tongueGeo = createSweptStrap(tonguePts, 0.044, 0.009, 20, false, new THREE.Vector3(1, 0, 0));
    applySkinWeights(tongueGeo, rig, {
      allowedBones: [`Calf_${side}`, `Foot_${side}`],
      sharpness: 3.2,
    });
    leatherParts.push(tongueGeo);

    for (const eSign of [-1, 1] as const) {
      const stayPts = [
        new THREE.Vector3(bx + eSign * 0.029, 0.100, 0.096),
        new THREE.Vector3(bx + eSign * 0.028, 0.136, 0.074),
        new THREE.Vector3(bx + eSign * 0.027, 0.180, 0.059),
        new THREE.Vector3(bx + eSign * 0.026, 0.226, 0.058),
        new THREE.Vector3(bx + eSign * 0.026, 0.260, 0.061),
      ];
      const stayGeo = createSweptStrap(stayPts, 0.017, 0.005, 18, false, new THREE.Vector3(1, 0, 0));
      applySkinWeights(stayGeo, rig, {
        allowedBones: [`Calf_${side}`, `Foot_${side}`],
        sharpness: 3.2,
      });
      leatherParts.push(stayGeo);
    }

    // 6. 7 Pairs of Crisp Silver Speed-Lace Eyelets Seated EXACTLY on the Eyestay Panels + 3D Braided Laces!
    const eyeletPosL: THREE.Vector3[] = [];
    const eyeletPosR: THREE.Vector3[] = [];
    const eyeletCount = 7;
    for (let e = 0; e < eyeletCount; e++) {
      const t = 0.07 + (e / (eyeletCount - 1)) * 0.85;
      const tPt = tongueCurve.getPointAt(t);
      const exSpread = THREE.MathUtils.lerp(0.028, 0.025, e / (eyeletCount - 1));
      const ez = tPt.z + 0.0018;

      const pL = new THREE.Vector3(bx + exSpread, tPt.y, ez);
      const pR = new THREE.Vector3(bx - exSpread, tPt.y, ez);
      eyeletPosL.push(pL);
      eyeletPosR.push(pR);

      for (const [pt, sign] of [
        [pL, 1],
        [pR, -1],
      ] as const) {
        const eyelet = createGrommetRing(0.0044, 0.0018);
        transformGeo(eyelet, [pt.x, pt.y, pt.z], [0, 0.36 * sign, 0]);
        applySkinWeights(eyelet, rig, {
          allowedBones: [`Calf_${side}`, `Foot_${side}`],
          sharpness: 3.4,
        });
        silverParts.push(eyelet);
      }
    }

    const barLace = createTubeCurve(
      [
        eyeletPosL[0],
        new THREE.Vector3(bx, eyeletPosL[0].y, eyeletPosL[0].z + 0.0055),
        eyeletPosR[0],
      ],
      0.0026,
      10,
      6,
      false
    );
    applySkinWeights(barLace, rig, { allowedBones: [`Foot_${side}`], sharpness: 3.3 });
    webbingParts.push(barLace);

    for (let e = 0; e < eyeletCount - 1; e++) {
      const tMid = 0.07 + ((e + 0.5) / (eyeletCount - 1)) * 0.85;
      const tongueMid = tongueCurve.getPointAt(tMid);
      const crossA = createTubeCurve(
        [
          eyeletPosL[e],
          new THREE.Vector3(bx, tongueMid.y, tongueMid.z + 0.0068),
          eyeletPosR[e + 1],
        ],
        0.0025,
        12,
        6,
        false
      );
      const crossB = createTubeCurve(
        [
          eyeletPosR[e],
          new THREE.Vector3(bx, tongueMid.y, tongueMid.z + 0.0042),
          eyeletPosL[e + 1],
        ],
        0.0025,
        12,
        6,
        false
      );
      for (const lc of [crossA, crossB]) {
        applySkinWeights(lc, rig, {
          allowedBones: [`Calf_${side}`, `Foot_${side}`],
          sharpness: 3.3,
        });
        webbingParts.push(lc);
      }
    }

    const topL = eyeletPosL[eyeletCount - 1];
    const knotPos = new THREE.Vector3(bx, topL.y + 0.002, topL.z + 0.0055);
    const knotBead = new THREE.SphereGeometry(0.0055, 10, 8);
    knotBead.scale(1.3, 0.85, 0.85);
    knotBead.translate(knotPos.x, knotPos.y, knotPos.z);
    applySkinWeights(knotBead, rig, { allowedBones: [`Calf_${side}`], sharpness: 3.4 });
    webbingParts.push(knotBead);

    for (const lSign of [-1, 1] as const) {
      const bowPts = [
        knotPos.clone(),
        knotPos.clone().add(new THREE.Vector3(lSign * 0.018, 0.006, 0.003)),
        knotPos.clone().add(new THREE.Vector3(lSign * 0.022, -0.008, 0.001)),
        knotPos.clone().add(new THREE.Vector3(lSign * 0.004, -0.004, 0.001)),
      ];
      const bowLoop = createTubeCurve(bowPts, 0.0022, 12, 6, false);
      applySkinWeights(bowLoop, rig, { allowedBones: [`Calf_${side}`], sharpness: 3.4 });
      webbingParts.push(bowLoop);
    }

    // 7. Smooth High-Res Rounded Vibram Outsole + Goodyear Storm Welt + Arched Midsole + Heel Block + Deep Lugs (Y = 0.000!)
    const soleShape = new THREE.Shape();
    const xBig = -0.0045 * s;
    soleShape.moveTo(0, -0.095);
    soleShape.bezierCurveTo(0.036, -0.095, 0.056, -0.072, 0.056, -0.030);
    soleShape.bezierCurveTo(0.056, 0.015, 0.052 - 0.004 * s, 0.056, 0.062 + xBig * 0.4, 0.112);
    soleShape.bezierCurveTo(0.066 + xBig * 0.6, 0.168, 0.048 + xBig, 0.218, xBig, 0.224);
    soleShape.bezierCurveTo(-0.048 + xBig, 0.218, -0.066 + xBig * 0.6, 0.168, -0.062 + xBig * 0.4, 0.112);
    soleShape.bezierCurveTo(-0.052 + 0.004 * s, 0.056, -0.056, 0.015, -0.056, -0.030);
    soleShape.bezierCurveTo(-0.056, -0.072, -0.036, -0.095, 0, -0.095);
    soleShape.closePath();

    const midsole = new THREE.ExtrudeGeometry(soleShape, {
      depth: 0.020,
      curveSegments: 36,
      bevelEnabled: true,
      bevelThickness: 0.0045,
      bevelSize: 0.0038,
      bevelSegments: 4,
    });
    midsole.rotateX(Math.PI / 2);
    midsole.translate(bx, 0.038, 0);
    const msPos = midsole.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < msPos.count; i++) {
      const py = msPos.getY(i);
      const pz = msPos.getZ(i);
      if (py < 0.026 && pz > -0.015 && pz < 0.058) {
        const archT = Math.sin(((pz + 0.015) / 0.073) * Math.PI);
        msPos.setY(i, py + archT * 0.0075);
      }
      if (pz > 0.185) {
        const toeLift = Math.pow((pz - 0.185) / 0.045, 1.8) * 0.0065;
        msPos.setY(i, msPos.getY(i) + toeLift);
      }
    }
    midsole.computeVertexNormals();
    applySkinWeights(midsole, rig, {
      allowedBones: [`Foot_${side}`, `Toe_${side}`],
      sharpness: 3.3,
    });
    rubberParts.push(midsole);

    // 3D Goodyear Storm Welt Collar sealing the upper leather vamp cleanly onto the Vibram rubber midsole!
    const welt2D = soleShape.getSpacedPoints(48);
    const weltPts = welt2D.slice(0, -1).map((p) => {
      const toeLift = p.y > 0.180 ? Math.pow((p.y - 0.180) / 0.048, 1.8) * 0.0065 : 0;
      return new THREE.Vector3(bx + p.x * 0.965, 0.0415 + toeLift, p.y * 0.975);
    });
    const stormWelt = createTubeCurve(weltPts, 0.0042, 56, 8, true);
    applySkinWeights(stormWelt, rig, {
      allowedBones: [`Foot_${side}`, `Toe_${side}`],
      sharpness: 3.3,
    });
    leatherParts.push(stormWelt);

    const heelBlock = createBeveledPanel({
      width: 0.094,
      height: 0.012,
      depth: 0.070,
      cornerRadius: 0.012,
      bevel: 0.002,
    });
    transformGeo(heelBlock, [bx, 0.016, -0.090]);
    applySkinWeights(heelBlock, rig, { allowedBones: [`Foot_${side}`], sharpness: 3.4 });
    rubberParts.push(heelBlock);

    const lugRows = [
      { z: -0.078, w: 0.080, d: 0.022, h: 0.011 },
      { z: -0.046, w: 0.090, d: 0.022, h: 0.011 },
      { z: 0.062, w: 0.096, d: 0.018, h: 0.013 },
      { z: 0.096, w: 0.106, d: 0.020, h: 0.013 },
      { z: 0.130, w: 0.106, d: 0.020, h: 0.013 },
      { z: 0.164, w: 0.092, d: 0.020, h: 0.012 },
      { z: 0.194, w: 0.062, d: 0.016, h: 0.010 },
    ];
    for (const lr of lugRows) {
      for (const lxSign of [-1, 1] as const) {
        const halfLugW = lr.w * 0.40;
        const lugBevel = 0.0014;
        const lug = createBeveledPanel({
          width: halfLugW,
          height: lr.h,
          depth: lr.d,
          cornerRadius: 0.003,
          bevel: lugBevel,
        });
        const lugCenterY = lr.h * 0.5 + (lr.z > 0.185 ? 0.003 : 0.0005);
        transformGeo(
          lug,
          [bx + xBig * (lr.z > 0.10 ? 0.7 : 0.0) + lxSign * (lr.w * 0.25), lugCenterY, lr.z - lr.d * 0.5],
          [0, lxSign * (lr.z > 0.05 ? 0.14 : -0.08), 0]
        );
        applySkinWeights(lug, rig, {
          allowedBones: [`Foot_${side}`, `Toe_${side}`],
          sharpness: 3.4,
        });
        rubberParts.push(lug);
      }
    }
  }

  return {
    trouserParts,
    webbingParts,
    armorParts,
    gunmetalParts,
    silverParts,
    leatherParts,
    rubberParts,
  };
}

export interface OutfitSculptResult {
  meshes: THREE.SkinnedMesh[];
}

export function buildOutfitAssembly(
  rig: CharacterRig,
  materials: PBRMaterialLibrary
): OutfitSculptResult {
  const turtleneckGeo = buildTurtleneck(rig);
  const upper = buildUpperOutfit(rig);
  const hands = buildForearmsGlovesAndHands(rig);
  const lower = buildLowerOutfitAndBoots(rig);

  const meshes: THREE.SkinnedMesh[] = [];

  const addMerged = (name: string, parts: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (parts.length === 0) return;
    const merged = mergeNormalizedGeometries(parts);
    for (const p of parts) p.dispose();
    meshes.push(createBoundSkinnedMesh(name, merged, mat, rig));
  };

  meshes.push(
    createBoundSkinnedMesh('Turtleneck_Ribbed_Mesh', turtleneckGeo, materials.turtleneck, rig)
  );
  addMerged('Jacket_Olive_Cordura_Mesh', upper.corduraParts, materials.oliveCordura);
  addMerged('Jacket_Forest_Webbing_Panels_Mesh', upper.forestWebbingParts, materials.forestWebbing);
  addMerged('Trousers_Olive_Cargo_Mesh', lower.trouserParts, materials.oliveTrousers);
  addMerged(
    'Honeycomb_Shoulders_Armor_Mesh',
    [...upper.honeycombParts, ...lower.armorParts],
    materials.honeycombRubber
  );
  addMerged('Velcro_Bicep_Patch_Mesh', upper.velcroParts, materials.velcroPatch);
  addMerged(
    'Webbing_Belt_Straps_Laces_Mesh',
    [...upper.webbingParts, ...lower.webbingParts],
    materials.blackWebbing
  );
  addMerged(
    'Gunmetal_Grommets_Zipper_Buckle_Mesh',
    [...upper.gunmetalParts, ...lower.gunmetalParts],
    materials.gunmetal
  );
  addMerged(
    'Silver_Boot_SpeedLaces_Mesh',
    [...upper.upperSilverParts, ...lower.silverParts],
    materials.silverHardware
  );
  addMerged('Stitch_Piping_Trim_Mesh', upper.stitchParts, materials.stitchTrim);
  addMerged('Forearms_Hands_Fingers_Skin_Mesh', hands.skinParts, materials.skinLimbs);
  addMerged('Combat_Gloves_Fingerless_Mesh', hands.gloveParts, materials.gloveFabric);
  addMerged('Combat_Gloves_Palm_Plates_Mesh', hands.glovePlateParts, materials.glovePalmArmor);
  addMerged('Keratin_Fingernails_Mesh', hands.nailParts, materials.fingernails);
  addMerged('Combat_Boots_Leather_Mesh', lower.leatherParts, materials.bootLeather);
  addMerged('Combat_Boots_Vibram_Soles_Mesh', lower.rubberParts, materials.bootRubber);

  return { meshes };
}
