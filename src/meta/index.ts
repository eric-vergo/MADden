// Public barrel for the meta layer (league / schedule / standings / playoffs /
// quick-sim / season reducer). Pure — seeded Rng only, no clock, no storage.

export * from './types';
export {
  LEAGUE_GEN, computeOverall, computeTeamRatings, computeTiers, findTeam,
  generateLeague, athleteById, ovrTier, peakRating, seasonSeed, starterIds,
  starterOvrs,
} from './league';
export type { TeamRatingSummary } from './league';
export {
  GAMES_PER_WEEK, REGULAR_SEASON_WEEKS, divisionGroups, divisionKey, findTeamGame,
  gameId, gamesInWeek, generateSchedule,
} from './schedule';
export {
  computeStandings, conferenceStandings, divisionStandings, divWinPct, findRow,
  headToHead, pointDiff, sortStandings, winPct,
} from './standings';
export type { SortContext } from './standings';
export {
  APEX_BOWL_WEEK, CONF_FINAL_WEEK, SEMIS_WEEK, advance, championOf, createBracket,
  isNeutralSite, seedConference, seedPlayoffs, winnerOf,
} from './playoffs';
export { QUICK_SIM, emptyPlayerStats, emptyTeamStats, simGame, unitRatings } from './quickSim';
export type { QuickSimOutcome, UnitRatings } from './quickSim';
export {
  PLAYOFF_WEEKS, advanceWeek, createSeason, currentWeekGames, enterPlayoffs, leaders,
  mvpScore, recordGame, recordUserGame, resultFromBox, seasonAwards, simMyGame,
  simOne, simWeek, sortContext, standingsOf, startNewSeason, teamIdOfAthlete,
  userGame, userGameResolved, weekComplete,
} from './seasonState';
export type { LeaderCategory, LeaderEntry, SeasonAwards } from './seasonState';
export { TEAM_IDENTITIES } from './placeholderData';
