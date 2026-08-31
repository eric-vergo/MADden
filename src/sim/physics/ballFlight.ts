// Ballistics for passes, kicks, pitches and loose balls. Everything is plain
// projectile motion under GRAVITY with a fixed tick — no integration surprises.

import type { Ball, Vec2 } from '../types';
import { GRAVITY, TICK_DT } from '../constants';
import { PASS } from '../../data/balance';

export interface Launch {
  vel: Vec2;
  vz: number;
  /** Expected time of flight in seconds. */
  timeSec: number;
}

const RELEASE_Z = 1.9; // ball leaves the QB's hand about here
const CATCH_Z = 1.5;

export function bulletSpeed(thp: number): number {
  return PASS.bulletSpeedBase + PASS.bulletSpeedPerThp * (thp / 99);
}

/** Time for a lob to travel `dist` yards (apex ~PASS.lobApexZ). */
export function lobTime(dist: number): number {
  return 2.03 + dist / 45;
}

/**
 * Flat, hard throw: horizontal speed from THP, vertical chosen so the ball
 * arrives at catch height. Long throws auto-loft (the arc grows with range).
 */
export function bulletLaunch(from: Vec2, to: Vec2, z0: number, thp: number): Launch {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.max(0.5, Math.hypot(dx, dy));
  const speed = bulletSpeed(thp);
  const t = dist / speed;
  const vz = (CATCH_Z - z0 + 0.5 * GRAVITY * t * t) / t;
  return { vel: { x: dx / t, y: dy / t }, vz, timeSec: t };
}

/** High, soft throw: fixed apex, horizontal speed derived from the time. */
export function lobLaunch(from: Vec2, to: Vec2, z0: number, thp: number): Launch {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.max(0.5, Math.hypot(dx, dy));
  let t = lobTime(dist);
  // A weak arm cannot hold the horizontal speed a long lob needs.
  const maxH = bulletSpeed(thp);
  if (dist / t > maxH) t = dist / maxH;
  const vz = (CATCH_Z - z0 + 0.5 * GRAVITY * t * t) / t;
  return { vel: { x: dx / t, y: dy / t }, vz, timeSec: t };
}

/** Short shovel/pitch: low lob that stays catchable and is live if dropped. */
export function pitchLaunch(from: Vec2, to: Vec2, z0: number): Launch {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.max(0.5, Math.hypot(dx, dy));
  const t = Math.max(0.25, dist / 14);
  const vz = (1.2 - z0 + 0.5 * GRAVITY * t * t) / t;
  return { vel: { x: dx / t, y: dy / t }, vz, timeSec: t };
}

/**
 * Kick with an explicit carry distance and hang time — the shape the kick
 * meter produces. `dirRad` is the launch heading in world radians.
 */
export function kickLaunch(distYd: number, hangSec: number, dirRad: number, z0 = 0.2): Launch {
  const t = Math.max(0.5, hangSec);
  const h = Math.max(1, distYd) / t;
  const vz = (0 - z0 + 0.5 * GRAVITY * t * t) / t;
  return { vel: { x: Math.cos(dirRad) * h, y: Math.sin(dirRad) * h }, vz, timeSec: t };
}

/** Where an airborne ball will be `t` seconds from now (ignores the ground). */
export function predict(ball: Ball, t: number): { x: number; y: number; z: number } {
  return {
    x: ball.pos2.x + ball.vel.x * t,
    y: ball.pos2.y + ball.vel.y * t,
    z: ball.z + ball.vz * t - 0.5 * GRAVITY * t * t,
  };
}

/** Seconds until an airborne ball first drops to `z`, or null. */
export function timeToHeight(ball: Ball, z: number): number | null {
  const a = -0.5 * GRAVITY;
  const b = ball.vz;
  const c = ball.z - z;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t1 = (-b + root) / (2 * a);
  const t2 = (-b - root) / (2 * a);
  const cands = [t1, t2].filter((t) => t > 1e-6).sort((p, q) => p - q);
  return cands.length > 0 ? (cands[0] as number) : null;
}

export const BOUNCE_RESTITUTION = 0.35;
export const BOUNCE_FRICTION = 0.55;
export const REST_SPEED = 0.45;

export interface BallStepResult {
  /** The ball touched the ground on this tick. */
  landed: boolean;
  /** The ball is effectively at rest on the turf. */
  atRest: boolean;
}

/** One tick of flight. Airborne modes fall; a loose ball bounces and settles. */
export function stepBall(ball: Ball, bounce: boolean): BallStepResult {
  if (ball.mode === 'held' || ball.mode === 'dead') return { landed: false, atRest: false };

  ball.pos2.x += ball.vel.x * TICK_DT;
  ball.pos2.y += ball.vel.y * TICK_DT;
  ball.vz -= GRAVITY * TICK_DT;
  ball.z += ball.vz * TICK_DT;

  if (ball.z > 0) return { landed: false, atRest: false };

  ball.z = 0;
  if (!bounce) {
    ball.vz = 0;
    ball.vel.x = 0;
    ball.vel.y = 0;
    return { landed: true, atRest: true };
  }
  ball.vz = Math.abs(ball.vz) * BOUNCE_RESTITUTION;
  ball.vel.x *= BOUNCE_FRICTION;
  ball.vel.y *= BOUNCE_FRICTION;
  const settled = ball.vz < REST_SPEED && Math.hypot(ball.vel.x, ball.vel.y) < REST_SPEED;
  if (settled) {
    ball.vz = 0;
    ball.vel.x = 0;
    ball.vel.y = 0;
  }
  return { landed: true, atRest: settled };
}

/** Attach the ball to a carrier (called every tick while it is held). */
export function carryBall(ball: Ball, pos: Vec2, facing: number): void {
  ball.pos2.x = pos.x + Math.cos(facing) * 0.35;
  ball.pos2.y = pos.y + Math.sin(facing) * 0.35;
  ball.z = 1.1;
  ball.vel.x = 0;
  ball.vel.y = 0;
  ball.vz = 0;
}

export { RELEASE_Z, CATCH_Z };
