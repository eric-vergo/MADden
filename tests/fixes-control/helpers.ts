// Scaffolding for the live-play / play-call user-control regression suites.
// Everything here poses REAL sim state and drives the real phase handlers; no
// behaviour is re-implemented.

import { GameSim, createInitialState } from '../../src/sim/GameSim';
import {
  GameAction, GamePhase,
  type GameConfig, type InputFrame, type PlayState, type TeamSide,
} from '../../src/sim/types';
import type { SimCommand, SimEvent, TickInput } from '../../src/sim/events';
import { makeRngSet, type RngSet } from '../../src/sim/rng';
import { buildPlayState } from '../../src/sim/roster';
import { ext } from '../../src/sim/rules/ext';
import { defaultOutcome } from '../../src/sim/phases/outcome';
import { lineToGainY } from '../../src/sim/rules/downs';
import { CENTER_X } from '../../src/sim/constants';
import { allDefensivePlays, allOffensivePlays } from '../../src/data/plays/index';
import { makeTestRoster } from '../harness/fixtures';

export function frame(over: Partial<InputFrame> = {}): InputFrame {
  return {
    held: new Set<GameAction>(),
    pressed: new Set<GameAction>(),
    released: new Set<GameAction>(),
    move: { x: 0, y: 0 },
    ...over,
  };
}

export function testConfig(over: Partial<GameConfig> = {}): GameConfig {
  return {
    quarterLengthSec: 300,
    difficulty: 'allPro',
    userTeam: null,
    allowTies: true,
    penaltiesEnabled: true,
    enableOnside: false,
    ...over,
  };
}

export function testRosters(seed = 1): [ReturnType<typeof makeTestRoster>, ReturnType<typeof makeTestRoster>] {
  return [makeTestRoster('HOM', seed), makeTestRoster('AWY', seed + 1)];
}

export interface Posed {
  state: ReturnType<typeof createInitialState>;
  play: PlayState;
  rng: RngSet;
}

export interface PoseOpts {
  offense?: TeamSide;
  ballOnY?: number;
  offensePlayId?: string;
  defensePlayId?: string;
  config?: Partial<GameConfig>;
  /** Flip attackDir so team 0 attacks -y (the Q2/Q4 orientation). */
  flipEnds?: boolean;
}

/** A snapped PLAY_LIVE state built from real play data. */
export function pose(opts: PoseOpts = {}): Posed {
  const offense: TeamSide = opts.offense ?? 0;
  const ballOnY = opts.ballOnY ?? 50;
  const state = createInitialState(testConfig(opts.config), testRosters(), 42);
  if (opts.flipEnds === true) {
    state.attackDir = [-1, 1];
  }
  state.phase = GamePhase.PLAY_LIVE;
  state.possession = offense;
  state.ballOnY = ballOnY;
  state.nextPlayKind = 'normal';

  const off = opts.offensePlayId === undefined
    ? allOffensivePlays().find((p) => p.type === 'pass')
    : allOffensivePlays().find((p) => p.id === opts.offensePlayId);
  const def = opts.defensePlayId === undefined
    ? allDefensivePlays().find((p) => p.shell !== 'specialTeams')
    : allDefensivePlays().find((p) => p.id === opts.defensePlayId);
  if (off === undefined || def === undefined) throw new Error('play not found');

  const dir = state.attackDir[offense];
  const play = buildPlayState(state, off, def, {
    offense,
    dir,
    spot: { x: CENTER_X, y: ballOnY },
    firstDownY: lineToGainY(ballOnY, state.toGo, dir),
    controlledIdx: -1,
  });
  play.snapTick = 0;
  state.play = play;

  const e = ext(state);
  e.playOffense = offense;
  e.ballOnX = CENTER_X;
  e.prePlay = {
    down: state.down,
    toGo: state.toGo,
    ballOnY,
    possession: offense,
    quarter: 1,
    clockSec: state.clockSec,
    lineToGainY: lineToGainY(ballOnY, state.toGo, dir),
  };
  e.outcome = defaultOutcome(state, play);
  e.whistleTick = 1_000_000;

  return { state, play, rng: makeRngSet(42) };
}

/** Index of the player carrying `assignment.kind`, or -1. */
export function indexOfAssignment(play: PlayState, kind: string): number {
  for (let i = 0; i < play.players.length; i++) {
    if (play.players[i]?.assignment.kind === kind) return i;
  }
  return -1;
}

export function indexOfRole(play: PlayState, role: string): number {
  for (let i = 0; i < play.players.length; i++) {
    if (play.players[i]?.role === role) return i;
  }
  return -1;
}

/** Advance a GameSim to the first tick where `pred` holds (or throw). */
export function runUntil(
  sim: GameSim,
  pred: (sim: GameSim) => boolean,
  maxTicks: number,
  step?: (sim: GameSim) => TickInput,
): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < maxTicks; t++) {
    if (pred(sim)) return out;
    const input: TickInput = step?.(sim) ?? { frame: frame(), commands: [] as SimCommand[] };
    for (const ev of sim.tick(input)) out.push(ev);
  }
  if (!pred(sim)) throw new Error('runUntil: predicate never held');
  return out;
}
