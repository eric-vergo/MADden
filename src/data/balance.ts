// ★ THE shared tuning surface. Balance/tuning agents edit ONLY this file.
// Every gameplay formula constant lives here so tuning never touches logic.
// Pure data — no imports beyond sim types.

import type { Difficulty } from '../sim/types';

// ---------------------------------------------------------------------------
// Movement (physics/movement.ts)
// ---------------------------------------------------------------------------
export const MOVE = {
  vMaxBase: 5.4, vMaxPerSpd: 4.6, // vMax = base + per*(SPD/99) yd/s
  aFwdBase: 4.5, aFwdPerAcc: 5.0, // yd/s^2
  aBrake: 12.0,
  aLatBase: 3.0, aLatPerAgi: 6.5, // lateral accel cap => turn radius v^2/aLat
  sprintMult: 1.12,
  sprintTurnPenalty: 0.75, // turn radius tightens (aLat multiplier while sprinting)
  carrierMult: 0.97,
  engagedSpeedMult: 0.15,
  draggedSpeedMult: 0.25,
  fatigueMaxPenalty: 0.06, // at fatigue=1, vMax scaled by (1 - this)
  separationRadius: 0.5, // teammate de-overlap push radius (yd)
  inputDeadZone: 0.25,
} as const;

// ---------------------------------------------------------------------------
// Blocking (ai/blocking.ts) — contest every `contestIntervalTicks`
// ---------------------------------------------------------------------------
export const BLOCK = {
  engageRangeYd: 1.0,
  contestIntervalTicks: 15,
  blockWeight: 0.6, strWeight: 0.4, noiseSigma: 8,
  pancakeMargin: 25, winMargin: 0, stalemateMargin: -15,
  pancakeDownTicks: 90,
  shedBurstTicks: 30,
  shedStunTicks: 20,
  winDriftYdPerSec: 0.4,
  doubleTeamBonus: 12,
  rbScanTicks: 20,
  delayedBlitzTicks: 30,
} as const;

// ---------------------------------------------------------------------------
// Passing (physics/ballFlight.ts, resolve in livePlay)
// ---------------------------------------------------------------------------
export const PASS = {
  bulletHoldTicks: 12, // hold >= this many ticks then release = bullet
  bulletSpeedBase: 14, bulletSpeedPerThp: 12, // yd/s
  bulletClearZAtLos: 2.8,
  lobApexZ: 5.5,
  accuracySigmaBase: 0.35, accuracySigmaPerThaDeficit: 1.6, // *(1 - THA/99)
  accuracyAirDistDivisor: 45, // sigma *= (1 + airDist/45)
  accuracyPressurePenalty: 0.9,
  accuracyOnRunPenalty: 0.8, onRunSpeedThreshold: 3,
  lobSigmaMult: 1.25,
  tipRangeYd: 1.2, tipChance: 0.06,
  catchRadiusYd: 1.5, catchMaxZ: 2.4, jumpCatchZ: 3.0,
  candFacingBonus: 10, candFacingPenalty: -15, candIntendedBonus: 8, candDistWeight: 30,
  uncontestedCatchBase: 0.55, uncontestedCatchPerCth: 1 / 250, uncontestedCatchMax: 0.97,
  contestedCleanMargin: 20,
  contestedCatchP: 0.6, contestedSwatP: 0.25,
  qbHitWhileThrowingSigmaMult: 2.5,
  throwawayMinSecPostSnap: 3.2,
} as const;

// ---------------------------------------------------------------------------
// Tackling & fumbles (ai/tackling.ts)
// ---------------------------------------------------------------------------
export const TACKLE = {
  attemptRangeYd: 1.2,
  behindRangeYd: 0.7,
  noiseSigma: 10,
  hpwWeight: 0.25, btkStrWeight: 0.2,
  momentumScale: 8, momentumClamp: 8,
  angleBonusHeadOn: 6, angleBonusBehind: -8,
  bigHitMargin: 12,
  wrapDragTicks: 12,
  brokenStumbleTicks: 30,
  hitStickBonus: 10, hitStickWhiffTicks: 40,
  gangFinishBonusPerHelper: 10,
  activeMoveBonus: 15,
  fumbleBase: 0.012,
  fumbleBigHitMult: 2.0, fumbleTruckMult: 1.5, fumbleSackMult: 3.5,
  fumbleRatingScale: 60, fumbleMultMin: 0.4, fumbleMultMax: 2.2,
  looseBallRecoverRangeYd: 0.6, scoopTicks: 25,
} as const;

// ---------------------------------------------------------------------------
// Carrier moves (windows/cooldowns in ticks)
// ---------------------------------------------------------------------------
export const MOVES = {
  juke: { windowTicks: 20, cooldownTicks: 45, speedKeep: 0.8 },
  spin: { windowTicks: 25, cooldownTicks: 60, speedKeep: 0.6 },
  stiffArm: { windowTicks: 30, cooldownTicks: 50, speedKeep: 0.95 },
  truck: { cooldownTicks: 40 },
  diveLungeYd: 2.5,
  defenderLungeMissTicks: 25,
} as const;

// ---------------------------------------------------------------------------
// Coverage & defensive AI (ai/coverage.ts, ai/pursuit.ts)
// ---------------------------------------------------------------------------
export const COVERAGE = {
  reactionMcvBonusMaxTicks: 4, // high MCV shaves up to this off reaction delay
  breakOnBallRadiusYd: 12,
  zoneClaimSpeedThreshold: 2.0, // "zone posture" = speed below this, facing QB
  intMinCoverageRating: 80, // ZCV/MCV >= this attempts INT, else swat
  runRecognitionBaseMin: 6, runRecognitionBaseMax: 14, // + difficulty extra
  pursuitDirectCount: 2, // nearest N pursue directly, rest take cutoff angles
  spyDepthYd: 4,
} as const;

// ---------------------------------------------------------------------------
// CPU QB brain (ai/qb.ts)
// ---------------------------------------------------------------------------
export const QB_AI = {
  opennessDecayPerRead: 0.15,
  opennessPressureDecay: 0.25,
  pressureRadiusYd: 2.5,
  scramblePressureThreshold: 0.6,
  scrambleMinSpd: 75,
  scrambleLaneClearYd: 3.5,
  pocketSlideYd: 1.5,
  checkdownMinSepYd: 1.5,
  holdAfterProgressionTicks: 20,
  awrTimerFastMult: 0.85, awrTimerSlowMult: 1.15, awrFastThreshold: 90, awrSlowThreshold: 70,
} as const;

// ---------------------------------------------------------------------------
// Kicking (rules/kickMeter.ts, ai/specialTeams.ts)
// ---------------------------------------------------------------------------
export const KICK = {
  meterFillTicks: 50, // power bar 0->1
  meterSweepTicks: 50, // accuracy marker sweep back
  kickoffDistBase: 45, kickoffDistPerPower: 30, // * power01 * (KPW/99)
  kickoffHangSecMin: 3.6, kickoffHangSecMax: 4.2,
  puntDistBase: 35, puntDistPerPower: 25,
  puntHangSec: 4.3,
  fgMaxRangeBase: 30, fgMaxRangePerKpw: 35, // yards of true distance at full power
  fgBlockWindowTicks: 55, fgBlockChanceOnShed: 0.15,
  puntBlockWindowTicks: 45, puntBlockChanceOnShed: 0.2,
  aimMaxOffsetRad: 0.26, // ~15 degrees
  muffChance: 0.01,
  fairCatchGunnerArrivalTicks: 12,
  onsideDistMin: 12, onsideDistMax: 15,
} as const;

// ---------------------------------------------------------------------------
// Penalties (rules/penalties.ts) — global frequency multiplier + per-kind
// ---------------------------------------------------------------------------
export const PENALTY = {
  frequency: 1.0, // 0 disables all organic rolls (config can also disable)
  cpuFalseStartPerSnap: 0.006,
  cpuOffsidePerSnap: 0.012,
  offsideVsHardCount: 0.04,
  holdingOnBadShed: 0.2, holdingBadShedMargin: -25, holdingReengageTicks: 10,
  opiOnPickContact: 0.15,
  dpiClosingSpeedYdPerSec: 2.0,
  maxFlagsPerGameTarget: 8,
} as const;

// ---------------------------------------------------------------------------
// Difficulty — the ONLY lever set. Never nerfs user ratings.
// ---------------------------------------------------------------------------
export interface DifficultyParams {
  cpuQbReadDwellTicks: number;
  cpuQbOpennessThresholdYd: number;
  manMirrorDelayMinTicks: number;
  manMirrorDelayMaxTicks: number;
  breakOnBallDelayTicks: number;
  runRecognitionExtraTicks: number;
  pursuitAngleNoiseDeg: number;
  cpuThrowLeadErrorSigmaYd: number;
  cpuKickErrorSigma: number; // fraction of meter
  cpuCarrierMoveChance: number;
  playCallSoftmaxTemp: number;
  cpuReadsUserTendencies: boolean;
  fourthDownChart: 'naive' | 'book' | 'analytic' | 'aggressive';
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  rookie: {
    cpuQbReadDwellTicks: 55, cpuQbOpennessThresholdYd: 3.0,
    manMirrorDelayMinTicks: 18, manMirrorDelayMaxTicks: 26,
    breakOnBallDelayTicks: 30, runRecognitionExtraTicks: 12,
    pursuitAngleNoiseDeg: 14, cpuThrowLeadErrorSigmaYd: 0.8,
    cpuKickErrorSigma: 0.15, cpuCarrierMoveChance: 0.15,
    playCallSoftmaxTemp: 2.0, cpuReadsUserTendencies: false,
    fourthDownChart: 'naive',
  },
  pro: {
    cpuQbReadDwellTicks: 42, cpuQbOpennessThresholdYd: 2.2,
    manMirrorDelayMinTicks: 12, manMirrorDelayMaxTicks: 18,
    breakOnBallDelayTicks: 20, runRecognitionExtraTicks: 6,
    pursuitAngleNoiseDeg: 9, cpuThrowLeadErrorSigmaYd: 0.4,
    cpuKickErrorSigma: 0.10, cpuCarrierMoveChance: 0.3,
    playCallSoftmaxTemp: 1.2, cpuReadsUserTendencies: false,
    fourthDownChart: 'book',
  },
  allPro: {
    cpuQbReadDwellTicks: 33, cpuQbOpennessThresholdYd: 1.7,
    manMirrorDelayMinTicks: 8, manMirrorDelayMaxTicks: 13,
    breakOnBallDelayTicks: 12, runRecognitionExtraTicks: 2,
    pursuitAngleNoiseDeg: 5, cpuThrowLeadErrorSigmaYd: 0.15,
    cpuKickErrorSigma: 0.06, cpuCarrierMoveChance: 0.5,
    playCallSoftmaxTemp: 0.8, cpuReadsUserTendencies: true,
    fourthDownChart: 'analytic',
  },
  allMadden: {
    cpuQbReadDwellTicks: 27, cpuQbOpennessThresholdYd: 1.3,
    manMirrorDelayMinTicks: 5, manMirrorDelayMaxTicks: 9,
    breakOnBallDelayTicks: 8, runRecognitionExtraTicks: 0,
    pursuitAngleNoiseDeg: 2, cpuThrowLeadErrorSigmaYd: 0,
    cpuKickErrorSigma: 0.03, cpuCarrierMoveChance: 0.7,
    playCallSoftmaxTemp: 0.5, cpuReadsUserTendencies: true,
    fourthDownChart: 'aggressive',
  },
};

// ---------------------------------------------------------------------------
// League-wide calibration targets, shared by the live engine's soak test
// and meta/quickSim so both produce consistent football.
// ---------------------------------------------------------------------------
export const CALIBRATION = {
  leagueAvgPointsPerTeam: 23,
  leagueAvgYardsPerTeam: 340,
  scoreMeanMin: 17, scoreMeanMax: 31,
  completionPctMin: 0.55, completionPctMax: 0.70,
  yardsPerCarryMin: 3.5, yardsPerCarryMax: 5.5,
  sacksPerTeamMin: 1, sacksPerTeamMax: 5,
  turnoversPerTeamMin: 0.5, turnoversPerTeamMax: 2.5,
  penaltiesPerGameMin: 2, penaltiesPerGameMax: 8,
  puntsPerGameMin: 6, puntsPerGameMax: 12,
  ovrEdge10WinRateMin: 0.7, ovrEdge10WinRateMax: 0.85,
} as const;
