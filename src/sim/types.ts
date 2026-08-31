// ★ FROZEN CONTRACT — the master type file every module codes against.
// Changes after Phase 0 must be append-only (new members, new union variants).
// Pure data types only: no DOM, no classes with side effects.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  y: number;
}

/** 0 = home (defends low y at game start), 1 = away. */
export type TeamSide = 0 | 1;

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'DL' | 'LB' | 'CB' | 'S' | 'K' | 'P';

export type Difficulty = 'rookie' | 'pro' | 'allPro' | 'allMadden';

// ---------------------------------------------------------------------------
// Ratings & rosters
// ---------------------------------------------------------------------------

/** All ratings 40–99. */
export interface Ratings {
  spd: number; // top speed
  acc: number; // acceleration
  agi: number; // agility / change of direction
  str: number; // strength
  awr: number; // awareness (AI decision quality)
  cth: number; // catching
  car: number; // carrying / ball security
  btk: number; // break tackle
  elu: number; // elusiveness (juke/spin checks)
  thp: number; // throw power
  tha: number; // throw accuracy
  tak: number; // tackling
  hpw: number; // hit power
  pbk: number; // pass block
  rbk: number; // run block
  shd: number; // block shedding
  mcv: number; // man coverage
  zcv: number; // zone coverage
  kpw: number; // kick power (kicks + punts)
  kac: number; // kick accuracy / punt placement
}

export type RatingKey = keyof Ratings;

export interface Athlete {
  id: string; // stable, e.g. "ASH-12"
  firstName: string;
  lastName: string;
  jersey: number;
  pos: Position;
  age: number; // cosmetic
  ratings: Ratings;
  overall: number; // cached per-position weighted OVR
}

export interface TeamColors {
  primary: string; // hex
  secondary: string; // hex
}

/**
 * Everything the sim needs to field a team. Produced by the meta layer
 * (league generation) or by test fixtures.
 * `depth` lists athlete ids best-first per position; role→athlete resolution
 * (e.g. 'WR3' → depth.WR[2]) is a pure helper in the sim.
 */
export interface TeamRoster {
  teamId: string;
  city: string;
  nickname: string;
  abbrev: string; // 3 letters
  colors: TeamColors;
  athletes: Athlete[];
  depth: Record<Position, string[]>;
  /** Kick/punt returner athlete ids. */
  returners: { kr: string; pr: string };
}

// ---------------------------------------------------------------------------
// Play data model (authored in src/data/plays/*, normalized frame:
// offense drives +y, x is offset from the ball spot, +x = offense's right).
// ---------------------------------------------------------------------------

/** Play-slot role ids. A formation picks which ~11 of these it uses per side. */
export type OffRoleId =
  | 'QB' | 'RB' | 'FB'
  | 'WR1' | 'WR2' | 'WR3' | 'WR4' | 'WR5'
  | 'TE1' | 'TE2'
  | 'LT' | 'LG' | 'C' | 'RG' | 'RT'
  | 'K' | 'P' | 'H'; // kicker, punter, holder (special teams)

export type DefRoleId =
  | 'LE' | 'DT1' | 'DT2' | 'RE'
  | 'LOLB' | 'MLB1' | 'MLB2' | 'ROLB'
  | 'CB1' | 'CB2' | 'CB3' | 'CB4'
  | 'FS' | 'SS' | 'S3'
  | 'KR' | 'PR'; // returners on receiving special-teams units

export type RoleId = OffRoleId | DefRoleId;

export type GapId =
  | 'A-left' | 'A-right'
  | 'B-left' | 'B-right'
  | 'C-left' | 'C-right'
  | 'D-left' | 'D-right';

export type ZoneName =
  | 'deepThird-L' | 'deepThird-M' | 'deepThird-R'
  | 'deepHalf-L' | 'deepHalf-R'
  | 'deepQuarter-1' | 'deepQuarter-2' | 'deepQuarter-3' | 'deepQuarter-4'
  | 'curlFlat-L' | 'curlFlat-R'
  | 'hook-L' | 'hook-M' | 'hook-R'
  | 'flat-L' | 'flat-R';

export interface RouteWaypoint {
  /** Offset from the player's ALIGNMENT spot, normalized frame. */
  dx: number;
  dy: number;
  breakStyle: 'sharp' | 'rounded';
  /** Route pacing: aim to reach this waypoint ~tick N post-snap. */
  atTick?: number;
  thenAction?: 'settle' | 'lookForBall' | 'blockNearest';
}

export interface Route {
  waypoints: RouteWaypoint[];
  /** Convert to quick slant vs a detected blitz. */
  hot?: boolean;
  /** At final break, sit in the soft spot between zone defenders. */
  vsZoneSettle?: boolean;
}

export type RunScheme = 'zone-left' | 'zone-right' | 'gap';
export type RunBlockTarget = 'playside-gap' | 'backside' | 'pull-lead' | 'climb';

export type OffAssignment =
  | { kind: 'route'; route: Route; primary?: boolean }
  | { kind: 'passBlock' }
  | { kind: 'passProScan'; checkRoute?: Route } // RB check-release
  | { kind: 'runBlock'; scheme: RunScheme; target?: RunBlockTarget }
  | { kind: 'leadBlock'; throughGap: GapId }
  | {
      kind: 'carry';
      mesh: 'handoff' | 'pitch';
      meshTick: number; // ticks post-snap when the exchange happens
      path: RouteWaypoint[];
      aimGap: GapId;
    }
  | {
      kind: 'qb';
      drop: {
        type: '1step' | '3step' | '5step' | 'gunSet' | 'bootLeft' | 'bootRight' | 'sneak' | 'kneel' | 'spike';
        depth: number; // yards behind LOS
      };
    }
  | { kind: 'kick'; style: 'kickoff' | 'punt' | 'placekick' }
  | { kind: 'hold' }; // FG/XP holder

export type ManTarget =
  | 'WR1' | 'WR2' | 'WR3' | 'WR4' | 'WR5' | 'TE1' | 'TE2' | 'RB'
  | 'count-1-left' | 'count-1-right' | 'count-2-left' | 'count-2-right';

export type DefAssignment =
  | { kind: 'man'; target: ManTarget; leverage: 'inside' | 'outside'; cushionYd: number }
  | { kind: 'zone'; zone: ZoneName }
  | { kind: 'rush'; lane: 'edge-left' | 'edge-right' | 'interior-left' | 'interior-right'; contain?: boolean }
  | { kind: 'blitz'; gap: GapId; timing: 'snap' | 'delayed' }
  | { kind: 'spy' }
  | { kind: 'runFit'; gap: GapId }
  | { kind: 'coverLane'; laneIndex: number; contain?: boolean } // kick coverage lanes 0..9
  | { kind: 'returner' }
  | { kind: 'returnBlock' };

/** Dynamic assignments the sim swaps in mid-play (post-catch, pursuit, loose ball…). */
export type DynamicAssignment =
  | { kind: 'idle' }
  | { kind: 'pursuit' }
  | { kind: 'carrierAI' }
  | { kind: 'findBall' }
  | { kind: 'celebrate' };

export type Assignment = OffAssignment | DefAssignment | DynamicAssignment;

export interface FormationDef {
  id: string;
  side: 'O' | 'D';
  /** Exactly 11 roles with alignment offsets (normalized frame, dy<0 = behind LOS for offense). */
  alignments: Partial<Record<RoleId, Vec2>>;
  qbUnderCenter?: boolean;
  personnelLabel?: string; // e.g. "21", "11" — cosmetic
}

export type OffPlayType =
  | 'run' | 'pass' | 'playAction' | 'screen'
  | 'kickoff' | 'punt' | 'fieldGoal' | 'extraPoint' | 'twoPoint'
  | 'kneel' | 'spike';

export type PlayTag =
  | 'run-inside' | 'run-outside' | 'draw'
  | 'quick' | 'medium' | 'deep' | 'screen' | 'play-action'
  | 'goal-line' | 'clock-kill' | 'clock-save';

export interface OffensivePlayDef {
  id: string;
  name: string;
  formationId: string;
  type: OffPlayType;
  tags: PlayTag[];
  /** Special-teams "offense" (kicking team) uses DefAssignment coverLane etc. */
  assignments: Partial<Record<RoleId, OffAssignment | DefAssignment>>;
  /** Ordered reads for the CPU QB and user coach-cam hints. */
  qbProgression?: RoleId[];
  checkdown?: RoleId;
  playAction?: { fakeTo: RoleId; fakeTicks: number };
  screenTo?: RoleId;
}

export type CoverageShell = 'cover0' | 'cover1' | 'cover2' | 'cover3' | 'cover4' | 'cover2man' | 'goalLine' | 'specialTeams';

export type DefPlayTag = 'man' | 'zone' | 'blitz' | 'run-commit' | 'contain' | 'prevent';

export interface DefensivePlayDef {
  id: string;
  name: string;
  formationId: string;
  shell: CoverageShell;
  tags: DefPlayTag[];
  assignments: Partial<Record<RoleId, DefAssignment>>;
}

// ---------------------------------------------------------------------------
// Live play state
// ---------------------------------------------------------------------------

export type PlayerAnimState =
  | 'idle' | 'running' | 'backpedal' | 'blocking' | 'engaged'
  | 'diving' | 'stumbling' | 'down' | 'celebrating'
  | 'kicking' | 'throwing' | 'catching' | 'dragged';

export interface SimPlayer {
  athleteId: string;
  jersey: number;
  pos: Position;
  team: TeamSide;
  role: RoleId;
  ratings: Ratings; // denormalized copy — no lookups in the hot path
  pos2: Vec2; // world yards
  vel: Vec2; // yd/s
  facing: number; // radians, 0 = +x
  anim: PlayerAnimState;
  /** Ticks remaining in a forced state (stumble, down, stun). 0 = free. */
  stateTimer: number;
  assignment: Assignment;
  /** Index of engagement partner in PlayState.players, else null. */
  engagedWith: number | null;
  hasBall: boolean;
  fatigue: number; // 0..1 mild speed dampener
  /**
   * AI scratch memory (read timers, reaction buffers, cooldowns).
   * Numbers only; excluded from the determinism hash — behavior effects
   * show up in positions/velocities which ARE hashed.
   */
  mind: Record<string, number>;
}

export type BallMode = 'held' | 'pass' | 'kick' | 'punt' | 'pitch' | 'loose' | 'dead';

export interface Ball {
  pos2: Vec2;
  z: number; // height in yards, 0 = ground
  vel: Vec2;
  vz: number;
  mode: BallMode;
  carrierIdx: number | null; // index into PlayState.players
  targetIdx: number | null; // intended receiver on a pass
  lastTouchTeam: TeamSide;
}

export type PenaltyKind =
  | 'falseStart' | 'offside' | 'encroachment' | 'delayOfGame'
  | 'holding' | 'dpi' | 'opi';

export interface PenaltyFlag {
  kind: PenaltyKind;
  team: TeamSide; // offending team
  playerIdx: number | null;
  spotY: number; // world y where the foul occurred
  /** True for dead-ball/pre-snap fouls that kill the play immediately. */
  preSnap: boolean;
}

export type DeadReason =
  | 'tackle' | 'outOfBounds' | 'incomplete' | 'touchdown' | 'safety'
  | 'touchback' | 'fairCatch' | 'kickResolved' | 'fumbleDead'
  | 'kneel' | 'spike' | 'sack' | 'penaltyDead' | 'runnerDown';

export interface KickMeterState {
  active: boolean;
  startTick: number; // tick the meter started
  powerLockTick: number | null;
  accuracyLockTick: number | null;
  /** Aim direction offset in radians (user Left/Right pre-kick). */
  aimOffset: number;
}

export interface PlayState {
  offensePlay: OffensivePlayDef;
  defensePlay: DefensivePlayDef;
  /** Fixed length 22. Indices 0–10 = offense, 11–21 = defense. */
  players: SimPlayer[];
  ball: Ball;
  lineOfScrimmageY: number; // world y
  firstDownY: number; // world y of the sticks (or the goal line)
  snapTick: number; // absolute state.tick at the snap; -1 before snap
  /** User's controlled player index, -1 for none (CPU-vs-CPU). */
  controlledIdx: number;
  flags: PenaltyFlag[];
  deadReason: DeadReason | null;
  /** Forward-progress high-water spot (world y) for the current carrier. */
  progressY: number | null;
  /** Where the ball will be spotted after resolution (world y). */
  resultSpotY: number | null;
  kickMeter: KickMeterState;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export enum GamePhase {
  COIN_TOSS = 'COIN_TOSS',
  PLAY_CALL = 'PLAY_CALL',
  PRE_SNAP = 'PRE_SNAP',
  PLAY_LIVE = 'PLAY_LIVE',
  PLAY_DEAD = 'PLAY_DEAD',
  PENALTY_DECISION = 'PENALTY_DECISION',
  POINT_AFTER_CHOICE = 'POINT_AFTER_CHOICE',
  QUARTER_BREAK = 'QUARTER_BREAK',
  HALFTIME = 'HALFTIME',
  OVERTIME_TOSS = 'OVERTIME_TOSS',
  GAME_OVER = 'GAME_OVER',
}

export interface GameConfig {
  quarterLengthSec: number; // 180 / 300 / 420; tests may use 60
  difficulty: Difficulty;
  /** Which side the user controls; null = fully CPU-vs-CPU (headless). */
  userTeam: TeamSide | null;
  allowTies: boolean; // regular season true, playoffs false
  penaltiesEnabled: boolean;
  enableOnside: boolean;
  /** Neutral site (no home crowd bonus flavor). */
  neutralSite?: boolean;
}

export interface CoinTossState {
  winner: TeamSide | null;
  receivingFirstHalf: TeamSide | null;
  /** Set during OVERTIME_TOSS. */
  overtime: boolean;
}

export interface PendingPenaltyDecision {
  flag: PenaltyFlag;
  /** Team that gets to accept/decline (the non-offending team). */
  decidingTeam: TeamSide;
  /** Pre-computed outcomes for UI display and CPU EV choice. */
  acceptOutcome: PenaltyOutcome;
  declineOutcome: PenaltyOutcome;
}

export interface PenaltyOutcome {
  down: number;
  toGo: number;
  ballOnY: number;
  possession: TeamSide;
  firstDown: boolean;
  description: string; // "1st & 10 at MID 42"
}

// --- Stats (unified between live sim and meta quickSim) ---

export interface PlayerGameStats {
  athleteId: string;
  passAtt: number; passCmp: number; passYds: number; passTD: number; passInt: number;
  rushAtt: number; rushYds: number; rushTD: number; fumbles: number;
  tgt: number; rec: number; recYds: number; recTD: number;
  tackles: number; sacks: number; defInt: number; ffum: number;
  fgm: number; fga: number; xpm: number; xpa: number;
  punts: number; puntYds: number;
  krYds: number; prYds: number; retTD: number;
}

export interface TeamGameStats {
  teamId: string;
  points: number;
  totalYds: number; passYds: number; rushYds: number;
  firstDowns: number;
  thirdDownConv: number; thirdDownAtt: number;
  turnovers: number;
  penalties: number; penaltyYds: number;
  topSeconds: number; // time of possession
  sacksAllowed: number;
}

export interface GameStats {
  teams: [TeamGameStats, TeamGameStats];
  /** Keyed by athleteId; only athletes with any nonzero stat. */
  players: Record<string, PlayerGameStats>;
  scoringByQuarter: [number[], number[]]; // per team, index = quarter-1 (OT appended)
}

export interface PlayLogEntry {
  tick: number;
  quarter: number;
  clockSec: number;
  down: number;
  toGo: number;
  ballOnY: number;
  possession: TeamSide;
  offensePlayId: string;
  defensePlayId: string;
  /** Human-readable summary, filled by PlayByPlay from events. */
  text: string;
  yards: number;
  scoring: boolean;
  turnover: boolean;
}

export interface GameState {
  seed: number;
  tick: number; // absolute sim tick since construction
  phase: GamePhase;
  config: GameConfig;
  rosters: [TeamRoster, TeamRoster];
  score: [number, number];
  quarter: number; // 1–4, 5 = OT
  clockSec: number; // game clock, counts down
  playClockSec: number;
  clockRunning: boolean;
  possession: TeamSide;
  down: number; // 1–4
  toGo: number;
  ballOnY: number; // world y of the ball between plays
  /** Per-team attack direction: +1 = attacking high y. Swapped at quarter ends. */
  attackDir: [1 | -1, 1 | -1];
  timeouts: [number, number];
  twoMinuteFired: [boolean, boolean]; // per half
  /** Pending special situation: next play must be a kickoff / free kick / PAT. */
  nextPlayKind: 'normal' | 'kickoff' | 'freeKick' | 'pat' | null;
  play: PlayState | null; // non-null in PRE_SNAP / PLAY_LIVE / PLAY_DEAD
  coin: CoinTossState | null;
  pendingPenalty: PendingPenaltyDecision | null;
  /** Selected plays for the upcoming snap (set during PLAY_CALL). */
  selectedOffensePlayId: string | null;
  selectedDefensePlayId: string | null;
  /** OT bookkeeping: which teams have possessed in OT. */
  otPossessions: [boolean, boolean];
  stats: GameStats;
  playLog: PlayLogEntry[];
}

// ---------------------------------------------------------------------------
// Input (pure data — the DOM input layer produces these, sim consumes them)
// ---------------------------------------------------------------------------

export enum GameAction {
  Up = 'Up', Down = 'Down', Left = 'Left', Right = 'Right',
  Confirm = 'Confirm', Back = 'Back', Pause = 'Pause',
  Snap = 'Snap', Sprint = 'Sprint', Dive = 'Dive', Spin = 'Spin',
  Juke = 'Juke', StiffArm = 'StiffArm',
  Throw1 = 'Throw1', Throw2 = 'Throw2', Throw3 = 'Throw3', Throw4 = 'Throw4', Throw5 = 'Throw5',
  ThrowAway = 'ThrowAway', PumpFake = 'PumpFake',
  SwitchPlayer = 'SwitchPlayer', Timeout = 'Timeout', MeterPress = 'MeterPress',
  HardCount = 'HardCount', FairCatch = 'FairCatch',
  PageLeft = 'PageLeft', PageRight = 'PageRight',
}

export interface InputFrame {
  held: ReadonlySet<GameAction>;
  pressed: ReadonlySet<GameAction>; // went down since last tick
  released: ReadonlySet<GameAction>;
  /** Normalized movement vector from directional keys, magnitude ≤ 1. */
  move: Vec2;
}

export const EMPTY_INPUT_FRAME: InputFrame = {
  held: new Set<GameAction>(),
  pressed: new Set<GameAction>(),
  released: new Set<GameAction>(),
  move: { x: 0, y: 0 },
};

// ---------------------------------------------------------------------------
// Snapshots (render/replay view)
// ---------------------------------------------------------------------------

export interface PlayerSnap {
  x: number;
  y: number;
  facing: number;
  anim: PlayerAnimState;
  hasBall: boolean;
  team: TeamSide;
  jersey: number;
  controlled: boolean;
}

export interface TickSnapshot {
  tick: number;
  phase: GamePhase;
  players: PlayerSnap[]; // length 22 during a play, else 0
  ball: { x: number; y: number; z: number; mode: BallMode } | null;
  lineOfScrimmageY: number | null;
  firstDownY: number | null;
  kickMeter: KickMeterState | null;
}

export interface PlayManifest {
  startTick: number;
  description: string;
  bigPlay: boolean;
}
