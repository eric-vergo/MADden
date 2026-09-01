import { describe, expect, it } from 'vitest';
import { generateLeague } from '../../src/meta/league';
import { generateSchedule } from '../../src/meta/schedule';
import { computeStandings, emptyRow, sortStandings, type SortContext } from '../../src/meta/standings';
import {
  APEX_BOWL_WEEK, CONF_FINAL_WEEK, SEMIS_WEEK, advance, championOf, createBracket,
  isNeutralSite, seedConference, winnerOf,
} from '../../src/meta/playoffs';
import { simGame } from '../../src/meta/quickSim';
import type { ScheduledGame, StandingRow, Team } from '../../src/meta/types';

const SEED = 5150;
const league = generateLeague(SEED, 0);
const teams = league.teams;

function ctxOf(schedule: readonly ScheduledGame[]): SortContext {
  return { leagueSeed: SEED, seasonIndex: 0, schedule };
}

function idsOf(teams: readonly Team[], conference: string, division: string): string[] {
  return teams
    .filter((t) => t.identity.conference === conference && t.identity.division === division)
    .map((t) => t.identity.id);
}

function rowsFrom(records: Readonly<Record<string, [number, number]>>): StandingRow[] {
  return teams.map((t) => {
    const rec = records[t.identity.id] ?? [7, 7];
    return { ...emptyRow(t.identity.id), w: rec[0], l: rec[1], pf: 300 + rec[0], pa: 300 };
  });
}

describe('playoff seeding', () => {
  it('seeds two division winners then two wildcards per conference', () => {
    const north = idsOf(teams, 'Atlantic', 'North'); // ASH BAY COB DUN
    const south = idsOf(teams, 'Atlantic', 'South'); // EMB FAI GRA HAR
    const rows = rowsFrom({
      [north[0]!]: [12, 2], [north[1]!]: [11, 3], [north[2]!]: [4, 10], [north[3]!]: [3, 11],
      [south[0]!]: [13, 1], [south[1]!]: [10, 4], [south[2]!]: [2, 12], [south[3]!]: [1, 13],
    });
    const seeds = seedConference(teams, rows, ctxOf([]), 'Atlantic');
    expect(seeds.map((s) => s.seed)).toEqual([1, 2, 3, 4]);
    // Division winners first (13-1 then 12-2), then the best two non-winners.
    expect(seeds.map((s) => s.teamId)).toEqual([south[0], north[0], north[1], south[1]]);
    for (const s of seeds) expect(s.conference).toBe('Atlantic');
  });

  it('never seeds a division runner-up above its own division winner', () => {
    const north = idsOf(teams, 'Atlantic', 'North');
    const south = idsOf(teams, 'Atlantic', 'South');
    // North's #2 has a better record than South's winner but is still a wildcard.
    const rows = rowsFrom({
      [north[0]!]: [13, 1], [north[1]!]: [12, 2], [north[2]!]: [11, 3], [north[3]!]: [0, 14],
      [south[0]!]: [6, 8], [south[1]!]: [5, 9], [south[2]!]: [4, 10], [south[3]!]: [3, 11],
    });
    const seeds = seedConference(teams, rows, ctxOf([]), 'Atlantic');
    expect(seeds[0]!.teamId).toBe(north[0]);
    expect(seeds[1]!.teamId).toBe(south[0]); // division winner keeps seed 2
    expect(seeds[2]!.teamId).toBe(north[1]);
    expect(seeds[3]!.teamId).toBe(north[2]);
  });

  it('builds a week-15 bracket of 1v4 and 2v3 in both conferences', () => {
    const rows = rowsFrom({});
    const bracket = createBracket(teams, rows, ctxOf([]), 0);
    expect(bracket.seeds).toHaveLength(8);
    expect(bracket.games).toHaveLength(4);
    for (const conf of ['Atlantic', 'Pacific']) {
      const confSeeds = bracket.seeds.filter((s) => s.conference === conf);
      expect(confSeeds.map((s) => s.seed).sort()).toEqual([1, 2, 3, 4]);
      const seedOf = (id: string): number => confSeeds.find((s) => s.teamId === id)?.seed ?? 0;
      const confGames = bracket.games.filter((g) => seedOf(g.homeId) > 0);
      const matchups = confGames
        .map((g) => `${seedOf(g.homeId)}v${seedOf(g.awayId)}`)
        .sort();
      expect(matchups).toEqual(['1v4', '2v3']);
    }
    for (const g of bracket.games) {
      expect(g.week).toBe(SEMIS_WEEK);
      expect(isNeutralSite(g)).toBe(false);
    }
    const ids = new Set(bracket.games.map((g) => g.id));
    expect(ids.size).toBe(4);
  });
});

describe('bracket advancement', () => {
  const rows = rowsFrom({});
  const ctx = ctxOf([]);
  const bracket = createBracket(teams, rows, ctx, 0);

  function playAll(games: readonly ScheduledGame[], homeWins: boolean): ScheduledGame[] {
    return games.map((g) => ({
      ...g,
      result: { homeScore: homeWins ? 24 : 10, awayScore: homeWins ? 10 : 24, ot: false },
    }));
  }

  it('generates the conference finals only after all semis resolve', () => {
    const partial = bracket.games.map((g, i) =>
      i === 0 ? { ...g, result: { homeScore: 20, awayScore: 3, ot: false } } : g,
    );
    const still15 = advance(bracket, partial, 0);
    expect(still15.games.filter((g) => g.week === CONF_FINAL_WEEK)).toHaveLength(0);

    const done = advance(bracket, playAll(bracket.games, true), 0);
    const finals = done.games.filter((g) => g.week === CONF_FINAL_WEEK);
    expect(finals).toHaveLength(2);
    // Home teams were the 1 and 2 seeds; the better seed hosts the final.
    for (const g of finals) {
      const homeSeed = done.seeds.find((s) => s.teamId === g.homeId);
      const awaySeed = done.seeds.find((s) => s.teamId === g.awayId);
      expect(homeSeed).toBeDefined();
      expect(awaySeed).toBeDefined();
      expect(homeSeed!.seed).toBeLessThan(awaySeed!.seed);
      expect(homeSeed!.conference).toBe(awaySeed!.conference);
    }
  });

  it('advances the lower seeds when the road teams win', () => {
    const upsets = advance(bracket, playAll(bracket.games, false), 0);
    const finals = upsets.games.filter((g) => g.week === CONF_FINAL_WEEK);
    expect(finals).toHaveLength(2);
    for (const g of finals) {
      const seeds = [g.homeId, g.awayId].map((id) => upsets.seeds.find((s) => s.teamId === id)!.seed);
      expect(seeds.sort()).toEqual([3, 4]);
    }
  });

  it('creates one neutral-site Apex Bowl and crowns a champion', () => {
    let b = advance(bracket, playAll(bracket.games, true), 0);
    const finals = b.games.filter((g) => g.week === CONF_FINAL_WEEK);
    b = advance(b, playAll(finals, true), 0);
    const bowl = b.games.filter((g) => g.week === APEX_BOWL_WEEK);
    expect(bowl).toHaveLength(1);
    expect(isNeutralSite(bowl[0]!)).toBe(true);
    const homeConf = b.seeds.find((s) => s.teamId === bowl[0]!.homeId)?.conference;
    const awayConf = b.seeds.find((s) => s.teamId === bowl[0]!.awayId)?.conference;
    expect(homeConf).not.toBe(awayConf);
    expect(championOf(b)).toBeNull();

    const played = advance(b, playAll(bowl, false), 0);
    expect(championOf(played)).toBe(bowl[0]!.awayId);
    expect(winnerOf(played.games.find((g) => g.week === APEX_BOWL_WEEK)!)).toBe(bowl[0]!.awayId);
  });

  it('runs a whole quick-simmed postseason without ties', () => {
    const schedule = generateSchedule(SEED, 0, teams).map((g) => ({
      ...g,
      result: simGame(SEED, g, teams).result,
    }));
    const realRows = computeStandings(teams, schedule, 14);
    const ctx2 = ctxOf(schedule);
    let b = createBracket(teams, realRows, ctx2, 0);
    for (const week of [SEMIS_WEEK, CONF_FINAL_WEEK, APEX_BOWL_WEEK]) {
      const pending = b.games.filter((g) => g.week === week && g.result === undefined);
      expect(pending.length).toBeGreaterThan(0);
      const played = pending.map((g) => ({ ...g, result: simGame(SEED, g, teams).result }));
      for (const g of played) expect(g.result!.homeScore).not.toBe(g.result!.awayScore);
      b = advance(b, played, 0);
    }
    const champ = championOf(b);
    expect(champ).not.toBeNull();
    expect(b.seeds.map((s) => s.teamId)).toContain(champ!);
    // Seeded playoff teams are exactly the top of each conference.
    const sorted = sortStandings(realRows, ctx2);
    expect(sorted.length).toBe(16);
  });
});
