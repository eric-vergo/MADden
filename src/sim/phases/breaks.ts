// POINT_AFTER_CHOICE, PENALTY_DECISION, QUARTER_BREAK, HALFTIME,
// OVERTIME_TOSS and GAME_OVER.

import { GamePhase, type GameState, type TeamSide } from '../types';
import type { SimEvent, TickInput } from '../events';
import type { RngSet } from '../rng';
import { PLAY_CLOCK_SHORT_SEC } from '../constants';
import { ext, takeEntry } from '../rules/ext';
import { otherTeam } from '../rules/downs';
import { setupKickoff, setupPat, shouldGoForTwo } from '../rules/scoring';
import { chooseByEV } from '../rules/penalties';
import {
  AUTO_CONTINUE_TICKS, beginPlayCall, resetHalfTimeouts, startNextQuarter,
  startOvertimePeriod, swapEnds,
} from './common';
import { finalizePenalty, routeAfterDead } from './playDead';

function sawContinue(input: TickInput): boolean {
  for (const c of input.commands) if (c.type === 'CONTINUE') return true;
  return false;
}

function readyToContinue(s: GameState, input: TickInput): boolean {
  if (sawContinue(input)) return true;
  if (s.config.userTeam !== null) return false;
  const e = ext(s);
  e.autoContinueTicks += 1;
  return e.autoContinueTicks >= AUTO_CONTINUE_TICKS;
}

export function pointAfterPhase(
  s: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  void rng; void events;
  const scoring = s.possession;
  const opponent = otherTeam(scoring);
  let choice: 'xp' | 'two' | null = null;

  if (s.config.userTeam !== null && s.config.userTeam === scoring) {
    for (const c of input.commands) if (c.type === 'CHOOSE_PAT') choice = c.choice;
  } else {
    const diff = s.score[scoring] - s.score[opponent];
    choice = shouldGoForTwo(diff, s.quarter) ? 'two' : 'xp';
  }
  if (choice === null) return;

  setupPat(s, scoring, choice === 'two');
  s.playClockSec = PLAY_CLOCK_SHORT_SEC;
  beginPlayCall(s);
}

export function penaltyDecisionPhase(
  s: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  void rng;
  const e = ext(s);
  const decision = s.pendingPenalty;
  if (decision === null) {
    routeAfterDead(s, events);
    return;
  }
  let choice: 'accept' | 'decline' | null = null;
  for (const c of input.commands) {
    if (c.type === 'ACCEPT_PENALTY') choice = 'accept';
    else if (c.type === 'DECLINE_PENALTY') choice = 'decline';
  }
  // Safety valve so an unanswered prompt can never stall the game.
  e.autoContinueTicks += 1;
  if (choice === null && e.autoContinueTicks >= 60 * 30) choice = chooseByEV(s, decision);
  if (choice === null) return;

  finalizePenalty(s, choice, events);
  routeAfterDead(s, events);
}

export function quarterBreakPhase(
  s: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  void rng; void events;
  takeEntry(s);
  if (!readyToContinue(s, input)) return;
  startNextQuarter(s);
}

export function halftimePhase(
  s: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  void rng; void events;
  takeEntry(s);
  if (!readyToContinue(s, input)) return;

  s.quarter = 3;
  s.clockSec = s.config.quarterLengthSec;
  s.clockRunning = false;
  resetHalfTimeouts(s);
  swapEnds(s);

  // The team that received to open the game kicks off to start the second half.
  const kicking: TeamSide = s.coin?.receivingFirstHalf ?? 0;
  setupKickoff(s, kicking);
  s.playClockSec = PLAY_CLOCK_SHORT_SEC;
  beginPlayCall(s);
}

export function overtimeTossPhase(
  s: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  if (takeEntry(s)) {
    const winner: TeamSide = rng.misc.chance(0.5) ? 0 : 1;
    s.coin = { winner, receivingFirstHalf: s.coin?.receivingFirstHalf ?? null, overtime: true };
  }
  const coin = s.coin;
  if (coin === null || coin.winner === null) return;

  let choice: 'receive' | 'kick' | null = null;
  if (s.config.userTeam !== null && s.config.userTeam === coin.winner) {
    for (const c of input.commands) {
      if (c.type === 'COIN_TOSS_CHOICE' && c.team === coin.winner) choice = c.choice;
    }
  } else {
    choice = 'receive';
  }
  if (choice === null) return;

  const receiving: TeamSide = choice === 'receive' ? coin.winner : otherTeam(coin.winner);
  startOvertimePeriod(s);
  setupKickoff(s, otherTeam(receiving));
  s.playClockSec = PLAY_CLOCK_SHORT_SEC;
  events.push({ type: 'OVERTIME_START', tick: s.tick });
  events.push({
    type: 'COIN_TOSS_RESULT', tick: s.tick, winner: coin.winner, receiving, overtime: true,
  });
  beginPlayCall(s);
}

export function gameOverPhase(
  s: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  void s; void input; void rng; void events;
  // Terminal — GameSim.tick() never dispatches here.
  void GamePhase;
}
