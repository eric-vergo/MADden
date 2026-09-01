// The replay as the player meets it: a real GameSession, a real game, and the
// big play that stops the clock and shows itself again.

import { describe, expect, it } from 'vitest';
import { GameAction, GamePhase } from '../../src/sim/types';
import { InputContext } from '../../src/input/types';
import { TICK_DT } from '../../src/sim/constants';
import { DEAD_PAUSE_TICKS } from '../../src/sim/phases/playDead';
import type { GameSession } from '../../src/game/GameSession';
import { autoAnswer, makeHarness, type Harness } from '../integration/harness';
import { recordingRenderer, type RecordingRenderer } from './rig';

const GAME_TICKS = 60 * 60 * 40;

/** Step until `stop` says so (or the game ends); returns ticks stepped. */
function runUntil(h: Harness, stop: (s: GameSession) => boolean, cap = GAME_TICKS): number {
  for (let i = 0; i < cap; i++) {
    if (stop(h.session)) return i;
    if (h.session.state.phase === GamePhase.GAME_OVER) return i;
    h.session.stepOneTick();
  }
  return cap;
}

interface ReplayRig {
  h: Harness;
  renderer: RecordingRenderer;
}

function rig(seed = 90210): ReplayRig {
  const renderer = recordingRenderer();
  const h = makeHarness({
    userTeam: 0,
    quarterLengthSec: 60,
    seed,
    renderer,
    onPrompt: autoAnswer,
  });
  return { h, renderer };
}

describe('GameSession — big-play replay', () => {
  it('cuts in after the dead-ball beat, freezes the sim, and resumes in place', () => {
    const { h, renderer } = rig();
    runUntil(h, (s) => s.replaying);
    expect(h.session.replaying).toBe(true);

    const frozenTick = h.session.state.tick;
    const camSnapsAtStart = renderer.camSnaps.length;
    expect(h.session.state.phase).toBe(GamePhase.PLAY_DEAD);
    expect(renderer.zooms[renderer.zooms.length - 1]).toBeCloseTo(1.15, 6);

    // The dead-ball presentation ran to completion before the replay took over.
    const controller = h.session.replayController;
    expect(controller).not.toBeNull();
    expect(controller?.manifest.bigPlay).toBe(true);
    expect(controller?.frameCount).toBeGreaterThan(1);
    expect(controller?.done).toBe(false);

    // Nothing in the sim moves while it plays.
    for (let i = 0; i < 30; i++) h.session.stepOneTick();
    expect(h.session.state.tick).toBe(frozenTick);
    expect(h.session.replaying).toBe(true);
    expect((h.session.replayController?.cursor ?? 0)).toBeGreaterThan(0);

    // …and playback is where the input goes.
    expect(h.input.contexts[h.input.contexts.length - 1]).toBe(InputContext.REPLAY);
    expect(h.session.context).toBe(InputContext.REPLAY);

    const ticks = runUntil(h, (s) => !s.replaying);
    expect(ticks).toBeGreaterThan(0);
    expect(h.session.state.tick).toBe(frozenTick);
    expect(renderer.camSnaps.length).toBeGreaterThan(camSnapsAtStart);
    expect(renderer.zooms[renderer.zooms.length - 1]).toBe(1);

    // The sim picks up exactly where it stopped and moves on with the game.
    h.session.stepOneTick();
    expect(h.session.state.tick).toBe(frozenTick + 1);
    runUntil(h, (s) => s.state.phase === GamePhase.PLAY_CALL, 600);
    expect(h.session.state.phase).not.toBe(GamePhase.PLAY_DEAD);
  });

  it('draws recorded frames through the normal renderer with the replay chrome', () => {
    const { h, renderer } = rig();
    runUntil(h, (s) => s.replaying);
    for (let i = 0; i < 20; i++) h.session.stepOneTick();

    renderer.draws.length = 0;
    h.session.render(0.75, TICK_DT);
    const call = renderer.last();
    expect(call).toBeTruthy();
    expect(call?.extras.replay).toBe(true);
    expect(call?.extras.showHud).toBe(false);
    // Live HUD extras are all off during playback.
    expect(call?.extras.ticker).toBeNull();
    expect(call?.extras.banner).toBeNull();
    expect(call?.extras.yardagePopup).toBeNull();
    expect(call?.extras.coverageHint).toBeNull();
    expect(call?.extras.showReceiverKeys).toBe(false);

    // It is showing the play again, not the frozen present.
    expect(call?.curr.tick).toBeLessThan(h.session.state.tick);
    expect(call?.curr.players.length).toBe(22);
    // Playback owns its own interpolation, so the loop's alpha is not used.
    expect(call?.alpha).not.toBe(0.75);
    expect(call?.alpha).toBeGreaterThanOrEqual(0);
    expect(call?.alpha).toBeLessThan(1);
    expect(call?.extras.cameraTargetY).toBeTypeOf('number');
  });

  it('records ~1s of pre-snap lead and every live tick up to the whistle', () => {
    const { h } = rig();
    runUntil(h, (s) => s.replaying);
    const frames = h.session.replayController?.frames ?? [];
    expect(frames.length).toBeGreaterThan(30);

    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]?.tick).toBe((frames[i - 1]?.tick ?? 0) + 1);
    }
    // The tape ends on the dead ball, not a frame short of it.
    expect(frames[frames.length - 1]?.phase).toBe(GamePhase.PLAY_DEAD);
    const phases = new Set(frames.map((f) => f.phase));
    expect(phases.has(GamePhase.PLAY_LIVE)).toBe(true);
  });

  it('any key skips out and hands the game straight back', () => {
    const { h } = rig();
    runUntil(h, (s) => s.replaying);
    for (let i = 0; i < 10; i++) h.session.stepOneTick();
    expect(h.session.replaying).toBe(true);

    const frozenTick = h.session.state.tick;
    h.input.queue([GameAction.Confirm]);
    h.session.stepOneTick();
    expect(h.session.replaying).toBe(false);
    expect(h.session.replayController).toBeNull();
    expect(h.session.state.tick).toBe(frozenTick);

    // The very next tick is the one the sim was holding: the game moves on.
    h.session.stepOneTick();
    expect(h.session.state.tick).toBe(frozenTick + 1);
    expect(h.session.state.phase).not.toBe(GamePhase.PLAY_DEAD);
  });

  it('skipReplay() is the same door from the app side', () => {
    const { h } = rig();
    runUntil(h, (s) => s.replaying);
    h.session.skipReplay();
    expect(h.session.replaying).toBe(false);
    // Idempotent: a second skip is a no-op, not a crash.
    h.session.skipReplay();
    expect(h.session.replaying).toBe(false);
  });

  it('plays every big play in a full game, and only after the whistle beat', () => {
    const { h } = rig();
    let replays = 0;
    let armedAt = -1;
    let wasReplaying = false;
    let longest = 0;
    let current = 0;

    for (let i = 0; i < GAME_TICKS; i++) {
      if (h.session.state.phase === GamePhase.GAME_OVER) break;
      const armedBefore = h.session.replayArmed;
      h.session.stepOneTick();
      if (!armedBefore && h.session.replayArmed) armedAt = h.session.state.tick;

      const now = h.session.replaying;
      if (now && !wasReplaying) {
        replays++;
        // The whole PLAY_DEAD pause is spent on the live presentation first.
        expect(h.session.state.tick - armedAt).toBeGreaterThanOrEqual(DEAD_PAUSE_TICKS - 2);
      }
      current = now ? current + 1 : 0;
      longest = Math.max(longest, current);
      wasReplaying = now;
    }

    expect(h.session.state.phase).toBe(GamePhase.GAME_OVER);
    expect(replays).toBeGreaterThan(0);
    // Capped tape: playback can never run away with the game.
    expect(longest).toBeLessThanOrEqual(60 * 8 + 4);
    expect(h.session.replaying).toBe(false);
  });

  it('leaves quiet plays alone', () => {
    const { h } = rig();
    let replays = 0;
    let wasReplaying = false;
    for (let i = 0; i < 60 * 240; i++) {
      if (h.session.state.phase === GamePhase.GAME_OVER) break;
      h.session.stepOneTick();
      if (h.session.replaying && !wasReplaying) replays++;
      wasReplaying = h.session.replaying;
    }
    // Far more plays than replays: this is a highlight reel, not a rerun.
    expect(h.session.state.playLog.length).toBeGreaterThan(replays * 3);
  });
});
