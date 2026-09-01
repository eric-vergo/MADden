// Minimal GameState / PlayState fixtures for scripted AI scenarios.
// Slots 0–10 are offense, 11–21 defense (PlayState contract); any slot not
// given a spec is filled with a parked, incapacitated player so it cannot
// influence nearest-player queries.

import { createInitialState } from '../../src/sim/GameSim';
import {
  GamePhase,
  type Assignment, type Difficulty, type GameConfig, type GameState,
  type OffensivePlayDef, type DefensivePlayDef, type PlayState, type Position,
  type Ratings, type RoleId, type SimPlayer, type TeamSide,
} from '../../src/sim/types';
import type { SimEvent } from '../../src/sim/events';
import { Rng } from '../../src/sim/rng';
import { makeTestRoster } from '../harness/fixtures';
import { getDefensivePlay, getFormation, getOffensivePlay } from '../../src/data/plays/index';
import { makeCtx, type AiCtx } from '../../src/sim/ai/index';

export const BASE_RATINGS: Ratings = {
  spd: 75, acc: 75, agi: 75, str: 75, awr: 75, cth: 75, car: 75,
  btk: 75, elu: 75, thp: 75, tha: 75, tak: 75, hpw: 75, pbk: 75,
  rbk: 75, shd: 75, mcv: 75, zcv: 75, kpw: 75, kac: 75,
};

export interface PlayerSpec {
  slot: number; // 0..21
  role: RoleId;
  pos?: Position;
  team?: TeamSide;
  x: number;
  y: number;
  assignment: Assignment;
  ratings?: Partial<Ratings>;
  hasBall?: boolean;
}

export interface ScenarioOpts {
  players: PlayerSpec[];
  offensePlay?: Partial<OffensivePlayDef>;
  defensePlay?: Partial<DefensivePlayDef>;
  los?: number;
  firstDownY?: number;
  difficulty?: Difficulty;
  seed?: number;
  controlledIdx?: number;
  ballAt?: { x: number; y: number };
}

function parked(slot: number): SimPlayer {
  const team: TeamSide = slot <= 10 ? 0 : 1;
  return {
    athleteId: `park-${slot}`,
    jersey: 90 + (slot % 10),
    pos: 'OL',
    team,
    role: (slot <= 10 ? 'LT' : 'LE') as RoleId,
    ratings: { ...BASE_RATINGS },
    pos2: { x: 52.5, y: team === 0 ? 0.5 : 119.5 },
    vel: { x: 0, y: 0 },
    facing: 0,
    anim: 'down',
    stateTimer: 99999,
    assignment: { kind: 'idle' },
    engagedWith: null,
    hasBall: false,
    fatigue: 0,
    mind: {},
  };
}

export function makeSimPlayer(spec: PlayerSpec): SimPlayer {
  const team: TeamSide = spec.team ?? (spec.slot <= 10 ? 0 : 1);
  return {
    athleteId: `p-${spec.slot}`,
    jersey: 10 + spec.slot,
    pos: spec.pos ?? 'WR',
    team,
    role: spec.role,
    ratings: { ...BASE_RATINGS, ...spec.ratings },
    pos2: { x: spec.x, y: spec.y },
    vel: { x: 0, y: 0 },
    facing: 0,
    anim: 'idle',
    stateTimer: 0,
    assignment: spec.assignment,
    engagedWith: null,
    hasBall: spec.hasBall ?? false,
    fatigue: 0,
    mind: {},
  };
}

export const DEFAULT_OFF_PLAY: OffensivePlayDef = {
  id: 'test-off',
  name: 'Test Offense',
  formationId: 'gun-2x2',
  type: 'pass',
  tags: ['medium'],
  assignments: {},
};

export const DEFAULT_DEF_PLAY: DefensivePlayDef = {
  id: 'test-def',
  name: 'Test Defense',
  formationId: '43-base',
  shell: 'cover3',
  tags: ['zone'],
  assignments: {},
};

export interface Scenario {
  state: GameState;
  play: PlayState;
  rng: Rng;
  events: SimEvent[];
  ctx(): AiCtx;
  /** Advance the absolute tick counter (physics is driven by the brains). */
  tick(): void;
  idx(role: RoleId): number;
}

export function makeScenario(opts: ScenarioOpts): Scenario {
  const seed = opts.seed ?? 7;
  const config: GameConfig = {
    quarterLengthSec: 300,
    difficulty: opts.difficulty ?? 'allPro',
    userTeam: null,
    allowTies: true,
    penaltiesEnabled: true,
    enableOnside: false,
  };
  const state = createInitialState(
    config,
    [makeTestRoster('HOM', seed), makeTestRoster('AWY', seed + 1)],
    seed,
  );
  state.phase = GamePhase.PLAY_LIVE;
  state.possession = 0;
  state.nextPlayKind = 'normal';

  const los = opts.los ?? 60;
  state.ballOnY = los;

  const players: SimPlayer[] = [];
  for (let i = 0; i < 22; i++) players.push(parked(i));
  for (const spec of opts.players) players[spec.slot] = makeSimPlayer(spec);

  // Derive the offensive play's assignment map from the specs so the AI's
  // "declared assignment" lookups (eligibility, rushers, carriers) work.
  const offAssign: OffensivePlayDef['assignments'] = { ...(opts.offensePlay?.assignments ?? {}) };
  const defAssign: DefensivePlayDef['assignments'] = { ...(opts.defensePlay?.assignments ?? {}) };
  for (const spec of opts.players) {
    if (spec.slot <= 10) {
      if (offAssign[spec.role] === undefined) {
        offAssign[spec.role] = spec.assignment as never;
      }
    } else if (defAssign[spec.role] === undefined) {
      defAssign[spec.role] = spec.assignment as never;
    }
  }

  const offensePlay: OffensivePlayDef = {
    ...DEFAULT_OFF_PLAY,
    ...opts.offensePlay,
    assignments: offAssign,
  };
  const defensePlay: DefensivePlayDef = {
    ...DEFAULT_DEF_PLAY,
    ...opts.defensePlay,
    assignments: defAssign,
  };

  const ballPos = opts.ballAt ?? { x: 26.6, y: los };
  const play: PlayState = {
    offensePlay,
    defensePlay,
    players,
    ball: {
      pos2: { x: ballPos.x, y: ballPos.y },
      z: 0,
      vel: { x: 0, y: 0 },
      vz: 0,
      mode: 'held',
      carrierIdx: null,
      targetIdx: null,
      lastTouchTeam: 0,
    },
    lineOfScrimmageY: los,
    firstDownY: opts.firstDownY ?? los + 10,
    snapTick: 0,
    controlledIdx: opts.controlledIdx ?? -1,
    flags: [],
    deadReason: null,
    progressY: null,
    resultSpotY: null,
    kickMeter: { active: false, startTick: 0, powerLockTick: null, accuracyLockTick: null, aimOffset: 0 },
  };
  state.play = play;
  state.tick = 0;

  const rng = new Rng(seed);
  const events: SimEvent[] = [];

  // Latch alignments before anyone moves.
  for (const p of players) {
    p.mind['aiAlignX'] = p.pos2.x;
    p.mind['aiAlignY'] = p.pos2.y;
    p.mind['aiAligned'] = 1;
  }

  return {
    state,
    play,
    rng,
    events,
    ctx: () => makeCtx(state, rng, events) as AiCtx,
    tick: () => { state.tick++; },
    idx: (role: RoleId) => players.findIndex((p) => p.role === role),
  };
}

// ---------------------------------------------------------------------------
// Full 22-man scenario built from the real playbook
// ---------------------------------------------------------------------------

const OFF_ROLE_ORDER: RoleId[] = [
  'QB', 'RB', 'FB', 'WR1', 'WR2', 'WR3', 'WR4', 'WR5',
  'TE1', 'TE2', 'LT', 'LG', 'C', 'RG', 'RT', 'K', 'P', 'H',
];
const DEF_ROLE_ORDER: RoleId[] = [
  'LE', 'DT1', 'DT2', 'RE', 'LOLB', 'MLB1', 'MLB2', 'ROLB',
  'CB1', 'CB2', 'CB3', 'CB4', 'FS', 'SS', 'S3', 'KR', 'PR',
];

function positionForRole(role: RoleId): Position {
  if (role === 'QB') return 'QB';
  if (role === 'RB' || role === 'FB') return 'RB';
  if (role.startsWith('WR') || role === 'KR' || role === 'PR') return 'WR';
  if (role.startsWith('TE')) return 'TE';
  if (role === 'K') return 'K';
  if (role === 'P' || role === 'H') return 'P';
  if (role === 'LE' || role === 'RE' || role.startsWith('DT')) return 'DL';
  if (role.endsWith('LB')) return 'LB';
  if (role.startsWith('CB')) return 'CB';
  if (role === 'FS' || role === 'SS' || role === 'S3') return 'S';
  return 'OL';
}

export interface FullScenarioOpts {
  offensePlayId: string;
  defensePlayId: string;
  los?: number;
  dir?: 1 | -1;
  difficulty?: Difficulty;
  seed?: number;
  controlledIdx?: number;
}

/** Build a live 22-man scenario straight out of the playbook data. */
export function makeFullScenario(opts: FullScenarioOpts): Scenario {
  const off = getOffensivePlay(opts.offensePlayId);
  const def = getDefensivePlay(opts.defensePlayId);
  if (!off) throw new Error(`unknown offensive play ${opts.offensePlayId}`);
  if (!def) throw new Error(`unknown defensive play ${opts.defensePlayId}`);
  const offForm = getFormation(off.formationId);
  const defForm = getFormation(def.formationId);
  if (!offForm) throw new Error(`unknown formation ${off.formationId}`);
  if (!defForm) throw new Error(`unknown formation ${def.formationId}`);

  const los = opts.los ?? 60;
  const dir = opts.dir ?? 1;
  const ballX = 26.6;
  const players: PlayerSpec[] = [];

  let slot = 0;
  for (const role of OFF_ROLE_ORDER) {
    if (slot > 10) break;
    const a = offForm.alignments[role];
    const assign = off.assignments[role];
    if (!a || !assign) continue;
    players.push({
      slot,
      role,
      pos: positionForRole(role),
      team: 0,
      x: ballX + a.x * dir,
      y: los + a.y * dir,
      assignment: assign as PlayerSpec['assignment'],
    });
    slot++;
  }
  slot = 11;
  for (const role of DEF_ROLE_ORDER) {
    if (slot > 21) break;
    const a = defForm.alignments[role];
    const assign = def.assignments[role];
    if (!a || !assign) continue;
    players.push({
      slot,
      role,
      pos: positionForRole(role),
      team: 1,
      x: ballX + a.x * dir,
      y: los + a.y * dir,
      assignment: assign as PlayerSpec['assignment'],
    });
    slot++;
  }

  const s = makeScenario({
    players,
    los,
    difficulty: opts.difficulty,
    seed: opts.seed,
    controlledIdx: opts.controlledIdx,
    ballAt: { x: ballX, y: los },
    offensePlay: off,
    defensePlay: def,
  });
  s.state.attackDir = dir === 1 ? [1, -1] : [-1, 1];
  return s;
}

/** Hold a player still at a scripted spot (bypasses his own brain). */
export function place(p: SimPlayer, x: number, y: number, vx = 0, vy = 0): void {
  p.pos2.x = x;
  p.pos2.y = y;
  p.vel.x = vx;
  p.vel.y = vy;
}
