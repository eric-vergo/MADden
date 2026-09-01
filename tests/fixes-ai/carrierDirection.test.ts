// Regression: F1 — every ball carrier must run toward the goal HIS OWN team is
// attacking, not toward the goal the snapping offense is attacking.
//
// ctx.dir stays the snapping offense's direction (routes/coverage/blocking and
// the special-teams geometry all depend on that convention); the carrier brain
// has to read state.attackDir[carrier.team] instead.

import { describe, expect, it } from 'vitest';
import { makeScenario, type Scenario } from '../ai/helpers';
import { updateLiveAI } from '../../src/sim/ai/index';
import { emptyTickInput } from '../../src/sim/events';
import { makeRngSet } from '../../src/sim/rng';

function drive(s: Scenario, ticks: number): void {
  const rng = makeRngSet(11);
  for (let i = 0; i < ticks; i++) {
    updateLiveAI(s.state, emptyTickInput(), rng, s.events);
    s.state.tick++;
  }
}

function carrierScenario(opts: {
  slot: number;
  team: 0 | 1;
  role: 'RB' | 'FS' | 'KR';
  y: number;
  assignment: { kind: 'carrierAI' } | { kind: 'returner' };
  los: number;
}): Scenario {
  const s = makeScenario({
    los: opts.los,
    ballAt: { x: 26.6, y: opts.y },
    players: [
      {
        slot: opts.slot,
        role: opts.role,
        pos: opts.role === 'FS' ? 'S' : 'WR',
        team: opts.team,
        x: 26.6,
        y: opts.y,
        assignment: opts.assignment,
        hasBall: true,
      },
    ],
  });
  s.state.attackDir = [1, -1];
  s.state.possession = 0;
  s.play.ball.mode = 'held';
  s.play.ball.carrierIdx = opts.slot;
  return s;
}

describe('ball-carrier direction follows the carrier, not the snapping offense', () => {
  it('an offensive carrier runs toward the offense goal (control case)', () => {
    const s = carrierScenario({ slot: 1, team: 0, role: 'RB', y: 62, assignment: { kind: 'carrierAI' }, los: 60 });
    const rb = s.play.players[1]!;
    drive(s, 120);
    expect(rb.pos2.y).toBeGreaterThan(62 + 8);
  });

  it('an interceptor steers toward HIS OWN attack goal', () => {
    // Team 0 snapped (attackDir +1); the interceptor is team 1, attackDir -1.
    const s = carrierScenario({ slot: 11, team: 1, role: 'FS', y: 74, assignment: { kind: 'carrierAI' }, los: 70 });
    const def = s.play.players[11]!;
    drive(s, 120);
    expect(def.pos2.y).toBeLessThan(74 - 8);
    // …and he never drifts back toward his own goal line (y = 110).
    expect(def.pos2.y).toBeLessThan(110);
  });

  it('a kick returner fielding at his own 4 advances upfield, not into his end zone', () => {
    // Kicking team 0 attacks +y, so the receiving team (1) fields near y = 110
    // and must return toward y = 10. His own goal line is y = 110.
    const s = carrierScenario({ slot: 11, team: 1, role: 'KR', y: 106, assignment: { kind: 'returner' }, los: 35 });
    const kr = s.play.players[11]!;
    drive(s, 120);
    expect(kr.pos2.y).toBeLessThan(106 - 8);
    expect(kr.pos2.y).toBeLessThan(110);
  });

  it('the team that lost the ball chases the interceptor instead of running its routes', () => {
    // Team 0 snapped and is attacking +y; team 1 has just picked the ball off
    // at y = 74. The receiver must abandon his route and come get him.
    const s = makeScenario({
      los: 70,
      ballAt: { x: 26.6, y: 74 },
      players: [
        {
          slot: 3,
          role: 'WR1',
          pos: 'WR',
          team: 0,
          x: 40,
          y: 78,
          assignment: {
            kind: 'route',
            route: { waypoints: [{ dx: 0, dy: 25, breakStyle: 'rounded' }] },
          },
        },
        {
          slot: 11,
          role: 'FS',
          pos: 'S',
          team: 1,
          x: 26.6,
          y: 74,
          assignment: { kind: 'carrierAI' },
          hasBall: true,
        },
      ],
    });
    s.state.attackDir = [1, -1];
    s.state.possession = 0;
    s.play.ball.mode = 'held';
    s.play.ball.carrierIdx = 11;

    const wr = s.play.players[3]!;
    const def = s.play.players[11]!;
    const before = Math.hypot(wr.pos2.x - def.pos2.x, wr.pos2.y - def.pos2.y);
    drive(s, 60);
    const after = Math.hypot(wr.pos2.x - def.pos2.x, wr.pos2.y - def.pos2.y);
    expect(after).toBeLessThan(before);
    // He is closing on the runner, not still running his 25-yard route.
    expect(wr.pos2.y).toBeLessThan(78 + 4);
  });

  it('the returner brain still reads the kicking team frame (kneel vs return)', () => {
    // ctx.dir is the KICKING team's direction by design: the returner's own
    // goal line is targetGoalY(ctx.dir) = 110 here. A kick landing short of it
    // is returned; one landing past it is a kneel.
    const build = (ballY: number): Scenario => {
      const s = makeScenario({
        los: 45,
        ballAt: { x: 26.6, y: ballY },
        players: [
          { slot: 11, role: 'KR', pos: 'WR', team: 1, x: 26.6, y: 104, assignment: { kind: 'returner' } },
        ],
      });
      s.state.attackDir = [1, -1];
      s.state.possession = 0;
      s.play.ball.mode = 'kick';
      s.play.ball.z = 10;
      s.play.ball.vz = 0;
      s.play.ball.vel = { x: 0, y: 8 };
      s.play.ball.carrierIdx = null;
      return s;
    };

    const inField = build(95); // lands ≈ y 105, his own 5
    drive(inField, 1);
    expect(inField.play.players[11]!.mind['stReturnDecision']).toBe(1);

    const endZone = build(105); // lands ≈ y 115, past his goal line
    drive(endZone, 1);
    expect(endZone.play.players[11]!.mind['stReturnDecision']).toBe(2);
  });

  it('mirrored: an interceptor whose team attacks +y runs toward y = 110', () => {
    const s = carrierScenario({ slot: 11, team: 1, role: 'FS', y: 46, assignment: { kind: 'carrierAI' }, los: 50 });
    s.state.attackDir = [-1, 1]; // offense (team 0) attacks -y, interceptor +y
    const def = s.play.players[11]!;
    drive(s, 120);
    expect(def.pos2.y).toBeGreaterThan(46 + 8);
  });
});
