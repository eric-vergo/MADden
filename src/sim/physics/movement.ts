// Kinematics: clamped velocity-matching with split longitudinal/lateral accel
// limits. One algorithm serves user control and AI steering. Constants: MOVE.

import type { SimPlayer, Vec2 } from '../types';
import { TICK_DT } from '../constants';
import { MOVE } from '../../data/balance';
import { dot, len } from '../vec';

export function maxSpeed(p: SimPlayer, opts?: { sprinting?: boolean; carrying?: boolean }): number {
  let v = MOVE.vMaxBase + MOVE.vMaxPerSpd * (p.ratings.spd / 99);
  if (opts?.sprinting) v *= MOVE.sprintMult;
  if (opts?.carrying) v *= MOVE.carrierMult;
  v *= 1 - MOVE.fatigueMaxPenalty * p.fatigue;
  return v;
}

export function fwdAccel(p: SimPlayer): number {
  return MOVE.aFwdBase + MOVE.aFwdPerAcc * (p.ratings.acc / 99);
}

export function latAccel(p: SimPlayer, opts?: { sprinting?: boolean }): number {
  let a = MOVE.aLatBase + MOVE.aLatPerAgi * (p.ratings.agi / 99);
  if (opts?.sprinting) a *= MOVE.sprintTurnPenalty;
  return a;
}

/**
 * Advance one tick toward `desiredVel` (already capped to the player's max
 * speed by the caller or clamped here) and integrate position.
 */
export function stepPlayer(
  p: SimPlayer,
  desiredVel: Vec2,
  opts?: { sprinting?: boolean; carrying?: boolean },
): void {
  const vMax = maxSpeed(p, opts);
  // Clamp the request.
  const dLen = len(desiredVel);
  const target: Vec2 = dLen > vMax && dLen > 1e-9
    ? { x: (desiredVel.x / dLen) * vMax, y: (desiredVel.y / dLen) * vMax }
    : desiredVel;

  const dv: Vec2 = { x: target.x - p.vel.x, y: target.y - p.vel.y };
  const speed = len(p.vel);

  if (speed < 1e-6) {
    // From rest: pure forward acceleration toward the target.
    const a = fwdAccel(p) * TICK_DT;
    const dvLen = len(dv);
    const s = dvLen > a ? a / dvLen : 1;
    p.vel.x += dv.x * s;
    p.vel.y += dv.y * s;
  } else {
    const fx = p.vel.x / speed;
    const fy = p.vel.y / speed;
    // Decompose dv into parallel/perpendicular to current velocity.
    const par = dot(dv, { x: fx, y: fy });
    const perpX = dv.x - par * fx;
    const perpY = dv.y - par * fy;
    const perpLen = Math.hypot(perpX, perpY);

    const aPar = (par >= 0 ? fwdAccel(p) : MOVE.aBrake) * TICK_DT;
    const parClamped = Math.max(-aPar, Math.min(aPar, par));

    const aLat = latAccel(p, opts) * TICK_DT;
    const perpScale = perpLen > aLat ? aLat / perpLen : 1;

    p.vel.x += parClamped * fx + perpX * perpScale;
    p.vel.y += parClamped * fy + perpY * perpScale;
  }

  // Final speed clamp.
  const newSpeed = len(p.vel);
  if (newSpeed > vMax) {
    p.vel.x = (p.vel.x / newSpeed) * vMax;
    p.vel.y = (p.vel.y / newSpeed) * vMax;
  }

  p.pos2.x += p.vel.x * TICK_DT;
  p.pos2.y += p.vel.y * TICK_DT;

  if (newSpeed > 0.5) p.facing = Math.atan2(p.vel.y, p.vel.x);
}

/** Hard stop (used when a player is downed/engaged). */
export function halt(p: SimPlayer): void {
  p.vel.x = 0;
  p.vel.y = 0;
}
