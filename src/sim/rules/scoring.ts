// Scoring bookkeeping and the ball placements that follow a score.

import type { GameState, TeamSide } from '../types';
import {
  KICKOFF_SPOT_FROM_OWN_GOAL, TOUCHBACK_KICKOFF_YD, TOUCHBACK_OTHER_YD,
  TWO_POINT_FROM_GOAL_YD, XP_SNAP_FROM_GOAL_YD,
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

/**
 * Put the ball down for a fresh series.
 * Deliberately does NOT touch ext.ballOnX: the lateral dead-ball spot is
 * computed by PLAY_DEAD (snapToHash) before the series is applied, and the next
 * snap comes from that hash. Only the placements that genuinely re-centre the
 * ball — kickoffs and tries — reset it, below.
 */
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
  ext(s).ballOnX = DEFAULT_BALL_X;
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
  ext(s).ballOnX = DEFAULT_BALL_X;
  s.nextPlayKind = 'pat';
  s.clockRunning = false;
  ext(s).startClockOnSnap = false;
  ext(s).patTwo = two;
}

/**
 * A missed field goal gives the opponent the ball at the spot of the kick, or
 * their own 20 — whichever is further from their goal line.
 */
export function missedFieldGoalSpot(kickSpotY: number, oppDir: Dir): number {
  const own20 = ownYardLineY(TOUCHBACK_OTHER_YD, oppDir);
  return (kickSpotY - own20) * oppDir > 0 ? kickSpotY : own20;
}

/** Touchback spot for the receiving team. */
export function touchbackSpot(style: 'kickoff' | 'punt', recvDir: Dir): number {
  return ownYardLineY(style === 'kickoff' ? TOUCHBACK_KICKOFF_YD : TOUCHBACK_OTHER_YD, recvDir);
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
 * Modified sudden death. Only a SCORE can end overtime: a touchdown, safety or
 * returned try ends it the moment it happens, anything else (a field goal) ends
 * it once both teams have had a possession. A dead ball that scored nothing
 * never ends the game, however lopsided the scoreboard is — the trailing team
 * still has its answering drive.
 */
export function overtimeDecided(s: GameState, lastScoreKind: string | null): boolean {
  if (s.quarter < 5) return false;
  if (lastScoreKind === null) return false;
  if (s.score[0] === s.score[1]) return false;
  if (lastScoreKind === 'td' || lastScoreKind === 'safety' || lastScoreKind === 'two') return true;
  return s.otPossessions[0] && s.otPossessions[1];
}
