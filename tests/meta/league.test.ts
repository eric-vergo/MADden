import { describe, expect, it } from 'vitest';
import type { Position, RatingKey, Ratings } from '../../src/sim/types';
import {
  RATING_KEYS, athleteById, computeOverall, computeTeamRatings, computeTiers,
  generateLeague, ovrTier, peakRating,
} from '../../src/meta/league';
import { TEAM_IDENTITIES } from '../../src/data/teams';
import { BLOCKED_FULL_NAMES } from '../../src/data/names';
import { GENERATION, ROSTER_PLAN } from '../../src/data/ratings';

const SEED = 20260831;

describe('league generation', () => {
  const league = generateLeague(SEED, 0);

  it('builds 16 teams with the canonical identities', () => {
    expect(league.teams).toHaveLength(16);
    expect(league.teams.map((t) => t.identity.id)).toEqual(TEAM_IDENTITIES.map((t): string => t.id));
    expect(league.seasonIndex).toBe(0);
    expect(league.leagueSeed).toBe(SEED);
  });

  it('gives every team a 40-man roster with exact position counts', () => {
    for (const team of league.teams) {
      expect(team.roster.athletes).toHaveLength(40);
      const counts: Partial<Record<Position, number>> = {};
      for (const a of team.roster.athletes) counts[a.pos] = (counts[a.pos] ?? 0) + 1;
      for (const [pos, want] of ROSTER_PLAN) {
        expect(counts[pos], `${team.identity.id} ${pos}`).toBe(want);
        expect(team.roster.depth[pos]).toHaveLength(want);
      }
    }
  });

  it('keeps every rating inside 40–99', () => {
    for (const team of league.teams) {
      for (const a of team.roster.athletes) {
        for (const key of RATING_KEYS) {
          const v = a.ratings[key];
          expect(Number.isInteger(v), `${a.id}.${key}=${v}`).toBe(true);
          expect(v).toBeGreaterThanOrEqual(40);
          expect(v).toBeLessThanOrEqual(99);
        }
      }
    }
  });

  it('is deterministic for the same seed and divergent across seeds', () => {
    expect(generateLeague(SEED, 0)).toEqual(generateLeague(SEED, 0));
    expect(generateLeague(SEED, 1)).not.toEqual(generateLeague(SEED, 0));
    expect(generateLeague(SEED + 1, 0)).not.toEqual(generateLeague(SEED, 0));
  });

  it('spreads team tiers across 66–86 with genuinely good and bad teams', () => {
    for (let s = 0; s < 25; s++) {
      const tiers = computeTiers(SEED + s, TEAM_IDENTITIES);
      expect(tiers).toHaveLength(16);
      const min = Math.min(...tiers);
      const max = Math.max(...tiers);
      expect(min).toBeGreaterThanOrEqual(GENERATION.tierMin);
      expect(max).toBeLessThanOrEqual(GENERATION.tierMax);
      expect(max).toBeGreaterThan(84); // a contender every season
      expect(min).toBeLessThan(68); // and a doormat
    }
  });

  it('produces a wide team OVR spread', () => {
    const ovrs = league.teams.map((t) => t.ovr);
    expect(Math.max(...ovrs) - Math.min(...ovrs)).toBeGreaterThanOrEqual(10);
  });

  it('guarantees at least 6 league-wide stars with an attribute >= 93', () => {
    for (let s = 0; s < 20; s++) {
      const l = generateLeague(SEED + s * 7919, 0);
      let stars = 0;
      for (const team of l.teams) {
        for (const a of team.roster.athletes) if (peakRating(a) >= 93) stars++;
      }
      expect(stars).toBeGreaterThanOrEqual(GENERATION.leagueEliteGuarantee);
    }
  });

  it('never emits a blocked name and keeps names unique league-wide', () => {
    const seen = new Set<string>();
    for (const team of league.teams) {
      for (const a of team.roster.athletes) {
        const full = `${a.firstName} ${a.lastName}`;
        expect(BLOCKED_FULL_NAMES.has(full), `blocked name ${full}`).toBe(false);
        expect(seen.has(full), `duplicate name ${full}`).toBe(false);
        seen.add(full);
      }
    }
    expect(seen.size).toBe(640);
  });

  it('keeps jerseys unique per team and inside the position pools', () => {
    for (const team of league.teams) {
      const jerseys = new Set<number>();
      for (const a of team.roster.athletes) {
        expect(jerseys.has(a.jersey), `${team.identity.id} #${a.jersey}`).toBe(false);
        jerseys.add(a.jersey);
        expect(a.jersey).toBeGreaterThanOrEqual(0);
        expect(a.jersey).toBeLessThanOrEqual(99);
      }
      expect(jerseys.size).toBe(40);
    }
  });

  it('gives athletes unique ids and ages in the position range', () => {
    for (const team of league.teams) {
      const ids = new Set(team.roster.athletes.map((a) => a.id));
      expect(ids.size).toBe(40);
      for (const a of team.roster.athletes) {
        if (a.pos === 'QB') {
          expect(a.age).toBeGreaterThanOrEqual(22);
          expect(a.age).toBeLessThanOrEqual(38);
        } else if (a.pos === 'RB') {
          expect(a.age).toBeGreaterThanOrEqual(21);
          expect(a.age).toBeLessThanOrEqual(30);
        } else {
          expect(a.age).toBeGreaterThanOrEqual(21);
          expect(a.age).toBeLessThanOrEqual(34);
        }
      }
    }
  });

  it('orders depth charts best-first', () => {
    for (const team of league.teams) {
      for (const pos of Object.keys(team.roster.depth) as Position[]) {
        const ovrs = team.roster.depth[pos].map((id) => athleteById(team.roster, id).overall);
        for (let i = 1; i < ovrs.length; i++) {
          expect(ovrs[i - 1]!).toBeGreaterThanOrEqual(ovrs[i]!);
        }
      }
    }
  });

  it('picks returners by spd+agi from the RB2/RB3/WR3-5 pool', () => {
    for (const team of league.teams) {
      const r = team.roster;
      const poolIds = [r.depth.RB[1]!, r.depth.RB[2]!, r.depth.WR[2]!, r.depth.WR[3]!, r.depth.WR[4]!];
      expect(poolIds).toContain(r.returners.kr);
      expect(poolIds).toContain(r.returners.pr);
      expect(r.returners.kr).not.toBe(r.returners.pr);
      const score = (id: string): number => {
        const a = athleteById(r, id);
        return a.ratings.spd + a.ratings.agi;
      };
      const best = Math.max(...poolIds.map(score));
      expect(score(r.returners.kr)).toBe(best);
      const rest = poolIds.filter((id) => id !== r.returners.kr);
      expect(score(r.returners.pr)).toBe(Math.max(...rest.map(score)));
    }
  });

  it('caches a per-position OVR that matches the design weights', () => {
    const flat = (v: number): Ratings => {
      const r = {} as Ratings;
      for (const k of RATING_KEYS as readonly RatingKey[]) r[k] = v;
      return r;
    };
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'] as Position[]) {
      // Weights sum to 1.0, so a flat 80 profile must grade out at exactly 80.
      expect(computeOverall(pos, flat(80)), pos).toBe(80);
    }
    for (const team of league.teams) {
      for (const a of team.roster.athletes) {
        expect(a.overall).toBe(computeOverall(a.pos, a.ratings));
      }
    }
  });

  it('caches team OFF/DEF/OVR consistent with the roster', () => {
    for (const team of league.teams) {
      const summary = computeTeamRatings(team.roster);
      expect(team.off).toBe(summary.off);
      expect(team.def).toBe(summary.def);
      expect(team.ovr).toBe(summary.ovr);
      expect(team.ovr).toBeGreaterThan(45);
      expect(team.ovr).toBeLessThan(99);
    }
  });

  it('maps OVR onto the design colour ramp', () => {
    expect(ovrTier(90)).toBe('gold');
    expect(ovrTier(85)).toBe('gold');
    expect(ovrTier(84)).toBe('green');
    expect(ovrTier(78)).toBe('green');
    expect(ovrTier(77)).toBe('white');
    expect(ovrTier(70)).toBe('white');
    expect(ovrTier(69)).toBe('gray');
  });
});
