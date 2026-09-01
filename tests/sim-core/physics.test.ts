// Micro-sim suites: kick meter math, ball flight bands, catch contest matrix,
// tackle resolution, forward progress.

import { describe, expect, it } from 'vitest';
import {
  accuracy01, accuracyErrorAt, aimErrorRad, forceExpiry, meterStage, powerAt,
  press, tickForAccuracy, tickForPower,
} from '../../src/sim/rules/kickMeter';
import {
  bulletLaunch, bulletSpeed, kickLaunch, lobLaunch, lobTime, predict, stepBall, timeToHeight,
} from '../../src/sim/physics/ballFlight';
import { closingSpeed, isFromBehind, isOutOfBoundsX, separateTeammates } from '../../src/sim/physics/collisions';
import { attemptTackle, throwPass, throwSigma } from '../../src/sim/actions';
import type { Ball, KickMeterState } from '../../src/sim/types';
import type { SimEvent } from '../../src/sim/events';
import { GRAVITY } from '../../src/sim/constants';
import { KICK } from '../../src/data/balance';
import { playLivePhase } from '../../src/sim/phases/playLive';
import { emptyTickInput } from '../../src/sim/events';
import { ext } from '../../src/sim/rules/ext';
import { giveBall, makeScenario, place, ScriptRng } from './helpers';

function freshMeter(): KickMeterState {
  return { active: true, startTick: -1, powerLockTick: null, accuracyLockTick: null, aimOffset: 0 };
}

describe('kick meter is a pure function of ticks', () => {
  it('walks idle -> filling -> sweeping -> locked', () => {
    const km = freshMeter();
    expect(meterStage(km)).toBe('idle');
    expect(press(km, 100)).toBe('filling');
    expect(press(km, 125)).toBe('sweeping');
    expect(press(km, 150)).toBe('locked');
    expect(press(km, 160)).toBe('locked');
  });

  it('power is the fraction of the fill window that elapsed', () => {
    const km = freshMeter();
    press(km, 0);
    expect(powerAt(km, 0)).toBeCloseTo(0);
    expect(powerAt(km, KICK.meterFillTicks / 2)).toBeCloseTo(0.5);
    expect(powerAt(km, KICK.meterFillTicks * 3)).toBeCloseTo(1);
    press(km, KICK.meterFillTicks * 0.4);
    expect(powerAt(km, 9999)).toBeCloseTo(0.4);
  });

  it('accuracy is signed around the sweep midpoint', () => {
    const km = freshMeter();
    press(km, 0);
    press(km, 10);
    expect(accuracyErrorAt(km, 10 + KICK.meterSweepTicks / 2)).toBeCloseTo(0);
    expect(accuracyErrorAt(km, 10)).toBeCloseTo(-1);
    expect(accuracyErrorAt(km, 10 + KICK.meterSweepTicks)).toBeCloseTo(1);
    expect(accuracy01(0)).toBe(1);
    expect(accuracy01(-0.5)).toBeCloseTo(0.5);
    expect(accuracy01(1)).toBe(0);
  });

  it('inverse helpers land exactly on the requested reading', () => {
    const km = freshMeter();
    const start = 500;
    press(km, start);
    const pt = tickForPower(start, 0.72);
    press(km, pt);
    expect(powerAt(km, pt)).toBeCloseTo(0.72, 2);
    const at = tickForAccuracy(pt, 0);
    press(km, at);
    expect(accuracyErrorAt(km, at)).toBeCloseTo(0, 6);
  });

  it('angular error grows with the miss and folds in manual aim', () => {
    expect(aimErrorRad(0, 0)).toBe(0);
    expect(aimErrorRad(1, 0)).toBeCloseTo(KICK.aimMaxOffsetRad);
    expect(aimErrorRad(-1, 0)).toBeCloseTo(-KICK.aimMaxOffsetRad);
    expect(aimErrorRad(0, 0.1)).toBeCloseTo(0.1);
  });

  it('an unpressed meter still expires into a legal (bad) kick', () => {
    const km = freshMeter();
    press(km, 0);
    forceExpiry(km, KICK.meterFillTicks + KICK.meterSweepTicks + 5);
    forceExpiry(km, KICK.meterFillTicks + KICK.meterSweepTicks + 5);
    expect(km.powerLockTick).not.toBeNull();
    expect(km.accuracyLockTick).not.toBeNull();
    expect(accuracy01(accuracyErrorAt(km, 9999))).toBeCloseTo(0);
  });
});

describe('ball flight', () => {
  const from = { x: 26, y: 50 };

  it('bullet speed scales with throw power', () => {
    expect(bulletSpeed(40)).toBeLessThan(bulletSpeed(99));
    expect(bulletSpeed(99)).toBeCloseTo(26, 0);
  });

  it('a bullet gets there faster than a lob at the same distance', () => {
    const to = { x: 26, y: 70 };
    const b = bulletLaunch(from, to, 1.9, 90);
    const l = lobLaunch(from, to, 1.9, 90);
    expect(b.timeSec).toBeLessThan(l.timeSec);
    expect(l.timeSec).toBeCloseTo(lobTime(20), 3);
  });

  it('flight lands on the aim point for both styles and both arms', () => {
    for (const thp of [55, 99]) {
      for (const dist of [8, 22, 40]) {
        for (const bullet of [true, false]) {
          const to = { x: 26, y: 50 + dist };
          const l = bullet
            ? bulletLaunch(from, to, 1.9, thp)
            : lobLaunch(from, to, 1.9, thp);
          const at = predict(
            { pos2: { ...from }, z: 1.9, vel: l.vel, vz: l.vz, mode: 'pass', carrierIdx: null, targetIdx: null, lastTouchTeam: 0 },
            l.timeSec,
          );
          expect(at.y).toBeCloseTo(to.y, 4);
          expect(at.z).toBeCloseTo(1.5, 4);
        }
      }
    }
  });

  it('a lob arcs meaningfully higher than a bullet', () => {
    const to = { x: 26, y: 78 };
    const b = bulletLaunch(from, to, 1.9, 85);
    const l = lobLaunch(from, to, 1.9, 85);
    const apex = (v: number): number => (v * v) / (2 * GRAVITY);
    expect(apex(l.vz)).toBeGreaterThan(apex(b.vz));
    expect(apex(l.vz)).toBeGreaterThan(3.5);
  });

  it('kick launches hit their carry distance and hang time', () => {
    const l = kickLaunch(58, 4.1, Math.PI / 2, 0.3);
    const ball: Ball = {
      pos2: { x: 26, y: 45 }, z: 0.3, vel: l.vel, vz: l.vz,
      mode: 'kick', carrierIdx: null, targetIdx: null, lastTouchTeam: 0,
    };
    const t = timeToHeight(ball, 0);
    expect(t).not.toBeNull();
    expect(t as number).toBeCloseTo(4.1, 1);
    const at = predict(ball, 4.1);
    expect(at.y - 45).toBeCloseTo(58, 1);
  });

  it('a live kick bounces and settles; a pass just dies', () => {
    const kick: Ball = {
      pos2: { x: 26, y: 50 }, z: 0.05, vel: { x: 0, y: 8 }, vz: -6,
      mode: 'kick', carrierIdx: null, targetIdx: null, lastTouchTeam: 0,
    };
    let settled = false;
    for (let i = 0; i < 60 * 12 && !settled; i++) {
      settled = stepBall(kick, true).atRest;
    }
    expect(settled).toBe(true);
    expect(kick.z).toBe(0);

    const pass: Ball = {
      pos2: { x: 26, y: 50 }, z: 0.05, vel: { x: 0, y: 10 }, vz: -6,
      mode: 'pass', carrierIdx: null, targetIdx: null, lastTouchTeam: 0,
    };
    const r = stepBall(pass, false);
    expect(r.landed).toBe(true);
    expect(r.atRest).toBe(true);
  });

  it('longer throws and pressure widen the accuracy cone', () => {
    const sc = makeScenario();
    const qb = sc.play.players[0];
    expect(qb).toBeDefined();
    if (qb === undefined) return;
    const near = throwSigma(qb, 5, 0, true);
    const far = throwSigma(qb, 40, 0, true);
    const pressed = throwSigma(qb, 5, 1, true);
    const lobbed = throwSigma(qb, 5, 0, false);
    expect(far).toBeGreaterThan(near);
    expect(pressed).toBeGreaterThan(near);
    expect(lobbed).toBeGreaterThan(near);
  });
});

describe('collisions and boundaries', () => {
  it('flags the sideline with a small margin', () => {
    expect(isOutOfBoundsX(0.1)).toBe(true);
    expect(isOutOfBoundsX(53.2)).toBe(true);
    expect(isOutOfBoundsX(26)).toBe(false);
  });

  it('pushes overlapping teammates apart without moving opponents', () => {
    const sc = makeScenario();
    place(sc, 6, 26, 50);
    place(sc, 7, 26.1, 50);
    place(sc, 11, 26.05, 50.2);
    const before = { ...(sc.play.players[11] as { pos2: { x: number; y: number } }).pos2 };
    separateTeammates(sc.play);
    const a = sc.play.players[6];
    const b = sc.play.players[7];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    expect(Math.hypot(a.pos2.x - b.pos2.x, a.pos2.y - b.pos2.y)).toBeGreaterThan(0.1);
    expect((sc.play.players[11] as { pos2: { x: number; y: number } }).pos2).toEqual(before);
  });

  it('detects pursuit from behind and closing speed', () => {
    const sc = makeScenario();
    place(sc, 0, 26, 50, Math.PI / 2);
    const carrier = sc.play.players[0];
    const chaser = sc.play.players[11];
    expect(carrier).toBeDefined();
    expect(chaser).toBeDefined();
    if (carrier === undefined || chaser === undefined) return;
    chaser.pos2 = { x: 26, y: 49 };
    expect(isFromBehind(chaser, carrier)).toBe(true);
    chaser.vel = { x: 0, y: 5 };
    carrier.vel = { x: 0, y: 2 };
    expect(closingSpeed(chaser, carrier)).toBeCloseTo(3);
  });
});

describe('catch contest matrix', () => {
  function setupPass(gaussians: number[], uniforms: number[]): {
    sc: ReturnType<typeof makeScenario>; events: SimEvent[];
  } {
    const sc = makeScenario({ ballOnY: 50 });
    giveBall(sc, 0);
    place(sc, 0, 26, 45);
    place(sc, 4, 26, 62);
    const events: SimEvent[] = [];
    const rng = new ScriptRng(uniforms, gaussians);
    throwPass(sc.state, 0, 4, { bullet: true }, rng, events);
    return { sc, events };
  }

  it('a thrown ball is airborne, aimed at the receiver, and logged', () => {
    const { sc, events } = setupPass([0], [0.5]);
    expect(sc.play.ball.mode).toBe('pass');
    expect(sc.play.ball.targetIdx).toBe(4);
    const thrown = events.find((e) => e.type === 'PASS_THROWN');
    expect(thrown).toBeDefined();
    const e = ext(sc.state);
    expect(e.passLanding.y).toBeCloseTo(62, 0);
    expect(e.lastPasserIdx).toBe(0);
  });

  it('the passer can never catch his own pass', () => {
    const { sc } = setupPass([0], [0.5]);
    // Ball is still right on top of the quarterback the tick after release.
    expect(sc.play.ball.carrierIdx).toBeNull();
    expect((sc.play.players[0] as { hasBall: boolean }).hasBall).toBe(false);
  });

  it('a wide-open receiver catches on a low roll and drops on a high one', () => {
    for (const [roll, expectCatch] of [[0.01, true], [0.99, false]] as const) {
      const sc = makeScenario({ ballOnY: 50 });
      place(sc, 4, 26, 62);
      // Park the ball on the receiver and step the resolution through the sim.
      sc.play.ball.mode = 'pass';
      sc.play.ball.pos2 = { x: 26, y: 62 };
      sc.play.ball.z = 1.6;
      sc.play.ball.vel = { x: 0, y: 0 };
      sc.play.ball.vz = 0;
      sc.play.ball.targetIdx = 4;
      const e = ext(sc.state);
      e.lastPasserIdx = 0;
      e.lastTargetIdx = 4;
      e.throwTick = -100;
      const rng = new ScriptRng([roll], [0]);
      // Reach into the live-play resolver through one tick of PLAY_LIVE.
      const events: SimEvent[] = [];
      const rngSet = { physics: rng, ai: rng, penalties: rng, misc: rng };
      playLivePhase(sc.state, emptyTickInput(), rngSet, events);
      const caught = events.some((ev) => ev.type === 'CATCH');
      const dropped = events.some((ev) => ev.type === 'DROP');
      expect(caught).toBe(expectCatch);
      expect(dropped).toBe(!expectCatch);
    }
  });
});

describe('tackle resolution', () => {
  function tackleScenario(gaussians: number[]): {
    sc: ReturnType<typeof makeScenario>; events: SimEvent[]; rng: ScriptRng;
  } {
    const sc = makeScenario({ ballOnY: 50 });
    giveBall(sc, 1);
    place(sc, 1, 26, 56, Math.PI / 2);
    const carrier = sc.play.players[1];
    const tackler = sc.play.players[11];
    if (carrier !== undefined) carrier.vel = { x: 0, y: 4 };
    if (tackler !== undefined) {
      tackler.pos2 = { x: 26, y: 56.9 };
      tackler.vel = { x: 0, y: -4 };
      tackler.facing = -Math.PI / 2;
      tackler.stateTimer = 0;
    }
    return { sc, events: [], rng: new ScriptRng([0.99], gaussians) };
  }

  it('a dominant tackler produces a big hit that ends the play', () => {
    const { sc, events, rng } = tackleScenario([3, -3]);
    const carrier = sc.play.players[1];
    const tackler = sc.play.players[11];
    if (carrier === undefined || tackler === undefined) return;
    tackler.ratings.tak = 99;
    tackler.ratings.hpw = 99;
    carrier.ratings.btk = 40;
    carrier.ratings.str = 40;
    attemptTackle(sc.state, 11, {}, rng, events);
    expect(events.some((e) => e.type === 'TACKLE_ATTEMPT')).toBe(true);
    const tackle = events.find((e) => e.type === 'TACKLE');
    expect(tackle).toBeDefined();
    if (tackle !== undefined && tackle.type === 'TACKLE') expect(tackle.bigHit).toBe(true);
    expect(sc.play.deadReason).toBe('tackle');
  });

  it('a dominant carrier breaks it and the tackler stumbles', () => {
    const { sc, events, rng } = tackleScenario([-3, 3]);
    const carrier = sc.play.players[1];
    const tackler = sc.play.players[11];
    if (carrier === undefined || tackler === undefined) return;
    tackler.ratings.tak = 40;
    tackler.ratings.hpw = 40;
    carrier.ratings.btk = 99;
    carrier.ratings.str = 99;
    attemptTackle(sc.state, 11, {}, rng, events);
    expect(events.some((e) => e.type === 'TACKLE_BROKEN')).toBe(true);
    expect(sc.play.deadReason).toBeNull();
    expect(tackler.stateTimer).toBeGreaterThan(0);
  });

  it('out of range is a no-op (and a hit stick whiffs)', () => {
    const { sc, events, rng } = tackleScenario([0]);
    const tackler = sc.play.players[11];
    if (tackler === undefined) return;
    tackler.pos2 = { x: 26, y: 62 };
    attemptTackle(sc.state, 11, { hitStick: true }, rng, events);
    expect(events.length).toBe(0);
    expect(tackler.stateTimer).toBeGreaterThan(0);
    expect(sc.play.deadReason).toBeNull();
  });

  it('a fumble on a big hit leaves the ball live', () => {
    const { sc, events } = tackleScenario([3, -3]);
    // First uniform draw is the fumble roll: force it to fire.
    const rng = new ScriptRng([0.0], [3, -3]);
    attemptTackle(sc.state, 11, { hitStick: true }, rng, events);
    expect(events.some((e) => e.type === 'FUMBLE')).toBe(true);
    expect(sc.play.ball.mode).toBe('loose');
    expect(sc.play.ball.carrierIdx).toBeNull();
    expect(sc.play.deadReason).toBeNull();
  });
});
