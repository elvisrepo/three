/**
 * Procedural game audio — zero dependencies, zero asset files.
 * SFX are synthesized (oscillator + filtered-noise envelopes); music is a
 * generative ambient loop whose scale/root follows the zone mood.
 * The AudioContext is created lazily on the first user gesture (autoplay policy).
 */

export type MusicMood = 'city' | 'meadow' | 'crypt' | 'ember' | 'wilds' | 'rift';

interface MoodDef {
  root: number;
  scale: number[];
  chord: number[];
  padEvery: number;
  pluckEvery: [number, number];
  pluckVol: number;
  cutoff: number;
  /** Pad voices per chord tone: 2 = detuned saw pair (wide), 1 = single (thin, for low muddy roots). */
  voices: 1 | 2;
}

const MOODS: Record<MusicMood, MoodDef> = {
  city: { root: 220, scale: [0, 2, 4, 7, 9], chord: [0, 4, 7], padEvery: 9, pluckEvery: [0.5, 1.1], pluckVol: 0.05, cutoff: 900, voices: 2 },
  meadow: { root: 196, scale: [0, 2, 4, 7, 9], chord: [0, 4, 7], padEvery: 8, pluckEvery: [0.4, 0.9], pluckVol: 0.06, cutoff: 1200, voices: 2 },
  crypt: { root: 110, scale: [0, 2, 3, 7, 8], chord: [0, 3, 7], padEvery: 11, pluckEvery: [0.8, 1.8], pluckVol: 0.045, cutoff: 650, voices: 1 },
  ember: { root: 98, scale: [0, 2, 3, 7, 10], chord: [0, 3, 7], padEvery: 9, pluckEvery: [0.5, 1.2], pluckVol: 0.05, cutoff: 700, voices: 2 },
  wilds: { root: 130, scale: [0, 2, 3, 7, 8], chord: [0, 3, 7], padEvery: 12, pluckEvery: [0.9, 2.0], pluckVol: 0.04, cutoff: 600, voices: 2 },
  rift: { root: 82, scale: [0, 1, 5, 6, 10], chord: [0, 1, 7], padEvery: 14, pluckEvery: [1.2, 2.6], pluckVol: 0.035, cutoff: 420, voices: 1 },
};

const SETTINGS_KEY = 'arpg.settings.v1';
const SEMI = 2 ** (1 / 12);

export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlay = new Map<string, number>();
  private mood: MusicMood = 'city';
  private padIn = 0;
  private pluckIn = 0;
  private pluckStep = 0;
  muted = false;
  volume = 0.6;

  constructor() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { muted?: boolean; volume?: number };
        this.muted = s.muted === true;
        if (typeof s.volume === 'number') this.volume = Math.max(0, Math.min(1, s.volume));
      }
    } catch {
      this.muted = false;
    }
  }

  /** Call from any user-gesture handler. Idempotent. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.4;
      this.musicBus.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.persistSettings();
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.persistSettings();
    if (this.ctx && this.master && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  private persistSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ muted: this.muted, volume: this.volume }));
    } catch {
      /* storage blocked — sound still works for the session */
    }
  }

  setMood(m: MusicMood): void {
    this.mood = m;
  }

  /** Per-frame pump for the generative music scheduler. Cheap no-op until unlocked. */
  update(dt: number): void {
    if (!this.ctx || this.ctx.state !== 'running' || this.muted) return;
    const def = MOODS[this.mood];
    this.padIn -= dt;
    if (this.padIn <= 0) {
      this.padIn = def.padEvery;
      this.pad(def);
    }
    this.pluckIn -= dt;
    if (this.pluckIn <= 0) {
      this.pluckIn = def.pluckEvery[0] + Math.random() * (def.pluckEvery[1] - def.pluckEvery[0]);
      if (Math.random() < 0.65) this.pluck(def);
    }
  }

  // ---------- primitives ----------

  private gate(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.lastPlay.get(key) ?? -1e9) < ms) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, q = 1, delay = 0): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    const buf = this.noiseBuf;
    if (!ctx || !bus || !buf || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const flt = ctx.createBiquadFilter();
    flt.type = filter;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(bus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ---------- music voices ----------

  private pad(def: MoodDef): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    // Single-voice moods compensate with slightly hotter gain (3 thin voices
    // replace 6 stacked saws — same presence, less low-end mud).
    const peak = def.voices === 1 ? 0.05 : 0.035;
    const dets = def.voices === 1 ? [0] : [-4, 4];
    for (const iv of def.chord) {
      const f = def.root * SEMI ** iv;
      for (const det of dets) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = det;
        const flt = ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.value = def.cutoff;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 1.8);
        g.gain.setValueAtTime(peak, t + def.padEvery - 2.5);
        g.gain.linearRampToValueAtTime(0, t + def.padEvery - 0.3);
        osc.connect(flt).connect(g).connect(this.musicBus);
        osc.start(t);
        osc.stop(t + def.padEvery);
      }
    }
  }

  private pluck(def: MoodDef): void {
    if (!this.ctx || !this.musicBus) return;
    this.pluckStep += Math.random() < 0.5 ? -1 : 1;
    if (Math.random() < 0.2) this.pluckStep += Math.random() < 0.5 ? -2 : 2;
    const scale = def.scale;
    const deg = ((this.pluckStep % scale.length) + scale.length) % scale.length;
    const oct = 12 * (1 + (Math.random() < 0.25 ? 1 : 0));
    const f = def.root * 2 * SEMI ** (scale[deg] + oct);
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.03;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = Math.min(2400, f);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(def.pluckVol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 1.5);
  }

  // ---------- SFX vocabulary ----------

  swing(): void {
    if (!this.gate('swing', 90)) return;
    this.noise(0.12, 0.22, 'bandpass', 1000, 280, 1.2);
  }

  hit(crit: boolean): void {
    if (!this.gate('hit', 70)) return;
    this.noise(0.08, crit ? 0.4 : 0.28, 'lowpass', 2500, 400);
    this.tone('sine', crit ? 220 : 170, 65, 0.13, crit ? 0.5 : 0.35);
    if (crit) this.tone('square', 880, 1320, 0.09, 0.12, 0.03);
  }

  /** Spitter trash bolt (soft hiss — gated, packs spit in volleys). */
  spit(): void {
    if (!this.gate('spit', 140)) return;
    this.noise(0.09, 0.16, 'bandpass', 900, 320, 1.4);
  }

  /** Frost Lance cast: glassy shimmer over a cold breath. */
  frost(): void {
    if (!this.gate('frost', 200)) return;
    this.tone('triangle', 1320, 2400, 0.3, 0.14);
    this.tone('sine', 660, 1180, 0.35, 0.12, 0.05);
    this.noise(0.3, 0.1, 'highpass', 3000, 6000);
  }

  /** Storm Lance discharge: sharp crack over a low thunder roll. */
  storm(): void {
    if (!this.gate('storm', 250)) return;
    this.noise(0.12, 0.4, 'highpass', 1800, 5200);
    this.tone('sawtooth', 160, 45, 0.7, 0.35, 0.03);
    this.noise(0.6, 0.22, 'lowpass', 300, 90, 1, 0.05);
  }

  /** Nova Beam discharge: rising charge whine into a held burn. */
  beam(): void {
    if (!this.gate('beam', 300)) return;
    this.tone('sawtooth', 220, 880, 0.7, 0.12);
    this.tone('sine', 110, 440, 0.9, 0.2, 0.05);
    this.noise(0.8, 0.08, 'bandpass', 1200, 2400, 2, 0.4);
  }

  fireball(): void {
    if (!this.gate('fire', 120)) return;
    this.tone('sawtooth', 280, 950, 0.25, 0.22);
    this.noise(0.22, 0.16, 'bandpass', 600, 2400, 1.5);
  }

  blink(): void {
    if (!this.gate('blink', 150)) return;
    this.tone('sine', 1250, 280, 0.16, 0.25);
    this.tone('sine', 1900, 700, 0.2, 0.1, 0.04);
  }

  potion(): void {
    if (!this.gate('potion', 300)) return;
    this.tone('sine', 420, 720, 0.1, 0.25);
    this.tone('sine', 620, 980, 0.12, 0.22, 0.09);
  }

  lootRarity(rarity: string): void {
    if (!this.gate('loot', 120)) return;
    const f = rarity === 'legendary' ? 660 : rarity === 'rare' ? 880 : rarity === 'magic' ? 740 : 620;
    this.tone('triangle', f, f * 1.5, 0.14, 0.22);
    if (rarity === 'legendary' || rarity === 'rare') this.tone('triangle', f * 1.5, f * 2, 0.16, 0.16, 0.08);
  }

  gold(): void {
    if (!this.gate('gold', 140)) return;
    this.tone('square', 1240, 1240, 0.05, 0.08);
  }

  levelup(): void {
    if (!this.gate('levelup', 500)) return;
    [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.22, i * 0.09));
  }

  portal(): void {
    if (!this.gate('portal', 600)) return;
    this.tone('sine', 300, 900, 0.8, 0.14);
    this.tone('sine', 450, 1350, 0.8, 0.1, 0.1);
  }

  scroll(): void {
    if (!this.gate('scroll', 400)) return;
    this.tone('sine', 500, 1200, 0.4, 0.18);
  }

  uiClick(): void {
    if (!this.gate('ui', 60)) return;
    this.tone('sine', 820, 820, 0.05, 0.1);
  }

  buy(): void {
    if (!this.gate('buy', 150)) return;
    this.tone('square', 900, 900, 0.07, 0.14);
    this.tone('square', 1350, 1350, 0.09, 0.12, 0.07);
  }

  sell(): void {
    if (!this.gate('sell', 150)) return;
    this.tone('square', 700, 700, 0.07, 0.12);
    this.tone('square', 500, 500, 0.09, 0.1, 0.07);
  }

  equip(): void {
    if (!this.gate('equip', 150)) return;
    this.tone('sine', 220, 120, 0.1, 0.25);
    this.noise(0.05, 0.15, 'highpass', 2000, 3000);
  }

  hurt(): void {
    if (!this.gate('hurt', 150)) return;
    this.tone('sine', 140, 60, 0.16, 0.35);
    this.noise(0.1, 0.2, 'lowpass', 1200, 300);
  }

  monsterDie(): void {
    if (!this.gate('mdie', 90)) return;
    this.tone('square', 320, 110, 0.12, 0.16);
    this.noise(0.1, 0.14, 'lowpass', 1800, 500);
  }

  roar(): void {
    if (!this.gate('roar', 800)) return;
    this.tone('sawtooth', 95, 45, 0.7, 0.4);
    this.noise(0.6, 0.25, 'lowpass', 500, 120, 0.8);
  }

  bossDie(): void {
    if (!this.gate('bdie', 800)) return;
    this.roar();
    [392, 494, 587].forEach((f, i) => this.tone('triangle', f, f, 0.4, 0.16, 0.3 + i * 0.1));
  }

  bossSlam(): void {
    if (!this.gate('slam', 400)) return;
    this.tone('sine', 65, 28, 0.5, 0.55);
    this.noise(0.4, 0.35, 'lowpass', 400, 80);
  }

  jobAdvance(): void {
    if (!this.gate('job', 500)) return;
    [392, 523, 659, 784].forEach((f, i) => this.tone('sawtooth', f, f, 0.3, 0.1, i * 0.1));
  }

  death(): void {
    if (!this.gate('death', 800)) return;
    [330, 262, 196, 131].forEach((f, i) => this.tone('triangle', f, f * 0.94, 0.35, 0.2, i * 0.14));
  }
}
