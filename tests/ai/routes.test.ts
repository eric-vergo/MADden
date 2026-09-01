import { describe, expect, it } from 'vitest';
import { dist, len } from '../../src/sim/vec';
import { routeComplete, updateRoute } from '../../src/sim/ai/routes';
import { makeScenario } from './helpers';

const DEF_SPEC = {
  slot: 11, role: 'CB1' as const, pos: 'CB' as const, team: 1 as const,
  x: 40, y: 66,
  assignment: { kind: 'zone' as const, zone: 'deepThird-R' as const },
};

describe('route running', () => {
  it('hits its waypoints in order and finishes the route', () => {
    const s = makeScenario({
      los: 60,
      players: [
        {
          slot: 1, role: 'WR1', pos: 'WR', x: 12, y: 59.3,
          assignment: {
            kind: 'route',
            route: {
              waypoints: [
                { dx: 0, dy: 6, breakStyle: 'sharp' },
                { dx: 7, dy: 12, breakStyle: 'sharp', thenAction: 'lookForBall' },
              ],
            },
          },
        },
        DEF_SPEC,
      ],
    });
    const wr = s.play.players[1]!;
    let hitFirst = false;
    for (let t = 0; t < 180; t++) {
      updateRoute(s.ctx(), 1);
      s.tick();
      if (dist(wr.pos2, { x: 12, y: 65.3 }) < 1.2) hitFirst = true;
    }
    expect(hitFirst).toBe(true);
    expect(dist(wr.pos2, { x: 19, y: 71.3 })).toBeLessThan(2.5);
    expect(routeComplete(wr)).toBe(true);
  });

  it('paces itself to an atTick waypoint instead of sprinting', () => {
    const s = makeScenario({
      los: 60,
      players: [
        {
          slot: 1, role: 'WR1', pos: 'WR', x: 12, y: 59.3,
          assignment: {
            kind: 'route',
            route: { waypoints: [{ dx: 0, dy: 8, breakStyle: 'rounded', atTick: 120 }] },
          },
        },
        DEF_SPEC,
      ],
    });
    const wr = s.play.players[1]!;
    let peak = 0;
    for (let t = 0; t < 60; t++) {
      updateRoute(s.ctx(), 1);
      s.tick();
      peak = Math.max(peak, len(wr.vel));
    }
    // 8 yards over 2 seconds is a 4 yd/s pace, not a 10 yd/s sprint.
    expect(peak).toBeLessThan(5.0);
    expect(peak).toBeGreaterThan(2.0);
  });

  it('decelerates into a sharp break', () => {
    const s = makeScenario({
      los: 60,
      players: [
        {
          slot: 1, role: 'WR1', pos: 'WR', x: 12, y: 59.3,
          assignment: {
            kind: 'route',
            route: {
              waypoints: [
                { dx: 0, dy: 10, breakStyle: 'sharp' },
                { dx: 8, dy: 10, breakStyle: 'sharp', thenAction: 'lookForBall' },
              ],
            },
          },
        },
        DEF_SPEC,
      ],
    });
    const wr = s.play.players[1]!;
    let speedAtBreak = 99;
    for (let t = 0; t < 120; t++) {
      updateRoute(s.ctx(), 1);
      s.tick();
      if (Math.abs(wr.pos2.y - 69.3) < 0.6 && wr.pos2.x < 12.6) {
        speedAtBreak = Math.min(speedAtBreak, len(wr.vel));
      }
    }
    expect(speedAtBreak).toBeLessThan(6.0);
  });

  it('the throw target attacks the ball while the others block or clear', () => {
    const s = makeScenario({
      los: 60,
      players: [
        {
          slot: 1, role: 'WR1', pos: 'WR', x: 12, y: 68,
          assignment: {
            kind: 'route',
            route: { waypoints: [{ dx: 0, dy: 12, breakStyle: 'sharp' }] },
          },
        },
        {
          slot: 2, role: 'WR2', pos: 'WR', x: 40, y: 72,
          assignment: {
            kind: 'route',
            route: { waypoints: [{ dx: 0, dy: 12, breakStyle: 'sharp' }] },
          },
        },
        { slot: 11, role: 'CB1', pos: 'CB', team: 1, x: 41, y: 74, assignment: { kind: 'zone', zone: 'deepThird-R' } },
      ],
    });
    s.play.ball.mode = 'pass';
    s.play.ball.pos2 = { x: 12, y: 64 };
    s.play.ball.z = 4;
    s.play.ball.vz = -1;
    s.play.ball.vel = { x: 0, y: 6 };
    s.play.ball.targetIdx = 1;

    const target = s.play.players[1]!;
    const other = s.play.players[2]!;
    for (let t = 0; t < 30; t++) {
      updateRoute(s.ctx(), 1);
      updateRoute(s.ctx(), 2);
      s.tick();
    }
    expect(target.anim).toBe('catching');
    // The ball is behind WR2, so he turns and blocks instead of running on.
    expect(other.anim).toBe('blocking');
  });
});
