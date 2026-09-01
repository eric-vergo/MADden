// Route running (sim-design §10): waypoint following with atTick pacing,
// sharp/rounded breaks, vs-zone settling, and post-throw behavior.

import type { Route, RouteWaypoint, SimPlayer, Vec2 } from '../types';
import { TICK_DT } from '../constants';
import { COVERAGE, MOVE } from '../../data/balance';
import { maxSpeed } from '../physics/movement';
import { dist, dot, len, norm, sub } from '../vec';
import {
  DEFENSE_HI, DEFENSE_LO, isIncapacitated, mindGet, mindSet, type AiCtx,
} from './context';
import { CENTER_X_REF, alignmentOf } from './memory';
import { clampFieldPoint, depthYd, toWorldPoint } from './frame';
import { applyMove, arrive, faceToward, interceptBall, seek } from './steering';
import { blockNearestThreat } from './blocking';

// TODO(balance): route-running tunables.
export const ROUTE_AI = {
  sharpArriveYd: 0.7,
  roundedArriveYd: 1.5,
  /** A waypoint counts as reached once it is behind us inside this radius. */
  passedWaypointYd: 2.0,
  finalArriveYd: 1.6,
  /** Braking-distance multiplier before a sharp break (AGI shortens it). */
  breakWindowBaseYd: 1.25, breakWindowAgiYd: 0.35,
  breakWindowMinYd: 0.5,
  breakSpeedCap: 4.0,
  minPacedSpeed: 1.2,
  settleDriftSpeed: 1.0,
  /** Radius searched for zone defenders when settling. */
  settleScanYd: 14,
  settleMaxOffsetYd: 4.0,
  /** Hot conversion: quick slant depth/width. */
  hotDepthYd: 5, hotInsideYd: 5,
} as const;

const MIND_WP = 'rtWp';
const MIND_DONE = 'rtDone';
const MIND_HOT = 'rtHot';
const MIND_SETTLE_X = 'rtSettleX';
const MIND_SETTLE_Y = 'rtSettleY';
const MIND_SETTLED = 'rtSettled';

/** True once the receiver has finished his last authored break. */
export function routeComplete(p: SimPlayer): boolean {
  return mindGet(p, MIND_DONE) === 1;
}

function hotTarget(ctx: AiCtx, p: SimPlayer, align: Vec2): Vec2 {
  const inside = align.x < CENTER_X_REF ? 1 : -1;
  return toWorldPoint(align, inside * ROUTE_AI.hotInsideYd * ctx.dir, ROUTE_AI.hotDepthYd, ctx.dir);
}

export function updateRoute(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p || p.assignment.kind !== 'route') return;
  const route = p.assignment.route;

  if (ctx.ball.mode === 'pass') { postThrow(ctx, i, route); return; }

  const align = alignmentOf(p);
  if (mindGet(p, MIND_HOT) === 1) {
    const t = hotTarget(ctx, p, align);
    applyMove(ctx, i, seek(p, clampFieldPoint(t)), { sprinting: true });
    p.anim = 'running';
    faceToward(p, t);
    return;
  }

  const wps = route.waypoints;
  let wi = mindGet(p, MIND_WP, 0);
  if (wi >= wps.length) { finishRoute(ctx, i, route); return; }

  const wp = wps[wi] as RouteWaypoint;
  const target = toWorldPoint(align, wp.dx, wp.dy, ctx.dir);
  const toTarget = sub(target, p.pos2);
  const d = len(toTarget);
  // The end of a route is "reached" generously: a receiver who has run
  // through his last break is done, and chasing the exact point wastes ticks.
  const isLast = wi === wps.length - 1;
  const arriveR = isLast
    ? ROUTE_AI.finalArriveYd
    : (wp.breakStyle === 'sharp' ? ROUTE_AI.sharpArriveYd : ROUTE_AI.roundedArriveYd);
  // Also advance once the waypoint is behind us: closing the last few inches
  // exactly is both slow and pointless.
  const passed = d < ROUTE_AI.passedWaypointYd
    && len(p.vel) > 0.5
    && dot(toTarget, p.vel) <= 0;

  if (d <= arriveR || passed) {
    wi += 1;
    mindSet(p, MIND_WP, wi);
    if (wi >= wps.length) { mindSet(p, MIND_DONE, 1); finishRoute(ctx, i, route); return; }
  }

  const cur = wps[Math.min(wi, wps.length - 1)] as RouteWaypoint;
  const curTarget = toWorldPoint(align, cur.dx, cur.dy, ctx.dir);
  const curDist = dist(p.pos2, curTarget);

  let cap = maxSpeed(p, { sprinting: true });
  if (cur.atTick !== undefined) {
    const remainSec = Math.max(1, cur.atTick - ctx.t) * TICK_DT;
    cap = Math.min(cap, Math.max(curDist / remainSec, ROUTE_AI.minPacedSpeed));
  }
  if (cur.breakStyle === 'sharp' && wi + 1 < wps.length) {
    // Start braking far enough out to actually be at breakSpeedCap on the
    // break; a higher AGI needs less room (design §10).
    const v = len(p.vel);
    const need = Math.max(0, v * v - ROUTE_AI.breakSpeedCap ** 2) / (2 * MOVE.aBrake);
    const window = need * (ROUTE_AI.breakWindowBaseYd - ROUTE_AI.breakWindowAgiYd * (p.ratings.agi / 99))
      + ROUTE_AI.breakWindowMinYd;
    if (curDist < window) cap = Math.min(cap, ROUTE_AI.breakSpeedCap);
  }

  applyMove(ctx, i, seek(p, clampFieldPoint(curTarget), cap), { sprinting: true });
  p.anim = 'running';
}

function lastWaypoint(route: Route): RouteWaypoint | undefined {
  return route.waypoints.length > 0 ? route.waypoints[route.waypoints.length - 1] : undefined;
}

function finishRoute(ctx: AiCtx, i: number, route: Route): void {
  const p = ctx.players[i];
  if (!p) return;
  const last = lastWaypoint(route);
  const action = last?.thenAction;

  if (action === 'blockNearest') { blockNearestThreat(ctx, i); return; }

  if (route.vsZoneSettle && vsZonePosture(ctx, i)) { settleInSoftSpot(ctx, i, route); return; }
  if (action === 'settle') { settleInSoftSpot(ctx, i, route); return; }

  // lookForBall / default: keep working back toward the QB's throwing window.
  const qb = ctx.qbIdx >= 0 ? ctx.players[ctx.qbIdx] : undefined;
  if (qb) faceToward(p, qb.pos2);
  const align = alignmentOf(p);
  const anchor = last
    ? toWorldPoint(align, last.dx, last.dy, ctx.dir)
    : p.pos2;
  const drift: Vec2 = {
    x: anchor.x,
    y: anchor.y + ROUTE_AI.settleDriftSpeed * 0.4 * ctx.dir,
  };
  applyMove(ctx, i, arrive(p, clampFieldPoint(drift), 2.0, maxSpeed(p) * 0.55));
  if (qb) faceToward(p, qb.pos2);
  p.anim = 'running';
}

/** Zone posture: the nearest defender is slow and facing the quarterback. */
function vsZonePosture(ctx: AiCtx, i: number): boolean {
  const p = ctx.players[i];
  if (!p) return false;
  let best = -1;
  let bestD = Infinity;
  for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
    const d = ctx.players[di];
    if (!d || isIncapacitated(d)) continue;
    const dd = dist(p.pos2, d.pos2);
    if (dd < bestD) { bestD = dd; best = di; }
  }
  if (best < 0 || bestD > ROUTE_AI.settleScanYd) return false;
  const d = ctx.players[best] as SimPlayer;
  if (len(d.vel) >= COVERAGE.zoneClaimSpeedThreshold) return false;
  // Facing back toward the offense (i.e. toward the QB, against the play dir).
  return Math.cos(d.facing) * 0 + Math.sin(d.facing) * -ctx.dir > -0.2;
}

/** Sit in the largest gap between the two nearest defenders. */
function settleInSoftSpot(ctx: AiCtx, i: number, route: Route): void {
  const p = ctx.players[i];
  if (!p) return;
  if (mindGet(p, MIND_SETTLED) !== 1) {
    const near: Array<{ idx: number; d: number }> = [];
    for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
      const d = ctx.players[di];
      if (!d || isIncapacitated(d)) continue;
      const dd = dist(p.pos2, d.pos2);
      if (dd <= ROUTE_AI.settleScanYd) near.push({ idx: di, d: dd });
    }
    near.sort((a, b) => (a.d === b.d ? a.idx - b.idx : a.d - b.d));
    let spot: Vec2 = { x: p.pos2.x, y: p.pos2.y };
    if (near.length >= 2) {
      const a = ctx.players[near[0]!.idx] as SimPlayer;
      const b = ctx.players[near[1]!.idx] as SimPlayer;
      const mid: Vec2 = { x: (a.pos2.x + b.pos2.x) / 2, y: (a.pos2.y + b.pos2.y) / 2 };
      const off = sub(mid, p.pos2);
      const l = len(off);
      spot = l > ROUTE_AI.settleMaxOffsetYd
        ? { x: p.pos2.x + (off.x / l) * ROUTE_AI.settleMaxOffsetYd, y: p.pos2.y + (off.y / l) * ROUTE_AI.settleMaxOffsetYd }
        : mid;
    } else if (near.length === 1) {
      const a = ctx.players[near[0]!.idx] as SimPlayer;
      const away = norm(sub(p.pos2, a.pos2));
      spot = { x: p.pos2.x + away.x * 2.5, y: p.pos2.y + away.y * 2.5 };
    }
    const clamped = clampFieldPoint(spot);
    mindSet(p, MIND_SETTLE_X, clamped.x);
    mindSet(p, MIND_SETTLE_Y, clamped.y);
    mindSet(p, MIND_SETTLED, 1);
    void route;
  }
  const target: Vec2 = { x: mindGet(p, MIND_SETTLE_X, p.pos2.x), y: mindGet(p, MIND_SETTLE_Y, p.pos2.y) };
  applyMove(ctx, i, arrive(p, target, 1.5, maxSpeed(p) * 0.8));
  const qb = ctx.qbIdx >= 0 ? ctx.players[ctx.qbIdx] : undefined;
  if (qb) faceToward(p, qb.pos2);
  p.anim = 'running';
}

/**
 * After the throw: the target attacks the catch point; everyone else either
 * blocks (ball is behind them) or keeps clearing space.
 */
export function postThrow(ctx: AiCtx, i: number, route: Route): void {
  const p = ctx.players[i];
  if (!p) return;
  if (ctx.ball.targetIdx === i) {
    const sol = interceptBall(p, ctx.ball);
    applyMove(ctx, i, seek(p, clampFieldPoint(sol.point)), { sprinting: true });
    faceToward(p, ctx.ball.pos2);
    p.anim = 'catching';
    return;
  }
  const myDepth = depthYd(p.pos2.y, ctx.los, ctx.dir);
  const ballDepth = depthYd(ctx.ball.pos2.y, ctx.los, ctx.dir);
  if (ballDepth < myDepth) { blockNearestThreat(ctx, i); return; }
  // Keep running the route so coverage stays honest.
  const align = alignmentOf(p);
  const last = lastWaypoint(route);
  const target = last
    ? toWorldPoint(align, last.dx, last.dy, ctx.dir)
    : { x: p.pos2.x, y: p.pos2.y + 5 * ctx.dir };
  applyMove(ctx, i, seek(p, clampFieldPoint(target)), { sprinting: true });
  p.anim = 'running';
}

/** Blitz-beater conversion, decided once at the snap. */
export function setHotIfBlitz(ctx: AiCtx, i: number, blitzing: boolean): void {
  const p = ctx.players[i];
  if (!p || p.assignment.kind !== 'route') return;
  mindSet(p, MIND_HOT, blitzing && p.assignment.route.hot === true ? 1 : 0);
}
