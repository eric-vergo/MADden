// CPU quarterback brain (sim-design §10): DROPPING → READING → CHECKDOWN /
// SCRAMBLE / THROWAWAY, with difficulty-driven dwell, thresholds and lead error.

import type { RoleId, SimPlayer, Vec2 } from '../types';
import { PASS, QB_AI } from '../../data/balance';
import { TICK_HZ } from '../constants';
import { throwAway, throwPass } from '../actions';
import { dist, norm, sub } from '../vec';
import { maxSpeed } from '../physics/movement';
import {
  DEFENSE_HI, DEFENSE_LO, OFFENSE_HI, OFFENSE_LO,
  indexOfRole, isIncapacitated, mindGet, mindSet, type AiCtx,
} from './context';
import { alignmentOf } from './memory';
import { clampFieldPoint, lateral } from './frame';
import { applyMove, arrive, faceToward, ticksToCover } from './steering';
import { updateCarrier } from './carrier';

export const QB_STATE = {
  DROPPING: 0,
  READING: 1,
  CHECKDOWN: 2,
  SCRAMBLE: 3,
  THROWAWAY: 4,
  DONE: 5,
} as const;

// TODO(balance): QB brain tunables not present in balance.QB_AI.
export const QB_BRAIN = {
  dropTicks: { '1step': 8, '3step': 18, '5step': 28, gunSet: 14, bootLeft: 30, bootRight: 30, sneak: 0, kneel: 0, spike: 0 } as Record<string, number>,
  bootLateralYd: 7,
  /** A zone defender who beats the ball by more than this kills the read. */
  deadReadTicks: 6,
  breakingAwayBonusYd: 0.5,
  bulletMaxAirYd: 18,
  bulletTightWindowYd: 3.0,
  tackleBoxHalfWidthYd: 6.5,
  scrambleProbeYd: 4.0,
  pocketDriftSpeed: 2.0,
  /** How long the QB rides the mesh fake before drifting clear. */
  meshClearTicks: 8,
} as const;

const MIND_STATE = 'qbState';
const MIND_READ = 'qbRead';
const MIND_READ_TICK = 'qbReadTick';
const MIND_HOLD_TICK = 'qbHoldTick';
const MIND_RESCAN = 'qbRescan';

export function qbIsRunning(p: SimPlayer): boolean {
  return mindGet(p, MIND_STATE, 0) === QB_STATE.SCRAMBLE;
}

export function initQb(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  mindSet(p, MIND_STATE, QB_STATE.DROPPING);
  mindSet(p, MIND_READ, 0);
  mindSet(p, MIND_READ_TICK, -1);
  mindSet(p, MIND_HOLD_TICK, -1);
  mindSet(p, MIND_RESCAN, 0);
}

function awrTimerMult(p: SimPlayer): number {
  if (p.ratings.awr >= QB_AI.awrFastThreshold) return QB_AI.awrTimerFastMult;
  if (p.ratings.awr < QB_AI.awrSlowThreshold) return QB_AI.awrTimerSlowMult;
  return 1;
}

/** Ordered read list: the authored progression, else primary-first routes. */
export function progressionOf(ctx: AiCtx): number[] {
  const play = ctx.play.offensePlay;
  const out: number[] = [];
  if (play.qbProgression) {
    for (const role of play.qbProgression) {
      const idx = indexOfRole(ctx, role as RoleId, OFFENSE_LO, OFFENSE_HI);
      if (idx >= 0) out.push(idx);
    }
    if (out.length > 0) return out;
  }
  let primary = -1;
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    const p = ctx.players[i];
    if (!p) continue;
    const declared = ctx.play.offensePlay.assignments[p.role];
    if (declared && declared.kind === 'route') {
      if (declared.primary && primary < 0) primary = i;
      else out.push(i);
    }
  }
  return primary >= 0 ? [primary, ...out] : out;
}

export function checkdownIdx(ctx: AiCtx): number {
  const role = ctx.play.offensePlay.checkdown;
  if (role) {
    const idx = indexOfRole(ctx, role, OFFENSE_LO, OFFENSE_HI);
    if (idx >= 0) return idx;
  }
  // Fall back to the back out of the backfield.
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    const p = ctx.players[i];
    if (p && (p.role === 'RB' || p.role === 'FB')) return i;
  }
  return -1;
}

export interface Openness {
  sep: number;
  dead: boolean;
  catchPoint: Vec2;
  flightTicks: number;
}

/** Separation at the projected catch point, with the zone dead-read check. */
export function opennessOf(ctx: AiCtx, qbIdx: number, recIdx: number): Openness {
  const qb = ctx.players[qbIdx] as SimPlayer;
  const rec = ctx.players[recIdx];
  if (!rec) return { sep: -1, dead: true, catchPoint: qb.pos2, flightTicks: 0 };

  const airDist = dist(qb.pos2, rec.pos2);
  const ballSpeed = PASS.bulletSpeedBase + PASS.bulletSpeedPerThp * (qb.ratings.thp / 99);
  const flightSec = Math.max(0.25, airDist / Math.max(ballSpeed, 1));
  const catchPoint: Vec2 = {
    x: rec.pos2.x + rec.vel.x * flightSec,
    y: rec.pos2.y + rec.vel.y * flightSec,
  };

  let sep = Infinity;
  let nearest: SimPlayer | null = null;
  let dead = false;
  const flightTicks = flightSec * TICK_HZ;
  for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
    const d = ctx.players[di];
    if (!d || isIncapacitated(d)) continue;
    const dd = dist(d.pos2, catchPoint);
    if (dd < sep) { sep = dd; nearest = d; }
    if (d.assignment.kind === 'zone') {
      const defTicks = ticksToCover(d, dd);
      if (defTicks + QB_BRAIN.deadReadTicks < flightTicks) dead = true;
    }
  }
  if (!Number.isFinite(sep)) sep = 20;
  if (nearest) {
    const away = dot2(sub(rec.pos2, nearest.pos2), rec.vel);
    if (away > 0) sep += QB_BRAIN.breakingAwayBonusYd;
  }
  return { sep, dead, catchPoint, flightTicks };
}

function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 0..1 pressure on the passer. */
export function pressure01(ctx: AiCtx, qbIdx: number): number {
  const qb = ctx.players[qbIdx];
  if (!qb) return 0;
  let best = Infinity;
  let burst = false;
  for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
    const d = ctx.players[di];
    if (!d || isIncapacitated(d) || d.engagedWith !== null) continue;
    const dd = dist(d.pos2, qb.pos2);
    if (dd < best) best = dd;
    if (dd < 3 && mindGet(d, 'puShedUntil', -1) > ctx.state.tick) burst = true;
  }
  if (!Number.isFinite(best)) return 0;
  const raw = 1 - best / QB_AI.pressureRadiusYd;
  const p = Math.max(0, Math.min(1, raw));
  return burst ? Math.max(p, 0.8) : p;
}

function dropPoint(ctx: AiCtx, i: number): Vec2 {
  const p = ctx.players[i] as SimPlayer;
  const a = p.assignment;
  const align = alignmentOf(p);
  if (a.kind !== 'qb') return align;
  const depth = a.drop.depth;
  let lateralOff = 0;
  if (a.drop.type === 'bootLeft') lateralOff = -QB_BRAIN.bootLateralYd;
  if (a.drop.type === 'bootRight') lateralOff = QB_BRAIN.bootLateralYd;
  return {
    x: align.x + lateralOff * ctx.dir,
    y: ctx.los - depth * ctx.dir,
  };
}

function dropDuration(ctx: AiCtx, i: number): number {
  const p = ctx.players[i] as SimPlayer;
  const a = p.assignment;
  if (a.kind !== 'qb') return 0;
  const base = QB_BRAIN.dropTicks[a.drop.type] ?? 20;
  const pa = ctx.play.offensePlay.playAction;
  const fake = pa ? pa.fakeTicks : 0;
  return Math.round((base + fake) * awrTimerMult(p));
}

function throwTo(ctx: AiCtx, i: number, targetIdx: number, sep: number): void {
  const qb = ctx.players[i] as SimPlayer;
  const rec = ctx.players[targetIdx];
  const airDist = rec ? dist(qb.pos2, rec.pos2) : 0;
  const bullet = airDist <= QB_BRAIN.bulletMaxAirYd || sep <= QB_BRAIN.bulletTightWindowYd;
  mindSet(qb, MIND_STATE, QB_STATE.DONE);
  qb.anim = 'throwing';
  throwPass(
    ctx.state,
    i,
    targetIdx,
    { bullet, leadErrorSigmaYd: ctx.diff.cpuThrowLeadErrorSigmaYd },
    ctx.rng,
    ctx.events,
  );
}

function outsideTackleBox(ctx: AiCtx, qb: SimPlayer): boolean {
  return Math.abs(lateral(qb.pos2.x, ctx.ball.pos2.x, ctx.dir)) > QB_BRAIN.tackleBoxHalfWidthYd;
}

/** Clear escape side (-1 left, +1 right, 0 none) for a scramble. */
function escapeSide(ctx: AiCtx, qb: SimPlayer): -1 | 0 | 1 {
  const sides: Array<-1 | 1> = [-1, 1];
  let bestSide: -1 | 0 | 1 = 0;
  let bestClear: number = QB_AI.scrambleLaneClearYd;
  for (const s of sides) {
    const probe: Vec2 = {
      x: qb.pos2.x + s * QB_BRAIN.scrambleProbeYd * ctx.dir,
      y: qb.pos2.y + 1.0 * ctx.dir,
    };
    let clear = Infinity;
    for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
      const d = ctx.players[di];
      if (!d || isIncapacitated(d) || d.engagedWith !== null) continue;
      clear = Math.min(clear, dist(d.pos2, probe));
    }
    if (clear > bestClear) { bestClear = clear; bestSide = s; }
  }
  return bestSide;
}

export function updateQb(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p || p.assignment.kind !== 'qb') return;
  const drop = p.assignment.drop.type;

  // Administrative plays belong to the phase handler, not the AI.
  if (drop === 'kneel' || drop === 'spike') { applyMove(ctx, i, { x: 0, y: 0 }); return; }
  if (drop === 'sneak') { updateCarrier(ctx, i); return; }

  // Designed handoff: ride the mesh, then clear out.
  if (ctx.carrierIdx >= 0 && ctx.carrierIdx !== i) { clearOut(ctx, i); return; }
  if (hasDesignedCarrier(ctx) && ctx.carrierIdx === i) { rideMesh(ctx, i); return; }

  const state = Math.round(mindGet(p, MIND_STATE, QB_STATE.DROPPING));
  if (state === QB_STATE.DONE) { clearOut(ctx, i); return; }
  if (state === QB_STATE.SCRAMBLE) { updateCarrier(ctx, i); return; }

  const press = pressure01(ctx, i);

  if (state === QB_STATE.DROPPING) {
    const target = dropPoint(ctx, i);
    applyMove(ctx, i, arrive(p, clampFieldPoint(target), 1.5, maxSpeed(p) * 0.9));
    faceToward(p, { x: p.pos2.x, y: p.pos2.y + ctx.dir });
    p.anim = 'running';
    if (ctx.t >= dropDuration(ctx, i)) {
      mindSet(p, MIND_STATE, QB_STATE.READING);
      mindSet(p, MIND_READ_TICK, ctx.state.tick);
    }
    return;
  }

  // Escape decisions apply from READING onward.
  if (press > QB_AI.scramblePressureThreshold) {
    const side = escapeSide(ctx, p);
    if (side !== 0 && p.ratings.spd > QB_AI.scrambleMinSpd) {
      mindSet(p, MIND_STATE, QB_STATE.SCRAMBLE);
      updateCarrier(ctx, i);
      return;
    }
  }

  const progression = progressionOf(ctx);
  const dwell = Math.max(1, Math.round(ctx.diff.cpuQbReadDwellTicks * awrTimerMult(p)));
  let readIdx = Math.round(mindGet(p, MIND_READ, 0));
  let readStart = Math.round(mindGet(p, MIND_READ_TICK, ctx.state.tick));

  if (state === QB_STATE.READING && readIdx < progression.length) {
    const tgt = progression[readIdx] as number;
    const open = opennessOf(ctx, i, tgt);
    const decay = Math.pow(1 - QB_AI.opennessDecayPerRead, readIdx);
    const pressMult = press > 0.5 ? 1 - QB_AI.opennessPressureDecay : 1;
    const threshold = ctx.diff.cpuQbOpennessThresholdYd * decay * pressMult;
    if (!open.dead && open.sep >= threshold) { throwTo(ctx, i, tgt, open.sep); return; }
    if (ctx.state.tick - readStart >= dwell) {
      readIdx += 1;
      readStart = ctx.state.tick;
      mindSet(p, MIND_READ, readIdx);
      mindSet(p, MIND_READ_TICK, readStart);
      if (readIdx >= progression.length) {
        mindSet(p, MIND_STATE, QB_STATE.CHECKDOWN);
        mindSet(p, MIND_HOLD_TICK, ctx.state.tick);
      }
    }
    pocketWork(ctx, i, press);
    return;
  }

  // CHECKDOWN: take the outlet, else hold and re-scan once, else throw it away.
  const cd = checkdownIdx(ctx);
  if (cd >= 0) {
    const open = opennessOf(ctx, i, cd);
    if (!open.dead && open.sep >= QB_AI.checkdownMinSepYd) { throwTo(ctx, i, cd, open.sep); return; }
  }
  const held = ctx.state.tick - Math.round(mindGet(p, MIND_HOLD_TICK, ctx.state.tick));
  if (held >= QB_AI.holdAfterProgressionTicks && mindGet(p, MIND_RESCAN) === 0) {
    mindSet(p, MIND_RESCAN, 1);
    mindSet(p, MIND_READ, 0);
    mindSet(p, MIND_READ_TICK, ctx.state.tick);
    mindSet(p, MIND_STATE, QB_STATE.READING);
    pocketWork(ctx, i, press);
    return;
  }
  if (
    mindGet(p, MIND_RESCAN) === 1
    && outsideTackleBox(ctx, p)
    && ctx.t >= PASS.throwawayMinSecPostSnap * TICK_HZ
  ) {
    mindSet(p, MIND_STATE, QB_STATE.THROWAWAY);
    p.anim = 'throwing';
    throwAway(ctx.state, i, ctx.rng, ctx.events);
    mindSet(p, MIND_STATE, QB_STATE.DONE);
    return;
  }
  pocketWork(ctx, i, press);
}

function pocketWork(ctx: AiCtx, i: number, press: number): void {
  const p = ctx.players[i];
  if (!p) return;
  const anchor = dropPoint(ctx, i);
  let target: Vec2 = anchor;
  if (press > QB_AI.scramblePressureThreshold) {
    // Pocket slide away from the closest rusher.
    let nearest: SimPlayer | null = null;
    let bestD = Infinity;
    for (let di = DEFENSE_LO; di <= DEFENSE_HI; di++) {
      const d = ctx.players[di];
      if (!d || isIncapacitated(d) || d.engagedWith !== null) continue;
      const dd = dist(d.pos2, p.pos2);
      if (dd < bestD) { bestD = dd; nearest = d; }
    }
    if (nearest) {
      const away = norm(sub(p.pos2, nearest.pos2));
      target = {
        x: p.pos2.x + away.x * QB_AI.pocketSlideYd,
        y: p.pos2.y + away.y * QB_AI.pocketSlideYd,
      };
    }
  }
  applyMove(ctx, i, arrive(p, clampFieldPoint(target), 1.2, QB_BRAIN.pocketDriftSpeed));
  faceToward(p, { x: p.pos2.x, y: p.pos2.y + ctx.dir });
  p.anim = 'idle';
}

function hasDesignedCarrier(ctx: AiCtx): boolean {
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    const p = ctx.players[i];
    if (!p) continue;
    const declared = ctx.play.offensePlay.assignments[p.role];
    if (declared && declared.kind === 'carry') return true;
  }
  return false;
}

/** Mesh footwork before the exchange. */
function rideMesh(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  const align = alignmentOf(p);
  const target: Vec2 = { x: align.x, y: align.y - 0.8 * ctx.dir };
  applyMove(ctx, i, arrive(p, clampFieldPoint(target), 1.0, maxSpeed(p) * 0.5));
  p.anim = 'running';
}

/** Post-handoff / post-throw: get away from the traffic. */
function clearOut(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  const target: Vec2 = { x: p.pos2.x, y: p.pos2.y - 1.5 * ctx.dir };
  applyMove(ctx, i, arrive(p, clampFieldPoint(target), 2.0, maxSpeed(p) * 0.4));
  p.anim = 'idle';
}
