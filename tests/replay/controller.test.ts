import { describe, expect, it } from 'vitest';
import { GamePhase, type TickSnapshot } from '../../src/sim/types';
import type { RecordedPlay } from '../../src/replay/ReplayBuffer';
import {
  DEFAULT_REPLAY_SPEED, REPLAY_SPEEDS, ReplayController,
  focusYOf, isReplaySpeed, nextReplaySpeed, type ReplaySpeed,
} from '../../src/replay/ReplayController';

function frame(tick: number, y: number): TickSnapshot {
  return {
    tick,
    phase: GamePhase.PLAY_LIVE,
    players: [],
    ball: { x: 26.7, y, z: 0, mode: 'held' },
    lineOfScrimmageY: 40,
    firstDownY: 50,
    kickMeter: null,
  };
}

/** n frames, ball marching one yard per tick from y=40. */
function play(n: number): RecordedPlay {
  const frames: TickSnapshot[] = [];
  for (let i = 0; i < n; i++) frames.push(frame(100 + i, 40 + i));
  return { manifest: { startTick: 100, description: 'test play', bigPlay: true }, frames };
}

/** Ticks of playback needed to finish, capped so a bug cannot hang the run. */
function ticksToDone(rc: ReplayController, cap = 10_000): number {
  let ticks = 0;
  while (!rc.done && ticks < cap) {
    rc.advance(1);
    ticks++;
  }
  return ticks;
}

describe('ReplayController speeds', () => {
  it('offers exactly the four design speeds and defaults to half', () => {
    expect([...REPLAY_SPEEDS]).toEqual([0.25, 0.5, 1, 2]);
    expect(DEFAULT_REPLAY_SPEED).toBe(0.5);
    expect(new ReplayController(play(4)).speed).toBe(0.5);
    expect(isReplaySpeed(0.25)).toBe(true);
    expect(isReplaySpeed(0.75)).toBe(false);
    expect(nextReplaySpeed(0.25)).toBe(0.5);
    expect(nextReplaySpeed(2)).toBe(0.25);
  });

  it('advances the cursor by `speed` frames per tick', () => {
    const cases: Array<[ReplaySpeed, number]> = [[0.25, 36], [0.5, 18], [1, 9], [2, 5]];
    for (const [speed, expected] of cases) {
      const rc = new ReplayController(play(10), speed);
      expect(rc.cursor).toBe(0);
      rc.advance(1);
      expect(rc.cursor).toBeCloseTo(Math.min(9, speed), 9);
      rc.restart();
      // 10 frames = 9 frame-gaps; ceil(9 / speed) ticks to cover them.
      expect(ticksToDone(rc)).toBe(expected);
      expect(rc.remainingTicks).toBe(0);
    }
  });

  it('reports remaining playback ticks at the current speed', () => {
    const rc = new ReplayController(play(10), 0.5);
    expect(rc.remainingTicks).toBe(18);
    rc.advance(4); // cursor 2
    expect(rc.remainingTicks).toBe(14);
    rc.setSpeed(2);
    expect(rc.speed).toBe(2);
    expect(rc.remainingTicks).toBe(4);
  });

  it('clamps at the last frame and reports done', () => {
    const rc = new ReplayController(play(6), 2);
    expect(rc.done).toBe(false);
    expect(rc.advance(100)).toBe(true);
    expect(rc.done).toBe(true);
    expect(rc.cursor).toBe(5);
    expect(rc.progress01).toBe(1);
  });

  it('treats a one-frame play as already done and an empty one as harmless', () => {
    const one = new ReplayController(play(1));
    expect(one.done).toBe(true);
    expect(one.view()?.prev).toBe(one.view()?.curr);
    expect(one.progress01).toBe(1);

    const none = new ReplayController({ manifest: play(1).manifest, frames: [] });
    expect(none.done).toBe(true);
    expect(none.view()).toBeNull();
    expect(none.advance(1)).toBe(true);
    expect(none.focusY()).toBeNull();
  });
});

describe('ReplayController cursor math', () => {
  it('hands the renderer the pair of frames straddling the cursor', () => {
    const rc = new ReplayController(play(10), 0.5);
    rc.advance(1); // cursor 0.5
    const mid = rc.view();
    expect(mid?.prev.tick).toBe(100);
    expect(mid?.curr.tick).toBe(101);
    expect(mid?.alpha).toBeCloseTo(0.5, 9);

    rc.advance(1); // cursor 1.0
    const onFrame = rc.view();
    expect(onFrame?.prev.tick).toBe(101);
    expect(onFrame?.curr.tick).toBe(102);
    expect(onFrame?.alpha).toBe(0);
  });

  it('holds the final frame still at the end (no lerp past the whistle)', () => {
    const rc = new ReplayController(play(4), 1);
    rc.advance(10);
    const view = rc.view();
    expect(view?.prev.tick).toBe(103);
    expect(view?.curr.tick).toBe(103);
    expect(view?.alpha).toBe(0);
  });

  it('scrubs anywhere and clamps out-of-range requests', () => {
    const rc = new ReplayController(play(10));
    rc.scrub(4.25);
    expect(rc.cursor).toBeCloseTo(4.25, 9);
    expect(rc.view()?.alpha).toBeCloseTo(0.25, 9);

    rc.scrub(-12);
    expect(rc.cursor).toBe(0);
    rc.scrub(999);
    expect(rc.cursor).toBe(9);
    expect(rc.done).toBe(true);
    rc.scrub(Number.NaN);
    expect(rc.cursor).toBe(0);

    rc.scrub01(0.5);
    expect(rc.cursor).toBeCloseTo(4.5, 9);
    rc.scrub01(5);
    expect(rc.cursor).toBe(9);
    rc.restart();
    expect(rc.cursor).toBe(0);
    expect(rc.progress01).toBe(0);
  });

  it('follows the ball for the camera', () => {
    const rc = new ReplayController(play(10), 1);
    expect(rc.focusY()).toBe(41); // curr is one frame ahead of prev
    rc.advance(3);
    expect(rc.focusY()).toBe(44);
    expect(rc.manifest.bigPlay).toBe(true);
    expect(rc.frameCount).toBe(10);
    expect(rc.frames).toHaveLength(10);
  });

  it('falls back from ball to carrier to the line of scrimmage', () => {
    const withBall = frame(1, 55);
    expect(focusYOf(withBall)).toBe(55);

    const carrier: TickSnapshot = {
      ...withBall,
      ball: null,
      players: [{
        x: 20, y: 66, facing: 0, anim: 'running', hasBall: true, team: 0, jersey: 7, controlled: false,
      }],
    };
    expect(focusYOf(carrier)).toBe(66);

    const empty: TickSnapshot = { ...withBall, ball: null, players: [] };
    expect(focusYOf(empty)).toBe(40);
    expect(focusYOf({ ...empty, lineOfScrimmageY: null })).toBeNull();
  });
});
