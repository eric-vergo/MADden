// Balance soak: N full CPU-vs-CPU games with distribution assertions.
// Run explicitly with `npm run test:soak` (vitest --mode soak).
// Grows real assertions once the sim core (S1) and AI (S8) land.

import { describe, expect, it } from 'vitest';
import { GamePhase } from '../src/sim/types';
import { runHeadlessGame } from './harness/headlessGame';
import { CALIBRATION } from '../src/data/balance';

const SOAK = import.meta.env.MODE === 'soak';

describe.skipIf(!SOAK)('balance soak', () => {
  it('runs seeded CPU-vs-CPU games to completion with sane stats', () => {
    const games = 32;
    const scores: number[] = [];
    for (let i = 0; i < games; i++) {
      const result = runHeadlessGame({ seed: 10_000 + i, quarterLengthSec: 300 });
      expect(result.hitTickCap, `game ${i} hit the tick cap`).toBe(false);
      expect(result.state.phase).toBe(GamePhase.GAME_OVER);
      for (const s of result.finalScore) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(90);
        expect(Number.isFinite(s)).toBe(true);
        scores.push(s);
      }
      expect(Number.isNaN(result.finalHash)).toBe(false);
    }
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(mean).toBeGreaterThanOrEqual(CALIBRATION.scoreMeanMin);
    expect(mean).toBeLessThanOrEqual(CALIBRATION.scoreMeanMax);
  });
});
