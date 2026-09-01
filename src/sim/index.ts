// Public barrel for the sim core — the ONLY import surface for outside layers.
// DETERMINISM RULES (enforced by tsconfig.pure.json + tests/purity.test.ts):
//  1. No Date, Math.random, performance, timers, or DOM anywhere in src/sim.
//  2. All randomness through the injected RngSet; all time through state.tick.
//  3. tick() is the only mutator; outsiders treat state as Readonly.
//  4. Fixed-order iteration only (arrays by index; sort keys before iterating
//     any Record whose insertion order isn't fixed by construction).

export * from './types';
export * from './events';
export * from './constants';
export { Rng, makeRngSet, hashSeed } from './rng';
export type { RngSet } from './rng';
export { Hasher, hashGameState } from './hash';
export { GameSim, createInitialState, emptyGameStats } from './GameSim';

// --- Sim core (workstream S1) ---
export {
  toWorld, toNormalized, snapToHash, attackGoalY, ownGoalY, attackEndLineY,
  ownYardLineY, oppYardLineY, yardsToGoal, gainYards, ballSpot, clampToField,
} from './transform';
export type { Dir } from './transform';
export {
  buildPlayState, buildUnit, resolveRoleAthlete, formationRoles, findRole,
  OFF_ROLE_ORDER, DEF_ROLE_ORDER,
} from './roster';
export {
  throwPass, throwAway, attemptTackle, tryCarrierMove, pressKickMeter,
  callFairCatch, maybeHoldingOnShed,
} from './actions';
export type { CarrierMove } from './actions';
export {
  lineToGainY, isFirstDown, freshToGo, isGoalToGo, bestProgressY, enforceYards,
  describeState, spotLabel,
} from './rules/downs';
export {
  clockAfterPlay, halfOf, inTwoMinuteWindow, resetPlayClock,
} from './rules/clock';
export {
  addPoints, setupKickoff, setupPat, shouldGoForTwo, overtimeDecided,
} from './rules/scoring';
export {
  PENALTY_YARDS, PENALTY_LABEL, projectPlay, projectPenalty, evaluate as penaltyEV,
  buildDecision, chooseByEV,
} from './rules/penalties';
export {
  powerAt, accuracyErrorAt, accuracy01, aimErrorRad, tickForPower,
  tickForAccuracy, press as pressMeter, meterStage, forceExpiry,
} from './rules/kickMeter';
export {
  bulletLaunch, lobLaunch, pitchLaunch, kickLaunch, stepBall, predict, timeToHeight,
} from './physics/ballFlight';
export { maxSpeed, fwdAccel, latAccel, stepPlayer } from './physics/movement';
export {
  separateTeammates, isOutOfBounds, isOutOfBoundsX, closingSpeed, isFromBehind,
} from './physics/collisions';
export {
  accumulatePlay, ensurePlayerStats, emptyPlayerStats, recordFirstDown,
  recordThirdDown, recordPenalty,
} from './stats';
