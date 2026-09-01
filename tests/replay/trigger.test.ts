// The replay trigger policy, driven with constructed event batches in the same
// order GameSim emits them (PLAY_RESULT first, BIG_PLAY right behind it).

import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/events';
import type { DeadReason } from '../../src/sim/types';
import {
  REPLAY_POLICY, ReplayTrigger, gameSecondsSince, isLateInHalf, shouldReplay,
  type PlayResultEvent, type ReplayClock,
} from '../../src/replay/trigger';

interface ResultSpec {
  playType?: PlayResultEvent['playType'];
  yards?: number;
  touchdown?: boolean;
  turnover?: PlayResultEvent['turnover'];
  deadReason?: DeadReason;
}

function result(spec: ResultSpec = {}): PlayResultEvent {
  return {
    type: 'PLAY_RESULT',
    tick: 1000,
    offense: 0,
    playType: spec.playType ?? 'run',
    yards: spec.yards ?? 3,
    carrierIdx: 1,
    passerIdx: null,
    targetIdx: null,
    tacklerIdx: 14,
    touchdown: spec.touchdown ?? false,
    turnover: spec.turnover ?? null,
    deadReason: spec.deadReason ?? 'tackle',
  };
}

/** One tick's batch, in sim order: the result, then the sim's BIG_PLAY flag. */
function batch(spec: ResultSpec = {}, big = true): SimEvent[] {
  const events: SimEvent[] = [result(spec)];
  if (big) events.push({ type: 'BIG_PLAY', tick: 1000, reason: 'longGain' });
  return events;
}

const MIDGAME: ReplayClock = { quarter: 1, clockSec: 500 };

function fires(events: SimEvent[], clock: ReplayClock = MIDGAME): boolean {
  return new ReplayTrigger().offer(events, clock);
}

describe('replay trigger — what earns a replay', () => {
  it('fires on a touchdown', () => {
    expect(fires(batch({ touchdown: true, yards: 6 }))).toBe(true);
  });

  it('fires on an interception or a fumble, but not on downs', () => {
    expect(fires(batch({ playType: 'pass', turnover: 'int', yards: 0 }))).toBe(true);
    expect(fires(batch({ turnover: 'fumble', yards: 2 }))).toBe(true);
    expect(fires(batch({ turnover: 'downs', yards: 2 }))).toBe(false);
  });

  it('fires on a 40+ yard gain from scrimmage but not a 20-yarder', () => {
    expect(fires(batch({ playType: 'pass', yards: REPLAY_POLICY.minGainYards }))).toBe(true);
    expect(fires(batch({ playType: 'scramble', yards: 62 }))).toBe(true);
    expect(fires(batch({ playType: 'run', yards: 20 }))).toBe(false);
    expect(fires(batch({ playType: 'run', yards: 39 }))).toBe(false);
  });

  it('ignores kick distance — a 55-yard punt is not a 55-yard gain', () => {
    expect(fires(batch({ playType: 'punt', yards: 55 }))).toBe(false);
    expect(fires(batch({ playType: 'kickoff', yards: 65 }))).toBe(false);
    expect(fires(batch({ playType: 'fieldGoal', yards: 48 }))).toBe(false);
    // …but a kick returned all the way still gets shown again.
    expect(fires(batch({ playType: 'kickoff', yards: 65, touchdown: true }))).toBe(true);
  });

  it('never replays a kneel, a spike, or a penalty-only snap', () => {
    expect(fires(batch({ playType: 'kneel', yards: -1 }))).toBe(false);
    // Even if something upstream flagged it, the kneel stays off the air.
    expect(fires(batch({ playType: 'kneel', yards: 45, touchdown: true }))).toBe(false);
    expect(fires(batch({ playType: 'spike', yards: 0 }))).toBe(false);
    expect(fires(batch({ playType: 'penaltyOnly', yards: 0, touchdown: true }))).toBe(false);
  });

  it('needs the sim to have flagged the play as a BIG_PLAY', () => {
    expect(fires(batch({ touchdown: true }, false))).toBe(false);
  });

  it('does nothing on a tick without a play result', () => {
    const trigger = new ReplayTrigger();
    expect(trigger.offer([{ type: 'SNAP', tick: 10 }], MIDGAME)).toBe(false);
    expect(trigger.offer([{ type: 'BIG_PLAY', tick: 11, reason: 'sack' }], MIDGAME)).toBe(false);
    // The flag carries to the result that lands with it, not to a later play.
    expect(trigger.offer([result({ touchdown: true })], MIDGAME)).toBe(false);
  });
});

describe('replay trigger — suppression', () => {
  it('will not run two replays inside 20 game-seconds', () => {
    const trigger = new ReplayTrigger();
    const first: ReplayClock = { quarter: 3, clockSec: 400 };
    expect(trigger.offer(batch({ touchdown: true }), first)).toBe(true);
    trigger.arm(first);
    expect(trigger.lastReplayAt).toEqual(first);

    expect(trigger.offer(batch({ turnover: 'int' }), { quarter: 3, clockSec: 385 })).toBe(false);
    expect(trigger.offer(batch({ turnover: 'int' }), { quarter: 3, clockSec: 381 })).toBe(false);
    expect(trigger.offer(batch({ turnover: 'int' }), { quarter: 3, clockSec: 380 })).toBe(true);
  });

  it('clears the cooldown across a quarter change', () => {
    const trigger = new ReplayTrigger();
    trigger.arm({ quarter: 1, clockSec: 5 });
    expect(trigger.offer(batch({ touchdown: true }), { quarter: 2, clockSec: 600 })).toBe(true);
    expect(gameSecondsSince({ quarter: 1, clockSec: 5 }, { quarter: 2, clockSec: 600 })).toBe(Infinity);
  });

  it('goes quiet in the last two minutes of a half — except for touchdowns', () => {
    const late: ReplayClock = { quarter: 2, clockSec: 90 };
    expect(fires(batch({ turnover: 'int' }), late)).toBe(false);
    expect(fires(batch({ playType: 'pass', yards: 55 }), late)).toBe(false);
    expect(fires(batch({ touchdown: true }), late)).toBe(true);

    // Q4 counts too; Q1 and Q3 do not (they run into a quarter break).
    expect(fires(batch({ turnover: 'int' }), { quarter: 4, clockSec: 30 })).toBe(false);
    expect(fires(batch({ turnover: 'int' }), { quarter: 1, clockSec: 30 })).toBe(true);
    expect(fires(batch({ turnover: 'int' }), { quarter: 3, clockSec: 30 })).toBe(true);
    // Overtime ends a "half" as well.
    expect(fires(batch({ turnover: 'int' }), { quarter: 5, clockSec: 60 })).toBe(false);

    expect(isLateInHalf({ quarter: 2, clockSec: REPLAY_POLICY.lateHalfSec })).toBe(true);
    expect(isLateInHalf({ quarter: 2, clockSec: REPLAY_POLICY.lateHalfSec + 1 })).toBe(false);
  });

  it('reset forgets the cooldown', () => {
    const trigger = new ReplayTrigger();
    trigger.arm({ quarter: 1, clockSec: 100 });
    trigger.reset();
    expect(trigger.lastReplayAt).toBeNull();
    expect(trigger.offer(batch({ touchdown: true }), { quarter: 1, clockSec: 95 })).toBe(true);
  });
});

describe('shouldReplay is a pure predicate', () => {
  it('answers the same question without any trigger state', () => {
    expect(shouldReplay({
      bigPlay: true,
      result: result({ touchdown: true }),
      clock: MIDGAME,
      lastReplayAt: null,
    })).toBe(true);
    expect(shouldReplay({
      bigPlay: true,
      result: result({ touchdown: true }),
      clock: MIDGAME,
      lastReplayAt: { quarter: 1, clockSec: 505 },
    })).toBe(false);
  });
});
