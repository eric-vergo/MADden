// PRE_SNAP: settle at alignment, pre-snap fouls, then the snap.

import {
  GameAction, GamePhase, type GameState, type PenaltyFlag, type RoleId, type TeamSide,
} from '../types';
import type { SimEvent, TickInput } from '../events';
import type { RngSet } from '../rng';
import { PENALTY, DIFFICULTY, KICK, PLAY_TIMING } from '../../data/balance';
import { cpuShouldCallTimeout, updatePreSnapAI } from '../ai/index';
import { ext, setPhase, type KickPlan } from '../rules/ext';
import { tickClock, tickPlayClock, useTimeout } from '../rules/clock';
import { enforceDeadBallFoul, endQuarterNow } from './common';
import { findRole } from '../roster';
import { otherTeam } from '../rules/downs';
import { attackEndLineY } from '../transform';
import { tickForAccuracy, tickForPower } from '../rules/kickMeter';
import { defaultOutcome } from './outcome';

const OL_ROLES: readonly RoleId[] = ['LT', 'LG', 'C', 'RG', 'RT'];

function isKickPlay(type: string): boolean {
  return type === 'kickoff' || type === 'punt' || type === 'fieldGoal' || type === 'extraPoint';
}

function kickStyleOf(type: string): 'kickoff' | 'punt' | 'placekick' | null {
  if (type === 'kickoff') return 'kickoff';
  if (type === 'punt') return 'punt';
  if (type === 'fieldGoal' || type === 'extraPoint') return 'placekick';
  return null;
}

/** Ticks a play may run before the safety whistle ends it. */
export const LIVE_MAX_TICKS = PLAY_TIMING.liveMaxTicks;
export const LIVE_MAX_TICKS_KICK = PLAY_TIMING.liveMaxTicksKick;

function planCpuKick(
  s: GameState,
  style: 'kickoff' | 'punt' | 'placekick',
  kickerIdx: number,
  spotY: number,
  fgDistance: number,
  rng: RngSet,
): KickPlan {
  const p = s.play;
  const kicker = p === null ? undefined : p.players[kickerIdx];
  const kpw = kicker === undefined ? 75 : kicker.ratings.kpw;
  const dir = s.attackDir[s.possession];

  let target = 1;
  if (style === 'punt') {
    const toGoal = Math.abs(attackEndLineY(dir) - spotY) - 10;
    const maxDist = KICK.puntDistBase + KICK.puntDistPerPower * (kpw / 99);
    target = Math.max(0.35, Math.min(1, (toGoal - 8) / Math.max(1, maxDist)));
  } else if (style === 'placekick') {
    const maxRange = KICK.fgMaxRangeBase + KICK.fgMaxRangePerKpw * (kpw / 99);
    target = Math.max(0.25, Math.min(1, (fgDistance + KICK.fgAimPastPostsYd) / Math.max(1, maxRange)));
  }

  const sigma = DIFFICULTY[s.config.difficulty].cpuKickErrorSigma;
  const start = s.tick + PLAY_TIMING.meterPrepTicks[style];
  const powerTick = Math.max(
    start + 1,
    tickForPower(start, target) + Math.round(rng.misc.gauss() * sigma * KICK.meterFillTicks),
  );
  const accTick = Math.max(
    powerTick + 1,
    tickForAccuracy(powerTick, 0) + Math.round(rng.misc.gauss() * sigma * KICK.meterSweepTicks),
  );
  return {
    style, kickerIdx,
    pressTicks: [start, powerTick, accTick],
    pressesDone: 0,
    launched: false,
    spotY,
    fgDistance,
    auto: true,
  };
}

function doSnap(s: GameState, rng: RngSet, events: SimEvent[]): void {
  const p = s.play;
  if (p === null) return;
  const e = ext(s);
  const offense = e.playOffense;
  const dir = s.attackDir[offense];
  const type = p.offensePlay.type;

  p.snapTick = s.tick;
  e.outcome = defaultOutcome(s, p);

  const style = kickStyleOf(type);
  let holderIdx = -1;
  if (style === 'placekick') {
    holderIdx = findRole(p, 'H');
    if (holderIdx < 0) holderIdx = findRole(p, 'QB');
  }

  let ballIdx = findRole(p, 'QB');
  if (style === 'kickoff') ballIdx = findRole(p, 'K');
  else if (style === 'punt') ballIdx = findRole(p, 'P');
  else if (style === 'placekick') ballIdx = holderIdx;
  if (ballIdx < 0) ballIdx = 0;

  const holder = p.players[ballIdx];
  if (holder !== undefined) {
    holder.hasBall = true;
    p.ball.carrierIdx = ballIdx;
    p.ball.mode = 'held';
    p.ball.pos2 = { x: holder.pos2.x, y: holder.pos2.y };
    p.ball.z = 1.1;
    p.ball.lastTouchTeam = holder.team;
    e.lastCarrierIdx = ballIdx;
  }

  if (style !== null) {
    let kickerIdx = findRole(p, style === 'punt' ? 'P' : 'K');
    if (kickerIdx < 0) kickerIdx = ballIdx;
    const kicker = p.players[kickerIdx];
    const spotY = holder !== undefined ? holder.pos2.y : p.lineOfScrimmageY;
    const fgDistance = style === 'placekick' ? Math.abs(attackEndLineY(dir) - spotY) : 0;
    e.kick = planCpuKick(s, style, kickerIdx, spotY, fgDistance, rng);
    e.kick.auto = p.controlledIdx !== kickerIdx;
    p.kickMeter.active = true;
    p.kickMeter.startTick = -1;
    p.kickMeter.powerLockTick = null;
    p.kickMeter.accuracyLockTick = null;
    p.kickMeter.aimOffset = 0;
    if (e.outcome !== null) e.outcome.fgDistance = fgDistance;
    void kicker;
  }

  // Clock restarts on the snap unless this is a kickoff or a try.
  if (e.startClockOnSnap && style !== 'kickoff' && s.nextPlayKind !== 'pat') {
    s.clockRunning = true;
    e.startClockOnSnap = false;
  }

  if (s.quarter >= 5 && type !== 'kickoff') s.otPossessions[offense] = true;

  e.whistleTick = s.tick + (isKickPlay(type) ? LIVE_MAX_TICKS_KICK : LIVE_MAX_TICKS);
  events.push({ type: 'SNAP', tick: s.tick });
  setPhase(s, GamePhase.PLAY_LIVE);
}

export function preSnapPhase(
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
  const offense = e.playOffense;
  const defense = otherTeam(offense);
  const elapsed = s.tick - e.phaseEnteredTick;

  for (const c of input.commands) {
    if (c.type === 'TIMEOUT') useTimeout(s, c.team, events);
    // Pre-snap defender switching (PLAY_LIVE handles it once the ball is snapped).
    if (c.type === 'SWITCH_CONTROLLED' && c.playerIdx >= 0 && c.playerIdx < p.players.length) {
      p.controlledIdx = c.playerIdx;
      events.push({ type: 'CONTROL_CHANGED', tick: s.tick, controlledIdx: c.playerIdx });
    }
  }

  const tmBefore: [boolean, boolean] = [s.twoMinuteFired[0], s.twoMinuteFired[1]];
  tickClock(s, events);
  if (s.twoMinuteFired[0] !== tmBefore[0] || s.twoMinuteFired[1] !== tmBefore[1]) {
    // The warning is a dead-ball stoppage: nobody snaps on that tick, and the
    // offense gets the full reset play clock to get back to the line.
    e.phaseEnteredTick = s.tick;
    return;
  }
  if (e.quarterExpired && s.nextPlayKind !== 'pat') {
    endQuarterNow(s, events);
    return;
  }

  updatePreSnapAI(s, input, rng, events);

  if (tickPlayClock(s, events)) {
    const flag: PenaltyFlag = {
      kind: 'delayOfGame', team: offense, playerIdx: null, spotY: s.ballOnY, preSnap: true,
    };
    enforceDeadBallFoul(s, flag, events);
    return;
  }

  // User pre-snap movement with a lineman selected is a false start.
  const userTeam = s.config.userTeam;
  if (
    s.config.penaltiesEnabled && userTeam === offense && p.controlledIdx >= 0 &&
    Math.hypot(input.frame.move.x, input.frame.move.y) > 0.25
  ) {
    const ctrl = p.players[p.controlledIdx];
    if (ctrl !== undefined && OL_ROLES.includes(ctrl.role)) {
      const flag: PenaltyFlag = {
        kind: 'falseStart', team: offense, playerIdx: p.controlledIdx,
        spotY: s.ballOnY, preSnap: true,
      };
      enforceDeadBallFoul(s, flag, events);
      return;
    }
  }

  // The CPU coach publishes its snap timing through the quarterback's mind.
  const qbIdx = findRole(p, 'QB');
  const qb = qbIdx >= 0 ? p.players[qbIdx] : undefined;
  const aiSnapAt = qb === undefined ? -1 : (qb.mind['qbSnapPlayClock'] ?? -1);
  const snapAt = aiSnapAt >= 0 ? Math.min(aiSnapAt, s.playClockSec) : e.snapAtPlayClock;

  if (userTeam !== defense && cpuShouldCallTimeout(s, defense)) {
    useTimeout(s, defense, events);
  }

  let snapNow = false;
  if (elapsed >= PLAY_TIMING.settleTicks) {
    if (userTeam === offense) {
      snapNow = input.frame.pressed.has(GameAction.Snap);
    } else {
      snapNow = s.playClockSec <= snapAt;
    }
  }
  if (!snapNow) return;

  // Organic pre-snap fouls, rolled once at the snap.
  if (s.config.penaltiesEnabled && PENALTY.frequency > 0) {
    if (rng.penalties.chance(PENALTY.cpuFalseStartPerSnap * PENALTY.frequency) && userTeam !== offense) {
      const idx = findRole(p, 'LG');
      const flag: PenaltyFlag = {
        kind: 'falseStart', team: offense, playerIdx: idx < 0 ? null : idx,
        spotY: s.ballOnY, preSnap: true,
      };
      enforceDeadBallFoul(s, flag, events);
      return;
    }
    if (rng.penalties.chance(PENALTY.cpuOffsidePerSnap * PENALTY.frequency) && userTeam !== defense) {
      const idx = findRole(p, 'LE');
      const flag: PenaltyFlag = {
        kind: 'encroachment', team: defense, playerIdx: idx < 0 ? null : idx,
        spotY: s.ballOnY, preSnap: true,
      };
      enforceDeadBallFoul(s, flag, events);
      return;
    }
  }

  doSnap(s, rng, events);
  void (offense as TeamSide);
}
