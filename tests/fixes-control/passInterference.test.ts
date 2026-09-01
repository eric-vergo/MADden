// Pass interference. Before this, nothing in src ever built a 'dpi' or 'opi'
// flag: the spot-foul branch in projectPenalty, both PENALTY_LABEL entries and
// PENALTY.dpiClosingSpeedYdPerSec / opiOnPickContact were all unreachable.

import { describe, expect, it } from 'vitest';
import { playLivePhase } from '../../src/sim/phases/playLive';
import { maybePassInterference } from '../../src/sim/rules/penalties';
import type { SimEvent } from '../../src/sim/events';
import { ext } from '../../src/sim/rules/ext';
import { MIND_PLAY_BALL } from '../../src/sim/ai/coverage';
import { runHeadlessGame } from '../harness/headlessGame';
import { ScriptRng } from '../sim-core/helpers';
import { frame, pose } from './helpers';

/**
 * A pass in the air to a receiver 12 yards downfield, with `defenderIdx`
 * running into him at speed. `roll` scripts the penalties stream.
 */
function passInAir(roll: number) {
  const sc = pose({ offense: 0, ballOnY: 40 });
  const e = ext(sc.state);
  const dir = sc.state.attackDir[0];
  const target = 1;
  const rec = sc.play.players[target];
  if (rec === undefined) throw new Error('no receiver');
  rec.pos2 = { x: 20, y: sc.play.lineOfScrimmageY + 12 * dir };
  rec.vel = { x: 0, y: 0 };
  rec.anim = 'running';

  sc.play.ball.mode = 'pass';
  sc.play.ball.carrierIdx = null;
  sc.play.ball.targetIdx = target;
  // Still 15 yards short of the receiver: nobody is playing the ball yet.
  sc.play.ball.pos2 = { x: 20, y: rec.pos2.y - 15 * dir };
  sc.play.ball.z = 4;
  sc.play.ball.vel = { x: 0, y: 20 * dir };
  sc.play.ball.vz = 0;
  e.throwTick = sc.state.tick - 10;
  e.lastPasserIdx = 0;
  e.lastTargetIdx = target;
  sc.rng.penalties = new ScriptRng([roll]);
  return { ...sc, target, rec };
}

/** Put `idx` on top of the receiver, closing hard. */
function collide(sc: ReturnType<typeof passInAir>, idx: number, playBall: number): void {
  const d = sc.play.players[idx];
  if (d === undefined) throw new Error('no player');
  d.pos2 = { x: sc.rec.pos2.x + 0.6, y: sc.rec.pos2.y };
  d.vel = { x: -4, y: 0 };
  d.anim = 'running';
  d.mind[MIND_PLAY_BALL] = playBall;
}

/** One live tick, through the phase handler that has to call the check. */
function tickOnce(sc: ReturnType<typeof passInAir>): SimEvent[] {
  const events: SimEvent[] = [];
  playLivePhase(sc.state, { frame: frame(), commands: [] }, sc.rng, events);
  return events;
}

/**
 * The check on its own. Used where the posed coverage `mind` matters: the AI
 * runs first inside playLivePhase and rewrites those keys every tick.
 */
function judgeOnce(sc: ReturnType<typeof passInAir>): SimEvent[] {
  const events: SimEvent[] = [];
  maybePassInterference(sc.state, sc.play, sc.rng.penalties, events);
  return events;
}

describe('defensive pass interference', () => {
  it('flags a defender who is not playing the ball for running through the receiver', () => {
    const sc = passInAir(0.0);
    collide(sc, 15, 0);
    const events = tickOnce(sc);
    const flag = events.find((ev) => ev.type === 'FLAG');
    expect(flag).toBeDefined();
    expect(flag?.type === 'FLAG' ? flag.flag.kind : null).toBe('dpi');
    expect(sc.play.flags[0]?.team).toBe(1);
    // Spot foul: the flag carries the receiver's spot, not the line.
    expect(sc.play.flags[0]?.spotY).toBeCloseTo(sc.rec.pos2.y, 3);
  });

  it('leaves a defender who is playing the ball alone', () => {
    const sc = passInAir(0.0);
    collide(sc, 15, 1);
    expect(judgeOnce(sc).some((ev) => ev.type === 'FLAG')).toBe(false);
    expect(sc.play.flags.length).toBe(0);
  });

  it('does not flag every collision — the roll has to come in', () => {
    const sc = passInAir(0.99);
    collide(sc, 15, 0);
    expect(judgeOnce(sc).some((ev) => ev.type === 'FLAG')).toBe(false);
    // And the play does not keep rolling for the same contact.
    expect(ext(sc.state).piChecked).toBe(true);
  });

  it('never adds a second flag to a play that already has one', () => {
    const sc = passInAir(0.0);
    sc.play.flags.push({
      kind: 'holding', team: 0, playerIdx: 5, spotY: sc.state.ballOnY, preSnap: false,
    });
    collide(sc, 15, 0);
    judgeOnce(sc);
    expect(sc.play.flags.length).toBe(1);
    expect(sc.play.flags[0]?.kind).toBe('holding');
  });
});

describe('offensive pass interference', () => {
  it('flags a receiver who picks a defender before the ball arrives', () => {
    const sc = passInAir(0.0);
    // A second receiver runs a pick into a defender, 12 yards downfield.
    const picker = 2;
    const victim = 15;
    const p = sc.play.players[picker];
    const v = sc.play.players[victim];
    if (p === undefined || v === undefined) throw new Error('missing players');
    const dir = sc.state.attackDir[0];
    // The man covering the target is the one being rubbed off.
    v.pos2 = { x: sc.rec.pos2.x + 3, y: sc.play.lineOfScrimmageY + 12 * dir };
    v.vel = { x: 0, y: 0 };
    v.anim = 'running';
    v.mind[MIND_PLAY_BALL] = 0;
    p.pos2 = { x: v.pos2.x - 0.6, y: v.pos2.y };
    p.vel = { x: 4, y: 0 };
    p.anim = 'running';

    const events = judgeOnce(sc);
    const flag = events.find((ev) => ev.type === 'FLAG');
    expect(flag?.type === 'FLAG' ? flag.flag.kind : null).toBe('opi');
    expect(sc.play.flags[0]?.team).toBe(0);
  });
});

describe('pass interference frequency', () => {
  it('stays rare across full games', () => {
    let pi = 0;
    let total = 0;
    const games = 3;
    for (let seed = 1; seed <= games; seed++) {
      const res = runHeadlessGame({ seed });
      for (const ev of res.events) {
        if (ev.type !== 'FLAG') continue;
        total += 1;
        if (ev.flag.kind === 'dpi' || ev.flag.kind === 'opi') pi += 1;
      }
    }
    // The design's band is 2-8 flags a game with PI "well under one".
    expect(pi / games).toBeLessThan(1);
    expect(total / games).toBeLessThanOrEqual(8);
  });
});
