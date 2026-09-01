// Focus outlines are drawn in the team accent on a near-black page, so the
// accent picker has to guarantee a readable colour for all 16 identities.

import { describe, expect, it } from 'vitest';
import { accentFor } from '../../src/ui/dom';
import { TEAM_IDENTITIES } from '../../src/ui/fixtures/teamIdentities';

function parse(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const n = Number.parseInt(color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`unparseable colour: ${color}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function luminance(color: string): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = parse(color);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

describe('accentFor', () => {
  it('keeps a bright team colour as-is', () => {
    expect(accentFor({ primary: '#1B3A6B', secondary: '#E8B93E' })).toBe('#E8B93E');
    expect(accentFor({ primary: '#E8B93E', secondary: '#1B3A6B' })).toBe('#E8B93E');
  });

  it('lifts a pair of dark colours instead of returning them raw', () => {
    const accent = accentFor({ primary: '#22252B', secondary: '#9B111E' });
    expect(accent).not.toBe('#9B111E');
    expect(luminance(accent)).toBeGreaterThan(luminance('#9B111E'));
  });

  it('produces a readable accent for every league identity', () => {
    for (const team of TEAM_IDENTITIES) {
      const accent = accentFor(team.colors);
      expect(luminance(accent), `${team.id} accent ${accent}`).toBeGreaterThan(0.16);
    }
  });

  it('never returns the darker of the two colours', () => {
    for (const team of TEAM_IDENTITIES) {
      const accent = luminance(accentFor(team.colors));
      const dark = Math.min(luminance(team.colors.primary), luminance(team.colors.secondary));
      expect(accent).toBeGreaterThanOrEqual(dark);
    }
  });
});
