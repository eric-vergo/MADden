// The fixture services back ui-demo.html and several screen behaviours
// (enable/disable rules on the hub). Keep them honest.

import { describe, expect, it } from 'vitest';
import { FakeUiServices } from '../../src/ui/fixtures/FakeUiServices';
import { TEAM_IDENTITIES } from '../../src/ui/fixtures/teamIdentities';

function newServices(): FakeUiServices {
  return new FakeUiServices({ seed: 4242 });
}

describe('fixture league', () => {
  it('fields the canonical 16 teams, four per division', () => {
    const teams = newServices().getTeams();
    expect(teams).toHaveLength(16);
    expect(new Set(teams.map((t) => t.identity.id)).size).toBe(16);
    for (const conf of ['Atlantic', 'Pacific'] as const) {
      for (const div of ['North', 'South'] as const) {
        const count = teams.filter((t) => t.identity.conference === conf && t.identity.division === div).length;
        expect(count).toBe(4);
      }
    }
  });

  it('gives every team a 40-man roster with ratings in range', () => {
    const team = newServices().getTeam('ASH');
    expect(team?.roster.athletes).toHaveLength(40);
    for (const a of team?.roster.athletes ?? []) {
      expect(a.overall).toBeGreaterThanOrEqual(40);
      expect(a.overall).toBeLessThanOrEqual(99);
      for (const v of Object.values(a.ratings)) {
        expect(v).toBeGreaterThanOrEqual(40);
        expect(v).toBeLessThanOrEqual(99);
      }
    }
    expect(team?.ovr).toBeGreaterThan(50);
  });

  it('returns top stars sorted by overall with a signature attribute', () => {
    const stars = newServices().getTopStars('ASH', 3);
    expect(stars).toHaveLength(3);
    expect(stars[0]!.overall).toBeGreaterThanOrEqual(stars[1]!.overall);
    expect(stars[0]!.signatureValue).toBeGreaterThan(0);
    expect(stars[0]!.name).toMatch(/^[A-Z]\. /);
  });

  it('is deterministic for a given seed', () => {
    const a = new FakeUiServices({ seed: 99 }).getTeams().map((t) => t.ovr);
    const b = new FakeUiServices({ seed: 99 }).getTeams().map((t) => t.ovr);
    expect(a).toEqual(b);
  });
});

describe('fixture season flow', () => {
  it('builds a 14-week schedule where everyone plays every week', () => {
    const s = newServices();
    s.startNewSeason({ userTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });
    const season = s.getSeason();
    expect(season?.schedule).toHaveLength(14 * 8);
    for (let week = 1; week <= 14; week++) {
      const games = season?.schedule.filter((g) => g.week === week) ?? [];
      expect(games).toHaveLength(8);
      const seen = new Set<string>();
      for (const g of games) {
        expect(seen.has(g.homeId)).toBe(false);
        expect(seen.has(g.awayId)).toBe(false);
        seen.add(g.homeId);
        seen.add(g.awayId);
      }
      expect(seen.size).toBe(16);
    }
    for (const t of TEAM_IDENTITIES) {
      const count = season?.schedule.filter((g) => g.homeId === t.id || g.awayId === t.id).length;
      expect(count).toBe(14);
    }
  });

  it('gates SIM WEEK on the user game being resolved', () => {
    const s = newServices();
    s.startNewSeason({ userTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });
    expect(s.getNextGame()?.userGameResolved).toBe(false);
    s.simUserGame();
    expect(s.getNextGame()?.userGameResolved).toBe(true);
    s.simWeek();
    expect(s.getSeason()?.currentWeek).toBe(2);
    expect(s.getNextGame()?.userGameResolved).toBe(false);
  });

  it('accumulates standings and season stats as weeks are simmed', () => {
    const s = newServices();
    s.startNewSeason({ userTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });
    for (let i = 0; i < 3; i++) {
      s.simUserGame();
      s.simWeek();
    }
    const standings = s.getStandings();
    expect(standings).toHaveLength(16);
    for (const row of standings) {
      expect(row.w + row.l + row.t).toBe(3);
      expect(row.pf).toBeGreaterThan(0);
    }
    const stats = s.getSeasonStats();
    expect(Object.keys(stats).length).toBeGreaterThan(50);
    const qb = stats['ASH-0'];
    expect(qb?.gamesPlayed).toBe(3);
    expect(qb?.passYds).toBeGreaterThan(0);
    expect(s.saveSummary()).toContain('WEEK 4');
  });

  it('exposes a box score view whose team mapping matches the athlete ids', () => {
    const s = newServices();
    s.startNewSeason({ userTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });
    s.simUserGame();
    const game = s.getUserSchedule()[0];
    const view = s.getBoxScoreView(game!.game.id);
    expect(view).not.toBeNull();
    expect(view?.teamOf(`${game!.game.homeId}-0`)).toBe(0);
    expect(view?.teamOf(`${game!.game.awayId}-0`)).toBe(1);
    expect(view?.stats.teams[0].points).toBe(game!.game.result?.homeScore);
    expect(view?.label).toContain('FINAL');
  });

  it('runs through the playoffs to a champion', () => {
    const s = newServices();
    s.startNewSeason({ userTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });
    for (let i = 0; i < 25 && s.getSeason()?.phase !== 'complete'; i++) {
      s.simUserGame();
      s.simWeek();
    }
    const season = s.getSeason();
    expect(season?.phase).toBe('complete');
    expect(season?.champion).not.toBeNull();
    const bracket = s.getBracket();
    expect(bracket?.seeds).toHaveLength(8);
    expect(bracket?.games.filter((g) => g.week === 15)).toHaveLength(4);
    expect(bracket?.games.filter((g) => g.week === 16)).toHaveLength(2);
    expect(bracket?.games.filter((g) => g.week === 17)).toHaveLength(1);
    const info = s.getChampionInfo();
    expect(info?.teamId).toBe(season?.champion);
    expect(info?.awards[0]?.label).toBe('MVP');
    expect(s.getNextGame()).toBeNull();
  });

  it('falls back to defaults with no storage available', () => {
    const s = newServices();
    expect(s.loadSettings().quarterMinutes).toBe(5);
    s.saveSettings({ ...s.loadSettings(), volMaster: 3 });
    expect(s.loadSettings().volMaster).toBe(3);
    s.resetAllSaves();
    expect(s.loadSettings().volMaster).toBe(7);
    expect(s.hasSeasonSave()).toBe(false);
  });
});
