// Difficulty soak: the four settings must actually be four settings.
//
// Both sides of a headless game are CPU-controlled and read the same
// DifficultyParams, so raw score cannot separate them — a better defense is
// playing a better offense. What DOES separate them is the direction each
// individual lever pulls, so this test watches the four cleanest ones:
//
//   run defense   — run recognition and pursuit noise shrink, so yards per
//                   carry must fall as difficulty rises
//   pass rush     — the CPU quarterback's read dwell shrinks, so the sacks he
//                   takes must fall
//   passing       — his openness threshold and lead error shrink, so his
//                   completion percentage must rise
//   kicking       — cpuKickErrorSigma shrinks, so field goal accuracy must rise
//
// Every game uses the SAME roster pair, so nothing here moves except the
// difficulty parameters. Run with `vitest --mode soak`.

import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/sim/GameSim';
import { GamePhase, type Difficulty, type GameConfig } from '../src/sim/types';
import { emptyTickInput } from '../src/sim/events';
import { makeTestRoster } from './harness/fixtures';

const SOAK = import.meta.env.MODE === 'soak';

// 16, not 10: the kicking rung is the narrowest claim here and ten games only
// put ~20 field goals behind it, which is not enough to resolve the gap the
// assertions below demand — the test passed or failed on which slate it drew.
const GAMES_PER_DIFFICULTY = 16;
const SEED_BASE = 500_000;
const TICK_CAP = 60 * 60 * 90;

/** Weakest to strongest — the order every assertion below walks. */
const LADDER: readonly Difficulty[] = ['rookie', 'pro', 'allPro', 'allMadden'];

interface Ladder {
  difficulty: Difficulty;
  /** League-wide yards per carry — falls as CPU run defense improves. */
  yardsPerCarry: number;
  /** Sacks taken per team-game — falls as the CPU QB decides faster. */
  sacksPerTeam: number;
  /** Completion percentage — rises as CPU reads and throws sharpen. */
  completionPct: number;
  /** Field goal percentage — rises as cpuKickErrorSigma shrinks. */
  fieldGoalPct: number;
  fieldGoalAtt: number;
}

function measure(difficulty: Difficulty): Ladder {
  let rushAtt = 0;
  let rushYds = 0;
  let sacks = 0;
  let cmp = 0;
  let att = 0;
  let fgm = 0;
  let fga = 0;

  for (let i = 0; i < GAMES_PER_DIFFICULTY; i++) {
    const config: GameConfig = {
      quarterLengthSec: 300,
      difficulty,
      userTeam: null,
      allowTies: true,
      penaltiesEnabled: true,
      enableOnside: false,
    };
    // One fixed roster pair across the whole ladder: only difficulty varies.
    const sim = new GameSim(
      config,
      [makeTestRoster('HOM', 77), makeTestRoster('AWY', 78)],
      SEED_BASE + i,
    );
    let ticks = 0;
    while (sim.state.phase !== GamePhase.GAME_OVER && ticks < TICK_CAP) {
      sim.tick(emptyTickInput());
      ticks++;
    }
    expect(sim.state.phase, `${difficulty} game ${i} did not finish`).toBe(GamePhase.GAME_OVER);

    const stats = sim.state.stats;
    for (const team of stats.teams) {
      rushYds += team.rushYds;
      sacks += team.sacksAllowed;
    }
    for (const id of Object.keys(stats.players)) {
      const p = stats.players[id];
      if (p === undefined) continue;
      rushAtt += p.rushAtt;
      cmp += p.passCmp;
      att += p.passAtt;
      fgm += p.fgm;
      fga += p.fga;
    }
  }

  const teamGames = GAMES_PER_DIFFICULTY * 2;
  return {
    difficulty,
    yardsPerCarry: rushYds / Math.max(1, rushAtt),
    sacksPerTeam: sacks / teamGames,
    completionPct: cmp / Math.max(1, att),
    fieldGoalPct: fgm / Math.max(1, fga),
    fieldGoalAtt: fga,
  };
}

describe.skipIf(!SOAK)('difficulty soak', () => {
  it('scales CPU strength monotonically across the four settings', () => {
    const rungs = LADDER.map(measure);
    const table = JSON.stringify(rungs.map((r) => ({
      d: r.difficulty,
      ypc: +r.yardsPerCarry.toFixed(2),
      sacks: +r.sacksPerTeam.toFixed(2),
      cmp: +r.completionPct.toFixed(3),
      fgPct: +r.fieldGoalPct.toFixed(3),
      fga: r.fieldGoalAtt,
    })));
    // Printed on the way through, not only on a failure: the margin a rung
    // clears its neighbour by is the thing a tuning pass needs to see.
    console.log(`difficulty ladder ${table}`);

    const first = rungs[0] as Ladder;
    const last = rungs[rungs.length - 1] as Ladder;

    // Step-to-step: never a REGRESSION beyond the tolerance. Individual rungs
    // can sit close together; what must never happen is a setting that plays
    // meaningfully worse than the one below it.
    for (let i = 1; i < rungs.length; i++) {
      const prev = rungs[i - 1] as Ladder;
      const cur = rungs[i] as Ladder;
      const step = `${prev.difficulty} -> ${cur.difficulty} ${table}`;
      expect(cur.yardsPerCarry, `run defense regressed ${step}`)
        .toBeLessThanOrEqual(prev.yardsPerCarry + 0.75);
      expect(cur.sacksPerTeam, `QB decision speed regressed ${step}`)
        .toBeLessThanOrEqual(prev.sacksPerTeam + 0.75);
      expect(cur.completionPct, `CPU passing regressed ${step}`)
        .toBeGreaterThanOrEqual(prev.completionPct - 0.03);
      expect(cur.fieldGoalPct, `CPU kicking regressed ${step}`)
        .toBeGreaterThanOrEqual(prev.fieldGoalPct - 0.2);
    }

    // End to end the gap has to be unmistakable.
    expect(last.yardsPerCarry, `run defense ladder is flat ${table}`)
      .toBeLessThan(first.yardsPerCarry - 1.0);
    expect(last.sacksPerTeam, `pass protection ladder is flat ${table}`)
      .toBeLessThan(first.sacksPerTeam - 1.5);
    expect(last.completionPct, `passing ladder is flat ${table}`)
      .toBeGreaterThan(first.completionPct + 0.03);
    expect(last.fieldGoalPct, `kicking ladder is flat ${table}`)
      .toBeGreaterThan(first.fieldGoalPct + 0.2);

    // A kicking claim needs kicks behind it.
    for (const r of rungs) {
      expect(r.fieldGoalAtt, `no field goals at ${r.difficulty} ${table}`).toBeGreaterThan(3);
    }
  }, 180_000);
});
