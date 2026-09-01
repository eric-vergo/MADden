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

const { TICK_DT } = await import('../../src/sim/constants');
const { dot, sub } = await import('../../src/sim/vec');
const { initPursuit, maybeTackle, updatePursuit } = await import('../../src/sim/ai/pursuit');
const { pursuePoint } = await import('../../src/sim/ai/steering');
const { makeScenario, place } = await import('./helpers');

function chaseScenario(difficulty: 'allPro' | 'allMadden' = 'allMadden') {
  return makeScenario({
    los: 60,
    difficulty,
    seed: 31,
    players: [
      {
        slot: 2, role: 'RB', pos: 'RB', x: 26, y: 64, hasBall: true,
        ratings: { spd: 80, acc: 80 },
        assignment: { kind: 'carrierAI' },
      },
      {
        slot: 11, role: 'MLB1', pos: 'LB', team: 1, x: 36, y: 64,
        ratings: { spd: 85, acc: 85, agi: 85 },
        assignment: { kind: 'pursuit' },
      },
    ],
  });
}

describe('pursuit', () => {
  beforeEach(() => {
    actions.attemptTackle.mockClear();
  });

  it('the intercept point leads a moving carrier', () => {
    const s = chaseScenario();
    const carrier = s.play.players[2]!;
    const defender = s.play.players[11]!;
    place(carrier, 26, 64, 0, 8);
    const aim = pursuePoint(defender, carrier.pos2, carrier.vel);
    // The aim point is ahead of the carrier along his velocity.
    expect(dot(sub(aim, carrier.pos2), carrier.vel)).toBeGreaterThan(0);
    expect(aim.y).toBeGreaterThan(carrier.pos2.y);
  });

  it('a chasing defender steers ahead of the carrier, not at his feet', () => {
    const s = chaseScenario();
    const carrier = s.play.players[2]!;
    const defender = s.play.players[11]!;
    s.play.ball.mode = 'held';
    s.play.ball.carrierIdx = 2;
    initPursuit(s.ctx(), 11);

    for (let t = 0; t < 20; t++) {
      place(carrier, carrier.pos2.x, carrier.pos2.y + 8 * TICK_DT, 0, 8);
      updatePursuit(s.ctx(), 11);
      s.tick();
    }
    // Velocity has a downfield component: he is cutting the runner off.
    expect(defender.vel.y).toBeGreaterThan(1.0);
    expect(defender.vel.x).toBeLessThan(0); // closing laterally too
  });

  it('calls attemptTackle once the geometry qualifies', () => {
    const s = chaseScenario();
    const carrier = s.play.players[2]!;
    const defender = s.play.players[11]!;
    s.play.ball.mode = 'held';
    s.play.ball.carrierIdx = 2;
    initPursuit(s.ctx(), 11);
    place(carrier, 26, 64, 0, 4);
    place(defender, 26.8, 64.4, -1, 0);
    defender.facing = Math.PI; // looking at the carrier

    const fired = maybeTackle(s.ctx(), 11);
    expect(fired).toBe(true);
    expect(actions.attemptTackle).toHaveBeenCalledTimes(1);
    const call = actions.attemptTackle.mock.calls[0]!;
    expect(call[1]).toBe(11); // tacklerIdx
    expect(call[2]).toEqual({ hitStick: false });
  });

  it('does not attempt a tackle from out of range', () => {
    const s = chaseScenario();
    s.play.ball.mode = 'held';
    s.play.ball.carrierIdx = 2;
    initPursuit(s.ctx(), 11);
    expect(maybeTackle(s.ctx(), 11)).toBe(false);
    expect(actions.attemptTackle).not.toHaveBeenCalled();
  });

  it('run recognition delays the fit, and PA freezes box defenders longer', () => {
    const base = makeScenario({
      los: 60,
      difficulty: 'allPro',
      seed: 5,
      players: [
        { slot: 2, role: 'RB', pos: 'RB', x: 26, y: 58, assignment: { kind: 'carrierAI' } },
        {
          slot: 11, role: 'MLB1', pos: 'LB', team: 1, x: 26.6, y: 64.5,
          assignment: { kind: 'runFit', gap: 'A-right' },
        },
      ],
    });
    initPursuit(base.ctx(), 11);
    const plain = base.play.players[11]!.mind['puRecogDelay'] as number;

    const pa = makeScenario({
      los: 60,
      difficulty: 'allPro',
      seed: 5,
      offensePlay: { type: 'playAction', playAction: { fakeTo: 'RB', fakeTicks: 22 } },
      players: [
        { slot: 2, role: 'RB', pos: 'RB', x: 26, y: 58, assignment: { kind: 'carrierAI' } },
        {
          slot: 11, role: 'MLB1', pos: 'LB', team: 1, x: 26.6, y: 64.5,
          assignment: { kind: 'runFit', gap: 'A-right' },
        },
      ],
    });
    initPursuit(pa.ctx(), 11);
    const frozen = pa.play.players[11]!.mind['puRecogDelay'] as number;
    expect(frozen).toBe(plain + 22);
  });
});
