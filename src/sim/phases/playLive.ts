// PLAY_LIVE: user control, AI, mesh, ball flight, catches, boundaries, and the
// safety whistle that guarantees every play terminates.

import {
  GameAction, GamePhase,
  type DeadReason, type GameState, type OffAssignment, type PlayState, type Vec2,
} from '../types';
import type { SimEvent, TickInput } from '../events';
import type { RngSet } from '../rng';
import {
  CROSSBAR_HEIGHT, FORWARD_PROGRESS_WINDOW_TICKS, GOALPOST_HALF_WIDTH,
  TOUCHBACK_KICKOFF_YD, TOUCHBACK_OTHER_YD,
} from '../constants';
import { CENTER_X } from '../constants';
import { KICK, MOVE, PASS, PLAY_TIMING, TACKLE } from '../../data/balance';
import { updateLiveAI } from '../ai/index';
import { attemptTackle, callFairCatch, pressKickMeter, throwAway, throwPass, tryCarrierMove } from '../actions';
import { ext, setPhase } from '../rules/ext';
import { tickClock } from '../rules/clock';
import { bestProgressY, otherTeam } from '../rules/downs';
import {
  accuracy01, accuracyErrorAt, aimErrorRad, forceExpiry, powerAt,
} from '../rules/kickMeter';
import {
  carryBall, kickLaunch, pitchLaunch, stepBall,
} from '../physics/ballFlight';
import { isOutOfBoundsX, separateTeammates } from '../physics/collisions';
import { maxSpeed, stepPlayer } from '../physics/movement';
import {
  attackEndLineY, attackGoalY, ownGoalY, ownYardLineY, clampFieldY,
} from '../transform';
import { missedFieldGoalSpot, touchbackSpot } from '../rules/scoring';
import { defaultOutcome } from './outcome';

const DROPBACK_TYPES: readonly string[] = ['pass', 'playAction', 'screen', 'twoPoint'];

/** Grace ticks before an untouched user kick meter starts itself. */
const USER_METER_START_GRACE = PLAY_TIMING.userMeterStartGraceTicks;

function isDropbackSack(
  s: GameState,
  p: PlayState,
  c: { role: string; team: number; pos2: { y: number } } | undefined,
): boolean {
  if (c === undefined || c.role !== 'QB') return false;
  if (!DROPBACK_TYPES.includes(p.offensePlay.type)) return false;
  const dir = s.attackDir[ext(s).playOffense];
  return (c.pos2.y - p.lineOfScrimmageY) * dir < 0;
}

const THROW_KEYS: readonly GameAction[] = [
  GameAction.Throw1, GameAction.Throw2, GameAction.Throw3, GameAction.Throw4, GameAction.Throw5,
];

function decayTimers(p: PlayState): void {
  for (let i = 0; i < p.players.length; i++) {
    const pl = p.players[i];
    if (pl === undefined) continue;
    // Timers the AI set are the AI's to run down (see sim/ai/index.ts).
    if (pl.mind['aiTimer'] === 1) continue;
    if (pl.stateTimer > 0) {
      pl.stateTimer -= 1;
      if (pl.stateTimer === 0 && (pl.anim === 'stumbling' || pl.anim === 'engaged')) {
        pl.anim = 'idle';
        pl.engagedWith = null;
      }
    }
  }
}

/** Offense eligible receivers, in canonical slot order, capped at five. */
function eligibleReceivers(p: PlayState): number[] {
  const out: number[] = [];
  for (let i = 0; i < 11 && out.length < 5; i++) {
    const pl = p.players[i];
    if (pl === undefined) continue;
    const a = pl.assignment;
    if (a.kind === 'route' || a.kind === 'passProScan') out.push(i);
  }
  return out;
}

function handleUserInput(
  s: GameState,
  p: PlayState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  const idx = p.controlledIdx;
  if (idx < 0) return;
  const me = p.players[idx];
  if (me === undefined || me.anim === 'down') return;
  const e = ext(s);

  for (const c of input.commands) {
    if (c.type === 'RETURN_DECISION') e.returnKneel = c.choice === 'kneel';
    if (c.type === 'SWITCH_CONTROLLED' && c.playerIdx >= 0 && c.playerIdx < p.players.length) {
      p.controlledIdx = c.playerIdx;
      events.push({ type: 'CONTROL_CHANGED', tick: s.tick, controlledIdx: c.playerIdx });
    }
  }

  if (p.kickMeter.active && input.frame.pressed.has(GameAction.MeterPress)) {
    pressKickMeter(s, events);
  }
  if (p.kickMeter.active && p.kickMeter.accuracyLockTick === null) {
    if (input.frame.held.has(GameAction.Left)) p.kickMeter.aimOffset -= 0.004;
    if (input.frame.held.has(GameAction.Right)) p.kickMeter.aimOffset += 0.004;
    p.kickMeter.aimOffset = Math.max(
      -KICK.aimMaxOffsetRad, Math.min(KICK.aimMaxOffsetRad, p.kickMeter.aimOffset),
    );
  }

  const sprinting = input.frame.held.has(GameAction.Sprint);
  const carrying = me.hasBall;

  // Movement.
  const mv = input.frame.move;
  const mag = Math.hypot(mv.x, mv.y);
  if (mag > MOVE.inputDeadZone && me.stateTimer === 0 && me.engagedWith === null) {
    const v = maxSpeed(me, { sprinting, carrying });
    stepPlayer(me, { x: (mv.x / mag) * v, y: (mv.y / mag) * v }, { sprinting, carrying });
  } else if (me.stateTimer === 0) {
    stepPlayer(me, { x: 0, y: 0 }, { sprinting, carrying });
  }

  const dir = s.attackDir[e.playOffense];
  const isPasser = carrying && me.role === 'QB'
    && (me.pos2.y - p.lineOfScrimmageY) * dir <= 0.5
    && p.ball.mode === 'held';

  if (isPasser) {
    const targets = eligibleReceivers(p);
    for (let slot = 0; slot < THROW_KEYS.length; slot++) {
      const key = THROW_KEYS[slot] as GameAction;
      if (input.frame.pressed.has(key)) {
        e.throwHoldTick = s.tick;
        e.throwHoldSlot = slot;
      }
      if (input.frame.released.has(key) && e.throwHoldSlot === slot) {
        const target = targets[slot];
        if (target !== undefined) {
          const held = s.tick - e.throwHoldTick;
          throwPass(s, idx, target, { bullet: held >= PASS.bulletHoldTicks }, rng.physics, events);
        }
        e.throwHoldTick = -1;
        e.throwHoldSlot = -1;
      }
    }
    if (input.frame.pressed.has(GameAction.ThrowAway)) throwAway(s, idx, rng.physics, events);
  } else if (carrying) {
    if (input.frame.pressed.has(GameAction.Juke)) tryCarrierMove(s, idx, 'juke', rng.physics, events);
    if (input.frame.pressed.has(GameAction.Spin)) tryCarrierMove(s, idx, 'spin', rng.physics, events);
    if (input.frame.pressed.has(GameAction.StiffArm)) tryCarrierMove(s, idx, 'stiffArm', rng.physics, events);
    if (input.frame.pressed.has(GameAction.Dive)) {
      tryCarrierMove(s, idx, me.role === 'QB' ? 'slide' : 'dive', rng.physics, events);
    }
  } else if (me.team !== e.playOffense) {
    if (input.frame.pressed.has(GameAction.Dive)) {
      attemptTackle(s, idx, { hitStick: true }, rng.physics, events);
    }
    if (input.frame.pressed.has(GameAction.FairCatch)) callFairCatch(s, idx, events);
  }
}

function advanceMesh(s: GameState, p: PlayState, events: SimEvent[]): void {
  const e = ext(s);
  if (e.meshDone) return;
  let carryIdx = -1;
  let carry: Extract<OffAssignment, { kind: 'carry' }> | null = null;
  for (let i = 0; i < 11; i++) {
    const pl = p.players[i];
    if (pl === undefined) continue;
    const a = pl.assignment as OffAssignment;
    if (a.kind === 'carry') { carryIdx = i; carry = a; break; }
  }
  if (carryIdx < 0 || carry === null) { e.meshDone = true; return; }
  if (s.tick - p.snapTick < carry.meshTick) return;
  e.meshDone = true;

  const holderIdx = p.ball.carrierIdx;
  if (holderIdx === null) return;
  const holder = p.players[holderIdx];
  const back = p.players[carryIdx];
  if (holder === undefined || back === undefined || holderIdx === carryIdx) return;

  const d = Math.hypot(holder.pos2.x - back.pos2.x, holder.pos2.y - back.pos2.y);
  if (carry.mesh === 'pitch') {
    const launch = pitchLaunch(holder.pos2, back.pos2, 1.1);
    holder.hasBall = false;
    p.ball.carrierIdx = null;
    p.ball.targetIdx = carryIdx;
    p.ball.mode = 'pitch';
    p.ball.z = 1.1;
    p.ball.vel = { x: launch.vel.x, y: launch.vel.y };
    p.ball.vz = launch.vz;
    e.lastPasserIdx = holderIdx;
    e.lastTargetIdx = carryIdx;
    e.throwTick = s.tick;
    events.push({ type: 'PITCH', tick: s.tick, carrierIdx: carryIdx });
    return;
  }
  if (d > 1.5) return; // mesh missed — the quarterback keeps it
  holder.hasBall = false;
  back.hasBall = true;
  p.ball.carrierIdx = carryIdx;
  p.ball.mode = 'held';
  e.lastCarrierIdx = carryIdx;
  events.push({ type: 'HANDOFF', tick: s.tick, carrierIdx: carryIdx });
}

function handleKneelSpike(s: GameState, p: PlayState, events: SimEvent[]): void {
  const e = ext(s);
  const o = e.outcome;
  if (o === null) return;
  const snapEl = s.tick - p.snapTick;
  const dir = s.attackDir[e.playOffense];
  if (p.offensePlay.type === 'kneel' && snapEl >= 25) {
    o.spotY = p.lineOfScrimmageY - 1 * dir;
    o.spotX = p.ball.pos2.x;
    o.carrierIdx = p.ball.carrierIdx;
    e.spotFixed = true;
    p.deadReason = 'kneel';
  } else if (p.offensePlay.type === 'spike' && snapEl >= 3) {
    o.spotY = p.lineOfScrimmageY;
    o.spotX = p.ball.pos2.x;
    e.spotFixed = true;
    p.ball.mode = 'dead';
    p.deadReason = 'spike';
    events.push({ type: 'INCOMPLETE', tick: s.tick, targetIdx: null, throwaway: false });
  }
}

function launchKick(s: GameState, p: PlayState, events: SimEvent[]): void {
  const e = ext(s);
  const plan = e.kick;
  if (plan === null || plan.launched) return;
  const km = p.kickMeter;
  if (km.accuracyLockTick === null) return;

  const kicker = p.players[plan.kickerIdx];
  const power = powerAt(km, s.tick);
  const signed = accuracyErrorAt(km, s.tick);
  const acc = accuracy01(signed);
  const aim = aimErrorRad(signed, km.aimOffset);
  const dir = s.attackDir[e.playOffense];
  const heading = (dir === 1 ? Math.PI / 2 : -Math.PI / 2) + aim;
  const kpw = kicker === undefined ? 75 : kicker.ratings.kpw;

  let dist: number;
  let hang: number;
  if (plan.style === 'kickoff') {
    dist = KICK.kickoffDistBase + KICK.kickoffDistPerPower * power * (kpw / 99);
    hang = KICK.kickoffHangSecMin + (KICK.kickoffHangSecMax - KICK.kickoffHangSecMin) * power;
  } else if (plan.style === 'punt') {
    dist = KICK.puntDistBase + KICK.puntDistPerPower * power * (kpw / 99);
    hang = KICK.puntHangSec;
  } else {
    const maxRange = KICK.fgMaxRangeBase + KICK.fgMaxRangePerKpw * (kpw / 99);
    dist = maxRange * power;
    hang = Math.sqrt(Math.max(0.4, (2 * dist * 0.7) / 10.72));
  }

  const from: Vec2 = kicker === undefined
    ? { x: p.ball.pos2.x, y: plan.spotY }
    : { x: p.ball.pos2.x, y: plan.spotY };
  const launch = kickLaunch(dist, hang, heading, 0.3);

  if (p.ball.carrierIdx !== null) {
    const holder = p.players[p.ball.carrierIdx];
    if (holder !== undefined) holder.hasBall = false;
  }
  p.ball.pos2 = { x: from.x, y: from.y };
  p.ball.z = 0.3;
  p.ball.vel = { x: launch.vel.x, y: launch.vel.y };
  p.ball.vz = launch.vz;
  p.ball.mode = plan.style === 'punt' ? 'punt' : 'kick';
  p.ball.carrierIdx = null;
  p.ball.targetIdx = null;
  p.ball.lastTouchTeam = e.playOffense;
  if (kicker !== undefined) kicker.anim = 'kicking';

  plan.launched = true;
  km.active = false;
  e.kickUntouched = true;
  events.push({
    type: 'KICK_LAUNCHED', tick: s.tick, style: plan.style,
    kickerIdx: plan.kickerIdx, power01: power, accuracy01: acc,
  });
}

function updateKick(s: GameState, p: PlayState, events: SimEvent[]): void {
  const e = ext(s);
  const plan = e.kick;
  if (plan === null || plan.launched) return;
  const km = p.kickMeter;
  if (plan.auto) {
    while (plan.pressesDone < 3 && s.tick >= (plan.pressTicks[plan.pressesDone] as number)) {
      pressKickMeter(s, events);
      plan.pressesDone += 1;
    }
  } else if (km.startTick < 0 && s.tick - (plan.pressTicks[0] as number) >= USER_METER_START_GRACE) {
    // A user meter that is never started would never expire either (forceExpiry
    // measures from startTick), so the play would hang. Start it for them.
    pressKickMeter(s, events);
  }
  forceExpiry(km, s.tick);
  launchKick(s, p, events);
}

interface CatchCandidate {
  idx: number;
  score: number;
  offense: boolean;
  cth: number;
}

function catchCandidates(s: GameState, p: PlayState): CatchCandidate[] {
  const e = ext(s);
  const out: CatchCandidate[] = [];
  if (p.ball.z > PASS.jumpCatchZ) return out;
  // The thrower can never catch his own forward pass, and the ball needs a
  // couple of ticks of air before anyone can be credited with a reception.
  if (s.tick - e.throwTick < PLAY_TIMING.minAirTicks) return out;
  for (let i = 0; i < p.players.length; i++) {
    if (i === e.lastPasserIdx) continue;
    const pl = p.players[i];
    if (pl === undefined || pl.anim === 'down') continue;
    const d = Math.hypot(pl.pos2.x - p.ball.pos2.x, pl.pos2.y - p.ball.pos2.y);
    if (d > PASS.catchRadiusYd) continue;
    const offense = pl.team === e.playOffense;
    let cth = pl.ratings.cth;
    if (!offense) cth = Math.min(cth, Math.max(pl.ratings.zcv, pl.ratings.mcv));
    const toBallX = p.ball.pos2.x - pl.pos2.x;
    const toBallY = p.ball.pos2.y - pl.pos2.y;
    const len = Math.hypot(toBallX, toBallY);
    const facing = len < 1e-6
      ? true
      : (toBallX / len) * Math.cos(pl.facing) + (toBallY / len) * Math.sin(pl.facing) > 0;
    let score = cth + PASS.candDistWeight * (1 - d / PASS.catchRadiusYd);
    score += facing ? PASS.candFacingBonus : PASS.candFacingPenalty;
    if (p.ball.targetIdx === i) score += PASS.candIntendedBonus;
    out.push({ idx: i, score, offense, cth });
  }
  return out;
}

function completeCatch(s: GameState, p: PlayState, idx: number, contested: boolean, events: SimEvent[]): void {
  const e = ext(s);
  const pl = p.players[idx];
  if (pl === undefined) return;
  // A pitch is a handoff by air, not a reception.
  const wasPitch = p.ball.mode === 'pitch';
  pl.hasBall = true;
  pl.anim = 'catching';
  p.ball.carrierIdx = idx;
  p.ball.mode = 'held';
  p.ball.lastTouchTeam = pl.team;
  e.lastCarrierIdx = idx;
  e.kickUntouched = false;
  const o = e.outcome;
  if (pl.team === e.playOffense) {
    e.completed = true;
    if (o !== null) {
      o.completed = true;
      o.carrierIdx = idx;
      o.targetIdx = idx;
      o.passerIdx = e.lastPasserIdx >= 0 ? e.lastPasserIdx : o.passerIdx;
    }
    if (wasPitch) events.push({ type: 'HANDOFF', tick: s.tick, carrierIdx: idx });
    else events.push({ type: 'CATCH', tick: s.tick, receiverIdx: idx, contested });
  } else {
    if (o !== null) {
      o.turnover = 'int';
      o.possessionAfter = pl.team;
      o.changeOfPossession = true;
      o.carrierIdx = idx;
      o.passerIdx = e.lastPasserIdx >= 0 ? e.lastPasserIdx : o.passerIdx;
    }
    events.push({ type: 'INTERCEPTION', tick: s.tick, defenderIdx: idx });
  }
}

function markIncomplete(s: GameState, p: PlayState, events: SimEvent[]): void {
  const e = ext(s);
  const o = e.outcome;
  if (o !== null) {
    o.spotY = p.lineOfScrimmageY;
    o.spotX = e.ballOnX;
    o.targetIdx = e.lastTargetIdx >= 0 ? e.lastTargetIdx : null;
    o.passerIdx = e.lastPasserIdx >= 0 ? e.lastPasserIdx : null;
  }
  e.spotFixed = true;
  p.ball.mode = 'dead';
  p.deadReason = 'incomplete';
  events.push({
    type: 'INCOMPLETE', tick: s.tick,
    targetIdx: e.lastTargetIdx >= 0 ? e.lastTargetIdx : null,
    throwaway: e.throwaway,
  });
}

function resolvePassArrival(s: GameState, p: PlayState, rng: RngSet, events: SimEvent[]): void {
  const cands = catchCandidates(s, p);
  if (cands.length === 0) return;
  let bestOff: CatchCandidate | null = null;
  let bestDef: CatchCandidate | null = null;
  for (const c of cands) {
    if (c.offense) {
      if (bestOff === null || c.score > bestOff.score) bestOff = c;
    } else if (bestDef === null || c.score > bestDef.score) bestDef = c;
  }

  const contested = bestOff !== null && bestDef !== null;
  const winner = !contested
    ? (bestOff ?? bestDef)
    : ((bestOff as CatchCandidate).score >= (bestDef as CatchCandidate).score ? bestOff : bestDef);
  if (winner === null) return;

  if (!contested) {
    let pCatch = Math.min(
      PASS.uncontestedCatchMax,
      PASS.uncontestedCatchBase + winner.cth * PASS.uncontestedCatchPerCth,
    );
    // A defender alone under the ball still mostly knocks it down.
    if (!winner.offense) pCatch *= PASS.defenderCatchMult;
    if (rng.physics.chance(pCatch)) completeCatch(s, p, winner.idx, false, events);
    else {
      if (winner.offense) events.push({ type: 'DROP', tick: s.tick, receiverIdx: winner.idx });
      markIncomplete(s, p, events);
    }
    return;
  }

  const loser = winner === bestOff ? bestDef : bestOff;
  const diff = winner.score - (loser === null ? 0 : loser.score);
  // A defender who is only playing the ball (not attacking it) swats it away.
  const winnerPlayer = p.players[winner.idx];
  if (
    !winner.offense && winnerPlayer !== undefined && winnerPlayer.mind['cvPlayBall'] === 2
  ) {
    markIncomplete(s, p, events);
    return;
  }
  // A defender who wins the contest is far more likely to break it up than
  // to come down with it, however cleanly he won the spot.
  if (!winner.offense) {
    if (rng.physics.chance(PASS.defenderContestedIntP)) {
      completeCatch(s, p, winner.idx, true, events);
    } else {
      markIncomplete(s, p, events);
    }
    return;
  }
  if (diff > PASS.contestedCleanMargin) {
    completeCatch(s, p, winner.idx, true, events);
    return;
  }
  const roll = rng.physics.next();
  if (roll < PASS.contestedCatchP) {
    completeCatch(s, p, winner.idx, true, events);
  } else if (roll < PASS.contestedCatchP + PASS.contestedSwatP) {
    markIncomplete(s, p, events);
  } else {
    events.push({ type: 'DROP', tick: s.tick, receiverIdx: winner.idx });
    markIncomplete(s, p, events);
  }
}

function resolveKickReception(s: GameState, p: PlayState, events: SimEvent[]): void {
  const e = ext(s);
  const receiving = otherTeam(e.playOffense);
  if (p.ball.z > PASS.catchMaxZ) return;
  for (let i = 0; i < p.players.length; i++) {
    const pl = p.players[i];
    if (pl === undefined || pl.team !== receiving || pl.anim === 'down') continue;
    const d = Math.hypot(pl.pos2.x - p.ball.pos2.x, pl.pos2.y - p.ball.pos2.y);
    if (d > PASS.catchRadiusYd) continue;
    e.kickUntouched = false;
    const o = e.outcome;
    const recvDir = s.attackDir[receiving];
    const inEndZone = (p.ball.pos2.y - ownGoalY(recvDir)) * recvDir < 0;
    const kneeling = e.returnKneel || pl.mind['stReturnDecision'] === 2;
    if (inEndZone && kneeling) {
      const style = e.kick !== null && e.kick.style === 'kickoff' ? 'kickoff' : 'punt';
      if (o !== null) {
        o.spotY = touchbackSpot(style, recvDir);
        o.spotX = CENTER_X;
        o.possessionAfter = receiving;
        o.changeOfPossession = true;
        o.carrierIdx = i;
      }
      e.spotFixed = true;
      p.ball.mode = 'dead';
      p.deadReason = 'touchback';
      events.push({ type: 'TOUCHBACK', tick: s.tick, team: receiving });
      return;
    }
    if (e.fairCatchCalled) {
      if (o !== null) {
        o.spotY = p.ball.pos2.y;
        o.spotX = p.ball.pos2.x;
        o.possessionAfter = receiving;
        o.changeOfPossession = true;
        o.carrierIdx = i;
      }
      e.spotFixed = true;
      p.ball.mode = 'dead';
      p.deadReason = 'fairCatch';
      return;
    }
    pl.hasBall = true;
    p.ball.carrierIdx = i;
    p.ball.mode = 'held';
    p.ball.lastTouchTeam = receiving;
    e.lastCarrierIdx = i;
    if (o !== null) {
      o.possessionAfter = receiving;
      o.changeOfPossession = true;
      o.carrierIdx = i;
    }
    return;
  }
}

function resolveLooseBall(s: GameState, p: PlayState, events: SimEvent[]): void {
  const e = ext(s);
  if (p.ball.z > 1.4) return;
  for (let i = 0; i < p.players.length; i++) {
    const pl = p.players[i];
    if (pl === undefined || pl.anim === 'down') continue;
    const d = Math.hypot(pl.pos2.x - p.ball.pos2.x, pl.pos2.y - p.ball.pos2.y);
    if (d > TACKLE.looseBallRecoverRangeYd) continue;
    pl.hasBall = true;
    p.ball.carrierIdx = i;
    p.ball.mode = 'held';
    p.ball.lastTouchTeam = pl.team;
    e.lastCarrierIdx = i;
    e.kickUntouched = false;
    const o = e.outcome;
    if (o !== null) {
      o.possessionAfter = pl.team;
      o.changeOfPossession = pl.team !== e.playOffense;
      if (pl.team !== e.playOffense && o.turnover === null) o.turnover = 'fumble';
      o.carrierIdx = i;
    }
    events.push({ type: 'FUMBLE_RECOVERED', tick: s.tick, recovererIdx: i, team: pl.team });
    // The defense always falls on it.
    if (pl.team !== e.playOffense) {
      if (o !== null) { o.spotY = p.ball.pos2.y; o.spotX = p.ball.pos2.x; }
      e.spotFixed = true;
      p.deadReason = 'fumbleDead';
    }
    return;
  }
}

function resolveFieldGoal(
  s: GameState,
  p: PlayState,
  prev: Vec2,
  prevZ: number,
  events: SimEvent[],
): boolean {
  const e = ext(s);
  const plan = e.kick;
  const o = e.outcome;
  if (plan === null || plan.style !== 'placekick' || o === null) return false;
  const dir = s.attackDir[e.playOffense];
  const plane = attackEndLineY(dir);
  const crossed = (prev.y - plane) * dir < 0 && (p.ball.pos2.y - plane) * dir >= 0;
  const grounded = p.ball.z <= 0 && prevZ > 0;

  if (!crossed && !grounded) return false;

  let good = false;
  let missSide: 'left' | 'right' | 'short' | null = 'short';
  if (crossed) {
    const t = Math.abs(plane - prev.y) / Math.max(1e-6, Math.abs(p.ball.pos2.y - prev.y));
    const x = prev.x + (p.ball.pos2.x - prev.x) * t;
    const z = prevZ + (p.ball.z - prevZ) * t;
    if (z >= CROSSBAR_HEIGHT) {
      if (Math.abs(x - CENTER_X) <= GOALPOST_HALF_WIDTH) { good = true; missSide = null; }
      else missSide = x < CENTER_X ? 'left' : 'right';
    } else {
      missSide = 'short';
    }
  }

  const isXp = p.offensePlay.type === 'extraPoint';
  if (isXp) {
    events.push({ type: 'XP_RESULT', tick: s.tick, team: e.playOffense, good });
    o.scoreKind = good ? 'xp' : null;
    o.points = good ? 1 : 0;
  } else {
    events.push({
      type: 'FIELD_GOAL_RESULT', tick: s.tick, team: e.playOffense, good,
      distanceYds: plan.fgDistance, missSide,
    });
    o.scoreKind = good ? 'fg' : null;
    o.points = good ? 3 : 0;
  }
  o.fgDistance = plan.fgDistance;
  o.deadReason = 'kickResolved';
  if (!good && !isXp) {
    // Opponent takes over at the spot of the kick, or their own 20.
    const opp = otherTeam(e.playOffense);
    o.spotY = missedFieldGoalSpot(plan.spotY, s.attackDir[opp]);
    o.possessionAfter = opp;
    o.changeOfPossession = true;
  } else {
    o.spotY = p.ball.pos2.y;
  }
  o.spotX = CENTER_X;
  e.spotFixed = true;
  p.ball.mode = 'dead';
  p.deadReason = 'kickResolved';
  return true;
}

function resolveUntouchedKick(s: GameState, p: PlayState, atRest: boolean): void {
  const e = ext(s);
  const plan = e.kick;
  const o = e.outcome;
  if (plan === null || o === null || !e.kickUntouched) return;
  if (plan.style === 'placekick') return;

  const receiving = otherTeam(e.playOffense);
  const recvDir = s.attackDir[receiving];
  const recvGoal = ownGoalY(recvDir);
  const inEndZone = (p.ball.pos2.y - recvGoal) * recvDir < 0;

  if (inEndZone) {
    o.spotY = touchbackSpot(plan.style === 'kickoff' ? 'kickoff' : 'punt', recvDir);
    o.spotX = CENTER_X;
    o.possessionAfter = receiving;
    o.changeOfPossession = true;
    o.deadReason = 'touchback';
    e.spotFixed = true;
    p.ball.mode = 'dead';
    p.deadReason = 'touchback';
    return;
  }

  if (isOutOfBoundsX(p.ball.pos2.x)) {
    o.spotY = plan.style === 'kickoff' ? ownYardLineY(40, recvDir) : p.ball.pos2.y;
    o.spotX = CENTER_X;
    o.possessionAfter = receiving;
    o.changeOfPossession = true;
    o.deadReason = 'kickResolved';
    e.spotFixed = true;
    p.ball.mode = 'dead';
    p.deadReason = 'kickResolved';
    return;
  }

  if (atRest) {
    o.spotY = p.ball.pos2.y;
    o.spotX = p.ball.pos2.x;
    o.possessionAfter = receiving;
    o.changeOfPossession = true;
    o.deadReason = 'kickResolved';
    e.spotFixed = true;
    p.ball.mode = 'dead';
    p.deadReason = 'kickResolved';
  }
}

function isHeld(ball: { mode: string }): boolean {
  return ball.mode === 'held';
}

function updateBall(s: GameState, p: PlayState, rng: RngSet, events: SimEvent[]): void {
  const e = ext(s);
  const ball = p.ball;

  if (ball.mode === 'held') {
    const c = ball.carrierIdx === null ? undefined : p.players[ball.carrierIdx];
    if (c !== undefined) carryBall(ball, c.pos2, c.facing);
    return;
  }
  if (ball.mode === 'dead') return;

  const prev: Vec2 = { x: ball.pos2.x, y: ball.pos2.y };
  const prevZ = ball.z;
  const bounce = ball.mode !== 'pass';
  const res = stepBall(ball, bounce);

  if (ball.mode === 'kick' || ball.mode === 'punt') {
    if (resolveFieldGoal(s, p, prev, prevZ, events)) return;
    resolveKickReception(s, p, events);
    if (p.deadReason !== null || isHeld(ball)) return;
    resolveUntouchedKick(s, p, res.atRest);
    return;
  }

  if (ball.mode === 'pass') {
    resolvePassArrival(s, p, rng, events);
    if (p.deadReason !== null || isHeld(ball)) return;
    if (res.landed) markIncomplete(s, p, events);
    return;
  }

  if (ball.mode === 'pitch') {
    resolvePassArrival(s, p, rng, events);
    if (p.deadReason !== null || isHeld(ball)) return;
    if (res.landed) ball.mode = 'loose';
    return;
  }

  if (ball.mode === 'loose') {
    resolveLooseBall(s, p, events);
    if (p.deadReason !== null || isHeld(ball)) return;
    if (res.atRest) {
      const o = e.outcome;
      if (o !== null) { o.spotY = ball.pos2.y; o.spotX = ball.pos2.x; }
      e.spotFixed = true;
      p.deadReason = 'fumbleDead';
    }
  }
}

function checkCarrierBoundaries(s: GameState, p: PlayState, events: SimEvent[]): void {
  const e = ext(s);
  const o = e.outcome;
  const idx = p.ball.carrierIdx;
  if (idx === null || o === null) return;
  const c = p.players[idx];
  if (c === undefined) return;
  const cdir = s.attackDir[c.team];

  if ((c.pos2.y - attackGoalY(cdir)) * cdir >= 0) {
    const twoPoint = p.offensePlay.type === 'twoPoint';
    o.carrierIdx = idx;
    o.possessionAfter = c.team;
    o.changeOfPossession = c.team !== e.playOffense;
    o.spotY = attackGoalY(cdir);
    o.spotX = c.pos2.x;
    e.spotFixed = true;
    p.deadReason = 'touchdown';
    if (twoPoint) {
      // A conversion is not a touchdown, however it looks on the field.
      o.scoreKind = 'two';
      o.points = 2;
      events.push({ type: 'TWO_POINT_RESULT', tick: s.tick, team: c.team, good: true });
    } else {
      o.touchdown = true;
      o.scoreKind = 'td';
      o.points = 6;
      events.push({ type: 'TOUCHDOWN', tick: s.tick, team: c.team, scorerIdx: idx });
    }
    return;
  }

  if (isOutOfBoundsX(c.pos2.x)) {
    o.carrierIdx = idx;
    o.possessionAfter = c.team;
    o.changeOfPossession = c.team !== e.playOffense;
    o.spotY = bestProgressY(e.progress, cdir, c.pos2.y);
    o.spotX = c.pos2.x;
    e.spotFixed = true;
    p.deadReason = 'outOfBounds';
    events.push({ type: 'OUT_OF_BOUNDS', tick: s.tick, carrierIdx: idx });
  }
}

function trackProgress(s: GameState, p: PlayState): void {
  const e = ext(s);
  const idx = p.ball.carrierIdx;
  if (idx === null) return;
  const c = p.players[idx];
  if (c === undefined) return;
  // A new carrier starts his own progress window (an interception return must
  // not inherit the passing team's samples).
  if (e.progressCarrier !== idx) {
    e.progressCarrier = idx;
    e.progress = [];
    e.progressCount = 0;
  }
  const cdir = s.attackDir[c.team];
  e.progress[e.progressCount % FORWARD_PROGRESS_WINDOW_TICKS] = c.pos2.y;
  e.progressCount += 1;
  p.progressY = bestProgressY(e.progress, cdir, c.pos2.y);
}

function safetyWhistle(s: GameState, p: PlayState, events: SimEvent[]): void {
  const e = ext(s);
  const o = e.outcome;
  if (o === null) return;
  const dir = s.attackDir[e.playOffense];

  if (p.ball.mode === 'pass') {
    markIncomplete(s, p, events);
    return;
  }
  const idx = p.ball.carrierIdx;
  if (idx === null) {
    o.spotY = p.lineOfScrimmageY;
    o.spotX = e.ballOnX;
    e.spotFixed = true;
    p.deadReason = 'incomplete';
    return;
  }
  const c = p.players[idx];
  if (c === undefined) return;
  const cdir = s.attackDir[c.team];
  const isDropback = o.playType === 'pass' && c.role === 'QB' && c.team === e.playOffense;
  if (isDropback && (c.pos2.y - p.lineOfScrimmageY) * dir <= 0) {
    // The quarterback never got rid of it: spot at the line, coverage sack.
    o.playType = 'sack';
    o.spotY = p.lineOfScrimmageY;
    o.spotX = e.ballOnX;
    o.carrierIdx = idx;
    e.spotFixed = true;
    p.deadReason = 'sack';
    return;
  }
  o.carrierIdx = idx;
  o.possessionAfter = c.team;
  o.changeOfPossession = c.team !== e.playOffense;
  o.spotY = bestProgressY(e.progress, cdir, c.pos2.y);
  o.spotX = c.pos2.x;
  e.spotFixed = true;
  p.deadReason = 'runnerDown';
}

function finishPlay(s: GameState, p: PlayState, events: SimEvent[]): void {
  const e = ext(s);
  const o = e.outcome ?? defaultOutcome(s, p);
  e.outcome = o;
  const offense = e.playOffense;
  const dir = s.attackDir[offense];
  const reason: DeadReason = p.deadReason ?? 'tackle';
  o.deadReason = reason;

  if (!e.spotFixed) {
    const idx = p.ball.carrierIdx ?? (e.lastCarrierIdx >= 0 ? e.lastCarrierIdx : null);
    const c = idx === null ? undefined : p.players[idx];
    if (c !== undefined) {
      const cdir = s.attackDir[c.team];
      o.carrierIdx = idx;
      o.possessionAfter = c.team;
      o.changeOfPossession = c.team !== offense;
      o.spotY = bestProgressY(e.progress, cdir, c.pos2.y);
      o.spotX = c.pos2.x;
    } else {
      o.spotY = p.lineOfScrimmageY;
      o.spotX = e.ballOnX;
    }
  }
  if (o.tacklerIdx === null) o.tacklerIdx = e.deadTacklerIdx;
  if (o.passerIdx === null && e.lastPasserIdx >= 0) o.passerIdx = e.lastPasserIdx;
  if (o.targetIdx === null && e.lastTargetIdx >= 0) o.targetIdx = e.lastTargetIdx;
  if (reason === 'sack' && o.playType === 'pass') o.playType = 'sack';

  // End-zone bookkeeping: own-impetus = safety, kick/turnover = touchback.
  const possDir = s.attackDir[o.possessionAfter];
  const behindOwnGoal = (o.spotY - ownGoalY(possDir)) * possDir < 0;
  if (!o.touchdown && behindOwnGoal) {
    if (o.changeOfPossession || o.playType === 'punt' || o.playType === 'kickoff') {
      const yd = o.playType === 'kickoff' ? TOUCHBACK_KICKOFF_YD : TOUCHBACK_OTHER_YD;
      o.spotY = ownYardLineY(yd, possDir);
      o.deadReason = 'touchback';
      events.push({ type: 'TOUCHBACK', tick: s.tick, team: o.possessionAfter });
    } else {
      o.safety = true;
      o.scoreKind = 'safety';
      o.points = 2;
      o.spotY = ownGoalY(possDir);
      events.push({ type: 'SAFETY', tick: s.tick, scoringTeam: otherTeam(o.possessionAfter) });
    }
  }

  o.spotY = clampFieldY(o.spotY);
  if (o.spotY < 10) o.spotY = 10;
  if (o.spotY > 110) o.spotY = 110;

  // Net yardage for the offense.
  if (o.playType === 'punt' || o.playType === 'kickoff') {
    o.yards = Math.abs(o.spotY - p.lineOfScrimmageY);
  } else if (o.changeOfPossession) {
    o.yards = 0;
  } else {
    o.yards = (o.spotY - p.lineOfScrimmageY) * dir;
  }

  p.resultSpotY = o.spotY;
  p.ball.mode = 'dead';
  events.push({ type: 'WHISTLE', tick: s.tick, reason: o.deadReason });
  setPhase(s, GamePhase.PLAY_DEAD);
}

export function playLivePhase(
  s: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  const p = s.play;
  if (p === null) {
    setPhase(s, GamePhase.PLAY_CALL);
    return;
  }
  const e = ext(s);
  if (e.outcome === null) e.outcome = defaultOutcome(s, p);
  const startLen = events.length;

  tickClock(s, events);
  decayTimers(p);
  handleUserInput(s, p, input, rng, events);
  if (p.deadReason === null) updateLiveAI(s, input, rng, events);
  if (p.deadReason === null) advanceMesh(s, p, events);
  if (p.deadReason === null) handleKneelSpike(s, p, events);
  if (p.deadReason === null) updateKick(s, p, events);
  if (p.deadReason === null) updateBall(s, p, rng, events);
  if (p.deadReason === null) separateTeammates(p);
  if (p.deadReason === null) checkCarrierBoundaries(s, p, events);
  trackProgress(s, p);

  if (p.deadReason === null && e.dragUntilTick >= 0 && s.tick >= e.dragUntilTick) {
    const o = e.outcome;
    const idx = p.ball.carrierIdx;
    const c = idx === null ? undefined : p.players[idx];
    if (o !== null && c !== undefined) {
      c.anim = 'down';
      c.engagedWith = null;
      o.carrierIdx = idx;
      o.tacklerIdx = e.deadTacklerIdx;
    }
    p.deadReason = isDropbackSack(s, p, c) ? 'sack' : 'tackle';
  }
  if (p.deadReason === null) {
    const idx = p.ball.carrierIdx;
    const c = idx === null ? undefined : p.players[idx];
    const diveUntil = c === undefined ? undefined : c.mind['diveUntil'];
    if (c !== undefined && diveUntil !== undefined && s.tick >= diveUntil) {
      c.anim = 'down';
      p.deadReason = 'runnerDown';
    }
  }

  if (p.deadReason === null && s.tick >= e.whistleTick) safetyWhistle(s, p, events);

  if (p.deadReason !== null) finishPlay(s, p, events);

  for (let i = startLen; i < events.length; i++) {
    const ev = events[i];
    if (ev !== undefined) e.playEvents.push(ev);
  }
}
