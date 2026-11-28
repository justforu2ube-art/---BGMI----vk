import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface RingDef {
  y: number;
  rx: number;
  rz: number;
  zOffset?: number;
  xOffset?: number;
  shapeFn?: (angle: number, rx: number, rz: number) => [number, number];
}

export function createLoftedTube(
  rings: RingDef[],
  radialSegments = 24,
  capBottom = false,
  capTop = false
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringCount = rings.length;
  const cols = radialSegments + 1;

  for (let r = 0; r < ringCount; r++) {
    const ring = rings[r];
    const v = r / Math.max(1, ringCount - 1);
    const cx = ring.xOffset ?? 0;
    const cz = ring.zOffset ?? 0;
    for (let s = 0; s <= radialSegments; s++) {
      const u = s / radialSegments;
      const angle = u * Math.PI * 2;
      let px: number;
      let pz: number;
      if (ring.shapeFn) {
        [px, pz] = ring.shapeFn(angle, ring.rx, ring.rz);
      } else {
        px = Math.sin(angle) * ring.rx;
        pz = Math.cos(angle) * ring.rz;
      }
      positions.push(cx + px, ring.y, cz + pz);
      uvs.push(u, v);
    }
  }

  for (let r = 0; r < ringCount - 1; r++) {
    for (let s = 0; s < radialSegments; s++) {
      const a = r * cols + s;
      const b = r * cols + s + 1;
      const c = (r + 1) * cols + s;
      const d = (r + 1) * cols + s + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  if (capBottom && ringCount > 0) {
    const first = rings[0];
    const centerIdx = positions.length / 3;
    positions.push(first.xOffset ?? 0, first.y, first.zOffset ?? 0);
    uvs.push(0.5, 0);
    for (let s = 0; s < radialSegments; s++) {
      indices.push(centerIdx, s + 1, s);
    }
  }

  if (capTop && ringCount > 0) {
    const last = rings[ringCount - 1];
    const centerIdx = positions.length / 3;
    const base = (ringCount - 1) * cols;
    positions.push(last.xOffset ?? 0, last.y, last.zOffset ?? 0);
    uvs.push(0.5, 1);
    for (let s = 0; s < radialSegments; s++) {
      indices.push(centerIdx, base + s, base + s + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export interface LimbRing {
  center: THREE.Vector3;
  rx: number;
  ry: number;
  axis?: THREE.Vector3;
  shapeFn?: (angle: number, rx: number, ry: number) => [number, number];
}

export function createLoftedLimb(
  rings: LimbRing[],
  radialSegments = 22,
  capStart = false,
  capEnd = false
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringCount = rings.length;
  const cols = radialSegments + 1;

  for (let r = 0; r < ringCount; r++) {
    const ring = rings[r];
    const v = r / Math.max(1, ringCount - 1);
    const tangent = new THREE.Vector3();
    if (ring.axis) {
      tangent.copy(ring.axis).normalize();
    } else if (r === 0) {
      tangent.subVectors(rings[1].center, ring.center).normalize();
    } else if (r === ringCount - 1) {
      tangent.subVectors(ring.center, rings[r - 1].center).normalize();
    } else {
      tangent.subVectors(rings[r + 1].center, rings[r - 1].center).normalize();
    }

    const refUp = Math.abs(tangent.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const binormal = new THREE.Vector3().crossVectors(refUp, tangent).normalize();
    const normal = new THREE.Vector3().crossVectors(tangent, binormal).normalize();

    for (let s = 0; s <= radialSegments; s++) {
      const u = s / radialSegments;
      const ang = u * Math.PI * 2;
      let a: number;
      let b: number;
      if (ring.shapeFn) {
        [a, b] = ring.shapeFn(ang, ring.rx, ring.ry);
      } else {
        a = Math.cos(ang) * ring.rx;
        b = Math.sin(ang) * ring.ry;
      }
      const p = ring.center
        .clone()
        .addScaledVector(binormal, a)
        .addScaledVector(normal, b);
      positions.push(p.x, p.y, p.z);
      uvs.push(u, v);
    }
  }

  for (let r = 0; r < ringCount - 1; r++) {
    for (let s = 0; s < radialSegments; s++) {
      const a = r * cols + s;
      const b = r * cols + s + 1;
      const c = (r + 1) * cols + s;
      const d = (r + 1) * cols + s + 1;
      indices.push(a, d, b, a, c, d);
    }
  }

  if (capStart) {
    const cIdx = positions.length / 3;
    const c = rings[0].center;
    positions.push(c.x, c.y, c.z);
    uvs.push(0.5, 0);
    for (let s = 0; s < radialSegments; s++) {
      indices.push(cIdx, s, s + 1);
    }
  }
  if (capEnd) {
    const cIdx = positions.length / 3;
    const c = rings[ringCount - 1].center;
    const base = (ringCount - 1) * cols;
    positions.push(c.x, c.y, c.z);
    uvs.push(0.5, 1);
    for (let s = 0; s < radialSegments; s++) {
      indices.push(cIdx, base + s + 1, base + s);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createRoundedBox(
  width: number,
  height: number,
  depth: number,
  radius = 0.01,
  segments = 2
): THREE.BufferGeometry {
  const r = Math.min(radius, width * 0.45, height * 0.45, depth * 0.45);
  const w = Math.max(0.001, width - r * 2);
  const h = Math.max(0.001, height - r * 2);
  const shape = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  shape.moveTo(-hw, -hh - r);
  shape.lineTo(hw, -hh - r);
  shape.quadraticCurveTo(hw + r, -hh - r, hw + r, -hh);
  shape.lineTo(hw + r, hh);
  shape.quadraticCurveTo(hw + r, hh + r, hw, hh + r);
  shape.lineTo(-hw, hh + r);
  shape.quadraticCurveTo(-hw - r, hh + r, -hw - r, hh);
  shape.lineTo(-hw - r, -hh);
  shape.quadraticCurveTo(-hw - r, -hh - r, -hw, -hh - r);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - r * 2),
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelSegments: segments,
    curveSegments: Math.max(3, segments + 1),
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

/**
 * Bake vertex COLOR_0 tint, vertical cavity AO, and optional lower-leg mud/dust gradient
 * (Cordura shader uses warm R>B delta to push lower-leg roughness toward 0.94).
 */
export function bakeVertexColorAndDirt(
  geo: THREE.BufferGeometry,
  tintHex = 0xffffff,
  options?: {
    dirtMaxY?: number;
    dirtStrength?: number;
    aoStrength?: number;
  }
): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const baseColor = new THREE.Color(tintHex);
  const mudColor = new THREE.Color(0x6b5a45);
  const dirtMaxY = options?.dirtMaxY ?? 0.56;
  const dirtStrength = options?.dirtStrength ?? 0;
  const aoStrength = options?.aoStrength ?? 0.22;

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const ny = norm ? norm.getY(i) : 0.4;

    // Subtle cavity AO darkening on downward-facing undersides and tight groin/armpit recesses
    let ao = 1.0 - Math.max(0, -ny) * aoStrength;
    if (y > 0.72 && y < 0.98 && Math.abs(x) < 0.065) {
      ao *= 0.84;
    }
    if (y > 1.24 && y < 1.46 && Math.abs(x) > 0.14 && Math.abs(x) < 0.23) {
      ao *= 0.86;
    }

    let r = baseColor.r * ao;
    let g = baseColor.g * ao;
    let b = baseColor.b * ao;

    if (dirtStrength > 0 && y < dirtMaxY) {
      const t = THREE.MathUtils.clamp((dirtMaxY - y) / Math.max(dirtMaxY, 0.1), 0, 1);
      const mudMix = t * t * dirtStrength;
      r = THREE.MathUtils.lerp(r, mudColor.r, mudMix);
      g = THREE.MathUtils.lerp(g, mudColor.g, mudMix);
      b = THREE.MathUtils.lerp(b, mudColor.b, mudMix);
    }

    colors[i * 3] = THREE.MathUtils.clamp(r, 0, 1);
    colors[i * 3 + 1] = THREE.MathUtils.clamp(g, 0, 1);
    colors[i * 3 + 2] = THREE.MathUtils.clamp(b, 0, 1);
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/**
 * Compute dihedral curvature edge wear into COLOR_0.g while storing cavity AO in COLOR_0.r & COLOR_0.b.
 * Weapon gunmetal shader uses `(vColor.g - vColor.r)` to drive bare steel highlights on beveled edges.
 */
export function bakeDihedralEdgeWear(
  geo: THREE.BufferGeometry,
  wearStrength = 0.85
): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const norm = geo.attributes.normal;
  const count = pos.count;

  // Map spatial positions to averaged normals to detect sharp convex dihedral creases
  const bucketMap = new Map<string, { nx: number; ny: number; nz: number; n: number }>();
  const quant = (v: number) => Math.round(v * 2000);

  for (let i = 0; i < count; i++) {
    const key = `${quant(pos.getX(i))},${quant(pos.getY(i))},${quant(pos.getZ(i))}`;
    const entry = bucketMap.get(key);
    const nx = norm.getX(i);
    const ny = norm.getY(i);
    const nz = norm.getZ(i);
    if (entry) {
      entry.nx += nx;
      entry.ny += ny;
      entry.nz += nz;
      entry.n += 1;
    } else {
      bucketMap.set(key, { nx, ny, nz, n: 1 });
    }
  }

  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const key = `${quant(pos.getX(i))},${quant(pos.getY(i))},${quant(pos.getZ(i))}`;
    const entry = bucketMap.get(key)!;
    const len = Math.hypot(entry.nx, entry.ny, entry.nz) || 1;
    const avgNx = entry.nx / len;
    const avgNy = entry.ny / len;
    const avgNz = entry.nz / len;

    const dot = THREE.MathUtils.clamp(
      norm.getX(i) * avgNx + norm.getY(i) * avgNy + norm.getZ(i) * avgNz,
      -1,
      1
    );
    // Sharp crease or bevel shoulder where face normal diverges from averaged vertex normal
    const curvature = THREE.MathUtils.clamp((1 - dot) * 3.8 * wearStrength, 0, 0.35);
    const cavAO = THREE.MathUtils.clamp(0.84 + Math.max(0, norm.getY(i)) * 0.14, 0.65, 1.0);

    colors[i * 3] = cavAO * 0.72;
    colors[i * 3 + 1] = THREE.MathUtils.clamp(cavAO * 0.72 + curvature, 0, 1);
    colors[i * 3 + 2] = cavAO * 0.72;
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/**
 * Apply crease-aware normals (default 35 deg) via BufferGeometryUtils.toCreasedNormals.
 */
export function applyCreasedNormals(
  geo: THREE.BufferGeometry,
  creaseAngleDeg = 35
): THREE.BufferGeometry {
  const rad = THREE.MathUtils.degToRad(creaseAngleDeg);
  const creased = BufferGeometryUtils.toCreasedNormals(geo, rad);
  if (!creased.attributes.uv) {
    const count = creased.attributes.position.count;
    const uvs = new Float32Array(count * 2);
    const pos = creased.attributes.position;
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = pos.getX(i) * 4 + pos.getZ(i) * 4;
      uvs[i * 2 + 1] = pos.getY(i) * 4;
    }
    creased.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  return creased;
}

/**
 * Merge multiple BufferGeometries cleanly while preserving UV, Normal, COLOR_0, and Uint16 skinIndex/skinWeight.
 */
export function mergeNormalizedGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const hasSkin = geos.some((g) => Boolean(g.attributes.skinIndex && g.attributes.skinWeight));
  const hasColor = geos.some((g) => Boolean(g.attributes.color));

  const normalized = geos.map((raw) => {
    const g = raw.index ? raw.toNonIndexed() : raw.clone();
    const count = g.attributes.position.count;

    if (!g.attributes.normal) {
      g.computeVertexNormals();
    }
    if (!g.attributes.uv) {
      const uvs = new Float32Array(count * 2);
      const pos = g.attributes.position;
      for (let i = 0; i < count; i++) {
        uvs[i * 2] = (pos.getX(i) + pos.getZ(i)) * 2.5;
        uvs[i * 2 + 1] = pos.getY(i) * 2.5;
      }
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }

    if (hasColor && !g.attributes.color) {
      const cols = new Float32Array(count * 3);
      cols.fill(1.0);
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    }

    if (hasSkin) {
      if (!g.attributes.skinIndex) {
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
      } else if (!(g.attributes.skinIndex.array instanceof Uint16Array)) {
        const src = g.attributes.skinIndex;
        const dst = new Uint16Array(count * 4);
        for (let i = 0; i < count; i++) {
          for (let k = 0; k < 4; k++) {
            dst[i * 4 + k] = Math.max(0, Math.round(src.getComponent(i, k)));
          }
        }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(dst, 4));
      }

      if (!g.attributes.skinWeight) {
        const w = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) w[i * 4] = 1;
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
      }
    }

    // Strip any extra non-uniform attributes (like tangent) so mergeGeometries never fails
    for (const key of Object.keys(g.attributes)) {
      if (
        key !== 'position' &&
        key !== 'normal' &&
        key !== 'uv' &&
        key !== 'color' &&
        key !== 'skinIndex' &&
        key !== 'skinWeight'
      ) {
        g.deleteAttribute(key);
      }
    }

    return g;
  });

  const merged = BufferGeometryUtils.mergeGeometries(normalized, false);
  for (const g of normalized) g.dispose();
  if (!merged) {
    throw new Error('Failed to merge normalized geometries');
  }
  return merged;
}
