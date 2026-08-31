// TODO(integration): src/data/teams.ts, src/data/names.ts and src/data/ratings.ts
// are authored in parallel by workstream S2. Until they exist, the normative
// tables from docs/design/meta-design.md §1–§2 live here so src/meta can be
// built and tested standalone. When the data modules land, re-point the imports
// in league.ts (shapes are identical) and delete this file.

import type { Position, RatingKey } from '../sim/types';
import type { TeamIdentity } from './types';

// ---------------------------------------------------------------------------
// §1 — the 16 canonical identities (order below is THE league order; every
// deterministic iteration in meta/* walks this array by index).
// ---------------------------------------------------------------------------

export const TEAM_IDENTITIES: readonly TeamIdentity[] = [
  {
    id: 'ASH', city: 'Ashford', nickname: 'Aviators',
    conference: 'Atlantic', division: 'North',
    colors: { primary: '#1B3A6B', secondary: '#E8B93E' },
    logo: { frame: 'shield', motif: 'wing', motifCount: 2, rotationDeg: 0, frameColor: '#1B3A6B', motifColor: '#E8B93E', accentColor: '#E8B93E' },
  },
  {
    id: 'BAY', city: 'Bayport', nickname: 'Barracudas',
    conference: 'Atlantic', division: 'North',
    colors: { primary: '#0E7C86', secondary: '#C0C7CE' },
    logo: { frame: 'circle', motif: 'fang', motifCount: 2, rotationDeg: 0, frameColor: '#0E7C86', motifColor: '#C0C7CE', accentColor: '#C0C7CE' },
  },
  {
    id: 'COB', city: 'Cobalt City', nickname: 'Comets',
    conference: 'Atlantic', division: 'North',
    colors: { primary: '#2244CC', secondary: '#F2F2F2' },
    logo: { frame: 'roundel', motif: 'orbit', motifCount: 1, rotationDeg: -20, frameColor: '#2244CC', motifColor: '#F2F2F2', accentColor: '#F2F2F2' },
  },
  {
    id: 'DUN', city: 'Dunmore', nickname: 'Drifters',
    conference: 'Atlantic', division: 'North',
    colors: { primary: '#5B4A8A', secondary: '#D9D3C2' },
    logo: { frame: 'hexagon', motif: 'chevron', motifCount: 3, rotationDeg: 0, frameColor: '#5B4A8A', motifColor: '#D9D3C2', accentColor: '#D9D3C2' },
  },
  {
    id: 'EMB', city: 'Emberton', nickname: 'Emperors',
    conference: 'Atlantic', division: 'South',
    colors: { primary: '#8A1C1C', secondary: '#E8B93E' },
    logo: { frame: 'shield', motif: 'crest-stripes', motifCount: 3, rotationDeg: 0, frameColor: '#8A1C1C', motifColor: '#E8B93E', accentColor: '#E8B93E' },
  },
  {
    id: 'FAI', city: 'Fairhaven', nickname: 'Firehawks',
    conference: 'Atlantic', division: 'South',
    colors: { primary: '#D34E24', secondary: '#26211E' },
    logo: { frame: 'diamond', motif: 'wing', motifCount: 2, rotationDeg: 12, frameColor: '#D34E24', motifColor: '#26211E', accentColor: '#26211E' },
  },
  {
    id: 'GRA', city: 'Grandview', nickname: 'Gladiators',
    conference: 'Atlantic', division: 'South',
    colors: { primary: '#7A1F3D', secondary: '#B8B8B8' },
    logo: { frame: 'shield', motif: 'initial', motifCount: 1, rotationDeg: 0, frameColor: '#7A1F3D', motifColor: '#B8B8B8', accentColor: '#B8B8B8' },
  },
  {
    id: 'HAR', city: 'Harborview', nickname: 'Hammerheads',
    conference: 'Atlantic', division: 'South',
    colors: { primary: '#4A6FA5', secondary: '#12213A' },
    logo: { frame: 'hexagon', motif: 'fang', motifCount: 2, rotationDeg: 0, frameColor: '#4A6FA5', motifColor: '#12213A', accentColor: '#12213A' },
  },
  {
    id: 'IRO', city: 'Ironvale', nickname: 'Icebreakers',
    conference: 'Pacific', division: 'North',
    colors: { primary: '#7FB3D5', secondary: '#1F2A36' },
    logo: { frame: 'diamond', motif: 'peak', motifCount: 1, rotationDeg: 0, frameColor: '#7FB3D5', motifColor: '#1F2A36', accentColor: '#1F2A36' },
  },
  {
    id: 'JUN', city: 'Junction City', nickname: 'Jackrabbits',
    conference: 'Pacific', division: 'North',
    colors: { primary: '#6B4F2A', secondary: '#EDE3CF' },
    logo: { frame: 'circle', motif: 'chevron', motifCount: 2, rotationDeg: 180, frameColor: '#6B4F2A', motifColor: '#EDE3CF', accentColor: '#EDE3CF' },
  },
  {
    id: 'KIN', city: 'Kingsport', nickname: 'Kodiaks',
    conference: 'Pacific', division: 'North',
    colors: { primary: '#3E2723', secondary: '#C89B3C' },
    logo: { frame: 'shield', motif: 'claw', motifCount: 3, rotationDeg: -12, frameColor: '#3E2723', motifColor: '#C89B3C', accentColor: '#C89B3C' },
  },
  {
    id: 'LAK', city: 'Lakemont', nickname: 'Leviathans',
    conference: 'Pacific', division: 'North',
    colors: { primary: '#123A5C', secondary: '#3FB8AF' },
    logo: { frame: 'roundel', motif: 'fang', motifCount: 3, rotationDeg: 0, frameColor: '#123A5C', motifColor: '#3FB8AF', accentColor: '#3FB8AF' },
  },
  {
    id: 'MER', city: 'Meridian', nickname: 'Monarchs',
    conference: 'Pacific', division: 'South',
    colors: { primary: '#5C2D91', secondary: '#F0A500' },
    logo: { frame: 'circle', motif: 'star', motifCount: 1, rotationDeg: 0, frameColor: '#5C2D91', motifColor: '#F0A500', accentColor: '#F0A500' },
  },
  {
    id: 'NOR', city: 'Northgate', nickname: 'Nighthawks',
    conference: 'Pacific', division: 'South',
    colors: { primary: '#22252B', secondary: '#9B111E' },
    logo: { frame: 'hexagon', motif: 'wing', motifCount: 2, rotationDeg: -8, frameColor: '#22252B', motifColor: '#9B111E', accentColor: '#9B111E' },
  },
  {
    id: 'OAK', city: 'Oakcrest', nickname: 'Outlaws',
    conference: 'Pacific', division: 'South',
    colors: { primary: '#2F2F2F', secondary: '#A6192E' },
    logo: { frame: 'diamond', motif: 'star', motifCount: 1, rotationDeg: 0, frameColor: '#2F2F2F', motifColor: '#A6192E', accentColor: '#A6192E' },
  },
  {
    id: 'PAL', city: 'Palisade', nickname: 'Pioneers',
    conference: 'Pacific', division: 'South',
    colors: { primary: '#8C5A2B', secondary: '#243E5F' },
    logo: { frame: 'shield', motif: 'peak', motifCount: 2, rotationDeg: 0, frameColor: '#8C5A2B', motifColor: '#243E5F', accentColor: '#243E5F' },
  },
];

// ---------------------------------------------------------------------------
// §2 — name pools
// ---------------------------------------------------------------------------

export const FIRST_NAMES: readonly string[] = [
  'Aaron', 'Andre', 'Antoine', 'Austin', 'Blake', 'Brandon', 'Bryce', 'Caleb',
  'Cameron', 'Carl', 'Cedric', 'Chase', 'Chris', 'Cole', 'Colin', 'Cordell',
  'Curtis', 'Damon', 'Dante', 'Darius', 'Darnell', 'DeAndre', 'Dennis', 'Derek',
  'Devin', 'Dexter', 'Dominic', 'Donte', 'Dwayne', 'Eli', 'Elijah', 'Emmett',
  'Evan', 'Ezra', 'Felix', 'Gabe', 'Garrett', 'Grant', 'Hakeem', 'Hank',
  'Hector', 'Hugo', 'Isaiah', 'Ivan', 'Jabari', 'Jamal', 'Jared', 'Jasper',
  'Javon', 'Jerome', 'Jonah', 'Jordan', 'Julius', 'Kareem', 'Keenan', 'Kelvin',
  'Kendall', 'Khalil', 'Kyle', 'Lamont', 'Landon', 'Levi', 'Lionel', 'Logan',
  'Lucas', 'Malcolm', 'Marcel', 'Mario', 'Marshall', 'Mason', 'Maurice', 'Micah',
  'Miles', 'Mitchell', 'Nate', 'Nico', 'Noah', 'Omar', 'Orlando', 'Oscar',
  'Otis', 'Paul', 'Preston', 'Quentin', 'Quincy', 'Rashad', 'Reggie', 'Rex',
  'Ricardo', 'Roman', 'Ronnie', 'Roy', 'Ruben', 'Russell', 'Santiago', 'Saul',
  'Sean', 'Silas', 'Simeon', 'Spencer', 'Sterling', 'Tariq', 'Terrence', 'Theo',
  'Tobias', 'Trent', 'Trevon', 'Tucker', 'Victor', 'Vince', 'Wade', 'Warren',
  'Xavier', 'Zane',
];

export const LAST_NAMES: readonly string[] = [
  'Abernathy', 'Alston', 'Ashworth', 'Banks', 'Barrow', 'Beaumont', 'Bellamy',
  'Blackwood', 'Boone', 'Bowers', 'Brantley', 'Briggs', 'Calloway', 'Carmichael',
  'Carver', 'Chastain', 'Coleman', 'Colvin', 'Crawford', 'Crenshaw', 'Cross',
  'Dalton', 'Deveraux', 'Dillard', 'Donovan', 'Draper', 'Driscoll', 'Dunbar',
  'Easley', 'Eastwood', 'Ellsworth', 'Fairbanks', 'Fallon', 'Farrow', 'Finch',
  'Fontaine', 'Forsythe', 'Foster', 'Gainey', 'Galloway', 'Garner', 'Gentry',
  'Goodwin', 'Granger', 'Greaves', 'Gresham', 'Hale', 'Halloran', 'Hargrove',
  'Harmon', 'Hawthorne', 'Hayes', 'Hendrix', 'Holloway', 'Holt', 'Huxley',
  'Ingram', 'Irons', 'Jarvis', 'Jennings', 'Keating', 'Kemp', 'Kendrick',
  'Kincaid', 'Lachlan', 'Landry', 'Langston', 'Larkin', 'Latimer', 'Ledger',
  'Lockhart', 'Lowery', 'Maddox', 'Marlow', 'Mercer', 'Merritt', 'Monroe',
  'Montgomery', 'Mosley', 'Nash', 'Newsome', 'Northcutt', 'Oakes', 'Ormond',
  'Osborne', 'Pemberton', 'Pennington', 'Presley', 'Quimby', 'Radcliffe',
  'Rainey', 'Ramsey', 'Redmond', 'Renner', 'Rhodes', 'Ridley', 'Rockwell',
  'Rowan', 'Saldana', 'Satterfield', 'Sexton', 'Shepard', 'Slade', 'Stanton',
  'Steele', 'Stokes', 'Sutton', 'Talley', 'Tanner', 'Thackery', 'Thorne',
  'Tillman', 'Trask', 'Truitt', 'Vance', 'Vaughn', 'Wexley', 'Whitaker',
  'Whitfield', 'Wilder', 'Winslow', 'Woodard', 'Wren', 'Yardley', 'York',
  'Zeller',
];

/**
 * Exact real-player first+last combos the generator must never emit. Only the
 * combos reachable from the two pools above can actually collide; the rest are
 * carried as belt-and-braces if the pools ever grow.
 */
export const BLOCKED_FULL_NAMES: ReadonlySet<string> = new Set<string>([
  'Xavier Rhodes', 'Dominic Rhodes', 'Rashad Jennings', 'Mason Foster',
  'Carl Banks', 'Brandon Banks', 'Sterling Shepard', 'Dennis Northcutt',
  'Terrence Steele', 'Marshall Faulk', 'Jerry Rice', 'Barry Sanders',
  'Walter Payton', 'Joe Montana', 'Tom Brady', 'Peyton Manning',
  'Emmitt Smith', 'Lawrence Taylor', 'Reggie White', 'Deion Sanders',
  'Randy Moss', 'Brett Favre', 'John Elway', 'Dan Marino', 'Jim Brown',
  'Ray Lewis', 'Ed Reed', 'Troy Polamalu', 'Adrian Peterson', 'Aaron Rodgers',
  'Drew Brees', 'Calvin Johnson', 'Khalil Mack', 'Von Miller',
  'Patrick Mahomes', 'Derrick Henry', 'Travis Kelce', 'Tyreek Hill',
  'Julio Jones', 'Antonio Brown', 'Rob Gronkowski', 'Odell Beckham',
  'Saquon Barkley', 'Micah Parsons', 'Julius Peppers',
]);

// ---------------------------------------------------------------------------
// §2 — archetype tables (would live in data/ratings.ts)
// ---------------------------------------------------------------------------

/** Frozen Ratings key order — every generator writes attributes in this order. */
export const RATING_KEYS: readonly RatingKey[] = [
  'spd', 'acc', 'agi', 'str', 'awr', 'cth', 'car', 'btk', 'elu', 'thp',
  'tha', 'tak', 'hpw', 'pbk', 'rbk', 'shd', 'mcv', 'zcv', 'kpw', 'kac',
];

/** Attributes rolled near the group mean; everything else gets a 40–65 floor. */
export const PRIMARY_ATTRS: Readonly<Record<Position, readonly RatingKey[]>> = {
  QB: ['tha', 'thp', 'awr', 'spd', 'agi'],
  RB: ['spd', 'acc', 'agi', 'str', 'car', 'cth', 'btk', 'elu'],
  WR: ['spd', 'acc', 'agi', 'cth', 'awr', 'elu'],
  TE: ['cth', 'rbk', 'pbk', 'str', 'spd'],
  OL: ['pbk', 'rbk', 'str', 'awr', 'agi'],
  DL: ['shd', 'str', 'tak', 'acc', 'hpw'],
  LB: ['tak', 'shd', 'mcv', 'zcv', 'spd', 'awr', 'hpw'],
  CB: ['mcv', 'zcv', 'spd', 'acc', 'agi', 'awr'],
  S: ['zcv', 'mcv', 'tak', 'spd', 'awr', 'hpw'],
  K: ['kpw', 'kac', 'awr'],
  P: ['kpw', 'kac', 'awr'],
};

/** 40 men: QB2 RB3 WR5 TE2 OL7 DL6 LB6 CB4 S3 K1 P1. */
export const ROSTER_PLAN: readonly (readonly [Position, number])[] = [
  ['QB', 2], ['RB', 3], ['WR', 5], ['TE', 2], ['OL', 7],
  ['DL', 6], ['LB', 6], ['CB', 4], ['S', 3], ['K', 1], ['P', 1],
];

/** Rating points lost per depth-chart slot below the starter. */
export const SLOT_DROPOFF: Readonly<Record<Position, number>> = {
  QB: 8, RB: 5, WR: 4, TE: 6, OL: 3, DL: 4, LB: 4, CB: 5, S: 5, K: 0, P: 0,
};

export const AGE_RANGE: Readonly<Record<Position, readonly [number, number]>> = {
  QB: [22, 38], RB: [21, 30], WR: [21, 34], TE: [21, 34], OL: [21, 34],
  DL: [21, 34], LB: [21, 34], CB: [21, 34], S: [21, 34], K: [21, 34], P: [21, 34],
};

export const JERSEY_POOLS: Readonly<Record<Position, readonly (readonly [number, number])[]>> = {
  QB: [[1, 19]],
  RB: [[20, 39]],
  WR: [[10, 19], [80, 89]],
  TE: [[80, 89], [40, 49]],
  OL: [[50, 79]],
  DL: [[90, 99], [60, 79]],
  LB: [[40, 59], [90, 99]],
  CB: [[20, 39]],
  S: [[20, 49]],
  K: [[1, 9]],
  P: [[1, 9]],
};
