// Regression: once the user is eliminated they have no game in the current
// week. getNextGame() used to pick a stranger's game and report its home team
// as the user's opponent, so the hub printed "You: 2-12 · Opponent: 10-4 ·
// Away" about a matchup the user is not in.

import { describe, expect, it } from 'vitest';
import { NullAudioEngine } from '../../src/audio/AudioEngine';
import { advanceWeek, createSeason, simWeek } from '../../src/meta/seasonState';
import type { SeasonState } from '../../src/meta/types';
import { GameServices, memoryStorage, type GameServicesHost } from '../../src/game/services';

function silentHost(): GameServicesHost {
  return {
    startExhibition: () => {},
    startSeasonGame: () => {},
    exitToMainMenu: () => {},
    resumeGame: () => {},
    quitGame: () => {},
    restartGame: () => {},
    canRestartGame: () => false,
    finishGameSummary: () => {},
    continueFromHalftime: () => {},
    requestTimeout: () => {},
    timeoutsRemaining: () => 3,
  };
}

function servicesFor(season: SeasonState): GameServices {
  const services = new GameServices({
    audio: new NullAudioEngine(),
    host: silentHost(),
    storage: memoryStorage(),
    newSeed: () => 1,
  });
  services.setSeason(season);
  return services;
}

/** League seed 11: ASH finishes 2-12 and misses the playoffs. */
function eliminatedSeason(): SeasonState {
  let s = createSeason(11, 'ASH', 'pro', 0);
  for (let week = 0; week < 14; week++) {
    s = simWeek(s);
    s = advanceWeek(s);
  }
  return s;
}

describe('getNextGame with an eliminated user', () => {
  it('reports no opponent instead of a stranger', () => {
    const season = eliminatedSeason();
    expect(season.phase).toBe('playoffs');
    expect(season.bracket?.seeds.map((s) => s.teamId)).not.toContain('ASH');

    const next = servicesFor(season).getNextGame();
    expect(next).not.toBeNull();
    expect(next?.roundLabel).toBe('CONFERENCE SEMIFINALS');
    // Still a week to sim through, and no user game in it.
    expect(next?.weekGames.length).toBeGreaterThan(0);
    expect(next?.weekGames.some((g) => g.isUserGame)).toBe(false);
    expect(next?.userGameResolved).toBe(true);

    expect(next?.opponentId).toBe('');
    expect(next?.opponentRecord).toBe('—');
    expect(next?.userIsHome).toBe(false);
    expect(next?.userRecord).toBe('2-12');
  });

  it('still names the real opponent while the user is alive', () => {
    let season = createSeason(11, 'ASH', 'pro', 0);
    const services = servicesFor(season);
    const next = services.getNextGame();
    expect(next?.opponentId).not.toBe('');
    expect(next?.opponentId).not.toBe('ASH');
    expect(next?.weekGames.some((g) => g.isUserGame)).toBe(true);
    expect(next?.opponentRecord).toBe('0-0');
    season = simWeek(season);
    expect(season.currentWeek).toBe(1);
  });
});
