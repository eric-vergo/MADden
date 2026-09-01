// Hard count (PRE_SNAP_OFF) and the kicker-relative "wide left/right" label.

import { describe, expect, it } from 'vitest';
import { GameAction, GamePhase } from '../../src/sim/types';
import type { SimEvent } from '../../src/sim/events';
import { preSnapPhase } from '../../src/sim/phases/preSnap';
import { playLivePhase } from '../../src/sim/phases/playLive';
import { ext } from '../../src/sim/rules/ext';
import { CENTER_X } from '../../src/sim/constants';
import { PLAY_TIMING } from '../../src/data/balance';
import { ScriptRng } from '../sim-core/helpers';
import { frame, indexOfRole, pose } from './helpers';

/** A pre-snap state one tick from a user snap, with a scripted penalty stream. */
function preSnapPose(penaltyRoll: number) {
  const sc = pose({ offense: 0, config: { userTeam: 0 } });
  sc.state.phase = GamePhase.PRE_SNAP;
  const e = ext(sc.state);
  e.phaseEnteredTick = sc.state.tick - PLAY_TIMING.settleTicks;
  e.outcome = null;
  sc.rng.penalties = new ScriptRng([penaltyRoll]);
  return sc;
}

function snapWith(sc: ReturnType<typeof preSnapPose>, hardCount: boolean): SimEvent[] {
  const events: SimEvent[] = [];
  if (hardCount) {
    preSnapPhase(sc.state, {
      frame: frame({ pressed: new Set([GameAction.HardCount]) }), commands: [],
    }, sc.rng, events);
    sc.state.tick += 1;
  }
  preSnapPhase(sc.state, {
    frame: frame({ pressed: new Set([GameAction.Snap]) }), commands: [],
  }, sc.rng, events);
  return events;
}

describe('hard count', () => {
  // 0.02 sits above the 1.4%/snap idle jump rate and below the 4% hard-count
  // rate, so the roll flips only because the user called for one.
  it('draws the CPU defense offside at the higher rate', () => {
    const sc = preSnapPose(0.02);
    const events = snapWith(sc, true);
    expect(ext(sc.state).hardCount).toBe(true);
    const flag = events.find((ev) => ev.type === 'PENALTY_ENFORCED');
    expect(flag).toBeDefined();
    expect(flag?.type === 'PENALTY_ENFORCED' ? flag.team : null).toBe(1);
  });

  it('leaves the idle rate alone when no hard count is called', () => {
    const sc = preSnapPose(0.02);
    const events = snapWith(sc, false);
    expect(ext(sc.state).hardCount).toBe(false);
    expect(events.some((ev) => ev.type === 'PENALTY_ENFORCED')).toBe(false);
    expect(events.some((ev) => ev.type === 'SNAP')).toBe(true);
  });
});

describe('field-goal miss side', () => {
  /** Send a placekick across the end line at world x, and read the label. */
  function missSideAt(flipEnds: boolean, x: number): string | null {
    const sc = pose({
      offense: 0,
      ballOnY: flipEnds ? 30 : 90,
      offensePlayId: 'fg-attempt',
      defensePlayId: 'st-fg-block-unit',
      flipEnds,
    });
    const dir = sc.state.attackDir[0];
    const kicker = indexOfRole(sc.play, 'K');
    ext(sc.state).kick = {
      style: 'placekick', kickerIdx: kicker, pressTicks: [0, 0, 0], pressesDone: 3,
      launched: true, spotY: sc.state.ballOnY, fgDistance: 40, auto: true,
    };
    // One tick from crossing the upright plane, above the crossbar.
    const plane = dir === 1 ? 120 : 0;
    sc.play.ball.mode = 'kick';
    sc.play.ball.carrierIdx = null;
    sc.play.ball.pos2 = { x, y: plane - 1 * dir };
    sc.play.ball.z = 6;
    sc.play.ball.vel = { x: 0, y: 120 * dir };
    sc.play.ball.vz = 0;
    const events: SimEvent[] = [];
    playLivePhase(sc.state, { frame: frame(), commands: [] }, sc.rng, events);
    const ev = events.find((v) => v.type === 'FIELD_GOAL_RESULT');
    if (ev === undefined || ev.type !== 'FIELD_GOAL_RESULT') return null;
    expect(ev.good).toBe(false);
    return ev.missSide;
  }

  it('calls a miss at low world x "left" for a team attacking +y', () => {
    expect(missSideAt(false, CENTER_X - 8)).toBe('left');
  });

  it('calls the same world x "right" for a team attacking -y', () => {
    // The kicker turned around: his left hand now points at high world x, and
    // the camera flipped with him.
    expect(missSideAt(true, CENTER_X - 8)).toBe('right');
  });
});
