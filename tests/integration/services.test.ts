// GameServices against real league generation, the meta season reducer and an
// in-memory storage stand-in — the same code path the browser App runs.

import { describe, expect, it } from 'vitest';
import { NullAudioEngine } from '../../src/audio/AudioEngine';
import { REGULAR_SEASON_WEEKS } from '../../src/meta/index';
import type { StoredBoxScore } from '../../src/meta/types';
import { emptyGameStats } from '../../src/sim/GameSim';
import type { ExhibitionSetup } from '../../src/ui/UiServices';
import { GameServices, memoryStorage, type GameServicesHost } from '../../src/game/services';

function recordingHost(): GameServicesHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    startExhibition: (setup: ExhibitionSetup) => { calls.push(`exhibition:${setup.awayTeamId}@${setup.homeTeamId}`); },
    startSeasonGame: () => { calls.push('seasonGame'); },
    exitToMainMenu: () => { calls.push('exit'); },
    resumeGame: () => { calls.push('resume'); },
    quitGame: () => { calls.push('quit'); },
    restartGame: () => { calls.push('restart'); },
    canRestartGame: () => true,
    finishGameSummary: () => { calls.push('finish'); },
    continueFromHalftime: () => { calls.push('halftime'); },
    requestTimeout: () => { calls.push('timeout'); },
    timeoutsRemaining: () => 3,
  };
}

function makeServices(storage = memoryStorage()) {
  const host = recordingHost();
  const services = new GameServices({
    audio: new NullAudioEngine(),
    host,
    storage,
    newSeed: () => 777,
  });
  return { services, host, storage };
}

describe('GameServices — league & settings', () => {
  it('serves a stable 16-team exhibition league', () => {
    const { services } = makeServices();
    expect(services.getTeams()).toHaveLength(16);
    expect(services.getIdentities()).toHaveLength(16);
    const ash = services.getTeam('ASH');
    expect(ash?.identity.city).toBe('Ashford');
    expect(ash?.roster.athletes.length).toBeGreaterThan(30);
    expect(services.getTopStars('ASH', 3)).toHaveLength(3);
    expect(services.playerName(ash?.roster.athletes[0]?.id ?? '')).toMatch(/\w\. \w/);
  });

  it('round-trips settings through storage', () => {
    const storage = memoryStorage();
    const a = makeServices(storage).services;
    a.saveSettings({ ...a.loadSettings(), volMaster: 3, quarterMinutes: 7 });

    const b = makeServices(storage).services;
    expect(b.loadSettings().volMaster).toBe(3);
    expect(b.loadSettings().quarterMinutes).toBe(7);
  });

  it('forwards flow calls to the host', () => {
    const { services, host } = makeServices();
    services.startExhibition({ awayTeamId: 'OAK', homeTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });
    services.resumeGame();
    services.quitGame();
    expect(host.calls).toEqual(['exhibition:OAK@ASH', 'resume', 'quit']);
  });
});

describe('GameServices — season', () => {
  it('creates, sims and persists a season', () => {
    const storage = memoryStorage();
    const { services } = makeServices(storage);
    expect(services.hasSeasonSave()).toBe(false);

    services.startNewSeason({ userTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });
    expect(services.hasSeasonSave()).toBe(true);
    expect(services.saveSummary()).toContain('ASHFORD');

    const next = services.getNextGame();
    expect(next).toBeTruthy();
    expect(next?.week).toBe(1);
    expect(next?.roundLabel).toBe('WEEK 1');
    expect(next?.userGameResolved).toBe(false);
    expect(next?.weekGames.length).toBeGreaterThan(1);
    expect(next?.weekGames[0]?.isUserGame).toBe(true);

    services.simUserGame();
    expect(services.getNextGame()?.userGameResolved).toBe(true);

    services.simWeek();
    expect(services.getSeason()?.currentWeek).toBe(2);
    expect(services.getStandings()).toHaveLength(16);
    expect(Object.keys(services.getSeasonStats()).length).toBeGreaterThan(0);

    // A fresh services instance over the same storage picks the season back up.
    const reloaded = makeServices(storage).services;
    expect(reloaded.getSeason()?.currentWeek).toBe(2);
    expect(reloaded.getSeason()?.userTeamId).toBe('ASH');
  });

  it('records a live-played user game into the season', () => {
    const { services } = makeServices();
    services.startNewSeason({ userTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });
    const game = services.getNextGame()?.game;
    expect(game).toBeTruthy();
    if (!game) return;

    const home = services.getTeam(game.homeId);
    const away = services.getTeam(game.awayId);
    if (!home || !away) throw new Error('teams missing');
    const stats = emptyGameStats([home.roster, away.roster]);
    stats.teams[0].points = 24;
    stats.teams[1].points = 17;
    const box: StoredBoxScore = { gameId: game.id, week: game.week, stats, simmed: false };

    services.recordPlayedGame(box, false);
    const view = services.getBoxScoreView(game.id);
    expect(view?.stats.teams[0].points).toBe(24);
    expect(view?.simmed).toBe(false);
    expect(services.getNextGame()?.userGameResolved).toBe(true);
  });

  it('runs a whole season through to a champion', () => {
    const { services } = makeServices();
    services.startNewSeason({ userTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });

    for (let i = 0; i < REGULAR_SEASON_WEEKS + 6; i++) {
      if (services.getSeason()?.phase === 'complete') break;
      services.simUserGame();
      services.simWeek();
    }

    const season = services.getSeason();
    expect(season?.phase).toBe('complete');
    expect(season?.champion).toBeTruthy();
    const champ = services.getChampionInfo();
    expect(champ?.teamId).toBe(season?.champion);
    expect(champ?.scoreLine).not.toBe('');
    expect(champ?.awards[0]?.label).toBe('MVP');
  });

  it('resets every save', () => {
    const storage = memoryStorage();
    const { services } = makeServices(storage);
    services.startNewSeason({ userTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });
    services.resetAllSaves();
    expect(services.hasSeasonSave()).toBe(false);
    expect(makeServices(storage).services.getSeason()).toBeNull();
  });
});
