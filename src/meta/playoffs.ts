// Playoffs: per conference the two division winners are seeds 1–2 and the two
// best remaining teams are seeds 3–4. W15 semis (1v4, 2v3), W16 conference
// finals, W17 Apex Bowl at a neutral site.

import type {
  ConferenceName, PlayoffBracket, PlayoffSeed, ScheduledGame, StandingRow, Team,
} from './types';
import { gameId } from './schedule';
import { findRow, sortStandings, type SortContext } from './standings';
import { req } from './util';

export const SEMIS_WEEK = 15;
export const CONF_FINAL_WEEK = 16;
export const APEX_BOWL_WEEK = 17;

const CONFERENCES: readonly ConferenceName[] = ['Atlantic', 'Pacific'];
const DIVISIONS: readonly string[] = ['North', 'South'];

/** The Apex Bowl is the only neutral-site game (ScheduledGame has no flag). */
export function isNeutralSite(game: Readonly<ScheduledGame>): boolean {
  return game.week === APEX_BOWL_WEEK;
}

export function seedConference(
  teams: readonly Team[],
  rows: readonly StandingRow[],
  ctx: SortContext,
  conference: ConferenceName,
): PlayoffSeed[] {
  const divisionWinners: StandingRow[] = [];
  const rest: StandingRow[] = [];

  for (let d = 0; d < DIVISIONS.length; d++) {
    const division = req(DIVISIONS, d);
    const members: StandingRow[] = [];
    for (let i = 0; i < teams.length; i++) {
      const t = req(teams, i);
      if (t.identity.conference !== conference || t.identity.division !== division) continue;
      members.push(findRow(rows, t.identity.id));
    }
    const sorted = sortStandings(members, ctx);
    divisionWinners.push(req(sorted, 0));
    for (let i = 1; i < sorted.length; i++) rest.push(req(sorted, i));
  }

  const orderedWinners = sortStandings(divisionWinners, ctx);
  const wildcards = sortStandings(rest, ctx).slice(0, 2);
  const seeds: PlayoffSeed[] = [];
  for (let i = 0; i < orderedWinners.length; i++) {
    seeds.push({ teamId: req(orderedWinners, i).teamId, seed: i + 1, conference });
  }
  for (let i = 0; i < wildcards.length; i++) {
    seeds.push({ teamId: req(wildcards, i).teamId, seed: orderedWinners.length + i + 1, conference });
  }
  return seeds;
}

export function seedPlayoffs(
  teams: readonly Team[],
  rows: readonly StandingRow[],
  ctx: SortContext,
): PlayoffSeed[] {
  const seeds: PlayoffSeed[] = [];
  for (let c = 0; c < CONFERENCES.length; c++) {
    const conf = req(CONFERENCES, c);
    const confSeeds = seedConference(teams, rows, ctx, conf);
    for (let i = 0; i < confSeeds.length; i++) seeds.push(req(confSeeds, i));
  }
  return seeds;
}

function seedOf(seeds: readonly PlayoffSeed[], teamId: string): PlayoffSeed {
  for (let i = 0; i < seeds.length; i++) {
    const s = req(seeds, i);
    if (s.teamId === teamId) return s;
  }
  throw new Error(`${teamId} is not a playoff seed`);
}

function bySeed(seeds: readonly PlayoffSeed[], conference: ConferenceName, seed: number): PlayoffSeed {
  for (let i = 0; i < seeds.length; i++) {
    const s = req(seeds, i);
    if (s.conference === conference && s.seed === seed) return s;
  }
  throw new Error(`no seed ${seed} in ${conference}`);
}

function makeGame(seasonIndex: number, week: number, homeId: string, awayId: string): ScheduledGame {
  return { id: gameId(seasonIndex, week, awayId, homeId), week, homeId, awayId };
}

/** Build the week-15 bracket from the final regular-season standings. */
export function createBracket(
  teams: readonly Team[],
  rows: readonly StandingRow[],
  ctx: SortContext,
  seasonIndex: number,
): PlayoffBracket {
  const seeds = seedPlayoffs(teams, rows, ctx);
  const games: ScheduledGame[] = [];
  for (let c = 0; c < CONFERENCES.length; c++) {
    const conf = req(CONFERENCES, c);
    const s1 = bySeed(seeds, conf, 1);
    const s2 = bySeed(seeds, conf, 2);
    const s3 = bySeed(seeds, conf, 3);
    const s4 = bySeed(seeds, conf, 4);
    games.push(makeGame(seasonIndex, SEMIS_WEEK, s1.teamId, s4.teamId));
    games.push(makeGame(seasonIndex, SEMIS_WEEK, s2.teamId, s3.teamId));
  }
  return { seeds, games };
}

export function winnerOf(game: Readonly<ScheduledGame>): string | null {
  if (game.result === undefined) return null;
  if (game.result.homeScore === game.result.awayScore) return null; // playoffs never tie
  return game.result.homeScore > game.result.awayScore ? game.homeId : game.awayId;
}

function gamesOfWeek(games: readonly ScheduledGame[], week: number): ScheduledGame[] {
  const out: ScheduledGame[] = [];
  for (let i = 0; i < games.length; i++) {
    const g = req(games, i);
    if (g.week === week) out.push(g);
  }
  return out;
}

function allResolved(games: readonly ScheduledGame[]): boolean {
  if (games.length === 0) return false;
  for (let i = 0; i < games.length; i++) {
    if (req(games, i).result === undefined) return false;
  }
  return true;
}

/**
 * Merge completed `results` into the bracket and, when a round is fully
 * resolved, generate the next one. Pure: returns a new bracket.
 */
export function advance(
  bracket: Readonly<PlayoffBracket>,
  results: readonly ScheduledGame[],
  seasonIndex: number,
): PlayoffBracket {
  const byId = new Map<string, ScheduledGame>();
  for (let i = 0; i < results.length; i++) {
    const g = req(results, i);
    byId.set(g.id, g);
  }
  const games: ScheduledGame[] = [];
  for (let i = 0; i < bracket.games.length; i++) {
    const g = req(bracket.games, i);
    const updated = byId.get(g.id);
    games.push(updated !== undefined ? { ...g, result: updated.result ?? g.result } : { ...g });
  }
  // Games that only exist in `results` (e.g. a round generated elsewhere).
  for (let i = 0; i < results.length; i++) {
    const g = req(results, i);
    if (!games.some((x) => x.id === g.id) && g.week >= SEMIS_WEEK) games.push({ ...g });
  }

  const seeds = bracket.seeds;
  const semis = gamesOfWeek(games, SEMIS_WEEK);
  const finals = gamesOfWeek(games, CONF_FINAL_WEEK);
  const bowl = gamesOfWeek(games, APEX_BOWL_WEEK);

  if (allResolved(semis) && finals.length === 0) {
    for (let c = 0; c < CONFERENCES.length; c++) {
      const conf = req(CONFERENCES, c);
      const winners: PlayoffSeed[] = [];
      for (let i = 0; i < semis.length; i++) {
        const g = req(semis, i);
        const w = winnerOf(g);
        if (w === null) continue;
        const s = seedOf(seeds, w);
        if (s.conference === conf) winners.push(s);
      }
      winners.sort((a, b) => a.seed - b.seed);
      if (winners.length === 2) {
        games.push(makeGame(seasonIndex, CONF_FINAL_WEEK, req(winners, 0).teamId, req(winners, 1).teamId));
      }
    }
  }

  const finals2 = gamesOfWeek(games, CONF_FINAL_WEEK);
  if (allResolved(finals2) && bowl.length === 0) {
    const champs: PlayoffSeed[] = [];
    for (let i = 0; i < finals2.length; i++) {
      const w = winnerOf(req(finals2, i));
      if (w !== null) champs.push(seedOf(seeds, w));
    }
    // Better seed is nominal "home"; the Apex Bowl is played at a neutral site.
    champs.sort((a, b) => (a.seed - b.seed) || (a.teamId < b.teamId ? -1 : 1));
    if (champs.length === 2) {
      games.push(makeGame(seasonIndex, APEX_BOWL_WEEK, req(champs, 0).teamId, req(champs, 1).teamId));
    }
  }

  return { seeds, games };
}

/** Apex Bowl winner once it is played, else null. */
export function championOf(bracket: Readonly<PlayoffBracket>): string | null {
  const bowl = gamesOfWeek(bracket.games, APEX_BOWL_WEEK);
  if (bowl.length !== 1) return null;
  return winnerOf(req(bowl, 0));
}
