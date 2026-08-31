// 14-week regular season, no byes, 8 games a week.
// Per team: 6 divisional (circle method, H/A flipped in the second block),
// 4 sister-division and 4 inter-conference (Latin square, rotated by season).
// Interleave order: [D1 C1 I1 D2 C2 I2 D3 C3 I3 D4 C4 I4 D5 D6].

import type { ConferenceName, DivisionName, ScheduledGame, Team, TeamIdentity } from './types';
import { req } from './util';

export const REGULAR_SEASON_WEEKS = 14;
export const GAMES_PER_WEEK = 8;

const CONFERENCES: readonly ConferenceName[] = ['Atlantic', 'Pacific'];
const DIVISIONS: readonly DivisionName[] = ['North', 'South'];

interface Pairing {
  homeId: string;
  awayId: string;
}

export function divisionKey(identity: TeamIdentity): string {
  return `${identity.conference}/${identity.division}`;
}

/** The four divisions in canonical order: AN, AS, PN, PS. */
export function divisionGroups(teams: readonly Team[]): string[][] {
  const groups: string[][] = [];
  for (let c = 0; c < CONFERENCES.length; c++) {
    for (let d = 0; d < DIVISIONS.length; d++) {
      const conf = req(CONFERENCES, c);
      const div = req(DIVISIONS, d);
      const members: string[] = [];
      for (let i = 0; i < teams.length; i++) {
        const t = req(teams, i);
        if (t.identity.conference === conf && t.identity.division === div) members.push(t.identity.id);
      }
      groups.push(members);
    }
  }
  return groups;
}

/**
 * Circle method over 4 teams: 3 rounds, every pair exactly once.
 * Round r pairs list[i] with list[n-1-i] after rotating all but the first slot.
 */
function circleRounds(members: readonly string[]): string[][][] {
  const n = members.length;
  const list = members.slice();
  const rounds: string[][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: string[][] = [];
    for (let i = 0; i < n / 2; i++) pairs.push([req(list, i), req(list, n - 1 - i)]);
    rounds.push(pairs);
    // rotate everything but index 0
    const tail = list.slice(1);
    tail.unshift(req(tail, tail.length - 1));
    tail.pop();
    for (let i = 0; i < tail.length; i++) list[i + 1] = req(tail, i);
  }
  return rounds;
}

/** 6 divisional rounds per division: rounds 1–3, then the same pairs flipped. */
function divisionalRounds(groups: readonly string[][]): Pairing[][] {
  const rounds: Pairing[][] = [];
  for (let r = 0; r < 6; r++) rounds.push([]);
  for (let g = 0; g < groups.length; g++) {
    const members = req(groups, g);
    const base = circleRounds(members);
    for (let r = 0; r < base.length; r++) {
      const pairs = req(base, r);
      for (let i = 0; i < pairs.length; i++) {
        const pair = req(pairs, i);
        const x = req(pair, 0);
        const y = req(pair, 1);
        // Alternate which side of the pair hosts in the first block; the second
        // block flips every game, so every team finishes 3H/3A in-division.
        const xHostsFirst = (r + i) % 2 === 0;
        req(rounds, r).push(xHostsFirst ? { homeId: x, awayId: y } : { homeId: y, awayId: x });
        req(rounds, r + 3).push(xHostsFirst ? { homeId: y, awayId: x } : { homeId: x, awayId: y });
      }
    }
  }
  return rounds;
}

/**
 * 4 rounds pairing division A against division B. Round w pairs A[i] with
 * B[(i+w+rotation) % 4]; A hosts when (i + j) is even, which gives every team
 * in both divisions exactly 2 home and 2 away games.
 */
function crossRounds(a: readonly string[], b: readonly string[], rotation: number): Pairing[][] {
  const rounds: Pairing[][] = [];
  const n = a.length;
  for (let w = 0; w < n; w++) {
    const pairs: Pairing[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + w + rotation) % n;
      const x = req(a, i);
      const y = req(b, j);
      pairs.push((i + j) % 2 === 0 ? { homeId: x, awayId: y } : { homeId: y, awayId: x });
    }
    rounds.push(pairs);
  }
  return rounds;
}

export function gameId(seasonIndex: number, week: number, awayId: string, homeId: string): string {
  return `S${seasonIndex + 1}-W${String(week).padStart(2, '0')}-${awayId}@${homeId}`;
}

export function generateSchedule(
  leagueSeed: number,
  seasonIndex: number,
  teams: readonly Team[],
): ScheduledGame[] {
  void leagueSeed; // schedule shape is fully determined by seasonIndex + divisions
  const groups = divisionGroups(teams);
  const [an, as, pn, ps] = [req(groups, 0), req(groups, 1), req(groups, 2), req(groups, 3)];

  const divRounds = divisionalRounds(groups);

  // Sister division = the other division in the same conference.
  const confRounds: Pairing[][] = [];
  const anAs = crossRounds(an, as, seasonIndex % 4);
  const pnPs = crossRounds(pn, ps, seasonIndex % 4);
  for (let w = 0; w < 4; w++) confRounds.push([...req(anAs, w), ...req(pnPs, w)]);

  // Inter-conference division pairing rotates with the season index.
  const swap = seasonIndex % 2 === 1;
  const interRounds: Pairing[][] = [];
  const first = crossRounds(an, swap ? ps : pn, seasonIndex % 4);
  const second = crossRounds(as, swap ? pn : ps, (seasonIndex + 2) % 4);
  for (let w = 0; w < 4; w++) interRounds.push([...req(first, w), ...req(second, w)]);

  // [D1 C1 I1 D2 C2 I2 D3 C3 I3 D4 C4 I4 D5 D6]
  const order: Pairing[][] = [
    req(divRounds, 0), req(confRounds, 0), req(interRounds, 0),
    req(divRounds, 1), req(confRounds, 1), req(interRounds, 1),
    req(divRounds, 2), req(confRounds, 2), req(interRounds, 2),
    req(divRounds, 3), req(confRounds, 3), req(interRounds, 3),
    req(divRounds, 4), req(divRounds, 5),
  ];

  const games: ScheduledGame[] = [];
  for (let w = 0; w < order.length; w++) {
    const week = w + 1;
    const pairs = req(order, w).slice();
    pairs.sort((p, q) => (p.homeId < q.homeId ? -1 : p.homeId > q.homeId ? 1 : 0));
    for (let i = 0; i < pairs.length; i++) {
      const p = req(pairs, i);
      games.push({
        id: gameId(seasonIndex, week, p.awayId, p.homeId),
        week,
        homeId: p.homeId,
        awayId: p.awayId,
      });
    }
  }
  return games;
}

export function gamesInWeek(schedule: readonly ScheduledGame[], week: number): ScheduledGame[] {
  const out: ScheduledGame[] = [];
  for (let i = 0; i < schedule.length; i++) {
    const g = req(schedule, i);
    if (g.week === week) out.push(g);
  }
  return out;
}

export function findTeamGame(
  schedule: readonly ScheduledGame[],
  week: number,
  teamId: string,
): ScheduledGame | null {
  for (let i = 0; i < schedule.length; i++) {
    const g = req(schedule, i);
    if (g.week === week && (g.homeId === teamId || g.awayId === teamId)) return g;
  }
  return null;
}
