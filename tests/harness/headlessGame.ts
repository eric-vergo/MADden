// Headless CPU-vs-CPU game driver. Runs GameSim tick-by-tick with empty user
// input; the sim's own CPU AI plays both sides (config.userTeam = null).

import { GameSim } from '../../src/sim/GameSim';
import { GamePhase, type GameConfig, type GameState, type TeamRoster } from '../../src/sim/types';
import { emptyTickInput, type SimEvent } from '../../src/sim/events';
import { makeTestRoster } from './fixtures';

export interface HeadlessGameOptions {
  seed: number;
  quarterLengthSec?: number;
  rosters?: [TeamRoster, TeamRoster];
  /** Hard tick cap so a broken sim can't hang the suite. */
  tickCap?: number;
  onEvent?: (e: SimEvent, state: Readonly<GameState>) => void;
}

export interface HeadlessGameResult {
  finalScore: [number, number];
  ticksElapsed: number;
  hitTickCap: boolean;
  events: SimEvent[];
  state: Readonly<GameState>;
  finalHash: number;
}

export function runHeadlessGame(opts: HeadlessGameOptions): HeadlessGameResult {
  const rosters: [TeamRoster, TeamRoster] = opts.rosters ?? [
    makeTestRoster('HOM', opts.seed),
    makeTestRoster('AWY', opts.seed + 1),
  ];
  const config: GameConfig = {
    quarterLengthSec: opts.quarterLengthSec ?? 300,
    difficulty: 'allPro',
    userTeam: null,
    allowTies: true,
    penaltiesEnabled: true,
    enableOnside: false,
  };
  const sim = new GameSim(config, rosters, opts.seed);
  const tickCap = opts.tickCap ?? 60 * 60 * 90; // 90 sim-minutes of ticks
  const events: SimEvent[] = [];

  let ticks = 0;
  while (sim.state.phase !== GamePhase.GAME_OVER && ticks < tickCap) {
    const emitted = sim.tick(emptyTickInput());
    for (const e of emitted) {
      events.push(e);
      opts.onEvent?.(e, sim.state);
    }
    ticks++;
  }

  return {
    finalScore: [sim.state.score[0], sim.state.score[1]],
    ticksElapsed: ticks,
    hitTickCap: ticks >= tickCap,
    events,
    state: sim.state,
    finalHash: sim.hash(),
  };
}
