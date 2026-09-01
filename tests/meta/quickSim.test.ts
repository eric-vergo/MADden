import { describe, expect, it } from 'vitest';
import { CALIBRATION } from '../../src/data/balance';
import { generateLeague } from '../../src/meta/league';
import { generateSchedule } from '../../src/meta/schedule';
import { simGame } from '../../src/meta/quickSim';
import type { ScheduledGame, Team } from '../../src/meta/types';

const SEED = 31337;

describe('quickSim shape', () => {
  const league = generateLeague(SEED, 0);
  const schedule = generateSchedule(SEED, 0, league.teams);
  const game = schedule[0]!;
  const out = simGame(SEED, game, league.teams);

  it('is deterministic per gameId', () => {
    expect(simGame(SEED, game, league.teams)).toEqual(out);
    const other = simGame(SEED, schedule[1]!, league.teams);
    expect(other.result).not.toEqual(out.result);
    expect(simGame(SEED + 1, game, league.teams).result).not.toEqual(out.result);
  });

  it('tags the box score as simmed and matches the schedule entry', () => {
    expect(out.box.simmed).toBe(true);
    expect(out.box.gameId).toBe(game.id);
    expect(out.box.week).toBe(game.week);
    expect(out.box.stats.teams[0].teamId).toBe(game.homeId);
    expect(out.box.stats.teams[1].teamId).toBe(game.awayId);
    expect(out.box.stats.teams[0].points).toBe(out.result.homeScore);
    expect(out.box.stats.teams[1].points).toBe(out.result.awayScore);
  });

  it('never leaves a tie unresolved and flags overtime when it happens', () => {
    let sawOt = false;
    for (const g of schedule) {
      const o = simGame(SEED, g, league.teams);
      expect(o.result.homeScore).not.toBe(o.result.awayScore);
      if (o.result.ot) {
        sawOt = true;
        expect(Math.abs(o.result.homeScore - o.result.awayScore)).toBe(3);
        expect(o.box.stats.scoringByQuarter[0]).toHaveLength(5);
      }
    }
    // 112 games at ~4% OT: essentially certain to see at least one.
    expect(sawOt).toBe(true);
  });

  it('keeps team totals internally consistent', () => {
    for (const g of schedule.slice(0, 20)) {
      const o = simGame(SEED, g, league.teams);
      for (const t of o.box.stats.teams) {
        expect(t.passYds + t.rushYds).toBe(t.totalYds);
        expect(t.thirdDownConv).toBeLessThanOrEqual(t.thirdDownAtt);
        expect(t.topSeconds).toBeGreaterThan(0);
        expect(t.penaltyYds).toBeGreaterThanOrEqual(t.penalties);
      }
      expect(o.box.stats.teams[0].topSeconds + o.box.stats.teams[1].topSeconds).toBe(3600);
    }
  });

  it('only credits players who are on the two rosters', () => {
    const ids = new Set<string>();
    const home = league.teams.find((t) => t.identity.id === game.homeId)!;
    const away = league.teams.find((t) => t.identity.id === game.awayId)!;
    for (const t of [home, away]) for (const a of t.roster.athletes) ids.add(a.id);
    for (const id of Object.keys(out.box.stats.players)) expect(ids.has(id)).toBe(true);
  });

  it('produces a coherent passing line', () => {
    for (const g of schedule.slice(0, 40)) {
      const o = simGame(SEED, g, league.teams);
      const players = o.box.stats.players;
      for (const teamId of [g.homeId, g.awayId]) {
        const team = league.teams.find((t) => t.identity.id === teamId)!;
        const qb = team.roster.depth.QB[0]!;
        const line = players[qb]!;
        expect(line.passCmp).toBeLessThanOrEqual(line.passAtt);
        let rec = 0;
        let recYds = 0;
        let tgt = 0;
        for (const a of team.roster.athletes) {
          const p = players[a.id];
          if (p === undefined) continue;
          rec += p.rec;
          recYds += p.recYds;
          tgt += p.tgt;
        }
        expect(rec).toBe(line.passCmp);
        expect(recYds).toBe(line.passYds);
        expect(tgt).toBeGreaterThanOrEqual(rec);
        for (const a of team.roster.athletes) {
          const p = players[a.id];
          if (p === undefined) continue;
          expect(p.rec).toBeLessThanOrEqual(p.tgt);
        }
      }
    }
  });

  it('reconciles points with touchdowns, extra points and field goals', () => {
    for (const g of schedule.slice(0, 40)) {
      const o = simGame(SEED, g, league.teams);
      for (let side = 0; side < 2; side++) {
        const teamId = side === 0 ? g.homeId : g.awayId;
        const team = league.teams.find((t) => t.identity.id === teamId)!;
        let td = 0;
        let fgm = 0;
        let xpm = 0;
        let xpa = 0;
        for (const a of team.roster.athletes) {
          const p = o.box.stats.players[a.id];
          if (p === undefined) continue;
          td += p.rushTD + p.recTD + p.retTD;
          fgm += p.fgm;
          xpm += p.xpm;
          xpa += p.xpa;
        }
        expect(xpa).toBe(td);
        expect(xpm).toBeLessThanOrEqual(xpa);
        expect(td * 6 + xpm + fgm * 3).toBe(o.box.stats.teams[side]!.points);
      }
    }
  });
});

describe('quickSim calibration', () => {
  it('lands league-wide averages inside the CALIBRATION bounds over 100 seasons', () => {
    let points = 0;
    let yards = 0;
    let sacks = 0;
    let turnovers = 0;
    let penalties = 0;
    let punts = 0;
    let passAtt = 0;
    let passCmp = 0;
    let rushAtt = 0;
    let rushYds = 0;
    let teamGames = 0;
    let games = 0;

    for (let s = 0; s < 100; s++) {
      const seed = 700000 + s;
      const league = generateLeague(seed, 0);
      const schedule = generateSchedule(seed, 0, league.teams);
      for (const g of schedule) {
        const o = simGame(seed, g, league.teams);
        games++;
        teamGames += 2;
        for (const t of o.box.stats.teams) {
          points += t.points;
          yards += t.totalYds;
          turnovers += t.turnovers;
          penalties += t.penalties;
          sacks += t.sacksAllowed;
        }
        for (const id of Object.keys(o.box.stats.players)) {
          const p = o.box.stats.players[id]!;
          passAtt += p.passAtt;
          passCmp += p.passCmp;
          rushAtt += p.rushAtt;
          rushYds += p.rushYds;
          punts += p.punts;
        }
      }
    }

    expect(games).toBe(100 * 112);
    const meanPoints = points / teamGames;
    expect(meanPoints).toBeGreaterThanOrEqual(CALIBRATION.scoreMeanMin);
    expect(meanPoints).toBeLessThanOrEqual(CALIBRATION.scoreMeanMax);
    // The design target is ~23 points a team; stay in the neighbourhood.
    expect(Math.abs(meanPoints - CALIBRATION.leagueAvgPointsPerTeam)).toBeLessThan(4);
    expect(Math.abs(yards / teamGames - CALIBRATION.leagueAvgYardsPerTeam)).toBeLessThan(45);

    const compPct = passCmp / passAtt;
    expect(compPct).toBeGreaterThanOrEqual(CALIBRATION.completionPctMin);
    expect(compPct).toBeLessThanOrEqual(CALIBRATION.completionPctMax);

    const ypc = rushYds / rushAtt;
    expect(ypc).toBeGreaterThanOrEqual(CALIBRATION.yardsPerCarryMin);
    expect(ypc).toBeLessThanOrEqual(CALIBRATION.yardsPerCarryMax);

    const sacksPerTeam = sacks / teamGames;
    expect(sacksPerTeam).toBeGreaterThanOrEqual(CALIBRATION.sacksPerTeamMin);
    expect(sacksPerTeam).toBeLessThanOrEqual(CALIBRATION.sacksPerTeamMax);

    const toPerTeam = turnovers / teamGames;
    expect(toPerTeam).toBeGreaterThanOrEqual(CALIBRATION.turnoversPerTeamMin);
    expect(toPerTeam).toBeLessThanOrEqual(CALIBRATION.turnoversPerTeamMax);

    const penPerTeam = penalties / teamGames;
    expect(penPerTeam).toBeGreaterThanOrEqual(CALIBRATION.penaltiesPerGameMin);
    expect(penPerTeam).toBeLessThanOrEqual(CALIBRATION.penaltiesPerGameMax);

    const puntsPerGame = punts / games;
    expect(puntsPerGame).toBeGreaterThanOrEqual(CALIBRATION.puntsPerGameMin);
    expect(puntsPerGame).toBeLessThanOrEqual(CALIBRATION.puntsPerGameMax);
  });

  it('gives a +10 OVR team a win rate inside the calibration band', () => {
    let wins = 0;
    let n = 0;
    for (let s = 0; s < 60; s++) {
      const seed = 810000 + s;
      const league = generateLeague(seed, 0);
      const teams: readonly Team[] = league.teams;
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          const a = teams[i]!;
          const b = teams[j]!;
          const gap = a.ovr - b.ovr;
          if (Math.abs(gap) < 9 || Math.abs(gap) > 11) continue;
          const strong = gap > 0 ? a : b;
          const weak = gap > 0 ? b : a;
          // Week 17 == neutral site, so this measures the rating edge alone.
          const game: ScheduledGame = {
            id: `CAL-${seed}-${strong.identity.id}@${weak.identity.id}`,
            week: 17,
            homeId: weak.identity.id,
            awayId: strong.identity.id,
          };
          const o = simGame(seed, game, teams);
          n++;
          if (o.result.awayScore > o.result.homeScore) wins++;
        }
      }
    }
    expect(n).toBeGreaterThan(400);
    const rate = wins / n;
    expect(rate).toBeGreaterThanOrEqual(CALIBRATION.ovrEdge10WinRateMin);
    expect(rate).toBeLessThanOrEqual(CALIBRATION.ovrEdge10WinRateMax);
  });
});
