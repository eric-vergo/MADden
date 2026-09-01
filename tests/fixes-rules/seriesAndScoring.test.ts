// Regressions for three accounting rules resolved in PLAY_DEAD:
//  - an interception fumbled back to the passing team starts a fresh series;
//  - a returned two-point try scores for the DEFENDING team;
//  - a third-down touchdown is a third-down conversion.

import { describe, expect, it } from 'vitest';
import { GamePhase, type TeamSide } from '../../src/sim/types';
import { findOffensePlay } from '../sim-core/helpers';
import { afterDeadOf, runDeadBall } from './helpers';

describe('possession that changes twice on one play', () => {
  it('an interception fumbled back to the passing team is a fresh 1st and 10', () => {
    // Team 0, 1st & 10 from its own 25 (y=35, line to gain y=45). Picked off at
    // the 25, the interceptor is stripped and team 0 recovers at its own 22.
    const r = runDeadBall(
      { offense: 0, ballOnY: 35, down: 1, toGo: 10 },
      {
        playType: 'pass', deadReason: 'fumbleDead', spotY: 32, yards: -3,
        turnover: 'int', changeOfPossession: false, possessionAfter: 0, carrierIdx: 3,
      },
    );
    expect(r.state.possession).toBe(0 as TeamSide);
    expect(r.state.ballOnY).toBe(32);
    expect(r.state.down).toBe(1);
    expect(r.state.toGo).toBe(10);
  });

  it('and is not charged to the recovering team as a turnover', () => {
    const r = runDeadBall(
      { offense: 0, ballOnY: 35, down: 1, toGo: 10 },
      {
        playType: 'pass', deadReason: 'fumbleDead', spotY: 32, yards: -3,
        turnover: 'int', changeOfPossession: false, possessionAfter: 0, carrierIdx: 3,
      },
    );
    expect(r.outcome.turnover).toBeNull();
    expect(r.state.stats.teams[0].turnovers).toBe(0);
    expect(r.state.playLog.at(-1)?.turnover).toBe(false);
  });

  it('a fumble the defense recovers and the offense strips back is a fresh series too', () => {
    const r = runDeadBall(
      { offense: 0, ballOnY: 35, down: 3, toGo: 8 },
      {
        playType: 'run', deadReason: 'fumbleDead', spotY: 38, yards: 3,
        turnover: 'fumble', changeOfPossession: false, possessionAfter: 0, carrierIdx: 1,
      },
    );
    expect(r.state.possession).toBe(0 as TeamSide);
    expect(r.state.down).toBe(1);
    expect(r.outcome.turnover).toBeNull();
  });

  it('an interception the defense keeps is still a turnover', () => {
    const r = runDeadBall(
      { offense: 0, ballOnY: 35, down: 1, toGo: 10 },
      {
        playType: 'pass', deadReason: 'tackle', spotY: 40, yards: 5,
        turnover: 'int', changeOfPossession: true, possessionAfter: 1, carrierIdx: 16,
      },
    );
    expect(r.state.possession).toBe(1 as TeamSide);
    expect(r.state.down).toBe(1);
    expect(r.outcome.turnover).toBe('int');
    expect(r.state.stats.teams[0].turnovers).toBe(1);
  });
});

describe('two-point conversions', () => {
  const twoPoint = findOffensePlay((p) => p.type === 'twoPoint');

  it('a successful try scores for the team that attempted it', () => {
    const r = runDeadBall(
      { offense: 0, ballOnY: 108, offensePlay: twoPoint, score: [6, 0] },
      {
        playType: 'twoPoint', deadReason: 'touchdown', spotY: 110, yards: 2,
        scoreKind: 'two', points: 2, possessionAfter: 0, changeOfPossession: false,
      },
    );
    expect(r.state.score).toEqual([8, 0]);
  });

  it('a returned try scores for the defending team', () => {
    const r = runDeadBall(
      { offense: 0, ballOnY: 108, offensePlay: twoPoint, score: [6, 0] },
      {
        playType: 'twoPoint', deadReason: 'touchdown', spotY: 10, yards: 0,
        scoreKind: 'two', points: 2, possessionAfter: 1, changeOfPossession: true,
      },
    );
    expect(r.state.score).toEqual([6, 2]);
    // The team that scored the touchdown still kicks off.
    expect(r.state.possession).toBe(0 as TeamSide);
    expect(r.state.nextPlayKind).toBe('kickoff');
  });

  it('a blocked extra point returned to the other end is worth two, not six', () => {
    const extraPoint = findOffensePlay((p) => p.type === 'extraPoint');
    const r = runDeadBall(
      { offense: 0, ballOnY: 95, offensePlay: extraPoint, score: [6, 0] },
      {
        // PLAY_LIVE calls any carrier reaching his attack goal a touchdown
        // unless the play is a twoPoint; on a try it is a conversion.
        playType: 'extraPoint', deadReason: 'touchdown', spotY: 10, yards: 0,
        touchdown: true, scoreKind: 'td', points: 6,
        possessionAfter: 1, changeOfPossession: true,
      },
    );
    expect(r.state.score).toEqual([6, 2]);
    expect(r.outcome.touchdown).toBe(false);
    expect(r.state.nextPlayKind).toBe('kickoff');
    expect(afterDeadOf(r.state)).toBe(GamePhase.PLAY_CALL);
    expect(r.events.some(
      (ev) => ev.type === 'TWO_POINT_RESULT' && ev.team === 1 && ev.good,
    )).toBe(true);
  });
});

describe('third-down bookkeeping', () => {
  interface Case {
    name: string;
    down: number;
    patch: Parameters<typeof runDeadBall>[1];
    att: number;
    conv: number;
  }

  const CASES: Case[] = [
    {
      name: 'third down converted by yardage',
      down: 3,
      patch: { playType: 'run', spotY: 62, yards: 12, carrierIdx: 1 },
      att: 1, conv: 1,
    },
    {
      name: 'third down stopped short',
      down: 3,
      patch: { playType: 'run', spotY: 52, yards: 2, carrierIdx: 1 },
      att: 1, conv: 0,
    },
    {
      name: 'third-down touchdown is a conversion',
      down: 3,
      patch: {
        playType: 'pass', deadReason: 'touchdown', spotY: 110, yards: 60,
        touchdown: true, scoreKind: 'td', points: 6, possessionAfter: 0, carrierIdx: 3,
      },
      att: 1, conv: 1,
    },
    {
      name: 'third-down pick six is not a conversion',
      down: 3,
      patch: {
        playType: 'pass', deadReason: 'touchdown', spotY: 10, yards: 0,
        touchdown: true, scoreKind: 'td', points: 6, possessionAfter: 1,
        changeOfPossession: true, turnover: 'int', carrierIdx: 16,
      },
      att: 1, conv: 0,
    },
    {
      name: 'first down is not a third-down attempt',
      down: 1,
      patch: { playType: 'run', spotY: 62, yards: 12, carrierIdx: 1 },
      att: 0, conv: 0,
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const r = runDeadBall({ offense: 0, ballOnY: 50, down: c.down, toGo: 10 }, c.patch);
      expect(r.state.stats.teams[0].thirdDownAtt).toBe(c.att);
      expect(r.state.stats.teams[0].thirdDownConv).toBe(c.conv);
    });
  }

  it('a third-down touchdown still routes to the try', () => {
    const r = runDeadBall(
      { offense: 0, ballOnY: 50, down: 3, toGo: 10 },
      {
        playType: 'pass', deadReason: 'touchdown', spotY: 110, yards: 60,
        touchdown: true, scoreKind: 'td', points: 6, possessionAfter: 0, carrierIdx: 3,
      },
    );
    expect(afterDeadOf(r.state)).toBe(GamePhase.POINT_AFTER_CHOICE);
    expect(r.state.score).toEqual([6, 0]);
  });
});
