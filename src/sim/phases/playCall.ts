// PLAY_CALL: play clock runs, both sides choose, then the 22 are placed at
// their alignments and the sim moves to PRE_SNAP.

import { GamePhase, type GameState, type PenaltyFlag, type RoleId, type TeamSide } from '../types';
import type { SimEvent, TickInput } from '../events';
import type { RngSet } from '../rng';
import { allOffensivePlays, getDefensivePlay, getOffensivePlay } from '../../data/plays/index';
import { cpuCallPlay } from '../ai/index';
import { buildPlayState, findRole } from '../roster';
import { ballSpot } from '../transform';
import { lineToGainY, otherTeam } from '../rules/downs';
import { ext, resetPlayScratch, setPhase } from '../rules/ext';
import { resetPlayClock, tickClock, tickPlayClock, useTimeout } from '../rules/clock';
import { currentLineToGain } from '../rules/penalties';
import { enforceDeadBallFoul, endQuarterNow } from './common';
import { PLAY_TIMING } from '../../data/balance';

/** Ticks the CPU "thinks" before sending its call in. */
const CPU_CALL_MIN_TICKS = PLAY_TIMING.cpuCallMinTicks;
const CPU_CALL_JITTER_TICKS = PLAY_TIMING.cpuCallJitterTicks;

/**
 * Play-clock reading at which a user on defense who still has not called gets
 * one sent in from the sideline. It is deliberately not a balance knob: the
 * point is only that the offense's play clock never expires on the defense's
 * indecision.
 */
const AUTO_DEFENSE_CALL_PLAY_CLOCK_SEC = 5;

function firstOffensivePlayOfType(type: string): string | null {
  const plays = allOffensivePlays();
  for (const p of plays) {
    if (p.type === type) return p.id;
  }
  return null;
}

function fallbackOffenseId(s: GameState): string {
  const kind = s.nextPlayKind;
  if (kind === 'kickoff' || kind === 'freeKick') {
    const id = firstOffensivePlayOfType('kickoff');
    if (id !== null) return id;
  }
  if (kind === 'pat') {
    const id = firstOffensivePlayOfType(ext(s).patTwo ? 'twoPoint' : 'extraPoint');
    if (id !== null) return id;
  }
  const plays = allOffensivePlays();
  return plays[0]?.id ?? '';
}

function chooseControlled(s: GameState, offense: TeamSide, play: ReturnType<typeof buildPlayState>): number {
  const user = s.config.userTeam;
  if (user === null) return -1;
  if (user === offense) {
    // On a kick the user works the meter, so hand them the kicker/punter.
    const type = play.offensePlay.type;
    if (type === 'punt') {
      const p = findRole(play, 'P');
      if (p >= 0) return p;
    } else if (type === 'kickoff' || type === 'fieldGoal' || type === 'extraPoint') {
      const k = findRole(play, 'K');
      if (k >= 0) return k;
    }
    const qb = findRole(play, 'QB');
    if (qb >= 0) return qb;
    for (let i = 0; i < 11; i++) if (play.players[i] !== undefined) return i;
    return -1;
  }
  // Receiving a kick, the user fields the ball — he is not a wedge blocker
  // watching the AI return it. Both return units also carry an MLB1, so the
  // returner has to be taken before any role preference is consulted.
  const type = play.offensePlay.type;
  if (type === 'kickoff' || type === 'punt') {
    for (let i = 11; i < play.players.length; i++) {
      if (play.players[i]?.assignment.kind === 'returner') return i;
    }
  }
  const preferred: RoleId[] = type === 'kickoff'
    ? ['KR', 'PR', 'MLB1', 'LOLB', 'ROLB', 'SS', 'FS', 'LE']
    : type === 'punt'
      ? ['PR', 'KR', 'MLB1', 'LOLB', 'ROLB', 'SS', 'FS', 'LE']
      : ['MLB1', 'LOLB', 'ROLB', 'SS', 'FS', 'LE', 'PR', 'KR'];
  for (const r of preferred) {
    const i = findRole(play, r);
    if (i >= 11) return i;
  }
  return 11;
}

export function playCallPhase(
  s: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  const e = ext(s);
  const offense = s.possession;
  const defense = otherTeam(offense);

  if (e.phaseInit === false) {
    e.phaseInit = true;
    s.play = null;
    s.selectedOffensePlayId = null;
    s.selectedDefensePlayId = null;
    e.cpuOffenseCallTick = s.tick + CPU_CALL_MIN_TICKS + rng.misc.int(0, CPU_CALL_JITTER_TICKS);
    e.cpuDefenseCallTick = s.tick + CPU_CALL_MIN_TICKS + rng.misc.int(0, CPU_CALL_JITTER_TICKS);
  }

  for (const c of input.commands) {
    if (c.type === 'SELECT_PLAY') {
      if (c.side === 'offense' && c.team === offense) s.selectedOffensePlayId = c.playId;
      if (c.side === 'defense' && c.team === defense) s.selectedDefensePlayId = c.playId;
    } else if (c.type === 'TIMEOUT') {
      useTimeout(s, c.team, events);
    }
  }

  tickClock(s, events);
  // A quarter never expires with a try still to be played.
  if (e.quarterExpired && s.nextPlayKind !== 'pat') {
    endQuarterNow(s, events);
    return;
  }

  const userTeam = s.config.userTeam;
  if (s.selectedOffensePlayId === null && userTeam !== offense && s.tick >= e.cpuOffenseCallTick) {
    if (s.nextPlayKind === 'pat' && e.patTwo) {
      s.selectedOffensePlayId = firstOffensivePlayOfType('twoPoint') ?? fallbackOffenseId(s);
    } else {
      s.selectedOffensePlayId = cpuCallPlay(s, offense, 'offense', rng.ai);
    }
  }
  if (s.selectedDefensePlayId === null && userTeam !== defense && s.tick >= e.cpuDefenseCallTick) {
    s.selectedDefensePlayId = cpuCallPlay(s, defense, 'defense', rng.ai);
  }
  // The play clock belongs to the OFFENSE. A user on defense who dawdles in the
  // play-book must never put the offense in delay of game, so his coordinator
  // sends a call in for him once the clock gets short.
  if (
    s.selectedDefensePlayId === null && userTeam === defense &&
    s.playClockSec <= AUTO_DEFENSE_CALL_PLAY_CLOCK_SEC
  ) {
    s.selectedDefensePlayId = cpuCallPlay(s, defense, 'defense', rng.ai);
  }

  if (tickPlayClock(s, events)) {
    if (s.selectedOffensePlayId === null) {
      const flag: PenaltyFlag = {
        kind: 'delayOfGame', team: offense, playerIdx: null, spotY: s.ballOnY, preSnap: true,
      };
      enforceDeadBallFoul(s, flag, events);
      return;
    }
    if (s.selectedDefensePlayId === null) {
      // Belt and braces (the auto-call above should have fired): pick for the
      // defense and give the offense its clock back rather than flag anybody.
      s.selectedDefensePlayId = cpuCallPlay(s, defense, 'defense', rng.ai);
      resetPlayClock(s, true);
    }
  }

  if (s.selectedOffensePlayId === null || s.selectedDefensePlayId === null) return;

  const offPlay = getOffensivePlay(s.selectedOffensePlayId)
    ?? getOffensivePlay(fallbackOffenseId(s));
  const defPlays = getDefensivePlay(s.selectedDefensePlayId);
  if (offPlay === undefined) return;
  const defPlay = defPlays ?? getDefensivePlay(s.selectedDefensePlayId ?? '');
  if (defPlay === undefined) return;

  const dir = s.attackDir[offense];
  const spot = ballSpot(e.ballOnX, s.ballOnY);
  e.ballOnX = spot.x;
  const play = buildPlayState(s, offPlay, defPlay, {
    offense,
    dir,
    spot,
    firstDownY: lineToGainY(s.ballOnY, s.toGo, dir),
    controlledIdx: -1,
  });
  play.controlledIdx = chooseControlled(s, offense, play);
  s.play = play;

  resetPlayScratch(s);
  e.playOffense = offense;
  e.prePlay = {
    down: s.down,
    toGo: s.toGo,
    ballOnY: s.ballOnY,
    possession: offense,
    quarter: s.quarter,
    clockSec: s.clockSec,
    lineToGainY: currentLineToGain(s),
  };
  // Fallback snap window when the coach publishes no target of its own.
  e.snapAtPlayClock = Math.min(
    s.playClockSec - 0.2,
    rng.misc.range(PLAY_TIMING.fallbackSnapPlayClockMin, PLAY_TIMING.fallbackSnapPlayClockMax),
  );
  if (e.snapAtPlayClock < 0) e.snapAtPlayClock = 0;

  events.push({
    type: 'PLAYS_SELECTED', tick: s.tick,
    offensePlayId: offPlay.id, defensePlayId: defPlay.id,
  });
  if (play.controlledIdx >= 0) {
    events.push({ type: 'CONTROL_CHANGED', tick: s.tick, controlledIdx: play.controlledIdx });
  }
  setPhase(s, GamePhase.PRE_SNAP);
}
