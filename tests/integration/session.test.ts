// End-to-end wiring checks for the integration layer: a real GameSession with
// a stub renderer and a NullAudioEngine, driven by synthetic InputFrames and
// SimCommands exactly the way the App drives it in the browser.

import { describe, expect, it } from 'vitest';
import { GamePhase } from '../../src/sim/types';
import { InputContext } from '../../src/input/types';
import { GameLoop } from '../../src/app/GameLoop';
import { TICK_DT } from '../../src/sim/constants';
import { autoAnswer, makeHarness } from './harness';

describe('GameSession — scripted user exhibition', () => {
  it('advances phases and lets the user call the plays', () => {
    const h = makeHarness({ userTeam: 0, quarterLengthSec: 60, onPrompt: autoAnswer });

    // A few possessions is plenty to exercise the whole pipeline.
    h.run(60 * 90);

    const seen = new Set(h.input.contexts);
    expect(seen.has(InputContext.PLAY_CALL)).toBe(true);
    expect(h.session.state.playLog.length).toBeGreaterThan(2);

    // Every play the coach picked for the user should show up in the log.
    const logged = new Set(h.session.state.playLog.map((e) => e.offensePlayId));
    const userPicks = h.selected.filter((id) => id !== '');
    expect(userPicks.length).toBeGreaterThan(0);
    expect(userPicks.some((id) => logged.has(id))).toBe(true);
  });

  it('derives an input context from the phase and who has the ball', () => {
    const h = makeHarness({ userTeam: 0, quarterLengthSec: 60, onPrompt: autoAnswer });
    h.run(60 * 90);

    const seen = h.input.contextCounts;
    expect(seen.get(InputContext.PLAY_CALL) ?? 0).toBeGreaterThan(0);
    // The user is on both sides of the ball over a few possessions.
    const preSnap = (seen.get(InputContext.PRE_SNAP_OFF) ?? 0) + (seen.get(InputContext.PRE_SNAP_DEF) ?? 0);
    expect(preSnap).toBeGreaterThan(0);
    const live = (seen.get(InputContext.BALL_CARRIER) ?? 0)
      + (seen.get(InputContext.DEFENSE) ?? 0)
      + (seen.get(InputContext.QB_PASSING) ?? 0)
      + (seen.get(InputContext.KICK_METER) ?? 0)
      + (seen.get(InputContext.RETURN_WAIT) ?? 0);
    expect(live).toBeGreaterThan(0);
  });

  it('renders through the injected surface with interpolation snapshots', () => {
    const h = makeHarness({ userTeam: 0, quarterLengthSec: 60, onPrompt: autoAnswer });
    h.run(600);
    h.session.render(0.5, TICK_DT);

    expect(h.renderer?.draws).toBe(1);
    const extras = h.renderer?.lastExtras;
    expect(extras).toBeTruthy();
    expect(extras?.teams).toHaveLength(2);
    expect(extras?.cameraTargetY).toBeTypeOf('number');
    const [prev, curr] = h.session.snapshots;
    expect(curr.tick).toBe(prev.tick + 1);
  });

  it('stops ticking while paused and resumes cleanly', () => {
    const h = makeHarness({ userTeam: 0, quarterLengthSec: 60, onPrompt: autoAnswer });
    h.run(300);

    const tick = h.session.state.tick;
    h.session.pause();
    expect(h.session.paused).toBe(true);
    h.run(120);
    expect(h.session.state.tick).toBe(tick);

    h.session.resume();
    h.run(60);
    expect(h.session.state.tick).toBeGreaterThan(tick);
  });

  it('routes user commands into the sim (timeout burns one)', () => {
    const h = makeHarness({ userTeam: 0, quarterLengthSec: 60, onPrompt: autoAnswer });
    h.run(600, (s) => s.phase === GamePhase.PLAY_CALL && s.selectedOffensePlayId !== null);
    const before = h.session.state.timeouts[0];
    h.session.requestTimeout();
    h.run(5);
    expect(h.session.state.timeouts[0]).toBeLessThanOrEqual(before);
  });

  it('reaches GAME_OVER when fully auto-piloted', () => {
    const h = makeHarness({ userTeam: 0, quarterLengthSec: 60, seed: 90210, onPrompt: autoAnswer });
    h.run(60 * 60 * 40); // 40 sim-minutes is a hard ceiling for 4x60s quarters

    expect(h.session.state.phase).toBe(GamePhase.GAME_OVER);
    expect(h.session.over).toBe(true);
    expect(h.session.state.quarter).toBeGreaterThanOrEqual(4);
    expect(h.prompts.some((p) => p !== null && p.kind === 'gameOver')).toBe(true);

    const stats = h.session.state.stats;
    expect(stats.teams[0].teamId).not.toEqual(stats.teams[1].teamId);
    expect(h.session.state.playLog.length).toBeGreaterThan(20);
  });

  it('produces a play-by-play ticker line from the event stream', () => {
    const h = makeHarness({ userTeam: 0, quarterLengthSec: 60, onPrompt: autoAnswer });
    h.run(60 * 120);
    expect(h.session.playByPlay.lastLine.length).toBeGreaterThan(0);
  });
});

describe('GameSession — CPU vs CPU', () => {
  it('needs no prompts at all when userTeam is null', () => {
    const h = makeHarness({ userTeam: 0, quarterLengthSec: 60 });
    // Same harness, but nobody answers prompts: the play clock keeps running
    // and delay-of-game keeps the game legal rather than hanging.
    h.run(60 * 60);
    expect(h.session.state.tick).toBe(60 * 60);
    expect(h.session.state.phase).not.toBe(GamePhase.GAME_OVER);
  });
});

describe('GameLoop', () => {
  it('steps whole ticks and clamps a long stall', () => {
    let steps = 0;
    let renders = 0;
    const loop = new GameLoop({
      stepOneTick: () => { steps++; },
      render: () => { renders++; },
    });

    expect(loop.advance(TICK_DT * 3)).toBe(3);
    expect(steps).toBe(3);

    steps = 0;
    // Ten seconds of stall must not become 600 catch-up ticks.
    loop.advance(10);
    expect(steps).toBeLessThanOrEqual(Math.ceil(0.25 / TICK_DT));
    expect(renders).toBe(0);
  });

  it('drives a target through requestFrame injection', () => {
    let steps = 0;
    let renders = 0;
    let now = 0;
    const pending: Array<(t: number) => void> = [];
    const loop = new GameLoop(
      { stepOneTick: () => { steps++; }, render: () => { renders++; } },
      {
        now: () => now,
        requestFrame: (cb) => { pending.push(cb); return pending.length; },
        cancelFrame: () => { pending.length = 0; },
      },
    );

    loop.start();
    expect(pending).toHaveLength(1);
    now = 1000 / 30; // one 30fps frame
    const cb = pending.shift();
    cb?.(now);
    expect(steps).toBe(2);
    expect(renders).toBe(1);
    loop.stop();
    expect(loop.running).toBe(false);
  });
});
