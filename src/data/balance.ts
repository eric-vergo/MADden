// ★ THE shared tuning surface. Balance/tuning agents edit ONLY this file.
// Every gameplay formula constant lives here so tuning never touches logic.
// Pure data — no imports beyond sim types.

import type { DefPlayTag, Difficulty, GapId, PlayTag } from '../sim/types';

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
  contestIntervalTicks: 12,
  blockWeight: 0.6, strWeight: 0.4, noiseSigma: 8,
  /** Run blocking is downhill with leverage; pass sets are not. */
  runBlockBonus: 6.5,
  pancakeMargin: 25, winMargin: 0, stalemateMargin: -13,
  pancakeDownTicks: 90,
  shedBurstTicks: 40,
  shedStunTicks: 34,
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
  uncontestedCatchBase: 0.54, uncontestedCatchPerCth: 1 / 250, uncontestedCatchMax: 0.97,
  contestedCleanMargin: 20,
  contestedCatchP: 0.6, contestedSwatP: 0.25,
  /**
   * Defenders catch the ball far worse than receivers do — wrong hands, back
   * to the flight, playing through a body. Without these the sim turns every
   * well-covered throw into an interception.
   */
  defenderCatchMult: 0.22,
  defenderContestedIntP: 0.28,
  qbHitWhileThrowingSigmaMult: 2.5,
  throwawayMinSecPostSnap: 3.2,
} as const;

// ---------------------------------------------------------------------------
// Tackling & fumbles (ai/tackling.ts)
// ---------------------------------------------------------------------------
export const TACKLE = {
  attemptRangeYd: 1.3,
  behindRangeYd: 0.8,
  noiseSigma: 10,
  hpwWeight: 0.3, btkStrWeight: 0.2,
  momentumScale: 8, momentumClamp: 8,
  angleBonusHeadOn: 6, angleBonusBehind: -3,
  bigHitMargin: 12,
  wrapDragTicks: 12,
  brokenStumbleTicks: 20,
  hitStickBonus: 10, hitStickWhiffTicks: 40,
  gangFinishBonusPerHelper: 10,
  activeMoveBonus: 9,
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
  pressureRadiusYd: 3.5,
  scramblePressureThreshold: 0.6,
  scrambleMinSpd: 75,
  scrambleLaneClearYd: 3.5,
  pocketSlideYd: 1.5,
  checkdownMinSepYd: 1.2,
  holdAfterProgressionTicks: 30,
  /**
   * Share of a defender's flight-time travel that counts against a receiver's
   * separation. 0 = the QB reads raw cushion (throws at the snap); 1 = every
   * defender arrives on time (the QB never throws).
   */
  readClosingFrac: 0.69,
  /** Ticks past the second look before the QB forces one in anyway. */
  forcedThrowTicks: 40,
  awrTimerFastMult: 0.85, awrTimerSlowMult: 1.15, awrFastThreshold: 90, awrSlowThreshold: 70,
} as const;

// ---------------------------------------------------------------------------
// Kicking (rules/kickMeter.ts, ai/specialTeams.ts)
// ---------------------------------------------------------------------------
export const KICK = {
  meterFillTicks: 50, // power bar 0->1
  meterSweepTicks: 50, // accuracy marker sweep back
  /**
   * Kickoff carry. At 45 every kickoff came down within a yard or two of the
   * goal line, so the league had literally zero touchbacks: every kick was
   * fielded at the receiving 5 and returned to about the 16, which left drives
   * starting ten yards worse than real football and put a pass every few series
   * in the shadow of a team's own goal posts. 52 puts a good kicker into the end
   * zone (touchback, ball on the 30) and leaves the weaker legs returnable.
   */
  kickoffDistBase: 52, kickoffDistPerPower: 30, // * power01 * (KPW/99)
  kickoffHangSecMin: 3.6, kickoffHangSecMax: 4.2,
  puntDistBase: 35, puntDistPerPower: 25,
  puntHangSec: 4.3,
  fgMaxRangeBase: 42, fgMaxRangePerKpw: 35, // yards of CARRY at full power
  /**
   * Extra carry the CPU aims past the uprights. A kick that only just reaches
   * the plane arrives at ground level: it needs roughly this much more to be
   * over the crossbar when it gets there.
   */
  fgAimPastPostsYd: 13,
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
  cpuFalseStartPerSnap: 0.010,
  cpuOffsidePerSnap: 0.014,
  offsideVsHardCount: 0.04,
  // holdingReengageTicks MUST exceed BLOCK.shedStunTicks: a stunned blocker
  // is skipped by the AI, so a shorter window makes holding unreachable.
  holdingOnBadShed: 0.06, holdingBadShedMargin: -26, holdingReengageTicks: 45,
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
  fgAttPerGameMin: 1, fgAttPerGameMax: 5,
  playsPerGameMin: 95, playsPerGameMax: 140,
  ovrEdge10WinRateMin: 0.7, ovrEdge10WinRateMax: 0.85,

  // -------------------------------------------------------------------------
  // Special teams and situational football. These only became measurable once
  // returns ran the right way and the own-impetus rule existed, so they are
  // bands over the SHAPE of the football rather than over the box score.
  // -------------------------------------------------------------------------
  /** Average kickoff return, over the returns that were actually run back. */
  kickReturnMeanMin: 15, kickReturnMeanMax: 30,
  /** At least one return this long has to turn up: returns need a tail. */
  kickReturnLongYd: 40,
  /**
   * Safeties per game. The NFL sits near 0.05; this sim runs a little hotter
   * because drives start further back, and every one it produces is a sack or
   * a stuffed run in the offense's own end zone (never a return, which is what
   * the impetus rule is there to prevent).
   */
  safetiesPerGameMax: 0.35,
  /**
   * Defensive and return touchdowns per game (pick-six, scoop-and-score, kick
   * return). Real football is nearer 0.15. The ceiling here is deliberately
   * loose: pass rushers still make uncontested interceptions at the line of
   * scrimmage, and with the offense backed up those become walk-in scores. The
   * band exists to catch the two regressions that matter — a defense that can
   * never score, and one that scores every other drive.
   */
  defensiveTdPerGameMax: 1.0,
  /** Pass interference per game: it must exist, and it must stay rare. */
  passInterferencePerGameMax: 1.0,
} as const;

// ===========================================================================
// AI tuning tables. These used to live beside the brains as `TODO(balance)`
// blocks; they are gameplay tuning, so they belong on this surface. Each AI
// module imports its table from here and re-exports it under the same name,
// which keeps every existing import path working.
// ===========================================================================

// ---------------------------------------------------------------------------
// Play timing (phases/preSnap.ts, phases/playLive.ts, actions.ts)
// ---------------------------------------------------------------------------
export const PLAY_TIMING = {
  /** Ticks a play may run before the safety whistle ends it. */
  liveMaxTicks: 12 * 60,
  liveMaxTicksKick: 15 * 60,
  /** Minimum ticks at the line before anyone can snap it. */
  settleTicks: 30,
  /** Ticks after the snap before the kick meter starts, by style. */
  meterPrepTicks: { kickoff: 5, punt: 15, placekick: 6 } as Record<
    'kickoff' | 'punt' | 'placekick', number
  >,
  /** Ticks of flight before a pass can be caught (stops self-catches). */
  minAirTicks: 3,
  /** Half-width of the tackle box; a throwaway outside it is legal. */
  tackleBoxHalfWidthYd: 9,
  /** Ticks a dive lunge stays live before the runner is down. */
  diveTicks: 15,
  /** Grace ticks before an untouched user kick meter starts itself. */
  userMeterStartGraceTicks: 90,
  /** Presentation pause between the whistle and the next snap. */
  deadPauseTicks: 90,
  /** Gain (yards) that counts as a big play for the replay trigger. */
  bigGainYards: 20,
  /** Ticks the CPU "thinks" before sending its call in. */
  cpuCallMinTicks: 18,
  cpuCallJitterTicks: 14,
  /** Ticks a CPU-only game waits at a break before continuing itself. */
  autoContinueTicks: 60,
  /** Overtime periods played before a tie is declared regardless of config. */
  maxOtPeriods: 4,
  /** Fallback snap window (play-clock seconds left) when the coach is silent. */
  fallbackSnapPlayClockMin: 8, fallbackSnapPlayClockMax: 20,
} as const;

// ---------------------------------------------------------------------------
// Ball flight & the turf (physics/ballFlight.ts, physics/collisions.ts)
// ---------------------------------------------------------------------------
export const BALL = {
  /** Height the ball leaves the passer's hand (yards). */
  releaseZ: 1.9,
  /** Height a pass is aimed to arrive at. */
  catchZ: 1.5,
  bounceRestitution: 0.35,
  bounceFriction: 0.55,
  restSpeed: 0.45,
  /** Sideline tolerance: a foot on the paint is out. */
  sidelineMarginYd: 0.3,
} as const;

// ---------------------------------------------------------------------------
// Play-frame geometry (ai/frame.ts)
// ---------------------------------------------------------------------------
/** Gap mouths as normalized x offsets from the ball (OL split 1.8 yd). */
export const GAP_X: Record<GapId, number> = {
  'A-left': -0.9, 'A-right': 0.9,
  'B-left': -2.7, 'B-right': 2.7,
  'C-left': -4.6, 'C-right': 4.6,
  'D-left': -7.4, 'D-right': 7.4,
};

/** Sideline keep-out used by AI steering (players never aim outside this). */
export const SIDELINE_MARGIN_YD = 0.6;

// ---------------------------------------------------------------------------
// Steering primitives (ai/steering.ts)
// ---------------------------------------------------------------------------
export const STEER = {
  arriveSlowRadiusYd: 2.0,
  pursueMaxLeadSec: 1.2,
  ballSampleTicks: 5,
  ballSampleHorizonSec: 5.0,
  interceptReachZ: 2.6,
  /** Reach slack when judging "can I get there in time" (yards). */
  reachSlackYd: 0.8,
  /** Extra push a player applies to clear an overlapping teammate. */
  separationPush: 1.2,
} as const;

// ---------------------------------------------------------------------------
// Blocking AI (ai/blocking.ts)
// ---------------------------------------------------------------------------
export const BLOCK_AI = {
  /** A blocker abandons his man once he leaves this arc (yards). */
  retargetArcYd: 3.0,
  retargetCheckTicks: 15,
  /** Aim point offset in front of the defender when closing. */
  approachLeadSec: 0.25,
  /** Second-level defenders start at this depth (yards past the LOS). */
  secondLevelDepthYd: 3.0,
  /** Pull path: run this far behind the LOS before turning up. */
  pullDepthYd: 1.6,
  /** Extra blocker climbs after this many winning contests. */
  climbAfterWins: 2,
  /** Open-field blockers aim this far in front of the carrier's threat. */
  shieldOffsetYd: 0.9,
  maxBlockersPerDefender: 2,
} as const;

// ---------------------------------------------------------------------------
// Coverage AI (ai/coverage.ts)
// ---------------------------------------------------------------------------
export const COVERAGE_AI = {
  ringSize: 32,
  leverageShadeYd: 0.7,
  /** Cushion shrinks by this per yard of receiver depth. */
  cushionCloseRate: 0.25,
  cushionMinYd: 0.4,
  trailOffsetYd: 0.8,
  /** Seconds of receiver motion a zone defender projects when pattern matching. */
  matchProjectSec: 1.0,
  matchReleaseMult: 1.2,
  /** Curl-flat breaks to the flat after this many ticks with no curl threat. */
  flatBreakTicks: 40,
  deepZoneMinDepth: 10,
  /** How far past the goal line a compressed deep zone may still drop. */
  zoneEndZoneCushionYd: 3,
  /** Speed cap for an unclaimed deep defender, as a share of his top speed. */
  deepZoneIdleSpeedMult: 0.85,
  /** Inside this distance the defender mirrors velocity instead of chasing. */
  mirrorLockYd: 2.0,
  mirrorGain: 2.5,
} as const;

// ---------------------------------------------------------------------------
// Pass rush / pursuit AI (ai/pursuit.ts)
// ---------------------------------------------------------------------------
export const PURSUIT_AI = {
  laneEdgeX: 5.5, laneInteriorX: 1.6,
  /** Rush checkpoint depth: 1 yd behind the LOS (design §9). */
  checkpointDepthYd: -1.0,
  checkpointReachedYd: 1.2,
  containOutsideYd: 2.2,
  blitzGapDepthYd: 0.5,
  runFitDepthYd: 1.0,
  /** Rank-based cutoff lanes: each extra rank aims this much further ahead. */
  cutoffBaseLeadYd: 2.0, cutoffPerRankYd: 1.5,
  /**
   * A real pursuit angle also scales with how far BEHIND the chaser is: a man
   * 30 yards back who aims 8 yards in front of the runner is running his tail
   * forever. Without this, one broken tackle in the open field was permanent —
   * kick returns were bimodal (stopped at 11 yards, or 85 and gone) because no
   * second wave could ever arrive.
   */
  cutoffDistLeadFrac: 0.3, cutoffMaxLeadYd: 22,
  angleNoiseRefreshTicks: 20,
  tackleCooldownTicks: 8,
  /** dot(carrierHeading, carrier→tackler) above this = chasing from behind. */
  behindDotThreshold: 0.3,
  frontalArcDot: 0.0,
  /** A QB this far outside the pocket counts as a runner. */
  scrambleTriggerYd: 3.0,
} as const;

// ---------------------------------------------------------------------------
// Route running (ai/routes.ts)
// ---------------------------------------------------------------------------
export const ROUTE_AI = {
  sharpArriveYd: 0.7,
  roundedArriveYd: 1.5,
  /** A waypoint counts as reached once it is behind us inside this radius. */
  passedWaypointYd: 2.0,
  finalArriveYd: 1.6,
  /** Braking-distance multiplier before a sharp break (AGI shortens it). */
  breakWindowBaseYd: 1.25, breakWindowAgiYd: 0.35,
  breakWindowMinYd: 0.5,
  breakSpeedCap: 4.0,
  minPacedSpeed: 1.2,
  settleDriftSpeed: 1.0,
  /** Radius searched for zone defenders when settling. */
  settleScanYd: 14,
  settleMaxOffsetYd: 4.0,
  /** Hot conversion: quick slant depth/width. */
  hotDepthYd: 5, hotInsideYd: 5,
} as const;

// ---------------------------------------------------------------------------
// Ball carrier AI (ai/carrier.ts)
// ---------------------------------------------------------------------------
export const CARRIER_AI = {
  gapRescoreTicks: 10,
  gapAimDepthYd: 2.0,
  gapLaneScanYd: 2.5,
  gapLaneDepthYd: 5.0,
  gapDefenderPenalty: 1.5,
  secondLevelDepthYd: 2.0,
  /** Open-field candidate fan. */
  fanHalfAngleRad: 1.31, // ~75 degrees
  fanSteps: 11,
  fanProbeYd: 4.0,
  fanProgressWeight: 1.0,
  fanSpaceWeight: 0.35,
  sidelineAvoidYd: 4.0,
  sidelineAvoidPenalty: 2.5,
  sidelineSeekBonus: 1.8,
  /** Move decisions. */
  moveTriggerYd: 2.4,
  moveCooldownTicks: 30,
  slideDefenderYd: 2.6,
  qbSlideMinDepthYd: 4.0,
} as const;

// ---------------------------------------------------------------------------
// Special teams AI (ai/specialTeams.ts)
// ---------------------------------------------------------------------------
export const ST_AI = {
  meterStartTick: 4,
  laneCount: 10,
  laneHoldDepthYd: 12,
  containOutsideYd: 3.0,
  gunnerLateralYd: 15,
  wedgeDepthYd: 9,
  /** Let a punt bounce when it would land this close to our goal line. */
  letBounceInsideYd: 8,
  returnerSettleYd: 1.0,
  puntTargetShortOfGoalYd: 6,
} as const;

// ---------------------------------------------------------------------------
// CPU QB brain internals (ai/qb.ts)
// ---------------------------------------------------------------------------
export const QB_BRAIN = {
  /** Ticks of footwork before the QB is on time to throw, by drop type. */
  dropTicks: {
    '1step': 16, '3step': 40, '5step': 62, gunSet: 30,
    bootLeft: 55, bootRight: 55, sneak: 0, kneel: 0, spike: 0,
  } as Record<string, number>,
  bootLateralYd: 7,
  /** A zone defender who beats the ball by more than this kills the read. */
  deadReadTicks: 6,
  breakingAwayBonusYd: 0.5,
  bulletMaxAirYd: 18,
  bulletTightWindowYd: 3.0,
  tackleBoxHalfWidthYd: 6.5,
  scrambleProbeYd: 4.0,
  pocketDriftSpeed: 2.0,
  /** How long the QB rides the mesh fake before drifting clear. */
  meshClearTicks: 8,
} as const;

// ---------------------------------------------------------------------------
// CPU play calling (ai/coach.ts)
// ---------------------------------------------------------------------------
export const COACH = {
  ewmaAlpha: 0.3,
  ewmaPriorYds: 4.5,
  ewmaWeight: 0.12,
  ewmaMultMin: 0.5, ewmaMultMax: 1.6,
  varietyLookback: 4,
  varietyPenalty: 0.6,
  /** Spreads tag weights before the softmax so the temperature has bite. */
  tagScoreScale: 2.5,
  /** Hurry-up / milk / normal play-clock targets (seconds REMAINING). */
  hurryUpPlayClockSec: 26,
  milkPlayClockSec: 3,
  normalPlayClockMin: 25, normalPlayClockMax: 32,
  hurryUpSecLeft: 240,
  milkSecLeft: 300,
  defensiveTimeoutSecLeft: 180,
  /**
   * The three windows above are authored against a 15-minute quarter. Short
   * quarters scale them down; otherwise a 5-minute Q4 is "late" end to end and
   * the coach spends the whole quarter in desperation/milk mode.
   */
  clockWindowReferenceQuarterSec: 900,
  clockWindowMinSec: 30,
  spikeSecLeft: 35,
  /** Seconds left where the last snap of a half becomes a field goal try. */
  endOfHalfKickSec: 9,
  fgRangeMarginYd: 13,
  /**
   * Longest distance a chart will go for it on 4th down while a field goal is
   * available. Without this every short 4th down inside the 35 is a "go", and
   * the kicker never sees the field.
   */
  goInFgRangeMaxToGo: { naive: 0, book: 1, analytic: 1, aggressive: 5 } as Record<
    'naive' | 'book' | 'analytic' | 'aggressive', number
  >,
  runTendencyHigh: 0.6, runTendencyLow: 0.4,
  tendencyBoost: 1.4,
} as const;

export type Bucket =
  | '1st-10' | '2nd-short' | '2nd-long'
  | '3rd-short' | '3rd-medium' | '3rd-long'
  | 'red-zone' | 'goal-to-go' | 'two-min-trailing' | 'four-min-leading';

/** Offensive tag weights per situation bucket — the run/pass mix lives here. */
export const TAG_WEIGHTS: Record<Bucket, Partial<Record<PlayTag, number>>> = {
  '1st-10': {
    'run-inside': 1.15, 'run-outside': 0.95, draw: 0.3,
    quick: 0.75, medium: 0.85, deep: 0.4, screen: 0.3, 'play-action': 0.55,
  },
  '2nd-short': {
    'run-inside': 1.35, 'run-outside': 1.05,
    quick: 0.6, medium: 0.5, deep: 0.35, 'play-action': 0.6,
  },
  '2nd-long': {
    'run-inside': 0.55, 'run-outside': 0.5, draw: 0.55,
    quick: 0.7, medium: 1.0, deep: 0.6, screen: 0.5, 'play-action': 0.5,
  },
  '3rd-short': {
    'run-inside': 1.6, 'run-outside': 1.0,
    quick: 0.8, medium: 0.2, 'play-action': 0.4, 'goal-line': 0.7,
  },
  '3rd-medium': {
    quick: 1.0, medium: 1.1, deep: 0.3, screen: 0.4, 'run-outside': 0.3,
  },
  '3rd-long': {
    medium: 1.2, deep: 0.8, quick: 0.5, screen: 0.4, draw: 0.2,
  },
  'red-zone': {
    'run-inside': 1.0, quick: 1.0, medium: 0.7, 'goal-line': 0.6,
    'play-action': 0.6, deep: 0.15, 'run-outside': 0.6,
  },
  'goal-to-go': {
    'goal-line': 1.3, 'run-inside': 1.1, quick: 0.9, 'play-action': 0.5,
  },
  'two-min-trailing': {
    quick: 1.1, medium: 1.2, deep: 0.7, screen: 0.3,
    'run-inside': 0.15, 'run-outside': 0.2,
  },
  'four-min-leading': {
    'run-inside': 1.4, 'run-outside': 1.0, draw: 0.4,
    quick: 0.4, medium: 0.25, 'play-action': 0.35,
  },
};

/** Defensive tag weights per situation bucket. */
export const DEF_TAG_WEIGHTS: Record<Bucket, Partial<Record<DefPlayTag, number>>> = {
  '1st-10': { zone: 0.9, man: 0.8, blitz: 0.4, contain: 0.5, 'run-commit': 0.3 },
  '2nd-short': { 'run-commit': 0.8, man: 0.7, zone: 0.7, blitz: 0.5 },
  '2nd-long': { zone: 1.0, man: 0.7, blitz: 0.5, contain: 0.4 },
  '3rd-short': { 'run-commit': 1.0, blitz: 0.9, man: 0.8, zone: 0.4 },
  '3rd-medium': { zone: 1.0, man: 0.9, blitz: 0.7 },
  '3rd-long': { zone: 1.1, blitz: 0.7, man: 0.6, prevent: 0.3 },
  'red-zone': { man: 1.0, zone: 0.8, blitz: 0.6, 'run-commit': 0.5 },
  'goal-to-go': { 'run-commit': 1.0, man: 0.9, blitz: 0.6 },
  'two-min-trailing': { prevent: 1.0, zone: 1.0, contain: 0.6, man: 0.5, blitz: 0.2 },
  'four-min-leading': { 'run-commit': 1.0, blitz: 0.8, man: 0.7, zone: 0.5 },
};
