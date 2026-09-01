// Calling a timeout. Timeouts are legal only with the ball dead, and a request
// made on the dead-ball beat has to survive until a phase that honours it —
// PLAY_DEAD and PLAY_LIVE both ignore the command outright, and the session
// throws its queue away every tick.

import { describe, expect, it } from 'vitest';
import { GamePhase } from '../../src/sim/types';
import type { UiServices } from '../../src/ui/UiServices';
import { timeoutEntryState } from '../../src/ui/screens/PauseScreen';
import { autoAnswer, makeHarness, type Harness } from '../integration/harness';

/** Run the harness until the sim sits in `phase`. */
function runToPhase(h: Harness, phase: GamePhase, maxTicks = 60 * 400): void {
  const ran = h.run(maxTicks, (s) => s.phase === phase);
  expect(h.session.state.phase, `never reached ${phase} in ${ran} ticks`).toBe(phase);
}

function harness(): Harness {
  return makeHarness({ userTeam: 0, onPrompt: (p, s) => autoAnswer(p, s), renderer: null });
}

describe('timeout requests', () => {
  it('honours a timeout asked for during the dead-ball beat', () => {
    const h = harness();
    runToPhase(h, GamePhase.PLAY_DEAD);
    const before = h.session.state.timeouts[0];
    expect(before).toBeGreaterThan(0);
    expect(h.session.canCallTimeout()).toBe(true);

    h.session.requestTimeout();
    h.run(600, (s) => s.timeouts[0] !== before);
    expect(h.session.state.timeouts[0]).toBe(before - 1);
    expect(h.session.state.clockRunning).toBe(false);
    expect(h.session.state.playClockSec).toBeLessThanOrEqual(25);
    expect(h.session.state.playClockSec).toBeGreaterThan(24);
  });

  it('refuses a timeout while the ball is live', () => {
    const h = harness();
    runToPhase(h, GamePhase.PLAY_LIVE);
    expect(h.session.canCallTimeout()).toBe(false);
    const before = h.session.state.timeouts[0];
    h.session.requestTimeout();
    h.run(400, (s) => s.phase === GamePhase.PLAY_CALL);
    expect(h.session.state.timeouts[0]).toBe(before);
  });

  it('allows one in the huddle', () => {
    const h = harness();
    runToPhase(h, GamePhase.PLAY_CALL);
    expect(h.session.canCallTimeout()).toBe(true);
  });
});

describe('pause menu timeout entry', () => {
  function fakeServices(remaining: number, legal: boolean | undefined): UiServices {
    const stub = {
      timeoutsRemaining: () => remaining,
      ...(legal === undefined ? {} : { canCallTimeout: () => legal }),
    };
    return stub as unknown as UiServices;
  }

  it('is enabled with the ball dead', () => {
    const entry = timeoutEntryState(fakeServices(2, true));
    expect(entry.enabled).toBe(true);
    expect(entry.label).toBe('Call Timeout (2)');
  });

  it('is disabled with a hint while the ball is live', () => {
    const entry = timeoutEntryState(fakeServices(2, false));
    expect(entry.enabled).toBe(false);
    expect(entry.label).toContain('Call Timeout (2)');
    expect(entry.label.toLowerCase()).toContain('ball is dead');
  });

  it('is disabled when there are none left', () => {
    const entry = timeoutEntryState(fakeServices(0, true));
    expect(entry.enabled).toBe(false);
  });

  it('stays enabled for hosts that do not report legality', () => {
    const entry = timeoutEntryState(fakeServices(3, undefined));
    expect(entry.enabled).toBe(true);
  });
});
