// Browser AudioEngine: one AudioContext created lazily on the first unlock()
// (autoplay policy), a fixed bus graph, and a looping synthetic crowd bed.
//
// Presentation layer — Math.random is allowed here (noise buffers only, built
// once at unlock and never touched by the sim), and nothing in this file feeds
// back into GameState.

import type { AudioBusName, AudioEngine, SfxName } from './AudioEngine';
import { SFX, type SynthVoice } from './synth';

// TODO(balance): crowd bed + mixing tunables (kept local; balance.ts is frozen
// for concurrent edits).
const MIX = {
  /** Headroom under the master fader so stacked voices don't clip. */
  masterCeiling: 0.85,
  defaultBus: { master: 0.7, sfx: 0.8, crowd: 0.6, ui: 0.7 } as Record<AudioBusName, number>,
  /** Never schedule exactly at currentTime — a hair of lead avoids dropouts. */
  scheduleLeadSec: 0.005,
  /** Same-name retrigger guards: hits fire in clusters, crowd swells don't. */
  retriggerSec: 0.04,
  crowdRetriggerSec: 0.6,
} as const;

const CROWD = {
  noiseSec: 2,
  loopCrossfadeSec: 0.05,
  gainMin: 0.15, gainMax: 0.9,
  cutoffMin: 500, cutoffMax: 1400,
  /** Smoothing time-constants for setTargetAtTime (fast rise, slow settle). */
  tauDown: 0.8, tauUp: 0.1,
  /** A rise bigger than this opens a fast-attack window — the "swell". */
  riseThreshold: 0.08,
  /**
   * How long the fast tau stays latched. The director re-issues an intensity
   * every tick, and each setTargetAtTime restarts the approach from the current
   * value, so without a latch a one-tick tauUp would be immediately overridden
   * and every transition would take tauDown.
   */
  attackSec: 0.3,
  /** Breathing LFO: 0.1Hz, +/-10% of the current bed gain. */
  lfoHz: 0.1, lfoDepth: 0.1,
  swellRestoreSec: 4.0,
  swellAmount: 0.35,
  deflateIntensity: 0.12,
  deflateSec: 3.0,
} as const;

const UI_SFX: ReadonlySet<SfxName> = new Set<SfxName>([
  'menuMove', 'menuSelect', 'menuBack', 'menuError',
]);
const CROWD_SFX: ReadonlySet<SfxName> = new Set<SfxName>(['crowdCheer', 'crowdGroan']);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

type AudioContextCtor = new () => AudioContext;

function resolveAudioContext(): AudioContextCtor | null {
  const w = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 2s of white noise. The only randomness in the audio layer. */
function makeWhiteNoise(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * CROWD.noiseSec);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Leaky-integrated white noise (brown-ish). DC is removed and the loop seam
 * crossfaded, otherwise the 2s wrap clicks under the crowd lowpass.
 */
function makeBrownNoise(ctx: AudioContext, white: AudioBuffer): AudioBuffer {
  const src = white.getChannelData(0);
  const len = src.length;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (src[i] ?? 0)) / 1.02;
    d[i] = last * 3.5;
    sum += d[i] ?? 0;
  }
  const mean = sum / len;
  for (let i = 0; i < len; i++) d[i] = (d[i] ?? 0) - mean;
  const xf = Math.max(1, Math.floor(ctx.sampleRate * CROWD.loopCrossfadeSec));
  for (let i = 0; i < xf && i < len; i++) {
    const a = i / xf;
    d[i] = (d[i] ?? 0) * a + (d[len - xf + i] ?? 0) * (1 - a);
  }
  return buf;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  buses: Record<AudioBusName, GainNode>;
  white: AudioBuffer;
  brown: AudioBuffer;
  crowdSource: AudioBufferSourceNode | null;
  crowdFilter: BiquadFilterNode;
  crowdGain: GainNode;
  crowdLfoDepth: GainNode;
}

export class WebAudioEngine implements AudioEngine {
  private graph: Graph | null = null;
  private readonly busVolume: Record<AudioBusName, number> = { ...MIX.defaultBus };
  private readonly lastPlayed = new Map<SfxName, number>();

  private targetIntensity = 0;
  private appliedIntensity = 0;
  private swellAmount = 0;
  private swellAt = 0;
  private dipUntil = 0;
  private fastUntil = 0;
  private ambienceStopped = false;

  /** True once the AudioContext exists (i.e. after a user gesture). */
  get ready(): boolean {
    return this.graph !== null;
  }

  unlock(): void {
    if (!this.graph) {
      const Ctor = resolveAudioContext();
      if (!Ctor) return; // headless / unsupported — stay silent, never throw
      this.graph = this.build(new Ctor());
    }
    const { ctx } = this.graph;
    if (ctx.state === 'suspended') void ctx.resume();
  }

  private build(ctx: AudioContext): Graph {
    const master = ctx.createGain();
    master.gain.value = this.busVolume.master * MIX.masterCeiling;
    master.connect(ctx.destination);

    const mk = (name: AudioBusName): GainNode => {
      const g = ctx.createGain();
      g.gain.value = this.busVolume[name];
      g.connect(master);
      return g;
    };
    const buses: Record<AudioBusName, GainNode> = {
      master,
      sfx: mk('sfx'),
      crowd: mk('crowd'),
      ui: mk('ui'),
    };

    const white = makeWhiteNoise(ctx);
    const brown = makeBrownNoise(ctx, white);

    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = 'lowpass';
    crowdFilter.frequency.value = CROWD.cutoffMin;
    crowdFilter.Q.value = 0.6;

    const crowdGain = ctx.createGain();
    crowdGain.gain.value = 0;
    crowdFilter.connect(crowdGain);
    crowdGain.connect(buses.crowd);

    // 0.1Hz breathing on top of the bed level (additive AudioParam modulation).
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = CROWD.lfoHz;
    const crowdLfoDepth = ctx.createGain();
    crowdLfoDepth.gain.value = 0;
    lfo.connect(crowdLfoDepth);
    crowdLfoDepth.connect(crowdGain.gain);
    lfo.start();

    return {
      ctx, master, buses, white, brown,
      crowdSource: null, crowdFilter, crowdGain, crowdLfoDepth,
    };
  }

  private startCrowdLoop(): void {
    const g = this.graph;
    if (!g || g.crowdSource) return;
    const src = g.ctx.createBufferSource();
    src.buffer = g.brown;
    src.loop = true;
    src.connect(g.crowdFilter);
    src.start();
    g.crowdSource = src;
  }

  play(name: SfxName, opts?: { volume?: number; pitch?: number }): void {
    const g = this.graph;
    if (!g) return;
    const { ctx } = g;
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const gap = CROWD_SFX.has(name) ? MIX.crowdRetriggerSec : MIX.retriggerSec;
    const last = this.lastPlayed.get(name);
    if (last !== undefined && now - last < gap) return;
    this.lastPlayed.set(name, now);

    const bus: AudioBusName = UI_SFX.has(name) ? 'ui' : CROWD_SFX.has(name) ? 'crowd' : 'sfx';
    const voice: SynthVoice = {
      ctx,
      dest: g.buses[bus],
      t0: now + MIX.scheduleLeadSec,
      white: g.white,
      brown: g.brown,
      gain: clamp01(opts?.volume ?? 1),
      pitch: Math.max(opts?.pitch ?? 1, 0.25),
    };
    SFX[name](voice);

    // Crowd one-shots also move the ambient bed.
    if (name === 'crowdCheer') this.swell();
    else if (name === 'crowdGroan') this.deflate();
  }

  /** 0..1 target; smoothed toward with setTargetAtTime. */
  setCrowdIntensity(v: number): void {
    this.targetIntensity = clamp01(v);
    if (this.targetIntensity > 0) this.ambienceStopped = false;
    this.applyCrowd();
  }

  /** Big-play lift: fast attack, ~4s exponential settle back to the target. */
  swell(amount: number = CROWD.swellAmount): void {
    const g = this.graph;
    if (!g) return;
    this.swellAmount = Math.max(this.currentSwell(), amount);
    this.swellAt = g.ctx.currentTime;
    this.applyCrowd();
  }

  /** Away-team dagger: hold the bed down near silence for a few seconds. */
  deflate(seconds: number = CROWD.deflateSec): void {
    const g = this.graph;
    if (!g) return;
    this.swellAmount = 0;
    this.dipUntil = g.ctx.currentTime + seconds;
    this.applyCrowd();
  }

  private currentSwell(): number {
    const g = this.graph;
    if (!g || this.swellAmount <= 0) return 0;
    const dt = g.ctx.currentTime - this.swellAt;
    if (dt < 0) return this.swellAmount;
    return this.swellAmount * Math.exp(-dt / CROWD.swellRestoreSec);
  }

  private applyCrowd(): void {
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;

    let v = this.ambienceStopped ? 0 : this.targetIntensity + this.currentSwell();
    if (now < this.dipUntil) v = Math.min(v, CROWD.deflateIntensity);
    v = clamp01(v);

    if (v > 0) this.startCrowdLoop();

    const gain = v <= 0 ? 0 : CROWD.gainMin + (CROWD.gainMax - CROWD.gainMin) * v;
    const cutoff = CROWD.cutoffMin + (CROWD.cutoffMax - CROWD.cutoffMin) * v;
    if (v - this.appliedIntensity > CROWD.riseThreshold) this.fastUntil = now + CROWD.attackSec;
    const tau = now < this.fastUntil ? CROWD.tauUp : CROWD.tauDown;

    g.crowdGain.gain.setTargetAtTime(gain, now, tau);
    g.crowdFilter.frequency.setTargetAtTime(cutoff, now, tau);
    g.crowdLfoDepth.gain.setTargetAtTime(gain * CROWD.lfoDepth, now, CROWD.tauDown);
    this.appliedIntensity = v;
  }

  setBusVolume(bus: AudioBusName, v: number): void {
    const vol = clamp01(v);
    this.busVolume[bus] = vol;
    const g = this.graph;
    if (!g) return;
    const node = g.buses[bus];
    const target = bus === 'master' ? vol * MIX.masterCeiling : vol;
    node.gain.setTargetAtTime(target, g.ctx.currentTime, 0.05);
  }

  stopAmbience(): void {
    this.ambienceStopped = true;
    this.targetIntensity = 0;
    this.swellAmount = 0;
    this.dipUntil = 0;
    this.fastUntil = 0;
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    g.crowdGain.gain.setTargetAtTime(0, now, 0.2);
    g.crowdLfoDepth.gain.setTargetAtTime(0, now, 0.2);
    this.appliedIntensity = 0;
    if (g.crowdSource) {
      const src = g.crowdSource;
      g.crowdSource = null;
      src.stop(now + 1.0);
    }
  }
}
