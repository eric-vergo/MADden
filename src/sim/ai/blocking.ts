// Blocking (sim-design §5): pairing, engagement contests, drift, double teams,
// pull/lead paths, and open-field/screen blocking.

import type { GapId, SimPlayer, Vec2 } from '../types';
import { BLOCK, MOVE, PENALTY } from '../../data/balance';
import { maybeHoldingOnShed } from '../actions';
import { dist, len, norm, sub } from '../vec';
import { maxSpeed } from '../physics/movement';
import {
  DEFENSE_HI, DEFENSE_LO, OFFENSE_HI, OFFENSE_LO,
  isIncapacitated, mindGet, mindSet, type AiCtx,
} from './context';
import { GAP_X, clampFieldPoint, depthYd, lateral } from './frame';
import { applyMove, arrive, seek } from './steering';

// TODO(balance): blocking AI tunables not present in balance.BLOCK.
export const BLOCK_AI = {
  /** A blocker abandons his man once he leaves this arc (yards). */
  retargetArcYd: 3.0,
  retargetCheckTicks: 15,
  /** Aim point offset in front of the defender when closing. */
  approachLeadSec: 0.25,
  /** Second-level defenders start at this depth (yards past the LOS). */
  secondLevelDepthYd: 3.0,
  /** Pull path: run this far behind the LOS before turning up. */
  pullDepthYd: 1.6,
  /** Extra blocker climbs after this many winning contests. */
  climbAfterWins: 2,
  /** Open-field blockers aim this far in front of the carrier's threat. */
  shieldOffsetYd: 0.9,
  maxBlockersPerDefender: 2,
} as const;

const MIND_TGT = 'bkTgt';
const MIND_ENG = 'bkEngTick';
const MIND_WINS = 'bkWins';
const MIND_SHED_TICK = 'bkShedTick';
const MIND_SHED_MARGIN = 'bkShedMargin';
const MIND_RETARGET = 'bkRetargetTick';
const MIND_PULL = 'bkPullPhase';
const MIND_CLIMB = 'bkClimb';

/** Tick until which a shed defender bursts free (read by pursuit.ts). */
export const MIND_SHED_BURST = 'puShedUntil';

function isBlockKind(kind: string): boolean {
  return kind === 'passBlock' || kind === 'runBlock' || kind === 'leadBlock'
    || kind === 'passProScan';
}

/** The point pass protection is built around. */
export function protectPoint(ctx: AiCtx): Vec2 {
  if (ctx.carrierIdx >= 0) {
    const c = ctx.players[ctx.carrierIdx];
    if (c) return c.pos2;
  }
  if (ctx.qbIdx >= 0) {
    const q = ctx.players[ctx.qbIdx];
    if (q) return q.pos2;
  }
  return { x: ctx.ball.pos2.x, y: ctx.ball.pos2.y };
}

function blockerOrder(ctx: AiCtx): number[] {
  const out: number[] = [];
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    const p = ctx.players[i];
    if (p && isBlockKind(p.assignment.kind)) out.push(i);
  }
  // Inside-out: centre first, then guards, then tackles/backs.
  out.sort((a, b) => {
    const pa = ctx.players[a] as SimPlayer;
    const pb = ctx.players[b] as SimPlayer;
    const da = Math.abs(lateral(pa.pos2.x, ctx.ball.pos2.x, ctx.dir));
    const db = Math.abs(lateral(pb.pos2.x, ctx.ball.pos2.x, ctx.dir));
    return da === db ? a - b : da - db;
  });
  return out;
}

function claimCount(claims: number[], defIdx: number): number {
  let n = 0;
  for (let i = 0; i < claims.length; i++) if (claims[i] === defIdx) n++;
  return n;
}

/**
 * One-time pairing at the snap: every blocker takes the nearest unclaimed
 * threat in his lane arc (big-on-big, inside-out). Unclaimed rushers are FREE.
 */
export function assignBlockPairs(ctx: AiCtx): void {
  const order = blockerOrder(ctx);
  const claims: number[] = [];
  const isRun = ctx.play.offensePlay.type === 'run';

  for (const bi of order) {
    const b = ctx.players[bi];
    if (!b) continue;
    if (b.assignment.kind === 'passProScan') { mindSet(b, MIND_TGT, -1); continue; }
    if (b.assignment.kind === 'runBlock' && b.assignment.target === 'pull-lead') {
      mindSet(b, MIND_TGT, -1);
      mindSet(b, MIND_PULL, 0);
      continue;
    }
    const tgt = pickThreat(ctx, bi, claims, isRun);
    mindSet(b, MIND_TGT, tgt);
    if (tgt >= 0) claims.push(tgt);
  }
}

function threatFilter(ctx: AiCtx, bi: number, di: number, isRun: boolean): boolean {
  const b = ctx.players[bi];
  const d = ctx.players[di];
  if (!b || !d || isIncapacitated(d)) return false;
  const a = b.assignment;
  const dep = depthYd(d.pos2.y, ctx.los, ctx.dir);
  if (a.kind === 'runBlock') {
    if (a.target === 'climb') return dep >= BLOCK_AI.secondLevelDepthYd;
    if (a.target === 'backside') {
      const playside = a.scheme === 'zone-left' ? -1 : 1;
      return lateral(d.pos2.x, ctx.ball.pos2.x, ctx.dir) * playside <= 0.5;
    }
    if (a.target === 'playside-gap') {
      const playside = a.scheme === 'zone-left' ? -1 : 1;
      return lateral(d.pos2.x, b.pos2.x, ctx.dir) * playside >= -1.5;
    }
    return true;
  }
  if (!isRun) {
    // Pass pro only blocks declared rushers (coverage defenders are ignored).
    const declared = ctx.play.defensePlay.assignments[d.role];
    const kind = declared ? declared.kind : d.assignment.kind;
    return kind === 'rush' || kind === 'blitz';
  }
  return dep <= BLOCK_AI.secondLevelDepthYd + 6;
}

function pickThreat(ctx: AiCtx, bi: number, claims: number[], isRun: boolean): number {
  const b = ctx.players[bi];
  if (!b) return -1;
  let best = -1;
  let bestScore = Infinity;
  const bSide = Math.sign(lateral(b.pos2.x, ctx.ball.pos2.x, ctx.dir));
  for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
    const d = ctx.players[di];
    if (!d) continue;
    if (!threatFilter(ctx, bi, di, isRun)) continue;
    const n = claimCount(claims, di);
    if (n >= BLOCK_AI.maxBlockersPerDefender) continue;
    const dSide = Math.sign(lateral(d.pos2.x, ctx.ball.pos2.x, ctx.dir));
    const sideMiss = bSide !== 0 && dSide !== 0 && bSide !== dSide ? 6 : 0;
    const score = dist(b.pos2, d.pos2) + sideMiss + n * 8;
    if (score < bestScore) { bestScore = score; best = di; }
  }
  return best;
}

function retargetIfStale(ctx: AiCtx, bi: number): void {
  const b = ctx.players[bi];
  if (!b || b.engagedWith !== null) return;
  const last = mindGet(b, MIND_RETARGET, -999);
  if (ctx.state.tick - last < BLOCK_AI.retargetCheckTicks) return;
  mindSet(b, MIND_RETARGET, ctx.state.tick);
  const cur = mindGet(b, MIND_TGT, -1);
  const d = cur >= 0 ? ctx.players[cur] : undefined;
  const stale = !d || isIncapacitated(d)
    || (d.engagedWith !== null && d.engagedWith !== bi)
    || dist(b.pos2, d.pos2) > BLOCK_AI.retargetArcYd + 6;
  if (!stale) return;
  const claims: number[] = [];
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    if (i === bi) continue;
    const o = ctx.players[i];
    if (!o) continue;
    const t = mindGet(o, MIND_TGT, -1);
    if (t >= 0) claims.push(t);
  }
  mindSet(b, MIND_TGT, pickThreat(ctx, bi, claims, ctx.play.offensePlay.type === 'run'));
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

function engage(ctx: AiCtx, bi: number, di: number): void {
  const b = ctx.players[bi];
  const d = ctx.players[di];
  if (!b || !d) return;
  b.engagedWith = di;
  d.engagedWith = bi;
  b.anim = 'blocking';
  d.anim = 'engaged';
  mindSet(b, MIND_ENG, ctx.state.tick);
  mindSet(b, MIND_WINS, 0);

  // Holding: a blocker beaten badly who re-engages inside the window.
  const shedTick = mindGet(b, MIND_SHED_TICK, -999);
  const margin = mindGet(b, MIND_SHED_MARGIN, 0);
  if (
    ctx.state.tick - shedTick <= PENALTY.holdingReengageTicks
    && margin < PENALTY.holdingBadShedMargin
  ) {
    maybeHoldingOnShed(ctx.state, bi, margin, ctx.rng, ctx.events);
    mindSet(b, MIND_SHED_TICK, -999);
  }
}

function breakEngagement(b: SimPlayer, d: SimPlayer): void {
  b.engagedWith = null;
  d.engagedWith = null;
  if (b.anim === 'blocking') b.anim = 'running';
  if (d.anim === 'engaged') d.anim = 'running';
}

function doubleTeamPartners(ctx: AiCtx, bi: number, di: number): number {
  let n = 0;
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    if (i === bi) continue;
    const o = ctx.players[i];
    if (o && o.engagedWith === di) n++;
  }
  return n;
}

/**
 * Resolve one engagement contest. Returns the margin (block - shed) when a
 * contest fired this tick, else null.
 */
export function resolveContest(ctx: AiCtx, bi: number): number | null {
  const b = ctx.players[bi];
  if (!b || b.engagedWith === null) return null;
  const di = b.engagedWith;
  const d = ctx.players[di];
  if (!d) { b.engagedWith = null; return null; }

  const since = ctx.state.tick - mindGet(b, MIND_ENG, ctx.state.tick);
  if (since <= 0 || since % BLOCK.contestIntervalTicks !== 0) return null;

  const isRun = ctx.play.offensePlay.type === 'run' || ctx.carrierIdx >= 0;
  const blockRating = isRun ? b.ratings.rbk : b.ratings.pbk;
  const doubles = doubleTeamPartners(ctx, bi, di);
  const blockScore = BLOCK.blockWeight * blockRating + BLOCK.strWeight * b.ratings.str
    + ctx.rng.gauss() * BLOCK.noiseSigma + (doubles > 0 ? BLOCK.doubleTeamBonus : 0);
  const shedScore = BLOCK.blockWeight * d.ratings.shd + BLOCK.strWeight * d.ratings.str
    + ctx.rng.gauss() * BLOCK.noiseSigma;
  const margin = blockScore - shedScore;

  if (margin > BLOCK.pancakeMargin) {
    d.anim = 'down';
    d.stateTimer = BLOCK.pancakeDownTicks;
    mindSet(d, 'aiTimer', 1);
    breakEngagement(b, d);
    mindSet(b, MIND_TGT, -1);
  } else if (margin > BLOCK.winMargin) {
    mindSet(b, MIND_WINS, mindGet(b, MIND_WINS) + 1);
    mindSet(b, MIND_ENG, ctx.state.tick);
    if (doubles > 0 && mindGet(b, MIND_WINS) >= BLOCK_AI.climbAfterWins) {
      // Extra man on a winning double team climbs to the second level.
      mindSet(b, MIND_CLIMB, 1);
    }
  } else if (margin > BLOCK.stalemateMargin) {
    mindSet(b, MIND_ENG, ctx.state.tick);
  } else {
    // SHED.
    mindSet(d, MIND_SHED_BURST, ctx.state.tick + BLOCK.shedBurstTicks);
    b.anim = 'stumbling';
    b.stateTimer = BLOCK.shedStunTicks;
    mindSet(b, 'aiTimer', 1);
    mindSet(b, MIND_SHED_TICK, ctx.state.tick);
    mindSet(b, MIND_SHED_MARGIN, margin);
    breakEngagement(b, d);
  }
  return margin;
}

/** Drive the locked pair (blocker + defender move together). */
function movePair(ctx: AiCtx, bi: number): void {
  const b = ctx.players[bi];
  if (!b || b.engagedWith === null) return;
  const di = b.engagedWith;
  const d = ctx.players[di];
  if (!d) return;

  const anchor = protectPoint(ctx);
  const away = norm(sub(d.pos2, anchor)); // blocker's way = back toward defense
  const wins = mindGet(b, MIND_WINS);
  const doubles = doubleTeamPartners(ctx, bi, di);
  const driftMag = BLOCK.winDriftYdPerSec * (doubles > 0 ? 2 : 1);
  let drift: Vec2;
  if (wins > 0) {
    drift = { x: away.x * driftMag, y: away.y * driftMag };
  } else {
    // Stalemate: the defender steers the pair slowly toward the ball.
    const toBall = norm(sub(anchor, d.pos2));
    drift = { x: toBall.x * driftMag * 0.5, y: toBall.y * driftMag * 0.5 };
  }
  const capped: Vec2 = {
    x: drift.x * MOVE.engagedSpeedMult * 10,
    y: drift.y * MOVE.engagedSpeedMult * 10,
  };
  applyMove(ctx, bi, capped);
  applyMove(ctx, di, capped);
  b.anim = 'blocking';
  d.anim = 'engaged';
}

/** Close on `target` and engage at BLOCK.engageRangeYd. */
function closeAndEngage(ctx: AiCtx, bi: number, targetIdx: number, aim?: Vec2): void {
  const b = ctx.players[bi];
  if (!b) return;
  const t = targetIdx >= 0 ? ctx.players[targetIdx] : undefined;
  if (!t) {
    if (aim) applyMove(ctx, bi, arrive(b, clampFieldPoint(aim), 1.0));
    else applyMove(ctx, bi, { x: 0, y: 0 });
    return;
  }
  const d = dist(b.pos2, t.pos2);
  if (d <= BLOCK.engageRangeYd && !isIncapacitated(t) && t.engagedWith === null) {
    engage(ctx, bi, targetIdx);
    movePair(ctx, bi);
    return;
  }
  const lead: Vec2 = {
    x: t.pos2.x + t.vel.x * BLOCK_AI.approachLeadSec,
    y: t.pos2.y + t.vel.y * BLOCK_AI.approachLeadSec,
  };
  applyMove(ctx, bi, seek(b, clampFieldPoint(lead)));
  b.anim = 'blocking';
}

// ---------------------------------------------------------------------------
// Per-assignment brains
// ---------------------------------------------------------------------------

export function updateBlocker(ctx: AiCtx, bi: number): void {
  const b = ctx.players[bi];
  if (!b) return;

  if (b.engagedWith !== null) {
    const margin = resolveContest(ctx, bi);
    if (b.engagedWith !== null) movePair(ctx, bi);
    else if (margin !== null && margin > BLOCK.pancakeMargin) retargetIfStale(ctx, bi);
    return;
  }

  const a = b.assignment;
  if (a.kind === 'runBlock' && a.target === 'pull-lead') { pullLead(ctx, bi); return; }
  if (a.kind === 'leadBlock') { leadThroughGap(ctx, bi, a.throughGap); return; }
  if (mindGet(b, MIND_CLIMB) === 1) { climbToSecondLevel(ctx, bi); return; }

  retargetIfStale(ctx, bi);
  const tgt = mindGet(b, MIND_TGT, -1);
  if (tgt < 0) { blockNearestThreat(ctx, bi); return; }

  // Pass pro sets depth: drop a touch to keep the rusher in front of the QB.
  const anchor = protectPoint(ctx);
  const t = ctx.players[tgt];
  if (t && ctx.play.offensePlay.type !== 'run') {
    const toQb = norm(sub(anchor, t.pos2));
    const aim: Vec2 = {
      x: t.pos2.x + toQb.x * BLOCK.engageRangeYd * 0.8,
      y: t.pos2.y + toQb.y * BLOCK.engageRangeYd * 0.8,
    };
    closeAndEngage(ctx, bi, tgt, aim);
    return;
  }
  closeAndEngage(ctx, bi, tgt);
}

function climbToSecondLevel(ctx: AiCtx, bi: number): void {
  const b = ctx.players[bi];
  if (!b) return;
  let best = -1;
  let bestD = Infinity;
  for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
    const d = ctx.players[di];
    if (!d || isIncapacitated(d) || d.engagedWith !== null) continue;
    if (depthYd(d.pos2.y, ctx.los, ctx.dir) < BLOCK_AI.secondLevelDepthYd) continue;
    const dd = dist(b.pos2, d.pos2);
    if (dd < bestD) { bestD = dd; best = di; }
  }
  mindSet(b, MIND_TGT, best);
  mindSet(b, MIND_CLIMB, 0);
  closeAndEngage(ctx, bi, best);
}

function pullLead(ctx: AiCtx, bi: number): void {
  const b = ctx.players[bi];
  if (!b) return;
  const aimGap = carrierAimGap(ctx);
  const gapX = aimGap === null ? 0 : GAP_X[aimGap];
  const phase = mindGet(b, MIND_PULL, 0);
  const behindLos: Vec2 = {
    x: ctx.ball.pos2.x + gapX * ctx.dir,
    y: ctx.los - BLOCK_AI.pullDepthYd * ctx.dir,
  };
  if (phase === 0) {
    const lateralGap = Math.abs(b.pos2.x - behindLos.x);
    if (lateralGap < 1.2) mindSet(b, MIND_PULL, 1);
    applyMove(ctx, bi, seek(b, clampFieldPoint(behindLos)), { sprinting: true });
    b.anim = 'blocking';
    return;
  }
  // Turn up through the gap and take the first threat.
  const upfield: Vec2 = { x: behindLos.x, y: ctx.los + 3 * ctx.dir };
  const threat = firstThreatNear(ctx, bi, upfield, 5);
  if (threat >= 0) { mindSet(b, MIND_TGT, threat); closeAndEngage(ctx, bi, threat); return; }
  applyMove(ctx, bi, seek(b, clampFieldPoint(upfield)), { sprinting: true });
}

function leadThroughGap(ctx: AiCtx, bi: number, gap: GapId): void {
  const b = ctx.players[bi];
  if (!b) return;
  const mouth: Vec2 = {
    x: ctx.ball.pos2.x + GAP_X[gap] * ctx.dir,
    y: ctx.los + 1.5 * ctx.dir,
  };
  const threat = firstThreatNear(ctx, bi, mouth, 4.5);
  if (threat >= 0) { mindSet(b, MIND_TGT, threat); closeAndEngage(ctx, bi, threat); return; }
  applyMove(ctx, bi, seek(b, clampFieldPoint(mouth)), { sprinting: true });
  b.anim = 'blocking';
}

function firstThreatNear(ctx: AiCtx, bi: number, point: Vec2, radius: number): number {
  const b = ctx.players[bi];
  if (!b) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let di = 0; di < ctx.players.length; di++) {
    const d = ctx.players[di];
    if (!d || d.team === b.team || isIncapacitated(d)) continue;
    if (d.engagedWith !== null && d.engagedWith !== bi) continue;
    const dd = dist(point, d.pos2);
    if (dd < radius && dd < bestD) { bestD = dd; best = di; }
  }
  return best;
}

function carrierAimGap(ctx: AiCtx): GapId | null {
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    const p = ctx.players[i];
    if (!p) continue;
    const declared = ctx.play.offensePlay.assignments[p.role];
    if (declared && declared.kind === 'carry') return declared.aimGap;
  }
  return null;
}

/**
 * Open-field / screen blocking: shield the nearest threat to the ball carrier
 * by arriving between him and the carrier, then engage on contact.
 */
export function blockNearestThreat(ctx: AiCtx, bi: number): void {
  const b = ctx.players[bi];
  if (!b) return;
  if (b.engagedWith !== null) { updateBlocker(ctx, bi); return; }

  const anchor = protectPoint(ctx);
  let best = -1;
  let bestScore = Infinity;
  for (let di = 0; di < ctx.players.length; di++) {
    const d = ctx.players[di];
    if (!d || d.team === b.team || isIncapacitated(d)) continue;
    if (d.engagedWith !== null && d.engagedWith !== bi) continue;
    // Prefer defenders that threaten the ball and that we can actually reach.
    const score = dist(d.pos2, anchor) * 0.8 + dist(d.pos2, b.pos2) * 1.2;
    if (score < bestScore) { bestScore = score; best = di; }
  }
  if (best < 0) { applyMove(ctx, bi, { x: 0, y: 0 }); return; }
  const d = ctx.players[best] as SimPlayer;
  const toThreat = norm(sub(d.pos2, anchor));
  const shield: Vec2 = {
    x: d.pos2.x - toThreat.x * BLOCK_AI.shieldOffsetYd,
    y: d.pos2.y - toThreat.y * BLOCK_AI.shieldOffsetYd,
  };
  if (dist(b.pos2, d.pos2) <= BLOCK.engageRangeYd && d.engagedWith === null) {
    engage(ctx, bi, best);
    movePair(ctx, bi);
    return;
  }
  mindSet(b, MIND_TGT, best);
  applyMove(ctx, bi, seek(b, clampFieldPoint(shield)), { sprinting: true });
  b.anim = 'blocking';
}

/**
 * RB check-release: hold BLOCK.rbScanTicks, attack a leaking blitzer inside the
 * box, otherwise release into the check route.
 */
export function updatePassProScan(ctx: AiCtx, bi: number): void {
  const b = ctx.players[bi];
  if (!b || b.assignment.kind !== 'passProScan') return;
  if (b.engagedWith !== null) { updateBlocker(ctx, bi); return; }

  const anchor = protectPoint(ctx);
  const threat = leakingBlitzer(ctx, bi);
  if (threat >= 0) {
    mindSet(b, MIND_TGT, threat);
    closeAndEngage(ctx, bi, threat);
    return;
  }
  if (ctx.t < BLOCK.rbScanTicks) {
    const spot: Vec2 = { x: anchor.x + 1.4 * ctx.dir, y: anchor.y - 0.6 * ctx.dir };
    applyMove(ctx, bi, arrive(b, clampFieldPoint(spot), 1.2, maxSpeed(b) * 0.6));
    b.anim = 'blocking';
    return;
  }
  const check = b.assignment.checkRoute;
  if (check) {
    b.assignment = { kind: 'route', route: check };
  } else {
    // No check route authored: stay in and help.
    blockNearestThreat(ctx, bi);
  }
}

function leakingBlitzer(ctx: AiCtx, bi: number): number {
  const b = ctx.players[bi];
  if (!b) return -1;
  const anchor = protectPoint(ctx);
  let best = -1;
  let bestD = Infinity;
  for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
    const d = ctx.players[di];
    if (!d || isIncapacitated(d) || d.engagedWith !== null) continue;
    if (Math.abs(lateral(d.pos2.x, ctx.ball.pos2.x, ctx.dir)) > 6.5) continue;
    // Inside the box and already past the LOS toward the pocket.
    if (depthYd(d.pos2.y, ctx.los, ctx.dir) > 0.5) continue;
    const dd = dist(d.pos2, anchor);
    if (dd < 7 && dd < bestD) { bestD = dd; best = di; }
  }
  return best;
}
