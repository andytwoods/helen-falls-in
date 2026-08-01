// Procedural audio: generative ambient music + synthesized SFX, all WebAudio —
// no assets. The music is deliberately gentle: sparse pentatonic notes with slow
// envelopes over a soft drone, washed through a feedback delay. iOS rule: the
// AudioContext must be created/resumed inside a user gesture — call
// ensureStarted() from the first pointerdown.

const MASTER_VOL = 0.35;
const STORAGE_KEY = 'hfi-muted';

// A-major pentatonic across three octaves — no wrong notes, pastoral by default
const SCALE = [220.0, 246.94, 277.18, 329.63, 369.99, 440.0, 493.88, 554.37, 659.25, 739.99, 880.0];

class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private schedulerId: number | null = null;
  private nextNoteAt = 0;
  muted = localStorage.getItem(STORAGE_KEY) === '1';

  // Must be called synchronously from a user gesture (iOS starts suspended).
  ensureStarted(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOL;
    this.master.connect(ctx.destination);

    // music bus: lowpass warmth + feedback-delay space
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.5;
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 1800;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.55;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    this.musicBus.connect(warm);
    warm.connect(this.master);
    warm.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.startDrone();
    this.nextNoteAt = ctx.currentTime + 0.4;
    this.schedulerId = window.setInterval(() => this.schedule(), 200);

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    if (this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_VOL, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  // ---- generative music ----

  private startDrone(): void {
    const ctx = this.ctx!;
    // two barely-detuned sines an octave apart, breathing slowly
    for (const [freq, vol] of [
      [110, 0.05],
      [110.4, 0.035],
      [164.81, 0.03],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = vol;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.04;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = vol * 0.4;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      osc.connect(g);
      g.connect(this.musicBus);
      osc.start();
      lfo.start();
    }
  }

  private schedule(): void {
    const ctx = this.ctx!;
    while (this.nextNoteAt < ctx.currentTime + 0.7) {
      if (Math.random() < 0.75) this.playNote(this.nextNoteAt);
      // unhurried, irregular phrasing
      this.nextNoteAt += [0.8, 1.0, 1.2, 1.6, 2.0][Math.floor(Math.random() * 5)]!;
    }
  }

  private playNote(at: number): void {
    const ctx = this.ctx!;
    const idx = Math.floor(Math.random() * SCALE.length);
    const detune = 1 + (Math.random() - 0.5) * 0.004; // gentle humanisation
    this.pluck(SCALE[idx]! * detune, at, 0.08 + Math.random() * 0.05);
    // occasionally a consonant partner a third or fourth below, quieter
    if (Math.random() < 0.3 && idx >= 2) {
      this.pluck(SCALE[idx - 2]! * detune, at + 0.05, 0.05);
    }
    // rare high sparkle, very quiet
    if (Math.random() < 0.12) {
      this.pluck(SCALE[Math.min(SCALE.length - 1, idx + 5)]!, at + 0.4, 0.03);
    }
  }

  private pluck(freq: number, at: number, vol: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.25); // slow bloom, not a stab
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.2);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(at);
    osc.stop(at + 2.4);
  }

  // ---- SFX ----

  private noiseBurst(at: number, dur: number, filterType: BiquadFilterType, f0: number, f1: number, vol: number): void {
    const ctx = this.ctx!;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(f0, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxBus);
    src.start(at);
  }

  private tone(at: number, freq0: number, freq1: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq0, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  splash(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    this.noiseBurst(at, 0.6, 'lowpass', 1400, 250, 0.5); // the big daft sploosh
    this.tone(at, 260, 70, 0.35, 0.25); // water body
    this.noiseBurst(at + 0.35, 0.5, 'bandpass', 900, 500, 0.15); // droplets settling
    // the frog, unimpressed: two short croaks
    for (const dt of [0.75, 0.95]) {
      this.tone(at + dt, 95, 75, 0.12, 0.18, 'sawtooth');
    }
  }

  crunch(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      this.noiseBurst(at + i * 0.05, 0.12, 'highpass', 800 + i * 300, 600, 0.3 - i * 0.07);
    }
    this.tone(at, 140, 60, 0.2, 0.2);
  }

  squelch(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    this.noiseBurst(at, 0.3, 'lowpass', 700, 150, 0.35);
    this.tone(at + 0.03, 180, 50, 0.25, 0.25);
  }

  bell(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    // bicycle-bell ding-ding on a new personal best
    for (const dt of [0, 0.15]) {
      this.tone(at + dt, 1567, 1567, 0.4, 0.12);
      this.tone(at + dt, 2093, 2093, 0.3, 0.08);
    }
  }

  thud(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const at = this.ctx.currentTime;
    this.tone(at, 110, 55, 0.09, 0.16);
  }
}

export const audio = new GameAudio();
