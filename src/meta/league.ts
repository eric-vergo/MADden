// League generation: 16 canonical identities -> 40-man rosters with a ranked
// team-tier spread, position-group means, per-slot dropoff, star injection and
// a league-wide star guarantee. Pure: every random draw comes from a seeded Rng
// keyed by hashSeed(seasonSeed, 'roster', teamId), so the same
// (leagueSeed, seasonIndex) always rebuilds byte-identical rosters.
//
// All archetype/name/identity tables live in src/data (authored by S2); this
// module owns only the generation algorithm.

import type { Athlete, Position, RatingKey, Ratings, TeamRoster } from '../sim/types';
import { Rng, hashSeed } from '../sim/rng';
import { TEAM_IDENTITIES } from '../data/teams';
import { BLOCKED_FULL_NAMES, FIRST_NAMES, LAST_NAMES, MIDDLE_INITIALS } from '../data/names';
import {
  AGE_RANGES, GENERATION, JERSEY_POOLS, OVR_TIERS, POSITION_DROPOFF, PRIMARY_ATTRS,
  ROSTER_PLAN, STARTER_COUNTS, TEAM_OVR_WEIGHTS, computeOverall,
} from '../data/ratings';
import type { LeagueState, Team, TeamIdentity } from './types';
import { avg, clamp, req } from './util';

export { computeOverall };

/** Fixed iteration order for Ratings — never enumerate the record by key. */
export const RATING_KEYS: readonly RatingKey[] = [
  'spd', 'acc', 'agi', 'str', 'awr', 'cth', 'car', 'btk', 'elu', 'thp',
  'tha', 'tak', 'hpw', 'pbk', 'rbk', 'shd', 'mcv', 'zcv', 'kpw', 'kac',
];

// TODO(balance) — generation knobs the shared table does not carry yet.
export const LEAGUE_GEN = {
  /** Team tier at or above which a roster gets an extra star. */
  topTierThreshold: 82,
  /** An attribute at or above this counts as a league "star" attribute. */
  starAttrThreshold: GENERATION.signatureMin,
} as const;

/** Positions eligible to carry a team's star player (starter of that group). */
const STAR_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'];

const EMPTY_DEPTH = (): Record<Position, string[]> => ({
  QB: [], RB: [], WR: [], TE: [], OL: [], DL: [], LB: [], CB: [], S: [], K: [], P: [],
});

/**
 * Roster generation is re-run every season from the same league seed, so the
 * season index has to be folded into the seed before the per-team sub-seeds.
 */
export function seasonSeed(leagueSeed: number, seasonIndex: number): number {
  return hashSeed(leagueSeed, 'season', seasonIndex);
}

// ---------------------------------------------------------------------------
// Depth-chart lookups
// ---------------------------------------------------------------------------

/** Ids of the top `n` at a position, best first. */
export function starterIds(roster: TeamRoster, pos: Position, n: number): string[] {
  return roster.depth[pos].slice(0, n);
}

export function athleteById(roster: TeamRoster, id: string): Athlete {
  for (let i = 0; i < roster.athletes.length; i++) {
    const a = req(roster.athletes, i);
    if (a.id === id) return a;
  }
  throw new Error(`athlete ${id} not on roster ${roster.teamId}`);
}

/** Overalls of the top `n` at a position, best first. */
export function starterOvrs(roster: TeamRoster, pos: Position, n: number): number[] {
  const ids = starterIds(roster, pos, n);
  const out: number[] = [];
  for (let i = 0; i < ids.length; i++) out.push(athleteById(roster, req(ids, i)).overall);
  return out;
}

export interface TeamRatingSummary {
  off: number;
  def: number;
  ovr: number;
}

/** Team OFF/DEF/OVR (design §3). OFF/DEF are rounded for display; OVR uses raw. */
export function computeTeamRatings(roster: TeamRoster): TeamRatingSummary {
  const w = TEAM_OVR_WEIGHTS;
  const qb = req(starterOvrs(roster, 'QB', 1), 0);
  const rb = req(starterOvrs(roster, 'RB', 1), 0);
  const wr = avg(starterOvrs(roster, 'WR', STARTER_COUNTS.WR));
  const te = req(starterOvrs(roster, 'TE', 1), 0);
  const ol = avg(starterOvrs(roster, 'OL', STARTER_COUNTS.OL));
  const dl = avg(starterOvrs(roster, 'DL', STARTER_COUNTS.DL));
  const lb = avg(starterOvrs(roster, 'LB', STARTER_COUNTS.LB));
  const cb = avg(starterOvrs(roster, 'CB', STARTER_COUNTS.CB));
  const s = avg(starterOvrs(roster, 'S', STARTER_COUNTS.S));
  const k = req(starterOvrs(roster, 'K', 1), 0);

  const off = w.off.qb1 * qb + w.off.rb1 * rb + w.off.wrTop3 * wr + w.off.te1 * te + w.off.olStarters * ol;
  const def = w.def.dlStarters * dl + w.def.lbStarters * lb + w.def.cbTop2 * cb + w.def.safeties * s;
  return {
    off: Math.round(off),
    def: Math.round(def),
    ovr: Math.round(w.overall.off * off + w.overall.def * def + w.overall.kicker * k),
  };
}

/** Design §3 colour ramp for OVR chips. */
export function ovrTier(ovr: number): 'gold' | 'green' | 'white' | 'gray' {
  if (ovr >= OVR_TIERS.gold) return 'gold';
  if (ovr >= OVR_TIERS.green) return 'green';
  if (ovr >= OVR_TIERS.white) return 'white';
  return 'gray';
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/**
 * Roll a raw strength per team, rank all 16, then linearly remap onto
 * [tierMin..tierMax] preserving order. The remap (not the roll) is what
 * guarantees the league always has genuinely good and genuinely bad teams.
 */
export function computeTiers(seed: number, identities: readonly TeamIdentity[]): number[] {
  const rng = new Rng(hashSeed(seed, 'tiers'));
  const rolls: Array<{ i: number; id: string; v: number }> = [];
  for (let i = 0; i < identities.length; i++) {
    rolls.push({
      i,
      id: req(identities, i).id,
      v: GENERATION.teamTierMean + rng.gauss() * GENERATION.teamTierSigma,
    });
  }
  rolls.sort((a, b) => (b.v - a.v) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const span = GENERATION.tierMax - GENERATION.tierMin;
  const last = Math.max(1, identities.length - 1);
  const tiers = new Array<number>(identities.length).fill(0);
  for (let rank = 0; rank < rolls.length; rank++) {
    const entry = req(rolls, rank);
    const base = GENERATION.tierMax - (rank / last) * span;
    const jitter = (rng.next() * 2 - 1) * GENERATION.tierJitter;
    tiers[entry.i] = clamp(base + jitter, GENERATION.tierMin, GENERATION.tierMax);
  }
  return tiers;
}

// ---------------------------------------------------------------------------
// Names & jerseys
// ---------------------------------------------------------------------------

function rollName(rng: Rng, used: Set<string>): { firstName: string; lastName: string } {
  for (let t = 0; t < GENERATION.nameRerollTries; t++) {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const full = `${first} ${last}`;
    if (BLOCKED_FULL_NAMES.has(full) || used.has(full)) continue;
    used.add(full);
    return { firstName: first, lastName: last };
  }
  // Exhausted: disambiguate with a middle initial (still never a blocked combo).
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  for (let m = 0; m < MIDDLE_INITIALS.length; m++) {
    const firstName = `${first} ${req(MIDDLE_INITIALS, m)}.`;
    const full = `${firstName} ${last}`;
    if (BLOCKED_FULL_NAMES.has(full) || used.has(full)) continue;
    used.add(full);
    return { firstName, lastName: last };
  }
  // Pathological fallback — numbered suffix keeps league-wide uniqueness.
  let n = 2;
  for (;;) {
    const firstName = `${first} ${n}.`;
    const full = `${firstName} ${last}`;
    if (!used.has(full)) {
      used.add(full);
      return { firstName, lastName: last };
    }
    n++;
  }
}

function rollJersey(rng: Rng, pos: Position, used: Set<number>): number {
  const pools = JERSEY_POOLS[pos];
  for (let t = 0; t < 60; t++) {
    const pool = rng.pick(pools);
    const cand = rng.int(req(pool, 0), req(pool, 1));
    if (!used.has(cand)) {
      used.add(cand);
      return cand;
    }
  }
  for (let p = 0; p < pools.length; p++) {
    const pool = req(pools, p);
    for (let n = req(pool, 0); n <= req(pool, 1); n++) {
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
  }
  for (let n = 0; n <= 99; n++) {
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  throw new Error('jersey pool exhausted');
}

// ---------------------------------------------------------------------------
// Athlete generation
// ---------------------------------------------------------------------------

function rollRatings(rng: Rng, pos: Position, target: number): Ratings {
  const primaries = PRIMARY_ATTRS[pos];
  const isPrimary = new Set<RatingKey>(primaries);
  const out = {} as Ratings;
  for (let i = 0; i < RATING_KEYS.length; i++) {
    const key = req(RATING_KEYS, i);
    out[key] = isPrimary.has(key)
      ? clamp(Math.round(target + rng.gauss() * GENERATION.attrSigma), GENERATION.ratingMin, GENERATION.ratingMax)
      : rng.int(GENERATION.fillerMin, GENERATION.fillerMax);
  }
  return out;
}

function buildRoster(
  identity: TeamIdentity,
  tier: number,
  rng: Rng,
  usedNames: Set<string>,
): TeamRoster {
  const athletes: Athlete[] = [];
  const depth = EMPTY_DEPTH();
  const usedJerseys = new Set<number>();

  for (let g = 0; g < ROSTER_PLAN.length; g++) {
    const [pos, count] = req(ROSTER_PLAN, g);
    const groupMean = clamp(
      tier + rng.gauss() * GENERATION.groupMeanSigma,
      GENERATION.groupMeanMin,
      GENERATION.groupMeanMax,
    );
    const dropoff = POSITION_DROPOFF[pos];
    const [ageLo, ageHi] = AGE_RANGES[pos];
    for (let k = 0; k < count; k++) {
      const target = groupMean - k * dropoff + rng.gauss() * GENERATION.slotSigma;
      const ratings = rollRatings(rng, pos, target);
      const jersey = rollJersey(rng, pos, usedJerseys);
      const age = rng.int(ageLo, ageHi);
      const { firstName, lastName } = rollName(rng, usedNames);
      const id = `${identity.id}-${jersey}`;
      athletes.push({
        id, firstName, lastName, jersey, pos, age, ratings,
        overall: computeOverall(pos, ratings),
      });
      depth[pos].push(id);
    }
  }

  const byId = new Map<string, Athlete>();
  for (let i = 0; i < athletes.length; i++) {
    const a = req(athletes, i);
    byId.set(a.id, a);
  }

  const roster: TeamRoster = {
    teamId: identity.id,
    city: identity.city,
    nickname: identity.nickname,
    abbrev: identity.id,
    colors: identity.colors,
    athletes,
    depth,
    returners: { kr: '', pr: '' },
  };

  injectStars(roster, byId, tier, rng);
  sortDepth(roster, byId);
  assignReturners(roster, byId);
  return roster;
}

function sortDepth(roster: TeamRoster, byId: ReadonlyMap<string, Athlete>): void {
  const positions = Object.keys(roster.depth).sort() as Position[];
  for (let i = 0; i < positions.length; i++) {
    const pos = req(positions, i);
    roster.depth[pos].sort((a, b) => {
      const oa = byId.get(a)?.overall ?? 0;
      const ob = byId.get(b)?.overall ?? 0;
      return (ob - oa) || (a < b ? -1 : a > b ? 1 : 0);
    });
  }
}

/** KR = best spd+agi among {RB2,RB3,WR3,WR4,WR5}; PR = the runner-up. */
function assignReturners(roster: TeamRoster, byId: ReadonlyMap<string, Athlete>): void {
  const pool: string[] = [];
  const rbs = roster.depth.RB;
  const wrs = roster.depth.WR;
  for (let i = 1; i <= 2; i++) {
    const id = rbs[i];
    if (id !== undefined) pool.push(id);
  }
  for (let i = 2; i <= 4; i++) {
    const id = wrs[i];
    if (id !== undefined) pool.push(id);
  }
  if (pool.length === 0) {
    const fallback = req(roster.athletes, 0).id;
    roster.returners = { kr: fallback, pr: fallback };
    return;
  }
  const score = (id: string): number => {
    const a = byId.get(id);
    return a ? a.ratings.spd + a.ratings.agi : 0;
  };
  pool.sort((a, b) => (score(b) - score(a)) || (a < b ? -1 : a > b ? 1 : 0));
  roster.returners = { kr: req(pool, 0), pr: pool[1] ?? req(pool, 0) };
}

function injectStars(roster: TeamRoster, byId: ReadonlyMap<string, Athlete>, tier: number, rng: Rng): void {
  const count = rng.int(GENERATION.starsPerTeamMin, GENERATION.starsPerTeamMax)
    + (tier >= LEAGUE_GEN.topTierThreshold ? GENERATION.topTierStarBonus : 0);
  const taken = new Set<Position>();
  for (let s = 0; s < count; s++) {
    let pos: Position | null = null;
    for (let t = 0; t < 12 && pos === null; t++) {
      const cand = rng.pick(STAR_POSITIONS);
      if (!taken.has(cand)) pos = cand;
    }
    if (pos === null) break;
    taken.add(pos);
    const id = roster.depth[pos][0];
    if (id === undefined) continue;
    const a = byId.get(id);
    if (a === undefined) continue;
    boostToStar(a, rng);
  }
}

function boostToStar(a: Athlete, rng: Rng): void {
  const primaries = PRIMARY_ATTRS[a.pos];
  for (let i = 0; i < primaries.length; i++) {
    const key = req(primaries, i);
    a.ratings[key] = clamp(
      a.ratings[key] + rng.int(GENERATION.starPrimaryBoostMin, GENERATION.starPrimaryBoostMax),
      GENERATION.ratingMin,
      GENERATION.ratingMax,
    );
  }
  const signature = rng.pick(primaries);
  const target = rng.int(GENERATION.signatureMin, GENERATION.signatureMax);
  if (a.ratings[signature] < target) a.ratings[signature] = target;
  a.overall = computeOverall(a.pos, a.ratings);
}

/** Best rating an athlete owns — the "signature attribute" for star checks. */
export function peakRating(a: Athlete): number {
  let best = 0;
  for (let i = 0; i < RATING_KEYS.length; i++) {
    const v = a.ratings[req(RATING_KEYS, i)];
    if (v > best) best = v;
  }
  return best;
}

/** League-wide guarantee: at least N players with some attribute >= threshold. */
function ensureLeagueStars(teams: readonly Team[], rng: Rng): void {
  const thr = LEAGUE_GEN.starAttrThreshold;
  let stars = 0;
  for (let t = 0; t < teams.length; t++) {
    const roster = req(teams, t).roster;
    for (let i = 0; i < roster.athletes.length; i++) {
      if (peakRating(req(roster.athletes, i)) >= thr) stars++;
    }
  }
  for (let t = 0; t < teams.length && stars < GENERATION.leagueEliteGuarantee; t++) {
    const team = req(teams, t);
    const id = team.roster.depth.QB[0] ?? req(team.roster.athletes, 0).id;
    const a = athleteById(team.roster, id);
    if (peakRating(a) >= thr) continue;
    boostToStar(a, rng);
    stars++;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generateLeague(
  leagueSeed: number,
  seasonIndex: number,
  identities: readonly TeamIdentity[] = TEAM_IDENTITIES,
): LeagueState {
  const seed = seasonSeed(leagueSeed, seasonIndex);
  const tiers = computeTiers(seed, identities);
  const usedNames = new Set<string>();
  const teams: Team[] = [];

  for (let i = 0; i < identities.length; i++) {
    const identity = req(identities, i);
    const rng = new Rng(hashSeed(seed, 'roster', identity.id));
    const roster = buildRoster(identity, req(tiers, i), rng, usedNames);
    const summary = computeTeamRatings(roster);
    teams.push({ identity, roster, ovr: summary.ovr, off: summary.off, def: summary.def });
  }

  ensureLeagueStars(teams, new Rng(hashSeed(seed, 'stars')));
  // The star guarantee can move an OVR; recompute so cached ratings stay true.
  for (let i = 0; i < teams.length; i++) {
    const team = req(teams, i);
    const summary = computeTeamRatings(team.roster);
    team.off = summary.off;
    team.def = summary.def;
    team.ovr = summary.ovr;
  }

  return { leagueSeed, seasonIndex, teams };
}

export function findTeam(teams: readonly Team[], teamId: string): Team {
  for (let i = 0; i < teams.length; i++) {
    const t = req(teams, i);
    if (t.identity.id === teamId) return t;
  }
  throw new Error(`unknown team ${teamId}`);
}
