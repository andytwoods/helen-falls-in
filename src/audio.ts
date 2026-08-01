// Procedural audio: generative ambient music + synthesized SFX, all WebAudio —
// no assets. The music is deliberately gentle: sparse pentatonic notes with slow
// envelopes over a soft drone, washed through a feedback delay. iOS rule: the
// AudioContext must be created/resumed inside a user gesture — call
// ensureStarted() from the first pointerdown.

const MASTER_VOL = 0.35;
const STORAGE_KEY = 'hfi-muted';

// A-major pentatonic across two-and-a-bit octaves — no wrong notes, pastoral
const SCALE = [220.0, 246.94, 277.18, 329.63, 369.99, 440.0, 493.88, 554.37, 659.25, 739.99, 880.0];

// The music is phrase-based, not random notes: a slow 4-chord cycle, and each
// phrase a lilting rhythm (quarter/dotted/half) whose melody random-walks in
// small steps and resolves onto a tone of the current chord.
const EIGHTH = 60 / 64 / 2; // 64 BPM
const PHRASE_EIGHTHS = 16; // two bars per phrase / per chord
const CHORDS = [
  { tones: [0, 2, 3, 5, 7, 8, 10], pad: [164.81, 220.0, 277.18], bass: 110.0 }, // A
  { tones: [0, 4, 5, 9, 10], pad: [146.83, 185.0, 220.0], bass: 73.42 }, // D
  { tones: [0, 2, 4, 5, 7, 9, 10], pad: [138.59, 185.0, 220.0], bass: 92.5 }, // F#m
  { tones: [1, 3, 6, 8], pad: [123.47, 164.81, 246.94], bass: 82.41 }, // E
];

class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private schedulerId: number | null = null;
  private nextPhraseAt = 0;
  private chordStep = 0;
  private lastDegree = 5;
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

    this.nextPhraseAt = ctx.currentTime + 0.3;
    this.schedulerId = window.setInterval(() => this.schedule(), 250);

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

  // ---- generative music: phrase-based, chord-aware ----

  private schedule(): void {
    const ctx = this.ctx!;
    while (this.nextPhraseAt < ctx.currentTime + 1.2) {
      this.schedulePhrase(this.nextPhraseAt);
      this.nextPhraseAt += PHRASE_EIGHTHS * EIGHTH;
    }
  }

  private schedulePhrase(at: number): void {
    const chord = CHORDS[this.chordStep % CHORDS.length]!;
    this.chordStep++;

    // harmony: a soft pad chord and a quiet bass root under the whole phrase
    const phraseDur = PHRASE_EIGHTHS * EIGHTH;
    for (const f of chord.pad) this.padTone(f, at, phraseDur + 1.2, 0.026);
    this.padTone(chord.bass, at, phraseDur + 0.8, 0.05);

    // every 4th phrase the melody rests — the tune needs room to breathe
    if (this.chordStep % 4 === 0 && Math.random() < 0.6) return;

    // rhythm: a lilt built from quarters, dotted-quarters and halves
    const onsets: number[] = [];
    let pos = Math.random() < 0.3 ? 2 : 0;
    while (pos < PHRASE_EIGHTHS - 2) {
      onsets.push(pos);
      pos += [2, 2, 3, 3, 4][Math.floor(Math.random() * 5)]!;
    }

    // melody: small-step random walk, resolving onto a chord tone at both ends
    const snap = (deg: number) =>
      chord.tones.reduce((best, tone) => (Math.abs(tone - deg) < Math.abs(best - deg) ? tone : best), chord.tones[0]!);
    let degree = snap(this.lastDegree);
    onsets.forEach((onset, i) => {
      const last = i === onsets.length - 1;
      if (i > 0) {
        degree += [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]!;
        degree = Math.max(1, Math.min(SCALE.length - 2, degree));
        // strong beats and phrase-ends lean home to the chord
        if (last || (onset % 4 === 0 && Math.random() < 0.6)) degree = snap(degree);
      }
      const detune = 1 + (Math.random() - 0.5) * 0.004;
      const vol = (onset % 4 === 0 ? 0.09 : 0.065) * (last ? 1.15 : 1);
      this.pluck(SCALE[degree]! * detune, at + onset * EIGHTH, vol);
    });
    this.lastDegree = degree;
  }

  private padTone(freq: number, at: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(vol, at + 1.8); // very slow bloom
    g.gain.setValueAtTime(vol, at + dur - 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(at);
    osc.stop(at + dur + 0.1);
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

  // the magic bolt: a bright little pew
  zap(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const at = this.ctx.currentTime;
    this.tone(at, 880, 220, 0.16, 0.14, 'square');
    this.tone(at, 1320, 660, 0.1, 0.09, 'triangle');
  }
}

export const audio = new GameAudio();
