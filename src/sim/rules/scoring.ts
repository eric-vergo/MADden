// Scoring bookkeeping and the ball placements that follow a score.

import type { GameState, TeamSide } from '../types';
import {
  KICKOFF_SPOT_FROM_OWN_GOAL, TWO_POINT_FROM_GOAL_YD, XP_SNAP_FROM_GOAL_YD,
} from '../constants';
import { oppYardLineY, ownYardLineY, type Dir } from '../transform';
import { freshToGo, otherTeam } from './downs';
import { ext } from './ext';
import { DEFAULT_BALL_X } from '../transform';

export function quarterIndex(s: GameState): number {
  return Math.max(0, s.quarter - 1);
}

export function addPoints(s: GameState, team: TeamSide, points: number): void {
  s.score[team] += points;
  s.stats.teams[team].points += points;
  const row = s.stats.scoringByQuarter[team];
  const idx = quarterIndex(s);
  while (row.length <= idx) row.push(0);
  // Keep both rows the same length so the box score lines up.
  const other = s.stats.scoringByQuarter[otherTeam(team)];
  while (other.length < row.length) other.push(0);
  row[idx] = (row[idx] ?? 0) + points;
}

export function dirOf(s: GameState, team: TeamSide): Dir {
  return s.attackDir[team];
}

/** Put the ball down for a fresh series. */
export function setSeries(
  s: GameState,
  possession: TeamSide,
  ballOnY: number,
  down: number,
  toGo: number,
): void {
  s.possession = possession;
  s.ballOnY = ballOnY;
  s.down = down;
  s.toGo = toGo;
  ext(s).ballOnX = DEFAULT_BALL_X;
}

export function setFirstAndTen(s: GameState, possession: TeamSide, ballOnY: number): void {
  setSeries(s, possession, ballOnY, 1, freshToGo(ballOnY, dirOf(s, possession)));
}

/** Kicking team lines up at its own 35. */
export function setupKickoff(s: GameState, kickingTeam: TeamSide, free = false): void {
  const dir = dirOf(s, kickingTeam);
  const spot = free
    ? ownYardLineY(20, dir)
    : ownYardLineY(KICKOFF_SPOT_FROM_OWN_GOAL, dir);
  setSeries(s, kickingTeam, spot, 1, 10);
  s.nextPlayKind = free ? 'freeKick' : 'kickoff';
  s.clockRunning = false;
  ext(s).startClockOnSnap = false;
}

/** Try / two-point conversion placement. */
export function setupPat(s: GameState, scoringTeam: TeamSide, two: boolean): void {
  const dir = dirOf(s, scoringTeam);
  const spot = two
    ? oppYardLineY(TWO_POINT_FROM_GOAL_YD, dir)
    : oppYardLineY(XP_SNAP_FROM_GOAL_YD, dir);
  setSeries(s, scoringTeam, spot, 1, 10);
  s.nextPlayKind = 'pat';
  s.clockRunning = false;
  ext(s).startClockOnSnap = false;
  ext(s).patTwo = two;
}

/**
 * Classic two-point chart, applied only when it can actually change the
 * outcome (Q4 / OT). `diff` is the scoring team's lead AFTER the touchdown.
 */
const TWO_POINT_DIFFS: readonly number[] = [-10, -5, -2, -1, 1, 4, 5];

export function shouldGoForTwo(diff: number, quarter: number): boolean {
  if (quarter < 4) return false;
  return TWO_POINT_DIFFS.includes(diff);
}

/**
 * Modified sudden death: a score ends overtime once both teams have had a
 * possession, and immediately on a touchdown or safety.
 */
export function overtimeDecided(s: GameState, lastScoreKind: string | null): boolean {
  if (s.quarter < 5) return false;
  if (s.score[0] === s.score[1]) return false;
  if (lastScoreKind === 'td' || lastScoreKind === 'safety' || lastScoreKind === 'two') return true;
  return s.otPossessions[0] && s.otPossessions[1];
}
