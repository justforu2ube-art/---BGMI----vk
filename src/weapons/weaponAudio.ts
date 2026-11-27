import { WeaponId } from './weaponTypes';

/**
 * 100% Procedural Web Audio API Tactical Gunfire & Mechanical Foley Synthesizer.
 * Generates distinct ballistic signatures for all 5 weapons plus pump rack,
 * bolt cycle, magazine clicks, dry fire, and brass casing floor pings.
 */
class WeaponAudioSynthesizer {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (!this.noiseBuffer) {
      const length = Math.floor(this.ctx.sampleRate * 0.8);
      const buf = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buf;
    }
    return this.ctx;
  }

  private playFilteredNoise(
    ctx: AudioContext,
    startTime: number,
    duration: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    q: number,
    gainPeak: number
  ): void {
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freqStart, startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), startTime + duration);
    filter.Q.setValueAtTime(q, startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0005, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    src.start(startTime);
    src.stop(startTime + duration + 0.02);
  }

  private playPunchOsc(
    ctx: AudioContext,
    startTime: number,
    duration: number,
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    gainPeak: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + duration);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0005, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.015);
  }

  public playGunshot(weaponId: WeaponId): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    switch (weaponId) {
      case 'mk18':
        // Sharp 5.56mm high-pressure crack + crisp carbine buffer thump + metallic bolt cycle
        this.playPunchOsc(ctx, now, 0.085, 'triangle', 190, 48, 0.36);
        this.playFilteredNoise(ctx, now, 0.19, 'bandpass', 2200, 560, 0.85, 0.52);
        this.playFilteredNoise(ctx, now, 0.055, 'highpass', 3200, 1800, 0.6, 0.26);
        this.playPunchOsc(ctx, now + 0.042, 0.028, 'square', 2800, 1100, 0.065);
        break;

      case 'ak74m':
        // Deep metallic 7.62x39mm bark + stamped steel receiver clack
        this.playPunchOsc(ctx, now, 0.125, 'sawtooth', 142, 34, 0.42);
        this.playFilteredNoise(ctx, now, 0.25, 'bandpass', 1250, 310, 0.75, 0.62);
        this.playFilteredNoise(ctx, now, 0.09, 'lowpass', 720, 180, 0.9, 0.35);
        this.playPunchOsc(ctx, now + 0.052, 0.036, 'square', 1950, 740, 0.095);
        break;

      case 'm870':
        // Booming 12-gauge buckshot chest blast + lingering room tail
        this.playPunchOsc(ctx, now, 0.21, 'triangle', 118, 26, 0.65);
        this.playFilteredNoise(ctx, now, 0.38, 'lowpass', 1650, 210, 0.65, 0.78);
        this.playFilteredNoise(ctx, now, 0.12, 'bandpass', 1100, 420, 0.5, 0.48);
        break;

      case 'awm':
        // Thunderous echoing .338 Lapua Magnum cannon + tank muzzle-brake concussion
        this.playPunchOsc(ctx, now, 0.28, 'sawtooth', 135, 22, 0.68);
        this.playFilteredNoise(ctx, now, 0.58, 'bandpass', 1800, 190, 0.55, 0.82);
        this.playFilteredNoise(ctx, now + 0.04, 0.52, 'lowpass', 950, 140, 0.7, 0.42);
        this.playFilteredNoise(ctx, now, 0.075, 'highpass', 3600, 1400, 0.7, 0.34);
        break;

      case 'glock19':
        // Crisp snappy 9mm pop + quick slide snap
        this.playPunchOsc(ctx, now, 0.068, 'triangle', 240, 68, 0.3);
        this.playFilteredNoise(ctx, now, 0.14, 'bandpass', 2500, 780, 1.0, 0.42);
        this.playPunchOsc(ctx, now + 0.03, 0.024, 'square', 3400, 1450, 0.06);
        break;
    }
  }

  public playPumpRack(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Iconic metallic "chk-chk"
    this.playFilteredNoise(ctx, now, 0.08, 'bandpass', 2400, 1200, 2.2, 0.22);
    this.playPunchOsc(ctx, now + 0.01, 0.04, 'square', 920, 480, 0.07);
    this.playFilteredNoise(ctx, now + 0.14, 0.09, 'bandpass', 2900, 1500, 2.0, 0.25);
    this.playPunchOsc(ctx, now + 0.15, 0.045, 'square', 1180, 620, 0.08);
  }

  public playSniperBoltCycle(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Lift click -> slide pull -> push forward -> lock clunk
    this.playPunchOsc(ctx, now, 0.032, 'square', 2600, 1400, 0.07);
    this.playFilteredNoise(ctx, now + 0.07, 0.11, 'bandpass', 3100, 1900, 3.0, 0.16);
    this.playFilteredNoise(ctx, now + 0.24, 0.11, 'bandpass', 2700, 1600, 2.8, 0.18);
    this.playPunchOsc(ctx, now + 0.36, 0.042, 'triangle', 760, 240, 0.14);
  }

  public playDryFire(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playPunchOsc(ctx, now, 0.022, 'square', 3100, 1200, 0.08);
  }

  public playMagOut(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playPunchOsc(ctx, now, 0.038, 'triangle', 840, 310, 0.11);
    this.playFilteredNoise(ctx, now + 0.015, 0.085, 'bandpass', 1800, 900, 2.4, 0.14);
  }

  public playMagIn(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playFilteredNoise(ctx, now, 0.055, 'bandpass', 1500, 750, 2.0, 0.16);
    this.playPunchOsc(ctx, now + 0.03, 0.048, 'triangle', 520, 160, 0.18);
    this.playPunchOsc(ctx, now + 0.042, 0.025, 'square', 2200, 1100, 0.075);
  }

  public playBoltRack(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playFilteredNoise(ctx, now, 0.075, 'bandpass', 2900, 1400, 2.6, 0.18);
    this.playPunchOsc(ctx, now + 0.075, 0.04, 'square', 1750, 620, 0.11);
  }

  public playShellPingClip(
    clipId: ShellPingClipId,
    casingType: ShellCasingType = 'brass_556',
    impactForce = 2.0
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const forceNorm = Math.max(0.14, Math.min(1.25, impactForce / 3.2));
    const jitter = 0.93 + Math.random() * 0.14;

    if (clipId === 'hull_thud' || clipId === 'hull_skitter') {
      const isHeavy = clipId === 'hull_thud';
      const thumpGain = (isHeavy ? 0.056 : 0.024) * forceNorm;
      const rimGain = (isHeavy ? 0.018 : 0.009) * forceNorm;
      this.playPunchOsc(
        ctx,
        now,
        isHeavy ? 0.038 : 0.022,
        'triangle',
        (isHeavy ? 640 : 760) * jitter,
        (isHeavy ? 270 : 380) * jitter,
        thumpGain
      );
      this.playPunchOsc(
        ctx,
        now + 0.003,
        isHeavy ? 0.028 : 0.018,
        'sine',
        3900 * jitter,
        3720 * jitter,
        rimGain
      );
      return;
    }

    // Caliber-tuned brass cylinder resonant base frequencies
    let f1 = 4450;
    let f2Ratio = 1.48;
    let f3Ratio = 2.12;
    let baseDecay = 0.068;
    let basePeak = 0.042;

    if (casingType === 'brass_762') {
      f1 = 3350;
      f2Ratio = 1.44;
      f3Ratio = 2.06;
      baseDecay = 0.084;
      basePeak = 0.046;
    } else if (casingType === 'brass_338') {
      f1 = 2280;
      f2Ratio = 1.52;
      f3Ratio = 2.24;
      baseDecay = 0.122;
      basePeak = 0.058;
    } else if (casingType === 'brass_9mm') {
      f1 = 5550;
      f2Ratio = 1.42;
      f3Ratio = 1.94;
      baseDecay = 0.052;
      basePeak = 0.038;
    }

    if (clipId === 'heavy_clatter') {
      // High-force first strike: full 3-mode brass ring + sharp studio floor strike transient
      const base = f1 * jitter;
      this.playPunchOsc(ctx, now, baseDecay, 'sine', base, base * 0.972, basePeak * forceNorm);
      this.playPunchOsc(
        ctx,
        now + 0.004,
        baseDecay * 0.8,
        'sine',
        base * f2Ratio,
        base * f2Ratio * 0.968,
        basePeak * 0.65 * forceNorm
      );
      this.playPunchOsc(
        ctx,
        now + 0.008,
        baseDecay * 0.56,
        'triangle',
        base * f3Ratio,
        base * f3Ratio * 0.96,
        basePeak * 0.34 * forceNorm
      );
      this.playFilteredNoise(ctx, now, 0.016, 'bandpass', base * 0.85, base * 0.58, 3.0, 0.032 * forceNorm);
    } else if (clipId === 'medium_ping') {
      // Secondary bounce: cleaner harmonic brass ping with tighter ring
      const base = f1 * 1.04 * jitter;
      const decay = baseDecay * 0.72;
      this.playPunchOsc(ctx, now, decay, 'sine', base, base * 0.98, basePeak * 0.78 * forceNorm);
      this.playPunchOsc(
        ctx,
        now + 0.004,
        decay * 0.7,
        'sine',
        base * f2Ratio,
        base * f2Ratio * 0.975,
        basePeak * 0.48 * forceNorm
      );
      this.playFilteredNoise(ctx, now, 0.01, 'bandpass', base * 0.95, base * 0.72, 3.6, 0.018 * forceNorm);
    } else {
      // 'micro_tink': delicate high-register rim/neck settling micro-bounce chatter
      const base = f1 * 1.12 * jitter;
      const decay = Math.max(0.022, baseDecay * 0.42);
      const gain = Math.max(0.007, basePeak * 0.52 * forceNorm);
      this.playPunchOsc(ctx, now, decay, 'sine', base, base * 0.99, gain);
      this.playPunchOsc(ctx, now + 0.003, decay * 0.65, 'sine', base * f2Ratio, base * f2Ratio * 0.985, gain * 0.55);
    }
  }

  public playShellBounce(
    casingType: ShellCasingType | boolean = 'brass_556',
    impactForce = 2.4,
    bounceIndex = 0
  ): void {
    const resolvedType: ShellCasingType =
      typeof casingType === 'boolean' ? (casingType ? 'hull_12g' : 'brass_556') : casingType;
    const attenuatedForce = impactForce * Math.pow(0.72, bounceIndex);
    const clip = selectShellPingClip(resolvedType, attenuatedForce);
    this.playShellPingClip(clip, resolvedType, attenuatedForce);
  }
}

export type ShellCasingType = 'brass_556' | 'brass_762' | 'hull_12g' | 'brass_338' | 'brass_9mm';
export type ShellPingClipId =
  | 'heavy_clatter'
  | 'medium_ping'
  | 'micro_tink'
  | 'hull_thud'
  | 'hull_skitter';

/**
 * Pure impact-force mapper that picks the exact metallic ping audio clip
 * based on vertical ground collision speed (m/s) and casing material/caliber.
 */
export function selectShellPingClip(
  casingType: ShellCasingType,
  impactForce: number
): ShellPingClipId {
  if (casingType === 'hull_12g') {
    return impactForce >= 1.0 ? 'hull_thud' : 'hull_skitter';
  }
  if (impactForce >= 2.2) return 'heavy_clatter';
  if (impactForce >= 0.85) return 'medium_ping';
  return 'micro_tink';
}

export const weaponAudio = new WeaponAudioSynthesizer();
