// Balance soak: 32 full CPU-vs-CPU games, asserted against the league
// calibration bands in data/balance.
//
// Run explicitly with `npm run test:soak` (vitest --mode soak).
//
// The seeds are pinned and GameSim is deterministic, so these means are exact
// for a given build — nothing here can flake on a reroll. What they DO catch is
// a gameplay change quietly dragging the football out of shape: a pass rush
// that stops arriving, a catch model that turns every throw into a completion,
// a kicker who cannot reach the uprights. Each band is a range rather than a
// point so ordinary tuning has somewhere to move.

import { describe, expect, it } from 'vitest';
import { GamePhase } from '../src/sim/types';
import { runHeadlessGame } from './harness/headlessGame';
import { CALIBRATION } from '../src/data/balance';

const SOAK = import.meta.env.MODE === 'soak';

const GAMES = 32;
const SEED_BASE = 10_000;

interface Totals {
  points: number;
  totalYds: number;
  passCmp: number;
  passAtt: number;
  rushAtt: number;
  rushYds: number;
  sacksAllowed: number;
  turnovers: number;
  penalties: number;
  punts: number;
  fga: number;
  plays: number;
}

function emptyTotals(): Totals {
  return {
    points: 0, totalYds: 0, passCmp: 0, passAtt: 0, rushAtt: 0, rushYds: 0,
    sacksAllowed: 0, turnovers: 0, penalties: 0, punts: 0, fga: 0, plays: 0,
  };
}

/** Run the fixed soak slate once and fold every game into one box score. */
function runSlate(): { totals: Totals; scores: number[] } {
  const totals = emptyTotals();
  const scores: number[] = [];
  for (let i = 0; i < GAMES; i++) {
    const result = runHeadlessGame({ seed: SEED_BASE + i, quarterLengthSec: 300 });
    expect(result.hitTickCap, `game ${i} hit the tick cap`).toBe(false);
    expect(result.state.phase, `game ${i} did not finish`).toBe(GamePhase.GAME_OVER);
    expect(Number.isNaN(result.finalHash), `game ${i} produced a NaN hash`).toBe(false);
    for (const s of result.finalScore) {
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(90);
      scores.push(s);
    }

    const stats = result.state.stats;
    for (const team of stats.teams) {
      totals.points += team.points;
      totals.totalYds += team.totalYds;
      totals.rushYds += team.rushYds;
      totals.sacksAllowed += team.sacksAllowed;
      totals.turnovers += team.turnovers;
      totals.penalties += team.penalties;
    }
    for (const id of Object.keys(stats.players)) {
      const p = stats.players[id];
      if (p === undefined) continue;
      totals.passCmp += p.passCmp;
      totals.passAtt += p.passAtt;
      totals.rushAtt += p.rushAtt;
      totals.punts += p.punts;
      totals.fga += p.fga;
    }
    totals.plays += result.state.playLog.length;
  }
  return { totals, scores };
}

describe.skipIf(!SOAK)('balance soak', () => {
  it('produces league-realistic football over 32 CPU-vs-CPU games', () => {
    const { totals, scores } = runSlate();
    const teamGames = GAMES * 2;

    const perTeam = {
      points: totals.points / teamGames,
      yards: totals.totalYds / teamGames,
      sacksAllowed: totals.sacksAllowed / teamGames,
      turnovers: totals.turnovers / teamGames,
    };
    const perGame = {
      punts: totals.punts / GAMES,
      fgAtt: totals.fga / GAMES,
      penalties: totals.penalties / GAMES,
      plays: totals.plays / GAMES,
    };
    const completionPct = totals.passCmp / Math.max(1, totals.passAtt);
    const yardsPerCarry = totals.rushYds / Math.max(1, totals.rushAtt);

    // Printed so a failure shows the whole shape of the football, not just the
    // one band that tripped.
    const summary = JSON.stringify({ perTeam, perGame, completionPct, yardsPerCarry });

    const scoreMean = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(scoreMean, summary).toBeGreaterThanOrEqual(CALIBRATION.scoreMeanMin);
    expect(scoreMean, summary).toBeLessThanOrEqual(CALIBRATION.scoreMeanMax);
    expect(perTeam.points, summary).toBeGreaterThanOrEqual(CALIBRATION.scoreMeanMin);
    expect(perTeam.points, summary).toBeLessThanOrEqual(CALIBRATION.scoreMeanMax);

    expect(completionPct, summary).toBeGreaterThanOrEqual(CALIBRATION.completionPctMin);
    expect(completionPct, summary).toBeLessThanOrEqual(CALIBRATION.completionPctMax);

    expect(yardsPerCarry, summary).toBeGreaterThanOrEqual(CALIBRATION.yardsPerCarryMin);
    expect(yardsPerCarry, summary).toBeLessThanOrEqual(CALIBRATION.yardsPerCarryMax);

    expect(perTeam.sacksAllowed, summary).toBeGreaterThanOrEqual(CALIBRATION.sacksPerTeamMin);
    expect(perTeam.sacksAllowed, summary).toBeLessThanOrEqual(CALIBRATION.sacksPerTeamMax);

    expect(perTeam.turnovers, summary).toBeGreaterThanOrEqual(CALIBRATION.turnoversPerTeamMin);
    expect(perTeam.turnovers, summary).toBeLessThanOrEqual(CALIBRATION.turnoversPerTeamMax);

    expect(perGame.punts, summary).toBeGreaterThanOrEqual(CALIBRATION.puntsPerGameMin);
    expect(perGame.punts, summary).toBeLessThanOrEqual(CALIBRATION.puntsPerGameMax);

    expect(perGame.fgAtt, summary).toBeGreaterThanOrEqual(CALIBRATION.fgAttPerGameMin);
    expect(perGame.fgAtt, summary).toBeLessThanOrEqual(CALIBRATION.fgAttPerGameMax);

    expect(perGame.penalties, summary).toBeGreaterThanOrEqual(CALIBRATION.penaltiesPerGameMin);
    expect(perGame.penalties, summary).toBeLessThanOrEqual(CALIBRATION.penaltiesPerGameMax);

    expect(perGame.plays, summary).toBeGreaterThanOrEqual(CALIBRATION.playsPerGameMin);
    expect(perGame.plays, summary).toBeLessThanOrEqual(CALIBRATION.playsPerGameMax);

    // Yardage has no hard band, but a team that gains half or double the
    // league average is not playing the same sport.
    expect(perTeam.yards, summary).toBeGreaterThan(CALIBRATION.leagueAvgYardsPerTeam * 0.5);
    expect(perTeam.yards, summary).toBeLessThan(CALIBRATION.leagueAvgYardsPerTeam * 1.6);

    // The passing and running games must both be live: a sim that has quietly
    // become one-dimensional still passes every rate band above.
    const passShare = totals.passAtt / Math.max(1, totals.passAtt + totals.rushAtt);
    expect(passShare, summary).toBeGreaterThan(0.45);
    expect(passShare, summary).toBeLessThan(0.80);
  }, 180_000);
});
