// Position archetype tables consumed by the league generator (meta/league.ts)
// and by anything that needs to score a player. Pure data + one pure function.
//
// The generator's shape: team tier -> position-group mean -> per-slot target
// (groupMean - slot*dropoff) -> per-attribute roll. Primary attributes roll
// near the slot target; everything else fills in from the filler band, which is
// what makes a corner slow-footed at run blocking without extra bookkeeping.

import type { Position, RatingKey, Ratings } from '../sim/types';

/** Fixed iteration order — never enumerate the tables below by key. */
export const POSITION_ORDER: readonly Position[] = [
  'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P',
];

/** 40-man roster: the depth every formation in the playbook can field. */
export const ROSTER_PLAN: readonly (readonly [Position, number])[] = [
  ['QB', 2], ['RB', 3], ['WR', 5], ['TE', 2], ['OL', 7],
  ['DL', 6], ['LB', 6], ['CB', 4], ['S', 3], ['K', 1], ['P', 1],
];

export const ROSTER_SIZE = 40;

/**
 * Starters per position in the base personnel (4-3 defense).
 * Nickel swaps LB3 for CB3; dime swaps LB2 for CB4.
 */
export const STARTER_COUNTS: Record<Position, number> = {
  QB: 1, RB: 1, WR: 3, TE: 1, OL: 5,
  DL: 4, LB: 3, CB: 2, S: 2, K: 1, P: 1,
};

/** Attributes that define the archetype; these roll near the slot target. */
export const PRIMARY_ATTRS: Record<Position, readonly RatingKey[]> = {
  QB: ['tha', 'thp', 'awr', 'spd', 'agi'],
  RB: ['spd', 'acc', 'agi', 'str', 'car', 'cth', 'btk', 'elu'],
  WR: ['spd', 'acc', 'agi', 'cth', 'awr', 'elu'],
  TE: ['cth', 'rbk', 'pbk', 'str', 'spd'],
  OL: ['pbk', 'rbk', 'str', 'awr', 'agi'],
  DL: ['shd', 'str', 'tak', 'acc', 'hpw'],
  LB: ['tak', 'shd', 'mcv', 'zcv', 'spd', 'awr', 'hpw'],
  CB: ['mcv', 'zcv', 'spd', 'acc', 'agi', 'awr'],
  S: ['zcv', 'mcv', 'tak', 'spd', 'awr', 'hpw'],
  K: ['kpw', 'kac', 'awr'],
  P: ['kpw', 'kac', 'awr'],
};

/** Rating points lost per depth-chart slot below the starter. */
export const POSITION_DROPOFF: Record<Position, number> = {
  QB: 8, RB: 5, WR: 4, TE: 6, OL: 3,
  DL: 4, LB: 4, CB: 5, S: 5, K: 0, P: 0,
};

/** Cosmetic age bands. */
export const AGE_RANGES: Record<Position, readonly [number, number]> = {
  QB: [22, 38], RB: [21, 30], WR: [21, 34], TE: [21, 34], OL: [21, 34],
  DL: [21, 34], LB: [21, 34], CB: [21, 34], S: [21, 34], K: [21, 34], P: [21, 34],
};

/** Legal jersey bands per position; a team's numbers must stay unique. */
export const JERSEY_POOLS: Record<Position, readonly (readonly [number, number])[]> = {
  QB: [[1, 19]],
  RB: [[20, 39]],
  WR: [[10, 19], [80, 89]],
  TE: [[80, 89], [40, 49]],
  OL: [[50, 79]],
  DL: [[90, 99], [60, 79]],
  LB: [[40, 59], [90, 99]],
  CB: [[20, 39]],
  S: [[20, 49]],
  K: [[1, 9]],
  P: [[1, 9]],
};

// TODO(balance): roster-generation spread. Widening tierSpread makes the
// league more top-heavy; raising fillerMax makes backups less specialised.
export const GENERATION = {
  ratingMin: 40,
  ratingMax: 99,
  /** Step 1: per-team tier roll, then rank-remap onto [tierMin, tierMax]. */
  teamTierMean: 75,
  teamTierSigma: 6,
  tierMin: 66,
  tierMax: 86,
  tierJitter: 0.8,
  /** Step 2: position-group mean = clamp(tier + gauss*sigma, min, max). */
  groupMeanSigma: 4,
  groupMeanMin: 55,
  groupMeanMax: 92,
  /** Step 3: per-slot target and per-attribute roll. */
  slotSigma: 3,
  attrSigma: 4,
  fillerMin: 40,
  fillerMax: 65,
  /** Step 4: stars. */
  starsPerTeamMin: 1,
  starsPerTeamMax: 2,
  topTierStarBonus: 1,
  starPrimaryBoostMin: 8,
  starPrimaryBoostMax: 14,
  signatureMin: 93,
  signatureMax: 99,
  leagueEliteGuarantee: 6,
  /** Re-roll budget before falling back to a middle initial. */
  nameRerollTries: 20,
} as const;

// ---------------------------------------------------------------------------
// Overall rating
// ---------------------------------------------------------------------------

export interface OvrTerm {
  /** Share of the overall; a position's term weights sum to 1. */
  weight: number;
  /** Attribute blend inside the term; the inner weights sum to 1. */
  mix: readonly (readonly [RatingKey, number])[];
}

function attr(key: RatingKey, weight: number): OvrTerm {
  return { weight, mix: [[key, 1]] };
}

export const OVR_WEIGHTS: Record<Position, readonly OvrTerm[]> = {
  QB: [
    attr('tha', 0.30), attr('thp', 0.20), attr('awr', 0.25),
    attr('spd', 0.10), attr('agi', 0.10), attr('acc', 0.05),
  ],
  RB: [
    attr('spd', 0.25), attr('acc', 0.15), attr('agi', 0.20),
    attr('str', 0.10), attr('car', 0.15), attr('btk', 0.15),
  ],
  WR: [
    attr('spd', 0.28), attr('acc', 0.15), attr('agi', 0.15),
    attr('cth', 0.30), attr('awr', 0.12),
  ],
  TE: [
    attr('cth', 0.35),
    { weight: 0.25, mix: [['rbk', 0.5], ['pbk', 0.5]] },
    attr('str', 0.20), attr('spd', 0.12), attr('awr', 0.08),
  ],
  OL: [
    { weight: 0.45, mix: [['pbk', 0.5], ['rbk', 0.5]] },
    attr('str', 0.30), attr('awr', 0.15), attr('agi', 0.10),
  ],
  DL: [
    attr('shd', 0.35), attr('str', 0.30), attr('tak', 0.20), attr('acc', 0.15),
  ],
  LB: [
    attr('tak', 0.28),
    { weight: 0.20, mix: [['mcv', 0.5], ['zcv', 0.5]] },
    attr('shd', 0.17), attr('spd', 0.20), attr('awr', 0.15),
  ],
  CB: [
    { weight: 0.35, mix: [['mcv', 0.7], ['zcv', 0.3]] },
    attr('spd', 0.25), attr('acc', 0.15), attr('agi', 0.15), attr('awr', 0.10),
  ],
  S: [
    { weight: 0.30, mix: [['zcv', 0.7], ['mcv', 0.3]] },
    attr('tak', 0.25), attr('spd', 0.25), attr('awr', 0.20),
  ],
  K: [attr('kac', 0.55), attr('kpw', 0.35), attr('awr', 0.10)],
  P: [attr('kac', 0.55), attr('kpw', 0.35), attr('awr', 0.10)],
};

/** Position-weighted overall, clamped to the legal rating band. */
export function computeOverall(pos: Position, ratings: Ratings): number {
  let total = 0;
  for (const term of OVR_WEIGHTS[pos]) {
    let sub = 0;
    for (const [key, share] of term.mix) sub += ratings[key] * share;
    total += sub * term.weight;
  }
  const rounded = Math.round(total);
  if (rounded < GENERATION.ratingMin) return GENERATION.ratingMin;
  if (rounded > GENERATION.ratingMax) return GENERATION.ratingMax;
  return rounded;
}

// ---------------------------------------------------------------------------
// Team-level ratings (meta-design §3). Inputs are per-player overalls already
// resolved off the depth chart, in depth order.
// ---------------------------------------------------------------------------

export const TEAM_OVR_WEIGHTS = {
  off: { qb1: 0.30, rb1: 0.12, wrTop3: 0.25, te1: 0.08, olStarters: 0.25 },
  def: { dlStarters: 0.35, lbStarters: 0.25, cbTop2: 0.25, safeties: 0.15 },
  overall: { off: 0.5, def: 0.45, kicker: 0.05 },
} as const;

/** OVR colour ramp thresholds used by the UI. */
export const OVR_TIERS = { gold: 85, green: 78, white: 70 } as const;
