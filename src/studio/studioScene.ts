import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  buildHeroCharacter,
  BuiltCharacter,
  enforceCharacterShadows,
} from '../character/characterBuilder';
import {
  ANIMATION_NAMES,
  AnimationName,
  createCharacterAnimations,
  createMaskedLowerBodyClip,
  createMaskedUpperBodyClip,
} from '../character/animations';
import { FACIAL_MORPH_NAMES, FacialMorphName } from '../character/headSculpt';
import {
  computeAimPitchDistribution,
  ControllerState,
  createInitialControllerState,
  dampScalar,
  InputState,
  stepCombatController,
  stepWeaponIndex,
  WheelStepDebouncer,
} from '../character/controllerMath';
import { tacticalAudio } from './audio';
import {
  DEFAULT_LIGHTING_PRESET,
  getLightingPreset,
  LIGHTING_PRESETS,
  LightingPresetKey,
  LightingPresetSpec,
} from './lightingPresets';
import { bakeEnvironmentPMREM } from './ProceduralTextureFactory';
import { exportSceneObjectToGLB, triggerGlbDownload } from './GLBExporter';
import type { CharacterLodLevel, GlbExportMetrics } from '../types/studioTypes';
import {
  createInitialWeaponCombatState,
  EquippedWeaponId,
  FireMode,
  startWeaponReload,
  stepWeaponMechanics,
  switchWeaponState,
  toggleWeaponFireMode,
  WEAPON_ORDER,
  WEAPON_SPECS,
  WeaponCombatState,
  WeaponId,
} from '../weapons/weaponTypes';
import { createWeaponMaterials, WeaponMaterialLibrary } from '../weapons/weaponMaterials';
import { BuiltWeapon, updateWeaponLiveAmmoVisuals } from '../weapons/weaponGeoHelpers';
import { buildWeaponArsenal } from '../weapons/weaponModels';
import { WeaponIKController } from '../weapons/weaponIK';
import { CombatFXSystem } from '../weapons/combatFX';
import { weaponAudio } from '../weapons/weaponAudio';

export { DEFAULT_LIGHTING_PRESET, LIGHTING_PRESETS, WEAPON_ORDER, WEAPON_SPECS };
export type {
  CharacterLodLevel,
  EquippedWeaponId,
  FireMode,
  LightingPresetKey,
  LightingPresetSpec,
  WeaponId,
};

export interface WeaponHUDState {
  equipped: EquippedWeaponId;
  mag: number;
  magSize: number;
  reserve: number;
  fireMode: FireMode | null;
  isReloading: boolean;
  reloadProgress: number;
  isInspecting: boolean;
  laserEnabled: boolean;
  reticleSpread: number;
  gunTurntable: boolean;
}

export type CameraPresetKey =
  | 'full_body'
  | 'face_macro'
  | 'jacket_gear'
  | 'forearms_gloves'
  | 'boots_knees';

export type StudioMode = 'inspect' | 'combat';

export interface CameraPresetSpec {
  id: CameraPresetKey;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export const CAMERA_PRESETS: CameraPresetSpec[] = [
  {
    id: 'full_body',
    label: 'Full Body',
    position: [0.32, 1.02, 3.65],
    target: [0, 0.88, 0],
  },
  {
    id: 'face_macro',
    label: 'Face & Eyes',
    position: [0.10, 1.73, 0.54],
    target: [0, 1.72, 0.04],
  },
  {
    id: 'jacket_gear',
    label: 'Jacket & Grommets',
    position: [0.18, 1.32, 0.90],
    target: [0, 1.29, 0.05],
  },
  {
    id: 'forearms_gloves',
    label: 'Forearms & Gloves',
    position: [0.58, 1.04, 0.62],
    target: [0.24, 0.98, 0.08],
  },
  {
    id: 'boots_knees',
    label: 'Boots & Knee Pads',
    position: [-0.30, 0.40, 1.22],
    target: [-0.02, 0.28, 0.04],
  },
];

export interface StudioCallbacks {
  onAnimChange?: (name: AnimationName) => void;
  onStatsReady?: (stats: BuiltCharacter['stats']) => void;
  onModeChange?: (mode: StudioMode) => void;
  onAimStateChange?: (isAiming: boolean) => void;
  onAwmScopeChange?: (active: boolean) => void;
  onWeaponStateChange?: (weaponState: WeaponHUDState) => void;
}

export interface StudioDisplayOptions {
  wireframe?: boolean;
  skeleton?: boolean;
  autoRotate?: boolean;
  playbackSpeed?: number;
  lod?: CharacterLodLevel;
}

function detectSoftwareWebGL(): boolean {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
}

/** Creates a smooth radial contact shadow catcher texture placed at y = 0.002 under pelvis */
function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size * 0.5;
  const cy = size * 0.5;

  ctx.clearRect(0, 0, size, size);
  const grad = ctx.createRadialGradient(cx, cy, size * 0.04, cx, cy, size * 0.46);
  grad.addColorStop(0.0, 'rgba(5, 7, 10, 0.65)');
  grad.addColorStop(0.32, 'rgba(7, 9, 13, 0.36)');
  grad.addColorStop(0.68, 'rgba(8, 10, 14, 0.12)');
  grad.addColorStop(1.0, 'rgba(8, 10, 14, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Paints a smooth studio cyclorama vertical gradient onto a reusable canvas */
function paintBackdropGradient(
  canvas: HTMLCanvasElement,
  stops: readonly [string, string, string, string, string]
): void {
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0.0, stops[0]);
  grad.addColorStop(0.42, stops[1]);
  grad.addColorStop(0.56, stops[2]);
  grad.addColorStop(0.72, stops[3]);
  grad.addColorStop(1.0, stops[4]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/** Smooth studio gradient cyclorama sky dome texture */
function createStudioBackdropTexture(
  stops: readonly [string, string, string, string, string]
): { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 512;
  paintBackdropGradient(canvas, stops);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return { canvas, tex };
}

/**
 * Procedural anti-aliased fwidth() tactical floor grid + 10m/25m/50m range rings.
 * Marked userData.excludeFromGLB = true and tuned to remain crisp across all 4 lighting modes.
 */
function createTacticalArenaGrid(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMinorColor: { value: new THREE.Color('#78879a') },
      uMajorColor: { value: new THREE.Color('#a4b6cc') },
      uRingColor: { value: new THREE.Color('#ff6a2b') },
      uOpacity: { value: 0.42 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uMinorColor;
      uniform vec3 uMajorColor;
      uniform vec3 uRingColor;
      uniform float uOpacity;
      varying vec3 vWorldPos;

      float gridLine(vec2 coord, float spacing, float widthPx) {
        vec2 p = coord / spacing;
        vec2 g = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(1e-5));
        float line = min(g.x, g.y);
        return 1.0 - min(line / widthPx, 1.0);
      }

      float ringLine(float dist, float radius, float widthPx) {
        float d = abs(dist - radius) / max(fwidth(dist), 1e-5);
        return 1.0 - min(d / widthPx, 1.0);
      }

      void main() {
        vec2 xz = vWorldPos.xz;
        float dist = length(xz);

        float minorG = gridLine(xz, 1.0, 1.15);
        float majorG = gridLine(xz, 5.0, 1.55);

        float r10 = ringLine(dist, 10.0, 1.85);
        float r25 = ringLine(dist, 25.0, 2.0);
        float r50 = ringLine(dist, 50.0, 2.15);
        float rings = max(r10, max(r25, r50));

        // Center tactical crosshair ticks
        float axisX = 1.0 - min(abs(xz.x) / max(fwidth(xz.x), 1e-5) / 1.4, 1.0);
        float axisZ = 1.0 - min(abs(xz.y) / max(fwidth(xz.y), 1e-5) / 1.4, 1.0);
        float centerAxes = max(axisX, axisZ) * smoothstep(2.5, 0.0, dist);

        float fade = 1.0 - smoothstep(14.0, 56.0, dist);
        float alpha = clamp(minorG * 0.34 + majorG * 0.62 + rings * 0.92 + centerAxes * 0.55, 0.0, 1.0);
        alpha *= fade * uOpacity;

        if (alpha < 0.01) discard;

        vec3 col = mix(uMinorColor, uMajorColor, clamp(majorG + centerAxes * 0.5, 0.0, 1.0));
        col = mix(col, uRingColor, clamp(rings, 0.0, 1.0));

        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const geo = new THREE.PlaneGeometry(120, 120, 1, 1);
  geo.rotateX(-Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'Arena_Tactical_Grid';
  mesh.position.y = 0.0006;
  mesh.renderOrder = 1;
  mesh.userData.excludeFromGLB = true;
  return { mesh, material };
}

declare global {
  interface Window {
    __charStudio?: {
      setAnim: (name: string, t?: number) => void;
      setCamera: (preset: string, immediate?: boolean) => void;
      setCustomCamera: (pos: [number, number, number], target: [number, number, number]) => void;
      setMorph: (name: string, val: number) => void;
      setMode: (mode: StudioMode) => void;
      setLighting: (preset: string) => void;
      setDisplay: (opts: StudioDisplayOptions) => void;
      setWeapon: (id: EquippedWeaponId) => void;
      setGunTurntable: (enabled: boolean) => void;
      setAim: (aiming: boolean) => void;
      setInspect: (inspecting: boolean) => void;
      setLaser: (enabled: boolean) => void;
      setCombatInput: (partial: Partial<InputState>, steps?: number) => void;
      setCombatPitch: (pitchRad: number) => void;
      stepWheel: (deltaY: number, nowMs?: number) => EquippedWeaponId;
      triggerFire: () => void;
      setReloadProgress: (progress: number | null) => void;
      setMagCount: (count: number) => void;
      exportGLBBase64: () => Promise<string>;
      exportGLBWithMetrics: () => Promise<GlbExportMetrics>;
      exportWeaponGLBBase64: (id?: WeaponId) => Promise<string>;
      loadExportedGLBBase64: (base64: string) => Promise<{
        meshCount: number;
        boneCount: number;
        animCount: number;
        morphCount: number;
      }>;
      restoreProceduralCharacter: () => void;
      getStats: () => Record<string, unknown>;
      getWeaponState: () => WeaponHUDState;
      getAdsBlend: () => number;
      getAwmScopeActive: () => boolean;
      getCameraState: () => { pos: number[]; target: number[]; fov: number; near: number };
    };
  }
}

export class CharacterStudioEngine {
  private container: HTMLElement;
  private callbacks: StudioCallbacks;
  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private timer: THREE.Timer;

  private character: BuiltCharacter;
  private clips: THREE.AnimationClip[];
  private mixer: THREE.AnimationMixer;
  private actions: Map<AnimationName, THREE.AnimationAction> = new Map();
  private lowerActions: Map<AnimationName, THREE.AnimationAction> = new Map();
  private upperAimAction: THREE.AnimationAction | null = null;
  private activeAction: THREE.AnimationAction | null = null;
  private activeLowerAction: THREE.AnimationAction | null = null;
  private isLayeredAimActive = false;
  private activeAnimName: AnimationName = 'Idle_Natural';
  private playbackSpeed = 1.0;
  private animLockedTime: number | null = null;

  private skeletonHelper: THREE.SkeletonHelper;
  private contactShadowMesh: THREE.Mesh;
  private contactShadowMat: THREE.MeshBasicMaterial;
  private floorShadowMat: THREE.ShadowMaterial;
  private arenaGridMesh: THREE.Mesh;
  private arenaGridMat: THREE.ShaderMaterial;
  private keyLight: THREE.DirectionalLight;
  private keyLightOffset = new THREE.Vector3(3.4, 5.2, 3.8);
  private rimLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private overheadSpot: THREE.SpotLight;
  private muzzleLight: THREE.PointLight;
  private backdropCanvas: HTMLCanvasElement;
  private backdropTex: THREE.CanvasTexture;
  private shadowTex: THREE.CanvasTexture;
  private envCache: Map<LightingPresetKey, THREE.Texture> = new Map();
  private activeLighting: LightingPresetKey = DEFAULT_LIGHTING_PRESET;

  // Reloaded GLB proof overlay (used only during automated GLB round-trip verification)
  private reloadedGroup: THREE.Group | null = null;
  private reloadedMixer: THREE.AnimationMixer | null = null;

  // Camera transition damping
  private camLerpActive = false;
  private camTargetPos = new THREE.Vector3(0.32, 1.02, 3.65);
  private camTargetLook = new THREE.Vector3(0, 0.88, 0);

  // Mode & Live Combat Controller state
  private mode: StudioMode = 'inspect';
  private ctrlState: ControllerState = createInitialControllerState();
  private inputState: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false,
    crouch: false,
    aim: false,
    jumpPressed: false,
    firePressed: false,
    isArmed: true,
  };
  private combatCamYaw = 0; // 0 = camera behind -Z looking toward +Z
  private combatCamPitch = 0.04;
  private isDraggingCombat = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastReportedAim = false;
  private awmScopeActive = false;
  private manualMorphOverrides: Partial<Record<FacialMorphName, number>> = {};

  // 5-Weapon Tactical Arsenal, 2-Bone Analytical IK & Combat FX
  private weaponMaterials: WeaponMaterialLibrary;
  private weaponArsenal: Record<WeaponId, BuiltWeapon>;
  private weaponContainer: THREE.Group;
  private weaponIK: WeaponIKController;
  private combatFX: CombatFXSystem;
  private weaponState: WeaponCombatState = createInitialWeaponCombatState('mk18');
  private gunTurntable = false;
  private reloadLockedProgress: number | null = null;
  private inspectAimOverride = false;
  private lastWeaponHudEmit = 0;

  // Single-listener AbortController & Mouse-Wheel Debouncer
  private eventAbortController = new AbortController();
  private wheelDebouncer = new WheelStepDebouncer(40, 150);

  // Reusable scratch math objects (ZERO per-frame GC!)
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();
  private readonly _v4 = new THREE.Vector3();
  private readonly _q1 = new THREE.Quaternion();
  private readonly _raycaster = new THREE.Raycaster();
  private readonly _ndcCenter = new THREE.Vector2(0, 0);
  private readonly _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly _xAxis = new THREE.Vector3(1, 0, 0);
  private readonly _yAxis = new THREE.Vector3(0, 1, 0);

  private frameId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, callbacks: StudioCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    const defaultLighting = getLightingPreset(this.activeLighting);

    // 1. Renderer — Three.js r187 modern PBR pipeline with PCFSoftShadowMap ALWAYS enabled
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = defaultLighting.exposure;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setSize(container.clientWidth || 1440, container.clientHeight || 900);
    container.appendChild(this.renderer.domElement);

    // 2. Scene + Per-Environment Procedural PMREM IBL
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(defaultLighting.bgColor);

    const initEnv = this.getOrBakeEnvironment(this.activeLighting);
    this.scene.environment = initEnv;
    this.scene.environmentIntensity = defaultLighting.environmentIntensity;

    // Smooth gradient studio cyclorama dome
    const backdrop = createStudioBackdropTexture(defaultLighting.backdropStops);
    this.backdropCanvas = backdrop.canvas;
    this.backdropTex = backdrop.tex;
    const domeGeo = new THREE.SphereGeometry(62, 32, 24);
    const domeMat = new THREE.MeshBasicMaterial({
      map: this.backdropTex,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.name = 'Studio_Cyclorama_Backdrop';
    domeMesh.userData.excludeFromGLB = true;
    this.scene.add(domeMesh);

    // Studio floor shadow catcher + procedural fwidth() arena tactical grid + ground contact shadow (y = 0.002)
    this.floorShadowMat = new THREE.ShadowMaterial({ opacity: defaultLighting.shadowFloorOpacity });
    const floorMesh = new THREE.Mesh(new THREE.CircleGeometry(36, 64), this.floorShadowMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0.0;
    floorMesh.receiveShadow = true;
    floorMesh.name = 'Studio_Shadow_Floor';
    floorMesh.userData.excludeFromGLB = true;
    this.scene.add(floorMesh);

    const grid = createTacticalArenaGrid();
    this.arenaGridMesh = grid.mesh;
    this.arenaGridMat = grid.material;
    this.scene.add(this.arenaGridMesh);

    this.shadowTex = createContactShadowTexture();
    this.contactShadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: defaultLighting.contactShadowOpacity,
    });
    this.contactShadowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 48),
      this.contactShadowMat
    );
    this.contactShadowMesh.rotation.x = -Math.PI / 2;
    this.contactShadowMesh.position.y = 0.002;
    this.contactShadowMesh.name = 'Studio_Contact_Shadow';
    this.contactShadowMesh.userData.excludeFromGLB = true;
    this.scene.add(this.contactShadowMesh);

    // 3. Dynamic Multi-Environment PBR Lighting Rig (2048x2048 PCFSoftShadowMap, ±3.0m dynamic tracking)
    this.keyLight = new THREE.DirectionalLight(
      defaultLighting.keyLight.color,
      defaultLighting.keyLight.intensity
    );
    this.keyLightOffset.set(...defaultLighting.keyLight.position);
    this.keyLight.position.copy(this.keyLightOffset);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 20;
    this.keyLight.shadow.camera.left = -3.0;
    this.keyLight.shadow.camera.right = 3.0;
    this.keyLight.shadow.camera.top = 3.0;
    this.keyLight.shadow.camera.bottom = -3.0;
    this.keyLight.shadow.bias = -0.0003;
    this.keyLight.shadow.normalBias = 0.012;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(
      defaultLighting.rimLight.color,
      defaultLighting.rimLight.intensity
    );
    this.rimLight.position.set(...defaultLighting.rimLight.position);
    this.scene.add(this.rimLight);

    this.fillLight = new THREE.DirectionalLight(
      defaultLighting.fillLight.color,
      defaultLighting.fillLight.intensity
    );
    this.fillLight.position.set(...defaultLighting.fillLight.position);
    this.scene.add(this.fillLight);

    this.hemiLight = new THREE.HemisphereLight(
      defaultLighting.hemiLight.skyColor,
      defaultLighting.hemiLight.groundColor,
      defaultLighting.hemiLight.intensity
    );
    this.scene.add(this.hemiLight);

    this.overheadSpot = new THREE.SpotLight(
      defaultLighting.overheadSpot.color,
      defaultLighting.overheadSpot.intensity,
      defaultLighting.overheadSpot.distance,
      defaultLighting.overheadSpot.angle,
      defaultLighting.overheadSpot.penumbra,
      defaultLighting.overheadSpot.decay
    );
    this.overheadSpot.position.set(...defaultLighting.overheadSpot.position);
    this.overheadSpot.target.position.set(0, 1.05, 0);
    this.scene.add(this.overheadSpot);
    this.scene.add(this.overheadSpot.target);

    this.muzzleLight = new THREE.PointLight(0xffb454, 0, 4.5, 2);
    this.muzzleLight.position.set(0, 1.38, 0.72);
    this.scene.add(this.muzzleLight);

    // 4. Camera (camera.near = 0.05) & OrbitControls
    const aspect = (container.clientWidth || 1440) / (container.clientHeight || 900);
    this.camera = new THREE.PerspectiveCamera(36, aspect, 0.05, 110);
    this.camera.position.set(0.32, 1.02, 3.65);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.88, 0);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 0.34;
    this.controls.maxDistance = 6.5;
    this.controls.maxPolarAngle = Math.PI * 0.51;
    this.controls.addEventListener('start', () => {
      this.camLerpActive = false;
    });
    this.controls.update();

    // 5. Build Hero Character + 11 UE5 Animations + Masked Upper/Lower Layering
    this.character = buildHeroCharacter();
    this.scene.add(this.character.root);

    this.skeletonHelper = new THREE.SkeletonHelper(this.character.root);
    this.skeletonHelper.visible = false;
    this.skeletonHelper.userData.excludeFromGLB = true;
    this.scene.add(this.skeletonHelper);

    this.clips = createCharacterAnimations(this.character.rig);
    this.mixer = new THREE.AnimationMixer(this.character.root);
    for (const clip of this.clips) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name as AnimationName, action);

      // Masked lower-body locomotion clips for ADS movement/strafing without upper-body pitch interference
      const lowerClip = createMaskedLowerBodyClip(clip);
      const lowerAct = this.mixer.clipAction(lowerClip);
      this.lowerActions.set(clip.name as AnimationName, lowerAct);

      if (clip.name === 'Combat_Aim_Stance') {
        const upperClip = createMaskedUpperBodyClip(clip);
        this.upperAimAction = this.mixer.clipAction(upperClip);
      }
    }

    this.playAnimation('Idle_Natural', 0);

    // 5b. Build 5-Weapon Tactical Arsenal + 2-Bone Analytical IK + Combat VFX
    this.weaponMaterials = createWeaponMaterials();
    this.weaponArsenal = buildWeaponArsenal(this.weaponMaterials);
    this.weaponContainer = new THREE.Group();
    this.weaponContainer.name = 'Active_Weapon_Container';
    this.scene.add(this.weaponContainer);
    for (const id of WEAPON_ORDER) {
      const w = this.weaponArsenal[id];
      w.root.visible = id === this.weaponState.equipped;
      this.weaponContainer.add(w.root);
    }
    this.character.setHolsteredPistolVisible(this.weaponState.equipped !== 'glock19');
    enforceCharacterShadows(this.character.root);
    enforceCharacterShadows(this.weaponContainer);

    this.weaponIK = new WeaponIKController(this.character.rig);
    this.combatFX = new CombatFXSystem(this.scene);

    this.updateArenaGridStyle(this.activeLighting);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 6. Three.js r187 Timer
    this.timer = new THREE.Timer();

    // 7. Listeners & Automation API
    this.bindEvents();
    this.exposeAutomationAPI();
    this.callbacks.onStatsReady?.(this.character.stats);
    this.emitWeaponHud(true);

    this.tick();
  }

  private getOrBakeEnvironment(presetId: LightingPresetKey): THREE.Texture {
    const cached = this.envCache.get(presetId);
    if (cached) return cached;
    const baked = bakeEnvironmentPMREM(this.renderer, presetId);
    this.envCache.set(presetId, baked);
    return baked;
  }

  private updateArenaGridStyle(presetId: LightingPresetKey): void {
    const u = this.arenaGridMat.uniforms;
    if (presetId === 'harsh_sunlight') {
      u.uMinorColor.value.set('#586575');
      u.uMajorColor.value.set('#364352');
      u.uRingColor.value.set('#d94a0e');
      u.uOpacity.value = 0.48;
    } else if (presetId === 'night_operation') {
      u.uMinorColor.value.set('#3c5978');
      u.uMajorColor.value.set('#6da1d4');
      u.uRingColor.value.set('#ff5b1f');
      u.uOpacity.value = 0.52;
    } else if (presetId === 'indoor_warehouse') {
      u.uMinorColor.value.set('#7a7368');
      u.uMajorColor.value.set('#aba08e');
      u.uRingColor.value.set('#ff702e');
      u.uOpacity.value = 0.45;
    } else {
      u.uMinorColor.value.set('#7c8b9e');
      u.uMajorColor.value.set('#b2c2d6');
      u.uRingColor.value.set('#ff5e1a');
      u.uOpacity.value = 0.42;
    }
  }

  private bindEvents(): void {
    const signal = this.eventAbortController.signal;
    window.addEventListener('resize', this.handleResize, { signal });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.container);
    }
    window.addEventListener('keydown', this.handleKeyDown, { signal });
    window.addEventListener('keyup', this.handleKeyUp, { signal });

    const dom = this.renderer.domElement;
    dom.addEventListener('mousedown', this.handleMouseDown, { signal });
    // Single debounced wheel listener via AbortController
    dom.addEventListener('wheel', this.handleWheel, { passive: true, signal });
    window.addEventListener('mouseup', this.handleMouseUp, { signal });
    window.addEventListener('mousemove', this.handleMouseMove, { signal });
    dom.addEventListener('contextmenu', this.handleContextMenu, { signal });
    dom.addEventListener('webglcontextlost', this.handleContextLost, { signal });
  }

  private handleResize = () => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.render(this.scene, this.camera);
  };

  private handleContextMenu = (e: MouseEvent) => {
    if (this.mode === 'combat') e.preventDefault();
  };

  private handleContextLost = (e: Event) => {
    e.preventDefault();
  };

  private stepWeaponByWheel(deltaY: number, nowMs: number): EquippedWeaponId {
    const step = this.wheelDebouncer.consume(deltaY, nowMs);
    if (step === 0) return this.weaponState.equipped;
    const curIdx =
      this.weaponState.equipped === 'none'
        ? 0
        : WEAPON_ORDER.indexOf(this.weaponState.equipped);
    const nextIdx = stepWeaponIndex(curIdx, step, WEAPON_ORDER.length);
    const nextId = WEAPON_ORDER[nextIdx];
    this.setWeapon(nextId);
    return nextId;
  }

  private handleWheel = (e: WheelEvent) => {
    if (this.mode !== 'combat' || this.gunTurntable) return;
    this.stepWeaponByWheel(e.deltaY, performance.now());
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (!e.repeat) {
      switch (e.code) {
        case 'Digit1':
          this.setWeapon('mk18');
          return;
        case 'Digit2':
          this.setWeapon('ak74m');
          return;
        case 'Digit3':
          this.setWeapon('m870');
          return;
        case 'Digit4':
          this.setWeapon('awm');
          return;
        case 'Digit5':
          this.setWeapon('glock19');
          return;
        case 'Digit0':
          if (!this.gunTurntable) this.setWeapon('none');
          return;
        case 'KeyR':
          this.triggerReload();
          return;
        case 'KeyB':
          this.toggleFireMode();
          return;
        case 'KeyI':
          this.toggleWeaponInspect();
          return;
        case 'KeyL':
          this.toggleLaser();
          return;
      }
    }

    if (this.mode !== 'combat') return;
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.inputState.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.inputState.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.inputState.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.inputState.right = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.inputState.sprint = true;
        break;
      case 'KeyC':
        if (!e.repeat) this.inputState.crouch = !this.inputState.crouch;
        break;
      case 'Space':
        e.preventDefault();
        this.inputState.jumpPressed = true;
        break;
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.inputState.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.inputState.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.inputState.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.inputState.right = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.inputState.sprint = false;
        break;
      case 'Space':
        this.inputState.jumpPressed = false;
        break;
    }
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (this.mode !== 'combat') return;
    if (e.button === 2) {
      this.inputState.aim = true;
      this.isDraggingCombat = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    } else if (e.button === 0) {
      this.inputState.firePressed = true;
      this.isDraggingCombat = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    }
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (e.button === 2) {
      this.inputState.aim = false;
    } else if (e.button === 0) {
      this.inputState.firePressed = false;
    }
    if (!this.inputState.aim && !this.inputState.firePressed) {
      this.isDraggingCombat = false;
    }
  };

  private handleMouseMove = (e: MouseEvent) => {
    if (this.mode !== 'combat') return;
    if (this.isDraggingCombat || this.inputState.aim) {
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.combatCamYaw -= dx * 0.0052;
      this.combatCamPitch = Math.max(-0.55, Math.min(0.55, this.combatCamPitch + dy * 0.0042));
    } else {
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    }
  };

  private stopLayeredAimActions(): void {
    if (!this.isLayeredAimActive) return;
    this.isLayeredAimActive = false;
    if (this.upperAimAction) {
      this.upperAimAction.stop();
    }
    if (this.activeLowerAction) {
      this.activeLowerAction.stop();
      this.activeLowerAction = null;
    }
  }

  /**
   * Masked skeletal animation layering during Combat ADS:
   * Plays lower-body locomotion (`pelvis`/legs) independently beneath upper-body `Combat_Aim_Stance` (`spine_02+`)
   * so Strafe Left / Strafe Right during RMB ADS NEVER pitches AK-74M or any rifle skyward!
   */
  private syncLayeredAimActions(lowerClipName: AnimationName): void {
    const nextLower = this.lowerActions.get(lowerClipName);
    if (!nextLower || !this.upperAimAction) return;

    if (!this.isLayeredAimActive) {
      if (this.activeAction) {
        this.activeAction.stop();
        this.activeAction = null;
      }
      this.isLayeredAimActive = true;
      this.upperAimAction.reset();
      this.upperAimAction.enabled = true;
      this.upperAimAction.paused = false;
      this.upperAimAction.setEffectiveTimeScale(this.playbackSpeed);
      this.upperAimAction.setEffectiveWeight(1);
      this.upperAimAction.play();
    }

    if (this.activeLowerAction !== nextLower) {
      nextLower.reset();
      nextLower.enabled = true;
      nextLower.paused = false;
      nextLower.setEffectiveTimeScale(this.playbackSpeed);
      nextLower.setEffectiveWeight(1);
      nextLower.play();
      if (this.activeLowerAction) {
        this.activeLowerAction.crossFadeTo(nextLower, 0.14, false);
      }
      this.activeLowerAction = nextLower;
    }

    if (this.activeAnimName !== lowerClipName) {
      this.activeAnimName = lowerClipName;
      this.callbacks.onAnimChange?.(lowerClipName);
    }
  }

  public playAnimation(name: AnimationName, fadeDuration = 0.22): void {
    this.stopLayeredAimActions();
    const next = this.actions.get(name);
    if (!next) return;
    this.animLockedTime = null;

    if (this.activeAction === next) {
      next.paused = false;
      return;
    }

    next.reset();
    next.enabled = true;
    next.paused = false;
    next.setEffectiveTimeScale(this.playbackSpeed);
    next.setEffectiveWeight(1);
    next.play();

    if (this.activeAction && fadeDuration > 0) {
      this.activeAction.crossFadeTo(next, fadeDuration, false);
    } else if (this.activeAction) {
      this.activeAction.stop();
    }

    this.activeAction = next;
    this.activeAnimName = name;
    this.callbacks.onAnimChange?.(name);
  }

  /**
   * Bone-Anchored Camera Presets:
   * Resolves Face & Eyes (head bone normal, framing above raised Glock 19 hands when equipped),
   * Forearms & Gloves (lowerarm_l / hand_l midpoint), Jacket & Grommets (spine_03),
   * and Boots & Knee Pads (calf_l / foot_l) dynamically via skeleton.getBoneByName(...)!
   */
  public setCameraPreset(presetId: CameraPresetKey, immediate = false): void {
    this.character.root.updateMatrixWorld(true);
    const skel = this.character.rig.skeleton;
    const basePos = this.character.root.position;

    if (presetId === 'face_macro') {
      const headBone = skel.getBoneByName('head');
      if (headBone) {
        const headWorld = new THREE.Vector3();
        const headQuat = new THREE.Quaternion();
        headBone.getWorldPosition(headWorld);
        headBone.getWorldQuaternion(headQuat);
        const headFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(headQuat).normalize();
        const headRight = new THREE.Vector3(-1, 0, 0).applyQuaternion(headQuat).normalize();
        // Frame face above raised pistol hands whenever GLOCK 19 TAC is equipped!
        const isPistol = this.weaponState.equipped === 'glock19';
        const camElev = isPistol ? 0.11 : 0.018;
        const camDist = isPistol ? 0.48 : 0.42;
        const lookY = headWorld.y + 0.080;
        this.camTargetLook.set(headWorld.x, lookY, headWorld.z + 0.025);
        this.camTargetPos
          .copy(this.camTargetLook)
          .addScaledVector(headFwd, camDist)
          .addScaledVector(headRight, -0.075)
          .add(new THREE.Vector3(0, camElev, 0));
      }
    } else if (presetId === 'forearms_gloves') {
      const lowerL = skel.getBoneByName('lowerarm_l');
      const handL = skel.getBoneByName('hand_l');
      if (lowerL && handL) {
        const pL = new THREE.Vector3();
        const pH = new THREE.Vector3();
        lowerL.getWorldPosition(pL);
        handL.getWorldPosition(pH);
        const mid = pL.add(pH).multiplyScalar(0.5);
        this.camTargetLook.copy(mid);
        this.camTargetPos.set(mid.x + 0.34, mid.y + 0.07, mid.z + 0.48);
      }
    } else if (presetId === 'jacket_gear') {
      const spine3 = skel.getBoneByName('spine_03');
      if (spine3) {
        const p = new THREE.Vector3();
        spine3.getWorldPosition(p);
        this.camTargetLook.set(p.x, p.y - 0.02, p.z + 0.04);
        this.camTargetPos.set(p.x + 0.22, p.y + 0.04, p.z + 0.88);
      }
    } else if (presetId === 'boots_knees') {
      const calfL = skel.getBoneByName('calf_l');
      const footL = skel.getBoneByName('foot_l');
      if (calfL && footL) {
        const pC = new THREE.Vector3();
        const pF = new THREE.Vector3();
        calfL.getWorldPosition(pC);
        footL.getWorldPosition(pF);
        const mid = pC.add(pF).multiplyScalar(0.5);
        this.camTargetLook.set(basePos.x, mid.y + 0.04, mid.z + 0.03);
        this.camTargetPos.set(basePos.x - 0.32, mid.y + 0.14, mid.z + 1.16);
      }
    } else {
      const spec = CAMERA_PRESETS.find((p) => p.id === presetId) ?? CAMERA_PRESETS[0];
      this.camTargetPos.set(
        spec.position[0] + basePos.x,
        spec.position[1],
        spec.position[2] + basePos.z
      );
      this.camTargetLook.set(
        spec.target[0] + basePos.x,
        spec.target[1],
        spec.target[2] + basePos.z
      );
    }

    if (immediate) {
      this.camera.position.copy(this.camTargetPos);
      this.controls.target.copy(this.camTargetLook);
      this.controls.update();
      this.camLerpActive = false;
    } else {
      this.camLerpActive = true;
    }
  }

  private setAwmScopeActive(active: boolean): void {
    if (this.awmScopeActive === active) return;
    this.awmScopeActive = active;
    if (active) {
      this.character.root.visible = false;
      const w = this.getActiveWeapon();
      if (w) w.root.visible = false;
    } else {
      this.character.root.visible = !this.gunTurntable;
      for (const wid of WEAPON_ORDER) {
        this.weaponArsenal[wid].root.visible = wid === this.weaponState.equipped;
      }
    }
    this.callbacks.onAwmScopeChange?.(active);
  }

  public setMode(mode: StudioMode): void {
    if (this.mode === mode) return;
    if (mode === 'combat' && this.gunTurntable) {
      this.setGunTurntable(false);
    }
    this.setAwmScopeActive(false);
    this.mode = mode;
    if (mode === 'combat') {
      this.controls.enabled = false;
      this.camLerpActive = false;
      this.ctrlState = createInitialControllerState();
      this.ctrlState.posX = this.character.root.position.x;
      this.ctrlState.posZ = this.character.root.position.z;
      this.ctrlState.yaw = this.character.root.rotation.y;
      this.combatCamYaw = this.ctrlState.yaw;
      this.combatCamPitch = 0.04;
      this.camera.fov = 60;
      this.camera.near = 0.05;
      this.camera.updateProjectionMatrix();
    } else {
      this.stopLayeredAimActions();
      this.controls.enabled = true;
      this.inputState.forward = false;
      this.inputState.backward = false;
      this.inputState.left = false;
      this.inputState.right = false;
      this.inputState.sprint = false;
      this.inputState.crouch = false;
      this.inputState.aim = false;
      this.inputState.firePressed = false;
      this.inputState.jumpPressed = false;
      this.character.root.position.set(0, 0, 0);
      this.character.root.rotation.set(0, 0, 0);
      this.contactShadowMesh.position.set(0, 0.002, 0);
      this.muzzleLight.intensity = 0;
      this.camera.fov = 36;
      this.camera.near = 0.05;
      this.camera.updateProjectionMatrix();
      this.setCameraPreset('full_body', false);
      this.playAnimation('Idle_Natural', 0.22);
      if (this.lastReportedAim) {
        this.lastReportedAim = false;
        this.callbacks.onAimStateChange?.(false);
      }
    }
    this.callbacks.onModeChange?.(mode);
  }

  public setMorphOverride(name: FacialMorphName, value: number | null): void {
    if (value === null) {
      delete this.manualMorphOverrides[name];
    } else {
      this.manualMorphOverrides[name] = value;
      this.character.setMorphTarget(name, value);
    }
  }

  public setDisplayOptions(opts: StudioDisplayOptions): void {
    if (opts.wireframe !== undefined) {
      this.character.setWireframe(opts.wireframe);
    }
    if (opts.skeleton !== undefined) {
      this.skeletonHelper.visible = opts.skeleton;
    }
    if (opts.autoRotate !== undefined) {
      this.controls.autoRotate = !this.isSoftwareGl && opts.autoRotate;
      this.controls.autoRotateSpeed = 1.6;
    }
    if (opts.playbackSpeed !== undefined) {
      this.playbackSpeed = opts.playbackSpeed;
      if (this.activeAction) {
        this.activeAction.setEffectiveTimeScale(this.playbackSpeed);
      }
      if (this.activeLowerAction) {
        this.activeLowerAction.setEffectiveTimeScale(this.playbackSpeed);
      }
      if (this.upperAimAction) {
        this.upperAimAction.setEffectiveTimeScale(this.playbackSpeed);
      }
    }
    if (opts.lod !== undefined) {
      this.character.setLod(opts.lod);
      enforceCharacterShadows(this.character.root);
    }
  }

  public setLightingPreset(presetId: LightingPresetKey): void {
    const spec = getLightingPreset(presetId);
    this.activeLighting = spec.id;

    this.renderer.toneMappingExposure = spec.exposure;
    this.scene.environment = this.getOrBakeEnvironment(spec.id);
    this.scene.environmentIntensity = spec.environmentIntensity;
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.set(spec.bgColor);
    } else {
      this.scene.background = new THREE.Color(spec.bgColor);
    }

    paintBackdropGradient(this.backdropCanvas, spec.backdropStops);
    this.backdropTex.needsUpdate = true;

    this.floorShadowMat.opacity = spec.shadowFloorOpacity;
    this.contactShadowMat.opacity = spec.contactShadowOpacity;

    this.keyLight.color.set(spec.keyLight.color);
    this.keyLight.intensity = spec.keyLight.intensity;
    this.keyLightOffset.set(...spec.keyLight.position);
    this.updateDynamicShadowBounds();

    this.rimLight.color.set(spec.rimLight.color);
    this.rimLight.intensity = spec.rimLight.intensity;
    this.rimLight.position.set(...spec.rimLight.position);

    this.fillLight.color.set(spec.fillLight.color);
    this.fillLight.intensity = spec.fillLight.intensity;
    this.fillLight.position.set(...spec.fillLight.position);

    this.hemiLight.color.set(spec.hemiLight.skyColor);
    this.hemiLight.groundColor.set(spec.hemiLight.groundColor);
    this.hemiLight.intensity = spec.hemiLight.intensity;

    this.overheadSpot.color.set(spec.overheadSpot.color);
    this.overheadSpot.intensity = spec.overheadSpot.intensity;
    this.overheadSpot.position.set(...spec.overheadSpot.position);
    this.overheadSpot.angle = spec.overheadSpot.angle;
    this.overheadSpot.penumbra = spec.overheadSpot.penumbra;
    this.overheadSpot.distance = spec.overheadSpot.distance;
    this.overheadSpot.decay = spec.overheadSpot.decay;

    this.updateArenaGridStyle(spec.id);
  }

  /**
   * Centers the ±3.0m key light shadow frustum on characterRoot.position and anchors the
   * ground Contact Shadow (y = 0.002) directly beneath the live pelvis bone XZ!
   */
  private updateDynamicShadowBounds(): void {
    const cx = this.character.root.position.x;
    const cy = this.character.root.position.y;
    const cz = this.character.root.position.z;

    this.keyLight.target.position.set(cx, cy + 0.9, cz);
    this.keyLight.position.set(
      cx + this.keyLightOffset.x,
      cy + this.keyLightOffset.y,
      cz + this.keyLightOffset.z
    );
    this.keyLight.target.updateMatrixWorld();

    const pelvis = this.character.rig.skeleton.getBoneByName('pelvis');
    if (pelvis) {
      pelvis.getWorldPosition(this._v4);
      this.contactShadowMesh.position.set(this._v4.x, 0.002, this._v4.z);
    } else {
      this.contactShadowMesh.position.set(cx, 0.002, cz);
    }
    const airScale = Math.max(0.45, 1 - cy * 0.45);
    this.contactShadowMesh.scale.setScalar(airScale);
  }

  public getActiveWeapon(): BuiltWeapon | null {
    if (this.weaponState.equipped === 'none') return null;
    return this.weaponArsenal[this.weaponState.equipped];
  }

  public getWeaponHUDState(): WeaponHUDState {
    const id = this.weaponState.equipped;
    if (id === 'none') {
      return {
        equipped: 'none',
        mag: 0,
        magSize: 0,
        reserve: 0,
        fireMode: null,
        isReloading: false,
        reloadProgress: 0,
        isInspecting: false,
        laserEnabled: this.weaponState.laserEnabled,
        reticleSpread: this.weaponState.reticleSpread,
        gunTurntable: this.gunTurntable,
      };
    }
    const spec = WEAPON_SPECS[id];
    const ammo = this.weaponState.ammo[id];
    return {
      equipped: id,
      mag: ammo.mag,
      magSize: spec.magSize,
      reserve: ammo.reserve,
      fireMode: ammo.fireMode,
      isReloading: this.weaponState.isReloading,
      reloadProgress: this.weaponState.reloadProgress,
      isInspecting: this.weaponState.isInspecting,
      laserEnabled: this.weaponState.laserEnabled,
      reticleSpread: this.weaponState.reticleSpread,
      gunTurntable: this.gunTurntable,
    };
  }

  private emitWeaponHud(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastWeaponHudEmit < 85) return;
    this.lastWeaponHudEmit = now;
    this.callbacks.onWeaponStateChange?.(this.getWeaponHUDState());
  }

  public setWeapon(id: EquippedWeaponId): void {
    if (this.gunTurntable && id === 'none') return;
    this.reloadLockedProgress = null;
    if (id !== 'awm') {
      this.setAwmScopeActive(false);
    }
    const changed = switchWeaponState(this.weaponState, id);
    for (const wid of WEAPON_ORDER) {
      this.weaponArsenal[wid].root.visible = !this.awmScopeActive && wid === id;
    }
    // Show holstered Glock 19 inside right-thigh Kydex holster whenever primary rifle/shotgun/unarmed is active!
    this.character.setHolsteredPistolVisible(id !== 'glock19');
    enforceCharacterShadows(this.character.root);
    enforceCharacterShadows(this.weaponContainer);

    if (changed && id !== 'none') {
      weaponAudio.playMagIn();
      if (this.gunTurntable) {
        this.frameGunTurntable(id, false);
      }
    }
    this.emitWeaponHud(true);
  }

  public toggleFireMode(): void {
    const mode = toggleWeaponFireMode(this.weaponState);
    if (mode) {
      weaponAudio.playDryFire();
      this.emitWeaponHud(true);
    }
  }

  public triggerReload(): void {
    this.reloadLockedProgress = null;
    if (startWeaponReload(this.weaponState)) {
      this.emitWeaponHud(true);
    }
  }

  public toggleWeaponInspect(): void {
    if (this.weaponState.equipped === 'none' || this.gunTurntable) return;
    this.weaponState.isInspecting = !this.weaponState.isInspecting;
    this.weaponState.inspectTime = 0;
    this.emitWeaponHud(true);
  }

  public toggleLaser(): void {
    this.weaponState.laserEnabled = !this.weaponState.laserEnabled;
    weaponAudio.playDryFire();
    this.emitWeaponHud(true);
  }

  public triggerTestShot(): void {
    if (this.weaponState.equipped === 'none') return;
    const w = this.getActiveWeapon();
    if (!w) return;
    this.weaponState.equipBlend = 1;
    this.weaponState.fireCooldown = 0;
    this.weaponState.cycleActive = false;
    this.weaponState.isReloading = false;
    const ev = stepWeaponMechanics(
      this.weaponState,
      true,
      this.inputState.aim || this.inspectAimOverride,
      0,
      0.016,
      0.55
    );
    this.handleWeaponEvents(
      ev,
      w,
      this.weaponState.equipped,
      this.inputState.aim || this.inspectAimOverride
    );
    this.weaponState.triggerHeldPrev = false;
    this.emitWeaponHud(true);
  }

  private frameGunTurntable(id: WeaponId, immediate = false): void {
    const spec = WEAPON_SPECS[id];
    const cy = 1.04 + spec.turntableCenter[1];
    const cz = spec.turntableCenter[2];
    const dist = spec.turntableDist;
    const sideX = id === 'm870' ? dist * 0.92 : -dist * 0.92;
    this.camTargetPos.set(sideX, cy + dist * 0.14, cz + dist * 0.36);
    this.camTargetLook.set(0, cy, cz);
    this.controls.minDistance = 0.14;
    this.controls.maxDistance = 3.2;
    if (immediate) {
      this.camera.position.copy(this.camTargetPos);
      this.controls.target.copy(this.camTargetLook);
      this.controls.update();
      this.camLerpActive = false;
    } else {
      this.camLerpActive = true;
    }
  }

  public setGunTurntable(enabled: boolean): void {
    if (this.gunTurntable === enabled) return;
    this.gunTurntable = enabled;
    if (enabled) {
      if (this.mode === 'combat') {
        this.setMode('inspect');
      }
      if (this.weaponState.equipped === 'none') {
        this.setWeapon('mk18');
      }
      this.character.root.visible = false;
      this.contactShadowMesh.visible = false;
      this.skeletonHelper.visible = false;
      this.combatFX.clearDynamic();
      const id = this.weaponState.equipped as WeaponId;
      this.frameGunTurntable(id, false);
    } else {
      this.character.root.visible = true;
      this.contactShadowMesh.visible = true;
      this.controls.minDistance = 0.34;
      this.controls.maxDistance = 6.5;
      this.setCameraPreset('full_body', false);
    }
    this.emitWeaponHud(true);
  }

  /**
   * Computes center-screen crosshair aim raycast target in world space for barrel-to-crosshair laser convergence.
   */
  private computeCrosshairAimTarget(out: THREE.Vector3): THREE.Vector3 {
    this._raycaster.setFromCamera(this._ndcCenter, this.camera);
    const ray = this._raycaster.ray;
    const hit = ray.intersectPlane(this._floorPlane, out);
    if (hit) {
      const dist = hit.distanceTo(ray.origin);
      if (dist >= 1.5 && dist <= 26.0) {
        return out;
      }
    }
    return out.copy(ray.origin).addScaledVector(ray.direction, 18.0);
  }

  /** Non-blocking async binary glTF 2.0 export of Character (LOD0 + 63 UE5 bones + 11 baked 30fps clips, zero studio helpers!) */
  public async exportGLBWithMetrics(): Promise<{ buffer: ArrayBuffer; metrics: GlbExportMetrics }> {
    const savedPos = this.character.root.position.clone();
    const savedRot = this.character.root.rotation.clone();
    const savedVis = this.character.root.visible;
    const savedLod0 = this.character.lods.LOD0.visible;
    const savedLod1 = this.character.lods.LOD1.visible;
    const savedLod2 = this.character.lods.LOD2.visible;

    this.character.root.visible = true;
    this.character.lods.LOD0.visible = true;
    this.character.lods.LOD1.visible = false;
    this.character.lods.LOD2.visible = false;
    this.character.root.position.set(0, 0, 0);
    this.character.root.rotation.set(0, 0, 0);
    this.character.root.updateMatrixWorld(true);

    try {
      return await exportSceneObjectToGLB(this.character.root, {
        animations: this.clips,
        maxTextureSize: 1024,
        encodeOpaqueAsJpeg: true,
        jpegQuality: 0.88,
        targetFps: 30,
      });
    } finally {
      this.character.root.position.copy(savedPos);
      this.character.root.rotation.copy(savedRot);
      this.character.root.visible = savedVis;
      this.character.lods.LOD0.visible = savedLod0;
      this.character.lods.LOD1.visible = savedLod1;
      this.character.lods.LOD2.visible = savedLod2;
      this.character.root.updateMatrixWorld(true);
    }
  }

  public async exportGLBArrayBuffer(): Promise<ArrayBuffer> {
    const { buffer } = await this.exportGLBWithMetrics();
    return buffer;
  }

  public async exportWeaponGLBArrayBuffer(id?: WeaponId): Promise<ArrayBuffer> {
    const targetId: WeaponId =
      id ?? (this.weaponState.equipped !== 'none' ? this.weaponState.equipped : 'mk18');
    const weapon = this.weaponArsenal[targetId];

    const savedPos = weapon.root.position.clone();
    const savedQuat = weapon.root.quaternion.clone();
    const savedScale = weapon.root.scale.clone();
    const savedVis = weapon.root.visible;
    const savedBoltPos = weapon.boltOrSlide.position.clone();
    const savedBoltRot = weapon.boltOrSlide.rotation.clone();
    const savedMagPos = weapon.magPivot.position.clone();
    const savedMagRot = weapon.magPivot.rotation.clone();
    const savedTrigRot = weapon.triggerPivot.rotation.clone();

    weapon.root.visible = true;
    weapon.root.position.set(0, 0, 0);
    weapon.root.quaternion.identity();
    weapon.root.scale.set(1, 1, 1);
    weapon.boltOrSlide.position.copy(weapon.boltRestPos);
    weapon.boltOrSlide.rotation.copy(weapon.boltRestRot);
    weapon.magPivot.position.copy(weapon.magRestPos);
    weapon.magPivot.rotation.copy(weapon.magRestRot);
    weapon.triggerPivot.rotation.set(0, 0, 0);
    const fullSpec = WEAPON_SPECS[targetId];
    updateWeaponLiveAmmoVisuals(
      weapon,
      fullSpec.magSize,
      fullSpec.magSize,
      false,
      0,
      fullSpec.magSize,
      fullSpec.reserveMax
    );
    weapon.root.updateMatrixWorld(true);

    try {
      const { buffer } = await exportSceneObjectToGLB(weapon.root, {
        maxTextureSize: 1024,
        encodeOpaqueAsJpeg: true,
        jpegQuality: 0.9,
      });
      return buffer;
    } finally {
      weapon.root.position.copy(savedPos);
      weapon.root.quaternion.copy(savedQuat);
      weapon.root.scale.copy(savedScale);
      weapon.root.visible = savedVis;
      weapon.boltOrSlide.position.copy(savedBoltPos);
      weapon.boltOrSlide.rotation.copy(savedBoltRot);
      weapon.magPivot.position.copy(savedMagPos);
      weapon.magPivot.rotation.copy(savedMagRot);
      weapon.triggerPivot.rotation.copy(savedTrigRot);
      this.syncActiveWeaponLiveAmmo(weapon);
      weapon.root.updateMatrixWorld(true);
    }
  }

  public async downloadGLB(filename = 'vanguard_operator_ue5.glb'): Promise<void> {
    const { buffer } = await this.exportGLBWithMetrics();
    triggerGlbDownload(buffer, filename);
  }

  public async downloadWeaponGLB(id?: WeaponId): Promise<void> {
    const targetId: WeaponId =
      id ?? (this.weaponState.equipped !== 'none' ? this.weaponState.equipped : 'mk18');
    const buffer = await this.exportWeaponGLBArrayBuffer(targetId);
    triggerGlbDownload(buffer, `weapon_${targetId}_ue5.glb`);
  }

  private exposeAutomationAPI(): void {
    window.__charStudio = {
      setAnim: (name: string, t?: number) => {
        if (!ANIMATION_NAMES.includes(name as AnimationName)) return;
        this.playAnimation(name as AnimationName, 0);
        if (t !== undefined && this.activeAction) {
          this.animLockedTime = t;
          this.activeAction.time = t;
          this.activeAction.paused = true;
          this.mixer.update(0);
          this.updateInspectMode(0.016);
          for (const mn of FACIAL_MORPH_NAMES) {
            if (this.manualMorphOverrides[mn] !== undefined) {
              this.character.setMorphTarget(mn, this.manualMorphOverrides[mn]!);
            }
          }
          this.renderer.render(this.scene, this.camera);
        }
      },
      setCamera: (preset: string, immediate = true) => {
        this.setCameraPreset(preset as CameraPresetKey, immediate);
        this.renderer.render(this.scene, this.camera);
      },
      setCustomCamera: (pos: [number, number, number], target: [number, number, number]) => {
        this.camLerpActive = false;
        this.camera.position.set(pos[0], pos[1], pos[2]);
        this.controls.target.set(target[0], target[1], target[2]);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
      },
      setMorph: (name: string, val: number) => {
        if (!FACIAL_MORPH_NAMES.includes(name as FacialMorphName)) return;
        this.setMorphOverride(name as FacialMorphName, val);
        this.renderer.render(this.scene, this.camera);
      },
      setMode: (mode: StudioMode) => {
        this.setMode(mode);
        if (mode === 'combat') {
          this.updateCombatMode(0.016);
        } else {
          this.updateInspectMode(0.016);
        }
        this.renderer.render(this.scene, this.camera);
      },
      setLighting: (preset: string) => {
        this.setLightingPreset(preset as LightingPresetKey);
        this.renderer.render(this.scene, this.camera);
      },
      setDisplay: (opts: StudioDisplayOptions) => {
        this.setDisplayOptions(opts);
        this.renderer.render(this.scene, this.camera);
      },
      setWeapon: (id: EquippedWeaponId) => {
        this.setWeapon(id);
        this.weaponState.equipBlend = 1;
        if (this.mode === 'combat') {
          this.updateCombatMode(0.016);
        } else {
          this.updateInspectMode(0.016);
        }
        this.renderer.render(this.scene, this.camera);
      },
      setGunTurntable: (enabled: boolean) => {
        this.setGunTurntable(enabled);
        if (enabled && this.weaponState.equipped !== 'none') {
          this.frameGunTurntable(this.weaponState.equipped, true);
        }
        this.updateInspectMode(0.016);
        this.renderer.render(this.scene, this.camera);
      },
      setAim: (aiming: boolean) => {
        this.inspectAimOverride = aiming;
        this.inputState.aim = aiming;
        this.callbacks.onAimStateChange?.(aiming);
        for (let i = 0; i < 24; i++) {
          if (this.mode === 'combat') {
            this.updateCombatMode(0.03);
          } else {
            this.updateInspectMode(0.03);
          }
        }
        this.renderer.render(this.scene, this.camera);
      },
      setInspect: (inspecting: boolean) => {
        this.weaponState.isInspecting = inspecting;
        this.weaponState.inspectTime = 0.6;
        this.updateInspectMode(0.016);
        this.renderer.render(this.scene, this.camera);
      },
      setLaser: (enabled: boolean) => {
        this.weaponState.laserEnabled = enabled;
        if (this.mode === 'combat') {
          this.updateCombatMode(0.016);
        } else {
          this.updateInspectMode(0.016);
        }
        this.renderer.render(this.scene, this.camera);
      },
      setCombatInput: (partial: Partial<InputState>, steps = 20) => {
        Object.assign(this.inputState, partial);
        for (let i = 0; i < steps; i++) {
          this.updateCombatMode(0.025);
        }
        this.renderer.render(this.scene, this.camera);
      },
      setCombatPitch: (pitchRad: number) => {
        this.combatCamPitch = Math.max(-0.55, Math.min(0.55, pitchRad));
        if (this.mode === 'combat') {
          this.updateCombatMode(0.016);
        }
        this.renderer.render(this.scene, this.camera);
      },
      stepWheel: (deltaY: number, nowMs?: number) => {
        const next = this.stepWeaponByWheel(deltaY, nowMs ?? performance.now());
        this.renderer.render(this.scene, this.camera);
        return next;
      },
      triggerFire: () => {
        this.triggerTestShot();
        const w = this.getActiveWeapon();
        if (w && this.weaponState.equipped !== 'none') {
          this.syncActiveWeaponLiveAmmo(w);
          this.weaponIK.update(w, this.weaponState, this.inspectAimOverride, false, 0, 0.016);
          const aimTarget = this.computeCrosshairAimTarget(this._v3);
          this.combatFX.update(
            0.028,
            this.camera,
            w,
            this.weaponState.equipped,
            this.weaponState.muzzleFlashTimer,
            this.weaponState.laserEnabled,
            {
              adsBlend: this.weaponIK.getAdsBlend(),
              hideLaser: false,
              nightOp: this.activeLighting === 'night_operation',
              aimTargetWorld: aimTarget,
            }
          );
        }
        this.renderer.render(this.scene, this.camera);
      },
      setReloadProgress: (progress: number | null) => {
        this.reloadLockedProgress = progress;
        if (progress === null) {
          this.weaponState.isReloading = false;
          this.weaponState.reloadProgress = 0;
        } else {
          if (!this.weaponState.isReloading && this.weaponState.equipped !== 'none') {
            this.weaponState.preReloadMag = this.weaponState.ammo[this.weaponState.equipped].mag;
          }
          this.weaponState.isReloading = true;
          this.weaponState.reloadProgress = progress;
        }
        this.updateInspectMode(0.016);
        this.renderer.render(this.scene, this.camera);
      },
      setMagCount: (count: number) => {
        if (this.weaponState.equipped === 'none') return;
        const id = this.weaponState.equipped;
        const spec = WEAPON_SPECS[id];
        const clamped = Math.max(0, Math.min(spec.magSize, Math.round(count)));
        this.weaponState.ammo[id].mag = clamped;
        this.weaponState.preReloadMag = clamped;
        this.weaponState.slideLockedBack = id === 'glock19' && clamped === 0;
        this.weaponState.boltTravel = this.weaponState.slideLockedBack ? 1 : 0;
        const w = this.getActiveWeapon();
        if (w) this.syncActiveWeaponLiveAmmo(w);
        this.updateInspectMode(0.016);
        this.emitWeaponHud(true);
        this.renderer.render(this.scene, this.camera);
      },
      exportGLBBase64: async () => {
        const ab = await this.exportGLBArrayBuffer();
        const bytes = new Uint8Array(ab);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
      },
      exportGLBWithMetrics: async () => {
        const { metrics } = await this.exportGLBWithMetrics();
        return metrics;
      },
      exportWeaponGLBBase64: async (id?: WeaponId) => {
        const ab = await this.exportWeaponGLBArrayBuffer(id);
        const bytes = new Uint8Array(ab);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
      },
      loadExportedGLBBase64: async (base64: string) => {
        const binStr = atob(base64);
        const len = binStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);

        const loader = new GLTFLoader();
        const gltf = await loader.parseAsync(bytes.buffer, '');

        this.character.root.visible = false;
        if (this.reloadedGroup) {
          this.scene.remove(this.reloadedGroup);
        }
        this.reloadedGroup = gltf.scene;
        this.scene.add(this.reloadedGroup);

        let meshCount = 0;
        let boneCount = 0;
        let morphCount = 0;
        this.reloadedGroup.traverse((obj) => {
          if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
            meshCount++;
            obj.castShadow = true;
            obj.receiveShadow = true;
            obj.frustumCulled = false;
            const sm = obj as THREE.SkinnedMesh;
            if (sm.morphTargetInfluences) {
              morphCount += sm.morphTargetInfluences.length;
            }
          }
          if ((obj as THREE.Bone).isBone) {
            boneCount++;
          }
        });

        this.reloadedMixer = new THREE.AnimationMixer(this.reloadedGroup);
        if (gltf.animations.length > 0) {
          const aimClip =
            THREE.AnimationClip.findByName(gltf.animations, 'Idle_Natural') ||
            gltf.animations[0];
          const act = this.reloadedMixer.clipAction(aimClip);
          act.play();
          this.reloadedMixer.update(0.35);
        }

        this.setCameraPreset('full_body', true);
        this.renderer.render(this.scene, this.camera);

        return {
          meshCount,
          boneCount,
          animCount: gltf.animations.length,
          morphCount,
        };
      },
      restoreProceduralCharacter: () => {
        if (this.reloadedGroup) {
          this.scene.remove(this.reloadedGroup);
          this.reloadedGroup = null;
          this.reloadedMixer = null;
        }
        this.character.root.visible = true;
        this.renderer.render(this.scene, this.camera);
      },
      getStats: () => ({
        ...this.character.stats,
        animationCount: this.clips.length,
        animations: this.clips.map((c) => c.name),
        activeAnim: this.activeAnimName,
        activeLighting: this.activeLighting,
        mode: this.mode,
        isSoftwareGl: this.isSoftwareGl,
        equippedWeapon: this.weaponState.equipped,
        gunTurntable: this.gunTurntable,
        awmScopeActive: this.awmScopeActive,
      }),
      getWeaponState: () => this.getWeaponHUDState(),
      getAdsBlend: () => this.weaponIK.getAdsBlend(),
      getAwmScopeActive: () => this.awmScopeActive,
      getCameraState: () => ({
        pos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
        target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
        fov: this.camera.fov,
        near: this.camera.near,
      }),
    };
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (status === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = () => {
    if (this.disposed) return;

    this.timer.update();
    const rawDelta = this.timer.getDelta();
    const dt = Math.min(Math.max(rawDelta, 0.0001), 0.05);

    if (this.reloadedGroup && this.reloadedMixer) {
      this.reloadedMixer.update(dt);
    } else if (this.mode === 'combat') {
      this.updateCombatMode(dt);
    } else {
      this.updateInspectMode(dt);
    }

    // Apply explicit manual facial morph overrides cleanly on top of animation
    for (const mn of FACIAL_MORPH_NAMES) {
      const overrideVal = this.manualMorphOverrides[mn];
      if (overrideVal !== undefined) {
        this.character.setMorphTarget(mn, overrideVal);
      }
    }

    this.updateDynamicShadowBounds();
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private handleWeaponEvents(
    ev: ReturnType<typeof stepWeaponMechanics>,
    weapon: BuiltWeapon,
    weaponId: WeaponId,
    isAiming: boolean
  ): void {
    if (ev.fired) {
      weaponAudio.playGunshot(weaponId);
      this.combatFX.spawnShotFX(weapon, weaponId, isAiming);
      if (this.mode === 'combat') {
        const kick = WEAPON_SPECS[weaponId].cameraKick * (isAiming ? 0.65 : 1.0);
        this.combatCamPitch = Math.max(-0.55, this.combatCamPitch - kick);
      }
      this.emitWeaponHud(true);
    }
    if (ev.dryFired) {
      weaponAudio.playDryFire();
    }
    if (ev.ejectCasing) {
      this.combatFX.spawnEjectedCasing(weapon, weaponId);
    }
    if (ev.pumpSound) {
      weaponAudio.playPumpRack();
    }
    if (ev.boltCycleSound) {
      weaponAudio.playSniperBoltCycle();
    }
    if (ev.magOutSound) {
      weaponAudio.playMagOut();
    }
    if (ev.magInSound) {
      weaponAudio.playMagIn();
      this.emitWeaponHud(true);
    }
    if (ev.boltRackSound) {
      weaponAudio.playBoltRack();
    }
    if (ev.reloadCompleted) {
      this.emitWeaponHud(true);
    }
  }

  private updateInspectMode(dt: number): void {
    const activeWeapon = this.getActiveWeapon();
    const nightOp = this.activeLighting === 'night_operation';

    if (this.gunTurntable && activeWeapon && this.weaponState.equipped !== 'none') {
      if (this.reloadLockedProgress !== null) {
        this.weaponState.isReloading = true;
        this.weaponState.reloadProgress = this.reloadLockedProgress;
      } else {
        const ev = stepWeaponMechanics(this.weaponState, false, false, 0, dt, Math.random());
        this.handleWeaponEvents(ev, activeWeapon, this.weaponState.equipped, false);
      }

      activeWeapon.root.position.set(0, 1.04, 0);
      activeWeapon.root.quaternion.identity();
      activeWeapon.root.scale.set(1, 1, 1);

      activeWeapon.triggerPivot.rotation.x = -this.weaponState.triggerPull * 0.38;
      activeWeapon.boltOrSlide.position.copy(activeWeapon.boltRestPos);
      activeWeapon.boltOrSlide.position.z -= this.weaponState.boltTravel * activeWeapon.boltTravelMax;
      activeWeapon.boltOrSlide.rotation.copy(activeWeapon.boltRestRot);
      if (activeWeapon.boltLiftMax > 0) {
        activeWeapon.boltOrSlide.rotation.z = -this.weaponState.boltLift * activeWeapon.boltLiftMax;
      }
      if (this.weaponState.isReloading) {
        const p = this.weaponState.reloadProgress;
        const drop = Math.sin(Math.min(1, p) * Math.PI) * 0.14;
        activeWeapon.magPivot.position.copy(activeWeapon.magRestPos);
        activeWeapon.magPivot.position.y -= drop;
      } else {
        activeWeapon.magPivot.position.copy(activeWeapon.magRestPos);
        activeWeapon.magPivot.rotation.copy(activeWeapon.magRestRot);
      }
      activeWeapon.root.updateMatrixWorld(true);
      this.syncActiveWeaponLiveAmmo(activeWeapon);

      this.combatFX.update(
        dt,
        this.camera,
        activeWeapon,
        this.weaponState.equipped,
        this.weaponState.muzzleFlashTimer,
        this.weaponState.laserEnabled,
        { adsBlend: 0, hideLaser: this.weaponState.isReloading, nightOp }
      );
      this.emitWeaponHud(false);
    } else {
      if (this.animLockedTime === null) {
        this.mixer.update(dt);
      }

      if (activeWeapon && this.weaponState.equipped !== 'none') {
        if (this.reloadLockedProgress !== null) {
          this.weaponState.isReloading = true;
          this.weaponState.reloadProgress = this.reloadLockedProgress;
        } else {
          const ev = stepWeaponMechanics(
            this.weaponState,
            false,
            this.inspectAimOverride,
            0,
            dt,
            Math.random()
          );
          this.handleWeaponEvents(
            ev,
            activeWeapon,
            this.weaponState.equipped,
            this.inspectAimOverride
          );
        }

        const isAimPose =
          this.inspectAimOverride ||
          this.activeAnimName === 'Combat_Aim_Stance' ||
          this.activeAnimName === 'Combat_Fire_Burst';
        const isSprintPose = this.activeAnimName === 'Sprint_Combat';
        this.syncActiveWeaponLiveAmmo(activeWeapon);
        this.weaponIK.update(activeWeapon, this.weaponState, isAimPose, isSprintPose, 0, dt);

        if (isAimPose) {
          this.character.setMorphTarget('Brow_Focus', 0.82);
        }

        // Update skeleton & world matrices before orienting laser/weaponlight!
        this.character.root.updateMatrixWorld(true);
        this.character.rig.skeleton.update();
        activeWeapon.root.updateMatrixWorld(true);

        this.combatFX.update(
          dt,
          this.camera,
          activeWeapon,
          this.weaponState.equipped,
          this.weaponState.muzzleFlashTimer,
          this.weaponState.laserEnabled,
          {
            adsBlend: this.weaponIK.getAdsBlend(),
            hideLaser: this.weaponState.isReloading || isSprintPose,
            nightOp,
          }
        );
        this.emitWeaponHud(false);
      } else {
        this.character.rig.updateTwistBones();
        this.combatFX.update(dt, this.camera, null, 'none', 0, false);
      }
    }

    if (this.camLerpActive) {
      const k = 1 - Math.exp(-8.5 * dt);
      this.camera.position.lerp(this.camTargetPos, k);
      this.controls.target.lerp(this.camTargetLook, k);
      if (
        this.camera.position.distanceTo(this.camTargetPos) < 0.004 &&
        this.controls.target.distanceTo(this.camTargetLook) < 0.004
      ) {
        this.camLerpActive = false;
      }
    }
    this.controls.update();
  }

  private updateCombatMode(dt: number): void {
    const activeWeapon = this.getActiveWeapon();
    const hasWeapon = activeWeapon !== null && this.weaponState.equipped !== 'none';
    const nightOp = this.activeLighting === 'night_operation';

    const res = stepCombatController(
      this.ctrlState,
      {
        ...this.inputState,
        isArmed: hasWeapon,
        firePressed: hasWeapon ? false : this.inputState.firePressed,
      },
      this.combatCamYaw,
      this.combatCamPitch,
      dt
    );

    if (!hasWeapon && res.firedThisStep) {
      tacticalAudio.playGunshot();
    }

    if (this.lastReportedAim !== this.ctrlState.isAiming) {
      this.lastReportedAim = this.ctrlState.isAiming;
      this.callbacks.onAimStateChange?.(this.ctrlState.isAiming);
    }

    if (hasWeapon && this.weaponState.equipped !== 'none') {
      const ev = stepWeaponMechanics(
        this.weaponState,
        this.inputState.firePressed,
        this.ctrlState.isAiming,
        this.ctrlState.speed,
        dt,
        Math.random()
      );
      this.handleWeaponEvents(
        ev,
        activeWeapon,
        this.weaponState.equipped,
        this.ctrlState.isAiming
      );
    }

    // Masked skeletal layering when ADS is active & grounded:
    // Lower body plays locomotion (Strafe_Left/Right/Walk/Crouch_Walk) while upper body (spine_02+) holds Combat_Aim_Stance!
    let targetClip = this.ctrlState.activeClip as AnimationName;
    if (hasWeapon && this.weaponState.muzzleFlashTimer > 0 && this.ctrlState.isGrounded && !this.ctrlState.isAiming) {
      targetClip = 'Combat_Fire_Burst';
    }

    if (this.ctrlState.isAiming && this.ctrlState.isGrounded && hasWeapon) {
      this.syncLayeredAimActions(targetClip);
    } else {
      if (this.isLayeredAimActive || targetClip !== this.activeAnimName) {
        this.playAnimation(targetClip, 0.16);
      }
    }

    // 1. Evaluate animation mixer pose cleanly (zero frame-to-frame accumulation!)
    this.mixer.update(dt);

    // 2. Distribute clamped aimPitch [-0.55, +0.55] across spine_02 (0.25), spine_03 (0.35), neck_01 (0.20), head (0.20)
    //    using character-local +X quaternion offset relative to the fresh clip pose (ZERO backward neck twist!)
    const spine2 = this.character.rig.getBone('spine_02');
    const spine3 = this.character.rig.getBone('spine_03');
    const neck = this.character.rig.getBone('neck_01');
    const head = this.character.rig.getBone('head');
    const recoilPitch = hasWeapon
      ? this.weaponState.recoilPitch * 0.5
      : this.ctrlState.recoilAmount * 0.12;
    const dist = computeAimPitchDistribution(this.ctrlState.aimPitch - recoilPitch);
    const yawOff = this.ctrlState.aimYawOffset;

    if (spine2) {
      this._q1.setFromAxisAngle(this._xAxis, dist.spine_02);
      spine2.quaternion.multiply(this._q1);
      if (Math.abs(yawOff) > 1e-4) {
        this._q1.setFromAxisAngle(this._yAxis, yawOff * 0.25);
        spine2.quaternion.multiply(this._q1);
      }
    }
    if (spine3) {
      this._q1.setFromAxisAngle(this._xAxis, dist.spine_03);
      spine3.quaternion.multiply(this._q1);
      if (Math.abs(yawOff) > 1e-4) {
        this._q1.setFromAxisAngle(this._yAxis, yawOff * 0.35);
        spine3.quaternion.multiply(this._q1);
      }
    }
    if (neck) {
      this._q1.setFromAxisAngle(this._xAxis, dist.neck_01);
      neck.quaternion.multiply(this._q1);
      if (Math.abs(yawOff) > 1e-4) {
        this._q1.setFromAxisAngle(this._yAxis, yawOff * 0.20);
        neck.quaternion.multiply(this._q1);
      }
    }
    if (head) {
      this._q1.setFromAxisAngle(this._xAxis, dist.head);
      head.quaternion.multiply(this._q1);
      if (Math.abs(yawOff) > 1e-4) {
        this._q1.setFromAxisAngle(this._yAxis, yawOff * 0.20);
        head.quaternion.multiply(this._q1);
      }
    }

    // 3. Update character transform
    this.character.root.position.set(
      this.ctrlState.posX,
      this.ctrlState.posY,
      this.ctrlState.posZ
    );
    this.character.root.rotation.y = this.ctrlState.yaw;
    this.character.root.updateMatrixWorld(true);

    // 4. Update 2-Bone Analytical Weapon IK + Live Ammo
    const isSprinting = res.isSprinting || (this.ctrlState.speed > 4.1 && !this.ctrlState.isAiming);
    if (hasWeapon && this.weaponState.equipped !== 'none') {
      this.syncActiveWeaponLiveAmmo(activeWeapon);
      this.weaponIK.update(
        activeWeapon,
        this.weaponState,
        this.ctrlState.isAiming,
        isSprinting,
        dist.clampedPitch,
        dt
      );
      if (this.ctrlState.isAiming) {
        this.character.setMorphTarget('Brow_Focus', 0.85);
      }
      if (this.weaponState.muzzleFlashTimer > 0) {
        this.character.setMorphTarget('Mouth_Grit_Fire', 0.85);
      }
    } else {
      this.character.rig.updateTwistBones();
    }

    // 5. Over-Right-Shoulder Combat / ADS Camera & Masked AWM .338 Scope (18° FOV)
    const adsBlend = hasWeapon ? this.weaponIK.getAdsBlend() : this.ctrlState.isAiming ? 1 : 0;
    const isAwmScoped =
      hasWeapon &&
      this.weaponState.equipped === 'awm' &&
      this.ctrlState.isAiming &&
      adsBlend > 0.65;
    this.setAwmScopeActive(isAwmScoped);

    const crouchDrop = this.ctrlState.isCrouching ? 0.34 : 0;
    const fwdX = Math.sin(this.combatCamYaw);
    const fwdZ = Math.cos(this.combatCamYaw);
    // Screen-right in Three.js when facing +Z is (-cos(yaw), 0, +sin(yaw)) -> over character's right shoulder!
    const rightX = -Math.cos(this.combatCamYaw);
    const rightZ = Math.sin(this.combatCamYaw);

    if (isAwmScoped) {
      // AWM .338 First-Person Masked Scope Axis (character & outer rifle hidden, 18° FOV!)
      const eyeY = this.ctrlState.posY + 1.62 - crouchDrop;
      this._v1.set(
        this.ctrlState.posX + fwdX * 0.25,
        eyeY,
        this.ctrlState.posZ + fwdZ * 0.25
      );
      this._v2.set(
        this._v1.x + fwdX * 25.0 * Math.cos(this.combatCamPitch),
        this._v1.y - Math.sin(this.combatCamPitch) * 25.0,
        this._v1.z + fwdZ * 25.0 * Math.cos(this.combatCamPitch)
      );
      this.camera.position.copy(this._v1);
      this.controls.target.copy(this._v2);
      this.camera.lookAt(this.controls.target);
    } else {
      // Hipfire -> Clean Over-Right-Shoulder ADS offset (+0.42 right, +1.58 up, -1.10 back)
      // Look target (+0.42 right, +1.52 up, +15.0 forward) -> ZERO shoulder/collar/head clipping!
      const localRight = THREE.MathUtils.lerp(0.26, 0.42, adsBlend);
      const localUp = THREE.MathUtils.lerp(1.62, 1.58, adsBlend) - crouchDrop;
      const localBack = THREE.MathUtils.lerp(2.75, 1.10, adsBlend);

      const pitchYOffset = Math.sin(this.combatCamPitch) * localBack * 0.55;
      this._v1.set(
        this.ctrlState.posX - fwdX * localBack + rightX * localRight,
        this.ctrlState.posY + localUp + pitchYOffset,
        this.ctrlState.posZ - fwdZ * localBack + rightZ * localRight
      );

      const lookUp = THREE.MathUtils.lerp(1.48, 1.52, adsBlend) - crouchDrop;
      const lookForward = THREE.MathUtils.lerp(12.0, 15.0, adsBlend);
      this._v2.set(
        this.ctrlState.posX + fwdX * lookForward + rightX * localRight,
        this.ctrlState.posY + lookUp - Math.sin(this.combatCamPitch) * lookForward,
        this.ctrlState.posZ + fwdZ * lookForward + rightZ * localRight
      );

      const k = 1 - Math.exp(-14 * dt);
      this.camera.position.lerp(this._v1, k);
      this.controls.target.lerp(this._v2, k);
      this.camera.lookAt(this.controls.target);
    }

    // FOV lerp: 60° hipfire -> 44° standard ADS -> 18° AWM .338 scope!
    const targetFov = isAwmScoped
      ? 18
      : this.ctrlState.isAiming
        ? 44
        : isSprinting
          ? 64
          : 60;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = dampScalar(this.camera.fov, targetFov, 14, dt);
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    // 6. Update skeleton world matrices & orient crosshair-converged laser + pooled 22m SpotLight!
    this.character.root.updateMatrixWorld(true);
    this.character.rig.skeleton.update();

    if (hasWeapon && this.weaponState.equipped !== 'none') {
      activeWeapon.root.updateMatrixWorld(true);
      const aimTarget = this.computeCrosshairAimTarget(this._v3);
      this.combatFX.update(
        dt,
        this.camera,
        activeWeapon,
        this.weaponState.equipped,
        this.weaponState.muzzleFlashTimer,
        this.weaponState.laserEnabled,
        {
          adsBlend,
          hideLaser: this.weaponState.isReloading || isSprinting || isAwmScoped,
          nightOp,
          aimTargetWorld: aimTarget,
        }
      );
      this.muzzleLight.intensity = 0;
      this.emitWeaponHud(false);
    } else {
      this.combatFX.update(dt, this.camera, null, 'none', 0, false);
      if (this.ctrlState.muzzleFlashTimer > 0) {
        const cfX = Math.sin(this.ctrlState.yaw);
        const cfZ = Math.cos(this.ctrlState.yaw);
        this.muzzleLight.position.set(
          this.ctrlState.posX + cfX * 0.58,
          this.ctrlState.posY + (this.ctrlState.isCrouching ? 1.05 : 1.42),
          this.ctrlState.posZ + cfZ * 0.58
        );
        this.muzzleLight.intensity = 14.0 * (this.ctrlState.muzzleFlashTimer / 0.07);
      } else {
        this.muzzleLight.intensity = 0;
      }
    }
  }

  private syncActiveWeaponLiveAmmo(weapon: BuiltWeapon): void {
    const spec = WEAPON_SPECS[weapon.id];
    const ammo = this.weaponState.ammo[weapon.id];
    updateWeaponLiveAmmoVisuals(
      weapon,
      ammo.mag,
      spec.magSize,
      this.weaponState.isReloading && this.weaponState.equipped === weapon.id,
      this.weaponState.reloadProgress,
      this.weaponState.preReloadMag,
      ammo.reserve
    );
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.eventAbortController.abort();

    this.controls.dispose();
    this.combatFX.dispose();
    for (const id of WEAPON_ORDER) {
      this.weaponArsenal[id].dispose();
    }
    this.weaponMaterials.dispose();
    this.character.dispose();
    this.backdropTex.dispose();
    this.shadowTex.dispose();
    this.arenaGridMesh.geometry.dispose();
    this.arenaGridMat.dispose();
    for (const tex of this.envCache.values()) {
      tex.dispose();
    }
    this.envCache.clear();
    this.renderer.dispose();
    const dom = this.renderer.domElement;
    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
    delete window.__charStudio;
  }
}
