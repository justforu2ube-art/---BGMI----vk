import * as THREE from 'three';
import { CharacterRig, createCharacterRig } from './rig';
import { CharacterMaterialSet, createCharacterMaterials } from './textures';
import { buildCharacterHead, MorphName } from './headSculpt';
import { buildCharacterOutfit } from './outfitSculpt';
import { bakeDihedralEdgeWear, createRoundedBox } from './geometryUtils';
import type { CharacterBuildStats, CharacterLodLevel } from '../types/studioTypes';

export interface CharacterStats extends CharacterBuildStats {
  triangleCount: number;
  boneCount: number;
  heightMeters: number;
}

export interface BuiltCharacter {
  root: THREE.Group;
  exportGroup: THREE.Group;
  rig: CharacterRig;
  materials: CharacterMaterialSet;
  headMesh: THREE.SkinnedMesh;
  hairMesh: THREE.SkinnedMesh;
  eyesMesh: THREE.SkinnedMesh;
  skinnedMeshes: THREE.SkinnedMesh[];
  holsteredPistol: THREE.Group;
  lods: Record<CharacterLodLevel, THREE.Group>;
  morphNames: readonly MorphName[];
  stats: CharacterStats;
  setLod: (level: CharacterLodLevel) => void;
  setHolsteredPistolVisible: (visible: boolean) => void;
  setMorphTarget: (name: string, value: number) => void;
  setWireframe: (enabled: boolean) => void;
  dispose: () => void;
}

/**
 * Enforce castShadow = true, receiveShadow = true, frustumCulled = false on every
 * SkinnedMesh and static mesh attachment across characterRoot (preserving built-in skinned MeshDepthMaterial).
 */
export function enforceCharacterShadows(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj.userData?.isLensHelper || obj.userData?.excludeFromGLB) return;
    if (obj instanceof THREE.SkinnedMesh || obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = false;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m) m.shadowSide = THREE.FrontSide;
      }
    }
  });
}

function countGroupTriangles(group: THREE.Object3D): { triangles: number; vertices: number } {
  let triangles = 0;
  let vertices = 0;
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry) {
      const geo = obj.geometry;
      vertices += geo.attributes.position ? geo.attributes.position.count : 0;
      if (geo.index) {
        triangles += geo.index.count / 3;
      } else if (geo.attributes.position) {
        triangles += geo.attributes.position.count / 3;
      }
    }
  });
  return { triangles: Math.round(triangles), vertices };
}

/**
 * Compact holstered Glock 19 visual mounted in `thigh_holster_socket` on `thigh_r`.
 * Visible whenever a primary rifle or shotgun is equipped, hidden when Glock 19 is drawn in hand.
 */
function createHolsteredGlockVisual(materials: CharacterMaterialSet): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Holstered_Glock19_Visual';

  // Polymer frame grip protruding up and slightly rearward out of the Kydex holster
  const gripGeo = createRoundedBox(0.028, 0.095, 0.046, 0.005, 1);
  gripGeo.rotateX(-0.26);
  gripGeo.translate(0, 0.072, -0.020);
  const grip = new THREE.Mesh(gripGeo, materials.leatherRubber);
  grip.name = 'Holstered_Glock_Grip';
  group.add(grip);

  // Exposed rear Glock slide + optic cut sitting flush in Kydex retention hood
  const slideGeo = createRoundedBox(0.025, 0.048, 0.036, 0.004, 1);
  bakeDihedralEdgeWear(slideGeo, 0.7);
  slideGeo.translate(0, 0.068, 0.010);
  const slide = new THREE.Mesh(slideGeo, materials.hardwareMetal);
  slide.name = 'Holstered_Glock_Slide';
  group.add(slide);

  // Magazine basepad at top of grip
  const magPadGeo = createRoundedBox(0.030, 0.012, 0.048, 0.003, 1);
  magPadGeo.rotateX(-0.26);
  magPadGeo.translate(0, 0.118, -0.032);
  const magPad = new THREE.Mesh(magPadGeo, materials.hardwareMetal);
  magPad.name = 'Holstered_Glock_MagPad';
  group.add(magPad);

  // Position relative to thigh_holster_socket so pistol sits inside the Kydex shell
  group.position.set(-0.008, 0.022, 0.004);
  group.rotation.set(0.06, 0, 0);
  return group;
}

export function buildCharacter(): BuiltCharacter {
  const root = new THREE.Group();
  root.name = 'Vanguard_Tactical_Operator';

  const rig = createCharacterRig();
  const materials = createCharacterMaterials();
  root.add(rig.rootBone);

  // Build LOD0 (hero studio tier, ~29k character + ~5.5k active firearm = ~34.5k tris)
  const lod0Group = new THREE.Group();
  lod0Group.name = 'Character_LOD0';
  const head0 = buildCharacterHead(rig, materials, 1.0);
  const outfit0 = buildCharacterOutfit(rig, materials, 1.0);
  lod0Group.add(head0.headMesh, head0.hairMesh, head0.eyesMesh, ...outfit0.meshes);

  // Build LOD1 (~16k tris) and LOD2 (~6k tris) for UE5 LOD pipeline inspection
  const lod1Group = new THREE.Group();
  lod1Group.name = 'Character_LOD1';
  lod1Group.visible = false;
  lod1Group.userData.excludeFromGLB = true;
  const head1 = buildCharacterHead(rig, materials, 0.68);
  const outfit1 = buildCharacterOutfit(rig, materials, 0.65);
  lod1Group.add(head1.headMesh, head1.hairMesh, head1.eyesMesh, ...outfit1.meshes);

  const lod2Group = new THREE.Group();
  lod2Group.name = 'Character_LOD2';
  lod2Group.visible = false;
  lod2Group.userData.excludeFromGLB = true;
  const head2 = buildCharacterHead(rig, materials, 0.44);
  const outfit2 = buildCharacterOutfit(rig, materials, 0.40);
  lod2Group.add(head2.headMesh, head2.hairMesh, head2.eyesMesh, ...outfit2.meshes);

  root.add(lod0Group, lod1Group, lod2Group);

  // Attach holstered Glock 19 visual inside thigh_holster_socket
  const holsteredPistol = createHolsteredGlockVisual(materials);
  rig.sockets.thigh_holster_socket.add(holsteredPistol);

  // Guarantee transforms & bind inverses are exact before first frame
  root.updateMatrixWorld(true);
  rig.skeleton.calculateInverses();
  enforceCharacterShadows(root);

  const skinnedMeshes: THREE.SkinnedMesh[] = [
    head0.headMesh,
    head0.hairMesh,
    head0.eyesMesh,
    ...outfit0.meshes,
  ];

  const lod0Counts = countGroupTriangles(lod0Group);
  const lod1Counts = countGroupTriangles(lod1Group);
  const lod2Counts = countGroupTriangles(lod2Group);
  const headCounts = countGroupTriangles(head0.headMesh);

  const stats: CharacterStats = {
    triangles: lod0Counts.triangles,
    triangleCount: lod0Counts.triangles,
    vertices: lod0Counts.vertices,
    bones: rig.bones.length,
    boneCount: rig.bones.length,
    heightMeters: 1.87,
    morphs: head0.morphNames.length,
    meshes: skinnedMeshes.length,
    materialSlots: materials.materialCount,
    headTriangles: headCounts.triangles,
    lod1Triangles: lod1Counts.triangles,
    lod2Triangles: lod2Counts.triangles,
  };

  const lods: Record<CharacterLodLevel, THREE.Group> = {
    LOD0: lod0Group,
    LOD1: lod1Group,
    LOD2: lod2Group,
  };

  const setLod = (level: CharacterLodLevel) => {
    lod0Group.visible = level === 'LOD0';
    lod1Group.visible = level === 'LOD1';
    lod2Group.visible = level === 'LOD2';
  };

  const setHolsteredPistolVisible = (visible: boolean) => {
    holsteredPistol.visible = visible;
  };

  const allHeadMeshes = [head0.headMesh, head1.headMesh, head2.headMesh];
  const setMorphTarget = (name: string, value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    for (const hm of allHeadMeshes) {
      const idx = hm.morphTargetDictionary?.[name];
      if (idx !== undefined && hm.morphTargetInfluences) {
        hm.morphTargetInfluences[idx] = clamped;
      }
    }
  };

  const setWireframe = (enabled: boolean) => {
    const mats = [
      materials.skin,
      materials.hairCards,
      materials.tacticalCordura,
      materials.leatherRubber,
      materials.hardwareMetal,
      materials.eyeOptic,
    ];
    for (const m of mats) {
      m.wireframe = enabled;
    }
  };

  const dispose = () => {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry) {
        obj.geometry.dispose();
      }
    });
    materials.dispose();
  };

  return {
    root,
    exportGroup: root,
    rig,
    materials,
    headMesh: head0.headMesh,
    hairMesh: head0.hairMesh,
    eyesMesh: head0.eyesMesh,
    skinnedMeshes,
    holsteredPistol,
    lods,
    morphNames: head0.morphNames,
    stats,
    setLod,
    setHolsteredPistolVisible,
    setMorphTarget,
    setWireframe,
    dispose,
  };
}

export function buildHeroCharacter(_maxAniso?: number): BuiltCharacter {
  void _maxAniso;
  return buildCharacter();
}
