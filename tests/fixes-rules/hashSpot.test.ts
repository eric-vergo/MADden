// Regression: "setSeries clobbers ext.ballOnX, so hash spotting never happens".
// The lateral dead-ball spot computed by PLAY_DEAD has to survive applySeries
// and be the spot the next play is snapped from.

import { describe, expect, it } from 'vitest';
import { CENTER_X, HASH_LEFT_X, HASH_RIGHT_X } from '../../src/sim/constants';
import { ext } from '../../src/sim/rules/ext';
import { setFirstAndTen, setSeries, setupKickoff, setupPat } from '../../src/sim/rules/scoring';
import { makeScenario } from '../sim-core/helpers';
import { runDeadBall } from './helpers';

describe('lateral spot survives the series setters', () => {
  it('setSeries leaves the hash spot alone', () => {
    const s = makeScenario().state;
    ext(s).ballOnX = HASH_RIGHT_X;
    setSeries(s, 1, 55, 2, 7);
    expect(ext(s).ballOnX).toBe(HASH_RIGHT_X);
  });

  it('setFirstAndTen leaves the hash spot alone', () => {
    const s = makeScenario().state;
    ext(s).ballOnX = HASH_LEFT_X;
    setFirstAndTen(s, 1, 55);
    expect(ext(s).ballOnX).toBe(HASH_LEFT_X);
  });

  it('a kickoff re-centres the ball', () => {
    const s = makeScenario().state;
    ext(s).ballOnX = HASH_LEFT_X;
    setupKickoff(s, 0);
    expect(ext(s).ballOnX).toBe(CENTER_X);
  });

  it('a try re-centres the ball', () => {
    const s = makeScenario().state;
    ext(s).ballOnX = HASH_RIGHT_X;
    setupPat(s, 0, false);
    expect(ext(s).ballOnX).toBe(CENTER_X);
  });
});

describe('dead-ball hash spot reaches the next snap', () => {
  const cases: { name: string; spotX: number; want: number }[] = [
    { name: 'tackled at the right sideline', spotX: 48, want: HASH_RIGHT_X },
    { name: 'tackled at the left sideline', spotX: 3, want: HASH_LEFT_X },
    { name: 'tackled between the hashes', spotX: CENTER_X, want: CENTER_X },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const r = runDeadBall(
        { offense: 0, ballOnY: 50 },
        { playType: 'run', spotY: 54, spotX: c.spotX, yards: 4, carrierIdx: 0 },
      );
      expect(ext(r.state).ballOnX).toBeCloseTo(c.want, 6);
    });
  }

  it('a change of possession keeps the hash spot too', () => {
    const r = runDeadBall(
      { offense: 0, ballOnY: 50 },
      {
        playType: 'pass', spotX: 48, spotY: 44, yards: -6,
        turnover: 'int', changeOfPossession: true, possessionAfter: 1, carrierIdx: 12,
      },
    );
    expect(ext(r.state).ballOnX).toBeCloseTo(HASH_RIGHT_X, 6);
    expect(r.state.possession).toBe(1);
    expect(r.state.down).toBe(1);
  });
});
