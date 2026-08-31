// Game clock, play clock, two-minute warning, and the stoppage matrix.

import { GamePhase, type GameState } from '../types';
import type { SimEvent } from '../events';
import {
  PLAY_CLOCK_SEC, PLAY_CLOCK_SHORT_SEC, TICK_DT, TWO_MINUTE_SEC,
} from '../constants';
import { ext } from './ext';
import type { PlayOutcome } from './ext';

/** Halves are 1 (Q1-Q2) and 2 (Q3-Q4); overtime has no two-minute warning. */
export function halfOf(quarter: number): 1 | 2 | null {
  if (quarter <= 2) return 1;
  if (quarter <= 4) return 2;
  return null;
}

/** Quarter that carries the two-minute warning for its half. */
function isTwoMinuteQuarter(quarter: number): boolean {
  return quarter === 2 || quarter === 4;
}

/**
 * Advance the game clock one tick. Handles the two-minute warning (deferred to
 * the next dead ball if a play is live) and quarter expiry (flagged for the
 * phase handlers, which decide when the quarter actually ends).
 */
export function tickClock(s: GameState, events: SimEvent[]): void {
  const e = ext(s);
  if (!s.clockRunning || s.clockSec <= 0) return;

  const before = s.clockSec;
  s.clockSec = Math.max(0, s.clockSec - TICK_DT);
  s.stats.teams[s.possession].topSeconds += TICK_DT;

  const half = halfOf(s.quarter);
  if (
    half !== null && isTwoMinuteQuarter(s.quarter) && !s.twoMinuteFired[half - 1] &&
    before > TWO_MINUTE_SEC && s.clockSec <= TWO_MINUTE_SEC
  ) {
    if (s.phase === GamePhase.PLAY_LIVE) e.pendingTwoMinute = true;
    else fireTwoMinute(s, events);
  }

  if (s.clockSec <= 0) {
    s.clockSec = 0;
    s.clockRunning = false;
    e.quarterExpired = true;
  }
}

export function fireTwoMinute(s: GameState, events: SimEvent[]): void {
  const half = halfOf(s.quarter);
  if (half === null) return;
  if (s.twoMinuteFired[half - 1]) return;
  s.twoMinuteFired[half - 1] = true;
  ext(s).pendingTwoMinute = false;
  s.clockRunning = false;
  s.playClockSec = PLAY_CLOCK_SHORT_SEC;
  ext(s).startClockOnSnap = true;
  events.push({ type: 'TWO_MINUTE_WARNING', tick: s.tick, half });
}

/** Play clock tick; returns true when it expires (delay of game). */
export function tickPlayClock(s: GameState, events: SimEvent[]): boolean {
  if (s.playClockSec <= 0) return true;
  const before = s.playClockSec;
  s.playClockSec = Math.max(0, s.playClockSec - TICK_DT);
  if (before > 10 && s.playClockSec <= 10) {
    events.push({ type: 'PLAY_CLOCK_WARNING', tick: s.tick, secLeft: 10 });
  }
  return s.playClockSec <= 0;
}

/** True inside the window where an out-of-bounds run stops the clock. */
export function inTwoMinuteWindow(s: GameState): boolean {
  return isTwoMinuteQuarter(s.quarter) && s.clockSec <= TWO_MINUTE_SEC;
}

export interface ClockRuling {
  /** Clock stopped by the play's ending. */
  stop: boolean;
  /** Administrative stop -> 25-second play clock instead of 40. */
  admin: boolean;
}

/** The stoppage matrix. */
export function clockAfterPlay(s: GameState, o: PlayOutcome): ClockRuling {
  if (o.touchdown || o.safety || o.scoreKind !== null) return { stop: true, admin: true };
  if (o.turnover !== null || o.changeOfPossession) return { stop: true, admin: true };
  switch (o.deadReason) {
    case 'incomplete':
      return { stop: true, admin: false };
    case 'spike':
      return { stop: true, admin: false };
    case 'outOfBounds':
      return inTwoMinuteWindow(s) ? { stop: true, admin: false } : { stop: false, admin: false };
    case 'touchback':
    case 'fairCatch':
    case 'kickResolved':
      return { stop: true, admin: true };
    case 'penaltyDead':
      return { stop: true, admin: true };
    case 'kneel':
    case 'tackle':
    case 'sack':
    case 'runnerDown':
    case 'fumbleDead':
      return { stop: false, admin: false };
    default:
      return { stop: true, admin: false };
  }
}

export function resetPlayClock(s: GameState, admin: boolean): void {
  s.playClockSec = admin ? PLAY_CLOCK_SHORT_SEC : PLAY_CLOCK_SEC;
}

/** Charge a timeout: clock stops, 25-second play clock. */
export function useTimeout(s: GameState, team: 0 | 1, events: SimEvent[]): boolean {
  if (s.timeouts[team] <= 0) return false;
  s.timeouts[team] -= 1;
  s.clockRunning = false;
  ext(s).startClockOnSnap = true;
  s.playClockSec = PLAY_CLOCK_SHORT_SEC;
  events.push({ type: 'TIMEOUT', tick: s.tick, team, remaining: s.timeouts[team] });
  return true;
}
