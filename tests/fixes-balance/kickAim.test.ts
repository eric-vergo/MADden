// Regression: the CPU kicker has to aim at the uprights, not straight
// downfield.
//
// launchKick fires along heading = ±PI/2 plus the kick meter's aim, and a
// placekick is spotted on a hash. HASH_LEFT_X / HASH_RIGHT_X sit 3.083 yards
// off centre and GOALPOST_HALF_WIDTH is 3.083 yards, so a kicker who does not
// turn his hips is aiming exactly at an upright from either hash — every field
// goal a coin flip, decided by which way the accuracy sweep happened to lean.
//
// That was invisible until hash spotting started working (phase 3 fixed
// setSeries clobbering ext.ballOnX), because before it every kick went from
// dead centre. Measured over 24 headless games with the aim missing: 51% made,
// and the misses ran 22 wide against 3 short — including 7 of 11 from inside
// 30 yards. With ai/specialTeams.ts aimAtUprights in place: 90% made, and
// 11 of 11 from inside 30.

import { describe, expect, it } from 'vitest';
import { CENTER_X, GOALPOST_HALF_WIDTH, HASH_LEFT_X, HASH_RIGHT_X } from '../../src/sim/constants';
import { runHeadlessGame } from '../harness/headlessGame';

interface Attempt {
  distance: number;
  good: boolean;
  missSide: 'left' | 'right' | 'short' | null;
}

function attempts(games: number): Attempt[] {
  const out: Attempt[] = [];
  for (let i = 0; i < games; i++) {
    const r = runHeadlessGame({ seed: 10_000 + i, quarterLengthSec: 300 });
    for (const e of r.events) {
      if (e.type !== 'FIELD_GOAL_RESULT') continue;
      out.push({ distance: e.distanceYds, good: e.good, missSide: e.missSide });
    }
  }
  return out;
}

describe('CPU placekick aim', () => {
  // The geometry that makes the bug a coin flip rather than a slight bias.
  it('has hash marks exactly one goalpost half-width off centre', () => {
    expect(CENTER_X - HASH_LEFT_X).toBeCloseTo(GOALPOST_HALF_WIDTH, 2);
    expect(HASH_RIGHT_X - CENTER_X).toBeCloseTo(GOALPOST_HALF_WIDTH, 2);
  });

  it('makes field goals at a football-realistic rate from the hashes', () => {
    const all = attempts(8);
    const detail = JSON.stringify(all);
    expect(all.length, `no field goals were attempted ${detail}`).toBeGreaterThanOrEqual(8);

    const made = all.filter((a) => a.good).length;
    // Aiming straight downfield lands this at ~0.5; aiming at the posts ~0.9.
    expect(made / all.length, `field goal rate ${detail}`).toBeGreaterThanOrEqual(0.7);

    // The sharpest signal: a chip shot cannot be a coin flip. Under the bug
    // these missed WIDE more often than they went in.
    const chip = all.filter((a) => a.distance < 35);
    if (chip.length >= 3) {
      const wide = chip.filter((a) => a.missSide === 'left' || a.missSide === 'right').length;
      expect(wide, `short field goals missing wide ${detail}`)
        .toBeLessThanOrEqual(Math.floor(chip.length * 0.2));
    }
  }, 120_000);
});
