// Pure season reducer. Every function takes a SeasonState and returns a NEW
// SeasonState — no mutation of the input, no I/O, no clock. The save layer
// serializes whatever comes out of here.

import type { Difficulty, PlayerGameStats } from '../sim/types';
import type {
  GameResultLite, PlayerSeasonStats, PlayoffBracket, ScheduledGame,
  SeasonPhase, SeasonState, StandingRow, StoredBoxScore, Team,
} from './types';
import { generateLeague } from './league';
import { REGULAR_SEASON_WEEKS, findTeamGame, gamesInWeek, generateSchedule } from './schedule';
import { computeStandings, sortStandings, type SortContext } from './standings';
import {
  APEX_BOWL_WEEK, CONF_FINAL_WEEK, SEMIS_WEEK, advance, championOf, createBracket,
} from './playoffs';
import { simGame } from './quickSim';
import { req, sortedKeys } from './util';

export const PLAYOFF_WEEKS: readonly number[] = [SEMIS_WEEK, CONF_FINAL_WEEK, APEX_BOWL_WEEK];

export interface SeasonAwards {
  mvpAthleteId: string | null;
  mvpTeamId: string | null;
  mvpScore: number;
  champion: string | null;
}

export type LeaderCategory =
  | 'passYds' | 'passTD' | 'rushYds' | 'rushTD' | 'recYds' | 'recTD'
  | 'tackles' | 'sacks' | 'defInt' | 'fgm';

export interface LeaderEntry {
  athleteId: string;
  teamId: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createSeason(
  leagueSeed: number,
  userTeamId: string,
  difficulty: Difficulty,
  seasonIndex = 0,
): SeasonState {
  const league = generateLeague(leagueSeed, seasonIndex);
  const schedule = generateSchedule(leagueSeed, seasonIndex, league.teams);
  return {
    league,
    userTeamId,
    difficulty,
    schedule,
    currentWeek: 1,
    phase: 'regular',
    bracket: null,
    seasonStats: {},
    recentBoxScores: [],
    champion: null,
  };
}

export function startNewSeason(state: Readonly<SeasonState>): SeasonState {
  return createSeason(
    state.league.leagueSeed,
    state.userTeamId,
    state.difficulty,
    state.league.seasonIndex + 1,
  );
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function sortContext(state: Readonly<SeasonState>): SortContext {
  return {
    leagueSeed: state.league.leagueSeed,
    seasonIndex: state.league.seasonIndex,
    schedule: state.schedule,
    maxWeek: REGULAR_SEASON_WEEKS,
  };
}

export function standingsOf(state: Readonly<SeasonState>): StandingRow[] {
  const rows = computeStandings(state.league.teams, state.schedule, REGULAR_SEASON_WEEKS);
  return sortStandings(rows, sortContext(state));
}

export function currentWeekGames(state: Readonly<SeasonState>): ScheduledGame[] {
  return gamesInWeek(state.schedule, state.currentWeek);
}

export function userGame(state: Readonly<SeasonState>, week = state.currentWeek): ScheduledGame | null {
  return findTeamGame(state.schedule, week, state.userTeamId);
}

/** True once every game in the current week has a result. */
export function weekComplete(state: Readonly<SeasonState>): boolean {
  const games = currentWeekGames(state);
  if (games.length === 0) return false;
  for (let i = 0; i < games.length; i++) {
    if (req(games, i).result === undefined) return false;
  }
  return true;
}

export function userGameResolved(state: Readonly<SeasonState>): boolean {
  const g = userGame(state);
  return g === null || g.result !== undefined;
}

export function teamIdOfAthlete(state: Readonly<SeasonState>, athleteId: string): string {
  const teams = state.league.teams;
  for (let i = 0; i < teams.length; i++) {
    const t = req(teams, i);
    const roster = t.roster;
    for (let j = 0; j < roster.athletes.length; j++) {
      if (req(roster.athletes, j).id === athleteId) return t.identity.id;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function athleteTeamIndex(teams: readonly Team[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < teams.length; i++) {
    const t = req(teams, i);
    for (let j = 0; j < t.roster.athletes.length; j++) {
      map.set(req(t.roster.athletes, j).id, t.identity.id);
    }
  }
  return map;
}

function emptySeasonStats(athleteId: string, teamId: string): PlayerSeasonStats {
  return {
    athleteId, teamId, gamesPlayed: 0,
    passAtt: 0, passCmp: 0, passYds: 0, passTD: 0, passInt: 0,
    rushAtt: 0, rushYds: 0, rushTD: 0, fumbles: 0,
    tgt: 0, rec: 0, recYds: 0, recTD: 0,
    tackles: 0, sacks: 0, defInt: 0, ffum: 0,
    fgm: 0, fga: 0, xpm: 0, xpa: 0,
    punts: 0, puntYds: 0,
    krYds: 0, prYds: 0, retTD: 0,
  };
}

/** Numeric stat keys shared by PlayerGameStats and PlayerSeasonStats. */
type CountingStat = Exclude<keyof PlayerGameStats, 'athleteId'>;

const ACCUMULATED: readonly CountingStat[] = [
  'passAtt', 'passCmp', 'passYds', 'passTD', 'passInt',
  'rushAtt', 'rushYds', 'rushTD', 'fumbles',
  'tgt', 'rec', 'recYds', 'recTD',
  'tackles', 'sacks', 'defInt', 'ffum',
  'fgm', 'fga', 'xpm', 'xpa',
  'punts', 'puntYds', 'krYds', 'prYds', 'retTD',
];

function accumulate(
  seasonStats: Record<string, PlayerSeasonStats>,
  box: Readonly<StoredBoxScore>,
  teamOf: ReadonlyMap<string, string>,
): Record<string, PlayerSeasonStats> {
  const out: Record<string, PlayerSeasonStats> = { ...seasonStats };
  const ids = sortedKeys(box.stats.players); // fixed order — Records are never walked raw
  for (let i = 0; i < ids.length; i++) {
    const id = req(ids, i);
    const game = box.stats.players[id];
    if (game === undefined) continue;
    const prev = out[id];
    const next = prev !== undefined
      ? { ...prev }
      : emptySeasonStats(id, teamOf.get(id) ?? '');
    next.gamesPlayed += 1;
    for (let k = 0; k < ACCUMULATED.length; k++) {
      const key = req(ACCUMULATED, k);
      next[key] += game[key];
    }
    out[id] = next;
  }
  return out;
}

/** Bounded: keep every user-team box plus everything from the newest week. */
function pruneBoxes(
  boxes: readonly StoredBoxScore[],
  userGameIds: ReadonlySet<string>,
): StoredBoxScore[] {
  let latest = 0;
  for (let i = 0; i < boxes.length; i++) latest = Math.max(latest, req(boxes, i).week);
  const out: StoredBoxScore[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = req(boxes, i);
    if (b.week === latest || userGameIds.has(b.gameId)) out.push(b);
  }
  return out;
}

function userGameIdsOf(state: Readonly<SeasonState>): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < state.schedule.length; i++) {
    const g = req(state.schedule, i);
    if (g.homeId === state.userTeamId || g.awayId === state.userTeamId) ids.add(g.id);
  }
  return ids;
}

function rebuildBracket(
  bracket: PlayoffBracket | null,
  schedule: readonly ScheduledGame[],
): PlayoffBracket | null {
  if (bracket === null) return null;
  const games: ScheduledGame[] = [];
  for (let i = 0; i < schedule.length; i++) {
    const g = req(schedule, i);
    if (g.week >= SEMIS_WEEK) games.push(g);
  }
  return { seeds: bracket.seeds, games };
}

function applyResult(
  schedule: readonly ScheduledGame[],
  gameId: string,
  result: GameResultLite,
): ScheduledGame[] {
  const out: ScheduledGame[] = [];
  for (let i = 0; i < schedule.length; i++) {
    const g = req(schedule, i);
    out.push(g.id === gameId ? { ...g, result } : g);
  }
  return out;
}

export function resultFromBox(box: Readonly<StoredBoxScore>, ot = false): GameResultLite {
  return {
    homeScore: req(box.stats.teams, 0).points,
    awayScore: req(box.stats.teams, 1).points,
    ot,
  };
}

// ---------------------------------------------------------------------------
// Mutations (pure)
// ---------------------------------------------------------------------------

/** Record a completed game (live-played or quick-simmed) into the season. */
export function recordGame(
  state: Readonly<SeasonState>,
  box: Readonly<StoredBoxScore>,
  result: GameResultLite,
): SeasonState {
  const schedule = applyResult(state.schedule, box.gameId, result);
  const teamOf = athleteTeamIndex(state.league.teams);
  const stored: StoredBoxScore = { ...box };
  const boxes = pruneBoxes([...state.recentBoxScores, stored], userGameIdsOf(state));
  return {
    ...state,
    schedule,
    bracket: rebuildBracket(state.bracket, schedule),
    seasonStats: accumulate(state.seasonStats, stored, teamOf),
    recentBoxScores: boxes,
  };
}

/** The user's live game finished: box score comes from the engine (simmed=false). */
export function recordUserGame(
  state: Readonly<SeasonState>,
  box: Readonly<StoredBoxScore>,
  ot = false,
): SeasonState {
  return recordGame(state, box, resultFromBox(box, ot));
}

/** Quick-sim one scheduled game. */
export function simOne(state: Readonly<SeasonState>, game: Readonly<ScheduledGame>): SeasonState {
  if (game.result !== undefined) return state as SeasonState;
  const outcome = simGame(state.league.leagueSeed, game, state.league.teams);
  return recordGame(state, outcome.box, outcome.result);
}

/** SIM MY GAME — quick-sims the user's matchup for the current week. */
export function simMyGame(state: Readonly<SeasonState>): SeasonState {
  const g = userGame(state);
  if (g === null || g.result !== undefined) return state as SeasonState;
  return simOne(state, g);
}

/** SIM WEEK — quick-sims every unplayed game in the current week. */
export function simWeek(state: Readonly<SeasonState>): SeasonState {
  let next: SeasonState = state as SeasonState;
  const games = currentWeekGames(state);
  for (let i = 0; i < games.length; i++) {
    const g = req(games, i);
    if (g.result !== undefined) continue;
    next = simOne(next, g);
  }
  return next;
}

/** Seed the bracket from the final regular-season standings and open week 15. */
export function enterPlayoffs(state: Readonly<SeasonState>): SeasonState {
  if (state.phase !== 'regular') return state as SeasonState;
  const rows = computeStandings(state.league.teams, state.schedule, REGULAR_SEASON_WEEKS);
  const bracket = createBracket(state.league.teams, rows, sortContext(state), state.league.seasonIndex);
  const schedule = [...state.schedule, ...bracket.games];
  return {
    ...state,
    schedule,
    bracket: rebuildBracket(bracket, schedule),
    currentWeek: SEMIS_WEEK,
    phase: 'playoffs' as SeasonPhase,
  };
}

/**
 * Close the current week. Regular season rolls forward (and seeds the playoffs
 * after week 14); playoff weeks generate the next round from the winners.
 */
export function advanceWeek(state: Readonly<SeasonState>): SeasonState {
  if (!weekComplete(state)) return state as SeasonState;

  if (state.phase === 'regular') {
    if (state.currentWeek < REGULAR_SEASON_WEEKS) {
      return { ...state, currentWeek: state.currentWeek + 1 };
    }
    return enterPlayoffs(state);
  }

  if (state.phase === 'playoffs' && state.bracket !== null) {
    if (state.currentWeek >= APEX_BOWL_WEEK) {
      return {
        ...state,
        phase: 'complete' as SeasonPhase,
        champion: championOf(state.bracket),
      };
    }
    const nextBracket = advance(state.bracket, state.bracket.games, state.league.seasonIndex);
    const known = new Set<string>();
    for (let i = 0; i < state.schedule.length; i++) known.add(req(state.schedule, i).id);
    const schedule = state.schedule.slice();
    for (let i = 0; i < nextBracket.games.length; i++) {
      const g = req(nextBracket.games, i);
      if (!known.has(g.id)) schedule.push(g);
    }
    return {
      ...state,
      schedule,
      bracket: rebuildBracket(nextBracket, schedule),
      currentWeek: state.currentWeek + 1,
    };
  }

  return state as SeasonState;
}

// ---------------------------------------------------------------------------
// Awards & leaders
// ---------------------------------------------------------------------------

export function mvpScore(s: Readonly<PlayerSeasonStats>): number {
  return 2 * s.passTD + s.passYds / 25 + 6 * (s.rushTD + s.recTD) + (s.rushYds + s.recYds) / 10;
}

export function seasonAwards(state: Readonly<SeasonState>): SeasonAwards {
  const ids = sortedKeys(state.seasonStats);
  let bestId: string | null = null;
  let bestTeam: string | null = null;
  let best = -Infinity;
  for (let i = 0; i < ids.length; i++) {
    const id = req(ids, i);
    const s = state.seasonStats[id];
    if (s === undefined) continue;
    const score = mvpScore(s);
    if (score > best) {
      best = score;
      bestId = id;
      bestTeam = s.teamId;
    }
  }
  return {
    mvpAthleteId: bestId,
    mvpTeamId: bestTeam,
    mvpScore: bestId === null ? 0 : best,
    champion: state.champion,
  };
}

export function leaders(
  state: Readonly<SeasonState>,
  category: LeaderCategory,
  limit = 10,
): LeaderEntry[] {
  const ids = sortedKeys(state.seasonStats);
  const rows: LeaderEntry[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = req(ids, i);
    const s = state.seasonStats[id];
    if (s === undefined) continue;
    const value = s[category];
    if (value <= 0) continue;
    rows.push({ athleteId: id, teamId: s.teamId, value });
  }
  rows.sort((a, b) => (b.value - a.value) || (a.athleteId < b.athleteId ? -1 : a.athleteId > b.athleteId ? 1 : 0));
  return rows.slice(0, limit);
}
