// Pure table builders shared by the season hub, halftime, and summary screens.
// Everything here is a data → data transform so it can be unit tested without
// a DOM. Iteration over Records is always over sorted keys (determinism rule).

import type { GameStats, PlayerGameStats, TeamSide } from '../sim/types';
import type {
  ConferenceName, PlayerSeasonStats, StandingRow, TeamIdentity,
} from '../meta/types';
import {
  formatAvg, formatConvPct, formatDuration, formatOfPair, formatPct, formatRecord,
  formatSigned, winPct,
} from './format';

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface StandingsDisplayRow {
  teamId: string;
  seedLabel: string; // "1" ... "" — playoff position within the conference
  name: string;
  record: string;
  pct: string;
  pf: number;
  pa: number;
  diff: string;
  divRecord: string;
  confRecord: string;
  isUser: boolean;
}

export interface StandingsGroup {
  conference: ConferenceName;
  division: string; // "Atlantic North"
  rows: StandingsDisplayRow[];
}

export interface StandingsOptions {
  userTeamId?: string;
  conference?: ConferenceName;
  /**
   * Override the ranked-list detection below. `true` renders the caller's order
   * verbatim, `false` always applies `compareStandingRows`.
   */
  preSorted?: boolean;
}

/**
 * Fallback sort key for a raw, unranked list: win% → division win% → point
 * differential → teamId.
 * NOTE: head-to-head (the real tiebreaker #2, meta/standings.ts) and the seeded
 * coin need the schedule and the league seed, which the display layer does not
 * take. So this comparator can only ever approximate the real ladder — it must
 * not be turned loose on a list somebody else already ranked (see `isRanked`).
 */
export function compareStandingRows(a: StandingRow, b: StandingRow): number {
  const pa = winPct(a.w, a.l, a.t);
  const pb = winPct(b.w, b.l, b.t);
  if (pa !== pb) return pb - pa;
  const da = winPct(a.divW, a.divL, 0);
  const db = winPct(b.divW, b.divL, 0);
  if (da !== db) return db - da;
  const diffA = a.pf - a.pa;
  const diffB = b.pf - b.pa;
  if (diffA !== diffB) return diffB - diffA;
  return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
}

/**
 * True when `rows` already arrive best-first. Win% is the meta layer's primary
 * key and everything under it (head-to-head, division record, point diff, the
 * seeded coin) only reorders teams *inside* an equal-win% run, so a win%-
 * monotone list is a ranking somebody else computed with more information than
 * this layer has. Re-sorting one can only lose fidelity; an unordered list
 * (the demo fixture hands over rows in team-id order) still gets sorted.
 */
export function isRanked(rows: readonly StandingRow[]): boolean {
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (!prev || !cur) continue;
    if (winPct(cur.w, cur.l, cur.t) > winPct(prev.w, prev.l, prev.t) + 1e-9) return false;
  }
  return true;
}

/**
 * Group rows into the four division tables. A ranked list keeps the order it
 * arrived in — that order is the meta layer's tiebreaker ladder, the same one
 * the playoff bracket seeds from, and the Standings tab naming a different
 * division winner than the Bracket tab is a contradiction the player can see.
 */
export function buildStandings(
  identities: readonly TeamIdentity[],
  rows: readonly StandingRow[],
  opts: StandingsOptions = {},
): StandingsGroup[] {
  const byId = new Map<string, TeamIdentity>();
  for (const id of identities) byId.set(id.id, id);

  const groups = new Map<string, StandingsGroup>();
  const order: string[] = [];
  const conferences: ConferenceName[] = ['Atlantic', 'Pacific'];
  const divisions = ['North', 'South'];
  for (const conf of conferences) {
    for (const div of divisions) {
      if (opts.conference !== undefined && opts.conference !== conf) continue;
      const key = `${conf} ${div}`;
      groups.set(key, { conference: conf, division: key, rows: [] });
      order.push(key);
    }
  }

  const sorted = (opts.preSorted ?? isRanked(rows)) ? rows : [...rows].sort(compareStandingRows);
  for (const row of sorted) {
    const identity = byId.get(row.teamId);
    if (!identity) continue;
    const key = `${identity.conference} ${identity.division}`;
    const group = groups.get(key);
    if (!group) continue;
    group.rows.push({
      teamId: row.teamId,
      seedLabel: '',
      name: `${identity.city} ${identity.nickname}`,
      record: formatRecord(row.w, row.l, row.t),
      pct: formatPct(row.w, row.l, row.t),
      pf: row.pf,
      pa: row.pa,
      diff: formatSigned(row.pf - row.pa),
      divRecord: formatRecord(row.divW, row.divL, 0),
      confRecord: formatRecord(row.confW, row.confL, 0),
      isUser: row.teamId === opts.userTeamId,
    });
  }
  return order.map((k) => groups.get(k)).filter((g): g is StandingsGroup => g !== undefined);
}

/** Conference-wide playoff order: division winners first (by record), then wildcards. */
export function buildConferenceSeeds(
  identities: readonly TeamIdentity[],
  rows: readonly StandingRow[],
  conference: ConferenceName,
): string[] {
  const preSorted = isRanked(rows);
  const groups = buildStandings(identities, rows, { conference, preSorted });
  const winners: StandingRow[] = [];
  const rest: StandingRow[] = [];
  const byId = new Map<string, StandingRow>();
  const rank = new Map<string, number>();
  rows.forEach((r, i) => { byId.set(r.teamId, r); rank.set(r.teamId, i); });
  for (const g of groups) {
    g.rows.forEach((r, i) => {
      const raw = byId.get(r.teamId);
      if (!raw) return;
      (i === 0 ? winners : rest).push(raw);
    });
  }
  // A ranked list already carries the full ladder; re-ordering by list position
  // keeps head-to-head and the seeded coin intact.
  const cmp = preSorted
    ? (a: StandingRow, b: StandingRow): number => (rank.get(a.teamId) ?? 0) - (rank.get(b.teamId) ?? 0)
    : compareStandingRows;
  winners.sort(cmp);
  rest.sort(cmp);
  return [...winners, ...rest.slice(0, 2)].map((r) => r.teamId);
}

// ---------------------------------------------------------------------------
// Season leaders
// ---------------------------------------------------------------------------

export type LeaderCategory =
  | 'passYds' | 'passTD' | 'rushYds' | 'rushTD' | 'recYds' | 'recTD'
  | 'tackles' | 'sacks' | 'defInt' | 'fgm';

export interface LeaderCategoryDef {
  id: LeaderCategory;
  label: string;
  valueHeader: string;
}

export const LEADER_CATEGORIES: readonly LeaderCategoryDef[] = [
  { id: 'passYds', label: 'PASSING YARDS', valueHeader: 'YDS' },
  { id: 'passTD', label: 'PASSING TD', valueHeader: 'TD' },
  { id: 'rushYds', label: 'RUSHING YARDS', valueHeader: 'YDS' },
  { id: 'rushTD', label: 'RUSHING TD', valueHeader: 'TD' },
  { id: 'recYds', label: 'RECEIVING YARDS', valueHeader: 'YDS' },
  { id: 'recTD', label: 'RECEIVING TD', valueHeader: 'TD' },
  { id: 'tackles', label: 'TACKLES', valueHeader: 'TKL' },
  { id: 'sacks', label: 'SACKS', valueHeader: 'SK' },
  { id: 'defInt', label: 'INTERCEPTIONS', valueHeader: 'INT' },
  { id: 'fgm', label: 'FIELD GOALS MADE', valueHeader: 'FGM' },
];

export interface LeaderDisplayRow {
  rank: number;
  athleteId: string;
  name: string;
  teamAbbrev: string;
  value: string;
  detail: string;
  isUser: boolean;
}

export interface LeaderContext {
  nameOf: (athleteId: string) => string;
  abbrevOf: (teamId: string) => string;
  userTeamId?: string;
  limit?: number;
}

function leaderValue(p: PlayerSeasonStats, cat: LeaderCategory): number {
  switch (cat) {
    case 'passYds': return p.passYds;
    case 'passTD': return p.passTD;
    case 'rushYds': return p.rushYds;
    case 'rushTD': return p.rushTD;
    case 'recYds': return p.recYds;
    case 'recTD': return p.recTD;
    case 'tackles': return p.tackles;
    case 'sacks': return p.sacks;
    case 'defInt': return p.defInt;
    case 'fgm': return p.fgm;
  }
}

function leaderDetail(p: PlayerSeasonStats, cat: LeaderCategory): string {
  switch (cat) {
    case 'passYds':
    case 'passTD':
      return `${p.passCmp}/${p.passAtt} · ${p.passTD} TD · ${p.passInt} INT`;
    case 'rushYds':
    case 'rushTD':
      return `${p.rushAtt} ATT · ${formatAvg(p.rushYds, p.rushAtt)} AVG`;
    case 'recYds':
    case 'recTD':
      return `${p.rec} REC · ${formatAvg(p.recYds, p.rec)} AVG`;
    case 'tackles': return `${p.sacks} SK · ${p.ffum} FF`;
    case 'sacks': return `${p.tackles} TKL`;
    case 'defInt': return `${p.tackles} TKL`;
    case 'fgm': return `${formatOfPair(p.fgm, p.fga)} FG · ${formatOfPair(p.xpm, p.xpa)} XP`;
  }
}

function formatLeaderValue(v: number, cat: LeaderCategory): string {
  if (cat === 'sacks') return v % 1 === 0 ? `${v}` : v.toFixed(1);
  return `${Math.round(v)}`;
}

export function buildLeaders(
  season: Readonly<Record<string, PlayerSeasonStats>>,
  category: LeaderCategory,
  ctx: LeaderContext,
): LeaderDisplayRow[] {
  const limit = ctx.limit ?? 10;
  const keys = Object.keys(season).sort();
  const scored: Array<{ id: string; p: PlayerSeasonStats; v: number }> = [];
  for (const id of keys) {
    const p = season[id];
    if (!p) continue;
    const v = leaderValue(p, category);
    if (v <= 0) continue;
    scored.push({ id, p, v });
  }
  scored.sort((a, b) => (b.v !== a.v ? b.v - a.v : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.slice(0, limit).map((s, i) => ({
    rank: i + 1,
    athleteId: s.id,
    name: ctx.nameOf(s.id),
    teamAbbrev: ctx.abbrevOf(s.p.teamId),
    value: formatLeaderValue(s.v, category),
    detail: leaderDetail(s.p, category),
    isUser: ctx.userTeamId !== undefined && s.p.teamId === ctx.userTeamId,
  }));
}

// ---------------------------------------------------------------------------
// Box score: line score + team comparison
// ---------------------------------------------------------------------------

export interface LineScoreRow {
  label: string;
  cells: string[];
  total: number;
  isWinner: boolean;
}

export interface LineScoreTable {
  headers: string[];
  rows: [LineScoreRow, LineScoreRow]; // away first (broadcast convention)
}

export function buildLineScore(
  stats: GameStats,
  homeAbbrev: string,
  awayAbbrev: string,
): LineScoreTable {
  const home = stats.scoringByQuarter[0] ?? [];
  const away = stats.scoringByQuarter[1] ?? [];
  const periods = Math.max(4, home.length, away.length);
  const headers = [''];
  for (let i = 0; i < periods; i++) headers.push(i < 4 ? `${i + 1}` : i === 4 ? 'OT' : `OT${i - 3}`);
  headers.push('T');

  const homeTotal = stats.teams[0].points;
  const awayTotal = stats.teams[1].points;
  const cellsFor = (arr: readonly number[]): string[] => {
    const out: string[] = [];
    for (let i = 0; i < periods; i++) out.push(`${arr[i] ?? 0}`);
    return out;
  };
  return {
    headers,
    rows: [
      { label: awayAbbrev, cells: cellsFor(away), total: awayTotal, isWinner: awayTotal > homeTotal },
      { label: homeAbbrev, cells: cellsFor(home), total: homeTotal, isWinner: homeTotal > awayTotal },
    ],
  };
}

export interface ComparisonRow {
  label: string;
  away: string;
  home: string;
  /** Which column reads "better" for this stat; null when tied. */
  better: 'home' | 'away' | null;
}

function compareRow(
  label: string,
  awayVal: number,
  homeVal: number,
  awayText: string,
  homeText: string,
  higherIsBetter: boolean,
): ComparisonRow {
  let better: 'home' | 'away' | null = null;
  if (awayVal !== homeVal) {
    const awayWins = higherIsBetter ? awayVal > homeVal : awayVal < homeVal;
    better = awayWins ? 'away' : 'home';
  }
  return { label, away: awayText, home: homeText, better };
}

export function buildTeamComparison(stats: GameStats): ComparisonRow[] {
  const h = stats.teams[0];
  const a = stats.teams[1];
  return [
    compareRow('TOTAL YARDS', a.totalYds, h.totalYds, `${a.totalYds}`, `${h.totalYds}`, true),
    compareRow('PASSING', a.passYds, h.passYds, `${a.passYds}`, `${h.passYds}`, true),
    compareRow('RUSHING', a.rushYds, h.rushYds, `${a.rushYds}`, `${h.rushYds}`, true),
    compareRow('FIRST DOWNS', a.firstDowns, h.firstDowns, `${a.firstDowns}`, `${h.firstDowns}`, true),
    compareRow(
      '3RD DOWN',
      a.thirdDownAtt > 0 ? a.thirdDownConv / a.thirdDownAtt : 0,
      h.thirdDownAtt > 0 ? h.thirdDownConv / h.thirdDownAtt : 0,
      `${formatOfPair(a.thirdDownConv, a.thirdDownAtt)} (${formatConvPct(a.thirdDownConv, a.thirdDownAtt)})`,
      `${formatOfPair(h.thirdDownConv, h.thirdDownAtt)} (${formatConvPct(h.thirdDownConv, h.thirdDownAtt)})`,
      true,
    ),
    compareRow('TURNOVERS', a.turnovers, h.turnovers, `${a.turnovers}`, `${h.turnovers}`, false),
    compareRow('SACKS ALLOWED', a.sacksAllowed, h.sacksAllowed, `${a.sacksAllowed}`, `${h.sacksAllowed}`, false),
    compareRow(
      'PENALTIES',
      a.penaltyYds, h.penaltyYds,
      `${a.penalties}-${a.penaltyYds}`, `${h.penalties}-${h.penaltyYds}`,
      false,
    ),
    compareRow(
      'TIME OF POSS.',
      a.topSeconds, h.topSeconds,
      formatDuration(a.topSeconds), formatDuration(h.topSeconds),
      true,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Player stat tables
// ---------------------------------------------------------------------------

export type StatGroup = 'OFF' | 'DEF' | 'ST';
export const STAT_GROUPS: readonly StatGroup[] = ['OFF', 'DEF', 'ST'];

export interface StatTableRow {
  athleteId: string;
  name: string;
  teamAbbrev: string;
  team: TeamSide;
  cells: string[];
}

export interface StatTable {
  title: string;
  columns: string[];
  rows: StatTableRow[];
}

export interface StatTableContext {
  nameOf: (athleteId: string) => string;
  teamOf: (athleteId: string) => TeamSide;
  abbrevs: readonly [string, string];
  /** Restrict to one team (halftime panels); omit for both. */
  onlyTeam?: TeamSide;
  limitPerTable?: number;
}

function sortedPlayers(stats: GameStats): Array<[string, PlayerGameStats]> {
  const keys = Object.keys(stats.players).sort();
  const out: Array<[string, PlayerGameStats]> = [];
  for (const k of keys) {
    const p = stats.players[k];
    if (p) out.push([k, p]);
  }
  return out;
}

function makeTable(
  title: string,
  columns: string[],
  stats: GameStats,
  ctx: StatTableContext,
  include: (p: PlayerGameStats) => boolean,
  sortValue: (p: PlayerGameStats) => number,
  cells: (p: PlayerGameStats) => string[],
): StatTable {
  const rows: Array<{ row: StatTableRow; v: number }> = [];
  for (const [id, p] of sortedPlayers(stats)) {
    if (!include(p)) continue;
    const team = ctx.teamOf(id);
    if (ctx.onlyTeam !== undefined && team !== ctx.onlyTeam) continue;
    rows.push({
      row: {
        athleteId: id,
        name: ctx.nameOf(id),
        teamAbbrev: ctx.abbrevs[team] ?? '',
        team,
        cells: cells(p),
      },
      v: sortValue(p),
    });
  }
  rows.sort((x, y) => (y.v !== x.v ? y.v - x.v : x.row.athleteId < y.row.athleteId ? -1 : 1));
  const limit = ctx.limitPerTable ?? 8;
  return { title, columns, rows: rows.slice(0, limit).map((r) => r.row) };
}

export function buildPlayerTables(
  stats: GameStats,
  group: StatGroup,
  ctx: StatTableContext,
): StatTable[] {
  if (group === 'OFF') {
    return [
      makeTable(
        'PASSING', ['C/A', 'YDS', 'TD', 'INT'], stats, ctx,
        (p) => p.passAtt > 0, (p) => p.passYds,
        (p) => [formatOfPair(p.passCmp, p.passAtt), `${p.passYds}`, `${p.passTD}`, `${p.passInt}`],
      ),
      makeTable(
        'RUSHING', ['ATT', 'YDS', 'AVG', 'TD'], stats, ctx,
        (p) => p.rushAtt > 0, (p) => p.rushYds,
        (p) => [`${p.rushAtt}`, `${p.rushYds}`, formatAvg(p.rushYds, p.rushAtt), `${p.rushTD}`],
      ),
      makeTable(
        'RECEIVING', ['REC', 'TGT', 'YDS', 'TD'], stats, ctx,
        (p) => p.tgt > 0 || p.rec > 0, (p) => p.recYds,
        (p) => [`${p.rec}`, `${p.tgt}`, `${p.recYds}`, `${p.recTD}`],
      ),
    ];
  }
  if (group === 'DEF') {
    return [
      makeTable(
        'DEFENSE', ['TKL', 'SK', 'INT', 'FF'], stats, ctx,
        (p) => p.tackles > 0 || p.sacks > 0 || p.defInt > 0 || p.ffum > 0,
        (p) => p.tackles + p.sacks * 3 + p.defInt * 4 + p.ffum * 2,
        (p) => [`${p.tackles}`, p.sacks % 1 === 0 ? `${p.sacks}` : p.sacks.toFixed(1), `${p.defInt}`, `${p.ffum}`],
      ),
    ];
  }
  return [
    makeTable(
      'KICKING', ['FG', 'XP', 'PTS'], stats, ctx,
      (p) => p.fga > 0 || p.xpa > 0,
      (p) => p.fgm * 3 + p.xpm,
      (p) => [formatOfPair(p.fgm, p.fga), formatOfPair(p.xpm, p.xpa), `${p.fgm * 3 + p.xpm}`],
    ),
    makeTable(
      'PUNTING', ['NO', 'YDS', 'AVG'], stats, ctx,
      (p) => p.punts > 0, (p) => p.puntYds,
      (p) => [`${p.punts}`, `${p.puntYds}`, formatAvg(p.puntYds, p.punts)],
    ),
    makeTable(
      'RETURNS', ['KR', 'PR', 'TD'], stats, ctx,
      (p) => p.krYds > 0 || p.prYds > 0 || p.retTD > 0,
      (p) => p.krYds + p.prYds + p.retTD * 50,
      (p) => [`${p.krYds}`, `${p.prYds}`, `${p.retTD}`],
    ),
  ];
}

// ---------------------------------------------------------------------------
// Player of the game / halftime standouts
// ---------------------------------------------------------------------------

// TODO(balance): impact weights are presentation-only (award picking); move to
// data/balance.ts if the meta layer ever needs the same scoring.
const IMPACT = {
  passTD: 4, passYdsPer: 1 / 25, passInt: -3,
  scoreTD: 6, scrimYdsPer: 1 / 10, returnYdsPer: 1 / 25,
  tackle: 0.4, sack: 2.5, defInt: 5, ffum: 2, fgm: 1.5, xpm: 0.3,
} as const;

export function impactScore(p: PlayerGameStats): number {
  return (
    p.passTD * IMPACT.passTD +
    p.passYds * IMPACT.passYdsPer +
    p.passInt * IMPACT.passInt +
    (p.rushTD + p.recTD + p.retTD) * IMPACT.scoreTD +
    (p.rushYds + p.recYds) * IMPACT.scrimYdsPer +
    (p.krYds + p.prYds) * IMPACT.returnYdsPer +
    p.tackles * IMPACT.tackle +
    p.sacks * IMPACT.sack +
    p.defInt * IMPACT.defInt +
    p.ffum * IMPACT.ffum +
    p.fgm * IMPACT.fgm +
    p.xpm * IMPACT.xpm
  );
}

/** Compact human stat line: "24/33, 288 YDS, 3 TD · 41 RUSH YDS". */
export function describeStatLine(p: PlayerGameStats): string {
  const parts: string[] = [];
  if (p.passAtt > 0) {
    parts.push(`${formatOfPair(p.passCmp, p.passAtt)}, ${p.passYds} PASS YDS, ${p.passTD} TD`);
  }
  if (p.rushAtt > 0) parts.push(`${p.rushAtt} CAR, ${p.rushYds} RUSH YDS, ${p.rushTD} TD`);
  if (p.rec > 0) parts.push(`${p.rec} REC, ${p.recYds} YDS, ${p.recTD} TD`);
  if (p.tackles > 0 || p.sacks > 0) {
    const sk = p.sacks > 0 ? `, ${p.sacks % 1 === 0 ? p.sacks : p.sacks.toFixed(1)} SACK` : '';
    parts.push(`${p.tackles} TKL${sk}`);
  }
  if (p.defInt > 0) parts.push(`${p.defInt} INT`);
  if (p.fga > 0) parts.push(`${formatOfPair(p.fgm, p.fga)} FG`);
  if (p.punts > 0) parts.push(`${p.punts} PUNTS, ${formatAvg(p.puntYds, p.punts)} AVG`);
  return parts.join(' · ');
}

export interface StandoutPlayer {
  athleteId: string;
  team: TeamSide;
  score: number;
  line: string;
}

export function rankStandouts(
  stats: GameStats,
  teamOf: (athleteId: string) => TeamSide,
  opts: { onlyTeam?: TeamSide; limit?: number } = {},
): StandoutPlayer[] {
  const out: StandoutPlayer[] = [];
  for (const [id, p] of sortedPlayers(stats)) {
    const team = teamOf(id);
    if (opts.onlyTeam !== undefined && team !== opts.onlyTeam) continue;
    const score = impactScore(p);
    if (score <= 0) continue;
    out.push({ athleteId: id, team, score, line: describeStatLine(p) });
  }
  out.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.athleteId < b.athleteId ? -1 : 1));
  return out.slice(0, opts.limit ?? 3);
}

export function pickPlayerOfTheGame(
  stats: GameStats,
  teamOf: (athleteId: string) => TeamSide,
): StandoutPlayer | null {
  return rankStandouts(stats, teamOf, { limit: 1 })[0] ?? null;
}
