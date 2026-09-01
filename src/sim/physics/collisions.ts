// Soft body separation and boundary tests. No rigid-body physics by design —
// players push apart gently and the sideline is a simple threshold.

import type { PlayState, SimPlayer, Vec2 } from '../types';
import { FIELD_W } from '../constants';
import { BALL, MOVE } from '../../data/balance';

/** Sideline tolerance: a foot on the paint is out. */
export const SIDELINE_MARGIN = BALL.sidelineMarginYd;

export function isOutOfBoundsX(x: number): boolean {
  return x < SIDELINE_MARGIN || x > FIELD_W - SIDELINE_MARGIN;
}

export function isOutOfBounds(p: Vec2): boolean {
  return isOutOfBoundsX(p.x) || p.y < 0 || p.y > 120;
}

/**
 * Mutual push-apart for overlapping teammates that are not engaged in a block.
 * Runs in fixed index order so the result is identical every run.
 */
export function separateTeammates(play: PlayState): void {
  const r = MOVE.separationRadius;
  const players = play.players;
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (a === undefined || a.engagedWith !== null || a.anim === 'down') continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (b === undefined || b.team !== a.team) continue;
      if (b.engagedWith !== null || b.anim === 'down') continue;
      const dx = b.pos2.x - a.pos2.x;
      const dy = b.pos2.y - a.pos2.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const push = (r - d) * 0.5;
      const ux = dx / d;
      const uy = dy / d;
      a.pos2.x -= ux * push;
      a.pos2.y -= uy * push;
      b.pos2.x += ux * push;
      b.pos2.y += uy * push;
    }
  }
}

/** Signed "is `target` inside `p`'s frontal arc" test (cos of half-angle). */
export function inFrontalArc(p: SimPlayer, target: Vec2, cosHalfAngle = 0.0): boolean {
  const dx = target.x - p.pos2.x;
  const dy = target.y - p.pos2.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return true;
  const fx = Math.cos(p.facing);
  const fy = Math.sin(p.facing);
  return (dx / d) * fx + (dy / d) * fy >= cosHalfAngle;
}

/** Closing speed of `a` toward `b` in yd/s (positive = getting closer). */
export function closingSpeed(a: SimPlayer, b: SimPlayer): number {
  const dx = b.pos2.x - a.pos2.x;
  const dy = b.pos2.y - a.pos2.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return 0;
  const rvx = a.vel.x - b.vel.x;
  const rvy = a.vel.y - b.vel.y;
  return (rvx * dx + rvy * dy) / d;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True when `tackler` is approaching the carrier from behind. */
export function isFromBehind(tackler: SimPlayer, carrier: SimPlayer): boolean {
  const dx = tackler.pos2.x - carrier.pos2.x;
  const dy = tackler.pos2.y - carrier.pos2.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return false;
  const fx = Math.cos(carrier.facing);
  const fy = Math.sin(carrier.facing);
  return (dx / d) * fx + (dy / d) * fy < -0.35;
}
