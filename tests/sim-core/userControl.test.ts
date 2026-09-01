// The user-controlled path: the sim waits for the human's choices instead of
// making them, and the discrete SimCommands drive the phase machine.

import { describe, expect, it } from 'vitest';
import { GameSim } from '../../src/sim/GameSim';
import { GameAction, GamePhase, type InputFrame } from '../../src/sim/types';
import type { SimCommand, SimEvent, TickInput } from '../../src/sim/events';
import { allDefensivePlays, allOffensivePlays } from '../../src/data/plays/index';
import { testConfig, testRosters } from './helpers';

function frame(over: Partial<InputFrame> = {}): InputFrame {
  return {
    held: new Set<GameAction>(),
    pressed: new Set<GameAction>(),
    released: new Set<GameAction>(),
    move: { x: 0, y: 0 },
    ...over,
  };
}

function makeUserSim(seed = 3): GameSim {
  return new GameSim(testConfig({ userTeam: 0 }), testRosters(seed), seed);
}

/** Drive a user-controlled game with sensible auto-responses. */
function driveUserGame(sim: GameSim, maxTicks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < maxTicks; t++) {
    const s = sim.state;
    const commands: SimCommand[] = [];
    let f = frame();

    switch (s.phase) {
      case GamePhase.COIN_TOSS:
        if (s.coin?.winner === 0) commands.push({ type: 'COIN_TOSS_CHOICE', team: 0, choice: 'receive' });
        break;
      case GamePhase.PLAY_CALL: {
        if (s.possession === 0 && s.selectedOffensePlayId === null) {
          const play = allOffensivePlays().find((p) => {
            if (s.nextPlayKind === 'kickoff' || s.nextPlayKind === 'freeKick') return p.type === 'kickoff';
            if (s.nextPlayKind === 'pat') return p.type === 'extraPoint';
            if (s.down === 4) return p.type === 'punt';
            return p.type === 'pass' || p.type === 'run';
          });
          if (play !== undefined) {
            commands.push({ type: 'SELECT_PLAY', team: 0, side: 'offense', playId: play.id });
          }
        }
        if (s.possession === 1 && s.selectedDefensePlayId === null) {
          const play = allDefensivePlays().find((p) =>
            (s.nextPlayKind === 'kickoff' || s.nextPlayKind === 'freeKick')
              ? p.shell === 'specialTeams'
              : p.shell !== 'specialTeams');
          if (play !== undefined) {
            commands.push({ type: 'SELECT_PLAY', team: 0, side: 'defense', playId: play.id });
          }
        }
        break;
      }
      case GamePhase.PRE_SNAP:
        if (s.possession === 0) f = frame({ pressed: new Set([GameAction.Snap]) });
        break;
      case GamePhase.PENALTY_DECISION:
        commands.push({ type: 'ACCEPT_PENALTY' });
        break;
      case GamePhase.POINT_AFTER_CHOICE:
        commands.push({ type: 'CHOOSE_PAT', choice: 'xp' });
        break;
      case GamePhase.QUARTER_BREAK:
      case GamePhase.HALFTIME:
      case GamePhase.OVERTIME_TOSS:
        commands.push({ type: 'CONTINUE' });
        if (s.phase === GamePhase.OVERTIME_TOSS && s.coin?.winner === 0) {
          commands.push({ type: 'COIN_TOSS_CHOICE', team: 0, choice: 'receive' });
        }
        break;
      case GamePhase.GAME_OVER:
        return out;
      default:
        break;
    }

    const input: TickInput = { frame: f, commands };
    for (const e of sim.tick(input)) out.push(e);
  }
  return out;
}

describe('user-controlled games', () => {
  it('waits for the coin-toss choice instead of making it', () => {
    const sim = makeUserSim();
    for (let t = 0; t < 300; t++) sim.tick({ frame: frame(), commands: [] });
    expect(sim.state.phase).toBe(GamePhase.COIN_TOSS);
    // Only the toss winner can answer; if the CPU won it decides on its own.
    if (sim.state.coin?.winner === 1) expect(sim.state.coin.receivingFirstHalf).not.toBeNull();
  });

  it('waits for the user play call and the user snap', () => {
    const sim = makeUserSim(9);
    // Get past the toss.
    for (let t = 0; t < 600; t++) {
      const s = sim.state;
      const commands: SimCommand[] = [];
      if (s.phase === GamePhase.COIN_TOSS && s.coin?.winner === 0) {
        commands.push({ type: 'COIN_TOSS_CHOICE', team: 0, choice: 'receive' });
      }
      sim.tick({ frame: frame(), commands });
      if (sim.state.phase === GamePhase.PLAY_CALL) break;
    }
    expect(sim.state.phase).toBe(GamePhase.PLAY_CALL);

    // With the user on offense the sim never selects for them; the play clock
    // eventually runs out and a delay-of-game flag is thrown instead.
    if (sim.state.possession === 0) {
      let sawDelay = false;
      for (let t = 0; t < 60 * 60 && !sawDelay; t++) {
        for (const e of sim.tick({ frame: frame(), commands: [] })) {
          if (e.type === 'PENALTY_ENFORCED' && e.kind === 'delayOfGame') sawDelay = true;
        }
      }
      expect(sawDelay).toBe(true);
      expect(sim.state.phase).toBe(GamePhase.PLAY_CALL);
    }
  });

  it('plays a full user-driven game to GAME_OVER', () => {
    const sim = makeUserSim(21);
    const events = driveUserGame(sim, 60 * 60 * 90);
    expect(sim.state.phase).toBe(GamePhase.GAME_OVER);
    expect(events.some((e) => e.type === 'SNAP')).toBe(true);
    expect(events.filter((e) => e.type === 'GAME_OVER').length).toBe(1);
    expect(sim.state.playLog.length).toBeGreaterThan(5);
    for (const t of [0, 1] as const) {
      const line = sim.state.stats.scoringByQuarter[t].reduce((a, b) => a + b, 0);
      expect(line).toBe(sim.state.score[t]);
    }
  });

  it('charges timeouts and stops the clock', () => {
    const sim = makeUserSim(33);
    let used = false;
    for (let t = 0; t < 60 * 120 && !used; t++) {
      const s = sim.state;
      const commands: SimCommand[] = [];
      if (s.phase === GamePhase.COIN_TOSS && s.coin?.winner === 0) {
        commands.push({ type: 'COIN_TOSS_CHOICE', team: 0, choice: 'receive' });
      }
      if (s.phase === GamePhase.PLAY_CALL || s.phase === GamePhase.PRE_SNAP) {
        commands.push({ type: 'TIMEOUT', team: 0 });
        used = true;
      }
      sim.tick({ frame: frame(), commands });
    }
    expect(used).toBe(true);
    expect(sim.state.timeouts[0]).toBe(2);
    expect(sim.state.clockRunning).toBe(false);
    expect(sim.state.playClockSec).toBeGreaterThan(24.5);
    expect(sim.state.playClockSec).toBeLessThanOrEqual(25);
  });
});
