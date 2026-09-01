// PLAY_DEAD: spot the ball, resolve penalties, apply downs / scoring / clock,
// emit PLAY_RESULT, fold the box score, then route to whatever comes next.

import {
  GamePhase,
  type GameState, type PenaltyFlag, type PenaltyOutcome, type PlayLogEntry, type TeamSide,
} from '../types';
import type { SimEvent, TickInput } from '../events';
import type { RngSet } from '../rng';
import { ext, takeEntry, type PlayOutcome } from '../rules/ext';
import {
  clockAfterPlay, fireTwoMinute, resetPlayClock,
} from '../rules/clock';
import {
  describeState, freshToGo, isFirstDown, otherTeam, teamAbbrevs,
} from '../rules/downs';
import {
  addPoints, overtimeDecided, setFirstAndTen, setSeries, setupKickoff,
} from '../rules/scoring';
import {
  buildDecision, chooseByEV, PENALTY_LABEL,
} from '../rules/penalties';
import { accumulatePlay, recordFirstDown, recordPenalty, recordThirdDown } from '../stats';
import { snapToHash } from '../transform';
import { beginPlayCall, endGame, endQuarterNow } from './common';

/** Presentation pause between the whistle and the next snap. */
const DEAD_PAUSE_TICKS = 90; // TODO(balance)

/** Gain (yards) that counts as a big play for the replay trigger. */
const BIG_GAIN_YARDS = 20; // TODO(balance)

function isPatPlay(s: GameState): boolean {
  const t = s.play?.offensePlay.type;
  return t === 'extraPoint' || t === 'twoPoint';
}

function isScrimmagePlay(o: PlayOutcome): boolean {
  return o.playType === 'run' || o.playType === 'pass'
    || o.playType === 'sack' || o.playType === 'scramble';
}

interface SeriesResult {
  firstDown: boolean;
  turnoverOnDowns: boolean;
}

function applySeries(s: GameState, o: PlayOutcome): SeriesResult {
  const e = ext(s);
  const spot = o.spotY;
  if (o.changeOfPossession) {
    setFirstAndTen(s, o.possessionAfter, spot);
    return { firstDown: false, turnoverOnDowns: false };
  }
  const dir = s.attackDir[o.possessionAfter];
  const lineY = e.prePlay.lineToGainY;
  if (isFirstDown(spot, lineY, dir)) {
    setFirstAndTen(s, o.possessionAfter, spot);
    return { firstDown: true, turnoverOnDowns: false };
  }
  const nextDown = e.prePlay.down + 1;
  if (nextDown > 4) {
    setFirstAndTen(s, otherTeam(o.possessionAfter), spot);
    return { firstDown: false, turnoverOnDowns: true };
  }
  setSeries(s, o.possessionAfter, spot, nextDown, Math.max(1, (lineY - spot) * dir));
  return { firstDown: false, turnoverOnDowns: false };
}

function applyPenaltyOutcome(s: GameState, out: PenaltyOutcome, patPlay: boolean): void {
  if (patPlay) {
    // A penalty on a try re-runs the try from the enforced spot; it never
    // turns the conversion into a first down.
    setSeries(s, ext(s).playOffense, out.ballOnY, 1, 10);
    s.nextPlayKind = 'pat';
    return;
  }
  setSeries(s, out.possession, out.ballOnY, out.down, out.toGo);
  s.nextPlayKind = 'normal';
}

function logPlay(s: GameState, o: PlayOutcome, text: string): void {
  const e = ext(s);
  const entry: PlayLogEntry = {
    tick: s.tick,
    quarter: e.prePlay.quarter,
    clockSec: e.prePlay.clockSec,
    down: e.prePlay.down,
    toGo: e.prePlay.toGo,
    ballOnY: e.prePlay.ballOnY,
    possession: e.prePlay.possession,
    offensePlayId: s.play?.offensePlay.id ?? '',
    defensePlayId: s.play?.defensePlay.id ?? '',
    text,
    yards: o.yards,
    scoring: o.points > 0,
    turnover: o.turnover !== null,
  };
  s.playLog.push(entry);
}

function emitBigPlays(s: GameState, o: PlayOutcome, events: SimEvent[]): void {
  if (o.touchdown) {
    events.push({ type: 'BIG_PLAY', tick: s.tick, reason: o.changeOfPossession ? 'returnTd' : 'touchdown' });
  } else if (o.turnover === 'int' || o.turnover === 'fumble') {
    events.push({ type: 'BIG_PLAY', tick: s.tick, reason: 'turnover' });
  } else if (o.playType === 'sack') {
    events.push({ type: 'BIG_PLAY', tick: s.tick, reason: 'sack' });
  } else if (o.yards >= BIG_GAIN_YARDS && isScrimmagePlay(o)) {
    events.push({ type: 'BIG_PLAY', tick: s.tick, reason: 'longGain' });
  }
}

function applyOutcome(s: GameState, o: PlayOutcome, events: SimEvent[]): void {
  const e = ext(s);
  const p = s.play;
  if (p === null) return;
  const offense = e.playOffense;
  const patPlay = isPatPlay(s);

  o.spotX = snapToHash(o.spotX);
  e.ballOnX = o.spotX;

  let firstDown = false;
  let turnoverOnDowns = false;

  if (o.scoreKind === 'td') {
    addPoints(s, o.possessionAfter, 6);
    s.possession = o.possessionAfter;
    s.nextPlayKind = 'pat';
    e.afterDead = GamePhase.POINT_AFTER_CHOICE;
  } else if (o.scoreKind === 'safety') {
    const scorer = otherTeam(o.possessionAfter);
    addPoints(s, scorer, 2);
    setupKickoff(s, o.possessionAfter, true);
  } else if (o.scoreKind === 'fg') {
    addPoints(s, offense, 3);
    setupKickoff(s, offense);
  } else if (o.scoreKind === 'xp') {
    addPoints(s, offense, 1);
    setupKickoff(s, offense);
  } else if (o.scoreKind === 'two') {
    addPoints(s, offense, 2);
    setupKickoff(s, offense);
  } else if (patPlay) {
    if (p.offensePlay.type === 'twoPoint') {
      events.push({ type: 'TWO_POINT_RESULT', tick: s.tick, team: offense, good: false });
    }
    setupKickoff(s, offense);
  } else {
    const r = applySeries(s, o);
    firstDown = r.firstDown;
    turnoverOnDowns = r.turnoverOnDowns;
    s.nextPlayKind = 'normal';
  }

  if (firstDown) {
    recordFirstDown(s, o.possessionAfter);
    events.push({ type: 'FIRST_DOWN', tick: s.tick, team: o.possessionAfter });
  }
  if (turnoverOnDowns) {
    o.turnover = 'downs';
    events.push({ type: 'TURNOVER_ON_DOWNS', tick: s.tick, team: offense });
  }
  if (isScrimmagePlay(o) && e.prePlay.down === 3) {
    recordThirdDown(s, offense, firstDown);
  }

  accumulatePlay(s, p, e.playEvents, o, offense);

  const [home, away] = teamAbbrevs(s);
  const text = `${describeState(e.prePlay.down, e.prePlay.toGo, e.prePlay.ballOnY, s.attackDir[offense], home, away)}: ${o.playType} for ${Math.round(o.yards)}`;

  events.push({
    type: 'PLAY_RESULT', tick: s.tick, offense,
    playType: o.playType, yards: o.yards,
    carrierIdx: o.carrierIdx, passerIdx: o.passerIdx, targetIdx: o.targetIdx,
    tacklerIdx: o.tacklerIdx, touchdown: o.touchdown, turnover: o.turnover,
    deadReason: o.deadReason,
  });
  emitBigPlays(s, o, events);
  logPlay(s, o, text);

  // Clock rules.
  const ruling = clockAfterPlay(s, o);
  if (ruling.stop) {
    s.clockRunning = false;
    e.startClockOnSnap = true;
  }
  resetPlayClock(s, ruling.admin);
  if (e.pendingTwoMinute) fireTwoMinute(s, events);

  if (overtimeDecided(s, o.scoreKind)) {
    e.afterDead = GamePhase.GAME_OVER;
    events.push({ type: 'BIG_PLAY', tick: s.tick, reason: 'gameWinner' });
  }
}

function resolveDeadBall(s: GameState, rng: RngSet, events: SimEvent[]): void {
  const e = ext(s);
  const p = s.play;
  const o = e.outcome;
  if (p === null || o === null) return;
  e.afterDead = GamePhase.PLAY_CALL;

  let flag: PenaltyFlag | null = null;
  if (s.config.penaltiesEnabled) {
    for (const f of p.flags) {
      if (!f.preSnap) { flag = f; break; }
    }
  }
  // [SIMPLE-BY-CHOICE] flags on scoring plays are declined.
  if (flag !== null && o.points === 0) {
    const decision = buildDecision(s, flag, o);
    s.pendingPenalty = decision;
    if (s.config.userTeam !== null && s.config.userTeam === decision.decidingTeam) {
      e.afterDead = GamePhase.PENALTY_DECISION;
      return;
    }
    const choice = chooseByEV(s, decision);
    finalizePenalty(s, choice, events);
    return;
  }
  applyOutcome(s, o, events);
  void rng;
}

/** Shared by the CPU path and the PENALTY_DECISION phase. */
export function finalizePenalty(
  s: GameState,
  choice: 'accept' | 'decline',
  events: SimEvent[],
): void {
  const e = ext(s);
  const decision = s.pendingPenalty;
  const o = e.outcome;
  const p = s.play;
  if (decision === null || o === null || p === null) return;
  s.pendingPenalty = null;

  if (choice === 'decline') {
    events.push({ type: 'PENALTY_DECLINED', tick: s.tick, kind: decision.flag.kind });
    applyOutcome(s, o, events);
    return;
  }

  const before = e.prePlay.ballOnY;
  const out = decision.acceptOutcome;
  const yards = Math.abs(out.ballOnY - before);
  events.push({
    type: 'PENALTY_ENFORCED', tick: s.tick, kind: decision.flag.kind,
    team: decision.flag.team, yards,
  });
  recordPenalty(s, decision.flag.team, yards);

  const penaltyOutcome: PlayOutcome = {
    ...o,
    playType: 'penaltyOnly',
    deadReason: 'penaltyDead',
    yards: 0,
    touchdown: false,
    turnover: null,
    safety: false,
    scoreKind: null,
    points: 0,
    changeOfPossession: out.possession !== e.playOffense,
    possessionAfter: out.possession,
    spotY: out.ballOnY,
  };
  e.outcome = penaltyOutcome;

  const patPlay = isPatPlay(s);
  applyPenaltyOutcome(s, out, patPlay);
  if (out.firstDown && !patPlay) {
    recordFirstDown(s, out.possession);
    events.push({ type: 'FIRST_DOWN', tick: s.tick, team: out.possession });
  }
  accumulatePlay(s, p, e.playEvents, penaltyOutcome, e.playOffense);
  events.push({
    type: 'PLAY_RESULT', tick: s.tick, offense: e.playOffense,
    playType: 'penaltyOnly', yards: 0,
    carrierIdx: null, passerIdx: null, targetIdx: null, tacklerIdx: null,
    touchdown: false, turnover: null, deadReason: 'penaltyDead',
  });
  logPlay(s, penaltyOutcome, `${PENALTY_LABEL[decision.flag.kind]} — ${out.description}`);

  s.clockRunning = false;
  ext(s).startClockOnSnap = true;
  resetPlayClock(s, true);
  if (e.pendingTwoMinute) fireTwoMinute(s, events);
  ext(s).afterDead = GamePhase.PLAY_CALL;
}

export function routeAfterDead(s: GameState, events: SimEvent[]): void {
  const e = ext(s);
  const target = e.afterDead ?? GamePhase.PLAY_CALL;
  e.afterDead = null;

  if (target === GamePhase.GAME_OVER) {
    endGame(s, events);
    return;
  }
  if (target === GamePhase.POINT_AFTER_CHOICE) {
    s.play = null;
    s.phase = GamePhase.POINT_AFTER_CHOICE;
    e.phaseEnteredTick = s.tick;
    e.phaseInit = false;
    return;
  }
  if (target === GamePhase.PENALTY_DECISION) {
    s.phase = GamePhase.PENALTY_DECISION;
    e.phaseEnteredTick = s.tick;
    e.phaseInit = false;
    return;
  }
  if (e.quarterExpired) {
    endQuarterNow(s, events);
    return;
  }
  beginPlayCall(s);
}

export function playDeadPhase(
  s: GameState,
  input: TickInput,
  rng: RngSet,
  events: SimEvent[],
): void {
  const e = ext(s);
  if (s.play === null) {
    beginPlayCall(s);
    return;
  }
  if (takeEntry(s)) resolveDeadBall(s, rng, events);
  void input;
  if (s.tick - e.phaseEnteredTick >= DEAD_PAUSE_TICKS) routeAfterDead(s, events);
}

export { DEAD_PAUSE_TICKS };
