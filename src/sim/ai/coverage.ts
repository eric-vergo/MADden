// Coverage (sim-design §9): man mirror with a reaction ring buffer, zone
// landmark drops with pattern matching, and break-on-ball.
// Landmark geometry comes from data/zones.ts (S2); this module owns behavior.

import type { ManTarget, SimPlayer, Vec2, ZoneName } from '../types';
import { COVERAGE } from '../../data/balance';
import { ZONE_LANDMARKS, type ZoneLandmark } from '../../data/zones';
import { maxSpeed } from '../physics/movement';
import { dist, len, norm, sub } from '../vec';
import {
  DEFENSE_HI, DEFENSE_LO, coverageRating, eligibleReceivers, isIncapacitated,
  mindGet, mindSet, type AiCtx,
} from './context';
import { clampFieldPoint, clampFieldX, depthYd, lateral } from './frame';
import { applyMove, arrive, faceToward, interceptBall, predictLanding, seek } from './steering';
import { routeComplete } from './routes';

export type { ZoneLandmark };
export { ZONE_LANDMARKS };

// TODO(balance): coverage AI tunables not present in balance.COVERAGE.
export const COVERAGE_AI = {
  ringSize: 32,
  leverageShadeYd: 0.7,
  /** Cushion shrinks by this per yard of receiver depth. */
  cushionCloseRate: 0.25,
  cushionMinYd: 0.4,
  trailOffsetYd: 0.8,
  /** Seconds of receiver motion a zone defender projects when pattern matching. */
  matchProjectSec: 1.0,
  matchReleaseMult: 1.2,
  /** Curl-flat breaks to the flat after this many ticks with no curl threat. */
  flatBreakTicks: 40,
  deepZoneMinDepth: 10,
  /** Inside this distance the defender mirrors velocity instead of chasing. */
  mirrorLockYd: 2.0,
  mirrorGain: 2.5,
} as const;

const MIND_TGT = 'cvTgt';
const MIND_DELAY = 'cvDelay';
const MIND_CLAIM = 'cvClaim';
const MIND_BREAK_TICK = 'cvBreakTick';
/** 0 = not playing the ball, 1 = intercept attempt, 2 = swat. Read by S1. */
export const MIND_PLAY_BALL = 'cvPlayBall';

function ringKeyX(slot: number): string { return `cvHx${slot}`; }
function ringKeyY(slot: number): string { return `cvHy${slot}`; }

/** Resolve a DefAssignment man target to a player index (-1 when absent). */
export function resolveManTarget(ctx: AiCtx, target: ManTarget): number {
  const elig = eligibleReceivers(ctx);
  if (!target.startsWith('count-')) {
    for (const i of elig) {
      const p = ctx.players[i];
      if (p && p.role === target) return i;
    }
    // 'RB' may be filled by the FB role in heavy personnel.
    if (target === 'RB') {
      for (const i of elig) {
        const p = ctx.players[i];
        if (p && (p.role === 'FB' || p.pos === 'RB')) return i;
      }
    }
    return -1;
  }
  const parts = target.split('-'); // count-N-side
  const n = Number(parts[1] ?? '1');
  const side = parts[2] === 'left' ? -1 : 1;
  const ranked = elig
    .map((i) => {
      const p = ctx.players[i] as SimPlayer;
      return { i, x: lateral(p.pos2.x, ctx.ball.pos2.x, ctx.dir) };
    })
    .filter((e) => (side < 0 ? e.x < 0 : e.x > 0))
    .sort((a, b) => (side < 0 ? a.x - b.x : b.x - a.x));
  const hit = ranked[n - 1];
  return hit ? hit.i : -1;
}

/** Per-play setup for one defender (called once from index.ts). */
export function initCoverage(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  const a = p.assignment;
  mindSet(p, MIND_CLAIM, -1);
  mindSet(p, MIND_BREAK_TICK, -1);
  mindSet(p, MIND_PLAY_BALL, 0);
  if (a.kind !== 'man') { mindSet(p, MIND_TGT, -1); return; }

  const tgt = resolveManTarget(ctx, a.target);
  mindSet(p, MIND_TGT, tgt);

  // Reaction delay: difficulty range minus up to 4 ticks for elite man cover.
  const lo = ctx.diff.manMirrorDelayMinTicks;
  const hi = ctx.diff.manMirrorDelayMaxTicks;
  const bonus = Math.round(
    COVERAGE.reactionMcvBonusMaxTicks * Math.max(0, Math.min(1, (p.ratings.mcv - 70) / 29)),
  );
  const delay = Math.max(1, Math.min(COVERAGE_AI.ringSize - 1, ctx.rng.int(lo, hi) - bonus));
  mindSet(p, MIND_DELAY, delay);

  const t = tgt >= 0 ? ctx.players[tgt] : undefined;
  const x = t ? t.pos2.x : p.pos2.x;
  const y = t ? t.pos2.y : p.pos2.y;
  for (let s = 0; s < COVERAGE_AI.ringSize; s++) {
    mindSet(p, ringKeyX(s), x);
    mindSet(p, ringKeyY(s), y);
  }
}

function pushHistory(ctx: AiCtx, p: SimPlayer, target: SimPlayer): void {
  const slot = ((ctx.t % COVERAGE_AI.ringSize) + COVERAGE_AI.ringSize) % COVERAGE_AI.ringSize;
  mindSet(p, ringKeyX(slot), target.pos2.x);
  mindSet(p, ringKeyY(slot), target.pos2.y);
}

function delayedPos(ctx: AiCtx, p: SimPlayer): Vec2 {
  const delay = Math.round(mindGet(p, MIND_DELAY, 1));
  const size = COVERAGE_AI.ringSize;
  const slot = (((ctx.t - delay) % size) + size) % size;
  return { x: mindGet(p, ringKeyX(slot), p.pos2.x), y: mindGet(p, ringKeyY(slot), p.pos2.y) };
}

function delayedVel(ctx: AiCtx, p: SimPlayer): Vec2 {
  const delay = Math.round(mindGet(p, MIND_DELAY, 1));
  const size = COVERAGE_AI.ringSize;
  const a = (((ctx.t - delay) % size) + size) % size;
  const b = (((ctx.t - delay - 3) % size) + size) % size;
  const dx = mindGet(p, ringKeyX(a), 0) - mindGet(p, ringKeyX(b), 0);
  const dy = mindGet(p, ringKeyY(a), 0) - mindGet(p, ringKeyY(b), 0);
  return { x: dx * 20, y: dy * 20 }; // 3 ticks = 1/20 s
}

// ---------------------------------------------------------------------------
// Man
// ---------------------------------------------------------------------------

export function updateMan(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p || p.assignment.kind !== 'man') return;
  const a = p.assignment;
  const tgt = Math.round(mindGet(p, MIND_TGT, -1));
  const t = tgt >= 0 ? ctx.players[tgt] : undefined;
  if (!t) { holdSpot(ctx, i); return; }

  pushHistory(ctx, p, t);
  if (breakOnBall(ctx, i)) return;

  const dpos = delayedPos(ctx, p);
  const dvel = delayedVel(ctx, p);
  const recDepth = depthYd(t.pos2.y, ctx.los, ctx.dir);

  let aim: Vec2;
  if (routeComplete(t) || recDepth > 14) {
    // Past the final break: run with him, trailing just off his hip.
    const lead: Vec2 = { x: dpos.x + dvel.x * 0.35, y: dpos.y + dvel.y * 0.35 };
    const back = norm({ x: dvel.x, y: dvel.y });
    aim = {
      x: lead.x - back.x * COVERAGE_AI.trailOffsetYd,
      y: lead.y - back.y * COVERAGE_AI.trailOffsetYd,
    };
  } else {
    const cushion = Math.max(
      COVERAGE_AI.cushionMinYd,
      a.cushionYd - recDepth * COVERAGE_AI.cushionCloseRate,
    );
    const recLateral = lateral(t.pos2.x, ctx.ball.pos2.x, ctx.dir);
    const inSign = recLateral === 0 ? 0 : (recLateral > 0 ? -1 : 1);
    const shadeNorm = (a.leverage === 'inside' ? inSign : -inSign) * COVERAGE_AI.leverageShadeYd;
    aim = { x: dpos.x + shadeNorm * ctx.dir, y: dpos.y + cushion * ctx.dir };
  }

  // Close in at speed, then MATCH the receiver's (delayed) velocity with a
  // proportional correction — position-seeking alone oscillates on his hip.
  const target = clampFieldPoint(aim);
  const off = sub(target, p.pos2);
  const d = len(off);
  const desired: Vec2 = d > COVERAGE_AI.mirrorLockYd
    ? seek(p, target, maxSpeed(p, { sprinting: true }))
    : {
        x: dvel.x + off.x * COVERAGE_AI.mirrorGain,
        y: dvel.y + off.y * COVERAGE_AI.mirrorGain,
      };
  applyMove(ctx, i, desired, { sprinting: true });
  faceToward(p, t.pos2);
  p.anim = depthYd(p.pos2.y, ctx.los, ctx.dir) > recDepth + 0.5 && len(p.vel) > 0.5
    ? 'backpedal'
    : 'running';
}

function holdSpot(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  applyMove(ctx, i, { x: 0, y: 0 });
  const qb = ctx.qbIdx >= 0 ? ctx.players[ctx.qbIdx] : undefined;
  if (qb) faceToward(p, qb.pos2);
}

// ---------------------------------------------------------------------------
// Zone
// ---------------------------------------------------------------------------

export function zoneCenter(ctx: AiCtx, zone: ZoneName): Vec2 {
  const lm = ZONE_LANDMARKS[zone];
  return {
    x: clampFieldX(ctx.ball.pos2.x + lm.x * ctx.dir),
    y: ctx.los + lm.y * ctx.dir,
  };
}

/** World y a zone defender must never come shallower than pre-throw. */
export function zoneMinDepthY(ctx: AiCtx, zone: ZoneName): number {
  return ctx.los + ZONE_LANDMARKS[zone].minDepth * ctx.dir;
}

function clampBehindMinDepth(ctx: AiCtx, zone: ZoneName, point: Vec2): Vec2 {
  const minY = zoneMinDepthY(ctx, zone);
  const y = ctx.dir === 1 ? Math.max(point.y, minY) : Math.min(point.y, minY);
  return { x: point.x, y };
}

export function updateZone(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p || p.assignment.kind !== 'zone') return;
  const zone = p.assignment.zone;
  const lm = ZONE_LANDMARKS[zone];
  const center = zoneCenter(ctx, zone);

  if (breakOnBall(ctx, i)) return;

  // Pattern match: nearest eligible whose projected path enters the zone.
  let claim = Math.round(mindGet(p, MIND_CLAIM, -1));
  const claimed = claim >= 0 ? ctx.players[claim] : undefined;
  if (claimed) {
    const proj = projected(claimed);
    if (dist(proj, center) > lm.radius * COVERAGE_AI.matchReleaseMult) claim = -1;
  } else {
    claim = -1;
  }
  if (claim < 0) {
    let best = -1;
    let bestD = Infinity;
    for (const ri of eligibleReceivers(ctx)) {
      const r = ctx.players[ri];
      if (!r || isIncapacitated(r)) continue;
      const proj = projected(r);
      const d = dist(proj, center);
      if (d <= lm.radius && d < bestD) { bestD = d; best = ri; }
    }
    claim = best;
  }
  mindSet(p, MIND_CLAIM, claim);

  let aim: Vec2;
  if (claim >= 0) {
    const r = ctx.players[claim] as SimPlayer;
    const proj = projected(r);
    // Mirror inside the zone: stay within the landmark radius.
    const off = sub(proj, center);
    const l = len(off);
    const inside = l > lm.radius
      ? { x: center.x + (off.x / l) * lm.radius, y: center.y + (off.y / l) * lm.radius }
      : proj;
    aim = clampBehindMinDepth(ctx, zone, inside);
  } else if (isCurlFlat(zone) && ctx.t > COVERAGE_AI.flatBreakTicks) {
    // Squeeze the curl first, break to the flat late.
    const side = zone === 'curlFlat-L' ? -1 : 1;
    aim = clampFieldPoint({
      x: clampFieldX(ctx.ball.pos2.x + (lm.x + side * 3) * ctx.dir),
      y: ctx.los + lm.minDepth * ctx.dir,
    });
  } else {
    aim = center;
  }

  const isDeep = lm.minDepth >= COVERAGE_AI.deepZoneMinDepth;
  const cap = isDeep && claim < 0 ? maxSpeed(p) * 0.7 : maxSpeed(p, { sprinting: true });
  applyMove(ctx, i, arrive(p, clampFieldPoint(aim), 1.5, cap), { sprinting: !isDeep });
  const qb = ctx.qbIdx >= 0 ? ctx.players[ctx.qbIdx] : undefined;
  if (isDeep && qb) { faceToward(p, qb.pos2); p.anim = 'backpedal'; } else { p.anim = 'running'; }
}

function projected(r: SimPlayer): Vec2 {
  return {
    x: r.pos2.x + r.vel.x * COVERAGE_AI.matchProjectSec,
    y: r.pos2.y + r.vel.y * COVERAGE_AI.matchProjectSec,
  };
}

function isCurlFlat(zone: ZoneName): boolean {
  return zone === 'curlFlat-L' || zone === 'curlFlat-R';
}

// ---------------------------------------------------------------------------
// Break on ball
// ---------------------------------------------------------------------------

/**
 * Ball in the air: defenders inside breakOnBallRadiusYd of the landing spot
 * abandon their drop after breakOnBallDelayTicks and play the ball.
 * Sets MIND_PLAY_BALL to 1 (intercept attempt) or 2 (swat) for S1's catch
 * contest. Returns true when it took over this defender's movement.
 */
export function breakOnBall(ctx: AiCtx, i: number): boolean {
  const p = ctx.players[i];
  if (!p) return false;
  if (ctx.ball.mode !== 'pass') {
    if (mindGet(p, MIND_BREAK_TICK, -1) >= 0) {
      mindSet(p, MIND_BREAK_TICK, -1);
      mindSet(p, MIND_PLAY_BALL, 0);
    }
    return false;
  }
  const land = predictLanding(ctx.ball);
  if (dist(p.pos2, land.pos) > COVERAGE.breakOnBallRadiusYd) return false;

  let start = Math.round(mindGet(p, MIND_BREAK_TICK, -1));
  if (start < 0) { start = ctx.state.tick; mindSet(p, MIND_BREAK_TICK, start); }
  if (ctx.state.tick - start < ctx.diff.breakOnBallDelayTicks) return false;

  const sol = interceptBall(p, ctx.ball);
  const beatsArrival = sol.myTSec <= sol.tSec;
  const rating = coverageRating(p);
  mindSet(
    p,
    MIND_PLAY_BALL,
    beatsArrival && rating >= COVERAGE.intMinCoverageRating ? 1 : 2,
  );
  applyMove(ctx, i, seek(p, clampFieldPoint(sol.point)), { sprinting: true });
  faceToward(p, ctx.ball.pos2);
  p.anim = 'catching';
  return true;
}
