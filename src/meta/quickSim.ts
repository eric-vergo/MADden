// Quick-sim: a full game reduced to unit edges -> possession outcomes -> a
// synthesized box score with the same GameStats shape the live engine produces.
// Seeded per gameId, so re-simming the same game always yields the same result.

import type { GameStats, PlayerGameStats, TeamGameStats, TeamRoster } from '../sim/types';
import { Rng, hashSeed } from '../sim/rng';
import type { GameResultLite, ScheduledGame, StoredBoxScore, Team } from './types';
import { athleteById, findTeam, starterIds } from './league';
import { avg, clamp, largestRemainder, req } from './util';

// TODO(balance) — quickSim tunables (design §5). Move into data/balance.ts in
// the consolidation pass; do not edit balance.ts concurrently.
export const QUICK_SIM = {
  possBase: 10, possExtra: 2,
  /**
   * Scales the rating differential before it reaches the outcome probabilities.
   * The raw §5 coefficients make a +10 OVR team win ~93% of games, well past
   * CALIBRATION.ovrEdge10WinRateMax; this brings it inside the 70–85% band.
   */
  edgeScale: 0.60,
  formSigma: 4, homeFieldEdge: 1.5,
  tdBase: 0.225, tdPerEdge: 0.011, tdMin: 0.04, tdMax: 0.48,
  fgBase: 0.18, fgPerEdge: 0.003, fgMin: 0.08, fgMax: 0.24,
  toBase: 0.11, toPerEdge: 0.004, toMin: 0.04, toMax: 0.20,
  ydsTd: 57, ydsTdSigma: 12, ydsTdMin: 25,
  ydsFg: 46, ydsFgSigma: 14,
  ydsTo: 14, ydsToSigma: 12,
  ydsPunt: 17, ydsPuntSigma: 13,
  xpMissChance: 0.02,
  fgMaxDist: 56,
  otEdgePerPoint: 0.02, otWinMin: 0.25, otWinMax: 0.75,
  passShareBase: 0.58, passSharePerEdge: 0.006, passShareMin: 0.45, passShareMax: 0.72,
  ydsPerAttBase: 6.9, ydsPerAttPerEdge: 0.05, ydsPerAttMin: 4.5,
  compBase: 0.55, compThaRef: 45, compPerTha: 0.0022, compPerEdge: 0.002,
  compMin: 0.48, compMax: 0.70,
  intShareOfTurnovers: 0.58,
  ypcBase: 4.2, ypcPerEdge: 0.025, ypcMin: 3.6, ypcMax: 5.2,
  recYdsPerCatchBase: 11, recYdsPerCatchPerSpd: 0.04,
  sackBase: 1.9, sackPerOppEdge: 0.12, sackSigma: 1, sackMin: 0, sackMax: 7,
  tacklesMin: 55, tacklesMax: 70,
  firstDownYds: 18,
  thirdDownAttMin: 11, thirdDownAttMax: 16,
  thirdDownBase: 0.30, thirdDownPerEdge: 0.006, thirdDownMin: 0.2, thirdDownMax: 0.55,
  penaltiesMin: 2, penaltiesMax: 7, penaltyYdsMin: 6, penaltyYdsMax: 11,
  puntYdsBase: 40, puntYdsSigma: 5,
  topBase: 1800, topPerPossession: 45, topSigma: 90, topMin: 1200, topMax: 2400,
} as const;

const RUSH_SHARES: readonly number[] = [0.62, 0.26, 0.12];
const REC_SHARES: readonly number[] = [0.30, 0.21, 0.13, 0.17, 0.12, 0.07];

export interface QuickSimOutcome {
  box: StoredBoxScore;
  result: GameResultLite;
}

export function emptyPlayerStats(athleteId: string): PlayerGameStats {
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

export function emptyTeamStats(teamId: string): TeamGameStats {
  return {
    teamId, points: 0, totalYds: 0, passYds: 0, rushYds: 0, firstDowns: 0,
    thirdDownConv: 0, thirdDownAtt: 0, turnovers: 0, penalties: 0,
    penaltyYds: 0, topSeconds: 0, sacksAllowed: 0,
  };
}

function statOf(players: Record<string, PlayerGameStats>, id: string): PlayerGameStats {
  const existing = players[id];
  if (existing !== undefined) return existing;
  const fresh = emptyPlayerStats(id);
  players[id] = fresh;
  return fresh;
}

// ---------------------------------------------------------------------------
// Unit edges
// ---------------------------------------------------------------------------

export interface UnitRatings {
  passOff: number;
  rushOff: number;
  passDef: number;
  rushDef: number;
}

function ovrsOf(roster: TeamRoster, pos: 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'DL' | 'LB' | 'CB' | 'S' | 'K' | 'P', n: number): number[] {
  const ids = starterIds(roster, pos, n);
  const out: number[] = [];
  for (let i = 0; i < ids.length; i++) out.push(athleteById(roster, req(ids, i)).overall);
  return out;
}

export function unitRatings(team: Team): UnitRatings {
  const r = team.roster;
  const qb1 = req(ovrsOf(r, 'QB', 1), 0);
  const rb1 = req(ovrsOf(r, 'RB', 1), 0);
  const skill = [...ovrsOf(r, 'WR', 3), ...ovrsOf(r, 'TE', 1)];
  const ol = avg(ovrsOf(r, 'OL', 5));
  const dl = avg(ovrsOf(r, 'DL', 4));
  const lb = avg(ovrsOf(r, 'LB', 3));
  const secondary = [...ovrsOf(r, 'CB', 2), ...ovrsOf(r, 'S', 2)];
  const ss = req(ovrsOf(r, 'S', 2), 1);
  return {
    passOff: 0.45 * qb1 + 0.30 * avg(skill) + 0.25 * ol,
    rushOff: 0.50 * rb1 + 0.50 * ol,
    passDef: 0.40 * avg(secondary) + 0.35 * dl + 0.25 * lb,
    rushDef: 0.50 * dl + 0.35 * lb + 0.15 * ss,
  };
}

// ---------------------------------------------------------------------------
// Drives
// ---------------------------------------------------------------------------

interface DriveAcc {
  points: number;
  yds: number;
  tds: number;
  fga: number;
  fgm: number;
  turnovers: number;
  punts: number;
  puntYds: number;
  possessions: number;
  quarterPoints: number[];
}

function newAcc(): DriveAcc {
  return {
    points: 0, yds: 0, tds: 0, fga: 0, fgm: 0, turnovers: 0,
    punts: 0, puntYds: 0, possessions: 0, quarterPoints: [0, 0, 0, 0],
  };
}

function fgMakeProbability(dist: number, kac: number): number {
  const base = dist < 30 ? 0.97 : dist < 40 ? 0.92 : dist < 50 ? 0.82 : 0.72;
  return clamp(base + (kac - 75) * 0.0015, 0.5, 0.99);
}

function runDrive(acc: DriveAcc, edge: number, kac: number, quarter: number, rng: Rng): void {
  const q = QUICK_SIM;
  acc.possessions++;
  const pTD = clamp(q.tdBase + edge * q.tdPerEdge, q.tdMin, q.tdMax);
  const pFG = clamp(q.fgBase + edge * q.fgPerEdge, q.fgMin, q.fgMax);
  const pTO = clamp(q.toBase - edge * q.toPerEdge, q.toMin, q.toMax);
  const u = rng.next();
  const qi = quarter - 1;

  if (u < pTD) {
    acc.yds += Math.max(q.ydsTdMin, q.ydsTd + rng.gauss() * q.ydsTdSigma);
    acc.tds++;
    const pts = rng.chance(q.xpMissChance) ? 6 : 7;
    acc.points += pts;
    acc.quarterPoints[qi] = (acc.quarterPoints[qi] ?? 0) + pts;
    return;
  }
  if (u < pTD + pFG) {
    const yds = Math.max(0, q.ydsFg + rng.gauss() * q.ydsFgSigma);
    acc.yds += yds;
    const ballAt = Math.min(25 + yds, 99);
    const dist = Math.round(117 - ballAt);
    if (dist > q.fgMaxDist) {
      // Out of range — the drive turns into a punt instead.
      acc.punts++;
      acc.puntYds += Math.max(20, q.puntYdsBase + rng.gauss() * q.puntYdsSigma);
      return;
    }
    acc.fga++;
    if (rng.chance(fgMakeProbability(dist, kac))) {
      acc.fgm++;
      acc.points += 3;
      acc.quarterPoints[qi] = (acc.quarterPoints[qi] ?? 0) + 3;
    }
    return;
  }
  if (u < pTD + pFG + pTO) {
    acc.yds += Math.max(0, q.ydsTo + rng.gauss() * q.ydsToSigma);
    acc.turnovers++;
    return;
  }
  acc.yds += Math.max(0, q.ydsPunt + rng.gauss() * q.ydsPuntSigma);
  acc.punts++;
  acc.puntYds += Math.max(20, q.puntYdsBase + rng.gauss() * q.puntYdsSigma);
}

// ---------------------------------------------------------------------------
// Box synthesis
// ---------------------------------------------------------------------------

function weightedPick(rng: Rng, ids: readonly string[], weights: readonly number[]): string {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += Math.max(0, req(weights, i));
  if (total <= 0) return req(ids, 0);
  let u = rng.next() * total;
  for (let i = 0; i < ids.length; i++) {
    u -= Math.max(0, req(weights, i));
    if (u <= 0) return req(ids, i);
  }
  return req(ids, ids.length - 1);
}

interface OffenseContext {
  passEdge: number;
  rushEdge: number;
  edge: number;
}

function synthOffense(
  team: Team,
  acc: DriveAcc,
  ctx: OffenseContext,
  players: Record<string, PlayerGameStats>,
  teamStats: TeamGameStats,
  rng: Rng,
): void {
  const q = QUICK_SIM;
  const r = team.roster;
  const totalYds = Math.round(acc.yds);
  const passShare = clamp(
    q.passShareBase + (ctx.passEdge - ctx.rushEdge) * q.passSharePerEdge,
    q.passShareMin,
    q.passShareMax,
  );
  const passYds = Math.round(totalYds * passShare);
  const rushYds = Math.max(0, totalYds - passYds);

  const qb1 = req(starterIds(r, 'QB', 1), 0);
  const qbA = athleteById(r, qb1);
  const ypa = Math.max(q.ydsPerAttMin, q.ydsPerAttBase + ctx.passEdge * q.ydsPerAttPerEdge);
  const att = Math.max(passYds > 0 ? 10 : 0, Math.round(passYds / ypa));
  const compPct = clamp(
    q.compBase + (qbA.ratings.tha - q.compThaRef) * q.compPerTha + ctx.passEdge * q.compPerEdge,
    q.compMin,
    q.compMax,
  );
  const cmp = Math.min(att, Math.round(att * compPct));

  const qbStat = statOf(players, qb1);
  qbStat.passAtt += att;
  qbStat.passCmp += cmp;
  qbStat.passYds += passYds;

  // Rushing: RB1 / RB2 / QB1
  const rbIds = starterIds(r, 'RB', 2);
  const rusherIds = [req(rbIds, 0), rbIds[1] ?? req(rbIds, 0), qb1];
  const rushSplit = largestRemainder(rushYds, RUSH_SHARES);
  const ypc = clamp(q.ypcBase + ctx.rushEdge * q.ypcPerEdge, q.ypcMin, q.ypcMax);
  for (let i = 0; i < rusherIds.length; i++) {
    const yds = req(rushSplit, i);
    if (yds <= 0) continue;
    const s = statOf(players, req(rusherIds, i));
    s.rushYds += yds;
    s.rushAtt += Math.max(1, Math.round(yds / ypc));
  }

  // Receiving: WR1 WR2 WR3 TE1 RB1 WR4
  const wrs = starterIds(r, 'WR', 4);
  const tes = starterIds(r, 'TE', 1);
  const recIds = [
    req(wrs, 0), wrs[1] ?? req(wrs, 0), wrs[2] ?? req(wrs, 0),
    tes[0] ?? req(wrs, 0), req(rbIds, 0), wrs[3] ?? req(wrs, 0),
  ];
  const recYdsSplit = largestRemainder(passYds, REC_SHARES);
  const rawRec: number[] = [];
  for (let i = 0; i < recIds.length; i++) {
    const a = athleteById(r, req(recIds, i));
    const perCatch = q.recYdsPerCatchBase + a.ratings.spd * q.recYdsPerCatchPerSpd;
    rawRec.push(req(recYdsSplit, i) / Math.max(4, perCatch));
  }
  const recSplit = largestRemainder(cmp, rawRec);
  const tgtSplit = largestRemainder(att, rawRec);
  for (let i = 0; i < recIds.length; i++) {
    const s = statOf(players, req(recIds, i));
    const rec = req(recSplit, i);
    s.rec += rec;
    s.recYds += req(recYdsSplit, i);
    s.tgt += Math.max(rec, req(tgtSplit, i));
  }

  // Touchdowns: pass vs run by the same share, then a weighted target.
  for (let t = 0; t < acc.tds; t++) {
    if (rng.chance(passShare)) {
      qbStat.passTD++;
      statOf(players, weightedPick(rng, recIds, REC_SHARES)).recTD++;
    } else {
      statOf(players, weightedPick(rng, rusherIds, RUSH_SHARES)).rushTD++;
    }
  }

  // Kicker + punter
  const kId = req(starterIds(r, 'K', 1), 0);
  const kStat = statOf(players, kId);
  kStat.fga += acc.fga;
  kStat.fgm += acc.fgm;
  kStat.xpa += acc.tds;
  kStat.xpm += Math.max(0, acc.points - acc.fgm * 3 - acc.tds * 6);
  const pIds = starterIds(r, 'P', 1);
  const pStat = statOf(players, pIds[0] ?? kId);
  pStat.punts += acc.punts;
  pStat.puntYds += Math.round(acc.puntYds);

  teamStats.points = acc.points;
  teamStats.totalYds = totalYds;
  teamStats.passYds = passYds;
  teamStats.rushYds = rushYds;
  teamStats.turnovers = acc.turnovers;
  teamStats.firstDowns = Math.round(totalYds / q.firstDownYds) + acc.tds;
  teamStats.thirdDownAtt = rng.int(q.thirdDownAttMin, q.thirdDownAttMax);
  teamStats.thirdDownConv = Math.round(
    teamStats.thirdDownAtt * clamp(q.thirdDownBase + ctx.edge * q.thirdDownPerEdge, q.thirdDownMin, q.thirdDownMax),
  );
  teamStats.penalties = rng.int(q.penaltiesMin, q.penaltiesMax);
  teamStats.penaltyYds = teamStats.penalties * rng.int(q.penaltyYdsMin, q.penaltyYdsMax);
}

/** Credits the defense of `team` for what the opponent gave up. */
function synthDefense(
  team: Team,
  oppTeam: Team,
  oppAcc: DriveAcc,
  oppPassEdge: number,
  players: Record<string, PlayerGameStats>,
  oppTeamStats: TeamGameStats,
  rng: Rng,
): void {
  const q = QUICK_SIM;
  const r = team.roster;
  const dlIds = starterIds(r, 'DL', 4);
  const lbIds = starterIds(r, 'LB', 3);
  const cbIds = starterIds(r, 'CB', 2);
  const sIds = starterIds(r, 'S', 2);

  // Sacks
  const sacks = clamp(
    Math.round(q.sackBase - oppPassEdge * q.sackPerOppEdge + rng.gauss() * q.sackSigma),
    q.sackMin,
    q.sackMax,
  );
  oppTeamStats.sacksAllowed = sacks;
  const rushmenIds = [...dlIds, ...lbIds];
  const rushWeights: number[] = [];
  for (let i = 0; i < rushmenIds.length; i++) rushWeights.push(athleteById(r, req(rushmenIds, i)).ratings.shd);
  const toBest = Math.round(sacks * 0.5);
  if (toBest > 0) statOf(players, req(dlIds, 0)).sacks += toBest;
  for (let i = 0; i < sacks - toBest; i++) {
    statOf(players, weightedPick(rng, rushmenIds, rushWeights)).sacks += 1;
  }

  // Turnovers the opponent committed: .58 interceptions, the rest fumbles.
  const ints = Math.round(oppAcc.turnovers * q.intShareOfTurnovers);
  const fumbles = oppAcc.turnovers - ints;
  const coverIds = [...cbIds, ...sIds];
  const coverWeights: number[] = [];
  for (let i = 0; i < coverIds.length; i++) {
    const a = athleteById(r, req(coverIds, i));
    coverWeights.push(a.ratings.mcv + a.ratings.zcv);
  }
  const oppQb = req(starterIds(oppTeam.roster, 'QB', 1), 0);
  for (let i = 0; i < ints; i++) {
    statOf(players, weightedPick(rng, coverIds, coverWeights)).defInt += 1;
    statOf(players, oppQb).passInt += 1;
  }
  const oppRb = req(starterIds(oppTeam.roster, 'RB', 1), 0);
  const forcerIds = [...lbIds, ...dlIds, ...sIds];
  const forcerWeights: number[] = [];
  for (let i = 0; i < forcerIds.length; i++) forcerWeights.push(athleteById(r, req(forcerIds, i)).ratings.hpw);
  for (let i = 0; i < fumbles; i++) {
    statOf(players, weightedPick(rng, forcerIds, forcerWeights)).ffum += 1;
    statOf(players, rng.chance(0.7) ? oppRb : oppQb).fumbles += 1;
  }

  // Tackles: LB-heavy spread across the front seven plus the secondary.
  const tackleIds = [
    ...lbIds, ...sIds, ...cbIds, ...dlIds,
    ...starterIds(r, 'LB', 6).slice(3),
    ...starterIds(r, 'CB', 4).slice(2),
  ];
  const tackleWeights: number[] = [];
  for (let i = 0; i < tackleIds.length; i++) {
    const id = req(tackleIds, i);
    const a = athleteById(r, id);
    const base = a.pos === 'LB' ? 3.0 : a.pos === 'S' ? 2.2 : a.pos === 'CB' ? 1.8 : 1.6;
    const starter = i < lbIds.length + sIds.length + cbIds.length + dlIds.length;
    tackleWeights.push(starter ? base : base * 0.25);
  }
  const totalTackles = rng.int(q.tacklesMin, q.tacklesMax);
  const split = largestRemainder(totalTackles, tackleWeights);
  for (let i = 0; i < tackleIds.length; i++) {
    statOf(players, req(tackleIds, i)).tackles += req(split, i);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function simGame(
  leagueSeed: number,
  game: Readonly<ScheduledGame>,
  teams: readonly Team[],
): QuickSimOutcome {
  const q = QUICK_SIM;
  const rng = new Rng(hashSeed(leagueSeed, 'sim', game.id));
  const home = findTeam(teams, game.homeId);
  const away = findTeam(teams, game.awayId);
  const uh = unitRatings(home);
  const ua = unitRatings(away);

  const homeField = game.week < 17 ? q.homeFieldEdge : 0;
  const formH = rng.gauss() * q.formSigma + homeField;
  const formA = rng.gauss() * q.formSigma;

  const passEdgeH = uh.passOff - ua.passDef + formH;
  const rushEdgeH = uh.rushOff - ua.rushDef + formH;
  const passEdgeA = ua.passOff - uh.passDef + formA;
  const rushEdgeA = ua.rushOff - uh.rushDef + formA;
  const edgeH = (0.58 * passEdgeH + 0.42 * rushEdgeH) * q.edgeScale;
  const edgeA = (0.58 * passEdgeA + 0.42 * rushEdgeA) * q.edgeScale;

  const kacH = athleteById(home.roster, req(starterIds(home.roster, 'K', 1), 0)).ratings.kac;
  const kacA = athleteById(away.roster, req(starterIds(away.roster, 'K', 1), 0)).ratings.kac;

  const possH = q.possBase + rng.int(0, q.possExtra);
  const possA = q.possBase + rng.int(0, q.possExtra);
  const accH = newAcc();
  const accA = newAcc();
  const drives = Math.max(possH, possA);
  for (let i = 0; i < drives; i++) {
    const quarter = Math.min(4, Math.floor((i / drives) * 4) + 1);
    if (i < possH) runDrive(accH, edgeH, kacH, quarter, rng);
    if (i < possA) runDrive(accA, edgeA, kacA, quarter, rng);
  }

  // Overtime: a weighted coin, winner kicks the game-winning field goal.
  let ot = false;
  if (accH.points === accA.points) {
    ot = true;
    const pHome = clamp(0.5 + (edgeH - edgeA) * q.otEdgePerPoint, q.otWinMin, q.otWinMax);
    const winner = rng.chance(pHome) ? accH : accA;
    winner.points += 3;
    winner.fga++;
    winner.fgm++;
    winner.quarterPoints.push(3);
    const loser = winner === accH ? accA : accH;
    loser.quarterPoints.push(0);
  }

  const players: Record<string, PlayerGameStats> = {};
  const homeStats = emptyTeamStats(home.identity.id);
  const awayStats = emptyTeamStats(away.identity.id);

  synthOffense(home, accH, { passEdge: passEdgeH, rushEdge: rushEdgeH, edge: edgeH }, players, homeStats, rng);
  synthOffense(away, accA, { passEdge: passEdgeA, rushEdge: rushEdgeA, edge: edgeA }, players, awayStats, rng);
  synthDefense(home, away, accA, passEdgeA, players, awayStats, rng);
  synthDefense(away, home, accH, passEdgeH, players, homeStats, rng);

  const topHome = clamp(
    Math.round(q.topBase + (possH - possA) * q.topPerPossession + rng.gauss() * q.topSigma),
    q.topMin,
    q.topMax,
  );
  homeStats.topSeconds = topHome;
  awayStats.topSeconds = 3600 - topHome;

  const stats: GameStats = {
    teams: [homeStats, awayStats],
    players,
    scoringByQuarter: [accH.quarterPoints.slice(), accA.quarterPoints.slice()],
  };

  return {
    box: { gameId: game.id, week: game.week, stats, simmed: true },
    result: { homeScore: accH.points, awayScore: accA.points, ot },
  };
}
