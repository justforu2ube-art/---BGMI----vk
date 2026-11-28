import { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  Download,
  Eye,
  Flashlight,
  HelpCircle,
  Menu,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  CAMERA_PRESETS,
  CameraPresetKey,
  CharacterStudioEngine,
  DEFAULT_LIGHTING_PRESET,
  EquippedWeaponId,
  LIGHTING_PRESETS,
  LightingPresetKey,
  StudioMode,
  WEAPON_ORDER,
  WEAPON_SPECS,
  WeaponHUDState,
} from './studio/studioScene';
import { ANIMATION_NAMES, AnimationName } from './character/animations';
import { FACIAL_MORPH_NAMES, FacialMorphName } from './character/headSculpt';
import { BuiltCharacter } from './character/characterBuilder';
import { CharacterLodLevel } from './types/studioTypes';
import { tacticalAudio } from './studio/audio';
import { weaponAudio } from './weapons/weaponAudio';
import {
  setHideWelcomeGuidePreference,
  shouldShowWelcomeGuide,
} from './studio/welcomeGuidePrefs';
import { WelcomeGuideModal } from './components/WelcomeGuideModal';

type StudioSection = 'inspect' | 'arsenal' | 'combat' | 'animations' | 'camera' | 'morphs' | 'display';

const ANIM_LABELS: Record<AnimationName, string> = {
  Idle_Natural: 'Idle Natural',
  Walk_Casual_GTA: 'Walk Casual',
  Jog_Tactical: 'Jog Tactical',
  Sprint_Combat: 'Sprint Combat',
  Crouch_Idle: 'Crouch Idle',
  Crouch_Walk: 'Crouch Walk',
  Strafe_Left: 'Strafe Left',
  Strafe_Right: 'Strafe Right',
  Combat_Aim_Stance: 'Combat Aim',
  Combat_Fire_Burst: 'Fire Burst',
  Jump_Action: 'Jump Action',
};

const MORPH_LABELS: Record<FacialMorphName, string> = {
  Blink_L: 'Blink Left',
  Blink_R: 'Blink Right',
  Brow_Focus: 'Brow Focus',
  Mouth_Smirk: 'Mouth Smirk',
  Mouth_Grit_Fire: 'Fire Grit',
  Nostril_Flare: 'Nostril Flare',
};

const LIGHTING_SHORT_LABELS: Record<LightingPresetKey, string> = {
  studio_soft: 'Studio Soft',
  harsh_sunlight: 'Harsh Sunlight',
  night_operation: 'Night Operation',
  indoor_warehouse: 'Indoor Warehouse',
};

const LIGHTING_FILE_CODES: Record<LightingPresetKey, string> = {
  studio_soft: 'STUDIO_SOFT.HDR',
  harsh_sunlight: 'HARSH_SUNLIGHT.HDR',
  night_operation: 'NIGHT_OPERATION.HDR',
  indoor_warehouse: 'INDOOR_WAREHOUSE.HDR',
};

const NAV_ITEMS: { id: StudioSection; label: string }[] = [
  { id: 'inspect', label: 'Turntable Inspect' },
  { id: 'arsenal', label: 'Arsenal (5)' },
  { id: 'combat', label: 'Combat Controller' },
  { id: 'animations', label: 'Animations (11)' },
  { id: 'camera', label: 'Camera Presets' },
  { id: 'morphs', label: 'Facial Morphs' },
  { id: 'display', label: 'Display & Rig' },
];

const INITIAL_WEAPON_HUD: WeaponHUDState = {
  equipped: 'mk18',
  mag: WEAPON_SPECS.mk18.magSize,
  magSize: WEAPON_SPECS.mk18.magSize,
  reserve: WEAPON_SPECS.mk18.reserveMax,
  fireMode: WEAPON_SPECS.mk18.defaultFireMode,
  isReloading: false,
  reloadProgress: 0,
  isInspecting: false,
  laserEnabled: false,
  reticleSpread: 0.14,
  gunTurntable: false,
};

function isAutostartRequested(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('autostart') === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<CharacterStudioEngine | null>(null);

  const [mode, setMode] = useState<StudioMode>('inspect');
  const [activeSection, setActiveSection] = useState<StudioSection>('inspect');
  const [uiHidden, setUiHidden] = useState(false);
  const [activeAnim, setActiveAnim] = useState<AnimationName>('Idle_Natural');
  const [activeCam, setActiveCam] = useState<CameraPresetKey>('full_body');
  const [activeLighting, setActiveLighting] = useState<LightingPresetKey>(DEFAULT_LIGHTING_PRESET);
  const [stats, setStats] = useState<BuiltCharacter['stats'] | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingWeapon, setIsExportingWeapon] = useState(false);
  const [isAiming, setIsAiming] = useState(false);
  const [awmScopeActive, setAwmScopeActive] = useState(false);
  const [weaponHud, setWeaponHud] = useState<WeaponHUDState>(INITIAL_WEAPON_HUD);

  // Responsive <=768px slide-over drawers
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);

  // Welcome controls guide modal state (persisted via localStorage; skippable via ?autostart=1)
  const [guideOpen, setGuideOpen] = useState<boolean>(
    () => !isAutostartRequested() && shouldShowWelcomeGuide()
  );
  const [dontShowNextTime, setDontShowNextTime] = useState<boolean>(() => !shouldShowWelcomeGuide());
  const guideOpenRef = useRef(guideOpen);
  guideOpenRef.current = guideOpen;

  // Display options
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [lodLevel, setLodLevel] = useState<CharacterLodLevel>('LOD0');
  const [muted, setMuted] = useState(false);

  // Facial Morph Sliders
  const [morphs, setMorphs] = useState<Record<FacialMorphName, number>>({
    Blink_L: 0,
    Blink_R: 0,
    Brow_Focus: 0.14,
    Mouth_Smirk: 0.36,
    Mouth_Grit_Fire: 0,
    Nostril_Flare: 0,
  });

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const engine = new CharacterStudioEngine(el, {
      onAnimChange: (name) => setActiveAnim(name),
      onStatsReady: (s) => setStats(s),
      onModeChange: (m) => {
        setMode(m);
        setActiveSection((prev) => {
          if (m === 'combat') return 'combat';
          return prev === 'combat' ? 'inspect' : prev;
        });
      },
      onAimStateChange: (aim) => setIsAiming(aim),
      onAwmScopeChange: (active) => setAwmScopeActive(active),
      onWeaponStateChange: (ws) => setWeaponHud(ws),
    });
    engineRef.current = engine;

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (guideOpenRef.current) return;
      if (e.key === 'h' || e.key === 'H') {
        setUiHidden((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleSectionSelect = (section: StudioSection) => {
    setActiveSection(section);
    setLeftDrawerOpen(false);
    if (section === 'combat') {
      if (mode !== 'combat') {
        setMode('combat');
        engineRef.current?.setMode('combat');
      }
    } else if (mode !== 'inspect') {
      setMode('inspect');
      engineRef.current?.setMode('inspect');
    }
  };

  const handleAnimClick = (name: AnimationName) => {
    setActiveAnim(name);
    engineRef.current?.playAnimation(name, 0.22);
  };

  const handleCamClick = (preset: CameraPresetKey) => {
    setActiveCam(preset);
    engineRef.current?.setCameraPreset(preset, false);
  };

  const handleLightingClick = (preset: LightingPresetKey) => {
    setActiveLighting(preset);
    engineRef.current?.setLightingPreset(preset);
  };

  const handleMorphChange = (name: FacialMorphName, val: number) => {
    setMorphs((prev) => ({ ...prev, [name]: val }));
    engineRef.current?.setMorphOverride(name, val);
  };

  const handleResetMorphs = () => {
    const defaults: Record<FacialMorphName, number> = {
      Blink_L: 0,
      Blink_R: 0,
      Brow_Focus: 0.14,
      Mouth_Smirk: 0.36,
      Mouth_Grit_Fire: 0,
      Nostril_Flare: 0,
    };
    setMorphs(defaults);
    for (const mn of FACIAL_MORPH_NAMES) {
      engineRef.current?.setMorphOverride(mn, null);
    }
  };

  const handleExportGLB = async () => {
    if (!engineRef.current || isExporting) return;
    setIsExporting(true);
    try {
      await engineRef.current.downloadGLB('hero_commando_aaa.glb');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportWeaponGLB = async () => {
    if (!engineRef.current || isExportingWeapon || weaponHud.equipped === 'none') return;
    setIsExportingWeapon(true);
    try {
      await engineRef.current.downloadWeaponGLB(weaponHud.equipped);
    } finally {
      setIsExportingWeapon(false);
    }
  };

  const handleSelectWeapon = (id: EquippedWeaponId) => {
    engineRef.current?.setWeapon(id);
  };

  const handleToggleGunTurntable = () => {
    const next = !weaponHud.gunTurntable;
    engineRef.current?.setGunTurntable(next);
  };

  const handleToggleFireMode = () => {
    engineRef.current?.toggleFireMode();
  };

  const handleReload = () => {
    engineRef.current?.triggerReload();
  };

  const handleToggleInspect = () => {
    engineRef.current?.toggleWeaponInspect();
  };

  const handleToggleLaser = () => {
    engineRef.current?.toggleLaser();
  };

  const handleTestFire = () => {
    engineRef.current?.triggerTestShot();
  };

  const handleToggleSkeleton = () => {
    const next = !showSkeleton;
    setShowSkeleton(next);
    engineRef.current?.setDisplayOptions({ skeleton: next });
  };

  const handleToggleWireframe = () => {
    const next = !wireframe;
    setWireframe(next);
    engineRef.current?.setDisplayOptions({ wireframe: next });
  };

  const handleToggleAutoRotate = () => {
    const next = !autoRotate;
    setAutoRotate(next);
    engineRef.current?.setDisplayOptions({ autoRotate: next });
  };

  const handleSpeedChange = (val: number) => {
    setPlaybackSpeed(val);
    engineRef.current?.setDisplayOptions({ playbackSpeed: val });
  };

  const handleLodChange = (next: CharacterLodLevel) => {
    setLodLevel(next);
    engineRef.current?.setDisplayOptions({ lod: next });
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    tacticalAudio.muted = next;
    weaponAudio.muted = next;
  };

  const handleDontShowGuideChange = (checked: boolean) => {
    setDontShowNextTime(checked);
    setHideWelcomeGuidePreference(checked);
  };

  const handleCloseGuide = () => {
    setHideWelcomeGuidePreference(dontShowNextTime);
    setGuideOpen(false);
  };

  const handleOpenGuide = () => {
    setGuideOpen(true);
  };

  const activeLightingObj = LIGHTING_PRESETS.find((p) => p.id === activeLighting);
  const activeWeaponSpec =
    weaponHud.equipped !== 'none' ? WEAPON_SPECS[weaponHud.equipped] : null;
  const reticleGapPx = Math.round(6 + weaponHud.reticleSpread * 26);

  const renderWeaponSelector = () => (
    <section className="flex flex-col">
      <div className="flex items-center justify-between mb-3.5">
        <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50">
          Tactical Arsenal (1–5)
        </h3>
        {!weaponHud.gunTurntable && (
          <button
            type="button"
            onClick={() => handleSelectWeapon('none')}
            aria-pressed={weaponHud.equipped === 'none'}
            className={`font-mono-tabular text-[0.65rem] uppercase tracking-[0.06em] cursor-pointer ${
              weaponHud.equipped === 'none'
                ? 'text-[#1a1a1a] font-semibold underline underline-offset-4'
                : 'text-[#1a1a1a]/55 hover:text-[#ff4d00]'
            }`}
          >
            [0] Holster
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {WEAPON_ORDER.map((id) => {
          const spec = WEAPON_SPECS[id];
          const active = weaponHud.equipped === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              data-testid={`weapon-btn-${id}`}
              onClick={() => handleSelectWeapon(id)}
              className={`w-full text-left px-3 py-2.5 rounded-[4px] border transition-colors duration-150 cursor-pointer flex items-center justify-between gap-2 ${
                active
                  ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white'
                  : 'border-[#1a1a1a]/[0.10] bg-white text-[#1a1a1a] hover:border-[#1a1a1a]/35'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono-tabular text-[0.65rem] font-semibold ${
                      active ? 'text-[#ff6a2b]' : 'text-[#1a1a1a]/45'
                    }`}
                  >
                    [{spec.slot}]
                  </span>
                  <span className="text-[0.78rem] font-medium truncate">{spec.shortName}</span>
                </div>
                <div
                  className={`font-mono-tabular text-[0.62rem] mt-0.5 truncate ${
                    active ? 'text-white/65' : 'text-[#1a1a1a]/50'
                  }`}
                >
                  {spec.caliber} · {spec.magSize}-RND · {spec.rpm} RPM
                </div>
              </div>
              <span
                className={`font-mono-tabular text-[0.6rem] uppercase px-1.5 py-0.5 rounded-[3px] shrink-0 ${
                  active ? 'bg-white/15 text-white' : 'bg-[#f8f7f4] text-[#1a1a1a]/65'
                }`}
              >
                {spec.defaultFireMode}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );

  const renderLightingControls = () => (
    <section className="flex flex-col">
      <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-4">
        Lighting Environment
      </h3>
      <div className="flex flex-col gap-2.5">
        {LIGHTING_PRESETS.map((preset) => {
          const active = activeLighting === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => handleLightingClick(preset.id)}
              className={`w-full text-left px-3.5 py-2.5 text-[0.78rem] rounded-[4px] border transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                active
                  ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white font-medium'
                  : 'border-[#1a1a1a]/[0.10] bg-white text-[#1a1a1a] hover:border-[#1a1a1a]/35'
              }`}
            >
              {LIGHTING_SHORT_LABELS[preset.id]}
            </button>
          );
        })}
      </div>
    </section>
  );

  return (
    <div
      className="studio-shell bg-[#f8f7f4] text-[#1a1a1a]"
      data-mode={mode}
      data-anim={activeAnim}
      data-lighting={activeLighting}
      data-weapon={weaponHud.equipped}
      data-turntable={weaponHud.gunTurntable ? '1' : '0'}
      data-awm-scope={awmScopeActive ? '1' : '0'}
      data-lod={lodLevel}
    >
      {/* Mobile Slide-Over Backdrop */}
      {!uiHidden && (leftDrawerOpen || rightDrawerOpen) && (
        <button
          type="button"
          aria-label="Close studio drawers"
          onClick={() => {
            setLeftDrawerOpen(false);
            setRightDrawerOpen(false);
          }}
          className="mobile-drawer-backdrop open fixed inset-0 z-40 bg-black/40 cursor-pointer"
        />
      )}

      {/* Left Navigation Sidebar */}
      {!uiHidden && (
        <aside
          aria-label="Studio Sidebar"
          className={`studio-shell-sidebar bg-white border-r border-[#1a1a1a]/[0.08] px-5 xl:px-6 py-6 xl:py-8 ${
            leftDrawerOpen ? 'drawer-open' : ''
          }`}
        >
          <div>
            <div className="flex items-center justify-between gap-2 mb-10">
              <h1 className="font-editorial italic font-semibold text-[1.75rem] xl:text-[1.9rem] leading-none tracking-[-0.01em] text-[#1a1a1a]">
                Vanguard.
              </h1>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setLeftDrawerOpen(false)}
                className="mobile-drawer-btn w-7 h-7 rounded-md border border-[#1a1a1a]/15 items-center justify-center text-[#1a1a1a] cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <nav aria-label="Studio Navigation" className="flex flex-col gap-5">
              {NAV_ITEMS.map((item) => {
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => handleSectionSelect(item.id)}
                    className={`group flex items-center gap-3.5 text-left uppercase font-mono-tabular text-[0.72rem] tracking-[0.09em] transition-opacity duration-150 cursor-pointer whitespace-nowrap ${
                      isActive
                        ? 'opacity-100 font-semibold text-[#1a1a1a]'
                        : 'opacity-45 hover:opacity-85 text-[#1a1a1a]'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-2 h-2 rounded-full border shrink-0 transition-colors duration-150 ${
                        isActive
                          ? 'bg-[#ff4d00] border-[#ff4d00]'
                          : 'bg-transparent border-[#1a1a1a] group-hover:border-[#1a1a1a]'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="mt-8 font-mono-tabular text-[0.65rem] leading-[1.6] tracking-[0.04em] text-[#1a1a1a]/45 uppercase">
            <div>VERSION 1.87 STUDIO</div>
            <div>UE5 IK_MANNEQUIN</div>
          </div>
        </aside>
      )}

      {/* Top Architectural Header */}
      {!uiHidden && (
        <header className="studio-shell-header px-4 md:px-6 xl:px-8 py-3.5 md:py-5 flex items-center justify-between gap-3 border-b border-[#1a1a1a]/[0.08] bg-[#f8f7f4]">
          <div className="flex items-center gap-2.5 md:gap-4 min-w-0">
            <button
              type="button"
              aria-label="Toggle studio menu"
              aria-expanded={leftDrawerOpen}
              data-testid="mobile-menu-btn"
              onClick={() => {
                setRightDrawerOpen(false);
                setLeftDrawerOpen((v) => !v);
              }}
              className="mobile-drawer-btn w-8 h-8 rounded-md border border-[#1a1a1a]/[0.16] bg-white items-center justify-center text-[#1a1a1a] cursor-pointer shrink-0"
            >
              <Menu className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="mobile-drawer-btn font-editorial italic font-semibold text-xl leading-none text-[#1a1a1a] shrink-0">
              Vanguard.
            </span>
            <span className="font-mono-tabular text-[0.62rem] md:text-[0.65rem] tracking-[0.08em] bg-[#1a1a1a] text-white px-2.5 md:px-3 py-1 rounded-full whitespace-nowrap shrink-0 truncate max-w-[46vw]">
              {mode === 'combat' ? 'COMBAT_CONTROLLER_ACTIVE' : 'LIVE_VIEWPORT_ENABLED'}
            </span>
          </div>

          <div className="flex items-center gap-2.5 md:gap-3.5 shrink-0">
            <span className="hidden md:inline font-mono-tabular text-[0.72rem] tracking-[0.05em] text-[#1a1a1a] whitespace-nowrap">
              OPERATOR_ALPHA_GEN3
            </span>
            <button
              type="button"
              onClick={handleOpenGuide}
              aria-label="Open controls guide"
              title="Controls Guide"
              data-testid="open-guide-btn"
              className="w-8 h-8 rounded-full border border-[#1a1a1a]/[0.16] bg-white hover:bg-[#1a1a1a] hover:text-white text-[#1a1a1a] flex items-center justify-center transition-colors duration-150 cursor-pointer shrink-0"
            >
              <HelpCircle className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Toggle studio inspector"
              aria-expanded={rightDrawerOpen}
              data-testid="mobile-inspector-btn"
              onClick={() => {
                setLeftDrawerOpen(false);
                setRightDrawerOpen((v) => !v);
              }}
              className="mobile-drawer-btn w-8 h-8 rounded-md border border-[#1a1a1a]/[0.16] bg-white items-center justify-center text-[#1a1a1a] cursor-pointer shrink-0"
            >
              <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </header>
      )}

      {/* Center Framed 3D Viewport (Preserves WebGL mount cleanly across full-screen H toggle) */}
      <main
        className={
          uiHidden
            ? 'fixed inset-0 z-30 studio-viewport-grid overflow-hidden'
            : 'studio-shell-main relative m-2 md:m-4 xl:m-5 rounded-2xl border border-[#1a1a1a]/[0.08] overflow-hidden studio-viewport-grid'
        }
      >
        {/* Dedicated Isolated WebGL Mount */}
        <div
          ref={mountRef}
          data-testid="studio-viewport"
          className="w-full h-full"
        />

        {/* Dynamic Tactical Crosshair & Masked AWM .338 Mildot Sniper Scope Overlay */}
        {mode === 'combat' && !weaponHud.gunTurntable && (
          weaponHud.equipped === 'awm' && (awmScopeActive || isAiming) ? (
            <div
              aria-hidden="true"
              data-testid="awm-scope-overlay"
              className="awm-scope-mask absolute inset-0 z-20 pointer-events-none flex items-center justify-center"
            >
              <svg viewBox="0 0 400 400" className="w-[70vh] h-[70vh] max-w-[92%] max-h-[92%]">
                <circle cx="200" cy="200" r="192" fill="none" stroke="rgba(4,6,8,0.96)" strokeWidth="10" />
                <circle cx="200" cy="200" r="186" fill="none" stroke="rgba(190,245,215,0.42)" strokeWidth="1.2" />
                <line x1="14" y1="200" x2="188" y2="200" stroke="rgba(14,20,18,0.94)" strokeWidth="1.35" />
                <line x1="212" y1="200" x2="386" y2="200" stroke="rgba(14,20,18,0.94)" strokeWidth="1.35" />
                <line x1="200" y1="14" x2="200" y2="188" stroke="rgba(14,20,18,0.94)" strokeWidth="1.35" />
                <line x1="200" y1="212" x2="200" y2="386" stroke="rgba(14,20,18,0.94)" strokeWidth="1.35" />
                <line x1="14" y1="200" x2="96" y2="200" stroke="#06080b" strokeWidth="3.6" />
                <line x1="304" y1="200" x2="386" y2="200" stroke="#06080b" strokeWidth="3.6" />
                <line x1="200" y1="304" x2="200" y2="386" stroke="#06080b" strokeWidth="3.6" />
                {[116, 138, 160, 180, 220, 240, 262, 284].map((p) => (
                  <g key={p}>
                    <circle cx={p} cy="200" r="2.2" fill="#0d1411" />
                    <circle cx="200" cy={p} r="2.2" fill="#0d1411" />
                  </g>
                ))}
                <circle cx="200" cy="200" r="2.5" fill="#ff3b20" />
              </svg>
            </div>
          ) : (
            <div
              aria-hidden="true"
              className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center"
            >
              <div className="relative w-2 h-2">
                <span
                  className="absolute left-1/2 -translate-x-1/2 w-[1.5px] h-2.5 bg-white/90"
                  style={{ bottom: `${reticleGapPx}px` }}
                />
                <span
                  className="absolute left-1/2 -translate-x-1/2 w-[1.5px] h-2.5 bg-white/90"
                  style={{ top: `${reticleGapPx}px` }}
                />
                <span
                  className="absolute top-1/2 -translate-y-1/2 h-[1.5px] w-2.5 bg-white/90"
                  style={{ right: `${reticleGapPx}px` }}
                />
                <span
                  className="absolute top-1/2 -translate-y-1/2 h-[1.5px] w-2.5 bg-white/90"
                  style={{ left: `${reticleGapPx}px` }}
                />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[2.5px] h-[2.5px] rounded-full bg-[#ff4d00]" />
              </div>
            </div>
          )
        )}

        {/* Minimal Battlegrounds Weapon HUD (Zero backdrop-blur for fast WebGL!) */}
        {!uiHidden && activeWeaponSpec && (
          <div
            data-testid="weapon-hud"
            className="pointer-events-auto absolute top-4 right-4 z-10 bg-[#14171c]/90 text-white border border-white/15 rounded-lg px-3.5 py-2.5 min-w-[205px]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono-tabular text-[0.72rem] font-semibold tracking-[0.06em] uppercase">
                {activeWeaponSpec.shortName}
              </span>
              {weaponHud.fireMode && (
                <button
                  type="button"
                  onClick={handleToggleFireMode}
                  title="Toggle Fire Mode (B)"
                  className="font-mono-tabular text-[0.6rem] tracking-[0.08em] uppercase px-1.5 py-0.5 rounded bg-[#ff4d00] text-white cursor-pointer"
                >
                  {weaponHud.fireMode}
                </button>
              )}
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="font-mono-tabular text-[0.6rem] text-white/60 uppercase">
                {activeWeaponSpec.caliber}
              </span>
              {weaponHud.isReloading ? (
                <span className="font-mono-tabular text-[0.72rem] font-semibold text-[#ff9154] uppercase">
                  RELOADING {Math.round(weaponHud.reloadProgress * 100)}%
                </span>
              ) : (
                <span className="font-mono-tabular text-[1.05rem] leading-none font-semibold">
                  {weaponHud.mag}
                  <span className="text-[0.72rem] text-white/55 font-normal">
                    {' '}
                    / {weaponHud.reserve}
                  </span>
                </span>
              )}
            </div>
            <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center gap-1">
              {WEAPON_ORDER.map((id) => {
                const s = WEAPON_SPECS[id];
                const active = weaponHud.equipped === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectWeapon(id)}
                    aria-label={`Equip ${s.shortName}`}
                    className={`flex-1 font-mono-tabular text-[0.62rem] py-0.5 rounded transition-colors cursor-pointer ${
                      active
                        ? 'bg-white text-[#14171c] font-semibold'
                        : 'bg-white/10 text-white/75 hover:bg-white/20'
                    }`}
                  >
                    {s.slot}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Editorial Viewport Bottom Overlay (Pointer-events-none for unobstructed orbit & combat) */}
        {!uiHidden && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-7 pb-6 pt-14 bg-gradient-to-t from-black/50 via-black/15 to-transparent flex items-baseline justify-between gap-4">
            <div className="font-editorial italic font-semibold text-[2.4rem] lg:text-[2.85rem] leading-none text-white drop-shadow-[0_1px_10px_rgba(0,0,0,0.35)]">
              {weaponHud.gunTurntable
                ? 'Gun Macro.'
                : mode === 'combat'
                  ? 'Combat Mode.'
                  : 'Studio Mode.'}
            </div>
            <div className="font-mono-tabular text-[0.7rem] tracking-[0.08em] text-white/90 uppercase whitespace-nowrap">
              {weaponHud.gunTurntable && activeWeaponSpec
                ? `${activeWeaponSpec.shortName.toUpperCase()} · ${activeWeaponSpec.caliber}`
                : LIGHTING_FILE_CODES[activeLighting]}
            </div>
          </div>
        )}

        {/* Restore UI Control when Hidden via 'H' */}
        {uiHidden && (
          <button
            type="button"
            onClick={() => setUiHidden(false)}
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-[#1a1a1a]/90 text-white font-mono-tabular text-[0.7rem] tracking-[0.08em] uppercase border border-white/15 hover:bg-[#1a1a1a] transition-colors cursor-pointer"
          >
            Show Studio UI (H)
          </button>
        )}
      </main>

      {/* Right Inspector Column (Scrollable body above sticky .export-footer) */}
      {!uiHidden && (
        <aside
          aria-label="Character Studio Inspector"
          className={`studio-shell-inspector-col border-l border-[#1a1a1a]/[0.08] bg-[#f8f7f4] ${
            rightDrawerOpen ? 'drawer-open' : ''
          }`}
        >
          <div className="mobile-drawer-btn items-center justify-between px-5 py-3 border-b border-[#1a1a1a]/[0.08] bg-white">
            <span className="font-mono-tabular text-[0.7rem] uppercase tracking-[0.1em] font-semibold">
              Inspector
            </span>
            <button
              type="button"
              aria-label="Close studio inspector"
              onClick={() => setRightDrawerOpen(false)}
              className="w-7 h-7 rounded-md border border-[#1a1a1a]/15 flex items-center justify-center text-[#1a1a1a] cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <section className="studio-shell-inspector-body px-5 xl:px-6 py-6 xl:py-7 flex flex-col gap-7">
            {/* Section: Turntable Inspect */}
            {activeSection === 'inspect' && (
              <>
                {renderLightingControls()}

                <section className="flex flex-col">
                  <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-3.5">
                    System Status
                  </h3>
                  <p className="text-[0.76rem] leading-[1.6] text-[#1a1a1a]/85">
                    Rendering{' '}
                    <span className="font-mono-tabular font-medium text-[#1a1a1a]">
                      {stats ? stats.triangleCount.toLocaleString() : '34,800'}
                    </span>{' '}
                    triangles ({lodLevel},{' '}
                    <span className="font-mono-tabular font-medium text-[#1a1a1a]">
                      {stats ? stats.materialSlots : 6} PBR
                    </span>{' '}
                    slots). UE5 skeleton verified (
                    <span className="font-mono-tabular font-medium text-[#1a1a1a]">
                      {stats ? stats.boneCount : 63} bones
                    </span>
                    ).
                  </p>
                  {activeLightingObj && (
                    <p className="mt-2.5 text-[0.71rem] leading-[1.55] text-[#1a1a1a]/55">
                      {activeLightingObj.description}
                    </p>
                  )}
                </section>

              <section className="flex flex-col pt-5 border-t border-[#1a1a1a]/[0.08] gap-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50">
                    Active Firearm
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleSectionSelect('arsenal')}
                    className="font-mono-tabular text-[0.68rem] uppercase tracking-[0.06em] text-[#ff4d00] hover:underline underline-offset-4 cursor-pointer"
                  >
                    Arsenal (5)
                  </button>
                </div>
                <div className="flex items-center justify-between text-[0.78rem]">
                  <span className="font-medium text-[#1a1a1a]">
                    {activeWeaponSpec ? activeWeaponSpec.shortName : 'Holstered (Empty)'}
                  </span>
                  <button
                    type="button"
                    data-testid="gun-turntable-quick-btn"
                    onClick={handleToggleGunTurntable}
                    className="font-mono-tabular text-[0.66rem] uppercase tracking-[0.06em] px-2 py-1 rounded border border-[#1a1a1a]/15 bg-white hover:border-[#1a1a1a] cursor-pointer"
                  >
                    {weaponHud.gunTurntable ? 'Show Operator' : 'Gun Macro'}
                  </button>
                </div>
              </section>
            </>
          )}

          {/* Section: 5-Weapon Tactical Arsenal & Gun Macro Turntable */}
          {activeSection === 'arsenal' && (
            <>
              {renderWeaponSelector()}

              <section className="flex flex-col gap-2.5">
                <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-1">
                  Inspection &amp; Mechanics
                </h3>

                <button
                  type="button"
                  data-testid="gun-turntable-btn"
                  aria-pressed={weaponHud.gunTurntable}
                  onClick={handleToggleGunTurntable}
                  className={`w-full px-3.5 py-2.5 text-[0.78rem] rounded-[4px] border transition-colors duration-150 cursor-pointer flex items-center justify-between ${
                    weaponHud.gunTurntable
                      ? 'border-[#ff4d00] bg-[#ff4d00] text-white font-medium'
                      : 'border-[#1a1a1a]/[0.14] bg-white text-[#1a1a1a] hover:border-[#1a1a1a]'
                  }`}
                >
                  <span>Gun Macro Turntable (5cm)</span>
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleTestFire}
                    disabled={!activeWeaponSpec}
                    className="px-3 py-2 text-[0.74rem] rounded-[4px] border border-[#1a1a1a]/[0.12] bg-white hover:border-[#1a1a1a] disabled:opacity-45 text-[#1a1a1a] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
                    Test Fire
                  </button>
                  <button
                    type="button"
                    onClick={handleReload}
                    disabled={!activeWeaponSpec}
                    className="px-3 py-2 text-[0.74rem] rounded-[4px] border border-[#1a1a1a]/[0.12] bg-white hover:border-[#1a1a1a] disabled:opacity-45 text-[#1a1a1a] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    Reload (R)
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleInspect}
                    disabled={!activeWeaponSpec || weaponHud.gunTurntable}
                    aria-pressed={weaponHud.isInspecting}
                    className={`px-3 py-2 text-[0.74rem] rounded-[4px] border disabled:opacity-45 cursor-pointer ${
                      weaponHud.isInspecting
                        ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white'
                        : 'border-[#1a1a1a]/[0.12] bg-white hover:border-[#1a1a1a] text-[#1a1a1a]'
                    }`}
                  >
                    Inspect (I)
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleLaser}
                    disabled={!activeWeaponSpec}
                    aria-pressed={weaponHud.laserEnabled}
                    className={`px-3 py-2 text-[0.74rem] rounded-[4px] border disabled:opacity-45 flex items-center justify-center gap-1.5 cursor-pointer ${
                      weaponHud.laserEnabled
                        ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white'
                        : 'border-[#1a1a1a]/[0.12] bg-white hover:border-[#1a1a1a] text-[#1a1a1a]'
                    }`}
                  >
                    <Flashlight className="w-3.5 h-3.5" aria-hidden="true" />
                    Laser / Light (L)
                  </button>
                </div>

                {activeWeaponSpec && (
                  <p className="mt-1 text-[0.72rem] leading-[1.5] text-[#1a1a1a]/60">
                    {activeWeaponSpec.name} · {activeWeaponSpec.caliber} ·{' '}
                    {activeWeaponSpec.lengthMeters.toFixed(2)}m · Named UE5 sockets &amp; PBR maps
                  </p>
                )}

                <div className="mt-1 flex items-center justify-between py-2 px-3 bg-white border border-[#1a1a1a]/[0.08] rounded-[4px]">
                  <span className="font-mono-tabular text-[0.7rem] text-[#1a1a1a]/65">
                    Weapon Audio
                  </span>
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    aria-label={muted ? 'Unmute weapon audio' : 'Mute weapon audio'}
                    className="flex items-center gap-1.5 text-[0.72rem] font-mono-tabular text-[#1a1a1a] hover:text-[#ff4d00] transition-colors cursor-pointer"
                  >
                    {muted ? (
                      <>
                        <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
                        Muted
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Active
                      </>
                    )}
                  </button>
                </div>
              </section>
            </>
          )}

          {/* Section: Combat Controller */}
          {activeSection === 'combat' && (
            <>
              {renderWeaponSelector()}

              <section className="flex flex-col">
                <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-4">
                  Combat Controls
                </h3>
                <div className="flex flex-col gap-2 text-[0.76rem]">
                  {(
                    [
                      ['W A S D', 'Move / Shift Sprint / C Crouch'],
                      ['1 – 5 / Wheel', 'Switch Firearms (0 Holster)'],
                      ['Hold RMB', 'Aim Down Sights (ADS)'],
                      ['LMB / B', 'Fire / Auto-Semi Toggle'],
                      ['R / I / L', 'Reload / Inspect / Laser-Light'],
                      ['Space', 'Jump'],
                    ] as const
                  ).map(([key, action]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between py-2 px-3 bg-white border border-[#1a1a1a]/[0.08] rounded-[4px] gap-2"
                    >
                      <span className="font-mono-tabular text-[0.7rem] font-medium text-[#1a1a1a] whitespace-nowrap">
                        {key}
                      </span>
                      <span className="text-[#1a1a1a]/65 text-right">{action}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between py-2.5 px-3 bg-white border border-[#1a1a1a]/[0.08] rounded-[4px]">
                  <span className="text-[0.75rem] text-[#1a1a1a]/70">
                    Clip:{' '}
                    <strong className="font-mono-tabular text-[#1a1a1a]">
                      {ANIM_LABELS[activeAnim]}
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    aria-label={muted ? 'Unmute gunshot audio' : 'Mute gunshot audio'}
                    className="flex items-center gap-1.5 text-[0.72rem] font-mono-tabular text-[#1a1a1a] hover:text-[#ff4d00] transition-colors cursor-pointer"
                  >
                    {muted ? (
                      <>
                        <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
                        Muted
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Audio
                      </>
                    )}
                  </button>
                </div>
              </section>

              {renderLightingControls()}
            </>
          )}

          {/* Section: 11 Biomechanical Animations */}
          {activeSection === 'animations' && (
            <section className="flex flex-col">
              <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-4">
                Animations (11)
              </h3>
              <div className="flex flex-col gap-2">
                {ANIMATION_NAMES.map((name) => {
                  const active = activeAnim === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleAnimClick(name)}
                      className={`w-full text-left px-3.5 py-2.5 text-[0.78rem] rounded-[4px] border transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                        active
                          ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white font-medium'
                          : 'border-[#1a1a1a]/[0.10] bg-white text-[#1a1a1a] hover:border-[#1a1a1a]/35'
                      }`}
                    >
                      {ANIM_LABELS[name]}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Section: Camera Presets */}
          {activeSection === 'camera' && (
            <>
              <section className="flex flex-col">
                <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-4">
                  Camera Presets
                </h3>
                <div className="flex flex-col gap-2.5">
                  {CAMERA_PRESETS.map((p) => {
                    const active = activeCam === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => handleCamClick(p.id)}
                        className={`w-full text-left px-3.5 py-2.5 text-[0.78rem] rounded-[4px] border transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                          active
                            ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white font-medium'
                            : 'border-[#1a1a1a]/[0.10] bg-white text-[#1a1a1a] hover:border-[#1a1a1a]/35'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              {renderLightingControls()}
            </>
          )}

          {/* Section: Live Facial Morph Targets */}
          {activeSection === 'morphs' && (
            <section className="flex flex-col">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50">
                  Facial Morphs
                </h3>
                <button
                  type="button"
                  onClick={handleResetMorphs}
                  className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.06em] text-[#ff4d00] hover:underline underline-offset-4 cursor-pointer"
                >
                  Reset
                </button>
              </div>
              <div className="flex flex-col gap-5">
                {FACIAL_MORPH_NAMES.map((mn) => (
                  <label key={mn} className="flex flex-col gap-2 text-[0.78rem]">
                    <div className="flex items-center justify-between">
                      <span className="text-[#1a1a1a]">{MORPH_LABELS[mn]}</span>
                      <span className="font-mono-tabular text-[0.72rem] text-[#1a1a1a]/55">
                        {Math.round(morphs[mn] * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={morphs[mn]}
                      onChange={(e) => handleMorphChange(mn, parseFloat(e.target.value))}
                      className="studio-slider w-full"
                    />
                  </label>
                ))}
              </div>
            </section>
          )}

          {/* Section: Display & Rig */}
          {activeSection === 'display' && (
            <>
              <section className="flex flex-col">
                <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-4">
                  Display &amp; Rig
                </h3>
                <div className="flex flex-col gap-2.5">
                  <button
                    type="button"
                    aria-pressed={showSkeleton}
                    onClick={handleToggleSkeleton}
                    className={`w-full text-left px-3.5 py-2.5 text-[0.78rem] rounded-[4px] border transition-colors duration-150 cursor-pointer ${
                      showSkeleton
                        ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white font-medium'
                        : 'border-[#1a1a1a]/[0.10] bg-white text-[#1a1a1a] hover:border-[#1a1a1a]/35'
                    }`}
                  >
                    Skeleton Helper
                  </button>
                  <button
                    type="button"
                    aria-pressed={wireframe}
                    onClick={handleToggleWireframe}
                    className={`w-full text-left px-3.5 py-2.5 text-[0.78rem] rounded-[4px] border transition-colors duration-150 cursor-pointer ${
                      wireframe
                        ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white font-medium'
                        : 'border-[#1a1a1a]/[0.10] bg-white text-[#1a1a1a] hover:border-[#1a1a1a]/35'
                    }`}
                  >
                    Wireframe
                  </button>
                  <button
                    type="button"
                    aria-pressed={autoRotate}
                    onClick={handleToggleAutoRotate}
                    className={`w-full text-left px-3.5 py-2.5 text-[0.78rem] rounded-[4px] border transition-colors duration-150 cursor-pointer ${
                      autoRotate
                        ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white font-medium'
                        : 'border-[#1a1a1a]/[0.10] bg-white text-[#1a1a1a] hover:border-[#1a1a1a]/35'
                    }`}
                  >
                    Turntable Rotate
                  </button>
                </div>

                <div className="mt-5 flex flex-col gap-2">
                  <span className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50">
                    Character Mesh LOD
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['LOD0', 'LOD1', 'LOD2'] as const).map((level) => {
                      const active = lodLevel === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          aria-pressed={active}
                          data-testid={`lod-btn-${level}`}
                          onClick={() => handleLodChange(level)}
                          className={`py-1.5 text-[0.72rem] font-mono-tabular rounded-[4px] border transition-colors cursor-pointer ${
                            active
                              ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white font-semibold'
                              : 'border-[#1a1a1a]/[0.12] bg-white text-[#1a1a1a] hover:border-[#1a1a1a]/40'
                          }`}
                        >
                          {level}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="mt-5 flex flex-col gap-2 text-[0.78rem]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#1a1a1a]">Playback Speed</span>
                    <span className="font-mono-tabular text-[0.72rem] text-[#1a1a1a]/60">
                      {playbackSpeed.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={2.0}
                    step={0.05}
                    value={playbackSpeed}
                    onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                    className="studio-slider w-full"
                  />
                </label>
              </section>

              {renderLightingControls()}
            </>
          )}
          </section>

          {/* Sticky Bottom Export Actions (Character + Modular UE5 Gun .GLB) */}
          <div className="export-footer flex flex-col gap-2 px-5 xl:px-6 py-3.5 border-t border-[#1a1a1a]/[0.08] bg-[#f8f7f4]">
            <button
              type="button"
              data-testid="export-weapon-glb-btn"
              onClick={handleExportWeaponGLB}
              disabled={isExportingWeapon || !activeWeaponSpec}
              className="w-full bg-[#1a1a1a] hover:bg-[#2d2d2d] active:scale-[0.99] disabled:opacity-45 text-white font-semibold text-[0.75rem] py-2 px-3 rounded-lg transition-all duration-150 cursor-pointer whitespace-nowrap truncate flex items-center justify-center gap-2"
            >
              <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {isExportingWeapon
                  ? 'Exporting Gun .GLB...'
                  : activeWeaponSpec
                    ? `Download ${activeWeaponSpec.shortName} .GLB`
                    : 'Equip Gun to Export .GLB'}
              </span>
            </button>
            <button
              type="button"
              data-testid="export-character-glb-btn"
              onClick={handleExportGLB}
              disabled={isExporting}
              className="w-full bg-[#ff4d00] hover:bg-[#e54500] active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-[0.76rem] py-2 px-3 rounded-lg transition-all duration-150 cursor-pointer whitespace-nowrap truncate"
            >
              {isExporting ? 'Exporting Character...' : 'Download Character .GLB'}
            </button>
          </div>
        </aside>
      )}

      {/* Bottom-Center Editorial Metadata Footer */}
      {!uiHidden && (
        <footer className="studio-shell-footer px-4 md:px-6 xl:px-8 py-3.5 flex items-center gap-4 md:gap-7 font-mono-tabular text-[0.62rem] uppercase tracking-[0.06em] text-[#1a1a1a]/50 border-t border-[#1a1a1a]/[0.08] bg-[#f8f7f4]">
          <span className="whitespace-nowrap">
            Height: {stats ? `${stats.heightMeters.toFixed(2)}m` : '1.87m'}
          </span>
          <span className="hidden sm:inline whitespace-nowrap">Mesh: PBR_ORM_6</span>
          <span className="hidden md:inline whitespace-nowrap">Rig: UE5_IK_63</span>
          <button
            type="button"
            onClick={() => setUiHidden(true)}
            className="ml-auto hover:text-[#1a1a1a] transition-colors cursor-pointer whitespace-nowrap"
          >
            Press &apos;H&apos; to hide UI
          </button>
        </footer>
      )}
      {/* Startup & Reopenable Quick-Start Controls Guide */}
      <WelcomeGuideModal
        open={guideOpen}
        dontShowNextTime={dontShowNextTime}
        onDontShowChange={handleDontShowGuideChange}
        onClose={handleCloseGuide}
      />
    </div>
  );
}
