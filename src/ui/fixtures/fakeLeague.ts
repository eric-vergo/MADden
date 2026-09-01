// Plausible fixture league for the UI demo and for tests that need real-shaped
// data. Deterministic (seeded Rng) but NOT the real generator — meta/league.ts
// owns that. Nothing here is imported by shipping screens; only FakeUiServices.

import { Rng, hashSeed } from '../../sim/rng';
import type {
  Athlete, GameStats, PlayerGameStats, Position, Ratings, TeamGameStats, TeamRoster,
} from '../../sim/types';
import type {
  GameResultLite, LeagueState, PlayerSeasonStats, ScheduledGame, StandingRow, Team,
} from '../../meta/types';
import { TEAM_IDENTITIES } from './teamIdentities';

const ROSTER_PLAN: ReadonlyArray<[Position, number]> = [
  ['QB', 2], ['RB', 3], ['WR', 5], ['TE', 2], ['OL', 7],
  ['DL', 6], ['LB', 6], ['CB', 4], ['S', 3], ['K', 1], ['P', 1],
];

const FIRST_NAMES = [
  'Aaron', 'Andre', 'Antoine', 'Austin', 'Blake', 'Brandon', 'Bryce', 'Caleb',
  'Cameron', 'Cedric', 'Chase', 'Cole', 'Cordell', 'Curtis', 'Damon', 'Dante',
  'Darius', 'Darnell', 'Derek', 'Devin', 'Dexter', 'Dominic', 'Dwayne', 'Elijah',
  'Emmett', 'Evan', 'Ezra', 'Felix', 'Garrett', 'Grant', 'Hakeem', 'Hector',
  'Isaiah', 'Jabari', 'Jamal', 'Jared', 'Jasper', 'Javon', 'Jerome', 'Jonah',
  'Jordan', 'Julius', 'Kareem', 'Keenan', 'Kendall', 'Khalil', 'Landon', 'Levi',
  'Lionel', 'Malcolm', 'Marcel', 'Marshall', 'Mason', 'Micah', 'Miles', 'Nate',
  'Omar', 'Orlando', 'Preston', 'Quincy', 'Rashad', 'Reggie', 'Roman', 'Ruben',
  'Silas', 'Spencer', 'Sterling', 'Tariq', 'Terrence', 'Theo', 'Trevon', 'Xavier',
];

const LAST_NAMES = [
  'Abernathy', 'Alston', 'Ashworth', 'Banks', 'Barrow', 'Beaumont', 'Bellamy',
  'Blackwood', 'Boone', 'Brantley', 'Briggs', 'Calloway', 'Carmichael', 'Carver',
  'Chastain', 'Coleman', 'Crawford', 'Crenshaw', 'Dalton', 'Dillard', 'Donovan',
  'Draper', 'Driscoll', 'Dunbar', 'Eastwood', 'Ellsworth', 'Fairbanks', 'Farrow',
  'Finch', 'Fontaine', 'Forsythe', 'Galloway', 'Garner', 'Gentry', 'Granger',
  'Gresham', 'Hale', 'Hargrove', 'Harmon', 'Hawthorne', 'Hendrix', 'Holloway',
  'Huxley', 'Ingram', 'Jarvis', 'Keating', 'Kendrick', 'Kincaid', 'Landry',
  'Larkin', 'Latimer', 'Lockhart', 'Maddox', 'Marlow', 'Mercer', 'Merritt',
  'Monroe', 'Mosley', 'Nash', 'Northcutt', 'Oakes', 'Osborne', 'Pemberton',
  'Presley', 'Radcliffe', 'Ramsey', 'Redmond', 'Rhodes', 'Ridley', 'Rockwell',
  'Saldana', 'Sexton', 'Shepard', 'Slade', 'Stanton', 'Steele', 'Sutton',
  'Tanner', 'Thorne', 'Tillman', 'Trask', 'Vance', 'Vaughn', 'Whitaker',
  'Wilder', 'Winslow', 'Woodard', 'Yardley', 'Zeller',
];

const PRIMARY_ATTRS: Record<Position, readonly (keyof Ratings)[]> = {
  QB: ['tha', 'thp', 'awr', 'spd', 'agi'],
  RB: ['spd', 'acc', 'agi', 'car', 'btk', 'elu'],
  WR: ['spd', 'acc', 'agi', 'cth', 'elu'],
  TE: ['cth', 'rbk', 'pbk', 'str'],
  OL: ['pbk', 'rbk', 'str', 'awr'],
  DL: ['shd', 'str', 'tak', 'acc'],
  LB: ['tak', 'shd', 'mcv', 'zcv', 'spd'],
  CB: ['mcv', 'zcv', 'spd', 'acc', 'agi'],
  S: ['zcv', 'mcv', 'tak', 'spd'],
  K: ['kpw', 'kac', 'awr'],
  P: ['kpw', 'kac', 'awr'],
};

const DROPOFF: Record<Position, number> = {
  QB: 8, RB: 5, WR: 4, TE: 6, OL: 3, DL: 4, LB: 4, CB: 5, S: 5, K: 0, P: 0,
};

const JERSEY_POOLS: Record<Position, ReadonlyArray<readonly [number, number]>> = {
  QB: [[1, 19]], RB: [[20, 39]], WR: [[10, 19], [80, 89]], TE: [[80, 89], [40, 49]],
  OL: [[50, 79]], DL: [[90, 99], [60, 79]], LB: [[40, 59], [90, 99]],
  CB: [[20, 39]], S: [[20, 49]], K: [[1, 9]], P: [[1, 9]],
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function makeRatings(rng: Rng, pos: Position, target: number): Ratings {
  const primary = new Set<string>(PRIMARY_ATTRS[pos]);
  const keys: (keyof Ratings)[] = [
    'spd', 'acc', 'agi', 'str', 'awr', 'cth', 'car', 'btk', 'elu', 'thp',
    'tha', 'tak', 'hpw', 'pbk', 'rbk', 'shd', 'mcv', 'zcv', 'kpw', 'kac',
  ];
  const out = {} as Ratings;
  for (const k of keys) {
    out[k] = primary.has(k)
      ? clamp(Math.round(target + rng.gauss() * 4), 40, 99)
      : clamp(Math.round(45 + rng.next() * 20), 40, 65);
  }
  return out;
}

function overallFor(pos: Position, r: Ratings): number {
  const blk = (r.pbk + r.rbk) / 2;
  switch (pos) {
    case 'QB': return Math.round(0.30 * r.tha + 0.20 * r.thp + 0.25 * r.awr + 0.10 * r.spd + 0.10 * r.agi + 0.05 * r.acc);
    case 'RB': return Math.round(0.25 * r.spd + 0.15 * r.acc + 0.20 * r.agi + 0.10 * r.str + 0.15 * r.car + 0.15 * r.btk);
    case 'WR': return Math.round(0.28 * r.spd + 0.15 * r.acc + 0.15 * r.agi + 0.30 * r.cth + 0.12 * r.awr);
    case 'TE': return Math.round(0.35 * r.cth + 0.25 * blk + 0.20 * r.str + 0.12 * r.spd + 0.08 * r.awr);
    case 'OL': return Math.round(0.45 * blk + 0.30 * r.str + 0.15 * r.awr + 0.10 * r.agi);
    case 'DL': return Math.round(0.35 * r.shd + 0.30 * r.str + 0.20 * r.tak + 0.15 * r.acc);
    case 'LB': return Math.round(0.28 * r.tak + 0.20 * (r.mcv + r.zcv) / 2 + 0.17 * r.shd + 0.20 * r.spd + 0.15 * r.awr);
    case 'CB': return Math.round(0.35 * (r.mcv * 0.7 + r.zcv * 0.3) + 0.25 * r.spd + 0.15 * r.acc + 0.15 * r.agi + 0.10 * r.awr);
    case 'S': return Math.round(0.30 * (r.zcv * 0.7 + r.mcv * 0.3) + 0.25 * r.tak + 0.25 * r.spd + 0.20 * r.awr);
    case 'K':
    case 'P': return Math.round(0.55 * r.kac + 0.35 * r.kpw + 0.10 * r.awr);
  }
}

function makeRoster(teamId: string, seed: number, tier: number): TeamRoster {
  const identity = TEAM_IDENTITIES.find((t) => t.id === teamId);
  const rng = new Rng(hashSeed(seed, 'fake-roster', teamId));
  const athletes: Athlete[] = [];
  const depth: Record<Position, string[]> = {
    QB: [], RB: [], WR: [], TE: [], OL: [], DL: [], LB: [], CB: [], S: [], K: [], P: [],
  };
  const usedJerseys = new Set<number>();
  const usedNames = new Set<string>();
  let counter = 0;

  for (const [pos, count] of ROSTER_PLAN) {
    const groupMean = clamp(tier + rng.gauss() * 4, 55, 92);
    for (let k = 0; k < count; k++) {
      const target = clamp(groupMean - k * DROPOFF[pos] + rng.gauss() * 3, 42, 97);
      const ratings = makeRatings(rng, pos, target);
      let jersey = 0;
      for (let tries = 0; tries < 60; tries++) {
        const pool = rng.pick(JERSEY_POOLS[pos]);
        const cand = rng.int(pool[0], pool[1]);
        if (!usedJerseys.has(cand)) { jersey = cand; break; }
      }
      if (jersey === 0) { jersey = 1; while (usedJerseys.has(jersey)) jersey++; }
      usedJerseys.add(jersey);

      let firstName = rng.pick(FIRST_NAMES);
      let lastName = rng.pick(LAST_NAMES);
      for (let tries = 0; tries < 20 && usedNames.has(`${firstName} ${lastName}`); tries++) {
        firstName = rng.pick(FIRST_NAMES);
        lastName = rng.pick(LAST_NAMES);
      }
      usedNames.add(`${firstName} ${lastName}`);

      const id = `${teamId}-${counter++}`;
      athletes.push({
        id, firstName, lastName, jersey, pos,
        age: rng.int(pos === 'QB' ? 22 : 21, pos === 'RB' ? 30 : 34),
        ratings,
        overall: overallFor(pos, ratings),
      });
      depth[pos].push(id);
    }
  }

  return {
    teamId,
    city: identity?.city ?? teamId,
    nickname: identity?.nickname ?? 'Team',
    abbrev: teamId,
    colors: identity?.colors ?? { primary: '#1B3A6B', secondary: '#E8B93E' },
    athletes,
    depth,
    returners: { kr: depth.RB[1] ?? depth.RB[0] ?? '', pr: depth.WR[2] ?? depth.WR[0] ?? '' },
  };
}

function avgOverall(roster: TeamRoster, pos: Position, from: number, count: number): number {
  const ids = roster.depth[pos].slice(from, from + count);
  if (ids.length === 0) return 60;
  let sum = 0;
  for (const id of ids) sum += roster.athletes.find((a) => a.id === id)?.overall ?? 60;
  return sum / ids.length;
}

function teamRatings(roster: TeamRoster): { ovr: number; off: number; def: number } {
  const off =
    avgOverall(roster, 'QB', 0, 1) * 0.30 +
    avgOverall(roster, 'RB', 0, 1) * 0.12 +
    avgOverall(roster, 'WR', 0, 3) * 0.25 +
    avgOverall(roster, 'TE', 0, 1) * 0.08 +
    avgOverall(roster, 'OL', 0, 5) * 0.25;
  const def =
    avgOverall(roster, 'DL', 0, 4) * 0.35 +
    avgOverall(roster, 'LB', 0, 3) * 0.25 +
    avgOverall(roster, 'CB', 0, 2) * 0.25 +
    avgOverall(roster, 'S', 0, 2) * 0.15;
  const kick = avgOverall(roster, 'K', 0, 1);
  return {
    off: Math.round(off),
    def: Math.round(def),
    ovr: Math.round(0.5 * off + 0.45 * def + 0.05 * kick),
  };
}

export function makeFakeLeague(seed: number, seasonIndex = 0): LeagueState {
  const rng = new Rng(hashSeed(seed, 'fake-tiers', seasonIndex));
  const tiers = TEAM_IDENTITIES.map((t) => ({ id: t.id, roll: 75 + rng.gauss() * 6 }));
  const ranked = [...tiers].sort((a, b) => b.roll - a.roll);
  const tierById = new Map<string, number>();
  ranked.forEach((t, i) => {
    tierById.set(t.id, 86 - (i / Math.max(1, ranked.length - 1)) * 20);
  });

  const teams: Team[] = TEAM_IDENTITIES.map((identity) => {
    const roster = makeRoster(identity.id, hashSeed(seed, 'season', seasonIndex), tierById.get(identity.id) ?? 75);
    const ratings = teamRatings(roster);
    return { identity, roster, ...ratings };
  });
  return { leagueSeed: seed, seasonIndex, teams };
}

// ---------------------------------------------------------------------------
// Schedule (round-robin circle method — NOT the real 6/4/4 structure)
// ---------------------------------------------------------------------------

export function makeFakeSchedule(teamIds: readonly string[], seasonIndex: number): ScheduledGame[] {
  const n = teamIds.length;
  let arr = [...teamIds];
  const games: ScheduledGame[] = [];
  for (let week = 1; week <= 14; week++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === undefined || b === undefined) continue;
      const homeFirst = (week + i) % 2 === 0;
      const homeId = homeFirst ? a : b;
      const awayId = homeFirst ? b : a;
      games.push({
        id: `S${seasonIndex + 1}-W${String(week).padStart(2, '0')}-${awayId}@${homeId}`,
        week,
        homeId,
        awayId,
      });
    }
    const head = arr[0];
    const tail = arr[n - 1];
    if (head !== undefined && tail !== undefined) arr = [head, tail, ...arr.slice(1, n - 1)];
  }
  return games;
}

export function simulateResult(game: ScheduledGame, teams: readonly Team[], seed: number): GameResultLite {
  const rng = new Rng(hashSeed(seed, 'fake-result', game.id));
  const home = teams.find((t) => t.identity.id === game.homeId);
  const away = teams.find((t) => t.identity.id === game.awayId);
  const edge = ((home?.ovr ?? 75) - (away?.ovr ?? 75)) * 0.35 + 1.5;
  const score = (bias: number): number => {
    const td = clamp(Math.round(2.1 + bias * 0.07 + rng.gauss() * 1.1), 0, 6);
    const fg = clamp(Math.round(1.3 + rng.gauss() * 0.9), 0, 4);
    return td * 7 + fg * 3;
  };
  let homeScore = score(edge);
  let awayScore = score(-edge);
  let ot = false;
  if (homeScore === awayScore) {
    ot = true;
    if (rng.chance(0.5)) homeScore += 3;
    else awayScore += 3;
  }
  return { homeScore, awayScore, ot };
}

export function computeStandings(
  teamIds: readonly string[],
  schedule: readonly ScheduledGame[],
  identityOf: (id: string) => { conference: string; division: string } | undefined,
): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const id of teamIds) {
    rows.set(id, { teamId: id, w: 0, l: 0, t: 0, pf: 0, pa: 0, divW: 0, divL: 0, confW: 0, confL: 0 });
  }
  for (const g of schedule) {
    const r = g.result;
    if (!r) continue;
    const home = rows.get(g.homeId);
    const away = rows.get(g.awayId);
    if (!home || !away) continue;
    home.pf += r.homeScore; home.pa += r.awayScore;
    away.pf += r.awayScore; away.pa += r.homeScore;
    const hi = identityOf(g.homeId);
    const ai = identityOf(g.awayId);
    const sameConf = hi !== undefined && ai !== undefined && hi.conference === ai.conference;
    const sameDiv = sameConf && hi?.division === ai?.division;
    if (r.homeScore === r.awayScore) {
      home.t++; away.t++;
    } else if (r.homeScore > r.awayScore) {
      home.w++; away.l++;
      if (sameConf) { home.confW++; away.confL++; }
      if (sameDiv) { home.divW++; away.divL++; }
    } else {
      away.w++; home.l++;
      if (sameConf) { away.confW++; home.confL++; }
      if (sameDiv) { away.divW++; home.divL++; }
    }
  }
  return [...rows.values()].sort((a, b) => (a.teamId < b.teamId ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Stats synthesis
// ---------------------------------------------------------------------------

export function emptyPlayerGameStats(athleteId: string): PlayerGameStats {
  return {
    athleteId,
    passAtt: 0, passCmp: 0, passYds: 0, passTD: 0, passInt: 0,
    rushAtt: 0, rushYds: 0, rushTD: 0, fumbles: 0,
    tgt: 0, rec: 0, recYds: 0, recTD: 0,
    tackles: 0, sacks: 0, defInt: 0, ffum: 0,
    fgm: 0, fga: 0, xpm: 0, xpa: 0,
    punts: 0, puntYds: 0,
    krYds: 0, prYds: 0, retTD: 0,
  };
}

function emptyTeamStats(teamId: string): TeamGameStats {
  return {
    teamId, points: 0, totalYds: 0, passYds: 0, rushYds: 0, firstDowns: 0,
    thirdDownConv: 0, thirdDownAtt: 0, turnovers: 0, penalties: 0, penaltyYds: 0,
    topSeconds: 0, sacksAllowed: 0,
  };
}

function starterId(team: Team, pos: Position, index: number): string | undefined {
  return team.roster.depth[pos][index];
}

function fillTeamStats(
  rng: Rng,
  team: Team,
  points: number,
  players: Record<string, PlayerGameStats>,
): TeamGameStats {
  const stats = emptyTeamStats(team.identity.id);
  stats.points = points;
  const totalTd = Math.max(0, Math.floor(points / 7));
  const passTd = Math.min(totalTd, rng.int(0, totalTd));
  const rushTd = totalTd - passTd;
  const fgm = Math.max(0, Math.round((points - totalTd * 7) / 3));

  const passYds = clamp(Math.round(180 + rng.gauss() * 55 + passTd * 18), 60, 430);
  const rushYds = clamp(Math.round(105 + rng.gauss() * 35 + rushTd * 14), 20, 260);
  stats.passYds = passYds;
  stats.rushYds = rushYds;
  stats.totalYds = passYds + rushYds;
  stats.firstDowns = Math.round(stats.totalYds / 17) + rng.int(0, 3);
  stats.thirdDownAtt = rng.int(10, 16);
  stats.thirdDownConv = rng.int(2, Math.max(3, Math.round(stats.thirdDownAtt * 0.55)));
  stats.turnovers = rng.int(0, 3);
  stats.penalties = rng.int(2, 8);
  stats.penaltyYds = stats.penalties * rng.int(5, 11);
  stats.sacksAllowed = rng.int(0, 4);
  stats.topSeconds = 1800 + Math.round(rng.gauss() * 180);

  const ensure = (id: string | undefined): PlayerGameStats | null => {
    if (id === undefined) return null;
    const existing = players[id];
    if (existing) return existing;
    const fresh = emptyPlayerGameStats(id);
    players[id] = fresh;
    return fresh;
  };

  const qb = ensure(starterId(team, 'QB', 0));
  if (qb) {
    qb.passYds = passYds;
    qb.passAtt = Math.max(12, Math.round(passYds / 7.2));
    qb.passCmp = Math.round(qb.passAtt * clamp(0.55 + rng.next() * 0.15, 0.45, 0.72));
    qb.passTD = passTd;
    qb.passInt = Math.min(stats.turnovers, rng.int(0, 2));
  }

  const rushShares = [0.6, 0.26, 0.14];
  const rbIds = [starterId(team, 'RB', 0), starterId(team, 'RB', 1), starterId(team, 'QB', 0)];
  rbIds.forEach((id, i) => {
    const p = ensure(id);
    if (!p) return;
    const share = rushShares[i] ?? 0;
    const yds = Math.round(rushYds * share);
    p.rushYds += yds;
    p.rushAtt += Math.max(1, Math.round(yds / clamp(4.2 + rng.gauss() * 0.8, 2.5, 6.5)));
    if (i === 0 && rushTd > 0) p.rushTD += rushTd;
  });

  const recTargets: Array<[string | undefined, number]> = [
    [starterId(team, 'WR', 0), 0.3], [starterId(team, 'WR', 1), 0.21],
    [starterId(team, 'WR', 2), 0.13], [starterId(team, 'TE', 0), 0.17],
    [starterId(team, 'RB', 0), 0.12], [starterId(team, 'WR', 3), 0.07],
  ];
  let tdLeft = passTd;
  for (const [id, share] of recTargets) {
    const p = ensure(id);
    if (!p) continue;
    const yds = Math.round(passYds * share);
    p.recYds += yds;
    p.rec += Math.max(1, Math.round(yds / clamp(12 + rng.gauss() * 3, 6, 22)));
    p.tgt += p.rec + rng.int(0, 3);
    if (tdLeft > 0 && rng.chance(0.5)) { p.recTD += 1; tdLeft--; }
  }
  const wr1 = ensure(starterId(team, 'WR', 0));
  if (wr1 && tdLeft > 0) wr1.recTD += tdLeft;

  const kicker = ensure(starterId(team, 'K', 0));
  if (kicker) {
    kicker.fgm += fgm;
    kicker.fga += fgm + (rng.chance(0.35) ? 1 : 0);
    kicker.xpm += totalTd;
    kicker.xpa += totalTd;
  }
  const punter = ensure(starterId(team, 'P', 0));
  if (punter) {
    punter.punts += rng.int(3, 7);
    punter.puntYds += punter.punts * rng.int(38, 50);
  }

  const returner = ensure(team.roster.returners.kr);
  if (returner) returner.krYds += rng.int(20, 95);

  // Defense: spread tackles LB-heavy, sacks to the best DL.
  const defIds: Array<[string | undefined, number]> = [
    [starterId(team, 'LB', 0), 9], [starterId(team, 'LB', 1), 7], [starterId(team, 'LB', 2), 5],
    [starterId(team, 'S', 0), 6], [starterId(team, 'S', 1), 5],
    [starterId(team, 'CB', 0), 4], [starterId(team, 'CB', 1), 4],
    [starterId(team, 'DL', 0), 4], [starterId(team, 'DL', 1), 3],
    [starterId(team, 'DL', 2), 3], [starterId(team, 'DL', 3), 2],
  ];
  for (const [id, base] of defIds) {
    const p = ensure(id);
    if (!p) continue;
    p.tackles += Math.max(0, base + rng.int(-2, 2));
  }
  const bestDl = ensure(starterId(team, 'DL', 0));
  if (bestDl) bestDl.sacks += rng.int(0, 2);
  const edge = ensure(starterId(team, 'DL', 3));
  if (edge && rng.chance(0.5)) edge.sacks += 1;
  const cb = ensure(starterId(team, 'CB', 0));
  if (cb && rng.chance(0.35)) cb.defInt += 1;

  return stats;
}

export function makeFakeBoxScore(
  gameId: string,
  home: Team,
  away: Team,
  result: GameResultLite,
  seed: number,
): GameStats {
  const rng = new Rng(hashSeed(seed, 'fake-box', gameId));
  const players: Record<string, PlayerGameStats> = {};
  const homeTeam = fillTeamStats(rng, home, result.homeScore, players);
  const awayTeam = fillTeamStats(rng, away, result.awayScore, players);
  homeTeam.topSeconds = clamp(homeTeam.topSeconds, 1200, 2400);
  awayTeam.topSeconds = 3600 - homeTeam.topSeconds;
  return {
    teams: [homeTeam, awayTeam],
    players,
    scoringByQuarter: [
      splitByQuarter(rng, result.homeScore, result.ot),
      splitByQuarter(rng, result.awayScore, result.ot),
    ],
  };
}

function splitByQuarter(rng: Rng, points: number, ot: boolean): number[] {
  const quarters = ot ? 5 : 4;
  const out = new Array<number>(quarters).fill(0);
  let left = points;
  const chunks: number[] = [];
  while (left >= 7 && rng.chance(0.8)) { chunks.push(7); left -= 7; }
  while (left >= 3) { chunks.push(3); left -= 3; }
  if (left > 0) chunks.push(left);
  for (const c of chunks) {
    const q = rng.int(0, quarters - 1);
    out[q] = (out[q] ?? 0) + c;
  }
  return out;
}

export function emptySeasonStats(athleteId: string, teamId: string): PlayerSeasonStats {
  return { ...emptyPlayerGameStats(athleteId), athleteId, teamId, gamesPlayed: 0 };
}

/** Fold a game box score into cumulative season stats. */
export function accumulateSeasonStats(
  season: Record<string, PlayerSeasonStats>,
  stats: GameStats,
  teamOf: (athleteId: string) => string,
): void {
  for (const id of Object.keys(stats.players).sort()) {
    const p = stats.players[id];
    if (!p) continue;
    const teamId = teamOf(id);
    const existing = season[id] ?? emptySeasonStats(id, teamId);
    existing.gamesPlayed += 1;
    existing.passAtt += p.passAtt; existing.passCmp += p.passCmp; existing.passYds += p.passYds;
    existing.passTD += p.passTD; existing.passInt += p.passInt;
    existing.rushAtt += p.rushAtt; existing.rushYds += p.rushYds; existing.rushTD += p.rushTD;
    existing.fumbles += p.fumbles;
    existing.tgt += p.tgt; existing.rec += p.rec; existing.recYds += p.recYds; existing.recTD += p.recTD;
    existing.tackles += p.tackles; existing.sacks += p.sacks; existing.defInt += p.defInt; existing.ffum += p.ffum;
    existing.fgm += p.fgm; existing.fga += p.fga; existing.xpm += p.xpm; existing.xpa += p.xpa;
    existing.punts += p.punts; existing.puntYds += p.puntYds;
    existing.krYds += p.krYds; existing.prYds += p.prYds; existing.retTD += p.retTD;
    season[id] = existing;
  }
}

