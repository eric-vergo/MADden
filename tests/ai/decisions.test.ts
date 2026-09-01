// Carrier and special-teams DECISIONS. S1's action bodies are stubs, so these
// assert which action was called with what, not the resolved outcome.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  throwPass: vi.fn(),
  throwAway: vi.fn(),
  attemptTackle: vi.fn(),
  tryCarrierMove: vi.fn(),
  pressKickMeter: vi.fn(),
  callFairCatch: vi.fn(),
  maybeHoldingOnShed: vi.fn(),
}));
vi.mock('../../src/sim/actions', () => actions);

const { GAP_ORDER } = await import('../../src/sim/ai/frame');
const { updateCarrier, wantsInbounds, wantsSideline } = await import('../../src/sim/ai/carrier');
const {
  initKicker, updateKicker, updateReturner, MIND_RETURN_DECISION,
} = await import('../../src/sim/ai/specialTeams');
const { makeScenario } = await import('./helpers');

beforeEach(() => {
  actions.tryCarrierMove.mockClear();
  actions.pressKickMeter.mockClear();
  actions.callFairCatch.mockClear();
});

describe('CPU ball carrier', () => {
  it('bounces once to a cleaner gap when the aim gap is clogged', () => {
    const s = makeScenario({
      los: 60,
      difficulty: 'allPro',
      seed: 8,
      players: [
        {
          slot: 2, role: 'RB', pos: 'RB', x: 27.5, y: 58, hasBall: true,
          assignment: {
            kind: 'carry', mesh: 'handoff', meshTick: 0, aimGap: 'A-right',
            path: [],
          },
        },
        // Two free defenders sitting in the A gap, nothing in the B gap.
        { slot: 11, role: 'DT1', pos: 'DL', team: 1, x: 27.5, y: 61, assignment: { kind: 'runFit', gap: 'A-right' } },
        { slot: 12, role: 'MLB1', pos: 'LB', team: 1, x: 27.3, y: 63, assignment: { kind: 'runFit', gap: 'A-right' } },
      ],
    });
    const rb = s.play.players[2]!;
    s.play.ball.carrierIdx = 2;
    for (let t = 0; t < 24; t++) {
      updateCarrier(s.ctx(), 2);
      s.tick();
    }
    const gap = GAP_ORDER[rb.mind['crGap'] as number];
    expect(gap).toBe('B-right');
    expect(rb.mind['crBounced']).toBe(1);
  });

  it('reads the clock for sideline use', () => {
    const trailing = makeScenario({
      los: 60,
      players: [{ slot: 2, role: 'RB', pos: 'RB', x: 26, y: 62, hasBall: true, assignment: { kind: 'carrierAI' } }],
    });
    trailing.state.quarter = 4;
    trailing.state.clockSec = 90;
    trailing.state.score = [10, 17];
    trailing.state.timeouts = [0, 3];
    expect(wantsSideline(trailing.ctx())).toBe(true);
    expect(wantsInbounds(trailing.ctx())).toBe(false);

    const leading = makeScenario({
      los: 60,
      players: [{ slot: 2, role: 'RB', pos: 'RB', x: 26, y: 62, hasBall: true, assignment: { kind: 'carrierAI' } }],
    });
    leading.state.quarter = 4;
    leading.state.clockSec = 200;
    leading.state.score = [24, 17];
    expect(wantsInbounds(leading.ctx())).toBe(true);
    expect(wantsSideline(leading.ctx())).toBe(false);
  });

  it('slides the scrambling QB once the gain is secured', () => {
    const s = makeScenario({
      los: 60,
      firstDownY: 70,
      players: [
        {
          slot: 0, role: 'QB', pos: 'QB', x: 26, y: 72, hasBall: true,
          assignment: { kind: 'qb', drop: { type: 'gunSet', depth: 5 } },
        },
        { slot: 11, role: 'MLB1', pos: 'LB', team: 1, x: 27.5, y: 73, assignment: { kind: 'pursuit' } },
      ],
    });
    s.play.ball.carrierIdx = 0;
    s.play.players[11]!.vel = { x: -4, y: -2 };
    updateCarrier(s.ctx(), 0);
    expect(actions.tryCarrierMove).toHaveBeenCalledTimes(1);
    expect(actions.tryCarrierMove.mock.calls[0]![2]).toBe('slide');
  });

  it('uses a special move on an imminent tackle', () => {
    const s = makeScenario({
      los: 60,
      difficulty: 'allMadden', // cpuCarrierMoveChance 0.7
      seed: 3,
      players: [
        {
          slot: 2, role: 'RB', pos: 'RB', x: 26, y: 70, hasBall: true,
          ratings: { elu: 92, str: 60 },
          assignment: { kind: 'carrierAI' },
        },
        { slot: 11, role: 'CB1', pos: 'CB', team: 1, x: 27.6, y: 71, assignment: { kind: 'pursuit' } },
      ],
    });
    s.play.ball.carrierIdx = 2;
    const rb = s.play.players[2]!;
    rb.vel = { x: 0, y: 6 };
    s.play.players[11]!.vel = { x: -5, y: -5 };
    let used = 0;
    for (let t = 0; t < 400; t++) {
      // Re-arm the cooldown so this exercises the roll, not the timer.
      rb.mind['crMoveTick'] = -999;
      rb.pos2 = { x: 26, y: 70 };
      rb.vel = { x: 0, y: 6 };
      updateCarrier(s.ctx(), 2);
      s.tick();
    }
    used = actions.tryCarrierMove.mock.calls.length;
    expect(used).toBeGreaterThan(200);
    expect(used).toBeLessThan(400);
    const moves = new Set(actions.tryCarrierMove.mock.calls.map((c) => c[2]));
    expect(moves.has('slide')).toBe(false);
  });
});

describe('special teams decisions', () => {
  it('walks the CPU kicker through all three meter presses', () => {
    const s = makeScenario({
      los: 45,
      players: [
        {
          slot: 0, role: 'K', pos: 'K', x: 26.6, y: 39,
          ratings: { kpw: 85, kac: 85 },
          assignment: { kind: 'kick', style: 'kickoff' },
        },
      ],
    });
    // Stand in for S1's meter bookkeeping.
    actions.pressKickMeter.mockImplementation((state: { play: { kickMeter: Record<string, unknown> } }) => {
      const m = state.play.kickMeter;
      if (!m['active']) { m['active'] = true; m['startTick'] = s.state.tick; return; }
      if (m['powerLockTick'] === null) { m['powerLockTick'] = s.state.tick; return; }
      if (m['accuracyLockTick'] === null) m['accuracyLockTick'] = s.state.tick;
    });

    initKicker(s.ctx(), 0);
    for (let t = 0; t < 200; t++) {
      updateKicker(s.ctx(), 0);
      s.tick();
    }
    expect(actions.pressKickMeter).toHaveBeenCalledTimes(3);
    expect(s.play.kickMeter.powerLockTick).not.toBeNull();
    expect(s.play.kickMeter.accuracyLockTick).not.toBeNull();
    // Full-power kickoff: the power press lands near the top of the meter.
    const fill = (s.play.kickMeter.powerLockTick as number) - s.play.kickMeter.startTick;
    expect(fill).toBeGreaterThan(35);
  });

  it('fair catches when the gunners arrive with the ball', () => {
    const s = makeScenario({
      los: 30,
      players: [
        { slot: 1, role: 'WR1', pos: 'WR', x: 26, y: 62, ratings: { spd: 92, acc: 92 }, assignment: { kind: 'coverLane', laneIndex: 0 } },
        { slot: 11, role: 'PR', pos: 'WR', team: 1, x: 26.6, y: 68, assignment: { kind: 'returner' } },
      ],
    });
    s.play.ball.mode = 'punt';
    s.play.ball.pos2 = { x: 26.6, y: 60 };
    s.play.ball.z = 6;
    s.play.ball.vz = -4;
    s.play.ball.vel = { x: 0, y: 8 };

    updateReturner(s.ctx(), 11);
    expect(actions.callFairCatch).toHaveBeenCalledTimes(1);
    expect(actions.callFairCatch.mock.calls[0]![1]).toBe(11);
    expect(s.play.players[11]!.mind[MIND_RETURN_DECISION]).toBe(1);
  });

  it('does not fair catch with the coverage still 30 yards away', () => {
    const s = makeScenario({
      los: 30,
      players: [
        { slot: 1, role: 'WR1', pos: 'WR', x: 26, y: 34, assignment: { kind: 'coverLane', laneIndex: 0 } },
        { slot: 11, role: 'PR', pos: 'WR', team: 1, x: 26.6, y: 68, assignment: { kind: 'returner' } },
      ],
    });
    s.play.ball.mode = 'punt';
    s.play.ball.pos2 = { x: 26.6, y: 60 };
    s.play.ball.z = 6;
    s.play.ball.vz = -4;
    s.play.ball.vel = { x: 0, y: 8 };

    updateReturner(s.ctx(), 11);
    expect(actions.callFairCatch).not.toHaveBeenCalled();
  });

  it('takes the touchback on a kick into the end zone', () => {
    const s = makeScenario({
      los: 45,
      players: [
        { slot: 11, role: 'KR', pos: 'WR', team: 1, x: 26.6, y: 108, assignment: { kind: 'returner' } },
      ],
    });
    s.play.ball.mode = 'kick';
    s.play.ball.pos2 = { x: 26.6, y: 100 };
    s.play.ball.z = 5;
    s.play.ball.vz = -2;
    s.play.ball.vel = { x: 0, y: 20 };

    updateReturner(s.ctx(), 11);
    expect(s.play.players[11]!.mind[MIND_RETURN_DECISION]).toBe(2);
    expect(actions.callFairCatch).not.toHaveBeenCalled();
  });
});
