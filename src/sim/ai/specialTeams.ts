// Special teams (sim-design §11): CPU kick-meter timing, coverage lanes and
// contain, return wedge blocking, and the returner's catch/fair-catch/kneel
// decisions.

import type { SimPlayer, Vec2 } from '../types';
import { FIELD_W, TICK_HZ } from '../constants';
import { KICK, ST_AI } from '../../data/balance';

export { ST_AI };
import { callFairCatch, pressKickMeter } from '../actions';
import { ext } from '../rules/ext';
import { dist } from '../vec';
import { maxSpeed } from '../physics/movement';
import { isIncapacitated, mindGet, mindSet, type AiCtx } from './context';
import { clampFieldPoint, clampFieldX, targetGoalY } from './frame';
import { applyMove, arrive, faceToward, interceptBall, predictLanding, seek, ticksToCover } from './steering';
import { blockNearestThreat } from './blocking';
import { maybeTackle, updatePursuit } from './pursuit';


const MIND_POWER_TICKS = 'stPowerTicks';
const MIND_SWEEP_TICKS = 'stSweepTicks';
const MIND_PRESSES = 'stPresses';
const MIND_FAIR_CALLED = 'stFairCalled';

/**
 * Returner intent for S1's RETURN_DECISION handling:
 * 1 = return it out, 2 = kneel/take the touchback.
 */
export const MIND_RETURN_DECISION = 'stReturnDecision';

// ---------------------------------------------------------------------------
// Kicker
// ---------------------------------------------------------------------------

function desiredPower(ctx: AiCtx, k: SimPlayer, style: 'kickoff' | 'punt' | 'placekick'): number {
  const goalY = targetGoalY(ctx.dir);
  const toGoal = Math.abs(goalY - ctx.los);
  const kpw = k.ratings.kpw / 99;
  if (style === 'kickoff') return 1;
  if (style === 'punt') {
    const want = Math.min(toGoal - ST_AI.puntTargetShortOfGoalYd, KICK.puntDistBase + KICK.puntDistPerPower * kpw);
    const p = (want - KICK.puntDistBase) / Math.max(KICK.puntDistPerPower * kpw, 1e-6);
    return Math.max(0.3, Math.min(1, p));
  }
  const fgDist = toGoal + 17;
  const maxRange = KICK.fgMaxRangeBase + KICK.fgMaxRangePerKpw * kpw;
  return Math.max(0.55, Math.min(1, (fgDist / Math.max(maxRange, 1)) * 1.15));
}

export function initKicker(ctx: AiCtx, i: number): void {
  const k = ctx.players[i];
  if (!k || k.assignment.kind !== 'kick') return;
  const style = k.assignment.style;
  const err = ctx.diff.cpuKickErrorSigma;
  const power = Math.max(0.15, Math.min(1, desiredPower(ctx, k, style) + ctx.rng.gauss() * err));
  const sweep = Math.max(0.05, Math.min(0.95, 0.5 + ctx.rng.gauss() * err));
  mindSet(k, MIND_POWER_TICKS, Math.round(KICK.meterFillTicks * power));
  mindSet(k, MIND_SWEEP_TICKS, Math.round(KICK.meterSweepTicks * sweep));
  mindSet(k, MIND_PRESSES, 0);
}

export function updateKicker(ctx: AiCtx, i: number): void {
  const k = ctx.players[i];
  if (!k) return;
  const meter = ctx.play.kickMeter;
  const presses = mindGet(k, MIND_PRESSES, 0);
  applyMove(ctx, i, { x: 0, y: 0 });
  k.anim = 'kicking';

  if (presses >= 3) return;
  // S1 already drives the meter for every CPU kick through its own KickPlan —
  // that is where the difficulty kick error lives. Pressing from here as well
  // interleaves two press streams: the AI's opening press starts the bar and
  // S1's opening press locks the power five ticks later, so every placekick
  // came off at 10% power and every field goal and extra point missed short.
  const plan = ext(ctx.state).kick;
  if (plan !== null && plan.auto) return;
  // A meter that is live but not yet started still needs its opening press.
  if (meter.startTick < 0) {
    if (presses === 0 && ctx.t >= ST_AI.meterStartTick) {
      mindSet(k, MIND_PRESSES, 1);
      pressKickMeter(ctx.state, ctx.events);
    }
    return;
  }
  if (!meter.active) {
    if (presses === 0 && ctx.t >= ST_AI.meterStartTick) {
      mindSet(k, MIND_PRESSES, 1);
      pressKickMeter(ctx.state, ctx.events);
    }
    return;
  }
  if (meter.powerLockTick === null) {
    if (ctx.state.tick - meter.startTick >= mindGet(k, MIND_POWER_TICKS, KICK.meterFillTicks)) {
      mindSet(k, MIND_PRESSES, 2);
      pressKickMeter(ctx.state, ctx.events);
    }
    return;
  }
  if (meter.accuracyLockTick === null) {
    if (ctx.state.tick - meter.powerLockTick >= mindGet(k, MIND_SWEEP_TICKS, 25)) {
      mindSet(k, MIND_PRESSES, 3);
      pressKickMeter(ctx.state, ctx.events);
    }
  }
}

export function updateHolder(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  applyMove(ctx, i, { x: 0, y: 0 });
  p.anim = 'idle';
}

// ---------------------------------------------------------------------------
// Coverage lanes
// ---------------------------------------------------------------------------

function laneTargetX(laneIndex: number): number {
  const frac = (Math.max(0, Math.min(ST_AI.laneCount - 1, laneIndex)) + 0.5) / ST_AI.laneCount;
  return clampFieldX(frac * FIELD_W);
}

function returnerIdx(ctx: AiCtx): number {
  for (let i = 0; i < ctx.players.length; i++) {
    const p = ctx.players[i];
    if (p && p.assignment.kind === 'returner') return i;
  }
  return -1;
}

export function updateCoverLane(ctx: AiCtx, i: number, laneIndex: number, contain: boolean): void {
  const p = ctx.players[i];
  if (!p) return;
  if (p.engagedWith !== null) return;

  const ri = returnerIdx(ctx);
  const returner = ri >= 0 ? ctx.players[ri] : undefined;

  // Once the return is live, converge (contain men stay outside).
  if (ctx.carrierIdx >= 0 && ctx.carrierIdx !== i) {
    const c = ctx.players[ctx.carrierIdx];
    if (c && c.team !== p.team) {
      if (contain) {
        const side = p.pos2.x < c.pos2.x ? -1 : 1;
        const aim: Vec2 = { x: c.pos2.x + side * ST_AI.containOutsideYd, y: c.pos2.y };
        applyMove(ctx, i, seek(p, clampFieldPoint(aim)), { sprinting: true });
        faceToward(p, c.pos2);
        maybeTackle(ctx, i);
        return;
      }
      updatePursuit(ctx, i);
      return;
    }
  }

  // Gunners release straight at the catch point; the rest hold their lane.
  const wide = Math.abs(p.pos2.x - ctx.ball.pos2.x) > ST_AI.gunnerLateralYd;
  const land = predictLanding(ctx.ball);
  const aimY = returner ? returner.pos2.y : land.pos.y;
  const aim: Vec2 = wide || contain
    ? { x: returner ? returner.pos2.x + (p.pos2.x < (returner.pos2.x) ? -ST_AI.containOutsideYd : ST_AI.containOutsideYd) : laneTargetX(laneIndex), y: aimY }
    : { x: laneTargetX(laneIndex), y: aimY };
  applyMove(ctx, i, seek(p, clampFieldPoint(aim)), { sprinting: true });
  p.anim = 'running';
  maybeTackle(ctx, i);
}

// ---------------------------------------------------------------------------
// Return blocking
// ---------------------------------------------------------------------------

export function updateReturnBlock(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  if (p.engagedWith !== null) { blockNearestThreat(ctx, i); return; }

  const ri = returnerIdx(ctx);
  const returner = ri >= 0 ? ctx.players[ri] : undefined;
  const live = ctx.carrierIdx >= 0 && ctx.carrierIdx === ri;
  if (live || !returner) { blockNearestThreat(ctx, i); return; }

  // Set the wedge in front of the returner while the ball is in the air.
  const wedgeY = returner.pos2.y - ST_AI.wedgeDepthYd * ctx.dir;
  const spot: Vec2 = { x: p.pos2.x, y: wedgeY };
  const nearestCover = nearestCoverageMan(ctx, i);
  if (nearestCover >= 0) {
    const c = ctx.players[nearestCover] as SimPlayer;
    if (dist(c.pos2, returner.pos2) < 22) { blockNearestThreat(ctx, i); return; }
  }
  applyMove(ctx, i, arrive(p, clampFieldPoint(spot), 2.0, maxSpeed(p) * 0.8));
  p.anim = 'running';
}

function nearestCoverageMan(ctx: AiCtx, i: number): number {
  const p = ctx.players[i];
  if (!p) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let j = 0; j < ctx.players.length; j++) {
    const q = ctx.players[j];
    if (!q || q.team === p.team || isIncapacitated(q)) continue;
    const d = dist(p.pos2, q.pos2);
    if (d < bestD) { bestD = d; best = j; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Returner
// ---------------------------------------------------------------------------

function nearestGunnerArrivalTicks(ctx: AiCtx, point: Vec2, myTeam: number): number {
  let best = Infinity;
  for (let j = 0; j < ctx.players.length; j++) {
    const q = ctx.players[j];
    if (!q || q.team === myTeam || isIncapacitated(q)) continue;
    best = Math.min(best, ticksToCover(q, dist(q.pos2, point)));
  }
  return best;
}

export function updateReturner(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;

  const mode = ctx.ball.mode;
  if (mode !== 'kick' && mode !== 'punt') {
    // Ball is not in flight: hold depth and wait.
    applyMove(ctx, i, { x: 0, y: 0 });
    faceToward(p, ctx.ball.pos2);
    p.anim = 'idle';
    return;
  }

  const sol = interceptBall(p, ctx.ball);
  const land = predictLanding(ctx.ball);
  // Our own goal line is the one the kicking team is attacking.
  const ourGoalY = targetGoalY(ctx.dir);
  const landDepthFromGoal = Math.abs(land.pos.y - ourGoalY);
  // Past our own goal line (the one the kicking team is attacking).
  const inEndZone = (land.pos.y - ourGoalY) * ctx.dir > 0;

  if (inEndZone) {
    mindSet(p, MIND_RETURN_DECISION, 2);
    applyMove(ctx, i, arrive(p, clampFieldPoint(land.pos), 2.0, maxSpeed(p) * 0.6));
    faceToward(p, ctx.ball.pos2);
    p.anim = 'idle';
    return;
  }
  mindSet(p, MIND_RETURN_DECISION, 1);

  if (mode === 'punt') {
    const ballTicks = land.tSec * TICK_HZ;
    const gunnerTicks = nearestGunnerArrivalTicks(ctx, land.pos, p.team);
    if (
      mindGet(p, MIND_FAIR_CALLED) === 0
      && gunnerTicks - ballTicks < KICK.fairCatchGunnerArrivalTicks
      && landDepthFromGoal > ST_AI.letBounceInsideYd
    ) {
      mindSet(p, MIND_FAIR_CALLED, 1);
      callFairCatch(ctx.state, i, ctx.events);
    }
    if (landDepthFromGoal <= ST_AI.letBounceInsideYd) {
      // Deep punt inside our own 8: back off and let it bounce.
      applyMove(ctx, i, { x: 0, y: 0 });
      faceToward(p, ctx.ball.pos2);
      p.anim = 'idle';
      return;
    }
  }

  applyMove(ctx, i, seek(p, clampFieldPoint(sol.point)), { sprinting: true });
  faceToward(p, ctx.ball.pos2);
  p.anim = 'catching';
}
