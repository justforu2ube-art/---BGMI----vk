import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import {
  CAMERA_PRESETS,
  CameraPresetKey,
  CharacterStudioEngine,
  LIGHTING_PRESETS,
  LightingPresetKey,
  StudioMode,
} from './studio/studioScene';
import { ANIMATION_NAMES, AnimationName } from './character/animations';
import { FACIAL_MORPH_NAMES, FacialMorphName } from './character/headSculpt';
import { BuiltCharacter } from './character/characterBuilder';
import { tacticalAudio } from './studio/audio';

type StudioSection = 'inspect' | 'combat' | 'animations' | 'camera' | 'morphs' | 'display';

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
  { id: 'combat', label: 'Combat Controller' },
  { id: 'animations', label: 'Animations (11)' },
  { id: 'camera', label: 'Camera Presets' },
  { id: 'morphs', label: 'Facial Morphs' },
  { id: 'display', label: 'Display & Rig' },
];

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<CharacterStudioEngine | null>(null);

  const [mode, setMode] = useState<StudioMode>('inspect');
  const [activeSection, setActiveSection] = useState<StudioSection>('inspect');
  const [uiHidden, setUiHidden] = useState(false);
  const [activeAnim, setActiveAnim] = useState<AnimationName>('Idle_Natural');
  const [activeCam, setActiveCam] = useState<CameraPresetKey>('full_body');
  const [activeLighting, setActiveLighting] = useState<LightingPresetKey>('studio_soft');
  const [stats, setStats] = useState<BuiltCharacter['stats'] | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isAiming, setIsAiming] = useState(false);

  // Display options
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
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
    });
    engineRef.current = engine;

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    tacticalAudio.muted = next;
  };

  const activeLightingObj = LIGHTING_PRESETS.find((p) => p.id === activeLighting);

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
      className="w-screen h-screen overflow-hidden bg-[#f8f7f4] text-[#1a1a1a] grid grid-cols-1 lg:grid-cols-[290px_1fr_300px] xl:grid-cols-[310px_1fr_320px] grid-rows-[auto_1fr_auto]"
      data-mode={mode}
      data-anim={activeAnim}
      data-lighting={activeLighting}
    >
      {/* Left Navigation Sidebar */}
      {!uiHidden && (
        <aside className="hidden lg:flex row-start-1 row-end-4 col-start-1 col-end-2 bg-white border-r border-[#1a1a1a]/[0.08] px-8 py-10 flex-col justify-between">
          <div>
            <h1 className="font-editorial italic font-semibold text-[1.9rem] leading-none tracking-[-0.01em] text-[#1a1a1a] mb-14">
              Vanguard.
            </h1>

            <nav aria-label="Studio Navigation" className="flex flex-col gap-6">
              {NAV_ITEMS.map((item) => {
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => handleSectionSelect(item.id)}
                    className={`group flex items-center gap-4 text-left uppercase font-mono-tabular text-[0.75rem] tracking-[0.1em] transition-opacity duration-150 cursor-pointer whitespace-nowrap ${
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
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="font-mono-tabular text-[0.68rem] leading-[1.6] tracking-[0.04em] text-[#1a1a1a]/45 uppercase">
            <div>VERSION 1.87 STUDIO</div>
            <div>VANGUARD SYSTEMS</div>
          </div>
        </aside>
      )}

      {/* Top Architectural Header */}
      {!uiHidden && (
        <header className="col-start-1 lg:col-start-2 col-end-2 lg:col-end-4 row-start-1 row-end-2 px-6 lg:px-10 py-5 lg:py-7 flex items-center justify-between gap-6 border-b border-[#1a1a1a]/[0.08] bg-[#f8f7f4]">
          <div className="flex items-center gap-4 min-w-0">
            <span className="lg:hidden font-editorial italic font-semibold text-2xl leading-none text-[#1a1a1a] shrink-0">
              Vanguard.
            </span>
            <span className="font-mono-tabular text-[0.65rem] tracking-[0.08em] bg-[#1a1a1a] text-white px-3 py-1 rounded-full whitespace-nowrap shrink-0">
              {mode === 'combat' ? 'COMBAT_CONTROLLER_ACTIVE' : 'LIVE_VIEWPORT_ENABLED'}
            </span>
          </div>

          <div className="flex items-center gap-5 shrink-0">
            <span className="hidden sm:inline font-mono-tabular text-[0.75rem] tracking-[0.05em] text-[#1a1a1a] whitespace-nowrap">
              OPERATOR_ALPHA_GEN3
            </span>
            <button
              type="button"
              onClick={handleExportGLB}
              disabled={isExporting}
              className="lg:hidden bg-[#ff4d00] hover:bg-[#e54500] disabled:opacity-60 text-white text-xs font-semibold px-3.5 py-2 rounded-md cursor-pointer whitespace-nowrap"
            >
              {isExporting ? 'Exporting...' : 'Export .GLB'}
            </button>
          </div>
        </header>
      )}

      {/* Center Framed 3D Viewport (Preserves WebGL mount cleanly across full-screen H toggle) */}
      <main
        className={
          uiHidden
            ? 'fixed inset-0 z-30 studio-viewport-grid overflow-hidden'
            : 'col-start-1 lg:col-start-2 col-end-2 lg:col-end-3 row-start-2 row-end-3 relative m-3 lg:m-6 rounded-2xl border border-[#1a1a1a]/[0.08] overflow-hidden studio-viewport-grid min-h-0'
        }
      >
        {/* Dedicated Isolated WebGL Mount */}
        <div
          ref={mountRef}
          data-testid="studio-viewport"
          className="w-full h-full"
        />

        {/* Subtle Combat Aim Reticle (Visible only when holding RMB in Combat Mode) */}
        {mode === 'combat' && isAiming && (
          <div
            aria-hidden="true"
            className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center"
          >
            <div className="relative w-7 h-7">
              <span className="absolute left-1/2 top-0 -translate-x-1/2 w-[1.5px] h-2 bg-white/90" />
              <span className="absolute left-1/2 bottom-0 -translate-x-1/2 w-[1.5px] h-2 bg-white/90" />
              <span className="absolute top-1/2 left-0 -translate-y-1/2 h-[1.5px] w-2 bg-white/90" />
              <span className="absolute top-1/2 right-0 -translate-y-1/2 h-[1.5px] w-2 bg-white/90" />
            </div>
          </div>
        )}

        {/* Editorial Viewport Bottom Overlay (Pointer-events-none for unobstructed orbit & combat) */}
        {!uiHidden && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-7 pb-6 pt-14 bg-gradient-to-t from-black/50 via-black/15 to-transparent flex items-baseline justify-between gap-4">
            <div className="font-editorial italic font-semibold text-[2.4rem] lg:text-[2.85rem] leading-none text-white drop-shadow-[0_1px_10px_rgba(0,0,0,0.35)]">
              {mode === 'combat' ? 'Combat Mode.' : 'Studio Mode.'}
            </div>
            <div className="font-mono-tabular text-[0.7rem] tracking-[0.08em] text-white/90 uppercase whitespace-nowrap">
              {LIGHTING_FILE_CODES[activeLighting]}
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

      {/* Right Inspector Panel */}
      {!uiHidden && (
        <section
          aria-label="Character Studio Inspector"
          className="hidden lg:flex col-start-3 col-end-4 row-start-2 row-end-3 px-8 py-9 border-l border-[#1a1a1a]/[0.08] bg-[#f8f7f4] flex-col gap-9 overflow-y-auto min-h-0"
        >
          {/* Section: Turntable Inspect (Default Variation 6 Composition) */}
          {activeSection === 'inspect' && (
            <>
              {renderLightingControls()}

              <section className="flex flex-col">
                <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-4">
                  System Status
                </h3>
                <p className="text-[0.78rem] leading-[1.65] text-[#1a1a1a]/85">
                  Rendering{' '}
                  <span className="font-mono-tabular font-medium text-[#1a1a1a]">
                    {stats ? stats.triangleCount.toLocaleString() : '266,636'}
                  </span>{' '}
                  triangles via PBR pipeline. Skeletal structure verified (
                  <span className="font-mono-tabular font-medium text-[#1a1a1a]">
                    {stats ? stats.boneCount : 56} bones
                  </span>
                  ).
                </p>
                {activeLightingObj && (
                  <p className="mt-3 text-[0.72rem] leading-[1.55] text-[#1a1a1a]/55">
                    {activeLightingObj.description}
                  </p>
                )}
              </section>

              <section className="flex flex-col pt-5 border-t border-[#1a1a1a]/[0.08]">
                <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-3">
                  Active Clip
                </h3>
                <div className="flex items-center justify-between text-[0.78rem]">
                  <span className="font-medium text-[#1a1a1a]">{ANIM_LABELS[activeAnim]}</span>
                  <button
                    type="button"
                    onClick={() => handleSectionSelect('animations')}
                    className="font-mono-tabular text-[0.68rem] uppercase tracking-[0.06em] text-[#ff4d00] hover:underline underline-offset-4 cursor-pointer"
                  >
                    Change
                  </button>
                </div>
              </section>
            </>
          )}

          {/* Section: Combat Controller */}
          {activeSection === 'combat' && (
            <>
              <section className="flex flex-col">
                <h3 className="font-mono-tabular text-[0.65rem] uppercase tracking-[0.12em] text-[#1a1a1a]/50 mb-4">
                  Combat Controls
                </h3>
                <div className="flex flex-col gap-2.5 text-[0.78rem]">
                  {(
                    [
                      ['W A S D', 'Move'],
                      ['Shift', 'Sprint'],
                      ['C', 'Crouch'],
                      ['Space', 'Jump'],
                      ['Hold RMB', 'Aim & Look'],
                      ['LMB', 'Fire Recoil'],
                    ] as const
                  ).map(([key, action]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between py-2 px-3 bg-white border border-[#1a1a1a]/[0.08] rounded-[4px]"
                    >
                      <span className="font-mono-tabular text-[0.72rem] font-medium text-[#1a1a1a]">
                        {key}
                      </span>
                      <span className="text-[#1a1a1a]/65">{action}</span>
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

                <label className="mt-6 flex flex-col gap-2 text-[0.78rem]">
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
      )}

      {/* Bottom-Right Primary Export Action */}
      {!uiHidden && (
        <div className="hidden lg:block col-start-3 col-end-4 row-start-3 row-end-4 px-8 py-6 border-t border-l border-[#1a1a1a]/[0.08] bg-[#f8f7f4]">
          <button
            type="button"
            onClick={handleExportGLB}
            disabled={isExporting}
            className="w-full bg-[#ff4d00] hover:bg-[#e54500] active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-[0.85rem] py-3.5 px-4 rounded-lg transition-all duration-150 cursor-pointer whitespace-nowrap"
          >
            {isExporting ? 'Exporting .GLB...' : 'Export .GLB Asset'}
          </button>
        </div>
      )}

      {/* Bottom-Center Editorial Metadata Footer (Plus Compact Mobile Strip) */}
      {!uiHidden && (
        <footer className="col-start-1 lg:col-start-2 col-end-2 lg:col-end-3 row-start-3 row-end-4 px-6 lg:px-10 py-4 flex items-center gap-6 lg:gap-9 font-mono-tabular text-[0.62rem] uppercase tracking-[0.06em] text-[#1a1a1a]/50 border-t border-[#1a1a1a]/[0.08] bg-[#f8f7f4]">
          <span className="whitespace-nowrap">
            Height: {stats ? `${stats.heightMeters.toFixed(2)}m` : '1.87m'}
          </span>
          <span className="hidden sm:inline whitespace-nowrap">Mesh: PBR_Tactical</span>
          <span className="hidden md:inline whitespace-nowrap">Rig: Finger_Humanoid</span>
          <button
            type="button"
            onClick={() => setUiHidden(true)}
            className="ml-auto hover:text-[#1a1a1a] transition-colors cursor-pointer whitespace-nowrap"
          >
            Press &apos;H&apos; to hide UI overlay
          </button>
        </footer>
      )}
    </div>
  );
}
