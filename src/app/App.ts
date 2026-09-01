// Top-level state machine. Owns the screen stack, the services the screens
// talk to, and the lifetime of exactly one GameSession at a time. Nothing else
// in the codebase knows both "the menus" and "the game" — that is this file's
// job: TITLE -> MAIN_MENU -> {EXHIBITION | SEASON} -> GAME -> summary -> back.

import type { AudioEngine } from '../audio/AudioEngine';
import { allDefensivePlays, allOffensivePlays, getFormation, getOffensivePlay } from '../data/plays/index';
import { InputSystem, Keyboard, type KeyEventSource } from '../input/index';
import type { StoredBoxScore, Team } from '../meta/types';
import { Renderer } from '../render/Renderer';
import { teamPresentation, type TeamPresentation } from '../render/types';
import { hashSeed } from '../sim/rng';
import { isGoalToGo } from '../sim/rules/downs';
import type {
  DefensivePlayDef, Difficulty, GameConfig, GameState,
  OffensivePlayDef, TeamRoster, TeamSide,
} from '../sim/types';
import type { SettingsSave } from '../save/schemas';
import type { StorageLike } from '../save/storage';
import { ScreenManager } from '../ui/ScreenManager';
import type { Screen } from '../ui/Screen';
import type {
  BoxScoreView, ExhibitionSetup, PlayCallGroup, PlayCallRequest, PlayCardInfo,
  PlayCallSituation,
} from '../ui/UiServices';
import { GameSummaryScreen } from '../ui/screens/GameSummaryScreen';
import { HalftimeStatsScreen } from '../ui/screens/HalftimeStatsScreen';
import { MainMenuScreen } from '../ui/screens/MainMenuScreen';
import { PauseScreen } from '../ui/screens/PauseScreen';
import { PenaltyPromptScreen } from '../ui/screens/PenaltyPromptScreen';
import { PlayCallScreen } from '../ui/screens/PlayCallScreen';
import { SeasonHubScreen } from '../ui/screens/SeasonHubScreen';
import { TitleScreen } from '../ui/screens/TitleScreen';
import { GameSession, type UserPrompt } from '../game/GameSession';
import { ChoiceScreen, GameRootScreen } from '../game/screens';
import { GameServices, type GameServicesHost } from '../game/services';
import { GameLoop } from './GameLoop';

const PENALTY_AUTO_PICK_SEC = 8;

/** Play types that never belong in the normal down-and-distance playbook. */
const SPECIAL_TYPES: ReadonlySet<string> = new Set(['kickoff', 'extraPoint', 'twoPoint']);

interface ActiveGame {
  mode: 'exhibition' | 'season';
  homeId: string;
  awayId: string;
  userTeam: TeamSide;
  difficulty: Difficulty;
  quarterMinutes: number;
  seed: number;
  teams: readonly Team[];
  gameId: string;
  week: number;
  label: string;
}

export interface AppOptions {
  /** The #ui overlay element the screen stack mounts into. */
  uiRoot: HTMLElement;
  canvas?: HTMLCanvasElement | null;
  audio: AudioEngine;
  storage?: StorageLike;
  /** Where key events come from (default: window). */
  keySource?: KeyEventSource;
  /** Where the screen stack listens for keys (default: the root's document). */
  keyTarget?: EventTarget;
  newSeed?: () => number;
}

export class App implements GameServicesHost {
  readonly services: GameServices;
  readonly manager: ScreenManager;
  readonly renderer: Renderer | null;

  private readonly keyboard: Keyboard;
  private readonly input: InputSystem;
  private readonly loop: GameLoop;
  private readonly audio: AudioEngine;
  private readonly newSeed: () => number;
  private readonly keyTarget: EventTarget | undefined;

  private session: GameSession | null = null;
  private active: ActiveGame | null = null;
  private playCallScreen: PlayCallScreen | null = null;
  private playCallSignature = '';
  private settings: SettingsSave;
  private lastTopName = '';

  constructor(opts: AppOptions) {
    this.audio = opts.audio;
    this.newSeed = opts.newSeed ?? (() => hashSeed(Date.now(), 'game'));
    this.keyTarget = opts.keyTarget;
    this.services = new GameServices({
      audio: opts.audio,
      host: this,
      storage: opts.storage,
      newSeed: opts.newSeed,
    });
    this.settings = this.services.loadSettings();
    this.manager = new ScreenManager(opts.uiRoot, this.services);
    this.renderer = opts.canvas ? new Renderer(opts.canvas) : null;

    const source = opts.keySource ?? (globalThis as unknown as { window?: KeyEventSource }).window;
    this.keyboard = new Keyboard(source ?? nullKeySource());
    this.input = new InputSystem(this.keyboard, this.settings.bindings);
    this.loop = new GameLoop({
      stepOneTick: () => this.session?.stepOneTick(),
      render: (alpha, dt) => this.renderFrame(alpha, dt),
    });
  }

  // --- lifecycle ------------------------------------------------------------

  start(): void {
    this.manager.reset(new TitleScreen());
    this.manager.attachKeyboard(this.keyTarget);
    this.syncInput();
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
    this.manager.detachKeyboard();
    this.keyboard.dispose();
    this.disposeSession();
  }

  /** Persist anything pending (beforeunload, tab hide). */
  saveNow(): void {
    this.services.save();
  }

  resize(widthCss: number, heightCss: number, rawDpr: number): void {
    this.renderer?.resize(widthCss, heightCss, rawDpr);
  }

  private renderFrame(alpha: number, dt: number): void {
    this.session?.render(alpha, dt);
    this.refreshPlayCall();
    this.syncInput();
  }

  /**
   * The play-call overlay stays open across a delay-of-game replay, so the
   * situation strip has to follow the live state, not just the play clock.
   */
  private refreshPlayCall(): void {
    const screen = this.playCallScreen;
    const session = this.session;
    if (!screen || !session) return;
    const s = session.state;
    const sig = `${s.down}|${s.toGo}|${Math.round(s.ballOnY)}|${s.quarter}`
      + `|${Math.round(s.clockSec)}|${s.score[0]}|${s.score[1]}|${s.possession}`;
    if (sig === this.playCallSignature) {
      screen.setPlayClock(s.playClockSec);
      return;
    }
    this.playCallSignature = sig;
    screen.setSituation(situationOf(s));
  }

  /**
   * A DOM screen above the game owns the keyboard; game input goes quiet.
   * This is also where pausing is decided, because a screen can push the pause
   * menu on its own (PlayCallScreen does) without ever telling the App.
   */
  private syncInput(): void {
    const name = this.manager.top?.name ?? '';
    if (name === this.lastTopName) return;
    this.lastTopName = name;
    const session = this.session;
    const inGameFocus = session !== null && name === 'game-root';
    this.keyboard.setActive(inGameFocus);
    session?.setInputEnabled(inGameFocus);
    if (!session) return;
    const wantPaused = this.manager.has('pause');
    if (wantPaused && !session.paused) session.pause();
    else if (!wantPaused && session.paused) session.resume();
  }

  // --- starting games -------------------------------------------------------

  startExhibition(setup: ExhibitionSetup): void {
    const teams = this.services.exhibitionTeams();
    const home = teams.find((t) => t.identity.id === setup.homeTeamId);
    const away = teams.find((t) => t.identity.id === setup.awayTeamId);
    if (!home || !away) return;
    this.services.setActiveTeams(teams);
    this.beginGame({
      mode: 'exhibition',
      homeId: home.identity.id,
      awayId: away.identity.id,
      // Away is the first pick on the team-select screen: that is the user.
      userTeam: 1,
      difficulty: setup.difficulty,
      quarterMinutes: setup.quarterMinutes,
      seed: this.newSeed(),
      teams,
      gameId: 'exhibition',
      week: 0,
      label: `${away.identity.id} @ ${home.identity.id}`,
    });
  }

  startSeasonGame(): void {
    const season = this.services.getSeason();
    const next = this.services.getNextGame();
    if (!season || !next) return;
    const teams = season.league.teams;
    const game = next.game;
    this.services.setActiveTeams(teams);
    this.beginGame({
      mode: 'season',
      homeId: game.homeId,
      awayId: game.awayId,
      userTeam: game.homeId === season.userTeamId ? 0 : 1,
      difficulty: season.difficulty,
      quarterMinutes: this.settings.quarterMinutes,
      seed: hashSeed(season.league.leagueSeed, 'live', game.id),
      teams,
      gameId: game.id,
      week: game.week,
      label: next.roundLabel,
    });
  }

  private rostersFor(spec: ActiveGame): [TeamRoster, TeamRoster] | null {
    const home = spec.teams.find((t) => t.identity.id === spec.homeId);
    const away = spec.teams.find((t) => t.identity.id === spec.awayId);
    if (!home || !away) return null;
    return [home.roster, away.roster];
  }

  private presentationFor(spec: ActiveGame): [TeamPresentation, TeamPresentation] | null {
    const home = spec.teams.find((t) => t.identity.id === spec.homeId);
    const away = spec.teams.find((t) => t.identity.id === spec.awayId);
    if (!home || !away) return null;
    const of = (t: Team): TeamPresentation => teamPresentation(
      t.identity.id, t.identity.city, t.identity.nickname, t.identity.colors, t.identity.logo,
    );
    return [of(home), of(away)];
  }

  private beginGame(spec: ActiveGame): void {
    this.disposeSession();
    const rosters = this.rostersFor(spec);
    const teams = this.presentationFor(spec);
    if (!rosters || !teams) return;

    const config: GameConfig = {
      quarterLengthSec: spec.quarterMinutes * 60,
      difficulty: spec.difficulty,
      userTeam: spec.userTeam,
      allowTies: spec.mode === 'exhibition' || spec.week <= 14,
      penaltiesEnabled: true,
      enableOnside: true,
      neutralSite: spec.mode === 'season' && spec.week >= 17,
    };

    this.active = spec;
    this.session = new GameSession({
      config,
      rosters,
      seed: spec.seed,
      audio: this.audio,
      teams,
      input: this.input,
      renderer: this.renderer,
      settings: this.settings,
      hooks: {
        onPrompt: (prompt) => this.onPrompt(prompt),
        onPauseRequested: () => this.openPause(),
        onGameOver: (state) => this.recordResult(state),
      },
    });

    this.playCallScreen = null;
    this.manager.reset(new GameRootScreen());
    this.lastTopName = '';
    this.syncInput();
    if (!this.loop.running) this.loop.start();
  }

  private disposeSession(): void {
    this.session?.dispose();
    this.session = null;
    this.playCallScreen = null;
  }

  // --- prompts --------------------------------------------------------------

  private closeOverlays(): void {
    while (this.manager.size > 1 && this.manager.top?.name !== 'game-root') this.manager.pop();
    this.playCallScreen = null;
    this.lastTopName = '';
    this.syncInput();
  }

  private pushOverlay(screen: Screen): void {
    this.manager.push(screen);
    this.lastTopName = '';
    this.syncInput();
  }

  private onPrompt(prompt: UserPrompt | null): void {
    const session = this.session;
    if (!session) return;
    // A paused game keeps its overlay stack; the prompt is re-applied on resume.
    this.closeOverlays();
    if (prompt === null) return;

    switch (prompt.kind) {
      case 'playCall':
        this.openPlayCall(prompt.side);
        return;
      case 'penalty':
        this.pushOverlay(new PenaltyPromptScreen({
          decision: prompt.decision,
          abbrevs: [session.state.rosters[0].abbrev, session.state.rosters[1].abbrev],
          autoPickSeconds: PENALTY_AUTO_PICK_SEC,
          onDecide: (choice) => session.decidePenalty(choice),
        }));
        return;
      case 'pat':
        this.pushOverlay(new ChoiceScreen({
          name: 'pat-choice',
          headline: 'Touchdown — point after',
          sub: 'Kick the extra point or go for two',
          options: [
            { key: 'xp', title: 'Extra Point', detail: '1 point · 33-yard kick' },
            { key: 'two', title: 'Two-Point Try', detail: '2 points · snap from the 2' },
          ],
          onChoose: (key) => session.choosePat(key === 'two' ? 'two' : 'xp'),
        }));
        return;
      case 'coinToss':
        this.pushOverlay(new ChoiceScreen({
          name: 'coin-toss',
          headline: prompt.overtime ? 'Overtime toss — you won it' : 'You won the toss',
          sub: 'Take the ball or kick off',
          options: [
            { key: 'receive', title: 'Receive', detail: 'Your offense starts with the ball' },
            { key: 'kick', title: 'Kick', detail: 'Defer possession and kick off' },
          ],
          onChoose: (key) => session.chooseCoinToss(key === 'kick' ? 'kick' : 'receive'),
        }));
        return;
      case 'halftime':
        this.pushOverlay(new HalftimeStatsScreen({
          view: this.boxScoreView(session.state, 'HALFTIME'),
          onContinue: () => session.continueBreak(),
        }));
        return;
      case 'gameOver':
        this.showSummary(session.state);
        return;
    }
  }

  private boxScoreView(state: Readonly<GameState>, label: string): BoxScoreView {
    const spec = this.active;
    const homeId = spec?.homeId ?? state.rosters[0].abbrev;
    const awayId = spec?.awayId ?? state.rosters[1].abbrev;
    const prefix = spec && spec.mode === 'season' ? `${spec.label} · ` : '';
    return this.services.makeBoxScoreView(
      spec?.gameId ?? 'game', homeId, awayId, state.stats, `${prefix}${label}`, false,
    );
  }

  private showSummary(state: Readonly<GameState>): void {
    // The game is over: stop drawing the field behind the box score.
    this.session?.setRenderer(null);
    this.manager.reset(new GameSummaryScreen({
      view: this.boxScoreView(state, 'FINAL'),
      final: true,
      onDone: () => this.finishGameSummary(),
    }));
    this.lastTopName = '';
    this.syncInput();
  }

  /** Fold a finished live game into the season (no-op for exhibitions). */
  private recordResult(state: Readonly<GameState>): void {
    const spec = this.active;
    if (!spec || spec.mode !== 'season') return;
    const box: StoredBoxScore = {
      gameId: spec.gameId,
      week: spec.week,
      stats: state.stats,
      simmed: false,
    };
    this.services.recordPlayedGame(box, state.quarter > 4);
  }

  // --- play calling ---------------------------------------------------------

  private openPlayCall(side: 'offense' | 'defense'): void {
    const session = this.session;
    if (!session) return;
    const screen = new PlayCallScreen(this.playCallRequest(session, side));
    this.playCallScreen = screen;
    this.manager.push(screen);
    this.lastTopName = '';
    this.syncInput();
  }

  private playCallRequest(session: GameSession, side: 'offense' | 'defense'): PlayCallRequest {
    const s = session.state;
    const user = s.config.userTeam ?? 0;
    const spec = this.active;
    const team = spec?.teams.find((t) => t.identity.id === s.rosters[user].abbrev);
    return {
      side,
      groups: side === 'offense' ? offenseGroups(s) : defenseGroups(s),
      situation: situationOf(s),
      colors: team?.identity.colors ?? s.rosters[user].colors,
      suggest: () => session.suggestFor(user, side, 3),
      onSelect: (playId) => session.selectPlay(playId),
      onTimeout: () => this.requestTimeout(),
    };
  }

  // --- GameServicesHost -----------------------------------------------------

  exitToMainMenu(): void {
    this.leaveGame();
    this.manager.reset(new MainMenuScreen());
    this.lastTopName = '';
    this.syncInput();
  }

  private leaveGame(): void {
    this.disposeSession();
    this.services.setActiveTeams(null);
    this.active = null;
  }

  openPause(): void {
    if (!this.session || this.manager.has('pause')) return;
    this.session.pause();
    this.pushOverlay(new PauseScreen());
  }

  resumeGame(): void {
    this.session?.resume();
    // PauseScreen pops itself; the prompt stack underneath is untouched.
    this.lastTopName = '';
  }

  quitGame(): void {
    const wasSeason = this.active?.mode === 'season';
    this.leaveGame();
    this.manager.reset(new MainMenuScreen());
    if (wasSeason && this.services.getSeason()) this.manager.push(new SeasonHubScreen());
    this.lastTopName = '';
    this.syncInput();
  }

  restartGame(): void {
    const spec = this.active;
    if (!spec) return;
    this.beginGame({ ...spec, seed: this.newSeed() });
  }

  canRestartGame(): boolean {
    return this.active?.mode === 'exhibition';
  }

  finishGameSummary(): void {
    const wasSeason = this.active?.mode === 'season';
    this.leaveGame();
    this.manager.reset(new MainMenuScreen());
    if (wasSeason && this.services.getSeason()) this.manager.push(new SeasonHubScreen());
    this.lastTopName = '';
    this.syncInput();
  }

  continueFromHalftime(): void {
    this.session?.continueBreak();
  }

  requestTimeout(): void {
    this.session?.requestTimeout();
  }

  canCallTimeout(): boolean {
    return this.session?.canCallTimeout() ?? false;
  }

  timeoutsRemaining(): number {
    const session = this.session;
    if (!session) return 0;
    const user = session.userTeam;
    return user === null ? 0 : session.state.timeouts[user];
  }

  onSettingsChanged(settings: SettingsSave): void {
    this.settings = settings;
    this.input.setOverrides(settings.bindings);
    this.session?.setSettings(settings);
  }

  onSeasonChanged(): void {
    // Screens re-read the services on re-entry; nothing cached here.
  }
}

// ---------------------------------------------------------------------------
// Playbook -> play-call cards
// ---------------------------------------------------------------------------

function prettyFormation(id: string): string {
  return id.replace(/[-_]/g, ' ').toUpperCase();
}

function offenseCard(play: OffensivePlayDef): PlayCardInfo {
  return {
    playId: play.id,
    name: play.name,
    tags: play.tags,
    play,
    formation: getFormation(play.formationId),
  };
}

function defenseCard(play: DefensivePlayDef): PlayCardInfo {
  return {
    playId: play.id,
    name: play.name,
    tags: play.tags,
    defense: play,
    formation: getFormation(play.formationId),
    subtitle: play.shell.toUpperCase(),
  };
}

function groupBy<T>(
  plays: readonly T[],
  keyOf: (p: T) => string,
  card: (p: T) => PlayCardInfo,
): PlayCallGroup[] {
  const byKey = new Map<string, PlayCallGroup>();
  for (const play of plays) {
    const key = keyOf(play);
    let group = byKey.get(key);
    if (!group) {
      group = {
        id: key,
        label: prettyFormation(key),
        personnel: getFormation(key)?.personnelLabel,
        cards: [],
      };
      byKey.set(key, group);
    }
    group.cards.push(card(play));
  }
  return [...byKey.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function offenseGroups(s: Readonly<GameState>): PlayCallGroup[] {
  const all = allOffensivePlays();
  const kind = s.nextPlayKind;
  if (kind === 'kickoff' || kind === 'freeKick') {
    return groupBy(all.filter((p) => p.type === 'kickoff'), (p) => p.formationId, offenseCard);
  }
  if (kind === 'pat') {
    return groupBy(
      all.filter((p) => p.type === 'extraPoint' || p.type === 'twoPoint'),
      (p) => p.formationId, offenseCard,
    );
  }
  return groupBy(all.filter((p) => !SPECIAL_TYPES.has(p.type)), (p) => p.formationId, offenseCard);
}

export function defenseGroups(s: Readonly<GameState>): PlayCallGroup[] {
  const all = allDefensivePlays();
  const offType = s.selectedOffensePlayId === null
    ? undefined
    : getOffensivePlay(s.selectedOffensePlayId)?.type;
  const special = s.nextPlayKind === 'kickoff' || s.nextPlayKind === 'freeKick'
    || s.nextPlayKind === 'pat'
    || offType === 'punt' || offType === 'fieldGoal'
    || offType === 'extraPoint' || offType === 'twoPoint';
  const pool = all.filter((p) => (p.shell === 'specialTeams') === special);
  const usable = pool.length > 0 ? pool : all;
  return groupBy(usable, (p) => p.formationId, defenseCard);
}

export function situationOf(s: Readonly<GameState>): PlayCallSituation {
  const dir = s.attackDir[s.possession];
  return {
    down: s.down,
    toGo: s.toGo,
    goalToGo: isGoalToGo(s.ballOnY, s.toGo, dir),
    ballOnY: s.ballOnY,
    quarter: s.quarter,
    clockSec: s.clockSec,
    playClockSec: s.playClockSec,
    score: [s.score[0], s.score[1]],
    possession: s.possession,
    timeouts: [s.timeouts[0], s.timeouts[1]],
    homeAbbrev: s.rosters[0].abbrev,
    awayAbbrev: s.rosters[1].abbrev,
  };
}

function nullKeySource(): KeyEventSource {
  return { addEventListener: () => {}, removeEventListener: () => {} };
}
