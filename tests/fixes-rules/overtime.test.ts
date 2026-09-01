// Regression: "Overtime ends on any dead ball once both teams have possessed".
// Modified sudden death must qualify a SCORE, never an arbitrary whistle.

import { describe, expect, it } from 'vitest';
import { GamePhase, type GameState } from '../../src/sim/types';
import type { ScoreKind } from '../../src/sim/rules/ext';
import { overtimeDecided } from '../../src/sim/rules/scoring';
import { makeScenario } from '../sim-core/helpers';
import { afterDeadOf, runDeadBall } from './helpers';

interface OtCase {
  name: string;
  quarter: number;
  score: [number, number];
  otPossessions: [boolean, boolean];
  kind: ScoreKind;
  want: boolean;
}

const OT_CASES: OtCase[] = [
  {
    name: 'regulation is never decided by the OT rule',
    quarter: 4, score: [10, 7], otPossessions: [true, true], kind: 'fg', want: false,
  },
  {
    name: 'non-scoring dead ball on the opening possession',
    quarter: 5, score: [0, 0], otPossessions: [true, false], kind: null, want: false,
  },
  {
    name: 'non-scoring dead ball after both teams have possessed',
    quarter: 5, score: [3, 0], otPossessions: [true, true], kind: null, want: false,
  },
  {
    name: 'non-scoring dead ball with the answering team behind',
    quarter: 5, score: [3, 0], otPossessions: [true, true], kind: null, want: false,
  },
  {
    name: 'opening-possession field goal can be answered',
    quarter: 5, score: [3, 0], otPossessions: [true, false], kind: 'fg', want: false,
  },
  {
    name: 'touchdown on the opening possession ends it immediately',
    quarter: 5, score: [6, 0], otPossessions: [true, false], kind: 'td', want: true,
  },
  {
    name: 'safety on the opening possession ends it immediately',
    quarter: 5, score: [0, 2], otPossessions: [true, false], kind: 'safety', want: true,
  },
  {
    name: 'two-point score on the opening possession ends it immediately',
    quarter: 5, score: [2, 0], otPossessions: [true, false], kind: 'two', want: true,
  },
  {
    name: 'answering field goal that only ties does not end it',
    quarter: 5, score: [3, 3], otPossessions: [true, true], kind: 'fg', want: false,
  },
  {
    name: 'field goal once both teams have possessed ends it',
    quarter: 5, score: [6, 3], otPossessions: [true, true], kind: 'fg', want: true,
  },
];

function otState(c: OtCase): GameState {
  const s = makeScenario().state;
  s.quarter = c.quarter;
  s.score = [c.score[0], c.score[1]];
  s.otPossessions = [c.otPossessions[0], c.otPossessions[1]];
  return s;
}

describe('overtimeDecided', () => {
  for (const c of OT_CASES) {
    it(c.name, () => {
      expect(overtimeDecided(otState(c), c.kind)).toBe(c.want);
    });
  }
});

describe('overtime played out through PLAY_DEAD', () => {
  // Team 0 opened overtime with a field goal (3-0); team 1 has now snapped, so
  // both otPossessions flags are set.
  const answering = {
    offense: 1 as const,
    ballOnY: 50,
    quarter: 5,
    score: [3, 0] as [number, number],
    otPossessions: [true, true] as [boolean, boolean],
  };

  it('a non-scoring dead ball does not end the game', () => {
    const r = runDeadBall(answering, {
      playType: 'run', deadReason: 'tackle', spotY: 51, yards: -1,
      carrierIdx: 0, possessionAfter: 1,
    });
    expect(afterDeadOf(r.state)).toBe(GamePhase.PLAY_CALL);
    expect(r.state.phase).not.toBe(GamePhase.GAME_OVER);
    expect(r.state.down).toBe(2);
    expect(r.events.some((ev) => ev.type === 'GAME_OVER')).toBe(false);
  });

  it('an answering field goal ties it and sudden death continues', () => {
    const r = runDeadBall(answering, {
      playType: 'fieldGoal', deadReason: 'kickResolved', spotY: 50, yards: 0,
      scoreKind: 'fg', points: 3, possessionAfter: 1,
    });
    expect(r.state.score).toEqual([3, 3]);
    expect(afterDeadOf(r.state)).toBe(GamePhase.PLAY_CALL);
    expect(r.state.nextPlayKind).toBe('kickoff');
  });

  it('an answering touchdown ends the game', () => {
    const r = runDeadBall(answering, {
      playType: 'pass', deadReason: 'touchdown', spotY: 10, yards: 40,
      touchdown: true, scoreKind: 'td', points: 6, possessionAfter: 1,
    });
    expect(r.state.score).toEqual([3, 6]);
    expect(afterDeadOf(r.state)).toBe(GamePhase.GAME_OVER);
  });

  it('the opening-possession field goal itself does not end the game', () => {
    const r = runDeadBall({
      offense: 0, ballOnY: 50, quarter: 5,
      score: [0, 0], otPossessions: [true, false],
    }, {
      playType: 'fieldGoal', deadReason: 'kickResolved', spotY: 50, yards: 0,
      scoreKind: 'fg', points: 3, possessionAfter: 0,
    });
    expect(r.state.score).toEqual([3, 0]);
    expect(afterDeadOf(r.state)).toBe(GamePhase.PLAY_CALL);
  });
});
