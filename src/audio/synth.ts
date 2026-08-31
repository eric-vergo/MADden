// Procedural SFX voices — one factory per SfxName, no samples. Each factory
// builds a tiny oscillator/noise graph, schedules it on the AudioContext clock
// and lets it fall out of scope; nodes are GC'd once their stop() fires.
// Recipes follow docs/design/meta-design.md §11.
//
// This file is presentation-layer: it touches WebAudio but never Math.random
// (the shared noise buffers are built once by WebAudioEngine and passed in),
// so a voice is a pure function of its SynthVoice input.

import type { SfxName } from './AudioEngine';

export interface SynthVoice {
  ctx: AudioContext;
  /** Bus gain node the voice connects into (sfx / crowd / ui). */
  dest: AudioNode;
  /** Scheduling origin in AudioContext time; always >= ctx.currentTime. */
  t0: number;
  /** Shared 2s white-noise buffer. */
  white: AudioBuffer;
  /** Shared 2s brown-noise buffer (leaky-integrated white). */
  brown: AudioBuffer;
  /** 0..1 per-play volume scale. */
  gain: number;
  /** Frequency multiplier for pitch variation (1 = as authored). */
  pitch: number;
}

export type SfxFactory = (v: SynthVoice) => void;

// exponentialRamp* refuses zero, so envelopes float just above silence.
const EPS = 0.0001;

interface ToneOpts {
  type: OscillatorType;
  freq: number;
  /** Bend target; reached at t + dur (held flat until t + bendAt). */
  freqEnd?: number;
  bendAt?: number;
  /** Start offset from v.t0, seconds. */
  t?: number;
  dur: number;
  /** Linear peak gain before the voice's own gain scale. */
  peak: number;
  attack?: number;
  detuneCents?: number;
  /** Connect here instead of v.dest (e.g. a shared filter). */
  out?: AudioNode;
}

/** Schedules one enveloped oscillator; returns it so callers can modulate it. */
function tone(v: SynthVoice, o: ToneOpts): OscillatorNode {
  const start = v.t0 + (o.t ?? 0);
  const attack = Math.max(o.attack ?? 0.004, 0.001);
  const end = start + Math.max(o.dur, attack + 0.01);

  const osc = v.ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(Math.max(o.freq * v.pitch, 1), start);
  if (o.freqEnd !== undefined) {
    const bendFrom = start + Math.min(o.bendAt ?? 0, o.dur * 0.9);
    osc.frequency.setValueAtTime(Math.max(o.freq * v.pitch, 1), bendFrom);
    osc.frequency.exponentialRampToValueAtTime(Math.max(o.freqEnd * v.pitch, 1), start + o.dur);
  }
  if (o.detuneCents !== undefined) osc.detune.setValueAtTime(o.detuneCents, start);

  const g = v.ctx.createGain();
  g.gain.setValueAtTime(EPS, start);
  g.gain.exponentialRampToValueAtTime(Math.max(o.peak * v.gain, EPS), start + attack);
  g.gain.exponentialRampToValueAtTime(EPS, end);

  osc.connect(g);
  g.connect(o.out ?? v.dest);
  osc.start(start);
  osc.stop(end + 0.02);
  return osc;
}

interface NoiseOpts {
  t?: number;
  dur: number;
  peak: number;
  attack?: number;
  source?: 'white' | 'brown';
  filter?: {
    type: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
  };
  out?: AudioNode;
}

/** Schedules an enveloped slice of the shared noise buffer. */
function noise(v: SynthVoice, o: NoiseOpts): void {
  const start = v.t0 + (o.t ?? 0);
  const attack = Math.max(o.attack ?? 0.002, 0.001);
  const end = start + Math.max(o.dur, attack + 0.01);
  const buf = o.source === 'brown' ? v.brown : v.white;

  const src = v.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  // Vary the grain without randomness: the AudioContext clock is the dither.
  const offset = (v.t0 * 3.7) % buf.duration;

  const g = v.ctx.createGain();
  g.gain.setValueAtTime(EPS, start);
  g.gain.exponentialRampToValueAtTime(Math.max(o.peak * v.gain, EPS), start + attack);
  g.gain.exponentialRampToValueAtTime(EPS, end);

  let head: AudioNode = g;
  if (o.filter) {
    const f = v.ctx.createBiquadFilter();
    f.type = o.filter.type;
    f.frequency.setValueAtTime(Math.max(o.filter.freq, 20), start);
    if (o.filter.freqEnd !== undefined) {
      f.frequency.exponentialRampToValueAtTime(Math.max(o.filter.freqEnd, 20), end);
    }
    if (o.filter.q !== undefined) f.Q.setValueAtTime(o.filter.q, start);
    g.connect(f);
    head = f;
  }

  src.connect(g);
  head.connect(o.out ?? v.dest);
  src.start(start, offset);
  src.stop(end + 0.02);
}

/** Low-frequency modulator wired into an AudioParam (additive). */
function lfo(v: SynthVoice, target: AudioParam, hz: number, depth: number, dur: number): void {
  const start = v.t0;
  const o = v.ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(hz, start);
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(depth, start);
  o.connect(g);
  g.connect(target);
  o.start(start);
  o.stop(start + dur + 0.02);
}

function filterNode(
  v: SynthVoice,
  type: BiquadFilterType,
  freq: number,
  q?: number,
  freqEnd?: number,
  sweepDur = 0.5,
): BiquadFilterNode {
  const f = v.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(Math.max(freq, 20), v.t0);
  if (freqEnd !== undefined) {
    f.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), v.t0 + sweepDur);
  }
  if (q !== undefined) f.Q.setValueAtTime(q, v.t0);
  f.connect(v.dest);
  return f;
}

// --- Note table (equal temperament, A4 = 440) --------------------------------
const NOTE = {
  A3: 220.0, Bb3: 233.08, Eb4: 311.13,
  C4: 261.63, E4: 329.63, G4: 392.0, C5: 523.25,
  A5: 880.0, Cs6: 1108.73,
} as const;

// TODO(balance): per-recipe levels; kept local so data/balance.ts stays untouched.
const LEVEL = {
  whistle: 0.30,
  hitLight: 0.85,
  hitBig: 1.1,
  catch: 0.35,
  throw: 0.22,
  kick: 0.9,
  menu: 0.25,
  chime: 0.30,
  fanfare: 0.26,
  sting: 0.30,
  horn: 0.30,
  tick: 0.18,
  crowdSpike: 0.55,
} as const;

// --- Shared building blocks --------------------------------------------------

/** whistle body: two beating squares through a tight bandpass, 30Hz warble. */
function whistleBody(v: SynthVoice, dur: number, level: number): void {
  const bp = filterNode(v, 'bandpass', 2000, 4);
  for (const [freq, cents] of [[2093, 0], [2093 * 1.01, 6]] as const) {
    const osc = tone(v, {
      type: 'square', freq, freqEnd: freq * 0.82, bendAt: dur * 0.7,
      dur, peak: level * 0.5, attack: 0.006, detuneCents: cents, out: bp,
    });
    lfo(v, osc.detune, 30, 22, dur);
  }
}

/** Pad thud + noise crunch shared by hitLight / hitBig. */
function hit(v: SynthVoice, big: boolean): void {
  const level = big ? LEVEL.hitBig : LEVEL.hitLight;
  tone(v, { type: 'sine', freq: 90, freqEnd: 45, dur: 0.12, peak: level, attack: 0.002 });
  noise(v, { dur: 0.08, peak: level * 0.7, filter: { type: 'lowpass', freq: 300 } });
  if (big) {
    noise(v, {
      dur: 0.14, peak: level * 0.55, attack: 0.003,
      filter: { type: 'bandpass', freq: 500, q: 1.2 },
    });
    tone(v, { type: 'sine', freq: 55, freqEnd: 38, dur: 0.2, peak: level * 0.6, attack: 0.003 });
  }
}

/** One saw note of the touchdown fanfare, optionally detuned for width. */
function fanfareNote(v: SynthVoice, freq: number, t: number, dur: number, peak: number, out?: AudioNode): void {
  tone(v, { type: 'sawtooth', freq, t, dur, peak, attack: 0.006, detuneCents: -7, out });
  tone(v, { type: 'sawtooth', freq, t, dur, peak, attack: 0.006, detuneCents: 7, out });
}

function menuBlip(v: SynthVoice, freqs: readonly number[], step: number, dur: number): void {
  freqs.forEach((f, i) => {
    tone(v, { type: 'square', freq: f, t: i * step, dur, peak: LEVEL.menu, attack: 0.003 });
  });
}

// --- The registry ------------------------------------------------------------
// Record<SfxName, ...> makes a missing recipe a compile error.

export const SFX: Record<SfxName, SfxFactory> = {
  whistle: (v) => whistleBody(v, 0.45, LEVEL.whistle),

  hitLight: (v) => hit(v, false),

  hitBig: (v) => hit(v, true),

  catch: (v) => {
    noise(v, { dur: 0.03, peak: LEVEL.catch, filter: { type: 'highpass', freq: 1200 } });
  },

  // Not specified in §11 — a leather whoosh off the hand. TODO(balance)
  throw: (v) => {
    noise(v, {
      dur: 0.14, peak: LEVEL.throw, attack: 0.02,
      filter: { type: 'bandpass', freq: 700, freqEnd: 1800, q: 1.0 },
    });
  },

  kickThump: (v) => {
    tone(v, { type: 'sine', freq: 65, freqEnd: 45, dur: 0.15, peak: LEVEL.kick, attack: 0.002 });
    noise(v, { dur: 0.01, peak: LEVEL.kick * 0.5, filter: { type: 'highpass', freq: 2000 } });
  },

  puntThump: (v) => {
    tone(v, { type: 'sine', freq: 55, freqEnd: 38, dur: 0.24, peak: LEVEL.kick, attack: 0.002 });
    noise(v, { dur: 0.012, peak: LEVEL.kick * 0.45, filter: { type: 'highpass', freq: 1800 } });
  },

  crowdCheer: (v) => {
    noise(v, {
      dur: 1.5, peak: LEVEL.crowdSpike, attack: 0.3,
      filter: { type: 'bandpass', freq: 700, freqEnd: 1400, q: 0.7 },
    });
  },

  crowdGroan: (v) => {
    noise(v, {
      source: 'brown', dur: 1.6, peak: LEVEL.crowdSpike * 0.9, attack: 0.25,
      filter: { type: 'lowpass', freq: 700, freqEnd: 300 },
    });
  },

  firstDownChime: (v) => {
    tone(v, { type: 'triangle', freq: NOTE.A5, dur: 0.2, peak: LEVEL.chime, attack: 0.005 });
    tone(v, { type: 'triangle', freq: NOTE.Cs6, t: 0.02, dur: 0.2, peak: LEVEL.chime * 0.8, attack: 0.005 });
  },

  touchdownFanfare: (v) => {
    const step = 0.07;
    const arp = [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5] as const;
    arp.forEach((f, i) => fanfareNote(v, f, i * step, 0.13, LEVEL.fanfare));
    // Held triad under a rising lowpass sweep.
    const sweep = filterNode(v, 'lowpass', 800, 0.9, 3000, arp.length * step + 0.5);
    for (const f of [NOTE.C4, NOTE.E4, NOTE.G4] as const) {
      fanfareNote(v, f, arp.length * step, 0.5, LEVEL.fanfare * 0.8, sweep);
    }
  },

  fgGood: (v) => {
    // First two notes of the fanfare.
    fanfareNote(v, NOTE.C4, 0, 0.13, LEVEL.fanfare);
    fanfareNote(v, NOTE.E4, 0.07, 0.18, LEVEL.fanfare);
  },

  turnoverSting: (v) => {
    const lp = filterNode(v, 'lowpass', 900, 0.8);
    for (const f of [NOTE.A3, NOTE.Bb3] as const) {
      tone(v, { type: 'sawtooth', freq: f, dur: 0.4, peak: LEVEL.sting, attack: 0.01, out: lp });
    }
  },

  flag: (v) => {
    whistleBody(v, 0.18, LEVEL.whistle * 0.9);
    tone(v, { type: 'square', freq: 220, freqEnd: 165, dur: 0.09, peak: LEVEL.menu, attack: 0.004 });
  },

  timeoutHorn: (v) => {
    const lp = filterNode(v, 'lowpass', 1000, 0.7);
    const osc = tone(v, {
      type: 'square', freq: NOTE.Eb4, dur: 0.5, peak: LEVEL.horn, attack: 0.02, out: lp,
    });
    lfo(v, osc.detune, 5.5, 18, 0.5);
  },

  menuMove: (v) => menuBlip(v, [660], 0, 0.035),
  menuSelect: (v) => menuBlip(v, [660, 990], 0.06, 0.06),
  menuBack: (v) => menuBlip(v, [440, 330], 0.06, 0.06),
  menuError: (v) => {
    tone(v, { type: 'square', freq: 220, freqEnd: 165, dur: 0.09, peak: LEVEL.menu, attack: 0.004 });
  },

  clockWarning: (v) => {
    tone(v, { type: 'triangle', freq: 880, dur: 0.06, peak: LEVEL.tick, attack: 0.006 });
  },
};

/**
 * Fixed iteration order for every SfxName (demo grid, coverage test). Declared
 * as a literal rather than derived from Object.keys so the order is stable.
 */
export const SFX_NAMES: readonly SfxName[] = [
  'whistle', 'hitLight', 'hitBig', 'catch', 'throw', 'kickThump', 'puntThump',
  'crowdCheer', 'crowdGroan', 'firstDownChime', 'touchdownFanfare', 'fgGood',
  'turnoverSting', 'flag', 'timeoutHorn',
  'menuMove', 'menuSelect', 'menuBack', 'menuError',
  'clockWarning',
];
