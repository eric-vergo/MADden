// The 16 canonical CFA team identities. These never change across seasons —
// only the generated rosters behind them do. Colors are authored so no primary
// sits near field green (#3A7D2C) and every primary is distinguishable from
// every other at HUD size.

import type { ConferenceName, DivisionName, TeamIdentity } from '../meta/types';

/** Accent used where a team's secondary is too dark to read as a frame stroke. */
const LIGHT_ACCENT = '#F2F2F2';

export const TEAM_IDENTITIES: readonly TeamIdentity[] = [
  // --- Atlantic North -------------------------------------------------------
  {
    id: 'ASH', city: 'Ashford', nickname: 'Aviators',
    conference: 'Atlantic', division: 'North',
    colors: { primary: '#1B3A6B', secondary: '#E8B93E' },
    logo: {
      frame: 'shield', motif: 'wing', motifCount: 2, rotationDeg: -12,
      frameColor: '#1B3A6B', motifColor: '#E8B93E', accentColor: '#E8B93E',
    },
  },
  {
    id: 'BAY', city: 'Bayport', nickname: 'Barracudas',
    conference: 'Atlantic', division: 'North',
    colors: { primary: '#0E7C86', secondary: '#C0C7CE' },
    logo: {
      frame: 'circle', motif: 'fang', motifCount: 3, rotationDeg: 0,
      frameColor: '#0E7C86', motifColor: '#C0C7CE', accentColor: '#C0C7CE',
    },
  },
  {
    id: 'COB', city: 'Cobalt City', nickname: 'Comets',
    conference: 'Atlantic', division: 'North',
    colors: { primary: '#2244CC', secondary: '#F2F2F2' },
    logo: {
      frame: 'roundel', motif: 'orbit', motifCount: 1, rotationDeg: -20,
      frameColor: '#2244CC', motifColor: '#F2F2F2', accentColor: '#F2F2F2',
    },
  },
  {
    id: 'DUN', city: 'Dunmore', nickname: 'Drifters',
    conference: 'Atlantic', division: 'North',
    colors: { primary: '#5B4A8A', secondary: '#D9D3C2' },
    logo: {
      frame: 'diamond', motif: 'chevron', motifCount: 3, rotationDeg: 0,
      frameColor: '#5B4A8A', motifColor: '#D9D3C2', accentColor: '#D9D3C2',
    },
  },

  // --- Atlantic South -------------------------------------------------------
  {
    id: 'EMB', city: 'Emberton', nickname: 'Emperors',
    conference: 'Atlantic', division: 'South',
    colors: { primary: '#8A1C1C', secondary: '#E8B93E' },
    logo: {
      frame: 'shield', motif: 'crest-stripes', motifCount: 3, rotationDeg: 0,
      frameColor: '#8A1C1C', motifColor: '#E8B93E', accentColor: '#E8B93E',
    },
  },
  {
    id: 'FAI', city: 'Fairhaven', nickname: 'Firehawks',
    conference: 'Atlantic', division: 'South',
    colors: { primary: '#D34E24', secondary: '#26211E' },
    logo: {
      frame: 'hexagon', motif: 'wing', motifCount: 2, rotationDeg: 8,
      frameColor: '#D34E24', motifColor: '#26211E', accentColor: LIGHT_ACCENT,
    },
  },
  {
    id: 'GRA', city: 'Grandview', nickname: 'Gladiators',
    conference: 'Atlantic', division: 'South',
    colors: { primary: '#7A1F3D', secondary: '#B8B8B8' },
    logo: {
      frame: 'shield', motif: 'initial', motifCount: 1, rotationDeg: 0,
      frameColor: '#7A1F3D', motifColor: '#B8B8B8', accentColor: '#B8B8B8',
    },
  },
  {
    id: 'HAR', city: 'Harborview', nickname: 'Hammerheads',
    conference: 'Atlantic', division: 'South',
    colors: { primary: '#4A6FA5', secondary: '#12213A' },
    logo: {
      frame: 'diamond', motif: 'fang', motifCount: 2, rotationDeg: 0,
      frameColor: '#4A6FA5', motifColor: '#12213A', accentColor: LIGHT_ACCENT,
    },
  },

  // --- Pacific North --------------------------------------------------------
  {
    id: 'IRO', city: 'Ironvale', nickname: 'Icebreakers',
    conference: 'Pacific', division: 'North',
    colors: { primary: '#7FB3D5', secondary: '#1F2A36' },
    logo: {
      frame: 'hexagon', motif: 'peak', motifCount: 2, rotationDeg: 0,
      frameColor: '#7FB3D5', motifColor: '#1F2A36', accentColor: LIGHT_ACCENT,
    },
  },
  {
    id: 'JUN', city: 'Junction City', nickname: 'Jackrabbits',
    conference: 'Pacific', division: 'North',
    colors: { primary: '#6B4F2A', secondary: '#EDE3CF' },
    logo: {
      frame: 'roundel', motif: 'chevron', motifCount: 2, rotationDeg: 180,
      frameColor: '#6B4F2A', motifColor: '#EDE3CF', accentColor: '#EDE3CF',
    },
  },
  {
    id: 'KIN', city: 'Kingsport', nickname: 'Kodiaks',
    conference: 'Pacific', division: 'North',
    colors: { primary: '#3E2723', secondary: '#C89B3C' },
    logo: {
      frame: 'shield', motif: 'claw', motifCount: 3, rotationDeg: -15,
      frameColor: '#3E2723', motifColor: '#C89B3C', accentColor: '#C89B3C',
    },
  },
  {
    id: 'LAK', city: 'Lakemont', nickname: 'Leviathans',
    conference: 'Pacific', division: 'North',
    colors: { primary: '#123A5C', secondary: '#3FB8AF' },
    logo: {
      frame: 'circle', motif: 'fang', motifCount: 3, rotationDeg: 0,
      frameColor: '#123A5C', motifColor: '#3FB8AF', accentColor: '#3FB8AF',
    },
  },

  // --- Pacific South --------------------------------------------------------
  {
    id: 'MER', city: 'Meridian', nickname: 'Monarchs',
    conference: 'Pacific', division: 'South',
    colors: { primary: '#5C2D91', secondary: '#F0A500' },
    logo: {
      frame: 'diamond', motif: 'star', motifCount: 1, rotationDeg: 0,
      frameColor: '#5C2D91', motifColor: '#F0A500', accentColor: '#F0A500',
    },
  },
  {
    id: 'NOR', city: 'Northgate', nickname: 'Nighthawks',
    conference: 'Pacific', division: 'South',
    colors: { primary: '#22252B', secondary: '#9B111E' },
    logo: {
      frame: 'roundel', motif: 'wing', motifCount: 2, rotationDeg: 12,
      frameColor: '#22252B', motifColor: '#9B111E', accentColor: LIGHT_ACCENT,
    },
  },
  {
    id: 'OAK', city: 'Oakcrest', nickname: 'Outlaws',
    conference: 'Pacific', division: 'South',
    colors: { primary: '#2F2F2F', secondary: '#A6192E' },
    logo: {
      frame: 'shield', motif: 'star', motifCount: 2, rotationDeg: 0,
      frameColor: '#2F2F2F', motifColor: '#A6192E', accentColor: LIGHT_ACCENT,
    },
  },
  {
    id: 'PAL', city: 'Palisade', nickname: 'Pioneers',
    conference: 'Pacific', division: 'South',
    colors: { primary: '#8C5A2B', secondary: '#243E5F' },
    logo: {
      frame: 'circle', motif: 'peak', motifCount: 3, rotationDeg: 0,
      frameColor: '#8C5A2B', motifColor: '#243E5F', accentColor: LIGHT_ACCENT,
    },
  },
];

/** Team ids in canonical order (division order, then alphabetical). */
export const TEAM_IDS: readonly string[] = TEAM_IDENTITIES.map((t) => t.id);

export interface DivisionKey {
  conference: ConferenceName;
  division: DivisionName;
}

/** The four divisions in fixed order — schedule generation depends on this. */
export const DIVISIONS: readonly DivisionKey[] = [
  { conference: 'Atlantic', division: 'North' },
  { conference: 'Atlantic', division: 'South' },
  { conference: 'Pacific', division: 'North' },
  { conference: 'Pacific', division: 'South' },
];

export function getTeamIdentity(id: string): TeamIdentity | undefined {
  return TEAM_IDENTITIES.find((t) => t.id === id);
}

export function teamsInDivision(
  conference: ConferenceName,
  division: DivisionName,
): readonly TeamIdentity[] {
  return TEAM_IDENTITIES.filter((t) => t.conference === conference && t.division === division);
}

export function teamsInConference(conference: ConferenceName): readonly TeamIdentity[] {
  return TEAM_IDENTITIES.filter((t) => t.conference === conference);
}

// ---------------------------------------------------------------------------
// Jersey conflict rule: if two primaries are close in hue AND lightness, the
// away team wears its secondary as the jersey base.
// ---------------------------------------------------------------------------

// TODO(balance): conflict thresholds are presentation tuning.
const HUE_CONFLICT_DEG = 40;
const LIGHTNESS_CONFLICT = 0.25;

export function parseHex(hex: string): { r: number; g: number; b: number } {
  const v = Number.parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/** Hue (degrees), saturation and lightness in [0,1] from a #RRGGBB string. */
export function hueLightness(hex: string): { hue: number; sat: number; lightness: number } {
  const { r, g, b } = parseHex(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (d > 1e-9) {
    if (max === rn) hue = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) hue = 60 * ((bn - rn) / d + 2);
    else hue = 60 * ((rn - gn) / d + 4);
  }
  if (hue < 0) hue += 360;
  const denom = 1 - Math.abs(2 * lightness - 1);
  const sat = denom < 1e-9 ? 0 : d / denom;
  return { hue, sat, lightness };
}

// Below this saturation a colour reads as a neutral: hue stops meaning
// anything, so two near-greys clash on lightness alone (#22252B vs #2F2F2F).
const NEUTRAL_SAT = 0.18;

export function jerseysConflict(primaryA: string, primaryB: string): boolean {
  const a = hueLightness(primaryA);
  const b = hueLightness(primaryB);
  let dh = Math.abs(a.hue - b.hue);
  if (dh > 180) dh = 360 - dh;
  const bothNeutral = a.sat < NEUTRAL_SAT && b.sat < NEUTRAL_SAT;
  const hueClose = bothNeutral || dh < HUE_CONFLICT_DEG;
  return hueClose && Math.abs(a.lightness - b.lightness) < LIGHTNESS_CONFLICT;
}
