import { describe, expect, it } from 'vitest';
import { isSeasonSave } from '../../src/save/schemas';
import { clearData, hasData, loadData, saveData, type StorageLike } from '../../src/save/storage';
import { REGULAR_SEASON_WEEKS } from '../../src/meta/schedule';
import {
  advanceWeek, createSeason, seasonAwards, simWeek, standingsOf,
} from '../../src/meta/seasonState';
import type { SeasonState } from '../../src/meta/types';

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()].sort();
  }
}

function playWeeks(start: SeasonState, weeks: number): SeasonState {
  let s = start;
  for (let i = 0; i < weeks; i++) s = advanceWeek(simWeek(s));
  return s;
}

describe('season save round-trip', () => {
  it('survives a full serialize/deserialize cycle mid-season', () => {
    const storage = new MemoryStorage();
    const state = playWeeks(createSeason(1234567, 'MER', 'allPro'), 6);

    expect(isSeasonSave(state)).toBe(true);
    expect(saveData('season', state, storage)).toBe(true);
    expect(hasData('season', storage)).toBe(true);

    const loaded = loadData('season', isSeasonSave, storage);
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(state);
    expect(loaded!.currentWeek).toBe(7);
    expect(loaded!.league.teams).toHaveLength(16);
    expect(standingsOf(loaded!)).toEqual(standingsOf(state));
  });

  it('keeps simming correctly from a reloaded state', () => {
    const storage = new MemoryStorage();
    const mid = playWeeks(createSeason(98765, 'KIN', 'pro'), 5);
    saveData('season', mid, storage);
    const loaded = loadData('season', isSeasonSave, storage);
    expect(loaded).not.toBeNull();

    const fromMemory = playWeeks(mid, REGULAR_SEASON_WEEKS - 5);
    const fromDisk = playWeeks(loaded!, REGULAR_SEASON_WEEKS - 5);
    expect(fromDisk.schedule).toEqual(fromMemory.schedule);
    expect(fromDisk.seasonStats).toEqual(fromMemory.seasonStats);
    expect(fromDisk.phase).toBe('playoffs');
  });

  it('round-trips a completed season with a bracket and champion', () => {
    const storage = new MemoryStorage();
    let s = playWeeks(createSeason(555, 'OAK', 'allMadden'), REGULAR_SEASON_WEEKS);
    s = playWeeks(s, 3);
    expect(s.phase).toBe('complete');
    expect(s.champion).not.toBeNull();

    saveData('season', s, storage);
    const loaded = loadData('season', isSeasonSave, storage);
    expect(loaded).toEqual(s);
    expect(loaded!.bracket).not.toBeNull();
    expect(loaded!.bracket!.games).toHaveLength(7);
    expect(seasonAwards(loaded!)).toEqual(seasonAwards(s));
  });

  it('quarantines corrupt data instead of returning it', () => {
    const storage = new MemoryStorage();
    storage.setItem('madden:season', '{not json');
    expect(loadData('season', isSeasonSave, storage)).toBeNull();
    expect(storage.getItem('madden:season')).toBeNull();
    expect(storage.getItem('madden:season.corrupt')).toBe('{not json');
  });

  it('rejects a payload that is not a season', () => {
    const storage = new MemoryStorage();
    saveData('season', { league: { teams: [] }, currentWeek: 1 }, storage);
    expect(loadData('season', isSeasonSave, storage)).toBeNull();
  });

  it('clears cleanly', () => {
    const storage = new MemoryStorage();
    saveData('season', createSeason(1, 'BAY', 'rookie'), storage);
    expect(hasData('season', storage)).toBe(true);
    clearData('season', storage);
    expect(hasData('season', storage)).toBe(false);
  });

  it('serializes to a size a browser will actually accept', () => {
    const storage = new MemoryStorage();
    const s = playWeeks(createSeason(2468, 'LAK', 'pro'), REGULAR_SEASON_WEEKS);
    saveData('season', s, storage);
    const raw = storage.getItem('madden:season');
    expect(raw).not.toBeNull();
    // localStorage quota is ~5MB per origin; stay far under it.
    expect(raw!.length).toBeLessThan(2_000_000);
  });
});
