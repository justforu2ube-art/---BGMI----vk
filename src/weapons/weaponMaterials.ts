import * as THREE from 'three';

export interface WeaponMaterialLibrary {
  anodizedAluminum: THREE.MeshPhysicalMaterial;
  gunmetalSteel: THREE.MeshPhysicalMaterial;
  bluedSteel: THREE.MeshPhysicalMaterial;
  chromeSteel: THREE.MeshPhysicalMaterial;
  tacticalPolymer: THREE.MeshPhysicalMaterial;
  stippledGrip: THREE.MeshPhysicalMaterial;
  rubberPad: THREE.MeshStandardMaterial;
  laminatedWood: THREE.MeshPhysicalMaterial;
  bakeliteOrange: THREE.MeshPhysicalMaterial;
  sniperChassisOD: THREE.MeshPhysicalMaterial;
  tanRailAccent: THREE.MeshStandardMaterial;
  cartridgeBrass: THREE.MeshPhysicalMaterial;
  bulletCopper: THREE.MeshPhysicalMaterial;
  shotgunHullRed: THREE.MeshPhysicalMaterial;
  smokedMagWindow: THREE.MeshPhysicalMaterial;
  bakeliteWindow: THREE.MeshPhysicalMaterial;
  magFollowerOrange: THREE.MeshStandardMaterial;
  opticGlass: THREE.MeshPhysicalMaterial;
  sniperLensEmerald: THREE.MeshPhysicalMaterial;
  tritiumGreen: THREE.MeshStandardMaterial;
  reticleEotech: THREE.MeshBasicMaterial;
  reticleKobra: THREE.MeshBasicMaterial;
  reticleRedDot: THREE.MeshBasicMaterial;
  reticleMildot: THREE.MeshBasicMaterial;
  flashlightLens: THREE.MeshStandardMaterial;
  dispose: () => void;
}

function makeSeededRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  aniso: number,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

/** Procedural brushed CNC anodized gunmetal texture pair (albedo + bump + roughness) */
function createGunmetalMaps(
  baseHex: [number, number, number],
  seed: number,
  aniso: number,
  bluedTint = false
) {
  const size = 512;
  const [cCol, ctxCol] = createCanvas(size, size);
  const [cBump, ctxBump] = createCanvas(size, size);
  const rand = makeSeededRand(seed);

  ctxCol.fillStyle = `rgb(${baseHex[0]}, ${baseHex[1]}, ${baseHex[2]})`;
  ctxCol.fillRect(0, 0, size, size);
  ctxBump.fillStyle = '#808080';
  ctxBump.fillRect(0, 0, size, size);

  // Subtle horizontal CNC machining grain & micro-scratches
  for (let i = 0; i < 2400; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 12 + rand() * 85;
    const bright = rand() > 0.46;
    const delta = bright ? 12 + rand() * 18 : -(8 + rand() * 14);
    const r = Math.min(255, Math.max(0, baseHex[0] + delta + (bluedTint ? -3 : 0)));
    const g = Math.min(255, Math.max(0, baseHex[1] + delta));
    const b = Math.min(255, Math.max(0, baseHex[2] + delta + (bluedTint ? 7 : 0)));
    ctxCol.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.16 + rand() * 0.22})`;
    ctxCol.lineWidth = 0.6 + rand() * 1.1;
    ctxCol.beginPath();
    ctxCol.moveTo(x, y);
    ctxCol.lineTo(x + len, y + (rand() - 0.5) * 1.6);
    ctxCol.stroke();

    const bv = bright ? 148 + ((rand() * 35) | 0) : 102 - ((rand() * 30) | 0);
    ctxBump.strokeStyle = `rgba(${bv},${bv},${bv},0.35)`;
    ctxBump.lineWidth = 0.8;
    ctxBump.beginPath();
    ctxBump.moveTo(x, y);
    ctxBump.lineTo(x + len, y);
    ctxBump.stroke();
  }

  // Fine parkerized micro-pitting speckles
  for (let i = 0; i < 4200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const v = rand() > 0.5 ? 255 : 0;
    ctxCol.fillStyle = `rgba(${v},${v},${v},0.035)`;
    ctxCol.fillRect(x, y, 1.5, 1.5);
    const bv = 115 + ((rand() * 28) | 0);
    ctxBump.fillStyle = `rgb(${bv},${bv},${bv})`;
    ctxBump.fillRect(x, y, 2, 2);
  }

  return {
    map: toTexture(cCol, true, aniso, 2, 2),
    bumpMap: toTexture(cBump, false, aniso, 2, 2),
  };
}

/** Oiled laminated Soviet birch/walnut wood grain (for AK handguard & buttstock) */
function createLaminatedWoodMaps(aniso: number) {
  const size = 512;
  const [cCol, ctxCol] = createCanvas(size, size);
  const [cBump, ctxBump] = createCanvas(size, size);
  const rand = makeSeededRand(9071);

  const grad = ctxCol.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#6e3819');
  grad.addColorStop(0.5, '#864620');
  grad.addColorStop(1, '#5d2d12');
  ctxCol.fillStyle = grad;
  ctxCol.fillRect(0, 0, size, size);

  ctxBump.fillStyle = '#808080';
  ctxBump.fillRect(0, 0, size, size);

  // Flowing laminated wood ply bands
  for (let y = 0; y < size; y += 2) {
    const wave = Math.sin(y * 0.045) * 14 + Math.cos(y * 0.11) * 6;
    const band = Math.sin((y + wave) * 0.24);
    const r = (108 + band * 28 + (rand() - 0.5) * 10) | 0;
    const g = (55 + band * 16 + (rand() - 0.5) * 6) | 0;
    const b = (24 + band * 8 + (rand() - 0.5) * 4) | 0;
    ctxCol.fillStyle = `rgba(${Math.max(30, r)},${Math.max(15, g)},${Math.max(8, b)},0.58)`;
    ctxCol.fillRect(0, y, size, 2.5);

    const bv = (128 + band * 26) | 0;
    ctxBump.fillStyle = `rgb(${bv},${bv},${bv})`;
    ctxBump.fillRect(0, y, size, 2);
  }

  // Fine horizontal wood pores & lacquer streak sheen
  for (let i = 0; i < 1800; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 18 + rand() * 70;
    ctxCol.strokeStyle = rand() > 0.35 ? 'rgba(38,16,6,0.32)' : 'rgba(195,118,58,0.22)';
    ctxCol.lineWidth = 0.8 + rand() * 0.9;
    ctxCol.beginPath();
    ctxCol.moveTo(x, y);
    ctxCol.lineTo(x + len, y + (rand() - 0.5) * 2.5);
    ctxCol.stroke();
  }

  return {
    map: toTexture(cCol, true, aniso, 2, 1),
    bumpMap: toTexture(cBump, false, aniso, 2, 1),
  };
}

/** Authentic marbled Soviet orange-brown Bakelite polymer texture */
function createBakeliteMaps(aniso: number) {
  const size = 512;
  const [cCol, ctxCol] = createCanvas(size, size);
  const [cBump, ctxBump] = createCanvas(size, size);
  const rand = makeSeededRand(4432);

  ctxCol.fillStyle = '#9d431b';
  ctxCol.fillRect(0, 0, size, size);
  ctxBump.fillStyle = '#808080';
  ctxBump.fillRect(0, 0, size, size);

  for (let i = 0; i < 420; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rx = 18 + rand() * 75;
    const ry = 6 + rand() * 24;
    const angle = (rand() - 0.5) * 0.7;
    const dark = rand() > 0.45;
    ctxCol.save();
    ctxCol.translate(x, y);
    ctxCol.rotate(angle);
    ctxCol.fillStyle = dark ? 'rgba(92, 30, 10, 0.28)' : 'rgba(204, 102, 42, 0.24)';
    ctxCol.beginPath();
    ctxCol.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctxCol.fill();
    ctxCol.restore();

    const bv = dark ? 116 : 142;
    ctxBump.fillStyle = `rgba(${bv},${bv},${bv},0.25)`;
    ctxBump.fillRect(x - rx * 0.3, y - ry * 0.3, rx * 0.6, ry * 0.6);
  }

  return {
    map: toTexture(cCol, true, aniso, 1, 2),
    bumpMap: toTexture(cBump, false, aniso, 1, 2),
  };
}

/** Diamond-stippled tactical polymer grip texture (Glock / M870 / MK18) */
function createStippledPolymerMaps(aniso: number) {
  const size = 256;
  const [cCol, ctxCol] = createCanvas(size, size);
  const [cBump, ctxBump] = createCanvas(size, size);

  ctxCol.fillStyle = '#202327';
  ctxCol.fillRect(0, 0, size, size);
  ctxBump.fillStyle = '#404040';
  ctxBump.fillRect(0, 0, size, size);

  const step = 8;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const ox = (y / step) % 2 === 0 ? 0 : step * 0.5;
      const cx = x + ox;
      const cy = y + step * 0.5;
      ctxCol.fillStyle = '#2f3339';
      ctxCol.beginPath();
      ctxCol.moveTo(cx, cy - 3);
      ctxCol.lineTo(cx + 3, cy);
      ctxCol.lineTo(cx, cy + 3);
      ctxCol.lineTo(cx - 3, cy);
      ctxCol.closePath();
      ctxCol.fill();

      ctxBump.fillStyle = '#e6e6e6';
      ctxBump.beginPath();
      ctxBump.moveTo(cx, cy - 3);
      ctxBump.lineTo(cx + 3, cy);
      ctxBump.lineTo(cx, cy + 3);
      ctxBump.lineTo(cx - 3, cy);
      ctxBump.closePath();
      ctxBump.fill();
    }
  }

  return {
    map: toTexture(cCol, true, aniso, 4, 4),
    bumpMap: toTexture(cBump, false, aniso, 4, 4),
  };
}

/** Crisp holographic/optic reticle texture generator */
function createReticleTexture(
  kind: 'eotech' | 'kobra' | 'reddot' | 'mildot',
  aniso: number
): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = createCanvas(size, size);
  ctx.clearRect(0, 0, size, size);
  const cx = size * 0.5;
  const cy = size * 0.5;

  if (kind === 'eotech') {
    ctx.strokeStyle = 'rgba(255, 36, 26, 0.95)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 56, 0, Math.PI * 2);
    ctx.stroke();

    // 4 cardinal ticks
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * 48, cy + dy * 48);
      ctx.lineTo(cx + dx * 70, cy + dy * 70);
      ctx.stroke();
    }
    ctx.fillStyle = '#ff2a1f';
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'kobra') {
    // Russian T-chevron Kobra reticle
    ctx.strokeStyle = 'rgba(255, 58, 30, 0.95)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 32, cy + 18);
    ctx.lineTo(cx, cy - 14);
    ctx.lineTo(cx + 32, cy + 18);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - 64, cy + 2);
    ctx.lineTo(cx - 30, cy + 2);
    ctx.moveTo(cx + 30, cy + 2);
    ctx.lineTo(cx + 64, cy + 2);
    ctx.moveTo(cx, cy + 26);
    ctx.lineTo(cx, cy + 68);
    ctx.stroke();
  } else if (kind === 'reddot') {
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 22);
    g.addColorStop(0, 'rgba(255, 70, 50, 1)');
    g.addColorStop(0.4, 'rgba(255, 30, 20, 0.85)');
    g.addColorStop(1, 'rgba(255, 20, 10, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Illuminated sniper mildot reticle
    ctx.strokeStyle = 'rgba(24, 240, 128, 0.92)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(14, cy);
    ctx.lineTo(size - 14, cy);
    ctx.moveTo(cx, 14);
    ctx.lineTo(cx, size - 14);
    ctx.stroke();

    ctx.fillStyle = 'rgba(24, 240, 128, 0.95)';
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      ctx.beginPath();
      ctx.arc(cx + i * 24, cy, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy + i * 24, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ff2c24';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  return toTexture(c, true, aniso, 1, 1);
}

export function createWeaponMaterials(maxAnisotropy = 4): WeaponMaterialLibrary {
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];

  const trackTex = (t: THREE.Texture) => {
    textures.push(t);
    return t;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const anodizedMaps = createGunmetalMaps([44, 47, 52], 101, maxAnisotropy, false);
  trackTex(anodizedMaps.map);
  trackTex(anodizedMaps.bumpMap);

  const gunmetalMaps = createGunmetalMaps([64, 68, 74], 202, maxAnisotropy, false);
  trackTex(gunmetalMaps.map);
  trackTex(gunmetalMaps.bumpMap);

  const bluedMaps = createGunmetalMaps([42, 47, 56], 303, maxAnisotropy, true);
  trackTex(bluedMaps.map);
  trackTex(bluedMaps.bumpMap);

  const woodMaps = createLaminatedWoodMaps(maxAnisotropy);
  trackTex(woodMaps.map);
  trackTex(woodMaps.bumpMap);

  const bakeliteMaps = createBakeliteMaps(maxAnisotropy);
  trackTex(bakeliteMaps.map);
  trackTex(bakeliteMaps.bumpMap);

  const stippleMaps = createStippledPolymerMaps(maxAnisotropy);
  trackTex(stippleMaps.map);
  trackTex(stippleMaps.bumpMap);

  const sniperChassisMaps = createGunmetalMaps([62, 72, 57], 505, maxAnisotropy, false);
  trackTex(sniperChassisMaps.map);
  trackTex(sniperChassisMaps.bumpMap);

  const retEotech = trackTex(createReticleTexture('eotech', maxAnisotropy));
  const retKobra = trackTex(createReticleTexture('kobra', maxAnisotropy));
  const retRedDot = trackTex(createReticleTexture('reddot', maxAnisotropy));
  const retMildot = trackTex(createReticleTexture('mildot', maxAnisotropy));

  const anodizedAluminum = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Anodized_Aluminum',
      color: 0xffffff,
      map: anodizedMaps.map,
      bumpMap: anodizedMaps.bumpMap,
      bumpScale: 0.0022,
      metalness: 0.82,
      roughness: 0.34,
      clearcoat: 0.14,
      clearcoatRoughness: 0.42,
    })
  );

  const gunmetalSteel = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Gunmetal_Steel',
      color: 0xffffff,
      map: gunmetalMaps.map,
      bumpMap: gunmetalMaps.bumpMap,
      bumpScale: 0.0028,
      metalness: 0.9,
      roughness: 0.28,
      clearcoat: 0.12,
      clearcoatRoughness: 0.36,
    })
  );

  const bluedSteel = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Blued_Stamped_Steel',
      color: 0xffffff,
      map: bluedMaps.map,
      bumpMap: bluedMaps.bumpMap,
      bumpScale: 0.0032,
      metalness: 0.88,
      roughness: 0.3,
      clearcoat: 0.2,
      clearcoatRoughness: 0.32,
    })
  );

  const chromeSteel = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Chrome_Steel',
      color: 0xd0d6de,
      bumpMap: gunmetalMaps.bumpMap,
      bumpScale: 0.0012,
      metalness: 0.96,
      roughness: 0.16,
      clearcoat: 0.25,
      clearcoatRoughness: 0.18,
    })
  );

  const tacticalPolymer = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Tactical_Polymer',
      color: 0x26292d,
      bumpMap: anodizedMaps.bumpMap,
      bumpScale: 0.0018,
      metalness: 0.08,
      roughness: 0.68,
      clearcoat: 0.06,
      clearcoatRoughness: 0.6,
    })
  );

  const stippledGrip = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Stippled_Polymer',
      color: 0xffffff,
      map: stippleMaps.map,
      bumpMap: stippleMaps.bumpMap,
      bumpScale: 0.0045,
      metalness: 0.06,
      roughness: 0.78,
    })
  );

  const rubberPad = trackMat(
    new THREE.MeshStandardMaterial({
      name: 'Mat_Rubber_Recoil_Pad',
      color: 0x1a1c1e,
      metalness: 0.02,
      roughness: 0.9,
    })
  );

  const laminatedWood = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Oiled_Laminated_Wood',
      color: 0xffffff,
      map: woodMaps.map,
      bumpMap: woodMaps.bumpMap,
      bumpScale: 0.0035,
      metalness: 0.04,
      roughness: 0.42,
      clearcoat: 0.45,
      clearcoatRoughness: 0.26,
    })
  );

  const bakeliteOrange = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Soviet_Bakelite',
      color: 0xffffff,
      map: bakeliteMaps.map,
      bumpMap: bakeliteMaps.bumpMap,
      bumpScale: 0.0028,
      metalness: 0.06,
      roughness: 0.36,
      clearcoat: 0.38,
      clearcoatRoughness: 0.28,
    })
  );

  const sniperChassisOD = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Sniper_Chassis_OD',
      color: 0xffffff,
      map: sniperChassisMaps.map,
      bumpMap: sniperChassisMaps.bumpMap,
      bumpScale: 0.0024,
      metalness: 0.14,
      roughness: 0.56,
      clearcoat: 0.08,
      clearcoatRoughness: 0.55,
    })
  );

  const tanRailAccent = trackMat(
    new THREE.MeshStandardMaterial({
      name: 'Mat_FDE_Tan_Rail',
      color: 0x8d7a5e,
      bumpMap: anodizedMaps.bumpMap,
      bumpScale: 0.002,
      metalness: 0.42,
      roughness: 0.46,
    })
  );

  const cartridgeBrass = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Cartridge_Brass',
      color: 0xe3b14d,
      metalness: 0.94,
      roughness: 0.18,
      clearcoat: 0.25,
      clearcoatRoughness: 0.2,
    })
  );

  const bulletCopper = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_FMJ_Bullet_Copper',
      color: 0xcf7c42,
      metalness: 0.92,
      roughness: 0.22,
      clearcoat: 0.18,
      clearcoatRoughness: 0.24,
    })
  );

  const shotgunHullRed = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Shotgun_Hull_Crimson',
      color: 0xb01b1b,
      metalness: 0.05,
      roughness: 0.36,
      clearcoat: 0.32,
      clearcoatRoughness: 0.26,
    })
  );

  // Smoked translucent tactical polycarbonate window (Magpul PMAG / witness window)
  const smokedMagWindow = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Smoked_Mag_Window',
      color: 0x262b30,
      metalness: 0.08,
      roughness: 0.16,
      transparent: true,
      opacity: 0.36,
      clearcoat: 0.92,
      clearcoatRoughness: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );

  // Smoked amber-Bakelite Svetogor translucent AK magazine window
  const bakeliteWindow = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Bakelite_Ammo_Window',
      color: 0x8f3c16,
      metalness: 0.05,
      roughness: 0.18,
      transparent: true,
      opacity: 0.38,
      clearcoat: 0.88,
      clearcoatRoughness: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );

  // High-contrast anti-tilt orange polymer magazine follower
  const magFollowerOrange = trackMat(
    new THREE.MeshStandardMaterial({
      name: 'Mat_Mag_Follower_Orange',
      color: 0xe35418,
      metalness: 0.04,
      roughness: 0.44,
    })
  );

  const opticGlass = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Optic_Lens_Glass',
      color: 0x6ba6c8,
      metalness: 0.18,
      roughness: 0.06,
      transparent: true,
      opacity: 0.32,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );

  const sniperLensEmerald = trackMat(
    new THREE.MeshPhysicalMaterial({
      name: 'Mat_Sniper_Objective_Emerald',
      color: 0x168f68,
      emissive: 0x093b2e,
      emissiveIntensity: 0.45,
      metalness: 0.4,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
    })
  );

  const tritiumGreen = trackMat(
    new THREE.MeshStandardMaterial({
      name: 'Mat_Tritium_Night_Sight',
      color: 0x6dff88,
      emissive: 0x22ff55,
      emissiveIntensity: 1.8,
      roughness: 0.2,
      metalness: 0.1,
    })
  );

  const reticleEotech = trackMat(
    new THREE.MeshBasicMaterial({
      name: 'Mat_Reticle_EOTech',
      map: retEotech,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  );

  const reticleKobra = trackMat(
    new THREE.MeshBasicMaterial({
      name: 'Mat_Reticle_Kobra',
      map: retKobra,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  );

  const reticleRedDot = trackMat(
    new THREE.MeshBasicMaterial({
      name: 'Mat_Reticle_RMR',
      map: retRedDot,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  );

  const reticleMildot = trackMat(
    new THREE.MeshBasicMaterial({
      name: 'Mat_Reticle_Mildot',
      map: retMildot,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  );

  const flashlightLens = trackMat(
    new THREE.MeshStandardMaterial({
      name: 'Mat_Flashlight_Lens',
      color: 0xeef5ff,
      emissive: 0xfff3d1,
      emissiveIntensity: 0.35,
      roughness: 0.08,
      metalness: 0.2,
    })
  );

  return {
    anodizedAluminum,
    gunmetalSteel,
    bluedSteel,
    chromeSteel,
    tacticalPolymer,
    stippledGrip,
    rubberPad,
    laminatedWood,
    bakeliteOrange,
    sniperChassisOD,
    tanRailAccent,
    cartridgeBrass,
    bulletCopper,
    shotgunHullRed,
    smokedMagWindow,
    bakeliteWindow,
    magFollowerOrange,
    opticGlass,
    sniperLensEmerald,
    tritiumGreen,
    reticleEotech,
    reticleKobra,
    reticleRedDot,
    reticleMildot,
    flashlightLens,
    dispose: () => {
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
