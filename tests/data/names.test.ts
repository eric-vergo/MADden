import { describe, expect, it } from 'vitest';
import {
  BLOCKED_FULL_NAMES, FIRST_NAMES, LAST_NAMES, MIDDLE_INITIALS,
  NAME_COMBINATIONS, isBlockedName,
} from '../../src/data/names';

describe('name pools', () => {
  it('are big enough to fill a 16-team league without repeating', () => {
    expect(FIRST_NAMES.length).toBeGreaterThanOrEqual(110);
    expect(LAST_NAMES.length).toBeGreaterThanOrEqual(130);
    // 16 teams x 40 players = 640 athletes.
    expect(NAME_COMBINATIONS).toBeGreaterThan(640 * 10);
  });

  it('contain no duplicates and no blank entries', () => {
    expect(new Set(FIRST_NAMES).size).toBe(FIRST_NAMES.length);
    expect(new Set(LAST_NAMES).size).toBe(LAST_NAMES.length);
    for (const n of [...FIRST_NAMES, ...LAST_NAMES]) {
      expect(n.trim()).toBe(n);
      expect(n.length).toBeGreaterThan(1);
    }
  });

  it('stay sorted so generators can index them stably', () => {
    expect([...FIRST_NAMES]).toEqual([...FIRST_NAMES].sort());
    expect([...LAST_NAMES]).toEqual([...LAST_NAMES].sort());
  });

  it('offers disambiguating middle initials', () => {
    expect(MIDDLE_INITIALS.length).toBeGreaterThan(8);
    for (const i of MIDDLE_INITIALS) expect(i).toMatch(/^[A-Z]$/);
  });
});

describe('blocked names', () => {
  it('lists the real players the generator must never spell', () => {
    expect(BLOCKED_FULL_NAMES.size).toBeGreaterThanOrEqual(40);
    for (const n of BLOCKED_FULL_NAMES) {
      expect(n.split(' ').length, n).toBeGreaterThanOrEqual(2);
      expect(n.trim(), n).toBe(n);
    }
  });

  it('cannot be produced by any pool pair', () => {
    // The real guard: adding "Brady" to LAST_NAMES has to fail here.
    const offenders: string[] = [];
    const lasts = new Set(LAST_NAMES);
    for (const blocked of BLOCKED_FULL_NAMES) {
      const idx = blocked.indexOf(' ');
      const first = blocked.slice(0, idx);
      const last = blocked.slice(idx + 1);
      if (FIRST_NAMES.includes(first) && lasts.has(last)) offenders.push(blocked);
    }
    expect(offenders).toEqual([]);
  });

  it('answers isBlockedName for exact matches only', () => {
    expect(isBlockedName('Tom', 'Brady')).toBe(true);
    expect(isBlockedName('Tom', 'Brantley')).toBe(false);
    expect(isBlockedName('Blake', 'Thorne')).toBe(false);
  });
});
