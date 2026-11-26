import * as THREE from 'three';
import { CharacterRig, createCharacterRig } from './rig';
import { createCharacterMaterials, PBRMaterialLibrary } from './textures';
import { buildHeadAssembly, FACIAL_MORPH_NAMES, FacialMorphName } from './headSculpt';
import { buildOutfitAssembly } from './outfitSculpt';

export interface BuiltCharacter {
  exportGroup: THREE.Group;
  rig: CharacterRig;
  materials: PBRMaterialLibrary;
  headMesh: THREE.SkinnedMesh;
  skinnedMeshes: THREE.SkinnedMesh[];
  stats: {
    boneCount: number;
    meshCount: number;
    vertexCount: number;
    triangleCount: number;
    morphTargetCount: number;
    heightMeters: number;
    minY: number;
  };
  setMorphTarget: (name: FacialMorphName, value: number) => void;
  setWireframe: (enabled: boolean) => void;
  dispose: () => void;
}

/**
 * Assembles the complete 1.85m Hero_Commando_Rig inside one clean UE5/glTF-ready THREE.Group
 * with exact Y=0.000 boot sole grounding.
 */
export function buildHeroCharacter(maxAnisotropy = 4): BuiltCharacter {
  const rig = createCharacterRig();
  const materials = createCharacterMaterials(maxAnisotropy);

  const exportGroup = new THREE.Group();
  exportGroup.name = 'Hero_Commando_Rig';
  exportGroup.position.set(0, 0, 0);
  exportGroup.rotation.set(0, 0, 0);
  exportGroup.scale.set(1, 1, 1);

  // Add Root bone directly inside Hero_Commando_Rig
  exportGroup.add(rig.rootBone);

  const head = buildHeadAssembly(rig, materials);
  const outfit = buildOutfitAssembly(rig, materials);

  const skinnedMeshes: THREE.SkinnedMesh[] = [
    head.headMesh,
    head.eyeIrisMesh,
    head.eyeCorneaMesh,
    head.hairSidesMesh,
    head.hairTopMesh,
    ...outfit.meshes,
  ];

  let vertexCount = 0;
  let triangleCount = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const mesh of skinnedMeshes) {
    exportGroup.add(mesh);
    const pos = mesh.geometry.attributes.position;
    vertexCount += pos.count;
    triangleCount += mesh.geometry.index ? mesh.geometry.index.count / 3 : pos.count / 3;

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // Ensure exact Y=0.000 sole flush grounding across all vertex buffers & bind skeleton if off by sub-mm
  if (Math.abs(minY) > 0.0005 && Number.isFinite(minY)) {
    const dy = -minY;
    for (const mesh of skinnedMeshes) {
      mesh.geometry.translate(0, dy, 0);
      if (mesh.geometry.morphAttributes.position) {
        for (const attr of mesh.geometry.morphAttributes.position) {
          for (let i = 0; i < attr.count; i++) {
            attr.setY(i, attr.getY(i) + dy);
          }
          attr.needsUpdate = true;
        }
      }
    }
    rig.boneMap.get('Pelvis')!.position.y += dy;
    rig.rootBone.updateMatrixWorld(true);
    for (const mesh of skinnedMeshes) {
      mesh.bind(rig.skeleton, new THREE.Matrix4());
    }
    maxY += dy;
    minY = 0;
  }

  const setMorphTarget = (name: FacialMorphName, value: number) => {
    const dict = head.headMesh.morphTargetDictionary;
    const infl = head.headMesh.morphTargetInfluences;
    if (!dict || !infl) return;
    const idx = dict[name];
    if (idx !== undefined) {
      infl[idx] = Math.max(0, Math.min(1, value));
    }
  };

  const setWireframe = (enabled: boolean) => {
    for (const mesh of skinnedMeshes) {
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      if (mat && 'wireframe' in mat) {
        mat.wireframe = enabled;
      }
    }
  };

  const dispose = () => {
    for (const mesh of skinnedMeshes) {
      mesh.geometry.dispose();
    }
    materials.dispose();
  };

  return {
    exportGroup,
    rig,
    materials,
    headMesh: head.headMesh,
    skinnedMeshes,
    stats: {
      boneCount: rig.bones.length,
      meshCount: skinnedMeshes.length,
      vertexCount,
      triangleCount: Math.round(triangleCount),
      morphTargetCount: FACIAL_MORPH_NAMES.length,
      heightMeters: Number((maxY - minY).toFixed(3)),
      minY: Number(minY.toFixed(4)),
    },
    setMorphTarget,
    setWireframe,
    dispose,
  };
}
