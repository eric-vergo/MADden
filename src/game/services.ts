// The real UiServices: league generation, season persistence, settings, and
// the handful of callbacks that let a DOM screen ask the App to change what the
// game is doing. Screens never see the App directly — this is the whole seam.

import type { AudioEngine } from '../audio/AudioEngine';
import { TEAM_IDENTITIES } from '../data/teams';
import {
  advanceWeek as metaAdvanceWeek,
  createSeason,
  currentWeekGames,
  generateLeague,
  recordUserGame as metaRecordUserGame,
  seasonAwards,
  simMyGame,
  simWeek as metaSimWeek,
  standingsOf,
  startNewSeason as metaStartNextSeason,
  userGame as metaUserGame,
} from '../meta/index';
import { APEX_BOWL_WEEK, CONF_FINAL_WEEK, REGULAR_SEASON_WEEKS, SEMIS_WEEK } from '../meta/index';
import type {
  PlayerSeasonStats, PlayoffBracket, ScheduledGame, SeasonState, StandingRow,
  StoredBoxScore, Team, TeamIdentity,
} from '../meta/types';
import { hashSeed } from '../sim/rng';
import type { Athlete, GameStats, Position, RatingKey, TeamColors, TeamSide } from '../sim/types';
import { DEFAULT_SETTINGS, isSeasonSave, isSettingsSave, type SettingsSave } from '../save/schemas';
import { clearData, loadData, saveData, type StorageLike } from '../save/storage';
import { formatRecord, shortName } from '../ui/format';
import type {
  BoxScoreView, ChampionInfo, ExhibitionSetup, NextGameView, SeasonSetup,
  StarPlayer, UiServices, WeekGameView,
} from '../ui/UiServices';

/** The exhibition league is always the same one, so team ratings are stable. */
export const DEFAULT_LEAGUE_SEED = 20260831;

const NEUTRAL_COLORS: TeamColors = { primary: '#1B3A6B', secondary: '#E8B93E' };

/** Everything the screens can ask the App to do. */
export interface GameServicesHost {
  startExhibition(setup: ExhibitionSetup): void;
  startSeasonGame(): void;
  exitToMainMenu(): void;
  resumeGame(): void;
  quitGame(): void;
  restartGame(): void;
  canRestartGame(): boolean;
  finishGameSummary(): void;
  continueFromHalftime(): void;
  requestTimeout(): void;
  timeoutsRemaining(): number;
  canCallTimeout?(): boolean;
  onSettingsChanged?(settings: SettingsSave): void;
  onSeasonChanged?(season: SeasonState | null): void;
}

export interface GameServicesOptions {
  audio: AudioEngine;
  host: GameServicesHost;
  storage?: StorageLike;
  /** Fresh season seed source; injectable so tests stay deterministic. */
  newSeed?: () => number;
}

function roundLabel(week: number): string {
  if (week <= REGULAR_SEASON_WEEKS) return `WEEK ${week}`;
  if (week === SEMIS_WEEK) return 'CONFERENCE SEMIFINALS';
  if (week === CONF_FINAL_WEEK) return 'CONFERENCE CHAMPIONSHIPS';
  return 'APEX BOWL';
}

/**
 * The real localStorage in a browser, an in-memory stand-in anywhere else.
 * (Node exposes a `localStorage` global that throws unless web storage is on.)
 */
export function detectStorage(): StorageLike {
  try {
    const candidate = (globalThis as { localStorage?: unknown }).localStorage as StorageLike | undefined;
    if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') {
      return candidate;
    }
  } catch {
    // fall through to memory
  }
  return memoryStorage();
}

export function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

export class GameServices implements UiServices {
  readonly audio: AudioEngine;

  private readonly host: GameServicesHost;
  private readonly storage: StorageLike;
  private readonly newSeed: () => number;
  private settings: SettingsSave;
  private season: SeasonState | null;
  private exhibitionLeague: Team[] | null = null;
  /** Teams of the game currently being played — names must resolve to THESE. */
  private activeTeams: readonly Team[] | null = null;

  constructor(opts: GameServicesOptions) {
    this.audio = opts.audio;
    this.host = opts.host;
    this.storage = opts.storage ?? detectStorage();
    this.newSeed = opts.newSeed ?? (() => hashSeed(Date.now(), 'league'));
    this.settings = loadData('settings', isSettingsSave, this.storage) ?? { ...DEFAULT_SETTINGS };
    this.season = loadData('season', isSeasonSave, this.storage);
    this.applyAudioSettings();
  }

  // --- league ---------------------------------------------------------------

  private league(): Team[] {
    if (this.season) return this.season.league.teams;
    if (!this.exhibitionLeague) {
      this.exhibitionLeague = generateLeague(DEFAULT_LEAGUE_SEED, 0).teams;
    }
    return this.exhibitionLeague;
  }

  /** The exhibition league specifically — used when no season is loaded. */
  exhibitionTeams(): readonly Team[] {
    if (!this.exhibitionLeague) {
      this.exhibitionLeague = generateLeague(DEFAULT_LEAGUE_SEED, 0).teams;
    }
    return this.exhibitionLeague;
  }

  /**
   * While an exhibition is in progress the league behind the box score is the
   * fixed exhibition league, not whatever season happens to be loaded.
   */
  setActiveTeams(teams: readonly Team[] | null): void {
    this.activeTeams = teams;
  }

  getTeams(): readonly Team[] {
    return this.league();
  }

  getTeam(teamId: string): Team | undefined {
    return this.activeTeams?.find((t) => t.identity.id === teamId)
      ?? this.league().find((t) => t.identity.id === teamId);
  }

  getIdentities(): readonly TeamIdentity[] {
    return TEAM_IDENTITIES;
  }

  getTopStars(teamId: string, count = 3): StarPlayer[] {
    const team = this.getTeam(teamId);
    if (!team) return [];
    const sorted = [...team.roster.athletes].sort((a, b) => (
      b.overall !== a.overall ? b.overall - a.overall : a.id < b.id ? -1 : 1
    ));
    return sorted.slice(0, count).map((a) => {
      let bestKey: RatingKey = 'spd';
      let bestVal = -1;
      for (const key of Object.keys(a.ratings).sort() as RatingKey[]) {
        const v = a.ratings[key];
        if (v > bestVal) { bestVal = v; bestKey = key; }
      }
      return {
        athleteId: a.id,
        name: shortName(a.firstName, a.lastName),
        fullName: `${a.firstName} ${a.lastName}`,
        pos: a.pos,
        jersey: a.jersey,
        overall: a.overall,
        signatureKey: bestKey,
        signatureValue: bestVal,
      };
    });
  }

  private athlete(athleteId: string): Athlete | undefined {
    for (const team of this.activeTeams ?? []) {
      const found = team.roster.athletes.find((a) => a.id === athleteId);
      if (found) return found;
    }
    for (const team of this.league()) {
      const found = team.roster.athletes.find((a) => a.id === athleteId);
      if (found) return found;
    }
    return undefined;
  }

  playerName(athleteId: string): string {
    const a = this.athlete(athleteId);
    return a ? shortName(a.firstName, a.lastName) : athleteId;
  }

  // --- settings & persistence ----------------------------------------------

  loadSettings(): SettingsSave {
    return { ...this.settings };
  }

  saveSettings(settings: SettingsSave): void {
    this.settings = { ...settings };
    saveData('settings', this.settings, this.storage);
    this.applyAudioSettings();
    this.host.onSettingsChanged?.(this.loadSettings());
  }

  private applyAudioSettings(): void {
    this.audio.setBusVolume('master', this.settings.volMaster / 10);
    this.audio.setBusVolume('sfx', this.settings.volSfx / 10);
    this.audio.setBusVolume('crowd', this.settings.volCrowd / 10);
    this.audio.setBusVolume('ui', this.settings.volSfx / 10);
  }

  hasSeasonSave(): boolean {
    return this.season !== null;
  }

  saveSummary(): string | null {
    const season = this.season;
    if (!season) return null;
    const team = this.getTeam(season.userTeamId);
    const row = this.getStandings().find((r) => r.teamId === season.userTeamId);
    const record = row ? formatRecord(row.w, row.l, row.t) : '0-0';
    const name = team ? `${team.identity.city} ${team.identity.nickname}` : season.userTeamId;
    return `${name.toUpperCase()} · SEASON ${season.league.seasonIndex + 1} · WEEK ${season.currentWeek} · ${record}`;
  }

  resetAllSaves(): void {
    this.season = null;
    this.settings = { ...DEFAULT_SETTINGS };
    clearData('settings', this.storage);
    clearData('season', this.storage);
    this.applyAudioSettings();
    this.host.onSeasonChanged?.(null);
  }

  /** Persist the season if there is one. Safe to call on any beat. */
  save(): void {
    if (this.season) saveData('season', this.season, this.storage);
  }

  // --- flow -----------------------------------------------------------------

  startExhibition(setup: ExhibitionSetup): void {
    this.host.startExhibition(setup);
  }

  startNewSeason(setup: SeasonSetup): void {
    this.settings = { ...this.settings, quarterMinutes: setup.quarterMinutes, defaultDifficulty: setup.difficulty };
    saveData('settings', this.settings, this.storage);
    this.season = createSeason(this.newSeed(), setup.userTeamId, setup.difficulty, 0);
    this.save();
    this.host.onSeasonChanged?.(this.season);
  }

  continueSeason(): void {
    if (this.season) {
      this.host.onSeasonChanged?.(this.season);
      return;
    }
    this.season = loadData('season', isSeasonSave, this.storage);
    this.host.onSeasonChanged?.(this.season);
  }

  exitToMainMenu(): void {
    this.host.exitToMainMenu();
  }

  // --- season hub -----------------------------------------------------------

  getSeason(): SeasonState | null {
    return this.season;
  }

  setSeason(season: SeasonState | null): void {
    this.season = season;
    this.save();
    this.host.onSeasonChanged?.(season);
  }

  getStandings(): readonly StandingRow[] {
    return this.season ? standingsOf(this.season) : [];
  }

  private allGames(): ScheduledGame[] {
    return this.season ? this.season.schedule : [];
  }

  private abbrev(teamId: string): string {
    return teamId;
  }

  private teamName(teamId: string): string {
    const t = this.getTeam(teamId);
    return t ? `${t.identity.city} ${t.identity.nickname}` : teamId;
  }

  private toWeekView(game: ScheduledGame): WeekGameView {
    const userId = this.season?.userTeamId;
    const isUserGame = userId !== undefined && (game.homeId === userId || game.awayId === userId);
    const r = game.result;
    let userResult = '';
    if (r && isUserGame && userId !== undefined) {
      const userIsHome = game.homeId === userId;
      const mine = userIsHome ? r.homeScore : r.awayScore;
      const theirs = userIsHome ? r.awayScore : r.homeScore;
      const tag = mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
      userResult = `${tag} ${mine}-${theirs}`;
    }
    return {
      game,
      awayAbbrev: this.abbrev(game.awayId),
      homeAbbrev: this.abbrev(game.homeId),
      awayName: this.teamName(game.awayId),
      homeName: this.teamName(game.homeId),
      isUserGame,
      userResult,
      scoreLine: r ? `${r.awayScore}-${r.homeScore}${r.ot ? ' OT' : ''}` : '',
    };
  }

  getNextGame(): NextGameView | null {
    const season = this.season;
    if (!season || season.phase === 'complete') return null;
    const games = currentWeekGames(season);
    if (games.length === 0) return null;
    const userGame = metaUserGame(season);
    const views = games.map((g) => this.toWeekView(g))
      .sort((a, b) => (a.isUserGame === b.isUserGame ? 0 : a.isUserGame ? -1 : 1));
    const standings = this.getStandings();
    const recordOf = (teamId: string): string => {
      const row = standings.find((r) => r.teamId === teamId);
      return row ? formatRecord(row.w, row.l, row.t) : '0-0';
    };
    // The user can be out of the week entirely (eliminated from the playoffs).
    // The week still has to be simmable, so a view is returned — but nothing in
    // it may claim some other club's game as the user's matchup.
    const target = userGame ?? games[0];
    if (!target) return null;
    const userIsHome = userGame !== null && target.homeId === season.userTeamId;
    const opponentId = userGame === null ? '' : userIsHome ? target.awayId : target.homeId;
    return {
      week: season.currentWeek,
      game: target,
      opponentId,
      userIsHome,
      userRecord: recordOf(season.userTeamId),
      opponentRecord: opponentId === '' ? '—' : recordOf(opponentId),
      userGameResolved: userGame === null || userGame.result !== undefined,
      weekGames: views,
      roundLabel: roundLabel(season.currentWeek),
    };
  }

  getUserSchedule(): readonly WeekGameView[] {
    const season = this.season;
    if (!season) return [];
    return this.allGames()
      .filter((g) => g.homeId === season.userTeamId || g.awayId === season.userTeamId)
      .sort((a, b) => a.week - b.week)
      .map((g) => this.toWeekView(g));
  }

  getBracket(): PlayoffBracket | null {
    return this.season?.bracket ?? null;
  }

  getSeasonStats(): Readonly<Record<string, PlayerSeasonStats>> {
    return this.season?.seasonStats ?? {};
  }

  private storedBox(gameId: string): StoredBoxScore | undefined {
    return this.season?.recentBoxScores.find((b) => b.gameId === gameId);
  }

  getBoxScoreView(gameId: string): BoxScoreView | null {
    const stored = this.storedBox(gameId);
    if (!stored) return null;
    const game = this.allGames().find((g) => g.id === gameId);
    if (!game) return null;
    return this.makeBoxScoreView(
      gameId, game.homeId, game.awayId, stored.stats,
      `${roundLabel(stored.week)} FINAL`, stored.simmed,
    );
  }

  /** Wrap any GameStats in the view the summary/halftime screens want. */
  makeBoxScoreView(
    gameId: string,
    homeId: string,
    awayId: string,
    stats: GameStats,
    label: string,
    simmed = false,
  ): BoxScoreView {
    const home = this.getTeam(homeId);
    const away = this.getTeam(awayId);
    return {
      gameId,
      stats,
      homeAbbrev: homeId,
      awayAbbrev: awayId,
      homeName: this.teamName(homeId),
      awayName: this.teamName(awayId),
      homeColors: home?.identity.colors ?? NEUTRAL_COLORS,
      awayColors: away?.identity.colors ?? { primary: '#8A1C1C', secondary: '#E8E8E8' },
      teamOf: (athleteId: string): TeamSide => (athleteId.startsWith(`${homeId}-`) ? 0 : 1),
      nameOf: (athleteId: string): string => this.playerName(athleteId),
      posOf: (athleteId: string): Position => this.athlete(athleteId)?.pos ?? 'WR',
      simmed,
      label,
    };
  }

  getChampionInfo(): ChampionInfo | null {
    const season = this.season;
    if (!season || season.champion === null) return null;
    const team = this.getTeam(season.champion);
    const final = this.allGames().find((g) => g.week === APEX_BOWL_WEEK);
    const r = final?.result;
    const scoreLine = final && r
      ? `${final.awayId} ${r.awayScore} — ${final.homeId} ${r.homeScore}${r.ot ? ' (OT)' : ''}`
      : '';
    const awards = seasonAwards(season);
    const mvpId = awards.mvpAthleteId;
    const mvp = mvpId === null ? null : season.seasonStats[mvpId];
    return {
      teamId: season.champion,
      teamName: this.teamName(season.champion).toUpperCase(),
      colors: team?.identity.colors ?? { primary: '#E8B93E', secondary: '#1B3A6B' },
      seasonLabel: `SEASON ${season.league.seasonIndex + 1}`,
      scoreLine,
      awards: mvpId === null || !mvp ? [] : [{
        label: 'MVP',
        name: this.playerName(mvpId),
        detail: `${mvp.passYds} pass · ${mvp.rushYds} rush · ${mvp.recYds} rec`,
      }],
    };
  }

  playUserGame(): void {
    this.host.startSeasonGame();
  }

  simUserGame(): void {
    if (!this.season) return;
    this.season = simMyGame(this.season);
    this.save();
    this.host.onSeasonChanged?.(this.season);
  }

  simWeek(): void {
    if (!this.season) return;
    this.season = metaSimWeek(this.season);
    this.season = metaAdvanceWeek(this.season);
    this.save();
    this.host.onSeasonChanged?.(this.season);
  }

  /** Fold a live-played user game into the season and persist. */
  recordPlayedGame(box: StoredBoxScore, ot: boolean): void {
    if (!this.season) return;
    this.season = metaRecordUserGame(this.season, box, ot);
    this.save();
    this.host.onSeasonChanged?.(this.season);
  }

  startNextSeason(): void {
    if (!this.season) return;
    this.season = metaStartNextSeason(this.season);
    this.save();
    this.host.onSeasonChanged?.(this.season);
  }

  saveAndExit(): void {
    this.save();
  }

  // --- in-game hooks --------------------------------------------------------

  resumeGame(): void {
    this.host.resumeGame();
  }

  quitGame(): void {
    this.host.quitGame();
  }

  restartGame(): void {
    this.host.restartGame();
  }

  canRestartGame(): boolean {
    return this.host.canRestartGame();
  }

  requestTimeout(): void {
    this.host.requestTimeout();
  }

  timeoutsRemaining(): number {
    return this.host.timeoutsRemaining();
  }

  canCallTimeout(): boolean {
    const ask = this.host.canCallTimeout;
    if (ask === undefined) return this.host.timeoutsRemaining() > 0;
    return ask.call(this.host);
  }

  continueFromHalftime(): void {
    this.host.continueFromHalftime();
  }

  finishGameSummary(): void {
    this.host.finishGameSummary();
  }
}
