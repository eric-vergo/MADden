import { describe, expect, it } from 'vitest';
import type { StoredBoxScore } from '../../src/meta/types';
import { emptyPlayerStats, emptyTeamStats } from '../../src/meta/quickSim';
import { REGULAR_SEASON_WEEKS } from '../../src/meta/schedule';
import { APEX_BOWL_WEEK, CONF_FINAL_WEEK, SEMIS_WEEK } from '../../src/meta/playoffs';
import {
  advanceWeek, createSeason, currentWeekGames, leaders, mvpScore, recordUserGame,
  seasonAwards, simMyGame, simWeek, standingsOf, startNewSeason, userGame,
  userGameResolved, weekComplete,
} from '../../src/meta/seasonState';
import type { SeasonState } from '../../src/meta/types';

const SEED = 246810;
const USER = 'ASH';

function newSeason(): SeasonState {
  return createSeason(SEED, USER, 'pro');
}

/** Play the regular season and postseason entirely through quickSim. */
function runFullSeason(start: SeasonState): SeasonState {
  let s = start;
  for (let w = 1; w <= REGULAR_SEASON_WEEKS; w++) {
    expect(s.currentWeek).toBe(w);
    expect(s.phase).toBe('regular');
    s = simWeek(s);
    expect(weekComplete(s)).toBe(true);
    s = advanceWeek(s);
  }
  expect(s.phase).toBe('playoffs');
  for (const w of [SEMIS_WEEK, CONF_FINAL_WEEK, APEX_BOWL_WEEK]) {
    expect(s.currentWeek).toBe(w);
    s = simWeek(s);
    s = advanceWeek(s);
  }
  return s;
}

describe('season creation', () => {
  const s = newSeason();

  it('starts at week 1 of the regular season with a full schedule', () => {
    expect(s.currentWeek).toBe(1);
    expect(s.phase).toBe('regular');
    expect(s.bracket).toBeNull();
    expect(s.champion).toBeNull();
    expect(s.schedule).toHaveLength(112);
    expect(s.league.teams).toHaveLength(16);
    expect(s.userTeamId).toBe(USER);
    expect(s.difficulty).toBe('pro');
    expect(Object.keys(s.seasonStats)).toHaveLength(0);
    expect(s.recentBoxScores).toHaveLength(0);
  });

  it('is deterministic', () => {
    expect(createSeason(SEED, USER, 'pro')).toEqual(newSeason());
  });

  it('finds the user matchup every week', () => {
    for (let w = 1; w <= REGULAR_SEASON_WEEKS; w++) {
      const g = userGame(s, w);
      expect(g, `week ${w}`).not.toBeNull();
      expect(g!.homeId === USER || g!.awayId === USER).toBe(true);
    }
  });
});

describe('week flow', () => {
  it('will not advance until every game in the week has a result', () => {
    const s = newSeason();
    expect(weekComplete(s)).toBe(false);
    expect(advanceWeek(s).currentWeek).toBe(1);
    const simmed = simWeek(s);
    expect(advanceWeek(simmed).currentWeek).toBe(2);
  });

  it('sims only the user game with SIM MY GAME', () => {
    const s = newSeason();
    expect(userGameResolved(s)).toBe(false);
    const after = simMyGame(s);
    expect(userGameResolved(after)).toBe(true);
    const resolved = currentWeekGames(after).filter((g) => g.result !== undefined);
    expect(resolved).toHaveLength(1);
    expect(weekComplete(after)).toBe(false);
    // Re-running is a no-op; the quick-sim result must not change.
    expect(simMyGame(after)).toEqual(after);
    expect(simWeek(after).schedule.filter((g) => g.week === 1 && g.result !== undefined)).toHaveLength(8);
  });

  it('does not mutate the input state', () => {
    const s = newSeason();
    const snapshot = JSON.stringify(s);
    simWeek(s);
    advanceWeek(simWeek(s));
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('accepts a live box score for the user game', () => {
    const s = newSeason();
    const g = userGame(s)!;
    const home = emptyTeamStats(g.homeId);
    const away = emptyTeamStats(g.awayId);
    home.points = 31;
    away.points = 17;
    const qb = s.league.teams.find((t) => t.identity.id === g.homeId)!.roster.depth.QB[0]!;
    const line = emptyPlayerStats(qb);
    line.passYds = 312;
    line.passTD = 4;
    const box: StoredBoxScore = {
      gameId: g.id,
      week: g.week,
      simmed: false,
      stats: { teams: [home, away], players: { [qb]: line }, scoringByQuarter: [[7, 10, 7, 7], [0, 7, 3, 7]] },
    };
    const after = recordUserGame(s, box);
    const stored = after.schedule.find((x) => x.id === g.id)!;
    expect(stored.result).toEqual({ homeScore: 31, awayScore: 17, ot: false });
    expect(after.seasonStats[qb]!.passYds).toBe(312);
    expect(after.seasonStats[qb]!.passTD).toBe(4);
    expect(after.seasonStats[qb]!.gamesPlayed).toBe(1);
    expect(after.recentBoxScores.some((b) => b.gameId === g.id && !b.simmed)).toBe(true);
  });
});

describe('full season end to end', () => {
  const finished = runFullSeason(newSeason());

  it('reaches a champion through the bracket', () => {
    expect(finished.phase).toBe('complete');
    expect(finished.champion).not.toBeNull();
    expect(finished.bracket).not.toBeNull();
    const seeds = finished.bracket!.seeds.map((s) => s.teamId);
    expect(seeds).toHaveLength(8);
    expect(seeds).toContain(finished.champion!);
    expect(finished.bracket!.games).toHaveLength(7); // 4 semis + 2 finals + Apex Bowl
    for (const g of finished.bracket!.games) expect(g.result).toBeDefined();
  });

  it('plays 112 regular-season games and 7 playoff games', () => {
    expect(finished.schedule).toHaveLength(119);
    for (const g of finished.schedule) expect(g.result).toBeDefined();
    const rows = standingsOf(finished);
    let played = 0;
    for (const r of rows) played += r.w + r.l + r.t;
    expect(played).toBe(224); // playoff games never enter the standings
  });

  it('keeps standings sorted and complete', () => {
    const rows = standingsOf(finished);
    expect(rows).toHaveLength(16);
    for (const r of rows) expect(r.w + r.l + r.t).toBe(14);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      expect(prev.w / 14).toBeGreaterThanOrEqual(cur.w / 14 - 1e-9);
    }
  });

  it('bounds recentBoxScores to user games plus the newest week', () => {
    const userIds = new Set(
      finished.schedule.filter((g) => g.homeId === USER || g.awayId === USER).map((g) => g.id),
    );
    const latest = Math.max(...finished.recentBoxScores.map((b) => b.week));
    for (const b of finished.recentBoxScores) {
      expect(b.week === latest || userIds.has(b.gameId)).toBe(true);
    }
    expect(finished.recentBoxScores.length).toBeLessThan(30);
  });

  it('aggregates season stats that match the aggregate of every box score', () => {
    const stats = finished.seasonStats;
    expect(Object.keys(stats).length).toBeGreaterThan(300);
    let passYds = 0;
    let passTD = 0;
    for (const id of Object.keys(stats)) {
      passYds += stats[id]!.passYds;
      passTD += stats[id]!.passTD;
      expect(stats[id]!.gamesPlayed).toBeGreaterThan(0);
      expect(stats[id]!.teamId).not.toBe('');
    }
    expect(passYds).toBeGreaterThan(0);
    expect(passTD).toBeGreaterThan(0);
  });

  it('produces top-10 leader boards sorted descending', () => {
    for (const cat of ['passYds', 'passTD', 'rushYds', 'rushTD', 'recYds', 'recTD', 'tackles', 'sacks', 'defInt', 'fgm'] as const) {
      const top = leaders(finished, cat);
      expect(top.length, cat).toBeGreaterThan(0);
      expect(top.length).toBeLessThanOrEqual(10);
      for (let i = 1; i < top.length; i++) {
        expect(top[i - 1]!.value).toBeGreaterThanOrEqual(top[i]!.value);
      }
      for (const e of top) expect(e.value).toBeGreaterThan(0);
    }
    // Deterministic ordering, not insertion-order dependent.
    expect(leaders(finished, 'passYds')).toEqual(leaders(finished, 'passYds'));
  });

  it('names an MVP with the design formula', () => {
    const awards = seasonAwards(finished);
    expect(awards.mvpAthleteId).not.toBeNull();
    expect(awards.champion).toBe(finished.champion);
    const best = finished.seasonStats[awards.mvpAthleteId!]!;
    expect(awards.mvpScore).toBeCloseTo(mvpScore(best), 9);
    for (const id of Object.keys(finished.seasonStats)) {
      expect(mvpScore(finished.seasonStats[id]!)).toBeLessThanOrEqual(awards.mvpScore + 1e-9);
    }
    expect(awards.mvpTeamId).toBe(best.teamId);
  });

  it('replays identically from the same seed', () => {
    const again = runFullSeason(newSeason());
    expect(again.champion).toBe(finished.champion);
    expect(again.schedule).toEqual(finished.schedule);
    expect(again.seasonStats).toEqual(finished.seasonStats);
  });
});

describe('rolling into a new season', () => {
  it('regenerates rosters and resets the season, keeping the user team', () => {
    const finished = runFullSeason(newSeason());
    const next = startNewSeason(finished);
    expect(next.league.seasonIndex).toBe(1);
    expect(next.league.leagueSeed).toBe(SEED);
    expect(next.userTeamId).toBe(USER);
    expect(next.difficulty).toBe(finished.difficulty);
    expect(next.currentWeek).toBe(1);
    expect(next.phase).toBe('regular');
    expect(next.champion).toBeNull();
    expect(next.bracket).toBeNull();
    expect(next.schedule).toHaveLength(112);
    expect(Object.keys(next.seasonStats)).toHaveLength(0);
    expect(next.recentBoxScores).toHaveLength(0);
    // Same identities, different players.
    expect(next.league.teams.map((t) => t.identity.id)).toEqual(
      finished.league.teams.map((t) => t.identity.id),
    );
    expect(next.league.teams[0]!.roster.athletes).not.toEqual(
      finished.league.teams[0]!.roster.athletes,
    );
    // And a different schedule rotation.
    expect(next.schedule.map((g) => g.id)).not.toEqual(finished.schedule.slice(0, 112).map((g) => g.id));
  });

  it('can be played to completion again', () => {
    const next = runFullSeason(startNewSeason(runFullSeason(newSeason())));
    expect(next.phase).toBe('complete');
    expect(next.champion).not.toBeNull();
  });
});
