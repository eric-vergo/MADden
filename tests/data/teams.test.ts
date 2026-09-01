import { describe, expect, it } from 'vitest';
import {
  DIVISIONS, TEAM_IDENTITIES, TEAM_IDS, getTeamIdentity, hueLightness,
  jerseysConflict, teamsInConference, teamsInDivision,
} from '../../src/data/teams';

const HEX = /^#[0-9A-F]{6}$/;

describe('team identities', () => {
  it('has exactly 16 teams', () => {
    expect(TEAM_IDENTITIES.length).toBe(16);
    expect(TEAM_IDS.length).toBe(16);
  });

  it('has unique three-letter ids', () => {
    const ids = TEAM_IDENTITIES.map((t) => t.id);
    expect(new Set(ids).size).toBe(16);
    for (const id of ids) expect(id).toMatch(/^[A-Z]{3}$/);
  });

  it('has unique city/nickname pairs', () => {
    expect(new Set(TEAM_IDENTITIES.map((t) => t.city)).size).toBe(16);
    expect(new Set(TEAM_IDENTITIES.map((t) => t.nickname)).size).toBe(16);
  });

  it('has unique, well-formed colors', () => {
    const primaries = TEAM_IDENTITIES.map((t) => t.colors.primary);
    expect(new Set(primaries).size).toBe(16);
    for (const t of TEAM_IDENTITIES) {
      expect(t.colors.primary, t.id).toMatch(HEX);
      expect(t.colors.secondary, t.id).toMatch(HEX);
      expect(t.colors.primary, t.id).not.toBe(t.colors.secondary);
    }
  });

  it('keeps every primary clear of field green', () => {
    // Field stripes are #3A7D2C / #357029 — hue ~100 deg, mid lightness.
    for (const t of TEAM_IDENTITIES) {
      const { hue, lightness } = hueLightness(t.colors.primary);
      const green = hue > 75 && hue < 160 && lightness > 0.18 && lightness < 0.6;
      expect(green, `${t.id} is field green`).toBe(false);
    }
  });

  it('fills four divisions with four teams each', () => {
    expect(DIVISIONS.length).toBe(4);
    for (const d of DIVISIONS) {
      expect(teamsInDivision(d.conference, d.division).length, `${d.conference} ${d.division}`).toBe(4);
    }
    expect(teamsInConference('Atlantic').length).toBe(8);
    expect(teamsInConference('Pacific').length).toBe(8);
  });

  it('matches the canonical division assignment', () => {
    const ids = (c: 'Atlantic' | 'Pacific', d: 'North' | 'South'): string[] =>
      teamsInDivision(c, d).map((t) => t.id).sort();
    expect(ids('Atlantic', 'North')).toEqual(['ASH', 'BAY', 'COB', 'DUN']);
    expect(ids('Atlantic', 'South')).toEqual(['EMB', 'FAI', 'GRA', 'HAR']);
    expect(ids('Pacific', 'North')).toEqual(['IRO', 'JUN', 'KIN', 'LAK']);
    expect(ids('Pacific', 'South')).toEqual(['MER', 'NOR', 'OAK', 'PAL']);
  });

  it('gives every team a drawable logo spec', () => {
    for (const t of TEAM_IDENTITIES) {
      expect(t.logo.frameColor, t.id).toBe(t.colors.primary);
      expect(t.logo.motifColor, t.id).toBe(t.colors.secondary);
      expect(t.logo.accentColor, t.id).toMatch(HEX);
      expect([1, 2, 3]).toContain(t.logo.motifCount);
      expect(Math.abs(t.logo.rotationDeg), t.id).toBeLessThanOrEqual(180);
    }
  });

  it('matches the design motif table', () => {
    const motifs: Record<string, string> = {
      ASH: 'wing', BAY: 'fang', COB: 'orbit', DUN: 'chevron',
      EMB: 'crest-stripes', FAI: 'wing', GRA: 'initial', HAR: 'fang',
      IRO: 'peak', JUN: 'chevron', KIN: 'claw', LAK: 'fang',
      MER: 'star', NOR: 'wing', OAK: 'star', PAL: 'peak',
    };
    for (const t of TEAM_IDENTITIES) expect(t.logo.motif, t.id).toBe(motifs[t.id]);
  });

  it('looks teams up by id', () => {
    expect(getTeamIdentity('ASH')?.nickname).toBe('Aviators');
    expect(getTeamIdentity('ZZZ')).toBeUndefined();
  });
});

describe('jersey conflict rule', () => {
  it('flags two near-identical primaries', () => {
    expect(jerseysConflict('#22252B', '#2F2F2F')).toBe(true);
  });

  it('does not flag clearly different primaries', () => {
    expect(jerseysConflict('#1B3A6B', '#E8B93E')).toBe(false);
    expect(jerseysConflict('#0E7C86', '#8A1C1C')).toBe(false);
  });

  it('is symmetric and reflexive', () => {
    for (const a of TEAM_IDENTITIES) {
      expect(jerseysConflict(a.colors.primary, a.colors.primary), a.id).toBe(true);
      for (const b of TEAM_IDENTITIES) {
        expect(
          jerseysConflict(a.colors.primary, b.colors.primary),
          `${a.id}/${b.id}`,
        ).toBe(jerseysConflict(b.colors.primary, a.colors.primary));
      }
    }
  });

  it('leaves most matchups conflict-free', () => {
    let conflicts = 0;
    const perTeam = new Map<string, number>();
    for (let i = 0; i < TEAM_IDENTITIES.length; i++) {
      for (let j = i + 1; j < TEAM_IDENTITIES.length; j++) {
        const a = TEAM_IDENTITIES[i]!;
        const b = TEAM_IDENTITIES[j]!;
        if (!jerseysConflict(a.colors.primary, b.colors.primary)) continue;
        conflicts++;
        perTeam.set(a.id, (perTeam.get(a.id) ?? 0) + 1);
        perTeam.set(b.id, (perTeam.get(b.id) ?? 0) + 1);
      }
    }
    // 120 pairs. Dark-on-dark clashes are expected (the away team just wears
    // its secondary); a majority of the league clashing would not be.
    expect(conflicts).toBeLessThan(45);
    for (const [id, n] of perTeam) expect(n, id).toBeLessThanOrEqual(8);
  });
});
