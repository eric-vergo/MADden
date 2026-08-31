// Role -> athlete resolution and construction of the 22 SimPlayers for a snap.
// Everything here is a pure function of (TeamRoster, FormationDef, play defs).
// Iteration order is fixed by the canonical role arrays below — never by
// Object.keys — so player indices are stable across runs.

import type {
  Assignment, Athlete, Ball, DefRoleId, DefensivePlayDef, FormationDef, GameState,
  OffRoleId, OffensivePlayDef, PlayState, Position, Ratings, RoleId, SimPlayer,
  TeamRoster, TeamSide, Vec2,
} from './types';
import { getFormation } from '../data/plays/index';
import { clampFieldX, clampFieldY, toWorld, type Dir } from './transform';

/** Canonical offensive slot order — index into PlayState.players is 0..10. */
export const OFF_ROLE_ORDER: readonly OffRoleId[] = [
  'QB', 'RB', 'FB', 'WR1', 'WR2', 'WR3', 'WR4', 'WR5', 'TE1', 'TE2',
  'LT', 'LG', 'C', 'RG', 'RT', 'K', 'P', 'H',
];

/** Canonical defensive slot order — index into PlayState.players is 11..21. */
export const DEF_ROLE_ORDER: readonly DefRoleId[] = [
  'LE', 'DT1', 'DT2', 'RE', 'LOLB', 'MLB1', 'MLB2', 'ROLB',
  'CB1', 'CB2', 'CB3', 'CB4', 'FS', 'SS', 'S3', 'KR', 'PR',
];

/** Where a role looks first on the depth chart: [position, depth index]. */
const ROLE_SLOT: Record<RoleId, readonly [Position, number]> = {
  QB: ['QB', 0], RB: ['RB', 0], FB: ['RB', 1],
  WR1: ['WR', 0], WR2: ['WR', 1], WR3: ['WR', 2], WR4: ['WR', 3], WR5: ['WR', 4],
  TE1: ['TE', 0], TE2: ['TE', 1],
  LT: ['OL', 0], LG: ['OL', 1], C: ['OL', 2], RG: ['OL', 3], RT: ['OL', 4],
  K: ['K', 0], P: ['P', 0], H: ['QB', 1],
  LE: ['DL', 0], DT1: ['DL', 1], DT2: ['DL', 2], RE: ['DL', 3],
  LOLB: ['LB', 0], MLB1: ['LB', 1], MLB2: ['LB', 3], ROLB: ['LB', 2],
  CB1: ['CB', 0], CB2: ['CB', 1], CB3: ['CB', 2], CB4: ['CB', 3],
  FS: ['S', 0], SS: ['S', 1], S3: ['S', 2],
  KR: ['RB', 1], PR: ['WR', 2],
};

/** Deterministic fallback chain when a depth slot is empty. */
const POS_FALLBACK: Record<Position, readonly Position[]> = {
  QB: ['WR', 'RB', 'TE', 'K', 'P'],
  RB: ['TE', 'WR', 'LB', 'OL'],
  WR: ['TE', 'RB', 'CB', 'S'],
  TE: ['WR', 'OL', 'RB'],
  OL: ['TE', 'DL', 'LB'],
  DL: ['LB', 'OL', 'TE'],
  LB: ['DL', 'S', 'CB'],
  CB: ['S', 'WR', 'LB'],
  S: ['CB', 'LB', 'WR'],
  K: ['P', 'QB', 'WR'],
  P: ['K', 'QB', 'WR'],
};

const ALL_POSITIONS: readonly Position[] = [
  'QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P',
];

function athleteById(roster: TeamRoster, id: string | undefined): Athlete | undefined {
  if (id === undefined) return undefined;
  for (let i = 0; i < roster.athletes.length; i++) {
    const a = roster.athletes[i];
    if (a !== undefined && a.id === id) return a;
  }
  return undefined;
}

/**
 * Resolve a play-slot role to a concrete athlete. `used` holds ids already
 * fielded on this snap so a thin depth chart never puts a man in two places.
 */
export function resolveRoleAthlete(
  roster: TeamRoster,
  role: RoleId,
  used: Set<string>,
): Athlete {
  // Returners come off the dedicated returner slots first.
  if (role === 'KR' || role === 'PR') {
    const id = role === 'KR' ? roster.returners.kr : roster.returners.pr;
    const a = athleteById(roster, id);
    if (a !== undefined && !used.has(a.id)) return a;
  }
  const slot = ROLE_SLOT[role];
  const primary = slot[0];
  const wantIdx = slot[1];

  const tryPos = (pos: Position, startIdx: number): Athlete | undefined => {
    const list = roster.depth[pos];
    for (let i = startIdx; i < list.length; i++) {
      const a = athleteById(roster, list[i]);
      if (a !== undefined && !used.has(a.id)) return a;
    }
    for (let i = 0; i < Math.min(startIdx, list.length); i++) {
      const a = athleteById(roster, list[i]);
      if (a !== undefined && !used.has(a.id)) return a;
    }
    return undefined;
  };

  const exact = tryPos(primary, wantIdx);
  if (exact !== undefined) return exact;

  for (const pos of POS_FALLBACK[primary]) {
    const a = tryPos(pos, 0);
    if (a !== undefined) return a;
  }
  for (const pos of ALL_POSITIONS) {
    const a = tryPos(pos, 0);
    if (a !== undefined) return a;
  }
  // Last resort: reuse someone rather than crash the sim.
  const first = roster.athletes[0];
  if (first !== undefined) return first;
  return SYNTHETIC_ATHLETE;
}

const SYNTHETIC_RATINGS: Ratings = {
  spd: 60, acc: 60, agi: 60, str: 60, awr: 60, cth: 60, car: 60, btk: 60,
  elu: 60, thp: 60, tha: 60, tak: 60, hpw: 60, pbk: 60, rbk: 60, shd: 60,
  mcv: 60, zcv: 60, kpw: 60, kac: 60,
};

const SYNTHETIC_ATHLETE: Athlete = {
  id: 'SYNTH-0', firstName: 'Empty', lastName: 'Slot', jersey: 0,
  pos: 'WR', age: 25, ratings: SYNTHETIC_RATINGS, overall: 60,
};

/** Roles a formation actually uses, in canonical order. */
export function formationRoles(f: FormationDef): RoleId[] {
  const order: readonly RoleId[] = f.side === 'O' ? OFF_ROLE_ORDER : DEF_ROLE_ORDER;
  const out: RoleId[] = [];
  for (const role of order) {
    if (f.alignments[role] !== undefined) out.push(role);
  }
  return out;
}

function makePlayer(
  a: Athlete,
  team: TeamSide,
  role: RoleId,
  world: Vec2,
  dir: Dir,
  assignment: Assignment,
): SimPlayer {
  return {
    athleteId: a.id,
    jersey: a.jersey,
    pos: a.pos,
    team,
    role,
    ratings: { ...a.ratings },
    pos2: { x: clampFieldX(world.x), y: clampFieldY(world.y) },
    vel: { x: 0, y: 0 },
    facing: dir === 1 ? Math.PI / 2 : -Math.PI / 2,
    anim: 'idle',
    stateTimer: 0,
    assignment,
    engagedWith: null,
    hasBall: false,
    fatigue: 0,
    mind: {},
  };
}

/**
 * Build one 11-man unit at its formation alignment. `dir` is the OFFENSE's
 * attack direction for both units (defense mirrors through the same
 * transform, which is why defensive alignments are authored with dy > 0).
 */
export function buildUnit(
  roster: TeamRoster,
  team: TeamSide,
  formation: FormationDef,
  assignments: Partial<Record<RoleId, Assignment>>,
  dir: Dir,
  spot: Vec2,
): SimPlayer[] {
  const used = new Set<string>();
  const roles = formationRoles(formation);
  const players: SimPlayer[] = [];
  for (const role of roles) {
    if (players.length >= 11) break;
    const align = formation.alignments[role] as Vec2 | undefined;
    if (align === undefined) continue;
    const a = resolveRoleAthlete(roster, role, used);
    used.add(a.id);
    const assignment = (assignments[role] ?? { kind: 'idle' }) as Assignment;
    players.push(makePlayer(a, team, role, toWorld(align, dir, spot), dir, assignment));
  }
  // Formations should carry exactly 11; pad defensively rather than crash.
  let pad = 0;
  while (players.length < 11) {
    const role: RoleId = formation.side === 'O' ? 'WR5' : 'CB4';
    const a = resolveRoleAthlete(roster, role, used);
    used.add(a.id);
    const off: Vec2 = { x: (pad % 2 === 0 ? -1 : 1) * (8 + pad), y: formation.side === 'O' ? -2 : 6 };
    players.push(makePlayer(a, team, role, toWorld(off, dir, spot), dir, { kind: 'idle' }));
    pad++;
  }
  return players;
}

export interface BuildPlayOpts {
  offense: TeamSide;
  dir: Dir;
  spot: Vec2; // world ball spot (LOS)
  firstDownY: number;
  controlledIdx: number;
}

/** Assemble a full 22-man PlayState with the ball dead at the LOS. */
export function buildPlayState(
  state: GameState,
  off: OffensivePlayDef,
  def: DefensivePlayDef,
  opts: BuildPlayOpts,
): PlayState {
  const offFormation = getFormation(off.formationId);
  const defFormation = getFormation(def.formationId);
  const offRoster = state.rosters[opts.offense];
  const defTeam: TeamSide = opts.offense === 0 ? 1 : 0;
  const defRoster = state.rosters[defTeam];

  const offPlayers = offFormation
    ? buildUnit(offRoster, opts.offense, offFormation,
        off.assignments as Partial<Record<RoleId, Assignment>>, opts.dir, opts.spot)
    : [];
  const defPlayers = defFormation
    ? buildUnit(defRoster, defTeam, defFormation,
        def.assignments as Partial<Record<RoleId, Assignment>>, opts.dir, opts.spot)
    : [];

  const players = [...offPlayers, ...defPlayers];

  const ball: Ball = {
    pos2: { x: opts.spot.x, y: opts.spot.y },
    z: 0,
    vel: { x: 0, y: 0 },
    vz: 0,
    mode: 'dead',
    carrierIdx: null,
    targetIdx: null,
    lastTouchTeam: opts.offense,
  };

  return {
    offensePlay: off,
    defensePlay: def,
    players,
    ball,
    lineOfScrimmageY: opts.spot.y,
    firstDownY: opts.firstDownY,
    snapTick: -1,
    controlledIdx: opts.controlledIdx,
    flags: [],
    deadReason: null,
    progressY: null,
    resultSpotY: null,
    kickMeter: { active: false, startTick: -1, powerLockTick: null, accuracyLockTick: null, aimOffset: 0 },
  };
}

/** First player index whose role matches, or -1. */
export function findRole(play: PlayState, role: RoleId): number {
  for (let i = 0; i < play.players.length; i++) {
    const p = play.players[i];
    if (p !== undefined && p.role === role) return i;
  }
  return -1;
}

/** Index of the player currently holding the ball, or -1. */
export function carrierIndex(play: PlayState): number {
  const c = play.ball.carrierIdx;
  return c === null ? -1 : c;
}
