// Shared scaffolding for the sim-core suites: a scripted RNG and a snapped
// PlayState you can pose by hand.

import { createInitialState } from '../../src/sim/GameSim';
import {
  GamePhase,
  type GameConfig, type GameState, type OffensivePlayDef, type DefensivePlayDef,
  type PlayState, type TeamRoster, type TeamSide,
} from '../../src/sim/types';
import { Rng, makeRngSet, type RngSet } from '../../src/sim/rng';
import { buildPlayState } from '../../src/sim/roster';
import { ext } from '../../src/sim/rules/ext';
import { defaultOutcome } from '../../src/sim/phases/outcome';
import { lineToGainY } from '../../src/sim/rules/downs';
import { CENTER_X } from '../../src/sim/constants';
import { allDefensivePlays, allOffensivePlays } from '../../src/data/plays/index';
import { makeTestRoster } from '../harness/fixtures';

/** Rng whose uniform stream and gaussian draws are fully scripted. */
export class ScriptRng extends Rng {
  private uniforms: number[];
  private gaussians: number[];
  private ui = 0;
  private gi = 0;

  constructor(uniforms: number[] = [0.5], gaussians: number[] = [0]) {
    super(1);
    this.uniforms = uniforms;
    this.gaussians = gaussians;
  }

  override next(): number {
    const v = this.uniforms[this.ui % this.uniforms.length];
    this.ui++;
    return v ?? 0.5;
  }

  override gauss(): number {
    const v = this.gaussians[this.gi % this.gaussians.length];
    this.gi++;
    return v ?? 0;
  }
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

export function testRosters(seed = 1): [TeamRoster, TeamRoster] {
  return [makeTestRoster('HOM', seed), makeTestRoster('AWY', seed + 1)];
}

export function findOffensePlay(pred: (p: OffensivePlayDef) => boolean): OffensivePlayDef {
  const found = allOffensivePlays().find(pred);
  if (found === undefined) throw new Error('no offensive play matched');
  return found;
}

export function findDefensePlay(pred: (p: DefensivePlayDef) => boolean): DefensivePlayDef {
  const found = allDefensivePlays().find(pred);
  if (found === undefined) throw new Error('no defensive play matched');
  return found;
}

export interface Scenario {
  state: GameState;
  play: PlayState;
  rng: RngSet;
}

export interface ScenarioOpts {
  offense?: TeamSide;
  ballOnY?: number;
  down?: number;
  toGo?: number;
  offensePlay?: OffensivePlayDef;
  defensePlay?: DefensivePlayDef;
  config?: Partial<GameConfig>;
}

/** A fully snapped PLAY_LIVE state you can pose for a micro-sim assertion. */
export function makeScenario(opts: ScenarioOpts = {}): Scenario {
  const offense: TeamSide = opts.offense ?? 0;
  const ballOnY = opts.ballOnY ?? 50;
  const state = createInitialState(testConfig(opts.config), testRosters(), 42);
  state.phase = GamePhase.PLAY_LIVE;
  state.possession = offense;
  state.ballOnY = ballOnY;
  state.down = opts.down ?? 1;
  state.toGo = opts.toGo ?? 10;
  state.nextPlayKind = 'normal';

  const off = opts.offensePlay ?? findOffensePlay((p) => p.type === 'pass');
  const def = opts.defensePlay ?? findDefensePlay((p) => p.shell !== 'specialTeams');
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
  e.whistleTick = 100000;

  return { state, play, rng: makeRngSet(42) };
}

/** Give the ball to a player index. */
export function giveBall(sc: Scenario, idx: number): void {
  for (const pl of sc.play.players) pl.hasBall = false;
  const p = sc.play.players[idx];
  if (p === undefined) throw new Error(`no player at ${idx}`);
  p.hasBall = true;
  sc.play.ball.carrierIdx = idx;
  sc.play.ball.mode = 'held';
  sc.play.ball.pos2 = { x: p.pos2.x, y: p.pos2.y };
  sc.play.ball.z = 1.1;
  ext(sc.state).lastCarrierIdx = idx;
}

export function place(sc: Scenario, idx: number, x: number, y: number, facing = Math.PI / 2): void {
  const p = sc.play.players[idx];
  if (p === undefined) throw new Error(`no player at ${idx}`);
  p.pos2 = { x, y };
  p.facing = facing;
}

/** First index on a side matching a predicate. */
export function indexWhere(play: PlayState, pred: (i: number) => boolean, from = 0, to = 22): number {
  for (let i = from; i < to; i++) if (pred(i)) return i;
  return -1;
}
