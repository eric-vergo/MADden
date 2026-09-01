// Scaffolding for the rules/accounting regression suites: pose a finished play
// and run exactly one PLAY_DEAD resolution over it.

import {
  GamePhase,
  type GameConfig, type GameState, type OffensivePlayDef, type PlayState, type TeamSide,
} from '../../src/sim/types';
import { emptyTickInput, type SimEvent } from '../../src/sim/events';
import { ext, type PlayOutcome } from '../../src/sim/rules/ext';
import { defaultOutcome } from '../../src/sim/phases/outcome';
import { playDeadPhase } from '../../src/sim/phases/playDead';
import { lineToGainY } from '../../src/sim/rules/downs';
import type { Dir } from '../../src/sim/transform';
import { makeScenario } from '../sim-core/helpers';

export interface DeadBallSetup {
  offense?: TeamSide;
  /** Pre-play spot (world y). */
  ballOnY?: number;
  down?: number;
  toGo?: number;
  quarter?: number;
  score?: [number, number];
  otPossessions?: [boolean, boolean];
  attackDir?: [Dir, Dir];
  offensePlay?: OffensivePlayDef;
  config?: Partial<GameConfig>;
  /** Events the live play emitted (stats consume these). */
  playEvents?: SimEvent[];
}

export interface DeadBallRun {
  state: GameState;
  play: PlayState;
  events: SimEvent[];
  /** The same object PLAY_DEAD mutated. */
  outcome: PlayOutcome;
}

/**
 * Build a snapped play, hand PLAY_DEAD a finished outcome, and resolve it once.
 * The dead-ball pause is not consumed, so `ext(state).afterDead` still holds the
 * phase the sim decided to route to.
 */
export function runDeadBall(
  setup: DeadBallSetup = {},
  patch: Partial<PlayOutcome> = {},
): DeadBallRun {
  const offense: TeamSide = setup.offense ?? 0;
  const ballOnY = setup.ballOnY ?? 50;
  const sc = makeScenario({
    offense,
    ballOnY,
    down: setup.down,
    toGo: setup.toGo,
    offensePlay: setup.offensePlay,
    config: setup.config,
  });
  const s = sc.state;
  if (setup.attackDir !== undefined) s.attackDir = [setup.attackDir[0], setup.attackDir[1]];
  s.quarter = setup.quarter ?? 1;
  if (setup.score !== undefined) s.score = [setup.score[0], setup.score[1]];
  if (setup.otPossessions !== undefined) {
    s.otPossessions = [setup.otPossessions[0], setup.otPossessions[1]];
  }

  const e = ext(s);
  const dir = s.attackDir[offense];
  e.prePlay = {
    down: s.down,
    toGo: s.toGo,
    ballOnY,
    possession: offense,
    quarter: s.quarter,
    clockSec: s.clockSec,
    lineToGainY: lineToGainY(ballOnY, s.toGo, dir),
  };
  e.playEvents = setup.playEvents ?? [];

  const outcome: PlayOutcome = { ...defaultOutcome(s, sc.play), spotY: ballOnY, ...patch };
  e.outcome = outcome;

  s.phase = GamePhase.PLAY_DEAD;
  e.phaseEnteredTick = s.tick;
  e.phaseInit = false;

  const events: SimEvent[] = [];
  playDeadPhase(s, emptyTickInput(), sc.rng, events);
  return { state: s, play: sc.play, events, outcome };
}

/** The phase PLAY_DEAD decided to route to (it has not routed yet). */
export function afterDeadOf(s: GameState): GamePhase | null {
  return ext(s).afterDead;
}
