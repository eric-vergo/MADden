// End-to-end exercise of updateLiveAI against real playbook data: everybody
// gets a job, the ball-side moves downfield, and the whole thing is
// bit-identical across runs with the same seed.

import { describe, expect, it } from 'vitest';
import { emptyTickInput } from '../../src/sim/events';
import { makeRngSet } from '../../src/sim/rng';
import { allDefensivePlays, allOffensivePlays } from '../../src/data/plays/index';
import { updateLiveAI } from '../../src/sim/ai/index';
import { makeFullScenario } from './helpers';

function firstOfType(type: string): string {
  const p = allOffensivePlays().find((x) => x.type === type);
  if (!p) throw new Error(`no offensive play of type ${type}`);
  return p.id;
}

function firstScrimmageDefense(): string {
  const d = allDefensivePlays().find((x) => x.shell !== 'specialTeams');
  if (!d) throw new Error('no scrimmage defense');
  return d.id;
}

function runTicks(s: ReturnType<typeof makeFullScenario>, n: number, seed = 5): void {
  const rng = makeRngSet(seed);
  for (let t = 0; t < n; t++) {
    updateLiveAI(s.state, emptyTickInput(), rng, s.events);
    s.tick();
  }
}

describe('updateLiveAI on a live pass play', () => {
  const passId = firstOfType('pass');
  const defId = firstScrimmageDefense();

  it('moves the offense and the defense without throwing', () => {
    const s = makeFullScenario({ offensePlayId: passId, defensePlayId: defId, seed: 21 });
    const start = s.play.players.map((p) => ({ x: p.pos2.x, y: p.pos2.y }));
    runTicks(s, 90);
    let moved = 0;
    for (let i = 0; i < 22; i++) {
      const a = start[i]!;
      const b = s.play.players[i]!;
      if (Math.hypot(a.x - b.pos2.x, a.y - b.pos2.y) > 0.5) moved++;
    }
    expect(moved).toBeGreaterThan(16);
  });

  it('keeps everyone inside the field of play', () => {
    const s = makeFullScenario({ offensePlayId: passId, defensePlayId: defId, seed: 22 });
    runTicks(s, 150);
    for (const p of s.play.players) {
      expect(p.pos2.x).toBeGreaterThanOrEqual(-0.5);
      expect(p.pos2.x).toBeLessThanOrEqual(53.9);
      expect(p.pos2.y).toBeGreaterThanOrEqual(-0.5);
      expect(p.pos2.y).toBeLessThanOrEqual(120.5);
      expect(Number.isFinite(p.pos2.x)).toBe(true);
      expect(Number.isFinite(p.pos2.y)).toBe(true);
    }
  });

  it('runs the same way in both attack directions', () => {
    const up = makeFullScenario({ offensePlayId: passId, defensePlayId: defId, seed: 23, dir: 1 });
    const down = makeFullScenario({ offensePlayId: passId, defensePlayId: defId, seed: 23, dir: -1 });
    runTicks(up, 60);
    runTicks(down, 60);
    for (let i = 0; i < 22; i++) {
      const a = up.play.players[i]!;
      const b = down.play.players[i]!;
      // Mirrored frame: the same displacement, negated on both axes.
      // Half a yard of slack: atan2/sin/cos are not bit-symmetric, and the
      // brains have tick-quantised thresholds that amplify the last bits. A
      // real direction-dependent branch would show up as whole yards.
      expect(Math.abs((a.pos2.x - 26.6) + (b.pos2.x - 26.6))).toBeLessThan(0.5);
      expect(Math.abs((a.pos2.y - 60) + (b.pos2.y - 60))).toBeLessThan(0.5);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = makeFullScenario({ offensePlayId: passId, defensePlayId: defId, seed: 24 });
    const b = makeFullScenario({ offensePlayId: passId, defensePlayId: defId, seed: 24 });
    runTicks(a, 120, 99);
    runTicks(b, 120, 99);
    for (let i = 0; i < 22; i++) {
      expect(a.play.players[i]!.pos2.x).toBe(b.play.players[i]!.pos2.x);
      expect(a.play.players[i]!.pos2.y).toBe(b.play.players[i]!.pos2.y);
    }
  });

  it('skips the user-controlled player entirely', () => {
    const s = makeFullScenario({
      offensePlayId: passId, defensePlayId: defId, seed: 25, controlledIdx: 3,
    });
    const before = { ...s.play.players[3]!.pos2 };
    runTicks(s, 60);
    expect(s.play.players[3]!.pos2).toEqual(before);
  });
});

describe('updateLiveAI on a live run play', () => {
  it('hands the run game a carrier who attacks the line', () => {
    const runId = firstOfType('run');
    const s = makeFullScenario({
      offensePlayId: runId, defensePlayId: firstScrimmageDefense(), seed: 26,
    });
    // Simulate the exchange: the back has the ball just after the mesh.
    const carrier = s.play.players.findIndex((p) => p.assignment.kind === 'carry');
    expect(carrier).toBeGreaterThanOrEqual(0);
    runTicks(s, 20);
    s.play.ball.carrierIdx = carrier;
    s.play.ball.mode = 'held';
    s.play.players[carrier]!.hasBall = true;
    const startY = s.play.players[carrier]!.pos2.y;
    runTicks(s, 60);
    expect(s.play.players[carrier]!.pos2.y).toBeGreaterThan(startY);
  });
});

describe('updateLiveAI on special teams', () => {
  it('drives a kickoff unit without errors', () => {
    const koId = firstOfType('kickoff');
    const krUnit = allDefensivePlays().find((d) => d.assignments['KR'] !== undefined);
    expect(krUnit).toBeDefined();
    const s = makeFullScenario({
      offensePlayId: koId, defensePlayId: krUnit!.id, seed: 27, los: 45,
    });
    runTicks(s, 60);
    // The kicker asked the meter for its three presses.
    const kicker = s.play.players.find((p) => p.assignment.kind === 'kick');
    expect(kicker).toBeDefined();
    expect(kicker!.mind['stPresses']).toBeGreaterThanOrEqual(1);
  });
});
