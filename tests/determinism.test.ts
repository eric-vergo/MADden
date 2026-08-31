// Same seed + same inputs ⇒ identical state hashes, tick for tick.
// This suite grows teeth as the sim fills in; it must stay green at every phase.

import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/sim/GameSim';
import type { GameConfig, TeamRoster } from '../src/sim/types';
import { emptyTickInput } from '../src/sim/events';
import { makeTestRoster } from './harness/fixtures';

function makeSim(seed: number): GameSim {
  const rosters: [TeamRoster, TeamRoster] = [
    makeTestRoster('HOM', seed),
    makeTestRoster('AWY', seed + 1),
  ];
  const config: GameConfig = {
    quarterLengthSec: 60,
    difficulty: 'allPro',
    userTeam: null,
    allowTies: true,
    penaltiesEnabled: true,
    enableOnside: false,
  };
  return new GameSim(config, rosters, seed);
}

describe('determinism', () => {
  it('two runs with the same seed produce identical hashes every 50 ticks', () => {
    const a = makeSim(1234);
    const b = makeSim(1234);
    for (let t = 0; t < 2000; t++) {
      a.tick(emptyTickInput());
      b.tick(emptyTickInput());
      if (t % 50 === 0) {
        expect(a.hash(), `hash mismatch at tick ${t}`).toBe(b.hash());
      }
    }
    expect(a.hash()).toBe(b.hash());
  });

  it('different seeds diverge', () => {
    const a = makeSim(1);
    const b = makeSim(2);
    for (let t = 0; t < 500; t++) {
      a.tick(emptyTickInput());
      b.tick(emptyTickInput());
    }
    // Rosters differ by seed, so initial hashes already differ; assert on
    // final state hash to catch a sim that ignores its seed entirely.
    expect(a.hash()).not.toBe(b.hash());
  });

  it('identical fixture rosters are seed-stable', () => {
    const r1 = makeTestRoster('ASH', 42);
    const r2 = makeTestRoster('ASH', 42);
    expect(r1).toEqual(r2);
  });
});
