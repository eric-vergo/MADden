// ★ FROZEN CONTRACT — save envelope + payload shapes + validation guards.

import type { Difficulty } from '../sim/types';
import type { SeasonState } from '../meta/types';
import type { BindingOverrides } from '../input/types';

export const SAVE_VERSION = 1;

export interface SaveEnvelope<T> {
  v: number;
  savedAt: number; // Date.now() — save layer is outside the sim boundary
  data: T;
}

export interface SettingsSave {
  volMaster: number; // 0..10
  volSfx: number;
  volCrowd: number;
  defaultDifficulty: Difficulty;
  quarterMinutes: 3 | 5 | 7;
  coverageHints: 'auto' | 'on' | 'off';
  bindings: BindingOverrides;
}

export type SeasonSave = SeasonState;

export const DEFAULT_SETTINGS: SettingsSave = {
  volMaster: 7,
  volSfx: 8,
  volCrowd: 6,
  defaultDifficulty: 'pro',
  quarterMinutes: 5,
  coverageHints: 'auto',
  bindings: {},
};

// --- Cheap structural guards (hand-written; no runtime deps) ---

export function isSettingsSave(d: unknown): d is SettingsSave {
  if (typeof d !== 'object' || d === null) return false;
  const s = d as Record<string, unknown>;
  return (
    typeof s.volMaster === 'number' &&
    typeof s.volSfx === 'number' &&
    typeof s.volCrowd === 'number' &&
    typeof s.defaultDifficulty === 'string' &&
    typeof s.quarterMinutes === 'number' &&
    typeof s.bindings === 'object' && s.bindings !== null
  );
}

export function isSeasonSave(d: unknown): d is SeasonSave {
  if (typeof d !== 'object' || d === null) return false;
  const s = d as Record<string, unknown>;
  const league = s.league as Record<string, unknown> | undefined;
  return (
    typeof s.userTeamId === 'string' &&
    typeof s.currentWeek === 'number' &&
    typeof s.phase === 'string' &&
    Array.isArray(s.schedule) &&
    typeof league === 'object' && league !== null &&
    Array.isArray(league.teams) && league.teams.length === 16
  );
}
