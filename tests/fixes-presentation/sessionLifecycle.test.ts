// Leaving one game and starting the next: nothing from the old game may bleed
// into the new one. Effects are timed in absolute sim ticks, so a leftover
// burst re-fires when the new game's clock reaches the old startTick; and the
// crowd bed is a single looping source that a restart must hand over, not
// double up on.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NullAudioEngine } from '../../src/audio/AudioEngine';
import { WebAudioEngine } from '../../src/audio/WebAudioEngine';
import { GameSession, type RenderTarget } from '../../src/game/GameSession';
import type { EffectKind } from '../../src/render/EffectsRenderer';
import { EffectsRenderer } from '../../src/render/EffectsRenderer';
import { testRosters, testTeams } from '../integration/harness';
import { FakeAudioContext, FakeSourceNode } from '../audio/fakeAudio';

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function sessionWith(renderer: RenderTarget): GameSession {
  return new GameSession({
    config: {
      quarterLengthSec: 60,
      difficulty: 'pro',
      userTeam: 0,
      allowTies: true,
      penaltiesEnabled: true,
      enableOnside: false,
    },
    rosters: testRosters(),
    seed: 4242,
    audio: new NullAudioEngine(),
    teams: testTeams(),
    renderer,
  });
}

describe('effects do not survive into the next game', () => {
  it('clears the shared effects list on dispose', () => {
    const effects = new EffectsRenderer();
    const renderer: RenderTarget = {
      draw: () => {},
      snapCamera: () => {},
      effects,
    };

    const session = sessionWith(renderer);
    // A burst from deep in the old game — its ttl is 26 ticks, but the new game
    // restarts at tick 0, so it would sit unpruned until tick 3600 comes round.
    effects.emit('bigHit' as EffectKind, 26.5, 60, 3600);
    expect(effects.activeCount).toBe(1);

    session.dispose();
    expect(effects.activeCount).toBe(0);
  });

  it('leaves a live game\'s effects alone', () => {
    const effects = new EffectsRenderer();
    const session = sessionWith({ draw: () => {}, snapCamera: () => {}, effects });
    effects.emit('dust' as EffectKind, 26.5, 60, 10);
    expect(effects.activeCount).toBe(1);
    session.pause();
    session.resume();
    expect(effects.activeCount).toBe(1);
    session.dispose();
  });
});

// ---------------------------------------------------------------------------
// Crowd bed
// ---------------------------------------------------------------------------

describe('restarting a game does not stack crowd loops', () => {
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

  function loops(ctx: FakeAudioContext): FakeSourceNode[] {
    return ctx.created.filter((n): n is FakeSourceNode => n instanceof FakeSourceNode && n.loop);
  }

  it('retires the old bed before the replacement starts', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    const ctx = contexts[0];
    if (!ctx) throw new Error('no AudioContext');

    engine.setCrowdIntensity(0.25);
    expect(loops(ctx)).toHaveLength(1);

    // App.beginGame: dispose the old session, then construct the new one, which
    // brings the bed straight back up inside the old loop's stop tail.
    engine.stopAmbience();
    engine.setCrowdIntensity(0.25);

    const beds = loops(ctx);
    expect(beds.length).toBeGreaterThan(1); // a fresh source is fine...
    // ...as long as only one of them is still sounding.
    const audible = beds.filter((b) => b.stoppedAt === null || b.stoppedAt > ctx.currentTime);
    expect(audible).toHaveLength(1);
    expect(audible[0]).toBe(beds[beds.length - 1]);
  });

  it('still fades the bed out when nothing restarts it', () => {
    const engine = new WebAudioEngine();
    engine.unlock();
    const ctx = contexts[0];
    if (!ctx) throw new Error('no AudioContext');

    engine.setCrowdIntensity(0.4);
    const bed = loops(ctx)[0];
    engine.stopAmbience();
    // The tail is scheduled, not immediate — the fade needs the source alive.
    expect(bed?.stoppedAt).toBeGreaterThan(ctx.currentTime);
  });
});
