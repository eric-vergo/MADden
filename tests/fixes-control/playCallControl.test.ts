// PLAY_CALL: who gets flagged when the play clock expires, and who the user
// gets to drive on a return unit.

import { describe, expect, it } from 'vitest';
import { GameSim, createInitialState } from '../../src/sim/GameSim';
import { GameAction, GamePhase, type TeamSide } from '../../src/sim/types';
import type { SimCommand, SimEvent } from '../../src/sim/events';
import { playCallPhase } from '../../src/sim/phases/playCall';
import { makeRngSet } from '../../src/sim/rng';
import { ext } from '../../src/sim/rules/ext';
import { allOffensivePlays } from '../../src/data/plays/index';
import { frame, testConfig, testRosters } from './helpers';

/** A PLAY_CALL state with both calls already in, one tick from building. */
function callPose(userTeam: TeamSide, offensePlayId: string, defensePlayId: string) {
  const state = createInitialState(testConfig({ userTeam }), testRosters(), 7);
  state.phase = GamePhase.PLAY_CALL;
  state.possession = 0;
  state.ballOnY = 45;
  state.nextPlayKind = 'kickoff';
  state.selectedOffensePlayId = offensePlayId;
  state.selectedDefensePlayId = defensePlayId;
  const e = ext(state);
  e.phaseInit = true;
  e.cpuOffenseCallTick = 0;
  e.cpuDefenseCallTick = 0;
  playCallPhase(state, { frame: frame(), commands: [] }, makeRngSet(7), []);
  return state;
}

describe('user control on return units', () => {
  it('hands the receiving user the kick returner, not a wedge blocker', () => {
    const state = callPose(1, 'kickoff-deep', 'st-kick-return-unit');
    const play = state.play;
    expect(play).not.toBeNull();
    const idx = play?.controlledIdx ?? -1;
    expect(idx).toBeGreaterThanOrEqual(11);
    expect(play?.players[idx]?.assignment.kind).toBe('returner');
    expect(play?.players[idx]?.role).toBe('KR');
  });

  it('hands the receiving user the punt returner', () => {
    const state = callPose(1, 'punt-deep', 'st-punt-return-unit');
    const play = state.play;
    const idx = play?.controlledIdx ?? -1;
    expect(play?.players[idx]?.assignment.kind).toBe('returner');
    expect(play?.players[idx]?.role).toBe('PR');
  });

  it('still hands the defensive user a linebacker on a scrimmage down', () => {
    const state = createInitialState(testConfig({ userTeam: 1 }), testRosters(), 7);
    state.phase = GamePhase.PLAY_CALL;
    state.possession = 0;
    state.ballOnY = 50;
    state.nextPlayKind = 'normal';
    state.selectedOffensePlayId = 'i-form-hb-dive';
    state.selectedDefensePlayId = null;
    const e = ext(state);
    e.phaseInit = true;
    // Let the CPU pick a defense for the *user*'s side is not the point here;
    // supply one directly.
    const rng = makeRngSet(7);
    state.selectedDefensePlayId = pickScrimmageDefense();
    playCallPhase(state, { frame: frame(), commands: [] }, rng, []);
    const play = state.play;
    const idx = play?.controlledIdx ?? -1;
    expect(idx).toBeGreaterThanOrEqual(11);
    expect(play?.players[idx]?.assignment.kind).not.toBe('returner');
  });
});

function pickScrimmageDefense(): string {
  return '43-cover-3';
}

/**
 * Drive a sim as user team 1: play the offense normally, but sit on the
 * play-call screen for the whole play clock every time the user is on defense.
 */
function driveNeverCallingDefense(sim: GameSim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    const s = sim.state;
    const commands: SimCommand[] = [];
    let f = frame();
    switch (s.phase) {
      case GamePhase.COIN_TOSS:
        if (s.coin?.winner === 1) {
          commands.push({ type: 'COIN_TOSS_CHOICE', team: 1, choice: 'receive' });
        }
        break;
      case GamePhase.PLAY_CALL:
        if (s.possession === 1 && s.selectedOffensePlayId === null) {
          const play = allOffensivePlays().find((p) => {
            if (s.nextPlayKind === 'kickoff' || s.nextPlayKind === 'freeKick') return p.type === 'kickoff';
            if (s.nextPlayKind === 'pat') return p.type === 'extraPoint';
            if (s.down === 4) return p.type === 'punt';
            return p.type === 'run';
          });
          if (play !== undefined) {
            commands.push({ type: 'SELECT_PLAY', team: 1, side: 'offense', playId: play.id });
          }
        }
        break;
      case GamePhase.PRE_SNAP:
        if (s.possession === 1) f = frame({ pressed: new Set([GameAction.Snap]) });
        break;
      case GamePhase.POINT_AFTER_CHOICE:
        commands.push({ type: 'CHOOSE_PAT', choice: 'xp' });
        break;
      case GamePhase.PENALTY_DECISION:
        commands.push({ type: 'DECLINE_PENALTY' });
        break;
      case GamePhase.QUARTER_BREAK:
      case GamePhase.HALFTIME:
        commands.push({ type: 'CONTINUE' });
        break;
      default:
        break;
    }
    for (const ev of sim.tick({ frame: f, commands })) out.push(ev);
  }
  return out;
}

describe('play-clock expiry attribution', () => {
  it('never flags the CPU offense because the user on defense has not called', () => {
    const sim = new GameSim(testConfig({ userTeam: 1 }), testRosters(3), 4242);
    const events = driveNeverCallingDefense(sim, 60 * 240);
    const delays = events.filter(
      (ev) => ev.type === 'PENALTY_ENFORCED' && ev.kind === 'delayOfGame',
    );
    expect(delays).toEqual([]);
    // And the game does not stall: the coordinator sends a call in.
    expect(events.some((ev) => ev.type === 'SNAP')).toBe(true);
  });

  it('still flags a user offense that never calls', () => {
    const sim = new GameSim(testConfig({ userTeam: 0 }), testRosters(3), 4242);
    let sawDelay = false;
    let sawOffense = true;
    for (let t = 0; t < 60 * 240 && !sawDelay; t++) {
      const s = sim.state;
      const commands: SimCommand[] = [];
      if (s.phase === GamePhase.COIN_TOSS && s.coin?.winner === 0) {
        commands.push({ type: 'COIN_TOSS_CHOICE', team: 0, choice: 'kick' });
      }
      for (const ev of sim.tick({ frame: frame(), commands })) {
        if (ev.type === 'PENALTY_ENFORCED' && ev.kind === 'delayOfGame') {
          sawDelay = true;
          sawOffense = ev.team === sim.state.possession;
        }
      }
    }
    expect(sawDelay).toBe(true);
    expect(sawOffense).toBe(true);
  });
});
