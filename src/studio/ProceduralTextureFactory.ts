import * as THREE from 'three';
import type { LightingPresetId, PackedORMTextureSet } from '../types/studioTypes';

const DEFAULT_ANISOTROPY = 8;

function fract(x: number): number {
  return x - Math.floor(x);
}

function hash2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return fract(s);
}

function valueNoise2D(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm2D(u: number, v: number, baseFreq: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(u * freq, v * freq, freq, seed + i * 19);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / Math.max(norm, 1e-6);
}

function voronoi2D(u: number, v: number, cells: number, seed: number): { f1: number; f2: number } {
  const gx = u * cells;
  const gy = v * cells;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  let f1 = 10;
  let f2 = 10;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = (((ix + dx) % cells) + cells) % cells;
      const cy = (((iy + dy) % cells) + cells) % cells;
      const rx = dx + hash2(cx, cy, seed) - fx;
      const ry = dy + hash2(cx, cy, seed + 43) - fy;
      const d = Math.hypot(rx, ry);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2 };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampByte(v: number): number {
  const n = Math.round(v);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create 2D canvas context for procedural texture.');
  }
  return { canvas, ctx };
}

function finalizeCanvasTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  repeatX = 1,
  repeatY = 1,
  wrapS: THREE.Wrapping = THREE.RepeatWrapping,
  wrapT: THREE.Wrapping = THREE.RepeatWrapping
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = colorSpace;
  tex.channel = 0;
  tex.wrapS = wrapS;
  tex.wrapT = wrapT;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = DEFAULT_ANISOTROPY;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildNormalFromHeight(
  height: Float32Array,
  size: number,
  strength: number
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(size);
  const img = ctx.createImageData(size, size);
  const out = img.data;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const hL = height[y * size + xm];
      const hR = height[y * size + xp];
      const hD = height[ym * size + x];
      const hU = height[yp * size + x];
      const dx = (hL - hR) * strength;
      const dy = (hD - hU) * strength;
      const invLen = 1 / Math.hypot(dx, dy, 1);
      const idx = (y * size + x) * 4;
      out[idx] = clampByte((dx * invLen * 0.5 + 0.5) * 255);
      out[idx + 1] = clampByte((dy * invLen * 0.5 + 0.5) * 255);
      out[idx + 2] = clampByte((invLen * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export class ProceduralTextureFactory {
  private readonly createdTextures: THREE.Texture[] = [];

  private track<T extends THREE.Texture>(tex: T): T {
    this.createdTextures.push(tex);
    return tex;
  }

  /**
   * 768x768 Anatomical Portrait Skin PBR set:
   * - Clean body/forearm skin zone on u in [0.00..0.26] & [0.74..1.00]
   * - Sub-millimeter aligned tactical operator face portrait on u in [0.28..0.72],
   *   linearly mapped to SK_Head's face vertical band (y=1.618..1.805 -> v_mesh=0.28..0.86, canvas v=0.14..0.72):
   *   - Classic 3-zone human complexion (warm forehead, rosier cheeks/nose/ears, cooler jaw/chin)
   *   - Natural 5-o'clock beard/stubble gradient across jaw, chin, mustache & sideburns
   *   - Soft orbital crease, upper/lower lashline, feathered brow roots, nasal shadow & nostrils
   *   - Natural masculine vermilion lips with Cupid's bow, crisp mouth parting crease & labiomental shadow
   * - Regional ORM: R=AO, G=Roughness (0.34 lips, 0.40 T-zone, 0.58 cheeks, 0.70 stubble), B=Metalness (0)
   */
  public createSkinTextureSet(size = 768): PackedORMTextureSet {
    const { canvas: albCanvas, ctx: albCtx } = createCanvas(size);
    const { canvas: ormCanvas, ctx: ormCtx } = createCanvas(size);
    const albImg = albCtx.createImageData(size, size);
    const ormImg = ormCtx.createImageData(size, size);
    const alb = albImg.data;
    const orm = ormImg.data;
    const height = new Float32Array(size * size);

    // Exact linear world-height helper matching headSculpt.ts (y = 1.618..1.805 -> vc = 0.72..0.14)
    const yToVc = (worldY: number) => 1.0 - (0.28 + ((worldY - 1.618) / 0.187) * 0.58);
    const vcHairline = yToVc(1.775); // ~0.233
    const vcBrow = yToVc(1.7435);    // ~0.331 (aligned 1-to-1 behind 3D eyebrows!)
    const vcEye = yToVc(1.724);      // ~0.391
    const vcCheek = yToVc(1.698);    // ~0.472
    const vcNoseTip = yToVc(1.685);  // ~0.512
    const vcNostril = yToVc(1.678);  // ~0.534
    const vcLipUp = yToVc(1.658);    // ~0.596
    const vcMouth = yToVc(1.6515);   // ~0.616
    const vcLipLo = yToVc(1.645);    // ~0.636
    const vcChinFold = yToVc(1.635); // ~0.667
    const vcChin = yToVc(1.622);     // ~0.708

    for (let y = 0; y < size; y++) {
      const v = y / size; // canvas v: 0 = crown top, 1 = neck base
      for (let x = 0; x < size; x++) {
        const u = x / size; // 0.5 = center front face
        const idx = (y * size + x) * 4;
        const du = u - 0.5;
        const absDu = Math.abs(du);

        // Micro-pores + organic melanin/hemoglobin vascular mottling
        const poreCell = voronoi2D(u, v, 56, 11);
        const porePit = Math.pow(clamp01(1 - poreCell.f1 * 3.0), 2.4);
        const ridge = clamp01((poreCell.f2 - poreCell.f1) * 2.8);
        const melanin = fbm2D(u, v, 6, 3, 71);
        const hemoglobin = fbm2D(u, v, 10, 3, 103);
        const microTone = fbm2D(u, v, 24, 2, 137);

        // Warm realistic Caucasian/Mediterranean tactical complexion base
        let r = 214 + (hemoglobin - 0.5) * 20 - (melanin - 0.5) * 14 + (microTone - 0.5) * 7;
        let g = 166 + (hemoglobin - 0.5) * 7 - (melanin - 0.5) * 15 + (microTone - 0.5) * 5;
        let b = 139 - (hemoglobin - 0.5) * 5 - (melanin - 0.5) * 16 + (microTone - 0.5) * 4;

        let ao = 1.0 - porePit * 0.14;
        let rough = 0.56 + porePit * 0.06;
        let hVal = 0.55 - porePit * 0.22 + ridge * 0.08;

        // Anatomical face painting strictly inside front/side head UV band (absDu < 0.24)
        // Body forearms/fingers sample u in [0.04..0.22] (absDu > 0.28) so they remain 100% pure skin!
        if (absDu < 0.24 && v > 0.10 && v < 0.88) {
          // 1. Portrait 3-zone color temperature:
          //    - Forehead slightly warmer golden-tan
          const foreheadZone = Math.exp(-Math.pow(du / 0.12, 2) - Math.pow((v - 0.26) / 0.08, 2));
          r += foreheadZone * 6;
          g += foreheadZone * 4;
          b -= foreheadZone * 4;

          //    - Mid-face (cheeks, nose bridge/tip) subtle warm hemoglobin blush
          const cheekWarm =
            Math.exp(-Math.pow((absDu - 0.085) / 0.055, 2) - Math.pow((v - vcCheek) / 0.065, 2)) +
            Math.exp(-Math.pow(du / 0.025, 2) - Math.pow((v - vcNoseTip) / 0.045, 2)) * 0.85;
          r += cheekWarm * 11;
          g -= cheekWarm * 3;
          b -= cheekWarm * 5;

          //    - Subtle forehead horizontal expression micro-lines
          const fhLineBand =
            Math.exp(-Math.pow(du / 0.075, 2) - Math.pow((v - 0.255) / 0.036, 2));
          const fhWave = Math.max(0, Math.sin((v - 0.22) * Math.PI * 52));
          const fhCrease = fhLineBand * fhWave * 0.35;
          r *= 1 - fhCrease * 0.08;
          g *= 1 - fhCrease * 0.10;
          b *= 1 - fhCrease * 0.10;
          hVal -= fhCrease * 0.24;

          // 2. Soft upper-hairline & temple sideburn hair-root transition
          const hairlineV = vcHairline + Math.pow(absDu / 0.14, 2) * 0.032;
          const scalpFade = clamp01((hairlineV - v) / 0.028);
          const sideburn =
            Math.exp(-Math.pow((absDu - 0.180) / 0.028, 2)) *
            clamp01((v - 0.30) / 0.06) *
            clamp01((0.60 - v) / 0.10);
          const hairRootMask = Math.max(scalpFade * 0.78, sideburn * 0.44);
          if (hairRootMask > 0.01) {
            const follicle = 0.72 + 0.28 * hash2(x, y, 311);
            const hm = hairRootMask * follicle;
            r = r * (1 - hm * 0.56) + 46 * hm * 0.56;
            g = g * (1 - hm * 0.58) + 34 * hm * 0.58;
            b = b * (1 - hm * 0.58) + 26 * hm * 0.58;
            rough = Math.min(0.84, rough + hm * 0.18);
          }

          // 3. Soft feathered masculine eyebrow root shading aligned 1-to-1 behind 3D eyebrows
          //    (zero double-brow offset — acts purely as natural follicle grounding!)
          const browArchV =
            vcBrow -
            0.0055 * Math.exp(-Math.pow((absDu - 0.064) / 0.026, 2)) +
            0.0045 * clamp01((absDu - 0.076) / 0.028);
          const browHoriz =
            clamp01((absDu - 0.016) / 0.012) * clamp01((0.094 - absDu) / 0.022);
          const browThick = 0.0115 * (1 - clamp01((absDu - 0.055) / 0.048) * 0.45);
          const browVert = Math.exp(-Math.pow((v - browArchV) / Math.max(0.0038, browThick), 2));
          const browGrain = 0.70 + 0.30 * fbm2D(u * 20, v * 8, 4, 2, 331);
          const browMask = browHoriz * browVert * browGrain;
          if (browMask > 0.02) {
            r = r * (1 - browMask * 0.48) + 48 * browMask * 0.48;
            g = g * (1 - browMask * 0.50) + 36 * browMask * 0.50;
            b = b * (1 - browMask * 0.50) + 28 * browMask * 0.50;
            hVal += browMask * 0.10;
            rough += browMask * 0.14;
          }

          // 4. Soft natural orbital socket shading + crisp tight lashline (zero lower-lid shadow ring!)
          const eyeDu = absDu - 0.056;
          const eyeDv = v - vcEye;
          const orbitAO = Math.exp(
            -(eyeDu * eyeDu) / (0.030 * 0.030) - (eyeDv * eyeDv) / (0.032 * 0.032)
          );
          r *= 1 - orbitAO * 0.12;
          g *= 1 - orbitAO * 0.16;
          b *= 1 - orbitAO * 0.17;
          ao *= 1 - orbitAO * 0.18;

          // Subtle upper-lid crease + tight dark lashline confined strictly to the lid margin
          const lidCrease =
            Math.exp(-Math.pow(eyeDu / 0.021, 2)) *
            Math.exp(-Math.pow((eyeDv + 0.017) / 0.0042, 2));
          const upperLash =
            Math.exp(-Math.pow(eyeDu / 0.020, 2)) *
            Math.exp(-Math.pow((eyeDv + 0.0055) / 0.0026, 2));
          const lowerLash =
            Math.exp(-Math.pow(eyeDu / 0.018, 2)) *
            Math.exp(-Math.pow((eyeDv - 0.0058) / 0.0020, 2)) * 0.28;
          const lashDark = clamp01(upperLash * 0.68 + lowerLash + lidCrease * 0.24);
          r *= 1 - lashDark * 0.60;
          g *= 1 - lashDark * 0.64;
          b *= 1 - lashDark * 0.66;

          // 5. Nose bridge subtle specular T-zone + sidewalls + dark recessed nostrils
          const noseBridgeHL =
            Math.exp(-Math.pow(du / 0.011, 2)) *
            Math.exp(-Math.pow((v - (vcEye + vcNoseTip) * 0.5) / 0.068, 2));
          r += noseBridgeHL * 7;
          g += noseBridgeHL * 5;
          b += noseBridgeHL * 4;
          rough -= noseBridgeHL * 0.16;

          const noseSideAO =
            Math.exp(-Math.pow((absDu - 0.024) / 0.010, 2)) *
            Math.exp(-Math.pow((v - 0.485) / 0.052, 2));
          r *= 1 - noseSideAO * 0.11;
          g *= 1 - noseSideAO * 0.14;
          b *= 1 - noseSideAO * 0.15;

          const alarCrease =
            Math.exp(-Math.pow((absDu - 0.024) / 0.006, 2)) *
            Math.exp(-Math.pow((v - vcNostril) / 0.012, 2));
          const nostrilHole =
            Math.exp(-Math.pow((absDu - 0.0125) / 0.0052, 2)) *
            Math.exp(-Math.pow((v - (vcNostril + 0.004)) / 0.0068, 2));
          const noseDark = clamp01(nostrilHole * 0.88 + alarCrease * 0.34);
          r *= 1 - noseDark * 0.78;
          g *= 1 - noseDark * 0.82;
          b *= 1 - noseDark * 0.84;
          ao *= 1 - noseDark * 0.55;
          hVal -= nostrilHole * 0.45;

          // 6. Natural masculine lips (Cupid's bow, crisp warm rose-terracotta vermilion, dark mouth crease)
          const mouthW = clamp01(1 - Math.pow(absDu / 0.040, 2.2));
          const cupidLift =
            0.0036 * Math.exp(-Math.pow((absDu - 0.0085) / 0.0065, 2)) -
            0.0028 * Math.exp(-Math.pow(du / 0.0052, 2));
          const upperLipV = vcLipUp - cupidLift;
          const lowerLipV = vcLipLo;
          const upperLipMask =
            mouthW * Math.exp(-Math.pow((v - upperLipV) / 0.0110, 2));
          const lowerLipMask =
            clamp01(1 - Math.pow(absDu / 0.036, 2.2)) *
            Math.exp(-Math.pow((v - lowerLipV) / 0.0140, 2));
          const lipMask = clamp01(Math.max(upperLipMask, lowerLipMask) * 1.18);

          if (lipMask > 0.02) {
            // Subtle vertical lip micro-lines & natural masculine lip shade
            const lipGroove = Math.sin(u * Math.PI * 260 + fbm2D(u, v, 14, 2, 409) * 4) * 0.5 + 0.5;
            const lipR = 168 + lipGroove * 10;
            const lipG = 104 + lipGroove * 7;
            const lipB = 96 + lipGroove * 6;
            r = r * (1 - lipMask * 0.80) + lipR * lipMask * 0.80;
            g = g * (1 - lipMask * 0.82) + lipG * lipMask * 0.82;
            b = b * (1 - lipMask * 0.82) + lipB * lipMask * 0.82;
            rough = rough * (1 - lipMask * 0.5) + 0.34 * lipMask * 0.5;
            hVal += (lipGroove - 0.5) * 0.08 * lipMask;
          }

          // Crisp mouth parting line + tucked oral commissure corners
          const mouthCurveV = vcMouth + Math.pow(absDu / 0.041, 2) * 0.0032;
          const mouthPart =
            clamp01(1 - Math.pow(absDu / 0.041, 2.6)) *
            Math.exp(-Math.pow((v - mouthCurveV) / 0.0038, 2));
          const mouthCorner =
            Math.exp(-Math.pow((absDu - 0.039) / 0.0065, 2)) *
            Math.exp(-Math.pow((v - (vcMouth + 0.0025)) / 0.0075, 2));
          const mouthDark = clamp01(mouthPart * 0.88 + mouthCorner * 0.55);
          r *= 1 - mouthDark * 0.70;
          g *= 1 - mouthDark * 0.76;
          b *= 1 - mouthDark * 0.78;
          ao *= 1 - mouthDark * 0.48;
          hVal -= mouthPart * 0.35;

          // Subtle philtrum & labiomental chin fold shadows
          const philtrum =
            Math.exp(-Math.pow(du / 0.007, 2)) *
            Math.exp(-Math.pow((v - (vcNostril + vcLipUp) * 0.5) / 0.018, 2));
          const chinFold =
            Math.exp(-Math.pow(du / 0.028, 2)) *
            Math.exp(-Math.pow((v - vcChinFold) / 0.011, 2));
          const cheekHollow =
            Math.exp(-Math.pow((absDu - 0.095) / 0.036, 2)) *
            Math.exp(-Math.pow((v - 0.585) / 0.055, 2));
          const contourAO = philtrum * 0.14 + chinFold * 0.22 + cheekHollow * 0.13;
          r *= 1 - contourAO;
          g *= 1 - contourAO * 1.08;
          b *= 1 - contourAO * 1.12;

          // 7. Realistic 5-o'clock tactical stubble / short beard shadow on jaw, chin & upper lip
          //    Carves cleanly around the vermilion lips and cheekbones!
          const beardJaw =
            clamp01((v - (vcMouth - 0.045)) / 0.075) *
            clamp01((0.79 - v) / 0.065) *
            clamp01((0.185 - absDu) / 0.045);
          const mustache =
            clamp01((v - (vcNostril + 0.006)) / 0.014) *
            clamp01((vcLipUp - 0.005 - v) / 0.012) *
            clamp01((0.056 - absDu) / 0.016);
          const goatee =
            Math.exp(-Math.pow(du / 0.048, 2)) *
            clamp01((v - (vcLipLo + 0.010)) / 0.016) *
            clamp01((vcChin + 0.045 - v) / 0.035);
          const stubbleArea = clamp01(Math.max(beardJaw * 0.72, mustache * 0.85, goatee * 0.92)) * (1 - lipMask * 0.95);
          if (stubbleArea > 0.02) {
            const fineDot = hash2(Math.floor(x * 0.85), Math.floor(y * 0.85), 521);
            const follicleGrain = 0.55 + (fineDot > 0.42 ? 0.45 : 0.0);
            const st = stubbleArea * follicleGrain;
            // Cool olive-charcoal 5-o'clock shadow tint
            r = r * (1 - st * 0.26) + 52 * st * 0.26;
            g = g * (1 - st * 0.24) + 46 * st * 0.24;
            b = b * (1 - st * 0.21) + 42 * st * 0.21;
            rough = Math.min(0.74, rough + st * 0.16);
            hVal += (fineDot - 0.5) * 0.12 * stubbleArea;
          }

          // 8. Regional T-zone glossiness (forehead + nose bridge slightly oilier ~0.40 vs matte cheeks ~0.58)
          const tZone =
            Math.exp(-Math.pow(du / 0.065, 2) - Math.pow((v - 0.34) / 0.16, 2));
          rough = clamp01(rough - tZone * 0.15);
        }

        // Subtle pore micro-shading across all skin
        const poreShade = 1 - porePit * 0.06;
        alb[idx] = clampByte(r * poreShade);
        alb[idx + 1] = clampByte(g * poreShade);
        alb[idx + 2] = clampByte(b * poreShade);
        alb[idx + 3] = 255;

        height[y * size + x] = clamp01(hVal);

        const aoMapped = clamp01(0.72 + ao * 0.28);
        orm[idx] = clampByte(aoMapped * 255);
        orm[idx + 1] = clampByte(clamp01(rough) * 255);
        orm[idx + 2] = 0;
        orm[idx + 3] = 255;
      }
    }

    albCtx.putImageData(albImg, 0, 0);
    ormCtx.putImageData(ormImg, 0, 0);
    const normCanvas = buildNormalFromHeight(height, size, 2.2);

    return {
      albedo: this.track(finalizeCanvasTexture(albCanvas, THREE.SRGBColorSpace, 1, 1)),
      normal: this.track(finalizeCanvasTexture(normCanvas, THREE.NoColorSpace, 1, 1)),
      orm: this.track(finalizeCanvasTexture(ormCanvas, THREE.NoColorSpace, 1, 1)),
    };
  }

  /**
   * 512x512 Cordura 1000D / Ripstop Tactical Fabric:
   * - Interlocking basket weave + 16px ripstop reinforcement grid + fBm macro-folds
   * - Lockstitch seam strips (+12% value, 0.55 cavity AO)
   * - Subtle metallic grommet detail row on UV band for hardware alignment
   */
  public createCorduraTextureSet(
    baseHex = 0x45513c,
    size = 512,
    repeatX = 3,
    repeatY = 3
  ): PackedORMTextureSet {
    // Extract true sRGB 0..255 bytes directly from baseHex (THREE.Color converts to linear!)
    const baseR = (baseHex >> 16) & 0xff;
    const baseG = (baseHex >> 8) & 0xff;
    const baseB = baseHex & 0xff;
    const { canvas: albCanvas, ctx: albCtx } = createCanvas(size);
    const { canvas: ormCanvas, ctx: ormCtx } = createCanvas(size);
    const albImg = albCtx.createImageData(size, size);
    const ormImg = ormCtx.createImageData(size, size);
    const alb = albImg.data;
    const orm = ormImg.data;
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = (y * size + x) * 4;

        // Interlocking 1000D Cordura basket weave (4px warp/weft)
        const wx = Math.floor(x / 2) & 1;
        const wy = Math.floor(y / 2) & 1;
        const warpPhase = Math.sin((x % 4) * (Math.PI / 2));
        const weftPhase = Math.sin((y % 4) * (Math.PI / 2));
        const weaveH = wx === wy ? 0.56 + warpPhase * 0.24 : 0.44 + weftPhase * 0.22;

        // 16px ripstop crosshatch reinforcement threads
        const ripX = x % 16 === 0 || x % 16 === 1 ? 1 : 0;
        const ripY = y % 16 === 0 || y % 16 === 1 ? 1 : 0;
        const ripstop = ripX || ripY ? 1 : 0;

        // fBm macro-folds and tactical wear patina
        const macroFold = fbm2D(u, v, 5, 4, 211);
        const microWear = fbm2D(u, v, 16, 3, 257);

        // Lockstitch twin seam line near v = 0.04 & u = 0.04
        const seamDist = Math.min(Math.abs(y - 20), Math.abs(x - 20));
        const inSeamGroove = seamDist <= 2;
        const isStitchThread =
          (Math.abs(y - 16) <= 1 || Math.abs(y - 24) <= 1) && (x % 12) < 7;

        let valMult = 0.92 + weaveH * 0.14 + (macroFold - 0.5) * 0.14 + (microWear - 0.5) * 0.06;
        if (ripstop) valMult *= 1.05;
        if (inSeamGroove) valMult *= 0.78;
        if (isStitchThread) valMult *= 1.12;

        let ao = clamp01(0.80 + weaveH * 0.20 - (inSeamGroove ? 0.30 : 0));
        if (isStitchThread) ao = 0.65;
        let rough = clamp01(0.84 - ripstop * 0.07 + (1 - weaveH) * 0.10 + (macroFold - 0.5) * 0.06);
        let metal = 0.0;

        // Subtle gunmetal/brass grommet micro-ring accent along top UV hem
        const gx = ((x % 128) - 64) / 10;
        const gy = (y - 492) / 10;
        const gr = Math.hypot(gx, gy);
        let r = baseR * valMult;
        let g = baseG * valMult;
        let b = baseB * valMult;
        let h = weaveH * 0.45 + ripstop * 0.18 + macroFold * 0.32 - (inSeamGroove ? 0.25 : 0) + (isStitchThread ? 0.16 : 0);

        if (gr >= 0.48 && gr <= 0.92) {
          r = 128;
          g = 118;
          b = 98;
          rough = 0.34;
          metal = 0.86;
          ao = 0.88;
          h = 0.82;
        } else if (gr < 0.48) {
          r *= 0.35;
          g *= 0.35;
          b *= 0.35;
          ao = 0.35;
          h = 0.15;
        }

        alb[idx] = clampByte(r);
        alb[idx + 1] = clampByte(g);
        alb[idx + 2] = clampByte(b);
        alb[idx + 3] = 255;

        height[y * size + x] = clamp01(h);

        orm[idx] = clampByte(ao * 255);
        orm[idx + 1] = clampByte(rough * 255);
        orm[idx + 2] = clampByte(metal * 255);
        orm[idx + 3] = 255;
      }
    }

    albCtx.putImageData(albImg, 0, 0);
    ormCtx.putImageData(ormImg, 0, 0);
    const normCanvas = buildNormalFromHeight(height, size, 2.8);

    return {
      albedo: this.track(finalizeCanvasTexture(albCanvas, THREE.SRGBColorSpace, repeatX, repeatY)),
      normal: this.track(finalizeCanvasTexture(normCanvas, THREE.NoColorSpace, repeatX, repeatY)),
      orm: this.track(finalizeCanvasTexture(ormCanvas, THREE.NoColorSpace, repeatX, repeatY)),
    };
  }

  /**
   * 512x512 Tactical Leather & Vulcanized Rubber Trim texture (boots, gloves, belt, knee shells)
   */
  public createLeatherRubberTextureSet(size = 512): PackedORMTextureSet {
    const { canvas: albCanvas, ctx: albCtx } = createCanvas(size);
    const { canvas: ormCanvas, ctx: ormCtx } = createCanvas(size);
    const albImg = albCtx.createImageData(size, size);
    const ormImg = ormCtx.createImageData(size, size);
    const alb = albImg.data;
    const orm = ormImg.data;
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = (y * size + x) * 4;
        const grain = voronoi2D(u, v, 74, 313);
        const pebble = clamp01((grain.f2 - grain.f1) * 2.2);
        const crease = fbm2D(u, v, 10, 4, 349);
        const scuff = fbm2D(u, v, 24, 3, 383);

        const tone = 74 + pebble * 14 + (crease - 0.5) * 14 + (scuff - 0.5) * 10;
        alb[idx] = clampByte(tone * 1.02);
        alb[idx + 1] = clampByte(tone * 1.01);
        alb[idx + 2] = clampByte(tone * 0.99);
        alb[idx + 3] = 255;

        height[y * size + x] = clamp01(0.48 + pebble * 0.18 + (crease - 0.5) * 0.16);

        const ao = clamp01(0.84 + pebble * 0.16);
        const rough = clamp01(0.58 + (1 - pebble) * 0.12 + (scuff - 0.5) * 0.12);
        orm[idx] = clampByte(ao * 255);
        orm[idx + 1] = clampByte(rough * 255);
        orm[idx + 2] = clampByte(0.06 * 255);
        orm[idx + 3] = 255;
      }
    }

    albCtx.putImageData(albImg, 0, 0);
    ormCtx.putImageData(ormImg, 0, 0);
    const normCanvas = buildNormalFromHeight(height, size, 1.15);

    return {
      albedo: this.track(finalizeCanvasTexture(albCanvas, THREE.SRGBColorSpace, 2, 2)),
      normal: this.track(finalizeCanvasTexture(normCanvas, THREE.NoColorSpace, 2, 2)),
      orm: this.track(finalizeCanvasTexture(ormCanvas, THREE.NoColorSpace, 2, 2)),
    };
  }

  /**
   * 512x512 Bead-Blasted Gunmetal & CNC Milling Striations texture
   * Works with vertex COLOR_0.g dihedral curvature edge wear shader injection.
   */
  public createGunmetalTextureSet(size = 512): PackedORMTextureSet {
    const { canvas: albCanvas, ctx: albCtx } = createCanvas(size);
    const { canvas: ormCanvas, ctx: ormCtx } = createCanvas(size);
    const albImg = albCtx.createImageData(size, size);
    const ormImg = ormCtx.createImageData(size, size);
    const alb = albImg.data;
    const orm = ormImg.data;
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = (y * size + x) * 4;

        // Bead-blasted isotropic micro-sparkle + fine horizontal CNC milling striations
        const bead = hash2(x, y, 409) * 0.5 + valueNoise2D(u * 96, v * 96, 96, 431) * 0.5;
        const milling = Math.sin(v * Math.PI * 192 + valueNoise2D(u * 12, v * 12, 12, 461) * 1.4) * 0.5 + 0.5;
        const oilPatina = fbm2D(u, v, 6, 3, 487);

        const baseVal = 66 + (bead - 0.5) * 14 + (milling - 0.5) * 6 + (oilPatina - 0.5) * 12;
        alb[idx] = clampByte(baseVal * 0.96);
        alb[idx + 1] = clampByte(baseVal * 1.00);
        alb[idx + 2] = clampByte(baseVal * 1.08);
        alb[idx + 3] = 255;

        height[y * size + x] = clamp01(0.5 + (bead - 0.5) * 0.24 + (milling - 0.5) * 0.18);

        const ao = clamp01(0.84 + bead * 0.16);
        const rough = clamp01(0.46 + (bead - 0.5) * 0.12 - (oilPatina - 0.5) * 0.10);
        const metal = clamp01(0.86 + (milling - 0.5) * 0.08);

        orm[idx] = clampByte(ao * 255);
        orm[idx + 1] = clampByte(rough * 255);
        orm[idx + 2] = clampByte(metal * 255);
        orm[idx + 3] = 255;
      }
    }

    albCtx.putImageData(albImg, 0, 0);
    ormCtx.putImageData(ormImg, 0, 0);
    const normCanvas = buildNormalFromHeight(height, size, 2.2);

    return {
      albedo: this.track(finalizeCanvasTexture(albCanvas, THREE.SRGBColorSpace, 2, 2)),
      normal: this.track(finalizeCanvasTexture(normCanvas, THREE.NoColorSpace, 2, 2)),
      orm: this.track(finalizeCanvasTexture(ormCanvas, THREE.NoColorSpace, 2, 2)),
    };
  }

  /**
   * 512x512 Hair Alpha Cards:
   * - Tapered individual strands from root (v=0) to feathered tip (v=1)
   * - Alpha encoded in Albedo.a and dedicated alpha map for alphaTest: 0.45
   * - Directional strand flow normal map for anisotropic specular highlight
   */
  public createHairCardTextureSet(size = 512): PackedORMTextureSet {
    const { canvas: albCanvas, ctx: albCtx } = createCanvas(size);
    const { canvas: ormCanvas, ctx: ormCtx } = createCanvas(size);
    const { canvas: alphaCanvas, ctx: alphaCtx } = createCanvas(size);
    const albImg = albCtx.createImageData(size, size);
    const ormImg = ormCtx.createImageData(size, size);
    const alphaImg = alphaCtx.createImageData(size, size);
    const alb = albImg.data;
    const orm = ormImg.data;
    const alp = alphaImg.data;
    const height = new Float32Array(size * size);

    // Pre-generate 44 layered tapered hair strands across U=[0..1]
    const strands: Array<{ u0: number; width: number; tipV: number; shade: number; wave: number; phase: number }> = [];
    for (let i = 0; i < 44; i++) {
      strands.push({
        u0: (i + 0.5) / 44 + (hash2(i, 1, 601) - 0.5) * 0.018,
        width: 0.015 + hash2(i, 2, 607) * 0.018,
        tipV: 0.72 + hash2(i, 3, 613) * 0.27,
        shade: 0.76 + hash2(i, 4, 619) * 0.42,
        wave: (hash2(i, 5, 631) - 0.5) * 0.025,
        phase: hash2(i, 6, 641) * Math.PI * 2,
      });
    }

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = (y * size + x) * 4;

        let coverage = 0;
        let strandHeight = 0;
        let shadeAccum = 0;

        // Edge taper along card borders + smooth top-of-card feather (for v >= 0.38 ribbon zone!)
        const cardEdge = clamp01(Math.min(u, 1 - u) * 5.2);
        const cardTopFade = clamp01((v - 0.38) * 14.0);

        for (let s = 0; s < strands.length; s++) {
          const st = strands[s];
          if (v > st.tipV) continue;
          const vNorm = v / st.tipV;
          const taper = Math.pow(1 - vNorm, 0.58);
          const halfW = st.width * taper;
          if (halfW <= 1e-4) continue;
          const centerU = st.u0 + Math.sin(v * 5.2 + st.phase) * st.wave;
          const dist = Math.abs(u - centerU);
          if (dist < halfW) {
            const prof = Math.cos((dist / halfW) * (Math.PI * 0.5));
            const h = prof * (0.65 + 0.35 * (1 - vNorm));
            if (h > strandHeight) {
              strandHeight = h;
              shadeAccum = st.shade;
            }
            coverage = Math.max(coverage, prof);
          }
        }

        // Dense organic layered hair volume band (canvas v < 0.36 -> WebGL UV v in 0.64..1.00)
        // Uses domain-warped multi-octave anisotropic fBm clumps (ZERO periodic corduroy stripes!)
        const solidScalpZone = v < 0.36;
        const uWarp = u + (fbm2D(u, v, 4, 2, 647) - 0.5) * 0.08;
        const lockMacro = fbm2D(uWarp * 3.0, v * 0.5, 4, 3, 653);
        const lockMid = fbm2D(uWarp * 9.0, v * 1.1, 4, 3, 661);
        const hairMicro = fbm2D(uWarp * 28.0, v * 2.2, 4, 2, 673);
        const organicHair = clamp01(lockMacro * 0.30 + lockMid * 0.42 + hairMicro * 0.28);

        const alphaVal = solidScalpZone ? 1.0 : clamp01(coverage * cardEdge * cardTopFade);
        // Natural rich dark espresso-brown with warm subtle chestnut hair-clump depth
        const rootDarken = 0.74 + 0.26 * clamp01(v * 1.25);
        const effectiveH = solidScalpZone ? organicHair * 0.74 + 0.18 : strandHeight;
        const tone =
          (0.64 + effectiveH * 0.42) * (solidScalpZone ? 0.94 : shadeAccum || 0.90) * rootDarken;
        alb[idx] = clampByte(60 * tone);
        alb[idx + 1] = clampByte(43 * tone);
        alb[idx + 2] = clampByte(32 * tone);
        alb[idx + 3] = clampByte(alphaVal * 255);

        const aByte = clampByte(alphaVal * 255);
        alp[idx] = aByte;
        alp[idx + 1] = aByte;
        alp[idx + 2] = aByte;
        alp[idx + 3] = 255;

        height[y * size + x] = effectiveH;

        const ao = clamp01(0.56 + effectiveH * 0.44);
        const rough = clamp01(0.54 + (1 - effectiveH) * 0.22);
        orm[idx] = clampByte(ao * 255);
        orm[idx + 1] = clampByte(rough * 255);
        orm[idx + 2] = 0;
        orm[idx + 3] = 255;
      }
    }

    albCtx.putImageData(albImg, 0, 0);
    ormCtx.putImageData(ormImg, 0, 0);
    alphaCtx.putImageData(alphaImg, 0, 0);
    const normCanvas = buildNormalFromHeight(height, size, 1.7);

    return {
      albedo: this.track(
        finalizeCanvasTexture(
          albCanvas,
          THREE.SRGBColorSpace,
          1,
          1,
          THREE.RepeatWrapping,
          THREE.ClampToEdgeWrapping
        )
      ),
      normal: this.track(
        finalizeCanvasTexture(
          normCanvas,
          THREE.NoColorSpace,
          1,
          1,
          THREE.RepeatWrapping,
          THREE.ClampToEdgeWrapping
        )
      ),
      orm: this.track(
        finalizeCanvasTexture(
          ormCanvas,
          THREE.NoColorSpace,
          1,
          1,
          THREE.RepeatWrapping,
          THREE.ClampToEdgeWrapping
        )
      ),
      alpha: this.track(
        finalizeCanvasTexture(
          alphaCanvas,
          THREE.NoColorSpace,
          1,
          1,
          THREE.RepeatWrapping,
          THREE.ClampToEdgeWrapping
        )
      ),
    };
  }

  /**
   * 512x512 Procedural Iris + Sclera Eye Texture
   */
  public createEyeTextureSet(size = 512): PackedORMTextureSet {
    const { canvas: albCanvas, ctx: albCtx } = createCanvas(size);
    const { canvas: ormCanvas, ctx: ormCtx } = createCanvas(size);
    const albImg = albCtx.createImageData(size, size);
    const ormImg = ormCtx.createImageData(size, size);
    const alb = albImg.data;
    const orm = ormImg.data;
    const height = new Float32Array(size * size);

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = (y * size + x) * 4;
        const dx = (u - 0.5) * 2;
        const dy = (v - 0.5) * 2;
        const rad = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);

        let r = 236;
        let g = 232;
        let b = 226;
        let rough = 0.08;
        let h = 0.5;

        if (rad < 0.155) {
          // Deep crisp pupil
          r = 8;
          g = 9;
          b = 12;
          rough = 0.02;
          h = 0.34;
        } else if (rad < 0.42) {
          // Detailed hazel-steel iris fibers with dark limbal ring & warm central collarette
          const t = (rad - 0.155) / 0.265;
          const fiber = Math.sin(ang * 44 + fbm2D(u, v, 12, 2, 701) * 5.2) * 0.5 + 0.5;
          const crypt = fbm2D(u, v, 18, 2, 719);
          const limbal = clamp01((t - 0.72) / 0.28);
          const goldRing = Math.exp(-Math.pow((t - 0.20) / 0.13, 2));
          r = (58 + fiber * 34 + crypt * 16 + goldRing * 54) * (1 - limbal * 0.68);
          g = (76 + fiber * 38 + crypt * 14 + goldRing * 38) * (1 - limbal * 0.64);
          b = (74 + fiber * 30 + crypt * 12 - goldRing * 10) * (1 - limbal * 0.58);
          rough = 0.04;
          h = 0.46 + fiber * 0.24;
        } else {
          // Natural off-white sclera with warm corner vascularity (never blinding cartoon white!)
          const edge = clamp01((rad - 0.46) / 0.54);
          const vein = fbm2D(u, v, 14, 3, 733);
          r = 224 - edge * 20 + (vein > 0.68 ? edge * 16 : 0);
          g = 216 - edge * 32 - (vein > 0.68 ? edge * 10 : 0);
          b = 208 - edge * 36 - (vein > 0.68 ? edge * 10 : 0);
          rough = 0.09;
          h = 0.52;
        }

        // Realistic upper-eyelid ambient occlusion cast across the top of the eye!
        const lidShadow = clamp01((-dy - 0.12) / 0.58);
        const shadowMul = 1.0 - lidShadow * 0.42;

        alb[idx] = clampByte(r * shadowMul);
        alb[idx + 1] = clampByte(g * shadowMul);
        alb[idx + 2] = clampByte(b * shadowMul);
        alb[idx + 3] = 255;

        height[y * size + x] = h;
        orm[idx] = clampByte((245 - lidShadow * 80));
        orm[idx + 1] = clampByte(rough * 255);
        orm[idx + 2] = 0;
        orm[idx + 3] = 255;
      }
    }

    albCtx.putImageData(albImg, 0, 0);
    ormCtx.putImageData(ormImg, 0, 0);
    const normCanvas = buildNormalFromHeight(height, size, 1.4);

    return {
      albedo: this.track(finalizeCanvasTexture(albCanvas, THREE.SRGBColorSpace, 1, 1)),
      normal: this.track(finalizeCanvasTexture(normCanvas, THREE.NoColorSpace, 1, 1)),
      orm: this.track(finalizeCanvasTexture(ormCanvas, THREE.NoColorSpace, 1, 1)),
    };
  }

  /**
   * Skin MeshPhysicalMaterial with wrap-diffuse + warm hemoglobin terminator SSS (#d94f30)
   */
  public createSkinMaterial(set: PackedORMTextureSet): THREE.MeshPhysicalMaterial {
    const mat = new THREE.MeshPhysicalMaterial({
      name: 'Mat_Char_Skin',
      map: set.albedo,
      normalMap: set.normal,
      normalScale: new THREE.Vector2(0.24, 0.24),
      aoMap: set.orm,
      aoMapIntensity: 0.72,
      roughnessMap: set.orm,
      roughness: 1.0,
      metalnessMap: set.orm,
      metalness: 0.0,
      sheen: 0.25,
      sheenRoughness: 0.68,
      sheenColor: new THREE.Color(0xf0c9b4),
      clearcoat: 0.08,
      clearcoatRoughness: 0.46,
      vertexColors: true,
    });

    mat.customProgramCacheKey = () => 'vanguard_skin_sss_v1';
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `
        #include <lights_fragment_end>
        {
          vec3 sssTint = vec3(0.851, 0.310, 0.188); // #d94f30 warm hemoglobin scatter
          vec3 viewDir = normalize(vViewPosition);
          float rimNdotV = clamp(1.0 - max(dot(normal, viewDir), 0.0), 0.0, 1.0);
          float wrapGlow = pow(rimNdotV, 2.2) * 0.14;
          vec3 lumaDir = reflectedLight.directDiffuse;
          float lum = dot(lumaDir, vec3(0.299, 0.587, 0.114));
          float terminator = smoothstep(0.02, 0.32, lum) * (1.0 - smoothstep(0.28, 0.78, lum));
          reflectedLight.directDiffuse += sssTint * (terminator * 0.16 + wrapGlow) * diffuseColor.rgb;
        }
        `
      );
    };
    return mat;
  }

  /**
   * Cordura 1000D / Ripstop material supporting vertex COLOR_0 cavity AO & lower-leg mud/dust roughness push
   */
  public createCorduraMaterial(set: PackedORMTextureSet): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      name: 'Mat_Char_Cordura',
      map: set.albedo,
      normalMap: set.normal,
      normalScale: new THREE.Vector2(0.75, 0.75),
      aoMap: set.orm,
      aoMapIntensity: 0.85,
      roughnessMap: set.orm,
      roughness: 1.0,
      metalnessMap: set.orm,
      metalness: 1.0,
      vertexColors: true,
    });

    // When lower-leg dust/mud is baked in COLOR_0 (dustier warmer tint), push effective roughness toward 0.94
    mat.customProgramCacheKey = () => 'vanguard_cordura_dirt_v1';
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `
        #include <roughnessmap_fragment>
        #ifdef USE_COLOR
          float dirtMask = clamp((vColor.r - vColor.b) * 3.2, 0.0, 1.0);
          roughnessFactor = mix(roughnessFactor, 0.94, dirtMask * 0.75);
        #endif
        `
      );
    };
    return mat;
  }

  /**
   * Hair Alpha Cards material with anisotropic specular sheen
   */
  public createHairCardMaterial(set: PackedORMTextureSet): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      name: 'Mat_Char_HairCards',
      map: set.albedo,
      alphaMap: set.alpha,
      alphaTest: 0.42,
      normalMap: set.normal,
      normalScale: new THREE.Vector2(0.32, 0.32),
      aoMap: set.orm,
      aoMapIntensity: 0.74,
      roughnessMap: set.orm,
      roughness: 1.0,
      metalnessMap: set.orm,
      metalness: 0.0,
      anisotropy: 0.28,
      anisotropyRotation: Math.PI * 0.5,
      sheen: 0.24,
      sheenRoughness: 0.56,
      sheenColor: new THREE.Color(0x5a4434),
      side: THREE.DoubleSide,
      depthWrite: true,
    });
  }

  /**
   * Hard-surface firearm metal material reading COLOR_0.g dihedral curvature edge wear:
   * - Roughness drops 0.48 -> 0.18
   * - Metalness rises -> 0.96
   * - Base albedo blends toward bare steel #94a3b8
   */
  public createWeaponMetalMaterial(
    set: PackedORMTextureSet,
    name = 'Mat_Weapon_Metal',
    tintHex = 0xffffff
  ): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      name,
      color: new THREE.Color(tintHex),
      map: set.albedo,
      normalMap: set.normal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      aoMap: set.orm,
      aoMapIntensity: 0.8,
      roughnessMap: set.orm,
      roughness: 1.0,
      metalnessMap: set.orm,
      metalness: 1.0,
      vertexColors: true,
    });

    mat.customProgramCacheKey = () => 'vanguard_weapon_edgewear_v1';
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #ifdef USE_COLOR
          float edgeWear = clamp((vColor.g - vColor.r) * 2.8, 0.0, 1.0);
          float cavAO = clamp(vColor.r, 0.35, 1.0);
          vec3 bareSteel = vec3(0.580, 0.639, 0.722); // #94a3b8
          diffuseColor.rgb *= cavAO;
          diffuseColor.rgb = mix(diffuseColor.rgb, bareSteel, edgeWear * 0.72);
        #endif
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `
        #include <roughnessmap_fragment>
        #ifdef USE_COLOR
          float edgeWearR = clamp((vColor.g - vColor.r) * 2.8, 0.0, 1.0);
          roughnessFactor = mix(clamp(roughnessFactor, 0.32, 0.58), 0.18, edgeWearR);
        #endif
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `
        #include <metalnessmap_fragment>
        #ifdef USE_COLOR
          float edgeWearM = clamp((vColor.g - vColor.r) * 2.8, 0.0, 1.0);
          metalnessFactor = mix(metalnessFactor, 0.96, edgeWearM);
        #endif
        `
      );
    };
    return mat;
  }

  /**
   * Anti-reflective iridescent weapon optic lens material
   */
  public createOpticGlassMaterial(name = 'Mat_Weapon_OpticGlass'): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      name,
      color: new THREE.Color(0x0c1a24),
      roughness: 0.05,
      metalness: 0.12,
      iridescence: 1.0,
      iridescenceIOR: 1.38,
      iridescenceThicknessRange: [180, 520],
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.86,
      envMapIntensity: 1.8,
    });
  }

  public dispose(): void {
    for (const tex of this.createdTextures) {
      tex.dispose();
    }
    this.createdTextures.length = 0;
  }
}

/**
 * Bake a per-environment PMREM IBL cubemap purely procedurally and dispose PMREMGenerator immediately.
 */
export function bakeEnvironmentPMREM(
  renderer: THREE.WebGLRenderer,
  presetId: LightingPresetId
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const roomGeo = new THREE.BoxGeometry(16, 10, 16);

  const configs: Record<
    LightingPresetId,
    {
      bg: number;
      ceiling: number;
      key: number;
      keyPos: [number, number, number];
      keyScale: [number, number, number];
      fill: number;
      fillPos: [number, number, number];
      rim: number;
      rimPos: [number, number, number];
      floor: number;
    }
  > = {
    studio_soft: {
      bg: 0x3a404b,
      ceiling: 0xd8e2f0,
      key: 0xfff4e6,
      keyPos: [4.2, 3.4, 4.5],
      keyScale: [3.2, 2.2, 0.1],
      fill: 0x9ec0e8,
      fillPos: [-4.8, 2.5, 2.6],
      rim: 0xdbe9ff,
      rimPos: [0.0, 3.5, -5.2],
      floor: 0x262a32,
    },
    harsh_sunlight: {
      bg: 0x6280a6,
      ceiling: 0xa4c6eb,
      key: 0xfff6dc,
      keyPos: [5.4, 4.6, 3.8],
      keyScale: [1.8, 1.8, 0.1],
      fill: 0x86b3e0,
      fillPos: [-5.2, 2.2, 1.8],
      rim: 0xffe4b8,
      rimPos: [-1.5, 2.8, -5.0],
      floor: 0x685b48,
    },
    night_operation: {
      bg: 0x0a111d,
      ceiling: 0x16243a,
      key: 0x4f78b4,
      keyPos: [-3.8, 4.2, -3.5],
      keyScale: [2.8, 1.8, 0.1],
      fill: 0x274066,
      fillPos: [4.4, 2.0, 3.2],
      rim: 0x86c5f4,
      rimPos: [0.6, 3.4, -4.8],
      floor: 0x0c1118,
    },
    indoor_warehouse: {
      bg: 0x2b2926,
      ceiling: 0x6b6052,
      key: 0xffd79e,
      keyPos: [2.2, 4.4, 2.8],
      keyScale: [4.4, 1.2, 0.1],
      fill: 0x8a95a6,
      fillPos: [-4.5, 2.8, 2.0],
      rim: 0xffe3b3,
      rimPos: [-2.4, 4.2, -4.2],
      floor: 0x2b2824,
    },
  };

  const cfg = configs[presetId];
  envScene.background = new THREE.Color(cfg.bg);

  const shellMat = new THREE.MeshBasicMaterial({
    color: cfg.bg,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(roomGeo, shellMat);
  envScene.add(shell);

  const panelGeo = new THREE.PlaneGeometry(1, 1);
  const makePanel = (color: number, pos: [number, number, number], scale: [number, number, number]) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(panelGeo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.lookAt(0, 1.2, 0);
    envScene.add(mesh);
    return mat;
  };

  const mats: THREE.Material[] = [shellMat];
  mats.push(makePanel(cfg.key, cfg.keyPos, cfg.keyScale));
  mats.push(makePanel(cfg.fill, cfg.fillPos, [3.6, 2.4, 0.1]));
  mats.push(makePanel(cfg.rim, cfg.rimPos, [4.2, 1.8, 0.1]));

  const ceilMat = new THREE.MeshBasicMaterial({ color: cfg.ceiling, side: THREE.DoubleSide });
  const ceilMesh = new THREE.Mesh(panelGeo, ceilMat);
  ceilMesh.position.set(0, 4.9, 0);
  ceilMesh.rotation.x = Math.PI * 0.5;
  ceilMesh.scale.set(9, 9, 1);
  envScene.add(ceilMesh);
  mats.push(ceilMat);

  const floorMat = new THREE.MeshBasicMaterial({ color: cfg.floor, side: THREE.DoubleSide });
  const floorMesh = new THREE.Mesh(panelGeo, floorMat);
  floorMesh.position.set(0, -1.2, 0);
  floorMesh.rotation.x = -Math.PI * 0.5;
  floorMesh.scale.set(14, 14, 1);
  envScene.add(floorMesh);
  mats.push(floorMat);

  const rt = pmrem.fromScene(envScene, 0.04);
  const envTexture = rt.texture;

  // Immediate disposal of generator and temporary scene geometry/materials
  pmrem.dispose();
  roomGeo.dispose();
  panelGeo.dispose();
  for (const m of mats) m.dispose();

  return envTexture;
}
