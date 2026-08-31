// Shared plumbing for the phase handlers: quarter/half/overtime routing,
// returning to PLAY_CALL, and dead-ball penalty enforcement.

import {
  GamePhase, type GameState, type PenaltyFlag, type TeamSide,
} from '../types';
import type { SimEvent } from '../events';
import { OT_LENGTH_SEC, PLAY_CLOCK_SHORT_SEC, TIMEOUTS_PER_HALF } from '../constants';
import { ext, setPhase } from '../rules/ext';
import { currentLineToGain, PENALTY_YARDS } from '../rules/penalties';
import { enforceYards, freshToGo, isFirstDown, otherTeam } from '../rules/downs';
import { clampFieldY } from '../transform';
import { recordPenalty } from '../stats';

/** Overtime periods played before a tie is declared regardless of config. */
export const MAX_OT_PERIODS = 4; // TODO(balance)

/** Ticks a CPU-only game waits at a break before continuing itself. */
export const AUTO_CONTINUE_TICKS = 60; // TODO(balance)

export function hasUser(s: GameState): boolean {
  return s.config.userTeam !== null;
}

export function beginPlayCall(s: GameState): void {
  s.play = null;
  s.selectedOffensePlayId = null;
  s.selectedDefensePlayId = null;
  s.pendingPenalty = null;
  setPhase(s, GamePhase.PLAY_CALL);
}

export function swapEnds(s: GameState): void {
  s.attackDir = [s.attackDir[0] === 1 ? -1 : 1, s.attackDir[1] === 1 ? -1 : 1];
  s.ballOnY = 120 - s.ballOnY;
}

export function endGame(s: GameState, events: SimEvent[]): void {
  const e = ext(s);
  if (!e.gameOverEmitted) {
    e.gameOverEmitted = true;
    events.push({ type: 'GAME_OVER', tick: s.tick, finalScore: [s.score[0], s.score[1]] });
  }
  setPhase(s, GamePhase.GAME_OVER);
}

/**
 * Consume an expired game clock. Called from any pre-snap phase and from
 * PLAY_DEAD once the play's result has been applied.
 */
export function endQuarterNow(s: GameState, events: SimEvent[]): void {
  const e = ext(s);
  e.quarterExpired = false;
  s.clockRunning = false;
  s.play = null;
  events.push({ type: 'QUARTER_END', tick: s.tick, quarter: s.quarter });

  if (s.quarter === 2) {
    events.push({ type: 'HALFTIME', tick: s.tick });
    setPhase(s, GamePhase.HALFTIME);
    return;
  }
  if (s.quarter >= 4) {
    if (s.score[0] !== s.score[1]) {
      endGame(s, events);
      return;
    }
    if (s.quarter === 4) {
      setPhase(s, GamePhase.OVERTIME_TOSS);
      return;
    }
    // Overtime period ended level.
    if (s.config.allowTies || e.otPeriods >= MAX_OT_PERIODS) {
      endGame(s, events);
      return;
    }
    setPhase(s, GamePhase.OVERTIME_TOSS);
    return;
  }
  setPhase(s, GamePhase.QUARTER_BREAK);
}

/** Q1→Q2 and Q3→Q4: swap ends, keep the drive alive. */
export function startNextQuarter(s: GameState): void {
  s.quarter += 1;
  s.clockSec = s.config.quarterLengthSec;
  s.clockRunning = false;
  s.playClockSec = PLAY_CLOCK_SHORT_SEC;
  ext(s).startClockOnSnap = true;
  swapEnds(s);
  beginPlayCall(s);
}

export function resetHalfTimeouts(s: GameState): void {
  s.timeouts = [TIMEOUTS_PER_HALF, TIMEOUTS_PER_HALF];
}

export function startOvertimePeriod(s: GameState): void {
  const e = ext(s);
  s.quarter = s.quarter < 5 ? 5 : s.quarter + 1;
  e.otPeriods += 1;
  s.clockSec = OT_LENGTH_SEC;
  s.clockRunning = false;
  s.playClockSec = PLAY_CLOCK_SHORT_SEC;
  s.otPossessions = [false, false];
  s.timeouts = [2, 2];
  swapEnds(s);
}

/**
 * Enforce a dead-ball foul immediately (false start, delay of game,
 * encroachment): 5 yards, replay the down, clock stopped.
 */
export function enforceDeadBallFoul(
  s: GameState,
  flag: PenaltyFlag,
  events: SimEvent[],
): void {
  const e = ext(s);
  const offense = s.possession;
  const dir = s.attackDir[offense];
  const againstOffense = flag.team === offense;
  const yards = PENALTY_YARDS[flag.kind];
  const lineY = currentLineToGain(s);
  const prevSpot = s.ballOnY;
  const newSpot = clampFieldY(enforceYards(prevSpot, yards, dir, againstOffense));
  const enforced = Math.abs(newSpot - prevSpot);

  events.push({ type: 'FLAG', tick: s.tick, flag });
  s.ballOnY = newSpot;
  if (!againstOffense && isFirstDown(newSpot, lineY, dir)) {
    s.down = 1;
    s.toGo = freshToGo(newSpot, dir);
    events.push({ type: 'FIRST_DOWN', tick: s.tick, team: offense });
  } else {
    s.toGo = Math.max(1, (lineY - newSpot) * dir);
  }
  events.push({
    type: 'PENALTY_ENFORCED', tick: s.tick, kind: flag.kind, team: flag.team, yards: enforced,
  });
  recordPenalty(s, flag.team, enforced);
  s.clockRunning = false;
  s.playClockSec = 40;
  e.startClockOnSnap = true;
  beginPlayCall(s);
}

export function offenseTeam(s: GameState): TeamSide {
  return s.possession;
}

export function defenseTeam(s: GameState): TeamSide {
  return otherTeam(s.possession);
}
