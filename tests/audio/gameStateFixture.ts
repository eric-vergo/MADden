// Minimal GameState builder for AudioDirector specs. Deliberately does NOT go
// through GameSim/createInitialState: the director only reads scoreboard-level
// fields, and this keeps the audio tests independent of the phase handlers
// other workstreams are still landing.

import {
  GamePhase,
  type GameState, type GameStats, type TeamGameStats, type TeamRoster,
} from '../../src/sim/types';
import { makeTestRoster } from '../harness/fixtures';

function emptyTeamStats(teamId: string): TeamGameStats {
  return {
    teamId,
    points: 0, totalYds: 0, passYds: 0, rushYds: 0,
    firstDowns: 0, thirdDownConv: 0, thirdDownAtt: 0,
    turnovers: 0, penalties: 0, penaltyYds: 0,
    topSeconds: 0, sacksAllowed: 0,
  };
}

function emptyStats(rosters: [TeamRoster, TeamRoster]): GameStats {
  return {
    teams: [emptyTeamStats(rosters[0].teamId), emptyTeamStats(rosters[1].teamId)],
    players: {},
    scoringByQuarter: [[0, 0, 0, 0], [0, 0, 0, 0]],
  };
}

const ROSTERS: [TeamRoster, TeamRoster] = [
  makeTestRoster('HOM', 1),
  makeTestRoster('AWY', 2),
];

/** Neutral mid-field, Q1, tied — no situational crowd boost is active. */
export function makeState(over: Partial<GameState> = {}): GameState {
  const base: GameState = {
    seed: 1,
    tick: 0,
    phase: GamePhase.PLAY_LIVE,
    config: {
      quarterLengthSec: 300,
      difficulty: 'pro',
      userTeam: 0,
      allowTies: true,
      penaltiesEnabled: true,
      enableOnside: true,
    },
    rosters: ROSTERS,
    score: [0, 0],
    quarter: 1,
    clockSec: 300,
    playClockSec: 40,
    clockRunning: true,
    possession: 0,
    down: 1,
    toGo: 10,
    ballOnY: 60,
    attackDir: [1, -1],
    timeouts: [3, 3],
    twoMinuteFired: [false, false],
    nextPlayKind: 'normal',
    play: null,
    coin: { winner: null, receivingFirstHalf: null, overtime: false },
    pendingPenalty: null,
    selectedOffensePlayId: null,
    selectedDefensePlayId: null,
    otPossessions: [false, false],
    stats: emptyStats(ROSTERS),
    playLog: [],
  };
  return { ...base, ...over };
}
