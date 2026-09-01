// ★ AI entry-point contract between S1 (sim core / phases) and S8 (AI).
// S1 calls ONLY these three functions and treats them as a black box.
//
// S1 CONTRACT NOTES
// -----------------
// * MOVEMENT: updateLiveAI drives every player it touches through
//   physics/movement.stepPlayer, which sets velocity AND integrates position.
//   The phase handler must not integrate those players again. Each moved
//   player gets `mind.aiStepTick = state.tick` so S1 can detect them.
// * STATE TIMERS: the AI decrements stateTimer only for players whose timer it
//   set itself (`mind.aiTimer === 1`, e.g. pancaked defenders, shed-stunned
//   blockers). Timers S1 sets stay S1's to run down.
// * MIND KEYS S1 MAY READ (all numbers):
//     mind.cvPlayBall  — 0 none / 1 intercept attempt / 2 swat (DPI + catch
//                        contest input for defenders playing the ball)
//     mind.stReturnDecision — 1 return / 2 kneel (kick in the end zone)
//     mind.qbSnapPlayClock  — play-clock seconds remaining at which the CPU
//                        offense wants to snap (set in updatePreSnapAI)
//     mind.aiStepTick, mind.aiTimer — see above
// * The AI never writes GameState outside PlayState.players / mind; every
//   resolution goes through sim/actions.ts.

import type { GameState, SimPlayer, TeamSide } from '../types';
import type { SimEvent, TickInput } from '../events';
import type { Rng, RngSet } from '../rng';
import {
  DEFENSE_HI, DEFENSE_LO, OFFENSE_HI, OFFENSE_LO, declaredRushers,
  isIncapacitated, makeCtx, mindGet, mindSet, type AiCtx,
} from './context';
import { hasAlignment, recordAlignment } from './memory';
import { applyMove, faceToward, seek } from './steering';
import { clampFieldPoint } from './frame';
import { assignBlockPairs, blockNearestThreat, updateBlocker, updatePassProScan } from './blocking';
import { setHotIfBlitz, updateRoute } from './routes';
import { initCoverage, updateMan, updateZone } from './coverage';
import {
  carrierOverride, initPursuit, updateBlitz, updatePursuit, updateRunFit, updateRush, updateSpy,
} from './pursuit';
import { updateCarrier, updateCarryPath } from './carrier';
import { initQb, qbIsRunning, updateQb } from './qb';
import {
  initKicker, updateCoverLane, updateHolder, updateKicker, updateReturnBlock, updateReturner,
} from './specialTeams';
import { chooseDefensePlay, chooseOffensePlay, snapPlayClockTarget } from './coach';

export { cpuShouldCallTimeout, snapPlayClockTarget } from './coach';

/**
 * CPU play selection for one team/side, respecting state.nextPlayKind
 * (kickoff → a kickoff play; pat → extraPoint or twoPoint; freeKick → kickoff
 * variant). Returns a play id present in the playbook.
 */
export function cpuCallPlay(
  state: GameState,
  team: TeamSide,
  side: 'offense' | 'defense',
  rng: Rng,
): string {
  return side === 'offense'
    ? chooseOffensePlay(state, team, rng)
    : chooseDefensePlay(state, team, rng);
}

/**
 * Pre-snap AI: latch alignment spots (every authored route is measured from
 * them), settle non-controlled players, and publish the CPU offense's snap
 * timing through `mind.qbSnapPlayClock`.
 */
export function updatePreSnapAI(
  state: GameState,
  _input: TickInput,
  rng: RngSet,
  _events: SimEvent[],
): void {
  const play = state.play;
  if (!play) return;
  for (let i = 0; i < play.players.length; i++) {
    const p = play.players[i];
    if (!p) continue;
    recordAlignment(p);
    if (i === play.controlledIdx) continue;
    p.vel.x = 0;
    p.vel.y = 0;
    if (p.anim === 'running') p.anim = 'idle';
  }
  // Snap timing for the CPU offense (S1 owns the actual snap).
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    const p = play.players[i];
    if (!p || p.assignment.kind !== 'qb') continue;
    if (mindGet(p, 'qbSnapPlayClock', -1) < 0) {
      mindSet(p, 'qbSnapPlayClock', snapPlayClockTarget(state, state.possession, rng.ai));
    }
    break;
  }
}

/**
 * Live-play AI: drives all 22 players except the user-controlled one —
 * routes, coverage, blocking engagements, pass rush, CPU QB brain, carrier
 * decisions, pursuit, tackling attempts, special-teams units.
 * Called by the PLAY_LIVE phase every tick BEFORE physics integration.
 */
export function updateLiveAI(
  state: GameState,
  _input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  const ctx = makeCtx(state, rng.ai, events);
  if (!ctx) return;

  initPlayMemory(ctx);
  runOwnedTimers(ctx);

  // Fixed iteration order: offense 0–10, then defense 11–21.
  for (let i = 0; i < ctx.players.length; i++) {
    if (i === ctx.play.controlledIdx) continue;
    const p = ctx.players[i];
    if (!p) continue;
    if (isIncapacitated(p)) continue;
    dispatch(ctx, i);
  }
}

const MIND_INIT = 'aiInitTick';

function initPlayMemory(ctx: AiCtx): void {
  const anchor = ctx.players[0];
  if (!anchor) return;
  if (mindGet(anchor, MIND_INIT, -1) === ctx.play.snapTick) return;

  for (let i = 0; i < ctx.players.length; i++) {
    const p = ctx.players[i];
    if (!p) continue;
    if (!hasAlignment(p)) recordAlignment(p);
  }

  // Hot-route conversion: more declared rushers than available blockers.
  const rushers = declaredRushers(ctx).length;
  let blockers = 0;
  for (let i = OFFENSE_LO; i <= OFFENSE_HI; i++) {
    const p = ctx.players[i];
    if (!p) continue;
    const k = p.assignment.kind;
    if (k === 'passBlock' || k === 'passProScan' || k === 'runBlock' || k === 'leadBlock') blockers++;
  }
  const blitzing = rushers > blockers;

  for (let i = 0; i < ctx.players.length; i++) {
    const p = ctx.players[i];
    if (!p) continue;
    switch (p.assignment.kind) {
      case 'qb': initQb(ctx, i); break;
      case 'route': setHotIfBlitz(ctx, i, blitzing); break;
      case 'kick': initKicker(ctx, i); break;
      case 'man':
      case 'zone': initCoverage(ctx, i); initPursuit(ctx, i); break;
      case 'rush':
      case 'blitz':
      case 'spy':
      case 'runFit': initPursuit(ctx, i); break;
      default: break;
    }
  }
  assignBlockPairs(ctx);
  mindSet(anchor, MIND_INIT, ctx.play.snapTick);
}

/** Run down only the timers the AI itself set (pancake, shed stun). */
function runOwnedTimers(ctx: AiCtx): void {
  for (let i = 0; i < ctx.players.length; i++) {
    const p = ctx.players[i];
    if (!p || mindGet(p, 'aiTimer') !== 1) continue;
    if (p.stateTimer > 0) p.stateTimer--;
    if (p.stateTimer <= 0) {
      mindSet(p, 'aiTimer', 0);
      if (p.anim === 'down' || p.anim === 'stumbling') p.anim = 'idle';
    }
  }
}

function chaseLooseBall(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  const target = clampFieldPoint(ctx.ball.pos2);
  applyMove(ctx, i, seek(p, target), { sprinting: true });
  faceToward(p, ctx.ball.pos2);
  p.anim = 'running';
}

function isBallTeamBlocker(ctx: AiCtx, i: number, p: SimPlayer): boolean {
  return ctx.carrierIdx >= 0 && i !== ctx.carrierIdx && p.team === ctx.ballTeam;
}

/** Assignments that already own their post-turnover behavior. */
const KEEPS_OWN_BRAIN = new Set(['coverLane', 'kick', 'hold']);

/**
 * A player on the team that snapped the ball, after the other team has taken
 * it away (interception, fumble recovery). Kick/punt coverage is excluded:
 * there the receiving team holding the ball is the normal course of the play.
 */
function isTurnoverChaser(ctx: AiCtx, i: number, p: SimPlayer): boolean {
  return ctx.carrierIdx >= 0 && i !== ctx.carrierIdx
    && p.team === ctx.offense && ctx.ballTeam !== ctx.offense
    && !KEEPS_OWN_BRAIN.has(p.assignment.kind);
}

function dispatch(ctx: AiCtx, i: number): void {
  const p = ctx.players[i];
  if (!p) return;
  const a = p.assignment;

  if (ctx.ball.mode === 'loose') { chaseLooseBall(ctx, i); return; }

  // Whoever has the ball runs the carrier brain (QB keeps his own until he
  // commits to running).
  if (p.hasBall && ctx.ball.mode === 'held') {
    if (a.kind === 'qb') {
      if (qbIsRunning(p)) updateCarrier(ctx, i);
      else updateQb(ctx, i);
      return;
    }
    if (a.kind !== 'kick' && a.kind !== 'hold') {
      if (a.kind !== 'carrierAI') p.assignment = { kind: 'carrierAI' };
      updateCarrier(ctx, i);
      return;
    }
  }

  // A turnover flips jobs both ways. The ball team blocks (below); the team
  // that just LOST the ball has to chase the new carrier instead of finishing
  // its routes and pass protection. Special-teams coverage keeps its own brain
  // (updateCoverLane already converges, and contain men must stay outside).
  if (isTurnoverChaser(ctx, i, p)) { updatePursuit(ctx, i); return; }

  // Skill players on the ball team block once a runner is loose.
  if (isBallTeamBlocker(ctx, i, p)) {
    if (a.kind === 'route' || a.kind === 'returner' || a.kind === 'returnBlock'
      || a.kind === 'idle' || a.kind === 'pursuit' || a.kind === 'findBall') {
      blockNearestThreat(ctx, i);
      return;
    }
  }

  switch (a.kind) {
    // --- offense ---
    case 'route': updateRoute(ctx, i); return;
    case 'passBlock':
    case 'runBlock':
    case 'leadBlock': updateBlocker(ctx, i); return;
    case 'passProScan': updatePassProScan(ctx, i); return;
    case 'carry': updateCarryPath(ctx, i); return;
    case 'qb': updateQb(ctx, i); return;
    case 'kick': updateKicker(ctx, i); return;
    case 'hold': updateHolder(ctx, i); return;

    // --- defense ---
    case 'man':
      if (carrierOverride(ctx, i)) return;
      updateMan(ctx, i);
      return;
    case 'zone':
      if (carrierOverride(ctx, i)) return;
      updateZone(ctx, i);
      return;
    case 'rush': updateRush(ctx, i); return;
    case 'blitz': updateBlitz(ctx, i); return;
    case 'spy': updateSpy(ctx, i); return;
    case 'runFit': updateRunFit(ctx, i, a.gap); return;
    case 'coverLane': updateCoverLane(ctx, i, a.laneIndex, a.contain === true); return;
    case 'returner': updateReturner(ctx, i); return;
    case 'returnBlock': updateReturnBlock(ctx, i); return;

    // --- dynamic ---
    case 'pursuit': updatePursuit(ctx, i); return;
    case 'carrierAI': updateCarrier(ctx, i); return;
    case 'findBall': chaseLooseBall(ctx, i); return;
    case 'idle':
    case 'celebrate':
    default:
      applyMove(ctx, i, { x: 0, y: 0 });
      return;
  }
}

export { makeCtx } from './context';
export type { AiCtx } from './context';
export { DEFENSE_HI, DEFENSE_LO, OFFENSE_HI, OFFENSE_LO };
