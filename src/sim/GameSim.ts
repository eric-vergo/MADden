// Deterministic 60Hz game simulation orchestrator.
// tick() is the ONLY mutator; state is exposed Readonly to the outside.

import {
  GamePhase,
  type GameConfig, type GameState, type GameStats, type TeamRoster,
  type TickSnapshot, type PlayerSnap, type TeamGameStats,
} from './types';
import type { SimEvent, TickInput } from './events';
import { makeRngSet, type RngSet } from './rng';
import { hashGameState } from './hash';
import { PHASE_HANDLERS } from './phases/index';

function emptyTeamStats(teamId: string): TeamGameStats {
  return {
    teamId,
    points: 0, totalYds: 0, passYds: 0, rushYds: 0,
    firstDowns: 0, thirdDownConv: 0, thirdDownAtt: 0,
    turnovers: 0, penalties: 0, penaltyYds: 0,
    topSeconds: 0, sacksAllowed: 0,
  };
}

export function emptyGameStats(rosters: [TeamRoster, TeamRoster]): GameStats {
  return {
    teams: [emptyTeamStats(rosters[0].teamId), emptyTeamStats(rosters[1].teamId)],
    players: {},
    scoringByQuarter: [[0, 0, 0, 0], [0, 0, 0, 0]],
  };
}

export function createInitialState(
  config: GameConfig,
  rosters: [TeamRoster, TeamRoster],
  seed: number,
): GameState {
  return {
    seed,
    tick: 0,
    phase: GamePhase.COIN_TOSS,
    config,
    rosters,
    score: [0, 0],
    quarter: 1,
    clockSec: config.quarterLengthSec,
    playClockSec: 40,
    clockRunning: false,
    possession: 0,
    down: 1,
    toGo: 10,
    ballOnY: 60,
    attackDir: [1, -1], // home attacks +y (toward y=110) in Q1
    timeouts: [3, 3],
    twoMinuteFired: [false, false],
    nextPlayKind: 'kickoff',
    play: null,
    coin: { winner: null, receivingFirstHalf: null, overtime: false },
    pendingPenalty: null,
    selectedOffensePlayId: null,
    selectedDefensePlayId: null,
    otPossessions: [false, false],
    stats: emptyGameStats(rosters),
    playLog: [],
  };
}

export class GameSim {
  private readonly _state: GameState;
  readonly rng: RngSet;

  constructor(config: GameConfig, rosters: [TeamRoster, TeamRoster], seed: number) {
    this._state = createInitialState(config, rosters, seed);
    this.rng = makeRngSet(seed);
  }

  get state(): Readonly<GameState> {
    return this._state;
  }

  /** Advance exactly one tick (1/60s). Returns the events emitted this tick. */
  tick(input: TickInput): readonly SimEvent[] {
    const s = this._state;
    if (s.phase === GamePhase.GAME_OVER) return [];
    const events: SimEvent[] = [];
    const before = s.phase;
    PHASE_HANDLERS[s.phase](s, input, this.rng, events);
    if (s.phase !== before) {
      events.push({ type: 'PHASE_CHANGE', tick: s.tick, from: before, to: s.phase });
    }
    s.tick++;
    return events;
  }

  snapshot(): TickSnapshot {
    const s = this._state;
    const p = s.play;
    const players: PlayerSnap[] = p
      ? p.players.map((pl, i) => ({
          x: pl.pos2.x, y: pl.pos2.y, facing: pl.facing, anim: pl.anim,
          hasBall: pl.hasBall, team: pl.team, jersey: pl.jersey,
          controlled: i === p.controlledIdx,
        }))
      : [];
    return {
      tick: s.tick,
      phase: s.phase,
      players,
      ball: p
        ? { x: p.ball.pos2.x, y: p.ball.pos2.y, z: p.ball.z, mode: p.ball.mode }
        : null,
      lineOfScrimmageY: p ? p.lineOfScrimmageY : null,
      firstDownY: p ? p.firstDownY : null,
      kickMeter: p && p.kickMeter.active ? { ...p.kickMeter } : null,
    };
  }

  hash(): number {
    return hashGameState(this._state);
  }
}
