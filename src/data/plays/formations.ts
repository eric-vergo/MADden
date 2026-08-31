// Playbook formations: 6 offensive + 5 defensive base looks plus the special
// teams units. Normalized frame: offense drives +y; x is lateral offset from
// the ball spot (+x = offense's right); offense aligns at dy < 0, defense at
// dy > 0.
//
// Authoring constraints (enforced by tests/data/playbook.test.ts):
//  - exactly 11 roles per formation, no two roles within 0.7 yd;
//  - |x| <= 23 for every alignment: the ball sits on a hash 3 snaps out of 4
//    and hash-to-far-sideline is 23.58 yd, so anything wider is out of bounds
//    into the boundary;
//  - non-special-teams offensive formations put exactly 7 men on the line
//    (dy >= -1.0), the rest in the backfield.

import type { FormationDef } from '../../sim/types';

// Interior line splits: center at x=0, ~1.8 yd body-to-body, a hair off the ball.
const OL_Y = -0.7;
const OL = {
  LT: { x: -3.6, y: OL_Y },
  LG: { x: -1.8, y: OL_Y },
  C: { x: 0, y: OL_Y },
  RG: { x: 1.8, y: OL_Y },
  RT: { x: 3.6, y: OL_Y },
} as const;

export const FORMATIONS: readonly FormationDef[] = [
  // -------------------------------------------------------------------------
  // Offense
  // -------------------------------------------------------------------------
  {
    id: 'i-form',
    side: 'O',
    qbUnderCenter: true,
    personnelLabel: '21',
    alignments: {
      QB: { x: 0, y: -1.45 },
      FB: { x: 0, y: -4.6 },
      RB: { x: 0, y: -7.0 },
      TE1: { x: 5.4, y: -0.7 },
      WR1: { x: -16.5, y: -0.7 },
      WR2: { x: 16.5, y: -1.6 },
      ...OL,
    },
  },
  {
    id: 'singleback',
    side: 'O',
    qbUnderCenter: true,
    personnelLabel: '11',
    alignments: {
      QB: { x: 0, y: -1.45 },
      RB: { x: -0.8, y: -6.2 },
      TE1: { x: 5.4, y: -0.7 },
      WR1: { x: -16.5, y: -0.7 },
      WR2: { x: -9.5, y: -1.6 },
      WR3: { x: 16.0, y: -1.6 },
      ...OL,
    },
  },
  {
    id: 'gun-2x2',
    side: 'O',
    qbUnderCenter: false,
    personnelLabel: '11',
    alignments: {
      QB: { x: 0, y: -5.0 },
      RB: { x: 2.0, y: -5.2 },
      WR1: { x: -16.5, y: -0.7 },
      WR2: { x: -9.5, y: -1.6 },
      WR3: { x: 16.5, y: -0.7 },
      TE1: { x: 9.5, y: -1.6 },
      ...OL,
    },
  },
  {
    id: 'gun-trips-right',
    side: 'O',
    qbUnderCenter: false,
    personnelLabel: '11',
    alignments: {
      QB: { x: 0, y: -5.0 },
      RB: { x: -2.0, y: -5.2 },
      WR1: { x: -16.5, y: -0.7 }, // backside X
      WR2: { x: 17.0, y: -0.7 }, // trips #1 (on the line)
      WR3: { x: 11.5, y: -1.6 }, // trips #2
      TE1: { x: 6.5, y: -1.6 }, // trips #3
      ...OL,
    },
  },
  {
    id: 'gun-empty',
    side: 'O',
    qbUnderCenter: false,
    personnelLabel: '10',
    alignments: {
      QB: { x: 0, y: -5.0 },
      WR1: { x: -17.0, y: -0.7 },
      WR2: { x: -11.0, y: -1.6 },
      WR3: { x: -6.0, y: -1.6 },
      TE1: { x: 9.5, y: -1.6 },
      WR4: { x: 16.5, y: -0.7 },
      ...OL,
    },
  },
  {
    id: 'goal-line',
    side: 'O',
    qbUnderCenter: true,
    personnelLabel: '22',
    alignments: {
      QB: { x: 0, y: -1.45 },
      FB: { x: 0, y: -3.3 },
      RB: { x: 0, y: -5.6 },
      TE1: { x: -5.4, y: -0.7 },
      TE2: { x: 5.4, y: -0.7 },
      WR1: { x: 10.0, y: -1.6 }, // tight wing, off the ball
      ...OL,
    },
  },

  // -------------------------------------------------------------------------
  // Defense
  // -------------------------------------------------------------------------
  {
    id: '43-base',
    side: 'D',
    personnelLabel: '4-3',
    alignments: {
      LE: { x: -3.4, y: 0.9 },
      DT1: { x: -1.1, y: 0.9 },
      DT2: { x: 1.1, y: 0.9 },
      RE: { x: 3.4, y: 0.9 },
      LOLB: { x: -4.8, y: 4.2 },
      MLB1: { x: 0, y: 4.6 },
      ROLB: { x: 4.8, y: 4.2 },
      CB1: { x: -18.0, y: 5.0 },
      CB2: { x: 18.0, y: 5.0 },
      FS: { x: -2.0, y: 13.5 },
      SS: { x: 5.5, y: 9.5 },
    },
  },
  {
    id: '34-base',
    side: 'D',
    personnelLabel: '3-4',
    alignments: {
      LE: { x: -3.0, y: 0.9 },
      DT1: { x: 0, y: 0.9 }, // nose
      RE: { x: 3.0, y: 0.9 },
      LOLB: { x: -5.6, y: 2.6 },
      MLB1: { x: -1.7, y: 4.6 },
      MLB2: { x: 1.7, y: 4.6 },
      ROLB: { x: 5.6, y: 2.6 },
      CB1: { x: -18.0, y: 5.0 },
      CB2: { x: 18.0, y: 5.0 },
      FS: { x: -2.0, y: 13.5 },
      SS: { x: 5.5, y: 9.5 },
    },
  },
  {
    id: 'nickel-425',
    side: 'D',
    personnelLabel: '4-2-5',
    alignments: {
      LE: { x: -3.4, y: 0.9 },
      DT1: { x: -1.1, y: 0.9 },
      DT2: { x: 1.1, y: 0.9 },
      RE: { x: 3.4, y: 0.9 },
      MLB1: { x: -2.6, y: 4.6 },
      MLB2: { x: 2.6, y: 4.6 },
      CB1: { x: -18.0, y: 5.5 },
      CB2: { x: 18.0, y: 5.5 },
      CB3: { x: 10.5, y: 5.0 }, // nickel over the slot
      FS: { x: -2.0, y: 13.5 },
      SS: { x: 5.5, y: 10.5 },
    },
  },
  {
    id: 'dime-416',
    side: 'D',
    personnelLabel: '4-1-6',
    alignments: {
      LE: { x: -3.4, y: 0.9 },
      DT1: { x: -1.1, y: 0.9 },
      DT2: { x: 1.1, y: 0.9 },
      RE: { x: 3.4, y: 0.9 },
      MLB1: { x: 0, y: 5.0 },
      CB1: { x: -18.0, y: 6.0 },
      CB2: { x: 18.0, y: 6.0 },
      CB3: { x: -10.5, y: 5.5 },
      CB4: { x: 10.5, y: 5.5 },
      FS: { x: -6.0, y: 14.0 },
      SS: { x: 6.0, y: 14.0 },
    },
  },
  {
    id: 'gl-53',
    side: 'D',
    personnelLabel: '5-3',
    alignments: {
      LOLB: { x: -4.7, y: 0.8 }, // fifth man on the line
      LE: { x: -2.4, y: 0.8 },
      DT1: { x: 0, y: 0.8 },
      DT2: { x: 2.4, y: 0.8 },
      RE: { x: 4.7, y: 0.8 },
      MLB1: { x: -3.6, y: 3.7 },
      MLB2: { x: 0, y: 3.9 },
      ROLB: { x: 3.6, y: 3.7 },
      CB1: { x: -11.5, y: 4.5 },
      CB2: { x: 11.5, y: 4.5 },
      SS: { x: 0, y: 8.5 },
    },
  },

  // -------------------------------------------------------------------------
  // Special teams — kicking units are side 'O', receiving units side 'D'.
  // -------------------------------------------------------------------------
  {
    id: 'st-kickoff',
    side: 'O',
    personnelLabel: 'KO',
    alignments: {
      K: { x: 0, y: -6 },
      WR1: { x: -22, y: -1 }, WR2: { x: -17, y: -1 }, WR3: { x: -12, y: -1 },
      TE1: { x: -7, y: -1 }, RB: { x: -2.5, y: -1 },
      FB: { x: 2.5, y: -1 }, TE2: { x: 7, y: -1 },
      WR4: { x: 12, y: -1 }, WR5: { x: 17, y: -1 }, QB: { x: 22, y: -1 },
    },
  },
  {
    id: 'st-punt',
    side: 'O',
    personnelLabel: 'PUNT',
    alignments: {
      P: { x: 0, y: -13 },
      FB: { x: -1.5, y: -8 }, // personal protector
      ...OL,
      TE1: { x: -5.4, y: -0.7 }, TE2: { x: 5.4, y: -0.7 },
      WR1: { x: -22, y: -0.7 }, WR2: { x: 22, y: -0.7 }, // gunners
    },
  },
  {
    id: 'st-field-goal',
    side: 'O',
    personnelLabel: 'FG',
    alignments: {
      K: { x: 1.2, y: -8.5 },
      H: { x: 0, y: -7.5 },
      ...OL,
      TE1: { x: -5.2, y: -0.9 }, TE2: { x: 5.2, y: -0.9 },
      WR1: { x: -6.8, y: -1.4 }, WR2: { x: 6.8, y: -1.4 }, // wings
    },
  },
  {
    id: 'st-kick-return',
    side: 'D',
    personnelLabel: 'KR',
    alignments: {
      LE: { x: -14, y: 12 }, DT1: { x: -7, y: 12 }, DT2: { x: 0, y: 12 },
      RE: { x: 7, y: 12 }, LOLB: { x: 14, y: 12 },
      MLB1: { x: -9, y: 25 }, MLB2: { x: 0, y: 25 }, ROLB: { x: 9, y: 25 },
      CB1: { x: -8, y: 42 }, CB2: { x: 8, y: 42 },
      KR: { x: 0, y: 55 },
    },
  },
  {
    id: 'st-punt-return',
    side: 'D',
    personnelLabel: 'PR',
    alignments: {
      LE: { x: -3.2, y: 0.8 }, DT1: { x: -1, y: 0.8 }, DT2: { x: 1, y: 0.8 },
      RE: { x: 3.2, y: 0.8 },
      LOLB: { x: -5.5, y: 1 }, ROLB: { x: 5.5, y: 1 },
      CB1: { x: -21, y: 1.5 }, CB2: { x: 21, y: 1.5 }, // jam the gunners
      MLB1: { x: -3, y: 8 }, MLB2: { x: 3, y: 8 },
      PR: { x: 0, y: 38 },
    },
  },
  {
    id: 'st-fg-block',
    side: 'D',
    personnelLabel: 'FGB',
    alignments: {
      LE: { x: -4.2, y: 0.8 }, DT1: { x: -2.2, y: 0.8 }, DT2: { x: 0, y: 0.8 },
      RE: { x: 2.2, y: 0.8 }, LOLB: { x: 4.2, y: 0.8 },
      MLB1: { x: -1, y: 2.5 }, MLB2: { x: 1, y: 2.5 },
      CB1: { x: -7, y: 1.5 }, CB2: { x: 7, y: 1.5 },
      FS: { x: -3, y: 8 }, SS: { x: 3, y: 8 },
    },
  },
];

/** Formation ids in fixed order — never iterate the array by object key. */
export const FORMATION_IDS: readonly string[] = FORMATIONS.map((f) => f.id);

/** Special-teams formations are exempt from the 7-on-the-line / split rules. */
export const SPECIAL_TEAMS_FORMATION_IDS: readonly string[] = [
  'st-kickoff', 'st-punt', 'st-field-goal',
  'st-kick-return', 'st-punt-return', 'st-fg-block',
];
