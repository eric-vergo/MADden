// PLAY_LIVE user input: kick-meter aim direction, aim-vs-movement separation,
// and control switching while the controlled player is on the ground.

import { describe, expect, it } from 'vitest';
import { GameAction } from '../../src/sim/types';
import type { Dir } from '../../src/sim/transform';
import type { TickInput } from '../../src/sim/events';
import { playLivePhase } from '../../src/sim/phases/playLive';
import { ext } from '../../src/sim/rules/ext';
import { KICK } from '../../src/data/balance';
import { frame, indexOfRole, pose } from './helpers';

/** Arm a manual (user-worked) kickoff meter with the kicker under control. */
function armUserKickoff(flipEnds: boolean) {
  const sc = pose({
    offense: 0,
    ballOnY: flipEnds ? 75 : 45,
    offensePlayId: 'kickoff-deep',
    defensePlayId: 'st-kick-return-unit',
    config: { userTeam: 0 },
    flipEnds,
  });
  const kicker = indexOfRole(sc.play, 'K');
  expect(kicker).toBeGreaterThanOrEqual(0);
  sc.play.controlledIdx = kicker;
  const k = sc.play.players[kicker];
  if (k === undefined) throw new Error('no kicker');
  k.hasBall = true;
  sc.play.ball.carrierIdx = kicker;
  sc.play.ball.mode = 'held';
  sc.play.ball.pos2 = { x: k.pos2.x, y: k.pos2.y };
  ext(sc.state).kick = {
    style: 'kickoff', kickerIdx: kicker,
    pressTicks: [sc.state.tick, sc.state.tick, sc.state.tick],
    pressesDone: 0, launched: false, spotY: k.pos2.y, fgDistance: 0, auto: false,
  };
  sc.play.kickMeter.active = true;
  sc.play.kickMeter.startTick = -1;
  return { ...sc, kicker };
}

/** Hold Right the way GameSession delivers it (move is camera-space, flipped). */
function rightInput(dir: Dir, press: boolean): TickInput {
  const held = new Set([GameAction.Right]);
  const pressed = press ? new Set([GameAction.MeterPress]) : new Set<GameAction>();
  return {
    frame: frame({ held, pressed, move: { x: dir === 1 ? 1 : -1, y: 0 } }),
    commands: [],
  };
}

function workMeter(sc: ReturnType<typeof armUserKickoff>, aimTicks: number): void {
  const dir = sc.state.attackDir[0];
  // press 1 starts the meter; press 2 locks power; press 3 lands on the sweep
  // midpoint so the accuracy error is ~0 and only the manual aim bends the
  // kick. Right is held throughout.
  playLivePhase(sc.state, rightInput(dir, true), sc.rng, []);
  for (let i = 0; i < aimTicks; i++) {
    sc.state.tick += 1;
    playLivePhase(sc.state, rightInput(dir, false), sc.rng, []);
  }
  sc.state.tick += 1;
  playLivePhase(sc.state, rightInput(dir, true), sc.rng, []);
  for (let i = 0; i < Math.round(KICK.meterSweepTicks / 2); i++) {
    sc.state.tick += 1;
    playLivePhase(sc.state, rightInput(dir, false), sc.rng, []);
  }
  playLivePhase(sc.state, rightInput(dir, true), sc.rng, []);
  sc.state.tick += 1;
  playLivePhase(sc.state, rightInput(dir, false), sc.rng, []);
}

describe('kick meter aim', () => {
  for (const flipEnds of [false, true]) {
    it(`sends the ball screen-right when Right is held (attackDir ${flipEnds ? '-1' : '+1'})`, () => {
      const sc = armUserKickoff(flipEnds);
      const dir = sc.state.attackDir[0];
      expect(dir).toBe(flipEnds ? -1 : 1);
      workMeter(sc, 40);

      expect(ext(sc.state).kick?.launched).toBe(true);
      expect(sc.play.kickMeter.aimOffset).toBeGreaterThan(0);
      // The camera's x axis flips with the viewer's attack direction, so
      // "screen right" is world +x when dir=+1 and world -x when dir=-1.
      expect(sc.play.ball.vel.x * dir).toBeGreaterThan(0);
    });
  }

  it('does not walk the kicker sideways while he aims', () => {
    const sc = armUserKickoff(false);
    const k = sc.play.players[sc.kicker];
    if (k === undefined) throw new Error('no kicker');
    const x0 = k.pos2.x;
    const dir = sc.state.attackDir[0];
    playLivePhase(sc.state, rightInput(dir, true), sc.rng, []);
    for (let i = 0; i < 60; i++) {
      sc.state.tick += 1;
      playLivePhase(sc.state, rightInput(dir, false), sc.rng, []);
    }
    expect(sc.play.kickMeter.aimOffset).toBeGreaterThan(KICK.aimMaxOffsetRad * 0.8);
    expect(Math.abs(k.pos2.x - x0)).toBeLessThan(0.05);
  });
});

describe('control switching', () => {
  it('applies SWITCH_CONTROLLED even while the controlled defender is pancaked', () => {
    const sc = pose({ offense: 1, config: { userTeam: 0 } });
    const mine = 16;
    const other = 12;
    sc.play.controlledIdx = mine;
    const me = sc.play.players[mine];
    if (me === undefined) throw new Error('no defender');
    // Exactly what a lost block contest does to him.
    me.anim = 'down';
    me.stateTimer = 90;
    me.mind['aiTimer'] = 1;

    playLivePhase(sc.state, {
      frame: frame({ pressed: new Set([GameAction.SwitchPlayer]) }),
      commands: [{ type: 'SWITCH_CONTROLLED', playerIdx: other }],
    }, sc.rng, []);

    expect(sc.play.controlledIdx).toBe(other);
  });
});
