// Versioned localStorage wrapper with migration hooks and corruption quarantine.
// Only App / SeasonHub / Settings call this layer — never the sim.

import { SAVE_VERSION, type SaveEnvelope } from './schemas';

export type SaveKey = 'settings' | 'season';

const NS = 'madden:';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Migrates a payload from version v to v+1. */
export type Migration = (old: unknown) => unknown;

const MIGRATIONS: Record<SaveKey, Record<number, Migration>> = {
  settings: {},
  season: {},
};

function defaultStorage(): StorageLike | null {
  try {
    const g = globalThis as { localStorage?: StorageLike };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveData<T>(key: SaveKey, data: T, storage?: StorageLike): boolean {
  const store = storage ?? defaultStorage();
  if (!store) return false;
  const envelope: SaveEnvelope<T> = { v: SAVE_VERSION, savedAt: Date.now(), data };
  try {
    store.setItem(NS + key, JSON.stringify(envelope));
    return true;
  } catch {
    return false; // quota or serialization failure
  }
}

export function loadData<T>(
  key: SaveKey,
  validate: (d: unknown) => d is T,
  storage?: StorageLike,
): T | null {
  const store = storage ?? defaultStorage();
  if (!store) return null;
  const raw = store.getItem(NS + key);
  if (raw === null) return null;
  let envelope: SaveEnvelope<unknown>;
  try {
    envelope = JSON.parse(raw) as SaveEnvelope<unknown>;
  } catch {
    quarantine(store, key, raw);
    return null;
  }
  if (typeof envelope !== 'object' || envelope === null || typeof envelope.v !== 'number') {
    quarantine(store, key, raw);
    return null;
  }
  if (envelope.v > SAVE_VERSION) {
    quarantine(store, key, raw); // future version — refuse rather than mangle
    return null;
  }
  let data = envelope.data;
  for (let v = envelope.v; v < SAVE_VERSION; v++) {
    const migrate = MIGRATIONS[key][v];
    if (!migrate) {
      quarantine(store, key, raw);
      return null;
    }
    try {
      data = migrate(data);
    } catch {
      quarantine(store, key, raw);
      return null;
    }
  }
  if (!validate(data)) {
    quarantine(store, key, raw);
    return null;
  }
  return data;
}

export function clearData(key: SaveKey, storage?: StorageLike): void {
  const store = storage ?? defaultStorage();
  store?.removeItem(NS + key);
}

export function hasData(key: SaveKey, storage?: StorageLike): boolean {
  const store = storage ?? defaultStorage();
  return store ? store.getItem(NS + key) !== null : false;
}

function quarantine(store: StorageLike, key: SaveKey, raw: string): void {
  try {
    store.setItem(NS + key + '.corrupt', raw);
    store.removeItem(NS + key);
  } catch {
    // best effort
  }
}
