// Steering primitives (sim-design §4). Every brain produces a DESIRED velocity
// through these helpers; applyMove hands it to physics/movement.stepPlayer.

import type { Ball, SimPlayer, Vec2 } from '../types';
import { GRAVITY, TICK_DT, TICK_HZ } from '../constants';
import { maxSpeed, stepPlayer } from '../physics/movement';
import { dist, len, norm, sub } from '../vec';
import type { AiCtx } from './context';
import { mindSet } from './context';
import { clampFieldPoint } from './frame';
import { MOVE } from '../../data/balance';

// TODO(balance): steering tunables (kept local per parallel-agent rules).
export const STEER = {
  arriveSlowRadiusYd: 2.0,
  pursueMaxLeadSec: 1.2,
  ballSampleTicks: 5,
  ballSampleHorizonSec: 5.0,
  interceptReachZ: 2.6,
  /** Reach slack when judging "can I get there in time" (yards). */
  reachSlackYd: 0.8,
  /** Extra push a player applies to clear an overlapping teammate. */
  separationPush: 1.2,
} as const;

export const ZERO: Vec2 = { x: 0, y: 0 };

/** Steer toward `target`, easing inside slowRadius. */
export function arrive(
  p: SimPlayer,
  target: Vec2,
  slowRadius: number = STEER.arriveSlowRadiusYd,
  speedCap?: number,
): Vec2 {
  const cap = speedCap === undefined ? maxSpeed(p) : Math.max(0, speedCap);
  const to = sub(target, p.pos2);
  const d = len(to);
  if (d < 1e-6) return { x: 0, y: 0 };
  // Settling behavior (slowRadius > 0): ease in AND respect the braking
  // distance, otherwise a full-speed approach sails past the spot. seek()
  // passes slowRadius 0 because runners should go THROUGH their target.
  let speed = cap;
  if (slowRadius > 1e-6) {
    const eased = d < slowRadius ? cap * (d / slowRadius) : cap;
    speed = Math.min(eased, Math.sqrt(2 * MOVE.aBrake * d));
  }
  return { x: (to.x / d) * speed, y: (to.y / d) * speed };
}

/** Steer straight at a point with no easing. */
export function seek(p: SimPlayer, target: Vec2, speedCap?: number): Vec2 {
  return arrive(p, target, 0, speedCap);
}

/** Lead a moving target: t* = dist / mySpeed, capped at pursueMaxLeadSec. */
export function pursuePoint(p: SimPlayer, targetPos: Vec2, targetVel: Vec2): Vec2 {
  const mySpeed = Math.max(maxSpeed(p), 1);
  const d = dist(p.pos2, targetPos);
  const lead = Math.min(d / mySpeed, STEER.pursueMaxLeadSec);
  return { x: targetPos.x + targetVel.x * lead, y: targetPos.y + targetVel.y * lead };
}

export function pursue(p: SimPlayer, target: SimPlayer, speedCap?: number): Vec2 {
  return seek(p, pursuePoint(p, target.pos2, target.vel), speedCap);
}

/** Ball position/height at `tSec` from now (ballistic, no drag). */
export function ballAt(ball: Ball, tSec: number): { pos: Vec2; z: number } {
  return {
    pos: { x: ball.pos2.x + ball.vel.x * tSec, y: ball.pos2.y + ball.vel.y * tSec },
    z: ball.z + ball.vz * tSec - 0.5 * GRAVITY * tSec * tSec,
  };
}

/** First sample where the ball drops to catchable height (or hits the ground). */
export function predictLanding(ball: Ball, catchZ = 2.4): { pos: Vec2; tSec: number } {
  const step = STEER.ballSampleTicks * TICK_DT;
  let last = ballAt(ball, 0);
  for (let t = step; t <= STEER.ballSampleHorizonSec; t += step) {
    const s = ballAt(ball, t);
    if (s.z <= catchZ && s.z < last.z) return { pos: s.pos, tSec: t };
    if (s.z <= 0) return { pos: s.pos, tSec: t };
    last = s;
  }
  return { pos: last.pos, tSec: STEER.ballSampleHorizonSec };
}

export interface InterceptSolution {
  point: Vec2;
  /** Seconds until the ball reaches `point`. */
  tSec: number;
  /** Seconds this player needs to get there. */
  myTSec: number;
  reachable: boolean;
}

/**
 * Earliest ballistic sample this player can reach with the ball below
 * interceptReachZ. Falls back to the landing spot when nothing is reachable.
 */
export function interceptBall(p: SimPlayer, ball: Ball): InterceptSolution {
  const step = STEER.ballSampleTicks * TICK_DT;
  const spd = Math.max(maxSpeed(p, { sprinting: true }), 0.1);
  for (let t = step; t <= STEER.ballSampleHorizonSec; t += step) {
    const s = ballAt(ball, t);
    if (s.z > STEER.interceptReachZ) continue;
    const need = Math.max(0, dist(p.pos2, s.pos) - STEER.reachSlackYd);
    const myT = need / spd;
    if (myT <= t) return { point: s.pos, tSec: t, myTSec: myT, reachable: true };
    if (s.z <= 0) break;
  }
  const land = predictLanding(ball);
  const need = Math.max(0, dist(p.pos2, land.pos) - STEER.reachSlackYd);
  return { point: land.pos, tSec: land.tSec, myTSec: need / spd, reachable: false };
}

/** Ticks this player needs to cover `d` yards from a standing-ish start. */
export function ticksToCover(p: SimPlayer, d: number): number {
  const spd = Math.max(maxSpeed(p, { sprinting: true }), 0.1);
  return (d / spd) * TICK_HZ;
}

/** Rotate a vector by `rad`. */
export function rotate(v: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Small mutual push so idle teammates do not stack (design §4 separation). */
function separation(ctx: AiCtx, i: number): Vec2 {
  const p = ctx.players[i];
  if (!p || p.engagedWith !== null) return ZERO;
  let sx = 0;
  let sy = 0;
  for (let j = 0; j < ctx.players.length; j++) {
    if (j === i) continue;
    const q = ctx.players[j];
    if (!q || q.team !== p.team || q.engagedWith !== null) continue;
    const dx = p.pos2.x - q.pos2.x;
    const dy = p.pos2.y - q.pos2.y;
    const d = Math.hypot(dx, dy);
    if (d < MOVE.separationRadius && d > 1e-6) {
      const w = (MOVE.separationRadius - d) / MOVE.separationRadius;
      sx += (dx / d) * w;
      sy += (dy / d) * w;
    }
  }
  return { x: sx * STEER.separationPush, y: sy * STEER.separationPush };
}

/**
 * Integrate one tick toward `desired`.
 * NOTE (S1 contract): the AI owns movement for every player it touches — this
 * calls stepPlayer, which sets velocity AND integrates position. The phase
 * handler must not integrate those players again. `mind.aiStepTick` records
 * the tick on which the AI last moved this player so S1 can skip them.
 */
export function applyMove(
  ctx: AiCtx,
  i: number,
  desired: Vec2,
  opts?: { sprinting?: boolean; carrying?: boolean; keepFacing?: number },
): void {
  const p = ctx.players[i];
  if (!p) return;
  const sep = separation(ctx, i);
  const target: Vec2 = { x: desired.x + sep.x, y: desired.y + sep.y };
  stepPlayer(p, target, opts);
  if (opts?.keepFacing !== undefined) p.facing = opts.keepFacing;
  mindSet(p, 'aiStepTick', ctx.state.tick);
}

/** Face a world point without changing velocity. */
export function faceToward(p: SimPlayer, target: Vec2): void {
  const d = sub(target, p.pos2);
  if (len(d) > 1e-6) p.facing = Math.atan2(d.y, d.x);
}
