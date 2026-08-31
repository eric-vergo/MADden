// Downs, chains, spotting. Pure functions over world-y and attack direction.

import type { GameState, TeamSide } from '../types';
import { attackGoalY, type Dir } from '../transform';

/** World y of the line to gain; the goal line always caps it ("& Goal"). */
export function lineToGainY(ballOnY: number, toGo: number, dir: Dir): number {
  const raw = ballOnY + toGo * dir;
  const goal = attackGoalY(dir);
  return dir === 1 ? Math.min(raw, goal) : Math.max(raw, goal);
}

export function isFirstDown(spotY: number, lineY: number, dir: Dir): boolean {
  return (spotY - lineY) * dir >= -1e-9;
}

/** Fresh set of downs from a spot: 10 yards, or goal-to-go. */
export function freshToGo(spotY: number, dir: Dir): number {
  const toGoal = (attackGoalY(dir) - spotY) * dir;
  return Math.max(1, Math.min(10, toGoal));
}

export function isGoalToGo(spotY: number, toGo: number, dir: Dir): boolean {
  const toGoal = (attackGoalY(dir) - spotY) * dir;
  return toGo >= toGoal - 1e-9;
}

/**
 * Forward progress: the best spot the carrier reached in the trailing window.
 * `samples` is the raw circular buffer; order does not matter.
 */
export function bestProgressY(samples: readonly number[], dir: Dir, fallback: number): number {
  let best: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const y = samples[i];
    if (y === undefined) continue;
    if (best === null || y * dir > best * dir) best = y;
  }
  return best === null ? fallback : best;
}

/**
 * Penalty yardage capped by half the distance to the goal line it moves
 * toward. `towardOwn` is true for a penalty against the team with the ball.
 */
export function enforceYards(
  fromY: number,
  yards: number,
  dir: Dir,
  towardOwn: boolean,
): number {
  const targetGoal = towardOwn ? attackGoalY(dir === 1 ? -1 : 1) : attackGoalY(dir);
  const distToGoal = Math.abs(targetGoal - fromY);
  const capped = Math.min(yards, distToGoal / 2);
  const sign = towardOwn ? -dir : dir;
  return fromY + capped * sign;
}

/** Yard-line label for a world y ("MID 42", "HOM 18"). */
export function spotLabel(
  ballOnY: number,
  homeAbbrev: string,
  awayAbbrev: string,
): string {
  const yl = Math.round(ballOnY <= 60 ? ballOnY - 10 : 110 - ballOnY);
  if (Math.abs(ballOnY - 60) < 0.5) return 'MID 50';
  const side = ballOnY < 60 ? homeAbbrev : awayAbbrev;
  return `${side} ${Math.max(0, Math.min(50, yl))}`;
}

export function downLabel(down: number): string {
  return down === 1 ? '1st' : down === 2 ? '2nd' : down === 3 ? '3rd' : '4th';
}

export function describeState(
  down: number,
  toGo: number,
  ballOnY: number,
  dir: Dir,
  homeAbbrev: string,
  awayAbbrev: string,
): string {
  const goalToGo = isGoalToGo(ballOnY, toGo, dir);
  const dist = goalToGo ? 'Goal' : String(Math.round(toGo));
  return `${downLabel(down)} & ${dist} at ${spotLabel(ballOnY, homeAbbrev, awayAbbrev)}`;
}

export function teamAbbrevs(s: GameState): [string, string] {
  return [s.rosters[0].abbrev, s.rosters[1].abbrev];
}

export function otherTeam(t: TeamSide): TeamSide {
  return t === 0 ? 1 : 0;
}
