// Ball-carrier brain (sim-design §7): CPU hole hitting with one bounce,
// open-field greedy steering, clock-aware sideline use, and move usage.

import type { GapId, SimPlayer, Vec2 } from '../types';
import { TWO_MINUTE_SEC } from '../constants';
import { tryCarrierMove, type CarrierMove } from '../actions';
import { dist, dot, fromAngle, len, norm, sub } from '../vec';
import { maxSpeed } from '../physics/movement';
import {
  DEFENSE_HI, DEFENSE_LO, OFFENSE_HI, OFFENSE_LO,
  isIncapacitated, mindGet, mindSet, nearestOpponentTo, type AiCtx,
} from './context';
import { GAP_ORDER, GAP_X, clampFieldPoint, depthYd, neighborGaps } from './frame';
import { applyMove, faceToward, seek } from './steering';
import { FIELD_W } from '../constants';

// TODO(balance): carrier AI tunables.
export const CARRIER_AI = {
  gapRescoreTicks: 10,
  gapAimDepthYd: 2.0,
  gapLaneScanYd: 2.5,
  gapLaneDepthYd: 5.0,
  gapDefenderPenalty: 1.5,
  secondLevelDepthYd: 2.0,
  /** Open-field candidate fan. */
  fanHalfAngleRad: 1.31, // ~75 degrees
  fanSteps: 11,
  fanProbeYd: 4.0,
  fanProgressWeight: 1.0,
  fanSpaceWeight: 0.35,
  sidelineAvoidYd: 4.0,
  sidelineAvoidPenalty: 2.5,
  sidelineSeekBonus: 1.8,
  /** Move decisions. */
  moveTriggerYd: 2.4,
  moveCooldownTicks: 30,
  slideDefenderYd: 2.6,
  qbSlideMinDepthYd: 4.0,
} as const;

const MIND_GAP = 'crGap';
const MIND_GAP_TICK = 'crGapTick';
const MIND_BOUNCED = 'crBounced';
const MIND_MOVE_TICK = 'crMoveTick';

function designedAimGap(ctx: AiCtx, i: number): GapId | null {
  const p = ctx.players[i];
  if (!p) return null;
  const declared = ctx.play.offensePlay.assignments[p.role];
  if (declared && declared.kind === 'carry') return declared.aimGap;
  return null;
}

/** Blocked defenders do not count against a running lane. */
function isFreeDefender(d: SimPlayer): boolean {
  return d.engagedWith === null && !isIncapacitated(d);
}

function scoreGap(ctx: AiCtx, gap: GapId): number {
  const point: Vec2 = {
    x: ctx.ball.pos2.x + GAP_X[gap] * ctx.dir,
    y: ctx.los + CARRIER_AI.gapAimDepthYd * ctx.dir,
  };
  let clearance = CARRIER_AI.gapLaneScanYd;
  let inLane = 0;
  for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
    const d = ctx.players[di];
    if (!d || !isFreeDefender(d)) continue;
    const dx = Math.abs(d.pos2.x - point.x);
    const dep = depthYd(d.pos2.y, ctx.los, ctx.dir);
    if (dx < CARRIER_AI.gapLaneScanYd) clearance = Math.min(clearance, dx);
    if (dx < CARRIER_AI.gapLaneScanYd && dep >= -1 && dep <= CARRIER_AI.gapLaneDepthYd) inLane++;
  }
  return clearance - CARRIER_AI.gapDefenderPenalty * inLane;
}

function chooseGap(ctx: AiCtx, i: number, aim: GapId): GapId {
  const p = ctx.players[i];
  if (!p) return aim;
  const cur = Math.round(mindGet(p, MIND_GAP, GAP_ORDER.indexOf(aim)));
  const curGap = (GAP_ORDER[cur] ?? aim) as GapId;
  if (ctx.state.tick - mindGet(p, MIND_GAP_TICK, -999) < CARRIER_AI.gapRescoreTicks) return curGap;
  mindSet(p, MIND_GAP_TICK, ctx.state.tick);

  const options: GapId[] = [curGap, ...neighborGaps(curGap)];
  let best = curGap;
  let bestScore = -Infinity;
  for (const g of options) {
    const s = scoreGap(ctx, g) + (g === curGap ? 0.6 : 0);
    if (s > bestScore) { bestScore = s; best = g; }
  }
  if (best !== curGap) {
    if (mindGet(p, MIND_BOUNCED) === 1) return curGap; // one bounce only
    mindSet(p, MIND_BOUNCED, 1);
    mindSet(p, MIND_GAP, GAP_ORDER.indexOf(best));
    return best;
  }
  return curGap;
}

// ---------------------------------------------------------------------------
// Clock context
// ---------------------------------------------------------------------------

function scoreDiff(ctx: AiCtx): number {
  const off = ctx.ballTeam;
  const opp = off === 0 ? 1 : 0;
  return ctx.state.score[off] - ctx.state.score[opp];
}

/** Trailing late with no timeouts: get out of bounds. */
export function wantsSideline(ctx: AiCtx): boolean {
  const s = ctx.state;
  const late = (s.quarter === 2 || s.quarter >= 4) && s.clockSec <= TWO_MINUTE_SEC;
  return late && scoreDiff(ctx) <= 0 && s.timeouts[ctx.ballTeam] === 0;
}

/** Leading late: stay inbounds and keep the clock moving. */
export function wantsInbounds(ctx: AiCtx): boolean {
  const s = ctx.state;
  return s.quarter >= 4 && s.clockSec <= 300 && scoreDiff(ctx) > 0;
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

function pickMove(ctx: AiCtx, i: number, defIdx: number): CarrierMove {
  const p = ctx.players[i] as SimPlayer;
  const d = ctx.players[defIdx] as SimPlayer;
  const heading = len(p.vel) > 0.5 ? norm(p.vel) : { x: 0, y: ctx.dir };
  const toDef = norm(sub(d.pos2, p.pos2));
  const front = dot(heading, toDef);
  if (front < -0.2) return 'spin';
  if (front > 0.75 && p.ratings.str >= 78) return 'truck';
  if (p.ratings.elu >= p.ratings.str) return 'juke';
  return 'stiffArm';
}

function maybeMove(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  if (ctx.state.tick - mindGet(p, MIND_MOVE_TICK, -999) < CARRIER_AI.moveCooldownTicks) return;
  const near = nearestOpponentTo(ctx, p.pos2, p.team);
  if (near.idx < 0 || near.d > CARRIER_AI.moveTriggerYd) return;
  const d = ctx.players[near.idx];
  if (!d) return;
  const closing = dot(sub(d.vel, p.vel), norm(sub(p.pos2, d.pos2)));
  if (closing <= 0) return;

  // QBs protect themselves once the gain is secured.
  if (isQbRunner(ctx, i) && gainSecured(ctx, i)) {
    mindSet(p, MIND_MOVE_TICK, ctx.state.tick);
    tryCarrierMove(ctx.state, i, 'slide', ctx.rng, ctx.events);
    return;
  }
  if (!ctx.rng.chance(ctx.diff.cpuCarrierMoveChance)) {
    mindSet(p, MIND_MOVE_TICK, ctx.state.tick);
    return;
  }
  mindSet(p, MIND_MOVE_TICK, ctx.state.tick);
  tryCarrierMove(ctx.state, i, pickMove(ctx, i, near.idx), ctx.rng, ctx.events);
}

function isQbRunner(ctx: AiCtx, i: number): boolean {
  const p = ctx.players[i];
  return !!p && (i === ctx.qbIdx || p.pos === 'QB');
}

function gainSecured(ctx: AiCtx, i: number): boolean {
  const p = ctx.players[i];
  if (!p) return false;
  const depth = depthYd(p.pos2.y, ctx.los, ctx.dir);
  const pastSticks = (p.pos2.y - ctx.play.firstDownY) * ctx.dir >= 0;
  return pastSticks || depth >= CARRIER_AI.qbSlideMinDepthYd;
}

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

function openFieldTarget(ctx: AiCtx, i: number): Vec2 {
  const p = ctx.players[i] as SimPlayer;
  const downfield = { x: 0, y: ctx.dir };
  const base = Math.atan2(downfield.y, downfield.x);
  const avoidSideline = wantsInbounds(ctx);
  const seekSideline = wantsSideline(ctx);

  // Two nearest pursuers weight the space term.
  const threats: SimPlayer[] = [];
  for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
    const d = ctx.players[di];
    if (!d || isIncapacitated(d) || d.team === p.team) continue;
    threats.push(d);
  }
  threats.sort((a, b) => dist(a.pos2, p.pos2) - dist(b.pos2, p.pos2));
  const near = threats.slice(0, 2);

  let best: Vec2 = { x: p.pos2.x + downfield.x, y: p.pos2.y + downfield.y };
  let bestScore = -Infinity;
  for (let s = 0; s < CARRIER_AI.fanSteps; s++) {
    const frac = CARRIER_AI.fanSteps === 1 ? 0 : (s / (CARRIER_AI.fanSteps - 1)) * 2 - 1;
    const ang = base + frac * CARRIER_AI.fanHalfAngleRad;
    const probe = fromAngle(ang, CARRIER_AI.fanProbeYd);
    const point: Vec2 = { x: p.pos2.x + probe.x, y: p.pos2.y + probe.y };
    if (point.x < 0.2 || point.x > FIELD_W - 0.2) continue;

    const progress = (point.y - p.pos2.y) * ctx.dir;
    let space = 0;
    for (const d of near) space += Math.min(dist(point, d.pos2), 12);
    let score = progress * CARRIER_AI.fanProgressWeight + space * CARRIER_AI.fanSpaceWeight;

    const edge = Math.min(point.x, FIELD_W - point.x);
    if (avoidSideline && edge < CARRIER_AI.sidelineAvoidYd) score -= CARRIER_AI.sidelineAvoidPenalty;
    if (seekSideline) score += (CARRIER_AI.sidelineAvoidYd * 2 - Math.min(edge, CARRIER_AI.sidelineAvoidYd * 2))
      * (CARRIER_AI.sidelineSeekBonus / (CARRIER_AI.sidelineAvoidYd * 2));
    if (score > bestScore) { bestScore = score; best = point; }
  }
  return best;
}

export function updateCarrier(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;

  maybeMove(ctx, i);

  const depth = depthYd(p.pos2.y, ctx.los, ctx.dir);
  const aim = designedAimGap(ctx, i);
  let target: Vec2;
  if (aim !== null && depth < CARRIER_AI.secondLevelDepthYd) {
    if (mindGet(p, MIND_GAP_TICK, -999) === -999) {
      mindSet(p, MIND_GAP, GAP_ORDER.indexOf(aim));
    }
    const gap = chooseGap(ctx, i, aim);
    target = {
      x: ctx.ball.pos2.x + GAP_X[gap] * ctx.dir,
      y: ctx.los + (CARRIER_AI.gapAimDepthYd + 2) * ctx.dir,
    };
  } else {
    target = openFieldTarget(ctx, i);
  }

  applyMove(ctx, i, seek(p, clampFieldPoint(target), maxSpeed(p, { sprinting: true, carrying: true })), {
    sprinting: true,
    carrying: true,
  });
  faceToward(p, target);
  p.anim = 'running';
}

/** Offensive players who are not the carrier block for him. */
export function isBlockingForCarrier(ctx: AiCtx, i: number): boolean {
  const p = ctx.players[i];
  if (!p || ctx.carrierIdx < 0) return false;
  return i !== ctx.carrierIdx && p.team === ctx.ballTeam
    && i >= OFFENSE_LO && i <= OFFENSE_HI;
}
