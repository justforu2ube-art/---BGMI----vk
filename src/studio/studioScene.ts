import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildHeroCharacter, BuiltCharacter } from '../character/characterBuilder';
import { ANIMATION_NAMES, AnimationName, createCharacterAnimations } from '../character/animations';
import { FACIAL_MORPH_NAMES, FacialMorphName } from '../character/headSculpt';
import {
  ControllerState,
  createInitialControllerState,
  dampScalar,
  InputState,
  stepCombatController,
} from '../character/controllerMath';
import { tacticalAudio } from './audio';
import {
  getLightingPreset,
  LIGHTING_PRESETS,
  LightingPresetKey,
  LightingPresetSpec,
} from './lightingPresets';

export { LIGHTING_PRESETS };
export type { LightingPresetKey, LightingPresetSpec };

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
    target: [0, 0.82, 0],
  },
  {
    id: 'face_macro',
    label: 'Face & Eyes',
    position: [0.11, 1.71, 0.56],
    target: [0, 1.71, 0.04],
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
    position: [0.66, 1.02, 0.72],
    target: [0.28, 0.96, 0.08],
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
}

export interface StudioDisplayOptions {
  wireframe?: boolean;
  skeleton?: boolean;
  autoRotate?: boolean;
  playbackSpeed?: number;
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

/** Creates a smooth radial contact shadow catcher texture placed flush beneath boot soles */
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
  grad.addColorStop(0.0, 'rgba(5, 7, 10, 0.62)');
  grad.addColorStop(0.32, 'rgba(7, 9, 13, 0.34)');
  grad.addColorStop(0.68, 'rgba(8, 10, 14, 0.10)');
  grad.addColorStop(1.0, 'rgba(8, 10, 14, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Paints a smooth studio cyclorama vertical gradient onto a reusable canvas (zero texture leak!) */
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

/** Smooth studio gradient cyclorama sky dome texture (zero clutter props!) */
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
      exportGLBBase64: () => Promise<string>;
      loadExportedGLBBase64: (base64: string) => Promise<{
        meshCount: number;
        boneCount: number;
        animCount: number;
        morphCount: number;
      }>;
      restoreProceduralCharacter: () => void;
      getStats: () => Record<string, unknown>;
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
  private activeAction: THREE.AnimationAction | null = null;
  private activeAnimName: AnimationName = 'Idle_Natural';
  private playbackSpeed = 1.0;
  private animLockedTime: number | null = null;

  private skeletonHelper: THREE.SkeletonHelper;
  private contactShadowMesh: THREE.Mesh;
  private contactShadowMat: THREE.MeshBasicMaterial;
  private floorShadowMat: THREE.ShadowMaterial;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private overheadSpot: THREE.SpotLight;
  private muzzleLight: THREE.PointLight;
  private backdropCanvas: HTMLCanvasElement;
  private backdropTex: THREE.CanvasTexture;
  private shadowTex: THREE.CanvasTexture;
  private envRT: THREE.WebGLRenderTarget;
  private activeLighting: LightingPresetKey = 'studio_soft';

  // Reloaded GLB proof overlay (used only during automated GLB round-trip verification)
  private reloadedGroup: THREE.Group | null = null;
  private reloadedMixer: THREE.AnimationMixer | null = null;

  // Camera transition damping
  private camLerpActive = false;
  private camTargetPos = new THREE.Vector3(0.32, 1.02, 3.65);
  private camTargetLook = new THREE.Vector3(0, 0.82, 0);

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
  };
  private combatCamYaw = 0; // 0 = camera behind -Z looking toward +Z
  private combatCamPitch = 0.14;
  private isDraggingCombat = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastReportedAim = false;
  private manualMorphOverrides: Partial<Record<FacialMorphName, number>> = {};

  // Reusable scratch math objects (ZERO per-frame GC!)
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _q1 = new THREE.Quaternion();
  private readonly _e1 = new THREE.Euler(0, 0, 0, 'YXZ');

  private frameId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement, callbacks: StudioCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    // 1. Renderer — Three.js r187 modern PBR pipeline (NO deprecated APIs!)
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // r187 standard (NEVER PCFSoftShadowMap)
    this.renderer.setSize(container.clientWidth || 1440, container.clientHeight || 900);
    container.appendChild(this.renderer.domElement);

    // 2. Scene + Procedural Studio HDR Environment via PMREMGenerator
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#181f29');

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.envRT = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.46;
    roomEnv.dispose();
    pmrem.dispose();

    // Smooth gradient studio cyclorama dome (ZERO environment clutter props!)
    const defaultLighting = getLightingPreset('studio_soft');
    const backdrop = createStudioBackdropTexture(defaultLighting.backdropStops);
    this.backdropCanvas = backdrop.canvas;
    this.backdropTex = backdrop.tex;
    const domeGeo = new THREE.SphereGeometry(28, 32, 24);
    const domeMat = new THREE.MeshBasicMaterial({
      map: this.backdropTex,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.name = 'Studio_Cyclorama_Backdrop';
    this.scene.add(domeMesh);

    // Subtle studio floor shadow catcher + contact shadow disc directly beneath boots
    this.floorShadowMat = new THREE.ShadowMaterial({ opacity: defaultLighting.shadowFloorOpacity });
    const floorMesh = new THREE.Mesh(new THREE.CircleGeometry(10, 64), this.floorShadowMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.001;
    floorMesh.receiveShadow = true;
    floorMesh.name = 'Studio_Shadow_Floor';
    this.scene.add(floorMesh);

    this.shadowTex = createContactShadowTexture();
    this.contactShadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: defaultLighting.contactShadowOpacity,
    });
    this.contactShadowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.92, 48),
      this.contactShadowMat
    );
    this.contactShadowMesh.rotation.x = -Math.PI / 2;
    this.contactShadowMesh.position.y = 0.0015;
    this.contactShadowMesh.name = 'Studio_Contact_Shadow';
    this.scene.add(this.contactShadowMesh);

    // 3. Dynamic Multi-Environment PBR Lighting Rig (default: Studio Soft)
    this.keyLight = new THREE.DirectionalLight(
      defaultLighting.keyLight.color,
      defaultLighting.keyLight.intensity
    );
    this.keyLight.position.set(...defaultLighting.keyLight.position);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 12;
    const d = 1.65;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = 2.4;
    this.keyLight.shadow.camera.bottom = -0.4;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.018;
    this.scene.add(this.keyLight);

    // Rim Light separating hair & tactical silhouette cleanly
    this.rimLight = new THREE.DirectionalLight(
      defaultLighting.rimLight.color,
      defaultLighting.rimLight.intensity
    );
    this.rimLight.position.set(...defaultLighting.rimLight.position);
    this.scene.add(this.rimLight);

    // Fill / secondary bounce light
    this.fillLight = new THREE.DirectionalLight(
      defaultLighting.fillLight.color,
      defaultLighting.fillLight.intensity
    );
    this.fillLight.position.set(...defaultLighting.fillLight.position);
    this.scene.add(this.fillLight);

    // Sky/ground hemisphere ambient fill
    this.hemiLight = new THREE.HemisphereLight(
      defaultLighting.hemiLight.skyColor,
      defaultLighting.hemiLight.groundColor,
      defaultLighting.hemiLight.intensity
    );
    this.scene.add(this.hemiLight);

    // Overhead high-bay industrial SpotLight (active in Indoor Warehouse preset)
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

    // Dynamic muzzle flash light (intensity 0 except during firing burst pulse)
    this.muzzleLight = new THREE.PointLight(0xffb454, 0, 4.5, 2);
    this.muzzleLight.position.set(0, 1.38, 0.72);
    this.scene.add(this.muzzleLight);

    // 4. Camera & OrbitControls
    const aspect = (container.clientWidth || 1440) / (container.clientHeight || 900);
    this.camera = new THREE.PerspectiveCamera(36, aspect, 0.05, 80);
    this.camera.position.set(0.32, 1.02, 3.65);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.82, 0);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 0.34;
    this.controls.maxDistance = 6.5;
    this.controls.maxPolarAngle = Math.PI * 0.51;
    this.controls.addEventListener('start', () => {
      this.camLerpActive = false;
    });
    this.controls.update();

    // 5. Build Hero Character + 11 Biomechanical Animations
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.character = buildHeroCharacter(maxAniso);
    this.scene.add(this.character.exportGroup);

    this.skeletonHelper = new THREE.SkeletonHelper(this.character.exportGroup);
    this.skeletonHelper.visible = false;
    this.scene.add(this.skeletonHelper);

    this.clips = createCharacterAnimations(this.character.rig);
    this.mixer = new THREE.AnimationMixer(this.character.exportGroup);
    for (const clip of this.clips) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name as AnimationName, action);
    }

    this.playAnimation('Idle_Natural', 0);

    // Pre-warm shaders on GPU
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 6. Three.js r187 Timer (NEVER THREE.Clock!)
    this.timer = new THREE.Timer();

    // 7. Listeners & Automation API
    this.bindEvents();
    this.exposeAutomationAPI();
    this.callbacks.onStatsReady?.(this.character.stats);

    // Start render loop
    this.tick();
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.container);
    }
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    const dom = this.renderer.domElement;
    dom.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    dom.addEventListener('contextmenu', this.handleContextMenu);
    dom.addEventListener('webglcontextlost', this.handleContextLost);
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

  private handleKeyDown = (e: KeyboardEvent) => {
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
      this.combatCamPitch = Math.max(-0.35, Math.min(0.65, this.combatCamPitch + dy * 0.0042));
    } else {
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    }
  };

  public playAnimation(name: AnimationName, fadeDuration = 0.22): void {
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

  public setCameraPreset(presetId: CameraPresetKey, immediate = false): void {
    const spec = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!spec) return;
    const baseX = this.character.exportGroup.position.x;
    const baseZ = this.character.exportGroup.position.z;
    this.camTargetPos.set(
      spec.position[0] + baseX,
      spec.position[1],
      spec.position[2] + baseZ
    );
    this.camTargetLook.set(
      spec.target[0] + baseX,
      spec.target[1],
      spec.target[2] + baseZ
    );

    if (immediate) {
      this.camera.position.copy(this.camTargetPos);
      this.controls.target.copy(this.camTargetLook);
      this.controls.update();
      this.camLerpActive = false;
    } else {
      this.camLerpActive = true;
    }
  }

  public setMode(mode: StudioMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'combat') {
      this.controls.enabled = false;
      this.camLerpActive = false;
      this.ctrlState = createInitialControllerState();
      this.ctrlState.posX = this.character.exportGroup.position.x;
      this.ctrlState.posZ = this.character.exportGroup.position.z;
      this.ctrlState.yaw = this.character.exportGroup.rotation.y;
      this.combatCamYaw = this.ctrlState.yaw;
      this.combatCamPitch = 0.16;
    } else {
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
      this.character.exportGroup.position.set(0, 0, 0);
      this.character.exportGroup.rotation.set(0, 0, 0);
      this.contactShadowMesh.position.set(0, 0.0015, 0);
      this.muzzleLight.intensity = 0;
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
    }
  }

  public setLightingPreset(presetId: LightingPresetKey): void {
    const spec = getLightingPreset(presetId);
    this.activeLighting = spec.id;

    this.renderer.toneMappingExposure = spec.exposure;
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
    this.keyLight.position.set(...spec.keyLight.position);
    this.keyLight.shadow.camera.updateProjectionMatrix();

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
  }

  /** Exports ONLY Hero_Commando_Rig (zero studio lights/backdrop/floor!) as binary glTF 2.0 (.glb) */
  public async exportGLBArrayBuffer(): Promise<ArrayBuffer> {
    // Temporarily reset character world transform & bind pose cleanly for pristine UE5 export
    const savedPos = this.character.exportGroup.position.clone();
    const savedRot = this.character.exportGroup.rotation.clone();
    this.character.exportGroup.position.set(0, 0, 0);
    this.character.exportGroup.rotation.set(0, 0, 0);
    this.character.exportGroup.updateMatrixWorld(true);

    const exporter = new GLTFExporter();
    const glb = (await exporter.parseAsync(this.character.exportGroup, {
      binary: true,
      animations: this.clips,
      onlyVisible: true,
      includeCustomExtensions: false,
    })) as ArrayBuffer;

    this.character.exportGroup.position.copy(savedPos);
    this.character.exportGroup.rotation.copy(savedRot);
    this.character.exportGroup.updateMatrixWorld(true);
    return glb;
  }

  public async downloadGLB(filename = 'hero_commando_aaa.glb'): Promise<void> {
    const buffer = await this.exportGLBArrayBuffer();
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
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
          // Apply manual morph overrides if any
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
      loadExportedGLBBase64: async (base64: string) => {
        const binStr = atob(base64);
        const len = binStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binStr.charCodeAt(i);

        const loader = new GLTFLoader();
        const gltf = await loader.parseAsync(bytes.buffer, '');

        // Hide procedural character and show strictly the re-imported GLB!
        this.character.exportGroup.visible = false;
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
        this.character.exportGroup.visible = true;
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

    // Apply any explicit manual facial morph slider overrides cleanly on top of animation
    for (const mn of FACIAL_MORPH_NAMES) {
      const overrideVal = this.manualMorphOverrides[mn];
      if (overrideVal !== undefined) {
        this.character.setMorphTarget(mn, overrideVal);
      }
    }

    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private updateInspectMode(dt: number): void {
    if (this.animLockedTime === null) {
      this.mixer.update(dt);
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
    const res = stepCombatController(
      this.ctrlState,
      this.inputState,
      this.combatCamYaw,
      this.combatCamPitch,
      dt
    );

    if (res.firedThisStep) {
      tacticalAudio.playGunshot();
    }

    if (this.lastReportedAim !== this.ctrlState.isAiming) {
      this.lastReportedAim = this.ctrlState.isAiming;
      this.callbacks.onAimStateChange?.(this.ctrlState.isAiming);
    }

    // Crossfade smoothly to controller-driven clip
    const targetClip = this.ctrlState.activeClip as AnimationName;
    if (targetClip !== this.activeAnimName) {
      this.playAnimation(targetClip, 0.16);
    }

    this.mixer.update(dt);

    // Apply live upper-body spine/head mouse aim pitch & recoil kick on top of mixer pose
    const spine2 = this.character.rig.boneMap.get('Spine_02');
    const chest = this.character.rig.boneMap.get('Chest');
    const head = this.character.rig.boneMap.get('Head');
    if (spine2 && chest && head) {
      const pitch = this.ctrlState.aimPitch - this.ctrlState.recoilAmount * 0.14;
      const yawOff = this.ctrlState.aimYawOffset;
      this._e1.set(pitch * 0.35, yawOff * 0.3, 0, 'YXZ');
      this._q1.setFromEuler(this._e1);
      spine2.quaternion.multiply(this._q1);

      this._e1.set(pitch * 0.4, yawOff * 0.4, 0, 'YXZ');
      this._q1.setFromEuler(this._e1);
      chest.quaternion.multiply(this._q1);

      this._e1.set(pitch * 0.35, yawOff * 0.35, 0, 'YXZ');
      this._q1.setFromEuler(this._e1);
      head.quaternion.multiply(this._q1);
    }

    // Update character transform & contact shadow position
    this.character.exportGroup.position.set(
      this.ctrlState.posX,
      this.ctrlState.posY,
      this.ctrlState.posZ
    );
    this.character.exportGroup.rotation.y = this.ctrlState.yaw;

    this.contactShadowMesh.position.set(this.ctrlState.posX, 0.0015, this.ctrlState.posZ);
    const airScale = Math.max(0.45, 1 - this.ctrlState.posY * 0.45);
    this.contactShadowMesh.scale.setScalar(airScale);

    // Muzzle flash light pulse near hands when firing!
    if (this.ctrlState.muzzleFlashTimer > 0) {
      const fwdX = Math.sin(this.ctrlState.yaw);
      const fwdZ = Math.cos(this.ctrlState.yaw);
      this.muzzleLight.position.set(
        this.ctrlState.posX + fwdX * 0.58,
        this.ctrlState.posY + (this.ctrlState.isCrouching ? 1.05 : 1.42),
        this.ctrlState.posZ + fwdZ * 0.58
      );
      this.muzzleLight.intensity = 14.0 * (this.ctrlState.muzzleFlashTimer / 0.07);
    } else {
      this.muzzleLight.intensity = 0;
    }

    // Smooth GTA-5 / Battlegrounds over-the-shoulder 3rd-person follow camera!
    const dist = this.ctrlState.isAiming ? 1.65 : 2.95;
    const shoulderRight = this.ctrlState.isAiming ? 0.44 : 0.22;
    const lookHeight = this.ctrlState.isCrouching ? 1.12 : 1.46;

    const fwdX = Math.sin(this.combatCamYaw);
    const fwdZ = Math.cos(this.combatCamYaw);
    const rightX = -Math.cos(this.combatCamYaw);
    const rightZ = Math.sin(this.combatCamYaw);

    this._v1.set(
      this.ctrlState.posX - fwdX * dist * Math.cos(this.combatCamPitch) + rightX * shoulderRight,
      this.ctrlState.posY + lookHeight + dist * Math.sin(this.combatCamPitch) + 0.16,
      this.ctrlState.posZ - fwdZ * dist * Math.cos(this.combatCamPitch) + rightZ * shoulderRight
    );
    this._v2.set(
      this.ctrlState.posX + fwdX * 1.4 + rightX * (shoulderRight * 0.6),
      this.ctrlState.posY + lookHeight - Math.sin(this.combatCamPitch) * 0.85,
      this.ctrlState.posZ + fwdZ * 1.4 + rightZ * (shoulderRight * 0.6)
    );

    const k = 1 - Math.exp(-10 * dt);
    this.camera.position.lerp(this._v1, k);
    this.controls.target.lerp(this._v2, k);
    this.camera.lookAt(this.controls.target);

    // Subtle FOV punch on aiming/sprinting
    const targetFov = this.ctrlState.isAiming ? 31 : this.ctrlState.speed > 4.2 ? 42 : 37;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = dampScalar(this.camera.fov, targetFov, 9, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('mousemove', this.handleMouseMove);

    const dom = this.renderer.domElement;
    dom.removeEventListener('mousedown', this.handleMouseDown);
    dom.removeEventListener('contextmenu', this.handleContextMenu);
    dom.removeEventListener('webglcontextlost', this.handleContextLost);

    this.controls.dispose();
    this.character.dispose();
    this.backdropTex.dispose();
    this.shadowTex.dispose();
    this.envRT.dispose();
    this.renderer.dispose();
    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
    delete window.__charStudio;
  }
}
