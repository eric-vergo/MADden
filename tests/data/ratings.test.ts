import { describe, expect, it } from 'vitest';
import {
  AGE_RANGES, GENERATION, JERSEY_POOLS, OVR_TIERS, OVR_WEIGHTS, POSITION_DROPOFF,
  POSITION_ORDER, PRIMARY_ATTRS, ROSTER_PLAN, ROSTER_SIZE, STARTER_COUNTS,
  TEAM_OVR_WEIGHTS, computeOverall,
} from '../../src/data/ratings';
import type { Position, RatingKey, Ratings } from '../../src/sim/types';

const RATING_KEYS: readonly RatingKey[] = [
  'spd', 'acc', 'agi', 'str', 'awr', 'cth', 'car', 'btk', 'elu', 'thp',
  'tha', 'tak', 'hpw', 'pbk', 'rbk', 'shd', 'mcv', 'zcv', 'kpw', 'kac',
];

function flat(v: number): Ratings {
  const r = {} as Record<RatingKey, number>;
  for (const k of RATING_KEYS) r[k] = v;
  return r as Ratings;
}

describe('roster plan', () => {
  it('fields 40 players covering every position', () => {
    const total = ROSTER_PLAN.reduce((n, [, count]) => n + count, 0);
    expect(total).toBe(ROSTER_SIZE);
    expect(ROSTER_PLAN.map(([p]) => p).sort()).toEqual([...POSITION_ORDER].sort());
  });

  it('matches the designed depth (QB2 RB3 WR5 TE2 OL7 DL6 LB6 CB4 S3 K1 P1)', () => {
    const plan = Object.fromEntries(ROSTER_PLAN) as Record<Position, number>;
    expect(plan).toEqual({
      QB: 2, RB: 3, WR: 5, TE: 2, OL: 7, DL: 6, LB: 6, CB: 4, S: 3, K: 1, P: 1,
    });
  });

  it('never starts more players than the roster carries', () => {
    const plan = Object.fromEntries(ROSTER_PLAN) as Record<Position, number>;
    for (const pos of POSITION_ORDER) {
      expect(STARTER_COUNTS[pos], pos).toBeLessThanOrEqual(plan[pos]);
    }
    const offense = STARTER_COUNTS.QB + STARTER_COUNTS.RB + STARTER_COUNTS.WR
      + STARTER_COUNTS.TE + STARTER_COUNTS.OL;
    const defense = STARTER_COUNTS.DL + STARTER_COUNTS.LB + STARTER_COUNTS.CB + STARTER_COUNTS.S;
    expect(offense).toBe(11);
    expect(defense).toBe(11);
  });
});

describe('archetypes', () => {
  it('gives every position a primary attribute list', () => {
    for (const pos of POSITION_ORDER) {
      const attrs = PRIMARY_ATTRS[pos];
      expect(attrs.length, pos).toBeGreaterThanOrEqual(3);
      expect(new Set(attrs).size, pos).toBe(attrs.length);
      for (const a of attrs) expect(RATING_KEYS, `${pos}.${a}`).toContain(a);
    }
  });

  it('makes the archetypes actually different from each other', () => {
    expect(PRIMARY_ATTRS.CB).toContain('mcv');
    expect(PRIMARY_ATTRS.CB).not.toContain('rbk');
    expect(PRIMARY_ATTRS.OL).toContain('pbk');
    expect(PRIMARY_ATTRS.OL).not.toContain('cth');
    expect(PRIMARY_ATTRS.K).toEqual(PRIMARY_ATTRS.P);
  });

  it('drops off down the depth chart everywhere it matters', () => {
    for (const pos of POSITION_ORDER) {
      const dropoff = POSITION_DROPOFF[pos];
      expect(dropoff, pos).toBeGreaterThanOrEqual(0);
      if (pos !== 'K' && pos !== 'P') expect(dropoff, pos).toBeGreaterThan(0);
    }
    // The QB cliff is the steepest, the line the shallowest.
    expect(POSITION_DROPOFF.QB).toBeGreaterThan(POSITION_DROPOFF.OL);
  });

  it('keeps age bands plausible', () => {
    for (const pos of POSITION_ORDER) {
      const [min, max] = AGE_RANGES[pos];
      expect(min, pos).toBeGreaterThanOrEqual(21);
      expect(max, pos).toBeGreaterThan(min);
      expect(max, pos).toBeLessThanOrEqual(38);
    }
    expect(AGE_RANGES.RB[1]).toBeLessThan(AGE_RANGES.QB[1]);
  });
});

describe('jersey pools', () => {
  it('are legal, ordered two-digit bands', () => {
    for (const pos of POSITION_ORDER) {
      const pools = JERSEY_POOLS[pos];
      expect(pools.length, pos).toBeGreaterThan(0);
      for (const [lo, hi] of pools) {
        expect(lo, pos).toBeGreaterThanOrEqual(1);
        expect(hi, pos).toBeLessThanOrEqual(99);
        expect(hi, pos).toBeGreaterThan(lo);
      }
    }
  });

  it('matches the position number rules', () => {
    expect(JERSEY_POOLS.QB).toEqual([[1, 19]]);
    expect(JERSEY_POOLS.RB).toEqual([[20, 39]]);
    expect(JERSEY_POOLS.WR).toEqual([[10, 19], [80, 89]]);
    expect(JERSEY_POOLS.TE).toEqual([[80, 89], [40, 49]]);
    expect(JERSEY_POOLS.OL).toEqual([[50, 79]]);
    expect(JERSEY_POOLS.DL).toEqual([[90, 99], [60, 79]]);
    expect(JERSEY_POOLS.LB).toEqual([[40, 59], [90, 99]]);
    expect(JERSEY_POOLS.CB).toEqual([[20, 39]]);
    expect(JERSEY_POOLS.S).toEqual([[20, 49]]);
    expect(JERSEY_POOLS.K).toEqual([[1, 9]]);
    expect(JERSEY_POOLS.P).toEqual([[1, 9]]);
  });

  it('offers enough numbers for the whole roster', () => {
    const plan = Object.fromEntries(ROSTER_PLAN) as Record<Position, number>;
    for (const pos of POSITION_ORDER) {
      const slots = JERSEY_POOLS[pos].reduce((n, [lo, hi]) => n + (hi - lo + 1), 0);
      expect(slots, pos).toBeGreaterThanOrEqual(plan[pos]);
    }
  });
});

describe('overall ratings', () => {
  it('weights sum to exactly 1 per position', () => {
    for (const pos of POSITION_ORDER) {
      const total = OVR_WEIGHTS[pos].reduce((n, t) => n + t.weight, 0);
      expect(total, pos).toBeCloseTo(1, 10);
      for (const term of OVR_WEIGHTS[pos]) {
        const inner = term.mix.reduce((n, [, w]) => n + w, 0);
        expect(inner, pos).toBeCloseTo(1, 10);
      }
    }
  });

  it('only references real rating keys', () => {
    for (const pos of POSITION_ORDER) {
      for (const term of OVR_WEIGHTS[pos]) {
        for (const [key] of term.mix) expect(RATING_KEYS, pos).toContain(key);
      }
    }
  });

  it('reproduces a flat rating exactly', () => {
    for (const pos of POSITION_ORDER) {
      expect(computeOverall(pos, flat(70)), pos).toBe(70);
      expect(computeOverall(pos, flat(99)), pos).toBe(99);
      expect(computeOverall(pos, flat(40)), pos).toBe(40);
    }
  });

  it('rewards the archetype attributes', () => {
    for (const pos of POSITION_ORDER) {
      const base = flat(60);
      const boosted = { ...base };
      for (const key of PRIMARY_ATTRS[pos]) boosted[key] = 95;
      expect(computeOverall(pos, boosted), pos).toBeGreaterThan(computeOverall(pos, base));
    }
  });

  it('stays inside the legal rating band', () => {
    for (const pos of POSITION_ORDER) {
      const ovr = computeOverall(pos, flat(99));
      expect(ovr).toBeLessThanOrEqual(GENERATION.ratingMax);
      expect(computeOverall(pos, flat(40))).toBeGreaterThanOrEqual(GENERATION.ratingMin);
    }
  });

  it('blends team ratings with weights that sum to 1', () => {
    const off = Object.values(TEAM_OVR_WEIGHTS.off).reduce((a, b) => a + b, 0);
    const def = Object.values(TEAM_OVR_WEIGHTS.def).reduce((a, b) => a + b, 0);
    const all = Object.values(TEAM_OVR_WEIGHTS.overall).reduce((a, b) => a + b, 0);
    expect(off).toBeCloseTo(1, 10);
    expect(def).toBeCloseTo(1, 10);
    expect(all).toBeCloseTo(1, 10);
  });

  it('orders the UI colour ramp', () => {
    expect(OVR_TIERS.gold).toBeGreaterThan(OVR_TIERS.green);
    expect(OVR_TIERS.green).toBeGreaterThan(OVR_TIERS.white);
  });
});

describe('generation constants', () => {
  it('describe a league with real spread but no absurd outliers', () => {
    expect(GENERATION.tierMin).toBeLessThan(GENERATION.tierMax);
    expect(GENERATION.groupMeanMin).toBeLessThan(GENERATION.groupMeanMax);
    expect(GENERATION.fillerMin).toBeGreaterThanOrEqual(GENERATION.ratingMin);
    expect(GENERATION.fillerMin).toBeLessThan(GENERATION.fillerMax);
    // Filler attributes must stay below the weakest position-group mean so a
    // corner never accidentally out-blocks a guard.
    expect(GENERATION.fillerMax).toBeLessThan(GENERATION.tierMin);
    expect(GENERATION.signatureMin).toBeLessThan(GENERATION.signatureMax);
    expect(GENERATION.signatureMax).toBeLessThanOrEqual(GENERATION.ratingMax);
    expect(GENERATION.starPrimaryBoostMin).toBeLessThan(GENERATION.starPrimaryBoostMax);
  });
});
