// Standings rows from completed results + the tiebreaker ladder:
// win% -> head-to-head (only when exactly two teams are tied) -> division win%
// -> point differential -> seeded coin.

import { hashSeed } from '../sim/rng';
import type { ScheduledGame, StandingRow, Team } from './types';
import { findTeam } from './league';
import { req } from './util';

export function emptyRow(teamId: string): StandingRow {
  return { teamId, w: 0, l: 0, t: 0, pf: 0, pa: 0, divW: 0, divL: 0, confW: 0, confL: 0 };
}

export function winPct(r: Readonly<StandingRow>): number {
  const games = r.w + r.l + r.t;
  return games === 0 ? 0 : (r.w + 0.5 * r.t) / games;
}

export function divWinPct(r: Readonly<StandingRow>): number {
  const games = r.divW + r.divL;
  return games === 0 ? 0 : r.divW / games;
}

export function pointDiff(r: Readonly<StandingRow>): number {
  return r.pf - r.pa;
}

/**
 * Build one row per team from every game that has a result. Only regular-season
 * games (week <= maxWeek) count toward standings.
 */
export function computeStandings(
  teams: readonly Team[],
  schedule: readonly ScheduledGame[],
  maxWeek = 14,
): StandingRow[] {
  const rows: StandingRow[] = [];
  const index = new Map<string, number>();
  for (let i = 0; i < teams.length; i++) {
    const t = req(teams, i);
    index.set(t.identity.id, rows.length);
    rows.push(emptyRow(t.identity.id));
  }

  for (let i = 0; i < schedule.length; i++) {
    const g = req(schedule, i);
    if (g.result === undefined || g.week > maxWeek) continue;
    const hi = index.get(g.homeId);
    const ai = index.get(g.awayId);
    if (hi === undefined || ai === undefined) continue;
    const home = req(rows, hi);
    const away = req(rows, ai);
    const homeTeam = findTeam(teams, g.homeId);
    const awayTeam = findTeam(teams, g.awayId);
    const sameConf = homeTeam.identity.conference === awayTeam.identity.conference;
    const sameDiv = sameConf && homeTeam.identity.division === awayTeam.identity.division;

    home.pf += g.result.homeScore;
    home.pa += g.result.awayScore;
    away.pf += g.result.awayScore;
    away.pa += g.result.homeScore;

    if (g.result.homeScore === g.result.awayScore) {
      home.t++; away.t++;
    } else {
      const homeWon = g.result.homeScore > g.result.awayScore;
      const winner = homeWon ? home : away;
      const loser = homeWon ? away : home;
      winner.w++;
      loser.l++;
      if (sameDiv) { winner.divW++; loser.divL++; }
      if (sameConf) { winner.confW++; loser.confL++; }
    }
  }
  return rows;
}

/** Head-to-head record of `a` against `b` across completed games. */
export function headToHead(
  schedule: readonly ScheduledGame[],
  a: string,
  b: string,
  maxWeek = 14,
): { w: number; l: number } {
  let w = 0;
  let l = 0;
  for (let i = 0; i < schedule.length; i++) {
    const g = req(schedule, i);
    if (g.result === undefined || g.week > maxWeek) continue;
    const involvesBoth = (g.homeId === a && g.awayId === b) || (g.homeId === b && g.awayId === a);
    if (!involvesBoth) continue;
    if (g.result.homeScore === g.result.awayScore) continue;
    const winnerId = g.result.homeScore > g.result.awayScore ? g.homeId : g.awayId;
    if (winnerId === a) w++; else l++;
  }
  return { w, l };
}

/**
 * Final, deterministic tiebreaker. A per-team hash key (rather than a pairwise
 * flip) keeps the comparator a total order — pairwise coins are not transitive
 * and would make sort results depend on the input permutation.
 */
export function coinKey(leagueSeed: number, seasonIndex: number, teamId: string): number {
  return hashSeed(leagueSeed, 'coin', seasonIndex, teamId);
}

export interface SortContext {
  leagueSeed: number;
  seasonIndex: number;
  schedule: readonly ScheduledGame[];
  maxWeek?: number;
}

function baseCompare(ctx: SortContext, a: StandingRow, b: StandingRow): number {
  const wp = winPct(b) - winPct(a);
  if (Math.abs(wp) > 1e-9) return wp;
  const dw = divWinPct(b) - divWinPct(a);
  if (Math.abs(dw) > 1e-9) return dw;
  const pd = pointDiff(b) - pointDiff(a);
  if (pd !== 0) return pd;
  const ca = coinKey(ctx.leagueSeed, ctx.seasonIndex, a.teamId);
  const cb = coinKey(ctx.leagueSeed, ctx.seasonIndex, b.teamId);
  if (ca !== cb) return ca - cb;
  return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
}

/**
 * Sort rows best-first. Head-to-head only applies to a two-team tie (per the
 * design), so it is applied as a post-pass over each equal-win% run of length 2.
 */
export function sortStandings(rows: readonly StandingRow[], ctx: SortContext): StandingRow[] {
  const maxWeek = ctx.maxWeek ?? 14;
  const out = rows.slice().sort((a, b) => baseCompare(ctx, a, b));
  let i = 0;
  while (i < out.length) {
    let j = i + 1;
    while (j < out.length && Math.abs(winPct(req(out, j)) - winPct(req(out, i))) < 1e-9) j++;
    if (j - i === 2) {
      const a = req(out, i);
      const b = req(out, i + 1);
      const h2h = headToHead(ctx.schedule, a.teamId, b.teamId, maxWeek);
      if (h2h.w !== h2h.l) {
        if (h2h.l > h2h.w) {
          out[i] = b;
          out[i + 1] = a;
        }
      }
    }
    i = j;
  }
  return out;
}

export function rowsFor(rows: readonly StandingRow[], teamIds: ReadonlySet<string>): StandingRow[] {
  const out: StandingRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = req(rows, i);
    if (teamIds.has(r.teamId)) out.push(r);
  }
  return out;
}

export function divisionStandings(
  teams: readonly Team[],
  rows: readonly StandingRow[],
  ctx: SortContext,
  conference: string,
  division: string,
): StandingRow[] {
  const ids = new Set<string>();
  for (let i = 0; i < teams.length; i++) {
    const t = req(teams, i);
    if (t.identity.conference === conference && t.identity.division === division) ids.add(t.identity.id);
  }
  return sortStandings(rowsFor(rows, ids), ctx);
}

export function conferenceStandings(
  teams: readonly Team[],
  rows: readonly StandingRow[],
  ctx: SortContext,
  conference: string,
): StandingRow[] {
  const ids = new Set<string>();
  for (let i = 0; i < teams.length; i++) {
    const t = req(teams, i);
    if (t.identity.conference === conference) ids.add(t.identity.id);
  }
  return sortStandings(rowsFor(rows, ids), ctx);
}

export function findRow(rows: readonly StandingRow[], teamId: string): StandingRow {
  for (let i = 0; i < rows.length; i++) {
    const r = req(rows, i);
    if (r.teamId === teamId) return r;
  }
  throw new Error(`no standing row for ${teamId}`);
}
