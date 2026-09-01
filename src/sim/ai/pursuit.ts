// Pass rush, contain, spy, run fits and pursuit angles (sim-design §9), plus
// the AI's decision to call actions.attemptTackle.

import type { GapId, SimPlayer, Vec2 } from '../types';
import { BLOCK, COVERAGE, TACKLE } from '../../data/balance';
import { attemptTackle } from '../actions';
import { dist, dot, fromAngle, len, norm, sub } from '../vec';
import {
  DEFENSE_HI, DEFENSE_LO, isIncapacitated, mindGet, mindSet, type AiCtx,
} from './context';
import { GAP_X, clampFieldPoint, depthYd } from './frame';
import { MIND_SHED_BURST } from './blocking';
import { applyMove, faceToward, pursuePoint, rotate, seek } from './steering';

// TODO(balance): pursuit tunables not present in balance.COVERAGE.
export const PURSUIT_AI = {
  laneEdgeX: 5.5, laneInteriorX: 1.6,
  /** Rush checkpoint depth: 1 yd behind the LOS (design §9). */
  checkpointDepthYd: -1.0,
  checkpointReachedYd: 1.2,
  containOutsideYd: 2.2,
  blitzGapDepthYd: 0.5,
  runFitDepthYd: 1.0,
  /** Rank-based cutoff lanes: each extra rank aims this much further ahead. */
  cutoffBaseLeadYd: 2.0, cutoffPerRankYd: 1.5,
  angleNoiseRefreshTicks: 20,
  tackleCooldownTicks: 8,
  /** dot(carrierHeading, carrier→tackler) above this = chasing from behind. */
  behindDotThreshold: 0.3,
  frontalArcDot: 0.0,
  /** A QB this far outside the pocket counts as a runner. */
  scrambleTriggerYd: 3.0,
} as const;

const MIND_RECOG_DELAY = 'puRecogDelay';
const MIND_RECOG_TRIGGER = 'puRecogTrigger';
const MIND_NOISE = 'puNoise';
const MIND_NOISE_TICK = 'puNoiseTick';
const MIND_CHECKPOINT = 'puCheckpoint';
const MIND_TACKLE_TICK = 'puTackleTick';

/** Per-play defensive setup (called once from index.ts). */
export function initPursuit(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  let delay = ctx.rng.int(COVERAGE.runRecognitionBaseMin, COVERAGE.runRecognitionBaseMax)
    + ctx.diff.runRecognitionExtraTicks;
  const pa = ctx.play.offensePlay.playAction;
  if (pa && isBoxDefender(ctx, p)) delay += pa.fakeTicks;
  mindSet(p, MIND_RECOG_DELAY, delay);
  mindSet(p, MIND_RECOG_TRIGGER, -1);
  mindSet(p, MIND_CHECKPOINT, 0);
  mindSet(p, MIND_TACKLE_TICK, -999);
  mindSet(p, MIND_NOISE, 0);
  mindSet(p, MIND_NOISE_TICK, -999);
}

function isBoxDefender(ctx: AiCtx, p: SimPlayer): boolean {
  return Math.abs((p.pos2.x - ctx.ball.pos2.x)) < 9
    && depthYd(p.pos2.y, ctx.los, ctx.dir) < 9;
}

function laneX(lane: 'edge-left' | 'edge-right' | 'interior-left' | 'interior-right'): number {
  switch (lane) {
    case 'edge-left': return -PURSUIT_AI.laneEdgeX;
    case 'edge-right': return PURSUIT_AI.laneEdgeX;
    case 'interior-left': return -PURSUIT_AI.laneInteriorX;
    default: return PURSUIT_AI.laneInteriorX;
  }
}

function laneSide(lane: string): -1 | 1 {
  return lane.endsWith('left') ? -1 : 1;
}

/** The point the rush converges on: the QB, or whoever has the ball. */
function rushTarget(ctx: AiCtx): Vec2 {
  if (ctx.carrierIdx >= 0) {
    const c = ctx.players[ctx.carrierIdx];
    if (c) return c.pos2;
  }
  if (ctx.qbIdx >= 0) {
    const q = ctx.players[ctx.qbIdx];
    if (q) return q.pos2;
  }
  return ctx.ball.pos2;
}

function isSprinting(ctx: AiCtx, p: SimPlayer): boolean {
  return ctx.state.tick < mindGet(p, MIND_SHED_BURST, -1);
}

// ---------------------------------------------------------------------------
// Run recognition
// ---------------------------------------------------------------------------

function runTriggerFired(ctx: AiCtx): boolean {
  if (ctx.carrierIdx < 0) return false;
  const c = ctx.players[ctx.carrierIdx];
  if (!c) return false;
  // Mesh complete (someone other than the QB has it) …
  if (ctx.carrierIdx !== ctx.qbIdx) return true;
  // … or the QB has crossed the LOS / left the pocket.
  if (depthYd(c.pos2.y, ctx.los, ctx.dir) > -0.5) return true;
  return Math.abs(c.pos2.x - ctx.ball.pos2.x) > PURSUIT_AI.scrambleTriggerYd + 4;
}

/** True once this defender has diagnosed the run (delay + PA freeze applied). */
export function runRecognized(ctx: AiCtx, i: number): boolean {
  const p = ctx.players[i];
  if (!p) return false;
  let trig = Math.round(mindGet(p, MIND_RECOG_TRIGGER, -1));
  if (trig < 0) {
    if (!runTriggerFired(ctx)) return false;
    trig = ctx.state.tick;
    mindSet(p, MIND_RECOG_TRIGGER, trig);
  }
  return ctx.state.tick - trig >= mindGet(p, MIND_RECOG_DELAY, 0);
}

/**
 * Shared hand-off from any coverage/rush job to carrier pursuit.
 * Returns true when it drove this defender's movement this tick.
 */
export function carrierOverride(ctx: AiCtx, i: number): boolean {
  const p = ctx.players[i];
  if (!p || ctx.carrierIdx < 0) return false;
  const c = ctx.players[ctx.carrierIdx];
  if (!c || c.team === p.team) return false;

  // A completed pass or a turnover needs no run-diagnosis delay.
  const declared = ctx.play.offensePlay.assignments[c.role];
  const immediate = c.team !== ctx.offense
    || (declared !== undefined && declared.kind === 'route');
  if (!immediate && !runRecognized(ctx, i)) return false;

  updatePursuit(ctx, i);
  return true;
}

// ---------------------------------------------------------------------------
// Rush / blitz / spy / run fit
// ---------------------------------------------------------------------------

export function updateRush(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p || p.assignment.kind !== 'rush') return;
  if (p.engagedWith !== null) return; // the blocker drives the pair
  if (carrierOverride(ctx, i)) return;

  const a = p.assignment;
  const target = rushTarget(ctx);
  const side = laneSide(a.lane);

  if (a.contain) {
    const aim: Vec2 = {
      x: target.x + side * PURSUIT_AI.containOutsideYd * ctx.dir,
      y: target.y,
    };
    applyMove(ctx, i, seek(p, clampFieldPoint(aim)), { sprinting: true });
    faceToward(p, target);
    p.anim = 'running';
    maybeTackle(ctx, i);
    return;
  }

  if (mindGet(p, MIND_CHECKPOINT) !== 1) {
    const cp: Vec2 = {
      x: ctx.ball.pos2.x + laneX(a.lane) * ctx.dir,
      y: ctx.los + PURSUIT_AI.checkpointDepthYd * ctx.dir,
    };
    if (dist(p.pos2, cp) <= PURSUIT_AI.checkpointReachedYd
      || depthYd(p.pos2.y, ctx.los, ctx.dir) < PURSUIT_AI.checkpointDepthYd) {
      mindSet(p, MIND_CHECKPOINT, 1);
    } else {
      applyMove(ctx, i, seek(p, clampFieldPoint(cp)), { sprinting: true });
      p.anim = 'running';
      return;
    }
  }

  applyMove(ctx, i, seek(p, clampFieldPoint(target)), { sprinting: isSprinting(ctx, p) || true });
  faceToward(p, target);
  p.anim = 'running';
  maybeTackle(ctx, i);
}

export function updateBlitz(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p || p.assignment.kind !== 'blitz') return;
  if (p.engagedWith !== null) return;
  if (carrierOverride(ctx, i)) return;

  const a = p.assignment;
  if (a.timing === 'delayed' && ctx.t < BLOCK.delayedBlitzTicks) {
    applyMove(ctx, i, { x: 0, y: 0 });
    const qb = rushTarget(ctx);
    faceToward(p, qb);
    return;
  }
  if (mindGet(p, MIND_CHECKPOINT) !== 1) {
    const mouth: Vec2 = {
      x: ctx.ball.pos2.x + GAP_X[a.gap] * ctx.dir,
      y: ctx.los + PURSUIT_AI.blitzGapDepthYd * ctx.dir,
    };
    if (depthYd(p.pos2.y, ctx.los, ctx.dir) < 0) mindSet(p, MIND_CHECKPOINT, 1);
    else {
      applyMove(ctx, i, seek(p, clampFieldPoint(mouth)), { sprinting: true });
      p.anim = 'running';
      return;
    }
  }
  const target = rushTarget(ctx);
  applyMove(ctx, i, seek(p, clampFieldPoint(target)), { sprinting: true });
  faceToward(p, target);
  p.anim = 'running';
  maybeTackle(ctx, i);
}

export function updateSpy(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p || p.assignment.kind !== 'spy') return;
  if (p.engagedWith !== null) return;
  if (carrierOverride(ctx, i)) return;

  const qb = ctx.qbIdx >= 0 ? ctx.players[ctx.qbIdx] : undefined;
  if (!qb) { applyMove(ctx, i, { x: 0, y: 0 }); return; }
  const aim: Vec2 = { x: qb.pos2.x, y: qb.pos2.y + COVERAGE.spyDepthYd * ctx.dir };
  applyMove(ctx, i, seek(p, clampFieldPoint(aim)));
  faceToward(p, qb.pos2);
  p.anim = 'running';
  maybeTackle(ctx, i);
}

export function updateRunFit(ctx: AiCtx, i: number, gap: GapId): void {
  const p = ctx.players[i];
  if (!p) return;
  if (p.engagedWith !== null) return;
  if (carrierOverride(ctx, i)) return;

  const mouth: Vec2 = {
    x: ctx.ball.pos2.x + GAP_X[gap] * ctx.dir,
    y: ctx.los + PURSUIT_AI.runFitDepthYd * ctx.dir,
  };
  applyMove(ctx, i, seek(p, clampFieldPoint(mouth)));
  faceToward(p, ctx.ball.pos2);
  p.anim = 'running';
  maybeTackle(ctx, i);
}

// ---------------------------------------------------------------------------
// Pursuit
// ---------------------------------------------------------------------------

function pursuitRank(ctx: AiCtx, i: number, carrier: SimPlayer): number {
  const me = ctx.players[i];
  if (!me) return 99;
  const myD = dist(me.pos2, carrier.pos2);
  let rank = 0;
  for (let di = 0; di < ctx.players.length; di++) {
    if (di === i) continue;
    const d = ctx.players[di];
    if (!d || isIncapacitated(d) || d.team !== me.team) continue;
    const dd = dist(d.pos2, carrier.pos2);
    if (dd < myD || (dd === myD && di < i)) rank++;
  }
  return rank;
}

function angleNoise(ctx: AiCtx, i: number): number {
  const p = ctx.players[i];
  if (!p) return 0;
  const last = mindGet(p, MIND_NOISE_TICK, -999);
  if (ctx.state.tick - last >= PURSUIT_AI.angleNoiseRefreshTicks) {
    mindSet(p, MIND_NOISE_TICK, ctx.state.tick);
    mindSet(p, MIND_NOISE, ctx.rng.gauss() * ctx.diff.pursuitAngleNoiseDeg * (Math.PI / 180));
  }
  return mindGet(p, MIND_NOISE, 0);
}

/** Chase the live ball carrier: two men direct, the rest on cutoff lanes. */
export function updatePursuit(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p || ctx.carrierIdx < 0) return;
  if (p.engagedWith !== null) return;
  const c = ctx.players[ctx.carrierIdx];
  if (!c) return;

  const rank = pursuitRank(ctx, i, c);
  let aim: Vec2;
  if (rank < COVERAGE.pursuitDirectCount) {
    aim = pursuePoint(p, c.pos2, c.vel);
  } else {
    const heading = len(c.vel) > 0.5 ? norm(c.vel) : { x: 0, y: ctx.dir };
    const lead = PURSUIT_AI.cutoffBaseLeadYd + rank * PURSUIT_AI.cutoffPerRankYd;
    aim = { x: c.pos2.x + heading.x * lead, y: c.pos2.y + heading.y * lead };
  }

  const toAim = sub(aim, p.pos2);
  const noisy = rotate(toAim, angleNoise(ctx, i));
  const target: Vec2 = { x: p.pos2.x + noisy.x, y: p.pos2.y + noisy.y };
  applyMove(ctx, i, seek(p, clampFieldPoint(target)), { sprinting: true });
  faceToward(p, c.pos2);
  p.anim = 'running';
  maybeTackle(ctx, i);
}

/**
 * Tackle geometry gate (design §8): within range, closing, carrier in the
 * frontal arc (or a shorter reach from behind). Calls actions.attemptTackle.
 */
export function maybeTackle(ctx: AiCtx, i: number): boolean {
  const p = ctx.players[i];
  if (!p || ctx.carrierIdx < 0 || ctx.carrierIdx === i) return false;
  const c = ctx.players[ctx.carrierIdx];
  if (!c || c.team === p.team) return false;
  if (ctx.state.tick - mindGet(p, MIND_TACKLE_TICK, -999) < PURSUIT_AI.tackleCooldownTicks) {
    return false;
  }

  const toCarrier = sub(c.pos2, p.pos2);
  const d = len(toCarrier);
  if (d < 1e-6) return false;
  const dirToCarrier = { x: toCarrier.x / d, y: toCarrier.y / d };
  const carrierHeading = len(c.vel) > 0.5 ? norm(c.vel) : { x: 0, y: ctx.dir };
  // The tackler trails the runner when he sits along the runner's heading.
  const fromBehind = dot(carrierHeading, dirToCarrier) > PURSUIT_AI.behindDotThreshold;
  const range = fromBehind ? TACKLE.behindRangeYd : TACKLE.attemptRangeYd;
  if (d > range) return false;

  const closing = dot(sub(p.vel, c.vel), dirToCarrier);
  if (closing < 0) return false;
  if (!fromBehind && dot(fromAngle(p.facing), dirToCarrier) < PURSUIT_AI.frontalArcDot) return false;

  mindSet(p, MIND_TACKLE_TICK, ctx.state.tick);
  attemptTackle(ctx.state, i, { hitStick: false }, ctx.rng, ctx.events);
  return true;
}
