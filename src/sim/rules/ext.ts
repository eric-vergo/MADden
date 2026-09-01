// Per-GameSim scratch state the frozen GameState has no field for (ball lateral
// spot, phase timers, in-flight play bookkeeping). Keyed by GameState identity
// in a WeakMap so it never leaks between sims and never has to be serialized.
// Purely derived data: losing it only costs presentation detail, and nothing
// outside src/sim reads it.

import { GamePhase, type DeadReason, type GameState, type TeamSide } from '../types';
import type { SimEvent } from '../events';
import { CENTER_X } from '../constants';

export type ResultPlayType =
  | 'run' | 'pass' | 'sack' | 'scramble' | 'kneel' | 'spike'
  | 'punt' | 'fieldGoal' | 'extraPoint' | 'twoPoint' | 'kickoff' | 'penaltyOnly';

export type ScoreKind = 'td' | 'fg' | 'safety' | 'xp' | 'two' | null;

/** Everything PLAY_DEAD needs to know about how PLAY_LIVE ended. */
export interface PlayOutcome {
  playType: ResultPlayType;
  deadReason: DeadReason;
  /** World y the ball is spotted at (before penalty enforcement). */
  spotY: number;
  /** Lateral spot (pre hash-snap). */
  spotX: number;
  yards: number;
  carrierIdx: number | null;
  passerIdx: number | null;
  targetIdx: number | null;
  tacklerIdx: number | null;
  touchdown: boolean;
  turnover: 'int' | 'fumble' | 'downs' | null;
  /** Which team has the ball for the next snap. */
  possessionAfter: TeamSide;
  /** True when possession changed on this play (fresh set of downs). */
  changeOfPossession: boolean;
  safety: boolean;
  scoreKind: ScoreKind;
  points: number;
  /** Forces the next snap kind; null = derive normally. */
  nextKind: 'normal' | 'kickoff' | 'freeKick' | 'pat' | null;
  /** Completed pass (for stats). */
  completed: boolean;
  fgDistance: number;
}

export interface KickPlan {
  style: 'kickoff' | 'punt' | 'placekick';
  kickerIdx: number;
  /** CPU-scheduled press ticks (absolute). */
  pressTicks: [number, number, number];
  pressesDone: number;
  launched: boolean;
  /** World y the kick leaves from. */
  spotY: number;
  /** True distance of a FG attempt (hold spot to the upright plane). */
  fgDistance: number;
  auto: boolean;
}

export interface PrePlaySnapshot {
  down: number;
  toGo: number;
  ballOnY: number;
  possession: TeamSide;
  quarter: number;
  clockSec: number;
  lineToGainY: number;
}

export interface SimExt {
  /** Lateral ball spot between plays (GameState only carries ballOnY). */
  ballOnX: number;
  phaseEnteredTick: number;
  phaseInit: boolean;
  quarterExpired: boolean;
  pendingTwoMinute: boolean;
  /** Whether the game clock resumes on the next snap. */
  startClockOnSnap: boolean;
  /** Play-clock reading the CPU offense snaps at. */
  snapAtPlayClock: number;
  cpuOffenseCallTick: number;
  cpuDefenseCallTick: number;
  /** Team that snapped the current play. */
  playOffense: TeamSide;
  prePlay: PrePlaySnapshot;
  /** Absolute tick the safety whistle fires at. */
  whistleTick: number;
  /** Circular buffer of carrier y over the forward-progress window. */
  progress: number[];
  progressCount: number;
  /** Player index the progress window belongs to. */
  progressCarrier: number;
  /** Events emitted during the current play (stats consume these). */
  playEvents: SimEvent[];
  /** Tick a wrap-tackle finishes the runner, or -1. */
  dragUntilTick: number;
  fairCatchCalled: boolean;
  /** User RETURN_DECISION: kneel the kick in the end zone. */
  returnKneel: boolean;
  ballRestTicks: number;
  kick: KickPlan | null;
  meshDone: boolean;
  /** Who finished the play (set by actions.attemptTackle / the whistle). */
  deadTacklerIdx: number | null;
  deadBigHit: boolean;
  /** Pass bookkeeping between release and arrival. */
  lastPasserIdx: number;
  lastTargetIdx: number;
  throwTick: number;
  throwaway: boolean;
  passLanding: { x: number; y: number };
  passAirYds: number;
  passResolved: boolean;
  tipUsed: boolean;
  completed: boolean;
  /** Index of the most recent ball carrier (survives a tackle). */
  lastCarrierIdx: number;
  /** Set when the ending site already knows the exact dead-ball spot. */
  spotFixed: boolean;
  /** A kick is still untouched by the receiving team. */
  kickUntouched: boolean;
  outcome: PlayOutcome | null;
  afterDead: GamePhase | null;
  patTwo: boolean;
  otPeriods: number;
  /** Tick a user throw button went down, keyed by receiver slot 0..4. */
  throwHoldTick: number;
  throwHoldSlot: number;
  gameOverEmitted: boolean;
  /** Ticks the current phase has waited for an auto-continue. */
  autoContinueTicks: number;
}

function freshPrePlay(): PrePlaySnapshot {
  return { down: 1, toGo: 10, ballOnY: 60, possession: 0, quarter: 1, clockSec: 0, lineToGainY: 70 };
}

function freshExt(s: GameState): SimExt {
  return {
    ballOnX: CENTER_X,
    phaseEnteredTick: s.tick,
    phaseInit: false,
    quarterExpired: false,
    pendingTwoMinute: false,
    startClockOnSnap: false,
    snapAtPlayClock: 15,
    cpuOffenseCallTick: -1,
    cpuDefenseCallTick: -1,
    playOffense: s.possession,
    prePlay: freshPrePlay(),
    whistleTick: -1,
    progress: [],
    progressCount: 0,
    progressCarrier: -1,
    playEvents: [],
    dragUntilTick: -1,
    fairCatchCalled: false,
    returnKneel: false,
    ballRestTicks: 0,
    kick: null,
    meshDone: false,
    deadTacklerIdx: null,
    deadBigHit: false,
    lastPasserIdx: -1,
    lastTargetIdx: -1,
    throwTick: -1,
    throwaway: false,
    passLanding: { x: 0, y: 0 },
    passAirYds: 0,
    passResolved: false,
    tipUsed: false,
    completed: false,
    lastCarrierIdx: -1,
    spotFixed: false,
    kickUntouched: true,
    outcome: null,
    afterDead: null,
    patTwo: false,
    otPeriods: 0,
    throwHoldTick: -1,
    throwHoldSlot: -1,
    gameOverEmitted: false,
    autoContinueTicks: 0,
  };
}

const EXT = new WeakMap<GameState, SimExt>();

export function ext(s: GameState): SimExt {
  let e = EXT.get(s);
  if (e === undefined) {
    e = freshExt(s);
    EXT.set(s, e);
  }
  return e;
}

/** Change phase and reset the per-phase entry bookkeeping. */
export function setPhase(s: GameState, next: GamePhase): void {
  const e = ext(s);
  s.phase = next;
  e.phaseEnteredTick = s.tick;
  e.phaseInit = false;
  e.autoContinueTicks = 0;
}

/** Ticks since the current phase was entered (0 on the entry tick). */
export function phaseElapsed(s: GameState): number {
  return s.tick - ext(s).phaseEnteredTick;
}

/** True exactly once, on the first handler run after entering a phase. */
export function takeEntry(s: GameState): boolean {
  const e = ext(s);
  if (e.phaseInit) return false;
  e.phaseInit = true;
  return true;
}

export function resetPlayScratch(s: GameState): void {
  const e = ext(s);
  e.progress = [];
  e.progressCount = 0;
  e.progressCarrier = -1;
  e.playEvents = [];
  e.dragUntilTick = -1;
  e.fairCatchCalled = false;
  e.returnKneel = false;
  e.ballRestTicks = 0;
  e.kick = null;
  e.meshDone = false;
  e.outcome = null;
  e.whistleTick = -1;
  e.throwHoldTick = -1;
  e.throwHoldSlot = -1;
  e.deadTacklerIdx = null;
  e.deadBigHit = false;
  e.lastPasserIdx = -1;
  e.lastTargetIdx = -1;
  e.throwTick = -1;
  e.throwaway = false;
  e.passLanding = { x: 0, y: 0 };
  e.passAirYds = 0;
  e.passResolved = false;
  e.tipUsed = false;
  e.completed = false;
  e.lastCarrierIdx = -1;
  e.spotFixed = false;
  e.kickUntouched = true;
}
