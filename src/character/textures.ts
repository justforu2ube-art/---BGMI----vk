import * as THREE from 'three';
import { ProceduralTextureFactory } from '../studio/ProceduralTextureFactory';

/**
 * Consolidated <= 6 material palette for the Vanguard Tactical Operator:
 *  1. skin             (Mat_Char_Skin - Voronoi pores, SSS, regional ORM)
 *  2. hairCards        (Mat_Char_HairCards - Tapered strand alpha cards, anisotropy)
 *  3. tacticalCordura  (Mat_Char_Cordura - 1000D weave, ripstop, seams, COLOR_0 dirt/AO)
 *  4. leatherRubber    (Mat_Char_LeatherRubber - Boots, gloves, belt, knee pads, Kydex holster)
 *  5. hardwareMetal    (Mat_Char_HardwareMetal - Buckles, grommets, eyelets, zippers)
 *  6. eyeOptic         (Mat_Char_EyeIris - Hazel-steel procedural iris + sclera)
 */
export interface CharacterMaterialSet {
  skin: THREE.MeshPhysicalMaterial;
  hairCards: THREE.MeshPhysicalMaterial;
  tacticalCordura: THREE.MeshStandardMaterial;
  leatherRubber: THREE.MeshStandardMaterial;
  hardwareMetal: THREE.MeshStandardMaterial;
  eyeOptic: THREE.MeshPhysicalMaterial;
  readonly materialCount: number;
  dispose: () => void;
}

export function createCharacterMaterials(): CharacterMaterialSet {
  const factory = new ProceduralTextureFactory();

  const skinSet = factory.createSkinTextureSet(768);
  const hairSet = factory.createHairCardTextureSet(512);
  const corduraSet = factory.createCorduraTextureSet(0x4f6142, 512, 3, 3);
  const leatherSet = factory.createLeatherRubberTextureSet(512);
  const metalSet = factory.createGunmetalTextureSet(512);
  const eyeSet = factory.createEyeTextureSet(512);

  const skin = factory.createSkinMaterial(skinSet);
  const hairCards = factory.createHairCardMaterial(hairSet);
  const tacticalCordura = factory.createCorduraMaterial(corduraSet);

  const leatherRubber = new THREE.MeshStandardMaterial({
    name: 'Mat_Char_LeatherRubber',
    map: leatherSet.albedo,
    normalMap: leatherSet.normal,
    normalScale: new THREE.Vector2(0.42, 0.42),
    aoMap: leatherSet.orm,
    aoMapIntensity: 0.72,
    roughnessMap: leatherSet.orm,
    roughness: 1.0,
    metalnessMap: leatherSet.orm,
    metalness: 1.0,
    vertexColors: true,
  });

  const hardwareMetal = factory.createWeaponMetalMaterial(
    metalSet,
    'Mat_Char_HardwareMetal',
    0xbfc6cc
  );

  const eyeOptic = new THREE.MeshPhysicalMaterial({
    name: 'Mat_Char_EyeIris',
    map: eyeSet.albedo,
    normalMap: eyeSet.normal,
    normalScale: new THREE.Vector2(0.18, 0.18),
    aoMap: eyeSet.orm,
    aoMapIntensity: 0.25,
    roughnessMap: eyeSet.orm,
    roughness: 1.0,
    metalnessMap: eyeSet.orm,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
  });

  const allMaterials: THREE.Material[] = [
    skin,
    hairCards,
    tacticalCordura,
    leatherRubber,
    hardwareMetal,
    eyeOptic,
  ];

  // Guarantee shadowSide FrontSide across all character materials
  for (const m of allMaterials) {
    m.shadowSide = THREE.FrontSide;
  }

  return {
    skin,
    hairCards,
    tacticalCordura,
    leatherRubber,
    hardwareMetal,
    eyeOptic,
    materialCount: allMaterials.length,
    dispose: () => {
      for (const m of allMaterials) m.dispose();
      factory.dispose();
    },
  };
}
