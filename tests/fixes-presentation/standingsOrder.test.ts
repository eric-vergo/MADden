// Regression: the Standings tab and the Bracket tab are two views of one
// ranking. The hub must render the division order the playoff seeder actually
// used (win% -> head-to-head -> division win% -> point diff -> seeded coin),
// not a display-layer re-sort that has neither head-to-head nor the coin.

import { describe, expect, it } from 'vitest';
import { NullAudioEngine } from '../../src/audio/AudioEngine';
import { TEAM_IDENTITIES } from '../../src/data/teams';
import {
  advanceWeek, createSeason, simWeek, sortContext,
} from '../../src/meta/seasonState';
import { computeStandings, divisionStandings } from '../../src/meta/standings';
import type { SeasonState, StandingRow } from '../../src/meta/types';
import { buildStandings } from '../../src/ui/tables';
import { GameServices, memoryStorage, type GameServicesHost } from '../../src/game/services';

function silentHost(): GameServicesHost {
  return {
    startExhibition: () => {},
    startSeasonGame: () => {},
    exitToMainMenu: () => {},
    resumeGame: () => {},
    quitGame: () => {},
    restartGame: () => {},
    canRestartGame: () => false,
    finishGameSummary: () => {},
    continueFromHalftime: () => {},
    requestTimeout: () => {},
    timeoutsRemaining: () => 3,
  };
}

/** Quick-sim all 14 regular-season weeks; advanceWeek seeds the bracket after W14. */
function playRegularSeason(leagueSeed: number, userTeamId = 'ASH'): SeasonState {
  let s = createSeason(leagueSeed, userTeamId, 'pro', 0);
  for (let week = 0; week < 14; week++) {
    s = simWeek(s);
    s = advanceWeek(s);
  }
  return s;
}

/** What the hub actually renders, through the real services seam. */
function hubDivisionOrder(season: SeasonState): Map<string, string[]> {
  const services = new GameServices({
    audio: new NullAudioEngine(),
    host: silentHost(),
    storage: memoryStorage(),
    newSeed: () => 1,
  });
  services.setSeason(season);
  const out = new Map<string, string[]>();
  for (const conference of ['Atlantic', 'Pacific'] as const) {
    const groups = buildStandings(TEAM_IDENTITIES, services.getStandings(), {
      conference,
      userTeamId: season.userTeamId,
    });
    for (const g of groups) out.set(g.division, g.rows.map((r) => r.teamId));
  }
  return out;
}

/** The order the playoff seeder uses for the same division. */
function seededDivisionOrder(season: SeasonState, conference: string, division: string): string[] {
  const rows = computeStandings(season.league.teams, season.schedule, 14);
  return divisionStandings(season.league.teams, rows, sortContext(season), conference, division)
    .map((r) => r.teamId);
}

describe('standings tab order agrees with the playoff bracket', () => {
  it('puts the head-to-head winner on top of the division (league seed 36)', () => {
    const season = playRegularSeason(36);
    const shown = hubDivisionOrder(season).get('Atlantic North');
    expect(shown).toEqual(seededDivisionOrder(season, 'Atlantic', 'North'));

    // The concrete case from the bug report: COB and BAY finish level on win%
    // and division record, BAY has the better point differential, but COB swept
    // the season series, so COB is the division winner the bracket seeds.
    expect(shown?.[0]).toBe('COB');
    expect(shown?.[1]).toBe('BAY');

    const seedOf = (teamId: string): number | undefined => season.bracket?.seeds
      .find((s) => s.teamId === teamId)?.seed;
    expect(seedOf('COB')).toBeLessThanOrEqual(2); // division winner
    expect(seedOf('BAY')).toBeGreaterThan(2); // wildcard
  });

  it('never disagrees with the seeder over 80 seeded seasons', () => {
    for (let leagueSeed = 1; leagueSeed <= 80; leagueSeed++) {
      const season = playRegularSeason(leagueSeed);
      const shown = hubDivisionOrder(season);
      for (const [key, order] of shown) {
        const [conference, division] = key.split(' ');
        expect(
          order,
          `league seed ${leagueSeed}, ${key}`,
        ).toEqual(seededDivisionOrder(season, conference ?? '', division ?? ''));
      }
      // Every division's top row is a bracket division winner (seed 1 or 2).
      const winners = (season.bracket?.seeds ?? [])
        .filter((s) => s.seed <= 2)
        .map((s) => s.teamId)
        .sort();
      const tops = [...shown.values()].map((o) => o[0] ?? '').sort();
      expect(tops, `league seed ${leagueSeed}`).toEqual(winners);
    }
  });
});

describe('buildStandings does not re-rank a list the meta layer already ranked', () => {
  function row(teamId: string, over: Partial<StandingRow> = {}): StandingRow {
    return {
      teamId, w: 10, l: 4, t: 0, pf: 300, pa: 250,
      divW: 4, divL: 2, confW: 8, confL: 4, ...over,
    };
  }

  it('keeps a head-to-head order that the display comparator cannot see', () => {
    // COB and BAY are level on win% and division record; BAY has the better
    // point differential, so any display-only comparator ranks BAY first. The
    // caller hands them over COB-first because COB swept the series.
    const ranked: StandingRow[] = [
      row('COB', { pf: 356, pa: 250 }),
      row('BAY', { pf: 362, pa: 250 }),
      row('ASH', { w: 7, l: 7, divW: 3, divL: 3 }),
      row('DUN', { w: 3, l: 11, divW: 1, divL: 5 }),
    ];
    const groups = buildStandings(TEAM_IDENTITIES, ranked, { conference: 'Atlantic' });
    const north = groups.find((g) => g.division === 'Atlantic North');
    expect(north?.rows.map((r) => r.teamId)).toEqual(['COB', 'BAY', 'ASH', 'DUN']);
  });

  it('still sorts a raw, unranked list', () => {
    const raw: StandingRow[] = [
      row('DUN', { w: 3, l: 11, divW: 1, divL: 5 }),
      row('BAY', { w: 11, l: 3, pf: 362 }),
      row('ASH', { w: 7, l: 7, divW: 3, divL: 3 }),
      row('COB', { w: 10, l: 4, pf: 356 }),
    ];
    const groups = buildStandings(TEAM_IDENTITIES, raw, { conference: 'Atlantic' });
    const north = groups.find((g) => g.division === 'Atlantic North');
    expect(north?.rows.map((r) => r.teamId)).toEqual(['BAY', 'COB', 'ASH', 'DUN']);
  });
});
