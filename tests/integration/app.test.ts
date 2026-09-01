// The App module has to be importable outside a browser (no DOM work at module
// scope), and its playbook-to-play-call mapping is pure enough to test directly.

import { describe, expect, it } from 'vitest';
import { defenseGroups, offenseGroups, situationOf } from '../../src/app/App';
import { createInitialState } from '../../src/sim/GameSim';
import type { GameConfig } from '../../src/sim/types';
import { testRosters } from './harness';

const CONFIG: GameConfig = {
  quarterLengthSec: 300,
  difficulty: 'pro',
  userTeam: 0,
  allowTies: true,
  penaltiesEnabled: true,
  enableOnside: false,
};

function state() {
  return createInitialState(CONFIG, testRosters(), 99);
}

describe('App play-call mapping', () => {
  it('offers only kickoff plays when a kickoff is due', () => {
    const s = state();
    s.nextPlayKind = 'kickoff';
    const groups = offenseGroups(s);
    expect(groups.length).toBeGreaterThan(0);
    const ids = groups.flatMap((g) => g.cards.map((c) => c.playId));
    expect(ids.length).toBeGreaterThan(0);
    for (const g of groups) for (const c of g.cards) expect(c.play?.type).toBe('kickoff');
  });

  it('offers the try plays for a point after', () => {
    const s = state();
    s.nextPlayKind = 'pat';
    const types = offenseGroups(s).flatMap((g) => g.cards.map((c) => c.play?.type));
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) expect(['extraPoint', 'twoPoint']).toContain(t);
  });

  it('offers the normal playbook on a normal down, grouped by formation', () => {
    const s = state();
    s.nextPlayKind = 'normal';
    const groups = offenseGroups(s);
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) {
      expect(g.cards.length).toBeGreaterThan(0);
      expect(g.label).toBe(g.label.toUpperCase());
      for (const c of g.cards) {
        expect(c.play).toBeTruthy();
        expect(['kickoff', 'extraPoint', 'twoPoint']).not.toContain(c.play?.type);
      }
    }
    // Groups are sorted, so the cursor lands in the same place every snap.
    const ids = groups.map((g) => g.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('swaps the defense to special teams for a kickoff', () => {
    const s = state();
    s.nextPlayKind = 'kickoff';
    const shells = defenseGroups(s).flatMap((g) => g.cards.map((c) => c.defense?.shell));
    expect(shells.length).toBeGreaterThan(0);
    for (const shell of shells) expect(shell).toBe('specialTeams');

    s.nextPlayKind = 'normal';
    const base = defenseGroups(s).flatMap((g) => g.cards.map((c) => c.defense?.shell));
    expect(base.length).toBeGreaterThan(0);
    for (const shell of base) expect(shell).not.toBe('specialTeams');
  });

  it('builds the situation strip from game state', () => {
    const s = state();
    s.down = 3;
    s.toGo = 7;
    s.ballOnY = 46;
    s.score = [14, 10];
    const sit = situationOf(s);
    expect(sit.down).toBe(3);
    expect(sit.toGo).toBe(7);
    expect(sit.goalToGo).toBe(false);
    expect(sit.homeAbbrev).toBe(s.rosters[0].abbrev);
    expect(sit.awayAbbrev).toBe(s.rosters[1].abbrev);
    expect(sit.score).toEqual([14, 10]);
  });
});
