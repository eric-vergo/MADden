// CPU play calling (sim-design §13). Situation → bucket → tag weights →
// per-play score (EWMA memory + variety penalty) → softmax with the difficulty
// temperature. Plus the 4th-down / 2-point charts and clock management.
//
// Determinism: the per-game memory is DERIVED from state.playLog on every
// call — there is no module-level mutable state, so replays reproduce exactly.

import type {
  DefPlayTag, DefensivePlayDef, Difficulty, GameState, OffensivePlayDef,
  PlayTag, TeamSide,
} from '../types';
import { DIFFICULTY, KICK } from '../../data/balance';
import type { Rng } from '../rng';
import { allDefensivePlays, allOffensivePlays, getOffensivePlay } from '../../data/plays/index';

// TODO(balance): play-calling tunables.
export const COACH = {
  ewmaAlpha: 0.3,
  ewmaPriorYds: 4.5,
  ewmaWeight: 0.12,
  ewmaMultMin: 0.5, ewmaMultMax: 1.6,
  varietyLookback: 4,
  varietyPenalty: 0.6,
  /** Spreads tag weights before the softmax so the temperature has bite. */
  tagScoreScale: 2.5,
  /** Hurry-up / milk / normal play-clock targets (seconds REMAINING). */
  hurryUpPlayClockSec: 26,
  milkPlayClockSec: 3,
  normalPlayClockMin: 12, normalPlayClockMax: 20,
  hurryUpSecLeft: 240,
  milkSecLeft: 300,
  defensiveTimeoutSecLeft: 180,
  spikeSecLeft: 35,
  fgRangeMarginYd: 4,
  runTendencyHigh: 0.6, runTendencyLow: 0.4,
  tendencyBoost: 1.4,
} as const;

export type Bucket =
  | '1st-10' | '2nd-short' | '2nd-long'
  | '3rd-short' | '3rd-medium' | '3rd-long'
  | 'red-zone' | 'goal-to-go' | 'two-min-trailing' | 'four-min-leading';

export interface Situation {
  down: number;
  toGo: number;
  yardsToGoal: number;
  scoreDiff: number; // offense perspective
  quarter: number;
  secLeft: number;
  timeouts: number;
  oppTimeouts: number;
  isTwoMinute: boolean;
}

export function situationOf(state: GameState, team: TeamSide): Situation {
  const opp: TeamSide = team === 0 ? 1 : 0;
  const dir = state.attackDir[team];
  const goalY = dir === 1 ? 110 : 10;
  return {
    down: state.down,
    toGo: state.toGo,
    yardsToGoal: Math.abs(goalY - state.ballOnY),
    scoreDiff: state.score[team] - state.score[opp],
    quarter: state.quarter,
    secLeft: state.clockSec,
    timeouts: state.timeouts[team],
    oppTimeouts: state.timeouts[opp],
    isTwoMinute: state.clockSec <= 120,
  };
}

export function bucketOf(sit: Situation): Bucket {
  if (sit.quarter >= 4 && sit.scoreDiff > 0 && sit.secLeft <= COACH.milkSecLeft) {
    return 'four-min-leading';
  }
  if (
    (sit.quarter === 2 || sit.quarter >= 4)
    && sit.isTwoMinute
    && sit.scoreDiff <= 0
  ) {
    return 'two-min-trailing';
  }
  if (sit.yardsToGoal <= sit.toGo) return 'goal-to-go';
  if (sit.yardsToGoal <= 20) return 'red-zone';
  if (sit.down === 3) {
    if (sit.toGo <= 2) return '3rd-short';
    if (sit.toGo <= 6) return '3rd-medium';
    return '3rd-long';
  }
  if (sit.down === 2) return sit.toGo <= 3 ? '2nd-short' : '2nd-long';
  return '1st-10';
}

// TODO(balance): offensive tag weight table.
const TAG_WEIGHTS: Record<Bucket, Partial<Record<PlayTag, number>>> = {
  '1st-10': {
    'run-inside': 1.0, 'run-outside': 0.8, draw: 0.25,
    quick: 0.8, medium: 0.9, deep: 0.45, screen: 0.3, 'play-action': 0.55,
  },
  '2nd-short': {
    'run-inside': 1.2, 'run-outside': 0.9,
    quick: 0.6, medium: 0.5, deep: 0.35, 'play-action': 0.6,
  },
  '2nd-long': {
    'run-inside': 0.4, 'run-outside': 0.4, draw: 0.5,
    quick: 0.7, medium: 1.0, deep: 0.6, screen: 0.5, 'play-action': 0.5,
  },
  '3rd-short': {
    'run-inside': 1.6, 'run-outside': 1.0,
    quick: 0.8, medium: 0.2, 'play-action': 0.4, 'goal-line': 0.7,
  },
  '3rd-medium': {
    quick: 1.0, medium: 1.1, deep: 0.3, screen: 0.4, 'run-outside': 0.3,
  },
  '3rd-long': {
    medium: 1.2, deep: 0.8, quick: 0.5, screen: 0.4, draw: 0.2,
  },
  'red-zone': {
    'run-inside': 1.0, quick: 1.0, medium: 0.7, 'goal-line': 0.6,
    'play-action': 0.6, deep: 0.15, 'run-outside': 0.6,
  },
  'goal-to-go': {
    'goal-line': 1.3, 'run-inside': 1.1, quick: 0.9, 'play-action': 0.5,
  },
  'two-min-trailing': {
    quick: 1.1, medium: 1.2, deep: 0.7, screen: 0.3,
    'run-inside': 0.15, 'run-outside': 0.2,
  },
  'four-min-leading': {
    'run-inside': 1.4, 'run-outside': 1.0, draw: 0.4,
    quick: 0.4, medium: 0.25, 'play-action': 0.35,
  },
};

// TODO(balance): defensive tag weight table.
const DEF_TAG_WEIGHTS: Record<Bucket, Partial<Record<DefPlayTag, number>>> = {
  '1st-10': { zone: 0.9, man: 0.8, blitz: 0.4, contain: 0.5, 'run-commit': 0.3 },
  '2nd-short': { 'run-commit': 0.8, man: 0.7, zone: 0.7, blitz: 0.5 },
  '2nd-long': { zone: 1.0, man: 0.7, blitz: 0.5, contain: 0.4 },
  '3rd-short': { 'run-commit': 1.0, blitz: 0.9, man: 0.8, zone: 0.4 },
  '3rd-medium': { zone: 1.0, man: 0.9, blitz: 0.7 },
  '3rd-long': { zone: 1.1, blitz: 0.7, man: 0.6, prevent: 0.3 },
  'red-zone': { man: 1.0, zone: 0.8, blitz: 0.6, 'run-commit': 0.5 },
  'goal-to-go': { 'run-commit': 1.0, man: 0.9, blitz: 0.6 },
  'two-min-trailing': { prevent: 1.0, zone: 1.0, contain: 0.6, man: 0.5, blitz: 0.2 },
  'four-min-leading': { 'run-commit': 1.0, blitz: 0.8, man: 0.7, zone: 0.5 },
};

const NON_NORMAL_TYPES = new Set([
  'kickoff', 'punt', 'fieldGoal', 'extraPoint', 'twoPoint', 'kneel', 'spike',
]);

// ---------------------------------------------------------------------------
// Per-game memory (derived from the play log every call)
// ---------------------------------------------------------------------------

export interface CoachMemory {
  tagYds: Map<PlayTag, number>;
  recentPlayIds: string[];
  runRate: number;
}

export function coachMemory(state: GameState, team: TeamSide): CoachMemory {
  const tagYds = new Map<PlayTag, number>();
  const recent: string[] = [];
  let runs = 0;
  let plays = 0;
  for (const entry of state.playLog) {
    if (entry.possession !== team) continue;
    const play = getOffensivePlay(entry.offensePlayId);
    if (!play) continue;
    if (NON_NORMAL_TYPES.has(play.type)) continue;
    plays++;
    if (play.type === 'run') runs++;
    recent.push(play.id);
    for (const tag of play.tags) {
      const prev = tagYds.get(tag) ?? COACH.ewmaPriorYds;
      tagYds.set(tag, prev * (1 - COACH.ewmaAlpha) + entry.yards * COACH.ewmaAlpha);
    }
  }
  return {
    tagYds,
    recentPlayIds: recent.slice(Math.max(0, recent.length - COACH.varietyLookback)),
    runRate: plays === 0 ? 0.5 : runs / plays,
  };
}

/**
 * Two-stage selection (design §13): weight the TAG, then score plays within
 * it. Keeping the tag as the unit means a bucket's run/pass split does not
 * drift just because the playbook holds more passes than runs.
 */
function pickTag<T extends string>(
  weights: Partial<Record<T, number>>,
  available: T[],
  temp: number,
  rng: Rng,
): T | null {
  const cands: Array<{ id: string; score: number }> = [];
  for (const tag of available) {
    const w = weights[tag];
    if (w === undefined || w <= 0) continue;
    cands.push({ id: tag, score: w * COACH.tagScoreScale });
  }
  if (cands.length === 0) return null;
  return softmaxPick(cands, temp, rng) as T;
}

function memoryMult(play: OffensivePlayDef, mem: CoachMemory): number {
  let sum = 0;
  let n = 0;
  for (const tag of play.tags) {
    const v = mem.tagYds.get(tag);
    if (v !== undefined) { sum += v; n++; }
  }
  if (n === 0) return 1;
  const avg = sum / n;
  const mult = 1 + COACH.ewmaWeight * (avg - COACH.ewmaPriorYds);
  return Math.max(COACH.ewmaMultMin, Math.min(COACH.ewmaMultMax, mult));
}

/** Softmax sample over (id, score) pairs. Fixed candidate order = determinism. */
function softmaxPick(
  cands: Array<{ id: string; score: number }>,
  temp: number,
  rng: Rng,
): string {
  if (cands.length === 0) return '';
  if (cands.length === 1) return (cands[0] as { id: string }).id;
  let max = -Infinity;
  for (const c of cands) if (c.score > max) max = c.score;
  const t = Math.max(0.05, temp);
  const weights: number[] = [];
  let total = 0;
  for (const c of cands) {
    const w = Math.exp((c.score - max) / t);
    weights.push(w);
    total += w;
  }
  let roll = rng.next() * total;
  for (let i = 0; i < cands.length; i++) {
    roll -= weights[i] as number;
    if (roll <= 0) return (cands[i] as { id: string }).id;
  }
  return (cands[cands.length - 1] as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Special situations
// ---------------------------------------------------------------------------

function playsOfType(type: string): OffensivePlayDef[] {
  return allOffensivePlays().filter((p) => p.type === type);
}

function kickerKpw(state: GameState, team: TeamSide): number {
  const roster = state.rosters[team];
  const kid = roster.depth.K[0];
  if (kid) {
    const a = roster.athletes.find((x) => x.id === kid);
    if (a) return a.ratings.kpw;
  }
  return 75;
}

export function fieldGoalRangeYd(state: GameState, team: TeamSide): number {
  return KICK.fgMaxRangeBase + KICK.fgMaxRangePerKpw * (kickerKpw(state, team) / 99);
}

export type FourthChoice = 'go' | 'fg' | 'punt';

export function fourthDownChoice(
  state: GameState,
  team: TeamSide,
  sit: Situation,
  difficulty: Difficulty,
): FourthChoice {
  const fgDist = sit.yardsToGoal + 17;
  const inRange = fgDist <= fieldGoalRangeYd(state, team) - COACH.fgRangeMarginYd;
  const chart = DIFFICULTY[difficulty].fourthDownChart;

  // Desperation: trailing late, a punt or short FG cannot win it.
  const late = sit.quarter >= 4 && sit.secLeft <= 300;
  if (late && sit.scoreDiff < 0) {
    const needTd = sit.scoreDiff < -3;
    if (!inRange) return 'go';
    if (needTd && sit.secLeft <= 120) return 'go';
  }

  let go = false;
  switch (chart) {
    case 'naive':
      go = sit.toGo <= 1 && sit.yardsToGoal <= 50;
      break;
    case 'book':
      go = (sit.toGo <= 2 && sit.yardsToGoal <= 45) || (sit.toGo <= 1 && sit.yardsToGoal <= 60);
      break;
    case 'analytic':
      go = (sit.toGo <= 4 && sit.yardsToGoal <= 45) || (sit.toGo <= 2 && sit.yardsToGoal <= 60);
      break;
    default:
      go = (sit.toGo <= 6 && sit.yardsToGoal <= 45) || (sit.toGo <= 3 && sit.yardsToGoal <= 65);
      break;
  }
  // Never gamble deep in our own end unless desperate.
  if (go && sit.yardsToGoal > 70) go = false;
  if (go) return 'go';
  if (inRange) return 'fg';
  return 'punt';
}

/** Classic 2-point chart on the pre-PAT margin, late only. */
export function goForTwo(state: GameState, team: TeamSide): boolean {
  const opp: TeamSide = team === 0 ? 1 : 0;
  const diff = state.score[team] - state.score[opp];
  if (state.quarter < 4) return false;
  return diff === -10 || diff === -5 || diff === -2 || diff === -1
    || diff === 1 || diff === 4 || diff === 5;
}

export function shouldKneel(state: GameState, team: TeamSide, sit: Situation): boolean {
  if (state.quarter < 4 || sit.scoreDiff <= 0) return false;
  const need = (4 - sit.down) * 41 - 41 * sit.oppTimeouts;
  return sit.secLeft < need;
}

export function shouldSpike(state: GameState, team: TeamSide, sit: Situation): boolean {
  if (!state.clockRunning) return false;
  if (sit.down >= 4) return false;
  if (sit.timeouts > 0) return false;
  const needsScore = sit.scoreDiff <= 0 || (sit.quarter >= 4 && sit.scoreDiff < 4);
  const late = (sit.quarter === 2 || sit.quarter >= 4) && sit.secLeft < COACH.spikeSecLeft;
  return needsScore && late;
}

/** Play-clock seconds REMAINING at which the CPU wants to snap. */
export function snapPlayClockTarget(state: GameState, team: TeamSide, rng: Rng): number {
  const sit = situationOf(state, team);
  const hurry = (sit.quarter === 2 || sit.quarter >= 4)
    && sit.secLeft <= COACH.hurryUpSecLeft && sit.scoreDiff <= 0;
  if (hurry) return COACH.hurryUpPlayClockSec;
  if (sit.quarter >= 4 && sit.scoreDiff > 0 && sit.secLeft <= COACH.milkSecLeft) {
    return COACH.milkPlayClockSec;
  }
  return rng.int(COACH.normalPlayClockMin, COACH.normalPlayClockMax);
}

/** Defensive timeouts: trailing in the last three minutes of Q4. */
export function cpuShouldCallTimeout(state: GameState, team: TeamSide): boolean {
  const opp: TeamSide = team === 0 ? 1 : 0;
  if (state.timeouts[team] <= 0) return false;
  if (state.quarter < 4 || state.clockSec > COACH.defensiveTimeoutSecLeft) return false;
  if (!state.clockRunning) return false;
  if (state.possession === team) return false;
  return state.score[team] < state.score[opp];
}

// ---------------------------------------------------------------------------
// Offense
// ---------------------------------------------------------------------------

export function chooseOffensePlay(state: GameState, team: TeamSide, rng: Rng): string {
  const plays = allOffensivePlays();
  const kind = state.nextPlayKind;

  if (kind === 'kickoff' || kind === 'freeKick') {
    const ko = playsOfType('kickoff');
    if (ko.length > 0) return (ko[0] as OffensivePlayDef).id;
  }
  if (kind === 'pat') {
    const two = playsOfType('twoPoint');
    if (goForTwo(state, team) && two.length > 0) {
      return softmaxPick(two.map((p) => ({ id: p.id, score: 1 })), 1, rng);
    }
    const xp = playsOfType('extraPoint');
    if (xp.length > 0) return (xp[0] as OffensivePlayDef).id;
    if (two.length > 0) return (two[0] as OffensivePlayDef).id;
  }

  const sit = situationOf(state, team);

  if (shouldKneel(state, team, sit)) {
    const kneel = playsOfType('kneel');
    if (kneel.length > 0) return (kneel[0] as OffensivePlayDef).id;
  }
  if (shouldSpike(state, team, sit)) {
    const spike = playsOfType('spike');
    if (spike.length > 0) return (spike[0] as OffensivePlayDef).id;
  }

  if (sit.down === 4) {
    const choice = fourthDownChoice(state, team, sit, state.config.difficulty);
    if (choice === 'fg') {
      const fg = playsOfType('fieldGoal');
      if (fg.length > 0) return (fg[0] as OffensivePlayDef).id;
    }
    if (choice === 'punt') {
      const punt = playsOfType('punt');
      if (punt.length > 0) return (punt[0] as OffensivePlayDef).id;
      const fg = playsOfType('fieldGoal');
      if (fg.length > 0) return (fg[0] as OffensivePlayDef).id;
    }
  }

  const bucket = bucketOf(sit);
  const weights = TAG_WEIGHTS[bucket];
  const mem = coachMemory(state, team);
  const temp = DIFFICULTY[state.config.difficulty].playCallSoftmaxTemp;
  const normal = plays.filter((p) => !NON_NORMAL_TYPES.has(p.type));

  // Tags present in this playbook, in a fixed order.
  const available: PlayTag[] = [];
  for (const p of normal) {
    for (const tag of p.tags) if (!available.includes(tag)) available.push(tag);
  }
  const tag = pickTag(weights, available, temp, rng);

  const inTag = tag === null ? normal : normal.filter((p) => p.tags.includes(tag));
  const pool: Array<{ id: string; score: number }> = [];
  for (const p of inTag) {
    const variety = mem.recentPlayIds.includes(p.id) ? COACH.varietyPenalty : 1;
    pool.push({ id: p.id, score: memoryMult(p, mem) * variety * COACH.tagScoreScale });
  }
  if (pool.length === 0) {
    if (normal.length > 0) return (normal[0] as OffensivePlayDef).id;
    return (plays[0] as OffensivePlayDef).id;
  }
  return softmaxPick(pool, temp, rng);
}

// ---------------------------------------------------------------------------
// Defense
// ---------------------------------------------------------------------------

function hasRole(play: DefensivePlayDef, role: 'KR' | 'PR'): boolean {
  return play.assignments[role] !== undefined;
}

function specialTeamsUnit(kind: 'kickReturn' | 'puntReturn' | 'fgBlock'): DefensivePlayDef | undefined {
  const st = allDefensivePlays().filter((p) => p.shell === 'specialTeams');
  if (kind === 'kickReturn') return st.find((p) => hasRole(p, 'KR'));
  if (kind === 'puntReturn') return st.find((p) => hasRole(p, 'PR'));
  return st.find((p) => !hasRole(p, 'KR') && !hasRole(p, 'PR'));
}

export function chooseDefensePlay(state: GameState, team: TeamSide, rng: Rng): string {
  const plays = allDefensivePlays();
  const kind = state.nextPlayKind;
  const offPlay = state.selectedOffensePlayId
    ? getOffensivePlay(state.selectedOffensePlayId)
    : undefined;
  const offType = offPlay?.type;

  if (kind === 'kickoff' || kind === 'freeKick' || offType === 'kickoff') {
    const u = specialTeamsUnit('kickReturn');
    if (u) return u.id;
  }
  if (offType === 'punt') {
    const u = specialTeamsUnit('puntReturn');
    if (u) return u.id;
  }
  if (offType === 'fieldGoal' || offType === 'extraPoint' || kind === 'pat') {
    const u = specialTeamsUnit('fgBlock');
    if (u) return u.id;
  }

  const off: TeamSide = team === 0 ? 1 : 0;
  const sit = situationOf(state, off);
  const bucket = bucketOf(sit);
  const weights = DEF_TAG_WEIGHTS[bucket];
  const diff = DIFFICULTY[state.config.difficulty];
  const mem = diff.cpuReadsUserTendencies ? coachMemory(state, off) : null;

  const base = plays.filter((p) => p.shell !== 'specialTeams');
  const available: DefPlayTag[] = [];
  for (const p of base) {
    for (const tag of p.tags) if (!available.includes(tag)) available.push(tag);
  }
  // Read the offense's run/pass tendency at All-Pro and above.
  const adjusted: Partial<Record<DefPlayTag, number>> = { ...weights };
  if (mem) {
    for (const tag of available) {
      const w = adjusted[tag];
      if (w === undefined) continue;
      if (tag === 'run-commit' && mem.runRate > COACH.runTendencyHigh) {
        adjusted[tag] = w * COACH.tendencyBoost;
      }
      if ((tag === 'zone' || tag === 'man') && mem.runRate < COACH.runTendencyLow) {
        adjusted[tag] = w * COACH.tendencyBoost;
      }
    }
  }
  const tag = pickTag(adjusted, available, diff.playCallSoftmaxTemp, rng);
  const inTag = tag === null ? base : base.filter((p) => p.tags.includes(tag));
  const pool = (inTag.length > 0 ? inTag : base).map((p) => ({
    id: p.id,
    score: COACH.tagScoreScale,
  }));
  if (pool.length === 0) return (plays[0] as DefensivePlayDef).id;
  return softmaxPick(pool, diff.playCallSoftmaxTemp, rng);
}
