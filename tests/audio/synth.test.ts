import { describe, expect, it } from 'vitest';

import type { SfxName } from '../../src/audio/AudioEngine';
import { SFX, SFX_NAMES, type SynthVoice } from '../../src/audio/synth';
import {
  FakeAudioContext, FakeGain, FakeOscillator, FakeSourceNode, asAudioContext,
} from './fakeAudio';

function voiceFor(ctx: FakeAudioContext, t0 = 1.25): SynthVoice {
  const dest = ctx.createGain();
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  return {
    ctx: asAudioContext(ctx),
    dest: dest as unknown as AudioNode,
    t0,
    white: buf as unknown as AudioBuffer,
    brown: buf as unknown as AudioBuffer,
    gain: 1,
    pitch: 1,
  };
}

describe('synth registry', () => {
  it('lists every SfxName exactly once', () => {
    const keys = Object.keys(SFX).sort();
    const listed = [...SFX_NAMES].sort();
    expect(listed).toEqual(keys);
    expect(new Set(SFX_NAMES).size).toBe(SFX_NAMES.length);
  });

  it('schedules at least one sounding source per recipe', () => {
    for (const name of SFX_NAMES) {
      const ctx = new FakeAudioContext();
      SFX[name](voiceFor(ctx));
      const sources = ctx.created.filter((n): n is FakeSourceNode => n instanceof FakeSourceNode);
      expect(sources.length, `${name} scheduled no source`).toBeGreaterThan(0);
      for (const s of sources) {
        expect(s.startedAt, `${name} left a source unstarted`).not.toBeNull();
        expect(s.stoppedAt, `${name} left a source unstopped`).not.toBeNull();
      }
    }
  });

  it('never schedules before the voice origin and always terminates', () => {
    const t0 = 3;
    for (const name of SFX_NAMES) {
      const ctx = new FakeAudioContext();
      SFX[name](voiceFor(ctx, t0));
      for (const node of ctx.created) {
        if (node instanceof FakeSourceNode) {
          expect(node.startedAt!, `${name}`).toBeGreaterThanOrEqual(t0 - 1e-9);
          expect(node.stoppedAt!, `${name}`).toBeGreaterThan(node.startedAt!);
          // Nothing should ring for more than a couple of seconds.
          expect(node.stoppedAt! - t0, `${name} runs long`).toBeLessThan(2.5);
        }
      }
    }
  });

  it('scales peak level with the voice gain', () => {
    const loud = new FakeAudioContext();
    SFX.hitLight(voiceFor(loud, 1));
    const quiet = new FakeAudioContext();
    SFX.hitLight({ ...voiceFor(quiet, 1), gain: 0.25 });

    const peak = (ctx: FakeAudioContext): number => Math.max(
      ...ctx.created
        .filter((n): n is FakeGain => n instanceof FakeGain)
        .flatMap((g) => g.gain.calls.map((c) => c.value)),
    );
    expect(peak(quiet)).toBeLessThan(peak(loud));
  });

  it('scales oscillator frequency with the voice pitch', () => {
    const base = new FakeAudioContext();
    SFX.kickThump(voiceFor(base, 1));
    const up = new FakeAudioContext();
    SFX.kickThump({ ...voiceFor(up, 1), pitch: 2 });

    const firstFreq = (ctx: FakeAudioContext): number => {
      const osc = ctx.nodesOfKind('oscillator')[0] as unknown as FakeOscillator;
      return osc.frequency.calls[0]!.value;
    };
    expect(firstFreq(up)).toBeCloseTo(firstFreq(base) * 2, 6);
  });

  it('routes menu blips and crowd spikes through the voice destination', () => {
    const names: SfxName[] = ['menuSelect', 'crowdCheer', 'touchdownFanfare'];
    for (const name of names) {
      const ctx = new FakeAudioContext();
      const v = voiceFor(ctx);
      SFX[name](v);
      const reachesDest = ctx.created.some((n) => n.outputs.includes(v.dest));
      expect(reachesDest, `${name} never reached the bus`).toBe(true);
    }
  });
});
