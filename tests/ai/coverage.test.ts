import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../../src/sim/constants';
import { dist } from '../../src/sim/vec';
import { initCoverage, updateMan, updateZone, zoneMinDepthY } from '../../src/sim/ai/coverage';
import { makeScenario, place } from './helpers';

describe('man coverage', () => {
  it('tracks a scripted slant after its reaction delay', () => {
    const s = makeScenario({
      los: 60,
      difficulty: 'allPro',
      players: [
        {
          slot: 1, role: 'WR1', pos: 'WR', x: 14, y: 59.3,
          assignment: { kind: 'route', route: { waypoints: [{ dx: 0, dy: 12, breakStyle: 'sharp' }] } },
        },
        {
          slot: 11, role: 'CB1', pos: 'CB', team: 1, x: 14, y: 65,
          ratings: { spd: 90, acc: 90, agi: 90, mcv: 85 },
          assignment: { kind: 'man', target: 'WR1', leverage: 'outside', cushionYd: 5 },
        },
      ],
    });
    const cb = s.play.players[11]!;
    const wr = s.play.players[1]!;
    initCoverage(s.ctx(), 11);

    // Scripted slant: 3 yards vertical, then inside at 45 degrees.
    for (let t = 0; t < 90; t++) {
      const speed = 8;
      const vx = t < 22 ? 0 : speed * 0.7;
      const vy = t < 22 ? speed : speed * 0.7;
      place(wr, wr.pos2.x + vx * TICK_DT, wr.pos2.y + vy * TICK_DT, vx, vy);
      updateMan(s.ctx(), 11);
      s.tick();
    }
    expect(dist(cb.pos2, wr.pos2)).toBeLessThan(4.5);
    // He has to be somewhere near the break, not still at his alignment.
    expect(cb.pos2.x).toBeGreaterThan(15);
  });

  it('lags the receiver by roughly the reaction delay right after the break', () => {
    const s = makeScenario({
      los: 60,
      difficulty: 'rookie', // longest reaction delays
      players: [
        {
          slot: 1, role: 'WR1', pos: 'WR', x: 14, y: 59.3,
          assignment: { kind: 'route', route: { waypoints: [{ dx: 0, dy: 12, breakStyle: 'sharp' }] } },
        },
        {
          slot: 11, role: 'CB1', pos: 'CB', team: 1, x: 14, y: 65,
          ratings: { mcv: 60 },
          assignment: { kind: 'man', target: 'WR1', leverage: 'outside', cushionYd: 5 },
        },
      ],
    });
    const cb = s.play.players[11]!;
    const wr = s.play.players[1]!;
    initCoverage(s.ctx(), 11);
    const delay = cb.mind['cvDelay'] as number;
    expect(delay).toBeGreaterThanOrEqual(14); // rookie 18-26 minus <=4 mcv bonus

    for (let t = 0; t < 10; t++) {
      place(wr, wr.pos2.x + 8 * TICK_DT, wr.pos2.y, 8, 0);
      updateMan(s.ctx(), 11);
      s.tick();
    }
    // The corner has not yet seen the break: still essentially at his spot.
    expect(Math.abs(cb.pos2.x - 14)).toBeLessThan(0.6);
  });
});

describe('zone coverage', () => {
  it('a deep third defender never plays shallower than minDepth before a throw', () => {
    const s = makeScenario({
      los: 60,
      difficulty: 'allPro',
      ballAt: { x: 26.6, y: 60 },
      players: [
        {
          slot: 1, role: 'WR1', pos: 'WR', x: 13.6, y: 70,
          assignment: { kind: 'route', route: { waypoints: [{ dx: 0, dy: 10, breakStyle: 'sharp' }] } },
        },
        {
          slot: 11, role: 'CB1', pos: 'CB', team: 1, x: 13.6, y: 78,
          assignment: { kind: 'zone', zone: 'deepThird-L' },
        },
      ],
    });
    const cb = s.play.players[11]!;
    const ctx0 = s.ctx();
    initCoverage(ctx0, 11);
    const minY = zoneMinDepthY(ctx0, 'deepThird-L');
    expect(minY).toBeCloseTo(72, 5);

    for (let t = 0; t < 90; t++) {
      updateZone(s.ctx(), 11);
      s.tick();
      // 0.75 yd of slack for the settle overshoot when he closes on the mouth.
      expect(cb.pos2.y).toBeGreaterThanOrEqual(minY - 0.75);
    }
  });

  it('breaks below minDepth on the ball once the break delay elapses', () => {
    const s = makeScenario({
      los: 60,
      difficulty: 'allPro',
      players: [
        {
          slot: 1, role: 'WR1', pos: 'WR', x: 13.6, y: 70,
          assignment: { kind: 'route', route: { waypoints: [{ dx: 0, dy: 10, breakStyle: 'sharp' }] } },
        },
        {
          slot: 11, role: 'CB1', pos: 'CB', team: 1, x: 13.6, y: 78,
          ratings: { zcv: 90, spd: 92, acc: 92 },
          assignment: { kind: 'zone', zone: 'deepThird-L' },
        },
      ],
    });
    const cb = s.play.players[11]!;
    initCoverage(s.ctx(), 11);
    for (let t = 0; t < 40; t++) { updateZone(s.ctx(), 11); s.tick(); }

    // Ball in the air, landing on the receiver.
    s.play.ball.mode = 'pass';
    s.play.ball.pos2 = { x: 13.6, y: 70 };
    s.play.ball.z = 2.2;
    s.play.ball.vz = 0;
    s.play.ball.vel = { x: 0, y: 0 };
    s.play.ball.targetIdx = 1;

    for (let t = 0; t < 60; t++) { updateZone(s.ctx(), 11); s.tick(); }
    expect(cb.pos2.y).toBeLessThan(72);
    // High ZCV attacks the ball rather than swatting.
    expect(cb.mind['cvPlayBall']).toBe(1);
  });

  it('a low-rated defender plays for the swat instead of the pick', () => {
    const s = makeScenario({
      los: 60,
      players: [
        {
          slot: 1, role: 'WR1', pos: 'WR', x: 13.6, y: 70,
          assignment: { kind: 'route', route: { waypoints: [{ dx: 0, dy: 10, breakStyle: 'sharp' }] } },
        },
        {
          slot: 11, role: 'CB1', pos: 'CB', team: 1, x: 13.6, y: 72,
          ratings: { zcv: 55 },
          assignment: { kind: 'zone', zone: 'deepThird-L' },
        },
      ],
    });
    const cb = s.play.players[11]!;
    initCoverage(s.ctx(), 11);
    s.play.ball.mode = 'pass';
    s.play.ball.pos2 = { x: 13.6, y: 70 };
    s.play.ball.z = 2.2;
    s.play.ball.targetIdx = 1;
    for (let t = 0; t < 40; t++) { updateZone(s.ctx(), 11); s.tick(); }
    expect(cb.mind['cvPlayBall']).toBe(2);
  });
});
