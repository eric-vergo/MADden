// Standalone walkthrough of every UI screen against FakeUiServices.
// Served by ui-demo.html — `npm run dev` then open /ui-demo.html.
// Shift+1..9 jumps straight to a screen; everything else is the real keyboard
// flow the game will ship with.

import { FORMATIONS } from '../data/plays/formations';
import { OFFENSIVE_PLAYS } from '../data/plays/offense';
import type { GameStats, PendingPenaltyDecision } from '../sim/types';
import { ScreenManager } from './ScreenManager';
import { FakeUiServices } from './fixtures/FakeUiServices';
import { makeFakeBoxScore, simulateResult } from './fixtures/fakeLeague';
import type { PlayCallGroup, PlayCallRequest } from './UiServices';
import { ChampionScreen } from './screens/ChampionScreen';
import { GameSummaryScreen } from './screens/GameSummaryScreen';
import { HalftimeStatsScreen } from './screens/HalftimeStatsScreen';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { PauseScreen } from './screens/PauseScreen';
import { PenaltyPromptScreen } from './screens/PenaltyPromptScreen';
import { PlayCallScreen } from './screens/PlayCallScreen';
import { SeasonHubScreen } from './screens/SeasonHubScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TeamSelectScreen } from './screens/TeamSelectScreen';
import { TitleScreen } from './screens/TitleScreen';

const root = document.getElementById('ui');
if (!root) throw new Error('ui-demo.html must provide #ui');

let demoHome = 'ASH';
let demoAway = 'OAK';

const services = new FakeUiServices({
  hooks: {
    onStartExhibition: (setup) => {
      demoHome = setup.homeTeamId;
      demoAway = setup.awayTeamId;
      openPlayCall();
    },
    onPlayUserGame: () => openPlayCall(),
    onQuitGame: () => manager.reset(new MainMenuScreen()),
    onExitToMainMenu: () => manager.reset(new MainMenuScreen()),
    onFinishSummary: () => manager.reset(new MainMenuScreen()),
    onContinueHalftime: () => manager.pop(),
  },
});

const manager = new ScreenManager(root, services);
manager.push(new TitleScreen());
manager.attachKeyboard();

// --- in-game tour -----------------------------------------------------------

function playCallGroups(): PlayCallGroup[] {
  const byFormation = new Map<string, PlayCallGroup>();
  for (const play of OFFENSIVE_PLAYS) {
    const formation = FORMATIONS.find((f) => f.id === play.formationId);
    let group = byFormation.get(play.formationId);
    if (!group) {
      group = {
        id: play.formationId,
        label: play.formationId.replace(/-/g, ' ').toUpperCase(),
        personnel: formation?.personnelLabel,
        cards: [],
      };
      byFormation.set(play.formationId, group);
    }
    group.cards.push({
      playId: play.id,
      name: play.name,
      tags: play.tags,
      play,
      formation,
    });
  }
  return [...byFormation.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

function makePlayCallRequest(): PlayCallRequest {
  const home = services.getTeam(demoHome);
  return {
    side: 'offense',
    groups: playCallGroups(),
    situation: {
      down: 2, toGo: 7, goalToGo: false, ballOnY: 46,
      quarter: 2, clockSec: 272, playClockSec: 21,
      score: [14, 10], possession: 0,
      timeouts: [3, 2],
      homeAbbrev: demoHome, awayAbbrev: demoAway,
    },
    colors: home?.identity.colors ?? { primary: '#1B3A6B', secondary: '#E8B93E' },
    suggest: () => OFFENSIVE_PLAYS.slice(0, 3).map((p) => p.id),
    onSelect: () => openPenaltyPrompt(),
    onTimeout: () => services.requestTimeout(),
  };
}

function openPlayCall(): void {
  manager.reset(new PlayCallScreen(makePlayCallRequest()));
}

function demoPenalty(): PendingPenaltyDecision {
  return {
    flag: { kind: 'holding', team: 1, playerIdx: 15, spotY: 46, preSnap: false },
    decidingTeam: 0,
    acceptOutcome: {
      down: 2, toGo: 3, ballOnY: 56, possession: 0, firstDown: false,
      description: `2nd & 3 at ${demoAway} 44`,
    },
    declineOutcome: {
      down: 3, toGo: 9, ballOnY: 44, possession: 0, firstDown: false,
      description: `3rd & 9 at ${demoHome} 44`,
    },
  };
}

function openPenaltyPrompt(): void {
  manager.push(new PenaltyPromptScreen({
    decision: demoPenalty(),
    abbrevs: [demoHome, demoAway],
    offenderName: 'T. Ridley',
    offenderJersey: 74,
    autoPickSeconds: 8,
    onDecide: () => {
      manager.pop();
      openHalftime();
    },
  }));
}

function demoStats(): GameStats {
  const home = services.getTeam(demoHome);
  const away = services.getTeam(demoAway);
  const game = { id: 'DEMO-GAME', week: 7, homeId: demoHome, awayId: demoAway };
  const result = simulateResult(game, services.getTeams(), 7);
  if (!home || !away) {
    return { teams: [emptyTeam(demoHome), emptyTeam(demoAway)], players: {}, scoringByQuarter: [[], []] };
  }
  return makeFakeBoxScore(game.id, home, away, result, 7);
}

function emptyTeam(teamId: string): GameStats['teams'][0] {
  return {
    teamId, points: 0, totalYds: 0, passYds: 0, rushYds: 0, firstDowns: 0,
    thirdDownConv: 0, thirdDownAtt: 0, turnovers: 0, penalties: 0, penaltyYds: 0,
    topSeconds: 1800, sacksAllowed: 0,
  };
}

function openHalftime(): void {
  const view = services.makeBoxScoreView('DEMO-GAME', demoHome, demoAway, demoStats(), `${demoAway} @ ${demoHome} · HALFTIME`);
  manager.push(new HalftimeStatsScreen({ view, onContinue: () => openSummary() }));
}

function openSummary(): void {
  const view = services.makeBoxScoreView('DEMO-GAME', demoHome, demoAway, demoStats(), `WEEK 7 · ${demoAway} @ ${demoHome} · FINAL`);
  manager.reset(new GameSummaryScreen({
    view,
    final: true,
    onDone: () => manager.reset(new MainMenuScreen()),
  }));
}

// --- jump shortcuts ---------------------------------------------------------

function ensureSeason(weeks = 6): void {
  if (services.getSeason()) return;
  services.startNewSeason({ userTeamId: 'ASH', difficulty: 'pro', quarterMinutes: 5 });
  for (let i = 0; i < weeks; i++) {
    services.simUserGame();
    services.simWeek();
  }
}

const JUMPS: Record<string, [string, () => void]> = {
  Digit1: ['Title', () => manager.reset(new TitleScreen())],
  Digit2: ['Menu', () => manager.reset(new MainMenuScreen())],
  Digit3: ['Teams', () => {
    manager.reset(new MainMenuScreen());
    manager.push(new TeamSelectScreen({ mode: 'exhibition', onDone: () => openPlayCall() }));
  }],
  Digit4: ['Hub', () => {
    ensureSeason();
    manager.reset(new MainMenuScreen());
    manager.push(new SeasonHubScreen());
  }],
  Digit5: ['Play', () => openPlayCall()],
  Digit6: ['Pause', () => { openPlayCall(); manager.push(new PauseScreen()); }],
  Digit7: ['Flag', () => { openPlayCall(); openPenaltyPrompt(); }],
  Digit8: ['Half', () => { manager.reset(new MainMenuScreen()); openHalftime(); }],
  Digit9: ['Box', () => openSummary()],
  Digit0: ['Champ', () => {
    ensureSeason(0);
    for (let i = 0; i < 20 && services.getSeason()?.phase !== 'complete'; i++) {
      services.simUserGame();
      services.simWeek();
    }
    manager.reset(new MainMenuScreen());
    manager.push(new ChampionScreen());
  }],
  Minus: ['Cfg', () => { manager.reset(new MainMenuScreen()); manager.push(new SettingsScreen()); }],
};

document.addEventListener('keydown', (e) => {
  if (!e.shiftKey) return;
  const jump = JUMPS[e.code];
  if (!jump) return;
  e.preventDefault();
  e.stopPropagation();
  jump[1]();
}, true);

const hint = document.createElement('div');
hint.id = 'demo-hint';
hint.textContent = `SHIFT ${Object.values(JUMPS).map((j, i) => `${i === 10 ? '-' : (i + 1) % 10}·${j[0]}`).join(' ')}`;
document.body.appendChild(hint);
