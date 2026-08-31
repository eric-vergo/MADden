// League generation: 16 canonical identities -> 40-man rosters with a ranked
// team-tier spread, position-group means, per-slot dropoff, star injection and
// a league-wide star guarantee. Pure: every random draw comes from a seeded Rng
// keyed by hashSeed(seasonSeed, 'roster', teamId), so the same
// (leagueSeed, seasonIndex) always rebuilds byte-identical rosters.

import type { Athlete, Position, RatingKey, Ratings, TeamRoster } from '../sim/types';
import { Rng, hashSeed } from '../sim/rng';
import type { LeagueState, Team, TeamIdentity } from './types';
import {
  AGE_RANGE, BLOCKED_FULL_NAMES, FIRST_NAMES, JERSEY_POOLS, LAST_NAMES,
  PRIMARY_ATTRS, RATING_KEYS, ROSTER_PLAN, SLOT_DROPOFF, TEAM_IDENTITIES,
} from './placeholderData';
import { avg, clamp, req } from './util';

// TODO(balance) — league-generation tunables (design §2). Move to data/balance.ts
// in the consolidation pass; do NOT edit balance.ts concurrently.
export const LEAGUE_GEN = {
  tierRollMean: 75, tierRollSigma: 6,
  tierMin: 66, tierMax: 86, tierJitter: 0.5,
  groupMeanSigma: 4, groupMeanMin: 55, groupMeanMax: 92,
  slotSigma: 3, attrSigma: 4,
  attrMin: 40, attrMax: 99,
  nonPrimaryMin: 40, nonPrimaryMax: 65,
  starsMin: 1, starsMax: 2, topTierThreshold: 82,
  starBoostMin: 8, starBoostMax: 14,
  signatureMin: 93, signatureMax: 99,
  leagueStarAttrThreshold: 93, leagueStarGuarantee: 6,
  nameTries: 20,
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
// OVR formulas (design §3) — weights sum to 1.0 per position.
// ---------------------------------------------------------------------------

export function computeOverall(pos: Position, r: Readonly<Ratings>): number {
  switch (pos) {
    case 'QB':
      return Math.round(0.30 * r.tha + 0.20 * r.thp + 0.25 * r.awr + 0.10 * r.spd + 0.10 * r.agi + 0.05 * r.acc);
    case 'RB':
      return Math.round(0.25 * r.spd + 0.15 * r.acc + 0.20 * r.agi + 0.10 * r.str + 0.15 * r.car + 0.15 * r.btk);
    case 'WR':
      return Math.round(0.28 * r.spd + 0.15 * r.acc + 0.15 * r.agi + 0.30 * r.cth + 0.12 * r.awr);
    case 'TE':
      return Math.round(0.35 * r.cth + 0.25 * ((r.rbk + r.pbk) / 2) + 0.20 * r.str + 0.12 * r.spd + 0.08 * r.awr);
    case 'OL':
      return Math.round(0.45 * ((r.pbk + r.rbk) / 2) + 0.30 * r.str + 0.15 * r.awr + 0.10 * r.agi);
    case 'DL':
      return Math.round(0.35 * r.shd + 0.30 * r.str + 0.20 * r.tak + 0.15 * r.acc);
    case 'LB':
      return Math.round(0.28 * r.tak + 0.20 * ((r.mcv + r.zcv) / 2) + 0.17 * r.shd + 0.20 * r.spd + 0.15 * r.awr);
    case 'CB':
      return Math.round(0.35 * (r.mcv * 0.7 + r.zcv * 0.3) + 0.25 * r.spd + 0.15 * r.acc + 0.15 * r.agi + 0.10 * r.awr);
    case 'S':
      return Math.round(0.30 * (r.zcv * 0.7 + r.mcv * 0.3) + 0.25 * r.tak + 0.25 * r.spd + 0.20 * r.awr);
    case 'K':
    case 'P':
      return Math.round(0.55 * r.kac + 0.35 * r.kpw + 0.10 * r.awr);
  }
}

/** Depth-chart lookup: ids of the top `n` at a position, best first. */
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
  const qb = req(starterOvrs(roster, 'QB', 1), 0);
  const rb = req(starterOvrs(roster, 'RB', 1), 0);
  const wr = avg(starterOvrs(roster, 'WR', 3));
  const te = req(starterOvrs(roster, 'TE', 1), 0);
  const ol = avg(starterOvrs(roster, 'OL', 5));
  const dl = avg(starterOvrs(roster, 'DL', 4));
  const lb = avg(starterOvrs(roster, 'LB', 3));
  const cb = avg(starterOvrs(roster, 'CB', 2));
  const s = avg(starterOvrs(roster, 'S', 2));
  const k = req(starterOvrs(roster, 'K', 1), 0);

  const off = 0.30 * qb + 0.12 * rb + 0.25 * wr + 0.08 * te + 0.25 * ol;
  const def = 0.35 * dl + 0.25 * lb + 0.25 * cb + 0.15 * s;
  return { off: Math.round(off), def: Math.round(def), ovr: Math.round(0.5 * off + 0.45 * def + 0.05 * k) };
}

/** Design §3 color ramp for OVR chips. */
export function ovrTier(ovr: number): 'gold' | 'green' | 'white' | 'gray' {
  if (ovr >= 85) return 'gold';
  if (ovr >= 78) return 'green';
  if (ovr >= 70) return 'white';
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
    rolls.push({ i, id: req(identities, i).id, v: LEAGUE_GEN.tierRollMean + rng.gauss() * LEAGUE_GEN.tierRollSigma });
  }
  rolls.sort((a, b) => (b.v - a.v) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const span = LEAGUE_GEN.tierMax - LEAGUE_GEN.tierMin;
  const last = Math.max(1, identities.length - 1);
  const tiers = new Array<number>(identities.length).fill(0);
  for (let rank = 0; rank < rolls.length; rank++) {
    const entry = req(rolls, rank);
    const base = LEAGUE_GEN.tierMax - (rank / last) * span;
    const jitter = (rng.next() * 2 - 1) * LEAGUE_GEN.tierJitter;
    tiers[entry.i] = clamp(base + jitter, LEAGUE_GEN.tierMin, LEAGUE_GEN.tierMax);
  }
  return tiers;
}

// ---------------------------------------------------------------------------
// Names & jerseys
// ---------------------------------------------------------------------------

const MIDDLE_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function rollName(rng: Rng, used: Set<string>): { firstName: string; lastName: string } {
  for (let t = 0; t < LEAGUE_GEN.nameTries; t++) {
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
    const firstName = `${first} ${MIDDLE_INITIALS[m]}.`;
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
      ? clamp(Math.round(target + rng.gauss() * LEAGUE_GEN.attrSigma), LEAGUE_GEN.attrMin, LEAGUE_GEN.attrMax)
      : rng.int(LEAGUE_GEN.nonPrimaryMin, LEAGUE_GEN.nonPrimaryMax);
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
      tier + rng.gauss() * LEAGUE_GEN.groupMeanSigma,
      LEAGUE_GEN.groupMeanMin,
      LEAGUE_GEN.groupMeanMax,
    );
    const dropoff = SLOT_DROPOFF[pos];
    const [ageLo, ageHi] = AGE_RANGE[pos];
    for (let k = 0; k < count; k++) {
      const target = groupMean - k * dropoff + rng.gauss() * LEAGUE_GEN.slotSigma;
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
  const count = rng.int(LEAGUE_GEN.starsMin, LEAGUE_GEN.starsMax) + (tier >= LEAGUE_GEN.topTierThreshold ? 1 : 0);
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
      a.ratings[key] + rng.int(LEAGUE_GEN.starBoostMin, LEAGUE_GEN.starBoostMax),
      LEAGUE_GEN.attrMin,
      LEAGUE_GEN.attrMax,
    );
  }
  const signature = rng.pick(primaries);
  const target = rng.int(LEAGUE_GEN.signatureMin, LEAGUE_GEN.signatureMax);
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
  const thr = LEAGUE_GEN.leagueStarAttrThreshold;
  let stars = 0;
  for (let t = 0; t < teams.length; t++) {
    const roster = req(teams, t).roster;
    for (let i = 0; i < roster.athletes.length; i++) {
      if (peakRating(req(roster.athletes, i)) >= thr) stars++;
    }
  }
  for (let t = 0; t < teams.length && stars < LEAGUE_GEN.leagueStarGuarantee; t++) {
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
  // Star guarantee can move an OVR; recompute so cached team ratings stay true.
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
