// Audio lifecycle across a game: the crowd comes up when the game starts, the
// director is fed every tick, the bed tracks the situation, and everything goes
// quiet at the final whistle or when the player walks out to the menu.

import { describe, expect, it } from 'vitest';
import { GamePhase, type TeamSide } from '../../src/sim/types';
import { GameSession } from '../../src/game/GameSession';
import { TitleScreen } from '../../src/ui/screens/TitleScreen';
import type { ScreenManager } from '../../src/ui/ScreenManager';
import type { UiServices } from '../../src/ui/UiServices';
import { SpyAudioEngine } from '../audio/spyEngine';
import { testRosters, testTeams } from '../integration/harness';

/** CPU vs CPU: no input source needed, so the game drives itself. */
function cpuSession(audio: SpyAudioEngine, userTeam: TeamSide | null = null): GameSession {
  return new GameSession({
    config: {
      quarterLengthSec: 60,
      difficulty: 'pro',
      userTeam,
      allowTies: true,
      penaltiesEnabled: true,
      enableOnside: false,
    },
    rosters: testRosters(),
    seed: 90210,
    audio,
    teams: testTeams(),
  });
}

function run(session: GameSession, ticks: number): number {
  let stepped = 0;
  for (let i = 0; i < ticks; i++) {
    if (session.state.phase === GamePhase.GAME_OVER) break;
    session.stepOneTick();
    stepped++;
  }
  return stepped;
}

describe('crowd lifecycle', () => {
  it('brings the bed up the moment a game exists', () => {
    const audio = new SpyAudioEngine();
    cpuSession(audio);
    expect(audio.intensities).toHaveLength(1);
    expect(audio.lastIntensity()).toBeGreaterThan(0);
    expect(audio.stopCount).toBe(0);
  });

  it('feeds the director on every single tick', () => {
    const audio = new SpyAudioEngine();
    const session = cpuSession(audio);
    const stepped = run(session, 600);
    expect(stepped).toBe(600);
    expect(audio.intensities).toHaveLength(601);
    for (const v of audio.intensities) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('moves the intensity with the game rather than holding one level', () => {
    const audio = new SpyAudioEngine();
    const session = cpuSession(audio);
    run(session, 60 * 60 * 40);
    expect(session.state.phase).toBe(GamePhase.GAME_OVER);

    const min = Math.min(...audio.intensities);
    const max = Math.max(...audio.intensities);
    expect(max).toBeGreaterThan(min + 0.1);
    expect(max).toBeGreaterThan(audio.intensities[0] ?? 1);

    // The bed reacts to the play, not just to the clock.
    expect(audio.played('crowdCheer') || audio.played('crowdGroan')).toBe(true);
    expect(audio.played('whistle')).toBe(true);
    expect(audio.countOf('touchdownFanfare') + audio.countOf('fgGood')).toBeGreaterThan(0);
  });

  it('stops the ambience at the final whistle', () => {
    const audio = new SpyAudioEngine();
    const session = cpuSession(audio);
    run(session, 60 * 60 * 40);
    expect(session.over).toBe(true);
    expect(audio.stopCount).toBeGreaterThanOrEqual(1);

    // Nothing keeps talking to the engine once the game is finished.
    const after = audio.intensities.length;
    run(session, 120);
    expect(audio.intensities).toHaveLength(after);
  });

  it('goes quiet when the player leaves for the menu', () => {
    const audio = new SpyAudioEngine();
    const session = cpuSession(audio);
    run(session, 300);
    expect(audio.stopCount).toBe(0);

    session.dispose();
    expect(audio.stopCount).toBe(1);
    expect(session.audioDirector.crowdIntensity).toBeCloseTo(0.25, 6);

    // A disposed session is inert: a stray tick cannot bring the crowd back.
    const after = audio.intensities.length;
    const tick = session.state.tick;
    run(session, 60);
    expect(audio.intensities).toHaveLength(after);
    expect(session.state.tick).toBe(tick);
  });
});

describe('audio unlock', () => {
  it('the title screen unlocks the context on the first key', () => {
    const audio = new SpyAudioEngine();
    const screen = new TitleScreen();
    const replaced: string[] = [];
    Object.assign(screen, {
      services: { audio } as unknown as UiServices,
      manager: {
        replace: (next: { name: string }) => replaced.push(next.name),
      } as unknown as ScreenManager,
    });

    expect(screen.onKey({ code: 'ShiftLeft', repeat: false } as KeyboardEvent)).toBe(false);
    expect(audio.unlockCount).toBe(0);

    expect(screen.onKey({ code: 'Enter', repeat: false } as KeyboardEvent)).toBe(true);
    expect(audio.unlockCount).toBe(1);
    expect(audio.played('menuSelect')).toBe(true);
    expect(replaced).toEqual(['main-menu']);
  });
});
