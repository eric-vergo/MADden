// Normalized play frame <-> world frame. Plays are authored with the offense
// driving +y and x measured from the ball; when a team attacks -y BOTH axes
// mirror (a player's "right" flips with him). Nothing else in the sim is
// allowed to reason about attack direction.

import type { Vec2 } from './types';
import {
  CENTER_X, FIELD_W, GOAL_AWAY_Y, GOAL_HOME_Y, HASH_LEFT_X, HASH_RIGHT_X,
} from './constants';

export type Dir = 1 | -1;

/** Normalized offset -> world yards. */
export function toWorld(v: Vec2, dir: Dir, ballSpot: Vec2): Vec2 {
  return { x: ballSpot.x + v.x * dir, y: ballSpot.y + v.y * dir };
}

/** World yards -> normalized offset from the ball spot. */
export function toNormalized(w: Vec2, dir: Dir, ballSpot: Vec2): Vec2 {
  return { x: (w.x - ballSpot.x) * dir, y: (w.y - ballSpot.y) * dir };
}

/** Goal line the team attacking `dir` is trying to reach. */
export function attackGoalY(dir: Dir): number {
  return dir === 1 ? GOAL_AWAY_Y : GOAL_HOME_Y;
}

/** Goal line the team attacking `dir` defends. */
export function ownGoalY(dir: Dir): number {
  return dir === 1 ? GOAL_HOME_Y : GOAL_AWAY_Y;
}

/** Back-of-end-zone plane (where the uprights stand) in the attack direction. */
export function attackEndLineY(dir: Dir): number {
  return dir === 1 ? 120 : 0;
}

/** World y for "our own N yard line" when attacking `dir`. */
export function ownYardLineY(n: number, dir: Dir): number {
  return ownGoalY(dir) + n * dir;
}

/** World y for "the opponent's N yard line" when attacking `dir`. */
export function oppYardLineY(n: number, dir: Dir): number {
  return attackGoalY(dir) - n * dir;
}

/** Yards from `y` to the goal line being attacked (negative = in the end zone). */
export function yardsToGoal(y: number, dir: Dir): number {
  return (attackGoalY(dir) - y) * dir;
}

/** Yards gained moving from `fromY` to `toY` for a team attacking `dir`. */
export function gainYards(fromY: number, toY: number, dir: Dir): number {
  return (toY - fromY) * dir;
}

/** Dead-ball lateral spotting: inside the hashes stays, outside snaps in. */
export function snapToHash(x: number): number {
  if (x < HASH_LEFT_X) return HASH_LEFT_X;
  if (x > HASH_RIGHT_X) return HASH_RIGHT_X;
  return x;
}

export function clampFieldX(x: number): number {
  return Math.max(0, Math.min(FIELD_W, x));
}

export function clampFieldY(y: number): number {
  return Math.max(0, Math.min(120, y));
}

export function clampToField(p: Vec2): Vec2 {
  return { x: clampFieldX(p.x), y: clampFieldY(p.y) };
}

/** Between-plays ball spot; x is hash-snapped, y clamped to the field of play. */
export function ballSpot(x: number, y: number): Vec2 {
  return { x: snapToHash(x), y: clampFieldY(y) };
}

export const DEFAULT_BALL_X = CENTER_X;
