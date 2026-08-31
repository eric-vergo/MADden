// ★ FROZEN CONTRACT — meta-layer (league/season) types. Pure data.

import type { Difficulty, GameStats, TeamColors, TeamRoster } from '../sim/types';

export type ConferenceName = 'Atlantic' | 'Pacific';
export type DivisionName = 'North' | 'South';

export interface LogoSpec {
  frame: 'shield' | 'circle' | 'hexagon' | 'diamond' | 'roundel';
  motif:
    | 'bolt' | 'star' | 'chevron' | 'wing' | 'fang' | 'claw'
    | 'peak' | 'orbit' | 'crest-stripes' | 'initial' | 'shield-in-shield';
  motifCount: 1 | 2 | 3;
  rotationDeg: number;
  frameColor: string;
  motifColor: string;
  accentColor: string;
}

export interface TeamIdentity {
  id: string; // abbrev, e.g. "ASH"
  city: string;
  nickname: string;
  conference: ConferenceName;
  division: DivisionName;
  colors: TeamColors;
  logo: LogoSpec;
}

/** A full league team = identity + generated roster + cached team ratings. */
export interface Team {
  identity: TeamIdentity;
  roster: TeamRoster;
  ovr: number;
  off: number;
  def: number;
}

export interface LeagueState {
  leagueSeed: number;
  seasonIndex: number; // 0-based
  teams: Team[]; // 16
}

export interface GameResultLite {
  homeScore: number;
  awayScore: number;
  ot: boolean;
}

export interface ScheduledGame {
  id: string; // "S1-W07-ASH@BAY"
  week: number; // 1..14 regular, 15..17 playoffs
  homeId: string;
  awayId: string;
  result?: GameResultLite;
}

export interface StandingRow {
  teamId: string;
  w: number; l: number; t: number;
  pf: number; pa: number;
  divW: number; divL: number;
  confW: number; confL: number;
}

export type SeasonPhase = 'regular' | 'playoffs' | 'complete';

export interface PlayoffSeed {
  teamId: string;
  seed: number; // 1..4 per conference
  conference: ConferenceName;
}

export interface PlayoffBracket {
  seeds: PlayoffSeed[];
  /** Games keyed by round: semis (week 15), conference finals (16), apexBowl (17). */
  games: ScheduledGame[];
}

export interface PlayerSeasonStats {
  athleteId: string;
  teamId: string;
  gamesPlayed: number;
  passAtt: number; passCmp: number; passYds: number; passTD: number; passInt: number;
  rushAtt: number; rushYds: number; rushTD: number; fumbles: number;
  tgt: number; rec: number; recYds: number; recTD: number;
  tackles: number; sacks: number; defInt: number; ffum: number;
  fgm: number; fga: number; xpm: number; xpa: number;
  punts: number; puntYds: number;
  krYds: number; prYds: number; retTD: number;
}

/** Box score stored per completed game (live or quick-simmed). */
export interface StoredBoxScore {
  gameId: string;
  week: number;
  stats: GameStats;
  simmed: boolean;
}

export interface SeasonState {
  league: LeagueState;
  userTeamId: string;
  difficulty: Difficulty;
  schedule: ScheduledGame[];
  currentWeek: number;
  phase: SeasonPhase;
  bracket: PlayoffBracket | null;
  seasonStats: Record<string, PlayerSeasonStats>;
  /** Bounded: user games + latest completed week only. */
  recentBoxScores: StoredBoxScore[];
  champion: string | null;
}
