// Own-impetus safety vs. touchback on kicks and change-of-possession plays.
//
// A returner/interceptor who takes possession in the FIELD OF PLAY supplies his
// own impetus: downed in his own end zone that is a SAFETY. Only a ball put in
// the end zone by the opponent's kick or pass, and taken there, is a touchback.

import { describe, expect, it } from 'vitest';
import { GamePhase } from '../../src/sim/types';
import { playLivePhase } from '../../src/sim/phases/playLive';
import { ext } from '../../src/sim/rules/ext';
import { ownGoalY, ownYardLineY } from '../../src/sim/transform';
import { frame, indexOfAssignment, pose } from './helpers';

const KICKOFF = 'kickoff-deep';
const KICK_RETURN = 'st-kick-return-unit';

/**
 * Kickoff by team 0 from its own 35; team 1 receives (attacks -y).
 * The human is the returner, so the special-teams brain never overrides his
 * field-it-or-kneel decision.
 */
function kickoffPose() {
  const sc = pose({
    offense: 0,
    ballOnY: ownYardLineY(35, 1),
    offensePlayId: KICKOFF,
    defensePlayId: KICK_RETURN,
    config: { userTeam: 1 },
  });
  const returner = indexOfAssignment(sc.play, 'returner');
  expect(returner).toBeGreaterThanOrEqual(11);
  sc.play.controlledIdx = returner;
  return { ...sc, returner };
}

/** Put a live kick in the air right on top of the returner and let him field it. */
function fieldKickAt(sc: ReturnType<typeof kickoffPose>, y: number): void {
  const r = sc.play.players[sc.returner];
  if (r === undefined) throw new Error('no returner');
  r.pos2 = { x: 26, y };
  sc.play.ball.mode = 'kick';
  sc.play.ball.carrierIdx = null;
  sc.play.ball.pos2 = { x: 26, y };
  sc.play.ball.z = 0.6;
  sc.play.ball.vel = { x: 0, y: 0 };
  sc.play.ball.vz = -1;
  ext(sc.state).kick = {
    style: 'kickoff', kickerIdx: 0, pressTicks: [0, 0, 0], pressesDone: 3,
    launched: true, spotY: sc.state.ballOnY, fgDistance: 0, auto: true,
  };
  ext(sc.state).kickUntouched = true;
  playLivePhase(sc.state, { frame: frame(), commands: [] }, sc.rng, []);
}

describe('own-impetus end-zone rulings', () => {
  it('rules a SAFETY when a kick returner fields it in the field of play and is downed in his own end zone', () => {
    const sc = kickoffPose();
    const recvDir = sc.state.attackDir[1];
    // Fielded at his own 4 — in the field of play.
    fieldKickAt(sc, ownYardLineY(4, recvDir));
    expect(sc.play.ball.carrierIdx).toBe(sc.returner);

    // Driven back and downed 9 yards deep in his own end zone.
    const r = sc.play.players[sc.returner];
    if (r === undefined) throw new Error('no returner');
    r.pos2 = { x: 26, y: ownGoalY(recvDir) - 9 * recvDir };
    r.anim = 'down';
    // The forward-progress window has long since aged out of the catch spot.
    ext(sc.state).progress = [];
    ext(sc.state).progressCount = 0;
    sc.play.deadReason = 'tackle';
    playLivePhase(sc.state, { frame: frame(), commands: [] }, sc.rng, []);

    const o = ext(sc.state).outcome;
    expect(o).not.toBeNull();
    expect(o?.safety).toBe(true);
    expect(o?.scoreKind).toBe('safety');
    expect(o?.points).toBe(2);
    expect(sc.state.phase).toBe(GamePhase.PLAY_DEAD);
  });

  it('still rules a TOUCHBACK when the kick is fielded inside the end zone', () => {
    const sc = kickoffPose();
    const recvDir = sc.state.attackDir[1];
    // Fielded 3 yards deep in the end zone: the kick's impetus put it there.
    fieldKickAt(sc, ownGoalY(recvDir) - 3 * recvDir);
    expect(sc.play.ball.carrierIdx).toBe(sc.returner);

    const r = sc.play.players[sc.returner];
    if (r === undefined) throw new Error('no returner');
    r.pos2 = { x: 26, y: ownGoalY(recvDir) - 5 * recvDir };
    r.anim = 'down';
    sc.play.deadReason = 'tackle';
    playLivePhase(sc.state, { frame: frame(), commands: [] }, sc.rng, []);

    const o = ext(sc.state).outcome;
    expect(o?.safety).toBe(false);
    expect(o?.deadReason).toBe('touchback');
    expect(o?.spotY).toBe(ownYardLineY(30, recvDir));
  });

  it('rules a TOUCHBACK on a fair catch made in the end zone', () => {
    const sc = kickoffPose();
    const recvDir = sc.state.attackDir[1];
    ext(sc.state).fairCatchCalled = true;
    fieldKickAt(sc, ownGoalY(recvDir) - 2 * recvDir);
    // The catch, the whistle and the ruling all land on the same tick.
    expect(sc.play.deadReason).toBe('fairCatch');
    const o = ext(sc.state).outcome;
    expect(o?.safety).toBe(false);
    expect(o?.deadReason).toBe('touchback');
  });

  it('rules a SAFETY when the punting team recovers its own blocked punt in its own end zone', () => {
    const sc = pose({
      offense: 0,
      ballOnY: ownYardLineY(4, 1),
      offensePlayId: 'punt-deep',
      defensePlayId: 'st-punt-return-unit',
    });
    const e = ext(sc.state);
    const offDir = sc.state.attackDir[0];
    // A blocked punt bouncing loose in the punting team's own end zone.
    const punter = sc.play.players[0];
    if (punter === undefined) throw new Error('no punter');
    punter.pos2 = { x: 26, y: ownGoalY(offDir) - 2 * offDir };
    punter.hasBall = false;
    sc.play.ball.mode = 'loose';
    sc.play.ball.carrierIdx = null;
    sc.play.ball.pos2 = { x: 26, y: ownGoalY(offDir) - 2 * offDir };
    sc.play.ball.z = 0.2;
    sc.play.ball.vel = { x: 0, y: 0 };
    sc.play.ball.vz = 0;
    playLivePhase(sc.state, { frame: frame(), commands: [] }, sc.rng, []);

    expect(sc.play.ball.carrierIdx).toBe(0);
    sc.play.deadReason = 'fumbleDead';
    playLivePhase(sc.state, { frame: frame(), commands: [] }, sc.rng, []);
    expect(e.outcome?.safety).toBe(true);
    expect(e.outcome?.points).toBe(2);
  });
});
