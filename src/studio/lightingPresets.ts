export type LightingPresetKey =
  | 'studio_soft'
  | 'harsh_sunlight'
  | 'night_operation'
  | 'indoor_warehouse';

export interface DirectionalLightConfig {
  color: string;
  intensity: number;
  position: [number, number, number];
}

export interface OverheadSpotConfig {
  color: string;
  intensity: number;
  position: [number, number, number];
  angle: number;
  penumbra: number;
  distance: number;
  decay: number;
}

export interface LightingPresetSpec {
  id: LightingPresetKey;
  label: string;
  description: string;
  exposure: number;
  environmentIntensity: number;
  bgColor: string;
  backdropStops: [string, string, string, string, string];
  shadowFloorOpacity: number;
  contactShadowOpacity: number;
  keyLight: DirectionalLightConfig;
  rimLight: DirectionalLightConfig;
  fillLight: DirectionalLightConfig;
  hemiLight: {
    skyColor: string;
    groundColor: string;
    intensity: number;
  };
  overheadSpot: OverheadSpotConfig;
}

export const LIGHTING_PRESET_KEYS: readonly LightingPresetKey[] = [
  'studio_soft',
  'harsh_sunlight',
  'night_operation',
  'indoor_warehouse',
] as const;

export const DEFAULT_LIGHTING_PRESET: LightingPresetKey = 'harsh_sunlight';

export const LIGHTING_PRESETS: readonly LightingPresetSpec[] = [
  {
    id: 'studio_soft',
    label: 'Studio Soft',
    description: 'Balanced 3-point diffused portrait softboxes',
    exposure: 1.08,
    environmentIntensity: 0.46,
    bgColor: '#181f29',
    backdropStops: ['#121821', '#222b38', '#2d3746', '#1c222b', '#11151b'],
    shadowFloorOpacity: 0.32,
    contactShadowOpacity: 0.75,
    keyLight: {
      color: '#fff3e6',
      intensity: 2.05,
      position: [2.2, 3.2, 3.0],
    },
    rimLight: {
      color: '#9ecaf2',
      intensity: 1.25,
      position: [-2.4, 2.4, -2.8],
    },
    fillLight: {
      color: '#f2e4d8',
      intensity: 1.05,
      position: [-2.4, 1.5, 2.4],
    },
    hemiLight: {
      skyColor: '#c8d8eb',
      groundColor: '#524238',
      intensity: 0.88,
    },
    overheadSpot: {
      color: '#ffffff',
      intensity: 0,
      position: [0, 4.2, 0.4],
      angle: 0.68,
      penumbra: 0.6,
      distance: 10,
      decay: 2,
    },
  },
  {
    id: 'harsh_sunlight',
    label: 'Harsh Sunlight',
    description: 'High-contrast direct sun with crisp sky bounce',
    exposure: 1.12,
    environmentIntensity: 0.62,
    bgColor: '#335d8a',
    backdropStops: ['#1b3556', '#335d8a', '#7aa4c9', '#4f483e', '#26231e'],
    shadowFloorOpacity: 0.58,
    contactShadowOpacity: 0.85,
    keyLight: {
      color: '#fff0cc',
      intensity: 4.2,
      position: [3.4, 5.2, 2.2],
    },
    rimLight: {
      color: '#cbe4ff',
      intensity: 0.65,
      position: [-2.8, 3.4, -2.2],
    },
    fillLight: {
      color: '#8fbce6',
      intensity: 0.42,
      position: [-3.0, 1.2, 1.8],
    },
    hemiLight: {
      skyColor: '#7eb8f5',
      groundColor: '#7d6242',
      intensity: 0.72,
    },
    overheadSpot: {
      color: '#fff4d6',
      intensity: 0,
      position: [0, 4.5, 0.4],
      angle: 0.65,
      penumbra: 0.5,
      distance: 10,
      decay: 2,
    },
  },
  {
    id: 'night_operation',
    label: 'Night Operation (Cool Rim)',
    description: 'Low-key moonlight with dramatic cool tactical rim',
    exposure: 1.04,
    environmentIntensity: 0.22,
    bgColor: '#08101c',
    backdropStops: ['#05080f', '#0a1220', '#122238', '#09101a', '#04060a'],
    shadowFloorOpacity: 0.45,
    contactShadowOpacity: 0.88,
    keyLight: {
      color: '#9bb8e8',
      intensity: 0.82,
      position: [2.0, 3.6, 2.6],
    },
    rimLight: {
      color: '#58c4ff',
      intensity: 4.6,
      position: [-2.3, 2.3, -2.6],
    },
    fillLight: {
      color: '#4c74a8',
      intensity: 0.52,
      position: [2.6, 1.6, -1.8],
    },
    hemiLight: {
      skyColor: '#2a4470',
      groundColor: '#0d131d',
      intensity: 0.52,
    },
    overheadSpot: {
      color: '#7ac8ff',
      intensity: 0,
      position: [0, 4.0, 0.2],
      angle: 0.6,
      penumbra: 0.7,
      distance: 10,
      decay: 2,
    },
  },
  {
    id: 'indoor_warehouse',
    label: 'Indoor Warehouse',
    description: 'Overhead high-bay fluorescents & warm sodium bounce',
    exposure: 1.05,
    environmentIntensity: 0.52,
    bgColor: '#1c2220',
    backdropStops: ['#141917', '#1f2623', '#2d332f', '#24231f', '#151513'],
    shadowFloorOpacity: 0.48,
    contactShadowOpacity: 0.82,
    keyLight: {
      color: '#e4f5ea',
      intensity: 1.85,
      position: [0.8, 5.4, 1.6],
    },
    rimLight: {
      color: '#ffae5c',
      intensity: 1.75,
      position: [-3.0, 2.2, -1.6],
    },
    fillLight: {
      color: '#a8c2b8',
      intensity: 0.68,
      position: [2.6, 1.3, 1.8],
    },
    hemiLight: {
      skyColor: '#9ab0a8',
      groundColor: '#3b3730',
      intensity: 0.6,
    },
    overheadSpot: {
      color: '#e6f7ee',
      intensity: 18.0,
      position: [0.15, 4.1, 0.45],
      angle: 0.68,
      penumbra: 0.65,
      distance: 10,
      decay: 1.8,
    },
  },
] as const;

export function getLightingPreset(id: string): LightingPresetSpec {
  return LIGHTING_PRESETS.find((p) => p.id === id) ?? LIGHTING_PRESETS[0];
}
