import * as THREE from 'three';

export interface PBRMaterialLibrary {
  skinHead: THREE.MeshPhysicalMaterial;
  skinLimbs: THREE.MeshPhysicalMaterial;
  fingernails: THREE.MeshPhysicalMaterial;
  eyeIris: THREE.MeshPhysicalMaterial;
  eyeCornea: THREE.MeshPhysicalMaterial;
  hairTop: THREE.MeshPhysicalMaterial;
  hairSides: THREE.MeshPhysicalMaterial;
  turtleneck: THREE.MeshPhysicalMaterial;
  oliveCordura: THREE.MeshPhysicalMaterial;
  forestWebbing: THREE.MeshPhysicalMaterial;
  oliveTrousers: THREE.MeshPhysicalMaterial;
  gloveFabric: THREE.MeshPhysicalMaterial;
  glovePalmArmor: THREE.MeshPhysicalMaterial;
  honeycombRubber: THREE.MeshPhysicalMaterial;
  velcroPatch: THREE.MeshPhysicalMaterial;
  gunmetal: THREE.MeshPhysicalMaterial;
  silverHardware: THREE.MeshPhysicalMaterial;
  blackWebbing: THREE.MeshPhysicalMaterial;
  bootLeather: THREE.MeshPhysicalMaterial;
  bootRubber: THREE.MeshPhysicalMaterial;
  stitchTrim: THREE.MeshPhysicalMaterial;
  textures: THREE.Texture[];
  dispose: () => void;
}

/** Deterministic PRNG for reproducible photorealistic procedural micro-textures */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fast value noise tileable on [0, period) */
function makeNoiseGrid(period: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return g;
}

function sampleTileNoise(grid: Float32Array, period: number, x: number, y: number): number {
  const xi = ((Math.floor(x) % period) + period) % period;
  const yi = ((Math.floor(y) % period) + period) % period;
  const x1 = (xi + 1) % period;
  const y1 = (yi + 1) % period;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);

  const a = grid[yi * period + xi];
  const b = grid[yi * period + x1];
  const c = grid[y1 * period + xi];
  const d = grid[y1 * period + x1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Converts a seamless grayscale heightfield (size x size) into a tangent-space Sobel normal tile canvas,
 * then upscales/tiles cleanly onto a 2048x2048 PBR texture canvas for ultra-fast baking with crisp micro-detail.
 */
function heightToNormalCanvas(
  height: Float32Array,
  tileSize: number,
  targetSize: number,
  strength: number
): HTMLCanvasElement {
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = tileSize;
  tileCanvas.height = tileSize;
  const tctx = tileCanvas.getContext('2d')!;
  const img = tctx.createImageData(tileSize, tileSize);
  const data = img.data;
  const mask = tileSize - 1;

  for (let y = 0; y < tileSize; y++) {
    const ym = (y - 1) & mask;
    const yp = (y + 1) & mask;
    for (let x = 0; x < tileSize; x++) {
      const xm = (x - 1) & mask;
      const xp = (x + 1) & mask;

      const tl = height[ym * tileSize + xm];
      const tc = height[ym * tileSize + x];
      const tr = height[ym * tileSize + xp];
      const ml = height[y * tileSize + xm];
      const mr = height[y * tileSize + xp];
      const bl = height[yp * tileSize + xm];
      const bc = height[yp * tileSize + x];
      const br = height[yp * tileSize + xp];

      const dx = (tr + 2 * mr + br - (tl + 2 * ml + bl)) * strength;
      const dy = (bl + 2 * bc + br - (tl + 2 * tc + tr)) * strength;
      const dz = 1.0;
      const invLen = 1.0 / Math.sqrt(dx * dx + dy * dy + dz * dz);

      const idx = (y * tileSize + x) * 4;
      data[idx] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  tctx.putImageData(img, 0, 0);

  if (targetSize === tileSize) return tileCanvas;

  const out = document.createElement('canvas');
  out.width = targetSize;
  out.height = targetSize;
  const ctx = out.getContext('2d')!;
  const pat = ctx.createPattern(tileCanvas, 'repeat')!;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, targetSize, targetSize);
  return out;
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  isSRGB: boolean,
  anisotropy: number,
  repeatX = 1,
  repeatY = 1,
  registry?: THREE.Texture[]
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = Math.min(anisotropy, 8);
  tex.needsUpdate = true;
  if (registry) registry.push(tex);
  return tex;
}

/**
 * 1. HUMAN SKIN PBR (2048x2048):
 * Multi-scale skin pores normal map, subsurface cheek/nose/ear/knuckle blood-flush,
 * subtle melanin warmth, jaw stubble shadow, lip tint & glossy T-zone roughness variation.
 */
function bakeSkinPBR(anisotropy: number, reg: THREE.Texture[]) {
  const SIZE = 2048;
  const TILE = 256;
  const n1 = makeNoiseGrid(32, 101);
  const n2 = makeNoiseGrid(64, 202);
  const n3 = makeNoiseGrid(128, 303);
  const height = new Float32Array(TILE * TILE);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const fine = sampleTileNoise(n3, 128, x * 0.5, y * 0.5);
      const mid = sampleTileNoise(n2, 64, x * 0.25, y * 0.25);
      const broad = sampleTileNoise(n1, 32, x * 0.125, y * 0.125);
      // Pore dimples: sharp negative pits on fine noise
      const pore = fine < 0.22 ? -Math.pow((0.22 - fine) / 0.22, 1.5) * 0.55 : 0;
      // Micro skin cross-grain
      const grain = Math.sin((x + y) * 0.28) * Math.sin((x - y) * 0.24) * 0.08;
      height[y * TILE + x] = 0.5 + pore + (mid - 0.5) * 0.28 + (broad - 0.5) * 0.16 + grain;
    }
  }

  const normalCanvas = heightToNormalCanvas(height, TILE, SIZE, 1.15);

  // Head Albedo (2048x2048): EXACT 1:1 linear-Y & cylindrical-U alignment with rebuilt headSculpt.ts!
  // headSculpt maps v = (y - (-0.148)) / 0.266 -> CanvasTexture flipY=true maps cy = (0.118 - y) / 0.266.
  // u = 0.5 + atan2(x, z) / (2 * PI).
  const headAlbedo = document.createElement('canvas');
  headAlbedo.width = SIZE;
  headAlbedo.height = SIZE;
  const ctx = headAlbedo.getContext('2d')!;

  const HEAD_Y_MIN = -0.148;
  const HEAD_Y_MAX = 0.118;
  const yToCy = (localY: number): number =>
    Math.max(0, Math.min(1, (HEAD_Y_MAX - localY) / (HEAD_Y_MAX - HEAD_Y_MIN)));
  const xzToCu = (localX: number, localZ = 0.090): number =>
    0.5 + Math.atan2(localX, Math.max(0.005, localZ)) / (Math.PI * 2);

  // Soft warm stylized-realistic peach-tan hero base complexion calibrated for AgX + soft studio key
  ctx.fillStyle = '#d89068';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Ultra-subtle natural organic skin mottling (never blotchy!)
  const mottleTile = document.createElement('canvas');
  mottleTile.width = 256;
  mottleTile.height = 256;
  const mctx = mottleTile.getContext('2d')!;
  const mImg = mctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const v1 = sampleTileNoise(n1, 32, x * 0.125, y * 0.125);
      const v2 = sampleTileNoise(n2, 64, x * 0.25, y * 0.25);
      const idx = (y * 256 + x) * 4;
      mImg.data[idx] = Math.round(218 + (v1 - 0.5) * 14 + (v2 - 0.5) * 8);
      mImg.data[idx + 1] = Math.round(145 + (v1 - 0.5) * 12 + (v2 - 0.5) * 6);
      mImg.data[idx + 2] = Math.round(104 + (v1 - 0.5) * 10 + (v2 - 0.5) * 5);
      mImg.data[idx + 3] = 44;
    }
  }
  mctx.putImageData(mImg, 0, 0);
  ctx.fillStyle = ctx.createPattern(mottleTile, 'repeat')!;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const addFlush = (cx: number, cy: number, rx: number, ry: number, color: string) => {
    ctx.save();
    ctx.translate(cx * SIZE, cy * SIZE);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * SIZE);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx * SIZE, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // 1. Forehead center warm sunlit peach + subtle masculine hairline & temple shadow
  addFlush(0.50, yToCy(0.056), 0.095, 0.068, 'rgba(250, 196, 154, 0.34)');
  addFlush(0.50, yToCy(0.072), 0.13, 0.028, 'rgba(134, 74, 48, 0.26)');
  addFlush(xzToCu(-0.062, 0.048), yToCy(0.046), 0.055, 0.085, 'rgba(154, 86, 58, 0.22)');
  addFlush(xzToCu(0.062, 0.048), yToCy(0.046), 0.055, 0.085, 'rgba(154, 86, 58, 0.22)');

  // 2. Subtle warm side-temple skin tone (ears sample dedicated hidden swatches below -> ZERO cheek bleed!)
  addFlush(0.275, 0.51, 0.055, 0.080, 'rgba(196, 112, 86, 0.14)');
  addFlush(0.725, 0.51, 0.055, 0.080, 'rgba(196, 112, 86, 0.14)');

  // 3. Soft rosy subsurface cheekbones + gentle masculine jaw/chin contour
  addFlush(xzToCu(-0.038, 0.078), yToCy(-0.012), 0.058, 0.068, 'rgba(208, 96, 66, 0.34)');
  addFlush(xzToCu(0.038, 0.078), yToCy(-0.012), 0.058, 0.068, 'rgba(208, 96, 66, 0.34)');
  addFlush(xzToCu(-0.036, 0.065), yToCy(-0.068), 0.055, 0.064, 'rgba(140, 96, 76, 0.16)');
  addFlush(xzToCu(0.036, 0.065), yToCy(-0.068), 0.055, 0.064, 'rgba(140, 96, 76, 0.16)');

  // 4. Soft Warm Peach-Brown Upper Eyelid Crease & Under-Eye Contour
  const eyeLeftU = xzToCu(0.0265, 0.076);
  const eyeRightU = xzToCu(-0.0265, 0.076);
  const eyeCy = yToCy(0.0128);
  for (const eu of [eyeLeftU, eyeRightU]) {
    addFlush(eu, yToCy(0.020), 0.034, 0.024, 'rgba(152, 74, 50, 0.40)');
    addFlush(eu, yToCy(0.002), 0.028, 0.016, 'rgba(166, 92, 68, 0.24)');
    addFlush(eu, eyeCy, 0.024, 0.016, 'rgba(134, 64, 46, 0.20)');
  }

  // Soft olive-brown skin shadow directly behind the multi-strand eyebrows
  const browCy = yToCy(0.030);
  addFlush(xzToCu(0.028, 0.088), browCy, 0.038, 0.013, 'rgba(70, 62, 32, 0.34)');
  addFlush(xzToCu(-0.028, 0.088), browCy, 0.038, 0.013, 'rgba(70, 62, 32, 0.34)');

  // 5. Straight Nose Bridge Soft Highlight, Warm Rosy Nose Tip & Shadowed Nostrils
  addFlush(0.50, yToCy(-0.006), 0.012, 0.068, 'rgba(248, 198, 166, 0.30)');
  addFlush(0.50, yToCy(-0.022), 0.028, 0.030, 'rgba(204, 96, 70, 0.38)');
  addFlush(0.50, yToCy(-0.033), 0.024, 0.015, 'rgba(116, 52, 36, 0.42)');
  const nostrilCy = yToCy(-0.0322);
  addFlush(xzToCu(-0.0076, 0.095), nostrilCy, 0.009, 0.009, 'rgba(42, 16, 12, 0.86)');
  addFlush(xzToCu(0.0076, 0.095), nostrilCy, 0.009, 0.009, 'rgba(42, 16, 12, 0.86)');
  addFlush(xzToCu(-0.016, 0.092), yToCy(-0.027), 0.007, 0.018, 'rgba(138, 68, 48, 0.34)');
  addFlush(xzToCu(0.016, 0.092), yToCy(-0.027), 0.007, 0.018, 'rgba(138, 68, 48, 0.34)');

  // 6. Full Pillowy Natural Terracotta-Peach Lips (EXACT 1:1 alignment to headSculpt lips!)
  const uLipCy = yToCy(-0.0512);
  const partCy = yToCy(-0.0576);
  const lLipCy = yToCy(-0.0646);
  const lipHalfW = Math.abs(xzToCu(0.0248, 0.095) - 0.5);

  ctx.save();
  ctx.filter = 'blur(5px)';
  ctx.fillStyle = 'rgba(174, 82, 64, 0.78)';
  ctx.beginPath();
  ctx.moveTo((0.5 - lipHalfW) * SIZE, partCy * SIZE);
  ctx.quadraticCurveTo(
    (0.5 - lipHalfW * 0.48) * SIZE,
    (uLipCy - 0.018) * SIZE,
    0.5 * SIZE,
    (uLipCy - 0.006) * SIZE
  );
  ctx.quadraticCurveTo(
    (0.5 + lipHalfW * 0.48) * SIZE,
    (uLipCy - 0.018) * SIZE,
    (0.5 + lipHalfW) * SIZE,
    partCy * SIZE
  );
  ctx.quadraticCurveTo(0.5 * SIZE, (partCy + 0.006) * SIZE, (0.5 - lipHalfW) * SIZE, partCy * SIZE);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(196, 98, 78, 0.78)';
  ctx.beginPath();
  ctx.moveTo((0.5 - lipHalfW * 0.92) * SIZE, partCy * SIZE);
  ctx.quadraticCurveTo(0.5 * SIZE, (lLipCy + 0.032) * SIZE, (0.5 + lipHalfW * 0.92) * SIZE, partCy * SIZE);
  ctx.quadraticCurveTo(0.5 * SIZE, (partCy + 0.005) * SIZE, (0.5 - lipHalfW * 0.92) * SIZE, partCy * SIZE);
  ctx.closePath();
  ctx.fill();
  ctx.filter = 'none';
  ctx.restore();

  addFlush(0.50, lLipCy + 0.003, lipHalfW * 0.52, 0.012, 'rgba(248, 180, 154, 0.36)');

  ctx.save();
  ctx.filter = 'blur(2px)';
  ctx.strokeStyle = 'rgba(62, 22, 16, 0.88)';
  ctx.lineWidth = 6.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo((0.5 - lipHalfW * 0.95) * SIZE, (partCy - 0.001) * SIZE);
  ctx.quadraticCurveTo(0.5 * SIZE, (partCy + 0.004) * SIZE, (0.5 + lipHalfW * 0.95) * SIZE, (partCy - 0.001) * SIZE);
  ctx.stroke();
  ctx.filter = 'none';
  ctx.restore();

  addFlush(0.5 - lipHalfW * 0.96, partCy, 0.009, 0.009, 'rgba(84, 34, 24, 0.45)');
  addFlush(0.5 + lipHalfW * 0.96, partCy, 0.009, 0.009, 'rgba(84, 34, 24, 0.45)');

  // Mentolabial shadow, proud chin warmth & crisp under-jaw/neck AO shadow
  addFlush(0.50, yToCy(-0.076), 0.034, 0.016, 'rgba(132, 68, 48, 0.34)');
  addFlush(0.50, yToCy(-0.089), 0.036, 0.026, 'rgba(246, 194, 160, 0.24)');
  addFlush(0.50, yToCy(-0.112), 0.24, 0.065, 'rgba(98, 48, 34, 0.44)');

  // Ultra-subtle organic freckles on nose bridge & upper cheeks
  const rand = mulberry32(887);
  ctx.fillStyle = 'rgba(156, 92, 60, 0.12)';
  for (let i = 0; i < 32; i++) {
    const fx = (0.44 + rand() * 0.12) * SIZE;
    const fy = (yToCy(0.002) + rand() * (yToCy(-0.024) - yToCy(0.002))) * SIZE;
    const fr = 0.9 + rand() * 1.4;
    ctx.beginPath();
    ctx.arc(fx, fy, fr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dedicated micro-detail swatches tucked in hidden bottom-left collar seam UV corner (cy=0.96):
  // u=0.04: dark espresso upper lash line; u=0.08: pink tear caruncle;
  // u in [0.105..0.175]: smooth horizontal gradient from shaded ear concha to warm outer ear skin!
  ctx.fillStyle = '#190e09';
  ctx.fillRect(0.015 * SIZE, 0.935 * SIZE, 0.045 * SIZE, 0.050 * SIZE);
  ctx.fillStyle = '#c46c60';
  ctx.fillRect(0.062 * SIZE, 0.935 * SIZE, 0.036 * SIZE, 0.050 * SIZE);
  const earGrad = ctx.createLinearGradient(0.105 * SIZE, 0, 0.178 * SIZE, 0);
  earGrad.addColorStop(0.0, '#b2654c'); // Soft warm concha bowl shadow
  earGrad.addColorStop(0.55, '#c67a5c'); // Mid-ear antihelix transition
  earGrad.addColorStop(1.0, '#d28868'); // Warm sunlit outer helix & earlobe
  ctx.fillStyle = earGrad;
  ctx.fillRect(0.100 * SIZE, 0.935 * SIZE, 0.084 * SIZE, 0.050 * SIZE);

  // Skin Roughness map (2048x2048): VELVETY MATTE cheeks/jaw/ears (0.79 -> rgb 202),
  // subtle soft nose/forehead (0.58 -> rgb 148), natural satin lips (0.42 -> rgb 108) — ZERO greasy plastic!
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = SIZE;
  roughCanvas.height = SIZE;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = 'rgb(202,202,202)'; // 0.79 velvety matte across cheeks, jaw, temples, ears, neck!
  rctx.fillRect(0, 0, SIZE, SIZE);

  const setRoughZone = (cx: number, cy: number, rx: number, ry: number, val: number) => {
    rctx.save();
    rctx.translate(cx * SIZE, cy * SIZE);
    rctx.scale(1, ry / rx);
    const g = rctx.createRadialGradient(0, 0, 0, 0, 0, rx * SIZE);
    g.addColorStop(0, `rgba(${val},${val},${val},0.85)`);
    g.addColorStop(1, 'rgba(202,202,202,0)');
    rctx.fillStyle = g;
    rctx.beginPath();
    rctx.arc(0, 0, rx * SIZE, 0, Math.PI * 2);
    rctx.fill();
    rctx.restore();
  };
  setRoughZone(0.50, yToCy(0.056), 0.075, 0.050, 152); // Forehead center soft matte-satin (~0.60)
  setRoughZone(0.50, yToCy(-0.018), 0.024, 0.055, 142); // Nose bridge & tip subtle sheen (~0.56)
  setRoughZone(0.50, partCy, lipHalfW * 1.1, 0.030, 108); // Soft natural lips (~0.42)
  // Matte dark lash line, moist pink caruncle, matte ear swatches
  rctx.fillStyle = 'rgb(205,205,205)';
  rctx.fillRect(0.015 * SIZE, 0.935 * SIZE, 0.045 * SIZE, 0.050 * SIZE);
  rctx.fillStyle = 'rgb(92,92,92)';
  rctx.fillRect(0.062 * SIZE, 0.935 * SIZE, 0.036 * SIZE, 0.050 * SIZE);
  rctx.fillStyle = 'rgb(205,205,205)';
  rctx.fillRect(0.100 * SIZE, 0.935 * SIZE, 0.082 * SIZE, 0.050 * SIZE);

  // Limb skin albedo (warm tanned athletic forearms & fingers calibrated to match Mat_Skin_Head)
  const limbAlbedo = document.createElement('canvas');
  limbAlbedo.width = SIZE;
  limbAlbedo.height = SIZE;
  const lctx = limbAlbedo.getContext('2d')!;
  lctx.fillStyle = '#d08662';
  lctx.fillRect(0, 0, SIZE, SIZE);
  lctx.fillStyle = lctx.createPattern(mottleTile, 'repeat')!;
  lctx.fillRect(0, 0, SIZE, SIZE);
  lctx.strokeStyle = 'rgba(136, 78, 54, 0.11)';
  lctx.lineWidth = 3;
  for (let i = 0; i < 20; i++) {
    const x = rand() * SIZE;
    lctx.beginPath();
    lctx.moveTo(x, 0);
    lctx.bezierCurveTo(x + 24, SIZE * 0.33, x - 24, SIZE * 0.66, x + 8, SIZE);
    lctx.stroke();
  }

  const headMap = finalizeTexture(headAlbedo, true, anisotropy, 1, 1, reg);
  headMap.wrapS = THREE.ClampToEdgeWrapping;
  headMap.wrapT = THREE.ClampToEdgeWrapping;

  const limbMap = finalizeTexture(limbAlbedo, true, anisotropy, 2, 2, reg);
  const skinNormal = finalizeTexture(normalCanvas, false, anisotropy, 3, 3, reg);
  const headRough = finalizeTexture(roughCanvas, false, anisotropy, 1, 1, reg);
  headRough.wrapS = THREE.ClampToEdgeWrapping;
  headRough.wrapT = THREE.ClampToEdgeWrapping;

  return { headMap, limbMap, skinNormal, headRough };
}

/**
 * 2. CORDURA / RIPSTOP NYLON TACTICAL FABRIC PBR (2048x2048):
 * Tight woven cross-hatch thread grid + ripstop reinforcement squares + subtle edge wear & crease AO.
 */
function bakeCorduraPBR(
  baseHex: string,
  darkHex: string,
  anisotropy: number,
  reg: THREE.Texture[],
  seed: number
) {
  const SIZE = 2048;
  const TILE = 256;
  const height = new Float32Array(TILE * TILE);
  const noiseFine = makeNoiseGrid(64, seed);
  const noiseMid = makeNoiseGrid(32, seed + 13);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // Crisp military Ripstop + tight diagonal micro-twill basket weave
      const warp = Math.sin(x * Math.PI * 0.5);
      const weft = Math.sin(y * Math.PI * 0.5);
      const twill = Math.sin(((x + y) & 7) * Math.PI * 0.25) * 0.22;
      const basket = ((x >> 1) + (y >> 1)) % 2 === 0 ? warp * 0.34 : weft * 0.34;
      // Crisp Ripstop reinforcement cross-hatch threads every 28px
      const ripX = x % 28 < 2 ? 0.36 : 0;
      const ripY = y % 28 < 2 ? 0.36 : 0;
      // Subtle high-frequency woven cotton/nylon fiber slub (ZERO large blurry clouds!)
      const slub =
        (sampleTileNoise(noiseFine, 64, x * 0.5, y * 0.5) - 0.5) * 0.16 +
        (sampleTileNoise(noiseMid, 32, x * 0.125, y * 0.125) - 0.5) * 0.08;
      height[y * TILE + x] = 0.5 + basket * 0.44 + twill + ripX + ripY + slub;
    }
  }

  const normalCanvas = heightToNormalCanvas(height, TILE, SIZE, 2.55);

  // Tileable crisp Albedo & strictly-matte Roughness (226..248 -> 0.88..0.97 effective roughness!)
  const tileAlbedo = document.createElement('canvas');
  tileAlbedo.width = TILE;
  tileAlbedo.height = TILE;
  const tactx = tileAlbedo.getContext('2d')!;
  tactx.fillStyle = baseHex;
  tactx.fillRect(0, 0, TILE, TILE);

  const tileRough = document.createElement('canvas');
  tileRough.width = TILE;
  tileRough.height = TILE;
  const trctx = tileRough.getContext('2d')!;
  const rImg = trctx.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = sampleTileNoise(noiseFine, 64, x * 0.5, y * 0.5);
      const isRip = x % 28 < 2 || y % 28 < 2;
      // Strictly matte heavy tactical cloth: 226..248 (0.886..0.973) — ZERO plastic specular blobs!
      const rv = Math.round(isRip ? 226 + n * 10 : 234 + n * 14);
      const idx = (y * TILE + x) * 4;
      rImg.data[idx] = rv;
      rImg.data[idx + 1] = rv;
      rImg.data[idx + 2] = rv;
      rImg.data[idx + 3] = 255;
    }
  }
  trctx.putImageData(rImg, 0, 0);

  // Crisp woven twill cross-hatch micro-threads
  tactx.strokeStyle = darkHex;
  tactx.globalAlpha = 0.30;
  tactx.lineWidth = 1;
  for (let i = 0; i < TILE; i += 4) {
    tactx.beginPath();
    tactx.moveTo(i, 0);
    tactx.lineTo(i, TILE);
    tactx.stroke();
    tactx.beginPath();
    tactx.moveTo(0, i);
    tactx.lineTo(TILE, i);
    tactx.stroke();
  }
  // Crisp Ripstop square reinforcement grid (subtle woven contrast, never shiny)
  tactx.strokeStyle = darkHex;
  tactx.globalAlpha = 0.24;
  tactx.lineWidth = 2;
  for (let i = 0; i < TILE; i += 28) {
    tactx.beginPath();
    tactx.moveTo(i, 0);
    tactx.lineTo(i, TILE);
    tactx.stroke();
    tactx.beginPath();
    tactx.moveTo(0, i);
    tactx.lineTo(TILE, i);
    tactx.stroke();
  }
  tactx.strokeStyle = 'rgba(130, 165, 118, 0.11)';
  tactx.globalAlpha = 1;
  tactx.lineWidth = 1;
  for (let i = 2; i < TILE; i += 28) {
    tactx.beginPath();
    tactx.moveTo(i, 0);
    tactx.lineTo(i, TILE);
    tactx.stroke();
    tactx.beginPath();
    tactx.moveTo(0, i);
    tactx.lineTo(TILE, i);
    tactx.stroke();
  }

  // Ultra-fine pixel-level woven yarn color variance (replaces old blurry blotch clouds!)
  const rand = mulberry32(seed + 77);
  for (let i = 0; i < 420; i++) {
    const x = Math.floor(rand() * TILE);
    const y = Math.floor(rand() * TILE);
    const len = 6 + Math.floor(rand() * 14);
    const horiz = rand() > 0.5;
    tactx.fillStyle = rand() > 0.5 ? 'rgba(92, 124, 82, 0.08)' : 'rgba(6, 12, 6, 0.10)';
    tactx.fillRect(x, y, horiz ? len : 1, horiz ? 1 : len);
  }

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = SIZE;
  albedoCanvas.height = SIZE;
  const actx = albedoCanvas.getContext('2d')!;
  actx.fillStyle = actx.createPattern(tileAlbedo, 'repeat')!;
  actx.fillRect(0, 0, SIZE, SIZE);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = SIZE;
  roughCanvas.height = SIZE;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = rctx.createPattern(tileRough, 'repeat')!;
  rctx.fillRect(0, 0, SIZE, SIZE);

  return {
    map: finalizeTexture(albedoCanvas, true, anisotropy, 4, 4, reg),
    normalMap: finalizeTexture(normalCanvas, false, anisotropy, 4, 4, reg),
    roughnessMap: finalizeTexture(roughCanvas, false, anisotropy, 4, 4, reg),
  };
}

/**
 * 3. RIBBED TURTLENECK KNIT PBR (2048x2048): Deep forest-green vertical knit wales.
 */
function bakeRibbedKnitPBR(anisotropy: number, reg: THREE.Texture[]) {
  const SIZE = 2048;
  const TILE = 256;
  const height = new Float32Array(TILE * TILE);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // Strong vertical knit ribs + subtle diagonal V-stitch loops
      const rib = Math.cos((x / TILE) * Math.PI * 2 * 16) * 0.55;
      const stitch = Math.sin((y / TILE) * Math.PI * 2 * 48 + Math.abs((x % 16) - 8) * 0.45) * 0.14;
      height[y * TILE + x] = 0.5 + rib + stitch;
    }
  }

  const normalCanvas = heightToNormalCanvas(height, TILE, SIZE, 2.8);
  const albedo = document.createElement('canvas');
  albedo.width = SIZE;
  albedo.height = SIZE;
  const ctx = albedo.getContext('2d')!;
  ctx.fillStyle = '#172814';
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let x = 0; x < SIZE; x += 16) {
    ctx.fillStyle = 'rgba(6, 12, 6, 0.52)';
    ctx.fillRect(x, 0, 5, SIZE);
    ctx.fillStyle = 'rgba(54, 82, 48, 0.18)';
    ctx.fillRect(x + 6, 0, 4, SIZE);
  }

  return {
    map: finalizeTexture(albedo, true, anisotropy, 3, 2, reg),
    normalMap: finalizeTexture(normalCanvas, false, anisotropy, 3, 2, reg),
  };
}

/**
 * 4. HONEYCOMB SHOULDER PAD RUBBER & VELCRO PBR (2048x2048):
 * Crisp hexagonal micro-rubber cell height/normal map + coarse Velcro hook texture.
 */
function bakeHoneycombAndVelcroPBR(anisotropy: number, reg: THREE.Texture[]) {
  const SIZE = 2048;
  const TILE = 256;
  const height = new Float32Array(TILE * TILE);

  // Seamless axial hexagonal cell grid
  const cols = 8;
  const rows = 8;
  const cellW = TILE / cols;
  const cellH = TILE / rows;

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const row = Math.floor(y / cellH);
      const offsetX = (row % 2) * (cellW * 0.5);
      const lx = (((x + offsetX) % cellW) + cellW) % cellW - cellW * 0.5;
      const ly = ((y % cellH) + cellH) % cellH - cellH * 0.5;
      const ax = Math.abs(lx) / (cellW * 0.5);
      const ay = Math.abs(ly) / (cellH * 0.5);
      // Hex distance metric
      const hexDist = Math.max(ax, ax * 0.5 + ay * 0.866);
      const wall = hexDist > 0.78 ? 0.15 : 0.85 - hexDist * 0.18;
      height[y * TILE + x] = wall;
    }
  }

  const hexNormal = heightToNormalCanvas(height, TILE, SIZE, 3.4);

  const hexAlbedo = document.createElement('canvas');
  hexAlbedo.width = SIZE;
  hexAlbedo.height = SIZE;
  const hctx = hexAlbedo.getContext('2d')!;
  const hexTile = document.createElement('canvas');
  hexTile.width = TILE;
  hexTile.height = TILE;
  const htctx = hexTile.getContext('2d')!;
  const img = htctx.createImageData(TILE, TILE);
  for (let i = 0; i < TILE * TILE; i++) {
    const v = height[i];
    const base = Math.round(28 + v * 34);
    img.data[i * 4] = base;
    img.data[i * 4 + 1] = Math.round(base * 1.04);
    img.data[i * 4 + 2] = Math.round(base * 0.98);
    img.data[i * 4 + 3] = 255;
  }
  htctx.putImageData(img, 0, 0);
  hctx.fillStyle = hctx.createPattern(hexTile, 'repeat')!;
  hctx.fillRect(0, 0, SIZE, SIZE);

  // Velcro coarse loop heightfield
  const vHeight = new Float32Array(TILE * TILE);
  const rand = mulberry32(419);
  for (let i = 0; i < TILE * TILE; i++) {
    vHeight[i] = rand() > 0.45 ? 0.8 : 0.2;
  }
  const velcroNormal = heightToNormalCanvas(vHeight, TILE, 1024, 3.0);

  return {
    hexMap: finalizeTexture(hexAlbedo, true, anisotropy, 4, 4, reg),
    hexNormal: finalizeTexture(hexNormal, false, anisotropy, 4, 4, reg),
    velcroNormal: finalizeTexture(velcroNormal, false, anisotropy, 4, 4, reg),
  };
}

/**
 * 4B. HIGH-FREQUENCY TACTICAL GLOVE MICRO-FABRIC & PALM/PLATE REINFORCEMENT PBR (2048x2048):
 * Ultra-fine 4-way stretch breathable Ripstop/Cordura micro-weave for the glove dorsum & finger cuffs,
 * plus high-frequency Clarino synthetic micro-suede + diamond anti-slip micro-knurl for palm grip pads
 * and reinforced knuckle/wrist padded plates (strictly ultra-matte 0.86..0.98 roughness, ZERO plastic sheen!).
 */
function bakeGloveMicroTextilesPBR(anisotropy: number, reg: THREE.Texture[]) {
  const SIZE = 2048;
  const TILE = 256;

  // --- A. High-Frequency Glove Micro-Mesh / Tactical Ripstop Knit ---
  // NOTE: heightToNormalCanvas tiles TILE (256) 8x8 across SIZE (2048).
  // 8px woven basket threads = 32 threads/tile -> 256 threads per UV unit (~2 threads/mm on a 10cm glove),
  // resolving as crisp tactile micro-weave in close-up with zero mipmap washout!
  const dorsumH = new Float32Array(TILE * TILE);
  const fiberNoise = makeNoiseGrid(64, 811);
  const randD = mulberry32(823);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const bx = Math.floor(x / 8);
      const by = Math.floor(y / 8);
      const over = (bx + by) % 2 === 0;
      const fx = ((x % 8) + 0.5) / 8;
      const fy = ((y % 8) + 0.5) / 8;
      // Distinct rounded warp/weft yarn crown with deep dark interstitial valleys
      const warpCrown = Math.sin(fx * Math.PI) * (0.65 + 0.35 * Math.sin(fy * Math.PI));
      const weftCrown = Math.sin(fy * Math.PI) * (0.65 + 0.35 * Math.sin(fx * Math.PI));
      const yarnRib = over
        ? Math.sin(fy * Math.PI * 3) * 0.05
        : Math.sin(fx * Math.PI * 3) * 0.05;
      const thread = over ? 0.14 + warpCrown * 0.68 + yarnRib : 0.10 + weftCrown * 0.62 + yarnRib;

      // Crisp 64px tactical Ripstop reinforcement thread crossing
      const isRip = x % 64 < 3 || y % 64 < 3;
      const rip = isRip ? 0.18 : 0;
      const fuzz =
        (sampleTileNoise(fiberNoise, 64, x * 0.5, y * 0.5) - 0.5) * 0.12 +
        (randD() - 0.5) * 0.06;
      dorsumH[y * TILE + x] = Math.max(0.02, Math.min(0.98, thread + rip + fuzz));
    }
  }

  const dorsumNormal = heightToNormalCanvas(dorsumH, TILE, SIZE, 4.6);

  const dTileAlbedo = document.createElement('canvas');
  dTileAlbedo.width = TILE;
  dTileAlbedo.height = TILE;
  const daCtx = dTileAlbedo.getContext('2d')!;
  const daImg = daCtx.createImageData(TILE, TILE);

  const dTileRough = document.createElement('canvas');
  dTileRough.width = TILE;
  dTileRough.height = TILE;
  const drCtx = dTileRough.getContext('2d')!;
  const drImg = drCtx.createImageData(TILE, TILE);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const h = dorsumH[y * TILE + x];
      const n = sampleTileNoise(fiberNoise, 64, x * 0.25, y * 0.25);
      const isRip = x % 64 < 3 || y % 64 < 3;
      const idx = (y * TILE + x) * 4;
      // Rich matte tactical pine-olive textile with crisp warp/weft thread AO contrast
      const g = Math.round(22 + h * 34 + (isRip ? 5 : 0) + (n - 0.5) * 7);
      daImg.data[idx] = Math.round(g * 0.62);
      daImg.data[idx + 1] = g;
      daImg.data[idx + 2] = Math.round(g * 0.53);
      daImg.data[idx + 3] = 255;

      // Strictly ultra-matte textile fiber roughness: 224..250 (0.88..0.98) -> ZERO plastic glare!
      const rv = Math.max(224, Math.min(250, Math.round(246 - h * 20 + (n - 0.5) * 8)));
      drImg.data[idx] = rv;
      drImg.data[idx + 1] = rv;
      drImg.data[idx + 2] = rv;
      drImg.data[idx + 3] = 255;
    }
  }
  daCtx.putImageData(daImg, 0, 0);
  drCtx.putImageData(drImg, 0, 0);

  const dorsumAlbedo = document.createElement('canvas');
  dorsumAlbedo.width = SIZE;
  dorsumAlbedo.height = SIZE;
  const fullDaCtx = dorsumAlbedo.getContext('2d')!;
  fullDaCtx.fillStyle = fullDaCtx.createPattern(dTileAlbedo, 'repeat')!;
  fullDaCtx.fillRect(0, 0, SIZE, SIZE);

  const dorsumRough = document.createElement('canvas');
  dorsumRough.width = SIZE;
  dorsumRough.height = SIZE;
  const fullDrCtx = dorsumRough.getContext('2d')!;
  fullDrCtx.fillStyle = fullDrCtx.createPattern(dTileRough, 'repeat')!;
  fullDrCtx.fillRect(0, 0, SIZE, SIZE);

  // --- B. High-Frequency Glove Palm Clarino Micro-Suede + Woven Diamond Grip Micro-Knurl ---
  // 32px staggered micro-diamond grip cells (8x8 per tile -> 64x64 per UV unit) + 8px woven fiber sub-grain
  const palmH = new Float32Array(TILE * TILE);
  const suedeNoise = makeNoiseGrid(64, 859);
  const randP = mulberry32(877);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const cell = 32;
      const row = Math.floor(y / cell);
      const sx = (x + (row % 2) * (cell * 0.5)) % cell;
      const sy = y % cell;
      const u = sx / cell - 0.5;
      const v = sy / cell - 0.5;
      const manhattan = Math.abs(u) + Math.abs(v);
      // Crisp beveled anti-slip diamond grip lug with woven groove trough
      const diamondDome =
        manhattan < 0.44 ? Math.pow(1 - manhattan / 0.44, 0.50) * 0.58 : 0.0;

      // Secondary 8px woven textile cross-hatch visible inside and between every diamond cell
      const fx = ((x % 8) + 0.5) / 8;
      const fy = ((y % 8) + 0.5) / 8;
      const subWeave =
        (Math.sin(fx * Math.PI) * Math.sin(fy * Math.PI)) * 0.22 +
        (sampleTileNoise(suedeNoise, 64, x * 0.65, y * 0.65) - 0.5) * 0.18 +
        (randP() - 0.5) * 0.10;
      palmH[y * TILE + x] = Math.max(0.03, Math.min(0.98, 0.14 + diamondDome + subWeave));
    }
  }

  const palmNormal = heightToNormalCanvas(palmH, TILE, SIZE, 5.2);

  const pTileAlbedo = document.createElement('canvas');
  pTileAlbedo.width = TILE;
  pTileAlbedo.height = TILE;
  const paCtx = pTileAlbedo.getContext('2d')!;
  const paImg = paCtx.createImageData(TILE, TILE);

  const pTileRough = document.createElement('canvas');
  pTileRough.width = TILE;
  pTileRough.height = TILE;
  const prCtx = pTileRough.getContext('2d')!;
  const prImg = prCtx.createImageData(TILE, TILE);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const h = palmH[y * TILE + x];
      const n = sampleTileNoise(suedeNoise, 64, x * 0.35, y * 0.35);
      const idx = (y * TILE + x) * 4;
      // Deep matte tactical charcoal-olive Clarino suede / micro-fabric grip (#111512 .. #2d342e)
      const base = Math.round(15 + h * 30 + (n - 0.5) * 6);
      paImg.data[idx] = Math.round(base * 0.94);
      paImg.data[idx + 1] = Math.round(base * 1.05);
      paImg.data[idx + 2] = Math.round(base * 0.92);
      paImg.data[idx + 3] = 255;

      // Strictly ultra-matte dry suede/micro-fabric roughness: 222..250 (0.87..0.98) -> ZERO plastic sheen!
      const rv = Math.max(222, Math.min(250, Math.round(246 - h * 22 + (n - 0.5) * 8)));
      prImg.data[idx] = rv;
      prImg.data[idx + 1] = rv;
      prImg.data[idx + 2] = rv;
      prImg.data[idx + 3] = 255;
    }
  }
  paCtx.putImageData(paImg, 0, 0);
  prCtx.putImageData(prImg, 0, 0);

  const palmAlbedo = document.createElement('canvas');
  palmAlbedo.width = SIZE;
  palmAlbedo.height = SIZE;
  const fullPaCtx = palmAlbedo.getContext('2d')!;
  fullPaCtx.fillStyle = fullPaCtx.createPattern(pTileAlbedo, 'repeat')!;
  fullPaCtx.fillRect(0, 0, SIZE, SIZE);

  const palmRough = document.createElement('canvas');
  palmRough.width = SIZE;
  palmRough.height = SIZE;
  const fullPrCtx = palmRough.getContext('2d')!;
  fullPrCtx.fillStyle = fullPrCtx.createPattern(pTileRough, 'repeat')!;
  fullPrCtx.fillRect(0, 0, SIZE, SIZE);

  return {
    dorsumMap: finalizeTexture(dorsumAlbedo, true, anisotropy, 1, 1, reg),
    dorsumNormal: finalizeTexture(dorsumNormal, false, anisotropy, 1, 1, reg),
    dorsumRough: finalizeTexture(dorsumRough, false, anisotropy, 1, 1, reg),
    palmMap: finalizeTexture(palmAlbedo, true, anisotropy, 1, 1, reg),
    palmNormal: finalizeTexture(palmNormal, false, anisotropy, 1, 1, reg),
    palmRough: finalizeTexture(palmRough, false, anisotropy, 1, 1, reg),
  };
}

/**
 * 5. BRUSHED GUNMETAL & SILVER HARDWARE PBR (2048x2048):
 * Directional fine brushed scratches for grommets, belt buckle, zipper pull, and speed-lace hooks.
 */
function bakeBrushedMetalPBR(anisotropy: number, reg: THREE.Texture[]) {
  const SIZE = 2048;
  const TILE = 256;
  const height = new Float32Array(TILE * TILE);
  const rand = mulberry32(505);

  // Horizontal brushed streaks
  for (let y = 0; y < TILE; y++) {
    const rowStreak = (rand() - 0.5) * 0.55;
    for (let x = 0; x < TILE; x++) {
      const micro = Math.sin(x * 0.08 + y * 1.7) * 0.14 + (rand() - 0.5) * 0.12;
      height[y * TILE + x] = 0.5 + rowStreak + micro;
    }
  }
  const normalCanvas = heightToNormalCanvas(height, TILE, SIZE, 1.4);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = SIZE;
  roughCanvas.height = SIZE;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = 'rgb(78,78,78)'; // ~0.30
  rctx.fillRect(0, 0, SIZE, SIZE);
  for (let y = 0; y < SIZE; y += 3) {
    const shade = 64 + Math.floor(rand() * 38);
    rctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    rctx.fillRect(0, y, SIZE, 2);
  }

  return {
    normalMap: finalizeTexture(normalCanvas, false, anisotropy, 2, 2, reg),
    roughnessMap: finalizeTexture(roughCanvas, false, anisotropy, 2, 2, reg),
  };
}

/**
 * 6. PEBBLED FULL-GRAIN BOOT LEATHER & VULCANIZED VIBRAM RUBBER PBR (2048x2048):
 * Fine realistic tactical leather grain pebbles (matte-satin 0.60..0.77, ZERO wet trash-bag glare!)
 * plus dedicated fine micro-stipple vulcanized rubber normal map for deep Vibram lug outsoles.
 */
function bakePebbledLeatherPBR(anisotropy: number, reg: THREE.Texture[]) {
  const SIZE = 2048;
  const TILE = 256;
  const height = new Float32Array(TILE * TILE);
  const rand = mulberry32(612);

  // Fine full-grain military leather pebble grid (24x24 jittered Voronoi cells + subtle hide creases)
  const G = 24;
  const cell = TILE / G;
  const px = new Float32Array(G * G);
  const py = new Float32Array(G * G);
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      px[gy * G + gx] = (gx + 0.18 + rand() * 0.64) * cell;
      py[gy * G + gx] = (gy + 0.18 + rand() * 0.64) * cell;
    }
  }
  const hideNoise = makeNoiseGrid(32, 619);

  for (let y = 0; y < TILE; y++) {
    const gy0 = Math.floor(y / cell);
    for (let x = 0; x < TILE; x++) {
      const gx0 = Math.floor(x / cell);
      let d1 = 1e9;
      let d2 = 1e9;
      for (let oy = -1; oy <= 1; oy++) {
        const gy = (gy0 + oy + G) % G;
        for (let ox = -1; ox <= 1; ox++) {
          const gx = (gx0 + ox + G) % G;
          let dx = px[gy * G + gx] - x;
          let dy = py[gy * G + gx] - y;
          if (dx > TILE * 0.5) dx -= TILE;
          if (dx < -TILE * 0.5) dx += TILE;
          if (dy > TILE * 0.5) dy -= TILE;
          if (dy < -TILE * 0.5) dy += TILE;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) {
            d2 = d;
          }
        }
      }
      const edge = Math.min(1, (d2 - d1) / (cell * 0.42));
      const hideCrease = (sampleTileNoise(hideNoise, 32, x * 0.125, y * 0.125) - 0.5) * 0.16;
      height[y * TILE + x] = 0.25 + Math.pow(edge, 0.52) * 0.68 + hideCrease;
    }
  }

  const normalCanvas = heightToNormalCanvas(height, TILE, SIZE, 2.75);

  // Dedicated fine micro-stipple normal map for vulcanized Vibram matte rubber soles
  const rubHeight = new Float32Array(TILE * TILE);
  const rubNoise = makeNoiseGrid(64, 733);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const fine = rand() * 0.35;
      const mold = sampleTileNoise(rubNoise, 64, x * 0.5, y * 0.5) * 0.45;
      rubHeight[y * TILE + x] = 0.2 + fine + mold;
    }
  }
  const rubberNormalCanvas = heightToNormalCanvas(rubHeight, TILE, 1024, 1.8);

  // Tileable deep tactical charcoal-black full-grain leather albedo (crisp pebble recesses, ZERO blurry blobs)
  const tileAlbedo = document.createElement('canvas');
  tileAlbedo.width = TILE;
  tileAlbedo.height = TILE;
  const tactx = tileAlbedo.getContext('2d')!;
  const aImg = tactx.createImageData(TILE, TILE);
  const tileRough = document.createElement('canvas');
  tileRough.width = TILE;
  tileRough.height = TILE;
  const trctx = tileRough.getContext('2d')!;
  const rImg = trctx.createImageData(TILE, TILE);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const h = height[y * TILE + x];
      const n = sampleTileNoise(hideNoise, 32, x * 0.125, y * 0.125);
      // Rich deep matte-satin military jet-black full-grain leather (#090a0c..#16181b)
      const base = Math.round(9 + h * 11 + (n - 0.5) * 4);
      const idx = (y * TILE + x) * 4;
      aImg.data[idx] = base;
      aImg.data[idx + 1] = Math.round(base * 1.02);
      aImg.data[idx + 2] = Math.round(base * 1.05);
      aImg.data[idx + 3] = 255;

      // Strictly matte-satin tactical leather roughness: 148..206 (0.58..0.81) — rich leather, ZERO plastic glare!
      const rv = Math.round(196 - h * 40 + (n - 0.5) * 16);
      const clampedR = Math.max(146, Math.min(208, rv));
      rImg.data[idx] = clampedR;
      rImg.data[idx + 1] = clampedR;
      rImg.data[idx + 2] = clampedR;
      rImg.data[idx + 3] = 255;
    }
  }
  tactx.putImageData(aImg, 0, 0);
  trctx.putImageData(rImg, 0, 0);

  const albedo = document.createElement('canvas');
  albedo.width = SIZE;
  albedo.height = SIZE;
  const ctx = albedo.getContext('2d')!;
  ctx.fillStyle = ctx.createPattern(tileAlbedo, 'repeat')!;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const rough = document.createElement('canvas');
  rough.width = SIZE;
  rough.height = SIZE;
  const rctx = rough.getContext('2d')!;
  rctx.fillStyle = rctx.createPattern(tileRough, 'repeat')!;
  rctx.fillRect(0, 0, SIZE, SIZE);

  return {
    map: finalizeTexture(albedo, true, anisotropy, 4, 4, reg),
    normalMap: finalizeTexture(normalCanvas, false, anisotropy, 4, 4, reg),
    roughnessMap: finalizeTexture(rough, false, anisotropy, 4, 4, reg),
    rubberNormal: finalizeTexture(rubberNormalCanvas, false, anisotropy, 5, 5, reg),
  };
}

/**
 * 7. PHOTOREALISTIC STEEL-BLUE EYE IRIS (1024x1024) & HAIR STRANDS (1024x1024):
 * Crisp radial collagen iris fibers, dark limbal ring, amber collarette, deep pupil, subtle scleral tint.
 */
function bakeEyeAndHairPBR(anisotropy: number, reg: THREE.Texture[]) {
  const ESIZE = 1024;
  const eyeCanvas = document.createElement('canvas');
  eyeCanvas.width = ESIZE;
  eyeCanvas.height = ESIZE;
  const ctx = eyeCanvas.getContext('2d')!;

  // Clean bright warm-white sclera base matching the vivid heroic eyes in 4_a81a6ae0.jpg
  ctx.fillStyle = '#ece8e1';
  ctx.fillRect(0, 0, ESIZE, ESIZE);

  // Soft peripheral ambient sclera shading & subtle vascular warmth far from iris
  const rand = mulberry32(991);
  const cx = ESIZE * 0.5;
  const cy = ESIZE * 0.5;
  const scleraGrad = ctx.createRadialGradient(cx, cy, ESIZE * 0.22, cx, cy, ESIZE * 0.5);
  scleraGrad.addColorStop(0, 'rgba(255,255,255,0)');
  scleraGrad.addColorStop(0.68, 'rgba(196,158,148,0.24)');
  scleraGrad.addColorStop(1, 'rgba(148,96,90,0.52)');
  ctx.fillStyle = scleraGrad;
  ctx.fillRect(0, 0, ESIZE, ESIZE);

  // Ultra-fine scleral capillaries far from iris
  ctx.strokeStyle = 'rgba(170, 88, 82, 0.18)';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 28; i++) {
    const a = rand() * Math.PI * 2;
    const r0 = ESIZE * (0.31 + rand() * 0.08);
    const r1 = ESIZE * 0.48;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.quadraticCurveTo(
      cx + Math.cos(a + 0.08) * ((r0 + r1) * 0.5),
      cy + Math.sin(a + 0.08) * ((r0 + r1) * 0.5),
      cx + Math.cos(a - 0.05) * r1,
      cy + Math.sin(a - 0.05) * r1
    );
    ctx.stroke();
  }

  // Deep rich heroic sapphire-steel blue iris matching 4_a81a6ae0.jpg portrait!
  const irisR = ESIZE * 0.295;
  const pupilR = ESIZE * 0.118;

  const irisBase = ctx.createRadialGradient(cx, cy, pupilR * 0.82, cx, cy, irisR);
  irisBase.addColorStop(0.0, '#05101c');
  irisBase.addColorStop(0.22, '#13578f');
  irisBase.addColorStop(0.56, '#2784cc'); // Vivid heroic steel-sapphire blue
  irisBase.addColorStop(0.82, '#0e4272');
  irisBase.addColorStop(0.93, '#051424'); // Strong crisp dark limbal ring
  irisBase.addColorStop(1.0, '#d2cdc6');
  ctx.fillStyle = irisBase;
  ctx.beginPath();
  ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
  ctx.fill();

  // Radial iris collagen fibers (300 fine striations)
  for (let i = 0; i < 300; i++) {
    const angle = (i / 300) * Math.PI * 2 + (rand() - 0.5) * 0.014;
    const bright = rand() > 0.40;
    ctx.strokeStyle = bright
      ? `rgba(128, 206, 255, ${0.26 + rand() * 0.38})`
      : `rgba(8, 32, 60, ${0.32 + rand() * 0.36})`;
    ctx.lineWidth = 1.0 + rand() * 2.0;
    const rStart = pupilR * (1.03 + rand() * 0.12);
    const rEnd = irisR * (0.86 + rand() * 0.07);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * rStart, cy + Math.sin(angle) * rStart);
    ctx.quadraticCurveTo(
      cx + Math.cos(angle + (rand() - 0.5) * 0.05) * ((rStart + rEnd) * 0.52),
      cy + Math.sin(angle + (rand() - 0.5) * 0.05) * ((rStart + rEnd) * 0.52),
      cx + Math.cos(angle) * rEnd,
      cy + Math.sin(angle) * rEnd
    );
    ctx.stroke();
  }

  // Soft upper eyelid cast shadow across top of sclera & iris for grounded realism
  const lidShadow = ctx.createLinearGradient(0, cy - irisR * 1.35, 0, cy - irisR * 0.10);
  lidShadow.addColorStop(0, 'rgba(18, 16, 22, 0.52)');
  lidShadow.addColorStop(1, 'rgba(18, 16, 22, 0)');
  ctx.fillStyle = lidShadow;
  ctx.fillRect(0, 0, ESIZE, cy);

  // Deep black pupil with crisp edge
  ctx.fillStyle = '#030508';
  ctx.beginPath();
  ctx.arc(cx, cy, pupilR, 0, Math.PI * 2);
  ctx.fill();

  // Crisp bright studio catchlight glints bringing wide-awake hero eyes to life
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.beginPath();
  ctx.arc(cx - pupilR * 0.62, cy - pupilR * 0.58, pupilR * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(220, 240, 255, 0.54)';
  ctx.beginPath();
  ctx.arc(cx + pupilR * 0.78, cy + pupilR * 0.66, pupilR * 0.13, 0, Math.PI * 2);
  ctx.fill();

  // Hair Fiber Strand Albedo + Normal (1024x1024):
  // NOTE: CanvasTexture flipY=true maps v=0 (hair roots / fade edge) -> canvas BOTTOM (HSIZE),
  // and v=1 (crown tips) -> canvas TOP (0)! ClampToEdge on T eliminates ALL horizontal zebra banding!
  const HSIZE = 1024;
  const hairTopCanvas = document.createElement('canvas');
  hairTopCanvas.width = HSIZE;
  hairTopCanvas.height = HSIZE;
  const htctx = hairTopCanvas.getContext('2d')!;
  const hairGrad = htctx.createLinearGradient(0, HSIZE, 0, 0);
  hairGrad.addColorStop(0.0, '#363918'); // Rich dark olive-brown roots at v=0
  hairGrad.addColorStop(0.45, '#595c24'); // Rich warm moss-olive mid-shaft
  hairGrad.addColorStop(1.0, '#85823d'); // Sunlit warm olive-gold tips at v=1
  htctx.fillStyle = hairGrad;
  htctx.fillRect(0, 0, HSIZE, HSIZE);

  const hairSidesCanvas = document.createElement('canvas');
  hairSidesCanvas.width = HSIZE;
  hairSidesCanvas.height = HSIZE;
  const hsctx = hairSidesCanvas.getContext('2d')!;
  const sidesGrad = hsctx.createLinearGradient(0, HSIZE, 0, 0);
  sidesGrad.addColorStop(0.0, '#494924'); // Soft lighter faded lower edge blending toward scalp
  sidesGrad.addColorStop(0.35, '#3d3e1c'); // Rich tapered dark olive-brown mid fade & eyebrows
  sidesGrad.addColorStop(1.0, '#545526'); // Seamless blend into top quiff roots!
  hsctx.fillStyle = sidesGrad;
  hsctx.fillRect(0, 0, HSIZE, HSIZE);

  const hHeight = new Float32Array(256 * 256);
  for (let x = 0; x < 256; x++) {
    const strand = Math.sin(x * 0.92) * 0.30 + (rand() - 0.5) * 0.32;
    for (let y = 0; y < 256; y++) {
      hHeight[y * 256 + x] = 0.5 + strand + Math.sin(y * 0.06 + x * 0.12) * 0.05;
    }
  }
  const hairNormalCanvas = heightToNormalCanvas(hHeight, 256, HSIZE, 1.85);

  for (let i = 0; i < 920; i++) {
    const x = rand() * HSIZE;
    const w = 1.0 + rand() * 2.4;
    const tone = rand();
    htctx.fillStyle =
      tone > 0.68
        ? 'rgba(164, 158, 78, 0.30)'
        : tone > 0.30
          ? 'rgba(72, 74, 28, 0.36)'
          : 'rgba(28, 30, 12, 0.42)';
    htctx.fillRect(x, 0, w, HSIZE);

    hsctx.fillStyle =
      tone > 0.64
        ? 'rgba(104, 102, 46, 0.24)'
        : 'rgba(26, 28, 12, 0.34)';
    hsctx.fillRect(x, 0, w, HSIZE);
  }

  const eyeMap = finalizeTexture(eyeCanvas, true, anisotropy, 1, 1, reg);
  eyeMap.wrapS = THREE.ClampToEdgeWrapping;
  eyeMap.wrapT = THREE.ClampToEdgeWrapping;

  const hairTopMap = finalizeTexture(hairTopCanvas, true, anisotropy, 2, 1, reg);
  hairTopMap.wrapT = THREE.ClampToEdgeWrapping;

  const hairSidesMap = finalizeTexture(hairSidesCanvas, true, anisotropy, 3, 1, reg);
  hairSidesMap.wrapT = THREE.ClampToEdgeWrapping;

  return {
    eyeMap,
    hairTopMap,
    hairSidesMap,
    hairNormalMap: finalizeTexture(hairNormalCanvas, false, anisotropy, 2, 2, reg),
  };
}

/**
 * Builds the complete library of MeshPhysicalMaterial PBR surfaces
 * taking full advantage of Three.js r187 EON diffuse BRDF & clearcoat/sheen.
 */
export function createCharacterMaterials(maxAnisotropy = 4): PBRMaterialLibrary {
  const textures: THREE.Texture[] = [];

  const skin = bakeSkinPBR(maxAnisotropy, textures);
  // EXACT REFERENCE RE-SKIN: Deep Tactical Forest/Pine Green Jacket, Chest Webbing, Trousers & Gloves!
  const jacketCordura = bakeCorduraPBR('#182a15', '#081007', maxAnisotropy, textures, 311);
  const chestWebbingPBR = bakeCorduraPBR('#1d3119', '#091208', maxAnisotropy, textures, 315);
  const trouserCordura = bakeCorduraPBR('#132110', '#070d06', maxAnisotropy, textures, 319);
  const gloveMicro = bakeGloveMicroTextilesPBR(maxAnisotropy, textures);
  const turtleneckPBR = bakeRibbedKnitPBR(maxAnisotropy, textures);
  const hexVelcro = bakeHoneycombAndVelcroPBR(maxAnisotropy, textures);
  const metal = bakeBrushedMetalPBR(maxAnisotropy, textures);
  const leather = bakePebbledLeatherPBR(maxAnisotropy, textures);
  const eyeHair = bakeEyeAndHairPBR(maxAnisotropy, textures);

  const skinHead = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Skin_Head',
    color: 0xffffff,
    map: skin.headMap,
    normalMap: skin.skinNormal,
    normalScale: new THREE.Vector2(0.22, 0.22),
    roughnessMap: skin.headRough,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 0.0,
    sheen: 0.35,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color('#d97d64'),
  });

  const skinLimbs = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Skin_Limbs',
    color: 0xffffff,
    map: skin.limbMap,
    normalMap: skin.skinNormal,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.72,
    metalness: 0.0,
    sheen: 0.30,
    sheenRoughness: 0.84,
    sheenColor: new THREE.Color('#d97d64'),
  });

  const fingernails = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Fingernails',
    color: new THREE.Color('#deb09c'),
    roughness: 0.44,
    metalness: 0.0,
    clearcoat: 0.14,
    clearcoatRoughness: 0.38,
  });

  const eyeIris = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Eye_Iris',
    color: 0xffffff,
    map: eyeHair.eyeMap,
    roughness: 0.16,
    metalness: 0.0,
  });

  const eyeCornea = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Eye_Cornea',
    color: 0xffffff,
    roughness: 0.03,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });

  const hairTop = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Hair_Quiff',
    color: 0xffffff,
    map: eyeHair.hairTopMap,
    normalMap: eyeHair.hairNormalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughness: 0.58,
    metalness: 0.02,
    sheen: 0.36,
    sheenRoughness: 0.54,
    sheenColor: new THREE.Color('#a8a35c'),
  });

  const hairSides = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Hair_Undercut',
    color: 0xffffff,
    map: eyeHair.hairSidesMap,
    normalMap: eyeHair.hairNormalMap,
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughness: 0.68,
    metalness: 0.01,
    sheen: 0.24,
    sheenRoughness: 0.64,
    sheenColor: new THREE.Color('#6f6e36'),
  });

  const turtleneck = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Turtleneck_Knit',
    color: 0xffffff,
    map: turtleneckPBR.map,
    normalMap: turtleneckPBR.normalMap,
    normalScale: new THREE.Vector2(1.45, 1.45),
    roughness: 0.94,
    metalness: 0.0,
    sheen: 0.55,
    sheenRoughness: 0.88,
    sheenColor: new THREE.Color('#34502e'),
  });

  // True matte heavy Ripstop/Cordura cloth: roughness 1.0 * roughnessMap [0.88..0.97] -> ZERO plastic shine!
  const oliveCordura = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Olive_Cordura_Jacket',
    color: 0xffffff,
    map: jacketCordura.map,
    normalMap: jacketCordura.normalMap,
    normalScale: new THREE.Vector2(1.38, 1.38),
    roughnessMap: jacketCordura.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    sheen: 0.60,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color('#47593e'),
  });

  const forestWebbing = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Forest_Chest_Webbing',
    color: 0xffffff,
    map: chestWebbingPBR.map,
    normalMap: chestWebbingPBR.normalMap,
    normalScale: new THREE.Vector2(1.70, 1.70),
    roughnessMap: chestWebbingPBR.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    sheen: 0.55,
    sheenRoughness: 0.86,
    sheenColor: new THREE.Color('#4b6242'),
  });

  const oliveTrousers = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Olive_Cargo_Trousers',
    color: 0xffffff,
    map: trouserCordura.map,
    normalMap: trouserCordura.normalMap,
    normalScale: new THREE.Vector2(1.34, 1.34),
    roughnessMap: trouserCordura.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    sheen: 0.58,
    sheenRoughness: 0.86,
    sheenColor: new THREE.Color('#425438'),
  });

  // High-frequency breathable micro-fabric tactical glove shell & finger cuffs (ultra-matte, ZERO plastic sheen)
  const gloveFabric = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Combat_Gloves',
    color: 0xffffff,
    map: gloveMicro.dorsumMap,
    normalMap: gloveMicro.dorsumNormal,
    normalScale: new THREE.Vector2(2.15, 2.15),
    roughnessMap: gloveMicro.dorsumRough,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 0.0,
    sheen: 0.54,
    sheenRoughness: 0.90,
    sheenColor: new THREE.Color('#3b5134'),
  });

  // High-frequency Clarino micro-suede + diamond micro-knurl for glove palm grip pads & reinforced knuckle plates
  const glovePalmArmor = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Glove_Palm_Plates',
    color: 0xffffff,
    map: gloveMicro.palmMap,
    normalMap: gloveMicro.palmNormal,
    normalScale: new THREE.Vector2(2.35, 2.35),
    roughnessMap: gloveMicro.palmRough,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 0.0,
    sheen: 0.40,
    sheenRoughness: 0.92,
    sheenColor: new THREE.Color('#2d362d'),
  });

  // Matte dark tactical honeycomb rubberized shoulder/elbow pads (ZERO shiny silver-grey plastic!)
  const honeycombRubber = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Honeycomb_Shoulder_Armor',
    color: new THREE.Color('#1d241e'),
    map: hexVelcro.hexMap,
    normalMap: hexVelcro.hexNormal,
    normalScale: new THREE.Vector2(1.75, 1.75),
    roughness: 0.78,
    metalness: 0.04,
    clearcoat: 0.04,
    clearcoatRoughness: 0.72,
  });

  const velcroPatch = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Velcro_Patch',
    color: new THREE.Color('#121514'),
    normalMap: hexVelcro.velcroNormal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughness: 0.94,
    metalness: 0.0,
  });

  const gunmetal = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Brushed_Gunmetal',
    color: new THREE.Color('#363c42'),
    normalMap: metal.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: metal.roughnessMap,
    roughness: 0.28,
    metalness: 0.92,
  });

  const silverHardware = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Silver_SpeedLace',
    color: new THREE.Color('#c8d0d8'),
    normalMap: metal.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: metal.roughnessMap,
    roughness: 0.22,
    metalness: 0.96,
  });

  const blackWebbing = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Black_Tactical_Webbing',
    color: new THREE.Color('#131617'),
    normalMap: jacketCordura.normalMap,
    normalScale: new THREE.Vector2(1.25, 1.25),
    roughness: 0.80,
    metalness: 0.04,
  });

  const bootLeather = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Pebbled_Boot_Leather',
    color: 0xffffff,
    map: leather.map,
    normalMap: leather.normalMap,
    normalScale: new THREE.Vector2(1.42, 1.42),
    roughnessMap: leather.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.52,
  });

  const bootRubber = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Vibram_Lug_Rubber',
    color: new THREE.Color('#0c0e10'),
    normalMap: leather.rubberNormal,
    normalScale: new THREE.Vector2(1.05, 1.05),
    roughness: 0.90,
    metalness: 0.0,
  });

  const stitchTrim = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Raised_Stitch_Piping',
    color: new THREE.Color('#2c4428'),
    roughness: 0.84,
    metalness: 0.0,
  });

  const allMaterials: THREE.Material[] = [
    skinHead,
    skinLimbs,
    fingernails,
    eyeIris,
    eyeCornea,
    hairTop,
    hairSides,
    turtleneck,
    oliveCordura,
    forestWebbing,
    oliveTrousers,
    gloveFabric,
    glovePalmArmor,
    honeycombRubber,
    velcroPatch,
    gunmetal,
    silverHardware,
    blackWebbing,
    bootLeather,
    bootRubber,
    stitchTrim,
  ];

  return {
    skinHead,
    skinLimbs,
    fingernails,
    eyeIris,
    eyeCornea,
    hairTop,
    hairSides,
    turtleneck,
    oliveCordura,
    forestWebbing,
    oliveTrousers,
    gloveFabric,
    glovePalmArmor,
    honeycombRubber,
    velcroPatch,
    gunmetal,
    silverHardware,
    blackWebbing,
    bootLeather,
    bootRubber,
    stitchTrim,
    textures,
    dispose: () => {
      for (const m of allMaterials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
