/**
 * Zero-MP3 Procedural Demolition WebAudio Synthesizer ($gamefeel-3d S-Tier compliant)
 * Synthesizes C4 plant/countdown beeps, multi-layered seismic blasts, rubble crunch cascades,
 * glass crystalline shatters, singularity black-hole sub-hum, rail-cannon crack & orbital laser sizzle.
 */
export class DemolitionAudio {
  private ctx: AudioContext | null = null;
  private lowpassBus: BiquadFilterNode | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private lastRubbleTime = 0;

  // Continuous orbital laser loop
  private laserGain: GainNode | null = null;
  private laserOsc: OscillatorNode | null = null;

  public unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();

      this.lowpassBus = this.ctx.createBiquadFilter();
      this.lowpassBus.type = 'lowpass';
      this.lowpassBus.frequency.value = 20000;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.68;

      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 16;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.16;

      this.lowpassBus.connect(this.masterGain);
      this.masterGain.connect(comp);
      comp.connect(this.ctx.destination);

      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      this.initLaserLoop();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  private initLaserLoop(): void {
    if (!this.ctx || !this.lowpassBus || !this.noiseBuf) return;
    this.laserGain = this.ctx.createGain();
    this.laserGain.gain.value = 0;

    this.laserOsc = this.ctx.createOscillator();
    this.laserOsc.type = 'sawtooth';
    this.laserOsc.frequency.value = 92;

    const nSrc = this.ctx.createBufferSource();
    nSrc.buffer = this.noiseBuf;
    nSrc.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1450;
    bp.Q.value = 2.4;

    this.laserOsc.connect(this.laserGain);
    nSrc.connect(bp).connect(this.laserGain);
    this.laserGain.connect(this.lowpassBus);
    this.laserOsc.start();
    nSrc.start();
  }

  public setLaserActive(on: boolean): void {
    if (!this.ctx || !this.laserGain || !this.laserOsc) return;
    const t = this.ctx.currentTime;
    this.laserGain.gain.setTargetAtTime(on ? 0.22 : 0, t, 0.03);
    if (on) {
      this.laserOsc.frequency.setTargetAtTime(88 + Math.sin(performance.now() * 0.02) * 18, t, 0.04);
    }
  }

  public setSlowMoMuffle(slowMo: boolean): void {
    if (!this.ctx || !this.lowpassBus) return;
    this.lowpassBus.frequency.setTargetAtTime(slowMo ? 720 : 20000, this.ctx.currentTime, 0.04);
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.68, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  private noise(dur: number, freq: number, q: number, type: BiquadFilterType, gain: number): void {
    if (!this.ctx || !this.noiseBuf || !this.lowpassBus) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.lowpassBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private sweep(f0: number, f1: number, dur: number, type: OscillatorType, gain: number, delay = 0): void {
    if (!this.ctx || !this.lowpassBus) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(18, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g).connect(this.lowpassBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  public playC4Plant(count = 1): void {
    this.unlock();
    const pitch = 880 * Math.pow(2, ((count % 8) * 1.1) / 12);
    this.sweep(pitch, pitch * 1.25, 0.075, 'sine', 0.25);
    this.sweep(240, 95, 0.05, 'triangle', 0.22);
  }

  public playDetonateBeep(): void {
    this.unlock();
    this.sweep(1320, 1320, 0.06, 'square', 0.2);
    this.sweep(1980, 1980, 0.08, 'square', 0.24, 0.07);
  }

  public playExplosion(scale = 1.0): void {
    this.unlock();
    const s = Math.min(1.6, Math.max(0.5, scale));
    this.noise(0.85 * s, 340, 0.65, 'lowpass', 1.25 * s);
    this.noise(0.32 * s, 1280, 0.9, 'bandpass', 0.72 * s);
    this.sweep(145, 22, 0.62 * s, 'sine', 1.05 * s);
    this.sweep(96, 19, 0.55 * s, 'sawtooth', 0.65 * s);
  }

  public playRailCannon(): void {
    this.unlock();
    this.noise(0.38, 1450, 0.8, 'bandpass', 1.1);
    this.noise(0.09, 3600, 1.0, 'highpass', 0.65);
    this.sweep(280, 28, 0.32, 'sawtooth', 0.95);
    this.sweep(1400, 220, 0.16, 'sine', 0.35);
  }

  public playBlackHoleSpawn(): void {
    this.unlock();
    this.sweep(420, 42, 0.85, 'sine', 0.55);
    this.sweep(110, 220, 1.6, 'triangle', 0.28, 0.2);
  }

  public playBlackHoleSupernova(): void {
    this.unlock();
    this.playExplosion(1.5);
    [220, 330, 495, 740].forEach((f, i) => {
      this.sweep(f, f * 0.45, 0.65, 'sawtooth', 0.22, i * 0.03);
    });
  }

  public playWreckingThrow(): void {
    this.unlock();
    this.noise(0.22, 650, 1.5, 'bandpass', 0.45);
    this.sweep(190, 68, 0.24, 'triangle', 0.45);
  }

  public playNukeWhistleAndSiren(): void {
    this.unlock();
    // Falling bomb whistle + air-raid warning horn
    this.sweep(1650, 290, 0.85, 'sine', 0.34);
    this.sweep(440, 680, 0.42, 'sawtooth', 0.18);
    this.sweep(680, 420, 0.42, 'sawtooth', 0.18, 0.42);
  }

  public playNukeDetonation(): void {
    this.unlock();
    this.noise(1.8, 220, 0.55, 'lowpass', 1.65);
    this.noise(0.95, 880, 0.75, 'bandpass', 1.05);
    this.sweep(120, 18, 1.35, 'sine', 1.45);
    this.sweep(78, 18, 1.2, 'sawtooth', 1.05);
  }

  public playAntiGravField(release = false): void {
    this.unlock();
    if (!release) {
      this.sweep(180, 760, 0.9, 'sine', 0.32);
      this.sweep(270, 1140, 0.9, 'triangle', 0.18);
    } else {
      this.sweep(820, 42, 0.36, 'sawtooth', 0.58);
    }
  }

  public playGlassShatter(): void {
    if (!this.ctx) return;
    this.noise(0.14, 4200, 1.8, 'highpass', 0.28);
    [2400, 3350, 4680].forEach((f, i) => {
      this.sweep(f, f * 0.78, 0.11, 'sine', 0.14, i * 0.018);
    });
  }

  /** Throttled structural rubble impact crunch so 300 falling blocks sound like thunder, not static */
  public playRubbleCrunch(intensity = 1): void {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastRubbleTime < 55) return;
    this.lastRubbleTime = now;
    const g = Math.min(0.55, 0.18 * intensity);
    this.noise(0.16, 480 + Math.random() * 320, 1.2, 'lowpass', g);
    this.sweep(115, 36, 0.14, 'triangle', g * 0.85);
  }
}
