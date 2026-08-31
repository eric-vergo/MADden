// The ONLY seam between the UI screens and the rest of the game. Screens import
// types from sim/meta but never their logic — everything behavioural goes
// through this interface. Phase 2 integration implements it against the real
// App/GameSession/league; FakeUiServices implements it against fixtures so
// every screen renders standalone in ui-demo.html.

import type { AudioEngine } from '../audio/AudioEngine';
import type {
  DefensivePlayDef, Difficulty, FormationDef, GameStats, OffensivePlayDef,
  PendingPenaltyDecision, Position, RatingKey, TeamColors, TeamSide,
} from '../sim/types';
import type {
  PlayerSeasonStats, PlayoffBracket, ScheduledGame, SeasonState, StandingRow,
  Team, TeamIdentity,
} from '../meta/types';
import type { SettingsSave } from '../save/schemas';

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

export interface StarPlayer {
  athleteId: string;
  name: string; // "M. Ellsworth"
  fullName: string;
  pos: Position;
  jersey: number;
  overall: number;
  signatureKey: RatingKey;
  signatureValue: number;
}

export interface ExhibitionSetup {
  awayTeamId: string;
  homeTeamId: string;
  difficulty: Difficulty;
  quarterMinutes: 3 | 5 | 7;
}

export interface SeasonSetup {
  userTeamId: string;
  difficulty: Difficulty;
  quarterMinutes: 3 | 5 | 7;
}

export interface WeekGameView {
  game: ScheduledGame;
  awayAbbrev: string;
  homeAbbrev: string;
  awayName: string;
  homeName: string;
  isUserGame: boolean;
  /** "W 27-20", "L 13-24", "T 20-20" from the user's perspective; '' if unplayed. */
  userResult: string;
  scoreLine: string; // "ASH 27 — OAK 20" or "" when unplayed
}

export interface NextGameView {
  week: number;
  game: ScheduledGame;
  opponentId: string;
  userIsHome: boolean;
  userRecord: string;
  opponentRecord: string;
  /** True once the user's game this week has a result (SIM WEEK becomes legal). */
  userGameResolved: boolean;
  /** Every game in the current week, user game first. */
  weekGames: WeekGameView[];
  roundLabel: string; // "WEEK 7", "CONFERENCE SEMIFINAL", "APEX BOWL"
}

export interface BoxScoreView {
  gameId: string;
  stats: GameStats;
  homeAbbrev: string;
  awayAbbrev: string;
  homeName: string;
  awayName: string;
  homeColors: TeamColors;
  awayColors: TeamColors;
  /** Which side an athlete played for in THIS game. */
  teamOf: (athleteId: string) => TeamSide;
  nameOf: (athleteId: string) => string;
  posOf: (athleteId: string) => Position;
  simmed: boolean;
  label: string; // "WEEK 7 FINAL"
}

export interface ChampionAward {
  label: string;
  name: string;
  detail: string;
}

export interface ChampionInfo {
  teamId: string;
  teamName: string;
  colors: TeamColors;
  seasonLabel: string;
  scoreLine: string;
  awards: ChampionAward[];
}

// --- Play calling -----------------------------------------------------------

export interface PlayCardInfo {
  playId: string;
  name: string;
  tags: readonly string[];
  /** Offense: the def the mini diagram is drawn from. */
  play?: OffensivePlayDef;
  /** Defense: shown instead of a route diagram. */
  defense?: DefensivePlayDef;
  formation?: FormationDef;
  subtitle?: string;
}

export interface PlayCallGroup {
  id: string;
  label: string;
  personnel?: string;
  cards: PlayCardInfo[];
}

export interface PlayCallSituation {
  down: number;
  toGo: number;
  goalToGo: boolean;
  ballOnY: number;
  quarter: number;
  clockSec: number;
  playClockSec: number;
  score: readonly [number, number];
  possession: TeamSide;
  timeouts: readonly [number, number];
  homeAbbrev: string;
  awayAbbrev: string;
}

export interface PlayCallRequest {
  side: 'offense' | 'defense';
  groups: PlayCallGroup[];
  situation: PlayCallSituation;
  colors: TeamColors;
  /** Ask Coach: up to 3 situation-appropriate play ids. */
  suggest: () => string[];
  onSelect: (playId: string) => void;
  onTimeout?: () => void;
}

export interface PenaltyPromptRequest {
  decision: PendingPenaltyDecision;
  abbrevs: readonly [string, string];
  offenderName?: string;
  offenderJersey?: number;
  /** Auto-pick countdown in seconds; 0 disables the timer. */
  autoPickSeconds: number;
  onDecide: (choice: 'accept' | 'decline') => void;
}

// ---------------------------------------------------------------------------
// The service surface
// ---------------------------------------------------------------------------

export interface UiServices {
  readonly audio: AudioEngine;

  // --- League / teams ---
  getTeams(): readonly Team[];
  getTeam(teamId: string): Team | undefined;
  getIdentities(): readonly TeamIdentity[];
  getTopStars(teamId: string, count?: number): StarPlayer[];
  playerName(athleteId: string): string;

  // --- Settings & persistence ---
  loadSettings(): SettingsSave;
  saveSettings(settings: SettingsSave): void;
  hasSeasonSave(): boolean;
  /** One-line footer, e.g. "ASHFORD · SEASON 1 · WEEK 7 · 5-1". */
  saveSummary(): string | null;
  resetAllSaves(): void;

  // --- Flow out of the menus ---
  startExhibition(setup: ExhibitionSetup): void;
  startNewSeason(setup: SeasonSetup): void;
  continueSeason(): void;
  exitToMainMenu(): void;

  // --- Season hub ---
  getSeason(): SeasonState | null;
  getStandings(): readonly StandingRow[];
  getNextGame(): NextGameView | null;
  getUserSchedule(): readonly WeekGameView[];
  getBracket(): PlayoffBracket | null;
  getSeasonStats(): Readonly<Record<string, PlayerSeasonStats>>;
  getBoxScoreView(gameId: string): BoxScoreView | null;
  getChampionInfo(): ChampionInfo | null;
  playUserGame(): void;
  simUserGame(): void;
  simWeek(): void;
  startNextSeason(): void;
  saveAndExit(): void;

  // --- In-game hooks (Pause / penalty / halftime / summary) ---
  resumeGame(): void;
  quitGame(): void;
  restartGame(): void;
  canRestartGame(): boolean;
  requestTimeout(): void;
  timeoutsRemaining(): number;
  continueFromHalftime(): void;
  finishGameSummary(): void;
}
