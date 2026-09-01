// Regression: "spotLabel names the wrong team's territory in Q2, Q4 and OT".
// Teams swap ends every quarter, so which half of the field belongs to whom
// depends on attackDir[0] — exactly as the renderer's territoryTeam already does.

import { describe, expect, it } from 'vitest';
import { describeState, spotLabel } from '../../src/sim/rules/downs';
import { ballOnText } from '../../src/render/format';
import type { Dir } from '../../src/sim/transform';
import { runDeadBall } from './helpers';

interface LabelCase {
  name: string;
  ballOnY: number;
  homeDir: Dir;
  want: string;
}

// homeDir === 1: home attacks +y, so it DEFENDS the low end and the low half is
// home territory. homeDir === -1 (Q2/Q4/OT) is the mirror.
const LABEL_CASES: LabelCase[] = [
  { name: 'Q1 low half is home territory', ballOnY: 30, homeDir: 1, want: 'HOM 20' },
  { name: 'Q1 high half is away territory', ballOnY: 90, homeDir: 1, want: 'AWY 20' },
  { name: 'Q2 low half is away territory', ballOnY: 30, homeDir: -1, want: 'AWY 20' },
  { name: 'Q2 high half is home territory', ballOnY: 90, homeDir: -1, want: 'HOM 20' },
  { name: 'Q1 own 43', ballOnY: 53, homeDir: 1, want: 'HOM 43' },
  { name: 'Q2 same spot flips sides', ballOnY: 53, homeDir: -1, want: 'AWY 43' },
  { name: 'midfield never names a team (Q1)', ballOnY: 60, homeDir: 1, want: 'MID 50' },
  { name: 'midfield never names a team (Q2)', ballOnY: 60, homeDir: -1, want: 'MID 50' },
];

describe('spotLabel is attackDir aware', () => {
  for (const c of LABEL_CASES) {
    it(c.name, () => {
      expect(spotLabel(c.ballOnY, 'HOM', 'AWY', c.homeDir)).toBe(c.want);
    });
  }

  it('agrees with the renderer for every spot in both orientations', () => {
    const dirs: [Dir, Dir][] = [[1, -1], [-1, 1]];
    for (const attackDir of dirs) {
      for (let y = 11; y <= 109; y += 1) {
        if (Math.abs(y - 60) < 1) continue; // MID 50 tolerances differ by design
        expect(spotLabel(y, 'HOM', 'AWY', attackDir[0]))
          .toBe(ballOnText(y, attackDir, ['HOM', 'AWY']));
      }
    }
  });

  it('describeState carries the orientation through', () => {
    expect(describeState(3, 7, 40, 1, 'HOM', 'AWY', 1)).toBe('3rd & 7 at HOM 30');
    expect(describeState(3, 7, 40, -1, 'HOM', 'AWY', -1)).toBe('3rd & 7 at AWY 30');
  });
});

describe('play log spots the right half of the field', () => {
  it('Q1: home offense in its own territory', () => {
    const r = runDeadBall(
      { offense: 0, ballOnY: 43, quarter: 1, attackDir: [1, -1] },
      { playType: 'pass', spotY: 53, yards: 10, carrierIdx: 0, completed: true },
    );
    expect(r.state.playLog.at(-1)?.text.startsWith('1st & 10 at HOM 33')).toBe(true);
  });

  it('Q2: the same world spot belongs to the away team', () => {
    const r = runDeadBall(
      { offense: 0, ballOnY: 43, quarter: 2, attackDir: [-1, 1] },
      { playType: 'pass', spotY: 33, yards: 10, carrierIdx: 0, completed: true },
    );
    expect(r.state.playLog.at(-1)?.text.startsWith('1st & 10 at AWY 33')).toBe(true);
  });
});
