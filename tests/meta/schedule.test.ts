import { describe, expect, it } from 'vitest';
import { generateLeague } from '../../src/meta/league';
import {
  GAMES_PER_WEEK, REGULAR_SEASON_WEEKS, divisionGroups, gamesInWeek, generateSchedule,
} from '../../src/meta/schedule';
import type { Team } from '../../src/meta/types';

const SEED = 4242;

function divisionOf(teams: readonly Team[], id: string): string {
  const t = teams.find((x) => x.identity.id === id);
  if (t === undefined) throw new Error(id);
  return `${t.identity.conference}/${t.identity.division}`;
}

function conferenceOf(teams: readonly Team[], id: string): string {
  const t = teams.find((x) => x.identity.id === id);
  if (t === undefined) throw new Error(id);
  return t.identity.conference;
}

describe('schedule generation', () => {
  for (const seasonIndex of [0, 1, 2, 3, 4]) {
    describe(`season ${seasonIndex}`, () => {
      const league = generateLeague(SEED, seasonIndex);
      const teams = league.teams;
      const schedule = generateSchedule(SEED, seasonIndex, teams);

      it('has 14 weeks of 8 games', () => {
        expect(schedule).toHaveLength(REGULAR_SEASON_WEEKS * GAMES_PER_WEEK);
        for (let w = 1; w <= REGULAR_SEASON_WEEKS; w++) {
          expect(gamesInWeek(schedule, w)).toHaveLength(GAMES_PER_WEEK);
        }
      });

      it('makes every week a perfect matching over all 16 teams', () => {
        for (let w = 1; w <= REGULAR_SEASON_WEEKS; w++) {
          const seen = new Set<string>();
          for (const g of gamesInWeek(schedule, w)) {
            expect(seen.has(g.homeId), `double-booked ${g.homeId} in W${w}`).toBe(false);
            expect(seen.has(g.awayId), `double-booked ${g.awayId} in W${w}`).toBe(false);
            expect(g.homeId).not.toBe(g.awayId);
            seen.add(g.homeId);
            seen.add(g.awayId);
          }
          expect(seen.size).toBe(16);
        }
      });

      it('gives every team 14 games with a 7H/7A split', () => {
        for (const team of teams) {
          const id = team.identity.id;
          const games = schedule.filter((g) => g.homeId === id || g.awayId === id);
          expect(games, id).toHaveLength(14);
          expect(games.filter((g) => g.homeId === id), `${id} home`).toHaveLength(7);
          expect(games.filter((g) => g.awayId === id), `${id} away`).toHaveLength(7);
        }
      });

      it('gives every team 6 divisional, 4 sister-division and 4 inter-conference games', () => {
        for (const team of teams) {
          const id = team.identity.id;
          const div = divisionOf(teams, id);
          const conf = conferenceOf(teams, id);
          const games = schedule.filter((g) => g.homeId === id || g.awayId === id);
          let divisional = 0;
          let sister = 0;
          let inter = 0;
          for (const g of games) {
            const other = g.homeId === id ? g.awayId : g.homeId;
            if (divisionOf(teams, other) === div) divisional++;
            else if (conferenceOf(teams, other) === conf) sister++;
            else inter++;
          }
          expect(divisional, `${id} divisional`).toBe(6);
          expect(sister, `${id} sister`).toBe(4);
          expect(inter, `${id} inter`).toBe(4);
        }
      });

      it('plays each divisional rival exactly twice, home and away', () => {
        const groups = divisionGroups(teams);
        for (const group of groups) {
          for (const a of group) {
            for (const b of group) {
              if (a === b) continue;
              const meetings = schedule.filter(
                (g) => (g.homeId === a && g.awayId === b) || (g.homeId === b && g.awayId === a),
              );
              expect(meetings, `${a} vs ${b}`).toHaveLength(2);
              expect(meetings.filter((g) => g.homeId === a)).toHaveLength(1);
            }
          }
        }
      });

      it('plays every sister-division and inter-conference opponent exactly once', () => {
        for (const team of teams) {
          const id = team.identity.id;
          const div = divisionOf(teams, id);
          const opponents = schedule
            .filter((g) => g.homeId === id || g.awayId === id)
            .map((g) => (g.homeId === id ? g.awayId : g.homeId))
            .filter((o) => divisionOf(teams, o) !== div);
          expect(new Set(opponents).size, id).toBe(8);
        }
      });

      it('uses unique, well-formed game ids', () => {
        const ids = new Set(schedule.map((g) => g.id));
        expect(ids.size).toBe(schedule.length);
        for (const g of schedule) {
          expect(g.id).toBe(
            `S${seasonIndex + 1}-W${String(g.week).padStart(2, '0')}-${g.awayId}@${g.homeId}`,
          );
        }
      });
    });
  }

  it('is deterministic', () => {
    const league = generateLeague(SEED, 0);
    expect(generateSchedule(SEED, 0, league.teams)).toEqual(generateSchedule(SEED, 0, league.teams));
  });

  it('rotates inter-conference pairings between seasons', () => {
    const league = generateLeague(SEED, 0);
    const s0 = generateSchedule(SEED, 0, league.teams).map((g) => `${g.awayId}@${g.homeId}`);
    const s1 = generateSchedule(SEED, 1, league.teams).map((g) => `${g.awayId}@${g.homeId}`);
    expect(s0).not.toEqual(s1);
  });
});
