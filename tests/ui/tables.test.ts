import { describe, expect, it } from 'vitest';
import type { GameStats, PlayerGameStats, TeamGameStats, TeamSide } from '../../src/sim/types';
import type { PlayerSeasonStats, StandingRow } from '../../src/meta/types';
import { TEAM_IDENTITIES } from '../../src/ui/fixtures/teamIdentities';
import {
  buildConferenceSeeds, buildLeaders, buildLineScore, buildPlayerTables,
  buildStandings, buildTeamComparison, compareStandingRows, describeStatLine,
  impactScore, pickPlayerOfTheGame, rankStandouts,
} from '../../src/ui/tables';

// --- fixtures ---------------------------------------------------------------

function row(teamId: string, w: number, l: number, over: Partial<StandingRow> = {}): StandingRow {
  return {
    teamId, w, l, t: 0,
    pf: 300 + w * 10, pa: 300 - w * 5,
    divW: Math.min(6, w), divL: Math.min(6, l),
    confW: w, confL: l,
    ...over,
  };
}

/** One row per canonical team; wins descend with the fixed id order. */
function fullStandings(): StandingRow[] {
  return TEAM_IDENTITIES.map((t, i) => row(t.id, 14 - i, i));
}

function player(over: Partial<PlayerGameStats> & { athleteId: string }): PlayerGameStats {
  return {
    passAtt: 0, passCmp: 0, passYds: 0, passTD: 0, passInt: 0,
    rushAtt: 0, rushYds: 0, rushTD: 0, fumbles: 0,
    tgt: 0, rec: 0, recYds: 0, recTD: 0,
    tackles: 0, sacks: 0, defInt: 0, ffum: 0,
    fgm: 0, fga: 0, xpm: 0, xpa: 0,
    punts: 0, puntYds: 0,
    krYds: 0, prYds: 0, retTD: 0,
    ...over,
  };
}

function teamStats(teamId: string, over: Partial<TeamGameStats> = {}): TeamGameStats {
  return {
    teamId, points: 0, totalYds: 0, passYds: 0, rushYds: 0, firstDowns: 0,
    thirdDownConv: 0, thirdDownAtt: 0, turnovers: 0, penalties: 0, penaltyYds: 0,
    topSeconds: 1800, sacksAllowed: 0,
    ...over,
  };
}

function boxScore(): GameStats {
  return {
    teams: [
      teamStats('ASH', {
        points: 27, totalYds: 388, passYds: 254, rushYds: 134, firstDowns: 22,
        thirdDownConv: 7, thirdDownAtt: 13, turnovers: 1, penalties: 5, penaltyYds: 45,
        topSeconds: 1980, sacksAllowed: 1,
      }),
      teamStats('OAK', {
        points: 20, totalYds: 341, passYds: 265, rushYds: 76, firstDowns: 18,
        thirdDownConv: 5, thirdDownAtt: 14, turnovers: 3, penalties: 7, penaltyYds: 61,
        topSeconds: 1620, sacksAllowed: 4,
      }),
    ],
    players: {
      'ASH-0': player({ athleteId: 'ASH-0', passAtt: 31, passCmp: 22, passYds: 254, passTD: 2, passInt: 0 }),
      'ASH-2': player({ athleteId: 'ASH-2', rushAtt: 21, rushYds: 108, rushTD: 1 }),
      'ASH-5': player({ athleteId: 'ASH-5', tgt: 9, rec: 7, recYds: 121, recTD: 1 }),
      'ASH-30': player({ athleteId: 'ASH-30', tackles: 11, sacks: 1, defInt: 1 }),
      'ASH-38': player({ athleteId: 'ASH-38', fgm: 2, fga: 3, xpm: 3, xpa: 3 }),
      'OAK-0': player({ athleteId: 'OAK-0', passAtt: 39, passCmp: 24, passYds: 265, passTD: 2, passInt: 2 }),
      'OAK-2': player({ athleteId: 'OAK-2', rushAtt: 14, rushYds: 61, rushTD: 0 }),
      'OAK-31': player({ athleteId: 'OAK-31', tackles: 9, sacks: 2 }),
      'OAK-39': player({ athleteId: 'OAK-39', punts: 5, puntYds: 231 }),
    },
    scoringByQuarter: [[7, 10, 3, 7], [0, 7, 6, 7]],
  };
}

const teamOf = (athleteId: string): TeamSide => (athleteId.startsWith('ASH') ? 0 : 1);
const nameOf = (athleteId: string): string => `P. ${athleteId}`;

// --- standings --------------------------------------------------------------

describe('standings tables', () => {
  it('groups all 16 teams into four division tables', () => {
    const groups = buildStandings(TEAM_IDENTITIES, fullStandings(), { userTeamId: 'ASH' });
    expect(groups.map((g) => g.division)).toEqual([
      'Atlantic North', 'Atlantic South', 'Pacific North', 'Pacific South',
    ]);
    for (const g of groups) expect(g.rows).toHaveLength(4);
  });

  it('sorts each division by win percentage and formats the row', () => {
    const groups = buildStandings(TEAM_IDENTITIES, fullStandings(), { userTeamId: 'BAY' });
    const north = groups[0];
    expect(north?.rows.map((r) => r.teamId)).toEqual(['ASH', 'BAY', 'COB', 'DUN']);
    const top = north?.rows[0];
    expect(top?.record).toBe('14-0');
    expect(top?.pct).toBe('1.000');
    expect(top?.name).toBe('Ashford Aviators');
    expect(top?.diff).toBe('+210');
    expect(north?.rows[1]?.isUser).toBe(true);
    expect(top?.isUser).toBe(false);
  });

  it('filters to one conference for the L/R toggle', () => {
    const groups = buildStandings(TEAM_IDENTITIES, fullStandings(), { conference: 'Pacific' });
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.conference === 'Pacific')).toBe(true);
  });

  it('breaks ties by division record, then point differential, then id', () => {
    const a = row('AAA', 8, 6, { divW: 5, divL: 1, pf: 300, pa: 250 });
    const b = row('BBB', 8, 6, { divW: 2, divL: 4, pf: 400, pa: 200 });
    expect(compareStandingRows(a, b)).toBeLessThan(0);

    const c = row('CCC', 8, 6, { divW: 3, divL: 3, pf: 400, pa: 200 });
    const d = row('DDD', 8, 6, { divW: 3, divL: 3, pf: 300, pa: 290 });
    expect(compareStandingRows(c, d)).toBeLessThan(0);

    const e = row('EEE', 8, 6, { divW: 3, divL: 3, pf: 300, pa: 250 });
    const f = row('FFF', 8, 6, { divW: 3, divL: 3, pf: 300, pa: 250 });
    expect(compareStandingRows(e, f)).toBeLessThan(0);
    expect(compareStandingRows(f, e)).toBeGreaterThan(0);
  });

  it('seeds a conference: division winners first, then two wildcards', () => {
    // Make the Atlantic South winner worse than the Atlantic North runner-up.
    const rows = [
      row('ASH', 12, 2), row('BAY', 11, 3), row('COB', 4, 10), row('DUN', 3, 11),
      row('EMB', 9, 5), row('FAI', 8, 6), row('GRA', 2, 12), row('HAR', 1, 13),
      ...TEAM_IDENTITIES.slice(8).map((t, i) => row(t.id, 7 - i, 7 + i)),
    ];
    expect(buildConferenceSeeds(TEAM_IDENTITIES, rows, 'Atlantic')).toEqual(['ASH', 'EMB', 'BAY', 'FAI']);
  });
});

// --- leaders ----------------------------------------------------------------

function seasonPlayer(id: string, teamId: string, over: Partial<PlayerSeasonStats>): PlayerSeasonStats {
  return { ...player({ athleteId: id }), athleteId: id, teamId, gamesPlayed: 14, ...over };
}

describe('season leaders', () => {
  const season: Record<string, PlayerSeasonStats> = {
    'ASH-0': seasonPlayer('ASH-0', 'ASH', { passYds: 3900, passTD: 31, passInt: 9, passAtt: 500, passCmp: 330 }),
    'OAK-0': seasonPlayer('OAK-0', 'OAK', { passYds: 4200, passTD: 28, passInt: 12, passAtt: 540, passCmp: 350 }),
    'BAY-0': seasonPlayer('BAY-0', 'BAY', { passYds: 3900, passTD: 22, passInt: 14, passAtt: 480, passCmp: 300 }),
    'COB-0': seasonPlayer('COB-0', 'COB', { passYds: 0 }),
  };
  const ctx = {
    nameOf: (id: string) => `P. ${id}`,
    abbrevOf: (teamId: string) => teamId,
    userTeamId: 'BAY',
  };

  it('ranks by the category value and drops zero rows', () => {
    const rows = buildLeaders(season, 'passYds', ctx);
    expect(rows.map((r) => r.athleteId)).toEqual(['OAK-0', 'ASH-0', 'BAY-0']);
    expect(rows[0]?.rank).toBe(1);
    expect(rows[0]?.value).toBe('4200');
  });

  it('breaks ties by athleteId so the table is deterministic', () => {
    const rows = buildLeaders(season, 'passYds', ctx);
    expect(rows[1]?.athleteId).toBe('ASH-0'); // ASH-0 < BAY-0 at 3900 each
    expect(rows[2]?.athleteId).toBe('BAY-0');
  });

  it('marks user-team rows and fills the detail column', () => {
    const rows = buildLeaders(season, 'passTD', ctx);
    expect(rows.find((r) => r.athleteId === 'BAY-0')?.isUser).toBe(true);
    expect(rows[0]?.detail).toBe('330/500 · 31 TD · 9 INT');
  });

  it('respects the row limit', () => {
    expect(buildLeaders(season, 'passYds', { ...ctx, limit: 2 })).toHaveLength(2);
  });
});

// --- box score --------------------------------------------------------------

describe('box score tables', () => {
  it('builds a line score with the away team on top', () => {
    const line = buildLineScore(boxScore(), 'ASH', 'OAK');
    expect(line.headers).toEqual(['', '1', '2', '3', '4', 'T']);
    expect(line.rows[0]?.label).toBe('OAK');
    expect(line.rows[0]?.cells).toEqual(['0', '7', '6', '7']);
    expect(line.rows[0]?.total).toBe(20);
    expect(line.rows[1]?.total).toBe(27);
    expect(line.rows[1]?.isWinner).toBe(true);
    expect(line.rows[0]?.isWinner).toBe(false);
  });

  it('adds overtime columns', () => {
    const stats = boxScore();
    stats.scoringByQuarter = [[7, 10, 3, 7, 3], [0, 7, 6, 14, 0]];
    stats.teams[0].points = 30;
    stats.teams[1].points = 27;
    const line = buildLineScore(stats, 'ASH', 'OAK');
    expect(line.headers).toEqual(['', '1', '2', '3', '4', 'OT', 'T']);
    expect(line.rows[1]?.cells).toEqual(['7', '10', '3', '7', '3']);
  });

  it('marks the better column per comparison row', () => {
    const rows = buildTeamComparison(boxScore());
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    expect(byLabel.get('TOTAL YARDS')?.better).toBe('home');
    expect(byLabel.get('PASSING')?.better).toBe('away');
    expect(byLabel.get('TURNOVERS')?.better).toBe('home'); // fewer is better
    expect(byLabel.get('SACKS ALLOWED')?.better).toBe('home');
    expect(byLabel.get('3RD DOWN')?.away).toBe('5/14 (36%)');
    expect(byLabel.get('TIME OF POSS.')?.home).toBe('33:00');
  });

  it('builds offense tables sorted by production', () => {
    const tables = buildPlayerTables(boxScore(), 'OFF', {
      nameOf, teamOf, abbrevs: ['ASH', 'OAK'],
    });
    expect(tables.map((t) => t.title)).toEqual(['PASSING', 'RUSHING', 'RECEIVING']);
    const passing = tables[0];
    expect(passing?.rows[0]?.athleteId).toBe('OAK-0');
    expect(passing?.rows[0]?.teamAbbrev).toBe('OAK');
    expect(passing?.rows[0]?.cells).toEqual(['24/39', '265', '2', '2']);
    expect(tables[1]?.rows[0]?.cells).toEqual(['21', '108', '5.1', '1']);
  });

  it('restricts to one team when asked (halftime panels)', () => {
    const tables = buildPlayerTables(boxScore(), 'DEF', {
      nameOf, teamOf, abbrevs: ['ASH', 'OAK'], onlyTeam: 1,
    });
    expect(tables[0]?.rows.map((r) => r.athleteId)).toEqual(['OAK-31']);
  });

  it('builds special-teams tables', () => {
    const tables = buildPlayerTables(boxScore(), 'ST', {
      nameOf, teamOf, abbrevs: ['ASH', 'OAK'],
    });
    expect(tables.map((t) => t.title)).toEqual(['KICKING', 'PUNTING', 'RETURNS']);
    expect(tables[0]?.rows[0]?.cells).toEqual(['2/3', '3/3', '9']);
    expect(tables[1]?.rows[0]?.cells).toEqual(['5', '231', '46.2']);
  });
});

describe('player of the game', () => {
  it('picks the highest impact player and describes the line', () => {
    const potg = pickPlayerOfTheGame(boxScore(), teamOf);
    expect(potg?.athleteId).toBe('ASH-0');
    expect(potg?.line).toBe('22/31, 254 PASS YDS, 2 TD');
  });

  it('ranks standouts per team', () => {
    const away = rankStandouts(boxScore(), teamOf, { onlyTeam: 1, limit: 3 });
    expect(away.every((s) => s.team === 1)).toBe(true);
    expect(away[0]?.athleteId).toBe('OAK-0');
    expect(away.length).toBeLessThanOrEqual(3);
  });

  it('penalises interceptions in the impact score', () => {
    const clean = player({ athleteId: 'X', passYds: 300, passTD: 2 });
    const picky = player({ athleteId: 'Y', passYds: 300, passTD: 2, passInt: 3 });
    expect(impactScore(clean)).toBeGreaterThan(impactScore(picky));
  });

  it('describes multi-phase stat lines', () => {
    const line = describeStatLine(player({
      athleteId: 'Z', rushAtt: 18, rushYds: 96, rushTD: 1, rec: 3, recYds: 24, recTD: 0,
    }));
    expect(line).toBe('18 CAR, 96 RUSH YDS, 1 TD · 3 REC, 24 YDS, 0 TD');
  });

  it('returns null when nobody did anything', () => {
    const empty: GameStats = { teams: [teamStats('ASH'), teamStats('OAK')], players: {}, scoringByQuarter: [[], []] };
    expect(pickPlayerOfTheGame(empty, teamOf)).toBeNull();
  });
});
