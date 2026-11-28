import type * as THREE from 'three';

export type LightingPresetId =
  | 'studio_soft'
  | 'harsh_sunlight'
  | 'night_operation'
  | 'indoor_warehouse';

export type CameraPresetId =
  | 'full_hero'
  | 'face_eyes'
  | 'jacket_detail'
  | 'forearms_gloves'
  | 'boots_knees'
  | 'rear_quarter';

export type WeaponId = 'mk18' | 'ak74m' | 'm870' | 'awm' | 'glock19';

export type WeaponFireMode = 'AUTO' | 'SEMI' | 'PUMP' | 'BOLT';

export type CharacterLodLevel = 'LOD0' | 'LOD1' | 'LOD2';

export type UE5BoneName =
  | 'root'
  | 'pelvis'
  | 'spine_01'
  | 'spine_02'
  | 'spine_03'
  | 'neck_01'
  | 'head'
  | 'clavicle_l'
  | 'upperarm_l'
  | 'upperarm_twist_01_l'
  | 'lowerarm_l'
  | 'lowerarm_twist_01_l'
  | 'hand_l'
  | 'thumb_01_l'
  | 'thumb_02_l'
  | 'thumb_03_l'
  | 'index_01_l'
  | 'index_02_l'
  | 'index_03_l'
  | 'middle_01_l'
  | 'middle_02_l'
  | 'middle_03_l'
  | 'ring_01_l'
  | 'ring_02_l'
  | 'ring_03_l'
  | 'pinky_01_l'
  | 'pinky_02_l'
  | 'pinky_03_l'
  | 'clavicle_r'
  | 'upperarm_r'
  | 'upperarm_twist_01_r'
  | 'lowerarm_r'
  | 'lowerarm_twist_01_r'
  | 'hand_r'
  | 'thumb_01_r'
  | 'thumb_02_r'
  | 'thumb_03_r'
  | 'index_01_r'
  | 'index_02_r'
  | 'index_03_r'
  | 'middle_01_r'
  | 'middle_02_r'
  | 'middle_03_r'
  | 'ring_01_r'
  | 'ring_02_r'
  | 'ring_03_r'
  | 'pinky_01_r'
  | 'pinky_02_r'
  | 'pinky_03_r'
  | 'thigh_l'
  | 'thigh_twist_01_l'
  | 'calf_l'
  | 'calf_twist_01_l'
  | 'foot_l'
  | 'ball_l'
  | 'thigh_r'
  | 'thigh_twist_01_r'
  | 'calf_r'
  | 'calf_twist_01_r'
  | 'foot_r'
  | 'ball_r'
  | 'ik_hand_root'
  | 'ik_hand_gun'
  | 'ik_foot_root';

export type UE5SocketName =
  | 'hand_r_weapon'
  | 'thigh_holster_socket'
  | 'muzzle_socket'
  | 'laser_socket'
  | 'optic_eye_socket'
  | 'ejection_port_socket'
  | 'weapon_light_socket';

export interface PackedORMTextureSet {
  albedo: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  orm: THREE.CanvasTexture;
  alpha?: THREE.CanvasTexture;
  emissive?: THREE.CanvasTexture;
}

export interface CharacterLodStats {
  lod0Triangles: number;
  lod1Triangles: number;
  lod2Triangles: number;
  headTriangles: number;
  materialSlots: number;
  boneCount: number;
}

export interface CharacterBuildStats {
  triangles: number;
  vertices: number;
  bones: number;
  morphs: number;
  meshes: number;
  materialSlots: number;
  headTriangles: number;
  lod1Triangles: number;
  lod2Triangles: number;
}

export interface GlbExportMetrics {
  byteLength: number;
  durationMs: number;
  clipCount: number;
  strippedHelperCount: number;
}

export interface AimPitchDistribution {
  clampedPitch: number;
  spine_02: number;
  spine_03: number;
  neck_01: number;
  head: number;
}
