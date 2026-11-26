/**
 * Zero-dependency Web Audio API procedural tactical rifle gunshot & bolt click synthesizer.
 */
class TacticalAudioEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (!this.noiseBuffer) {
      const length = Math.floor(this.ctx.sampleRate * 0.35);
      const buf = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.055));
      }
      this.noiseBuffer = buf;
    }
    return this.ctx;
  }

  public playGunshot(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const now = ctx.currentTime;

    // 1. Punchy sub-bass chest thump (155Hz -> 42Hz rapid pitch drop)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.09);
    oscGain.gain.setValueAtTime(0.42, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);

    // 2. High-energy supersonic crack + muzzle blast noise burst
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1450, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 0.18);
    filter.Q.setValueAtTime(0.85, now);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.55, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.26);

    // 3. Crisp metallic bolt cycle click (+45ms)
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = 'square';
    clickOsc.frequency.setValueAtTime(2400, now + 0.045);
    clickOsc.frequency.exponentialRampToValueAtTime(880, now + 0.068);
    clickGain.gain.setValueAtTime(0.0001, now);
    clickGain.gain.setValueAtTime(0.08, now + 0.045);
    clickGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.075);
    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);
    clickOsc.start(now + 0.042);
    clickOsc.stop(now + 0.08);
  }
}

export const tacticalAudio = new TacticalAudioEngine();
