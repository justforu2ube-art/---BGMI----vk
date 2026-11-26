import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface LoftRing {
  /** Ring center in world space */
  center: THREE.Vector3;
  /** Ring local X axis (width) */
  right: THREE.Vector3;
  /** Ring local Z axis (depth/front) */
  forward: THREE.Vector3;
  /** Function returning [xOffset, zOffset] along right/forward for angle theta in [0, 2PI] */
  profile: (theta: number) => [number, number];
  /** Optional vertical ripple offset along ring normal */
  yOffset?: (theta: number) => number;
  /** V texture coordinate */
  v: number;
}

/**
 * Builds a smooth, clean manifold lofted BufferGeometry from anatomical cross-section rings.
 * Replaces toy primitives with sculpted anatomical limbs, torso, fingers, trousers, and boots.
 */
export function createLoftedGeometry(
  rings: LoftRing[],
  radialSegments = 24,
  capStart = true,
  capEnd = true,
  uRepeat = 1
): THREE.BufferGeometry {
  const ringCount = rings.length;
  const stride = radialSegments + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r < ringCount; r++) {
    const ring = rings[r];
    // Ring axis perpendicular to right & forward
    const axis = new THREE.Vector3().crossVectors(ring.forward, ring.right).normalize();
    for (let s = 0; s <= radialSegments; s++) {
      const uFrac = s / radialSegments;
      const theta = uFrac * Math.PI * 2;
      const [rx, rz] = ring.profile(theta);
      const dy = ring.yOffset ? ring.yOffset(theta) : 0;

      const x = ring.center.x + ring.right.x * rx + ring.forward.x * rz + axis.x * dy;
      const y = ring.center.y + ring.right.y * rx + ring.forward.y * rz + axis.y * dy;
      const z = ring.center.z + ring.right.z * rx + ring.forward.z * rz + axis.z * dy;

      positions.push(x, y, z);
      uvs.push(uFrac * uRepeat, ring.v);
    }
  }

  for (let r = 0; r < ringCount - 1; r++) {
    for (let s = 0; s < radialSegments; s++) {
      const a = r * stride + s;
      const b = (r + 1) * stride + s;
      const c = (r + 1) * stride + s + 1;
      const d = r * stride + s + 1;
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  if (capStart) {
    const startCenterIdx = positions.length / 3;
    const r0 = rings[0];
    positions.push(r0.center.x, r0.center.y, r0.center.z);
    uvs.push(0.5, r0.v);
    for (let s = 0; s < radialSegments; s++) {
      indices.push(startCenterIdx, s, s + 1);
    }
  }

  if (capEnd) {
    const endCenterIdx = positions.length / 3;
    const rLast = rings[ringCount - 1];
    const base = (ringCount - 1) * stride;
    positions.push(rLast.center.x, rLast.center.y, rLast.center.z);
    uvs.push(0.5, rLast.v);
    for (let s = 0; s < radialSegments; s++) {
      indices.push(endCenterIdx, base + s + 1, base + s);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a beveled 3D rounded-rectangle pocket, patch, or armor plate using ExtrudeGeometry,
 * optionally curved cylindrically around Y or X so it hugs torso/thighs/shoulders seamlessly.
 */
export function createBeveledPanel(opts: {
  width: number;
  height: number;
  depth: number;
  cornerRadius?: number;
  bevel?: number;
  curveRadiusX?: number;
  curveRadiusY?: number;
  subdivX?: number;
  pleats?: number;
}): THREE.BufferGeometry {
  const {
    width,
    height,
    depth,
    cornerRadius = Math.min(width, height) * 0.14,
    bevel = Math.min(width, height, depth) * 0.18,
    curveRadiusX = 0,
    curveRadiusY = 0,
    pleats = 0,
  } = opts;

  const w = width * 0.5;
  const h = height * 0.5;
  const r = Math.min(cornerRadius, w * 0.9, h * 0.9);

  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0.0005,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 8,
    steps: 2,
  });

  // Center Z on back face = 0, front face = depth
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // Optional bellows pocket vertical pleats on front face
    if (pleats > 0 && z > depth * 0.4) {
      const t = (x / Math.max(w, 0.001)) * Math.PI * pleats;
      z += Math.cos(t) * depth * 0.12;
    }

    // Wrap around horizontal cylinder (torso / thigh / sleeve)
    if (Math.abs(curveRadiusX) > 0.001) {
      const angle = x / curveRadiusX;
      const rad = curveRadiusX + z;
      x = Math.sin(angle) * rad;
      z = Math.cos(angle) * rad - curveRadiusX;
    }

    // Wrap vertically (shoulder yoke / knee cap)
    if (Math.abs(curveRadiusY) > 0.001) {
      const angle = y / curveRadiusY;
      const rad = curveRadiusY + z;
      y = Math.sin(angle) * rad;
      z = Math.cos(angle) * rad - curveRadiusY;
    }

    pos.setXYZ(i, x, y, z);
  }

  // Normalize UVs to [0, 1] scaled reasonably for PBR tiling
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) + w) * 3.5, (uv.getY(i) + h) * 3.5);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates a smooth 3D tube along a CatmullRomCurve3 (used for laces, stitch piping, straps, hair locks).
 */
export function createTubeCurve(
  points: THREE.Vector3[],
  radius: number,
  tubularSegments = 20,
  radialSegments = 8,
  closed = false,
  taperEnds = false
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
  const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, closed);

  if (taperEnds) {
    const pos = geo.attributes.position;
    const stride = radialSegments + 1;
    for (let i = 0; i <= tubularSegments; i++) {
      const t = i / tubularSegments;
      const center = curve.getPointAt(t);
      // Taper smoothly at start and sharply at tip
      const scale = Math.sin(Math.min(1, t * 4) * Math.PI * 0.5) * Math.pow(1 - t * 0.88, 0.7);
      for (let j = 0; j <= radialSegments; j++) {
        const idx = i * stride + j;
        if (idx >= pos.count) continue;
        const vx = center.x + (pos.getX(idx) - center.x) * scale;
        const vy = center.y + (pos.getY(idx) - center.y) * scale;
        const vz = center.z + (pos.getZ(idx) - center.z) * scale;
        pos.setXYZ(idx, vx, vy, vz);
      }
    }
    geo.computeVertexNormals();
  }

  return geo;
}

/**
 * Creates a flat beveled ribbon strap swept along a 3D closed or open path
 * (tactical belt, thigh webbing straps, knee-pad straps, chest webbing bands).
 */
export function createSweptStrap(
  points: THREE.Vector3[],
  width: number,
  thickness: number,
  tubularSegments = 36,
  closed = false,
  upHint = new THREE.Vector3(0, 1, 0)
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
  const frames = curve.computeFrenetFrames(tubularSegments, closed);
  const rings: LoftRing[] = [];
  const hw = width * 0.5;
  const ht = thickness * 0.5;

  const sampleCount = closed ? tubularSegments + 1 : tubularSegments + 1;
  for (let i = 0; i < sampleCount; i++) {
    const t = i / tubularSegments;
    const center = curve.getPointAt(closed ? t % 1 : t);
    const tangent = frames.tangents[Math.min(i, frames.tangents.length - 1)].clone().normalize();
    // Keep strap width aligned cleanly with upHint
    const side = new THREE.Vector3().crossVectors(tangent, upHint);
    if (side.lengthSq() < 1e-5) side.set(1, 0, 0);
    side.normalize();
    const orthoUp = new THREE.Vector3().crossVectors(side, tangent).normalize();

    rings.push({
      center,
      right: orthoUp,
      forward: side,
      v: t * 4.0,
      profile: (theta) => {
        // Superellipse rectangular strap profile with softly beveled edges
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const rx = Math.sign(c) * Math.pow(Math.abs(c), 0.35) * hw;
        const rz = Math.sign(s) * Math.pow(Math.abs(s), 0.35) * ht;
        return [rx, rz];
      },
    });
  }

  return createLoftedGeometry(rings, 12, !closed, !closed, 1);
}

/**
 * Creates a 3D circular grommet eyelet ring (torus with sculpted bevel flange).
 */
export function createGrommetRing(outerRadius: number, tubeRadius: number): THREE.BufferGeometry {
  const geo = new THREE.TorusGeometry(outerRadius, tubeRadius, 10, 18);
  return geo;
}

/**
 * Safely normalizes attributes (position, normal, uv, uv2) and merges multiple geometries,
 * preserving skinIndex/skinWeight if already applied or omitting them cleanly.
 */
export function mergeNormalizedGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized: THREE.BufferGeometry[] = [];
  const hasSkin = geometries.every(
    (g) => Boolean(g.attributes.skinIndex) && Boolean(g.attributes.skinWeight)
  );

  for (const raw of geometries) {
    const g = raw.index ? raw.toNonIndexed() : raw.clone();
    if (!g.attributes.normal) {
      g.computeVertexNormals();
    }
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }

    // Keep consistent attribute set so mergeGeometries never fails
    const keep = new Set(['position', 'normal', 'uv']);
    if (hasSkin) {
      keep.add('skinIndex');
      keep.add('skinWeight');
    }
    for (const key of Object.keys(g.attributes)) {
      if (!keep.has(key)) {
        g.deleteAttribute(key);
      }
    }
    normalized.push(g);
  }

  const merged = BufferGeometryUtils.mergeGeometries(normalized, false);
  if (!merged) {
    throw new Error('Failed to merge normalized geometries');
  }
  for (const g of normalized) g.dispose();
  return merged;
}
