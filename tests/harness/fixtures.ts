// Deterministic test fixtures — rosters generated from a seed with flat-ish
// ratings. Used by sim unit tests and the headless harness until the real
// meta league generator (S7) lands; kept simple on purpose.

import type { Athlete, Position, Ratings, TeamRoster } from '../../src/sim/types';
import { Rng, hashSeed } from '../../src/sim/rng';

const ROSTER_PLAN: Array<[Position, number]> = [
  ['QB', 2], ['RB', 3], ['WR', 5], ['TE', 2], ['OL', 7],
  ['DL', 6], ['LB', 6], ['CB', 4], ['S', 3], ['K', 1], ['P', 1],
];

const JERSEY_POOLS: Record<Position, [number, number][]> = {
  QB: [[1, 19]], RB: [[20, 39]], WR: [[10, 19], [80, 89]], TE: [[80, 89], [40, 49]],
  OL: [[50, 79]], DL: [[90, 99], [60, 79]], LB: [[40, 59], [90, 99]],
  CB: [[20, 39]], S: [[20, 49]], K: [[1, 9]], P: [[1, 9]],
};

function flatRatings(rng: Rng, base: number): Ratings {
  const r = (): number => Math.max(40, Math.min(99, Math.round(base + rng.gauss() * 5)));
  return {
    spd: r(), acc: r(), agi: r(), str: r(), awr: r(), cth: r(), car: r(),
    btk: r(), elu: r(), thp: r(), tha: r(), tak: r(), hpw: r(), pbk: r(),
    rbk: r(), shd: r(), mcv: r(), zcv: r(), kpw: r(), kac: r(),
  };
}

export function makeTestRoster(teamId: string, seed: number, baseRating = 75): TeamRoster {
  const rng = new Rng(hashSeed(seed, 'test-roster', teamId));
  const athletes: Athlete[] = [];
  const depth: Record<Position, string[]> = {
    QB: [], RB: [], WR: [], TE: [], OL: [], DL: [], LB: [], CB: [], S: [], K: [], P: [],
  };
  const usedJerseys = new Set<number>();
  let counter = 0;

  for (const [pos, count] of ROSTER_PLAN) {
    for (let k = 0; k < count; k++) {
      let jersey = 0;
      for (let tries = 0; tries < 200; tries++) {
        const pool = rng.pick(JERSEY_POOLS[pos]);
        const cand = rng.int(pool[0], pool[1]);
        if (!usedJerseys.has(cand)) { jersey = cand; break; }
      }
      if (jersey === 0) { jersey = 1; while (usedJerseys.has(jersey)) jersey++; }
      usedJerseys.add(jersey);
      const id = `${teamId}-${counter++}`;
      const ratings = flatRatings(rng, baseRating - k * 3);
      athletes.push({
        id,
        firstName: `First${counter}`,
        lastName: `Last${counter}`,
        jersey,
        pos,
        age: rng.int(21, 34),
        ratings,
        overall: Math.round(
          (ratings.spd + ratings.awr + ratings.str + ratings.agi) / 4,
        ),
      });
      depth[pos].push(id);
    }
  }

  return {
    teamId,
    city: `City ${teamId}`,
    nickname: `Testers`,
    abbrev: teamId.slice(0, 3).toUpperCase(),
    colors: { primary: '#1b3a6b', secondary: '#e8b93e' },
    athletes,
    depth,
    returners: { kr: depth.RB[1] ?? depth.RB[0]!, pr: depth.WR[2] ?? depth.WR[0]! },
  };
}
