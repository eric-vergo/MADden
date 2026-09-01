import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  throwPass: vi.fn(),
  throwAway: vi.fn(),
  attemptTackle: vi.fn(),
  tryCarrierMove: vi.fn(),
  pressKickMeter: vi.fn(),
  callFairCatch: vi.fn(),
  maybeHoldingOnShed: vi.fn(),
}));
vi.mock('../../src/sim/actions', () => actions);

const { QB_AI } = await import('../../src/data/balance');
const { initQb, updateQb, QB_STATE, opennessOf, pressure01 } = await import('../../src/sim/ai/qb');
const { makeScenario } = await import('./helpers');
const { PlayerSpecs } = await import('./qbFixtures');

beforeEach(() => {
  actions.throwPass.mockClear();
  actions.throwAway.mockClear();
});

describe('CPU QB reads', () => {
  it('throws to the open read and skips the covered primary', () => {
    const s = makeScenario(PlayerSpecs.openSecondRead());
    initQb(s.ctx(), 0);
    for (let t = 0; t < 150 && actions.throwPass.mock.calls.length === 0; t++) {
      updateQb(s.ctx(), 0);
      s.tick();
    }
    expect(actions.throwPass).toHaveBeenCalledTimes(1);
    const call = actions.throwPass.mock.calls[0]!;
    expect(call[1]).toBe(0); // passerIdx
    expect(call[2]).toBe(2); // WR2 slot — the open second read
    expect(call[3].leadErrorSigmaYd).toBeCloseTo(0.15, 5); // allPro
  });

  it('checks down when every progression read is covered', () => {
    const s = makeScenario(PlayerSpecs.allCovered());
    initQb(s.ctx(), 0);
    for (let t = 0; t < 260 && actions.throwPass.mock.calls.length === 0; t++) {
      updateQb(s.ctx(), 0);
      s.tick();
    }
    expect(actions.throwPass).toHaveBeenCalledTimes(1);
    expect(actions.throwPass.mock.calls[0]![2]).toBe(5); // RB checkdown
  });

  it('leaves the pocket to scramble under heavy pressure', () => {
    const s = makeScenario(PlayerSpecs.pressured());
    const qb = s.play.players[0]!;
    initQb(s.ctx(), 0);
    let maxPress = 0;
    for (let t = 0; t < 60; t++) {
      maxPress = Math.max(maxPress, pressure01(s.ctx(), 0));
      updateQb(s.ctx(), 0);
      s.tick();
    }
    expect(maxPress).toBeGreaterThan(QB_AI.scramblePressureThreshold);
    expect(qb.mind['qbState']).toBe(QB_STATE.SCRAMBLE);
    expect(actions.throwPass).not.toHaveBeenCalled();
  });

  it('openness marks a read dead when a zone defender beats the ball', () => {
    const s = makeScenario(PlayerSpecs.deadRead());
    const open = opennessOf(s.ctx(), 0, 1);
    expect(open.dead).toBe(true);
  });
});
