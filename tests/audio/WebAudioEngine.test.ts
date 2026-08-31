// Exercises the engine's graph wiring against the fake WebAudio surface. No
// real AudioContext is ever constructed (vitest runs in the node environment);
// the fake is installed on globalThis for the duration of each spec.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WebAudioEngine } from '../../src/audio/WebAudioEngine';
import { FakeAudioContext, FakeBiquad, FakeGain, FakeSourceNode } from './fakeAudio';

// The engine resolves its constructor off globalThis, so the fake is installed
// there rather than injected.
const globals = globalThis as unknown as Record<string, unknown>;

let contexts: FakeAudioContext[] = [];

beforeEach(() => {
  contexts = [];
  class Tracked extends FakeAudioContext {
    constructor() {
      super();
      contexts.push(this);
    }
  }
  globals.AudioContext = Tracked;
});

afterEach(() => {
  delete globals.AudioContext;
});

function ctxOf(): FakeAudioContext {
  const ctx = contexts[0];
  if (!ctx) throw new Error('engine never created an AudioContext');
  return ctx;
}

interface Graph {
  master: FakeGain;
  sfxBus: FakeGain;
  crowdBus: FakeGain;
  uiBus: FakeGain;
  crowdBed: FakeGain;
  crowdFilter: FakeBiquad;
}

/** Node creation order in WebAudioEngine.build(). */
function graph(ctx: FakeAudioContext): Graph {
  const gains = ctx.nodesOfKind('gain') as FakeGain[];
  return {
    master: gains[0]!,
    sfxBus: gains[1]!,
    crowdBus: gains[2]!,
    uiBus: gains[3]!,
    crowdBed: gains[4]!,
    crowdFilter: ctx.nodesOfKind('biquad')[0] as FakeBiquad,
  };
}

function sourceCount(ctx: FakeAudioContext): number {
  return ctx.created.filter((n) => n instanceof FakeSourceNode).length;
}

describe('WebAudioEngine', () => {
  it('is silent and inert before unlock()', () => {
    const engine = new WebAudioEngine();
    expect(engine.ready).toBe(false);
    expect(() => {
      engine.play('whistle');
      engine.setCrowdIntensity(0.8);
      engine.setBusVolume('sfx', 0.5);
      engine.stopAmbience();
    }).not.toThrow();
    expect(contexts).toHaveLength(0);
  });

  it('builds master -> destination with sfx/crowd/ui children on unlock', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    const ctx = ctxOf();
    const g = graph(ctx);

    expect(engine.ready).toBe(true);
    expect(g.master.outputs).toContain(ctx.destination);
    for (const bus of [g.sfxBus, g.crowdBus, g.uiBus]) {
      expect(bus.outputs).toContain(g.master);
    }
    expect(ctx.resumeCount).toBe(1);
  });

  it('unlock() is idempotent', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    engine.unlock();
    engine.unlock();
    expect(contexts).toHaveLength(1);
  });

  it('routes menu sfx to the ui bus and crowd one-shots to the crowd bus', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    const ctx = ctxOf();
    const g = graph(ctx);

    engine.play('menuSelect');
    expect(ctx.created.some((n) => n.outputs.includes(g.uiBus))).toBe(true);

    engine.play('crowdCheer');
    expect(ctx.created.some((n) => n.outputs.includes(g.crowdBus))).toBe(true);

    engine.play('whistle');
    expect(ctx.created.some((n) => n.outputs.includes(g.sfxBus))).toBe(true);
  });

  it('guards same-name retriggers within a few milliseconds', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    const ctx = ctxOf();

    const before = sourceCount(ctx);
    engine.play('hitLight');
    const afterFirst = sourceCount(ctx);
    expect(afterFirst).toBeGreaterThan(before);

    engine.play('hitLight');
    expect(sourceCount(ctx)).toBe(afterFirst); // swallowed

    ctx.advance(0.2);
    engine.play('hitLight');
    expect(sourceCount(ctx)).toBeGreaterThan(afterFirst);
  });

  it('starts the crowd bed on the first non-zero intensity and maps it to gain + cutoff', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    const ctx = ctxOf();
    const g = graph(ctx);

    const looping = (): FakeSourceNode[] => ctx.created
      .filter((n): n is FakeSourceNode => n instanceof FakeSourceNode && n.loop);
    expect(looping()).toHaveLength(0);

    engine.setCrowdIntensity(0.3);
    expect(looping()).toHaveLength(1);
    const quietGain = g.crowdBed.gain.value;
    const quietCutoff = g.crowdFilter.frequency.value;

    ctx.advance(1);
    engine.setCrowdIntensity(0.9);
    expect(g.crowdBed.gain.value).toBeGreaterThan(quietGain);
    expect(g.crowdFilter.frequency.value).toBeGreaterThan(quietCutoff);
  });

  it('swells above and deflates below the standing intensity', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    const ctx = ctxOf();
    const g = graph(ctx);

    engine.setCrowdIntensity(0.4);
    const level = g.crowdBed.gain.value;

    engine.swell();
    const peak = g.crowdBed.gain.value;
    expect(peak).toBeGreaterThan(level);

    // ~4s release: still elevated after 6s, effectively home after 24s.
    ctx.advance(6);
    engine.setCrowdIntensity(0.4);
    const midway = g.crowdBed.gain.value;
    expect(midway).toBeLessThan(peak);
    expect(midway).toBeGreaterThan(level);

    ctx.advance(18);
    engine.setCrowdIntensity(0.4);
    expect(g.crowdBed.gain.value).toBeCloseTo(level, 2);

    engine.deflate();
    expect(g.crowdBed.gain.value).toBeLessThan(level);
    // Held down even while the director keeps pushing the old target.
    engine.setCrowdIntensity(0.9);
    expect(g.crowdBed.gain.value).toBeLessThan(level);
    ctx.advance(4);
    engine.setCrowdIntensity(0.9);
    expect(g.crowdBed.gain.value).toBeGreaterThan(level);
  });

  it('latches the fast attack across the director re-issuing intensity every tick', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    const ctx = ctxOf();
    const g = graph(ctx);
    const lastTau = (): number => g.crowdBed.gain.calls[g.crowdBed.gain.calls.length - 1]!.tau!;

    // Steady state settles slowly (past the initial 0 -> 0.3 attack window).
    engine.setCrowdIntensity(0.3);
    ctx.advance(0.5);
    for (let i = 0; i < 10; i++) {
      ctx.advance(1 / 60);
      engine.setCrowdIntensity(0.3);
    }
    const settleTau = lastTau();

    // A spike opens the fast window, and it survives the next ticks' re-issues
    // (each setTargetAtTime restarts the approach, so a one-tick tau is moot).
    engine.setCrowdIntensity(0.9);
    const attackTau = lastTau();
    expect(attackTau).toBeLessThan(settleTau);
    for (let i = 0; i < 10; i++) {
      ctx.advance(1 / 60);
      engine.setCrowdIntensity(0.9);
      expect(lastTau()).toBe(attackTau);
    }

    ctx.advance(0.5);
    engine.setCrowdIntensity(0.9);
    expect(lastTau()).toBe(settleTau);
  });

  it('stopAmbience silences and stops the loop, and a later intensity restarts it', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    const ctx = ctxOf();
    const g = graph(ctx);

    engine.setCrowdIntensity(0.5);
    const loops = (): FakeSourceNode[] => ctx.created
      .filter((n): n is FakeSourceNode => n instanceof FakeSourceNode && n.loop);
    expect(loops()).toHaveLength(1);

    engine.stopAmbience();
    expect(g.crowdBed.gain.value).toBe(0);
    expect(loops()[0]!.stoppedAt).not.toBeNull();

    ctx.advance(2);
    engine.setCrowdIntensity(0.5);
    expect(loops()).toHaveLength(2);
    expect(g.crowdBed.gain.value).toBeGreaterThan(0);
  });

  it('retains bus volumes set before unlock and applies them to the graph', () => {
    const engine = new WebAudioEngine();
    engine.setBusVolume('crowd', 0.2);
    engine.unlock();
    expect(graph(ctxOf()).crowdBus.gain.value).toBeCloseTo(0.2, 6);

    engine.setBusVolume('crowd', 0.75);
    expect(graph(ctxOf()).crowdBus.gain.value).toBeCloseTo(0.75, 6);
  });

  it('clamps bus volumes into 0..1', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    const g = graph(ctxOf());
    engine.setBusVolume('sfx', 4);
    expect(g.sfxBus.gain.value).toBe(1);
    engine.setBusVolume('sfx', -2);
    expect(g.sfxBus.gain.value).toBe(0);
  });
});
