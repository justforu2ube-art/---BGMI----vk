import * as THREE from 'three';
import { ProceduralTextureFactory } from '../studio/ProceduralTextureFactory';

/**
 * Consolidated <= 4 PBR Material Slots for ALL 5 firearms:
 *  1. metal            (Mat_Weapon_Metal — bead-blasted gunmetal + milling striations + COLOR_0.g dihedral edge wear)
 *  2. polymer          (Mat_Weapon_Polymer_Furniture — stippled polymer/FDE/wood/bakelite tinted via COLOR_0 vertex color)
 *  3. opticGlass       (Mat_Weapon_Optic_Glass — AR iridescent MeshPhysicalMaterial iridescence:1.0, IOR:1.38, roughness:0.05)
 *  4. ammoAccent       (Mat_Weapon_Ammo_Accent — live brass/copper/crimson shotgun shells + glowing reticle/sights via COLOR_0)
 *
 * Legacy alias properties point cleanly to these 4 shared materials so every firearm stays <= 4 material slots!
 */
export interface WeaponMaterials {
  metal: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  opticGlass: THREE.MeshPhysicalMaterial;
  ammoAccent: THREE.MeshStandardMaterial;

  // Strongly-typed aliases mapping to the 4 consolidated material slots
  gunmetal: THREE.MeshStandardMaterial;
  darkSteel: THREE.MeshStandardMaterial;
  chromeSteel: THREE.MeshStandardMaterial;
  fdePolymer: THREE.MeshStandardMaterial;
  blackPolymer: THREE.MeshStandardMaterial;
  odPolymer: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  bakelite: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  shellRed: THREE.MeshStandardMaterial;
  translucentMag: THREE.MeshPhysicalMaterial;
  reticleGlow: THREE.MeshStandardMaterial;
  tritiumGreen: THREE.MeshStandardMaterial;

  readonly coreSlotCount: number;
  dispose: () => void;
}

export function createWeaponMaterials(): WeaponMaterials {
  const factory = new ProceduralTextureFactory();

  const metalSet = factory.createGunmetalTextureSet(512);
  const polymerSet = factory.createLeatherRubberTextureSet(512);

  // Slot 1: Bead-blasted gunmetal + milling striations + COLOR_0.g dihedral curvature edge wear
  const metal = factory.createWeaponMetalMaterial(metalSet, 'Mat_Weapon_Metal', 0xffffff);

  // Slot 2: Textured polymer / furniture (charcoal, FDE tan, OD AWM chassis, AK wood/bakelite via COLOR_0)
  const polymer = new THREE.MeshStandardMaterial({
    name: 'Mat_Weapon_Polymer_Furniture',
    color: new THREE.Color(0xffffff),
    map: polymerSet.albedo,
    normalMap: polymerSet.normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    aoMap: polymerSet.orm,
    aoMapIntensity: 0.78,
    roughnessMap: polymerSet.orm,
    roughness: 1.0,
    metalnessMap: polymerSet.orm,
    metalness: 0.08,
    vertexColors: true,
  });

  // Slot 3: AR Iridescent Optic Glass & Translucent Magazine Window
  const opticGlass = factory.createOpticGlassMaterial('Mat_Weapon_Optic_Glass');

  // Slot 4: Live Ammo Brass / Copper / Crimson Shells & Sights Accent (shared ORM!)
  const ammoAccent = new THREE.MeshStandardMaterial({
    name: 'Mat_Weapon_Ammo_Accent',
    color: new THREE.Color(0xffffff),
    map: metalSet.albedo,
    normalMap: metalSet.normal,
    normalScale: new THREE.Vector2(0.22, 0.22),
    aoMap: metalSet.orm,
    aoMapIntensity: 0.45,
    roughnessMap: metalSet.orm,
    roughness: 0.45,
    metalnessMap: metalSet.orm,
    metalness: 0.72,
    vertexColors: true,
  });

  const coreMats: THREE.Material[] = [metal, polymer, opticGlass, ammoAccent];
  for (const m of coreMats) {
    m.shadowSide = THREE.FrontSide;
  }

  return {
    metal,
    polymer,
    opticGlass,
    ammoAccent,

    // Aliases to preserve clean readable semantic construction in weaponModels.ts within 4 slots
    gunmetal: metal,
    darkSteel: metal,
    chromeSteel: metal,
    fdePolymer: polymer,
    blackPolymer: polymer,
    odPolymer: polymer,
    wood: polymer,
    bakelite: polymer,
    rubber: polymer,
    brass: ammoAccent,
    copper: ammoAccent,
    shellRed: ammoAccent,
    translucentMag: opticGlass,
    reticleGlow: ammoAccent,
    tritiumGreen: ammoAccent,

    coreSlotCount: coreMats.length,
    dispose: () => {
      for (const m of coreMats) m.dispose();
      factory.dispose();
    },
  };
}

export type WeaponMaterialLibrary = WeaponMaterials;
export const createWeaponMaterialLibrary = createWeaponMaterials;

