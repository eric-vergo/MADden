// Table-driven rules suites: downs/chains, spotting, clock stoppage, penalties.

import { describe, expect, it } from 'vitest';
import {
  bestProgressY, describeState, enforceYards, freshToGo, isFirstDown, isGoalToGo,
  lineToGainY, spotLabel,
} from '../../src/sim/rules/downs';
import { clockAfterPlay, halfOf, inTwoMinuteWindow, resetPlayClock } from '../../src/sim/rules/clock';
import {
  buildDecision, chooseByEV, evaluate, PENALTY_YARDS, projectPenalty, projectPlay,
} from '../../src/sim/rules/penalties';
import { shouldGoForTwo, overtimeDecided } from '../../src/sim/rules/scoring';
import { ext, type PlayOutcome } from '../../src/sim/rules/ext';
import { snapToHash, toNormalized, toWorld, yardsToGoal, ownYardLineY, oppYardLineY } from '../../src/sim/transform';
import { HASH_LEFT_X, HASH_RIGHT_X, PLAY_CLOCK_SEC, PLAY_CLOCK_SHORT_SEC } from '../../src/sim/constants';
import type { DeadReason, GameState, PenaltyFlag, TeamSide } from '../../src/sim/types';
import { makeScenario } from './helpers';

function baseOutcome(over: Partial<PlayOutcome> = {}): PlayOutcome {
  return {
    playType: 'run', deadReason: 'tackle', spotY: 50, spotX: 26.6, yards: 0,
    carrierIdx: null, passerIdx: null, targetIdx: null, tacklerIdx: null,
    touchdown: false, turnover: null, possessionAfter: 0, changeOfPossession: false,
    safety: false, scoreKind: null, points: 0, nextKind: null, completed: false,
    fgDistance: 0, ...over,
  };
}

describe('transform', () => {
  it('mirrors both axes when the offense attacks -y', () => {
    const spot = { x: 26.6, y: 50 };
    expect(toWorld({ x: 3, y: 5 }, 1, spot)).toEqual({ x: 29.6, y: 55 });
    expect(toWorld({ x: 3, y: 5 }, -1, spot)).toEqual({ x: 23.6, y: 45 });
  });

  it('round-trips through the normalized frame', () => {
    const spot = { x: 20, y: 70 };
    for (const dir of [1, -1] as const) {
      const w = toWorld({ x: -4.5, y: 12 }, dir, spot);
      const n = toNormalized(w, dir, spot);
      expect(n.x).toBeCloseTo(-4.5, 9);
      expect(n.y).toBeCloseTo(12, 9);
    }
  });

  it('snaps lateral spots to the nearest hash', () => {
    expect(snapToHash(2)).toBeCloseTo(HASH_LEFT_X);
    expect(snapToHash(50)).toBeCloseTo(HASH_RIGHT_X);
    expect(snapToHash(26.6)).toBeCloseTo(26.6);
  });

  it('places yard lines relative to the attacking direction', () => {
    expect(ownYardLineY(35, 1)).toBe(45);
    expect(ownYardLineY(35, -1)).toBe(75);
    expect(oppYardLineY(15, 1)).toBe(95);
    expect(oppYardLineY(15, -1)).toBe(25);
    expect(yardsToGoal(95, 1)).toBe(15);
    expect(yardsToGoal(25, -1)).toBe(15);
  });
});

describe('downs and chains', () => {
  const rows: Array<[string, number, number, 1 | -1, number]> = [
    ['own 25, +y', 35, 10, 1, 45],
    ['own 25, -y', 85, 10, -1, 75],
    ['goal to go caps at the goal line', 105, 10, 1, 110],
    ['goal to go caps the other way', 15, 10, -1, 10],
  ];
  for (const [name, ballOnY, toGo, dir, expected] of rows) {
    it(`line to gain: ${name}`, () => {
      expect(lineToGainY(ballOnY, toGo, dir)).toBe(expected);
    });
  }

  it('recognises a first down at or past the sticks', () => {
    expect(isFirstDown(45, 45, 1)).toBe(true);
    expect(isFirstDown(44.9, 45, 1)).toBe(false);
    expect(isFirstDown(75, 75, -1)).toBe(true);
    expect(isFirstDown(75.1, 75, -1)).toBe(false);
  });

  it('gives a fresh ten, or goal-to-go inside the ten', () => {
    expect(freshToGo(50, 1)).toBe(10);
    expect(freshToGo(105, 1)).toBe(5);
    expect(freshToGo(15, -1)).toBe(5);
    expect(isGoalToGo(105, 5, 1)).toBe(true);
    expect(isGoalToGo(50, 10, 1)).toBe(false);
  });

  it('takes the high-water mark inside the progress window', () => {
    expect(bestProgressY([40, 46, 43, 41], 1, 41)).toBe(46);
    expect(bestProgressY([80, 74, 77, 79], -1, 79)).toBe(74);
    expect(bestProgressY([], 1, 33)).toBe(33);
  });

  it('labels spots by side of the field', () => {
    expect(spotLabel(60, 'HOM', 'AWY')).toBe('MID 50');
    expect(spotLabel(30, 'HOM', 'AWY')).toBe('HOM 20');
    expect(spotLabel(90, 'HOM', 'AWY')).toBe('AWY 20');
    expect(describeState(3, 7, 40, 1, 'HOM', 'AWY')).toBe('3rd & 7 at HOM 30');
    expect(describeState(1, 5, 105, 1, 'HOM', 'AWY')).toBe('1st & Goal at AWY 5');
  });
});

describe('penalty enforcement spots', () => {
  it('half-the-distance caps a penalty near the goal line', () => {
    // 10-yard holding from the offense's own 4 -> half the distance (2 yards).
    expect(enforceYards(14, 10, 1, true)).toBeCloseTo(12);
    // Full yardage when there is room.
    expect(enforceYards(50, 10, 1, true)).toBeCloseTo(40);
    // Against the defense the ball moves toward the goal being attacked.
    expect(enforceYards(50, 5, 1, false)).toBeCloseTo(55);
    // Half the distance to the opponent's goal when close.
    expect(enforceYards(108, 5, 1, false)).toBeCloseTo(109);
  });

  it('every penalty kind carries its yardage', () => {
    expect(PENALTY_YARDS.falseStart).toBe(5);
    expect(PENALTY_YARDS.holding).toBe(10);
    expect(PENALTY_YARDS.dpi).toBe(0); // spot foul
  });

  it('offensive holding replays the down 10 yards back', () => {
    const sc = makeScenario({ ballOnY: 50, down: 2, toGo: 7 });
    const flag: PenaltyFlag = {
      kind: 'holding', team: 0, playerIdx: 6, spotY: 48, preSnap: false,
    };
    const out = projectPenalty(sc.state, flag, baseOutcome({ spotY: 56, yards: 6 }));
    expect(out.ballOnY).toBeCloseTo(40);
    expect(out.down).toBe(2);
    expect(out.toGo).toBeCloseTo(17);
    expect(out.firstDown).toBe(false);
    expect(out.possession).toBe(0);
  });

  it('a defensive five-yarder that reaches the sticks is a first down', () => {
    const sc = makeScenario({ ballOnY: 50, down: 3, toGo: 4 });
    const flag: PenaltyFlag = {
      kind: 'offside', team: 1, playerIdx: 12, spotY: 50, preSnap: false,
    };
    const out = projectPenalty(sc.state, flag, baseOutcome({ spotY: 51 }));
    expect(out.ballOnY).toBeCloseTo(55);
    expect(out.down).toBe(1);
    expect(out.firstDown).toBe(true);
    expect(out.toGo).toBe(10);
  });

  it('DPI is a spot foul with an automatic first down', () => {
    const sc = makeScenario({ ballOnY: 40, down: 3, toGo: 12 });
    const flag: PenaltyFlag = { kind: 'dpi', team: 1, playerIdx: 15, spotY: 68, preSnap: false };
    const out = projectPenalty(sc.state, flag, baseOutcome({ spotY: 40, yards: 0 }));
    expect(out.ballOnY).toBeCloseTo(68);
    expect(out.down).toBe(1);
    expect(out.firstDown).toBe(true);
  });

  it('projects the play-stands branch including turnover on downs', () => {
    const sc = makeScenario({ ballOnY: 50, down: 4, toGo: 8 });
    const out = projectPlay(sc.state, baseOutcome({ spotY: 54, yards: 4, possessionAfter: 0 }));
    expect(out.possession).toBe(1);
    expect(out.down).toBe(1);
    expect(out.ballOnY).toBe(54);
  });

  it('EV comparator prefers the better branch for the deciding team', () => {
    const sc = makeScenario({ ballOnY: 50, down: 3, toGo: 4 });
    const flag: PenaltyFlag = { kind: 'offside', team: 1, playerIdx: 12, spotY: 50, preSnap: false };
    // Play gained nothing; the five-yard penalty is a free first down.
    const decision = buildDecision(sc.state, flag, baseOutcome({ spotY: 50, yards: 0 }));
    expect(decision.decidingTeam).toBe(0);
    expect(chooseByEV(sc.state, decision)).toBe('accept');

    // Play gained 30; declining is obviously better.
    const decision2 = buildDecision(sc.state, flag, baseOutcome({ spotY: 80, yards: 30 }));
    expect(chooseByEV(sc.state, decision2)).toBe('decline');
    expect(evaluate(sc.state, decision2.declineOutcome, 0))
      .toBeGreaterThan(evaluate(sc.state, decision2.acceptOutcome, 0));
  });

  it('the offending team never gets to decide', () => {
    const sc = makeScenario({ ballOnY: 50 });
    const flag: PenaltyFlag = { kind: 'holding', team: 0, playerIdx: 6, spotY: 50, preSnap: false };
    expect(buildDecision(sc.state, flag, baseOutcome()).decidingTeam).toBe(1);
  });
});

describe('clock stoppage matrix', () => {
  function withState(over: Partial<GameState> = {}): GameState {
    const sc = makeScenario();
    Object.assign(sc.state, over);
    return sc.state;
  }

  const rows: Array<[DeadReason, boolean, boolean]> = [
    ['tackle', false, false],
    ['sack', false, false],
    ['runnerDown', false, false],
    ['kneel', false, false],
    ['incomplete', true, false],
    ['spike', true, false],
    ['touchback', true, true],
    ['fairCatch', true, true],
    ['kickResolved', true, true],
    ['penaltyDead', true, true],
  ];
  for (const [reason, stop, admin] of rows) {
    it(`${reason} -> stop=${stop}`, () => {
      const s = withState();
      const r = clockAfterPlay(s, baseOutcome({ deadReason: reason }));
      expect(r.stop).toBe(stop);
      expect(r.admin).toBe(admin);
    });
  }

  it('out of bounds only stops the clock inside two minutes', () => {
    const outside = withState({ quarter: 2, clockSec: 400 });
    expect(clockAfterPlay(outside, baseOutcome({ deadReason: 'outOfBounds' })).stop).toBe(false);
    const inside = withState({ quarter: 4, clockSec: 90 });
    expect(clockAfterPlay(inside, baseOutcome({ deadReason: 'outOfBounds' })).stop).toBe(true);
    expect(inTwoMinuteWindow(inside)).toBe(true);
    expect(inTwoMinuteWindow(outside)).toBe(false);
  });

  it('scores and turnovers always stop the clock', () => {
    const s = withState();
    expect(clockAfterPlay(s, baseOutcome({ touchdown: true, scoreKind: 'td' })).stop).toBe(true);
    expect(clockAfterPlay(s, baseOutcome({ turnover: 'int' })).stop).toBe(true);
    expect(clockAfterPlay(s, baseOutcome({ safety: true, scoreKind: 'safety' })).stop).toBe(true);
  });

  it('resets the play clock to 40 or 25', () => {
    const s = withState();
    resetPlayClock(s, false);
    expect(s.playClockSec).toBe(PLAY_CLOCK_SEC);
    resetPlayClock(s, true);
    expect(s.playClockSec).toBe(PLAY_CLOCK_SHORT_SEC);
  });

  it('maps quarters to halves; overtime has none', () => {
    expect(halfOf(1)).toBe(1);
    expect(halfOf(2)).toBe(1);
    expect(halfOf(3)).toBe(2);
    expect(halfOf(4)).toBe(2);
    expect(halfOf(5)).toBeNull();
  });
});

describe('conversion and overtime rules', () => {
  it('classic two-point chart only fires late', () => {
    expect(shouldGoForTwo(-2, 4)).toBe(true);
    expect(shouldGoForTwo(-2, 2)).toBe(false);
    expect(shouldGoForTwo(6, 4)).toBe(false);
    expect(shouldGoForTwo(1, 5)).toBe(true);
  });

  it('modified sudden death needs both possessions except on a touchdown', () => {
    const sc = makeScenario();
    const s = sc.state;
    s.quarter = 5;
    s.score = [7, 0];
    s.otPossessions = [true, false];
    expect(overtimeDecided(s, 'fg')).toBe(false);
    expect(overtimeDecided(s, 'td')).toBe(true);
    s.otPossessions = [true, true];
    expect(overtimeDecided(s, 'fg')).toBe(true);
    s.score = [7, 7];
    expect(overtimeDecided(s, 'fg')).toBe(false);
  });
});

describe('ext bookkeeping', () => {
  it('keeps a lateral ball spot the frozen GameState has no field for', () => {
    const sc = makeScenario();
    const e = ext(sc.state);
    expect(e.ballOnX).toBeGreaterThan(0);
    expect(e.playOffense).toBe(0 as TeamSide);
  });
});
