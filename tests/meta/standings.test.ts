import { describe, expect, it } from 'vitest';
import { generateLeague } from '../../src/meta/league';
import { generateSchedule } from '../../src/meta/schedule';
import {
  computeStandings, conferenceStandings, divisionStandings, emptyRow, headToHead,
  sortStandings, winPct, type SortContext,
} from '../../src/meta/standings';
import type { ScheduledGame, StandingRow } from '../../src/meta/types';

const SEED = 909090;
const league = generateLeague(SEED, 0);
const teams = league.teams;

function row(teamId: string, patch: Partial<StandingRow>): StandingRow {
  return { ...emptyRow(teamId), ...patch };
}

function game(week: number, homeId: string, awayId: string, hs: number, as: number): ScheduledGame {
  return { id: `T-W${week}-${awayId}@${homeId}`, week, homeId, awayId, result: { homeScore: hs, awayScore: as, ot: false } };
}

function ctxOf(schedule: readonly ScheduledGame[], seasonIndex = 0): SortContext {
  return { leagueSeed: SEED, seasonIndex, schedule };
}

describe('standings accumulation', () => {
  it('counts W/L/T, points and divisional/conference splits', () => {
    // ASH BAY COB DUN = Atlantic North; EMB = Atlantic South; IRO = Pacific North.
    const schedule = [
      game(1, 'ASH', 'BAY', 24, 17), // divisional + conference win for ASH
      game(2, 'COB', 'ASH', 10, 31), // divisional + conference win for ASH (away)
      game(3, 'ASH', 'EMB', 14, 14), // conference tie
      game(4, 'IRO', 'ASH', 20, 13), // inter-conference loss
    ];
    const rows = computeStandings(teams, schedule);
    const ash = rows.find((r) => r.teamId === 'ASH');
    expect(ash).toBeDefined();
    expect(ash!.w).toBe(2);
    expect(ash!.l).toBe(1);
    expect(ash!.t).toBe(1);
    expect(ash!.pf).toBe(24 + 31 + 14 + 13);
    expect(ash!.pa).toBe(17 + 10 + 14 + 20);
    expect(ash!.divW).toBe(2);
    expect(ash!.divL).toBe(0);
    expect(ash!.confW).toBe(2);
    expect(ash!.confL).toBe(0);
    expect(winPct(ash!)).toBeCloseTo(2.5 / 4, 9);
  });

  it('ignores games without a result and games past the regular season', () => {
    const schedule: ScheduledGame[] = [
      { id: 'x', week: 3, homeId: 'ASH', awayId: 'BAY' },
      game(15, 'ASH', 'BAY', 30, 0),
    ];
    const rows = computeStandings(teams, schedule, 14);
    for (const r of rows) {
      expect(r.w + r.l + r.t).toBe(0);
    }
  });

  it('reads head-to-head both directions', () => {
    const schedule = [game(1, 'ASH', 'BAY', 20, 10), game(8, 'BAY', 'ASH', 3, 30)];
    expect(headToHead(schedule, 'ASH', 'BAY')).toEqual({ w: 2, l: 0 });
    expect(headToHead(schedule, 'BAY', 'ASH')).toEqual({ w: 0, l: 2 });
  });
});

describe('standings tiebreakers', () => {
  it('sorts by win percentage first', () => {
    const rows = [
      row('ASH', { w: 5, l: 9 }),
      row('BAY', { w: 11, l: 3 }),
      row('COB', { w: 8, l: 6 }),
    ];
    const sorted = sortStandings(rows, ctxOf([]));
    expect(sorted.map((r) => r.teamId)).toEqual(['BAY', 'COB', 'ASH']);
  });

  it('breaks an exactly-two-team tie on head-to-head', () => {
    // Identical in every later criterion; only H2H separates them.
    const rows = [
      row('ASH', { w: 9, l: 5, divW: 3, divL: 3, pf: 300, pa: 250 }),
      row('BAY', { w: 9, l: 5, divW: 3, divL: 3, pf: 300, pa: 250 }),
    ];
    const bayWins = [game(2, 'BAY', 'ASH', 21, 3)];
    expect(sortStandings(rows, ctxOf(bayWins)).map((r) => r.teamId)).toEqual(['BAY', 'ASH']);
    const ashWins = [game(2, 'ASH', 'BAY', 21, 3)];
    expect(sortStandings(rows, ctxOf(ashWins)).map((r) => r.teamId)).toEqual(['ASH', 'BAY']);
  });

  it('does not use head-to-head when more than two teams are tied', () => {
    // COB beat both, but a three-way tie skips H2H and falls to division win%.
    const rows = [
      row('ASH', { w: 9, l: 5, divW: 5, divL: 1, pf: 300, pa: 250 }),
      row('BAY', { w: 9, l: 5, divW: 4, divL: 2, pf: 300, pa: 250 }),
      row('COB', { w: 9, l: 5, divW: 1, divL: 5, pf: 300, pa: 250 }),
    ];
    const schedule = [game(1, 'COB', 'ASH', 30, 0), game(2, 'COB', 'BAY', 30, 0)];
    expect(sortStandings(rows, ctxOf(schedule)).map((r) => r.teamId)).toEqual(['ASH', 'BAY', 'COB']);
  });

  it('falls through to division win% when head-to-head is split', () => {
    const rows = [
      row('ASH', { w: 9, l: 5, divW: 4, divL: 2, pf: 300, pa: 250 }),
      row('BAY', { w: 9, l: 5, divW: 5, divL: 1, pf: 300, pa: 250 }),
    ];
    const split = [game(1, 'ASH', 'BAY', 20, 10), game(9, 'BAY', 'ASH', 20, 10)];
    expect(sortStandings(rows, ctxOf(split)).map((r) => r.teamId)).toEqual(['BAY', 'ASH']);
  });

  it('falls through to point differential when division records match', () => {
    const rows = [
      row('ASH', { w: 9, l: 5, divW: 3, divL: 3, pf: 300, pa: 290 }),
      row('BAY', { w: 9, l: 5, divW: 3, divL: 3, pf: 300, pa: 200 }),
    ];
    const split = [game(1, 'ASH', 'BAY', 20, 10), game(9, 'BAY', 'ASH', 20, 10)];
    expect(sortStandings(rows, ctxOf(split)).map((r) => r.teamId)).toEqual(['BAY', 'ASH']);
  });

  it('resolves a total tie with a stable seeded coin', () => {
    const rows = [
      row('ASH', { w: 9, l: 5, divW: 3, divL: 3, pf: 300, pa: 250 }),
      row('BAY', { w: 9, l: 5, divW: 3, divL: 3, pf: 300, pa: 250 }),
      row('COB', { w: 9, l: 5, divW: 3, divL: 3, pf: 300, pa: 250 }),
    ];
    const ctx = ctxOf([]);
    const first = sortStandings(rows, ctx).map((r) => r.teamId);
    // Order of the input must not change the answer, and repeats must match.
    expect(sortStandings(rows.slice().reverse(), ctx).map((r) => r.teamId)).toEqual(first);
    expect(sortStandings(rows, ctx).map((r) => r.teamId)).toEqual(first);
    // A different season index is allowed to flip it, but must be stable itself.
    const other = sortStandings(rows, ctxOf([], 3)).map((r) => r.teamId);
    expect(sortStandings(rows, ctxOf([], 3)).map((r) => r.teamId)).toEqual(other);
    expect(new Set(other)).toEqual(new Set(first));
  });
});

describe('division and conference views', () => {
  const schedule = generateSchedule(SEED, 0, teams).map((g, i) => ({
    ...g,
    result: { homeScore: 20 + (i % 7), awayScore: 17 + (i % 5), ot: false },
  }));
  const rows = computeStandings(teams, schedule);
  const ctx = ctxOf(schedule);

  it('splits the league into 4 divisions of 4', () => {
    for (const conf of ['Atlantic', 'Pacific']) {
      for (const div of ['North', 'South']) {
        expect(divisionStandings(teams, rows, ctx, conf, div)).toHaveLength(4);
      }
      expect(conferenceStandings(teams, rows, ctx, conf)).toHaveLength(8);
    }
  });

  it('accounts for all 224 team-games', () => {
    let games = 0;
    for (const r of rows) games += r.w + r.l + r.t;
    expect(games).toBe(14 * 16);
  });
});
