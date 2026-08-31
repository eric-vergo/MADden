import { describe, expect, it } from 'vitest';

import { AudioDirector } from '../../src/audio/AudioDirector';
import type { SimEvent } from '../../src/sim/events';
import { GamePhase, type GameState, type PenaltyFlag, type TeamSide } from '../../src/sim/types';
import { makeState } from './gameStateFixture';
import { SpyAudioEngine } from './spyEngine';

function rig(over: Partial<GameState> = {}): {
  spy: SpyAudioEngine;
  director: AudioDirector;
  state: GameState;
  fire: (...events: SimEvent[]) => void;
} {
  const spy = new SpyAudioEngine();
  const director = new AudioDirector(spy);
  const state = makeState(over);
  return {
    spy,
    director,
    state,
    fire: (...events: SimEvent[]) => director.handle(events, state),
  };
}

function flag(team: TeamSide): PenaltyFlag {
  return { kind: 'holding', team, playerIdx: 3, spotY: 55, preSnap: false };
}

// The fixture's user team is 0 (home) and home has possession, so the defense
// on any given snap is the away team unless a spec overrides possession.

describe('AudioDirector — event → sfx mapping', () => {
  it('plays the whistle on WHISTLE', () => {
    const { spy, fire } = rig();
    fire({ type: 'WHISTLE', tick: 10, reason: 'tackle' });
    expect(spy.names()).toEqual(['whistle']);
  });

  it('plays throw / catch for the passing game, pitching bullets up', () => {
    const { spy, fire } = rig();
    fire(
      { type: 'PASS_THROWN', tick: 5, passerIdx: 0, targetIdx: 3, bullet: true, airYds: 14 },
      { type: 'CATCH', tick: 25, receiverIdx: 3, contested: false },
    );
    expect(spy.names()).toEqual(['throw', 'catch']);
    expect(spy.plays[0]?.pitch).toBeGreaterThan(1);
  });

  it('uses hitLight for a routine tackle and hitBig plus a crowd spike for a bigHit', () => {
    const light = rig();
    light.fire({ type: 'TACKLE', tick: 30, tacklerIdx: 14, carrierIdx: 2, bigHit: false, assistIdx: null });
    expect(light.spy.names()).toEqual(['hitLight']);

    // User (home) has the ball, so the away defense laying a big hit draws a groan.
    const big = rig();
    big.fire({ type: 'TACKLE', tick: 30, tacklerIdx: 14, carrierIdx: 2, bigHit: true, assistIdx: null });
    expect(big.spy.names()).toEqual(['hitBig', 'crowdGroan']);

    // Same hit with the user on defense cheers instead.
    const forUs = rig({ possession: 1 });
    forUs.fire({ type: 'TACKLE', tick: 30, tacklerIdx: 14, carrierIdx: 2, bigHit: true, assistIdx: null });
    expect(forUs.spy.names()).toEqual(['hitBig', 'crowdCheer']);
  });

  it('does not stack two impacts when TACKLE and SACK arrive in one batch', () => {
    const { spy, fire } = rig();
    fire(
      { type: 'TACKLE', tick: 40, tacklerIdx: 15, carrierIdx: 0, bigHit: true, assistIdx: null },
      { type: 'SACK', tick: 40, tacklerIdx: 15, qbIdx: 0, yards: -7 },
    );
    expect(spy.countOf('hitBig')).toBe(1);
    expect(spy.countOf('hitLight')).toBe(0);
  });

  it('stings turnovers and reacts for the team taking the ball away', () => {
    const int = rig();
    int.fire({ type: 'INTERCEPTION', tick: 50, defenderIdx: 17 });
    expect(int.spy.names()).toEqual(['turnoverSting', 'crowdGroan']);

    const fum = rig({ possession: 1 });
    fum.fire({ type: 'FUMBLE', tick: 51, carrierIdx: 2, forcedByIdx: 16 });
    expect(fum.spy.names()).toEqual(['turnoverSting', 'crowdCheer']);
  });

  it('fires the fanfare on a touchdown and picks the crowd reaction by side', () => {
    const ours = rig();
    ours.fire({ type: 'TOUCHDOWN', tick: 60, team: 0, scorerIdx: 4 });
    expect(ours.spy.names()).toEqual(['touchdownFanfare', 'crowdCheer']);

    const theirs = rig();
    theirs.fire({ type: 'TOUCHDOWN', tick: 60, team: 1, scorerIdx: 4 });
    expect(theirs.spy.names()).toEqual(['touchdownFanfare', 'crowdGroan']);
  });

  it('plays fgGood only when the kick is good', () => {
    const good = rig();
    good.fire({ type: 'FIELD_GOAL_RESULT', tick: 70, team: 0, good: true, distanceYds: 41, missSide: null });
    expect(good.spy.names()).toEqual(['fgGood', 'crowdCheer']);

    const miss = rig();
    miss.fire({ type: 'FIELD_GOAL_RESULT', tick: 70, team: 0, good: false, distanceYds: 52, missSide: 'left' });
    expect(miss.spy.played('fgGood')).toBe(false);
    expect(miss.spy.names()).toEqual(['crowdGroan']);
  });

  it('maps the remaining scoreboard events', () => {
    const { spy, fire } = rig();
    fire(
      { type: 'FIRST_DOWN', tick: 80, team: 0 },
      { type: 'FLAG', tick: 81, flag: flag(1) },
      { type: 'TIMEOUT', tick: 82, team: 0, remaining: 2 },
      { type: 'TWO_MINUTE_WARNING', tick: 83, half: 2 },
    );
    expect(spy.names()).toEqual([
      'firstDownChime', 'crowdCheer', // moved the chains
      'flag', 'crowdCheer', // penalty on the away team
      'timeoutHorn',
      'clockWarning',
    ]);
  });

  it('distinguishes punts from placekicks and kickoffs', () => {
    const punt = rig();
    punt.fire({ type: 'KICK_LAUNCHED', tick: 90, style: 'punt', kickerIdx: 10, power01: 0.8, accuracy01: 0.6 });
    expect(punt.spy.names()).toEqual(['puntThump']);

    const kickoff = rig();
    kickoff.fire({ type: 'KICK_LAUNCHED', tick: 90, style: 'kickoff', kickerIdx: 10, power01: 1, accuracy01: 0.9 });
    expect(kickoff.spy.names()).toEqual(['kickThump']);

    const fg = rig();
    fg.fire({ type: 'KICK_LAUNCHED', tick: 90, style: 'placekick', kickerIdx: 10, power01: 0.9, accuracy01: 0.8 });
    expect(fg.spy.names()).toEqual(['kickThump']);
  });

  it('never emits menu sfx from sim events', () => {
    const { spy, fire } = rig();
    fire(
      { type: 'SNAP', tick: 1 },
      { type: 'HANDOFF', tick: 20, carrierIdx: 2 },
      { type: 'PHASE_CHANGE', tick: 21, from: GamePhase.PRE_SNAP, to: GamePhase.PLAY_LIVE },
      { type: 'CONTROL_CHANGED', tick: 22, controlledIdx: 3 },
      { type: 'TACKLE', tick: 60, tacklerIdx: 14, carrierIdx: 2, bigHit: false, assistIdx: null },
      { type: 'WHISTLE', tick: 61, reason: 'tackle' },
    );
    for (const name of spy.names()) {
      expect(name.startsWith('menu')).toBe(false);
    }
  });

  it('ignores events it has no recipe for', () => {
    const { spy, fire } = rig();
    fire(
      { type: 'PLAYS_SELECTED', tick: 1, offensePlayId: 'a', defensePlayId: 'b' },
      { type: 'QUARTER_END', tick: 2, quarter: 1 },
      { type: 'HALFTIME', tick: 3 },
    );
    expect(spy.plays).toEqual([]);
    expect(spy.intensities).toHaveLength(1); // still pushes ambience
  });
});

describe('AudioDirector — crowd intensity', () => {
  it('pushes exactly one intensity per handle() call', () => {
    const { spy, director, state } = rig();
    director.handle([], state);
    director.handle([], state);
    director.handle([{ type: 'WHISTLE', tick: 3, reason: 'tackle' }], state);
    expect(spy.intensities).toHaveLength(3);
  });

  it('sits at the quiet base in a neutral situation', () => {
    const { spy, fire } = rig();
    fire();
    expect(spy.lastIntensity()).toBeCloseTo(0.25, 6);
  });

  it('lifts in the red zone', () => {
    const { spy, fire } = rig({ ballOnY: 95 }); // home attacking +y, 15 to go
    fire();
    expect(spy.lastIntensity()).toBeGreaterThan(0.25);

    const away = rig({ possession: 1, ballOnY: 25 }); // away attacking -y, 15 to go
    away.fire();
    expect(away.spy.lastIntensity()).toBeGreaterThan(0.25);
  });

  it('lifts inside two minutes of a half', () => {
    const quiet = rig({ quarter: 2, clockSec: 400 });
    quiet.fire();
    const loud = rig({ quarter: 2, clockSec: 90 });
    loud.fire();
    expect(loud.spy.lastIntensity()).toBeGreaterThan(quiet.spy.lastIntensity());
  });

  it('lifts for a close fourth quarter but not a blowout', () => {
    const close = rig({ quarter: 4, clockSec: 250, score: [17, 14] });
    close.fire();
    const blowout = rig({ quarter: 4, clockSec: 250, score: [38, 3] });
    blowout.fire();
    expect(close.spy.lastIntensity()).toBeGreaterThan(blowout.spy.lastIntensity());
    expect(blowout.spy.lastIntensity()).toBeCloseTo(0.25, 6);
  });

  it('stacks situational boosts', () => {
    const one = rig({ quarter: 4, clockSec: 100, score: [21, 20] });
    one.fire();
    const all = rig({ quarter: 4, clockSec: 100, score: [21, 20], ballOnY: 98 });
    all.fire();
    expect(all.spy.lastIntensity()).toBeGreaterThan(one.spy.lastIntensity());
  });

  it('spikes on a user touchdown then decays back toward the base', () => {
    const spy = new SpyAudioEngine();
    const director = new AudioDirector(spy);
    const state = makeState({ tick: 0 });

    director.handle([{ type: 'TOUCHDOWN', tick: 0, team: 0, scorerIdx: 4 }], state);
    const peak = spy.lastIntensity();
    expect(peak).toBeGreaterThan(0.7);

    const trail: number[] = [];
    for (let t = 60; t <= 780; t += 60) {
      director.handle([], makeState({ tick: t }));
      trail.push(spy.lastIntensity());
    }
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i]!).toBeLessThan(trail[i - 1]!);
    }
    expect(trail[0]!).toBeLessThan(peak);

    director.handle([], makeState({ tick: 1200 }));
    expect(spy.lastIntensity()).toBeCloseTo(0.25, 3);
  });

  it('deflates below the base when the other team scores', () => {
    const spy = new SpyAudioEngine();
    const director = new AudioDirector(spy);
    director.handle([{ type: 'TOUCHDOWN', tick: 0, team: 1, scorerIdx: 4 }], makeState({ tick: 0 }));
    expect(spy.lastIntensity()).toBeLessThan(0.25);
    expect(spy.played('crowdGroan')).toBe(true);
  });

  it('keeps intensity inside [0,1] under a pile of big plays', () => {
    const spy = new SpyAudioEngine();
    const director = new AudioDirector(spy);
    for (let i = 0; i < 20; i++) {
      director.handle(
        [
          { type: 'TOUCHDOWN', tick: i, team: 0, scorerIdx: 4 },
          { type: 'BIG_PLAY', tick: i, reason: 'touchdown' },
        ],
        makeState({ tick: i, quarter: 4, clockSec: 60, score: [21, 20], ballOnY: 105 }),
      );
    }
    for (const v of spy.intensities) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(spy.lastIntensity()).toBe(1);
  });

  it('treats the home stands as the crowd when there is no user team', () => {
    const spy = new SpyAudioEngine();
    const director = new AudioDirector(spy);
    const state = makeState({ config: { ...makeState().config, userTeam: null } });
    director.handle([{ type: 'TOUCHDOWN', tick: 0, team: 0, scorerIdx: 4 }], state);
    expect(spy.played('crowdCheer')).toBe(true);
  });

  it('reset() drops accumulated excitement', () => {
    const spy = new SpyAudioEngine();
    const director = new AudioDirector(spy);
    director.handle([{ type: 'TOUCHDOWN', tick: 0, team: 0, scorerIdx: 4 }], makeState({ tick: 0 }));
    director.reset();
    director.handle([], makeState({ tick: 1 }));
    expect(spy.lastIntensity()).toBeCloseTo(0.25, 6);
    expect(director.crowdIntensity).toBeCloseTo(0.25, 6);
  });
});
