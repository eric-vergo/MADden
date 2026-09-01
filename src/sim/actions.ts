// ★ Action contract between AI (S8) and sim core (S1).
// S8's brains DECIDE (who to throw to, when to attempt a tackle); these
// functions RESOLVE (formulas, ball state, dead-ball marking, penalties).
// S1 owns this file and implements the bodies; signatures are frozen.
// The same functions serve user input handling in the PLAY_LIVE phase.

import type { GameState, PenaltyFlag, PlayState, SimPlayer, Vec2 } from './types';
import type { SimEvent } from './events';
import type { Rng } from './rng';
import { MOVES, PASS, PENALTY, PLAY_TIMING, QB_AI, TACKLE } from '../data/balance';
import { ext } from './rules/ext';
import { bulletLaunch, lobLaunch, RELEASE_Z } from './physics/ballFlight';
import { closingSpeed, isFromBehind } from './physics/collisions';
import { press as pressMeter } from './rules/kickMeter';

export type CarrierMove = 'juke' | 'spin' | 'stiffArm' | 'truck' | 'dive' | 'slide';

function live(state: GameState): PlayState | null {
  const p = state.play;
  if (p === null || p.deadReason !== null) return null;
  return p;
}

function at(p: PlayState, idx: number): SimPlayer | null {
  if (idx < 0) return null;
  return p.players[idx] ?? null;
}

function pressure01(p: PlayState, passer: SimPlayer): number {
  for (let i = 0; i < p.players.length; i++) {
    const d = p.players[i];
    if (d === undefined || d.team === passer.team || d.anim === 'down') continue;
    if (Math.hypot(d.pos2.x - passer.pos2.x, d.pos2.y - passer.pos2.y) <= QB_AI.pressureRadiusYd) {
      return 1;
    }
  }
  return 0;
}

/** Accuracy scatter sigma (yards) for a throw. */
export function throwSigma(
  passer: SimPlayer,
  airDist: number,
  press01: number,
  bullet: boolean,
): number {
  let sigma = (PASS.accuracySigmaBase + PASS.accuracySigmaPerThaDeficit * (1 - passer.ratings.tha / 99))
    * (1 + airDist / PASS.accuracyAirDistDivisor);
  sigma += PASS.accuracyPressurePenalty * press01;
  if (Math.hypot(passer.vel.x, passer.vel.y) > PASS.onRunSpeedThreshold) {
    sigma += PASS.accuracyOnRunPenalty;
  }
  if (!bullet) sigma *= PASS.lobSigmaMult;
  return sigma;
}

/**
 * Launch a pass from passerIdx toward targetIdx (lead computed inside).
 * bullet=false → lob. Emits PASS_THROWN; sets ball mode 'pass'.
 */
export function throwPass(
  state: GameState,
  passerIdx: number,
  targetIdx: number,
  opts: { bullet: boolean; leadErrorSigmaYd?: number },
  rng: Rng,
  events: SimEvent[],
): void {
  const p = live(state);
  if (p === null) return;
  const passer = at(p, passerIdx);
  const target = at(p, targetIdx);
  if (passer === null || target === null) return;
  if (!passer.hasBall || p.ball.carrierIdx !== passerIdx) return;

  const dir = state.attackDir[passer.team];
  // Crossing the LOS cancels the ability to throw forward.
  if ((passer.pos2.y - p.lineOfScrimmageY) * dir > 0.5) return;

  // Lead the receiver: two fixed-point iterations on the flight time.
  let aim: Vec2 = { x: target.pos2.x, y: target.pos2.y };
  for (let k = 0; k < 2; k++) {
    const launch = opts.bullet
      ? bulletLaunch(passer.pos2, aim, RELEASE_Z, passer.ratings.thp)
      : lobLaunch(passer.pos2, aim, RELEASE_Z, passer.ratings.thp);
    aim = {
      x: target.pos2.x + target.vel.x * launch.timeSec,
      y: target.pos2.y + target.vel.y * launch.timeSec,
    };
  }

  const airDist = Math.hypot(aim.x - passer.pos2.x, aim.y - passer.pos2.y);
  const sigma = throwSigma(passer, airDist, pressure01(p, passer), opts.bullet);
  const leadSigma = opts.leadErrorSigmaYd ?? 0;
  aim = {
    x: aim.x + rng.gauss() * sigma + rng.gauss() * leadSigma,
    y: aim.y + rng.gauss() * sigma + rng.gauss() * leadSigma,
  };

  const launch = opts.bullet
    ? bulletLaunch(passer.pos2, aim, RELEASE_Z, passer.ratings.thp)
    : lobLaunch(passer.pos2, aim, RELEASE_Z, passer.ratings.thp);

  const e = ext(state);
  passer.hasBall = false;
  passer.anim = 'throwing';
  p.ball.pos2 = { x: passer.pos2.x, y: passer.pos2.y };
  p.ball.z = RELEASE_Z;
  p.ball.vel = { x: launch.vel.x, y: launch.vel.y };
  p.ball.vz = launch.vz;
  p.ball.mode = 'pass';
  p.ball.carrierIdx = null;
  p.ball.targetIdx = targetIdx;
  p.ball.lastTouchTeam = passer.team;

  e.lastPasserIdx = passerIdx;
  e.lastTargetIdx = targetIdx;
  e.throwTick = state.tick;
  e.throwaway = false;
  e.passLanding = { x: aim.x, y: aim.y };
  e.passAirYds = (aim.y - p.lineOfScrimmageY) * dir;
  e.passResolved = false;
  e.tipUsed = false;

  events.push({
    type: 'PASS_THROWN', tick: state.tick, passerIdx, targetIdx,
    bullet: opts.bullet, airYds: e.passAirYds,
  });

  // Rushers in the release window can tip the ball.
  if (!e.tipUsed) {
    for (let i = 0; i < p.players.length; i++) {
      const d = p.players[i];
      if (d === undefined || d.team === passer.team) continue;
      const dist = Math.hypot(d.pos2.x - passer.pos2.x, d.pos2.y - passer.pos2.y);
      if (dist <= PASS.tipRangeYd && rng.chance(PASS.tipChance)) {
        const cone = rng.range(-0.9, 0.9);
        const speed = Math.hypot(p.ball.vel.x, p.ball.vel.y) * 0.55;
        const head = Math.atan2(p.ball.vel.y, p.ball.vel.x) + cone;
        p.ball.vel = { x: Math.cos(head) * speed, y: Math.sin(head) * speed };
        p.ball.vz = Math.abs(p.ball.vz) * 0.5 + 2;
        e.tipUsed = true;
        events.push({ type: 'PASS_TIPPED', tick: state.tick, byIdx: i });
        break;
      }
    }
  }
}

/** Throw the ball away out of bounds (legality checked inside). */
export function throwAway(
  state: GameState,
  passerIdx: number,
  rng: Rng,
  events: SimEvent[],
): void {
  const p = live(state);
  if (p === null) return;
  const passer = at(p, passerIdx);
  if (passer === null || !passer.hasBall) return;
  const e = ext(state);
  // [SIMPLE-BY-CHOICE] legal only outside the tackle box; no grounding foul.
  if (Math.abs(passer.pos2.x - e.ballOnX) <= PLAY_TIMING.tackleBoxHalfWidthYd) return;

  const dir = state.attackDir[passer.team];
  const toLeft = passer.pos2.x < e.ballOnX;
  const aim: Vec2 = {
    x: toLeft ? -4 : 57,
    y: passer.pos2.y + 6 * dir + rng.range(-1, 1),
  };
  const launch = bulletLaunch(passer.pos2, aim, RELEASE_Z, passer.ratings.thp);

  passer.hasBall = false;
  passer.anim = 'throwing';
  p.ball.pos2 = { x: passer.pos2.x, y: passer.pos2.y };
  p.ball.z = RELEASE_Z;
  p.ball.vel = { x: launch.vel.x, y: launch.vel.y };
  p.ball.vz = launch.vz;
  p.ball.mode = 'pass';
  p.ball.carrierIdx = null;
  p.ball.targetIdx = null;
  p.ball.lastTouchTeam = passer.team;

  e.lastPasserIdx = passerIdx;
  e.lastTargetIdx = -1;
  e.throwTick = state.tick;
  e.throwaway = true;
  e.passLanding = { x: aim.x, y: aim.y };
  e.passAirYds = 0;
  e.passResolved = false;

  events.push({
    type: 'PASS_THROWN', tick: state.tick, passerIdx, targetIdx: passerIdx,
    bullet: true, airYds: 0,
  });
}

function fumbleMultiplier(carrier: SimPlayer, tackler: SimPlayer, bigHit: boolean, sack: boolean): number {
  let mult = 1;
  if (bigHit) mult *= TACKLE.fumbleBigHitMult;
  if (sack) mult *= TACKLE.fumbleSackMult;
  if (carrier.mind['truckUntil'] !== undefined && carrier.mind['truckUntil'] > 0) {
    mult *= TACKLE.fumbleTruckMult;
  }
  const ratingMult = 1 + (tackler.ratings.hpw - carrier.ratings.car) / TACKLE.fumbleRatingScale;
  mult *= Math.max(TACKLE.fumbleMultMin, Math.min(TACKLE.fumbleMultMax, ratingMult));
  return mult;
}

function activeMoveBonus(carrier: SimPlayer, tick: number): number {
  const until = carrier.mind['moveUntil'];
  return until !== undefined && until > tick ? TACKLE.activeMoveBonus : 0;
}

/**
 * Attempt a tackle on the current carrier. Resolves BIG-HIT / WRAP / BROKEN,
 * fumbles, and dead-ball marking per the tackling model.
 */
export function attemptTackle(
  state: GameState,
  tacklerIdx: number,
  opts: { hitStick?: boolean },
  rng: Rng,
  events: SimEvent[],
): void {
  const p = live(state);
  if (p === null) return;
  const tackler = at(p, tacklerIdx);
  const carrierIdx = p.ball.carrierIdx;
  if (tackler === null || carrierIdx === null) return;
  const carrier = at(p, carrierIdx);
  if (carrier === null || carrier.team === tackler.team) return;
  if (tackler.anim === 'down' || tackler.stateTimer > 0) return;

  const dist = Math.hypot(tackler.pos2.x - carrier.pos2.x, tackler.pos2.y - carrier.pos2.y);
  const behind = isFromBehind(tackler, carrier);
  const range = behind ? TACKLE.behindRangeYd : TACKLE.attemptRangeYd;
  if (dist > range) {
    if (opts.hitStick === true) tackler.stateTimer = TACKLE.hitStickWhiffTicks;
    return;
  }

  events.push({ type: 'TACKLE_ATTEMPT', tick: state.tick, tacklerIdx, carrierIdx });

  const closing = closingSpeed(tackler, carrier);
  const momentum = Math.max(
    -TACKLE.momentumClamp,
    Math.min(TACKLE.momentumClamp, closing * (TACKLE.momentumScale / 8)),
  );
  const angle = behind ? TACKLE.angleBonusBehind : TACKLE.angleBonusHeadOn;
  const hitStick = opts.hitStick === true ? TACKLE.hitStickBonus : 0;

  const tackleScore = tackler.ratings.tak + TACKLE.hpwWeight * tackler.ratings.hpw
    + momentum + angle + hitStick + rng.gauss() * TACKLE.noiseSigma;
  const breakScore = carrier.ratings.btk + TACKLE.btkStrWeight * carrier.ratings.str
    + activeMoveBonus(carrier, state.tick) + rng.gauss() * TACKLE.noiseSigma;

  const e = ext(state);
  const margin = tackleScore - breakScore;

  if (margin <= 0) {
    tackler.stateTimer = TACKLE.brokenStumbleTicks;
    tackler.anim = 'stumbling';
    carrier.vel.x *= 0.8;
    carrier.vel.y *= 0.8;
    const moveName = carrier.mind['moveUntil'] !== undefined && carrier.mind['moveUntil'] > state.tick
      ? String(carrier.mind['moveKind'] ?? '')
      : null;
    events.push({
      type: 'TACKLE_BROKEN', tick: state.tick, tacklerIdx, carrierIdx,
      move: moveName === '' ? null : moveName,
    });
    return;
  }

  const bigHit = margin > TACKLE.bigHitMargin || opts.hitStick === true;
  const dir = state.attackDir[e.playOffense];
  const isSack = carrier.team === e.playOffense && carrier.role === 'QB'
    && (carrier.pos2.y - p.lineOfScrimmageY) * dir < 0
    && (p.offensePlay.type === 'pass' || p.offensePlay.type === 'playAction'
      || p.offensePlay.type === 'screen' || p.offensePlay.type === 'twoPoint');

  // Fumble roll on any successful tackle.
  const fumbleP = TACKLE.fumbleBase * fumbleMultiplier(carrier, tackler, bigHit, isSack);
  const sliding = carrier.anim === 'diving' || p.offensePlay.type === 'kneel';
  if (!sliding && rng.chance(fumbleP)) {
    carrier.hasBall = false;
    p.ball.carrierIdx = null;
    p.ball.mode = 'loose';
    p.ball.z = 0.6;
    p.ball.vz = 2.2;
    const spin = rng.range(-Math.PI, Math.PI);
    p.ball.vel = { x: Math.cos(spin) * 4, y: Math.sin(spin) * 4 };
    e.lastCarrierIdx = carrierIdx;
    events.push({ type: 'FUMBLE', tick: state.tick, carrierIdx, forcedByIdx: tacklerIdx });
    return;
  }

  let assist: number | null = null;
  for (let i = 0; i < p.players.length; i++) {
    const h = p.players[i];
    if (h === undefined || i === tacklerIdx || h.team === carrier.team) continue;
    if (Math.hypot(h.pos2.x - carrier.pos2.x, h.pos2.y - carrier.pos2.y) <= TACKLE.attemptRangeYd * 1.5) {
      assist = i;
      break;
    }
  }

  e.deadTacklerIdx = tacklerIdx;
  e.deadBigHit = bigHit;
  e.lastCarrierIdx = carrierIdx;

  if (bigHit || assist !== null) {
    carrier.anim = 'down';
    carrier.vel.x = 0;
    carrier.vel.y = 0;
    p.deadReason = isSack ? 'sack' : 'tackle';
    events.push({
      type: 'TACKLE', tick: state.tick, tacklerIdx, carrierIdx, bigHit, assistIdx: assist,
    });
    if (isSack) {
      const yards = (carrier.pos2.y - p.lineOfScrimmageY) * dir;
      events.push({ type: 'SACK', tick: state.tick, tacklerIdx, qbIdx: carrierIdx, yards });
    }
    return;
  }

  // Wrap: the runner is dragged for a moment, progress still accrues.
  carrier.anim = 'dragged';
  carrier.engagedWith = tacklerIdx;
  tackler.engagedWith = carrierIdx;
  e.dragUntilTick = state.tick + TACKLE.wrapDragTicks;
  events.push({
    type: 'TACKLE', tick: state.tick, tacklerIdx, carrierIdx, bigHit: false, assistIdx: null,
  });
  if (isSack) {
    const yards = (carrier.pos2.y - p.lineOfScrimmageY) * dir;
    events.push({ type: 'SACK', tick: state.tick, tacklerIdx, qbIdx: carrierIdx, yards });
  }
}

/** Carrier special move (window/cooldown bookkeeping inside). */
export function tryCarrierMove(
  state: GameState,
  carrierIdx: number,
  move: CarrierMove,
  rng: Rng,
  events: SimEvent[],
): void {
  void rng; void events;
  const p = live(state);
  if (p === null) return;
  const c = at(p, carrierIdx);
  if (c === null || !c.hasBall) return;
  const cooldownUntil = c.mind['moveCooldownUntil'] ?? 0;
  if (state.tick < cooldownUntil) return;

  const e = ext(state);
  switch (move) {
    case 'juke':
      c.mind['moveUntil'] = state.tick + MOVES.juke.windowTicks;
      c.mind['moveCooldownUntil'] = state.tick + MOVES.juke.cooldownTicks;
      c.vel.x *= MOVES.juke.speedKeep;
      c.vel.y *= MOVES.juke.speedKeep;
      break;
    case 'spin':
      c.mind['moveUntil'] = state.tick + MOVES.spin.windowTicks;
      c.mind['moveCooldownUntil'] = state.tick + MOVES.spin.cooldownTicks;
      c.vel.x *= MOVES.spin.speedKeep;
      c.vel.y *= MOVES.spin.speedKeep;
      break;
    case 'stiffArm':
      c.mind['moveUntil'] = state.tick + MOVES.stiffArm.windowTicks;
      c.mind['moveCooldownUntil'] = state.tick + MOVES.stiffArm.cooldownTicks;
      break;
    case 'truck':
      c.mind['moveUntil'] = state.tick + MOVES.truck.cooldownTicks / 2;
      c.mind['moveCooldownUntil'] = state.tick + MOVES.truck.cooldownTicks;
      c.mind['truckUntil'] = state.tick + MOVES.truck.cooldownTicks / 2;
      break;
    case 'dive': {
      const speed = Math.hypot(c.vel.x, c.vel.y);
      if (speed > 0.1) {
        const k = (speed + MOVES.diveLungeYd) / speed;
        c.vel.x *= k;
        c.vel.y *= k;
      }
      c.anim = 'diving';
      c.mind['diveUntil'] = state.tick + PLAY_TIMING.diveTicks;
      break;
    }
    case 'slide':
      c.anim = 'down';
      c.vel.x = 0;
      c.vel.y = 0;
      p.deadReason = 'runnerDown';
      e.lastCarrierIdx = carrierIdx;
      break;
    default:
      break;
  }
  c.mind['moveKind'] = move === 'juke' ? 1 : move === 'spin' ? 2 : move === 'stiffArm' ? 3 : 4;
}

/** Register a kick-meter press (start → power lock → accuracy lock + kick). */
export function pressKickMeter(state: GameState, events: SimEvent[]): void {
  void events;
  const p = state.play;
  if (p === null || !p.kickMeter.active) return;
  pressMeter(p.kickMeter, state.tick);
}

/** Returner calls a fair catch on a punt/kick in the air. */
export function callFairCatch(
  state: GameState,
  returnerIdx: number,
  events: SimEvent[],
): void {
  const p = live(state);
  if (p === null) return;
  if (p.ball.mode !== 'kick' && p.ball.mode !== 'punt') return;
  const e = ext(state);
  if (e.fairCatchCalled) return;
  e.fairCatchCalled = true;
  events.push({ type: 'FAIR_CATCH', tick: state.tick, returnerIdx });
}

/**
 * Penalty hook for the blocking system (S8): call when a blocker loses a shed
 * contest by worse than PENALTY.holdingBadShedMargin yet re-engages within
 * PENALTY.holdingReengageTicks — may add a holding flag to the play.
 */
export function maybeHoldingOnShed(
  state: GameState,
  blockerIdx: number,
  shedMargin: number,
  rng: Rng,
  events: SimEvent[],
): void {
  const p = live(state);
  if (p === null) return;
  if (!state.config.penaltiesEnabled) return;
  if (p.flags.length > 0) return; // at most one flag per play
  if (shedMargin > PENALTY.holdingBadShedMargin) return;
  const blocker = at(p, blockerIdx);
  if (blocker === null) return;
  if (!rng.chance(PENALTY.holdingOnBadShed * PENALTY.frequency)) return;

  const flag: PenaltyFlag = {
    kind: 'holding',
    team: blocker.team,
    playerIdx: blockerIdx,
    spotY: blocker.pos2.y,
    preSnap: false,
  };
  p.flags.push(flag);
  events.push({ type: 'FLAG', tick: state.tick, flag });
}
