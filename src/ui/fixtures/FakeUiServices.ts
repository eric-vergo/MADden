// A complete UiServices implementation backed by fixtures, so every screen can
// be exercised without the sim, the meta layer, or a save file. Used by
// ui-demo.html and by tests that need service-shaped data.

import { NullAudioEngine, type AudioEngine } from '../../audio/AudioEngine';
import { DEFAULT_SETTINGS, isSettingsSave, type SettingsSave } from '../../save/schemas';
import { clearData, loadData, saveData, type StorageLike } from '../../save/storage';
import type { GameStats, Position, TeamSide } from '../../sim/types';
import type {
  ConferenceName, PlayerSeasonStats, PlayoffBracket, ScheduledGame, SeasonState,
  StandingRow, StoredBoxScore, Team, TeamIdentity,
} from '../../meta/types';
import { Rng, hashSeed } from '../../sim/rng';
import { formatRecord, shortName } from '../format';
import { buildConferenceSeeds, impactScore } from '../tables';
import type {
  BoxScoreView, ChampionInfo, ExhibitionSetup, NextGameView, SeasonSetup,
  StarPlayer, UiServices, WeekGameView,
} from '../UiServices';
import {
  accumulateSeasonStats, computeStandings, makeFakeBoxScore, makeFakeLeague,
  makeFakeSchedule, simulateResult,
} from './fakeLeague';
import { TEAM_IDENTITIES } from './teamIdentities';

export interface FakeUiHooks {
  onStartExhibition?: (setup: ExhibitionSetup) => void;
  onStartSeason?: (setup: SeasonSetup) => void;
  onPlayUserGame?: () => void;
  onResumeGame?: () => void;
  onQuitGame?: () => void;
  onRestartGame?: () => void;
  onExitToMainMenu?: () => void;
  onFinishSummary?: () => void;
  onContinueHalftime?: () => void;
  onTimeout?: () => void;
}

export interface FakeUiOptions {
  seed?: number;
  audio?: AudioEngine;
  storage?: StorageLike;
  hooks?: FakeUiHooks;
  /** Start with a season already in progress (demo convenience). */
  preloadSeason?: { userTeamId: string; throughWeek: number };
}

const REGULAR_WEEKS = 14;

export class FakeUiServices implements UiServices {
  readonly audio: AudioEngine;

  private readonly seed: number;
  private readonly hooks: FakeUiHooks;
  private readonly storage: StorageLike | undefined;
  private settings: SettingsSave;
  private season: SeasonState | null = null;
  private boxScores = new Map<string, StoredBoxScore>();
  private timeouts = 3;
  private exhibition = false;

  constructor(opts: FakeUiOptions = {}) {
    this.seed = opts.seed ?? 20260831;
    this.audio = opts.audio ?? new NullAudioEngine();
    this.hooks = opts.hooks ?? {};
    this.storage = opts.storage ?? detectStorage();
    this.settings = loadData('settings', isSettingsSave, this.storage) ?? { ...DEFAULT_SETTINGS };
    if (opts.preloadSeason) {
      this.startNewSeason({
        userTeamId: opts.preloadSeason.userTeamId,
        difficulty: this.settings.defaultDifficulty,
        quarterMinutes: this.settings.quarterMinutes,
      });
      for (let w = 1; w < opts.preloadSeason.throughWeek; w++) {
        this.simUserGame();
        this.simWeek();
      }
    }
  }

  // --- league --------------------------------------------------------------

  private league(): Team[] {
    if (this.season) return this.season.league.teams;
    if (!this.cachedLeague) this.cachedLeague = makeFakeLeague(this.seed).teams;
    return this.cachedLeague;
  }

  private cachedLeague: Team[] | null = null;

  getTeams(): readonly Team[] {
    return this.league();
  }

  getTeam(teamId: string): Team | undefined {
    return this.league().find((t) => t.identity.id === teamId);
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
      let bestKey: keyof typeof a.ratings = 'spd';
      let bestVal = -1;
      for (const key of Object.keys(a.ratings).sort() as Array<keyof typeof a.ratings>) {
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

  private athlete(athleteId: string) {
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

  // --- settings ------------------------------------------------------------

  loadSettings(): SettingsSave {
    return { ...this.settings };
  }

  saveSettings(settings: SettingsSave): void {
    this.settings = { ...settings };
    saveData('settings', this.settings, this.storage);
  }

  hasSeasonSave(): boolean {
    return this.season !== null;
  }

  saveSummary(): string | null {
    if (!this.season) return null;
    const team = this.getTeam(this.season.userTeamId);
    const row = this.getStandings().find((r) => r.teamId === this.season?.userTeamId);
    const record = row ? formatRecord(row.w, row.l, row.t) : '0-0';
    const name = team ? `${team.identity.city} ${team.identity.nickname}` : this.season.userTeamId;
    return `${name.toUpperCase()} · SEASON ${this.season.league.seasonIndex + 1} · WEEK ${this.season.currentWeek} · ${record}`;
  }

  resetAllSaves(): void {
    this.season = null;
    this.boxScores = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
    clearData('settings', this.storage);
    clearData('season', this.storage);
  }

  // --- flow ----------------------------------------------------------------

  startExhibition(setup: ExhibitionSetup): void {
    this.exhibition = true;
    this.timeouts = 3;
    this.hooks.onStartExhibition?.(setup);
  }

  startNewSeason(setup: SeasonSetup): void {
    const league = makeFakeLeague(this.seed, 0);
    const schedule = makeFakeSchedule(league.teams.map((t) => t.identity.id), 0);
    this.season = {
      league,
      userTeamId: setup.userTeamId,
      difficulty: setup.difficulty,
      schedule,
      currentWeek: 1,
      phase: 'regular',
      bracket: null,
      seasonStats: {},
      recentBoxScores: [],
      champion: null,
    };
    this.boxScores = new Map();
    this.exhibition = false;
    this.hooks.onStartSeason?.(setup);
  }

  continueSeason(): void {
    if (this.season) return;
    this.startNewSeason({
      userTeamId: TEAM_IDENTITIES[0]?.id ?? 'ASH',
      difficulty: this.settings.defaultDifficulty,
      quarterMinutes: this.settings.quarterMinutes,
    });
  }

  exitToMainMenu(): void {
    this.hooks.onExitToMainMenu?.();
  }

  // --- season hub ----------------------------------------------------------

  getSeason(): SeasonState | null {
    return this.season;
  }

  getStandings(): readonly StandingRow[] {
    if (!this.season) return [];
    const identityOf = (id: string): TeamIdentity | undefined => TEAM_IDENTITIES.find((t) => t.id === id);
    return computeStandings(
      this.season.league.teams.map((t) => t.identity.id),
      this.allGames(),
      identityOf,
    );
  }

  private allGames(): ScheduledGame[] {
    if (!this.season) return [];
    return [...this.season.schedule, ...(this.season.bracket?.games ?? [])];
  }

  private weekGames(week: number): ScheduledGame[] {
    return this.allGames().filter((g) => g.week === week);
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
    const games = this.weekGames(season.currentWeek);
    if (games.length === 0) return null;
    const userGame = games.find((g) => g.homeId === season.userTeamId || g.awayId === season.userTeamId);
    const views = games.map((g) => this.toWeekView(g))
      .sort((a, b) => (a.isUserGame === b.isUserGame ? 0 : a.isUserGame ? -1 : 1));
    const standings = this.getStandings();
    const recordOf = (teamId: string): string => {
      const row = standings.find((r) => r.teamId === teamId);
      return row ? formatRecord(row.w, row.l, row.t) : '0-0';
    };
    const target = userGame ?? games[0];
    if (!target) return null;
    const userIsHome = target.homeId === season.userTeamId;
    const opponentId = userIsHome ? target.awayId : target.homeId;
    return {
      week: season.currentWeek,
      game: target,
      opponentId,
      userIsHome,
      userRecord: recordOf(season.userTeamId),
      opponentRecord: recordOf(opponentId),
      userGameResolved: userGame === undefined || userGame.result !== undefined,
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

  getBoxScoreView(gameId: string): BoxScoreView | null {
    const stored = this.boxScores.get(gameId);
    if (!stored) return null;
    const game = this.allGames().find((g) => g.id === gameId);
    if (!game) return null;
    return this.makeBoxScoreView(gameId, game.homeId, game.awayId, stored.stats, `WEEK ${stored.week} FINAL`, stored.simmed);
  }

  /** Exposed for the demo: wrap any GameStats in a view. */
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
      homeColors: home?.identity.colors ?? { primary: '#1B3A6B', secondary: '#E8B93E' },
      awayColors: away?.identity.colors ?? { primary: '#8A1C1C', secondary: '#E8B93E' },
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
    const final = this.allGames().find((g) => g.week === 17);
    const r = final?.result;
    const scoreLine = final && r
      ? `${final.awayId} ${r.awayScore} — ${final.homeId} ${r.homeScore}${r.ot ? ' (OT)' : ''}`
      : '';
    return {
      teamId: season.champion,
      teamName: this.teamName(season.champion).toUpperCase(),
      colors: team?.identity.colors ?? { primary: '#E8B93E', secondary: '#1B3A6B' },
      seasonLabel: `SEASON ${season.league.seasonIndex + 1}`,
      scoreLine,
      awards: this.buildAwards(),
    };
  }

  private buildAwards(): ChampionInfo['awards'] {
    const stats = this.getSeasonStats();
    const ids = Object.keys(stats).sort();
    let mvp = '';
    let best = -1;
    for (const id of ids) {
      const p = stats[id];
      if (!p) continue;
      const score = impactScore(p);
      if (score > best) { best = score; mvp = id; }
    }
    if (mvp === '') return [];
    const p = stats[mvp];
    const detail = p ? `${p.passYds} pass · ${p.rushYds} rush · ${p.recYds} rec` : '';
    return [{ label: 'MVP', name: this.playerName(mvp), detail }];
  }

  playUserGame(): void {
    this.timeouts = 3;
    if (this.hooks.onPlayUserGame) {
      this.hooks.onPlayUserGame();
      return;
    }
    this.simUserGame();
  }

  simUserGame(): void {
    const season = this.season;
    if (!season) return;
    const game = this.weekGames(season.currentWeek)
      .find((g) => g.homeId === season.userTeamId || g.awayId === season.userTeamId);
    if (!game || game.result !== undefined) return;
    this.resolve(game);
  }

  simWeek(): void {
    const season = this.season;
    if (!season) return;
    for (const game of this.weekGames(season.currentWeek)) {
      if (game.result === undefined) this.resolve(game);
    }
    this.advanceWeek();
  }

  private resolve(game: ScheduledGame): void {
    const season = this.season;
    if (!season) return;
    const home = this.getTeam(game.homeId);
    const away = this.getTeam(game.awayId);
    if (!home || !away) return;
    let result = simulateResult(game, season.league.teams, this.seed);
    if (game.week >= 15 && result.homeScore === result.awayScore) {
      result = { ...result, homeScore: result.homeScore + 3, ot: true };
    }
    game.result = result;
    const stats = makeFakeBoxScore(game.id, home, away, result, this.seed);
    const stored: StoredBoxScore = { gameId: game.id, week: game.week, stats, simmed: true };
    this.boxScores.set(game.id, stored);
    season.recentBoxScores = [stored, ...season.recentBoxScores].slice(0, 16);
    accumulateSeasonStats(season.seasonStats, stats, (athleteId) => athleteId.split('-')[0] ?? '');
  }

  private advanceWeek(): void {
    const season = this.season;
    if (!season) return;
    season.currentWeek += 1;
    if (season.currentWeek === REGULAR_WEEKS + 1 && season.bracket === null) {
      season.phase = 'playoffs';
      season.bracket = this.seedBracket();
    } else if (season.currentWeek === 16 || season.currentWeek === 17) {
      this.extendBracket(season.currentWeek);
    } else if (season.currentWeek > 17) {
      season.phase = 'complete';
      season.currentWeek = 17;
      const final = this.allGames().find((g) => g.week === 17);
      const r = final?.result;
      if (final && r) season.champion = r.homeScore > r.awayScore ? final.homeId : final.awayId;
    }
  }

  private seedBracket(): PlayoffBracket {
    const standings = this.getStandings();
    const conferences: ConferenceName[] = ['Atlantic', 'Pacific'];
    const seeds: PlayoffBracket['seeds'] = [];
    const games: ScheduledGame[] = [];
    for (const conf of conferences) {
      const ids = buildConferenceSeeds(TEAM_IDENTITIES, standings, conf);
      ids.forEach((teamId, i) => seeds.push({ teamId, seed: i + 1, conference: conf }));
      const [one, two, three, four] = ids;
      if (one && four) games.push(this.mkGame(15, one, four));
      if (two && three) games.push(this.mkGame(15, two, three));
    }
    return { seeds, games };
  }

  private extendBracket(week: number): void {
    const season = this.season;
    if (!season?.bracket) return;
    const prev = season.bracket.games.filter((g) => g.week === week - 1);
    const winners = prev
      .map((g) => (g.result === undefined ? null : g.result.homeScore > g.result.awayScore ? g.homeId : g.awayId))
      .filter((id): id is string => id !== null);
    if (winners.length < 2) return;
    if (week === 16) {
      for (const conf of ['Atlantic', 'Pacific'] as ConferenceName[]) {
        const inConf = winners.filter((id) => TEAM_IDENTITIES.find((t) => t.id === id)?.conference === conf);
        const [a, b] = inConf;
        if (a && b) season.bracket.games.push(this.mkGame(16, a, b));
      }
    } else if (week === 17) {
      const [a, b] = winners;
      if (a && b) season.bracket.games.push(this.mkGame(17, a, b));
    }
  }

  private mkGame(week: number, homeId: string, awayId: string): ScheduledGame {
    const index = this.season?.league.seasonIndex ?? 0;
    return {
      id: `S${index + 1}-W${String(week).padStart(2, '0')}-${awayId}@${homeId}`,
      week,
      homeId,
      awayId,
    };
  }

  startNextSeason(): void {
    const season = this.season;
    if (!season) return;
    const nextIndex = season.league.seasonIndex + 1;
    const league = makeFakeLeague(hashSeed(this.seed, 'season', nextIndex), nextIndex);
    this.season = {
      league,
      userTeamId: season.userTeamId,
      difficulty: season.difficulty,
      schedule: makeFakeSchedule(league.teams.map((t) => t.identity.id), nextIndex),
      currentWeek: 1,
      phase: 'regular',
      bracket: null,
      seasonStats: {},
      recentBoxScores: [],
      champion: null,
    };
    this.boxScores = new Map();
  }

  saveAndExit(): void {
    if (this.season) saveData('season', this.season, this.storage);
  }

  // --- in-game hooks -------------------------------------------------------

  resumeGame(): void {
    this.hooks.onResumeGame?.();
  }

  quitGame(): void {
    this.hooks.onQuitGame?.();
  }

  restartGame(): void {
    this.hooks.onRestartGame?.();
  }

  canRestartGame(): boolean {
    return this.exhibition;
  }

  requestTimeout(): void {
    if (this.timeouts > 0) this.timeouts -= 1;
    this.hooks.onTimeout?.();
  }

  timeoutsRemaining(): number {
    return this.timeouts;
  }

  continueFromHalftime(): void {
    this.hooks.onContinueHalftime?.();
  }

  finishGameSummary(): void {
    this.hooks.onFinishSummary?.();
  }

  /** Demo helper: deterministic sub-stream for fabricating one-off fixtures. */
  rngFor(label: string): Rng {
    return new Rng(hashSeed(this.seed, label));
  }
}

/**
 * The real localStorage in a browser, an in-memory stand-in anywhere else.
 * (Node exposes a `localStorage` global that throws on use unless web storage
 * is enabled, so storage.ts's own fallback is not enough here.)
 */
function detectStorage(): StorageLike {
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

function roundLabel(week: number): string {
  if (week <= REGULAR_WEEKS) return `WEEK ${week}`;
  if (week === 15) return 'CONFERENCE SEMIFINALS';
  if (week === 16) return 'CONFERENCE CHAMPIONSHIPS';
  return 'APEX BOWL';
}
