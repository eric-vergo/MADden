// Normalized play frame <-> world transform. Plays are authored with the
// offense driving +y and +x = the offense's right; when the offense attacks -y
// BOTH axes mirror. Nothing else in the AI reasons about direction.

import type { GapId, Vec2 } from '../types';
import { FIELD_W, GOAL_AWAY_Y, GOAL_HOME_Y } from '../constants';

export type Dir = 1 | -1;

// Gap mouths as normalized x offsets from the ball (OL split 1.8 yd).
// TODO(balance): gap geometry table.
export const GAP_X: Record<GapId, number> = {
  'A-left': -0.9, 'A-right': 0.9,
  'B-left': -2.7, 'B-right': 2.7,
  'C-left': -4.6, 'C-right': 4.6,
  'D-left': -7.4, 'D-right': 7.4,
};

/** The two gaps immediately beside `gap`, innermost first. */
export const GAP_ORDER: readonly GapId[] = [
  'D-left', 'C-left', 'B-left', 'A-left', 'A-right', 'B-right', 'C-right', 'D-right',
];

export function neighborGaps(gap: GapId): GapId[] {
  const i = GAP_ORDER.indexOf(gap);
  const out: GapId[] = [];
  if (i > 0) out.push(GAP_ORDER[i - 1] as GapId);
  if (i >= 0 && i < GAP_ORDER.length - 1) out.push(GAP_ORDER[i + 1] as GapId);
  return out;
}

/** Normalized offset -> world offset (mirrors both axes when dir === -1). */
export function toWorldOffset(dx: number, dy: number, dir: Dir): Vec2 {
  return { x: dx * dir, y: dy * dir };
}

/** Normalized offset applied to a world origin. */
export function toWorldPoint(origin: Vec2, dx: number, dy: number, dir: Dir): Vec2 {
  return { x: origin.x + dx * dir, y: origin.y + dy * dir };
}

/** Yards downfield of the line of scrimmage, positive = toward the defense. */
export function depthYd(y: number, los: number, dir: Dir): number {
  return (y - los) * dir;
}

/** Normalized lateral offset from a reference x (+ = offense's right). */
export function lateral(x: number, refX: number, dir: Dir): number {
  return (x - refX) * dir;
}

/** The goal line the offense is attacking. */
export function targetGoalY(dir: Dir): number {
  return dir === 1 ? GOAL_AWAY_Y : GOAL_HOME_Y;
}

// Sideline keep-out used by AI steering (players never aim outside this).
// TODO(balance): sideline margin for AI steering.
export const SIDELINE_MARGIN_YD = 0.6;

export function clampFieldX(x: number): number {
  return Math.max(SIDELINE_MARGIN_YD, Math.min(FIELD_W - SIDELINE_MARGIN_YD, x));
}

export function clampFieldPoint(p: Vec2): Vec2 {
  return { x: clampFieldX(p.x), y: Math.max(0.3, Math.min(119.7, p.y)) };
}
